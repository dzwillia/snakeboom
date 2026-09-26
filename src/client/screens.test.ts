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
    for (const kind of ['missile', 'scissors', 'flame', 'ghost', 'shield', 'dozer']) {
      expect(root.innerHTML).toContain(`data-kind="${kind}"`);
    }
    expect((root.innerHTML.match(/<svg /g) ?? []).length).toBe(6);
    expect(root.innerHTML).toContain(`${DEFAULT_CONFIG.missileLife} s of flight`);
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
  it('renders the five rows with the active one marked', () => {
    const root = fakeRoot();
    const screens = new Screens(root);
    screens.title({ row: 'create', winsToWin: 5, hearts: 3, opponent: 'human', players: 2 });
    expect(root.innerHTML.match(/class="row/g)).toHaveLength(5);
    expect(root.innerHTML).toContain('<span class="players">2</span>');
    expect(root.innerHTML).toContain('class="row active" data-row="create"');
    expect(root.innerHTML).toContain('HUMAN');
    expect(root.innerHTML).toContain('select</p></div>\n          <div class="p2">');
  });

  it('shows the build version on the title and pause screens', () => {
    const root = fakeRoot();
    const screens = new Screens(root, 'v0.16.0');
    screens.title({ row: 'local', winsToWin: 5, hearts: 1, opponent: 'human', players: 2 });
    expect(root.innerHTML).toContain('<div class="version" title="The build you are playing">v0.16.0</div>');
    screens.paused();
    expect(root.innerHTML).toContain('v0.16.0');
  });

  it('defaults to the version Vite baked in', () => {
    expect(new Screens(fakeRoot()).version).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it("shows PINK's seat as the AI when an AI level is chosen", () => {
    const root = fakeRoot();
    new Screens(root).title({ row: 'local', winsToWin: 5, hearts: 3, opponent: 'hard', players: 2 });
    expect(root.innerHTML).toContain('AI · HARD');
    expect(root.innerHTML).toContain('plays this seat');
  });

  it('shows the house rules on the title', () => {
    const root = fakeRoot();
    new Screens(root).title({ row: 'local', winsToWin: 5, hearts: 3, opponent: 'human', players: 2, houseRules: ['hearts 3'] });
    expect(root.innerHTML).toContain('HOUSE RULES · HEARTS 3');
  });

  it('notes when local play is tuned away from the defaults', () => {
    const root = fakeRoot();
    new Screens(root).title({ row: 'local', winsToWin: 5, hearts: 3, opponent: 'human', players: 2, tuned: true });
    expect(root.innerHTML).toContain('LOCAL PLAY IS TUNED');
    new Screens(root).title({ row: 'local', winsToWin: 5, hearts: 1, opponent: 'human', players: 2 });
    expect(root.innerHTML).not.toContain('TUNED');
  });

  it('says the extra seats are bots when more than two play', () => {
    const root = fakeRoot();
    new Screens(root).title({ row: 'players', winsToWin: 5, hearts: 1, opponent: 'human', players: 5 });
    expect(root.innerHTML).toContain('+ 3 MORE · AI NORMAL');
    new Screens(root).title({ row: 'players', winsToWin: 5, hearts: 1, opponent: 'hard', players: 8 });
    expect(root.innerHTML).toContain('+ 6 MORE · AI HARD');
  });
});

/** A root whose one input and problem line remember what the form does to them. */
function formRoot() {
  type FakeEvent = { key: string; preventDefault(): void; stopPropagation(): void };
  const listeners: Record<string, ((e: FakeEvent) => void) | undefined> = {};
  const classes = new Set<string>();
  const input = {
    value: '',
    focused: false,
    classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
    addEventListener: (type: string, fn: (e: FakeEvent) => void) => (listeners[type] = fn),
    focus: () => (input.focused = true),
    select: () => {},
  };
  const problem = { textContent: '' };
  const root = {
    innerHTML: '',
    querySelector: (sel: string) => (sel === '.room-name-input' ? input : sel === '.form .problem' ? problem : null),
  } as unknown as HTMLElement;
  const stopped: string[] = [];
  const press = (key: string) => listeners.keydown?.({ key, preventDefault: () => {}, stopPropagation: () => stopped.push(key) });
  const type = (value: string) => {
    input.value = value;
    listeners.input?.({ key: '', preventDefault: () => {}, stopPropagation: () => {} });
  };
  return { root, input, problem, classes, press, type, stopped };
}

describe('Screens room name box', () => {
  it('submits a normalised name on Enter, or an empty string for a random code', () => {
    const f = formRoot();
    const submitted: (string | null)[] = [];
    new Screens(f.root).roomNameBox('', null, (name) => submitted.push(name));
    expect(f.root.innerHTML).toContain('ROOM NAME');
    expect(f.root.innerHTML).toContain('(OPTIONAL)');
    expect(f.root.innerHTML).toContain('3 TO 24 LETTERS, DIGITS AND DASHES');
    expect(f.input.focused).toBe(true);
    f.press('Enter');
    expect(submitted).toEqual(['']);
    f.type(' Dave-Night ');
    expect(f.problem.textContent).toBe('');
    f.press('Enter');
    expect(submitted).toEqual(['', 'dave-night']);
  });

  it('shows the rule inline and keeps a bad name from being submitted', () => {
    const f = formRoot();
    const submitted: (string | null)[] = [];
    new Screens(f.root).roomNameBox('', null, (name) => submitted.push(name));
    f.type('ab');
    expect(f.problem.textContent).toBe('A ROOM NAME IS 3 TO 24 CHARACTERS.');
    expect(f.classes.has('invalid')).toBe(true);
    f.press('Enter');
    expect(submitted).toEqual([]);
    f.type('dave z');
    expect(f.problem.textContent).toBe('LETTERS, DIGITS AND DASHES ONLY.');
    f.type('admin');
    expect(f.problem.textContent).toBe('"ADMIN" IS RESERVED.');
    f.type('dave');
    expect(f.problem.textContent).toBe('');
    expect(f.classes.has('invalid')).toBe(false);
    f.type('');
    expect(f.problem.textContent).toBe('');
  });

  it('starts with the relay’s reason and the last name, and Escape cancels', () => {
    const f = formRoot();
    const submitted: (string | null)[] = [];
    new Screens(f.root).roomNameBox('dave', '"dave" is taken right now. Try another name.', (name) => submitted.push(name));
    expect(f.root.innerHTML).toContain('value="dave"');
    expect(f.problem.textContent).toBe('"DAVE" IS TAKEN RIGHT NOW. TRY ANOTHER NAME.');
    expect(f.classes.has('invalid')).toBe(true);
    f.press('Escape');
    expect(submitted).toEqual([null]);
    // Enter and Escape stay in the form; other keys reach nobody either, since the input has focus.
    expect(f.stopped).toEqual(['Escape']);
    f.press('ArrowDown');
    expect(f.stopped).toEqual(['Escape']);
  });
});

describe('Screens lobby', () => {
  it('lists every seat of a bigger room with the ready count', () => {
    const root = fakeRoot();
    new Screens(root).lobby({
      code: 'dave',
      link: 'x',
      players: [{ name: 'Ada', ready: true, connected: true }, { name: 'Bob', ready: false, connected: true }, null, null, null],
      winsToWin: 3,
      size: 5,
      pingMs: null,
      me: 1,
    });
    expect((root.innerHTML.match(/class="seat[ "]/g) ?? []).length).toBe(5);
    expect(root.innerHTML).toContain('1/2 READY · STARTS WHEN EVERYONE IS');
    expect(root.innerHTML).toContain('class="seats many"');
  });

  it('shows the house rules when the relay has any', () => {
    const root = fakeRoot();
    const base = { code: 'x', link: 'x', players: [{ name: 'Ada', ready: false, connected: true }, null], winsToWin: 3, size: 2, pingMs: null, me: 0 };
    new Screens(root).lobby({ ...base, houseRules: ['hearts 3', 'speed 320'] });
    expect(root.innerHTML).toContain('HOUSE RULES · HEARTS 3 · SPEED 320');
    new Screens(root).lobby({ ...base, houseRules: [] });
    expect(root.innerHTML).not.toContain('HOUSE RULES');
  });

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
      size: 2,
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
      size: 2,
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
