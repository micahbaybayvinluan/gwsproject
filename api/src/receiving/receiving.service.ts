import { PriceUpdatesService } from '../notifications/price-updates.service';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { StockService } from '../stock/stock.service';
import { addFlavor } from '../stock/flavors';
import { ApprovalsService } from '../approvals/approvals.service';
import { MasterService } from '../master/master.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { PostingService } from '../gl/posting.service';
import { r1Receiving } from '../gl/posting-rules';
import { AttachmentsService } from '../attachments/attachments.service';
import { ScopeService } from '../common/scope.service';
import { toDateOnly, todayManila, addMonths, dateStr } from '../common/manila';
import { D } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

export interface ReceivingLineInput { productId: string; qty: number; freeQty?: number; expiryDate?: string | null; batchNo?: string | null; flavor?: string | null; unitCost?: number | null; remarks?: string }
export interface ReceivingEditInput { supplierId?: string; supplierRef?: string | null; docDate?: string; notes?: string | null; lines: ReceivingLineInput[] }
export interface ReceivingInput { purchaseOrderId?: string; replacementTicketId?: string; locationId?: string; supplierId: string; supplierRef?: string; docDate?: string; isConsignmentIn?: boolean; paidOnReceipt?: boolean; paymentAccountId?: string | null; notes?: string; lines: ReceivingLineInput[] }

/** §7.2 Receiving from suppliers (Supplier's Form / PO-Purchases) with COST_ON_RECEIVING approval. */
@Injectable()
export class ReceivingService implements OnModuleInit {
  constructor(private prisma: PrismaService, private seq: SequenceService, private stock: StockService, private approvals: ApprovalsService, private master: MasterService, private notify: NotificationsService, private audit: AuditService, private settings: SettingsService, private posting: PostingService, private attachments: AttachmentsService, private scope: ScopeService, private priceUpdates: PriceUpdatesService) {}

  onModuleInit() {
    this.approvals.register('COST_ON_RECEIVING', (req, outcome, actor) => this.onCostDecision(req.documentId, outcome, actor?.id ?? null));
    // goods a Warehouse Associate received wait for the In-Charge after the cost is approved (owner request 2026-09-26)
    this.approvals.register('WAREHOUSE_IN', (req, outcome, actor) => this.onInChargeDecision(req.documentId, outcome, actor?.id ?? null), 'ReceivingDoc');
  }

  private include = { supplier: { select: { id: true, code: true, name: true } }, location: { select: { id: true, code: true, name: true } }, lines: { include: { product: { select: { id: true, sku: true, name: true, trackExpiry: true, category: { select: { accountingClass: true } } } } } } } as const;

  list(user: SessionUser, q: { status?: string; locationId?: string; from?: string; to?: string }) {
    const where: Prisma.ReceivingDocWhereInput = { locationId: this.scope.locationFilter(user, q.locationId) as never, status: q.status as never, docDate: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined };
    return this.prisma.db.receivingDoc.findMany({ where, include: this.include, orderBy: { createdAt: 'desc' }, take: 300 });
  }
  async get(id: string, user: SessionUser) {
    const doc = await this.prisma.db.receivingDoc.findUnique({ where: { id }, include: this.include });
    if (!doc) throw new NotFoundException();
    if (user.locationScoped && !user.locationIds.includes(doc.locationId)) throw new ForbiddenException();
    const costs = await this.master.currentCosts(doc.lines.map((l) => l.productId));
    const preparer = await this.prisma.db.user.findUnique({ where: { id: doc.preparedBy }, select: { id: true, fullName: true } });
    return { ...doc, preparedByName: preparer?.fullName ?? null, preparedByRole: (await this.prisma.db.user.findUnique({ where: { id: doc.preparedBy ?? '' }, select: { role: { select: { key: true } } } }))?.role.key ?? null, lines: doc.lines.map((l) => ({ ...l, currentStandardCost: costs.get(l.productId) ?? null })) , attachments: await this.attachments.list('ReceivingDoc', id) };
  }

  private postedHooks: ((docId: string) => Promise<void>)[] = [];
  /** Called after a supplier delivery is posted (the replacement tickets count what arrived). */
  onPosted(fn: (docId: string) => Promise<void>) { this.postedHooks.push(fn); }

  async create(input: ReceivingInput, user: SessionUser) {
    const wh = input.locationId ? await this.prisma.db.location.findUniqueOrThrow({ where: { id: input.locationId } }) : await this.prisma.db.location.findFirstOrThrow({ where: { type: 'WAREHOUSE' } });
    if (user.locationScoped && !user.locationIds.includes(wh.id)) throw new ForbiddenException('You can only receive into your own location');
    if (!input.lines.length) throw new BadRequestException('At least one line is required');
    const supplier = await this.prisma.db.supplier.findUniqueOrThrow({ where: { id: input.supplierId } });
    // a delivery that replaces items we returned: it must be the ticket's own supplier, and the ticket must be waiting for it
    if (input.replacementTicketId) {
      const t = await requestContext.runSystem(() => this.prisma.db.replacementTicket.findUnique({ where: { id: input.replacementTicketId } }));
      if (!t || t.kind !== 'SUPPLIER') throw new BadRequestException('Unknown replacement ticket');
      if (t.supplierId !== supplier.id) throw new BadRequestException(`Ticket ${t.ticketNo} is waiting for a replacement from another supplier`);
      if (!['AWAITING_REPLACEMENT', 'PARTIAL'].includes(t.status)) throw new BadRequestException(`Ticket ${t.ticketNo} is not waiting for a replacement`);
    }
    // a delivery for a purchase order: it must be that supplier's order and already sent
    if (input.purchaseOrderId) {
      const po = await this.prisma.db.purchaseOrder.findUnique({ where: { id: input.purchaseOrderId } });
      if (!po) throw new BadRequestException('Unknown purchase order');
      if (po.supplierId !== supplier.id) throw new BadRequestException(`${po.poNo} is an order to another supplier`);
      if (!['SENT', 'PARTIAL'].includes(po.status)) throw new BadRequestException(`${po.poNo} is not waiting for a delivery (it is ${po.status.toLowerCase()})`);
    }
    const today = todayManila();
    const warnings = await this.validateLines(input.lines, user);
    const doc = await this.prisma.db.$transaction(async (tx) => {
      const controlNo = await this.seq.form(tx, 'RC', wh.id);
      return tx.receivingDoc.create({
        data: {
          controlNo, docDate: input.docDate ? toDateOnly(input.docDate) : today, locationId: wh.id, supplierId: supplier.id, supplierRef: input.supplierRef, isConsignmentIn: input.isConsignmentIn ?? supplier.isConsignor,
          paidOnReceipt: !!input.paidOnReceipt, paymentAccountId: input.paymentAccountId ?? null, notes: input.notes, replacementTicketId: input.replacementTicketId ?? null, purchaseOrderId: input.purchaseOrderId ?? null, preparedBy: user.id, createdBy: user.id,
          lines: { create: input.lines.map((l) => ({ productId: l.productId, qty: l.qty, freeQty: l.freeQty ?? 0, expiryDate: l.expiryDate ? toDateOnly(l.expiryDate) : null, batchNo: l.batchNo ?? null, flavor: l.flavor?.trim() || null, unitCost: l.unitCost != null ? D(l.unitCost).toFixed(2) : null, remarks: l.remarks })) },
        }, include: this.include,
      });
    });
    await this.audit.log({ action: 'CREATE', entityType: 'ReceivingDoc', entityId: doc.id, after: doc });
    return { ...doc, warnings };
  }

  /** Shared by create and edits: product exists, qty > 0, expiry rules (§7.2), cost only for cost.edit. Returns short-dated warnings. */
  async validateLines(lines: ReceivingLineInput[], user: SessionUser | null, trusted = false): Promise<string[]> {
    if (!lines.length) throw new BadRequestException('At least one line is required');
    const products = await this.prisma.db.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } });
    const today = todayManila(); const warnings: string[] = [];
    for (const l of lines) {
      const p = products.find((x) => x.id === l.productId);
      if (!p) throw new BadRequestException(`Unknown product ${l.productId}`);
      if (l.qty <= 0 && (l.freeQty ?? 0) <= 0) throw new BadRequestException(`Qty must be positive for ${p.name}`);
      if (p.trackExpiry) {
        if (!l.expiryDate) throw new BadRequestException(`Expiry date required for ${p.name}`);
        const exp = toDateOnly(l.expiryDate);
        if (exp <= today) throw new BadRequestException(`Expiry for ${p.name} must be after today`);
        if (exp < addMonths(today, 6)) warnings.push(`${p.name}: short-dated (expires ${dateStr(exp)})`);
      }
      if (l.unitCost != null && !trusted && !user?.permissions.has('cost.edit')) throw new ForbiddenException('You may not enter cost');
    }
    return warnings;
  }

  /** Snapshot used for edit proposals (what the associate sees before accepting). No cost fields. */
  async editSnapshot(id: string) {
    const d = await this.prisma.db.receivingDoc.findUniqueOrThrow({ where: { id }, include: this.include });
    return { id: d.id, controlNo: d.controlNo, status: d.status, locationId: d.locationId, locationName: d.location.name, createdBy: d.createdBy ?? d.preparedBy, header: { supplier: d.supplier.code, supplierRef: d.supplierRef ?? '', docDate: dateStr(d.docDate), notes: d.notes ?? '' }, lines: d.lines.map((l) => ({ productId: l.productId, product: l.product.name, qty: l.qty, freeQty: l.freeQty, expiryDate: l.expiryDate ? dateStr(l.expiryDate) : '', batchNo: l.batchNo ?? '', flavor: l.flavor ?? '', remarks: l.remarks ?? '' })) };
  }

  /**
   * Replace header + lines of a DRAFT or SUBMITTED receiving doc (owner request 2026-09-25: drafts are editable before submission;
   * In-Charge edits apply after the associate accepts). A submitted doc goes back through cost approval: its pending request is
   * cancelled and it is resubmitted in the preparer's name, keeping any cost already entered for the same product.
   */
  async applyEdit(id: string, input: ReceivingEditInput, actorId: string, editor: SessionUser | null) {
    const doc = await this.prisma.db.receivingDoc.findUniqueOrThrow({ where: { id }, include: this.include });
    if (!['DRAFT', 'SUBMITTED'].includes(doc.status)) throw new BadRequestException(`A ${doc.status} receiving document can no longer be edited`);
    await this.validateLines(input.lines, editor, editor === null); // editor null = accepted proposal, validated when proposed
    if (input.supplierId) await this.prisma.db.supplier.findUniqueOrThrow({ where: { id: input.supplierId } });
    const keptCost = new Map(doc.lines.filter((l) => l.unitCost != null).map((l) => [l.productId, l.unitCost]));
    const wasSubmitted = doc.status === 'SUBMITTED';
    if (wasSubmitted) await this.approvals.cancelForDocument('ReceivingDoc', id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.receivingLine.deleteMany({ where: { docId: id } });
      await tx.receivingDoc.update({
        where: { id },
        data: {
          supplierId: input.supplierId ?? undefined, supplierRef: input.supplierRef === undefined ? undefined : input.supplierRef, notes: input.notes === undefined ? undefined : input.notes,
          docDate: input.docDate ? toDateOnly(input.docDate) : undefined, status: 'DRAFT', approvalRequestId: null, updatedBy: actorId,
          lines: { create: input.lines.map((l) => ({ productId: l.productId, qty: l.qty, freeQty: l.freeQty ?? 0, expiryDate: l.expiryDate ? toDateOnly(l.expiryDate) : null, batchNo: l.batchNo ?? null, flavor: l.flavor?.trim() || null, unitCost: l.unitCost != null ? D(l.unitCost).toFixed(2) : keptCost.get(l.productId) ?? null, remarks: l.remarks })) },
        },
      });
    });
    if (wasSubmitted) await this.submitDoc(id, doc.preparedBy ?? doc.createdBy ?? actorId);
  }

  /** Submit → COST_ON_RECEIVING approval. Marks lines whose product exists with an unchanged cost; those docs auto-approve after 24 h. */
  async submit(id: string, user: SessionUser) {
    const doc = await this.get(id, user);
    if (user.locationScoped && doc.preparedBy !== user.id) throw new ForbiddenException(`Only ${doc.preparedByName ?? 'the person who prepared it'} can submit this draft; propose an edit instead`);
    await this.submitDoc(id, user.id);
    return this.get(id, user);
  }
  private async submitDoc(id: string, requestedBy: string) {
    const doc = await this.prisma.db.receivingDoc.findUniqueOrThrow({ where: { id }, include: this.include });
    if (doc.status !== 'DRAFT') throw new BadRequestException('Only drafts can be submitted');
    await this.attachments.assertRequired('ReceivingDoc', id);
    const costs = await this.master.currentCosts(doc.lines.map((l) => l.productId));
    const everReceived = await this.prisma.db.batch.groupBy({ by: ['productId'], where: { productId: { in: doc.lines.map((l) => l.productId) } } });
    const receivedSet = new Set(everReceived.map((b) => b.productId));
    let allUnchanged = true;
    for (const l of doc.lines) {
      const std = costs.get(l.productId);
      const isNew = !receivedSet.has(l.productId) || std == null;
      const unchanged = !isNew && (l.unitCost == null || D(l.unitCost).equals(std!));
      if (!unchanged) allUnchanged = false;
      await this.prisma.db.receivingLine.update({ where: { id: l.id }, data: { isNewProduct: isNew, costUnchanged: unchanged, unitCost: unchanged ? std : l.unitCost } });
    }
    const preparer = await this.prisma.db.user.findUnique({ where: { id: doc.preparedBy ?? requestedBy }, select: { role: { select: { key: true } } } });
    // a Warehouse Associate's delivery: the In-Charge checks the goods first, then the Head Auditor approves the cost (owner request 2026-09-29)
    if (preparer?.role.key === 'WAREHOUSE_ASSOCIATE') {
      const req = await this.approvals.request({ type: 'WAREHOUSE_IN', documentType: 'ReceivingDoc', documentId: id, requestedBy, summary: { controlNo: doc.controlNo, locationId: doc.locationId, locationName: doc.location.name, supplierCode: doc.supplier.code, lines: doc.lines.length, units: doc.lines.reduce((t, l) => t + l.qty + l.freeQty, 0), step: 'In-Charge checks the goods against the supplier\'s delivery receipt; then the Head Auditor approves the cost', nextSteps: ['Head Auditor approves the cost'] } });
      await this.prisma.db.receivingDoc.update({ where: { id }, data: { status: 'SUBMITTED', approvalRequestId: req.id, goodsCheckedBy: null, goodsCheckedAt: null, updatedBy: requestedBy } });
      return;
    }
    await this.requestCost(id, requestedBy, allUnchanged);
  }
  /** The Head Auditor's cost approval (last step); an unchanged cost approves by itself after the set hours. */
  private async requestCost(id: string, requestedBy: string, allUnchanged: boolean) {
    const doc = await this.prisma.db.receivingDoc.findUniqueOrThrow({ where: { id }, include: this.include });
    const hours = await this.settings.get<number>('approval.cost_unchanged_auto_hours');
    const autoApproveAt = allUnchanged ? new Date(Date.now() + hours * 3600000) : null;
    const req = await this.approvals.request({ type: 'COST_ON_RECEIVING', documentType: 'ReceivingDoc', documentId: id, requestedBy, autoApproveAt, summary: { controlNo: doc.controlNo, locationId: doc.locationId, locationName: doc.location.name, supplierCode: doc.supplier.code, lines: doc.lines.length, allUnchanged, step: doc.goodsCheckedAt ? 'Goods checked by the In-Charge; approve the cost and the stock is added' : 'Approve the cost and the stock is added' } });
    await this.prisma.db.receivingDoc.update({ where: { id }, data: { status: 'SUBMITTED', approvalRequestId: req.id, updatedBy: requestedBy } });
  }

  /** Head Auditor enters/confirms costs on a submitted doc before approving (§7.2 step 2). */
  async setCosts(id: string, costs: { lineId: string; unitCost: number }[], user: SessionUser) {
    if (!user.permissions.has('cost.edit')) throw new ForbiddenException();
    const doc = await this.get(id, user);
    if (doc.status !== 'SUBMITTED') throw new BadRequestException('Costs can only be set on submitted docs');
    for (const c of costs) await this.prisma.db.receivingLine.update({ where: { id: c.lineId }, data: { unitCost: D(c.unitCost).toFixed(2), costUnchanged: false } });
    await this.audit.log({ action: 'SET_COST', entityType: 'ReceivingDoc', entityId: id, after: costs });
    // any manual touch cancels auto-approval
    if (doc.approvalRequestId) await this.prisma.db.approvalRequest.update({ where: { id: doc.approvalRequestId }, data: { autoApproveAt: null } });
    return this.get(id, user);
  }

  /**
   * Cost approved by the Head Auditor. The costs are fixed on the lines. A receiving entered by a Warehouse Associate then waits
   * for the Warehouse In-Charge (WAREHOUSE_IN) before the stock is posted; the In-Charge's own (or Admin's / auditors') entries post now.
   */
  private async onCostDecision(docId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const doc = await this.prisma.db.receivingDoc.findUniqueOrThrow({ where: { id: docId }, include: this.include });
      if (doc.status !== 'SUBMITTED') return;
      if (outcome === 'REJECTED') { await this.prisma.db.receivingDoc.update({ where: { id: docId }, data: { status: 'REJECTED' } }); return; }
      const stdCosts = await this.master.currentCosts(doc.lines.map((l) => l.productId));
      for (const l of doc.lines) if (l.unitCost == null && stdCosts.get(l.productId) == null) throw new BadRequestException(`Line ${l.product.name} has no cost; Head Auditor must enter it before approval`);
      for (const l of doc.lines) if (l.unitCost == null) await this.prisma.db.receivingLine.update({ where: { id: l.id }, data: { unitCost: D(stdCosts.get(l.productId)!).toFixed(2) } });
      // last step: the stock is added (a Warehouse Associate's goods were already checked by the In-Charge)
      await this.postReceiving(docId, actorId, 'SUBMITTED');
    });
  }

  /** In-Charge checked the goods (first step): on to the Head Auditor for the cost; or rejected. (APPROVED = the older order, cost already approved.) */
  private async onInChargeDecision(docId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const doc = await this.prisma.db.receivingDoc.findUniqueOrThrow({ where: { id: docId }, include: this.include });
      if (doc.status !== 'APPROVED' && doc.status !== 'SUBMITTED') return;
      if (outcome === 'REJECTED') { await this.prisma.db.receivingDoc.update({ where: { id: docId }, data: { status: 'REJECTED' } }); return; }
      if (doc.status === 'APPROVED') { await this.postReceiving(docId, actorId, 'APPROVED'); return; }
      await this.prisma.db.receivingDoc.update({ where: { id: docId }, data: { goodsCheckedBy: actorId, goodsCheckedAt: new Date() } });
      await this.requestCost(docId, doc.preparedBy ?? actorId ?? '', doc.lines.every((l) => l.costUnchanged));
    });
  }

  /** Create batches, post RECEIVE ledger rows, journal R1/R2; supplier-cost changes are announced to the cost roles only. */
  private async postReceiving(docId: string, actorId: string | null, expected: 'SUBMITTED' | 'APPROVED') {
    const doc = await this.prisma.db.receivingDoc.findUniqueOrThrow({ where: { id: docId }, include: this.include });
    if (doc.status !== expected) return;
    const stdCosts = await this.master.currentCosts(doc.lines.map((l) => l.productId));
    const consignmentOnBS = await this.settings.get<boolean>('consignment_in_on_balance_sheet');
    const costChanges: { productId: string; productName: string; tier: null; oldValue: Prisma.Decimal | string | null; newValue: string }[] = [];
    await this.prisma.db.$transaction(async (tx) => {
      const businessDate = doc.docDate;
      for (const l of doc.lines) {
        const cost = D(l.unitCost ?? stdCosts.get(l.productId)!);
        const batch = await tx.batch.create({ data: { productId: l.productId, batchNo: l.batchNo, expiryDate: l.expiryDate, flavor: l.flavor, receivedRef: doc.controlNo, unitCost: cost.toFixed(2), supplierId: doc.supplierId, isConsignmentIn: doc.isConsignmentIn, createdBy: actorId } });
        await tx.receivingLine.update({ where: { id: l.id }, data: { batchId: batch.id, unitCost: cost.toFixed(2) } });
        if (l.flavor) await addFlavor(tx, l.productId, l.flavor);
        await this.stock.post(tx, [{ locationId: doc.locationId, productId: l.productId, batchId: batch.id, qtyDelta: l.qty + l.freeQty, movementType: 'RECEIVE', documentType: 'ReceivingDoc', documentId: doc.id, unitCost: cost.toFixed(2), businessDate, createdBy: actorId ?? undefined }]);
        // standard cost: record when new or changed (approved by Head Auditor)
        const std = stdCosts.get(l.productId);
        if (std == null || !D(std).equals(cost)) {
          await tx.productCost.upsert({ where: { productId_effectiveFrom: { productId: l.productId, effectiveFrom: businessDate } }, create: { productId: l.productId, effectiveFrom: businessDate, cost: cost.toFixed(2), approvedBy: actorId, sourceDocId: doc.id }, update: { cost: cost.toFixed(2), approvedBy: actorId, sourceDocId: doc.id } });
          if (!costChanges.some((c) => c.productId === l.productId)) costChanges.push({ productId: l.productId, productName: l.product.name, tier: null, oldValue: std ?? null, newValue: cost.toFixed(2) });
        }
      }
      await tx.receivingDoc.update({ where: { id: docId }, data: { status: 'POSTED', postedAt: new Date() } });
      await this.posting.post(tx, { type: 'ReceivingDoc', id: doc.id, date: businessDate, createdBy: actorId }, (r) => r1Receiving(r, {
        warehouseId: doc.locationId, supplierId: doc.supplierId, controlNo: doc.controlNo, paidOnReceipt: doc.paidOnReceipt, paymentAccountId: doc.paymentAccountId, isConsignmentIn: doc.isConsignmentIn, consignmentInOnBalanceSheet: consignmentOnBS,
        // freebies are valued at the cost approved on this receiving (the same cost their batch carries in stock), so the income matches the inventory added
        lines: doc.lines.map((l) => ({ accountingClass: l.product.category.accountingClass, qty: l.qty, freeQty: l.freeQty, unitCost: l.unitCost ?? stdCosts.get(l.productId)!, stdCost: l.unitCost ?? stdCosts.get(l.productId) ?? 0 })),
      }));
    });
    await this.notify.toLocation(doc.locationId, { type: 'RECEIVING_POSTED', title: `Receiving ${doc.controlNo} posted`, link: `/receiving/${doc.id}` });
    await this.priceUpdates.announce(costChanges, { effectiveFrom: doc.docDate, source: 'RECEIVING_COST', sourceRef: doc.controlNo, link: `/receiving/${doc.id}` });
    for (const h of this.postedHooks) await h(docId);
  }

  async void(id: string, reason: string, user: SessionUser) {
    const doc = await this.get(id, user);
    if (doc.status === 'POSTED') throw new BadRequestException('Posted receiving must be reversed with a return to supplier');
    await this.approvals.cancelForDocument('ReceivingDoc', id);
    const after = await this.prisma.db.receivingDoc.update({ where: { id }, data: { status: 'VOIDED', voidedAt: new Date(), voidedBy: user.id, voidReason: reason } });
    await this.audit.log({ action: 'VOID', entityType: 'ReceivingDoc', entityId: id, before: doc, after });
    return after;
  }
}
