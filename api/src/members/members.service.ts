import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { dateStr, daysBetween, todayManila } from '../common/manila';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { emailKeyOf, memberNoOf, newQrToken, phoneKeyOf, qrValue } from './members.util';
import { LoyaltyService } from './loyalty.service';

export interface MemberProfile { goal?: string | null; gym?: string | null; trainingDays?: string | null; budget?: string | null; dietary?: string | null; flavorLikes?: string | null; flavorDislikes?: string | null; heardFrom?: string | null; outletId?: string | null; preferredChannel?: string | null; bestTime?: string | null; messengerHandle?: string | null }
export interface MemberInput extends MemberProfile { fullName: string; phone?: string | null; email?: string | null; birthday?: string | null; emailOptIn?: boolean; smsOptIn?: boolean; notes?: string | null; status?: 'ACTIVE' | 'BLOCKED'; referredByNo?: string | null }
export const GOALS = ['MUSCLE_GAIN', 'WEIGHT_LOSS', 'ENDURANCE', 'GENERAL_HEALTH', 'STRENGTH', 'OTHER'] as const;
export const HEARD_FROM = ['FACEBOOK', 'TIKTOK', 'INSTAGRAM', 'GYM', 'FRIEND', 'WALK_IN', 'SHOPEE_LAZADA', 'OTHER'] as const;
export const CHANNELS = ['SMS', 'EMAIL', 'WHATSAPP', 'VIBER', 'MESSENGER'] as const;
const clean = (v: unknown) => { const t = typeof v === 'string' ? v.trim() : ''; return t ? t.slice(0, 200) : null; };
/** The profile fields that are plain text or one of a list. */
function profileData(i: MemberProfile): Prisma.MemberUpdateInput {
  const d: Prisma.MemberUpdateInput = {};
  for (const k of ['gym', 'trainingDays', 'budget', 'dietary', 'flavorLikes', 'flavorDislikes', 'messengerHandle'] as const) if (i[k] !== undefined) d[k] = clean(i[k]);
  if (i.goal !== undefined) { const g = clean(i.goal); if (g && !(GOALS as readonly string[]).includes(g)) throw new BadRequestException('Unknown goal'); d.goal = g; }
  if (i.heardFrom !== undefined) { const g = clean(i.heardFrom); if (g && !(HEARD_FROM as readonly string[]).includes(g)) throw new BadRequestException('Unknown source'); d.heardFrom = g; }
  if (i.preferredChannel !== undefined) { const g = clean(i.preferredChannel); if (g && !(CHANNELS as readonly string[]).includes(g)) throw new BadRequestException('Unknown channel'); d.preferredChannel = g; }
  if (i.bestTime !== undefined) { const g = clean(i.bestTime); if (g && !['MORNING', 'AFTERNOON', 'EVENING'].includes(g)) throw new BadRequestException('Unknown time'); d.bestTime = g; }
  return d;
}
export interface Stats { orders: number; spent: number; firstDate: Date | null; lastDate: Date | null; favProduct: string | null; favProductQty: number; favBrand: string | null; favCategory: string | null; topBranch: string | null }
export const SEGMENTS: Record<string, string> = { VIP: 'VIP (top spenders)', FREQUENT: 'Frequent buyers', NEW: 'New (joined in the last 30 days)', AT_RISK: 'At risk (no purchase for 46–90 days)', LAPSED: 'Lapsed (no purchase for over 90 days)', NEVER: 'Never bought', BIRTHDAY: 'Birthday this month' };

const num = (x: unknown) => Number(x ?? 0);

/**
 * Wheysted members (owner request 2026-10-03). A member has a number (WHY-000001) and a QR card; the counter finds them by number, name,
 * phone or a QR scan and tags the sale to them, so every purchase is on their account. Stats (visits, spending, favorites) and segments
 * come from the sales tagged to the member. Cost never appears anywhere here.
 */
@Injectable()
export class MembersService {
  constructor(private prisma: PrismaService, private audit: AuditService, private loyalty: LoyaltyService) {}

  // ── creation ──
  private async nextNo(): Promise<string> {
    const last = await this.prisma.db.member.findFirst({ orderBy: { memberNo: 'desc' }, select: { memberNo: true } });
    return memberNoOf((last ? Number(last.memberNo.replace(/\D/g, '')) : 0) + 1);
  }

  /** Makes the member; the number and QR token are created here. Duplicate phone / email is refused with the existing member named. */
  async create(input: MemberInput & { password?: string; consent?: boolean }, opts: { source: 'PORTAL' | 'STAFF' | 'IMPORT'; passwordHash?: string | null; userId?: string | null; backfill?: boolean }) {
    const fullName = input.fullName.trim(); if (fullName.length < 2) throw new BadRequestException('Type the full name');
    const phone = input.phone?.trim() || null; const email = input.email?.trim() || null;
    const phoneKey = phoneKeyOf(phone); const emailKey = emailKeyOf(email);
    if (phone && !phoneKey) throw new BadRequestException('Type a mobile number with at least 10 digits');
    if (email && !emailKey) throw new BadRequestException('That email address is not valid');
    if (!phoneKey && !emailKey) throw new BadRequestException('A mobile number or an email address is needed');
    const dup = await this.prisma.db.member.findFirst({ where: { OR: [...(phoneKey ? [{ phoneKey }] : []), ...(emailKey ? [{ emailKey }] : [])] } });
    if (dup) throw new BadRequestException({ message: `${dup.fullName} (${dup.memberNo}) already uses that ${dup.phoneKey === phoneKey ? 'mobile number' : 'email address'}`, existingId: dup.id });
    let referredById: string | null = null;
    if (input.referredByNo?.trim()) { const ref = await this.prisma.db.member.findFirst({ where: { memberNo: input.referredByNo.trim().toUpperCase() }, select: { id: true } }); if (!ref) throw new BadRequestException('That member number (who referred you) was not found'); referredById = ref.id; }
    if (input.outletId && !(await this.prisma.db.outlet.findFirst({ where: { id: input.outletId, deletedAt: null }, select: { id: true } }))) throw new BadRequestException('Unknown gym / outlet');
    const profile = profileData(input) as Prisma.MemberUncheckedCreateInput;
    for (let attempt = 0; ; attempt++) {
      try {
        const m = await this.prisma.db.member.create({ data: { ...profile, outletId: input.outletId ?? null, referredById, memberNo: await this.nextNo(), qrToken: newQrToken(), fullName, phone, phoneKey, email, emailKey, birthday: input.birthday ? new Date(`${input.birthday}T00:00:00Z`) : null, passwordHash: opts.passwordHash ?? null, emailOptIn: input.emailOptIn ?? true, smsOptIn: input.smsOptIn ?? true, source: opts.source, notes: input.notes ?? null, consentAt: input.consent ? new Date() : null, createdBy: opts.userId ?? null } });
        await this.audit.log({ action: 'CREATE', entityType: 'Member', entityId: m.id, after: { memberNo: m.memberNo, fullName, source: opts.source }, userId: opts.userId ?? undefined });
        // staff vouch for the person: past sales with the same number belong to them (never done for a customer's own sign-up)
        if (opts.backfill && phoneKey) await this.linkPastSales(m.id);
        return m;
      } catch (e) { if ((e as { code?: string }).code === 'P2002' && attempt < 5) continue; throw e; }
    }
  }

  /** Sales (not yet tagged to anybody) that carry this member's mobile number or email. */
  async linkPastSales(memberId: string) {
    const m = await this.prisma.db.member.findUniqueOrThrow({ where: { id: memberId } });
    return requestContext.runSystem(async () => {
      let n = 0;
      if (m.phoneKey) n += await this.prisma.db.$executeRaw`UPDATE sales_docs SET member_id = ${m.id} WHERE member_id IS NULL AND customer_phone IS NOT NULL AND right(regexp_replace(customer_phone, '\\D', '', 'g'), 10) = ${m.phoneKey}`;
      if (m.emailKey) n += await this.prisma.db.$executeRaw`UPDATE sales_docs SET member_id = ${m.id} WHERE member_id IS NULL AND customer_email IS NOT NULL AND lower(customer_email) = ${m.emailKey}`;
      return n;
    });
  }

  /** Members made from the people already in the sales (customer phone / email entered at the counter). */
  async importFromSales(user: SessionUser) {
    const docs = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { memberId: null, voidedAt: null, OR: [{ customerPhone: { not: null } }, { customerEmail: { not: null } }] }, select: { customerName: true, customerPhone: true, customerEmail: true, docDate: true }, orderBy: { docDate: 'desc' } }));
    const seen = new Set<string>(); let created = 0; let skipped = 0;
    for (const d of docs) {
      const pk = phoneKeyOf(d.customerPhone); const ek = emailKeyOf(d.customerEmail); const key = pk ?? ek; if (!key || seen.has(key)) continue; seen.add(key);
      const name = d.customerName?.trim(); if (!name || name.length < 2) { skipped++; continue; }
      try { await this.create({ fullName: name, phone: pk ? d.customerPhone : null, email: ek ? d.customerEmail : null }, { source: 'IMPORT', userId: user.id, backfill: true }); created++; } catch { skipped++; }
    }
    await this.audit.log({ action: 'IMPORT', entityType: 'Member', entityId: 'sales', after: { created, skipped }, userId: user.id });
    return { created, skipped, message: `${created} member${created === 1 ? '' : 's'} made from the customers in your sales${skipped ? `; ${skipped} skipped (no name, or already a member)` : ''}. Their past purchases are now on their accounts.` };
  }

  async update(user: SessionUser | null, id: string, input: Partial<MemberInput>) {
    const m = await this.prisma.db.member.findUnique({ where: { id } }); if (!m) throw new NotFoundException('Member not found');
    const data: Prisma.MemberUpdateInput = {};
    if (input.fullName !== undefined) { if (input.fullName.trim().length < 2) throw new BadRequestException('Type the full name'); data.fullName = input.fullName.trim(); }
    if (input.phone !== undefined) { const pk = phoneKeyOf(input.phone); if (input.phone && !pk) throw new BadRequestException('Type a mobile number with at least 10 digits'); if (pk && pk !== m.phoneKey && (await this.prisma.db.member.findFirst({ where: { phoneKey: pk } }))) throw new BadRequestException('That mobile number belongs to another member'); data.phone = input.phone?.trim() || null; data.phoneKey = pk; }
    if (input.email !== undefined) { const ek = emailKeyOf(input.email); if (input.email && !ek) throw new BadRequestException('That email address is not valid'); if (ek && ek !== m.emailKey && (await this.prisma.db.member.findFirst({ where: { emailKey: ek } }))) throw new BadRequestException('That email belongs to another member'); data.email = input.email?.trim() || null; data.emailKey = ek; }
    if (input.birthday !== undefined) data.birthday = input.birthday ? new Date(`${input.birthday}T00:00:00Z`) : null;
    if (input.emailOptIn !== undefined) data.emailOptIn = input.emailOptIn;
    if (input.smsOptIn !== undefined) data.smsOptIn = input.smsOptIn;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.status) data.status = input.status;
    Object.assign(data, profileData(input));
    if (input.outletId !== undefined) { if (input.outletId && !(await this.prisma.db.outlet.findFirst({ where: { id: input.outletId, deletedAt: null }, select: { id: true } }))) throw new BadRequestException('Unknown gym / outlet'); data.outletId = input.outletId || null; }
    const after = await this.prisma.db.member.update({ where: { id }, data });
    await this.audit.log({ action: 'UPDATE', entityType: 'Member', entityId: id, before: { fullName: m.fullName, phone: m.phone, email: m.email, status: m.status }, after: { fullName: after.fullName, phone: after.phone, email: after.email, status: after.status }, userId: user?.id });
    return after;
  }
  /** The customer forgot their password and has no way back: the next sign-up with the member number sets a new one. */
  async resetPortal(user: SessionUser, id: string) { await this.prisma.db.member.update({ where: { id }, data: { passwordHash: null } }); await this.audit.log({ action: 'RESET_PORTAL', entityType: 'Member', entityId: id, userId: user.id }); return { ok: true }; }

  // ── finding a member at the counter ──
  /** By member number, QR scan (WHY:token), mobile number, name or email. */
  async lookup(q: string) {
    const t = q.trim(); if (t.length < 2) return [];
    const where: Prisma.MemberWhereInput[] = [];
    const tok = /^WHY:([0-9a-f]{24})$/i.exec(t); const no = /^WHY-?(\d{1,6})$/i.exec(t);
    if (tok) where.push({ qrToken: tok[1].toLowerCase() });
    else if (no) where.push({ memberNo: memberNoOf(Number(no[1])) });
    else {
      const pk = t.replace(/\D/g, '');
      if (pk.length >= 7) where.push({ phoneKey: { endsWith: pk.slice(-10) } });
      where.push({ fullName: { contains: t, mode: 'insensitive' } }, { email: { contains: t, mode: 'insensitive' } }, { memberNo: { contains: t, mode: 'insensitive' } });
    }
    const rows = await this.prisma.db.member.findMany({ where: { OR: where, status: 'ACTIVE' }, take: 10, orderBy: { fullName: 'asc' } });
    const stats = await this.stats(rows.map((r) => r.id));
    return rows.map((m) => ({ id: m.id, memberNo: m.memberNo, fullName: m.fullName, phone: m.phone, email: m.email, orders: stats.get(m.id)?.orders ?? 0, lastPurchase: stats.get(m.id)?.lastDate ? dateStr(stats.get(m.id)!.lastDate!) : null, favorite: stats.get(m.id)?.favProduct ?? null }));
  }

  // ── numbers per member ──
  async stats(ids?: string[]): Promise<Map<string, Stats>> {
    const only = ids ? Prisma.sql`AND d.member_id = ANY(${ids})` : Prisma.empty;
    const [agg, prod, brand, cat, branch] = await Promise.all([
      this.prisma.db.$queryRaw<{ member_id: string; orders: number; spent: Prisma.Decimal; first_date: Date; last_date: Date }[]>(Prisma.sql`SELECT d.member_id, COUNT(*)::int AS orders, SUM(d.grand_total) AS spent, MIN(d.doc_date) AS first_date, MAX(d.doc_date) AS last_date FROM sales_docs d WHERE d.member_id IS NOT NULL AND d.voided_at IS NULL ${only} GROUP BY d.member_id`),
      this.prisma.db.$queryRaw<{ member_id: string; name: string; qty: number }[]>(Prisma.sql`SELECT DISTINCT ON (x.member_id) x.member_id, x.name, x.qty FROM (SELECT d.member_id, p.name, SUM(l.qty)::int AS qty FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id JOIN products p ON p.id = l.product_id WHERE d.member_id IS NOT NULL AND d.voided_at IS NULL AND NOT l.is_freebie ${only} GROUP BY d.member_id, p.name) x ORDER BY x.member_id, x.qty DESC, x.name`),
      this.prisma.db.$queryRaw<{ member_id: string; name: string }[]>(Prisma.sql`SELECT DISTINCT ON (x.member_id) x.member_id, x.name FROM (SELECT d.member_id, p.brand AS name, SUM(l.qty) AS qty FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id JOIN products p ON p.id = l.product_id WHERE d.member_id IS NOT NULL AND d.voided_at IS NULL AND NOT l.is_freebie AND p.brand IS NOT NULL ${only} GROUP BY d.member_id, p.brand) x ORDER BY x.member_id, x.qty DESC, x.name`),
      this.prisma.db.$queryRaw<{ member_id: string; name: string }[]>(Prisma.sql`SELECT DISTINCT ON (x.member_id) x.member_id, x.name FROM (SELECT d.member_id, c.name AS name, SUM(l.qty) AS qty FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id JOIN products p ON p.id = l.product_id JOIN categories c ON c.id = p.category_id WHERE d.member_id IS NOT NULL AND d.voided_at IS NULL AND NOT l.is_freebie ${only} GROUP BY d.member_id, c.name) x ORDER BY x.member_id, x.qty DESC, x.name`),
      this.prisma.db.$queryRaw<{ member_id: string; name: string }[]>(Prisma.sql`SELECT DISTINCT ON (x.member_id) x.member_id, x.name FROM (SELECT d.member_id, loc.name AS name, COUNT(*) AS n FROM sales_docs d JOIN locations loc ON loc.id = d.location_id WHERE d.member_id IS NOT NULL AND d.voided_at IS NULL ${only} GROUP BY d.member_id, loc.name) x ORDER BY x.member_id, x.n DESC, x.name`),
    ]);
    const out = new Map<string, Stats>();
    for (const a of agg) out.set(a.member_id, { orders: a.orders, spent: num(a.spent), firstDate: a.first_date, lastDate: a.last_date, favProduct: null, favProductQty: 0, favBrand: null, favCategory: null, topBranch: null });
    for (const r of prod) { const s = out.get(r.member_id); if (s) { s.favProduct = r.name; s.favProductQty = r.qty; } }
    for (const r of brand) { const s = out.get(r.member_id); if (s) s.favBrand = r.name; }
    for (const r of cat) { const s = out.get(r.member_id); if (s) s.favCategory = r.name; }
    for (const r of branch) { const s = out.get(r.member_id); if (s) s.topBranch = r.name; }
    return out;
  }

  /** Every member with their numbers and segments (the list is sorted and filtered on screen). */
  async list(q: { segment?: string; search?: string } = {}) {
    const members = await this.prisma.db.member.findMany({ orderBy: { createdAt: 'desc' }, take: 20000 });
    const stats = await this.stats();
    const standing = await this.loyalty.standing();
    const outlets = await this.prisma.db.outlet.findMany({ where: { id: { in: [...new Set(members.map((m) => m.outletId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
    const today = todayManila();
    const buyers = members.filter((m) => (stats.get(m.id)?.orders ?? 0) >= 2).map((m) => stats.get(m.id)!.spent).sort((a, b) => b - a);
    const vipFrom = buyers.length ? buyers[Math.max(0, Math.ceil(buyers.length * 0.1) - 1)] : Infinity;
    const rows = members.map((m) => {
      const s = stats.get(m.id); const orders = s?.orders ?? 0; const daysSince = s?.lastDate ? daysBetween(s.lastDate, today) : null;
      const months = s?.firstDate ? Math.max(1, daysBetween(s.firstDate, today) / 30) : 1; const perMonth = orders ? Math.round((orders / months) * 100) / 100 : 0;
      const segments: string[] = [];
      if (!orders) segments.push('NEVER');
      if (daysBetween(m.createdAt, today) <= 30) segments.push('NEW');
      if (daysSince != null && daysSince > 90) segments.push('LAPSED'); else if (daysSince != null && daysSince > 45 && orders >= 2) segments.push('AT_RISK');
      if (orders >= 3 && perMonth >= 1) segments.push('FREQUENT');
      if (orders >= 2 && s && s.spent >= vipFrom) segments.push('VIP');
      if (m.birthday && m.birthday.getUTCMonth() === today.getUTCMonth()) segments.push('BIRTHDAY');
      return { id: m.id, memberNo: m.memberNo, fullName: m.fullName, phone: m.phone, email: m.email, birthday: m.birthday ? dateStr(m.birthday) : null, source: m.source, status: m.status, emailOptIn: m.emailOptIn, smsOptIn: m.smsOptIn, hasPortal: !!m.passwordHash, joined: dateStr(m.createdAt), orders, spent: Math.round((s?.spent ?? 0) * 100) / 100, avgOrder: orders ? Math.round(((s?.spent ?? 0) / orders) * 100) / 100 : 0, firstPurchase: s?.firstDate ? dateStr(s.firstDate) : null, lastPurchase: s?.lastDate ? dateStr(s.lastDate) : null, daysSince, ordersPerMonth: perMonth, favoriteProduct: s?.favProduct ?? null, favoriteBrand: s?.favBrand ?? null, favoriteCategory: s?.favCategory ?? null, topBranch: s?.topBranch ?? null, segments, tier: standing.get(m.id)?.tier ?? 'BRONZE', points: standing.get(m.id)?.points ?? 0, spent12m: standing.get(m.id)?.spent12m ?? 0, goal: m.goal, gym: m.gym, heardFrom: m.heardFrom, preferredChannel: m.preferredChannel, bestTime: m.bestTime, outletId: m.outletId, outletName: outlets.find((o) => o.id === m.outletId)?.name ?? null, referredById: m.referredById, messengerHandle: m.messengerHandle };
    });
    const words = (q.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => (!q.segment || r.segments.includes(q.segment)) && (!words.length || words.every((w) => `${r.memberNo} ${r.fullName} ${r.phone ?? ''} ${r.email ?? ''} ${r.favoriteProduct ?? ''} ${r.favoriteBrand ?? ''} ${r.goal ?? ''} ${r.gym ?? ''}`.toLowerCase().includes(w))));
  }

  /** One member: contact, numbers, favorites, monthly spending and the purchases with their items. */
  async get(id: string) {
    const m = await this.prisma.db.member.findUnique({ where: { id } }); if (!m) throw new NotFoundException('Member not found');
    const row = (await this.list()).find((r) => r.id === id)!;
    const purchases = await this.purchases(id, 100);
    const favProducts = await this.prisma.db.$queryRaw<{ name: string; qty: number; times: number; amount: Prisma.Decimal }[]>(Prisma.sql`SELECT p.name, SUM(l.qty)::int AS qty, COUNT(DISTINCT d.id)::int AS times, SUM(l.amount) AS amount FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id JOIN products p ON p.id = l.product_id WHERE d.member_id = ${id} AND d.voided_at IS NULL AND NOT l.is_freebie GROUP BY p.name ORDER BY qty DESC, p.name LIMIT 10`);
    const monthly = await this.prisma.db.$queryRaw<{ month: string; total: Prisma.Decimal; orders: number }[]>(Prisma.sql`SELECT to_char(d.doc_date, 'YYYY-MM') AS month, SUM(d.grand_total) AS total, COUNT(*)::int AS orders FROM sales_docs d WHERE d.member_id = ${id} AND d.voided_at IS NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 12`);
    const profile = { dietary: m.dietary, flavorLikes: m.flavorLikes, flavorDislikes: m.flavorDislikes, trainingDays: m.trainingDays, budget: m.budget, messengerHandle: m.messengerHandle, referralNo: m.referredById ? (await this.prisma.db.member.findUnique({ where: { id: m.referredById }, select: { memberNo: true } }))?.memberNo ?? null : null };
    return { ...row, ...profile, notes: m.notes, qr: qrValue(m.qrToken), consentAt: m.consentAt, lastLoginAt: m.lastLoginAt, purchases, favorites: favProducts.map((f) => ({ name: f.name, qty: f.qty, times: f.times, amount: num(f.amount) })), monthly: monthly.map((x) => ({ month: x.month, total: num(x.total), orders: x.orders })).reverse() };
  }

  /** The member's sales (not voided) with items; no cost. */
  async purchases(memberId: string, take = 100) {
    const docs = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { memberId, voidedAt: null }, orderBy: [{ docDate: 'desc' }, { createdAt: 'desc' }], take, select: { id: true, docDate: true, drSiNo: true, grandTotal: true, paymentMode: true, location: { select: { name: true } }, lines: { select: { qty: true, unitPrice: true, amount: true, isFreebie: true, product: { select: { name: true } } } } } }));
    return docs.map((d) => ({ id: d.id, date: dateStr(d.docDate), drSiNo: d.drSiNo, branch: d.location.name, total: num(d.grandTotal), paymentMode: d.paymentMode, items: d.lines.map((l) => ({ name: l.product.name, qty: l.qty, price: num(l.unitPrice), amount: num(l.amount), freebie: l.isFreebie })) }));
  }

  /** Which customers bought an item (members and non-members that left a number or name), most quantity first. */
  async whoBought(q: { productId?: string; search?: string; from?: string; to?: string }) {
    if (!q.productId && !(q.search && q.search.trim().length >= 2)) throw new BadRequestException('Choose the item or type part of its name');
    const like = `%${(q.search ?? '').trim()}%`;
    const prodCond = q.productId ? Prisma.sql`p.id = ${q.productId}` : Prisma.sql`(p.name ILIKE ${like} OR p.sku ILIKE ${like} OR p.brand ILIKE ${like})`;
    const from = q.from ? Prisma.sql`AND d.doc_date >= ${new Date(`${q.from}T00:00:00Z`)}` : Prisma.empty; const to = q.to ? Prisma.sql`AND d.doc_date <= ${new Date(`${q.to}T00:00:00Z`)}` : Prisma.empty;
    const rows = await this.prisma.db.$queryRaw<{ member_id: string | null; member_no: string | null; name: string | null; phone: string | null; email: string | null; times: number; qty: number; spent: Prisma.Decimal; last_date: Date; products: string }[]>(Prisma.sql`
      SELECT MAX(d.member_id) AS member_id, MAX(m.member_no) AS member_no, MAX(COALESCE(m.full_name, d.customer_name)) AS name, MAX(COALESCE(m.phone, d.customer_phone)) AS phone, MAX(COALESCE(m.email, d.customer_email)) AS email,
        COUNT(DISTINCT d.id)::int AS times, SUM(l.qty)::int AS qty, SUM(l.amount) AS spent, MAX(d.doc_date) AS last_date, string_agg(DISTINCT p.name, ', ') AS products
      FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id JOIN products p ON p.id = l.product_id LEFT JOIN members m ON m.id = d.member_id
      WHERE d.voided_at IS NULL AND NOT l.is_freebie AND ${prodCond} ${from} ${to}
        AND (d.member_id IS NOT NULL OR NULLIF(d.customer_phone, '') IS NOT NULL OR NULLIF(d.customer_name, '') IS NOT NULL)
      GROUP BY COALESCE(d.member_id, 'x:' || COALESCE(NULLIF(right(regexp_replace(d.customer_phone, '\\D', '', 'g'), 10), ''), lower(d.customer_name)))
      ORDER BY qty DESC, last_date DESC LIMIT 1000`);
    return rows.map((r) => ({ memberId: r.member_id, memberNo: r.member_no, name: r.name, phone: r.phone, email: r.email, times: r.times, qty: r.qty, spent: num(r.spent), lastBought: dateStr(r.last_date), items: r.products }));
  }
}
