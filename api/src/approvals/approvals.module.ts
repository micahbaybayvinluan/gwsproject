import { Global, Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';

@Global()
@Module({ providers: [ApprovalsService], controllers: [ApprovalsController], exports: [ApprovalsService] })
export class ApprovalsModule {}
