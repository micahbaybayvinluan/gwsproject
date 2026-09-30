import { Module } from '@nestjs/common';
import { ClosingService } from './closing.service';
import { ClosingController } from './closing.controller';
import { CashOnHandService } from './cash-on-hand.service';
import { CashOnHandController, HrNoticesController } from './cash-on-hand.controller';

@Module({ providers: [ClosingService, CashOnHandService], controllers: [ClosingController, CashOnHandController, HrNoticesController], exports: [ClosingService, CashOnHandService] })
export class ClosingModule {}
