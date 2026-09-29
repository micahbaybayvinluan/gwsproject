import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { StockService } from '../stock/stock.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { MasterService } from '../master/master.service';
import { PostingService } from '../gl/posting.service';
import { r11ChargeForm } from '../gl/posting-rules';
import { ChargesService, KIND_LABEL } from '../charges/charges.service';
import { RevisionsService } from '../revisions/revisions.service';
import { toDateOnly, todayManila, addDays, dateStr } from '../common/manila';
import { D, ZERO } from '../common/money';
import type { RoleKey } from '../common/permissions';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

interface RevisionSummary { controlNo: string; locationId: string; locationName: string; reason: string; requestedByName: string; lines: { productId: string; product: string; before: number; after: number; remarks?: string }[] }

/** Items with a system quantity (at the start of the day or now) first, then items with none in the system; by name within each group. */
export const inSystem = (l: { beginQty: number; systemQty: number }) => l.beginQty !== 0 || l.systemQty !== 0;
export function sortCountLines<T extends { beginQty: number; systemQty: number; product: { name: string } }>(lines: T[]): T[] {
  return [...lines].sort((a, b) => Number(inSystem(b)) - Number(inSystem(a)) || a.product.name.localeCompare(b.product.name));
}

/** §7.7 Actual inventory count → DiscrepancyCase (7-day window) → Final report + ChargeForm → HR allocation. */
@Injectable()
export class CountsService implements OnModuleInit {
  constructor(private prisma: PrismaService, private seq: SequenceService, private stock: StockService, private approvals: ApprovalsService, private notify: NotificationsService, private audit: AuditService, private settings: SettingsService, private master: MasterService, private charges: ChargesService, private posting: PostingService, private revisions: RevisionsService) {}

  onModuleInit() {
    this.approvals.register('DISCREPANCY_RESOLUTION', (req, outcome, actor) => this.onResolutionDecision(req.documentId, outcome, actor?.id ?? null));
    this.approvals.register('DISCREPANCY_EXPLANATION', (req, outcome, actor) => this.onExplanationDecision(req.documentId, req.summary as { explanation: string; controlNo: string; locationName: string; locationId: string }, outcome, actor?.id ?? null));
    this.approvals.register('COUNT_REVISION', (req, outcome, actor) => this.onRevisionDecision(req.documentId, req.summary as RevisionSummary, outcome, actor?.id ?? null));
  }

  /**
   * A submitted count sheet cannot be edited. The person who counted (or the Head Auditor) asks for a revision with the corrected
   * actual quantities and a reason; only the Head Auditor approves it, and the Owner/Admin is notified of the request and the outcome.
   */
  async requestRevision(id: string, lines: { productId: string; actualQty: number; remarks?: string }[], reason: string, user: SessionUser) {
    const doc = await this.get(id, user);
    if (doc.status === 'DRAFT') throw new BadRequestException('This count is still a draft; just edit it');
    if (doc.countedBy !== user.id && !user.permissions.has('approval.act.COUNT_REVISION')) throw new ForbiddenException('Only the person who counted can ask for a revision');
    if (doc.discrepancyCase?.status === 'FINALIZED') throw new BadRequestException('The discrepancy for this count is already finalized; a revision is no longer possible');
    const pending = await this.prisma.db.approvalRequest.findFirst({ where: { type: 'COUNT_REVISION', documentId: id, status: 'PENDING' } });
    if (pending) throw new BadRequestException('A revision of this count is already waiting for the Head Auditor');
    const changes = lines.map((l) => { const line = doc.lines.find((x) => x.productId === l.productId); if (!line) throw new BadRequestException('Product is not on this count sheet'); return { productId: l.productId, product: line.product.name, before: line.actualQty ?? 0, after: l.actualQty, remarks: l.remarks }; }).filter((c) => c.before !== c.after || c.remarks);
    if (!changes.length) throw new BadRequestException('Nothing changed');
    const summary: RevisionSummary = { controlNo: doc.controlNo, locationId: doc.locationId, locationName: doc.location.name, reason, requestedByName: user.fullName, lines: changes };
    const req = await this.approvals.request({ type: 'COUNT_REVISION', documentType: 'CountDoc', documentId: id, requestedBy: user.id, summary });
    await this.notify.toRoles(['ADMIN'], { type: 'COUNT_REVISION_REQUESTED', title: `Count ${doc.controlNo} (${doc.location.name}): revision requested by ${user.fullName}`, body: `${reason} — waiting for the Head Auditor`, link: `/counts/${id}` });
    await this.audit.log({ action: 'REVISION_REQUESTED', entityType: 'CountDoc', entityId: id, after: summary });
    return req;
  }
  private async onRevisionDecision(id: string, s: RevisionSummary, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      if (outcome === 'APPROVED') {
        const doc = await this.prisma.db.countDoc.findUniqueOrThrow({ where: { id }, include: { lines: true, discrepancyCase: true, location: true } });
        if (doc.discrepancyCase?.status === 'FINALIZED') throw new BadRequestException('Discrepancy already finalized');
        const windowDays = await this.settings.get<number>('discrepancy.window_days');
        await this.prisma.db.$transaction(async (tx) => {
          for (const c of s.lines) { const l = doc.lines.find((x) => x.productId === c.productId)!; await tx.countLine.update({ where: { id: l.id }, data: { actualQty: c.after, variance: c.after - l.systemQty, remarks: c.remarks ?? l.remarks } }); }
          const any = (await tx.countLine.count({ where: { docId: id, variance: { not: 0 } } })) > 0;
          if (any && !doc.discrepancyCase) await tx.discrepancyCase.create({ data: { countDocId: id, caseNo: await this.seq.form(tx, 'DC', doc.locationId), deadline: addDays(todayManila(), windowDays) } });
          if (!any && doc.discrepancyCase?.status === 'OPEN') await tx.discrepancyCase.update({ where: { id: doc.discrepancyCase.id }, data: { status: 'RESOLVED', resolutionNote: 'All variances cleared by an approved count revision' } as never });
        });
        await this.audit.log({ action: 'REVISED', entityType: 'CountDoc', entityId: id, userId: actorId, after: s });
        await this.revisions.record({ source: 'COUNT_REVISION', documentType: 'CountDoc', documentId: id, controlNo: s.controlNo, locationId: s.locationId, staffUserId: doc.countedBy, requestedBy: doc.countedBy, approvedBy: actorId, reason: s.reason, changes: s.lines, link: `/counts/${id}` });
      }
      await this.notify.toRoles(['ADMIN', 'HR_STAFF'], { type: 'COUNT_REVISION_DECIDED', title: `Count ${s.controlNo} (${s.locationName}) revision ${outcome === 'APPROVED' ? 'approved' : 'rejected'} by the Head Auditor`, link: `/counts/${id}` });
    });
  }

  private include = { location: { select: { id: true, code: true, name: true, type: true } }, lines: { include: { product: { select: { id: true, sku: true, name: true } } }, orderBy: { product: { name: 'asc' as const } } }, discrepancyCase: true } as const;

  list(user: SessionUser, locationId?: string) { if (locationId && user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException(); return this.prisma.db.countDoc.findMany({ where: { locationId: locationId ?? (user.locationScoped ? { in: user.locationIds } : { not: '' }) }, include: this.include, orderBy: { createdAt: 'desc' }, take: 200 }); }
  async get(id: string, user: SessionUser) {
    const d = await this.prisma.db.countDoc.findUnique({ where: { id }, include: this.include }); if (!d) throw new NotFoundException(); if (user.locationScoped && !user.locationIds.includes(d.locationId)) throw new ForbiddenException();
    // expiries on hand per item (same item, different expiry dates) shown on the sheet for reference
    const exp = await this.stock.expiriesAt(d.locationId, d.lines.map((l) => l.productId));
    // the count day's movements from the beginning count: in, out, other → expected (owner request 2026-09-29)
    const moves = await this.stock.dayMovements(d.locationId, d.countDate);
    const zero = { received: 0, transferIn: 0, returns: 0, sales: 0, transferOut: 0, other: 0 };
    return { ...d, lines: sortCountLines(d.lines).map((l) => { const m = moves.get(l.productId) ?? zero; return { ...l, expiries: exp.get(l.productId) ?? [], moves: m, expectedFromDay: l.beginQty + m.received + m.transferIn + m.returns - m.sales - m.transferOut + m.other }; }) };
  }

  /**
   * Count sheet pre-filled by the system (owner request 2026-09-26): every product that had stock at the location at the start of the
   * count date, has stock now, or moved today — with its beginning count (start of day) and the expected count now. The counter only
   * types the actual quantity. `allProducts` lists every active product instead.
   */
  async create(input: { locationId?: string; countDate?: string; notes?: string; allProducts?: boolean; countType?: 'AUDIT' | 'WEEKLY' }, user: SessionUser) {
    const locationId = input.locationId ?? user.locationIds[0];
    if (!locationId) throw new BadRequestException('locationId required');
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    // branch staff count their own stock weekly; auditors' counts are audit counts (they open discrepancy cases)
    const countType = input.countType ?? (user.roleKey === 'SALES_ASSOCIATE' || user.roleKey === 'WAREHOUSE_ASSOCIATE' ? 'WEEKLY' : 'AUDIT');
    if (countType === 'AUDIT' && ['SALES_ASSOCIATE', 'WAREHOUSE_ASSOCIATE', 'FRANCHISE_SALES_ASSOCIATE'].includes(user.roleKey)) throw new ForbiddenException('Branch staff submit weekly count sheets; audit counts are done by the auditors');
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    const countDate = input.countDate ? toDateOnly(input.countDate) : todayManila();
    const { begin, now, moved } = await this.expected(locationId, countDate);
    // every active item is listed (owner request 2026-09-27) so stock that never reached the system can still be counted; `allProducts: false` lists only items with stock or movement
    const ids = input.allProducts ?? true
      ? (await this.prisma.db.product.findMany({ where: { active: true, isBundle: false }, select: { id: true } })).map((p) => p.id)
      : [...new Set([...[...begin].filter(([, q]) => q !== 0).map(([id]) => id), ...[...now].filter(([, q]) => q !== 0).map(([id]) => id), ...moved])];
    const doc = await this.prisma.db.$transaction(async (tx) => {
      const controlNo = await this.seq.form(tx, 'IC', locationId);
      return tx.countDoc.create({ data: { controlNo, countType, locationId, countDate, countedBy: user.id, notes: input.notes, createdBy: user.id, lines: { create: ids.map((productId) => ({ productId, beginQty: begin.get(productId) ?? 0, systemQty: now.get(productId) ?? 0 })) } }, include: this.include });
    });
    await this.audit.log({ action: 'CREATE', entityType: 'CountDoc', entityId: doc.id, after: { controlNo: doc.controlNo, lines: doc.lines.length } });
    return this.get(doc.id, user);
  }

  /** Beginning count (ledger before the date), current on-hand, and products with movements on the date. */
  private async expected(locationId: string, date: Date) {
    const beginRows = await this.prisma.db.$queryRaw<{ product_id: string; qty: bigint }[]>`SELECT product_id, COALESCE(SUM(qty_delta),0)::bigint qty FROM stock_ledger WHERE location_id=${locationId} AND business_date < ${date}::date GROUP BY product_id`;
    const nowRows = await this.prisma.db.stockBalance.groupBy({ by: ['productId'], where: { locationId }, _sum: { qty: true } });
    const movedRows = await this.prisma.db.stockLedger.findMany({ where: { locationId, businessDate: date }, select: { productId: true }, distinct: ['productId'] });
    return { begin: new Map(beginRows.map((r) => [r.product_id, Number(r.qty)])), now: new Map(nowRows.map((r) => [r.productId, r._sum.qty ?? 0])), moved: new Set(movedRows.map((r) => r.productId)) };
  }
  async enter(id: string, lines: { productId: string; actualQty: number; remarks?: string }[], user: SessionUser) {
    const doc = await this.get(id, user);
    if (doc.status !== 'DRAFT') throw new BadRequestException('Count already submitted');
    for (const l of lines) {
      const line = doc.lines.find((x) => x.productId === l.productId);
      if (line) await this.prisma.db.countLine.update({ where: { id: line.id }, data: { actualQty: l.actualQty, variance: l.actualQty - line.systemQty, remarks: l.remarks } });
      else await this.prisma.db.countLine.create({ data: { docId: id, productId: l.productId, systemQty: 0, actualQty: l.actualQty, variance: l.actualQty, remarks: l.remarks } });
    }
    return this.get(id, user);
  }
  /** Submit: refresh system snapshot (count is as of now), compute variances, open case if any ≠ 0. */
  async submit(id: string, user: SessionUser) {
    const doc = await this.get(id, user);
    if (doc.status !== 'DRAFT') throw new BadRequestException('Already submitted');
    // items not in the system left blank were not found (0); items the system has must be counted
    const blankNotInSystem = doc.lines.filter((l) => l.actualQty == null && !inSystem(l));
    if (blankNotInSystem.length) await this.prisma.db.countLine.updateMany({ where: { id: { in: blankNotInSystem.map((l) => l.id) } }, data: { actualQty: 0, variance: 0 } });
    for (const l of blankNotInSystem) l.actualQty = 0;
    const missing = doc.lines.filter((l) => l.actualQty == null);
    if (missing.length) throw new BadRequestException(`${missing.length} item(s) in the system have no actual count yet`);
    const windowDays = await this.settings.get<number>('discrepancy.window_days');
    // expected = on-hand at submission, so sales / transfers made while counting are not reported as shortages
    const { now } = await this.expected(doc.locationId, doc.countDate);
    const result = await this.prisma.db.$transaction(async (tx) => {
      let anyVar = false;
      for (const l of doc.lines) { const expected = now.get(l.productId) ?? 0; const v = (l.actualQty ?? 0) - expected; if (v !== 0) anyVar = true; await tx.countLine.update({ where: { id: l.id }, data: { systemQty: expected, variance: v } }); }
      await tx.countDoc.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
      // any count with a difference — weekly count by the associate, Field Auditor or auditor count — opens a case with the explanation window (owner request 2026-09-27)
      if (!anyVar) return { anyVar, caseId: null as string | null };
      const c = await tx.discrepancyCase.create({ data: { countDocId: id, caseNo: await this.seq.form(tx, 'DC', doc.locationId), deadline: addDays(todayManila(), windowDays) } });
      return { anyVar, caseId: c.id };
    });
    if (result.caseId) {
      const fresh = await this.prisma.db.countLine.findMany({ where: { docId: id, variance: { not: 0 } }, include: { product: { select: { name: true } } } });
      const summary = fresh.slice(0, 5).map((l) => `${l.product.name} ${l.variance > 0 ? '+' : ''}${l.variance}`).join(', ') + (fresh.length > 5 ? ` and ${fresh.length - 5} more` : '');
      // the branch staff (and franchise owner), the person who counted, the auditors, the Owner and HR (company branches only: franchise staff are the franchise owner's)
      const roles: RoleKey[] = ['HEAD_AUDITOR', 'ASST_AUDITOR', 'AUDIT_ASSOCIATE', 'ADMIN', ...(doc.location.type === 'FRANCHISE' ? [] : ['HR_STAFF' as RoleKey])];
      const n = { type: 'DISCREPANCY_OPENED', title: `Inventory discrepancy at ${doc.location.name} (${doc.controlNo}): ${fresh.length} item(s) — explain within ${windowDays} days`, body: `${doc.countType === 'WEEKLY' ? 'Weekly count' : 'Count'} by ${user.fullName}. ${summary}. Without an accepted explanation by the deadline, shortages are charged at franchise price.`, link: `/discrepancies/${result.caseId}` };
      await this.notify.toLocation(doc.locationId, n, roles);
      await this.notify.toUsers([user.id], n);
    }
    if (doc.countType === 'WEEKLY' && !result.caseId) {
      const vars = await this.prisma.db.countLine.findMany({ where: { docId: id, variance: { not: 0 } }, include: { product: { select: { name: true } } } });
      await this.notify.toRoles(['HEAD_AUDITOR', 'ASST_AUDITOR', 'AUDIT_ASSOCIATE'], { type: 'WEEKLY_COUNT_SUBMITTED', title: `Weekly count ${doc.controlNo} submitted by ${user.fullName} (${doc.location.name})`, body: vars.length ? `${vars.length} item(s) differ: ${vars.slice(0, 5).map((l) => `${l.product.name} ${l.variance > 0 ? '+' : ''}${l.variance}`).join(', ')}${vars.length > 5 ? '…' : ''}` : 'All items match the system', link: `/counts/${id}` });
    }
    await this.audit.log({ action: 'SUBMIT', entityType: 'CountDoc', entityId: id, after: result });
    return this.get(id, user);
  }

  /** Monday (Manila) of the week containing `d`. */
  static weekStart(d: Date) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const dow = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - dow); return x; }

  /** This week's weekly count status for the signed-in associate (dashboard alarm). */
  async myWeekly(user: SessionUser) {
    const start = CountsService.weekStart(todayManila()); const end = addDays(start, 6);
    const loc = user.locationScoped ? { locationId: { in: user.locationIds } } : { locationId: { not: '' } };
    const done = await this.prisma.db.countDoc.findFirst({ where: { ...loc, countType: 'WEEKLY', countedBy: user.id, status: { not: 'DRAFT' }, countDate: { gte: start, lte: end } }, orderBy: { submittedAt: 'desc' } });
    const draft = done ? null : await this.prisma.db.countDoc.findFirst({ where: { ...loc, countType: 'WEEKLY', countedBy: user.id, status: 'DRAFT', countDate: { gte: start, lte: end } } });
    return { weekStart: dateStr(start), dueDate: dateStr(end), daysLeft: Math.round((end.getTime() - todayManila().getTime()) / 86400000), submitted: !!done, submittedAt: done?.submittedAt ?? null, countId: done?.id ?? draft?.id ?? null, draft: !!draft };
  }

  /** HR / auditors: who submitted the required weekly count sheet, week by week (branch associates). */
  async weeklyCompliance(weeks = 8) {
    const thisWeek = CountsService.weekStart(todayManila());
    const starts = Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -7 * (weeks - 1 - i)));
    const staff = await this.prisma.db.user.findMany({ where: { active: true, role: { key: { in: ['SALES_ASSOCIATE', 'WAREHOUSE_ASSOCIATE'] } } }, select: { id: true, fullName: true, username: true, idNumber: true, role: { select: { name: true } }, assignments: { select: { location: { select: { name: true } } } } }, orderBy: { fullName: 'asc' } });
    const counts = await this.prisma.db.countDoc.findMany({ where: { locationId: { not: '' }, countType: 'WEEKLY', status: { not: 'DRAFT' }, countDate: { gte: starts[0] }, countedBy: { in: staff.map((u) => u.id) } }, select: { id: true, controlNo: true, countedBy: true, countDate: true, submittedAt: true } });
    const rows = staff.map((u) => {
      const cells = starts.map((st) => { const en = addDays(st, 6); const c = counts.find((x) => x.countedBy === u.id && x.countDate >= st && x.countDate <= en); return { weekStart: dateStr(st), submitted: !!c, controlNo: c?.controlNo ?? null, countId: c?.id ?? null, submittedAt: c?.submittedAt ?? null, current: st.getTime() === thisWeek.getTime() }; });
      const past = cells.filter((c) => !c.current);
      return { userId: u.id, name: u.fullName, username: u.username, idNumber: u.idNumber, role: u.role.name, branch: u.assignments.map((a) => a.location.name).join(', '), weeks: cells, missed: past.filter((c) => !c.submitted).length, compliancePct: past.length ? Math.round((past.filter((c) => c.submitted).length / past.length) * 100) : 100 };
    });
    return { weeks: starts.map((d) => dateStr(d)), rows };
  }

  // ── Discrepancy cases ──
  cases(user: SessionUser, status?: string) { return this.prisma.db.discrepancyCase.findMany({ where: { status: status as never, countDoc: { locationId: user.locationScoped ? { in: user.locationIds } : { not: '' } } }, include: { countDoc: { include: { location: { select: { code: true, name: true } } } }, chargeForm: { select: { id: true, controlNo: true, totalAmount: true, finalizedByHrAt: true } } }, orderBy: { createdAt: 'desc' } }); }
  async getCase(id: string, user: SessionUser) {
    const c = await this.prisma.db.discrepancyCase.findUnique({ where: { id }, include: { countDoc: { include: this.include }, chargeForm: { include: { lines: { include: { product: { select: { sku: true, name: true } } } }, allocations: { include: { employee: { select: { id: true, employeeNo: true, fullName: true } } } } } } } });
    if (!c) throw new NotFoundException(); if (user.locationScoped && !user.locationIds.includes(c.countDoc.locationId)) throw new ForbiddenException();
    const loc = c.countDoc.locationId;
    const linked = { sales: await this.prisma.db.salesDoc.count({ where: { locationId: loc, discrepancyCaseId: id } }), transfers: await this.prisma.db.transferDoc.count({ where: { OR: [{ fromLocationId: loc }, { toLocationId: loc }], discrepancyCaseId: id } }), approvals: await this.prisma.db.approvalRequest.findMany({ where: { discrepancyCaseId: id } }) };
    return { ...c, variances: c.countDoc.lines.filter((l) => l.variance !== 0), linked };
  }
  /** Head Auditor requests to accept the variance as ADJUST_COUNT (approval DISCREPANCY_RESOLUTION) or marks RESOLVED after a fresh matching count. */
  async requestResolution(id: string, mode: 'ADJUST' | 'RESOLVED', note: string, user: SessionUser) {
    const c = await this.getCase(id, user);
    if (c.status !== 'OPEN') throw new BadRequestException('Case is not open');
    if (mode === 'RESOLVED') {
      // require a later count with zero variance for the same location
      const fresh = await this.prisma.db.countDoc.findFirst({ where: { locationId: c.countDoc.locationId, status: 'SUBMITTED', submittedAt: { gt: c.countDoc.submittedAt ?? c.createdAt }, lines: { none: { variance: { not: 0 } } } } });
      if (!fresh) throw new BadRequestException('No later count with zero variance found for this location');
      const r = await this.prisma.db.discrepancyCase.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: user.id, resolutionNote: note } });
      await this.audit.log({ action: 'RESOLVE', entityType: 'DiscrepancyCase', entityId: id, after: r });
      return r;
    }
    const req = await this.approvals.request({ type: 'DISCREPANCY_RESOLUTION', documentType: 'DiscrepancyCase', documentId: id, requestedBy: user.id, discrepancyCaseId: id, summary: { controlNo: c.countDoc.controlNo, locationId: c.countDoc.locationId, locationName: c.countDoc.location.name, note, variances: c.variances.map((v) => ({ product: v.product.name, variance: v.variance })) } });
    return req;
  }
  /**
   * Branch staff explain a discrepancy before the deadline (owner request 2026-09-26). HR is notified; only the Head Auditor decides.
   * Accepted → the variance is adjusted and nobody is charged. Rejected → the case stays open and is charged at the deadline.
   */
  async explain(id: string, explanation: string, user: SessionUser) {
    const c = await this.getCase(id, user);
    if (c.status !== 'OPEN') throw new BadRequestException('This case is no longer open');
    const pending = await this.prisma.db.approvalRequest.findFirst({ where: { type: 'DISCREPANCY_EXPLANATION', documentId: id, status: 'PENDING' } });
    if (pending) throw new BadRequestException('An explanation for this case is already waiting for the Head Auditor');
    const summary = { controlNo: c.countDoc.controlNo, locationId: c.countDoc.locationId, locationName: c.countDoc.location.name, explanation, explainedBy: user.fullName, deadline: dateStr(c.deadline), variances: c.variances.map((v) => ({ product: v.product.name, variance: v.variance })) };
    const req = await this.approvals.request({ type: 'DISCREPANCY_EXPLANATION', documentType: 'DiscrepancyCase', documentId: id, requestedBy: user.id, discrepancyCaseId: id, summary });
    await this.notify.toRoles(['HR_STAFF'], { type: 'DISCREPANCY_EXPLAINED', title: `${user.fullName} explained discrepancy ${c.countDoc.controlNo} (${c.countDoc.location.name})`, body: explanation.slice(0, 200), link: `/discrepancies/${id}` });
    await this.audit.log({ action: 'EXPLAIN', entityType: 'DiscrepancyCase', entityId: id, after: { explanation } });
    return req;
  }
  private async onExplanationDecision(caseId: string, s: { explanation: string; controlNo: string; locationName: string; locationId: string }, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const c = await this.prisma.db.discrepancyCase.findUniqueOrThrow({ where: { id: caseId }, include: { countDoc: { include: { lines: true } } } });
      if (outcome === 'APPROVED' && c.status === 'OPEN') {
        await this.prisma.db.$transaction(async (tx) => {
          for (const l of c.countDoc.lines.filter((x) => x.variance !== 0)) await this.adjust(tx, c.countDoc.locationId, l.productId, l.variance, c.countDoc.id, actorId);
          await tx.discrepancyCase.update({ where: { id: caseId }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: actorId, resolutionNote: `Explanation accepted: ${s.explanation}`.slice(0, 1000) } });
        });
      }
      const msg = outcome === 'APPROVED' ? `Explanation for ${s.controlNo} accepted by the Head Auditor — no charge` : `Explanation for ${s.controlNo} rejected — the shortage will be charged on ${dateStr(c.deadline)}`;
      await this.notify.toLocation(s.locationId, { type: 'DISCREPANCY_EXPLANATION_DECIDED', title: msg, link: `/discrepancies/${caseId}` }, ['HR_STAFF']);
    });
  }

  private async onResolutionDecision(caseId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    if (outcome !== 'APPROVED') return;
    await requestContext.runSystem(async () => {
      const c = await this.prisma.db.discrepancyCase.findUniqueOrThrow({ where: { id: caseId }, include: { countDoc: { include: { lines: true } } } });
      if (c.status !== 'OPEN') return;
      await this.prisma.db.$transaction(async (tx) => {
        for (const l of c.countDoc.lines.filter((x) => x.variance !== 0)) await this.adjust(tx, c.countDoc.locationId, l.productId, l.variance, c.countDoc.id, actorId);
        await tx.discrepancyCase.update({ where: { id: caseId }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: actorId, resolutionNote: 'Variance accepted as ADJUST_COUNT' } });
      });
    });
  }
  /** ADJUST_COUNT rows: negative → FEFO reduce; positive → add to newest batch (or an adjustment batch). */
  private async adjust(tx: import('../common/prisma.service').Tx, locationId: string, productId: string, variance: number, docId: string, actorId: string | null) {
    if (variance < 0) {
      const picks = await this.stock.pickFefo(tx, locationId, productId, -variance, { allowExpired: true });
      await this.stock.post(tx, picks.map((p) => ({ locationId, productId, batchId: p.batchId, qtyDelta: -p.qty, movementType: 'ADJUST_COUNT' as const, documentType: 'CountDoc', documentId: docId, unitCost: p.unitCost, createdBy: actorId ?? undefined })));
    } else {
      let batch = await tx.batch.findFirst({ where: { productId }, orderBy: { createdAt: 'desc' } });
      if (!batch) { const cost = await this.master.costFor(productId, todayManila(), tx); batch = await tx.batch.create({ data: { productId, batchNo: 'ADJ', unitCost: D(cost ?? 0).toFixed(2), receivedRef: docId, createdBy: actorId } }); }
      await this.stock.post(tx, [{ locationId, productId, batchId: batch.id, qtyDelta: variance, movementType: 'ADJUST_COUNT', documentType: 'CountDoc', documentId: docId, unitCost: batch.unitCost, createdBy: actorId ?? undefined }]);
    }
  }

  /** Deadline job: still OPEN → Final Discrepancy Report + ChargeForm at franchise cost; case FINALIZED; HR notified. */
  async finalizeDue(now: Date = new Date()) {
    const due = await this.prisma.db.discrepancyCase.findMany({ where: { status: 'OPEN', deadline: { lte: now } }, include: { countDoc: { include: { lines: { include: { product: { include: { category: true } } } }, location: true } } } });
    // an explanation sent before the deadline waits for the Head Auditor's decision; it is charged only if rejected
    const waiting = new Set((await this.prisma.db.approvalRequest.findMany({ where: { type: 'DISCREPANCY_EXPLANATION', status: 'PENDING', documentId: { in: due.map((c) => c.id) } }, select: { documentId: true } })).map((r) => r.documentId));
    let n = 0;
    for (const c of due.filter((x) => !waiting.has(x.id))) {
      await requestContext.runSystem(async () => {
        const shorts = c.countDoc.lines.filter((l) => l.variance < 0);
        const chargeForm = await this.prisma.db.$transaction(async (tx) => {
          const controlNo = await this.seq.form(tx, 'CF', c.countDoc.locationId);
          let total = ZERO; const lines = [];
          for (const l of shorts) {
            const unitCharge = D(await this.master.priceFor(l.productId, 'FRANCHISE', c.countDoc.countDate, tx) ?? 0);
            const cost = D(await this.master.costFor(l.productId, c.countDoc.countDate, tx) ?? 0);
            const amount = unitCharge.mul(-l.variance); total = total.plus(amount);
            lines.push({ productId: l.productId, qty: -l.variance, unitCharge: unitCharge.toFixed(2), batchCost: cost.toFixed(2), amount: amount.toFixed(2) });
          }
          const cf = await tx.chargeForm.create({ data: { controlNo, kind: 'INVENTORY_DISCREPANCY', sourceType: 'DiscrepancyCase', sourceId: c.id, locationId: c.countDoc.locationId, discrepancyCaseId: c.id, totalAmount: total.toFixed(2), lines: { create: lines } } });
          await tx.discrepancyCase.update({ where: { id: c.id }, data: { status: 'FINALIZED', finalReportGeneratedAt: new Date(), chargeFormId: cf.id } });
          // shortfalls leave the books: ADJUST_COUNT so on-hand matches the count; R11 later moves cost to Advances on HR finalize
          for (const l of c.countDoc.lines.filter((x) => x.variance !== 0)) await this.adjust(tx, c.countDoc.locationId, l.productId, l.variance, c.countDoc.id, null);
          return cf;
        });
        await this.notify.toRoles(['HR_STAFF', 'HEAD_AUDITOR', 'ADMIN'], { type: 'CHARGE_FORM_READY', title: `Charge form ${chargeForm.controlNo} ready for allocation (${c.countDoc.location.name})`, link: `/charge-forms/${chargeForm.id}` });
        await this.notify.toLocation(c.countDoc.locationId, { type: 'DISCREPANCY_FINAL', title: `Final discrepancy report generated for ${c.countDoc.controlNo}`, link: `/discrepancies/${c.id}` });
        n++;
      });
    }
    return { finalized: n };
  }

  // ── Charge forms (HR side) — product cost never serialized: batchCost is stripped by redaction (COST_FIELDS) ──
  /** Who was charged, and how much each, is payroll data: HR, payroll-detail roles and the Head Auditor (who assigns charges) see it; others see totals. */
  private canSeeAllocations(user: SessionUser) { return ['charge_form.finalize', 'payroll.view.detail', 'charge.assign', 'discrepancy.resolve'].some((k) => user.permissions.has(k)); }
  private hideAllocations<T extends { allocations: unknown[] }>(user: SessionUser, cf: T) { return this.canSeeAllocations(user) ? cf : { ...cf, allocations: [], allocationsHidden: cf.allocations.length }; }
  async chargeForms(user: SessionUser, q: { kind?: string; status?: string } = {}) {
    if (user.roleKey === 'FIELD_AUDITOR') throw new ForbiddenException('The Field Auditor sees inventory only');
    const rows = await this.prisma.db.chargeForm.findMany({ where: { ...(user.locationScoped ? { locationId: { in: user.locationIds } } : {}), ...(user.roleKey === 'HR_STAFF' ? { location: { type: { not: 'FRANCHISE' } } } : {}), kind: (q.kind || undefined) as never, finalizedByHrAt: q.status === 'OPEN' ? null : q.status === 'FINALIZED' ? { not: null } : undefined }, include: { location: { select: { code: true, name: true } }, allocations: { include: { employee: { select: { fullName: true, employeeNo: true } } } } }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({ ...this.hideAllocations(user, r), kindLabel: KIND_LABEL[r.kind] }));
  }
  async chargeForm(id: string, user?: SessionUser) {
    if (user?.roleKey === 'FIELD_AUDITOR') throw new ForbiddenException('The Field Auditor sees inventory only');
    const cf = await this.prisma.db.chargeForm.findUnique({ where: { id }, include: { location: true, lines: { include: { product: { select: { sku: true, name: true } } } }, allocations: { include: { employee: { select: { id: true, employeeNo: true, fullName: true } } } } } });
    if (!cf) throw new NotFoundException();
    if (user?.locationScoped && !user.locationIds.includes(cf.locationId)) throw new ForbiddenException();
    if (user?.roleKey === 'HR_STAFF' && cf.location.type === 'FRANCHISE') throw new ForbiddenException('Franchise staff charges are handled by the franchise owner');
    const out = { ...cf, kindLabel: KIND_LABEL[cf.kind] };
    return user ? this.hideAllocations(user, out) : out;
  }
  /** Manual charge (lost equipment, uniform, unreturned item…): product lines at a given unit charge and/or amount-only lines; staff can be named up front. */
  async createManualChargeForm(input: { locationId: string; reason: string; kind?: 'OTHER' | 'DAMAGED' | 'EXPIRED' | 'CASH_SHORTAGE'; lines: { productId?: string; description?: string; qty: number; unitCharge: number }[]; employeeIds?: string[] }, user: SessionUser) {
    if (input.employeeIds?.length) await this.charges.assertEmployees(input.employeeIds);
    for (const l of input.lines) if (!l.productId && !l.description) throw new BadRequestException('Each line needs a product or a description');
    const cf = await this.prisma.db.$transaction(async (tx) => {
      const lines = [];
      for (const l of input.lines) lines.push({ productId: l.productId ?? null, description: l.description ?? null, qty: l.qty, unitCharge: l.unitCharge, batchCost: l.productId ? (await this.master.costFor(l.productId, todayManila(), tx)) ?? 0 : null });
      return this.charges.create(tx, { kind: input.kind ?? 'OTHER', locationId: input.locationId, reason: input.reason, lines, employeeIds: input.employeeIds, createdBy: user.id });
    });
    await this.charges.announce(cf.id);
    return this.chargeForm(cf.id, user);
  }
  async allocate(id: string, allocations: { employeeId: string; amount: number }[], schedule: { periods: number } | undefined, user: SessionUser) {
    const cf = await this.chargeForm(id);
    if (cf.location.type === 'FRANCHISE' && user.roleKey !== 'ADMIN') throw new ForbiddenException('Franchise staff charges are assigned by the franchise owner in the Franchise Portal');
    if (cf.finalizedByHrAt) throw new BadRequestException('Charge form already finalized');
    const total = allocations.reduce((s, a) => s.plus(a.amount), ZERO);
    if (!total.equals(cf.totalAmount)) throw new BadRequestException(`Allocations (${total}) must equal total ${cf.totalAmount}`);
    await this.prisma.db.$transaction([
      this.prisma.db.chargeFormAllocation.deleteMany({ where: { chargeFormId: id } }),
      this.prisma.db.chargeFormAllocation.createMany({ data: allocations.map((a) => ({ chargeFormId: id, employeeId: a.employeeId, amount: D(a.amount).toFixed(2) })) }),
      this.prisma.db.chargeForm.update({ where: { id }, data: { payrollDeductionSchedule: schedule ? allocations.map((a) => ({ employeeId: a.employeeId, periods: schedule.periods, perPeriod: D(a.amount).div(schedule.periods).toDecimalPlaces(2).toNumber() })) : undefined } }),
    ]);
    return this.chargeForm(id, user);
  }
  /** HR clicks Finalize: R11 moves the loss to Advances to Employees; payroll deducts it from the next runs; staff are told. */
  async finalize(id: string, user: SessionUser, schedule?: { periods: number }) {
    const cf = await this.chargeForm(id);
    if (cf.location.type === 'FRANCHISE' && user.roleKey !== 'ADMIN') throw new ForbiddenException('Franchise staff charges are assigned by the franchise owner in the Franchise Portal');
    if (cf.finalizedByHrAt) throw new BadRequestException('Already finalized');
    if (!cf.allocations.length) throw new BadRequestException('Add allocations first');
    const lines = await this.prisma.db.chargeFormLine.findMany({ where: { chargeFormId: id }, include: { product: { include: { category: true } } } });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.chargeForm.update({ where: { id }, data: { finalizedByHrAt: new Date(), finalizedBy: user.id, payrollDeductionSchedule: schedule && !cf.payrollDeductionSchedule ? cf.allocations.map((a) => ({ employeeId: a.employeeId, periods: schedule.periods, perPeriod: D(a.amount).div(schedule.periods).toDecimalPlaces(2).toNumber() })) : undefined } });
      await this.posting.post(tx, { type: 'ChargeForm', id, date: todayManila(), createdBy: user.id }, (r) => r11ChargeForm(r, { locationId: cf.locationId, controlNo: cf.controlNo, kind: cf.kind, lines: lines.map((l) => ({ accountingClass: l.product?.category.accountingClass ?? null, amountOnly: !l.product, qty: l.qty, unitCharge: l.unitCharge, batchCost: l.batchCost ?? 0 })), allocations: cf.allocations.map((a) => ({ employeeId: a.employeeId, amount: a.amount })) }));
    });
    await this.audit.log({ action: 'FINALIZE', entityType: 'ChargeForm', entityId: id });
    const users = (await this.prisma.db.employee.findMany({ where: { id: { in: cf.allocations.map((a) => a.employeeId) } }, select: { userId: true } })).map((e) => e.userId).filter((u): u is string => !!u);
    if (users.length) await this.notify.toUsers(users, { type: 'CHARGE_FINALIZED', title: `Charge ${cf.controlNo} finalized by HR; it will be deducted from payroll`, link: '/my-hr' });
    return this.chargeForm(id, user);
  }
}
