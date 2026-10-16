import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SequenceService } from '../common/sequence.service';
import { SettingsService } from '../common/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PdfService, type Letterhead, LETTERHEAD_KEY } from '../reports/pdf.service';
import type { SessionUser } from '../common/request-context';
import { dateStr, manilaDateStr, toDateOnly } from '../common/manila';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const longDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
export const NTE_DECISIONS = ['NO_ACTION', 'WARNING', 'SUSPENSION', 'CHARGE', 'OTHER'] as const;
export interface NteInput { employeeId: string; subject: string; details: string; incidentDate?: string | null; replyDueOn?: string | null; hrNoticeId?: string | null }

/**
 * Notice to Explain (owner request 2026-10-16): HR issues a numbered NTE to one employee (printed on the letterhead), the employee's reply is
 * recorded (by the employee in My Pay & Charges, or typed by HR from the paper reply) and HR records the decision.
 */
@Injectable()
export class NteService {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private notify: NotificationsService, private pdf: PdfService, private settings: SettingsService) {}

  async create(input: NteInput, user: SessionUser) {
    const emp = await this.prisma.db.employee.findUnique({ where: { id: input.employeeId } });
    if (!emp) throw new NotFoundException('Unknown employee');
    const issuedOn = toDateOnly(manilaDateStr());
    const replyDueOn = input.replyDueOn ? toDateOnly(input.replyDueOn) : addDays(issuedOn, 5);
    if (replyDueOn < issuedOn) throw new BadRequestException('The reply date cannot be before today');
    const year = issuedOn.getUTCFullYear();
    const nte = await this.prisma.db.$transaction(async (tx) => {
      const n = await this.seq.next(tx, 'NTE', { locationId: String(year), year, prefix: 'NTE', pad: 3 });
      const no = Number(/(\d+)$/.exec(n)![1]);
      return tx.nte.create({ data: { nteNo: `NTE-${year}-${String(no).padStart(3, '0')}`, employeeId: emp.id, employeeName: emp.fullName, locationId: emp.locationId, hrNoticeId: input.hrNoticeId ?? null, subject: input.subject.trim(), details: input.details.trim(), incidentDate: input.incidentDate ? toDateOnly(input.incidentDate) : null, issuedOn, replyDueOn, issuedBy: user.id } });
    });
    await this.audit.log({ action: 'CREATE', entityType: 'Nte', entityId: nte.id, after: { nteNo: nte.nteNo, employee: emp.fullName, subject: nte.subject }, userId: user.id });
    if (emp.userId) await this.notify.toUsers([emp.userId], { type: 'NTE_ISSUED', title: `Notice to Explain ${nte.nteNo}: ${nte.subject}`, body: `Please explain by ${dateStr(nte.replyDueOn)}. Open My Pay & Charges to read it and type your reply.`, link: '/my-hr' });
    await this.notify.toRoles(['ADMIN'], { type: 'NTE_ISSUED_ADMIN', title: `${user.fullName} issued ${nte.nteNo} to ${emp.fullName}: ${nte.subject}`, link: '/hr-notices' });
    return nte;
  }

  /** One NTE per person for an HR notice (late deposit etc.): the notice details are prefilled, the notice becomes NTE_ISSUED. */
  async issueFromNotice(noticeId: string, input: { userIds?: string[]; employeeIds?: string[]; details?: string; replyDueOn?: string | null }, user: SessionUser) {
    const notice = await this.prisma.db.hrNotice.findUnique({ where: { id: noticeId } }); if (!notice) throw new NotFoundException('Unknown notice');
    const emps = await this.prisma.db.employee.findMany({ where: { OR: [{ id: { in: input.employeeIds ?? [] } }, { userId: { in: input.userIds ?? [] } }] } });
    if (!emps.length) throw new BadRequestException('Choose at least one person. A person without an employee record cannot receive an NTE: add them under Payroll first (Employee ↔ account links).');
    const d = (notice.details ?? {}) as Record<string, unknown>;
    const text = input.details?.trim() || `${notice.title}.${d.outstanding ? ` Outstanding: ₱${d.outstanding}.` : ''}\n\nPlease explain in writing why this happened.`;
    const out = [];
    for (const e of emps) out.push(await this.create({ employeeId: e.id, subject: notice.title, details: text, incidentDate: typeof d.businessDate === 'string' ? d.businessDate : null, replyDueOn: input.replyDueOn, hrNoticeId: notice.id }, user));
    await this.prisma.db.hrNotice.update({ where: { id: notice.id }, data: { status: 'NTE_ISSUED', resolvedAt: new Date(), resolvedBy: user.id, note: `${out.map((n) => n.nteNo).join(', ')} issued` } });
    return out;
  }

  list(q: { status?: string; employeeId?: string }) { return this.prisma.db.nte.findMany({ where: { status: q.status || undefined, employeeId: q.employeeId || undefined }, orderBy: { createdAt: 'desc' }, take: 300 }); }
  async get(id: string) { const n = await this.prisma.db.nte.findUnique({ where: { id } }); if (!n) throw new NotFoundException(); return n; }

  /** The employee's own NTEs (My Pay & Charges). */
  async mine(user: SessionUser) {
    const emp = await this.prisma.db.employee.findUnique({ where: { userId: user.id }, select: { id: true } });
    return emp ? this.prisma.db.nte.findMany({ where: { employeeId: emp.id, status: { not: 'VOIDED' } }, orderBy: { createdAt: 'desc' } }) : [];
  }

  /** The reply: by the employee (own NTE) or typed by HR from the paper reply. */
  async reply(id: string, text: string, user: SessionUser) {
    const n = await this.get(id);
    if (n.status === 'VOIDED' || n.status === 'DECIDED') throw new BadRequestException('This NTE is already closed');
    const isHr = user.permissions.has('hr.notice');
    if (!isHr) { const emp = await this.prisma.db.employee.findUnique({ where: { userId: user.id }, select: { id: true } }); if (!emp || emp.id !== n.employeeId) throw new ForbiddenException('This is not your NTE'); }
    const upd = await this.prisma.db.nte.update({ where: { id }, data: { reply: text.trim(), repliedOn: new Date(), repliedBy: user.id, status: 'REPLIED' } });
    await this.audit.log({ action: 'UPDATE', entityType: 'Nte', entityId: id, before: { status: n.status }, after: { status: 'REPLIED', byHr: isHr }, userId: user.id });
    if (!isHr) await this.notify.toRoles(['HR_STAFF', 'ADMIN'], { type: 'NTE_REPLIED', title: `${n.employeeName} replied to ${n.nteNo}`, link: '/hr-notices' });
    return upd;
  }

  async decide(id: string, input: { decision: (typeof NTE_DECISIONS)[number]; note?: string }, user: SessionUser) {
    const n = await this.get(id);
    if (n.status === 'VOIDED') throw new BadRequestException('This NTE was cancelled');
    const upd = await this.prisma.db.nte.update({ where: { id }, data: { decision: input.decision, decisionNote: input.note?.trim() || null, decidedOn: new Date(), decidedBy: user.id, status: 'DECIDED' } });
    await this.audit.log({ action: 'UPDATE', entityType: 'Nte', entityId: id, before: { status: n.status }, after: { decision: input.decision }, userId: user.id });
    const emp = await this.prisma.db.employee.findUnique({ where: { id: n.employeeId }, select: { userId: true } });
    if (emp?.userId) await this.notify.toUsers([emp.userId], { type: 'NTE_DECIDED', title: `Decision on ${n.nteNo}: ${input.decision.replace('_', ' ').toLowerCase()}`, body: input.note, link: '/my-hr' });
    return upd;
  }

  async voidIt(id: string, reason: string, user: SessionUser) {
    const n = await this.get(id);
    if (n.status === 'VOIDED') throw new BadRequestException('Already cancelled');
    const upd = await this.prisma.db.nte.update({ where: { id }, data: { status: 'VOIDED', voidReason: reason.trim() } });
    await this.audit.log({ action: 'VOID', entityType: 'Nte', entityId: id, before: { status: n.status }, after: { reason }, userId: user.id });
    return upd;
  }

  async pdfOf(id: string, user: SessionUser) {
    const n = await this.get(id);
    if (!user.permissions.has('hr.notice')) { const emp = await this.prisma.db.employee.findUnique({ where: { userId: user.id }, select: { id: true } }); if (!emp || emp.id !== n.employeeId) throw new ForbiddenException(); }
    const emp = await this.prisma.db.employee.findUnique({ where: { id: n.employeeId }, include: { location: { select: { name: true } } } });
    const lh = ((await this.settings.get<Letterhead | null>(LETTERHEAD_KEY)) ?? {}) as Letterhead;
    const logo = lh.logoDataUrl && /^data:image\/(png|jpe?g|webp|svg\+xml);base64,/.test(lh.logoDataUrl) ? `<img src="${lh.logoDataUrl}" alt="" style="height:86px;width:auto;object-fit:contain">` : `<div style="font-size:26px;font-weight:900;letter-spacing:1px;color:#0B1F3A">GET <span style="color:#C8102E">WHEYSTED</span></div>`;
    const para = (s: string) => s.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:Calibri,Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:0}
      .lh{text-align:center;padding-bottom:10px;border-bottom:2px solid #222;margin-bottom:16px}.lh .a{font-size:11px;margin-top:8px;color:#333}.lh .c{font-size:11px;color:#1d4ed8}
      .meta{display:flex;justify-content:space-between;font-weight:700;margin:14px 6px 18px}.meta div div{margin:2px 0}
      h2{text-align:center;letter-spacing:1px;margin:10px 0 14px;font-size:16px} p{margin:0 6px 12px;line-height:1.5}
      .box{border:1px solid #222;margin:18px 6px;padding:10px;min-height:120px}.box .t{font-weight:700;margin-bottom:6px}
      .sigs{display:grid;grid-template-columns:1fr 1fr;gap:54px 40px;margin:50px 10px 0}.sig .line{height:40px;border-bottom:1px solid #222;width:85%}.sig .nm{font-weight:700;margin-top:4px}.sig .ti{font-size:11px;color:#444}
      .void{color:#b91c1c;font-weight:700;text-align:center;border:2px solid #b91c1c;padding:4px;margin-bottom:10px}
    </style></head><body>
      <div class="lh">${logo}<div class="a">${esc(lh.address ?? '')}</div><div class="c">${esc(lh.contact ?? '')}</div></div>
      ${n.status === 'VOIDED' ? `<div class="void">CANCELLED — ${esc(n.voidReason ?? '')}</div>` : ''}
      <h2>NOTICE TO EXPLAIN</h2>
      <div class="meta"><div><div>TO: ${esc(n.employeeName.toUpperCase())}${emp?.position ? ` (${esc(emp.position)})` : ''}</div><div>BRANCH: ${esc(emp?.location?.name ?? 'Head Office')}</div><div>FROM: HUMAN RESOURCES</div><div>RE: ${esc(n.subject)}</div><div>DATE: ${longDate(n.issuedOn)}</div></div><div>${esc(n.nteNo)}</div></div>
      ${para(n.details)}
      <p>You are given until <b>${longDate(n.replyDueOn)}</b> to explain in writing why no disciplinary action should be taken against you. Failure to explain by that date will be taken as a waiver of your right to be heard.</p>
      <div class="box"><div class="t">EMPLOYEE'S REPLY${n.repliedOn ? ` (received ${longDate(n.repliedOn)})` : ''}</div>${n.reply ? para(n.reply) : ''}</div>
      ${n.decision ? `<div class="box" style="min-height:60px"><div class="t">HR DECISION: ${esc(n.decision.replace('_', ' '))}</div>${n.decisionNote ? para(n.decisionNote) : ''}</div>` : ''}
      <div class="sigs"><div class="sig"><div class="line"></div><div class="nm">Human Resources</div><div class="ti">Issued by</div></div><div class="sig"><div class="line"></div><div class="nm">${esc(n.employeeName)}</div><div class="ti">Received by (signature over printed name, date)</div></div></div>
    </body></html>`;
    const out = await this.pdf.render(html);
    return { ...out, fileName: `${n.nteNo}.${out.ext}` };
  }
}
