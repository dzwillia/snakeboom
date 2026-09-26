import GUI from 'lil-gui';
import { CLASSIC_CONFIG, type Config, type PickupKind } from '../sim';
import { CONFIG_FOLDERS } from '../sim/configSchema';
import { DEFAULT_SETTINGS, OPPONENT_MODES, resetInPlace, type ClientSettings } from './settings';
import { describeOpponent } from './text';

export interface TuningPanel {
  show(): void;
  hide(): void;
  /** Re-reads values changed outside the panel (e.g. the M mute key). */
  refresh(): void;
}

/** One lil-gui folder per schema folder, bound to `cfg`. Shared with the /admin page. */
export function addConfigFolders(gui: GUI, cfg: Config): void {
  for (const folder of CONFIG_FOLDERS) {
    const f = gui.addFolder(folder.name);
    for (const row of folder.rows) {
      switch (row.kind) {
        case 'number':
          f.add(cfg, row.key, row.min, row.max, row.step).name(row.label);
          break;
        case 'boolean':
          f.add(cfg, row.key).name(row.label);
          break;
        case 'maps':
          f.add(cfg, row.key, row.options).name(row.label);
          break;
        case 'weights':
          for (const kind of Object.keys(cfg.pickupWeights) as PickupKind[]) f.add(cfg.pickupWeights, kind, row.min, row.max, row.step);
          break;
      }
    }
  }
}

/** Live sliders for every M1 tunable. The sim reads `cfg` each tick, so changes apply at once. */
export function createTuningPanel(cfg: Config, settings: ClientSettings, base: Config, hooks: { onChange(): void }): TuningPanel {
  const gui = new GUI({ title: 'SnakeBoom tuning  ( ` to hide )' });

  // Presets: the current defaults, or the v0.7.0 feel for a side-by-side.
  const presets = {
    preset: 'pace',
    apply() {
      resetInPlace(cfg, presets.preset === 'classic' ? CLASSIC_CONFIG : base);
      refresh();
      hooks.onChange();
    },
  };
  gui.add(presets, 'preset', { 'Pace (default + house rules)': 'pace', 'Classic (v0.7)': 'classic' }).name('preset').onChange(() => presets.apply());

  const opponent = gui.addFolder('Opponent');
  opponent
    .add(settings, 'opponent', Object.fromEntries(OPPONENT_MODES.map((m) => [describeOpponent(m), m])))
    .name('PINK is');

  addConfigFolders(gui, cfg);

  const fx = gui.addFolder('Effects');
  fx.add(settings, 'bloom');
  fx.add(settings, 'bloomStrength', 0, 4, 0.1).name('bloom strength');
  fx.add(settings, 'bloomThreshold', 0, 1, 0.05).name('bloom threshold');
  fx.add(settings, 'shakeScale', 0, 3, 0.1).name('screen shake');
  fx.add(settings, 'reduceMotion').name('reduce motion');
  fx.add(settings, 'hitStopSeconds', 0, 0.5, 0.01).name('death freeze (s)');
  fx.add(settings, 'slowMoScale', 0.05, 1, 0.05).name('death slow-mo ×');
  fx.add(settings, 'slowMoSeconds', 0, 3, 0.1).name('death slow-mo (s)');

  const audio = gui.addFolder('Audio');
  audio.add(settings, 'masterVolume', 0, 1, 0.05).name('volume');
  audio.add(settings, 'muted');
  audio.add(settings, 'musicOn').name('music');
  audio.add(settings, 'musicVolume', 0, 1, 0.05).name('music volume');

  for (const folder of gui.folders.slice(1)) folder.close();
  function refresh(): void {
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
  const actions = {
    reset: () => {
      resetInPlace(cfg, base);
      resetInPlace(settings, DEFAULT_SETTINGS);
      refresh();
      hooks.onChange();
    },
    copy: () => {
      void navigator.clipboard?.writeText(JSON.stringify({ config: cfg, settings }, null, 2)).catch(() => {});
    },
  };
  gui.add(actions, 'reset').name('Reset to defaults');
  gui.add(actions, 'copy').name('Copy config JSON');
  gui.onChange(() => hooks.onChange());
  gui.hide();

  return { show: () => gui.show(), hide: () => gui.hide(), refresh };
}
