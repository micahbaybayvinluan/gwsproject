import { Module } from '@nestjs/common';
import { PriceChangeService } from './price-change.service';
import { PriceChangeController } from './price-change.controller';
import { GlModule } from '../gl/gl.module';

@Module({ imports: [GlModule], providers: [PriceChangeService], controllers: [PriceChangeController], exports: [PriceChangeService] })
export class PricingModule {}
