import { describe, expect, it } from 'vitest';
import { frequencyOf, midiOf, parseBars, renderSong, ROWS_PER_BAR, songSeconds, startRender, validateSong, type Song } from './tracker';

const beep: Song = {
  name: 'beep',
  bpm: 120,
  loop: true,
  instruments: { sq: { wave: 'square', attack: 0.001, decay: 0.05, sustain: 0.5, release: 0.3 } },
  channels: [{ instrument: 'sq', volume: 1, pan: 0, bars: ['A4 . . . ~ . . . . . . . A4 . . .'] }],
};

describe('notes', () => {
  it('reads note names', () => {
    expect(midiOf('C4')).toBe(60);
    expect(midiOf('A4')).toBe(69);
    expect(midiOf('F#3')).toBe(54);
    expect(midiOf('Bb2')).toBe(46);
    expect(() => midiOf('H2')).toThrow();
  });

  it('tunes A4 to 440', () => {
    expect(frequencyOf(69)).toBeCloseTo(440);
    expect(frequencyOf(57)).toBeCloseTo(220);
  });
});

describe('parseBars', () => {
  it('turns tokens into rows', () => {
    const rows = parseBars(['C3 . ~ . . . . . . . . . . . . .']);
    expect(rows).toHaveLength(ROWS_PER_BAR);
    expect(rows[0]).toEqual({ kind: 'on', midi: 48 });
    expect(rows[1]).toEqual({ kind: 'hold' });
    expect(rows[2]).toEqual({ kind: 'off' });
  });

  it('names the bar with the problem', () => {
    expect(() => parseBars(['C3 . .'], 'lead')).toThrow(/lead bar 1 has 3 rows/);
    expect(() => parseBars([Array(16).fill('.').join(' '), 'C3 x . . . . . . . . . . . . . .'], 'lead')).toThrow(/bar 2: bad token "x"/);
  });
});

describe('validateSong', () => {
  it('rejects unknown instruments and ragged channels', () => {
    expect(() => validateSong({ ...beep, channels: [{ ...beep.channels[0], instrument: 'nope' }] })).toThrow(/unknown instrument/);
    expect(() => validateSong({ ...beep, channels: [beep.channels[0], { ...beep.channels[0], bars: [] }] })).toThrow(/0 bars, others have 1/);
  });
});

describe('renderSong', () => {
  it('renders a loop to exactly its length, peak-normalised, with the tail folded in', () => {
    expect(songSeconds(beep)).toBe(2);
    const r = renderSong(beep, 8000);
    expect(r.left).toHaveLength(16000);
    expect(r.right).toHaveLength(16000);
    let peak = 0;
    for (const v of r.left) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeCloseTo(0.8, 3);
    // The last note (row 12, 1.5 s) still rings through its 0.3 s release, so the wrapped start carries it too.
    const startEnergy = r.left.subarray(0, 100).reduce((s, v) => s + v * v, 0);
    expect(startEnergy).toBeGreaterThan(0);
    // Centre pan: both sides equal.
    expect(r.right[500]).toBeCloseTo(r.left[500], 5);
  });

  it('keeps the tail of a one-shot', () => {
    const r = renderSong({ ...beep, loop: false }, 8000);
    expect(r.left.length).toBeGreaterThan(16000);
    expect(r.seconds).toBe(2);
  });

  it('is silent while no note plays', () => {
    const r = renderSong(beep, 8000);
    // Row 4 (0.5 s) is a note-off; by 0.9 s the 0.3 s release is over and nothing plays until 1.5 s.
    for (let i = 7200; i < 12000; i++) expect(r.left[i]).toBe(0);
  });

  it('renders the same thing in steps', () => {
    const whole = renderSong(beep, 8000);
    const render = startRender(beep, 8000);
    expect(render.step()).toBe(true);
    expect(render.finish().left).toEqual(whole.left);
  });

  it('is deterministic, noise included', () => {
    const noisy: Song = { ...beep, instruments: { sq: { wave: 'noise', attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 } } };
    expect(renderSong(noisy, 8000).left).toEqual(renderSong(noisy, 8000).left);
  });
});
