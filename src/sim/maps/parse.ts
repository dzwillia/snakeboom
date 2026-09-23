import { createTiles } from '../arena';
import { MAP_CELL, MAP_COLS, MAP_ROWS, TILE_COLS, TILE_SIZE } from '../config';
import { PI } from '../detmath';

/** A hand-made map: 40x25 ASCII, '.' empty, '#' solid (2x2 tiles), '1'/'2' spawn cells. */
export interface MapDef {
  name: string;
  /** Spawn headings in degrees for P1 and P2 (0 = east, clockwise). */
  spawnHeadings: [number, number];
  grid: string;
}

export interface Spawn {
  x: number;
  y: number;
  heading: number;
}

export interface ParsedMap {
  name: string;
  tiles: number[];
  spawns: Spawn[];
}

const TILES_PER_CELL = MAP_CELL / TILE_SIZE;

export function mapRows(def: MapDef): string[] {
  return def.grid
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function parseMap(def: MapDef): ParsedMap {
  const rows = mapRows(def);
  if (rows.length !== MAP_ROWS) {
    throw new Error(`Map ${def.name}: expected ${MAP_ROWS} rows, got ${rows.length}`);
  }
  const tiles = createTiles();
  const cells: Array<{ c: number; r: number } | null> = [null, null];
  for (let r = 0; r < MAP_ROWS; r++) {
    const row = rows[r];
    if (row.length !== MAP_COLS) {
      throw new Error(`Map ${def.name}: row ${r} has ${row.length} columns, expected ${MAP_COLS}`);
    }
    for (let c = 0; c < MAP_COLS; c++) {
      const ch = row[c];
      if (ch === '#') {
        for (let dy = 0; dy < TILES_PER_CELL; dy++) {
          for (let dx = 0; dx < TILES_PER_CELL; dx++) {
            tiles[(r * TILES_PER_CELL + dy) * TILE_COLS + (c * TILES_PER_CELL + dx)] = 1;
          }
        }
      } else if (ch === '1' || ch === '2') {
        const p = ch === '1' ? 0 : 1;
        if (cells[p]) throw new Error(`Map ${def.name}: more than one spawn ${ch}`);
        cells[p] = { c, r };
      } else if (ch !== '.') {
        throw new Error(`Map ${def.name}: unknown character '${ch}' at column ${c}, row ${r}`);
      }
    }
  }
  const spawns = cells.map((cell, p) => {
    if (!cell) throw new Error(`Map ${def.name}: missing spawn ${p + 1}`);
    return {
      x: cell.c * MAP_CELL + MAP_CELL / 2,
      y: cell.r * MAP_CELL + MAP_CELL / 2,
      heading: (def.spawnHeadings[p] * PI) / 180,
    };
  });
  return { name: def.name, tiles, spawns };
}
