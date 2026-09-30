import { describe, expect, it } from 'vitest';
import { sssRows2025, PHIC_2025, HDMF_2024 } from './contribution-tables';

describe('default contribution tables', () => {
  it('SSS: 61 brackets from ₱5,000 to ₱35,000 MSC with 5% EE / 10% + EC ER', () => {
    const r = sssRows2025();
    expect(r).toHaveLength(61);
    const at = (pay: number) => r.find((x) => pay >= x.from && pay <= x.to)!;
    expect(at(4000)).toMatchObject({ msc: 5000, ee: 250, er: 510 });
    expect(at(18000)).toMatchObject({ msc: 18000, ee: 900, er: 1830 });
    expect(at(50000)).toMatchObject({ msc: 35000, ee: 1750, er: 3530 });
  });
  it('PhilHealth 5% shared, Pag-IBIG 2% + 2% capped at ₱10,000', () => {
    const base = (b: number, t: { min: number; max: number }) => Math.min(Math.max(b, t.min), t.max);
    expect(base(25000, PHIC_2025) * PHIC_2025.rateEe).toBe(625);
    expect(base(25000, HDMF_2024) * HDMF_2024.rateEe).toBe(200);
  });
});
