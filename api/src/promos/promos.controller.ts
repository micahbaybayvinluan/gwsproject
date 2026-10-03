import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { PromosService } from './promos.service';

const Date10 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Promo = z.object({ title: z.string().trim().min(3).max(120), details: z.string().trim().min(3).max(3000), audience: z.enum(['BRANCHES', 'FRANCHISES']), startsOn: Date10, endsOn: Date10, items: z.array(z.object({ productId: z.string().uuid(), promoPrice: z.number().positive().max(1000000) })).max(60).optional() });

/** Promos: everybody sees the ones meant for them; the Owner and the Head Auditor issue and cancel them. */
@Controller('api/promos')
export class PromosController {
  constructor(private svc: PromosService) {}
  @Get('active') active(@CurrentUser() u: SessionUser) { return this.svc.activeFor(u); }
  @Get() list(@CurrentUser() u: SessionUser) { return this.svc.list(u); }
  @Post() @RequirePermission('promo.issue') create(@Body(Z(Promo)) dto: z.infer<typeof Promo>, @CurrentUser() u: SessionUser) { return this.svc.create(u, dto); }
  @Post(':id/cancel') @RequirePermission('promo.issue') cancel(@Param('id') id: string, @Body(Z(z.object({ reason: z.string().trim().min(3).max(300) }))) dto: { reason: string }, @CurrentUser() u: SessionUser) { return this.svc.cancel(u, id, dto.reason); }
}
