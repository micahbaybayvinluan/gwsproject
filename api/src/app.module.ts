import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MasterModule } from './master/master.module';
import { StockModule } from './stock/stock.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { GlModule } from './gl/gl.module';
import { ReceivingModule } from './receiving/receiving.module';
import { TransfersModule } from './transfers/transfers.module';
import { PricingModule } from './pricing/pricing.module';
import { ClosingModule } from './closing/closing.module';
import { SalesModule } from './sales/sales.module';
import { ExpensesModule } from './expenses/expenses.module';
import { AlertsModule } from './alerts/alerts.module';
import { CountsModule } from './counts/counts.module';
import { ReportsModule } from './reports/reports.module';
import { ImportsModule } from './imports/imports.module';
import { PayrollModule } from './payroll/payroll.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { JobsModule } from './jobs/jobs.module';
import { HealthController } from './health.controller';
import { EditsModule } from './edits/edits.module';

@Module({
  imports: [
    CommonModule, AuthModule, UsersModule, MasterModule, StockModule, NotificationsModule, ApprovalsModule, AttachmentsModule, GlModule,
    ReceivingModule, TransfersModule, PricingModule, ClosingModule, SalesModule, ExpensesModule, AlertsModule, CountsModule, ReportsModule, ImportsModule, PayrollModule, DashboardModule, JobsModule, EditsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
