import { Global, Module } from '@nestjs/common';
import { MasterService } from './master.service';
import { MasterController } from './master.controller';

@Global()
@Module({ providers: [MasterService], controllers: [MasterController], exports: [MasterService] })
export class MasterModule {}
