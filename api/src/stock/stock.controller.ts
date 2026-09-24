import { Controller, Get, Param, Query } from '@nestjs/common';
import { StockService } from './stock.service';
import { CurrentUser, RequireAnyPermission } from '../common/decorators';
import type { SessionUser } from '../common/request-context';
import { ScopeService } from '../common/scope.service';
import { PrismaService } from '../common/prisma.service';

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
  @Get('batches/:productId') @RequireAnyPermission('report.inventory.all', 'report.inventory.own', 'sale.create')
  async batches(@CurrentUser() u: SessionUser, @Param('productId') productId: string, @Query('locationId') locationId: string) {
    this.scope.assertLocation(u, locationId);
    const rows = await this.prisma.db.stockBalance.findMany({ where: { locationId, productId, qty: { gt: 0 } }, include: { batch: true }, orderBy: { batch: { expiryDate: 'asc' } } });
    return rows.map((r) => ({ batchId: r.batchId, batchNo: r.batch.batchNo, expiryDate: r.batch.expiryDate, qty: r.qty, unitCost: r.batch.unitCost, isConsignmentIn: r.batch.isConsignmentIn }));
  }
}
