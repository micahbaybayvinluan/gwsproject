import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { buildDailySalesReport, RSale } from './daily-sales-report';

const d = (n: number) => new Decimal(n);
const sale = (o: Partial<RSale>): RSale => ({ id: 'x', drSiNo: '1', channel: 'WALK_IN', channelSub: null, paymentMode: 'CASH', customerName: null, agentName: null, riderName: null, deliveryFee: d(0), riderIncentive: d(0), shippingFee: d(0), shippingExpense: d(0), marketplaceCharges: d(0), productTotal: d(0), grandTotal: d(0), cardMid: null, cardSlipNo: null, cardApprovalCode: null, cardBatchNo: null, notes: null, lines: [], ...o });

describe('Daily Branch Sales Report builder (§8.5)', () => {
  it('splits by channel × payment mode and computes deposit summary', () => {
    const rep = buildDailySalesReport({
      branch: 'West Ave', date: '2026-09-24', preparedBy: 'Sales Associate', close: { moneyBreakdown: { '1000': 2, '500': 1 }, countedCash: d(2500), expectedCash: d(2450), cashVariance: d(50) },
      sales: [
        sale({ drSiNo: '1', channel: 'WALK_IN', paymentMode: 'CASH', productTotal: d(1500), grandTotal: d(1500), lines: [{ productName: 'Whey', qty: 1, unitPrice: d(1500), amount: d(1500), isFreebie: false, accountingClass: 'SUPPLEMENT' }, { productName: 'Shaker', qty: 1, unitPrice: d(0), amount: d(0), isFreebie: true, accountingClass: 'FREEBIE' }] }),
        sale({ drSiNo: '2', channel: 'DELIVERY', paymentMode: 'CASH', riderName: 'Juan', productTotal: d(1000), deliveryFee: d(50), riderIncentive: d(10), grandTotal: d(1050), lines: [{ productName: 'Creatine', qty: 2, unitPrice: d(500), amount: d(1000), isFreebie: false, accountingClass: 'SUPPLEMENT' }] }),
        sale({ drSiNo: '3', channel: 'WALK_IN', paymentMode: 'CREDIT_CARD', productTotal: d(700), grandTotal: d(700), cardMid: 'M1', lines: [{ productName: 'Shirt', qty: 1, unitPrice: d(700), amount: d(700), isFreebie: false, accountingClass: 'APPAREL' }] }),
        sale({ drSiNo: '4', channel: 'SHIPPING_MARKETPLACE', paymentMode: 'ONLINE', productTotal: d(2000), shippingFee: d(100), grandTotal: d(2100), lines: [] }),
        sale({ drSiNo: '5', channel: 'DEALER', paymentMode: 'AR_PDC', productTotal: d(5000), grandTotal: d(5000), lines: [] }),
      ],
      expenses: [{ accountTitle: 'Meralco – West Ave', payee: null, amount: d(300), paidFrom: 'CASH_DRAWER' }, { accountTitle: 'Printing – West Ave', payee: 'Shop', amount: d(20), paidFrom: 'PETTY_CASH' }],
    });
    expect(rep.cash.walkIn.toNumber()).toBe(1500); expect(rep.cash.delivery.toNumber()).toBe(1000); expect(rep.cash.deliveryFee.toNumber()).toBe(50); expect(rep.cash.subtotal.toNumber()).toBe(2550);
    expect(rep.creditCard.walkIn.toNumber()).toBe(700); expect(rep.shipping.marketplace.toNumber()).toBe(2000); expect(rep.shipping.shippingFee.toNumber()).toBe(100);
    expect(rep.onlineCcShippingTotal.toNumber()).toBe(2800); expect(rep.ar.toNumber()).toBe(5000);
    expect(rep.productCounts.apparel).toBe(1); expect(rep.productCounts.supplements).toBe(3);
    expect(rep.riders[0]).toMatchObject({ rider: 'Juan' }); expect(rep.riders[0].total.toNumber()).toBe(1040);
    expect(rep.freebies).toEqual([{ item: 'Shaker', qty: 1 }]);
    expect(rep.expenseTotals.major.toNumber()).toBe(300); expect(rep.expenseTotals.other.toNumber()).toBe(20);
    expect(rep.bankDeposit.total.toNumber()).toBe(2250); expect(rep.totalCashDeposit.toNumber()).toBe(2250);
    expect(rep.overallSales.toNumber()).toBe(10350);
    expect(rep.sheets.creditCard[0].mid).toBe('M1'); expect(rep.sheets.walkIn).toHaveLength(2); expect(rep.sheets.receiptTracker).toHaveLength(5);
    expect(JSON.stringify(rep)).not.toMatch(/cost/i);
  });
});
