import { ZZFX, zzfx } from 'zzfx';
import type { ClientSettings } from './settings';

export type SoundName =
  | 'beep'
  | 'go'
  | 'boost'
  | 'death'
  | 'roundWin'
  | 'draw'
  | 'matchWin'
  | 'overtime'
  | 'pickupSpawn'
  | 'pickup'
  | 'bombDrop'
  | 'explosion'
  | 'tick'
  | 'bombThrow'
  | 'ghost'
  | 'ghostEnd'
  | 'shield'
  | 'turbo'
  | 'slow'
  | 'reverse';

// ZzFX parameters: volume, randomness, frequency, attack, sustain, release, shape, shapeCurve,
// slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay,
// sustainVolume, decay, tremolo, filter. Omitted values use ZzFX defaults.
const BANK: Record<SoundName, number[]> = {
  beep: [0.5, 0, 520, 0, 0.06, 0.12, 1, 1.5],
  go: [0.7, 0, 780, 0.01, 0.12, 0.3, 1, 1.5, 0, 0, 390, 0.06],
  boost: [0.35, 0.05, 140, 0.03, 0.12, 0.2, 2, 1.2, 8, 0, 0, 0, 0, 0.4],
  death: [1.1, 0.1, 220, 0.01, 0.18, 0.7, 2, 2.4, -6, 0, 0, 0, 0, 1.2, 0, 0.3, 0, 0.6, 0.12],
  roundWin: [0.6, 0, 523, 0.01, 0.09, 0.22, 1, 1, 0, 0, 262, 0.09, 0.09],
  draw: [0.5, 0, 330, 0.02, 0.15, 0.3, 1, 1, -2],
  matchWin: [0.8, 0, 392, 0.02, 0.3, 0.6, 1, 1, 0, 0, 196, 0.12, 0.12],
  overtime: [0.6, 0, 880, 0, 0.25, 0.1, 0, 1, 0, 0, -220, 0.1, 0.2, 0, 8],
  pickupSpawn: [0.25, 0, 900, 0.01, 0.03, 0.12, 0, 1, 0, 0, 450, 0.04],
  pickup: [0.5, 0, 660, 0.01, 0.06, 0.18, 1, 1, 0, 0, 330, 0.05, 0.05],
  bombDrop: [0.5, 0.05, 120, 0, 0.03, 0.12, 0, 1, -10, 0, 0, 0, 0, 0.3],
  explosion: [1.3, 0.1, 62, 0.01, 0.22, 0.95, 4, 0.8, -1, 0, 0, 0, 0, 1.8, 0, 0.4, 0, 0.5, 0.25],
  tick: [0.3, 0, 1600, 0, 0.005, 0.03, 0],
  bombThrow: [0.4, 0.05, 260, 0.02, 0.08, 0.16, 0, 1, 14],
  ghost: [0.5, 0, 300, 0.05, 0.25, 0.3, 0, 1, 2, 0, 0, 0, 0, 0, 5],
  ghostEnd: [0.4, 0, 500, 0.01, 0.05, 0.15, 0, 1, -3],
  shield: [0.9, 0.05, 400, 0, 0.05, 0.3, 1, 2, 0, 0, 200, 0.02, 0, 0, 0, 0.1],
  turbo: [0.6, 0, 200, 0.02, 0.3, 0.2, 2, 1, 6, 0.5],
  slow: [0.6, 0, 600, 0.02, 0.3, 0.3, 1, 1, -6, -0.2],
  reverse: [0.6, 0, 440, 0.01, 0.3, 0.2, 1, 1, 0, 0, 0, 0, 0, 0, 12],
};

/** Synthesized sound effects (no audio files). */
export class Sound {
  constructor(private readonly settings: ClientSettings) {}

  /** Browsers keep audio suspended until a user gesture; call on every key press. */
  unlock(): void {
    const ctx = ZZFX.audioContext;
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
  }

  /** `pitchScale` multiplies the base frequency (chain reactions climb in pitch). */
  play(name: SoundName, volumeScale = 1, pitchScale = 1): void {
    if (this.settings.muted || this.settings.masterVolume <= 0) return;
    ZZFX.volume = this.settings.masterVolume * volumeScale;
    const params = BANK[name].slice();
    params[2] *= pitchScale;
    try {
      zzfx(...params);
    } catch {
      // Audio unavailable (no device or blocked): play silently.
    }
  }
}
