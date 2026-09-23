import { describe, expect, it } from 'vitest';
import { botInput, createBot } from './bots/simple-bot';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { checkInvariants } from './invariants';
import { createMatch } from './state';
import { rematch, step } from './step';

function soak(cfg: Config, rounds: number, seed: number) {
  const state = createMatch(cfg, seed);
  const bots = [createBot(seed + 1), createBot(seed + 2)];
  const problems: string[] = [];
  const lengths: number[] = [];
  const limit = rounds * (Math.round((cfg.roundMaxSeconds + cfg.countdownSeconds + cfg.roundOverSeconds) * TICK_RATE) + 10);
  for (let t = 0; t < limit && lengths.length < rounds; t++) {
    const events = step(state, bots.map((b, i) => botInput(b, state, i, cfg)), cfg);
    for (const e of events) if (e.type === 'roundOver') lengths.push(state.roundTicks);
    if (events.length > 0 || t % 97 === 0) problems.push(...checkInvariants(state, cfg));
    if (state.phase === 'matchOver') rematch(state, cfg, seed + t);
  }
  return { problems, lengths };
}

const FAST: Config = {
  ...DEFAULT_CONFIG,
  growthPerSecond: 150,
  overtimeAt: 20,
  roundMaxSeconds: 60,
  countdownSeconds: 1,
  roundOverSeconds: 1,
};

describe('soak', () => {
  it('plays many bot rounds without breaking invariants', () => {
    const { problems, lengths } = soak(FAST, 12, 11);
    expect(problems).toEqual([]);
    expect(lengths).toHaveLength(12);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(60 * TICK_RATE);
  });

  // Review Focus 4: extreme tuning-panel values must stay healthy.
  const extremes: Array<[string, Partial<Config>]> = [
    ['a tiny turning radius', { turnRate: 8, baseSpeed: 60 }],
    ['huge snakes and a short neck', { snakeRadius: 14, neckLength: 10 }],
    ['zero growth', { growthPerSecond: 0, overtimeGrowthMultiplier: 1, startLength: 20 }],
    ['a twitchy boost', { boostMeterSeconds: 0.5, boostRefillSeconds: 1, boostMultiplier: 3 }],
    ['fast, long snakes', { baseSpeed: 400, startLength: 600 }],
  ];
  for (const [name, overrides] of extremes) {
    it(`stays healthy with ${name}`, () => {
      const { problems, lengths } = soak({ ...FAST, ...overrides }, 3, 5);
      expect(problems).toEqual([]);
      expect(lengths).toHaveLength(3);
    });
  }
});
