import { describe, expect, it } from 'vitest';
import { setTile, tileSolid } from './arena';
import { detectHit } from './collision';
import { DEFAULT_CONFIG, TICK_RATE, TILE_COLS, type Config } from './config';
import { plow, PLOW_PUSH_LIMIT } from './dozer';
import { updatePickups } from './pickups';
import { createMatch, rebuildGrid } from './state';
import { step } from './step';
import { createTrail, trailPush } from './trail';
import { NO_INPUT, type MatchState, type SimEvent } from './types';

// One heart: these tests exercise the one-hit death rules (hearts have their own tests).
const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000, hearts: 1 };

/** CYAN dozing at (x, y) facing `heading`. */
function dozing(x: number, y: number, heading: number): MatchState {
  const s = createMatch(cfg, 3);
  s.phase = 'playing';
  const cyan = s.snakes[0];
  cyan.trail = createTrail();
  trailPush(cyan.trail, x, y);
  Object.assign(cyan, { x, y, prevX: x, prevY: y, heading });
  cyan.effects.dozer = 100;
  rebuildGrid(s);
  return s;
}

describe('bulldozer', () => {
  it('shoves a block one tile ahead along the heading', () => {
    const s = dozing(565, 510, 0.1); // mostly east
    setTile(s.tiles, 29, 25, true); // x 580..600, y 500..520: just ahead of the plow
    const version = s.tilesVersion;
    s.snakes[0].x = 568;
    expect(plow(s, 0, cfg)).toEqual({ moved: 1, crushed: [] });
    expect(tileSolid(s.tiles, 29, 25)).toBe(false);
    expect(tileSolid(s.tiles, 30, 25)).toBe(true);
    expect(s.tilesVersion).toBe(version + 1);
  });

  it('shoves a short row of blocks', () => {
    const s = dozing(568, 510, 0);
    for (let tx = 29; tx < 29 + PLOW_PUSH_LIMIT - 1; tx++) setTile(s.tiles, tx, 25, true);
    expect(plow(s, 0, cfg).moved).toBe(1);
    expect(tileSolid(s.tiles, 29, 25)).toBe(false);
    expect(tileSolid(s.tiles, 29 + PLOW_PUSH_LIMIT - 1, 25)).toBe(true);
  });

  it('crushes a block it cannot move: a long row, or the arena edge', () => {
    const long = dozing(568, 510, 0);
    for (let tx = 29; tx <= 29 + PLOW_PUSH_LIMIT; tx++) setTile(long.tiles, tx, 25, true);
    expect(plow(long, 0, cfg)).toEqual({ moved: 0, crushed: [25 * TILE_COLS + 29] });

    const edge = dozing(1575, 510, 0);
    setTile(edge.tiles, 79, 25, true); // the last column
    expect(plow(edge, 0, cfg)).toEqual({ moved: 0, crushed: [25 * TILE_COLS + 79] });
  });

  it('makes the head immune to blocks, but not to walls or bodies', () => {
    const s = dozing(590, 510, 0);
    setTile(s.tiles, 29, 25, true); // the head sits inside it
    expect(detectHit(s, 0, cfg)).toBeNull();
    s.snakes[0].effects.dozer = 0;
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'obstacle', killer: null });
    const wall = dozing(4, 300, Math.PI);
    expect(detectHit(wall, 0, cfg)?.cause).toBe('wall');
  });

  it('can shove a block into the opponent’s head', () => {
    const s = dozing(565, 510, 0);
    setTile(s.tiles, 29, 25, true);
    const pink = s.snakes[1];
    pink.trail = createTrail();
    trailPush(pink.trail, 612, 510);
    Object.assign(pink, { x: 612, y: 510, prevX: 612, prevY: 510, heading: 0 });
    rebuildGrid(s);
    const events: SimEvent[] = [];
    for (let t = 0; t < 3 && !events.some((e) => e.type === 'death'); t++) events.push(...step(s, [NO_INPUT, NO_INPUT], cfg));
    expect(events.find((e) => e.type === 'plowed')).toMatchObject({ player: 0, moved: 1 });
    expect(events.find((e) => e.type === 'death')).toMatchObject({ player: 1, cause: 'obstacle' });
  });

  it('never spawns on a map without blocks', () => {
    const c: Config = {
      ...cfg,
      firstPickupDelay: 0,
      pickupWeights: { bomb: 0, ghost: 0, shield: 0, dozer: 1 },
    };
    const s = createMatch(c, 4);
    s.phase = 'playing';
    const events: SimEvent[] = [];
    for (let t = 0; t < 5 * TICK_RATE; t++) updatePickups(s, c, events);
    expect(s.pickups).toEqual([]);
  });
});
