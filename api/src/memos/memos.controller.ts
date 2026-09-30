import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequirePermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { MemosService } from './memos.service';

const Audience = z.object({ all: z.boolean().optional(), franchiseOwners: z.boolean().optional(), franchiseAssociates: z.boolean().optional(), roles: z.array(z.string()).optional(), locationIds: z.array(z.string().uuid()).optional(), userIds: z.array(z.string().uuid()).optional() });
const Create = z.object({
  subject: z.string().trim().min(3).max(200), addressedTo: z.string().trim().max(400).optional(), fromText: z.string().trim().max(200).optional(), memoDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  body: z.string().trim().min(3).max(20000), table: z.object({ headers: z.array(z.string().max(80)).min(1).max(8), rows: z.array(z.array(z.string().max(200))).max(200) }).nullable().optional(),
  signers: z.array(z.object({ name: z.string().trim().min(1).max(120), title: z.string().trim().max(160), userId: z.string().uuid().nullable().optional() })).max(10).optional(), audience: Audience,
});
const Void = z.object({ reason: z.string().trim().min(3) });

@Controller('api/memos')
export class MemosController {
  constructor(private svc: MemosService) {}
  @Get() list(@CurrentUser() u: SessionUser) { return this.svc.list(u); }
  @Get('options') @RequirePermission('memo.create') options() { return this.svc.options(); }
  @Post('preview') @RequirePermission('memo.create') async preview(@Body(Z(Audience)) a: z.infer<typeof Audience>) { const r = await this.svc.resolve(a); return { count: r.length, people: r.slice(0, 60) }; }
  @Post() @RequirePermission('memo.create') @Audited('Memo', 'CREATE') create(@CurrentUser() u: SessionUser, @Body(Z(Create)) dto: z.infer<typeof Create>) { return this.svc.create(dto, u); }
  @Get(':id') get(@CurrentUser() u: SessionUser, @Param('id') id: string) { return this.svc.get(id, u); }
  @Post(':id/ack') ack(@CurrentUser() u: SessionUser, @Param('id') id: string) { return this.svc.acknowledge(id, u); }
  @Post(':id/void') @Audited('Memo', 'VOID') voidIt(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body(Z(Void)) dto: z.infer<typeof Void>) { return this.svc.voidMemo(id, dto.reason, u); }
  @Get(':id/pdf') async pdf(@CurrentUser() u: SessionUser, @Param('id') id: string, @Res() res: Response) { const o = await this.svc.pdfOf(id, u); res.setHeader('Content-Type', o.contentType); res.setHeader('Content-Disposition', `attachment; filename="${o.fileName}"`); res.send(o.buffer); }
}
