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
  type PickupKind,
  type SimEvent,
} from '../sim';
import { Sound, type SoundName } from './audio';
import { PICKUP_COLORS, PLAYER_COLORS } from './colors';
import { Hud } from './hud';
import { KeyboardInput } from './input';
import { FixedLoop } from './loop';
import { Fx } from './render/fx';
import { Renderer } from './render/renderer';
import { applyBloom, createWorld } from './render/world';
import { Screens } from './screens';
import { deathBeatAt } from './deathBeat';
import { browserStorage, CONFIG_KEY, loadSettings, loadStored, saveStored, SETTINGS_KEY, settingsDefaults } from './settings';
import { describeRound, nextOpponent, nextWins } from './text';
import { createTuningPanel } from './tuning';

declare global {
  interface Window {
    /** Dev-only handle for browser tests. */
    __snakeboom?: { readonly state: MatchState | null };
  }
}

/** Bombs tick audibly during their last half second. */
const FUSE_TICK_FROM = 30;
const FUSE_TICK_EVERY = 8;

const ITEM_SOUNDS: Partial<Record<PickupKind, SoundName>> = {
  ghost: 'ghost',
  turbo: 'turbo',
  slow: 'slow',
  reverse: 'reverse',
  dozer: 'dozer',
};

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
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

  let state: MatchState | null = null;
  /** Steers PINK when the opponent setting isn't human. */
  let ai: OpponentState | null = null;
  const AI_SEAT = 1;
  let paused = false;
  let tuningOpen = false;
  const fuseStage = new Map<number, number>();
  let beat: { start: number; x: number; y: number } | null = null;
  const now = () => performance.now() / 1000;
  const newSeed = () => Math.floor(Math.random() * 2 ** 31);
  const persist = () => {
    saveStored(storage, CONFIG_KEY, cfg);
    saveStored(storage, SETTINGS_KEY, settings);
  };
  const showTitle = () => screens.title(cfg.winsToWin, cfg.hearts, settings.opponent);
  /** Seats the AI (or a human) for a new match, so a mid-match setting change waits for the next one. */
  const seatOpponent = () => {
    ai = settings.opponent === 'human' ? null : createOpponent(settings.opponent, newSeed());
    hud.setTag(AI_SEAT, ai ? 'AI' : '');
  };

  const tuning = createTuningPanel(cfg, settings, {
    onChange: () => {
      applyBloom(world, settings);
      persist();
      if (!state) showTitle();
    },
  });

  const setPaused = (value: boolean) => {
    if (!state || state.phase === 'matchOver' || paused === value) return;
    paused = value;
    input.clearLatches();
    if (paused) screens.paused();
    else screens.resume();
  };

  const handle = (events: SimEvent[]) => {
    if (!state) return;
    for (const e of events) {
      switch (e.type) {
        case 'countdown':
          screens.countdown(e.n);
          sound.play('beep');
          break;
        case 'go':
          screens.countdown('GO');
          sound.play('go');
          break;
        case 'boostStarted':
          sound.play('boost', 0.6);
          break;
        case 'overtime':
          sound.play('overtime');
          screens.flash(`OVERTIME · GROWTH ×${cfg.overtimeGrowthMultiplier}`, 'var(--red)', 1600);
          break;
        case 'death':
          fx.deathBurst(state.snakes[e.player], PLAYER_COLORS[e.player]);
          sound.play('death');
          beat = { start: now(), x: e.x, y: e.y };
          break;
        case 'nearMiss':
          fx.nearMissSparks(e.x, e.y, PLAYER_COLORS[e.player]);
          sound.play('nearMiss', 0.5);
          break;
        case 'roundOver': {
          const { title, detail } = describeRound(e.winner, e.deaths);
          screens.roundOver(title, detail, e.winner);
          sound.play(e.winner === null ? 'draw' : 'roundWin');
          break;
        }
        case 'matchOver':
          screens.matchOver(e.winner, state.scores);
          sound.play('matchWin');
          break;
        case 'pickupSpawned':
          sound.play('pickupSpawn', 0.5);
          break;
        case 'pickupCollected': {
          const s = state.snakes[e.player];
          fx.pickupBurst(s.x, s.y, PICKUP_COLORS[e.kind]);
          sound.play('pickup');
          break;
        }
        case 'bombThrown':
          sound.play('bombThrow');
          break;
        case 'bombLanded':
          sound.play('bombDrop', 0.8);
          break;
        case 'explosion':
          fx.explosion(e.x, e.y, e.radius, e.chainDepth, e.tilesDestroyed);
          sound.play('explosion', 1, 1 + 0.12 * Math.min(e.chainDepth, 5));
          break;
        case 'itemUsed': {
          const name = ITEM_SOUNDS[e.kind];
          if (name) sound.play(name);
          break;
        }
        case 'effectStarted': {
          const s = state.snakes[e.player];
          fx.pickupBurst(s.x, s.y, PICKUP_COLORS[e.effect]);
          break;
        }
        case 'effectEnded':
          if (e.effect === 'ghost') sound.play('ghostEnd', 0.7);
          break;
        case 'plowed':
          fx.debris(e.crushed);
          sound.play('scrape', 0.6);
          break;
        case 'heartLost':
          fx.heartBurst(e.x, e.y);
          sound.play('hurt');
          break;
        case 'shieldBlocked':
          fx.shieldBurst(e.x, e.y);
          sound.play('shield');
          break;
      }
    }
  };

  const tickFuses = () => {
    if (!state || paused) return;
    if (state.bombs.length === 0) {
      fuseStage.clear();
      return;
    }
    for (const b of state.bombs) {
      if (b.flight > 0 || b.fuse > FUSE_TICK_FROM) continue;
      const stage = Math.floor(b.fuse / FUSE_TICK_EVERY);
      if (fuseStage.get(b.id) !== stage) {
        fuseStage.set(b.id, stage);
        sound.play('tick', 0.5);
      }
    }
  };

  input.onKey((code) => {
    sound.unlock();
    switch (code) {
      case 'Backquote':
        tuningOpen = !tuningOpen;
        if (tuningOpen) tuning.show();
        else tuning.hide();
        return;
      case 'KeyM':
        settings.muted = !settings.muted;
        tuning.refresh();
        persist();
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
      case 'KeyD':
        if (!state) {
          cfg.winsToWin = nextWins(cfg.winsToWin, code === 'ArrowLeft' || code === 'KeyA' ? -1 : 1);
          tuning.refresh();
          persist();
          showTitle();
        }
        return;
      case 'ArrowUp':
      case 'KeyW':
      case 'ArrowDown':
      case 'KeyS':
        if (!state) {
          settings.opponent = nextOpponent(settings.opponent, code === 'ArrowUp' || code === 'KeyW' ? -1 : 1);
          tuning.refresh();
          persist();
          showTitle();
        }
        return;
      case 'Space':
        if (!state) {
          state = createMatch(cfg, newSeed());
          seatOpponent();
          input.clearLatches();
          screens.clear();
        } else if (state.phase === 'matchOver') {
          rematch(state, cfg, newSeed());
          seatOpponent();
          fx.clear();
          screens.clear();
        }
        return;
    }
  });
  input.onBlur(() => setPaused(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPaused(true);
  });

  if (import.meta.env.DEV) {
    window.__snakeboom = {
      get state() {
        return state;
      },
    };
  }

  showTitle();
  new FixedLoop(
    () => {
      if (!state || paused) return;
      const inputs = input.sample();
      if (ai) inputs[AI_SEAT] = opponentInput(ai, state, AI_SEAT, cfg);
      handle(step(state, inputs, cfg));
    },
    (alpha, frameSeconds) => {
      const f = beat ? deathBeatAt(now() - beat.start, settings) : null;
      if (beat && f && f.fxTimeScale === 1 && f.zoom === 1) beat = null;
      fx.timeScale = f ? f.fxTimeScale : 1;
      fx.setCamera(f ? f.zoom : 1, beat ? beat.x : 0, beat ? beat.y : 0);
      fx.setFlash(f ? f.flash : 0);
      renderer.draw(state, alpha, cfg, performance.now() / 1000);
      fx.update(frameSeconds);
      hud.update(state, cfg, performance.now() / 1000);
      tickFuses();
    },
  ).start();
}

boot().catch((err: unknown) => {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = `SnakeBoom couldn't start (${err instanceof Error ? err.message : String(err)}). Your browser may not support WebGL.`;
  document.body.appendChild(box);
});
