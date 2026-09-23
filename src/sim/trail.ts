import type { Trail } from './types';

const COMPACT_AFTER = 4096;

export function createTrail(): Trail {
  return { xs: [], ys: [], cum: [], solid: [], start: 0, baseSeq: 0 };
}

/** Appends a point and returns its sequence number. */
export function trailPush(t: Trail, x: number, y: number): number {
  const n = t.xs.length;
  let c = 0;
  if (n > 0) {
    const dx = x - t.xs[n - 1];
    const dy = y - t.ys[n - 1];
    c = t.cum[n - 1] + Math.sqrt(dx * dx + dy * dy);
  }
  t.xs.push(x);
  t.ys.push(y);
  t.cum.push(c);
  t.solid.push(true);
  return t.baseSeq + n;
}

export function headCum(t: Trail): number {
  return t.cum[t.xs.length - 1];
}

/** Path length from tail to head. */
export function trailLength(t: Trail): number {
  const last = t.xs.length - 1;
  return last > t.start ? t.cum[last] - t.cum[t.start] : 0;
}

/** Drops tail points until the path is no longer than `target`. Never drops the head. */
export function trailTrim(t: Trail, target: number): void {
  const last = t.xs.length - 1;
  while (t.start < last && t.cum[last] - t.cum[t.start] > target) t.start++;
  if (t.start > COMPACT_AFTER && t.start * 2 > t.xs.length) compact(t);
}

function compact(t: Trail): void {
  const s = t.start;
  t.xs.splice(0, s);
  t.ys.splice(0, s);
  t.cum.splice(0, s);
  t.solid.splice(0, s);
  t.baseSeq += s;
  t.start = 0;
}
