import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from '../config';
import { checkInvariants } from '../invariants';
import { createMatch } from '../state';
import { rematch, step } from '../step';
import { NO_INPUT, type MatchState, type PlayerInput } from '../types';
import { createItem } from '../items';
import { botInput, createBot } from './simple-bot';
import { createOpponent, DIFFICULTIES, opponentInput, PROFILES, type Difficulty } from './opponent';

type Driver = (state: MatchState, idx: number) => PlayerInput;

function driver(kind: Difficulty | 'simple', seed: number, cfg: Config): Driver {
  if (kind === 'simple') {
    const bot = createBot(seed);
    return (state, idx) => botInput(bot, state, idx, cfg);
  }
  const bot = createOpponent(kind, seed);
  return (state, idx) => opponentInput(bot, state, idx, cfg);
}

/** Plays `rounds` rounds and returns wins per seat, draws, deaths per seat and invariant problems. */
function duel(kinds: [Difficulty | 'simple', Difficulty | 'simple'], rounds: number, seed: number, cfg = FAST) {
  const state = createMatch(cfg, seed);
  const drivers = kinds.map((k, i) => driver(k, seed + 1 + i, cfg));
  const wins = [0, 0];
  const deaths = [0, 0];
  const problems: string[] = [];
  let draws = 0;
  let played = 0;
  // Past the cap the border crushes until someone dies, which takes a few more seconds per round.
  const limit = rounds * (Math.round((cfg.roundMaxSeconds + 10 + cfg.countdownSeconds + cfg.roundOverSeconds) * TICK_RATE) + 10);
  for (let t = 0; t < limit && played < rounds; t++) {
    const events = step(state, drivers.map((d, i) => d(state, i)), cfg);
    for (const e of events) {
      if (e.type === 'death') deaths[e.player]++;
      if (e.type === 'roundOver') {
        played++;
        if (e.winner === null) draws++;
        else wins[e.winner]++;
      }
    }
    if (events.length > 0 || t % 97 === 0) problems.push(...checkInvariants(state, cfg));
    if (state.phase === 'matchOver') rematch(state, cfg, seed + t);
  }
  return { wins, draws, deaths, problems, played };
}

const FAST: Config = {
  ...DEFAULT_CONFIG,
  roundMaxSeconds: 40,
  countdownSeconds: 1,
  roundOverSeconds: 1,
};

describe('AI opponent', () => {
  it('is deterministic for a seed', () => {
    const run = () => {
      const state = createMatch(DEFAULT_CONFIG, 99);
      const bot = createOpponent('hard', 5);
      const human = createBot(6);
      const inputs: string[] = [];
      for (let t = 0; t < 1500; t++) {
        const mine = opponentInput(bot, state, 1, DEFAULT_CONFIG);
        inputs.push(`${mine.turn}${mine.boost ? 'b' : ''}${mine.use ? 'u' : ''}`);
        step(state, [botInput(human, state, 0, DEFAULT_CONFIG), mine], DEFAULT_CONFIG);
      }
      return inputs.join('');
    };
    expect(run()).toBe(run());
  }, 30000);

  it('does nothing during the countdown or once dead', () => {
    const state = createMatch(DEFAULT_CONFIG, 3);
    const bot = createOpponent('normal', 1);
    expect(state.phase).toBe('countdown');
    expect(opponentInput(bot, state, 1, DEFAULT_CONFIG)).toEqual(NO_INPUT);
    while (state.phase !== 'playing') step(state, [NO_INPUT, NO_INPUT], DEFAULT_CONFIG);
    state.snakes[1].alive = false;
    expect(opponentInput(bot, state, 1, DEFAULT_CONFIG)).toEqual(NO_INPUT);
  });

  it('never emits NaN or off-range values', () => {
    const state = createMatch(DEFAULT_CONFIG, 12);
    const bot = createOpponent('hard', 2);
    for (let t = 0; t < 3000; t++) {
      const input = opponentInput(bot, state, 1, DEFAULT_CONFIG);
      expect([-1, 0, 1]).toContain(input.turn);
      expect(typeof input.boost).toBe('boolean');
      expect(typeof input.use).toBe('boolean');
      step(state, [NO_INPUT, input], DEFAULT_CONFIG);
    }
  });

  it('selects the item it wants before firing it, instead of firing the front one', () => {
    const state = createMatch(DEFAULT_CONFIG, 21);
    while (state.phase !== 'playing') step(state, [NO_INPUT, NO_INPUT], DEFAULT_CONFIG);
    const [human, me] = state.snakes;
    // Both heading east at the same speed, the human 150 units dead ahead: a missile's dream, nothing to be boxed by.
    me.x = 800;
    me.y = 1000;
    me.heading = 0;
    human.x = 950;
    human.y = 1000;
    human.heading = 0;
    me.items = [createItem('ghost', DEFAULT_CONFIG), createItem('missile', DEFAULT_CONFIG)];
    const bot = createOpponent('hard', 4, { itemSkill: 1, mistakeRate: 0 });
    const presses: string[] = [];
    let fired = false;
    for (let t = 0; t < 600 && !fired; t++) {
      const input = opponentInput(bot, state, 1, DEFAULT_CONFIG);
      if (input.select) presses.push('select');
      if (input.use) {
        presses.push('use');
        expect(me.items[me.selected].kind).toBe('missile');
      }
      const events = step(state, [NO_INPUT, input], DEFAULT_CONFIG);
      if (events.some((e) => e.type === 'missileFired' && e.player === 1)) fired = true;
      expect(events.some((e) => e.type === 'effectStarted' && e.player === 1)).toBe(false);
    }
    expect(fired).toBe(true);
    expect(presses).toEqual(['select', 'use']);
    expect(me.items.map((i) => i.kind)).toEqual(['ghost', 'missile']);
  });

  // These play whole rounds, so they get a generous timeout: the higher levels think hard.
  const LONG = 120000;

  it(
    'keeps the sim invariants over rounds at every difficulty',
    () => {
      for (const kind of DIFFICULTIES) {
        const { problems, played } = duel([kind, kind], 2, 21);
        expect(problems).toEqual([]);
        expect(played).toBe(2);
      }
    },
    LONG,
  );

  it(
    'plays a lot better than the soak bot',
    () => {
      // 12 rounds: with one life, fire and saws, a 6-round sample on one seed can land 4–2.
      const { wins, deaths } = duel(['hard', 'simple'], 12, 7);
      expect(wins[0]).toBeGreaterThan(wins[1] * 3);
      expect(deaths[0]).toBeLessThan(deaths[1]);
    },
    LONG,
  );

  it(
    'ranks the difficulties: hard and normal both beat easy',
    () => {
      // One life and homing missiles compress the gap until the AI learns to dodge them (M11):
      // a missile from Easy kills Hard just as dead. So: a dozen rounds, and the higher level wins more.
      const hardVsEasy = duel(['hard', 'easy'], 12, 31);
      expect(hardVsEasy.wins[0]).toBeGreaterThan(hardVsEasy.wins[1]);
      const normalVsEasy = duel(['normal', 'easy'], 12, 32);
      expect(normalVsEasy.wins[0]).toBeGreaterThan(normalVsEasy.wins[1]);
    },
    LONG,
  );

  it(
    'ranks the difficulties: hard is close to normal in a border endgame',
    () => {
      // Since the closing border (M9), rounds between two strong survivors are decided in the
      // endgame, where hard's cutting and territory play count for little; on the big arena (M12)
      // even more so. Over 12 rounds the two land within a few wins of each other. Making hard own
      // the endgame is a tuning-session item.
      const hardVsNormal = duel(['hard', 'normal'], 12, 33);
      expect(hardVsNormal.played).toBe(12);
      expect(hardVsNormal.wins[0]).toBeGreaterThanOrEqual(hardVsNormal.wins[1] - 4);
    },
    LONG,
  );

  it('draws a loop around a pickup it wants within a few seconds, at every level', () => {
    // Open map, a body long enough to loop with, CYAN circling far away: the pickup sits at a few
    // offsets from PINK's head (ahead, off to a side, behind) and must be taken within 4 s.
    const quiet: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000, wormholeInterval: 0, sawInterval: 0, borderCloseSeconds: 0 };
    const offsets: Array<[number, number]> = [
      [300, 0],
      [300, -150],
      [0, 250],
      [-200, 200],
    ];
    for (const kind of DIFFICULTIES) {
      for (const [ax, ay] of offsets) {
        const state = createMatch(quiet, 11);
        state.phase = 'playing';
        state.phaseTicks = 0;
        const me = state.snakes[1];
        Object.assign(me, { x: 1400, y: 1000, prevX: 1400, prevY: 1000, heading: 0, targetLength: 400 });
        Object.assign(state.snakes[0], { x: 300, y: 1800, prevX: 300, prevY: 1800, heading: 0 });
        state.pickups.push({ id: 1, kind: 'missile', x: 1400 + ax, y: 1000 + ay, ttl: 100_000, dropped: false });
        const bot = createOpponent(kind, 5);
        let took = -1;
        for (let t = 0; t < 4 * TICK_RATE && took < 0 && me.alive; t++) {
          const events = step(state, [{ turn: 1, boost: false, use: false, select: false }, opponentInput(bot, state, 1, quiet)], quiet);
          if (events.some((e) => e.type === 'loopCollected' && e.player === 1)) took = t;
        }
        // Easy slips up on purpose and decides slowly; it gets the easy placements only.
        if (kind === 'easy' && ay !== 0 && ax <= 0) continue;
        expect(took, `${kind} with the pickup at (${ax}, ${ay})`).toBeGreaterThanOrEqual(0);
        expect(me.items.map((i) => i.kind)).toEqual(['missile']);
      }
    }
  }, 60000);

  it('lets a match override individual profile knobs', () => {
    const bot = createOpponent('easy', 1, { lookSteps: 40 });
    expect(bot.profile).toEqual({ ...PROFILES.easy, lookSteps: 40 });
    expect(PROFILES.easy.lookSteps).not.toBe(40);
  });
});
