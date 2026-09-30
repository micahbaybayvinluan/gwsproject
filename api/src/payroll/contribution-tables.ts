/**
 * Default government contribution tables (editable by HR under Payroll → Contribution tables; verify against the latest circulars).
 * - SSS (2025 schedule): monthly salary credit (MSC) ₱5,000–₱35,000 in ₱500 steps; employee 5%, employer 10% + EC (₱10 below ₱15,000 MSC, ₱30 from ₱15,000).
 * - PhilHealth (2024–2025): 5% of basic salary, floor ₱10,000, ceiling ₱100,000, shared equally (2.5% / 2.5%).
 * - Pag-IBIG / HDMF (from Feb 2024): 2% employee + 2% employer of monthly compensation up to ₱10,000 (max ₱200 each).
 */
export function sssRows2025(): { from: number; to: number; msc: number; ee: number; er: number }[] {
  const rows = [];
  for (let msc = 5000; msc <= 35000; msc += 500) {
    const from = msc === 5000 ? 0 : msc - 250;
    const to = msc === 35000 ? 999999999 : msc + 249.99;
    const ec = msc < 15000 ? 10 : 30;
    rows.push({ from, to, msc, ee: +(msc * 0.05).toFixed(2), er: +(msc * 0.1 + ec).toFixed(2) });
  }
  return rows;
}
export const PHIC_2025 = { rateEe: 0.025, rateEr: 0.025, min: 10000, max: 100000 };
export const HDMF_2024 = { rateEe: 0.02, rateEr: 0.02, min: 0, max: 10000 };
export const DEFAULT_TABLES_EFFECTIVE = '2025-01-01';
