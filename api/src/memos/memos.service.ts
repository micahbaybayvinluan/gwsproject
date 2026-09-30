import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SequenceService } from '../common/sequence.service';
import { SettingsService } from '../common/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PdfService, type Letterhead, LETTERHEAD_KEY } from '../reports/pdf.service';
import type { SessionUser } from '../common/request-context';
import { dateStr, manilaDateStr, toDateOnly } from '../common/manila';

export interface Audience { all?: boolean; franchiseOwners?: boolean; franchiseAssociates?: boolean; roles?: string[]; locationIds?: string[]; userIds?: string[] }
export interface Signer { name: string; title: string; userId?: string | null }
export interface MemoTable { headers: string[]; rows: string[][] }
export interface MemoInput { subject: string; addressedTo?: string; fromText?: string; memoDate?: string; body: string; table?: MemoTable | null; signers?: Signer[]; audience: Audience }

/** Always on the memos of the Owner's account (owner request 2026-09-30). */
export const OWNER_SIGNERS: Signer[] = [{ name: 'AL MARVIN VINLUAN', title: 'President / Get Wheysted Supplements Corporation' }, { name: 'MICAH VINLUAN', title: 'Manager / Get Wheysted Supplements Corporation' }];
const DEFAULT_FROM = 'GET WHEYSTED SUPPLEMENTS CORPORATION';

const quarterOf = (d: Date) => Math.floor(d.getUTCMonth() / 3) + 1;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const longDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase();

/**
 * Memorandums (owner request 2026-09-30), laid out like the company memo (letterhead, TO / FROM / RE / DATE, number 2026-Q3-045 at the right,
 * body, optional table, signatures). HR, the Owner, the Franchise Coordinators and the Head Auditor write them; each memo is numbered
 * automatically per quarter, addressed to the people chosen (staff, franchise owners, franchise associates, a role, a branch or named
 * people) and every person addressed, and every signer, is notified. The Owner's memos always carry AL MARVIN VINLUAN (President) and MICAH VINLUAN (Manager).
 */
@Injectable()
export class MemosService {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private notify: NotificationsService, private pdf: PdfService, private settings: SettingsService) {}

  /** Users the audience names. */
  async resolve(a: Audience) {
    const or: Prisma.UserWhereInput[] = [];
    if (a.all) return this.prisma.db.user.findMany({ where: { active: true }, select: { id: true, fullName: true, role: { select: { name: true } } }, orderBy: { fullName: 'asc' } });
    if (a.franchiseOwners) or.push({ role: { key: 'FRANCHISE_OWNER' } });
    if (a.franchiseAssociates) or.push({ role: { key: 'FRANCHISE_SALES_ASSOCIATE' } });
    if (a.roles?.length) or.push({ role: { key: { in: a.roles } } });
    if (a.locationIds?.length) or.push({ assignments: { some: { locationId: { in: a.locationIds } } } }, { ownedFranchises: { some: { id: { in: a.locationIds } } } });
    if (a.userIds?.length) or.push({ id: { in: a.userIds } });
    if (!or.length) return [];
    return this.prisma.db.user.findMany({ where: { active: true, OR: or }, select: { id: true, fullName: true, role: { select: { name: true } } }, orderBy: { fullName: 'asc' } });
  }

  /** What the writer can choose from. */
  async options() {
    const [roles, locations, users] = await Promise.all([
      this.prisma.db.role.findMany({ select: { key: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.db.location.findMany({ where: { active: true, type: { not: 'VIRTUAL' } }, select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } }),
      this.prisma.db.user.findMany({ where: { active: true }, select: { id: true, fullName: true, role: { select: { key: true, name: true } } }, orderBy: { fullName: 'asc' } }),
    ]);
    return { roles: roles.filter((r) => r.key !== 'CUSTOM'), locations, users: users.map((u) => ({ id: u.id, name: u.fullName, roleKey: u.role.key, role: u.role.name })), ownerSigners: OWNER_SIGNERS };
  }

  private async signersFor(user: SessionUser, given: Signer[] | undefined): Promise<Signer[]> {
    const out: Signer[] = [];
    const add = (s: Signer) => { const n = s.name.trim().toUpperCase(); if (n && !out.some((x) => x.name.toUpperCase() === n)) out.push({ name: s.name.trim(), title: s.title.trim(), userId: s.userId ?? null }); };
    if (user.roleKey === 'ADMIN') OWNER_SIGNERS.forEach(add);
    (given ?? []).forEach((s) => { if (s.name?.trim()) add(s); });
    if (user.roleKey !== 'ADMIN' && !out.some((x) => x.userId === user.id)) {
      const role = await this.prisma.db.user.findUnique({ where: { id: user.id }, select: { role: { select: { name: true } } } });
      out.push({ name: user.fullName.toUpperCase(), title: role?.role.name ?? '', userId: user.id });
    }
    return out;
  }

  async create(input: MemoInput, user: SessionUser) {
    if (!input.subject?.trim()) throw new BadRequestException('Type the subject (RE)');
    if (!input.body?.trim()) throw new BadRequestException('Type the memo');
    const recipients = await this.resolve(input.audience ?? {});
    if (!recipients.length) throw new BadRequestException('Choose who the memo is addressed to');
    const table = input.table && input.table.headers?.length ? { headers: input.table.headers.map((h) => h.trim()), rows: input.table.rows.filter((r) => r.some((c) => c.trim())).map((r) => input.table!.headers.map((_, i) => (r[i] ?? '').trim())) } : null;
    const memoDate = input.memoDate ? toDateOnly(input.memoDate) : toDateOnly(manilaDateStr());
    const signers = await this.signersFor(user, input.signers);
    const year = memoDate.getUTCFullYear(), q = quarterOf(memoDate);
    const memo = await this.prisma.db.$transaction(async (tx) => {
      const n = await this.seq.next(tx, 'MEMO', { locationId: `${year}-Q${q}`, year, prefix: 'M', pad: 3 });
      const no = Number(/(\d+)$/.exec(n)![1]);
      const memoNo = `${year}-Q${q}-${String(no).padStart(3, '0')}`;
      const m = await tx.memo.create({ data: { memoNo, subject: input.subject.trim().toUpperCase(), addressedTo: (input.addressedTo?.trim() || recipients.map((r) => r.fullName).join(', ')).toUpperCase(), fromText: (input.fromText?.trim() || DEFAULT_FROM).toUpperCase(), memoDate, body: input.body.trim(), table: table as unknown as Prisma.InputJsonValue ?? Prisma.DbNull, signers: signers as unknown as Prisma.InputJsonValue, audience: input.audience as unknown as Prisma.InputJsonValue, createdBy: user.id } });
      await tx.memoRecipient.createMany({ data: recipients.map((r) => ({ memoId: m.id, userId: r.id })), skipDuplicates: true });
      return m;
    });
    await this.audit.log({ action: 'CREATE', entityType: 'Memo', entityId: memo.id, after: { memoNo: memo.memoNo, subject: memo.subject, recipients: recipients.length } });
    const n = { type: 'MEMO', title: `Memo ${memo.memoNo}: ${memo.subject}`, body: `From ${user.fullName}. Open it in Memorandums and press "I have read this".`, link: `/memos?id=${memo.id}` };
    await this.notify.toUsers(recipients.map((r) => r.id), n);
    // the signers and the Owner are told it was issued (they may not be among the addressees)
    await this.notify.toUsers(signers.map((s) => s.userId).filter((x): x is string => !!x), { ...n, title: `Memo ${memo.memoNo} was issued with your name as signer: ${memo.subject}`, body: undefined });
    await this.notify.toRoles(['ADMIN'], { ...n, title: `Memo ${memo.memoNo} issued by ${user.fullName}: ${memo.subject}`, body: `${recipients.length} people addressed.` });
    return this.view(memo, user);
  }

  private async view(m: Prisma.MemoGetPayload<object>, user: SessionUser, full = false) {
    const recs = await this.prisma.db.memoRecipient.findMany({ where: { memoId: m.id } });
    const mine = recs.find((r) => r.userId === user.id);
    const canSeeAll = user.permissions.has('memo.create') || user.roleKey === 'ADMIN';
    const names = canSeeAll && full ? await this.prisma.db.user.findMany({ where: { id: { in: recs.map((r) => r.userId) } }, select: { id: true, fullName: true, role: { select: { name: true } } } }) : [];
    const by = await this.prisma.db.user.findUnique({ where: { id: m.createdBy }, select: { fullName: true } });
    return { id: m.id, memoNo: m.memoNo, subject: m.subject, addressedTo: m.addressedTo, fromText: m.fromText, memoDate: dateStr(m.memoDate), body: m.body, table: m.table as MemoTable | null, signers: m.signers as unknown as Signer[], status: m.status, createdBy: by?.fullName ?? '', createdAt: m.createdAt, voidReason: m.voidReason,
      audience: canSeeAll ? m.audience : undefined, recipientCount: recs.length, acknowledgedCount: recs.filter((r) => r.acknowledgedAt).length, mine: mine ? { acknowledgedAt: mine.acknowledgedAt } : null,
      recipients: full && canSeeAll ? recs.map((r) => ({ userId: r.userId, name: names.find((n) => n.id === r.userId)?.fullName ?? '', role: names.find((n) => n.id === r.userId)?.role.name ?? '', acknowledgedAt: r.acknowledgedAt })).sort((a, b) => a.name.localeCompare(b.name)) : undefined };
  }

  async list(user: SessionUser) {
    const canSeeAll = user.permissions.has('memo.create') || user.roleKey === 'ADMIN';
    const rows = await this.prisma.db.memo.findMany({ where: canSeeAll ? {} : { recipients: { some: { userId: user.id } } }, orderBy: [{ memoDate: 'desc' }, { memoNo: 'desc' }], take: 200 });
    return Promise.all(rows.map((m) => this.view(m, user)));
  }
  async get(id: string, user: SessionUser) {
    const m = await this.prisma.db.memo.findUnique({ where: { id } });
    if (!m) throw new NotFoundException();
    const canSeeAll = user.permissions.has('memo.create') || user.roleKey === 'ADMIN';
    if (!canSeeAll && !(await this.prisma.db.memoRecipient.findUnique({ where: { memoId_userId: { memoId: id, userId: user.id } } }))) throw new ForbiddenException('This memo is not addressed to you');
    return this.view(m, user, true);
  }
  async acknowledge(id: string, user: SessionUser) {
    const r = await this.prisma.db.memoRecipient.findUnique({ where: { memoId_userId: { memoId: id, userId: user.id } } });
    if (!r) throw new ForbiddenException('This memo is not addressed to you');
    if (!r.acknowledgedAt) await this.prisma.db.memoRecipient.update({ where: { id: r.id }, data: { acknowledgedAt: new Date() } });
    await this.prisma.db.notification.updateMany({ where: { userId: user.id, type: 'MEMO', link: `/memos?id=${id}`, readAt: null }, data: { readAt: new Date() } });
    return this.get(id, user);
  }
  async voidMemo(id: string, reason: string, user: SessionUser) {
    const m = await this.prisma.db.memo.findUnique({ where: { id } });
    if (!m) throw new NotFoundException();
    if (user.roleKey !== 'ADMIN' && m.createdBy !== user.id) throw new ForbiddenException('Only the Owner or the writer can cancel a memo');
    if (!reason?.trim()) throw new BadRequestException('Give the reason');
    await this.prisma.db.memo.update({ where: { id }, data: { status: 'VOIDED', voidedAt: new Date(), voidedBy: user.id, voidReason: reason.trim() } });
    const recs = await this.prisma.db.memoRecipient.findMany({ where: { memoId: id }, select: { userId: true } });
    await this.notify.toUsers(recs.map((r) => r.userId), { type: 'MEMO', title: `Memo ${m.memoNo} was cancelled: ${reason.trim()}`, link: `/memos?id=${id}` });
    await this.audit.log({ action: 'VOID', entityType: 'Memo', entityId: id, after: { reason } });
    return this.get(id, user);
  }

  /** The printed memo, laid out like the company sample: centered letterhead, TO/FROM/RE/DATE with the number on the right, body, table, signatures in two columns. */
  async pdfOf(id: string, user: SessionUser) {
    await this.get(id, user);
    const m = await this.prisma.db.memo.findUniqueOrThrow({ where: { id } });
    const lh = ((await this.settings.get<Letterhead | null>(LETTERHEAD_KEY)) ?? {}) as Letterhead;
    const logo = lh.logoDataUrl && /^data:image\/(png|jpe?g|webp|svg\+xml);base64,/.test(lh.logoDataUrl) ? `<img src="${lh.logoDataUrl}" alt="" style="height:86px;width:auto;object-fit:contain">` : `<div style="font-size:26px;font-weight:900;letter-spacing:1px;color:#0B1F3A">GET <span style="color:#C8102E">WHEYSTED</span></div><div style="font-size:10px;letter-spacing:6px;color:#0B1F3A">SUPPLEMENTS</div>`;
    const table = m.table as unknown as MemoTable | null;
    const num = (s: string) => /^[\d,.\s₱%()-]+$/.test(s) && /\d/.test(s);
    const tableHtml = table?.headers?.length ? `<table class="t"><thead><tr>${table.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${table.rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${num(c) ? 'right' : 'left'}${i === 0 ? '' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
    const body = m.body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    const signers = m.signers as unknown as Signer[];
    const sig = signers.map((s) => `<div class="sig"><div class="line"></div><div class="nm">${esc(s.name)}</div><div class="ti">${esc(s.title)}</div></div>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:Calibri,Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:0}
      .lh{text-align:center;padding-bottom:10px;border-bottom:2px solid #222;margin-bottom:16px}.lh .a{font-size:11px;margin-top:8px;color:#333}.lh .c{font-size:11px;color:#1d4ed8}
      .meta{display:flex;justify-content:space-between;font-weight:700;font-size:12px;margin:14px 6px 18px}.meta div div{margin:2px 0}
      p{margin:0 6px 12px;line-height:1.5;font-size:12px}
      table.t{border-collapse:collapse;width:96%;margin:16px auto}.t th{background:#FFF200;border:1px solid #222;padding:6px 8px;text-transform:uppercase;font-size:12px}.t td{border:1px solid #222;padding:4px 8px;font-size:12px}
      .sigs{display:grid;grid-template-columns:1fr 1fr;gap:54px 40px;margin:60px 10px 0}.sig{page-break-inside:avoid}.sig .line{height:46px;border-bottom:1px solid #222;width:85%}.sig .nm{font-weight:700;text-decoration:underline;margin-top:-16px;position:relative;font-size:12px}.sig .ti{font-style:italic;font-size:11px;margin-top:2px}
      .void{color:#b91c1c;font-weight:700;text-align:center;border:2px solid #b91c1c;padding:4px;margin-bottom:10px}
    </style></head><body class="memo">
      <div class="lh">${logo}<div class="a">${esc(lh.address ?? '')}</div><div class="c">${esc(lh.contact ?? '')}</div></div>
      ${m.status === 'VOIDED' ? `<div class="void">CANCELLED — ${esc(m.voidReason ?? '')}</div>` : ''}
      <div class="meta"><div><div>TO: ${esc(m.addressedTo)}</div><div>FROM: ${esc(m.fromText)}</div><div>RE: ${esc(m.subject)}</div><div>DATE: ${longDate(m.memoDate)}</div></div><div>${esc(m.memoNo)}</div></div>
      ${body}${tableHtml}
      <div class="sigs">${sig}</div>
    </body></html>`;
    const out = await this.pdf.render(html);
    return { ...out, fileName: `Memo-${m.memoNo}.${out.ext}` };
  }
}
