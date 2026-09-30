import { Global, Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';

@Global()
@Module({ providers: [AlertsService], controllers: [AlertsController], exports: [AlertsService] })
export class AlertsModule {}
