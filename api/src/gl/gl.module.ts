import { Global, Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { PostingService } from './posting.service';
import { LedgerService } from './ledger.service';
import { FinReportsService } from './fin-reports.service';
import { AccountsController, FinancialStatementsController, LedgerController } from './gl.controller';
import { BankEntriesService } from './bank-entries.service';
import { BankEntriesController } from './bank-entries.controller';

@Global()
@Module({ providers: [AccountsService, PostingService, LedgerService, FinReportsService, BankEntriesService], controllers: [AccountsController, LedgerController, FinancialStatementsController, BankEntriesController], exports: [AccountsService, PostingService, LedgerService, FinReportsService] })
export class GlModule {}
