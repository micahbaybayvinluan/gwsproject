import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { addDays, dateStr, daysBetween, todayManila, toDateOnly } from '../common/manila';
import { requestContext } from '../common/request-context';
import { EngageService } from './engage.service';
import { LoyaltyService } from './loyalty.service';
import { MembersService } from './members.service';

const num = (x: unknown) => Number(x ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** What the Sales Manager and Owner learn from the members: top spenders to call, when and where they buy, where they come from, how well the counter captures them. */
@Injectable()
export class InsightsService {
  constructor(private prisma: PrismaService, private members: MembersService, private engage: EngageService, private loyalty: LoyaltyService) {}

  /** The best members by what they spent in the last 12 months, with the last time somebody called or wrote to them. */
  async topSpenders(limit = 20) {
    const list = (await this.members.list()).filter((m) => m.status === 'ACTIVE' && m.spent12m > 0).sort((a, b) => b.spent12m - a.spent12m).slice(0, limit);
    const last = await this.engage.lastContact(list.map((m) => m.id)); const today = todayManila();
    return list.map((m) => { const lc = last.get(m.id) ?? null; const days = lc ? daysBetween(lc, today) : null; return { id: m.id, memberNo: m.memberNo, fullName: m.fullName, phone: m.phone, email: m.email, tier: m.tier, spent12m: m.spent12m, orders: m.orders, lastPurchase: m.lastPurchase, favoriteProduct: m.favoriteProduct, lastContact: lc ? dateStr(lc) : null, daysSinceContact: days, needsCall: days == null || days > 30 }; });
  }

  /** When customers buy: orders and pesos by weekday and hour (Manila time), optionally only members of one segment or one branch. */
  async heatmap(q: { from?: string; to?: string; locationId?: string; segment?: string; membersOnly?: boolean }) {
    const from = q.from ? toDateOnly(q.from) : addDays(todayManila(), -89); const to = q.to ? toDateOnly(q.to) : todayManila();
    let ids: string[] | null = null;
    if (q.segment) ids = (await this.members.list({ segment: q.segment })).map((m) => m.id);
    const cond: Prisma.Sql[] = [Prisma.sql`d.voided_at IS NULL`, Prisma.sql`d.doc_date >= ${from}`, Prisma.sql`d.doc_date <= ${to}`];
    if (q.locationId) cond.push(Prisma.sql`d.location_id = ${q.locationId}`);
    if (ids) cond.push(Prisma.sql`d.member_id = ANY(${ids})`); else if (q.membersOnly) cond.push(Prisma.sql`d.member_id IS NOT NULL`);
    const rows = await requestContext.runSystem(async () => await this.prisma.db.$queryRaw<{ dow: number; hour: number; orders: number; amount: Prisma.Decimal }[]>(Prisma.sql`SELECT EXTRACT(DOW FROM ((d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila'))::int AS dow, EXTRACT(HOUR FROM ((d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila'))::int AS hour, COUNT(*)::int AS orders, SUM(d.grand_total) AS amount FROM sales_docs d WHERE ${Prisma.join(cond, ' AND ')} GROUP BY 1, 2`));
    const cells = rows.map((r) => ({ dow: r.dow, hour: r.hour, orders: r.orders, amount: round2(num(r.amount)) }));
    const byBranch = await requestContext.runSystem(async () => await this.prisma.db.$queryRaw<{ branch: string; orders: number; amount: Prisma.Decimal }[]>(Prisma.sql`SELECT loc.name AS branch, COUNT(*)::int AS orders, SUM(d.grand_total) AS amount FROM sales_docs d JOIN locations loc ON loc.id = d.location_id WHERE ${Prisma.join(cond, ' AND ')} GROUP BY loc.name ORDER BY SUM(d.grand_total) DESC`));
    return { from: dateStr(from), to: dateStr(to), cells, total: cells.reduce((t, c) => t + c.orders, 0), byBranch: byBranch.map((b) => ({ branch: b.branch, orders: b.orders, amount: round2(num(b.amount)) })) };
  }

  /** Where members come from, what they want, and which gym they train at: members, buyers, spending. */
  async acquisition() {
    const list = await this.members.list();
    const group = (key: (m: (typeof list)[number]) => string | null) => {
      const g = new Map<string, { label: string; members: number; buyers: number; spent: number }>();
      for (const m of list) { const k = key(m) ?? '—'; const x = g.get(k) ?? { label: k, members: 0, buyers: 0, spent: 0 }; x.members++; if (m.orders > 0) x.buyers++; x.spent += m.spent; g.set(k, x); }
      return [...g.values()].map((x) => ({ ...x, spent: round2(x.spent), avgSpent: x.members ? round2(x.spent / x.members) : 0 })).sort((a, b) => b.spent - a.spent);
    };
    return { total: list.length, heardFrom: group((m) => m.heardFrom), goal: group((m) => m.goal), gym: group((m) => m.outletName ?? m.gym), preferred: group((m) => m.preferredChannel), tier: group((m) => m.tier), source: group((m) => m.source) };
  }

  /** The share of sales tagged to a member (members vs walk-ins), per branch and per associate, against the Owner's target. */
  async capture(q: { from?: string; to?: string }) {
    const from = q.from ? toDateOnly(q.from) : addDays(todayManila(), -29); const to = q.to ? toDateOnly(q.to) : todayManila();
    const p = await this.loyalty.program();
    const byBranch = await requestContext.runSystem(async () => await this.prisma.db.$queryRaw<{ location_id: string; branch: string; sales: number; tagged: number }[]>(Prisma.sql`SELECT d.location_id, loc.name AS branch, COUNT(*)::int AS sales, COUNT(d.member_id)::int AS tagged FROM sales_docs d JOIN locations loc ON loc.id = d.location_id WHERE d.voided_at IS NULL AND d.doc_date >= ${from} AND d.doc_date <= ${to} AND loc.type IN ('BRANCH', 'WAREHOUSE') GROUP BY d.location_id, loc.name ORDER BY loc.name`));
    const byUser = await requestContext.runSystem(async () => await this.prisma.db.$queryRaw<{ user_id: string; branch: string; sales: number; tagged: number }[]>(Prisma.sql`SELECT d.prepared_by AS user_id, loc.name AS branch, COUNT(*)::int AS sales, COUNT(d.member_id)::int AS tagged FROM sales_docs d JOIN locations loc ON loc.id = d.location_id WHERE d.voided_at IS NULL AND d.doc_date >= ${from} AND d.doc_date <= ${to} AND loc.type IN ('BRANCH', 'WAREHOUSE') GROUP BY d.prepared_by, loc.name`));
    const users = await this.prisma.db.user.findMany({ where: { id: { in: byUser.map((u) => u.user_id) } }, select: { id: true, fullName: true } });
    const row = <T extends { sales: number; tagged: number }>(r: T) => ({ ...r, pct: r.sales ? round2((r.tagged / r.sales) * 100) : 0, met: r.sales ? (r.tagged / r.sales) * 100 >= p.captureTargetPct : false });
    return { from: dateStr(from), to: dateStr(to), targetPct: p.captureTargetPct, branches: byBranch.map((b) => row({ branch: b.branch, sales: b.sales, tagged: b.tagged })).sort((a, b) => a.pct - b.pct), associates: byUser.map((u) => row({ associate: users.find((x) => x.id === u.user_id)?.fullName ?? '', branch: u.branch, sales: u.sales, tagged: u.tagged })).filter((u) => u.sales >= 1).sort((a, b) => a.pct - b.pct) };
  }

  /** At the counter: what this member usually buys, and what members who buy it also take (that they do not buy yet). */
  async suggestions(memberId: string) {
    const mine = await this.prisma.db.$queryRaw<{ product_id: string; name: string; qty: number }[]>(Prisma.sql`SELECT l.product_id, p.name, SUM(l.qty)::int AS qty FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id JOIN products p ON p.id = l.product_id WHERE d.member_id = ${memberId} AND d.voided_at IS NULL AND NOT l.is_freebie GROUP BY l.product_id, p.name ORDER BY qty DESC LIMIT 5`);
    const own = new Set(mine.map((m) => m.product_id));
    const base = mine.slice(0, 3).map((m) => m.product_id);
    let addOn: { product_id: string; name: string; together: number }[] = [];
    if (base.length) addOn = await this.prisma.db.$queryRaw<{ product_id: string; name: string; together: number }[]>(Prisma.sql`SELECT l2.product_id, p.name, COUNT(DISTINCT d.id)::int AS together FROM sales_lines l1 JOIN sales_docs d ON d.id = l1.doc_id JOIN sales_lines l2 ON l2.doc_id = d.id AND l2.product_id <> l1.product_id AND NOT l2.is_freebie JOIN products p ON p.id = l2.product_id WHERE l1.product_id = ANY(${base}) AND NOT l1.is_freebie AND d.voided_at IS NULL AND p.active = true AND NOT (l2.product_id = ANY(${[...own]})) GROUP BY l2.product_id, p.name ORDER BY together DESC, p.name LIMIT 3`);
    const likes = await this.prisma.db.member.findUnique({ where: { id: memberId }, select: { flavorLikes: true, flavorDislikes: true, goal: true } });
    return { usual: mine.map((m) => ({ productId: m.product_id, name: m.name, qty: m.qty })), alsoBuy: addOn.map((a) => ({ productId: a.product_id, name: a.name, together: a.together })), likes: likes?.flavorLikes ?? null, dislikes: likes?.flavorDislikes ?? null, goal: likes?.goal ?? null };
  }

  /** Replacement tickets raised on the member's purchases. */
  async replacements(memberId: string) {
    const docs = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { memberId }, select: { id: true } }));
    if (!docs.length) return [];
    const rows = await this.prisma.db.replacementTicket.findMany({ where: { salesDocId: { in: docs.map((d) => d.id) } }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((r) => ({ id: r.id, ticketNo: r.ticketNo, status: r.status, drSiNo: r.drSiNo, date: dateStr(r.createdAt), qty: r.qty }));
  }

  /** For an outlet / gym: the members who train there, with what they spent. */
  async outletMembers(outletId: string) {
    const ms = await this.prisma.db.member.findMany({ where: { outletId }, orderBy: { fullName: 'asc' }, take: 500 });
    const st = await this.members.stats(ms.map((m) => m.id));
    return ms.map((m) => ({ id: m.id, memberNo: m.memberNo, fullName: m.fullName, phone: m.phone, orders: st.get(m.id)?.orders ?? 0, spent: round2(st.get(m.id)?.spent ?? 0), lastPurchase: st.get(m.id)?.lastDate ? dateStr(st.get(m.id)!.lastDate!) : null }));
  }
}
