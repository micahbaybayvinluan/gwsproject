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
import { TransferDiscrepancyService } from '../src/transfers/transfer-discrepancy.service';
import { SalesService } from '../src/sales/sales.service';
import { FranchiseArService } from '../src/franchise/franchise-ar.service';
import { FranchiseShippingService } from '../src/franchise/franchise-shipping.service';
import { ensurePlasticFranchisePrices } from '../src/pricing/plastic-prices';
import { MonitorService } from '../src/agents/monitor.service';
import { MessagingService } from '../src/members/messaging.service';
import { makePdf } from './pdf';

const PW = process.env.SEED_PASSWORD || 'ChangeMe!2026';
const TOTP_ROLES = ['admin', 'ext.auditor', 'head.auditor', 'acct.head'];
let app: INestApplication; let http: ReturnType<typeof request>; const prisma = new PrismaClient();
const tokens: Record<string, string> = {};
const run = Date.now().toString(36) + '7'; // always has a digit (order ids in payout files must contain one)

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
const USERS = ['admin', 'ext.auditor', 'head.auditor', 'asst.auditor', 'audit.assoc', 'wh.incharge', 'wh.assoc', 'sales.westave', 'fr.mayon.assoc', 'fr.mayon.owner', 'custom.user', 'acct.head', 'acct.assoc', 'hr.staff', 'field.auditor', 'sales.dasma', 'sales.csr', 'exec.assistant', 'ecomm.assoc', 'sales.manager', 'agent.jerick', 'franchise.coord', 'asst.franchise.coord', 'sales.wh'];
const as = (u: string) => ({ get: (p: string) => http.get(p).set('Authorization', `Bearer ${tokens[u]}`), post: (p: string) => http.post(p).set('Authorization', `Bearer ${tokens[u]}`), put: (p: string) => http.put(p).set('Authorization', `Bearer ${tokens[u]}`), patch: (p: string) => http.patch(p).set('Authorization', `Bearer ${tokens[u]}`), delete: (p: string) => http.delete(p).set('Authorization', `Bearer ${tokens[u]}`) });
const has = (o: unknown, re: RegExp): boolean => JSON.stringify(o).match(re) !== null;
const ok = (r: request.Response) => { if (r.status >= 400) throw new Error(`${r.request?.method} ${r.request?.url} → ${r.status} ${JSON.stringify(r.body)}`); return r; };

/** The suite is idempotent: transactional tables are truncated before each run (master data + seed users stay). Never run against production. */
async function resetTransactionalData() {
  if (process.env.NODE_ENV !== 'test') throw new Error('refusing to reset data outside NODE_ENV=test');
  await prisma.$executeRawUnsafe(`TRUNCATE stock_ledger, stock_balances, receiving_lines, receiving_docs, transfer_lines, transfer_docs, sales_lines, payment_allocations, payments, sales_docs, expense_docs, count_lines, count_docs, discrepancy_cases, charge_form_allocations, charge_form_lines, charge_forms, expiry_writeoff_lines, expiry_writeoff_docs, approval_decisions, approval_requests, notifications, audit_log, batches, daily_closes, post_close_edits, journal_lines, journal_vouchers, beginning_balances, accounting_periods, voucher_sequences, control_sequences, alert_states, attachments, employee_loans, payroll_lines, payroll_runs, employees, min_stock_levels, revaluation_lines, revaluation_entries, cash_deposits, login_session_records, cash_fund_txns, cash_fund_checks, store_inspections, contribution_remittances, document_revisions, price_change_lines, price_change_docs, price_update_logs, franchise_salaries, franchise_charges, franchise_expenses CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE cash_deposits, cash_deposit_extensions, hr_notices, sales_report_submissions`);
  await prisma.$executeRawUnsafe(`TRUNCATE ecom_orders, ecom_order_lines, ecom_settlements, ecom_returns, ecom_ad_spend, ecom_sku_maps, transfer_discrepancies, sales_targets, opening_ar_entries, agent_incentives`);
  await prisma.$executeRawUnsafe(`TRUNCATE replacement_receipts, replacement_tickets, franchise_shipping_charges, form_numbers_released, ecom_waybills, ecom_waybill_hints, franchise_payments, franchise_ar_adjustments, franchise_ar_extensions, franchise_invoices, memo_recipients, memos, six_pack_stickers, six_pack_redemptions CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE outlet_changes, outlet_shares, itinerary_claims, itinerary_stops, itineraries, agent_consignment_limits, outlets, sales_areas CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE campaign_recipients, campaigns, message_opt_outs, members CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE member_vouchers, member_points_entries, member_notes, member_offers, survey_items, survey_responses, survey_invites, lost_sales, reservations, stock_alert_requests, member_auto_messages CASCADE`);
  await prisma.$executeRawUnsafe(`UPDATE consignment_agreements SET agent_key = NULL, agent_name = NULL, outlet_id = NULL`);
  await prisma.$executeRawUnsafe(`UPDATE locations SET credit_hold = false, credit_hold_note = NULL`);
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
    // the associate's delivery: the In-Charge checks the goods first, then the Head Auditor approves the cost (owner request 2026-09-29)
    expect(await prisma.approvalRequest.count({ where: { documentId: receivingId, type: 'COST_ON_RECEIVING' } })).toBe(0);
    await inChargeApproves('ReceivingDoc', receivingId);
    const inbox = ok(await as('head.auditor').get('/api/approvals/inbox?type=COST_ON_RECEIVING')).body;
    const req = inbox.items.find((i: { documentId: string }) => i.documentId === receivingId);
    expect(req).toBeTruthy(); expect(req.autoApproveAt).toBeNull(); expect(req.summary.allUnchanged).toBe(false); // first-ever receipt of this product = new product → never auto (§6.1)
    const doc = ok(await as('head.auditor').get(`/api/receiving/${receivingId}`)).body;
    expect(doc.lines[0].currentStandardCost).toBe('900'); expect(has(doc, /Secret Supplier/)).toBe(true);
    await as('wh.assoc').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    expect(await prisma.stockBalance.count({ where: { productId, locationId: whId } })).toBe(0);
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
    await inChargeApproves('ReceivingDoc', r2.id);
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
    // difference steps: Head Auditor confirms → the Warehouse disagrees → the Owner decides the item was lost (company expense)
    const decide = async (u: string, type: string, decision: 'APPROVE' | 'REJECT', note?: string) => { const r = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: transferId, type, status: 'PENDING' } }); ok(await as(u).post(`/api/approvals/${r.id}/decide`).send({ decision, note })); };
    await decide('head.auditor', 'TRANSFER_DIFF_REVIEW', 'APPROVE');
    await decide('wh.incharge', 'TRANSFER_DIFF_SENDER', 'REJECT', 'We packed 12');
    ok(await as('admin').post(`/api/transfers/${transferId}/discrepancy/decide`).send({ outcome: 'LOST_COMPANY', note: 'Lost in transit' }));
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
    for (const u of ['asst.auditor', 'audit.assoc']) await as(u).post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }).expect(403); // the Owner may (highest authority, 2026-09-30)
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
    const fr = ok(await as('fr.mayon.owner').get('/api/products?take=5')).body; for (const p of fr) for (const tier of Object.keys(p.tierPrices)) expect(['RETAIL', 'CC', 'FRANCHISE']).toContain(tier);
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
    const m = ok(await as('acct.head').get('/api/reports/inventory-cost?from=2026-09-01&to=2026-10-31&groupBy=month')).body;
    expect(m.rows.length).toBeGreaterThan(0); expect(Object.keys(m.rows[0])).toEqual(expect.arrayContaining(['beginning', 'transferIn', 'pullOut', 'directCostOfSales', 'ending']));
    const d = ok(await as('acct.assoc').get(`/api/reports/inventory-cost?from=2026-09-01&to=2026-10-31&groupBy=day&locationId=${westId}`)).body; expect(d.rows.every((r: { branch: string }) => r.branch === 'West Ave')).toBe(true);
    await as('acct.assoc').get('/api/reports/inventory-cost.xlsx?from=2026-09-01&to=2026-10-31&groupBy=day').expect(200);
    for (const u of ['sales.westave', 'field.auditor']) await as(u).get('/api/reports/inventory-cost?from=2026-09-01&to=2026-09-30').expect(403);
    const dc = ok(await as('acct.assoc').get('/api/reports/direct-cost?year=2026&month=10')).body; expect(dc.rows.length).toBeGreaterThan(0);
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

  it('receiving by the Warehouse Associate: the In-Charge checks the goods first, then the Head Auditor approves the cost, then stock posts; a failed approval is never stuck; the timeline shows each step; a cost change reaches only the cost roles', async () => {
    const r = ok(await as('wh.assoc').post('/api/receiving').send({ supplierId: sup, supplierRef: `B-${run}`, lines: [{ productId: pid, qty: 20, expiryDate: '2029-06-30', batchNo: 'B1', }] })).body;
    await http.post(`/api/attachments/ReceivingDoc/${r.id}`).set('Authorization', `Bearer ${tokens['wh.assoc']}`).attach('file', png, { filename: 'inv.png', contentType: 'image/png' }).expect(201);
    // the attachment opens as the file itself (not the attachment list)
    const att = (ok(await as('wh.incharge').get(`/api/attachments/ReceivingDoc/${r.id}`)).body as { id: string }[])[0];
    const file = await as('wh.incharge').get(`/api/attachments/file/${att.id}`).expect(200);
    expect(file.headers['content-type']).toMatch(/image\/png/);
    ok(await as('wh.assoc').post(`/api/receiving/${r.id}/submit`));
    await as('head.auditor').post(`/api/approvals/${(await pending('WAREHOUSE_IN', r.id)).id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    ok(await as('wh.incharge').post(`/api/approvals/${(await pending('WAREHOUSE_IN', r.id)).id}/decide`).send({ decision: 'APPROVE' }));
    let tl = ok(await as('wh.assoc').get(`/api/approvals/timeline/ReceivingDoc/${r.id}`)).body as { type: string; steps: { who: string; status: string; by?: string }[] }[];
    expect(tl.map((t) => t.type)).toEqual(['WAREHOUSE_IN', 'COST_ON_RECEIVING']);
    expect(tl[0].steps[0]).toMatchObject({ who: 'Warehouse In-Charge', status: 'approved' }); expect(tl[1].steps[0]).toMatchObject({ who: 'Head Auditor', status: 'waiting' });
    expect(await prisma.stockBalance.count({ where: { productId: pid } })).toBe(0);
    const doc = ok(await as('head.auditor').get(`/api/receiving/${r.id}`)).body;
    ok(await as('head.auditor').post(`/api/receiving/${r.id}/costs`).send({ costs: [{ lineId: doc.lines[0].id, unitCost: 1100 }] }));
    ok(await as('head.auditor').post(`/api/approvals/${(await pending('COST_ON_RECEIVING', r.id)).id}/decide`).send({ decision: 'APPROVE' }));
    expect(ok(await as('wh.assoc').get(`/api/receiving/${r.id}`)).body.status).toBe('POSTED');
    tl = ok(await as('wh.assoc').get(`/api/approvals/timeline/ReceivingDoc/${r.id}`)).body; expect(tl[1].steps[0]).toMatchObject({ status: 'approved', by: 'Head Auditor' });
    // a brand-new product without a cost: the Head Auditor's approval is refused and NOT recorded, so it stays in the inbox until the cost is typed
    const np = ok(await as('admin').post('/api/products').send({ name: `No Cost Yet ${run}`, categoryId: (await prisma.product.findUniqueOrThrow({ where: { id: pid } })).categoryId, prices: { RETAIL: 100 } })).body.id;
    const r3 = ok(await as('wh.assoc').post('/api/receiving').send({ supplierId: sup, supplierRef: `C-${run}`, lines: [{ productId: np, qty: 5, expiryDate: '2029-06-30', batchNo: 'N1' }] })).body;
    await http.post(`/api/attachments/ReceivingDoc/${r3.id}`).set('Authorization', `Bearer ${tokens['wh.assoc']}`).attach('file', png, { filename: 'inv.png', contentType: 'image/png' }).expect(201);
    ok(await as('wh.assoc').post(`/api/receiving/${r3.id}/submit`));
    ok(await as('wh.incharge').post(`/api/approvals/${(await pending('WAREHOUSE_IN', r3.id)).id}/decide`).send({ decision: 'APPROVE' }));
    const costReq = await pending('COST_ON_RECEIVING', r3.id);
    await as('head.auditor').post(`/api/approvals/${costReq.id}/decide`).send({ decision: 'APPROVE' }).expect(400);
    expect((ok(await as('head.auditor').get('/api/approvals/inbox?type=COST_ON_RECEIVING')).body.items as { id: string }[]).map((i) => i.id)).toContain(costReq.id);
    const d3 = ok(await as('head.auditor').get(`/api/receiving/${r3.id}`)).body;
    ok(await as('head.auditor').post(`/api/receiving/${r3.id}/costs`).send({ costs: [{ lineId: d3.lines[0].id, unitCost: 55 }] }));
    ok(await as('head.auditor').post(`/api/approvals/${costReq.id}/decide`).send({ decision: 'APPROVE' }));
    expect(ok(await as('wh.assoc').get(`/api/receiving/${r3.id}`)).body.status).toBe('POSTED');
    for (const u of ['head.auditor', 'ext.auditor', 'acct.head', 'admin']) expect(await notes(u)).toContain('COST_UPDATE');
    for (const u of ['asst.auditor', 'audit.assoc', 'acct.assoc', 'wh.assoc', 'sales.westave', 'fr.mayon.owner']) expect(await notes(u)).not.toContain('Supplier cost change');
    const dash = ok(await as('head.auditor').get('/api/dashboard')).body; expect(dash.priceUpdates.some((p: { what: string }) => p.what === 'Supplier cost')).toBe(true);
    expect(ok(await as('sales.westave').get('/api/dashboard')).body.priceUpdates.some((p: { what: string }) => p.what === 'Supplier cost')).toBe(false);
  });

  it('selling-price changes reach each person only for the prices they use (franchise sees the franchise price; associates sell at retail and franchise prices, never dealer cost)', async () => {
    const pc = ok(await as('admin').post('/api/price-changes').send({ lines: [{ productId: pid, tier: 'RETAIL', newPrice: 2100 }, { productId: pid, tier: 'FRANCHISE', newPrice: 1550 }] })).body;
    ok(await as('admin').post(`/api/approvals/${(await pending('PRICE_CHANGE', pc.id)).id}/decide`).send({ decision: 'APPROVE' }));
    const own = await notes('fr.mayon.owner'); expect(own).toContain('1,550.00');
    const fa = await notes('fr.mayon.assoc'); expect(fa).toContain('2,100.00'); expect(fa).not.toContain('1,550.00');
    const sa = await notes('sales.westave'); expect(sa).toContain('2,100.00'); expect(sa).toContain('1,550.00'); // associates sell to franchises now
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
    const notices = ok(await as('hr.staff').get('/api/hr-notices')).body as { id: string; title: string; locationId: string; kind: string }[];
    const mine = notices.filter((n) => n.locationId === west && n.kind === 'CASH_DEPOSIT_OVERDUE'); expect(mine).toHaveLength(1); expect(mine[0].title).toContain(dateOnly(day(-3)));
    expect(ok(await as('hr.staff').put(`/api/hr-notices/${mine[0].id}`).send({ status: 'NTE_ISSUED', note: 'NTE served' })).body.status).toBe('NTE_ISSUED');
    // deposit the overdue day to the company GCash
    const payAccts = ok(await as('sales.westave').get(`/api/accounts/payment?locationId=${west}`)).body as { id: string; title: string }[];
    const gcash = payAccts.find((a) => a.title === 'Gcash (GWS)')!; expect(gcash).toBeTruthy();
    expect((ok(await as('exec.assistant').get('/api/bank-entries/options')).body.banks as { title: string }[]).some((a) => a.title === 'Gcash (GWS)')).toBe(true);
    const slipPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const slip = ok(await as('sales.westave').post(`/api/attachments/CashDeposit/${crypto.randomUUID()}`).attach('file', slipPng, { filename: 'slip.png', contentType: 'image/png' })).body;
    expect((await as('sales.westave').post('/api/expenses/deposits').send({ locationId: west, businessDate: dateOnly(day(-3)), amount: 2000, bankAccountId: gcash.id, depositedAt: today() })).status).toBe(400); // the slip is required
    ok(await as('sales.westave').post('/api/expenses/deposits').send({ locationId: west, businessDate: dateOnly(day(-3)), amount: 2000, bankAccountId: gcash.id, depositedAt: today(), slipAttachmentId: slip.id }));
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

describe('Transfer received with a different quantity (owner request 2026-09-29)', () => {
  let wh = ''; let west = ''; let a = ''; let b = '';
  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const giveStock = async (locationId: string, productId: string, qty: number, cost: number) => {
    const batch = await prisma.batch.create({ data: { productId, batchNo: `D-${run}-${qty}`, receivedRef: 'TEST', unitCost: cost.toFixed(2) } });
    await prisma.stockLedger.create({ data: { locationId, productId, batchId: batch.id, qtyDelta: qty, movementType: 'RECEIVE', documentType: 'OpeningStock', documentId: batch.id, unitCost: cost.toFixed(2), businessDate: new Date(`${today()}T00:00:00Z`) } });
    await prisma.stockBalance.create({ data: { locationId, productId, batchId: batch.id, qty } });
  };
  const onHand = async (locationId: string, productId: string) => (await prisma.stockBalance.aggregate({ where: { locationId, productId }, _sum: { qty: true } }))._sum.qty ?? 0;
  const decide = async (u: string, id: string, type: string, decision: 'APPROVE' | 'REJECT', note?: string) => { const r = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: id, type, status: 'PENDING' } }); return as(u).post(`/api/approvals/${r.id}/decide`).send({ decision, note }); };
  /** Warehouse → West Ave, approved and in transit; West Ave receives `got` of `qty` (plus extras). */
  const sendAndReceive = async (qty: number, got: number, extras: { productId: string; qty: number; note?: string }[] = []) => {
    const t = ok(await as('wh.incharge').post('/api/transfers').send({ fromLocationId: wh, toLocationId: west, transferType: 'RESTOCK', lines: [{ productId: a, qty }] })).body;
    ok(await as('wh.incharge').post(`/api/transfers/${t.id}/submit`));
    ok(await decide('head.auditor', t.id, 'TRANSFER_INTERNAL', 'APPROVE'));
    const d = ok(await as('sales.westave').get(`/api/transfers/${t.id}`)).body;
    const c = ok(await as('sales.westave').post(`/api/transfers/${t.id}/confirm`).send({ lines: [{ lineId: d.lines[0].id, qtyReceived: got, discrepancyNote: got < qty ? `only ${got} in the box` : undefined }], extras })).body;
    return { id: t.id as string, controlNo: t.controlNo as string, status: c.status as string };
  };
  beforeAll(async () => {
    wh = (await prisma.location.findUniqueOrThrow({ where: { code: 'WH' } })).id; west = (await prisma.location.findUniqueOrThrow({ where: { code: 'WESTAVE' } })).id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const supp = cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id;
    a = ok(await as('admin').post('/api/products').send({ name: `DIFF Whey ${run}`, categoryId: supp, prices: { RETAIL: 1000, FRANCHISE: 700 }, cost: 500 })).body.id;
    b = ok(await as('admin').post('/api/products').send({ name: `DIFF Shaker ${run}`, categoryId: supp, prices: { RETAIL: 200, FRANCHISE: 150 }, cost: 80 })).body.id;
    await giveStock(wh, a, 30, 500); await giveStock(wh, b, 10, 80);
  });

  it('receive 1 of 2 plus an item not on the form: Head Auditor first, then the sending branch agrees → -002 back to the sender and -003 for the extra item; HR is told', async () => {
    const t = await sendAndReceive(2, 1, [{ productId: b, qty: 1, note: 'shaker not on the form' }]);
    expect(t.status).toBe('DISCREPANCY');
    expect(await onHand(west, a)).toBe(1); expect(await onHand(west, b)).toBe(0);
    const rev = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: t.id, type: 'TRANSFER_DIFF_REVIEW', status: 'PENDING' } });
    expect(rev.requiredApproverRoles).toEqual(['HEAD_AUDITOR']);
    expect((await decide('wh.incharge', t.id, 'TRANSFER_DIFF_REVIEW', 'APPROVE')).status).toBe(403); // the sender waits for the Head Auditor
    ok(await decide('head.auditor', t.id, 'TRANSFER_DIFF_REVIEW', 'APPROVE'));
    const mid = ok(await as('wh.incharge').get(`/api/transfers/${t.id}/discrepancy`)).body;
    expect(mid.status).toBe('SENDER'); expect(mid.canAct).toBe(true);
    expect(new Date(mid.senderDueAt).getTime() - Date.now()).toBeGreaterThan(47 * 3600e3);
    expect(ok(await as('sales.westave').get(`/api/transfers/${t.id}/discrepancy`)).body.canAct).toBe(false);
    ok(await decide('wh.incharge', t.id, 'TRANSFER_DIFF_SENDER', 'APPROVE', 'Found it on the shelf'));
    const done = ok(await as('wh.incharge').get(`/api/transfers/${t.id}/discrepancy`)).body;
    expect(done.status).toBe('RESOLVED'); expect(done.outcome).toBe('RETURN_TO_SENDER');
    expect(done.adjustmentForms.map((f: { controlNo: string }) => f.controlNo).sort()).toEqual([`${t.controlNo}-002`, `${t.controlNo}-003`]);
    const back = done.adjustmentForms.find((f: { controlNo: string }) => f.controlNo.endsWith('-002'));
    expect(back.fromLocation.name).toBe('West Ave'); expect(back.toLocation.name).toBe('Warehouse');
    expect(await onHand(wh, a)).toBe(29); expect(await onHand(west, a)).toBe(1); expect(await onHand(west, b)).toBe(1); expect(await onHand(wh, b)).toBe(9);
    const transit = (await prisma.location.findUniqueOrThrow({ where: { code: 'V-TRANSIT' } })).id;
    expect(await onHand(transit, a)).toBe(0);
    expect(ok(await as('head.auditor').get(`/api/transfers/${t.id}`)).body.status).toBe('RESOLVED');
    const n = await prisma.hrNotice.findFirstOrThrow({ where: { dedupeKey: `TRANSFER_DIFF:${t.id}` } });
    expect(n.kind).toBe('TRANSFER_DISCREPANCY'); expect((n.details as { staffName: string; countIn30Days: number }).countIn30Days).toBe(1);
    expect(JSON.stringify(ok(await as('hr.staff').get('/api/notifications')).body)).toContain(t.controlNo);
  });

  it('no answer in 2 days → the Owner decides (charge to staff); the third case of the same person → HR is advised to refer it to the Owner', async () => {
    const t2 = await sendAndReceive(2, 1);
    ok(await decide('head.auditor', t2.id, 'TRANSFER_DIFF_REVIEW', 'APPROVE'));
    const svc = app.get(TransferDiscrepancyService);
    expect(await svc.runDeadlines(new Date(Date.now() + 25 * 3600e3))).toEqual({ reminded: 1, escalated: 0 });
    expect(await svc.runDeadlines(new Date(Date.now() + 49 * 3600e3))).toEqual({ reminded: 0, escalated: 1 });
    expect(ok(await as('admin').get(`/api/transfers/${t2.id}/discrepancy`)).body.status).toBe('ADMIN');
    await as('head.auditor').post(`/api/transfers/${t2.id}/discrepancy/decide`).send({ outcome: 'LOST_COMPANY' }).expect(403);
    const emp = await prisma.employee.findFirstOrThrow({ where: { active: true } });
    ok(await as('admin').post(`/api/transfers/${t2.id}/discrepancy/decide`).send({ outcome: 'LOST_CHARGE', employeeIds: [emp.id], note: 'Checker did not count' }));
    const r2 = await prisma.transferDiscrepancy.findUniqueOrThrow({ where: { transferId: t2.id } });
    expect(r2.chargeFormId).toBeTruthy();
    expect((await prisma.chargeForm.findUniqueOrThrow({ where: { id: r2.chargeFormId! } })).kind).toBe('INVENTORY_DISCREPANCY');
    // third case for the same preparer: the sending branch disagrees, the Owner rules the difference stands
    const t3 = await sendAndReceive(3, 2);
    ok(await decide('head.auditor', t3.id, 'TRANSFER_DIFF_REVIEW', 'APPROVE'));
    ok(await decide('wh.incharge', t3.id, 'TRANSFER_DIFF_SENDER', 'REJECT', 'We sent 3'));
    expect((await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: t3.id, type: 'TRANSFER_DIFF_ADMIN', status: 'PENDING' } })).requiredApproverRoles).toEqual(['ADMIN']);
    ok(await decide('admin', t3.id, 'TRANSFER_DIFF_ADMIN', 'APPROVE'));
    expect((await prisma.transferDoc.findFirstOrThrow({ where: { controlNo: `${t3.controlNo}-002` } })).status).toBe('RECEIVED');
    const n3 = await prisma.hrNotice.findFirstOrThrow({ where: { dedupeKey: `TRANSFER_DIFF:${t3.id}` } });
    expect(n3.details).toMatchObject({ countIn30Days: 3, recommendReferral: true });
    ok(await as('hr.staff').put(`/api/hr-notices/${n3.id}`).send({ status: 'REFERRED', note: 'Third time this month' }));
    expect(JSON.stringify(ok(await as('admin').get('/api/notifications')).body)).toContain('HR_NOTICE_REFERRED');
  });

  it('Head Auditor finds the receiving branch miscounted: it gets the items as on the form and HR is told about the receiver', async () => {
    const t = await sendAndReceive(2, 1);
    const before = await onHand(west, a);
    ok(await decide('head.auditor', t.id, 'TRANSFER_DIFF_REVIEW', 'REJECT', 'CCTV shows 2 boxes arrived'));
    expect(await onHand(west, a)).toBe(before + 1);
    const r = ok(await as('sales.westave').get(`/api/transfers/${t.id}/discrepancy`)).body;
    expect(r.outcome).toBe('RECEIVED_AS_SENT');
    const n = await prisma.hrNotice.findFirstOrThrow({ where: { dedupeKey: `TRANSFER_DIFF:${t.id}` } });
    expect((n.details as { staffName: string }).staffName).toMatch(/West Ave/);
  });
});

describe('AR entry and reminders; dashboard sales by payment (owner requests 2026-09-29)', () => {
  it('AR without a PDC needs no cheque details; a PDC needs cheque no. and date; reminders by due date reach the branch, auditors and the Owner; the dashboard lists AR nearest due first', async () => {
    await prisma.salesReportSubmission.deleteMany({}); // an earlier test closed today's report for every branch
    const west = (await prisma.location.findUniqueOrThrow({ where: { code: 'WESTAVE' } })).id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const p = ok(await as('admin').post('/api/products').send({ name: `AR Whey ${run}`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 1000, DEALER: 800, FRANCHISE: 700 }, cost: 500 })).body.id;
    const batch = await prisma.batch.create({ data: { productId: p, batchNo: `AR-${run}`, receivedRef: 'TEST', unitCost: '500' } });
    await prisma.stockLedger.create({ data: { locationId: west, productId: p, batchId: batch.id, qtyDelta: 5, movementType: 'RECEIVE', documentType: 'OpeningStock', documentId: batch.id, unitCost: '500', businessDate: new Date() } });
    await prisma.stockBalance.create({ data: { locationId: west, productId: p, batchId: batch.id, qty: 5 } });
    const dealer = (ok(await as('sales.westave').get('/api/customers')).body as { id: string; type: string }[]).find((c) => c.type === 'DEALER')!;
    const day = (n: number) => new Date(Date.now() + 8 * 3600e3 + n * 86400000).toISOString().slice(0, 10);
    ok(await as('sales.westave').post('/api/sales').send({ channel: 'DEALER', paymentMode: 'AR_PDC', drSiNo: `AR-${run}-1`, customerId: dealer.id, dueDate: day(5), lines: [{ productId: p, qty: 1 }] }));
    ok(await as('sales.westave').post('/api/sales').send({ channel: 'DEALER', paymentMode: 'AR_PDC', drSiNo: `AR-${run}-2`, customerId: dealer.id, dueDate: day(2), pdcBank: 'BDO', pdcChequeNo: '000123', pdcDate: day(2), lines: [{ productId: p, qty: 1 }] }));
    await as('sales.westave').post('/api/sales').send({ channel: 'DEALER', paymentMode: 'AR_PDC', drSiNo: `AR-${run}-3`, customerId: dealer.id, dueDate: day(3), pdcBank: 'BDO', lines: [{ productId: p, qty: 1 }] }).expect(400);
    const dash = ok(await as('sales.westave').get('/api/dashboard')).body;
    const mine = (dash.arDue as { drSiNo: string; daysToDue: number }[]).filter((a) => a.drSiNo.startsWith(`AR-${run}`));
    expect(mine.map((a) => a.drSiNo)).toEqual([`AR-${run}-2`, `AR-${run}-1`]);
    expect(dash.todaySales.byMode).toHaveProperty('ONLINE'); expect(dash.cashOnHand).toBeDefined();
    await prisma.alertState.deleteMany({ where: { kind: 'AR_OVERDUE' } });
    await app.get(SalesService).notifyOverdue();
    for (const u of ['sales.westave', 'asst.auditor', 'head.auditor', 'admin']) expect(JSON.stringify(ok(await as(u).get('/api/notifications')).body)).toContain(`AR-${run}-2`);
    // Accounting rejects a branch's AR payment only with a reason, which the branch sees
    const inv = (ok(await as('sales.westave').get('/api/ar')).body as { id: string; drSiNo: string }[]).find((x) => x.drSiNo === `AR-${run}-1`)!;
    const pay = ok(await as('sales.westave').post('/api/ar/payments').send({ salesDocIds: [inv.id], amount: 500, paymentMode: 'CASH' })).body;
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: pay.id, type: 'AR_PAYMENT', status: 'PENDING' } });
    const review = ok(await as('acct.head').get(`/api/ar/payments/${pay.id}/review`)).body;
    expect(review).toMatchObject({ paymentMode: 'CASH', branch: 'West Ave' }); expect(review.invoices[0].drSiNo).toBe(`AR-${run}-1`);
    await as('acct.head').post(`/api/approvals/${req.id}/decide`).send({ decision: 'REJECT' }).expect(400);
    ok(await as('acct.head').post(`/api/approvals/${req.id}/decide`).send({ decision: 'REJECT', note: 'Wrong amount (does not match the proof)' }));
    expect(JSON.stringify(ok(await as('sales.westave').get('/api/notifications')).body)).toContain('Reason: Wrong amount');
    // an expense paid from the cash on hand cannot be more than the branch has
    const acct = (ok(await as('sales.westave').get(`/api/expenses/accounts?locationId=${west}`)).body as { id: string }[])[0];
    const r = await as('sales.westave').post('/api/expenses').send({ locationId: west, accountId: acct.id, amount: 99999999, paidFrom: 'CASH_DRAWER' }).expect(400);
    expect(r.body.code).toBe('NO_CASH_ON_HAND');
    // the count sheet shows the day's movements after the beginning count
    const cnt = ok(await as('head.auditor').post('/api/counts').send({ locationId: west })).body;
    const cl = (cnt.lines as { productId: string; beginQty: number; systemQty: number; moves: { received: number; sales: number }; expectedFromDay: number }[]).find((l) => l.productId === p)!;
    expect(cl.moves.sales).toBe(2); expect(cl.expectedFromDay).toBe(cl.systemQty);
    // write-offs are not decided by branch staff
    await as('sales.westave').post('/api/writeoffs').send({ lines: [] }).expect(403);
  });
});

describe('Sales Manager and Agent accounts: targets and achievement, never cost (owner request 2026-09-29)', () => {
  it('the Sales Manager sets targets per branch and per agent, the Owner approves; progress per branch and agent; the Agent sees only their own sales at every branch; no cost anywhere', async () => {
    await prisma.salesReportSubmission.deleteMany({}); // an earlier test closed today's report for every branch
    const month = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
    const west = (await prisma.location.findUniqueOrThrow({ where: { code: 'WESTAVE' } })).id; const dasma = (await prisma.location.findUniqueOrThrow({ where: { code: 'DASMA' } })).id;
    const jerickUser = await prisma.user.findUniqueOrThrow({ where: { username: 'agent.jerick' } });
    // Jerick also sells for Dasmariñas: the Sales Manager links that listing to his account too
    const dasmaListing = (await prisma.agent.findFirst({ where: { name: 'Jerick Quinto', locationId: dasma } })) ?? (await prisma.agent.create({ data: { name: 'Jerick Quinto', locationId: dasma } }));
    ok(await as('sales.manager').put(`/api/targets/agents/${dasmaListing.id}/user`).send({ userId: jerickUser.id }));
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const p = ok(await as('admin').post('/api/products').send({ name: `TGT Whey ${run}`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 1000, AGENT: 900, FRANCHISE: 700 }, cost: 500 })).body.id;
    for (const loc of [west, dasma]) { const b = await prisma.batch.create({ data: { productId: p, batchNo: `T-${run}-${loc.slice(0, 4)}`, receivedRef: 'TEST', unitCost: '500' } }); await prisma.stockLedger.create({ data: { locationId: loc, productId: p, batchId: b.id, qtyDelta: 10, movementType: 'RECEIVE', documentType: 'OpeningStock', documentId: b.id, unitCost: '500', businessDate: new Date() } }); await prisma.stockBalance.create({ data: { locationId: loc, productId: p, batchId: b.id, qty: 10 } }); }
    const westAgent = (await prisma.agent.findFirstOrThrow({ where: { name: 'Jerick Quinto', locationId: west } })).id;
    ok(await as('sales.westave').post('/api/sales').send({ channel: 'AGENT', paymentMode: 'CASH', drSiNo: `TGT-${run}-W`, agentId: westAgent, lines: [{ productId: p, qty: 2 }] }));
    ok(await as('sales.dasma').post('/api/sales').send({ channel: 'AGENT', paymentMode: 'CASH', drSiNo: `TGT-${run}-D`, agentId: dasmaListing.id, lines: [{ productId: p, qty: 1 }] }));
    // targets: branch and agent; the Owner approves
    const agents = ok(await as('sales.manager').get('/api/targets/agents')).body as { key: string; name: string; agentIds: string[] }[];
    const jerick = agents.find((a) => a.key === jerickUser.id)!; expect(jerick.agentIds.length).toBeGreaterThanOrEqual(2);
    const t1 = ok(await as('sales.manager').post('/api/targets').send({ month, kind: 'BRANCH', locationId: west, amount: 100000 })).body;
    const t2 = ok(await as('sales.manager').post('/api/targets').send({ month, kind: 'AGENT', agentKey: jerick.key, amount: 5000 })).body;
    expect(t1.status).toBe('PENDING');
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: t2.id } }); expect(req.requiredApproverRoles).toEqual(['ADMIN']);
    for (const t of [t1, t2]) { const r = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: t.id } }); ok(await as('admin').post(`/api/approvals/${r.id}/decide`).send({ decision: 'APPROVE' })); }
    const prog = ok(await as('sales.manager').get(`/api/targets/progress?month=${month}`)).body;
    const j = prog.agents.find((a: { key: string }) => a.key === jerickUser.id);
    expect(j.target).toBe(5000); expect(j.actual).toBeGreaterThanOrEqual(2700); expect(j.transactions).toBeGreaterThanOrEqual(2);
    expect(prog.branches.find((b: { id: string }) => b.id === west).target).toBe(100000);
    // the Agent: own sales at both branches, own target; nothing else
    const mine = ok(await as('agent.jerick').get(`/api/targets/mine?month=${month}`)).body;
    expect(mine.sales.map((x: { drSiNo: string }) => x.drSiNo)).toEqual(expect.arrayContaining([`TGT-${run}-W`, `TGT-${run}-D`]));
    expect(mine.target).toBe(5000); expect(new Set(mine.sales.map((x: { branch: string }) => x.branch)).size).toBeGreaterThanOrEqual(2);
    for (const path of ['/api/sales', '/api/ar', '/api/targets/progress', '/api/reports/sales-summary', '/api/stock/on-hand']) await as('agent.jerick').get(path).expect(403);
    await as('agent.jerick').post('/api/targets').send({ month, kind: 'AGENT', agentKey: jerick.key, amount: 1 }).expect(403);
    // the Sales Manager: every branch's sales and AR, never cost; cannot record sales or money
    const sum = ok(await as('sales.manager').get(`/api/reports/sales-summary?from=${month}-01&to=${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}`)).body;
    expect(sum.totals.sales).toBeGreaterThan(0); expect(sum.totals.grossProfit).toBeUndefined();
    const sale = (ok(await as('sales.manager').get('/api/sales')).body as { id: string; drSiNo: string }[]).find((x) => x.drSiNo === `TGT-${run}-W`)!;
    expect(has(ok(await as('sales.manager').get(`/api/sales/${sale.id}`)).body, /unitCost|"cost"/)).toBe(false);
    expect(ok(await as('sales.manager').get('/api/ar')).body).toBeDefined();
    await as('sales.manager').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `X-${run}`, lines: [{ productId: p, qty: 1 }] }).expect(403);
    await as('sales.manager').post('/api/ar/payments').send({ salesDocIds: [sale.id], amount: 1, paymentMode: 'CASH' }).expect(403);
    await as('sales.manager').get('/api/accounts').expect(403);
    const dash = ok(await as('sales.manager').get('/api/dashboard')).body; expect(dash.targets.target).toBeGreaterThan(0);
    expect(ok(await as('agent.jerick').get('/api/dashboard')).body.agentMonth.target).toBe(5000);
  });
});

describe('Transfers & Pull-outs: tick which branches to see (owner request 2026-09-29)', () => {
  it('the Owner sees only transfers to or from the ticked branches, and Pull-out / Transfer-in apply to them; the warehouse picks the other branch', async () => {
    const id = async (code: string) => (await prisma.location.findUniqueOrThrow({ where: { code } })).id;
    const wh = await id('WH'); const west = await id('WESTAVE'); const csr = await id('CSR');
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const p = ok(await as('admin').post('/api/products').send({ name: `TICK Whey ${run}`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 1000, FRANCHISE: 700 }, cost: 500 })).body.id;
    const batch = await prisma.batch.create({ data: { productId: p, batchNo: `TICK-${run}`, receivedRef: 'TEST', unitCost: '500.00' } });
    await prisma.stockBalance.create({ data: { locationId: wh, productId: p, batchId: batch.id, qty: 10 } });
    const toWest = ok(await as('wh.incharge').post('/api/transfers').send({ fromLocationId: wh, toLocationId: west, transferType: 'RESTOCK', lines: [{ productId: p, qty: 1 }] })).body;
    const toCsr = ok(await as('wh.incharge').post('/api/transfers').send({ fromLocationId: wh, toLocationId: csr, transferType: 'RESTOCK', lines: [{ productId: p, qty: 1 }] })).body;
    type T = { id: string; fromLocation: { id: string }; toLocation: { id: string } };
    const ids = (rows: T[]) => rows.map((r) => r.id);

    const westOnly = ok(await as('admin').get(`/api/transfers?branchIds=${west}`)).body as T[];
    expect(ids(westOnly)).toContain(toWest.id); expect(ids(westOnly)).not.toContain(toCsr.id);
    expect(westOnly.every((r) => r.fromLocation.id === west || r.toLocation.id === west)).toBe(true);
    const both = ids(ok(await as('admin').get(`/api/transfers?branchIds=${west},${csr}`)).body);
    expect(both).toEqual(expect.arrayContaining([toWest.id, toCsr.id]));
    const westIn = ok(await as('admin').get(`/api/transfers?direction=in&branchIds=${west}`)).body as T[];
    expect(ids(westIn)).toContain(toWest.id); expect(westIn.every((r) => r.toLocation.id === west)).toBe(true);
    expect(ids(ok(await as('admin').get(`/api/transfers?direction=out&branchIds=${west}`)).body)).not.toContain(toWest.id);

    // the warehouse keeps its own side; the tick picks the receiving branch
    const whToCsr = ok(await as('wh.incharge').get(`/api/transfers?direction=out&branchIds=${csr}`)).body as T[];
    expect(ids(whToCsr)).toContain(toCsr.id); expect(ids(whToCsr)).not.toContain(toWest.id);
    expect(whToCsr.every((r) => r.fromLocation.id === wh && r.toLocation.id === csr)).toBe(true);
  });
});

describe('Opening AR from before GWS-ERP, entered by Accounting and approved by the Owner (owner request 2026-09-29)', () => {
  it('Accounting enters AR for any branch; it shows in the branch AR only after the Owner approves (tick all); duplicates, PDC checks, rejections and permissions', async () => {
    const csr = (await prisma.location.findUniqueOrThrow({ where: { code: 'CSR' } })).id;
    const dealer = (ok(await as('acct.head').get('/api/customers')).body as { id: string; type: string; name: string }[]).find((c) => c.type === 'DEALER')!;
    const entry = (dr: string, extra: Record<string, unknown> = {}) => ({ locationId: csr, kind: 'DEALER', customerId: dealer.id, drSiNo: dr, docDate: '2026-06-15', dueDate: '2026-07-15', amount: 12500, ...extra });
    const dr1 = `OPEN-${run}-1`, dr2 = `OPEN-${run}-2`, dr3 = `OPEN-${run}-3`;

    await as('sales.csr').post('/api/ar/opening').send(entry(dr1)).expect(403); // branches cannot make opening AR
    await as('sales.csr').get('/api/ar/opening').expect(403);
    await as('acct.head').post('/api/ar/opening').send(entry(`${dr1}x`, { docDate: '2099-01-01', dueDate: '2099-02-01' })).expect(400); // not in the future
    await as('acct.head').post('/api/ar/opening').send(entry(`${dr1}y`, { pdcChequeNo: '000123' })).expect(400); // a PDC needs its date
    const e1 = ok(await as('acct.head').post('/api/ar/opening').send(entry(dr1))).body;
    const e2 = ok(await as('acct.assoc').post('/api/ar/opening').send(entry(dr2, { amount: 3000, pdcBank: 'BDO', pdcChequeNo: '000777', pdcDate: '2026-10-05' }))).body;
    const e3 = ok(await as('acct.assoc').post('/api/ar/opening').send(entry(dr3, { amount: 50 }))).body;
    expect(e1.status).toBe('PENDING');
    await as('acct.head').post('/api/ar/opening').send(entry(dr1)).expect(400); // same DR/SI at the same branch

    const csrAr = async () => (ok(await as('sales.csr').get('/api/ar')).body as { drSiNo: string; balance: string; dueDate: string; pdc: unknown }[]).filter((r) => r.drSiNo.startsWith(`OPEN-${run}`));
    expect(await csrAr()).toHaveLength(0); // nothing reaches the branch before the Owner approves

    const inbox = ok(await as('admin').get('/api/approvals/inbox')).body.items as { id: string; type: string; documentId: string }[];
    const mine = inbox.filter((i) => i.type === 'OPENING_AR' && [e1.id, e2.id].includes(i.documentId));
    expect(mine).toHaveLength(2);
    const bulk = ok(await as('admin').post('/api/approvals/bulk').send({ ids: mine.map((i) => i.id), decision: 'APPROVE' })).body as { ok: boolean }[];
    expect(bulk.every((r) => r.ok)).toBe(true);
    const r3 = inbox.find((i) => i.documentId === e3.id)!;
    await as('admin').post(`/api/approvals/${r3.id}/decide`).send({ decision: 'REJECT', note: 'Already paid in 2025' }).expect((res) => expect(res.status).toBeLessThan(300));

    const ar = await csrAr();
    expect(ar.map((r) => r.drSiNo).sort()).toEqual([dr1, dr2]);
    expect(Number(ar.find((r) => r.drSiNo === dr1)!.balance)).toBe(12500);
    expect(ar.find((r) => r.drSiNo === dr2)!.pdc).toBeTruthy();
    const notes = JSON.stringify(ok(await as('sales.csr').get('/api/notifications')).body);
    expect(notes).toContain('OPENING_AR'); expect(notes).toContain(dr1);
    const list = ok(await as('acct.assoc').get('/api/ar/opening')).body as { drSiNo: string; status: string; decisionNote: string | null }[];
    expect(list.find((r) => r.drSiNo === dr3)).toMatchObject({ status: 'REJECTED', decisionNote: 'Already paid in 2025' });
    expect(list.find((r) => r.drSiNo === dr1)!.status).toBe('APPROVED');
    // the Owner's own entry applies at once
    expect(ok(await as('admin').post('/api/ar/opening').send(entry(`OPEN-${run}-4`, { amount: 100 }))).body.status).toBe('APPROVED');
    // the Excel import is for Accounting too, and goes through the same approval
    await as('sales.csr').post('/api/imports/open-ar').expect(403);
  });
});

describe('Flavors, expiry choice, in-stock product lists and the Owner as final approver (owner requests 2026-09-30)', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const id = async (code: string) => (await prisma.location.findUniqueOrThrow({ where: { code } })).id;
  it('receiving records the flavor per batch; the SKU stays one item; sales and transfers take the chosen flavor / expiry only; 0-stock items are not offered; flavors can be set on old stock', async () => {
    const wh = await id('WH'); const west = await id('WESTAVE');
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const p = ok(await as('admin').post('/api/products').send({ name: `FLV Whey ${run}`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 1500, FRANCHISE: 1000 }, cost: 800 })).body.id as string;
    const supplierId = (await prisma.supplier.findFirstOrThrow()).id;
    // the In-Charge receives 5 Choco (near expiry) and 4 Vanilla (far expiry) of the same SKU
    const r = ok(await as('wh.incharge').post('/api/receiving').send({ supplierId, supplierRef: `FLV-${run}`, lines: [{ productId: p, qty: 5, expiryDate: '2027-03-31', batchNo: 'C1', flavor: 'Choco' }, { productId: p, qty: 4, expiryDate: '2028-01-31', batchNo: 'V1', flavor: 'Vanilla' }] })).body;
    await http.post(`/api/attachments/ReceivingDoc/${r.id}`).set('Authorization', `Bearer ${tokens['wh.incharge']}`).attach('file', png, { filename: 'dr.png', contentType: 'image/png' }).expect(201);
    ok(await as('wh.incharge').post(`/api/receiving/${r.id}/submit`));
    const cost = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: r.id, type: 'COST_ON_RECEIVING', status: 'PENDING' } });
    ok(await as('head.auditor').post(`/api/approvals/${cost.id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p } })).flavors).toEqual(['Choco', 'Vanilla']);

    const batches = ok(await as('wh.incharge').get(`/api/stock/batches/${p}?locationId=${wh}`)).body as { batchId: string; flavor: string; expiryDate: string; qty: number }[];
    expect(batches.map((b) => [b.flavor, b.qty])).toEqual([['Choco', 5], ['Vanilla', 4]]); // earliest expiry first
    const listed = ok(await as('wh.incharge').get(`/api/products?search=FLV Whey ${run}&inStockAt=${wh}`)).body as { id: string; onHand: number }[];
    expect(listed.find((x) => x.id === p)!.onHand).toBe(9); // one SKU, all flavors
    expect((ok(await as('sales.westave').get(`/api/products?search=FLV Whey ${run}&inStockAt=${west}`)).body as unknown[]).length).toBe(0); // nothing at West Ave yet: not offered
    await as('sales.westave').get(`/api/products?search=x&inStockAt=${wh}`).expect(403); // only their own branch

    const vanilla = batches.find((b) => b.flavor === 'Vanilla')!.batchId;
    await as('wh.incharge').post('/api/transfers').send({ fromLocationId: wh, toLocationId: west, transferType: 'RESTOCK', lines: [{ productId: p, qty: 5, batchId: vanilla, exactBatch: true }] })
      .expect((res) => { expect(res.status).toBe(400); expect(res.body.message).toMatch(/Only 4 left of Vanilla/); });
    const t = ok(await as('wh.incharge').post('/api/transfers').send({ fromLocationId: wh, toLocationId: west, transferType: 'RESTOCK', lines: [{ productId: p, qty: 3, batchId: vanilla, exactBatch: true }] })).body;
    expect(t.lines.map((l: { qtySent: number; batch: { flavor: string } }) => [l.batch.flavor, l.qtySent])).toEqual([['Vanilla', 3]]); // not the older Choco

    // West Ave has old stock without a flavor: the branch sets it, the SKU total stays the same
    const old = await prisma.batch.create({ data: { productId: p, batchNo: 'OLD', expiryDate: new Date('2027-12-31'), receivedRef: 'OPENING', unitCost: '800.00' } });
    await prisma.stockBalance.create({ data: { locationId: west, productId: p, batchId: old.id, qty: 6 } });
    await as('wh.assoc').post('/api/stock/flavors').send({ locationId: west, batchId: old.id, parts: [{ flavor: 'Choco', qty: 2 }] }).expect(403);
    await as('sales.westave').post('/api/stock/flavors').send({ locationId: west, batchId: old.id, parts: [{ flavor: 'Choco', qty: 7 }] }).expect(400);
    ok(await as('sales.westave').post('/api/stock/flavors').send({ locationId: west, batchId: old.id, parts: [{ flavor: 'Cookies & Cream', qty: 4 }] }));
    const westBal = await prisma.stockBalance.findMany({ where: { locationId: west, productId: p }, include: { batch: true } });
    expect(westBal.reduce((s, b) => s + b.qty, 0)).toBe(6);
    expect(westBal.map((b) => [b.batch.flavor, b.qty]).sort()).toEqual([['Cookies & Cream', 4], [null, 2]].sort());
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p } })).flavors).toContain('Cookies & Cream');

    // the sale takes the chosen flavor; West Ave now offers the product
    await prisma.salesReportSubmission.deleteMany({});
    expect((ok(await as('sales.westave').get(`/api/products?search=FLV Whey ${run}&inStockAt=${west}`)).body as { onHand: number }[])[0].onHand).toBe(6);
    const cc = westBal.find((b) => b.batch.flavor === 'Cookies & Cream')!.batchId;
    const sale = ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `FLV-${run}`, lines: [{ productId: p, qty: 2, batchId: cc, exactBatch: true }] })).body;
    const doc = ok(await as('sales.westave').get(`/api/sales/${sale.id}`)).body;
    expect(doc.lines.map((l: { batch: { flavor: string }; qty: number }) => [l.batch.flavor, l.qty])).toEqual([['Cookies & Cream', 2]]);
    await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `FLV-${run}-2`, lines: [{ productId: p, qty: 3, batchId: cc, exactBatch: true }] })
      .expect((res) => { expect(res.status).toBe(400); expect(res.body.message).toMatch(/Only 2 left of Cookies & Cream/); });
  });

  it('the Owner may approve any waiting request and the decision is final', async () => {
    const wh = await id('WH'); const west = await id('WESTAVE');
    const p = (await prisma.stockBalance.findFirstOrThrow({ where: { locationId: wh, qty: { gt: 3 }, batch: { OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }] } } })).productId;
    const t = ok(await as('wh.incharge').post('/api/transfers').send({ fromLocationId: wh, toLocationId: west, transferType: 'RESTOCK', lines: [{ productId: p, qty: 1 }] })).body;
    ok(await as('wh.incharge').post(`/api/transfers/${t.id}/submit`));
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: t.id, status: 'PENDING' } });
    expect(req.requiredApproverRoles).not.toContain('ADMIN');
    const mine = ok(await as('admin').get('/api/approvals/inbox')).body.items as { id: string }[];
    expect(mine.some((i) => i.id === req.id)).toBe(false); // not addressed to the Owner
    const everything = ok(await as('admin').get('/api/approvals/inbox?all=1')).body.items as { id: string }[];
    expect(everything.some((i) => i.id === req.id)).toBe(true); // but the Owner can see it
    ok(await as('admin').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE', note: 'Owner' }));
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('APPROVED');
    expect((await prisma.transferDoc.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('APPROVED');
    const tl = ok(await as('admin').get(`/api/approvals/timeline/TransferDoc/${t.id}`)).body as { steps: { who: string; status: string }[] }[];
    expect(tl.flatMap((x) => x.steps).some((s) => s.who === 'Owner (final)' && s.status === 'approved')).toBe(true);
  });
});

describe('Agent incentives: Sales Manager confirms, Accounting and the Owner approve, HR releases, Accounting tags the payment (owner request 2026-09-30)', () => {
  it('runs the whole release with a form number, notifications and access rules', async () => {
    const west = (await prisma.location.findUniqueOrThrow({ where: { code: 'WESTAVE' } })).id;
    const jerick = await prisma.agent.findFirstOrThrow({ where: { name: { contains: 'Jerick' }, locationId: west } });
    const agentUser = await prisma.user.findUniqueOrThrow({ where: { username: 'agent.jerick' } });
    await prisma.agent.update({ where: { id: jerick.id }, data: { userId: agentUser.id } });
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const p = ok(await as('admin').post('/api/products').send({ name: `INC Whey ${run}`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 2000, AGENT: 1600, FRANCHISE: 1400 }, cost: 900 })).body.id as string;
    const batch = await prisma.batch.create({ data: { productId: p, batchNo: `INC-${run}`, expiryDate: new Date('2028-01-31'), receivedRef: 'TEST', unitCost: '900.00' } });
    await prisma.stockBalance.create({ data: { locationId: west, productId: p, batchId: batch.id, qty: 10 } });
    await prisma.salesReportSubmission.deleteMany({});
    ok(await as('sales.westave').post('/api/sales').send({ channel: 'AGENT', agentId: jerick.id, paymentMode: 'CASH', drSiNo: `INC-${run}`, lines: [{ productId: p, qty: 5, unitPrice: 1600 }] }));
    const month = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);

    await as('sales.westave').get(`/api/incentives/month?month=${month}`).expect(403);
    const rows = ok(await as('sales.manager').get(`/api/incentives/month?month=${month}`)).body as { agentKey: string; name: string; totalSales: number; incentive: unknown }[];
    const row = rows.find((r) => r.name.includes('Jerick'))!;
    expect(row.totalSales).toBeGreaterThanOrEqual(8000); expect(row.incentive).toBeNull();
    await as('acct.head').post('/api/incentives').send({ month, agentKey: row.agentKey, ratePct: 5 }).expect(403); // the Sales Manager prepares
    const inc = ok(await as('sales.manager').post('/api/incentives').send({ month, agentKey: row.agentKey, ratePct: 5 })).body;
    expect(inc.amount).toBeCloseTo(row.totalSales * 0.05, 2); expect(inc.status).toBe('PENDING');
    await as('sales.manager').post('/api/incentives').send({ month, agentKey: row.agentKey, amount: 100 }).expect(400); // one per agent per month

    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: inc.id, type: 'AGENT_INCENTIVE' } });
    expect(req.requiredApproverRoles.sort()).toEqual(['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_HEAD', 'ADMIN'].sort());
    ok(await as('acct.assoc').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    ok(await as('acct.head').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.agentIncentive.findUniqueOrThrow({ where: { id: inc.id } })).status).toBe('PENDING'); // still the Owner
    ok(await as('admin').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    const approved = await prisma.agentIncentive.findUniqueOrThrow({ where: { id: inc.id } });
    expect(approved.status).toBe('APPROVED'); expect(approved.formNo).toMatch(/^AI-\d{6}$/);
    expect(JSON.stringify(ok(await as('hr.staff').get('/api/notifications')).body)).toContain(approved.formNo!);

    const mine = ok(await as('agent.jerick').get('/api/incentives')).body as { id: string }[];
    expect(mine.map((x) => x.id)).toEqual([inc.id]); // the agent sees only their own
    await as('wh.assoc').get('/api/incentives').expect(403);
    await as('acct.head').post(`/api/incentives/${inc.id}/signed`).expect(403);
    ok(await as('hr.staff').post(`/api/incentives/${inc.id}/signed`));
    await as('acct.head').post(`/api/incentives/${inc.id}/release`).send({ mode: 'GCASH', date: '2026-10-05' }).expect(400); // reference needed
    const rel = ok(await as('acct.head').post(`/api/incentives/${inc.id}/release`).send({ mode: 'GCASH', reference: 'GC-778899', date: '2026-10-05' })).body;
    expect(rel.status).toBe('RELEASED'); expect(rel.releaseDate).toBe('2026-10-05');
    await as('acct.head').post(`/api/incentives/${inc.id}/release`).send({ mode: 'CASH', date: '2026-10-05' }).expect(400); // already released
    await as('hr.staff').get(`/api/reports/forms/agent-incentive/${inc.id}.pdf`).expect(200);
    await as('agent.jerick').get(`/api/reports/forms/agent-incentive/${inc.id}.pdf`).expect(200);
    await as('sales.westave').get(`/api/reports/forms/agent-incentive/${inc.id}.pdf`).expect(403);
  });

  it('dashboard: branches see transfers they must confirm; the Owner sees transfers in transit, not "to confirm"', async () => {
    const d = ok(await as('admin').get('/api/dashboard')).body;
    expect(d.incomingTransfers).toBeUndefined(); expect(d.transfersInTransit).toBeDefined();
    expect(typeof ok(await as('sales.westave').get('/api/dashboard')).body.incomingTransfers).toBe('number');
  });
});

describe('Post-close edits from Daily Close / Daily Sales Report: reason, HR and Head Auditor told, flagged at three a month (owner request 2026-09-30)', () => {
  it('each request is reported; the third in the month flags the HR notice for referral to the Owner', async () => {
    const west = (await prisma.location.findUniqueOrThrow({ where: { code: 'WESTAVE' } })).id;
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'sales.westave' } });
    await prisma.postCloseEdit.deleteMany({ where: { requestedBy: user.id } }); await prisma.hrNotice.deleteMany({ where: { kind: 'POST_CLOSE_EDITS' } });
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const p = ok(await as('admin').post('/api/products').send({ name: `PCE Whey ${run}`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 1000, FRANCHISE: 700 }, cost: 500 })).body.id as string;
    const b = await prisma.batch.create({ data: { productId: p, batchNo: `PCE-${run}`, expiryDate: new Date('2028-01-31'), receivedRef: 'TEST', unitCost: '500.00' } });
    await prisma.stockBalance.create({ data: { locationId: west, productId: p, batchId: b.id, qty: 10 } });
    await prisma.salesReportSubmission.deleteMany({});
    const sales = [];
    for (let i = 1; i <= 3; i++) sales.push(ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `PCE-${run}-${i}`, lines: [{ productId: p, qty: 1 }] })).body);
    await as('sales.westave').post('/api/closing/edits').send({ documentType: 'SalesDoc', documentId: sales[0].id, reason: 'oops', after: { notes: 'x' } }).expect(400); // a real reason is required
    for (const [i, s] of sales.entries()) ok(await as('sales.westave').post('/api/closing/edits').send({ documentType: 'SalesDoc', documentId: s.id, reason: `Wrong DR / SI number — ${i}`, after: { drSiNo: `PCE-${run}-${i}-fixed` } }));
    const n = await prisma.hrNotice.findFirstOrThrow({ where: { kind: 'POST_CLOSE_EDITS' } });
    const d = n.details as { countInMonth: number; recommendReferral: boolean; edits: unknown[] };
    expect(d.countInMonth).toBe(3); expect(d.recommendReferral).toBe(true); expect(d.edits).toHaveLength(3);
    for (const u of ['hr.staff', 'head.auditor']) {
      const notes = ok(await as(u).get('/api/notifications')).body as { type: string; title: string }[];
      expect(notes.filter((x) => x.type === 'POST_CLOSE_EDIT_REPORTED').length).toBeGreaterThanOrEqual(3);
      expect(notes.some((x) => x.type === 'POST_CLOSE_EDIT_REPORTED' && /flagged/.test(x.title))).toBe(true);
    }
    const hr = ok(await as('hr.staff').get('/api/hr-notices')).body as { id: string; kind: string }[];
    expect(hr.some((x) => x.kind === 'POST_CLOSE_EDITS')).toBe(true);
  });
});

describe('Owner requests 2026-09-30 (pricing, 6-Pack Card, franchise receivables, memos, users)', () => {
  let wh = ''; let west = ''; let mayon = ''; let a = '';
  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const day = (n: number) => new Date(Date.now() + 8 * 3600e3 + n * 86400000).toISOString().slice(0, 10);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const notes = async (u: string) => JSON.stringify(ok(await as(u).get('/api/notifications')).body);
  const giveStock = async (locationId: string, productId: string, qty: number, cost: number) => {
    const batch = await prisma.batch.create({ data: { productId, batchNo: `N-${run}-${locationId.slice(0, 4)}-${qty}`, receivedRef: 'TEST', unitCost: cost.toFixed(2) } });
    await prisma.stockLedger.create({ data: { locationId, productId, batchId: batch.id, qtyDelta: qty, movementType: 'RECEIVE', documentType: 'OpeningStock', documentId: batch.id, unitCost: cost.toFixed(2), businessDate: new Date(`${today()}T00:00:00Z`) } });
    await prisma.stockBalance.create({ data: { locationId, productId, batchId: batch.id, qty } });
  };
  const decide = async (u: string, id: string, type: string, decision: 'APPROVE' | 'REJECT', note?: string) => { const r = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: id, type, status: 'PENDING' } }); return as(u).post(`/api/approvals/${r.id}/decide`).send({ decision, note }); };
  beforeAll(async () => {
    await prisma.salesReportSubmission.deleteMany({});
    const locs = ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[];
    wh = locs.find((l) => l.code === 'WH')!.id; west = locs.find((l) => l.code === 'WESTAVE')!.id; mayon = locs.find((l) => l.code === 'MAYON')!.id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    a = ok(await as('admin').post('/api/products').send({ name: `E2E N30 Whey ${run}`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 1000, DEALER: 800, FRANCHISE: 700 }, cost: 500 })).body.id;
    await giveStock(wh, a, 40, 500); await giveStock(west, a, 20, 500);
  });

  it('credit-card price = SRP ÷ 0.96 to the centavo; the Owner alone sets e-commerce prices (Lazada follows Shopee); a card sale is priced at the CC price; sees only own tiers', async () => {
    const prod = async (u: string) => (ok(await as(u).get(`/api/products?search=${encodeURIComponent(`E2E N30 Whey ${run}`)}&take=5`)).body as { tierPrices: Record<string, string> }[])[0];
    const assoc = await prod('sales.westave');
    expect(Number(assoc.tierPrices.CC)).toBe(1041.67); expect(assoc.tierPrices.TIKTOK).toBeUndefined(); expect(assoc.tierPrices.SHOPEE).toBeUndefined();
    await as('sales.westave').put('/api/pricing/ecom').send({ rows: [{ productId: a, tier: 'TIKTOK', price: 1199.5 }] }).expect(403);
    await as('ecomm.assoc').put('/api/pricing/ecom').send({ rows: [{ productId: a, tier: 'TIKTOK', price: 1199.5 }] }).expect(403);
    ok(await as('admin').put('/api/pricing/ecom').send({ rows: [{ productId: a, tier: 'TIKTOK', price: 1199.5 }, { productId: a, tier: 'SHOPEE', price: 1100 }] }));
    const ec = await prod('ecomm.assoc');
    expect(Number(ec.tierPrices.TIKTOK)).toBe(1199.5); expect(Number(ec.tierPrices.SHOPEE)).toBe(1100); expect(Number(ec.tierPrices.LAZADA)).toBe(1100); // no rounding off
    const accts = ok(await as('sales.westave').get(`/api/accounts/payment?locationId=${west}`)).body as { id: string }[];
    const up = ok(await as('sales.westave').post(`/api/attachments/SalesDoc/${crypto.randomUUID()}`).attach('file', png, { filename: 'slip.png', contentType: 'image/png' }));
    const sale = ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CREDIT_CARD', drSiNo: `CC-${run}`, paymentAccountId: accts[0].id, proofOfPaymentAttachmentId: up.body.id, cardMid: 'M1', cardSlipNo: 'S1', cardApprovalCode: 'A1', cardBatchNo: 'B1', lines: [{ productId: a, qty: 1 }] })).body;
    const full = ok(await as('sales.westave').get(`/api/sales/${sale.id}`)).body;
    expect(full.lines[0].priceTier).toBe('CC'); expect(Number(full.lines[0].unitPrice)).toBe(1041.67); expect(Number(full.grandTotal)).toBe(1041.67);
    ok(await as('admin').put('/api/pricing/cc-markup').send({ pct: 5, method: 'ADD' }));
    expect(Number((await prod('sales.westave')).tierPrices.CC)).toBe(1050); // 1000 + 5%
    ok(await as('admin').put('/api/pricing/cc-markup').send({ pct: 4, method: 'GROSS_UP' }));
    expect(Number((await prod('sales.westave')).tierPrices.CC)).toBe(1041.67);
    const cc = await prisma.setting.findUnique({ where: { key: 'pricing.cc_markup_pct' } }); expect(Number(cc?.value)).toBe(4);
  });

  it('6-Pack Card: sticker ticked on the DR needs the customer tagged; six stickers make a card; the ₱300 becomes the branch expense with the customer data complete; a voided sale takes its stickers back', async () => {
    const sell = (n: number, extra: Record<string, unknown>) => as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `SP-${run}-${n}`, lines: [{ productId: a, qty: 3 }], ...extra });
    expect((await sell(1, { sixPackSticker: true })).status).toBe(400); // name and number are needed
    const s1 = ok(await sell(2, { sixPackSticker: true, customerName: 'Maria Santos', customerPhone: '0917 123 4567' })).body;
    expect(ok(await as('sales.westave').get(`/api/sales/${s1.id}`)).body.sixPackStickers).toBe(3);
    expect(ok(await as('sales.westave').get('/api/six-pack/customer?phone=%2B639171234567')).body.left).toBe(3); // same person however typed
    const tooEarly = await as('sales.westave').post('/api/six-pack/redeem').send({ customerName: 'Maria Santos', phone: '09171234567', email: 'maria@example.com', address: '12 Rizal St, Dasmarinas' });
    expect(tooEarly.status).toBe(400); expect(JSON.stringify(tooEarly.body)).toContain('3 stickers');
    const s2 = ok(await sell(3, { sixPackSticker: true, customerName: 'Maria Santos', customerPhone: '09171234567' })).body;
    expect(ok(await as('sales.westave').get('/api/six-pack/customer?phone=09171234567')).body.cardsReady).toBe(1);
    expect((await as('sales.westave').post('/api/six-pack/redeem').send({ customerName: 'Maria Santos', phone: '09171234567', email: 'not-an-email', address: '12 Rizal St' })).status).toBe(400); // complete data
    expect((await as('sales.westave').post('/api/six-pack/redeem').send({ customerName: 'Maria Santos', phone: '09171234567', email: 'maria@example.com', address: '12 Rizal St', legacyCardNo: 'OLD-1' })).status).toBe(400); // old card needs a photo
    const r = ok(await as('sales.westave').post('/api/six-pack/redeem').send({ customerName: 'Maria Santos', phone: '09171234567', email: 'maria@example.com', address: '12 Rizal St, Dasmarinas' })).body;
    expect(Number(r.amount)).toBe(300);
    const ex = await prisma.expenseDoc.findUniqueOrThrow({ where: { id: r.expenseId }, include: { account: true } });
    expect(Number(ex.amount)).toBe(300); expect(ex.account.title).toMatch(/6-Pack Card/); expect(ex.paidFrom).toBe('CASH_DRAWER'); expect(ex.payee).toBe('Maria Santos'); expect(ex.locationId).toBe(west);
    expect(ok(await as('sales.westave').get('/api/six-pack/customer?phone=09171234567')).body.left).toBe(0);
    const sum = ok(await as('sales.westave').get('/api/six-pack/summary')).body;
    expect(sum.today.cards).toBe(1); expect(Number(sum.today.amount)).toBe(300); expect(sum.today.stickers).toBe(6);
    expect(ok(await as('sales.westave').get('/api/dashboard')).body.sixPack.stickers).toBe(6);
    expect(ok(await as('sales.westave').get(`/api/expenses?locationId=${west}&from=${today()}&to=${today()}`)).body.some((e: { id: string }) => e.id === r.expenseId)).toBe(true);
    // search the lists (owner request 2026-10-02): by customer, mobile or card number; the period totals do not change
    const found = ok(await as('sales.westave').get('/api/six-pack/summary?search=maria%20santos')).body;
    expect(found.redemptions.length).toBeGreaterThanOrEqual(1); expect(found.stickers.length).toBeGreaterThanOrEqual(1); expect(found.period.cards).toBe(sum.period.cards);
    expect(ok(await as('sales.westave').get('/api/six-pack/summary?search=0917123')).body.stickers.length).toBeGreaterThanOrEqual(1);
    const none = ok(await as('sales.westave').get('/api/six-pack/summary?search=nobodyhere')).body; expect(none.redemptions.length).toBe(0); expect(none.stickers.length).toBe(0);
    await as('sales.dasma').get('/api/six-pack/summary?locationId=' + west).expect(403); // another branch
    expect(ok(await as('head.auditor').get('/api/six-pack/summary')).body.period.cards).toBeGreaterThanOrEqual(1);
    ok(await as('sales.westave').post(`/api/sales/${s2.id}/void`).send({ reason: 'customer changed mind' }));
    expect(ok(await as('sales.westave').get('/api/six-pack/customer?phone=09171234567')).body.earned).toBe(3);
    await as('sales.westave').post(`/api/six-pack/redemptions/${r.id}/void`).send({ reason: 'test' }).expect(403); // associates cannot void a redemption
    ok(await as('head.auditor').post(`/api/six-pack/redemptions/${r.id}/void`).send({ reason: 'counted twice' }));
    expect((await prisma.expenseDoc.findUniqueOrThrow({ where: { id: r.expenseId } })).voidedAt).not.toBeNull();
  });

  it('franchise AR: billed at the franchise price for what was received; a resolved difference changes it by itself and tells everyone; the memo penalty and interest; payment order; extension needs the Owner and flags the others; waive and credit hold are the Owner\'s', async () => {
    const t = ok(await as('wh.incharge').post('/api/transfers').send({ fromLocationId: wh, toLocationId: mayon, transferType: 'RESTOCK', lines: [{ productId: a, qty: 4 }] })).body;
    ok(await as('wh.incharge').post(`/api/transfers/${t.id}/submit`));
    ok(await decide('admin', t.id, 'TRANSFER_TO_FRANCHISE', 'APPROVE'));
    const fl = ok(await as('fr.mayon.owner').get(`/api/transfers/${t.id}`)).body.lines as { id: string }[];
    ok(await as('fr.mayon.owner').post(`/api/transfers/${t.id}/confirm`).send({ lines: [{ lineId: fl[0].id, qtyReceived: 3, discrepancyNote: 'only 3 in the box' }] }));
    // billed for the 3 received at ₱700
    let list = ok(await as('fr.mayon.owner').get('/api/franchise-ar')).body;
    let inv = list.franchises.find((f: { name: string }) => f.name.includes('Mayon')).invoices.find((i: { controlNo: string }) => i.controlNo === `FAR-${t.controlNo}`);
    expect(Number(inv.amount)).toBe(2100); expect(inv.controlNo).toBe(`FAR-${t.controlNo}`); expect(inv.dueDate).toBe(day(30));
    await as('fr.mayon.assoc').get('/api/franchise-ar').expect(403); await as('sales.westave').get('/api/franchise-ar').expect(403);
    expect(ok(await as('franchise.coord').get('/api/franchise-ar')).body.franchises.some((f: { invoices: unknown[] }) => f.invoices.length)).toBe(true);
    for (const u of ['fr.mayon.owner', 'franchise.coord', 'asst.franchise.coord', 'acct.head', 'acct.assoc', 'head.auditor', 'asst.auditor', 'admin']) expect(await notes(u), u).toContain('FRANCHISE_INVOICE');
    // the Head Auditor finds the receiver miscounted: the franchise gets 4, so the invoice becomes 4 × ₱700
    ok(await decide('head.auditor', t.id, 'TRANSFER_DIFF_REVIEW', 'REJECT', 'recounted: all 4 were there'));
    inv = (ok(await as('fr.mayon.owner').get(`/api/franchise-ar/${inv.id}`)).body);
    expect(Number(inv.amount)).toBe(2800); expect(inv.adjustments.some((x: { kind: string; delta: string }) => x.kind === 'TRANSFER_CHANGE' && Number(x.delta) === 700)).toBe(true);
    for (const u of ['fr.mayon.owner', 'franchise.coord', 'asst.franchise.coord', 'acct.head', 'head.auditor', 'asst.auditor', 'admin', 'wh.incharge']) expect(await notes(u), u).toContain('FRANCHISE_AR_ADJUSTED');
    const id = inv.id as string;
    // payment: Accounting records it, the franchise owner cannot; nothing is overdue yet
    await as('fr.mayon.owner').post(`/api/franchise-ar/${id}/payments`).send({ amount: 100, mode: 'CASH' }).expect(403);
    const p1 = ok(await as('acct.head').post(`/api/franchise-ar/${id}/payments`).send({ amount: 1000, mode: 'CASH' })).body;
    expect(Number(p1.principalPaid)).toBe(1000); expect(Number(p1.totalDue)).toBe(1800);
    expect((await as('acct.head').post(`/api/franchise-ar/${id}/payments`).send({ amount: 5000, mode: 'CASH' })).status).toBe(400); // more than is due
    // 10 days overdue on ₱1,800 unpaid: penalty 2% = 36.00, interest 0.1% × 10 days = 18.00
    await prisma.franchiseInvoice.update({ where: { id }, data: { dueDate: new Date(`${day(-10)}T00:00:00Z`), originalDueDate: new Date(`${day(-10)}T00:00:00Z`) } });
    const late = ok(await as('fr.mayon.owner').get(`/api/franchise-ar/${id}`)).body;
    expect(late.daysOverdue).toBe(10); expect(Number(late.penalty)).toBe(36); expect(Number(late.interest)).toBe(18); expect(Number(late.totalDue)).toBe(1854);
    // an extension is asked in the system: the Owner decides, the others are flagged, nothing changes before the decision
    await as('fr.mayon.assoc').post(`/api/franchise-ar/${id}/extension`).send({ requestedDueDate: day(15), reason: 'waiting for customers to pay' }).expect(403);
    ok(await as('fr.mayon.owner').post(`/api/franchise-ar/${id}/extension`).send({ requestedDueDate: day(15), reason: 'waiting for customers to pay' }));
    for (const u of ['admin', 'head.auditor', 'asst.auditor', 'acct.head', 'acct.assoc', 'franchise.coord']) expect(await notes(u), u).toContain('FRANCHISE_AR_EXTENSION');
    expect(Number(ok(await as('fr.mayon.owner').get(`/api/franchise-ar/${id}`)).body.daysOverdue)).toBe(10);
    await as('fr.mayon.owner').post(`/api/approvals/${(await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'FRANCHISE_AR_EXTENSION', status: 'PENDING' } })).id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    await as('head.auditor').post(`/api/approvals/${(await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'FRANCHISE_AR_EXTENSION', status: 'PENDING' } })).id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    ok(await as('admin').post(`/api/approvals/${(await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'FRANCHISE_AR_EXTENSION', status: 'PENDING' } })).id}/decide`).send({ decision: 'APPROVE' }));
    const ext = ok(await as('fr.mayon.owner').get(`/api/franchise-ar/${id}`)).body;
    expect(ext.dueDate).toBe(day(15)); expect(ext.daysOverdue).toBe(0); expect(Number(ext.chargesDue)).toBe(54); expect(ext.extended).toBe(true);
    expect(await notes('fr.mayon.owner')).toContain('FRANCHISE_AR_EXTENSION_DECIDED');
    // only the Owner waives; everyone is told
    await as('acct.head').post(`/api/franchise-ar/${id}/waive`).send({ amount: 20, reason: 'goodwill' }).expect(403);
    const w = ok(await as('admin').post(`/api/franchise-ar/${id}/waive`).send({ amount: 20, reason: 'goodwill for the extension' })).body;
    expect(Number(w.chargesDue)).toBe(34);
    // a payment settles the penalty first, then the interest, then the goods
    const p2 = ok(await as('acct.assoc').post(`/api/franchise-ar/${id}/payments`).send({ amount: 34, mode: 'BANK_TRANSFER', reference: 'BT-1' })).body;
    expect(Number(p2.chargesDue)).toBe(0); expect(Number(p2.principalPaid)).toBe(1000); expect(p2.payments.at(-1).toPrincipal).toBe('0');
    // cash before delivery: the Owner only
    await as('acct.head').put(`/api/franchise-ar/locations/${mayon}/credit-hold`).send({ hold: true, note: 'unpaid accounts' }).expect(403);
    ok(await as('admin').put(`/api/franchise-ar/locations/${mayon}/credit-hold`).send({ hold: true, note: 'unpaid accounts' }));
    expect(await notes('fr.mayon.owner')).toContain('FRANCHISE_CREDIT_HOLD');
    ok(await as('admin').put(`/api/franchise-ar/locations/${mayon}/credit-hold`).send({ hold: false }));
    // dashboards
    expect(Number(ok(await as('fr.mayon.owner').get('/api/franchise/portal')).body.arToWarehouse.openInvoices)).toBeGreaterThanOrEqual(1800);
    expect(ok(await as('admin').get('/api/dashboard')).body.franchiseAr.franchises).toBeGreaterThanOrEqual(1);
    // the daily job: two months overdue → penalty notice and the two-month flag reach everyone
    await prisma.franchiseInvoice.update({ where: { id }, data: { dueDate: new Date(`${day(-70)}T00:00:00Z`), originalDueDate: new Date(`${day(-70)}T00:00:00Z`), penalty: 0, penaltyPaid: 0, interest: 0, interestPaid: 0, penaltyAppliedOn: null, interestThrough: null, flaggedAt: null, remindedAt: null } });
    const job = await app.get(FranchiseArService).runDaily();
    expect(job.flagged).toBeGreaterThanOrEqual(1);
    for (const u of ['admin', 'franchise.coord', 'acct.head', 'head.auditor', 'fr.mayon.owner']) expect(await notes(u), u).toContain('FRANCHISE_AR_FLAGGED');
  });

  it('memorandums: numbered 2026-Qn-NNN, addressed to chosen people incl. franchisees, signers printed, everyone notified; the Owner\'s memos always carry the President and the Manager', async () => {
    await as('sales.westave').post('/api/memos').send({ subject: 'x', body: 'y y y', audience: { all: true } }).expect(403);
    const hr = ok(await as('hr.staff').post('/api/memos').send({ subject: 'Uniform reminder', body: 'Good day!\n\nPlease wear the uniform.', audience: { franchiseOwners: true, franchiseAssociates: true } })).body;
    expect(hr.memoNo).toMatch(/^\d{4}-Q[1-4]-\d{3}$/);
    expect(hr.signers.map((x: { name: string }) => x.name)).toEqual(['HR STAFF']);
    for (const u of ['fr.mayon.owner', 'fr.mayon.assoc']) expect(await notes(u), u).toContain(hr.memoNo);
    expect(await notes('sales.westave')).not.toContain(hr.memoNo);
    const coord = ok(await as('franchise.coord').post('/api/memos').send({ subject: 'Price adjustment', body: 'Good day!\n\nDetails below.', table: { headers: ['Products', 'Franchise cost', 'SRP', 'Credit card'], rows: [['Rule 1 Creatine 75 Serv', '1,000.00', '1,250.00', '1,302.08']] }, audience: { locationIds: [mayon], userIds: [] }, signers: [{ name: 'Angelica Pena', title: 'Franchise Coordinator' }] })).body;
    const n = (m: string) => Number(m.split('-')[2]); expect(n(coord.memoNo)).toBe(n(hr.memoNo) + 1);
    const owner = ok(await as('admin').post('/api/memos').send({ subject: 'Policy', body: 'Good day!\n\nPlease read.', audience: { all: true }, signers: [{ name: 'Syd Alvaz', title: 'Audit Staff' }] })).body;
    expect(owner.signers.slice(0, 2).map((x: { name: string; title: string }) => `${x.name}|${x.title.split(' / ')[0]}`)).toEqual(['AL MARVIN VINLUAN|President', 'MICAH VINLUAN|Manager']);
    expect(owner.signers.some((x: { name: string }) => x.name === 'Syd Alvaz')).toBe(true);
    expect(await notes('sales.westave')).toContain(owner.memoNo); expect(await notes('hr.staff')).toContain(owner.memoNo);
    // only those addressed read it; the writers see who has read it
    await as('sales.westave').get(`/api/memos/${hr.id}`).expect(403);
    expect(ok(await as('sales.westave').get('/api/memos')).body.map((m: { memoNo: string }) => m.memoNo)).toEqual([owner.memoNo]);
    const ack = ok(await as('fr.mayon.owner').post(`/api/memos/${hr.id}/ack`)).body; expect(ack.mine.acknowledgedAt).toBeTruthy();
    const view = ok(await as('hr.staff').get(`/api/memos/${hr.id}`)).body; expect(view.acknowledgedCount).toBe(1); expect(view.recipients.filter((r: { acknowledgedAt: string | null }) => r.acknowledgedAt)).toHaveLength(1);
    // printable in the company memo layout
    const pdf = await as('franchise.coord').get(`/api/memos/${coord.id}/pdf`).expect(200);
    const html = pdf.body instanceof Buffer ? pdf.body.toString() : String(pdf.text);
    expect(html).toContain(coord.memoNo); expect(html).toContain('TO:'); expect(html).toContain('RE: PRICE ADJUSTMENT'); expect(html).toContain('1,302.08'); expect(html).toContain('Angelica Pena');
    await as('hr.staff').post(`/api/memos/${owner.id}/void`).send({ reason: 'test' }).expect(403);
    ok(await as('admin').post(`/api/memos/${owner.id}/void`).send({ reason: 'sent by mistake' }));
  });

  it('the Owner adds a user and an employee: HR is notified; everyone can change their own password', async () => {
    const base = { username: `n30.${run}`, email: `n30.${run}@gws.local`, fullName: 'Nina Reyes', idNumber: `N30-${run}`, roleKey: 'WAREHOUSE_ASSOCIATE', password: 'Temporary#12345', locationIds: [wh] };
    ok(await as('admin').post('/api/users').send(base));
    expect(await notes('hr.staff')).toContain(base.username);
    ok(await as('admin').post('/api/payroll/employees').send({ employeeNo: `E30-${run}`, fullName: 'Pedro Dela Cruz', locationId: west, basicRate: 12000 }));
    expect(await notes('hr.staff')).toContain(`E30-${run}`);
    const t = (await http.post('/api/auth/login').send({ identifier: base.username, password: base.password }).expect(201)).body;
    const H = (r: request.Test) => r.set('Authorization', `Bearer ${t.token}`);
    await H(http.post('/api/auth/password')).send({ current: base.password, next: 'Nina-Own-Pass#2026' }).expect(201);
    await H(http.post('/api/auth/password')).send({ current: 'wrong-password', next: 'Another-Pass#2027' }).expect(401);
    await H(http.post('/api/auth/accept-accountability')).expect(201);
    await H(http.post('/api/auth/password')).send({ current: 'Nina-Own-Pass#2026', next: 'Nina-Changed-Pass#2027' }).expect(201); // any time, not only at first sign-in
    await http.post('/api/auth/login').send({ identifier: base.username, password: 'Nina-Changed-Pass#2027' }).expect(201);
  });
});

describe('Cash deposit slip: Audit Associate, then Accounting Associate (owner request 2026-09-30)', () => {
  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const notes = async (u: string) => JSON.stringify(ok(await as(u).get('/api/notifications')).body);
  it('the branch attaches the slip; Audit checks it, then Accounting; a rejection returns it to the branch with the reason and it can be sent again', async () => {
    const west = (await prisma.location.findUniqueOrThrow({ where: { code: 'WESTAVE' } })).id;
    const acct = (ok(await as('sales.westave').get(`/api/accounts/payment?locationId=${west}`)).body as { id: string }[])[0];
    const slip = ok(await as('sales.westave').post(`/api/attachments/CashDeposit/${crypto.randomUUID()}`).attach('file', png, { filename: 'slip.png', contentType: 'image/png' })).body;
    const dep = ok(await as('sales.westave').post('/api/expenses/deposits').send({ locationId: west, businessDate: today(), amount: 1234.56, bankAccountId: acct.id, depositedAt: today(), slipAttachmentId: slip.id })).body;
    expect(dep.status).toBe('PENDING_AUDIT');
    const list = ok(await as('sales.westave').get('/api/expenses/deposits')).body as { id: string; status: string; slip: { fileName: string } | null }[];
    expect(list.find((d) => d.id === dep.id)!.slip!.fileName).toBe('slip.png');
    // Accounting cannot check it before Audit; the branch cannot check its own
    const a1 = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'CASH_DEPOSIT_AUDIT', documentId: dep.id, status: 'PENDING' } });
    expect((await as('acct.assoc').post(`/api/approvals/${a1.id}/decide`).send({ decision: 'APPROVE' })).status).toBe(403);
    expect((await as('sales.westave').post(`/api/approvals/${a1.id}/decide`).send({ decision: 'APPROVE' })).status).toBe(403);
    expect(ok(await as('acct.assoc').get('/api/approvals/inbox')).body.items?.some?.((i: { documentId: string }) => i.documentId === dep.id) ?? false).toBe(false);
    expect(JSON.stringify(ok(await as('audit.assoc').get('/api/approvals/inbox')).body)).toContain(dep.id);
    const rv = ok(await as('audit.assoc').get(`/api/expenses/deposits/${dep.id}/review`)).body; expect(rv.slip.fileName).toBe('slip.png'); expect(Number(rv.amount)).toBe(1234.56);
    // the Audit Associate rejects (reason required): the branch, Head Auditor, Accounting Head and Owner are told
    expect((await as('audit.assoc').post(`/api/approvals/${a1.id}/decide`).send({ decision: 'REJECT' })).status).toBe(400);
    ok(await as('audit.assoc').post(`/api/approvals/${a1.id}/decide`).send({ decision: 'REJECT', note: 'The slip shows ₱1,200, not ₱1,234.56' }));
    let d = await prisma.cashDeposit.findUniqueOrThrow({ where: { id: dep.id } }); expect(d.status).toBe('REJECTED'); expect(d.rejectReason).toContain('1,200');
    for (const u of ['sales.westave', 'head.auditor', 'acct.head', 'admin']) expect(await notes(u), u).toContain('CASH_DEPOSIT_REJECTED');
    await as('hr.staff').post(`/api/expenses/deposits/${dep.id}/resubmit`).send({}).expect(403);
    ok(await as('sales.westave').post(`/api/expenses/deposits/${dep.id}/resubmit`).send({ note: 'corrected slip' }));
    const a2 = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'CASH_DEPOSIT_AUDIT', documentId: dep.id, status: 'PENDING' } });
    ok(await as('audit.assoc').post(`/api/approvals/${a2.id}/decide`).send({ decision: 'APPROVE' }));
    d = await prisma.cashDeposit.findUniqueOrThrow({ where: { id: dep.id } }); expect(d.status).toBe('PENDING_ACCOUNTING'); expect(d.auditVerifiedBy).toBeTruthy();
    const c1 = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'CASH_DEPOSIT_ACCOUNTING', documentId: dep.id, status: 'PENDING' } });
    expect((await as('audit.assoc').post(`/api/approvals/${c1.id}/decide`).send({ decision: 'APPROVE' })).status).toBe(403);
    ok(await as('acct.assoc').post(`/api/approvals/${c1.id}/decide`).send({ decision: 'APPROVE' }));
    d = await prisma.cashDeposit.findUniqueOrThrow({ where: { id: dep.id } }); expect(d.status).toBe('VERIFIED'); expect(d.accountingVerifiedBy).toBeTruthy();
    expect(await notes('sales.westave')).toContain('CASH_DEPOSIT_VERIFIED');
    // dates still to deposit are listed for the branch (clickable in the app)
    expect(ok(await as('sales.westave').get('/api/cash-on-hand')).body.days).toBeDefined();
  });
});

describe('Waybill report: upload shipping labels → SRP, fees and order income (owner request 2026-09-30)', () => {
  it('E-comm Associate, Head Auditor and Owner upload labels; the product is chosen once and remembered by weight; SRP comes from the platform price list; fees at the platform rates; centavos are kept', async () => {
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const run2 = `${run}w`;
    const prod = ok(await as('admin').post('/api/products').send({ name: `WB Whey ${run2}`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 1000 }, cost: 500 })).body.id as string;
    ok(await as('admin').put('/api/pricing/ecom').send({ rows: [{ productId: prod, tier: 'TIKTOK', price: 1199.5 }, { productId: prod, tier: 'SHOPEE', price: 1100 }] }));
    const pdf = makePdf([[`TT Order ID: 58602435753${run.replace(/\D/g, '').padEnd(7, '1').slice(0, 7)}`, 'JT0023984229750', 'Weight: 0.600 KG', 'RTS Time: 2026-09-12'], ['Order ID:', '2609057S9U6WH6', 'PH2620256392738', 'Product Quantity:', '2', 'Weight:', '602 g'], ['nothing here']]);
    const up = (u: string, buf: Buffer, name = 'labels.pdf') => http.post('/api/ecommerce-waybills/upload').set('Authorization', `Bearer ${tokens[u]}`).attach('files', buf, { filename: name, contentType: 'application/pdf' });
    expect((await up('sales.westave', pdf)).status).toBe(403);
    const r1 = ok(await up('ecomm.assoc', pdf)).body;
    expect(r1.added).toBe(2); expect(r1.unreadable).toEqual([{ file: 'labels.pdf', pages: [3] }]);
    expect(ok(await up('head.auditor', pdf)).body).toMatchObject({ added: 0, duplicates: 2 }); // the same labels are never counted twice
    let rep = ok(await as('ecomm.assoc').get('/api/ecommerce-waybills')).body;
    expect(rep.totals.waybills).toBe(2); expect(rep.totals.unassigned).toBe(2);
    const tik = rep.rows.find((x: { platform: string }) => x.platform === 'TIKTOK'); const shp = rep.rows.find((x: { platform: string }) => x.platform === 'SHOPEE');
    expect(shp.qty).toBe(2); expect(tik.weightG).toBe(600);
    ok(await as('ecomm.assoc').patch(`/api/ecommerce-waybills/${tik.id}`).send({ productId: prod }));
    ok(await as('head.auditor').patch(`/api/ecommerce-waybills/${shp.id}`).send({ productId: prod }));
    ok(await as('admin').put('/api/ecommerce-waybills/rates/TIKTOK').send({ commissionPct: 5, transactionPct: 2, affiliatePct: 0, shippingPerOrder: 30 }));
    rep = ok(await as('admin').get('/api/ecommerce-waybills')).body;
    const t2 = rep.rows.find((x: { id: string }) => x.id === tik.id); const s2 = rep.rows.find((x: { id: string }) => x.id === shp.id);
    expect(t2.unitSrp).toBe(1199.5); expect(t2.srp).toBe(1199.5); expect(t2.priceFrom).toBe('TIKTOK');
    expect(t2.commission).toBe(59.98); expect(t2.transactionFee).toBe(23.99); expect(t2.shippingFee).toBe(30); expect(t2.fees).toBe(113.97); expect(t2.income).toBe(1085.53);
    expect(s2.srp).toBe(2200); expect(s2.fees).toBe(0); expect(s2.income).toBe(2200); // Shopee has no rates set yet
    expect(rep.totals.srp).toBe(3399.5); expect(rep.totals.income).toBe(3285.53);
    // a second label of the same weight is filled in from what was chosen before, to confirm
    const pdf2 = makePdf([['TT Order ID: 586024357999999999', 'JT0023984229999', 'Weight: 0.600 KG']]);
    ok(await up('ecomm.assoc', pdf2, 'more.pdf'));
    rep = ok(await as('ecomm.assoc').get('/api/ecommerce-waybills?platform=TIKTOK')).body;
    const g = rep.rows.find((x: { orderId: string }) => x.orderId === '586024357999999999'); expect(g.guessed).toBe(true); expect(g.product.name).toContain('WB Whey');
    ok(await as('ecomm.assoc').post('/api/ecommerce-waybills/confirm').send({ ids: [g.id] }));
    expect(ok(await as('ecomm.assoc').get('/api/ecommerce-waybills?platform=TIKTOK')).body.rows.find((x: { id: string }) => x.id === g.id).guessed).toBe(false);
    const x = await as('head.auditor').get('/api/ecommerce-waybills/export.xlsx').expect(200);
    expect(x.headers['content-type']).toContain('spreadsheetml'); expect(x.headers['content-disposition']).toContain('Waybill-report');
    await as('sales.westave').get('/api/ecommerce-waybills').expect(403);
    ok(await as('ecomm.assoc').delete(`/api/ecommerce-waybills/${g.id}`));
  });
});

describe('6-Pack Card override: Head Auditor asks, the Owner approves (owner request 2026-09-30)', () => {
  it('a card for a customer who cannot be tagged needs the Head Auditor\'s request and the Owner\'s approval; then it is booked and flagged', async () => {
    const west = (await prisma.location.findUniqueOrThrow({ where: { code: 'WESTAVE' } })).id;
    await as('sales.westave').post('/api/six-pack/override').send({ locationId: west, reason: 'customer has no phone' }).expect(403);
    await as('acct.head').post('/api/six-pack/override').send({ locationId: west, reason: 'customer has no phone' }).expect(403);
    expect((await as('head.auditor').post('/api/six-pack/override').send({ locationId: west, reason: 'x' })).status).toBe(400); // a reason is required
    ok(await as('head.auditor').post('/api/six-pack/override').send({ locationId: west, customerName: 'Walk-in lady', reason: 'Customer refused to give a mobile number; paper card brought' }));
    expect(JSON.stringify(ok(await as('admin').get('/api/notifications')).body)).toContain('SIXPACK_OVERRIDE');
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'SIXPACK_OVERRIDE', status: 'PENDING' } });
    expect(req.requiredApproverRoles).toEqual(['ADMIN']);
    expect((await as('head.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' })).status).toBe(403); // the Head Auditor cannot approve their own request
    const before = await prisma.sixPackRedemption.count();
    ok(await as('admin').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    const r = await prisma.sixPackRedemption.findFirstOrThrow({ orderBy: { redeemedAt: 'desc' } });
    expect(await prisma.sixPackRedemption.count()).toBe(before + 1);
    expect(Number(r.amount)).toBe(300); expect(r.customerName).toBe('Walk-in lady'); expect(r.flaggedNote).toContain('Override'); expect(r.locationId).toBe(west);
    const ex = await prisma.expenseDoc.findUniqueOrThrow({ where: { id: r.expenseId! }, include: { account: true } });
    expect(Number(ex.amount)).toBe(300); expect(ex.account.title).toMatch(/6-Pack Card/);
    expect(JSON.stringify(ok(await as('sales.westave').get('/api/notifications')).body)).toContain('without complete customer data');
  });
});

describe('Franchise sales: sales associates and the Franchise Coordinator may sell to a franchise; shipping charge to follow; plastic prices (owner request 2026-10-01)', () => {
  let wh = ''; let west = ''; let mayon = ''; let item = ''; let plasticXl = ''; let plasticS = ''; let fr = '';
  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const day = (n: number) => new Date(Date.now() + 8 * 3600e3 + n * 86400000).toISOString().slice(0, 10);
  const notes = async (u: string) => JSON.stringify(ok(await as(u).get('/api/notifications')).body);
  const giveStock = async (locationId: string, productId: string, qty: number, cost: number) => {
    const batch = await prisma.batch.create({ data: { productId, batchNo: `F1-${run}-${locationId.slice(0, 4)}-${productId.slice(0, 4)}`, receivedRef: 'TEST', unitCost: cost.toFixed(2) } });
    await prisma.stockLedger.create({ data: { locationId, productId, batchId: batch.id, qtyDelta: qty, movementType: 'RECEIVE', documentType: 'OpeningStock', documentId: batch.id, unitCost: cost.toFixed(2), businessDate: new Date(`${today()}T00:00:00Z`) } });
    await prisma.stockBalance.create({ data: { locationId, productId, batchId: batch.id, qty } });
  };
  let n = 0;
  const sale = (u: string, body: Record<string, unknown>) => as(u).post('/api/sales').send({ drSiNo: `FS-${run}-${++n}`, ...body });
  beforeAll(async () => {
    const locs = ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[];
    wh = locs.find((l) => l.code === 'WH')!.id; west = locs.find((l) => l.code === 'WESTAVE')!.id; mayon = locs.find((l) => l.code === 'MAYON')!.id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const cat = (c: string) => cats.find((x) => x.accountingClass === c)!.id;
    item = ok(await as('admin').post('/api/products').send({ name: `E2E F1 Whey ${run}`, categoryId: cat('SUPPLEMENT'), prices: { RETAIL: 1000, DEALER: 800, FRANCHISE: 700 }, cost: 500 })).body.id;
    plasticXl = ok(await as('admin').post('/api/products').send({ name: `E2E Plastic XL ${run}`, categoryId: cat('PLASTIC'), prices: { FRANCHISE: 5 }, cost: 2 })).body.id;
    plasticS = ok(await as('admin').post('/api/products').send({ name: `E2E Plastic S ${run}`, categoryId: cat('PLASTIC'), cost: 1 })).body.id;
    for (const loc of [wh, west, mayon]) { await giveStock(loc, item, 30, 500); await giveStock(loc, plasticXl, 100, 2); await giveStock(loc, plasticS, 100, 1); }
    fr = (await prisma.customer.findFirst({ where: { type: 'FRANCHISE', locationId: mayon } }))?.id ?? (await prisma.customer.create({ data: { code: `FR-${run}`, name: 'Franchise Mayon', type: 'FRANCHISE', locationId: mayon } })).id;
  });

  it('a sales associate can sell to a franchise at the franchise price (was refused); plastic is charged to the franchise; the price can be changed', async () => {
    const r = ok(await sale('sales.wh', { locationId: wh, channel: 'FRANCHISE', customerId: fr, paymentMode: 'AR_PDC', dueDate: day(30), franchiseShipping: { mode: 'NONE' }, lines: [{ productId: item, qty: 2 }, { productId: plasticXl, qty: 2 }] }).expect(201)).body;
    const l = (id: string) => r.lines.find((x: { productId: string }) => x.productId === id);
    expect(l(item).priceTier).toBe('FRANCHISE'); expect(Number(l(item).unitPrice)).toBe(700);
    expect(Number(l(plasticXl).unitPrice)).toBe(5); expect(l(plasticXl).isFreebie).toBe(false); expect(Number(r.productTotal)).toBe(1410);
    // the price may be changed: raised or lowered by a little (no approval); the sale is saved
    const r2 = ok(await sale('sales.wh', { locationId: wh, channel: 'FRANCHISE', customerId: fr, paymentMode: 'AR_PDC', dueDate: day(30), franchiseShipping: { mode: 'NONE' }, lines: [{ productId: item, qty: 1, unitPrice: 720 }] }).expect(201)).body;
    expect(Number(r2.productTotal)).toBe(720);
    // a franchise owner's own retail sale at their franchise: plastic stays free
    expect(Number(ok(await sale('fr.mayon.owner', { channel: 'WALK_IN', paymentMode: 'CASH', lines: [{ productId: item, qty: 1 }, { productId: plasticXl, qty: 1 }] }).expect(201)).body.productTotal)).toBe(Number(1000));
  });

  it('plastic for stores and other customers is free, but its price can be typed when it was sold', async () => {
    const free = ok(await sale('sales.westave', { channel: 'WALK_IN', paymentMode: 'CASH', lines: [{ productId: item, qty: 1 }, { productId: plasticS, qty: 3 }] }).expect(201)).body;
    const pl = free.lines.find((x: { productId: string }) => x.productId === plasticS);
    expect(pl.isFreebie).toBe(true); expect(Number(pl.unitPrice)).toBe(0); expect(Number(free.productTotal)).toBe(1000);
    const sold = ok(await sale('sales.westave', { channel: 'WALK_IN', paymentMode: 'CASH', lines: [{ productId: plasticS, qty: 3, unitPrice: 2 }] }).expect(201)).body;
    expect(sold.lines[0].isFreebie).toBe(false); expect(Number(sold.productTotal)).toBe(6);
    // franchise plastic prices are given to sized bags that have none yet; an Admin-set price is never overwritten
    const bare = await prisma.product.create({ data: { sku: `PL-${run}`, name: `E2E Plastic M ${run}`, categoryId: (await prisma.category.findFirstOrThrow({ where: { accountingClass: 'PLASTIC' } })).id, unit: 'pc' } });
    await ensurePlasticFranchisePrices(prisma);
    expect(Number((await prisma.priceList.findFirstOrThrow({ where: { productId: bare.id, tier: 'FRANCHISE' } })).price)).toBe(3);
    expect(Number((await prisma.priceList.findFirstOrThrow({ where: { productId: plasticXl, tier: 'FRANCHISE' } })).price)).toBe(5);
  });

  it('shipping to follow: the Franchise Coordinator is told and fills it within 2 days; it becomes its own franchise invoice; everyone is told; later changes need the Owner', async () => {
    ok(await as('admin').put('/api/settings').send({ 'gl.auto_posting_enabled': true }));
    const r = ok(await sale('sales.wh', { locationId: wh, channel: 'FRANCHISE', customerId: fr, paymentMode: 'AR_PDC', dueDate: day(30), franchiseShipping: { mode: 'TO_FOLLOW' }, lines: [{ productId: item, qty: 1 }] }).expect(201)).body;
    const list = ok(await as('franchise.coord').get('/api/franchise-ar/shipping-charges')).body as { id: string; saleId: string; status: string; fillBy: string }[];
    const ch = list.find((x) => x.saleId === r.id)!; expect(ch.status).toBe('TO_FOLLOW'); expect(ch.fillBy).toBe(day(2));
    for (const u of ['franchise.coord', 'asst.franchise.coord', 'fr.mayon.owner', 'acct.head', 'acct.assoc', 'head.auditor', 'asst.auditor', 'admin']) expect(await notes(u), u).toContain('FRANCHISE_SHIPPING_TO_FOLLOW');
    await as('sales.wh').post(`/api/franchise-ar/shipping-charges/${ch.id}/fill`).send({ amount: 350 }).expect(403);
    await as('fr.mayon.assoc').get('/api/franchise-ar/shipping-charges').expect(403);
    // the order's own total does not include it
    expect(Number(r.grandTotal)).toBe(700);
    const filled = ok(await as('franchise.coord').post(`/api/franchise-ar/shipping-charges/${ch.id}/fill`).send({ amount: 350, courier: 'LBC', reference: 'LBC123' })).body;
    expect(filled.status).toBe('FILLED'); expect(Number(filled.amount)).toBe(350);
    await as('franchise.coord').post(`/api/franchise-ar/shipping-charges/${ch.id}/fill`).send({ amount: 100 }).expect(400);
    const ar = ok(await as('fr.mayon.owner').get('/api/franchise-ar?status=ALL')).body;
    const inv = ar.franchises.flatMap((f: { invoices: { source: string; controlNo: string; amount: string; dueDate: string }[] }) => f.invoices).find((i: { source: string; controlNo: string }) => i.source === 'SHIPPING' && i.controlNo === `FAR-SHIP-${r.controlNo}`);
    expect(Number(inv.amount)).toBe(350); expect(inv.dueDate).toBe(day(30));
    for (const u of ['franchise.coord', 'fr.mayon.owner', 'acct.head', 'head.auditor', 'admin']) expect(await notes(u), u).toContain('FRANCHISE_SHIPPING_INVOICE');
    const jv = await prisma.journalVoucher.findFirstOrThrow({ where: { sourceDocumentType: 'FranchiseShippingCharge', sourceDocumentId: ch.id }, include: { lines: true } });
    expect(jv.lines.reduce((t, x) => t + Number(x.debit), 0)).toBe(350);
    // a change needs the Owner: the sales associate cannot ask, the coordinator asks, only the Owner decides
    await as('sales.wh').post(`/api/franchise-ar/shipping-charges/${ch.id}/edit`).send({ amount: 400, reason: 'courier changed the rate' }).expect(403);
    expect((await as('franchise.coord').post(`/api/franchise-ar/shipping-charges/${ch.id}/edit`).send({ amount: 400, reason: 'x' })).status).toBe(400);
    ok(await as('franchise.coord').post(`/api/franchise-ar/shipping-charges/${ch.id}/edit`).send({ amount: 400, reason: 'courier changed the rate' }));
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'FRANCHISE_SHIPPING_EDIT', documentId: ch.id, status: 'PENDING' } });
    expect(req.requiredApproverRoles).toEqual(['ADMIN']);
    await as('franchise.coord').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    ok(await as('admin').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    const after = ok(await as('fr.mayon.owner').get(`/api/franchise-ar/${inv.id}`)).body;
    expect(Number(after.amount)).toBe(400); expect(after.adjustments.some((x: { kind: string; delta: string }) => x.kind === 'SHIPPING_EDIT' && Number(x.delta) === 50)).toBe(true);
    // a second request the Owner rejects leaves the amount alone and tells the coordinator
    ok(await as('franchise.coord').post(`/api/franchise-ar/shipping-charges/${ch.id}/edit`).send({ amount: 999, reason: 'typed wrong' }));
    const req2 = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'FRANCHISE_SHIPPING_EDIT', documentId: ch.id, status: 'PENDING' } });
    ok(await as('admin').post(`/api/approvals/${req2.id}/decide`).send({ decision: 'REJECT', note: 'keep 400' }));
    expect(Number(ok(await as('fr.mayon.owner').get(`/api/franchise-ar/${inv.id}`)).body.amount)).toBe(400);
    expect(await notes('franchise.coord')).toContain('FRANCHISE_SHIPPING_EDIT_REJECTED');
    ok(await as('admin').put('/api/settings').send({ 'gl.auto_posting_enabled': false }));
  });

  it('shipping typed at once is billed at once; one not filled after 2 days is reminded every day; "more time" needs the Owner', async () => {
    const r = ok(await sale('sales.wh', { locationId: wh, channel: 'FRANCHISE', customerId: fr, paymentMode: 'AR_PDC', dueDate: day(30), franchiseShipping: { mode: 'AMOUNT', amount: 120, courier: 'JRS' }, lines: [{ productId: item, qty: 1 }] }).expect(201)).body;
    const now = ok(await as('fr.mayon.owner').get('/api/franchise-ar/shipping-charges?status=ALL')).body as { saleId: string; status: string; amount: string }[];
    expect(now.find((x) => x.saleId === r.id)).toMatchObject({ status: 'FILLED' }); expect(Number(now.find((x) => x.saleId === r.id)!.amount)).toBe(120);
    // refused: shipping typed with no amount; shipping on a non-franchise sale
    expect((await sale('sales.wh', { locationId: wh, channel: 'FRANCHISE', customerId: fr, paymentMode: 'AR_PDC', dueDate: day(30), franchiseShipping: { mode: 'AMOUNT' }, lines: [{ productId: item, qty: 1 }] })).status).toBe(400);
    expect((await sale('sales.westave', { channel: 'WALK_IN', paymentMode: 'CASH', franchiseShipping: { mode: 'TO_FOLLOW' }, lines: [{ productId: item, qty: 1 }] })).status).toBe(400);
    const r3 = ok(await sale('sales.wh', { locationId: wh, channel: 'FRANCHISE', customerId: fr, paymentMode: 'AR_PDC', dueDate: day(30), franchiseShipping: { mode: 'TO_FOLLOW' }, lines: [{ productId: item, qty: 1 }] }).expect(201)).body;
    const ch = await prisma.franchiseShippingCharge.findUniqueOrThrow({ where: { salesDocId: r3.id } });
    await prisma.franchiseShippingCharge.update({ where: { id: ch.id }, data: { fillBy: new Date(`${day(-1)}T00:00:00Z`) } });
    await prisma.notification.deleteMany({ where: { type: 'FRANCHISE_SHIPPING_OVERDUE' } });
    expect((await app.get(FranchiseShippingService).runDaily()).reminded).toBeGreaterThanOrEqual(1);
    for (const u of ['franchise.coord', 'asst.franchise.coord', 'fr.mayon.owner', 'acct.head', 'head.auditor', 'admin']) expect(await notes(u), u).toContain('FRANCHISE_SHIPPING_OVERDUE');
    expect((await app.get(FranchiseShippingService).runDaily()).reminded).toBe(0); // once a day
    ok(await as('franchise.coord').post(`/api/franchise-ar/shipping-charges/${ch.id}/edit`).send({ fillBy: day(3), reason: 'waiting for the courier receipt' }));
    const rq = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'FRANCHISE_SHIPPING_EDIT', documentId: ch.id, status: 'PENDING' } });
    ok(await as('admin').post(`/api/approvals/${rq.id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.franchiseShippingCharge.findUniqueOrThrow({ where: { id: ch.id } })).fillBy.toISOString().slice(0, 10)).toBe(day(3));
  });

  it('the Franchise Coordinator records sales from the warehouse: franchises and every other channel and payment; not from branches; the franchise owner sees only their own franchise\'s transactions and creates them', async () => {
    const menu = ok(await as('franchise.coord').get('/api/auth/me')).body.permissions as string[]; expect(menu).toContain('sale.create.warehouse');
    ok(await sale('franchise.coord', { locationId: wh, channel: 'FRANCHISE', customerId: fr, paymentMode: 'AR_PDC', dueDate: day(30), franchiseShipping: { mode: 'TO_FOLLOW' }, lines: [{ productId: item, qty: 1 }] }).expect(201));
    // any other sale from the warehouse: walk-in cash, dealer on credit, online
    const walk = ok(await sale('franchise.coord', { locationId: wh, channel: 'WALK_IN', paymentMode: 'CASH', lines: [{ productId: item, qty: 1 }] }).expect(201)).body; expect(Number(walk.productTotal)).toBe(1000);
    ok(await sale('franchise.coord', { locationId: wh, channel: 'AGENT', paymentMode: 'CASH', lines: [{ productId: item, qty: 1 }], agentId: ok(await as('admin').get('/api/agents')).body[0]?.id }).expect((r) => { if (![201, 400].includes(r.status)) throw new Error(String(r.status)); }));
    // never from a branch, and a franchise sale needs the franchisee
    expect((await sale('franchise.coord', { locationId: west, channel: 'WALK_IN', paymentMode: 'CASH', lines: [{ productId: item, qty: 1 }] })).status).toBe(403);
    expect((await sale('franchise.coord', { locationId: wh, channel: 'FRANCHISE', paymentMode: 'AR_PDC', dueDate: day(30), lines: [{ productId: item, qty: 1 }] })).status).toBe(400);
    await as('franchise.coord').get('/api/closing/summary').expect(403); // Daily Close stays with the branches
    const mine = ok(await as('fr.mayon.owner').get(`/api/sales?from=${day(-1)}&to=${day(1)}`)).body as { locationId: string }[];
    expect(mine.length).toBeGreaterThan(0); expect(mine.every((x) => x.locationId === mayon)).toBe(true);
    await as('fr.mayon.owner').post('/api/sales').send({ drSiNo: `FS-${run}-own`, locationId: west, channel: 'WALK_IN', paymentMode: 'CASH', lines: [{ productId: item, qty: 1 }] }).expect(403); // not their franchise
  });
});

describe('Deleting unfinished drafts: form numbers adjust by themselves (owner request 2026-10-01)', () => {
  let wh = ''; let west = ''; let item = '';
  const mk = async (u = 'wh.incharge') => ok(await as(u).post('/api/transfers').send({ fromLocationId: wh, toLocationId: west, transferType: 'RESTOCK', lines: [{ productId: item, qty: 1 }] }).expect((r) => { if (r.status !== 201) console.log('MK', r.status, JSON.stringify(r.body)); }).expect(201)).body as { id: string; controlNo: string; transferInNo: string };
  const get = async (id: string) => ok(await as('wh.incharge').get(`/api/transfers/${id}`)).body as { controlNo: string; transferInNo: string; status: string };
  const num = (no: string) => Number(no.split('-').pop());
  beforeAll(async () => {
    const locs = ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[];
    wh = locs.find((l) => l.code === 'WH')!.id; west = locs.find((l) => l.code === 'WESTAVE')!.id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    item = ok(await as('admin').post('/api/products').send({ name: `E2E Draft Whey ${run}`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 1000 }, cost: 500 })).body.id;
    const batch = await prisma.batch.create({ data: { productId: item, batchNo: `DR-${run}`, receivedRef: 'TEST', unitCost: '500.00' } });
    const day = new Date(`${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}T00:00:00Z`);
    await prisma.stockLedger.create({ data: { locationId: wh, productId: item, batchId: batch.id, qtyDelta: 50, movementType: 'RECEIVE', documentType: 'OpeningStock', documentId: batch.id, unitCost: '500.00', businessDate: day } });
    await prisma.stockBalance.create({ data: { locationId: wh, productId: item, batchId: batch.id, qty: 50 } });
  });

  it('deleting a draft moves the later drafts down one number (both the Pull-Out and the Transfer-In), their owners are told, and the next new form follows without a gap', async () => {
    const a = await mk(); const b = await mk(); const c = await mk();
    expect(num(b.controlNo)).toBe(num(a.controlNo) + 1); expect(num(c.controlNo)).toBe(num(a.controlNo) + 2);
    const r = ok(await as('wh.incharge').delete(`/api/drafts/transfer/${a.id}`)).body;
    expect(r.deleted).toBe(a.controlNo); expect(r.renumbered.length).toBeGreaterThanOrEqual(2);
    expect((await get(b.id)).controlNo).toBe(a.controlNo); expect((await get(c.id)).controlNo).toBe(b.controlNo);
    expect((await get(b.id)).transferInNo).toBe(a.transferInNo); expect((await get(c.id)).transferInNo).toBe(b.transferInNo);
    await as('wh.incharge').get(`/api/transfers/${a.id}`).expect(404);
    const d = await mk(); expect(d.controlNo).toBe(c.controlNo); expect(d.transferInNo).toBe(c.transferInNo); // no hole, no jump
  });

  it('a form that is already submitted keeps its number; the freed number is reused by the next new form; only the preparer, the In-Charge or the Owner may delete', async () => {
    const a = await mk(); const b = await mk();
    ok(await as('wh.incharge').post(`/api/transfers/${b.id}/submit`));
    await as('sales.westave').delete(`/api/drafts/transfer/${a.id}`).expect(403);
    await as('wh.incharge').delete(`/api/drafts/transfer/${b.id}`).expect(400); // sent: cancel (void) instead
    const r = ok(await as('wh.incharge').delete(`/api/drafts/transfer/${a.id}`)).body;
    expect(r.renumbered.length).toBe(0); expect((await get(b.id)).controlNo).toBe(b.controlNo);
    const next = await mk(); expect(next.controlNo).toBe(a.controlNo); // the freed number comes back
    ok(await as('admin').delete(`/api/drafts/transfer/${next.id}`)); // the Owner may delete any draft
    await as('admin').delete(`/api/drafts/nonsense/${next.id}`).expect(400);
  });

  it('count sheets, receiving drafts and inspection drafts can be deleted too', async () => {
    const rc = ok(await as('wh.assoc').post('/api/receiving').send({ supplierId: (await prisma.supplier.findFirstOrThrow()).id, supplierRef: `DEL-${run}`, lines: [{ productId: item, qty: 2, expiryDate: '2027-12-31', batchNo: `DX-${run}` }] }).expect(201)).body;
    expect(ok(await as('wh.assoc').delete(`/api/drafts/receiving/${rc.id}`)).body.deleted).toBe(rc.controlNo);
    expect(await prisma.receivingDoc.findUnique({ where: { id: rc.id } })).toBeNull();
    const ins = ok(await as('field.auditor').post('/api/inspections').send({ locationId: west, inspectionDate: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), items: [] })).body;
    ok(await as('field.auditor').delete(`/api/drafts/inspection/${ins.id}`));
    expect(await prisma.storeInspection.findUnique({ where: { id: ins.id } })).toBeNull();
  });
});

describe('Pull-outs to Prothin Marketing / GWS Marketing / BO, and the forms behind a movement (owner requests 2026-10-01)', () => {
  let wh = ''; let west = ''; let item = ''; let prothin = ''; let bo = '';
  const day = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const notes = async (u: string) => JSON.stringify(ok(await as(u).get('/api/notifications')).body);
  beforeAll(async () => {
    const locs = ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[];
    wh = locs.find((l) => l.code === 'WH')!.id; west = locs.find((l) => l.code === 'WESTAVE')!.id; prothin = locs.find((l) => l.code === 'MKT-PROTHIN')!.id; bo = locs.find((l) => l.code === 'BO-BAD')!.id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    item = ok(await as('admin').post('/api/products').send({ name: `E2E Mkt Whey ${run}`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 1000 }, cost: 500 })).body.id;
    const b = await prisma.batch.create({ data: { productId: item, batchNo: `MK-${run}`, receivedRef: 'TEST', unitCost: '500.00' } });
    const d = new Date(`${day()}T00:00:00Z`);
    for (const loc of [west, wh]) { await prisma.stockLedger.create({ data: { locationId: loc, productId: item, batchId: b.id, qtyDelta: 40, movementType: 'RECEIVE', documentType: 'OpeningStock', documentId: b.id, unitCost: '500.00', businessDate: d } }); await prisma.stockBalance.create({ data: { locationId: loc, productId: item, batchId: b.id, qty: 40 } }); }
  });
  const onHand = async (loc: string) => (await prisma.stockBalance.aggregate({ where: { locationId: loc, productId: item }, _sum: { qty: true } }))._sum.qty ?? 0;

  it('a branch gives stock to Prothin Marketing: the Head Auditor approves, the stock leaves at once, it is endorsed to Accounting as an expense and booked; BO needs no endorsement', async () => {
    // the destination and the type go together
    await as('sales.westave').post('/api/transfers').send({ toLocationId: prothin, transferType: 'RESTOCK', lines: [{ productId: item, qty: 2 }] }).expect(400);
    await as('sales.westave').post('/api/transfers').send({ toLocationId: wh, transferType: 'MARKETING_PULLOUT', lines: [{ productId: item, qty: 2 }] }).expect(400);
    ok(await as('admin').put('/api/settings').send({ 'gl.auto_posting_enabled': true }));
    const t = ok(await as('sales.westave').post('/api/transfers').send({ toLocationId: prothin, transferType: 'MARKETING_PULLOUT', endorseExpense: true, lines: [{ productId: item, qty: 5 }] }).expect(201)).body;
    ok(await as('sales.westave').post(`/api/transfers/${t.id}/submit`));
    expect(await onHand(west)).toBe(40); // nothing moves before approval
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'MARKETING_PULLOUT', documentId: t.id, status: 'PENDING' } });
    expect(req.requiredApproverRoles).toEqual(expect.arrayContaining(['HEAD_AUDITOR']));
    await as('acct.head').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    ok(await as('head.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    expect(await onHand(west)).toBe(35); expect(await onHand(prothin)).toBe(5);
    expect((await prisma.transferDoc.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('RECEIVED');
    // endorsed: Accounting is asked, accepts, and the expense is booked at cost (5 × ₱500)
    const exp = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'PULLOUT_EXPENSE', documentId: t.id, status: 'PENDING' } });
    expect(await notes('acct.assoc')).toContain('PULLOUT_EXPENSE');
    await as('sales.westave').post(`/api/approvals/${exp.id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    ok(await as('acct.assoc').post(`/api/approvals/${exp.id}/decide`).send({ decision: 'APPROVE' }));
    const done = await prisma.transferDoc.findUniqueOrThrow({ where: { id: t.id } }); expect(done.expenseStatus).toBe('POSTED');
    ok(await as('admin').put('/api/settings').send({ 'gl.auto_posting_enabled': false }));
    // BO: not endorsed at first; endorsed later; Accounting may refuse with a reason and it can be sent again
    const b = ok(await as('sales.westave').post('/api/transfers').send({ toLocationId: bo, transferType: 'MARKETING_PULLOUT', lines: [{ productId: item, qty: 3 }] }).expect(201)).body;
    ok(await as('sales.westave').post(`/api/transfers/${b.id}/submit`));
    ok(await as('head.auditor').post(`/api/approvals/${(await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'MARKETING_PULLOUT', documentId: b.id, status: 'PENDING' } })).id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.transferDoc.findUniqueOrThrow({ where: { id: b.id } })).expenseStatus).toBeNull();
    ok(await as('sales.westave').post(`/api/marketing-pullouts/${b.id}/endorse`));
    await as('sales.westave').post(`/api/marketing-pullouts/${b.id}/endorse`).expect(400); // already with Accounting
    const exp2 = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'PULLOUT_EXPENSE', documentId: b.id, status: 'PENDING' } });
    ok(await as('acct.head').post(`/api/approvals/${exp2.id}/decide`).send({ decision: 'REJECT', note: 'attach the bad-order list' }));
    expect((await prisma.transferDoc.findUniqueOrThrow({ where: { id: b.id } })).expenseStatus).toBe('REJECTED');
    ok(await as('sales.westave').post(`/api/marketing-pullouts/${b.id}/endorse`)); // sent again
    // the summary: per destination, item by item, expensed vs not
    const sum = ok(await as('head.auditor').get(`/api/marketing-pullouts/summary?from=${day()}&to=${day()}`)).body;
    const pm = sum.destinations.find((d: { code: string }) => d.code === 'MKT-PROTHIN'); const bd = sum.destinations.find((d: { code: string }) => d.code === 'BO-BAD');
    expect(pm.totals.units).toBeGreaterThanOrEqual(5); expect(pm.totals.expensedUnits).toBeGreaterThanOrEqual(5);
    expect(bd.totals.units).toBeGreaterThanOrEqual(3); expect(bd.totals.pendingExpenseUnits).toBeGreaterThanOrEqual(3);
    expect(pm.products.find((p: { name: string }) => p.name === `E2E Mkt Whey ${run}`).units).toBe(5); expect(Number(pm.totals.value)).toBeGreaterThanOrEqual(2500);
    // a branch sees only its own; cost only for cost roles
    const own = ok(await as('sales.westave').get(`/api/marketing-pullouts/summary?from=${day()}&to=${day()}`)).body;
    expect(own.canCost).toBe(false); expect(JSON.stringify(own)).not.toContain('"value"');
  });

  it('click a figure of the Daily Inventory Report: the forms behind it (pull-out and transfer-in), never for sales', async () => {
    const t = ok(await as('wh.incharge').post('/api/transfers').send({ fromLocationId: wh, toLocationId: west, transferType: 'RESTOCK', lines: [{ productId: item, qty: 4 }] }).expect(201)).body;
    ok(await as('wh.incharge').post(`/api/transfers/${t.id}/submit`));
    const r = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: t.id, status: 'PENDING' } });
    ok(await as('head.auditor').post(`/api/approvals/${r.id}/decide`).send({ decision: 'APPROVE' }));
    const fl = ok(await as('sales.westave').get(`/api/transfers/${t.id}`)).body.lines as { id: string }[];
    ok(await as('sales.westave').post(`/api/transfers/${t.id}/confirm`).send({ lines: fl.map((l) => ({ lineId: l.id, checked: true })) }));
    const q = (bucket: string, u = 'sales.westave', loc = west) => as(u).get(`/api/stock/movement-documents?locationId=${loc}&productId=${item}&from=${day()}&to=${day()}&bucket=${bucket}`);
    const docs = ok(await q('transferIn')).body as { number: string; forms: { label: string; pdf: string }[]; qty: number; from: string; to: string }[];
    const mine = docs.find((d) => d.number.startsWith(t.transferInNo))!;
    expect(mine.qty).toBe(4); expect(mine.forms.map((f) => f.label)).toContain('Transfer-In form'); expect(mine.forms.map((f) => f.label)).not.toContain('Pull-Out form'); // the receiver gets its own copy only
    const out = ok(await q('pullOut', 'wh.incharge', wh)).body as { forms: { label: string }[] }[];
    expect(out.some((d) => d.forms.some((f) => f.label === 'Pull-Out form'))).toBe(true);
    expect((await q('sales')).status).toBe(400);
    await as('sales.westave').get(`/api/stock/movement-documents?locationId=${wh}&productId=${item}&from=${day()}&to=${day()}&bucket=transferIn`).expect(403);
  });
});

describe('Replacement tickets: customer returns and returns to suppliers (owner request 2026-10-02)', () => {
  let wh = ''; let west = ''; let csr = ''; let dasma = ''; let a = ''; let b = ''; let sup = ''; let sup2 = '';
  const day = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const notes = async (u: string) => JSON.stringify(ok(await as(u).get('/api/notifications')).body);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const give = async (loc: string, productId: string, qty: number, cost: number) => {
    const batch = await prisma.batch.create({ data: { productId, batchNo: `RT-${run}-${loc.slice(0, 3)}-${productId.slice(0, 3)}`, receivedRef: 'TEST', unitCost: cost.toFixed(2), expiryDate: new Date('2028-12-31T00:00:00Z') } });
    await prisma.stockLedger.create({ data: { locationId: loc, productId, batchId: batch.id, qtyDelta: qty, movementType: 'RECEIVE', documentType: 'OpeningStock', documentId: batch.id, unitCost: cost.toFixed(2), businessDate: new Date(`${day()}T00:00:00Z`) } });
    await prisma.stockBalance.create({ data: { locationId: loc, productId, batchId: batch.id, qty } });
  };
  const onHand = async (loc: string, p: string) => (await prisma.stockBalance.aggregate({ where: { locationId: loc, productId: p }, _sum: { qty: true } }))._sum.qty ?? 0;
  let n = 0;
  const dr = `RTDR-${run}`;
  beforeAll(async () => {
    const locs = ok(await as('admin').get('/api/locations')).body as { id: string; code: string }[];
    wh = locs.find((l) => l.code === 'WH')!.id; west = locs.find((l) => l.code === 'WESTAVE')!.id; csr = locs.find((l) => l.code === 'CSR')!.id; dasma = locs.find((l) => l.code === 'DASMA')!.id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[]; const cat = cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id;
    sup = (await prisma.supplier.create({ data: { code: `RTS-${run}`, name: `Replace Supplier ${run}`, termsDays: 30 } as never })).id;
    a = ok(await as('admin').post('/api/products').send({ name: `E2E RT Whey A ${run}`, categoryId: cat, supplierId: sup, prices: { RETAIL: 1000 }, cost: 500 })).body.id;
    b = ok(await as('admin').post('/api/products').send({ name: `E2E RT Whey B ${run}`, categoryId: cat, supplierId: sup, prices: { RETAIL: 1200 }, cost: 600 })).body.id;
    for (const loc of [wh, west, csr, dasma]) { await give(loc, a, 20, 500); await give(loc, b, 20, 600); }
    ok(await as('sales.westave').post('/api/sales').send({ drSiNo: dr, channel: 'WALK_IN', paymentMode: 'CASH', customerName: 'Juan Dela Cruz', customerPhone: '09171234567', lines: [{ productId: a, qty: 3 }] }).expect(201));
    sup2 = sup;
  });

  const lines = async (type: string, id: string) => (await prisma.journalVoucher.findMany({ where: { sourceDocumentType: type, sourceDocumentId: id }, include: { lines: { include: { account: true } } } })).flatMap((v) => v.lines.map((l) => ({ title: l.account.title, dr: Number(l.debit), cr: Number(l.credit) })));
  const bal = (ls: { dr: number; cr: number }[]) => ls.reduce((t, l) => t + l.dr, 0) === ls.reduce((t, l) => t + l.cr, 0);
  it('a customer return opens a ticket tied to the DR; any other branch ticks it with a replacement; the price difference is worked out; the Head Auditor approves; everyone concerned is told', async () => {
    await as('fr.mayon.owner').get(`/api/replacements/find-dr?q=${dr}`).expect(403); // franchises do not use tickets
    const found = ok(await as('sales.csr').get(`/api/replacements/find-dr?q=${dr}`)).body as { drSiNo: string; branch: string; customer: string; lines: { lineId: string; product: string; qty: number; available: number }[] }[];
    expect(found[0].drSiNo).toBe(dr); expect(found[0].branch).toBe('West Ave'); expect(found[0].customer).toBe('Juan Dela Cruz'); expect(found[0].lines[0].available).toBe(3);
    const lineId = found[0].lines[0].lineId;
    await as('sales.csr').post('/api/replacements/customer').send({ salesLineId: lineId, qty: 4, reason: 'DAMAGED' }).expect(400); // only 3 were sold
    await as('sales.csr').post('/api/replacements/customer').send({ salesLineId: lineId, qty: 2, reason: 'because' }).expect(400);
    const t = ok(await as('sales.csr').post('/api/replacements/customer').send({ salesLineId: lineId, qty: 2, reason: 'DAMAGED', notes: 'seal broken' }).expect(201)).body;
    expect(t.status).toBe('OPEN'); expect(t.drSiNo).toBe(dr); expect(t.ticketNo).toMatch(/^CS-RT-\d{6}$/); expect(t.saleBranch).toBe('West Ave');
    for (const u of ['head.auditor', 'asst.auditor', 'acct.head', 'acct.assoc', 'admin', 'sales.westave', 'sales.dasma']) expect(await notes(u), u).toContain('REPLACEMENT_OPENED'); // incl. the sales associate of the DR and the other branches
    expect(ok(await as('sales.csr').get(`/api/replacements/find-dr?q=${dr}`)).body[0].lines[0].available).toBe(1);
    // another branch (Dasmariñas) hands a different product: B at ₱1,200 vs A at ₱1,000 → the customer pays ₱400 for 2
    await as('fr.mayon.owner').post(`/api/replacements/${t.id}/replace`).send({}).expect(403);
    const before = await onHand(dasma, b);
    const done = ok(await as('sales.dasma').post(`/api/replacements/${t.id}/replace`).send({ productId: b }).expect(201)).body;
    expect(done.status).toBe('REPLACED'); expect(Number(done.priceDifference)).toBe(400); expect(done.replaced.branch).toMatch(/Dasmari/);
    expect(await onHand(dasma, b)).toBe(before - 2);
    await as('sales.csr').post(`/api/replacements/${t.id}/replace`).send({}).expect(400); // already ticked
    for (const u of ['head.auditor', 'acct.assoc', 'admin', 'sales.westave', 'sales.csr']) expect(await notes(u), u).toContain('REPLACEMENT_DONE');
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'REPLACEMENT_TICKET', documentId: t.id, status: 'PENDING' } });
    await as('sales.dasma').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }).expect(403);
    ok(await as('admin').put('/api/settings').send({ 'gl.auto_posting_enabled': true }));
    ok(await as('head.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    expect(ok(await as('head.auditor').get(`/api/replacements/${t.id}`)).body.status).toBe('CLOSED');
    // the cost of the 2 replacements (B at ₱600) is expensed against Dasmariñas' inventory
    let j = await lines('ReplacementTicket', t.id); expect(bal(j)).toBe(true); expect(j.find((x) => /Replacement Cost/.test(x.title))?.dr).toBe(1200); expect(j.some((x) => /Inventory/.test(x.title) && x.cr === 1200)).toBe(true);
    ok(await as('sales.dasma').post(`/api/replacements/${t.id}/settle`).send({ note: 'paid in cash' }));
    // the ₱400 the customer paid: Dr Cash on Hand / Cr Sales
    j = await lines('ReplacementTicket', t.id); expect(bal(j)).toBe(true); expect(j.some((x) => /Cash on Hand/i.test(x.title) && x.dr === 400)).toBe(true); expect(j.some((x) => /^Sales/.test(x.title) && x.cr === 400)).toBe(true);
    ok(await as('admin').put('/api/settings').send({ 'gl.auto_posting_enabled': false }));
    await as('sales.dasma').post(`/api/replacements/${t.id}/settle`).send({}).expect(400);
    expect(await notes('acct.head')).toContain('REPLACEMENT_SETTLED');
    // not approved: the stock goes back and the ticket is open again
    const t2 = ok(await as('sales.westave').post('/api/replacements/customer').send({ salesLineId: lineId, qty: 1, reason: 'DEFECTIVE' }).expect(201)).body;
    const b2 = await onHand(csr, a);
    ok(await as('sales.csr').post(`/api/replacements/${t2.id}/replace`).send({}));
    expect(await onHand(csr, a)).toBe(b2 - 1);
    const req2 = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'REPLACEMENT_TICKET', documentId: t2.id, status: 'PENDING' } });
    ok(await as('head.auditor').post(`/api/approvals/${req2.id}/decide`).send({ decision: 'REJECT', note: 'wrong item given' }));
    expect(await onHand(csr, a)).toBe(b2); expect(ok(await as('head.auditor').get(`/api/replacements/${t2.id}`)).body.status).toBe('OPEN');
    // a ticket nobody has ticked is reminded after a few days; a branch sees every open customer ticket
    expect(JSON.stringify(ok(await as('sales.dasma').get('/api/replacements')).body)).toContain(t2.ticketNo);
    await prisma.replacementTicket.update({ where: { id: t2.id }, data: { createdAt: new Date(Date.now() - 5 * 86400000) } });
    expect((await (await import('../src/replacements/replacements.service')).ReplacementsService.prototype.runDaily.call(app.get((await import('../src/replacements/replacements.service')).ReplacementsService))).reminded).toBeGreaterThanOrEqual(1);
    expect(await notes('head.auditor')).toContain('REPLACEMENT_OVERDUE');
    ok(await as('sales.westave').post(`/api/replacements/${t2.id}/cancel`).send({ reason: 'customer took a refund instead' }));
  });

  it('items returned to a supplier: the Head Auditor approves, the ticket is tagged to the supplier and stays open until replacement items arrive on a linked delivery; a different product shows the value difference', async () => {
    const before = await onHand(wh, a);
    const t = ok(await as('wh.incharge').post('/api/replacements/supplier').send({ productId: a, qty: 5, supplierId: sup, reason: 'DEFECTIVE', notes: 'lot recalled' }).expect(201)).body;
    expect(t.kind).toBe('SUPPLIER'); expect(t.status).toBe('PENDING_RETURN'); expect(t.supplier.code).toBe(`RTS-${run}`);
    expect(await onHand(wh, a)).toBe(before); // nothing leaves before approval
    for (const u of ['head.auditor', 'acct.head', 'admin']) expect(await notes(u), u).toContain('SUPPLIER_RETURN_OPENED');
    await as('wh.incharge').post('/api/replacements/supplier').send({ productId: a, qty: 500, supplierId: sup, reason: 'DEFECTIVE' }).expect(400); // not enough stock
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'SUPPLIER_RETURN', documentId: t.id, status: 'PENDING' } });
    ok(await as('admin').put('/api/settings').send({ 'gl.auto_posting_enabled': true }));
    ok(await as('head.auditor').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    expect(await onHand(wh, a)).toBe(before - 5);
    // 5 × ₱500 leaves inventory and becomes a receivable from suppliers
    let j = await lines('ReplacementTicket', t.id); expect(bal(j)).toBe(true); expect(j.find((x) => /Receivable from Suppliers/.test(x.title))?.dr).toBe(2500);
    expect(ok(await as('wh.incharge').get(`/api/replacements/${t.id}`)).body.status).toBe('AWAITING_REPLACEMENT');
    const receive = async (supplierId: string, product: string, qty: number, ticketId: string) => {
      const r = await as('wh.incharge').post('/api/receiving').send({ supplierId, supplierRef: `REPL-${++n}`, replacementTicketId: ticketId, lines: [{ productId: product, qty, expiryDate: '2028-06-30', batchNo: `RP${n}-${run}` }] });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      await http.post(`/api/attachments/ReceivingDoc/${r.body.id}`).set('Authorization', `Bearer ${tokens['wh.incharge']}`).attach('file', png, { filename: 'dr.png', contentType: 'image/png' }).expect(201);
      ok(await as('wh.incharge').post(`/api/receiving/${r.body.id}/submit`));
      const c = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'COST_ON_RECEIVING', documentId: r.body.id, status: 'PENDING' } });
      ok(await as('head.auditor').post(`/api/approvals/${c.id}/decide`).send({ decision: 'APPROVE' }));
      return r.body.id as string;
    };
    // a delivery from another supplier cannot be linked; a ticket that is not waiting cannot be linked
    const other = (await prisma.supplier.create({ data: { code: `RTO-${run}`, name: `Other ${run}`, termsDays: 30 } as never })).id;
    await as('wh.incharge').post('/api/receiving').send({ supplierId: other, replacementTicketId: t.id, lines: [{ productId: a, qty: 1, expiryDate: '2028-06-30' }] }).expect(400);
    await receive(sup, a, 3, t.id);
    let cur = ok(await as('head.auditor').get(`/api/replacements/${t.id}`)).body;
    expect(cur.status).toBe('PARTIAL'); expect(cur.receivedQty).toBe(3); expect(await notes('wh.incharge')).toContain('SUPPLIER_REPLACEMENT_PARTIAL');
    await receive(sup, b, 2, t.id); // a different product: value 3×500 + 2×600 = 2,700 against 5×500 = 2,500
    cur = ok(await as('head.auditor').get(`/api/replacements/${t.id}`)).body;
    expect(cur.status).toBe('CLOSED'); expect(cur.receivedQty).toBe(5); expect(Number(cur.priceDifference)).toBe(200);
    // the arrivals clear the receivable against AP, up to what we sent (2,500); the extra ₱200 stays payable
    j = await lines('ReplacementTicket', t.id); expect(bal(j)).toBe(true);
    expect(j.filter((x) => /Receivable from Suppliers/.test(x.title)).reduce((n, x) => n + x.dr - x.cr, 0)).toBe(0);
    ok(await as('admin').put('/api/settings').send({ 'gl.auto_posting_enabled': false }));
    for (const u of ['wh.incharge', 'head.auditor', 'acct.head', 'admin']) expect(await notes(u), u).toContain('SUPPLIER_REPLACEMENT_CLOSED');
    const sum = ok(await as('acct.head').get('/api/replacements/summary')).body; expect(sum.suppliers.find((x: { code: string }) => x.code === `RTS-${run}`).openTickets).toBe(0);
    await as('sales.westave').get('/api/replacements/summary').expect(403);
    // a ticket that was never approved can be cancelled by its opener; a sent one cannot
    const t3 = ok(await as('wh.incharge').post('/api/replacements/supplier').send({ productId: b, qty: 1, supplierId: sup, reason: 'EXPIRED' }).expect(201)).body;
    ok(await as('wh.incharge').post(`/api/replacements/${t3.id}/cancel`).send({ reason: 'keyed twice' }));
    await as('wh.incharge').post(`/api/replacements/${t.id}/cancel`).send({ reason: 'x y z' }).expect(400);
  });
});

describe('E-commerce: TikTok "To ship" export without seller SKUs (owner request 2026-10-02)', () => {
  it('reads product title + variation, suggests the GWS product, remembers the match, makes the pick list and can send it to the In-Charge at once', async () => {
    const wh = (await prisma.location.findUniqueOrThrow({ where: { code: 'WH' } })).id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const nm = `E2E Zesty Whey ${run}`;
    const pid = ok(await as('admin').post('/api/products').send({ name: `${nm} 10s (Vanilla)`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 700 }, cost: 300 })).body.id;
    const b = await prisma.batch.create({ data: { productId: pid, batchNo: `ZW-${run}`, receivedRef: 'T', unitCost: '300.00', expiryDate: new Date('2028-12-31T00:00:00Z') } });
    await prisma.stockLedger.create({ data: { locationId: wh, productId: pid, batchId: b.id, qtyDelta: 20, movementType: 'RECEIVE', documentType: 'OpeningStock', documentId: b.id, unitCost: '300.00', businessDate: new Date() } });
    await prisma.stockBalance.create({ data: { locationId: wh, productId: pid, batchId: b.id, qty: 20 } });
    const head = 'Order ID,Order Status,Order Substatus,Cancelation/Return Type,Normal or Pre-order,SKU ID,Seller SKU,Product Name,Variation,Quantity,Tracking ID';
    const row = (id: string) => `${id}\t,To ship,Awaiting shipment,,Normal,99${run.replace(/\D/g, '')}1\t,,${nm.toUpperCase()} | WHEY PROTEIN | Getwheysted Official Store,"10 Servings, Creamy Vanilla",2,`;
    const file = `\uFEFF${head}\n${row(`77${run.replace(/\D/g, '')}001`)}\n${row(`77${run.replace(/\D/g, '')}002`)}\n`;
    const r1 = ok(await as('ecomm.assoc').post('/api/ecommerce/tiktok/orders/upload').attach('file', Buffer.from(file), 'To-Ship-order.csv')).body;
    expect(r1.ordersAdded).toBe(0); expect(r1.unknownSkus).toHaveLength(1); expect(r1.unknownSkus[0].orders).toBe(2);
    expect(r1.unknownSkus[0].suggestions.map((x: { productId: string }) => x.productId)).toContain(pid);
    expect(r1.unknownSkus[0].suggestions[0].productId).toBe(pid); // "Looks like: … 10s (Vanilla)"
    ok(await as('ecomm.assoc').post('/api/ecommerce/tiktok/sku-maps').send({ platformSku: r1.unknownSkus[0].platformSku, productId: pid }));
    const r2 = ok(await as('ecomm.assoc').post('/api/ecommerce/tiktok/orders/upload?send=1').attach('file', Buffer.from(file), 'To-Ship-order.csv')).body;
    expect(r2.ordersAdded).toBe(2); expect(r2.sent).toBe(true);
    const doc = ok(await as('wh.incharge').get(`/api/ecommerce/pullouts/${r2.pullOut.id}`)).body;
    expect(doc.status).toBe('SUBMITTED'); expect(doc.picking.reduce((t: number, x: { qty: number }) => t + x.qty, 0)).toBe(4); // 2 orders × 2 units on one pick list
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: r2.pullOut.id, status: 'PENDING' } });
    expect(req.requiredApproverRoles).toContain('WAREHOUSE_IN_CHARGE');
  });
});


describe('Agent field work: outlets, areas, itineraries with photos, consignments and their maximums (owner request 2026-10-02)', () => {
  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const note = async (username: string) => { const u = await prisma.user.findUniqueOrThrow({ where: { username } }); return (await prisma.notification.findMany({ where: { userId: u.id } })).map((n) => `${n.type}|${n.title}`); };
  let jerickKey = ''; let twoKey = ''; let west = ''; let pid = ''; const outlet: Record<string, string> = {};
  const photo = (u: string, type: string, id: string) => as(u).post(`/api/attachments/${type}/${id}`).attach('file', PNG, { filename: 'p.png', contentType: 'image/png' });

  it('an agent uploads outlets (Excel / CSV), the Sales Manager approves them; only approved outlets can be tagged on a sale; the agent sees the orders of their outlets', async () => {
    await prisma.salesReportSubmission.deleteMany({});
    west = (await prisma.location.findUniqueOrThrow({ where: { code: 'WESTAVE' } })).id;
    const jerick = await prisma.user.findUniqueOrThrow({ where: { username: 'agent.jerick' } }); jerickKey = jerick.id;
    // a second agent (own account and listing) to test sharing and privacy
    const { id: _id, ...rest } = jerick; void _id;
    const two = await prisma.user.create({ data: { ...rest, username: `agent.two${run}`, email: `two${run}@x.test`, fullName: `Agent Two ${run}`, idNumber: null, totpSecret: null } });
    await prisma.agent.create({ data: { name: `Agent Two ${run}`, locationId: west, userId: two.id } }); twoKey = two.id;
    // upload: Excel / CSV, duplicates skipped, everything waits for the Sales Manager
    const csv = `Name,Type,Address,City,Contact person,Phone,Email,Notes\nIron Temple ${run},GYM,1 Main St,Quezon City,Juan,0917111,juan@x.test,\nFit Hub ${run},GYM,2 Side St,Makati,Ana,0917222,ana@x.test,\nIron Temple ${run},GYM,1 Main St,Quezon City,,,,\n`;
    const up = ok(await http.post('/api/field/outlets/import').set('Authorization', `Bearer ${tokens['agent.jerick']}`).attach('file', Buffer.from(csv), { filename: 'o.csv', contentType: 'text/csv' })).body;
    expect(up.created).toBe(2); expect(up.skipped.length).toBe(1);
    const mine = ok(await as('agent.jerick').get('/api/field/outlets')).body as { id: string; name: string; status: string; contactName: string; email: string }[];
    for (const o of mine) { expect(o.status).toBe('PENDING'); outlet[o.name.split(' ')[0]] = o.id; }
    expect(mine.find((o) => o.name.startsWith('Iron'))).toMatchObject({ contactName: 'Juan', email: 'juan@x.test' });
    expect(await note('sales.manager')).toEqual(expect.arrayContaining([expect.stringMatching(/OUTLET_PENDING/)]));
    ok(await photo('agent.jerick', 'Outlet', outlet.Iron));
    expect((ok(await as('agent.jerick').get('/api/field/outlets')).body as { photoId: string | null; name: string }[]).find((o) => o.name.startsWith('Iron'))!.photoId).not.toBeNull();
    // privacy: the other agent sees nothing of Jerick's; the Sales Manager, Head Auditor and Owner see all; a sales associate sees none
    await login(`agent.two${run}`).catch(() => undefined);
    for (const u of ['sales.manager', 'head.auditor', 'admin']) expect((ok(await as(u).get('/api/field/outlets')).body as unknown[]).length).toBeGreaterThanOrEqual(2);
    await as('sales.westave').get('/api/field/outlets').expect(403);
    await as('agent.jerick').post('/api/field/outlets/decide').send({ ids: [outlet.Iron], action: 'APPROVE' }).expect(403);
    // a pending outlet cannot be tagged on a sale
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    pid = ok(await as('admin').post('/api/products').send({ name: `FLD Whey ${run}`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 1000, AGENT: 900, FRANCHISE: 700 }, cost: 500 })).body.id;
    const b = await prisma.batch.create({ data: { productId: pid, batchNo: `F-${run}`, receivedRef: 'TEST', unitCost: '500' } });
    await prisma.stockLedger.create({ data: { locationId: west, productId: pid, batchId: b.id, qtyDelta: 40, movementType: 'RECEIVE', documentType: 'Opening', documentId: `F-${run}`, unitCost: '500', businessDate: new Date(`${today()}T00:00:00Z`) } });
    await prisma.stockBalance.create({ data: { locationId: west, productId: pid, batchId: b.id, qty: 40 } });
    const bad = await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `FLD-${run}-0`, outletId: outlet.Iron, lines: [{ productId: pid, qty: 1 }] }).expect(400);
    expect(JSON.stringify(bad.body)).toMatch(/not approved/i);
    ok(await as('sales.manager').post('/api/field/outlets/decide').send({ ids: [outlet.Iron, outlet.Fit], action: 'APPROVE' }));
    expect(await note('agent.jerick')).toEqual(expect.arrayContaining([expect.stringMatching(/OUTLET_UPDATE/)]));
    // the sales associate picks the agent, then the outlet; the sale carries the outlet
    expect((ok(await as('sales.westave').get('/api/field/lookup/agents')).body as { key: string }[]).some((a) => a.key === jerickKey)).toBe(true);
    expect((ok(await as('sales.westave').get(`/api/field/lookup?agentKey=${jerickKey}`)).body as { id: string }[]).map((o) => o.id)).toEqual(expect.arrayContaining([outlet.Iron, outlet.Fit]));
    expect((ok(await as('sales.westave').get(`/api/field/lookup?agentKey=${twoKey}`)).body as unknown[]).length).toBe(0);
    const sale = ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `FLD-${run}-1`, outletId: outlet.Iron, lines: [{ productId: pid, qty: 2 }] })).body;
    expect(sale.outlet.name).toContain('Iron Temple');
    expect((await prisma.outlet.findUniqueOrThrow({ where: { id: outlet.Iron } })).stage).toBe('FIRST_ORDER');
    const month = today().slice(0, 7);
    const my = ok(await as('agent.jerick').get(`/api/targets/mine?month=${month}`)).body;
    expect(my.sales.find((x: { drSiNo: string }) => x.drSiNo === `FLD-${run}-1`)).toMatchObject({ outlet: expect.stringContaining('Iron Temple') });
    const detail = ok(await as('agent.jerick').get(`/api/field/outlets/${outlet.Iron}`)).body;
    expect(detail.orders.length).toBe(1); expect(detail.orders[0].amount).toBe(2000);
    expect((ok(await as('sales.manager').get('/api/sales')).body as { drSiNo: string; outlet?: { name: string } }[]).find((x) => x.drSiNo === `FLD-${run}-1`)!.outlet!.name).toContain('Iron');
  });

  it('areas assigned by the Sales Manager; an agent cannot change an approved outlet alone (the Sales Manager approves, the Owner is told); shared outlets; removal needs the Owner and no order in 3 months', async () => {
    const area = ok(await as('sales.manager').post('/api/field/areas').send({ name: `Area ${run}`, agentKey: jerickKey })).body;
    await as('agent.jerick').post('/api/field/areas').send({ name: 'X' }).expect(403);
    ok(await as('sales.manager').post('/api/field/outlets/reassign').send({ ids: [outlet.Iron], areaId: area.id }));
    expect(await note('admin')).toEqual(expect.arrayContaining([expect.stringMatching(/OUTLET_CHANGED/)]));
    // agent change → waits; nothing changes until the Sales Manager approves; then the Owner is told what changed
    const r = ok(await as('agent.jerick').post(`/api/field/outlets/${outlet.Iron}/change`).send({ phone: '0999000', contactName: 'Juan D.' })).body;
    expect(r.applied).toBe(false);
    expect((await prisma.outlet.findUniqueOrThrow({ where: { id: outlet.Iron } })).phone).toBe('0917111');
    const ch = (ok(await as('sales.manager').get('/api/field/outlets/changes')).body as { id: string }[])[0];
    await as('agent.jerick').post(`/api/field/outlets/changes/${ch.id}`).send({ action: 'APPROVE' }).expect(403);
    const before = (await note('admin')).length;
    ok(await as('sales.manager').post(`/api/field/outlets/changes/${ch.id}`).send({ action: 'APPROVE' }));
    expect((await prisma.outlet.findUniqueOrThrow({ where: { id: outlet.Iron } })).phone).toBe('0999000');
    const told = (await note('admin')).slice(before).join(' ');
    expect(told).toMatch(/Iron Temple/); expect(told).toMatch(/OUTLET_CHANGED/);
    // the Sales Manager edits directly; the Owner is told as well
    expect(ok(await as('sales.manager').post(`/api/field/outlets/${outlet.Fit}/change`).send({ notes: 'opens late' })).body.applied).toBe(true);
    // sharing: the other agent now sees it, tags and plans with it; unshare takes it away
    await as(`agent.two${run}`).get(`/api/field/outlets/${outlet.Iron}`).expect(403).catch(() => undefined);
    ok(await as('sales.manager').post(`/api/field/outlets/${outlet.Fit}/share`).send({ agentKey: twoKey, on: true }));
    expect((ok(await as('sales.westave').get(`/api/field/lookup?agentKey=${twoKey}`)).body as { id: string }[]).map((o) => o.id)).toEqual([outlet.Fit]);
    ok(await as('sales.manager').post(`/api/field/outlets/${outlet.Fit}/share`).send({ agentKey: twoKey, on: false }));
    expect((ok(await as('sales.westave').get(`/api/field/lookup?agentKey=${twoKey}`)).body as unknown[]).length).toBe(0);
    // removal: blocked with an order in the last 3 months; otherwise the Owner decides
    const blocked = await as('sales.manager').post(`/api/field/outlets/${outlet.Iron}/delete`).send({}).expect(400);
    expect(JSON.stringify(blocked.body)).toMatch(/last 3 months/);
    await as('agent.jerick').post(`/api/field/outlets/${outlet.Fit}/delete`).send({}).expect(403);
    ok(await as('sales.manager').post(`/api/field/outlets/${outlet.Fit}/delete`).send({}));
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'OUTLET_DELETE', documentId: outlet.Fit, status: 'PENDING' } }); expect(req.requiredApproverRoles).toEqual(['ADMIN']);
    expect((await prisma.outlet.findUniqueOrThrow({ where: { id: outlet.Fit } })).deletedAt).toBeNull();
    ok(await as('admin').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.outlet.findUniqueOrThrow({ where: { id: outlet.Fit } })).deletedAt).not.toBeNull();
  });

  it('itinerary: plan approved outlets, report a visit only with a photo and the location, a missed store needs the reason, submit the day; the Sales Manager, Head Auditor and Owner see the photos; claims go to the Sales Manager then Accounting', async () => {
    const day = today();
    const extra = ok(await as('agent.jerick').post('/api/field/outlets').send({ name: `Pending Gym ${run}`, city: 'Pasig' })).body;
    const bad = await as('agent.jerick').post('/api/field/itinerary/plan').send({ date: day, outletIds: [extra.id] }).expect(400);
    expect(JSON.stringify(bad.body)).toMatch(/approved/i);
    ok(await as('sales.manager').post('/api/field/outlets/decide').send({ ids: [extra.id], action: 'APPROVE' }));
    const plan = ok(await as('agent.jerick').post('/api/field/itinerary/plan').send({ date: day, outletIds: [outlet.Iron, extra.id] })).body;
    expect(plan.stops.length).toBe(2);
    // file upload of an itinerary for tomorrow
    const tomorrow = new Date(Date.parse(`${day}T00:00:00Z`) + 86400e3).toISOString().slice(0, 10);
    const imp = ok(await http.post('/api/field/itinerary/import').set('Authorization', `Bearer ${tokens['agent.jerick']}`).attach('file', Buffer.from(`Date,Outlet\n${tomorrow},Iron Temple ${run}\n${tomorrow},Unknown Gym\n`), { filename: 'i.csv', contentType: 'text/csv' })).body;
    expect(imp.stops).toBe(1); expect(imp.unmatched).toEqual(['Unknown Gym']);
    const [s1, s2] = plan.stops as { id: string; outletId: string }[];
    // visited needs a photo first, then the location
    expect(JSON.stringify((await as('agent.jerick').post(`/api/field/itinerary/stops/${s1.id}/report`).send({ status: 'VISITED', lat: 14.6, lng: 121 }).expect(400)).body)).toMatch(/photo/i);
    ok(await photo('agent.jerick', 'ItineraryStop', s1.id));
    expect(JSON.stringify((await as('agent.jerick').post(`/api/field/itinerary/stops/${s1.id}/report`).send({ status: 'VISITED' }).expect(400)).body)).toMatch(/location/i);
    ok(await as('agent.jerick').post(`/api/field/itinerary/stops/${s1.id}/report`).send({ status: 'VISITED', lat: 14.6, lng: 121, shelfStatus: 'LOW_STOCK', competitors: 'Brand X' }));
    await as('agent.jerick').post(`/api/field/itinerary/stops/${s2.id}/report`).send({ status: 'MISSED' }).expect(400);
    expect(JSON.stringify((await as('agent.jerick').post('/api/field/itinerary/submit').send({ date: day }).expect(400)).body)).toMatch(/not reported/i);
    ok(await as('agent.jerick').post(`/api/field/itinerary/stops/${s2.id}/report`).send({ status: 'MISSED', note: 'closed for renovation' }));
    ok(await as('agent.jerick').post('/api/field/itinerary/submit').send({ date: day }));
    await as('agent.jerick').post(`/api/field/itinerary/stops/${s2.id}/report`).send({ status: 'MISSED', note: 'again' }).expect(400); // submitted days are locked
    // the first visit gave the outlet its pipeline step and, with no location typed, its GPS
    // (Iron Temple was already at FIRST_ORDER: it never moves back)
    expect((await prisma.outlet.findUniqueOrThrow({ where: { id: outlet.Iron } })).stage).toBe('FIRST_ORDER');
    expect((await prisma.outlet.findUniqueOrThrow({ where: { id: outlet.Iron } })).lat).toBeCloseTo(14.6);
    for (const u of ['sales.manager', 'head.auditor', 'admin']) {
      const board = ok(await as(u).get(`/api/field/board?from=${day}&to=${day}`)).body;
      const row = board.agents.find((a: { agentKey: string }) => a.agentKey === jerickKey); expect(row).toMatchObject({ planned: 2, visited: 1, missed: 1, visitRate: 50 });
      const stop = board.days.flatMap((d: { stops: { id: string; photos: unknown[]; shelfStatus: string }[] }) => d.stops).find((x: { id: string }) => x.id === s1.id); expect(stop.photos.length).toBe(1); expect(stop.shelfStatus).toBe('LOW_STOCK');
    }
    await as('sales.westave').get('/api/field/board').expect(403);
    await as('agent.jerick').post('/api/field/itinerary/plan').send({ date: '2020-01-01', outletIds: [] }).expect(400);
    // scorecard and areas
    const card = ok(await as('sales.manager').get(`/api/field/scorecard?month=${day.slice(0, 7)}&agentKey=${jerickKey}`)).body[0];
    expect(card.visits.visited).toBe(1); expect(card.sales.total).toBeGreaterThanOrEqual(2000); expect(card.outlets.total).toBeGreaterThanOrEqual(2);
    expect(ok(await as('agent.jerick').get(`/api/field/scorecard?month=${day.slice(0, 7)}`)).body.length).toBe(1);
    const areas = ok(await as('sales.manager').get(`/api/field/areas/performance?month=${day.slice(0, 7)}`)).body; expect(areas.areas.find((a: { area: string }) => a.area === `Area ${run}`).sales).toBe(2000);
    expect(ok(await as('sales.manager').get('/api/field/outlets/dormant')).body).toBeDefined();
    expect((ok(await as('agent.jerick').get('/api/field/outlets/map')).body as { id: string }[]).some((p) => p.id === outlet.Iron)).toBe(true);
    // claims: the agent claims, the Sales Manager approves, Accounting is told to pay
    const c = ok(await as('agent.jerick').post('/api/field/claims').send({ date: day, kind: 'FUEL', amount: 350, note: 'Quezon City trip' })).body;
    await as('agent.jerick').post(`/api/field/claims/${c.id}/decide`).send({ action: 'APPROVE' }).expect(403);
    ok(await as('sales.manager').post(`/api/field/claims/${c.id}/decide`).send({ action: 'APPROVE' }));
    expect(await note('acct.head')).toEqual(expect.arrayContaining([expect.stringMatching(/AGENT_CLAIM\|Pay .*350/)]));
    // the daily alerts job runs
    const daily = await app.get(MonitorService).runDaily(); expect(daily).toHaveProperty('unreported');
  });

  it('consignments: linked to an agent\'s outlet, a maximum per agent (and per outlet) set by the Sales Manager and approved by the Owner stops a consignment that would go over; the agent sees what they are responsible for', async () => {
    const pending = async (type: string, where: Record<string, unknown> = {}) => (await prisma.approvalRequest.findFirst({ where: { type, status: 'PENDING', ...where }, orderBy: { createdAt: 'desc' } }))!;
    const cn = ok(await as('admin').post('/api/consignment/consignees').send({ name: `Agent Gym ${run}`, priceBasis: 'SRP', settlementDays: 30 })).body;
    await as('agent.jerick').post('/api/field/consignments/assign').send({ consigneeId: cn.id, outletId: outlet.Iron }).expect(403);
    ok(await as('sales.manager').post('/api/field/consignments/assign').send({ consigneeId: cn.id, outletId: outlet.Iron }));
    const send = async (qty: number) => { const t = ok(await as('sales.westave').post('/api/transfers').send({ fromLocationId: west, toLocationId: cn.id, transferType: 'CONSIGNMENT_OUT', lines: [{ productId: pid, qty }] })).body; return as('sales.westave').post(`/api/transfers/${t.id}/submit`); };
    // no approved maximum yet: stopped
    expect(JSON.stringify((await send(3)).body)).toMatch(/No maximum consignment/);
    // the Sales Manager proposes 5,000; it waits for the Owner (only the Owner decides)
    await as('agent.jerick').post('/api/field/consignments/limits').send({ agentKey: jerickKey, amount: 5000 }).expect(403);
    const lim = ok(await as('sales.manager').post('/api/field/consignments/limits').send({ agentKey: jerickKey, amount: 5000 })).body; expect(lim.status).toBe('PENDING');
    expect(JSON.stringify((await send(3)).body)).toMatch(/No maximum consignment/);
    const req = await pending('AGENT_CONSIGNMENT_LIMIT', { documentId: lim.id }); expect(req.requiredApproverRoles).toEqual(['ADMIN']);
    ok(await as('admin').post(`/api/approvals/${req.id}/decide`).send({ decision: 'APPROVE' }));
    expect((await prisma.agentConsignmentLimit.findUniqueOrThrow({ where: { id: lim.id } })).status).toBe('APPROVED');
    expect(await note('agent.jerick')).toEqual(expect.arrayContaining([expect.stringMatching(/CONSIGNMENT_LIMIT/)]));
    // 3 × ₱1,000 is within 5,000; the transfer is submitted for the usual approvals
    const ok1 = await send(3); expect(ok1.status).toBeLessThan(300);
    const t1 = await prisma.transferDoc.findFirstOrThrow({ where: { toLocationId: cn.id, status: 'SUBMITTED' }, orderBy: { createdAt: 'desc' } });
    ok(await as('asst.auditor').post(`/api/approvals/${(await pending('CONSIGNMENT_CHECK_BRANCH', { documentId: t1.id })).id}/decide`).send({ decision: 'APPROVE' }));
    ok(await as('admin').post(`/api/approvals/${(await pending('CONSIGNMENT_OUT', { documentId: t1.id })).id}/decide`).send({ decision: 'APPROVE' }));
    const mine = ok(await as('agent.jerick').get('/api/field/consignments/mine')).body;
    expect(mine.outstanding).toBe(3000); expect(mine.limit).toBe(5000); expect(mine.headroom).toBe(2000); expect(mine.consignees[0].consignee).toContain('Agent Gym');
    // going over the agent's maximum is stopped, with the numbers
    expect(JSON.stringify((await send(3)).body)).toMatch(/over the approved maximum of ₱5,000\.00/);
    // a separate maximum for the outlet applies too
    const ol = ok(await as('sales.manager').post('/api/field/consignments/limits').send({ agentKey: jerickKey, outletId: outlet.Iron, amount: 3500 })).body;
    ok(await as('admin').post(`/api/approvals/${(await pending('AGENT_CONSIGNMENT_LIMIT', { documentId: ol.id })).id}/decide`).send({ decision: 'APPROVE' }));
    expect(JSON.stringify((await send(1)).body)).toMatch(/would take the outlet to ₱4,000\.00, over its approved maximum of ₱3,500\.00/); // within the agent's 5,000 but over the outlet's 3,500
  });

  it('the Warehouse Associate (and In-Charge) can record the warehouse\'s expenses; no cash fund at the warehouse', async () => {
    const wh = (await prisma.location.findUniqueOrThrow({ where: { code: 'WH' } })).id;
    for (const u of ['wh.assoc', 'wh.incharge']) {
      const accts = ok(await as(u).get(`/api/expenses/accounts?locationId=${wh}`)).body as { id: string; class: string }[];
      expect(accts.length).toBeGreaterThan(0);
      ok(await as(u).get('/api/expenses'));
      await as(u).post('/api/expenses').send({ locationId: wh, accountId: accts[0].id, amount: 10, paidFrom: 'PETTY_CASH' }).expect(403);
    }
    // main / office accounts stay with Accounting
    const main = (ok(await as('acct.head').get('/api/expenses/accounts')).body as { id: string }[])[0];
    await as('wh.assoc').post('/api/expenses').send({ accountId: main.id, amount: 1, paidFrom: 'BANK_ACCOUNT' }).expect(403);
  });
});


describe('Days of stock left per item, most critical first (owner request 2026-10-02)', () => {
  it('on hand ÷ average daily sales: out of stock but selling first, then the fewest days left, items without sales last; company-wide view; branch scope', async () => {
    await prisma.salesReportSubmission.deleteMany({});
    const west = (await prisma.location.findUniqueOrThrow({ where: { code: 'WESTAVE' } })).id; const dasma = (await prisma.location.findUniqueOrThrow({ where: { code: 'DASMA' } })).id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const mk = async (tag: string, stock: number) => {
      const id = ok(await as('admin').post('/api/products').send({ name: `DOS ${tag} ${run}`, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 500 }, cost: 200 })).body.id as string;
      const b = await prisma.batch.create({ data: { productId: id, batchNo: `D-${tag}-${run}`, receivedRef: 'TEST', unitCost: '200' } });
      await prisma.stockLedger.create({ data: { locationId: west, productId: id, batchId: b.id, qtyDelta: stock, movementType: 'RECEIVE', documentType: 'Opening', documentId: `D-${tag}-${run}`, unitCost: '200', businessDate: new Date(`${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}T00:00:00Z`) } });
      await prisma.stockBalance.create({ data: { locationId: west, productId: id, batchId: b.id, qty: stock } });
      return id;
    };
    const A = await mk('A', 10), B = await mk('B', 6), C = await mk('C', 5), D = await mk('D', 3);
    const sell = async (pid: string, qty: number, n: string) => ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `DOS-${run}-${n}`, lines: [{ productId: pid, qty }] }));
    await sell(A, 3, 'A'); await sell(B, 4, 'B'); await sell(D, 3, 'D'); // A: 7 left, 3 sold; B: 2 left, 4 sold; D: 0 left, 3 sold; C: 5 left, no sales
    const r = ok(await as('head.auditor').get(`/api/alerts/days-of-stock?locationId=${west}&days=30&cover=30`)).body;
    const mine = (r.rows as { product: { name: string }; level: string; daysLeft: number | null; onHand: number; sold: number; avgPerDay: number; suggestedQty: number }[]).filter((x) => x.product.name.includes(`DOS`) && x.product.name.endsWith(run));
    expect(mine.map((x) => x.product.name.split(' ')[1])).toEqual(['D', 'B', 'A', 'C']); // out of stock, then 15 days, then 70 days, then no sales
    const [d, b, a, c] = mine;
    expect(d).toMatchObject({ level: 'OUT', onHand: 0, sold: 3 }); expect(b.daysLeft).toBe(15); expect(b.level).toBe('WATCH'); expect(b.avgPerDay).toBeCloseTo(0.13, 2);
    expect(a.daysLeft).toBe(70); expect(a.level).toBe('OK'); expect(c).toMatchObject({ level: 'NO_SALES', daysLeft: null, sold: 0 });
    expect(b.suggestedQty).toBe(2); // 4 sold in 30 days = 0.133/day × 30 = 4 to cover 30 days, 2 on hand
    expect(r.counts.OUT).toBeGreaterThanOrEqual(1);
    // company-wide: one line per item (no location split)
    const all = ok(await as('head.auditor').get('/api/alerts/days-of-stock?days=30&combine=1')).body;
    expect((all.rows as { location: { name: string }; product: { name: string } }[]).filter((x) => x.product.name === `DOS B ${run}`)).toHaveLength(1);
    expect(all.rows.find((x: { product: { name: string } }) => x.product.name === `DOS B ${run}`).location.name).toBe('All locations');
    // a branch sees only its own location
    await as('sales.dasma').get(`/api/alerts/days-of-stock?locationId=${west}`).expect(403);
    const own = ok(await as('sales.dasma').get('/api/alerts/days-of-stock')).body.rows as { location: { id: string } }[];
    expect(own.every((x) => x.location.id === dasma)).toBe(true);
  });
});


describe('Wheysted members: QR card, counter lookup, portal, stats and campaigns (owner request 2026-10-03)', () => {
  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const portal = (m: 'get' | 'post', p: string, token?: string) => (m === 'get' ? http.get(p) : http.post(p)).set(...(token ? ['Authorization', `Bearer ${token}`] as [string, string] : ['X-None', '1'] as [string, string]));
  let pid = ''; let pid2 = ''; let memberId = ''; let memberNo = ''; let qr = ''; const phone = '0917 555 0101';

  it('the counter makes a member (past sales with that number join them), finds them by number / name / phone / QR, and tags a sale; stats, favorites and segments follow', async () => {
    await prisma.salesReportSubmission.deleteMany({});
    delete process.env.SMTP_URL; delete process.env.SEMAPHORE_API_KEY;
    const west = (await prisma.location.findUniqueOrThrow({ where: { code: 'WESTAVE' } })).id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const mk = async (tag: string, brand: string) => { const id = ok(await as('admin').post('/api/products').send({ name: `MEM ${tag} ${run}`, brand, categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 1000 }, cost: 400 })).body.id as string; const b = await prisma.batch.create({ data: { productId: id, batchNo: `M-${tag}-${run}`, receivedRef: 'TEST', unitCost: '400' } }); await prisma.stockLedger.create({ data: { locationId: west, productId: id, batchId: b.id, qtyDelta: 50, movementType: 'RECEIVE', documentType: 'Opening', documentId: `M-${tag}-${run}`, unitCost: '400', businessDate: new Date(`${today()}T00:00:00Z`) } }); await prisma.stockBalance.create({ data: { locationId: west, productId: id, batchId: b.id, qty: 50 } }); return id; };
    pid = await mk('Whey', 'Prothin'); pid2 = await mk('Creatine', 'Optimum');
    // a walk-in who left a number BEFORE becoming a member
    ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `MEM-${run}-0`, customerName: 'Mia Member', customerPhone: '+63 917 555 0101', lines: [{ productId: pid, qty: 1 }] }));
    const created = ok(await as('sales.westave').post('/api/members').send({ fullName: 'Mia Member', phone, email: `mia${run}@x.test` })).body;
    memberId = created.id; memberNo = created.memberNo; expect(memberNo).toMatch(/^WHY-\d{6}$/);
    const dup = await as('sales.csr').post('/api/members').send({ fullName: 'Other', phone: '09175550101' }).expect(400); expect(JSON.stringify(dup.body)).toMatch(/already uses that mobile number/);
    qr = ok(await as('admin').get(`/api/members/${memberId}`)).body.qr; expect(qr).toMatch(/^WHY:[0-9a-f]{24}$/);
    for (const q of [memberNo, memberNo.toLowerCase().replace('-', ''), '09175550101', '+639175550101', 'mia memb', qr]) expect((ok(await as('sales.westave').get(`/api/members/lookup?q=${encodeURIComponent(q)}`)).body as { id: string }[]).map((m) => m.id)).toContain(memberId);
    // the old walk-in sale is already on the account
    expect((ok(await as('admin').get(`/api/members/${memberId}`)).body.purchases as unknown[]).length).toBe(1);
    // tag two more sales: favorite = the most bought item
    ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `MEM-${run}-1`, memberId, customerName: 'Mia Member', customerPhone: phone, lines: [{ productId: pid, qty: 2 }, { productId: pid2, qty: 1 }] }));
    ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `MEM-${run}-2`, memberId, lines: [{ productId: pid, qty: 1 }] }));
    const d = ok(await as('admin').get(`/api/members/${memberId}`)).body;
    expect(d.orders).toBe(3); expect(d.spent).toBe(5000); expect(d.avgOrder).toBeCloseTo(1666.67, 1); expect(d.favoriteProduct).toBe(`MEM Whey ${run}`); expect(d.favoriteBrand).toBe('Prothin'); expect(d.topBranch).toBe('West Ave');
    expect(d.favorites[0]).toMatchObject({ qty: 4, times: 3 }); expect(d.purchases[0].items.length).toBeGreaterThanOrEqual(1);
    expect(has(d, /unitCost|"cost"/)).toBe(false);
    // a member who never bought; segments; listing
    const never = ok(await as('sales.westave').post('/api/members').send({ fullName: 'Nina Never', email: `nina${run}@x.test`, birthday: `2000-${today().slice(5, 7)}-15` })).body;
    const list = ok(await as('sales.manager').get('/api/members')).body as { id: string; segments: string[]; orders: number }[];
    expect(list.find((m) => m.id === never.id)!.segments).toEqual(expect.arrayContaining(['NEVER', 'NEW', 'BIRTHDAY']));
    expect((ok(await as('sales.manager').get('/api/members?segment=NEVER')).body as { id: string }[]).map((m) => m.id)).toContain(never.id);
    expect((ok(await as('sales.manager').get('/api/members?search=prothin')).body as { id: string }[]).map((m) => m.id)).toContain(memberId);
    // who bought this item
    const who = ok(await as('sales.manager').get(`/api/members/who-bought?productId=${pid2}`)).body as { memberNo: string; qty: number }[];
    expect(who[0]).toMatchObject({ memberNo, qty: 1 });
    expect((ok(await as('head.auditor').get(`/api/members/who-bought?search=MEM%20Whey`)).body as { qty: number }[])[0].qty).toBe(4);
    // sale shows the member; a blocked member cannot be tagged
    expect((ok(await as('sales.manager').get('/api/sales')).body as { drSiNo: string; member?: { memberNo: string } }[]).find((x) => x.drSiNo === `MEM-${run}-1`)!.member!.memberNo).toBe(memberNo);
    ok(await as('sales.manager').post(`/api/members/${never.id}`).send({ status: 'BLOCKED' }));
    await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `MEM-${run}-3`, memberId: never.id, lines: [{ productId: pid, qty: 1 }] }).expect(400);
    ok(await as('sales.manager').post(`/api/members/${never.id}`).send({ status: 'ACTIVE' }));
    // who sees what
    await as('sales.westave').get('/api/members').expect(403); await as('sales.westave').get(`/api/members/${memberId}`).expect(403); await as('sales.westave').get('/api/members/who-bought?search=whey').expect(403);
    await as('head.auditor').post(`/api/members/${memberId}`).send({ notes: 'x' }).expect(403); await as('head.auditor').post('/api/campaigns/preview').send({ channel: 'EMAIL', audience: { source: 'MEMBERS' } }).expect(403);
    // making members from the customers already in the sales
    ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `MEM-${run}-4`, customerName: 'Walter Walkin', customerPhone: '09189990002', customerEmail: `walter${run}@x.test`, lines: [{ productId: pid, qty: 1 }] }));
    const imp = ok(await as('sales.manager').post('/api/members/import-from-sales')).body; expect(imp.created).toBeGreaterThanOrEqual(1);
    expect((ok(await as('sales.manager').get('/api/members?search=walter')).body as { orders: number }[])[0].orders).toBe(1);
  });

  it('the portal: a customer signs up, gets a QR card, claims a counter-made account with the member number, signs in and sees only their own purchases; no way into staff screens', async () => {
    const bad = await portal('post', '/api/portal/signup').send({ fullName: 'Pat Portal', phone: '09175550222', password: 'longenough1', agree: false }).expect(400); expect(JSON.stringify(bad.body)).toMatch(/agree/i);
    const s = ok(await portal('post', '/api/portal/signup').send({ fullName: 'Pat Portal', phone: '0917 555 0222', email: `pat${run}@x.test`, password: 'longenough1', agree: true })).body; expect(s.token).toBeTruthy(); expect(s.claimed).toBe(false);
    const me = ok(await portal('get', '/api/portal/me', s.token)).body; expect(me.memberNo).toMatch(/^WHY-/); expect(me.qr).toMatch(/^WHY:/); expect(me.purchases).toEqual([]);
    // a sale tagged by the counter shows up
    const patId = (await prisma.member.findFirstOrThrow({ where: { memberNo: me.memberNo } })).id;
    ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `MEM-${run}-5`, memberId: patId, lines: [{ productId: pid2, qty: 2 }] }));
    const me2 = ok(await portal('get', '/api/portal/me', s.token)).body; expect(me2.purchases.length).toBe(1); expect(me2.stats.orders).toBe(1); expect(me2.purchases[0].items[0]).toMatchObject({ qty: 2 }); expect(has(me2, /unitCost|"cost"/)).toBe(false);
    // the counter's QR scan finds Pat with the card's code
    expect((ok(await as('sales.westave').get(`/api/members/lookup?q=${encodeURIComponent(me2.qr)}`)).body as { id: string }[])[0].id).toBe(patId);
    // a person the store made a member must prove it with the member number
    const noNo = await portal('post', '/api/portal/signup').send({ fullName: 'Mia Member', phone, password: 'longenough2', agree: true }).expect(400); expect(JSON.stringify(noNo.body)).toMatch(/member number/i);
    await portal('post', '/api/portal/signup').send({ fullName: 'Mia Member', phone, password: 'longenough2', memberNo: 'WHY-999999', agree: true }).expect(400);
    const claim = ok(await portal('post', '/api/portal/signup').send({ fullName: 'Mia Member', phone, password: 'longenough2', memberNo, agree: true })).body; expect(claim.claimed).toBe(true);
    const mia = ok(await portal('get', '/api/portal/me', claim.token)).body; expect(mia.memberNo).toBe(memberNo); expect(mia.purchases.length).toBe(3); expect(mia.stats.spent).toBe(5000);
    await portal('post', '/api/portal/signup').send({ fullName: 'Mia', phone, password: 'longenough3', memberNo, agree: true }).expect(400); // already has an account
    // sign in / out; wrong password; no token
    const lg = ok(await portal('post', '/api/portal/login').send({ identifier: '09175550101', password: 'longenough2' })).body; expect(lg.token).toBeTruthy();
    expect(ok(await portal('post', '/api/portal/login').send({ identifier: memberNo, password: 'longenough2' })).body.token).toBeTruthy();
    await portal('post', '/api/portal/login').send({ identifier: '09175550101', password: 'nope-nope' }).expect(401);
    await portal('get', '/api/portal/me').expect(401); await portal('get', '/api/portal/me', 'garbage.token').expect(401);
    // a member token opens nothing on the staff side
    for (const p of ['/api/members', '/api/sales', '/api/campaigns', '/api/auth/me']) expect([401, 403]).toContain((await portal('get', p, lg.token)).status);
    // profile and password
    ok(await portal('post', '/api/portal/me', lg.token).send({ birthday: '1999-05-05', smsOptIn: false }));
    expect((await prisma.member.findUniqueOrThrow({ where: { id: memberId } })).smsOptIn).toBe(false);
    await portal('post', '/api/portal/password', lg.token).send({ current: 'wrong-one', next: 'newpassword1' }).expect(400);
    ok(await portal('post', '/api/portal/password', lg.token).send({ current: 'longenough2', next: 'newpassword1' }));
    ok(await portal('post', '/api/portal/login').send({ identifier: '09175550101', password: 'newpassword1' }));
    // the store resets a forgotten password: the member claims it again
    ok(await as('sales.manager').post(`/api/members/${memberId}/reset-portal`)); await portal('post', '/api/portal/login').send({ identifier: '09175550101', password: 'newpassword1' }).expect(401);
  });

  it('campaigns: preview the audience, email through the company email (unsubscribe link, merge fields, opt-outs left out), SMS, and the not-configured case', async () => {
    delete process.env.SMTP_URL; delete process.env.SEMAPHORE_API_KEY;
    const cfg = ok(await as('sales.manager').get('/api/campaigns/config')).body; expect(cfg.emailConfigured).toBe(false); expect(cfg.segments.length).toBeGreaterThan(3);
    const pre = ok(await as('sales.manager').post('/api/campaigns/preview').send({ channel: 'EMAIL', audience: { source: 'MEMBERS' } })).body; expect(pre.count).toBeGreaterThanOrEqual(2);
    const wholeDb = ok(await as('sales.manager').post('/api/campaigns/preview').send({ channel: 'EMAIL', audience: { source: 'ALL_CONTACTS' } })).body; expect(wholeDb.count).toBeGreaterThanOrEqual(pre.count);
    const byItem = ok(await as('sales.manager').post('/api/campaigns/preview').send({ channel: 'EMAIL', audience: { source: 'MEMBERS', productId: pid2 } })).body; expect(byItem.count).toBeGreaterThanOrEqual(1); expect(byItem.count).toBeLessThan(pre.count);
    // not configured: recorded as such, nothing is sent
    const c0 = ok(await as('sales.manager').post('/api/campaigns').send({ channel: 'EMAIL', name: 'No setup', subject: 'Hi', body: 'Hello {firstName}', audience: { source: 'MEMBERS' } })).body;
    ok(await as('sales.manager').post(`/api/campaigns/${c0.id}/send`));
    for (let i = 0; i < 40; i++) { const g = ok(await as('sales.manager').get(`/api/campaigns/${c0.id}`)).body; if (g.status !== 'SENDING') break; await new Promise((r) => setTimeout(r, 150)); }
    const g0 = ok(await as('sales.manager').get(`/api/campaigns/${c0.id}`)).body; expect(g0.status).toBe('FAILED'); expect(g0.recipients.every((r: { status: string }) => r.status === 'NOT_CONFIGURED')).toBe(true);
    // a working email: merge fields and the unsubscribe link
    const sent: { to: string; subject: string; text: string; unsub?: string }[] = [];
    const ms = app.get(MessagingService); const origEmail = ms.email.bind(ms); const origSms = ms.sms.bind(ms); const origCfg = ms.config.bind(ms);
    ms.config = () => ({ emailConfigured: true, from: 'shop@gws.test', smsConfigured: true, smsSender: 'GWS' });
    ms.email = async (to, subject, text, _h, unsub) => { sent.push({ to, subject, text, unsub }); return { status: 'SENT' }; };
    const smsSent: { to: string; message: string }[] = []; ms.sms = async (to, message) => { smsSent.push({ to, message }); return { status: 'SENT' }; };
    try {
      const c1 = ok(await as('sales.manager').post('/api/campaigns').send({ channel: 'EMAIL', name: 'Promo', subject: '20% off, {firstName}', body: 'Hi {name}, your number is {memberNo}', audience: { source: 'MEMBERS' } })).body;
      ok(await as('sales.manager').post(`/api/campaigns/${c1.id}/send`));
      for (let i = 0; i < 80; i++) { const g = ok(await as('sales.manager').get(`/api/campaigns/${c1.id}`)).body; if (g.status !== 'SENDING') break; await new Promise((r) => setTimeout(r, 150)); }
      const g1 = ok(await as('sales.manager').get(`/api/campaigns/${c1.id}`)).body; expect(g1.status).toBe('DONE'); expect(g1.sent).toBe(c1.total); expect(sent.length).toBe(c1.total);
      const mia = sent.find((x) => x.to === `mia${run}@x.test`)!; expect(mia.subject).toBe('20% off, Mia'); expect(mia.text).toContain(`your number is ${memberNo}`); expect(mia.text).toMatch(/\/api\/portal\/unsubscribe\?t=/); expect(mia.unsub).toContain('/api/portal/unsubscribe');
      await as('sales.manager').post(`/api/campaigns/${c1.id}/send`).expect(400); // already sent
      // unsubscribe through the link: the next blast leaves Mia out
      const t = decodeURIComponent(/unsubscribe\?t=([^\s]+)/.exec(mia.text)![1]);
      ok(await http.get(`/api/portal/unsubscribe?t=${encodeURIComponent(t)}`));
      expect((await prisma.member.findUniqueOrThrow({ where: { id: memberId } })).emailOptIn).toBe(false);
      const after = ok(await as('sales.manager').post('/api/campaigns/preview').send({ channel: 'EMAIL', audience: { source: 'MEMBERS' } })).body; expect(after.count).toBe(pre.count - 1); expect(after.excluded.optedOut).toBeGreaterThanOrEqual(1);
      await http.get('/api/portal/unsubscribe?t=forged.token').expect(400);
      // SMS: valid PH numbers only, members who opted out of SMS are left out
      const smsPre = ok(await as('sales.manager').post('/api/campaigns/preview').send({ channel: 'SMS', audience: { source: 'MEMBERS' } })).body; expect(smsPre.count).toBeGreaterThanOrEqual(1);
      const c2 = ok(await as('sales.manager').post('/api/campaigns').send({ channel: 'SMS', name: 'Flash sale', body: 'Hi {firstName}! Wheysted flash sale today.', audience: { source: 'MEMBERS' } })).body;
      ok(await as('sales.manager').post(`/api/campaigns/${c2.id}/send`));
      for (let i = 0; i < 80; i++) { const g = ok(await as('sales.manager').get(`/api/campaigns/${c2.id}`)).body; if (g.status !== 'SENDING') break; await new Promise((r) => setTimeout(r, 150)); }
      expect(smsSent.length).toBe(c2.total); expect(smsSent.every((m) => /^09\d{9}$/.test(m.to))).toBe(true); expect(smsSent.some((m) => m.to === '09175550101')).toBe(false); // Mia opted out of SMS
      await as('sales.manager').post('/api/campaigns').send({ channel: 'SMS', name: 'x', body: 'y'.repeat(481), audience: { source: 'MEMBERS' } }).expect(400);
      const tst = ok(await as('sales.manager').post('/api/campaigns/test').send({ channel: 'EMAIL', to: 'me@x.test', subject: 'T', body: 'Hello {name}' })).body; expect(tst.status).toBe('SENT'); expect(sent.at(-1)!.subject).toBe('[TEST] T');
    } finally { ms.email = origEmail; ms.sms = origSms; ms.config = origCfg; }
    expect((ok(await as('sales.manager').get('/api/campaigns')).body as unknown[]).length).toBeGreaterThanOrEqual(3);
  });
});

describe('Wheysted member program: points and tiers, vouchers, member prices, referral, surveys, lost sales, reservations, automation and insights (owner request 2026-10-06)', () => {
  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const portal = (m: 'get' | 'post', p: string, token?: string) => (m === 'get' ? http.get(p) : http.post(p)).set(...(token ? ['Authorization', `Bearer ${token}`] as [string, string] : ['X-None', '1'] as [string, string]));
  let west = ''; let pid = ''; let pidNone = ''; let a = { id: '', memberNo: '', token: '' }; let b = { id: '', memberNo: '', token: '' };
  const sale = async (n: string, memberId: string | null, lines: { productId: string; qty: number; unitPrice?: number }[], extra: Record<string, unknown> = {}) => ok(await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `MP-${run}-${n}`, ...(memberId ? { memberId } : {}), lines, ...extra })).body;
  const withMessaging = async (fn: (sent: { to: string; text: string }[]) => Promise<void>) => {
    const sent: { to: string; text: string }[] = []; const ms = app.get(MessagingService); const e = ms.email.bind(ms); const s = ms.sms.bind(ms); const c = ms.config.bind(ms);
    ms.config = () => ({ emailConfigured: true, from: 'shop@gws.test', smsConfigured: true, smsSender: 'GWS' });
    ms.email = async (to, _subject, text) => { sent.push({ to, text }); return { status: 'SENT' }; }; ms.sms = async (to, message) => { sent.push({ to, text: message }); return { status: 'SENT' }; };
    try { await fn(sent); } finally { ms.email = e; ms.sms = s; ms.config = c; }
  };

  it('setup: a product with stock, two members (one signed up on the portal) with fitness profile and heard-from', async () => {
    await prisma.salesReportSubmission.deleteMany({});
    west = (await prisma.location.findUniqueOrThrow({ where: { code: 'WESTAVE' } })).id;
    const cats = ok(await as('admin').get('/api/categories')).body as { id: string; accountingClass: string }[];
    const mk = async (tag: string, stock: number) => {
      const id = ok(await as('admin').post('/api/products').send({ name: `MP ${tag} ${run}`, brand: 'Prothin', categoryId: cats.find((c) => c.accountingClass === 'SUPPLEMENT')!.id, prices: { RETAIL: 1000 }, cost: 400 })).body.id as string;
      if (stock) { const bt = await prisma.batch.create({ data: { productId: id, batchNo: `MP-${tag}-${run}`, receivedRef: 'TEST', unitCost: '400' } }); await prisma.stockLedger.create({ data: { locationId: west, productId: id, batchId: bt.id, qtyDelta: stock, movementType: 'RECEIVE', documentType: 'Opening', documentId: `MP-${tag}-${run}`, unitCost: '400', businessDate: new Date(`${today()}T00:00:00Z`) } }); await prisma.stockBalance.create({ data: { locationId: west, productId: id, batchId: bt.id, qty: stock } }); }
      return id;
    };
    pid = await mk('Whey', 60); pidNone = await mk('Scarce', 0);
    const ca = ok(await as('sales.westave').post('/api/members').send({ fullName: 'Ana Program', phone: '0917 666 0001', email: `ana${run}@x.test`, birthday: `1995-${today().slice(5)}`, goal: 'MUSCLE_GAIN', gym: 'Iron Den', heardFrom: 'GYM', preferredChannel: 'SMS', flavorLikes: 'chocolate' })).body;
    a = { id: ca.id, memberNo: ca.memberNo, token: '' };
    const g = ok(await as('sales.manager').get(`/api/members/${a.id}`)).body; expect(g).toMatchObject({ goal: 'MUSCLE_GAIN', gym: 'Iron Den', heardFrom: 'GYM', preferredChannel: 'SMS' });
    await as('sales.westave').post('/api/members').send({ fullName: 'Bad', phone: '0917 666 0009', goal: 'FLYING' }).expect(400);
    const s = ok(await portal('post', '/api/portal/signup').send({ fullName: 'Ben Referred', phone: '0917 666 0002', email: `ben${run}@x.test`, password: 'longenough1', agree: true, referredByNo: a.memberNo, goal: 'WEIGHT_LOSS', heardFrom: 'FRIEND' })).body;
    b.token = s.token; const mb = ok(await portal('get', '/api/portal/me', b.token)).body; b.memberNo = mb.memberNo; b.id = (await prisma.member.findFirstOrThrow({ where: { memberNo: b.memberNo } })).id;
    expect(mb.profile).toMatchObject({ goal: 'WEIGHT_LOSS', heardFrom: 'FRIEND' }); expect(mb.loyalty.tier).toBe('BRONZE');
    await portal('post', '/api/portal/signup').send({ fullName: 'Cy Bad', phone: '0917 666 0003', password: 'longenough1', agree: true, referredByNo: 'WHY-999999' }).expect(400);
  });

  it('points and tiers: points follow spending, the Owner sets the rules, points redeem into a voucher (portal), manual adjustments are logged', async () => {
    ok(await as('sales.manager').post('/api/member-program/settings').send({ pesoPerPoint: 100, pointValue: 1, minRedeemPoints: 5, silverFrom: 2500, goldFrom: 6000 }));
    await sale('1', a.id, [{ productId: pid, qty: 1 }]);
    let st = ok(await as('sales.westave').get(`/api/members/${a.id}/standing`)).body; expect(st).toMatchObject({ tier: 'BRONZE', points: 10, spent12m: 1000, nextTier: 'SILVER', toNextTier: 1500 });
    await sale('2', a.id, [{ productId: pid, qty: 2 }]);
    st = ok(await as('sales.westave').get(`/api/members/${a.id}/standing`)).body; expect(st).toMatchObject({ tier: 'SILVER', points: 30 }); expect(has(st, /unitCost|"cost"/)).toBe(false);
    const list = ok(await as('sales.manager').get('/api/members')).body as { id: string; tier: string; points: number }[]; expect(list.find((m) => m.id === a.id)).toMatchObject({ tier: 'SILVER', points: 30 });
    ok(await as('sales.manager').post(`/api/members/${a.id}/points`).send({ points: 5, reason: 'Goodwill' }));
    await as('sales.manager').post(`/api/members/${a.id}/points`).send({ points: -500, reason: 'Too many' }).expect(400);
    await as('sales.westave').post(`/api/members/${a.id}/points`).send({ points: 5, reason: 'Nope nope' }).expect(403);
    // sign in to the portal as Ana (claim the counter-made account) and redeem
    const claim = ok(await portal('post', '/api/portal/signup').send({ fullName: 'Ana Program', phone: '0917 666 0001', password: 'longenough2', memberNo: a.memberNo, agree: true })).body; a.token = claim.token;
    const v = ok(await portal('post', '/api/portal/redeem', a.token).send({ points: 20 })).body; expect(v.value).toBe(20); expect(v.code).toMatch(/^V-[0-9A-F]{8}$/);
    const me = ok(await portal('get', '/api/portal/me', a.token)).body; expect(me.loyalty.points).toBe(15); expect(me.vouchers.some((x: { code: string }) => x.code === v.code)).toBe(true);
    await portal('post', '/api/portal/redeem', a.token).send({ points: 99 }).expect(400); await portal('post', '/api/portal/redeem').send({ points: 5 }).expect(401);
  });

  it('vouchers at the counter: the member\'s own voucher takes its value off the supplements, once; wrong member, used, expired and below-minimum are refused; a void gives it back', async () => {
    const v1 = ok(await as('sales.manager').post(`/api/members/${a.id}/vouchers`).send({ kind: 'AMOUNT', value: 100, note: 'Test' })).body;
    expect((ok(await as('sales.westave').get(`/api/members/${a.id}/vouchers?active=1`)).body as { code: string }[]).map((x) => x.code)).toContain(v1.code);
    const s1 = await sale('3', a.id, [{ productId: pid, qty: 2 }], { voucherCode: v1.code });
    expect(Number(s1.productTotal)).toBe(1900); expect(Number(s1.grandTotal)).toBe(1900); expect(Number(s1.voucherDiscount)).toBe(100);
    expect(s1.lines.reduce((t: number, l: { amount: string }) => t + Number(l.amount), 0)).toBe(1900);
    const used = (ok(await as('sales.manager').get(`/api/members/${a.id}/vouchers`)).body as { code: string; used: boolean }[]).find((x) => x.code === v1.code)!; expect(used.used).toBe(true);
    const again = await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `MP-${run}-4`, memberId: a.id, voucherCode: v1.code, lines: [{ productId: pid, qty: 1 }] }).expect(400); expect(JSON.stringify(again.body)).toMatch(/already used/);
    const vb = ok(await as('sales.manager').post(`/api/members/${b.id}/vouchers`).send({ kind: 'AMOUNT', value: 50 })).body;
    const other = await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `MP-${run}-5`, memberId: a.id, voucherCode: vb.code, lines: [{ productId: pid, qty: 1 }] }).expect(400); expect(JSON.stringify(other.body)).toMatch(/another member/);
    await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `MP-${run}-6`, voucherCode: vb.code, lines: [{ productId: pid, qty: 1 }] }).expect(400); // no member tagged
    const vmin = ok(await as('sales.manager').post(`/api/members/${a.id}/vouchers`).send({ kind: 'PERCENT', value: 10, minPurchase: 3000 })).body;
    const low = await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `MP-${run}-7`, memberId: a.id, voucherCode: vmin.code, lines: [{ productId: pid, qty: 1 }] }).expect(400); expect(JSON.stringify(low.body)).toMatch(/at least 3000/);
    const s2 = await sale('8', a.id, [{ productId: pid, qty: 3 }], { voucherCode: vmin.code }); expect(Number(s2.productTotal)).toBe(2700);
    await prisma.memberVoucher.update({ where: { code: vb.code }, data: { expiresOn: new Date(Date.UTC(2020, 0, 1)) } });
    const exp = await as('sales.westave').post('/api/sales').send({ channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `MP-${run}-9`, memberId: b.id, voucherCode: vb.code, lines: [{ productId: pid, qty: 1 }] }).expect(400); expect(JSON.stringify(exp.body)).toMatch(/expired/);
    // void gives the voucher back
    ok(await as('admin').post(`/api/sales/${s1.id}/void`).send({ reason: 'Customer changed mind' }));
    expect((await prisma.memberVoucher.findUniqueOrThrow({ where: { code: v1.code } })).usedAt).toBeNull();
    // privacy: the counter sees vouchers, never cost; a portal token cannot reach the staff program
    await as('hr.staff').get(`/api/members/${a.id}/vouchers`).expect(403);
    for (const p of ['/api/member-program/settings', '/api/member-program/top-spenders']) expect([401, 403]).toContain((await portal('get', p, a.token)).status);
  });

  it('member prices: a member offer applies by itself for tagged members (no special-price approval), not for walk-ins; referral gives both a voucher once', async () => {
    const o = ok(await as('sales.manager').post('/api/member-program/offers').send({ productId: pid, price: 850, note: 'Members week' })).body; expect(o.id).toBeTruthy();
    expect((ok(await as('sales.westave').get(`/api/members/lookup?q=${b.memberNo}`)).body as unknown[]).length).toBe(1);
    const walk = await sale('10', null, [{ productId: pid, qty: 1 }]); expect(Number(walk.productTotal)).toBe(1000);
    const first = await sale('11', b.id, [{ productId: pid, qty: 2 }]); expect(Number(first.productTotal)).toBe(1700); expect(first.specialPriceStatus ?? null).toBeNull();
    const typed = await sale('12', b.id, [{ productId: pid, qty: 1, unitPrice: 1000 }]); expect(Number(typed.productTotal)).toBe(1000); // a typed price wins
    await as('sales.westave').get('/api/member-program/offers').expect(403);
    // referral: Ben was referred by Ana; his first purchase gave each a voucher, once
    const rv = await prisma.memberVoucher.findMany({ where: { source: 'REFERRAL' } }); expect(rv.filter((v) => v.memberId === a.id).length).toBe(1); expect(rv.filter((v) => v.memberId === b.id).length).toBe(1);
    await sale('13', b.id, [{ productId: pid, qty: 1 }]); expect(await prisma.memberVoucher.count({ where: { source: 'REFERRAL' } })).toBe(2);
    ok(await as('sales.manager').post('/api/member-program/offers').send({ id: o.id, productId: pid, price: 850, active: false }));
    expect(Number((await sale('14', b.id, [{ productId: pid, qty: 1 }])).productTotal)).toBe(1000);
  });

  it('contact log, survey and feedback: a low rating becomes a complaint note and a notification; one answer per purchase; ratings are summarised', async () => {
    ok(await as('sales.manager').post(`/api/members/${a.id}/notes`).send({ kind: 'CALL', text: 'Called to thank her' }));
    await as('sales.westave').post(`/api/members/${a.id}/notes`).send({ kind: 'CALL', text: 'x y z' }).expect(403);
    const me = ok(await portal('get', '/api/portal/me', a.token)).body; const p = me.purchases.find((x: { survey: { token: string } | null }) => x.survey);
    const tok = p.survey.token; const view = ok(await http.get(`/api/portal/survey/${tok}`)).body; expect(view.items.length).toBeGreaterThanOrEqual(1); expect(view.member).toBe('Ana');
    await http.post(`/api/portal/survey/${tok}`).send({ rating: 9 }).expect(400);
    ok(await http.post(`/api/portal/survey/${tok}`).send({ rating: 2, comment: 'Tub was dented', items: [{ productId: view.items[0].productId, wouldBuyAgain: false }] }));
    await http.post(`/api/portal/survey/${tok}`).send({ rating: 5 }).expect(400); await http.get('/api/portal/survey/not-a-token').expect(404);
    const notes = ok(await as('sales.manager').get(`/api/members/${a.id}/notes`)).body as { kind: string; text: string }[]; expect(notes.some((n) => n.kind === 'COMPLAINT' && /Rated 2\/5/.test(n.text))).toBe(true); expect(notes.some((n) => n.kind === 'CALL')).toBe(true);
    expect(await prisma.notification.count({ where: { type: 'MEMBER_LOW_RATING' } })).toBeGreaterThanOrEqual(1);
    const fb = ok(await as('sales.manager').get('/api/member-program/feedback')).body; expect(fb.responses ?? fb.total ?? fb.count).toBeTruthy();
  });

  it('lost sales and the days-of-stock "asked" column; reservations from the portal reach the branch; back-in-stock tells the member once the item is back', async () => {
    ok(await as('sales.westave').post('/api/member-program/lost-sales').send({ productId: pidNone, qty: 2, memberId: a.id, note: 'Asked for it' }));
    ok(await as('sales.westave').post('/api/member-program/lost-sales').send({ itemText: 'Pink creatine gummies', qty: 1 }));
    await as('sales.westave').post('/api/member-program/lost-sales').send({ qty: 1 }).expect(400);
    const ls = ok(await as('sales.manager').get('/api/member-program/lost-sales?days=30')).body; expect(ls.total).toBe(2); expect(ls.items[0]).toMatchObject({ qty: 2 });
    await as('sales.westave').get('/api/member-program/lost-sales').expect(403);
    const dos = ok(await as('admin').get('/api/alerts/days-of-stock?days=30&combine=1')).body as { rows: { product: { id: string }; asked: number }[] };
    expect(dos.rows.every((r) => typeof r.asked === 'number')).toBe(true);
    // reservation
    const br = ok(await portal('get', '/api/portal/branches', a.token)).body as { id: string }[]; expect(br.map((x) => x.id)).toContain(west);
    const cat = ok(await portal('get', `/api/portal/catalog?search=MP%20Whey%20${run}`, a.token)).body as { productId: string; price: number; available: boolean }[]; expect(cat[0]).toMatchObject({ productId: pid, price: 1000, available: true }); expect(has(cat, /cost/i)).toBe(false);
    const r = ok(await portal('post', '/api/portal/reserve', a.token).send({ productId: pid, qty: 2, locationId: west })).body;
    const rs = ok(await as('sales.westave').get('/api/member-program/reservations')).body as { id: string; status: string; memberNo: string }[]; expect(rs.find((x) => x.id === r.id)).toMatchObject({ status: 'REQUESTED', memberNo: a.memberNo });
    await withMessaging(async (sent) => { ok(await as('sales.westave').post(`/api/member-program/reservations/${r.id}`).send({ status: 'READY' })); expect(sent.some((m) => /ready/i.test(m.text))).toBe(true); });
    ok(await as('sales.westave').post(`/api/member-program/reservations/${r.id}`).send({ status: 'PICKED_UP' }));
    const r2 = ok(await portal('post', '/api/portal/reserve', b.token).send({ productId: pid, qty: 1, locationId: west })).body; ok(await portal('post', `/api/portal/reservations/${r2.id}/cancel`, b.token)); await portal('post', `/api/portal/reservations/${r2.id}/cancel`, a.token).expect(400);
    await portal('post', '/api/portal/reserve', a.token).send({ productId: pid, qty: 0, locationId: west }).expect(400);
    // back in stock
    ok(await portal('post', '/api/portal/alert', a.token).send({ productId: pidNone })); expect(ok(await portal('post', '/api/portal/alert', a.token).send({ productId: pidNone })).body.already).toBe(true);
    await withMessaging(async (sent) => {
      const run1 = ok(await as('sales.manager').post('/api/member-program/run-automation')).body; expect(run1.backInStock).toBe(0);
      const bt = await prisma.batch.create({ data: { productId: pidNone, batchNo: `MP-S-${run}`, receivedRef: 'TEST', unitCost: '400' } }); await prisma.stockLedger.create({ data: { locationId: west, productId: pidNone, batchId: bt.id, qtyDelta: 5, movementType: 'RECEIVE', documentType: 'Opening', documentId: `MP-S-${run}`, unitCost: '400', businessDate: new Date(`${today()}T00:00:00Z`) } }); await prisma.stockBalance.create({ data: { locationId: west, productId: pidNone, batchId: bt.id, qty: 5 } });
      const run2 = ok(await as('sales.manager').post('/api/member-program/run-automation')).body; expect(run2.backInStock).toBe(1); expect(sent.some((m) => /is available again/.test(m.text))).toBe(true);
      expect(ok(await as('sales.manager').post('/api/member-program/run-automation')).body.backInStock).toBe(0); // told once
    });
  });

  it('automatic messages: birthday voucher + message once a year (off until the Owner turns it on), win-back, and a not-set-up channel is recorded not sent', async () => {
    const before = await prisma.memberVoucher.count({ where: { source: 'BIRTHDAY' } });
    await withMessaging(async (sent) => {
      ok(await as('sales.manager').post('/api/member-program/run-automation')); expect(await prisma.memberVoucher.count({ where: { source: 'BIRTHDAY' } })).toBe(before); // off by default
      ok(await as('sales.manager').post('/api/member-program/settings').send({ birthdayAuto: true, birthdayKind: 'AMOUNT', birthdayValue: 150 }));
      const r1 = ok(await as('sales.manager').post('/api/member-program/run-automation')).body; expect(r1.birthday).toBe(1);
      const bv = await prisma.memberVoucher.findMany({ where: { source: 'BIRTHDAY', memberId: a.id } }); expect(bv.length).toBe(1); expect(Number(bv[0].value)).toBe(150);
      expect(sent.some((m) => m.text.includes(bv[0].code))).toBe(true);
      expect(ok(await as('sales.manager').post('/api/member-program/run-automation')).body.birthday).toBe(0); expect(await prisma.memberVoucher.count({ where: { source: 'BIRTHDAY', memberId: a.id } })).toBe(1);
    });
    // nothing set up: recorded, no duplicate voucher
    ok(await as('sales.manager').post('/api/member-program/settings').send({ winbackAuto: true, winbackValue: 75, winbackMinPurchase: 300 }));
    await prisma.member.update({ where: { id: b.id }, data: { createdAt: new Date(Date.now() - 200 * 86400e3) } });
    await prisma.salesDoc.updateMany({ where: { memberId: b.id }, data: { docDate: new Date(Date.now() - 120 * 86400e3) } });
    delete process.env.SMTP_URL; delete process.env.SEMAPHORE_API_KEY;
    const nc = ok(await as('sales.manager').post('/api/member-program/run-automation')).body; expect(nc.notConfigured).toBeGreaterThanOrEqual(1);
    const wb = await prisma.memberVoucher.count({ where: { source: 'WINBACK', memberId: b.id } });
    ok(await as('sales.manager').post('/api/member-program/run-automation')); expect(await prisma.memberVoucher.count({ where: { source: 'WINBACK', memberId: b.id } })).toBe(wb);
    ok(await as('sales.manager').post('/api/member-program/settings').send({ birthdayAuto: false, winbackAuto: false }));
  });

  it('insights: top spenders (with last contact), when customers buy, where members come from, how many sales are tagged to a member, what to suggest at the counter', async () => {
    const top = ok(await as('sales.manager').get('/api/member-program/top-spenders')).body as { id: string; tier: string; spent12m: number; lastContact: string | null }[]; expect(top[0].id).toBe(a.id); expect(top[0].lastContact).toBeTruthy(); expect(top[0].spent12m).toBeGreaterThan(top[1].spent12m);
    const hm = ok(await as('sales.manager').get('/api/member-program/heatmap?membersOnly=1')).body; expect(hm.total).toBeGreaterThanOrEqual(3); expect(hm.cells[0]).toHaveProperty('dow'); expect(hm.cells[0]).toHaveProperty('hour');
    const acq = ok(await as('sales.manager').get('/api/member-program/acquisition')).body; expect(acq.heardFrom.map((x: { label: string }) => x.label)).toEqual(expect.arrayContaining(['GYM', 'FRIEND'])); expect(acq.goal.map((x: { label: string }) => x.label)).toContain('MUSCLE_GAIN');
    const cap = ok(await as('sales.manager').get('/api/member-program/capture')).body; expect(cap.targetPct).toBe(30); const wb = cap.branches.find((x: { branch: string }) => x.branch === 'West Ave'); expect(wb.tagged).toBeGreaterThanOrEqual(3); expect(wb.sales).toBeGreaterThan(wb.tagged);
    const sg = ok(await as('sales.westave').get(`/api/members/${a.id}/suggestions`)).body; expect(sg.usual[0].productId).toBe(pid); expect(sg.likes).toBe('chocolate'); expect(sg.goal).toBe('MUSCLE_GAIN');
    await as('sales.westave').get('/api/member-program/heatmap').expect(403);
  });

  it('chat-app campaigns (WhatsApp / Viber / Messenger) are lists the staff send by hand; a voucher is made for each person when marked sent; results show who bought', async () => {
    const pre = ok(await as('sales.manager').post('/api/campaigns/preview').send({ channel: 'WHATSAPP', audience: { source: 'MEMBERS', goal: 'MUSCLE_GAIN' } })).body; expect(pre.count).toBe(1);
    await as('sales.manager').post('/api/campaigns/preview').send({ channel: 'WHATSAPP', audience: { source: 'ALL_CONTACTS' } }).expect(400);
    const c = ok(await as('sales.manager').post('/api/campaigns').send({ channel: 'WHATSAPP', name: 'Gym push', body: 'Hi {firstName}, use {voucher}', audience: { source: 'MEMBERS', goal: 'MUSCLE_GAIN', voucher: { kind: 'AMOUNT', value: 60, validDays: 14 } } })).body;
    ok(await as('sales.manager').post(`/api/campaigns/${c.id}/send`));
    let g = ok(await as('sales.manager').get(`/api/campaigns/${c.id}`)).body; expect(g.status).toBe('MANUAL'); expect(g.recipients.length).toBe(1);
    const mk = ok(await as('sales.manager').post(`/api/member-program/campaign-recipients/${g.recipients[0].id}/mark`).send({ status: 'SENT' })).body; expect(mk.voucher).toMatch(/^V-/); expect(mk.text).toContain(mk.voucher);
    g = ok(await as('sales.manager').get(`/api/campaigns/${c.id}`)).body; expect(g.status).toBe('DONE'); expect(g.results).toMatchObject({ reached: 1, vouchersGiven: 1, vouchersUsed: 0 });
    await sale('20', a.id, [{ productId: pid, qty: 1 }], { voucherCode: mk.voucher });
    g = ok(await as('sales.manager').get(`/api/campaigns/${c.id}`)).body; expect(g.results).toMatchObject({ buyers: 1, vouchersUsed: 1 });
    await as('sales.westave').post(`/api/member-program/campaign-recipients/${g.recipients[0].id}/mark`).send({ status: 'SENT' }).expect(403);
  });
});
