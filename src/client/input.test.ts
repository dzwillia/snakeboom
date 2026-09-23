import { describe, expect, it } from 'vitest';
import { KeyboardInput } from './input';
import { BINDINGS, inputFromKeys } from './keys';

function key(type: 'keydown' | 'keyup', code: string, repeat = false): Event {
  return Object.assign(new Event(type), { code, repeat });
}

const idle = { turn: 0, boost: false, use: false };

describe('inputFromKeys', () => {
  const [p1, p2] = BINDINGS;

  it('maps turn keys to -1/0/+1 and treats both held as straight', () => {
    expect(inputFromKeys(new Set(['KeyA']), p1, false).turn).toBe(-1);
    expect(inputFromKeys(new Set(['KeyD']), p1, false).turn).toBe(1);
    expect(inputFromKeys(new Set(['KeyA', 'KeyD']), p1, false).turn).toBe(0);
    expect(inputFromKeys(new Set(), p1, false)).toEqual(idle);
  });

  // Review Focus 1: both players mashing keys at once.
  it("keeps the two players' inputs independent when many keys are held", () => {
    const all = new Set(['KeyA', 'KeyW', 'ArrowRight', 'ArrowUp', 'ArrowLeft']);
    expect(inputFromKeys(all, p1, false)).toEqual({ turn: -1, boost: true, use: false });
    expect(inputFromKeys(all, p2, true)).toEqual({ turn: 0, boost: true, use: true });
  });
});

describe('KeyboardInput', () => {
  it('latches a quick Use tap until the next sample', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    target.dispatchEvent(key('keydown', 'KeyS'));
    target.dispatchEvent(key('keyup', 'KeyS'));
    expect(input.sample()[0].use).toBe(true);
    expect(input.sample()[0].use).toBe(false);
  });

  it('ignores key repeat', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    const codes: string[] = [];
    input.onKey((code) => codes.push(code));
    target.dispatchEvent(key('keydown', 'ArrowDown'));
    input.sample();
    target.dispatchEvent(key('keydown', 'ArrowDown', true));
    expect(input.sample()[1].use).toBe(false);
    expect(codes).toEqual(['ArrowDown']);
  });

  // Review Focus 2: losing focus mid-round must not leave a snake turning forever.
  it('releases every key and notifies listeners when the window loses focus', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    let blurs = 0;
    input.onBlur(() => blurs++);
    target.dispatchEvent(key('keydown', 'KeyA'));
    target.dispatchEvent(key('keydown', 'ArrowUp'));
    target.dispatchEvent(key('keydown', 'KeyS'));
    target.dispatchEvent(new Event('blur'));
    expect(input.sample()).toEqual([idle, idle]);
    expect(blurs).toBe(1);
  });
});
