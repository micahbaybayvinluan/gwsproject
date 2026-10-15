import { Module } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { TransferDiscrepancyService } from './transfer-discrepancy.service';
import { StockRequestsController, TransferDiscrepancyController, TransfersController, WriteoffsController } from './transfers.controller';
import { StockRequestsService } from './stock-requests.service';
import { MarketingPulloutService } from './marketing-pullout.service';
import { MarketingPulloutController } from './marketing-pullout.controller';
import { GlModule } from '../gl/gl.module';

@Module({ imports: [GlModule], providers: [TransfersService, TransferDiscrepancyService, MarketingPulloutService, StockRequestsService], controllers: [StockRequestsController, TransfersController, TransferDiscrepancyController, WriteoffsController, MarketingPulloutController], exports: [TransfersService, TransferDiscrepancyService, StockRequestsService] })
export class TransfersModule {}
