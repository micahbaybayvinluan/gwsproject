import { Controller, Get, Post, Query } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import type { SessionUser } from '../common/request-context';
import { ScopeService } from '../common/scope.service';

@Controller('api/alerts')
export class AlertsController {
  constructor(private alerts: AlertsService, private scope: ScopeService) {}
  @Get('critical-stock') @RequireAnyPermission('report.inventory.all', 'report.inventory.own') critical(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string) { if (locationId) this.scope.assertLocation(u, locationId); return this.alerts.criticalStock(u, locationId); }
  @Get('expiring') @RequireAnyPermission('report.inventory.all', 'report.inventory.own') expiring(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string) { if (locationId) this.scope.assertLocation(u, locationId); return this.alerts.expiring(u, locationId); }
  @Get('slow-moving') @RequireAnyPermission('report.inventory.all', 'report.inventory.own') slow(@CurrentUser() u: SessionUser, @Query('days') days?: string, @Query('locationId') locationId?: string) { return this.alerts.slowMoving(u, days ? Number(days) : 60, locationId); }
  @Get('days-of-stock') @RequireAnyPermission('report.inventory.all', 'report.inventory.own') daysOfStock(@CurrentUser() u: SessionUser, @Query('days') days?: string, @Query('cover') cover?: string, @Query('locationId') locationId?: string, @Query('combine') combine?: string) { if (locationId) this.scope.assertLocation(u, locationId); return this.alerts.daysOfStock(u, { days: days ? Number(days) : undefined, cover: cover ? Number(cover) : undefined, locationId, combine: combine === '1' }); }
  @Get('stock-ageing') @RequireAnyPermission('report.inventory.all', 'report.inventory.own') ageing(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string) { return this.alerts.stockAgeing(u, locationId); }
  @Post('run') @RequirePermission('settings.thresholds') async run() { return { minStock: await this.alerts.runMinStock(), expiry: await this.alerts.runExpiry() }; }
}
