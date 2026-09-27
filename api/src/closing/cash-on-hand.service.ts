import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { ClosingService } from './closing.service';
import { addDays, dateStr, daysBetween, toDateOnly, todayManila } from '../common/manila';
import { D, ZERO } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

/** How far back undeposited days are looked for. */
const LOOKBACK_DAYS = 120;
const AUDITORS = ['HEAD_AUDITOR', 'ASST_AUDITOR', 'AUDIT_ASSOCIATE'] as const;

export type DepositStatus = 'DEPOSITED' | 'OPEN' | 'DUE_TODAY' | 'OVERDUE';
export interface CashDay { businessDate: string; toDeposit: string; deposited: string; outstanding: string; dueDate: string; daysLeft: number; status: DepositStatus; extension: { status: string; requestedUntil: string; reason: string } | null }

/**
 * Cash on hand (owner request 2026-09-27): a day's cash sales to deposit (the Daily Close "total cash deposit") that is not yet
 * in the bank. Each branch has a number of days allowed to deposit (set by the Head Auditor or Admin). The branch sees it on its
 * dashboard; when a day is due the auditors are reminded; the branch may ask for more days (Head Auditor and Admin both approve);
 * once past the due date without an approved extension, HR and the Owner get a notice to issue a Notice to Explain.
 */
@Injectable()
export class CashOnHandService implements OnModuleInit {
  constructor(private prisma: PrismaService, private approvals: ApprovalsService, private notify: NotificationsService, private audit: AuditService, private closing: ClosingService) {}

  onModuleInit() {
    this.approvals.register('CASH_DEPOSIT_EXTENSION', (req, outcome) => this.onExtensionDecision(req.documentId, outcome));
  }

  private assertCanSee(user: SessionUser, locationId: string) {
    if (user.permissions.has('cashdeposit.view.all')) return;
    if (!user.locationIds.includes(locationId)) throw new ForbiddenException('You can only see your own branch');
  }

  /** Every day with cash still to deposit (and recent deposited days) for one branch. */
  async forBranch(locationId: string, user?: SessionUser) {
    if (user) this.assertCanSee(user, locationId);
    const loc = await this.prisma.db.location.findUnique({ where: { id: locationId }, select: { id: true, name: true, code: true, type: true, cashDepositMaxDays: true } });
    if (!loc) throw new NotFoundException();
    const today = todayManila(); const since = addDays(today, -LOOKBACK_DAYS);
    const closes = await this.prisma.db.dailyClose.findMany({ where: { locationId, businessDate: { gte: since, lt: today } }, select: { businessDate: true, totalCashDeposit: true } });
    const toDeposit = new Map(closes.map((c) => [dateStr(c.businessDate), D(c.totalCashDeposit)]));
    // today is not closed yet: its running total counts as cash on hand too
    const live = await this.closing.summary(locationId, today);
    toDeposit.set(dateStr(today), D(live.totalCashDeposit));
    const deps = await this.prisma.db.cashDeposit.groupBy({ by: ['businessDate'], where: { locationId, businessDate: { gte: since } }, _sum: { amount: true } });
    const deposited = new Map(deps.map((d) => [dateStr(d.businessDate), D(d._sum.amount ?? 0)]));
    const exts = await this.prisma.db.cashDepositExtension.findMany({ where: { locationId, businessDate: { gte: since } }, orderBy: { createdAt: 'desc' } });
    const days: CashDay[] = [];
    for (const [day, amt] of [...toDeposit.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (amt.lte(0)) continue;
      const dep = deposited.get(day) ?? ZERO; const out = amt.minus(dep);
      const ext = exts.find((e) => dateStr(e.businessDate) === day) ?? null;
      const approvedUntil = exts.find((e) => dateStr(e.businessDate) === day && e.status === 'APPROVED')?.requestedUntil;
      const due = approvedUntil ?? addDays(toDateOnly(day), loc.cashDepositMaxDays);
      const daysLeft = daysBetween(today, due);
      const status: DepositStatus = out.lte(0.009) ? 'DEPOSITED' : daysLeft < 0 ? 'OVERDUE' : daysLeft === 0 ? 'DUE_TODAY' : 'OPEN';
      if (status === 'DEPOSITED' && daysBetween(toDateOnly(day), today) > 14) continue; // keep the list short: only recent deposited days
      days.push({ businessDate: day, toDeposit: amt.toFixed(2), deposited: dep.toFixed(2), outstanding: (out.gt(0) ? out : ZERO).toFixed(2), dueDate: dateStr(due), daysLeft, status, extension: ext ? { status: ext.status, requestedUntil: dateStr(ext.requestedUntil), reason: ext.reason } : null });
    }
    const open = days.filter((d) => d.status !== 'DEPOSITED');
    const cashOnHand = open.reduce((t, d) => t.plus(d.outstanding), ZERO);
    return { location: { id: loc.id, name: loc.name, code: loc.code }, maxDays: loc.cashDepositMaxDays, cashOnHand: cashOnHand.toFixed(2), overdue: open.filter((d) => d.status === 'OVERDUE').length, dueToday: open.filter((d) => d.status === 'DUE_TODAY').length, days };
  }

  /** Every company branch at a glance (auditors, Admin). */
  async allBranches() {
    const locs = await this.prisma.db.location.findMany({ where: { isSelling: true, active: true, type: { in: ['BRANCH', 'WAREHOUSE'] } }, select: { id: true }, orderBy: { name: 'asc' } });
    const out = [];
    for (const l of locs) { const b = await this.forBranch(l.id); out.push({ ...b.location, maxDays: b.maxDays, cashOnHand: b.cashOnHand, overdue: b.overdue, dueToday: b.dueToday, oldest: b.days.find((d) => d.status !== 'DEPOSITED')?.businessDate ?? null }); }
    return out;
  }

  /** Days allowed to deposit, per branch (Head Auditor, Admin). */
  async setMaxDays(locationId: string, maxDays: number, user: SessionUser) {
    if (!Number.isInteger(maxDays) || maxDays < 0 || maxDays > 30) throw new BadRequestException('Days allowed must be a whole number from 0 to 30');
    const before = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId }, select: { cashDepositMaxDays: true, name: true } });
    const after = await this.prisma.db.location.update({ where: { id: locationId }, data: { cashDepositMaxDays: maxDays }, select: { id: true, name: true, cashDepositMaxDays: true } });
    await this.audit.log({ action: 'UPDATE', entityType: 'Location', entityId: locationId, before, after, userId: user.id });
    await this.notify.toLocation(locationId, { type: 'CASH_DEPOSIT_RULE', title: `${after.name}: cash sales must now be deposited within ${maxDays} day(s)`, link: '/cash-on-hand' });
    return after;
  }

  /** The branch asks for more days to deposit one day's cash; the Head Auditor and Admin both approve. */
  async requestExtension(input: { locationId: string; businessDate: string; requestedUntil: string; reason: string }, user: SessionUser) {
    if (user.locationScoped && !user.locationIds.includes(input.locationId)) throw new ForbiddenException();
    const b = await this.forBranch(input.locationId);
    const day = b.days.find((d) => d.businessDate === input.businessDate);
    if (!day || day.status === 'DEPOSITED') throw new BadRequestException('There is no undeposited cash for that day');
    if (input.requestedUntil <= day.dueDate) throw new BadRequestException(`Choose a date after the current due date (${day.dueDate})`);
    if (await this.prisma.db.cashDepositExtension.findFirst({ where: { locationId: input.locationId, businessDate: toDateOnly(input.businessDate), status: 'PENDING' } })) throw new BadRequestException('An extension for that day is already waiting for approval');
    const ext = await this.prisma.db.cashDepositExtension.create({ data: { locationId: input.locationId, businessDate: toDateOnly(input.businessDate), requestedUntil: toDateOnly(input.requestedUntil), reason: input.reason, requestedBy: user.id } });
    const req = await this.approvals.request({ type: 'CASH_DEPOSIT_EXTENSION', documentType: 'CashDepositExtension', documentId: ext.id, requestedBy: user.id, summary: { locationId: input.locationId, locationName: b.location.name, businessDate: input.businessDate, amount: day.outstanding, dueDate: day.dueDate, requestedUntil: input.requestedUntil, reason: input.reason } });
    await this.prisma.db.cashDepositExtension.update({ where: { id: ext.id }, data: { approvalRequestId: req.id } });
    return { ...ext, approvalRequestId: req.id };
  }

  private async onExtensionDecision(id: string, outcome: 'APPROVED' | 'REJECTED') {
    await requestContext.runSystem(async () => {
      const ext = await this.prisma.db.cashDepositExtension.update({ where: { id }, data: { status: outcome, decidedAt: new Date() } });
      const title = outcome === 'APPROVED' ? `Deposit of ${dateStr(ext.businessDate)} sales extended until ${dateStr(ext.requestedUntil)}` : `Extension to deposit ${dateStr(ext.businessDate)} sales was not approved — deposit it now`;
      await this.notify.toLocation(ext.locationId, { type: 'CASH_DEPOSIT_EXTENSION_DECIDED', title, link: '/cash-on-hand' });
    });
  }

  /**
   * Daily reminder job: auditors and the branch are reminded of cash due today or overdue (once a day per branch);
   * a day past its due date with no approved or pending extension becomes an HR notice (once per branch-day) for a Notice to Explain.
   */
  async remind(now: Date = new Date()) {
    const today = todayManila(); let reminders = 0, notices = 0;
    const locs = await this.prisma.db.location.findMany({ where: { isSelling: true, active: true, type: { in: ['BRANCH', 'WAREHOUSE'] } }, select: { id: true } });
    for (const l of locs) {
      const b = await this.forBranch(l.id);
      const due = b.days.filter((d) => d.status === 'DUE_TODAY' || d.status === 'OVERDUE');
      if (!due.length) continue;
      const already = await this.prisma.db.notification.findFirst({ where: { type: 'CASH_DEPOSIT_DUE', link: `/cash-on-hand?locationId=${l.id}`, createdAt: { gte: new Date(now.getTime() - 20 * 3600e3) } } });
      if (!already) {
        const total = due.reduce((t, d) => t.plus(d.outstanding), ZERO);
        const n = { type: 'CASH_DEPOSIT_DUE', title: `${b.location.name}: ₱${total.toFixed(2)} cash on hand due for deposit (${due.map((d) => d.businessDate).join(', ')})`, body: due.some((d) => d.status === 'OVERDUE') ? 'Some of it is past the deposit deadline.' : 'Deposit it today or request an extension.', link: `/cash-on-hand?locationId=${l.id}` };
        await this.notify.toLocation(l.id, n, [...AUDITORS]);
        reminders++;
      }
      for (const d of due.filter((x) => x.status === 'OVERDUE' && x.extension?.status !== 'PENDING')) {
        const key = `CASH_DEPOSIT_OVERDUE:${l.id}:${d.businessDate}:${d.dueDate}`;
        if (await this.prisma.db.hrNotice.findUnique({ where: { dedupeKey: key } })) continue;
        const staff = await this.prisma.db.user.findMany({ where: { active: true, role: { key: 'SALES_ASSOCIATE' }, assignments: { some: { locationId: l.id } } }, select: { id: true, fullName: true } });
        await this.prisma.db.hrNotice.create({ data: { kind: 'CASH_DEPOSIT_OVERDUE', dedupeKey: key, locationId: l.id, title: `${b.location.name}: cash sales of ${d.businessDate} not deposited by ${d.dueDate}`, details: { businessDate: d.businessDate, dueDate: d.dueDate, outstanding: d.outstanding, extension: d.extension } as Prisma.InputJsonValue, staffIds: staff.map((s) => ({ id: s.id, name: s.fullName })) as Prisma.InputJsonValue } });
        await this.notify.toRoles(['HR_STAFF', 'ADMIN'], { type: 'HR_NOTICE_NTE', title: `Notice to Explain needed: ${b.location.name} did not deposit ₱${d.outstanding} of ${d.businessDate} sales by ${d.dueDate}`, body: staff.length ? `Staff on duty: ${staff.map((s) => s.fullName).join(', ')}` : undefined, link: '/hr-notices' });
        notices++;
      }
    }
    return { reminders, notices };
  }

  listNotices(status?: string) { return this.prisma.db.hrNotice.findMany({ where: { status: status || undefined }, orderBy: { createdAt: 'desc' }, take: 300 }); }

  async updateNotice(id: string, input: { status: 'NTE_ISSUED' | 'CLOSED' | 'OPEN'; note?: string }, user: SessionUser) {
    const before = await this.prisma.db.hrNotice.findUnique({ where: { id } }); if (!before) throw new NotFoundException();
    const after = await this.prisma.db.hrNotice.update({ where: { id }, data: { status: input.status, note: input.note ?? before.note, resolvedAt: input.status === 'OPEN' ? null : new Date(), resolvedBy: input.status === 'OPEN' ? null : user.id } });
    await this.audit.log({ action: 'UPDATE', entityType: 'HrNotice', entityId: id, before, after, userId: user.id });
    return after;
  }
}
