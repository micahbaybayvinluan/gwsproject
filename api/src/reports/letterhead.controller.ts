import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { CurrentUser, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { SettingsService } from '../common/settings.service';
import { LETTERHEAD_KEY, Letterhead } from './pdf.service';

const Details = z.object({ name: z.string().trim().max(120).optional(), address: z.string().trim().max(300).optional(), contact: z.string().trim().max(200).optional(), tin: z.string().trim().max(40).optional() });
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const owner = (u: SessionUser) => { if (u.roleKey !== 'ADMIN') throw new ForbiddenException('Only the Owner changes the company letterhead'); };

/** Company letterhead (owner request 2026-09-26): logo and details printed on every form and shown in the app header. */
@Controller('api/letterhead')
export class LetterheadController {
  constructor(private settings: SettingsService) {}
  private async current() { return ((await this.settings.get<Letterhead | null>(LETTERHEAD_KEY)) ?? {}) as Letterhead; }
  @Get() async get() { const l = await this.current(); return { name: l.name || 'Get Wheysted Supplements', address: l.address ?? '', contact: l.contact ?? '', tin: l.tin ?? '', logoDataUrl: l.logoDataUrl ?? null }; }
  @Put() @Audited('Setting', 'LETTERHEAD') async put(@CurrentUser() u: SessionUser, @Body(Z(Details)) dto: z.infer<typeof Details>) { owner(u); await this.settings.set(LETTERHEAD_KEY, { ...(await this.current()), ...dto }, u.id); return this.get(); }
  @Post('logo') @Audited('Setting', 'LETTERHEAD_LOGO') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async logo(@CurrentUser() u: SessionUser, @UploadedFile() f?: { buffer: Buffer; mimetype: string }) {
    owner(u);
    if (!f) throw new BadRequestException('Choose an image file');
    if (!TYPES.includes(f.mimetype)) throw new BadRequestException('Use a PNG (best, with a transparent background), JPG, WEBP or SVG image');
    if (f.mimetype === 'image/svg+xml' && /<script|on\w+=/i.test(f.buffer.toString('utf8'))) throw new BadRequestException('This SVG contains scripts; export a plain PNG instead');
    await this.settings.set(LETTERHEAD_KEY, { ...(await this.current()), logoDataUrl: `data:${f.mimetype};base64,${f.buffer.toString('base64')}` }, u.id);
    return this.get();
  }
  @Delete('logo') @Audited('Setting', 'LETTERHEAD_LOGO') async removeLogo(@CurrentUser() u: SessionUser) { owner(u); await this.settings.set(LETTERHEAD_KEY, { ...(await this.current()), logoDataUrl: null }, u.id); return this.get(); }
}
