import { describe, expect, it } from 'vitest';
import { setTile, tileSolid } from './arena';
import { updateBombs } from './bombs';
import { DEFAULT_CONFIG, TICK_RATE } from './config';
import { createMatch, rebuildGrid } from './state';
import { createTrail, trailPush } from './trail';
import type { BombState, MatchState, SimEvent } from './types';

const cfg = DEFAULT_CONFIG;
const FUSE = Math.round(cfg.bombFuse * TICK_RATE);
const CHAIN = Math.round(cfg.chainDelay * TICK_RATE);

function playing(): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  return s;
}

function bomb(id: number, x: number, y: number, owner = 0, fuse = FUSE): BombState {
  return { id, owner, x, y, fuse, maxFuse: fuse, chainDepth: 0 };
}

function run(s: MatchState, ticks: number) {
  const events: SimEvent[] = [];
  const blasted = new Map<number, number>();
  for (let t = 0; t < ticks; t++) for (const [victim, killer] of updateBombs(s, cfg, events)) blasted.set(victim, killer);
  return { events, blasted };
}

function placeHead(s: MatchState, idx: number, x: number, y: number): void {
  const sn = s.snakes[idx];
  sn.trail = createTrail();
  trailPush(sn.trail, x, y);
  sn.x = x;
  sn.y = y;
  rebuildGrid(s);
}

const explosionIds = (events: SimEvent[]) => events.flatMap((e) => (e.type === 'explosion' ? [e.id] : []));

describe('bombs', () => {
  it('explodes after bombFuse and reports the blast', () => {
    const s = playing();
    s.bombs = [bomb(9, 800, 500)];
    expect(run(s, FUSE - 1).events).toEqual([]);
    expect(run(s, 1).events).toEqual([
      { type: 'explosion', id: 9, owner: 0, x: 800, y: 500, radius: cfg.blastRadius, chainDepth: 0, tilesDestroyed: [] },
    ]);
    expect(s.bombs).toEqual([]);
  });

  it('catches every head in range, including the owner, naming the owner as killer', () => {
    const s = playing();
    placeHead(s, 0, 800 + cfg.blastRadius, 500);
    placeHead(s, 1, 800, 500 - cfg.blastRadius - cfg.snakeRadius - 1);
    s.bombs = [bomb(1, 800, 500, 0, 1)];
    expect([...run(s, 1).blasted]).toEqual([[0, 0]]);
    expect(s.snakes[0].alive).toBe(true);
  });

  it('punches a hole in every trail it reaches and bumps holeVersion', () => {
    const s = playing();
    const sn = s.snakes[1];
    sn.trail = createTrail();
    for (let x = 600; x <= 1000; x += 4) trailPush(sn.trail, x, 700);
    sn.x = 1000;
    sn.y = 700;
    rebuildGrid(s);
    s.bombs = [bomb(1, 800, 700, 0, 1)];
    run(s, 1);
    const t = sn.trail;
    const holes = t.xs.filter((_, i) => !t.solid[i]);
    expect(Math.min(...holes)).toBeGreaterThan(800 - cfg.blastRadius - cfg.snakeRadius);
    expect(Math.max(...holes)).toBeLessThan(800 + cfg.blastRadius + cfg.snakeRadius);
    expect(holes.length).toBeGreaterThan(30);
    expect(sn.holeVersion).toBe(1);
    expect(s.snakes[0].holeVersion).toBe(0);
  });

  it('destroys blocks and bumps tilesVersion', () => {
    const s = playing();
    setTile(s.tiles, 40, 25, true);
    const version = s.tilesVersion;
    s.bombs = [bomb(1, 790, 490, 0, 1)];
    const { events } = run(s, 1);
    expect(tileSolid(s.tiles, 40, 25)).toBe(false);
    expect(events[0]).toMatchObject({ tilesDestroyed: [25 * 80 + 40] });
    expect(s.tilesVersion).toBe(version + 1);
  });

  it('sets off nearby bombs after chainDelay, one link deeper', () => {
    const s = playing();
    s.bombs = [bomb(1, 800, 500, 0, 1), bomb(2, 850, 500, 1), bomb(3, 1200, 500, 1)];
    expect(explosionIds(run(s, 1).events)).toEqual([1]);
    expect(s.bombs.find((b) => b.id === 2)).toMatchObject({ fuse: CHAIN, chainDepth: 1 });
    expect(s.bombs.find((b) => b.id === 3)?.fuse).toBe(FUSE - 1);
    const chain = run(s, CHAIN);
    expect(chain.events).toEqual([expect.objectContaining({ type: 'explosion', id: 2, chainDepth: 1 })]);
  });

  // Review Focus 2: a pile of bombs must not re-trigger forever.
  it('explodes each bomb in a pile exactly once', () => {
    const s = playing();
    s.bombs = Array.from({ length: 10 }, (_, k) => bomb(k + 1, 800 + k, 500, 0, k === 0 ? 1 : FUSE));
    const { events } = run(s, CHAIN + 2);
    expect(explosionIds(events).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.bombs).toEqual([]);
  });
});
