import { Container, Graphics } from 'pixi.js';
import type { SnakeState, Trail } from '../../sim';
import { PALETTE } from '../colors';

/** Points per body chunk. Only the tail and head chunks are redrawn each frame. */
const CHUNK = 128;

/** One chunk's two strokes; they live in separate layers so every core sits above every tube. */
interface Chunk {
  tube: Graphics;
  core: Graphics;
}

/** Draws one snake as a neon tube (colored stroke + bright core) with a glowing head. */
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

  update(s: SnakeState, alpha: number, radius: number): void {
    this.setVisible(true);
    const t = s.trail;
    const startSeq = t.baseSeq + t.start;
    const headSeq = t.baseSeq + t.xs.length - 1;
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
    const hx = s.prevX + (s.x - s.prevX) * alpha;
    const hy = s.prevY + (s.y - s.prevY) * alpha;
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
        this.drawChunk(chunk, t, k, startSeq, headSeq, hx, hy, radius);
      }
    }
    this.drawHead(hx, hy, s.heading, radius);
  }

  private setVisible(visible: boolean): void {
    this.tubes.visible = visible;
    this.cores.visible = visible;
    this.head.visible = visible;
  }

  private drawChunk(
    chunk: Chunk,
    t: Trail,
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
      const i = seq - t.baseSeq;
      if (!t.solid[i]) {
        if (run.length > 0) runs.push(run);
        run = [];
        continue;
      }
      if (seq === headSeq) run.push(hx, hy);
      else run.push(t.xs[i], t.ys[i]);
    }
    if (run.length > 0) runs.push(run);

    strokeRuns(chunk.tube, runs, radius * 2, this.color);
    strokeRuns(chunk.core, runs, Math.max(1.5, radius * 0.7), PALETTE.core);
  }

  private drawHead(x: number, y: number, heading: number, radius: number): void {
    const g = this.head;
    g.clear();
    g.circle(x, y, radius * 1.25).fill({ color: this.color });
    g.circle(x, y, radius * 0.7).fill({ color: PALETTE.core });
    const ex = x + Math.cos(heading) * radius * 0.55;
    const ey = y + Math.sin(heading) * radius * 0.55;
    g.circle(ex, ey, Math.max(1.2, radius * 0.28)).fill({ color: PALETTE.background });
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
