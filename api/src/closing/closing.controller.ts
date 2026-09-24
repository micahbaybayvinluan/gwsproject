import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ClosingService } from './closing.service';
import { CurrentUser, RequireAnyPermission, RequirePermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { ScopeService } from '../common/scope.service';
import { toDateOnly, todayManila } from '../common/manila';

const CashCount = z.object({ locationId: z.string().uuid().optional(), date: z.string().optional(), breakdown: z.record(z.number().int().min(0)) });
const Edit = z.object({ documentType: z.enum(['SalesDoc', 'ExpenseDoc', 'TransferDoc']), documentId: z.string().uuid(), reason: z.string().min(3), after: z.record(z.unknown()) });

@Controller('api/closing')
export class ClosingController {
  constructor(private svc: ClosingService, private scope: ScopeService) {}
  @Get('summary') @RequireAnyPermission('sale.create', 'report.sales.own', 'report.sales.all') summary(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string, @Query('date') date?: string) { const loc = this.scope.resolveLocation(u, locationId); return this.svc.summary(loc, date ? toDateOnly(date) : todayManila()); }
  @Get('closes') @RequireAnyPermission('report.sales.own', 'report.sales.all') closes(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string) { return this.svc.closes(u, locationId); }
  @Post('cash-count') @RequirePermission('sale.create') @Audited('DailyClose', 'CASH_COUNT') cashCount(@CurrentUser() u: SessionUser, @Body(Z(CashCount)) dto: z.infer<typeof CashCount>) { return this.svc.cashCount(this.scope.resolveLocation(u, dto.locationId), dto.date, dto.breakdown, u); }
  @Post('run') @RequirePermission('settings.thresholds') @Audited('DailyClose', 'RUN') run(@Body() body: { date?: string }) { return this.svc.closeDay(body?.date ? toDateOnly(body.date) : undefined); }
  @Get('edits') @RequireAnyPermission('sale.create', 'sale.edit.postclose') edits(@CurrentUser() u: SessionUser) { return this.svc.listEdits(u); }
  @Post('edits') @RequireAnyPermission('sale.create', 'sale.edit.sameday', 'expense.create.branch') @Audited('PostCloseEdit', 'REQUEST') edit(@CurrentUser() u: SessionUser, @Body(Z(Edit)) dto: z.infer<typeof Edit>) { return this.svc.requestEdit(dto, u); }
}
