import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Z } from '../common/zod.pipe';
import { StockService } from './stock.service';
import { Audited, CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import type { SessionUser } from '../common/request-context';
import { ScopeService } from '../common/scope.service';
import { PrismaService } from '../common/prisma.service';
import { manilaDateStr, todayManila } from '../common/manila';

const FlavorSplit = z.object({ locationId: z.string().uuid(), batchId: z.string().uuid(), parts: z.array(z.object({ flavor: z.string().trim().min(1).max(60), qty: z.number().int().positive() })).min(1).max(30) });

@Controller('api/stock')
export class StockController {
  constructor(private stock: StockService, private scope: ScopeService, private prisma: PrismaService) {}

  @Get('on-hand') @RequireAnyPermission('report.inventory.all', 'report.inventory.own')
  onHand(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string, @Query('search') search?: string, @Query('zero') zero?: string) {
    if (locationId) this.scope.assertLocation(u, locationId);
    return this.stock.stockOnHand(u, locationId, { search, includeZero: zero === '1' });
  }
  @Get('warehouse-availability') @RequireAnyPermission('transfer.create', 'product.view')
  wh(@Query('productIds') ids?: string) { return this.stock.warehouseAvailability(ids ? ids.split(',') : undefined); }
  @Get('ledger') @RequireAnyPermission('report.inventory.all', 'report.inventory.own')
  ledger(@CurrentUser() u: SessionUser, @Query('productId') productId?: string, @Query('locationId') locationId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    if (locationId) this.scope.assertLocation(u, locationId);
    return this.stock.ledger(u, { productId, locationId, from, to });
  }
  @Get('daily-movement/:locationId') @RequireAnyPermission('report.inventory.all', 'report.inventory.own')
  daily(@CurrentUser() u: SessionUser, @Param('locationId') locationId: string, @Query('year') year: string, @Query('month') month: string) {
    this.scope.assertLocation(u, locationId);
    return this.stock.dailyMovement(locationId, Number(year), Number(month));
  }
  /** Daily Inventory Report: per product per day — Beg, Receive, Transfer In, Returns, Pull Out, Sales, Other, Adj, End (+ cost for cost.view roles). */
  @Get('daily-inventory') @RequireAnyPermission('report.inventory.all', 'report.inventory.own')
  dailyInventory(@CurrentUser() u: SessionUser, @Query('locationId') locationId: string | undefined, @Query('from') from: string | undefined, @Query('to') to: string | undefined) {
    const loc = this.scope.resolveLocation(u, locationId); const day = manilaDateStr();
    return this.stock.dailyInventory(loc, from || day, to || from || day);
  }
  @Get('batches/:productId') @RequireAnyPermission('report.inventory.all', 'report.inventory.own', 'sale.create', 'transfer.create')
  async batches(@CurrentUser() u: SessionUser, @Param('productId') productId: string, @Query('locationId') locationId: string) {
    this.scope.assertLocation(u, locationId);
    const rows = await this.prisma.db.stockBalance.findMany({ where: { locationId, productId, qty: { gt: 0 } }, include: { batch: true }, orderBy: { batch: { expiryDate: 'asc' } } });
    return rows.map((r) => ({ batchId: r.batchId, batchNo: r.batch.batchNo, expiryDate: r.batch.expiryDate, flavor: r.batch.flavor, expired: !!r.batch.expiryDate && r.batch.expiryDate < todayManila(), qty: r.qty, unitCost: r.batch.unitCost, isConsignmentIn: r.batch.isConsignmentIn }));
  }

  /** Set the flavor of stock that has none, per batch (owner request 2026-09-30). The SKU's total does not change. */
  @Post('flavors') @RequirePermission('stock.flavor.set') @Audited('StockBalance', 'SET_FLAVOR')
  setFlavors(@CurrentUser() u: SessionUser, @Body(Z(FlavorSplit)) b: z.infer<typeof FlavorSplit>) {
    this.scope.assertLocation(u, b.locationId);
    return this.stock.setFlavors(b, u.id);
  }
}
