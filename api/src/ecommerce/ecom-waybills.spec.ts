import { describe, expect, it } from 'vitest';
import { parseWaybill, readWaybills } from './ecom-waybills';
import { makePdf } from '../../test/pdf';

describe('waybill labels', () => {
  it('reads a TikTok Shop (J&T) label: order id with spaced digits, tracking, weight in KG, RTS date; no quantity printed → 1', () => {
    const w = parseWaybill(['JT0023984229750', 'Receiver: j** (+63) 97*****32', 'Weight:', '0.600 KG', 'Payment :', 'PP_PM', 'TT Order ID: 5 8 6 0 2 4 3 5 7 5 3 4 0 7 3 8 7 3', 'RTS Time: 2026-09-12']);
    expect(w).toEqual({ platform: 'TIKTOK', orderId: '586024357534073873', trackingNo: 'JT0023984229750', qty: 1, weightG: 600, rtsDate: '2026-09-12' });
  });
  it('reads a Shopee (SPX) label: order sn, tracking, quantity, weight in grams', () => {
    const w = parseWaybill(['RTS Sort Code:', 'Order ID:', '2609057S9U6WH6', 'PH2620256392738', 'Product Quantity:', '3', 'Weight:', '602 g']);
    expect(w).toMatchObject({ platform: 'SHOPEE', orderId: '2609057S9U6WH6', trackingNo: 'PH2620256392738', qty: 3, weightG: 602 });
  });
  it('a page with no order number is reported as unreadable, not guessed', async () => {
    expect(parseWaybill(['Thank you for your order'])).toBeNull();
    const r = await readWaybills(makePdf([['TT Order ID: 586024357534073873', 'JT0023984229750', 'Weight: 0.600 KG'], ['nothing useful here'], ['Order ID:', '2609057S9U6WH6', 'PH2620256392738', 'Product Quantity:', '2', 'Weight:', '602 g']]));
    expect(r.waybills.map((w) => w.platform)).toEqual(['TIKTOK', 'SHOPEE']); expect(r.unreadable).toEqual([2]); expect(r.waybills[1].qty).toBe(2);
  });
});
