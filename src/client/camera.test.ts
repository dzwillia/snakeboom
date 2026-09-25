import { describe, expect, it } from 'vitest';
import { clampView, easeView, fitView, followView, MAX_ZOOM, MIN_ZOOM } from './camera';

const W = 3200;
const H = 2000;

// M12 Review Focus 2: the camera never shows outside the arena and never loses a head.
describe('camera', () => {
  it('fits two far-apart heads at zoom 1 and two close heads at zoom 2, centred between them', () => {
    const far = fitView([{ x: 200, y: 200 }, { x: 3000, y: 1800 }], W, H);
    expect(far.zoom).toBe(MIN_ZOOM);
    expect(far).toMatchObject({ cx: 1600, cy: 1000 });
    const close = fitView([{ x: 1500, y: 900 }, { x: 1700, y: 1100 }], W, H);
    expect(close.zoom).toBe(MAX_ZOOM);
    expect(close).toMatchObject({ cx: 1600, cy: 1000 });
  });

  it('keeps both heads inside the visible rectangle at whatever zoom it picks', () => {
    const heads = [{ x: 300, y: 1700 }, { x: 1400, y: 1900 }];
    const v = fitView(heads, W, H);
    const halfW = W / v.zoom / 2;
    const halfH = H / v.zoom / 2;
    for (const h of heads) {
      expect(h.x).toBeGreaterThanOrEqual(v.cx - halfW);
      expect(h.x).toBeLessThanOrEqual(v.cx + halfW);
      expect(h.y).toBeGreaterThanOrEqual(v.cy - halfH);
      expect(h.y).toBeLessThanOrEqual(v.cy + halfH);
    }
  });

  it('follows a head near a corner without showing outside the arena', () => {
    const v = followView({ x: 50, y: 50 }, W, H);
    expect(v.zoom).toBe(MAX_ZOOM);
    expect(v).toMatchObject({ cx: 800, cy: 500 });
    const far = followView({ x: 3190, y: 1990 }, W, H);
    expect(far).toMatchObject({ cx: 2400, cy: 1500 });
  });

  it('clamps and eases', () => {
    expect(clampView({ cx: -100, cy: 5000, zoom: 2 }, W, H)).toEqual({ cx: 800, cy: 1500, zoom: 2 });
    const start = { cx: 0, cy: 0, zoom: 1 };
    const target = { cx: 1000, cy: 500, zoom: 2 };
    const step = easeView(start, target, 0.1);
    expect(step.cx).toBeGreaterThan(0);
    expect(step.cx).toBeLessThan(1000);
    expect(easeView(start, target, 0.1, true)).toEqual(target);
    let v = start;
    for (let i = 0; i < 120; i++) v = easeView(v, target, 1 / 60);
    expect(v.cx).toBeCloseTo(1000, 0);
    expect(v.zoom).toBeCloseTo(2, 2);
  });

  it('centres an empty arena', () => {
    expect(fitView([], W, H)).toEqual({ cx: 1600, cy: 1000, zoom: 1 });
  });
});
