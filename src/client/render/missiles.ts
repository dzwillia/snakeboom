import { Graphics, type Container } from 'pixi.js';
import type { Config, MissileState } from '../../sim';
import { PALETTE, PLAYER_COLORS } from '../colors';

/** Each missile is a bright dart with a short exhaust in its owner's colour. */
export class MissileView {
  private readonly g = new Graphics();

  constructor(parent: Container) {
    parent.addChild(this.g);
  }

  clear(): void {
    this.g.clear();
  }

  draw(missiles: readonly MissileState[], cfg: Config, t: number): void {
    const g = this.g;
    g.clear();
    for (const m of missiles) {
      const color = PLAYER_COLORS[m.owner] ?? PALETTE.missile;
      const hx = Math.cos(m.heading);
      const hy = Math.sin(m.heading);
      const R = cfg.missileRadius;
      // Exhaust: three fading segments behind the dart, flickering.
      for (let k = 1; k <= 3; k++) {
        const back = R * (1.2 + k * 1.1) + (Math.sin(t * 40 + k) + 1) * 2;
        g.circle(m.x - hx * back, m.y - hy * back, R * (0.55 - k * 0.12)).fill({ color, alpha: 0.5 - k * 0.12 });
      }
      // The dart.
      g.poly([
        m.x + hx * R * 1.6,
        m.y + hy * R * 1.6,
        m.x - hx * R * 0.8 - hy * R * 0.7,
        m.y - hy * R * 0.8 + hx * R * 0.7,
        m.x - hx * R * 0.4,
        m.y - hy * R * 0.4,
        m.x - hx * R * 0.8 + hy * R * 0.7,
        m.y - hy * R * 0.8 - hx * R * 0.7,
      ]).fill({ color: PALETTE.missile });
      g.circle(m.x + hx * R * 0.3, m.y + hy * R * 0.3, R * 0.35).fill({ color: PALETTE.core });
    }
  }
}
