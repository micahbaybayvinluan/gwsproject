import { Module } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { TransferDiscrepancyService } from './transfer-discrepancy.service';
import { TransferDiscrepancyController, TransfersController, WriteoffsController } from './transfers.controller';
import { GlModule } from '../gl/gl.module';

@Module({ imports: [GlModule], providers: [TransfersService, TransferDiscrepancyService], controllers: [TransfersController, TransferDiscrepancyController, WriteoffsController], exports: [TransfersService, TransferDiscrepancyService] })
export class TransfersModule {}
