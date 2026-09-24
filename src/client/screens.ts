import { PLAYER_CSS } from './colors';
import type { MenuRow } from './menu';
import type { OpponentMode } from './settings';
import { describeOpponent, PLAYER_NAMES } from './text';

type ScreenKind = 'none' | 'title' | 'countdown' | 'banner' | 'matchOver' | 'paused' | 'lobby' | 'form' | 'notice';

export interface TitleOptions {
  row: MenuRow;
  winsToWin: number;
  hearts: number;
  opponent: OpponentMode;
}

export interface LobbyOptions {
  code: string;
  link: string;
  players: ({ name: string; ready: boolean; connected: boolean } | null)[];
  winsToWin: number;
  pingMs: number | null;
  /** Which seat is ours. */
  me: number;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Centered overlay messages. Player names are the only user text, and they are escaped. */
export class Screens {
  private token = 0;
  private kind: ScreenKind = 'none';
  private covered: { kind: ScreenKind; html: string } | null = null;

  constructor(private readonly root: HTMLElement) {}

  clear(): void {
    this.covered = null;
    this.show('', 'none');
  }

  title(opts: TitleOptions): void {
    const row = (id: MenuRow, html: string) =>
      `<div class="row${opts.row === id ? ' active' : ''}" data-row="${id}">${html}</div>`;
    const pink =
      opts.opponent === 'human'
        ? `<p><kbd>←</kbd> <kbd>→</kbd> steer</p><p><kbd>↑</kbd> boost</p><p><kbd>↓</kbd> use item</p>`
        : `<p>${describeOpponent(opts.opponent)}</p><p class="dim">plays this seat</p>`;
    this.show(
      `
      <div class="panel">
        <div class="logo">SNAKEBOOM</div>
        <div class="controls">
          <div class="p1"><h3>${PLAYER_NAMES[0]}</h3>
            <p><kbd>A</kbd> <kbd>D</kbd> steer</p><p><kbd>W</kbd> boost</p><p><kbd>S</kbd> use item</p></div>
          <div class="p2"><h3>${PLAYER_NAMES[1]}</h3>${pink}</div>
        </div>
        <div class="menu">
          ${row('local', `LOCAL · <kbd>◀</kbd> <span class="mode">${describeOpponent(opts.opponent)}</span> <kbd>▶</kbd>`)}
          ${row('wins', `FIRST TO <kbd>◀</kbd> <span class="wins">${opts.winsToWin}</span> <kbd>▶</kbd>`)}
          ${row('create', 'CREATE LINK')}
          ${row('quick', 'QUICK MATCH')}
        </div>
        <div class="hint">SPACE TO GO</div>
        <div class="small"><kbd>▲</kbd> <kbd>▼</kbd> CHOOSE · <kbd>◀</kbd> <kbd>▶</kbd> ADJUST · ${opts.hearts} ${opts.hearts === 1 ? 'HEART' : 'HEARTS'} PER ROUND</div>
        <div class="small"><kbd>ESC</kbd> PAUSE · <kbd>M</kbd> MUTE · <kbd>\`</kbd> TUNING</div>
      </div>`,
      'title',
    );
  }

  /** Asks for a display name. Enter submits (possibly empty), Escape cancels with null. */
  nameBox(current: string, onSubmit: (name: string | null) => void): void {
    this.show(
      `
      <div class="panel form">
        <div class="banner-detail">YOUR NAME</div>
        <input class="name-input" maxlength="12" autocomplete="off" spellcheck="false" value="${escapeHtml(current)}" />
        <div class="small">LETTERS, DIGITS AND SPACES · LEAVE IT EMPTY TO PLAY AS CYAN OR PINK</div>
        <div class="hint">ENTER TO CONTINUE · ESC TO CANCEL</div>
      </div>`,
      'form',
    );
    const input = this.root.querySelector<HTMLInputElement>('.name-input');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onSubmit(input.value);
      else if (e.key === 'Escape') onSubmit(null);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    input.focus();
    input.select();
  }

  lobby(opts: LobbyOptions): void {
    const seat = (i: number) => {
      const p = opts.players[i];
      const you = i === opts.me ? ' <span class="dim">(YOU)</span>' : '';
      if (!p) return `<div class="seat p${i + 1} empty">waiting for a player…</div>`;
      const state = !p.connected ? 'AWAY' : p.ready ? 'READY' : 'NOT READY';
      return `<div class="seat p${i + 1}${p.ready ? ' ready' : ''}">${escapeHtml(p.name) || PLAYER_NAMES[i]}${you}<span class="state">${state}</span></div>`;
    };
    const ping = opts.pingMs === null ? '' : ` · PING ${opts.pingMs} ms`;
    this.show(
      `
      <div class="panel lobby">
        <div class="banner-detail">ROOM <span class="code">${opts.code}</span></div>
        <div class="link"><span class="url">${escapeHtml(opts.link)}</span><button class="copy" type="button">COPY</button></div>
        <div class="seats">${seat(0)}${seat(1)}</div>
        <div class="small">FIRST TO ${opts.winsToWin}${ping}</div>
        <div class="hint">SPACE READY · ESC LEAVE</div>
      </div>`,
      'lobby',
    );
    const button = this.root.querySelector<HTMLButtonElement>('.copy');
    button?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(opts.link).then(
        () => (button.textContent = 'COPIED'),
        () => (button.textContent = 'COPY FAILED'),
      );
    });
  }

  /** A short status line in the middle of the screen (Connecting…, Waiting for PINK…). */
  caption(text: string): void {
    this.show(`<div class="caption">${text}</div>`, 'notice');
  }

  /** A titled message with a hint, for online outcomes and errors. */
  notice(title: string, detail: string, hint: string, colorCss = 'var(--text)'): void {
    this.show(
      `
      <div class="panel">
        <div class="banner-title" style="color:${colorCss}">${title}</div>
        <div class="banner-detail">${detail}</div>
        <div class="hint">${hint}</div>
      </div>`,
      'matchOver',
    );
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
      `<div><div class="banner-title" style="color:${color}">${escapeHtml(title)}</div><div class="banner-detail">${escapeHtml(detail)}</div></div>`,
      'banner',
    );
  }

  matchOver(winner: number, scores: readonly number[], names: readonly string[] = PLAYER_NAMES, hint = 'SPACE REMATCH · ESC MENU'): void {
    this.show(
      `
      <div class="panel">
        <div class="banner-title" style="color:${PLAYER_CSS[winner]}">${escapeHtml(names[winner])} WINS</div>
        <div class="banner-detail">${scores.join(' – ')}</div>
        <div class="hint">${hint}</div>
      </div>`,
      'matchOver',
    );
  }

  /** Shows the pause panel, remembering what it covers. */
  paused(): void {
    this.cover(`<div class="panel"><div class="banner-title" style="color:var(--text)">PAUSED</div><div class="hint">ESC TO RESUME</div></div>`);
  }

  /** Brings back a banner the pause panel covered; transient countdown numbers are dropped. */
  resume(): void {
    this.uncover();
  }

  /** Lays `html` over the current screen, remembering it for uncover(). A second cover replaces the first. */
  cover(html: string): void {
    if (!this.covered) this.covered = { kind: this.kind, html: this.root.innerHTML };
    this.show(html, 'paused');
  }

  /** Removes a cover. Banners and results come back; transient countdown numbers are dropped. */
  uncover(): void {
    const saved = this.covered;
    if (!saved) return;
    this.covered = null;
    if (saved.kind === 'banner' || saved.kind === 'matchOver' || saved.kind === 'lobby') this.show(saved.html, saved.kind);
    else this.clear();
  }

  get isCovered(): boolean {
    return this.covered !== null;
  }

  reconnecting(name: string, seconds: number): void {
    this.cover(
      `<div class="panel"><div class="banner-title" style="color:var(--text)">${escapeHtml(name)} RECONNECTING…</div><div class="banner-detail">${seconds}</div></div>`,
    );
  }

  waiting(name: string): void {
    this.cover(`<div class="caption">WAITING FOR ${escapeHtml(name)}…</div>`);
  }

  leavePrompt(): void {
    this.cover(
      `<div class="panel"><div class="banner-title" style="color:var(--text)">LEAVE THE MATCH?</div><div class="hint">ESC AGAIN TO LEAVE · SPACE TO STAY</div></div>`,
    );
  }

  private show(html: string, kind: ScreenKind): number {
    this.token++;
    if (kind !== 'paused') this.covered = null;
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
