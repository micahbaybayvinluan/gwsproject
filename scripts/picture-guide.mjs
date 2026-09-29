/**
 * Builds the illustrated user guide (web/public/picture-guide): signs in as each role on a running GWS-ERP (pnpm dev),
 * prepares example documents through the API, opens each screen, marks where to click with numbered red boxes and saves the
 * screenshots, then writes index.html (and a printable PDF) with the steps next to each picture.
 *
 *   node scripts/picture-guide.mjs            (GUIDE_BASE defaults to http://localhost:5173)
 *
 * Use it on the demo data only: it records example sales, transfers and payments.
 */
import { chromium } from '../web/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'web/public/picture-guide');
const IMG = path.join(OUT, 'img');
const BASE = process.env.GUIDE_BASE || 'http://localhost:5173';
const PW = process.env.SEED_PASSWORD || 'ChangeMe!2026';
const EXE = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
fs.mkdirSync(IMG, { recursive: true });
const manila = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const tag = Date.now().toString(36).slice(-4).toUpperCase();

// ─────────────── API helpers (example data) ───────────────
const tokens = {};
async function call(user, method, p, body) {
  const t = tokens[user] ?? (tokens[user] = await login(user));
  const r = await fetch(`${BASE}${p}`, { method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); const j = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(`${user} ${method} ${p} → ${r.status} ${text.slice(0, 300)}`);
  return j;
}
async function login(user) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: user, password: PW }) });
  const j = await r.json(); if (!j.token) throw new Error(`login ${user}: ${JSON.stringify(j)}`);
  const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${j.token}` } })).json();
  if (!me.accountabilityAcceptedAt) await fetch(`${BASE}/api/auth/accept-accountability`, { method: 'POST', headers: { Authorization: `Bearer ${j.token}` } });
  return j.token;
}
async function upload(user, p, buf, name, type) {
  const f = new FormData(); f.append('file', new Blob([buf], { type }), name);
  const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { Authorization: `Bearer ${tokens[user] ?? (tokens[user] = await login(user))}` }, body: f });
  if (!r.ok) throw new Error(`upload ${p} → ${r.status} ${await r.text()}`); return r.json();
}
const decidePending = async (user, type, documentId, decision = 'APPROVE', note) => {
  const inbox = await call(user, 'GET', `/api/approvals/inbox?type=${type}`);
  const req = inbox.items.find((i) => i.documentId === documentId); if (!req) throw new Error(`no ${type} for ${documentId} in ${user}'s inbox`);
  return call(user, 'POST', `/api/approvals/${req.id}/decide`, { decision, note });
};

async function prepare(makeProof) {
  const locs = await call('admin', 'GET', '/api/locations');
  const wh = locs.find((l) => l.code === 'WH'); const west = locs.find((l) => l.code === 'WESTAVE');
  const stock = (await call('wh.incharge', 'GET', `/api/stock/on-hand?locationId=${wh.id}`)).filter((s) => s.qty >= 20 && s.product?.name);
  const pick = [...new Map(stock.map((s) => [s.productId ?? s.product.id, s])).values()].slice(0, 6);
  const pid = (i) => pick[i].productId ?? pick[i].product.id;
  const transfer = async (lines) => {
    const t = await call('wh.incharge', 'POST', '/api/transfers', { fromLocationId: wh.id, toLocationId: west.id, transferType: 'RESTOCK', lines });
    await call('wh.incharge', 'POST', `/api/transfers/${t.id}/submit`);
    await decidePending('head.auditor', 'TRANSFER_INTERNAL', t.id);
    return call('sales.westave', 'GET', `/api/transfers/${t.id}`);
  };
  const receive = (t, got, extras = []) => call('sales.westave', 'POST', `/api/transfers/${t.id}/confirm`, { lines: t.lines.map((l, i) => (got[i] === undefined || got[i] >= l.qtySent ? { lineId: l.id, checked: true } : { lineId: l.id, qtyReceived: got[i], discrepancyNote: `only ${got[i]} in the box` })), extras });
  // 1) a full delivery so West Ave has stock to sell
  const t0 = await transfer([{ productId: pid(0), qty: 12 }, { productId: pid(1), qty: 12 }, { productId: pid(2), qty: 6 }]);
  await receive(t0, []);
  // 2) waiting to be received (for the "receiving" picture)
  const tReceive = await transfer([{ productId: pid(3), qty: 4 }, { productId: pid(4), qty: 2 }]);
  // 3) a difference waiting for the Head Auditor, 4) one waiting for the sending branch, 5) one settled (-002 form, HR notice)
  const tReview = await transfer([{ productId: pid(0), qty: 2 }]); await receive(tReview, [1], [{ productId: pid(5), qty: 1, note: 'shaker not on the form' }]);
  const tSender = await transfer([{ productId: pid(1), qty: 3 }]); await receive(tSender, [2]); await decidePending('head.auditor', 'TRANSFER_DIFF_REVIEW', tSender.id);
  const tDone = await transfer([{ productId: pid(2), qty: 2 }]); await receive(tDone, [1]); await decidePending('head.auditor', 'TRANSFER_DIFF_REVIEW', tDone.id); await decidePending('wh.incharge', 'TRANSFER_DIFF_SENDER', tDone.id, 'APPROVE', 'Found it on the shelf');
  // sales today: cash, online and on credit (dealer)
  const accounts = await call('sales.westave', 'GET', `/api/accounts/payment?locationId=${west.id}`);
  const gcash = accounts.find((a) => /gcash \(gws\)/i.test(a.title)) ?? accounts.find((a) => a.paymentAccountType === 'BANK') ?? accounts[0];
  await call('sales.westave', 'POST', '/api/sales', { channel: 'WALK_IN', paymentMode: 'CASH', drSiNo: `${tag}-1001`, customerName: 'Walk-in', lines: [{ productId: pid(0), qty: 2 }] });
  const proofSale = await upload('sales.westave', `/api/attachments/SalesDoc/${crypto.randomUUID()}`, await makeProof(1000), 'gcash-receipt.png', 'image/png');
  await call('sales.westave', 'POST', '/api/sales', { channel: 'WALK_IN', paymentMode: 'ONLINE', paymentAccountId: gcash.id, proofOfPaymentAttachmentId: proofSale.id, drSiNo: `${tag}-1002`, lines: [{ productId: pid(1), qty: 1 }] });
  const dealer = (await call('sales.westave', 'GET', '/api/customers')).find((c) => c.type === 'DEALER');
  const ar1 = await call('sales.westave', 'POST', '/api/sales', { channel: 'DEALER', paymentMode: 'AR_PDC', customerId: dealer.id, dueDate: addDays(manila(), 3), drSiNo: `${tag}-1003`, lines: [{ productId: pid(0), qty: 3 }] });
  await call('sales.westave', 'POST', '/api/sales', { channel: 'DEALER', paymentMode: 'AR_PDC', customerId: dealer.id, dueDate: addDays(manila(), 10), pdcBank: 'BDO', pdcChequeNo: '0012345', pdcDate: addDays(manila(), 10), drSiNo: `${tag}-1004`, lines: [{ productId: pid(1), qty: 2 }] });
  // an AR payment waiting for Accounting, with its proof
  const amount = Math.max(1, Math.floor(Number(ar1.grandTotal) / 2));
  const proof = await upload('sales.westave', `/api/attachments/Payment/${crypto.randomUUID()}`, await makeProof(amount), 'gcash-receipt.png', 'image/png');
  await call('sales.westave', 'POST', '/api/ar/payments', { salesDocIds: [ar1.id], amount, paymentMode: 'ONLINE', paymentAccountId: gcash.id, proofAttachmentId: proof.id, notes: 'Partial payment via GCash' });
  // targets: one approved, one waiting for the Owner; the agent's sale
  const month = manila().slice(0, 7);
  const tgt = await call('sales.manager', 'POST', '/api/targets', { month, kind: 'BRANCH', locationId: west.id, amount: 250000, notes: 'Anniversary month' });
  await decidePending('admin', 'SALES_TARGET', tgt.id);
  const agents = await call('sales.manager', 'GET', '/api/targets/agents');
  const jerick = agents.find((a) => a.name === 'Jerick Quinto');
  const at = await call('sales.manager', 'POST', '/api/targets', { month, kind: 'AGENT', agentKey: jerick.key, amount: 80000 });
  await decidePending('admin', 'SALES_TARGET', at.id);
  await call('sales.manager', 'POST', '/api/targets', { month, kind: 'BRANCH', locationId: locs.find((l) => l.code === 'CSR').id, amount: 180000 });
  await call('sales.westave', 'POST', '/api/sales', { channel: 'AGENT', paymentMode: 'CASH', agentId: jerick.agentIds[0], drSiNo: `${tag}-1005`, lines: [{ productId: pid(2), qty: 2 }] });
  return { wh, west, tReceive, tReview, tSender, tDone };
}

// ─────────────── marking the screen ───────────────
async function mark(page, marks) {
  await page.evaluate(() => document.querySelectorAll('.gg-mark').forEach((n) => n.remove()));
  const boxes = [];
  for (const [i, m] of marks.entries()) {
    const loc = typeof m.at === 'string' ? page.locator(m.at).first() : m.at(page).first();
    try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); } catch { /* not found: skip */ }
    const b = await loc.boundingBox().catch(() => null);
    if (b) boxes.push({ ...b, n: m.n ?? i + 1 });
  }
  await page.evaluate((bs) => {
    for (const b of bs) {
      const box = document.createElement('div'); box.className = 'gg-mark';
      Object.assign(box.style, { position: 'fixed', left: `${b.x - 5}px`, top: `${b.y - 5}px`, width: `${b.width + 10}px`, height: `${b.height + 10}px`, border: '3px solid #e11d2e', borderRadius: '10px', boxShadow: '0 0 0 4px rgba(225,29,46,.18)', zIndex: 99999, pointerEvents: 'none' });
      const n = document.createElement('div'); n.className = 'gg-mark'; n.textContent = String(b.n);
      Object.assign(n.style, { position: 'fixed', left: `${Math.max(2, b.x - 18)}px`, top: `${Math.max(2, b.y - 18)}px`, width: '26px', height: '26px', borderRadius: '13px', background: '#e11d2e', color: '#fff', font: '700 14px/26px Arial', textAlign: 'center', zIndex: 100000, boxShadow: '0 2px 6px rgba(0,0,0,.3)' });
      document.body.append(box, n);
    }
  }, boxes);
  return boxes.length;
}
const byLabel = (label) => (p) => p.locator('label', { has: p.locator('span', { hasText: new RegExp(`^${label.replace(/[()/]/g, '\\$&')}$`) }) });
const btn = (name) => (p) => p.getByRole('button', { name });
const text = (t) => (p) => p.getByText(t, { exact: false });
const nav = (label) => (p) => p.locator('aside').getByRole('link', { name: label, exact: true });

// ─────────────── the guide ───────────────
function steps(d) {
  return [
    { section: 'Everyone', title: 'Signing in', user: null, path: '/login', marks: [{ at: byLabel('Username or email') }, { at: byLabel('Password') }, { at: btn(/sign in/i) }], text: ['Type your own username (never share it).', 'Type your password. The first time, you choose a new one and accept the accountability statement.', 'Press **Sign in**.'] },
    { section: 'Everyone', title: 'The dashboard and the menu', user: 'sales.westave', path: '/', marks: [{ at: (p) => p.locator('aside') }, { at: (p) => p.locator('header button').first() }, { at: text("Today's sales by payment") }], text: ['The **menu** on the left lists only the screens of your role. Each screen tells at the top what it is for.', 'The **bell** shows new notifications (approvals, reminders, decisions). Click one to open the document.', 'The dashboard shows what needs you today, for example today\'s sales by payment and the cash on hand.'] },
    { section: 'Everyone', title: 'Help & Guide', user: 'sales.westave', path: '/help', marks: [{ at: nav('Help & Guide') }, { at: (p) => p.getByRole('button', { name: /My guide/ }) }, { at: (p) => p.getByPlaceholder(/question|Ask/i).first() }], text: ['Open **Help & Guide** from the menu.', '**My guide** has the step-by-step guide for your own role.', 'Type a question in the **Ask** box.'] },

    { section: 'Sales Associate', title: 'Recording a sale', user: 'sales.westave', path: '/sales/new', marks: [{ at: byLabel('DR / SI number (paper)') }, { at: byLabel('Channel') }, { at: byLabel('Payment mode') }, { at: (p) => p.getByPlaceholder(/scan|search|product/i).first() }, { at: btn(/save sale|record sale|save/i) }], text: ['Type the **DR / SI number** from the paper receipt.', 'Choose the **channel** (walk-in, delivery, dealer…).', 'Choose the **payment mode**: cash, online, credit card or on credit (AR / PDC).', 'Type the product name or scan the barcode, then the quantity.', 'Press **Save**. Stock is deducted at once.'] },
    { section: 'Sales Associate', title: 'Selling on credit (AR) and PDC', user: 'sales.westave', path: '/sales/new', before: async (p) => { await byLabel('Payment mode')(p).locator('select').selectOption('AR_PDC'); await p.waitForTimeout(300); await p.getByRole('button', { name: 'Dealer', exact: true }).click(); await p.locator('label', { hasText: 'There is a PDC' }).locator('input').check(); await p.waitForTimeout(300); }, marks: [{ at: byLabel('Customer is a') }, { at: byLabel('Dealer') }, { at: byLabel('Due date') }, { at: (p) => p.locator('label', { hasText: 'There is a PDC' }).last() }, { at: byLabel('Cheque no.') }], text: ['Choose what the customer is: **Dealer**, **Franchisee**, **Agent** or **Other customer**.', 'Only that kind of customer is listed. Pick the customer.', 'Type the **due date**.', 'Tick **There is a PDC** only when the customer gave a post-dated cheque.', 'Then type the bank, cheque number and cheque date.'] },
    { section: 'Sales Associate', title: 'Expenses paid from the cash on hand', user: 'sales.westave', path: '/expenses', marks: [{ at: byLabel('Account') }, { at: byLabel('Amount') }, { at: byLabel('Paid from') }, { at: text('Cash on hand now') }, { at: btn('Save expense') }], text: ['Choose the expense account (for example Meralco).', 'Type the amount and the payee.', 'Choose **Cash on hand** (sales cash not yet deposited) or **Cash fund**.', 'The screen shows how much cash on hand the branch has.', 'Press **Save expense**, then attach the receipt.'] },
    { section: 'Sales Associate', title: 'Not enough cash on hand', user: 'sales.westave', path: '/expenses', before: async (p) => { await byLabel('Account')(p).locator('select').selectOption({ index: 1 }); await byLabel('Amount')(p).locator('input').fill('999999'); await p.waitForTimeout(600); await p.getByRole('button', { name: 'Save expense' }).click(); await p.waitForTimeout(400); }, marks: [{ at: (p) => p.getByRole('dialog') }, { at: btn('Pay from the cash fund') }], text: ['If the expense is more than the cash on hand, this notice pops up and nothing is saved.', 'Pay it from the **cash fund** instead, or ask Accounting to pay it from the bank.'] },
    { section: 'Sales Associate', title: 'Receiving stock from the warehouse', user: 'sales.westave', path: `/transfers/${d.tReceive.id}`, marks: [{ at: (p) => p.getByTestId('tick-all') }, { at: (p) => p.locator('table input[type=checkbox]').first() }, { at: (p) => p.getByPlaceholder('count').first() }, { at: text('An item arrived that is not on the form') }, { at: btn('Confirm receipt') }], text: ['If everything arrived complete, tick **Tick all**.', 'Otherwise tick each line that arrived complete…', '…and for a line that did not, type the quantity you actually got and what is wrong.', 'An item that arrived but is not on the form: press this and add it.', 'Press **Confirm receipt**. A difference goes to the Head Auditor automatically.'] },
    { section: 'Sales Associate', title: 'Following a difference on a transfer', user: 'sales.westave', path: `/transfers/${d.tDone.id}`, marks: [{ at: text('Difference between the form and what arrived') }, { at: (p) => p.locator('ol li').first() }, { at: text('Adjustment forms') }], text: ['The transfer page shows the difference: on the form, received, short or extra.', 'The steps: Head Auditor → sending branch (2 days) → Owner if they disagree.', 'When settled, the **-002** adjustment form returns the missing items to the sender.'] },
    { section: 'Sales Associate', title: 'Collecting a customer payment (AR)', user: 'sales.westave', path: '/ar', marks: [{ at: (p) => p.locator('table input[type=checkbox]').nth(1) }, { at: byLabel('Amount received') }, { at: byLabel('Mode') }, { at: (p) => p.getByRole('button', { name: /send payment|record payment/i }) }], text: ['Tick the invoice(s) of the customer who paid.', 'Type the amount received.', 'Choose how it was paid. For online and card payments choose the account and upload the proof.', 'Send it. Accounting approves it before the balance goes down.'] },
    { section: 'Sales Associate', title: 'Submitting the Daily Sales Report', user: 'sales.westave', path: '/reports/daily-sales', marks: [{ at: btn(/submit today/i) }], text: ['At the end of the day, check the report and press **Submit today\'s report**. Tick "true and correct" and confirm. The day then closes.'] },
    { section: 'Sales Associate', title: 'Opening the document behind a stock movement', user: 'sales.westave', path: '/reports/inventory', marks: [{ at: text('Stock ledger (latest movements)') }, { at: (p) => p.locator('table a').first() }], text: ['In **Inventory Reports**, the stock ledger lists every movement.', 'Click the document (Sale DR, Pull-out, Transfer-in…) to open it.'] },

    { section: 'Warehouse Associate', title: 'Receiving a supplier delivery', user: 'wh.assoc', path: '/receiving', marks: [{ at: byLabel('Supplier (code)') }, { at: byLabel('Supplier invoice / DR #') }, { at: byLabel('Upload Supplier Delivery Receipt') }, { at: (p) => p.getByPlaceholder('Add product…') }, { at: btn('Create draft') }], text: ['Choose the supplier (by code).', 'Type the supplier\'s invoice / DR number.', '**Upload Supplier Delivery Receipt**: a photo or PDF of the supplier\'s DR.', 'Add each product with quantity, freebies, expiry and batch.', 'Press **Create draft**, check it and submit. The In-Charge checks the goods first, then the Head Auditor approves the cost; the stock is then added.'] },
    { section: 'Warehouse In-Charge', title: 'Answering a difference your warehouse sent', user: 'wh.incharge', path: `/transfers/${d.tSender.id}`, marks: [{ at: text('Difference between the form and what arrived') }, { at: byLabel('Note') }, { at: btn('Agree') }, { at: btn(/Disagree/) }], text: ['The receiving branch got less than your form, and the Head Auditor confirmed it.', 'Check your shelves and packing and type what you found.', '**Agree**: the -002 adjustment form is made automatically.', '**Disagree**: the Owner decides. Answer within 2 days.'] },
    { section: 'Warehouse In-Charge', title: 'My Approvals', user: 'wh.incharge', path: '/approvals', marks: [{ at: nav('My Approvals') }, { at: (p) => p.locator('main ul li').first() }], text: ['Everything waiting for you is in **My Approvals**: your associates\' goods in and out, e-commerce pull-outs and transfer differences.', 'Click a line to see the details, then **Approve** or **Reject**.'] },

    { section: 'Head Auditor', title: 'Reviewing a transfer difference', user: 'head.auditor', path: `/transfers/${d.tReview.id}`, marks: [{ at: text('Difference between the form and what arrived') }, { at: btn('Confirm the difference') }, { at: btn('Receiver miscounted') }], text: ['The table shows what was on the form, what was received and the note.', '**Confirm the difference**: it goes to the sending branch to agree.', '**Receiver miscounted**: the receiving branch gets the items as on the form.'] },
    { section: 'Head Auditor', title: 'Cash on hand of every branch', user: 'head.auditor', path: '/cash-on-hand', marks: [{ at: (p) => p.locator('main table').first() }], text: ['See each branch\'s undeposited cash and deadlines, and set the days allowed to deposit.'] },

    { section: 'Accounting Head', title: 'Approving an AR payment', user: 'acct.head', path: '/approvals', marks: [{ at: text('Deposited to') }, { at: (p) => p.getByAltText('Proof of payment').first() }, { at: (p) => p.locator('main table').first() }, { at: (p) => p.getByRole('button', { name: 'Approve', exact: true }).first() }, { at: (p) => p.getByRole('button', { name: 'Reject', exact: true }).first() }], text: ['See the **account it was deposited to**, the amount and how it was paid.', 'The **proof of payment** is right there; click it to enlarge.', 'The invoices being paid.', '**Approve** when the money is in the account.', '**Reject** asks for the reason.'] },
    { section: 'Accounting Head', title: 'Rejecting with a reason', user: 'acct.head', path: '/approvals', before: async (p) => { await p.getByRole('button', { name: 'Reject', exact: true }).first().click(); await p.waitForTimeout(300); }, marks: [{ at: (p) => p.getByRole('dialog').locator('label').first() }, { at: (p) => p.getByRole('dialog').getByRole('textbox') }, { at: (p) => p.getByRole('dialog').getByRole('button', { name: 'Reject payment' }) }], text: ['Choose the reason: wrong amount, wrong proof, proof unclear, money not received, wrong account, wrong customer or invoice, duplicate, wrong date, cheque bounced, or other.', 'Add details if needed.', 'Press **Reject payment**. The branch sees the reason.'] },

    { section: 'HR Staff', title: 'Transfer differences in HR Notices', user: 'hr.staff', path: '/hr-notices', marks: [{ at: text('Transfer difference') }, { at: text('Cases in 30 days') }, { at: btn('Refer to the Owner') }], text: ['Every confirmed transfer difference comes here with the person answerable.', 'The number of cases in 30 days; from the third it is marked in red.', '**Refer to the Owner** for a more serious consideration.'] },

    { section: 'Sales Manager', title: 'Setting and following sales targets', user: 'sales.manager', path: '/targets', marks: [{ at: (p) => p.locator('main').getByText('Branches (and e-commerce platforms)') }, { at: (p) => p.locator('main table').first().locator('tbody tr').filter({ hasText: 'West Ave' }) }, { at: text('Set a target for') }, { at: btn(/Send for the Owner/) }], text: ['Each branch (and e-commerce platform) with its target and sales so far.', 'The bar shows % achieved; the dark line is how much of the month has gone. Green = on track.', 'To set a target: choose the branch or agent and type the amount…', '…and send it. The Owner approves it.'] },
    { section: 'Agent', title: 'My Sales', user: 'agent.jerick', path: '/my-sales', marks: [{ at: text('My target') }, { at: text('Achieved') }, { at: text('Customers who have not paid yet') }, { at: text('My sales in') }], text: ['Your target for the month.', 'How much of it is done (green = on track).', 'Your customers who have not paid yet, nearest due first.', 'Your sales at every branch.'] },

    { section: 'Owner (Admin)', title: 'Approving targets and other requests', user: 'admin', path: '/approvals', marks: [{ at: (p) => p.locator('main').getByText('Monthly sales target', { exact: false }).first() }, { at: (p) => p.getByRole('button', { name: 'Approve', exact: true }).first() }, { at: btn('Approve selected') }], text: ['Requests are grouped by type, for example the Sales Manager\'s targets.', 'Approve (or reject) one…', '…or tick several and use **Approve selected**.'] },
    { section: 'Owner (Admin)', title: 'Creating a user account', user: 'admin', path: '/users', marks: [{ at: (p) => p.locator('main').getByText(/new user|create/i).first() }], text: ['In **Users & Roles**, create one account per person: username, full name, company ID, role and branch. Press **Generate** for a temporary password.'] },
  ];
}

const proofHtml = (amount) => `<html><body style="margin:0;font-family:Arial;background:#f4f6fb"><div style="width:360px;padding:24px;background:#fff;border-radius:16px;margin:20px;box-shadow:0 2px 12px rgba(0,0,0,.1)"><div style="color:#0a5bd8;font-weight:700;font-size:22px">GCash</div><div style="margin-top:14px;color:#555">Sent via GCash</div><div style="font-size:32px;font-weight:700;margin:6px 0">₱${Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div><div style="color:#555">to GET WHEYSTED SUPPLEMENTS</div><div style="color:#555">09•• ••• 4321</div><hr><div style="color:#777;font-size:13px">Ref. No. 5012 345 678901</div><div style="color:#777;font-size:13px">${manila()} 10:42 AM</div></div></body></html>`;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const makeProof = async (amount) => { const tmp = await browser.newPage({ viewport: { width: 420, height: 380 } }); await tmp.setContent(proofHtml(amount)); const png = await tmp.screenshot(); await tmp.close(); return png; };
  console.log('Preparing example documents…');
  const d = await prepare(makeProof);
  const list = steps(d); const done = []; const missing = [];
  const pages = {};
  for (const [i, s] of list.entries()) {
    const key = s.user ?? 'anon';
    if (!pages[key]) {
      const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 }); const page = await ctx.newPage();
      if (s.user) {
        await page.goto(`${BASE}/login`); await page.getByLabel('Username or email').fill(s.user); await page.getByLabel('Password').fill(PW); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
        if (await page.getByTestId('accountability-statement').count()) { await page.locator('input[type=checkbox]').first().check(); await page.getByRole('button', { name: 'I accept' }).click(); await page.waitForTimeout(800); }
      }
      pages[key] = page;
    }
    const page = pages[key];
    await page.goto(`${BASE}${s.path}`); await page.waitForTimeout(1600);
    if (s.before) { try { await s.before(page); } catch (e) { console.warn(`  (${s.title}: ${e.message.split('\n')[0]})`); } }
    const n = await mark(page, s.marks);
    if (n < s.marks.length) missing.push(`${s.title}: ${n}/${s.marks.length} marks`);
    const file = `${String(i + 1).padStart(2, '0')}.jpg`;
    await page.screenshot({ path: path.join(IMG, file), type: 'jpeg', quality: 72 });
    await page.evaluate(() => document.querySelectorAll('.gg-mark').forEach((x) => x.remove()));
    await page.keyboard.press('Escape').catch(() => undefined);
    done.push({ ...s, file });
    console.log(`  ${file} ${s.section} — ${s.title}${n < s.marks.length ? `  (${n}/${s.marks.length} marks)` : ''}`);
  }
  // ── index.html ──
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const sections = [...new Set(done.map((s) => s.section))];
  const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GWS-ERP Picture Guide</title>
<style>
:root{--brand:#c8102e;--navy:#0b1f3a;--bg:#f5f6fa;--card:#fff;--muted:#5b6475;--line:#e3e7ef}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#0f172a;font:16px/1.55 Inter,"Segoe UI",Arial,sans-serif}
header{background:var(--navy);color:#fff;padding:28px 16px}header .w{max-width:1100px;margin:0 auto}h1{margin:0;font-size:30px}header p{margin:6px 0 0;color:#cdd6e6}
nav{max-width:1100px;margin:18px auto 0;padding:0 16px;display:flex;flex-wrap:wrap;gap:8px}nav a{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 14px;color:var(--navy);text-decoration:none;font-weight:600;font-size:14px}
main{max-width:1100px;margin:0 auto;padding:8px 16px 48px}h2{margin:36px 0 12px;color:var(--navy);font-size:24px;border-bottom:3px solid var(--brand);display:inline-block;padding-bottom:2px}
.step{background:var(--card);border:1px solid var(--line);border-radius:16px;margin:16px 0;overflow:hidden;break-inside:avoid;page-break-inside:avoid}
.step h3{margin:0;padding:14px 18px;font-size:18px;color:var(--navy);border-bottom:1px solid var(--line)}.step h3 small{color:var(--muted);font-weight:500;margin-left:8px}
.step .body{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(0,1fr);gap:0}
.step img{width:100%;display:block;border-right:1px solid var(--line)}
.step ol{margin:0;padding:16px 18px 16px 18px;list-style:none;counter-reset:n}.step li{counter-increment:n;position:relative;padding-left:36px;margin:0 0 12px}
.step li:before{content:counter(n);position:absolute;left:0;top:1px;width:24px;height:24px;border-radius:12px;background:#e11d2e;color:#fff;font:700 13px/24px Arial;text-align:center}
.foot{color:var(--muted);font-size:13px;margin-top:32px}
@media (max-width:760px){.step .body{grid-template-columns:1fr}.step img{border-right:0;border-bottom:1px solid var(--line)}}
@media print{nav{display:none}header{padding:12px}.step{margin:10px 0}.step .body{grid-template-columns:1fr}}
</style></head><body>
<header><div class="w"><h1>GWS-ERP Picture Guide</h1><p>Where to click, screen by screen. The red numbers on each picture match the steps beside it.</p></div></header>
<nav>${sections.map((s) => `<a href="#${slug(s)}">${esc(s)}</a>`).join('')}</nav>
<main>${sections.map((sec) => `<h2 id="${slug(sec)}">${esc(sec)}</h2>${done.filter((s) => s.section === sec).map((s) => `<div class="step"><h3>${esc(s.title)}<small>${s.user ? `signed in as ${s.user}` : ''}</small></h3><div class="body"><img src="img/${s.file}" alt="${esc(s.title)}" loading="lazy"><ol>${s.text.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div></div>`).join('')}`).join('')}
<p class="foot">Made from the demo accounts (password ${PW}). Your screens show your own branch and data. For every detail, see Help &amp; Guide inside GWS-ERP.</p></main></body></html>`;
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  // printable PDF
  const pdfPage = await browser.newPage();
  await pdfPage.goto(`file://${path.join(OUT, 'index.html')}`, { waitUntil: 'load' });
  await pdfPage.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; })))));
  await pdfPage.pdf({ path: path.join(OUT, 'GWS-ERP-Picture-Guide.pdf'), format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  await browser.close();
  console.log(`Done: ${done.length} pictures → ${OUT}`);
  if (missing.length) console.log(`Marks not found:\n  ${missing.join('\n  ')}`);
})().catch((e) => { console.error(e); process.exit(1); });
