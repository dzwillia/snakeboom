import { Graphics, type Container } from 'pixi.js';
import { TICK_RATE, type Config, type WormholeState } from '../../sim';
import { PALETTE } from '../colors';

/**
 * A wormhole: the portal is a dark disc with two violet arcs spinning around it and a pulsing
 * core; the exit is a dashed ring of the same colour. Both blink during the last 2 seconds.
 */
export class WormholeView {
  private readonly g = new Graphics();

  constructor(parent: Container) {
    parent.addChild(this.g);
  }

  clear(): void {
    this.g.clear();
  }

  draw(wormholes: readonly WormholeState[], cfg: Config, t: number): void {
    const g = this.g;
    g.clear();
    const color = PALETTE.wormhole;
    for (const w of wormholes) {
      if (w.ttl < 2 * TICK_RATE && Math.floor(t * 8) % 2 === 0) continue;
      const R = cfg.wormholeRadius;
      const pulse = 0.85 + 0.15 * Math.sin(t * 6 + w.id);
      // The portal: a hole with a swirl and a bright eye.
      g.circle(w.x, w.y, R).fill({ color: PALETTE.background, alpha: 0.9 }).stroke({ width: 2, color, alpha: 0.55 });
      for (let k = 0; k < 2; k++) {
        const a0 = t * 3 + k * Math.PI;
        arc(g, w.x, w.y, R * 0.8, a0, Math.PI * 0.7).stroke({ width: 4, color, alpha: 0.9 });
        arc(g, w.x, w.y, R * 0.5, -a0 * 1.5, Math.PI * 0.6).stroke({ width: 3, color: PALETTE.core, alpha: 0.6 });
      }
      g.circle(w.x, w.y, R * 0.18 * pulse).fill({ color: PALETTE.core, alpha: 0.9 });
      // The exit: a dashed ring, turning the other way, with a faint centre.
      const ex = w.exitX;
      const ey = w.exitY;
      const dashes = 8;
      for (let k = 0; k < dashes; k++) {
        const a0 = -t * 2 + (k / dashes) * Math.PI * 2;
        arc(g, ex, ey, R * 0.85, a0, (Math.PI * 2) / dashes / 2).stroke({ width: 3, color, alpha: 0.8 });
      }
      g.circle(ex, ey, R * 0.25 * pulse).fill({ color, alpha: 0.35 });
    }
  }
}

/** An arc as its own sub-path: without the moveTo, Pixi joins it to wherever the path last ended. */
function arc(g: Graphics, cx: number, cy: number, r: number, from: number, sweep: number): Graphics {
  return g.moveTo(cx + Math.cos(from) * r, cy + Math.sin(from) * r).arc(cx, cy, r, from, from + sweep);
}
