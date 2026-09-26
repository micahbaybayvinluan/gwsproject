import { Module } from '@nestjs/common';
import { MasterModule } from '../master/master.module';
import { FranchiseController } from './franchise.controller';
import { FranchiseService } from './franchise.service';

@Module({ imports: [MasterModule], providers: [FranchiseService], controllers: [FranchiseController] })
export class FranchiseModule {}
