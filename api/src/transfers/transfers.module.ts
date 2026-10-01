import { Module } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { TransferDiscrepancyService } from './transfer-discrepancy.service';
import { TransferDiscrepancyController, TransfersController, WriteoffsController } from './transfers.controller';
import { MarketingPulloutService } from './marketing-pullout.service';
import { MarketingPulloutController } from './marketing-pullout.controller';
import { GlModule } from '../gl/gl.module';

@Module({ imports: [GlModule], providers: [TransfersService, TransferDiscrepancyService, MarketingPulloutService], controllers: [TransfersController, TransferDiscrepancyController, WriteoffsController, MarketingPulloutController], exports: [TransfersService, TransferDiscrepancyService] })
export class TransfersModule {}
