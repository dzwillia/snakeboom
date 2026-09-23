/** Client-only preferences (effects and audio); gameplay values live in the sim Config. */
export interface ClientSettings {
  bloom: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  shakeScale: number;
  masterVolume: number;
  muted: boolean;
  /** Freeze-frame at the moment of death. */
  hitStopSeconds: number;
  /** Effect speed during the slow-motion shatter. */
  slowMoScale: number;
  slowMoSeconds: number;
  /** No shake, flashes or camera punch. */
  reduceMotion: boolean;
}

export const DEFAULT_SETTINGS: ClientSettings = {
  bloom: true,
  bloomStrength: 1.5,
  bloomThreshold: 0.2,
  shakeScale: 2,
  masterVolume: 0.8,
  muted: false,
  hitStopSeconds: 0.12,
  slowMoScale: 0.3,
  slowMoSeconds: 0.8,
  reduceMotion: false,
};

/** Defaults for this device: reduced motion follows the system preference until the player chooses. */
export function settingsDefaults(prefersReducedMotion: boolean): ClientSettings {
  return { ...DEFAULT_SETTINGS, reduceMotion: prefersReducedMotion };
}

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

/** Resets `target` to `defaults` in place, keeping nested objects the same instances (UI bindings stay live). */
export function resetInPlace<T extends object>(target: T, defaults: T): void {
  const t = target as Record<string, unknown>;
  const d = defaults as Record<string, unknown>;
  for (const key of Object.keys(d)) {
    const dv = d[key];
    const tv = t[key];
    if (dv && typeof dv === 'object' && !Array.isArray(dv) && tv && typeof tv === 'object') {
      resetInPlace(tv as object, dv as object);
    } else {
      t[key] = structuredClone(dv);
    }
  }
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
