import GUI from 'lil-gui';
import { DEFAULT_CONFIG, type Config } from '../sim';
import { applyOverrides, describeOverrides, diffConfig, hasOverrides, type Overrides } from '../sim/configSchema';
import { resetInPlace } from './settings';
import { addConfigFolders } from './tuning';

export const ADMIN_TOKEN_KEY = 'snakeboom.adminToken';

interface ServerReply {
  overrides?: Overrides;
  problems?: string[];
  updatedAt?: string | null;
  error?: string;
}

/**
 * The /admin page: the tuning panel bound to the relay's house rules instead of this browser's
 * config. Load pulls what the server has, Publish sends this panel as a diff from the defaults,
 * Clear removes every rule. Every new online match starts with whatever is published.
 */
export function bootAdmin(root: HTMLElement, relayBase: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined): void {
  root.innerHTML = `
    <div class="admin">
      <h1>SNAKEBOOM ADMIN</h1>
      <p class="lead">HOUSE RULES: OVERRIDES EVERY NEW ONLINE MATCH STARTS WITH. LOCAL PLAY IS NOT AFFECTED.</p>
      <div class="row">
        <label>TOKEN <input class="token" type="password" autocomplete="off" spellcheck="false" placeholder="ADMIN_TOKEN from the box" /></label>
        <button class="load" type="button">LOAD FROM SERVER</button>
        <button class="publish" type="button">PUBLISH PANEL</button>
        <button class="clear" type="button">CLEAR SERVER RULES</button>
        <button class="reset" type="button">RESET PANEL TO DEFAULTS</button>
        <a class="back" href="/">BACK TO THE GAME</a>
      </div>
      <div class="status"></div>
      <div class="rules"><span class="dim">ON THE SERVER NOW:</span> <span class="list">not loaded</span></div>
      <div class="panel-host"></div>
    </div>`;
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const tokenInput = q<HTMLInputElement>('.token');
  const status = q<HTMLElement>('.status');
  const list = q<HTMLElement>('.list');
  const host = q<HTMLElement>('.panel-host');

  try {
    tokenInput.value = storage?.getItem(ADMIN_TOKEN_KEY) ?? '';
  } catch {
    // Storage blocked: the token is typed each visit.
  }
  tokenInput.addEventListener('change', () => {
    try {
      if (tokenInput.value) storage?.setItem(ADMIN_TOKEN_KEY, tokenInput.value);
      else storage?.removeItem(ADMIN_TOKEN_KEY);
    } catch {
      // Ignore.
    }
  });

  // The panel edits a full config; what gets published is its diff from the defaults.
  const serverCfg: Config = structuredClone(DEFAULT_CONFIG);
  const gui = new GUI({ title: 'House rules (the panel below is what gets published)', container: host, width: 420 });
  addConfigFolders(gui, serverCfg);
  const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());
  const showPending = () => {
    const pending = describeOverrides(diffConfig(serverCfg));
    say(pending.length ? `PANEL DIFFERS FROM THE DEFAULTS IN ${pending.length} ${pending.length === 1 ? 'PLACE' : 'PLACES'}: ${pending.join(' · ')}` : 'PANEL IS AT THE DEFAULTS', '');
  };
  gui.onChange(showPending);

  function say(text: string, cls: 'ok' | 'bad' | ''): void {
    status.textContent = text;
    status.className = `status ${cls}`.trim();
  }

  function showServer(overrides: Overrides, updatedAt: string | null | undefined): void {
    const lines = describeOverrides(overrides);
    list.textContent = hasOverrides(overrides) ? `${lines.join(' · ')}${updatedAt ? ` (since ${new Date(updatedAt).toLocaleString()})` : ''}` : 'none (the defaults)';
  }

  async function call(method: 'GET' | 'PUT' | 'DELETE', body?: unknown): Promise<ServerReply | null> {
    const token = tokenInput.value.trim();
    if (!token) {
      say('ENTER THE TOKEN FIRST', 'bad');
      return null;
    }
    say(`${method === 'GET' ? 'LOADING' : method === 'PUT' ? 'PUBLISHING' : 'CLEARING'}…`, '');
    try {
      const res = await fetch(`${relayBase.replace(/\/$/, '')}/admin/config`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const reply = (await res.json().catch(() => ({}))) as ServerReply;
      if (!res.ok) {
        say(`SERVER SAID ${res.status}: ${(reply.error ?? '').toUpperCase() || (res.status === 404 ? 'NO ADMIN TOKEN IS SET ON THE RELAY' : 'REFUSED')}`, 'bad');
        return null;
      }
      return reply;
    } catch (err) {
      say(`COULD NOT REACH THE RELAY (${err instanceof Error ? err.message : String(err)})`, 'bad');
      return null;
    }
  }

  q<HTMLButtonElement>('.load').addEventListener('click', async () => {
    const reply = await call('GET');
    if (!reply) return;
    const overrides = reply.overrides ?? {};
    resetInPlace(serverCfg, applyOverrides(DEFAULT_CONFIG, overrides));
    refresh();
    showServer(overrides, reply.updatedAt);
    say(hasOverrides(overrides) ? 'LOADED THE SERVER RULES INTO THE PANEL' : 'THE SERVER HAS NO RULES; THE PANEL IS AT THE DEFAULTS', 'ok');
  });
  q<HTMLButtonElement>('.publish').addEventListener('click', async () => {
    const overrides = diffConfig(serverCfg);
    const reply = await call('PUT', { overrides });
    if (!reply) return;
    showServer(reply.overrides ?? {}, reply.updatedAt);
    const problems = reply.problems ?? [];
    say(problems.length ? `PUBLISHED, BUT REJECTED: ${problems.join(' · ').toUpperCase()}` : `PUBLISHED ${Object.keys(reply.overrides ?? {}).length} RULE(S). THE NEXT MATCH USES THEM.`, problems.length ? 'bad' : 'ok');
  });
  q<HTMLButtonElement>('.clear').addEventListener('click', async () => {
    const reply = await call('DELETE');
    if (!reply) return;
    resetInPlace(serverCfg, DEFAULT_CONFIG);
    refresh();
    showServer({}, reply.updatedAt);
    say('CLEARED: ONLINE MATCHES ARE BACK ON THE DEFAULTS', 'ok');
  });
  q<HTMLButtonElement>('.reset').addEventListener('click', () => {
    resetInPlace(serverCfg, DEFAULT_CONFIG);
    refresh();
    showPending();
  });
  showPending();
}
