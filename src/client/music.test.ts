import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FADE, Music, STING_SECONDS, trackFor, type BufferLike, type ContextLike, type GainLike, type ParamLike, type SourceLike } from './music';

describe('trackFor', () => {
  it('plays the title loop whenever there is no match', () => {
    expect(trackFor(null, 'title')).toBe('title');
    expect(trackFor(null, 'powers')).toBe('title');
    expect(trackFor(null, 'lobby')).toBe('title');
    expect(trackFor(null, 'form')).toBe('title');
    expect(trackFor(null, 'notice')).toBe('title');
    expect(trackFor(null, 'none')).toBe('title');
  });

  it('plays the match loop from the countdown through the round-over banner, paused included', () => {
    expect(trackFor('countdown', 'countdown')).toBe('match');
    expect(trackFor('countdown', 'notice')).toBe('match');
    expect(trackFor('playing', 'none')).toBe('match');
    expect(trackFor('playing', 'paused')).toBe('match');
    expect(trackFor('playing', 'powers')).toBe('match');
    expect(trackFor('roundOver', 'banner')).toBe('match');
  });

  it('goes back to the title loop once the match is over', () => {
    expect(trackFor('matchOver', 'matchOver')).toBe('title');
    expect(trackFor('matchOver', 'lobby')).toBe('title');
  });
});

// A fake of the slice of Web Audio the player touches, recording what it schedules.
class FakeParam implements ParamLike {
  value: number;
  readonly log: string[] = [];
  constructor(value: number) {
    this.value = value;
  }
  setValueAtTime(value: number, time: number) {
    this.log.push(`set ${value} @${time.toFixed(2)}`);
    this.value = value;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.log.push(`ramp ${value} @${time.toFixed(2)}`);
    this.value = value;
  }
  setTargetAtTime(value: number, time: number) {
    this.log.push(`target ${value} @${time.toFixed(2)}`);
    this.value = value;
  }
  cancelScheduledValues() {
    this.log.push('cancel');
  }
}

class FakeGain implements GainLike {
  gain = new FakeParam(1);
  to: unknown = null;
  connect(node: unknown) {
    this.to = node;
  }
  disconnect() {
    this.to = null;
  }
}

class FakeSource implements SourceLike {
  buffer: BufferLike | null = null;
  loop = false;
  to: unknown = null;
  started: number | null = null;
  stopped: number | null = null;
  connect(node: unknown) {
    this.to = node;
  }
  start(when = 0) {
    this.started = when;
  }
  stop(when = 0) {
    this.stopped = when;
  }
}

class FakeContext implements ContextLike {
  currentTime = 0;
  state = 'suspended';
  readonly sampleRate = 8000;
  readonly destination = { name: 'speakers' };
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly buffers: { channels: number; frames: number }[] = [];
  resumeCalls = 0;
  async resume() {
    this.resumeCalls++;
    this.state = 'running';
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBuffer(channels: number, frames: number) {
    this.buffers.push({ channels, frames });
    return { copyToChannel: () => {} };
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
}

describe('Music', () => {
  let ctx: FakeContext;
  let music: Music;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = new FakeContext();
    music = new Music(() => ctx);
  });
  afterEach(() => vi.useRealTimers());

  it('does nothing before unlock, then starts the loop it was asked for', async () => {
    music.play('title');
    expect(music.wanted).toBe('title');
    expect(music.current).toBeNull();
    expect(ctx.sources).toHaveLength(0);
    music.unlock();
    expect(ctx.resumeCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(music.ready).toBe(true);
    expect(music.current).toBe('title');
    const src = ctx.sources[0];
    expect(src.loop).toBe(true);
    expect(src.started).toBe(0);
    expect(ctx.buffers[0]).toEqual({ channels: 2, frames: 8000 * 40 });
    // source → track gain → duck → out → destination
    const trackGain = src.to as FakeGain;
    const duck = trackGain.to as FakeGain;
    const out = duck.to as FakeGain;
    expect(out.to).toBe(ctx.destination);
    expect(trackGain.gain.log).toEqual(['set 0 @0.00', `ramp 1 @${FADE.toFixed(2)}`]);
  });

  it('survives a missing audio context', () => {
    const silent = new Music(() => undefined);
    silent.play('match');
    silent.unlock();
    silent.duck(0.5, 1);
    silent.sting();
    silent.stop();
    silent.prerender();
    expect(silent.current).toBeNull();
  });

  it('cross-fades between loops and ignores a repeat', async () => {
    ctx.state = 'running';
    music.unlock();
    music.play('title');
    ctx.currentTime = 10;
    music.play('match');
    music.play('match');
    expect(ctx.sources).toHaveLength(2);
    const [title, match] = ctx.sources;
    expect((title.to as FakeGain).gain.log.slice(-3)).toEqual(['cancel', 'set 1 @10.00', `ramp 0 @${(10 + FADE).toFixed(2)}`]);
    expect(title.stopped).toBeCloseTo(10 + FADE + 0.05);
    expect(match.started).toBe(10);
    expect(music.current).toBe('match');
    expect(music.rendered).toEqual(['title', 'match']);
  });

  it('ducks the loop and eases it back', () => {
    ctx.state = 'running';
    music.unlock();
    music.play('match');
    ctx.currentTime = 5;
    music.duck(0.3, 1.2);
    const duck = (ctx.sources[0].to as FakeGain).to as FakeGain;
    expect(duck.gain.log).toEqual(['cancel', 'set 1 @5.00', 'ramp 0.3 @5.05', 'set 0.3 @6.20', 'ramp 1 @6.60']);
  });

  it('plays the sting over the ducked loop and holds the next loop until it is done', async () => {
    ctx.state = 'running';
    music.unlock();
    music.play('match');
    ctx.currentTime = 20;
    music.sting(2.5);
    const sting = ctx.sources[1];
    expect(sting.loop).toBe(false);
    expect(sting.started).toBe(20);
    // The sting bypasses the duck: it goes straight to the output gain.
    const duck = (ctx.sources[0].to as FakeGain).to as FakeGain;
    expect(sting.to).toBe(duck.to);
    expect(duck.gain.log.at(-2)).toBe('set 0.2 @22.50');
    // The match is over: the title loop waits for the sting.
    music.play('title');
    expect(music.current).toBe('match');
    expect(music.wanted).toBe('title');
    ctx.currentTime = 20 + STING_SECONDS;
    await vi.advanceTimersByTimeAsync(STING_SECONDS * 1000);
    expect(music.current).toBe('title');
    expect(ctx.sources[2].started).toBeCloseTo(20 + STING_SECONDS);
  });

  it('drops a waiting loop change when the wish changes back (a quick rematch)', async () => {
    ctx.state = 'running';
    music.unlock();
    music.play('match');
    music.sting();
    music.play('title');
    music.play('match');
    await vi.advanceTimersByTimeAsync(STING_SECONDS * 1000 + 10);
    expect(music.current).toBe('match');
    expect(ctx.sources).toHaveLength(2);
  });

  it('applies volume and mute to the output gain', () => {
    ctx.state = 'running';
    music.setVolume(0.6);
    music.unlock();
    const out = ctx.gains[0];
    expect(out.gain.value).toBe(0.6);
    music.setMuted(true);
    expect(out.gain.log.at(-1)).toBe('target 0 @0.00');
    music.setMuted(false);
    music.setVolume(0);
    expect(out.gain.value).toBe(0);
  });

  it('stops with a fade and forgets the wish', () => {
    ctx.state = 'running';
    music.unlock();
    music.play('title');
    ctx.currentTime = 3;
    music.stop();
    expect(music.current).toBeNull();
    expect(music.wanted).toBeNull();
    expect(ctx.sources[0].stopped).toBeCloseTo(3 + FADE + 0.05);
  });

  it('prerenders every song in idle slices', async () => {
    music.prerender();
    await vi.advanceTimersByTimeAsync(2000);
    expect(music.rendered).toEqual(['title', 'match', 'sting']);
  });
});
