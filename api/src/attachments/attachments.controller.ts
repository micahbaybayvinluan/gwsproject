import { Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AttachmentsService } from './attachments.service';
import { CurrentUser, Audited } from '../common/decorators';
import type { SessionUser } from '../common/request-context';

@Controller('api/attachments')
export class AttachmentsController {
  constructor(private att: AttachmentsService) {}
  // before the ":documentType/:documentId" route, which would otherwise catch "file/<id>"
  @Get('file/:id') async download(@Param('id') id: string, @Res() res: Response) {
    const { meta, body } = await this.att.download(id);
    res.setHeader('Content-Type', meta.contentType); res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.fileName)}"`); res.send(body);
  }
  @Get(':documentType/:documentId') list(@Param('documentType') t: string, @Param('documentId') id: string) { return this.att.list(t, id); }
  @Post(':documentType/:documentId') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } })) @Audited('Attachment', 'UPLOAD')
  upload(@Param('documentType') t: string, @Param('documentId') id: string, @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string }, @CurrentUser() u: SessionUser) { return this.att.upload(t, id, file, u.id); }
}
