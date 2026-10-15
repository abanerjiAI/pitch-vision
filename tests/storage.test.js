import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_KEY,
  createRepo,
  isAvailable,
  memoryAdapter,
  parsePayload,
  parseState,
  serializeState,
} from '../src/storage.js';
import { validateSession } from '../src/validate.js';

let n = 0;
const idFactory = () => `s_fixed_${++n}`;

const makeSession = (over = {}) =>
  validateSession(
    {
      player: 'A. Rivera',
      date: '2026-10-15',
      conditions: { surface: 'Grass' },
      blocks: [{ drillId: 'peripheral-cue', durationMin: '10', opportunities: '20', correct: '15', responseS: '1.6', scans: '30' }],
      ...over,
    },
    { today: '2026-10-15', idFactory },
  ).value;

test('a session round-trips through the adapter', () => {
  const repo = createRepo(memoryAdapter());
  assert.equal(repo.available(), true);
  assert.deepEqual(repo.sessions(), []);
  const s = makeSession();
  assert.equal(repo.addSession(s), true);
  assert.equal(repo.sessions().length, 1);
  assert.equal(repo.status().count, 1);
  assert.equal(repo.sessions()[0].blocks[0].correct, 15);
});

test('a second repo over the same adapter sees the saved data', () => {
  const adapter = memoryAdapter();
  const first = createRepo(adapter);
  first.addSession(makeSession());
  const second = createRepo(adapter);
  assert.equal(second.sessions().length, 1);
});

test('deleting, clearing and missing ids', () => {
  const repo = createRepo(memoryAdapter());
  const s = makeSession();
  repo.addSession(s);
  repo.addSession(makeSession());
  assert.equal(repo.deleteSession('not-a-real-id'), false);
  assert.equal(repo.deleteSession(s.id), true);
  assert.equal(repo.sessions().length, 1);
  repo.clear();
  assert.deepEqual(repo.sessions(), []);
  const raw = repo.sessions();
  repo.addSession(s);
  assert.equal(repo.replaceSessions(raw), true);
  assert.deepEqual(repo.sessions(), []);
});

test('unreadable or newer stored data degrades safely', () => {
  assert.deepEqual(parseState(null).sessions, []);
  assert.equal(parseState('{not json').error, 'unreadable');
  assert.equal(parseState('{"version":99,"sessions":[]}').error, 'newer');
  const mixed = parseState(JSON.stringify({ version: 1, sessions: [makeSession(), { id: 5 }, null, 'nope'] }));
  assert.equal(mixed.sessions.length, 1, 'only records with an id, a date and blocks survive');
  assert.equal(mixed.error, null);
});

test('a back-up payload imports record by record, skipping bad ones', () => {
  const good = makeSession();
  const payload = JSON.stringify({ app: 'pitchvision', version: 1, sessions: [good, { player: '' }, { ...makeSession(), date: 'nonsense' }] });
  const parsed = parsePayload(payload);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.sessions.length, 1);
  assert.equal(parsed.skipped.length, 2);
  assert.equal(parsed.sessions[0].date, '2026-10-15');
});

test('imports refuse junk, unknown shapes and future versions', () => {
  assert.equal(parsePayload('not json at all').ok, false);
  assert.match(parsePayload('not json at all').error, /valid JSON/i);
  assert.match(parsePayload('{"hello":true}').error, /No sessions/i);
  assert.match(parsePayload('{"version":99,"sessions":[]}').error, /v99/);
  const bare = parsePayload(JSON.stringify([makeSession()]));
  assert.equal(bare.ok, true, 'a bare array of sessions is accepted');
});

test('importing merges and replaces by id', () => {
  const repo = createRepo(memoryAdapter());
  const s = makeSession();
  repo.addSession(s);
  const updated = { ...s, date: '2026-10-22' };
  const res = repo.importJson(JSON.stringify({ version: 1, sessions: [updated] }));
  assert.equal(res.ok, true);
  assert.equal(res.added, 0, 'the same id replaces rather than duplicates');
  assert.equal(repo.sessions().length, 1);
  assert.equal(repo.sessions()[0].date, '2026-10-22');

  const other = makeSession({ player: 'J. Perez' });
  const res2 = repo.importJson(JSON.stringify({ version: 1, sessions: [other] }));
  assert.equal(res2.added, 1);
  assert.equal(repo.sessions().length, 2);
  assert.deepEqual(repo.sessions().map((x) => x.date), ['2026-10-15', '2026-10-22'], 'merged records stay in date order');
});

test('the export is a valid back-up of everything stored', () => {
  const repo = createRepo(memoryAdapter());
  repo.addSession(makeSession());
  const text = repo.exportJson();
  const obj = JSON.parse(text);
  assert.equal(obj.app, 'pitchvision');
  assert.equal(obj.version, 1);
  assert.equal(obj.sessions.length, 1);
  assert.equal(JSON.parse(serializeState([])).sessions.length, 0);
  assert.equal(JSON.parse(repo.exportJson([])).sessions.length, 0);
});

test('a blocked or throwing adapter is detected, not fatal', () => {
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(isAvailable(throwing), false);
  const repo = createRepo(throwing);
  assert.equal(repo.sessions().length, 0);
  assert.equal(repo.addSession(makeSession()), false, 'a failed write is reported, not swallowed');
});

test('the storage key is versioned', () => {
  assert.equal(STORAGE_KEY, 'pitchvision.v1');
});
