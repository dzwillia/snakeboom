import GUI from 'lil-gui';
import { CLASSIC_CONFIG, DEFAULT_CONFIG, type Config, type PickupKind } from '../sim';
import { DEFAULT_SETTINGS, OPPONENT_MODES, resetInPlace, type ClientSettings } from './settings';
import { describeOpponent } from './text';

export interface TuningPanel {
  show(): void;
  hide(): void;
  /** Re-reads values changed outside the panel (e.g. the M mute key). */
  refresh(): void;
}

/** Live sliders for every M1 tunable. The sim reads `cfg` each tick, so changes apply at once. */
export function createTuningPanel(cfg: Config, settings: ClientSettings, hooks: { onChange(): void }): TuningPanel {
  const gui = new GUI({ title: 'SnakeBoom tuning  ( ` to hide )' });

  // Presets: the current defaults, or the v0.7.0 feel for a side-by-side.
  const presets = {
    preset: 'pace',
    apply() {
      resetInPlace(cfg, presets.preset === 'classic' ? CLASSIC_CONFIG : DEFAULT_CONFIG);
      refresh();
      hooks.onChange();
    },
  };
  gui.add(presets, 'preset', { 'Pace (default)': 'pace', 'Classic (v0.7)': 'classic' }).name('preset').onChange(() => presets.apply());

  const opponent = gui.addFolder('Opponent');
  opponent
    .add(settings, 'opponent', Object.fromEntries(OPPONENT_MODES.map((m) => [describeOpponent(m), m])))
    .name('PINK is');

  const move = gui.addFolder('Movement');
  move.add(cfg, 'baseSpeed', 60, 400, 5).name('speed');
  move.add(cfg, 'turnRate', 1, 8, 0.1).name('turn rate (rad/s)');
  move.add(cfg, 'snakeRadius', 3, 14, 0.5).name('thickness (radius)');

  const growth = gui.addFolder('Growth');
  growth.add(cfg, 'startLength', 20, 600, 10).name('start length');
  growth.add(cfg, 'growthPerSecond', 0, 200, 5).name('growth per second');
  growth.add(cfg, 'overtimeAt', 10, 300, 5).name('overtime at (s)');
  growth.add(cfg, 'overtimeGrowthMultiplier', 1, 10, 0.5).name('overtime growth ×');
  growth.add(cfg, 'roundMaxSeconds', 20, 600, 5).name('round cap (s)');

  const border = gui.addFolder('Border');
  border.add(cfg, 'borderCloseSeconds', 0, 60, 1).name('closes from (s before cap)');
  border.add(cfg, 'borderCloseSpeed', 0, 100, 1).name('close speed (units/s)');
  border.add(cfg, 'borderCrushSpeed', 0, 400, 10).name('crush speed after cap');

  const boost = gui.addFolder('Boost');
  boost.add(cfg, 'boostMultiplier', 1, 3, 0.1).name('speed ×');
  boost.add(cfg, 'boostBurnPerSecond', 0, 300, 5).name('burns body (units/s)');
  boost.add(cfg, 'minLength', 20, 400, 10).name('min body to boost');

  const match = gui.addFolder('Match');
  match.add(cfg, 'winsToWin', 1, 10, 1).name('first to');
  match.add(cfg, 'hearts', 1, 5, 1).name('hearts');
  match.add(cfg, 'heartGrace', 0, 3, 0.1).name('grace after a hit (s)');
  match.add(cfg, 'countdownSeconds', 1, 5, 1).name('countdown (s)');
  match.add(cfg, 'roundOverSeconds', 1, 6, 0.5).name('round banner (s)');

  const pickups = gui.addFolder('Pickups');
  pickups.add(cfg, 'maxPickups', 0, 10, 1).name('max on field');
  pickups.add(cfg, 'itemSlots', 1, 5, 1).name('item slots');
  pickups.add(cfg, 'firstPickupDelay', 0, 20, 0.5).name('first spawn (s)');
  pickups.add(cfg, 'pickupInterval', 1, 30, 0.5).name('spawn every (s)');
  pickups.add(cfg, 'pickupLifetime', 3, 60, 1).name('lifetime (s)');
  pickups.add(cfg, 'pickupRadius', 6, 30, 1).name('size');
  pickups.add(cfg, 'pickupMinHeadDistance', 0, 400, 10).name('min distance from heads');
  pickups.add(cfg, 'pickupClearance', 10, 120, 5).name('clearance');

  const missiles = gui.addFolder('Missiles');
  missiles.add(cfg, 'missileCharges', 1, 10, 1).name('shots per pickup');
  missiles.add(cfg, 'missileCooldown', 0, 2, 0.05).name('cooldown (s)');
  missiles.add(cfg, 'missileSpeed', 100, 900, 10).name('speed');
  missiles.add(cfg, 'missileTurnRate', 0.5, 12, 0.1).name('turn rate (rad/s)');
  missiles.add(cfg, 'missileLife', 0.5, 6, 0.1).name('life (s)');
  missiles.add(cfg, 'missileRadius', 4, 30, 1).name('radius');

  const loops = gui.addFolder('Loops');
  loops.add(cfg, 'loopIgnore', 8, 80, 2).name('own neck ignored (units)');

  const power = gui.addFolder('Power-ups');
  power.add(cfg, 'ghostDuration', 0.5, 10, 0.25).name('ghost (s)');
  power.add(cfg, 'effectWarning', 0, 10, 0.25).name('expiry warning (s)');
  power.add(cfg, 'shieldGrace', 0, 3, 0.1).name('shield grace (s)');
  power.add(cfg, 'dozerDuration', 0.5, 15, 0.5).name('bulldozer (s)');
  power.add(cfg, 'scissorsDuration', 0.5, 15, 0.5).name('scissors (s)');

  const mix = gui.addFolder('Pickup mix');
  for (const kind of Object.keys(cfg.pickupWeights) as PickupKind[]) mix.add(cfg.pickupWeights, kind, 0, 100, 1);

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

  for (const folder of gui.folders.slice(1)) folder.close();
  function refresh(): void {
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
  const actions = {
    reset: () => {
      resetInPlace(cfg, DEFAULT_CONFIG);
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
