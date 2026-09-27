/**
 * One name and one purpose line per screen (owner request 2026-09-27): the menu shows `label`, and the top of the page shows
 * `summary` so everyone knows what the screen is for before using it.
 */
export interface PageInfo { label: string; summary: string }

export const PAGES: Record<string, PageInfo> = {
  '/': { label: 'Dashboard', summary: 'Your day at a glance: what needs your action, reminders, alerts and the status of your requests.' },
  '/approvals': { label: 'Approvals Waiting for Me', summary: 'Documents other people sent for your approval. Open one to see the details, then approve or reject it.' },
  '/notifications': { label: 'Notifications', summary: 'Every message the system sent you, newest first. Click one to open the document it is about.' },
  '/sales/new': { label: 'New Sale (Record a Sale)', summary: 'Record a sale from the paper DR/SI: channel, payment, items and, if allowed, an incentive paid from the sale. Stock is deducted at once.' },
  '/sales': { label: 'Sales List & Search', summary: 'All recorded sales for the chosen dates and branch. Open a sale to print the DR, void it or request a correction.' },
  '/ar': { label: 'Customer Credit (AR / PDC & Collections)', summary: 'Sales on credit or post-dated cheque, what each customer still owes, overdue accounts, and payments received.' },
  '/expenses': { label: 'Branch Expenses', summary: 'Record expenses paid by the branch (from the cash drawer or the cash fund) with their receipts.' },
  '/closing': { label: 'Daily Close, Cash Count & Bank Deposit', summary: "End of day: the day's cash summary, the money count, the bank deposit of the day's cash and post-close correction requests." },
  '/cash-on-hand': { label: 'Cash on Hand (Undeposited Sales)', summary: 'Cash from sales that is not yet in the bank, the deadline for each day, and requests for more days to deposit.' },
  '/cash-fund': { label: 'Branch Cash Fund (Petty Cash)', summary: 'The branch cash fund: what was spent from it, topping it up from cash sales, and store checks by the Field Auditor.' },
  '/inspections': { label: 'Store Inspection Reports', summary: 'Field Auditor checklists of each store visit (permits, cash, stock, cleanliness), sent to HR for review.' },
  '/bank': { label: 'Main Bank & Office Entries', summary: 'Main office bank transactions and their accounting book, supplier payables, office expenses and balance-sheet account balances.' },
  '/my-hr': { label: 'My Pay & Charges', summary: 'Your own payslips, charges and advances only. Acknowledge new charges here.' },
  '/stock': { label: 'Stock on Hand (Current Inventory)', summary: 'What is in stock right now per location, batch and expiry date.' },
  '/receiving': { label: 'Supplier Deliveries (Receiving)', summary: "Record goods delivered by suppliers (quantity, freebies, expiry, batch). The Head Auditor approves the cost; goods entered by a Warehouse Associate also need the In-Charge's approval before stock is added." },
  '/transfers': { label: 'Stock Transfers & Pull-outs', summary: 'Move stock between the warehouse, branches and franchises: prepare the pull-out, get it approved, and the receiver confirms what arrived.' },
  '/counts': { label: 'Inventory Count Sheets', summary: 'Count sheets listing every item (items in the system first). Type the actual count; differences open a discrepancy case.' },
  '/discrepancies': { label: 'Count Discrepancies & Explanations', summary: 'Differences found in counts, the explanation deadline, explanations sent, and final reports with charge forms.' },
  '/expiry': { label: 'Expiry, Low Stock & Alerts', summary: 'Items near expiry or below minimum stock, with suggested restocking from the warehouse.' },
  '/writeoffs': { label: 'Write-offs (Expired / Damaged)', summary: 'Remove expired, damaged or spoiled items from stock with the Head Auditor’s approval, and charge staff when needed.' },
  '/consignment': { label: 'Consignment (In & Out)', summary: 'Send goods to a consignee, record what they sold (prices filled in from the agreement, editable) and take goods back. Print the draft, then submit: your manager checks it and the Owner approves last.' },
  '/consignees': { label: 'Consignees (Consignment Accounts)', summary: 'Consignee accounts: the Owner creates each consignee once (stock location, customer, receivable account and agreement).' },
  '/products': { label: 'Products & Prices', summary: 'Every product with its SKU, category and selling prices per channel. New products wait for the Owner’s approval.' },
  '/price-changes': { label: 'Price Change Requests', summary: 'Prepare new prices with an effective date; they apply after the Owner approves and the people concerned are notified.' },
  '/suppliers': { label: 'Suppliers', summary: 'Supplier list (codes for warehouse staff; names for the Owner and auditors). New suppliers wait for the Owner’s approval.' },
  '/imports': { label: 'Excel Imports & Templates', summary: 'Load products, prices, minimum stock, opening balances and other lists from Excel templates.' },
  '/reports/daily-sales': { label: 'Daily Branch Sales Report', summary: 'The day’s sales report in the company format. Branch staff review it and submit it as true and correct before 8 PM.' },
  '/reports/inventory': { label: 'Inventory Reports & Movement', summary: 'Daily inventory report (items with movement first), monthly movement sheet and the stock ledger, with item search.' },
  '/reports/customers': { label: 'Customer Contact List & Follow-ups', summary: 'Customers with their contact details and the items they ordered, and re-order follow-ups: customers who may have finished their supplements, to call, text or email.' },
  '/franchise': { label: 'Franchise Portal (Your Branch)', summary: 'Your franchise only: stock, deliveries, staff pay and charges, and your own income statement and balance sheet.' },
  '/accounting/accounts': { label: 'Chart of Accounts', summary: 'Every account in the books. New accounts wait for the Owner’s approval.' },
  '/accounting/vouchers': { label: 'Journal Vouchers (Accounting Entries)', summary: 'Every accounting entry with a link to its source document. Accounting can correct entries; the people involved are notified.' },
  '/accounting/trial-balance': { label: 'Trial Balance', summary: 'Balances of every account for the period; debits must equal credits.' },
  '/accounting/statements': { label: 'Financial Statements', summary: 'Income statement, balance sheet, net income per branch and cash flow.' },
  '/accounting/periods': { label: 'Periods & Opening Balances', summary: 'Beginning balances and locking of finished months.' },
  '/accounting/inventory-cost': { label: 'Inventory & Direct Cost', summary: 'Inventory cost movements and direct cost of sales per branch, per day or month.' },
  '/charge-forms': { label: 'Charge Forms (Staff Charges)', summary: 'Charges to staff for shortages, discrepancies, damaged or expired items: split them, set pay periods and finalize for payroll.' },
  '/payroll': { label: 'Payroll & Government Contributions', summary: 'Employees, payroll runs, payslips, and SSS / PhilHealth / Pag-IBIG contributions and remittances.' },
  '/hr/weekly-counts': { label: 'Weekly Count Compliance', summary: 'Which sales associates submitted their weekly count sheet, week by week.' },
  '/revisions': { label: 'Revision Log (Errors per Staff)', summary: 'Every approved correction of a document, who made the original, and the number of errors per staff member.' },
  '/hr-notices': { label: 'HR Notices (Notice to Explain)', summary: 'Situations HR must act on, such as cash not deposited on time: issue the Notice to Explain and record the outcome.' },
  '/help': { label: 'Help & User Guide', summary: 'The step-by-step guide for your role, the guide for everyone, and an Ask box for questions.' },
  '/users': { label: 'Users & Roles', summary: 'Create accounts (one per person), change roles and branches, and tick extra permissions.' },
  '/audit-log': { label: 'Audit Log (Who Did What)', summary: 'Every action in the system with the person, time and details.' },
  '/settings': { label: 'Settings & Company Letterhead', summary: 'Thresholds and switches for the whole system, and the company letterhead and logo printed on every form.' },
};

/** The page info for an exact list-page path (detail pages such as /sales/123 show none). */
export const pageInfo = (pathname: string): PageInfo | undefined => PAGES[pathname.replace(/\/+$/, '') || '/'];
