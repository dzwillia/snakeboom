/**
 * Even-odd ray casting: is (x, y) inside the polygon given as flat [x0, y0, x1, y1, ...]?
 * A point exactly on an edge counts as inside, so a head skimming the loop is caught.
 */
export function pointInPolygon(x: number, y: number, poly: readonly number[]): boolean {
  const n = poly.length >> 1;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i];
    const yi = poly[2 * i + 1];
    const xj = poly[2 * j];
    const yj = poly[2 * j + 1];
    // On the edge (within a hair): inside.
    const cross = (xj - xi) * (y - yi) - (yj - yi) * (x - xi);
    if (Math.abs(cross) < 1e-9 && x >= Math.min(xi, xj) - 1e-9 && x <= Math.max(xi, xj) + 1e-9 && y >= Math.min(yi, yj) - 1e-9 && y <= Math.max(yi, yj) + 1e-9) {
      return true;
    }
    if (yi > y !== yj > y) {
      const xAt = xi + ((y - yi) * (xj - xi)) / (yj - yi);
      if (x < xAt) inside = !inside;
    }
  }
  return inside;
}

/** At most `max` points from a flat polygon, keeping the first and last, for effects. */
export function decimatePolygon(poly: readonly number[], max: number): number[] {
  const n = poly.length >> 1;
  if (n <= max) return poly.slice();
  const out: number[] = [];
  for (let k = 0; k < max; k++) {
    const i = Math.round((k * (n - 1)) / (max - 1));
    out.push(poly[2 * i], poly[2 * i + 1]);
  }
  return out;
}
