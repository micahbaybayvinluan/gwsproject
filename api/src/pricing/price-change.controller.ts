import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { PriceChangeService } from './price-change.service';
import { CurrentUser, RequirePermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const Create = z.object({ effectiveFrom: z.string().optional(), notes: z.string().optional(), lines: z.array(z.object({ productId: z.string().uuid(), tier: z.string().nullable().optional(), newPrice: z.number().nonnegative().nullable().optional(), costNew: z.number().nonnegative().nullable().optional() })).min(1) });

@Controller('api/price-changes')
export class PriceChangeController {
  constructor(private svc: PriceChangeService) {}
  @Get() @RequirePermission('price.edit') list() { return this.svc.list(); }
  @Get(':id') @RequirePermission('price.edit') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post() @RequirePermission('price.edit') @Audited('PriceChangeDoc', 'CREATE') create(@Body(Z(Create)) dto: z.infer<typeof Create>, @CurrentUser() u: SessionUser) { return this.svc.create(dto, u); }
}
