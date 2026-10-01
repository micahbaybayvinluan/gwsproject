import { addFlavor, batchLabel } from './flavors';
import { randomUUID } from 'crypto';
import { buildDailyInventory, dateRange, type DailyInventoryReport, RECEIVE, TRANSFER_IN, RETURNS, PULL_OUT, OTHER_OUT, ADJUST } from './daily-inventory';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { manilaDateStr, toDateOnly, todayManila, dateStr } from '../common/manila';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

/** Where stock goes when it is given to Prothin Marketing / GWS Marketing, or written off as bad orders (BO). */
export const MARKETING_DESTINATIONS = ['MKT-PROTHIN', 'MKT-GWS', 'BO-BAD'] as const;
export const VIRTUAL_CODES = { IN_TRANSIT: 'V-TRANSIT', OPENING: 'V-OPENING', CUSTOMER_RETURNS: 'V-CUSTRET', OFFICE: 'OFFICE', PULLOUT1: 'V-PULLOUT1', PULLOUT2: 'V-PULLOUT2', PULLOUT3: 'V-PULLOUT3', FOR_REPLACEMENT: 'V-REPLACE', MKT_PROTHIN: 'MKT-PROTHIN', MKT_GWS: 'MKT-GWS', BAD_ORDER: 'BO-BAD' } as const;

export interface LedgerPost { locationId: string; productId: string; batchId: string; qtyDelta: number; movementType: MovementType; documentType: string; documentId: string; unitCost: Prisma.Decimal | string | number; businessDate?: Date; createdBy?: string }
export interface Pick { batchId: string; qty: number; unitCost: Prisma.Decimal; expiryDate: Date | null; isConsignmentIn: boolean }

/** Append-only stock ledger + materialised StockBalance (§4.3). Ledger is truth. */
@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  /** Post ledger rows inside a transaction and update balances. Negative balances are rejected. */
  async post(tx: Tx, rows: LedgerPost[]) {
    for (const r of rows) {
      if (r.qtyDelta === 0) continue;
      const businessDate = r.businessDate ?? todayManila();
      await tx.stockLedger.create({ data: { ...r, unitCost: new Prisma.Decimal(r.unitCost), businessDate } });
      const bal = await tx.stockBalance.upsert({
        where: { locationId_productId_batchId: { locationId: r.locationId, productId: r.productId, batchId: r.batchId } },
        create: { locationId: r.locationId, productId: r.productId, batchId: r.batchId, qty: r.qtyDelta },
        update: { qty: { increment: r.qtyDelta } },
      });
      if (bal.qty < 0) {
        // stock may never go negative (owner rule): name the product and place so staff can act
        const [p, l, b] = await Promise.all([tx.product.findUnique({ where: { id: r.productId }, select: { name: true } }), tx.location.findUnique({ where: { id: r.locationId }, select: { name: true } }), tx.batch.findUnique({ where: { id: r.batchId }, select: { batchNo: true, expiryDate: true, flavor: true } })]);
        throw new BadRequestException(`Not enough stock: ${p?.name ?? r.productId} at ${l?.name ?? 'this location'}${b?.batchNo || b?.expiryDate ? ` (batch ${b.batchNo ?? ''}${b.expiryDate ? ` exp ${b.expiryDate.toISOString().slice(0, 10)}` : ''})` : ''} would go below zero by ${-bal.qty}. Quantities cannot be negative.`);
      }
    }
  }

  async locationByCode(tx: Tx | null, code: string) {
    const db = (tx ?? this.prisma.db);
    const loc = await db.location.findUnique({ where: { code } });
    if (!loc) throw new BadRequestException(`Location ${code} missing; run seed`);
    return loc;
  }

  /** FEFO batch picking (§7.6). Expired batches are excluded; consignment-in batches are eligible. */
  /**
   * Set the flavor of stock that has none (or correct it), per batch at one location (owner request 2026-09-30). The quantities move to
   * batches with the same expiry, batch no. and cost but the chosen flavor; the SKU's total count and value do not change.
   */
  async setFlavors(input: { locationId: string; batchId: string; parts: { flavor: string; qty: number }[] }, userId: string) {
    const parts = input.parts.map((p) => ({ flavor: p.flavor.trim().replace(/\s+/g, ' '), qty: Math.trunc(p.qty) })).filter((p) => p.flavor && p.qty > 0);
    if (!parts.length) throw new BadRequestException('Type at least one flavor and its quantity');
    const docId = randomUUID();
    return this.prisma.db.$transaction(async (tx) => {
      const bal = await tx.stockBalance.findFirst({ where: { locationId: input.locationId, batchId: input.batchId }, include: { batch: true } });
      if (!bal || bal.qty <= 0) throw new BadRequestException('This batch has no stock at this location');
      const total = parts.reduce((t, p) => t + p.qty, 0);
      if (total > bal.qty) throw new BadRequestException(`Only ${bal.qty} in this batch; the flavors add up to ${total}`);
      const src = bal.batch; const moved: { flavor: string; qty: number; batchId: string }[] = [];
      for (const p of parts) {
        if ((src.flavor ?? '').toLowerCase() === p.flavor.toLowerCase()) continue;
        const target = (await tx.batch.findFirst({ where: { productId: src.productId, batchNo: src.batchNo, expiryDate: src.expiryDate, unitCost: src.unitCost, isConsignmentIn: src.isConsignmentIn, flavor: { equals: p.flavor, mode: 'insensitive' } } }))
          ?? (await tx.batch.create({ data: { productId: src.productId, batchNo: src.batchNo, expiryDate: src.expiryDate, flavor: p.flavor, receivedRef: src.receivedRef, unitCost: src.unitCost, originalUnitCost: src.originalUnitCost, supplierId: src.supplierId, isConsignmentIn: src.isConsignmentIn, createdBy: userId } }));
        await this.post(tx, [
          { locationId: input.locationId, productId: src.productId, batchId: src.id, qtyDelta: -p.qty, movementType: 'ADJUST_COUNT', documentType: 'FlavorSplit', documentId: docId, unitCost: src.unitCost, createdBy: userId },
          { locationId: input.locationId, productId: src.productId, batchId: target.id, qtyDelta: p.qty, movementType: 'ADJUST_COUNT', documentType: 'FlavorSplit', documentId: docId, unitCost: src.unitCost, createdBy: userId },
        ]);
        await addFlavor(tx, src.productId, p.flavor);
        moved.push({ flavor: p.flavor, qty: p.qty, batchId: target.id });
      }
      return { documentId: docId, moved, leftUnflavored: bal.qty - total };
    });
  }

  async pickFefo(tx: Tx, locationId: string, productId: string, qty: number, opts: { preferBatchId?: string; exactBatchId?: string; allowExpired?: boolean } = {}): Promise<Pick[]> {
    const today = todayManila();
    if (opts.exactBatchId) {
      // the person chose this batch (flavor / expiry) on screen: take it from that batch only (owner request 2026-09-30)
      const b = await tx.stockBalance.findUnique({ where: { locationId_productId_batchId: { locationId, productId, batchId: opts.exactBatchId } }, include: { batch: true } });
      if (!b) throw new BadRequestException('The chosen batch is not at this location any more. Choose again.');
      const label = batchLabel(b.batch);
      if (!opts.allowExpired && b.batch.expiryDate && b.batch.expiryDate < today) throw new BadRequestException(`The chosen batch (${label}) is expired`);
      if (b.qty < qty) throw new BadRequestException(`Only ${b.qty} left of ${label} at this location (requested ${qty}). Add the rest from another flavor / expiry.`);
      return [{ batchId: b.batchId, qty, unitCost: b.batch.unitCost, expiryDate: b.batch.expiryDate, isConsignmentIn: b.batch.isConsignmentIn }];
    }
    const balances = await tx.stockBalance.findMany({ where: { locationId, productId, qty: { gt: 0 } }, include: { batch: true } });
    const eligible = balances
      .filter((b) => opts.allowExpired || !b.batch.expiryDate || b.batch.expiryDate >= today)
      .sort((a, b) => {
        if (opts.preferBatchId) { if (a.batchId === opts.preferBatchId) return -1; if (b.batchId === opts.preferBatchId) return 1; }
        const ae = a.batch.expiryDate?.getTime() ?? Infinity; const be = b.batch.expiryDate?.getTime() ?? Infinity;
        return ae - be || a.batch.createdAt.getTime() - b.batch.createdAt.getTime();
      });
    const available = eligible.reduce((s, b) => s + b.qty, 0);
    if (available < qty) throw new BadRequestException(`Only ${available} on hand for this product at this location (requested ${qty})`);
    const picks: Pick[] = [];
    let remaining = qty;
    for (const b of eligible) {
      if (remaining <= 0) break;
      const take = Math.min(b.qty, remaining);
      picks.push({ batchId: b.batchId, qty: take, unitCost: b.batch.unitCost, expiryDate: b.batch.expiryDate, isConsignmentIn: b.batch.isConsignmentIn });
      remaining -= take;
    }
    return picks;
  }

  /**
   * The day's movements per product at a location, for the count sheet (owner request 2026-09-29): from the beginning count, what
   * came in (supplier deliveries, transfers in, customer returns), what went out (sales, transfers / pull-outs out) and anything else
   * (write-offs, tasting, adjustments). Beginning + in − out ± other = expected.
   */
  async dayMovements(locationId: string, date: Date, productIds?: string[]) {
    const rows = await this.prisma.db.stockLedger.groupBy({ by: ['productId', 'movementType'], where: { locationId, businessDate: date, productId: productIds ? { in: productIds } : undefined, qtyDelta: { gt: 0 } }, _sum: { qtyDelta: true } });
    const neg = await this.prisma.db.stockLedger.groupBy({ by: ['productId', 'movementType'], where: { locationId, businessDate: date, productId: productIds ? { in: productIds } : undefined, qtyDelta: { lt: 0 } }, _sum: { qtyDelta: true } });
    const out = new Map<string, { received: number; transferIn: number; returns: number; sales: number; transferOut: number; other: number }>();
    const get = (id: string) => { let m = out.get(id); if (!m) { m = { received: 0, transferIn: 0, returns: 0, sales: 0, transferOut: 0, other: 0 }; out.set(id, m); } return m; };
    const TRANSFERS = ['TRANSFER_IN', 'TRANSFER_OUT', 'RETURN_TO_WAREHOUSE', 'RETURN_TO_SUPPLIER', 'CONSIGN_OUT', 'CONSIGN_RETURN'];
    for (const r of rows) { const q = r._sum.qtyDelta ?? 0; const m = get(r.productId); if (r.movementType === 'RECEIVE') m.received += q; else if (r.movementType === 'SALE_RETURN') m.returns += q; else if (TRANSFERS.includes(r.movementType)) m.transferIn += q; else m.other += q; }
    for (const r of neg) { const q = -(r._sum.qtyDelta ?? 0); const m = get(r.productId); if (r.movementType === 'SALE' || r.movementType === 'CONSIGN_SALE') m.sales += q; else if (TRANSFERS.includes(r.movementType)) m.transferOut += q; else m.other -= q; }
    return out;
  }

  async onHand(locationId: string, productId: string, tx: Tx | null = null): Promise<number> {
    const db = (tx ?? this.prisma.db);
    const r = await db.stockBalance.aggregate({ where: { locationId, productId }, _sum: { qty: true } });
    return r._sum.qty ?? 0;
  }

  /** Stock on hand by location (§7.8). Cost value only when caller has cost.view (redaction also strips it). */
  async stockOnHand(user: SessionUser, locationId: string | undefined, opts: { includeZero?: boolean; search?: string } = {}) {
    const where: Prisma.StockBalanceWhereInput = locationId ? { locationId } : user.locationScoped ? { locationId: { in: user.locationIds } } : { locationId: { not: '' } };
    if (!opts.includeZero) where.qty = { not: 0 };
    if (opts.search) where.product = { OR: [{ name: { contains: opts.search, mode: 'insensitive' } }, { sku: { contains: opts.search, mode: 'insensitive' } }] };
    const rows = await this.prisma.db.stockBalance.findMany({ where, include: { batch: { select: { id: true, batchNo: true, expiryDate: true, flavor: true, unitCost: true, isConsignmentIn: true } }, product: { select: { id: true, sku: true, name: true, categoryId: true, franchiseVisible: true, category: { select: { accountingClass: true } } } }, location: { select: { id: true, code: true, name: true } } } });
    const franchise = user.roleKey.startsWith('FRANCHISE');
    return rows.filter((r) => !franchise || r.product.franchiseVisible).map((r) => ({
      locationId: r.locationId, location: r.location, productId: r.productId, product: { id: r.product.id, sku: r.product.sku, name: r.product.name, accountingClass: r.product.category.accountingClass },
      batchId: r.batchId, batchNo: r.batch.batchNo, flavor: r.batch.flavor ?? null, expiryDate: r.batch.expiryDate ? dateStr(r.batch.expiryDate) : null, isConsignmentIn: r.batch.isConsignmentIn, qty: r.qty,
      unitCost: r.batch.unitCost, valueAtCost: r.batch.unitCost.mul(r.qty),
    }));
  }

  /** Warehouse availability for branch users: qty only (§5.4 ASSUMPTION 1). */
  async warehouseAvailability(productIds?: string[]) {
    const wh = await this.prisma.db.location.findFirst({ where: { type: 'WAREHOUSE' } });
    if (!wh) return [];
    const grouped = await this.prisma.db.stockBalance.groupBy({ by: ['productId'], where: { locationId: wh.id, qty: { gt: 0 }, productId: productIds ? { in: productIds } : undefined }, _sum: { qty: true } });
    return grouped.map((g) => ({ productId: g.productId, qty: g._sum.qty ?? 0 }));
  }

  /** Product ledger (every movement with document link). */
  ledger(user: SessionUser, q: { productId?: string; locationId?: string; from?: string; to?: string; take?: number }) {
    const where: Prisma.StockLedgerWhereInput = {
      productId: q.productId, locationId: q.locationId ?? (user.locationScoped ? { in: user.locationIds } : { not: '' }),
      businessDate: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined,
    };
    return this.prisma.db.stockLedger.findMany({ where, include: { batch: { select: { batchNo: true, expiryDate: true, flavor: true } }, product: { select: { sku: true, name: true } }, location: { select: { code: true, name: true } } }, orderBy: { postedAt: 'desc' }, take: q.take ?? 500 }).then((rows) => this.withDocuments(rows));
  }

  /**
   * Each movement with the number and page of the document behind it (DR, pull-out / transfer-in, receiving, count, write-off…),
   * so a click on the ledger opens it (owner request 2026-09-29). The rows are already limited to the user's locations.
   */
  async withDocuments<T extends { documentType: string; documentId: string; locationId: string }>(rows: T[]) {
    const ids = (t: string) => [...new Set(rows.filter((r) => r.documentType === t).map((r) => r.documentId))];
    const docs = await requestContext.runSystem(async () => ({
      sales: await this.prisma.db.salesDoc.findMany({ where: { id: { in: ids('SalesDoc') } }, select: { id: true, controlNo: true, drSiNo: true } }),
      transfers: await this.prisma.db.transferDoc.findMany({ where: { id: { in: ids('TransferDoc') } }, select: { id: true, controlNo: true, transferInNo: true, fromLocationId: true, transferType: true } }),
      receiving: await this.prisma.db.receivingDoc.findMany({ where: { id: { in: ids('ReceivingDoc') } }, select: { id: true, controlNo: true } }),
      counts: await this.prisma.db.countDoc.findMany({ where: { id: { in: ids('CountDoc') } }, select: { id: true, controlNo: true } }),
      writeoffs: await this.prisma.db.expiryWriteoffDoc.findMany({ where: { id: { in: ids('ExpiryWriteoffDoc') } }, select: { id: true, controlNo: true } }),
      cases: await this.prisma.db.discrepancyCase.findMany({ where: { id: { in: ids('DiscrepancyCase') } }, select: { id: true, caseNo: true } }),
      ecomReturns: await this.prisma.db.ecomReturn.findMany({ where: { id: { in: ids('EcomReturn') } }, select: { id: true, controlNo: true } }),
    }));
    return rows.map((r) => {
      let documentNo: string | null = null; let documentLink: string | null = null; let documentLabel = r.documentType;
      switch (r.documentType) {
        case 'SalesDoc': { const d = docs.sales.find((x) => x.id === r.documentId); documentLabel = 'Sale (DR)'; documentNo = d ? `${d.controlNo} · DR/SI ${d.drSiNo}` : null; documentLink = `/sales/${r.documentId}`; break; }
        case 'TransferDoc': { const d = docs.transfers.find((x) => x.id === r.documentId); const out = d?.fromLocationId === r.locationId; documentLabel = d?.transferType === 'ECOMMERCE' ? 'E-commerce pull-out' : out ? 'Pull-out' : 'Transfer-in'; documentNo = d ? (out || !d.transferInNo ? d.controlNo : `${d.transferInNo} (${d.controlNo})`) : null; documentLink = `/transfers/${r.documentId}`; break; }
        case 'ReceivingDoc': { documentLabel = 'Supplier delivery'; documentNo = docs.receiving.find((x) => x.id === r.documentId)?.controlNo ?? null; documentLink = `/receiving/${r.documentId}`; break; }
        case 'CountDoc': { documentLabel = 'Count sheet'; documentNo = docs.counts.find((x) => x.id === r.documentId)?.controlNo ?? null; documentLink = `/counts/${r.documentId}`; break; }
        case 'ExpiryWriteoffDoc': { documentLabel = 'Write-off'; documentNo = docs.writeoffs.find((x) => x.id === r.documentId)?.controlNo ?? null; documentLink = '/writeoffs'; break; }
        case 'DiscrepancyCase': { documentLabel = 'Discrepancy case'; documentNo = docs.cases.find((x) => x.id === r.documentId)?.caseNo ?? null; documentLink = `/discrepancies/${r.documentId}`; break; }
        case 'EcomReturn': { documentLabel = 'E-commerce return'; documentNo = docs.ecomReturns.find((x) => x.id === r.documentId)?.controlNo ?? null; documentLink = '/ecommerce'; break; }
        case 'OpeningStock': documentLabel = 'Opening stock'; break;
        case 'ConsignmentSaleReport': documentLabel = 'Consignee sale'; documentLink = '/consignment'; break;
      }
      return { ...r, documentLabel, documentNo, documentLink };
    });
  }

  /**
   * The forms behind one figure of the Daily Inventory Report (owner request 2026-10-01): click Transfer In, Pull Out, Receive… of an item and see which
   * documents made that movement (pull-out and transfer-in forms, supplier form with its delivery receipt, count sheet, write-off …), each with its forms to
   * open or print and its attachments. Sales have no such view.
   */
  async movementDocuments(user: SessionUser, q: { locationId: string; productId?: string; from: string; to: string; bucket: string }) {
    const types: Record<string, MovementType[]> = { receive: RECEIVE, transferIn: [...TRANSFER_IN, 'CONSIGN_OUT'], returns: RETURNS, pullOut: PULL_OUT, other: OTHER_OUT, adjust: ADJUST };
    if (q.bucket === 'sales') throw new BadRequestException('Sales are shown in the Sales List, not here');
    const movementTypes = types[q.bucket]; if (!movementTypes) throw new BadRequestException('Unknown column');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q.to)) throw new BadRequestException('from/to must be YYYY-MM-DD');
    const rows = await this.prisma.db.stockLedger.findMany({ where: { locationId: q.locationId, productId: q.productId, movementType: { in: movementTypes }, businessDate: { gte: toDateOnly(q.from), lte: toDateOnly(q.to) } }, select: { documentType: true, documentId: true, locationId: true, qtyDelta: true, businessDate: true, product: { select: { sku: true, name: true } } }, orderBy: { postedAt: 'asc' } });
    const groups = new Map<string, { documentType: string; documentId: string; locationId: string; qty: number; date: string; items: Map<string, number> }>();
    for (const r of rows) {
      const k = `${r.documentType}:${r.documentId}`; const g = groups.get(k) ?? { documentType: r.documentType, documentId: r.documentId, locationId: r.locationId, qty: 0, date: dateStr(r.businessDate), items: new Map() };
      g.qty += Math.abs(r.qtyDelta); g.items.set(r.product.name, (g.items.get(r.product.name) ?? 0) + Math.abs(r.qtyDelta)); groups.set(k, g);
    }
    const list = [...groups.values()];
    const withDocs = await this.withDocuments(list.map((g) => ({ documentType: g.documentType, documentId: g.documentId, locationId: g.locationId })));
    return requestContext.runSystem(async () => {
      const tIds = list.filter((g) => g.documentType === 'TransferDoc').map((g) => g.documentId);
      const transfers = await this.prisma.db.transferDoc.findMany({ where: { id: { in: tIds } }, select: { id: true, controlNo: true, transferInNo: true, status: true, transferType: true, fromLocationId: true, toLocationId: true, fromLocation: { select: { name: true } }, toLocation: { select: { name: true } }, notes: true, returnReason: true } });
      const rIds = list.filter((g) => g.documentType === 'ReceivingDoc').map((g) => g.documentId);
      const receivings = await this.prisma.db.receivingDoc.findMany({ where: { id: { in: rIds } }, select: { id: true, controlNo: true, status: true, supplier: { select: { name: true, code: true } }, supplierRef: true } });
      const atts = await this.prisma.db.attachment.findMany({ where: { documentId: { in: list.map((g) => g.documentId) } }, select: { id: true, documentId: true, fileName: true, contentType: true } });
      const free = !user.locationScoped; const mine = (id: string) => free || user.locationIds.includes(id);
      return list.map((g, i) => {
        const d = withDocs[i]; const forms: { label: string; number: string; pdf: string }[] = [];
        let from: string | null = null; let to: string | null = null; let status: string | null = null; let note: string | null = null;
        if (g.documentType === 'TransferDoc') {
          const t = transfers.find((x) => x.id === g.documentId);
          if (t) {
            from = t.fromLocation.name; to = t.toLocation.name; status = t.status; note = t.returnReason ?? t.notes ?? null;
            if (mine(t.fromLocationId)) forms.push({ label: 'Pull-Out form', number: t.controlNo, pdf: `/api/reports/forms/pull-out/${t.id}.pdf` });
            if (mine(t.toLocationId) && t.status !== 'DRAFT') forms.push({ label: 'Transfer-In form', number: t.transferInNo ?? t.controlNo, pdf: `/api/reports/forms/transfer-in/${t.id}.pdf` });
          }
        } else if (g.documentType === 'ReceivingDoc') {
          const r = receivings.find((x) => x.id === g.documentId);
          if (r) { from = r.supplier ? (user.permissions.has('supplier.view.name') ? r.supplier.name : r.supplier.code) : null; status = r.status; note = r.supplierRef ? `Supplier ref ${r.supplierRef}` : null; forms.push({ label: "Supplier's Form", number: r.controlNo, pdf: `/api/reports/forms/supplier-form/${r.id}.pdf` }); }
        } else if (g.documentType === 'CountDoc') forms.push({ label: 'Count sheet', number: d.documentNo ?? '', pdf: `/api/reports/forms/count/${g.documentId}.pdf` });
        return { documentType: g.documentType, documentId: g.documentId, label: d.documentLabel, number: d.documentNo, link: d.documentLink, qty: g.qty, date: g.date, items: [...g.items].map(([name, qty]) => ({ name, qty })), from, to, status, note, forms, attachments: atts.filter((a) => a.documentId === g.documentId).map((a) => ({ id: a.id, name: a.fileName, contentType: a.contentType })) };
      });
    });
  }

  /** Daily Inventory Movement per location (§7.8) — Beg, IN-P, IN-T, OUT-P, OUT-S, Bal, Act, Var, Loss, End per day of month. */
  async dailyMovement(locationId: string, year: number, month: number) {
    const from = new Date(Date.UTC(year, month - 1, 1)); const to = new Date(Date.UTC(year, month, 0));
    const beg = await this.prisma.db.$queryRaw<{ product_id: string; qty: bigint }[]>`SELECT product_id, COALESCE(SUM(qty_delta),0)::bigint qty FROM stock_ledger WHERE location_id=${locationId} AND business_date < ${from}::date GROUP BY product_id`;
    const moves = await this.prisma.db.stockLedger.findMany({ where: { locationId, businessDate: { gte: from, lte: to } }, select: { productId: true, qtyDelta: true, movementType: true, businessDate: true } });
    const counts = await this.prisma.db.countLine.findMany({ where: { doc: { locationId, status: { in: ['SUBMITTED', 'APPROVED', 'POSTED'] }, countDate: { gte: from, lte: to } } }, select: { productId: true, actualQty: true, variance: true, doc: { select: { countDate: true } } } });
    const products = await this.prisma.db.product.findMany({ where: { id: { in: [...new Set([...beg.map((b) => b.product_id), ...moves.map((m) => m.productId)])] } }, select: { id: true, sku: true, name: true } });
    const days = to.getUTCDate();
    const IN_P: MovementType[] = ['RECEIVE']; const IN_T: MovementType[] = ['TRANSFER_IN', 'SALE_RETURN', 'CONSIGN_RETURN', 'BUNDLE_BUILD'];
    const OUT_P: MovementType[] = ['TRANSFER_OUT', 'RETURN_TO_WAREHOUSE', 'RETURN_TO_SUPPLIER', 'CONSIGN_OUT', 'BUNDLE_BREAK']; const OUT_S: MovementType[] = ['SALE', 'CONSIGN_SALE', 'FREEBIE_ISSUE', 'TASTING'];
    return products.map((p) => {
      let bal = Number(beg.find((b) => b.product_id === p.id)?.qty ?? 0);
      const begQty = bal;
      const daysOut = [] as { day: number; inP: number; inT: number; outP: number; outS: number; bal: number; act: number | null; var: number | null; loss: number; end: number }[];
      for (let d = 1; d <= days; d++) {
        const dm = moves.filter((m) => m.productId === p.id && m.businessDate.getUTCDate() === d);
        const s = (types: MovementType[]) => dm.filter((m) => types.includes(m.movementType)).reduce((a, m) => a + Math.abs(m.qtyDelta), 0);
        const inP = s(IN_P), inT = s(IN_T), outP = s(OUT_P), outS = s(OUT_S);
        const adj = dm.filter((m) => m.movementType === 'ADJUST_COUNT' || m.movementType === 'EXPIRED_WRITEOFF').reduce((a, m) => a + m.qtyDelta, 0);
        bal = bal + inP + inT - outP - outS;
        const c = counts.find((x) => x.productId === p.id && x.doc.countDate.getUTCDate() === d);
        const end = bal + adj;
        daysOut.push({ day: d, inP, inT, outP, outS, bal, act: c?.actualQty ?? null, var: c ? c.variance : null, loss: adj < 0 ? -adj : 0, end });
        bal = end;
      }
      return { product: p, beg: begQty, days: daysOut, end: bal };
    });
  }

  /** Daily Inventory Report over a date range (inclusive, Manila business dates). Cost buckets are computed here and redacted per role on the way out. */
  async dailyInventory(locationId: string, from: string, to: string): Promise<DailyInventoryReport & { location: { id: string; name: string } }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new BadRequestException('from/to must be YYYY-MM-DD and from ≤ to');
    if (dateRange(from, to).length > 366) throw new BadRequestException('Date range is limited to one year');
    const loc = await this.prisma.db.location.findUnique({ where: { id: locationId }, select: { id: true, name: true } }); if (!loc) throw new NotFoundException('Location not found');
    const fromD = toDateOnly(from), toD = toDateOnly(to);
    const beg = await this.prisma.db.$queryRaw<{ product_id: string; qty: bigint; cost: unknown }[]>`SELECT product_id, COALESCE(SUM(qty_delta),0)::bigint qty, COALESCE(SUM(qty_delta*unit_cost),0) cost FROM stock_ledger WHERE location_id=${locationId} AND business_date < ${fromD}::date GROUP BY product_id`;
    const moves = await this.prisma.db.stockLedger.findMany({ where: { locationId, businessDate: { gte: fromD, lte: toD } }, select: { productId: true, qtyDelta: true, movementType: true, businessDate: true, unitCost: true } });
    const ids = [...new Set([...beg.map((b) => b.product_id), ...moves.map((m) => m.productId)])];
    const products = await this.prisma.db.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, name: true, brand: true } });
    const rep = buildDailyInventory(from, to, products, beg.map((b) => ({ productId: b.product_id, qty: Number(b.qty), cost: Number(b.cost) })), moves.map((m) => ({ productId: m.productId, qtyDelta: m.qtyDelta, movementType: m.movementType, businessDate: dateStr(m.businessDate), unitCost: Number(m.unitCost) })));
    return { location: loc, ...rep };
  }

  /** Expiry breakdown of what is on hand per product at a location (the same item can carry several expiry dates). */
  async expiriesAt(locationId: string, productIds: string[]) {
    const rows = await this.prisma.db.stockBalance.findMany({ where: { locationId, productId: { in: productIds }, qty: { gt: 0 } }, include: { batch: { select: { expiryDate: true, batchNo: true } } } });
    const out = new Map<string, { expiry: string; batchNo: string | null; qty: number }[]>();
    for (const r of rows) { const a = out.get(r.productId) ?? []; const key = r.batch.expiryDate ? dateStr(r.batch.expiryDate) : 'no expiry'; const cur = a.find((x) => x.expiry === key); if (cur) cur.qty += r.qty; else a.push({ expiry: key, batchNo: r.batch.batchNo, qty: r.qty }); out.set(r.productId, a); }
    for (const a of out.values()) a.sort((x, y) => x.expiry.localeCompare(y.expiry));
    return out;
  }

  businessDate(d?: string | Date) { return d ? toDateOnly(d) : toDateOnly(manilaDateStr()); }
}
