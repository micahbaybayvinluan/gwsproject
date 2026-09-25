/**
 * Store Inspection Report checklist — the owner's paper form (GET WHEYSTED "Please check the boxes below"), item for item.
 * Each item is answered COMPLIED / NO / NA; some carry a date, an amount or a reason, as on the paper.
 */
export type ItemExtra = 'date' | 'amount' | 'reason';
export interface ChecklistItem { key: string; no: string; label: string; section: 'STORE' | 'STOCKS' | 'STAFF'; group?: string; extras?: ItemExtra[]; extraLabel?: string }
export const CHECKLIST: ChecklistItem[] = [
  { key: 'store_cleanliness', no: '1', label: 'Cleanliness of store', section: 'STORE' },
  { key: 'display_arrangement', no: '2', label: 'Stocks display arrangement', section: 'STORE' },
  { key: 'permit_business', no: '3', group: 'Permits displayed', label: 'Business Permit', section: 'STORE' },
  { key: 'permit_fda', no: '3', group: 'Permits displayed', label: 'FDA', section: 'STORE' },
  { key: 'permit_bir_cor', no: '3', group: 'Permits displayed', label: 'BIR COR', section: 'STORE' },
  { key: 'permit_barangay', no: '3', group: 'Permits displayed', label: 'Barangay Clearance', section: 'STORE' },
  { key: 'permit_bir_0605', no: '3', group: 'Permits displayed', label: 'BIR 0605', section: 'STORE' },
  { key: 'permit_ipo', no: '3', group: 'Permits displayed', label: 'Intellectual Property (IPO)', section: 'STORE' },
  { key: 'columnar_sales', no: '4', group: 'Columnar', label: 'Sales', section: 'STORE' },
  { key: 'columnar_expenses', no: '4', group: 'Columnar', label: 'Expenses', section: 'STORE' },
  { key: 'no_alterations', no: '5', label: 'Alterations in the store (decors and other things not approved by management)', section: 'STORE' },
  { key: 'sales_deposit', no: '6', label: 'Sales Deposit', section: 'STORE', extras: ['date'], extraLabel: 'Date updated' },
  { key: 'cash_fund', no: '7', label: 'Cash Fund', section: 'STORE', extras: ['amount', 'reason'], extraLabel: 'Amount found / reason for lacking' },
  { key: 'actual_vs_system', no: '8', label: 'Actual stocks vs. inventory system', section: 'STOCKS' },
  { key: 'no_other_products', no: '9', label: 'Display of other products not officially carried by GWS', section: 'STOCKS' },
  { key: 'no_outside_products', no: '10', label: 'Display of products not from GWS main branch', section: 'STOCKS' },
  { key: 'near_expiry', no: '11', label: 'Near expiry', section: 'STOCKS' },
  { key: 'clumped_stocks', no: '12', label: 'Clumped stocks', section: 'STOCKS' },
  { key: 'stock_cleanliness', no: '13', label: 'Cleanliness of stocks', section: 'STOCKS' },
  { key: 'manual_inventory_gsheet', no: '14', label: 'Daily manual inventory (GSheet)', section: 'STOCKS', extras: ['date'], extraLabel: 'Date updated' },
  { key: 'manual_inventory_hardcopy', no: '15', label: 'Daily manual inventory (hard copy)', section: 'STOCKS', extras: ['date'], extraLabel: 'Date updated' },
  { key: 'staff_uniform', no: '16', label: 'Staff uniform', section: 'STAFF', extras: ['reason'], extraLabel: 'Reason if not complied' },
  { key: 'staff_id', no: '17', label: 'Identification card / name plate', section: 'STAFF', extras: ['reason'], extraLabel: 'Reason if not complied' },
  { key: 'staff_knowledge', no: '18', label: 'Staff product knowledge', section: 'STAFF' },
  { key: 'staff_monitoring', no: '19', label: 'Staff monthly monitoring', section: 'STAFF' },
];
export type ItemStatus = 'COMPLIED' | 'NO' | 'NA';
export interface ItemAnswer { key: string; status: ItemStatus | null; date?: string | null; amount?: number | null; reason?: string | null }

/** Validates answers for submission: every item answered; a NO on staff items needs a reason. Returns the non-compliant items. */
export function validateAnswers(items: ItemAnswer[], forSubmit: boolean): { missing: string[]; issues: ChecklistItem[] } {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const missing = CHECKLIST.filter((c) => !byKey.get(c.key)?.status).map((c) => `${c.no}. ${c.group ? `${c.group}: ` : ''}${c.label}`);
  if (forSubmit && missing.length) return { missing, issues: [] };
  const issues = CHECKLIST.filter((c) => byKey.get(c.key)?.status === 'NO');
  return { missing: forSubmit ? missing : [], issues };
}
