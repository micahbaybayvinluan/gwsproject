import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { AccountResolver, MissingAccountError, assertBalanced, computeNetPay, r10Deposit, r10Expense, r11ChargeForm, r11PayrollDeduction, r12Revaluation, r13PayrollClose, r13PayrollFinalize, r14Depreciation, r1Receiving, r3r4Sale, r4Collection, r5CostOfSale, r6Transfer, r7FranchiseTransfer, r8ConsignOut, r8ConsigneeSale, r9Writeoff, Entry } from './posting-rules';

/** In-memory resolver: account id = `${template}@${location}` or `G:${key}`. */
const r: AccountResolver = {
  branch: (t, loc) => `${t}@${loc}`,
  global: (k) => `G:${k}`,
  ar: (cp, loc) => (cp?.type === 'FRANCHISE' ? `AR_FRANCHISE@${cp.locationId ?? cp.id}` : cp?.type === 'DEALER' ? `AR_DEALER@${cp.id}` : cp?.type === 'AGENT' ? `AR_AGENT@${loc}` : `AR_OTHERS@${loc}`),
  ap: (s, c) => (c ? 'G:AP_CONSIGNMENT' : s ? `AP@${s}` : 'G:AP_SUPPLIERS'),
};
const dr = (e: Entry, acct: string) => e.lines.filter((l) => l.accountId === acct).reduce((s, l) => s.plus(l.debit), new Decimal(0)).toNumber();
const cr = (e: Entry, acct: string) => e.lines.filter((l) => l.accountId === acct).reduce((s, l) => s.plus(l.credit), new Decimal(0)).toNumber();
const balanced = (es: Entry[]) => es.forEach((e) => assertBalanced(e.lines));

describe('posting rules §10.4', () => {
  it('R1: receiving debits inventory by category and credits AP; R2 books free goods to Other Income', () => {
    const es = r1Receiving(r, { warehouseId: 'WH', supplierId: 'S1', controlNo: 'RCV-1', lines: [{ accountingClass: 'SUPPLEMENT', qty: 10, freeQty: 2, unitCost: 100, stdCost: 100 }, { accountingClass: 'PLASTIC', qty: 5, freeQty: 0, unitCost: 10, stdCost: 10 }] });
    balanced(es); expect(es.map((e) => e.rule)).toEqual(['R1', 'R2']);
    expect(dr(es[0], 'INV_SUPPLEMENTS@WH')).toBe(1000); expect(dr(es[0], 'INV_PLASTIC@WH')).toBe(50); expect(cr(es[0], 'AP@S1')).toBe(1050); expect(es[0].book).toBe('GASTOS_DC');
    expect(dr(es[1], 'INV_SUPPLEMENTS@WH')).toBe(200); expect(cr(es[1], 'G:OTHER_INCOME_SUPPLIER_FREEBIES')).toBe(200);
  });
  it('R1: paid on receipt credits the payment account; consignment-in is off-balance-sheet by default', () => {
    const paid = r1Receiving(r, { warehouseId: 'WH', supplierId: 'S1', controlNo: 'x', paidOnReceipt: true, paymentAccountId: 'BANK', lines: [{ accountingClass: 'SUPPLEMENT', qty: 1, freeQty: 0, unitCost: 50, stdCost: 50 }] });
    expect(cr(paid[0], 'BANK')).toBe(50);
    expect(r1Receiving(r, { warehouseId: 'WH', supplierId: 'S2', controlNo: 'y', isConsignmentIn: true, lines: [{ accountingClass: 'SUPPLEMENT', qty: 1, freeQty: 0, unitCost: 50, stdCost: 50 }] })).toEqual([]);
    const onBs = r1Receiving(r, { warehouseId: 'WH', supplierId: 'S2', controlNo: 'y', isConsignmentIn: true, consignmentInOnBalanceSheet: true, lines: [{ accountingClass: 'SUPPLEMENT', qty: 1, freeQty: 0, unitCost: 50, stdCost: 50 }] });
    expect(dr(onBs[0], 'INV_CONSIGNMENT@WH')).toBe(50); expect(cr(onBs[0], 'G:AP_CONSIGNMENT')).toBe(50);
  });
  it('R3: cash sale → Cash on Hand; revenue by channel; delivery fee to Delivery Fee account; R5 cost of sale', () => {
    const es = r3r4Sale(r, { locationId: 'B1', channel: 'DELIVERY', paymentMode: 'CASH', counterparty: null, drSiNo: 'DR-1', productTotal: 1500, deliveryFee: 50, shippingFee: 0, grandTotal: 1550, costLines: [{ accountingClass: 'SUPPLEMENT', qty: 1, unitCost: 900 }] });
    balanced(es); expect(es[0].rule).toBe('R3'); expect(es[0].book).toBe('BENTA');
    expect(dr(es[0], 'CASH_ON_HAND@B1')).toBe(1550); expect(cr(es[0], 'SALES_DELIVERY@B1')).toBe(1500); expect(cr(es[0], 'SALES_DELIVERY_FEE@B1')).toBe(50);
    expect(es[1].rule).toBe('R5'); expect(dr(es[1], 'DC_SUPPLEMENTS@B1')).toBe(900); expect(cr(es[1], 'INV_SUPPLEMENTS@B1')).toBe(900);
  });
  it('R3: credit card walk-in → AR – Credit Card and Sales – Credit Card Walk In; ONLINE → chosen platform account', () => {
    const cc = r3r4Sale(r, { locationId: 'B1', channel: 'WALK_IN', paymentMode: 'CREDIT_CARD', counterparty: null, drSiNo: 'x', productTotal: 100, deliveryFee: 0, shippingFee: 0, grandTotal: 100, costLines: [] });
    expect(dr(cc[0], 'AR_CREDIT_CARD@B1')).toBe(100); expect(cr(cc[0], 'SALES_CREDIT_CARD_WALK_IN@B1')).toBe(100);
    const online = r3r4Sale(r, { locationId: 'B1', channel: 'SHIPPING_MARKETPLACE', paymentMode: 'ONLINE', paymentAccountId: 'SHOPEE', counterparty: null, drSiNo: 'x', productTotal: 100, deliveryFee: 0, shippingFee: 20, grandTotal: 120, costLines: [] });
    expect(dr(online[0], 'SHOPEE')).toBe(120); expect(cr(online[0], 'SALES_MARKETPLACE@B1')).toBe(100); expect(cr(online[0], 'SALES_SHIPPING_FEE@B1')).toBe(20);
    expect(() => r3r4Sale(r, { locationId: 'B1', channel: 'WALK_IN', paymentMode: 'ONLINE', counterparty: null, drSiNo: 'x', productTotal: 1, deliveryFee: 0, shippingFee: 0, grandTotal: 1, costLines: [] })).toThrow(MissingAccountError);
  });
  it('R4: AR sale to dealer debits dealer AR; collection with discount', () => {
    const sale = r3r4Sale(r, { locationId: 'B1', channel: 'DEALER', paymentMode: 'AR_PDC', counterparty: { type: 'DEALER', id: 'D1' }, drSiNo: 'x', productTotal: 1000, deliveryFee: 0, shippingFee: 0, grandTotal: 1000, costLines: [] });
    expect(sale[0].rule).toBe('R4'); expect(dr(sale[0], 'AR_DEALER@D1')).toBe(1000); expect(cr(sale[0], 'SALES_DEALER@B1')).toBe(1000);
    const col = r4Collection(r, { locationId: 'B1', counterparty: { type: 'DEALER', id: 'D1' }, amount: 950, discount: 50, paymentAccountId: 'BANK', creditNoteNo: 'CN-1' });
    balanced(col); expect(dr(col[0], 'BANK')).toBe(950); expect(dr(col[0], 'SALES_DISCOUNT@B1')).toBe(50); expect(cr(col[0], 'AR_DEALER@D1')).toBe(1000);
  });
  it('R5b: consignment-in batch → Direct Cost Consignment / AP Consignment instead of inventory', () => {
    const es = r5CostOfSale(r, 'B1', [{ accountingClass: 'SUPPLEMENT', qty: 2, unitCost: 100, isConsignmentIn: true, supplierId: 'HOE' }, { accountingClass: 'FREEBIE', qty: 1, unitCost: 10 }], 'x');
    expect(es.map((e) => e.rule).sort()).toEqual(['R5', 'R5b']);
    const b = es.find((e) => e.rule === 'R5b')!; expect(dr(b, 'DC_SUPPLEMENTS_CONSIGNMENT@B1')).toBe(200); expect(cr(b, 'G:AP_CONSIGNMENT')).toBe(200);
    const own = es.find((e) => e.rule === 'R5')!; expect(dr(own, 'DC_FREEBIES@B1')).toBe(10);
  });
  it('R6: transfer moves inventory between locations; shortfall to Spoilage or AR – Discrepancy', () => {
    const es = r6Transfer(r, { fromLocationId: 'WH', toLocationId: 'B1', controlNo: 'PO-1', lines: [{ accountingClass: 'SUPPLEMENT', qty: 9, unitCost: 100 }], shortfall: [{ accountingClass: 'SUPPLEMENT', qty: 1, unitCost: 100 }] });
    balanced(es); expect(dr(es[0], 'INV_SUPPLEMENTS@B1')).toBe(900); expect(cr(es[0], 'INV_SUPPLEMENTS@WH')).toBe(1000); expect(dr(es[0], 'G:SPOILAGE')).toBe(100);
    const charged = r6Transfer(r, { fromLocationId: 'WH', toLocationId: 'B1', controlNo: 'x', lines: [], shortfall: [{ accountingClass: 'SUPPLEMENT', qty: 1, unitCost: 100, charged: true }] });
    expect(dr(charged[0], 'AR_DISCREPANCY@WH')).toBe(100);
    expect(r6Transfer(r, { fromLocationId: 'WH', toLocationId: 'B1', controlNo: 'x', lines: [] })).toEqual([]);
  });
  it('R7: transfer to franchise = sale at franchise tier + cost of sale from sender', () => {
    const es = r7FranchiseTransfer(r, { fromLocationId: 'WH', franchiseLocationId: 'F1', controlNo: 'PO-2', saleTotal: 1100, costLines: [{ accountingClass: 'SUPPLEMENT', qty: 1, unitCost: 900 }] });
    balanced(es); expect(dr(es[0], 'AR_FRANCHISE@F1')).toBe(1100); expect(cr(es[0], 'G:SALES_WAREHOUSE_FRANCHISE')).toBe(1100); expect(dr(es[1], 'DC_SUPPLEMENTS@WH')).toBe(900);
  });
  it('R8: consignment out reclassifies inventory; consignee sale books AR + revenue + cost', () => {
    const out = r8ConsignOut(r, { fromLocationId: 'WH', controlNo: 'CSG-1', lines: [{ accountingClass: 'SUPPLEMENT', qty: 3, unitCost: 100 }] });
    expect(dr(out[0], 'INV_CONSIGNMENT@WH')).toBe(300); expect(cr(out[0], 'INV_SUPPLEMENTS@WH')).toBe(300);
    const sale = r8ConsigneeSale(r, { branchLocationId: 'WH', consigneeLocationId: 'C711', ref: 'x', saleTotal: 450, costLines: [{ accountingClass: 'SUPPLEMENT', qty: 3, unitCost: 100 }] });
    balanced(sale); expect(dr(sale[0], 'AR_OTHERS@WH')).toBe(450); expect(cr(sale[0], 'SALES_CONSIGNMENT@WH')).toBe(450); expect(cr(sale[1], 'INV_CONSIGNMENT@WH')).toBe(300);
  });
  it('R9: write-off → Expired Items – branch at batch cost', () => {
    const es = r9Writeoff(r, { locationId: 'B1', controlNo: 'WO-1', lines: [{ accountingClass: 'SUPPLEMENT', qty: 2, unitCost: 100 }] });
    balanced(es); expect(dr(es[0], 'EXPIRED_ITEMS@B1')).toBe(200); expect(cr(es[0], 'INV_SUPPLEMENTS@B1')).toBe(200); expect(es[0].book).toBe('GASTOS_DC');
  });
  it('R10: expense from cash drawer / petty cash / bank; deposit moves cash on hand to bank', () => {
    expect(cr(r10Expense(r, { locationId: 'B1', expenseAccountId: 'MERALCO@B1', amount: 500, paidFrom: 'CASH_DRAWER', controlNo: 'x' })[0], 'CASH_ON_HAND@B1')).toBe(500);
    expect(cr(r10Expense(r, { locationId: 'B1', expenseAccountId: 'X', amount: 5, paidFrom: 'PETTY_CASH', controlNo: 'x' })[0], 'PETTY_CASH@B1')).toBe(5);
    expect(cr(r10Expense(r, { locationId: 'B1', expenseAccountId: 'X', amount: 5, paidFrom: 'BANK_ACCOUNT', paidFromAccountId: 'BANK', controlNo: 'x' })[0], 'BANK')).toBe(5);
    expect(() => r10Expense(r, { locationId: 'B1', expenseAccountId: 'X', amount: 5, paidFrom: 'BANK_ACCOUNT', controlNo: 'x' })).toThrow(MissingAccountError);
    const dep = r10Deposit(r, { locationId: 'B1', bankAccountId: 'BANK', amount: 1000, ref: 'x' }); expect(dr(dep[0], 'BANK')).toBe(1000); expect(cr(dep[0], 'CASH_ON_HAND@B1')).toBe(1000);
  });
  it('R11: charge form at franchise cost; difference vs batch cost → Discrepancy Recovery; payroll deduction clears advances', () => {
    const es = r11ChargeForm(r, { locationId: 'B1', controlNo: 'CHG-1', lines: [{ accountingClass: 'SUPPLEMENT', qty: 2, unitCharge: 1100, batchCost: 900 }], allocations: [{ employeeId: 'E1', amount: 1200 }, { employeeId: 'E2', amount: 1000 }] });
    balanced(es); expect(es[0].book).toBe('ADVANCES'); expect(dr(es[0], 'ADV_EMPLOYEE_CHARGES@B1')).toBe(2200); expect(cr(es[0], 'INV_SUPPLEMENTS@B1')).toBe(1800); expect(cr(es[0], 'G:OTHER_INCOME_DISCREPANCY_RECOVERY')).toBe(400);
    const ded = r11PayrollDeduction(r, { locationId: 'B1', amount: 500, ref: 'x' }); expect(dr(ded[0], 'G:AP_SALARY')).toBe(500); expect(cr(ded[0], 'ADV_EMPLOYEE_CHARGES@B1')).toBe(500);
  });
  it('R12: cost increase revalues on-hand across locations to Other Income – Price Increase; decreases do nothing', () => {
    const es = r12Revaluation(r, { productAccountingClass: 'SUPPLEMENT', costOld: 100, costNew: 110, onHand: [{ locationId: 'WH', qty: 50 }, { locationId: 'B1', qty: 5 }, { locationId: 'B2', qty: 0 }], ref: 'PC-1' });
    balanced(es); expect(dr(es[0], 'INV_SUPPLEMENTS@WH')).toBe(500); expect(dr(es[0], 'INV_SUPPLEMENTS@B1')).toBe(50); expect(cr(es[0], 'G:OTHER_INCOME_PRICE_INCREASE')).toBe(550);
    expect(r12Revaluation(r, { productAccountingClass: 'SUPPLEMENT', costOld: 100, costNew: 90, onHand: [{ locationId: 'WH', qty: 50 }], ref: 'x' })).toEqual([]);
  });
  it('R13: payroll finalize balances and splits cost centres; close clears AP – Salary against the chosen account', () => {
    const line = { employeeId: 'E1', costCentreLocationId: 'B1', basic: 10000, overtime: 500, incentives: 1000, thirteenth: 833.33, sssEe: 450, sssEr: 950, phicEe: 250, phicEr: 250, hdmfEe: 100, hdmfEr: 100, sssLoan: 300, hdmfLoan: 0, advances: 200, chargeDeductions: 150 };
    const netPay = computeNetPay(line); expect(netPay.toNumber()).toBe(10050);
    const es = r13PayrollFinalize(r, { ref: 'P1', lines: [{ ...line, netPay }, { ...line, employeeId: 'E2', costCentreLocationId: null, netPay }] });
    balanced(es); expect(dr(es[0], 'SALARIES_STAFF@B1')).toBe(10500); expect(dr(es[0], 'G:SALARIES_OFFICE')).toBe(11500); expect(cr(es[0], 'G:AP_SALARY')).toBe(20100); expect(cr(es[0], 'G:SSS_PAYABLE')).toBe(2800); expect(cr(es[0], 'G:THIRTEENTH_MONTH_PAYABLE')).toBeCloseTo(1666.66, 2); expect(cr(es[0], 'ADV_EMPLOYEE_CHARGES@B1')).toBe(150);
    const close = r13PayrollClose(r, { ref: 'P1', netTotal: 20100, paymentAccountId: 'BANK' }); expect(dr(close[0], 'G:AP_SALARY')).toBe(20100); expect(cr(close[0], 'BANK')).toBe(20100);
  });
  it('R14: depreciation debits expense and credits accumulated depreciation per asset class', () => {
    const es = r14Depreciation(r, { assets: [{ accumDepnAccountId: 'ACC_EQUIP', amount: 100, name: 'Rack' }, { accumDepnAccountId: 'ACC_EQUIP', amount: 50, name: 'Bench' }, { accumDepnAccountId: 'ACC_VEH', amount: 300, name: 'Van' }], depreciationExpenseAccountId: 'DEPN', ref: '2026-01' });
    balanced(es); expect(dr(es[0], 'DEPN')).toBe(450); expect(cr(es[0], 'ACC_EQUIP')).toBe(150); expect(cr(es[0], 'ACC_VEH')).toBe(300);
    expect(r14Depreciation(r, { assets: [], depreciationExpenseAccountId: 'DEPN', ref: 'x' })).toEqual([]);
  });
});
