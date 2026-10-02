import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TargetsService } from '../targets/targets.service';
import { addDays, dateStr, daysBetween, todayManila, toDateOnly } from '../common/manila';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { canViewAll, outletsOf, requireAgent } from './field-common';
import { OutletsService } from './outlets.service';
import { AgentConsignmentsService } from './agent-consignments.service';

const round2 = (n: number) => Math.round(n * 100) / 100;
const monthBounds = (month: string) => { const [y, m] = month.split('-').map(Number); return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) }; };
export const DORMANT_DAYS = 30;

/** Scorecards, area and outlet performance, outlets that stopped ordering, and the daily alerts to the Sales Manager (owner request 2026-10-02). */
@Injectable()
export class MonitorService {
  constructor(private prisma: PrismaService, private notify: NotificationsService, private targets: TargetsService, private outlets: OutletsService, private consign: AgentConsignmentsService) {}

  /** Orders tagged to an agent's outlets (own and shared) plus the sales entered with the agent. Not voided. */
  private async salesOf(agentKey: string, agentIds: string[], from: Date, to: Date) {
    return requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { voidedAt: null, docDate: { gte: from, lte: to }, OR: [{ outlet: outletsOf(agentKey) }, ...(agentIds.length ? [{ agentId: { in: agentIds } }] : [])] }, select: { id: true, grandTotal: true, amountPaid: true, paymentMode: true, dueDate: true, outletId: true } }));
  }

  async scorecard(user: SessionUser, month: string, agentKey?: string) {
    if (!canViewAll(user)) requireAgent(user);
    const people = await this.targets.agents();
    const keys = canViewAll(user) ? (agentKey ? [agentKey] : (await this.outlets.agents()).map((a) => a.key)) : [user.id];
    const { from, to } = monthBounds(month);
    const today = todayManila();
    const out = [];
    for (const key of keys) {
      const person = people.find((p) => p.key === key);
      const name = person?.name ?? (await this.outlets.me(user)).name;
      const stops = await this.prisma.db.itineraryStop.findMany({ where: { itinerary: { agentKey: key, planDate: { gte: from, lte: to } } }, select: { status: true, itinerary: { select: { planDate: true } } } });
      const planned = stops.length; const visited = stops.filter((s) => s.status === 'VISITED').length; const missed = stops.filter((s) => s.status === 'MISSED').length;
      const notReported = stops.filter((s) => s.status === 'PLANNED' && s.itinerary.planDate < today).length;
      const days = await this.prisma.db.itinerary.count({ where: { agentKey: key, planDate: { gte: from, lte: to }, stops: { some: {} } } });
      const added = await this.prisma.db.outlet.count({ where: { agentKey: key, deletedAt: null, status: 'APPROVED', approvedAt: { gte: from, lt: addDays(to, 1) } } });
      const pending = await this.prisma.db.outlet.count({ where: { agentKey: key, deletedAt: null, status: 'PENDING' } });
      const own = await this.prisma.db.outlet.groupBy({ by: ['stage'], where: { ...outletsOf(key), status: 'APPROVED', deletedAt: null }, _count: true });
      const sales = await this.salesOf(key, person?.agentIds ?? [], from, to);
      const total = round2(sales.reduce((t, s) => t + Number(s.grandTotal), 0));
      const tgt = await this.prisma.db.salesTarget.findFirst({ where: { month, kind: 'AGENT', agentKey: key, status: 'APPROVED' } });
      const open = (await this.salesOf(key, person?.agentIds ?? [], new Date(Date.UTC(2000, 0, 1)), to)).filter((s) => s.paymentMode === 'AR_PDC' && Number(s.grandTotal) > Number(s.amountPaid));
      const csg = await this.consign.forAgent(key);
      out.push({
        agentKey: key, agentName: name, month,
        visits: { days, planned, visited, missed, notReported, visitRate: planned ? round2((visited / planned) * 100) : null },
        outlets: { added, pending, total: own.reduce((n, o) => n + o._count, 0), stages: Object.fromEntries(own.map((o) => [o.stage, o._count])) },
        sales: { total, orders: sales.length, target: tgt ? Number(tgt.amount) : null, achievedPct: tgt ? round2((total / Number(tgt.amount)) * 100) : null },
        collections: { unpaid: round2(open.reduce((t, s) => t + Number(s.grandTotal) - Number(s.amountPaid), 0)), overdue: open.filter((s) => s.dueDate && s.dueDate < today).length, openInvoices: open.length },
        consignment: { outstanding: round2(csg.outstanding), limit: csg.limit, usedPct: csg.usedPct, unpaid: round2(csg.unpaid) },
      });
    }
    return out.sort((a, b) => a.agentName.localeCompare(b.agentName));
  }

  /** Sales per area (orders tagged to its outlets) against the area's agent target, and the biggest outlets. */
  async areaPerformance(user: SessionUser, month: string) {
    if (!canViewAll(user)) throw new ForbiddenException();
    const { from, to } = monthBounds(month);
    const areas = await this.prisma.db.salesArea.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    const outlets = await this.prisma.db.outlet.findMany({ where: { status: 'APPROVED', deletedAt: null }, select: { id: true, name: true, areaId: true, agentName: true } });
    const docs = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.groupBy({ by: ['outletId'], where: { voidedAt: null, outletId: { in: outlets.map((o) => o.id) }, docDate: { gte: from, lte: to } }, _sum: { grandTotal: true }, _count: true }));
    const targets = await this.prisma.db.salesTarget.findMany({ where: { month, kind: 'AGENT', status: 'APPROVED' } });
    const rows = areas.map((a) => {
      const os = outlets.filter((o) => o.areaId === a.id); const ds = docs.filter((d) => os.some((o) => o.id === d.outletId));
      const total = round2(ds.reduce((t, d) => t + Number(d._sum.grandTotal ?? 0), 0)); const tgt = a.agentKey ? targets.find((t) => t.agentKey === a.agentKey) : undefined;
      return { areaId: a.id, area: a.name, agentName: a.agentName, outlets: os.length, ordering: ds.length, orders: ds.reduce((n, d) => n + d._count, 0), sales: total, agentTarget: tgt ? Number(tgt.amount) : null, achievedPct: tgt ? round2((total / Number(tgt.amount)) * 100) : null };
    });
    const top = docs.map((d) => ({ outletId: d.outletId!, outlet: outlets.find((o) => o.id === d.outletId)?.name ?? '', agentName: outlets.find((o) => o.id === d.outletId)?.agentName ?? '', sales: round2(Number(d._sum.grandTotal ?? 0)), orders: d._count })).sort((a, b) => b.sales - a.sales).slice(0, 15);
    return { month, areas: rows, topOutlets: top };
  }

  /** Approved outlets that have not ordered for 30 days (or never, though approved over 30 days ago): the agent can chase them. */
  async dormant(user: SessionUser, agentKey?: string) {
    const key = canViewAll(user) ? agentKey : (requireAgent(user), user.id);
    const outlets = await this.prisma.db.outlet.findMany({ where: { status: 'APPROVED', deletedAt: null, active: true, ...(key ? outletsOf(key) : {}) }, select: { id: true, name: true, city: true, agentName: true, stage: true, approvedAt: true, phone: true, contactName: true } });
    const last = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.groupBy({ by: ['outletId'], where: { voidedAt: null, outletId: { in: outlets.map((o) => o.id) } }, _max: { docDate: true } }));
    const today = todayManila();
    return outlets.map((o) => { const l = last.find((x) => x.outletId === o.id)?._max.docDate ?? null; const since = l ?? o.approvedAt; return { id: o.id, name: o.name, city: o.city, agentName: o.agentName, stage: o.stage, contactName: o.contactName, phone: o.phone, lastOrder: l ? dateStr(l) : null, days: since ? daysBetween(since, today) : null }; })
      .filter((o) => o.days != null && o.days >= DORMANT_DAYS).sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
  }

  /** A sale was tagged to an outlet: first order, then regular (3 orders in 90 days). */
  async onSaleTagged(outletId: string) {
    await this.outlets.advance(outletId, 'FIRST_ORDER');
    const n = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.count({ where: { outletId, voidedAt: null, docDate: { gte: addDays(todayManila(), -90) } } }));
    if (n >= 3) await this.outlets.advance(outletId, 'REGULAR');
  }

  /** Every morning: the Sales Manager is told of missing / unreported itineraries, old consignments and maximums nearly used; agents without a plan are reminded. */
  async runDaily() {
    return requestContext.runSystem(async () => {
      const today = todayManila(); const yesterday = addDays(today, -1);
      const agents = await this.outlets.agents();
      const lines: string[] = [];
      const dow = (d: Date) => d.getUTCDay();
      const noPlanYesterday: string[] = []; const unreported: string[] = []; const reminded: string[] = [];
      for (const a of agents) {
        const withOutlets = await this.prisma.db.outlet.count({ where: { ...outletsOf(a.key), status: 'APPROVED', deletedAt: null } });
        if (!withOutlets) continue;
        if (dow(yesterday) !== 0) {
          const it = await this.prisma.db.itinerary.findUnique({ where: { agentKey_planDate: { agentKey: a.key, planDate: yesterday } }, include: { stops: true } });
          if (!it || !it.stops.length) noPlanYesterday.push(a.name);
          else { const open = it.stops.filter((s) => s.status === 'PLANNED').length; if (open) unreported.push(`${a.name} (${open} of ${it.stops.length} stores not reported)`); }
        }
        if (dow(today) !== 0 && !a.key.startsWith('name:') && !(await this.prisma.db.itinerary.findFirst({ where: { agentKey: a.key, planDate: today, stops: { some: {} } } }))) { reminded.push(a.name); await this.notify.toUsers([a.key], { type: 'ITINERARY_REMINDER', title: 'Plan today\'s itinerary: choose the stores you will visit', link: '/itinerary' }); }
      }
      if (noPlanYesterday.length) lines.push(`No itinerary yesterday: ${noPlanYesterday.join(', ')}`);
      if (unreported.length) lines.push(`Visits not reported yesterday: ${unreported.join('; ')}`);
      const csg = await this.consign.allConsignees();
      const old = csg.filter((c) => (c.ageFlag ?? 0) >= 15).map((c) => `${c.consignee} (${c.agentName}): ${c.idleDays} days without a sales report, ${c.ageFlag}+ days`);
      if (old.length) lines.push(`Consignments with no sales report: ${old.join('; ')}`);
      const nearly: string[] = [];
      for (const k of [...new Set(csg.map((c) => c.agentKey!))]) { const f = await this.consign.forAgent(k); if (f.usedPct != null && f.usedPct >= 90) nearly.push(`${csg.find((c) => c.agentKey === k)?.agentName}: ${f.usedPct}% of the maximum used`); }
      if (nearly.length) lines.push(`Consignment maximum nearly used: ${nearly.join('; ')}`);
      const sinceMon = dow(today) === 1 ? (await this.dormant({ permissions: new Set(['outlet.view.all']) } as unknown as SessionUser)) : [];
      if (sinceMon.length) lines.push(`${sinceMon.length} outlets have not ordered for ${DORMANT_DAYS}+ days`);
      if (lines.length) await this.notify.toRoles(['SALES_MANAGER'], { type: 'AGENT_DAILY', title: `Agents: ${lines.length} thing${lines.length > 1 ? 's' : ''} to follow up`, body: lines.join('\n'), link: '/field' });
      return { noPlanYesterday: noPlanYesterday.length, unreported: unreported.length, reminded: reminded.length, consignmentFlags: old.length };
    });
  }
}
