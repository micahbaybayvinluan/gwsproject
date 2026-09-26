import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PriceUpdatesService } from './price-updates.service';

@Global()
@Module({ providers: [NotificationsService, PriceUpdatesService], controllers: [NotificationsController], exports: [NotificationsService, PriceUpdatesService] })
export class NotificationsModule {}
