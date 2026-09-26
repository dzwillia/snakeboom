import { describe, expect, it } from 'vitest';
import { KeyboardInput } from './input';

function keyboard() {
  const target = new EventTarget();
  const input = new KeyboardInput(target);
  const press = (code: string) => target.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: false }));
  const release = (code: string) => target.dispatchEvent(Object.assign(new Event('keyup'), { code }));
  return { input, press, release };
}

describe('KeyboardInput.sampleLocal', () => {
  // Review Focus 6: either hand drives the local seat online.
  it('turns from whichever hand is steering', () => {
    const { input, press, release } = keyboard();
    press('KeyA');
    expect(input.sampleLocal().turn).toBe(-1);
    release('KeyA');
    press('ArrowRight');
    expect(input.sampleLocal().turn).toBe(1);
  });

  it('cancels out when the hands disagree and agrees when they agree', () => {
    const { input, press, release } = keyboard();
    press('KeyA');
    press('ArrowRight');
    expect(input.sampleLocal().turn).toBe(0);
    release('ArrowRight');
    press('ArrowLeft');
    expect(input.sampleLocal().turn).toBe(-1);
  });

  it('boosts from either hand', () => {
    const { input, press } = keyboard();
    press('ArrowUp');
    expect(input.sampleLocal().boost).toBe(true);
  });

  it('latches Use from either key and consumes it once', () => {
    const { input, press } = keyboard();
    press('ArrowDown');
    expect(input.sampleLocal().use).toBe(true);
    expect(input.sampleLocal().use).toBe(false);
    press('KeyS');
    expect(input.sampleLocal().use).toBe(true);
    expect(input.sample().every((i) => !i.use)).toBe(true);
  });

  it('latches Select from either key and consumes it once', () => {
    const { input, press } = keyboard();
    press('ShiftRight');
    expect(input.sampleLocal().select).toBe(true);
    expect(input.sampleLocal().select).toBe(false);
    press('KeyQ');
    expect(input.sampleLocal().select).toBe(true);
    expect(input.sample().every((i) => !i.select)).toBe(true);
  });

  it('forgets pending Select presses with the Fire ones', () => {
    const { input, press } = keyboard();
    press('KeyQ');
    press('KeyS');
    input.clearLatches();
    expect(input.sampleLocal()).toMatchObject({ use: false, select: false });
  });
});

describe('KeyboardInput.sample', () => {
  it('keeps each seat\'s Fire and Select apart', () => {
    const { input, press } = keyboard();
    press('KeyQ');
    press('ArrowDown');
    const [cyan, pink] = input.sample();
    expect(cyan).toMatchObject({ use: false, select: true });
    expect(pink).toMatchObject({ use: true, select: false });
  });
});
