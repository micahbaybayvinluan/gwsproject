import { Module } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { TransfersController, WriteoffsController } from './transfers.controller';
import { GlModule } from '../gl/gl.module';

@Module({ imports: [GlModule], providers: [TransfersService], controllers: [TransfersController, WriteoffsController], exports: [TransfersService] })
export class TransfersModule {}
