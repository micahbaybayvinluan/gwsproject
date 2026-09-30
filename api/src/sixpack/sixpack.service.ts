import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, Tx } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { SequenceService } from '../common/sequence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExpensesService } from '../expenses/expenses.service';
import { AccountsService } from '../gl/accounts.service';
import { ACCOUNT_TEMPLATES } from '../gl/account-templates';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { D } from '../common/money';
import { dateStr, todayManila } from '../common/manila';

/** One customer, however the number was typed: the last 10 digits (09171234567, +63 917 123 4567 and 917-123-4567 are the same person). */
export const phoneKey = (p: string) => p.replace(/\D/g, '').slice(-10);
export const validPhone = (p: string) => phoneKey(p).length === 10;

/**
 * 6-Pack Card (owner request 2026-09-30). A customer who buys six supplements in a row earns a ₱300 card discount.
 * Process built in: 1) on the DR the associate ticks "Sticker given": the customer's name and number are required, and one sticker is recorded per supplement on the DR
 * (the sale, the customer and the associate are tied to it; a voided sale takes its stickers back); 2) six stickers make one card: the associate redeems it on the 6-Pack Card page:
 * the system checks the customer's sticker balance across every branch, asks for the complete customer data (name, number, email, address), and books the ₱300 as the branch's "6-Pack Card"
 * expense paid from the cash on hand (so the cash to remit goes down by the discount). An old paper card (before GWS-ERP) needs its number and a photo and is flagged to the auditors and the Owner.
 */
@Injectable()
export class SixPackService {
  constructor(private prisma: PrismaService, private audit: AuditService, private settings: SettingsService, private seq: SequenceService, private notify: NotificationsService, private expenses: ExpensesService, private accounts: AccountsService) {}

  private async cfg() { return { perCard: Number(await this.settings.get<number>('sixpack.stickers_per_card')), value: Number(await this.settings.get<number>('sixpack.card_value')) }; }

  /** Stickers for a sale (inside the sale's transaction). */
  async issue(tx: Tx, e: { saleId: string; locationId: string; docDate: Date; name?: string | null; phone?: string | null; email?: string | null; supplementUnits: number; userId: string }) {
    const name = e.name?.trim() ?? '', phone = e.phone?.trim() ?? '';
    if (name.length < 3 || !validPhone(phone)) throw new BadRequestException('A 6-Pack sticker needs the customer\'s full name and mobile number on the DR');
    if (e.email?.trim() && !/^\S+@\S+\.\S+$/.test(e.email.trim())) throw new BadRequestException('The customer email is not valid');
    if (e.supplementUnits <= 0) throw new BadRequestException('There is no supplement on this DR, so there is no sticker to give');
    await tx.salesDoc.update({ where: { id: e.saleId }, data: { sixPackStickers: e.supplementUnits } });
    return tx.sixPackSticker.create({ data: { saleId: e.saleId, locationId: e.locationId, customerName: name, phone, phoneKey: phoneKey(phone), email: e.email?.trim() || null, stickers: e.supplementUnits, businessDate: e.docDate, issuedBy: e.userId } });
  }
  async voidForSale(tx: Tx, saleId: string) { await tx.sixPackSticker.updateMany({ where: { saleId, voidedAt: null }, data: { voidedAt: new Date() } }); }

  /** Stickers earned, cards redeemed (from system stickers) and what is left for one customer. */
  async balance(key: string) {
    const { perCard } = await this.cfg();
    const earned = (await this.prisma.db.sixPackSticker.aggregate({ where: { phoneKey: key, voidedAt: null }, _sum: { stickers: true } }))._sum.stickers ?? 0;
    const used = (await this.prisma.db.sixPackRedemption.aggregate({ where: { phoneKey: key, voidedAt: null, legacyCardNo: null }, _sum: { stickersUsed: true } }))._sum.stickersUsed ?? 0;
    const left = earned - used;
    return { earned, used, left, cardsReady: Math.max(0, Math.floor(left / perCard)), perCard };
  }
  async customer(phone: string) {
    if (!validPhone(phone)) throw new BadRequestException('Type the customer\'s mobile number');
    const key = phoneKey(phone);
    const last = (await this.prisma.db.sixPackRedemption.findFirst({ where: { phoneKey: key, voidedAt: null }, orderBy: { redeemedAt: 'desc' } })) ?? null;
    const st = await this.prisma.db.sixPackSticker.findFirst({ where: { phoneKey: key, voidedAt: null }, orderBy: { issuedAt: 'desc' } });
    return { phoneKey: key, name: last?.customerName ?? st?.customerName ?? null, email: last?.email ?? st?.email ?? null, address: last?.address ?? null, ...(await this.balance(key)) };
  }

  private scopeLocation(user: SessionUser, locationId?: string) {
    const id = locationId ?? user.locationIds[0];
    if (!id) throw new BadRequestException('Choose the branch');
    if (user.locationScoped && !user.locationIds.includes(id)) throw new ForbiddenException('That is another branch');
    return id;
  }

  /** The branch's account for the ₱300 (created on first use from the chart template). */
  private async account(tx: Tx, locationId: string) {
    const found = await tx.account.findFirst({ where: { branchTagId: locationId, active: true, template: { key: 'SIX_PACK_CARD' } }, select: { id: true, title: true } });
    if (found) return found;
    const t = ACCOUNT_TEMPLATES.find((x) => x.key === 'SIX_PACK_CARD')!;
    const tpl = await tx.accountTemplate.upsert({ where: { key: t.key }, create: { key: t.key, titlePattern: t.titlePattern, class: t.class, sortOrder: 999 }, update: {} });
    const loc = await tx.location.findUniqueOrThrow({ where: { id: locationId } });
    const a = await this.accounts.create({ title: tpl.titlePattern.replace('{branch}', loc.name), class: tpl.class, branchTagId: locationId, entryScope: tpl.entryScope, templateId: tpl.id }, 'system', tx);
    return { id: a.id, title: a.title };
  }

  async redeem(user: SessionUser, input: { locationId?: string; customerName: string; phone: string; email: string; address: string; legacyCardNo?: string | null; proofAttachmentId?: string | null; notes?: string | null }) {
    const locationId = this.scopeLocation(user, input.locationId);
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    const name = input.customerName.trim(), email = input.email.trim(), address = input.address.trim();
    if (name.length < 3) throw new BadRequestException('Type the customer\'s full name');
    if (!validPhone(input.phone)) throw new BadRequestException('Type the customer\'s mobile number');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException('Type the customer\'s email: the customer data must be complete');
    if (address.length < 5) throw new BadRequestException('Type the customer\'s address: the customer data must be complete');
    const { perCard, value } = await this.cfg();
    const key = phoneKey(input.phone);
    const legacy = input.legacyCardNo?.trim() || null;
    if (legacy && !input.proofAttachmentId) throw new BadRequestException('An old paper card needs a photo of the card');
    const bal = await this.balance(key);
    if (!legacy && bal.left < perCard) throw new BadRequestException(`${name} has ${bal.left} sticker${bal.left === 1 ? '' : 's'} in the system; a card needs ${perCard}. For an old paper card, type its number and attach a photo.`);
    const docDate = todayManila();
    const r = await this.prisma.db.$transaction(async (tx) => {
      const controlNo = await this.seq.next(tx, 'SPC', { prefix: 'SPC', pad: 6, locationId });
      let expenseId: string | null = null;
      if (loc.type === 'FRANCHISE') {
        const fe = await tx.franchiseExpense.create({ data: { locationId, docDate, category: '6-Pack Card', payee: name, amount: D(value).toFixed(2), notes: `6-Pack Card ${controlNo}`, createdBy: user.id } });
        expenseId = fe.id;
      } else {
        const acct = await this.account(tx, locationId);
        const ex = await this.expenses.insert(tx, { locationId, docDate, account: acct, isMain: false, payee: name, amount: value, paidFrom: 'CASH_DRAWER', notes: `6-Pack Card ${controlNo}${legacy ? ` (old card ${legacy})` : ''}`, userId: user.id });
        expenseId = ex.id;
      }
      return tx.sixPackRedemption.create({ data: { controlNo, locationId, customerName: name, phone: input.phone.trim(), phoneKey: key, email, address, stickersUsed: legacy ? 0 : perCard, amount: D(value).toFixed(2), expenseId, legacyCardNo: legacy, proofAttachmentId: input.proofAttachmentId ?? null, businessDate: docDate, redeemedBy: user.id, flaggedNote: legacy ? `Old paper card ${legacy}: check the photo` : null } });
    });
    await this.audit.log({ action: 'CREATE', entityType: 'SixPackRedemption', entityId: r.id, after: r });
    if (legacy) await this.notify.toRoles(['HEAD_AUDITOR', 'ASST_AUDITOR', 'ADMIN'], { type: 'SIXPACK_LEGACY', title: `⚑ ${loc.name}: old paper 6-Pack card ${legacy} redeemed by ${user.fullName} for ${name} (₱${value}). Check the photo`, link: '/six-pack' });
    return r;
  }

  async voidRedemption(user: SessionUser, id: string, reason: string) {
    const r = await this.prisma.db.sixPackRedemption.findUnique({ where: { id } });
    if (!r || r.voidedAt) throw new NotFoundException();
    if (!reason?.trim()) throw new BadRequestException('Give the reason');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.sixPackRedemption.update({ where: { id }, data: { voidedAt: new Date() } });
      const loc = await tx.location.findUniqueOrThrow({ where: { id: r.locationId } });
      if (r.expenseId) {
        if (loc.type === 'FRANCHISE') await tx.franchiseExpense.update({ where: { id: r.expenseId }, data: { voidedAt: new Date(), voidedBy: user.id, voidReason: reason.trim() } });
        else { const ex = await tx.expenseDoc.findUnique({ where: { id: r.expenseId } }); if (ex && !ex.voidedAt) await this.expenses.voidInTx(tx, ex, `6-Pack Card ${r.controlNo} voided: ${reason.trim()}`, user.id); }
      }
    });
    await this.audit.log({ action: 'VOID', entityType: 'SixPackRedemption', entityId: id, after: { reason } });
    await this.notify.toLocation(r.locationId, { type: 'SIXPACK_VOID', title: `6-Pack Card ${r.controlNo} was voided by ${user.fullName}: ${reason.trim()}`, link: '/six-pack' });
    return { ok: true };
  }

  /** The store's 6-Pack picture: for the dashboard and the page. */
  async summary(user: SessionUser, q: { locationId?: string; from?: string; to?: string }) {
    const all = user.permissions.has('sixpack.view.all');
    const locationId = q.locationId || (all ? undefined : this.scopeLocation(user));
    if (locationId) this.scopeLocation(user, locationId);
    const { perCard, value } = await this.cfg();
    const today = todayManila(); const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const from = q.from ? new Date(`${q.from}T00:00:00Z`) : monthStart; const to = q.to ? new Date(`${q.to}T00:00:00Z`) : today;
    const where = { locationId, businessDate: { gte: from, lte: to } };
    const stickers = await this.prisma.db.sixPackSticker.findMany({ where: { ...where, voidedAt: null }, orderBy: { issuedAt: 'desc' } });
    const reds = await this.prisma.db.sixPackRedemption.findMany({ where: { ...where, voidedAt: null }, orderBy: { redeemedAt: 'desc' } });
    const todayS = stickers.filter((s) => dateStr(s.businessDate) === dateStr(today));
    const todayR = reds.filter((s) => dateStr(s.businessDate) === dateStr(today));
    // customers close to a card: per phone, balance across every branch
    const keys = [...new Set(stickers.map((s) => s.phoneKey))];
    const near: { name: string; phone: string; left: number }[] = [];
    for (const k of keys) { const b = await this.balance(k); if (b.left >= perCard - 1 && b.left > 0) { const s = stickers.find((x) => x.phoneKey === k)!; near.push({ name: s.customerName, phone: s.phone, left: b.left }); } }
    const names = await this.prisma.db.user.findMany({ where: { id: { in: [...stickers.map((s) => s.issuedBy), ...reds.map((r) => r.redeemedBy)] } }, select: { id: true, fullName: true } });
    const nm = (id: string) => names.find((n) => n.id === id)?.fullName ?? '';
    // the DRs come from stickers already limited to the branch the person may see
    const sales = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { id: { in: stickers.map((s) => s.saleId) } }, select: { id: true, drSiNo: true } }));
    const locs = await this.prisma.db.location.findMany({ where: { id: { in: [...new Set([...stickers.map((s) => s.locationId), ...reds.map((r) => r.locationId)])] } }, select: { id: true, name: true } });
    return { perCard, value, from: dateStr(from), to: dateStr(to), locationId: locationId ?? null,
      today: { stickers: todayS.reduce((t, s) => t + s.stickers, 0), dr: todayS.length, cards: todayR.length, amount: todayR.reduce((t, r) => t.plus(r.amount), D(0)) },
      period: { stickers: stickers.reduce((t, s) => t + s.stickers, 0), dr: stickers.length, cards: reds.length, amount: reds.reduce((t, r) => t.plus(r.amount), D(0)), legacy: reds.filter((r) => r.legacyCardNo).length },
      nearCard: near.sort((a, b) => b.left - a.left).slice(0, 15),
      stickers: stickers.slice(0, 100).map((s) => ({ id: s.id, date: dateStr(s.businessDate), branch: locs.find((l) => l.id === s.locationId)?.name ?? '', drSiNo: sales.find((x) => x.id === s.saleId)?.drSiNo ?? '', customer: s.customerName, phone: s.phone, stickers: s.stickers, by: nm(s.issuedBy) })),
      redemptions: reds.slice(0, 100).map((r) => ({ id: r.id, controlNo: r.controlNo, date: dateStr(r.businessDate), branch: locs.find((l) => l.id === r.locationId)?.name ?? '', customer: r.customerName, phone: r.phone, email: r.email, address: r.address, amount: r.amount, legacyCardNo: r.legacyCardNo, by: nm(r.redeemedBy) })) };
  }
}
