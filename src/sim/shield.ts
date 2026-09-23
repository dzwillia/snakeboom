import { circleHitsWall, nearestSolidTilePoint } from './arena';
import { forEachSolidPointNear } from './collision';
import { ARENA_HEIGHT, ARENA_WIDTH, TICK_RATE, type Config } from './config';
import { HALF_PI, PI, detAtan2, detCos, detSin } from './detmath';
import { headCum } from './trail';
import type { DeathCause, MatchState, SimEvent, SnakeState } from './types';

/**
 * Pops a Shield bubble to survive `cause`. A blast is simply absorbed; a wall turns the head to
 * slide along it; anything else pushes the head clear and turns it along the surface. A head left
 * crossing a wall either way slides along it too. Grants shieldGrace. Returns false (changing nothing) when the snake holds no Shield.
 */
export function tryShield(state: MatchState, idx: number, cause: DeathCause, cfg: Config, events: SimEvent[]): boolean {
  const s = state.snakes[idx];
  if (!s.shield) return false;
  s.shield = false;
  deflect(state, idx, cause, cfg);
  s.effects.grace = Math.max(1, Math.round(cfg.shieldGrace * TICK_RATE));
  events.push({ type: 'shieldBlocked', player: idx, x: s.x, y: s.y, cause });
  return true;
}

/**
 * Spends a heart to survive `cause` when one would remain: the snake deflects exactly as a Shield
 * would, then gets heartGrace. Returns false (changing nothing) on the last heart.
 */
export function tryHeart(state: MatchState, idx: number, cause: DeathCause, cfg: Config, events: SimEvent[]): boolean {
  const s = state.snakes[idx];
  if (s.hearts <= 1) return false;
  s.hearts--;
  deflect(state, idx, cause, cfg);
  s.effects.grace = Math.max(1, Math.round(cfg.heartGrace * TICK_RATE));
  events.push({ type: 'heartLost', player: idx, heartsLeft: s.hearts, cause, x: s.x, y: s.y });
  return true;
}

/**
 * Blasts leave you where you are and anything but a wall pushes you clear. Then, because grace never
 * covers walls, a head crossing one (hit by it, blasted against it, or pushed into it) slides along it.
 */
function deflect(state: MatchState, idx: number, cause: DeathCause, cfg: Config): void {
  const s = state.snakes[idx];
  if (cause !== 'wall' && cause !== 'blast') pushClear(state, idx, cause, cfg);
  if (cause === 'wall' || circleHitsWall(s.x, s.y, cfg.snakeRadius)) slideAlongWall(s, cfg.snakeRadius);
}

/** The nearest point that blocks the head for `cause` (a head, trail point or block edge), or null. */
export function contactPoint(
  state: MatchState,
  idx: number,
  cause: DeathCause,
  cfg: Config,
): { x: number; y: number } | null {
  const me = state.snakes[idx];
  const touch = 2 * cfg.snakeRadius;
  if (cause === 'obstacle') return nearestSolidTilePoint(state.tiles, me.x, me.y, cfg.snakeRadius);
  const found = { x: 0, y: 0, d: Infinity };
  const consider = (x: number, y: number) => {
    const dx = x - me.x;
    const dy = y - me.y;
    const d = dx * dx + dy * dy;
    if (d < found.d) {
      found.x = x;
      found.y = y;
      found.d = d;
    }
  };
  if (cause === 'headOn') {
    state.snakes.forEach((o, j) => {
      const dx = o.x - me.x;
      const dy = o.y - me.y;
      if (j !== idx && o.alive && dx * dx + dy * dy < touch * touch) consider(o.x, o.y);
    });
  } else if (cause === 'body' || cause === 'self') {
    const neckStart = headCum(me.trail) - cfg.neckLength;
    forEachSolidPointNear(state, me.x, me.y, touch, (snake, i) => {
      const t = state.snakes[snake].trail;
      const blocks = cause === 'self' ? snake === idx && t.cum[i] < neckStart : snake !== idx;
      if (blocks) consider(t.xs[i], t.ys[i]);
    });
  }
  return found.d < Infinity ? { x: found.x, y: found.y } : null;
}

function clampInside(s: SnakeState, r: number): void {
  const m = r + 0.5;
  s.x = Math.min(Math.max(s.x, m), ARENA_WIDTH - m);
  s.y = Math.min(Math.max(s.y, m), ARENA_HEIGHT - m);
}

function slideAlongWall(s: SnakeState, r: number): void {
  const left = s.x - r < 0;
  const right = s.x + r > ARENA_WIDTH;
  const top = s.y - r < 0;
  const bottom = s.y + r > ARENA_HEIGHT;
  clampInside(s, r);
  const hx = detCos(s.heading);
  const hy = detSin(s.heading);
  if ((left || right) && (top || bottom)) s.heading = detAtan2(top ? 1 : -1, left ? 1 : -1);
  else if (left || right) s.heading = hy >= 0 ? HALF_PI : -HALF_PI;
  else if (top || bottom) s.heading = hx >= 0 ? 0 : PI;
  s.prevX = s.x;
  s.prevY = s.y;
}

function pushClear(state: MatchState, idx: number, cause: DeathCause, cfg: Config): void {
  const s = state.snakes[idx];
  const r = cfg.snakeRadius;
  const c = contactPoint(state, idx, cause, cfg);
  if (c) {
    let nx = s.x - c.x;
    let ny = s.y - c.y;
    const len = Math.sqrt(nx * nx + ny * ny);
    if (len > 1e-9) {
      nx /= len;
      ny /= len;
    } else {
      nx = -detCos(s.heading);
      ny = -detSin(s.heading);
    }
    const clearance = (cause === 'obstacle' ? r : 2 * r) + 0.5;
    s.x = c.x + nx * clearance;
    s.y = c.y + ny * clearance;
    // Slide along the surface: of the two tangents, take the one closest to the old heading.
    const hx = detCos(s.heading);
    const hy = detSin(s.heading);
    let tx = -ny;
    let ty = nx;
    if (tx * hx + ty * hy < 0) {
      tx = -tx;
      ty = -ty;
    }
    s.heading = detAtan2(ty, tx);
  }
  s.prevX = s.x;
  s.prevY = s.y;
}
