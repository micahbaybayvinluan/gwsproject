import { describe, expect, it } from 'vitest';
import { findBrowser } from './pdf.service';

describe('PDF browser lookup', () => {
  it('uses the configured path when it exists', () => { expect(findBrowser('/x/chrome', (p) => p === '/x/chrome')).toBe('/x/chrome'); });
  it('falls back to Google Chrome on a Mac when the configured Linux path is missing', () => {
    const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(findBrowser('/usr/bin/chromium', (p) => p === mac)).toBe(mac);
  });
  it('returns null when no browser is installed', () => { expect(findBrowser(undefined, () => false)).toBeNull(); });
});
