import { solidTilesTouching } from './arena';
import { TILE_COLS, TILE_ROWS, type Config } from './config';
import { detCos, detSin } from './detmath';
import type { MatchState } from './types';

/** The longest row of blocks one plow can shove; a longer row (or one against the edge) is crushed. */
export const PLOW_PUSH_LIMIT = 4;

/**
 * The Bulldozer's plow (a circle just ahead of the head) shoves every block it touches one tile
 * along the heading's dominant axis, pushing any short row of blocks ahead of it. A block that
 * can't move is crushed. Blocks farthest along the push go first, so rows move as a unit.
 */
export function plow(state: MatchState, idx: number, cfg: Config): { moved: number; crushed: number[] } {
  const s = state.snakes[idx];
  const r = cfg.snakeRadius;
  const hx = detCos(s.heading);
  const hy = detSin(s.heading);
  const horizontal = Math.abs(hx) >= Math.abs(hy);
  const dx = horizontal ? (hx >= 0 ? 1 : -1) : 0;
  const dy = horizontal ? 0 : hy >= 0 ? 1 : -1;
  const along = (i: number) => (i % TILE_COLS) * dx + Math.floor(i / TILE_COLS) * dy;
  const touched = solidTilesTouching(state.tiles, s.x + hx * r, s.y + hy * r, r * 1.2).sort(
    (a, b) => along(b) - along(a) || a - b,
  );

  const result = { moved: 0, crushed: [] as number[] };
  for (const i of touched) {
    if (state.tiles[i] !== 1) continue;
    const tx = i % TILE_COLS;
    const ty = Math.floor(i / TILE_COLS);
    let free = -1;
    for (let k = 1; k <= PLOW_PUSH_LIMIT; k++) {
      const nx = tx + dx * k;
      const ny = ty + dy * k;
      if (nx < 0 || ny < 0 || nx >= TILE_COLS || ny >= TILE_ROWS) break;
      const ni = ny * TILE_COLS + nx;
      if (state.tiles[ni] !== 1) {
        free = ni;
        break;
      }
    }
    state.tiles[i] = 0;
    if (free >= 0) {
      state.tiles[free] = 1;
      result.moved++;
    } else {
      result.crushed.push(i);
    }
  }
  if (result.moved > 0 || result.crushed.length > 0) state.tilesVersion++;
  return result;
}
