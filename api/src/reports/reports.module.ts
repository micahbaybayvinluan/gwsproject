import { Global, Module } from '@nestjs/common';
import { XlsxService } from './xlsx.service';
import { PdfService } from './pdf.service';
import { ProofsService } from './proofs.service';
import { ReportsService } from './reports.service';
import { ReportSubmissionService } from './report-submission.service';
import { SalesSummaryService } from './sales-summary.service';
import { ReportsController } from './reports.controller';
import { LetterheadController } from './letterhead.controller';
import { PayrollModule } from '../payroll/payroll.module';

@Global()
@Module({ imports: [PayrollModule], providers: [XlsxService, PdfService, ProofsService, ReportsService, ReportSubmissionService, SalesSummaryService], controllers: [ReportsController, LetterheadController], exports: [XlsxService, PdfService, ProofsService, ReportsService, ReportSubmissionService] })
export class ReportsModule {}
