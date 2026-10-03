import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SequenceService } from '../common/sequence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AlertsService } from '../alerts/alerts.service';
import { ReceivingService } from '../receiving/receiving.service';
import { PdfService } from '../reports/pdf.service';
import { dateStr, manilaDateStr, todayManila, toDateOnly } from '../common/manila';
import { requestContext, type SessionUser } from '../common/request-context';
import { planProduct, type PlanLoc } from './restock-plan';

export interface GenerateInput { supplierIds?: string[]; basisDays?: number; coverDays?: number; reserveDays?: number; surplusDays?: number }
export interface PoUpdate { notes?: string | null; expectedOn?: string | null; lines?: { lineId: string; orderQty?: number; note?: string | null; rows?: { rowId: string; transferQty?: number; transferFromId?: string | null; allocQty?: number }[] }[]; removeLineIds?: string[] }
const OPEN = ['SUBMITTED', 'APPROVED', 'SENT', 'PARTIAL'];
const num = (x: unknown) => Number(x ?? 0);
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const nat = (v: unknown, what: string) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new BadRequestException(`${what} must be a whole number, 0 or more`); return n; };

/**
 * Restocking and purchase orders (owner request 2026-10-08).
 * The Head Auditor generates a request: one purchase order per supplier, from the stock and the days of stock of the warehouse and every branch. For each item it suggests
 * (a) what to move from EXISTING stock to the branches that run short (before buying), and (b) how many to order. The Head Auditor can change every number; the Owner may
 * change them too and approves. The supplier's copy shows the quantities only; the Head Auditor / Owner copy and the Warehouse In-Charge copy show the branches.
 * After approval the branches are told what to pull out; the Head Auditor is told which transfers to make and sends the order. A delivery linked to the order updates it.
 */
@Injectable()
export class RestockService implements OnModuleInit {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private notify: NotificationsService, private approvals: ApprovalsService, private alerts: AlertsService, private receiving: ReceivingService, private pdf: PdfService) {}

  onModuleInit() {
    this.approvals.register('PURCHASE_ORDER', (r, outcome, actor) => this.onDecision(r.documentId, outcome, actor?.id ?? null, actor?.note), 'PurchaseOrder');
    this.receiving.onPosted((docId) => this.onReceivingPosted(docId));
  }

  private link(id: string) { return `/purchase-orders/${id}`; }
  private assertManage(user: SessionUser) { if (!user.permissions.has('po.manage')) throw new ForbiddenException('Only the Head Auditor and the Owner handle purchase orders'); }

  // ── generate ──
  async generate(user: SessionUser, i: GenerateInput) {
    this.assertManage(user);
    const basisDays = Math.min(180, Math.max(7, Math.round(i.basisDays ?? 30))); const coverDays = Math.min(180, Math.max(7, Math.round(i.coverDays ?? 30)));
    const reserveDays = Math.min(60, Math.max(0, Math.round(i.reserveDays ?? 7))); const surplusDays = Math.min(365, Math.max(coverDays, Math.round(i.surplusDays ?? Math.max(60, coverDays * 2))));
    const locs = await this.prisma.db.location.findMany({ where: { active: true, type: { in: ['WAREHOUSE', 'BRANCH'] } }, select: { id: true, name: true, type: true } });
    const typeOf = new Map(locs.map((l) => [l.id, l.type as 'WAREHOUSE' | 'BRANCH']));
    const days = await this.alerts.daysOfStock(user, { days: basisDays, cover: coverDays });
    const byProduct = new Map<string, PlanLoc[]>();
    for (const r of days.rows) { const t = typeOf.get(r.location.id); if (!t) continue; const a = byProduct.get(r.product.id) ?? []; a.push({ id: r.location.id, type: t, onHand: r.onHand, avgPerDay: r.avgPerDay }); byProduct.set(r.product.id, a); }
    const products = await this.prisma.db.product.findMany({ where: { id: { in: [...byProduct.keys()] }, active: true, isBundle: false }, select: { id: true, supplierId: true } });
    const supplierOf = new Map(products.map((p) => [p.id, p.supplierId]));
    const open = await this.prisma.db.purchaseOrderLine.findMany({ where: { po: { status: { in: OPEN } } }, select: { productId: true, orderQty: true, receivedQty: true } });
    const onOrder = new Map<string, number>(); for (const l of open) onOrder.set(l.productId, (onOrder.get(l.productId) ?? 0) + Math.max(0, l.orderQty - l.receivedQty));
    const wh = locs.find((l) => l.type === 'WAREHOUSE');
    type Built = { productId: string; plan: ReturnType<typeof planProduct>; onOrder: number };
    const per = new Map<string, Built[]>(); let unassigned = 0;
    for (const [productId, ls] of byProduct) {
      if (!supplierOf.has(productId)) continue;
      const plan = planProduct(ls, { coverDays, reserveDays, surplusDays, onOrder: onOrder.get(productId) ?? 0 });
      const moves = plan.rows.some((r) => r.transferQty > 0);
      if (plan.suggestedOrder <= 0 && !moves) continue;
      const sid = supplierOf.get(productId);
      if (!sid) { unassigned++; continue; }
      if (i.supplierIds?.length && !i.supplierIds.includes(sid)) continue;
      const a = per.get(sid) ?? []; a.push({ productId, plan, onOrder: onOrder.get(productId) ?? 0 }); per.set(sid, a);
    }
    const created: { id: string; poNo: string; supplierId: string; lines: number }[] = [];
    for (const [supplierId, items] of per) {
      const year = todayManila().getUTCFullYear();
      const po = await this.prisma.db.$transaction(async (tx) => {
        const n = await this.seq.next(tx, 'PURCHASE_ORDER', { locationId: String(year), year, prefix: 'PO', pad: 4 });
        const no = Number(/(\d+)$/.exec(n)![1]);
        return tx.purchaseOrder.create({ data: { poNo: `PO-${year}-${String(no).padStart(4, '0')}`, supplierId, basisDays, coverDays, reserveDays, deliverToId: wh?.id ?? null, createdBy: user.id, createdByName: user.fullName,
          lines: { create: items.map((x) => ({ productId: x.productId, whOnHand: x.plan.warehouse.onHand, whAvgPerDay: x.plan.warehouse.avgPerDay.toFixed(3), onOrder: x.onOrder, suggestedQty: x.plan.suggestedOrder, orderQty: x.plan.suggestedOrder,
            rows: { create: x.plan.rows.filter((r) => r.onHand > 0 || r.avgPerDay > 0).map((r) => ({ locationId: r.locationId, onHand: r.onHand, avgPerDay: r.avgPerDay.toFixed(3), daysLeft: r.daysLeft == null ? null : r.daysLeft.toFixed(1), need: r.need, suggestedTransfer: r.transferQty, transferFromId: r.transferFromId, transferQty: r.transferQty, suggestedAlloc: r.allocQty, allocQty: r.allocQty })) } })) } } });
      });
      created.push({ id: po.id, poNo: po.poNo, supplierId, lines: items.length });
      await this.audit.log({ action: 'CREATE', entityType: 'PurchaseOrder', entityId: po.id, after: { poNo: po.poNo, supplierId, lines: items.length, basisDays, coverDays } });
    }
    return { created, unassigned, basisDays, coverDays, reserveDays };
  }

  // ── read ──
  private async shape(pos: Prisma.PurchaseOrderGetPayload<{ include: { lines: { include: { rows: true } } } }>[], user: SessionUser, full: boolean) {
    const sup = await this.prisma.db.supplier.findMany({ where: { id: { in: [...new Set(pos.map((p) => p.supplierId))] } }, select: { id: true, code: true, name: true, contact: true, termsDays: true } });
    const canName = user.permissions.has('supplier.view.name');
    const prodIds = [...new Set(pos.flatMap((p) => p.lines.map((l) => l.productId)))];
    const prods = await this.prisma.db.product.findMany({ where: { id: { in: prodIds } }, select: { id: true, sku: true, name: true, brand: true } });
    const locs = await this.prisma.db.location.findMany({ select: { id: true, name: true, type: true } });
    const ln = (id: string | null) => (id ? locs.find((l) => l.id === id)?.name ?? '' : '');
    return pos.map((p) => {
      const s = sup.find((x) => x.id === p.supplierId);
      const lines = p.lines.map((l) => { const pr = prods.find((x) => x.id === l.productId); return {
        id: l.id, productId: l.productId, sku: pr?.sku ?? '', product: pr?.name ?? '', brand: pr?.brand ?? null, whOnHand: l.whOnHand, whAvgPerDay: num(l.whAvgPerDay), whDaysLeft: num(l.whAvgPerDay) > 0 ? Math.round((l.whOnHand / num(l.whAvgPerDay)) * 10) / 10 : null, onOrder: l.onOrder, suggestedQty: l.suggestedQty, orderQty: l.orderQty, receivedQty: l.receivedQty, note: l.note,
        rows: full ? l.rows.map((r) => ({ id: r.id, locationId: r.locationId, branch: ln(r.locationId), onHand: r.onHand, avgPerDay: num(r.avgPerDay), daysLeft: r.daysLeft == null ? null : num(r.daysLeft), need: r.need, suggestedTransfer: r.suggestedTransfer, transferFromId: r.transferFromId, transferFrom: ln(r.transferFromId), transferQty: r.transferQty, suggestedAlloc: r.suggestedAlloc, allocQty: r.allocQty })).sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9)) : [] }; }).sort((a, b) => a.product.localeCompare(b.product));
      return { id: p.id, poNo: p.poNo, status: p.status, supplier: { id: p.supplierId, code: s?.code ?? '', name: canName ? s?.name ?? '' : null, contact: canName ? s?.contact ?? null : null, termsDays: s?.termsDays ?? 0 }, basisDays: p.basisDays, coverDays: p.coverDays, reserveDays: p.reserveDays, deliverTo: ln(p.deliverToId), approvalRequestId: p.approvalRequestId, expectedOn: p.expectedOn ? dateStr(p.expectedOn) : null, notes: p.notes, createdBy: p.createdByName, createdAt: p.createdAt, submittedAt: p.submittedAt, approvedAt: p.approvedAt, sentAt: p.sentAt, receivedAt: p.receivedAt, cancelReason: p.cancelReason, rejectNote: p.rejectNote,
        totals: { items: lines.length, orderQty: lines.reduce((t, l) => t + l.orderQty, 0), receivedQty: lines.reduce((t, l) => t + l.receivedQty, 0), transferQty: lines.reduce((t, l) => t + l.rows.reduce((a, r) => a + r.transferQty, 0), 0) }, lines, locations: locs.filter((l) => l.type === 'BRANCH' || l.type === 'WAREHOUSE').map((l) => ({ id: l.id, name: l.name })) };
    });
  }
  async list(user: SessionUser, q: { status?: string; supplierId?: string }) {
    if (!user.permissions.has('po.view') && !user.permissions.has('po.manage')) throw new ForbiddenException();
    const rows = await this.prisma.db.purchaseOrder.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.supplierId ? { supplierId: q.supplierId } : {}) }, include: { lines: { include: { rows: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return this.shape(rows, user, false);
  }
  async get(user: SessionUser, id: string) {
    if (!user.permissions.has('po.view') && !user.permissions.has('po.manage')) throw new ForbiddenException();
    const p = await this.prisma.db.purchaseOrder.findUnique({ where: { id }, include: { lines: { include: { rows: true } } } }); if (!p) throw new NotFoundException();
    return (await this.shape([p], user, true))[0];
  }
  /** Orders waiting for their delivery (to link a supplier delivery to one). */
  async openFor(user: SessionUser, supplierId?: string) {
    const rows = await this.prisma.db.purchaseOrder.findMany({ where: { status: { in: ['SENT', 'PARTIAL'] }, ...(supplierId ? { supplierId } : {}) }, include: { lines: { include: { rows: true } } }, orderBy: { createdAt: 'desc' } });
    return (await this.shape(rows, user, false)).map((p) => ({ id: p.id, poNo: p.poNo, supplierId: p.supplier.id, status: p.status, expectedOn: p.expectedOn, orderQty: p.totals.orderQty, receivedQty: p.totals.receivedQty }));
  }

  // ── edit ──
  private async editable(user: SessionUser, id: string) {
    const p = await this.prisma.db.purchaseOrder.findUnique({ where: { id } }); if (!p) throw new NotFoundException();
    const admin = user.roleKey === 'ADMIN';
    if (!(p.status === 'DRAFT' || (p.status === 'SUBMITTED' && admin))) throw new BadRequestException(p.status === 'SUBMITTED' ? 'Only the Owner changes an order that waits for approval' : 'This order can no longer be changed');
    return p;
  }
  async update(user: SessionUser, id: string, dto: PoUpdate) {
    this.assertManage(user); const p = await this.editable(user, id);
    await this.prisma.db.$transaction(async (tx) => {
      if (dto.removeLineIds?.length) await tx.purchaseOrderLine.deleteMany({ where: { poId: id, id: { in: dto.removeLineIds } } });
      for (const l of dto.lines ?? []) {
        const line = await tx.purchaseOrderLine.findFirst({ where: { id: l.lineId, poId: id } }); if (!line) throw new BadRequestException('Unknown line');
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { ...(l.orderQty !== undefined ? { orderQty: nat(l.orderQty, 'The order quantity') } : {}), ...(l.note !== undefined ? { note: l.note?.trim() || null } : {}) } });
        for (const r of l.rows ?? []) {
          const row = await tx.purchaseOrderRow.findFirst({ where: { id: r.rowId, lineId: line.id } }); if (!row) throw new BadRequestException('Unknown row');
          if (r.transferFromId) { const f = await tx.location.findFirst({ where: { id: r.transferFromId, active: true, type: { in: ['WAREHOUSE', 'BRANCH'] } } }); if (!f) throw new BadRequestException('Choose a warehouse or branch to transfer from'); if (f.id === row.locationId) throw new BadRequestException('A branch cannot transfer to itself'); }
          await tx.purchaseOrderRow.update({ where: { id: row.id }, data: { ...(r.transferQty !== undefined ? { transferQty: nat(r.transferQty, 'The transfer quantity') } : {}), ...(r.transferFromId !== undefined ? { transferFromId: r.transferFromId || null } : {}), ...(r.allocQty !== undefined ? { allocQty: nat(r.allocQty, 'The branch share') } : {}) } });
        }
      }
      await tx.purchaseOrder.update({ where: { id }, data: { ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}), ...(dto.expectedOn !== undefined ? { expectedOn: dto.expectedOn ? toDateOnly(dto.expectedOn) : null } : {}) } });
    });
    // a branch's transfer with no source is not allowed
    const bad = await this.prisma.db.purchaseOrderRow.findFirst({ where: { line: { poId: id }, transferQty: { gt: 0 }, transferFromId: null } });
    if (bad) throw new BadRequestException('A transfer needs the place it comes from');
    await this.audit.log({ action: 'UPDATE', entityType: 'PurchaseOrder', entityId: id, after: { by: user.id, status: p.status } });
    return this.get(user, id);
  }
  /** A product that the suggestion did not list. */
  async addLine(user: SessionUser, id: string, i: { productId: string; orderQty: number }) {
    this.assertManage(user); const p = await this.editable(user, id);
    const prod = await this.prisma.db.product.findFirst({ where: { id: i.productId, active: true, supplierId: p.supplierId }, select: { id: true } }); if (!prod) throw new BadRequestException('That product is not supplied by this supplier');
    if (await this.prisma.db.purchaseOrderLine.findUnique({ where: { poId_productId: { poId: id, productId: i.productId } } })) throw new BadRequestException('Already on the order');
    await this.prisma.db.purchaseOrderLine.create({ data: { poId: id, productId: i.productId, orderQty: nat(i.orderQty, 'The order quantity'), note: 'Added by hand' } });
    return this.get(user, id);
  }

  // ── workflow ──
  async submit(user: SessionUser, id: string) {
    this.assertManage(user);
    const p = await this.prisma.db.purchaseOrder.findUnique({ where: { id }, include: { lines: { include: { rows: true } } } }); if (!p) throw new NotFoundException();
    if (p.status !== 'DRAFT') throw new BadRequestException('Only a draft is submitted');
    if (!p.lines.some((l) => l.orderQty > 0)) throw new BadRequestException('Nothing is being ordered: enter at least one quantity (or cancel the order)');
    await this.prisma.db.purchaseOrder.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date(), rejectNote: null } });
    if (user.roleKey === 'ADMIN') { await this.approve(id, user.id); return this.get(user, id); }
    const sup = await this.prisma.db.supplier.findUnique({ where: { id: p.supplierId }, select: { code: true } });
    const req = await requestContext.runSystem(() => this.approvals.request({ type: 'PURCHASE_ORDER', documentType: 'PurchaseOrder', documentId: id, requestedBy: user.id, summary: { controlNo: p.poNo, locationName: `Supplier ${sup?.code ?? ''}`, total: String(p.lines.reduce((t, l) => t + l.orderQty, 0)), step: `Purchase order ${p.poNo}: ${p.lines.filter((l) => l.orderQty > 0).length} item(s), ${p.lines.reduce((t, l) => t + l.orderQty, 0)} pieces to order, ${p.lines.reduce((t, l) => t + l.rows.reduce((a, r) => a + r.transferQty, 0), 0)} pieces to move from existing stock. You may change the quantities first. Approve = the Head Auditor sends it to the supplier and the branches are told what to pull out.` } }));
    await this.prisma.db.purchaseOrder.update({ where: { id }, data: { approvalRequestId: req.id } });
    await this.audit.log({ action: 'SUBMIT', entityType: 'PurchaseOrder', entityId: id });
    return this.get(user, id);
  }
  private async onDecision(id: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null, note?: string) {
    const p = await this.prisma.db.purchaseOrder.findUnique({ where: { id } }); if (!p || p.status !== 'SUBMITTED') return;
    if (outcome === 'APPROVED') { await this.approve(id, actorId); return; }
    await this.prisma.db.purchaseOrder.update({ where: { id }, data: { status: 'DRAFT', rejectNote: note ?? 'Not approved' } });
    await this.notify.toUsers([p.createdBy], { type: 'PO_REJECTED', title: `The Owner did not approve ${p.poNo}${note ? `: ${note}` : ''}. Change it and submit again.`, link: this.link(id) });
  }
  private async lineText(id: string) {
    const p = await this.prisma.db.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: { include: { rows: true } } } });
    const prods = new Map((await this.prisma.db.product.findMany({ where: { id: { in: p.lines.map((l) => l.productId) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    const locs = new Map((await this.prisma.db.location.findMany({ select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    return { p, prods, locs };
  }
  private async approve(id: string, actorId: string | null) {
    await this.prisma.db.purchaseOrder.update({ where: { id }, data: { status: 'APPROVED', approvedBy: actorId, approvedAt: new Date() } });
    const { p, prods, locs } = await this.lineText(id);
    const moves = p.lines.flatMap((l) => l.rows.filter((r) => r.transferQty > 0 && r.transferFromId).map((r) => `${r.transferQty} × ${prods.get(l.productId)}: ${locs.get(r.transferFromId!)} → ${locs.get(r.locationId)}`));
    await this.notify.toRoles(['HEAD_AUDITOR'], { type: 'PO_APPROVED', title: `${p.poNo} was approved by the Owner: send it to the supplier${moves.length ? ' and have the transfers from existing stock made' : ''}`, body: moves.slice(0, 12).join(' · ') || undefined, link: this.link(id) });
    await this.notify.toRoles(['WAREHOUSE_IN_CHARGE'], { type: 'PO_APPROVED', title: `${p.poNo} approved: print the Warehouse copy (branches) and prepare the pull-outs`, body: moves.slice(0, 12).join(' · ') || undefined, link: this.link(id) });
    await this.tellBranches(id, 'PLAN');
    await this.audit.log({ action: 'APPROVE', entityType: 'PurchaseOrder', entityId: id, after: { by: actorId } });
  }
  /** Each branch is told what it will get and to create the pull-out form: PLAN = at approval (transfers from existing stock now), ARRIVED = the order came in (its share). */
  private async tellBranches(id: string, when: 'PLAN' | 'ARRIVED') {
    const { p, prods, locs } = await this.lineText(id);
    const byBranch = new Map<string, { now: string[]; share: string[] }>();
    for (const l of p.lines) for (const r of l.rows) {
      const e = byBranch.get(r.locationId) ?? { now: [], share: [] };
      if (r.transferQty > 0 && r.transferFromId) e.now.push(`${r.transferQty} × ${prods.get(l.productId)} (from ${locs.get(r.transferFromId)})`);
      if (r.allocQty > 0) e.share.push(`${r.allocQty} × ${prods.get(l.productId)}`);
      byBranch.set(r.locationId, e);
    }
    for (const [loc, e] of byBranch) {
      const parts = when === 'PLAN' ? (e.now.length ? [`Move to you now from existing stock: ${e.now.join('; ')}`] : []).concat(e.share.length ? [`Coming with the order ${p.poNo}: ${e.share.join('; ')}`] : []) : (e.share.length ? [`The order ${p.poNo} arrived. Your share: ${e.share.join('; ')}`] : []);
      if (!parts.length) continue;
      await this.notify.toLocation(loc, { type: 'PO_BRANCH_PLAN', title: when === 'PLAN' ? `Restock plan ${p.poNo} for ${locs.get(loc)}: create the pull-out form for what you will receive` : `${p.poNo} arrived: create the pull-out form for your share`, body: parts.join(' · ').slice(0, 480), link: '/restock-plan' });
    }
  }
  /** The Owner (or the Head Auditor) tells the Head Auditor and the warehouse which transfers from existing stock to make, and the branches to expect them. */
  async informTransfers(user: SessionUser, id: string) {
    this.assertManage(user);
    const { p, prods, locs } = await this.lineText(id);
    if (['CANCELLED', 'RECEIVED'].includes(p.status)) throw new BadRequestException('This order is closed');
    const moves = p.lines.flatMap((l) => l.rows.filter((r) => r.transferQty > 0 && r.transferFromId).map((r) => `${r.transferQty} × ${prods.get(l.productId)}: ${locs.get(r.transferFromId!)} → ${locs.get(r.locationId)}`));
    if (!moves.length) throw new BadRequestException('There are no transfers on this order');
    const n = { type: 'PO_TRANSFERS', title: `${user.fullName} asks for transfers from existing stock before the restock (${p.poNo}): ${moves.length} move(s)`, body: moves.slice(0, 15).join(' · '), link: this.link(id) };
    await this.notify.toRoles(['HEAD_AUDITOR', 'WAREHOUSE_IN_CHARGE'], n);
    await this.tellBranches(id, 'PLAN');
    await this.audit.log({ action: 'INFORM_TRANSFERS', entityType: 'PurchaseOrder', entityId: id, after: { moves: moves.length } });
    return { informed: true, moves: moves.length };
  }
  async markSent(user: SessionUser, id: string, expectedOn?: string | null) {
    this.assertManage(user);
    const p = await this.prisma.db.purchaseOrder.findUnique({ where: { id } }); if (!p) throw new NotFoundException();
    if (p.status !== 'APPROVED') throw new BadRequestException('Only an approved order is sent to the supplier');
    await this.prisma.db.purchaseOrder.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), sentBy: user.id, expectedOn: expectedOn ? toDateOnly(expectedOn) : p.expectedOn } });
    await this.notify.toRoles(['WAREHOUSE_IN_CHARGE', 'ADMIN'], { type: 'PO_SENT', title: `${p.poNo} was sent to the supplier${expectedOn ? `, expected ${expectedOn}` : ''}. When it arrives, receive it under Supplier Deliveries and choose this order.`, link: this.link(id) });
    await this.audit.log({ action: 'SEND', entityType: 'PurchaseOrder', entityId: id });
    return this.get(user, id);
  }
  async cancel(user: SessionUser, id: string, reason: string) {
    this.assertManage(user);
    const p = await this.prisma.db.purchaseOrder.findUnique({ where: { id } }); if (!p) throw new NotFoundException();
    if (['CANCELLED', 'RECEIVED'].includes(p.status)) throw new BadRequestException('This order is already closed');
    if (!reason?.trim()) throw new BadRequestException('Give the reason');
    await this.prisma.db.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason.trim() } });
    await this.notify.toRoles(['HEAD_AUDITOR', 'ADMIN', 'WAREHOUSE_IN_CHARGE'], { type: 'PO_CANCELLED', title: `${p.poNo} was cancelled: ${reason.trim()}`, link: this.link(id) });
    await this.audit.log({ action: 'CANCEL', entityType: 'PurchaseOrder', entityId: id, after: { reason } });
    return this.get(user, id);
  }

  // ── delivery ──
  /** A delivery linked to the order adds what arrived; the order is partly or fully received, and the branches are told when it is complete. */
  private async onReceivingPosted(docId: string) {
    await requestContext.runSystem(async () => {
      const doc = await this.prisma.db.receivingDoc.findUnique({ where: { id: docId }, include: { lines: true } }); if (!doc?.purchaseOrderId) return;
      const p = await this.prisma.db.purchaseOrder.findUnique({ where: { id: doc.purchaseOrderId }, include: { lines: true } }); if (!p || ['CANCELLED', 'RECEIVED'].includes(p.status)) return;
      for (const l of p.lines) { const got = doc.lines.filter((x) => x.productId === l.productId).reduce((t, x) => t + x.qty, 0); if (got > 0) await this.prisma.db.purchaseOrderLine.update({ where: { id: l.id }, data: { receivedQty: l.receivedQty + got } }); }
      const after = await this.prisma.db.purchaseOrderLine.findMany({ where: { poId: p.id } });
      const complete = after.filter((l) => l.orderQty > 0).every((l) => l.receivedQty >= l.orderQty);
      await this.prisma.db.purchaseOrder.update({ where: { id: p.id }, data: { status: complete ? 'RECEIVED' : 'PARTIAL', receivedAt: complete ? new Date() : null } });
      await this.notify.toRoles(['HEAD_AUDITOR', 'ADMIN'], { type: 'PO_RECEIVED', title: `${p.poNo}: a delivery arrived (${doc.controlNo}); the order is ${complete ? 'complete' : 'partly received'}`, link: this.link(p.id) });
      if (complete) await this.tellBranches(p.id, 'ARRIVED');
    });
  }

  // ── what a branch should expect ──
  async branchPlan(user: SessionUser) {
    const locs = user.locationScoped ? user.locationIds : null;
    const rows = await this.prisma.db.purchaseOrderRow.findMany({ where: { OR: [{ transferQty: { gt: 0 } }, { allocQty: { gt: 0 } }], ...(locs ? { locationId: { in: locs } } : {}), line: { po: { status: { in: ['APPROVED', 'SENT', 'PARTIAL', 'RECEIVED'] } } } }, include: { line: { include: { po: true } } }, orderBy: { id: 'asc' }, take: 800 });
    const prods = new Map((await this.prisma.db.product.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.line.productId))] } }, select: { id: true, sku: true, name: true } })).map((p) => [p.id, p]));
    const names = new Map((await this.prisma.db.location.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]));
    const out = new Map<string, { poId: string; poNo: string; status: string; expectedOn: string | null; branch: string; transfers: unknown[]; share: unknown[] }>();
    for (const r of rows) {
      const k = `${r.line.poId}:${r.locationId}`; const e = out.get(k) ?? { poId: r.line.poId, poNo: r.line.po.poNo, status: r.line.po.status, expectedOn: r.line.po.expectedOn ? dateStr(r.line.po.expectedOn) : null, branch: names.get(r.locationId) ?? '', transfers: [], share: [] };
      const pr = prods.get(r.line.productId);
      if (r.transferQty > 0) e.transfers.push({ sku: pr?.sku, product: pr?.name, qty: r.transferQty, from: names.get(r.transferFromId ?? '') ?? '' });
      if (r.allocQty > 0) e.share.push({ sku: pr?.sku, product: pr?.name, qty: r.allocQty, received: r.line.po.status === 'RECEIVED' });
      out.set(k, e);
    }
    return [...out.values()].sort((a, b) => b.poNo.localeCompare(a.poNo));
  }

  // ── printing ──
  /** SUPPLIER: items and quantities only (no branches, no stock). INTERNAL: Head Auditor / Owner, with every branch. WAREHOUSE: what each branch gets, for the Warehouse In-Charge. */
  async print(user: SessionUser, id: string, copy: 'SUPPLIER' | 'INTERNAL' | 'WAREHOUSE') {
    if (copy === 'WAREHOUSE' ? !(user.permissions.has('po.view') || user.permissions.has('po.manage')) : !user.permissions.has('po.manage')) throw new ForbiddenException();
    const po = await this.get(user, id);
    const lh = await this.pdf.letterheadHtml(); const today = manilaDateStr();
    const supName = po.supplier.name ?? po.supplier.code;
    const head = `${lh}<h1 style="font-size:18px;margin:6px 0">PURCHASE ORDER ${esc(po.poNo)}${copy === 'SUPPLIER' ? '' : copy === 'INTERNAL' ? ' <span style="font-size:11px;font-weight:400">· internal copy (Head Auditor / Owner)</span>' : ' <span style="font-size:11px;font-weight:400">· warehouse copy</span>'}</h1>
<table class="meta"><tr><td><b>Supplier:</b> ${esc(supName)} (${esc(po.supplier.code)})${po.supplier.contact ? `<br>${esc(po.supplier.contact)}` : ''}</td><td><b>Date:</b> ${today}<br><b>Deliver to:</b> ${esc(po.deliverTo || 'Warehouse')}${po.expectedOn ? `<br><b>Expected:</b> ${esc(po.expectedOn)}` : ''}${po.supplier.termsDays ? `<br><b>Terms:</b> ${po.supplier.termsDays} days` : ''}</td></tr></table>`;
    const lines = po.lines.filter((l) => l.orderQty > 0 || (copy !== 'SUPPLIER' && l.rows.some((r) => r.transferQty > 0)));
    let body = '';
    if (copy === 'SUPPLIER') {
      body = `<table class="t"><tr><th>#</th><th>SKU</th><th>Item</th><th class="n">Quantity</th></tr>${lines.filter((l) => l.orderQty > 0).map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.sku)}</td><td>${esc(l.product)}${l.note && l.note !== 'Added by hand' ? ` <i>(${esc(l.note)})</i>` : ''}</td><td class="n">${l.orderQty}</td></tr>`).join('')}<tr><td colspan="3" class="n"><b>Total pieces</b></td><td class="n"><b>${po.totals.orderQty}</b></td></tr></table>${po.notes ? `<p><b>Notes:</b> ${esc(po.notes)}</p>` : ''}<div class="sig"><div class="line"></div>Authorized signature<br><span class="muted">Get Wheysted Supplements</span></div>`;
    } else if (copy === 'INTERNAL') {
      body = lines.map((l) => `<h3>${esc(l.sku)} · ${esc(l.product)} <span class="muted">— order ${l.orderQty} (suggested ${l.suggestedQty}${l.onOrder ? `, already on order ${l.onOrder}` : ''}); warehouse has ${l.whOnHand}${l.whDaysLeft != null ? ` (${l.whDaysLeft} days)` : ''}</span></h3>
<table class="t"><tr><th>Branch</th><th class="n">On hand</th><th class="n">Avg / day</th><th class="n">Days left</th><th class="n">Needs</th><th class="n">Move from existing stock</th><th>From</th><th class="n">From this order</th></tr>${l.rows.map((r) => `<tr><td>${esc(r.branch)}</td><td class="n">${r.onHand}</td><td class="n">${r.avgPerDay}</td><td class="n">${r.daysLeft ?? '—'}</td><td class="n">${r.need}</td><td class="n">${r.transferQty || ''}</td><td>${esc(r.transferFrom)}</td><td class="n">${r.allocQty || ''}</td></tr>`).join('')}</table>`).join('') + `<p><b>Total to order: ${po.totals.orderQty} pieces. Total to move from existing stock: ${po.totals.transferQty} pieces.</b></p>${po.notes ? `<p><b>Notes:</b> ${esc(po.notes)}</p>` : ''}`;
    } else {
      const branches = new Map<string, { name: string; moves: string[]; share: string[] }>();
      for (const l of po.lines) for (const r of l.rows) { const e = branches.get(r.locationId) ?? { name: r.branch, moves: [], share: [] }; if (r.transferQty > 0) e.moves.push(`<tr><td>${esc(l.sku)} ${esc(l.product)}</td><td class="n">${r.transferQty}</td><td>${esc(r.transferFrom)}</td></tr>`); if (r.allocQty > 0) e.share.push(`<tr><td>${esc(l.sku)} ${esc(l.product)}</td><td class="n">${r.allocQty}</td></tr>`); branches.set(r.locationId, e); }
      body = [...branches.values()].filter((b) => b.moves.length || b.share.length).map((b) => `<h3>${esc(b.name)}</h3>${b.moves.length ? `<table class="t"><tr><th>Pull out now from existing stock</th><th class="n">Qty</th><th>From</th></tr>${b.moves.join('')}</table>` : ''}${b.share.length ? `<table class="t"><tr><th>Its share of this order when it arrives</th><th class="n">Qty</th></tr>${b.share.join('')}</table>` : ''}`).join('') || '<p>No branch pull-outs on this order.</p>';
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111}table{border-collapse:collapse;width:100%;margin:6px 0}.t th{background:#FFF200;border:1px solid #222;padding:4px 6px;text-align:left;font-size:10px;text-transform:uppercase}.t td{border:1px solid #222;padding:3px 6px}.n{text-align:right}.meta td{vertical-align:top;padding:4px 0;width:50%}h3{font-size:12px;margin:12px 0 2px}.muted{color:#555;font-weight:400}.sig{margin-top:50px;width:240px}.sig .line{border-bottom:1px solid #222;height:30px}</style></head><body>${head}${body}</body></html>`;
    const out = await this.pdf.render(html);
    return { ...out, fileName: `${po.poNo}-${copy.toLowerCase()}.${out.ext}` };
  }
}
