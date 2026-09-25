import { describe, expect, it } from 'vitest';
import { buildDailyInventory, dateRange } from './daily-inventory';
import { redactForRole } from '../common/redaction';
import { ROLE_CATALOGUE } from '../common/permissions';

const P = [{ id: 'p1', sku: 'A', name: 'Whey' }, { id: 'p2', sku: 'B', name: 'Creatine' }, { id: 'p3', sku: 'C', name: 'Idle' }];

describe('daily inventory report', () => {
  it('lists every day in the range', () => { expect(dateRange('2026-09-28', '2026-10-02')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']); });

  it('rolls beginning → transfer in / pull out / sales → end per day and per period, with cost', () => {
    const rep = buildDailyInventory('2026-09-01', '2026-09-03', P, [{ productId: 'p1', qty: 10, cost: 1000 }], [
      { productId: 'p1', qtyDelta: 5, movementType: 'TRANSFER_IN', businessDate: '2026-09-01', unitCost: 100 },
      { productId: 'p1', qtyDelta: -2, movementType: 'SALE', businessDate: '2026-09-01', unitCost: 100 },
      { productId: 'p1', qtyDelta: -3, movementType: 'TRANSFER_OUT', businessDate: '2026-09-02', unitCost: 100 },
      { productId: 'p1', qtyDelta: 1, movementType: 'SALE_RETURN', businessDate: '2026-09-03', unitCost: 100 },
      { productId: 'p1', qtyDelta: -1, movementType: 'ADJUST_COUNT', businessDate: '2026-09-03', unitCost: 100 },
      { productId: 'p2', qtyDelta: 4, movementType: 'RECEIVE', businessDate: '2026-09-02', unitCost: 250.5 },
    ]);
    expect(rep.products.map((p) => p.product.sku)).toEqual(['B', 'A']); // sorted by name; idle product omitted
    const a = rep.products[1];
    expect(a.beg).toBe(10); expect(a.transferIn).toBe(5); expect(a.sales).toBe(2); expect(a.pullOut).toBe(3); expect(a.returns).toBe(1); expect(a.adjust).toBe(-1); expect(a.end).toBe(10);
    expect(a.days.map((d) => [d.date, d.beg, d.end])).toEqual([['2026-09-01', 10, 13], ['2026-09-02', 13, 10], ['2026-09-03', 10, 10]]);
    expect(a.begCost).toBe(1000); expect(a.salesCost).toBe(200); expect(a.endCost).toBe(1000); expect(a.unitCost).toBe(100);
    const b = rep.products[0]; expect(b.beg).toBe(0); expect(b.receive).toBe(4); expect(b.receiveCost).toBe(1002); expect(b.days[0].end).toBe(0); expect(b.days[1].end).toBe(4);
    expect(rep.totals.end).toBe(14); expect(rep.totals.endCost).toBe(2002); expect(rep.totals.sales).toBe(2);
  });

  it('keeps cost columns for cost.view roles only', () => {
    const rep = buildDailyInventory('2026-09-01', '2026-09-01', P, [{ productId: 'p1', qty: 1, cost: 50 }], [{ productId: 'p1', qtyDelta: -1, movementType: 'SALE', businessDate: '2026-09-01', unitCost: 50 }]);
    const perms = (k: string) => ({ roleKey: k, permissions: new Set(ROLE_CATALOGUE.find((r) => r.key === k)!.permissions) });
    const assoc = redactForRole(rep, perms('SALES_ASSOCIATE'));
    const json = JSON.stringify(assoc);
    expect(json).not.toMatch(/Cost"|unitCost/); expect(json).toContain('"sales":1');
    const head = JSON.stringify(redactForRole(rep, perms('HEAD_AUDITOR')));
    expect(head).toContain('"salesCost":50'); expect(head).toContain('"endCost":0');
  });
});
