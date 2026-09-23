import { describe, expect, it } from 'vitest';
import { setTile } from './arena';
import { detectHit, type Hit } from './collision';
import { DEFAULT_CONFIG, TICK_RATE } from './config';
import { advanceSnake } from './snake';
import { createMatch, rebuildGrid } from './state';
import { createTrail, trailPush } from './trail';
import type { MatchState, PlayerInput } from './types';

const cfg = DEFAULT_CONFIG;
const turnRight: PlayerInput = { turn: 1, boost: false, use: false };

function playing(): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  return s;
}

/** Replaces snake idx's trail with the given points; the head is the last point. */
function setPath(state: MatchState, idx: number, pts: Array<[number, number]>): void {
  const sn = state.snakes[idx];
  sn.trail = createTrail();
  for (const [x, y] of pts) trailPush(sn.trail, x, y);
  const [hx, hy] = pts[pts.length - 1];
  sn.x = hx;
  sn.y = hy;
  sn.prevX = hx;
  sn.prevY = hy;
  sn.targetLength = 1e9;
  rebuildGrid(state);
}

function line(x0: number, y0: number, x1: number, y1: number, step = 3): Array<[number, number]> {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, k): [number, number] => [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
}

describe('detectHit', () => {
  it('reports nothing in open space', () => {
    expect(detectHit(playing(), 0, cfg)).toBeNull();
  });

  it('kills on the arena wall', () => {
    const s = playing();
    setPath(s, 0, line(40, 500, 6, 500));
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'wall', killer: null });
  });

  it('kills on solid tiles', () => {
    const s = playing();
    setTile(s.tiles, 30, 20, true); // x 600..620, y 400..420
    setPath(s, 0, line(560, 410, 605, 410));
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'obstacle', killer: null });
  });

  it("kills on the other snake's body and names its owner", () => {
    const s = playing();
    setPath(s, 1, line(300, 600, 700, 600));
    setPath(s, 0, line(500, 400, 500, 590));
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'body', killer: 1 });
  });

  it('kills on your own body beyond the neck', () => {
    const s = playing();
    setPath(s, 0, [...line(200, 300, 400, 300), ...line(400, 312, 250, 312)]);
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'self', killer: 0 });
  });

  it('ignores your own neck', () => {
    const s = playing();
    setPath(s, 0, line(200, 300, 400, 300));
    expect(detectHit(s, 0, cfg)).toBeNull();
  });

  it('reports head-on for both snakes, ahead of body hits', () => {
    const s = playing();
    setPath(s, 0, line(300, 500, 495, 500));
    setPath(s, 1, line(700, 500, 505, 500));
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'headOn', killer: 1 });
    expect(detectHit(s, 1, cfg)).toEqual({ cause: 'headOn', killer: 0 });
  });

  it('ignores holes and trimmed points', () => {
    const s = playing();
    setPath(s, 1, line(300, 600, 700, 600));
    setPath(s, 0, line(500, 400, 500, 590));
    const t = s.snakes[1].trail;
    for (let i = 0; i < t.xs.length; i++) if (Math.abs(t.xs[i] - 500) < 20) t.solid[i] = false;
    expect(detectHit(s, 0, cfg)).toBeNull();
    t.solid.fill(true);
    t.start = t.xs.length - 1;
    expect(detectHit(s, 0, cfg)).toBeNull();
  });

  it('never clips its own neck while turning at the maximum rate', () => {
    const s = playing();
    for (let t = 0; t < 3 * TICK_RATE; t++) {
      advanceSnake(s.snakes[0], 0, turnRight, cfg, 0, s.grid);
      expect(detectHit(s, 0, cfg)).toBeNull();
    }
  });

  it('hits its own tail when circling with a body longer than the circle', () => {
    const s = playing();
    s.snakes[0].targetLength = 400;
    let hit: Hit | null = null;
    for (let t = 0; t < 3 * TICK_RATE && !hit; t++) {
      advanceSnake(s.snakes[0], 0, turnRight, cfg, 0, s.grid);
      hit = detectHit(s, 0, cfg);
    }
    expect(hit).toEqual({ cause: 'self', killer: 0 });
  });
});
