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
import { toDateOnly, todayManila, addDays } from '../common/manila';
import { D, ZERO } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

/** §7.7 Actual inventory count → DiscrepancyCase (7-day window) → Final report + ChargeForm → HR allocation. */
@Injectable()
export class CountsService implements OnModuleInit {
  constructor(private prisma: PrismaService, private seq: SequenceService, private stock: StockService, private approvals: ApprovalsService, private notify: NotificationsService, private audit: AuditService, private settings: SettingsService, private master: MasterService, private posting: PostingService) {}

  onModuleInit() { this.approvals.register('DISCREPANCY_RESOLUTION', (req, outcome, actor) => this.onResolutionDecision(req.documentId, outcome, actor?.id ?? null)); }

  private include = { location: { select: { id: true, code: true, name: true } }, lines: { include: { product: { select: { id: true, sku: true, name: true } } }, orderBy: { product: { name: 'asc' as const } } }, discrepancyCase: true } as const;

  list(user: SessionUser, locationId?: string) { if (locationId && user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException(); return this.prisma.db.countDoc.findMany({ where: { locationId: locationId ?? (user.locationScoped ? { in: user.locationIds } : { not: '' }) }, include: this.include, orderBy: { createdAt: 'desc' }, take: 200 }); }
  async get(id: string, user: SessionUser) { const d = await this.prisma.db.countDoc.findUnique({ where: { id }, include: this.include }); if (!d) throw new NotFoundException(); if (user.locationScoped && !user.locationIds.includes(d.locationId)) throw new ForbiddenException(); return d; }

  /** Snapshot system qty for every product with balance (or every active product when `allProducts`). */
  async create(input: { locationId?: string; countDate?: string; notes?: string; allProducts?: boolean }, user: SessionUser) {
    const locationId = input.locationId ?? user.locationIds[0];
    if (!locationId) throw new BadRequestException('locationId required');
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    const balances = await this.prisma.db.stockBalance.groupBy({ by: ['productId'], where: { locationId }, _sum: { qty: true } });
    const productIds = input.allProducts ? (await this.prisma.db.product.findMany({ where: { active: true, isBundle: false }, select: { id: true } })).map((p) => p.id) : balances.map((b) => b.productId);
    const doc = await this.prisma.db.$transaction(async (tx) => {
      const controlNo = await this.seq.next(tx, 'CNT', { locationId, locationCode: loc.code });
      return tx.countDoc.create({ data: { controlNo, locationId, countDate: input.countDate ? toDateOnly(input.countDate) : todayManila(), countedBy: user.id, notes: input.notes, createdBy: user.id, lines: { create: productIds.map((productId) => ({ productId, systemQty: balances.find((b) => b.productId === productId)?._sum.qty ?? 0 })) } }, include: this.include });
    });
    await this.audit.log({ action: 'CREATE', entityType: 'CountDoc', entityId: doc.id, after: { controlNo: doc.controlNo, lines: doc.lines.length } });
    return doc;
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
    const missing = doc.lines.filter((l) => l.actualQty == null);
    if (missing.length) throw new BadRequestException(`${missing.length} line(s) have no actual qty`);
    const windowDays = await this.settings.get<number>('discrepancy.window_days');
    const result = await this.prisma.db.$transaction(async (tx) => {
      let anyVar = false;
      for (const l of doc.lines) { const v = (l.actualQty ?? 0) - l.systemQty; if (v !== 0) anyVar = true; await tx.countLine.update({ where: { id: l.id }, data: { variance: v } }); }
      await tx.countDoc.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
      if (!anyVar) return { anyVar, caseId: null as string | null };
      const c = await tx.discrepancyCase.create({ data: { countDocId: id, deadline: addDays(todayManila(), windowDays) } });
      return { anyVar, caseId: c.id };
    });
    if (result.caseId) {
      await this.notify.toLocation(doc.locationId, { type: 'DISCREPANCY_OPENED', title: `Inventory discrepancy at ${doc.location.name} (${doc.controlNo}) — ${windowDays}-day window`, link: `/discrepancies/${result.caseId}` }, ['HEAD_AUDITOR', 'ADMIN', 'HR_STAFF']);
    }
    await this.audit.log({ action: 'SUBMIT', entityType: 'CountDoc', entityId: id, after: result });
    return this.get(id, user);
  }

  // ── Discrepancy cases ──
  cases(user: SessionUser, status?: string) { return this.prisma.db.discrepancyCase.findMany({ where: { status: status as never, countDoc: { locationId: user.locationScoped ? { in: user.locationIds } : { not: '' } } }, include: { countDoc: { include: { location: { select: { code: true, name: true } } } }, chargeForm: { select: { id: true, controlNo: true, totalAmount: true, finalizedByHrAt: true } } }, orderBy: { createdAt: 'desc' } }); }
  async getCase(id: string, user: SessionUser) {
    const c = await this.prisma.db.discrepancyCase.findUnique({ where: { id }, include: { countDoc: { include: this.include }, chargeForm: { include: { lines: { include: { product: { select: { sku: true, name: true } } } }, allocations: { include: { employee: { select: { id: true, employeeNo: true, fullName: true } } } } } } } });
    if (!c) throw new NotFoundException(); if (user.locationScoped && !user.locationIds.includes(c.countDoc.locationId)) throw new ForbiddenException();
    const linked = { sales: await this.prisma.db.salesDoc.count({ where: { discrepancyCaseId: id } }), transfers: await this.prisma.db.transferDoc.count({ where: { discrepancyCaseId: id } }), approvals: await this.prisma.db.approvalRequest.findMany({ where: { discrepancyCaseId: id } }) };
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
    let n = 0;
    for (const c of due) {
      await requestContext.runSystem(async () => {
        const shorts = c.countDoc.lines.filter((l) => l.variance < 0);
        const chargeForm = await this.prisma.db.$transaction(async (tx) => {
          const controlNo = await this.seq.next(tx, 'CHG', { prefix: 'CHG' });
          let total = ZERO; const lines = [];
          for (const l of shorts) {
            const unitCharge = D(await this.master.priceFor(l.productId, 'FRANCHISE', c.countDoc.countDate, tx) ?? 0);
            const cost = D(await this.master.costFor(l.productId, c.countDoc.countDate, tx) ?? 0);
            const amount = unitCharge.mul(-l.variance); total = total.plus(amount);
            lines.push({ productId: l.productId, qty: -l.variance, unitCharge: unitCharge.toFixed(2), batchCost: cost.toFixed(2), amount: amount.toFixed(2) });
          }
          const cf = await tx.chargeForm.create({ data: { controlNo, locationId: c.countDoc.locationId, discrepancyCaseId: c.id, totalAmount: total.toFixed(2), lines: { create: lines } } });
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
  chargeForms(user: SessionUser) { return this.prisma.db.chargeForm.findMany({ where: user.locationScoped ? { locationId: { in: user.locationIds } } : {}, include: { location: { select: { code: true, name: true } }, allocations: { include: { employee: { select: { fullName: true, employeeNo: true } } } } }, orderBy: { createdAt: 'desc' } }); }
  async chargeForm(id: string) { const cf = await this.prisma.db.chargeForm.findUnique({ where: { id }, include: { location: true, lines: { include: { product: { select: { sku: true, name: true } } } }, allocations: { include: { employee: { select: { id: true, employeeNo: true, fullName: true } } } } } }); if (!cf) throw new NotFoundException(); return cf; }
  async createManualChargeForm(input: { locationId: string; reason: string; lines: { productId: string; qty: number; unitCharge: number }[] }, user: SessionUser) {
    return this.prisma.db.$transaction(async (tx) => {
      const controlNo = await this.seq.next(tx, 'CHG', { prefix: 'CHG' });
      const total = input.lines.reduce((s, l) => s.plus(D(l.unitCharge).mul(l.qty)), ZERO);
      return tx.chargeForm.create({ data: { controlNo, locationId: input.locationId, reason: input.reason, totalAmount: total.toFixed(2), createdBy: user.id, lines: { create: input.lines.map((l) => ({ productId: l.productId, qty: l.qty, unitCharge: D(l.unitCharge).toFixed(2), amount: D(l.unitCharge).mul(l.qty).toFixed(2) })) } } });
    });
  }
  async allocate(id: string, allocations: { employeeId: string; amount: number }[], schedule: { periods: number } | undefined, user: SessionUser) {
    const cf = await this.chargeForm(id);
    if (cf.finalizedByHrAt) throw new BadRequestException('Charge form already finalized');
    const total = allocations.reduce((s, a) => s.plus(a.amount), ZERO);
    if (!total.equals(cf.totalAmount)) throw new BadRequestException(`Allocations (${total}) must equal total ${cf.totalAmount}`);
    await this.prisma.db.$transaction([
      this.prisma.db.chargeFormAllocation.deleteMany({ where: { chargeFormId: id } }),
      this.prisma.db.chargeFormAllocation.createMany({ data: allocations.map((a) => ({ chargeFormId: id, employeeId: a.employeeId, amount: D(a.amount).toFixed(2) })) }),
      this.prisma.db.chargeForm.update({ where: { id }, data: { payrollDeductionSchedule: schedule ? allocations.map((a) => ({ employeeId: a.employeeId, periods: schedule.periods, perPeriod: D(a.amount).div(schedule.periods).toDecimalPlaces(2).toNumber() })) : undefined } }),
    ]);
    return this.chargeForm(id);
  }
  async finalize(id: string, user: SessionUser) {
    const cf = await this.chargeForm(id);
    if (cf.finalizedByHrAt) throw new BadRequestException('Already finalized');
    if (!cf.allocations.length) throw new BadRequestException('Add allocations first');
    const lines = await this.prisma.db.chargeFormLine.findMany({ where: { chargeFormId: id }, include: { product: { include: { category: true } } } });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.chargeForm.update({ where: { id }, data: { finalizedByHrAt: new Date(), finalizedBy: user.id } });
      await this.posting.post(tx, { type: 'ChargeForm', id, date: todayManila(), createdBy: user.id }, (r) => r11ChargeForm(r, { locationId: cf.locationId, controlNo: cf.controlNo, lines: lines.map((l) => ({ accountingClass: l.product.category.accountingClass, qty: l.qty, unitCharge: l.unitCharge, batchCost: l.batchCost ?? 0 })), allocations: cf.allocations.map((a) => ({ employeeId: a.employeeId, amount: a.amount })) }));
    });
    await this.audit.log({ action: 'FINALIZE', entityType: 'ChargeForm', entityId: id });
    return this.chargeForm(id);
  }
}
