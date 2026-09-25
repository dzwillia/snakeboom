import { circleHitsTiles, circleHitsWall } from './arena';
import type { Config } from './config';
import { gridQuery } from './grid';
import { headCum } from './trail';
import type { DeathCause, MatchState, SnakeState } from './types';

export interface Hit {
  cause: DeathCause;
  killer: number | null;
}

/** Visits each live, solid trail point strictly within `radius` of (x, y). Order is unspecified. */
export function forEachSolidPointNear(
  state: MatchState,
  x: number,
  y: number,
  radius: number,
  visit: (snake: number, index: number) => void,
): void {
  const r2 = radius * radius;
  gridQuery(state.grid, x, y, radius, (snake, seq) => {
    const t = state.snakes[snake].trail;
    const i = seq - t.baseSeq;
    if (i < t.start || i >= t.xs.length || !t.solid[i]) return;
    const dx = t.xs[i] - x;
    const dy = t.ys[i] - y;
    if (dx * dx + dy * dy < r2) visit(snake, i);
  });
}

/** Ghosts and snakes in Shield grace ignore everything except walls. */
export function isProtected(s: SnakeState): boolean {
  return s.effects.ghost > 0 || s.effects.grace > 0;
}

/**
 * Checks one live head against heads, bodies, blocks and walls (blasts are resolved elsewhere).
 * Priority: headOn > body > self > obstacle > wall. Ties pick the lowest snake index, so the
 * result never depends on grid visit order. A ghost's head (its newest 2r of path) is
 * intangible to others; the rest of its body is solid. A bulldozing head ignores blocks.
 */
export function detectHit(state: MatchState, idx: number, cfg: Config): Hit | null {
  const me = state.snakes[idx];
  const r = cfg.snakeRadius;
  const touch = 2 * r;

  if (!isProtected(me)) {
    let headOn = -1;
    for (let j = 0; j < state.snakes.length; j++) {
      const other = state.snakes[j];
      if (j === idx || !other.alive || other.effects.ghost > 0) continue;
      const dx = other.x - me.x;
      const dy = other.y - me.y;
      if (dx * dx + dy * dy < touch * touch && (headOn < 0 || j < headOn)) headOn = j;
    }
    if (headOn >= 0) return { cause: 'headOn', killer: headOn };

    const neckStart = headCum(me.trail) - cfg.neckLength;
    const ghostHeadFrom = state.snakes.map((o) => (o.effects.ghost > 0 ? headCum(o.trail) - touch : Infinity));
    const found = { body: -1, self: false };
    forEachSolidPointNear(state, me.x, me.y, touch, (snake, i) => {
      if (snake === idx) {
        if (me.trail.cum[i] < neckStart) found.self = true;
        return;
      }
      if (state.snakes[snake].trail.cum[i] >= ghostHeadFrom[snake]) return;
      if (found.body < 0 || snake < found.body) found.body = snake;
    });
    if (found.body >= 0) return { cause: 'body', killer: found.body };
    if (found.self) return { cause: 'self', killer: idx };
    if (me.effects.dozer <= 0 && circleHitsTiles(state.tiles, me.x, me.y, r)) return { cause: 'obstacle', killer: null };
  }

  // The real wall ignores grace. The moving border doesn't: a deflection off it would otherwise cost
  // every heart in three ticks, since the border keeps coming while the head slides along it.
  if (circleHitsWall(me.x, me.y, r, state.inset)) {
    if (state.inset > 0 && me.effects.grace > 0) return null;
    return { cause: 'wall', killer: null };
  }
  return null;
}
