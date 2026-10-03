import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequireAnyPermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { CustomerServiceService } from './customer-service.service';

const STAFF = ['sale.create', 'sale.create.warehouse', 'member.view', 'member.manage', 'report.sales.all'] as const;
const Contact = z.object({ kind: z.enum(['RESTOCK', 'BIRTHDAY', 'WINBACK', 'OTHER']), followUpId: z.string().uuid().nullable().optional(), memberId: z.string().uuid().nullable().optional(), customerName: z.string().trim().max(120).nullable().optional(), phone: z.string().trim().max(40).nullable().optional(), productId: z.string().uuid().nullable().optional(), locationId: z.string().uuid().nullable().optional(), method: z.string().max(20), outcome: z.string().max(20), reason: z.string().max(30).nullable().optional(), note: z.string().trim().max(500).nullable().optional(), recontactOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() });

/** Customer Service: the branch to-do list, the results staff record, and the reasons customers give. */
@Controller('api/customer-service')
export class CustomerServiceController {
  constructor(private svc: CustomerServiceService) {}
  @Get('options') @RequireAnyPermission(...STAFF) options() { return this.svc.options(); }
  @Get('board') @RequireAnyPermission(...STAFF) board(@CurrentUser() u: SessionUser) { return this.svc.board(u); }
  @Post('contacts') @RequireAnyPermission(...STAFF) record(@Body(Z(Contact)) dto: z.infer<typeof Contact>, @CurrentUser() u: SessionUser) { return this.svc.record(u, dto as never).then((r) => ({ id: r.id })); }
  @Get('contacts') @RequireAnyPermission(...STAFF) contacts(@CurrentUser() u: SessionUser, @Query('days') days?: string, @Query('locationId') locationId?: string) { return this.svc.contacts(u, { days: days ? Number(days) : undefined, locationId }); }
  @Get('reasons') @RequireAnyPermission('member.view', 'member.manage', 'report.sales.all') reasons(@CurrentUser() u: SessionUser, @Query('days') days?: string) { return this.svc.reasons(u, days ? Number(days) : 90); }
}
