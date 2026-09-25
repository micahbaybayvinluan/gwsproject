import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import ExcelJS from 'exceljs';
import { buildDailySalesReport, RSale } from './daily-sales-report';
import { classifySale, fillDailySalesTemplate, templatePath } from './daily-sales-template';

const d = (n: number) => new Decimal(n);
const sale = (o: Partial<RSale>): RSale => ({ id: 'x', drSiNo: '1', channel: 'WALK_IN', channelSub: null, paymentMode: 'CASH', customerName: null, agentName: null, riderName: null, deliveryFee: d(0), riderIncentive: d(0), shippingFee: d(0), shippingExpense: d(0), marketplaceCharges: d(0), productTotal: d(0), grandTotal: d(0), cardMid: null, cardSlipNo: null, cardApprovalCode: null, cardBatchNo: null, notes: null, lines: [], ...o });
const line = (productName: string, qty: number, price: number, cls = 'SUPPLEMENT', isFreebie = false) => ({ productName, qty, unitPrice: d(price), amount: d(price * qty), isFreebie, accountingClass: cls });

describe('Daily Sales Report rendered into the sample workbook (§8.5, §19)', () => {
  const sales: RSale[] = [
    sale({ drSiNo: '15246', productTotal: d(3000), grandTotal: d(3000), lines: [line('Prothin Whey Isolate 60s', 1, 3000), line('Plastic L', 1, 0, 'PLASTIC', true)] }),
    sale({ drSiNo: '15245', paymentMode: 'ONLINE', riderName: 'JAIME', productTotal: d(4650), deliveryFee: d(137), grandTotal: d(4787), lines: [line('Prothin Whey Isolate 60s', 1, 3000), line('C4 Ripped 30s', 1, 1650)] }),
    sale({ drSiNo: '15250', channel: 'FRANCHISE', paymentMode: 'CASH', customerName: 'Mayon', productTotal: d(1100), grandTotal: d(1100), lines: [line('Whey', 1, 1100)] }),
    sale({ drSiNo: '15251', paymentMode: 'CREDIT_CARD', customerName: 'Ana', cardMid: 'M1', cardSlipNo: 'S1', cardApprovalCode: 'A1', cardBatchNo: 'B1', productTotal: d(700), grandTotal: d(700), lines: [line('Shirt', 1, 700, 'APPAREL')] }),
    sale({ drSiNo: '15252', channel: 'SHIPPING_MARKETPLACE', channelSub: 'SHOPEE', paymentMode: 'ONLINE', productTotal: d(2000), shippingFee: d(100), grandTotal: d(2100), lines: [line('Creatine', 2, 1000)] }),
    sale({ drSiNo: '15253', channel: 'DEALER', paymentMode: 'AR_PDC', customerName: 'Topform', productTotal: d(5000), grandTotal: d(5000), lines: [line('Mass Gainer', 2, 2500)] }),
  ];
  const rep = buildDailySalesReport({ branch: 'Dasma Branch', date: '2026-09-22', preparedBy: 'regina latagan', close: { moneyBreakdown: { '1000': 3, '100': 1 }, countedCash: d(3100), expectedCash: d(3100), cashVariance: d(0) }, sales, expenses: [{ accountTitle: 'Meralco - Dasmarinas', payee: null, amount: d(300), paidFrom: 'CASH_DRAWER' }, { accountTitle: 'Rider/Driver Expense (Gas) - Dasmarinas', payee: 'Shell', amount: d(150), paidFrom: 'CASH_DRAWER' }] });

  it('classifies sales into the sample blocks', () => {
    const idx = new Map([['JAIME', 1]]);
    expect(classifySale(sales[0], idx)).toBe('walkinCash'); expect(classifySale(sales[1], idx)).toBe('rider1Online'); expect(classifySale(sales[2], idx)).toBe('franchiseCash');
    expect(classifySale(sales[3], idx)).toBe('ccWalkin'); expect(classifySale(sales[4], idx)).toBe('shipMarketplace'); expect(classifySale(sales[5], idx)).toBeNull();
  });
  it('fills the template and keeps every FRONT formula', async () => {
    const tpl = templatePath(); expect(tpl).toBeTruthy();
    const buf = await fillDailySalesTemplate(rep, tpl!);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const front = wb.worksheets.find((w) => w.name.trim() === 'FRONT')!; const walk = wb.getWorksheet('WALK IN')!; const del = wb.getWorksheet('DELIVERY')!; const cc = wb.getWorksheet('CREDIT CARD')!; const ship = wb.getWorksheet('SHIPPING')!; const rt = wb.getWorksheet('RECEIPT TRACKER')!;
    expect(front.getCell('B1').value).toBe('Dasma Branch');
    expect((front.getCell('C5').value as { formula: string }).formula).toBe("'WALK IN'!D30"); // totals stay the workbook's formulas
    expect((front.getCell('C11').value as { formula: string }).formula).toBe('C5+C6++C7+C8+C10');
    expect(walk.getCell('A6').value).toBe('15246'); expect(walk.getCell('D6').value).toBe(3000); expect(walk.getCell('B7').value).toBe('Plastic L'); expect(walk.getCell('D7').value).toBe(0);
    expect(walk.getCell('A38').value).toBe('15250'); expect(walk.getCell('D38').value).toBe(1100);
    expect(del.getCell('J3').value).toBe('JAIME'); expect(del.getCell('I6').value).toBe('15245'); expect(del.getCell('L6').value).toBe(3000); expect(del.getCell('M6').value).toBe(137); expect(del.getCell('L7').value).toBe(1650);
    expect(cc.getCell('A3').value).toBe('15251'); expect(cc.getCell('B3').value).toBe('Ana'); expect(cc.getCell('E3').value).toBe(700); expect(cc.getCell('H3').value).toBe('M1'); expect((cc.getCell('G3').value as { formula?: string })?.formula ?? cc.getCell('G3').value).toBeDefined();
    expect(ship.getCell('I6').value).toBe('15252'); expect(ship.getCell('L6').value).toBe(2000); expect(ship.getCell('M6').value).toBe(100);
    expect(rt.getCell('A6').value).toBe('15246'); expect(rt.getCell('G6').value).toBe('CASH');
    const trackerDrs = [6, 7, 8, 9, 10, 11, 12, 13, 14].map((r) => rt.getCell(`A${r}`).value).filter(Boolean); expect(trackerDrs).toContain('15253'); // AR/PDC sales appear in the tracker only
    expect(front.getCell('H3').value).toBe('JAIME'); expect(front.getCell('J12').value).toBe(3); expect(front.getCell('L13').value).toBe('Meralco - Dasmarinas'); expect(front.getCell('N13').value).toBe(300); expect(front.getCell('H31').value).toBe('Rider/Driver Expense (Gas) - Dasmarinas'); expect(front.getCell('J31').value).toBe(150);
    expect(front.getCell('F44').value).toBe('Plastic L'); expect(front.getCell('F10').value).toBe(1); expect(front.getCell('E63').value).toBe('regina latagan');
    // sample data from the template is cleared
    expect(walk.getCell('A9').value).toBeNull(); expect(del.getCell('J8').value).toBeNull();
  });
});
