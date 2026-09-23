import { Graphics } from 'pixi.js';
import type { SnakeState } from '../../sim';
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

const MAX_PARTICLES = 1500;

/** Client-only juice: sparks, shockwave rings and screen shake, driven by sim events. */
export class Fx {
  /** Scales particle and ring time (slow motion); shake always decays in real time. */
  timeScale = 1;
  private readonly g = new Graphics();
  private particles: Particle[] = [];
  private rings: Ring[] = [];
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
    this.shake = 0;
    this.g.clear();
  }

  update(frameSeconds: number): void {
    const dt = frameSeconds * this.timeScale;
    const drag = Math.pow(0.04, dt);
    const g = this.g;
    g.clear();

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
