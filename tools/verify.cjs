'use strict';
/*
 * Behavioural verification for the CN fork of Overleaf Workshop.
 *
 * Runs the extension's real compiled modules (out/*.js) against a stubbed
 * `vscode` module, so the checks exercise the patched code paths rather than a
 * re-implementation of them.
 *
 *   NODE_PATH=tools/vscode-stub node tools/verify.cjs <extension-root> [--network]
 *
 * --network adds a live check of the extension's own BaseAPI against the CN
 * instance (GET /login CSRF + cookie extraction).
 */

const path = require('path');
const Module = require('module');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'extension'));
const network = process.argv.includes('--network');

// The stub only resolves via NODE_PATH; make it deterministic regardless of shell.
const stubDir = path.join(__dirname, 'vscode-stub');
if (!(process.env.NODE_PATH || '').split(path.delimiter).includes(stubDir)) {
  process.env.NODE_PATH = [stubDir, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  Module._initPaths();
}

process.on('unhandledRejection', () => { });

const results = [];
function check(name, fn) {
  try {
    const value = fn();
    results.push({ name, ok: true, value });
    console.log(`PASS  ${name}${value === undefined ? '' : ' -> ' + JSON.stringify(value)}`);
  } catch (e) {
    results.push({ name, ok: false, error: e });
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function makeContext(seed = {}) {
  const store = { ...seed };
  return {
    store,
    globalState: {
      get: (key, def) => (key in store ? store[key] : def),
      update: (key, value) => { store[key] = value; return Promise.resolve(); },
      keys: () => Object.keys(store),
    },
    subscriptions: [],
    extensionPath: root,
    extensionUri: { fsPath: root, path: root },
    globalStorageUri: { fsPath: path.join(root, '..', '.storage') },
    secrets: { get: () => Promise.resolve(undefined), store: () => Promise.resolve(), delete: () => Promise.resolve() },
  };
}

const SERVERS_KEY = 'overleaf-servers';

const { GlobalStateManager } = require(path.join(root, 'out/utils/globalStateManager.js'));
const { ProjectManagerProvider } = require(path.join(root, 'out/core/projectManagerProvider.js'));

console.log(`\n=== extension root: ${root}\n`);

// ---------------------------------------------------------------- default server
check('fresh install seeds exactly one server', () => {
  const ctx = makeContext();
  const servers = GlobalStateManager.getServers(ctx);
  assert(servers.length === 1, `expected 1 server, got ${servers.length}`);
  return { name: servers[0].server.name, url: servers[0].server.url, apiUrl: servers[0].api.url };
});

check('default server host is cn.overleaf.com', () => {
  const ctx = makeContext();
  const [s] = GlobalStateManager.getServers(ctx);
  assert(s.server.name === 'cn.overleaf.com', `name=${s.server.name}`);
  assert(s.server.url === 'https://cn.overleaf.com/', `url=${s.server.url}`);
  assert(s.api.url === 'https://cn.overleaf.com/', `api.url=${s.api.url}`);
  return s.server.url;
});

check('persisted server keeps trailing slash required by BaseAPI', () => {
  const ctx = makeContext();
  const [s] = GlobalStateManager.getServers(ctx);
  assert(/\/$/.test(s.server.url), 'default url must end with "/" so getCsrfToken hits /login');
  assert(/\/$/.test(s.api.url), 'api url must end with "/"');
  return 'ok';
});

// ------------------------------------------------------------ legacy migration
check('legacy never-logged-in www entry is retargeted to cn', () => {
  const ctx = makeContext({ [SERVERS_KEY]: { 'www.overleaf.com': { name: 'www.overleaf.com', url: 'https://www.overleaf.com/' } } });
  const servers = GlobalStateManager.getServers(ctx);
  const names = servers.map(s => s.server.name);
  assert(servers.length === 1, `expected 1 server, got ${names.join(',')}`);
  assert(names[0] === 'cn.overleaf.com', `got ${names[0]}`);
  assert(servers[0].api.url === 'https://cn.overleaf.com/', servers[0].api.url);
  const persisted = Object.keys(ctx.store[SERVERS_KEY]);
  assert(persisted.length === 1 && persisted[0] === 'cn.overleaf.com', `persisted=${persisted}`);
  return persisted;
});

check('legacy www entry WITH login keeps its session and gains the CN default', () => {
  const seed = {
    [SERVERS_KEY]: {
      'www.overleaf.com': {
        name: 'www.overleaf.com',
        url: 'https://www.overleaf.com/',
        login: { userId: 'u1', username: 'u@example.com', identity: { cookies: 'overleaf_session2=x', csrfToken: 't' }, projects: [] },
      },
    },
  };
  const ctx = makeContext(seed);
  const servers = GlobalStateManager.getServers(ctx);
  const names = servers.map(s => s.server.name).sort();
  assert(names.join(',') === 'cn.overleaf.com,www.overleaf.com', names.join(','));
  assert(ctx.store[SERVERS_KEY]['www.overleaf.com'].login.userId === 'u1', 'login data lost');
  const cn = servers.find(s => s.server.name === 'cn.overleaf.com');
  assert(cn.api.url === 'https://cn.overleaf.com/', cn.api.url);
  return names;
});

check('multi-server setups keep their hosts and gain the CN default', () => {
  const ctx = makeContext({
    [SERVERS_KEY]: {
      'www.overleaf.com': { name: 'www.overleaf.com', url: 'https://www.overleaf.com/' },
      'overleaf.example.edu': { name: 'overleaf.example.edu', url: 'https://overleaf.example.edu/' },
    },
  });
  const names = GlobalStateManager.getServers(ctx).map(s => s.server.name).sort();
  assert(names.join(',') === 'cn.overleaf.com,overleaf.example.edu,www.overleaf.com', names.join(','));
  return names;
});

check('an explicitly removed default host is not re-seeded', () => {
  const ctx = makeContext();
  GlobalStateManager.getServers(ctx);                       // seed cn
  assert(GlobalStateManager.removeServer(ctx, 'cn.overleaf.com') === true, 'remove failed');
  const names = GlobalStateManager.getServers(ctx).map(s => s.server.name);
  assert(names.length === 0, `default resurrected: ${names.join(',')}`);
  return 'stays removed';
});

check('removing every server re-seeds the CN default', () => {
  const ctx = makeContext({ [SERVERS_KEY]: {} });
  const [s] = GlobalStateManager.getServers(ctx);
  assert(s.server.name === 'cn.overleaf.com', s.server.name);
  return s.server.name;
});

check('real persisted state: CN seeded, existing session untouched', () => {
  const os = require('os');
  const fs = require('fs');
  const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'state.vscdb');
  if (!fs.existsSync(dbPath)) return 'skipped (no VS Code state db)';
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return 'skipped (node:sqlite unavailable)'; }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('iamhyc.overleaf-workshop');
  db.close();
  if (!row) return 'skipped (extension has no saved state)';
  const persisted = JSON.parse(row.value)['overleaf-servers'];
  if (!persisted) return 'skipped (no saved servers)';

  const before = Object.keys(persisted);
  const loginBefore = Object.fromEntries(before.map(h => [h, persisted[h].login !== undefined]));
  const ctx = makeContext({ [SERVERS_KEY]: JSON.parse(JSON.stringify(persisted)) });
  const after = GlobalStateManager.getServers(ctx).map(s => s.server.name).sort();
  assert(after.includes('cn.overleaf.com'), `cn missing: ${after.join(',')}`);
  for (const host of before) {
    assert(after.includes(host), `existing host dropped: ${host}`);
    assert((ctx.store[SERVERS_KEY][host].login !== undefined) === loginBefore[host], `login state changed for ${host}`);
  }
  return { before, after };
});

// ------------------------------------------------------- login method offering
function offeredLoginMethods(serverName) {
  const ctx = makeContext();
  const provider = new ProjectManagerProvider(ctx);
  const vscode = require('vscode');
  const internals = vscode.__internals;
  internals.recorded.showQuickPick.length = 0;
  provider.loginServer({ api: { url: `https://${serverName}/` }, name: serverName });
  const record = internals.recorded.showQuickPick[0];
  assert(record !== undefined, 'showQuickPick was not called');
  return record.items;
}

check('cn.overleaf.com offers cookies login only (captcha-protected host)', () => {
  const items = offeredLoginMethods('cn.overleaf.com');
  assert(items.includes('Login with Cookies'), `items=${items}`);
  assert(!items.includes('Login with Password'), `password login must not be offered on cn: ${items}`);
  return items;
});

check('www.overleaf.com keeps its previous behaviour (cookies only)', () => {
  const items = offeredLoginMethods('www.overleaf.com');
  assert(items.includes('Login with Cookies'), `items=${items}`);
  assert(!items.includes('Login with Password'), `items=${items}`);
  return items;
});

check('self-hosted server still offers password login', () => {
  const items = offeredLoginMethods('overleaf.example.edu');
  assert(items.includes('Login with Cookies') && items.includes('Login with Password'), `items=${items}`);
  return items;
});

// ------------------------------------------------------------------ load check
check('server-address l10n key resolves to the CN example', () => {
  const fs = require('fs');
  const bundle = JSON.parse(fs.readFileSync(path.join(root, 'l10n/bundle.l10n.json'), 'utf8'));
  const expected = 'Overleaf server address, e.g. "https://cn.overleaf.com"';
  assert(expected in bundle, 'placeholder key is missing from l10n/bundle.l10n.json');
  assert(bundle[expected] === expected, 'English bundle value mismatch');
  const source = fs.readFileSync(path.join(root, 'out/core/projectManagerProvider.js'), 'utf8');
  assert(source.includes(`l10n.t('${expected}')`), 'call site does not use the same l10n key');
  const stale = Object.keys(bundle).filter(k => k.includes('www.overleaf.com'));
  assert(stale.length === 0, `stale l10n keys: ${stale.join(', ')}`);
  return 'ok';
});

check('every compiled module loads', () => {
  const fs = require('fs');
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  })(path.join(root, 'out'));
  const failed = [];
  for (const f of files) {
    try { require(f); } catch (e) { failed.push(`${path.relative(root, f)}: ${e.message}`); }
  }
  assert(failed.length === 0, `${failed.length} module(s) failed:\n  ${failed.join('\n  ')}`);
  return `${files.length} modules`;
});

// ------------------------------------------------------------- live CN instance
(async () => {
  if (network) {
    const { BaseAPI } = require(path.join(root, 'out/api/base.js'));
    const api = new BaseAPI('https://cn.overleaf.com/');
    try {
      const token = await api.getCsrfToken();
      const ok = typeof token.csrfToken === 'string' && token.csrfToken.length > 10;
      console.log(`${ok ? 'PASS' : 'FAIL'}  BaseAPI.getCsrfToken() against cn.overleaf.com -> csrf=${ok ? token.csrfToken.slice(0, 12) + '…' : token.csrfToken}, cookie=${token.cookies.split(';')[0].split('=')[0] || '(none)'}`);
      results.push({ name: 'BaseAPI.getCsrfToken against cn', ok });
    } catch (e) {
      console.log(`FAIL  BaseAPI.getCsrfToken() against cn.overleaf.com: ${e.message}`);
      results.push({ name: 'BaseAPI.getCsrfToken against cn', ok: false });
    }
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : failed.length + ' CHECK(S) FAILED'} (${results.length} checks)\n`);
  process.exit(failed.length === 0 ? 0 : 1);
})();
