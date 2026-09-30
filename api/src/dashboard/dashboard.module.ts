import { TargetsModule } from '../targets/targets.module';
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { CountsModule } from '../counts/counts.module';
import { ClosingModule } from '../closing/closing.module';

@Module({ imports: [CountsModule, ClosingModule, TargetsModule], controllers: [DashboardController] })
export class DashboardModule {}
