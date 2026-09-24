import type { Config, MatchState } from '../../sim';
import { PLAYER_COLORS } from '../colors';
import { ArenaView } from './arena';
import { BombView } from './bombs';
import { PickupView } from './pickups';
import { SnakeView } from './snakes';
import type { World } from './world';

/**
 * Draws a MatchState. A replaced tiles array marks a new round (views reset); tilesVersion
 * marks blasted blocks (tiles redrawn).
 */
export class Renderer {
  private readonly arena: ArenaView;
  private readonly pickups: PickupView;
  private readonly snakes: SnakeView[];
  private readonly bombs: BombView;
  private lastTiles: readonly number[] | null = null;
  private lastTilesVersion = -1;

  constructor(world: World) {
    this.arena = new ArenaView(world);
    this.pickups = new PickupView(world.glow);
    this.snakes = PLAYER_COLORS.map((color) => new SnakeView(world.glow, color));
    this.bombs = new BombView(world.glow);
  }

  draw(state: MatchState | null, alpha: number, cfg: Config, timeSeconds = 0, offsets?: readonly { x: number; y: number }[]): void {
    if (!state) {
      if (this.lastTiles) {
        this.arena.drawTiles([]);
        for (const view of this.snakes) view.reset();
        this.pickups.clear();
        this.bombs.clear();
        this.lastTiles = null;
        this.lastTilesVersion = -1;
      }
      for (const view of this.snakes) view.hide();
      this.arena.setAlert(false, timeSeconds);
      return;
    }
    if (state.tiles !== this.lastTiles) {
      for (const view of this.snakes) view.reset();
      this.lastTiles = state.tiles;
      this.lastTilesVersion = -1;
    }
    if (state.tilesVersion !== this.lastTilesVersion) {
      this.arena.drawTiles(state.tiles);
      this.lastTilesVersion = state.tilesVersion;
    }
    this.arena.setAlert(state.overtime && state.phase === 'playing', timeSeconds);
    this.pickups.draw(state.pickups, cfg, timeSeconds);
    state.snakes.forEach((s, i) => {
      const view = this.snakes[i];
      if (!view) return;
      if (s.alive) view.update(s, state.phase === 'playing' ? alpha : 1, cfg, timeSeconds, offsets?.[i]);
      else view.hide();
    });
    this.bombs.draw(state.bombs, cfg, timeSeconds);
  }
}
