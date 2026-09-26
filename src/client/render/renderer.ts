import type { Config, MatchState } from '../../sim';
import { PLAYER_COLORS } from '../colors';
import { ArenaView } from './arena';
import { MissileView } from './missiles';
import { PickupView } from './pickups';
import { SawView } from './saws';
import { SnakeView } from './snakes';
import { WormholeView } from './wormholes';
import type { World } from './world';

/**
 * Draws a MatchState. A replaced tiles array marks a new round (views reset); tilesVersion
 * marks crushed blocks (tiles redrawn).
 */
export class Renderer {
  private readonly arena: ArenaView;
  private readonly pickups: PickupView;
  private readonly snakes: SnakeView[] = [];
  private readonly missiles: MissileView;
  private readonly wormholes: WormholeView;
  private readonly saws: SawView;
  private lastTiles: readonly number[] | null = null;
  private lastTilesVersion = -1;

  constructor(private readonly world: World) {
    this.arena = new ArenaView(world);
    this.pickups = new PickupView(world.glow);
    for (let i = 0; i < 2; i++) this.view(i);
    this.missiles = new MissileView(world.glow);
    this.wormholes = new WormholeView(world.glow);
    this.saws = new SawView(world.glow);
  }

  /** The view for player `i`, made on first use (rooms grow to eight). */
  private view(i: number): SnakeView {
    while (this.snakes.length <= i) this.snakes.push(new SnakeView(this.world.glow, PLAYER_COLORS[this.snakes.length % PLAYER_COLORS.length]));
    return this.snakes[i];
  }

  /** `labels`: name tags by the heads (with more than two players), skipped for `local`, your own. */
  draw(
    state: MatchState | null,
    alpha: number,
    cfg: Config,
    timeSeconds = 0,
    offsets?: readonly { x: number; y: number }[],
    labels?: { names: readonly string[]; local: number; show: boolean },
  ): void {
    if (!state) {
      if (this.lastTiles) {
        this.arena.drawTiles([]);
        for (const view of this.snakes) view.reset();
        this.pickups.clear();
        this.missiles.clear();
        this.wormholes.clear();
        this.saws.clear();
        this.lastTiles = null;
        this.lastTilesVersion = -1;
      }
      for (const view of this.snakes) view.hide();
      this.arena.setInset(0, timeSeconds);
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
    this.arena.setInset(state.phase === 'playing' || state.phase === 'roundOver' ? state.inset : 0, timeSeconds);
    this.arena.setAlert(state.overtime && state.phase === 'playing', timeSeconds);
    this.wormholes.draw(state.wormholes, cfg, timeSeconds);
    this.pickups.draw(state.pickups, cfg, timeSeconds);
    // Screen pixels per world unit as of the last frame, for things that keep their size on screen.
    const worldScale = this.world.base.scale * this.world.view.zoom;
    state.snakes.forEach((s, i) => {
      const view = this.view(i);
      const tag = labels?.show && i !== labels.local ? (labels.names[i] ?? '') : '';
      if (s.alive) view.update(s, state.phase === 'playing' ? alpha : 1, cfg, timeSeconds, offsets?.[i], worldScale, tag);
      else view.hide();
    });
    this.missiles.draw(state.missiles, cfg, timeSeconds);
    this.saws.draw(state.saws, cfg, timeSeconds);
  }
}
