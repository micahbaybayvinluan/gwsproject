/**
 * §10.4 Posting rules R1–R14 as pure functions.
 * Each builder returns a balanced set of journal lines given an AccountResolver; nothing here touches the DB,
 * so every rule is unit-testable with an in-memory resolver (see posting-rules.spec.ts).
 */
import Decimal from 'decimal.js';
import { D, round2 } from '../common/money';
import { directCostTemplateFor, inventoryTemplateFor, salesTemplateFor } from './account-templates';

export type Book = 'BENTA' | 'GENERAL' | 'ADVANCES' | 'GASTOS_OPEX' | 'GASTOS_DC';
export interface Line { accountId: string; debit: Decimal; credit: Decimal; memo?: string }
export interface Entry { rule: string; book: Book; lines: Line[]; remarks: string; name?: string }

/** Resolves accounts by concept. Throws MissingAccountError when the chart has no matching account. */
export interface AccountResolver {
  /** Branch-templated account: template key + branch location id. */
  branch(templateKey: string, locationId: string): string;
  /** Company-wide account by GLOBAL_ACCOUNTS key. */
  global(key: string): string;
  /** AR account for a counterparty (dealer / franchise / agent / consignee / customer). Falls back to AR – Others ({branch}). */
  ar(counterparty: { type: string; id?: string | null; locationId?: string | null } | null, branchLocationId: string): string;
  /** AP account for a supplier, or the global AP – Suppliers account. */
  ap(supplierId: string | null | undefined, consignment?: boolean): string;
}
export class MissingAccountError extends Error { constructor(public concept: string) { super(`No account for ${concept}`); } }

const dr = (accountId: string, amt: Decimal.Value, memo?: string): Line => ({ accountId, debit: round2(amt), credit: D(0), memo });
const cr = (accountId: string, amt: Decimal.Value, memo?: string): Line => ({ accountId, debit: D(0), credit: round2(amt), memo });
const nz = (lines: Line[]) => lines.filter((l) => !l.debit.isZero() || !l.credit.isZero());

export function assertBalanced(lines: Line[]) {
  const d = lines.reduce((s, l) => s.plus(l.debit), D(0)); const c = lines.reduce((s, l) => s.plus(l.credit), D(0));
  if (!d.equals(c)) throw new Error(`Unbalanced entry: Dr ${d} ≠ Cr ${c}`);
}
/** Merge lines that hit the same account on the same side. */
export function consolidate(lines: Line[]): Line[] {
  const map = new Map<string, Line>();
  for (const l of lines) {
    const key = `${l.accountId}|${l.debit.isZero() ? 'C' : 'D'}`;
    const cur = map.get(key);
    if (cur) { cur.debit = cur.debit.plus(l.debit); cur.credit = cur.credit.plus(l.credit); }
    else map.set(key, { ...l });
  }
  return nz([...map.values()]);
}

export interface CostLine { accountingClass: string; qty: number; unitCost: Decimal.Value; isConsignmentIn?: boolean; supplierId?: string | null }

// ── R1/R2 Receiving approved ──
export function r1Receiving(r: AccountResolver, e: { warehouseId: string; supplierId: string; lines: { accountingClass: string; qty: number; freeQty: number; unitCost: Decimal.Value; stdCost: Decimal.Value }[]; paidOnReceipt?: boolean; paymentAccountId?: string | null; isConsignmentIn?: boolean; consignmentInOnBalanceSheet?: boolean; controlNo: string }): Entry[] {
  if (e.isConsignmentIn && !e.consignmentInOnBalanceSheet) return []; // off-balance-sheet until sold (§7.4)
  const lines: Line[] = []; const free: Line[] = [];
  let total = D(0);
  for (const l of e.lines) {
    const inv = e.isConsignmentIn ? r.branch('INV_CONSIGNMENT', e.warehouseId) : r.branch(inventoryTemplateFor(l.accountingClass), e.warehouseId);
    const amt = D(l.unitCost).mul(l.qty);
    lines.push(dr(inv, amt)); total = total.plus(amt);
    if (l.freeQty > 0) { const f = D(l.stdCost).mul(l.freeQty); free.push(dr(inv, f)); free.push(cr(r.global('OTHER_INCOME_SUPPLIER_FREEBIES'), f)); }
  }
  lines.push(cr(e.paidOnReceipt && e.paymentAccountId ? e.paymentAccountId : r.ap(e.supplierId, !!e.isConsignmentIn), total));
  const out: Entry[] = [{ rule: 'R1', book: 'GASTOS_DC', lines: consolidate(lines), remarks: `Receiving ${e.controlNo}` }];
  if (free.length) out.push({ rule: 'R2', book: 'GENERAL', lines: consolidate(free), remarks: `Supplier freebies on ${e.controlNo}` });
  out.forEach((x) => assertBalanced(x.lines));
  return out;
}

// ── R3/R4 Sale posted (+R5 cost of sale) ──
export interface SaleEvent {
  locationId: string; channel: string; channelSub?: string | null; paymentMode: 'CASH' | 'ONLINE' | 'CREDIT_CARD' | 'AR_PDC'; paymentAccountId?: string | null;
  counterparty: { type: string; id?: string | null; locationId?: string | null } | null; drSiNo: string;
  productTotal: Decimal.Value; deliveryFee: Decimal.Value; shippingFee: Decimal.Value; grandTotal: Decimal.Value;
  costLines: CostLine[];
}
export function r3r4Sale(r: AccountResolver, e: SaleEvent): Entry[] {
  const lines: Line[] = [];
  const total = D(e.grandTotal);
  let debitAcct: string;
  if (e.paymentMode === 'CASH') debitAcct = r.branch('CASH_ON_HAND', e.locationId);
  else if (e.paymentMode === 'CREDIT_CARD') debitAcct = r.branch('AR_CREDIT_CARD', e.locationId);
  else if (e.paymentMode === 'ONLINE') { if (!e.paymentAccountId) throw new MissingAccountError('payment account for ONLINE sale'); debitAcct = e.paymentAccountId; }
  else debitAcct = r.ar(e.counterparty, e.locationId);
  lines.push(dr(debitAcct, total));
  lines.push(cr(r.branch(salesTemplateFor(e.channel, e.channelSub, e.paymentMode), e.locationId), e.productTotal));
  if (!D(e.deliveryFee).isZero()) lines.push(cr(r.branch('SALES_DELIVERY_FEE', e.locationId), e.deliveryFee));
  if (!D(e.shippingFee).isZero()) lines.push(cr(r.branch('SALES_SHIPPING_FEE', e.locationId), e.shippingFee));
  const rule = e.paymentMode === 'AR_PDC' ? 'R4' : 'R3';
  const entries: Entry[] = [{ rule, book: 'BENTA', lines: consolidate(lines), remarks: `Sale ${e.drSiNo}` }];
  entries.push(...r5CostOfSale(r, e.locationId, e.costLines, e.drSiNo));
  entries.forEach((x) => assertBalanced(x.lines));
  return entries;
}
export function r5CostOfSale(r: AccountResolver, locationId: string, costLines: CostLine[], ref: string): Entry[] {
  const own: Line[] = []; const consign: Line[] = [];
  for (const c of costLines) {
    const amt = D(c.unitCost).mul(c.qty);
    if (amt.isZero()) continue;
    if (c.isConsignmentIn) { consign.push(dr(r.branch('DC_SUPPLEMENTS_CONSIGNMENT', locationId), amt)); consign.push(cr(r.ap(c.supplierId, true), amt)); }
    else { own.push(dr(r.branch(directCostTemplateFor(c.accountingClass), locationId), amt)); own.push(cr(r.branch(inventoryTemplateFor(c.accountingClass), locationId), amt)); }
  }
  const out: Entry[] = [];
  if (own.length) out.push({ rule: 'R5', book: 'GASTOS_DC', lines: consolidate(own), remarks: `Cost of sale ${ref}` });
  if (consign.length) out.push({ rule: 'R5b', book: 'GASTOS_DC', lines: consolidate(consign), remarks: `Cost of sale (consignment-in) ${ref}` });
  return out;
}
// ── R4 collection ──
export function r4Collection(r: AccountResolver, e: { locationId: string; counterparty: { type: string; id?: string | null; locationId?: string | null } | null; amount: Decimal.Value; discount: Decimal.Value; paymentAccountId: string; creditNoteNo: string }): Entry[] {
  const lines = [dr(e.paymentAccountId, e.amount)];
  if (!D(e.discount).isZero()) lines.push(dr(r.branch('SALES_DISCOUNT', e.locationId), e.discount));
  lines.push(cr(r.ar(e.counterparty, e.locationId), D(e.amount).plus(e.discount)));
  const entry: Entry = { rule: 'R4', book: 'BENTA', lines: consolidate(lines), remarks: `Collection ${e.creditNoteNo}` };
  assertBalanced(entry.lines); return [entry];
}
/** Franchise payment (memo 2026-07-31): the goods part clears the franchise's AR; penalty and interest are other income, taken when they are paid. */
export function r4FranchiseCollection(r: AccountResolver, e: { fromLocationId: string; franchiseLocationId: string; principal: Decimal.Value; charges: Decimal.Value; paymentAccountId: string; receiptNo: string }): Entry[] {
  const lines = [dr(e.paymentAccountId, D(e.principal).plus(e.charges)), cr(r.ar({ type: 'FRANCHISE', locationId: e.franchiseLocationId }, e.fromLocationId), e.principal)];
  if (!D(e.charges).isZero()) lines.push(cr(r.global('OTHER_INCOME_FRANCHISE_LATE_CHARGES'), e.charges));
  const entry: Entry = { rule: 'R4', book: 'BENTA', lines: consolidate(nz(lines)), remarks: `Franchise collection ${e.receiptNo}` };
  assertBalanced(entry.lines); return [entry];
}
/** Shipping billed to a franchise on a sale (owner request 2026-10-01): its own receivable, shipping income of the branch that sent the goods. A negative amount reverses part of it. */
export function r7bFranchiseShipping(r: AccountResolver, e: { fromLocationId: string; franchiseLocationId: string; amount: Decimal.Value; ref: string }): Entry[] {
  const amt = D(e.amount); if (amt.isZero()) return [];
  const ar = r.ar({ type: 'FRANCHISE', locationId: e.franchiseLocationId }, e.fromLocationId); let inc: string; try { inc = r.branch('SALES_SHIPPING_FEE', e.fromLocationId); } catch (err) { if (!(err instanceof MissingAccountError)) throw err; inc = r.global('SALES_WAREHOUSE_FRANCHISE'); } // the warehouse has no shipping-fee account of its own: its franchise sales account takes it
  const lines = amt.gt(0) ? [dr(ar, amt), cr(inc, amt)] : [dr(inc, amt.abs()), cr(ar, amt.abs())];
  const entry: Entry = { rule: 'R4', book: 'BENTA', lines: consolidate(lines), remarks: `Franchise shipping charge ${e.ref}` };
  assertBalanced(entry.lines); return [entry];
}
// ── R6 transfer between company locations ──
export function r6Transfer(r: AccountResolver, e: { fromLocationId: string; toLocationId: string; controlNo: string; lines: CostLine[]; shortfall?: { accountingClass: string; qty: number; unitCost: Decimal.Value; charged?: boolean }[] }): Entry[] {
  const lines: Line[] = [];
  for (const l of e.lines) { const amt = D(l.unitCost).mul(l.qty); lines.push(dr(r.branch(inventoryTemplateFor(l.accountingClass), e.toLocationId), amt)); lines.push(cr(r.branch(inventoryTemplateFor(l.accountingClass), e.fromLocationId), amt)); }
  for (const s of e.shortfall ?? []) { const amt = D(s.unitCost).mul(s.qty); lines.push(dr(s.charged ? r.branch('AR_DISCREPANCY', e.fromLocationId) : r.global('SPOILAGE'), amt)); lines.push(cr(r.branch(inventoryTemplateFor(s.accountingClass), e.fromLocationId), amt)); }
  const entry: Entry = { rule: 'R6', book: 'GENERAL', lines: consolidate(lines), remarks: `Transfer ${e.controlNo}` };
  if (!entry.lines.length) return [];
  assertBalanced(entry.lines); return [entry];
}
// ── R7 transfer to franchise = sale at FRANCHISE tier ──
export function r7FranchiseTransfer(r: AccountResolver, e: { fromLocationId: string; franchiseLocationId: string; controlNo: string; saleTotal: Decimal.Value; costLines: CostLine[] }): Entry[] {
  const lines = [dr(r.ar({ type: 'FRANCHISE', locationId: e.franchiseLocationId }, e.fromLocationId), e.saleTotal), cr(r.global('SALES_WAREHOUSE_FRANCHISE'), e.saleTotal)];
  const out: Entry[] = [{ rule: 'R7', book: 'BENTA', lines: consolidate(lines), remarks: `Franchise transfer ${e.controlNo}` }, ...r5CostOfSale(r, e.fromLocationId, e.costLines, e.controlNo)];
  out.forEach((x) => assertBalanced(x.lines)); return out;
}
// ── R8 consignment out ──
export function r8ConsignOut(r: AccountResolver, e: { fromLocationId: string; controlNo: string; lines: CostLine[] }): Entry[] {
  const lines: Line[] = [];
  for (const l of e.lines) { const amt = D(l.unitCost).mul(l.qty); lines.push(dr(r.branch('INV_CONSIGNMENT', e.fromLocationId), amt)); lines.push(cr(r.branch(inventoryTemplateFor(l.accountingClass), e.fromLocationId), amt)); }
  const entry: Entry = { rule: 'R8', book: 'GENERAL', lines: consolidate(lines), remarks: `Consignment out ${e.controlNo}` };
  assertBalanced(entry.lines); return [entry];
}
export function r8ConsigneeSale(r: AccountResolver, e: { branchLocationId: string; consigneeLocationId: string; ref: string; saleTotal: Decimal.Value; costLines: CostLine[] }): Entry[] {
  const sale: Line[] = [dr(r.ar({ type: 'CONSIGNEE', locationId: e.consigneeLocationId }, e.branchLocationId), e.saleTotal), cr(r.branch('SALES_CONSIGNMENT', e.branchLocationId), e.saleTotal)];
  const cost: Line[] = [];
  for (const c of e.costLines) { const amt = D(c.unitCost).mul(c.qty); cost.push(dr(r.branch(directCostTemplateFor(c.accountingClass), e.branchLocationId), amt)); cost.push(cr(r.branch('INV_CONSIGNMENT', e.branchLocationId), amt)); }
  const out: Entry[] = [{ rule: 'R8', book: 'BENTA', lines: consolidate(sale), remarks: `Consignee sale ${e.ref}` }];
  if (cost.length) out.push({ rule: 'R8', book: 'GASTOS_DC', lines: consolidate(cost), remarks: `Consignee cost ${e.ref}` });
  out.forEach((x) => assertBalanced(x.lines)); return out;
}
// ── R9 write-off ──
export function r9Writeoff(r: AccountResolver, e: { locationId: string; controlNo: string; lines: CostLine[] }): Entry[] {
  const lines: Line[] = [];
  for (const l of e.lines) { const amt = D(l.unitCost).mul(l.qty); lines.push(dr(r.branch('EXPIRED_ITEMS', e.locationId), amt)); lines.push(cr(r.branch(inventoryTemplateFor(l.accountingClass), e.locationId), amt)); }
  const entry: Entry = { rule: 'R9', book: 'GASTOS_DC', lines: consolidate(lines), remarks: `Write-off ${e.controlNo}` };
  assertBalanced(entry.lines); return [entry];
}
// ── R10 expense / deposit ──
export function r10Expense(r: AccountResolver, e: { locationId: string; expenseAccountId: string; amount: Decimal.Value; paidFrom: 'CASH_DRAWER' | 'PETTY_CASH' | 'BANK_ACCOUNT' | 'OWNER_ADVANCE'; paidFromAccountId?: string | null; controlNo: string; payee?: string | null }): Entry[] {
  let credit: string;
  if (e.paidFrom === 'CASH_DRAWER') credit = r.branch('CASH_ON_HAND', e.locationId);
  else if (e.paidFrom === 'PETTY_CASH') credit = r.branch('PETTY_CASH', e.locationId);
  else if (e.paidFromAccountId) credit = e.paidFromAccountId;
  else throw new MissingAccountError('paid-from account');
  const entry: Entry = { rule: 'R10', book: 'GASTOS_OPEX', lines: [dr(e.expenseAccountId, e.amount), cr(credit, e.amount)], remarks: `Expense ${e.controlNo}`, name: e.payee ?? undefined };
  assertBalanced(entry.lines); return [entry];
}
/** Cash fund (petty cash) funded or topped up from a chosen account. */
export function r10FundSetup(r: AccountResolver, e: { locationId: string; amount: Decimal.Value; fromAccountId: string; ref: string }): Entry[] {
  const entry: Entry = { rule: 'R10', book: 'GENERAL', lines: [dr(r.branch('PETTY_CASH', e.locationId), e.amount), cr(e.fromAccountId, e.amount)], remarks: `Cash fund ${e.ref}` };
  assertBalanced(entry.lines); return [entry];
}
/** Cash fund replenished from the day's cash sales: cash leaves the drawer (Cash on Hand) and returns to the fund. */
export function r10FundReplenish(r: AccountResolver, e: { locationId: string; amount: Decimal.Value; ref: string }): Entry[] {
  const entry: Entry = { rule: 'R10', book: 'GENERAL', lines: [dr(r.branch('PETTY_CASH', e.locationId), e.amount), cr(r.branch('CASH_ON_HAND', e.locationId), e.amount)], remarks: `Cash fund replenishment ${e.ref}` };
  assertBalanced(entry.lines); return [entry];
}
export function r10Deposit(r: AccountResolver, e: { locationId: string; bankAccountId: string; amount: Decimal.Value; ref: string }): Entry[] {
  const entry: Entry = { rule: 'R10', book: 'GENERAL', lines: [dr(e.bankAccountId, e.amount), cr(r.branch('CASH_ON_HAND', e.locationId), e.amount)], remarks: `Cash deposit ${e.ref}` };
  assertBalanced(entry.lines); return [entry];
}
// ── R11 charge form finalized ──
export interface ChargeLineEvent { accountingClass?: string | null; qty: number; unitCharge: Decimal.Value; batchCost: Decimal.Value; amountOnly?: boolean }
/**
 * R11: a finalized charge form moves the loss to Advances to Employees.
 * Product lines credit inventory at batch cost (difference to the franchise-price charge → recovery income / spoilage).
 * Amount-only lines: a cash shortage credits the branch Cash on Hand; other amount-only charges credit recovery income.
 */
export function r11ChargeForm(r: AccountResolver, e: { locationId: string; controlNo: string; kind?: string; lines: ChargeLineEvent[]; allocations: { employeeId: string; amount: Decimal.Value }[] }): Entry[] {
  const lines: Line[] = [];
  let totalCharge = D(0); let totalCost = D(0);
  for (const l of e.lines) {
    const charge = D(l.unitCharge).mul(l.qty);
    if (l.amountOnly || !l.accountingClass) { lines.push(cr(e.kind === 'CASH_SHORTAGE' ? r.branch('CASH_ON_HAND', e.locationId) : r.global('OTHER_INCOME_DISCREPANCY_RECOVERY'), charge)); continue; }
    const cost = D(l.batchCost).mul(l.qty); totalCost = totalCost.plus(cost); totalCharge = totalCharge.plus(charge);
    lines.push(cr(r.branch(inventoryTemplateFor(l.accountingClass), e.locationId), cost));
  }
  for (const a of e.allocations) lines.push(dr(r.branch('ADV_EMPLOYEE_CHARGES', e.locationId), a.amount, `Employee ${a.employeeId}`));
  const diff = totalCharge.minus(totalCost);
  if (diff.gt(0)) lines.push(cr(r.global('OTHER_INCOME_DISCREPANCY_RECOVERY'), diff));
  else if (diff.lt(0)) lines.push(dr(r.global('SPOILAGE'), diff.abs()));
  const entry: Entry = { rule: 'R11', book: 'ADVANCES', lines: consolidate(lines), remarks: `Charge form ${e.controlNo}` };
  assertBalanced(entry.lines); return [entry];
}
export function r11PayrollDeduction(r: AccountResolver, e: { locationId: string; amount: Decimal.Value; ref: string }): Entry[] {
  const entry: Entry = { rule: 'R11', book: 'ADVANCES', lines: [dr(r.global('AP_SALARY'), e.amount), cr(r.branch('ADV_EMPLOYEE_CHARGES', e.locationId), e.amount)], remarks: `Charge deduction ${e.ref}` };
  assertBalanced(entry.lines); return [entry];
}
/** R13 remittance of SSS / PhilHealth / Pag-IBIG contributions (EE deducted + ER share) to the agency. */
export function r13Remittance(r: AccountResolver, e: { kind: 'SSS' | 'PHIC' | 'HDMF'; amount: Decimal.Value; paymentAccountId: string; ref: string }): Entry[] {
  const payable = r.global(e.kind === 'SSS' ? 'SSS_PAYABLE' : e.kind === 'PHIC' ? 'PHIC_PAYABLE' : 'HDMF_PAYABLE');
  const entry: Entry = { rule: 'R13', book: 'GENERAL', lines: [dr(payable, e.amount), cr(e.paymentAccountId, e.amount)], remarks: `${e.kind} remittance ${e.ref}` };
  assertBalanced(entry.lines); return [entry];
}
// ── R12 revaluation (cost increase only) ──
export function r12Revaluation(r: AccountResolver, e: { productAccountingClass: string; costOld: Decimal.Value; costNew: Decimal.Value; onHand: { locationId: string; qty: number }[]; ref: string }): Entry[] {
  const delta = D(e.costNew).minus(e.costOld);
  if (delta.lte(0)) return []; // §18.4 decreases do not revalue
  const lines: Line[] = []; let total = D(0);
  for (const o of e.onHand) { if (o.qty <= 0) continue; const amt = delta.mul(o.qty); total = total.plus(amt); lines.push(dr(r.branch(inventoryTemplateFor(e.productAccountingClass), o.locationId), amt)); }
  if (total.isZero()) return [];
  lines.push(cr(r.global('OTHER_INCOME_PRICE_INCREASE'), total));
  const entry: Entry = { rule: 'R12', book: 'GENERAL', lines: consolidate(lines), remarks: `Revaluation ${e.ref} (non-standard: unrealised gain)` };
  assertBalanced(entry.lines); return [entry];
}
// ── R13 payroll ──
export interface PayrollLineEvent { employeeId: string; costCentreLocationId: string | null; basic: Decimal.Value; overtime: Decimal.Value; incentives: Decimal.Value; thirteenth: Decimal.Value; sssEe: Decimal.Value; sssEr: Decimal.Value; phicEe: Decimal.Value; phicEr: Decimal.Value; hdmfEe: Decimal.Value; hdmfEr: Decimal.Value; sssLoan: Decimal.Value; hdmfLoan: Decimal.Value; advances: Decimal.Value; chargeDeductions: Decimal.Value; netPay: Decimal.Value }
export function r13PayrollFinalize(r: AccountResolver, e: { ref: string; lines: PayrollLineEvent[] }): Entry[] {
  const lines: Line[] = [];
  for (const l of e.lines) {
    const sal = l.costCentreLocationId ? r.branch('SALARIES_STAFF', l.costCentreLocationId) : r.global('SALARIES_OFFICE');
    lines.push(dr(sal, D(l.basic).plus(l.overtime)));
    if (!D(l.incentives).isZero()) lines.push(dr(l.costCentreLocationId ? r.branch('INCENTIVES', l.costCentreLocationId) : r.global('SALARIES_OFFICE'), l.incentives));
    if (!D(l.thirteenth).isZero()) { lines.push(dr(r.global('THIRTEENTH_MONTH'), l.thirteenth)); lines.push(cr(r.global('THIRTEENTH_MONTH_PAYABLE'), l.thirteenth)); } // accrual
    lines.push(dr(r.global('SSS_PHIC_EXPENSE'), D(l.sssEr).plus(l.phicEr)));
    lines.push(dr(r.global('HDMF_EXPENSE'), l.hdmfEr));
    lines.push(cr(r.global('AP_SALARY'), l.netPay));
    lines.push(cr(r.global('SSS_PAYABLE'), D(l.sssEe).plus(l.sssEr)));
    lines.push(cr(r.global('PHIC_PAYABLE'), D(l.phicEe).plus(l.phicEr)));
    lines.push(cr(r.global('HDMF_PAYABLE'), D(l.hdmfEe).plus(l.hdmfEr)));
    lines.push(cr(r.global('SSS_LOAN_PAYABLE'), l.sssLoan));
    lines.push(cr(r.global('HDMF_LOAN_PAYABLE'), l.hdmfLoan));
    lines.push(cr(r.global('ADV_EMPLOYEES'), l.advances));
    if (!D(l.chargeDeductions).isZero()) lines.push(cr(l.costCentreLocationId ? r.branch('ADV_EMPLOYEE_CHARGES', l.costCentreLocationId) : r.global('ADV_EMPLOYEES'), l.chargeDeductions));
  }
  const entry: Entry = { rule: 'R13', book: 'GASTOS_DC', lines: consolidate(lines), remarks: `Payroll ${e.ref}` };
  assertBalanced(entry.lines); return [entry];
}
export function r13PayrollClose(r: AccountResolver, e: { ref: string; netTotal: Decimal.Value; paymentAccountId: string }): Entry[] {
  const entry: Entry = { rule: 'R13', book: 'GENERAL', lines: [dr(r.global('AP_SALARY'), e.netTotal), cr(e.paymentAccountId, e.netTotal)], remarks: `Payroll paid ${e.ref}` };
  assertBalanced(entry.lines); return [entry];
}
// ── R14 depreciation ──
export function r14Depreciation(_r: AccountResolver, e: { assets: { accumDepnAccountId: string; amount: Decimal.Value; name: string }[]; depreciationExpenseAccountId: string; ref: string }): Entry[] {
  const lines: Line[] = [];
  for (const a of e.assets) { lines.push(dr(e.depreciationExpenseAccountId, a.amount, a.name)); lines.push(cr(a.accumDepnAccountId, a.amount, a.name)); }
  if (!lines.length) return [];
  const entry: Entry = { rule: 'R14', book: 'GENERAL', lines: consolidate(lines), remarks: `Depreciation ${e.ref}` };
  assertBalanced(entry.lines); return [entry];
}
/** Net pay = gross − employee deductions. Shared by payroll module and tests. */
export function computeNetPay(l: Omit<PayrollLineEvent, 'netPay' | 'employeeId' | 'costCentreLocationId'>): Decimal {
  const gross = D(l.basic).plus(l.overtime).plus(l.incentives);
  const ded = D(l.sssEe).plus(l.phicEe).plus(l.hdmfEe).plus(l.sssLoan).plus(l.hdmfLoan).plus(l.advances).plus(l.chargeDeductions);
  return round2(gross.minus(ded));
}
