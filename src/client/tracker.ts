/**
 * A tiny tracker-style synth: songs are note data (see songs.ts), rendered to stereo PCM with plain
 * arithmetic. No Web Audio in here, so the songs render in Node too. The model is the classic
 * four-channel tracker: each channel plays one instrument, patterns are rows of notes, four rows
 * per beat, sixteen per bar.
 */

export type Wave = 'square' | 'saw' | 'tri' | 'sine' | 'noise';

export interface Instrument {
  wave: Wave;
  /** ADSR: seconds, seconds, level 0–1, seconds. */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Vibrato depth in semitones (peak) and rate in Hz; it fades in over `vibratoDelay` seconds. */
  vibrato?: number;
  vibratoRate?: number;
  vibratoDelay?: number;
  /** A second oscillator this many cents sharp, mixed in equally (a cheap chorus). */
  detune?: number;
  /** Square duty cycle, 0.5 is a true square. */
  pulseWidth?: number;
  /** The pitch falls this many octaves per second after the note starts (drums). */
  pitchDrop?: number;
  /** One-pole filters on the oscillator, in Hz; 0 or absent means none. */
  lowpass?: number;
  highpass?: number;
}

export interface Channel {
  /** A key into the song's instruments. */
  instrument: string;
  /** 0–1. */
  volume: number;
  /** −1 (left) to 1 (right). */
  pan: number;
  /** One string per bar: sixteen tokens, `C4` note on, `.` hold, `~` note off. */
  bars: readonly string[];
}

export interface Song {
  name: string;
  bpm: number;
  /** A loop renders exactly its length and folds the release tail onto its start. */
  loop: boolean;
  instruments: Record<string, Instrument>;
  channels: readonly Channel[];
}

export interface Rendered {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** The musical length (the loop length for a loop); the buffers of a one-shot run longer for the tail. */
  seconds: number;
}

export const ROWS_PER_BEAT = 4;
export const ROWS_PER_BAR = 16;
/** Every track is scaled so its loudest sample sits here. */
export const PEAK = 0.8;

export type Row = { kind: 'on'; midi: number } | { kind: 'hold' } | { kind: 'off' };

const NOTE_OFFSETS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_RE = /^([A-G])(#|b)?(\d)$/;

/** MIDI note number for a name like `C4` (60), `F#3`, `Bb2`. */
export function midiOf(name: string): number {
  const m = NOTE_RE.exec(name);
  if (!m) throw new Error(`Bad note ${JSON.stringify(name)}`);
  const octave = Number(m[3]);
  return 12 * (octave + 1) + NOTE_OFFSETS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

export function frequencyOf(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Parses a channel's bars into rows, throwing with the bar number for anything malformed. */
export function parseBars(bars: readonly string[], where = 'channel'): Row[] {
  const rows: Row[] = [];
  bars.forEach((bar, i) => {
    const tokens = bar.trim().split(/\s+/);
    if (tokens.length !== ROWS_PER_BAR) throw new Error(`${where} bar ${i + 1} has ${tokens.length} rows, not ${ROWS_PER_BAR}`);
    for (const t of tokens) {
      if (t === '.') rows.push({ kind: 'hold' });
      else if (t === '~') rows.push({ kind: 'off' });
      else if (NOTE_RE.test(t)) rows.push({ kind: 'on', midi: midiOf(t) });
      else throw new Error(`${where} bar ${i + 1}: bad token ${JSON.stringify(t)}`);
    }
  });
  return rows;
}

/** Seconds per row at this tempo. */
export function rowSeconds(bpm: number): number {
  return 60 / bpm / ROWS_PER_BEAT;
}

/** The musical length of a song in seconds (the loop length for a loop). */
export function songSeconds(song: Song): number {
  return song.channels[0].bars.length * ROWS_PER_BAR * rowSeconds(song.bpm);
}

/** Checks the whole song's shape, throwing on the first problem. Used by the tests and the renderer. */
export function validateSong(song: Song): void {
  if (!(song.bpm > 0)) throw new Error(`${song.name}: bad bpm`);
  if (song.channels.length === 0) throw new Error(`${song.name}: no channels`);
  const bars = song.channels[0].bars.length;
  song.channels.forEach((ch, i) => {
    const where = `${song.name} channel ${i + 1} (${ch.instrument})`;
    if (!song.instruments[ch.instrument]) throw new Error(`${where}: unknown instrument`);
    if (ch.bars.length !== bars) throw new Error(`${where}: ${ch.bars.length} bars, others have ${bars}`);
    parseBars(ch.bars, where);
  });
}

const TWO_PI = Math.PI * 2;
/** Envelope and pitch are updated once per block (about 0.7 ms), the oscillators every sample. */
const BLOCK = 32;

/** Renders one channel into a mono buffer of `frames` samples. Deterministic (seeded noise). */
function renderChannel(ch: Channel, inst: Instrument, bpm: number, sampleRate: number, frames: number, out: Float32Array): void {
  const rows = parseBars(ch.bars);
  const rowFrames = rowSeconds(bpm) * sampleRate;
  const attack = Math.max(inst.attack, 0.001);
  const decay = Math.max(inst.decay, 0.001);
  const release = Math.max(inst.release, 0.001);
  const vib = inst.vibrato ?? 0;
  const vibRate = inst.vibratoRate ?? 5;
  const vibDelay = inst.vibratoDelay ?? 0;
  const detune = inst.detune ? 2 ** (inst.detune / 1200) : 0;
  const pw = inst.pulseWidth ?? 0.5;
  const drop = inst.pitchDrop ?? 0;
  const lpA = inst.lowpass ? 1 - Math.exp((-TWO_PI * inst.lowpass) / sampleRate) : 0;
  const hpA = inst.highpass ? 1 - Math.exp((-TWO_PI * inst.highpass) / sampleRate) : 0;
  const gain = ch.volume * (detune ? 0.5 : 1);
  const wave = inst.wave;

  let noise = 0x9e3779b9 >>> 0;
  let freq = 0;
  let phase = 0;
  let phase2 = 0;
  let on = false;
  let noteFrame = 0; // frames since note on
  let releaseFrame = -1; // frame within the note at which release began, or -1
  let releaseLevel = 0;
  let lp = 0;
  let hp = 0;
  let nextRow = 0;
  let rowIndex = 0;
  let lastLevel = 0;

  let i = 0;
  while (i < frames) {
    while (i >= nextRow) {
      if (rowIndex < rows.length) {
        const row = rows[rowIndex];
        if (row.kind === 'on') {
          freq = frequencyOf(row.midi);
          on = true;
          noteFrame = 0;
          releaseFrame = -1;
          lastLevel = 0;
        } else if (row.kind === 'off' && on && releaseFrame < 0) {
          releaseFrame = noteFrame;
          releaseLevel = lastLevel;
        }
      } else if (rowIndex === rows.length && on && releaseFrame < 0) {
        // Past the end of the pattern (the tail): let the last note ring out.
        releaseFrame = noteFrame;
        releaseLevel = lastLevel;
      }
      rowIndex++;
      nextRow = Math.min(frames, Math.round(rowIndex * rowFrames));
    }
    const n = Math.min(BLOCK, nextRow - i);
    if (!on) {
      i += n;
      continue;
    }
    const t = noteFrame / sampleRate;
    // Envelope, at the start of the block.
    let level: number;
    if (releaseFrame >= 0) {
      const r = (noteFrame - releaseFrame) / sampleRate / release;
      if (r >= 1) {
        on = false;
        i += n;
        continue;
      }
      level = releaseLevel * (1 - r);
    } else if (t < attack) level = t / attack;
    else if (t < attack + decay) level = 1 - (1 - inst.sustain) * ((t - attack) / decay);
    else level = inst.sustain;
    lastLevel = level;
    // Pitch: vibrato fades in after its delay; drums fall.
    let f = freq;
    if (vib > 0) {
      const depth = vibDelay > 0 ? Math.min(1, Math.max(0, (t - vibDelay) / 0.15)) : 1;
      if (depth > 0) f *= 2 ** ((vib * depth * Math.sin(TWO_PI * vibRate * t)) / 12);
    }
    if (drop > 0) f *= 2 ** (-drop * t);
    const step = f / sampleRate;
    const step2 = (f * detune) / sampleRate;
    const g = level * gain;
    const end = i + n;
    for (; i < end; i++) {
      let s: number;
      if (wave === 'noise') {
        noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
        s = noise / 2147483648 - 1;
      } else {
        phase += step;
        if (phase >= 1) phase -= 1;
        s = waveAt(wave, phase, pw);
        if (detune) {
          phase2 += step2;
          if (phase2 >= 1) phase2 -= 1;
          s += waveAt(wave, phase2, pw);
        }
      }
      if (lpA) {
        lp += lpA * (s - lp);
        s = lp;
      }
      if (hpA) {
        hp += hpA * (s - hp);
        s -= hp;
      }
      out[i] += s * g;
    }
    noteFrame += n;
  }
}

function waveAt(wave: Wave, phase: number, pw: number): number {
  switch (wave) {
    case 'square':
      return phase < pw ? 1 : -1;
    case 'saw':
      return 2 * phase - 1;
    case 'tri':
      return 4 * Math.abs(phase - 0.5) - 1;
    case 'sine':
      return Math.sin(TWO_PI * phase);
    default:
      return 0;
  }
}

export interface SongRender {
  /** Renders the next channel; true when every channel is done. */
  step(): boolean;
  /** Finishes any remaining channels and returns the mix. */
  finish(): Rendered;
}

/**
 * Renders a song to stereo PCM, normalised to PEAK, one channel per step so the work can be spread
 * over idle time. A loop's release tail is folded onto its start.
 */
export function startRender(song: Song, sampleRate: number): SongRender {
  validateSong(song);
  const seconds = songSeconds(song);
  const loopFrames = Math.round(seconds * sampleRate);
  const maxRelease = Math.max(...song.channels.map((ch) => song.instruments[ch.instrument].release));
  const tailFrames = Math.ceil((maxRelease + 0.05) * sampleRate);
  const total = loopFrames + tailFrames;
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const mono = new Float32Array(total);
  let next = 0;
  const step = () => {
    if (next >= song.channels.length) return true;
    const ch = song.channels[next++];
    mono.fill(0);
    renderChannel(ch, song.instruments[ch.instrument], song.bpm, sampleRate, total, mono);
    const angle = ((ch.pan + 1) * Math.PI) / 4;
    const l = Math.cos(angle);
    const r = Math.sin(angle);
    for (let i = 0; i < total; i++) {
      left[i] += mono[i] * l;
      right[i] += mono[i] * r;
    }
    return next >= song.channels.length;
  };
  const finish = () => {
    while (!step());
    let outL = left;
    let outR = right;
    if (song.loop) {
      for (let i = 0; i < tailFrames; i++) {
        left[i] += left[loopFrames + i];
        right[i] += right[loopFrames + i];
      }
      outL = left.subarray(0, loopFrames);
      outR = right.subarray(0, loopFrames);
    }
    let peak = 0;
    for (let i = 0; i < outL.length; i++) peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
    if (peak > 0) {
      const k = PEAK / peak;
      for (let i = 0; i < outL.length; i++) {
        outL[i] *= k;
        outR[i] *= k;
      }
    }
    return { left: outL, right: outR, sampleRate, seconds };
  };
  return { step, finish };
}

/** Renders a whole song at once. */
export function renderSong(song: Song, sampleRate: number): Rendered {
  return startRender(song, sampleRate).finish();
}
