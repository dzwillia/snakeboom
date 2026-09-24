import { describe, expect, it } from 'vitest';
import { isTouchOnly } from './device';

const mq = (truthy: string[]) => (query: string) => truthy.includes(query);

describe('isTouchOnly', () => {
  it('is true for a coarse pointer with no hover (phones and tablets)', () => {
    expect(isTouchOnly(mq(['(pointer: coarse)']))).toBe(true);
  });

  it('is false when the device can hover (a laptop with a touchscreen) or has a fine pointer', () => {
    expect(isTouchOnly(mq(['(pointer: coarse)', '(hover: hover)']))).toBe(false);
    expect(isTouchOnly(mq(['(pointer: fine)', '(hover: hover)']))).toBe(false);
    expect(isTouchOnly(mq([]))).toBe(false);
  });
});
