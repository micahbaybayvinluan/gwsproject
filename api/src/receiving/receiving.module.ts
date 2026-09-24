import { Module } from '@nestjs/common';
import { ReceivingService } from './receiving.service';
import { ReceivingController } from './receiving.controller';
import { GlModule } from '../gl/gl.module';

@Module({ imports: [GlModule], providers: [ReceivingService], controllers: [ReceivingController], exports: [ReceivingService] })
export class ReceivingModule {}
