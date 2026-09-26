import GUI from 'lil-gui';
import { DEFAULT_CONFIG, type Config } from '../sim';
import { applyOverrides, describeOverrides, diffConfig, hasOverrides, overridesAsConfigLines, type Overrides } from '../sim/configSchema';
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
      <div class="export">
        <div class="row">
          <span class="dim">FOR A PULL REQUEST · THE PANEL'S RULES AS <code>DEFAULT_CONFIG</code> LINES (src/sim/config.ts)</span>
          <button class="copy-lines" type="button">COPY LINES</button>
          <button class="copy-json" type="button">COPY JSON</button>
        </div>
        <textarea class="snippet" readonly rows="8" spellcheck="false"></textarea>
      </div>
      <div class="panel-host"></div>
    </div>`;
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const tokenInput = q<HTMLInputElement>('.token');
  const status = q<HTMLElement>('.status');
  const list = q<HTMLElement>('.list');
  const host = q<HTMLElement>('.panel-host');
  const snippet = q<HTMLTextAreaElement>('.snippet');

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
    const overrides = diffConfig(serverCfg);
    const pending = describeOverrides(overrides);
    say(pending.length ? `PANEL DIFFERS FROM THE DEFAULTS IN ${pending.length} ${pending.length === 1 ? 'PLACE' : 'PLACES'}: ${pending.join(' · ')}` : 'PANEL IS AT THE DEFAULTS', '');
    const lines = overridesAsConfigLines(overrides);
    snippet.value = lines ? `// House rules from snakeboom.com/admin, ${new Date().toISOString().slice(0, 10)}: replace these lines in DEFAULT_CONFIG.\n${lines}` : '// The panel is at the defaults: nothing to change in DEFAULT_CONFIG.';
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      say(`COPIED ${what}`, 'ok');
    } catch {
      snippet.focus();
      snippet.select();
      say('CLIPBOARD BLOCKED: THE TEXT IS SELECTED BELOW, PRESS COPY', 'bad');
    }
  };
  q<HTMLButtonElement>('.copy-lines').addEventListener('click', () => void copy(snippet.value, 'THE CONFIG LINES'));
  q<HTMLButtonElement>('.copy-json').addEventListener('click', () => void copy(JSON.stringify({ overrides: diffConfig(serverCfg) }, null, 2), 'THE JSON'));
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
    showPending();
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
    showPending();
    say('CLEARED: ONLINE MATCHES ARE BACK ON THE DEFAULTS', 'ok');
  });
  q<HTMLButtonElement>('.reset').addEventListener('click', () => {
    resetInPlace(serverCfg, DEFAULT_CONFIG);
    refresh();
    showPending();
  });
  showPending();
}
