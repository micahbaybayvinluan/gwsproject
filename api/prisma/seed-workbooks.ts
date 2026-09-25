/* eslint-disable no-console */
/**
 * Loads the owner's three workbooks from /seed when present:
 *  - inventory.xlsm → products, brands, RETAIL/DEALER/FRANCHISE tiers, opening quantities at the Warehouse (col G, as of the sheet's date)
 *  - ACCTG PROGRAM - FORMAT.xlsm → chart of accounts (BALANCE SHEET + INCOME STATEMENT, codes from CA), beginning balances, dealer customers
 * Idempotent: existing products/accounts are left alone; opening stock is posted once.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gridOf, loadWorkbook } from '../src/imports/workbook-readers';
import { parseProductGrid } from '../src/imports/product-import';
import { normalizeTitle, parseCaCodes, parseCoaGrid, type KnownLocation } from '../src/gl/coa-import';
const tkey = (t: string) => normalizeTitle(t).toLowerCase();
import { ACCOUNT_TEMPLATES, GLOBAL_ACCOUNTS, NORMAL_BALANCE, nextCodeInRange } from '../src/gl/account-templates';

const money = (n: number | null | undefined) => (Math.round((n ?? 0) * 100) / 100).toFixed(2);

export async function seedWorkbooks(prisma: PrismaClient, seedDir: string) {
  const inv = path.join(seedDir, 'inventory.xlsm');
  const acctg = path.join(seedDir, 'ACCTG PROGRAM - FORMAT.xlsm');
  if (fs.existsSync(inv)) await seedProducts(prisma, inv); else console.log(`(no ${inv}; skipping product import)`);
  if (fs.existsSync(acctg)) await seedAccounts(prisma, acctg); else console.log(`(no ${acctg}; skipping chart of accounts import)`);
}

async function seedProducts(prisma: PrismaClient, file: string) {
  console.log('Importing products from inventory.xlsm …');
  const wb = await loadWorkbook(file);
  const grid = gridOf(wb, 'DAILY INVTY COUNT');
  const asOf = grid[2]?.[9] instanceof Date ? (grid[2][9] as Date) : new Date('2026-09-01T00:00:00Z'); // "BEG. INVTY." date cell (I2)
  const parsed = parseProductGrid(grid);
  const cats = await prisma.category.findMany();
  const catFor = (cls: string) => cats.find((c) => c.accountingClass === cls)?.id ?? cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id;
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const existing = new Map((await prisma.product.findMany({ select: { id: true, name: true } })).map((p) => [p.name.toLowerCase(), p.id]));
  let last = await prisma.product.findFirst({ where: { sku: { startsWith: 'GWS-' } }, orderBy: { sku: 'desc' }, select: { sku: true } });
  let n = last ? parseInt(last.sku.slice(4), 10) : 0;
  let created = 0, flagged = 0; const seen = new Set<string>(); const ids = new Map<string, string>();
  for (const p of parsed) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    if (existing.has(key)) { ids.set(key, existing.get(key)!); continue; }
    n += 1; const sku = `GWS-${String(n).padStart(6, '0')}`;
    const prod = await prisma.product.create({ data: { sku, name: p.name, brand: p.brand, categoryId: catFor(p.accountingClass), trackExpiry: p.trackExpiry, isBundle: p.accountingClass === 'BUNDLE', needsReview: p.needsReview } });
    ids.set(key, prod.id);
    for (const [tier, price] of [['RETAIL', p.retail], ['DEALER', p.dealer], ['FRANCHISE', p.franchise]] as const) if (price != null) await prisma.priceList.create({ data: { productId: prod.id, tier, effectiveFrom: today, price: money(price) } });
    if (p.cost != null) await prisma.productCost.create({ data: { productId: prod.id, effectiveFrom: today, cost: money(p.cost) } });
    created++; if (p.needsReview) flagged++;
  }
  console.log(`  products: ${parsed.length} rows → ${created} created, ${parsed.length - created} already present, ${flagged} flagged for review`);

  // Opening quantities (col G) at the Warehouse, once. Cost is unknown in the file → 0; Admin sets standard costs later (see README).
  const already = await prisma.stockLedger.count({ where: { documentType: 'OpeningStock' } });
  if (already) { console.log('  opening stock already posted; skipping'); return; }
  const wh = await prisma.location.findFirst({ where: { type: 'WAREHOUSE' } });
  const opening = await prisma.location.findUnique({ where: { code: 'V-OPENING' } });
  if (!wh || !opening) return;
  let posted = 0, skippedNeg = 0;
  for (const p of parsed) {
    const id = ids.get(p.name.toLowerCase()); if (!id || !p.openingQty) continue;
    if (p.openingQty < 0) { skippedNeg++; continue; }
    const batch = await prisma.batch.create({ data: { productId: id, batchNo: 'OPENING', receivedRef: `OPENING-${asOf.toISOString().slice(0, 10)}`, unitCost: '0.00' } });
    await prisma.stockLedger.create({ data: { locationId: wh.id, productId: id, batchId: batch.id, qtyDelta: p.openingQty, movementType: 'RECEIVE', documentType: 'OpeningStock', documentId: opening.id, unitCost: '0.00', businessDate: asOf } });
    await prisma.stockBalance.create({ data: { locationId: wh.id, productId: id, batchId: batch.id, qty: p.openingQty } });
    posted++;
  }
  console.log(`  opening stock at ${wh.name} as of ${asOf.toISOString().slice(0, 10)}: ${posted} products (${skippedNeg} negative quantities skipped)`);
}

async function seedAccounts(prisma: PrismaClient, file: string) {
  console.log('Importing chart of accounts from ACCTG PROGRAM - FORMAT.xlsm …');
  const wb = await loadWorkbook(file);
  const locations: KnownLocation[] = await prisma.location.findMany({ select: { id: true, name: true, code: true, type: true } });
  const templates = await prisma.accountTemplate.findMany();
  const caCodes = parseCaCodes(gridOf(wb, 'CA'));
  const rows = [...parseCoaGrid(gridOf(wb, 'BALANCE SHEET'), templates, locations, caCodes), ...parseCoaGrid(gridOf(wb, 'INCOME STATEMENT'), templates, locations, caCodes)];
  const fiscalYear = Number((process.env.FISCAL_YEAR_START || '2026-01-01').slice(0, 4));
  const usedCodes = new Set((await prisma.account.findMany({ select: { code: true } })).map((a) => a.code));
  const byTitle = new Map((await prisma.account.findMany({ select: { id: true, title: true } })).map((a) => [tkey(a.title), a.id]));
  let created = 0, balances = 0, dealers = 0;
  for (const r of rows) {
    if (byTitle.has(tkey(r.title))) { const id = byTitle.get(tkey(r.title))!; if (r.beginningDebit || r.beginningCredit) { await prisma.beginningBalance.upsert({ where: { fiscalYear_accountId: { fiscalYear, accountId: id } }, create: { fiscalYear, accountId: id, debit: money(r.beginningDebit), credit: money(r.beginningCredit) }, update: { debit: { increment: money(r.beginningDebit) }, credit: { increment: money(r.beginningCredit) } } }); balances++; } continue; }
    let code = r.code && !usedCodes.has(r.code) ? r.code : nextCodeInRange(r.class, usedCodes);
    usedCodes.add(code);
    const branch = r.branchCode ? locations.find((l) => l.code === r.branchCode) : null;
    const tpl = r.templateKey ? templates.find((t) => t.key === r.templateKey) : null;
    // counterparties: dealers become customers; franchise AR points at the franchise location
    let counterpartyType: string | null = null, counterpartyId: string | null = null;
    const dealer = r.title.match(/^AR – Dealer \((.+)\)/i);
    if (dealer) { const name = dealer[1].trim(); let c = await prisma.customer.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } }); if (!c) { const cnt = await prisma.customer.count(); c = await prisma.customer.create({ data: { code: `DLR-${String(cnt + 1).padStart(3, '0')}`, name, type: 'DEALER' } }); dealers++; } counterpartyType = 'DEALER'; counterpartyId = c.id; }
    else if (/^AR – Franchise /i.test(r.title) && branch?.type === 'FRANCHISE') { counterpartyType = 'FRANCHISE'; counterpartyId = branch.id; const cust = await prisma.customer.findFirst({ where: { locationId: branch.id } }); if (cust && !r.title.includes('(Store)')) await prisma.customer.update({ where: { id: cust.id }, data: { arAccountId: undefined } }); }
    else if (/^AR – Agent For Selling/i.test(r.title)) counterpartyType = 'AGENT';
    else if (/^Accounts Payable – /i.test(r.title)) counterpartyType = 'SUPPLIER';
    const acct = await prisma.account.create({ data: { code, title: r.title, class: r.class, normalBalance: NORMAL_BALANCE[r.class], branchTagId: branch?.id ?? null, channelTag: r.channelTag, entryScope: r.entryScope, isPaymentAccount: r.isPaymentAccount, paymentAccountType: r.paymentAccountType as never, counterpartyType, counterpartyId, templateId: tpl?.id ?? null } });
    byTitle.set(tkey(r.title), acct.id); created++;
    if (dealer && counterpartyId) await prisma.customer.update({ where: { id: counterpartyId }, data: { arAccountId: acct.id } });
    if (r.beginningDebit || r.beginningCredit) { await prisma.beginningBalance.upsert({ where: { fiscalYear_accountId: { fiscalYear, accountId: acct.id } }, create: { fiscalYear, accountId: acct.id, debit: money(r.beginningDebit), credit: money(r.beginningCredit) }, update: {} }); balances++; }
  }
  // company-wide accounts the posting rules need (created only when the workbook lacks them)
  let globals = 0;
  for (const g of GLOBAL_ACCOUNTS) {
    const exists = (g.code && usedCodes.has(g.code)) || byTitle.has(tkey(g.title));
    if (exists) continue;
    const code = g.code && !usedCodes.has(g.code) ? g.code : nextCodeInRange(g.class, usedCodes); usedCodes.add(code);
    const a = await prisma.account.create({ data: { code, title: g.title, class: g.class, normalBalance: NORMAL_BALANCE[g.class], entryScope: 'MAIN', isPaymentAccount: g.class === 'CASH', paymentAccountType: (g.paymentAccountType ?? null) as never } });
    byTitle.set(tkey(g.title), a.id); globals++; console.log(`  + company-wide account ${code} ${g.title}`);
  }
  const bb = await prisma.beginningBalance.aggregate({ where: { fiscalYear }, _sum: { debit: true, credit: true } });
  console.log(`  accounts: ${rows.length} parsed → ${created} created (+${globals} company-wide), ${dealers} dealer customers added, ${balances} beginning balances FY${fiscalYear} (Dr ${bb._sum.debit} / Cr ${bb._sum.credit})`);
}
