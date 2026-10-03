import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Audited, CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { ReplacementsService } from './replacements.service';

const Reason = z.enum(['DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'EXPIRED', 'OTHER']);
const Customer = z.object({ salesLineId: z.string().uuid(), qty: z.number().int().positive(), reason: Reason, notes: z.string().trim().max(500).optional(), locationId: z.string().uuid().optional() });
const Supplier = z.object({ productId: z.string().uuid(), qty: z.number().int().positive(), batchId: z.string().uuid().optional(), supplierId: z.string().uuid().optional(), reason: Reason, notes: z.string().trim().max(500).optional(), locationId: z.string().uuid().optional() });
const Replace = z.object({ productId: z.string().uuid().optional(), qty: z.number().int().positive().optional(), unitPrice: z.number().nonnegative().optional(), note: z.string().trim().max(500).optional(), locationId: z.string().uuid().optional(), givenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const Settle = z.object({ note: z.string().trim().max(500).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), mode: z.enum(['CASH', 'ONLINE', 'CREDIT_CARD']).optional(), paymentAccountId: z.string().uuid().nullable().optional() });
const Cancel = z.object({ reason: z.string().trim().min(3) });

@Controller('api/replacements')
export class ReplacementsController {
  constructor(private svc: ReplacementsService) {}
  @Get() @RequireAnyPermission('replacement.create', 'replacement.view') list(@CurrentUser() u: SessionUser, @Query('kind') kind?: string, @Query('status') status?: string, @Query('supplierId') supplierId?: string, @Query('open') open?: string) { return this.svc.list(u, { kind, status, supplierId, open: open === '1' }); }
  @Get('find-dr') @RequirePermission('replacement.create') findDr(@Query('q') q: string) { return this.svc.findDr(q ?? ''); }
  @Get('summary') @RequirePermission('replacement.view') summary(@CurrentUser() u: SessionUser) { return this.svc.summary(u); }
  @Get(':id') @RequireAnyPermission('replacement.create', 'replacement.view') get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.get(u, id); }
  @Post('customer') @RequirePermission('replacement.create') @Audited('ReplacementTicket', 'OPEN_CUSTOMER') customer(@Body(Z(Customer)) dto: z.infer<typeof Customer>, @CurrentUser() u: SessionUser) { return this.svc.createCustomer(u, dto); }
  @Post('supplier') @RequirePermission('replacement.create') @Audited('ReplacementTicket', 'OPEN_SUPPLIER') supplier(@Body(Z(Supplier)) dto: z.infer<typeof Supplier>, @CurrentUser() u: SessionUser) { return this.svc.createSupplier(u, dto); }
  @Post(':id/replace') @RequirePermission('replacement.create') replace(@Param('id') id: string, @Body(Z(Replace)) dto: z.infer<typeof Replace>, @CurrentUser() u: SessionUser) { return this.svc.replace(u, id, dto); }
  @Post(':id/settle') @RequireAnyPermission('replacement.create', 'replacement.view') settle(@Param('id') id: string, @Body(Z(Settle)) dto: z.infer<typeof Settle>, @CurrentUser() u: SessionUser) { return this.svc.settle(u, id, dto); }
  @Post(':id/cancel') @RequireAnyPermission('replacement.create', 'replacement.view') cancel(@Param('id') id: string, @Body(Z(Cancel)) dto: z.infer<typeof Cancel>, @CurrentUser() u: SessionUser) { return this.svc.cancel(u, id, dto.reason); }
}
