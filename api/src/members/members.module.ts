import { Global, Module } from '@nestjs/common';
import { CampaignsController, MemberProgramController, MembersController, PortalController } from './members.controller';
import { CampaignsService } from './campaigns.service';
import { EngageService } from './engage.service';
import { InsightsService } from './insights.service';
import { LoyaltyService } from './loyalty.service';
import { MembersService } from './members.service';
import { MessagingService } from './messaging.service';
import { PortalService } from './portal.service';

@Global()
@Module({ providers: [MembersService, LoyaltyService, EngageService, InsightsService, PortalService, CampaignsService, MessagingService], controllers: [MemberProgramController, MembersController, CampaignsController, PortalController], exports: [MembersService, LoyaltyService, EngageService, MessagingService] })
export class MembersModule {}
