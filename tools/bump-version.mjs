#!/usr/bin/env node
/**
 * Cache-busting for the deployed demo.
 *
 * The edge and the browser cache static assets for 30 days under their own URL
 * (the origin sends `Cache-Control: immutable, max-age=2592000`), while the HTML
 * is never cached. So every asset URL carries `?v=<n>`, and the version has to
 * be bumped in one place whenever the code changes.
 *
 *   node tools/bump-version.mjs          # bump by one
 *   node tools/bump-version.mjs --set 3  # pin an explicit version
 *   node tools/bump-version.mjs --check  # verify consistency, change nothing
 *
 * It rewrites: the <link>/<script> references in index.html, and every
 * relative import specifier in src/*.js. All of them must carry the SAME
 * version — a module imported under two different query strings is instantiated
 * twice, which would silently give the app two copies of its state.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

const refInHtml = /(href|src)="(src\/[\w.-]+\.(?:js|css))(\?v=(\d+))?"/g;
const importInJs = /(from\s+'(?:\.\/)([\w.-]+\.js))(\?v=(\d+))?'/g;

const args = process.argv.slice(2);
const mode = args.includes('--check') ? 'check' : args.includes('--set') ? 'set' : 'bump';
const explicit = args.includes('--set') ? Number(args[args.indexOf('--set') + 1]) : null;

async function files() {
  const names = await readdir(SRC);
  return [
    { path: join(ROOT, 'index.html'), read: true },
    ...names.filter((n) => n.endsWith('.js')).map((n) => ({ path: join(SRC, n), read: true })),
  ];
}

const list = await files();
const contents = new Map();
const versions = new Set();

for (const file of list) {
  const text = await readFile(file.path, 'utf8');
  contents.set(file.path, text);
  for (const m of text.matchAll(refInHtml)) if (m[4]) versions.add(Number(m[4]));
  for (const m of text.matchAll(importInJs)) if (m[4]) versions.add(Number(m[4]));
}

const found = [...versions].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
const inconsistent = found.length > 1;

if (mode === 'check') {
  if (inconsistent) {
    console.error(`FAIL: mixed asset versions in the source: ${found.join(', ')}`);
    process.exit(1);
  }
  console.log(`asset version: ${found[0] ?? '(none)'} — consistent across ${list.length} files`);
  process.exit(0);
}

const current = found[found.length - 1] ?? 0;
const next = mode === 'set' && Number.isFinite(explicit) ? explicit : current + 1;
if (!Number.isInteger(next) || next < 1) {
  console.error('--set needs a positive integer');
  process.exit(2);
}

let changed = 0;
for (const file of list) {
  const before = contents.get(file.path);
  const query = `?v=${next}`;
  const after = before
    .replace(refInHtml, (full, attr, path) => `${attr}="${path}${query}"`)
    .replace(importInJs, (full, head, path) => `${head}${query}'`);
  if (after !== before) {
    await writeFile(file.path, after, 'utf8');
    changed += 1;
    console.log(`  updated ${file.path.replace(ROOT, '').replace(/\\/g, '/')}`);
  }
}
console.log(`asset version ${current} → ${next} in ${changed} file(s)`);
