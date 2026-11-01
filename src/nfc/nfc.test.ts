import { describe, expect, it } from 'vitest';
import { decodeRecord, encodeUriRecord } from './ndef';
import { parsePayload } from './payload';

describe('NDEF', () => {
  it('codifica un URL con prefisso abbreviato e lo rilegge', () => {
    const url = 'https://party.example.com/j/K7Q2X/abcDEF234ghj';
    const rec = encodeUriRecord(url);
    expect(rec.type).toEqual([0x55]);
    expect(rec.payload[0]).toBe(0x04); // "https://"
    expect(decodeRecord(rec)).toBe(url);
  });
  it('decodifica un record di testo', () => {
    const text = new TextEncoder().encode('ciao');
    expect(decodeRecord({ tnf: 1, type: [0x54], id: [], payload: [2, 0x69, 0x74, ...text] })).toBe('ciao');
  });
});

describe('payload', () => {
  it('riconosce tavoli e pass', () => {
    expect(parsePayload('https://x.it/j/k7q2x/abcDEF234ghj')).toEqual({ kind: 'table', code: 'K7Q2X', token: 'abcDEF234ghj' });
    expect(parsePayload('https://x.it/p/AbCdEfGh2345JkLmNpQr')).toEqual({ kind: 'pass', token: 'AbCdEfGh2345JkLmNpQr' });
    expect(parsePayload('/j/ABCDE/123456')).toEqual({ kind: 'table', code: 'ABCDE', token: '123456' });
    expect(parsePayload('https://evil.it/altro')).toBeNull();
  });
});
