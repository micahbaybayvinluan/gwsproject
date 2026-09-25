import { BadRequestException, Body, Controller, Get, Put, Query } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AlertsService } from '../alerts/alerts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../common/settings.service';
import { MasterService } from '../master/master.service';
import { FinReportsService } from '../gl/fin-reports.service';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { SessionUser } from '../common/request-context';
import { todayManila, toDateOnly, dateStr } from '../common/manila';
import { D, ZERO } from '../common/money';

/** Role dashboards (§20.14), franchise portal (§8.7), Admin settings (§6.1 thresholds etc.). */
@Controller('api')
export class DashboardController {
  constructor(private prisma: PrismaService, private approvals: ApprovalsService, private alerts: AlertsService, private notify: NotificationsService, private settings: SettingsService, private master: MasterService, private fin: FinReportsService) {}

  @Get('dashboard') @RequirePermission('dashboard.view')
  async dashboard(@CurrentUser() u: SessionUser) {
    const today = todayManila();
    const locWhere = u.locationScoped ? { in: u.locationIds } : { not: '' };
    const out: Record<string, unknown> = { roleKey: u.roleKey, today: dateStr(today), unreadNotifications: await this.notify.unreadCount(u.id) };
    if (u.permissions.has('approval.act.COST_ON_RECEIVING') || [...u.permissions].some((p) => p.startsWith('approval.act.'))) { const inbox = await this.approvals.inbox(u); out.approvals = { pending: inbox.count, oldestDays: inbox.oldestDays }; }
    if (u.roleKey !== 'HR_STAFF') {
      if (u.permissions.has('report.sales.own') || u.permissions.has('report.sales.all')) {
        const sales = await this.prisma.db.salesDoc.findMany({ where: { locationId: locWhere, docDate: today, voidedAt: null }, select: { grandTotal: true, paymentMode: true, locationId: true } });
        out.todaySales = { count: sales.length, total: sales.reduce((s, x) => s.plus(x.grandTotal), ZERO), byMode: Object.fromEntries(['CASH', 'ONLINE', 'CREDIT_CARD', 'AR_PDC'].map((m) => [m, sales.filter((x) => x.paymentMode === m).reduce((s, x) => s.plus(x.grandTotal), ZERO)])) };
        const ar = await this.prisma.db.salesDoc.findMany({ where: { locationId: locWhere, paymentMode: 'AR_PDC', voidedAt: null }, select: { grandTotal: true, amountPaid: true, dueDate: true } });
        const open = ar.filter((a) => a.grandTotal.gt(a.amountPaid));
        out.ar = { open: open.reduce((s, a) => s.plus(a.grandTotal.minus(a.amountPaid)), ZERO), overdue: open.filter((a) => a.dueDate && a.dueDate < today).reduce((s, a) => s.plus(a.grandTotal.minus(a.amountPaid)), ZERO) };
      }
      if (u.permissions.has('report.inventory.own') || u.permissions.has('report.inventory.all')) {
        out.criticalStock = (await this.alerts.criticalStock(u)).slice(0, 50);
        out.expiring = (await this.alerts.expiring(u)).summary;
        out.incomingTransfers = await this.prisma.db.transferDoc.count({ where: { status: 'APPROVED', toLocationId: locWhere } });
      }
      if (u.permissions.has('discrepancy.view') || u.permissions.has('count.create')) out.openDiscrepancies = await this.prisma.db.discrepancyCase.count({ where: { status: 'OPEN', countDoc: { locationId: locWhere } } });
    }
    if (u.roleKey === 'HR_STAFF' || u.permissions.has('charge_form.finalize')) out.chargeFormsPending = await this.prisma.db.chargeForm.count({ where: { finalizedByHrAt: null } });
    if (u.permissions.has('gl.view')) { const y = today.getUTCFullYear(); out.gl = { vouchersThisMonth: await this.prisma.db.journalVoucher.count({ where: { voidedAt: null, date: { gte: new Date(Date.UTC(y, today.getUTCMonth(), 1)) } } }), lockedPeriods: await this.prisma.db.accountingPeriod.count({ where: { year: y, locked: true } }) }; }
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
    const owed = cust ? await this.prisma.db.salesDoc.aggregate({ where: { customerId: cust.id, voidedAt: null }, _sum: { grandTotal: true, amountPaid: true } }) : null;
    const transfersIn = await this.prisma.db.transferLine.findMany({ where: { doc: { toLocationId: locationId, status: { in: ['RECEIVED', 'RESOLVED'] } }, qtyReceived: { gt: 0 } }, include: { doc: { select: { docDate: true } } } });
    let transferValue = ZERO; for (const t of transfersIn) transferValue = transferValue.plus(D(await this.master.priceFor(t.productId, 'FRANCHISE', t.doc.docDate) ?? 0).mul(t.qtyReceived!));
    return { franchise: loc, stockLines: stock.length, stockUnits: stock.reduce((s, x) => s + (x._sum.qty ?? 0), 0), incoming: incoming.map((t) => ({ id: t.id, controlNo: t.controlNo, from: t.fromLocation.name, lines: t.lines.length })), todaySales: { count: sales._count, total: sales._sum.grandTotal ?? ZERO }, arToWarehouse: { openInvoices: D(owed?._sum.grandTotal).minus(D(owed?._sum.amountPaid)), transfersAtFranchiseCost: transferValue }, expiring: (await this.alerts.expiring(u, locationId)).summary };
  }
  /** §8.7 Franchise Income Statement = Sales (their retail) − COGS at franchise cost − their expenses. */
  @Get('franchise/pnl') @RequirePermission('franchise.pnl')
  async pnl(@CurrentUser() u: SessionUser, @Query('from') from: string, @Query('to') to: string) {
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
