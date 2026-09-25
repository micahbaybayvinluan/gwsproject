import { Global, Module } from '@nestjs/common';
import { ChargesService } from './charges.service';
import { ChargesController } from './charges.controller';

@Global()
@Module({ providers: [ChargesService], controllers: [ChargesController], exports: [ChargesService] })
export class ChargesModule {}
