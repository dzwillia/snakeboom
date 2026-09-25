import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { PI } from './detmath';
import { createMatch } from './state';
import { rematch, step } from './step';
import { NO_INPUT, type MatchState, type PlayerInput, type SimEvent } from './types';

// One heart: these tests exercise the one-hit death rules (hearts have their own tests).
const cfg: Config = { ...DEFAULT_CONFIG, hearts: 1 };
const idle: PlayerInput[] = [NO_INPUT, NO_INPUT];

function run(state: MatchState, ticks: number, c: Config = cfg, inputs: PlayerInput[] = idle): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(state, inputs, c));
  return all;
}

function toPlaying(c: Config = cfg): MatchState {
  const s = createMatch(c, 7);
  run(s, Math.round(c.countdownSeconds * TICK_RATE), c);
  return s;
}

/** Teleports snake idx next to the left wall, facing it: dead within a few ticks. */
function aimAtWall(s: MatchState, idx: number): void {
  const sn = s.snakes[idx];
  sn.x = 20;
  sn.y = 500;
  sn.heading = PI;
}

describe('step: countdown', () => {
  it('counts 3-2-1 then GO after countdownSeconds, with snakes frozen', () => {
    const s = createMatch(cfg, 1);
    const x0 = s.snakes[0].x;
    const events = run(s, 3 * TICK_RATE - 1, cfg, [{ turn: 1, boost: true, use: true }, NO_INPUT]);
    expect(events).toEqual([
      { type: 'countdown', n: 3 },
      { type: 'countdown', n: 2 },
      { type: 'countdown', n: 1 },
    ]);
    expect(s.phase).toBe('countdown');
    expect(s.snakes[0].x).toBe(x0);
    expect(step(s, idle, cfg)).toEqual([{ type: 'go' }]);
    expect(s.phase).toBe('playing');
  });
});

describe('step: playing', () => {
  it('moves the snakes and counts round time', () => {
    const s = toPlaying();
    run(s, TICK_RATE);
    expect(s.roundTicks).toBe(TICK_RATE);
    expect(s.snakes[0].x).toBeCloseTo(260 + cfg.baseSpeed, 6);
  });

  it('awards the round to the survivor and reports the death', () => {
    const s = toPlaying();
    aimAtWall(s, 0);
    const events = run(s, 10);
    expect(events.find((e) => e.type === 'death')).toMatchObject({ player: 0, cause: 'wall', killer: null });
    expect(events.find((e) => e.type === 'roundOver')).toMatchObject({ winner: 1 });
    expect(s.scores).toEqual([0, 1]);
    expect(s.phase).toBe('roundOver');
  });

  it('scores nothing when both die in the same tick', () => {
    const s = toPlaying();
    const [a, b] = s.snakes;
    Object.assign(a, { x: 790, y: 500, heading: 0 });
    Object.assign(b, { x: 810, y: 500, heading: PI });
    const events = run(s, 3);
    expect(events.filter((e) => e.type === 'death')).toHaveLength(2);
    expect(events.find((e) => e.type === 'roundOver')).toMatchObject({ winner: null });
    expect(s.scores).toEqual([0, 0]);
  });

  it('keeps playing past roundMaxSeconds, with the border closing fast', () => {
    const c = { ...cfg, roundMaxSeconds: 1, borderCloseSeconds: 0 };
    const s = toPlaying(c);
    const events = run(s, TICK_RATE + 30, c);
    expect(events.find((e) => e.type === 'roundOver')).toBeUndefined();
    expect(events.filter((e) => e.type === 'borderClosing')).toHaveLength(1);
    expect(s.phase).toBe('playing');
    expect(s.inset).toBeCloseTo((c.borderCrushSpeed * 30) / TICK_RATE, 6);
  });

  it('enters overtime once, at overtimeAt', () => {
    const c = { ...cfg, overtimeAt: 1 };
    const s = toPlaying(c);
    const events = run(s, TICK_RATE + 5, c);
    expect(events.filter((e) => e.type === 'overtime')).toHaveLength(1);
    expect(s.overtime).toBe(true);
  });

  it('reports when a snake starts boosting', () => {
    const s = toPlaying();
    const events = run(s, 5, cfg, [{ turn: 0, boost: true, use: false }, NO_INPUT]);
    expect(events.filter((e) => e.type === 'boostStarted')).toEqual([{ type: 'boostStarted', player: 0 }]);
  });
});

describe('step: rounds and matches', () => {
  it('starts the next round after roundOverSeconds', () => {
    const s = toPlaying();
    aimAtWall(s, 0);
    run(s, 10);
    run(s, Math.round(cfg.roundOverSeconds * TICK_RATE));
    expect(s.round).toBe(2);
    expect(s.phase).toBe('countdown');
    expect(s.snakes.every((sn) => sn.alive)).toBe(true);
    expect(s.deaths).toEqual([]);
  });

  it('ends the match when someone reaches winsToWin, then stays frozen', () => {
    const c = { ...cfg, winsToWin: 2 };
    const s = createMatch(c, 3);
    const seen: SimEvent[] = [];
    for (let round = 0; round < 2; round++) {
      seen.push(...run(s, Math.round(c.countdownSeconds * TICK_RATE), c));
      aimAtWall(s, 0);
      seen.push(...run(s, 10 + Math.round(c.roundOverSeconds * TICK_RATE), c));
    }
    expect(seen.filter((e) => e.type === 'roundOver')).toHaveLength(2);
    expect(seen.find((e) => e.type === 'matchOver')).toEqual({ type: 'matchOver', winner: 1 });
    expect(s.phase).toBe('matchOver');
    const frozen = JSON.stringify(s.snakes);
    expect(run(s, 30, c)).toEqual([]);
    expect(JSON.stringify(s.snakes)).toBe(frozen);
  });

  it('rematch resets scores and starts a new countdown on Open', () => {
    const c = { ...cfg, winsToWin: 1 };
    const s = toPlaying(c);
    aimAtWall(s, 0);
    run(s, 10 + Math.round(c.roundOverSeconds * TICK_RATE), c);
    expect(s.phase).toBe('matchOver');
    rematch(s, c, 99);
    expect(s.phase).toBe('countdown');
    expect(s.scores).toEqual([0, 0]);
    expect(s.round).toBe(1);
    expect(s.matchWinner).toBeNull();
    expect(s.mapIndex).toBe(0);
  });
});
