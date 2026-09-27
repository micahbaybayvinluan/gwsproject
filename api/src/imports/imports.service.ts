import { loadWorkbook } from './workbook-readers';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { XlsxService } from '../reports/xlsx.service';
import { MasterService } from '../master/master.service';
import { StockService, VIRTUAL_CODES } from '../stock/stock.service';
import { AccountsService } from '../gl/accounts.service';
import { MasterDataApprovals } from '../approvals/master-data.service';
import { AuditService } from '../common/audit.service';
import { parseProductGrid } from './product-import';
import { classFromSection, entryScopeFor, matchTemplate, normalizeTitle, parseBranchTag, parseCaCodes, parseChannelTag, parseCoaGrid } from '../gl/coa-import';
import { toDateOnly, todayManila } from '../common/manila';
import { D } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { AccountClass } from '@prisma/client';

/** §13 / §15 bulk uploads: products (seed workbook + template), price lists, min stock, opening stock, actual count, chart of accounts, beginning balances, employees. */
@Injectable()
export class ImportsService {
  constructor(private prisma: PrismaService, private xlsx: XlsxService, private master: MasterService, private stock: StockService, private accounts: AccountsService, private audit: AuditService, md: MasterDataApprovals) {
    // bulk loads of new products / employees wait for the Owner like single entries; the file is kept with the request
    const run = (fn: (buf: Buffer, u: SessionUser, p: Record<string, unknown>) => Promise<object>) => async (p: Record<string, unknown>, by: string) => ({ id: 'import', ...(await fn(Buffer.from(String(p.file), 'base64'), await md.sessionUserOf(by), p)) });
    md.registerKind('ProductImport', { label: 'Product import', apply: run((b, u) => this.products(b, u)), link: () => '/products' });
    md.registerKind('ProductWorkbookImport', { label: 'Product import', apply: run((b, u, p) => this.productsFromSeedWorkbook(b, u, (p.sheet as string | undefined) ?? undefined)), link: () => '/products' });
    md.registerKind('EmployeeImport', { label: 'Employee import', apply: run((b, u) => this.employees(b, u)), link: () => '/payroll' });
  }

  templates: Record<string, string[]> = {
    products: ['SKU', 'Barcode', 'Name', 'Category', 'Brand', 'Unit', 'SupplierCode', 'TrackExpiry', 'FranchiseVisible', 'RETAIL', 'DEALER', 'FRANCHISE', 'AGENT', 'Cost'],
    prices: ['SKU', 'Tier', 'Price', 'EffectiveFrom'],
    'min-stock': ['SKU', 'LocationCode', 'MinQty'],
    'opening-stock': ['LocationCode', 'SKU', 'Qty', 'BatchNo', 'ExpiryDate', 'Cost'],
    count: ['SKU', 'Name', 'System Qty', 'Actual Qty', 'Remarks'],
    'chart-of-accounts': ['Code', 'Title', 'Section', 'BranchCode', 'ChannelTag', 'BeginningDebit', 'BeginningCredit'],
    'beginning-balances': ['Code', 'Debit', 'Credit'],
    employees: ['EmployeeNo', 'FullName', 'LocationCode', 'Position', 'BasicRate', 'PayFrequency', 'SSS', 'PHIC', 'HDMF', 'BankAccount'],
    'open-ar': ['LocationCode', 'CustomerCode', 'DRNo', 'Date', 'Amount', 'DueDate'],
  };
  template(kind: string) { const cols = this.templates[kind]; if (!cols) throw new BadRequestException('Unknown template'); return this.xlsx.template(cols); }

  /** Seed workbook import (`DAILY INVTY COUNT`). Generates SKUs GWS-000001…; flags ambiguous rows for Head Auditor review. */
  async productsFromSeedWorkbook(buf: Buffer, user: SessionUser, sheet = 'DAILY INVTY COUNT') {
    const grid = await this.xlsx.grid(buf, sheet);
    const parsed = parseProductGrid(grid);
    const cats = await this.prisma.db.category.findMany();
    const catFor = (cls: string) => cats.find((c) => c.accountingClass === cls)?.id ?? cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id;
    const today = todayManila();
    let created = 0, skipped = 0, flagged = 0;
    for (const p of parsed) {
      const exists = await this.prisma.db.product.findFirst({ where: { name: { equals: p.name, mode: 'insensitive' } } });
      if (exists) { skipped++; continue; }
      const sku = await this.master.nextSku();
      const prices: Record<string, number> = {}; if (p.retail != null) prices.RETAIL = p.retail; if (p.dealer != null) prices.DEALER = p.dealer; if (p.franchise != null) prices.FRANCHISE = p.franchise;
      await this.prisma.db.$transaction(async (tx) => {
        const prod = await tx.product.create({ data: { sku, name: p.name, brand: p.brand, categoryId: catFor(p.accountingClass), trackExpiry: p.trackExpiry, isBundle: p.accountingClass === 'BUNDLE', needsReview: p.needsReview, createdBy: user.id } });
        for (const [tier, price] of Object.entries(prices)) await tx.priceList.create({ data: { productId: prod.id, tier, effectiveFrom: today, price: D(price).toFixed(2), createdBy: user.id, approvedBy: user.id } });
        if (p.cost != null) await tx.productCost.create({ data: { productId: prod.id, effectiveFrom: today, cost: D(p.cost).toFixed(2), createdBy: user.id, approvedBy: user.id } });
      });
      created++; if (p.needsReview) flagged++;
    }
    await this.audit.log({ action: 'IMPORT', entityType: 'Product', after: { source: sheet, parsed: parsed.length, created, skipped, flagged } });
    return { parsed: parsed.length, created, skipped, flaggedForReview: flagged };
  }

  /** Template import for products (create or update by SKU). */
  async products(buf: Buffer, user: SessionUser) {
    const { rows } = await this.xlsx.read(buf);
    const cats = await this.prisma.db.category.findMany(); const suppliers = await this.prisma.db.supplier.findMany();
    const today = todayManila(); let created = 0, updated = 0; const errors: string[] = [];
    for (const [i, r] of rows.entries()) {
      try {
        const name = String(r.Name ?? '').trim(); if (!name) throw new Error('Name required');
        const cat = cats.find((c) => c.name.toLowerCase() === String(r.Category ?? '').toLowerCase() || c.accountingClass === String(r.Category ?? '').toUpperCase()) ?? cats.find((c) => c.accountingClass === 'SUPPLEMENT')!;
        const supplier = r.SupplierCode ? suppliers.find((s) => s.code === String(r.SupplierCode)) : null;
        const sku = String(r.SKU ?? '').trim() || (await this.master.nextSku());
        const data = { name, categoryId: cat.id, barcode: r.Barcode ? String(r.Barcode) : undefined, brand: r.Brand ? String(r.Brand) : undefined, unit: r.Unit ? String(r.Unit) : undefined, supplierId: supplier?.id, trackExpiry: r.TrackExpiry == null ? undefined : /^(1|true|yes|y)$/i.test(String(r.TrackExpiry)), franchiseVisible: r.FranchiseVisible == null ? undefined : /^(1|true|yes|y)$/i.test(String(r.FranchiseVisible)) };
        const existing = await this.prisma.db.product.findUnique({ where: { sku } });
        const prod = existing ? await this.prisma.db.product.update({ where: { sku }, data: { ...data, updatedBy: user.id } }) : await this.prisma.db.product.create({ data: { ...data, sku, trackExpiry: data.trackExpiry ?? true, createdBy: user.id } });
        existing ? updated++ : created++;
        for (const tier of ['RETAIL', 'DEALER', 'FRANCHISE', 'AGENT']) if (r[tier] != null && r[tier] !== '') await this.prisma.db.priceList.upsert({ where: { productId_tier_effectiveFrom: { productId: prod.id, tier, effectiveFrom: today } }, create: { productId: prod.id, tier, effectiveFrom: today, price: D(r[tier] as number).toFixed(2), createdBy: user.id, approvedBy: user.id }, update: { price: D(r[tier] as number).toFixed(2) } });
        if (r.Cost != null && r.Cost !== '') { if (!user.permissions.has('cost.edit')) throw new Error('Cost column requires cost.edit'); await this.prisma.db.productCost.upsert({ where: { productId_effectiveFrom: { productId: prod.id, effectiveFrom: today } }, create: { productId: prod.id, effectiveFrom: today, cost: D(r.Cost as number).toFixed(2), createdBy: user.id, approvedBy: user.id }, update: { cost: D(r.Cost as number).toFixed(2) } }); }
      } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); }
    }
    await this.audit.log({ action: 'IMPORT', entityType: 'Product', after: { created, updated, errors: errors.length } });
    return { created, updated, errors };
  }
  async prices(buf: Buffer, user: SessionUser) {
    const { rows } = await this.xlsx.read(buf); let n = 0; const errors: string[] = [];
    for (const [i, r] of rows.entries()) { try { const p = await this.prisma.db.product.findUniqueOrThrow({ where: { sku: String(r.SKU) } }); const eff = r.EffectiveFrom ? toDateOnly(r.EffectiveFrom instanceof Date ? r.EffectiveFrom : String(r.EffectiveFrom)) : todayManila(); await this.prisma.db.priceList.upsert({ where: { productId_tier_effectiveFrom: { productId: p.id, tier: String(r.Tier).toUpperCase(), effectiveFrom: eff } }, create: { productId: p.id, tier: String(r.Tier).toUpperCase(), effectiveFrom: eff, price: D(r.Price as number).toFixed(2), createdBy: user.id, approvedBy: user.id }, update: { price: D(r.Price as number).toFixed(2) } }); n++; } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); } }
    return { imported: n, errors };
  }
  async minStock(buf: Buffer, user: SessionUser) {
    const { rows } = await this.xlsx.read(buf); const out = []; const errors: string[] = [];
    for (const [i, r] of rows.entries()) { try { const p = await this.prisma.db.product.findUniqueOrThrow({ where: { sku: String(r.SKU) } }); const l = await this.prisma.db.location.findUniqueOrThrow({ where: { code: String(r.LocationCode) } }); out.push({ productId: p.id, locationId: l.id, minQty: Number(r.MinQty) }); } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); } }
    await this.master.setMinStock(out, user.id); return { imported: out.length, errors };
  }
  /** §15.3 Opening stock per location: RECEIVE from VIRTUAL:OPENING on the cut-over date. Cost column: Admin only. */
  async openingStock(buf: Buffer, cutoverDate: string, user: SessionUser) {
    if (!user.permissions.has('cost.edit')) throw new BadRequestException('Opening stock with cost requires Admin / cost.edit');
    const { rows } = await this.xlsx.read(buf); const date = toDateOnly(cutoverDate); let n = 0; const errors: string[] = [];
    const opening = await this.stock.locationByCode(null, VIRTUAL_CODES.OPENING);
    for (const [i, r] of rows.entries()) {
      try {
        const p = await this.prisma.db.product.findUniqueOrThrow({ where: { sku: String(r.SKU) } }); const l = await this.prisma.db.location.findUniqueOrThrow({ where: { code: String(r.LocationCode) } });
        const qty = Number(r.Qty); if (!Number.isInteger(qty) || qty <= 0) throw new Error('Qty must be a positive integer');
        const cost = r.Cost != null && r.Cost !== '' ? D(r.Cost as number) : D(await this.master.costFor(p.id, date) ?? 0);
        await this.prisma.db.$transaction(async (tx) => {
          const batch = await tx.batch.create({ data: { productId: p.id, batchNo: r.BatchNo ? String(r.BatchNo) : 'OPENING', expiryDate: r.ExpiryDate ? toDateOnly(r.ExpiryDate instanceof Date ? r.ExpiryDate : String(r.ExpiryDate)) : null, receivedRef: `OPENING-${cutoverDate}`, unitCost: cost.toFixed(2), createdBy: user.id } });
          await this.stock.post(tx, [{ locationId: l.id, productId: p.id, batchId: batch.id, qtyDelta: qty, movementType: 'RECEIVE', documentType: 'OpeningStock', documentId: opening.id, unitCost: cost.toFixed(2), businessDate: date, createdBy: user.id }]);
          if (!(await tx.productCost.findFirst({ where: { productId: p.id } }))) await tx.productCost.create({ data: { productId: p.id, effectiveFrom: date, cost: cost.toFixed(2), createdBy: user.id, approvedBy: user.id } });
        });
        n++;
      } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); }
    }
    await this.audit.log({ action: 'IMPORT', entityType: 'OpeningStock', after: { cutoverDate, imported: n, errors: errors.length } });
    return { imported: n, errors };
  }
  /** Count upload (SKU, Name, System Qty, Actual Qty, Remarks) → lines for CountsService.enter. */
  /**
   * Actual counts typed into a count sheet in Excel. Works with the downloaded count sheet (title block above the table, "Actual count")
   * and with a plain table whose first row is the header ("Actual Qty"): the header row is the first row with a "SKU" cell.
   */
  async countLines(buf: Buffer) {
    const wb = await loadWorkbook(buf); const ws = wb.worksheets[0]; const out: { productId: string; actualQty: number; remarks?: string }[] = []; const errors: string[] = [];
    const text = (v: unknown): string => { if (v && typeof v === 'object' && 'result' in (v as object)) v = (v as { result: unknown }).result; if (v && typeof v === 'object' && 'richText' in (v as object)) v = (v as { richText: { text: string }[] }).richText.map((t) => t.text).join(''); return v == null ? '' : String(v).trim(); };
    let headerRow = 0; const col: Record<string, number> = {};
    for (let r = 1; r <= Math.min(ws.rowCount, 30) && !headerRow; r++) { const vals = ws.getRow(r).values as unknown[]; if (vals.some((v) => text(v).toUpperCase() === 'SKU')) { headerRow = r; vals.forEach((v, j) => { col[text(v).toLowerCase()] = j; }); } }
    if (!headerRow) return { lines: out, errors: ['No "SKU" column found in the first sheet'] };
    const actualCol = col['actual count'] ?? col['actual qty'] ?? col['actual'];
    if (actualCol == null) return { lines: out, errors: ['No "Actual count" column found'] };
    const skus = new Map((await this.prisma.db.product.findMany({ select: { id: true, sku: true } })).map((p) => [p.sku, p.id]));
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const vals = ws.getRow(r).values as unknown[]; const sku = text(vals[col.sku]); const actual = text(vals[actualCol]);
      if (!sku || actual === '') continue;
      const productId = skus.get(sku); if (!productId) { errors.push(`Row ${r}: unknown SKU ${sku}`); continue; }
      const n = Number(actual); if (!Number.isInteger(n) || n < 0) { errors.push(`Row ${r}: actual count for ${sku} must be a whole number of 0 or more`); continue; }
      const remarks = col.remarks != null ? text(vals[col.remarks]) : '';
      out.push({ productId, actualQty: n, remarks: remarks || undefined });
    }
    return { lines: out, errors };
  }
  /** §10.1 COA import: preview (with parsed tags for the review screen) then commit with overrides. `sheet` = BALANCE SHEET / INCOME STATEMENT of the accounting workbook; no sheet = the template. */
  async coaPreview(buf: Buffer, sheet?: string) {
    const locations = await this.prisma.db.location.findMany({ where: { active: true } });
    const templates = await this.prisma.db.accountTemplate.findMany();
    if (sheet) {
      let caCodes = new Map<string, string>();
      try { caCodes = parseCaCodes(await this.xlsx.grid(buf, 'CA')); } catch { /* template without CA sheet */ }
      return parseCoaGrid(await this.xlsx.grid(buf, sheet), templates, locations, caCodes).map((r) => ({ ...r, branchName: locations.find((l) => l.code === r.branchCode)?.name ?? null }));
    }
    const rows = (await this.xlsx.read(buf)).rows.map((r) => ({ code: r.Code ? String(r.Code) : null, title: String(r.Title ?? ''), section: String(r.Section ?? ''), branchCode: r.BranchCode ? String(r.BranchCode) : null, channelTag: r.ChannelTag ? String(r.ChannelTag) : null, beginningDebit: Number(r.BeginningDebit ?? 0), beginningCredit: Number(r.BeginningCredit ?? 0) }));
    return rows.filter((r) => r.title).map((r) => { const title = normalizeTitle(r.title); const branch = r.branchCode ?? parseBranchTag(title, locations); const cls = classFromSection(r.section, title); return { ...r, title, class: cls, branchCode: branch, branchName: locations.find((l) => l.code === branch)?.name ?? null, channelTag: r.channelTag ?? parseChannelTag(title), templateKey: matchTemplate(title, templates, locations), entryScope: entryScopeFor(cls, branch), isPaymentAccount: cls === 'CASH' }; });
  }
  async coaCommit(rows: { code?: string | null; title: string; class: AccountClass; branchCode?: string | null; channelTag?: string | null; templateKey?: string | null; entryScope?: 'BRANCH' | 'MAIN' | 'BOTH'; beginningDebit?: number; beginningCredit?: number }[], year: number, user: SessionUser) {
    const locations = await this.prisma.db.location.findMany(); const templates = await this.prisma.db.accountTemplate.findMany(); let created = 0, updated = 0; const errors: string[] = [];
    for (const r of rows) {
      try {
        const branch = r.branchCode ? locations.find((l) => l.code === r.branchCode) : null; const tpl = r.templateKey ? templates.find((t) => t.key === r.templateKey) : null;
        const existing = (r.code && (await this.prisma.db.account.findUnique({ where: { code: r.code } }))) || (await this.prisma.db.account.findFirst({ where: { title: r.title } }));
        const data = { title: r.title, class: r.class, branchTagId: branch?.id ?? null, channelTag: r.channelTag ?? null, templateId: tpl?.id ?? null, entryScope: r.entryScope ?? entryScopeFor(r.class, branch?.code ?? null) };
        const acct = existing ? await this.accounts.update(existing.id, data, user.id) : await this.accounts.create({ ...data, code: r.code ?? undefined }, user.id);
        existing ? updated++ : created++;
        if ((r.beginningDebit ?? 0) || (r.beginningCredit ?? 0)) await this.prisma.db.beginningBalance.upsert({ where: { fiscalYear_accountId: { fiscalYear: year, accountId: acct.id } }, create: { fiscalYear: year, accountId: acct.id, debit: D(r.beginningDebit ?? 0).toFixed(2), credit: D(r.beginningCredit ?? 0).toFixed(2), createdBy: user.id }, update: { debit: D(r.beginningDebit ?? 0).toFixed(2), credit: D(r.beginningCredit ?? 0).toFixed(2) } });
      } catch (e) { errors.push(`${r.title}: ${(e as Error).message}`); }
    }
    await this.accounts.ensureGlobalAccounts(user.id);
    await this.audit.log({ action: 'IMPORT', entityType: 'Account', after: { created, updated, errors: errors.length } });
    return { created, updated, errors };
  }
  async beginningBalances(buf: Buffer, year: number, user: SessionUser) {
    const { rows } = await this.xlsx.read(buf); const out = []; const errors: string[] = [];
    for (const [i, r] of rows.entries()) { try { const a = await this.prisma.db.account.findUniqueOrThrow({ where: { code: String(r.Code) } }); out.push({ accountId: a.id, debit: Number(r.Debit ?? 0), credit: Number(r.Credit ?? 0) }); } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); } }
    for (const o of out) await this.prisma.db.beginningBalance.upsert({ where: { fiscalYear_accountId: { fiscalYear: year, accountId: o.accountId } }, create: { fiscalYear: year, ...o, debit: D(o.debit).toFixed(2), credit: D(o.credit).toFixed(2), createdBy: user.id }, update: { debit: D(o.debit).toFixed(2), credit: D(o.credit).toFixed(2) } });
    return { imported: out.length, errors };
  }
  async employees(buf: Buffer, user: SessionUser) {
    const { rows } = await this.xlsx.read(buf); let n = 0; const errors: string[] = [];
    for (const [i, r] of rows.entries()) { try { const loc = r.LocationCode ? await this.prisma.db.location.findUnique({ where: { code: String(r.LocationCode) } }) : null; await this.prisma.db.employee.upsert({ where: { employeeNo: String(r.EmployeeNo) }, create: { employeeNo: String(r.EmployeeNo), fullName: String(r.FullName), locationId: loc?.id, position: r.Position ? String(r.Position) : null, basicRate: D(r.BasicRate as number).toFixed(2), payFrequency: r.PayFrequency ? String(r.PayFrequency) : 'SEMI_MONTHLY', sssNo: r.SSS ? String(r.SSS) : null, phicNo: r.PHIC ? String(r.PHIC) : null, hdmfNo: r.HDMF ? String(r.HDMF) : null, bankAccount: r.BankAccount ? String(r.BankAccount) : null, createdBy: user.id }, update: { fullName: String(r.FullName), locationId: loc?.id, position: r.Position ? String(r.Position) : undefined, basicRate: D(r.BasicRate as number).toFixed(2) } }); n++; } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); } }
    return { imported: n, errors };
  }
  /** §15.4 Open AR as opening AR docs (no stock lines, channel OTHER, AR_PDC). */
  async openAr(buf: Buffer, user: SessionUser) {
    const { rows } = await this.xlsx.read(buf); let n = 0; const errors: string[] = [];
    for (const [i, r] of rows.entries()) {
      try {
        const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { code: String(r.LocationCode) } }); const cust = await this.prisma.db.customer.findUniqueOrThrow({ where: { code: String(r.CustomerCode) } });
        const amt = D(r.Amount as number); const date = toDateOnly(r.Date instanceof Date ? r.Date : String(r.Date));
        await this.prisma.db.salesDoc.create({ data: { controlNo: `OPEN-AR-${String(r.DRNo)}`, docDate: date, locationId: loc.id, channel: cust.type === 'DEALER' ? 'DEALER' : cust.type === 'FRANCHISE' ? 'FRANCHISE' : 'OTHER', customerId: cust.id, drSiNo: String(r.DRNo), paymentMode: 'AR_PDC', productTotal: amt.toFixed(2), grandTotal: amt.toFixed(2), dueDate: r.DueDate ? toDateOnly(r.DueDate instanceof Date ? r.DueDate : String(r.DueDate)) : date, preparedBy: user.id, createdBy: user.id, notes: 'Opening AR (migrated)' } });
        n++;
      } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); }
    }
    return { imported: n, errors };
  }
  /** §16 parallel-run reconciliation: system totals per day/branch vs an Excel sheet (LocationCode, Date, ExcelSales, ExcelExpenses). */
  async reconcile(buf: Buffer) {
    const { rows } = await this.xlsx.read(buf); const out = [];
    for (const r of rows) {
      const loc = await this.prisma.db.location.findUnique({ where: { code: String(r.LocationCode) } }); if (!loc) { out.push({ ...r, error: 'unknown location' }); continue; }
      const date = toDateOnly(r.Date instanceof Date ? r.Date : String(r.Date));
      const sales = await this.prisma.db.salesDoc.aggregate({ where: { locationId: loc.id, docDate: date, voidedAt: null }, _sum: { grandTotal: true } });
      const exp = await this.prisma.db.expenseDoc.aggregate({ where: { locationId: loc.id, docDate: date, voidedAt: null }, _sum: { amount: true } });
      const sysSales = D(sales._sum.grandTotal), sysExp = D(exp._sum.amount);
      out.push({ location: loc.name, date: date.toISOString().slice(0, 10), excelSales: D(r.ExcelSales as number), systemSales: sysSales, salesDiff: sysSales.minus(r.ExcelSales as number), excelExpenses: D(r.ExcelExpenses as number), systemExpenses: sysExp, expensesDiff: sysExp.minus(r.ExcelExpenses as number) });
    }
    return out;
  }
}
