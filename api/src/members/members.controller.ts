import { BadRequestException, Body, Controller, Get, Header, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Audited, CurrentUser, Public, RequireAnyPermission, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { CampaignsService } from './campaigns.service';
import { MembersService, SEGMENTS } from './members.service';
import { PortalService } from './portal.service';
import { LoyaltyService } from './loyalty.service';
import { EngageService } from './engage.service';
import { InsightsService } from './insights.service';

const COUNTER = ['member.view', 'member.manage', 'sale.create', 'sale.create.warehouse'] as const;
const Member = z.object({ fullName: z.string().trim().min(2).max(120), phone: z.string().trim().max(40).nullable().optional(), email: z.string().trim().max(200).nullable().optional(), birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), emailOptIn: z.boolean().optional(), smsOptIn: z.boolean().optional(), notes: z.string().trim().max(500).nullable().optional(), referredByNo: z.string().trim().max(20).optional(), outletId: z.string().uuid().nullable().optional(), goal: z.string().max(40).nullable().optional(), gym: z.string().trim().max(120).nullable().optional(), trainingDays: z.string().trim().max(60).nullable().optional(), budget: z.string().trim().max(60).nullable().optional(), dietary: z.string().trim().max(200).nullable().optional(), flavorLikes: z.string().trim().max(200).nullable().optional(), flavorDislikes: z.string().trim().max(200).nullable().optional(), heardFrom: z.string().max(40).nullable().optional(), preferredChannel: z.string().max(20).nullable().optional(), bestTime: z.string().max(20).nullable().optional(), messengerHandle: z.string().trim().max(120).nullable().optional() });
const MemberEdit = Member.partial().extend({ status: z.enum(['ACTIVE', 'BLOCKED']).optional() });
const Voucher = z.object({ kind: z.enum(['AMOUNT', 'PERCENT']), value: z.number().positive().max(100000), validDays: z.number().int().min(1).max(365).optional(), minPurchase: z.number().min(0).optional() });
const Channel = z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'VIBER', 'MESSENGER']);
const Audience = z.object({ source: z.enum(['MEMBERS', 'ALL_CONTACTS']), segment: z.string().optional(), productId: z.string().uuid().optional(), goal: z.string().optional(), preferredChannel: z.string().optional(), tier: z.string().optional(), voucher: Voucher.optional() });
const Campaign = z.object({ channel: Channel, name: z.string().trim().max(120).default(''), subject: z.string().trim().max(200).optional(), body: z.string().min(1).max(5000), audience: Audience });
const Test = z.object({ channel: z.enum(['EMAIL', 'SMS']), to: z.string().trim().min(5).max(200), subject: z.string().max(200).optional(), body: z.string().min(1).max(5000) });
const Signup = z.object({ fullName: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(40), email: z.string().trim().max(200).optional().or(z.literal('')), password: z.string().min(8).max(100), birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')), memberNo: z.string().trim().max(20).optional(), emailOptIn: z.boolean().optional(), smsOptIn: z.boolean().optional(), agree: z.boolean(), referredByNo: z.string().trim().max(20).optional(), goal: z.string().max(40).nullable().optional(), gym: z.string().trim().max(120).nullable().optional(), trainingDays: z.string().trim().max(60).nullable().optional(), budget: z.string().trim().max(60).nullable().optional(), dietary: z.string().trim().max(200).nullable().optional(), flavorLikes: z.string().trim().max(200).nullable().optional(), flavorDislikes: z.string().trim().max(200).nullable().optional(), heardFrom: z.string().max(40).nullable().optional(), preferredChannel: z.string().max(20).nullable().optional(), bestTime: z.string().max(20).nullable().optional(), messengerHandle: z.string().trim().max(120).nullable().optional() });
const Login = z.object({ identifier: z.string().trim().min(3).max(200), password: z.string().min(1).max(100) });
const Profile = z.object({ fullName: z.string().trim().min(2).max(120).optional(), email: z.string().trim().max(200).nullable().optional(), birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), emailOptIn: z.boolean().optional(), smsOptIn: z.boolean().optional(), goal: z.string().max(40).nullable().optional(), gym: z.string().trim().max(120).nullable().optional(), trainingDays: z.string().trim().max(60).nullable().optional(), budget: z.string().trim().max(60).nullable().optional(), dietary: z.string().trim().max(200).nullable().optional(), flavorLikes: z.string().trim().max(200).nullable().optional(), flavorDislikes: z.string().trim().max(200).nullable().optional(), heardFrom: z.string().max(40).nullable().optional(), preferredChannel: z.string().max(20).nullable().optional(), bestTime: z.string().max(20).nullable().optional(), messengerHandle: z.string().trim().max(120).nullable().optional() });
const Pw = z.object({ current: z.string().min(1), next: z.string().min(8).max(100) });
const bearer = (req: Request) => { const h = req.headers.authorization; return h?.startsWith('Bearer ') ? h.slice(7) : undefined; };

/** Staff side of the Wheysted members. */
@Controller('api/members')
export class MembersController {
  constructor(private svc: MembersService, private loyalty: LoyaltyService, private engage: EngageService, private insights: InsightsService) {}
  @Get('segments') @RequireAnyPermission('member.view', 'member.manage', 'member.blast') segments() { return Object.entries(SEGMENTS).map(([key, label]) => ({ key, label })); }
  @Get('lookup') @RequireAnyPermission(...COUNTER) lookup(@Query('q') q?: string) { return this.svc.lookup(q ?? ''); }
  @Post() @RequireAnyPermission('member.manage', 'sale.create', 'sale.create.warehouse') @Audited('Member', 'CREATE_REQUEST') create(@Body(Z(Member)) dto: z.infer<typeof Member>, @CurrentUser() u: SessionUser) { return this.svc.create(dto, { source: 'STAFF', userId: u.id, backfill: true }).then((m) => ({ id: m.id, memberNo: m.memberNo, fullName: m.fullName, phone: m.phone, email: m.email })); }
  @Post('import-from-sales') @RequirePermission('member.manage') importFromSales(@CurrentUser() u: SessionUser) { return this.svc.importFromSales(u); }
  @Get('who-bought') @RequireAnyPermission('member.view', 'member.manage') whoBought(@Query('productId') productId?: string, @Query('search') search?: string, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.whoBought({ productId, search, from, to }); }
  @Get() @RequireAnyPermission('member.view', 'member.manage') list(@Query('segment') segment?: string, @Query('search') search?: string) { return this.svc.list({ segment, search }); }
  @Get(':id') @RequireAnyPermission('member.view', 'member.manage') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post(':id') @RequirePermission('member.manage') @Audited('Member', 'UPDATE') update(@Param('id') id: string, @Body(Z(MemberEdit)) dto: z.infer<typeof MemberEdit>, @CurrentUser() u: SessionUser) { return this.svc.update(u, id, dto); }
  @Post(':id/link-past-sales') @RequirePermission('member.manage') linkPast(@Param('id') id: string) { return this.svc.linkPastSales(id).then((n) => ({ linked: n })); }
  @Get(':id/vouchers') @RequireAnyPermission(...COUNTER) vouchers(@Param('id') id: string, @Query('active') active?: string) { return this.loyalty.vouchers(id, active === '1'); }
  @Post(':id/vouchers') @RequirePermission('member.manage') @Audited('Member', 'ISSUE_VOUCHER') issue(@Param('id') id: string, @Body(Z(Voucher.extend({ note: z.string().trim().max(200).optional() }))) dto: z.infer<typeof Voucher> & { note?: string }, @CurrentUser() u: SessionUser) { return this.loyalty.issueVoucher(id, { ...dto, source: 'MANUAL', userId: u.id }); }
  @Post(':id/points') @RequirePermission('member.manage') @Audited('Member', 'ADJUST_POINTS') points(@Param('id') id: string, @Body(Z(z.object({ points: z.number().int().refine((n) => n !== 0), reason: z.string().trim().min(3).max(200) }))) dto: { points: number; reason: string }, @CurrentUser() u: SessionUser) { return this.loyalty.adjustPoints(u.id, id, dto.points, dto.reason); }
  @Get(':id/notes') @RequireAnyPermission('member.view', 'member.manage') notes(@Param('id') id: string) { return this.engage.notes(id); }
  @Post(':id/notes') @RequirePermission('member.manage') addNote(@Param('id') id: string, @Body(Z(z.object({ kind: z.enum(['CALL', 'COMPLAINT', 'NOTE', 'MESSAGE']), text: z.string().trim().min(2).max(1000) }))) dto: { kind: string; text: string }, @CurrentUser() u: SessionUser) { return this.engage.addNote(u, id, dto.kind, dto.text); }
  @Get(':id/suggestions') @RequireAnyPermission(...COUNTER) suggestions(@Param('id') id: string) { return this.insights.suggestions(id); }
  @Get(':id/replacements') @RequireAnyPermission('member.view', 'member.manage') replacements(@Param('id') id: string) { return this.insights.replacements(id); }
  @Get(':id/standing') @RequireAnyPermission(...COUNTER) async standing(@Param('id') id: string) { return (await this.loyalty.standing([id])).get(id) ?? null; }
  @Post(':id/reset-portal') @RequirePermission('member.manage') reset(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.resetPortal(u, id); }
}

const Offer = z.object({ id: z.string().uuid().optional(), productId: z.string().uuid(), price: z.number().positive(), startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), active: z.boolean().optional(), note: z.string().trim().max(200).nullable().optional() });
const ProgramIn = z.object({ pesoPerPoint: z.number().positive().max(100000), pointValue: z.number().positive().max(1000), minRedeemPoints: z.number().int().min(1), silverFrom: z.number().min(0), goldFrom: z.number().min(0), voucherValidDays: z.number().int().min(1).max(365), birthdayAuto: z.boolean(), birthdayKind: z.enum(['AMOUNT', 'PERCENT']), birthdayValue: z.number().min(0), anniversaryAuto: z.boolean(), anniversaryValue: z.number().min(0), reorderAuto: z.boolean(), winbackAuto: z.boolean(), winbackValue: z.number().min(0), winbackMinPurchase: z.number().min(0), surveyAuto: z.boolean(), surveyDays: z.number().int().min(1).max(30), surveyLowRating: z.number().int().min(1).max(4), referralValue: z.number().min(0), captureTargetPct: z.number().min(0).max(100), backInStockAuto: z.boolean() }).partial();
const Lost = z.object({ productId: z.string().uuid().nullable().optional(), itemText: z.string().trim().max(200).nullable().optional(), qty: z.number().int().min(1).max(999).optional(), memberId: z.string().uuid().nullable().optional(), locationId: z.string().uuid().optional(), note: z.string().trim().max(300).nullable().optional() });

/** The member program: points, vouchers, member prices, insights, feedback, lost sales and reservations (static paths, so they never clash with /api/members/:id). */
@Controller('api/member-program')
export class MemberProgramController {
  constructor(private loyalty: LoyaltyService, private engage: EngageService, private insights: InsightsService, private campaigns: CampaignsService) {}
  @Get('settings') @RequireAnyPermission('member.view', 'member.manage') settings() { return this.loyalty.program(); }
  @Post('settings') @RequirePermission('member.manage') @Audited('MemberProgram', 'UPDATE') save(@Body(Z(ProgramIn)) dto: z.infer<typeof ProgramIn>, @CurrentUser() u: SessionUser) { return this.loyalty.saveProgram(u.id, dto); }
  @Get('offers') @RequireAnyPermission('member.view', 'member.manage') offers() { return this.loyalty.offers(); }
  @Post('offers') @RequirePermission('member.manage') @Audited('MemberOffer', 'SAVE') saveOffer(@Body(Z(Offer)) dto: z.infer<typeof Offer>, @CurrentUser() u: SessionUser) { return this.loyalty.saveOffer(u.id, dto); }
  @Get('top-spenders') @RequireAnyPermission('member.view', 'member.manage') top(@Query('limit') limit?: string) { return this.insights.topSpenders(Math.min(100, Number(limit) || 20)); }
  @Get('heatmap') @RequireAnyPermission('member.view', 'member.manage') heat(@Query('from') from?: string, @Query('to') to?: string, @Query('locationId') locationId?: string, @Query('segment') segment?: string, @Query('membersOnly') membersOnly?: string) { return this.insights.heatmap({ from, to, locationId, segment, membersOnly: membersOnly === '1' }); }
  @Get('acquisition') @RequireAnyPermission('member.view', 'member.manage') acquisition() { return this.insights.acquisition(); }
  @Get('capture') @RequireAnyPermission('member.view', 'member.manage') capture(@Query('from') from?: string, @Query('to') to?: string) { return this.insights.capture({ from, to }); }
  @Get('feedback') @RequireAnyPermission('member.view', 'member.manage') feedback(@Query('days') days?: string) { return this.engage.feedback(Math.min(365, Number(days) || 90)); }
  @Get('lost-sales') @RequireAnyPermission('member.view', 'member.manage') lost(@Query('days') days?: string, @Query('locationId') locationId?: string) { return this.engage.lostSummary(Math.min(365, Number(days) || 30), locationId); }
  @Post('lost-sales') @RequireAnyPermission(...COUNTER) logLost(@Body(Z(Lost)) dto: z.infer<typeof Lost>, @CurrentUser() u: SessionUser) { return this.engage.logLost(u, dto).then((r) => ({ id: r.id })); }
  @Get('reservations') @RequireAnyPermission(...COUNTER) reservations(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string, @Query('status') status?: string) { return this.engage.reservations(u, { locationId, status }); }
  @Post('reservations/:id') @RequireAnyPermission(...COUNTER) setReservation(@Param('id') id: string, @Body(Z(z.object({ status: z.enum(['READY', 'PICKED_UP', 'CANCELLED']) }))) dto: { status: 'READY' | 'PICKED_UP' | 'CANCELLED' }, @CurrentUser() u: SessionUser) { return this.engage.setReservation(u, id, dto.status); }
  @Get('outlet/:id/members') @RequireAnyPermission('member.view', 'member.manage', 'outlet.view.all') outletMembers(@Param('id') id: string) { return this.insights.outletMembers(id); }
  @Post('run-automation') @RequirePermission('member.manage') runDaily() { return this.engage.runDaily(); }
  @Post('campaign-recipients/:id/mark') @RequirePermission('member.blast') mark(@Param('id') id: string, @Body(Z(z.object({ status: z.enum(['SENT', 'SKIPPED']) }))) dto: { status: 'SENT' | 'SKIPPED' }, @CurrentUser() u: SessionUser) { return this.campaigns.markManual(u, id, dto.status); }
}

/** Email and SMS blasts. */
@Controller('api/campaigns')
export class CampaignsController {
  constructor(private svc: CampaignsService) {}
  @Get('config') @RequirePermission('member.blast') config() { return this.svc.config(); }
  @Post('preview') @RequirePermission('member.blast') preview(@Body(Z(z.object({ channel: Channel, audience: Audience }))) dto: { channel: z.infer<typeof Channel>; audience: z.infer<typeof Audience> }) { return this.svc.preview(dto.channel, dto.audience); }
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
  constructor(private svc: PortalService, private engage: EngageService) {}
  @Post('signup') signup(@Body(Z(Signup)) dto: z.infer<typeof Signup>) { return this.svc.signup(dto as never); }
  @Post('login') login(@Body(Z(Login)) dto: z.infer<typeof Login>) { return this.svc.login(dto.identifier, dto.password); }
  @Get('me') me(@Req() req: Request) { return this.svc.me(bearer(req)); }
  @Post('me') update(@Req() req: Request, @Body(Z(Profile)) dto: z.infer<typeof Profile>) { return this.svc.update(bearer(req), dto); }
  @Post('password') password(@Req() req: Request, @Body(Z(Pw)) dto: z.infer<typeof Pw>) { return this.svc.changePassword(bearer(req), dto.current, dto.next); }
  @Post('redeem') redeem(@Req() req: Request, @Body(Z(z.object({ points: z.number().int().min(1) }))) dto: { points: number }) { return this.svc.redeem(bearer(req), dto.points).then((v) => ({ code: v.code, value: Number(v.value), expiresOn: v.expiresOn })); }
  @Get('branches') branches(@Req() req: Request) { return this.svc.branches(bearer(req)); }
  @Get('catalog') catalog(@Req() req: Request, @Query('search') search?: string) { return this.svc.catalog(bearer(req), search); }
  @Post('reserve') reserve(@Req() req: Request, @Body(Z(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(50), locationId: z.string().uuid(), note: z.string().trim().max(200).nullable().optional() }))) dto: { productId: string; qty: number; locationId: string; note?: string | null }) { return this.svc.reserve(bearer(req), dto).then((r) => ({ id: r.id })); }
  @Post('reservations/:id/cancel') cancel(@Req() req: Request, @Param('id') id: string) { return this.svc.cancelReservation(bearer(req), id); }
  @Post('alert') alert(@Req() req: Request, @Body(Z(z.object({ productId: z.string().uuid() }))) dto: { productId: string }) { return this.svc.alertMe(bearer(req), dto.productId); }
  @Get('survey/:token') survey(@Param('token') token: string) { return this.engage.surveyView(token); }
  @Post('survey/:token') answer(@Param('token') token: string, @Body(Z(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).nullable().optional(), items: z.array(z.object({ productId: z.string().uuid(), wouldBuyAgain: z.boolean(), comment: z.string().trim().max(300).nullable().optional() })).max(40).optional() }))) dto: never) { return this.engage.surveyAnswer(token, dto); }
  @Get('unsubscribe') @Header('Content-Type', 'text/html; charset=utf-8') async unsub(@Query('t') t: string, @Res() res: Response) {
    try { await this.svc.unsubscribe(t); res.send('<html><body style="font-family:Arial;text-align:center;padding:48px"><h2>You are unsubscribed</h2><p>You will not get more of these messages from Get Wheysted Supplements.</p></body></html>'); }
    catch { throw new BadRequestException('This link is not valid'); }
  }
  @Post('unsubscribe') unsubPost(@Query('t') t: string) { return this.svc.unsubscribe(t); }
}
