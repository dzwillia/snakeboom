import { Container, Graphics, Text } from 'pixi.js';
import { TICK_RATE, type Config, type EffectName, type SnakeState, type Trail } from '../../sim';
import { blinkOn } from '../blink';
import { PALETTE, PICKUP_COLORS } from '../colors';

/** Points per body chunk. Only the tail and head chunks are redrawn each frame. */
const CHUNK = 128;

/** The timed specials the head counts down, innermost ring first. */
const TIMED: EffectName[] = ['dozer', 'scissors', 'flame', 'ghost'];
/** Countdown ring radius and spacing, in screen pixels (they keep their size whatever the zoom). */
const RING_PX = 22;
const RING_GAP_PX = 5;
const RING_WIDTH_PX = 3;
const LABEL_PX = 13;

function effectSeconds(cfg: Config, effect: EffectName): number {
  switch (effect) {
    case 'dozer':
      return cfg.dozerDuration;
    case 'scissors':
      return cfg.scissorsDuration;
    case 'flame':
      return cfg.flameDuration;
    case 'ghost':
      return cfg.ghostDuration;
  }
}

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
  /** The countdown ring(s) and the seconds left, drawn above the head at a constant screen size. */
  private readonly timer = new Graphics();
  private readonly label = new Text({
    text: '',
    style: { fontFamily: 'Orbitron, system-ui, sans-serif', fontSize: LABEL_PX, fontWeight: '700', fill: 0xffffff },
  });
  private lastLabel = '';
  private readonly chunks = new Map<number, Chunk>();
  private lastHoleVersion = -1;

  constructor(
    parent: Container,
    private readonly color: number,
  ) {
    const layer = new Container();
    this.label.anchor.set(0.5, 1);
    this.label.visible = false;
    layer.addChild(this.tubes, this.cores, this.head, this.timer, this.label);
    parent.addChild(layer);
  }

  reset(): void {
    for (const chunk of this.chunks.values()) destroyChunk(chunk);
    this.chunks.clear();
    this.lastHoleVersion = -1;
    this.head.clear();
    this.timer.clear();
    this.label.visible = false;
    this.setVisible(true);
  }

  hide(): void {
    this.setVisible(false);
  }

  /** `worldScale` is screen pixels per world unit, so the countdown can keep its size on screen. */
  update(s: SnakeState, alpha: number, cfg: Config, t: number, offset?: { x: number; y: number }, worldScale = 1): void {
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

    // A hole change redraws every chunk once (nothing makes holes any more, but the field stays).
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
    this.drawCountdown(s, hx, hy, cfg, worldScale);
  }

  private setVisible(visible: boolean): void {
    this.tubes.visible = visible;
    this.cores.visible = visible;
    this.head.visible = visible;
    this.timer.visible = visible;
    if (!visible) this.label.visible = false;
  }

  /**
   * One ring per running timed special, in its colour, emptying clockwise from the top as the
   * time runs out, and the seconds left of the one ending soonest just above the head.
   */
  private drawCountdown(s: SnakeState, x: number, y: number, cfg: Config, worldScale: number): void {
    const g = this.timer;
    g.clear();
    const px = 1 / Math.max(1e-6, worldScale);
    let ring = 0;
    let soonest: { ticks: number; color: number } | null = null;
    for (const effect of TIMED) {
      const ticks = s.effects[effect];
      if (ticks <= 0) continue;
      const total = Math.max(1, Math.round(effectSeconds(cfg, effect) * TICK_RATE));
      const left = Math.min(1, ticks / total);
      const color = PICKUP_COLORS[effect];
      const radius = (RING_PX + ring * (RING_GAP_PX + RING_WIDTH_PX)) * px;
      g.circle(x, y, radius).stroke({ width: RING_WIDTH_PX * px, color, alpha: 0.25 });
      if (left > 0.002) {
        const from = -Math.PI / 2;
        g.moveTo(x + Math.cos(from) * radius, y + Math.sin(from) * radius)
          .arc(x, y, radius, from, from + Math.PI * 2 * left)
          .stroke({ width: RING_WIDTH_PX * px, color, alpha: 0.95, cap: 'round' });
      }
      if (!soonest || ticks < soonest.ticks) soonest = { ticks, color };
      ring++;
    }
    if (!soonest) {
      this.label.visible = false;
      this.lastLabel = '';
      return;
    }
    const text = (soonest.ticks / TICK_RATE).toFixed(1);
    if (text !== this.lastLabel) {
      this.lastLabel = text;
      this.label.text = text;
    }
    this.label.style.fill = soonest.color;
    this.label.scale.set(px);
    const top = (RING_PX + (ring - 1) * (RING_GAP_PX + RING_WIDTH_PX) + RING_WIDTH_PX + 3) * px;
    this.label.position.set(x, y - top);
    this.label.visible = true;
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

    if (shows(e.scissors)) {
      // Two blades scissoring ahead of the head.
      const hx = Math.cos(s.heading);
      const hy = Math.sin(s.heading);
      const open = 0.35 + 0.3 * Math.abs(Math.sin(t * 14));
      for (const side of [-1, 1]) {
        const ax = hx * Math.cos(open * side) - hy * Math.sin(open * side);
        const ay = hx * Math.sin(open * side) + hy * Math.cos(open * side);
        g.moveTo(x + hx * r * 0.6, y + hy * r * 0.6).lineTo(x + ax * r * 3.2, y + ay * r * 3.2);
      }
      g.stroke({ width: 3, color: PICKUP_COLORS.scissors, cap: 'round' });
    }

    if (shows(e.flame)) {
      // A cone of fire: layered tongues that flicker in length and sway, bright at the core.
      const hx = Math.cos(s.heading);
      const hy = Math.sin(s.heading);
      const range = cfg.flameRange;
      const spread = cfg.flameSpread;
      const tongues = 7;
      for (let k = 0; k < tongues; k++) {
        const a = -spread + ((k + 0.5) / tongues) * spread * 2 + Math.sin(t * 23 + k * 1.7) * 0.06;
        const len = range * (0.8 + 0.2 * Math.sin(t * 31 + k * 2.3)) * (1 - 0.3 * Math.abs(a) / spread);
        const dx = hx * Math.cos(a) - hy * Math.sin(a);
        const dy = hx * Math.sin(a) + hy * Math.cos(a);
        const w = r * 0.9;
        const tipX = x + dx * len;
        const tipY = y + dy * len;
        g.poly([x + dx * r - dy * w, y + dy * r + dx * w, tipX, tipY, x + dx * r + dy * w, y + dy * r - dx * w])
          .fill({ color: k % 2 === 0 ? PICKUP_COLORS.flame : 0xffd23f, alpha: 0.45 });
      }
      // The hot core.
      const coreLen = range * (0.45 + 0.1 * Math.sin(t * 40));
      g.poly([x + hx * r - hy * r * 0.5, y + hy * r + hx * r * 0.5, x + hx * coreLen, y + hy * coreLen, x + hx * r + hy * r * 0.5, y + hy * r - hx * r * 0.5])
        .fill({ color: 0xffffff, alpha: 0.6 });
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
