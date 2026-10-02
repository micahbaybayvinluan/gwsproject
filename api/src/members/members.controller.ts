import { BadRequestException, Body, Controller, Get, Header, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Audited, CurrentUser, Public, RequireAnyPermission, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { CampaignsService } from './campaigns.service';
import { MembersService, SEGMENTS } from './members.service';
import { PortalService } from './portal.service';

const COUNTER = ['member.view', 'member.manage', 'sale.create', 'sale.create.warehouse'] as const;
const Member = z.object({ fullName: z.string().trim().min(2).max(120), phone: z.string().trim().max(40).nullable().optional(), email: z.string().trim().max(200).nullable().optional(), birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), emailOptIn: z.boolean().optional(), smsOptIn: z.boolean().optional(), notes: z.string().trim().max(500).nullable().optional() });
const MemberEdit = Member.partial().extend({ status: z.enum(['ACTIVE', 'BLOCKED']).optional() });
const Audience = z.object({ source: z.enum(['MEMBERS', 'ALL_CONTACTS']), segment: z.string().optional(), productId: z.string().uuid().optional() });
const Campaign = z.object({ channel: z.enum(['EMAIL', 'SMS']), name: z.string().trim().max(120).default(''), subject: z.string().trim().max(200).optional(), body: z.string().min(1).max(5000), audience: Audience });
const Test = z.object({ channel: z.enum(['EMAIL', 'SMS']), to: z.string().trim().min(5).max(200), subject: z.string().max(200).optional(), body: z.string().min(1).max(5000) });
const Signup = z.object({ fullName: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(40), email: z.string().trim().max(200).optional().or(z.literal('')), password: z.string().min(8).max(100), birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')), memberNo: z.string().trim().max(20).optional(), emailOptIn: z.boolean().optional(), smsOptIn: z.boolean().optional(), agree: z.boolean() });
const Login = z.object({ identifier: z.string().trim().min(3).max(200), password: z.string().min(1).max(100) });
const Profile = z.object({ fullName: z.string().trim().min(2).max(120).optional(), email: z.string().trim().max(200).nullable().optional(), birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), emailOptIn: z.boolean().optional(), smsOptIn: z.boolean().optional() });
const Pw = z.object({ current: z.string().min(1), next: z.string().min(8).max(100) });
const bearer = (req: Request) => { const h = req.headers.authorization; return h?.startsWith('Bearer ') ? h.slice(7) : undefined; };

/** Staff side of the Wheysted members. */
@Controller('api/members')
export class MembersController {
  constructor(private svc: MembersService) {}
  @Get('segments') @RequireAnyPermission('member.view', 'member.manage', 'member.blast') segments() { return Object.entries(SEGMENTS).map(([key, label]) => ({ key, label })); }
  @Get('lookup') @RequireAnyPermission(...COUNTER) lookup(@Query('q') q?: string) { return this.svc.lookup(q ?? ''); }
  @Post() @RequireAnyPermission('member.manage', 'sale.create', 'sale.create.warehouse') @Audited('Member', 'CREATE_REQUEST') create(@Body(Z(Member)) dto: z.infer<typeof Member>, @CurrentUser() u: SessionUser) { return this.svc.create(dto, { source: 'STAFF', userId: u.id, backfill: true }).then((m) => ({ id: m.id, memberNo: m.memberNo, fullName: m.fullName, phone: m.phone, email: m.email })); }
  @Post('import-from-sales') @RequirePermission('member.manage') importFromSales(@CurrentUser() u: SessionUser) { return this.svc.importFromSales(u); }
  @Get('who-bought') @RequireAnyPermission('member.view', 'member.manage') whoBought(@Query('productId') productId?: string, @Query('search') search?: string, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.whoBought({ productId, search, from, to }); }
  @Get() @RequireAnyPermission('member.view', 'member.manage') list(@Query('segment') segment?: string, @Query('search') search?: string) { return this.svc.list({ segment, search }); }
  @Get(':id') @RequireAnyPermission('member.view', 'member.manage') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post(':id') @RequirePermission('member.manage') @Audited('Member', 'UPDATE') update(@Param('id') id: string, @Body(Z(MemberEdit)) dto: z.infer<typeof MemberEdit>, @CurrentUser() u: SessionUser) { return this.svc.update(u, id, dto); }
  @Post(':id/link-past-sales') @RequirePermission('member.manage') linkPast(@Param('id') id: string) { return this.svc.linkPastSales(id).then((n) => ({ linked: n })); }
  @Post(':id/reset-portal') @RequirePermission('member.manage') reset(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.resetPortal(u, id); }
}

/** Email and SMS blasts. */
@Controller('api/campaigns')
export class CampaignsController {
  constructor(private svc: CampaignsService) {}
  @Get('config') @RequirePermission('member.blast') config() { return this.svc.config(); }
  @Post('preview') @RequirePermission('member.blast') preview(@Body(Z(z.object({ channel: z.enum(['EMAIL', 'SMS']), audience: Audience }))) dto: { channel: 'EMAIL' | 'SMS'; audience: z.infer<typeof Audience> }) { return this.svc.preview(dto.channel, dto.audience); }
  @Post('test') @RequirePermission('member.blast') test(@Body(Z(Test)) dto: z.infer<typeof Test>, @CurrentUser() u: SessionUser) { return this.svc.test(u, dto); }
  @Get() @RequirePermission('member.blast') list() { return this.svc.list(); }
  @Post() @RequirePermission('member.blast') create(@Body(Z(Campaign)) dto: z.infer<typeof Campaign>, @CurrentUser() u: SessionUser) { return this.svc.create(u, dto); }
  @Get(':id') @RequirePermission('member.blast') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post(':id/send') @RequirePermission('member.blast') send(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.send(u, id); }
}

/** The customers' own side: sign up, sign in, my card and purchases. Public routes; the member token is sent as Bearer. */
@Public()
@Controller('api/portal')
export class PortalController {
  constructor(private svc: PortalService) {}
  @Post('signup') signup(@Body(Z(Signup)) dto: z.infer<typeof Signup>) { return this.svc.signup(dto as never); }
  @Post('login') login(@Body(Z(Login)) dto: z.infer<typeof Login>) { return this.svc.login(dto.identifier, dto.password); }
  @Get('me') me(@Req() req: Request) { return this.svc.me(bearer(req)); }
  @Post('me') update(@Req() req: Request, @Body(Z(Profile)) dto: z.infer<typeof Profile>) { return this.svc.update(bearer(req), dto); }
  @Post('password') password(@Req() req: Request, @Body(Z(Pw)) dto: z.infer<typeof Pw>) { return this.svc.changePassword(bearer(req), dto.current, dto.next); }
  @Get('unsubscribe') @Header('Content-Type', 'text/html; charset=utf-8') async unsub(@Query('t') t: string, @Res() res: Response) {
    try { await this.svc.unsubscribe(t); res.send('<html><body style="font-family:Arial;text-align:center;padding:48px"><h2>You are unsubscribed</h2><p>You will not get more of these messages from Get Wheysted Supplements.</p></body></html>'); }
    catch { throw new BadRequestException('This link is not valid'); }
  }
  @Post('unsubscribe') unsubPost(@Query('t') t: string) { return this.svc.unsubscribe(t); }
}
