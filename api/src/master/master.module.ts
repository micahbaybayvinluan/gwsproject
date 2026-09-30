import { Global, Module } from '@nestjs/common';
import { MasterService } from './master.service';
import { MasterController } from './master.controller';
import { ProductCostService } from './product-cost.service';

@Global()
@Module({ providers: [MasterService, ProductCostService], controllers: [MasterController], exports: [MasterService, ProductCostService] })
export class MasterModule {}
