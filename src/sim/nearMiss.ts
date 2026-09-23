import { forEachSolidPointNear, isProtected } from './collision';
import type { Config } from './config';
import type { MatchState, SimEvent } from './types';

/** How far beyond touching still counts as a close call. */
export const NEAR_MISS_MARGIN = 6;
/** Ticks between near-miss reports for the same snake. */
export const NEAR_MISS_COOLDOWN = 24;

/**
 * Reports live, unprotected heads skimming another snake's body without touching it, so the
 * client can throw sparks. One report per snake per NEAR_MISS_COOLDOWN ticks.
 */
export function detectNearMisses(state: MatchState, cfg: Config, events: SimEvent[]): void {
  const reach = 2 * cfg.snakeRadius + NEAR_MISS_MARGIN;
  state.snakes.forEach((s, i) => {
    if (!s.alive) return;
    if (s.nearMissCooldown > 0) {
      s.nearMissCooldown--;
      return;
    }
    if (isProtected(s)) return;
    const found = { skim: false };
    forEachSolidPointNear(state, s.x, s.y, reach, (snake) => {
      if (snake !== i) found.skim = true;
    });
    if (!found.skim) return;
    s.nearMissCooldown = NEAR_MISS_COOLDOWN;
    events.push({ type: 'nearMiss', player: i, x: s.x, y: s.y });
  });
}
