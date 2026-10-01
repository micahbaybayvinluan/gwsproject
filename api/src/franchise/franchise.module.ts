import { Global, Module } from '@nestjs/common';
import { MasterModule } from '../master/master.module';
import { GlModule } from '../gl/gl.module';
import { FranchiseController } from './franchise.controller';
import { FranchiseService } from './franchise.service';
import { FranchiseArController } from './franchise-ar.controller';
import { FranchiseArService } from './franchise-ar.service';
import { FranchiseShippingService } from './franchise-shipping.service';

@Global()
@Module({ imports: [MasterModule, GlModule], providers: [FranchiseService, FranchiseArService, FranchiseShippingService], controllers: [FranchiseController, FranchiseArController], exports: [FranchiseArService, FranchiseShippingService] })
export class FranchiseModule {}
