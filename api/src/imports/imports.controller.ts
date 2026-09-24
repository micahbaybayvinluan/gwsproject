import { Body, Controller, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ImportsService } from './imports.service';
import { CurrentUser, RequirePermission, RequireAnyPermission, Audited } from '../common/decorators';
import type { SessionUser } from '../common/request-context';
import { AccountClass } from '@prisma/client';

type F = { buffer: Buffer; originalname: string; mimetype: string };
const Up = () => UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }));

@Controller('api/imports')
export class ImportsController {
  constructor(private svc: ImportsService) {}
  @Get('templates/:kind.xlsx') async template(@Param('kind') kind: string, @Res() res: Response) { const b = await this.svc.template(kind); res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${kind}-template.xlsx"`); res.send(b); }
  @Post('products/seed-workbook') @RequirePermission('product.create') @Up() @Audited('Product', 'IMPORT') seed(@UploadedFile() f: F, @CurrentUser() u: SessionUser, @Query('sheet') sheet?: string) { return this.svc.productsFromSeedWorkbook(f.buffer, u, sheet); }
  @Post('products') @RequirePermission('product.create') @Up() @Audited('Product', 'IMPORT') products(@UploadedFile() f: F, @CurrentUser() u: SessionUser) { return this.svc.products(f.buffer, u); }
  @Post('prices') @RequirePermission('price.edit') @Up() @Audited('PriceList', 'IMPORT') prices(@UploadedFile() f: F, @CurrentUser() u: SessionUser) { return this.svc.prices(f.buffer, u); }
  @Post('min-stock') @RequirePermission('settings.thresholds') @Up() @Audited('MinStockLevel', 'IMPORT') minStock(@UploadedFile() f: F, @CurrentUser() u: SessionUser) { return this.svc.minStock(f.buffer, u); }
  @Post('opening-stock') @RequirePermission('cost.edit') @Up() @Audited('OpeningStock', 'IMPORT') opening(@UploadedFile() f: F, @Query('date') date: string, @CurrentUser() u: SessionUser) { return this.svc.openingStock(f.buffer, date, u); }
  @Post('count-lines') @RequirePermission('count.create') @Up() count(@UploadedFile() f: F) { return this.svc.countLines(f.buffer); }
  @Post('coa/preview') @RequirePermission('gl.account.edit') @Up() coaPreview(@UploadedFile() f: F, @Query('sheet') sheet?: string) { return this.svc.coaPreview(f.buffer, sheet); }
  @Post('coa/commit') @RequirePermission('gl.account.edit') @Audited('Account', 'IMPORT') coaCommit(@Body() body: { year: number; rows: { code?: string | null; title: string; class: AccountClass; branchCode?: string | null; channelTag?: string | null; templateKey?: string | null; entryScope?: 'BRANCH' | 'MAIN' | 'BOTH'; beginningDebit?: number; beginningCredit?: number }[] }, @CurrentUser() u: SessionUser) { return this.svc.coaCommit(body.rows, body.year, u); }
  @Post('beginning-balances') @RequirePermission('gl.beginning_balance') @Up() @Audited('BeginningBalance', 'IMPORT') bb(@UploadedFile() f: F, @Query('year') year: string, @CurrentUser() u: SessionUser) { return this.svc.beginningBalances(f.buffer, Number(year), u); }
  @Post('employees') @RequirePermission('employee.manage') @Up() @Audited('Employee', 'IMPORT') employees(@UploadedFile() f: F, @CurrentUser() u: SessionUser) { return this.svc.employees(f.buffer, u); }
  @Post('open-ar') @RequirePermission('ar.collect') @Up() @Audited('SalesDoc', 'IMPORT_AR') openAr(@UploadedFile() f: F, @CurrentUser() u: SessionUser) { return this.svc.openAr(f.buffer, u); }
  @Post('reconcile') @RequireAnyPermission('report.sales.all') @Up() reconcile(@UploadedFile() f: F) { return this.svc.reconcile(f.buffer); }
}
