import { Global, Module } from '@nestjs/common';
import { DraftsController } from './drafts.controller';
import { DraftsService } from './drafts.service';

@Global()
@Module({ providers: [DraftsService], controllers: [DraftsController], exports: [DraftsService] })
export class DraftsModule {}
