import { Global, Module } from '@nestjs/common';
import { XlsxService } from './xlsx.service';
import { PdfService } from './pdf.service';
import { CashFundReportService } from './cashfund-report.service';
import { CashFundReportController } from './cashfund-report.controller';
import { ProofsService } from './proofs.service';
import { ReportsService } from './reports.service';
import { ReportSubmissionService } from './report-submission.service';
import { SalesSummaryService } from './sales-summary.service';
import { ReportsController } from './reports.controller';
import { LetterheadController } from './letterhead.controller';
import { PayrollModule } from '../payroll/payroll.module';

@Global()
@Module({ imports: [PayrollModule], providers: [CashFundReportService, XlsxService, PdfService, ProofsService, ReportsService, ReportSubmissionService, SalesSummaryService], controllers: [CashFundReportController, ReportsController, LetterheadController], exports: [XlsxService, PdfService, ProofsService, ReportsService, ReportSubmissionService] })
export class ReportsModule {}
