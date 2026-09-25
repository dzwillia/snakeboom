import { circleHitsWall } from './arena';
import { TICK_RATE, type Config } from './config';
import { findSpawnPoint } from './pickups';
import { trailJump } from './trail';
import type { MatchState, SimEvent, WormholeState } from './types';

/** Tries at placing the exit far enough from the portal before giving up on this spawn. */
const EXIT_TRIES = 12;
/** Extra reach beyond the portal radius plus the head's, so a brush with the rim counts. */
export const WORMHOLE_TOUCH = 2;

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Heads on a portal go through: the head appears at the exit with its heading, the trail gets
 * a jump (no body along the way), and a cooldown stops the same head going straight back in.
 * Runs after movement and before collisions.
 */
export function enterWormholes(state: MatchState, cfg: Config, events: SimEvent[]): void {
  if (state.wormholes.length === 0) return;
  const reach = cfg.wormholeRadius + cfg.snakeRadius + WORMHOLE_TOUCH;
  state.snakes.forEach((s, i) => {
    if (!s.alive || s.portalCooldown > 0) return;
    for (const w of state.wormholes) {
      if (dist2(s.x, s.y, w.x, w.y) >= reach * reach) continue;
      const fromX = s.x;
      const fromY = s.y;
      s.x = w.exitX;
      s.y = w.exitY;
      s.prevX = s.x;
      s.prevY = s.y;
      trailJump(s.trail, s.x, s.y);
      s.crossing = false;
      s.portalCooldown = Math.max(1, Math.round(cfg.portalCooldown * TICK_RATE));
      events.push({ type: 'warped', player: i, id: w.id, fromX, fromY, x: s.x, y: s.y });
      return;
    }
  });
}

/** Ages and closes wormholes, counts down portal cooldowns, and opens a new one every wormholeInterval. */
export function updateWormholes(state: MatchState, cfg: Config, events: SimEvent[]): void {
  for (const s of state.snakes) if (s.portalCooldown > 0) s.portalCooldown--;

  for (const w of state.wormholes) {
    w.ttl--;
    // The border swallowing either end closes it.
    if (state.inset > 0 && (circleHitsWall(w.x, w.y, cfg.wormholeRadius, state.inset) || circleHitsWall(w.exitX, w.exitY, cfg.wormholeRadius, state.inset))) w.ttl = 0;
  }
  if (state.wormholes.some((w) => w.ttl <= 0)) {
    for (const w of state.wormholes) if (w.ttl <= 0) events.push({ type: 'wormholeClosed', id: w.id });
    state.wormholes = state.wormholes.filter((w) => w.ttl > 0);
  }

  if (cfg.wormholeInterval <= 0) return;
  state.wormholeTimer--;
  if (state.wormholeTimer > 0) return;
  state.wormholeTimer = Math.max(1, Math.round(cfg.wormholeInterval * TICK_RATE));
  // One at a time.
  if (state.wormholes.length > 0) return;
  const spot = openWormhole(state, cfg);
  if (!spot) return;
  state.wormholes.push(spot);
  events.push({ type: 'wormholeOpened', id: spot.id, x: spot.x, y: spot.y, exitX: spot.exitX, exitY: spot.exitY });
}

/** A portal at a clear spot and an exit at another, at least wormholeMinJump away; null when the arena has no room. */
function openWormhole(state: MatchState, cfg: Config): WormholeState | null {
  const portal = findSpawnPoint(state, cfg, cfg.wormholeRadius);
  if (!portal) return null;
  const minJump = cfg.wormholeMinJump;
  for (let t = 0; t < EXIT_TRIES; t++) {
    const exit = findSpawnPoint(state, cfg, cfg.wormholeRadius);
    if (!exit) return null;
    if (dist2(exit.x, exit.y, portal.x, portal.y) < minJump * minJump) continue;
    return {
      id: state.nextId++,
      x: portal.x,
      y: portal.y,
      exitX: exit.x,
      exitY: exit.y,
      ttl: Math.max(1, Math.round(cfg.wormholeLifetime * TICK_RATE)),
    };
  }
  return null;
}
