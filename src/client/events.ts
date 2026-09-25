import type { Config, MatchState, PickupKind, SimEvent } from '../sim';
import type { Sound, SoundName } from './audio';
import { PALETTE, PICKUP_COLORS, PLAYER_COLORS } from './colors';
import type { Fx } from './render/fx';
import type { Screens } from './screens';
import { describeRound } from './text';

const ITEM_SOUNDS: Partial<Record<PickupKind, SoundName>> = {
  ghost: 'ghost',
  scissors: 'scissors',
  dozer: 'dozer',
  flame: 'flame',
};

export interface DeathBeat {
  start: number;
  x: number;
  y: number;
}

export interface EventSinkDeps {
  fx: Fx;
  sound: Sound;
  screens: Screens;
  /** The config of the match being played. */
  cfg: () => Config;
  /** Names for the banners, CYAN and PINK unless the players chose their own. */
  names: () => readonly string[];
  /** Seconds, for timing the death beat. */
  now: () => number;
  /** The key hint under the match-over banner. */
  matchOverHint: () => string;
}

/** Turns sim events into effects, sounds and screens. Shared by local and online play. */
export class EventSink {
  /** The running death beat, if any; the render loop reads it. */
  beat: DeathBeat | null = null;
  /** The player a wormhole just moved, for the camera to snap to; the render loop clears it. */
  warped: number | null = null;

  constructor(private readonly deps: EventSinkDeps) {}

  handle(events: readonly SimEvent[], state: MatchState): void {
    const { fx, sound, screens } = this.deps;
    const cfg = this.deps.cfg();
    const names = this.deps.names();
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
        case 'borderClosing':
          sound.play('overtime');
          screens.flash('THE BORDER IS CLOSING', 'var(--red)', 1400);
          break;
        case 'death':
          fx.deathBurst(state.snakes[e.player], PLAYER_COLORS[e.player]);
          sound.play('death');
          this.beat = { start: this.deps.now(), x: e.x, y: e.y };
          break;
        case 'nearMiss':
          fx.nearMissSparks(e.x, e.y, PLAYER_COLORS[e.player]);
          sound.play('nearMiss', 0.5);
          break;
        case 'roundOver': {
          const { title, detail } = describeRound(e.winner, e.deaths, names);
          screens.roundOver(title, detail, e.winner);
          sound.play(e.winner === null ? 'draw' : 'roundWin');
          break;
        }
        case 'matchOver':
          screens.matchOver(e.winner, state.scores, names, this.deps.matchOverHint());
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
        case 'missileFired':
          sound.play('missileFire');
          break;
        case 'missileHit':
          fx.missileHit(e.x, e.y, PLAYER_COLORS[e.player]);
          sound.play('missileHit');
          break;
        case 'cut':
          fx.cutBurst(e.segment, PLAYER_COLORS[e.player]);
          sound.play('snip');
          break;
        case 'encircled':
          fx.loopSnap(e.loop, PLAYER_COLORS[e.by], e.player);
          sound.play('snap');
          break;
        case 'missileFizzled':
          fx.pickupBurst(e.x, e.y, PALETTE.missile);
          sound.play('missileFizzle', 0.6);
          break;
        case 'wormholeOpened':
          fx.ring(e.x, e.y, 60, 0.6, PALETTE.wormhole);
          fx.ring(e.exitX, e.exitY, 40, 0.6, PALETTE.wormhole);
          sound.play('portal', 0.7);
          break;
        case 'wormholeClosed':
          break;
        case 'sawSpawned':
          fx.ring(e.x, e.y, 80, 0.5, PALETTE.saw);
          fx.ring(e.x, e.y, 40, 0.3, 0xffffff);
          sound.play('saw');
          break;
        case 'sawGone':
          break;
        case 'warped':
          fx.warpBurst(e.fromX, e.fromY, e.x, e.y, PLAYER_COLORS[e.player]);
          sound.play('warp');
          this.warped = e.player;
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
  }
}
