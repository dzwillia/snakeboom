import { describe, expect, it } from 'vitest';
import { SONGS, type SongName } from './songs';
import { parseBars, renderSong, ROWS_PER_BAR, songSeconds, validateSong, type Rendered } from './tracker';

const NAMES = Object.keys(SONGS) as SongName[];
const RATE = 22050;

function rms(a: Float32Array): number {
  let s = 0;
  for (const v of a) s += v * v;
  return Math.sqrt(s / a.length);
}

function lowpass(a: Float32Array, fc: number): Float32Array {
  const k = 1 - Math.exp((-2 * Math.PI * fc) / RATE);
  const out = new Float32Array(a.length);
  let y = 0;
  for (let i = 0; i < a.length; i++) {
    y += k * (a[i] - y);
    out[i] = y;
  }
  return out;
}

function highpass(a: Float32Array, fc: number): Float32Array {
  const low = lowpass(a, fc);
  return a.map((v, i) => v - low[i]);
}

function mono(r: Rendered): Float32Array {
  return r.left.map((v, i) => (v + r.right[i]) / 2);
}

describe('the songs', () => {
  it.each(NAMES)('%s is well-formed: every row parses, every channel the same length', (name) => {
    const song = SONGS[name];
    expect(() => validateSong(song)).not.toThrow();
    for (const ch of song.channels) {
      expect(parseBars(ch.bars)).toHaveLength(ch.bars.length * ROWS_PER_BAR);
      expect(ch.volume).toBeGreaterThan(0);
      expect(ch.volume).toBeLessThanOrEqual(1);
      expect(Math.abs(ch.pan)).toBeLessThanOrEqual(1);
    }
  });

  it('has the loops at whole bars in their expected ranges', () => {
    expect(SONGS.title.loop).toBe(true);
    expect(SONGS.title.channels[0].bars).toHaveLength(16);
    expect(songSeconds(SONGS.title)).toBeGreaterThanOrEqual(30);
    expect(songSeconds(SONGS.title)).toBeLessThanOrEqual(45);
    expect(SONGS.title.bpm).toBeLessThan(120);

    expect(SONGS.match.loop).toBe(true);
    expect(SONGS.match.channels[0].bars).toHaveLength(8);
    expect(SONGS.match.bpm).toBeGreaterThanOrEqual(140);
    expect(SONGS.match.bpm).toBeLessThanOrEqual(160);
    expect(songSeconds(SONGS.match)).toBeGreaterThanOrEqual(10);
    expect(songSeconds(SONGS.match)).toBeLessThanOrEqual(15);

    expect(SONGS.sting.loop).toBe(false);
    expect(songSeconds(SONGS.sting)).toBeCloseTo(2, 5);
  });

  it('has a lead in the title loop that enters after a few bars', () => {
    const lead = SONGS.title.channels.find((c) => c.instrument === 'lead')!;
    const rows = parseBars(lead.bars);
    const firstNote = rows.findIndex((r) => r.kind === 'on');
    expect(firstNote).toBe(4 * ROWS_PER_BAR);
  });

  describe.each(NAMES)('%s rendered', (name) => {
    const r = renderSong(SONGS[name], RATE);
    const m = mono(r);

    it('is neither silent nor clipping', () => {
      expect(rms(m)).toBeGreaterThan(0.05);
      let peak = 0;
      for (const v of r.left) peak = Math.max(peak, Math.abs(v));
      for (const v of r.right) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeLessThan(0.95);
      expect(peak).toBeGreaterThan(0.5);
    });

    it('has energy in the bass and in the lead band', () => {
      expect(rms(lowpass(m, 180))).toBeGreaterThan(0.04);
      expect(rms(lowpass(highpass(m, 400), 2500))).toBeGreaterThan(0.03);
    });

    it('never goes quiet for long', () => {
      // No half-second window of near silence inside a loop (the sting may fade at its end).
      const window = Math.round(RATE / 2);
      const end = SONGS[name].loop ? m.length : Math.round(RATE * 1.5);
      for (let i = 0; i + window <= end; i += window) expect(rms(m.subarray(i, i + window))).toBeGreaterThan(0.02);
    });
  });
});
