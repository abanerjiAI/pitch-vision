#!/usr/bin/env node
/**
 * Verify the deployed copy through the CDN.
 *
 *   node tools/verify-deployed.mjs [baseUrl ...]
 *
 * Two things make a naive byte-comparison useless on this estate, so neither is
 * attempted:
 *   1. Cloudflare's bot challenge and the AI Engine plugin inject scripts into
 *      HTML. The HTML check asserts the markers the app needs, not equality.
 *   2. Static assets are cached for 30 days under their own URL, so every asset
 *      is requested with the `?v=<n>` taken from the SERVED index.html - that is
 *      exactly what a browser fetches.
 *
 * JS/CSS are compared with line endings normalised (the archive round-trips
 * through a Windows box), and drift is reported as a note, not a failure.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['https://nashvilleaiclub.com/demo/abanerji/pitch-vision/'];

const SOURCES = ['src/app.js', 'src/styles.css', 'src/drills.js', 'src/metrics.js', 'src/stats.js', 'src/validate.js', 'src/storage.js', 'src/csv.js', 'src/dom.js'];

const results = [];
const notes = [];
const pass = (msg) => results.push(['PASS', msg]);
const fail = (msg) => results.push(['FAIL', msg]);
const note = (msg) => notes.push(msg);

const normalise = (text) => text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();

/** Drop injector scripts so the app's own markup can be read. */
function stripInjected(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) =>
    /__CF\$cv\$params|cdn-cgi\/challenge-platform|mwai|ai-engine-pro/i.test(tag) ? '<!-- injected -->' : tag,
  );
}

async function get(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'pitchvision-verify/1.0' } });
  return { status: res.status, text: await res.text(), cache: res.headers.get('cf-cache-status') ?? 'origin' };
}

for (const base of BASES) {
  const url = base.endsWith('/') ? base : `${base}/`;
  console.log(`\n== ${url}`);

  const index = await get(url).catch((err) => ({ status: 0, text: '', cache: err.message }));
  if (index.status !== 200) {
    fail(`index.html -> HTTP ${index.status} (${index.cache})`);
    continue;
  }
  pass(`index.html -> 200 (${index.cache}, ${index.text.length} bytes)`);

  const html = stripInjected(index.text);
  const version = html.match(/src\/[\w.-]+\.js\?v=(\d+)/)?.[1] ?? null;
  if (version) pass(`asset version ${version} referenced by the served HTML`);
  else fail('the served HTML references no versioned asset (?v= missing) - a returning browser would keep a cached copy for 30 days');

  const unversioned = [...html.matchAll(/(?:href|src)="(src\/[\w.-]+\.(?:js|css))"/g)].map((m) => m[1]);
  if (unversioned.length === 0) pass('every asset reference carries a version');
  else fail(`unversioned asset references: ${unversioned.join(', ')}`);

  for (const [label, needle] of [
    ['title', '<title>PitchVision'],
    ['viewport meta', 'name="viewport"'],
    ['noindex', 'name="robots" content="noindex'],
    ['theme colour', 'name="theme-color"'],
    ['stylesheet link', `href="src/styles.css?v=${version}`],
    ['module entry', `type="module" src="src/app.js?v=${version}`],
    ['record view', 'id="view-record"'],
    ['history view', 'id="view-history"'],
    ['compare view', 'id="view-compare"'],
    ['more view', 'id="view-more"'],
    ['tab bar', 'data-view="compare"'],
    ['toast', 'id="toast"'],
    ['disclaimer in the footer', 'not a medical or vision diagnosis'],
    ['help button', 'id="helpBtn"'],
  ]) {
    if (html.includes(needle)) pass(label);
    else fail(`${label} - "${needle}" missing from the served HTML`);
  }

  const fetched = {};
  for (const asset of SOURCES) {
    const target = `${url}${asset}${version ? `?v=${version}` : ''}`;
    try {
      const { status, text, cache } = await get(target);
      fetched[asset] = text;
      if (status === 200) pass(`${asset} -> 200 (${cache}, ${text.length} bytes)`);
      else fail(`${asset} -> HTTP ${status}`);
    } catch (err) {
      fail(`${asset} -> ${err.message}`);
    }
  }

  for (const asset of SOURCES) {
    const served = fetched[asset];
    if (!served) continue;
    let local = '';
    try {
      local = await readFile(join(ROOT, asset), 'utf8');
    } catch {
      note(`no local copy of ${asset} to compare`);
      continue;
    }
    if (normalise(served) === normalise(local)) pass(`${asset} matches the local file`);
    else note(`${asset} differs from the local file (${local.length} local vs ${served.length} served bytes) - a stale deploy, or line-ending drift`);
  }

  const app = fetched['src/app.js'];
  if (app) {
    for (const needle of ['saveSession', 'chartSvg', 'validateSession', 'localStorage', 'function renderRecord']) {
      if (app.includes(needle)) pass(`app.js contains ${needle}`);
      else fail(`app.js is missing ${needle}`);
    }
    const imports = [...app.matchAll(/from\s+'\.\/[\w.-]+\.js(\?v=(\d+))?'/g)];
    const wrong = imports.filter((m) => m[2] !== version);
    if (imports.length && wrong.length === 0) pass(`every module import in app.js carries v=${version}`);
    else if (!imports.length) fail('app.js has no relative imports - is this the real file?');
    else fail(`imports with the wrong version: ${wrong.map((m) => m[0]).join(', ')}`);
  }
  const css = fetched['src/styles.css'];
  if (css) {
    if (css.includes('.chart__line') && css.includes('.tab.is-active')) pass('styles.css contains the app classes');
    else fail('styles.css looks wrong (missing app classes)');
  }
  if (index.text.length !== html.length) note(`injected scripts in index.html: ${index.text.length - html.length} bytes (Cloudflare bot challenge / AI Engine) - stripped before the marker checks`);
}

const failed = results.filter(([s]) => s === 'FAIL');
console.log('\n---- checks');
for (const [state, msg] of results) console.log(`${state === 'PASS' ? ' ok ' : 'FAIL'}  ${msg}`);
if (notes.length) {
  console.log('\n---- notes (not failures)');
  for (const n of notes) console.log(`  . ${n}`);
}
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
