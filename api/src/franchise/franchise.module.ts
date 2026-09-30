import { Global, Module } from '@nestjs/common';
import { MasterModule } from '../master/master.module';
import { GlModule } from '../gl/gl.module';
import { FranchiseController } from './franchise.controller';
import { FranchiseService } from './franchise.service';
import { FranchiseArController } from './franchise-ar.controller';
import { FranchiseArService } from './franchise-ar.service';

@Global()
@Module({ imports: [MasterModule, GlModule], providers: [FranchiseService, FranchiseArService], controllers: [FranchiseController, FranchiseArController], exports: [FranchiseArService] })
export class FranchiseModule {}
