import { describe, expect, it } from 'vitest';
import { describeChanges } from './edit-diff';

describe('edit change list', () => {
  it('lists header changes, changed / added / removed lines', () => {
    const before = { header: { supplierRef: 'INV-1', notes: '', toLocationId: 'a' }, lines: [{ product: 'Whey', qty: 24, expiryDate: '2027-01-01' }, { product: 'Creatine', qty: 5, expiryDate: '2027-02-01' }] };
    const after = { header: { supplierRef: 'INV-2', notes: 'recount', toLocationId: 'b' }, lines: [{ product: 'Whey', qty: 20, expiryDate: '2027-01-01' }, { product: 'BCAA', qty: 3, expiryDate: '2027-03-01' }] };
    expect(describeChanges(before, after)).toEqual(['Supplier ref: INV-1 → INV-2', 'Notes: — → recount', 'Whey: qty 24 → 20', 'Added BCAA: qty 3, expiry 2027-03-01', 'Removed Creatine']);
  });
  it('returns nothing when unchanged', () => {
    const s = { header: { notes: 'x' }, lines: [{ product: 'Whey', qty: 1 }] };
    expect(describeChanges(s, s)).toEqual([]);
  });
});
