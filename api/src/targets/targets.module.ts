import { Module } from '@nestjs/common';
import { TargetsService } from './targets.service';
import { TargetsController } from './targets.controller';

@Module({ providers: [TargetsService], controllers: [TargetsController], exports: [TargetsService] })
export class TargetsModule {}
