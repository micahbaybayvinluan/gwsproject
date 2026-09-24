import { Global, Module } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockController } from './stock.controller';

@Global()
@Module({ providers: [StockService], controllers: [StockController], exports: [StockService] })
export class StockModule {}
