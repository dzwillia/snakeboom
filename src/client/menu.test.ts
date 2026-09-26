import { describe, expect, it } from 'vitest';
import { MENU_ROWS, nextRow } from './menu';

describe('title menu', () => {
  it('lists local, players, match length, create link and quick match in order', () => {
    expect(MENU_ROWS).toEqual(['local', 'players', 'wins', 'create', 'quick']);
  });

  it('moves one row at a time and stops at the ends', () => {
    expect(nextRow('local', 1)).toBe('players');
    expect(nextRow('players', 1)).toBe('wins');
    expect(nextRow('wins', 1)).toBe('create');
    expect(nextRow('quick', 1)).toBe('quick');
    expect(nextRow('local', -1)).toBe('local');
    expect(nextRow('create', -1)).toBe('wins');
    expect(nextRow('quick', -5)).toBe('create');
  });
});
