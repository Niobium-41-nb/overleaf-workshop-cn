#!/usr/bin/env node
/*
 * Reproducible build step 1/2:
 *
 *   node tools/fetch-upstream.mjs            # download the official VSIX, verify it, apply the patch
 *   node tools/fetch-upstream.mjs --from x.vsix
 *
 * Produces (all git-ignored):
 *   upstream/iamhyc.overleaf-workshop-<version>.vsix   official package, pinned by SHA-256
 *   backup/iamhyc.overleaf-workshop-<version>/         pristine tree (reference for tools/build-patch.cjs)
 *   extension/                                         patched tree (input for tools/build-vsix.ps1)
 *
 * The upstream package is fetched from the public Marketplace endpoint and is
 * never committed: this repository only carries the patch and the tooling.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.15.10';
const PUBLISHER = 'iamhyc';
const EXTENSION = 'overleaf-workshop';
// SHA-256 of the official iamhyc.overleaf-workshop@0.15.10 vspackage (5,797,292 bytes).
const EXPECTED_SHA256 = '528152578141cd409cee8c4754d211ace6b302d2eeca8b51f61f44c2e3288585';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstreamDir = path.join(repo, 'upstream');
const vsixName = `${PUBLISHER}.${EXTENSION}-${VERSION}.vsix`;
const vsixPath = path.join(upstreamDir, vsixName);
const extractDir = path.join(upstreamDir, `extract-${VERSION}`);
const backupDir = path.join(repo, 'backup', `${PUBLISHER}.${EXTENSION}-${VERSION}`);
const extensionDir = path.join(repo, 'extension');
const patchPath = path.join(repo, 'patches', 'overleaf-workshop-cn-default-host.patch');

const fromIndex = process.argv.indexOf('--from');
const localSource = fromIndex >= 0 ? path.resolve(process.argv[fromIndex + 1]) : undefined;

main().catch((error) => {
  console.error(`\nERROR: ${error.message}`);
  process.exit(1);
});

async function main() {
  fs.mkdirSync(upstreamDir, { recursive: true });

  if (localSource) {
    console.log(`using local package: ${localSource}`);
    copyIfDifferent(localSource, vsixPath);
  } else if (!fs.existsSync(vsixPath) || sha256(vsixPath) !== EXPECTED_SHA256) {
    console.log(`downloading ${PUBLISHER}.${EXTENSION}@${VERSION} from the Visual Studio Marketplace ...`);
    await download(
      `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${PUBLISHER}` +
      `/vsextensions/${EXTENSION}/${VERSION}/vspackage`,
      vsixPath,
    );
  } else {
    console.log('using cached upstream package');
  }

  const digest = sha256(vsixPath);
  if (digest !== EXPECTED_SHA256) {
    throw new Error(
      `upstream package digest mismatch\n  expected ${EXPECTED_SHA256}\n  actual   ${digest}\n` +
      'Refusing to build from an unverified package.',
    );
  }
  console.log(`upstream sha256 ok: ${digest}`);

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  run('tar', ['-xf', vsixPath, '-C', extractDir], repo);

  const extractedTree = path.join(extractDir, 'extension');
  if (!fs.existsSync(path.join(extractedTree, 'package.json'))) {
    throw new Error(`unexpected VSIX layout: ${extractedTree}/package.json is missing`);
  }

  for (const target of [backupDir, extensionDir]) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(extractedTree, target, { recursive: true });
  }
  console.log(`pristine tree: ${path.relative(repo, backupDir)}`);
  console.log(`patched tree:  ${path.relative(repo, extensionDir)}`);

  // Apply from the repository root with an explicit prefix: `git apply` resolves
  // paths against the enclosing work tree, so running it inside extension/ would
  // silently patch files at the repo root instead (and leave extension/ pristine).
  const applyArgs = ['-c', 'core.autocrlf=false', 'apply', '--directory=extension'];
  run('git', [...applyArgs, '--check', patchPath], repo);
  run('git', [...applyArgs, patchPath], repo);
  console.log('patch applied: patches/overleaf-workshop-cn-default-host.patch');

  assertPatched();

  const pkg = JSON.parse(fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf8'));
  console.log(`\nready: ${pkg.publisher}.${pkg.name}@${pkg.version}`);
  console.log('next:  & .\\tools\\build-vsix.ps1    # -> overleaf-workshop-cn-<version>.vsix');
}

/**
 * Fail loudly if the patch did not land inside extension/. A no-op apply is the
 * dangerous failure mode: the build would happily package the upstream default.
 */
function assertPatched() {
  const read = (relative) => fs.readFileSync(path.join(extensionDir, relative), 'utf8');
  if (!read('out/utils/globalStateManager.js').includes("const DEFAULT_SERVER_ORIGIN = 'https://cn.overleaf.com';")) {
    throw new Error('patch verification failed: extension/out/utils/globalStateManager.js still has the upstream default host');
  }
  if (!read('l10n/bundle.l10n.json').includes('https://cn.overleaf.com')) {
    throw new Error('patch verification failed: l10n/bundle.l10n.json was not updated');
  }
  const upstreamVersion = JSON.parse(fs.readFileSync(path.join(backupDir, 'package.json'), 'utf8')).version;
  const patchedVersion = JSON.parse(read('package.json')).version;
  if (patchedVersion === upstreamVersion) {
    throw new Error(`patch verification failed: version was not bumped (still ${patchedVersion})`);
  }
  console.log(`patch verification ok: ${upstreamVersion} -> ${patchedVersion}`);
}

async function download(url, destination) {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await downloadOnce(url, destination);
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(`download attempt ${attempt}/${attempts} failed (${error.message}); retrying ...`);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
}

async function downloadOnce(url, destination) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.subarray(0, 2).toString('hex') !== '504b') {
    throw new Error('downloaded payload is not a ZIP/VSIX package');
  }
  const temp = `${destination}.download`;
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, destination);
  console.log(`downloaded ${(bytes.length / 1048576).toFixed(1)} MB`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyIfDifferent(source, destination) {
  if (fs.existsSync(destination) && sha256(destination) === sha256(source)) return;
  fs.copyFileSync(source, destination);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
}
