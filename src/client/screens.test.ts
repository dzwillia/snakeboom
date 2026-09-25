import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../sim';
import { Screens } from './screens';

const fakeRoot = () => ({ innerHTML: '', querySelector: () => null }) as unknown as HTMLElement;

describe('Screens powers', () => {
  it('lists every pickup with its glyph and current numbers', () => {
    const root = fakeRoot();
    const screens = new Screens(root);
    screens.powers(DEFAULT_CONFIG);
    expect(screens.showing).toBe('powers');
    for (const kind of ['bomb', 'ghost', 'shield', 'dozer']) {
      expect(root.innerHTML).toContain(`data-kind="${kind}"`);
    }
    expect((root.innerHTML.match(/<svg /g) ?? []).length).toBe(4);
    expect(root.innerHTML).toContain(`blast radius ${DEFAULT_CONFIG.blastRadius}`);
    expect(root.innerHTML).toContain('BACK TO TITLE');
    screens.powers(DEFAULT_CONFIG, 'pause');
    expect(root.innerHTML).toContain('BACK TO PAUSE');
  });

  it('can be opened from pause without losing the banner underneath', () => {
    const root = fakeRoot();
    const screens = new Screens(root);
    screens.roundOver('PINK SCORES', 'CYAN hit the wall', 1);
    const banner = root.innerHTML;
    screens.paused();
    screens.powers(DEFAULT_CONFIG, 'pause');
    screens.paused();
    expect(root.innerHTML).toContain('PAUSED');
    screens.resume();
    expect(root.innerHTML).toBe(banner);
  });
});

describe('Screens title', () => {
  it('renders the four rows with the active one marked', () => {
    const root = fakeRoot();
    const screens = new Screens(root);
    screens.title({ row: 'create', winsToWin: 5, hearts: 3, opponent: 'human' });
    expect(root.innerHTML.match(/class="row/g)).toHaveLength(4);
    expect(root.innerHTML).toContain('class="row active" data-row="create"');
    expect(root.innerHTML).toContain('HUMAN');
    expect(root.innerHTML).toContain('use item</p></div>\n          <div class="p2">');
  });

  it("shows PINK's seat as the AI when an AI level is chosen", () => {
    const root = fakeRoot();
    new Screens(root).title({ row: 'local', winsToWin: 5, hearts: 3, opponent: 'hard' });
    expect(root.innerHTML).toContain('AI · HARD');
    expect(root.innerHTML).toContain('plays this seat');
  });
});

describe('Screens lobby', () => {
  it('shows the code, the link, both seats and the ping', () => {
    const root = fakeRoot();
    new Screens(root).lobby({
      code: 'ABC234',
      link: 'https://snakeboom.com/r/ABC234',
      players: [
        { name: 'Ada', ready: true, connected: true },
        { name: '', ready: false, connected: true },
      ],
      winsToWin: 5,
      pingMs: 48,
      me: 0,
    });
    expect(root.innerHTML).toContain('ABC234');
    expect(root.innerHTML).toContain('https://snakeboom.com/r/ABC234');
    expect(root.innerHTML).toContain('Ada');
    expect(root.innerHTML).toContain('(YOU)');
    expect(root.innerHTML).toContain('READY');
    expect(root.innerHTML).toContain('PINK');
    expect(root.innerHTML).toContain('PING 48 ms');
  });

  it('shows an empty seat and escapes names', () => {
    const root = fakeRoot();
    new Screens(root).lobby({
      code: 'ABC234',
      link: 'x',
      players: [{ name: '<b>x</b>', ready: false, connected: true }, null],
      winsToWin: 3,
      pingMs: null,
      me: 0,
    });
    expect(root.innerHTML).toContain('waiting for a player');
    expect(root.innerHTML).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(root.innerHTML).not.toContain('PING');
  });
});

describe('Screens queue', () => {
  it('shows the link, the player count and the AI offer once it is due', () => {
    const root = fakeRoot();
    const screens = new Screens(root);
    screens.queue({ link: 'https://snakeboom.com/r/ABC234', online: 3, aiOffered: false });
    expect(root.innerHTML).toContain('LOOKING FOR AN OPPONENT');
    expect(root.innerHTML).toContain('2 OTHER PLAYERS');
    expect(root.innerHTML).toContain('https://snakeboom.com/r/ABC234');
    expect(root.innerHTML).not.toContain('PLAY THE AI');
    screens.queue({ link: 'x', online: 1, aiOffered: true });
    expect(root.innerHTML).toContain('0 OTHER PLAYERS');
    expect(root.innerHTML).toContain('PLAY THE AI NOW');
  });
});

describe('Screens match over', () => {
  it('updates the rematch line without touching the title or scores', () => {
    const root = fakeRoot();
    const screens = new Screens(root);
    screens.matchOver(1, [2, 3], ['Ada', 'Bob'], 'SPACE REMATCH · ESC LOBBY');
    expect(root.innerHTML).toContain('Bob WINS');
    expect(root.innerHTML).toContain('2 – 3');
    screens.matchOverLine('BOB WANTS A REMATCH');
    expect(root.innerHTML).toContain('BOB WANTS A REMATCH');
    expect(root.innerHTML).toContain('Bob WINS');
    expect(root.innerHTML).toContain('SPACE REMATCH · ESC LOBBY');
    screens.matchOverLine('');
    expect(root.innerHTML).not.toContain('WANTS');
    screens.clear();
    screens.matchOverLine('ignored');
    expect(root.innerHTML).toBe('');
  });
});

describe('Screens cover/uncover', () => {
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

  it('keeps the original screen through a replaced cover', () => {
    const root = fakeRoot();
    const screens = new Screens(root);
    screens.roundOver('DRAW', 'Time ran out', null);
    const banner = root.innerHTML;
    screens.reconnecting('PINK', 15);
    screens.reconnecting('PINK', 14);
    expect(root.innerHTML).toContain('14');
    expect(screens.isCovered).toBe(true);
    screens.uncover();
    expect(root.innerHTML).toBe(banner);
    expect(screens.isCovered).toBe(false);
  });
});
