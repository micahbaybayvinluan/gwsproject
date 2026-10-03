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
export interface PromoInput { title: string; details: string; audience: PromoAudience; startsOn: string; endsOn: string; items?: { productId: string; promoPrice: number }[] }
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

  private shape(p: Prisma.PromoGetPayload<{ include: { items: true } }>, names: Map<string, { sku: string; name: string }>, regular?: Map<string, Record<string, Prisma.Decimal | number>>) {
    const today = todayManila();
    const running = p.status === 'ACTIVE' && p.startsOn <= today && p.endsOn >= today;
    const tier = p.audience === 'FRANCHISES' ? 'FRANCHISE' : 'RETAIL';
    return {
      id: p.id, title: p.title, details: p.details, audience: p.audience, startsOn: dateStr(p.startsOn), endsOn: dateStr(p.endsOn), status: p.status, memoId: p.memoId, createdByName: p.createdByName, createdAt: p.createdAt, cancelReason: p.cancelReason,
      state: p.status === 'CANCELLED' ? 'CANCELLED' : running ? 'RUNNING' : p.endsOn < today ? 'ENDED' : 'UPCOMING', daysLeft: running ? Math.round((p.endsOn.getTime() - today.getTime()) / 86400000) : null,
      items: p.items.map((i) => ({ productId: i.productId, sku: names.get(i.productId)?.sku ?? '', product: names.get(i.productId)?.name ?? '', promoPrice: Number(i.promoPrice), regularPrice: regular?.get(i.productId)?.[tier] != null ? Number(regular.get(i.productId)![tier]) : null })),
    };
  }

  private async shapeAll(rows: Prisma.PromoGetPayload<{ include: { items: true } }>[], showRegular: boolean) {
    const ids = [...new Set(rows.flatMap((r) => r.items.map((i) => i.productId)))];
    const prods = await this.prisma.db.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, name: true } });
    const names = new Map(prods.map((p) => [p.id, { sku: p.sku, name: p.name }]));
    const regular = showRegular && ids.length ? await this.master.currentPrices(ids) : undefined;
    return rows.map((r) => this.shape(r, names, regular as never));
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
    return this.shapeAll(rows, user.permissions.has('price.view.RETAIL'));
  }

  async create(user: SessionUser, input: PromoInput) {
    if (!['BRANCHES', 'FRANCHISES'].includes(input.audience)) throw new BadRequestException('Choose who the promo is for: the branches or the franchises');
    const title = input.title?.trim(); if (!title || title.length < 3) throw new BadRequestException('Type the promo name');
    const details = input.details?.trim(); if (!details) throw new BadRequestException('Describe the promo (what the customer gets, any rules)');
    const startsOn = toDateOnly(input.startsOn), endsOn = toDateOnly(input.endsOn); const today = todayManila();
    if (endsOn < startsOn) throw new BadRequestException('The promo cannot end before it starts');
    if (endsOn < today) throw new BadRequestException('The end date has already passed');
    const items = [...new Map((input.items ?? []).map((i) => [i.productId, i])).values()];
    for (const i of items) if (!(i.promoPrice > 0)) throw new BadRequestException('Each promo price must be more than zero');
    const prods = await this.prisma.db.product.findMany({ where: { id: { in: items.map((i) => i.productId) } }, select: { id: true, sku: true, name: true } });
    if (prods.length !== items.length) throw new BadRequestException('One of the promo items was not found');
    const tier = input.audience === 'FRANCHISES' ? 'FRANCHISE' : 'RETAIL';
    const regular = items.length ? await this.master.currentPrices(items.map((i) => i.productId)) : new Map();
    // the memo: what the promo is, when, who it is for and the prices
    const who = input.audience === 'FRANCHISES' ? 'all franchises' : 'all branches (franchises are not included)';
    const body = [details, `Applies to: ${who}.`, `Valid from ${longDate(startsOn)} to ${longDate(endsOn)}.`, items.length ? (input.audience === 'FRANCHISES' ? 'The promo price below applies automatically when the Franchise Coordinator records a franchise sale.' : 'The promo price below applies automatically at New Sale (cash and online sales on the retail price list; credit-card sales keep the card price).') : ''].filter(Boolean).join('\n\n');
    const table = items.length ? { headers: ['ITEM', 'REGULAR PRICE', 'PROMO PRICE'], rows: items.map((i) => { const p = prods.find((x) => x.id === i.productId)!; const reg = regular.get(i.productId)?.[tier]; return [`${p.sku} ${p.name}`, reg != null ? peso(reg) : '', peso(i.promoPrice)]; }) } : null;
    const audience = await this.memoAudience(input.audience);
    const memo = await this.memos.create({ subject: `PROMO: ${title}`, addressedTo: input.audience === 'FRANCHISES' ? 'ALL FRANCHISES' : 'ALL BRANCHES', body, table, audience }, user);
    const promo = await this.prisma.db.promo.create({ data: { title, details, audience: input.audience, startsOn, endsOn, memoId: memo.id, createdBy: user.id, createdByName: user.fullName, items: { create: items.map((i) => ({ productId: i.productId, promoPrice: i.promoPrice.toFixed(2) })) } }, include: { items: true } });
    // a highlighted notice on top of the memo notice, so nobody misses it
    const people = await this.memos.resolve(audience);
    await this.notify.toUsers(people.map((p) => p.id), { type: 'PROMO', title: `PROMO: ${title} (${dateStr(startsOn)} to ${dateStr(endsOn)})`, body: details.slice(0, 240), link: '/promos' });
    await this.audit.log({ action: 'CREATE', entityType: 'Promo', entityId: promo.id, after: { title, audience: input.audience, startsOn: dateStr(startsOn), endsOn: dateStr(endsOn), items: items.length, memoNo: memo.memoNo } });
    return { ...(await this.shapeAll([promo], true))[0], memoNo: memo.memoNo, notified: people.length };
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
    return (await this.shapeAll([{ ...p, status: 'CANCELLED', cancelReason: reason.trim() }], true))[0];
  }

  /** productId → the lowest promo price running on that date for the audience (used by New Sale). */
  async activePrices(date: Date, audience: PromoAudience): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.db.promoItem.findMany({ where: { promo: { audience, status: 'ACTIVE', startsOn: { lte: date }, endsOn: { gte: date } } }, select: { productId: true, promoPrice: true } });
    const m = new Map<string, Prisma.Decimal>();
    for (const r of rows) { const c = m.get(r.productId); if (!c || D(r.promoPrice).lt(D(c))) m.set(r.productId, r.promoPrice); }
    return m;
  }
}
