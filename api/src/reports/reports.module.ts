import { Global, Module } from '@nestjs/common';
import { XlsxService } from './xlsx.service';
import { PdfService } from './pdf.service';
import { ReportsService } from './reports.service';
import { ReportSubmissionService } from './report-submission.service';
import { ReportsController } from './reports.controller';
import { LetterheadController } from './letterhead.controller';
import { PayrollModule } from '../payroll/payroll.module';

@Global()
@Module({ imports: [PayrollModule], providers: [XlsxService, PdfService, ReportsService, ReportSubmissionService], controllers: [ReportsController, LetterheadController], exports: [XlsxService, PdfService, ReportsService, ReportSubmissionService] })
export class ReportsModule {}
