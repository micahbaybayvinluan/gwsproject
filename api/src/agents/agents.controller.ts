import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { Audited, CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { dateStr, todayManila } from '../common/manila';
import { OutletsService } from './outlets.service';
import { ItinerariesService } from './itineraries.service';
import { AgentConsignmentsService } from './agent-consignments.service';
import { MonitorService } from './monitor.service';

const READ = ['outlet.view.all', 'outlet.manage', 'agent.self'] as const;
const SELL = ['sale.create', 'sale.create.warehouse', ...READ] as const;
type F = { buffer: Buffer; originalname: string };
const Up = () => UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }));
const thisMonth = () => dateStr(todayManila()).slice(0, 7);
const Text = z.string().trim().max(300).optional().nullable();
const OutletBody = z.object({ name: z.string().trim().min(2).max(200), outletType: Text, address: Text, city: Text, areaId: z.string().uuid().nullable().optional(), contactName: Text, phone: z.string().trim().max(60).optional().nullable(), email: z.string().trim().email().max(200).optional().or(z.literal('')).nullable(), notes: z.string().trim().max(1000).optional().nullable(), lat: z.number().min(-90).max(90).nullable().optional(), lng: z.number().min(-180).max(180).nullable().optional(), agentKey: z.string().optional() });
const Change = z.object({ name: z.string().trim().min(2).max(200).optional(), outletType: Text, address: Text, city: Text, areaId: z.string().uuid().nullable().optional(), contactName: Text, phone: z.string().trim().max(60).optional().nullable(), email: z.string().trim().email().max(200).optional().or(z.literal('')).nullable(), notes: z.string().trim().max(1000).optional().nullable() });
const Area = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(2).max(120), notes: Text, agentKey: z.string().nullable().optional(), active: z.boolean().optional() });
const Decide = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), action: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().max(300).optional() });
const DecideOne = z.object({ action: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().max(300).optional() });
const Stage = z.object({ stage: z.string() });
const Reassign = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), agentKey: z.string().optional(), areaId: z.string().uuid().nullable().optional() });
const Share = z.object({ agentKey: z.string(), on: z.boolean() });
const Del = z.object({ reason: z.string().trim().max(300).optional() });
const Plan = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), outletIds: z.array(z.string().uuid()).max(100), notes: z.string().trim().max(500).optional() });
const Report = z.object({ status: z.enum(['VISITED', 'MISSED']), note: z.string().trim().max(1000).optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), shelfStatus: z.string().optional(), competitors: z.string().trim().max(500).optional() });
const Submit = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const Claim = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), kind: z.enum(['FUEL', 'TRANSPORT', 'MEAL', 'OTHER']), amount: z.number().positive().max(1000000), note: z.string().trim().max(300).optional() });
const Assign = z.object({ consigneeId: z.string().uuid(), outletId: z.string().uuid().nullable() });
const Limit = z.object({ agentKey: z.string(), outletId: z.string().uuid().nullable().optional(), amount: z.number().positive().max(100000000), notes: z.string().trim().max(300).optional() });

/** Agent field work: outlets, areas, itineraries with visit photos, claims, consignments and monitoring. */
@Controller('api/field')
export class AgentsController {
  constructor(private outlets: OutletsService, private its: ItinerariesService, private csg: AgentConsignmentsService, private monitor: MonitorService) {}

  // lookups (New Sale tags the outlet; the agent is picked first)
  @Get('lookup/agents') @RequireAnyPermission(...SELL) lookupAgents() { return this.outlets.lookupAgents(); }
  @Get('lookup') @RequireAnyPermission(...SELL) lookup(@CurrentUser() u: SessionUser, @Query('agentKey') agentKey?: string, @Query('agentId') agentId?: string, @Query('search') search?: string) { return this.outlets.lookup(u, { agentKey, agentId, search }); }
  @Get('agents') @RequireAnyPermission('outlet.view.all', 'outlet.manage') agents() { return this.outlets.agents(); }

  // areas
  @Get('areas') @RequireAnyPermission(...READ) areas() { return this.outlets.areas(); }
  @Post('areas') @RequirePermission('outlet.manage') @Audited('SalesArea', 'SAVE') saveArea(@Body(Z(Area)) dto: z.infer<typeof Area>, @CurrentUser() u: SessionUser) { return this.outlets.saveArea(dto, u); }
  @Get('areas/performance') @RequireAnyPermission('outlet.view.all', 'outlet.manage') areaPerformance(@CurrentUser() u: SessionUser, @Query('month') month?: string) { return this.monitor.areaPerformance(u, month || thisMonth()); }

  // outlets
  @Get('outlets') @RequireAnyPermission(...READ) list(@CurrentUser() u: SessionUser, @Query('agentKey') agentKey?: string, @Query('areaId') areaId?: string, @Query('status') status?: string, @Query('stage') stage?: string, @Query('search') search?: string) { return this.outlets.list(u, { agentKey, areaId, status, stage, search }); }
  @Get('outlets/map') @RequireAnyPermission(...READ) map(@CurrentUser() u: SessionUser, @Query('agentKey') agentKey?: string, @Query('areaId') areaId?: string) { return this.outlets.map(u, { agentKey, areaId }); }
  @Get('outlets/pipeline') @RequireAnyPermission(...READ) pipeline(@CurrentUser() u: SessionUser) { return this.outlets.pipeline(u); }
  @Get('outlets/dormant') @RequireAnyPermission(...READ) dormant(@CurrentUser() u: SessionUser, @Query('agentKey') agentKey?: string) { return this.monitor.dormant(u, agentKey); }
  @Get('outlets/changes') @RequirePermission('outlet.manage') changes() { return this.outlets.pendingChanges(); }
  @Post('outlets/changes/:id') @RequirePermission('outlet.manage') @Audited('OutletChange', 'DECIDE') decideChange(@Param('id') id: string, @Body(Z(DecideOne)) dto: z.infer<typeof DecideOne>, @CurrentUser() u: SessionUser) { return this.outlets.decideChange(u, id, dto.action, dto.reason); }
  @Post('outlets/import') @RequireAnyPermission('agent.self', 'outlet.manage') @Up() @Audited('Outlet', 'IMPORT') importFile(@UploadedFile() f: F, @CurrentUser() u: SessionUser, @Query('agentKey') agentKey?: string) { if (!f) throw new BadRequestException('Choose the Excel / CSV file'); return this.outlets.importFile(u, f, agentKey); }
  @Post('outlets/decide') @RequirePermission('outlet.manage') decide(@Body(Z(Decide)) dto: z.infer<typeof Decide>, @CurrentUser() u: SessionUser) { return this.outlets.decide(u, dto.ids, dto.action, dto.reason); }
  @Post('outlets/reassign') @RequirePermission('outlet.manage') reassign(@Body(Z(Reassign)) dto: z.infer<typeof Reassign>, @CurrentUser() u: SessionUser) { return this.outlets.reassign(u, dto.ids, { agentKey: dto.agentKey, ...('areaId' in dto ? { areaId: dto.areaId } : {}) }); }
  @Post('outlets') @RequireAnyPermission('agent.self', 'outlet.manage') @Audited('Outlet', 'CREATE') create(@Body(Z(OutletBody)) dto: z.infer<typeof OutletBody>, @CurrentUser() u: SessionUser) { return this.outlets.create(u, dto as never); }
  @Get('outlets/:id') @RequireAnyPermission(...READ) get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.outlets.get(u, id); }
  @Post('outlets/:id/change') @RequireAnyPermission('agent.self', 'outlet.manage') @Audited('Outlet', 'CHANGE') change(@Param('id') id: string, @Body(Z(Change)) dto: z.infer<typeof Change>, @CurrentUser() u: SessionUser) { return this.outlets.change(u, id, dto as never); }
  @Post('outlets/:id/stage') @RequireAnyPermission('agent.self', 'outlet.manage') setStage(@Param('id') id: string, @Body(Z(Stage)) dto: z.infer<typeof Stage>, @CurrentUser() u: SessionUser) { return this.outlets.setStage(u, id, dto.stage); }
  @Post('outlets/:id/share') @RequirePermission('outlet.manage') share(@Param('id') id: string, @Body(Z(Share)) dto: z.infer<typeof Share>, @CurrentUser() u: SessionUser) { return this.outlets.share(u, id, dto.agentKey, dto.on); }
  @Post('outlets/:id/delete') @RequirePermission('outlet.manage') @Audited('Outlet', 'REQUEST_DELETE') del(@Param('id') id: string, @Body(Z(Del)) dto: z.infer<typeof Del>, @CurrentUser() u: SessionUser) { return this.outlets.requestDelete(u, id, dto.reason); }

  // itineraries
  @Get('itinerary') @RequireAnyPermission(...READ) day(@CurrentUser() u: SessionUser, @Query('date') date?: string, @Query('agentKey') agentKey?: string) { return this.its.day(u, date || dateStr(todayManila()), agentKey); }
  @Post('itinerary/plan') @RequirePermission('agent.self') @Audited('Itinerary', 'PLAN') plan(@Body(Z(Plan)) dto: z.infer<typeof Plan>, @CurrentUser() u: SessionUser) { return this.its.plan(u, dto); }
  @Post('itinerary/import') @RequirePermission('agent.self') @Up() @Audited('Itinerary', 'IMPORT') importPlan(@UploadedFile() f: F, @CurrentUser() u: SessionUser) { if (!f) throw new BadRequestException('Choose the Excel / CSV file'); return this.its.importPlan(u, f); }
  @Post('itinerary/stops/:id/report') @RequirePermission('agent.self') @Audited('ItineraryStop', 'REPORT') report(@Param('id') id: string, @Body(Z(Report)) dto: z.infer<typeof Report>, @CurrentUser() u: SessionUser) { return this.its.report(u, id, dto); }
  @Post('itinerary/submit') @RequirePermission('agent.self') @Audited('Itinerary', 'SUBMIT') submit(@Body(Z(Submit)) dto: z.infer<typeof Submit>, @CurrentUser() u: SessionUser) { return this.its.submit(u, dto.date); }
  @Get('board') @RequireAnyPermission(...READ) board(@CurrentUser() u: SessionUser, @Query('from') from?: string, @Query('to') to?: string, @Query('agentKey') agentKey?: string) { return this.its.board(u, { from, to, agentKey }); }
  @Get('claims') @RequireAnyPermission(...READ) claims(@CurrentUser() u: SessionUser, @Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string) { return this.its.claims(u, { status, from, to }); }
  @Post('claims') @RequirePermission('agent.self') @Audited('ItineraryClaim', 'CREATE') addClaim(@Body(Z(Claim)) dto: z.infer<typeof Claim>, @CurrentUser() u: SessionUser) { return this.its.addClaim(u, dto); }
  @Post('claims/:id/decide') @RequirePermission('outlet.manage') @Audited('ItineraryClaim', 'DECIDE') decideClaim(@Param('id') id: string, @Body(Z(DecideOne)) dto: z.infer<typeof DecideOne>, @CurrentUser() u: SessionUser) { return this.its.decideClaim(u, id, dto.action, dto.reason); }

  // consignments
  @Get('consignments/mine') @RequirePermission('agent.self') mine(@CurrentUser() u: SessionUser) { return this.csg.mine(u); }
  @Get('consignments/overview') @RequireAnyPermission('outlet.view.all', 'outlet.manage') overview(@CurrentUser() u: SessionUser) { return this.csg.overview(u); }
  @Post('consignments/assign') @RequirePermission('outlet.manage') @Audited('ConsignmentAgreement', 'ASSIGN_AGENT') assign(@Body(Z(Assign)) dto: z.infer<typeof Assign>, @CurrentUser() u: SessionUser) { return this.csg.assign(u, dto.consigneeId, dto.outletId); }
  @Post('consignments/limits') @RequirePermission('outlet.manage') @Audited('AgentConsignmentLimit', 'REQUEST') limit(@Body(Z(Limit)) dto: z.infer<typeof Limit>, @CurrentUser() u: SessionUser) { return this.csg.requestLimit(u, dto); }

  // scorecard
  @Get('scorecard') @RequireAnyPermission(...READ) scorecard(@CurrentUser() u: SessionUser, @Query('month') month?: string, @Query('agentKey') agentKey?: string) { return this.monitor.scorecard(u, month || thisMonth(), agentKey); }
}
