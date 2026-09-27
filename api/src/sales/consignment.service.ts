import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { MasterService } from '../master/master.service';
import { AccountsService } from '../gl/accounts.service';
import { SalesService } from './sales.service';
import { toDateOnly } from '../common/manila';
import type { ApprovalType } from '../common/permissions';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

export interface ConsigneeInput { name: string; code?: string; contactPerson?: string; phone?: string; address?: string; priceBasis: 'SRP' | 'CONSIGNEE_PRICE' | 'COST'; settlementDays?: number; notes?: string }
export interface SaleReportRequest { agreementId: string; periodFrom: string; periodTo: string; notes?: string; lines: { productId: string; qty: number; unitPrice?: number | null }[] }

/**
 * Consignments made simple (owner request 2026-09-27): the Owner creates consignee accounts (a consignee location, its customer and
 * AR account and the agreement in one step); goods go out and come back as transfers; consignee sales are reported by item and
 * quantity with the price taken from the agreement. Requests from associates go to their manager first (Warehouse In-Charge for the
 * warehouse, Head or Asst Auditor for branches) and the Owner approves last. Cost never reaches people without cost access.
 */
@Injectable()
export class ConsignmentService implements OnModuleInit {
  constructor(private prisma: PrismaService, private approvals: ApprovalsService, private notify: NotificationsService, private audit: AuditService, private master: MasterService, private accounts: AccountsService, private sales: SalesService) {}

  onModuleInit() {
    for (const t of ['CONSIGNMENT_CHECK_WH', 'CONSIGNMENT_CHECK_BRANCH'] as ApprovalType[]) this.approvals.register(t, (req, outcome) => this.onCheck(req.id, req.documentId, req.summary as Staged, outcome, req.requestedBy), 'ConsignmentSaleRequest');
    this.approvals.register('CONSIGNMENT_OUT', (req, outcome, actor) => this.onFinal(req.documentId, req.summary as Staged, outcome, req.requestedBy, actor?.id ?? null), 'ConsignmentSaleRequest');
  }

  /** The manager step for a requester: the In-Charge for warehouse staff, the Head or Asst Auditor for branch staff; none for managers. */
  static managerStep(roleKey: string): ApprovalType | null {
    if (roleKey === 'WAREHOUSE_ASSOCIATE') return 'CONSIGNMENT_CHECK_WH';
    if (roleKey === 'SALES_ASSOCIATE') return 'CONSIGNMENT_CHECK_BRANCH';
    return null;
  }

  async consignees() {
    const locs = await this.prisma.db.location.findMany({ where: { type: 'CONSIGNEE' }, orderBy: { name: 'asc' }, include: { consignmentsOut: { where: { direction: 'OUT' }, orderBy: { createdAt: 'desc' }, take: 1 } } });
    const customers = await this.prisma.db.customer.findMany({ where: { locationId: { in: locs.map((l) => l.id) } }, select: { locationId: true, contact: true, phone: true, address: true } });
    return locs.map((l) => { const c = customers.find((x) => x.locationId === l.id); const ag = l.consignmentsOut[0]; return { id: l.id, code: l.code, name: l.name, active: l.active, agreementId: ag?.id ?? null, priceBasis: ag?.valuationBasis ?? null, settlementTerms: ag?.settlementTerms ?? null, contactPerson: c?.contact ?? null, phone: c?.phone ?? null, address: c?.address ?? null }; });
  }

  /** One step for the Owner: consignee location + customer + AR account + consignment-out agreement. */
  async createConsignee(input: ConsigneeInput, user: SessionUser) {
    if (user.roleKey !== 'ADMIN') throw new ForbiddenException('Only the Owner creates consignee accounts');
    let code = (input.code?.trim() || `CN-${input.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}`).slice(0, 20);
    if (await this.prisma.db.location.findUnique({ where: { code } })) {
      if (input.code?.trim()) throw new BadRequestException(`The code ${code} is already used; type another code`);
      const base = code; for (let n = 2; await this.prisma.db.location.findUnique({ where: { code } }); n++) code = `${base}${n}`;
    }
    const loc = await this.master.createLocation({ code, name: input.name.trim(), type: 'CONSIGNEE', isSelling: false } as never, user.id);
    const cust = await this.master.createCustomer({ name: input.name.trim(), type: 'CONSIGNEE', locationId: loc.id, contact: input.contactPerson }, user.id);
    await this.prisma.db.customer.update({ where: { id: (cust as { id: string }).id }, data: { phone: input.phone ?? null, address: input.address ?? null } });
    const ar = await this.accounts.create({ title: `AR – Consignee (${loc.name})`, class: 'AR', entryScope: 'MAIN', counterpartyType: 'CONSIGNEE', counterpartyId: loc.id }, user.id);
    await this.prisma.db.customer.update({ where: { id: (cust as { id: string }).id }, data: { arAccountId: ar.id } });
    const ag = await this.prisma.db.consignmentAgreement.create({ data: { direction: 'OUT', counterpartyLocationId: loc.id, valuationBasis: input.priceBasis, settlementTerms: [input.settlementDays ? `Pay within ${input.settlementDays} days` : null, input.notes].filter(Boolean).join(' · ') || null, createdBy: user.id } });
    await this.audit.log({ action: 'CREATE', entityType: 'Consignee', entityId: loc.id, after: { location: loc, agreement: ag }, userId: user.id });
    return { id: loc.id, code: loc.code, name: loc.name, agreementId: ag.id };
  }

  /** The unit price the consignee pays: retail price (SRP), the consignee price list, or cost, per the agreement. */
  private async priceFor(basis: string, productId: string, date: Date): Promise<number> {
    if (basis === 'COST') return Number((await this.master.costFor(productId, date)) ?? 0);
    const tier = basis === 'CONSIGNEE_PRICE' ? 'CONSIGNEE' : 'RETAIL';
    const p = (await this.master.priceFor(productId, tier, date)) ?? (await this.master.priceFor(productId, 'RETAIL', date));
    return Number(p ?? 0);
  }

  /**
   * Prices to pre-fill the form: from the agreement (retail or consignee price). A cost-based agreement shows its prices only to people
   * who may see cost; everyone else gets an empty price, which the agreement fills at posting.
   */
  async prefill(agreementId: string, productIds: string[], date: string, user: SessionUser) {
    const ag = await this.prisma.db.consignmentAgreement.findUniqueOrThrow({ where: { id: agreementId } });
    const hide = ag.valuationBasis === 'COST' && !user.permissions.has('cost.view');
    const out: Record<string, number | null> = {};
    for (const id of productIds) out[id] = hide ? null : await this.priceFor(ag.valuationBasis, id, toDateOnly(date));
    return { priceBasis: ag.valuationBasis, hidden: hide, prices: out };
  }

  /** Printable draft of a consignee sales report, before it is submitted or approved. */
  async draftForm(input: SaleReportRequest, user: SessionUser) {
    const ag = await this.prisma.db.consignmentAgreement.findUniqueOrThrow({ where: { id: input.agreementId }, include: { counterpartyLocation: true } });
    const pre = await this.prefill(input.agreementId, input.lines.map((l) => l.productId), input.periodTo, user);
    const products = await this.prisma.db.product.findMany({ where: { id: { in: input.lines.map((l) => l.productId) } }, select: { id: true, sku: true, name: true } });
    const rows = input.lines.map((l) => { const p = products.find((x) => x.id === l.productId); const price = l.unitPrice ?? pre.prices[l.productId]; return [p?.sku ?? '', p?.name ?? '', l.qty, price == null ? 'per agreement' : price.toFixed(2), price == null ? '' : (price * l.qty).toFixed(2)]; });
    const total = input.lines.reduce((t, l) => t + (l.unitPrice ?? pre.prices[l.productId] ?? 0) * l.qty, 0);
    return { title: 'Consignee Sales Report — DRAFT', header: <[string, unknown][]>[['Consignee', ag.counterpartyLocation?.name ?? ''], ['Period', `${input.periodFrom} to ${input.periodTo}`], ['Price basis', pre.priceBasis === 'SRP' ? 'Retail price (SRP)' : pre.priceBasis === 'CONSIGNEE_PRICE' ? 'Consignee price' : 'Agreed price'], ['Prepared by', user.fullName], ['Status', 'DRAFT — not yet submitted / approved']], columns: ['SKU', 'Item', 'Qty sold', 'Unit price', 'Amount'], rows: [...rows, ['', 'TOTAL', input.lines.reduce((n, l) => n + l.qty, 0), '', total ? total.toFixed(2) : '']], signatures: ['Prepared by', 'Checked by (manager)', 'Approved by (Owner)'], status: 'DRAFT' };
  }

  /** Consignee sales for a period: the Owner posts at once; anyone else sends a request (manager first, the Owner last). */
  async saleReport(input: SaleReportRequest, user: SessionUser) {
    const ag = await this.prisma.db.consignmentAgreement.findUnique({ where: { id: input.agreementId }, include: { counterpartyLocation: true } });
    if (!ag || ag.direction !== 'OUT' || !ag.counterpartyLocation) throw new BadRequestException('Choose a consignee');
    if (!input.lines.length || input.lines.some((l) => !Number.isInteger(l.qty) || l.qty <= 0)) throw new BadRequestException('Quantities must be whole numbers above zero');
    // prices are filled in from the agreement and may be edited by whoever prepares the report (owner request 2026-09-27);
    // a line left without a price takes the agreement price when it is posted
    const typed = true;
    if (user.roleKey === 'ADMIN') return this.post(input, ag.valuationBasis, typed);
    const step = ConsignmentService.managerStep(user.roleKey);
    const lines = input.lines.map((l) => ({ productId: l.productId, qty: l.qty, ...(typed && l.unitPrice != null ? { unitPrice: l.unitPrice } : {}) }));
    const products = await this.prisma.db.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } }, select: { id: true, name: true } });
    const staged: Staged = { consignee: ag.counterpartyLocation.name, periodFrom: input.periodFrom, periodTo: input.periodTo, items: lines.map((l) => `${l.qty}× ${products.find((p) => p.id === l.productId)?.name ?? ''}`).join(', '), requestedByName: user.fullName, _payload: { ...input, lines } };
    const req = await this.approvals.request({ type: step ?? 'CONSIGNMENT_OUT', documentType: 'ConsignmentSaleRequest', documentId: randomUUID(), requestedBy: user.id, summary: staged });
    return { pending: true, approvalRequestId: req.id, message: step ? 'Sent to your manager, then to the Owner for final approval.' : 'Sent to the Owner for approval.' };
  }

  private async post(input: SaleReportRequest, basis: string, keepTyped: boolean) {
    const date = toDateOnly(input.periodTo);
    const lines = [];
    for (const l of input.lines) lines.push({ productId: l.productId, qty: l.qty, unitPrice: keepTyped && l.unitPrice != null ? l.unitPrice : await this.priceFor(basis, l.productId, date) });
    const system = { id: 'system', username: 'system', fullName: 'System', roleKey: 'ADMIN', permissions: new Set<string>(), locationIds: [], locationScoped: false, sessionId: '', totpVerified: true } as SessionUser;
    return this.sales.consignmentSaleReport({ agreementId: input.agreementId, periodFrom: input.periodFrom, periodTo: input.periodTo, notes: input.notes, lines }, system);
  }

  private async onCheck(requestId: string, documentId: string, s: Staged, outcome: 'APPROVED' | 'REJECTED', requestedBy: string) {
    await requestContext.runSystem(async () => {
      if (outcome === 'REJECTED') { await this.notify.toUsers([requestedBy], { type: 'CONSIGNMENT_REJECTED', title: `Consignee sales for ${s.consignee} were not approved by your manager`, link: '/consignment' }); return; }
      await this.approvals.request({ type: 'CONSIGNMENT_OUT', documentType: 'ConsignmentSaleRequest', documentId, requestedBy, summary: { ...s, managerApproval: requestId } });
    });
  }

  private async onFinal(documentId: string, s: Staged, outcome: 'APPROVED' | 'REJECTED', requestedBy: string, actorId: string | null) {
    await requestContext.runSystem(async () => {
      if (outcome === 'REJECTED') { await this.notify.toUsers([requestedBy], { type: 'CONSIGNMENT_REJECTED', title: `Consignee sales for ${s.consignee} were not approved by the Owner`, link: '/consignment' }); return; }
      const ag = await this.prisma.db.consignmentAgreement.findUniqueOrThrow({ where: { id: s._payload.agreementId } });
      const r = await this.post(s._payload, ag.valuationBasis, true);
      await this.audit.log({ action: 'APPROVE', entityType: 'ConsignmentSaleReport', entityId: r.report.id, after: { documentId, approvedBy: actorId } });
      await this.notify.toUsers([requestedBy], { type: 'CONSIGNMENT_POSTED', title: `Consignee sales for ${s.consignee} approved and posted`, link: '/consignment' });
    });
  }
}

interface Staged { consignee: string; periodFrom: string; periodTo: string; items: string; requestedByName: string; managerApproval?: string; _payload: SaleReportRequest }
