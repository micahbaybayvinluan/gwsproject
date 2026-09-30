import { describe, expect, it } from 'vitest';
import { phoneKey, validPhone } from './sixpack.service';

describe('6-Pack customer number', () => {
  it('the same mobile number typed three ways is one customer', () => { expect(new Set(['09171234567', '+63 917 123 4567', '917-123-4567'].map(phoneKey)).size).toBe(1); });
  it('needs ten digits', () => { expect(validPhone('0917123')).toBe(false); expect(validPhone('0917 123 4567')).toBe(true); });
});
