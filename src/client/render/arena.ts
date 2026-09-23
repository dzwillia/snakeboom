import { Graphics } from 'pixi.js';
import { ARENA_HEIGHT, ARENA_WIDTH, TILE_COLS, TILE_SIZE } from '../../sim';
import { PALETTE } from '../colors';
import type { World } from './world';

const GRID_STEP = 40;

/** Background grid (no bloom), glowing border and obstacle blocks (bloom). */
export class ArenaView {
  private readonly grid = new Graphics();
  private readonly border = new Graphics();
  private readonly blocks = new Graphics();

  constructor(world: World) {
    world.bg.addChild(this.grid);
    world.glow.addChild(this.border, this.blocks);
    for (let x = GRID_STEP; x < ARENA_WIDTH; x += GRID_STEP) this.grid.moveTo(x, 0).lineTo(x, ARENA_HEIGHT);
    for (let y = GRID_STEP; y < ARENA_HEIGHT; y += GRID_STEP) this.grid.moveTo(0, y).lineTo(ARENA_WIDTH, y);
    this.grid.stroke({ width: 1, color: PALETTE.gridLine, alpha: 0.9 });
    this.border.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT).stroke({ width: 4, color: PALETTE.border, alpha: 0.9 });
  }

  drawTiles(tiles: readonly number[]): void {
    const g = this.blocks;
    g.clear();
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== 1) continue;
      const x = (i % TILE_COLS) * TILE_SIZE;
      const y = Math.floor(i / TILE_COLS) * TILE_SIZE;
      g.rect(x + 1.5, y + 1.5, TILE_SIZE - 3, TILE_SIZE - 3);
    }
    g.fill({ color: PALETTE.obstacleFill }).stroke({ width: 2, color: PALETTE.obstacle });
  }
}
