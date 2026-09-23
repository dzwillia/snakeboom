import { describe, expect, it } from 'vitest';
import { SoundGate } from './soundGate';

describe('SoundGate', () => {
  it('blocks repeats of the same sound inside the gap', () => {
    const gate = new SoundGate({}, 40);
    expect(gate.allow('boom', 1000)).toBe(true);
    expect(gate.allow('boom', 1030)).toBe(false);
    expect(gate.allow('boom', 1041)).toBe(true);
  });

  it('keeps different sounds independent and honors per-sound gaps', () => {
    const gate = new SoundGate({ scrape: 150 }, 40);
    expect(gate.allow('scrape', 0)).toBe(true);
    expect(gate.allow('boom', 10)).toBe(true);
    expect(gate.allow('scrape', 100)).toBe(false);
    expect(gate.allow('scrape', 151)).toBe(true);
  });
});
