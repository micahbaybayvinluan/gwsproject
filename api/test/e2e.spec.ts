/**
 * End-to-end flow against the real Nest app + Postgres (seeded). Covers §19 acceptance criteria:
 * redaction on live endpoints for every role, receive→cost approve→transfer→confirm→FEFO sale→ledger reconcile,
 * special-price approval, bulk approvals, post-close edit needing Head AND Asst, count→discrepancy→final→charge form→HR allocation,
 * branch scoping (403 outside assignment, HR blocked from ops routes).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
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
/** New master data from anyone but the Owner waits for the Owner: approve it and return the created record's id. */
async function ownerApproves(res: { body: { pending?: boolean; approvalRequestId?: string; id?: string } }): Promise<{ id: string }> {
  if (!res.body.pending) return { id: res.body.id! };
  ok(await as('admin').post(`/api/approvals/${res.body.approvalRequestId}/decide`).send({ decision: 'APPROVE' }));
  const r = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: res.body.approvalRequestId! } });
  return { id: (r.summary as { createdId: string }).createdId };
}
/** The Warehouse In-Charge approves a Warehouse Associate's goods in / out (owner request 2026-09-26). */
async function inChargeApproves(documentType: string, id: string) {
  const r = await prisma.approvalRequest.findFirst({ where: { documentType, documentId: id, status: 'PENDING', type: { in: ['WAREHOUSE_IN', 'WAREHOUSE_OUT'] } } });
  if (!r) throw new Error(`No In-Charge approval pending for ${documentType} ${id}`);
  ok(await as('wh.incharge').post(`/api/approvals/${r.id}/decide`).send({ decision: 'APPROVE' }));
}
const USERS = ['admin', 'ext.auditor', 'head.auditor', 'asst.auditor', 'audit.assoc', 'wh.incharge', 'wh.assoc', 'sales.westave', 'fr.mayon.assoc', 'fr.mayon.owner', 'custom.user', 'acct.head', 'acct.assoc', 'hr.staff', 'field.auditor', 'sales.dasma', 'sales.csr', 'exec.assistant', 'ecomm.assoc'];
const as = (u: string) => ({ get: (p: string) => http.get(p).set('Authorization', `Bearer ${tokens[u]}`), post: (p: string) => http.post(p).set('Authorization', `Bearer ${tokens[u]}`), put: (p: string) => http.put(p).set('Authorization', `Bearer ${tokens[u]}`), patch: (p: string) => http.patch(p).set('Authorization', `Bearer ${tokens[u]}`), delete: (p: string) => http.delete(p).set('Authorization', `Bearer ${tokens[u]}`) });
const has = (o: unknown, re: RegExp): boolean => JSON.stringify(o).match(re) !== null;
const ok = (r: request.Response) => { if (r.status >= 400) throw new Error(`${r.request?.method} ${r.request?.url} → ${r.status} ${JSON.stringify(r.body)}`); return r; };

/** The suite is idempotent: transactional tables are truncated before each run (master data + seed users stay). Never run against production. */
async function resetTransactionalData() {
  if (process.env.NODE_ENV !== 'test') throw new Error('refusing to reset data outside NODE_ENV=test');
  await prisma.$executeRawUnsafe(`TRUNCATE stock_ledger, stock_balances, receiving_lines, receiving_docs, transfer_lines, transfer_docs, sales_lines, payment_allocations, payments, sales_docs, expense_docs, count_lines, count_docs, discrepancy_cases, charge_form_allocations, charge_form_lines, charge_forms, expiry_writeoff_lines, expiry_writeoff_docs, approval_decisions, approval_requests, notifications, audit_log, batches, daily_closes, post_close_edits, journal_lines, journal_vouchers, beginning_balances, accounting_periods, voucher_sequences, control_sequences, alert_states, attachments, employee_loans, payroll_lines, payroll_runs, employees, min_stock_levels, revaluation_lines, revaluation_entries, cash_deposits, login_session_records, cash_fund_txns, cash_fund_checks, store_inspections, contribution_remittances, document_revisions, price_change_lines, price_change_docs, price_update_logs, franchise_salaries, franchise_charges, franchise_expenses CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE cash_deposits, cash_deposit_extensions, hr_notices, sales_report_submissions`);
  await prisma.$executeRawUnsafe(`TRUNCATE ecom_orders, ecom_order_lines, ecom_settlements, ecom_returns, ecom_ad_spend, ecom_sku_maps`);
  await prisma.$executeRawUnsafe(`UPDATE locations SET franchise_associate_receives = false, cash_deposit_max_days = 1`);
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
    // the associate's goods wait for the Warehouse In-Charge before stock is posted
    expect(ok(await as('head.auditor').get(`/api/receiving/${receivingId}`)).body.status).toBe('APPROVED');
    expect(await prisma.stockBalance.count({ where: { productId, locationId: whId } })).toBe(0);
    await inChargeApproves('ReceivingDoc', receivingId);
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
    await inChargeApproves('ReceivingDoc', r2.id);
    expect((await prisma.receivingDoc.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe('POSTED');
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req2.id } })).status).toBe('AUTO_APPROVED');
  });
  it('branch sends a stock request; warehouse prepares the transfer (FEFO picks NEAR first); Asst Auditor alone can approve (any-of); receiver confirms with shortfall', async () => {
    await as('sales.westave').post('/api/transfers').send({ fromLocationId: whId, toLocationId: branchId, transferType: 'RESTOCK', lines: [{ productId, qty: 12 }] }).expect(403); // receiving branch makes no form
    ok(await as('sales.westave').post('/api/transfers/request-stock').send({ items: [{ productId, qty: 12 }], notes: 'weekend stock' }));
    const t = ok(await as('wh.assoc').post('/api/transfers').send({ fromLocationId: whId, toLocationId: branchId, transferType: 'RESTOCK', lines: [{ productId, qty: 12 }] })).body;
    transferId = t.id; expect(t.lines.map((l: { batch: { batchNo: string }; qtySent: number }) => [l.batch.batchNo, l.qtySent])).toEqual([['NEAR', 11], ['FAR', 1]]);
    expect(t.controlNo).toMatch(/^WH-PO-\d{6}$/); expect(t.transferInNo).toMatch(/^WA-TI-\d{6}$/);
    ok(await as('wh.assoc').post(`/api/transfers/${transferId}/submit`)); await inChargeApproves('TransferDoc', transferId);
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
    const t1 = ok(await as('wh.assoc').post('/api/transfers').send({ fromLocationId: whId, toLocationId: branchId, transferType: 'RESTOCK', lines: [{ productId, qty: 1 }] })).body; ok(await as('wh.assoc').post(`/api/transfers/${t1.id}/submit`)); await inChargeApproves('TransferDoc', t1.id);
    const t2 = ok(await as('wh.assoc').post('/api/transfers').send({ fromLocationId: whId, toLocationId: branchId, transferType: 'RESTOCK', lines: [{ productId, qty: 1 }] })).body; ok(await as('wh.assoc').post(`/api/transfers/${t2.id}/submit`)); await inChargeApproves('TransferDoc', t2.id);
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
    const emp1 = await ownerApproves(ok(await as('hr.staff').post('/api/payroll/employees').send({ employeeNo: `E-${run}-1`, fullName: 'Ana', locationId: branchId, basicRate: 15000 })));
    const emp2 = await ownerApproves(ok(await as('hr.staff').post('/api/payroll/employees').send({ employeeNo: `E-${run}-2`, fullName: 'Ben', locationId: branchId, basicRate: 15000 })));
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
  it('supplier freebies received at an approved cost post Dr Inventory / Cr Other Income - Supplier Freebies at that cost', async () => {
    ok(await as('admin').put('/api/settings').send({ 'gl.auto_posting_enabled': true }));
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const sup = (await prisma.supplier.findFirstOrThrow({ where: { active: true } })).id;
    // an older standard cost of ₱1 must not be used: the freebies are worth the ₱40 approved on this receiving
    const fp = ok(await as('admin').post('/api/products').send({ name: `E2E Freebie Shaker ${run}`, categoryId: cats.find((c) => c.accountingClass === 'FREEBIE')!.id, prices: { RETAIL: 100 }, cost: 1 })).body.id;
    const r = ok(await as('wh.incharge').post('/api/receiving').send({ supplierId: sup, supplierRef: `FREE-${run}`, lines: [{ productId: fp, qty: 2, freeQty: 3, expiryDate: '2030-01-01' }] })).body;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    await http.post(`/api/attachments/ReceivingDoc/${r.id}`).set('Authorization', `Bearer ${tokens['wh.incharge']}`).attach('file', png, { filename: 'inv.png', contentType: 'image/png' }).expect(201);
    ok(await as('wh.incharge').post(`/api/receiving/${r.id}/submit`));
    const line = ok(await as('head.auditor').get(`/api/receiving/${r.id}`)).body.lines[0];
    ok(await as('head.auditor').post(`/api/receiving/${r.id}/costs`).send({ costs: [{ lineId: line.id, unitCost: 40 }] }));
    const req = ok(await as('head.auditor').get('/api/approvals/inbox?type=COST_ON_RECEIVING')).body.items.find((i: { documentId: string }) => i.documentId === r.id);
    ok(await as('head.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.receivingDoc.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('POSTED');
    const vouchers = ok(await as('acct.head').get(`/api/gl/vouchers?sourceType=ReceivingDoc&sourceId=${r.id}`)).body as { rule: string; lines: { debit: string; credit: string; account: { title: string } }[] }[];
    const r2 = vouchers.find((v) => v.rule === 'R2');
    expect(r2).toBeTruthy();
    expect(r2!.lines.find((l) => /Supplier Freebies/.test(l.account.title))!.credit).toBe('120'); // 3 free × ₱40
    expect(r2!.lines.reduce((t, l) => t + Number(l.debit), 0)).toBe(120);
    expect(vouchers.find((v) => v.rule === 'R1')!.lines.reduce((t, l) => t + Number(l.debit), 0)).toBe(80); // 2 bought × ₱40
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
    ok(await as('wh.assoc').post(`/api/transfers/${transferId}/submit`)); await inChargeApproves('TransferDoc', transferId);
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
    waEmp = (await ownerApproves(ok(await as('hr.staff').post('/api/payroll/employees').send({ employeeNo: `WA-${run}`, fullName: 'Sales Associate – West Ave', locationId: westId, basicRate: 18000, userId: wa.id, sssNo: '34-0000001-0' })))).id;
    whEmp = (await ownerApproves(ok(await as('hr.staff').post('/api/payroll/employees').send({ employeeNo: `WH-${run}`, fullName: 'Warehouse Associate', locationId: whId, basicRate: 16000, userId: wu.id })))).id;
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

  it('weekly count sheet: pre-filled, submitted by the associate; a difference opens a case and notifies the associate, auditors, Owner and HR; HR sees who complied', async () => {
    await as('sales.westave').post('/api/counts').send({ countType: 'AUDIT' }).expect(403);
    const c = ok(await as('sales.westave').post('/api/counts').send({})).body;
    expect(c.countType).toBe('WEEKLY'); expect(c.controlNo).toMatch(/^WA-IC-\d{6}$/); expect(c.lines.length).toBeGreaterThan(0);
    expect(c.lines.every((l: { beginQty: number }) => typeof l.beginQty === 'number')).toBe(true);
    ok(await as('sales.westave').put(`/api/counts/${c.id}/lines`).send({ lines: c.lines.map((l: { productId: string; systemQty: number }, i: number) => ({ productId: l.productId, actualQty: i === 0 ? l.systemQty + 1 : l.systemQty })) }));
    const sub = ok(await as('sales.westave').post(`/api/counts/${c.id}/submit`)).body; expect(sub.discrepancyCase.caseNo).toMatch(/^WA-DC-\d{6}$/);
    for (const u of ['sales.westave', 'head.auditor', 'asst.auditor', 'audit.assoc', 'admin', 'hr.staff']) expect(await notified(u, 'DISCREPANCY_OPENED')).toBe(true);
    // the case is cleared so the audit-count test below starts from a clean branch
    await prisma.discrepancyCase.update({ where: { id: sub.discrepancyCase.id }, data: { status: 'RESOLVED' } });
    expect(ok(await as('sales.westave').get('/api/counts/my-weekly')).body.submitted).toBe(true);
    expect(ok(await as('sales.csr').get('/api/dashboard')).body.weeklyCount.submitted).toBe(false);
    const grid = ok(await as('hr.staff').get('/api/hr/weekly-counts?weeks=4')).body as { weeks: string[]; rows: { username: string; weeks: { current: boolean; submitted: boolean }[] }[] };
    expect(grid.rows.find((r) => r.username === 'sales.westave')!.weeks.find((w) => w.current)!.submitted).toBe(true);
    expect(grid.rows.find((r) => r.username === 'sales.csr')!.weeks.find((w) => w.current)!.submitted).toBe(false);
    await as('hr.staff').get('/api/counts').expect(403);
  });

  it('audit count: locked after submission; revision only with Head Auditor approval (Admin notified); branch staff explain a discrepancy — HR notified, Head Auditor decides; red countdown on the dashboard', async () => {
    const mk = async () => { const c = ok(await as('field.auditor').post('/api/counts').send({ locationId: westId })).body; ok(await as('field.auditor').put(`/api/counts/${c.id}/lines`).send({ lines: c.lines.map((l: { productId: string; systemQty: number }, i: number) => ({ productId: l.productId, actualQty: i === c.lines.findIndex((x: { systemQty: number }) => x.systemQty > 0) ? l.systemQty - 1 : l.systemQty })) })); return ok(await as('field.auditor').post(`/api/counts/${c.id}/submit`)).body; };
    const a = await mk(); const s0 = a.lines.find((l: { variance: number }) => l.variance !== 0); expect(a.countType).toBe('AUDIT'); expect(a.discrepancyCase.caseNo).toMatch(/^WA-DC-\d{6}$/);
    await as('field.auditor').put(`/api/counts/${a.id}/lines`).send({ lines: [{ productId: s0.productId, actualQty: 0 }] }).expect(400);
    ok(await as('field.auditor').post(`/api/counts/${a.id}/revision`).send({ reason: 'Found 1 box behind the counter', lines: [{ productId: s0.productId, actualQty: s0.systemQty }] }));
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
    await as('field.auditor').get('/api/charge-forms').expect(403);
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

describe('Help & Guide (owner request 2026-09-26)', () => {
  it('each role gets only its own guide sections; without an AI key the Ask box answers from the guide', async () => {
    const sales = ok(await as('sales.westave').get('/api/help')).body as { aiEnabled: boolean; role: string; sections: { title: string }[] };
    expect(sales.role).toBe('Sales Associate'); expect(sales.aiEnabled).toBe(false);
    expect(sales.sections.map((s) => s.title)).toContain('Recording a sale'); expect(sales.sections.map((s) => s.title)).not.toContain('HR: charge forms');
    const hr = ok(await as('hr.staff').get('/api/help')).body as { sections: { title: string }[] };
    expect(hr.sections.map((s) => s.title)).toContain('HR: charge forms'); expect(hr.sections.map((s) => s.title)).not.toContain('Recording a sale');
    const r = ok(await as('field.auditor').post('/api/help/ask').send({ question: 'How do I confirm the cash fund in the store?' })).body;
    expect(r.mode).toBe('guide'); expect(r.sections[0].title).toBe('Cash fund');
    await as('field.auditor').post('/api/help/ask').send({ question: 'x' }).expect(400);
    await http.get('/api/help').expect(401);
  });
});

describe('Owner approval of new master data and HR user accounts (owner request 2026-09-26)', () => {
  it('a product from the Head Auditor waits for the Owner; the Owner\'s own entries are created at once; rejection creates nothing', async () => {
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const cat = cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id;
    const name = `Pending Whey ${run}`;
    const r = ok(await as('head.auditor').post('/api/products').send({ name, categoryId: cat, prices: { RETAIL: 12345.67 } })).body;
    expect(r.pending).toBe(true);
    expect(await prisma.product.count({ where: { name } })).toBe(0);
    const pend = ok(await as('head.auditor').get('/api/master-data/pending?kind=Product')).body as { name: string }[];
    expect(pend.map((p) => p.name)).toContain(name); expect(JSON.stringify(pend)).not.toContain('12345.67');
    await as('head.auditor').post(`/api/approvals/${r.approvalRequestId}/decide`).send({ decision: 'APPROVE' }).expect(403);
    ok(await as('admin').post(`/api/approvals/${r.approvalRequestId}/decide`).send({ decision: 'APPROVE' }));
    expect(await prisma.product.count({ where: { name } })).toBe(1);
    expect(JSON.stringify(ok(await as('head.auditor').get('/api/notifications')).body)).toContain('MASTER_DATA_APPROVED');
    const s = ok(await as('admin').post('/api/suppliers').send({ name: `Owner Supplier ${run}` })).body; expect(s.pending).toBeUndefined(); expect(s.id).toBeTruthy();
    const rej = ok(await as('head.auditor').post('/api/suppliers').send({ name: `Rejected Supplier ${run}` })).body;
    ok(await as('admin').post(`/api/approvals/${rej.approvalRequestId}/decide`).send({ decision: 'REJECT', note: 'duplicate' }));
    expect(await prisma.supplier.count({ where: { name: `Rejected Supplier ${run}` } })).toBe(0);
  });
  it('HR adds an employee and opens their user account; both wait for the Owner; the person signs in with the temporary password and must change it', async () => {
    const westId = (ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[]).find((l) => l.code === 'WESTAVE')!.id;
    const e = ok(await as('hr.staff').post('/api/payroll/employees').send({ employeeNo: `NEW-${run}`, fullName: `Carla New ${run}`, locationId: westId, basicRate: 15000 })).body;
    expect(e.pending).toBe(true);
    const emp = await ownerApproves({ body: e });
    await as('hr.staff').post(`/api/hr/employees/${emp.id}/account`).send({ username: `carla.${run}`, email: `carla.${run}@gws.local`, roleKey: 'ADMIN', password: 'Temporary#2026' }).expect(403);
    const acc = ok(await as('hr.staff').post(`/api/hr/employees/${emp.id}/account`).send({ username: `carla.${run}`, email: `carla.${run}@gws.local`, roleKey: 'SALES_ASSOCIATE', locationIds: [westId], password: 'Temporary#2026' })).body;
    expect(acc.pending).toBe(true);
    const req = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: acc.approvalRequestId } });
    expect(JSON.stringify(req.summary)).not.toContain('Temporary#2026');
    expect(await prisma.user.count({ where: { username: `carla.${run}` } })).toBe(0);
    ok(await as('admin').post(`/api/approvals/${acc.approvalRequestId}/decide`).send({ decision: 'APPROVE' }));
    const u = await prisma.user.findUniqueOrThrow({ where: { username: `carla.${run}` }, include: { employee: true } });
    expect(u.mustChangePassword).toBe(true); expect(u.employee?.id).toBe(emp.id); expect(u.idNumber).toBe(`NEW-${run}`);
    const login = await http.post('/api/auth/login').send({ identifier: `carla.${run}`, password: 'Temporary#2026' }); expect(login.status).toBeLessThan(300); expect(login.body.mustChangePassword).toBe(true);
  });
});

describe('Owner controls batch (owner requests 2026-09-26): In-Charge approvals, price notices, franchise books, Executive Assistant, journal edits, letterhead', () => {
  let pid = ''; let wh = ''; let west = ''; let mayon = ''; let sup = '';
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const notes = async (u: string) => JSON.stringify(ok(await as(u).get('/api/notifications')).body);
  const pending = async (type: string, documentId: string) => (await prisma.approvalRequest.findFirst({ where: { type, documentId, status: 'PENDING' } }))!;
  beforeAll(async () => {
    const locs = ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[];
    wh = locs.find((l) => l.code === 'WH')!.id; west = locs.find((l) => l.code === 'WESTAVE')!.id; mayon = locs.find((l) => l.code === 'MAYON')!.id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    sup = ok(await as('admin').post('/api/suppliers').send({ name: `Batch Supplier ${run}` })).body.id;
    pid = ok(await as('admin').post('/api/products').send({ name: `Batch Whey ${run}`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, supplierId: sup, prices: { RETAIL: 2000, DEALER: 1800, FRANCHISE: 1500, AGENT: 1700 }, cost: 1000 })).body.id;
  });

  it('receiving by the Warehouse Associate: Head Auditor approves the cost, then the In-Charge, then stock posts; the timeline shows each step; a cost change reaches only the cost roles', async () => {
    const r = ok(await as('wh.assoc').post('/api/receiving').send({ supplierId: sup, supplierRef: `B-${run}`, lines: [{ productId: pid, qty: 20, expiryDate: '2029-06-30', batchNo: 'B1', }] })).body;
    await http.post(`/api/attachments/ReceivingDoc/${r.id}`).set('Authorization', `Bearer ${tokens['wh.assoc']}`).attach('file', png, { filename: 'inv.png', contentType: 'image/png' }).expect(201);
    ok(await as('wh.assoc').post(`/api/receiving/${r.id}/submit`));
    const doc = ok(await as('head.auditor').get(`/api/receiving/${r.id}`)).body;
    ok(await as('head.auditor').post(`/api/receiving/${r.id}/costs`).send({ costs: [{ lineId: doc.lines[0].id, unitCost: 1100 }] }));
    ok(await as('head.auditor').post(`/api/approvals/${(await pending('COST_ON_RECEIVING', r.id)).id}/decide`).send({ decision: 'APPROVE' }));
    let tl = ok(await as('wh.assoc').get(`/api/approvals/timeline/ReceivingDoc/${r.id}`)).body as { type: string; steps: { who: string; status: string; by?: string }[] }[];
    expect(tl.map((t) => t.type)).toEqual(['COST_ON_RECEIVING', 'WAREHOUSE_IN']);
    expect(tl[0].steps[0]).toMatchObject({ who: 'Head Auditor', status: 'approved', by: 'Head Auditor' }); expect(tl[1].steps[0]).toMatchObject({ who: 'Warehouse In-Charge', status: 'waiting' });
    expect(await prisma.stockBalance.count({ where: { productId: pid } })).toBe(0);
    await as('head.auditor').post(`/api/approvals/${(await pending('WAREHOUSE_IN', r.id)).id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    ok(await as('wh.incharge').post(`/api/approvals/${(await pending('WAREHOUSE_IN', r.id)).id}/decide`).send({ decision: 'APPROVE' }));
    expect(ok(await as('wh.assoc').get(`/api/receiving/${r.id}`)).body.status).toBe('POSTED');
    tl = ok(await as('wh.assoc').get(`/api/approvals/timeline/ReceivingDoc/${r.id}`)).body; expect(tl[1].steps[0].status).toBe('approved');
    for (const u of ['head.auditor', 'ext.auditor', 'acct.head', 'admin']) expect(await notes(u)).toContain('COST_UPDATE');
    for (const u of ['asst.auditor', 'audit.assoc', 'acct.assoc', 'wh.assoc', 'sales.westave', 'fr.mayon.owner']) expect(await notes(u)).not.toContain('Supplier cost change');
    const dash = ok(await as('head.auditor').get('/api/dashboard')).body; expect(dash.priceUpdates.some((p: { what: string }) => p.what === 'Supplier cost')).toBe(true);
    expect(ok(await as('sales.westave').get('/api/dashboard')).body.priceUpdates.some((p: { what: string }) => p.what === 'Supplier cost')).toBe(false);
  });

  it('selling-price changes reach each person only for the prices they use (franchise sees the franchise price, associates only retail)', async () => {
    const pc = ok(await as('admin').post('/api/price-changes').send({ lines: [{ productId: pid, tier: 'RETAIL', newPrice: 2100 }, { productId: pid, tier: 'FRANCHISE', newPrice: 1550 }] })).body;
    ok(await as('admin').post(`/api/approvals/${(await pending('PRICE_CHANGE', pc.id)).id}/decide`).send({ decision: 'APPROVE' }));
    const own = await notes('fr.mayon.owner'); expect(own).toContain('1,550.00');
    const fa = await notes('fr.mayon.assoc'); expect(fa).toContain('2,100.00'); expect(fa).not.toContain('1,550.00');
    const sa = await notes('sales.westave'); expect(sa).toContain('2,100.00'); expect(sa).not.toContain('1,550.00');
    expect(await notes('hr.staff')).not.toContain('PRICE_UPDATE');
  });

  it('the Warehouse Associate\'s pull-out waits for the In-Charge before the auditors; goods returned to the warehouse wait for the In-Charge before stock is added; quantities never go negative', async () => {
    await as('wh.assoc').post('/api/transfers').send({ fromLocationId: wh, toLocationId: west, transferType: 'RESTOCK', lines: [{ productId: pid, qty: -2 }] }).expect(400);
    await as('wh.assoc').post('/api/receiving').send({ supplierId: sup, lines: [{ productId: pid, qty: 0 }] }).expect(400);
    await as('wh.assoc').post('/api/transfers').send({ fromLocationId: wh, toLocationId: west, transferType: 'RESTOCK', lines: [{ productId: pid, qty: 999 }] }).expect(400);
    const t = ok(await as('wh.assoc').post('/api/transfers').send({ fromLocationId: wh, toLocationId: west, transferType: 'RESTOCK', lines: [{ productId: pid, qty: 5 }] })).body;
    ok(await as('wh.assoc').post(`/api/transfers/${t.id}/submit`));
    expect(await prisma.approvalRequest.count({ where: { documentId: t.id, type: 'TRANSFER_INTERNAL' } })).toBe(0);
    ok(await as('wh.incharge').post(`/api/approvals/${(await pending('WAREHOUSE_OUT', t.id)).id}/decide`).send({ decision: 'APPROVE' }));
    ok(await as('asst.auditor').post(`/api/approvals/${(await pending('TRANSFER_INTERNAL', t.id)).id}/decide`).send({ decision: 'APPROVE' }));
    const lines = ok(await as('sales.westave').get(`/api/transfers/${t.id}`)).body.lines as { id: string }[];
    ok(await as('sales.westave').post(`/api/transfers/${t.id}/confirm`).send({ lines: lines.map((l) => ({ lineId: l.id, checked: true })) }));
    // the branch returns 2 to the warehouse; the associate checks them in; the In-Charge confirms before stock is added
    const back = ok(await as('sales.westave').post('/api/transfers').send({ toLocationId: wh, transferType: 'RETURN', returnReason: 'damaged', lines: [{ productId: pid, qty: 2 }] })).body;
    ok(await as('sales.westave').post(`/api/transfers/${back.id}/submit`));
    ok(await as('asst.auditor').post(`/api/approvals/${(await pending('TRANSFER_INTERNAL', back.id)).id}/decide`).send({ decision: 'APPROVE' }));
    const before = (await prisma.stockBalance.aggregate({ where: { productId: pid, locationId: wh }, _sum: { qty: true } }))._sum.qty ?? 0;
    const bl = ok(await as('wh.assoc').get(`/api/transfers/${back.id}`)).body.lines as { id: string }[];
    ok(await as('wh.assoc').post(`/api/transfers/${back.id}/confirm`).send({ lines: bl.map((l) => ({ lineId: l.id, checked: true })) }));
    expect(ok(await as('wh.assoc').get(`/api/transfers/${back.id}`)).body.status).toBe('APPROVED');
    expect((await prisma.stockBalance.aggregate({ where: { productId: pid, locationId: wh }, _sum: { qty: true } }))._sum.qty ?? 0).toBe(before);
    ok(await as('wh.incharge').post(`/api/approvals/${(await pending('WAREHOUSE_IN', back.id)).id}/decide`).send({ decision: 'APPROVE' }));
    expect(ok(await as('wh.assoc').get(`/api/transfers/${back.id}`)).body.status).toBe('RECEIVED');
    expect((await prisma.stockBalance.aggregate({ where: { productId: pid, locationId: wh }, _sum: { qty: true } }))._sum.qty ?? 0).toBe(before + 2);
  });

  it('franchise: the owner decides who receives; the associate never sees franchise cost; the owner pays and charges own staff (HR has no access) and gets own statements', async () => {
    const t = ok(await as('wh.incharge').post('/api/transfers').send({ fromLocationId: wh, toLocationId: mayon, transferType: 'RESTOCK', lines: [{ productId: pid, qty: 3 }] })).body;
    ok(await as('wh.incharge').post(`/api/transfers/${t.id}/submit`));
    ok(await as('admin').post(`/api/approvals/${(await pending('TRANSFER_TO_FRANCHISE', t.id)).id}/decide`).send({ decision: 'APPROVE' }));
    const fl = ok(await as('fr.mayon.assoc').get(`/api/transfers/${t.id}`)).body.lines as { id: string }[];
    await as('fr.mayon.assoc').post(`/api/transfers/${t.id}/confirm`).send({ lines: fl.map((l) => ({ lineId: l.id, checked: true })) }).expect(403);
    await as('fr.mayon.assoc').put('/api/franchise/settings').send({ associateReceives: true }).expect(403);
    ok(await as('fr.mayon.owner').put('/api/franchise/settings').send({ associateReceives: true }));
    ok(await as('fr.mayon.assoc').post(`/api/transfers/${t.id}/confirm`).send({ lines: fl.map((l) => ({ lineId: l.id, checked: true })) }));
    expect(await notes('fr.mayon.owner')).toContain('FRANCHISE_RECEIVED');
    const portalA = ok(await as('fr.mayon.assoc').get('/api/franchise/portal')).body; expect(portalA.arToWarehouse).toBeNull();
    expect(ok(await as('fr.mayon.owner').get('/api/franchise/portal')).body.arToWarehouse).toBeTruthy();
    await as('fr.mayon.assoc').get('/api/franchise/pnl?from=2026-01-01&to=2026-12-31').expect(403);
    const staff = ok(await as('fr.mayon.owner').get('/api/franchise/staff')).body as { id: string; fullName: string }[]; const assoc = staff[0];
    ok(await as('fr.mayon.owner').post('/api/franchise/charges').send({ userIds: [assoc.id], kind: 'CASH_SHORTAGE', reason: 'Short ₱200 on 20 Sep', amount: 200 }));
    const sal = ok(await as('fr.mayon.owner').post('/api/franchise/salaries').send({ userId: assoc.id, periodFrom: '2026-09-01', periodTo: '2026-09-15', basic: 7000, allowances: 500, deductCharges: true })).body;
    expect(Number(sal.chargesDeducted)).toBe(200); expect(Number(sal.netPay)).toBe(7300);
    const mine = ok(await as('fr.mayon.assoc').get('/api/franchise/my-pay')).body; expect(mine.salaries).toHaveLength(1); expect(mine.charges[0].deducted).toBe(true);
    await as('fr.mayon.assoc').post('/api/franchise/salaries').send({ userId: assoc.id, periodFrom: '2026-09-16', periodTo: '2026-09-30', basic: 1 }).expect(403);
    await as('hr.staff').post('/api/payroll/employees').send({ employeeNo: `FR-${run}`, fullName: 'Franchise Person', locationId: mayon, basicRate: 10000 }).expect(400);
    const is = ok(await as('fr.mayon.owner').get('/api/franchise/income-statement?from=2026-09-01&to=2026-09-30')).body;
    expect(is.expenses.find((e: { category: string }) => e.category === 'Salaries').amount).toBe('7500'); expect(Number(is.otherIncome.staffChargesRecovered)).toBe(200);
    const bs = ok(await as('fr.mayon.owner').get('/api/franchise/balance-sheet?asOf=2026-12-31')).body;
    expect(Number(bs.totalAssets)).toBeCloseTo(Number(bs.totalLiabilities) + Number(bs.totalEquity), 2); expect(Number(bs.assets.find((a: { account: string }) => a.account.startsWith('Inventory')).amount)).toBeGreaterThan(0);
    await as('fr.mayon.assoc').get('/api/franchise/balance-sheet').expect(403);
  });

  it('Executive Assistant records main bank entries by book, sees payables and balance-sheet accounts only; Accounting edits the entry and the people involved and the Owner are told', async () => {
    const opts = ok(await as('exec.assistant').get('/api/bank-entries/options')).body as { banks: { id: string }[]; groups: { key: string; accounts: { id: string }[] }[] };
    expect(opts.banks.length).toBeGreaterThan(0);
    const adv = opts.groups.find((g) => g.key === 'ADVANCES_TO')!.accounts[0];
    const v = ok(await as('exec.assistant').post('/api/bank-entries').send({ bankAccountId: opts.banks[0].id, direction: 'OUT', group: 'ADVANCES_TO', accountId: adv.id, amount: 5000, name: 'Juan Dela Cruz', remarks: 'cash advance' })).body;
    expect(v.book).toBe('ADVANCES'); expect(v.lines).toHaveLength(2);
    await as('exec.assistant').post('/api/bank-entries').send({ bankAccountId: opts.banks[0].id, direction: 'OUT', group: 'ADVANCES_TO', accountId: opts.banks[0].id, amount: 5 }).expect(400);
    for (const path of ['/api/gl/vouchers', '/api/fs/income-statement?year=2026', '/api/sales', '/api/reports/daily-sales', '/api/products', '/api/stock/on-hand']) expect((await as('exec.assistant').get(path)).status).toBe(403);
    const bal = ok(await as('exec.assistant').get('/api/bank-entries/balances')).body as { rows: { class: string }[] };
    expect(bal.rows.some((r) => ['INVENTORY', 'REVENUE', 'DIRECT_COST', 'OPEX', 'OTHER_INCOME'].includes(r.class))).toBe(false);
    const pay = ok(await as('exec.assistant').get('/api/bank-entries/payables')).body; expect(JSON.stringify(pay)).not.toMatch(/unitCost/);
    ok(await as('exec.assistant').get('/api/bank-entries/office-expenses'));
    await as('exec.assistant').put(`/api/gl/vouchers/${v.id}`).send({ reason: 'x', lines: [] }).expect(403);
    ok(await as('acct.head').put(`/api/gl/vouchers/${v.id}`).send({ reason: 'Amount was 4,500', lines: v.lines.map((l: { accountId: string; debit: string; credit: string }) => ({ accountId: l.accountId, debit: Number(l.debit) ? 4500 : 0, credit: Number(l.credit) ? 4500 : 0 })) }));
    await as('acct.head').put(`/api/gl/vouchers/${v.id}`).send({ reason: 'unbalanced', lines: [{ accountId: adv.id, debit: 10 }, { accountId: opts.banks[0].id, credit: 9 }] }).expect(400);
    expect(await notes('exec.assistant')).toContain('JOURNAL_EDITED'); expect(await notes('admin')).toContain('JOURNAL_EDITED');
    const log = ok(await as('admin').get('/api/revisions?source=ACCOUNTING_EDIT')).body as { documentId: string }[]; expect(log.some((r) => r.documentId === v.id)).toBe(true);
  });

  it('only the Owner deletes master data (unused → deleted, used → archived); the Head Auditor may edit products and suppliers', async () => {
    ok(await as('head.auditor').patch(`/api/products/${pid}`).send({ brand: 'GWS' }));
    ok(await as('head.auditor').patch(`/api/suppliers/${sup}`).send({ contact: '0917' }));
    await as('acct.head').patch(`/api/products/${pid}`).send({ brand: 'x' }).expect(403);
    await as('head.auditor').delete(`/api/products/${pid}`).expect(403);
    expect(ok(await as('admin').delete(`/api/products/${pid}`)).body.archived).toBe(true);
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string }[];
    const fresh = ok(await as('admin').post('/api/products').send({ name: `Unused ${run}`, categoryId: cats[0].id, prices: { RETAIL: 1 } })).body;
    expect(ok(await as('admin').delete(`/api/products/${fresh.id}`)).body.deleted).toBe(true);
  });

  it('letterhead: the Owner sets the logo and details; every printed form carries them', async () => {
    await as('head.auditor').put('/api/letterhead').send({ address: 'x' }).expect(403);
    ok(await as('admin').put('/api/letterhead').send({ name: 'Get Wheysted Supplements', address: '123 Main St, Quezon City', tin: '123-456-789-000' }));
    ok(await http.post('/api/letterhead/logo').set('Authorization', `Bearer ${tokens.admin}`).attach('file', png, { filename: 'logo.png', contentType: 'image/png' }));
    const t = await prisma.transferDoc.findFirstOrThrow({ where: { fromLocationId: wh }, orderBy: { createdAt: 'desc' } });
    const f = await as('wh.incharge').get(`/api/reports/forms/pull-out/${t.id}.pdf`).expect(200);
    const html = f.text || f.body.toString(); expect(html).toContain('123 Main St, Quezon City'); expect(html).toContain('data:image/png;base64'); expect(html).toContain('TIN 123-456-789-000');
    expect(ok(await as('sales.westave').get('/api/letterhead')).body.name).toBe('Get Wheysted Supplements');
  });
});

describe('Owner requests 2026-09-27: sale incentives, count sheets, count discrepancies, cash on hand, GCash', () => {
  let west = ''; let pid = ''; let idle = ''; let caseId = '';
  const notes = async (u: string) => JSON.stringify(ok(await as(u).get('/api/notifications')).body);
  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
  /** Opening stock straight into the ledger (as the seed does), dated yesterday so it is part of the beginning count. */
  const giveStock = async (locationId: string, productId: string, qty: number, cost = 100) => {
    const batch = await prisma.batch.create({ data: { productId, batchNo: `T-${run}`, receivedRef: 'TEST', unitCost: cost.toFixed(2) } });
    const d = new Date(`${today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
    await prisma.stockLedger.create({ data: { locationId, productId, batchId: batch.id, qtyDelta: qty, movementType: 'RECEIVE', documentType: 'OpeningStock', documentId: batch.id, unitCost: cost.toFixed(2), businessDate: d } });
    await prisma.stockBalance.create({ data: { locationId, productId, batchId: batch.id, qty } });
  };
  beforeAll(async () => {
    west = (await prisma.location.findUniqueOrThrow({ where: { code: 'WESTAVE' } })).id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const supp = cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id;
    pid = ok(await as('admin').post('/api/products').send({ name: `AAA Incentive Whey ${run}`, categoryId: supp, prices: { RETAIL: 1000, FRANCHISE: 700 }, cost: 500 })).body.id;
    idle = ok(await as('admin').post('/api/products').send({ name: `AAA Never Stocked ${run}`, categoryId: supp, prices: { RETAIL: 10, FRANCHISE: 8 } })).body.id;
    await giveStock(west, pid, 20, 500);
  });

  it('an incentive on a sale is a branch expense paid from the cash: less cash to deposit, on the daily report, voided with the sale', async () => {
    const before = ok(await as('sales.westave').get(`/api/closing/summary?locationId=${west}`)).body;
    const s = ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `DR-${run}-INC`, lines: [{ productId: pid, qty: 1 }], incentive: { amount: 50, payee: 'Juan (agent)' } })).body;
    expect(s.incentiveAmount).toBe('50'); expect(s.incentiveExpenseId).toBeTruthy();
    const ex = await prisma.expenseDoc.findUniqueOrThrow({ where: { id: s.incentiveExpenseId }, include: { account: true } });
    expect(ex.paidFrom).toBe('CASH_DRAWER'); expect(ex.account.title).toMatch(/Incentives/); expect(ex.locationId).toBe(west);
    const after = ok(await as('sales.westave').get(`/api/closing/summary?locationId=${west}`)).body;
    expect(Number(after.expectedCash) - Number(before.expectedCash)).toBe(1000 - 50);
    const dsr = ok(await as('sales.westave').get(`/api/reports/daily-sales?locationId=${west}&date=${today()}`)).body;
    expect(dsr.expenses.some((e: { accountTitle: string; payee: string }) => /Incentives/.test(e.accountTitle) && e.payee === 'Juan (agent)')).toBe(true);
    // the expense cannot be voided on its own; voiding the sale voids it
    await as('admin').post(`/api/expenses/${ex.id}/void`).send({ reason: 'test' }).expect(400);
    ok(await as('sales.westave').post(`/api/sales/${s.id}/void`).send({ reason: 'wrong item' }));
    expect((await prisma.expenseDoc.findUniqueOrThrow({ where: { id: ex.id } })).voidedAt).toBeTruthy();
    // only accounts with the permission may add one
    await as('wh.incharge').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `DR-${run}-INC2`, lines: [{ productId: pid, qty: 1 }], incentive: { amount: 5, payee: 'x' } }).expect(403);
  });

  it('count sheet lists every item: items the system has first, then items not in the system (blank = none); the downloaded Excel sheet is filled and uploaded back', async () => {
    const c = ok(await as('sales.westave').post('/api/counts').send({})).body as { id: string; lines: { productId: string; beginQty: number; systemQty: number; product: { sku: string } }[] };
    const idx = (id: string) => c.lines.findIndex((l) => l.productId === id);
    expect(idx(pid)).toBeGreaterThanOrEqual(0); expect(idx(idle)).toBeGreaterThan(idx(pid)); // never-stocked items are listed too, after the stocked ones
    const firstOut = c.lines.findIndex((l) => !(l.beginQty || l.systemQty));
    expect(c.lines.slice(firstOut).every((l) => !(l.beginQty || l.systemQty))).toBe(true);
    // Excel sheet in the same order, with a System column
    const res = await http.get(`/api/reports/forms/count/${c.id}.xlsx`).set('Authorization', `Bearer ${tokens['sales.westave']}`).buffer(true).parse((r, cb) => { const b: Buffer[] = []; r.on('data', (d: Buffer) => b.push(d)); r.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.body as never); const ws = wb.worksheets[0];
    let hdr = 0; const col: Record<string, number> = {};
    ws.eachRow((row, r) => { if (!hdr && (row.values as unknown[]).some((v) => v === 'SKU')) { hdr = r; (row.values as unknown[]).forEach((v, j) => { col[String(v)] = j; }); } });
    expect(hdr).toBeGreaterThan(0); expect(col.System).toBeTruthy();
    const skuRows: string[] = []; for (let r = hdr + 1; r <= ws.rowCount; r++) { const v = ws.getRow(r).getCell(col.SKU).value; if (v) skuRows.push(String(v)); }
    expect(skuRows.indexOf(c.lines[idx(pid)].product.sku)).toBeLessThan(skuRows.indexOf(c.lines[idx(idle)].product.sku));
    // the counter types actual counts in the downloaded sheet: 2 short on our item, the rest as expected; items not in the system left blank
    for (let r = hdr + 1; r <= ws.rowCount; r++) {
      const sku = String(ws.getRow(r).getCell(col.SKU).value ?? ''); const line = c.lines.find((l) => l.product.sku === sku); if (!line || !(line.beginQty || line.systemQty)) continue;
      ws.getRow(r).getCell(col['Actual count']).value = line.productId === pid ? line.systemQty - 2 : line.systemQty;
    }
    const filled = Buffer.from(await wb.xlsx.writeBuffer());
    const up = (await http.post('/api/imports/count-lines').set('Authorization', `Bearer ${tokens['sales.westave']}`).attach('file', filled, { filename: 'count.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).expect(201)).body as { lines: { productId: string; actualQty: number }[]; errors: string[] };
    expect(up.errors).toEqual([]); expect(up.lines.find((l) => l.productId === pid)!.actualQty).toBe(c.lines[idx(pid)].systemQty - 2);
    ok(await as('sales.westave').put(`/api/counts/${c.id}/lines`).send({ lines: up.lines }));
    const sub = ok(await as('sales.westave').post(`/api/counts/${c.id}/submit`)).body;
    expect(sub.discrepancyCase).toBeTruthy(); caseId = sub.discrepancyCase.id;
    expect(sub.lines.find((l: { productId: string }) => l.productId === idle).actualQty).toBe(0);
    for (const u of ['sales.westave', 'head.auditor', 'asst.auditor', 'audit.assoc', 'admin', 'hr.staff']) expect(await notes(u)).toContain(sub.controlNo);
  });

  it('no explanation by the deadline → charged at franchise price; an explanation still waiting for the Head Auditor holds the charge until it is decided', async () => {
    await prisma.discrepancyCase.update({ where: { id: caseId }, data: { deadline: new Date(Date.now() - 60e3) } });
    ok(await as('admin').post('/api/discrepancies/run-deadline'));
    const c1 = await prisma.discrepancyCase.findUniqueOrThrow({ where: { id: caseId }, include: { chargeForm: { include: { lines: true } } } });
    expect(c1.status).toBe('FINALIZED'); expect(Number(c1.chargeForm!.lines.find((l) => l.productId === pid)!.amount)).toBe(2 * 700);
    // Field Auditor count, one short, explained by the associate before the deadline
    const c = ok(await as('field.auditor').post('/api/counts').send({ locationId: west })).body as { id: string; lines: { productId: string; systemQty: number }[] };
    ok(await as('field.auditor').put(`/api/counts/${c.id}/lines`).send({ lines: c.lines.filter((l) => l.systemQty).map((l) => ({ productId: l.productId, actualQty: l.productId === pid ? l.systemQty - 1 : l.systemQty })) }));
    const sub = ok(await as('field.auditor').post(`/api/counts/${c.id}/submit`)).body;
    expect(await notes('hr.staff')).toContain(sub.controlNo); expect(await notes('sales.westave')).toContain(sub.controlNo);
    ok(await as('sales.westave').post(`/api/discrepancies/${sub.discrepancyCase.id}/explain`).send({ explanation: 'One unit was sold and keyed the next day' }));
    await prisma.discrepancyCase.update({ where: { id: sub.discrepancyCase.id }, data: { deadline: new Date(Date.now() - 60e3) } });
    ok(await as('admin').post('/api/discrepancies/run-deadline'));
    expect((await prisma.discrepancyCase.findUniqueOrThrow({ where: { id: sub.discrepancyCase.id } })).status).toBe('OPEN');
    const req = (await prisma.approvalRequest.findFirst({ where: { type: 'DISCREPANCY_EXPLANATION', documentId: sub.discrepancyCase.id, status: 'PENDING' } }))!;
    ok(await as('head.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'REJECT', note: 'No DR found' }));
    ok(await as('admin').post('/api/discrepancies/run-deadline'));
    expect((await prisma.discrepancyCase.findUniqueOrThrow({ where: { id: sub.discrepancyCase.id } })).status).toBe('FINALIZED');
  });

  it('cash on hand: undeposited sales per day, days allowed set by the Head Auditor, reminders to the auditors, extension needs Head Auditor and Admin, overdue → HR notice; GCash (GWS) usable for deposits', async () => {
    const day = (n: number) => { const d = new Date(`${today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d; };
    ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `DR-${run}-COH`, lines: [{ productId: pid, qty: 1 }] }));
    let b = ok(await as('sales.westave').get('/api/cash-on-hand')).body;
    expect(b.days.find((d: { businessDate: string }) => d.businessDate === today()).status).toBe('OPEN'); // 1 day allowed by default
    await as('sales.westave').put(`/api/cash-on-hand/settings/${west}`).send({ maxDays: 0 }).expect(403);
    ok(await as('head.auditor').put(`/api/cash-on-hand/settings/${west}`).send({ maxDays: 1 }));
    // two earlier days with cash still in the branch
    await prisma.dailyClose.create({ data: { locationId: west, businessDate: day(-3), closedAt: new Date(), totalCashDeposit: '2000.00', expectedCash: '2000.00', cashSales: '2000.00' } });
    await prisma.dailyClose.create({ data: { locationId: west, businessDate: day(-1), closedAt: new Date(), totalCashDeposit: '500.00', expectedCash: '500.00', cashSales: '500.00' } });
    b = ok(await as('sales.westave').get('/api/cash-on-hand')).body;
    const st = (d: string) => b.days.find((x: { businessDate: string }) => x.businessDate === d).status;
    expect(st(dateOnly(day(-3)))).toBe('OVERDUE'); expect(st(dateOnly(day(-1)))).toBe('DUE_TODAY');
    expect(Number(b.cashOnHand)).toBeGreaterThanOrEqual(3500);
    expect(ok(await as('sales.westave').get('/api/dashboard')).body.cashOnHand.overdue).toBe(1);
    expect(ok(await as('head.auditor').get('/api/dashboard')).body.cashOnHandBranches.some((x: { id: string }) => x.id === west)).toBe(true);
    // the branch asks for more days for yesterday's cash; the Head Auditor and the Owner both approve
    const ext = ok(await as('sales.westave').post('/api/cash-on-hand/extensions').send({ locationId: west, businessDate: dateOnly(day(-1)), requestedUntil: dateOnly(day(2)), reason: 'Bank closed for the holiday' })).body;
    ok(await as('head.auditor').post(`/api/approvals/${ext.approvalRequestId}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.cashDepositExtension.findUniqueOrThrow({ where: { id: ext.id } })).status).toBe('PENDING');
    ok(await as('admin').post(`/api/approvals/${ext.approvalRequestId}/decide`).send({ decision: 'APPROVE' }));
    b = ok(await as('sales.westave').get('/api/cash-on-hand')).body;
    const y = b.days.find((x: { businessDate: string }) => x.businessDate === dateOnly(day(-1))); expect(y.status).toBe('OPEN'); expect(y.dueDate).toBe(dateOnly(day(2)));
    // daily reminder: auditors and branch reminded; the overdue day becomes an HR notice (once)
    ok(await as('admin').post('/api/cash-on-hand/remind')); ok(await as('admin').post('/api/cash-on-hand/remind'));
    for (const u of ['head.auditor', 'asst.auditor', 'audit.assoc', 'sales.westave']) expect(await notes(u)).toContain('CASH_DEPOSIT_DUE');
    expect(await notes('hr.staff')).toContain('HR_NOTICE_NTE');
    await as('sales.westave').get('/api/hr-notices').expect(403);
    const notices = ok(await as('hr.staff').get('/api/hr-notices')).body as { id: string; title: string; locationId: string }[];
    const mine = notices.filter((n) => n.locationId === west); expect(mine).toHaveLength(1); expect(mine[0].title).toContain(dateOnly(day(-3)));
    expect(ok(await as('hr.staff').put(`/api/hr-notices/${mine[0].id}`).send({ status: 'NTE_ISSUED', note: 'NTE served' })).body.status).toBe('NTE_ISSUED');
    // deposit the overdue day to the company GCash
    const payAccts = ok(await as('sales.westave').get(`/api/accounts/payment?locationId=${west}`)).body as { id: string; title: string }[];
    const gcash = payAccts.find((a) => a.title === 'Gcash (GWS)')!; expect(gcash).toBeTruthy();
    expect((ok(await as('exec.assistant').get('/api/bank-entries/options')).body.banks as { title: string }[]).some((a) => a.title === 'Gcash (GWS)')).toBe(true);
    ok(await as('sales.westave').post('/api/expenses/deposits').send({ locationId: west, businessDate: dateOnly(day(-3)), amount: 2000, bankAccountId: gcash.id, depositedAt: today() }));
    b = ok(await as('sales.westave').get('/api/cash-on-hand')).body;
    expect(b.days.find((x: { businessDate: string }) => x.businessDate === dateOnly(day(-3))).status).toBe('DEPOSITED'); expect(b.overdue).toBe(0);
  });

  it('customer follow-ups: items ordered in the contact list; days to consume per product → the store is reminded to call; SMS / email with the Owner\'s message (sent by hand or automatically)', async () => {
    ok(await as('admin').patch(`/api/products/${pid}`).send({ consumptionDays: 10 }));
    const s = ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `DR-${run}-FU`, customerName: 'Maria Santos', customerPhone: '0917 123 4567', customerEmail: 'maria@example.com', lines: [{ productId: pid, qty: 2 }] })).body;
    const f = await prisma.customerFollowUp.findFirstOrThrow({ where: { salesDocId: s.id } });
    expect(f.dueDate.toISOString().slice(0, 10)).toBe(new Date(new Date(`${today()}T00:00:00Z`).getTime() + 20 * 86400e3).toISOString().slice(0, 10)); // 2 units × 10 days
    const contacts = ok(await as('sales.westave').get(`/api/reports/customers?locationId=${west}`)).body as { name: string; itemsOrdered: string }[];
    expect(contacts.find((c) => c.name === 'Maria Santos')!.itemsOrdered).toMatch(/2× AAA Incentive Whey/);
    // the Owner edits the message; the morning job tells the store and (when switched on) sends it
    await as('sales.westave').put('/api/settings').send({ 'followup.sms_template': 'x' }).expect(403);
    ok(await as('admin').put('/api/settings').send({ 'followup.sms_template': 'Hi {customer}, your {product} from {store} may be finished!', 'followup.auto_sms': true }));
    await prisma.customerFollowUp.update({ where: { id: f.id }, data: { dueDate: new Date(Date.now() - 86400e3) } });
    const job = ok(await as('admin').post('/api/customer-follow-ups/run')).body; expect(job.notified).toBeGreaterThanOrEqual(1);
    expect(await notes('sales.westave')).toContain('CUSTOMER_FOLLOW_UP');
    const logged = await prisma.customerMessage.findFirstOrThrow({ where: { followUpId: f.id, channel: 'SMS' } });
    expect(logged.body).toBe('Hi Maria Santos, your AAA Incentive Whey ' + run + ' from Get Wheysted West Ave may be finished!'); expect(logged.status).toBe('NOT_CONFIGURED'); // no SMS key in tests
    const list = ok(await as('sales.westave').get('/api/customer-follow-ups')).body as { id: string; status: string; product: string }[];
    expect(list.find((x) => x.id === f.id)!.status).toBe('NOTIFIED');
    const pv = ok(await as('sales.westave').get(`/api/customer-follow-ups/${f.id}/preview`)).body; expect(pv.email).toMatch(/Maria Santos/);
    const m = ok(await as('sales.westave').post('/api/customer-follow-ups/send').send({ channel: 'EMAIL', followUpId: f.id, body: 'Edited message' })).body; expect(m.to).toBe('maria@example.com'); expect(m.body).toBe('Edited message');
    ok(await as('sales.westave').put(`/api/customer-follow-ups/${f.id}`).send({ status: 'CONTACTED', note: 'Will visit Saturday' }));
    ok(await as('admin').put('/api/settings').send({ 'followup.auto_sms': false }));
  });

  it('daily sales report: the branch reviews and submits it as true and correct (day closes); reminder before 8 PM; not submitted by the cut-off → submitted as it stood, auditors and HR notified', async () => {
    const csr = (await prisma.location.findUniqueOrThrow({ where: { code: 'CSR' } })).id;
    expect(ok(await as('sales.csr').get('/api/reports/daily-sales/submission')).body.submitted).toBe(false);
    expect(ok(await as('head.auditor').get('/api/dashboard')).body.salesReportsMissing.map((b: { name: string }) => b.name)).toContain('West Ave');
    await as('sales.csr').post('/api/reports/daily-sales/submit').send({ date: today(), acknowledged: false }).expect(400);
    const sub = ok(await as('sales.csr').post('/api/reports/daily-sales/submit').send({ date: today(), acknowledged: true })).body;
    expect(sub.status).toBe('SUBMITTED'); expect(sub.acknowledgement).toMatch(/true and correct/);
    await as('sales.csr').post('/api/reports/daily-sales/submit').send({ date: today(), acknowledged: true }).expect(400);
    expect(ok(await as('sales.csr').get('/api/dashboard')).body.salesReport.submitted).toBe(true);
    // the day is closed for CSR: a new sale or an edit goes through the revision (post-close) protocol
    const r = await as('sales.csr').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `DR-${run}-LATE`, lines: [{ productId: pid, qty: 1 }] }).expect(400);
    expect(JSON.stringify(r.body)).toMatch(/closed/i);
    ok(await as('admin').post('/api/reports/daily-sales/remind'));
    expect(await notes('sales.westave')).toContain('SALES_REPORT_REMINDER'); expect(await notes('sales.csr')).not.toContain('SALES_REPORT_REMINDER');
    ok(await as('admin').post('/api/reports/daily-sales/auto-submit'));
    const w = await prisma.salesReportSubmission.findUniqueOrThrow({ where: { locationId_businessDate: { locationId: west, businessDate: new Date(`${today()}T00:00:00Z`) } } });
    expect(w.status).toBe('AUTO_SUBMITTED'); expect(Number(w.overallSales)).toBeGreaterThan(0);
    for (const u of ['head.auditor', 'asst.auditor', 'audit.assoc', 'hr.staff']) expect(await notes(u)).toContain('SALES_REPORT_NOT_SUBMITTED');
    expect((await prisma.salesReportSubmission.findUniqueOrThrow({ where: { locationId_businessDate: { locationId: csr, businessDate: new Date(`${today()}T00:00:00Z`) } } })).status).toBe('SUBMITTED');
  });

  it('consignments: the Owner creates consignee accounts; a sales associate sends goods, reports consignee sales (prices pre-filled, editable, printable draft) and takes returns — manager first, the Owner last; cost stays hidden', async () => {
    const pending = async (type: string, where: Record<string, unknown> = {}) => (await prisma.approvalRequest.findFirst({ where: { type, status: 'PENDING', ...where }, orderBy: { createdAt: 'desc' } }))!;
    await as('head.auditor').post('/api/consignment/consignees').send({ name: `Gym ${run}`, priceBasis: 'SRP' }).expect(403);
    const cn = ok(await as('admin').post('/api/consignment/consignees').send({ name: `Gym ${run}`, contactPerson: 'Ana', phone: '0917', address: 'QC', priceBasis: 'SRP', settlementDays: 30 })).body;
    const costCn = ok(await as('admin').post('/api/consignment/consignees').send({ name: `CostGym ${run}`, priceBasis: 'COST' })).body;
    expect((ok(await as('sales.westave').get('/api/consignment/consignees')).body as { id: string }[]).some((c) => c.id === cn.id)).toBe(true);
    // goods out: branch → consignee; Asst Auditor checks, then the Owner
    const t = ok(await as('sales.westave').post('/api/transfers').send({ fromLocationId: west, toLocationId: cn.id, transferType: 'CONSIGNMENT_OUT', lines: [{ productId: pid, qty: 3 }] })).body;
    ok(await as('sales.westave').post(`/api/transfers/${t.id}/submit`));
    expect(await prisma.approvalRequest.count({ where: { type: 'CONSIGNMENT_OUT', documentId: t.id } })).toBe(0); // the Owner only after the manager
    ok(await as('asst.auditor').post(`/api/approvals/${(await pending('CONSIGNMENT_CHECK_BRANCH', { documentId: t.id })).id}/decide`).send({ decision: 'APPROVE' }));
    ok(await as('admin').post(`/api/approvals/${(await pending('CONSIGNMENT_OUT', { documentId: t.id })).id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.stockBalance.aggregate({ where: { locationId: cn.id, productId: pid }, _sum: { qty: true } }))._sum.qty).toBe(3);
    // consignee sales: prices pre-filled from the agreement, edited, printed as a draft, then approved
    const pre = ok(await as('sales.westave').post('/api/consignment/sale-reports/prefill').send({ agreementId: cn.agreementId, productIds: [pid], date: today() })).body;
    expect(pre.prices[pid]).toBe(1000);
    const body = { agreementId: cn.agreementId, periodFrom: today(), periodTo: today(), lines: [{ productId: pid, qty: 2, unitPrice: 950 }] };
    const draft = await as('sales.westave').post('/api/consignment/sale-reports/draft').send(body).expect(201);
    expect(draft.text || draft.body.toString()).toMatch(/DRAFT/);
    expect(ok(await as('sales.westave').post('/api/consignment/sale-reports').send(body)).body.pending).toBe(true);
    const chk = await pending('CONSIGNMENT_CHECK_BRANCH', { documentType: 'ConsignmentSaleRequest' });
    ok(await as('head.auditor').post(`/api/approvals/${chk.id}/decide`).send({ decision: 'APPROVE' }));
    ok(await as('admin').post(`/api/approvals/${(await pending('CONSIGNMENT_OUT', { documentType: 'ConsignmentSaleRequest', documentId: chk.documentId })).id}/decide`).send({ decision: 'APPROVE' }));
    const rep = await prisma.consignmentSaleReport.findFirstOrThrow({ where: { agreementId: cn.agreementId }, include: { lines: true } });
    expect(Number(rep.lines[0].unitPrice)).toBe(950); expect(rep.salesDocId).toBeTruthy();
    // a cost-based consignee: people without cost access never get the price or the value at cost
    const hidden = ok(await as('sales.westave').post('/api/consignment/sale-reports/prefill').send({ agreementId: costCn.agreementId, productIds: [pid], date: today() })).body;
    expect(hidden.hidden).toBe(true); expect(hidden.prices[pid]).toBeNull();
    expect(ok(await as('head.auditor').post('/api/consignment/sale-reports/prefill').send({ agreementId: costCn.agreementId, productIds: [pid], date: today() })).body.prices[pid]).toBe(500);
    expect(JSON.stringify(ok(await as('sales.westave').get('/api/consignment/out-summary')).body)).not.toMatch(/valueAtCost/);
    expect(JSON.stringify(ok(await as('head.auditor').get('/api/consignment/out-summary')).body)).toMatch(/valueAtCost/);
    // goods back from the consignee to the branch
    const back = ok(await as('sales.westave').post('/api/transfers').send({ fromLocationId: cn.id, toLocationId: west, transferType: 'CONSIGNMENT_RETURN', lines: [{ productId: pid, qty: 1 }] })).body;
    ok(await as('sales.westave').post(`/api/transfers/${back.id}/submit`));
    expect(await pending('CONSIGNMENT_CHECK_BRANCH', { documentId: back.id })).toBeTruthy();
  });

  it('cost typed directly on a product: the Head Auditor sends it, the Owner approves (and the other way round); cost roles are told; others cannot', async () => {
    await as('sales.westave').post(`/api/products/${pid}/cost`).send({ cost: 1, reason: 'test' }).expect(403);
    const r = ok(await as('head.auditor').post(`/api/products/${pid}/cost`).send({ cost: 520, reason: 'New supplier price list' })).body; expect(r.pending).toBe(true);
    const req = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.approvalRequestId } }); expect(req.requiredApproverRoles).toEqual(['ADMIN']);
    await as('head.auditor').post(`/api/products/${pid}/cost`).send({ cost: 530, reason: 'again' }).expect(400); // one pending change at a time
    ok(await as('admin').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    const p = ok(await as('head.auditor').get(`/api/products/${pid}`)).body; expect(p.costHistory[0].cost).toBe('520');
    expect(await notes('acct.head')).toContain('COST'); expect(((ok(await as('sales.westave').get('/api/dashboard')).body.priceUpdates ?? []) as { newValue: string | null }[]).some((u) => Number(u.newValue) === 520)).toBe(false);
    expect(((ok(await as('acct.head').get('/api/dashboard')).body.priceUpdates ?? []) as { newValue: string | null }[]).some((u) => Number(u.newValue) === 520)).toBe(true);
    const r2 = ok(await as('admin').post(`/api/products/${pid}/cost`).send({ cost: 515, reason: 'Owner correction' })).body;
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r2.approvalRequestId } })).requiredApproverRoles).toEqual(['HEAD_AUDITOR']);
  });

  it('sales report for any branch and period, and month-to-date / year performance per branch; branch staff see only their branch; profit only with cost access', async () => {
    const all = ok(await as('admin').get(`/api/reports/sales-summary?from=${today().slice(0, 8)}01&to=${today()}`)).body;
    expect(all.branch).toBe('All branches'); expect(all.totals.sales).toBeGreaterThan(0);
    expect(all.perBranch.reduce((t: number, b: { total: number }) => t + b.total, 0)).toBeCloseTo(all.totals.sales, 2);
    expect(all.perDay.reduce((t: number, d: { total: number }) => t + d.total, 0)).toBeCloseTo(all.totals.sales, 2);
    expect(Object.values(all.totals.byMode as Record<string, number>).reduce((t, v) => t + v, 0)).toBeCloseTo(all.totals.sales, 2);
    expect(all.totals.grossProfit).toBeDefined();
    const mine = ok(await as('sales.westave').get('/api/reports/sales-summary')).body;
    expect(mine.branch).toBe('West Ave'); expect(mine.totals.grossProfit).toBeUndefined(); expect(mine.perBranch).toHaveLength(1);
    await as('sales.westave').get(`/api/reports/sales-summary?locationId=${(await prisma.location.findUniqueOrThrow({ where: { code: 'CSR' } })).id}`).expect(403);
    const x = await as('admin').get(`/api/reports/sales-summary.xlsx?from=${today()}&to=${today()}`).expect(200); expect(x.headers['content-type']).toMatch(/spreadsheet/);
    const perf = ok(await as('head.auditor').get('/api/reports/sales-performance')).body;
    expect(perf.branches.length).toBeGreaterThan(3); expect(perf.days.length).toBe(Number(today().slice(8)));
    const wa = perf.branches.find((b: { name: string }) => b.name === 'West Ave').id;
    expect(perf.cumulative[wa].at(-1)).toBe(perf.monthToDate.perBranch.find((b: { id: string }) => b.id === wa).total);
    expect(perf.byMonth[wa].at(-1)).toBeCloseTo(perf.cumulative[wa].at(-1), 2);
    expect(ok(await as('sales.westave').get('/api/reports/sales-performance')).body.branches).toHaveLength(1);
  });
});

describe('E-commerce: TikTok, Shopee and Lazada kept separate (owner request 2026-09-28)', () => {
  let wh = ''; let pid = ''; let pid2 = ''; let tiktok = ''; let skuA = ''; let skuB = '';
  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const giveStock = async (locationId: string, productId: string, qty: number, cost: number) => {
    const batch = await prisma.batch.create({ data: { productId, batchNo: `E-${run}`, receivedRef: 'TEST', unitCost: cost.toFixed(2) } });
    await prisma.stockLedger.create({ data: { locationId, productId, batchId: batch.id, qtyDelta: qty, movementType: 'RECEIVE', documentType: 'OpeningStock', documentId: batch.id, unitCost: cost.toFixed(2), businessDate: new Date(`${today()}T00:00:00Z`) } });
    await prisma.stockBalance.create({ data: { locationId, productId, batchId: batch.id, qty } });
  };
  const onHand = async (locationId: string, productId: string) => (await prisma.stockBalance.aggregate({ where: { locationId, productId }, _sum: { qty: true } }))._sum.qty ?? 0;
  const upload = (u: string, path: string, csv: string, name: string) => as(u).post(path).attach('file', Buffer.from(csv), name);
  const approve = async (u: string, type: string, documentId: string) => {
    const r = await prisma.approvalRequest.findFirst({ where: { type, documentId, status: 'PENDING' } });
    if (!r) throw new Error(`no pending ${type}`);
    ok(await as(u).post(`/api/approvals/${r.id}/decide`).send({ decision: 'APPROVE' }));
  };
  beforeAll(async () => {
    wh = (await prisma.location.findUniqueOrThrow({ where: { code: 'WH' } })).id;
    tiktok = (await prisma.location.findUniqueOrThrow({ where: { code: 'ECOM-TIKTOK' } })).id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const supp = cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id;
    const a = ok(await as('admin').post('/api/products').send({ name: `ECOM Whey ${run}`, categoryId: supp, prices: { RETAIL: 1000, FRANCHISE: 700 }, cost: 600 })).body;
    const b = ok(await as('admin').post('/api/products').send({ name: `ECOM Creatine ${run}`, categoryId: supp, prices: { RETAIL: 500, FRANCHISE: 350 }, cost: 200 })).body;
    pid = a.id; pid2 = b.id; skuA = a.sku; skuB = b.sku;
    await giveStock(wh, pid, 10, 600); await giveStock(wh, pid2, 10, 200);
    ok(await as('admin').put('/api/settings').send({ 'gl.auto_posting_enabled': true }));
  });
  afterAll(async () => { await as('admin').put('/api/settings').send({ 'gl.auto_posting_enabled': false }); });

  it('order file → draft pull-out from the Warehouse; unknown SKUs are matched once and remembered; duplicates and cancelled orders skipped; each platform separate', async () => {
    const file = ['Order ID,Order Status,Seller SKU,Product Name,Quantity,Tracking ID', `T${run}A,To ship,${skuA},Whey,2,TRK${run}A`, `T${run}B,To ship,TT-CREATINE-${run},Creatine,1,TRK${run}B`, `T${run}C,Cancelled,${skuA},Whey,1,`].join('\n');
    const r1 = ok(await upload('ecomm.assoc', '/api/ecommerce/tiktok/orders/upload', file, 'tiktok-orders.csv')).body;
    expect(r1.ordersAdded).toBe(1); expect(r1.cancelled).toEqual([`T${run}C`]); expect(r1.unknownSkus[0].platformSku).toBe(`TT-CREATINE-${run}`);
    ok(await as('ecomm.assoc').post('/api/ecommerce/tiktok/sku-maps').send({ platformSku: `TT-CREATINE-${run}`, productId: pid2 }));
    const r2 = ok(await upload('ecomm.assoc', '/api/ecommerce/tiktok/orders/upload', file, 'tiktok-orders.csv')).body;
    expect(r2.ordersAdded).toBe(1); expect(r2.duplicates).toEqual([`T${run}A`]);
    // Shopee is its own list: removing an order from the draft re-totals the items
    const s = ok(await upload('ecomm.assoc', '/api/ecommerce/shopee/orders/upload', `Order ID,SKU Reference No.,Quantity,Tracking Number*\nS${run}1,${skuA},1,SPX1\nS${run}2,${skuA},3,SPX2\n`, 'shopee.csv')).body;
    const sp = ok(await as('ecomm.assoc').get(`/api/ecommerce/pullouts/${s.pullOut.id}`)).body;
    expect(sp.picking.reduce((t: number, l: { qty: number }) => t + l.qty, 0)).toBe(4);
    ok(await as('ecomm.assoc').post(`/api/ecommerce/pullouts/${s.pullOut.id}/remove-order/${sp.orders.find((o: { orderId: string }) => o.orderId === `S${run}2`).id}`));
    expect(ok(await as('ecomm.assoc').get(`/api/ecommerce/pullouts/${s.pullOut.id}`)).body.picking[0].qty).toBe(1);
    const tt = ok(await as('ecomm.assoc').get('/api/ecommerce/tiktok/pullouts')).body as { id: string }[];
    expect(tt).toHaveLength(2); expect(tt.map((x) => x.id)).not.toContain(s.pullOut.id);
    // not enough stock in the Warehouse → the order waits, nothing is pulled out
    const big = ok(await upload('ecomm.assoc', '/api/ecommerce/lazada/orders/upload', `Order Number,Seller SKU,Quantity\nL${run}1,${skuB},99\n`, 'lazada.csv')).body;
    expect(big.ordersAdded).toBe(0); expect(big.notEnoughStock).toHaveLength(1);
    // the E-comm Associate works only in E-commerce and never sees cost
    await as('ecomm.assoc').get('/api/transfers').expect(403);
    expect(has(sp, /unitCost/)).toBe(false);
  });

  it('only the Warehouse In-Charge approves the pull-out; the items move to "TikTok – with courier" and the orders are shipped', async () => {
    const [first, second] = (ok(await as('ecomm.assoc').get('/api/ecommerce/tiktok/pullouts')).body as { id: string; orders: number }[]).reverse();
    ok(await as('ecomm.assoc').post(`/api/ecommerce/pullouts/${first.id}/submit`));
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: first.id, status: 'PENDING' } });
    expect(req.type).toBe('ECOM_PULLOUT'); expect(req.requiredApproverRoles).toEqual(['WAREHOUSE_IN_CHARGE']);
    await approve('wh.incharge', 'ECOM_PULLOUT', first.id);
    expect(await onHand(tiktok, pid)).toBe(2); expect(await onHand(wh, pid)).toBe(8);
    expect((await prisma.transferDoc.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('RECEIVED');
    ok(await as('ecomm.assoc').post(`/api/ecommerce/pullouts/${second.id}/submit`));
    await approve('wh.incharge', 'ECOM_PULLOUT', second.id);
    const tracker = ok(await as('ecomm.assoc').get('/api/ecommerce/tiktok/orders?status=SHIPPED')).body;
    expect(tracker.orders.map((o: { orderId: string }) => o.orderId).sort()).toEqual([`T${run}A`, `T${run}B`]);
    expect(await prisma.ecomOrder.count({ where: { platform: 'SHOPEE', status: 'SHIPPED' } })).toBe(0);
  });

  it('payout file: the sale, each TikTok fee, withholding tax and the payout; Accounting approves before it posts; balanced entries; orders not in GWS-ERP listed apart', async () => {
    const file = [
      'Order ID,Subtotal before discounts,Seller discounts,TikTok Shop commission fee,Transaction fee,Seller shipping fee,Withholding tax,Total settlement amount',
      `T${run}A,2000,-100,-152,-42.56,-40,-10,1655.44`,
      `OLD${run},400,0,-30,-9,0,-2,359`,
    ].join('\n');
    const s = ok(await upload('ecomm.assoc', '/api/ecommerce/tiktok/settlements/upload', file, `tiktok-statement-${run}.csv`)).body;
    expect(s.orders).toBe(1); expect(s.counts).toMatchObject({ SALE: 1, UNKNOWN: 1 }); expect(Number(s.payout)).toBe(1655.44); expect(Number(s.check.notInBatch)).toBe(359);
    expect(Number(s.check.computed)).toBe(1655.44); expect(s.costOfSales).toBeUndefined();
    await upload('ecomm.assoc', '/api/ecommerce/tiktok/settlements/upload', file, `tiktok-statement-${run}.csv`).expect(400); // same file twice
    ok(await as('ecomm.assoc').post(`/api/ecommerce/settlements/${s.id}/submit`));
    expect((await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: s.id } })).requiredApproverRoles).toEqual(['ACCOUNTING_HEAD']);
    await approve('acct.head', 'ECOM_SETTLEMENT', s.id);
    const order = await prisma.ecomOrder.findFirstOrThrow({ where: { platform: 'TIKTOK', orderId: `T${run}A` } });
    expect(order.status).toBe('SETTLED');
    const sale = await prisma.salesDoc.findUniqueOrThrow({ where: { id: order.salesDocId! }, include: { lines: true } });
    expect(sale.locationId).toBe(tiktok); expect(sale.channelSub).toBe('TIKTOK'); expect(Number(sale.grandTotal)).toBe(1900);
    expect(sale.lines.reduce((t, l) => t + Number(l.amount), 0)).toBeCloseTo(1900, 2);
    expect(await onHand(tiktok, pid)).toBe(0);
    const vouchers = await prisma.journalVoucher.findMany({ where: { sourceDocumentId: s.id }, include: { lines: { include: { account: true } } } });
    expect(vouchers.length).toBe(2);
    for (const v of vouchers) expect(v.lines.reduce((t, l) => t + Number(l.debit) - Number(l.credit), 0)).toBeCloseTo(0, 2);
    const all = vouchers.flatMap((v) => v.lines);
    expect(Number(all.find((l) => l.account.code === '1091')!.debit)).toBe(1655.44);
    expect(Number(all.find((l) => l.account.title === 'Sales - E-commerce TikTok')!.credit)).toBe(2000);
    expect(Number(all.find((l) => l.account.title === 'Commission Fee - TikTok')!.debit)).toBe(152);
    expect(Number(all.find((l) => l.account.title === 'Creditable Withholding Tax (E-commerce)')!.debit)).toBe(10);
    expect(Number(all.find((l) => /^Direct Cost . Supplements/.test(l.account.title))!.debit)).toBe(1200);
  });

  it('returns: the associate logs the parcel, the In-Charge marks good / damaged; good back to stock, damaged → write-off for the Head Auditor; paid orders reverse the cost', async () => {
    // failed delivery of an order not yet paid
    const r = ok(await as('ecomm.assoc').post('/api/ecommerce/tiktok/returns').send({ ref: `TRK${run}B` })).body;
    const waiting = ok(await as('wh.incharge').get('/api/ecommerce/returns?status=PENDING')).body as { id: string }[];
    expect(waiting.map((x) => x.id)).toContain(r.id);
    await as('ecomm.assoc').post(`/api/ecommerce/returns/${r.id}/receive`).send({ lines: [] }).expect(403);
    const whBefore = await onHand(wh, pid2);
    const got = ok(await as('wh.incharge').post(`/api/ecommerce/returns/${r.id}/receive`).send({ lines: [{ productId: pid2, goodQty: 0, damagedQty: 1 }] })).body;
    expect(await onHand(wh, pid2)).toBe(whBefore + 1);
    expect(got.writeoffId).toBeTruthy();
    expect((await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: got.writeoffId } })).type).toBe('WRITEOFF');
    expect((await prisma.ecomOrder.findFirstOrThrow({ where: { orderId: `T${run}B` } })).status).toBe('RETURNED');
    // buyer return of a paid order: back to the Warehouse as a sales return, cost back to inventory
    const r2 = ok(await as('ecomm.assoc').post('/api/ecommerce/tiktok/returns').send({ ref: `T${run}A`, reason: 'BUYER_RETURN' })).body;
    const before = await onHand(wh, pid);
    ok(await as('wh.incharge').post(`/api/ecommerce/returns/${r2.id}/receive`).send({ lines: [{ productId: pid, goodQty: 2, damagedQty: 0 }] }));
    expect(await onHand(wh, pid)).toBe(before + 2);
    const v = await prisma.journalVoucher.findFirstOrThrow({ where: { sourceDocumentId: r2.id }, include: { lines: true } });
    expect(v.lines.reduce((t, l) => t + Number(l.debit), 0)).toBe(1200);
  });

  it('ads per platform and month are an expense; the report compares TikTok, Shopee and Lazada; cost only for cost roles', async () => {
    const month = today().slice(0, 7);
    ok(await as('ecomm.assoc').post('/api/ecommerce/tiktok/ads').send({ month, amount: 500 }));
    const up = ok(await upload('ecomm.assoc', '/api/ecommerce/tiktok/ads/upload', `Date,Campaign,Cost\n${today()},Sept sale,250\n`, `ads-${run}.csv`)).body;
    expect(up.months).toEqual([{ month, amount: 250 }]);
    const rep = ok(await as('admin').get(`/api/ecommerce/report?from=${month}-01&to=${today()}`)).body;
    const t = rep.columns.find((c: { platform: string }) => c.platform === 'TIKTOK');
    expect(t).toMatchObject({ grossSales: 2000, sellerDiscounts: 100, netSales: 1900, totalFees: 234.56, withholdingTax: 10, payout: 1655.44, ads: 750, costOfSales: 1200 });
    expect(t.contribution).toBeCloseTo(1900 - 234.56 - 750 - 1200, 2);
    expect(rep.columns.map((c: { name: string }) => c.name)).toEqual(['TikTok Shop', 'Shopee', 'Lazada', 'All platforms']);
    const mine = ok(await as('ecomm.assoc').get(`/api/ecommerce/report?from=${month}-01&to=${today()}`)).body;
    expect(mine.columns[0].costOfSales).toBeUndefined(); expect(mine.columns[0].contribution).toBeUndefined();
    await as('sales.westave').get('/api/ecommerce/report').expect(403);
    // each platform is its own line in the company sales performance graphs
    const perf = ok(await as('admin').get('/api/reports/sales-performance')).body;
    expect(perf.branches.map((b: { name: string }) => b.name)).toContain('E-commerce – TikTok');
  });
});
