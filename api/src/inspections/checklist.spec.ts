import { describe, expect, it } from 'vitest';
import { CHECKLIST, validateAnswers } from './checklist';

describe('store inspection checklist', () => {
  it('has the 19 numbered items of the paper form (permits and columnar broken out)', () => {
    expect(new Set(CHECKLIST.map((c) => c.no)).size).toBe(19);
    expect(CHECKLIST.filter((c) => c.group === 'Permits displayed').map((c) => c.label)).toEqual(['Business Permit', 'FDA', 'BIR COR', 'Barangay Clearance', 'BIR 0605', 'Intellectual Property (IPO)']);
    expect(CHECKLIST.find((c) => c.key === 'cash_fund')!.extras).toEqual(['amount', 'reason']);
  });
  it('submission needs every item answered and lists non-compliant items', () => {
    const all = CHECKLIST.map((c) => ({ key: c.key, status: 'COMPLIED' as const }));
    expect(validateAnswers(all, true).missing).toEqual([]);
    const one = all.map((a) => (a.key === 'near_expiry' ? { ...a, status: 'NO' as const } : a));
    expect(validateAnswers(one, true).issues.map((i) => i.key)).toEqual(['near_expiry']);
    expect(validateAnswers(all.slice(1), true).missing[0]).toBe('1. Cleanliness of store');
  });
});
