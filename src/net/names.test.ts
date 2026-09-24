import { describe, expect, it } from 'vitest';
import { displayName, isRoomCode, NAME_MAX, roomCode, sanitizeName } from './names';

describe('sanitizeName', () => {
  it('trims, strips punctuation and collapses spaces', () => {
    expect(sanitizeName('  Dave  Z!!  ')).toBe('Dave Z');
  });

  it('cuts long names to the limit without a trailing space', () => {
    expect(sanitizeName('abcdefghijklmnopqrst')).toBe('abcdefghijkl');
    expect(sanitizeName('abcdefghijk lmnop')).toHaveLength(NAME_MAX - 1);
  });

  it('gives an empty string for non-strings and empty input', () => {
    expect(sanitizeName(42)).toBe('');
    expect(sanitizeName(null)).toBe('');
    expect(sanitizeName('   ')).toBe('');
    expect(sanitizeName('<script>')).toBe('script');
  });
});

describe('displayName', () => {
  it('falls back to the seat name', () => {
    expect(displayName('', 0)).toBe('CYAN');
    expect(displayName('', 1)).toBe('PINK');
    expect(displayName('Ada', 1)).toBe('Ada');
  });
});

describe('room codes', () => {
  it('accepts six characters from the alphabet only', () => {
    expect(isRoomCode('ABC234')).toBe(true);
    expect(isRoomCode('ABC120')).toBe(false);
    expect(isRoomCode('abc234')).toBe(false);
    expect(isRoomCode('ABC23')).toBe(false);
    expect(isRoomCode(123456)).toBe(false);
  });

  it('generates valid codes from any rng, including the edges', () => {
    expect(isRoomCode(roomCode(() => 0))).toBe(true);
    expect(roomCode(() => 0)).toBe('AAAAAA');
    expect(roomCode(() => 0.999999)).toBe('999999');
    let x = 0.1;
    const code = roomCode(() => (x = (x * 9301 + 49297) % 233280) / 233280);
    expect(isRoomCode(code)).toBe(true);
  });
});
