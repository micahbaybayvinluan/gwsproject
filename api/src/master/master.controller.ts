import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { MasterService } from './master.service';
import { CurrentUser, RequireAnyPermission, RequirePermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const LocationDto = z.object({ code: z.string().min(1), name: z.string().min(1), type: z.enum(['WAREHOUSE', 'BRANCH', 'FRANCHISE', 'OFFICE', 'CONSIGNEE', 'VIRTUAL']), isSelling: z.boolean().optional(), franchiseOwnerUserId: z.string().uuid().nullable().optional(), address: z.string().optional(), active: z.boolean().optional() });
const SupplierDto = z.object({ name: z.string().min(1), contact: z.string().optional(), termsDays: z.number().int().min(0).optional(), isConsignor: z.boolean().optional(), active: z.boolean().optional() });
const CategoryDto = z.object({ name: z.string().min(1), accountingClass: z.enum(['SUPPLEMENT', 'FREEBIE', 'PLASTIC', 'APPAREL', 'EQUIPMENT', 'OTHER', 'REPACKED', 'BUNDLE']) });
const ProductDto = z.object({ sku: z.string().optional(), barcode: z.string().optional(), name: z.string().min(1), categoryId: z.string().uuid(), brand: z.string().optional(), unit: z.string().optional(), supplierId: z.string().uuid().optional(), trackExpiry: z.boolean().optional(), isBundle: z.boolean().optional(), franchiseVisible: z.boolean().optional(), components: z.array(z.object({ componentProductId: z.string().uuid(), qty: z.number().int().positive() })).optional(), prices: z.record(z.number().nonnegative()).optional(), cost: z.number().nonnegative().optional() });
const ProductPatch = z.object({ barcode: z.string().nullable().optional(), name: z.string().optional(), categoryId: z.string().uuid().optional(), brand: z.string().optional(), unit: z.string().optional(), supplierId: z.string().uuid().nullable().optional(), trackExpiry: z.boolean().optional(), active: z.boolean().optional(), franchiseVisible: z.boolean().optional(), needsReview: z.boolean().optional() });
const MinStockDto = z.object({ rows: z.array(z.object({ productId: z.string().uuid(), locationId: z.string().uuid(), minQty: z.number().int().min(0) })) });
const CustomerDto = z.object({ name: z.string(), type: z.enum(['DEALER', 'FRANCHISE', 'AGENT', 'CONSIGNEE', 'CUSTOMER']), locationId: z.string().uuid().optional(), agentId: z.string().uuid().optional(), contact: z.string().optional() });
const AgentDto = z.object({ name: z.string(), locationId: z.string().uuid(), onPayroll: z.boolean().optional(), defaultTier: z.string().optional() });
const RiderDto = z.object({ name: z.string(), locationId: z.string().uuid() });
const TierDto = z.object({ key: z.string(), name: z.string() });

@Controller('api')
export class MasterController {
  constructor(private m: MasterService) {}

  @Get('locations') @RequireAnyPermission('location.view.all', 'location.view.own') locations(@CurrentUser() u: SessionUser, @Query('all') all?: string) { return this.m.listLocations(u, all === '1'); }
  @Post('locations') @RequirePermission('location.edit') @Audited('Location', 'CREATE') createLocation(@Body(Z(LocationDto)) dto: z.infer<typeof LocationDto>, @CurrentUser() u: SessionUser) { return this.m.createLocation(dto, u.id); }
  @Patch('locations/:id') @RequirePermission('location.edit') @Audited('Location') updateLocation(@Param('id') id: string, @Body(Z(LocationDto.partial())) dto: Partial<z.infer<typeof LocationDto>>, @CurrentUser() u: SessionUser) { return this.m.updateLocation(id, dto, u.id); }

  @Get('suppliers') @RequirePermission('supplier.view.code') suppliers() { return this.m.listSuppliers(); }
  @Post('suppliers') @RequirePermission('supplier.edit') @Audited('Supplier', 'CREATE') createSupplier(@Body(Z(SupplierDto)) dto: z.infer<typeof SupplierDto>, @CurrentUser() u: SessionUser) { return this.m.createSupplier(dto, u.id); }
  @Patch('suppliers/:id') @RequirePermission('supplier.edit') @Audited('Supplier') updateSupplier(@Param('id') id: string, @Body(Z(SupplierDto.partial())) dto: Partial<z.infer<typeof SupplierDto>>, @CurrentUser() u: SessionUser) { return this.m.updateSupplier(id, dto, u.id); }

  @Get('categories') @RequirePermission('product.view') categories() { return this.m.listCategories(); }
  @Post('categories') @RequirePermission('product.edit') @Audited('Category', 'CREATE') createCategory(@Body(Z(CategoryDto)) dto: z.infer<typeof CategoryDto>) { return this.m.createCategory(dto); }

  @Get('products') @RequirePermission('product.view') products(@CurrentUser() u: SessionUser, @Query('search') search?: string, @Query('categoryId') categoryId?: string, @Query('all') all?: string, @Query('take') take?: string) { return this.m.listProducts(u, { search, categoryId, includeInactive: all === '1', take: take ? Number(take) : undefined }); }
  @Get('products/tiers') @RequirePermission('product.view') tiers() { return this.m.listTiers(); }
  @Post('products/tiers') @RequirePermission('price.edit', 'settings.thresholds') @Audited('PriceTier', 'CREATE') addTier(@Body(Z(TierDto)) dto: z.infer<typeof TierDto>) { return this.m.addTier(dto.key, dto.name); }
  @Get('products/:id') @RequirePermission('product.view') product(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.m.getProduct(id, u); }
  @Post('products') @RequirePermission('product.create') @Audited('Product', 'CREATE') createProduct(@Body(Z(ProductDto)) dto: z.infer<typeof ProductDto>, @CurrentUser() u: SessionUser) { return this.m.createProduct(dto, u.id); }
  @Patch('products/:id') @RequirePermission('product.edit') @Audited('Product') updateProduct(@Param('id') id: string, @Body(Z(ProductPatch)) dto: z.infer<typeof ProductPatch>, @CurrentUser() u: SessionUser) { return this.m.updateProduct(id, dto, u.id); }

  @Get('min-stock') @RequireAnyPermission('settings.thresholds', 'report.inventory.all', 'report.inventory.own') minStock(@Query('locationId') locationId?: string) { return this.m.listMinStock(locationId); }
  @Put('min-stock') @RequirePermission('settings.thresholds') @Audited('MinStockLevel') setMinStock(@Body(Z(MinStockDto)) dto: z.infer<typeof MinStockDto>, @CurrentUser() u: SessionUser) { return this.m.setMinStock(dto.rows, u.id); }

  @Get('customers') @RequireAnyPermission('sale.create', 'ar.view') customers(@Query('type') type?: string) { return this.m.listCustomers(type); }
  @Post('customers') @RequireAnyPermission('sale.create', 'ar.view') @Audited('Customer', 'CREATE') createCustomer(@Body(Z(CustomerDto)) dto: z.infer<typeof CustomerDto>, @CurrentUser() u: SessionUser) { return this.m.createCustomer(dto, u.id); }
  @Get('agents') @RequireAnyPermission('sale.create', 'report.sales.all') agents(@CurrentUser() u: SessionUser) { return this.m.listAgents(u); }
  @Post('agents') @RequireAnyPermission('product.edit', 'user.manage') @Audited('Agent', 'CREATE') createAgent(@Body(Z(AgentDto)) dto: z.infer<typeof AgentDto>) { return this.m.createAgent(dto); }
  @Get('riders') @RequireAnyPermission('sale.create', 'report.sales.all') riders(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string) { return this.m.listRiders(u, locationId); }
  @Post('riders') @RequireAnyPermission('sale.create', 'user.manage') @Audited('Rider', 'CREATE') createRider(@Body(Z(RiderDto)) dto: z.infer<typeof RiderDto>) { return this.m.createRider(dto); }
}
