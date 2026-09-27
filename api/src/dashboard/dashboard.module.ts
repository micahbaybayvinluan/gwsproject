import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { CountsModule } from '../counts/counts.module';
import { ClosingModule } from '../closing/closing.module';

@Module({ imports: [CountsModule, ClosingModule], controllers: [DashboardController] })
export class DashboardModule {}
