import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MasterModule } from './master/master.module';
import { StockModule } from './stock/stock.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { HealthController } from './health.controller';

@Module({
  imports: [CommonModule, AuthModule, UsersModule, MasterModule, StockModule, NotificationsModule, ApprovalsModule],
  controllers: [HealthController],
})
export class AppModule {}
