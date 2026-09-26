import { describe, expect, it } from 'vitest';
import {
  displayName,
  isRoomCode,
  isRoomKey,
  isRoomName,
  NAME_MAX,
  normalizeRoomName,
  roomCode,
  roomNameProblem,
  sanitizeName,
} from './names';

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

describe('room names', () => {
  it('normalises to lowercase and trims', () => {
    expect(normalizeRoomName('  Dave-42 ')).toBe('dave-42');
    expect(normalizeRoomName(42)).toBe('');
  });

  it('accepts 3 to 24 lowercase letters, digits and dashes', () => {
    expect(roomNameProblem('dave')).toBeNull();
    expect(roomNameProblem('abc')).toBeNull();
    expect(roomNameProblem('a'.repeat(24))).toBeNull();
    expect(roomNameProblem('friday-night-2')).toBeNull();
    expect(roomNameProblem('ab')).toMatch(/3 to 24/);
    expect(roomNameProblem('a'.repeat(25))).toMatch(/3 to 24/);
    expect(roomNameProblem('dave z')).toMatch(/letters, digits and dashes/i);
    expect(roomNameProblem('Dave')).toMatch(/letters, digits and dashes/i);
    expect(roomNameProblem('dave_z')).toMatch(/letters, digits and dashes/i);
    expect(roomNameProblem('dave/z')).toMatch(/letters, digits and dashes/i);
  });

  it('keeps a few words reserved', () => {
    for (const word of ['new', 'quick', 'admin', 'api', 'health']) expect(roomNameProblem(word)).toMatch(/reserved/);
    expect(isRoomName('admin')).toBe(false);
    expect(isRoomName('dave')).toBe(true);
  });

  it('never overlaps with a random code', () => {
    expect(isRoomName(roomCode(() => 0))).toBe(false);
    expect(isRoomName('ABC234')).toBe(false);
    expect(isRoomCode('abc234')).toBe(false);
    expect(isRoomKey('ABC234')).toBe(true);
    expect(isRoomKey('abc234')).toBe(true);
    expect(isRoomKey('dave')).toBe(true);
    expect(isRoomKey('ab')).toBe(false);
    expect(isRoomKey(null)).toBe(false);
  });
});
