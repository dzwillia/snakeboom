import { describe, expect, it } from 'vitest';
import { RelayClock } from './clock';

describe('RelayClock', () => {
  it('is unsynced before the first ping', () => {
    const c = new RelayClock();
    expect(c.synced).toBe(false);
    expect(c.toRelay(100)).toBeNull();
    expect(c.toLocal(500)).toBe(500);
  });

  it('learns the offset from the first ping and smooths later ones', () => {
    const c = new RelayClock();
    c.onPing(10_000, 1_000, 80);
    expect(c.toRelay(1_000)).toBe(10_040);
    for (let i = 1; i <= 5; i++) c.onPing(10_000 + i * 1000, 1_000 + i * 1000, 80);
    expect(c.toRelay(6_000)).toBeCloseTo(15_040, 5);
    c.onPing(20_000, 11_000 - 100, 80);
    expect(c.toRelay(11_000)).toBeGreaterThan(20_040);
    expect(c.toRelay(11_000)).toBeLessThan(20_140);
  });

  it('round-trips between the clocks', () => {
    const c = new RelayClock();
    c.onPing(5_000, 200, 40);
    expect(c.toLocal(c.toRelay(777)!)).toBeCloseTo(777, 9);
  });
});
