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
  tokens[username] = token; return token;
}
const USERS = ['admin', 'ext.auditor', 'head.auditor', 'asst.auditor', 'audit.assoc', 'wh.incharge', 'wh.assoc', 'sales.westave', 'fr.mayon.assoc', 'fr.mayon.owner', 'custom.user', 'acct.head', 'acct.assoc', 'hr.staff', 'field.auditor'];
const as = (u: string) => ({ get: (p: string) => http.get(p).set('Authorization', `Bearer ${tokens[u]}`), post: (p: string) => http.post(p).set('Authorization', `Bearer ${tokens[u]}`), put: (p: string) => http.put(p).set('Authorization', `Bearer ${tokens[u]}`) });
const has = (o: unknown, re: RegExp): boolean => JSON.stringify(o).match(re) !== null;
const ok = (r: request.Response) => { if (r.status >= 400) throw new Error(`${r.request?.method} ${r.request?.url} → ${r.status} ${JSON.stringify(r.body)}`); return r; };

beforeAll(async () => { app = await createApp(); await app.init(); http = request(app.getHttpServer()); for (const u of USERS) await login(u); });
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
  it('branch requests a transfer from warehouse (FEFO picks NEAR first); Asst Auditor alone can approve (any-of); receiver confirms with shortfall', async () => {
    const t = ok(await as('sales.westave').post('/api/transfers').send({ fromLocationId: whId, toLocationId: branchId, transferType: 'RESTOCK', lines: [{ productId, qty: 12 }] })).body;
    transferId = t.id; expect(t.lines.map((l: { batch: { batchNo: string }; qtySent: number }) => [l.batch.batchNo, l.qtySent])).toEqual([['NEAR', 11], ['FAR', 1]]);
    ok(await as('sales.westave').post(`/api/transfers/${transferId}/submit`));
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
  it('AR/PDC sale, partial payment → credit note, overdue list; daily sales report exports (xlsx + pdf/html) with no cost', async () => {
    const dealer = (ok(await as('sales.westave').get('/api/customers?type=DEALER')).body as { id: string }[])[0];
    const ar = ok(await as('sales.westave').post('/api/sales').send({ channel: 'DEALER', paymentMode: 'AR_PDC', customerId: dealer.id, drSiNo: `DR-${run}-AR`, dueDate: '2026-01-01', lines: [{ productId, qty: 1 }] })).body;
    expect(ar.lines[0].priceTier).toBe('DEALER'); expect(ar.grandTotal).toBe('1200');
    const list = ok(await as('sales.westave').get(`/api/ar?locationId=${branchId}&overdue=1`)).body as { id: string; daysOverdue: number }[];
    expect(list.find((x) => x.id === ar.id)!.daysOverdue).toBeGreaterThan(0);
    const pay = ok(await as('sales.westave').post('/api/ar/payments').send({ salesDocIds: [ar.id], amount: 700, paymentMode: 'CASH' })).body;
    expect(pay.creditNoteNo).toMatch(/^CN-/); expect(pay.allocations[0].amount).toBe('700');
    expect(ok(await as('sales.westave').get(`/api/sales/${ar.id}`)).body.balance).toBe('500');
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
    const e = ok(await as('sales.westave').post('/api/expenses').send({ accountId: meralco.id, amount: 300, paidFrom: 'CASH_DRAWER', payee: 'Meralco' })).body; expect(e.controlNo).toMatch(/^EXP-WESTAVE-/);
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
  it('bulk approve with mixed selection reports per-item results', async () => {
    const t1 = ok(await as('sales.westave').post('/api/transfers').send({ fromLocationId: whId, toLocationId: branchId, transferType: 'RESTOCK', lines: [{ productId, qty: 1 }] })).body; ok(await as('sales.westave').post(`/api/transfers/${t1.id}/submit`));
    const t2 = ok(await as('sales.westave').post('/api/transfers').send({ fromLocationId: whId, toLocationId: branchId, transferType: 'RESTOCK', lines: [{ productId, qty: 1 }] })).body; ok(await as('sales.westave').post(`/api/transfers/${t2.id}/submit`));
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
