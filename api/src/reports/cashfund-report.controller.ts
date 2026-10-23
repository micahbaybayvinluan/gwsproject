import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, RequireAnyPermission } from '../common/decorators';
import type { SessionUser } from '../common/request-context';
import { CashFundReportService } from './cashfund-report.service';

const VIEW = ['cashfund.view.all', 'cashfund.manage', 'cashfund.use', 'cashfund.check', 'cashfund.spend'] as const;

/** The cash fund ledger in the company's voucher format, on screen, in Excel or as a PDF. */
@Controller('api/cash-funds')
export class CashFundReportController {
  constructor(private svc: CashFundReportService) {}
  @Get(':id/report') @RequireAnyPermission(...VIEW) report(@Param('id') id: string, @CurrentUser() u: SessionUser, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.build(id, { from, to }, u); }
  @Get(':id/report.xlsx') @RequireAnyPermission(...VIEW) async xlsx(@Param('id') id: string, @CurrentUser() u: SessionUser, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const o = await this.svc.xlsx(id, { from, to }, u);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${o.fileName}"`); res.send(o.buffer);
  }
  @Get(':id/report.pdf') @RequireAnyPermission(...VIEW) async pdf(@Param('id') id: string, @CurrentUser() u: SessionUser, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const o = await this.svc.pdfFile(id, { from, to }, u);
    res.setHeader('Content-Type', o.contentType); res.setHeader('Content-Disposition', `attachment; filename="${o.fileName}"`); res.send(o.buffer);
  }
}
