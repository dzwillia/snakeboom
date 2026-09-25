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
  private readonly deadZone = new Graphics();
  private alerting = false;
  private inset = -1;

  constructor(world: World) {
    world.bg.addChild(this.grid, this.deadZone);
    world.glow.addChild(this.border, this.blocks);
    for (let x = GRID_STEP; x < ARENA_WIDTH; x += GRID_STEP) this.grid.moveTo(x, 0).lineTo(x, ARENA_HEIGHT);
    for (let y = GRID_STEP; y < ARENA_HEIGHT; y += GRID_STEP) this.grid.moveTo(0, y).lineTo(ARENA_WIDTH, y);
    this.grid.stroke({ width: 1, color: PALETTE.gridLine, alpha: 0.9 });
    this.drawBorder(PALETTE.border, 0.9, 0);
    this.inset = 0;
  }

  /** The closing border: the live edge moves in and glows red, and the dead zone fills behind it. */
  setInset(inset: number, t: number): void {
    const closing = inset > 0;
    if (closing) this.drawBorder(0xff3b3b, 0.7 + 0.3 * Math.sin(t * 8), inset);
    else if (this.inset !== 0) this.drawBorder(PALETTE.border, 0.9, 0);
    if (inset !== this.inset) {
      this.deadZone.clear();
      if (closing) {
        const w = ARENA_WIDTH;
        const h = ARENA_HEIGHT;
        this.deadZone.rect(0, 0, w, inset).rect(0, h - inset, w, inset).rect(0, inset, inset, h - 2 * inset).rect(w - inset, inset, inset, h - 2 * inset);
        this.deadZone.fill({ color: 0xff3b3b, alpha: 0.16 });
      }
    }
    this.inset = inset;
  }

  /** Overtime: the border pulses red; otherwise it stays its calm blue-white. */
  setAlert(active: boolean, t: number): void {
    if (this.inset > 0) return;
    if (active) this.drawBorder(0xff3b3b, 0.55 + 0.4 * Math.sin(t * 8), 0);
    else if (this.alerting) this.drawBorder(PALETTE.border, 0.9, 0);
    this.alerting = active;
  }

  private drawBorder(color: number, alpha: number, inset: number): void {
    this.border.clear();
    this.border.rect(inset, inset, ARENA_WIDTH - 2 * inset, ARENA_HEIGHT - 2 * inset).stroke({ width: 4, color, alpha });
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
