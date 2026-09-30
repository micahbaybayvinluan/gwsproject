import { Module } from '@nestjs/common';
import { EditsService } from './edits.service';
import { EditsController } from './edits.controller';
import { ReceivingModule } from '../receiving/receiving.module';
import { TransfersModule } from '../transfers/transfers.module';

@Module({ imports: [ReceivingModule, TransfersModule], providers: [EditsService], controllers: [EditsController] })
export class EditsModule {}
