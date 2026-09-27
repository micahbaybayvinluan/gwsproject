import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { ReportsService } from './reports.service';
import { dateStr, toDateOnly, todayManila } from '../common/manila';
import type { SessionUser } from '../common/request-context';

export const ACKNOWLEDGEMENT = 'I acknowledge that this Daily Sales Report is true and correct.';
const WATCHERS = ['HEAD_AUDITOR', 'ASST_AUDITOR', 'AUDIT_ASSOCIATE', 'HR_STAFF'] as const;

/**
 * Daily Sales Report submission (owner request 2026-09-27). The branch reviews the day's report and submits it, confirming it is true
 * and correct; that closes the day for the branch (later changes are post-close revision requests). Branches are reminded before
 * 8 PM; a branch that has not submitted by the cut-off gets its report submitted as it stands, and the auditors and HR are told.
 */
@Injectable()
export class ReportSubmissionService {
  constructor(private prisma: PrismaService, private reports: ReportsService, private notify: NotificationsService, private audit: AuditService) {}

  /** Company branches that sell (franchises report to their owner). */
  private branches() { return this.prisma.db.location.findMany({ where: { isSelling: true, active: true, type: { in: ['BRANCH', 'WAREHOUSE'] } }, select: { id: true, name: true } }); }

  async status(locationId: string, date: string, user: SessionUser) {
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    const s = await this.prisma.db.salesReportSubmission.findUnique({ where: { locationId_businessDate: { locationId, businessDate: toDateOnly(date) } }, select: { id: true, status: true, submittedAt: true, submittedBy: true, acknowledgement: true, overallSales: true, cashDeposit: true } });
    const by = s?.submittedBy ? await this.prisma.db.user.findUnique({ where: { id: s.submittedBy }, select: { fullName: true } }) : null;
    return { businessDate: date, submitted: !!s, ...(s ? { ...s, submittedByName: by?.fullName ?? null } : {}), acknowledgementText: ACKNOWLEDGEMENT };
  }

  async submit(input: { locationId: string; date: string; acknowledged: boolean }, user: SessionUser) {
    if (!input.acknowledged) throw new BadRequestException('Please confirm that the report is true and correct');
    if (user.locationScoped && !user.locationIds.includes(input.locationId)) throw new ForbiddenException('You can only submit your own branch report');
    if (input.date !== dateStr(todayManila())) throw new BadRequestException("Only today's report can be submitted; earlier days are corrected with a revision request");
    return this.record(input.locationId, input.date, user, 'SUBMITTED');
  }

  private async record(locationId: string, date: string, user: SessionUser, status: 'SUBMITTED' | 'AUTO_SUBMITTED') {
    const businessDate = toDateOnly(date);
    if (await this.prisma.db.salesReportSubmission.findUnique({ where: { locationId_businessDate: { locationId, businessDate } } })) throw new BadRequestException('This report was already submitted. Changes now need a revision request (post-close edit).');
    const rep = await this.reports.dailySalesData(locationId, date, user);
    const snapshot = JSON.parse(JSON.stringify(rep)) as Prisma.InputJsonValue;
    const s = await this.prisma.db.salesReportSubmission.create({ data: { locationId, businessDate, status, submittedBy: status === 'SUBMITTED' ? user.id : null, acknowledgement: status === 'SUBMITTED' ? ACKNOWLEDGEMENT : null, overallSales: rep.overallSales.toFixed(2), cashDeposit: rep.totalCashDeposit.toFixed(2), snapshot } });
    await this.audit.log({ action: status === 'SUBMITTED' ? 'SUBMIT' : 'AUTO_SUBMIT', entityType: 'SalesReportSubmission', entityId: s.id, after: { locationId, date, overallSales: s.overallSales, cashDeposit: s.cashDeposit }, userId: status === 'SUBMITTED' ? user.id : undefined });
    return s;
  }

  /** 7:30 PM: remind branches that have not submitted today's report yet. */
  async remind() {
    const date = todayManila(); let n = 0;
    for (const b of await this.branches()) {
      if (await this.prisma.db.salesReportSubmission.findUnique({ where: { locationId_businessDate: { locationId: b.id, businessDate: date } } })) continue;
      await this.notify.toLocation(b.id, { type: 'SALES_REPORT_REMINDER', title: `Please review and submit today's Daily Sales Report before 8 PM (${b.name})`, link: '/reports/daily-sales?submit=1' }); n++;
    }
    return { reminded: n };
  }

  /** Cut-off: a branch that did not submit gets today's report submitted as it stands; the auditors and HR are told. */
  async autoSubmit() {
    const date = dateStr(todayManila()); let n = 0;
    const system = { id: 'system', username: 'system', fullName: 'System (not submitted by the branch)', roleKey: 'ADMIN', permissions: new Set<string>(), locationIds: [], locationScoped: false, sessionId: '', totpVerified: true } as SessionUser;
    for (const b of await this.branches()) {
      if (await this.prisma.db.salesReportSubmission.findUnique({ where: { locationId_businessDate: { locationId: b.id, businessDate: toDateOnly(date) } } })) continue;
      const s = await this.record(b.id, date, system, 'AUTO_SUBMITTED');
      await this.notify.toRoles([...WATCHERS], { type: 'SALES_REPORT_NOT_SUBMITTED', title: `${b.name} did not submit the ${date} Daily Sales Report; it was submitted automatically as it stood (₱${s.overallSales} sales)`, link: `/reports/daily-sales?locationId=${b.id}&date=${date}` });
      await this.notify.toLocation(b.id, { type: 'SALES_REPORT_NOT_SUBMITTED', title: `Today's Daily Sales Report was not submitted by the branch and was submitted automatically as it stood. Changes need a revision request.`, link: `/reports/daily-sales?date=${date}` });
      n++;
    }
    return { autoSubmitted: n };
  }

  /** Dashboard: today's status for a branch user; for auditors, the branches that have not submitted yet. */
  async todayFor(user: SessionUser) {
    const date = todayManila();
    if (user.locationScoped) {
      const loc = user.locationIds[0]; if (!loc) return null;
      const l = await this.prisma.db.location.findUnique({ where: { id: loc }, select: { type: true, isSelling: true } });
      if (!l?.isSelling || l.type === 'FRANCHISE' || !user.permissions.has('sale.create')) return null;
      const s = await this.prisma.db.salesReportSubmission.findUnique({ where: { locationId_businessDate: { locationId: loc, businessDate: date } } });
      return { mine: { businessDate: dateStr(date), submitted: !!s, submittedAt: s?.submittedAt ?? null, auto: s?.status === 'AUTO_SUBMITTED' } };
    }
    if (!WATCHERS.some((r) => r === user.roleKey) && user.roleKey !== 'ADMIN') return null;
    const done = new Set((await this.prisma.db.salesReportSubmission.findMany({ where: { businessDate: date }, select: { locationId: true } })).map((s) => s.locationId));
    return { missing: (await this.branches()).filter((b) => !done.has(b.id)).map((b) => ({ name: b.name })) };
  }
}
