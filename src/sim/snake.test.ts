import { describe, expect, it } from 'vitest';
import { ARENA_HEIGHT, ARENA_WIDTH, DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { createGrid, gridQuery } from './grid';
import { advanceSnake, createSnake, growthRate } from './snake';
import { trailLength } from './trail';
import type { PlayerInput } from './types';

const cfg: Config = { ...DEFAULT_CONFIG };
const straight: PlayerInput = { turn: 0, boost: false, use: false };

function run(ticks: number, input: PlayerInput, c: Config = cfg, growth = 0) {
  const s = createSnake(0, 800, 500, 0, c);
  const grid = createGrid(ARENA_WIDTH, ARENA_HEIGHT);
  let starts = 0;
  for (let i = 0; i < ticks; i++) if (advanceSnake(s, 0, input, c, growth, grid)) starts++;
  return { s, grid, starts };
}

function circumradius(a: [number, number], b: [number, number], c: [number, number]): number {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const twiceArea = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return (ab * bc * ca) / (2 * twiceArea);
}

describe('snake movement', () => {
  it('moves baseSpeed units per second in a straight line', () => {
    const { s } = run(TICK_RATE, straight);
    expect(s.x).toBeCloseTo(800 + cfg.baseSpeed, 9);
    expect(s.y).toBeCloseTo(500, 9);
  });

  it('records the previous head position for interpolation', () => {
    const { s } = run(1, straight);
    expect(s.prevX).toBe(800);
    expect(s.x).toBeCloseTo(800 + cfg.baseSpeed / TICK_RATE, 9);
  });

  it('turns right (toward +y) on a circle of radius baseSpeed / turnRate', () => {
    const { s } = run(80, { ...straight, turn: 1 }, { ...cfg, startLength: 1e6 });
    const t = s.trail;
    const p = (i: number): [number, number] => [t.xs[i], t.ys[i]];
    expect(circumradius(p(10), p(40), p(70))).toBeCloseTo(cfg.baseSpeed / cfg.turnRate, 1);
    expect(t.ys[20]).toBeGreaterThan(500);
  });

  it('boosts at boostMultiplier speed and drains the meter over boostMeterSeconds', () => {
    const { s, starts } = run(TICK_RATE, { ...straight, boost: true });
    expect(s.x).toBeCloseTo(800 + cfg.baseSpeed * cfg.boostMultiplier, 6);
    expect(s.boostMeter).toBeCloseTo(1 - 1 / cfg.boostMeterSeconds, 9);
    expect(starts).toBe(1);
  });

  it('stops boosting when empty and refills only while the key is released', () => {
    const s = createSnake(0, 100, 500, 0, cfg);
    const grid = createGrid(ARENA_WIDTH, ARENA_HEIGHT);
    const hold: PlayerInput = { ...straight, boost: true };
    for (let i = 0; i < 125; i++) advanceSnake(s, 0, hold, cfg, 0, grid);
    expect(s.boostMeter).toBe(0);
    expect(s.boosting).toBe(false);
    advanceSnake(s, 0, hold, cfg, 0, grid);
    expect(s.boostMeter).toBe(0);
    for (let i = 0; i < 3 * TICK_RATE; i++) advanceSnake(s, 0, straight, cfg, 0, grid);
    expect(s.boostMeter).toBeCloseTo(3 / cfg.boostRefillSeconds, 9);
  });

  it('grows at growthPerSecond, faster in overtime', () => {
    expect(growthRate(cfg, false)).toBe(cfg.growthPerSecond);
    expect(growthRate(cfg, true)).toBe(cfg.growthPerSecond * cfg.overtimeGrowthMultiplier);
    const { s } = run(TICK_RATE, straight, cfg, growthRate(cfg, false));
    expect(s.targetLength).toBeCloseTo(cfg.startLength + cfg.growthPerSecond, 9);
  });

  it('keeps the trail no longer than the target length', () => {
    const { s } = run(5 * TICK_RATE, straight, cfg, growthRate(cfg, false));
    expect(trailLength(s.trail)).toBeLessThanOrEqual(s.targetLength);
    expect(trailLength(s.trail)).toBeGreaterThan(s.targetLength - 5);
  });

  it('indexes every new trail point in the grid', () => {
    const { s, grid } = run(1, straight);
    const seen: number[] = [];
    gridQuery(grid, s.x, s.y, 1, (_snake, seq) => seen.push(seq));
    expect(seen).toContain(1);
  });
});
