import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { MasterService } from '../master/master.service';
import { dateStr, daysBetween, todayManila } from '../common/manila';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { canViewAll, isManager, requireAgent } from './field-common';
import { OutletsService } from './outlets.service';

const peso = (x: number) => `₱${x.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Days without a consignee sales report after which a consignment is flagged. */
export const AGEING_FLAGS = [15, 30, 60];
export const ageFlag = (days: number | null) => (days == null ? null : [...AGEING_FLAGS].reverse().find((f) => days >= f) ?? null);

/**
 * Consignments an agent is responsible for, and their maximum amounts (owner request 2026-10-02). The Sales Manager links a consignee
 * account to an agent's outlet; the Sales Manager sets the maximum, in total for the agent and, if wanted, for one outlet, and the
 * Owner approves it. Consignment is valued at the retail price (SRP) of the stock still at the consignee. A consignment out that would
 * go over a maximum is stopped when it is submitted.
 */
@Injectable()
export class AgentConsignmentsService implements OnModuleInit {
  constructor(private prisma: PrismaService, private approvals: ApprovalsService, private notify: NotificationsService, private audit: AuditService, private master: MasterService, private outlets: OutletsService) {}

  onModuleInit() { this.approvals.register('AGENT_CONSIGNMENT_LIMIT', (req, outcome, actor) => this.onLimitDecision(req.documentId, outcome, actor?.id ?? null), 'AgentConsignmentLimit'); }

  private async srp(items: { productId: string; qty: number }[]) {
    const prices = await this.master.currentPrices([...new Set(items.map((i) => i.productId))]);
    return items.reduce((t, i) => t + Number(prices.get(i.productId)?.RETAIL ?? 0) * i.qty, 0);
  }

  /** The consignee accounts with their stock (at SRP), unpaid amount and how long since the consignee last reported sales. */
  private async consignees(where: { agentKey?: string | { not: null }; outletId?: string }) {
    const ags = await this.prisma.db.consignmentAgreement.findMany({ where: { direction: 'OUT', active: true, ...where }, include: { counterpartyLocation: { select: { id: true, name: true, active: true } } } });
    const out = [];
    const today = todayManila();
    for (const ag of ags) {
      const loc = ag.counterpartyLocation; if (!loc) continue;
      const bal = await this.prisma.db.stockBalance.findMany({ where: { locationId: loc.id, qty: { gt: 0 } }, include: { product: { select: { id: true, sku: true, name: true } } } });
      const prices = await this.master.currentPrices(bal.map((b) => b.productId));
      const items = new Map<string, { productId: string; name: string; qty: number; value: number }>();
      for (const b of bal) { const cur = items.get(b.productId) ?? { productId: b.productId, name: b.product.name, qty: 0, value: 0 }; cur.qty += b.qty; cur.value += Number(prices.get(b.productId)?.RETAIL ?? 0) * b.qty; items.set(b.productId, cur); }
      const sent = await this.prisma.db.stockLedger.aggregate({ where: { locationId: loc.id, movementType: 'CONSIGN_OUT', qtyDelta: { gt: 0 } }, _max: { businessDate: true } });
      const reported = await this.prisma.db.consignmentSaleReport.aggregate({ where: { agreementId: ag.id }, _max: { periodTo: true } });
      const ar = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.aggregate({ where: { customer: { locationId: loc.id }, voidedAt: null }, _sum: { grandTotal: true, amountPaid: true } }));
      const value = [...items.values()].reduce((t, i) => t + i.value, 0);
      const since = reported._max.periodTo ?? sent._max.businessDate ?? null;
      const idle = value > 0 && since ? daysBetween(since, today) : null;
      out.push({ agreementId: ag.id, consigneeId: loc.id, consignee: loc.name, agentKey: ag.agentKey, agentName: ag.agentName, outletId: ag.outletId, items: [...items.values()], value, unpaid: Number(ar._sum.grandTotal ?? 0) - Number(ar._sum.amountPaid ?? 0), lastSent: sent._max.businessDate ? dateStr(sent._max.businessDate) : null, lastReport: reported._max.periodTo ? dateStr(reported._max.periodTo) : null, idleDays: idle, ageFlag: ageFlag(idle) });
    }
    return out;
  }

  // ── assignment ──
  /** Consignee accounts with the outlet / agent each is linked to (Sales Manager). */
  async assignments() {
    const locs = await this.prisma.db.location.findMany({ where: { type: 'CONSIGNEE', active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
    const ags = await this.prisma.db.consignmentAgreement.findMany({ where: { direction: 'OUT', active: true, counterpartyLocationId: { in: locs.map((l) => l.id) } }, include: { counterpartyLocation: { select: { id: true } } } });
    const outlets = await this.prisma.db.outlet.findMany({ where: { id: { in: ags.map((a) => a.outletId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    return locs.map((l) => { const a = ags.find((x) => x.counterpartyLocationId === l.id); return { consigneeId: l.id, consignee: l.name, agreementId: a?.id ?? null, outletId: a?.outletId ?? null, outletName: outlets.find((o) => o.id === a?.outletId)?.name ?? null, agentName: a?.agentName ?? null }; });
  }
  async assign(user: SessionUser, consigneeId: string, outletId: string | null) {
    const ags = await this.prisma.db.consignmentAgreement.findMany({ where: { direction: 'OUT', counterpartyLocationId: consigneeId, active: true } });
    if (!ags.length) throw new BadRequestException('This consignee has no agreement yet (the Owner creates consignee accounts)');
    const before = ags[0];
    let data: { outletId: string | null; agentKey: string | null; agentName: string | null } = { outletId: null, agentKey: null, agentName: null };
    let outletName = 'nobody';
    if (outletId) { const o = await this.outlets.assertTaggable(outletId); data = { outletId: o.id, agentKey: o.agentKey, agentName: o.agentName }; outletName = `${o.name} (${o.agentName})`; }
    await this.prisma.db.consignmentAgreement.updateMany({ where: { id: { in: ags.map((a) => a.id) } }, data });
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: consigneeId } });
    await this.audit.log({ action: 'ASSIGN_AGENT', entityType: 'ConsignmentAgreement', entityId: before.id, before: { agent: before.agentName }, after: data, userId: user.id });
    await this.notify.toRoles(['ADMIN'], { type: 'CONSIGNMENT_AGENT', title: `Consignee ${loc.name} is now the responsibility of ${outletName} (set by ${user.fullName})`, link: '/field/consignments' });
    if (data.agentKey && !data.agentKey.startsWith('name:')) await this.notify.toUsers([data.agentKey], { type: 'CONSIGNMENT_AGENT', title: `You are responsible for the consignment at ${loc.name}`, link: '/field/consignments' });
    return { ok: true };
  }

  // ── limits ──
  async limits() {
    const rows = await this.prisma.db.agentConsignmentLimit.findMany({ where: { status: { in: ['APPROVED', 'PENDING'] } }, orderBy: [{ agentName: 'asc' }, { createdAt: 'desc' }] });
    return rows.map((r) => ({ id: r.id, agentKey: r.agentKey, agentName: r.agentName, outletId: r.outletId, outletName: r.outletName, amount: Number(r.amount), status: r.status, notes: r.notes, createdAt: r.createdAt }));
  }
  private async limitFor(agentKey: string, outletId: string | null) { return this.prisma.db.agentConsignmentLimit.findFirst({ where: { agentKey, outletId, status: 'APPROVED' } }); }

  /** The Sales Manager proposes (a maximum in total for the agent, or for one outlet); the Owner approves. */
  async requestLimit(user: SessionUser, input: { agentKey: string; outletId?: string | null; amount: number; notes?: string }) {
    if (!isManager(user)) throw new ForbiddenException();
    if (!(input.amount > 0)) throw new BadRequestException('The maximum must be more than zero');
    const ag = (await this.outlets.agents()).find((a) => a.key === input.agentKey); if (!ag) throw new BadRequestException('Choose an agent');
    let outletName: string | null = null;
    if (input.outletId) { const o = await this.prisma.db.outlet.findFirst({ where: { id: input.outletId, deletedAt: null } }); if (!o) throw new BadRequestException('Choose an outlet'); outletName = o.name; input.agentKey = o.agentKey; }
    if (await this.prisma.db.agentConsignmentLimit.findFirst({ where: { agentKey: input.agentKey, outletId: input.outletId ?? null, status: 'PENDING' } })) throw new BadRequestException('A maximum for this is already waiting for the Owner');
    const row = await this.prisma.db.agentConsignmentLimit.create({ data: { agentKey: input.agentKey, agentName: ag.name, outletId: input.outletId ?? null, outletName, amount: input.amount.toFixed(2), notes: input.notes?.trim() || null, createdBy: user.id } });
    const prev = await this.limitFor(input.agentKey, input.outletId ?? null);
    const req = await this.approvals.request({ type: 'AGENT_CONSIGNMENT_LIMIT', documentType: 'AgentConsignmentLimit', documentId: row.id, requestedBy: user.id, summary: { controlNo: `Consignment maximum: ${outletName ? `${outletName} (${ag.name})` : `${ag.name}, all outlets`}`, locationName: `Agent: ${ag.name}`, total: input.amount.toFixed(2), previousMaximum: prev ? Number(prev.amount).toFixed(2) : 'none', notes: input.notes ?? '' } });
    await this.prisma.db.agentConsignmentLimit.update({ where: { id: row.id }, data: { approvalRequestId: req.id } });
    if (user.roleKey === 'ADMIN') await this.approvals.decide(req.id, user, 'APPROVE', 'Set by the Owner');
    return this.prisma.db.agentConsignmentLimit.findUniqueOrThrow({ where: { id: row.id } });
  }
  private async onLimitDecision(id: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const r = await this.prisma.db.agentConsignmentLimit.findUniqueOrThrow({ where: { id } });
      if (r.status !== 'PENDING') return;
      if (outcome === 'APPROVED') await this.prisma.db.agentConsignmentLimit.updateMany({ where: { agentKey: r.agentKey, outletId: r.outletId, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
      await this.prisma.db.agentConsignmentLimit.update({ where: { id }, data: { status: outcome, decidedAt: new Date() } });
      void actorId;
      const what = `${r.outletName ? `${r.outletName} (${r.agentName})` : `${r.agentName}, all outlets`}: ${peso(Number(r.amount))}`;
      if (r.createdBy) await this.notify.toUsers([r.createdBy], { type: 'CONSIGNMENT_LIMIT', title: `Consignment maximum for ${what} ${outcome === 'APPROVED' ? 'approved' : 'not approved'} by the Owner`, link: '/field/consignments' });
      if (outcome === 'APPROVED' && !r.agentKey.startsWith('name:')) await this.notify.toUsers([r.agentKey], { type: 'CONSIGNMENT_LIMIT', title: `Your consignment maximum${r.outletName ? ` for ${r.outletName}` : ''}: ${peso(Number(r.amount))}`, link: '/field/consignments' });
    });
  }

  /**
   * Stops a consignment out that would go over a maximum. Applies only to a consignee linked to an agent's outlet: that agent needs an approved
   * maximum (total), and the outlet's own maximum, if one was set, applies as well. Nothing is checked for consignees without an agent.
   */
  async assertWithinLimits(consigneeLocationId: string, items: { productId: string; qty: number }[]) {
    const ag = await this.prisma.db.consignmentAgreement.findFirst({ where: { direction: 'OUT', active: true, counterpartyLocationId: consigneeLocationId, agentKey: { not: null } } });
    if (!ag?.agentKey) return;
    const add = await this.srp(items);
    const agentLimit = await this.limitFor(ag.agentKey, null);
    if (!agentLimit) throw new BadRequestException(`No maximum consignment is set for ${ag.agentName}. The Sales Manager sets it and the Owner approves it first.`);
    const mine = await this.consignees({ agentKey: ag.agentKey });
    const total = mine.reduce((t, c) => t + c.value, 0);
    if (total + add > Number(agentLimit.amount) + 0.001) throw new BadRequestException(`This consignment (${peso(add)} at retail price) would take ${ag.agentName} to ${peso(total + add)}, over the approved maximum of ${peso(Number(agentLimit.amount))} (now ${peso(total)}).`);
    if (ag.outletId) {
      const ol = await this.limitFor(ag.agentKey, ag.outletId);
      if (ol) { const here = mine.filter((c) => c.outletId === ag.outletId).reduce((t, c) => t + c.value, 0); if (here + add > Number(ol.amount) + 0.001) throw new BadRequestException(`This consignment (${peso(add)}) would take the outlet to ${peso(here + add)}, over its approved maximum of ${peso(Number(ol.amount))} (now ${peso(here)}).`); }
    }
  }

  // ── views ──
  private async withLimits(rows: Awaited<ReturnType<AgentConsignmentsService['consignees']>>, agentKey: string) {
    const lim = await this.prisma.db.agentConsignmentLimit.findMany({ where: { agentKey, status: { in: ['APPROVED', 'PENDING'] } } });
    const total = rows.reduce((t, c) => t + c.value, 0);
    const agentLimit = lim.find((l) => !l.outletId && l.status === 'APPROVED'); const pending = lim.find((l) => !l.outletId && l.status === 'PENDING');
    const outlets = [...new Set(rows.map((r) => r.outletId).filter((x): x is string => !!x))].map((id) => { const l = lim.find((x) => x.outletId === id && x.status === 'APPROVED'); const used = rows.filter((r) => r.outletId === id).reduce((t, c) => t + c.value, 0); return { outletId: id, outletName: rows.find((r) => r.outletId === id)?.consignee ?? '', used, limit: l ? Number(l.amount) : null, pending: lim.some((x) => x.outletId === id && x.status === 'PENDING') }; });
    return { outstanding: total, unpaid: rows.reduce((t, c) => t + c.unpaid, 0), limit: agentLimit ? Number(agentLimit.amount) : null, pendingLimit: pending ? Number(pending.amount) : null, headroom: agentLimit ? Number(agentLimit.amount) - total : null, usedPct: agentLimit ? Math.round((total / Number(agentLimit.amount)) * 1000) / 10 : null, outlets };
  }

  /** The agent's own consignments: what is at each consignee, unpaid, ageing, and the maximums. */
  async mine(user: SessionUser) {
    requireAgent(user);
    const rows = await this.consignees({ agentKey: user.id });
    return { consignees: rows, ...(await this.withLimits(rows, user.id)) };
  }
  /** Every agent's consignment: outstanding, maximum, share used, unpaid and the oldest ageing (Sales Manager, Head Auditor, Owner). */
  async overview(user: SessionUser) {
    if (!canViewAll(user)) throw new ForbiddenException();
    const rows = await this.consignees({ agentKey: { not: null } });
    const keys = [...new Set(rows.map((r) => r.agentKey!))];
    const agents = [];
    for (const k of keys) { const mine = rows.filter((r) => r.agentKey === k); agents.push({ agentKey: k, agentName: mine[0].agentName, consignees: mine, ...(await this.withLimits(mine, k)), oldestIdle: Math.max(0, ...mine.map((m) => m.idleDays ?? 0)) }); }
    const withLimit = new Set((await this.limits()).filter((l) => !l.outletId).map((l) => l.agentKey));
    const noLimit = (await this.outlets.agents()).filter((a) => !withLimit.has(a.key) && keys.includes(a.key)).map((a) => a.name);
    return { agents: agents.sort((a, b) => a.agentName!.localeCompare(b.agentName!)), noLimit, limits: await this.limits(), assignments: isManager(user) ? await this.assignments() : [] };
  }
  /** For the daily alerts. */
  allConsignees() { return this.consignees({ agentKey: { not: null } }); }
  forAgent(key: string) { return this.consignees({ agentKey: key }).then((rows) => this.withLimits(rows, key)); }
}
