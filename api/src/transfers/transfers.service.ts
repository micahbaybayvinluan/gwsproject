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
import { PostingService } from '../gl/posting.service';
import { r6Transfer, r7FranchiseTransfer, r8ConsignOut, r9Writeoff } from '../gl/posting-rules';
import { dateStr, toDateOnly, todayManila } from '../common/manila';
import { D, sum } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import type { ApprovalType } from '../common/permissions';

export interface TransferLineInput { productId: string; qty: number; batchId?: string | null; checkerRemarks?: string }
export interface TransferEditInput { toLocationId?: string; transferType?: TransferType; returnReason?: string | null; docDate?: string; notes?: string | null; lines: TransferLineInput[] }
export interface TransferInput { fromLocationId?: string; toLocationId: string; transferType: TransferType; returnReason?: string; docDate?: string; notes?: string; lines: TransferLineInput[] }

/** §7.3 Transfers: one document, two views (Pull-Out for sender, Transfer-In for receiver). In-transit until receiver confirms. */
@Injectable()
export class TransfersService implements OnModuleInit {
  constructor(private prisma: PrismaService, private seq: SequenceService, private stock: StockService, private approvals: ApprovalsService, private notify: NotificationsService, private audit: AuditService, private settings: SettingsService, private master: MasterService, private posting: PostingService) {}

  onModuleInit() {
    for (const t of ['TRANSFER_INTERNAL', 'TRANSFER_TO_FRANCHISE', 'CONSIGNMENT_OUT'] as ApprovalType[]) this.approvals.register(t, (req, outcome, actor) => this.onDecision(req.documentId, outcome, actor?.id ?? null));
    this.approvals.register('WRITEOFF', (r, outcome, actor) => this.onWriteoffDecision(r.documentId, outcome, actor?.id ?? null));
  }

  private static readonly INCLUDE = { fromLocation: { select: { id: true, code: true, name: true, type: true } }, toLocation: { select: { id: true, code: true, name: true, type: true } }, lines: { include: { product: { select: { id: true, sku: true, name: true, category: { select: { accountingClass: true } } } }, batch: { select: { id: true, batchNo: true, expiryDate: true, unitCost: true, isConsignmentIn: true } } } } } as const;

  async list(user: SessionUser, q: { direction?: 'out' | 'in'; status?: string; locationId?: string; from?: string; to?: string }) {
    const scope = user.locationScoped ? user.locationIds : null;
    const where: Prisma.TransferDocWhereInput = { status: q.status as never, docDate: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined };
    if (q.locationId && user.locationScoped && !user.locationIds.includes(q.locationId)) throw new ForbiddenException('Location outside your assignment');
    const loc = q.locationId ? [q.locationId] : scope;
    if (q.direction === 'out') where.fromLocationId = loc ? { in: loc } : { not: '' };
    else if (q.direction === 'in') where.toLocationId = loc ? { in: loc } : { not: '' };
    else where.OR = loc ? [{ fromLocationId: { in: loc } }, { toLocationId: { in: loc } }] : [{ fromLocationId: { not: '' } }];
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
      const controlNo = await this.seq.next(tx, 'PO', { locationId: from, locationCode: fromLoc.code, prefix: input.transferType === 'RETURN' ? 'RET' : input.transferType === 'CONSIGNMENT_OUT' ? 'CSG' : 'PO' });
      const lines = await this.buildLines(tx, fromLoc, input.transferType, input.lines);
      return tx.transferDoc.create({ data: { controlNo, docDate: input.docDate ? toDateOnly(input.docDate) : todayManila(), fromLocationId: from, toLocationId: toLoc.id, transferType: input.transferType, returnReason: input.returnReason, notes: input.notes, preparedBy: user.id, createdBy: user.id, lines: { create: lines } }, include: TransfersService.INCLUDE });
    });
    await this.audit.log({ action: 'CREATE', entityType: 'TransferDoc', entityId: doc.id, after: doc });
    return doc;
  }

  /** Who may send what where (§7.3): location-scoped users send from their own location, or request from the warehouse to their own location. */
  assertRoute(user: SessionUser, fromLoc: { id: string; type: string }, toLoc: { id: string; type: string }, transferType: string) {
    if (fromLoc.id === toLoc.id) throw new BadRequestException('From and To must differ');
    const isRequest = user.locationScoped && !user.locationIds.includes(fromLoc.id);
    if (isRequest && !(fromLoc.type === 'WAREHOUSE' && user.locationIds.includes(toLoc.id))) throw new ForbiddenException('You may only send from your branch or request from the warehouse');
    if (transferType === 'CONSIGNMENT_OUT' && toLoc.type !== 'CONSIGNEE') throw new BadRequestException('Consignment out must target a CONSIGNEE location');
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
      await tx.transferDoc.update({ where: { id }, data: { toLocationId: toLoc.id, transferType, returnReason: input.returnReason === undefined ? undefined : input.returnReason, notes: input.notes === undefined ? undefined : input.notes, docDate: input.docDate ? toDateOnly(input.docDate) : undefined, status: 'DRAFT', approvalRequestId: null, updatedBy: actorId, lines: { create: lines } } });
    });
    if (wasSubmitted) await this.submitDoc(id, doc.preparedBy ?? doc.createdBy ?? actorId);
  }

  async submit(id: string, user: SessionUser) {
    const doc = await this.get(id, user);
    if (!TransfersService.isSenderSide(user, doc)) throw new ForbiddenException('Only the sending location submits this transfer');
    if (user.locationScoped && doc.preparedBy !== user.id) throw new ForbiddenException(`Only ${doc.preparedByName ?? 'the person who prepared it'} can submit this draft; propose an edit instead`);
    await this.submitDoc(id, user.id);
    return this.get(id, user);
  }
  private async submitDoc(id: string, requestedBy: string) {
    const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id }, include: TransfersService.INCLUDE });
    if (doc.status !== 'DRAFT') throw new BadRequestException('Only drafts can be submitted');
    const type: ApprovalType = doc.transferType === 'CONSIGNMENT_OUT' ? 'CONSIGNMENT_OUT' : doc.toLocation.type === 'FRANCHISE' ? 'TRANSFER_TO_FRANCHISE' : 'TRANSFER_INTERNAL';
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
        await this.stock.post(tx, out.flatMap((l) => [
          { locationId: doc.fromLocationId, productId: l.productId, batchId: l.batchId, qtyDelta: -l.qty, movementType: (isConsign ? 'CONSIGN_OUT' : 'TRANSFER_OUT') as never, documentType: 'TransferDoc', documentId: doc.id, unitCost: l.unitCost, businessDate: doc.docDate, createdBy: actorId ?? undefined },
          { locationId: isConsign ? doc.toLocationId : transit.id, productId: l.productId, batchId: l.batchId, qtyDelta: l.qty, movementType: (isConsign ? 'CONSIGN_OUT' : 'TRANSFER_OUT') as never, documentType: 'TransferDoc', documentId: doc.id, unitCost: l.unitCost, businessDate: doc.docDate, createdBy: actorId ?? undefined },
        ]));
        if (isConsign) {
          for (const l of doc.lines) await tx.transferLine.update({ where: { id: l.id }, data: { qtyReceived: l.qtySent } });
          await tx.transferDoc.update({ where: { id: docId }, data: { status: 'RECEIVED', approvedAt: new Date(), receivedAt: new Date() } });
          await this.posting.post(tx, { type: 'TransferDoc', id: doc.id, date: doc.docDate, createdBy: actorId }, (r) => r8ConsignOut(r, { fromLocationId: doc.fromLocationId, controlNo: doc.controlNo, lines: doc.lines.map((l) => ({ accountingClass: l.product.category.accountingClass, qty: l.qtySent, unitCost: l.batch.unitCost })) }));
        } else {
          await tx.transferDoc.update({ where: { id: docId }, data: { status: 'APPROVED', approvedAt: new Date() } });
        }
      });
      if (!customerReturn && doc.transferType !== 'CONSIGNMENT_OUT') await this.notify.toLocation(doc.toLocationId, { type: 'TRANSFER_INCOMING', title: `Incoming transfer ${doc.controlNo} from ${doc.fromLocation.name}`, body: `${doc.lines.length} line(s) to confirm`, link: `/transfers/${doc.id}` });
    });
  }

  /** Receiver confirms per-line qty_received (≤ sent). Match → TRANSFER_IN; shortfall stays IN_TRANSIT pending Head Auditor. */
  /**
   * Receiving location accepts the items line by line: a ticked line means "received exactly as sent"; an unticked line must state the
   * quantity actually received (and a note when short). The UI offers "tick all if correct".
   */
  async confirm(id: string, input: { lineId: string; checked?: boolean; qtyReceived?: number; discrepancyNote?: string }[], user: SessionUser) {
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
          { locationId: transit.id, productId: l.productId, batchId: l.batchId, qtyDelta: -qty, movementType: 'TRANSFER_IN', documentType: 'TransferDoc', documentId: doc.id, unitCost: l.batch.unitCost, createdBy: user.id },
          { locationId: doc.toLocationId, productId: l.productId, batchId: l.batchId, qtyDelta: qty, movementType: 'TRANSFER_IN', documentType: 'TransferDoc', documentId: doc.id, unitCost: l.batch.unitCost, createdBy: user.id },
        );
      }
      await this.stock.post(tx, posts);
      const updated = await tx.transferDoc.update({ where: { id }, data: { status: shortfall ? 'DISCREPANCY' : 'RECEIVED', receivedBy: user.id, receivedAt: new Date() }, include: TransfersService.INCLUDE });
      await this.postTransferJournal(tx, updated, user.id);
      return updated;
    });
    await this.audit.log({ action: 'CONFIRM', entityType: 'TransferDoc', entityId: id, after: received });
    if (shortfall) {
      await this.notify.toUsers([doc.preparedBy], { type: 'TRANSFER_DISCREPANCY', title: `Discrepancy on transfer ${doc.controlNo}`, link: `/transfers/${id}` });
      await this.notify.toRoles(['HEAD_AUDITOR', 'ADMIN'], { type: 'TRANSFER_DISCREPANCY', title: `Discrepancy on transfer ${doc.controlNo} (${doc.fromLocation.name} → ${doc.toLocation.name})`, link: `/transfers/${id}` });
    }
    return result;
  }

  /** Head Auditor resolves in-transit shortfall: back to sender, to receiver, or write-off. */
  async resolveShortfall(id: string, resolution: 'TO_SENDER' | 'TO_RECEIVER' | 'WRITEOFF', user: SessionUser) {
    const doc = await this.get(id, user);
    if (doc.status !== 'DISCREPANCY') throw new BadRequestException('No open discrepancy on this transfer');
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
  private async postTransferJournal(tx: Tx, doc: Prisma.TransferDocGetPayload<{ include: typeof TransfersService.INCLUDE }>, actorId: string) {
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
  async createWriteoff(input: { locationId?: string; docDate?: string; notes?: string; lines: { productId: string; batchId: string; qty: number; reason: 'EXPIRED' | 'DAMAGED' | 'SPOILED' }[] }, user: SessionUser) {
    const locationId = input.locationId ?? user.locationIds[0];
    if (!locationId) throw new BadRequestException('locationId required');
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    const doc = await this.prisma.db.$transaction(async (tx) => {
      for (const l of input.lines) { const bal = await tx.stockBalance.findUnique({ where: { locationId_productId_batchId: { locationId, productId: l.productId, batchId: l.batchId } } }); if (!bal || bal.qty < l.qty) throw new BadRequestException('Write-off qty exceeds on-hand for batch'); }
      const controlNo = await this.seq.next(tx, 'WO', { locationId, locationCode: loc.code });
      return tx.expiryWriteoffDoc.create({ data: { controlNo, docDate: input.docDate ? toDateOnly(input.docDate) : todayManila(), locationId, notes: input.notes, preparedBy: user.id, createdBy: user.id, status: 'SUBMITTED', lines: { create: input.lines } }, include: { lines: { include: { product: { select: { name: true, sku: true } }, batch: true } } } });
    });
    const req = await this.approvals.request({ type: 'WRITEOFF', documentType: 'ExpiryWriteoffDoc', documentId: doc.id, requestedBy: user.id, summary: { controlNo: doc.controlNo, locationId, locationName: loc.name, lines: doc.lines.length } });
    await this.prisma.db.expiryWriteoffDoc.update({ where: { id: doc.id }, data: { approvalRequestId: req.id } });
    return doc;
  }
  listWriteoffs(user: SessionUser) { return this.prisma.db.expiryWriteoffDoc.findMany({ where: { locationId: user.locationScoped ? { in: user.locationIds } : { not: '' } }, include: { location: { select: { code: true, name: true } }, lines: { include: { product: { select: { name: true, sku: true } }, batch: { select: { batchNo: true, expiryDate: true, unitCost: true } } } } }, orderBy: { createdAt: 'desc' } }); }
  private async onWriteoffDecision(docId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const doc = await this.prisma.db.expiryWriteoffDoc.findUniqueOrThrow({ where: { id: docId }, include: { lines: { include: { batch: true, product: { include: { category: true } } } } } });
      if (doc.status !== 'SUBMITTED') return;
      if (outcome === 'REJECTED') { await this.prisma.db.expiryWriteoffDoc.update({ where: { id: docId }, data: { status: 'REJECTED' } }); return; }
      await this.prisma.db.$transaction(async (tx) => {
        await this.stock.post(tx, doc.lines.map((l) => ({ locationId: doc.locationId, productId: l.productId, batchId: l.batchId, qtyDelta: -l.qty, movementType: 'EXPIRED_WRITEOFF' as const, documentType: 'ExpiryWriteoffDoc', documentId: doc.id, unitCost: l.batch.unitCost, businessDate: doc.docDate, createdBy: actorId ?? undefined })));
        await tx.expiryWriteoffDoc.update({ where: { id: docId }, data: { status: 'POSTED', postedAt: new Date() } });
        await this.posting.post(tx, { type: 'ExpiryWriteoffDoc', id: doc.id, date: doc.docDate, createdBy: actorId }, (r) => r9Writeoff(r, { locationId: doc.locationId, controlNo: doc.controlNo, lines: doc.lines.map((l) => ({ accountingClass: l.product.category.accountingClass, qty: l.qty, unitCost: l.batch.unitCost })) }));
      });
    });
  }
}
