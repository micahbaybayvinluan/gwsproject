import { Module } from '@nestjs/common';
import { CountsService } from './counts.service';
import { ChargeFormsController, CountsController, DiscrepanciesController, HrComplianceController } from './counts.controller';

@Module({ providers: [CountsService], controllers: [CountsController, DiscrepanciesController, ChargeFormsController, HrComplianceController], exports: [CountsService] })
export class CountsModule {}
