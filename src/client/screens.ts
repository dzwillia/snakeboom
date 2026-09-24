import type { Config } from '../sim';
import { PLAYER_CSS } from './colors';
import { glyphSvg } from './glyphs';
import type { OpponentMode } from './settings';
import { describeOpponent, describePower, PLAYER_NAMES, POWER_ORDER } from './text';

type ScreenKind = 'none' | 'title' | 'countdown' | 'banner' | 'matchOver' | 'paused' | 'powers';

/** Centered overlay messages. All strings are our own, never user input. */
export class Screens {
  private token = 0;
  private kind: ScreenKind = 'none';
  private beforePause: { kind: ScreenKind; html: string } | null = null;

  constructor(private readonly root: HTMLElement) {}

  clear(): void {
    this.show('', 'none');
  }

  title(winsToWin: number, hearts: number, opponent: OpponentMode = 'human'): void {
    const pink =
      opponent === 'human'
        ? `<p><kbd>←</kbd> <kbd>→</kbd> steer</p><p><kbd>↑</kbd> boost</p><p><kbd>↓</kbd> use item</p>`
        : `<p>${describeOpponent(opponent)}</p><p class="dim">plays this seat</p>`;
    this.show(
      `
      <div class="panel">
        <div class="logo">SNAKEBOOM</div>
        <div class="controls">
          <div class="p1"><h3>${PLAYER_NAMES[0]}</h3>
            <p><kbd>A</kbd> <kbd>D</kbd> steer</p><p><kbd>W</kbd> boost</p><p><kbd>S</kbd> use item</p></div>
          <div class="p2"><h3>${PLAYER_NAMES[1]}</h3>${pink}</div>
        </div>
        <div class="small">PICKUPS: BOMB · GHOST · SHIELD · TURBO · SLOW · REVERSE · DOZER</div>
        <div class="hint">PRESS SPACE TO START</div>
        <div class="selector">FIRST TO <kbd>◀</kbd> <span class="wins">${winsToWin}</span> <kbd>▶</kbd></div>
        <div class="selector">${PLAYER_NAMES[1]} <kbd>▲</kbd> <span class="mode">${describeOpponent(opponent)}</span> <kbd>▼</kbd></div>
        <div class="small">${hearts} ${hearts === 1 ? 'HEART' : 'HEARTS'} EACH PER ROUND</div>
        <div class="small"><kbd>H</kbd> POWERS · <kbd>ESC</kbd> PAUSE · <kbd>M</kbd> MUTE · <kbd>\`</kbd> TUNING</div>
      </div>`,
      'title',
    );
  }

  /** The Powers page: every pickup, what it does, and the numbers it currently runs on. */
  powers(cfg: Config, back: 'title' | 'pause' = 'title'): void {
    const cards = POWER_ORDER.map((kind) => {
      const info = describePower(kind, cfg);
      return (
        `<div class="power" data-kind="${kind}"><div class="glyph">${glyphSvg(kind)}</div>` +
        `<h3>${info.name}</h3><div class="stats">${info.stats}</div><p>${info.detail}</p></div>`
      );
    });
    const slots = cfg.itemSlots === 1 ? 'one item' : `up to ${cfg.itemSlots} items`;
    this.show(
      `
      <div class="panel powers">
        <h2>POWERS</h2>
        <p class="lead">PICKUPS SPAWN ALL ROUND · YOU CARRY ${slots.toUpperCase()} · USE FIRES THE OLDEST · TIMED POWERS FLASH FOR THEIR LAST ${cfg.effectWarning} S</p>
        <div class="grid">${cards.join('')}</div>
        <div class="small footer"><kbd>H</kbd> OR <kbd>ESC</kbd> BACK TO ${back === 'title' ? 'TITLE' : 'PAUSE'}</div>
      </div>`,
      'powers',
    );
  }

  get showing(): ScreenKind {
    return this.kind;
  }

  countdown(n: number | 'GO'): void {
    const token = this.show(`<div class="big" style="color:var(--text)">${n}</div>`, 'countdown');
    if (n === 'GO') this.clearLater(token, 700);
  }

  /** A transient callout (like OVERTIME) that clears itself unless something replaces it first. */
  flash(text: string, colorCss: string, ms: number): void {
    const token = this.show(`<div class="banner-title" style="color:${colorCss}">${text}</div>`, 'countdown');
    this.clearLater(token, ms);
  }

  roundOver(title: string, detail: string, winner: number | null): void {
    const color = winner === null ? 'var(--text)' : PLAYER_CSS[winner];
    this.show(
      `<div><div class="banner-title" style="color:${color}">${title}</div><div class="banner-detail">${detail}</div></div>`,
      'banner',
    );
  }

  matchOver(winner: number, scores: readonly number[]): void {
    this.show(
      `
      <div class="panel">
        <div class="banner-title" style="color:${PLAYER_CSS[winner]}">${PLAYER_NAMES[winner]} WINS</div>
        <div class="banner-detail">${scores.join(' – ')}</div>
        <div class="hint">SPACE REMATCH · ESC MENU</div>
      </div>`,
      'matchOver',
    );
  }

  /** Shows the pause panel, remembering what it covers (coming back from the Powers page keeps that memory). */
  paused(): void {
    if (this.kind !== 'powers') this.beforePause = { kind: this.kind, html: this.root.innerHTML };
    this.show(
      `<div class="panel"><div class="banner-title" style="color:var(--text)">PAUSED</div><div class="hint">ESC TO RESUME</div></div>`,
      'paused',
    );
  }

  /** Brings back a banner the pause panel covered; transient countdown numbers are dropped. */
  resume(): void {
    const saved = this.beforePause;
    this.beforePause = null;
    if (saved && (saved.kind === 'banner' || saved.kind === 'matchOver')) this.show(saved.html, saved.kind);
    else this.clear();
  }

  private show(html: string, kind: ScreenKind): number {
    this.token++;
    this.kind = kind;
    this.root.innerHTML = html;
    return this.token;
  }

  private clearLater(token: number, ms: number): void {
    setTimeout(() => {
      if (token === this.token) this.clear();
    }, ms);
  }
}
