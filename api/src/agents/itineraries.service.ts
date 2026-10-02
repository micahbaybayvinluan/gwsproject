import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { dateStr, todayManila, toDateOnly } from '../common/manila';
import { col, findTable, readSheets } from '../ecommerce/ecom-files';
import type { SessionUser } from '../common/request-context';
import { CLAIM_KINDS, SHELF, canViewAll, isManager, need, norm, outletsOf, parseDay, photosFor, requireAgent } from './field-common';
import { OutletsService } from './outlets.service';

const peso = (x: Prisma.Decimal.Value) => `₱${Number(x).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export interface ReportInput { status: 'VISITED' | 'MISSED'; note?: string; lat?: number; lng?: number; shelfStatus?: string; competitors?: string }

/**
 * Daily itineraries (owner request 2026-10-02). The agent plans the stores to visit (typed, picked or uploaded) and reports each one at
 * the end of the visit: visited needs a photo and the phone's location (the photo carries its upload time), missed needs the reason.
 * The Sales Manager, Head Auditor and Owner see every agent's days, photos, shelf checks and fuel / transport claims.
 */
@Injectable()
export class ItinerariesService {
  constructor(private prisma: PrismaService, private notify: NotificationsService, private audit: AuditService, private outlets: OutletsService) {}

  private async view(user: SessionUser, agentKey?: string) {
    if (canViewAll(user)) return agentKey ?? user.id;
    requireAgent(user); return user.id;
  }

  private async load(itineraryId: string) {
    const it = await this.prisma.db.itinerary.findUniqueOrThrow({ where: { id: itineraryId }, include: { stops: { include: { outlet: { select: { id: true, name: true, address: true, city: true, contactName: true, phone: true, lat: true, lng: true } } }, orderBy: { seq: 'asc' } }, claims: { orderBy: { createdAt: 'asc' } } } });
    const photos = await photosFor(this.prisma, 'ItineraryStop', it.stops.map((s) => s.id));
    const receipts = await photosFor(this.prisma, 'ItineraryClaim', it.claims.map((c) => c.id));
    return {
      id: it.id, agentKey: it.agentKey, agentName: it.agentName, date: dateStr(it.planDate), notes: it.notes, reportSubmittedAt: it.reportSubmittedAt,
      stops: it.stops.map((s) => ({ id: s.id, outletId: s.outletId, outlet: s.outlet, status: s.status, note: s.note, visitedAt: s.visitedAt, lat: s.lat, lng: s.lng, shelfStatus: s.shelfStatus, competitors: s.competitors, photos: photos.get(s.id) ?? [] })),
      claims: it.claims.map((c) => ({ id: c.id, kind: c.kind, amount: Number(c.amount), note: c.note, status: c.status, receipts: receipts.get(c.id) ?? [] })),
    };
  }

  /** The agent's plan / report for a day (empty when nothing was planned). */
  async day(user: SessionUser, date: string, agentKey?: string) {
    const key = await this.view(user, agentKey);
    const it = await this.prisma.db.itinerary.findUnique({ where: { agentKey_planDate: { agentKey: key, planDate: toDateOnly(date) } } });
    return it ? this.load(it.id) : { id: null, agentKey: key, date, notes: null, reportSubmittedAt: null, stops: [], claims: [] };
  }

  /** Sets the stores planned for a day (today or later). Stores already reported stay. */
  async plan(user: SessionUser, input: { date: string; outletIds: string[]; notes?: string }) {
    requireAgent(user);
    const date = toDateOnly(input.date);
    if (dateStr(date) < dateStr(todayManila())) throw new BadRequestException('A plan is made for today or a later day');
    const me = await this.outlets.me(user);
    const ok = await this.prisma.db.outlet.findMany({ where: { id: { in: input.outletIds }, status: 'APPROVED', active: true, deletedAt: null, ...outletsOf(user.id) }, select: { id: true } });
    if (ok.length !== new Set(input.outletIds).size) throw new BadRequestException('Only your approved outlets can be planned. An outlet that is not listed must first be uploaded and approved by the Sales Manager.');
    const it = await this.prisma.db.itinerary.upsert({ where: { agentKey_planDate: { agentKey: user.id, planDate: date } }, create: { agentKey: user.id, agentName: me.name, planDate: date, notes: input.notes ?? null, createdBy: user.id }, update: { notes: input.notes ?? undefined } });
    if (it.reportSubmittedAt) throw new BadRequestException('The report for this day was already submitted');
    const want = [...new Set(input.outletIds)];
    await this.prisma.db.itineraryStop.deleteMany({ where: { itineraryId: it.id, status: 'PLANNED', outletId: { notIn: want } } });
    const have = await this.prisma.db.itineraryStop.findMany({ where: { itineraryId: it.id }, select: { outletId: true, seq: true } });
    let seq = Math.max(0, ...have.map((h) => h.seq)) + 1;
    for (const id of want) if (!have.some((h) => h.outletId === id)) await this.prisma.db.itineraryStop.create({ data: { itineraryId: it.id, outletId: id, seq: seq++ } });
    return this.load(it.id);
  }

  /** Excel / CSV itinerary: columns Date and Outlet (the outlet name as in your list). */
  async importPlan(user: SessionUser, file: { buffer: Buffer; originalname: string }) {
    requireAgent(user);
    const t = findTable(await readSheets(file.buffer, file.originalname), ['date', 'day', 'visitdate']);
    if (!t) throw new BadRequestException('No "Date" column found. Use the template: Date, Outlet.');
    const cd = col(t.keys, ['date', 'day', 'visitdate']); const co = col(t.keys, ['outlet', 'outletname', 'gym', 'gymname', 'store', 'storename', 'name']);
    if (co < 0) throw new BadRequestException('No "Outlet" column found. Use the template: Date, Outlet.');
    const mine = await this.prisma.db.outlet.findMany({ where: { status: 'APPROVED', active: true, deletedAt: null, ...outletsOf(user.id) }, select: { id: true, name: true } });
    const byDay = new Map<string, Set<string>>(); const unmatched: string[] = []; const past: string[] = [];
    for (const r of t.rows) {
      const day = parseDay(r[cd] ?? ''); const nm = (r[co] ?? '').trim(); if (!day || !nm) continue;
      if (day < dateStr(todayManila())) { past.push(`${day} ${nm}`); continue; }
      const o = mine.find((m) => norm(m.name) === norm(nm)); if (!o) { unmatched.push(nm); continue; }
      (byDay.get(day) ?? byDay.set(day, new Set()).get(day)!).add(o.id);
    }
    for (const [day, ids] of byDay) {
      const cur = await this.prisma.db.itinerary.findUnique({ where: { agentKey_planDate: { agentKey: user.id, planDate: toDateOnly(day) } }, include: { stops: true } });
      await this.plan(user, { date: day, outletIds: [...new Set([...(cur?.stops.map((s) => s.outletId) ?? []), ...ids])] });
    }
    return { days: byDay.size, stops: [...byDay.values()].reduce((n, s) => n + s.size, 0), unmatched: [...new Set(unmatched)], past, message: unmatched.length ? 'Some outlets are not in your approved list: upload them under Outlets and ask the Sales Manager to approve.' : undefined };
  }

  /** Reports one stop. Visited: a photo is uploaded first and the phone's location is sent; missed: the reason. */
  async report(user: SessionUser, stopId: string, input: ReportInput) {
    requireAgent(user);
    const stop = await this.prisma.db.itineraryStop.findUnique({ where: { id: stopId }, include: { itinerary: true, outlet: true } });
    if (!stop || stop.itinerary.agentKey !== user.id) throw new NotFoundException('Stop not found');
    if (stop.itinerary.reportSubmittedAt) throw new BadRequestException('The report for this day was already submitted');
    if (dateStr(stop.itinerary.planDate) > dateStr(todayManila())) throw new BadRequestException('You can report a visit on its day');
    const data: Prisma.ItineraryStopUpdateInput = { status: input.status, note: input.note?.trim() || null };
    if (input.status === 'MISSED') { need(input.note, 'Type why the store was not visited'); data.visitedAt = null; data.lat = null; data.lng = null; }
    else {
      if (!(await this.prisma.db.attachment.count({ where: { documentType: 'ItineraryStop', documentId: stopId, contentType: { startsWith: 'image/' } } }))) throw new BadRequestException('Upload the photo of the store first');
      if (input.lat == null || input.lng == null) throw new BadRequestException('Allow location on your phone: the visit needs your location');
      if (input.shelfStatus && !(SHELF as readonly string[]).includes(input.shelfStatus)) throw new BadRequestException('Unknown shelf status');
      Object.assign(data, { visitedAt: new Date(), lat: input.lat, lng: input.lng, shelfStatus: input.shelfStatus || null, competitors: input.competitors?.trim() || null });
    }
    await this.prisma.db.itineraryStop.update({ where: { id: stopId }, data });
    if (input.status === 'VISITED') {
      await this.outlets.advance(stop.outletId, 'VISITED');
      if (stop.outlet.lat == null) await this.prisma.db.outlet.update({ where: { id: stop.outletId }, data: { lat: input.lat, lng: input.lng } });
    }
    return this.load(stop.itineraryId);
  }

  /** Closes the day: every store must be reported. */
  async submit(user: SessionUser, date: string) {
    requireAgent(user);
    const it = await this.prisma.db.itinerary.findUnique({ where: { agentKey_planDate: { agentKey: user.id, planDate: toDateOnly(date) } }, include: { stops: true } });
    if (!it || !it.stops.length) throw new BadRequestException('There is no itinerary for this day');
    const open = it.stops.filter((s) => s.status === 'PLANNED').length;
    if (open) throw new BadRequestException(`${open} store${open > 1 ? 's' : ''} not reported yet: mark each one visited (with a photo) or missed (with the reason)`);
    await this.prisma.db.itinerary.update({ where: { id: it.id }, data: { reportSubmittedAt: new Date() } });
    return this.load(it.id);
  }

  // ── claims ──
  async addClaim(user: SessionUser, input: { date: string; kind: string; amount: number; note?: string }) {
    requireAgent(user);
    if (!(CLAIM_KINDS as readonly string[]).includes(input.kind)) throw new BadRequestException('Choose the kind of claim');
    if (!(input.amount > 0)) throw new BadRequestException('The amount must be more than zero');
    const me = await this.outlets.me(user);
    const it = await this.prisma.db.itinerary.upsert({ where: { agentKey_planDate: { agentKey: user.id, planDate: toDateOnly(input.date) } }, create: { agentKey: user.id, agentName: me.name, planDate: toDateOnly(input.date), createdBy: user.id }, update: {} });
    const c = await this.prisma.db.itineraryClaim.create({ data: { itineraryId: it.id, kind: input.kind, amount: input.amount.toFixed(2), note: input.note?.trim() || null, createdBy: user.id } });
    await this.notify.toRoles(['SALES_MANAGER'], { type: 'AGENT_CLAIM', title: `${me.name} claims ${peso(input.amount)} (${input.kind.toLowerCase()}) for ${input.date}`, link: '/field?tab=claims' });
    return c;
  }
  async claims(user: SessionUser, q: { status?: string; from?: string; to?: string }) {
    const where: Prisma.ItineraryClaimWhereInput = { status: q.status || undefined, itinerary: { agentKey: canViewAll(user) ? undefined : user.id, planDate: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined } };
    if (!canViewAll(user)) requireAgent(user);
    const rows = await this.prisma.db.itineraryClaim.findMany({ where, include: { itinerary: { select: { agentName: true, planDate: true, _count: { select: { stops: true } } } } }, orderBy: { createdAt: 'desc' }, take: 300 });
    const receipts = await photosFor(this.prisma, 'ItineraryClaim', rows.map((r) => r.id));
    return rows.map((r) => ({ id: r.id, agentName: r.itinerary.agentName, date: dateStr(r.itinerary.planDate), stores: r.itinerary._count.stops, kind: r.kind, amount: Number(r.amount), note: r.note, status: r.status, receipts: receipts.get(r.id) ?? [] }));
  }
  async decideClaim(user: SessionUser, id: string, action: 'APPROVE' | 'REJECT', reason?: string) {
    if (!isManager(user)) throw new ForbiddenException();
    const c = await this.prisma.db.itineraryClaim.findUnique({ where: { id }, include: { itinerary: true } });
    if (!c || c.status !== 'PENDING') throw new BadRequestException('This claim was already decided');
    if (action === 'REJECT' && !reason?.trim()) throw new BadRequestException('Type the reason for rejecting');
    await this.prisma.db.itineraryClaim.update({ where: { id }, data: { status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: user.id, decidedAt: new Date(), note: action === 'REJECT' ? `${c.note ?? ''} [Not approved: ${reason}]`.trim() : c.note } });
    const key = c.itinerary.agentKey;
    if (!key.startsWith('name:')) await this.notify.toUsers([key], { type: 'AGENT_CLAIM', title: `Your ${c.kind.toLowerCase()} claim of ${peso(c.amount)} for ${dateStr(c.itinerary.planDate)} was ${action === 'APPROVE' ? 'approved' : `not approved: ${reason}`}`, link: '/field' });
    if (action === 'APPROVE') await this.notify.toRoles(['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_HEAD'], { type: 'AGENT_CLAIM', title: `Pay ${c.itinerary.agentName} ${peso(c.amount)}: ${c.kind.toLowerCase()} claim for ${dateStr(c.itinerary.planDate)} approved by ${user.fullName}`, link: '/field?tab=claims' });
    return { ok: true };
  }

  // ── monitoring board ──
  /** Per agent: days with an itinerary, stores planned / visited / missed / not reported, claims; and each day's stops with photos. */
  async board(user: SessionUser, q: { from?: string; to?: string; agentKey?: string }) {
    const to = q.to ?? dateStr(todayManila()); const from = q.from ?? dateStr(new Date(toDateOnly(to).getTime() - 6 * 86400000));
    const key = canViewAll(user) ? q.agentKey : (requireAgent(user), user.id);
    const its = await this.prisma.db.itinerary.findMany({ where: { agentKey: key, planDate: { gte: toDateOnly(from), lte: toDateOnly(to) } }, include: { stops: { include: { outlet: { select: { id: true, name: true, city: true } } }, orderBy: { seq: 'asc' } }, claims: true }, orderBy: [{ planDate: 'desc' }, { agentName: 'asc' }] });
    const photos = await photosFor(this.prisma, 'ItineraryStop', its.flatMap((i) => i.stops.map((s) => s.id)));
    const today = dateStr(todayManila());
    const days = its.map((i) => ({ id: i.id, agentKey: i.agentKey, agentName: i.agentName, date: dateStr(i.planDate), submitted: !!i.reportSubmittedAt, claims: i.claims.reduce((t, c) => t + Number(c.amount), 0), stops: i.stops.map((s) => ({ id: s.id, outletId: s.outletId, outletName: s.outlet.name, city: s.outlet.city, status: s.status === 'PLANNED' && dateStr(i.planDate) < today ? 'NOT_REPORTED' : s.status, note: s.note, visitedAt: s.visitedAt, lat: s.lat, lng: s.lng, shelfStatus: s.shelfStatus, competitors: s.competitors, photos: photos.get(s.id) ?? [] })) }));
    const byAgent = new Map<string, { agentKey: string; agentName: string; days: number; planned: number; visited: number; missed: number; notReported: number; claims: number }>();
    for (const d of days) {
      const a = byAgent.get(d.agentKey) ?? { agentKey: d.agentKey, agentName: d.agentName, days: 0, planned: 0, visited: 0, missed: 0, notReported: 0, claims: 0 };
      a.days++; a.planned += d.stops.length; a.visited += d.stops.filter((s) => s.status === 'VISITED').length; a.missed += d.stops.filter((s) => s.status === 'MISSED').length; a.notReported += d.stops.filter((s) => s.status === 'NOT_REPORTED').length; a.claims += d.claims; byAgent.set(d.agentKey, a);
    }
    return { from, to, agents: [...byAgent.values()].map((a) => ({ ...a, visitRate: a.planned ? Math.round((a.visited / a.planned) * 1000) / 10 : null })).sort((a, b) => a.agentName.localeCompare(b.agentName)), days };
  }
}
