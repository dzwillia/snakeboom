/** Client-only preferences (effects and audio); gameplay values live in the sim Config. */
export interface ClientSettings {
  bloom: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  shakeScale: number;
  masterVolume: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: ClientSettings = {
  bloom: true,
  bloomStrength: 1.5,
  bloomThreshold: 0.2,
  shakeScale: 1,
  masterVolume: 0.6,
  muted: false,
};

export const CONFIG_KEY = 'snakeboom.config.v1';
export const SETTINGS_KEY = 'snakeboom.settings.v1';

/**
 * A fresh copy of `defaults` with every saved value of the same type applied. Unknown keys,
 * wrong types, NaN and Infinity are ignored. Nested plain objects merge one level at a time.
 */
export function mergeSaved<T extends object>(defaults: T, saved: unknown): T {
  const out = structuredClone(defaults) as Record<string, unknown>;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return out as T;
  const src = saved as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    const d = out[key];
    const v = src[key];
    if (typeof d === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    } else if (typeof d === 'boolean') {
      if (typeof v === 'boolean') out[key] = v;
    } else if (d && typeof d === 'object' && !Array.isArray(d)) {
      out[key] = mergeSaved(d, v);
    }
  }
  return out as T;
}

export function loadStored<T extends object>(
  storage: Pick<Storage, 'getItem'> | undefined,
  key: string,
  defaults: T,
): T {
  try {
    const raw = storage?.getItem(key);
    return mergeSaved(defaults, raw ? JSON.parse(raw) : null);
  } catch {
    return structuredClone(defaults);
  }
}

export function saveStored(storage: Pick<Storage, 'setItem'> | undefined, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: settings simply won't persist this session.
  }
}

/** window.localStorage, or undefined where the browser blocks it. */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
