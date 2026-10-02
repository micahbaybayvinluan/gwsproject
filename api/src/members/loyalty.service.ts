import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { addDays, dateStr, todayManila, toDateOnly } from '../common/manila';
import { requestContext } from '../common/request-context';

/** The Owner's member program: points, tiers, vouchers, automatic messages and targets (one setting, edited on the Members page). */
export interface Program {
  pesoPerPoint: number; pointValue: number; minRedeemPoints: number; silverFrom: number; goldFrom: number; voucherValidDays: number;
  birthdayAuto: boolean; birthdayKind: 'AMOUNT' | 'PERCENT'; birthdayValue: number; anniversaryAuto: boolean; anniversaryValue: number;
  reorderAuto: boolean; winbackAuto: boolean; winbackValue: number; winbackMinPurchase: number; surveyAuto: boolean; surveyDays: number; surveyLowRating: number;
  referralValue: number; captureTargetPct: number; backInStockAuto: boolean;
}
export const PROGRAM_DEFAULTS: Program = { pesoPerPoint: 100, pointValue: 1, minRedeemPoints: 100, silverFrom: 10000, goldFrom: 30000, voucherValidDays: 30, birthdayAuto: false, birthdayKind: 'AMOUNT', birthdayValue: 100, anniversaryAuto: false, anniversaryValue: 100, reorderAuto: false, winbackAuto: false, winbackValue: 100, winbackMinPurchase: 500, surveyAuto: false, surveyDays: 3, surveyLowRating: 3, referralValue: 100, captureTargetPct: 30, backInStockAuto: true };
export const TIERS = ['BRONZE', 'SILVER', 'GOLD'] as const;
const num = (x: unknown) => Number(x ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface VoucherInput { kind: 'AMOUNT' | 'PERCENT'; value: number; source: string; validDays?: number; minPurchase?: number; note?: string | null; userId?: string | null }

@Injectable()
export class LoyaltyService {
  constructor(private prisma: PrismaService, private settings: SettingsService, private audit: AuditService, private notify: NotificationsService) {}

  // ── program ──
  async program(): Promise<Program> { return { ...PROGRAM_DEFAULTS, ...((await this.settings.get<Partial<Program>>('members.program')) ?? {}) }; }
  async saveProgram(userId: string, input: Partial<Program>) {
    const cur = await this.program(); const next: Program = { ...cur };
    for (const k of Object.keys(PROGRAM_DEFAULTS) as (keyof Program)[]) if (input[k] !== undefined && typeof input[k] === typeof PROGRAM_DEFAULTS[k]) (next as unknown as Record<string, unknown>)[k] = input[k];
    for (const k of ['pesoPerPoint', 'pointValue', 'minRedeemPoints', 'voucherValidDays', 'surveyDays'] as const) if (!(next[k] > 0)) throw new BadRequestException(`${k} must be more than zero`);
    if (next.goldFrom <= next.silverFrom) throw new BadRequestException('Gold must start above Silver');
    await this.settings.set('members.program', next, userId);
    await this.audit.log({ action: 'UPDATE', entityType: 'MemberProgram', entityId: 'members.program', before: cur, after: next, userId });
    return next;
  }

  // ── tier and points ──
  /** Spent in the last 12 months (tier) and for ever (points) per member, from sales tagged to them. */
  async spend(ids?: string[]): Promise<Map<string, { spent12m: number; lifetime: number }>> {
    const only = ids ? Prisma.sql`AND d.member_id = ANY(${ids})` : Prisma.empty;
    const since = addDays(todayManila(), -365);
    const rows = await this.prisma.db.$queryRaw<{ member_id: string; spent12m: Prisma.Decimal; lifetime: Prisma.Decimal }[]>(Prisma.sql`SELECT d.member_id, COALESCE(SUM(d.grand_total) FILTER (WHERE d.doc_date >= ${since}), 0) AS spent12m, SUM(d.grand_total) AS lifetime FROM sales_docs d WHERE d.member_id IS NOT NULL AND d.voided_at IS NULL ${only} GROUP BY d.member_id`);
    return new Map(rows.map((r) => [r.member_id, { spent12m: num(r.spent12m), lifetime: num(r.lifetime) }]));
  }
  tierOf(spent12m: number, p: Program): (typeof TIERS)[number] { return spent12m >= p.goldFrom ? 'GOLD' : spent12m >= p.silverFrom ? 'SILVER' : 'BRONZE'; }
  /** Tier, points and what is needed for the next tier, for the given members (all when none). */
  async standing(ids?: string[]) {
    const p = await this.program(); const sp = await this.spend(ids);
    const adj = await this.prisma.db.memberPointsEntry.groupBy({ by: ['memberId'], where: ids ? { memberId: { in: ids } } : undefined, _sum: { points: true } });
    const out = new Map<string, { tier: (typeof TIERS)[number]; spent12m: number; points: number; toNextTier: number | null; nextTier: string | null }>();
    const keys = new Set([...sp.keys(), ...adj.map((a) => a.memberId), ...(ids ?? [])]);
    for (const id of keys) {
      const s = sp.get(id); const spent12m = s?.spent12m ?? 0; const earned = Math.floor((s?.lifetime ?? 0) / p.pesoPerPoint); const used = adj.find((a) => a.memberId === id)?._sum.points ?? 0;
      const tier = this.tierOf(spent12m, p); const next = tier === 'BRONZE' ? { n: 'SILVER', at: p.silverFrom } : tier === 'SILVER' ? { n: 'GOLD', at: p.goldFrom } : null;
      out.set(id, { tier, spent12m: round2(spent12m), points: Math.max(0, earned + used), toNextTier: next ? Math.max(0, round2(next.at - spent12m)) : null, nextTier: next?.n ?? null });
    }
    return out;
  }

  async adjustPoints(userId: string | null, memberId: string, points: number, reason: string, refId?: string) {
    if (!Number.isInteger(points) || points === 0) throw new BadRequestException('Type the points (a whole number, + or −)');
    const st = (await this.standing([memberId])).get(memberId); if (points < 0 && (st?.points ?? 0) + points < 0) throw new BadRequestException('Not enough points');
    const e = await this.prisma.db.memberPointsEntry.create({ data: { memberId, points, reason, refId: refId ?? null, createdBy: userId } });
    await this.audit.log({ action: 'POINTS', entityType: 'Member', entityId: memberId, after: { points, reason }, userId: userId ?? undefined });
    return e;
  }
  /** Points → a voucher (the member, or staff for them). */
  async redeemPoints(userId: string | null, memberId: string, points: number) {
    const p = await this.program();
    if (!Number.isInteger(points) || points < p.minRedeemPoints) throw new BadRequestException(`Redeem at least ${p.minRedeemPoints} points`);
    const st = (await this.standing([memberId])).get(memberId); if ((st?.points ?? 0) < points) throw new BadRequestException(`Only ${st?.points ?? 0} points available`);
    const v = await this.issueVoucher(memberId, { kind: 'AMOUNT', value: round2(points * p.pointValue), source: 'POINTS', note: `${points} points`, userId });
    await this.prisma.db.memberPointsEntry.create({ data: { memberId, points: -points, reason: `Redeemed for voucher ${v.code}`, refId: v.id, createdBy: userId } });
    return v;
  }

  // ── vouchers ──
  async issueVoucher(memberId: string, i: VoucherInput) {
    if (!(i.value > 0)) throw new BadRequestException('The voucher value must be more than zero');
    if (i.kind === 'PERCENT' && i.value > 100) throw new BadRequestException('A percent voucher is at most 100%');
    const p = await this.program(); const days = i.validDays ?? p.voucherValidDays;
    for (let n = 0; ; n++) {
      try { return await this.prisma.db.memberVoucher.create({ data: { code: `V-${randomBytes(4).toString('hex').toUpperCase()}`, memberId, kind: i.kind, value: i.value.toFixed(2), minPurchase: (i.minPurchase ?? 0).toFixed(2), source: i.source, note: i.note ?? null, expiresOn: addDays(todayManila(), days), createdBy: i.userId ?? null } }); }
      catch (e) { if ((e as { code?: string }).code === 'P2002' && n < 5) continue; throw e; }
    }
  }
  async vouchers(memberId: string, onlyActive = false) {
    const today = todayManila();
    const rows = await this.prisma.db.memberVoucher.findMany({ where: { memberId, ...(onlyActive ? { usedAt: null, expiresOn: { gte: today } } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((v) => ({ id: v.id, code: v.code, kind: v.kind, value: num(v.value), minPurchase: num(v.minPurchase), source: v.source, note: v.note, expiresOn: dateStr(v.expiresOn), used: !!v.usedAt, usedAt: v.usedAt, expired: !v.usedAt && v.expiresOn < today, discountApplied: v.discountApplied == null ? null : num(v.discountApplied) }));
  }
  /** Checks a voucher for a sale: the member's own, unused, in date. */
  async validate(codeOrId: string, memberId: string, docDate: Date) {
    const v = await this.prisma.db.memberVoucher.findFirst({ where: { OR: [{ code: codeOrId.trim().toUpperCase() }, { id: codeOrId }] } });
    if (!v) throw new BadRequestException('Unknown voucher');
    if (v.memberId !== memberId) throw new BadRequestException('This voucher belongs to another member');
    if (v.usedAt) throw new BadRequestException(`The voucher ${v.code} was already used`);
    if (v.expiresOn < docDate) throw new BadRequestException(`The voucher ${v.code} expired on ${dateStr(v.expiresOn)}`);
    return v;
  }
  async markUsed(voucherId: string, saleId: string, discount: number) { await this.prisma.db.memberVoucher.update({ where: { id: voucherId }, data: { usedAt: new Date(), usedSaleId: saleId, discountApplied: discount.toFixed(2) } }); }
  /** A voided sale gives its voucher back. */
  async releaseForSale(saleId: string) { await this.prisma.db.memberVoucher.updateMany({ where: { usedSaleId: saleId }, data: { usedAt: null, usedSaleId: null, discountApplied: null } }); }

  // ── member prices ──
  async offers(activeOnly = false) {
    const today = todayManila();
    const rows = await this.prisma.db.memberOffer.findMany({ where: activeOnly ? { active: true, startsOn: { lte: today }, OR: [{ endsOn: null }, { endsOn: { gte: today } }] } : {}, orderBy: { createdAt: 'desc' }, take: 300 });
    const prods = await this.prisma.db.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, sku: true, name: true } });
    return rows.map((r) => ({ id: r.id, productId: r.productId, sku: prods.find((p) => p.id === r.productId)?.sku ?? '', product: prods.find((p) => p.id === r.productId)?.name ?? '', price: num(r.price), startsOn: dateStr(r.startsOn), endsOn: r.endsOn ? dateStr(r.endsOn) : null, active: r.active, note: r.note }));
  }
  /** productId → the member price running on that date. */
  async offerPrices(date: Date): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.db.memberOffer.findMany({ where: { active: true, startsOn: { lte: date }, OR: [{ endsOn: null }, { endsOn: { gte: date } }] }, orderBy: { price: 'asc' } });
    const m = new Map<string, Prisma.Decimal>(); for (const r of rows) if (!m.has(r.productId)) m.set(r.productId, r.price); return m;
  }
  async saveOffer(userId: string, i: { id?: string; productId: string; price: number; startsOn?: string; endsOn?: string | null; active?: boolean; note?: string | null }) {
    if (!(i.price > 0)) throw new BadRequestException('The member price must be more than zero');
    const prod = await this.prisma.db.product.findUnique({ where: { id: i.productId }, select: { id: true } }); if (!prod) throw new BadRequestException('Choose the product');
    const data = { productId: i.productId, price: i.price.toFixed(2), startsOn: i.startsOn ? toDateOnly(i.startsOn) : todayManila(), endsOn: i.endsOn ? toDateOnly(i.endsOn) : null, active: i.active ?? true, note: i.note ?? null };
    if (i.id) { if (!(await this.prisma.db.memberOffer.findUnique({ where: { id: i.id } }))) throw new NotFoundException(); return this.prisma.db.memberOffer.update({ where: { id: i.id }, data }); }
    return this.prisma.db.memberOffer.create({ data: { ...data, createdBy: userId } });
  }

  // ── referral ──
  /** A first purchase tagged to a referred member gives both a voucher (once). */
  async onFirstPurchase(memberId: string) {
    const m = await this.prisma.db.member.findUnique({ where: { id: memberId } });
    if (!m?.referredById || m.referralRewardedAt) return null;
    const p = await this.program(); if (!(p.referralValue > 0)) return null;
    const n = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.count({ where: { memberId, voidedAt: null } })); if (n !== 1) return null;
    const claim = await this.prisma.db.member.updateMany({ where: { id: memberId, referralRewardedAt: null }, data: { referralRewardedAt: new Date() } }); if (!claim.count) return null;
    const a = await this.issueVoucher(memberId, { kind: 'AMOUNT', value: p.referralValue, source: 'REFERRAL', note: 'Welcome reward: you were referred by a member' });
    const b = await this.issueVoucher(m.referredById, { kind: 'AMOUNT', value: p.referralValue, source: 'REFERRAL', note: `Referral reward: ${m.fullName} made a first purchase` });
    await this.notify.toRoles(['SALES_MANAGER'], { type: 'MEMBER_REFERRAL', title: `Referral reward given: ${m.fullName} and the member who referred them each got a voucher`, link: '/members' });
    return { a, b };
  }
}
