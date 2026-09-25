import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { CountsModule } from '../counts/counts.module';

@Module({ imports: [CountsModule], controllers: [DashboardController] })
export class DashboardModule {}
