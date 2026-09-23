import { Application, Container } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../../sim';
import { PALETTE } from '../colors';
import type { ClientSettings } from '../settings';

export const HUD_HEIGHT = 64;
const MARGIN = 16;

export interface World {
  app: Application;
  /** Scaled and letterboxed to fit the arena under the HUD; shaken by Fx via `base`. */
  root: Container;
  /** Layers that should not bloom (background grid). */
  bg: Container;
  /** Layers that bloom (border, blocks, snakes, effects). */
  glow: Container;
  bloom: AdvancedBloomFilter;
  base: { x: number; y: number; scale: number };
}

export async function createWorld(host: HTMLElement, settings: ClientSettings): Promise<World> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: PALETTE.background,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    powerPreference: 'high-performance',
  });
  host.appendChild(app.canvas);

  const root = new Container();
  const bg = new Container();
  const glow = new Container();
  root.addChild(bg, glow);
  app.stage.addChild(root);

  const bloom = new AdvancedBloomFilter({ threshold: 0.2, bloomScale: 1.5, brightness: 1, blur: 8, quality: 6 });
  const world: World = { app, root, bg, glow, bloom, base: { x: 0, y: 0, scale: 1 } };
  applyBloom(world, settings);

  const layout = () => {
    const w = app.screen.width;
    const h = app.screen.height;
    const scale = Math.max(0.1, Math.min((w - 2 * MARGIN) / ARENA_WIDTH, (h - HUD_HEIGHT - MARGIN) / ARENA_HEIGHT));
    world.base.scale = scale;
    world.base.x = (w - ARENA_WIDTH * scale) / 2;
    world.base.y = HUD_HEIGHT + (h - HUD_HEIGHT - MARGIN - ARENA_HEIGHT * scale) / 2;
    root.scale.set(scale);
    root.position.set(world.base.x, world.base.y);
  };
  layout();
  app.renderer.on('resize', layout);
  return world;
}

export function applyBloom(world: World, settings: ClientSettings): void {
  world.bloom.threshold = settings.bloomThreshold;
  world.bloom.bloomScale = settings.bloomStrength;
  world.glow.filters = settings.bloom ? [world.bloom] : [];
}
