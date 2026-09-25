/**
 * Permission keys (§5.2) and the role catalogue (§5.1).
 * Roles are sets of keys; UserPermissionOverride rows add/remove keys per user.
 * This file is pure (no Nest / Prisma imports) so it can be shared by the seed script and tests.
 */

export const PRICE_TIERS = ['RETAIL', 'DEALER', 'FRANCHISE', 'AGENT', 'WHOLESALE'] as const;

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
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

const BASE_KEYS = [
  'product.view', 'product.edit', 'product.create',
  'price.edit', 'cost.view', 'cost.edit',
  'supplier.view.code', 'supplier.view.name', 'supplier.edit',
  'location.view.all', 'location.view.own', 'location.edit',
  'receiving.create', 'receiving.approve_cost', 'warehouse.edit_others',
  'transfer.create', 'transfer.confirm', 'transfer.approve.internal', 'transfer.approve.franchise', 'transfer.resolve_discrepancy',
  'sale.create', 'sale.edit.sameday', 'sale.edit.postclose', 'sale.special_price.approve', 'sale.void',
  'ar.view', 'ar.collect',
  'expense.create.branch', 'expense.create.main', 'expense.view',
  'count.create', 'discrepancy.view', 'discrepancy.resolve',
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
] as const;

export const PERMISSION_KEYS: readonly string[] = [
  ...BASE_KEYS,
  ...PRICE_TIERS.map((t) => `price.view.${t}`),
  ...APPROVAL_TYPES.map((t) => `approval.act.${t}`),
];

export const ROLE_KEYS = [
  'ADMIN', 'EXTERNAL_AUDITOR', 'HEAD_AUDITOR', 'ASST_AUDITOR', 'AUDIT_ASSOCIATE',
  'WAREHOUSE_IN_CHARGE', 'WAREHOUSE_ASSOCIATE', 'SALES_ASSOCIATE', 'FRANCHISE_SALES_ASSOCIATE',
  'FRANCHISE_OWNER', 'CUSTOM', 'ACCOUNTING_HEAD', 'ACCOUNTING_ASSOCIATE', 'HR_STAFF', 'FIELD_AUDITOR',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Roles whose data access is limited to their assigned location(s) (§5.4). */
export const LOCATION_SCOPED_ROLES: RoleKey[] = [
  'SALES_ASSOCIATE', 'FRANCHISE_SALES_ASSOCIATE', 'FRANCHISE_OWNER', 'WAREHOUSE_IN_CHARGE', 'WAREHOUSE_ASSOCIATE', 'FIELD_AUDITOR',
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
    permissions: [
      ...READ_ALL, ...COST_BUNDLE, 'gl.view', 'fs.income_statement', 'fs.balance_sheet',
      'payroll.view.summary', 'payroll.view.detail', 'audit_log.view',
    ],
  },
  {
    key: 'HEAD_AUDITOR',
    name: 'Head Auditor',
    description: 'Edits/inputs anything; master data with Admin approval; enters/approves costs; approves internal transfers, post-close edits, write-offs.',
    permissions: [
      ...READ_ALL, ...COST_BUNDLE, 'product.edit', 'product.create', 'price.edit', 'cost.edit', 'supplier.edit',
      'receiving.create', 'receiving.approve_cost', 'transfer.create', 'transfer.confirm', 'transfer.approve.internal', 'transfer.resolve_discrepancy',
      'sale.create', 'sale.edit.sameday', 'sale.edit.postclose', 'sale.void', 'ar.collect', 'expense.create.branch',
      'count.create', 'discrepancy.resolve', 'writeoff.create', 'writeoff.approve', 'consignment.manage', 'gl.view', 'audit_log.view',
      ...approvals('COST_ON_RECEIVING', 'TRANSFER_INTERNAL', 'POST_CLOSE_EDIT', 'WRITEOFF', 'DISCREPANCY_RESOLUTION', 'EDIT_REQUEST'),
    ],
  },
  {
    key: 'ASST_AUDITOR',
    name: 'Assistant Auditor',
    description: 'Edits/inputs transactions with Admin + Head Auditor approval. No master data edits. Approves internal transfers and post-close edits.',
    permissions: [
      ...READ_ALL, ...COST_BUNDLE, 'receiving.create', 'transfer.create', 'transfer.confirm', 'transfer.approve.internal',
      'sale.create', 'sale.edit.sameday', 'ar.collect', 'expense.create.branch', 'count.create', 'writeoff.create', 'gl.view',
      ...approvals('TRANSFER_INTERNAL', 'POST_CLOSE_EDIT', 'EDIT_REQUEST'),
    ],
  },
  {
    key: 'AUDIT_ASSOCIATE',
    name: 'Audit Associate',
    description: 'Views branch reports. Can request edits (routed to Admin + Head + Asst). No cost.',
    permissions: [...READ_ALL, 'price.view.RETAIL'],
  },
  {
    key: 'WAREHOUSE_IN_CHARGE',
    name: 'Warehouse In-Charge',
    description: 'Inputs warehouse receiving, transfers (to any branch or franchise), counts and write-offs through the same approvals as the associate; costs are entered and approved by the Head Auditor. Can edit an associate\'s entry, which takes effect only after that associate accepts it. No cost.',
    permissions: [
      'product.view', 'supplier.view.code', 'location.view.own', 'receiving.create', 'transfer.create', 'transfer.confirm', 'warehouse.edit_others', 'approval.act.WAREHOUSE_EDIT',
      'count.create', 'writeoff.create', 'report.inventory.own', 'dashboard.view', 'notification.view', 'price.view.RETAIL',
    ],
  },
  {
    key: 'WAREHOUSE_ASSOCIATE',
    name: 'Warehouse Associate',
    description: 'Creates receiving docs (qty, expiry, batch) and transfers from the warehouse to any branch or franchise. Accepts or rejects the In-Charge\'s edits to own entries. Cost hidden.',
    permissions: ['product.view', 'supplier.view.code', 'location.view.own', 'receiving.create', 'transfer.create', 'transfer.confirm', 'report.inventory.own', 'dashboard.view', 'notification.view', 'approval.act.WAREHOUSE_EDIT'],
  },
  {
    key: 'SALES_ASSOCIATE',
    name: 'Sales Associate',
    description: 'Sales, expenses, pull-outs/transfers for own branch. Own branch reports only. Locked at midnight.',
    permissions: [
      'product.view', 'location.view.own', 'price.view.RETAIL', 'price.view.DEALER', 'price.view.AGENT',
      'transfer.create', 'transfer.confirm', 'sale.create', 'sale.edit.sameday', 'ar.view', 'ar.collect',
      'expense.create.branch', 'expense.view', 'count.create', 'report.sales.own', 'report.inventory.own', 'dashboard.view', 'notification.view',
    ],
  },
  {
    key: 'FRANCHISE_SALES_ASSOCIATE',
    name: 'Franchise Sales Associate',
    description: 'Receives stock, enters sales for one franchise. Same-day edits only.',
    permissions: ['product.view', 'location.view.own', 'price.view.RETAIL', 'transfer.confirm', 'sale.create', 'sale.edit.sameday', 'ar.view', 'ar.collect', 'report.sales.own', 'report.inventory.own', 'franchise.portal', 'franchise.expense', 'dashboard.view', 'notification.view'],
  },
  {
    key: 'FRANCHISE_OWNER',
    name: 'Franchise Owner',
    description: 'Receives stock, approves associate edits, own P&L, own expenses. Sees franchise price tier only.',
    permissions: [
      'product.view', 'location.view.own', 'price.view.RETAIL', 'price.view.FRANCHISE', 'transfer.confirm', 'sale.create', 'sale.edit.sameday', 'sale.edit.postclose',
      'ar.view', 'ar.collect', 'count.create', 'report.sales.own', 'report.inventory.own', 'franchise.portal', 'franchise.expense', 'franchise.pnl',
      'dashboard.view', 'notification.view', ...approvals('POST_CLOSE_EDIT_FRANCHISE'),
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
    permissions: [
      ...READ_ALL, ...COST_BUNDLE, ...ACCOUNTING_BASE, 'gl.period.lock', 'gl.beginning_balance',
      'payroll.view.summary', 'payroll.view.detail', 'payroll.close', 'expense.view',
    ],
  },
  {
    key: 'ACCOUNTING_ASSOCIATE',
    name: 'Accounting Associate',
    description: 'Ledger, vouchers, main expenses. Payroll totals only.',
    permissions: [...READ_ALL, ...COST_BUNDLE, ...ACCOUNTING_BASE, 'payroll.view.summary'],
  },
  {
    key: 'HR_STAFF',
    name: 'HR Staff',
    description: 'Payroll runs, employee master, loans/advances, charge-form allocation. Zero access to inventory/sales.',
    permissions: ['payroll.view.summary', 'payroll.view.detail', 'payroll.edit', 'employee.manage', 'charge_form.finalize', 'dashboard.view', 'notification.view'],
  },
  {
    key: 'FIELD_AUDITOR',
    name: 'Field Auditor',
    description: 'Read-only sales & inventory for assigned branches; creates Actual Inventory Count.',
    permissions: ['product.view', 'location.view.own', 'price.view.RETAIL', 'count.create', 'discrepancy.view', 'report.sales.own', 'report.inventory.own', 'dashboard.view', 'notification.view'],
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
