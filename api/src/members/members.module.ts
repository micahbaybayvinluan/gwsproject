import { Global, Module } from '@nestjs/common';
import { CampaignsController, MembersController, PortalController } from './members.controller';
import { CampaignsService } from './campaigns.service';
import { MembersService } from './members.service';
import { MessagingService } from './messaging.service';
import { PortalService } from './portal.service';

@Global()
@Module({ providers: [MembersService, PortalService, CampaignsService, MessagingService], controllers: [MembersController, CampaignsController, PortalController], exports: [MembersService, MessagingService] })
export class MembersModule {}
