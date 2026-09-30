import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequirePermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { EcomAnalysisService } from './ecom-analysis.service';

const Target = z.object({ pct: z.number().min(0).max(89.99) });
const n = (v?: string) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** The Owner's e-commerce margin analysis (owner request 2026-09-30). */
@Controller('api/ecommerce-analysis')
export class EcomAnalysisController {
  constructor(private svc: EcomAnalysisService) {}
  @Get() @RequirePermission('ecom.analysis') analyse(@Query('from') from: string, @Query('to') to: string, @Query('target') target?: string, @Query('commissionPct') c?: string, @Query('transactionPct') t?: string, @Query('affiliatePct') a?: string, @Query('shippingPerOrder') s?: string, @Query('adPctOfSales') ad?: string) {
    return this.svc.analyse({ from, to, target: n(target), commissionPct: n(c), transactionPct: n(t), affiliatePct: n(a), shippingPerOrder: n(s), adPctOfSales: n(ad) });
  }
  @Get('target') @RequirePermission('ecom.analysis') async target() { return { pct: await this.svc.targetMargin() }; }
  @Put('target') @RequirePermission('ecom.analysis') @Audited('Setting', 'ECOM_TARGET_MARGIN') setTarget(@CurrentUser() u: SessionUser, @Body(Z(Target)) dto: z.infer<typeof Target>) { return this.svc.setTargetMargin(dto.pct, u.id); }
}
