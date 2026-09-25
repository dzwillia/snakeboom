import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { createItem, useItem } from './items';
import { createMatch } from './state';
import { step } from './step';
import { trailLength } from './trail';
import { NO_INPUT, type MatchState, type PlayerInput, type SimEvent } from './types';

const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000, hearts: 1, borderCloseSeconds: 0 };
const straight: PlayerInput = { turn: 0, boost: false, use: false };

/** PINK has laid a long horizontal body along y = 500 from x = 300 to 900 and is heading away east; CYAN comes down from above to cross it at x = 600. */
function crossing(): MatchState {
  const s = createMatch(cfg, 3);
  s.phase = 'playing';
  s.phaseTicks = 0;
  const pink = s.snakes[1];
  Object.assign(pink, { x: 300, y: 500, prevX: 300, prevY: 500, heading: 0, targetLength: 5000 });
  for (let t = 0; t < 130; t++) step(s, [NO_INPUT, straight], cfg);
  // CYAN was moving too; park it above the body, heading down.
  Object.assign(s.snakes[0], { x: 600, y: 440, prevX: 600, prevY: 440, heading: Math.PI / 2 });
  return s;
}

function run(s: MatchState, ticks: number, inputs: PlayerInput[] = [straight, straight]): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) out.push(...step(s, inputs, cfg));
  return out;
}

describe('scissors', () => {
  it('is a timed special that reports starting and ending', () => {
    const s = crossing();
    s.snakes[0].items = [createItem('scissors', cfg)];
    const events: SimEvent[] = [];
    useItem(s, 0, cfg, events);
    expect(events).toEqual([
      { type: 'itemUsed', player: 0, kind: 'scissors' },
      { type: 'effectStarted', player: 0, effect: 'scissors' },
    ]);
    expect(s.snakes[0].effects.scissors).toBe(Math.round(cfg.scissorsDuration * TICK_RATE));
  });

  it('without scissors, crossing the body kills', () => {
    const s = crossing();
    const events = run(s, 30);
    expect(events.find((e) => e.type === 'death')).toMatchObject({ player: 0, cause: 'body', killer: 1 });
  });

  it('with scissors, the cutter passes through and the victim loses everything behind the cut', () => {
    const s = crossing();
    const pink = s.snakes[1];
    const before = trailLength(pink.trail);
    s.snakes[0].effects.scissors = 10_000;
    const events = run(s, 30);
    expect(events.some((e) => e.type === 'death')).toBe(false);
    const cut = events.find((e) => e.type === 'cut') as { player: number; by: number; dropped: number; segment: number[] } | undefined;
    expect(cut).toMatchObject({ player: 1, by: 0 });
    expect(cut!.dropped).toBeGreaterThan(250);
    expect(cut!.segment.length).toBeGreaterThanOrEqual(4);
    expect(trailLength(pink.trail)).toBeLessThan(before - 250);
    // Growth resumes from what is left (a few units accrue in the ticks after the cut).
    expect(pink.targetLength - trailLength(pink.trail)).toBeLessThan(30);
    expect(pink.alive).toBe(true);
    expect(s.snakes[0].alive).toBe(true);
    // The remaining body starts just past the cut, on the victim's head side.
    expect(pink.trail.xs[pink.trail.start]).toBeGreaterThan(600);
  });

  it('never cuts the head itself: touching it is still a head-on', () => {
    const s = crossing();
    const pink = s.snakes[1];
    const cyan = s.snakes[0];
    cyan.effects.scissors = 10_000;
    Object.assign(cyan, { x: pink.x + 30, y: pink.y, prevX: pink.x + 30, prevY: pink.y, heading: Math.PI });
    const events = run(s, 6);
    const deaths = events.filter((e) => e.type === 'death');
    expect(deaths.map((d) => (d as { cause: string }).cause)).toEqual(['headOn', 'headOn']);
    expect(events.some((e) => e.type === 'cut')).toBe(false);
  });

  it('still dies to walls while cutting', () => {
    const s = crossing();
    const cyan = s.snakes[0];
    cyan.effects.scissors = 10_000;
    Object.assign(cyan, { x: 20, y: 300, prevX: 20, prevY: 300, heading: Math.PI });
    const events = run(s, 10);
    expect(events.find((e) => e.type === 'death')).toMatchObject({ player: 0, cause: 'wall' });
  });

  it('a Ghost victim’s body is still cut, and a cut kills the loop it was drawing', () => {
    const s = crossing();
    const pink = s.snakes[1];
    pink.effects.ghost = 10_000;
    s.snakes[0].effects.scissors = 10_000;
    const events = run(s, 30);
    expect(events.some((e) => e.type === 'cut')).toBe(true);
    expect(pink.alive).toBe(true);
    expect(trailLength(pink.trail)).toBeLessThan(400);
  });

  it('stops working when it wears off', () => {
    const s = crossing();
    s.snakes[0].effects.scissors = 2;
    const events = run(s, 30);
    expect(events.filter((e) => e.type === 'effectEnded').map((e) => (e as { effect: string }).effect)).toEqual(['scissors']);
    expect(events.find((e) => e.type === 'death')).toMatchObject({ player: 0, cause: 'body' });
  });
});
