import { describe, expect, it } from 'vitest';
import { redactForRole } from './redaction';
import { ROLE_CATALOGUE, effectivePermissions } from './permissions';

const sample = {
  product: { id: 'p1', name: 'Whey 5lb', cost: '900.00', tierPrices: { RETAIL: '1500', DEALER: '1200', FRANCHISE: '1100', AGENT: '1200' }, supplier: { id: 's1', code: 'SUP-001', name: 'Secret Supplier Inc' }, supplierName: 'Secret Supplier Inc' },
  lines: [{ qty: 1, unitPrice: '1500', unitCost: '900', margin: '600', grossProfit: '600' }],
  batch: { unitCost: '900', originalUnitCost: '850', expiryDate: '2027-01-01' },
  prices: [{ tier: 'RETAIL', price: '1500' }, { tier: 'FRANCHISE', price: '1100' }, { tier: 'DEALER', price: '1200' }],
  chargeLine: { unitCharge: '1100', batchCost: '900', amount: '1100' },
};
const flatten = (o: unknown, prefix = ''): string[] => (o && typeof o === 'object' ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => [prefix + k, ...flatten(v, `${prefix}${k}.`)]) : []);

describe('redactForRole (§5.3) — every role', () => {
  for (const role of ROLE_CATALOGUE) {
    const user = { roleKey: role.key, permissions: effectivePermissions(role.permissions, []) };
    const canCost = user.permissions.has('cost.view'); const canSupplier = user.permissions.has('supplier.view.name');
    it(`${role.key}: cost=${canCost} supplierName=${canSupplier}`, () => {
      const out = redactForRole(JSON.parse(JSON.stringify(sample)), user) as typeof sample;
      const keys = flatten(out);
      const costKeys = keys.filter((k) => /(^|\.)(cost|unitCost|originalUnitCost|margin|grossProfit|batchCost)$/.test(k));
      if (canCost) expect(costKeys.length).toBeGreaterThan(0); else expect(costKeys).toEqual([]);
      if (canSupplier) { expect(out.product.supplier.name).toBe('Secret Supplier Inc'); expect(out.product.supplierName).toBeDefined(); }
      else { expect((out.product.supplier as { name?: string }).name).toBeUndefined(); expect((out.product as { supplierName?: string }).supplierName).toBeUndefined(); expect(out.product.supplier.code).toBe('SUP-001'); }
      // selling prices always survive on lines
      expect(out.lines[0].unitPrice).toBe('1500');
      // tier maps filtered to permitted tiers
      for (const tier of Object.keys(out.product.tierPrices)) expect(user.permissions.has(`price.view.${tier}`)).toBe(true);
      for (const row of out.prices) expect(user.permissions.has(`price.view.${row.tier}`)).toBe(true);
      // charge form: HR sees unit charge but never batch cost
      expect(out.chargeLine.unitCharge).toBe('1100');
    });
  }
  it('FRANCHISE_OWNER sees FRANCHISE + RETAIL tiers only and never cost', () => {
    const role = ROLE_CATALOGUE.find((r) => r.key === 'FRANCHISE_OWNER')!;
    const out = redactForRole(JSON.parse(JSON.stringify(sample)), { roleKey: role.key, permissions: new Set(role.permissions) }) as typeof sample;
    expect(Object.keys(out.product.tierPrices).sort()).toEqual(['FRANCHISE', 'RETAIL']);
    expect((out.batch as { unitCost?: string }).unitCost).toBeUndefined();
  });
  it('HR_STAFF never sees batchCost on charge forms', () => {
    const role = ROLE_CATALOGUE.find((r) => r.key === 'HR_STAFF')!;
    const out = redactForRole(JSON.parse(JSON.stringify(sample)), { roleKey: role.key, permissions: new Set(role.permissions) }) as typeof sample;
    expect((out.chargeLine as { batchCost?: string }).batchCost).toBeUndefined();
  });
  it('passes through arrays, dates and nulls', () => {
    const d = new Date(); const out = redactForRole({ a: [1, 2, { cost: 1, x: null }], d }, { roleKey: 'SALES_ASSOCIATE', permissions: new Set() }) as { a: unknown[]; d: Date };
    expect(out.a[2]).toEqual({ x: null }); expect(out.d).toBe(d);
  });
});
