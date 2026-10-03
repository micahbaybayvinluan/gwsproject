import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MembersService } from '../members/members.service';
import { LoyaltyService } from '../members/loyalty.service';
import { PromosService } from '../promos/promos.service';
import { addDays, dateStr, todayManila, toDateOnly } from '../common/manila';
import { requestContext, type SessionUser } from '../common/request-context';

export const METHODS: [string, string][] = [['CALL', 'Phone call'], ['SMS', 'SMS'], ['WHATSAPP', 'WhatsApp'], ['VIBER', 'Viber'], ['MESSENGER', 'Messenger'], ['VISIT', 'In person / visited the store']];
export const OUTCOMES: [string, string][] = [['BOUGHT_AGAIN', 'Bought again'], ['WILL_BUY', 'Will buy (promised to come)'], ['NOT_BUYING', 'Not buying again'], ['NO_ANSWER', 'No answer, try again'], ['WRONG_NUMBER', 'Wrong or dead number'], ['GREETED', 'Greeted']];
/** Why a customer did not buy again: the staff pick one (and may add a note). */
export const REASONS: [string, string][] = [
  ['CHEAPER_ELSEWHERE', 'Found it cheaper in another store'], ['BOUGHT_ONLINE', 'Bought online (Shopee / Lazada / TikTok)'], ['NOT_WORKING', 'Not working out for them / no results'], ['SIDE_EFFECTS', 'Did not agree with them / side effects'],
  ['TASTE', 'Did not like the taste or flavor'], ['SWITCHED_BRAND', 'Switched to another brand'], ['STILL_HAS_STOCK', 'Still has stock at home'], ['OUT_OF_STOCK', 'We did not have it when they came'],
  ['NO_BUDGET', 'No budget right now'], ['STOPPED_TRAINING', 'Stopped training / no longer needs it'], ['COACH_ADVICE', 'Coach or doctor advised something else'], ['AUTHENTICITY', 'Worried about authenticity'],
  ['SERVICE', 'Unhappy with our service'], ['TOO_FAR', 'Store is too far / moved away'], ['PROMO_ELSEWHERE', 'Waiting for a promo'], ['OTHER', 'Other (write it in the note)'],
];
/** Reasons the Sales Manager is told about at once: product or service trouble, not just the market. */
const ALERT_REASONS = new Set(['NOT_WORKING', 'SIDE_EFFECTS', 'AUTHENTICITY', 'SERVICE']);
const label = (list: [string, string][], k: string | null | undefined) => list.find(([x]) => x === k)?.[1] ?? k ?? '';
const num = (x: unknown) => Number(x ?? 0);
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

export interface ContactInput { kind: 'RESTOCK' | 'BIRTHDAY' | 'WINBACK' | 'OTHER'; followUpId?: string | null; memberId?: string | null; customerName?: string | null; phone?: string | null; productId?: string | null; locationId?: string | null; method: string; outcome: string; reason?: string | null; note?: string | null; recontactOn?: string | null }

/**
 * Customer Service (owner request 2026-10-07): the to-do list of a branch, shown on the dashboard of its sales associates: customers who
 * should be due to restock (the supplement they bought should be finished), birthdays of the members who usually buy at the branch,
 * members who stopped coming, reservations to prepare and the running promos. Each customer approached gets a result: how they were
 * approached, whether they bought again and, if not, the reason. The Sales Manager and the Owner see the reasons added up.
 */
@Injectable()
export class CustomerServiceService {
  constructor(private prisma: PrismaService, private audit: AuditService, private notify: NotificationsService, private members: MembersService, private loyalty: LoyaltyService, private promos: PromosService) {}

  options() { return { methods: METHODS.map(([key, label]) => ({ key, label })), outcomes: OUTCOMES.map(([key, label]) => ({ key, label })), reasons: REASONS.map(([key, label]) => ({ key, label })) }; }

  private scope(user: SessionUser) { return user.locationScoped ? user.locationIds : null; }

  /** The branch to-do list. */
  async board(user: SessionUser) {
    const locs = this.scope(user); const today = todayManila();
    const locRows = await this.prisma.db.location.findMany({ where: { active: true }, select: { id: true, name: true } }); const locName = new Map(locRows.map((l) => [l.id, l.name]));
    const inScope = (id: string) => !locs || locs.includes(id);

    // 1. restock due: the customer should have finished what they bought; those who already bought it again are not listed
    const fu = await this.prisma.db.customerFollowUp.findMany({ where: { status: { in: ['PENDING', 'NOTIFIED'] }, dueDate: { lte: addDays(today, 2) }, ...(locs ? { locationId: { in: locs } } : {}) }, orderBy: { dueDate: 'asc' }, take: 150 });
    const again = fu.length ? await this.boughtAgain(fu.map((f) => f.id)) : new Map<string, Date>();
    const prods = new Map((await this.prisma.db.product.findMany({ where: { id: { in: [...new Set(fu.map((f) => f.productId))] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    const restock = fu.filter((f) => !again.has(f.id)).slice(0, 60).map((f) => ({ id: f.id, customer: f.customerName ?? 'Customer', phone: f.phone, email: f.email, productId: f.productId, product: prods.get(f.productId) ?? '', qty: f.qty, store: locName.get(f.locationId) ?? '', locationId: f.locationId, dueDate: dateStr(f.dueDate), daysOver: daysBetween(f.dueDate, today), status: f.status }));
    const cameBack = fu.filter((f) => again.has(f.id)).length;

    // 2 + 3. members: birthdays and those who stopped coming, by the branch where they usually buy
    const home = await this.members.homeBoard();
    const people = await this.prisma.db.member.findMany({ where: { status: 'ACTIVE' }, select: { id: true, memberNo: true, fullName: true, phone: true, birthday: true, preferredChannel: true } });
    const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1)); const recent = addDays(today, -30);
    const contacts = await this.prisma.db.customerContact.findMany({ where: { memberId: { not: null }, createdAt: { gte: yearStart } }, select: { memberId: true, kind: true, createdAt: true } });
    const greeted = new Set(contacts.filter((c) => c.kind === 'BIRTHDAY').map((c) => c.memberId!));
    const touched = new Set(contacts.filter((c) => c.createdAt >= recent).map((c) => c.memberId!));
    const birthdays: unknown[] = []; const winback: { row: unknown; spent: number }[] = [];
    for (const m of people) {
      const h = home.get(m.id); if (!h || !inScope(h.locationId)) continue;
      if (m.birthday) {
        let next = new Date(Date.UTC(today.getUTCFullYear(), m.birthday.getUTCMonth(), m.birthday.getUTCDate()));
        if (daysBetween(next, today) > 2) next = new Date(Date.UTC(today.getUTCFullYear() + 1, m.birthday.getUTCMonth(), m.birthday.getUTCDate()));
        const d = daysBetween(today, next);
        if (d >= -2 && d <= 7) birthdays.push({ memberId: m.id, memberNo: m.memberNo, name: m.fullName, phone: m.phone, preferredChannel: m.preferredChannel, birthday: dateStr(next).slice(5), inDays: d, store: locName.get(h.locationId) ?? '', locationId: h.locationId, greeted: greeted.has(m.id), lastPurchase: dateStr(h.lastDate), orders: h.orders });
      }
      const since = daysBetween(h.lastDate, today);
      if (since >= 46 && since <= 180 && h.orders >= 2 && !touched.has(m.id)) winback.push({ spent: h.spent, row: { memberId: m.id, memberNo: m.memberNo, name: m.fullName, phone: m.phone, preferredChannel: m.preferredChannel, store: locName.get(h.locationId) ?? '', locationId: h.locationId, lastPurchase: dateStr(h.lastDate), daysSince: since, orders: h.orders, spent: Math.round(h.spent * 100) / 100 } });
    }
    (birthdays as { inDays: number }[]).sort((a, b) => a.inDays - b.inDays);
    winback.sort((a, b) => b.spent - a.spent);

    // 4. reservations to prepare, 5. promos, 6. how the branch is doing this month
    const reservations = await this.prisma.db.reservation.count({ where: { status: { in: ['REQUESTED', 'READY'] }, ...(locs ? { locationId: { in: locs } } : {}) } });
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const month = await this.prisma.db.customerContact.groupBy({ by: ['outcome'], where: { createdAt: { gte: monthStart }, ...(locs ? { locationId: { in: locs } } : {}) }, _count: true });
    const cnt = (o: string) => month.find((x) => x.outcome === o)?._count ?? 0;
    return {
      today: dateStr(today), scope: locs ? locs.map((l) => locName.get(l) ?? '').join(', ') : 'All branches',
      restock, birthdays, winback: winback.slice(0, 25).map((w) => w.row), reservations, promos: await this.promos.activeFor(user),
      stats: { contactedThisMonth: month.reduce((t, x) => t + x._count, 0), boughtAgain: cnt('BOUGHT_AGAIN'), notBuying: cnt('NOT_BUYING'), cameBackOnTheirOwn: cameBack },
    };
  }

  /** follow-up id → the date the same customer bought the same product again (matched by the member or the mobile number). */
  private async boughtAgain(ids: string[]) {
    const rows = await requestContext.runSystem(async () => await this.prisma.db.$queryRaw<{ id: string; again: Date }[]>(Prisma.sql`
      SELECT f.id, MIN(d.doc_date) AS again FROM customer_follow_ups f
      JOIN sales_docs src ON src.id = f.sales_doc_id
      JOIN sales_docs d ON d.voided_at IS NULL AND d.id <> src.id AND d.created_at > src.created_at
        AND ((src.member_id IS NOT NULL AND d.member_id = src.member_id)
          OR (length(regexp_replace(COALESCE(f.phone, ''), '\\D', '', 'g')) >= 10 AND right(regexp_replace(COALESCE(d.customer_phone, ''), '\\D', '', 'g'), 10) = right(regexp_replace(f.phone, '\\D', '', 'g'), 10)))
      JOIN sales_lines l ON l.doc_id = d.id AND l.product_id = f.product_id AND NOT l.is_freebie
      WHERE f.id = ANY(${ids}) GROUP BY f.id`));
    return new Map(rows.map((r) => [r.id, r.again]));
  }

  /** Records how a customer was approached and what came of it. */
  async record(user: SessionUser, i: ContactInput) {
    if (!['RESTOCK', 'BIRTHDAY', 'WINBACK', 'OTHER'].includes(i.kind)) throw new BadRequestException('Unknown kind');
    if (!METHODS.some(([k]) => k === i.method)) throw new BadRequestException('Choose how the customer was approached');
    if (!OUTCOMES.some(([k]) => k === i.outcome)) throw new BadRequestException('Choose the result');
    const reason = i.reason || null;
    if (i.outcome === 'NOT_BUYING') { if (!reason || !REASONS.some(([k]) => k === reason)) throw new BadRequestException('Choose why the customer is not buying again'); if (reason === 'OTHER' && !(i.note ?? '').trim()) throw new BadRequestException('Write the reason in the note'); }
    const fu = i.followUpId ? await this.prisma.db.customerFollowUp.findUnique({ where: { id: i.followUpId } }) : null; if (i.followUpId && !fu) throw new NotFoundException('Follow-up not found');
    const member = i.memberId ? await this.prisma.db.member.findUnique({ where: { id: i.memberId } }) : null; if (i.memberId && !member) throw new NotFoundException('Member not found');
    const locationId = fu?.locationId ?? i.locationId ?? (member ? (await this.members.homeBoard()).get(member.id)?.locationId : undefined) ?? user.locationIds[0];
    if (!locationId) throw new BadRequestException('Choose the branch');
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException('Outside your branch');
    const recontactOn = i.recontactOn ? toDateOnly(i.recontactOn) : null;
    const row = await this.prisma.db.customerContact.create({ data: { kind: i.kind, followUpId: fu?.id ?? null, memberId: member?.id ?? null, productId: fu?.productId ?? i.productId ?? null, locationId, customerName: fu?.customerName ?? member?.fullName ?? i.customerName ?? null, phone: fu?.phone ?? member?.phone ?? i.phone ?? null, method: i.method, outcome: i.outcome, reason: i.outcome === 'NOT_BUYING' ? reason : null, note: i.note?.trim() || null, recontactOn, createdBy: user.id, createdByName: user.fullName } });
    if (fu) {
      if (i.outcome === 'NO_ANSWER') await this.prisma.db.customerFollowUp.update({ where: { id: fu.id }, data: { dueDate: recontactOn ?? addDays(todayManila(), 1), note: i.note?.trim() || fu.note } });
      else await this.prisma.db.customerFollowUp.update({ where: { id: fu.id }, data: { status: 'CONTACTED', note: [label(OUTCOMES, i.outcome), reason ? label(REASONS, reason) : '', i.note?.trim()].filter(Boolean).join(' · ') } });
    }
    if (member) await this.prisma.db.memberNote.create({ data: { memberId: member.id, kind: i.method === 'CALL' ? 'CALL' : 'MESSAGE', text: [`${label(METHODS, i.method)}: ${label(OUTCOMES, i.outcome)}`, reason ? label(REASONS, reason) : '', i.note?.trim()].filter(Boolean).join(' · '), createdBy: user.id, createdByName: user.fullName } });
    if (i.outcome === 'NOT_BUYING' && reason && ALERT_REASONS.has(reason)) {
      const loc = await this.prisma.db.location.findUnique({ where: { id: locationId }, select: { name: true } });
      await this.notify.toRoles(['SALES_MANAGER'], { type: 'CUSTOMER_FEEDBACK', title: `Customer not buying again: ${label(REASONS, reason)} (${loc?.name ?? ''}, ${row.customerName ?? 'customer'})`, body: (i.note ?? '').slice(0, 200), link: '/customer-service' });
    }
    await this.audit.log({ action: 'CREATE', entityType: 'CustomerContact', entityId: row.id, after: { kind: i.kind, outcome: i.outcome, reason } });
    return row;
  }

  /** Recent results recorded, for the branch (or all). */
  async contacts(user: SessionUser, q: { days?: number; locationId?: string }) {
    const locs = this.scope(user); if (q.locationId && locs && !locs.includes(q.locationId)) throw new ForbiddenException();
    const since = addDays(todayManila(), -(Math.max(1, Math.min(365, q.days ?? 30)) - 1));
    const rows = await this.prisma.db.customerContact.findMany({ where: { createdAt: { gte: since }, ...(q.locationId ? { locationId: q.locationId } : locs ? { locationId: { in: locs } } : {}) }, orderBy: { createdAt: 'desc' }, take: 300 });
    const [prods, locRows] = await Promise.all([this.prisma.db.product.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.productId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }), this.prisma.db.location.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.locationId))] } }, select: { id: true, name: true } })]);
    return rows.map((r) => ({ id: r.id, date: r.createdAt, kind: r.kind, customer: r.customerName ?? '', phone: r.phone, product: prods.find((p) => p.id === r.productId)?.name ?? '', store: locRows.find((l) => l.id === r.locationId)?.name ?? '', method: label(METHODS, r.method), outcome: r.outcome, outcomeLabel: label(OUTCOMES, r.outcome), reason: r.reason, reasonLabel: r.reason ? label(REASONS, r.reason) : '', note: r.note, by: r.createdByName }));
  }

  /** The Sales Manager's and Owner's view: how many were approached, how many came back, and why the others did not. */
  async reasons(user: SessionUser, days = 90) {
    const locs = this.scope(user); const since = addDays(todayManila(), -(Math.max(1, Math.min(365, days)) - 1));
    const rows = await this.prisma.db.customerContact.findMany({ where: { createdAt: { gte: since }, ...(locs ? { locationId: { in: locs } } : {}) }, take: 20000 });
    const [prods, locRows] = await Promise.all([this.prisma.db.product.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.productId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }), this.prisma.db.location.findMany({ select: { id: true, name: true } })]);
    const bought = rows.filter((r) => r.outcome === 'BOUGHT_AGAIN').length; const reached = rows.filter((r) => !['NO_ANSWER', 'WRONG_NUMBER'].includes(r.outcome)).length;
    const tally = <T extends string>(keys: (r: (typeof rows)[number]) => T | null | undefined, only?: (r: (typeof rows)[number]) => boolean) => { const m = new Map<string, number>(); for (const r of rows) { if (only && !only(r)) continue; const k = keys(r); if (k) m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const notBuying = (r: (typeof rows)[number]) => r.outcome === 'NOT_BUYING';
    const byBranch = locRows.map((l) => { const mine = rows.filter((r) => r.locationId === l.id); return { branch: l.name, approached: mine.length, boughtAgain: mine.filter((r) => r.outcome === 'BOUGHT_AGAIN').length, notBuying: mine.filter(notBuying).length, topReason: (() => { const t = new Map<string, number>(); for (const r of mine.filter(notBuying)) if (r.reason) t.set(r.reason, (t.get(r.reason) ?? 0) + 1); const top = [...t.entries()].sort((a, b) => b[1] - a[1])[0]; return top ? label(REASONS, top[0]) : ''; })() }; }).filter((b) => b.approached).sort((a, b) => b.approached - a.approached);
    const byProduct = [...new Set(rows.filter(notBuying).map((r) => r.productId).filter((x): x is string => !!x))].map((id) => { const mine = rows.filter((r) => notBuying(r) && r.productId === id); const t = new Map<string, number>(); for (const r of mine) if (r.reason) t.set(r.reason, (t.get(r.reason) ?? 0) + 1); const top = [...t.entries()].sort((a, b) => b[1] - a[1])[0]; return { product: prods.find((p) => p.id === id)?.name ?? '', notBuying: mine.length, topReason: top ? label(REASONS, top[0]) : '' }; }).sort((a, b) => b.notBuying - a.notBuying).slice(0, 15);
    const staff = new Map<string, { name: string; approached: number; boughtAgain: number }>(); for (const r of rows) { const x = staff.get(r.createdBy) ?? { name: r.createdByName ?? '', approached: 0, boughtAgain: 0 }; x.approached++; if (r.outcome === 'BOUGHT_AGAIN') x.boughtAgain++; staff.set(r.createdBy, x); }
    return {
      days, approached: rows.length, reached, boughtAgain: bought, boughtAgainPct: reached ? Math.round((bought / reached) * 1000) / 10 : 0, notBuying: rows.filter(notBuying).length,
      outcomes: tally((r) => r.outcome).map(([k, n]) => ({ key: k, label: label(OUTCOMES, k), count: n })), methods: tally((r) => r.method).map(([k, n]) => ({ key: k, label: label(METHODS, k), count: n })),
      reasons: tally((r) => r.reason, notBuying).map(([k, n]) => ({ key: k, label: label(REASONS, k), count: n })), byBranch, byProduct, byStaff: [...staff.values()].sort((a, b) => b.approached - a.approached),
      latestNotes: rows.filter((r) => notBuying(r) && r.note).slice(-12).reverse().map((r) => ({ date: dateStr(r.createdAt), customer: r.customerName ?? '', reason: label(REASONS, r.reason), note: r.note })),
    };
  }
}
