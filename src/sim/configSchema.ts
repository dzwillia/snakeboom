import { DEFAULT_CONFIG, MAP_MODES, type Config, type MapMode, type PickupKind } from './config';

/**
 * The tunable config, described once: the tuning panel builds its rows from this, the relay
 * validates house rules against it, and the client lists what differs from the defaults.
 */
export type NumberKey = {
  [K in keyof Config]: Config[K] extends number ? K : never;
}[keyof Config];
export type BooleanKey = {
  [K in keyof Config]: Config[K] extends boolean ? K : never;
}[keyof Config];

export type ConfigRow =
  | { kind: 'number'; key: NumberKey; label: string; min: number; max: number; step: number }
  | { kind: 'boolean'; key: BooleanKey; label: string }
  | { kind: 'maps'; key: 'maps'; label: string; options: Record<string, MapMode> }
  | { kind: 'weights'; key: 'pickupWeights'; label: string; min: number; max: number; step: number };

export interface ConfigFolder {
  name: string;
  rows: ConfigRow[];
}

const n = (key: NumberKey, label: string, min: number, max: number, step: number): ConfigRow => ({ kind: 'number', key, label, min, max, step });

export const CONFIG_FOLDERS: readonly ConfigFolder[] = [
  {
    name: 'Movement',
    rows: [n('baseSpeed', 'speed', 60, 400, 5), n('turnRate', 'turn rate (rad/s)', 1, 8, 0.1), n('snakeRadius', 'thickness (radius)', 3, 14, 0.5)],
  },
  {
    name: 'Growth',
    rows: [
      n('startLength', 'start length', 20, 600, 10),
      n('growthPerSecond', 'growth per second', 0, 200, 5),
      n('overtimeAt', 'overtime at (s)', 10, 10000, 5),
      n('overtimeGrowthMultiplier', 'overtime growth ×', 1, 10, 0.5),
      n('roundMaxSeconds', 'round cap (s)', 20, 600, 5),
      n('roundSecondsPerExtraPlayer', 'cap + per extra player (s)', 0, 30, 1),
      n('roundMaxSecondsCap', 'cap at most (s)', 30, 600, 5),
      n('spawnClearance', 'spawn clearance (3+ players)', 0, 400, 10),
    ],
  },
  {
    name: 'Border',
    rows: [
      n('borderCloseSeconds', 'closes from (s before cap)', 0, 60, 1),
      n('borderCloseSpeed', 'close speed (units/s)', 0, 100, 1),
      n('borderCrushSpeed', 'crush speed after cap', 0, 400, 10),
    ],
  },
  {
    name: 'Boost',
    rows: [n('boostMultiplier', 'speed ×', 1, 3, 0.1), n('boostBurnPerSecond', 'burns body (units/s)', 0, 300, 5), n('minLength', 'min body to boost', 20, 400, 10)],
  },
  {
    name: 'Match',
    rows: [
      n('winsToWin', 'first to', 1, 10, 1),
      n('hearts', 'hearts', 1, 5, 1),
      n('heartGrace', 'grace after a hit (s)', 0, 3, 0.1),
      n('countdownSeconds', 'countdown (s)', 1, 5, 1),
      n('roundOverSeconds', 'round banner (s)', 1, 6, 0.5),
    ],
  },
  {
    name: 'Maps',
    rows: [
      { kind: 'maps', key: 'maps', label: 'rotation (from next round)', options: { 'Hand-made and random': 'both', 'Hand-made only': 'handmade', 'Random only': 'random' } },
      n('mapDensity', 'random map blocks', 0, 1, 0.05),
    ],
  },
  {
    name: 'Pickups',
    rows: [
      n('maxPickups', 'max on field', 0, 20, 1),
      n('slotLength', 'body per item slot', 30, 600, 10),
      n('itemSlots', 'item slots (max)', 1, 8, 1),
      n('firstPickupDelay', 'first spawn (s)', 0, 20, 0.5),
      n('pickupInterval', 'spawn every (s)', 0.5, 30, 0.5),
      n('pickupLifetime', 'lifetime (s)', 3, 60, 1),
      n('pickupRadius', 'size', 6, 30, 1),
      n('pickupMinHeadDistance', 'min distance from heads', 0, 800, 10),
      n('pickupClearance', 'clearance', 10, 120, 5),
    ],
  },
  {
    name: 'Missiles',
    rows: [
      n('missileCharges', 'shots per pickup', 1, 10, 1),
      n('missileCooldown', 'cooldown (s)', 0, 2, 0.05),
      n('missileSpeed', 'speed', 100, 900, 10),
      n('missileTurnRate', 'turn rate (rad/s)', 0.5, 12, 0.1),
      n('missileLife', 'life (s)', 0.5, 6, 0.1),
      n('missileRadius', 'radius', 4, 30, 1),
    ],
  },
  {
    name: 'Hazards',
    rows: [
      n('wormholeInterval', 'wormhole every (s, 0 = none)', 0, 60, 1),
      n('wormholeLifetime', 'wormhole open for (s)', 1, 60, 1),
      n('wormholeRadius', 'portal radius', 10, 80, 2),
      n('wormholeMinJump', 'min jump (units)', 0, 3000, 50),
      n('portalCooldown', 're-entry cooldown (s)', 0, 5, 0.1),
      n('sawInterval', 'saw every (s, 0 = none)', 0, 60, 1),
      n('sawLifetime', 'saw roves for (s)', 1, 60, 1),
      n('sawRadius', 'saw radius', 10, 80, 2),
      n('sawSpeed', 'saw speed', 0, 600, 10),
      n('sawMinHeadDistance', 'saw min distance from heads', 0, 1000, 20),
    ],
  },
  {
    name: 'Loops',
    rows: [n('loopIgnore', 'own neck ignored (units)', 8, 80, 2), { kind: 'boolean', key: 'collectByLoop', label: 'loop a pickup to take it' }],
  },
  {
    name: 'Power-ups',
    rows: [
      n('ghostDuration', 'ghost (s)', 0.5, 10, 0.25),
      n('effectWarning', 'expiry warning (s)', 0, 10, 0.25),
      n('shieldGrace', 'shield grace (s)', 0, 3, 0.1),
      n('dozerDuration', 'bulldozer (s)', 0.5, 15, 0.5),
      n('scissorsDuration', 'scissors (s)', 0.5, 15, 0.5),
      n('flameDuration', 'flamethrower (s)', 0.5, 10, 0.25),
      n('flameRange', 'flame reach', 40, 400, 10),
      n('flameSpread', 'flame half-angle (rad)', 0.1, 1.5, 0.05),
    ],
  },
  { name: 'Pickup mix', rows: [{ kind: 'weights', key: 'pickupWeights', label: 'pickup mix', min: 0, max: 100, step: 1 }] },
];

/** Every row by key, for validation. */
const ROWS = new Map<string, ConfigRow>();
for (const folder of CONFIG_FOLDERS) for (const row of folder.rows) ROWS.set(row.key, row);

/** The keys a house-rules override may carry (every tunable; nothing structural). */
export const OVERRIDABLE_KEYS: readonly (keyof Config)[] = [...ROWS.keys()] as (keyof Config)[];

export type Overrides = Partial<Config>;

/**
 * Checks a value meant as house rules: only known keys, numbers finite and within the panel's
 * range, booleans, a valid map mode, and pickup weights that are non-negative integers. Returns
 * the clean overrides and a problem per rejected entry (rejected entries are dropped).
 */
export function validateOverrides(raw: unknown): { overrides: Overrides; problems: string[] } {
  const problems: string[] = [];
  const overrides: Record<string, unknown> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { overrides: {}, problems: ['overrides must be an object'] };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const row = ROWS.get(key);
    if (!row) {
      problems.push(`${key}: not a tunable`);
      continue;
    }
    switch (row.kind) {
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) problems.push(`${key}: not a number`);
        else if (value < row.min || value > row.max) problems.push(`${key}: ${value} is outside ${row.min}–${row.max}`);
        else overrides[key] = value;
        break;
      case 'boolean':
        if (typeof value !== 'boolean') problems.push(`${key}: not true or false`);
        else overrides[key] = value;
        break;
      case 'maps':
        if (typeof value !== 'string' || !(MAP_MODES as readonly string[]).includes(value)) problems.push(`${key}: not one of ${MAP_MODES.join(', ')}`);
        else overrides[key] = value;
        break;
      case 'weights': {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          problems.push(`${key}: not an object`);
          break;
        }
        const clean: Partial<Record<PickupKind, number>> = {};
        let bad = false;
        for (const [kind, weight] of Object.entries(value as Record<string, unknown>)) {
          if (!(kind in DEFAULT_CONFIG.pickupWeights)) {
            problems.push(`${key}.${kind}: not a pickup`);
            bad = true;
          } else if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < row.min || weight > row.max) {
            problems.push(`${key}.${kind}: not a whole number in ${row.min}–${row.max}`);
            bad = true;
          } else clean[kind as PickupKind] = weight;
        }
        if (!bad && Object.keys(clean).length > 0) overrides[key] = { ...DEFAULT_CONFIG.pickupWeights, ...clean };
        break;
      }
    }
  }
  return { overrides: overrides as Overrides, problems };
}

/** The defaults with `overrides` on top (pickup weights merged per kind). */
export function applyOverrides(base: Config, overrides: Overrides): Config {
  const out: Config = { ...base, pickupWeights: { ...base.pickupWeights } };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (key === 'pickupWeights') Object.assign(out.pickupWeights, value as Partial<Record<PickupKind, number>>);
    else (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** What `cfg` changes against `base`, as overrides (pickup weights only when any differ, then whole). */
export function diffConfig(cfg: Config, base: Config = DEFAULT_CONFIG): Overrides {
  const out: Record<string, unknown> = {};
  for (const key of OVERRIDABLE_KEYS) {
    if (key === 'pickupWeights') {
      const kinds = Object.keys(base.pickupWeights) as PickupKind[];
      if (kinds.some((k) => cfg.pickupWeights[k] !== base.pickupWeights[k])) out.pickupWeights = { ...cfg.pickupWeights };
    } else if (cfg[key] !== base[key]) out[key] = cfg[key];
  }
  return out as Overrides;
}

/** "hearts 3", "speed 320", "pickup mix missile 50": one line per override, for the HOUSE RULES readout. */
export function describeOverrides(overrides: Overrides, base: Config = DEFAULT_CONFIG): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    const row = ROWS.get(key);
    if (!row || value === undefined) continue;
    if (row.kind === 'weights') {
      const weights = value as Record<PickupKind, number>;
      for (const kind of Object.keys(base.pickupWeights) as PickupKind[]) {
        if (weights[kind] !== base.pickupWeights[kind]) lines.push(`${kind} ${weights[kind]}`);
      }
    } else if (row.kind === 'boolean') lines.push(`${row.label} ${value ? 'on' : 'off'}`);
    else lines.push(`${row.label} ${String(value)}`);
  }
  return lines;
}

/**
 * The overrides as lines for `DEFAULT_CONFIG` in src/sim/config.ts, so published house rules
 * can go into a pull request as the new defaults. Keys come out in the config's own order.
 */
export function overridesAsConfigLines(overrides: Overrides, base: Config = DEFAULT_CONFIG): string {
  const lines: string[] = [];
  for (const key of Object.keys(base) as (keyof Config)[]) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (key === 'pickupWeights') {
      const w = value as Record<PickupKind, number>;
      lines.push(`  pickupWeights: { ${(Object.keys(base.pickupWeights) as PickupKind[]).map((k) => `${k}: ${w[k]}`).join(', ')} },`);
    } else if (typeof value === 'string') lines.push(`  ${key}: '${value}',`);
    else lines.push(`  ${key}: ${String(value)},`);
  }
  return lines.join('\n');
}

export function hasOverrides(overrides: Overrides | undefined | null): boolean {
  return !!overrides && Object.keys(overrides).length > 0;
}
