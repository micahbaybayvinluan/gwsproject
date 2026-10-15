import { Global, Module } from '@nestjs/common';
import { MasterModule } from '../master/master.module';
import { GlModule } from '../gl/gl.module';
import { FranchiseController } from './franchise.controller';
import { FranchiseService } from './franchise.service';
import { FranchiseArController } from './franchise-ar.controller';
import { FranchiseArService } from './franchise-ar.service';
import { FranchiseShippingService } from './franchise-shipping.service';
import { FranchiseDrService } from './franchise-dr.service';
import { FranchiseDrController } from './franchise-dr.controller';

@Global()
@Module({ imports: [MasterModule, GlModule], providers: [FranchiseService, FranchiseArService, FranchiseShippingService, FranchiseDrService], controllers: [FranchiseController, FranchiseArController, FranchiseDrController], exports: [FranchiseArService, FranchiseShippingService, FranchiseDrService] })
export class FranchiseModule {}
