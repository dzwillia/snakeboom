import type { Config, MatchState } from '../../sim';
import { PLAYER_COLORS } from '../colors';
import { ArenaView } from './arena';
import { SnakeView } from './snakes';
import type { World } from './world';

/** Draws a MatchState. Round changes are detected by the tiles array being replaced. */
export class Renderer {
  private readonly arena: ArenaView;
  private readonly snakes: SnakeView[];
  private lastTiles: readonly number[] | null = null;

  constructor(world: World) {
    this.arena = new ArenaView(world);
    this.snakes = PLAYER_COLORS.map((color) => new SnakeView(world.glow, color));
  }

  draw(state: MatchState | null, alpha: number, cfg: Config): void {
    if (!state) {
      if (this.lastTiles) {
        this.arena.drawTiles([]);
        for (const view of this.snakes) view.reset();
        this.lastTiles = null;
      }
      for (const view of this.snakes) view.hide();
      return;
    }
    if (state.tiles !== this.lastTiles) {
      this.arena.drawTiles(state.tiles);
      for (const view of this.snakes) view.reset();
      this.lastTiles = state.tiles;
    }
    state.snakes.forEach((s, i) => {
      const view = this.snakes[i];
      if (!view) return;
      if (s.alive) view.update(s, state.phase === 'playing' ? alpha : 1, cfg.snakeRadius);
      else view.hide();
    });
  }
}
