export interface DeathBeatSettings {
  hitStopSeconds: number;
  slowMoScale: number;
  slowMoSeconds: number;
}

export interface DeathBeatFrame {
  /** Multiplies effect time: 0 during the hit-stop, slowMoScale after it, then 1. */
  fxTimeScale: number;
  /** Full-screen white flash alpha. */
  flash: number;
  /** Camera zoom around the death point. */
  zoom: number;
}

/** How far the camera punches in at the moment of death. */
export const PUNCH = 0.06;
/** Peak alpha of the death flash (drawn outside the bloom, so this reads as a flash, not a white-out). */
export const FLASH_PEAK = 0.25;

/**
 * The death beat `elapsed` seconds after a death: a frozen, flashing hit-stop, then slow motion,
 * while the camera punches in and eases back out. Outside the beat everything is normal.
 */
export function deathBeatAt(elapsed: number, s: DeathBeatSettings): DeathBeatFrame {
  const total = s.hitStopSeconds + s.slowMoSeconds;
  if (!(elapsed >= 0) || elapsed >= total) return { fxTimeScale: 1, flash: 0, zoom: 1 };
  const inHitStop = elapsed < s.hitStopSeconds;
  const k = elapsed / total;
  return {
    fxTimeScale: inHitStop ? 0 : s.slowMoScale,
    flash: inHitStop ? FLASH_PEAK * (1 - elapsed / s.hitStopSeconds) : 0,
    zoom: 1 + PUNCH * (1 - k) * (1 - k),
  };
}
