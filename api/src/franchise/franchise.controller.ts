import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequirePermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { FranchiseService } from './franchise.service';

const Settings = z.object({ associateReceives: z.boolean() });
const Charge = z.object({ userIds: z.array(z.string().uuid()).min(1), kind: z.enum(['OTHER', 'CASH_SHORTAGE', 'DAMAGED', 'EXPIRED', 'INVENTORY_DISCREPANCY']).default('OTHER'), reason: z.string().trim().min(3), amount: z.number().positive() });
const Assign = z.object({ userIds: z.array(z.string().uuid()).min(1) });
const Salary = z.object({ userId: z.string().uuid(), periodFrom: z.string(), periodTo: z.string(), basic: z.number().nonnegative(), allowances: z.number().nonnegative().optional(), otherDeductions: z.number().nonnegative().optional(), deductCharges: z.boolean().optional(), notes: z.string().optional() });

@Controller('api/franchise')
export class FranchiseController {
  constructor(private svc: FranchiseService) {}
  @Get('settings') @RequirePermission('franchise.portal') settings(@CurrentUser() u: SessionUser) { return this.svc.settings(u); }
  @Put('settings') @RequirePermission('franchise.portal') @Audited('Location', 'FRANCHISE_SETTINGS') setSettings(@CurrentUser() u: SessionUser, @Body(Z(Settings)) dto: z.infer<typeof Settings>) { return this.svc.setSettings(u, dto); }
  @Get('staff') @RequirePermission('franchise.portal') staff(@CurrentUser() u: SessionUser) { return this.svc.staff(u); }
  @Get('charges') @RequirePermission('franchise.portal') charges(@CurrentUser() u: SessionUser) { return this.svc.charges(u); }
  @Post('charges') @RequirePermission('franchise.portal') @Audited('FranchiseCharge', 'CREATE') charge(@CurrentUser() u: SessionUser, @Body(Z(Charge)) dto: z.infer<typeof Charge>) { return this.svc.createCharge(u, dto); }
  @Post('charges/:id/acknowledge') @RequirePermission('franchise.portal') ack(@CurrentUser() u: SessionUser, @Param('id') id: string) { return this.svc.acknowledgeCharge(u, id); }
  @Get('charge-forms') @RequirePermission('franchise.portal') chargeForms(@CurrentUser() u: SessionUser) { return this.svc.chargeFormsToAssign(u); }
  @Post('charge-forms/:id/assign') @RequirePermission('franchise.portal') @Audited('ChargeForm', 'FRANCHISE_ASSIGN') assign(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body(Z(Assign)) dto: z.infer<typeof Assign>) { return this.svc.assignChargeForm(u, id, dto.userIds); }
  @Get('salaries') @RequirePermission('franchise.portal') salaries(@CurrentUser() u: SessionUser) { return this.svc.salaries(u); }
  @Post('salaries') @RequirePermission('franchise.portal') @Audited('FranchiseSalary', 'CREATE') salary(@CurrentUser() u: SessionUser, @Body(Z(Salary)) dto: z.infer<typeof Salary>) { return this.svc.createSalary(u, dto); }
  @Get('my-pay') @RequirePermission('franchise.portal') mine(@CurrentUser() u: SessionUser) { return this.svc.mine(u); }
  @Get('income-statement') @RequirePermission('franchise.portal') is(@CurrentUser() u: SessionUser, @Query('from') from: string, @Query('to') to: string) { return this.svc.incomeStatement(u, from, to); }
  @Get('balance-sheet') @RequirePermission('franchise.portal') bs(@CurrentUser() u: SessionUser, @Query('asOf') asOf: string) { return this.svc.balanceSheet(u, asOf); }
}
