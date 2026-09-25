/**
 * §8.5 Daily Branch Sales Report data model — the FRONT sheet plus line-level sheets.
 * Pure: takes already-loaded sales/expenses/close rows and produces the report structure that both
 * the xlsx and PDF renderers consume. Cost never appears here.
 */
import Decimal from 'decimal.js';
import { D, ZERO } from '../common/money';

export interface RSale { id: string; drSiNo: string; channel: string; channelSub: string | null; paymentMode: string; customerName: string | null; agentName: string | null; riderName: string | null; deliveryFee: Decimal; riderIncentive: Decimal; shippingFee: Decimal; shippingExpense: Decimal; marketplaceCharges: Decimal; productTotal: Decimal; grandTotal: Decimal; cardMid: string | null; cardSlipNo: string | null; cardApprovalCode: string | null; cardBatchNo: string | null; notes: string | null; lines: { productName: string; qty: number; unitPrice: Decimal; amount: Decimal; isFreebie: boolean; accountingClass: string }[] }
export interface RExpense { accountTitle: string; payee: string | null; amount: Decimal; paidFrom: string }
export interface RClose { moneyBreakdown: Record<string, number> | null; countedCash: Decimal | null; expectedCash: Decimal | null; cashVariance: Decimal | null }

const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.plus(x), ZERO);
const prod = (s: RSale[]) => sum(s.map((x) => x.productTotal));
const isShipping = (s: RSale) => s.channel === 'SHIPPING_COURIER' || s.channel === 'SHIPPING_MARKETPLACE';

export function buildDailySalesReport(input: { branch: string; date: string; sales: RSale[]; expenses: RExpense[]; close: RClose | null; preparedBy: string; majorExpenseTitles?: RegExp }) {
  const S = input.sales.filter((s) => s.channelSub !== 'CONSIGNMENT');
  const by = (mode: string, ch: (s: RSale) => boolean) => S.filter((s) => s.paymentMode === mode && ch(s));
  const deliv = (s: RSale) => s.channel === 'DELIVERY' || (!!s.riderName && ['WALK_IN', 'PERSONAL', 'OTHER'].includes(s.channel));
  const walk = (s: RSale) => (s.channel === 'WALK_IN' || s.channel === 'PERSONAL' || s.channel === 'OTHER') && !deliv(s);
  const cash = {
    walkIn: prod(by('CASH', walk)), delivery: prod(by('CASH', deliv)), franchise: prod(by('CASH', (s) => s.channel === 'FRANCHISE')), dealer: prod(by('CASH', (s) => s.channel === 'DEALER')), agent: prod(by('CASH', (s) => s.channel === 'AGENT')),
    deliveryFee: sum(by('CASH', () => true).map((s) => s.deliveryFee)),
  };
  const cashSubtotal = sum([cash.walkIn, cash.delivery, cash.franchise, cash.dealer, cash.agent, cash.deliveryFee]);
  const cc = { walkIn: prod(by('CREDIT_CARD', walk)), delivery: prod(by('CREDIT_CARD', deliv)), agent: prod(by('CREDIT_CARD', (s) => s.channel === 'AGENT')), other: prod(by('CREDIT_CARD', (s) => !walk(s) && !deliv(s) && s.channel !== 'AGENT')) };
  const ccTotal = sum(Object.values(cc));
  const onlineWalk = { walkIn: prod(by('ONLINE', walk)), franchise: prod(by('ONLINE', (s) => s.channel === 'FRANCHISE')), dealer: prod(by('ONLINE', (s) => s.channel === 'DEALER')), agent: prod(by('ONLINE', (s) => s.channel === 'AGENT')) };
  const onlineDelivery = { delivery: prod(by('ONLINE', deliv)), deliveryFee: sum(by('ONLINE', () => true).map((s) => s.deliveryFee)) };
  const ship = S.filter(isShipping);
  const shipping = { courier: prod(ship.filter((s) => s.channel === 'SHIPPING_COURIER' && !['FRANCHISE', 'DEALER', 'AGENT'].includes(s.channelSub ?? ''))), franchise: prod(ship.filter((s) => s.channelSub === 'FRANCHISE')), dealer: prod(ship.filter((s) => s.channelSub === 'DEALER')), agent: prod(ship.filter((s) => s.channelSub === 'AGENT')), marketplace: prod(ship.filter((s) => s.channel === 'SHIPPING_MARKETPLACE')), shippingFee: sum(ship.map((s) => s.shippingFee)) };
  const onlineCcShipTotal = sum([...Object.values(onlineWalk), ...Object.values(onlineDelivery), ...Object.values(shipping), ccTotal]);
  const arTotal = prod(by('AR_PDC', () => true));
  const channelTotals = ['WALK_IN', 'DELIVERY', 'SHIPPING_COURIER', 'SHIPPING_MARKETPLACE', 'FRANCHISE', 'DEALER', 'AGENT', 'PERSONAL', 'OTHER'].map((ch) => ({ channel: ch, amount: prod(S.filter((s) => s.channel === ch)), products: S.filter((s) => s.channel === ch).flatMap((s) => s.lines).filter((l) => !l.isFreebie).reduce((n, l) => n + l.qty, 0) }));
  const lines = S.flatMap((s) => s.lines);
  const productCounts = { supplements: lines.filter((l) => !l.isFreebie && ['SUPPLEMENT', 'REPACKED', 'BUNDLE'].includes(l.accountingClass)).reduce((n, l) => n + l.qty, 0), apparel: lines.filter((l) => l.accountingClass === 'APPAREL').reduce((n, l) => n + l.qty, 0), equipment: lines.filter((l) => l.accountingClass === 'EQUIPMENT').reduce((n, l) => n + l.qty, 0), agent: S.filter((s) => s.channel === 'AGENT').flatMap((s) => s.lines).reduce((n, l) => n + l.qty, 0) };
  const riders = [...new Set(S.filter((s) => s.riderName).map((s) => s.riderName!))].map((r) => { const xs = S.filter((s) => s.riderName === r); const pa = prod(xs); const df = sum(xs.map((s) => s.deliveryFee)); const inc = sum(xs.map((s) => s.riderIncentive)); return { rider: r, productAmount: pa, deliveryFee: df, subtotal: pa.plus(df), incentives: inc, total: pa.plus(df).minus(inc), remarks: '' }; });
  const major = input.majorExpenseTitles ?? /rent|meralco|internet|globe|pldt|water|incentive|load|lalamove/i;
  const expenses = input.expenses.map((e) => ({ ...e, group: major.test(e.accountTitle) ? 'MAJOR' : 'OTHER' }));
  const riderExpense = sum(expenses.filter((e) => /rider|driver/i.test(e.accountTitle)).map((e) => e.amount));
  const shippingExpense = { orders: sum(S.map((s) => s.shippingExpense)).plus(sum(expenses.filter((e) => /shipping.*order/i.test(e.accountTitle)).map((e) => e.amount))), marketing: sum(expenses.filter((e) => /shipping.*marketing/i.test(e.accountTitle)).map((e) => e.amount)) };
  const cashExpenses = sum(input.expenses.filter((e) => e.paidFrom === 'CASH_DRAWER').map((e) => e.amount));
  const totalExpenses = sum(input.expenses.map((e) => e.amount));
  const freebies = lines.filter((l) => l.isFreebie).map((l) => ({ item: l.productName, qty: l.qty }));
  const overall = sum(S.map((s) => s.grandTotal));
  return {
    header: { branch: input.branch, date: input.date, systemDate: new Date().toISOString(), preparedBy: input.preparedBy },
    sales: S,
    cash: { ...cash, subtotal: cashSubtotal }, creditCard: { ...cc, total: ccTotal }, onlineWalkIn: onlineWalk, onlineDelivery, shipping, onlineCcShippingTotal: onlineCcShipTotal, ar: arTotal,
    channelTotals, productCounts, feesBox: { deliveryFee: sum(S.map((s) => s.deliveryFee)), shippingFee: sum(S.map((s) => s.shippingFee)) }, riders, moneyBreakdown: input.close?.moneyBreakdown ?? null, cashCount: input.close ? { counted: input.close.countedCash, expected: input.close.expectedCash, variance: input.close.cashVariance } : null,
    expenses, expenseTotals: { major: sum(expenses.filter((e) => e.group === 'MAJOR').map((e) => e.amount)), other: sum(expenses.filter((e) => e.group === 'OTHER').map((e) => e.amount)), total: totalExpenses, riderExpense, shippingExpense },
    freebies, bankDeposit: { cash: cashSubtotal, expenses: cashExpenses, total: cashSubtotal.minus(cashExpenses) }, totalCashDeposit: cashSubtotal.minus(cashExpenses), overallSales: overall, totalProducts: channelTotals.reduce((n, c) => n + c.products, 0),
    sheets: {
      walkIn: S.filter(walk).map(rowOf), delivery: S.filter(deliv).map(rowOf), shipping: ship.map(rowOf), creditCard: S.filter((s) => s.paymentMode === 'CREDIT_CARD').map((s) => ({ ...rowOf(s), customer: s.customerName, mid: s.cardMid, slip: s.cardSlipNo, approval: s.cardApprovalCode, batch: s.cardBatchNo })),
      receiptTracker: S.map((s) => ({ drSiNo: s.drSiNo, channel: s.channel, paymentMode: s.paymentMode, amount: s.grandTotal, customer: s.customerName ?? s.agentName ?? '' })),
    },
  };
  function rowOf(s: RSale) { return { drSiNo: s.drSiNo, items: s.lines.map((l) => `${l.qty}× ${l.productName}`).join(', '), qty: s.lines.reduce((n, l) => n + l.qty, 0), amount: s.productTotal, fee: s.deliveryFee.plus(s.shippingFee), total: s.grandTotal, remarks: [s.paymentMode, s.channelSub, s.notes].filter(Boolean).join(' / ') }; }
}
export type DailySalesReport = ReturnType<typeof buildDailySalesReport>;
export const asNum = (d: Decimal | null | undefined) => (d ? D(d).toDecimalPlaces(2).toNumber() : 0);
