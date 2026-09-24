import { Module } from '@nestjs/common';
import { CountsService } from './counts.service';
import { ChargeFormsController, CountsController, DiscrepanciesController } from './counts.controller';

@Module({ providers: [CountsService], controllers: [CountsController, DiscrepanciesController, ChargeFormsController], exports: [CountsService] })
export class CountsModule {}
