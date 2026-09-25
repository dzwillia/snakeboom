import { Graphics, type Container } from 'pixi.js';
import { TICK_RATE, type Config, type SawState } from '../../sim';
import { PALETTE } from '../colors';

const TEETH = 14;
/** Radians per second the disc turns. */
const SPIN = 14;

/** A spinning toothed disc in warning yellow with a dark hub; it blinks during its last 2 seconds. */
export class SawView {
  private readonly g = new Graphics();

  constructor(parent: Container) {
    parent.addChild(this.g);
  }

  clear(): void {
    this.g.clear();
  }

  draw(saws: readonly SawState[], cfg: Config, t: number): void {
    const g = this.g;
    g.clear();
    const color = PALETTE.saw;
    for (const s of saws) {
      if (s.ttl < 2 * TICK_RATE && Math.floor(t * 8) % 2 === 0) continue;
      const R = cfg.sawRadius;
      const spin = t * SPIN * (s.vx >= 0 ? 1 : -1);
      const pts: number[] = [];
      for (let k = 0; k < TEETH * 2; k++) {
        const a = spin + (k / (TEETH * 2)) * Math.PI * 2;
        const r = k % 2 === 0 ? R : R * 0.8;
        pts.push(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
      }
      g.poly(pts).fill({ color, alpha: 0.9 }).stroke({ width: 2, color: PALETTE.core, alpha: 0.5 });
      g.circle(s.x, s.y, R * 0.55).fill({ color: PALETTE.background, alpha: 0.9 }).stroke({ width: 2, color, alpha: 0.8 });
      // Three hub spokes so the spin reads at a glance.
      for (let k = 0; k < 3; k++) {
        const a = -spin * 0.5 + (k / 3) * Math.PI * 2;
        g.moveTo(s.x, s.y).lineTo(s.x + Math.cos(a) * R * 0.5, s.y + Math.sin(a) * R * 0.5).stroke({ width: 2, color, alpha: 0.7 });
      }
      g.circle(s.x, s.y, R * 0.12).fill({ color: PALETTE.core });
    }
  }
}
