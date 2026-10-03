import { Global, Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { ReceivingModule } from '../receiving/receiving.module';
import { RestockController } from './restock.controller';
import { RestockService } from './restock.service';

@Global()
@Module({ imports: [AlertsModule, ReceivingModule], providers: [RestockService], controllers: [RestockController], exports: [RestockService] })
export class RestockModule {}
