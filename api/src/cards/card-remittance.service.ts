import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { SettingsService } from '../common/settings.service';
import { AuditService } from '../common/audit.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { assertBalanced, consolidate, type Entry, type Line } from '../gl/posting-rules';
import { dateStr, daysBetween, todayManila, toDateOnly } from '../common/manila';
import { D, round2 } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

interface RemLine { salesDocId: string; drSiNo: string; locationId: string; gross: string; fee: string }
export interface CreateRemittance { bankAccountId: string; receivedOn: string; batchRef?: string | null; notes?: string | null; proofAttachmentId?: string | null; salesDocIds: string[]; netAmount: number; fees?: Record<string, number> }

/**
 * Card remittance (owner request 2026-10-23): the bank credits our account the card sales less its charge. Accounting picks the card sales
 * the credit is for, types the NET amount that reached the bank, and the system works out the fee (gross - net) and shares it among the sales
 * (in proportion to their amount, or typed per sale). The Accounting Head approves; then it posts
 * Dr Bank (net) + Dr MDR - Credit Card (fee) / Cr AR - Credit Card of each branch (gross).
 */
@Injectable()
export class CardRemittanceService implements OnModuleInit {
  constructor(private prisma: PrismaService, private seq: SequenceService, private settings: SettingsService, private audit: AuditService, private approvals: ApprovalsService, private notify: NotificationsService, private posting: PostingService, private accounts: AccountsService) {}

  onModuleInit() { this.approvals.register('CARD_REMITTANCE', (req, outcome, actor) => this.onDecision(req.documentId, outcome, actor?.id ?? null), 'CardRemittance'); }

  private amountOf(s: { cardAmount: Prisma.Decimal | null; grandTotal: Prisma.Decimal }) { return D(s.cardAmount ?? s.grandTotal); }

  /** Card sales no bank credit has cleared yet, oldest first, with the usual fee rate as a suggestion. */
  async waiting(q: { locationId?: string; from?: string; to?: string; mid?: string; batch?: string }) {
    const rows = await this.prisma.db.salesDoc.findMany({
      where: { paymentMode: 'CREDIT_CARD', voidedAt: null, cardRemittanceId: null, locationId: q.locationId || undefined, docDate: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined, cardMid: q.mid || undefined, cardBatchNo: q.batch || undefined },
      include: { location: { select: { id: true, name: true } } }, orderBy: [{ docDate: 'asc' }, { drSiNo: 'asc' }], take: 1000,
    });
    const today = todayManila(); const alertDays = await this.settings.get<number>('card.remit_alert_days');
    const out = rows.map((s) => ({ id: s.id, drSiNo: s.drSiNo, docDate: dateStr(s.docDate), locationId: s.locationId, location: s.location.name, mid: s.cardMid, slip: s.cardSlipNo, approval: s.cardApprovalCode, batch: s.cardBatchNo, customer: s.customerName, amount: this.amountOf(s).toFixed(2), days: daysBetween(s.docDate, today) }));
    const total = out.reduce((t, r) => t.plus(r.amount), D(0));
    return { rows: out, total: total.toFixed(2), count: out.length, oldest: out[0]?.docDate ?? null, late: out.filter((r) => r.days > alertDays).length, alertDays, mdrPct: await this.settings.get<number>('card.mdr_pct') };
  }

  bankAccounts() { return this.prisma.db.account.findMany({ where: { isPaymentAccount: true, active: true, paymentAccountType: 'BANK' }, select: { id: true, code: true, title: true }, orderBy: { code: 'asc' } }); }

  /** Share `fee` among the sales: typed amounts stay, the rest follows each sale's amount; cents are handed out so the parts add up exactly. */
  static split(gross: { id: string; amount: string }[], fee: string, typed: Record<string, number> = {}) {
    const out = new Map<string, ReturnType<typeof D>>(); let left = D(fee);
    for (const g of gross) if (typed[g.id] != null) { const v = round2(D(typed[g.id])); if (v.isNeg() || v.gt(g.amount)) throw new BadRequestException('A fee cannot be negative or more than the sale'); out.set(g.id, v); left = left.minus(v); }
    const rest = gross.filter((g) => typed[g.id] == null);
    if (left.isNeg()) throw new BadRequestException('The fees typed are more than the bank charged (gross − net)');
    if (!rest.length) { if (!left.isZero()) throw new BadRequestException(`The fees typed must add up to the bank charge ${D(fee).toFixed(2)}`); return out; }
    const base = rest.reduce((t, g) => t.plus(g.amount), D(0));
    let given = D(0);
    rest.forEach((g, i) => { const v = i === rest.length - 1 ? left.minus(given) : round2(left.mul(g.amount).div(base)); out.set(g.id, v); given = given.plus(v); });
    return out;
  }

  async create(input: CreateRemittance, user: SessionUser) {
    if (!input.salesDocIds.length) throw new BadRequestException('Tick the card sales this bank credit is for');
    const acct = await this.prisma.db.account.findUnique({ where: { id: input.bankAccountId } });
    if (!acct || !acct.isPaymentAccount) throw new BadRequestException('Choose the bank account that was credited');
    const sales = await this.prisma.db.salesDoc.findMany({ where: { id: { in: input.salesDocIds } } });
    if (sales.length !== new Set(input.salesDocIds).size) throw new BadRequestException('A sale was not found');
    for (const s of sales) {
      if (s.paymentMode !== 'CREDIT_CARD' || s.voidedAt) throw new BadRequestException(`${s.drSiNo} is not an active credit card sale`);
      if (s.cardRemittanceId) throw new BadRequestException(`${s.drSiNo} is already in a card remittance`);
    }
    const gross = sales.reduce((t, s) => t.plus(this.amountOf(s)), D(0)); const net = round2(D(input.netAmount));
    if (net.lte(0)) throw new BadRequestException('Type the amount that reached the bank (net)');
    if (net.gt(gross)) throw new BadRequestException(`The bank credited ${net.toFixed(2)}, more than the card sales (${gross.toFixed(2)}): check the sales ticked or correct a card amount first`);
    const fee = round2(gross.minus(net));
    const shares = CardRemittanceService.split(sales.map((s) => ({ id: s.id, amount: this.amountOf(s).toFixed(2) })), fee.toFixed(2), input.fees);
    const lines: RemLine[] = sales.map((s) => ({ salesDocId: s.id, drSiNo: s.drSiNo, locationId: s.locationId, gross: this.amountOf(s).toFixed(2), fee: shares.get(s.id)!.toFixed(2) }));
    const received = toDateOnly(input.receivedOn);
    const row = await this.prisma.db.$transaction(async (tx) => {
      const controlNo = await this.seq.form(tx, 'CR', null);
      const created = await tx.cardRemittance.create({ data: { controlNo, bankAccountId: input.bankAccountId, receivedOn: received, batchRef: input.batchRef?.trim() || null, notes: input.notes?.trim() || null, proofAttachmentId: input.proofAttachmentId ?? null, grossAmount: gross.toFixed(2), feeAmount: fee.toFixed(2), netAmount: net.toFixed(2), lines: lines as unknown as Prisma.InputJsonValue, createdBy: user.id } });
      // the sales are held by this remittance until it is rejected or deleted
      for (const l of lines) await tx.salesDoc.update({ where: { id: l.salesDocId }, data: { cardRemittanceId: created.id, cardFee: l.fee } });
      return created;
    });
    await this.audit.log({ action: 'CARD_REMITTANCE_CREATE', entityType: 'CardRemittance', entityId: row.id, after: { controlNo: row.controlNo, gross: gross.toFixed(2), fee: fee.toFixed(2), net: net.toFixed(2), sales: lines.length } });
    return this.get(row.id);
  }

  async list(status?: string) {
    const rows = await this.prisma.db.cardRemittance.findMany({ where: { status: status || undefined }, orderBy: { createdAt: 'desc' }, take: 200 });
    const accts = new Map((await this.prisma.db.account.findMany({ where: { id: { in: rows.map((r) => r.bankAccountId) } }, select: { id: true, title: true } })).map((a) => [a.id, a.title]));
    return rows.map((r) => ({ id: r.id, controlNo: r.controlNo, status: r.status, receivedOn: dateStr(r.receivedOn), bank: accts.get(r.bankAccountId) ?? '', batchRef: r.batchRef, gross: r.grossAmount, fee: r.feeAmount, net: r.netAmount, feePct: D(r.grossAmount).isZero() ? '0.00' : D(r.feeAmount).div(r.grossAmount).mul(100).toFixed(2), sales: (r.lines as unknown as RemLine[]).length }));
  }

  async get(id: string) {
    const r = await this.prisma.db.cardRemittance.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    const acct = await this.prisma.db.account.findUnique({ where: { id: r.bankAccountId }, select: { title: true } });
    return { ...r, receivedOn: dateStr(r.receivedOn), bank: acct?.title ?? '', feePct: D(r.grossAmount).isZero() ? '0.00' : D(r.feeAmount).div(r.grossAmount).mul(100).toFixed(2), lines: r.lines as unknown as RemLine[] };
  }

  async submit(id: string, user: SessionUser) {
    const r = await this.prisma.db.cardRemittance.findUniqueOrThrow({ where: { id } });
    if (r.status !== 'DRAFT') throw new BadRequestException('Already sent for approval');
    const req = await this.approvals.request({ type: 'CARD_REMITTANCE', documentType: 'CardRemittance', documentId: id, requestedBy: user.id, summary: { controlNo: r.controlNo, locationName: 'Card remittance', sales: (r.lines as unknown as RemLine[]).length, grossAmount: D(r.grossAmount).toFixed(2), bankFee: D(r.feeAmount).toFixed(2), netToBank: D(r.netAmount).toFixed(2), receivedOn: dateStr(r.receivedOn), step: 'Check that the net amount is what the bank statement shows, then approve' } });
    await this.prisma.db.cardRemittance.update({ where: { id }, data: { status: 'SUBMITTED', approvalRequestId: req.id } });
    return this.get(id);
  }

  /** A draft (or rejected) remittance is deleted: its sales go back to the waiting list; the form number is reused. */
  async remove(id: string) {
    const r = await this.prisma.db.cardRemittance.findUniqueOrThrow({ where: { id } });
    if (!['DRAFT', 'REJECTED'].includes(r.status)) throw new BadRequestException('Only a draft (or a rejected remittance) can be deleted');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.salesDoc.updateMany({ where: { cardRemittanceId: id }, data: { cardRemittanceId: null, cardFee: null } });
      await tx.cardRemittance.delete({ where: { id } });
      const br = r.controlNo.slice(0, r.controlNo.indexOf('-'));
      const rows = await tx.cardRemittance.findMany({ where: { controlNo: { startsWith: `${br}-CR-` } }, select: { id: true, controlNo: true, status: true } });
      await this.seq.closeGap(tx, 'CR', br, SequenceService.numberOf(r.controlNo), rows.map((x) => ({ id: x.id, no: SequenceService.numberOf(x.controlNo), draft: x.status === 'DRAFT' })), async (i, n) => { await tx.cardRemittance.update({ where: { id: i }, data: { controlNo: n } }); });
    });
    await this.audit.log({ action: 'DELETE', entityType: 'CardRemittance', entityId: id, before: { controlNo: r.controlNo } });
    return { ok: true };
  }

  private async onDecision(id: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const r = await this.prisma.db.cardRemittance.findUniqueOrThrow({ where: { id } });
      if (r.status !== 'SUBMITTED') return;
      const lines = r.lines as unknown as RemLine[];
      if (outcome === 'REJECTED') {
        await this.prisma.db.$transaction(async (tx) => {
          await tx.cardRemittance.update({ where: { id }, data: { status: 'REJECTED' } });
          await tx.salesDoc.updateMany({ where: { cardRemittanceId: id }, data: { cardRemittanceId: null, cardFee: null } });
        });
        if (r.createdBy) await this.notify.toUsers([r.createdBy], { type: 'CARD_REMITTANCE_REJECTED', title: `Card remittance ${r.controlNo} was not approved; check the amounts and enter it again`, link: '/card-remittances' });
        return;
      }
      await this.prisma.db.$transaction(async (tx) => {
        await this.accounts.ensureGlobal('MDR_CREDIT_CARD', actorId ?? 'system', tx);
        await tx.cardRemittance.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date() } });
        await this.posting.post(tx, { type: 'CardRemittance', id, date: r.receivedOn, name: 'Card remittance', createdBy: actorId }, (res) => {
          const out: Line[] = [{ accountId: r.bankAccountId, debit: round2(r.netAmount), credit: D(0), memo: 'Credited by the bank' }];
          if (!D(r.feeAmount).isZero()) out.push({ accountId: res.global('MDR_CREDIT_CARD'), debit: round2(r.feeAmount), credit: D(0), memo: 'Bank charge on card sales' });
          const byBranch = new Map<string, ReturnType<typeof D>>();
          for (const l of lines) byBranch.set(l.locationId, (byBranch.get(l.locationId) ?? D(0)).plus(l.gross));
          for (const [loc, amt] of byBranch) out.push({ accountId: res.branch('AR_CREDIT_CARD', loc), debit: D(0), credit: round2(amt), memo: 'Card sales cleared' });
          const e: Entry = { rule: 'CARDREM', book: 'BENTA', lines: consolidate(out), remarks: `Card remittance ${r.controlNo}` };
          assertBalanced(e.lines);
          return [e];
        });
      });
      if (r.createdBy) await this.notify.toUsers([r.createdBy], { type: 'CARD_REMITTANCE_POSTED', title: `Card remittance ${r.controlNo} approved and posted`, link: '/card-remittances' });
    });
  }
}
