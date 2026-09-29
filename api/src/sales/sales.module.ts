import { CustomerFollowUpsService } from './customer-followups.service';
import { CustomerFollowUpsController } from './customer-followups.controller';
import { ConsignmentService } from './consignment.service';
import { ExpensesModule } from '../expenses/expenses.module';
import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { ArController, ConsignmentController, OpeningArController, SalesController } from './sales.controller';
import { OpeningArService } from './opening-ar.service';
import { GlModule } from '../gl/gl.module';
import { ClosingModule } from '../closing/closing.module';

@Module({ imports: [GlModule, ClosingModule, ExpensesModule], providers: [SalesService, ConsignmentService, CustomerFollowUpsService, OpeningArService], controllers: [CustomerFollowUpsController, SalesController, OpeningArController, ArController, ConsignmentController], exports: [SalesService, ConsignmentService, CustomerFollowUpsService, OpeningArService] })
export class SalesModule {}
