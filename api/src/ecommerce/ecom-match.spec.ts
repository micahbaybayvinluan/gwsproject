import { describe, expect, it } from 'vitest';
import { matchTokens, suggestProducts } from './ecom-match';

const P = (id: string, name: string) => ({ id, sku: id, name });
const products = [P('1', 'Prothin Whey Ripped 10s (Vanilla)'), P('2', 'Prothin Whey Ripped 10s (Choco)'), P('3', 'Prothin Whey Ripped 60s (Vanilla)'), P('4', 'Core Champs Whey 5lbs (Caramel Latte)'), P('5', 'Core Champs Whey 2lbs (Caramel Latte)')];
describe('platform listing → GWS product suggestions', () => {
  it('reads sizes and servings', () => { expect(matchTokens('10 Servings, Creamy Vanilla')).toEqual(['10s', 'vanilla']); expect(matchTokens('Caramel Latte, Good Stock, 5lbs')).toEqual(['caramel', 'latte', '5lbs']); });
  it('suggests the product with the same flavor and size', () => {
    expect(suggestProducts('PROTHIN WHEY RIPPED | WHEY PROTEIN | Getwheysted Official Store 10 Servings, Creamy Vanilla', products)[0].id).toBe('1');
    expect(suggestProducts('CORE CHAMPS WHEY | WHEY PROTEIN | Getwheysted Official Store Caramel Latte, Good Stock, 5lbs', products)[0].id).toBe('4');
  });
  it('never offers another pack size or flavor', () => {
    const s = suggestProducts('PROTHIN WHEY RIPPED 10 Servings, Creamy Vanilla', products).map((x) => x.id); expect(s).not.toContain('3'); expect(s).not.toContain('2');
  });
});
