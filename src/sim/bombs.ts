import { destroyTilesInCircle } from './arena';
import { forEachSolidPointNear } from './collision';
import { TICK_RATE, type Config } from './config';
import type { BombState, MatchState, SimEvent } from './types';

/**
 * Advances every fuse and resolves due explosions in bomb-id order. Blasts punch holes in
 * trails, destroy blocks and cut nearby fuses to chainDelay. Heads caught in a blast are
 * returned (victim index → bomb owner) so the caller applies them with the collision deaths.
 */
export function updateBombs(state: MatchState, cfg: Config, events: SimEvent[]): Map<number, number> {
  const blasted = new Map<number, number>();
  if (state.bombs.length === 0) return blasted;
  for (const b of state.bombs) b.fuse--;
  const due = state.bombs.filter((b) => b.fuse <= 0).sort((a, b) => a.id - b.id);
  for (const bomb of due) explode(state, bomb, cfg, events, blasted);
  state.bombs = state.bombs.filter((b) => b.fuse > 0);
  return blasted;
}

function explode(
  state: MatchState,
  bomb: BombState,
  cfg: Config,
  events: SimEvent[],
  blasted: Map<number, number>,
): void {
  const R = cfg.blastRadius;
  const reach = R + cfg.snakeRadius;

  state.snakes.forEach((s, i) => {
    if (!s.alive || blasted.has(i)) return;
    const dx = s.x - bomb.x;
    const dy = s.y - bomb.y;
    if (dx * dx + dy * dy < reach * reach) blasted.set(i, bomb.owner);
  });

  const holed = new Set<number>();
  forEachSolidPointNear(state, bomb.x, bomb.y, reach, (snake, i) => {
    state.snakes[snake].trail.solid[i] = false;
    holed.add(snake);
  });
  for (const snake of holed) state.snakes[snake].holeVersion++;

  const tilesDestroyed = destroyTilesInCircle(state.tiles, bomb.x, bomb.y, R);
  if (tilesDestroyed.length > 0) state.tilesVersion++;

  const chainFuse = Math.max(1, Math.round(cfg.chainDelay * TICK_RATE));
  for (const other of state.bombs) {
    if (other.fuse <= chainFuse) continue;
    const dx = other.x - bomb.x;
    const dy = other.y - bomb.y;
    if (dx * dx + dy * dy < R * R) {
      other.fuse = chainFuse;
      other.maxFuse = chainFuse;
      other.chainDepth = bomb.chainDepth + 1;
    }
  }

  events.push({
    type: 'explosion',
    id: bomb.id,
    owner: bomb.owner,
    x: bomb.x,
    y: bomb.y,
    radius: R,
    chainDepth: bomb.chainDepth,
    tilesDestroyed,
  });
}
