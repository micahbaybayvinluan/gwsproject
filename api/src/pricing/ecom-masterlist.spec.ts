import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { normName, parseEcomMasterlist } from './ecom-masterlist';

describe('TikTok / Shopee masterlist', () => {
  it('reads every priced product exactly as written (no rounding) and skips the brand headings', async () => {
    const rows = await parseEcomMasterlist(readFileSync(path.resolve(__dirname, '../../../seed/TIKTOK_SHOPEE_MASTERLIST_2026.xlsx')));
    expect(rows.length).toBe(160);
    const pre = rows.find((r) => normName(r.name) === normName('Prothin Pre-Game 30 Sachets'))!;
    expect(pre.tiktok).toBe(899); expect(pre.shopee).toBe(899); expect(pre.srp).toBe(899);
    const gummies = rows.find((r) => /Multivitamins 30 Gummies/i.test(r.name))!;
    expect(gummies.srp).toBe(280); expect(gummies.tiktok).toBe(350); expect(gummies.shopee).toBe(350);
    expect(rows.every((r) => r.tiktok != null || r.shopee != null)).toBe(true);
  });
  it('matches names whatever the spacing or case', () => { expect(normName('Prothin  Isolate 60s ')).toBe(normName('prothin isolate 60S')); });
});
