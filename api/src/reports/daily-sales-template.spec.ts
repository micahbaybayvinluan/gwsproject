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
  it('keeps the template\'s own colour palette in the finished file (pale yellow / gold instead of Excel\'s red)', async () => {
    const JSZip = (await import('jszip')).default;
    const out = await JSZip.loadAsync(await fillDailySalesTemplate(rep, templatePath()!));
    const styles = await out.file('xl/styles.xml')!.async('string');
    expect(styles).toContain('<indexedColors>'); expect(styles).toContain('FFFFD966'); expect(styles).toContain('FFFFF2CC');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await out.generateAsync({ type: 'nodebuffer' })) as unknown as ArrayBuffer); // still a valid workbook
    expect(wb.worksheets.length).toBeGreaterThan(3);
  });
  it('fills the template and keeps every FRONT formula', async () => {
    const tpl = templatePath(); expect(tpl).toBeTruthy();
    const buf = await fillDailySalesTemplate(rep, tpl!);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const front = wb.worksheets.find((w) => w.name.trim() === 'FRONT')!; const walk = wb.getWorksheet('WALK IN')!; const del = wb.getWorksheet('DELIVERY')!; const cc = wb.getWorksheet('CREDIT CARD')!; const ship = wb.getWorksheet('SHIPPING')!; const rt = wb.getWorksheet('RECEIPT TRACKER')!;
    expect(front.getCell('B1').value).toBe('Dasma Branch');
    expect((front.getCell('C5').value as { formula: string }).formula).toBe("'WALK IN'!D30"); // totals stay the workbook's formulas
    expect((front.getCell('C11').value as { formula: string }).formula).toBe('C5+C6+C7+C8+C9+C10'); // agent cash is part of the cash subtotal
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

  it('every sale is counted once: cash subtotal + online/card/shipping = all sales except AR; products include card sales; deposit = cash − expenses', async () => {
    const all: RSale[] = [
      sale({ drSiNo: 'W1', productTotal: d(1000), grandTotal: d(1000), lines: [line('A', 2, 500)] }),
      sale({ drSiNo: 'W2', paymentMode: 'ONLINE', productTotal: d(300), grandTotal: d(300), lines: [line('B', 1, 300)] }),
      sale({ drSiNo: 'F1', channel: 'FRANCHISE', productTotal: d(700), grandTotal: d(700), lines: [line('C', 1, 700)] }),
      sale({ drSiNo: 'D1', channel: 'DEALER', paymentMode: 'ONLINE', productTotal: d(900), grandTotal: d(900), lines: [line('D', 3, 300)] }),
      sale({ drSiNo: 'A1', channel: 'AGENT', productTotal: d(400), grandTotal: d(400), lines: [line('E', 1, 400)] }),
      sale({ drSiNo: 'R1', channel: 'DELIVERY', riderName: 'JAIME', productTotal: d(500), deliveryFee: d(50), riderIncentive: d(30), grandTotal: d(550), lines: [line('F', 1, 500)] }),
      sale({ drSiNo: 'R2', channel: 'DELIVERY', riderName: 'CARLO', paymentMode: 'ONLINE', productTotal: d(600), deliveryFee: d(60), grandTotal: d(660), lines: [line('G', 2, 300)] }),
      sale({ drSiNo: 'DF', channel: 'FRANCHISE', riderName: 'JAIME', productTotal: d(800), deliveryFee: d(40), grandTotal: d(840), lines: [line('H', 1, 800)] }),
      sale({ drSiNo: 'DD', channel: 'DEALER', riderName: 'JAIME', paymentMode: 'ONLINE', productTotal: d(1200), deliveryFee: d(45), grandTotal: d(1245), lines: [line('I', 4, 300)] }),
      sale({ drSiNo: 'DA', channel: 'AGENT', riderName: 'CARLO', productTotal: d(350), deliveryFee: d(35), grandTotal: d(385), lines: [line('J', 1, 350)] }),
      sale({ drSiNo: 'C1', paymentMode: 'CREDIT_CARD', productTotal: d(2000), grandTotal: d(2000), lines: [line('K', 2, 1000)] }),
      sale({ drSiNo: 'C2', channel: 'DELIVERY', riderName: 'JAIME', paymentMode: 'CREDIT_CARD', productTotal: d(1500), deliveryFee: d(70), grandTotal: d(1570), lines: [line('L', 3, 500)] }),
      sale({ drSiNo: 'C3', channel: 'AGENT', paymentMode: 'CREDIT_CARD', productTotal: d(650), grandTotal: d(650), lines: [line('M', 1, 650)] }),
      sale({ drSiNo: 'S1', channel: 'SHIPPING_COURIER', productTotal: d(1100), shippingFee: d(120), grandTotal: d(1220), lines: [line('N', 1, 1100)] }),
      sale({ drSiNo: 'S2', channel: 'SHIPPING_MARKETPLACE', channelSub: 'SHOPEE', paymentMode: 'ONLINE', productTotal: d(990), shippingFee: d(80), grandTotal: d(1070), lines: [line('O', 1, 990)] }),
      sale({ drSiNo: 'S3', channel: 'SHIPPING_COURIER', channelSub: 'FRANCHISE', paymentMode: 'ONLINE', productTotal: d(2500), shippingFee: d(150), grandTotal: d(2650), lines: [line('P', 5, 500)] }),
      sale({ drSiNo: 'S4', channel: 'SHIPPING_COURIER', channelSub: 'DEALER', paymentMode: 'ONLINE', productTotal: d(1800), shippingFee: d(90), grandTotal: d(1890), lines: [line('Q', 2, 900)] }),
      sale({ drSiNo: 'S5', channel: 'SHIPPING_COURIER', channelSub: 'AGENT', paymentMode: 'ONLINE', productTotal: d(750), shippingFee: d(75), grandTotal: d(825), lines: [line('R', 1, 750)] }),
      sale({ drSiNo: 'AR', channel: 'DEALER', paymentMode: 'AR_PDC', productTotal: d(5000), grandTotal: d(5000), lines: [line('S', 2, 2500)] }),
    ];
    const expenses = [
      { accountTitle: 'Meralco - West Ave', payee: null, amount: d(300), paidFrom: 'CASH_DRAWER' },
      { accountTitle: 'Incentives - West Ave', payee: 'Juan', amount: d(25), paidFrom: 'CASH_DRAWER' },
      { accountTitle: 'Rider/Driver Incentive - West Ave', payee: 'JAIME', amount: d(30), paidFrom: 'CASH_DRAWER', inRiderSummary: true },
    ];
    const r = buildDailySalesReport({ branch: 'West Ave', date: '2026-09-27', preparedBy: 'x', close: null, sales: all, expenses });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await fillDailySalesTemplate(r, templatePath()!)) as unknown as ArrayBuffer);
    const v = evaluator(wb);
    const nonAr = all.filter((x) => x.paymentMode !== 'AR_PDC');
    const salesTotal = nonAr.reduce((t, x) => t + x.grandTotal.toNumber(), 0);
    console.log(JSON.stringify(Object.fromEntries(['C5','C6','C7','C8','C9','C10','C11','C13','C14','C15','C16','C17','C18','C19','C20','C21','C22','C23','C24','C25','C26','C27','C28','C29'].map((a) => [a, v(a)]))));
    expect(v('C11') + v('C29')).toBeCloseTo(salesTotal, 2);
    expect(v('C11')).toBeCloseTo(r.cash.subtotal.toNumber(), 2); expect(v('C29')).toBeCloseTo(r.onlineCcShippingTotal.toNumber(), 2);
    const qty = nonAr.flatMap((x) => x.lines).reduce((n, l) => n + l.qty, 0);
    expect(v('F5') + v('F6') + v('F7') + v('F8') + v('F9') + v('F12')).toBe(qty);
    expect(v('F14')).toBe(6); expect(v('F13')).toBe(3); expect(r.creditCard.transactions).toBe(3); expect(r.creditCard.products).toBe(6);
    expect(v('D49')).toBeCloseTo(355, 2); // 300 + 25 + the rider's 30 counted once (rider summary)
    expect(v('C56')).toBeCloseTo(r.totalCashDeposit.toNumber(), 2);
  });
});

/** Tiny evaluator for the FRONT formulas (cell references across sheets, +, −, SUM of ranges) so totals can be checked without Excel. */
function evaluator(wb: ExcelJS.Workbook) {
  const sheet = (n: string) => wb.worksheets.find((w) => w.name.trim() === n.trim())!;
  const colNum = (c: string) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const colStr = (n: number) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  const cell = (sh: string, addr: string): number => {
    const v = sheet(sh).getCell(addr.replace(/\$/g, '')).value as unknown;
    if (v && typeof v === 'object' && 'formula' in (v as object)) return formula(sh, (v as { formula: string }).formula);
    if (v && typeof v === 'object' && 'sharedFormula' in (v as object)) {
      // a copy of the master cell's formula, with relative references moved by the same offset
      const master = (v as { sharedFormula: string }).sharedFormula; const m = /([A-Z]+)(\d+)/.exec(master)!; const here = /([A-Z]+)(\d+)/.exec(addr.replace(/\$/g, ''))!;
      const dc = colNum(here[1]) - colNum(m[1]), dr = Number(here[2]) - Number(m[2]);
      const mf = (sheet(sh).getCell(master).value as { formula: string }).formula;
      return formula(sh, mf.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (_x, ca, c, ra, r) => `${ca}${ca ? c : colStr(colNum(c) + dc)}${ra}${ra ? r : Number(r) + dr}`));
    }
    return typeof v === 'number' ? v : 0;
  };
  const ref = /(?:'([^']+)'|([A-Z]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?|\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?/g;
  function formula(sh: string, f: string): number {
    const expr = f.replace(/SUM\(/g, '(').replace(ref, (_m, qs, us, c1, r1, c2, r2, lc1, lr1, lc2, lr2) => {
      const s2 = qs ?? us ?? sh; const a = c1 ?? lc1, ra = Number(r1 ?? lr1), b = c2 ?? lc2, rb = Number(r2 ?? lr2);
      if (!b) return `(${cell(s2, `${a}${ra}`)})`;
      let t = 0; for (let c = colNum(a); c <= colNum(b); c++) for (let r = ra; r <= rb; r++) t += cell(s2, `${colStr(c)}${r}`);
      return `(${t})`;
    }).replace(/\+\+/g, '+');
    return Number(new Function(`return (${expr});`)());
  }
  return (addr: string) => cell('FRONT', addr);
}
