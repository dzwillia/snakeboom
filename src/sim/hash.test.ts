import { describe, expect, it } from 'vitest';
import { botInput, createBot } from './bots/simple-bot';
import { DEFAULT_CONFIG } from './config';
import { fnv1a, hashState } from './hash';
import { createMatch } from './state';
import { step } from './step';
import type { MatchState } from './types';

function played(seed: number, ticks: number): MatchState {
  const state = createMatch(DEFAULT_CONFIG, seed);
  const bots = [createBot(seed + 1), createBot(seed + 2)];
  for (let t = 0; t < ticks; t++) step(state, bots.map((b, i) => botInput(b, state, i, DEFAULT_CONFIG)), DEFAULT_CONFIG);
  return state;
}

describe('fnv1a', () => {
  it('matches the reference values', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
  });
});

describe('hashState', () => {
  it('is equal for equal states', () => {
    expect(hashState(played(11, 500))).toBe(hashState(played(11, 500)));
  });

  it('changes when a single number changes', () => {
    const a = played(11, 500);
    const before = hashState(a);
    a.rng.s = (a.rng.s + 1) | 0;
    expect(hashState(a)).not.toBe(before);
  });

  it('ignores the grid cache', () => {
    const a = played(11, 500);
    const before = hashState(a);
    a.grid.cells[0].push(12345);
    expect(hashState(a)).toBe(before);
  });

  it('survives a JSON round trip', () => {
    const a = played(11, 500);
    expect(hashState(JSON.parse(JSON.stringify(a)) as MatchState)).toBe(hashState(a));
  });
});
