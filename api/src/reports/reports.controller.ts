import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService, Out } from './reports.service';
import { CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import type { SessionUser } from '../common/request-context';
import { ScopeService } from '../common/scope.service';
import { manilaDateStr } from '../common/manila';

function send(res: Response, out: Out) { res.setHeader('Content-Type', out.contentType); res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`); res.send(out.buffer); }

@Controller('api/reports')
export class ReportsController {
  constructor(private r: ReportsService, private scope: ScopeService) {}
  @Get('daily-sales') @RequireAnyPermission('report.sales.own', 'report.sales.all') daily(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string, @Query('date') date?: string, @Query('audit') audit?: string) { return this.r.dailySalesData(this.scope.resolveLocation(u, locationId), date ?? manilaDateStr(), u, audit === '1'); }
  @Get('daily-sales.xlsx') @RequireAnyPermission('report.sales.own', 'report.sales.all') async dailyXlsx(@CurrentUser() u: SessionUser, @Res() res: Response, @Query('locationId') locationId?: string, @Query('date') date?: string) { send(res, await this.r.dailySalesXlsx(this.scope.resolveLocation(u, locationId), date ?? manilaDateStr(), u)); }
  @Get('daily-sales.pdf') @RequireAnyPermission('report.sales.own', 'report.sales.all') async dailyPdf(@CurrentUser() u: SessionUser, @Res() res: Response, @Query('locationId') locationId?: string, @Query('date') date?: string) { send(res, await this.r.dailySalesPdf(this.scope.resolveLocation(u, locationId), date ?? manilaDateStr(), u)); }
  @Get('stock-on-hand.xlsx') @RequireAnyPermission('report.inventory.own', 'report.inventory.all') async soh(@CurrentUser() u: SessionUser, @Res() res: Response, @Query('locationId') locationId?: string) { if (locationId) this.scope.assertLocation(u, locationId); send(res, await this.r.stockOnHandXlsx(u, locationId)); }
  @Get('daily-movement.xlsx') @RequireAnyPermission('report.inventory.own', 'report.inventory.all') async dm(@CurrentUser() u: SessionUser, @Res() res: Response, @Query('locationId') locationId: string, @Query('year') year: string, @Query('month') month: string) { send(res, await this.r.dailyMovementXlsx(u, this.scope.resolveLocation(u, locationId), Number(year), Number(month))); }
  @Get('daily-inventory.xlsx') @RequireAnyPermission('report.inventory.own', 'report.inventory.all') async di(@CurrentUser() u: SessionUser, @Res() res: Response, @Query('locationId') locationId?: string, @Query('from') from?: string, @Query('to') to?: string) { const day = manilaDateStr(); send(res, await this.r.dailyInventoryXlsx(u, this.scope.resolveLocation(u, locationId), from || day, to || from || day)); }
  @Get('inventory-cost') @RequirePermission('cost.view') invCost(@Query('from') from: string, @Query('to') to: string, @Query('groupBy') groupBy?: string, @Query('locationId') locationId?: string) { return this.r.inventoryCost({ from, to, groupBy: groupBy === 'month' ? 'month' : 'day', locationId }); }
  @Get('inventory-cost.xlsx') @RequirePermission('cost.view') async invCostXlsx(@CurrentUser() u: SessionUser, @Res() res: Response, @Query('from') from: string, @Query('to') to: string, @Query('groupBy') groupBy?: string, @Query('locationId') locationId?: string) { send(res, await this.r.inventoryCostXlsx({ from, to, groupBy: groupBy === 'month' ? 'month' : 'day', locationId }, u)); }
  @Get('direct-cost') @RequireAnyPermission('gl.view') directCost(@Query('year') year: string, @Query('month') month: string) { return this.r.directCostFromSales(Number(year), Number(month)); }
  @Get('direct-cost.xlsx') @RequireAnyPermission('gl.view') async directCostXlsx(@CurrentUser() u: SessionUser, @Res() res: Response, @Query('year') year: string, @Query('month') month: string) { send(res, await this.r.directCostFromSalesXlsx(Number(year), Number(month), u)); }
  @Get('customers') @RequireAnyPermission('report.sales.own', 'report.sales.all') customers(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string, @Query('from') from?: string, @Query('to') to?: string) { return this.r.customerContacts(u, { locationId, from, to }); }
  @Get('customers.xlsx') @RequireAnyPermission('report.sales.own', 'report.sales.all') async customersXlsx(@CurrentUser() u: SessionUser, @Res() res: Response, @Query('locationId') locationId?: string, @Query('from') from?: string, @Query('to') to?: string) { send(res, await this.r.customerContactsXlsx(u, { locationId, from, to })); }
  @Post('export.xlsx') async generic(@CurrentUser() u: SessionUser, @Res() res: Response, @Body() body: { name: string; rows: Record<string, unknown>[] }) { send(res, await this.r.genericXlsx(u, body.name || 'Export', body.rows || [])); }
  @Post('export.csv') csv(@Res() res: Response, @Body() body: { name: string; rows: Record<string, unknown>[] }) { res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', `attachment; filename="${body.name || 'export'}.csv"`); res.send(this.r.csv(body.rows || [])); }
  @Get('forms/:type/:id.:format') async form(@CurrentUser() u: SessionUser, @Res() res: Response, @Param('type') type: string, @Param('id') id: string, @Param('format') format: 'pdf' | 'xlsx') { send(res, await this.r.form(type, id, u, format === 'xlsx' ? 'xlsx' : 'pdf')); }
  @Get('fin/trial-balance.xlsx') @RequirePermission('gl.view') async tb(@CurrentUser() u: SessionUser, @Res() res: Response, @Query('year') year: string) { send(res, await this.r.trialBalanceXlsx(Number(year), u)); }
  @Get('fin/income-statement.xlsx') @RequirePermission('fs.income_statement') async is(@CurrentUser() u: SessionUser, @Res() res: Response, @Query('year') year: string) { send(res, await this.r.incomeStatementXlsx(Number(year), u)); }
  @Get('fin/balance-sheet.xlsx') @RequirePermission('fs.balance_sheet') async bs(@CurrentUser() u: SessionUser, @Res() res: Response, @Query('year') year: string) { send(res, await this.r.balanceSheetXlsx(Number(year), u)); }
  @Get('fin/ni-per-branch.xlsx') @RequirePermission('fs.income_statement') async ni(@CurrentUser() u: SessionUser, @Res() res: Response, @Query('year') year: string) { send(res, await this.r.niPerBranchXlsx(Number(year), u)); }
  @Get('fin/cash-flow.xlsx') @RequirePermission('fs.balance_sheet') async cf(@CurrentUser() u: SessionUser, @Res() res: Response, @Query('year') year: string) { send(res, await this.r.cashFlowXlsx(Number(year), u)); }
  @Get('fin/schedule/:kind.xlsx') @RequirePermission('gl.view') async sched(@CurrentUser() u: SessionUser, @Res() res: Response, @Param('kind') kind: 'SALES' | 'DIRECT_COST' | 'OPEX' | 'ASSETS', @Query('year') year: string) { send(res, await this.r.scheduleXlsx(Number(year), kind, u)); }
}
