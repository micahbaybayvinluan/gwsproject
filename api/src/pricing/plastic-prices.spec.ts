import { describe, expect, it } from 'vitest';
import { plasticSize } from './plastic-prices';

describe('plastic sizes', () => {
  it('reads the size of a plastic bag', () => {
    expect(plasticSize('Plastic XL ')).toBe('XL'); expect(plasticSize('Plastic L')).toBe('L'); expect(plasticSize('Plastic M')).toBe('M'); expect(plasticSize('Plastic S')).toBe('S');
    expect(plasticSize('Plastic Ecobag Large')).toBe('L'); expect(plasticSize('Eco bag Extra Large')).toBe('XL'); expect(plasticSize('Plastic medium')).toBe('M');
  });
  it('ignores things that are not sized bags', () => { expect(plasticSize('Shaker 600ml')).toBeNull(); expect(plasticSize('Plastic')).toBeNull(); expect(plasticSize('Whey L')).toBeNull(); });
});
