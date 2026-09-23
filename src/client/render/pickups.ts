import { Graphics, type Container } from 'pixi.js';
import { TICK_RATE, type Config, type PickupKind, type PickupState } from '../../sim';
import { PALETTE, PICKUP_COLORS } from '../colors';

/** Bobbing neon tiles with a glyph per kind; they blink during their last 3 seconds. */
export class PickupView {
  private readonly g = new Graphics();

  constructor(parent: Container) {
    parent.addChild(this.g);
  }

  clear(): void {
    this.g.clear();
  }

  draw(pickups: readonly PickupState[], cfg: Config, t: number): void {
    const g = this.g;
    g.clear();
    for (const p of pickups) {
      if (p.ttl < 3 * TICK_RATE && Math.floor(t * 8) % 2 === 0) continue;
      const size = cfg.pickupRadius * (1.2 + 0.08 * Math.sin(t * 5 + p.id));
      const y = p.y + Math.sin(t * 3 + p.id) * 2;
      const color = PICKUP_COLORS[p.kind];
      g.roundRect(p.x - size, y - size, size * 2, size * 2, size * 0.45)
        .fill({ color: PALETTE.background, alpha: 0.85 })
        .stroke({ width: 2.5, color });
      drawGlyph(g, p.kind, p.x, y, size * 0.6, color);
    }
  }
}

function drawGlyph(g: Graphics, kind: PickupKind, x: number, y: number, s: number, color: number): void {
  switch (kind) {
    case 'bomb':
      g.circle(x - s * 0.1, y + s * 0.15, s * 0.7).fill({ color });
      g.moveTo(x + s * 0.3, y - s * 0.4)
        .lineTo(x + s * 0.75, y - s * 0.9)
        .stroke({ width: 2, color: PALETTE.fuse, cap: 'round' });
      break;
    case 'ghost':
      g.circle(x, y - s * 0.15, s * 0.6).fill({ color });
      g.rect(x - s * 0.6, y - s * 0.15, s * 1.2, s * 0.75).fill({ color });
      g.circle(x - s * 0.22, y - s * 0.2, s * 0.14).fill({ color: PALETTE.background });
      g.circle(x + s * 0.22, y - s * 0.2, s * 0.14).fill({ color: PALETTE.background });
      break;
    case 'shield':
      g.poly([x, y - s * 0.9, x + s * 0.75, y - s * 0.55, x + s * 0.6, y + s * 0.35, x, y + s * 0.9, x - s * 0.6, y + s * 0.35, x - s * 0.75, y - s * 0.55]).stroke({
        width: 2.5,
        color,
        join: 'round',
      });
      break;
    case 'turbo':
      g.poly([x + s * 0.15, y - s * 0.95, x - s * 0.55, y + s * 0.1, x - s * 0.05, y + s * 0.1, x - s * 0.2, y + s * 0.95, x + s * 0.55, y - s * 0.15, x + s * 0.05, y - s * 0.15]).fill({
        color,
      });
      break;
    case 'slow':
      g.poly([x - s * 0.55, y - s * 0.8, x + s * 0.55, y - s * 0.8, x, y]).fill({ color });
      g.poly([x - s * 0.55, y + s * 0.8, x + s * 0.55, y + s * 0.8, x, y]).fill({ color });
      break;
    case 'reverse':
      g.moveTo(x - s * 0.7, y - s * 0.3)
        .lineTo(x + s * 0.45, y - s * 0.3)
        .moveTo(x + s * 0.7, y + s * 0.3)
        .lineTo(x - s * 0.45, y + s * 0.3)
        .stroke({ width: 2.5, color, cap: 'round' });
      g.poly([x + s * 0.8, y - s * 0.3, x + s * 0.35, y - s * 0.62, x + s * 0.35, y + s * 0.02]).fill({ color });
      g.poly([x - s * 0.8, y + s * 0.3, x - s * 0.35, y - s * 0.02, x - s * 0.35, y + s * 0.62]).fill({ color });
      break;
  }
}
