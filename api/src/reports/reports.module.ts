import { Global, Module } from '@nestjs/common';
import { XlsxService } from './xlsx.service';
import { PdfService } from './pdf.service';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Global()
@Module({ providers: [XlsxService, PdfService, ReportsService], controllers: [ReportsController], exports: [XlsxService, PdfService, ReportsService] })
export class ReportsModule {}
