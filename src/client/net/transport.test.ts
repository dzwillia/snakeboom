import { describe, expect, it } from 'vitest';
import { relayUrl } from './transport';

describe('relayUrl', () => {
  it('maps http(s) API bases to the ws endpoint', () => {
    expect(relayUrl('https://api.snakeboom.com')).toBe('wss://api.snakeboom.com/ws');
    expect(relayUrl('http://localhost:3001')).toBe('ws://localhost:3001/ws');
    expect(relayUrl('http://192.168.1.20:3001/?x=1#y')).toBe('ws://192.168.1.20:3001/ws');
  });
});
