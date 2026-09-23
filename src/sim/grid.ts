import type { Grid } from './types';

export const GRID_CELL = 32;

export function createGrid(width: number, height: number, cellSize = GRID_CELL): Grid {
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cells: number[][] = [];
  for (let i = 0; i < cols * rows; i++) cells.push([]);
  return { cols, rows, cellSize, cells };
}

/** Clamps a cell coordinate into [0, max]; NaN maps to 0. */
function clampCell(v: number, max: number): number {
  return v >= 0 ? (v > max ? max : v) : 0;
}

export function gridInsert(g: Grid, x: number, y: number, snake: number, seq: number): void {
  const cx = clampCell(Math.floor(x / g.cellSize), g.cols - 1);
  const cy = clampCell(Math.floor(y / g.cellSize), g.rows - 1);
  g.cells[cy * g.cols + cx].push(seq * 8 + snake);
}

/**
 * Visits every entry in the cells overlapping the square around (x, y).
 * Entries can be stale (trimmed) or holes; callers filter and check exact distance.
 */
export function gridQuery(
  g: Grid,
  x: number,
  y: number,
  radius: number,
  visit: (snake: number, seq: number) => void,
): void {
  const x0 = clampCell(Math.floor((x - radius) / g.cellSize), g.cols - 1);
  const x1 = clampCell(Math.floor((x + radius) / g.cellSize), g.cols - 1);
  const y0 = clampCell(Math.floor((y - radius) / g.cellSize), g.rows - 1);
  const y1 = clampCell(Math.floor((y + radius) / g.cellSize), g.rows - 1);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const cell = g.cells[cy * g.cols + cx];
      for (let k = 0; k < cell.length; k++) {
        const e = cell[k];
        const snake = e % 8;
        visit(snake, (e - snake) / 8);
      }
    }
  }
}

export function gridClear(g: Grid): void {
  for (const cell of g.cells) cell.length = 0;
}
