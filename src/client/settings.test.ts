import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../sim';
import { DEFAULT_SETTINGS, loadStored, mergeSaved, saveStored } from './settings';

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
