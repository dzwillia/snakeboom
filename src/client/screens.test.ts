import { describe, expect, it } from 'vitest';
import { Screens } from './screens';

const fakeRoot = () => ({ innerHTML: '' }) as unknown as HTMLElement;

describe('Screens title', () => {
  it('shows PINK’s keys for a human and the AI level otherwise', () => {
    const root = fakeRoot();
    const screens = new Screens(root);
    screens.title(5, 3, 'human');
    expect(root.innerHTML).toContain('HUMAN');
    expect(root.innerHTML).toContain('use item</p></div>\n          <div class="p2">');
    screens.title(5, 3, 'hard');
    expect(root.innerHTML).toContain('AI · HARD');
    expect(root.innerHTML).toContain('plays this seat');
  });
});

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
