import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SequenceService } from '../common/sequence.service';
import { dateStr, toDateOnly } from '../common/manila';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { TargetsService } from './targets.service';

const round2 = (n: number) => Math.round(n * 100) / 100;
const monthRange = (month: string) => { const [y, m] = month.split('-').map(Number); return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) }; };
export const RELEASE_MODES = ['BANK_TRANSFER', 'GCASH', 'CHEQUE', 'CASH'] as const;

/**
 * Agent incentives (owner request 2026-09-30). Each month the Sales Manager confirms an agent's total sales (every branch, not voided) and
 * the incentive; the Accounting Associate, the Accounting Head and the Owner approve. The approved form (AI-000001) goes to HR, who has the
 * agent sign it; Accounting then tags how and when it was paid (bank transfer, GCash, cheque or cash, with the reference).
 */
@Injectable()
export class IncentivesService implements OnModuleInit {
  constructor(private prisma: PrismaService, private approvals: ApprovalsService, private notify: NotificationsService, private seq: SequenceService, private targets: TargetsService) {}

  onModuleInit() { this.approvals.register('AGENT_INCENTIVE', (r, outcome, actor) => this.onDecision(r.documentId, outcome, actor?.note ?? null)); }

  /** Every agent's sales for the month, with what is already confirmed. */
  async month(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('Month is YYYY-MM');
    const { from, to } = monthRange(month);
    const groups = await this.targets.agents();
    const docs = await this.prisma.db.salesDoc.findMany({ where: { voidedAt: null, docDate: { gte: from, lte: to }, agentId: { in: groups.flatMap((g) => g.agentIds) } }, select: { agentId: true, grandTotal: true, amountPaid: true, paymentMode: true } });
    const existing = await this.prisma.db.agentIncentive.findMany({ where: { month, status: { not: 'REJECTED' } } });
    return groups.map((g) => {
      const mine = docs.filter((d) => d.agentId && g.agentIds.includes(d.agentId));
      const total = round2(mine.reduce((t, d) => t + Number(d.grandTotal), 0));
      const collected = round2(mine.reduce((t, d) => t + (d.paymentMode === 'AR_PDC' ? Number(d.amountPaid) : Number(d.grandTotal)), 0));
      const e = existing.find((x) => x.agentKey === g.key) ?? null;
      return { agentKey: g.key, name: g.name, branches: g.branches, linkedUser: g.user?.fullName ?? null, transactions: mine.length, totalSales: total, collected, unpaid: round2(total - collected), incentive: e ? this.view(e) : null };
    });
  }

  async prepare(input: { month: string; agentKey: string; ratePct?: number | null; amount?: number | null; notes?: string | null }, user: SessionUser) {
    const row = (await this.month(input.month)).find((r) => r.agentKey === input.agentKey);
    if (!row) throw new BadRequestException('Agent not found');
    if (row.incentive) throw new BadRequestException(`${row.name}'s incentive for ${input.month} is already ${row.incentive.status === 'PENDING' ? 'waiting for approval' : 'approved'}`);
    if (!row.totalSales) throw new BadRequestException(`${row.name} has no sales in ${input.month}`);
    const amount = input.amount != null ? round2(input.amount) : input.ratePct != null ? round2((row.totalSales * input.ratePct) / 100) : NaN;
    if (!(amount > 0)) throw new BadRequestException('Type the incentive: a rate (% of sales) or an amount');
    const groups = await this.targets.agents(); const g = groups.find((x) => x.key === input.agentKey)!;
    const e = await this.prisma.db.agentIncentive.create({ data: {
      month: input.month, agentKey: row.agentKey, agentName: row.name, agentUserId: g.user?.id ?? null, branches: row.branches, transactions: row.transactions,
      totalSales: row.totalSales.toFixed(2), collected: row.collected.toFixed(2), ratePct: input.ratePct != null ? input.ratePct.toFixed(3) : null, amount: amount.toFixed(2), notes: input.notes?.trim() || null, preparedBy: user.id,
    } });
    const req = await this.approvals.request({ type: 'AGENT_INCENTIVE', documentType: 'AgentIncentive', documentId: e.id, requestedBy: user.id, summary: {
      controlNo: `Agent incentive ${input.month}`, locationName: `${row.name} · sales ₱${row.totalSales.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`, total: amount.toFixed(2),
      totalSales: row.totalSales.toFixed(2), collected: row.collected.toFixed(2), transactions: row.transactions, ratePct: input.ratePct ?? null, branches: row.branches,
    } });
    await this.prisma.db.agentIncentive.update({ where: { id: e.id }, data: { approvalRequestId: req.id } });
    return this.view(await this.prisma.db.agentIncentive.findUniqueOrThrow({ where: { id: e.id } }));
  }

  private async onDecision(id: string, outcome: 'APPROVED' | 'REJECTED', note: string | null) {
    const e = await requestContext.runSystem(async () => {
      const e = await this.prisma.db.agentIncentive.findUniqueOrThrow({ where: { id } });
      if (e.status !== 'PENDING') return null;
      if (outcome === 'REJECTED') return this.prisma.db.agentIncentive.update({ where: { id }, data: { status: 'REJECTED', decisionNote: note } });
      const formNo = await this.prisma.db.$transaction((tx) => this.seq.next(tx, 'AI', { prefix: 'AI', pad: 6 }));
      return this.prisma.db.agentIncentive.update({ where: { id }, data: { status: 'APPROVED', formNo, approvedAt: new Date(), decisionNote: note } });
    });
    if (!e) return;
    const peso = `₱${Number(e.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
    if (e.status === 'APPROVED') {
      const n = { type: 'AGENT_INCENTIVE', title: `Incentive release form ${e.formNo}: ${e.agentName}, ${e.month} — ${peso}`, body: 'Approved by Accounting and the Owner. HR: print it, have the agent sign, then Accounting releases the payment.', link: `/incentives?month=${e.month}` };
      await this.notify.toRoles(['HR_STAFF', 'SALES_MANAGER', 'ACCOUNTING_HEAD', 'ACCOUNTING_ASSOCIATE'], n);
      if (e.agentUserId) await this.notify.toUsers([e.agentUserId], { ...n, body: 'Your incentive was approved. HR will ask you to sign the release form.' });
    } else await this.notify.toUsers([e.preparedBy], { type: 'AGENT_INCENTIVE', title: `Incentive for ${e.agentName} (${e.month}) was rejected`, body: note ?? undefined, link: `/incentives?month=${e.month}` });
  }

  /** HR: the agent signed the release form; it is ready for Accounting to pay. */
  async hrSigned(id: string, user: SessionUser) {
    const e = await this.prisma.db.agentIncentive.findUnique({ where: { id } }); if (!e) throw new NotFoundException();
    if (e.status !== 'APPROVED') throw new BadRequestException('Only an approved incentive form can be signed');
    const u = await this.prisma.db.agentIncentive.update({ where: { id }, data: { status: 'SIGNED', hrSignedBy: user.id, hrSignedAt: new Date() } });
    await this.notify.toRoles(['ACCOUNTING_HEAD', 'ACCOUNTING_ASSOCIATE'], { type: 'AGENT_INCENTIVE', title: `Incentive ${u.formNo} signed by ${u.agentName}: ready to release ₱${Number(u.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`, link: `/incentives?month=${u.month}` });
    return this.view(u);
  }

  /** Accounting tags how the incentive was paid. */
  async release(id: string, input: { mode: (typeof RELEASE_MODES)[number]; accountId?: string | null; reference?: string | null; date: string }, user: SessionUser) {
    const e = await this.prisma.db.agentIncentive.findUnique({ where: { id } }); if (!e) throw new NotFoundException();
    if (!['APPROVED', 'SIGNED'].includes(e.status)) throw new BadRequestException(e.status === 'RELEASED' ? 'Already released' : 'Only an approved incentive can be released');
    if (input.mode !== 'CASH' && !input.reference?.trim()) throw new BadRequestException('Type the reference (bank / GCash reference or cheque no.)');
    const u = await this.prisma.db.agentIncentive.update({ where: { id }, data: { status: 'RELEASED', releaseMode: input.mode, releaseAccountId: input.accountId || null, releaseReference: input.reference?.trim() || null, releaseDate: toDateOnly(input.date), releasedBy: user.id, releasedAt: new Date() } });
    const n = { type: 'AGENT_INCENTIVE', title: `Incentive ${u.formNo} released to ${u.agentName} (${u.releaseMode!.replace('_', ' ').toLowerCase()}${u.releaseReference ? ` · ${u.releaseReference}` : ''})`, link: `/incentives?month=${u.month}` };
    await this.notify.toRoles(['HR_STAFF', 'SALES_MANAGER'], n);
    if (u.agentUserId) await this.notify.toUsers([u.agentUserId], n);
    return this.view(u);
  }

  async list(user: SessionUser, month?: string) {
    const own = !user.permissions.has('incentive.view');
    if (own && !user.permissions.has('agent.self')) throw new ForbiddenException();
    const rows = await this.prisma.db.agentIncentive.findMany({ where: { month: month || undefined, ...(own ? { agentUserId: user.id } : {}) }, orderBy: [{ month: 'desc' }, { agentName: 'asc' }] });
    const ids = [...new Set(rows.flatMap((r) => [r.preparedBy, r.hrSignedBy, r.releasedBy].filter((x): x is string => !!x)))];
    const names = new Map((await this.prisma.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const accts = new Map((await this.prisma.db.account.findMany({ where: { id: { in: rows.map((r) => r.releaseAccountId).filter((x): x is string => !!x) } }, select: { id: true, title: true } })).map((a) => [a.id, a.title]));
    return rows.map((r) => ({ ...this.view(r), preparedByName: names.get(r.preparedBy) ?? null, hrSignedByName: r.hrSignedBy ? names.get(r.hrSignedBy) ?? null : null, releasedByName: r.releasedBy ? names.get(r.releasedBy) ?? null : null, releaseAccount: r.releaseAccountId ? accts.get(r.releaseAccountId) ?? null : null }));
  }

  private view(r: { id: string; month: string; agentName: string; status: string; formNo: string | null; totalSales: unknown; collected: unknown; amount: unknown; ratePct: unknown; releaseDate?: Date | null; [k: string]: unknown }) {
    return { ...r, totalSales: Number(r.totalSales), collected: Number(r.collected), amount: Number(r.amount), ratePct: r.ratePct == null ? null : Number(r.ratePct), releaseDate: r.releaseDate ? dateStr(r.releaseDate) : null };
  }
}
