import { BadRequestException, Injectable } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { manilaDateStr, toDateOnly, todayManila, dateStr } from '../common/manila';
import type { SessionUser } from '../common/request-context';

type Tx = Prisma.TransactionClient;
export const VIRTUAL_CODES = { IN_TRANSIT: 'V-TRANSIT', OPENING: 'V-OPENING', CUSTOMER_RETURNS: 'V-CUSTRET', OFFICE: 'OFFICE', PULLOUT1: 'V-PULLOUT1', PULLOUT2: 'V-PULLOUT2', PULLOUT3: 'V-PULLOUT3', FOR_REPLACEMENT: 'V-REPLACE' } as const;

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
      if (bal.qty < 0) throw new BadRequestException(`Insufficient stock for product ${r.productId} (batch ${r.batchId}) at location ${r.locationId}`);
    }
  }

  async locationByCode(tx: Tx | null, code: string) {
    const db = (tx ?? this.prisma.db) as Prisma.TransactionClient;
    const loc = await db.location.findUnique({ where: { code } });
    if (!loc) throw new BadRequestException(`Location ${code} missing; run seed`);
    return loc;
  }

  /** FEFO batch picking (§7.6). Expired batches are excluded; consignment-in batches are eligible. */
  async pickFefo(tx: Tx, locationId: string, productId: string, qty: number, opts: { preferBatchId?: string; allowExpired?: boolean } = {}): Promise<Pick[]> {
    const today = todayManila();
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

  async onHand(locationId: string, productId: string, tx: Tx | null = null): Promise<number> {
    const db = (tx ?? this.prisma.db) as Prisma.TransactionClient;
    const r = await db.stockBalance.aggregate({ where: { locationId, productId }, _sum: { qty: true } });
    return r._sum.qty ?? 0;
  }

  /** Stock on hand by location (§7.8). Cost value only when caller has cost.view (redaction also strips it). */
  async stockOnHand(user: SessionUser, locationId: string | undefined, opts: { includeZero?: boolean; search?: string } = {}) {
    const where: Prisma.StockBalanceWhereInput = locationId ? { locationId } : user.locationScoped ? { locationId: { in: user.locationIds } } : { locationId: { not: '' } };
    if (!opts.includeZero) where.qty = { not: 0 };
    if (opts.search) where.product = { OR: [{ name: { contains: opts.search, mode: 'insensitive' } }, { sku: { contains: opts.search, mode: 'insensitive' } }] };
    const rows = await this.prisma.db.stockBalance.findMany({ where, include: { batch: { select: { id: true, batchNo: true, expiryDate: true, unitCost: true, isConsignmentIn: true } }, product: { select: { id: true, sku: true, name: true, categoryId: true, franchiseVisible: true, category: { select: { accountingClass: true } } } }, location: { select: { id: true, code: true, name: true } } } });
    const franchise = user.roleKey.startsWith('FRANCHISE');
    return rows.filter((r) => !franchise || r.product.franchiseVisible).map((r) => ({
      locationId: r.locationId, location: r.location, productId: r.productId, product: { id: r.product.id, sku: r.product.sku, name: r.product.name, accountingClass: r.product.category.accountingClass },
      batchId: r.batchId, batchNo: r.batch.batchNo, expiryDate: r.batch.expiryDate ? dateStr(r.batch.expiryDate) : null, isConsignmentIn: r.batch.isConsignmentIn, qty: r.qty,
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
    return this.prisma.db.stockLedger.findMany({ where, include: { batch: { select: { batchNo: true, expiryDate: true } }, product: { select: { sku: true, name: true } }, location: { select: { code: true, name: true } } }, orderBy: { postedAt: 'desc' }, take: q.take ?? 500 });
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

  businessDate(d?: string | Date) { return d ? toDateOnly(d) : toDateOnly(manilaDateStr()); }
}
