import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';

@Global()
@Module({ providers: [StorageService, AttachmentsService], controllers: [AttachmentsController], exports: [StorageService, AttachmentsService] })
export class AttachmentsModule {}
