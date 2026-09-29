import { Module } from '@nestjs/common';
import { ImportsService } from './imports.service';
import { ImportsController } from './imports.controller';
import { SalesModule } from '../sales/sales.module';

@Module({ imports: [SalesModule], providers: [ImportsService], controllers: [ImportsController], exports: [ImportsService] })
export class ImportsModule {}
