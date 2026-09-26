import { ARENA_HEIGHT, ARENA_WIDTH, TILE_COLS, TILE_ROWS, TILE_SIZE } from '../config';
import { detAtan2, detCos, detSin, HALF_PI, TWO_PI } from '../detmath';
import type { Spawn } from './parse';

/** The ring's radii as a share of the arena: well inside the border, well outside the centre. */
const RING = 0.32;

/**
 * Spawns for more than two players: evenly spaced on an ellipse around the centre, starting at
 * the top, every head pointing at the middle. Deterministic (detmath only).
 */
export function ringSpawns(players: number): Spawn[] {
  const cx = ARENA_WIDTH / 2;
  const cy = ARENA_HEIGHT / 2;
  const rx = ARENA_WIDTH * RING;
  const ry = ARENA_HEIGHT * RING;
  const out: Spawn[] = [];
  for (let i = 0; i < players; i++) {
    const a = -HALF_PI + (TWO_PI * i) / players;
    const x = cx + detCos(a) * rx;
    const y = cy + detSin(a) * ry;
    out.push({ x, y, heading: detAtan2(cy - y, cx - x) });
  }
  return out;
}

/** Clears every solid tile whose centre is within `radius` of (x, y), in place. */
export function clearAround(tiles: number[], x: number, y: number, radius: number): void {
  const r2 = radius * radius;
  const tx0 = Math.max(0, Math.floor((x - radius) / TILE_SIZE));
  const tx1 = Math.min(TILE_COLS - 1, Math.floor((x + radius) / TILE_SIZE));
  const ty0 = Math.max(0, Math.floor((y - radius) / TILE_SIZE));
  const ty1 = Math.min(TILE_ROWS - 1, Math.floor((y + radius) / TILE_SIZE));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const dx = (tx + 0.5) * TILE_SIZE - x;
      const dy = (ty + 0.5) * TILE_SIZE - y;
      if (dx * dx + dy * dy <= r2) tiles[ty * TILE_COLS + tx] = 0;
    }
  }
}
