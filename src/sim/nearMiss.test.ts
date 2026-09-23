import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { detectNearMisses, NEAR_MISS_COOLDOWN, NEAR_MISS_MARGIN } from './nearMiss';
import { createMatch, rebuildGrid } from './state';
import { createTrail, trailPush } from './trail';
import type { MatchState, SimEvent } from './types';

const cfg = DEFAULT_CONFIG;
const touch = 2 * cfg.snakeRadius;

/** PINK's body runs along y = 600; CYAN's head sits `gap` above it. */
function skimming(gap: number): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  const pink = s.snakes[1];
  pink.trail = createTrail();
  for (let x = 300; x <= 900; x += 3) trailPush(pink.trail, x, 600);
  Object.assign(pink, { x: 900, y: 600 });
  const cyan = s.snakes[0];
  cyan.trail = createTrail();
  for (let x = 400; x <= 600; x += 3) trailPush(cyan.trail, x, 600 - gap);
  Object.assign(cyan, { x: 598, y: 600 - gap });
  rebuildGrid(s);
  return s;
}

function detect(s: MatchState): SimEvent[] {
  const events: SimEvent[] = [];
  detectNearMisses(s, cfg, events);
  return events;
}

describe('near misses', () => {
  it('reports a head skimming the other snake’s body', () => {
    const s = skimming(touch + NEAR_MISS_MARGIN - 1);
    expect(detect(s)).toEqual([{ type: 'nearMiss', player: 0, x: 598, y: 600 - (touch + NEAR_MISS_MARGIN - 1) }]);
  });

  it('ignores bodies farther than the margin', () => {
    expect(detect(skimming(touch + NEAR_MISS_MARGIN + 1))).toEqual([]);
  });

  // Review Focus 1: skimming along a body must not fire every tick.
  it('waits NEAR_MISS_COOLDOWN ticks before reporting the same snake again', () => {
    const s = skimming(touch + 2);
    expect(detect(s)).toHaveLength(1);
    for (let t = 0; t < NEAR_MISS_COOLDOWN; t++) expect(detect(s)).toEqual([]);
    expect(detect(s)).toHaveLength(1);
  });

  it('ignores your own body, ghosts and dead snakes', () => {
    const own = createMatch(cfg, 1);
    own.phase = 'playing';
    const cyan = own.snakes[0];
    cyan.trail = createTrail();
    for (let x = 200; x <= 400; x += 3) trailPush(cyan.trail, x, 300);
    for (let x = 400; x >= 250; x -= 3) trailPush(cyan.trail, x, 318);
    Object.assign(cyan, { x: 250, y: 318 });
    rebuildGrid(own);
    expect(detect(own)).toEqual([]);

    const ghost = skimming(touch + 2);
    ghost.snakes[0].effects.ghost = 10;
    expect(detect(ghost)).toEqual([]);

    const dead = skimming(touch + 2);
    dead.snakes[0].alive = false;
    expect(detect(dead)).toEqual([]);
  });
});
