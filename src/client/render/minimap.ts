import { Container, Graphics } from 'pixi.js';
import { ARENA_HEIGHT, ARENA_WIDTH, type MatchState } from '../../sim';
import type { View } from '../camera';
import { PALETTE, PLAYER_COLORS } from '../colors';
import type { World } from './world';

const WIDTH = 200;
const MARGIN = 14;

/** A corner map of the whole arena: the dead zone, every head, hazards, and the camera's rectangle. */
export class Minimap {
  private readonly root = new Container();
  private readonly g = new Graphics();
  private readonly scale = WIDTH / ARENA_WIDTH;

  constructor(world: World) {
    this.root.addChild(this.g);
    world.app.stage.addChild(this.root);
    const place = () => {
      this.root.position.set(world.app.screen.width - WIDTH - MARGIN, world.app.screen.height - ARENA_HEIGHT * this.scale - MARGIN);
    };
    place();
    world.app.renderer.on('resize', place);
  }

  draw(state: MatchState | null, view: View): void {
    const g = this.g;
    g.clear();
    this.root.visible = state !== null;
    if (!state) return;
    const s = this.scale;
    const w = ARENA_WIDTH * s;
    const h = ARENA_HEIGHT * s;
    g.rect(0, 0, w, h).fill({ color: PALETTE.background, alpha: 0.75 }).stroke({ width: 1, color: PALETTE.border, alpha: 0.6 });
    if (state.inset > 0) {
      const i = state.inset * s;
      g.rect(0, 0, w, i).rect(0, h - i, w, i).rect(0, i, i, h - 2 * i).rect(w - i, i, i, h - 2 * i).fill({ color: 0xff3b3b, alpha: 0.35 });
    }
    // Blocks are skipped on purpose: the map is about the action.
    for (const w of state.wormholes) {
      g.circle(w.x * s, w.y * s, 3).fill({ color: PALETTE.wormhole });
      g.circle(w.exitX * s, w.exitY * s, 3).stroke({ width: 1, color: PALETTE.wormhole });
    }
    for (const saw of state.saws) g.rect(saw.x * s - 3, saw.y * s - 3, 6, 6).fill({ color: PALETTE.saw });
    state.snakes.forEach((sn, i) => {
      if (!sn.alive) return;
      g.circle(sn.x * s, sn.y * s, 3).fill({ color: PLAYER_COLORS[i] ?? 0xffffff });
    });
    const vw = w / view.zoom;
    const vh = h / view.zoom;
    g.rect(view.cx * s - vw / 2, view.cy * s - vh / 2, vw, vh).stroke({ width: 1, color: 0xffffff, alpha: 0.35 });
  }
}
