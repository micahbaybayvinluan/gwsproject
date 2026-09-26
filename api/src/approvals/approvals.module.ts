import { Global, Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { MasterDataApprovals } from './master-data.service';

@Global()
@Module({ providers: [ApprovalsService, MasterDataApprovals], controllers: [ApprovalsController], exports: [ApprovalsService, MasterDataApprovals] })
export class ApprovalsModule {}
