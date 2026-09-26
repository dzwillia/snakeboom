/**
 * SnakeBoom's music: three original tracks written as tracker data and rendered in the browser by
 * tracker.ts. The style is the Star Control II soundtrack: square and saw leads with vibrato, bass on
 * the off-beats, chords arpeggiated in sixteenths, a memorable tune per theme.
 *
 * Reading a bar: sixteen tokens, four per beat. `E4` starts a note, `.` holds whatever is playing,
 * `~` stops it. Helpers below build the repetitive bars (arpeggios, held notes, drum patterns).
 */
import type { Instrument, Song } from './tracker';

export type Track = 'title' | 'match';
export type SongName = Track | 'sting';

/** Sixteenths cycling through the given notes (4 or 8 of them) for one bar. */
function arp(notes: string): string {
  const list = notes.trim().split(/\s+/);
  const out: string[] = [];
  while (out.length < 16) out.push(list[out.length % list.length]);
  return out.join(' ');
}

/** One note held for the whole bar. */
function hold(note: string): string {
  return `${note} ${'. '.repeat(15).trim()}`;
}

/** A silent bar. */
const REST = Array(16).fill('.').join(' ');

/** The same bar `n` times. */
function times(bar: string, n: number): string[] {
  return Array(n).fill(bar);
}

// Instruments shared between the songs.
const KICK: Instrument = { wave: 'sine', attack: 0.001, decay: 0.16, sustain: 0, release: 0.03, pitchDrop: 5 };
const SNARE: Instrument = { wave: 'noise', attack: 0.001, decay: 0.12, sustain: 0, release: 0.05, highpass: 900, lowpass: 6000 };
const HAT: Instrument = { wave: 'noise', attack: 0.001, decay: 0.035, sustain: 0, release: 0.02, highpass: 7000 };

/**
 * COLD ORBIT: the title and lobby loop. 96 bpm, A minor, sixteen bars (40 s). A triangle arpeggio
 * bed turns over Am F C G, then Am F Dm E; a saw bass breathes underneath; the lead enters at bar 5,
 * answers itself over the darker second half, and leaves on the dominant so the loop lands home.
 */
const TITLE: Song = {
  name: 'Cold Orbit',
  bpm: 96,
  loop: true,
  instruments: {
    bed: { wave: 'tri', attack: 0.01, decay: 0.25, sustain: 0.35, release: 0.2, detune: 6 },
    bass: { wave: 'saw', attack: 0.03, decay: 0.4, sustain: 0.7, release: 0.35, lowpass: 500, vibrato: 0.12, vibratoRate: 4.5, vibratoDelay: 0.5 },
    lead: { wave: 'square', pulseWidth: 0.25, attack: 0.02, decay: 0.25, sustain: 0.6, release: 0.3, vibrato: 0.4, vibratoRate: 5.5, vibratoDelay: 0.25 },
    kick: KICK,
    hat: HAT,
  },
  channels: [
    {
      instrument: 'bed',
      volume: 0.5,
      pan: -0.35,
      bars: [
        // Section A: Am F C G, twice (bars 1–8), up-and-down arpeggios.
        arp('A2 C3 E3 A3 C4 A3 E3 C3'), arp('F2 A2 C3 F3 A3 F3 C3 A2'), arp('C3 E3 G3 C4 E4 C4 G3 E3'), arp('G2 B2 D3 G3 B3 G3 D3 B2'),
        arp('A2 C3 E3 A3 C4 A3 E3 C3'), arp('F2 A2 C3 F3 A3 F3 C3 A2'), arp('C3 E3 G3 C4 E4 C4 G3 E3'), arp('G2 B2 D3 G3 B3 G3 D3 B2'),
        // Section B: Am F Dm E, twice (bars 9–16); the E major bar pulls back to Am.
        arp('A2 C3 E3 A3 C4 A3 E3 C3'), arp('F2 A2 C3 F3 A3 F3 C3 A2'), arp('D3 F3 A3 D4 F4 D4 A3 F3'), arp('E3 G#3 B3 E4 G#4 E4 B3 G#3'),
        arp('A2 C3 E3 A3 C4 A3 E3 C3'), arp('F2 A2 C3 F3 A3 F3 C3 A2'), arp('D3 F3 A3 D4 F4 D4 A3 F3'), arp('E3 G#3 B3 E4 B3 G#3 E3 B2'),
      ],
    },
    {
      instrument: 'bass',
      volume: 0.55,
      pan: 0,
      bars: [
        // Section A: roots, with a walk-up into the next chord on the last beat.
        hold('A1'), 'F1 . . . . . . . . . . . . . E1 .', hold('C2'), 'G1 . . . . . . . . . . . G1 . A1 .',
        hold('A1'), 'F1 . . . . . . . . . . . . . E1 .', hold('C2'), 'G1 . . . . . . . . . . . B1 . G#1 .',
        // Section B.
        hold('A1'), hold('F1'), 'D2 . . . . . . . . . . . . . D1 .', hold('E1'),
        hold('A1'), hold('F1'), 'D2 . . . . . . . . . . . . . D1 .', 'E1 . . . . . . . E2 . . . . . G#1 .',
      ],
    },
    {
      instrument: 'lead',
      volume: 0.5,
      pan: 0.3,
      bars: [
        // Bars 1–4: the bed alone.
        ...times(REST, 4),
        // Phrase 1 (bars 5–8): a slow climb over Am F C G.
        'E4 . . . . . . . A4 . . . . . B4 .', 'C5 . . . . . . . A4 . . . . . . .', 'G4 . . . . . . . E4 . . . G4 . . .', 'D4 . . . . . . . . . . . . . . ~',
        // Phrase 2 (bars 9–12): the same shape over the darker chords, ending on the leading tone.
        'E4 . . . . . . . A4 . . . . . C5 .', 'A4 . . . . . . . F4 . . . . . . .', 'D4 . . . . . . . F4 . . . . . A4 .', 'G#4 . . . . . . . . . . . . . . ~',
        // Phrase 3 (bars 13–16): the answer, falling home; G#3 leads back to the A of bar 1.
        'A4 . . . . . . . E4 . . . . . . .', 'F4 . . . . . . . E4 . . . D4 . . .', 'D4 . . . . . . . F4 . . . . . E4 .', 'B3 . . . . . . . G#3 . . . . . . ~',
      ],
    },
    {
      instrument: 'kick',
      volume: 0.7,
      pan: 0,
      // A soft pulse on beats 1 and 3 throughout.
      bars: times('C2 . . . . . . . C2 . . . . . . .', 16),
    },
    {
      instrument: 'hat',
      volume: 0.16,
      pan: 0.5,
      // Off-beat eighths, quietly.
      bars: times('. . C5 . . . C5 . . . C5 . . . C5 .', 16),
    },
  ],
};

/**
 * NEON COIL: the match loop. 150 bpm, E minor, eight bars (12.8 s). Kick on every beat, a square bass
 * on the off-eighths, a saw arpeggio in sixteenths over Em Em C D / Em Em C B, and a square lead
 * hook whose second half answers the first and lands on D#, the leading tone, so the loop snaps back
 * to the E of bar 1.
 */
const MATCH: Song = {
  name: 'Neon Coil',
  bpm: 150,
  loop: true,
  instruments: {
    bass: { wave: 'square', pulseWidth: 0.5, attack: 0.004, decay: 0.12, sustain: 0.45, release: 0.05, lowpass: 900 },
    arp: { wave: 'saw', attack: 0.003, decay: 0.09, sustain: 0.45, release: 0.05, detune: 7, lowpass: 3500 },
    lead: { wave: 'square', pulseWidth: 0.35, attack: 0.008, decay: 0.15, sustain: 0.7, release: 0.12, vibrato: 0.35, vibratoRate: 6, vibratoDelay: 0.12 },
    kick: KICK,
    snare: SNARE,
    hat: HAT,
  },
  channels: [
    {
      instrument: 'bass',
      volume: 0.6,
      pan: 0,
      bars: [
        // Bars 1–4: Em Em C D, the root on every off-eighth.
        arp('. . E2 .'), arp('. . E2 .'), arp('. . C2 .'), arp('. . D2 .'),
        // Bars 5–8: Em Em C B, with an octave kick into bar 8 and a run back to E.
        arp('. . E2 .'), '. . E2 . . . E2 . . . E2 . . . E3 .', arp('. . C2 .'), '. . B1 . . . B1 . . . B1 . B2 . D#2 .',
      ],
    },
    {
      instrument: 'arp',
      volume: 0.38,
      pan: -0.4,
      bars: [
        // Bars 1–4: rising sixteenths through each chord.
        arp('E3 G3 B3 E4'), arp('E3 G3 B3 E4'), arp('C3 E3 G3 C4'), arp('D3 F#3 A3 D4'),
        // Bars 5–8: up and down, and the B chord (V) to turn the loop around.
        arp('E3 G3 B3 E4 G4 E4 B3 G3'), arp('E3 G3 B3 E4 G4 E4 B3 G3'), arp('C3 E3 G3 C4 E4 C4 G3 E3'), arp('B2 D#3 F#3 B3 D#4 B3 F#3 D#3'),
      ],
    },
    {
      instrument: 'lead',
      volume: 0.5,
      pan: 0.35,
      bars: [
        // Hook (bars 1–4): the call.
        'E4 . . . G4 . . . B4 . . . . . A4 G4', 'E4 . . . . . D4 . E4 . . . . . . ~', 'C4 . . . E4 . . . G4 . . . . . E4 .', 'D4 . . . F#4 . . . A4 . . . . . B4 .',
        // Hook (bars 5–8): the answer an octave up, then down to the leading tone.
        'E5 . . . B4 . . . G4 . . . B4 . . .', 'A4 . . . G4 . . . E4 . . . . . . ~', 'C4 . . . E4 . . . G4 . . . A4 . B4 .', 'B4 . . . . . . . F#4 . . . D#4 . . ~',
      ],
    },
    {
      instrument: 'kick',
      volume: 0.8,
      pan: 0,
      bars: times('C2 . . . C2 . . . C2 . . . C2 . . .', 8),
    },
    {
      instrument: 'snare',
      volume: 0.35,
      pan: 0.1,
      bars: [
        ...times('. . . . C3 . . . . . . . C3 . . .', 7),
        // A fill into the loop.
        '. . . . C3 . . . . . . . C3 . C3 C3',
      ],
    },
    {
      instrument: 'hat',
      volume: 0.2,
      pan: -0.5,
      bars: times('C5 . C5 . C5 . C5 . C5 . C5 . C5 . C5 C5', 8),
    },
  ],
};

/**
 * ROUND STING: two seconds (one bar at 120 bpm) for the end of a round or a match. A quick E minor
 * run lands on an E major chord with a kick and a cymbal: the Picardy third resolves it.
 */
const STING: Song = {
  name: 'Round Sting',
  bpm: 120,
  loop: false,
  instruments: {
    lead: { wave: 'square', pulseWidth: 0.3, attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.5, vibrato: 0.4, vibratoRate: 6, vibratoDelay: 0.2 },
    chord: { wave: 'saw', attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.6, detune: 8, lowpass: 2500 },
    bass: { wave: 'square', attack: 0.005, decay: 0.3, sustain: 0.5, release: 0.4, lowpass: 700 },
    kick: KICK,
    cymbal: { wave: 'noise', attack: 0.001, decay: 0.8, sustain: 0, release: 0.3, highpass: 5000 },
  },
  channels: [
    // The run: E G B D, then E an octave up, held.
    { instrument: 'lead', volume: 0.5, pan: 0.2, bars: ['E4 G4 B4 D5 E5 . . . . . . . . . . ~'] },
    // The chord under it: G# (the major third) and B.
    { instrument: 'chord', volume: 0.3, pan: -0.3, bars: ['. . . . G#4 . . . . . . . . . . ~'] },
    { instrument: 'chord', volume: 0.3, pan: 0.3, bars: ['. . . . B3 . . . . . . . . . . ~'] },
    { instrument: 'bass', volume: 0.5, pan: 0, bars: ['E2 . . . E2 . . . . . . . . . . ~'] },
    { instrument: 'kick', volume: 0.8, pan: 0, bars: ['C2 . . . C2 . . . . . . . . . . .'] },
    { instrument: 'cymbal', volume: 0.25, pan: 0.4, bars: ['. . . . C5 . . . . . . . . . . .'] },
  ],
};

export const SONGS: Record<SongName, Song> = { title: TITLE, match: MATCH, sting: STING };
