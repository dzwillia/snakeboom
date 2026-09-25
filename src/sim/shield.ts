import { circleHitsWall, nearestSolidTilePoint } from './arena';
import { forEachSolidPointNear } from './collision';
import { ARENA_HEIGHT, ARENA_WIDTH, TICK_RATE, type Config } from './config';
import { HALF_PI, PI, detAtan2, detCos, detSin } from './detmath';
import { SAW_TOUCH } from './saws';
import type { DeathCause, MatchState, SimEvent, SnakeState } from './types';

/** tan(35°): how far a deflection off the moving border points inward. */
const BORDER_TILT = 0.7;

/**
 * Pops a Shield bubble to survive `cause`. A missile is simply absorbed; a wall turns the head to
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
 * Missiles leave you where you are and anything but a wall pushes you clear. Then, because grace never
 * covers walls, a head crossing one (hit by it, or pushed into it) slides along it.
 */
function deflect(state: MatchState, idx: number, cause: DeathCause, cfg: Config): void {
  const s = state.snakes[idx];
  if (cause !== 'wall' && cause !== 'missile' && cause !== 'encircled') pushClear(state, idx, cause, cfg);
  if (cause === 'wall' || circleHitsWall(s.x, s.y, cfg.snakeRadius, state.inset)) slideAlongWall(s, cfg.snakeRadius, state.inset);
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
  if (cause === 'saw') {
    for (const saw of state.saws) {
      const dx = saw.x - me.x;
      const dy = saw.y - me.y;
      const d = dx * dx + dy * dy;
      if (d < found.d) {
        found.x = saw.x;
        found.y = saw.y;
        found.d = d;
      }
    }
    return found.d < Infinity ? { x: found.x, y: found.y } : null;
  }
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
  } else if (cause === 'body') {
    forEachSolidPointNear(state, me.x, me.y, touch, (snake, i) => {
      if (snake === idx) return;
      const t = state.snakes[snake].trail;
      consider(t.xs[i], t.ys[i]);
    });
  }
  return found.d < Infinity ? { x: found.x, y: found.y } : null;
}

function clampInside(s: SnakeState, r: number, inset: number): void {
  const m = r + 0.5 + inset;
  s.x = Math.min(Math.max(s.x, m), ARENA_WIDTH - m);
  s.y = Math.min(Math.max(s.y, m), ARENA_HEIGHT - m);
}

function slideAlongWall(s: SnakeState, r: number, inset: number): void {
  const left = s.x - r < inset;
  const right = s.x + r > ARENA_WIDTH - inset;
  const top = s.y - r < inset;
  const bottom = s.y + r > ARENA_HEIGHT - inset;
  clampInside(s, r, inset);
  const hx = detCos(s.heading);
  const hy = detSin(s.heading);
  if ((left || right) && (top || bottom)) s.heading = detAtan2(top ? 1 : -1, left ? 1 : -1);
  else if (left || right) s.heading = hy >= 0 ? HALF_PI : -HALF_PI;
  else if (top || bottom) s.heading = hx >= 0 ? 0 : PI;
  // Off a moving border, sliding along it means being hit again in moments: angle inward instead.
  if (inset > 0 && !((left || right) && (top || bottom))) {
    const nx = left ? 1 : right ? -1 : 0;
    const ny = top ? 1 : bottom ? -1 : 0;
    s.heading = detAtan2(detSin(s.heading) + BORDER_TILT * ny, detCos(s.heading) + BORDER_TILT * nx);
  }
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
    const clearance = (cause === 'obstacle' ? r : cause === 'saw' ? cfg.sawRadius + r + SAW_TOUCH : 2 * r) + 0.5;
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
