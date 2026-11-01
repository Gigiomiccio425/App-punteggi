import { describe, expect, it } from 'vitest';
import { parsePayload } from './payload';

describe('payload NFC/QR', () => {
  it('riconosce tavoli e pass', () => {
    expect(parsePayload('https://x.it/j/k7q2x/abcDEF234ghj')).toEqual({ kind: 'table', code: 'K7Q2X', token: 'abcDEF234ghj' });
    expect(parsePayload('https://x.it/party/j/K7Q2X/123456')).toEqual({ kind: 'table', code: 'K7Q2X', token: '123456' });
    expect(parsePayload('https://x.it/p/AbCdEfGh2345JkLmNpQr')).toEqual({ kind: 'pass', token: 'AbCdEfGh2345JkLmNpQr' });
    expect(parsePayload('/j/ABCDE/123456')).toEqual({ kind: 'table', code: 'ABCDE', token: '123456' });
    expect(parsePayload('https://evil.it/altro')).toBeNull();
  });
});
