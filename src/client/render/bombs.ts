import { Graphics, type Container } from 'pixi.js';
import type { BombState, Config } from '../../sim';
import { PALETTE } from '../colors';

/** How high (world units) a thrown bomb arcs at the middle of its flight. */
const ARC_HEIGHT = 70;

/**
 * Thrown bombs arc from the thrower toward a pulsing reticle that marks the blast zone, with a
 * shadow on the ground; landed bombs blink faster as the fuse ring shrinks, inside a danger circle.
 */
export class BombView {
  private readonly g = new Graphics();

  constructor(parent: Container) {
    parent.addChild(this.g);
  }

  clear(): void {
    this.g.clear();
  }

  draw(bombs: readonly BombState[], cfg: Config, t: number): void {
    this.g.clear();
    for (const b of bombs) {
      if (b.flight > 0) this.drawFlying(b, cfg, t);
      else this.drawLanded(b, cfg, t);
    }
  }

  private drawFlying(b: BombState, cfg: Config, t: number): void {
    const g = this.g;
    const k = 1 - b.flight / Math.max(1, b.flightTotal);
    const gx = b.fromX + (b.x - b.fromX) * k;
    const gy = b.fromY + (b.y - b.fromY) * k;
    const lift = ARC_HEIGHT * 4 * k * (1 - k);
    const c = 10;
    g.circle(b.x, b.y, cfg.blastRadius).stroke({ width: 2, color: PALETTE.bomb, alpha: 0.35 + 0.25 * Math.sin(t * 18) });
    g.moveTo(b.x - c, b.y)
      .lineTo(b.x + c, b.y)
      .moveTo(b.x, b.y - c)
      .lineTo(b.x, b.y + c)
      .stroke({ width: 2, color: PALETTE.bomb, alpha: 0.8 });
    g.ellipse(gx, gy, 8, 4).fill({ color: 0x000000, alpha: 0.45 });
    g.circle(gx, gy - lift, 8).fill({ color: PALETTE.bomb });
    g.circle(gx, gy - lift, 3.5).fill({ color: PALETTE.core });
  }

  private drawLanded(b: BombState, cfg: Config, t: number): void {
    const g = this.g;
    const left = Math.max(0, Math.min(1, b.fuse / b.maxFuse));
    g.circle(b.x, b.y, cfg.blastRadius).stroke({ width: 1.5, color: PALETTE.bomb, alpha: 0.2 + 0.4 * (1 - left) });
    const blinkHz = 3 + (1 - left) * 14;
    const lit = Math.sin(t * blinkHz * Math.PI * 2) > 0;
    g.circle(b.x, b.y, 9).fill({ color: lit ? PALETTE.bomb : PALETTE.bombDim });
    g.circle(b.x, b.y, 4).fill({ color: PALETTE.core, alpha: lit ? 1 : 0.6 });
    if (left > 0) {
      const start = -Math.PI / 2;
      g.moveTo(b.x + Math.cos(start) * 15, b.y + Math.sin(start) * 15)
        .arc(b.x, b.y, 15, start, start + left * Math.PI * 2)
        .stroke({ width: 3, color: PALETTE.fuse, cap: 'round' });
    }
  }
}
