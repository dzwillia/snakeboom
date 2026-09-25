import { Graphics } from 'pixi.js';
import { ARENA_HEIGHT, ARENA_WIDTH, TILE_COLS, TILE_SIZE, type SnakeState } from '../../sim';
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

const MAX_PARTICLES = 2500;

/**
 * Client-only juice: sparks, shockwave rings, flashes, screen shake, a camera that can punch in
 * around a point, and a full-screen flash. Reduced motion turns off shake, flashes and the punch.
 */
export class Fx {
  /** Scales particle and ring time (hit-stop and slow motion); shake always decays in real time. */
  timeScale = 1;
  private readonly g = new Graphics();
  /** Full-screen flashes, drawn above the bloom layer with normal blending. */
  private readonly overlay = new Graphics();
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private shake = 0;
  private screenFlash = 0;
  private chainFlash = 0;
  private camera = { zoom: 1, x: 0, y: 0 };

  constructor(
    private readonly world: World,
    private readonly settings: ClientSettings,
  ) {
    this.g.blendMode = 'add';
    world.glow.addChild(this.g);
    world.root.addChild(this.overlay);
  }

  /** Shatters a dead snake into sparks along its whole body, with a flash at the head. */
  deathBurst(s: SnakeState, color: number): void {
    const t = s.trail;
    const stride = Math.max(1, Math.floor((t.xs.length - t.start) / 260));
    for (let i = t.start; i < t.xs.length; i += stride) {
      if (!t.solid[i]) continue;
      this.spark(t.xs[i], t.ys[i], color, 30 + Math.random() * 110, 0.5 + Math.random() * 0.9, 2 + Math.random() * 2);
    }
    for (let k = 0; k < 70; k++) {
      const c = k % 3 === 0 ? 0xffffff : color;
      this.spark(s.x, s.y, c, 120 + Math.random() * 260, 0.4 + Math.random() * 0.8, 2 + Math.random() * 3);
    }
    this.ring(s.x, s.y, 90, 0.5, color);
    this.ring(s.x, s.y, 40, 0.3, 0xffffff);
    this.addShake(14);
  }

  /** A missile finding its mark: a flash, two rings and a fan of sparks in the victim's colour. */
  missileHit(x: number, y: number, color: number): void {
    this.flashes.push({ x, y, r: 60, life: 0.16, maxLife: 0.16 });
    this.ring(x, y, 70, 0.4, 0xffffff);
    this.ring(x, y, 45, 0.3, PALETTE.missile);
    for (let k = 0; k < 60; k++) {
      const c = k % 3 === 0 ? 0xffffff : k % 3 === 1 ? PALETTE.missile : color;
      this.spark(x, y, c, 150 + Math.random() * 350, 0.3 + Math.random() * 0.5, 2 + Math.random() * 3);
    }
    this.addShake(10);
  }

  /** Amber rubble from blocks that were blown up or crushed. */
  debris(tiles: readonly number[]): void {
    for (const index of tiles) {
      const tx = (index % TILE_COLS) * TILE_SIZE + TILE_SIZE / 2;
      const ty = Math.floor(index / TILE_COLS) * TILE_SIZE + TILE_SIZE / 2;
      for (let k = 0; k < 3; k++) {
        this.spark(tx, ty, PALETTE.obstacle, 60 + Math.random() * 180, 0.5 + Math.random() * 0.7, 3 + Math.random() * 2);
      }
    }
  }

  /** Losing a heart: a red burst and a jolt. */
  heartBurst(x: number, y: number): void {
    this.ring(x, y, 50, 0.4, 0xff3b5c);
    this.ring(x, y, 24, 0.25, 0xffffff);
    for (let k = 0; k < 36; k++) this.spark(x, y, k % 3 === 0 ? 0xffffff : 0xff3b5c, 120 + Math.random() * 220, 0.3 + Math.random() * 0.4, 2.5);
    this.addShake(10);
  }

  /** A Shield soaking up a hit: a bright green ring, sparks and a little shake. */
  shieldBurst(x: number, y: number): void {
    this.ring(x, y, 46, 0.4, PICKUP_COLORS.shield);
    this.ring(x, y, 26, 0.25, 0xffffff);
    for (let k = 0; k < 30; k++) this.spark(x, y, PICKUP_COLORS.shield, 120 + Math.random() * 200, 0.3 + Math.random() * 0.4, 2);
    this.addShake(6);
  }

  /** A close call: a quick spray of white and colored sparks off the head. */
  nearMissSparks(x: number, y: number, color: number): void {
    for (let k = 0; k < 14; k++) {
      this.spark(x, y, k % 2 === 0 ? 0xffffff : color, 90 + Math.random() * 160, 0.18 + Math.random() * 0.2, 1.5);
    }
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

  /** Zooms the camera by `zoom` around world point (x, y); 1 means no punch. */
  setCamera(zoom: number, x: number, y: number): void {
    this.camera = { zoom, x, y };
  }

  /** Sets the full-screen flash (the death beat drives this every frame). */
  setFlash(alpha: number): void {
    this.screenFlash = alpha;
  }

  clear(): void {
    this.particles = [];
    this.rings = [];
    this.flashes = [];
    this.shake = 0;
    this.screenFlash = 0;
    this.chainFlash = 0;
    this.camera = { zoom: 1, x: 0, y: 0 };
    this.g.clear();
    this.overlay.clear();
  }

  update(frameSeconds: number): void {
    const calm = this.settings.reduceMotion;
    const dt = frameSeconds * this.timeScale;
    const drag = Math.pow(0.04, dt);
    const g = this.g;
    g.clear();

    const flashAlpha = calm ? 0 : Math.max(this.screenFlash, this.chainFlash);
    this.overlay.clear();
    if (flashAlpha > 0.005) this.overlay.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT).fill({ color: 0xffffff, alpha: flashAlpha });
    this.chainFlash *= Math.pow(0.0005, frameSeconds);

    this.flashes = this.flashes.filter((f) => (f.life -= dt) > 0);
    for (const f of this.flashes) {
      const k = 1 - f.life / f.maxLife;
      g.circle(f.x, f.y, f.r * (0.55 + 0.45 * k)).fill({ color: 0xffffff, alpha: (calm ? 0.35 : 0.75) * (1 - k) });
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
    const shake = calm ? 0 : this.shake;
    const jitter = () => (shake > 0.3 ? (Math.random() * 2 - 1) * shake * b.scale : 0);
    const zoom = calm ? 1 : this.camera.zoom;
    this.world.root.scale.set(b.scale * zoom);
    this.world.root.position.set(
      b.x + this.camera.x * b.scale * (1 - zoom) + jitter(),
      b.y + this.camera.y * b.scale * (1 - zoom) + jitter(),
    );
  }
}
