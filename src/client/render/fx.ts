import { Graphics } from 'pixi.js';
import { TILE_COLS, TILE_SIZE, type SnakeState } from '../../sim';
import { PALETTE, PICKUP_COLORS } from '../colors';
import type { ClientSettings } from '../settings';
import type { World } from './world';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  size: number;
}

interface Ring {
  x: number;
  y: number;
  maxR: number;
  life: number;
  maxLife: number;
  color: number;
}

interface Flash {
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
}

const MAX_PARTICLES = 2000;

/** Client-only juice: sparks, shockwave rings, flashes and screen shake, driven by sim events. */
export class Fx {
  /** Scales particle and ring time (slow motion); shake always decays in real time. */
  timeScale = 1;
  private readonly g = new Graphics();
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private shake = 0;

  constructor(
    private readonly world: World,
    private readonly settings: ClientSettings,
  ) {
    this.g.blendMode = 'add';
    world.glow.addChild(this.g);
  }

  /** Shatters a dead snake into sparks along its whole body, with a flash at the head. */
  deathBurst(s: SnakeState, color: number): void {
    const t = s.trail;
    const stride = Math.max(1, Math.floor((t.xs.length - t.start) / 220));
    for (let i = t.start; i < t.xs.length; i += stride) {
      if (!t.solid[i]) continue;
      this.spark(t.xs[i], t.ys[i], color, 30 + Math.random() * 110, 0.5 + Math.random() * 0.9, 2 + Math.random() * 2);
    }
    for (let k = 0; k < 60; k++) {
      const c = k % 3 === 0 ? 0xffffff : color;
      this.spark(s.x, s.y, c, 120 + Math.random() * 260, 0.4 + Math.random() * 0.8, 2 + Math.random() * 3);
    }
    this.ring(s.x, s.y, 90, 0.5, color);
    this.ring(s.x, s.y, 40, 0.3, 0xffffff);
    this.addShake(14);
  }

  /** A bomb going off: flash, shockwave, sparks, and amber debris from destroyed blocks. */
  explosion(x: number, y: number, radius: number, chainDepth: number, tiles: readonly number[]): void {
    this.flashes.push({ x, y, r: radius, life: 0.18, maxLife: 0.18 });
    this.ring(x, y, radius * 1.15, 0.45, 0xffffff);
    this.ring(x, y, radius * 0.8, 0.32, PALETTE.fuse);
    for (let k = 0; k < 70; k++) {
      const c = k % 4 === 0 ? 0xffffff : k % 2 === 0 ? PALETTE.bomb : PALETTE.fuse;
      this.spark(x, y, c, 150 + Math.random() * 380, 0.3 + Math.random() * 0.6, 2 + Math.random() * 3);
    }
    for (const index of tiles) {
      const tx = (index % TILE_COLS) * TILE_SIZE + TILE_SIZE / 2;
      const ty = Math.floor(index / TILE_COLS) * TILE_SIZE + TILE_SIZE / 2;
      for (let k = 0; k < 3; k++) {
        this.spark(tx, ty, PALETTE.obstacle, 60 + Math.random() * 180, 0.5 + Math.random() * 0.7, 3 + Math.random() * 2);
      }
    }
    this.addShake(8 + 4 * Math.min(chainDepth, 4));
  }

  /** A Shield soaking up a hit: a bright green ring, sparks and a little shake. */
  shieldBurst(x: number, y: number): void {
    this.ring(x, y, 46, 0.4, PICKUP_COLORS.shield);
    this.ring(x, y, 26, 0.25, 0xffffff);
    for (let k = 0; k < 30; k++) this.spark(x, y, PICKUP_COLORS.shield, 120 + Math.random() * 200, 0.3 + Math.random() * 0.4, 2);
    this.addShake(6);
  }

  pickupBurst(x: number, y: number, color: number): void {
    this.ring(x, y, 34, 0.3, color);
    for (let k = 0; k < 18; k++) this.spark(x, y, color, 80 + Math.random() * 140, 0.25 + Math.random() * 0.3, 2);
  }

  ring(x: number, y: number, maxR: number, life: number, color: number): void {
    this.rings.push({ x, y, maxR, life, maxLife: life, color });
  }

  spark(x: number, y: number, color: number, speed: number, life: number, size: number): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    const a = Math.random() * Math.PI * 2;
    this.particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life, maxLife: life, color, size });
  }

  addShake(amount: number): void {
    this.shake = Math.min(30, this.shake + amount * this.settings.shakeScale);
  }

  clear(): void {
    this.particles = [];
    this.rings = [];
    this.flashes = [];
    this.shake = 0;
    this.g.clear();
  }

  update(frameSeconds: number): void {
    const dt = frameSeconds * this.timeScale;
    const drag = Math.pow(0.04, dt);
    const g = this.g;
    g.clear();

    this.flashes = this.flashes.filter((f) => (f.life -= dt) > 0);
    for (const f of this.flashes) {
      const k = 1 - f.life / f.maxLife;
      g.circle(f.x, f.y, f.r * (0.55 + 0.45 * k)).fill({ color: 0xffffff, alpha: 0.75 * (1 - k) });
    }

    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    for (const p of this.particles) {
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      g.moveTo(p.x, p.y)
        .lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03)
        .stroke({ width: p.size, color: p.color, alpha: p.life / p.maxLife, cap: 'round' });
    }

    this.rings = this.rings.filter((r) => (r.life -= dt) > 0);
    for (const r of this.rings) {
      const k = 1 - r.life / r.maxLife;
      const radius = r.maxR * (1 - (1 - k) * (1 - k));
      g.circle(r.x, r.y, radius).stroke({ width: 3 + 6 * (1 - k), color: r.color, alpha: 1 - k });
    }

    this.shake *= Math.pow(0.001, frameSeconds);
    const b = this.world.base;
    const jitter = () => (this.shake > 0.3 ? (Math.random() * 2 - 1) * this.shake * b.scale : 0);
    this.world.root.position.set(b.x + jitter(), b.y + jitter());
  }
}
