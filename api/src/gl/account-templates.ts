/**
 * §10.2 Branch-templated accounts. One row per "account concept" that exists per branch.
 * titlePattern uses {branch}. channelTag matches the SalesChannel/payment used by posting rules.
 */
export type TemplateRow = { key: string; titlePattern: string; class: 'CASH' | 'AR' | 'INVENTORY' | 'ADVANCES_TO' | 'FIXED_ASSET' | 'ACCUM_DEPN' | 'CURRENT_LIABILITY' | 'ADVANCES_FROM' | 'EQUITY' | 'REVENUE' | 'DIRECT_COST' | 'OPEX' | 'OTHER_INCOME'; channelTag?: string; entryScope?: 'BRANCH' | 'MAIN' | 'BOTH'; appliesTo?: 'BRANCH' | 'FRANCHISE' | 'BOTH' };

export const ACCOUNT_TEMPLATES: TemplateRow[] = [
  { key: 'PETTY_CASH', titlePattern: 'Petty Cash – {branch}', class: 'CASH' },
  { key: 'CASH_ON_HAND', titlePattern: 'Cash on Hand – {branch}', class: 'CASH' },
  { key: 'INV_SUPPLEMENTS', titlePattern: 'Inventory – {branch} Supplements', class: 'INVENTORY' },
  { key: 'INV_FREEBIES', titlePattern: 'Inventory – {branch} Freebies', class: 'INVENTORY' },
  { key: 'INV_PLASTIC', titlePattern: 'Inventory – {branch} Plastic', class: 'INVENTORY' },
  { key: 'INV_CONSIGNMENT', titlePattern: 'Inventory – {branch} Consignment', class: 'INVENTORY' },
  { key: 'INV_EQUIPMENT', titlePattern: 'Inventory – {branch} Equipment', class: 'INVENTORY' },
  { key: 'INV_OTHERS', titlePattern: 'Inventory – {branch} Others', class: 'INVENTORY' },
  { key: 'AR_OTHERS', titlePattern: 'AR – Others ({branch})', class: 'AR' },
  { key: 'AR_AGENT', titlePattern: 'AR – Agent For Selling ({branch})', class: 'AR' },
  { key: 'AR_CREDIT_CARD', titlePattern: 'AR – Credit Card ({branch})', class: 'AR' },
  { key: 'AR_DISCREPANCY', titlePattern: 'AR – Discrepancy ({branch})', class: 'AR' },
  { key: 'ADV_EMPLOYEE_CHARGES', titlePattern: 'Advances to Employees (Charges) – {branch}', class: 'ADVANCES_TO' },
  { key: 'SALES_WALK_IN', titlePattern: 'Sales – {branch} Walk In', class: 'REVENUE', channelTag: 'WALK_IN' },
  { key: 'SALES_DELIVERY', titlePattern: 'Sales – {branch} Delivery', class: 'REVENUE', channelTag: 'DELIVERY' },
  { key: 'SALES_DELIVERY_FEE', titlePattern: 'Sales – {branch} Delivery Fee', class: 'REVENUE', channelTag: 'DELIVERY_FEE' },
  { key: 'SALES_SHIPPING', titlePattern: 'Sales – {branch} Shipping', class: 'REVENUE', channelTag: 'SHIPPING_COURIER' },
  { key: 'SALES_SHIPPING_FEE', titlePattern: 'Sales – {branch} Shipping Fee', class: 'REVENUE', channelTag: 'SHIPPING_FEE' },
  { key: 'SALES_MARKETPLACE', titlePattern: 'Sales – {branch} Shopee/Lazada', class: 'REVENUE', channelTag: 'SHIPPING_MARKETPLACE' },
  { key: 'SALES_FRANCHISE', titlePattern: 'Sales – {branch} Franchise', class: 'REVENUE', channelTag: 'FRANCHISE' },
  { key: 'SALES_DEALER', titlePattern: 'Sales – {branch} Dealers', class: 'REVENUE', channelTag: 'DEALER' },
  { key: 'SALES_AGENT', titlePattern: 'Sales – {branch} Agent', class: 'REVENUE', channelTag: 'AGENT' },
  { key: 'SALES_PERSONAL', titlePattern: 'Sales – {branch} Personal', class: 'REVENUE', channelTag: 'PERSONAL' },
  { key: 'SALES_OTHER', titlePattern: 'Sales – {branch} Others', class: 'REVENUE', channelTag: 'OTHER' },
  { key: 'SALES_CREDIT_CARD_WALK_IN', titlePattern: 'Sales – {branch} Credit Card Walk In', class: 'REVENUE', channelTag: 'CREDIT_CARD_WALK_IN' },
  { key: 'SALES_CONSIGNMENT', titlePattern: 'Sales – {branch} (Consignment)', class: 'REVENUE', channelTag: 'CONSIGNMENT' },
  { key: 'SALES_DISCOUNT', titlePattern: 'Sales – {branch} Discount', class: 'REVENUE', channelTag: 'DISCOUNT' },
  { key: 'SALES_RETURNS', titlePattern: 'Sales – {branch} Returns', class: 'REVENUE', channelTag: 'RETURNS' },
  { key: 'DC_SUPPLEMENTS', titlePattern: 'Direct Cost – Supplements ({branch})', class: 'DIRECT_COST' },
  { key: 'DC_FREEBIES', titlePattern: 'Direct Cost – Freebies ({branch})', class: 'DIRECT_COST' },
  { key: 'DC_PLASTIC', titlePattern: 'Direct Cost – Plastic ({branch})', class: 'DIRECT_COST' },
  { key: 'DC_EQUIPMENT', titlePattern: 'Direct Cost – Equipment ({branch})', class: 'DIRECT_COST' },
  { key: 'DC_OTHERS', titlePattern: 'Direct Cost – Others ({branch})', class: 'DIRECT_COST' },
  { key: 'DC_SUPPLEMENTS_CONSIGNMENT', titlePattern: 'Direct Cost – Supplements Consignment ({branch})', class: 'DIRECT_COST' },
  { key: 'SALARIES_STAFF', titlePattern: 'Salaries – Staff ({branch})', class: 'DIRECT_COST' },
  { key: 'INCENTIVES', titlePattern: 'Incentives – {branch}', class: 'DIRECT_COST' },
  { key: 'EXPIRED_ITEMS', titlePattern: 'Expired Items – {branch}', class: 'DIRECT_COST' },
  { key: 'TASTING_PRODUCTS', titlePattern: 'Supplement Tasting Products – {branch}', class: 'DIRECT_COST' },
  { key: 'TASTING_OTHER', titlePattern: 'Supplement Tasting Other – {branch}', class: 'DIRECT_COST' },
  { key: 'RENT', titlePattern: 'Rent – {branch}', class: 'OPEX' },
  { key: 'MERALCO', titlePattern: 'Meralco – {branch}', class: 'OPEX' },
  { key: 'WATER', titlePattern: 'Water – {branch}', class: 'OPEX' },
  { key: 'INTERNET', titlePattern: 'Globe/PLDT – {branch}', class: 'OPEX' },
  { key: 'RIDER_INCENTIVE', titlePattern: 'Rider/Driver Incentive – {branch}', class: 'OPEX' },
  { key: 'RIDER_TOLL', titlePattern: 'Rider/Driver Toll – {branch}', class: 'OPEX' },
  { key: 'RIDER_GAS', titlePattern: 'Rider/Driver Expense (Gas) – {branch}', class: 'OPEX' },
  { key: 'RIDER_OTHER', titlePattern: 'Rider/Driver Other – {branch}', class: 'OPEX' },
  { key: 'SHIPPING_EXPENSE_ORDERS', titlePattern: 'Shipping Expense Orders – {branch}', class: 'OPEX' },
  { key: 'SHIPPING_EXPENSE_MARKETING', titlePattern: 'Shipping Expense Marketing – {branch}', class: 'OPEX' },
  { key: 'PLASTIC_ECOBAG', titlePattern: 'Plastic/Ecobag – {branch}', class: 'OPEX' },
  { key: 'PRINTING', titlePattern: 'Printing – {branch}', class: 'OPEX' },
  { key: 'STORE_REPAIRS', titlePattern: 'Store Repairs – {branch}', class: 'OPEX' },
  { key: 'OTHER_EXPENSES', titlePattern: 'Other Expenses – {branch}', class: 'OPEX' },
  { key: 'REGISTRATION_PERMITS', titlePattern: 'Registration & Permits – {branch}', class: 'OPEX' },
  { key: 'MISCELLANEOUS', titlePattern: 'Miscellaneous – {branch}', class: 'OPEX' },
  { key: 'LOAD', titlePattern: 'Load – {branch}', class: 'OPEX' },
  // Franchise-only (§10.2)
  { key: 'AR_FRANCHISE', titlePattern: 'AR – Franchise {branch}', class: 'AR', appliesTo: 'FRANCHISE' },
  { key: 'AR_FRANCHISE_STORE', titlePattern: 'AR – Franchise {branch} (Store)', class: 'AR', appliesTo: 'FRANCHISE' },
];

/** Company-wide (untagged) accounts that posting rules need to exist. Created by the COA import/seed if missing. */
export const GLOBAL_ACCOUNTS: { key: string; code: string; title: string; class: TemplateRow['class']; paymentAccountType?: 'CASH_DRAWER' | 'PETTY_CASH' | 'BANK' | 'GCASH' | 'PLATFORM' | 'CREDIT_CARD_SETTLEMENT' }[] = [
  { key: 'AP_SUPPLIERS', code: '2100', title: 'Accounts Payable – Suppliers', class: 'CURRENT_LIABILITY' },
  { key: 'AP_CONSIGNMENT', code: '2110', title: 'Accounts Payable – Consignment', class: 'CURRENT_LIABILITY' },
  { key: 'AP_SALARY', code: '2200', title: 'Accounts Payable – Salary (Employees)', class: 'CURRENT_LIABILITY' },
  { key: 'SSS_PAYABLE', code: '2210', title: 'SSS Premium Payable', class: 'CURRENT_LIABILITY' },
  { key: 'PHIC_PAYABLE', code: '2211', title: 'Philhealth Premium Payable', class: 'CURRENT_LIABILITY' },
  { key: 'HDMF_PAYABLE', code: '2212', title: 'HDMF Premium Payable', class: 'CURRENT_LIABILITY' },
  { key: 'SSS_LOAN_PAYABLE', code: '2220', title: 'SSS Loan Payable', class: 'CURRENT_LIABILITY' },
  { key: 'HDMF_LOAN_PAYABLE', code: '2221', title: 'HDMF Loan Payable', class: 'CURRENT_LIABILITY' },
  { key: 'OUTPUT_TAX', code: '2300', title: 'Output Tax', class: 'CURRENT_LIABILITY' },
  { key: 'ADV_EMPLOYEES', code: '1500', title: 'Advances to Employees', class: 'ADVANCES_TO' },
  { key: 'SALES_WAREHOUSE_FRANCHISE', code: '6900', title: 'Sales – Warehouse Franchise', class: 'REVENUE' },
  { key: 'OTHER_INCOME_SUPPLIER_FREEBIES', code: '9100', title: 'Other Income – Supplier Freebies', class: 'OTHER_INCOME' },
  { key: 'OTHER_INCOME_PRICE_INCREASE', code: '9110', title: 'Other Income – Price Increase', class: 'OTHER_INCOME' },
  { key: 'OTHER_INCOME_DISCREPANCY_RECOVERY', code: '9120', title: 'Other Income – Discrepancy Recovery', class: 'OTHER_INCOME' },
  { key: 'SPOILAGE', code: '7900', title: 'Spoilage, Damage, Expired & Others', class: 'DIRECT_COST' },
  { key: 'SALARIES_OFFICE', code: '7100', title: 'Salaries and Wages – Office', class: 'DIRECT_COST' },
  { key: 'THIRTEENTH_MONTH', code: '7110', title: '13th Month Pay', class: 'DIRECT_COST' },
  { key: 'SSS_PHIC_EXPENSE', code: '7120', title: 'SSS/Philhealth Expense (Employer)', class: 'DIRECT_COST' },
  { key: 'HDMF_EXPENSE', code: '7121', title: 'HDMF Expense (Employer)', class: 'DIRECT_COST' },
  { key: 'MDR_CREDIT_CARD', code: '8300', title: 'MDR – Credit Card', class: 'OPEX' },
  { key: 'DEPRECIATION_EXPENSE', code: '8400', title: 'Depreciation Expense', class: 'OPEX' },
  { key: 'CAPITAL', code: '3000', title: 'Capital', class: 'EQUITY' },
  { key: 'RETAINED_EARNINGS', code: '3100', title: 'Retained Earnings', class: 'EQUITY' },
  { key: 'CASH_IN_BANK_MAIN', code: '1010', title: 'Cash in Bank – Main', class: 'CASH', paymentAccountType: 'BANK' },
  { key: 'GCASH_MAIN', code: '1020', title: 'GCash – Main', class: 'CASH', paymentAccountType: 'GCASH' },
  { key: 'SHOPEE_CASH', code: '1030', title: 'Shopee Platform Cash', class: 'CASH', paymentAccountType: 'PLATFORM' },
  { key: 'LAZADA_CASH', code: '1031', title: 'Lazada Platform Cash', class: 'CASH', paymentAccountType: 'PLATFORM' },
  { key: 'TIKTOK_CASH', code: '1032', title: 'TikTok Platform Cash', class: 'CASH', paymentAccountType: 'PLATFORM' },
];

export const NORMAL_BALANCE: Record<TemplateRow['class'], 'DEBIT' | 'CREDIT'> = {
  CASH: 'DEBIT', AR: 'DEBIT', INVENTORY: 'DEBIT', ADVANCES_TO: 'DEBIT', FIXED_ASSET: 'DEBIT', ACCUM_DEPN: 'CREDIT',
  CURRENT_LIABILITY: 'CREDIT', ADVANCES_FROM: 'CREDIT', EQUITY: 'CREDIT', REVENUE: 'CREDIT', DIRECT_COST: 'DEBIT', OPEX: 'DEBIT', OTHER_INCOME: 'CREDIT',
};

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
  switch (channel) {
    case 'WALK_IN': return 'SALES_WALK_IN'; case 'DELIVERY': return 'SALES_DELIVERY'; case 'SHIPPING_COURIER': return 'SALES_SHIPPING'; case 'SHIPPING_MARKETPLACE': return 'SALES_MARKETPLACE';
    case 'FRANCHISE': return 'SALES_FRANCHISE'; case 'DEALER': return 'SALES_DEALER'; case 'AGENT': return 'SALES_AGENT'; case 'PERSONAL': return 'SALES_PERSONAL'; default: return 'SALES_OTHER';
  }
}
