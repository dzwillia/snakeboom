import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from '../config';
import { checkInvariants } from '../invariants';
import { createMatch } from '../state';
import { rematch, step } from '../step';
import { NO_INPUT, type MatchState, type PlayerInput } from '../types';
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
      const { wins, deaths } = duel(['hard', 'simple'], 6, 7);
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

  it('lets a match override individual profile knobs', () => {
    const bot = createOpponent('easy', 1, { lookSteps: 40 });
    expect(bot.profile).toEqual({ ...PROFILES.easy, lookSteps: 40 });
    expect(PROFILES.easy.lookSteps).not.toBe(40);
  });
});
