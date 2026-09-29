import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { StockService, VIRTUAL_CODES } from '../stock/stock.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { MasterService } from '../master/master.service';
import { ChargesService } from '../charges/charges.service';
import { PostingService } from '../gl/posting.service';
import { r6Transfer } from '../gl/posting-rules';
import { todayManila } from '../common/manila';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { type ExtraItem, TransfersService } from './transfers.service';

type Step = 'HEAD_AUDITOR' | 'SENDER' | 'ADMIN' | 'RESOLVED';
export type Outcome = 'RETURN_TO_SENDER' | 'RECEIVED_AS_SENT' | 'LOST_COMPANY' | 'LOST_CHARGE';
interface DiffLine { productId: string; name: string; onForm: number; received: number; short: number; extra: number; note?: string | null }
interface HistoryEntry { step: string; by: string | null; byName: string; decision: string; note?: string | null; at: string }
type Doc = Prisma.TransferDocGetPayload<{ include: typeof TransfersService.INCLUDE }>;

export const OUTCOME_LABEL: Record<Outcome, string> = {
  RETURN_TO_SENDER: 'Difference confirmed: adjustment form back to the sending branch',
  RECEIVED_AS_SENT: 'Received as on the form (the receiving branch recounts)',
  LOST_COMPANY: 'Lost: company expense',
  LOST_CHARGE: 'Lost: charged to staff',
};
/** Days the sending branch has to answer before the Owner decides (owner decision 2026-09-29). */
export const SENDER_DAYS = 2;
/** From the third discrepancy of the same person within 30 days, HR is advised to refer it to the Owner. */
export const REFER_AFTER = 3;

/**
 * Transfer received with a different quantity (owner request 2026-09-29). The receiving branch receives what arrived (less, or items
 * not on the form); the rest waits "in transit". 1) Head Auditor reviews; 2) the sending branch confirms within 2 days; 3) the Owner
 * decides if the sending branch disagrees or does not answer. A confirmed difference creates adjustment forms numbered after the
 * original (WA-PO-000012-002 back to the sender, -003 for extra items). HR is notified of every case; the third within 30 days for
 * the same person comes with the advice to refer it to the Owner.
 */
@Injectable()
export class TransferDiscrepancyService implements OnModuleInit {
  constructor(private prisma: PrismaService, private transfers: TransfersService, private stock: StockService, private approvals: ApprovalsService, private notify: NotificationsService, private audit: AuditService, private master: MasterService, private charges: ChargesService, private posting: PostingService) {}

  onModuleInit() {
    this.transfers.onDiscrepancy((id, extras, by) => this.open(id, extras, by));
    this.approvals.register('TRANSFER_DIFF_REVIEW', (r, outcome, actor) => this.onReview(r.documentId, outcome, actor), 'TransferDoc');
    this.approvals.register('TRANSFER_DIFF_SENDER', (r, outcome, actor) => this.onSender(r.documentId, outcome, actor), 'TransferDoc');
    this.approvals.register('TRANSFER_DIFF_ADMIN', (r, outcome, actor) => this.onAdmin(r.documentId, outcome, actor), 'TransferDoc');
  }

  private async doc(id: string, tx: Tx | null = null): Promise<Doc> { return ((tx ?? this.prisma.db) as Tx).transferDoc.findUniqueOrThrow({ where: { id }, include: TransfersService.INCLUDE }); }
  private async name(userId: string | null) { if (!userId) return 'System'; return (await this.prisma.db.user.findUnique({ where: { id: userId }, select: { fullName: true } }))?.fullName ?? ''; }
  private itemsText(lines: DiffLine[]) { return lines.map((l) => `${l.name}: ${l.short ? `${l.short} short (form ${l.onForm}, received ${l.received})` : ''}${l.short && l.extra ? '; ' : ''}${l.extra ? `${l.extra} extra` : ''}`).join(' · '); }
  private async addHistory(id: string, e: Omit<HistoryEntry, 'at' | 'byName'>, data: Prisma.TransferDiscrepancyUpdateInput = {}, tx: Tx | null = null) {
    const db = (tx ?? this.prisma.db) as Tx;
    const rec = await db.transferDiscrepancy.findUniqueOrThrow({ where: { id } });
    const h = [...(rec.history as unknown as HistoryEntry[]), { ...e, byName: await this.name(e.by), at: new Date().toISOString() }];
    return db.transferDiscrepancy.update({ where: { id }, data: { ...data, history: h as unknown as Prisma.InputJsonValue } });
  }

  /** Receipt with a difference: the steps start with the Head Auditor. */
  async open(transferId: string, extras: ExtraItem[], receivedBy: string) {
    await requestContext.runSystem(async () => {
      if (await this.prisma.db.transferDiscrepancy.findUnique({ where: { transferId } })) return;
      const d = await this.doc(transferId);
      const byProduct = new Map<string, DiffLine>();
      for (const l of d.lines) {
        const cur = byProduct.get(l.productId) ?? { productId: l.productId, name: l.product.name, onForm: 0, received: 0, short: 0, extra: 0, note: null };
        cur.onForm += l.qtySent; cur.received += l.qtyReceived ?? 0; cur.short += l.qtySent - (l.qtyReceived ?? 0);
        if (l.discrepancyNote && l.qtySent > (l.qtyReceived ?? 0)) cur.note = l.discrepancyNote;
        byProduct.set(l.productId, cur);
      }
      if (extras.length) {
        const products = await this.prisma.db.product.findMany({ where: { id: { in: extras.map((e) => e.productId) } }, select: { id: true, name: true } });
        for (const e of extras) {
          const cur = byProduct.get(e.productId) ?? { productId: e.productId, name: products.find((p) => p.id === e.productId)?.name ?? '', onForm: 0, received: 0, short: 0, extra: 0, note: null };
          cur.extra += e.qty; cur.received += e.qty; cur.note = e.note ?? cur.note; byProduct.set(e.productId, cur);
        }
      }
      const lines = [...byProduct.values()].filter((l) => l.short > 0 || l.extra > 0);
      const rec = await this.prisma.db.transferDiscrepancy.create({ data: { transferId, controlNo: d.controlNo, lines: lines as unknown as Prisma.InputJsonValue, receivedBy, history: [{ step: 'RECEIVED', by: receivedBy, byName: await this.name(receivedBy), decision: 'REPORTED', note: lines.map((l) => l.note).filter(Boolean).join('; ') || null, at: new Date().toISOString() }] as unknown as Prisma.InputJsonValue } });
      await this.approvals.request({ type: 'TRANSFER_DIFF_REVIEW', documentType: 'TransferDoc', documentId: transferId, requestedBy: receivedBy, summary: { controlNo: d.controlNo, locationId: d.toLocationId, locationName: `${d.fromLocation.name} → ${d.toLocation.name}`, items: this.itemsText(lines), step: 'Approve = the difference is real (the sending branch confirms next). Reject = the receiving branch miscounted (it gets the items as on the form).', nextSteps: [`${d.fromLocation.name} confirms within ${SENDER_DAYS} days`] } });
      await this.audit.log({ action: 'DISCREPANCY_OPENED', entityType: 'TransferDoc', entityId: transferId, after: { lines, discrepancyId: rec.id } });
    });
  }

  /** Staff of the sending location who answer for it: In-Charge (warehouse), sales associates (branch), franchise owner. */
  private async senderUsers(locationId: string) {
    const rows = await this.prisma.db.user.findMany({ where: { active: true, role: { key: { in: ['WAREHOUSE_IN_CHARGE', 'SALES_ASSOCIATE', 'FRANCHISE_OWNER'] } }, assignments: { some: { locationId } } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  private async onReview(transferId: string, outcome: 'APPROVED' | 'REJECTED', actor: { id: string; note?: string } | null) {
    await requestContext.runSystem(async () => {
      const rec = await this.prisma.db.transferDiscrepancy.findUniqueOrThrow({ where: { transferId } });
      if (rec.status !== 'HEAD_AUDITOR') return;
      await this.addHistory(rec.id, { step: 'HEAD_AUDITOR', by: actor?.id ?? null, decision: outcome === 'APPROVED' ? 'DIFFERENCE CONFIRMED' : 'RECEIVER MISCOUNTED', note: actor?.note });
      if (outcome === 'REJECTED') { await this.resolve(transferId, 'RECEIVED_AS_SENT', actor?.id ?? null, { note: actor?.note }); return; }
      const d = await this.doc(transferId);
      const users = await this.senderUsers(d.fromLocationId);
      if (!users.length) { await this.toAdmin(transferId, `No staff account at ${d.fromLocation.name} to confirm`); return; }
      const due = new Date(Date.now() + SENDER_DAYS * 86400000);
      const lines = rec.lines as unknown as DiffLine[];
      await this.prisma.db.transferDiscrepancy.update({ where: { id: rec.id }, data: { status: 'SENDER', senderUserIds: users, senderDueAt: due } });
      await this.approvals.request({ type: 'TRANSFER_DIFF_SENDER', documentType: 'TransferDoc', documentId: transferId, requestedBy: actor?.id ?? rec.receivedBy ?? d.preparedBy, approverUserIds: users, summary: { controlNo: d.controlNo, locationId: d.fromLocationId, locationName: `${d.fromLocation.name} → ${d.toLocation.name}`, items: this.itemsText(lines), dueBy: due.toISOString(), step: `${d.toLocation.name} did not receive what the form says; the Head Auditor confirmed it. Approve = you agree (an adjustment form is made automatically). Reject = you disagree (the Owner decides). Answer within ${SENDER_DAYS} days.` } });
      await this.notify.toLocation(d.toLocationId, { type: 'TRANSFER_DIFF_PROGRESS', title: `${d.controlNo}: the Head Auditor confirmed the difference; waiting for ${d.fromLocation.name}`, link: `/transfers/${transferId}` });
    });
  }

  private async onSender(transferId: string, outcome: 'APPROVED' | 'REJECTED', actor: { id: string; note?: string } | null) {
    await requestContext.runSystem(async () => {
      const rec = await this.prisma.db.transferDiscrepancy.findUniqueOrThrow({ where: { transferId } });
      if (rec.status !== 'SENDER') return;
      await this.addHistory(rec.id, { step: 'SENDER', by: actor?.id ?? null, decision: outcome === 'APPROVED' ? 'AGREED' : 'DISAGREED', note: actor?.note });
      if (outcome === 'APPROVED') await this.resolve(transferId, 'RETURN_TO_SENDER', actor?.id ?? null, { note: actor?.note });
      else await this.toAdmin(transferId, `The sending branch disagrees${actor?.note ? `: ${actor.note}` : ''}`);
    });
  }

  private async onAdmin(transferId: string, outcome: 'APPROVED' | 'REJECTED', actor: { id: string; note?: string } | null) {
    await requestContext.runSystem(async () => {
      const rec = await this.prisma.db.transferDiscrepancy.findUniqueOrThrow({ where: { transferId } });
      if (rec.status !== 'ADMIN') return;
      const o: Outcome = outcome === 'APPROVED' ? 'RETURN_TO_SENDER' : 'LOST_COMPANY';
      await this.addHistory(rec.id, { step: 'ADMIN', by: actor?.id ?? null, decision: OUTCOME_LABEL[o], note: actor?.note });
      await this.resolve(transferId, o, actor?.id ?? null, { note: actor?.note });
    });
  }

  private async toAdmin(transferId: string, reason: string) {
    const rec = await this.prisma.db.transferDiscrepancy.findUniqueOrThrow({ where: { transferId } });
    const d = await this.doc(transferId);
    await this.prisma.db.transferDiscrepancy.update({ where: { id: rec.id }, data: { status: 'ADMIN' } });
    await this.approvals.request({ type: 'TRANSFER_DIFF_ADMIN', documentType: 'TransferDoc', documentId: transferId, requestedBy: rec.receivedBy ?? d.preparedBy, summary: { controlNo: d.controlNo, locationName: `${d.fromLocation.name} → ${d.toLocation.name}`, items: this.itemsText(rec.lines as unknown as DiffLine[]), reason, step: 'Approve = the difference stands (adjustment form back to the sending branch). Reject = treat the missing items as lost (company expense). To mark them received after all or to charge staff, open the transfer.' } });
    await this.notify.toLocation(d.fromLocationId, { type: 'TRANSFER_DIFF_PROGRESS', title: `${d.controlNo}: sent to the Owner to decide (${reason})`, link: `/transfers/${transferId}` });
  }

  /** Hourly: remind the sending branch after one day; after two days without an answer the Owner decides. */
  async runDeadlines(now = new Date()) {
    let reminded = 0, escalated = 0;
    const open = await this.prisma.db.transferDiscrepancy.findMany({ where: { status: 'SENDER' } });
    for (const r of open) {
      if (!r.senderDueAt) continue;
      if (r.senderDueAt <= now) {
        await this.prisma.db.approvalRequest.updateMany({ where: { documentType: 'TransferDoc', documentId: r.transferId, type: 'TRANSFER_DIFF_SENDER', status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: now } });
        await this.addHistory(r.id, { step: 'SENDER', by: null, decision: `NO ANSWER IN ${SENDER_DAYS} DAYS` });
        await this.toAdmin(r.transferId, `No answer from the sending branch within ${SENDER_DAYS} days`);
        escalated++;
      } else if (!r.senderRemindedAt && r.senderDueAt.getTime() - now.getTime() <= 86400000) {
        await this.notify.toUsers(r.senderUserIds, { type: 'TRANSFER_DIFF_REMINDER', title: `Reminder: answer the difference on ${r.controlNo} by ${r.senderDueAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}, or the Owner decides`, link: `/transfers/${r.transferId}` });
        await this.prisma.db.transferDiscrepancy.update({ where: { id: r.id }, data: { senderRemindedAt: now } });
        reminded++;
      }
    }
    return { reminded, escalated };
  }

  /** The Owner decides from the transfer page (any outcome, including charging staff). */
  async adminDecide(transferId: string, input: { outcome: Outcome; note?: string; employeeIds?: string[] }, user: SessionUser) {
    if (user.roleKey !== 'ADMIN') throw new ForbiddenException('Only the Owner decides at this step');
    const rec = await this.prisma.db.transferDiscrepancy.findUnique({ where: { transferId } });
    if (!rec) throw new NotFoundException();
    if (rec.status !== 'ADMIN') throw new BadRequestException('This difference is not waiting for the Owner');
    if (input.outcome === 'LOST_CHARGE') await this.charges.assertEmployees(input.employeeIds ?? []);
    await this.prisma.db.approvalRequest.updateMany({ where: { documentType: 'TransferDoc', documentId: transferId, type: 'TRANSFER_DIFF_ADMIN', status: 'PENDING' }, data: { status: 'APPROVED', decidedAt: new Date() } });
    await this.addHistory(rec.id, { step: 'ADMIN', by: user.id, decision: OUTCOME_LABEL[input.outcome], note: input.note });
    await this.resolve(transferId, input.outcome, user.id, { note: input.note, employeeIds: input.employeeIds });
    return this.get(transferId, user);
  }

  /** Apply the decision: stock out of "in transit", adjustment forms, entries, charge form, HR notice and notifications. */
  private async resolve(transferId: string, outcome: Outcome, actorId: string | null, opts: { note?: string; employeeIds?: string[] } = {}) {
    const rec = await this.prisma.db.transferDiscrepancy.findUniqueOrThrow({ where: { transferId } });
    const d = await this.doc(transferId);
    const lines = rec.lines as unknown as DiffLine[];
    const transit = await this.stock.locationByCode(null, VIRTUAL_CODES.IN_TRANSIT);
    const by = actorId ?? rec.receivedBy ?? d.preparedBy;
    const adjIds: string[] = [];
    let chargeFormId: string | null = null;
    await this.prisma.db.$transaction(async (tx) => {
      const short = d.lines.map((l) => ({ l, qty: l.qtySent - (l.qtyReceived ?? 0) })).filter((x) => x.qty > 0 && !x.l.shortfallResolution);
      const extras = lines.filter((l) => l.extra > 0);
      let n = 2;
      const nextNo = async () => { for (;;) { const no = `${d.controlNo}-${String(n++).padStart(3, '0')}`; if (!(await tx.transferDoc.findFirst({ where: { controlNo: no } }))) return no; } };
      const posts: Parameters<StockService['post']>[1] = [];
      if (outcome === 'RETURN_TO_SENDER') {
        if (short.length) {
          // -002: the items not received go back to the sending branch (they never left it in the books)
          const no = await nextNo();
          const adj = await tx.transferDoc.create({ data: { controlNo: no, transferInNo: `${d.transferInNo ?? d.controlNo}${no.slice(d.controlNo.length)}`, docDate: todayManila(), fromLocationId: d.toLocationId, toLocationId: d.fromLocationId, transferType: 'RETURN', returnReason: 'Not received', status: 'RECEIVED', approvedAt: new Date(), receivedAt: new Date(), receivedBy: by, preparedBy: by, createdBy: by, notes: `Adjustment of ${d.controlNo}: items on the form that ${d.toLocation.name} did not receive`, lines: { create: short.map((x) => ({ productId: x.l.productId, batchId: x.l.batchId, qtySent: x.qty, qtyReceived: x.qty, checkerRemarks: `Not received on ${d.controlNo}` })) } } });
          adjIds.push(adj.id);
          for (const x of short) posts.push(
            { locationId: transit.id, productId: x.l.productId, batchId: x.l.batchId, qtyDelta: -x.qty, movementType: 'RETURN_TO_WAREHOUSE', documentType: 'TransferDoc', documentId: adj.id, unitCost: x.l.batch.unitCost, createdBy: by },
            { locationId: d.fromLocationId, productId: x.l.productId, batchId: x.l.batchId, qtyDelta: x.qty, movementType: 'RETURN_TO_WAREHOUSE', documentType: 'TransferDoc', documentId: adj.id, unitCost: x.l.batch.unitCost, createdBy: by },
          );
          for (const x of short) await tx.transferLine.update({ where: { id: x.l.id }, data: { shortfallResolution: 'TO_SENDER' } });
        }
        if (extras.length) {
          // -003: items received that were not on the form move from the sender to the receiver
          const no = await nextNo();
          const adjLines: Prisma.TransferLineUncheckedCreateWithoutDocInput[] = [];
          for (const e of extras) for (const p of await this.stock.pickFefo(tx, d.fromLocationId, e.productId, e.extra, { allowExpired: true })) adjLines.push({ productId: e.productId, batchId: p.batchId, qtySent: p.qty, qtyReceived: p.qty, checkerRemarks: `Received on ${d.controlNo} but not on the form` });
          const adj = await tx.transferDoc.create({ data: { controlNo: no, transferInNo: `${d.transferInNo ?? d.controlNo}${no.slice(d.controlNo.length)}`, docDate: todayManila(), fromLocationId: d.fromLocationId, toLocationId: d.toLocationId, transferType: d.transferType, status: 'RECEIVED', approvedAt: new Date(), receivedAt: new Date(), receivedBy: rec.receivedBy ?? by, preparedBy: by, createdBy: by, notes: `Adjustment of ${d.controlNo}: items ${d.toLocation.name} received that were not on the form`, lines: { create: adjLines } }, include: TransfersService.INCLUDE });
          adjIds.push(adj.id);
          for (const l of adj.lines) posts.push(
            { locationId: d.fromLocationId, productId: l.productId, batchId: l.batchId, qtyDelta: -l.qtySent, movementType: 'TRANSFER_OUT', documentType: 'TransferDoc', documentId: adj.id, unitCost: l.batch.unitCost, createdBy: by },
            { locationId: d.toLocationId, productId: l.productId, batchId: l.batchId, qtyDelta: l.qtySent, movementType: 'TRANSFER_IN', documentType: 'TransferDoc', documentId: adj.id, unitCost: l.batch.unitCost, createdBy: by },
          );
          await this.stock.post(tx, posts.splice(0));
          await this.transfers.postTransferJournal(tx, adj, by);
        }
      } else if (outcome === 'RECEIVED_AS_SENT') {
        for (const x of short) {
          posts.push(
            { locationId: transit.id, productId: x.l.productId, batchId: x.l.batchId, qtyDelta: -x.qty, movementType: 'TRANSFER_IN', documentType: 'TransferDoc', documentId: d.id, unitCost: x.l.batch.unitCost, createdBy: by },
            { locationId: d.toLocationId, productId: x.l.productId, batchId: x.l.batchId, qtyDelta: x.qty, movementType: 'TRANSFER_IN', documentType: 'TransferDoc', documentId: d.id, unitCost: x.l.batch.unitCost, createdBy: by },
          );
          await tx.transferLine.update({ where: { id: x.l.id }, data: { qtyReceived: x.l.qtySent, shortfallResolution: 'TO_RECEIVER' } });
        }
        // the entry for the quantity now received (R6, or R7 billing for a franchise)
        if (short.length) await this.transfers.postTransferJournal(tx, { ...d, lines: short.map((x) => ({ ...x.l, qtyReceived: x.qty })) }, by);
      } else {
        for (const x of short) {
          posts.push({ locationId: transit.id, productId: x.l.productId, batchId: x.l.batchId, qtyDelta: -x.qty, movementType: 'EXPIRED_WRITEOFF', documentType: 'TransferDoc', documentId: d.id, unitCost: x.l.batch.unitCost, createdBy: by });
          await tx.transferLine.update({ where: { id: x.l.id }, data: { shortfallResolution: outcome === 'LOST_CHARGE' ? 'CHARGED' : 'WRITEOFF' } });
        }
        if (outcome === 'LOST_COMPANY' && short.length) await this.posting.post(tx, { type: 'TransferDoc', id: d.id, date: todayManila(), createdBy: by }, (r) => r6Transfer(r, { fromLocationId: d.fromLocationId, toLocationId: d.toLocationId, controlNo: `${d.controlNo} lost items`, lines: [], shortfall: short.map((x) => ({ accountingClass: x.l.product.category.accountingClass, qty: x.qty, unitCost: x.l.batch.unitCost })) }));
        if (outcome === 'LOST_CHARGE' && short.length) {
          const cl = [];
          for (const x of short) cl.push({ productId: x.l.productId, qty: x.qty, unitCharge: (await this.master.priceFor(x.l.productId, 'FRANCHISE', todayManila(), tx)) ?? x.l.batch.unitCost, batchCost: x.l.batch.unitCost, description: `Not received on ${d.controlNo}` });
          const cf = await this.charges.create(tx, { kind: 'INVENTORY_DISCREPANCY', locationId: d.fromLocationId, sourceType: 'TransferDoc', sourceId: d.id, reason: `Items lost on transfer ${d.controlNo} (${d.fromLocation.name} → ${d.toLocation.name})`, lines: cl, employeeIds: opts.employeeIds ?? [], createdBy: by });
          chargeFormId = cf.id;
        }
      }
      await this.stock.post(tx, posts);
      await tx.transferDoc.update({ where: { id: d.id }, data: { status: 'RESOLVED' } });
      await tx.transferDiscrepancy.update({ where: { id: rec.id }, data: { status: 'RESOLVED', outcome, resolvedAt: new Date(), adjustmentDocIds: adjIds, chargeFormId } });
    }, { timeout: 60000 });
    if (chargeFormId) await this.charges.announce(chargeFormId);
    const adjNos = adjIds.length ? (await this.prisma.db.transferDoc.findMany({ where: { id: { in: adjIds } }, select: { controlNo: true } })).map((x) => x.controlNo) : [];
    const msg = { type: 'TRANSFER_DIFF_RESOLVED', title: `${d.controlNo} (${d.fromLocation.name} → ${d.toLocation.name}): ${OUTCOME_LABEL[outcome]}${adjNos.length ? ` — ${adjNos.join(', ')}` : ''}`, link: `/transfers/${d.id}` };
    await this.notify.toLocation(d.fromLocationId, msg);
    await this.notify.toLocation(d.toLocationId, msg);
    await this.notify.toUsers([d.preparedBy], msg);
    await this.hrNotice(rec.id, outcome, adjNos, opts.note);
    await this.audit.log({ action: 'DISCREPANCY_RESOLVED', entityType: 'TransferDoc', entityId: d.id, after: { outcome, adjustmentForms: adjNos, chargeFormId }, userId: actorId ?? undefined });
  }

  /** Every case goes to HR (and the Owner). The person answerable: who prepared the form, or the receiver who miscounted. */
  private async hrNotice(recId: string, outcome: Outcome, adjNos: string[], note?: string) {
    const rec = await this.prisma.db.transferDiscrepancy.findUniqueOrThrow({ where: { id: recId } });
    const d = await this.doc(rec.transferId);
    const staffUserId = outcome === 'RECEIVED_AS_SENT' ? rec.receivedBy ?? d.preparedBy : d.preparedBy;
    const staffName = await this.name(staffUserId);
    const since = new Date(Date.now() - 30 * 86400000);
    const count = 1 + await this.prisma.db.hrNotice.count({ where: { kind: 'TRANSFER_DISCREPANCY', createdAt: { gte: since }, details: { path: ['staffUserId'], equals: staffUserId } } });
    const refer = count >= REFER_AFTER;
    const items = this.itemsText(rec.lines as unknown as DiffLine[]);
    const n = await this.prisma.db.hrNotice.upsert({
      where: { dedupeKey: `TRANSFER_DIFF:${rec.transferId}` },
      create: { kind: 'TRANSFER_DISCREPANCY', dedupeKey: `TRANSFER_DIFF:${rec.transferId}`, locationId: outcome === 'RECEIVED_AS_SENT' ? d.toLocationId : d.fromLocationId, title: `Transfer difference ${d.controlNo} (${d.fromLocation.name} → ${d.toLocation.name})`, details: { transferId: d.id, controlNo: d.controlNo, from: d.fromLocation.name, to: d.toLocation.name, items, outcome, outcomeLabel: OUTCOME_LABEL[outcome], adjustmentForms: adjNos, staffUserId, staffName, role: outcome === 'RECEIVED_AS_SENT' ? 'Received and miscounted' : 'Prepared the form', countIn30Days: count, recommendReferral: refer, note: note ?? null } as Prisma.InputJsonValue, staffIds: [{ id: staffUserId, name: staffName }] as Prisma.InputJsonValue },
      update: {},
    });
    await this.prisma.db.transferDiscrepancy.update({ where: { id: recId }, data: { hrNoticeId: n.id } });
    await this.notify.toRoles(['HR_STAFF', 'ADMIN'], { type: 'HR_NOTICE_TRANSFER', title: refer ? `${staffName}: ${count} transfer differences in 30 days (latest ${d.controlNo}) — HR is advised to refer this to the Owner` : `Transfer difference ${d.controlNo}: ${items} (${staffName}); the Owner decides any action`, link: '/hr-notices' });
  }

  async get(transferId: string, user: SessionUser) {
    await this.transfers.get(transferId, user); // only the two locations (and unscoped roles) see it
    return requestContext.runSystem(() => this.read(transferId, user));
  }
  private async read(transferId: string, user: SessionUser) {
    const rec = await this.prisma.db.transferDiscrepancy.findUnique({ where: { transferId } });
    if (!rec) return null;
    const pending = rec.status === 'RESOLVED' ? null : await this.prisma.db.approvalRequest.findFirst({ where: { documentType: 'TransferDoc', documentId: transferId, status: 'PENDING', type: { in: ['TRANSFER_DIFF_REVIEW', 'TRANSFER_DIFF_SENDER', 'TRANSFER_DIFF_ADMIN'] } } });
    const adj = await this.prisma.db.transferDoc.findMany({ where: { id: { in: rec.adjustmentDocIds } }, select: { id: true, controlNo: true, fromLocation: { select: { name: true } }, toLocation: { select: { name: true } } } });
    const canAct = !!pending && (pending.requiredApproverUserIds.length ? pending.requiredApproverUserIds.includes(user.id) : pending.requiredApproverRoles.includes(user.roleKey));
    return { ...rec, pendingRequestId: pending?.id ?? null, canAct, adjustmentForms: adj, outcomeLabel: rec.outcome ? OUTCOME_LABEL[rec.outcome as Outcome] : null, senderDays: SENDER_DAYS };
  }
}
