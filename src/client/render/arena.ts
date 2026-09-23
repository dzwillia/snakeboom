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
  private alerting = false;

  constructor(world: World) {
    world.bg.addChild(this.grid);
    world.glow.addChild(this.border, this.blocks);
    for (let x = GRID_STEP; x < ARENA_WIDTH; x += GRID_STEP) this.grid.moveTo(x, 0).lineTo(x, ARENA_HEIGHT);
    for (let y = GRID_STEP; y < ARENA_HEIGHT; y += GRID_STEP) this.grid.moveTo(0, y).lineTo(ARENA_WIDTH, y);
    this.grid.stroke({ width: 1, color: PALETTE.gridLine, alpha: 0.9 });
    this.drawBorder(PALETTE.border, 0.9);
  }

  /** Overtime: the border pulses red; otherwise it stays its calm blue-white. */
  setAlert(active: boolean, t: number): void {
    if (active) this.drawBorder(0xff3b3b, 0.55 + 0.4 * Math.sin(t * 8));
    else if (this.alerting) this.drawBorder(PALETTE.border, 0.9);
    this.alerting = active;
  }

  private drawBorder(color: number, alpha: number): void {
    this.border.clear();
    this.border.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT).stroke({ width: 4, color, alpha });
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
