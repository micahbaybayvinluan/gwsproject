import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { FranchiseOrdersController } from './franchise-orders.controller';
import { FranchiseOrdersService } from './franchise-orders.service';

@Module({ imports: [SalesModule], providers: [FranchiseOrdersService], controllers: [FranchiseOrdersController], exports: [FranchiseOrdersService] })
export class FranchiseOrdersModule {}
