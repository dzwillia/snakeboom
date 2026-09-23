import { describe, expect, it } from 'vitest';
import { setTile } from './arena';
import { detectHit } from './collision';
import { DEFAULT_CONFIG } from './config';
import { createMatch, rebuildGrid } from './state';
import { createTrail, trailPush } from './trail';
import type { MatchState } from './types';

const cfg = DEFAULT_CONFIG;

function playing(): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  return s;
}

function setPath(state: MatchState, idx: number, pts: Array<[number, number]>): void {
  const sn = state.snakes[idx];
  sn.trail = createTrail();
  for (const [x, y] of pts) trailPush(sn.trail, x, y);
  const [hx, hy] = pts[pts.length - 1];
  Object.assign(sn, { x: hx, y: hy, prevX: hx, prevY: hy, targetLength: 1e9 });
  rebuildGrid(state);
}

function line(x0: number, y0: number, x1: number, y1: number, step = 3): Array<[number, number]> {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, k): [number, number] => [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
}

describe('ghost and grace', () => {
  it('a ghost head passes through bodies, its own tail and blocks', () => {
    const s = playing();
    setPath(s, 1, line(300, 600, 700, 600));
    setPath(s, 0, line(500, 400, 500, 598));
    s.snakes[0].effects.ghost = 10;
    expect(detectHit(s, 0, cfg)).toBeNull();
    setTile(s.tiles, 25, 29, true); // x 500..520, y 580..600: right under the head
    expect(detectHit(s, 0, cfg)).toBeNull();
    setPath(s, 0, [...line(200, 300, 400, 300), ...line(400, 312, 250, 312)]);
    expect(detectHit(s, 0, cfg)).toBeNull();
  });

  it('walls still kill a ghost', () => {
    const s = playing();
    setPath(s, 0, line(40, 500, 6, 500));
    s.snakes[0].effects.ghost = 10;
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'wall', killer: null });
  });

  it("a ghost's head is intangible to others, but its body is solid", () => {
    const s = playing();
    setPath(s, 1, line(300, 600, 700, 600));
    s.snakes[1].effects.ghost = 10;
    setPath(s, 0, line(700, 450, 700, 592));
    expect(detectHit(s, 0, cfg)).toBeNull();
    setPath(s, 0, line(500, 450, 500, 592));
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'body', killer: 1 });
  });

  it('grace ignores heads, bodies and blocks, but not walls', () => {
    const s = playing();
    setPath(s, 1, line(300, 600, 700, 600));
    setPath(s, 0, line(500, 400, 500, 590));
    s.snakes[0].effects.grace = 10;
    expect(detectHit(s, 0, cfg)).toBeNull();
    setPath(s, 0, line(40, 300, 6, 300));
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'wall', killer: null });
  });
});
