import { describe, expect, it } from 'vitest';
import { circleHitsWall } from './arena';
import { ARENA_HEIGHT, DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { HALF_PI, PI } from './detmath';
import { createMatch } from './state';
import { step } from './step';
import { NO_INPUT, type MatchState, type PlayerInput, type SimEvent } from './types';

const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000, hearts: 3 };
const idle: PlayerInput[] = [NO_INPUT, NO_INPUT];

function run(s: MatchState, ticks: number, c: Config = cfg): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(s, idle, c));
  return all;
}

function toPlaying(c: Config = cfg): MatchState {
  const s = createMatch(c, 5);
  run(s, Math.round(c.countdownSeconds * TICK_RATE), c);
  return s;
}

/** Parks CYAN just off the left wall, heading into it. */
function crashCyan(s: MatchState): void {
  Object.assign(s.snakes[0], { x: 12, y: 500, prevX: 12, prevY: 500, heading: PI });
}

const ofType = (events: SimEvent[], type: SimEvent['type']) => events.filter((e) => e.type === type);

describe('hearts', () => {
  it('starts every snake with cfg.hearts hearts', () => {
    expect(createMatch(cfg, 1).snakes.map((sn) => sn.hearts)).toEqual([3, 3]);
  });

  it('a hit costs a heart instead of the round: bounce off, then grace', () => {
    const s = toPlaying();
    crashCyan(s);
    const events = run(s, 3);
    expect(ofType(events, 'death')).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'heartLost', player: 0, heartsLeft: 2, cause: 'wall' }));
    const cyan = s.snakes[0];
    expect(cyan.alive).toBe(true);
    expect(cyan.hearts).toBe(2);
    expect(cyan.effects.grace).toBeGreaterThan(0);
    expect(cyan.x).toBeGreaterThanOrEqual(cfg.snakeRadius);
  });

  it('the last heart is the one that kills', () => {
    const s = toPlaying();
    s.snakes[0].hearts = 1;
    crashCyan(s);
    const events = run(s, 3);
    expect(ofType(events, 'death')).toEqual([expect.objectContaining({ player: 0, cause: 'wall' })]);
    expect(s.snakes[0].hearts).toBe(0);
  });

  it('a Shield bubble takes the hit before any heart does', () => {
    const s = toPlaying();
    s.snakes[0].shield = true;
    crashCyan(s);
    const events = run(s, 3);
    expect(ofType(events, 'shieldBlocked')).toHaveLength(1);
    expect(ofType(events, 'heartLost')).toEqual([]);
    expect(s.snakes[0].hearts).toBe(3);
  });

  it('a blast costs a heart without moving you', () => {
    const s = toPlaying();
    const cyan = s.snakes[0];
    const x = cyan.x + cfg.baseSpeed / TICK_RATE;
    s.bombs.push({ id: 99, owner: 1, x, y: cyan.y, fromX: x, fromY: cyan.y, flight: 0, flightTotal: 0, fuse: 1, maxFuse: 1, chainDepth: 0 });
    const events = run(s, 1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'heartLost', player: 0, cause: 'blast', heartsLeft: 2 }));
    expect(cyan.alive).toBe(true);
    expect(cyan.x).toBeCloseTo(x, 6);
  });

  it('a blast that catches you at a wall costs one heart, not two', () => {
    const s = toPlaying();
    const cyan = s.snakes[0];
    Object.assign(cyan, { x: 800, y: ARENA_HEIGHT - 9, prevX: 800, prevY: ARENA_HEIGHT - 9, heading: HALF_PI - 0.3 });
    s.bombs.push({ id: 99, owner: 1, x: 800, y: 960, fromX: 800, fromY: 960, flight: 0, flightTotal: 0, fuse: 1, maxFuse: 1, chainDepth: 0 });
    const events = run(s, 1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'heartLost', player: 0, cause: 'blast', heartsLeft: 2 }));
    expect(circleHitsWall(cyan.x, cyan.y, cfg.snakeRadius)).toBe(false);
    run(s, 30);
    expect(cyan.alive).toBe(true);
    expect(cyan.hearts).toBe(2);
  });

  it('head-on with hearts: both lose one and bounce apart', () => {
    const s = toPlaying();
    const [a, b] = s.snakes;
    Object.assign(a, { x: 788, y: 500, heading: 0 });
    Object.assign(b, { x: 808, y: 500, heading: PI });
    const events = run(s, 1);
    expect(ofType(events, 'death')).toEqual([]);
    expect(ofType(events, 'heartLost')).toHaveLength(2);
    expect([a.hearts, b.hearts]).toEqual([2, 2]);
  });

  it('when time runs out, more hearts wins the round', () => {
    const c = { ...cfg, roundMaxSeconds: 1 };
    const s = toPlaying(c);
    s.snakes[1].hearts = 2;
    const events = run(s, TICK_RATE, c);
    expect(events.find((e) => e.type === 'roundOver')).toEqual({ type: 'roundOver', winner: 0, deaths: [] });
  });

  it('when time runs out with equal hearts, the round is a draw', () => {
    const c = { ...cfg, roundMaxSeconds: 1 };
    const s = toPlaying(c);
    const events = run(s, TICK_RATE, c);
    expect(events.find((e) => e.type === 'roundOver')).toEqual({ type: 'roundOver', winner: null, deaths: [] });
  });

  it('refills hearts at the start of every round', () => {
    const c = { ...cfg, roundMaxSeconds: 1 };
    const s = toPlaying(c);
    s.snakes[0].hearts = 1;
    run(s, TICK_RATE + Math.round(c.roundOverSeconds * TICK_RATE), c);
    expect(s.round).toBe(2);
    expect(s.snakes.map((sn) => sn.hearts)).toEqual([3, 3]);
  });
});
