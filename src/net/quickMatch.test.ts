import { describe, expect, it } from 'vitest';
import { QuickMatch } from './quickMatch';

describe('QuickMatch', () => {
  it('hands out the oldest open room first', () => {
    const q = new QuickMatch();
    expect(q.offer('AAAAAA')).toBe(true);
    expect(q.offer('BBBBBB')).toBe(true);
    expect(q.size).toBe(2);
    expect(q.take()).toBe('AAAAAA');
    expect(q.take()).toBe('BBBBBB');
    expect(q.take()).toBeNull();
  });

  it('skips the caller’s own room', () => {
    const q = new QuickMatch();
    q.offer('AAAAAA');
    expect(q.take('AAAAAA')).toBeNull();
    q.offer('BBBBBB');
    expect(q.take('AAAAAA')).toBe('BBBBBB');
    expect(q.open).toEqual(['AAAAAA']);
  });

  it('ignores duplicate offers and unknown withdrawals', () => {
    const q = new QuickMatch();
    q.offer('AAAAAA');
    expect(q.offer('AAAAAA')).toBe(false);
    q.withdraw('ZZZZZZ');
    expect(q.size).toBe(1);
    q.withdraw('AAAAAA');
    expect(q.size).toBe(0);
    expect(q.has('AAAAAA')).toBe(false);
  });
});
