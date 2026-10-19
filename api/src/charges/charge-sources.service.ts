import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { MasterService } from '../master/master.service';
import { requestContext } from '../common/request-context';
import { dateStr, todayManila } from '../common/manila';

export interface ChargeSource {
  type: string; id: string; number: string; date: string; summary: string; amount: number | null; route: string;
  staff: { employeeId: string; name: string; position: string | null }[];
  items: { productId: string; name: string; qty: number; unitCharge: number }[];
}
export const SOURCE_TYPES: [string, string][] = [
  ['COUNT_CASE', 'Count discrepancy (count sheet)'], ['TRANSFER_DIFF', 'Transfer difference'], ['WRITEOFF', 'Write-off: expired / damaged / BO'], ['BO_PULLOUT', 'BO / marketing pull-out'],
  ['CASH_SHORT', 'Cash shortage at the daily close'], ['EXPENSE', 'Branch expense'], ['SALE', 'Sales DR / SI (wrong item, price, void)'], ['RECEIVING', 'Supplier delivery shortage'],
  ['REPLACEMENT', 'Replacement / return ticket'], ['ECOM_RETURN', 'E-commerce return'], ['AR_OVERDUE', 'Uncollected AR (overdue)'],
];

/**
 * The automatic list HR links a charge to (owner request 2026-10-19): recent documents of the branch that can be the cause of a charge, with the staff named on them
 * and their items priced at the franchise price (cost is never shown). One source of truth for the "Linked to" picker and the link on a charge form.
 */
@Injectable()
export class ChargeSourcesService {
  constructor(private prisma: PrismaService, private master: MasterService) {}

  private async staffOf(userIds: (string | null | undefined)[], employeeIds: string[] = []) {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    const emps = await this.prisma.db.employee.findMany({ where: { OR: [{ userId: { in: ids } }, { id: { in: employeeIds } }], active: true }, select: { id: true, fullName: true, position: true } });
    return emps.map((e) => ({ employeeId: e.id, name: e.fullName, position: e.position }));
  }
  private async itemsOf(rows: { productId: string; qty: number; name: string }[], date: Date) {
    const merged = new Map<string, { productId: string; name: string; qty: number }>();
    for (const r of rows) { const m = merged.get(r.productId); if (m) m.qty += r.qty; else merged.set(r.productId, { ...r }); }
    const out = [];
    for (const m of merged.values()) if (m.qty > 0) out.push({ ...m, unitCharge: Number((await this.master.priceFor(m.productId, 'FRANCHISE', date)) ?? 0) });
    return out;
  }
  private match(q: string | undefined, ...parts: (string | null | undefined)[]) { if (!q?.trim()) return true; const hay = parts.join(' ').toLowerCase(); return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w)); }

  async list(q: { locationId: string; type: string; q?: string }): Promise<ChargeSource[]> {
    return requestContext.runSystem(async () => this.build(q));
  }

  private async build(q: { locationId: string; type: string; q?: string }): Promise<ChargeSource[]> {
    const loc = q.locationId; const db = this.prisma.db; const out: ChargeSource[] = [];
    switch (q.type) {
      case 'COUNT_CASE': {
        const rows = await db.discrepancyCase.findMany({ where: { countDoc: { locationId: loc } }, orderBy: { createdAt: 'desc' }, take: 40, include: { countDoc: { include: { lines: { include: { product: { select: { name: true } } } } } } } });
        for (const c of rows) { const shorts = c.countDoc.lines.filter((l) => l.variance < 0); if (!this.match(q.q, c.caseNo, c.countDoc.controlNo)) continue;
          out.push({ type: q.type, id: c.id, number: c.caseNo ?? c.countDoc.controlNo, date: dateStr(c.countDoc.countDate), summary: `Count ${c.countDoc.controlNo}: ${shorts.length} item${shorts.length === 1 ? '' : 's'} short · ${c.status}`, amount: null, route: `/discrepancies/${c.id}`, staff: await this.staffOf([c.countDoc.countedBy]), items: await this.itemsOf(shorts.map((l) => ({ productId: l.productId, name: l.product.name, qty: -l.variance })), c.countDoc.countDate) }); }
        break; }
      case 'TRANSFER_DIFF': {
        const rows = await db.transferDiscrepancy.findMany({ orderBy: { createdAt: 'desc' }, take: 80 });
        const docs = await db.transferDoc.findMany({ where: { id: { in: rows.map((r) => r.transferId) }, OR: [{ fromLocationId: loc }, { toLocationId: loc }] }, include: { lines: { include: { product: { select: { name: true } } } }, fromLocation: { select: { name: true } }, toLocation: { select: { name: true } } } });
        for (const d of docs) { const short = d.lines.filter((l) => l.qtyReceived != null && l.qtyReceived < l.qtySent); if (!short.length || !this.match(q.q, d.controlNo)) continue;
          out.push({ type: q.type, id: d.id, number: d.controlNo, date: dateStr(d.docDate), summary: `${d.fromLocation.name} → ${d.toLocation.name}: ${short.map((l) => `${l.product.name} −${l.qtySent - (l.qtyReceived ?? 0)}`).join(', ')}`, amount: null, route: `/transfers/${d.id}`, staff: await this.staffOf([d.preparedBy, d.receivedBy]), items: await this.itemsOf(short.map((l) => ({ productId: l.productId, name: l.product.name, qty: l.qtySent - (l.qtyReceived ?? 0) })), d.docDate) }); }
        break; }
      case 'WRITEOFF': {
        const rows = await db.expiryWriteoffDoc.findMany({ where: { locationId: loc, voidedAt: null }, orderBy: { docDate: 'desc' }, take: 40, include: { lines: { include: { product: { select: { name: true } } } } } });
        for (const w of rows) { if (!this.match(q.q, w.controlNo)) continue;
          out.push({ type: q.type, id: w.id, number: w.controlNo, date: dateStr(w.docDate), summary: `${w.lines.map((l) => `${l.product.name} ×${l.qty} (${String(l.reason).toLowerCase()})`).join(', ')} · charged to ${w.chargeTo === 'STAFF' ? 'staff' : 'the company'}`, amount: null, route: '/writeoffs', staff: await this.staffOf([w.preparedBy], w.chargeEmployeeIds), items: await this.itemsOf(w.lines.map((l) => ({ productId: l.productId, name: l.product.name, qty: l.qty })), w.docDate) }); }
        break; }
      case 'BO_PULLOUT': {
        const rows = await db.transferDoc.findMany({ where: { fromLocationId: loc, transferType: 'MARKETING_PULLOUT', voidedAt: null }, orderBy: { docDate: 'desc' }, take: 40, include: { lines: { include: { product: { select: { name: true } } } }, toLocation: { select: { name: true } } } });
        for (const d of rows) { if (!this.match(q.q, d.controlNo)) continue;
          out.push({ type: q.type, id: d.id, number: d.controlNo, date: dateStr(d.docDate), summary: `To ${d.toLocation.name}: ${d.lines.map((l) => `${l.product.name} ×${l.qtySent}`).join(', ')}`, amount: null, route: `/transfers/${d.id}`, staff: await this.staffOf([d.preparedBy]), items: await this.itemsOf(d.lines.map((l) => ({ productId: l.productId, name: l.product.name, qty: l.qtySent })), d.docDate) }); }
        break; }
      case 'CASH_SHORT': {
        const rows = await db.dailyClose.findMany({ where: { locationId: loc, cashVariance: { lt: 0 } }, orderBy: { businessDate: 'desc' }, take: 40 });
        for (const c of rows) { const day = dateStr(c.businessDate); if (!this.match(q.q, day)) continue;
          out.push({ type: q.type, id: c.id, number: day, date: day, summary: `Cash short ₱${Math.abs(Number(c.cashVariance)).toFixed(2)}${c.chargeFormId ? ' · already charged' : ''}`, amount: Math.abs(Number(c.cashVariance)), route: '/closing', staff: [], items: [] }); }
        break; }
      case 'EXPENSE': {
        const rows = await db.expenseDoc.findMany({ where: { locationId: loc, voidedAt: null }, orderBy: { docDate: 'desc' }, take: 40, include: { account: { select: { title: true } } } });
        for (const e of rows) { if (!this.match(q.q, e.controlNo, e.payee, e.account.title)) continue;
          out.push({ type: q.type, id: e.id, number: e.controlNo, date: dateStr(e.docDate), summary: `${e.account.title}${e.payee ? ` · ${e.payee}` : ''} · ₱${Number(e.amount).toFixed(2)}`, amount: Number(e.amount), route: '/expenses', staff: await this.staffOf([e.preparedBy]), items: [] }); }
        break; }
      case 'SALE': {
        const rows = await db.salesDoc.findMany({ where: { locationId: loc }, orderBy: { docDate: 'desc' }, take: 60, include: { lines: { include: { product: { select: { name: true } } } } } });
        for (const s of rows) { if (!this.match(q.q, s.drSiNo, s.controlNo)) continue;
          out.push({ type: q.type, id: s.id, number: s.drSiNo ?? s.controlNo, date: dateStr(s.docDate), summary: `${s.channel.replace(/_/g, ' ')} · ₱${Number(s.grandTotal).toFixed(2)}${s.voidedAt ? ' · VOIDED' : ''}`, amount: Number(s.grandTotal), route: `/sales/${s.id}`, staff: await this.staffOf([s.preparedBy]), items: await this.itemsOf(s.lines.filter((l) => !l.isFreebie).map((l) => ({ productId: l.productId, name: l.product.name, qty: l.qty })), s.docDate) }); }
        break; }
      case 'RECEIVING': {
        const rows = await db.receivingDoc.findMany({ where: { locationId: loc, voidedAt: null }, orderBy: { docDate: 'desc' }, take: 40, include: { lines: { include: { product: { select: { name: true } } } }, supplier: { select: { code: true } } } });
        for (const r of rows) { if (!this.match(q.q, r.controlNo, r.supplierRef)) continue;
          out.push({ type: q.type, id: r.id, number: r.controlNo, date: dateStr(r.docDate), summary: `${r.supplier.code}${r.supplierRef ? ` · ${r.supplierRef}` : ''}: ${r.lines.map((l) => `${l.product.name} ×${l.qty}`).join(', ')}`, amount: null, route: `/receiving/${r.id}`, staff: await this.staffOf([r.preparedBy, r.goodsCheckedBy]), items: await this.itemsOf(r.lines.map((l) => ({ productId: l.productId, name: l.product.name, qty: l.qty })), r.docDate) }); }
        break; }
      case 'REPLACEMENT': {
        const rows = await db.replacementTicket.findMany({ where: { locationId: loc }, orderBy: { createdAt: 'desc' }, take: 40 });
        const prods = await db.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, name: true } });
        for (const t of rows) { if (!this.match(q.q, t.ticketNo, t.drSiNo, t.customerName)) continue; const p = prods.find((x) => x.id === t.productId);
          out.push({ type: q.type, id: t.id, number: t.ticketNo, date: dateStr(t.createdAt), summary: `${t.kind === 'SUPPLIER' ? 'Return to supplier' : 'Customer'} · ${p?.name ?? ''} ×${t.qty} · ${t.reason}`, amount: null, route: `/replacements/${t.id}`, staff: await this.staffOf([t.createdBy]), items: p ? await this.itemsOf([{ productId: p.id, name: p.name, qty: t.qty }], t.createdAt) : [] }); }
        break; }
      case 'ECOM_RETURN': {
        const rows = await db.ecomReturn.findMany({ orderBy: { createdAt: 'desc' }, take: 40 });
        for (const r of rows) { if (!this.match(q.q, r.controlNo, r.ecomOrderId)) continue;
          out.push({ type: q.type, id: r.id, number: r.controlNo, date: dateStr(r.createdAt), summary: `${r.platform} order ${r.ecomOrderId}${r.reason ? ` · ${r.reason}` : ''}`, amount: null, route: '/ecommerce', staff: await this.staffOf([r.receivedBy, r.createdBy]), items: [] }); }
        break; }
      case 'AR_OVERDUE': {
        const rows = await db.salesDoc.findMany({ where: { locationId: loc, paymentMode: 'AR_PDC', voidedAt: null, dueDate: { lt: todayManila() } }, orderBy: { dueDate: 'asc' }, take: 60, include: { customer: { select: { name: true } } } });
        for (const s of rows) { const bal = Number(s.grandTotal) - Number(s.amountPaid); if (bal <= 0 || !this.match(q.q, s.drSiNo, s.customer?.name)) continue;
          out.push({ type: q.type, id: s.id, number: s.drSiNo ?? s.controlNo, date: dateStr(s.docDate), summary: `${s.customer?.name ?? ''} · unpaid ₱${bal.toFixed(2)} since ${dateStr(s.dueDate!)}`, amount: bal, route: `/sales/${s.id}`, staff: await this.staffOf([s.preparedBy]), items: [] }); }
        break; }
    }
    return out;
  }

  /** The link of a stored charge form (sourceType / sourceId) as a label and a page, for the list and the detail. */
  async describe(sourceType: string | null, sourceId: string | null): Promise<{ label: string; number: string; route: string } | null> {
    if (!sourceType || !sourceId) return null;
    const db = this.prisma.db;
    return requestContext.runSystem(async () => {
      switch (sourceType) {
        case 'DiscrepancyCase': { const c = await db.discrepancyCase.findUnique({ where: { id: sourceId }, select: { caseNo: true, countDoc: { select: { controlNo: true } } } }); return c ? { label: 'Count discrepancy', number: c.caseNo ?? c.countDoc.controlNo, route: `/discrepancies/${sourceId}` } : null; }
        case 'ExpiryWriteoffDoc': { const w = await db.expiryWriteoffDoc.findUnique({ where: { id: sourceId }, select: { controlNo: true } }); return w ? { label: 'Write-off', number: w.controlNo, route: '/writeoffs' } : null; }
        case 'DailyClose': { const c = await db.dailyClose.findUnique({ where: { id: sourceId }, select: { businessDate: true } }); return c ? { label: 'Cash shortage', number: dateStr(c.businessDate), route: '/closing' } : null; }
        case 'TransferDoc': { const d = await db.transferDoc.findUnique({ where: { id: sourceId }, select: { controlNo: true, transferType: true } }); return d ? { label: d.transferType === 'MARKETING_PULLOUT' ? 'BO / marketing pull-out' : 'Transfer difference', number: d.controlNo, route: `/transfers/${sourceId}` } : null; }
        case 'ExpenseDoc': { const e = await db.expenseDoc.findUnique({ where: { id: sourceId }, select: { controlNo: true } }); return e ? { label: 'Branch expense', number: e.controlNo, route: '/expenses' } : null; }
        case 'SalesDoc': { const s = await db.salesDoc.findUnique({ where: { id: sourceId }, select: { drSiNo: true, controlNo: true } }); return s ? { label: 'Sales DR / SI', number: s.drSiNo ?? s.controlNo, route: `/sales/${sourceId}` } : null; }
        case 'ReceivingDoc': { const r = await db.receivingDoc.findUnique({ where: { id: sourceId }, select: { controlNo: true } }); return r ? { label: 'Supplier delivery', number: r.controlNo, route: `/receiving/${sourceId}` } : null; }
        case 'ReplacementTicket': { const t = await db.replacementTicket.findUnique({ where: { id: sourceId }, select: { ticketNo: true } }); return t ? { label: 'Replacement ticket', number: t.ticketNo, route: `/replacements/${sourceId}` } : null; }
        case 'EcomReturn': { const r = await db.ecomReturn.findUnique({ where: { id: sourceId }, select: { controlNo: true } }); return r ? { label: 'E-commerce return', number: r.controlNo, route: '/ecommerce' } : null; }
        default: return null;
      }
    });
  }
}

/** The stored sourceType of each picker type. */
export const SOURCE_STORE: Record<string, string> = { COUNT_CASE: 'DiscrepancyCase', TRANSFER_DIFF: 'TransferDoc', WRITEOFF: 'ExpiryWriteoffDoc', BO_PULLOUT: 'TransferDoc', CASH_SHORT: 'DailyClose', EXPENSE: 'ExpenseDoc', SALE: 'SalesDoc', RECEIVING: 'ReceivingDoc', REPLACEMENT: 'ReplacementTicket', ECOM_RETURN: 'EcomReturn', AR_OVERDUE: 'SalesDoc' };
