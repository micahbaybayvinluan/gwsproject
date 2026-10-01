import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService, Tx } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PostingService } from '../gl/posting.service';
import { r7bFranchiseShipping } from '../gl/posting-rules';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { D } from '../common/money';
import { addDays, dateStr, daysBetween, todayManila, toDateOnly } from '../common/manila';
import { FranchiseArService } from './franchise-ar.service';

const r2 = (x: Prisma.Decimal.Value) => D(x).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
/** The Franchise Coordinator has this many days to fill in a shipping charge that was tagged "to follow" on a sale. */
export const SHIPPING_FILL_DAYS = 2;

type Pending = { kind: 'AMOUNT'; amount: string; reason: string; requestedBy: string } | { kind: 'FILL_BY'; fillBy: string; reason: string; requestedBy: string };

/**
 * Shipping charged to a franchise on a sale (owner request 2026-10-01).
 * - On the sale the shipping is tagged "to follow" (or the amount is typed at once). The Franchise Coordinators, the Owner, the auditors, Accounting and the franchise owner are told.
 * - The Franchise Coordinator fills the amount within 2 days; it becomes its own franchise invoice (FAR-SHIP-…), separate from the order, with the usual due date, penalty and interest.
 * - A later change of the amount, or of the 2-day limit, is asked for in the system and decided by the Owner.
 * - Not filled after 2 days: reminded every day (coordinators, Owner, auditors, Accounting, franchise owner).
 */
@Injectable()
export class FranchiseShippingService implements OnModuleInit {
  constructor(private prisma: PrismaService, private audit: AuditService, private approvals: ApprovalsService, private notify: NotificationsService, private posting: PostingService, private ar: FranchiseArService) {}

  onModuleInit() { this.approvals.register('FRANCHISE_SHIPPING_EDIT', (r, outcome, actor) => this.onEdit(r.documentId, outcome, actor), 'FranchiseShippingCharge'); }

  private link(id: string) { return `/franchise-ar?shipping=${id}`; }

  /** Called by the sale: records the charge and tells everyone. `amount` given = filled at once. */
  async createForSale(sale: { id: string; controlNo: string; drSiNo: string; locationId: string }, franchiseLocationId: string, opt: { mode: 'TO_FOLLOW' | 'AMOUNT'; amount?: number; courier?: string; reference?: string }, user: SessionUser) {
    const today = todayManila();
    const row = await this.prisma.db.franchiseShippingCharge.create({ data: { salesDocId: sale.id, drSiNo: sale.drSiNo, franchiseLocationId, fromLocationId: sale.locationId, fillBy: addDays(today, SHIPPING_FILL_DAYS), courier: opt.courier || null, reference: opt.reference || null, createdBy: user.id } });
    const name = await this.ar.franchiseName(franchiseLocationId);
    if (opt.mode === 'AMOUNT') {
      if (!(opt.amount && opt.amount > 0)) throw new BadRequestException('Type the shipping amount, or choose "to follow"');
      return this.fillRow(row.id, { amount: opt.amount }, user, { announceSaleNo: sale.drSiNo });
    }
    await this.ar.tell(franchiseLocationId, { type: 'FRANCHISE_SHIPPING_TO_FOLLOW', title: `Shipping charge to follow for ${name}, DR ${sale.drSiNo} (entered by ${user.fullName})`, body: `The Franchise Coordinator fills in the amount by ${dateStr(row.fillBy)} (${SHIPPING_FILL_DAYS} days). It then becomes a separate franchise invoice.`, link: this.link(row.id) });
    await this.audit.log({ action: 'CREATE', entityType: 'FranchiseShippingCharge', entityId: row.id, after: row });
    return row;
  }

  // ── reading ──
  private async scope(user: SessionUser) {
    if (user.permissions.has('franchise.ar.view') || user.permissions.has('franchise.shipping.fill')) return undefined;
    if (user.permissions.has('franchise.ar.own')) { const own = user.locationIds[0]; if (!own) throw new BadRequestException('This account is not assigned to a franchise'); return own; }
    throw new ForbiddenException('You do not have access to franchise shipping charges');
  }
  async list(user: SessionUser, q: { status?: string }) {
    const loc = await this.scope(user);
    const rows = await this.prisma.db.franchiseShippingCharge.findMany({ where: { franchiseLocationId: loc, status: q.status === 'ALL' ? undefined : q.status === 'FILLED' ? 'FILLED' : 'TO_FOLLOW' }, orderBy: [{ fillBy: 'asc' }, { createdAt: 'desc' }] });
    const locs = await this.prisma.db.location.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.franchiseLocationId, r.fromLocationId]))] } }, select: { id: true, name: true } });
    const today = todayManila();
    return rows.map((r) => ({ id: r.id, saleId: r.salesDocId, drSiNo: r.drSiNo, franchise: locs.find((l) => l.id === r.franchiseLocationId)?.name ?? '', franchiseLocationId: r.franchiseLocationId, from: locs.find((l) => l.id === r.fromLocationId)?.name ?? '', status: r.status, fillBy: dateStr(r.fillBy), daysLate: r.status === 'TO_FOLLOW' ? Math.max(0, daysBetween(r.fillBy, today)) : 0, overdue: r.status === 'TO_FOLLOW' && r.fillBy < today, amount: r.amount, courier: r.courier, reference: r.reference, notes: r.notes, invoiceId: r.invoiceId, filledAt: r.filledAt, pendingEdit: r.pendingEdit, createdAt: r.createdAt }));
  }

  // ── the Franchise Coordinator fills in the amount ──
  async fill(user: SessionUser, id: string, input: { amount: number; courier?: string | null; reference?: string | null; notes?: string | null }) {
    if (!user.permissions.has('franchise.shipping.fill')) throw new ForbiddenException('Only the Franchise Coordinators fill in the shipping charge');
    return this.fillRow(id, input, user, {});
  }
  private async fillRow(id: string, input: { amount: number; courier?: string | null; reference?: string | null; notes?: string | null }, user: SessionUser, ctx: { announceSaleNo?: string }) {
    if (!(input.amount > 0)) throw new BadRequestException('The shipping amount must be more than zero');
    const out = await this.prisma.db.$transaction(async (tx) => {
      const cur = await tx.franchiseShippingCharge.findUnique({ where: { id } });
      if (!cur) throw new NotFoundException();
      if (cur.status !== 'TO_FOLLOW') throw new BadRequestException('The amount was already filled in. To change it, ask the Owner for approval.');
      const sale = await tx.salesDoc.findUniqueOrThrow({ where: { id: cur.salesDocId }, select: { controlNo: true, docDate: true, voidedAt: true } });
      if (sale.voidedAt) throw new BadRequestException('The sale was voided');
      const amount = r2(input.amount);
      const inv = await this.ar.createCharge(tx, { controlNo: `FAR-SHIP-${sale.controlNo}`, source: 'SHIPPING', franchiseLocationId: cur.franchiseLocationId, fromLocationId: cur.fromLocationId, amount, notes: `Shipping charge for DR ${cur.drSiNo}` }, user.id);
      const upd = await tx.franchiseShippingCharge.update({ where: { id }, data: { status: 'FILLED', amount: amount.toFixed(2), courier: input.courier ?? cur.courier, reference: input.reference ?? cur.reference, notes: input.notes ?? null, invoiceId: inv.id, filledBy: user.id, filledAt: new Date() } });
      await this.posting.post(tx, { type: 'FranchiseShippingCharge', id, date: todayManila(), createdBy: user.id }, (r) => r7bFranchiseShipping(r, { fromLocationId: cur.fromLocationId, franchiseLocationId: cur.franchiseLocationId, amount, ref: inv.controlNo }));
      return { row: upd, inv, late: Math.max(0, daysBetween(cur.fillBy, todayManila())) };
    });
    await this.audit.log({ action: 'FILL', entityType: 'FranchiseShippingCharge', entityId: id, after: out.row });
    const name = await this.ar.franchiseName(out.row.franchiseLocationId);
    await this.ar.tell(out.row.franchiseLocationId, { type: 'FRANCHISE_SHIPPING_INVOICE', title: `Shipping charge ${this.ar.peso(out.row.amount!)} for ${name}, DR ${out.row.drSiNo}: new franchise invoice ${out.inv.controlNo} due ${dateStr(out.inv.dueDate)}`, body: `Billed separately from the order. Filled in by ${user.fullName}${out.late > 0 ? ` (${out.late} day${out.late === 1 ? '' : 's'} after the ${SHIPPING_FILL_DAYS}-day limit)` : ''}. After the due date a 2% penalty and 0.1% a day apply (memo of July 31, 2026).`, link: this.ar.link(out.inv.id) });
    return out.row;
  }

  // ── a change needs the Owner ──
  async requestEdit(user: SessionUser, id: string, input: { amount?: number; fillBy?: string; reason: string }) {
    if (!user.permissions.has('franchise.shipping.fill')) throw new ForbiddenException('Only the Franchise Coordinators ask for a change');
    const reason = input.reason?.trim(); if (!reason || reason.length < 5) throw new BadRequestException('Give the reason for the change');
    const cur = await this.prisma.db.franchiseShippingCharge.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException();
    if (cur.pendingEdit) throw new BadRequestException('A change is already waiting for the Owner');
    let pending: Pending; let line: string;
    if (cur.status === 'FILLED') {
      if (!(input.amount && input.amount > 0)) throw new BadRequestException('Type the new amount');
      if (r2(input.amount).equals(D(cur.amount ?? 0))) throw new BadRequestException('That is the amount already filled in');
      pending = { kind: 'AMOUNT', amount: r2(input.amount).toFixed(2), reason, requestedBy: user.id }; line = `change the shipping charge from ${this.ar.peso(cur.amount!)} to ${this.ar.peso(input.amount)}`;
    } else {
      if (!input.fillBy || !/^\d{4}-\d{2}-\d{2}$/.test(input.fillBy) || toDateOnly(input.fillBy) <= cur.fillBy) throw new BadRequestException('Choose a date later than the current limit');
      pending = { kind: 'FILL_BY', fillBy: input.fillBy, reason, requestedBy: user.id }; line = `give more time to fill in the shipping charge (until ${input.fillBy}, now ${dateStr(cur.fillBy)})`;
    }
    const name = await this.ar.franchiseName(cur.franchiseLocationId);
    const req = await this.approvals.request({ type: 'FRANCHISE_SHIPPING_EDIT', documentType: 'FranchiseShippingCharge', documentId: id, requestedBy: user.id, summary: { controlNo: `Shipping charge · DR ${cur.drSiNo}`, locationId: cur.franchiseLocationId, locationName: name, total: pending.kind === 'AMOUNT' ? pending.amount : cur.amount?.toFixed(2) ?? '0.00', reason, requestedByName: user.fullName, step: `Approve = ${line}` } });
    await this.prisma.db.franchiseShippingCharge.update({ where: { id }, data: { pendingEdit: pending as unknown as Prisma.InputJsonValue } });
    await this.audit.log({ action: 'REQUEST_EDIT', entityType: 'FranchiseShippingCharge', entityId: id, after: pending });
    await this.ar.tell(cur.franchiseLocationId, { type: 'FRANCHISE_SHIPPING_EDIT_REQUEST', title: `⚑ ${user.fullName} asks to ${line} (${name}, DR ${cur.drSiNo}): ${reason}`, body: 'The Owner decides in My Approvals.', link: this.link(id) });
    return { requested: true, approvalRequestId: req.id };
  }
  private async onEdit(id: string, outcome: 'APPROVED' | 'REJECTED', actor: { id: string; note?: string } | null) {
    await requestContext.runSystem(async () => {
      const cur = await this.prisma.db.franchiseShippingCharge.findUnique({ where: { id } });
      const pe = cur?.pendingEdit as Pending | null | undefined;
      if (!cur || !pe) return;
      const name = await this.ar.franchiseName(cur.franchiseLocationId);
      if (outcome === 'APPROVED') {
        await this.prisma.db.$transaction(async (tx: Tx) => {
          if (pe.kind === 'AMOUNT') {
            if (!cur.invoiceId) throw new BadRequestException('There is no invoice to change');
            const { before, after } = await this.ar.changeAmount(tx, cur.invoiceId, pe.amount, 'SHIPPING_EDIT', pe.reason, actor?.id ?? null, { drSiNo: cur.drSiNo });
            await tx.franchiseShippingCharge.update({ where: { id }, data: { amount: after.toFixed(2), pendingEdit: Prisma.DbNull } });
            await this.posting.post(tx, { type: 'FranchiseShippingCharge', id: randomUUID(), date: todayManila(), createdBy: actor?.id ?? null }, (r) => r7bFranchiseShipping(r, { fromLocationId: cur.fromLocationId, franchiseLocationId: cur.franchiseLocationId, amount: after.minus(before), ref: `${cur.drSiNo} (changed)` }));
          } else await tx.franchiseShippingCharge.update({ where: { id }, data: { fillBy: toDateOnly(pe.fillBy), pendingEdit: Prisma.DbNull } });
        });
        await this.ar.tell(cur.franchiseLocationId, { type: 'FRANCHISE_SHIPPING_EDITED', title: pe.kind === 'AMOUNT' ? `Shipping charge of ${name}, DR ${cur.drSiNo}, changed to ${this.ar.peso(pe.amount)} (approved by the Owner): ${pe.reason}` : `Shipping charge of ${name}, DR ${cur.drSiNo}: the Franchise Coordinator may fill it in until ${pe.fillBy} (approved by the Owner)`, link: this.link(id) }, [pe.requestedBy]);
      } else {
        await this.prisma.db.franchiseShippingCharge.update({ where: { id }, data: { pendingEdit: Prisma.DbNull } });
        await this.notify.toUsers([pe.requestedBy], { type: 'FRANCHISE_SHIPPING_EDIT_REJECTED', title: `The Owner did not approve the change to the shipping charge of ${name}, DR ${cur.drSiNo}${actor?.note ? `: ${actor.note}` : ''}`, link: this.link(id) });
      }
    });
  }

  // ── daily: not filled in after 2 days ──
  async runDaily(now = todayManila()) {
    const rows = await this.prisma.db.franchiseShippingCharge.findMany({ where: { status: 'TO_FOLLOW', fillBy: { lt: now } } });
    let reminded = 0;
    for (const r of rows) {
      if (r.remindedAt && daysBetween(r.remindedAt, now) < 1) continue;
      const days = daysBetween(r.fillBy, now);
      await this.prisma.db.franchiseShippingCharge.update({ where: { id: r.id }, data: { remindedAt: now } });
      await this.ar.tell(r.franchiseLocationId, { type: 'FRANCHISE_SHIPPING_OVERDUE', title: `⚑ Shipping charge for ${await this.ar.franchiseName(r.franchiseLocationId)}, DR ${r.drSiNo}, is still not filled in: ${days} day${days === 1 ? '' : 's'} past the ${SHIPPING_FILL_DAYS}-day limit`, body: 'The Franchise Coordinator must fill in the amount so the franchise can be billed.', link: this.link(r.id) });
      reminded++;
    }
    return { reminded };
  }
}
