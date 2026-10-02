import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { MembersService, SEGMENTS } from './members.service';
import { MessagingService } from './messaging.service';
import { PortalService } from './portal.service';
import { emailKeyOf, phMobile, phoneKeyOf } from './members.util';

export interface AudienceSpec { source: 'MEMBERS' | 'ALL_CONTACTS'; segment?: string; productId?: string }
interface Recipient { memberId: string | null; name: string; to: string }
const MAX = 20000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const merge = (t: string, r: { name: string; memberNo?: string | null }) => t.replace(/\{name\}/gi, r.name).replace(/\{firstName\}/gi, r.name.split(/\s+/)[0] ?? r.name).replace(/\{memberNo\}/gi, r.memberNo ?? '');

/**
 * Email and SMS blasts to the customer database (owner request 2026-10-03). One company email sends (MAIL_FROM through SMTP_URL) and SMS
 * goes through Semaphore. The audience is the members (optionally one segment, or those who bought one item) or every contact in the
 * sales; people who opted out, or have no valid address / number, are left out and counted. Every email carries an unsubscribe link.
 */
@Injectable()
export class CampaignsService {
  private log = new Logger('Campaigns');
  private running = new Set<string>();
  constructor(private prisma: PrismaService, private audit: AuditService, private members: MembersService, private msg: MessagingService, private portal: PortalService) {}

  config() { return { ...this.msg.config(), segments: Object.entries(SEGMENTS).map(([key, label]) => ({ key, label })) }; }

  private async optOuts(channel: string) { return new Set((await this.prisma.db.messageOptOut.findMany({ where: { channel }, select: { key: true } })).map((o) => o.key)); }

  /** Who would get it, and who was left out and why. */
  async resolve(channel: 'EMAIL' | 'SMS', spec: AudienceSpec) {
    const out = await this.optOuts(channel);
    let list = (await this.members.list({ segment: spec.segment || undefined })).filter((m) => m.status === 'ACTIVE');
    if (spec.productId) {
      const ids = new Set((await this.prisma.db.$queryRaw<{ member_id: string }[]>(Prisma.sql`SELECT DISTINCT d.member_id FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id WHERE d.member_id IS NOT NULL AND d.voided_at IS NULL AND NOT l.is_freebie AND l.product_id = ${spec.productId}`)).map((r) => r.member_id));
      list = list.filter((m) => ids.has(m.id));
    }
    const rec: Recipient[] = []; const seen = new Set<string>(); const excluded = { noContact: 0, optedOut: 0 };
    for (const m of list) {
      const to = channel === 'EMAIL' ? (emailKeyOf(m.email) ? m.email!.trim() : null) : phMobile(m.phone);
      const key = channel === 'EMAIL' ? emailKeyOf(m.email) : phoneKeyOf(m.phone);
      if (!to || !key) { excluded.noContact++; continue; }
      if (!(channel === 'EMAIL' ? m.emailOptIn : m.smsOptIn) || out.has(key)) { excluded.optedOut++; continue; }
      if (seen.has(key)) continue; seen.add(key); rec.push({ memberId: m.id, name: m.fullName, to });
    }
    if (spec.source === 'ALL_CONTACTS' && !spec.segment) {
      const prod = spec.productId ? Prisma.sql`AND EXISTS (SELECT 1 FROM sales_lines l WHERE l.doc_id = d.id AND l.product_id = ${spec.productId} AND NOT l.is_freebie)` : Prisma.empty;
      const docs = await requestContext.runSystem(async () => await this.prisma.db.$queryRaw<{ name: string | null; phone: string | null; email: string | null }[]>(Prisma.sql`SELECT d.customer_name AS name, d.customer_phone AS phone, d.customer_email AS email FROM sales_docs d WHERE d.member_id IS NULL AND d.voided_at IS NULL AND (NULLIF(d.customer_phone,'') IS NOT NULL OR NULLIF(d.customer_email,'') IS NOT NULL) ${prod} ORDER BY d.doc_date DESC LIMIT 100000`));
      for (const d of docs) {
        const to = channel === 'EMAIL' ? (emailKeyOf(d.email) ? d.email!.trim() : null) : phMobile(d.phone);
        const key = channel === 'EMAIL' ? emailKeyOf(d.email) : phoneKeyOf(d.phone);
        if (!to || !key) continue; if (seen.has(key)) continue;
        if (out.has(key)) { excluded.optedOut++; continue; }
        // a customer who is a member with this email / number is covered above (and their choice respected)
        const asMember = await this.prisma.db.member.findFirst({ where: channel === 'EMAIL' ? { emailKey: key } : { phoneKey: key }, select: { id: true } }); if (asMember) continue;
        seen.add(key); rec.push({ memberId: null, name: d.name?.trim() || 'Customer', to });
      }
    }
    return { recipients: rec.slice(0, MAX), excluded, truncated: rec.length > MAX };
  }

  async preview(channel: 'EMAIL' | 'SMS', spec: AudienceSpec) {
    const r = await this.resolve(channel, spec);
    return { count: r.recipients.length, excluded: r.excluded, truncated: r.truncated, sample: r.recipients.slice(0, 8).map((x) => ({ name: x.name, to: x.to })) };
  }

  async create(user: SessionUser, input: { channel: 'EMAIL' | 'SMS'; name: string; subject?: string; body: string; audience: AudienceSpec }) {
    if (!input.body.trim()) throw new BadRequestException('Type the message');
    if (input.channel === 'EMAIL' && !input.subject?.trim()) throw new BadRequestException('Type the subject of the email');
    if (input.channel === 'SMS' && input.body.length > 480) throw new BadRequestException('An SMS can be at most 480 characters (3 messages)');
    const r = await this.resolve(input.channel, input.audience);
    if (!r.recipients.length) throw new BadRequestException('Nobody can receive this: no one in that audience has a valid ' + (input.channel === 'EMAIL' ? 'email address' : 'mobile number') + ' and agreed to messages');
    const c = await this.prisma.db.campaign.create({ data: { channel: input.channel, name: input.name.trim() || `${input.channel} ${new Date().toISOString().slice(0, 10)}`, subject: input.subject?.trim() || null, body: input.body, audience: input.audience as never, total: r.recipients.length, skipped: r.excluded.noContact + r.excluded.optedOut, createdBy: user.id, recipients: { create: r.recipients.map((x) => ({ memberId: x.memberId, name: x.name, toAddr: x.to })) } } });
    await this.audit.log({ action: 'CREATE', entityType: 'Campaign', entityId: c.id, after: { channel: c.channel, total: c.total, name: c.name }, userId: user.id });
    return c;
  }

  /** Starts (or resumes) sending in the background; the page follows the counts. */
  async send(user: SessionUser, id: string) {
    const c = await this.prisma.db.campaign.findUnique({ where: { id } }); if (!c) throw new NotFoundException('Campaign not found');
    if (c.status === 'DONE') throw new BadRequestException('This campaign was already sent');
    if (this.running.has(id)) return c;
    // a retry after fixing the setup: the ones that could not be sent for lack of setup go again
    await this.prisma.db.campaignRecipient.updateMany({ where: { campaignId: id, status: 'NOT_CONFIGURED' }, data: { status: 'PENDING', error: null } });
    const failedNow = await this.prisma.db.campaignRecipient.count({ where: { campaignId: id, status: 'FAILED' } });
    await this.prisma.db.campaign.update({ where: { id }, data: { status: 'SENDING', failed: failedNow, sentAt: c.sentAt ?? new Date() } });
    await this.audit.log({ action: 'SEND', entityType: 'Campaign', entityId: id, after: { total: c.total }, userId: user.id });
    this.running.add(id);
    void this.run(id).catch((e) => this.log.error(`Campaign ${id}: ${(e as Error).message}`)).finally(() => this.running.delete(id));
    return this.prisma.db.campaign.findUniqueOrThrow({ where: { id } });
  }

  private async run(id: string) {
    const c = await this.prisma.db.campaign.findUniqueOrThrow({ where: { id } });
    const cfg = this.msg.config(); const configured = c.channel === 'EMAIL' ? cfg.emailConfigured : cfg.smsConfigured;
    const out = await this.optOuts(c.channel);
    let sent = c.sent, failed = c.failed, skipped = c.skipped;
    for (;;) {
      const batch = await this.prisma.db.campaignRecipient.findMany({ where: { campaignId: id, status: 'PENDING' }, take: 50, orderBy: { id: 'asc' }, include: { member: { select: { memberNo: true } } } });
      if (!batch.length) break;
      for (const r of batch) {
        const key = c.channel === 'EMAIL' ? emailKeyOf(r.toAddr) : phoneKeyOf(r.toAddr);
        if (!configured) { await this.prisma.db.campaignRecipient.update({ where: { id: r.id }, data: { status: 'NOT_CONFIGURED', error: c.channel === 'EMAIL' ? 'Email is not set up (SMTP_URL and MAIL_FROM in api/.env)' : 'SMS is not set up (SEMAPHORE_API_KEY in api/.env)' } }); failed++; continue; }
        if (key && (out.has(key) || (await this.optedOutNow(c.channel, key)))) { await this.prisma.db.campaignRecipient.update({ where: { id: r.id }, data: { status: 'SKIPPED', error: 'Opted out' } }); skipped++; continue; }
        const vars = { name: r.name, memberNo: r.member?.memberNo ?? null };
        let res;
        if (c.channel === 'EMAIL') {
          const url = `${process.env.PUBLIC_URL || 'http://localhost:5173'}/api/portal/unsubscribe?t=${encodeURIComponent(this.portal.unsubscribeToken('EMAIL', key ?? r.toAddr))}`;
          const text = `${merge(c.body, vars)}\n\n—\nGet Wheysted Supplements. To stop getting these emails: ${url}`;
          const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">${esc(merge(c.body, vars)).replace(/\n/g, '<br>')}<hr style="margin-top:24px;border:none;border-top:1px solid #e2e8f0"><p style="font-size:12px;color:#64748b">Get Wheysted Supplements · <a href="${url}">Unsubscribe</a></p></div>`;
          res = await this.msg.email(r.toAddr, merge(c.subject ?? '', vars), text, html, url);
        } else res = await this.msg.sms(r.toAddr, merge(c.body, vars));
        await this.prisma.db.campaignRecipient.update({ where: { id: r.id }, data: { status: res.status, error: res.error ?? null, sentAt: res.status === 'SENT' ? new Date() : null } });
        if (res.status === 'SENT') sent++; else failed++;
        await sleep(c.channel === 'EMAIL' ? 80 : 300);
      }
      await this.prisma.db.campaign.update({ where: { id }, data: { sent, failed, skipped } });
    }
    await this.prisma.db.campaign.update({ where: { id }, data: { sent, failed, skipped, status: sent === 0 && failed > 0 ? 'FAILED' : 'DONE', finishedAt: new Date() } });
  }
  private async optedOutNow(channel: string, key: string) { return !!(await this.prisma.db.messageOptOut.findUnique({ where: { channel_key: { channel, key } } })); }

  async test(user: SessionUser, input: { channel: 'EMAIL' | 'SMS'; to: string; subject?: string; body: string }) {
    const vars = { name: user.fullName, memberNo: 'WHY-000000' };
    return input.channel === 'EMAIL' ? this.msg.email(input.to, `[TEST] ${merge(input.subject ?? 'Test', vars)}`, merge(input.body, vars)) : this.msg.sms(input.to, merge(input.body, vars));
  }

  list() { return this.prisma.db.campaign.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }); }
  async get(id: string) {
    const c = await this.prisma.db.campaign.findUnique({ where: { id } }); if (!c) throw new NotFoundException('Campaign not found');
    const recipients = await this.prisma.db.campaignRecipient.findMany({ where: { campaignId: id }, orderBy: { id: 'asc' }, take: 1000, select: { id: true, name: true, toAddr: true, status: true, error: true, sentAt: true } });
    return { ...c, recipients };
  }
}
