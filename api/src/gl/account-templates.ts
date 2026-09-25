/**
 * §10.2 Branch-templated accounts. One row per "account concept" that exists per branch.
 * titlePattern uses the exact wording of `ACCTG PROGRAM - FORMAT.xlsm` so imported accounts match templates
 * and accounts generated for a new branch look identical to the existing ones. channelTag matches the SalesChannel used by posting rules.
 */
export type TemplateRow = { key: string; titlePattern: string; class: 'CASH' | 'AR' | 'INVENTORY' | 'ADVANCES_TO' | 'FIXED_ASSET' | 'ACCUM_DEPN' | 'CURRENT_LIABILITY' | 'ADVANCES_FROM' | 'EQUITY' | 'REVENUE' | 'DIRECT_COST' | 'OPEX' | 'OTHER_INCOME'; channelTag?: string; entryScope?: 'BRANCH' | 'MAIN' | 'BOTH'; appliesTo?: 'BRANCH' | 'FRANCHISE' | 'BOTH' };

export const ACCOUNT_TEMPLATES: TemplateRow[] = [
  { key: 'PETTY_CASH', titlePattern: 'Petty Cash - {branch}', class: 'CASH' },
  { key: 'CASH_ON_HAND', titlePattern: 'Cash on Hand- {branch}', class: 'CASH' },
  { key: 'INV_SUPPLEMENTS', titlePattern: 'Inventory - {branch} Supplements', class: 'INVENTORY' },
  { key: 'INV_FREEBIES', titlePattern: 'Inventory - {branch} Freebies', class: 'INVENTORY' },
  { key: 'INV_PLASTIC', titlePattern: 'Inventory - {branch} Plastic/Ecobag', class: 'INVENTORY' },
  { key: 'INV_CONSIGNMENT', titlePattern: 'Inventory - {branch} Consignment', class: 'INVENTORY' },
  { key: 'INV_EQUIPMENT', titlePattern: 'Inventory - {branch} Equipment', class: 'INVENTORY' },
  { key: 'INV_OTHERS', titlePattern: 'Inventory - {branch} Others', class: 'INVENTORY' },
  { key: 'AR_OTHERS', titlePattern: 'AR - Others ({branch})', class: 'AR' },
  { key: 'AR_AGENT', titlePattern: 'AR - Agent For Selling ({branch})', class: 'AR' },
  { key: 'AR_CREDIT_CARD', titlePattern: 'AR - Credit Card ({branch})', class: 'AR' },
  { key: 'AR_DISCREPANCY', titlePattern: 'AR - Discrepancy ({branch})', class: 'AR' },
  { key: 'ADV_EMPLOYEE_CHARGES', titlePattern: 'Advances to Employees (Charges)- {branch}', class: 'ADVANCES_TO' },
  { key: 'SALES_WALK_IN', titlePattern: 'Sales - {branch} Walk In', class: 'REVENUE', channelTag: 'WALK_IN' },
  { key: 'SALES_DELIVERY', titlePattern: 'Sales - {branch} Delivery', class: 'REVENUE', channelTag: 'DELIVERY' },
  { key: 'SALES_DELIVERY_FEE', titlePattern: 'Sales - {branch} Delivery Fee', class: 'REVENUE', channelTag: 'DELIVERY_FEE' },
  { key: 'SALES_SHIPPING', titlePattern: 'Sales - {branch} Shipping', class: 'REVENUE', channelTag: 'SHIPPING_COURIER' },
  { key: 'SALES_SHIPPING_FEE', titlePattern: 'Sales - {branch} Shipping Fee', class: 'REVENUE', channelTag: 'SHIPPING_FEE' },
  { key: 'SALES_MARKETPLACE', titlePattern: 'Sales - {branch} Shopee', class: 'REVENUE', channelTag: 'SHIPPING_MARKETPLACE' },
  { key: 'SALES_LAZADA', titlePattern: 'Sales - {branch} Lazada', class: 'REVENUE', channelTag: 'LAZADA' },
  { key: 'SALES_TIKTOK', titlePattern: 'Sales - {branch} Tiktok', class: 'REVENUE', channelTag: 'TIKTOK' },
  { key: 'SALES_FRANCHISE', titlePattern: 'Sales - {branch} Franchise', class: 'REVENUE', channelTag: 'FRANCHISE' },
  { key: 'SALES_DEALER', titlePattern: 'Sales - {branch} Dealers', class: 'REVENUE', channelTag: 'DEALER' },
  { key: 'SALES_AGENT', titlePattern: 'Sales - {branch} Agent', class: 'REVENUE', channelTag: 'AGENT' },
  { key: 'SALES_PERSONAL', titlePattern: 'Sales - {branch} Personal', class: 'REVENUE', channelTag: 'PERSONAL' },
  { key: 'SALES_OTHER', titlePattern: 'Sales - {branch} Others', class: 'REVENUE', channelTag: 'OTHER' },
  { key: 'SALES_CREDIT_CARD_WALK_IN', titlePattern: 'Sales - {branch} Credit Card Walk In', class: 'REVENUE', channelTag: 'CREDIT_CARD_WALK_IN' },
  { key: 'SALES_CONSIGNMENT', titlePattern: 'Sales - {branch} (Consignment)', class: 'REVENUE', channelTag: 'CONSIGNMENT' },
  { key: 'SALES_DISCOUNT', titlePattern: 'Sales - {branch} Discount', class: 'REVENUE', channelTag: 'DISCOUNT' },
  { key: 'DC_SUPPLEMENTS', titlePattern: 'Direct Cost - Supplements ({branch})', class: 'DIRECT_COST' },
  { key: 'DC_FREEBIES', titlePattern: 'Direct Cost - Freebies ({branch})', class: 'DIRECT_COST' },
  { key: 'DC_PLASTIC', titlePattern: 'Direct Cost - Plastic/Ecobag ({branch})', class: 'DIRECT_COST' },
  { key: 'DC_EQUIPMENT', titlePattern: 'Direct Cost - Equipment ({branch})', class: 'DIRECT_COST' },
  { key: 'DC_OTHERS', titlePattern: 'Direct Cost - {branch} (Others)', class: 'DIRECT_COST' },
  { key: 'DC_SUPPLEMENTS_CONSIGNMENT', titlePattern: 'Direct Cost -Supplements Consignment Herbs ({branch})', class: 'DIRECT_COST' },
  { key: 'SALARIES_STAFF', titlePattern: 'Salaries and Wages- {branch} (Staff)', class: 'DIRECT_COST' },
  { key: 'INCENTIVES', titlePattern: 'Incentives - {branch}', class: 'DIRECT_COST' },
  { key: 'EXPIRED_ITEMS', titlePattern: 'Expired Items - {branch}', class: 'DIRECT_COST' },
  { key: 'TASTING_PRODUCTS', titlePattern: 'Supplement Tasting Products - {branch}', class: 'OPEX' },
  { key: 'TASTING_OTHER', titlePattern: 'Supplement Tasting Other Expenses - {branch}', class: 'OPEX' },
  { key: 'RENT', titlePattern: 'Rent - {branch}', class: 'OPEX' },
  { key: 'MERALCO', titlePattern: 'Meralco - {branch}', class: 'OPEX' },
  { key: 'WATER', titlePattern: 'Water - {branch}', class: 'OPEX' },
  { key: 'INTERNET', titlePattern: 'Globe/PLDT (Internet) - {branch}', class: 'OPEX' },
  { key: 'RIDER_INCENTIVE', titlePattern: 'Rider/Driver Incentive - {branch}', class: 'OPEX' },
  { key: 'RIDER_TOLL', titlePattern: 'Rider/Driver Expense (Toll) Parking) - {branch}', class: 'OPEX' },
  { key: 'RIDER_GAS', titlePattern: 'Rider/Driver Expense (Gas) - {branch}', class: 'OPEX' },
  { key: 'RIDER_OTHER', titlePattern: 'Rider/Driver Expense (Other Expense) - {branch}', class: 'OPEX' },
  { key: 'SHIPPING_EXPENSE_ORDERS', titlePattern: 'Shipping Expense For Orders- {branch}', class: 'OPEX' },
  { key: 'SHIPPING_EXPENSE_MARKETING', titlePattern: 'Shipping Expense For Marketing- {branch}', class: 'OPEX' },
  { key: 'PLASTIC_ECOBAG', titlePattern: 'Plastic/Ecobag - {branch}', class: 'OPEX' },
  { key: 'PRINTING', titlePattern: 'Printing (DTF , Plastic, Maintenance Equipment, etc)- {branch}', class: 'OPEX' },
  { key: 'STORE_REPAIRS', titlePattern: 'Store Repairs (Printer, Cartridge, Cleaning of Aircon Etc) - {branch}', class: 'OPEX' },
  { key: 'OTHER_EXPENSES', titlePattern: 'Other Expenses (Office Supplies, Drinking Water, etc)- {branch}', class: 'OPEX' },
  { key: 'REGISTRATION_PERMITS', titlePattern: 'Registration & Permits- {branch}', class: 'OPEX' },
  { key: 'MISCELLANEOUS', titlePattern: 'Miscellaneous Expense - {branch}', class: 'OPEX' },
  // Franchise-only (§10.2)
  { key: 'AR_FRANCHISE', titlePattern: 'AR - Franchise {branch}', class: 'AR', appliesTo: 'FRANCHISE' },
  { key: 'AR_FRANCHISE_STORE', titlePattern: 'AR - Franchise {branch} (Store)', class: 'AR', appliesTo: 'FRANCHISE' },
];

/**
 * Company-wide (untagged) accounts that posting rules need. Titles/codes follow the workbook where the account exists
 * there; `code` is omitted where the workbook has no code (a code is generated in the class range). Two keys may share
 * one account (SSS/PHIC and HDMF employer expense are one line in the workbook).
 */
export const GLOBAL_ACCOUNTS: { key: string; code?: string; title: string; class: TemplateRow['class']; paymentAccountType?: 'CASH_DRAWER' | 'PETTY_CASH' | 'BANK' | 'GCASH' | 'PLATFORM' | 'CREDIT_CARD_SETTLEMENT' }[] = [
  { key: 'AP_SUPPLIERS', code: '4017', title: 'Accounts Payable - Others', class: 'CURRENT_LIABILITY' },
  { key: 'AP_CONSIGNMENT', code: '4001', title: 'Accounts Payable - Consignment Herbs', class: 'CURRENT_LIABILITY' },
  { key: 'AP_SALARY', code: '4025', title: 'Accounts Payable - Salary (Employees)', class: 'CURRENT_LIABILITY' },
  { key: 'SSS_PAYABLE', code: '4046', title: 'SSS Premium Payable', class: 'CURRENT_LIABILITY' },
  { key: 'PHIC_PAYABLE', code: '4047', title: 'PHIC Premium Payable', class: 'CURRENT_LIABILITY' },
  { key: 'HDMF_PAYABLE', code: '4048', title: 'HDMF Premium Payable', class: 'CURRENT_LIABILITY' },
  { key: 'SSS_LOAN_PAYABLE', code: '4049', title: 'SSS Loan Payable', class: 'CURRENT_LIABILITY' },
  { key: 'HDMF_LOAN_PAYABLE', code: '4049B', title: 'HDMF Loan Payable', class: 'CURRENT_LIABILITY' },
  { key: 'THIRTEENTH_MONTH_PAYABLE', title: '13th Month Pay Payable', class: 'CURRENT_LIABILITY' },
  { key: 'OUTPUT_TAX', code: '4030', title: 'Output Tax', class: 'CURRENT_LIABILITY' },
  { key: 'ADV_EMPLOYEES', code: '2550', title: 'Advances to Employees (Loans)', class: 'ADVANCES_TO' },
  { key: 'SALES_WAREHOUSE_FRANCHISE', code: '6000', title: 'Sales - Warehouse Franchise', class: 'REVENUE' },
  { key: 'SALES_RETURNS', title: 'Sales - Returns', class: 'REVENUE' },
  { key: 'OTHER_INCOME_SUPPLIER_FREEBIES', title: 'Other Income - Supplier Freebies', class: 'OTHER_INCOME' },
  { key: 'OTHER_INCOME_PRICE_INCREASE', title: 'Other Income - Price Increase', class: 'OTHER_INCOME' },
  { key: 'OTHER_INCOME_DISCREPANCY_RECOVERY', title: 'Other Income - Discrepancy Recovery', class: 'OTHER_INCOME' },
  { key: 'SPOILAGE', title: 'Spoilage, Damage, Expired & Others', class: 'OPEX' },
  { key: 'SALARIES_OFFICE', title: 'Salaries and Wages - Office', class: 'DIRECT_COST' },
  { key: 'THIRTEENTH_MONTH', title: '13th Month', class: 'DIRECT_COST' },
  { key: 'SSS_PHIC_EXPENSE', title: 'SSS/Philhealth and HDMF Expense', class: 'DIRECT_COST' },
  { key: 'HDMF_EXPENSE', title: 'SSS/Philhealth and HDMF Expense', class: 'DIRECT_COST' },
  { key: 'MDR_CREDIT_CARD', title: 'MDR - Credit Card (3.5%)', class: 'OPEX' },
  { key: 'DEPRECIATION_EXPENSE', title: 'Depreciation Expense', class: 'OPEX' },
  { key: 'CAPITAL', code: '5000', title: 'Capital - GWS & PROTHIN', class: 'EQUITY' },
  { key: 'RETAINED_EARNINGS', code: '5005', title: 'Retained Earnings', class: 'EQUITY' },
  { key: 'CASH_IN_BANK_MAIN', code: '1055', title: 'Cash in Bank - GWS 49', class: 'CASH', paymentAccountType: 'BANK' },
  { key: 'GCASH_MAIN', code: '1105', title: 'Gcash (GWS)', class: 'CASH', paymentAccountType: 'GCASH' },
  { key: 'SHOPEE_CASH', code: '1080', title: 'Cash - Shopee GWS 1 (Platform)', class: 'CASH', paymentAccountType: 'PLATFORM' },
  { key: 'LAZADA_CASH', code: '1085', title: 'Cash - Lazada GWS (Platform)', class: 'CASH', paymentAccountType: 'PLATFORM' },
  { key: 'TIKTOK_CASH', code: '1091', title: 'Cash - Tiktok - Getwheysted (Platform)', class: 'CASH', paymentAccountType: 'PLATFORM' },
];

export const NORMAL_BALANCE: Record<TemplateRow['class'], 'DEBIT' | 'CREDIT'> = {
  CASH: 'DEBIT', AR: 'DEBIT', INVENTORY: 'DEBIT', ADVANCES_TO: 'DEBIT', FIXED_ASSET: 'DEBIT', ACCUM_DEPN: 'CREDIT',
  CURRENT_LIABILITY: 'CREDIT', ADVANCES_FROM: 'CREDIT', EQUITY: 'CREDIT', REVENUE: 'CREDIT', DIRECT_COST: 'DEBIT', OPEX: 'DEBIT', OTHER_INCOME: 'CREDIT',
};

/** Code ranges as used by the workbook: 1xxx cash+AR, 2xxx inventory/advances-to, 3xxx fixed assets, 4xxx liabilities/advances-from, 5xxx equity, 6xxx revenue, 7xxx direct cost, 8xxx opex. */
export const CODE_RANGES: Record<TemplateRow['class'], [number, number]> = {
  CASH: [1000, 1499], AR: [1500, 1999], INVENTORY: [2000, 2499], ADVANCES_TO: [2500, 2999], FIXED_ASSET: [3000, 3499], ACCUM_DEPN: [3500, 3999],
  CURRENT_LIABILITY: [4000, 4499], ADVANCES_FROM: [4500, 4999], EQUITY: [5000, 5999], REVENUE: [6000, 6899], OTHER_INCOME: [6900, 6999], DIRECT_COST: [7000, 7999], OPEX: [8000, 8999],
};
/** Next free code in the class range given the codes already in use (numeric part only; letter-suffixed codes count as their number). */
export function nextCodeInRange(cls: TemplateRow['class'], existing: Iterable<string>): string {
  const [lo, hi] = CODE_RANGES[cls];
  const used = new Set<number>();
  for (const c of existing) { const n = parseInt(String(c).replace(/[^0-9]/g, ''), 10); if (Number.isFinite(n)) used.add(n); }
  let max = lo - 1;
  for (const n of used) if (n >= lo && n <= hi && n > max) max = n;
  let next = max + 1;
  while (used.has(next)) next++;
  if (next > hi) { next = lo; while (used.has(next)) next++; }
  return String(next);
}

/** Map product accounting class → inventory / direct-cost template keys (§10.4). */
export function inventoryTemplateFor(cls: string): string {
  switch (cls) { case 'FREEBIE': return 'INV_FREEBIES'; case 'PLASTIC': return 'INV_PLASTIC'; case 'EQUIPMENT': case 'APPAREL': return 'INV_EQUIPMENT'; case 'OTHER': return 'INV_OTHERS'; default: return 'INV_SUPPLEMENTS'; }
}
export function directCostTemplateFor(cls: string): string {
  switch (cls) { case 'FREEBIE': return 'DC_FREEBIES'; case 'PLASTIC': return 'DC_PLASTIC'; case 'EQUIPMENT': case 'APPAREL': return 'DC_EQUIPMENT'; case 'OTHER': return 'DC_OTHERS'; default: return 'DC_SUPPLEMENTS'; }
}
export function salesTemplateFor(channel: string, channelSub?: string | null, paymentMode?: string): string {
  if (channelSub === 'CONSIGNMENT') return 'SALES_CONSIGNMENT';
  if (channel === 'WALK_IN' && paymentMode === 'CREDIT_CARD') return 'SALES_CREDIT_CARD_WALK_IN';
  if (channel === 'SHIPPING_MARKETPLACE') return channelSub === 'LAZADA' ? 'SALES_LAZADA' : channelSub === 'TIKTOK' ? 'SALES_TIKTOK' : 'SALES_MARKETPLACE';
  switch (channel) {
    case 'WALK_IN': return 'SALES_WALK_IN'; case 'DELIVERY': return 'SALES_DELIVERY'; case 'SHIPPING_COURIER': return 'SALES_SHIPPING';
    case 'FRANCHISE': return 'SALES_FRANCHISE'; case 'DEALER': return 'SALES_DEALER'; case 'AGENT': return 'SALES_AGENT'; case 'PERSONAL': return 'SALES_PERSONAL'; default: return 'SALES_OTHER';
  }
}
