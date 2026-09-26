import { roundCapSeconds, slotsFor, TICK_RATE, trailLength, type Config, type EffectName, type MatchState, type SnakeState } from '../sim';
import { blinkOn } from './blink';
import { PLAYER_CSS } from './colors';
import { PLAYER_NAMES, describeItem, formatClock } from './text';

/** Body length that fills the bar. */
const LENGTH_BAR_MAX = 1200;

const EFFECT_ORDER: EffectName[] = ['dozer', 'scissors', 'flame', 'ghost'];
const EFFECT_LABELS: Record<EffectName, string> = {
  dozer: 'DOZER',
  scissors: 'SCISSORS',
  flame: 'FLAME',
  ghost: 'GHOST',
};

/** Numbers for the net readout, computed by the online match from the session's stats. */
export interface NetReadout {
  inputDelay: number;
  rollbacksPerMin: number;
  maxRollbackDepth: number;
  stallsPerMin: number;
  lead: number;
  timeScale: number;
}

interface Side {
  /** Which player this panel shows. */
  player: number;
  root: HTMLElement;
  name: HTMLElement;
  hearts: HTMLElement;
  pips: HTMLElement;
  fill: HTMLElement;
  effects: HTMLElement;
  slots: HTMLElement;
  lastHearts: string;
  lastEffects: string;
  lastSlots: string;
  lastPips: string;
}

/**
 * Top bar. Two players: a full panel each side (names, hearts, score pips, length bar, active
 * effects, item queue). More: your own full panel on the left and a compact scoreboard of
 * everyone else on the right. The clock, ping and net readout sit in the middle.
 */
export class Hud {
  private sides: Side[] = [];
  private board: HTMLElement | null = null;
  private clock!: HTMLElement;
  private ping!: HTMLElement;
  private net!: HTMLElement;
  private names: string[] = [...PLAYER_NAMES];
  private tags: string[] = PLAYER_NAMES.map(() => '');
  /** The seat whose panel goes on the left in the scoreboard layout. */
  private local = 0;
  /** The player count the bar is laid out for; −1 before the first match. */
  private layoutPlayers = -1;
  private layoutLocal = -1;
  private lastClock = '';
  private lastPing = '';
  private lastNet = '';
  private lastBoard = '';

  constructor(private readonly root: HTMLElement) {
    this.layout(2, 0);
  }

  /** Rebuilds the bar for `players` seats with `local`'s panel on the left. */
  private layout(players: number, local: number): void {
    if (players === this.layoutPlayers && local === this.layoutLocal) return;
    this.layoutPlayers = players;
    this.layoutLocal = local;
    const side = (player: number, cls: string) =>
      `<div class="side ${cls}" data-player="${player}" style="color:${PLAYER_CSS[player] ?? 'var(--text)'}">` +
      `<div class="row"><span class="name"></span><span class="hearts"></span><span class="pips"></span></div>` +
      `<div class="row"><span class="boost"><span class="fill" style="display:block"></span></span>` +
      `<span class="effects"></span><span class="slots"></span></div></div>`;
    const center = `<div class="center"><div class="clock">0:00</div><div class="ping"></div><div class="net"></div></div>`;
    const right = players <= 2 ? side(1, 'p2') : `<div class="board"></div>`;
    this.root.innerHTML = `${side(players <= 2 ? 0 : local, 'p1')}${center}${right}`;
    this.sides = [...this.root.querySelectorAll<HTMLElement>('.side')].map((el) => ({
      player: Number(el.dataset.player),
      root: el,
      name: el.querySelector<HTMLElement>('.name')!,
      hearts: el.querySelector<HTMLElement>('.hearts')!,
      pips: el.querySelector<HTMLElement>('.pips')!,
      fill: el.querySelector<HTMLElement>('.fill')!,
      effects: el.querySelector<HTMLElement>('.effects')!,
      slots: el.querySelector<HTMLElement>('.slots')!,
      lastHearts: '-',
      lastEffects: '-',
      lastSlots: '-',
      lastPips: '-',
    }));
    this.board = this.root.querySelector<HTMLElement>('.board');
    this.clock = this.root.querySelector<HTMLElement>('.clock')!;
    this.ping = this.root.querySelector<HTMLElement>('.ping')!;
    this.net = this.root.querySelector<HTMLElement>('.net')!;
    this.lastClock = '';
    this.lastPing = '';
    this.lastNet = '';
    this.lastBoard = '';
    for (const s of this.sides) this.renderName(s.player);
  }

  /** Which seat is "you": its panel goes on the left when there are more than two players. */
  setLocal(player: number): void {
    this.local = Math.max(0, player);
  }

  /** The netcode readout under the ping (the N key online); null hides it. */
  setNet(net: NetReadout | null): void {
    const text = net
      ? `delay ${net.inputDelay} · rb ${net.rollbacksPerMin.toFixed(1)}/min (max ${net.maxRollbackDepth}) · stall ${net.stallsPerMin.toFixed(1)}/min · lead ${net.lead >= 0 ? '+' : ''}${net.lead.toFixed(1)} · ×${net.timeScale.toFixed(3)}`
      : '';
    if (text === this.lastNet) return;
    this.lastNet = text;
    this.net.textContent = text;
  }

  /** Adds a tag after a player's name (like AI) or clears it with an empty string. */
  setTag(player: number, tag: string): void {
    this.tags[player] = tag;
    this.renderName(player);
  }

  /** Replaces the default names with the players' chosen names (online). */
  setNames(names: readonly string[]): void {
    names.forEach((name, i) => {
      this.names[i] = name || PLAYER_NAMES[i];
      this.renderName(i);
    });
    this.lastBoard = '';
  }

  /** The ping readout under the clock: hidden when null, amber above 120 ms, red with WAITING during a lasting stall. */
  setPing(ms: number | null, stalled: boolean): void {
    const base = ms === null ? '' : `${Math.round(ms)} ms`;
    const text = stalled ? (base ? `${base} · WAITING` : 'WAITING') : base;
    const cls = stalled ? 'stalled' : ms !== null && ms > 120 ? 'slow' : '';
    const key = `${text}|${cls}`;
    if (key === this.lastPing) return;
    this.lastPing = key;
    this.ping.textContent = text;
    this.ping.className = `ping ${cls}`.trim();
  }

  private label(player: number): string {
    const tag = this.tags[player];
    const name = this.names[player] ?? PLAYER_NAMES[player] ?? `P${player + 1}`;
    return tag ? `${name} · ${tag}` : name;
  }

  private renderName(player: number): void {
    const side = this.sides.find((s) => s.player === player);
    if (side) side.name.textContent = this.label(player);
    this.lastBoard = '';
  }

  update(state: MatchState | null, cfg: Config, t = 0): void {
    this.root.classList.toggle('on', state !== null);
    if (!state) return;
    this.layout(state.snakes.length, Math.min(this.local, state.snakes.length - 1));

    for (const side of this.sides) {
      const s = state.snakes[side.player];
      if (!s) continue;
      const score = state.scores[side.player] ?? 0;
      // Two players: a pip per round win. More: the points, since places score differently.
      const pipsKey = `${cfg.winsToWin}:${score}:${state.snakes.length}`;
      if (pipsKey !== side.lastPips) {
        side.lastPips = pipsKey;
        side.pips.innerHTML =
          state.snakes.length <= 2
            ? Array.from({ length: Math.max(cfg.winsToWin, score) }, (_, k) => `<span class="pip${k < score ? ' on' : ''}"></span>`).join('')
            : `<span class="points">${score}</span>`;
      }

      // The bar is body length (boost fuel), dim once there is nothing left to burn.
      const length = trailLength(s.trail);
      side.fill.style.width = `${Math.round(Math.min(1, length / LENGTH_BAR_MAX) * 100)}%`;
      side.fill.style.opacity = s.targetLength > cfg.minLength ? '1' : '0.35';

      const heartsKey = `${s.hearts}/${cfg.hearts}`;
      if (heartsKey !== side.lastHearts) {
        side.lastHearts = heartsKey;
        side.hearts.innerHTML = heartsHtml(s.hearts, cfg.hearts);
      }

      const active = EFFECT_ORDER.filter((e) => s.effects[e] > 0);
      const effectsKey = active.map((e) => `${e}:${Math.ceil(s.effects[e] / TICK_RATE)}`).join(',');
      if (effectsKey !== side.lastEffects) {
        side.lastEffects = effectsKey;
        side.effects.innerHTML = active
          .map((e) => `<span class="slot chip" data-kind="${e}" data-effect="${e}">${EFFECT_LABELS[e]} ${Math.ceil(s.effects[e] / TICK_RATE)}</span>`)
          .join('');
      }
      for (const chip of side.effects.querySelectorAll<HTMLElement>('[data-effect]')) {
        const ticks = s.effects[chip.dataset.effect as EffectName];
        chip.style.visibility = blinkOn(ticks / TICK_RATE, cfg.effectWarning, t) ? 'visible' : 'hidden';
      }

      // Length is storage: the slots you have grown into are open, the rest of the cap is locked.
      const open = slotsFor(s, cfg);
      const slotsKey = `${open}/${cfg.itemSlots}|${s.shield}|${s.selected}|${s.items.map((it) => `${it.kind}:${it.charges}`).join(',')}`;
      if (slotsKey !== side.lastSlots) {
        side.lastSlots = slotsKey;
        side.slots.innerHTML = slotsHtml(s, open, cfg.itemSlots);
      }
    }

    if (this.board) this.renderBoard(state);

    // While the border closes, the clock counts down to the cap in red; past it, it shows how long the crush has run.
    const capTicks = Math.round(roundCapSeconds(cfg, state.snakes.length) * TICK_RATE);
    const closing = state.phase !== 'countdown' && state.inset > 0;
    const clock = state.overtime
      ? `OVERTIME ${formatClock(state.roundTicks, TICK_RATE)}`
      : closing && state.roundTicks < capTicks
        ? formatClock(capTicks - state.roundTicks, TICK_RATE)
        : formatClock(state.roundTicks, TICK_RATE);
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clock.textContent = clock;
      this.clock.classList.toggle('overtime', state.overtime || closing);
    }
  }

  /** Everyone but the local player, best score first: selected item, score, name and a colour dot. */
  private renderBoard(state: MatchState): void {
    const local = this.sides[0]?.player ?? this.local;
    const rows = state.snakes
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => i !== local)
      .sort((a, b) => (state.scores[b.i] ?? 0) - (state.scores[a.i] ?? 0) || a.i - b.i);
    const key = rows.map(({ s, i }) => `${i}:${state.scores[i]}:${s.alive ? 1 : 0}:${s.items[s.selected]?.kind ?? ''}:${this.label(i)}`).join('|');
    if (key === this.lastBoard) return;
    this.lastBoard = key;
    this.board!.innerHTML = rows
      .map(({ s, i }) => {
        const item = s.alive ? describeItem(s.items[s.selected] ?? null) : 'OUT';
        return (
          `<div class="entry${s.alive ? '' : ' dead'}" style="color:${PLAYER_CSS[i] ?? 'var(--text)'}">` +
          `<span class="item">${escape(item)}</span><span class="score">${state.scores[i] ?? 0}</span>` +
          `<span class="board-name">${escape(this.label(i))}</span><span class="dot"></span></div>`
        );
      })
      .join('');
  }
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

function heartsHtml(hearts: number, max: number): string {
  return Array.from({ length: Math.max(1, Math.round(max)) }, (_, k) => `<span class="heart${k < hearts ? '' : ' lost'}">♥</span>`).join('');
}

/**
 * The Shield bubble chip, then the item queue with the selected item (what Fire uses) highlighted:
 * `open` slots the body can fill now, and the rest up to `cap` locked (dimmer) until it grows into them.
 */
export function slotsHtml(s: SnakeState, open: number, cap: number): string {
  const shield = s.shield ? '<span class="slot chip" data-kind="shield">SHIELD</span>' : '';
  const cells = Array.from({ length: Math.max(cap, s.items.length) }, (_, k) => {
    const item = s.items[k];
    if (!item) return k < open ? '<span class="slot">—</span>' : '<span class="slot locked">·</span>';
    return `<span class="slot full${k === s.selected ? ' selected' : ''}" data-kind="${item.kind}">${describeItem(item)}</span>`;
  });
  return shield + cells.join('');
}
