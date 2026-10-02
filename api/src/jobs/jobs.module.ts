import { Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { ClosingService } from '../closing/closing.service';
import { CashOnHandService } from '../closing/cash-on-hand.service';
import { ReportSubmissionService } from '../reports/report-submission.service';
import { CustomerFollowUpsService } from '../sales/customer-followups.service';
import { AlertsService } from '../alerts/alerts.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { CountsService } from '../counts/counts.service';
import { SalesService } from '../sales/sales.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PriceChangeService } from '../pricing/price-change.service';
import { PayrollService } from '../payroll/payroll.service';
import { ClosingModule } from '../closing/closing.module';
import { CountsModule } from '../counts/counts.module';
import { SalesModule } from '../sales/sales.module';
import { PricingModule } from '../pricing/pricing.module';
import { PayrollModule } from '../payroll/payroll.module';
import { EcommerceModule } from '../ecommerce/ecommerce.module';
import { EcommerceService } from '../ecommerce/ecommerce.service';
import { TransferDiscrepancyService } from '../transfers/transfer-discrepancy.service';
import { TransfersModule } from '../transfers/transfers.module';
import { FranchiseArService } from '../franchise/franchise-ar.service';
import { FranchiseShippingService } from '../franchise/franchise-shipping.service';
import { ReplacementsService } from '../replacements/replacements.service';
import { MonitorService } from '../agents/monitor.service';
import { requestContext } from '../common/request-context';

export const JOBS = {
  MIDNIGHT_CLOSE: { name: 'midnight-close', cron: '0 16 * * *' }, // 00:00 Asia/Manila = 16:00 UTC
  NIGHTLY_ALERTS: { name: 'nightly-alerts', cron: '30 16 * * *' }, // 00:30 Manila
  AUTO_APPROVE: { name: 'auto-approve', cron: '*/15 * * * *' },
  COST_REMINDERS: { name: 'cost-reminders', cron: '0 * * * *' },
  DISCREPANCY_DEADLINE: { name: 'discrepancy-deadline', cron: '5 16 * * *' },
  AR_OVERDUE: { name: 'ar-overdue', cron: '0 1 * * *' }, // 09:00 Manila
  EMAIL_DIGEST: { name: 'email-digest', cron: '0 10 * * *' }, // 18:00 Manila
  PRICE_NOTIFY: { name: 'price-notify', cron: '0 0 * * *' }, // 08:00 Manila
  SALES_REPORT_REMINDER: { name: 'sales-report-reminder', cron: '30 11 * * *' }, // 7:30 PM Manila, before the 8 PM closing
  SALES_REPORT_CUTOFF: { name: 'sales-report-cutoff', cron: '0 13 * * *' }, // 9:00 PM Manila: not submitted → submitted as it stands
  CUSTOMER_FOLLOW_UPS: { name: 'customer-follow-ups', cron: '0 1 * * *' }, // 9:00 AM Manila: customers who may have finished their supplements
  CASH_DEPOSIT_REMINDERS: { name: 'cash-deposit-reminders', cron: '0 2 * * *' }, // 10:00 Manila: cash on hand due / overdue
  TRANSFER_DIFF_DEADLINES: { name: 'transfer-diff-deadlines', cron: '20 * * * *' }, // hourly: sending branch reminder after 1 day, Owner after 2 days
  FRANCHISE_AR: { name: 'franchise-ar', cron: '15 1 * * *' }, // 9:15 AM Manila: penalty notices, due / overdue reminders and the two-month flag on franchise invoices
  AGENT_FIELD: { name: 'agent-field', cron: '30 1 * * *' }, // 9:30 AM Manila: missing / unreported itineraries, old consignments, maximums nearly used
  ECOM_OVERDUE: { name: 'ecom-overdue', cron: '0 1 * * 5' }, // Friday 9:00 AM Manila: e-commerce orders shipped long ago, not paid nor returned
  MONTH_END_DEPRECIATION: { name: 'month-end-depreciation', cron: '0 17 1 * *' }, // 1st 01:00 Manila for previous month
} as const;

/** BullMQ schedulers (§3 Jobs). Each handler runs in a system request context (unscoped). */
@Injectable()
export class JobsService implements OnModuleInit {
  private log = new Logger('Jobs');
  private queue!: Queue; private worker!: Worker;
  constructor(private franchiseAr: FranchiseArService, private franchiseShipping: FranchiseShippingService, private replacements: ReplacementsService, private agentMonitor: MonitorService, private transferDiff: TransferDiscrepancyService, private ecom: EcommerceService, private followUps: CustomerFollowUpsService, private reportSubmission: ReportSubmissionService, private cashOnHand: CashOnHandService, private closing: ClosingService, private alerts: AlertsService, private approvals: ApprovalsService, private counts: CountsService, private sales: SalesService, private notifications: NotificationsService, private prices: PriceChangeService, private payroll: PayrollService) {}

  async onModuleInit() {
    if (process.env.DISABLE_JOBS === 'true' || process.env.NODE_ENV === 'test') return;
    const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
    this.queue = new Queue('gws-jobs', { connection });
    for (const j of Object.values(JOBS)) await this.queue.upsertJobScheduler(j.name, { pattern: j.cron, tz: 'UTC' }, { name: j.name });
    this.worker = new Worker('gws-jobs', async (job) => requestContext.runSystem(() => this.run(job.name)), { connection: new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null }) });
    this.worker.on('failed', (job, err) => this.log.error(`${job?.name} failed: ${err.message}`));
    this.log.log(`Scheduled ${Object.keys(JOBS).length} jobs`);
  }
  async run(name: string): Promise<unknown> {
    switch (name) {
      case JOBS.MIDNIGHT_CLOSE.name: return this.closing.closeDay();
      case JOBS.NIGHTLY_ALERTS.name: return { minStock: await this.alerts.runMinStock(), expiry: await this.alerts.runExpiry() };
      case JOBS.AUTO_APPROVE.name: return this.approvals.runAutoApprovals();
      case JOBS.COST_REMINDERS.name: return this.approvals.remindStaleCostApprovals();
      case JOBS.DISCREPANCY_DEADLINE.name: return this.counts.finalizeDue();
      case JOBS.AR_OVERDUE.name: return this.sales.notifyOverdue();
      case JOBS.EMAIL_DIGEST.name: return this.notifications.sendDigests();
      case JOBS.PRICE_NOTIFY.name: return this.prices.notifyPending();
      case JOBS.SALES_REPORT_REMINDER.name: return this.reportSubmission.remind();
      case JOBS.SALES_REPORT_CUTOFF.name: return this.reportSubmission.autoSubmit();
      case JOBS.CUSTOMER_FOLLOW_UPS.name: return this.followUps.runDaily();
      case JOBS.CASH_DEPOSIT_REMINDERS.name: return this.cashOnHand.remind();
      case JOBS.TRANSFER_DIFF_DEADLINES.name: return this.transferDiff.runDeadlines();
      case JOBS.FRANCHISE_AR.name: return { ...(await this.franchiseAr.runDaily()), shipping: await this.franchiseShipping.runDaily(), replacements: await this.replacements.runDaily() };
      case JOBS.AGENT_FIELD.name: return this.agentMonitor.runDaily();
      case JOBS.ECOM_OVERDUE.name: return this.ecom.remindOverdue();
      case JOBS.MONTH_END_DEPRECIATION.name: { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 1); return this.payroll.runDepreciation(d.getUTCFullYear(), d.getUTCMonth() + 1, null); }
      default: throw new Error(`Unknown job ${name}`);
    }
  }
}

@Module({ imports: [ClosingModule, CountsModule, SalesModule, PricingModule, PayrollModule, EcommerceModule, TransfersModule], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
