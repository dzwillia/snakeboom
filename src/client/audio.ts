import { ZZFX, zzfx } from 'zzfx';
import type { ClientSettings } from './settings';

export type SoundName = 'beep' | 'go' | 'boost' | 'death' | 'roundWin' | 'draw' | 'matchWin' | 'overtime';

// ZzFX parameters: volume, randomness, frequency, attack, sustain, release, shape, shapeCurve,
// slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay,
// sustainVolume, decay, tremolo, filter. Omitted values use ZzFX defaults.
const BANK: Record<SoundName, Array<number | undefined>> = {
  beep: [0.5, 0, 520, 0, 0.06, 0.12, 1, 1.5],
  go: [0.7, 0, 780, 0.01, 0.12, 0.3, 1, 1.5, 0, 0, 390, 0.06],
  boost: [0.35, 0.05, 140, 0.03, 0.12, 0.2, 2, 1.2, 8, 0, 0, 0, 0, 0.4],
  death: [1.1, 0.1, 220, 0.01, 0.18, 0.7, 2, 2.4, -6, 0, 0, 0, 0, 1.2, 0, 0.3, 0, 0.6, 0.12],
  roundWin: [0.6, 0, 523, 0.01, 0.09, 0.22, 1, 1, 0, 0, 262, 0.09, 0.09],
  draw: [0.5, 0, 330, 0.02, 0.15, 0.3, 1, 1, -2],
  matchWin: [0.8, 0, 392, 0.02, 0.3, 0.6, 1, 1, 0, 0, 196, 0.12, 0.12],
  overtime: [0.6, 0, 880, 0, 0.25, 0.1, 0, 1, 0, 0, -220, 0.1, 0.2, 0, 8],
};

/** Synthesized sound effects (no audio files). */
export class Sound {
  constructor(private readonly settings: ClientSettings) {}

  /** Browsers keep audio suspended until a user gesture; call on every key press. */
  unlock(): void {
    const ctx = ZZFX.audioContext;
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
  }

  play(name: SoundName, volumeScale = 1): void {
    if (this.settings.muted || this.settings.masterVolume <= 0) return;
    ZZFX.volume = this.settings.masterVolume * volumeScale;
    try {
      zzfx(...BANK[name]);
    } catch {
      // Audio unavailable (no device or blocked): play silently.
    }
  }
}
