import { Module } from '@nestjs/common';
import { SixPackService } from './sixpack.service';
import { SixPackController } from './sixpack.controller';
import { ExpensesModule } from '../expenses/expenses.module';

@Module({ imports: [ExpensesModule], providers: [SixPackService], controllers: [SixPackController], exports: [SixPackService] })
export class SixPackModule {}
