'use strict';
/*
 * Read-only inspection of the extension's persisted state inside VS Code's
 * globalStorage SQLite database. Prints host names and whether a login exists;
 * never prints cookies, identities or project contents.
 *
 *   node tools/inspect-global-state.cjs ["<path to state.vscdb>"]
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const dbPath = process.argv[2] || path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'state.vscdb');
if (!fs.existsSync(dbPath)) {
  console.log('state db not found:', dbPath);
  process.exit(0);
}

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare('SELECT key, value FROM ItemTable WHERE key LIKE ?').all('%overleaf%');
db.close();

console.log('database:', dbPath, `| ${rows.length} matching key(s)`);
for (const row of rows) {
  console.log(`\nkey: ${row.key}`);
  let value;
  try { value = JSON.parse(row.value); } catch { console.log(`  (unparsed, ${String(row.value).length} bytes)`); continue; }
  if (value === null || typeof value !== 'object') { console.log('  scalar:', String(value)); continue; }

  for (const key of Object.keys(value)) {
    const payload = value[key];
    if (key === 'overleaf-servers' && payload && typeof payload === 'object') {
      console.log('  overleaf-servers:');
      for (const [name, server] of Object.entries(payload)) {
        console.log(`    host=${name} url=${server.url} loggedIn=${server.login !== undefined}` +
          (server.login ? ` cachedProjects=${server.login.projects?.length ?? 0}` : ''));
      }
    } else {
      const size = typeof payload === 'string' ? payload.length : JSON.stringify(payload).length;
      console.log(`  ${key}: ${Array.isArray(payload) ? 'array' : typeof payload} (${size} bytes)`);
    }
  }
}
