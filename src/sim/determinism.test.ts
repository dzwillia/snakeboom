import { describe, expect, it } from 'vitest';
import { botInput, createBot, type BotState } from './bots/simple-bot';
import { DEFAULT_CONFIG } from './config';
import { hashState } from './hash';
import { cloneState, createMatch } from './state';
import { step } from './step';
import type { MatchState } from './types';

function drive(state: MatchState, bots: BotState[], ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    step(state, bots.map((b, i) => botInput(b, state, i, DEFAULT_CONFIG)), DEFAULT_CONFIG);
  }
}

/**
 * Seed 2024, the simple bots, 4000 ticks. Any intentional rule or tuning change updates this
 * constant (run the test and paste the new value); an unintended change is a determinism regression.
 * Updated 2026-09-25 when Turbo and Slow were removed (M9 Task 1) and again for the closing border and the pace defaults (M9 Tasks 2 and 3), and for the hunt rules (M10).
 * Updated 2026-09-26 for item selection (#28): SnakeState.selected joined the hashed state.
 * Unchanged by length-as-storage (M14): tick 4000 falls in a countdown with no pickups out, and the simple bots fire what they grab at once.
 * Updated 2026-09-26 for collecting by loop and the wider pickup clearance (M15); re-pinned after the rebase.
 * Updated 2026-09-26 for random maps (M16): the bag now holds eight entries and a random slot draws from the rng in startRound.
 */
const GOLDEN_HASH = 0x00917e13;

describe('determinism', () => {
  it('produces the golden hash for a fixed seed and input script', () => {
    const a = createMatch(DEFAULT_CONFIG, 2024);
    drive(a, [createBot(1), createBot(2)], 4000);
    expect(hashState(a).toString(16)).toBe(GOLDEN_HASH.toString(16));
  });

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
