import { describe, expect, it } from 'vitest';
import type { PlayerInput } from '../sim';
import {
  decodeInput,
  decodeRelayed,
  decodeReplay,
  encodeInput,
  encodeRelayed,
  encodeReplay,
  FRAME_INPUT,
  FRAME_RELAYED,
  FRAME_REPLAY,
  packInput,
  relayedTick,
  unpackInput,
} from './codec';

const ALL_INPUTS: PlayerInput[] = [];
for (const turn of [-1, 0, 1] as const)
  for (const boost of [false, true]) for (const use of [false, true]) ALL_INPUTS.push({ turn, boost, use });

describe('input byte', () => {
  it('round-trips every input', () => {
    for (const input of ALL_INPUTS) expect(unpackInput(packInput(input))).toEqual(input);
  });

  it('rejects the unused turn code and out-of-range bytes', () => {
    expect(unpackInput(3)).toBeNull();
    expect(unpackInput(16)).toBeNull();
    expect(unpackInput(-1)).toBeNull();
  });
});

describe('input frames', () => {
  it('round-trip ticks and inputs, including the largest tick', () => {
    for (const tick of [0, 1, 255, 256, 65536, 2 ** 31, 2 ** 32 - 1]) {
      for (const input of ALL_INPUTS) expect(decodeInput(encodeInput(tick, input))).toEqual({ tick, input });
    }
  });

  it('is 6 bytes, little-endian', () => {
    expect([...encodeInput(0x01020304, { turn: 1, boost: true, use: false })]).toEqual([FRAME_INPUT, 4, 3, 2, 1, 5]);
  });

  it('rejects the wrong length, frame byte or turn code', () => {
    const good = encodeInput(7, { turn: 0, boost: false, use: false });
    expect(decodeInput(good.subarray(0, 5))).toBeNull();
    expect(decodeInput(new Uint8Array([...good, 0]))).toBeNull();
    const badFrame = Uint8Array.from(good);
    badFrame[0] = FRAME_RELAYED;
    expect(decodeInput(badFrame)).toBeNull();
    const badTurn = Uint8Array.from(good);
    badTurn[5] = 3;
    expect(decodeInput(badTurn)).toBeNull();
  });

  it('refuses ticks outside 32 bits', () => {
    expect(() => encodeInput(-1, { turn: 0, boost: false, use: false })).toThrow(RangeError);
    expect(() => encodeInput(2 ** 32, { turn: 0, boost: false, use: false })).toThrow(RangeError);
  });
});

describe('relayed frames', () => {
  it('round-trip player, tick and input', () => {
    for (const player of [0, 1]) {
      for (const input of ALL_INPUTS) {
        expect(decodeRelayed(encodeRelayed(player, 123456, input))).toEqual({ player, tick: 123456, input });
      }
    }
  });

  it('starts with the frame byte and the player', () => {
    expect([...encodeRelayed(1, 7, { turn: 0, boost: false, use: false })]).toEqual([FRAME_RELAYED, 1, 7, 0, 0, 0, 0]);
  });

  it('rejects a player above 1, the wrong frame byte and the wrong length', () => {
    const good = encodeRelayed(0, 7, { turn: 0, boost: false, use: false });
    const badPlayer = Uint8Array.from(good);
    badPlayer[1] = 2;
    expect(decodeRelayed(badPlayer)).toBeNull();
    const badFrame = Uint8Array.from(good);
    badFrame[0] = FRAME_INPUT;
    expect(decodeRelayed(badFrame)).toBeNull();
    expect(decodeRelayed(good.subarray(1))).toBeNull();
    expect(() => encodeRelayed(2, 7, { turn: 0, boost: false, use: false })).toThrow(RangeError);
  });
});

describe('replay blobs', () => {
  const frame = (player: number, tick: number) => encodeRelayed(player, tick, { turn: 1, boost: false, use: tick % 2 === 0 });

  it('round-trips 0, 1 and 1000 frames', () => {
    for (const n of [0, 1, 1000]) {
      const frames = Array.from({ length: n }, (_, i) => frame(i % 2, i + 1));
      const blob = encodeReplay(frames);
      expect(blob[0]).toBe(FRAME_REPLAY);
      expect(blob).toHaveLength(1 + 7 * n);
      const decoded = decodeReplay(blob);
      expect(decoded).toHaveLength(n);
      expect(decoded?.map((d) => d.tick)).toEqual(frames.map((f) => relayedTick(f)));
      if (n > 0) expect(decoded?.[n - 1]?.input.use).toBe(n % 2 === 0);
    }
  });

  it('rejects a short blob, the wrong frame byte and a bad entry', () => {
    const good = encodeReplay([frame(0, 1), frame(1, 1)]);
    expect(decodeReplay(good.subarray(0, good.length - 1))).toBeNull();
    const badByte = Uint8Array.from(good);
    badByte[0] = FRAME_RELAYED;
    expect(decodeReplay(badByte)).toBeNull();
    const badEntry = Uint8Array.from(good);
    badEntry[7] = 3;
    expect(decodeReplay(badEntry)).toBeNull();
    expect(decodeReplay(new Uint8Array(0))).toBeNull();
  });
});
