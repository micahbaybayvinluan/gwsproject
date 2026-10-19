import { Global, Module } from '@nestjs/common';
import { ChargesService } from './charges.service';
import { ChargeSourcesService } from './charge-sources.service';
import { ChargesController } from './charges.controller';

@Global()
@Module({ providers: [ChargesService, ChargeSourcesService], controllers: [ChargesController], exports: [ChargesService, ChargeSourcesService] })
export class ChargesModule {}
