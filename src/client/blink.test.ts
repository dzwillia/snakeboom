import { describe, expect, it } from 'vitest';
import { blinkOn } from './blink';

/** How many times the flash toggles over one second at `left` seconds remaining. */
function toggles(left: number, warning: number): number {
  let count = 0;
  let prev = blinkOn(left, warning, 0);
  for (let k = 1; k <= 600; k++) {
    const now = blinkOn(left, warning, k / 600);
    if (now !== prev) count++;
    prev = now;
  }
  return count;
}

describe('blinkOn', () => {
  it('stays on while more than the warning time is left', () => {
    for (let k = 0; k < 20; k++) expect(blinkOn(5, 3, k * 0.05)).toBe(true);
  });

  it('flashes on and off inside the warning window', () => {
    const samples = Array.from({ length: 40 }, (_, k) => blinkOn(2, 3, k * 0.025));
    expect(samples).toContain(true);
    expect(samples).toContain(false);
  });

  it('flashes faster as the end nears', () => {
    expect(toggles(0.2, 3)).toBeGreaterThan(toggles(2.9, 3) * 2);
  });

  it('never flashes when the warning is zero', () => {
    expect(blinkOn(0.5, 0, 0.3)).toBe(true);
  });
});
