import { circleHitsTiles, circleHitsWall } from './arena';
import { forEachSolidPointNear } from './collision';
import { DT, TICK_RATE, type Config } from './config';
import { PI, detCos, detSin } from './detmath';
import { findSpawnPoint } from './pickups';
import { rngRange } from './rng';
import { cutTrail } from './scissors';
import type { MatchState, SawState, SimEvent } from './types';

/** Extra reach beyond the saw's radius plus the head's, so a brush with the teeth counts. */
export const SAW_TOUCH = 2;

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Moves every saw one tick, bouncing off the live border and blocks, one axis at a time. Call before the snakes move. */
export function moveSaws(state: MatchState, cfg: Config): void {
  const R = cfg.sawRadius;
  for (const s of state.saws) {
    const nx = s.x + s.vx * DT;
    if (circleHitsWall(nx, s.y, R, state.inset) || circleHitsTiles(state.tiles, nx, s.y, R)) s.vx = -s.vx;
    else s.x = nx;
    const ny = s.y + s.vy * DT;
    if (circleHitsWall(s.x, ny, R, state.inset) || circleHitsTiles(state.tiles, s.x, ny, R)) s.vy = -s.vy;
    else s.y = ny;
  }
}

/** The live heads a saw is touching this tick. */
export function sawHeads(state: MatchState, cfg: Config): Set<number> {
  const hit = new Set<number>();
  if (state.saws.length === 0) return hit;
  const reach = cfg.sawRadius + cfg.snakeRadius + SAW_TOUCH;
  state.snakes.forEach((s, i) => {
    if (!s.alive) return;
    for (const saw of state.saws) if (dist2(saw.x, saw.y, s.x, s.y) < reach * reach) hit.add(i);
  });
  return hit;
}

/** A saw touching a body cuts it exactly as scissors would (the `cut` event says `by: -1`). Runs after movement, before collisions. */
export function cutBySaws(state: MatchState, cfg: Config, events: SimEvent[]): void {
  if (state.saws.length === 0) return;
  const reach = cfg.sawRadius + cfg.snakeRadius + SAW_TOUCH;
  for (const saw of state.saws) {
    state.snakes.forEach((victim, j) => {
      if (!victim.alive) return;
      let newest = -1;
      forEachSolidPointNear(state, saw.x, saw.y, reach, (snake, index) => {
        if (snake === j && index > newest) newest = index;
      });
      if (newest >= 0) cutTrail(state, j, newest, -1, saw.x, saw.y, cfg, events);
    });
  }
}

/** Ages and removes saws (the border swallowing one removes it too), and spawns one every sawInterval. Call once per playing tick. */
export function updateSaws(state: MatchState, cfg: Config, events: SimEvent[]): void {
  for (const s of state.saws) {
    s.ttl--;
    if (state.inset > 0 && circleHitsWall(s.x, s.y, cfg.sawRadius, state.inset)) s.ttl = 0;
  }
  if (state.saws.some((s) => s.ttl <= 0)) {
    for (const s of state.saws) if (s.ttl <= 0) events.push({ type: 'sawGone', id: s.id });
    state.saws = state.saws.filter((s) => s.ttl > 0);
  }

  if (cfg.sawInterval <= 0) return;
  state.sawTimer--;
  if (state.sawTimer > 0) return;
  state.sawTimer = Math.max(1, Math.round(cfg.sawInterval * TICK_RATE));
  // One at a time.
  if (state.saws.length > 0) return;
  const spot = findSpawnPoint(state, cfg, cfg.sawRadius, cfg.sawMinHeadDistance);
  if (!spot) return;
  const heading = rngRange(state.rng, -PI, PI);
  const saw: SawState = {
    id: state.nextId++,
    x: spot.x,
    y: spot.y,
    vx: detCos(heading) * cfg.sawSpeed,
    vy: detSin(heading) * cfg.sawSpeed,
    ttl: Math.max(1, Math.round(cfg.sawLifetime * TICK_RATE)),
  };
  state.saws.push(saw);
  events.push({ type: 'sawSpawned', id: saw.id, x: saw.x, y: saw.y, vx: saw.vx, vy: saw.vy });
}
