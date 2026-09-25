import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { createMatch } from './state';
import { step } from './step';
import { NO_INPUT, type MatchState, type PlayerInput, type SimEvent } from './types';

const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000, hearts: 1, borderCloseSeconds: 0 };
const straight: PlayerInput = { turn: 0, boost: false, use: false };
const right: PlayerInput = { ...straight, turn: 1 };
const TURN_90_TICKS = Math.ceil(Math.PI / 2 / (cfg.turnRate / TICK_RATE));

/** CYAN starts at the top-left corner of a square heading east; PINK circles tightly around `center`. */
function scene(center: { x: number; y: number }, opts: { pinkGhost?: boolean; pinkShield?: boolean; hearts?: number } = {}): MatchState {
  const c: Config = { ...cfg, hearts: opts.hearts ?? cfg.hearts };
  const s = createMatch(c, 9);
  s.phase = 'playing';
  s.phaseTicks = 0;
  Object.assign(s.snakes[0], { x: 650, y: 350, prevX: 650, prevY: 350, heading: 0, targetLength: 2000 });
  Object.assign(s.snakes[1], { x: center.x, y: center.y, prevX: center.x, prevY: center.y, heading: 0 });
  if (opts.pinkGhost) s.snakes[1].effects.ghost = 10_000;
  if (opts.pinkShield) s.snakes[1].shield = true;
  return s;
}

/** Drives CYAN around a square of side `side` (clockwise), one tick per call, while PINK circles. */
function* square(side: number): Generator<PlayerInput> {
  const straightTicks = Math.round(side / (cfg.baseSpeed / TICK_RATE));
  for (let edge = 0; edge < 4; edge++) {
    for (let t = 0; t < straightTicks; t++) yield straight;
    for (let t = 0; t < TURN_90_TICKS; t++) yield right;
  }
  for (;;) yield straight;
}

function drive(s: MatchState, ticks: number, c: Config = cfg): SimEvent[] {
  const plan = square(300);
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    const cyan = plan.next().value as PlayerInput;
    out.push(...step(s, [cyan, right], c));
    if (s.phase !== 'playing') break;
  }
  return out;
}

const LAP = 4 * (Math.round(300 / (cfg.baseSpeed / TICK_RATE)) + TURN_90_TICKS) + 30;

// M10 Review Focus 1: encirclement is exact and fair.
describe('encirclement', () => {
  it('kills a head inside the loop the moment it closes, once', () => {
    const s = scene({ x: 800, y: 500 });
    const events = drive(s, LAP);
    const caught = events.filter((e) => e.type === 'encircled');
    expect(caught).toHaveLength(1);
    expect(caught[0]).toMatchObject({ player: 1, by: 0 });
    expect((caught[0] as { loop: number[] }).loop.length).toBeGreaterThanOrEqual(8);
    expect(events.find((e) => e.type === 'death')).toMatchObject({ player: 1, cause: 'encircled', killer: 0 });
    expect(s.snakes[0].crossing).toBe(true);
  });

  it('does nothing to a head just outside the loop', () => {
    const s = scene({ x: 1100, y: 500 });
    const events = drive(s, LAP);
    expect(events.some((e) => e.type === 'encircled')).toBe(false);
    expect(s.snakes[1].alive).toBe(true);
    expect(s.snakes[0].crossing).toBe(true);
  });

  it('cannot catch a Ghost', () => {
    const s = scene({ x: 800, y: 500 }, { pinkGhost: true });
    const events = drive(s, LAP);
    expect(events.some((e) => e.type === 'encircled')).toBe(false);
    expect(s.snakes[1].alive).toBe(true);
  });

  it('pops a Shield instead of killing, without moving the victim', () => {
    const s = scene({ x: 800, y: 500 }, { pinkShield: true });
    const events = drive(s, LAP);
    expect(events.filter((e) => e.type === 'encircled')).toHaveLength(1);
    expect(events.find((e) => e.type === 'shieldBlocked')).toMatchObject({ player: 1, cause: 'encircled' });
    expect(events.some((e) => e.type === 'death')).toBe(false);
    expect(s.snakes[1].alive).toBe(true);
    expect(s.snakes[1].shield).toBe(false);
  });

  it('skimming along your own body after the loop closes does not close it again', () => {
    const s = scene({ x: 800, y: 500 }, { hearts: 2 });
    const c: Config = { ...cfg, hearts: 2 };
    const events = drive(s, LAP + 90, c);
    expect(events.filter((e) => e.type === 'encircled')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'heartLost')).toHaveLength(1);
    expect(s.snakes[1].alive).toBe(true);
    expect(s.snakes[1].hearts).toBe(1);
  });

  it('never triggers from ordinary turning', () => {
    const s = scene({ x: 1200, y: 800 });
    const events: SimEvent[] = [];
    for (let t = 0; t < 4 * TICK_RATE; t++) events.push(...step(s, [right, NO_INPUT], cfg));
    expect(events.some((e) => e.type === 'encircled')).toBe(false);
    expect(s.snakes[0].alive).toBe(true);
  });
});
