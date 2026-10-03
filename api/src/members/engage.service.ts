import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { addDays, dateStr, todayManila } from '../common/manila';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { LoyaltyService } from './loyalty.service';
import { MembersService } from './members.service';
import { MessagingService } from './messaging.service';
import { emailKeyOf, phMobile, phoneKeyOf, publicUrl, unsubscribeUrl } from './members.util';

const num = (x: unknown) => Number(x ?? 0);
const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const peso = (n: number) => `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
interface Reach { channel: 'SMS' | 'EMAIL'; to: string; key: string }

/**
 * Keeping members engaged (owner request 2026-10-03): the contact log, "how was it?" surveys with item reviews, items we lost a sale on,
 * reservations, back-in-stock alerts and the daily automatic messages (re-order, birthday, anniversary, win-back, survey).
 * Automatic messages go only when the Owner switched them on, only to people who agreed, and never twice for the same thing.
 */
@Injectable()
export class EngageService {
  constructor(private prisma: PrismaService, private notify: NotificationsService, private msg: MessagingService, private loyalty: LoyaltyService, private members: MembersService, private audit: AuditService) {}

  // ── contact log ──
  async addNote(user: SessionUser, memberId: string, kind: string, text: string) {
    if (!['CALL', 'COMPLAINT', 'NOTE', 'MESSAGE'].includes(kind)) throw new BadRequestException('Unknown kind');
    if (text.trim().length < 2) throw new BadRequestException('Type what was said or done');
    if (!(await this.prisma.db.member.findUnique({ where: { id: memberId }, select: { id: true } }))) throw new NotFoundException('Member not found');
    const n = await this.prisma.db.memberNote.create({ data: { memberId, kind, text: text.trim(), createdBy: user.id, createdByName: user.fullName } });
    if (kind === 'COMPLAINT') await this.notify.toRoles(['SALES_MANAGER'], { type: 'MEMBER_COMPLAINT', title: `Complaint logged for a member by ${user.fullName}`, body: text.trim().slice(0, 200), link: `/members` });
    return n;
  }
  notes(memberId: string) { return this.prisma.db.memberNote.findMany({ where: { memberId }, orderBy: { createdAt: 'desc' }, take: 100 }); }
  /** Last time somebody called / wrote to each member (the contact log and the automatic messages). */
  async lastContact(ids?: string[]): Promise<Map<string, Date>> {
    const where = ids ? { memberId: { in: ids } } : {};
    const [notes, autos] = await Promise.all([
      this.prisma.db.memberNote.groupBy({ by: ['memberId'], where: { ...where, kind: { in: ['CALL', 'MESSAGE'] } }, _max: { createdAt: true } }),
      this.prisma.db.memberAutoMessage.groupBy({ by: ['memberId'], where: { ...where, status: 'SENT' }, _max: { sentAt: true } }),
    ]);
    const m = new Map<string, Date>();
    for (const r of notes) if (r._max.createdAt) m.set(r.memberId, r._max.createdAt);
    for (const r of autos) if (r._max.sentAt && (!m.has(r.memberId) || m.get(r.memberId)! < r._max.sentAt)) m.set(r.memberId, r._max.sentAt);
    return m;
  }

  // ── lost sales (asked for, not available) ──
  async logLost(user: SessionUser, i: { productId?: string | null; itemText?: string | null; qty?: number; memberId?: string | null; locationId?: string; note?: string | null }) {
    const loc = i.locationId ?? user.locationIds[0]; if (!loc) throw new BadRequestException('Choose the branch');
    if (user.locationScoped && !user.locationIds.includes(loc)) throw new ForbiddenException('Outside your branch');
    let text = i.itemText?.trim() ?? '';
    if (i.productId) { const p = await this.prisma.db.product.findUnique({ where: { id: i.productId }, select: { name: true } }); if (!p) throw new BadRequestException('Unknown product'); text = text || p.name; }
    if (text.length < 2) throw new BadRequestException('Choose the item or type what the customer asked for');
    return this.prisma.db.lostSale.create({ data: { productId: i.productId ?? null, itemText: text, qty: Math.max(1, Math.round(i.qty ?? 1)), memberId: i.memberId ?? null, locationId: loc, note: i.note?.trim() || null, createdBy: user.id } });
  }
  async lostSummary(days: number, locationId?: string) {
    const since = addDays(todayManila(), -(Math.max(1, days) - 1));
    const rows = await this.prisma.db.lostSale.findMany({ where: { createdAt: { gte: since }, ...(locationId ? { locationId } : {}) }, orderBy: { createdAt: 'desc' }, take: 5000 });
    const locs = await this.prisma.db.location.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.locationId))] } }, select: { id: true, name: true } });
    const by = new Map<string, { key: string; productId: string | null; item: string; requests: number; qty: number; branches: Set<string>; last: Date }>();
    for (const r of rows) { const k = r.productId ?? `t:${r.itemText.toLowerCase()}`; const x = by.get(k) ?? { key: k, productId: r.productId, item: r.itemText, requests: 0, qty: 0, branches: new Set<string>(), last: r.createdAt }; x.requests++; x.qty += r.qty; x.branches.add(locs.find((l) => l.id === r.locationId)?.name ?? ''); if (r.createdAt > x.last) x.last = r.createdAt; by.set(k, x); }
    return { days, total: rows.length, items: [...by.values()].map((x) => ({ productId: x.productId, item: x.item, requests: x.requests, qty: x.qty, branches: [...x.branches].join(', '), last: dateStr(x.last) })).sort((a, b) => b.qty - a.qty), recent: rows.slice(0, 30).map((r) => ({ id: r.id, item: r.itemText, qty: r.qty, branch: locs.find((l) => l.id === r.locationId)?.name ?? '', note: r.note, date: dateStr(r.createdAt) })) };
  }
  async lostByProduct(days: number) { const since = addDays(todayManila(), -(days - 1)); const g = await this.prisma.db.lostSale.groupBy({ by: ['productId'], where: { createdAt: { gte: since }, productId: { not: null } }, _sum: { qty: true } }); return new Map(g.map((x) => [x.productId!, x._sum.qty ?? 0])); }

  // ── reservations ──
  async reserve(memberId: string, i: { productId: string; qty: number; locationId: string; note?: string | null }) {
    if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 50) throw new BadRequestException('Choose how many (1 to 50)');
    const [m, p, l] = await Promise.all([this.prisma.db.member.findUniqueOrThrow({ where: { id: memberId } }), this.prisma.db.product.findFirst({ where: { id: i.productId, active: true }, select: { id: true, name: true } }), this.prisma.db.location.findFirst({ where: { id: i.locationId, type: { in: ['BRANCH', 'WAREHOUSE'] }, isSelling: true, active: true }, select: { id: true, name: true } })]);
    if (!p) throw new BadRequestException('Unknown product'); if (!l) throw new BadRequestException('Choose a branch for pick-up');
    const r = await this.prisma.db.reservation.create({ data: { memberId, productId: p.id, qty: i.qty, locationId: l.id, note: i.note?.trim() || null } });
    await this.notify.toLocation(l.id, { type: 'MEMBER_RESERVATION', title: `Reservation: ${m.fullName} (${m.memberNo}) wants ${i.qty}× ${p.name}`, body: 'Prepare it and mark it ready on Wheysted Members → Reservations.', link: '/reservations' });
    return r;
  }
  async reservations(user: SessionUser, q: { locationId?: string; status?: string }) {
    const locs = q.locationId ? [q.locationId] : user.locationScoped ? user.locationIds : undefined;
    if (q.locationId && user.locationScoped && !user.locationIds.includes(q.locationId)) throw new ForbiddenException();
    const rows = await this.prisma.db.reservation.findMany({ where: { ...(locs ? { locationId: { in: locs } } : {}), ...(q.status ? { status: q.status } : { status: { in: ['REQUESTED', 'READY'] } }) }, include: { member: { select: { fullName: true, memberNo: true, phone: true } } }, orderBy: { createdAt: 'desc' }, take: 300 });
    const [prods, lcs] = await Promise.all([this.prisma.db.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, name: true, sku: true } }), this.prisma.db.location.findMany({ where: { id: { in: rows.map((r) => r.locationId) } }, select: { id: true, name: true } })]);
    return rows.map((r) => ({ id: r.id, member: r.member.fullName, memberNo: r.member.memberNo, phone: r.member.phone, product: prods.find((p) => p.id === r.productId)?.name ?? '', sku: prods.find((p) => p.id === r.productId)?.sku ?? '', qty: r.qty, branch: lcs.find((l) => l.id === r.locationId)?.name ?? '', status: r.status, note: r.note, date: dateStr(r.createdAt) }));
  }
  async setReservation(user: SessionUser, id: string, status: 'READY' | 'PICKED_UP' | 'CANCELLED') {
    const r = await this.prisma.db.reservation.findUnique({ where: { id }, include: { member: true } }); if (!r) throw new NotFoundException();
    if (user.locationScoped && !user.locationIds.includes(r.locationId)) throw new ForbiddenException();
    await this.prisma.db.reservation.update({ where: { id }, data: { status } });
    if (status === 'READY') { const p = await this.prisma.db.product.findUnique({ where: { id: r.productId }, select: { name: true } }); const l = await this.prisma.db.location.findUnique({ where: { id: r.locationId }, select: { name: true } }); await this.tell(r.member, 'reservation', `${id}:${status}`, { subject: 'Your reservation is ready', text: `Hi ${first(r.member.fullName)}! Your ${r.qty}× ${p?.name} is ready for pick-up at ${l?.name}. Show your Wheysted QR card at the counter.` }); }
    return { ok: true };
  }

  // ── back in stock ──
  async requestAlert(memberId: string, productId: string) {
    if (!(await this.prisma.db.product.findFirst({ where: { id: productId, active: true } }))) throw new BadRequestException('Unknown product');
    if (await this.prisma.db.stockAlertRequest.findFirst({ where: { memberId, productId, notifiedAt: null } })) return { ok: true, already: true };
    await this.prisma.db.stockAlertRequest.create({ data: { memberId, productId } }); return { ok: true };
  }

  // ── surveys ──
  async ensureInvite(memberId: string, saleId: string) {
    const ex = await this.prisma.db.surveyInvite.findUnique({ where: { saleId } }); if (ex) return ex;
    return this.prisma.db.surveyInvite.create({ data: { token: randomBytes(16).toString('hex'), memberId, saleId } });
  }
  async surveyView(token: string) {
    const inv = await this.prisma.db.surveyInvite.findUnique({ where: { token } }); if (!inv) throw new NotFoundException('This link is not valid');
    const m = await this.prisma.db.member.findUniqueOrThrow({ where: { id: inv.memberId }, select: { fullName: true } });
    const sale = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findUnique({ where: { id: inv.saleId }, select: { docDate: true, drSiNo: true, location: { select: { name: true } }, lines: { where: { isFreebie: false }, select: { productId: true, product: { select: { name: true } } } } } }));
    if (!sale) throw new NotFoundException('This link is not valid');
    const items = [...new Map(sale.lines.map((l) => [l.productId, { productId: l.productId, name: l.product.name }])).values()];
    return { member: first(m.fullName), date: dateStr(sale.docDate), drSiNo: sale.drSiNo, branch: sale.location.name, items, answered: !!inv.answeredAt };
  }
  async surveyAnswer(token: string, i: { rating: number; comment?: string | null; items?: { productId: string; wouldBuyAgain: boolean; comment?: string | null }[] }) {
    const inv = await this.prisma.db.surveyInvite.findUnique({ where: { token } }); if (!inv) throw new NotFoundException('This link is not valid');
    if (inv.answeredAt) throw new BadRequestException('Thank you, you already answered this one');
    if (!Number.isInteger(i.rating) || i.rating < 1 || i.rating > 5) throw new BadRequestException('Choose 1 to 5 stars');
    const view = await this.surveyView(token); const allowed = new Set(view.items.map((x) => x.productId));
    const r = await this.prisma.db.surveyResponse.create({ data: { inviteId: inv.id, memberId: inv.memberId, saleId: inv.saleId, rating: i.rating, comment: i.comment?.trim() || null, items: { create: (i.items ?? []).filter((x) => allowed.has(x.productId)).map((x) => ({ productId: x.productId, wouldBuyAgain: !!x.wouldBuyAgain, comment: x.comment?.trim() || null })) } } });
    await this.prisma.db.surveyInvite.update({ where: { id: inv.id }, data: { answeredAt: new Date() } });
    const p = await this.loyalty.program();
    if (i.rating <= p.surveyLowRating) {
      const m = await this.prisma.db.member.findUniqueOrThrow({ where: { id: inv.memberId }, select: { fullName: true, memberNo: true } });
      await this.prisma.db.memberNote.create({ data: { memberId: inv.memberId, kind: 'COMPLAINT', text: `Rated ${i.rating}/5 (${view.branch}, ${view.drSiNo})${i.comment ? `: ${i.comment.trim()}` : ''}`, createdByName: 'Survey' } });
      await this.notify.toRoles(['SALES_MANAGER', 'ADMIN'], { type: 'MEMBER_LOW_RATING', title: `Low rating: ${m.fullName} (${m.memberNo}) gave ${i.rating}/5 at ${view.branch}`, body: [i.comment, ...(i.items ?? []).filter((x) => !x.wouldBuyAgain).map((x) => `would not buy again: ${view.items.find((v) => v.productId === x.productId)?.name}`)].filter(Boolean).join(' · ').slice(0, 300), link: '/members' });
    }
    return { ok: true, id: r.id };
  }
  /** Ratings, by branch, the latest comments and which items members would not buy again. */
  async feedback(days: number, minVotes = 3) {
    const since = addDays(todayManila(), -(Math.max(1, days) - 1));
    const rs = await this.prisma.db.surveyResponse.findMany({ where: { createdAt: { gte: since } }, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 5000 });
    const sales = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { id: { in: rs.map((r) => r.saleId) } }, select: { id: true, drSiNo: true, location: { select: { name: true } } } }));
    const members = await this.prisma.db.member.findMany({ where: { id: { in: [...new Set(rs.map((r) => r.memberId))] } }, select: { id: true, fullName: true, memberNo: true } });
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
    const byBranch = new Map<string, number[]>(); for (const r of rs) { const b = sales.find((s) => s.id === r.saleId)?.location.name ?? ''; byBranch.set(b, [...(byBranch.get(b) ?? []), r.rating]); }
    const p = await this.loyalty.program();
    const items = new Map<string, { yes: number; no: number }>(); for (const r of rs) for (const it of r.items) { const x = items.get(it.productId) ?? { yes: 0, no: 0 }; if (it.wouldBuyAgain) x.yes++; else x.no++; items.set(it.productId, x); }
    const prods = await this.prisma.db.product.findMany({ where: { id: { in: [...items.keys()] } }, select: { id: true, name: true, sku: true } });
    return {
      days, responses: rs.length, average: avg(rs.map((r) => r.rating)), distribution: [1, 2, 3, 4, 5].map((n) => ({ stars: n, count: rs.filter((r) => r.rating === n).length })), lowRatingAt: p.surveyLowRating,
      byBranch: [...byBranch.entries()].map(([branch, v]) => ({ branch, average: avg(v), responses: v.length })).sort((a, b) => (a.average ?? 0) - (b.average ?? 0)),
      products: [...items.entries()].map(([id, x]) => { const votes = x.yes + x.no; const pr = prods.find((q) => q.id === id); return { productId: id, sku: pr?.sku ?? '', product: pr?.name ?? '', yes: x.yes, no: x.no, votes, wouldBuyAgainPct: Math.round((x.yes / votes) * 100), disappointing: votes >= minVotes && x.yes / votes < 0.6 }; }).sort((a, b) => a.wouldBuyAgainPct - b.wouldBuyAgainPct || b.votes - a.votes),
      latest: rs.slice(0, 50).map((r) => ({ id: r.id, date: dateStr(r.createdAt), member: members.find((m) => m.id === r.memberId)?.fullName ?? '', memberNo: members.find((m) => m.id === r.memberId)?.memberNo ?? '', branch: sales.find((s) => s.id === r.saleId)?.location.name ?? '', drSiNo: sales.find((s) => s.id === r.saleId)?.drSiNo ?? '', rating: r.rating, comment: r.comment, low: r.rating <= p.surveyLowRating })),
    };
  }

  // ── reaching a member ──
  private async optedOut(channel: string, key: string) { return !!(await this.prisma.db.messageOptOut.findUnique({ where: { channel_key: { channel, key } } })); }
  /** SMS or email, by the member's preference, only when they agreed and have a valid number / address. */
  async reach(m: { phone: string | null; email: string | null; smsOptIn: boolean; emailOptIn: boolean; preferredChannel: string | null }): Promise<Reach | null> {
    const sms = async (): Promise<Reach | null> => { const to = phMobile(m.phone); const key = phoneKeyOf(m.phone); return to && key && m.smsOptIn && !(await this.optedOut('SMS', key)) ? { channel: 'SMS', to, key } : null; };
    const email = async (): Promise<Reach | null> => { const key = emailKeyOf(m.email); return key && m.emailOptIn && !(await this.optedOut('EMAIL', key)) ? { channel: 'EMAIL', to: m.email!.trim(), key } : null; };
    return m.preferredChannel === 'EMAIL' ? (await email()) ?? (await sms()) : (await sms()) ?? (await email());
  }
  /** One automatic message, never twice (a failed or not-set-up one is tried again next time). */
  async tell(m: { id: string; fullName: string; phone: string | null; email: string | null; smsOptIn: boolean; emailOptIn: boolean; preferredChannel: string | null }, kind: string, key: string, text: { subject: string; text: string }): Promise<'SENT' | 'SKIPPED' | 'FAILED' | 'NOT_CONFIGURED' | 'ALREADY'> {
    const done = await this.prisma.db.memberAutoMessage.findUnique({ where: { kind_key: { kind, key } } });
    if (done?.status === 'SENT') return 'ALREADY';
    const to = await this.reach(m); if (!to) return 'SKIPPED';
    const res = to.channel === 'SMS' ? await this.msg.sms(to.to, text.text) : await this.msg.email(to.to, text.subject, `${text.text}\n\n—\nGet Wheysted Supplements. To stop getting these emails: ${unsubscribeUrl('EMAIL', to.key)}`, undefined, unsubscribeUrl('EMAIL', to.key));
    await this.prisma.db.memberAutoMessage.upsert({ where: { kind_key: { kind, key } }, create: { kind, key, memberId: m.id, channel: to.channel, status: res.status }, update: { status: res.status, channel: to.channel, sentAt: new Date() } });
    return res.status;
  }

  // ── the daily automatic messages ──
  async runDaily() {
    const p = await this.loyalty.program(); const today = todayManila(); const out = { storeBirthdays: 0, reorder: 0, birthday: 0, anniversary: 0, winback: 0, survey: 0, backInStock: 0, notConfigured: 0 };
    const count = (r: string, k: keyof typeof out) => { if (r === 'SENT') out[k]++; else if (r === 'NOT_CONFIGURED') out.notConfigured++; };
    const all = await this.prisma.db.member.findMany({ where: { status: 'ACTIVE' } });
    const mm = today.getUTCMonth(); const dd = today.getUTCDate();
    // birthday: the store where the member usually buys is told (always; the Customer Service list shows it too)
    const home = await this.members.homeBoard();
    for (const m of all) {
      if (!m.birthday || m.birthday.getUTCMonth() !== mm || m.birthday.getUTCDate() !== dd) continue;
      const loc = home.get(m.id)?.locationId; if (!loc) continue;
      const key = `${m.id}:${today.getUTCFullYear()}`;
      if (await this.prisma.db.memberAutoMessage.findUnique({ where: { kind_key: { kind: 'birthday-store', key } } })) continue;
      await this.notify.toLocation(loc, { type: 'MEMBER_BIRTHDAY', title: `Birthday today: ${m.fullName} (${m.memberNo}), a regular at your branch`, body: 'Greet them (call, message or when they visit) and record it under Customer Service on your dashboard.', link: '/customer-service' });
      await this.prisma.db.memberAutoMessage.create({ data: { kind: 'birthday-store', key, memberId: m.id, channel: 'STORE', status: 'SENT' } });
      out.storeBirthdays++;
    }
    // birthday and anniversary: a voucher and a message
    for (const m of all) {
      if (p.birthdayAuto && m.birthday && m.birthday.getUTCMonth() === mm && m.birthday.getUTCDate() === dd) {
        const key = `${m.id}:${today.getUTCFullYear()}`; const prior = await this.prisma.db.memberAutoMessage.findUnique({ where: { kind_key: { kind: 'birthday', key } } });
        if (!prior && (await this.reach(m))) { const v = await this.loyalty.issueVoucher(m.id, { kind: p.birthdayKind, value: p.birthdayValue, source: 'BIRTHDAY', note: 'Happy birthday!' }); count(await this.tell(m, 'birthday', key, { subject: 'Happy birthday from Wheysted!', text: `Happy birthday, ${first(m.fullName)}! 🎂 A gift from Get Wheysted: voucher ${v.code} worth ${p.birthdayKind === 'PERCENT' ? `${p.birthdayValue}% off` : peso(p.birthdayValue)}, valid until ${dateStr(v.expiresOn)}. Show it at the counter.` }), 'birthday'); }
      }
      if (p.anniversaryAuto && m.createdAt.getUTCFullYear() < today.getUTCFullYear() && m.createdAt.getUTCMonth() === mm && m.createdAt.getUTCDate() === dd) {
        const key = `${m.id}:${today.getUTCFullYear()}`; const prior = await this.prisma.db.memberAutoMessage.findUnique({ where: { kind_key: { kind: 'anniversary', key } } });
        if (!prior && (await this.reach(m))) { const v = await this.loyalty.issueVoucher(m.id, { kind: 'AMOUNT', value: p.anniversaryValue, source: 'ANNIVERSARY', note: 'Member anniversary' }); count(await this.tell(m, 'anniversary', key, { subject: 'Thank you for being a Wheysted member', text: `${first(m.fullName)}, thank you for being a Wheysted member since ${m.createdAt.getUTCFullYear()}! Voucher ${v.code}: ${peso(p.anniversaryValue)} off, valid until ${dateStr(v.expiresOn)}.` }), 'anniversary'); }
      }
    }
    // re-order reminders: the member's last purchase of an item that lasts N days is about to run out
    if (p.reorderAuto) {
      const lines = await requestContext.runSystem(async () => await this.prisma.db.salesLine.findMany({ where: { isFreebie: false, product: { consumptionDays: { not: null } }, doc: { memberId: { not: null }, voidedAt: null, docDate: { gte: addDays(today, -150) } } }, include: { doc: { select: { memberId: true, docDate: true, location: { select: { name: true } } } }, product: { select: { id: true, name: true, consumptionDays: true } }, batch: { select: { flavor: true } } } }));
      const latest = new Map<string, (typeof lines)[number]>(); for (const l of lines) { const k = `${l.doc.memberId}:${l.productId}`; const c = latest.get(k); if (!c || l.doc.docDate > c.doc.docDate) latest.set(k, l); }
      for (const l of latest.values()) {
        const due = addDays(l.doc.docDate, l.qty * (l.product.consumptionDays ?? 0));
        if (due > today || due < addDays(today, -14)) continue;
        const m = all.find((x) => x.id === l.doc.memberId); if (!m) continue;
        count(await this.tell(m, 'reorder', l.id, { subject: `Time to restock your ${l.product.name}?`, text: `Hi ${first(m.fullName)}! Your ${l.product.name}${l.batch.flavor ? ` (${l.batch.flavor})` : ''} should be about done. Same again? Message us or visit ${l.doc.location.name}. Show your Wheysted QR card.` }), 'reorder');
      }
    }
    // win-back: at risk / lapsed members, once every 60 days
    if (p.winbackAuto) {
      const list = await this.members.list({}); const block = Math.floor(today.getTime() / 86400000 / 60);
      for (const r of list) {
        if (r.status !== 'ACTIVE' || !(r.segments.includes('LAPSED') || r.segments.includes('AT_RISK'))) continue;
        const m = all.find((x) => x.id === r.id); if (!m) continue; const key = `${m.id}:${block}`;
        if (await this.prisma.db.memberAutoMessage.findUnique({ where: { kind_key: { kind: 'winback', key } } })) continue;
        if (!(await this.reach(m))) continue;
        const v = await this.loyalty.issueVoucher(m.id, { kind: 'AMOUNT', value: p.winbackValue, minPurchase: p.winbackMinPurchase, source: 'WINBACK', note: 'We miss you' });
        count(await this.tell(m, 'winback', key, { subject: 'We miss you at Wheysted', text: `We miss you, ${first(m.fullName)}! Come back with voucher ${v.code}: ${peso(p.winbackValue)} off a purchase of ${peso(p.winbackMinPurchase)} or more, until ${dateStr(v.expiresOn)}.` }), 'winback');
      }
    }
    // survey invitations a few days after a purchase
    if (p.surveyAuto) {
      const sales = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { memberId: { not: null }, voidedAt: null, docDate: { lte: addDays(today, -p.surveyDays), gte: addDays(today, -p.surveyDays - 10) } }, select: { id: true, memberId: true, location: { select: { name: true } } } }));
      for (const s of sales) {
        const m = all.find((x) => x.id === s.memberId); if (!m) continue; const inv = await this.ensureInvite(m.id, s.id); if (inv.answeredAt) continue;
        const r = await this.tell(m, 'survey', s.id, { subject: 'How was your Wheysted purchase?', text: `Hi ${first(m.fullName)}! How was your purchase at ${s.location.name}? Rate it in 20 seconds: ${publicUrl()}/survey?t=${inv.token}` });
        if (r === 'SENT') await this.prisma.db.surveyInvite.update({ where: { id: inv.id }, data: { sentAt: new Date() } });
        count(r, 'survey');
      }
    }
    // back in stock: a member asked to be told
    if (p.backInStockAuto) {
      const reqs = await this.prisma.db.stockAlertRequest.findMany({ where: { notifiedAt: null }, take: 2000 });
      const stock = await this.prisma.db.stockBalance.groupBy({ by: ['productId'], where: { productId: { in: [...new Set(reqs.map((r) => r.productId))] }, qty: { gt: 0 }, location: { type: { in: ['WAREHOUSE', 'BRANCH'] } } }, _sum: { qty: true } });
      const prods = await this.prisma.db.product.findMany({ where: { id: { in: [...new Set(reqs.map((r) => r.productId))] } }, select: { id: true, name: true } });
      for (const r of reqs) {
        if (!(stock.find((s) => s.productId === r.productId)?._sum.qty ?? 0)) continue;
        const m = all.find((x) => x.id === r.memberId); if (!m) continue; const name = prods.find((x) => x.id === r.productId)?.name ?? 'The item you asked about';
        const res = await this.tell(m, 'backinstock', r.id, { subject: `${name} is back`, text: `Good news, ${first(m.fullName)}: ${name} is available again at Get Wheysted. Reserve it on your member page or visit a branch.` });
        count(res, 'backInStock'); if (res === 'SENT' || res === 'SKIPPED') await this.prisma.db.stockAlertRequest.update({ where: { id: r.id }, data: { notifiedAt: new Date() } });
      }
    }
    return out;
  }
}
