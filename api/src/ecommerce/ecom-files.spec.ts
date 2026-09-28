import { describe, expect, it } from 'vitest';
import { classifyFee, monthOf, num, parseAds, parseCsv, parseOrders, parseSettlement } from './ecom-files';

const csv = (s: string) => [parseCsv(s)];

describe('e-commerce file readers', () => {
  it('reads numbers the way the platforms write them', () => {
    expect(num('₱1,234.50')).toBe(1234.5);
    expect(num('(12.00)')).toBe(-12);
    expect(num('')).toBe(0);
    expect(parseCsv('a,"b, c"\n1,"say ""hi"""\n')).toEqual([['a', 'b, c'], ['1', 'say "hi"']]);
  });

  it('TikTok order export: skips the description row and cancelled orders, adds up SKU rows', () => {
    const r = parseOrders(csv([
      'Order ID,Order Status,Seller SKU,Product Name,Quantity,Tracking ID',
      'Platform unique order ID.,Order status,Seller SKU,Product name,Quantity,Tracking',
      '578000000000000001,To ship,SKU-1,Whey,2,PH001',
      '578000000000000001,To ship,SKU-2,Creatine,1,PH001',
      '578000000000000002,Cancelled,SKU-1,Whey,1,',
    ].join('\n')));
    expect(r.orders).toEqual([{ orderId: '578000000000000001', trackingNo: 'PH001', lines: [{ sku: 'SKU-1', name: 'Whey', qty: 2 }, { sku: 'SKU-2', name: 'Creatine', qty: 1 }] }]);
    expect(r.cancelled).toEqual(['578000000000000002']);
  });

  it('Shopee order export uses SKU Reference No. and Tracking Number*', () => {
    const r = parseOrders(csv('Order ID,Order Status,Tracking Number*,SKU Reference No.,Product Name,Quantity\n2409ABC123,To Ship,SPXPH01,SKU-9,Mass,3\n'));
    expect(r.orders[0]).toMatchObject({ orderId: '2409ABC123', trackingNo: 'SPXPH01', lines: [{ sku: 'SKU-9', qty: 3 }] });
  });

  it('Lazada lists each unit on its own row without a quantity', () => {
    const r = parseOrders(csv('Order Number,Seller SKU,Item Name,Tracking Code,Status\n3301,SKU-5,BCAA,LZ1,ready_to_ship\n3301,SKU-5,BCAA,LZ1,ready_to_ship\n'));
    expect(r.orders[0].lines).toEqual([{ sku: 'SKU-5', name: 'BCAA', qty: 2 }]);
  });

  it('wide payout file: fees as positive costs whatever the sign; adjustments keep it equal to the payout', () => {
    const r = parseSettlement(csv([
      'Order ID,Subtotal before discounts,Seller discounts,TikTok Shop commission fee,Transaction fee,Seller shipping fee,Affiliate Commission,Withholding tax,Total settlement amount',
      '578000000000000001,1000,-50,-76,-21.28,-40,0,-5,807.72',
      '578000000000000009,500,0,-40,-11.2,0,0,-2.5,450.30',
    ].join('\n')));
    expect(r.format).toBe('wide');
    const a = r.orders[0].amounts;
    expect(a).toMatchObject({ grossSales: 1000, sellerDiscounts: 50, commission: 76, transactionFee: 21.28, shippingFee: 40, withholdingTax: 5, payout: 807.72, adjustments: 0 });
    expect(r.orders[1].amounts.adjustments).toBe(4); // 450.30 paid vs 446.30 explained: e.g. a platform shipping rebate
    expect(r.filePayout).toBe(1258.02);
  });

  it('GWS payout template reads the same way', () => {
    const r = parseSettlement(csv('Order ID,Gross Sales,Seller Discounts,Commission,Transaction Fee,Shipping Fee,Affiliate Commission,Other Fees,Refunds,Withholding Tax,Payout\n1001,1000,50,76,21.28,40,0,0,0,5,807.72\n'));
    expect(r.orders[0].amounts).toMatchObject({ grossSales: 1000, payout: 807.72, adjustments: 0 });
  });

  it('long payout file (Lazada transaction overview): one row per fee', () => {
    const r = parseSettlement(csv([
      'Transaction Date,Fee Name,Order No.,Amount',
      '2026-09-10,Item Price Credit,3301,1000',
      '2026-09-10,Commission,3301,-80',
      '2026-09-10,Payment Fee,3301,-22.4',
      '2026-09-10,Shipping Fee (Paid By Customer),3301,50',
      '2026-09-10,Shipping Fee Paid by Seller,3301,-50',
      '2026-09-10,Promotional Charges Vouchers,3301,-30',
      '2026-09-10,Withholding Tax,3301,-5',
    ].join('\n')));
    expect(r.format).toBe('long');
    expect(r.orders[0].amounts).toMatchObject({ grossSales: 1000, commission: 80, transactionFee: 22.4, shippingFee: 50, sellerDiscounts: 30, withholdingTax: 5, payout: 862.6 });
    // the shipping fee the buyer paid came in and went out again: it shows up as an adjustment, so the payout still ties
    expect(r.orders[0].amounts.adjustments).toBe(50);
    expect(classifyFee('Sponsored Discovery')).toBe('otherFees');
  });

  it('ads billing: amount per month', () => {
    const r = parseAds(csv('Date,Campaign,Cost\n2026-08-30,A,100\n09/02/2026,B,250.5\nTotal,,350.5\n'), '2026-09');
    expect(r.months).toEqual([{ month: '2026-08', amount: 100 }, { month: '2026-09', amount: 250.5 }]);
    expect(monthOf('Sep 2026')).toBe('2026-09');
    expect(monthOf('14/09/2026')).toBe('2026-09');
  });
});
