/**
 * End-to-end flow against the real Nest app + Postgres (seeded). Covers §19 acceptance criteria:
 * redaction on live endpoints for every role, receive→cost approve→transfer→confirm→FEFO sale→ledger reconcile,
 * special-price approval, bulk approvals, post-close edit needing Head AND Asst, count→discrepancy→final→charge form→HR allocation,
 * branch scoping (403 outside assignment, HR blocked from ops routes).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authenticator } from 'otplib';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/main';
import { ApprovalsService } from '../src/approvals/approvals.service';

const PW = process.env.SEED_PASSWORD || 'ChangeMe!2026';
const TOTP_ROLES = ['admin', 'ext.auditor', 'head.auditor', 'acct.head'];
let app: INestApplication; let http: ReturnType<typeof request>; const prisma = new PrismaClient();
const tokens: Record<string, string> = {};
const run = Date.now().toString(36);

async function login(username: string): Promise<string> {
  if (tokens[username]) return tokens[username];
  const r = await http.post('/api/auth/login').send({ identifier: username, password: PW }).expect(201);
  const token = r.body.token as string;
  if (r.body.totpRequired) {
    const setup = await http.post('/api/auth/totp/setup').set('Authorization', `Bearer ${token}`);
    let secret: string | undefined = setup.body?.secret;
    if (!secret) { const u = await prisma.user.findUniqueOrThrow({ where: { username } }); secret = u.totpSecret!; }
    await http.post('/api/auth/totp/verify').set('Authorization', `Bearer ${token}`).send({ code: authenticator.generate(secret) }).expect(201);
  }
  // personal accounts: the person accepts the accountability statement once before working
  const me = await http.get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
  if (!me.body.accountabilityAcceptedAt) await http.post('/api/auth/accept-accountability').set('Authorization', `Bearer ${token}`).expect(201);
  tokens[username] = token; return token;
}
const USERS = ['admin', 'ext.auditor', 'head.auditor', 'asst.auditor', 'audit.assoc', 'wh.incharge', 'wh.assoc', 'sales.westave', 'fr.mayon.assoc', 'fr.mayon.owner', 'custom.user', 'acct.head', 'acct.assoc', 'hr.staff', 'field.auditor', 'sales.dasma', 'sales.csr'];
const as = (u: string) => ({ get: (p: string) => http.get(p).set('Authorization', `Bearer ${tokens[u]}`), post: (p: string) => http.post(p).set('Authorization', `Bearer ${tokens[u]}`), put: (p: string) => http.put(p).set('Authorization', `Bearer ${tokens[u]}`) });
const has = (o: unknown, re: RegExp): boolean => JSON.stringify(o).match(re) !== null;
const ok = (r: request.Response) => { if (r.status >= 400) throw new Error(`${r.request?.method} ${r.request?.url} → ${r.status} ${JSON.stringify(r.body)}`); return r; };

/** The suite is idempotent: transactional tables are truncated before each run (master data + seed users stay). Never run against production. */
async function resetTransactionalData() {
  if (process.env.NODE_ENV !== 'test') throw new Error('refusing to reset data outside NODE_ENV=test');
  await prisma.$executeRawUnsafe(`TRUNCATE stock_ledger, stock_balances, receiving_lines, receiving_docs, transfer_lines, transfer_docs, sales_lines, payment_allocations, payments, sales_docs, expense_docs, count_lines, count_docs, discrepancy_cases, charge_form_allocations, charge_form_lines, charge_forms, expiry_writeoff_lines, expiry_writeoff_docs, approval_decisions, approval_requests, notifications, audit_log, batches, daily_closes, post_close_edits, journal_lines, journal_vouchers, beginning_balances, accounting_periods, voucher_sequences, control_sequences, alert_states, attachments, employee_loans, payroll_lines, payroll_runs, employees, min_stock_levels, revaluation_lines, revaluation_entries, cash_deposits, login_session_records, cash_fund_txns, cash_fund_checks, store_inspections, contribution_remittances, document_revisions CASCADE`);
  await prisma.$executeRawUnsafe(`UPDATE cash_funds SET balance = imprest_amount`);
  await prisma.priceList.deleteMany({ where: { product: { name: { startsWith: 'E2E ' } } } });
  await prisma.productCost.deleteMany({ where: { product: { name: { startsWith: 'E2E ' } } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
  await prisma.supplier.deleteMany({ where: { name: { startsWith: 'Secret Supplier ' } } });
  await prisma.setting.deleteMany();
}

beforeAll(async () => { await resetTransactionalData(); app = await createApp(); await app.init(); http = request(app.getHttpServer()); for (const u of USERS) await login(u); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('auth & 2FA', () => {
  it('rejects bad credentials and gates TOTP roles', async () => {
    await http.post('/api/auth/login').send({ identifier: 'admin', password: 'wrong' }).expect(401);
    const r = await http.post('/api/auth/login').send({ identifier: 'admin', password: PW }).expect(201);
    expect(r.body.totpRequired).toBe(true);
    await http.get('/api/products').set('Authorization', `Bearer ${r.body.token}`).expect(401);
  });
  it('me works for every seeded role', async () => {
    for (const u of USERS) { const r = ok(await as(u).get('/api/auth/me')); expect(r.body.username).toBe(u); }
    expect(TOTP_ROLES.length).toBe(4);
  });
});

describe('Phase 1 flow: receive → approve cost → transfer → confirm → FEFO sale → reconcile', () => {
  let productId: string; let whId: string; let branchId: string; let supplierId: string; let receivingId: string; let transferId: string; let saleId: string; let batchNear: string; let batchFar: string;
  const P = `E2E Whey ${run}`;
  it('admin sets up a supplier and a product with tiers + standard cost', async () => {
    const locs = ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[];
    whId = locs.find((l) => l.code === 'WH')!.id; branchId = locs.find((l) => l.code === 'WESTAVE')!.id;
    supplierId = ok(await as('admin').post('/api/suppliers').send({ name: `Secret Supplier ${run}`, termsDays: 30 })).body.id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    productId = ok(await as('admin').post('/api/products').send({ name: P, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, supplierId, prices: { RETAIL: 1500, DEALER: 1200, FRANCHISE: 1100 }, cost: 900 })).body.id;
    await as('admin').put('/api/min-stock').send({ rows: [{ productId, locationId: branchId, minQty: 5 }] }).expect(200);
  });
  it('warehouse associate cannot see cost or supplier name; receives with expiry; cost field forbidden', async () => {
    const list = ok(await as('wh.assoc').get(`/api/products?search=${encodeURIComponent(P)}`)).body;
    expect(has(list, /"cost"/)).toBe(false); expect(has(list, /Secret Supplier/)).toBe(false); expect(has(list, /SUP-\d+/)).toBe(true);
    await as('wh.assoc').post('/api/receiving').send({ supplierId, supplierRef: 'INV-1', lines: [{ productId, qty: 10, expiryDate: '2026-12-31', batchNo: 'NEAR' }, { productId, qty: 10, expiryDate: '2028-06-30', batchNo: 'FAR', unitCost: 5 }] }).expect(403);
    const r = ok(await as('wh.assoc').post('/api/receiving').send({ supplierId, supplierRef: 'INV-1', lines: [{ productId, qty: 10, expiryDate: '2026-12-31', batchNo: 'NEAR', freeQty: 1 }, { productId, qty: 10, expiryDate: '2028-06-30', batchNo: 'FAR' }] }));
    receivingId = r.body.id; expect(r.body.warnings.length).toBe(1); // short-dated warning
    await as('wh.assoc').post('/api/receiving').send({ supplierId, lines: [{ productId, qty: 1, expiryDate: '2020-01-01' }] }).expect(400);
  });
  it('submit creates COST_ON_RECEIVING with 24 h auto-approve (unchanged cost); Head Auditor approves; batches + ledger posted', async () => {
    await as('wh.assoc').post(`/api/receiving/${receivingId}/submit`).expect(400); // supplier invoice attachment required (§13)
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    await http.post(`/api/attachments/ReceivingDoc/${receivingId}`).set('Authorization', `Bearer ${tokens['wh.assoc']}`).attach('file', png, { filename: 'invoice.png', contentType: 'image/png' }).expect(201);
    await http.post(`/api/attachments/ReceivingDoc/${receivingId}`).set('Authorization', `Bearer ${tokens['wh.assoc']}`).attach('file', Buffer.from('not a png'), { filename: 'x.png', contentType: 'image/png' }).expect(400); // magic-byte check
    ok(await as('wh.assoc').post(`/api/receiving/${receivingId}/submit`));
    const inbox = ok(await as('head.auditor').get('/api/approvals/inbox?type=COST_ON_RECEIVING')).body;
    const req = inbox.items.find((i: { documentId: string }) => i.documentId === receivingId);
    expect(req).toBeTruthy(); expect(req.autoApproveAt).toBeNull(); expect(req.summary.allUnchanged).toBe(false); // first-ever receipt of this product = new product → never auto (§6.1)
    const doc = ok(await as('head.auditor').get(`/api/receiving/${receivingId}`)).body;
    expect(doc.lines[0].currentStandardCost).toBe('900'); expect(has(doc, /Secret Supplier/)).toBe(true);
    await as('wh.assoc').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    ok(await as('head.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE', note: 'same cost' }));
    const posted = ok(await as('head.auditor').get(`/api/receiving/${receivingId}`)).body;
    expect(posted.status).toBe('POSTED');
    const batches = ok(await as('head.auditor').get(`/api/stock/batches/${productId}?locationId=${whId}`)).body as { batchId: string; batchNo: string; qty: number; unitCost: string }[];
    batchNear = batches.find((b) => b.batchNo === 'NEAR')!.batchId; batchFar = batches.find((b) => b.batchNo === 'FAR')!.batchId;
    expect(batches.find((b) => b.batchNo === 'NEAR')!.qty).toBe(11); expect(batches.find((b) => b.batchNo === 'FAR')!.unitCost).toBe('900');
    // a repeat receipt with unchanged cost arms the 24 h auto-approve
    const r2 = ok(await as('wh.assoc').post('/api/receiving').send({ supplierId, supplierRef: 'INV-2', lines: [{ productId, qty: 1, expiryDate: '2029-01-01', batchNo: 'AUTO' }] })).body;
    await http.post(`/api/attachments/ReceivingDoc/${r2.id}`).set('Authorization', `Bearer ${tokens['wh.assoc']}`).attach('file', png, { filename: 'invoice2.png', contentType: 'image/png' }).expect(201);
    ok(await as('wh.assoc').post(`/api/receiving/${r2.id}/submit`));
    const req2 = (ok(await as('head.auditor').get('/api/approvals/inbox?type=COST_ON_RECEIVING'))).body.items.find((i: { documentId: string }) => i.documentId === r2.id);
    expect(req2.autoApproveAt).toBeTruthy(); expect(req2.summary.allUnchanged).toBe(true);
    await prisma.approvalRequest.update({ where: { id: req2.id }, data: { autoApproveAt: new Date(Date.now() - 1000) } });
    ok(await as('admin').post('/api/alerts/run')); // any job tick; auto-approve also runs from the scheduler
    await app.get(ApprovalsService).runAutoApprovals();
    expect((await prisma.receivingDoc.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe('POSTED');
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req2.id } })).status).toBe('AUTO_APPROVED');
  });
  it('branch sends a stock request; warehouse prepares the transfer (FEFO picks NEAR first); Asst Auditor alone can approve (any-of); receiver confirms with shortfall', async () => {
    await as('sales.westave').post('/api/transfers').send({ fromLocationId: whId, toLocationId: branchId, transferType: 'RESTOCK', lines: [{ productId, qty: 12 }] }).expect(403); // receiving branch makes no form
    ok(await as('sales.westave').post('/api/transfers/request-stock').send({ items: [{ productId, qty: 12 }], notes: 'weekend stock' }));
    const t = ok(await as('wh.assoc').post('/api/transfers').send({ fromLocationId: whId, toLocationId: branchId, transferType: 'RESTOCK', lines: [{ productId, qty: 12 }] })).body;
    transferId = t.id; expect(t.lines.map((l: { batch: { batchNo: string }; qtySent: number }) => [l.batch.batchNo, l.qtySent])).toEqual([['NEAR', 11], ['FAR', 1]]);
    expect(t.controlNo).toMatch(/^WH-PO-\d{6}$/); expect(t.transferInNo).toMatch(/^WA-TI-\d{6}$/);
    ok(await as('wh.assoc').post(`/api/transfers/${transferId}/submit`));
    const inbox = ok(await as('asst.auditor').get('/api/approvals/inbox?type=TRANSFER_INTERNAL')).body;
    const req = inbox.items.find((i: { documentId: string }) => i.documentId === transferId);
    ok(await as('asst.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    const approved = ok(await as('sales.westave').get(`/api/transfers/${transferId}`)).body; expect(approved.status).toBe('APPROVED');
    // in transit: warehouse no longer counts it, branch not yet
    expect(ok(await as('sales.westave').get(`/api/stock/warehouse-availability?productIds=${productId}`)).body.find((x: { productId: string }) => x.productId === productId)?.qty ?? 0).toBe(10);
    const lines = approved.lines as { id: string; qtySent: number; batch: { batchNo: string } }[];
    await as('sales.westave').post(`/api/transfers/${transferId}/confirm`).send({ lines: lines.map((l) => ({ lineId: l.id, qtyReceived: l.qtySent + 1 })) }).expect(400); // overage not allowed
    const near = lines.find((l) => l.batch.batchNo === 'NEAR')!; const far = lines.find((l) => l.batch.batchNo === 'FAR')!;
    const c = ok(await as('sales.westave').post(`/api/transfers/${transferId}/confirm`).send({ lines: [{ lineId: near.id, qtyReceived: 10, discrepancyNote: '1 damaged box' }, { lineId: far.id, qtyReceived: 1 }] })).body;
    expect(c.status).toBe('DISCREPANCY');
    ok(await as('head.auditor').post(`/api/transfers/${transferId}/resolve`).send({ resolution: 'WRITEOFF' }));
    expect(ok(await as('head.auditor').get(`/api/transfers/${transferId}`)).body.status).toBe('RESOLVED');
  });
  it('sales associate sells at branch: FEFO deducts NEAR batch, qty > on-hand blocked, unit cost redacted, DR uniqueness enforced', async () => {
    const soh = ok(await as('sales.westave').get(`/api/stock/on-hand?locationId=${branchId}&search=${encodeURIComponent(P)}`)).body as { batchNo: string; qty: number }[];
    expect(soh.reduce((s, x) => s + x.qty, 0)).toBe(11); expect(has(soh, /unitCost|valueAtCost/)).toBe(false);
    await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `DR-${run}-BIG`, lines: [{ productId, qty: 50 }] }).expect(400);
    await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'ONLINE', drSiNo: `DR-${run}-ON`, lines: [{ productId, qty: 1 }] }).expect(400); // needs payment account + proof
    const s = ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `DR-${run}-1`, lines: [{ productId, qty: 2 }] })).body;
    saleId = s.id; expect(s.grandTotal).toBe('3000'); expect(s.lines[0].batch.batchNo).toBe('NEAR'); expect(s.lines[0].nearExpiryWarn).toBe(false);
    expect(has(s, /unitCost/)).toBe(false); expect(s.lines[0].unitPrice).toBe('1500');
    await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `DR-${run}-1`, lines: [{ productId, qty: 1 }] }).expect(400); // one SalesDoc per DR/SI
  });
  it('special price below tier → SPECIAL_PRICE approval for Admin with margin visible; sale is posted to stock immediately', async () => {
    const s = ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `DR-${run}-SP`, lines: [{ productId, qty: 1, unitPrice: 1300 }] })).body;
    expect(s.specialPriceStatus).toBe('PENDING'); expect(s.lines[0].specialPriceFlag).toBe('PENDING');
    const inbox = ok(await as('admin').get('/api/approvals/inbox?type=SPECIAL_PRICE')).body;
    const req = inbox.items.find((i: { documentId: string }) => i.documentId === s.id);
    expect(Number(req.summary.lines[0].unitCost)).toBe(900); expect(Number(req.summary.lines[0].grossMargin)).toBe(400); expect(req.summary.lines[0].discountPct).toBeCloseTo(13.3, 0);
    // sales associate must not see cost in their own approvals view
    const mine = ok(await as('sales.westave').get('/api/approvals/mine')).body; expect(has(mine, /unitCost|grossMargin/)).toBe(false);
    ok(await as('admin').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    expect(ok(await as('sales.westave').get(`/api/sales/${s.id}`)).body.specialPriceStatus).toBe('APPROVED');
  });
  it('stock balances reconcile to the ledger for the product', async () => {
    const bal = await prisma.stockBalance.findMany({ where: { productId } });
    for (const b of bal) { const led = await prisma.stockLedger.aggregate({ where: { productId, locationId: b.locationId, batchId: b.batchId }, _sum: { qtyDelta: true } }); expect(b.qty, `balance ${b.locationId}/${b.batchId}`).toBe(led._sum.qtyDelta ?? 0); }
    const branchQty = bal.filter((b) => b.locationId === branchId).reduce((s, b) => s + b.qty, 0); expect(branchQty).toBe(8); // 11 − 2 − 1
    const whQty = bal.filter((b) => b.locationId === whId).reduce((s, b) => s + b.qty, 0); expect(whQty).toBe(10);
    const transit = await prisma.location.findUniqueOrThrow({ where: { code: 'V-TRANSIT' } }); expect(bal.filter((b) => b.locationId === transit.id).reduce((s, b) => s + b.qty, 0)).toBe(0);
    expect(has(await prisma.stockLedger.findMany({ where: { productId, movementType: 'EXPIRED_WRITEOFF' } }), /EXPIRED_WRITEOFF/)).toBe(true);
    void batchNear; void batchFar;
  });
  it('daily inventory report: associates get quantities only, cost-view roles get costing automatically, other branches forbidden', async () => {
    const url = `/api/stock/daily-inventory?locationId=${branchId}&from=2026-01-01&to=2026-12-31`;
    const assoc = ok(await as('sales.westave').get(url)).body as { days: string[]; products: { sales: number; end: number }[]; totals: Record<string, unknown> };
    expect(assoc.days.length).toBe(365); expect(assoc.products.length).toBeGreaterThan(0); expect(assoc.products.some((p) => p.sales > 0)).toBe(true);
    expect(has(assoc, /Cost|unitCost/)).toBe(false);
    const head = ok(await as('head.auditor').get(url)).body as { totals: { salesCost: number; endCost: number } };
    expect(typeof head.totals.salesCost).toBe('number'); expect(has(head, /salesCost/)).toBe(true);
    await as('sales.westave').get(`/api/stock/daily-inventory?locationId=${whId}&from=2026-09-01&to=2026-09-02`).expect(403);
    await as('hr.staff').get(url).expect(403);
    await as('head.auditor').get(`/api/stock/daily-inventory?locationId=${branchId}&from=2026-09-05&to=2026-09-01`).expect(400);
    const x = await as('sales.westave').get(`/api/reports/daily-inventory.xlsx?locationId=${branchId}&from=2026-09-01&to=2026-09-30`).expect(200);
    expect(x.headers['content-type']).toContain('spreadsheet');
  });
  it('AR/PDC sale, partial payment → credit note, overdue list; daily sales report exports (xlsx + pdf/html) with no cost', async () => {
    const dealer = (ok(await as('sales.westave').get('/api/customers?type=DEALER')).body as { id: string }[])[0];
    const ar = ok(await as('sales.westave').post('/api/sales').send({ channel: 'DEALER', paymentMode: 'AR_PDC', customerId: dealer.id, drSiNo: `DR-${run}-AR`, dueDate: '2026-01-01', lines: [{ productId, qty: 1 }] })).body;
    expect(ar.lines[0].priceTier).toBe('DEALER'); expect(ar.grandTotal).toBe('1200');
    const list = ok(await as('sales.westave').get(`/api/ar?locationId=${branchId}&overdue=1`)).body as { id: string; daysOverdue: number }[];
    expect(list.find((x) => x.id === ar.id)!.daysOverdue).toBeGreaterThan(0);
    // branch-entered AR payment waits for Accounting; nothing is applied until approved
    const pay = ok(await as('sales.westave').post('/api/ar/payments').send({ salesDocIds: [ar.id], amount: 700, paymentMode: 'CASH' })).body;
    expect(pay.creditNoteNo).toMatch(/^WA-CN-\d{6}$/); expect(pay.status).toBe('PENDING'); expect(pay.allocations).toHaveLength(0);
    expect(ok(await as('sales.westave').get(`/api/sales/${ar.id}`)).body.balance).toBe('1200');
    await as('sales.westave').post('/api/ar/payments').send({ salesDocIds: [ar.id], amount: 600, paymentMode: 'CASH' }).expect(400); // 700 already pending of 1200
    const areq = (ok(await as('acct.assoc').get('/api/approvals/inbox?type=AR_PAYMENT')).body.items as { id: string; documentId: string }[]).find((i) => i.documentId === pay.id)!;
    await as('head.auditor').post(`/api/approvals/${areq.id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    ok(await as('acct.assoc').post(`/api/approvals/${areq.id}/decide`).send({ decision: 'APPROVE' }));
    expect(ok(await as('sales.westave').get(`/api/sales/${ar.id}`)).body.balance).toBe('500');
    // Accounting records a payment directly; it applies at once
    const direct = ok(await as('acct.head').post('/api/ar/payments').send({ salesDocIds: [ar.id], amount: 100, paymentMode: 'CASH' })).body;
    expect(direct.status).toBe('POSTED'); expect(ok(await as('sales.westave').get(`/api/sales/${ar.id}`)).body.balance).toBe('400');
    const rep = ok(await as('sales.westave').get(`/api/reports/daily-sales?locationId=${branchId}`)).body;
    expect(Number(rep.cash.walkIn)).toBe(4300); expect(has(rep, /cost/i)).toBe(false);
    const x = await as('sales.westave').get(`/api/reports/daily-sales.xlsx?locationId=${branchId}`); expect(x.status).toBe(200); expect(x.headers['content-type']).toContain('spreadsheetml');
    const p = await as('sales.westave').get(`/api/reports/daily-sales.pdf?locationId=${branchId}`); expect(p.status).toBe(200);
    await as('sales.westave').get(`/api/reports/daily-sales?locationId=${branchId}&audit=1`).expect(403);
    const audit = ok(await as('head.auditor').get(`/api/reports/daily-sales?locationId=${branchId}&audit=1`)).body; expect(audit.audit.costOfSales).toBeDefined();
    const form = await as('sales.westave').get(`/api/reports/forms/dr-sales/${saleId}.pdf`); expect(form.status).toBe(200);
  });
  it('branch expense uses only branch-tagged accounts; main accounts forbidden for associates', async () => {
    ok(await as('admin').post(`/api/accounts/generate/${branchId}`));
    const accts = ok(await as('sales.westave').get('/api/expenses/accounts')).body as { id: string; title: string; branchTagId: string }[];
    expect(accts.length).toBeGreaterThan(5); expect(accts.every((a) => a.branchTagId === branchId)).toBe(true);
    const meralco = accts.find((a) => /Meralco/.test(a.title))!;
    const e = ok(await as('sales.westave').post('/api/expenses').send({ accountId: meralco.id, amount: 300, paidFrom: 'CASH_DRAWER', payee: 'Meralco' })).body; expect(e.controlNo).toMatch(/^WA-EX-\d{6}$/);
    const main = (ok(await as('acct.head').get('/api/expenses/accounts')).body as { id: string; title: string }[]).find((a) => /MDR/.test(a.title))!;
    await as('sales.westave').post('/api/expenses').send({ accountId: main.id, amount: 1, paidFrom: 'CASH_DRAWER' }).expect(403);
    const sum = ok(await as('sales.westave').get(`/api/closing/summary?locationId=${branchId}`)).body; expect(Number(sum.cashExpenses)).toBe(300); expect(Number(sum.expectedCash)).toBe(4300 + 700 - 300);
    const cc = ok(await as('sales.westave').post('/api/closing/cash-count').send({ breakdown: { '1000': 4, '500': 1, '100': 2 } })).body; expect(cc.cashVariance).toBe('0');
  });
  it('post-close edit needs BOTH Head and Asst Auditor; nothing changes until approved', async () => {
    // simulate a closed day: backdate the sale and close yesterday
    await prisma.salesDoc.update({ where: { id: saleId }, data: { docDate: new Date('2026-01-15T00:00:00Z') } });
    await as('sales.westave').post(`/api/sales/${saleId}/void`).send({ reason: 'oops' }).expect(400);
    const edit = ok(await as('sales.westave').post('/api/closing/edits').send({ documentType: 'SalesDoc', documentId: saleId, reason: 'wrong DR number', after: { drSiNo: `DR-${run}-1-FIXED` } })).body;
    expect((await prisma.salesDoc.findUniqueOrThrow({ where: { id: saleId } })).drSiNo).toBe(`DR-${run}-1`);
    const headInbox = ok(await as('head.auditor').get('/api/approvals/inbox?type=POST_CLOSE_EDIT')).body; const req = headInbox.items.find((i: { documentId: string }) => i.documentId === edit.id);
    expect(req.requiredApproverRoles.sort()).toEqual(['ASST_AUDITOR', 'HEAD_AUDITOR']);
    ok(await as('head.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING');
    expect((await prisma.salesDoc.findUniqueOrThrow({ where: { id: saleId } })).drSiNo).toBe(`DR-${run}-1`);
    await as('head.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }).expect(400); // no double vote
    ok(await as('asst.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.salesDoc.findUniqueOrThrow({ where: { id: saleId } })).drSiNo).toBe(`DR-${run}-1-FIXED`);
  });
  it('Audit Associate corrections go to the Head Auditor only, the staff member is notified, and the revision is logged against them', async () => {
    const hasNote = async (u: string, type: string) => JSON.stringify(ok(await as(u).get('/api/notifications')).body).includes(type);
    const edit = ok(await as('audit.assoc').post('/api/closing/edits').send({ documentType: 'SalesDoc', documentId: saleId, reason: 'DR number keyed wrong', after: { drSiNo: `DR-${run}-1-AUDIT` } })).body;
    expect(await hasNote('sales.westave', 'REVISION_REQUESTED')).toBe(true);
    const req = (ok(await as('head.auditor').get('/api/approvals/inbox?type=AUDIT_REVISION')).body.items as { id: string; documentId: string; requiredApproverRoles: string[] }[]).find((i) => i.documentId === edit.id)!;
    expect(req.requiredApproverRoles).toEqual(['HEAD_AUDITOR']);
    for (const u of ['asst.auditor', 'admin', 'audit.assoc']) await as(u).post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    expect((await prisma.salesDoc.findUniqueOrThrow({ where: { id: saleId } })).drSiNo).not.toBe(`DR-${run}-1-AUDIT`);
    ok(await as('head.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.salesDoc.findUniqueOrThrow({ where: { id: saleId } })).drSiNo).toBe(`DR-${run}-1-AUDIT`);
    expect(await hasNote('sales.westave', 'DOCUMENT_REVISED')).toBe(true);
    const log = ok(await as('hr.staff').get('/api/revisions')).body as { source: string; staff: string; requestedByName: string; approvedByName: string; documentId: string }[];
    expect(log.find((r) => r.documentId === saleId && r.source === 'AUDIT_REVISION')).toBeTruthy();
    const byStaff = ok(await as('head.auditor').get('/api/revisions/by-staff')).body as { staffUserId: string; total: number; bySource: Record<string, number> }[];
    const me = ok(await as('sales.westave').get('/api/auth/me')).body;
    const row = byStaff.find((r) => r.staffUserId === (me.user?.id ?? me.id))!; expect(row.total).toBeGreaterThanOrEqual(2); expect(row.bySource.AUDIT_REVISION).toBe(1);
    for (const u of ['sales.westave', 'acct.assoc']) await as(u).get('/api/revisions').expect(403);
  });
  it('bulk approve with mixed selection reports per-item results', async () => {
    const t1 = ok(await as('wh.assoc').post('/api/transfers').send({ fromLocationId: whId, toLocationId: branchId, transferType: 'RESTOCK', lines: [{ productId, qty: 1 }] })).body; ok(await as('wh.assoc').post(`/api/transfers/${t1.id}/submit`));
    const t2 = ok(await as('wh.assoc').post('/api/transfers').send({ fromLocationId: whId, toLocationId: branchId, transferType: 'RESTOCK', lines: [{ productId, qty: 1 }] })).body; ok(await as('wh.assoc').post(`/api/transfers/${t2.id}/submit`));
    const inbox = ok(await as('head.auditor').get('/api/approvals/inbox?type=TRANSFER_INTERNAL')).body;
    const ids = inbox.items.filter((i: { documentId: string }) => [t1.id, t2.id].includes(i.documentId)).map((i: { id: string }) => i.id);
    const r = ok(await as('head.auditor').post('/api/approvals/bulk').send({ ids: [...ids, '00000000-0000-0000-0000-000000000000'], decision: 'APPROVE', note: 'bulk' })).body;
    expect(r.filter((x: { ok: boolean }) => x.ok)).toHaveLength(2); expect(r.filter((x: { ok: boolean }) => !x.ok)).toHaveLength(1);
    expect(ok(await as('sales.westave').get(`/api/transfers/${t1.id}`)).body.status).toBe('APPROVED');
  });
  it('count → discrepancy case → deadline job → final report + charge form at franchise cost → HR allocates & finalizes (no cost visible to HR)', async () => {
    const c = ok(await as('field.auditor').post('/api/counts').send({ locationId: branchId })).body;
    const line = c.lines.find((l: { productId: string }) => l.productId === productId); expect(line.systemQty).toBe(7); // 11 in − 2 − 1 − 1 sold
    ok(await as('field.auditor').put(`/api/counts/${c.id}/lines`).send({ lines: c.lines.map((l: { productId: string; systemQty: number }) => ({ productId: l.productId, actualQty: l.productId === productId ? 5 : l.systemQty })) }));
    const submitted = ok(await as('field.auditor').post(`/api/counts/${c.id}/submit`)).body;
    expect(submitted.discrepancyCase.status).toBe('OPEN');
    await prisma.discrepancyCase.update({ where: { id: submitted.discrepancyCase.id }, data: { deadline: new Date(Date.now() - 1000) } });
    const job = ok(await as('admin').post('/api/discrepancies/run-deadline')).body; expect(job.finalized).toBeGreaterThanOrEqual(1);
    const cs = ok(await as('head.auditor').get(`/api/discrepancies/${submitted.discrepancyCase.id}`)).body;
    expect(cs.status).toBe('FINALIZED'); expect(cs.chargeForm.lines[0].unitCharge).toBe('1100'); expect(cs.chargeForm.totalAmount).toBe('2200');
    // HR side
    const hrView = ok(await as('hr.staff').get(`/api/charge-forms/${cs.chargeForm.id}`)).body; expect(has(hrView, /batchCost|unitCost/)).toBe(false); expect(hrView.lines[0].unitCharge).toBe('1100');
    await as('hr.staff').get('/api/sales').expect(403); await as('hr.staff').get('/api/stock/on-hand').expect(403);
    const emp1 = ok(await as('hr.staff').post('/api/payroll/employees').send({ employeeNo: `E-${run}-1`, fullName: 'Ana', locationId: branchId, basicRate: 15000 })).body;
    const emp2 = ok(await as('hr.staff').post('/api/payroll/employees').send({ employeeNo: `E-${run}-2`, fullName: 'Ben', locationId: branchId, basicRate: 15000 })).body;
    await as('hr.staff').put(`/api/charge-forms/${cs.chargeForm.id}/allocations`).send({ allocations: [{ employeeId: emp1.id, amount: 1000 }] }).expect(400); // must equal total
    ok(await as('hr.staff').put(`/api/charge-forms/${cs.chargeForm.id}/allocations`).send({ allocations: [{ employeeId: emp1.id, amount: 1200 }, { employeeId: emp2.id, amount: 1000 }], schedule: { periods: 4 } }));
    const fin = ok(await as('hr.staff').post(`/api/charge-forms/${cs.chargeForm.id}/finalize`)).body; expect(fin.finalizedByHrAt).toBeTruthy();
    expect((await prisma.stockBalance.aggregate({ where: { productId, locationId: branchId }, _sum: { qty: true } }))._sum.qty).toBe(5); // ADJUST_COUNT brought on-hand to the counted 5
  });
  it('alerts: critical stock and expiry buckets; run jobs', async () => {
    const crit = ok(await as('sales.westave').get(`/api/alerts/critical-stock?locationId=${branchId}`)).body as { product: { id: string } }[];
    expect(crit.some((x) => x.product.id === productId)).toBe(true); // 5 on hand ≤ min 5
    await as('admin').put('/api/min-stock').send({ rows: [{ productId, locationId: branchId, minQty: 10 }] });
    expect((ok(await as('sales.westave').get(`/api/alerts/critical-stock?locationId=${branchId}`)).body as { product: { id: string } }[]).some((x) => x.product.id === productId)).toBe(true);
    const exp = ok(await as('sales.westave').get(`/api/alerts/expiring?locationId=${branchId}`)).body; expect(exp.summary).toHaveLength(4); expect(has(exp, /valueAtCost/)).toBe(false); expect(has(exp, /valueAtSrp/)).toBe(true);
    const run1 = ok(await as('admin').post('/api/alerts/run')).body; expect(run1.minStock.critical).toBeGreaterThanOrEqual(1); // notified may be 0: one alert per product/location per day
    const notes = ok(await as('sales.westave').get('/api/notifications?unread=1')).body; expect(notes.some((n: { type: string }) => n.type === 'CRITICAL_STOCK')).toBe(true);
  });
});

describe('scoping & redaction on live endpoints', () => {
  it('sales associate cannot read another branch; franchise roles see franchise tier only; auditors see everything', async () => {
    const locs = ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[]; const dasma = locs.find((l) => l.code === 'DASMA')!.id;
    await as('sales.westave').get(`/api/stock/on-hand?locationId=${dasma}`).expect(403);
    await as('sales.westave').get(`/api/sales?locationId=${dasma}`).expect(403);
    const own = ok(await as('sales.westave').get('/api/sales')).body as { locationId: string }[]; expect(own.every((s) => s.locationId === locs.find((l) => l.code === 'WESTAVE')!.id)).toBe(true);
    const fr = ok(await as('fr.mayon.owner').get('/api/products?take=5')).body; for (const p of fr) for (const tier of Object.keys(p.tierPrices)) expect(['RETAIL', 'FRANCHISE']).toContain(tier);
    expect(has(fr, /"cost"/)).toBe(false);
    const ext = ok(await as('ext.auditor').get('/api/products?take=5')).body; expect(has(ext, /"cost"/)).toBe(true);
    await as('ext.auditor').post('/api/products').send({ name: 'x', categoryId: '00000000-0000-0000-0000-000000000000' }).expect(403); // read-only
    await as('acct.head').get('/api/fs/income-statement?year=2026').expect(403); ok(await as('acct.head').get('/api/gl/trial-balance?year=2026'));
    ok(await as('admin').get('/api/fs/balance-sheet?year=2026')); ok(await as('ext.auditor').get('/api/fs/income-statement?year=2026'));
    await as('acct.assoc').get('/api/payroll/runs').expect(200);
  });
  it('audit log records exports, approvals and permission changes', async () => {
    const log = ok(await as('admin').get('/api/audit-log?take=500')).body as { action: string }[];
    expect(log.some((l) => l.action === 'EXPORT')).toBe(true); expect(log.some((l) => l.action === 'APPROVE')).toBe(true); expect(log.some((l) => l.action === 'LOGIN')).toBe(true); expect(log.some((l) => l.action === 'LOGIN_FAILED')).toBe(true);
  });
});

describe('Phase 2: posting, period lock, beginning balances', () => {
  it('with auto posting enabled, a cash sale posts balanced R3 + R5 vouchers viewable from the source document; locked period blocks posting', async () => {
    ok(await as('admin').put('/api/settings').send({ 'gl.auto_posting_enabled': true }));
    const locs = ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[]; const branchId = locs.find((l) => l.code === 'WESTAVE')!.id;
    const products = ok(await as('admin').get(`/api/products?search=${encodeURIComponent('E2E Whey')}`)).body as { id: string }[];
    const s = ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `DR-${run}-GL`, lines: [{ productId: products[0].id, qty: 1 }] })).body;
    const vouchers = ok(await as('acct.head').get(`/api/gl/vouchers?sourceType=SalesDoc&sourceId=${s.id}`)).body as { rule: string; voucherNo: string; lines: { debit: string; credit: string }[] }[];
    expect(vouchers.map((v) => v.rule).sort()).toEqual(['R3', 'R5']);
    for (const v of vouchers) { expect(v.voucherNo).toMatch(/^A-2026-/); const dr = v.lines.reduce((t, l) => t + Number(l.debit), 0); const cr = v.lines.reduce((t, l) => t + Number(l.credit), 0); expect(dr).toBeCloseTo(cr, 2); }
    // period lock via Admin approval
    ok(await as('acct.head').post('/api/gl/periods/lock').send({ year: 2026, month: 1, lock: true }));
    const inbox = ok(await as('admin').get('/api/approvals/inbox?type=PERIOD_LOCK')).body; ok(await as('admin').post(`/api/approvals/${inbox.items[0].id}/decide`).send({ decision: 'APPROVE' }));
    await as('acct.head').post('/api/gl/vouchers').send({ date: '2026-01-10', book: 'GENERAL', lines: [{ accountId: (await prisma.account.findFirstOrThrow()).id, debit: 1 }, { accountId: (await prisma.account.findFirstOrThrow({ skip: 1 })).id, credit: 1 }] }).expect(400);
    // beginning balances must balance before submit
    const [a, b] = await prisma.account.findMany({ take: 2 });
    ok(await as('acct.head').put('/api/gl/beginning-balances?year=2026').send({ rows: [{ accountId: a.id, debit: 100 }] }));
    await as('acct.head').post('/api/gl/beginning-balances/submit?year=2026').expect(400);
    ok(await as('acct.head').put('/api/gl/beginning-balances?year=2026').send({ rows: [{ accountId: a.id, debit: 100 }, { accountId: b.id, credit: 100 }] }));
    ok(await as('acct.head').post('/api/gl/beginning-balances/submit?year=2026'));
    const bs = ok(await as('admin').get('/api/fs/balance-sheet?year=2026')).body; expect(bs.totals.shouldBeZero).toHaveLength(13);
    void branchId;
    ok(await as('admin').put('/api/settings').send({ 'gl.auto_posting_enabled': false }));
  });
});

describe('warehouse: transfers to any branch/franchise, In-Charge input, edits accepted by the preparer, printable drafts', () => {
  let productId: string; let whId: string; let mayonId: string; let westId: string; let transferId: string;
  const P = `E2E Casein ${run}`;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const qtyOf = (d: { lines: { qtySent: number }[] }) => d.lines.reduce((t, l) => t + l.qtySent, 0);

  it('In-Charge receives into the warehouse like the associate; cost only by the Head Auditor', async () => {
    const all = ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[];
    whId = all.find((l) => l.code === 'WH')!.id; mayonId = all.find((l) => l.code === 'MAYON')!.id; westId = all.find((l) => l.code === 'WESTAVE')!.id;
    const supplierId = ok(await as('admin').post('/api/suppliers').send({ name: `Secret Supplier ${run}-2`, termsDays: 30 })).body.id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    productId = ok(await as('admin').post('/api/products').send({ name: P, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, supplierId, prices: { RETAIL: 1000, DEALER: 900, FRANCHISE: 800 }, cost: 500 })).body.id;
    await as('wh.incharge').post('/api/receiving').send({ supplierId, lines: [{ productId, qty: 50, expiryDate: '2028-01-31', unitCost: 400 }] }).expect(403);
    const r = ok(await as('wh.incharge').post('/api/receiving').send({ supplierId, supplierRef: 'INV-WIC', lines: [{ productId, qty: 50, expiryDate: '2028-01-31', batchNo: 'C1' }] })).body;
    await http.post(`/api/attachments/ReceivingDoc/${r.id}`).set('Authorization', `Bearer ${tokens['wh.incharge']}`).attach('file', png, { filename: 'invoice.png', contentType: 'image/png' }).expect(201);
    ok(await as('wh.incharge').post(`/api/receiving/${r.id}/submit`));
    await as('wh.incharge').post(`/api/receiving/${r.id}/costs`).send({ costs: [] }).expect(403);
    const req = (ok(await as('head.auditor').get('/api/approvals/inbox?type=COST_ON_RECEIVING')).body.items as { id: string; documentId: string }[]).find((i) => i.documentId === r.id)!;
    ok(await as('head.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    expect(ok(await as('wh.incharge').get(`/api/receiving/${r.id}`)).body.status).toBe('POSTED');
  });

  it('warehouse associate sees every branch and franchise and drafts a transfer to a franchise; edits own draft; prints the DRAFT pull-out form', async () => {
    const locs = ok(await as('wh.assoc').get('/api/locations')).body as { code: string }[];
    expect(locs.map((l) => l.code)).toEqual(expect.arrayContaining(['WH', 'MAYON', 'WESTAVE']));
    const t = ok(await as('wh.assoc').post('/api/transfers').send({ fromLocationId: whId, toLocationId: mayonId, transferType: 'RESTOCK', lines: [{ productId, qty: 5 }] })).body;
    transferId = t.id; expect(t.status).toBe('DRAFT');
    const own = ok(await as('wh.assoc').put(`/api/transfers/${transferId}/edit`).send({ notes: 'for Mayon opening', lines: [{ productId, qty: 6 }] })).body;
    expect(own.applied).toBe(true);
    expect(qtyOf(ok(await as('wh.assoc').get(`/api/transfers/${transferId}`)).body)).toBe(6);
    const form = await as('wh.assoc').get(`/api/reports/forms/pull-out/${transferId}.pdf`).expect(200);
    const html = form.text || form.body.toString();
    expect(html).toContain('DRAFT'); expect(html).toContain('Warehouse Associate');
    await as('sales.westave').put(`/api/transfers/${transferId}/edit`).send({ lines: [{ productId, qty: 1 }] }).expect(403);
  });

  it("In-Charge's edit changes nothing until the associate accepts it; only that associate can decide", async () => {
    const p = ok(await as('wh.incharge').put(`/api/transfers/${transferId}/edit`).send({ lines: [{ productId, qty: 4 }] })).body;
    expect(p.applied).toBe(false); expect(p.awaiting).toBe('Warehouse Associate'); expect(p.changes).toContain(`${P}: qty 6 → 4`);
    expect(qtyOf(ok(await as('wh.assoc').get(`/api/transfers/${transferId}`)).body)).toBe(6);
    await as('wh.incharge').put(`/api/transfers/${transferId}/edit`).send({ lines: [{ productId, qty: 3 }] }).expect(400); // one pending edit at a time
    const inbox = ok(await as('wh.assoc').get('/api/approvals/inbox?type=WAREHOUSE_EDIT')).body.items as { id: string; documentId: string }[];
    const req = inbox.find((i) => i.documentId === transferId)!; expect(req).toBeTruthy();
    expect((ok(await as('head.auditor').get('/api/approvals/inbox?type=WAREHOUSE_EDIT')).body.items as { id: string }[]).some((i) => i.id === req.id)).toBe(false);
    await as('head.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    await as('wh.incharge').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    ok(await as('wh.assoc').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    const after = ok(await as('wh.assoc').get(`/api/transfers/${transferId}`)).body; expect(qtyOf(after)).toBe(4); expect(after.status).toBe('DRAFT');
    const wic = await prisma.user.findUniqueOrThrow({ where: { username: 'wh.incharge' } });
    expect(await prisma.auditLog.count({ where: { entityType: 'TransferDoc', entityId: transferId, action: 'EDIT_APPLIED', userId: wic.id } })).toBe(1);
  });

  it("receiving: In-Charge's edit to the associate's draft applies only after acceptance; the associate cannot see or enter cost", async () => {
    const supplierId = (await prisma.supplier.findFirstOrThrow({ where: { name: `Secret Supplier ${run}-2` } })).id;
    const r = ok(await as('wh.assoc').post('/api/receiving').send({ supplierId, supplierRef: 'INV-A', lines: [{ productId, qty: 12, expiryDate: '2028-03-31', batchNo: 'C2' }] })).body;
    await as('wh.assoc').put(`/api/receiving/${r.id}/edit`).send({ lines: [{ productId, qty: 12, expiryDate: '2028-03-31', unitCost: 1 }] }).expect(403);
    const p = ok(await as('wh.incharge').put(`/api/receiving/${r.id}/edit`).send({ supplierRef: 'INV-A2', lines: [{ productId, qty: 10, freeQty: 2, expiryDate: '2028-03-31', batchNo: 'C2' }] })).body;
    expect(p.applied).toBe(false); expect(p.changes).toEqual(['Supplier ref: INV-A → INV-A2', `${P}: qty 12 → 10, free 0 → 2`]);
    const req = (ok(await as('wh.assoc').get('/api/approvals/inbox?type=WAREHOUSE_EDIT')).body.items as { id: string; documentId: string }[]).find((i) => i.documentId === r.id)!;
    expect(ok(await as('wh.assoc').get(`/api/receiving/${r.id}`)).body.lines[0].qty).toBe(12);
    ok(await as('wh.assoc').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    const d = ok(await as('wh.assoc').get(`/api/receiving/${r.id}`)).body;
    expect(d.supplierRef).toBe('INV-A2'); expect(d.lines[0].qty).toBe(10); expect(d.lines[0].freeQty).toBe(2); expect(d.preparedByName).toBe('Warehouse Associate');
    const form = await as('wh.assoc').get(`/api/reports/forms/supplier-form/${r.id}.pdf`).expect(200);
    expect(form.text || form.body.toString()).toContain('DRAFT');
  });

  it('submitted transfer: rejected edit leaves it untouched; accepted edit resubmits it for approval (franchise → Admin)', async () => {
    await as('wh.incharge').post(`/api/transfers/${transferId}/submit`).expect(403); // only the preparer submits a draft
    ok(await as('wh.assoc').post(`/api/transfers/${transferId}/submit`));
    const first = (ok(await as('admin').get('/api/approvals/inbox?type=TRANSFER_TO_FRANCHISE')).body.items as { id: string; documentId: string }[]).find((i) => i.documentId === transferId)!;
    expect(first).toBeTruthy();
    ok(await as('wh.incharge').put(`/api/transfers/${transferId}/edit`).send({ lines: [{ productId, qty: 3 }] }));
    let req = (ok(await as('wh.assoc').get('/api/approvals/inbox?type=WAREHOUSE_EDIT')).body.items as { id: string; documentId: string }[]).find((i) => i.documentId === transferId)!;
    ok(await as('wh.assoc').post(`/api/approvals/${req.id}/decide`).send({ decision: 'REJECT', note: 'I counted 4' }));
    let doc = ok(await as('wh.assoc').get(`/api/transfers/${transferId}`)).body; expect(qtyOf(doc)).toBe(4); expect(doc.status).toBe('SUBMITTED');
    ok(await as('wh.incharge').put(`/api/transfers/${transferId}/edit`).send({ toLocationId: westId, lines: [{ productId, qty: 2 }] }));
    req = (ok(await as('wh.assoc').get('/api/approvals/inbox?type=WAREHOUSE_EDIT')).body.items as { id: string; documentId: string }[]).find((i) => i.documentId === transferId)!;
    ok(await as('wh.assoc').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    doc = ok(await as('wh.assoc').get(`/api/transfers/${transferId}`)).body;
    expect(qtyOf(doc)).toBe(2); expect(doc.toLocation.code).toBe('WESTAVE'); expect(doc.status).toBe('SUBMITTED');
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('CANCELLED');
    const internal = (ok(await as('asst.auditor').get('/api/approvals/inbox?type=TRANSFER_INTERNAL')).body.items as { documentId: string }[]).find((i) => i.documentId === transferId);
    expect(internal).toBeTruthy(); // new destination is a company branch → internal approval
    const edits = ok(await as('wh.assoc').get(`/api/transfers/${transferId}/edits`)).body as { status: string; proposedBy: string }[];
    expect(edits.map((e) => e.status).sort()).toEqual(['APPROVED', 'APPROVED', 'REJECTED']); expect(edits[0].proposedBy).toBe('Warehouse In-Charge');
    const hist = ok(await as('wh.assoc').get(`/api/history/TransferDoc/${transferId}`)).body as { action: string; by: string }[];
    expect(hist.some((h) => h.action === 'EDIT_PROPOSED' && h.by === 'Warehouse In-Charge')).toBe(true);
    expect(hist.some((h) => h.action === 'ACCEPTED EDIT' && h.by === 'Warehouse Associate')).toBe(true);
    expect(hist.filter((h) => h.action === 'EDIT' && h.by === 'Warehouse In-Charge').length).toBe(0); // proposals are not shown as edits
    expect(hist.some((h) => h.action === 'EDIT' && h.by === 'Warehouse Associate')).toBe(true); // the preparer's own draft edit
    await as('sales.dasma').get(`/api/history/TransferDoc/${transferId}`).expect(403);
  });

  it('the receiving branch never sees the sender\'s draft; it gets the Transfer-In copy once sent and ticks items to accept', async () => {
    const draft = ok(await as('wh.assoc').post('/api/transfers').send({ fromLocationId: whId, toLocationId: westId, transferType: 'RESTOCK', lines: [{ productId, qty: 1 }] })).body;
    await as('sales.westave').get(`/api/transfers/${draft.id}`).expect(404);
    expect((ok(await as('sales.westave').get('/api/transfers?direction=in')).body as { id: string }[]).some((t) => t.id === draft.id)).toBe(false);
    await as('sales.westave').get(`/api/reports/forms/transfer-in/${draft.id}.pdf`).expect(403);
    await as('sales.westave').post(`/api/transfers/${draft.id}/submit`).expect(404);
    // the submitted transfer from the earlier steps: receiver sees it, prints only the Transfer-In copy
    ok(await as('sales.westave').get(`/api/transfers/${transferId}`));
    await as('sales.westave').get(`/api/reports/forms/pull-out/${transferId}.pdf`).expect(403);
    await as('sales.westave').get(`/api/reports/forms/transfer-in/${transferId}.pdf`).expect(200);
    const req = (ok(await as('asst.auditor').get('/api/approvals/inbox?type=TRANSFER_INTERNAL')).body.items as { id: string; documentId: string }[]).find((i) => i.documentId === transferId)!;
    ok(await as('asst.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    const lines = ok(await as('sales.westave').get(`/api/transfers/${transferId}`)).body.lines as { id: string; qtySent: number }[];
    await as('sales.westave').post(`/api/transfers/${transferId}/confirm`).send({ lines: lines.map((l) => ({ lineId: l.id })) }).expect(400); // neither ticked nor counted
    await as('sales.westave').post(`/api/transfers/${transferId}/confirm`).send({ lines: lines.map((l) => ({ lineId: l.id, qtyReceived: 0 })) }).expect(400); // short without a note
    const done = ok(await as('sales.westave').post(`/api/transfers/${transferId}/confirm`).send({ lines: lines.map((l) => ({ lineId: l.id, checked: true })) })).body;
    expect(done.status).toBe('RECEIVED');
  });
});

describe('HR charges, cash fund, inspections, counts, AR & contacts (owner requests 2026-09-26)', () => {
  let westId: string; let whId: string; let waEmp: string; let whEmp: string; let casein: string;
  const notified = async (u: string, type: string) => JSON.stringify(ok(await as(u).get('/api/notifications')).body).includes(type);
  const fund = async () => (ok(await as('sales.westave').get('/api/cash-funds')).body as { balance: string }[])[0];

  it('setup: staff records linked to their accounts', async () => {
    const locs = ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[];
    westId = locs.find((l) => l.code === 'WESTAVE')!.id; whId = locs.find((l) => l.code === 'WH')!.id;
    const wa = await prisma.user.findUniqueOrThrow({ where: { username: 'sales.westave' } }); const wu = await prisma.user.findUniqueOrThrow({ where: { username: 'wh.assoc' } });
    waEmp = ok(await as('hr.staff').post('/api/payroll/employees').send({ employeeNo: `WA-${run}`, fullName: 'Sales Associate – West Ave', locationId: westId, basicRate: 18000, userId: wa.id, sssNo: '34-0000001-0' })).body.id;
    whEmp = ok(await as('hr.staff').post('/api/payroll/employees').send({ employeeNo: `WH-${run}`, fullName: 'Warehouse Associate', locationId: whId, basicRate: 16000, userId: wu.id })).body.id;
    casein = (await prisma.product.findFirstOrThrow({ where: { name: `E2E Casein ${run}` } })).id;
    const staff = ok(await as('field.auditor').get(`/api/staff?locationId=${westId}`)).body as { id: string; fullName: string }[];
    expect(staff.map((x) => x.id)).toContain(waEmp); expect(has(staff, /basicRate/)).toBe(false);
  });

  it('damaged items charged to staff: charge form auto-created and pre-allocated; staff sees and acknowledges; others see no names; HR finalizes', async () => {
    const batches = ok(await as('head.auditor').get(`/api/stock/batches/${casein}?locationId=${whId}`)).body as { batchId: string; qty: number }[];
    const before = batches.reduce((t, b) => t + b.qty, 0);
    await as('wh.incharge').post('/api/writeoffs').send({ locationId: whId, chargeTo: 'STAFF', employeeIds: [], lines: [{ productId: casein, batchId: batches[0].batchId, qty: 2, reason: 'DAMAGED' }] }).expect(400);
    const wo = ok(await as('wh.incharge').post('/api/writeoffs').send({ locationId: whId, chargeTo: 'STAFF', employeeIds: [whEmp], lines: [{ productId: casein, batchId: batches[0].batchId, qty: 2, reason: 'DAMAGED' }] })).body;
    expect(wo.controlNo).toMatch(/^WH-WO-\d{6}$/);
    const req = (ok(await as('head.auditor').get('/api/approvals/inbox?type=WRITEOFF')).body.items as { id: string; documentId: string; summary: { chargeTo: string } }[]).find((i) => i.documentId === wo.id)!;
    expect(req.summary.chargeTo).toContain('Warehouse Associate');
    ok(await as('head.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    const after = (ok(await as('head.auditor').get(`/api/stock/batches/${casein}?locationId=${whId}`)).body as { qty: number }[]).reduce((t, b) => t + b.qty, 0);
    expect(after).toBe(before - 2); // inventory reflects it automatically
    const doc = await prisma.expiryWriteoffDoc.findUniqueOrThrow({ where: { id: wo.id } });
    const cf = await prisma.chargeForm.findUniqueOrThrow({ where: { id: doc.chargeFormId! }, include: { allocations: true } });
    expect(cf.kind).toBe('DAMAGED'); expect(cf.controlNo).toMatch(/^WH-CF-\d{6}$/); expect(cf.allocations.map((a) => a.employeeId)).toEqual([whEmp]);
    expect(await notified('wh.assoc', 'CHARGE_TO_YOU')).toBe(true); expect(await notified('hr.staff', 'CHARGE_FORM_READY')).toBe(true);
    const mine = ok(await as('wh.assoc').get('/api/me/hr')).body; expect(mine.charges[0].chargeForm.id).toBe(cf.id); expect(has(mine, /batchCost|unitCost/)).toBe(false);
    await as('sales.westave').post(`/api/me/charges/${cf.allocations[0].id}/acknowledge`).expect(403);
    ok(await as('wh.assoc').post(`/api/me/charges/${cf.allocations[0].id}/acknowledge`));
    const asst = ok(await as('asst.auditor').get(`/api/charge-forms/${cf.id}`)).body; expect(asst.allocations).toEqual([]); expect(asst.allocationsHidden).toBe(1);
    ok(await as('hr.staff').post(`/api/charge-forms/${cf.id}/finalize`));
    const ded = await as('wh.assoc').get(`/api/reports/forms/deduction-authorization/${cf.allocations[0].id}.pdf`).expect(200); expect(ded.text || ded.body.toString()).toContain('Salary Deduction Authorization');
    // expired items the company absorbs: no charge form
    const b2 = ok(await as('head.auditor').get(`/api/stock/batches/${casein}?locationId=${whId}`)).body as { batchId: string }[];
    const wo2 = ok(await as('wh.incharge').post('/api/writeoffs').send({ locationId: whId, chargeTo: 'COMPANY', lines: [{ productId: casein, batchId: b2[0].batchId, qty: 1, reason: 'EXPIRED' }] })).body;
    const r2 = (ok(await as('head.auditor').get('/api/approvals/inbox?type=WRITEOFF')).body.items as { id: string; documentId: string }[]).find((i) => i.documentId === wo2.id)!;
    ok(await as('head.auditor').post(`/api/approvals/${r2.id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.expiryWriteoffDoc.findUniqueOrThrow({ where: { id: wo2.id } })).chargeFormId).toBeNull();
  });

  it('customer contact number and email on sales feed the customer contact list', async () => {
    ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `DR-${run}-CUST`, customerName: 'Maria Test', customerPhone: '0917 000 1234', customerEmail: 'maria@test.ph', lines: [{ productId: casein, qty: 1 }] }));
    const list = ok(await as('sales.westave').get('/api/reports/customers')).body as { name: string; contactNumber: string; email: string }[];
    expect(list.find((c) => c.email === 'maria@test.ph')).toMatchObject({ name: 'Maria Test', contactNumber: '0917 000 1234' });
    const x = await as('sales.westave').get('/api/reports/customers.xlsx').expect(200); expect(x.headers['content-type']).toContain('spreadsheetml');
  });

  it('branch cash fund: fund-paid expense lowers it, replenished from cash sales (lowers expected cash), Field Auditor confirms the cash found; balances on dashboards', async () => {
    expect((ok(await as('sales.westave').get('/api/cash-funds')).body as unknown[]).length).toBe(1);
    expect((ok(await as('acct.assoc').get('/api/cash-funds')).body as unknown[]).length).toBeGreaterThan(1);
    const accts = ok(await as('sales.westave').get(`/api/expenses/accounts?locationId=${westId}`)).body as { id: string; class: string; title: string }[];
    expect(accts.every((a) => a.class === 'OPEX')).toBe(true); // no direct cost for branch staff
    const dc = await prisma.account.findFirst({ where: { class: 'DIRECT_COST', branchTagId: westId } });
    if (dc) await as('sales.westave').post('/api/expenses').send({ accountId: dc.id, amount: 10, paidFrom: 'CASH_DRAWER' }).expect(403);
    const start = Number((await fund()).balance);
    ok(await as('sales.westave').post('/api/expenses').send({ accountId: accts[0].id, amount: 150, paidFrom: 'PETTY_CASH', payee: 'Water' }));
    expect(Number((await fund()).balance)).toBe(start - 150);
    const s1 = ok(await as('sales.westave').get(`/api/closing/summary?locationId=${westId}`)).body;
    const rep = ok(await as('sales.westave').post(`/api/cash-funds/${westId}/replenish`).send({})).body;
    expect(rep.controlNo).toMatch(/^WA-FR-\d{6}$/); expect(Number(rep.amount)).toBe(150); expect(Number((await fund()).balance)).toBe(start);
    const s2 = ok(await as('sales.westave').get(`/api/closing/summary?locationId=${westId}`)).body;
    expect(Number(s2.expectedCash)).toBe(Number(s1.expectedCash) - 150);
    await as('sales.westave').post(`/api/cash-funds/${westId}/replenish`).send({}).expect(400);
    const v = await as('sales.westave').get(`/api/reports/forms/fund-replenishment/${rep.id}.pdf`).expect(200); expect(v.text || v.body.toString()).toContain('Water');
    const dsr = ok(await as('sales.westave').get(`/api/reports/daily-sales?locationId=${westId}`)).body; expect(JSON.stringify(dsr.expenses)).toContain('Cash Fund Replenishment');
    ok(await as('field.auditor').post(`/api/cash-funds/${westId}/check`).send({ countedAmount: start }));
    await as('field.auditor').post(`/api/cash-funds/${westId}/check`).send({ countedAmount: start - 170 }).expect(400);
    ok(await as('field.auditor').post(`/api/cash-funds/${westId}/check`).send({ countedAmount: start - 170, reason: 'expense 170.00 no receipt yet' }));
    expect(await notified('admin', 'CASH_FUND_DIFFERENCE')).toBe(true);
    await as('sales.westave').post(`/api/cash-funds/${westId}/check`).send({ countedAmount: 1 }).expect(403);
    const dash = ok(await as('acct.assoc').get('/api/dashboard')).body; expect(Number(dash.cashFunds.total)).toBeGreaterThan(0);
    for (const u of ['admin', 'head.auditor', 'asst.auditor', 'ext.auditor', 'acct.head']) expect(ok(await as(u).get('/api/dashboard')).body.cashFunds).toBeDefined();
  });

  it('cash shortage at the count is charged to the staff on duty; HR finalizes; payroll deducts it; contributions register (names only for HR/Ext Auditor/Accounting Head); remittance', async () => {
    ok(await as('sales.westave').post('/api/closing/cash-count').send({ breakdown: { '1': 0 } }));
    const close = (ok(await as('head.auditor').get(`/api/closing/closes?locationId=${westId}`)).body as { id: string; cashVariance: string; businessDate: string }[]).find((c) => Number(c.cashVariance) < 0)!;
    await as('sales.westave').post(`/api/closing/closes/${close.id}/charge-shortage`).send({ employeeIds: [waEmp] }).expect(403);
    const cf = ok(await as('head.auditor').post(`/api/closing/closes/${close.id}/charge-shortage`).send({ employeeIds: [waEmp] })).body;
    expect(cf.kind).toBe('CASH_SHORTAGE'); expect(Number(cf.totalAmount)).toBe(-Number(close.cashVariance));
    await as('head.auditor').post(`/api/closing/closes/${close.id}/charge-shortage`).send({ employeeIds: [waEmp] }).expect(400);
    ok(await as('hr.staff').post(`/api/charge-forms/${cf.id}/finalize`).send({ periods: 2 }));
    const run_ = ok(await as('hr.staff').post('/api/payroll/runs').send({ periodFrom: '2026-09-01', periodTo: '2026-09-15' })).body;
    const detail = ok(await as('hr.staff').get(`/api/payroll/runs/${run_.id}`)).body as { lines: { employeeId: string; chargeDeductions: string; sssEe: string; id: string }[] };
    const line = detail.lines.find((l) => l.employeeId === waEmp)!;
    expect(Number(line.chargeDeductions)).toBeCloseTo(Number(cf.totalAmount) / 2, 1); expect(Number(line.sssEe)).toBe(450);
    ok(await as('hr.staff').post(`/api/payroll/runs/${run_.id}/finalize`));
    expect(ok(await as('acct.assoc').get(`/api/payroll/runs/${run_.id}`)).body.lines).toBeUndefined();
    const reg = ok(await as('hr.staff').get('/api/payroll/contributions?year=2026&month=9')).body; expect(reg.rows.find((r: { employeeId: string }) => r.employeeId === waEmp).sssEe).toBe('450');
    for (const u of ['ext.auditor', 'acct.head']) expect(ok(await as(u).get('/api/payroll/contributions?year=2026&month=9')).body.rows).toBeDefined();
    const tot = ok(await as('acct.assoc').get('/api/payroll/contributions?year=2026&month=9')).body; expect(tot.rows).toBeUndefined(); expect(Number(tot.agencies[0].total)).toBeGreaterThan(0);
    await as('acct.assoc').get('/api/reports/forms/contributions/2026-09.pdf').expect(403);
    await as('acct.assoc').post('/api/payroll/remittances').send({ kind: 'SSS', year: 2026, month: 9, referenceNo: 'X', paidAt: '2026-10-05' }).expect(403);
    ok(await as('acct.head').post('/api/payroll/remittances').send({ kind: 'SSS', year: 2026, month: 9, referenceNo: 'SSS-E2E', paidAt: '2026-10-05' }));
    await as('acct.head').post('/api/payroll/remittances').send({ kind: 'SSS', year: 2026, month: 9, referenceNo: 'SSS-E2E', paidAt: '2026-10-05' }).expect(400);
    expect(ok(await as('hr.staff').get('/api/payroll/contributions?year=2026&month=9')).body.agencies.find((a: { kind: string }) => a.kind === 'SSS').payable).toBe('0');
    await as('sales.westave').get(`/api/reports/forms/payslip/${line.id}.pdf`).expect(200);
    await as('sales.dasma').get(`/api/reports/forms/payslip/${line.id}.pdf`).expect(403);
  });

  it('store inspection report: Field Auditor fills and submits; HR, Admin and Head Auditor notified; staff on duty acknowledges; HR reviews', async () => {
    const list = ok(await as('field.auditor').get('/api/inspections/checklist')).body as { key: string }[];
    const bal = Number((await fund()).balance);
    const items = list.map((c) => ({ key: c.key, status: c.key === 'near_expiry' ? 'NO' : 'COMPLIED', ...(c.key === 'cash_fund' ? { amount: bal } : {}), ...(c.key === 'sales_deposit' ? { date: '2026-09-15' } : {}) }));
    const partial = ok(await as('field.auditor').post('/api/inspections').send({ locationId: westId, staffOnDutyEmployeeId: waEmp, items: items.slice(0, 3) })).body;
    await as('field.auditor').post(`/api/inspections/${partial.id}/submit`).expect(400);
    const r = ok(await as('field.auditor').post('/api/inspections').send({ locationId: westId, staffOnDutyEmployeeId: waEmp, items, comments: 'Limited stocks.' })).body;
    expect(r.controlNo).toMatch(/^WA-SI-\d{6}$/); expect(r.status).toBe('DRAFT');
    await as('sales.westave').post('/api/inspections').send({ locationId: westId, items }).expect(403);
    ok(await as('field.auditor').post(`/api/inspections/${r.id}/submit`));
    for (const u of ['hr.staff', 'admin', 'head.auditor']) expect(await notified(u, 'STORE_INSPECTION')).toBe(true);
    await as('sales.dasma').get(`/api/inspections/${r.id}`).expect(403);
    ok(await as('sales.westave').post(`/api/inspections/${r.id}/acknowledge`));
    await as('field.auditor').post(`/api/inspections/${r.id}/review`).send({ notes: 'x' }).expect(403);
    expect(ok(await as('hr.staff').post(`/api/inspections/${r.id}/review`).send({ notes: 'Follow up near-expiry items' })).body.status).toBe('REVIEWED');
    const f = await as('hr.staff').get(`/api/reports/forms/inspection/${r.id}.pdf`).expect(200); expect(f.text || f.body.toString()).toContain('Store Inspection Report');
    expect(await prisma.cashFundCheck.count({ where: { inspectionId: r.id } })).toBe(1);
  });

  it('weekly count sheet: pre-filled, submitted by the associate, auditors notified, no discrepancy case; HR sees who complied', async () => {
    await as('sales.westave').post('/api/counts').send({ countType: 'AUDIT' }).expect(403);
    const c = ok(await as('sales.westave').post('/api/counts').send({})).body;
    expect(c.countType).toBe('WEEKLY'); expect(c.controlNo).toMatch(/^WA-IC-\d{6}$/); expect(c.lines.length).toBeGreaterThan(0);
    expect(c.lines.every((l: { beginQty: number }) => typeof l.beginQty === 'number')).toBe(true);
    ok(await as('sales.westave').put(`/api/counts/${c.id}/lines`).send({ lines: c.lines.map((l: { productId: string; systemQty: number }, i: number) => ({ productId: l.productId, actualQty: i === 0 ? l.systemQty + 1 : l.systemQty })) }));
    const sub = ok(await as('sales.westave').post(`/api/counts/${c.id}/submit`)).body; expect(sub.discrepancyCase).toBeNull();
    for (const u of ['head.auditor', 'asst.auditor', 'audit.assoc']) expect(await notified(u, 'WEEKLY_COUNT_SUBMITTED')).toBe(true);
    expect(ok(await as('sales.westave').get('/api/counts/my-weekly')).body.submitted).toBe(true);
    expect(ok(await as('sales.csr').get('/api/dashboard')).body.weeklyCount.submitted).toBe(false);
    const grid = ok(await as('hr.staff').get('/api/hr/weekly-counts?weeks=4')).body as { weeks: string[]; rows: { username: string; weeks: { current: boolean; submitted: boolean }[] }[] };
    expect(grid.rows.find((r) => r.username === 'sales.westave')!.weeks.find((w) => w.current)!.submitted).toBe(true);
    expect(grid.rows.find((r) => r.username === 'sales.csr')!.weeks.find((w) => w.current)!.submitted).toBe(false);
    await as('hr.staff').get('/api/counts').expect(403);
  });

  it('audit count: locked after submission; revision only with Head Auditor approval (Admin notified); branch staff explain a discrepancy — HR notified, Head Auditor decides; red countdown on the dashboard', async () => {
    const mk = async () => { const c = ok(await as('field.auditor').post('/api/counts').send({ locationId: westId })).body; ok(await as('field.auditor').put(`/api/counts/${c.id}/lines`).send({ lines: c.lines.map((l: { productId: string; systemQty: number }, i: number) => ({ productId: l.productId, actualQty: i === 0 ? l.systemQty - 1 : l.systemQty })) })); return ok(await as('field.auditor').post(`/api/counts/${c.id}/submit`)).body; };
    const a = await mk(); expect(a.countType).toBe('AUDIT'); expect(a.discrepancyCase.caseNo).toMatch(/^WA-DC-\d{6}$/);
    await as('field.auditor').put(`/api/counts/${a.id}/lines`).send({ lines: [{ productId: a.lines[0].productId, actualQty: 0 }] }).expect(400);
    ok(await as('field.auditor').post(`/api/counts/${a.id}/revision`).send({ reason: 'Found 1 box behind the counter', lines: [{ productId: a.lines[0].productId, actualQty: a.lines[0].systemQty }] }));
    expect(await notified('admin', 'COUNT_REVISION_REQUESTED')).toBe(true);
    const rq = (ok(await as('head.auditor').get('/api/approvals/inbox?type=COUNT_REVISION')).body.items as { id: string; documentId: string }[]).find((i) => i.documentId === a.id)!;
    await as('admin').post(`/api/approvals/${rq.id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    ok(await as('head.auditor').post(`/api/approvals/${rq.id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.discrepancyCase.findUniqueOrThrow({ where: { countDocId: a.id } })).status).toBe('RESOLVED');
    const b = await mk();
    const dash = ok(await as('sales.westave').get('/api/dashboard')).body; const dl = dash.discrepancyDeadlines.find((x: { caseId: string }) => x.caseId === b.discrepancyCase.id);
    expect(dl.daysLeft).toBeGreaterThan(0); expect(dl.shortItems).toBe(1);
    ok(await as('sales.westave').post(`/api/discrepancies/${b.discrepancyCase.id}/explain`).send({ explanation: 'Sold one unit during the count; DR was keyed late' }));
    expect(await notified('hr.staff', 'DISCREPANCY_EXPLAINED')).toBe(true);
    const ex = (ok(await as('head.auditor').get('/api/approvals/inbox?type=DISCREPANCY_EXPLANATION')).body.items as { id: string; documentId: string }[]).find((i) => i.documentId === b.discrepancyCase.id)!;
    await as('hr.staff').post(`/api/approvals/${ex.id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    ok(await as('head.auditor').post(`/api/approvals/${ex.id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.discrepancyCase.findUniqueOrThrow({ where: { id: b.discrepancyCase.id } })).status).toBe('RESOLVED');
  });

  it('Accounting: inventory cost movements per day / month and direct cost from sales; branch staff and Field Auditor get 403', async () => {
    const m = ok(await as('acct.head').get('/api/reports/inventory-cost?from=2026-09-01&to=2026-09-30&groupBy=month')).body;
    expect(m.rows.length).toBeGreaterThan(0); expect(Object.keys(m.rows[0])).toEqual(expect.arrayContaining(['beginning', 'transferIn', 'pullOut', 'directCostOfSales', 'ending']));
    const d = ok(await as('acct.assoc').get(`/api/reports/inventory-cost?from=2026-09-01&to=2026-09-30&groupBy=day&locationId=${westId}`)).body; expect(d.rows.every((r: { branch: string }) => r.branch === 'West Ave')).toBe(true);
    await as('acct.assoc').get('/api/reports/inventory-cost.xlsx?from=2026-09-01&to=2026-09-30&groupBy=day').expect(200);
    for (const u of ['sales.westave', 'field.auditor']) await as(u).get('/api/reports/inventory-cost?from=2026-09-01&to=2026-09-30').expect(403);
    const dc = ok(await as('acct.assoc').get('/api/reports/direct-cost?year=2026&month=9')).body; expect(dc.rows.length).toBeGreaterThan(0);
  });
});

describe('field auditor: inventory of every branch and franchise, no sales, no cost', () => {
  it('sees stock at any location including franchises, never cost; cannot sell or open sales reports', async () => {
    const locs = ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[];
    const mayon = locs.find((l) => l.code === 'MAYON')!.id; const dasma = locs.find((l) => l.code === 'DASMA')!.id; const wh = locs.find((l) => l.code === 'WH')!.id;
    for (const id of [mayon, dasma, wh]) { const r = ok(await as('field.auditor').get(`/api/stock/on-hand?locationId=${id}`)).body; expect(has(r, /unitCost|valueAtCost/)).toBe(false); }
    const di = ok(await as('field.auditor').get(`/api/stock/daily-inventory?locationId=${wh}&from=2026-09-01&to=2026-09-30`)).body; expect(has(di, /Cost/)).toBe(false);
    await as('field.auditor').post('/api/sales').send({ locationId: dasma, channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `FA-${run}`, lines: [] }).expect(403);
    await as('field.auditor').get(`/api/reports/daily-sales?locationId=${dasma}`).expect(403);
    await as('field.auditor').get('/api/sales').expect(403);
    const me = ok(await as('field.auditor').get('/api/auth/me')).body; expect(me.locationScoped).toBe(false); expect(me.permissions).not.toContain('sale.create');
  });
});

describe('personal accounts: one person per account, every action tagged', () => {
  it('new accounts need the person\'s ID, a personal password and the accountability statement before any work', async () => {
    const wh = (ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[]).find((l) => l.code === 'WH')!.id;
    const base = { username: `e2e.${run}`, email: `e2e.${run}@gws.local`, fullName: 'Juan E2E Cruz', roleKey: 'WAREHOUSE_ASSOCIATE', password: 'Temporary#12345', locationIds: [wh] };
    await as('admin').post('/api/users').send(base).expect(400);
    ok(await as('admin').post('/api/users').send({ ...base, idNumber: `EMP-${run}` }));
    const t = (await http.post('/api/auth/login').send({ identifier: base.username, password: base.password }).expect(201)).body;
    expect(t.mustChangePassword).toBe(true);
    const H = (r: request.Test) => r.set('Authorization', `Bearer ${t.token}`);
    expect((await H(http.get('/api/products')).expect(403)).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await H(http.post('/api/auth/password')).send({ current: base.password, next: 'Juans-Own-Pass#2026' }).expect(201);
    expect((await H(http.get('/api/products')).expect(403)).body.code).toBe('ACCOUNTABILITY_REQUIRED');
    const me = (await H(http.get('/api/auth/me')).expect(200)).body;
    expect(me.accountabilityStatement).toContain('Juan E2E Cruz'); expect(me.accountabilityStatement).toContain(`EMP-${run}`);
    await H(http.post('/api/auth/accept-accountability')).expect(201);
    await H(http.get('/api/products')).expect(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { username: base.username } });
    expect(u.accountabilityAcceptedAt).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { userId: u.id, action: 'ACCOUNTABILITY_ACCEPTED' } })).toBe(1);
  });

  it('signing in on another device signs out the first one and tells the person', async () => {
    const old = tokens['wh.assoc'];
    const again = (await http.post('/api/auth/login').send({ identifier: 'wh.assoc', password: PW }).expect(201)).body.token as string;
    const r = await http.get('/api/auth/me').set('Authorization', `Bearer ${old}`).expect(401);
    expect(r.body.code).toBe('SESSION_REPLACED');
    tokens['wh.assoc'] = again;
    const notes = ok(await as('wh.assoc').get('/api/notifications')).body as { type: string }[] | { items: { type: string }[] };
    expect(JSON.stringify(notes)).toContain('SESSION_REPLACED');
    const whAssoc = await prisma.user.findUniqueOrThrow({ where: { username: 'wh.assoc' } });
    expect(await prisma.auditLog.count({ where: { userId: whAssoc.id, action: 'SESSION_REPLACED' } })).toBeGreaterThan(0);
  });
});
