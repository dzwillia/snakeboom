import { describe, expect, it } from 'vitest';
import { botInput, createBot, type BotState } from './bots/simple-bot';
import { DEFAULT_CONFIG } from './config';
import { cloneState, createMatch } from './state';
import { step } from './step';
import type { MatchState } from './types';

function drive(state: MatchState, bots: BotState[], ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    step(state, bots.map((b, i) => botInput(b, state, i, DEFAULT_CONFIG)), DEFAULT_CONFIG);
  }
}

describe('determinism', () => {
  it('replays identically from the same seed and inputs', () => {
    const a = createMatch(DEFAULT_CONFIG, 2024);
    const b = createMatch(DEFAULT_CONFIG, 2024);
    drive(a, [createBot(1), createBot(2)], 4000);
    drive(b, [createBot(1), createBot(2)], 4000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('continues identically from a cloned state', () => {
    const a = createMatch(DEFAULT_CONFIG, 7);
    const bots = [createBot(3), createBot(4)];
    drive(a, bots, 1500);
    const b = cloneState(a);
    const botsB = structuredClone(bots);
    drive(a, bots, 2500);
    drive(b, botsB, 2500);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
