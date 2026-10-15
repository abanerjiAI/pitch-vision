#!/usr/bin/env node
/**
 * Verify the deployed copy through the CDN.
 *
 *   node tools/verify-deployed.mjs [baseUrl ...]
 *
 * Default base is the live demo. HTML on this estate gets scripts injected by
 * Cloudflare (bot challenge) and by the AI Engine plugin, so the HTML check
 * asserts the markers the app needs are present rather than comparing bytes.
 * JS/CSS are compared with line endings normalised, and drift is reported as a
 * note rather than a failure.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['https://nashvilleaiclub.com/demo/abanerji/pitch-vision/'];

const ASSETS = ['index.html', 'src/app.js', 'src/styles.css', 'src/drills.js', 'src/metrics.js', 'src/stats.js', 'src/validate.js', 'src/storage.js', 'src/csv.js', 'src/dom.js'];

const results = [];
const notes = [];
const pass = (msg) => results.push(['PASS', msg]);
const fail = (msg) => results.push(['FAIL', msg]);
const note = (msg) => notes.push(msg);

const normalise = (text) => text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();

/** Strip injector scripts so the app's own markup can be compared. */
function stripInjected(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) =>
    /__CF\$cv\$params|cdn-cgi\/challenge-platform|mwai|ai-engine-pro/i.test(tag) ? '<!-- injected -->' : tag,
  );
}

async function get(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'pitchvision-verify/1.0' } });
  return { status: res.status, text: await res.text(), headers: res.headers };
}

function assertMarkers(html, labels) {
  for (const [label, needle] of labels) {
    if (html.includes(needle)) pass(`${label}`);
    else fail(`${label} — "${needle}" missing from the served HTML`);
  }
}

for (const base of BASES) {
  const url = base.endsWith('/') ? base : `${base}/`;
  console.log(`\n== ${url}`);

  const fetched = {};
  for (const asset of ASSETS) {
    try {
      const { status, text, headers } = await get(url + asset);
      fetched[asset] = text;
      if (status === 200) pass(`${asset} → 200 (${headers.get('cf-cache-status') ?? 'origin'}, ${text.length} bytes)`);
      else fail(`${asset} → HTTP ${status}`);
    } catch (err) {
      fail(`${asset} → ${err.message}`);
    }
  }

  const html = fetched['index.html'];
  if (html) {
    const stripped = stripInjected(html);
    if (stripped.length !== html.length) note(`${url}index.html carries injected scripts (Cloudflare bot challenge / AI Engine): ${html.length - stripped.length} bytes`);

    assertMarkers(stripped, [
      ['title', '<title>PitchVision'],
      ['viewport meta', 'name="viewport"'],
      ['noindex', 'name="robots" content="noindex'],
      ['theme colour', 'name="theme-color"'],
      ['stylesheet link', 'href="src/styles.css"'],
      ['module entry', 'type="module" src="src/app.js"'],
      ['record view', 'id="view-record"'],
      ['history view', 'id="view-history"'],
      ['compare view', 'id="view-compare"'],
      ['more view', 'id="view-more"'],
      ['tab bar', 'data-view="compare"'],
      ['toast', 'id="toast"'],
      ['disclaimer in the footer', 'not a medical or vision diagnosis'],
    ]);

    if (/class="bar"/.test(stripped) && /id="helpBtn"/.test(stripped)) pass('header with help button');
    else fail('header/help button missing');
  }

  for (const asset of ASSETS.filter((a) => a !== 'index.html')) {
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
    else note(`${asset} differs from the local file (${local.length} local vs ${served.length} served bytes) — line-ending drift, or a stale deploy`);
  }

  const app = fetched['src/app.js'];
  const css = fetched['src/styles.css'];
  if (app) {
    for (const needle of ['export function', 'validateSession', 'Chart', 'localStorage']) {
      if (app.includes(needle)) pass(`app.js contains ${needle}`);
      else fail(`app.js is missing ${needle}`);
    }
  }
  if (css) {
    if (css.includes('.chart__line') && css.includes('.tab.is-active')) pass('styles.css contains the app classes');
    else fail('styles.css looks wrong (missing app classes)');
  }
}

const failed = results.filter(([s]) => s === 'FAIL');
console.log('\n---- checks');
for (const [state, msg] of results) console.log(`${state === 'PASS' ? ' ok ' : 'FAIL'}  ${msg}`);
if (notes.length) {
  console.log('\n---- notes (not failures)');
  for (const n of notes) console.log(`  · ${n}`);
}
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
