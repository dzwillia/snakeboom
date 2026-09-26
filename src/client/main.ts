import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import './style.css';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  createMatch,
  createOpponent,
  DEFAULT_CONFIG,
  opponentInput,
  rematch,
  step,
  type Difficulty,
  type MatchState,
  NO_INPUT,
  type OpponentState,
} from '../sim';
import { Sound } from './audio';
import { ZZFX } from 'zzfx';
import { Music, trackFor } from './music';
import { EventSink } from './events';
import { Hud } from './hud';
import { KeyboardInput } from './input';
import { FixedLoop } from './loop';
import { nextRow, type MenuRow } from './menu';
import { roomFromPath } from './net/link';
import { OnlineMatch, rejoinHello, storedSession, type OnlineMode } from './net/online';
import { RelayConnection } from './net/transport';
import { relayUrl } from './net/transport';
import { Fx } from './render/fx';
import { Renderer } from './render/renderer';
import { applyBloom, createWorld } from './render/world';
import { Screens } from './screens';
import { easeView, fitView, type View } from './camera';
import { deathBeatAt } from './deathBeat';
import { Minimap } from './render/minimap';
import { browserStorage, CONFIG_KEY, loadSettings, loadStored, saveStored, SETTINGS_KEY, settingsDefaults } from './settings';
import { nextOpponent, nextPlayers, nextWins, PLAYER_NAMES } from './text';
import { createTuningPanel } from './tuning';

declare global {
  interface Window {
    /** Read-only handle for browser checks and console debugging. */
    __snakeboom?: {
      readonly state: MatchState | null;
      readonly online: OnlineMatch | null;
      readonly music: { current: string | null; wanted: string | null; ready: boolean; rendered: string[] };
    };
  }
}

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

  // A refreshed tab says hello before the renderer starts, so the relay's 15 s countdown stops at once.
  const joinCode = roomFromPath(location.pathname);
  const stored = storedSession();
  const rejoin = joinCode && stored?.room === joinCode ? { room: joinCode, session: stored.session } : null;
  const early = rejoin ? new RelayConnection(relayUrl(relayBase())) : null;
  early?.send(rejoinHello(settings.name, rejoin!.session));

  const world = await createWorld(element('game'), settings);
  const renderer = new Renderer(world);
  const minimap = new Minimap(world);
  const fx = new Fx(world, settings);
  const hud = new Hud(element('hud'));
  const screens = new Screens(element('screens'));
  const sound = new Sound(settings);
  const music = new Music(() => ZZFX.audioContext);
  const applyMusicSettings = () => {
    music.setVolume(settings.musicOn ? settings.musicVolume : 0);
    music.setMuted(settings.muted);
  };
  applyMusicSettings();
  const input = new KeyboardInput(window);

  /** Local play. */
  let state: MatchState | null = null;
  /** Bots by seat: PINK when the opponent setting isn't human, and every seat past the second. */
  let bots = new Map<number, OpponentState>();
  let paused = false;
  /** Online play, while in a room. */
  let online: OnlineMatch | null = null;
  let names: string[] = [...PLAYER_NAMES];
  let menuRow: MenuRow = 'local';
  let tuningOpen = false;
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
    music,
    beatSeconds: () => settings.hitStopSeconds + settings.slowMoSeconds + 0.3,
    screens,
    cfg: activeCfg,
    names: () => names,
    now,
    matchOverHint: () => (online ? 'SPACE REMATCH · ESC LOBBY' : 'SPACE REMATCH · ESC MENU'),
  });

  const showTitle = () =>
    screens.title({ row: menuRow, winsToWin: cfg.winsToWin, hearts: cfg.hearts, opponent: settings.opponent, players: settings.players });
  /**
   * Seats the bots for a new match (so a mid-match setting change waits for the next one): PINK
   * is the chosen opponent, and every seat past the second is a bot at that level (NORMAL when
   * PINK is a human). `force` makes PINK a bot at that level whatever the setting.
   */
  const seatOpponents = (players: number, force?: Difficulty) => {
    bots = new Map();
    const pink = force ?? (settings.opponent === 'human' ? null : settings.opponent);
    const others: Difficulty = pink ?? 'normal';
    for (let seat = 0; seat < 8; seat++) hud.setTag(seat, '');
    if (pink && players >= 2) bots.set(1, createOpponent(pink, newSeed()));
    for (let seat = 2; seat < players; seat++) bots.set(seat, createOpponent(others, newSeed() + seat));
    for (const seat of bots.keys()) hud.setTag(seat, 'AI');
    hud.setLocal(0);
  };

  const tuning = createTuningPanel(cfg, settings, {
    onChange: () => {
      applyBloom(world, settings);
      applyMusicSettings();
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


  const loop = new FixedLoop(
    () => {
      if (online) {
        online.tick();
        return;
      }
      if (!state || paused) return;
      const keys = input.sample();
      const current = state;
      const inputs = current.snakes.map((_, seat) => {
        const bot = bots.get(seat);
        return bot ? opponentInput(bot, current, seat, cfg) : (keys[seat] ?? NO_INPUT);
      });
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
      const track = trackFor(s?.phase ?? null, screens.showing);
      if (track !== music.wanted) music.play(track);
      // The camera: fit every live head locally; follow your own head online.
      const heads = s ? s.snakes.filter((sn) => sn.alive).map((sn) => ({ x: sn.x, y: sn.y })) : [];
      let target: View;
      if (!s) target = { cx: ARENA_WIDTH / 2, cy: ARENA_HEIGHT / 2, zoom: 1 };
      else target = (online ? online.cameraTarget(s) : null) ?? fitView(heads, ARENA_WIDTH, ARENA_HEIGHT);
      // A wormhole moves a head across the map: no easing there, the camera snaps with it.
      const snap = sink.warped !== null && (!online || sink.warped === online.localPlayer);
      sink.warped = null;
      world.view = easeView(world.view, target, frameSeconds, snap);
      renderer.draw(s, alpha, activeCfg(), performance.now() / 1000, online?.offsets, {
        names,
        local: online ? online.localPlayer : 0,
        show: (s?.snakes.length ?? 0) > 2,
      });
      minimap.draw(s, world.view);
      fx.update(frameSeconds);
      hud.update(s, activeCfg(), performance.now() / 1000);
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
    sink.warped = null;
    loop.timeScale = 1;
    if (location.pathname !== '/') history.replaceState(null, '', '/');
    showTitle();
  };

  const startOnline = (mode: OnlineMode, connection?: RelayConnection) => {
    state = null;
    bots = new Map();
    for (let seat = 0; seat < 8; seat++) hud.setTag(seat, '');
    fx.clear();
    input.clearLatches();
    online = new OnlineMatch(relayUrl(relayBase()), settings.name, mode, {
      connection,
      screens,
      hud,
      fx,
      sink,
      input,
      onExit: leaveOnline,
      onAi: (winsToWin) => {
        // Nobody came: play the Hard AI locally at the chosen length, leaving the saved opponent alone.
        leaveOnline();
        cfg.winsToWin = winsToWin;
        startLocal('hard', 2);
      },
      onNames: (n) => (names = n),
      onRoomNameRefused: (name, message) => {
        // Back to the form with the relay's reason (the name is taken, most likely).
        leaveOnline();
        lastRoomName = name;
        askRoomName(mode.kind === 'create' ? mode.winsToWin : cfg.winsToWin, message);
      },
      setTimeScale: (scale) => (loop.timeScale = scale),
    });
  };

  /** The last room name the host typed, so the form remembers it for this visit. */
  let lastRoomName = '';
  /** CREATE LINK: an optional room name (empty means a random code), then the room. */
  const askRoomName = (winsToWin: number, problem: string | null = null) => {
    screens.roomNameBox(lastRoomName, problem, (name) => {
      if (name === null) {
        showTitle();
        return;
      }
      lastRoomName = name;
      const size = settings.players;
      startOnline(name ? { kind: 'create', winsToWin, size, name } : { kind: 'create', winsToWin, size });
    });
  };

  let askedName = false;
  /** Asks for a name the first time, then goes online (creating a room asks for its name first). */
  const beginOnline = (mode: OnlineMode) => {
    const go = () => (mode.kind === 'create' ? askRoomName(mode.winsToWin) : startOnline(mode));
    if (settings.name || askedName) {
      go();
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
      go();
    });
  };

  const startLocal = (forceAi?: Difficulty, players = settings.players) => {
    state = createMatch(cfg, newSeed(), players);
    seatOpponents(players, forceAi);
    input.clearLatches();
    screens.clear();
  };

  input.onKey((code) => {
    sound.unlock();
    music.unlock();
    if (code === 'KeyM') {
      settings.muted = !settings.muted;
      applyMusicSettings();
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
      case 'KeyH':
      case 'Slash':
        // The Powers page is reachable whenever the game isn't running: from the title or from pause.
        if (screens.showing === 'powers') {
          if (paused) screens.paused();
          else showTitle();
        } else if (!state) {
          screens.powers(cfg, 'title');
        } else if (paused) {
          screens.powers(cfg, 'pause');
        }
        return;
      case 'Escape':
        if (screens.showing === 'powers') {
          if (paused) screens.paused();
          else showTitle();
        } else if (state?.phase === 'matchOver') {
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
        if (state || screens.showing === 'powers') return;
        const delta = code === 'ArrowLeft' || code === 'KeyA' ? -1 : 1;
        if (menuRow === 'local') settings.opponent = nextOpponent(settings.opponent, delta);
        else if (menuRow === 'players') settings.players = nextPlayers(settings.players, delta);
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
        if (!state && screens.showing !== 'powers') {
          menuRow = nextRow(menuRow, code === 'ArrowUp' || code === 'KeyW' ? -1 : 1);
          showTitle();
        }
        return;
      case 'Space':
        if (screens.showing === 'powers') return;
        if (!state) {
          if (menuRow === 'create') beginOnline({ kind: 'create', winsToWin: cfg.winsToWin, size: settings.players });
          else if (menuRow === 'quick') beginOnline({ kind: 'quick', winsToWin: cfg.winsToWin, size: settings.players });
          else startLocal();
        } else if (state.phase === 'matchOver') {
          rematch(state, cfg, newSeed());
          seatOpponents(state.snakes.length);
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

  // A read-only debug handle (browser checks, and a console peek in production).
  window.__snakeboom = {
    get state() {
      return activeState();
    },
    get online() {
      return online;
    },
    get music() {
      return { current: music.current, wanted: music.wanted, ready: music.ready, rendered: music.rendered };
    },
  };

  if (rejoin && early) startOnline({ kind: 'rejoin', ...rejoin }, early);
  else if (joinCode) beginOnline({ kind: 'join', room: joinCode });
  else showTitle();
  loop.start();
  // The songs render in idle time once the title is up, so the first play doesn't wait.
  music.prerender();
}

boot().catch((err: unknown) => {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = `SnakeBoom couldn't start (${err instanceof Error ? err.message : String(err)}). Your browser may not support WebGL.`;
  document.body.appendChild(box);
});
