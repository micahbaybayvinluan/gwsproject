import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { dateStr, todayManila } from '../common/manila';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

const round2 = (n: number) => Math.round(n * 100) / 100;
const monthRange = (month: string) => { const [y, m] = month.split('-').map(Number); return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)), days: new Date(Date.UTC(y, m, 0)).getUTCDate() }; };
/** One agent is one person even when listed at several branches: their linked account, else their name. */
export const agentKeyOf = (a: { userId: string | null; name: string }) => a.userId ?? `name:${a.name.trim().toLowerCase()}`;

/**
 * Sales targets and achievement (owner request 2026-09-29). The Sales Manager sets a monthly target per branch and per agent; the Owner
 * approves it. Achievement = sales (grand total of posted, not voided DR/SI) in the month. Agents see only their own sales, at every
 * branch. Nobody here sees cost.
 */
@Injectable()
export class TargetsService implements OnModuleInit {
  constructor(private prisma: PrismaService, private approvals: ApprovalsService, private notify: NotificationsService, private audit: AuditService) {}

  onModuleInit() { this.approvals.register('SALES_TARGET', (r, outcome, actor) => this.onDecision(r.documentId, outcome, actor?.id ?? null)); }

  /** Branches (and e-commerce platforms) that sell, in a fixed order. */
  private async sellingLocations() {
    const shops = await this.prisma.db.location.findMany({ where: { isSelling: true, active: true, type: { in: ['BRANCH', 'WAREHOUSE'] } }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
    const ecom = await this.prisma.db.location.findMany({ where: { code: { in: ['ECOM-TIKTOK', 'ECOM-SHOPEE', 'ECOM-LAZADA'] } }, select: { id: true, name: true, code: true }, orderBy: { code: 'desc' } });
    return [...shops, ...ecom.map((l) => ({ ...l, name: `E-commerce – ${l.name.split(' – ')[0]}` }))];
  }

  /** Agents grouped per person, with the branches they are listed at and the account linked to them. */
  async agents() {
    const rows = await this.prisma.db.agent.findMany({ where: { active: true }, include: { location: { select: { name: true } } }, orderBy: { name: 'asc' } });
    const users = await this.prisma.db.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true, username: true } });
    const groups = new Map<string, { key: string; name: string; agentIds: string[]; branches: string[]; user: { id: string; fullName: string; username: string } | null }>();
    for (const r of rows) {
      const key = agentKeyOf(r);
      const g = groups.get(key) ?? { key, name: r.name, agentIds: [], branches: [], user: users.find((u) => u.id === r.userId) ?? null };
      g.agentIds.push(r.id); if (!g.branches.includes(r.location.name)) g.branches.push(r.location.name); groups.set(key, g);
    }
    return [...groups.values()];
  }
  agentUsers() { return this.prisma.db.user.findMany({ where: { active: true, role: { key: 'AGENT' } }, select: { id: true, fullName: true, username: true }, orderBy: { fullName: 'asc' } }); }

  /** Link an agent (at one branch) to the person's Agent account; their sales at every branch then show in "My sales". */
  async linkAgent(agentId: string, userId: string | null, user: SessionUser) {
    const a = await this.prisma.db.agent.findUnique({ where: { id: agentId } }); if (!a) throw new NotFoundException();
    if (userId) { const u = await this.prisma.db.user.findUnique({ where: { id: userId }, include: { role: true } }); if (!u || u.role.key !== 'AGENT') throw new BadRequestException('Choose a user with the Agent role'); }
    const after = await this.prisma.db.agent.update({ where: { id: agentId }, data: { userId } });
    await this.audit.log({ action: 'LINK_AGENT_USER', entityType: 'Agent', entityId: agentId, before: { userId: a.userId }, after: { userId }, userId: user.id });
    return after;
  }

  list(month: string) { return this.prisma.db.salesTarget.findMany({ where: { month }, orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }] }); }

  /** A new target (or a change) waits for the Owner; the Owner's own target applies at once. */
  async request(input: { month: string; kind: 'BRANCH' | 'AGENT'; locationId?: string; agentKey?: string; amount: number; notes?: string }, user: SessionUser) {
    if (!/^\d{4}-\d{2}$/.test(input.month)) throw new BadRequestException('Month must be YYYY-MM');
    if (!(input.amount > 0)) throw new BadRequestException('The target must be more than zero');
    let label: string; let agentName: string | null = null;
    if (input.kind === 'BRANCH') {
      const loc = (await this.sellingLocations()).find((l) => l.id === input.locationId); if (!loc) throw new BadRequestException('Choose a branch');
      label = loc.name;
    } else {
      const g = (await this.agents()).find((x) => x.key === input.agentKey); if (!g) throw new BadRequestException('Choose an agent');
      label = agentName = g.name;
    }
    if (await this.prisma.db.salesTarget.findFirst({ where: { month: input.month, kind: input.kind, locationId: input.locationId ?? null, agentKey: input.agentKey ?? null, status: 'PENDING' } })) throw new BadRequestException(`A target for ${label} in ${input.month} is already waiting for the Owner`);
    const t = await this.prisma.db.salesTarget.create({ data: { month: input.month, kind: input.kind, locationId: input.kind === 'BRANCH' ? input.locationId : null, agentKey: input.kind === 'AGENT' ? input.agentKey : null, agentName, amount: input.amount.toFixed(2), notes: input.notes, createdBy: user.id } });
    const prev = await this.current(input.month, input.kind, input.locationId ?? null, input.agentKey ?? null);
    const req = await this.approvals.request({ type: 'SALES_TARGET', documentType: 'SalesTarget', documentId: t.id, requestedBy: user.id, summary: { controlNo: `Target ${input.month}`, locationName: `${input.kind === 'AGENT' ? 'Agent' : 'Branch'}: ${label}`, total: input.amount.toFixed(2), previousTarget: prev ? prev.amount.toFixed(2) : 'none', notes: input.notes ?? '' } });
    await this.prisma.db.salesTarget.update({ where: { id: t.id }, data: { approvalRequestId: req.id } });
    if (user.roleKey === 'ADMIN') await this.approvals.decide(req.id, user, 'APPROVE', 'Set by the Owner');
    return this.prisma.db.salesTarget.findUniqueOrThrow({ where: { id: t.id } });
  }
  private current(month: string, kind: string, locationId: string | null, agentKey: string | null) { return this.prisma.db.salesTarget.findFirst({ where: { month, kind, locationId, agentKey, status: 'APPROVED' } }); }

  private async onDecision(id: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const t = await this.prisma.db.salesTarget.findUniqueOrThrow({ where: { id } });
      if (t.status !== 'PENDING') return;
      if (outcome === 'APPROVED') await this.prisma.db.salesTarget.updateMany({ where: { month: t.month, kind: t.kind, locationId: t.locationId, agentKey: t.agentKey, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
      await this.prisma.db.salesTarget.update({ where: { id }, data: { status: outcome, decidedAt: new Date() } });
      void actorId;
      const who = t.kind === 'AGENT' ? t.agentName : (await this.prisma.db.location.findUnique({ where: { id: t.locationId! } }))?.name;
      if (t.createdBy) await this.notify.toUsers([t.createdBy], { type: 'SALES_TARGET_DECIDED', title: `Target ${t.month} for ${who}: ₱${t.amount.toFixed(2)} ${outcome === 'APPROVED' ? 'approved' : 'not approved'} by the Owner`, link: '/targets' });
      // the agent is told their own target
      if (outcome === 'APPROVED' && t.agentKey && !t.agentKey.startsWith('name:')) await this.notify.toUsers([t.agentKey], { type: 'SALES_TARGET_SET', title: `Your sales target for ${t.month}: ₱${t.amount.toFixed(2)}`, link: '/my-sales' });
    });
  }

  /** Target vs sales for the month, per branch and per agent; `pace` = the share of the month already gone, to compare with. */
  async progress(month: string, user: SessionUser) {
    if (!user.permissions.has('target.view') && !user.permissions.has('target.manage')) throw new ForbiddenException();
    const { from, to, days } = monthRange(month);
    const today = todayManila();
    const elapsed = today < from ? 0 : today > to ? days : today.getUTCDate();
    const targets = await this.prisma.db.salesTarget.findMany({ where: { month, status: { in: ['APPROVED', 'PENDING'] } } });
    const sales = await this.prisma.db.salesDoc.findMany({ where: { voidedAt: null, docDate: { gte: from, lte: to } }, select: { locationId: true, agentId: true, grandTotal: true } });
    const pct = (a: number, t: number | null) => (t ? round2((a / t) * 100) : null);
    const branchRows = (await this.sellingLocations()).map((l) => {
      const actual = round2(sales.filter((s) => s.locationId === l.id).reduce((t, s) => t + Number(s.grandTotal), 0));
      const approved = targets.find((t) => t.kind === 'BRANCH' && t.locationId === l.id && t.status === 'APPROVED');
      const pending = targets.find((t) => t.kind === 'BRANCH' && t.locationId === l.id && t.status === 'PENDING');
      return { id: l.id, name: l.name, target: approved ? Number(approved.amount) : null, pendingTarget: pending ? Number(pending.amount) : null, actual, achievedPct: pct(actual, approved ? Number(approved.amount) : null), transactions: sales.filter((s) => s.locationId === l.id).length };
    });
    const agentRows = (await this.agents()).map((g) => {
      const mine = sales.filter((s) => s.agentId && g.agentIds.includes(s.agentId));
      const actual = round2(mine.reduce((t, s) => t + Number(s.grandTotal), 0));
      const approved = targets.find((t) => t.kind === 'AGENT' && t.agentKey === g.key && t.status === 'APPROVED');
      const pending = targets.find((t) => t.kind === 'AGENT' && t.agentKey === g.key && t.status === 'PENDING');
      return { key: g.key, name: g.name, branches: g.branches, linkedUser: g.user?.fullName ?? null, target: approved ? Number(approved.amount) : null, pendingTarget: pending ? Number(pending.amount) : null, actual, achievedPct: pct(actual, approved ? Number(approved.amount) : null), transactions: mine.length };
    });
    const sum = (rows: { target: number | null; actual: number }[]) => ({ target: round2(rows.reduce((t, r) => t + (r.target ?? 0), 0)), actual: round2(rows.reduce((t, r) => t + r.actual, 0)) });
    const bt = sum(branchRows);
    return { month, daysInMonth: days, daysElapsed: elapsed, pacePct: round2((elapsed / days) * 100), branches: branchRows, agents: agentRows, totals: { ...bt, achievedPct: pct(bt.actual, bt.target || null) } };
  }

  /** The Agent's own page: sales at every branch this month, target and achievement, and their customers' unpaid balances by due date. */
  async mine(user: SessionUser, month: string) {
    const agents = await this.prisma.db.agent.findMany({ where: { userId: user.id } });
    if (!agents.length) return { linked: false, month, sales: [], total: 0, target: null, achievedPct: null, ar: [], byMonth: [] };
    const ids = agents.map((a) => a.id);
    const { from, to, days } = monthRange(month);
    const today = todayManila();
    const docs = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { OR: [{ agentId: { in: ids } }, { outlet: { OR: [{ agentKey: user.id }, { shares: { some: { agentKey: user.id } } }] } }], voidedAt: null, docDate: { gte: from, lte: to } }, select: { id: true, docDate: true, drSiNo: true, customerName: true, grandTotal: true, paymentMode: true, channel: true, outlet: { select: { name: true } }, customer: { select: { name: true } }, location: { select: { name: true } } }, orderBy: { docDate: 'desc' } }));
    const ar = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { agentId: { in: ids }, voidedAt: null, paymentMode: 'AR_PDC' }, select: { id: true, drSiNo: true, docDate: true, dueDate: true, grandTotal: true, amountPaid: true, pdcChequeNo: true, customerName: true, customer: { select: { name: true } }, location: { select: { name: true } } }, orderBy: { dueDate: 'asc' } }));
    const yearFrom = new Date(Date.UTC(from.getUTCFullYear(), 0, 1));
    const year = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { agentId: { in: ids }, voidedAt: null, docDate: { gte: yearFrom, lte: to } }, select: { docDate: true, grandTotal: true } }));
    const key = agentKeyOf({ userId: user.id, name: '' });
    const target = await this.prisma.db.salesTarget.findFirst({ where: { month, kind: 'AGENT', agentKey: key, status: 'APPROVED' } });
    const total = round2(docs.reduce((t, d) => t + Number(d.grandTotal), 0));
    const byMonth = Array.from({ length: from.getUTCMonth() + 1 }, (_, i) => ({ month: `${from.getUTCFullYear()}-${String(i + 1).padStart(2, '0')}`, total: round2(year.filter((d) => d.docDate.getUTCMonth() === i).reduce((t, d) => t + Number(d.grandTotal), 0)) }));
    const elapsed = today < from ? 0 : today > to ? days : today.getUTCDate();
    return {
      linked: true, month, branches: [...new Set(agents.map((a) => a.locationId))].length, total, count: docs.length, target: target ? Number(target.amount) : null, achievedPct: target ? round2((total / Number(target.amount)) * 100) : null, pacePct: round2((elapsed / days) * 100), byMonth,
      sales: docs.map((d) => ({ id: d.id, date: dateStr(d.docDate), branch: d.location.name, drSiNo: d.drSiNo, outlet: d.outlet?.name ?? null, customer: d.customer?.name ?? d.customerName, channel: d.channel, paymentMode: d.paymentMode, amount: Number(d.grandTotal) })),
      ar: ar.filter((d) => d.grandTotal.gt(d.amountPaid)).map((d) => ({ id: d.id, drSiNo: d.drSiNo, branch: d.location.name, customer: d.customer?.name ?? d.customerName, date: dateStr(d.docDate), dueDate: d.dueDate ? dateStr(d.dueDate) : null, daysToDue: d.dueDate ? Math.round((d.dueDate.getTime() - today.getTime()) / 86400000) : null, balance: round2(Number(d.grandTotal) - Number(d.amountPaid)), pdc: !!d.pdcChequeNo })),
    };
  }
}
