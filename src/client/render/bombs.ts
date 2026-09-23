import { Graphics, type Container } from 'pixi.js';
import type { BombState } from '../../sim';
import { PALETTE } from '../colors';

/** Red bombs with a white-hot core, a shrinking fuse ring, and a blink that speeds up. */
export class BombView {
  private readonly g = new Graphics();

  constructor(parent: Container) {
    parent.addChild(this.g);
  }

  clear(): void {
    this.g.clear();
  }

  draw(bombs: readonly BombState[], t: number): void {
    const g = this.g;
    g.clear();
    for (const b of bombs) {
      const left = Math.max(0, Math.min(1, b.fuse / b.maxFuse));
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
}
