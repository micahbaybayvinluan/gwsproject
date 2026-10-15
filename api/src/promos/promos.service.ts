import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MemosService, type Audience } from '../memos/memos.service';
import { MasterService } from '../master/master.service';
import { D } from '../common/money';
import { dateStr, todayManila, toDateOnly } from '../common/manila';
import type { SessionUser } from '../common/request-context';

export type PromoAudience = 'BRANCHES' | 'FRANCHISES';
export interface PromoInput { title: string; details: string; audience: PromoAudience; startsOn: string; endsOn: string; items?: { productId: string; promoPrice?: number; discountPct?: number; internalQty?: number }[] }
export const PROMO_PERCENTS = [20, 30, 40, 50, 60, 70];
const longDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Promos (owner request 2026-10-07). The Owner or the Head Auditor issues a promo to every branch (not the franchises) or, separately,
 * to the franchises. Issuing makes a numbered memo for everyone concerned, sends a highlighted PROMO notice, and shows the promo on
 * their dashboard and at New Sale. When items carry a promo price, New Sale uses it by itself (no special-price approval) while the
 * promo runs: branches at the retail price list, franchises on the franchise price list.
 */
@Injectable()
export class PromosService {
  constructor(private prisma: PrismaService, private audit: AuditService, private notify: NotificationsService, private memos: MemosService, private master: MasterService) {}

  /** Which promos a person is meant to see: franchise staff the franchise promos, branch staff the branch promos, head office and issuers both. */
  audiencesFor(user: SessionUser): PromoAudience[] {
    if (user.roleKey === 'FRANCHISE_OWNER' || user.roleKey === 'FRANCHISE_SALES_ASSOCIATE') return ['FRANCHISES'];
    if (user.permissions.has('promo.issue') || user.roleKey === 'ADMIN' || user.roleKey.includes('FRANCHISE_COORDINATOR') || user.roleKey.endsWith('AUDITOR')) return ['BRANCHES', 'FRANCHISES'];
    return ['BRANCHES'];
  }

  private async memoAudience(a: PromoAudience): Promise<Audience> {
    if (a === 'FRANCHISES') return { franchiseOwners: true, franchiseAssociates: true, roles: ['FRANCHISE_COORDINATOR', 'ASST_FRANCHISE_COORDINATOR'] };
    const locs = await this.prisma.db.location.findMany({ where: { active: true, type: { in: ['BRANCH', 'WAREHOUSE'] } }, select: { id: true } });
    return { locationIds: locs.map((l) => l.id), roles: ['SALES_MANAGER', 'AGENT'] };
  }

  private shape(p: Prisma.PromoGetPayload<{ include: { items: true } }>, names: Map<string, { sku: string; name: string }>, regular?: Map<string, Record<string, Prisma.Decimal | number>>, sold?: Map<string, number>) {
    const today = todayManila();
    const running = p.status === 'ACTIVE' && p.startsOn <= today && p.endsOn >= today;
    const tier = p.audience === 'FRANCHISES' ? 'FRANCHISE' : 'RETAIL';
    return {
      id: p.id, title: p.title, details: p.details, audience: p.audience, startsOn: dateStr(p.startsOn), endsOn: dateStr(p.endsOn), status: p.status, memoId: p.memoId, createdByName: p.createdByName, createdAt: p.createdAt, cancelReason: p.cancelReason,
      state: p.status === 'CANCELLED' ? 'CANCELLED' : running ? 'RUNNING' : p.endsOn < today ? 'ENDED' : 'UPCOMING', daysLeft: running ? Math.round((p.endsOn.getTime() - today.getTime()) / 86400000) : null,
      items: p.items.map((i) => ({ productId: i.productId, sku: names.get(i.productId)?.sku ?? '', product: names.get(i.productId)?.name ?? '', promoPrice: Number(i.promoPrice), discountPct: i.discountPct, ...(sold ? { internalQty: i.internalQty, soldQty: sold.get(`${p.id}:${i.productId}`) ?? 0, remainingQty: i.internalQty == null ? null : i.internalQty - (sold.get(`${p.id}:${i.productId}`) ?? 0) } : {}), regularPrice: regular?.get(i.productId)?.[tier] != null ? Number(regular.get(i.productId)![tier]) : null })),
    };
  }

  private async shapeAll(rows: Prisma.PromoGetPayload<{ include: { items: true } }>[], showRegular: boolean, issuer = false) {
    const ids = [...new Set(rows.flatMap((r) => r.items.map((i) => i.productId)))];
    const prods = await this.prisma.db.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, name: true } });
    const names = new Map(prods.map((p) => [p.id, { sku: p.sku, name: p.name }]));
    const regular = showRegular && ids.length ? await this.master.currentPrices(ids) : undefined;
    // issuers also see the quantity set aside (internal) and how much was sold as promo sales
    let sold: Map<string, number> | undefined;
    if (issuer && rows.length) { sold = new Map(); const g = await this.prisma.db.salesLine.groupBy({ by: ['promoId', 'productId'], where: { promoId: { in: rows.map((r) => r.id) }, promoTicked: true, doc: { voidedAt: null } }, _sum: { qty: true } }); for (const x of g) sold.set(`${x.promoId}:${x.productId}`, x._sum.qty ?? 0); }
    return rows.map((r) => this.shape(r, names, regular as never, sold));
  }

  /** Promos that are running now for this person. */
  async activeFor(user: SessionUser) {
    const today = todayManila();
    const rows = await this.prisma.db.promo.findMany({ where: { status: 'ACTIVE', startsOn: { lte: today }, endsOn: { gte: today }, audience: { in: this.audiencesFor(user) } }, include: { items: true }, orderBy: { endsOn: 'asc' } });
    return this.shapeAll(rows, user.permissions.has('price.view.RETAIL'));
  }

  /** Issuers see every promo; everybody else the running and upcoming ones meant for them. */
  async list(user: SessionUser) {
    const today = todayManila();
    const issuer = user.permissions.has('promo.issue');
    const rows = await this.prisma.db.promo.findMany({ where: issuer ? {} : { status: 'ACTIVE', endsOn: { gte: today }, audience: { in: this.audiencesFor(user) } }, include: { items: true }, orderBy: [{ startsOn: 'desc' }, { createdAt: 'desc' }], take: 200 });
    return this.shapeAll(rows, user.permissions.has('price.view.RETAIL'), issuer);
  }

  async create(user: SessionUser, input: PromoInput) {
    if (!['BRANCHES', 'FRANCHISES'].includes(input.audience)) throw new BadRequestException('Choose who the promo is for: the branches or the franchises');
    const title = input.title?.trim(); if (!title || title.length < 3) throw new BadRequestException('Type the promo name');
    const details = input.details?.trim(); if (!details) throw new BadRequestException('Describe the promo (what the customer gets, any rules)');
    const startsOn = toDateOnly(input.startsOn), endsOn = toDateOnly(input.endsOn); const today = todayManila();
    if (endsOn < startsOn) throw new BadRequestException('The promo cannot end before it starts');
    if (endsOn < today) throw new BadRequestException('The end date has already passed');
    const items = [...new Map((input.items ?? []).map((i) => [i.productId, i])).values()];
    for (const i of items) {
      if (i.discountPct != null && !PROMO_PERCENTS.includes(i.discountPct)) throw new BadRequestException(`A percentage promo is ${PROMO_PERCENTS.join(', ')}% off`);
      if (i.discountPct == null && !(Number(i.promoPrice) > 0)) throw new BadRequestException('Each item needs a promo price or a percentage off');
      if (i.internalQty != null && (!Number.isInteger(i.internalQty) || i.internalQty < 1)) throw new BadRequestException('The internal quantity is a whole number, 1 or more');
    }
    const prods = await this.prisma.db.product.findMany({ where: { id: { in: items.map((i) => i.productId) } }, select: { id: true, sku: true, name: true } });
    if (prods.length !== items.length) throw new BadRequestException('One of the promo items was not found');
    const tier = input.audience === 'FRANCHISES' ? 'FRANCHISE' : 'RETAIL';
    const regular = items.length ? await this.master.currentPrices(items.map((i) => i.productId)) : new Map();
    // a percentage promo: the promo price is that much off the regular price of the audience (franchise list for franchises, retail list for branches)
    for (const i of items) if (i.discountPct != null && !(Number(i.promoPrice) > 0)) {
      const reg = regular.get(i.productId)?.[tier]; if (reg == null) throw new BadRequestException(`${prods.find((x) => x.id === i.productId)?.name ?? 'An item'} has no regular price to take ${i.discountPct}% off`);
      i.promoPrice = Math.round(Number(reg) * (100 - i.discountPct)) / 100;
    }
    // the memo: what the promo is, when, who it is for and the prices
    const who = input.audience === 'FRANCHISES' ? 'all franchises' : 'all branches (franchises are not included)';
    const body = [details, `Applies to: ${who}.`, `Valid from ${longDate(startsOn)} to ${longDate(endsOn)}.`, items.length ? (input.audience === 'FRANCHISES' ? 'The promo price below applies automatically when the Franchise Coordinator records a franchise sale.' : 'The promo price below applies automatically at New Sale (cash and online sales on the retail price list; credit-card sales keep the card price).') : ''].filter(Boolean).join('\n\n');
    const table = items.length ? { headers: ['ITEM', 'REGULAR PRICE', 'PROMO PRICE'], rows: items.map((i) => { const p = prods.find((x) => x.id === i.productId)!; const reg = regular.get(i.productId)?.[tier]; return [`${p.sku} ${p.name}`, reg != null ? peso(reg) : '', peso(i.promoPrice)]; }) } : null;
    const audience = await this.memoAudience(input.audience);
    const memo = await this.memos.create({ subject: `PROMO: ${title}`, addressedTo: input.audience === 'FRANCHISES' ? 'ALL FRANCHISES' : 'ALL BRANCHES', body, table, audience }, user);
    const promo = await this.prisma.db.promo.create({ data: { title, details, audience: input.audience, startsOn, endsOn, memoId: memo.id, createdBy: user.id, createdByName: user.fullName, items: { create: items.map((i) => ({ productId: i.productId, promoPrice: Number(i.promoPrice).toFixed(2), discountPct: i.discountPct ?? null, internalQty: i.internalQty ?? null })) } }, include: { items: true } });
    // a highlighted notice on top of the memo notice, so nobody misses it
    const people = await this.memos.resolve(audience);
    await this.notify.toUsers(people.map((p) => p.id), { type: 'PROMO', title: `PROMO: ${title} (${dateStr(startsOn)} to ${dateStr(endsOn)})`, body: details.slice(0, 240), link: '/promos' });
    await this.audit.log({ action: 'CREATE', entityType: 'Promo', entityId: promo.id, after: { title, audience: input.audience, startsOn: dateStr(startsOn), endsOn: dateStr(endsOn), items: items.length, memoNo: memo.memoNo } });
    return { ...(await this.shapeAll([promo], true, true))[0], memoNo: memo.memoNo, notified: people.length };
  }

  async cancel(user: SessionUser, id: string, reason: string) {
    const p = await this.prisma.db.promo.findUnique({ where: { id }, include: { items: true } }); if (!p) throw new NotFoundException();
    if (p.status === 'CANCELLED') throw new BadRequestException('Already cancelled');
    if (!reason?.trim()) throw new BadRequestException('Give the reason');
    await this.prisma.db.promo.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason.trim() } });
    const audience = await this.memoAudience(p.audience as PromoAudience);
    const people = await this.memos.resolve(audience);
    await this.notify.toUsers(people.map((x) => x.id), { type: 'PROMO', title: `PROMO CANCELLED: ${p.title}`, body: reason.trim(), link: '/promos' });
    if (p.memoId) { try { await this.memos.voidMemo(p.memoId, `Promo cancelled: ${reason.trim()}`, user); } catch (e) { if (!(e instanceof ForbiddenException)) throw e; } }
    await this.audit.log({ action: 'CANCEL', entityType: 'Promo', entityId: id, after: { reason } });
    return (await this.shapeAll([{ ...p, status: 'CANCELLED', cancelReason: reason.trim() }], true, true))[0];
  }

  /** productId → the promo (and its id) with the lowest price running on that date for the audience: the promo a ticked promo sale is counted against. */
  async activePromoIds(date: Date, audience: PromoAudience): Promise<Map<string, string>> {
    const rows = await this.prisma.db.promoItem.findMany({ where: { promo: { audience, status: 'ACTIVE', startsOn: { lte: date }, endsOn: { gte: date } } }, select: { productId: true, promoId: true, promoPrice: true } });
    const best = new Map<string, { id: string; price: Prisma.Decimal }>();
    for (const r of rows) { const c = best.get(r.productId); if (!c || D(r.promoPrice).lt(c.price)) best.set(r.productId, { id: r.promoId, price: D(r.promoPrice) }); }
    return new Map([...best].map(([k, v]) => [k, v.id]));
  }

  /** For the issuers: every sale line the associates ticked as a promo sale, by item and by branch, against the quantity set aside. */
  async sales(user: SessionUser, id: string) {
    const p = await this.prisma.db.promo.findUnique({ where: { id }, include: { items: true } }); if (!p) throw new NotFoundException();
    const lines = await this.prisma.db.salesLine.findMany({ where: { promoId: id, promoTicked: true, doc: { voidedAt: null } }, include: { doc: { select: { drSiNo: true, docDate: true, locationId: true, createdBy: true, id: true } }, product: { select: { sku: true, name: true } } }, orderBy: { doc: { docDate: 'desc' } }, take: 500 });
    const locs = new Map((await this.prisma.db.location.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]));
    const users = new Map((await this.prisma.db.user.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.doc.createdBy).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const byItem = p.items.map((i) => { const ls = lines.filter((l) => l.productId === i.productId); const sold = ls.reduce((n, l) => n + l.qty, 0); const pr = this.prisma.db; void pr; return { productId: i.productId, sku: ls[0]?.product.sku ?? '', product: ls[0]?.product.name ?? '', promoPrice: Number(i.promoPrice), internalQty: i.internalQty, soldQty: sold, remainingQty: i.internalQty == null ? null : i.internalQty - sold, over: i.internalQty != null && sold > i.internalQty }; });
    const byBranch = [...new Set(lines.map((l) => l.doc.locationId))].map((lid) => ({ branch: locs.get(lid) ?? '', qty: lines.filter((l) => l.doc.locationId === lid).reduce((n, l) => n + l.qty, 0), amount: lines.filter((l) => l.doc.locationId === lid).reduce((n, l) => n + Number(l.amount), 0) }));
    return { promoId: id, title: p.title, items: byItem, byBranch, sales: lines.map((l) => ({ saleId: l.doc.id, drSiNo: l.doc.drSiNo, date: dateStr(l.doc.docDate), branch: locs.get(l.doc.locationId) ?? '', by: l.doc.createdBy ? users.get(l.doc.createdBy) ?? '' : '', product: l.product.name, qty: l.qty, unitPrice: Number(l.unitPrice), amount: Number(l.amount) })) };
  }

  /** productId → the lowest promo price running on that date for the audience (used by New Sale). */
  async activePrices(date: Date, audience: PromoAudience): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.db.promoItem.findMany({ where: { promo: { audience, status: 'ACTIVE', startsOn: { lte: date }, endsOn: { gte: date } } }, select: { productId: true, promoPrice: true } });
    const m = new Map<string, Prisma.Decimal>();
    for (const r of rows) { const c = m.get(r.productId); if (!c || D(r.promoPrice).lt(D(c))) m.set(r.productId, r.promoPrice); }
    return m;
  }
}
