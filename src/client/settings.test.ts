import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../sim';
import { DEFAULT_SETTINGS, loadStored, mergeSaved, resetInPlace, saveStored, settingsDefaults } from './settings';

describe('mergeSaved', () => {
  const defaults = { speed: 170, on: true, weights: { a: 1, b: 2 } };

  it('keeps valid saved values and ignores unknown keys', () => {
    const saved = { speed: 200, on: false, weights: { a: 5, b: 'x' }, extra: 1 };
    expect(mergeSaved(defaults, saved)).toEqual({ speed: 200, on: false, weights: { a: 5, b: 2 } });
  });

  // Review Focus 5: corrupted or outdated saved settings.
  it('rejects wrong types, NaN and Infinity', () => {
    expect(mergeSaved(defaults, { speed: 'fast', on: 1, weights: 3 })).toEqual(defaults);
    expect(mergeSaved(defaults, { speed: Number.NaN })).toEqual(defaults);
    expect(mergeSaved(defaults, JSON.parse('{"speed": 1e999}'))).toEqual(defaults);
    expect(mergeSaved(defaults, [1, 2])).toEqual(defaults);
  });

  it('returns a fresh copy', () => {
    const out = mergeSaved(defaults, null);
    out.weights.a = 99;
    expect(defaults.weights.a).toBe(1);
  });
});

describe('settingsDefaults', () => {
  // Review Focus 2: honor prefers-reduced-motion until the player chooses.
  it('turns on reduced motion when the system asks for it', () => {
    expect(settingsDefaults(true).reduceMotion).toBe(true);
    expect(settingsDefaults(false)).toEqual(DEFAULT_SETTINGS);
  });

  it("lets a player's saved choice win over the system default", () => {
    const storage = { getItem: () => JSON.stringify({ reduceMotion: false }) };
    expect(loadStored(storage, 'k', settingsDefaults(true)).reduceMotion).toBe(false);
  });
});

describe('resetInPlace', () => {
  // M3 Review Focus 5: tuning-panel sliders stay bound to the live weights object.
  it('restores defaults while keeping nested objects the same instances', () => {
    const live = structuredClone(DEFAULT_CONFIG);
    const weights = live.pickupWeights;
    live.baseSpeed = 999;
    weights.bomb = 0;
    resetInPlace(live, DEFAULT_CONFIG);
    expect(live).toEqual(DEFAULT_CONFIG);
    expect(live.pickupWeights).toBe(weights);
    expect(live.pickupWeights).not.toBe(DEFAULT_CONFIG.pickupWeights);
  });
});

describe('loadStored / saveStored', () => {
  it('falls back to defaults on corrupted JSON', () => {
    expect(loadStored({ getItem: () => '{not json' }, 'k', DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
  });

  it('falls back to defaults when storage throws or is missing', () => {
    const throwing = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
    };
    expect(loadStored(throwing, 'k', DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(loadStored(undefined, 'k', DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips values', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveStored(storage, 'k', { ...DEFAULT_SETTINGS, muted: true });
    expect(loadStored(storage, 'k', DEFAULT_SETTINGS).muted).toBe(true);
  });
});
