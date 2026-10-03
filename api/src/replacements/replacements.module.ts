import { Global, Module } from '@nestjs/common';
import { ReceivingModule } from '../receiving/receiving.module';
import { ClosingModule } from '../closing/closing.module';
import { ReplacementsController } from './replacements.controller';
import { ReplacementsService } from './replacements.service';

@Global()
@Module({ imports: [ReceivingModule, ClosingModule], providers: [ReplacementsService], controllers: [ReplacementsController], exports: [ReplacementsService] })
export class ReplacementsModule {}
