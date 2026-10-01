import { Global, Module } from '@nestjs/common';
import { ReceivingModule } from '../receiving/receiving.module';
import { ReplacementsController } from './replacements.controller';
import { ReplacementsService } from './replacements.service';

@Global()
@Module({ imports: [ReceivingModule], providers: [ReplacementsService], controllers: [ReplacementsController], exports: [ReplacementsService] })
export class ReplacementsModule {}
