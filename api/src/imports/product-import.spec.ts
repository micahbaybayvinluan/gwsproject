import { describe, expect, it } from 'vitest';
import { classify, parseProductGrid } from './product-import';

describe('product import classifier (§7.1)', () => {
  it('keyword map', () => {
    expect(classify('REPACKED Whey 1kg').accountingClass).toBe('REPACKED');
    expect(classify('PROMO Bundle Whey + Shaker').accountingClass).toBe('BUNDLE');
    expect(classify('GWS Shaker 700ml').accountingClass).toBe('PLASTIC');
    expect(classify('Prothin Shirt L').accountingClass).toBe('APPAREL');
    expect(classify('Hex Dumbbell 10kg').accountingClass).toBe('EQUIPMENT');
    expect(classify('Adjustable Bench').accountingClass).toBe('EQUIPMENT');
    expect(classify('Plastic Ecobag Large').accountingClass).toBe('PLASTIC');
    expect(classify('Gold Standard Whey 5lb').accountingClass).toBe('SUPPLEMENT');
  });
  it('parses the DAILY INVTY COUNT column layout (B name, C franchise, D dealer, E SRP, F cost) and skips headers', () => {
    const grid: unknown[][] = [];
    grid[1] = [undefined, undefined, 'ITEMS', 'FRANCHISEE', 'DEALER', 'RETAILER', 'COST'];
    grid[2] = [undefined, undefined, 'SUPPLEMENTS'];
    grid[3] = [undefined, undefined, 'Whey 5lb', 1100, 1200, 1500, null];
    grid[4] = [undefined, undefined, 'Protein Bar Choco', 50, 55, 70, 30];
    grid[5] = [undefined, undefined, 'Combo Pack Set', '1,000', '1,100', '1,300', ''];
    const rows = parseProductGrid(grid);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ name: 'Whey 5lb', franchise: 1100, dealer: 1200, retail: 1500, cost: null, accountingClass: 'SUPPLEMENT', trackExpiry: true });
    expect(rows[1].accountingClass).toBe('SUPPLEMENT'); // protein bar is not equipment
    expect(rows[1].cost).toBe(30);
    expect(rows[2]).toMatchObject({ franchise: 1000, needsReview: true });
  });
});
