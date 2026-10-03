import { Global, Module } from '@nestjs/common';
import { MemosModule } from '../memos/memos.module';
import { PromosController } from './promos.controller';
import { PromosService } from './promos.service';

@Global()
@Module({ imports: [MemosModule], providers: [PromosService], controllers: [PromosController], exports: [PromosService] })
export class PromosModule {}
