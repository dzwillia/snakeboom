import { describe, expect, it } from 'vitest';
import { RateLimit } from './rateLimit';

describe('RateLimit', () => {
  it('allows up to the limit per window and then refuses until the window slides', () => {
    const rl = new RateLimit(3, 1000);
    expect([rl.allow('a', 0), rl.allow('a', 100), rl.allow('a', 200)]).toEqual([true, true, true]);
    expect(rl.allow('a', 300)).toBe(false);
    expect(rl.allow('b', 300)).toBe(true);
    expect(rl.allow('a', 1001)).toBe(true);
    expect(rl.allow('a', 1050)).toBe(false);
    expect(rl.allow('a', 1201)).toBe(true);
  });

  it('prunes idle keys', () => {
    const rl = new RateLimit(1, 1000);
    rl.allow('a', 0);
    rl.prune(500);
    expect(rl.allow('a', 600)).toBe(false);
    rl.prune(2000);
    expect(rl.allow('a', 2000)).toBe(true);
  });
});
