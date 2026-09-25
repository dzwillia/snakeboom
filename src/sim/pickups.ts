import { circleHitsTiles } from './arena';
import { forEachSolidPointNear } from './collision';
import { circleHitsWall } from './arena';
import { ARENA_HEIGHT, ARENA_WIDTH, TICK_RATE, type Config, type PickupKind } from './config';
import { createItem } from './items';
import { rngNext, rngRange, type RngState } from './rng';
import type { MatchState, PickupState, SimEvent, SnakeState } from './types';

const SPAWN_TRIES = 50;

function dist2(p: { x: number; y: number }, x: number, y: number): number {
  const dx = p.x - x;
  const dy = p.y - y;
  return dx * dx + dy * dy;
}

/** Weighted random kind among positive weights (in key order); null when none is positive. */
export function pickKind(weights: Record<PickupKind, number>, rng: RngState): PickupKind | null {
  const kinds = (Object.keys(weights) as PickupKind[]).filter((k) => weights[k] > 0);
  const total = kinds.reduce((sum, k) => sum + weights[k], 0);
  if (total <= 0) return null;
  let roll = rngNext(rng) * total;
  for (const k of kinds) {
    roll -= weights[k];
    if (roll < 0) return k;
  }
  return kinds[kinds.length - 1];
}

/** Clear of walls, blocks, bodies, other pickups and wormholes, and far from every head. */
function isClear(state: MatchState, cfg: Config, x: number, y: number, c: number): boolean {
  if (circleHitsTiles(state.tiles, x, y, c)) return false;
  const probe = { body: false };
  forEachSolidPointNear(state, x, y, c, () => {
    probe.body = true;
  });
  if (probe.body) return false;
  for (const p of state.pickups) if (dist2(p, x, y) < c * c) return false;
  const wc = c + cfg.wormholeRadius;
  for (const w of state.wormholes) {
    if (dist2(w, x, y) < wc * wc || dist2({ x: w.exitX, y: w.exitY }, x, y) < wc * wc) return false;
  }
  const h = cfg.pickupMinHeadDistance;
  for (const s of state.snakes) if (s.alive && dist2(s, x, y) < h * h) return false;
  return true;
}

/** A random spot with `clearance` (pickupClearance by default) around it, or null after SPAWN_TRIES misses. */
export function findSpawnPoint(state: MatchState, cfg: Config, clearance = cfg.pickupClearance): { x: number; y: number } | null {
  const c = clearance + state.inset;
  if (ARENA_WIDTH - 2 * c <= 0 || ARENA_HEIGHT - 2 * c <= 0) return null;
  for (let t = 0; t < SPAWN_TRIES; t++) {
    const x = rngRange(state.rng, c, ARENA_WIDTH - c);
    const y = rngRange(state.rng, c, ARENA_HEIGHT - c);
    if (isClear(state, cfg, x, y, clearance)) return { x, y };
  }
  return null;
}

/** Ages and expires pickups, and spawns a new one every pickupInterval. Call once per playing tick. */
export function updatePickups(state: MatchState, cfg: Config, events: SimEvent[]): void {
  // Ageing, plus anything the closing border has swallowed.
  for (const p of state.pickups) {
    p.ttl--;
    if (state.inset > 0 && circleHitsWall(p.x, p.y, cfg.pickupRadius, state.inset)) p.ttl = 0;
  }
  if (state.pickups.some((p) => p.ttl <= 0)) {
    for (const p of state.pickups) if (p.ttl <= 0) events.push({ type: 'pickupExpired', id: p.id });
    state.pickups = state.pickups.filter((p) => p.ttl > 0);
  }

  state.pickupTimer--;
  if (state.pickupTimer > 0) return;
  state.pickupTimer = Math.max(1, Math.round(cfg.pickupInterval * TICK_RATE));
  if (state.pickups.length >= cfg.maxPickups) return;
  // A Bulldozer is pointless on a map without blocks.
  const weights = state.tiles.includes(1) ? cfg.pickupWeights : { ...cfg.pickupWeights, dozer: 0 };
  const kind = pickKind(weights, state.rng);
  if (!kind) return;
  const spot = findSpawnPoint(state, cfg);
  if (!spot) return;
  const pickup: PickupState = {
    id: state.nextId++,
    kind,
    x: spot.x,
    y: spot.y,
    ttl: Math.max(1, Math.round(cfg.pickupLifetime * TICK_RATE)),
  };
  state.pickups.push(pickup);
  events.push({ type: 'pickupSpawned', id: pickup.id, kind, x: pickup.x, y: pickup.y });
}

/** A Shield needs no bubble already; anything else needs a free item slot. */
function canCarry(s: SnakeState, kind: PickupKind, cfg: Config): boolean {
  return kind === 'shield' ? !s.shield : s.items.length < cfg.itemSlots;
}

/** Heads with room collect pickups they touch; when both reach one, the closer head wins. */
export function collectPickups(state: MatchState, cfg: Config, events: SimEvent[]): void {
  if (state.pickups.length === 0) return;
  const reach = cfg.snakeRadius + cfg.pickupRadius;
  const kept: PickupState[] = [];
  for (const p of state.pickups) {
    let winner = -1;
    let best = reach * reach;
    state.snakes.forEach((s, i) => {
      if (!s.alive || !canCarry(s, p.kind, cfg)) return;
      const d = dist2(s, p.x, p.y);
      if (d < best) {
        best = d;
        winner = i;
      }
    });
    if (winner < 0) {
      kept.push(p);
      continue;
    }
    const taker = state.snakes[winner];
    if (p.kind === 'shield') taker.shield = true;
    else taker.items.push(createItem(p.kind, cfg));
    events.push({ type: 'pickupCollected', id: p.id, kind: p.kind, player: winner });
  }
  state.pickups = kept;
}
