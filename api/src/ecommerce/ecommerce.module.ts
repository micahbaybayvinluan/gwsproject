import { Module } from '@nestjs/common';
import { EcommerceService } from './ecommerce.service';
import { EcommerceController } from './ecommerce.controller';
import { EcomAnalysisService } from './ecom-analysis.service';
import { EcomAnalysisController } from './ecom-analysis.controller';
import { EcomWaybillsService } from './ecom-waybills.service';
import { EcomWaybillsController } from './ecom-waybills.controller';
import { GlModule } from '../gl/gl.module';
import { TransfersModule } from '../transfers/transfers.module';
import { ReportsModule } from '../reports/reports.module';

@Module({ imports: [GlModule, TransfersModule, ReportsModule], providers: [EcommerceService, EcomAnalysisService, EcomWaybillsService], controllers: [EcommerceController, EcomAnalysisController, EcomWaybillsController], exports: [EcommerceService] })
export class EcommerceModule {}
