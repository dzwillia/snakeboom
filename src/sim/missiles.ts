import { circleHitsTiles, circleHitsWall } from './arena';
import { DT, type Config } from './config';
import { detAtan2, detCos, detSin, wrapAngle } from './detmath';
import type { MatchState, SimEvent } from './types';

/**
 * Flies every missile one tick: turn toward the nearest living opponent head (never the owner)
 * at up to missileTurnRate, move, age. Then resolves: a missile within missileRadius + r of a
 * non-owner head hits it (returned as victim → owner, first missile wins); one that crosses the
 * live border, touches a block or runs out of life fizzles. Missiles never touch bodies.
 */
export function updateMissiles(state: MatchState, cfg: Config, events: SimEvent[]): Map<number, number> {
  const hits = new Map<number, number>();
  if (state.missiles.length === 0) return hits;
  const maxTurn = cfg.missileTurnRate * DT;
  const step = cfg.missileSpeed * DT;
  const r = cfg.snakeRadius;
  const reach = cfg.missileRadius + r;
  const survivors = [];
  for (const m of state.missiles) {
    // Steer toward the nearest opponent head.
    let best = Infinity;
    let tx = 0;
    let ty = 0;
    state.snakes.forEach((s, j) => {
      if (j === m.owner || !s.alive) return;
      const dx = s.x - m.x;
      const dy = s.y - m.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        tx = s.x;
        ty = s.y;
      }
    });
    if (best < Infinity) {
      const want = detAtan2(ty - m.y, tx - m.x);
      const delta = wrapAngle(want - m.heading);
      m.heading = wrapAngle(m.heading + Math.max(-maxTurn, Math.min(maxTurn, delta)));
    }
    m.x += detCos(m.heading) * step;
    m.y += detSin(m.heading) * step;
    m.ttl--;

    let hit = -1;
    state.snakes.forEach((s, j) => {
      if (j === m.owner || !s.alive || hits.has(j) || hit >= 0) return;
      const dx = s.x - m.x;
      const dy = s.y - m.y;
      if (dx * dx + dy * dy < reach * reach) hit = j;
    });
    if (hit >= 0) {
      hits.set(hit, m.owner);
      events.push({ type: 'missileHit', id: m.id, player: hit, x: m.x, y: m.y });
      continue;
    }
    const gone =
      m.ttl <= 0 || circleHitsWall(m.x, m.y, cfg.missileRadius, state.inset) || circleHitsTiles(state.tiles, m.x, m.y, cfg.missileRadius);
    if (gone) {
      events.push({ type: 'missileFizzled', id: m.id, x: m.x, y: m.y });
      continue;
    }
    survivors.push(m);
  }
  state.missiles = survivors;
  return hits;
}
