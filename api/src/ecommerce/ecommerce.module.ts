import { Module } from '@nestjs/common';
import { EcommerceService } from './ecommerce.service';
import { EcommerceController } from './ecommerce.controller';
import { GlModule } from '../gl/gl.module';
import { TransfersModule } from '../transfers/transfers.module';
import { ReportsModule } from '../reports/reports.module';

@Module({ imports: [GlModule, TransfersModule, ReportsModule], providers: [EcommerceService], controllers: [EcommerceController], exports: [EcommerceService] })
export class EcommerceModule {}
