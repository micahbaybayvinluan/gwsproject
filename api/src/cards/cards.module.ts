import { Module } from '@nestjs/common';
import { GlModule } from '../gl/gl.module';
import { CardRemittanceService } from './card-remittance.service';
import { CardRemittanceController } from './card-remittance.controller';

@Module({ imports: [GlModule], providers: [CardRemittanceService], controllers: [CardRemittanceController], exports: [CardRemittanceService] })
export class CardsModule {}
