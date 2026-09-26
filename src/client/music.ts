import type { Phase } from '../sim';
import type { ScreenKind } from './screens';
import { SONGS, type SongName, type Track } from './songs';
import { startRender, type Rendered, type SongRender } from './tracker';

export type { Track } from './songs';

// The slice of Web Audio the player uses, so tests can hand it a fake and Node never sees an AudioContext.
export interface ParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(value: number, time: number, constant: number): unknown;
  cancelScheduledValues(time: number): unknown;
}
export interface GainLike {
  gain: ParamLike;
  connect(node: unknown): unknown;
  disconnect(): void;
}
export interface BufferLike {
  copyToChannel(data: Float32Array, channel: number): void;
}
export interface SourceLike {
  buffer: BufferLike | null;
  loop: boolean;
  connect(node: unknown): unknown;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface ContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly sampleRate: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  createGain(): GainLike;
  createBuffer(channels: number, frames: number, sampleRate: number): BufferLike;
  createBufferSource(): SourceLike;
}

/** Cross-fade between loops, in seconds. */
export const FADE = 0.5;
/** How long the sting is given before the next loop may cross-fade in. */
export const STING_SECONDS = 2.2;

/**
 * Which loop belongs to a moment of the game: the title loop whenever there is no match (title, menus,
 * the Powers page, forms, the online lobby and queue) and once a match is over; the match loop from
 * the countdown through the round-over banner.
 */
export function trackFor(phase: Phase | null, screen: ScreenKind): Track {
  if (!phase || phase === 'matchOver') return 'title';
  if (screen === 'title' || screen === 'lobby' || screen === 'form') return 'title';
  return 'match';
}

interface Playing {
  track: Track;
  source: SourceLike;
  gain: GainLike;
}

/**
 * Background music: the loops in songs.ts rendered once into AudioBuffers and looped through a gain
 * chain (track cross-fade → duck → volume) on the shared audio context. Nothing sounds before
 * `unlock()` has seen the context running after a user gesture.
 */
export class Music {
  private ctx: ContextLike | null = null;
  private out: GainLike | null = null;
  private duckGain: GainLike | null = null;
  private readonly buffers = new Map<SongName, { buffer: BufferLike; seconds: number }>();
  private readonly renders = new Map<SongName, SongRender>();
  private playing: Playing | null = null;
  private wish: Track | null = null;
  private unlocked = false;
  private volume = 1;
  private muted = false;
  /** Context time until which a sting has the floor. */
  private stingUntil = 0;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly context: () => ContextLike | undefined) {}

  /** The loop playing now (or fading in). */
  get current(): Track | null {
    return this.playing?.track ?? null;
  }

  /** The loop asked for, playing or not. */
  get wanted(): Track | null {
    return this.wish;
  }

  get ready(): boolean {
    return this.unlocked;
  }

  /** Songs rendered so far, for the debug hook. */
  get rendered(): SongName[] {
    return [...this.buffers.keys()];
  }

  /** Call from a user gesture: resumes the context and starts whatever was asked for. */
  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'running') {
      this.becomeUnlocked();
      return;
    }
    ctx.resume().then(
      () => {
        if (ctx.state === 'running') this.becomeUnlocked();
      },
      () => {},
    );
  }

  private becomeUnlocked(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.wish) this.play(this.wish);
  }

  /** Cross-fades to `track` (after the sting, if one is playing). Before unlock it only records the wish. */
  play(track: Track): void {
    this.wish = track;
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
    if (!this.unlocked || !this.ctx) return;
    if (this.playing?.track === track) return;
    const wait = this.stingUntil - this.ctx.currentTime;
    if (wait > 0.01) this.pending = setTimeout(() => this.swapTo(track), wait * 1000);
    else this.swapTo(track);
  }

  private swapTo(track: Track): void {
    this.pending = null;
    const ctx = this.ctx;
    if (!ctx || !this.duckGain || this.playing?.track === track) return;
    const song = this.buffer(track);
    if (!song) return;
    const now = ctx.currentTime;
    this.fadeOut(now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + FADE);
    gain.connect(this.duckGain);
    const source = ctx.createBufferSource();
    source.buffer = song.buffer;
    source.loop = true;
    source.connect(gain);
    source.start(now);
    this.playing = { track, source, gain };
  }

  private fadeOut(now: number): void {
    const old = this.playing;
    if (!old) return;
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    old.gain.gain.linearRampToValueAtTime(0, now + FADE);
    try {
      old.source.stop(now + FADE + 0.05);
    } catch {
      // Already stopped.
    }
    this.playing = null;
  }

  /** Fades the music out and forgets the wish. */
  stop(): void {
    this.wish = null;
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
    if (this.ctx) this.fadeOut(this.ctx.currentTime);
  }

  /** Lowers the loop to `amount` (0–1) for `seconds`, then eases it back. */
  duck(amount: number, seconds: number): void {
    const ctx = this.ctx;
    const g = this.duckGain?.gain;
    if (!ctx || !g) return;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(amount, now + 0.05);
    g.setValueAtTime(amount, now + seconds);
    g.linearRampToValueAtTime(1, now + seconds + 0.4);
  }

  /**
   * The round-over sting on top of the loop, which ducks under it for `holdSeconds` (at least the
   * sting's length). A loop change asked for meanwhile waits until the sting is done.
   */
  sting(holdSeconds = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || !this.unlocked) return;
    const song = this.buffer('sting');
    if (!song) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = song.buffer;
    source.loop = false;
    source.connect(this.out);
    source.start(now);
    this.stingUntil = now + STING_SECONDS;
    this.duck(0.2, Math.max(STING_SECONDS, holdSeconds));
    if (this.wish && this.wish !== this.playing?.track) this.play(this.wish);
  }

  /** 0–1; the settings' music volume, or 0 when music is off. */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyGain();
  }

  /** The M key: mutes music along with the effects. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  private applyGain(): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    this.out.gain.setTargetAtTime(this.muted ? 0 : this.volume, ctx.currentTime, 0.03);
  }

  /** Renders the songs in idle time so the first play doesn't wait: the title loop first. */
  prerender(): void {
    if (!this.ensureContext()) return;
    const order: SongName[] = ['title', 'match', 'sting'];
    const idle = (fn: () => void) =>
      typeof requestIdleCallback === 'function' ? requestIdleCallback(() => fn(), { timeout: 2000 }) : setTimeout(fn, 50);
    const tick = () => {
      const name = order.find((n) => !this.buffers.has(n));
      if (!name) return;
      const render = this.render(name);
      if (render.step()) this.finish(name, render);
      idle(tick);
    };
    idle(tick);
  }

  private ensureContext(): ContextLike | null {
    if (this.ctx) return this.ctx;
    let ctx: ContextLike | undefined;
    try {
      ctx = this.context();
    } catch {
      ctx = undefined;
    }
    if (!ctx) return null;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : this.volume;
    this.out.connect(ctx.destination);
    this.duckGain = ctx.createGain();
    this.duckGain.gain.value = 1;
    this.duckGain.connect(this.out);
    return ctx;
  }

  private render(name: SongName): SongRender {
    let render = this.renders.get(name);
    if (!render) {
      render = startRender(SONGS[name], this.ctx!.sampleRate);
      this.renders.set(name, render);
    }
    return render;
  }

  private finish(name: SongName, render: SongRender): Rendered {
    const r = render.finish();
    this.renders.delete(name);
    const buffer = this.ctx!.createBuffer(2, r.left.length, r.sampleRate);
    buffer.copyToChannel(r.left, 0);
    buffer.copyToChannel(r.right, 1);
    this.buffers.set(name, { buffer, seconds: r.seconds });
    return r;
  }

  /** The song's buffer, rendering the rest of it now if idle time hasn't got there yet. */
  private buffer(name: SongName): { buffer: BufferLike; seconds: number } | null {
    const cached = this.buffers.get(name);
    if (cached) return cached;
    if (!this.ctx) return null;
    try {
      this.finish(name, this.render(name));
    } catch {
      return null;
    }
    return this.buffers.get(name) ?? null;
  }
}
