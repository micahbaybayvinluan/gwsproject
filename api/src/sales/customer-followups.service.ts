import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../common/settings.service';
import { AuditService } from '../common/audit.service';
import { addDays, dateStr, todayManila } from '../common/manila';
import type { SessionUser } from '../common/request-context';

export interface MessageVars { customer: string; product: string; store: string; storePhone: string }
export const fillTemplate = (t: string, v: MessageVars) => t.replace(/\{(customer|product|store|storePhone)\}/g, (_m, k: keyof MessageVars) => v[k] || '');

/** Philippine mobile number in the 09XXXXXXXXX form, or null. */
export function phMobile(raw?: string | null): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  const n = d.startsWith('63') ? `0${d.slice(2)}` : d.startsWith('9') && d.length === 10 ? `0${d}` : d;
  return /^09\d{9}$/.test(n) ? n : null;
}

/**
 * Customer re-order follow-ups (owner request 2026-09-27). A product can carry the number of days one unit lasts; when a customer with a
 * contact number or email buys it, a follow-up is due after qty × days. That morning the store where they bought it is notified to call,
 * and — when the Owner switches it on — an SMS and/or email is sent with the Owner's message. Messages can also be sent by hand.
 * SMS goes through Semaphore (SEMAPHORE_API_KEY), email through SMTP_URL; without them the message is logged as not configured.
 */
@Injectable()
export class CustomerFollowUpsService {
  private log = new Logger('FollowUps');
  constructor(private prisma: PrismaService, private notify: NotificationsService, private settings: SettingsService, private audit: AuditService) {}

  /** After a sale: one follow-up per line whose product has a consumption period, when the customer can be reached. */
  async createForSale(saleId: string) {
    const s = await this.prisma.db.salesDoc.findUnique({ where: { id: saleId }, include: { customer: true, lines: { where: { isFreebie: false }, include: { product: { select: { id: true, consumptionDays: true } } } } } });
    if (!s) return 0;
    const phone = s.customerPhone ?? s.customer?.phone ?? null; const email = s.customerEmail ?? s.customer?.email ?? null;
    if (!phone && !email) return 0;
    const byProduct = new Map<string, { lineId: string; qty: number; days: number }>();
    for (const l of s.lines) { const d = l.product.consumptionDays; if (!d) continue; const cur = byProduct.get(l.productId); if (cur) cur.qty += l.qty; else byProduct.set(l.productId, { lineId: l.id, qty: l.qty, days: d }); }
    let n = 0;
    for (const [productId, x] of byProduct) {
      await this.prisma.db.customerFollowUp.upsert({ where: { salesLineId: x.lineId }, create: { salesDocId: s.id, salesLineId: x.lineId, productId, locationId: s.locationId, customerName: s.customer?.name ?? s.customerName, phone, email, qty: x.qty, dueDate: addDays(s.docDate, x.days * x.qty) }, update: {} });
      n++;
    }
    return n;
  }

  async dismissForSale(saleId: string) { await this.prisma.db.customerFollowUp.updateMany({ where: { salesDocId: saleId, status: { in: ['PENDING', 'NOTIFIED'] } }, data: { status: 'DISMISSED', note: 'Sale voided' } }); }

  async list(user: SessionUser, q: { status?: string; locationId?: string }) {
    if (q.locationId && user.locationScoped && !user.locationIds.includes(q.locationId)) throw new ForbiddenException();
    const rows = await this.prisma.db.customerFollowUp.findMany({ where: { status: q.status ? q.status : { in: ['NOTIFIED', 'PENDING'] }, locationId: q.locationId ? q.locationId : user.locationScoped ? { in: user.locationIds } : undefined }, orderBy: { dueDate: 'asc' }, take: 500 });
    const products = new Map((await this.prisma.db.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    const locs = new Map((await this.prisma.db.location.findMany({ where: { id: { in: rows.map((r) => r.locationId) } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]));
    const today = dateStr(todayManila());
    return rows.map((r) => ({ ...r, dueDate: dateStr(r.dueDate), product: products.get(r.productId) ?? '', store: locs.get(r.locationId) ?? '', due: dateStr(r.dueDate) <= today }));
  }

  async update(id: string, input: { status: 'CONTACTED' | 'DISMISSED' | 'NOTIFIED'; note?: string }, user: SessionUser) {
    const f = await this.prisma.db.customerFollowUp.findUnique({ where: { id } }); if (!f) throw new NotFoundException();
    if (user.locationScoped && !user.locationIds.includes(f.locationId)) throw new ForbiddenException();
    const after = await this.prisma.db.customerFollowUp.update({ where: { id }, data: { status: input.status, note: input.note ?? f.note } });
    await this.audit.log({ action: 'UPDATE', entityType: 'CustomerFollowUp', entityId: id, before: { status: f.status }, after: { status: after.status, note: after.note }, userId: user.id });
    return after;
  }

  private async vars(f: { customerName: string | null; productId: string; locationId: string }): Promise<MessageVars> {
    const p = await this.prisma.db.product.findUnique({ where: { id: f.productId }, select: { name: true } });
    const l = await this.prisma.db.location.findUnique({ where: { id: f.locationId }, select: { name: true } });
    const lh = await this.settings.get<{ contact?: string } | null>('company.letterhead');
    return { customer: f.customerName || 'there', product: p?.name ?? 'your supplement', store: `Get Wheysted ${l?.name ?? ''}`.trim(), storePhone: lh?.contact ?? '' };
  }

  /** The Owner's message filled in for one follow-up (shown before sending, and editable). */
  async preview(id: string, user: SessionUser) {
    const f = await this.prisma.db.customerFollowUp.findUnique({ where: { id } }); if (!f) throw new NotFoundException();
    if (user.locationScoped && !user.locationIds.includes(f.locationId)) throw new ForbiddenException();
    const v = await this.vars(f);
    return { sms: fillTemplate(await this.settings.get<string>('followup.sms_template'), v), subject: fillTemplate(await this.settings.get<string>('followup.email_subject'), v), email: fillTemplate(await this.settings.get<string>('followup.email_template'), v), phone: f.phone, emailTo: f.email, configured: { sms: !!process.env.SEMAPHORE_API_KEY, email: !!process.env.SMTP_URL } };
  }

  /** Send an SMS or email now (from a follow-up, or to any customer contact). */
  async send(input: { channel: 'SMS' | 'EMAIL'; to?: string; body?: string; subject?: string; followUpId?: string }, user: SessionUser | null) {
    let to = input.to ?? ''; let body = input.body ?? ''; let subject = input.subject;
    if (input.followUpId) {
      const f = await this.prisma.db.customerFollowUp.findUnique({ where: { id: input.followUpId } }); if (!f) throw new NotFoundException();
      if (user?.locationScoped && !user.locationIds.includes(f.locationId)) throw new ForbiddenException();
      const pv = await this.preview(f.id, user ?? ({ locationScoped: false, locationIds: [] } as unknown as SessionUser));
      to = to || (input.channel === 'SMS' ? f.phone ?? '' : f.email ?? '');
      body = body || (input.channel === 'SMS' ? pv.sms : pv.email); subject = subject || pv.subject;
    }
    if (!to) throw new BadRequestException(input.channel === 'SMS' ? 'No mobile number for this customer' : 'No email for this customer');
    if (!body.trim()) throw new BadRequestException('Type the message');
    const r = input.channel === 'SMS' ? await this.sms(to, body) : await this.email(to, subject || 'Get Wheysted Supplements', body);
    const msg = await this.prisma.db.customerMessage.create({ data: { channel: input.channel, to, subject: input.channel === 'EMAIL' ? subject : null, body, status: r.status, error: r.error ?? null, followUpId: input.followUpId ?? null, sentBy: user?.id ?? null } });
    if (input.followUpId && r.status === 'SENT') await this.prisma.db.customerFollowUp.update({ where: { id: input.followUpId }, data: input.channel === 'SMS' ? { smsSentAt: new Date() } : { emailSentAt: new Date() } });
    return msg;
  }

  private async sms(to: string, body: string): Promise<{ status: string; error?: string }> {
    const num = phMobile(to); if (!num) return { status: 'FAILED', error: 'Not a valid PH mobile number' };
    const key = process.env.SEMAPHORE_API_KEY; if (!key) return { status: 'NOT_CONFIGURED', error: 'SMS is not set up (SEMAPHORE_API_KEY in api/.env)' };
    try {
      const res = await fetch('https://api.semaphore.co/api/v4/messages', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ apikey: key, number: num, message: body, ...(process.env.SEMAPHORE_SENDER ? { sendername: process.env.SEMAPHORE_SENDER } : {}) }) });
      return res.ok ? { status: 'SENT' } : { status: 'FAILED', error: `SMS provider answered ${res.status}` };
    } catch (e) { return { status: 'FAILED', error: (e as Error).message }; }
  }

  private async email(to: string, subject: string, body: string): Promise<{ status: string; error?: string }> {
    if (!/^\S+@\S+\.\S+$/.test(to)) return { status: 'FAILED', error: 'Not a valid email address' };
    if (!process.env.SMTP_URL) return { status: 'NOT_CONFIGURED', error: 'Email is not set up (SMTP_URL in api/.env)' };
    try { await nodemailer.createTransport(process.env.SMTP_URL).sendMail({ from: process.env.MAIL_FROM || 'noreply@gws.local', to, subject, text: body }); return { status: 'SENT' }; } catch (e) { return { status: 'FAILED', error: (e as Error).message }; }
  }

  /** Morning job: follow-ups due today → the store is told whom to call; SMS / email go out automatically when switched on. */
  async runDaily() {
    const due = await this.prisma.db.customerFollowUp.findMany({ where: { status: 'PENDING', dueDate: { lte: todayManila() } }, take: 1000 });
    const autoSms = await this.settings.get<boolean>('followup.auto_sms'); const autoEmail = await this.settings.get<boolean>('followup.auto_email');
    const byLoc = new Map<string, typeof due>(); for (const f of due) byLoc.set(f.locationId, [...(byLoc.get(f.locationId) ?? []), f]);
    let notified = 0, sent = 0;
    for (const [locationId, list] of byLoc) {
      const names = await Promise.all(list.slice(0, 5).map(async (f) => `${f.customerName || f.phone || f.email} (${(await this.vars(f)).product})`));
      await this.notify.toLocation(locationId, { type: 'CUSTOMER_FOLLOW_UP', title: `${list.length} customer(s) may have finished their supplements — call them to re-order`, body: names.join(', ') + (list.length > 5 ? '…' : ''), link: '/reports/customers?tab=followups' });
      for (const f of list) {
        await this.prisma.db.customerFollowUp.update({ where: { id: f.id }, data: { status: 'NOTIFIED', notifiedAt: new Date() } }); notified++;
        if (autoSms && f.phone) { const m = await this.send({ channel: 'SMS', followUpId: f.id }, null).catch((e) => { this.log.warn(e); return null; }); if (m?.status === 'SENT') sent++; }
        if (autoEmail && f.email) { const m = await this.send({ channel: 'EMAIL', followUpId: f.id }, null).catch((e) => { this.log.warn(e); return null; }); if (m?.status === 'SENT') sent++; }
      }
    }
    return { notified, sent };
  }

  messages(followUpId?: string) { return this.prisma.db.customerMessage.findMany({ where: { followUpId: followUpId || undefined }, orderBy: { createdAt: 'desc' }, take: 200 }); }
}
