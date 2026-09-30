import { describe, expect, it } from 'vitest';
import { MasterService } from './master.service';

describe('credit-card price (memo of September 21, 2026)', () => {
  it('SRP ÷ (1 − 4%) reproduces the memo: 1,250 → 1,302 · 800 → 833 · 7,550 → 7,864 · 9,000 → 9,375 · 3,850 → 4,010 (whole pesos shown in the memo; the system keeps the centavos)', () => {
    for (const [srp, memo] of [[1250, 1302], [800, 833], [7550, 7864], [9000, 9375], [3850, 4010]] as const) {
      const cc = MasterService.ccFromSrp(srp, 4, 'GROSS_UP');
      expect(Math.floor(cc.toNumber())).toBe(memo);
    }
    expect(MasterService.ccFromSrp(1250, 4, 'GROSS_UP').toFixed(2)).toBe('1302.08');
    expect(MasterService.ccFromSrp(9000, 4, 'GROSS_UP').toFixed(2)).toBe('9375.00');
  });
  it('ADD method is SRP + %', () => { expect(MasterService.ccFromSrp(1250, 4, 'ADD').toFixed(2)).toBe('1300.00'); expect(MasterService.ccFromSrp(899, 4, 'ADD').toFixed(2)).toBe('934.96'); });
});
