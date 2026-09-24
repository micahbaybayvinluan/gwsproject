import { Module } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { GlModule } from '../gl/gl.module';
import { ClosingModule } from '../closing/closing.module';

@Module({ imports: [GlModule, ClosingModule], providers: [ExpensesService], controllers: [ExpensesController], exports: [ExpensesService] })
export class ExpensesModule {}
