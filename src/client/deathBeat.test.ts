import { describe, expect, it } from 'vitest';
import { deathBeatAt, FLASH_PEAK, PUNCH } from './deathBeat';

const beat = { hitStopSeconds: 0.12, slowMoScale: 0.3, slowMoSeconds: 0.8 };

describe('deathBeatAt', () => {
  it('starts frozen, flashing and punched in', () => {
    expect(deathBeatAt(0, beat)).toEqual({ fxTimeScale: 0, flash: FLASH_PEAK, zoom: 1 + PUNCH });
    expect(FLASH_PEAK).toBeLessThanOrEqual(0.3); // a flash, not a white-out
  });

  it('fades the flash across the hit-stop', () => {
    const mid = deathBeatAt(0.06, beat);
    expect(mid.fxTimeScale).toBe(0);
    expect(mid.flash).toBeCloseTo(FLASH_PEAK / 2, 9);
    expect(mid.zoom).toBeLessThan(1 + PUNCH);
  });

  it('runs in slow motion after the hit-stop, easing the camera back', () => {
    const slow = deathBeatAt(0.5, beat);
    expect(slow.fxTimeScale).toBe(0.3);
    expect(slow.flash).toBe(0);
    expect(slow.zoom).toBeGreaterThan(1);
  });

  // Review Focus 3: the beat always ends cleanly.
  it('returns to normal at the end, after it, and for nonsense times', () => {
    for (const t of [0.92, 5, -1, Number.NaN]) expect(deathBeatAt(t, beat)).toEqual({ fxTimeScale: 1, flash: 0, zoom: 1 });
  });

  it('copes with a zero-length hit-stop', () => {
    expect(deathBeatAt(0, { ...beat, hitStopSeconds: 0 })).toMatchObject({ fxTimeScale: 0.3, flash: 0 });
  });
});
