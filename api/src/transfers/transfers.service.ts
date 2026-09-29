import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, TransferType } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { StockService, VIRTUAL_CODES } from '../stock/stock.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { MasterService } from '../master/master.service';
import { ChargesService } from '../charges/charges.service';
import { PostingService } from '../gl/posting.service';
import { r6Transfer, r7FranchiseTransfer, r8ConsignOut, r9Writeoff } from '../gl/posting-rules';
import { dateStr, toDateOnly, todayManila } from '../common/manila';
import { D, sum } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import type { ApprovalType } from '../common/permissions';

/** An item that arrived but is not on the form (or more than the form says). */
export interface ExtraItem { productId: string; qty: number; note?: string }
export interface TransferLineInput { productId: string; qty: number; batchId?: string | null; checkerRemarks?: string }
export interface TransferEditInput { toLocationId?: string; transferType?: TransferType; returnReason?: string | null; docDate?: string; notes?: string | null; lines: TransferLineInput[] }
export interface TransferInput { fromLocationId?: string; toLocationId: string; transferType: TransferType; returnReason?: string; docDate?: string; notes?: string; lines: TransferLineInput[] }

/** §7.3 Transfers: one document, two views (Pull-Out for sender, Transfer-In for receiver). In-transit until receiver confirms. */
@Injectable()
export class TransfersService implements OnModuleInit {
  constructor(private prisma: PrismaService, private seq: SequenceService, private stock: StockService, private approvals: ApprovalsService, private notify: NotificationsService, private audit: AuditService, private settings: SettingsService, private master: MasterService, private posting: PostingService, private charges: ChargesService) {}

  onModuleInit() {
    for (const t of ['TRANSFER_INTERNAL', 'TRANSFER_TO_FRANCHISE', 'CONSIGNMENT_OUT'] as ApprovalType[]) this.approvals.register(t, (req, outcome, actor) => this.onDecision(req.documentId, outcome, actor?.id ?? null));
    this.approvals.register('WRITEOFF', (r, outcome, actor) => this.onWriteoffDecision(r.documentId, outcome, actor?.id ?? null));
    // Warehouse In-Charge approves a Warehouse Associate's goods out (before the auditors) and goods in (owner request 2026-09-26)
    this.approvals.register('WAREHOUSE_OUT', (r, outcome, actor) => this.onWarehouseOut(r.documentId, outcome, actor?.id ?? null), 'TransferDoc');
    for (const t of ['CONSIGNMENT_CHECK_WH', 'CONSIGNMENT_CHECK_BRANCH'] as ApprovalType[]) this.approvals.register(t, (r, outcome, actor) => this.onWarehouseOut(r.documentId, outcome, actor?.id ?? null), 'TransferDoc');
    this.approvals.register('WAREHOUSE_IN', (r, outcome, actor) => this.onWarehouseIn(r.documentId, outcome, actor?.id ?? null), 'TransferDoc');
    // e-commerce pull-out: the In-Charge is the only approver; the e-commerce module then marks the orders shipped
    this.approvals.register('ECOM_PULLOUT', async (r, outcome, actor) => { await this.onDecision(r.documentId, outcome, actor?.id ?? null); for (const h of this.ecomHooks) await h(r.documentId, outcome); });
  }
  private ecomHooks: ((docId: string, outcome: 'APPROVED' | 'REJECTED') => Promise<void>)[] = [];
  private discrepancyHooks: ((docId: string, extras: ExtraItem[], receivedBy: string) => Promise<void>)[] = [];
  /** Called when the receiver got a different quantity than the form (the discrepancy steps start). */
  onDiscrepancy(fn: (docId: string, extras: ExtraItem[], receivedBy: string) => Promise<void>) { this.discrepancyHooks.push(fn); }
  /** Called after an e-commerce pull-out is approved or rejected (the e-commerce module updates its orders). */
  onEcomPulloutDecided(fn: (docId: string, outcome: 'APPROVED' | 'REJECTED') => Promise<void>) { this.ecomHooks.push(fn); }

  static readonly INCLUDE = { fromLocation: { select: { id: true, code: true, name: true, type: true } }, toLocation: { select: { id: true, code: true, name: true, type: true } }, lines: { include: { product: { select: { id: true, sku: true, name: true, category: { select: { accountingClass: true } } } }, batch: { select: { id: true, batchNo: true, expiryDate: true, unitCost: true, isConsignmentIn: true } } } } } as const;

  async list(user: SessionUser, q: { direction?: 'out' | 'in'; status?: string; locationId?: string; branchIds?: string[]; from?: string; to?: string }) {
    const scope = user.locationScoped ? user.locationIds : null;
    const where: Prisma.TransferDocWhereInput = { status: q.status as never, docDate: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined };
    if (q.locationId && user.locationScoped && !user.locationIds.includes(q.locationId)) throw new ForbiddenException('Location outside your assignment');
    const ticked = q.branchIds?.length ? q.branchIds : null;
    // Branches ticked on the list (owner request 2026-09-29): an unscoped user reads "out"/"in" from the ticked branches' side;
    // a branch user keeps their own side and the ticks pick the other branch.
    const loc = q.locationId ? [q.locationId] : scope ?? ticked;
    const and: Prisma.TransferDocWhereInput[] = [];
    if (q.direction === 'out') and.push({ fromLocationId: loc ? { in: loc } : { not: '' } });
    else if (q.direction === 'in') and.push({ toLocationId: loc ? { in: loc } : { not: '' } });
    else if (loc) and.push({ OR: [{ fromLocationId: { in: loc } }, { toLocationId: { in: loc } }] });
    if (ticked && loc !== ticked) and.push({ OR: [{ fromLocationId: { in: ticked } }, { toLocationId: { in: ticked } }] });
    if (and.length) where.AND = and;
    const rows = await this.prisma.db.transferDoc.findMany({ where, include: TransfersService.INCLUDE, orderBy: { createdAt: 'desc' }, take: 300 });
    // a draft belongs to the sending side; the receiving location gets its copy once it is submitted
    return rows.filter((d) => d.status !== 'DRAFT' || TransfersService.isSenderSide(user, d));
  }

  /** Sending side = users of the from-location (or unscoped users), plus whoever created the document (e.g. a branch requesting stock). */
  static isSenderSide(user: SessionUser, doc: { fromLocationId: string; createdBy: string | null; preparedBy?: string | null }) {
    return !user.locationScoped || user.locationIds.includes(doc.fromLocationId) || doc.createdBy === user.id || doc.preparedBy === user.id;
  }
  async get(id: string, user: SessionUser) {
    const doc = await this.prisma.db.transferDoc.findUnique({ where: { id }, include: TransfersService.INCLUDE });
    if (!doc) throw new NotFoundException();
    if (user.locationScoped && !user.locationIds.includes(doc.fromLocationId) && !user.locationIds.includes(doc.toLocationId)) throw new ForbiddenException();
    if (doc.status === 'DRAFT' && !TransfersService.isSenderSide(user, doc)) throw new NotFoundException('This transfer has not been sent yet');
    const people = await this.prisma.db.user.findMany({ where: { id: { in: [doc.preparedBy, doc.receivedBy].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    return { ...doc, preparedByName: people.find((p) => p.id === doc.preparedBy)?.fullName ?? null, receivedByName: people.find((p) => p.id === doc.receivedBy)?.fullName ?? null };
  }

  async create(input: TransferInput, user: SessionUser) {
    const from = input.fromLocationId ?? (user.locationIds.length === 1 ? user.locationIds[0] : null);
    if (!from) throw new BadRequestException('fromLocationId is required');
    const fromLoc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: from } });
    const toLoc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: input.toLocationId } });
    if (from === input.toLocationId) throw new BadRequestException('From and To must differ');
    this.assertRoute(user, fromLoc, toLoc, input.transferType);
    if (!input.lines.length) throw new BadRequestException('At least one line is required');
    const doc = await this.prisma.db.$transaction(async (tx) => {
      const controlNo = await this.seq.form(tx, 'PO', from);
      const transferInNo = await this.seq.form(tx, 'TI', toLoc.id);
      const lines = await this.buildLines(tx, fromLoc, input.transferType, input.lines);
      return tx.transferDoc.create({ data: { controlNo, transferInNo, docDate: input.docDate ? toDateOnly(input.docDate) : todayManila(), fromLocationId: from, toLocationId: toLoc.id, transferType: input.transferType, returnReason: input.returnReason, notes: input.notes, preparedBy: user.id, createdBy: user.id, lines: { create: lines } }, include: TransfersService.INCLUDE });
    });
    await this.audit.log({ action: 'CREATE', entityType: 'TransferDoc', entityId: doc.id, after: doc });
    return doc;
  }

  /** Who may send what where (§7.3): location-scoped users send from their own location, or request from the warehouse to their own location. */
  assertRoute(user: SessionUser, fromLoc: { id: string; type: string }, toLoc: { id: string; type: string; code?: string }, transferType: string) {
    if (fromLoc.id === toLoc.id) throw new BadRequestException('From and To must differ');
    // Forms are prepared by the sending location only (owner rule): a branch receiving stock just gets the copy; to ask for stock it sends a Stock Request
    // goods coming back from a consignee are recorded by the branch / warehouse that takes them back
    const consigneeReturn = transferType === 'CONSIGNMENT_RETURN' && fromLoc.type === 'CONSIGNEE' && user.locationIds.includes(toLoc.id);
    if (transferType === 'CONSIGNMENT_RETURN' && fromLoc.type !== 'CONSIGNEE') throw new BadRequestException('A consignment return comes from a consignee');
    if (user.locationScoped && !user.locationIds.includes(fromLoc.id) && !consigneeReturn) throw new ForbiddenException('Transfer forms are prepared by the sending location. To get stock, send a Stock Request to the warehouse.');
    if (transferType === 'CONSIGNMENT_OUT' && toLoc.type !== 'CONSIGNEE') throw new BadRequestException('Consignment out must target a CONSIGNEE location');
    if ((transferType === 'ECOMMERCE') !== ('code' in toLoc && String(toLoc.code).startsWith('ECOM-'))) throw new BadRequestException('E-commerce pull-outs go from the Warehouse to an e-commerce platform, and are made from the E-commerce page');
    if (transferType === 'ECOMMERCE' && fromLoc.type !== 'WAREHOUSE') throw new BadRequestException('E-commerce items come from the Warehouse only');
  }

  /** FEFO-picked lines (or the newest batch for customer returns). No stock moves until approval. */
  async buildLines(tx: Tx, fromLoc: { id: string; code: string }, transferType: string, input: TransferLineInput[]) {
    const customerReturns = transferType === 'RETURN' && fromLoc.code === VIRTUAL_CODES.CUSTOMER_RETURNS;
    const lines: Prisma.TransferLineUncheckedCreateWithoutDocInput[] = [];
    for (const l of input) {
      if (l.qty <= 0) throw new BadRequestException('Qty must be positive');
      if (customerReturns) {
        // returned goods from customers: receive into branch under the batch given (or the newest batch of that product)
        const batchId = l.batchId ?? (await tx.batch.findFirst({ where: { productId: l.productId }, orderBy: { createdAt: 'desc' } }))?.id;
        if (!batchId) throw new BadRequestException('No batch known for returned product; receive it first');
        lines.push({ productId: l.productId, batchId, qtySent: l.qty, checkerRemarks: l.checkerRemarks });
        continue;
      }
      const picks = await this.stock.pickFefo(tx, fromLoc.id, l.productId, l.qty, { preferBatchId: l.batchId ?? undefined, allowExpired: transferType === 'RETURN' });
      for (const p of picks) lines.push({ productId: l.productId, batchId: p.batchId, qtySent: p.qty, checkerRemarks: l.checkerRemarks });
    }
    return lines;
  }

  /** Branch asks the warehouse for stock (no form is made by the receiving branch); the warehouse prepares the Pull-Out / Transfer-In. */
  async requestStock(input: { locationId?: string; items: { productId: string; qty: number }[]; notes?: string }, user: SessionUser) {
    const locationId = input.locationId ?? user.locationIds[0];
    if (!locationId) throw new BadRequestException('locationId required');
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    const products = await this.prisma.db.product.findMany({ where: { id: { in: input.items.map((i) => i.productId) } }, select: { id: true, name: true } });
    const list = input.items.map((i) => `${i.qty}× ${products.find((p) => p.id === i.productId)?.name ?? i.productId}`).join(', ');
    await this.notify.toRoles(['WAREHOUSE_IN_CHARGE', 'WAREHOUSE_ASSOCIATE'], { type: 'STOCK_REQUEST', title: `Stock request from ${loc.name} (${user.fullName})`, body: `${list}${input.notes ? ` — ${input.notes}` : ''}`, link: `/transfers?to=${loc.id}` });
    await this.audit.log({ action: 'STOCK_REQUEST', entityType: 'Location', entityId: loc.id, after: { items: input.items, notes: input.notes } });
    return { ok: true, sentTo: 'Warehouse', items: list };
  }

  /** Snapshot for edit proposals: header + qty per product (batches are re-picked FEFO on apply). */
  async editSnapshot(id: string) {
    const d = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id }, include: TransfersService.INCLUDE });
    const perProduct = new Map<string, { productId: string; product: string; qty: number }>();
    for (const l of d.lines) { const cur = perProduct.get(l.productId) ?? { productId: l.productId, product: l.product.name, qty: 0 }; cur.qty += l.qtySent; perProduct.set(l.productId, cur); }
    return { id: d.id, controlNo: d.controlNo, status: d.status, locationId: d.fromLocationId, locationName: `${d.fromLocation.name} → ${d.toLocation.name}`, createdBy: d.createdBy ?? d.preparedBy, fromLocationId: d.fromLocationId, header: { to: d.toLocation.name, toLocationId: d.toLocationId, transferType: d.transferType, returnReason: d.returnReason ?? '', docDate: dateStr(d.docDate), notes: d.notes ?? '' }, lines: [...perProduct.values()] };
  }

  /**
   * Replace destination / type / notes / lines of a DRAFT or SUBMITTED transfer (drafts are editable before submission; In-Charge edits
   * apply after the preparer accepts). A submitted transfer's pending approval is cancelled and it is resubmitted in the preparer's name.
   */
  async applyEdit(id: string, input: TransferEditInput, actorId: string, editor: SessionUser | null) {
    const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id }, include: TransfersService.INCLUDE });
    if (!['DRAFT', 'SUBMITTED'].includes(doc.status)) throw new BadRequestException(`A ${doc.status} transfer can no longer be edited`);
    if (!input.lines.length) throw new BadRequestException('At least one line is required');
    const toLoc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: input.toLocationId ?? doc.toLocationId } });
    const transferType = (input.transferType ?? doc.transferType) as TransferType;
    if (editor) this.assertRoute(editor, doc.fromLocation, toLoc, transferType);
    else if (doc.fromLocationId === toLoc.id) throw new BadRequestException('From and To must differ');
    const wasSubmitted = doc.status === 'SUBMITTED';
    if (wasSubmitted) await this.approvals.cancelForDocument('TransferDoc', id);
    await this.prisma.db.$transaction(async (tx) => {
      const lines = await this.buildLines(tx, doc.fromLocation, transferType, input.lines);
      await tx.transferLine.deleteMany({ where: { docId: id } });
      const transferInNo = toLoc.id !== doc.toLocationId ? await this.seq.form(tx, 'TI', toLoc.id) : undefined;
      await tx.transferDoc.update({ where: { id }, data: { transferInNo, toLocationId: toLoc.id, transferType, returnReason: input.returnReason === undefined ? undefined : input.returnReason, notes: input.notes === undefined ? undefined : input.notes, docDate: input.docDate ? toDateOnly(input.docDate) : undefined, status: 'DRAFT', approvalRequestId: null, updatedBy: actorId, lines: { create: lines } } });
    });
    // the edit came from the In-Charge (or Admin) and the preparer accepted it: no second In-Charge approval
    if (wasSubmitted) await this.submitDoc(id, doc.preparedBy ?? doc.createdBy ?? actorId, true);
  }

  async submit(id: string, user: SessionUser) {
    const doc = await this.get(id, user);
    if (!TransfersService.isSenderSide(user, doc)) throw new ForbiddenException('Only the sending location submits this transfer');
    if (user.locationScoped && doc.preparedBy !== user.id) throw new ForbiddenException(`Only ${doc.preparedByName ?? 'the person who prepared it'} can submit this draft; propose an edit instead`);
    await this.submitDoc(id, user.id);
    return this.get(id, user);
  }
  private async submitDoc(id: string, requestedBy: string, skipInCharge = false) {
    const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id }, include: TransfersService.INCLUDE });
    if (doc.status !== 'DRAFT') throw new BadRequestException('Only drafts can be submitted');
    if (!doc.lines.length) throw new BadRequestException('Add at least one item');
    // goods leaving the warehouse on a Warehouse Associate's pull-out need the In-Charge first
    const preparer = await this.prisma.db.user.findUnique({ where: { id: doc.preparedBy ?? requestedBy }, select: { role: { select: { key: true } } } });
    if (!skipInCharge && doc.fromLocation.type === 'WAREHOUSE' && preparer?.role.key === 'WAREHOUSE_ASSOCIATE') {
      const req = await this.approvals.request({ type: 'WAREHOUSE_OUT', documentType: 'TransferDoc', documentId: id, requestedBy, summary: { controlNo: doc.controlNo, locationId: doc.fromLocationId, locationName: `${doc.fromLocation.name} → ${doc.toLocation.name}`, transferType: doc.transferType, lines: doc.lines.length, units: doc.lines.reduce((t, l) => t + l.qtySent, 0), step: 'In-Charge checks the goods going out; then the auditors (or Admin for a franchise) approve', nextSteps: [doc.toLocation.type === 'FRANCHISE' ? 'Admin approval' : 'Head Auditor or Asst Auditor approval'] } });
      await this.prisma.db.transferDoc.update({ where: { id }, data: { status: 'SUBMITTED', approvalRequestId: req.id, updatedBy: requestedBy } });
      return;
    }
    // consignments prepared by an associate: their manager checks first (Head / Asst Auditor for branches, In-Charge for the warehouse), the Owner approves last
    const consign = doc.transferType === 'CONSIGNMENT_OUT' || doc.transferType === 'CONSIGNMENT_RETURN';
    const check: ApprovalType | null = !consign ? null : preparer?.role.key === 'SALES_ASSOCIATE' ? 'CONSIGNMENT_CHECK_BRANCH' : preparer?.role.key === 'WAREHOUSE_ASSOCIATE' ? 'CONSIGNMENT_CHECK_WH' : null;
    if (check && !skipInCharge) {
      const req = await this.approvals.request({ type: check, documentType: 'TransferDoc', documentId: id, requestedBy, summary: { controlNo: doc.controlNo, locationId: doc.fromLocationId, locationName: `${doc.fromLocation.name} → ${doc.toLocation.name}`, lines: doc.lines.length, units: doc.lines.reduce((t, l) => t + l.qtySent, 0), step: 'Manager check, then the Owner approves' } });
      await this.prisma.db.transferDoc.update({ where: { id }, data: { status: 'SUBMITTED', approvalRequestId: req.id, updatedBy: requestedBy } });
      return;
    }
    await this.requestRouteApproval(id, requestedBy);
  }

  private async onWarehouseOut(docId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id: docId } });
      if (doc.status !== 'SUBMITTED') return;
      if (outcome === 'REJECTED') { await this.prisma.db.transferDoc.update({ where: { id: docId }, data: { status: 'REJECTED' } }); return; }
      void actorId;
      await this.requestRouteApproval(docId, doc.preparedBy ?? doc.createdBy ?? '', true);
    });
  }

  /** The usual approval for a submitted transfer (auditors, or Admin for a franchise / consignment). */
  private async requestRouteApproval(id: string, requestedBy: string, afterInCharge = false) {
    const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id }, include: TransfersService.INCLUDE });
    if (doc.status !== (afterInCharge ? 'SUBMITTED' : 'DRAFT')) throw new BadRequestException('Only drafts can be submitted');
    const type: ApprovalType = doc.transferType === 'ECOMMERCE' ? 'ECOM_PULLOUT' : doc.transferType === 'CONSIGNMENT_OUT' || doc.transferType === 'CONSIGNMENT_RETURN' ? 'CONSIGNMENT_OUT' : doc.toLocation.type === 'FRANCHISE' ? 'TRANSFER_TO_FRANCHISE' : 'TRANSFER_INTERNAL';
    const totalAtCost = sum(doc.lines.map((l) => l.batch.unitCost.mul(l.qtySent)));
    // Optional auto-approve thresholds (§6.1), default off
    const maxInternal = await this.settings.get<number | null>('approval.transfer_internal_auto_max');
    const maxFranchise = await this.settings.get<number | null>('approval.transfer_franchise_auto_max');
    const autoOk = (type === 'TRANSFER_INTERNAL' && maxInternal != null && totalAtCost.lte(maxInternal) && doc.fromLocation.type === 'WAREHOUSE' && doc.transferType === 'RESTOCK')
      || (type === 'TRANSFER_TO_FRANCHISE' && maxFranchise != null && totalAtCost.lte(maxFranchise));
    // Customer returns need no approval: they only add stock at the branch (mirrors LEDGER4)
    const customerReturn = doc.transferType === 'RETURN' && doc.fromLocation.code === VIRTUAL_CODES.CUSTOMER_RETURNS;
    const req = await this.approvals.request({ type, documentType: 'TransferDoc', documentId: id, requestedBy, autoApproveAt: autoOk || customerReturn ? new Date() : null, summary: { controlNo: doc.controlNo, locationId: doc.fromLocationId, locationName: `${doc.fromLocation.name} → ${doc.toLocation.name}`, transferType: doc.transferType, lines: doc.lines.length, totalAtCost: totalAtCost.toFixed(2) } });
    await this.prisma.db.transferDoc.update({ where: { id }, data: { status: 'SUBMITTED', approvalRequestId: req.id, updatedBy: requestedBy } });
    if (autoOk || customerReturn) await this.approvals.runAutoApprovals();
  }

  /** On approval: TRANSFER_OUT from sender → IN_TRANSIT. Consignment out / customer returns are received immediately. */
  private async onDecision(docId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id: docId }, include: TransfersService.INCLUDE });
      if (doc.status !== 'SUBMITTED') return;
      if (outcome === 'REJECTED') { await this.prisma.db.transferDoc.update({ where: { id: docId }, data: { status: 'REJECTED' } }); return; }
      const transit = await this.stock.locationByCode(null, VIRTUAL_CODES.IN_TRANSIT);
      const customerReturn = doc.transferType === 'RETURN' && doc.fromLocation.code === VIRTUAL_CODES.CUSTOMER_RETURNS;
      await this.prisma.db.$transaction(async (tx) => {
        if (customerReturn) {
          await this.stock.post(tx, doc.lines.map((l) => ({ locationId: doc.toLocationId, productId: l.productId, batchId: l.batchId, qtyDelta: l.qtySent, movementType: 'SALE_RETURN' as const, documentType: 'TransferDoc', documentId: doc.id, unitCost: l.batch.unitCost, businessDate: doc.docDate, createdBy: actorId ?? undefined })));
          for (const l of doc.lines) await tx.transferLine.update({ where: { id: l.id }, data: { qtyReceived: l.qtySent } });
          await tx.transferDoc.update({ where: { id: docId }, data: { status: 'RECEIVED', approvedAt: new Date(), receivedAt: new Date(), receivedBy: actorId } });
          return;
        }
        const out = doc.lines.map((l) => ({ productId: l.productId, batchId: l.batchId, unitCost: l.batch.unitCost, qty: l.qtySent }));
        const isConsign = doc.transferType === 'CONSIGNMENT_OUT';
        // e-commerce: the goods go straight to the platform's "with courier" holding place (still the Warehouse's inventory in the books until sold)
        const isEcom = doc.transferType === 'ECOMMERCE';
        await this.stock.post(tx, out.flatMap((l) => [
          { locationId: doc.fromLocationId, productId: l.productId, batchId: l.batchId, qtyDelta: -l.qty, movementType: (isConsign ? 'CONSIGN_OUT' : 'TRANSFER_OUT') as never, documentType: 'TransferDoc', documentId: doc.id, unitCost: l.unitCost, businessDate: doc.docDate, createdBy: actorId ?? undefined },
          { locationId: isConsign || isEcom ? doc.toLocationId : transit.id, productId: l.productId, batchId: l.batchId, qtyDelta: l.qty, movementType: (isConsign ? 'CONSIGN_OUT' : isEcom ? 'TRANSFER_IN' : 'TRANSFER_OUT') as never, documentType: 'TransferDoc', documentId: doc.id, unitCost: l.unitCost, businessDate: doc.docDate, createdBy: actorId ?? undefined },
        ]));
        if (isEcom) {
          for (const l of doc.lines) await tx.transferLine.update({ where: { id: l.id }, data: { qtyReceived: l.qtySent } });
          await tx.transferDoc.update({ where: { id: docId }, data: { status: 'RECEIVED', approvedAt: new Date(), receivedAt: new Date(), receivedBy: actorId } });
        } else if (isConsign) {
          for (const l of doc.lines) await tx.transferLine.update({ where: { id: l.id }, data: { qtyReceived: l.qtySent } });
          await tx.transferDoc.update({ where: { id: docId }, data: { status: 'RECEIVED', approvedAt: new Date(), receivedAt: new Date() } });
          await this.posting.post(tx, { type: 'TransferDoc', id: doc.id, date: doc.docDate, createdBy: actorId }, (r) => r8ConsignOut(r, { fromLocationId: doc.fromLocationId, controlNo: doc.controlNo, lines: doc.lines.map((l) => ({ accountingClass: l.product.category.accountingClass, qty: l.qtySent, unitCost: l.batch.unitCost })) }));
        } else {
          await tx.transferDoc.update({ where: { id: docId }, data: { status: 'APPROVED', approvedAt: new Date() } });
        }
      });
      if (!customerReturn && doc.transferType !== 'CONSIGNMENT_OUT' && doc.transferType !== 'ECOMMERCE') await this.notify.toLocation(doc.toLocationId, { type: 'TRANSFER_INCOMING', title: `Incoming transfer ${doc.controlNo} from ${doc.fromLocation.name}`, body: `${doc.lines.length} line(s) to confirm`, link: `/transfers/${doc.id}` });
    });
  }

  /** Receiver confirms per-line qty_received (≤ sent). Match → TRANSFER_IN; shortfall stays IN_TRANSIT pending Head Auditor. */
  /**
   * Receiving location accepts the items line by line: a ticked line means "received exactly as sent"; an unticked line must state the
   * quantity actually received (and a note when short). The UI offers "tick all if correct".
   */
  async confirm(id: string, input: { lineId: string; checked?: boolean; qtyReceived?: number; discrepancyNote?: string }[], user: SessionUser, extras: ExtraItem[] = []) {
    for (const e of extras) if (!Number.isInteger(e.qty) || e.qty <= 0) throw new BadRequestException('The quantity of an extra item must be a whole number above 0');
    const sent = await this.prisma.db.transferLine.findMany({ where: { docId: id }, include: { product: { select: { name: true } } } });
    const received = sent.map((l) => {
      const r = input.find((x) => x.lineId === l.id);
      if (!r || (!r.checked && r.qtyReceived == null)) throw new BadRequestException(`Tick ${l.product.name} if it arrived complete, or enter the quantity actually received`);
      if (!r.checked && r.qtyReceived! < l.qtySent && !r.discrepancyNote?.trim()) throw new BadRequestException(`Add a note for ${l.product.name}: received ${r.qtyReceived} of ${l.qtySent}`);
      return { lineId: l.id, qtyReceived: r.checked ? l.qtySent : r.qtyReceived!, discrepancyNote: r.checked ? undefined : r.discrepancyNote };
    });
    const doc = await this.get(id, user);
    if (doc.status !== 'APPROVED') throw new BadRequestException('Transfer is not awaiting receipt');
    if (user.locationScoped && !user.locationIds.includes(doc.toLocationId)) throw new ForbiddenException('Only the receiving location can confirm');
    for (const r of received) { const l = doc.lines.find((x) => x.id === r.lineId)!; if (r.qtyReceived < 0 || r.qtyReceived > l.qtySent || !Number.isInteger(r.qtyReceived)) throw new BadRequestException(`Received qty for ${l.product.name} must be a whole number from 0 to ${l.qtySent}`); }
    // franchise: the associate receives only if the franchise owner allows it; the owner is told when they do
    if (user.roleKey === 'FRANCHISE_SALES_ASSOCIATE') {
      const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: doc.toLocationId } });
      if (!loc.franchiseAssociateReceives) throw new ForbiddenException('Your franchise owner receives the stock; ask them to confirm this transfer');
    }
    // goods into the warehouse confirmed by a Warehouse Associate wait for the In-Charge (owner request 2026-09-26)
    if (user.roleKey === 'WAREHOUSE_ASSOCIATE' && doc.toLocation.type === 'WAREHOUSE') {
      if (doc.pendingReceipt) throw new BadRequestException('This receipt is already waiting for the Warehouse In-Charge');
      const pending = [...received, ...extras.map((e) => ({ lineId: `extra:${e.productId}`, qtyReceived: e.qty, discrepancyNote: e.note }))];
      await this.prisma.db.transferDoc.update({ where: { id }, data: { pendingReceipt: pending as unknown as Prisma.InputJsonValue, pendingReceiptBy: user.id } });
      await this.approvals.request({ type: 'WAREHOUSE_IN', documentType: 'TransferDoc', documentId: id, requestedBy: user.id, summary: { controlNo: doc.transferInNo ?? doc.controlNo, locationId: doc.toLocationId, locationName: `${doc.fromLocation.name} → ${doc.toLocation.name}`, lines: received.length, units: received.reduce((t, r) => t + r.qtyReceived, 0), short: received.filter((r) => r.qtyReceived < doc.lines.find((l) => l.id === r.lineId)!.qtySent).length, step: 'Warehouse Associate checked the goods in; the In-Charge confirms before stock is added' } });
      await this.audit.log({ action: 'CONFIRM_PENDING', entityType: 'TransferDoc', entityId: id, after: received });
      return this.get(id, user);
    }
    return this.applyReceipt(id, received, user.id, user, extras);
  }

  private async onWarehouseIn(docId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id: docId } });
      if (doc.status !== 'APPROVED' || !doc.pendingReceipt) return;
      const by = doc.pendingReceiptBy!;
      if (outcome === 'REJECTED') {
        await this.prisma.db.transferDoc.update({ where: { id: docId }, data: { pendingReceipt: Prisma.DbNull, pendingReceiptBy: null } });
        await this.notify.toUsers([by], { type: 'WAREHOUSE_IN_REJECTED', title: `The In-Charge did not accept your receipt of ${doc.controlNo}; check the goods and confirm again`, link: `/transfers/${docId}` });
        return;
      }
      void actorId;
      const all = doc.pendingReceipt as unknown as { lineId: string; qtyReceived: number; discrepancyNote?: string }[];
      const extras = all.filter((r) => r.lineId.startsWith('extra:')).map((r) => ({ productId: r.lineId.slice(6), qty: r.qtyReceived, note: r.discrepancyNote }));
      await this.applyReceipt(docId, all.filter((r) => !r.lineId.startsWith('extra:')), by, null, extras);
    });
  }

  /** Stock in-transit → receiver for the confirmed quantities; a shortfall stays in transit for the Head Auditor. */
  private async applyReceipt(id: string, received: { lineId: string; qtyReceived: number; discrepancyNote?: string }[], receivedBy: string, user: SessionUser | null, extras: ExtraItem[] = []) {
    const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id }, include: TransfersService.INCLUDE });
    const transit = await this.stock.locationByCode(null, VIRTUAL_CODES.IN_TRANSIT);
    let shortfall = false;
    const result = await this.prisma.db.$transaction(async (tx) => {
      const posts = [] as Parameters<StockService['post']>[1];
      for (const l of doc.lines) {
        const r = received.find((x) => x.lineId === l.id);
        const qty = r?.qtyReceived ?? 0;
        if (qty < 0 || qty > l.qtySent) throw new BadRequestException(`Received qty for ${l.product.name} must be between 0 and ${l.qtySent} (overage not allowed)`);
        if (qty < l.qtySent) shortfall = true;
        await tx.transferLine.update({ where: { id: l.id }, data: { qtyReceived: qty, discrepancyNote: r?.discrepancyNote ?? (qty < l.qtySent ? 'Short on receipt' : null) } });
        if (qty > 0) posts.push(
          { locationId: transit.id, productId: l.productId, batchId: l.batchId, qtyDelta: -qty, movementType: 'TRANSFER_IN', documentType: 'TransferDoc', documentId: doc.id, unitCost: l.batch.unitCost, createdBy: receivedBy },
          { locationId: doc.toLocationId, productId: l.productId, batchId: l.batchId, qtyDelta: qty, movementType: 'TRANSFER_IN', documentType: 'TransferDoc', documentId: doc.id, unitCost: l.batch.unitCost, createdBy: receivedBy },
        );
      }
      await this.stock.post(tx, posts);
      const updated = await tx.transferDoc.update({ where: { id }, data: { status: shortfall || extras.length ? 'DISCREPANCY' : 'RECEIVED', receivedBy, receivedAt: new Date(), pendingReceipt: Prisma.DbNull, pendingReceiptBy: null }, include: TransfersService.INCLUDE });
      await this.postTransferJournal(tx, updated, receivedBy);
      return updated;
    });
    await this.audit.log({ action: 'CONFIRM', entityType: 'TransferDoc', entityId: id, after: received, userId: receivedBy });
    if (doc.toLocation.type === 'FRANCHISE' && user?.roleKey === 'FRANCHISE_SALES_ASSOCIATE') {
      const owner = await this.prisma.db.location.findUnique({ where: { id: doc.toLocationId }, select: { franchiseOwnerUserId: true } });
      if (owner?.franchiseOwnerUserId) await this.notify.toUsers([owner.franchiseOwnerUserId], { type: 'FRANCHISE_RECEIVED', title: `${user.fullName} received transfer ${doc.transferInNo ?? doc.controlNo} from ${doc.fromLocation.name}${shortfall ? ' (with a shortfall)' : ''}`, link: `/transfers/${id}` });
    }
    // a difference between the form and what arrived starts the discrepancy steps (Head Auditor first; owner request 2026-09-29)
    if (shortfall || extras.length) for (const h of this.discrepancyHooks) await h(id, extras, receivedBy);
    return result;
  }

  /** Head Auditor resolves in-transit shortfall: back to sender, to receiver, or write-off. */
  async resolveShortfall(id: string, resolution: 'TO_SENDER' | 'TO_RECEIVER' | 'WRITEOFF', user: SessionUser) {
    const doc = await this.get(id, user);
    if (doc.status !== 'DISCREPANCY') throw new BadRequestException('No open discrepancy on this transfer');
    if (await this.prisma.db.transferDiscrepancy.findUnique({ where: { transferId: id } })) throw new BadRequestException('This difference follows the discrepancy steps (Head Auditor, sending branch, Owner) on the transfer page');
    const transit = await this.stock.locationByCode(null, VIRTUAL_CODES.IN_TRANSIT);
    await this.prisma.db.$transaction(async (tx) => {
      const posts = [] as Parameters<StockService['post']>[1];
      const shortLines: { accountingClass: string; qty: number; unitCost: Prisma.Decimal }[] = [];
      for (const l of doc.lines) {
        const short = l.qtySent - (l.qtyReceived ?? 0);
        if (short <= 0) continue;
        const target = resolution === 'TO_SENDER' ? doc.fromLocationId : resolution === 'TO_RECEIVER' ? doc.toLocationId : null;
        const type = resolution === 'WRITEOFF' ? 'EXPIRED_WRITEOFF' : resolution === 'TO_SENDER' ? 'RETURN_TO_WAREHOUSE' : 'TRANSFER_IN';
        posts.push({ locationId: transit.id, productId: l.productId, batchId: l.batchId, qtyDelta: -short, movementType: type, documentType: 'TransferDoc', documentId: doc.id, unitCost: l.batch.unitCost, createdBy: user.id });
        if (target) posts.push({ locationId: target, productId: l.productId, batchId: l.batchId, qtyDelta: short, movementType: type, documentType: 'TransferDoc', documentId: doc.id, unitCost: l.batch.unitCost, createdBy: user.id });
        if (resolution === 'TO_RECEIVER') await tx.transferLine.update({ where: { id: l.id }, data: { qtyReceived: l.qtySent, shortfallResolution: resolution } });
        else await tx.transferLine.update({ where: { id: l.id }, data: { shortfallResolution: resolution } });
        shortLines.push({ accountingClass: l.product.category.accountingClass, qty: short, unitCost: l.batch.unitCost });
      }
      await this.stock.post(tx, posts);
      await tx.transferDoc.update({ where: { id }, data: { status: 'RESOLVED' } });
      if (resolution === 'WRITEOFF') await this.posting.post(tx, { type: 'TransferDoc', id: doc.id, date: todayManila(), createdBy: user.id }, (r) => r6Transfer(r, { fromLocationId: doc.fromLocationId, toLocationId: doc.toLocationId, controlNo: `${doc.controlNo} shortfall`, lines: [], shortfall: shortLines }));
      if (resolution === 'TO_RECEIVER') await this.posting.post(tx, { type: 'TransferDoc', id: doc.id, date: todayManila(), createdBy: user.id }, (r) => r6Transfer(r, { fromLocationId: doc.fromLocationId, toLocationId: doc.toLocationId, controlNo: `${doc.controlNo} shortfall to receiver`, lines: shortLines }));
    });
    await this.audit.log({ action: 'RESOLVE_SHORTFALL', entityType: 'TransferDoc', entityId: id, after: { resolution } });
    return this.get(id, user);
  }

  /** R6 (company ↔ company) or R7 (to franchise = sale at FRANCHISE tier) for the received quantities. */
  async postTransferJournal(tx: Tx, doc: Prisma.TransferDocGetPayload<{ include: typeof TransfersService.INCLUDE }>, actorId: string) {
    const recvLines = doc.lines.filter((l) => (l.qtyReceived ?? 0) > 0).map((l) => ({ productId: l.productId, accountingClass: l.product.category.accountingClass, qty: l.qtyReceived!, unitCost: l.batch.unitCost, isConsignmentIn: l.batch.isConsignmentIn, supplierId: null }));
    if (doc.toLocation.type === 'FRANCHISE') {
      let saleTotal = D(0);
      for (const l of recvLines) { const p = await this.master.priceFor(l.productId, 'FRANCHISE', doc.docDate, tx); saleTotal = saleTotal.plus(D(p ?? 0).mul(l.qty)); }
      await this.posting.post(tx, { type: 'TransferDoc', id: doc.id, date: doc.docDate, createdBy: actorId }, (r) => r7FranchiseTransfer(r, { fromLocationId: doc.fromLocationId, franchiseLocationId: doc.toLocationId, controlNo: doc.controlNo, saleTotal, costLines: recvLines }));
    } else if (doc.toLocation.type !== 'VIRTUAL' && doc.fromLocation.type !== 'VIRTUAL') {
      await this.posting.post(tx, { type: 'TransferDoc', id: doc.id, date: doc.docDate, createdBy: actorId }, (r) => r6Transfer(r, { fromLocationId: doc.fromLocationId, toLocationId: doc.toLocationId, controlNo: doc.controlNo, lines: recvLines }));
    }
  }

  async void(id: string, reason: string, user: SessionUser) {
    const doc = await this.get(id, user);
    if (!TransfersService.isSenderSide(user, doc)) throw new ForbiddenException('Only the sending location can void this transfer');
    if (!['DRAFT', 'SUBMITTED', 'REJECTED'].includes(doc.status)) throw new BadRequestException('Only unposted transfers can be voided; use a RETURN transfer instead');
    await this.approvals.cancelForDocument('TransferDoc', id);
    const after = await this.prisma.db.transferDoc.update({ where: { id }, data: { status: 'VOIDED', voidedAt: new Date(), voidedBy: user.id, voidReason: reason } });
    await this.audit.log({ action: 'VOID', entityType: 'TransferDoc', entityId: id, before: doc, after });
    return after;
  }

  // ── Write-offs (§7.6) ──
  /**
   * Expired / damaged / spoiled stock taken out of saleable inventory. `chargeTo` decides who bears it (owner request 2026-09-26):
   * COMPANY = expensed (R9 Expired Items); STAFF = charged to the named employees — on approval a charge form is created with them
   * pre-allocated, HR finalizes it with one click and payroll deducts it. Either way the stock leaves the books on approval.
   */
  async createWriteoff(input: { locationId?: string; docDate?: string; notes?: string; chargeTo?: 'COMPANY' | 'STAFF'; employeeIds?: string[]; lines: { productId: string; batchId: string; qty: number; reason: 'EXPIRED' | 'DAMAGED' | 'SPOILED' }[] }, user: SessionUser) {
    const chargeTo = input.chargeTo ?? 'COMPANY';
    const staff = chargeTo === 'STAFF' ? await this.charges.assertEmployees(input.employeeIds ?? []) : [];
    const locationId = input.locationId ?? user.locationIds[0];
    if (!locationId) throw new BadRequestException('locationId required');
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    const doc = await this.prisma.db.$transaction(async (tx) => {
      for (const l of input.lines) { const bal = await tx.stockBalance.findUnique({ where: { locationId_productId_batchId: { locationId, productId: l.productId, batchId: l.batchId } } }); if (!bal || bal.qty < l.qty) throw new BadRequestException('Write-off qty exceeds on-hand for batch'); }
      const controlNo = await this.seq.form(tx, 'WO', locationId);
      return tx.expiryWriteoffDoc.create({ data: { controlNo, docDate: input.docDate ? toDateOnly(input.docDate) : todayManila(), locationId, notes: input.notes, chargeTo, chargeEmployeeIds: staff.map((e) => e.id), preparedBy: user.id, createdBy: user.id, status: 'SUBMITTED', lines: { create: input.lines } }, include: { lines: { include: { product: { select: { name: true, sku: true } }, batch: true } } } });
    });
    const req = await this.approvals.request({ type: 'WRITEOFF', documentType: 'ExpiryWriteoffDoc', documentId: doc.id, requestedBy: user.id, summary: { controlNo: doc.controlNo, locationId, locationName: loc.name, lines: doc.lines.map((l) => ({ product: l.product.name, batch: l.batch.batchNo ?? '', qty: l.qty, reason: l.reason })), chargeTo: chargeTo === 'STAFF' ? `Charge to staff: ${staff.map((e) => e.fullName).join(', ')}` : 'Company expense' } });
    await this.prisma.db.expiryWriteoffDoc.update({ where: { id: doc.id }, data: { approvalRequestId: req.id } });
    return doc;
  }
  /** Before approval the Head Auditor (or Admin) can change who bears the loss. */
  async setWriteoffCharge(id: string, chargeTo: 'COMPANY' | 'STAFF', employeeIds: string[], user: SessionUser) {
    const doc = await this.prisma.db.expiryWriteoffDoc.findUniqueOrThrow({ where: { id } });
    if (doc.status !== 'SUBMITTED') throw new BadRequestException('Only a write-off awaiting approval can be changed');
    if (user.locationScoped && !user.locationIds.includes(doc.locationId)) throw new ForbiddenException();
    const staff = chargeTo === 'STAFF' ? await this.charges.assertEmployees(employeeIds) : [];
    const after = await this.prisma.db.expiryWriteoffDoc.update({ where: { id }, data: { chargeTo, chargeEmployeeIds: staff.map((e) => e.id) } });
    if (doc.approvalRequestId) { const req = await this.prisma.db.approvalRequest.findUnique({ where: { id: doc.approvalRequestId } }); if (req) await this.prisma.db.approvalRequest.update({ where: { id: req.id }, data: { summary: { ...(req.summary as object), chargeTo: chargeTo === 'STAFF' ? `Charge to staff: ${staff.map((e) => e.fullName).join(', ')}` : 'Company expense' } } }); }
    await this.audit.log({ action: 'SET_CHARGE_TO', entityType: 'ExpiryWriteoffDoc', entityId: id, before: { chargeTo: doc.chargeTo, employees: doc.chargeEmployeeIds }, after: { chargeTo, employees: staff.map((e) => e.fullName) } });
    return after;
  }
  listWriteoffs(user: SessionUser) { return this.prisma.db.expiryWriteoffDoc.findMany({ where: { locationId: user.locationScoped ? { in: user.locationIds } : { not: '' } }, include: { location: { select: { code: true, name: true } }, lines: { include: { product: { select: { name: true, sku: true } }, batch: { select: { batchNo: true, expiryDate: true, unitCost: true } } } } }, orderBy: { createdAt: 'desc' } }); }
  private async onWriteoffDecision(docId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const doc = await this.prisma.db.expiryWriteoffDoc.findUniqueOrThrow({ where: { id: docId }, include: { lines: { include: { batch: true, product: { include: { category: true } } } } } });
      if (doc.status !== 'SUBMITTED') return;
      if (outcome === 'REJECTED') { await this.prisma.db.expiryWriteoffDoc.update({ where: { id: docId }, data: { status: 'REJECTED' } }); return; }
      let chargeFormId: string | null = null;
      await this.prisma.db.$transaction(async (tx) => {
        await this.stock.post(tx, doc.lines.map((l) => ({ locationId: doc.locationId, productId: l.productId, batchId: l.batchId, qtyDelta: -l.qty, movementType: 'EXPIRED_WRITEOFF' as const, documentType: 'ExpiryWriteoffDoc', documentId: doc.id, unitCost: l.batch.unitCost, businessDate: doc.docDate, createdBy: actorId ?? undefined })));
        if (doc.chargeTo === 'STAFF' && doc.chargeEmployeeIds.length) {
          // charged to staff: no expense now; the charge form (franchise-tier price, batch cost kept for R11) goes to HR
          const lines = [];
          for (const l of doc.lines) lines.push({ productId: l.productId, qty: l.qty, unitCharge: (await this.master.priceFor(l.productId, 'FRANCHISE', doc.docDate, tx)) ?? l.batch.unitCost, batchCost: l.batch.unitCost, description: `${l.reason.toLowerCase()} · batch ${l.batch.batchNo ?? '—'}` });
          const kind = doc.lines.every((l) => l.reason === 'EXPIRED') ? 'EXPIRED' : 'DAMAGED';
          const cf = await this.charges.create(tx, { kind, locationId: doc.locationId, sourceType: 'ExpiryWriteoffDoc', sourceId: doc.id, reason: `Write-off ${doc.controlNo}`, lines, employeeIds: doc.chargeEmployeeIds, createdBy: actorId });
          chargeFormId = cf.id;
          await tx.expiryWriteoffDoc.update({ where: { id: docId }, data: { status: 'POSTED', postedAt: new Date(), chargeFormId: cf.id } });
          return;
        }
        await tx.expiryWriteoffDoc.update({ where: { id: docId }, data: { status: 'POSTED', postedAt: new Date() } });
        await this.posting.post(tx, { type: 'ExpiryWriteoffDoc', id: doc.id, date: doc.docDate, createdBy: actorId }, (r) => r9Writeoff(r, { locationId: doc.locationId, controlNo: doc.controlNo, lines: doc.lines.map((l) => ({ accountingClass: l.product.category.accountingClass, qty: l.qty, unitCost: l.batch.unitCost })) }));
      });
      if (chargeFormId) await this.charges.announce(chargeFormId);
    });
  }
}
