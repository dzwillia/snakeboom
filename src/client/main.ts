import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import './style.css';
import {
  createMatch,
  createOpponent,
  DEFAULT_CONFIG,
  opponentInput,
  rematch,
  step,
  type MatchState,
  type OpponentState,
} from '../sim';
import { isRoomCode } from '../net/names';
import { Sound } from './audio';
import { EventSink } from './events';
import { Hud } from './hud';
import { KeyboardInput } from './input';
import { FixedLoop } from './loop';
import { nextRow, type MenuRow } from './menu';
import { OnlineMatch, type OnlineMode } from './net/online';
import { relayUrl } from './net/transport';
import { Fx } from './render/fx';
import { Renderer } from './render/renderer';
import { applyBloom, createWorld } from './render/world';
import { Screens } from './screens';
import { deathBeatAt } from './deathBeat';
import { browserStorage, CONFIG_KEY, loadSettings, loadStored, saveStored, SETTINGS_KEY, settingsDefaults } from './settings';
import { nextOpponent, nextWins, PLAYER_NAMES } from './text';
import { createTuningPanel } from './tuning';

declare global {
  interface Window {
    /** Dev-only handle for browser tests. */
    __snakeboom?: { readonly state: MatchState | null; readonly online: OnlineMatch | null };
  }
}

/** Bombs tick audibly during their last half second. */
const FUSE_TICK_FROM = 30;
const FUSE_TICK_EVERY = 8;

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function relayBase(): string {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  return configured && configured.length > 0 ? configured : 'http://localhost:3001';
}

async function boot(): Promise<void> {
  const storage = browserStorage();
  const cfg = loadStored(storage, CONFIG_KEY, DEFAULT_CONFIG);
  const prefersCalm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const settings = loadSettings(storage, settingsDefaults(prefersCalm));

  const world = await createWorld(element('game'), settings);
  const renderer = new Renderer(world);
  const fx = new Fx(world, settings);
  const hud = new Hud(element('hud'));
  const screens = new Screens(element('screens'));
  const sound = new Sound(settings);
  const input = new KeyboardInput(window);

  /** Local play. */
  let state: MatchState | null = null;
  /** Steers PINK when the opponent setting isn't human. */
  let ai: OpponentState | null = null;
  const AI_SEAT = 1;
  let paused = false;
  /** Online play, while in a room. */
  let online: OnlineMatch | null = null;
  let names: string[] = [...PLAYER_NAMES];
  let menuRow: MenuRow = 'local';
  let tuningOpen = false;
  const fuseStage = new Map<number, number>();
  const now = () => performance.now() / 1000;
  const newSeed = () => Math.floor(Math.random() * 2 ** 31);
  const persist = () => {
    saveStored(storage, CONFIG_KEY, cfg);
    saveStored(storage, SETTINGS_KEY, settings);
  };
  const activeCfg = () => (online ? online.cfg : cfg);
  const activeState = () => (online ? online.state : state);
  const sink = new EventSink({
    fx,
    sound,
    screens,
    cfg: activeCfg,
    names: () => names,
    now,
    matchOverHint: () => (online ? 'SPACE OR ESC · MENU' : 'SPACE REMATCH · ESC MENU'),
  });

  const showTitle = () => screens.title({ row: menuRow, winsToWin: cfg.winsToWin, hearts: cfg.hearts, opponent: settings.opponent });
  /** Seats the AI (or a human) for a new match, so a mid-match setting change waits for the next one. */
  const seatOpponent = () => {
    ai = settings.opponent === 'human' ? null : createOpponent(settings.opponent, newSeed());
    hud.setTag(AI_SEAT, ai ? 'AI' : '');
  };

  const tuning = createTuningPanel(cfg, settings, {
    onChange: () => {
      applyBloom(world, settings);
      persist();
      if (!state && !online) showTitle();
    },
  });

  const setPaused = (value: boolean) => {
    if (!state || state.phase === 'matchOver' || paused === value) return;
    paused = value;
    input.clearLatches();
    if (paused) screens.paused();
    else screens.resume();
  };

  const tickFuses = (s: MatchState | null) => {
    if (!s || paused) return;
    if (s.bombs.length === 0) {
      fuseStage.clear();
      return;
    }
    for (const b of s.bombs) {
      if (b.flight > 0 || b.fuse > FUSE_TICK_FROM) continue;
      const stage = Math.floor(b.fuse / FUSE_TICK_EVERY);
      if (fuseStage.get(b.id) !== stage) {
        fuseStage.set(b.id, stage);
        sound.play('tick', 0.5);
      }
    }
  };

  const loop = new FixedLoop(
    () => {
      if (online) {
        online.tick();
        return;
      }
      if (!state || paused) return;
      const inputs = input.sample();
      if (ai) inputs[AI_SEAT] = opponentInput(ai, state, AI_SEAT, cfg);
      sink.handle(step(state, inputs, cfg), state);
    },
    (alpha, frameSeconds) => {
      const beat = sink.beat;
      const f = beat ? deathBeatAt(now() - beat.start, settings) : null;
      if (beat && f && f.fxTimeScale === 1 && f.zoom === 1) sink.beat = null;
      fx.timeScale = f ? f.fxTimeScale : 1;
      fx.setCamera(f ? f.zoom : 1, beat ? beat.x : 0, beat ? beat.y : 0);
      fx.setFlash(f ? f.flash : 0);
      const s = activeState();
      renderer.draw(s, alpha, activeCfg(), performance.now() / 1000);
      fx.update(frameSeconds);
      hud.update(s, activeCfg(), performance.now() / 1000);
      tickFuses(s);
      online?.frame(performance.now());
    },
  );

  const leaveOnline = () => {
    online = null;
    names = [...PLAYER_NAMES];
    hud.setNames(names);
    hud.setPing(null, false);
    fx.clear();
    sink.beat = null;
    loop.timeScale = 1;
    if (location.pathname !== '/') history.replaceState(null, '', '/');
    showTitle();
  };

  const startOnline = (mode: OnlineMode) => {
    state = null;
    ai = null;
    hud.setTag(AI_SEAT, '');
    fx.clear();
    input.clearLatches();
    online = new OnlineMatch(relayUrl(relayBase()), settings.name, mode, {
      screens,
      hud,
      fx,
      sink,
      input,
      onExit: leaveOnline,
      onNames: (n) => (names = n),
      setTimeScale: (scale) => (loop.timeScale = scale),
    });
  };

  let askedName = false;
  /** Asks for a name the first time, then goes online. */
  const beginOnline = (mode: OnlineMode) => {
    if (settings.name || askedName) {
      startOnline(mode);
      return;
    }
    screens.nameBox(settings.name, (name) => {
      askedName = true;
      if (name === null) {
        if (mode.kind === 'join') history.replaceState(null, '', '/');
        showTitle();
        return;
      }
      settings.name = name.trim().slice(0, 12);
      persist();
      startOnline(mode);
    });
  };

  const startLocal = () => {
    state = createMatch(cfg, newSeed());
    seatOpponent();
    input.clearLatches();
    screens.clear();
  };

  input.onKey((code) => {
    sound.unlock();
    if (code === 'KeyM') {
      settings.muted = !settings.muted;
      tuning.refresh();
      persist();
      return;
    }
    if (online) {
      online.key(code);
      return;
    }
    switch (code) {
      case 'Backquote':
        tuningOpen = !tuningOpen;
        if (tuningOpen) tuning.show();
        else tuning.hide();
        return;
      case 'Escape':
        if (state?.phase === 'matchOver') {
          state = null;
          fx.clear();
          showTitle();
        } else {
          setPaused(!paused);
        }
        return;
      case 'ArrowLeft':
      case 'KeyA':
      case 'ArrowRight':
      case 'KeyD': {
        if (state) return;
        const delta = code === 'ArrowLeft' || code === 'KeyA' ? -1 : 1;
        if (menuRow === 'local') settings.opponent = nextOpponent(settings.opponent, delta);
        else if (menuRow === 'wins') cfg.winsToWin = nextWins(cfg.winsToWin, delta);
        else return;
        tuning.refresh();
        persist();
        showTitle();
        return;
      }
      case 'ArrowUp':
      case 'KeyW':
      case 'ArrowDown':
      case 'KeyS':
        if (!state) {
          menuRow = nextRow(menuRow, code === 'ArrowUp' || code === 'KeyW' ? -1 : 1);
          showTitle();
        }
        return;
      case 'Space':
        if (!state) {
          if (menuRow === 'create') beginOnline({ kind: 'create', winsToWin: cfg.winsToWin });
          else if (menuRow === 'quick') {
            screens.flash('QUICK MATCH ARRIVES IN THE NEXT UPDATE', 'var(--dim)', 1500);
            setTimeout(showTitle, 1500);
          } else startLocal();
        } else if (state.phase === 'matchOver') {
          rematch(state, cfg, newSeed());
          seatOpponent();
          fx.clear();
          screens.clear();
        }
        return;
    }
  });
  input.onBlur(() => {
    if (!online) setPaused(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !online) setPaused(true);
  });

  if (import.meta.env.DEV) {
    window.__snakeboom = {
      get state() {
        return activeState();
      },
      get online() {
        return online;
      },
    };
  }

  const joinCode = location.pathname.match(/^\/r\/([A-Z2-9]{6})\/?$/)?.[1];
  if (joinCode && isRoomCode(joinCode)) beginOnline({ kind: 'join', room: joinCode });
  else showTitle();
  loop.start();
}

boot().catch((err: unknown) => {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = `SnakeBoom couldn't start (${err instanceof Error ? err.message : String(err)}). Your browser may not support WebGL.`;
  document.body.appendChild(box);
});
