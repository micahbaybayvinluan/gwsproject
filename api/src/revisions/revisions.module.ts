import { Global, Module } from '@nestjs/common';
import { RevisionsService } from './revisions.service';
import { RevisionsController } from './revisions.controller';

@Global()
@Module({ providers: [RevisionsService], controllers: [RevisionsController], exports: [RevisionsService] })
export class RevisionsModule {}
