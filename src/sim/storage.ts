import { circleHitsTiles, circleHitsWall } from './arena';
import { TICK_RATE, type Config } from './config';
import { trailLength } from './trail';
import { clampSelection } from './items';
import type { MatchState, SimEvent, SnakeState } from './types';

/** How many tail points the boost shed may walk forward from the tail to find a clear spot. */
const TAIL_SEARCH_POINTS = 12;

/**
 * Item slots a snake has right now: one per `slotLength` units of body, at least 1 (you can always
 * hold something) and at most `itemSlots`. Counts the trail as laid, not the target, so a cut takes
 * effect at once and new growth has to be laid down before it stores anything.
 */
export function slotsFor(s: SnakeState, cfg: Config): number {
  const cap = Math.max(1, Math.floor(cfg.itemSlots));
  const per = cfg.slotLength > 0 ? Math.floor(trailLength(s.trail) / cfg.slotLength) : cap;
  return Math.min(cap, Math.max(1, per));
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** A pickup can sit here: inside the live area and clear of blocks. */
function landable(state: MatchState, cfg: Config, x: number, y: number): boolean {
  return !circleHitsWall(x, y, cfg.pickupRadius, state.inset) && !circleHitsTiles(state.tiles, x, y, cfg.pickupRadius);
}

/**
 * The point of `path` (flat x,y pairs) nearest index `ideal` where a pickup can land, preferring one
 * at least two pickup radii from every point in `taken`; null when no point of the path qualifies.
 */
function placeAlong(state: MatchState, cfg: Config, path: number[], ideal: number, taken: number[]): { x: number; y: number } | null {
  const n = path.length / 2;
  const apart = 2 * cfg.pickupRadius;
  let fallback: { x: number; y: number } | null = null;
  for (let d = 0; d < n; d++) {
    for (const k of d === 0 ? [ideal] : [ideal + d, ideal - d]) {
      if (k < 0 || k >= n) continue;
      const x = path[2 * k];
      const y = path[2 * k + 1];
      if (!landable(state, cfg, x, y)) continue;
      let clear = true;
      for (let t = 0; t < taken.length; t += 2) if (dist2(x, y, taken[t], taken[t + 1]) < apart * apart) clear = false;
      if (clear) return { x, y };
      if (!fallback) fallback = { x, y };
    }
  }
  return fallback;
}

/** The item to lose next: the one furthest from the selection (what Fire would use), older ones first on a tie. */
export function dropIndex(s: SnakeState): number {
  let best = 0;
  let bestDist = -1;
  for (let i = 0; i < s.items.length; i++) {
    if (i === s.selected) continue;
    const d = Math.abs(i - s.selected);
    if (d > bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Removes the items `player` can no longer carry, furthest from the selected item first (so what
 * you are about to fire survives a cut), and drops each one as a pickup of its kind somewhere along `path` (flat x,y pairs, tail end first): spread evenly along it when
 * `spread` is set, else as near its start as possible. Anyone can take them and they expire as
 * usual. An item with nowhere to land (the whole path is in the dead zone or under blocks) is lost.
 * Returns how many items came off.
 */
export function shedOverflow(state: MatchState, player: number, path: number[], cfg: Config, events: SimEvent[], spread: boolean): number {
  const s = state.snakes[player];
  const excess = s.items.length - slotsFor(s, cfg);
  if (excess <= 0) return 0;
  const points = path.length / 2;
  const taken: number[] = [];
  const ttl = Math.max(1, Math.round(cfg.pickupLifetime * TICK_RATE));
  for (let k = 0; k < excess; k++) {
    const at = dropIndex(s);
    const item = s.items.splice(at, 1)[0];
    if (at < s.selected) s.selected--;
    clampSelection(s);
    if (points === 0) continue;
    const ideal = spread ? Math.round(((k + 1) / (excess + 1)) * (points - 1)) : 0;
    const spot = placeAlong(state, cfg, path, ideal, taken);
    if (!spot) continue;
    taken.push(spot.x, spot.y);
    const id = state.nextId++;
    state.pickups.push({ id, kind: item.kind, x: spot.x, y: spot.y, ttl, dropped: true });
    events.push({ type: 'pickupSpawned', id, kind: item.kind, x: spot.x, y: spot.y, dropped: true });
  }
  return excess;
}

/**
 * Boost burns the tail, and the tail is storage: once the body is short enough that one item
 * no longer fits, the one furthest from the selection falls off at the tail. One length check per boosting snake per tick.
 */
export function shedAtTail(state: MatchState, player: number, cfg: Config, events: SimEvent[]): number {
  const s = state.snakes[player];
  if (s.items.length <= slotsFor(s, cfg)) return 0;
  const t = s.trail;
  const path: number[] = [];
  for (let k = t.start; k < t.xs.length && k < t.start + TAIL_SEARCH_POINTS; k++) path.push(t.xs[k], t.ys[k]);
  return shedOverflow(state, player, path, cfg, events, false);
}
