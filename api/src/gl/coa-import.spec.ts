import { describe, expect, it } from 'vitest';
import { classFromSection, matchTemplate, normalizeTitle, parseBranchTag, parseChannelTag } from './coa-import';
import { ACCOUNT_TEMPLATES } from './account-templates';

const locs = [['WH', 'Warehouse'], ['WESTAVE', 'West Ave'], ['CSR', 'CSR'], ['IMUS', 'Imus Cavite'], ['LAGUNA', 'Laguna'], ['DASMA', 'Dasmariñas'], ['VITOCRUZ', 'Vito Cruz'], ['711', '7-11'], ['MAYON', 'Mayon']].map(([code, name]) => ({ id: code, code, name, type: 'BRANCH' }));

describe('chart of accounts import parser (§10.1)', () => {
  it('handles messy branch suffixes', () => {
    expect(parseBranchTag('Meralco – West Ave.', locs)).toBe('WESTAVE');
    expect(parseBranchTag('Sales - West Ave  Walk In', locs)).toBe('WESTAVE');
    expect(parseBranchTag('Rent (Imus)', locs)).toBe('IMUS');
    expect(parseBranchTag('Inventory – Imus Cavite Supplements', locs)).toBe('IMUS');
    expect(parseBranchTag('Rider/Driver Expense (Gas) - Dasmarinas', locs)).toBe('DASMA');
    expect(parseBranchTag('Sales – Vito Cruz Delivery Fee', locs)).toBe('VITOCRUZ');
    expect(parseBranchTag('Sales – CSR Ave Dealers', locs)).toBe('CSR');
    expect(parseBranchTag('Sales – 7-11', locs)).toBe('711');
    expect(parseBranchTag('AR – Franchise Mayon', locs)).toBe('MAYON');
    expect(parseBranchTag('Taxes & Licenses', locs)).toBeNull();
  });
  it('parses channel tags on revenue accounts', () => {
    expect(parseChannelTag('Sales – West Ave Credit Card Walk In')).toBe('CREDIT_CARD_WALK_IN');
    expect(parseChannelTag('Sales – West Ave Walk In')).toBe('WALK_IN');
    expect(parseChannelTag('Sales – Imus Delivery Fee')).toBe('DELIVERY_FEE');
    expect(parseChannelTag('Sales – Warehouse Shopee')).toBe('SHOPEE');
    expect(parseChannelTag('Sales – CSR Ave Dealers')).toBe('DEALER');
    expect(parseChannelTag('Meralco – West Ave')).toBeNull();
  });
  it('derives classes from section / title', () => {
    expect(classFromSection('REVENUES', 'Sales – X')).toBe('REVENUE'); expect(classFromSection('DIRECT COST', 'x')).toBe('DIRECT_COST'); expect(classFromSection('OPERATING EXPENSES', 'x')).toBe('OPEX');
    expect(classFromSection('ASSETS', 'Cash on Hand – West Ave')).toBe('CASH'); expect(classFromSection('ASSETS', 'AR – Franchise Mayon')).toBe('AR'); expect(classFromSection('ASSETS', 'Inventory – Warehouse Consignment (Herbs of the Earth)')).toBe('INVENTORY');
    expect(classFromSection('LIABILITIES', 'SSS Premium Payable')).toBe('CURRENT_LIABILITY'); expect(classFromSection('ASSETS', 'Accumulated Depreciation – Equipment')).toBe('ACCUM_DEPN'); expect(classFromSection('EQUITY', 'Capital')).toBe('EQUITY');
  });
  it('matches imported titles to templates', () => {
    expect(matchTemplate('Petty Cash – West Ave', ACCOUNT_TEMPLATES, locs)).toBe('PETTY_CASH');
    expect(matchTemplate('Sales - Imus Ave Dealers', ACCOUNT_TEMPLATES, locs)).toBe('SALES_DEALER');
    expect(matchTemplate('Other Expenses (Office Supplies, Drinking Water, etc)- CSR', ACCOUNT_TEMPLATES, [...locs, { id: 'OFFICE', code: 'OFFICE', name: 'Office', type: 'OFFICE' }])).toBe('OTHER_EXPENSES');
    expect(matchTemplate('AR - Franchise Mayon (Store)', ACCOUNT_TEMPLATES, locs)).toBe('AR_FRANCHISE_STORE');
    expect(matchTemplate('Rider/Driver Expense (Gas) - Dasmarinas', ACCOUNT_TEMPLATES, locs)).toBe('RIDER_GAS');
    expect(matchTemplate('Expired Items – Laguna', ACCOUNT_TEMPLATES, locs)).toBe('EXPIRED_ITEMS');
    expect(matchTemplate('Taxes & Licenses', ACCOUNT_TEMPLATES, locs)).toBeNull();
    expect(normalizeTitle('Meralco  -  West Ave')).toBe('Meralco – West Ave');
  });
});
