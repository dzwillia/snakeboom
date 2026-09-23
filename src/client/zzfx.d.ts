declare module 'zzfx' {
  export function zzfx(...parameters: Array<number | undefined>): unknown;
  export const ZZFX: {
    volume: number;
    sampleRate: number;
    audioContext: AudioContext;
  };
}
