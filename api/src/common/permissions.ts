/**
 * Permission keys (§5.2) and the role catalogue (§5.1).
 * Roles are sets of keys; UserPermissionOverride rows add/remove keys per user.
 * This file is pure (no Nest / Prisma imports) so it can be shared by the seed script and tests.
 */

/** CC = credit card price (SRP + a percentage, default 4%); TIKTOK / SHOPEE / LAZADA = the e-commerce price lists the Owner edits (owner request 2026-09-30). */
export const PRICE_TIERS = ['RETAIL', 'DEALER', 'FRANCHISE', 'AGENT', 'WHOLESALE', 'CC', 'TIKTOK', 'SHOPEE', 'LAZADA'] as const;

export const APPROVAL_TYPES = [
  'COST_ON_RECEIVING',
  'MASTER_DATA_EDIT',
  'TRANSFER_INTERNAL',
  'TRANSFER_TO_FRANCHISE',
  'SPECIAL_PRICE',
  'POST_CLOSE_EDIT',
  'POST_CLOSE_EDIT_FRANCHISE',
  'EDIT_REQUEST',
  'WRITEOFF',
  'PRICE_CHANGE',
  'REVALUATION',
  'BEGINNING_BALANCE',
  'DISCREPANCY_RESOLUTION',
  'PERIOD_LOCK',
  'PERIOD_UNLOCK',
  'CONSIGNMENT_OUT',
  'WAREHOUSE_EDIT',
  'COUNT_REVISION',
  'AR_PAYMENT',
  'DISCREPANCY_EXPLANATION',
  'AUDIT_REVISION',
  'MASTER_DATA_NEW',
  'WAREHOUSE_IN',
  'WAREHOUSE_OUT',
  'CASH_DEPOSIT_EXTENSION',
  'CONSIGNMENT_CHECK_WH',
  'CONSIGNMENT_CHECK_BRANCH',
  'COST_EDIT',
  'ECOM_PULLOUT',
  'ECOM_SETTLEMENT',
  'TRANSFER_DIFF_REVIEW',
  'TRANSFER_DIFF_SENDER',
  'TRANSFER_DIFF_ADMIN',
  'SALES_TARGET',
  'OPENING_AR',
  'AGENT_INCENTIVE',
  'FRANCHISE_AR_EXTENSION',
  'CASH_DEPOSIT_AUDIT',
  'CASH_DEPOSIT_ACCOUNTING',
  'SIXPACK_OVERRIDE',
  'FRANCHISE_SHIPPING_EDIT',
  'MARKETING_PULLOUT',
  'PULLOUT_EXPENSE',
  'REPLACEMENT_TICKET',
  'SUPPLIER_RETURN',
  'AGENT_CONSIGNMENT_LIMIT',
  'OUTLET_DELETE',
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

const BASE_KEYS = [
  'product.view', 'product.edit', 'product.create',
  'price.edit', 'ecom.price.edit', 'cost.view', 'cost.edit',
  'supplier.view.code', 'supplier.view.name', 'supplier.edit',
  'location.view.all', 'location.view.own', 'location.edit',
  'receiving.create', 'receiving.approve_cost', 'warehouse.edit_others',
  'transfer.create', 'transfer.confirm', 'transfer.approve.internal', 'transfer.approve.franchise', 'transfer.resolve_discrepancy',
  'sale.create', 'sale.edit.sameday', 'sale.edit.postclose', 'sale.special_price.approve', 'sale.void',
  'ar.view', 'ar.collect', 'ar.approve', 'ar.opening', 'stock.flavor.set', 'incentive.prepare', 'incentive.view', 'incentive.hr', 'incentive.release',
  'expense.create.branch', 'expense.create.main', 'expense.view',
  'count.create', 'discrepancy.view', 'discrepancy.resolve', 'discrepancy.explain',
  'writeoff.create', 'writeoff.approve',
  'consignment.manage',
  'report.sales.own', 'report.sales.all', 'report.inventory.own', 'report.inventory.all', 'report.margin',
  'gl.view', 'gl.post', 'gl.voucher.create', 'gl.period.lock', 'gl.beginning_balance', 'gl.account.edit',
  'fs.income_statement', 'fs.balance_sheet',
  'payroll.view.summary', 'payroll.view.detail', 'payroll.edit', 'payroll.close', 'charge_form.finalize', 'employee.manage',
  'user.manage', 'role.manage', 'settings.thresholds', 'audit_log.view',
  'franchise.portal', 'franchise.expense', 'franchise.pnl',
  'dashboard.view',
  'notification.view',
  // branch cash fund (imprest): view all balances, set up / change the fund, spend & replenish at own branch, count & confirm in the store
  'cashfund.view.all', 'cashfund.manage', 'cashfund.use', 'cashfund.check',
  // store inspection report (Field Auditor), HR review
  'inspection.create', 'inspection.view', 'inspection.review',
  // charge a cash shortage to staff; record SSS / PhilHealth / Pag-IBIG remittances
  'charge.assign', 'contribution.remit',
  // corrections of reports: request (Audit Associate) and the per-staff revision log
  'revision.request', 'revision.view',
  // Executive Assistant: main bank entries, supplier payables, main office expenses, balance-sheet accounts only (owner request 2026-09-26)
  'bank.entry', 'bs.accounts.view',
  // Accounting edits journal entries (involved users and the Owner are notified)
  'gl.voucher.edit',
  // editing / deleting master data (Owner; Head Auditor edits products and suppliers)
  'master.delete',
  // incentive paid from a sale's cash, recorded as a branch expense (owner request 2026-09-27)
  'sale.incentive',
  // cash on hand not yet deposited: see all branches and set the days allowed per branch (Head Auditor, Admin); HR acts on notices (NTE)
  'cashdeposit.view.all', 'cashdeposit.settings', 'hr.notice',
  // consignment requests by associates (manager first, the Owner last)
  'consignment.request',
  // e-commerce (TikTok, Shopee, Lazada): upload orders / payouts / ads (E-comm Associate), see the reports, receive returned parcels (Warehouse)
  'ecom.manage', 'ecom.view', 'ecom.receive',
  // sales targets per branch and per agent: set (Sales Manager; the Owner approves) and follow; an agent's own sales at every branch
  'target.manage', 'target.view', 'agent.self',
  // franchise receivables (memo 2026-07-31): everyone's / own franchise's invoices, record payments (Accounting), waive charges and credit hold (Owner), request an extension (franchise owner)
  'franchise.ar.view', 'franchise.ar.own', 'franchise.ar.pay', 'franchise.ar.manage', 'franchise.ar.extend',
  // memorandums: write and issue (HR, Owner, Franchise Coordinators, Head Auditor)
  'memo.create',
  // 6-Pack Card stickers (Sales Associate), view all branches' stickers and redemptions
  'sixpack.issue', 'sixpack.view.all', 'sixpack.override',
  // Owner's e-commerce margin analysis
  'ecom.analysis',
  // upload waybills and read the SRP / fees / order income report (E-comm Associate, Head Auditor, Owner)
  'ecom.waybill',
  // sales from the warehouse, any channel (Franchise Coordinators), and the shipping charge billed to a franchise
  'sale.create.warehouse', 'franchise.shipping.fill',
  // summary of the stock given out to Prothin Marketing / GWS Marketing / BO
  'marketing.summary',
  // replacement tickets: open and tick them (every branch except a franchise); read all of them (auditors, Accounting)
  'replacement.create', 'replacement.view',
  // agent field work: see every agent outlets, itineraries and visit photos (Sales Manager, Head Auditor, Owner); manage areas, approve outlets, set consignment limits (Sales Manager)
  'outlet.view.all', 'outlet.manage',
  // Wheysted members (customers with a QR card and a portal): see and sort them, add / edit / import them, send email and SMS campaigns
  'member.view', 'member.manage', 'member.blast',
  // promos for the branches or the franchises (Owner and Head Auditor)
  'promo.issue',
] as const;

export const PERMISSION_KEYS: readonly string[] = [
  ...BASE_KEYS,
  ...PRICE_TIERS.map((t) => `price.view.${t}`),
  ...APPROVAL_TYPES.map((t) => `approval.act.${t}`),
];

export const ROLE_KEYS = [
  'ADMIN', 'EXTERNAL_AUDITOR', 'HEAD_AUDITOR', 'ASST_AUDITOR', 'AUDIT_ASSOCIATE',
  'WAREHOUSE_IN_CHARGE', 'WAREHOUSE_ASSOCIATE', 'SALES_ASSOCIATE', 'FRANCHISE_SALES_ASSOCIATE',
  'FRANCHISE_OWNER', 'CUSTOM', 'ACCOUNTING_HEAD', 'ACCOUNTING_ASSOCIATE', 'HR_STAFF', 'FIELD_AUDITOR', 'EXECUTIVE_ASSISTANT',
  'ECOMM_ASSOCIATE', 'SALES_MANAGER', 'AGENT', 'FRANCHISE_COORDINATOR', 'ASST_FRANCHISE_COORDINATOR',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Roles whose data access is limited to their assigned location(s) (§5.4). */
export const LOCATION_SCOPED_ROLES: RoleKey[] = [
  'SALES_ASSOCIATE', 'FRANCHISE_SALES_ASSOCIATE', 'FRANCHISE_OWNER', 'WAREHOUSE_IN_CHARGE', 'WAREHOUSE_ASSOCIATE',
];
/** Roles that must have exactly one location assignment. */
export const SINGLE_LOCATION_ROLES: RoleKey[] = ['SALES_ASSOCIATE', 'FRANCHISE_SALES_ASSOCIATE', 'FRANCHISE_OWNER'];
/** Roles for which TOTP 2FA is mandatory (§3). */
export const TOTP_REQUIRED_ROLES: RoleKey[] = ['ADMIN', 'EXTERNAL_AUDITOR', 'HEAD_AUDITOR', 'ACCOUNTING_HEAD'];
/** Roles with a 12 h idle timeout; everyone else 30 min (§3). */
export const LONG_SESSION_ROLES: RoleKey[] = ['SALES_ASSOCIATE', 'FRANCHISE_SALES_ASSOCIATE', 'FRANCHISE_OWNER'];
/** Roles that never see inventory / sales screens (§5.4). */
export const NO_OPS_ROLES: RoleKey[] = ['HR_STAFF'];

const allPriceTiers = PRICE_TIERS.map((t) => `price.view.${t}`);
const approvals = (...types: ApprovalType[]) => types.map((t) => `approval.act.${t}`);

const COST_BUNDLE = ['cost.view', 'supplier.view.name', 'report.margin', ...allPriceTiers];
const READ_ALL = [
  'product.view', 'supplier.view.code', 'location.view.all', 'ar.view', 'expense.view', 'discrepancy.view',
  'report.sales.all', 'report.inventory.all', 'dashboard.view', 'notification.view',
];
const ACCOUNTING_BASE = ['gl.view', 'gl.post', 'gl.voucher.create', 'expense.create.main', 'gl.account.edit'];

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  permissions: string[];
}

export const ROLE_CATALOGUE: RoleDefinition[] = [
  {
    key: 'ADMIN',
    name: 'Admin (Owner)',
    description: 'All access. Final approver. Sets thresholds, min stock, beginning balances.',
    permissions: [...PERMISSION_KEYS],
  },
  {
    key: 'EXTERNAL_AUDITOR',
    name: 'External Auditor',
    description: 'Read-only everything incl. balance sheet, payroll, supplier names. No edits, no approvals.',
    permissions: ['franchise.ar.view', 'sixpack.view.all', 
      ...READ_ALL, ...COST_BUNDLE, 'gl.view', 'fs.income_statement', 'fs.balance_sheet',
      'payroll.view.summary', 'payroll.view.detail', 'audit_log.view', 'cashfund.view.all', 'inspection.view', 'revision.view', 'ecom.view',
    ],
  },
  {
    key: 'HEAD_AUDITOR',
    name: 'Head Auditor',
    description: 'Edits/inputs anything; master data with Admin approval; enters/approves costs; approves internal transfers, post-close edits, write-offs.',
    permissions: ['promo.issue', 'member.view', 'outlet.view.all', 'approval.act.REPLACEMENT_TICKET', 'approval.act.SUPPLIER_RETURN', 'replacement.create', 'replacement.view', 'approval.act.MARKETING_PULLOUT', 'marketing.summary', 'sixpack.override', 'ecom.waybill', 'approval.act.CASH_DEPOSIT_AUDIT', 'franchise.ar.view', 'memo.create', 'sixpack.view.all', 'stock.flavor.set', 
      ...READ_ALL, ...COST_BUNDLE, 'product.edit', 'product.create', 'price.edit', 'cost.edit', 'supplier.edit',
      'receiving.create', 'receiving.approve_cost', 'transfer.create', 'transfer.confirm', 'transfer.approve.internal', 'transfer.resolve_discrepancy',
      'sale.create', 'sale.edit.sameday', 'sale.edit.postclose', 'sale.void', 'ar.collect', 'expense.create.branch',
      'count.create', 'discrepancy.resolve', 'writeoff.create', 'writeoff.approve', 'consignment.manage', 'gl.view', 'audit_log.view',
      'cashfund.view.all', 'cashfund.check', 'inspection.view', 'inspection.create', 'charge.assign',
      ...approvals('COST_ON_RECEIVING', 'TRANSFER_INTERNAL', 'POST_CLOSE_EDIT', 'WRITEOFF', 'DISCREPANCY_RESOLUTION', 'EDIT_REQUEST', 'COUNT_REVISION', 'DISCREPANCY_EXPLANATION', 'AUDIT_REVISION', 'CASH_DEPOSIT_EXTENSION', 'CONSIGNMENT_CHECK_BRANCH', 'COST_EDIT', 'TRANSFER_DIFF_REVIEW'),
      'revision.view', 'sale.incentive', 'cashdeposit.view.all', 'cashdeposit.settings', 'ecom.view', 'target.view',
    ],
  },
  {
    key: 'ASST_AUDITOR',
    name: 'Assistant Auditor',
    description: 'Edits/inputs transactions with Admin + Head Auditor approval. No master data edits. Approves internal transfers and post-close edits.',
    permissions: ['replacement.create', 'replacement.view', 'marketing.summary', 'approval.act.CASH_DEPOSIT_AUDIT', 'franchise.ar.view', 'sixpack.view.all', 'stock.flavor.set', 
      ...READ_ALL, ...COST_BUNDLE, 'receiving.create', 'transfer.create', 'transfer.confirm', 'transfer.approve.internal',
      'sale.create', 'sale.edit.sameday', 'ar.collect', 'expense.create.branch', 'count.create', 'writeoff.create', 'gl.view',
      'cashfund.view.all', 'cashfund.check', 'inspection.view', 'inspection.create', 'revision.view', 'cashdeposit.view.all', 'sale.incentive',
      ...approvals('TRANSFER_INTERNAL', 'POST_CLOSE_EDIT', 'EDIT_REQUEST', 'CONSIGNMENT_CHECK_BRANCH'), 'consignment.request',
    ],
  },
  {
    key: 'AUDIT_ASSOCIATE',
    name: 'Audit Associate',
    description: 'Views branch reports including supplier cost. Requests corrections (revisions) of branch documents; the Head Auditor approves; the staff involved are notified and the revision is logged.',
    permissions: ['replacement.view', 'marketing.summary', 'approval.act.CASH_DEPOSIT_AUDIT', 'franchise.ar.view', 'sixpack.view.all', ...READ_ALL, ...COST_BUNDLE, 'inspection.view', 'revision.request', 'revision.view', 'cashdeposit.view.all'],
  },
  {
    key: 'WAREHOUSE_IN_CHARGE',
    name: 'Warehouse In-Charge',
    description: 'Inputs warehouse receiving, transfers (to any branch or franchise), counts, write-offs and the warehouse\'s expenses; costs are entered and approved by the Head Auditor. Approves every warehouse associate\'s goods in and out before stock moves (own entries need no second approval). Can edit an associate\'s entry, which takes effect only after that associate accepts it. No cost.',
    permissions: ['replacement.create', 'expense.create.branch', 'expense.view', 'stock.flavor.set', 
      'product.view', 'supplier.view.code', 'location.view.own', 'receiving.create', 'transfer.create', 'transfer.confirm', 'warehouse.edit_others', 'approval.act.CONSIGNMENT_CHECK_WH', 'consignment.request', 'approval.act.WAREHOUSE_EDIT', 'approval.act.WAREHOUSE_IN', 'approval.act.WAREHOUSE_OUT', 'approval.act.ECOM_PULLOUT', 'ecom.receive', 'approval.act.TRANSFER_DIFF_SENDER',
      'count.create', 'writeoff.create', 'report.inventory.own', 'dashboard.view', 'notification.view', 'price.view.RETAIL', 'discrepancy.explain',
    ],
  },
  {
    key: 'WAREHOUSE_ASSOCIATE',
    name: 'Warehouse Associate',
    description: 'Creates receiving docs (qty, expiry, batch) and transfers from the warehouse to any branch or franchise, and records the warehouse\'s expenses. Accepts or rejects the In-Charge\'s edits to own entries. Cost hidden.',
    permissions: ['replacement.create', 'expense.create.branch', 'expense.view', 'consignment.request', 'product.view', 'supplier.view.code', 'location.view.own', 'receiving.create', 'transfer.create', 'transfer.confirm', 'report.inventory.own', 'dashboard.view', 'notification.view', 'approval.act.WAREHOUSE_EDIT', 'discrepancy.explain'],
  },
  {
    key: 'SALES_ASSOCIATE',
    name: 'Sales Associate',
    description: 'Sales, expenses, pull-outs/transfers for own branch. Own branch reports only. Locked at midnight.',
    permissions: ['replacement.create', 'sixpack.issue', 'stock.flavor.set', 
      'product.view', 'location.view.own', 'price.view.RETAIL', 'price.view.DEALER', 'price.view.AGENT', 'price.view.CC', 'price.view.FRANCHISE',
      'transfer.create', 'transfer.confirm', 'sale.create', 'sale.edit.sameday', 'ar.view', 'ar.collect',
      'expense.create.branch', 'expense.view', 'count.create', 'report.sales.own', 'report.inventory.own', 'dashboard.view', 'notification.view', 'cashfund.use', 'discrepancy.explain',
      'sale.incentive', 'consignment.request', 'approval.act.TRANSFER_DIFF_SENDER',
    ],
  },
  {
    key: 'FRANCHISE_SALES_ASSOCIATE',
    name: 'Franchise Sales Associate',
    description: 'Receives stock, enters sales for one franchise. Same-day edits only.',
    permissions: ['sixpack.issue', 'product.view', 'location.view.own', 'price.view.RETAIL', 'price.view.CC', 'transfer.confirm', 'sale.create', 'sale.edit.sameday', 'ar.view', 'ar.collect', 'report.sales.own', 'report.inventory.own', 'franchise.portal', 'franchise.expense', 'dashboard.view', 'notification.view'],
  },
  {
    key: 'FRANCHISE_OWNER',
    name: 'Franchise Owner',
    description: 'Receives stock, approves associate edits, own P&L, own expenses. Sees franchise price tier only.',
    permissions: ['franchise.ar.own', 'franchise.ar.extend', 'sixpack.issue', 'stock.flavor.set', 
      'product.view', 'location.view.own', 'price.view.RETAIL', 'price.view.CC', 'price.view.FRANCHISE', 'transfer.confirm', 'sale.create', 'sale.edit.sameday', 'sale.edit.postclose',
      'ar.view', 'ar.collect', 'count.create', 'report.sales.own', 'report.inventory.own', 'franchise.portal', 'franchise.expense', 'franchise.pnl',
      'dashboard.view', 'notification.view', ...approvals('POST_CLOSE_EDIT_FRANCHISE', 'TRANSFER_DIFF_SENDER'),
    ],
  },
  {
    key: 'CUSTOM',
    name: 'Custom',
    description: 'Configurable role built from permission keys + per-user overrides.',
    permissions: ['dashboard.view', 'notification.view', 'product.view', 'location.view.own', 'report.inventory.own'],
  },
  {
    key: 'ACCOUNTING_HEAD',
    name: 'Accounting Head',
    description: 'Ledger, vouchers, main expenses, payroll (per employee), closes payroll. TB and ledgers; no IS/BS pages.',
    permissions: ['replacement.view', 'approval.act.PULLOUT_EXPENSE', 'marketing.summary', 'approval.act.CASH_DEPOSIT_ACCOUNTING', 'franchise.ar.view', 'franchise.ar.pay', 'sixpack.view.all', 
      ...READ_ALL, ...COST_BUNDLE, ...ACCOUNTING_BASE, 'gl.period.lock', 'gl.beginning_balance',
      'payroll.view.summary', 'payroll.view.detail', 'payroll.close', 'expense.view', 'cashfund.view.all', 'cashfund.manage', 'contribution.remit',
      'ar.collect', 'ar.approve', 'ar.opening', 'incentive.view', 'incentive.release', ...approvals('AR_PAYMENT', 'ECOM_SETTLEMENT', 'AGENT_INCENTIVE'), 'gl.voucher.edit', 'bank.entry', 'bs.accounts.view', 'ecom.view',
    ],
  },
  {
    key: 'ACCOUNTING_ASSOCIATE',
    name: 'Accounting Associate',
    description: 'Ledger, vouchers, main expenses. Payroll totals only.',
    permissions: ['replacement.view', 'approval.act.PULLOUT_EXPENSE', 'marketing.summary', 'approval.act.CASH_DEPOSIT_ACCOUNTING', 'franchise.ar.view', 'franchise.ar.pay', 'sixpack.view.all', ...READ_ALL, ...COST_BUNDLE, ...ACCOUNTING_BASE, 'payroll.view.summary', 'cashfund.view.all', 'ar.collect', 'ar.approve', 'ar.opening', 'incentive.view', 'incentive.release', ...approvals('AGENT_INCENTIVE'), ...approvals('AR_PAYMENT'), 'gl.voucher.edit', 'bank.entry', 'bs.accounts.view', 'ecom.view'],
  },
  {
    key: 'HR_STAFF',
    name: 'HR Staff',
    description: 'Payroll runs, employee master, loans/advances, charge-form allocation. Zero access to inventory/sales.',
    permissions: ['memo.create', 'sixpack.view.all', 'incentive.view', 'incentive.hr', 'payroll.view.summary', 'payroll.view.detail', 'payroll.edit', 'employee.manage', 'location.view.all', 'charge_form.finalize', 'dashboard.view', 'notification.view', 'inspection.view', 'inspection.review', 'contribution.remit', 'revision.view', 'hr.notice'],
  },
  {
    key: 'FIELD_AUDITOR',
    name: 'Field Auditor',
    description: 'View-only inventory of every branch, warehouse and franchise (stock, expiry, movements, counts); records Actual Inventory Counts, confirms the cash fund found in the store and submits the Store Inspection Report to HR. No sales, no cost, no edits.',
    permissions: ['product.view', 'location.view.all', 'price.view.RETAIL', 'count.create', 'discrepancy.view', 'report.inventory.all', 'dashboard.view', 'notification.view', 'cashfund.check', 'inspection.create'],
  },
  {
    key: 'EXECUTIVE_ASSISTANT',
    name: 'Executive Assistant',
    description: 'Main office: records receipts and payments on the main bank accounts (chooses the bank account and the book: advances to, advances from, supplier payables, office expenses…), sees supplier payables and main office expenses, and the balance of each balance-sheet account. No branch reports, no supplier cost, no income statement.',
    permissions: ['dashboard.view', 'notification.view', 'bank.entry', 'bs.accounts.view', 'supplier.view.code', 'supplier.view.name'],
  },
  {
    key: 'ECOMM_ASSOCIATE',
    name: 'E-comm Associate',
    description: 'E-commerce arm (TikTok, Shopee, Lazada, each kept separate): uploads the platform order / waybill files, which draft the warehouse pull-out automatically (the Warehouse In-Charge approves); records returned parcels; uploads payout (settlement) files for Accounting and the monthly ads. Sees selling prices, fees and the e-commerce report; never cost. No separate e-commerce stock: items come from the Warehouse.',
    permissions: ['ecom.waybill', 'ecom.manage', 'ecom.view', 'product.view', 'price.view.RETAIL', 'price.view.TIKTOK', 'price.view.SHOPEE', 'price.view.LAZADA', 'dashboard.view', 'notification.view'],
  },
  {
    key: 'SALES_MANAGER',
    name: 'Sales Manager',
    description: 'Monitors sales targets and their achievement. Sees the sales of every branch, agent and e-commerce platform (amounts, channels, payment types, top products), the Daily Sales Reports, customer contacts and the receivables of dealers, franchises and agents. Sets monthly targets per branch and per agent (the Owner approves) and links agents to their accounts. Assigns areas to agents, approves the outlets / gyms agents upload, follows their daily itineraries, visit photos and consignments, and sets each agent\'s maximum consignment (the Owner approves). Never sees cost, margin, supplier data, cash counts, payroll or the books; records no sales or money.',
    permissions: ['member.view', 'member.manage', 'member.blast', 'outlet.view.all', 'outlet.manage', 'replacement.view', 'sixpack.view.all', 'incentive.prepare', 'incentive.view', 'target.manage', 'target.view', 'report.sales.all', 'ar.view', 'product.view', 'location.view.all', 'price.view.RETAIL', 'price.view.CC', 'price.view.DEALER', 'price.view.AGENT', 'price.view.FRANCHISE', 'dashboard.view', 'notification.view'],
  },
  {
    key: 'FRANCHISE_COORDINATOR',
    name: 'Franchise Coordinator',
    description: 'Looks after the franchise partners: sees every franchise\'s receivables (invoices, penalties, interest, extension requests) and their stock transfers, issues memorandums to franchise partners and staff. Never sees cost. May record sales from the warehouse (franchises and every other channel), and fills in the shipping charge billed to a franchise.',
    permissions: ['franchise.ar.view', 'sale.create.warehouse', 'franchise.shipping.fill', 'price.view.AGENT', 'price.view.TIKTOK', 'price.view.SHOPEE', 'price.view.LAZADA', 'memo.create', 'ar.view', 'product.view', 'location.view.all', 'report.sales.all', 'report.inventory.all', 'price.view.RETAIL', 'price.view.FRANCHISE', 'price.view.DEALER', 'price.view.CC', 'dashboard.view', 'notification.view', 'discrepancy.view'],
  },
  {
    key: 'ASST_FRANCHISE_COORDINATOR',
    name: 'Asst. Franchise Coordinator',
    description: 'Helps the Franchise Coordinator: same views of franchise receivables and transfers, and may issue memorandums. Never sees cost. May record sales from the warehouse (franchises and every other channel), and fills in the shipping charge billed to a franchise.',
    permissions: ['franchise.ar.view', 'sale.create.warehouse', 'franchise.shipping.fill', 'price.view.AGENT', 'price.view.TIKTOK', 'price.view.SHOPEE', 'price.view.LAZADA', 'memo.create', 'ar.view', 'product.view', 'location.view.all', 'report.sales.all', 'report.inventory.all', 'price.view.RETAIL', 'price.view.FRANCHISE', 'price.view.DEALER', 'price.view.CC', 'dashboard.view', 'notification.view', 'discrepancy.view'],
  },
  {
    key: 'AGENT',
    name: 'Agent',
    description: 'A sales agent: sees only their own sales, at whichever branch the items came from, their monthly target and how much of it is achieved, and their own receivables (customers who have not paid yet) with due dates. Uploads the outlets / gyms in their area (the Sales Manager approves them), plans and reports their daily itinerary with photos, and sees the orders of their outlets and the consignments they are responsible for. Retail and agent prices only; no cost, no other agent\'s or branch\'s data.',
    permissions: ['agent.self', 'product.view', 'price.view.RETAIL', 'price.view.AGENT', 'dashboard.view', 'notification.view'],
  },
];

export const ROLE_BY_KEY: Record<string, RoleDefinition> = Object.fromEntries(ROLE_CATALOGUE.map((r) => [r.key, r]));

/** Effective permission set = role permissions ± overrides. */
export function effectivePermissions(rolePermissions: string[], overrides: { permissionKey: string; granted: boolean }[]): Set<string> {
  const set = new Set(rolePermissions);
  for (const o of overrides) {
    if (o.granted) set.add(o.permissionKey);
    else set.delete(o.permissionKey);
  }
  return set;
}

/** §6.1 routing table. `dynamic` types are resolved by ApprovalService at request time. */
export const APPROVAL_ROUTING: Record<ApprovalType, { roles: RoleKey[]; anyOf?: boolean; dynamic?: boolean }> = {
  COST_ON_RECEIVING: { roles: ['HEAD_AUDITOR'] },
  MASTER_DATA_EDIT: { roles: ['ADMIN'] },
  TRANSFER_INTERNAL: { roles: ['HEAD_AUDITOR', 'ASST_AUDITOR'], anyOf: true },
  TRANSFER_TO_FRANCHISE: { roles: ['ADMIN'] },
  SPECIAL_PRICE: { roles: ['ADMIN'] },
  POST_CLOSE_EDIT: { roles: ['HEAD_AUDITOR', 'ASST_AUDITOR'] },
  POST_CLOSE_EDIT_FRANCHISE: { roles: ['FRANCHISE_OWNER'], dynamic: true },
  EDIT_REQUEST: { roles: ['ADMIN'], dynamic: true },
  WRITEOFF: { roles: ['HEAD_AUDITOR'] },
  PRICE_CHANGE: { roles: ['ADMIN'] },
  REVALUATION: { roles: ['ADMIN'] },
  BEGINNING_BALANCE: { roles: ['ADMIN'] },
  DISCREPANCY_RESOLUTION: { roles: ['HEAD_AUDITOR'] },
  PERIOD_LOCK: { roles: ['ADMIN'] },
  PERIOD_UNLOCK: { roles: ['ADMIN'] },
  CONSIGNMENT_OUT: { roles: ['ADMIN'] },
  /** Person-targeted: the user who entered the document must accept an edit made by someone else (Warehouse In-Charge). */
  WAREHOUSE_EDIT: { roles: [], dynamic: true },
  /** A submitted inventory count sheet is locked; a revision needs the Head Auditor only (Admin is notified, not an approver). */
  COUNT_REVISION: { roles: ['HEAD_AUDITOR'] },
  /** AR payment entered by a branch: either Accounting Associate or Accounting Head approves before it is applied. */
  AR_PAYMENT: { roles: ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_HEAD'], anyOf: true },
  /** Branch staff explain an inventory discrepancy before it is charged to them: HR is notified, the Head Auditor decides. */
  DISCREPANCY_EXPLANATION: { roles: ['HEAD_AUDITOR'] },
  /** Correction requested by the Audit Associate: Head Auditor only; the staff involved are notified; recorded in the revision log. */
  AUDIT_REVISION: { roles: ['HEAD_AUDITOR'] },
  /** New master data (products, suppliers, customers, employees, user accounts, …) entered by anyone but the Owner waits for the Owner. */
  MASTER_DATA_NEW: { roles: ['ADMIN'] },
  /** Goods into the warehouse entered by a Warehouse Associate (receiving after the cost is approved, transfer-in confirmation): the In-Charge approves before stock is posted. */
  WAREHOUSE_IN: { roles: ['WAREHOUSE_IN_CHARGE'] },
  /** Goods out of the warehouse prepared by a Warehouse Associate (pull-outs / transfers, write-offs): the In-Charge approves first. */
  WAREHOUSE_OUT: { roles: ['WAREHOUSE_IN_CHARGE'] },
  /** More days to deposit a day's cash sales: the Head Auditor and Admin must both approve. */
  CASH_DEPOSIT_EXTENSION: { roles: ['HEAD_AUDITOR', 'ADMIN'] },
  /** Consignment prepared by a Warehouse Associate: the In-Charge checks it first; the Owner approves last (CONSIGNMENT_OUT). */
  CONSIGNMENT_CHECK_WH: { roles: ['WAREHOUSE_IN_CHARGE'] },
  /** Consignment prepared by a Sales Associate: the Head Auditor or Asst Auditor checks it first; the Owner approves last. */
  CONSIGNMENT_CHECK_BRANCH: { roles: ['HEAD_AUDITOR', 'ASST_AUDITOR'], anyOf: true },
  /** Cost typed directly on a product: the Head Auditor and the Owner, except the one who typed it. */
  COST_EDIT: { roles: ['HEAD_AUDITOR', 'ADMIN'] },
  /** E-commerce pull-out drafted from the uploaded orders: the Warehouse In-Charge is the only approver. */
  ECOM_PULLOUT: { roles: ['WAREHOUSE_IN_CHARGE'] },
  /** E-commerce payout (settlement) file: the Accounting Head checks the fees and payout before the sale and fees are posted. */
  ECOM_SETTLEMENT: { roles: ['ACCOUNTING_HEAD'] },
  /** Received quantity differs from the transfer form: the Head Auditor reviews first. */
  TRANSFER_DIFF_REVIEW: { roles: ['HEAD_AUDITOR'] },
  /** Then the sending branch confirms (any one of its staff) within 2 days. */
  TRANSFER_DIFF_SENDER: { roles: [], dynamic: true, anyOf: true },
  /** The sending branch disagrees or does not answer: the Owner decides. */
  TRANSFER_DIFF_ADMIN: { roles: ['ADMIN'] },
  /** A monthly sales target (branch or agent) set by the Sales Manager: the Owner approves. */
  SALES_TARGET: { roles: ['ADMIN'] },
  OPENING_AR: { roles: ['ADMIN'] },
  AGENT_INCENTIVE: { roles: ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_HEAD', 'ADMIN'] },
  /** A franchise owner asks for more time on an invoice: the Owner decides; auditors, Accounting and the Franchise Coordinators are told. */
  FRANCHISE_AR_EXTENSION: { roles: ['ADMIN'] },
  /** A 6-Pack card that cannot be tagged to a customer (data missing): the Head Auditor asks, the Owner approves. */
  SIXPACK_OVERRIDE: { roles: ['ADMIN'] },
  FRANCHISE_SHIPPING_EDIT: { roles: ['ADMIN'] },
  // stock given out to Prothin Marketing / GWS Marketing / bad orders: the Head Auditor approves; an expense endorsed to Accounting is accepted by Accounting
  MARKETING_PULLOUT: { roles: ['HEAD_AUDITOR', 'ADMIN'], anyOf: true },
  PULLOUT_EXPENSE: { roles: ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_HEAD', 'ADMIN'], anyOf: true },
  // replacement tickets: the Head Auditor approves a replacement handed to a customer, and the return of items to a supplier
  REPLACEMENT_TICKET: { roles: ['HEAD_AUDITOR', 'ADMIN'], anyOf: true },
  SUPPLIER_RETURN: { roles: ['HEAD_AUDITOR', 'ADMIN'], anyOf: true },
  // maximum consignment per agent: the Sales Manager proposes, the Owner approves
  AGENT_CONSIGNMENT_LIMIT: { roles: ['ADMIN'] },
  // removing an outlet from the database: the Sales Manager asks, the Owner approves (only with no order in the last 3 months)
  OUTLET_DELETE: { roles: ['ADMIN'] },
  /** A branch's cash deposit slip: the Audit Associate checks it first (the auditors and the Owner may too) ... */
  CASH_DEPOSIT_AUDIT: { roles: ['AUDIT_ASSOCIATE', 'HEAD_AUDITOR', 'ASST_AUDITOR', 'ADMIN'], anyOf: true },
  /** ... then the Accounting Associate (the Accounting Head and the Owner may too). */
  CASH_DEPOSIT_ACCOUNTING: { roles: ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_HEAD', 'ADMIN'], anyOf: true },
};

/** EDIT_REQUEST approvers depend on who asks (§6.1). */
export function editRequestApprovers(requesterRole: RoleKey): RoleKey[] {
  switch (requesterRole) {
    case 'HEAD_AUDITOR': return ['ADMIN'];
    case 'ASST_AUDITOR': return ['ADMIN', 'HEAD_AUDITOR'];
    case 'AUDIT_ASSOCIATE': return ['ADMIN', 'HEAD_AUDITOR', 'ASST_AUDITOR'];
    case 'WAREHOUSE_IN_CHARGE': return ['ADMIN'];
    default: return ['ADMIN', 'HEAD_AUDITOR'];
  }
}
