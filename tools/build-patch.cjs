'use strict';
/*
 * Regenerate patches/overleaf-workshop-cn-default-host.patch from the pristine
 * backup tree versus the patched extension tree.
 *
 *   node tools/build-patch.cjs
 *
 * The diff is rewritten so paths are relative to the extension root, which lets
 * it be applied inside any copy of iamhyc.overleaf-workshop@0.15.10:
 *
 *   git -c core.autocrlf=false apply patches/overleaf-workshop-cn-default-host.patch
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..');
// Git needs POSIX-style relative paths here; otherwise the a/ prefix is quoted
// and uses backslashes, which cannot be rewritten into an applicable patch.
const toGitPath = (p) => path.relative(repo, p).split(path.sep).join('/');
const before = toGitPath(path.join(repo, 'backup', 'iamhyc.overleaf-workshop-0.15.10'));
const after = toGitPath(path.join(repo, 'extension'));

const result = spawnSync('git', [
  '-c', 'core.autocrlf=false',
  '-c', 'core.safecrlf=false',
  'diff', '--no-index', '--no-color', '--', before, after,
], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });

// `git diff --no-index` exits 1 when the trees differ, which is the expected case.
if (result.status !== 0 && result.status !== 1) {
  process.exit(`git diff failed with status ${result.status}\n${result.stderr.toString('utf8')}`);
}

let patch = result.stdout.toString('utf8').replace(/\r\n/g, '\n');

// Rewrite the tree prefixes so the patch applies relative to an extension root.
patch = patch
  .replace(new RegExp('a/' + escapeRe(before) + '/', 'g'), 'a/')
  .replace(new RegExp('b/' + escapeRe(after) + '/', 'g'), 'b/');

if (!patch.trim()) {
  process.exit('no differences found between the backup tree and extension/');
}

const outPath = path.join(repo, 'patches', 'overleaf-workshop-cn-default-host.patch');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, patch, 'utf8');

const files = [...patch.matchAll(/^diff --git a\/(.+?) b\//gm)].map(m => m[1]);
console.log(`wrote ${path.relative(repo, outPath)} (${patch.length} bytes, ${files.length} file(s))`);
for (const f of files) console.log('  ' + f);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
