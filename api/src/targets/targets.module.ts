import { Module } from '@nestjs/common';
import { TargetsService } from './targets.service';
import { TargetsController } from './targets.controller';
import { IncentivesService } from './incentives.service';
import { IncentivesController } from './incentives.controller';

@Module({ providers: [TargetsService, IncentivesService], controllers: [TargetsController, IncentivesController], exports: [TargetsService, IncentivesService] })
export class TargetsModule {}
