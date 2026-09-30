import { Module } from '@nestjs/common';
import { PriceChangeService } from './price-change.service';
import { PriceChangeController } from './price-change.controller';
import { EcomPricesService } from './ecom-prices.service';
import { EcomPricesController } from './ecom-prices.controller';
import { GlModule } from '../gl/gl.module';

@Module({ imports: [GlModule], providers: [PriceChangeService, EcomPricesService], controllers: [PriceChangeController, EcomPricesController], exports: [PriceChangeService, EcomPricesService] })
export class PricingModule {}
