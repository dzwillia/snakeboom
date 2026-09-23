import { describe, expect, it } from 'vitest';
import { Screens } from './screens';

const fakeRoot = () => ({ innerHTML: '' }) as unknown as HTMLElement;

describe('Screens pause/resume', () => {
  it('restores the round banner the pause panel covered', () => {
    const root = fakeRoot();
    const screens = new Screens(root);
    screens.roundOver('PINK SCORES', 'CYAN hit the wall', 1);
    const banner = root.innerHTML;
    screens.paused();
    expect(root.innerHTML).toContain('PAUSED');
    screens.resume();
    expect(root.innerHTML).toBe(banner);
  });

  it('drops transient countdown numbers on resume', () => {
    const root = fakeRoot();
    const screens = new Screens(root);
    screens.countdown(2);
    screens.paused();
    screens.resume();
    expect(root.innerHTML).toBe('');
  });
});
