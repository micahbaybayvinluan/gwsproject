import { TargetsService } from '../targets/targets.service';
import { ReportSubmissionService } from '../reports/report-submission.service';
import { CashOnHandService } from '../closing/cash-on-hand.service';
import { requestContext } from '../common/request-context';
import { PriceUpdatesService } from '../notifications/price-updates.service';
import { BadRequestException, ForbiddenException, Body, Controller, Get, Put, Query } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AlertsService } from '../alerts/alerts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../common/settings.service';
import { MasterService } from '../master/master.service';
import { FinReportsService } from '../gl/fin-reports.service';
import { CashFundService } from '../cashfund/cashfund.service';
import { CountsService } from '../counts/counts.service';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { SessionUser } from '../common/request-context';
import { todayManila, toDateOnly, dateStr } from '../common/manila';
import { D, ZERO } from '../common/money';

/** Role dashboards (§20.14), franchise portal (§8.7), Admin settings (§6.1 thresholds etc.). */
@Controller('api')
export class DashboardController {
  constructor(private targets: TargetsService, private prisma: PrismaService, private approvals: ApprovalsService, private alerts: AlertsService, private notify: NotificationsService, private settings: SettingsService, private master: MasterService, private fin: FinReportsService, private cashFund: CashFundService, private counts: CountsService, private priceUpdates: PriceUpdatesService, private cashOnHand: CashOnHandService, private reportSubmission: ReportSubmissionService) {}

  @Get('dashboard') @RequirePermission('dashboard.view')
  async dashboard(@CurrentUser() u: SessionUser) {
    const today = todayManila();
    const locWhere = u.locationScoped ? { in: u.locationIds } : { not: '' };
    const out: Record<string, unknown> = { roleKey: u.roleKey, today: dateStr(today), unreadNotifications: await this.notify.unreadCount(u.id) };
    if (u.permissions.has('approval.act.COST_ON_RECEIVING') || [...u.permissions].some((p) => p.startsWith('approval.act.'))) { const inbox = await this.approvals.inbox(u); out.approvals = { pending: inbox.count, oldestDays: inbox.oldestDays, ...(u.roleKey === 'ADMIN' ? { withOthers: (await this.approvals.inbox(u, undefined, true)).count - inbox.count } : {}) }; }
    if (u.roleKey !== 'HR_STAFF') {
      if (u.permissions.has('report.sales.own') || u.permissions.has('report.sales.all')) {
        const sales = await this.prisma.db.salesDoc.findMany({ where: { locationId: locWhere, docDate: today, voidedAt: null }, select: { grandTotal: true, paymentMode: true, locationId: true } });
        out.todaySales = { count: sales.length, total: sales.reduce((s, x) => s.plus(x.grandTotal), ZERO), byMode: Object.fromEntries(['CASH', 'ONLINE', 'CREDIT_CARD', 'AR_PDC'].map((m) => [m, sales.filter((x) => x.paymentMode === m).reduce((s, x) => s.plus(x.grandTotal), ZERO)])) };
        const ar = await this.prisma.db.salesDoc.findMany({ where: { locationId: locWhere, paymentMode: 'AR_PDC', voidedAt: null }, select: { grandTotal: true, amountPaid: true, dueDate: true } });
        const open = ar.filter((a) => a.grandTotal.gt(a.amountPaid));
        out.ar = { open: open.reduce((s, a) => s.plus(a.grandTotal.minus(a.amountPaid)), ZERO), overdue: open.filter((a) => a.dueDate && a.dueDate < today).reduce((s, a) => s.plus(a.grandTotal.minus(a.amountPaid)), ZERO) };
        // receivables by due date, the nearest first (owner request 2026-09-29)
        const due = await this.prisma.db.salesDoc.findMany({ where: { locationId: locWhere, paymentMode: 'AR_PDC', voidedAt: null, dueDate: { not: null } }, select: { id: true, drSiNo: true, grandTotal: true, amountPaid: true, dueDate: true, pdcChequeNo: true, customerName: true, customer: { select: { name: true } }, agent: { select: { name: true } }, location: { select: { name: true } } }, orderBy: { dueDate: 'asc' }, take: 300 });
        out.arDue = due.filter((a) => a.grandTotal.gt(a.amountPaid)).slice(0, 12).map((a) => ({ id: a.id, drSiNo: a.drSiNo, customer: a.customer?.name ?? a.agent?.name ?? a.customerName, branch: a.location.name, balance: a.grandTotal.minus(a.amountPaid), dueDate: dateStr(a.dueDate!), daysToDue: Math.round((a.dueDate!.getTime() - today.getTime()) / 86400000), pdc: !!a.pdcChequeNo }));
      }
      if (u.permissions.has('report.inventory.own') || u.permissions.has('report.inventory.all')) {
        out.criticalStock = (await this.alerts.criticalStock(u)).slice(0, 50);
        out.expiring = (await this.alerts.expiring(u)).summary;
        // in transit and waiting for the receiver (owner report 2026-09-30): e-commerce pull-outs and consignments are never confirmed, and a
        // receipt already entered by a warehouse associate waits for the In-Charge (in My Approvals), so neither counts here
        const awaiting = { status: 'APPROVED' as const, pendingReceiptBy: null, transferType: { notIn: ['CONSIGNMENT_OUT' as const, 'ECOMMERCE' as const] }, toLocation: { type: { notIn: ['VIRTUAL' as const, 'CONSIGNEE' as const] } } };
        if (u.locationScoped) {
          // a franchise associate confirms only when the franchise owner allows it
          const mine = u.roleKey === 'FRANCHISE_SALES_ASSOCIATE' ? (await this.prisma.db.location.findMany({ where: { id: { in: u.locationIds }, franchiseAssociateReceives: true }, select: { id: true } })).map((l) => l.id) : u.locationIds;
          if (u.permissions.has('transfer.confirm')) out.incomingTransfers = await this.prisma.db.transferDoc.count({ where: { ...awaiting, toLocationId: { in: mine } } });
        }
        else {
          const rows = await this.prisma.db.transferDoc.findMany({ where: awaiting, select: { toLocation: { select: { name: true, type: true } } } });
          const by = new Map<string, number>(); for (const r of rows) { const n = r.toLocation.name + (r.toLocation.type === 'FRANCHISE' ? ' (franchise)' : ''); by.set(n, (by.get(n) ?? 0) + 1); }
          out.transfersInTransit = { count: rows.length, branches: [...by.entries()].map(([name, count]) => ({ name, count })) };
        }
      }
      if (u.permissions.has('discrepancy.view') || u.permissions.has('count.create')) out.openDiscrepancies = await this.prisma.db.discrepancyCase.count({ where: { status: 'OPEN', countDoc: { locationId: locWhere } } });
    }
    if (u.roleKey === 'HR_STAFF' || u.permissions.has('charge_form.finalize')) out.chargeFormsPending = await this.prisma.db.chargeForm.count({ where: { finalizedByHrAt: null, location: { type: { not: 'FRANCHISE' } } } }); // franchise charges are the franchise owner's, not HR's
    // branch cash funds: every balance for Admin / auditors / Accounting (and the Field Auditor who checks them); own fund for branch staff
    if (['cashfund.view.all', 'cashfund.check', 'cashfund.use', 'cashfund.manage'].some((k) => u.permissions.has(k))) out.cashFunds = await this.cashFund.dashboard(u);
    // discrepancy countdown for branch staff: days left before an open case is charged (shown in bold red)
    if (u.permissions.has('discrepancy.explain') && u.locationScoped) {
      const cases = await this.prisma.db.discrepancyCase.findMany({ where: { status: 'OPEN', countDoc: { locationId: { in: u.locationIds } } }, include: { countDoc: { select: { controlNo: true, location: { select: { name: true } }, lines: { where: { variance: { lt: 0 } }, select: { variance: true } } } } }, orderBy: { deadline: 'asc' } });
      const pendingExpl = await this.prisma.db.approvalRequest.findMany({ where: { type: 'DISCREPANCY_EXPLANATION', status: 'PENDING', documentId: { in: cases.map((c) => c.id) } }, select: { documentId: true } });
      out.discrepancyDeadlines = cases.map((c) => ({ caseId: c.id, caseNo: c.caseNo, countNo: c.countDoc.controlNo, location: c.countDoc.location.name, deadline: dateStr(c.deadline), daysLeft: Math.max(0, Math.ceil((c.deadline.getTime() - Date.now()) / 86400000)), shortItems: c.countDoc.lines.length, shortUnits: c.countDoc.lines.reduce((t, l) => t - l.variance, 0), explanationPending: pendingExpl.some((p) => p.documentId === c.id) }));
    }
    // weekly count sheet reminder for branch associates
    if (u.permissions.has('count.create') && ['SALES_ASSOCIATE', 'WAREHOUSE_ASSOCIATE'].includes(u.roleKey)) out.weeklyCount = await this.counts.myWeekly(u);
    // HR: who has not submitted last week's count sheet; inspections waiting for review
    if (u.permissions.has('inspection.review')) {
      const wc = await this.counts.weeklyCompliance(2);
      out.weeklyCountsMissedLastWeek = wc.rows.filter((r) => !r.weeks[0].submitted).map((r) => ({ name: r.name, branch: r.branch }));
      out.inspectionsToReview = await this.prisma.db.storeInspection.count({ where: { status: 'SUBMITTED' } });
    }
    // the signed-in person's own charges (only theirs)
    const emp = await this.prisma.db.employee.findUnique({ where: { userId: u.id }, select: { id: true } });
    if (emp) { const al = await this.prisma.db.chargeFormAllocation.findMany({ where: { employeeId: emp.id }, select: { amount: true, deductedToDate: true, acknowledgedAt: true } }); out.myCharges = { toAcknowledge: al.filter((a) => !a.acknowledgedAt).length, openBalance: al.reduce((t, a) => t.plus(a.amount).minus(a.deductedToDate), ZERO) }; }
    if (u.permissions.has('gl.view')) { const y = today.getUTCFullYear(); out.gl = { vouchersThisMonth: await this.prisma.db.journalVoucher.count({ where: { voidedAt: null, date: { gte: new Date(Date.UTC(y, today.getUTCMonth(), 1)) } } }), lockedPeriods: await this.prisma.db.accountingPeriod.count({ where: { year: y, locked: true } }) }; }
    // price changes this person uses (supplier cost only for Owner, Head Auditor, External Auditor, Accounting Head)
    out.priceUpdates = await this.priceUpdates.recentFor(u);
    // the person's own requests and how far each got in its approval
    out.myRequests = (await this.approvals.mine(u.id)).slice(0, 8);
    // today's Daily Sales Report: submitted yet? (branch) / which branches have not (auditors, HR, Owner)
    const rs = await this.reportSubmission.todayFor(u); if (rs?.mine) out.salesReport = rs.mine; if (rs?.missing) out.salesReportsMissing = rs.missing;
    // cash sales not yet deposited: own branch for branch staff; every branch for the auditors and the Owner
    if (u.permissions.has('cashdeposit.view.all')) out.cashOnHandBranches = (await this.cashOnHand.allBranches()).filter((b) => Number(b.cashOnHand) > 0);
    else if (u.permissions.has('sale.create') && u.locationScoped && u.locationIds[0]) {
      const loc = await this.prisma.db.location.findUnique({ where: { id: u.locationIds[0] }, select: { type: true } });
      if (loc && loc.type !== 'FRANCHISE') { const b = await this.cashOnHand.forBranch(u.locationIds[0]); out.cashOnHand = { ...b, days: b.days.filter((d) => d.status !== 'DEPOSITED') }; }
    }
    // targets: the month's achievement (Sales Manager, Owner, auditors) and the Agent's own
    if (u.permissions.has('target.view') || u.permissions.has('target.manage')) { const p = await this.targets.progress(dateStr(today).slice(0, 7), u); out.targets = { ...p.totals, pacePct: p.pacePct, belowPace: p.branches.filter((b) => b.achievedPct != null && b.achievedPct < p.pacePct).map((b) => b.name), pendingApproval: [...p.branches, ...p.agents].filter((r) => r.pendingTarget != null).length }; }
    if (u.permissions.has('agent.self')) { const m = await this.targets.mine(u, dateStr(today).slice(0, 7)); out.agentMonth = { linked: m.linked, total: m.total, count: m.sales.length, target: m.target, achievedPct: m.achievedPct, pacePct: 'pacePct' in m ? m.pacePct : null, arOpen: m.ar.reduce((t, a) => t + a.balance, 0), arDue: m.ar.slice(0, 5) }; }
    return out;
  }

  /** §8.7 Franchise owner portal. */
  @Get('franchise/portal') @RequirePermission('franchise.portal')
  async portal(@CurrentUser() u: SessionUser) {
    const locationId = u.locationIds[0]; const today = todayManila();
    if (!locationId) throw new BadRequestException('The franchise portal is for accounts assigned to a franchise location');
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    const stock = await this.prisma.db.stockBalance.groupBy({ by: ['productId'], where: { locationId, qty: { gt: 0 } }, _sum: { qty: true } });
    const incoming = await this.prisma.db.transferDoc.findMany({ where: { toLocationId: locationId, status: 'APPROVED' }, include: { fromLocation: { select: { name: true } }, lines: true } });
    const sales = await this.prisma.db.salesDoc.aggregate({ where: { locationId, docDate: today, voidedAt: null }, _sum: { grandTotal: true }, _count: true });
    // what they owe GWS = open AR on the franchise customer (transfers from warehouse at franchise cost + any AR sales)
    const cust = await this.prisma.db.customer.findFirst({ where: { locationId, type: 'FRANCHISE' } });
    // what the franchise owes GWS sits on GWS invoices (warehouse locations): the owner only, read outside the branch scope
    const owed = cust && u.roleKey === 'FRANCHISE_OWNER' ? await requestContext.runSystem(async () => await this.prisma.db.salesDoc.aggregate({ where: { customerId: cust.id, voidedAt: null }, _sum: { grandTotal: true, amountPaid: true } })) : null;
    const transfersIn = await this.prisma.db.transferLine.findMany({ where: { doc: { toLocationId: locationId, status: { in: ['RECEIVED', 'RESOLVED'] } }, qtyReceived: { gt: 0 } }, include: { doc: { select: { docDate: true } } } });
    let transferValue = ZERO; for (const t of transfersIn) transferValue = transferValue.plus(D(await this.master.priceFor(t.productId, 'FRANCHISE', t.doc.docDate) ?? 0).mul(t.qtyReceived!));
    return { franchise: loc, stockLines: stock.length, stockUnits: stock.reduce((s, x) => s + (x._sum.qty ?? 0), 0), incoming: incoming.map((t) => ({ id: t.id, controlNo: t.controlNo, from: t.fromLocation.name, lines: t.lines.length })), todaySales: { count: sales._count, total: sales._sum.grandTotal ?? ZERO }, arToWarehouse: u.roleKey === 'FRANCHISE_OWNER' ? { openInvoices: D(owed?._sum.grandTotal).minus(D(owed?._sum.amountPaid)), transfersAtFranchiseCost: transferValue } : null, isOwner: u.roleKey === 'FRANCHISE_OWNER', associateReceives: loc.franchiseAssociateReceives, expiring: (await this.alerts.expiring(u, locationId)).summary };
  }
  /** §8.7 Franchise Income Statement = Sales (their retail) − COGS at franchise cost − their expenses. */
  @Get('franchise/pnl') @RequirePermission('franchise.pnl')
  async pnl(@CurrentUser() u: SessionUser, @Query('from') from: string, @Query('to') to: string) {
    if (u.roleKey !== 'FRANCHISE_OWNER') throw new ForbiddenException('Only the franchise owner sees the franchise income statement');
    const locationId = u.locationIds[0]; const f = toDateOnly(from), t = toDateOnly(to);
    const lines = await this.prisma.db.salesLine.findMany({ where: { doc: { locationId, voidedAt: null, docDate: { gte: f, lte: t } } }, include: { doc: { select: { docDate: true, deliveryFee: true, shippingFee: true } } } });
    let sales = ZERO, cogs = ZERO;
    for (const l of lines) { sales = sales.plus(l.amount); cogs = cogs.plus(D(await this.master.priceFor(l.productId, 'FRANCHISE', l.doc.docDate) ?? 0).mul(l.qty)); }
    const fees = await this.prisma.db.salesDoc.aggregate({ where: { locationId, voidedAt: null, docDate: { gte: f, lte: t } }, _sum: { deliveryFee: true, shippingFee: true } });
    const exp = await this.prisma.db.franchiseExpense.groupBy({ by: ['category'], where: { locationId, voidedAt: null, docDate: { gte: f, lte: t } }, _sum: { amount: true } });
    const expenses = exp.map((e) => ({ category: e.category, amount: e._sum.amount ?? ZERO })); const totalExp = expenses.reduce((s, e) => s.plus(e.amount), ZERO);
    const revenue = sales.plus(fees._sum.deliveryFee ?? 0).plus(fees._sum.shippingFee ?? 0);
    return { from, to, revenue: { productSales: sales, fees: D(fees._sum.deliveryFee).plus(fees._sum.shippingFee ?? 0), total: revenue }, costOfGoodsAtFranchiseCost: cogs, grossProfit: revenue.minus(cogs), expenses, totalExpenses: totalExp, netIncome: revenue.minus(cogs).minus(totalExp) };
  }
  /** Franchise → warehouse product request (message; no product creation, §8.7). */
  @Put('franchise/request-product') @RequirePermission('franchise.portal')
  async requestProduct(@CurrentUser() u: SessionUser, @Body() body: { message: string }) { await this.notify.toRoles(['WAREHOUSE_IN_CHARGE', 'HEAD_AUDITOR', 'ADMIN'], { type: 'FRANCHISE_REQUEST', title: `Product request from ${u.fullName}`, body: body.message }); return { ok: true }; }

  @Get('settings') @RequirePermission('settings.thresholds') settingsAll() { return this.settings.all(); }
  @Put('settings') @RequirePermission('settings.thresholds') async setSettings(@CurrentUser() u: SessionUser, @Body() body: Record<string, unknown>) { for (const [k, v] of Object.entries(body)) await this.settings.set(k, v, u.id); return this.settings.all(); }
}
