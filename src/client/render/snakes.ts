import { Container, Graphics } from 'pixi.js';
import { TICK_RATE, type Config, type SnakeState, type Trail } from '../../sim';
import { blinkOn } from '../blink';
import { PALETTE, PICKUP_COLORS } from '../colors';

/** Points per body chunk. Only the tail and head chunks are redrawn each frame. */
const CHUNK = 128;

/** One chunk's two strokes; they live in separate layers so every core sits above every tube. */
interface Chunk {
  tube: Graphics;
  core: Graphics;
}

/** Draws one snake as a neon tube (colored stroke + bright core) with a glowing, status-aware head. */
export class SnakeView {
  private readonly tubes = new Container();
  private readonly cores = new Container();
  private readonly head = new Graphics();
  private readonly chunks = new Map<number, Chunk>();
  private lastHoleVersion = -1;

  constructor(
    parent: Container,
    private readonly color: number,
  ) {
    const layer = new Container();
    layer.addChild(this.tubes, this.cores, this.head);
    parent.addChild(layer);
  }

  reset(): void {
    for (const chunk of this.chunks.values()) destroyChunk(chunk);
    this.chunks.clear();
    this.lastHoleVersion = -1;
    this.head.clear();
    this.setVisible(true);
  }

  hide(): void {
    this.setVisible(false);
  }

  update(s: SnakeState, alpha: number, cfg: Config, t: number, offset?: { x: number; y: number }): void {
    this.setVisible(true);
    const radius = cfg.snakeRadius;
    const trail = s.trail;
    const startSeq = trail.baseSeq + trail.start;
    const headSeq = trail.baseSeq + trail.xs.length - 1;
    const firstChunk = Math.floor(startSeq / CHUNK);
    const lastChunk = Math.floor(headSeq / CHUNK);

    for (const [k, chunk] of this.chunks) {
      if (k < firstChunk) {
        destroyChunk(chunk);
        this.chunks.delete(k);
      }
    }

    // Blasts punch holes anywhere along the body, so a new hole redraws every chunk once.
    const holesChanged = s.holeVersion !== this.lastHoleVersion;
    this.lastHoleVersion = s.holeVersion;
    // The offset is rollback smoothing (online): the drawn head lags a correction for a few frames.
    const hx = s.prevX + (s.x - s.prevX) * alpha + (offset?.x ?? 0);
    const hy = s.prevY + (s.y - s.prevY) * alpha + (offset?.y ?? 0);
    for (let k = firstChunk; k <= lastChunk; k++) {
      let chunk = this.chunks.get(k);
      const fresh = !chunk;
      if (!chunk) {
        chunk = { tube: new Graphics(), core: new Graphics() };
        this.chunks.set(k, chunk);
        this.tubes.addChild(chunk.tube);
        this.cores.addChild(chunk.core);
      }
      if (fresh || holesChanged || k === firstChunk || k >= lastChunk - 1) {
        this.drawChunk(chunk, trail, k, startSeq, headSeq, hx, hy, radius);
      }
    }
    this.drawHead(s, hx, hy, cfg, t);
  }

  private setVisible(visible: boolean): void {
    this.tubes.visible = visible;
    this.cores.visible = visible;
    this.head.visible = visible;
  }

  private drawChunk(
    chunk: Chunk,
    trail: Trail,
    k: number,
    startSeq: number,
    headSeq: number,
    hx: number,
    hy: number,
    radius: number,
  ): void {
    // Overlap one point with the previous chunk so chunks join seamlessly.
    const from = Math.max(k * CHUNK - 1, startSeq);
    const to = Math.min((k + 1) * CHUNK, headSeq);
    const runs: number[][] = [];
    let run: number[] = [];
    for (let seq = from; seq <= to; seq++) {
      const i = seq - trail.baseSeq;
      if (!trail.solid[i]) {
        if (run.length > 0) runs.push(run);
        run = [];
        continue;
      }
      if (seq === headSeq) run.push(hx, hy);
      else run.push(trail.xs[i], trail.ys[i]);
    }
    if (run.length > 0) runs.push(run);

    strokeRuns(chunk.tube, runs, radius * 2, this.color);
    strokeRuns(chunk.core, runs, Math.max(1.5, radius * 0.7), PALETTE.core);
  }

  /** The head plus status: ghost glow, shield ring, grace flash, bulldozer blade. */
  private drawHead(s: SnakeState, x: number, y: number, cfg: Config, t: number): void {
    const g = this.head;
    const r = cfg.snakeRadius;
    const e = s.effects;
    g.clear();

    // Every timed special flashes during its last cfg.effectWarning seconds.
    const shows = (ticks: number) => ticks > 0 && blinkOn(ticks / TICK_RATE, cfg.effectWarning, t);


    if (shows(e.dozer)) {
      // Bulldozer blade across the front of the head.
      const hx = Math.cos(s.heading);
      const hy = Math.sin(s.heading);
      const cx = x + hx * r * 1.7;
      const cy = y + hy * r * 1.7;
      const w = r * 1.6;
      const d = r * 0.7;
      g.poly([
        cx - hy * w,
        cy + hx * w,
        cx + hy * w,
        cy - hx * w,
        cx + hy * w * 0.8 - hx * d,
        cy - hx * w * 0.8 - hy * d,
        cx - hy * w * 0.8 - hx * d,
        cy + hx * w * 0.8 - hy * d,
      ])
        .fill({ color: PICKUP_COLORS.dozer })
        .stroke({ width: 1.5, color: PALETTE.core, alpha: 0.6 });
    }

    if (shows(e.ghost)) {
      g.circle(x, y, r * 2).fill({ color: PICKUP_COLORS.ghost, alpha: 0.25 });
      g.circle(x, y, r * 0.9).fill({ color: PICKUP_COLORS.ghost, alpha: 0.75 });
    } else {
      g.circle(x, y, r * 1.25).fill({ color: this.color });
      g.circle(x, y, r * 0.7).fill({ color: PALETTE.core });
    }
    const ex = x + Math.cos(s.heading) * r * 0.55;
    const ey = y + Math.sin(s.heading) * r * 0.55;
    g.circle(ex, ey, Math.max(1.2, r * 0.28)).fill({ color: PALETTE.background });

    if (s.shield) {
      g.circle(x, y, r * 3).stroke({ width: 3, color: PICKUP_COLORS.shield, alpha: 0.85 });
    }
    if (e.grace > 0 && Math.floor(t * 16) % 2 === 0) {
      g.circle(x, y, r * 3.5).stroke({ width: 3, color: PALETTE.core });
    }
  }
}

/** Opaque strokes, so the one-point overlap between chunks never shows a seam. */
function strokeRuns(g: Graphics, runs: readonly number[][], width: number, color: number): void {
  g.clear();
  for (const pts of runs) {
    if (pts.length === 2) {
      g.circle(pts[0], pts[1], width / 2).fill({ color });
      continue;
    }
    g.moveTo(pts[0], pts[1]);
    for (let j = 2; j < pts.length; j += 2) g.lineTo(pts[j], pts[j + 1]);
    g.stroke({ width, color, cap: 'round', join: 'round' });
  }
}

function destroyChunk(chunk: Chunk): void {
  chunk.tube.destroy();
  chunk.core.destroy();
}
