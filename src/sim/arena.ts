import { ARENA_HEIGHT, ARENA_WIDTH, TILE_COLS, TILE_ROWS, TILE_SIZE } from './config';

export function createTiles(): number[] {
  return new Array<number>(TILE_COLS * TILE_ROWS).fill(0);
}

export function setTile(tiles: number[], tx: number, ty: number, solid: boolean): void {
  if (tx < 0 || ty < 0 || tx >= TILE_COLS || ty >= TILE_ROWS) return;
  tiles[ty * TILE_COLS + tx] = solid ? 1 : 0;
}

export function tileSolid(tiles: number[], tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < TILE_COLS && ty < TILE_ROWS && tiles[ty * TILE_COLS + tx] === 1;
}

/** True when a circle crosses the arena border (or its position is NaN). */
export function circleHitsWall(x: number, y: number, r: number): boolean {
  return !(x - r >= 0 && y - r >= 0 && x + r <= ARENA_WIDTH && y + r <= ARENA_HEIGHT);
}

export function circleHitsTiles(tiles: number[], x: number, y: number, r: number): boolean {
  const tx0 = Math.max(0, Math.floor((x - r) / TILE_SIZE));
  const tx1 = Math.min(TILE_COLS - 1, Math.floor((x + r) / TILE_SIZE));
  const ty0 = Math.max(0, Math.floor((y - r) / TILE_SIZE));
  const ty1 = Math.min(TILE_ROWS - 1, Math.floor((y + r) / TILE_SIZE));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tiles[ty * TILE_COLS + tx] !== 1) continue;
      const left = tx * TILE_SIZE;
      const top = ty * TILE_SIZE;
      const nx = x < left ? left : x > left + TILE_SIZE ? left + TILE_SIZE : x;
      const ny = y < top ? top : y > top + TILE_SIZE ? top + TILE_SIZE : y;
      const dx = x - nx;
      const dy = y - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}
