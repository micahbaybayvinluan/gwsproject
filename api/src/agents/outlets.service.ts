import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { TargetsService } from '../targets/targets.service';
import { addMonths, dateStr, todayManila } from '../common/manila';
import { col, findTable, readSheets } from '../ecommerce/ecom-files';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { FIELD_LABEL, OUTLET_FIELDS, canViewAll, isManager, need, norm, outletsOf, photosFor, requireAgent, stageRank, STAGES } from './field-common';

export interface OutletInput { name: string; outletType?: string; address?: string; city?: string; areaId?: string | null; contactName?: string; phone?: string; email?: string; notes?: string; lat?: number | null; lng?: number | null; agentKey?: string }

const clean = (s: unknown) => { const t = String(s ?? '').trim(); return t || null; };
const ALIASES = {
  name: ['outletname', 'gymname', 'storename', 'name', 'outlet', 'gym', 'store', 'establishment', 'businessname'],
  type: ['type', 'outlettype', 'category'], address: ['address', 'streetaddress', 'location'], city: ['city', 'municipality', 'town', 'cityprovince'],
  contact: ['contactname', 'contactperson', 'contact', 'ownername', 'owner', 'manager'], phone: ['phone', 'phonenumber', 'contactnumber', 'mobile', 'mobilenumber', 'cellphone', 'contactno', 'number'],
  email: ['email', 'emailaddress'], notes: ['notes', 'remarks'], lat: ['latitude', 'lat'], lng: ['longitude', 'lng', 'long'],
};

/**
 * Outlets / gyms of the agents (owner request 2026-10-02). An agent uploads the outlets in their area (Excel / CSV or one by one, with
 * pictures and the contact person, number and email); the Sales Manager approves them. Only approved outlets can be tagged on a sale
 * or an itinerary. After approval an agent cannot change an outlet alone: the Sales Manager approves the change and the Owner is told
 * of everything that changes. Removing an outlet is the Sales Manager's request, the Owner's decision, and only without orders in 3 months.
 */
@Injectable()
export class OutletsService implements OnModuleInit {
  constructor(private prisma: PrismaService, private approvals: ApprovalsService, private notify: NotificationsService, private audit: AuditService, private targets: TargetsService) {}

  onModuleInit() { this.approvals.register('OUTLET_DELETE', (req, outcome, actor) => this.onDeleteDecision(req.documentId, outcome, actor?.id ?? null), 'Outlet'); }

  // ── who ──
  /** Agents that have their own account (their key is that account); outlets and limits are kept per such agent. */
  async agents() { return (await this.targets.agents()).filter((g) => g.user).map((g) => ({ key: g.key, name: g.name })); }
  async me(user: SessionUser) { const a = await this.prisma.db.agent.findFirst({ where: { userId: user.id }, select: { name: true } }); return { key: user.id, name: a?.name ?? user.fullName }; }
  private async person(key: string) { const a = (await this.agents()).find((x) => x.key === key); if (!a) throw new BadRequestException('Choose an agent that has an Agent account (Targets → link the agent to an account first)'); return a; }
  private toOwner(title: string, body?: string) { return this.notify.toRoles(['ADMIN'], { type: 'OUTLET_CHANGED', title, body, link: '/outlets' }); }
  private async notifyAgent(key: string, title: string, body?: string) { if (!key.startsWith('name:')) await this.notify.toUsers([key], { type: 'OUTLET_UPDATE', title, body, link: '/outlets' }); }

  // ── areas ──
  async areas() {
    const [areas, counts] = await Promise.all([this.prisma.db.salesArea.findMany({ orderBy: { name: 'asc' } }), this.prisma.db.outlet.groupBy({ by: ['areaId', 'status'], where: { deletedAt: null }, _count: true })]);
    return areas.map((a) => ({ ...a, outlets: counts.filter((c) => c.areaId === a.id && c.status === 'APPROVED').reduce((n, c) => n + c._count, 0), pending: counts.filter((c) => c.areaId === a.id && c.status === 'PENDING').reduce((n, c) => n + c._count, 0) }));
  }
  async saveArea(input: { id?: string; name: string; notes?: string | null; agentKey?: string | null; active?: boolean }, user: SessionUser) {
    const name = input.name.trim(); if (name.length < 2) throw new BadRequestException('Type the area name');
    const ag = input.agentKey ? await this.person(input.agentKey) : null;
    const data = { name, notes: clean(input.notes), agentKey: ag?.key ?? null, agentName: ag?.name ?? null, active: input.active ?? true };
    if (await this.prisma.db.salesArea.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, NOT: { id: input.id ?? undefined } } })) throw new BadRequestException(`The area ${name} already exists`);
    const before = input.id ? await this.prisma.db.salesArea.findUnique({ where: { id: input.id } }) : null;
    const area = input.id ? await this.prisma.db.salesArea.update({ where: { id: input.id }, data }) : await this.prisma.db.salesArea.create({ data: { ...data, createdBy: user.id } });
    await this.audit.log({ action: input.id ? 'UPDATE' : 'CREATE', entityType: 'SalesArea', entityId: area.id, before, after: area, userId: user.id });
    if (ag && before?.agentKey !== ag.key) { await this.notifyAgent(ag.key, `You are assigned the area ${name}`, 'Upload the outlets / gyms in this area under Outlets.'); await this.toOwner(`Area ${name} assigned to ${ag.name}`, before?.agentName ? `Before: ${before.agentName}` : undefined); }
    return area;
  }

  // ── outlets ──
  private async rows(user: SessionUser, where: Prisma.OutletWhereInput) {
    const outlets = await this.prisma.db.outlet.findMany({ where, include: { area: { select: { id: true, name: true } }, shares: { select: { agentKey: true, agentName: true } }, _count: { select: { changes: { where: { status: 'PENDING' } } } } }, orderBy: { name: 'asc' }, take: 2000 });
    const ids = outlets.map((o) => o.id);
    const photos = await photosFor(this.prisma, 'Outlet', ids);
    const since = addMonths(todayManila(), -3);
    const orders = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.groupBy({ by: ['outletId'], where: { outletId: { in: ids }, voidedAt: null }, _max: { docDate: true }, _count: true }));
    const recent = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.groupBy({ by: ['outletId'], where: { outletId: { in: ids }, voidedAt: null, docDate: { gte: since } }, _sum: { grandTotal: true }, _count: true }));
    const visits = await this.prisma.db.itineraryStop.groupBy({ by: ['outletId'], where: { outletId: { in: ids }, status: 'VISITED' }, _max: { visitedAt: true } });
    void user;
    return outlets.map((o) => ({
      id: o.id, name: o.name, outletType: o.outletType, address: o.address, city: o.city, area: o.area, agentKey: o.agentKey, agentName: o.agentName, shares: o.shares,
      contactName: o.contactName, phone: o.phone, email: o.email, notes: o.notes, status: o.status, stage: o.stage, lat: o.lat, lng: o.lng, rejectReason: o.rejectReason, createdAt: o.createdAt,
      photoId: photos.get(o.id)?.[0]?.id ?? null, photoCount: photos.get(o.id)?.length ?? 0, pendingChanges: o._count.changes,
      lastOrder: orders.find((x) => x.outletId === o.id)?._max.docDate ? dateStr(orders.find((x) => x.outletId === o.id)!._max.docDate!) : null, orderCount: orders.find((x) => x.outletId === o.id)?._count ?? 0,
      orders3m: recent.find((x) => x.outletId === o.id)?._count ?? 0, sales3m: Number(recent.find((x) => x.outletId === o.id)?._sum.grandTotal ?? 0),
      lastVisit: visits.find((x) => x.outletId === o.id)?._max.visitedAt ?? null,
    }));
  }

  private visible(user: SessionUser, agentKey?: string): Prisma.OutletWhereInput {
    if (canViewAll(user)) return agentKey ? outletsOf(agentKey) : {};
    requireAgent(user);
    return outletsOf(user.id);
  }

  async list(user: SessionUser, q: { agentKey?: string; areaId?: string; status?: string; stage?: string; search?: string }) {
    const and: Prisma.OutletWhereInput[] = [{ deletedAt: null }, this.visible(user, q.agentKey)];
    if (q.areaId) and.push({ areaId: q.areaId });
    if (q.status) and.push({ status: q.status as never });
    if (q.stage) and.push({ stage: q.stage });
    if (q.search?.trim()) { const s = q.search.trim(); and.push({ OR: [{ name: { contains: s, mode: 'insensitive' } }, { address: { contains: s, mode: 'insensitive' } }, { city: { contains: s, mode: 'insensitive' } }, { contactName: { contains: s, mode: 'insensitive' } }, { agentName: { contains: s, mode: 'insensitive' } }] }); }
    return this.rows(user, { AND: and });
  }

  /** One outlet with its pictures, visits (with photos), orders and the changes waiting for the Sales Manager. */
  async get(user: SessionUser, id: string) {
    const [row] = await this.rows(user, { AND: [{ id, deletedAt: null }, this.visible(user)] });
    if (!row) throw new NotFoundException('Outlet not found');
    const photos = (await photosFor(this.prisma, 'Outlet', [id])).get(id) ?? [];
    const stops = await this.prisma.db.itineraryStop.findMany({ where: { outletId: id, status: { in: ['VISITED', 'MISSED'] } }, include: { itinerary: { select: { planDate: true, agentName: true } } }, orderBy: { visitedAt: 'desc' }, take: 30 });
    const stopPhotos = await photosFor(this.prisma, 'ItineraryStop', stops.map((s) => s.id));
    const sales = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { outletId: id, voidedAt: null }, select: { id: true, drSiNo: true, docDate: true, grandTotal: true, amountPaid: true, paymentMode: true, location: { select: { name: true } }, agent: { select: { name: true } } }, orderBy: { docDate: 'desc' }, take: 100 }));
    const changes = await this.prisma.db.outletChange.findMany({ where: { outletId: id }, orderBy: { createdAt: 'desc' }, take: 20 });
    return {
      ...row, photos,
      visits: stops.map((s) => ({ id: s.id, date: dateStr(s.itinerary.planDate), agent: s.itinerary.agentName, status: s.status, note: s.note, visitedAt: s.visitedAt, lat: s.lat, lng: s.lng, shelfStatus: s.shelfStatus, competitors: s.competitors, photos: stopPhotos.get(s.id) ?? [] })),
      orders: sales.map((s) => ({ id: s.id, drSiNo: s.drSiNo, date: dateStr(s.docDate), branch: s.location.name, agent: s.agent?.name ?? null, amount: Number(s.grandTotal), balance: Number(s.grandTotal) - Number(s.amountPaid), paymentMode: s.paymentMode })),
      changes,
    };
  }

  private async duplicate(name: string, city: string | null, exceptId?: string) {
    const dup = await this.prisma.db.outlet.findFirst({ where: { deletedAt: null, status: { not: 'REJECTED' }, name: { equals: name.trim(), mode: 'insensitive' }, city: city ? { equals: city, mode: 'insensitive' } : undefined, NOT: { id: exceptId } } });
    return dup;
  }

  /** An agent adds an outlet (waits for the Sales Manager); the Sales Manager adds one for an agent (approved at once). */
  async create(user: SessionUser, input: OutletInput, opts: { quiet?: boolean } = {}) {
    const name = need(clean(input.name), 'Type the outlet name');
    let owner: { key: string; name: string }; let status: 'PENDING' | 'APPROVED' = 'PENDING';
    if (isManager(user)) { owner = await this.person(need(input.agentKey, 'Choose the agent this outlet belongs to')); status = 'APPROVED'; }
    else { requireAgent(user); owner = await this.me(user); }
    const city = clean(input.city);
    const dup = await this.duplicate(name, city);
    if (dup) throw new BadRequestException(`${name}${city ? ` (${city})` : ''} is already in the database under ${dup.agentName}. Ask the Sales Manager to share it with you.`);
    let areaId = input.areaId ?? null;
    if (!areaId) { const mine = await this.prisma.db.salesArea.findMany({ where: { agentKey: owner.key, active: true }, select: { id: true } }); if (mine.length === 1) areaId = mine[0].id; }
    if (areaId && !isManager(user) && !(await this.prisma.db.salesArea.findFirst({ where: { id: areaId, agentKey: owner.key } }))) areaId = null;
    const o = await this.prisma.db.outlet.create({ data: { name, outletType: (clean(input.outletType) ?? 'GYM').toUpperCase().slice(0, 20), address: clean(input.address), city, areaId, agentKey: owner.key, agentName: owner.name, contactName: clean(input.contactName), phone: clean(input.phone), email: clean(input.email), notes: clean(input.notes), lat: input.lat ?? null, lng: input.lng ?? null, status, approvedBy: status === 'APPROVED' ? user.id : null, approvedAt: status === 'APPROVED' ? new Date() : null, createdBy: user.id } });
    await this.audit.log({ action: 'CREATE', entityType: 'Outlet', entityId: o.id, after: o, userId: user.id });
    if (status === 'PENDING' && !opts.quiet) await this.notify.toRoles(['SALES_MANAGER'], { type: 'OUTLET_PENDING', title: `${owner.name} added the outlet ${name}: waiting for your approval`, link: '/outlets?status=PENDING' });
    return o;
  }

  /** Excel / CSV of outlets: columns Name, Type, Address, City, Contact person, Phone, Email, Notes (optional Latitude, Longitude). */
  async importFile(user: SessionUser, file: { buffer: Buffer; originalname: string }, agentKey?: string) {
    const sheets = await readSheets(file.buffer, file.originalname);
    const t = findTable(sheets, ALIASES.name);
    if (!t) throw new BadRequestException('No "Name" column found. Use the template: Name, Type, Address, City, Contact person, Phone, Email, Notes.');
    const c = Object.fromEntries(Object.entries(ALIASES).map(([k, a]) => [k, col(t.keys, a)])) as Record<keyof typeof ALIASES, number>;
    const get = (r: string[], k: keyof typeof ALIASES) => (c[k] >= 0 ? clean(r[c[k]]) : null);
    let created = 0; const skipped: string[] = []; const errors: string[] = []; const seen = new Set<string>();
    for (const [i, r] of t.rows.entries()) {
      const name = get(r, 'name'); if (!name) continue;
      const key = `${norm(name)}|${norm(get(r, 'city') ?? '')}`;
      if (seen.has(key)) { skipped.push(`${name} (twice in the file)`); continue; } seen.add(key);
      const num = (v: string | null) => (v && !Number.isNaN(Number(v)) ? Number(v) : null);
      try { await this.create(user, { name, outletType: get(r, 'type') ?? undefined, address: get(r, 'address') ?? undefined, city: get(r, 'city') ?? undefined, contactName: get(r, 'contact') ?? undefined, phone: get(r, 'phone') ?? undefined, email: get(r, 'email') ?? undefined, notes: get(r, 'notes') ?? undefined, lat: num(get(r, 'lat')), lng: num(get(r, 'lng')), agentKey }, { quiet: true }); created++; }
      catch (e) { const m = (e as Error).message; (m.includes('already in the database') ? skipped : errors).push(`${name}${m.includes('already in the database') ? ' (already in the database)' : `: ${m}`}`); void i; }
    }
    if (created && !isManager(user)) { const me = await this.me(user); await this.notify.toRoles(['SALES_MANAGER'], { type: 'OUTLET_PENDING', title: `${me.name} uploaded ${created} outlet${created > 1 ? 's' : ''}: waiting for your approval`, link: '/outlets?status=PENDING' }); }
    return { created, skipped, errors, message: `${created} outlet${created === 1 ? '' : 's'} added${isManager(user) ? '' : ', waiting for the Sales Manager to approve'}.` };
  }

  /** The Sales Manager approves or rejects outlets an agent uploaded. */
  async decide(user: SessionUser, ids: string[], action: 'APPROVE' | 'REJECT', reason?: string) {
    if (action === 'REJECT' && !reason?.trim()) throw new BadRequestException('Type the reason for rejecting');
    const list = await this.prisma.db.outlet.findMany({ where: { id: { in: ids }, status: 'PENDING', deletedAt: null } });
    for (const o of list) await this.prisma.db.outlet.update({ where: { id: o.id }, data: action === 'APPROVE' ? { status: 'APPROVED', approvedBy: user.id, approvedAt: new Date(), rejectReason: null } : { status: 'REJECTED', rejectReason: reason!.trim() } });
    for (const key of [...new Set(list.map((o) => o.agentKey))]) { const mine = list.filter((o) => o.agentKey === key); await this.notifyAgent(key, action === 'APPROVE' ? `${mine.length} outlet${mine.length > 1 ? 's' : ''} approved: ${mine.map((o) => o.name).slice(0, 5).join(', ')}` : `${mine.length} outlet${mine.length > 1 ? 's' : ''} not approved: ${reason}`); }
    await this.audit.log({ action: action === 'APPROVE' ? 'APPROVE' : 'REJECT', entityType: 'Outlet', entityId: ids.join(',').slice(0, 200), after: { count: list.length, reason }, userId: user.id });
    return { done: list.length };
  }

  // ── changes after approval ──
  /** Agent: a request (Sales Manager approves, the Owner is told). Sales Manager: applied at once, the Owner is told. */
  async change(user: SessionUser, id: string, patch: Partial<Record<(typeof OUTLET_FIELDS)[number], string | null>> & { areaId?: string | null }) {
    const o = await this.prisma.db.outlet.findFirst({ where: { id, deletedAt: null, AND: [this.visible(user)] } }); if (!o) throw new NotFoundException('Outlet not found');
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of OUTLET_FIELDS) if (f in patch) { const to = clean(patch[f]); if (f === 'name' && !to) throw new BadRequestException('The name cannot be empty'); if ((o[f] ?? null) !== to) diff[f] = { from: o[f] ?? null, to }; }
    if ('areaId' in patch && isManager(user) && (patch.areaId ?? null) !== o.areaId) diff.areaId = { from: o.areaId, to: patch.areaId ?? null };
    if (!Object.keys(diff).length) throw new BadRequestException('Nothing was changed');
    if (diff.name) { const dup = await this.duplicate(String(diff.name.to), (diff.city?.to as string) ?? o.city, o.id); if (dup) throw new BadRequestException(`${diff.name.to} is already in the database under ${dup.agentName}`); }
    const me = await this.me(user);
    if (o.status !== 'APPROVED' && !isManager(user)) { await this.prisma.db.outlet.update({ where: { id }, data: Object.fromEntries(Object.entries(diff).filter(([k]) => k !== 'areaId').map(([k, v]) => [k, v.to])) as never }); return { applied: true }; } // not yet approved: the agent may still fix it
    if (isManager(user)) { await this.apply(o.id, diff); await this.announce(o.name, diff, me.name, user.fullName); return { applied: true }; }
    const ch = await this.prisma.db.outletChange.create({ data: { outletId: id, changes: diff as never, requestedBy: user.id, requestedByName: me.name } });
    await this.notify.toRoles(['SALES_MANAGER'], { type: 'OUTLET_CHANGE_PENDING', title: `${me.name} asks to change the outlet ${o.name}`, body: this.describe(diff), link: '/outlets?changes=1' });
    return { applied: false, id: ch.id, message: 'Sent to the Sales Manager for approval.' };
  }
  private describe(diff: Record<string, { from: unknown; to: unknown }>) { return Object.entries(diff).map(([k, v]) => `${FIELD_LABEL[k] ?? k}: ${v.from ?? '—'} → ${v.to ?? '—'}`).join('; '); }
  private async apply(id: string, diff: Record<string, { from: unknown; to: unknown }>) { await this.prisma.db.outlet.update({ where: { id }, data: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.to])) as never }); }
  private async announce(name: string, diff: Record<string, { from: unknown; to: unknown }>, who: string, approver: string) { await this.toOwner(`Outlet ${name} changed (by ${who}, approved by ${approver})`, this.describe(diff)); }

  pendingChanges() { return this.prisma.db.outletChange.findMany({ where: { status: 'PENDING' }, include: { outlet: { select: { id: true, name: true, agentName: true } } }, orderBy: { createdAt: 'asc' } }); }
  async decideChange(user: SessionUser, changeId: string, action: 'APPROVE' | 'REJECT', reason?: string) {
    const ch = await this.prisma.db.outletChange.findUnique({ where: { id: changeId }, include: { outlet: true } });
    if (!ch || ch.status !== 'PENDING') throw new BadRequestException('This request was already decided');
    if (action === 'REJECT' && !reason?.trim()) throw new BadRequestException('Type the reason for rejecting');
    const diff = ch.changes as unknown as Record<string, { from: unknown; to: unknown }>;
    await this.prisma.db.outletChange.update({ where: { id: changeId }, data: { status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: user.id, decidedAt: new Date(), reason: reason?.trim() || null } });
    if (action === 'APPROVE') { await this.apply(ch.outletId, diff); await this.announce(ch.outlet.name, diff, ch.requestedByName, user.fullName); }
    await this.notify.toUsers([ch.requestedBy], { type: 'OUTLET_UPDATE', title: `Your change to ${ch.outlet.name} was ${action === 'APPROVE' ? 'approved' : `not approved: ${reason}`}`, link: '/outlets' });
    await this.audit.log({ action: action === 'APPROVE' ? 'APPROVE' : 'REJECT', entityType: 'OutletChange', entityId: changeId, before: diff, userId: user.id });
    return { ok: true };
  }

  // ── Sales Manager: stage, owner, sharing, delete ──
  async setStage(user: SessionUser, id: string, stage: string) {
    if (!(STAGES as readonly string[]).includes(stage)) throw new BadRequestException('Unknown stage');
    const o = await this.prisma.db.outlet.findFirst({ where: { id, deletedAt: null, AND: [this.visible(user)] } }); if (!o) throw new NotFoundException();
    await this.prisma.db.outlet.update({ where: { id }, data: { stage } });
    await this.audit.log({ action: 'STAGE', entityType: 'Outlet', entityId: id, before: { stage: o.stage }, after: { stage }, userId: user.id });
    return { ok: true };
  }
  /** Moves up the pipeline on its own (a visit, a tagged sale); never moves back. */
  async advance(outletId: string, to: string) {
    const db = this.prisma.db;
    const o = await db.outlet.findUnique({ where: { id: outletId }, select: { stage: true } });
    if (o && stageRank(o.stage) < stageRank(to)) await db.outlet.update({ where: { id: outletId }, data: { stage: to } });
  }

  async reassign(user: SessionUser, ids: string[], input: { agentKey?: string; areaId?: string | null }) {
    const list = await this.prisma.db.outlet.findMany({ where: { id: { in: ids }, deletedAt: null } }); if (!list.length) throw new BadRequestException('Choose outlets');
    const ag = input.agentKey ? await this.person(input.agentKey) : null;
    for (const o of list) {
      const data: Prisma.OutletUpdateInput = {};
      if (ag) { data.agentKey = ag.key; data.agentName = ag.name; }
      if ('areaId' in input) data.area = input.areaId ? { connect: { id: input.areaId } } : { disconnect: true };
      await this.prisma.db.outlet.update({ where: { id: o.id }, data });
      if (ag) await this.prisma.db.outletShare.deleteMany({ where: { outletId: o.id, agentKey: ag.key } });
    }
    const area = input.areaId ? (await this.prisma.db.salesArea.findUnique({ where: { id: input.areaId } }))?.name : null;
    await this.toOwner(`${list.length} outlet${list.length > 1 ? 's' : ''} moved${ag ? ` to ${ag.name}` : ''}${area ? ` / area ${area}` : ''} by ${user.fullName}`, list.map((o) => `${o.name} (was ${o.agentName})`).slice(0, 10).join('; '));
    if (ag) await this.notifyAgent(ag.key, `${list.length} outlet${list.length > 1 ? 's' : ''} now assigned to you: ${list.map((o) => o.name).slice(0, 5).join(', ')}`);
    return { done: list.length };
  }
  async share(user: SessionUser, id: string, agentKey: string, on: boolean) {
    const o = await this.prisma.db.outlet.findFirst({ where: { id, deletedAt: null } }); if (!o) throw new NotFoundException();
    const ag = await this.person(agentKey);
    if (ag.key === o.agentKey) throw new BadRequestException('This agent already owns the outlet');
    if (on) await this.prisma.db.outletShare.upsert({ where: { outletId_agentKey: { outletId: id, agentKey } }, create: { outletId: id, agentKey, agentName: ag.name, createdBy: user.id }, update: {} });
    else await this.prisma.db.outletShare.deleteMany({ where: { outletId: id, agentKey } });
    await this.toOwner(`Outlet ${o.name} ${on ? 'shared with' : 'no longer shared with'} ${ag.name} (by ${user.fullName})`);
    if (on) await this.notifyAgent(agentKey, `The outlet ${o.name} (${o.agentName}) is shared with you`);
    return { ok: true };
  }

  /** Orders (not voided) tagged to the outlet in the last 3 months: any one blocks removing it. */
  async activeOrders(id: string) {
    const since = addMonths(todayManila(), -3);
    return requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { outletId: id, voidedAt: null, docDate: { gte: since } }, select: { drSiNo: true, docDate: true }, orderBy: { docDate: 'desc' } }));
  }
  async requestDelete(user: SessionUser, id: string, reason?: string) {
    const o = await this.prisma.db.outlet.findFirst({ where: { id, deletedAt: null } }); if (!o) throw new NotFoundException();
    const active = await this.activeOrders(id);
    if (active.length) throw new BadRequestException(`${o.name} has ${active.length} order${active.length > 1 ? 's' : ''} in the last 3 months (latest ${active[0].drSiNo}, ${dateStr(active[0].docDate)}), so it cannot be removed`);
    const csg = await this.prisma.db.consignmentAgreement.findFirst({ where: { outletId: id, active: true } });
    if (csg) throw new BadRequestException(`${o.name} still has a consignee account; unlink it under Agent consignments first`);
    if (await this.prisma.db.approvalRequest.findFirst({ where: { type: 'OUTLET_DELETE', documentId: id, status: 'PENDING' } })) throw new BadRequestException('A removal request for this outlet is already waiting for the Owner');
    const req = await this.approvals.request({ type: 'OUTLET_DELETE', documentType: 'Outlet', documentId: id, requestedBy: user.id, summary: { controlNo: `Remove outlet ${o.name}`, locationName: `Agent: ${o.agentName}`, notes: `No order in the last 3 months. ${reason ?? ''}`.trim() } });
    if (user.roleKey === 'ADMIN') await this.approvals.decide(req.id, user, 'APPROVE', 'Removed by the Owner');
    return { requested: true };
  }
  private async onDeleteDecision(id: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const o = await this.prisma.db.outlet.findUniqueOrThrow({ where: { id } });
      if (outcome === 'REJECTED') { await this.notify.toRoles(['SALES_MANAGER'], { type: 'OUTLET_UPDATE', title: `The Owner did not approve removing ${o.name}`, link: '/outlets' }); return; }
      const active = await this.activeOrders(id);
      if (active.length) throw new BadRequestException(`${o.name} now has orders in the last 3 months; it cannot be removed`);
      await this.prisma.db.outlet.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
      await this.audit.log({ action: 'DELETE', entityType: 'Outlet', entityId: id, before: o, userId: actorId ?? undefined });
      await this.notify.toRoles(['SALES_MANAGER'], { type: 'OUTLET_UPDATE', title: `${o.name} was removed from the outlet database (Owner approved)`, link: '/outlets' });
      await this.notifyAgent(o.agentKey, `${o.name} was removed from the outlet database`);
    });
  }

  // ── lookups ──
  /** For the New Sale form: the agents that have approved outlets. */
  async lookupAgents() {
    const rows = await this.prisma.db.outlet.findMany({ where: { status: 'APPROVED', active: true, deletedAt: null }, select: { agentKey: true, agentName: true, shares: { select: { agentKey: true, agentName: true } } } });
    const m = new Map<string, string>(); for (const r of rows) { m.set(r.agentKey, r.agentName); for (const s of r.shares) m.set(s.agentKey, s.agentName); }
    return [...m.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
  }
  /** An agent's approved outlets (own and shared), or a name search across all, for tagging a sale or an itinerary stop. */
  async lookup(user: SessionUser, q: { agentKey?: string; agentId?: string; search?: string }) {
    let key = q.agentKey;
    if (!key && q.agentId) { const a = await this.prisma.db.agent.findUnique({ where: { id: q.agentId }, select: { userId: true, name: true } }); key = a?.userId ?? undefined; }
    if (!canViewAll(user) && user.permissions.has('agent.self') && !user.permissions.has('sale.create') && !user.permissions.has('sale.create.warehouse')) key = user.id;
    const where: Prisma.OutletWhereInput = { status: 'APPROVED', active: true, deletedAt: null, ...(key ? outletsOf(key) : {}) };
    if (q.search?.trim()) where.name = { contains: q.search.trim(), mode: 'insensitive' };
    const rows = await this.prisma.db.outlet.findMany({ where, include: { area: { select: { name: true } } }, orderBy: { name: 'asc' }, take: 300 });
    return rows.map((o) => ({ id: o.id, name: o.name, city: o.city, address: o.address, area: o.area?.name ?? null, agentKey: o.agentKey, agentName: o.agentName, contactName: o.contactName, phone: o.phone }));
  }
  /** Used by New Sale: the outlet must be approved. */
  async assertTaggable(id: string) { const o = await this.prisma.db.outlet.findFirst({ where: { id, deletedAt: null } }); if (!o) throw new BadRequestException('Unknown outlet'); if (o.status !== 'APPROVED' || !o.active) throw new BadRequestException(`The outlet ${o.name} is not approved yet. The agent uploads it and the Sales Manager approves it first.`); return o; }

  /** Pins for the map: approved outlets with a location (typed, or taken from the first visit's GPS). */
  async map(user: SessionUser, q: { agentKey?: string; areaId?: string }) {
    const rows = await this.prisma.db.outlet.findMany({ where: { AND: [{ status: 'APPROVED', deletedAt: null, lat: { not: null }, lng: { not: null } }, this.visible(user, q.agentKey), q.areaId ? { areaId: q.areaId } : {}] }, include: { area: { select: { name: true } } } });
    return rows.map((o) => ({ id: o.id, name: o.name, lat: o.lat!, lng: o.lng!, agentName: o.agentName, area: o.area?.name ?? null, stage: o.stage, city: o.city }));
  }
  async pipeline(user: SessionUser) {
    const rows = await this.prisma.db.outlet.findMany({ where: { AND: [{ status: 'APPROVED', deletedAt: null }, this.visible(user)] }, select: { agentKey: true, agentName: true, stage: true } });
    const by = new Map<string, { agentKey: string; agentName: string; total: number } & Record<string, number>>();
    for (const r of rows) { const x = by.get(r.agentKey) ?? { agentKey: r.agentKey, agentName: r.agentName, total: 0, ...Object.fromEntries(STAGES.map((s) => [s, 0])) } as never; (x as Record<string, number>)[r.stage]++; x.total++; by.set(r.agentKey, x); }
    return { stages: STAGES, agents: [...by.values()].sort((a, b) => a.agentName.localeCompare(b.agentName)) };
  }
  forbid() { throw new ForbiddenException(); }
}
