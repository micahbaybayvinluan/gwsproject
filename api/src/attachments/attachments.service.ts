import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from './storage.service';
import { SettingsService } from '../common/settings.service';

/** §13 attachments panel for every document, plus required-attachment rules configurable by Admin. */
@Injectable()
export class AttachmentsService {
  constructor(private prisma: PrismaService, private storage: StorageService, private settings: SettingsService) {}

  async upload(documentType: string, documentId: string, file: { buffer: Buffer; originalname: string; mimetype: string }, userId: string) {
    this.storage.validate(file.buffer, file.mimetype);
    const scan = await this.storage.scan(file.buffer);
    if (scan === 'INFECTED') throw new BadRequestException('File rejected by virus scanner');
    const sha256 = this.storage.sha256(file.buffer);
    const key = `${documentType}/${documentId}/${Date.now()}-${file.originalname.replace(/[^\w.\-]+/g, '_')}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    return this.prisma.db.attachment.create({ data: { documentType, documentId, fileName: file.originalname, contentType: file.mimetype, sizeBytes: file.buffer.length, storageKey: key, sha256, scanStatus: scan, uploadedBy: userId } });
  }
  list(documentType: string, documentId: string) { return this.prisma.db.attachment.findMany({ where: { documentType, documentId }, orderBy: { createdAt: 'asc' } }); }
  async download(id: string) {
    const a = await this.prisma.db.attachment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException();
    return { meta: a, body: await this.storage.get(a.storageKey) };
  }
  /** Enforce required-attachment rules (e.g. proof of payment for ONLINE/CREDIT_CARD sales). */
  async assertRequired(documentType: string, documentId: string, discriminator?: string) {
    const rules = await this.settings.get<Record<string, boolean | string[]>>('attachments.required');
    const rule = rules?.[documentType];
    const required = rule === true || (Array.isArray(rule) && !!discriminator && rule.includes(discriminator));
    if (!required) return;
    const n = await this.prisma.db.attachment.count({ where: { documentType, documentId } });
    if (n === 0) throw new BadRequestException(`${documentType} requires an attachment${discriminator ? ` for ${discriminator}` : ''}`);
  }
}
