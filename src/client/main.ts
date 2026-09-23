import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import './style.css';
import { createMatch, DEFAULT_CONFIG, rematch, step, type MatchState, type SimEvent } from '../sim';
import { Sound } from './audio';
import { PICKUP_COLORS, PLAYER_COLORS } from './colors';
import { Hud } from './hud';
import { KeyboardInput } from './input';
import { FixedLoop } from './loop';
import { Fx } from './render/fx';
import { Renderer } from './render/renderer';
import { applyBloom, createWorld } from './render/world';
import { Screens } from './screens';
import { browserStorage, CONFIG_KEY, DEFAULT_SETTINGS, loadStored, saveStored, SETTINGS_KEY } from './settings';
import { describeRound } from './text';
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

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

async function boot(): Promise<void> {
  const storage = browserStorage();
  const cfg = loadStored(storage, CONFIG_KEY, DEFAULT_CONFIG);
  const settings = loadStored(storage, SETTINGS_KEY, DEFAULT_SETTINGS);

  const world = await createWorld(element('game'), settings);
  const renderer = new Renderer(world);
  const fx = new Fx(world, settings);
  const hud = new Hud(element('hud'));
  const screens = new Screens(element('screens'));
  const sound = new Sound(settings);
  const input = new KeyboardInput(window);

  let state: MatchState | null = null;
  let paused = false;
  let tuningOpen = false;
  const fuseStage = new Map<number, number>();
  const newSeed = () => Math.floor(Math.random() * 2 ** 31);
  const persist = () => {
    saveStored(storage, CONFIG_KEY, cfg);
    saveStored(storage, SETTINGS_KEY, settings);
  };

  const tuning = createTuningPanel(cfg, settings, {
    onChange: () => {
      applyBloom(world, settings);
      persist();
      if (!state) screens.title(cfg.winsToWin);
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
          break;
        case 'death':
          fx.deathBurst(state.snakes[e.player], PLAYER_COLORS[e.player]);
          sound.play('death');
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
        case 'bombDropped':
          sound.play('bombDrop');
          break;
        case 'explosion':
          fx.explosion(e.x, e.y, e.radius, e.chainDepth, e.tilesDestroyed);
          sound.play('explosion', 1, 1 + 0.12 * Math.min(e.chainDepth, 5));
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
      if (b.fuse > FUSE_TICK_FROM) continue;
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
          screens.title(cfg.winsToWin);
        } else {
          setPaused(!paused);
        }
        return;
      case 'Space':
        if (!state) {
          state = createMatch(cfg, newSeed());
          screens.clear();
        } else if (state.phase === 'matchOver') {
          rematch(state, cfg, newSeed());
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

  screens.title(cfg.winsToWin);
  new FixedLoop(
    () => {
      if (state && !paused) handle(step(state, input.sample(), cfg));
    },
    (alpha, frameSeconds) => {
      renderer.draw(state, alpha, cfg, performance.now() / 1000);
      fx.update(frameSeconds);
      hud.update(state, cfg);
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
