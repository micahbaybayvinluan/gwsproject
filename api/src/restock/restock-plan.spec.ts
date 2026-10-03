import { describe, expect, it } from 'vitest';
import { planProduct } from './restock-plan';

const O = { coverDays: 30, reserveDays: 7, surplusDays: 60, onOrder: 0 };
describe('restock planner', () => {
  it('moves the warehouse stock above its reserve to the branches that need it (most critical first) and orders the rest', () => {
    const p = planProduct([
      { id: 'WH', type: 'WAREHOUSE', onHand: 100, avgPerDay: 2 }, // reserve 14, can give 86, wants 60 for itself
      { id: 'A', type: 'BRANCH', onHand: 5, avgPerDay: 5 }, // 1 day left, needs 145
      { id: 'B', type: 'BRANCH', onHand: 60, avgPerDay: 3 }, // 20 days left, needs 30
      { id: 'C', type: 'BRANCH', onHand: 300, avgPerDay: 1 }, // plenty, needs nothing
    ], O);
    const a = p.rows.find((r) => r.locationId === 'A')!; const b = p.rows.find((r) => r.locationId === 'B')!;
    expect(a).toMatchObject({ need: 145, transferQty: 86, transferFromId: 'WH', allocQty: 59, daysLeft: 1 }); // the most critical takes all the warehouse can give
    expect(b).toMatchObject({ need: 30, transferQty: 30, transferFromId: 'C', allocQty: 0 }); // nothing left in the warehouse: branch C holds far more than it sells, so B gets it from there
    expect(p.warehouse).toMatchObject({ giveable: 86, transferredOut: 86, shortfall: 60 - 14 });
    expect(p.grossOrder).toBe(59 + 46); expect(p.suggestedOrder).toBe(105);
  });
  it('takes from the branch with the most surplus when the warehouse has none; ignores items with no sales; subtracts what is already on order', () => {
    const p = planProduct([
      { id: 'WH', type: 'WAREHOUSE', onHand: 10, avgPerDay: 2 }, // below its reserve: gives nothing
      { id: 'A', type: 'BRANCH', onHand: 10, avgPerDay: 4 }, // needs 110
      { id: 'D', type: 'BRANCH', onHand: 500, avgPerDay: 2 }, // surplus 500 - 120 = 380
      { id: 'E', type: 'BRANCH', onHand: 40, avgPerDay: 0 }, // no sales: no need, never a donor
    ], { ...O, onOrder: 20 });
    const a = p.rows.find((r) => r.locationId === 'A')!;
    expect(a).toMatchObject({ transferQty: 110, transferFromId: 'D', allocQty: 0 });
    expect(p.rows.find((r) => r.locationId === 'E')).toMatchObject({ need: 0, transferQty: 0 });
    expect(p.warehouse.shortfall).toBe(60 - 10); expect(p.grossOrder).toBe(50); expect(p.suggestedOrder).toBe(30);
  });
  it('never suggests a negative order', () => {
    const p = planProduct([{ id: 'WH', type: 'WAREHOUSE', onHand: 500, avgPerDay: 1 }, { id: 'A', type: 'BRANCH', onHand: 1, avgPerDay: 1 }], { ...O, onOrder: 999 });
    expect(p.suggestedOrder).toBe(0); expect(p.rows[0].transferQty).toBe(29);
  });
});
