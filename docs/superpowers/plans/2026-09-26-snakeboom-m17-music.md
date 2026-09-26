# SnakeBoom M17: background music

**Goal (#30):** background music in the style of The Ur-Quan Masters / Star Control II: tracker-style tunes with punchy synth leads, driving arpeggios and bass, a memorable melody per theme. Three original tracks, no audio files, nothing over the wire. Requested 2026-09-26.

## Decisions

- **No files, no licences.** The tracks are original compositions written as note data in the repo (`src/client/songs.ts`) and rendered in the browser. ZzFXM (the ZzFX author's tracker) is not on npm, so the player is our own: `src/client/tracker.ts` is a tiny tracker-style synth (about 200 lines) that turns a song into stereo PCM with pure arithmetic, no Web Audio. That keeps it testable in Node: the unit tests render every track and check it for silence, clipping and energy in the bass and lead bands.
- **Song format.** A song is `bpm`, named instruments and channels. An instrument is a ZzFX-like parameter object: waveform (square, saw, triangle, sine, noise), ADSR, vibrato depth/rate, a detuned second oscillator for chorus, a pitch drop for drums, a pulse width. A channel is one instrument, a volume, a pan and a pattern: an array of bars, each a string of 16 tokens (four rows per beat), `C4` note on, `.` hold, `~` note off. Sections are named in comments. Arpeggios are written out as 16ths, the tracker way.
- **Seamless loops.** A looping song renders exactly its length in samples plus a tail for releases, and the tail is folded onto the start, so the release of the last bar is heard under the first when the buffer wraps. Playback is an `AudioBufferSourceNode` with `loop = true`. Every track is peak-normalised to 0.8.
- **Three tracks:**
  - **Cold Orbit** (title/lobby): 96 bpm, A minor, 16 bars. A triangle-wave arpeggio bed over Am F C G / Am F Dm E, a slow saw bass, a hi-hat pulse, and a square lead with vibrato that enters at bar 5.
  - **Neon Coil** (match): 150 bpm, E minor, 8 bars. Kick on the beat, square bass on the off-eighths, a saw arpeggio in 16ths over Em C D B, and a square lead hook with vibrato in bars 1–4 answered in 5–8.
  - **Round Sting** (round/match over): 2 s at 120 bpm, one bar. A rising E minor run that lands on an E major chord, with a kick and a cymbal.
- **Player.** `src/client/music.ts`: `Music` with `play(track)`, `stop()`, `duck(amount, seconds)`, `sting()`, `setVolume`, `setMuted`, `unlock()`, `prerender()`. Chain per track: source → track gain (0.5 s cross-fade) → duck gain → music gain (volume × on/muted) → destination, on the shared ZzFX context. Nothing starts until `unlock()` has seen the context running after a key press; `play()` before that only records the wish. Tracks are rendered lazily and cached; `prerender()` renders them in `requestIdleCallback` slices after the title shows.
- **What plays when.** `trackFor(phase, screen)` is pure: no match (title, menus, Powers page, forms, online lobby and queue) → title loop; countdown, playing and roundOver → match loop; matchOver → title loop. The render loop asks every frame and calls `play` when the answer changes. The `EventSink` cues the rest, so local and online behave the same: a death ducks the loop for the death beat; roundOver plays the sting over the ducked match loop, which comes back after it; matchOver plays the sting and the title loop cross-fades in once the sting is done.
- **Settings.** `musicVolume` (0–1, default 0.6) and `musicOn` (default true), persisted with the others, rows in the tuning panel's Audio folder. <kbd>M</kbd> mutes music too.
- **Credits.** README "Music" paragraph; a line on the Powers page footer.

## Tasks

### Task 1: The tracker and the songs
- `tracker.ts` (types, pattern parser, renderer), `songs.ts` (three tracks), tests for the data and the rendered audio.
- [x] Commit `feat(client): a tiny tracker and three original tracks`.

### Task 2: The player and the wiring
- `music.ts` (`Music`, `trackFor`), settings, tuning rows, `EventSink` cues, `main.ts` wiring, debug hook `__snakeboom.music`, README and Powers footer.
- [x] Commit `feat(client): background music`.

### Task 3: Verify and ship
- `pnpm test`, typecheck, build; headless browser check of the track per state; offline WAV render of each track and a Node check for silence, clipping and band energy; PR.
