import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { applyOverrides, CONFIG_FOLDERS, describeOverrides, diffConfig, hasOverrides, OVERRIDABLE_KEYS, overridesAsConfigLines, validateOverrides } from './configSchema';

describe('config schema', () => {
  it('covers every numeric, boolean and map field of the config, and nothing else', () => {
    const structural = new Set<string>([]);
    const keys = Object.keys(DEFAULT_CONFIG).filter((k) => !structural.has(k));
    for (const k of keys) expect(OVERRIDABLE_KEYS, `${k} has no row`).toContain(k);
    for (const k of OVERRIDABLE_KEYS) expect(keys).toContain(k);
    for (const folder of CONFIG_FOLDERS) {
      for (const row of folder.rows) {
        if (row.kind !== 'number') continue;
        const v = DEFAULT_CONFIG[row.key];
        expect(v, `${row.key} default outside its range`).toBeGreaterThanOrEqual(row.min);
        expect(v).toBeLessThanOrEqual(row.max);
      }
    }
  });

  it('accepts in-range values and rejects the rest, one problem each', () => {
    const { overrides, problems } = validateOverrides({
      hearts: 3,
      baseSpeed: 9999,
      collectByLoop: 'yes',
      maps: 'random',
      bogus: 1,
      pickupWeights: { missile: 50, flame: 0 },
    });
    expect(overrides).toEqual({ hearts: 3, maps: 'random', pickupWeights: { ...DEFAULT_CONFIG.pickupWeights, missile: 50, flame: 0 } });
    expect(problems).toEqual(['baseSpeed: 9999 is outside 60–400', 'collectByLoop: not true or false', 'bogus: not a tunable']);
    expect(validateOverrides([1]).problems).toEqual(['overrides must be an object']);
    expect(validateOverrides({ pickupWeights: { missile: 2.5 } }).problems[0]).toMatch(/whole number/);
    expect(validateOverrides({ pickupWeights: { laser: 1 } }).problems[0]).toMatch(/not a pickup/);
  });

  it('applies overrides on top of the defaults without touching them, and diffs back', () => {
    const cfg = applyOverrides(DEFAULT_CONFIG, { hearts: 3, pickupWeights: { ...DEFAULT_CONFIG.pickupWeights, missile: 50 } });
    expect(cfg.hearts).toBe(3);
    expect(cfg.pickupWeights.missile).toBe(50);
    expect(cfg.pickupWeights.ghost).toBe(DEFAULT_CONFIG.pickupWeights.ghost);
    expect(DEFAULT_CONFIG.hearts).toBe(1);
    expect(DEFAULT_CONFIG.pickupWeights.missile).not.toBe(50);
    expect(diffConfig(cfg)).toEqual({ hearts: 3, pickupWeights: { ...DEFAULT_CONFIG.pickupWeights, missile: 50 } });
    expect(diffConfig(DEFAULT_CONFIG)).toEqual({});
    expect(hasOverrides(diffConfig(DEFAULT_CONFIG))).toBe(false);
    expect(hasOverrides({ hearts: 2 })).toBe(true);
  });

  it('renders overrides as DEFAULT_CONFIG lines in the config\'s order', () => {
    const lines = overridesAsConfigLines({ pickupWeights: { ...DEFAULT_CONFIG.pickupWeights, missile: 50 }, hearts: 3, maps: 'random', baseSpeed: 320 });
    expect(lines.split('\n')).toEqual([
      '  baseSpeed: 320,',
      '  pickupWeights: { missile: 50, scissors: 15, flame: 15, ghost: 15, shield: 15, dozer: 10 },',
      '  hearts: 3,',
      "  maps: 'random',",
    ]);
    expect(overridesAsConfigLines({})).toBe('');
  });

  it('describes overrides with the panel labels', () => {
    expect(describeOverrides({ hearts: 3, collectByLoop: false, maps: 'random', pickupWeights: { ...DEFAULT_CONFIG.pickupWeights, missile: 50 } })).toEqual([
      'hearts 3',
      'loop a pickup to take it off',
      'rotation (from next round) random',
      'missile 50',
    ]);
  });
});
