import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { ArController, ConsignmentController, SalesController } from './sales.controller';
import { GlModule } from '../gl/gl.module';
import { ClosingModule } from '../closing/closing.module';

@Module({ imports: [GlModule, ClosingModule], providers: [SalesService], controllers: [SalesController, ArController, ConsignmentController], exports: [SalesService] })
export class SalesModule {}
