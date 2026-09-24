import { Module } from '@nestjs/common';
import { ClosingService } from './closing.service';
import { ClosingController } from './closing.controller';

@Module({ providers: [ClosingService], controllers: [ClosingController], exports: [ClosingService] })
export class ClosingModule {}
