import { describe, expect, it } from 'vitest';
import { LOCATION_SCOPED_ROLES, APPROVAL_ROUTING, PERMISSION_KEYS, ROLE_CATALOGUE, effectivePermissions, editRequestApprovers, TOTP_REQUIRED_ROLES, SINGLE_LOCATION_ROLES } from './permissions';

describe('permissions & approval routing (§5, §6.1)', () => {
  it('has 15 roles and every role permission is a known key', () => {
    expect(ROLE_CATALOGUE).toHaveLength(15);
    for (const r of ROLE_CATALOGUE) for (const k of r.permissions) expect(PERMISSION_KEYS, `${r.key}:${k}`).toContain(k);
  });
  it('financial statements are Admin + External Auditor only (§9)', () => {
    const fs = ROLE_CATALOGUE.filter((r) => r.permissions.includes('fs.income_statement') || r.permissions.includes('fs.balance_sheet')).map((r) => r.key).sort();
    expect(fs).toEqual(['ADMIN', 'EXTERNAL_AUDITOR']);
  });
  it('Accounting Head sees TB/ledgers but not FS; Accounting Associate sees payroll summary only', () => {
    const head = ROLE_CATALOGUE.find((r) => r.key === 'ACCOUNTING_HEAD')!; const assoc = ROLE_CATALOGUE.find((r) => r.key === 'ACCOUNTING_ASSOCIATE')!;
    expect(head.permissions).toContain('gl.view'); expect(head.permissions).not.toContain('fs.income_statement');
    expect(assoc.permissions).toContain('payroll.view.summary'); expect(assoc.permissions).not.toContain('payroll.view.detail');
  });
  it('only Admin, the auditors, the Audit Associate and Accounting see supplier cost (owner rule)', () => {
    const withCost = ROLE_CATALOGUE.filter((r) => r.permissions.includes('cost.view')).map((r) => r.key).sort();
    expect(withCost).toEqual(['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_HEAD', 'ADMIN', 'ASST_AUDITOR', 'AUDIT_ASSOCIATE', 'EXTERNAL_AUDITOR', 'HEAD_AUDITOR']);
  });
  it('cost-blind roles have no cost.view', () => {
    for (const k of ['WAREHOUSE_IN_CHARGE', 'WAREHOUSE_ASSOCIATE', 'SALES_ASSOCIATE', 'FRANCHISE_SALES_ASSOCIATE', 'FRANCHISE_OWNER', 'HR_STAFF', 'FIELD_AUDITOR']) expect(ROLE_CATALOGUE.find((r) => r.key === k)!.permissions).not.toContain('cost.view');
  });
  it('only the Warehouse In-Charge (and Admin) may edit other people\'s warehouse entries; both warehouse roles accept edits', () => {
    const perms = (k: string) => ROLE_CATALOGUE.find((r) => r.key === k)!.permissions;
    expect(perms('WAREHOUSE_IN_CHARGE')).toContain('warehouse.edit_others'); expect(perms('ADMIN')).toContain('warehouse.edit_others');
    expect(perms('WAREHOUSE_ASSOCIATE')).not.toContain('warehouse.edit_others');
    for (const k of ['WAREHOUSE_IN_CHARGE', 'WAREHOUSE_ASSOCIATE']) { expect(perms(k)).toContain('approval.act.WAREHOUSE_EDIT'); expect(perms(k)).not.toContain('cost.edit'); }
  });
  it('Field Auditor: inventory of every location, no sales, no cost', () => {
    const p = ROLE_CATALOGUE.find((r) => r.key === 'FIELD_AUDITOR')!.permissions;
    expect(p).toContain('report.inventory.all'); expect(p).toContain('count.create');
    for (const k of ['sale.create', 'report.sales.own', 'report.sales.all', 'cost.view', 'sale.edit.sameday', 'expense.create.branch']) expect(p).not.toContain(k);
    expect(LOCATION_SCOPED_ROLES).not.toContain('FIELD_AUDITOR');
  });
  it('overrides add and remove keys', () => {
    const p = effectivePermissions(['a', 'b'], [{ permissionKey: 'c', granted: true }, { permissionKey: 'b', granted: false }]);
    expect([...p].sort()).toEqual(['a', 'c']);
  });
  it('routing table matches §6.1', () => {
    expect(APPROVAL_ROUTING.COST_ON_RECEIVING.roles).toEqual(['HEAD_AUDITOR']);
    expect(APPROVAL_ROUTING.TRANSFER_INTERNAL).toEqual({ roles: ['HEAD_AUDITOR', 'ASST_AUDITOR'], anyOf: true });
    expect(APPROVAL_ROUTING.POST_CLOSE_EDIT.roles).toEqual(['HEAD_AUDITOR', 'ASST_AUDITOR']); expect(APPROVAL_ROUTING.POST_CLOSE_EDIT.anyOf).toBeUndefined();
    expect(APPROVAL_ROUTING.SPECIAL_PRICE.roles).toEqual(['ADMIN']);
    expect(editRequestApprovers('HEAD_AUDITOR')).toEqual(['ADMIN']); expect(editRequestApprovers('ASST_AUDITOR')).toEqual(['ADMIN', 'HEAD_AUDITOR']); expect(editRequestApprovers('AUDIT_ASSOCIATE')).toEqual(['ADMIN', 'HEAD_AUDITOR', 'ASST_AUDITOR']); expect(editRequestApprovers('WAREHOUSE_IN_CHARGE')).toEqual(['ADMIN']);
  });
  it('2FA mandatory roles and single-location roles', () => {
    expect(TOTP_REQUIRED_ROLES.sort()).toEqual(['ACCOUNTING_HEAD', 'ADMIN', 'EXTERNAL_AUDITOR', 'HEAD_AUDITOR']);
    expect(SINGLE_LOCATION_ROLES.sort()).toEqual(['FRANCHISE_OWNER', 'FRANCHISE_SALES_ASSOCIATE', 'SALES_ASSOCIATE']);
  });
});
