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
  let missileHits = 0;
  // Past the cap the border crushes until someone dies, which takes a few more seconds per round.
  const limit = rounds * (Math.round((cfg.roundMaxSeconds + 10 + cfg.countdownSeconds + cfg.roundOverSeconds) * TICK_RATE) + 10);
  for (let t = 0; t < limit && lengths.length < rounds; t++) {
    const events = step(state, bots.map((b, i) => botInput(b, state, i, cfg)), cfg);
    for (const e of events) {
      if (e.type === 'roundOver') lengths.push(state.roundTicks);
      if (e.type === 'missileHit') missileHits++;
    }
    if (events.length > 0 || t % 97 === 0) problems.push(...checkInvariants(state, cfg));
    if (state.phase === 'matchOver') rematch(state, cfg, seed + t);
  }
  return { problems, lengths, missileHits };
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
    const { problems, lengths, missileHits } = soak(FAST, 12, 11);
    expect(problems).toEqual([]);
    expect(missileHits).toBeGreaterThanOrEqual(0);
    expect(lengths).toHaveLength(12);
    // Past the cap the border crushes until somebody dies: a few seconds more at most.
    expect(Math.max(...lengths)).toBeLessThanOrEqual((60 + 10) * TICK_RATE);
  });

  // Review Focus 4: extreme tuning-panel values must stay healthy.
  const extremes: Array<[string, Partial<Config>]> = [
    ['a tiny turning radius', { turnRate: 8, baseSpeed: 60 }],
    ['huge snakes', { snakeRadius: 14 }],
    ['zero growth', { growthPerSecond: 0, overtimeGrowthMultiplier: 1, startLength: 20 }],
    ['a hungry boost', { boostBurnPerSecond: 300, minLength: 20, boostMultiplier: 3 }],
    ['fast, long snakes', { baseSpeed: 400, startLength: 600 }],
    ['missile chaos', { maxPickups: 6, pickupInterval: 1, firstPickupDelay: 0, missileCharges: 10, missileCooldown: 0, missileTurnRate: 12 }],
    ['no pickups at all', { maxPickups: 0 }],
    [
      'shields only',
      {
        pickupWeights: { missile: 0, scissors: 0, ghost: 0, shield: 1, dozer: 0 },
        firstPickupDelay: 0,
        pickupInterval: 1,
        maxPickups: 4,
      },
    ],
    [
      'ghosts only',
      {
        pickupWeights: { missile: 0, scissors: 0, ghost: 1, shield: 0, dozer: 0 },
        firstPickupDelay: 0,
        pickupInterval: 1,
        maxPickups: 4,
        ghostDuration: 10,
      },
    ],
    [
      'dozers everywhere',
      {
        pickupWeights: { missile: 0, scissors: 0, ghost: 0, shield: 0, dozer: 1 },
        firstPickupDelay: 0,
        pickupInterval: 1,
        maxPickups: 4,
        dozerDuration: 10,
      },
    ],
    [
      'every power-up at once',
      { firstPickupDelay: 0, pickupInterval: 0.5, maxPickups: 6, ghostDuration: 20 },
    ],
  ];
  for (const [name, overrides] of extremes) {
    it(`stays healthy with ${name}`, () => {
      const { problems, lengths } = soak({ ...FAST, ...overrides }, 3, 5);
      expect(problems).toEqual([]);
      expect(lengths).toHaveLength(3);
    });
  }
});
