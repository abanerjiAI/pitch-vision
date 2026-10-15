import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveBlock } from '../src/metrics.js';
import {
  formatDate,
  formatDelta,
  groupByPlayer,
  playerKey,
  scalePoints,
  seriesFor,
  sessionsForPlayer,
  sparkPath,
  summariseSeries,
  valuesOf,
} from '../src/stats.js';

const session = (id, key, date, blocks) => ({ id, key, player: key, date, createdAt: `${date}T09:00:00.000Z`, blocks });

const cue = (opportunities, correct, responseS, scans, durationMin = 10) => ({
  drillId: 'peripheral-cue',
  durationMin,
  opportunities,
  correct,
  responseS,
  scans,
  notes: '',
  name: '',
});

const SESSIONS = [
  session('b', 'a-rivera', '2026-10-08', [cue(20, 10, 2.0, 20)]),
  session('a', 'a-rivera', '2026-10-01', [cue(20, 15, 1.6, 30)]),
  session('c', 'a-rivera', '2026-10-15', [cue(20, 18, 1.2, 40), { drillId: 'decision-receive', durationMin: 5, opportunities: 10, correct: 8, responseS: 1.0, scans: 10, notes: '', name: '' }]),
  session('d', 'j-perez', '2026-10-10', [cue(10, 5, 1.8, 10)]),
];

test('playerKey groups the same player written different ways', () => {
  assert.equal(playerKey('A. Rivera'), 'a-rivera');
  assert.equal(playerKey('  a   rivera '), 'a-rivera');
  assert.equal(playerKey('#14'), '14');
  assert.equal(playerKey('Juan Pérez'), 'juan-perez', 'accents must not split a player in two');
  assert.equal(playerKey('   '), '');
  assert.equal(playerKey(null), '');
});

test('sessions group per player, oldest first, players newest first', () => {
  const groups = groupByPlayer(SESSIONS);
  assert.deepEqual(groups.map((g) => g.key), ['a-rivera', 'j-perez']);
  assert.deepEqual(groups[0].sessions.map((s) => s.date), ['2026-10-01', '2026-10-08', '2026-10-15']);
  assert.equal(groups[0].first, '2026-10-01');
  assert.equal(groups[0].last, '2026-10-15');
  assert.equal(sessionsForPlayer(SESSIONS, 'j-perez').length, 1);
});

test('a series is one point per session, chronological, with gaps kept as null', () => {
  const points = seriesFor(SESSIONS, 'a-rivera', 'peripheral-cue', 'accuracyPct', deriveBlock);
  assert.equal(points.length, 3);
  assert.deepEqual(points.map((p) => p.date), ['2026-10-01', '2026-10-08', '2026-10-15']);
  assert.deepEqual(points.map((p) => p.value), [75, 50, 90]);

  const decision = seriesFor(SESSIONS, 'a-rivera', 'decision-receive', 'accuracyPct', deriveBlock);
  assert.deepEqual(decision.map((p) => p.value), [null, null, 80]);
  assert.deepEqual(valuesOf(decision), [null, null, 80]);
});

test('two blocks of the same drill in one session are averaged by chances presented', () => {
  const twoBlocks = [session('x', 'p-1', '2026-10-15', [cue(10, 10, 1.2, 10), cue(30, 15, 1.2, 30)])];
  const points = seriesFor(twoBlocks, 'p-1', 'peripheral-cue', 'accuracyPct', deriveBlock);
  // 100% over 10 chances and 50% over 30 chances → (100*10 + 50*30) / 40
  assert.equal(points[0].value, 62.5);
  assert.equal(points[0].blocks, 2);
});

test('raw measures come from the block, derived ones from the maths', () => {
  const points = seriesFor(SESSIONS, 'a-rivera', 'peripheral-cue', 'responseS', deriveBlock);
  assert.deepEqual(points.map((p) => p.value), [1.6, 2.0, 1.2]);
  const scans = seriesFor(SESSIONS, 'a-rivera', 'peripheral-cue', 'scansPerMin', deriveBlock);
  assert.deepEqual(scans.map((p) => p.value), [3, 2, 4]);
  const missed = seriesFor(SESSIONS, 'a-rivera', 'peripheral-cue', 'missed', deriveBlock);
  assert.deepEqual(missed.map((p) => p.value), [5, 10, 2]);
});

test('summary gives first, latest, best and both deltas', () => {
  const points = seriesFor(SESSIONS, 'a-rivera', 'peripheral-cue', 'accuracyPct', deriveBlock);
  const s = summariseSeries(points);
  assert.equal(s.sessions, 3);
  assert.equal(s.measured, 3);
  assert.equal(s.first, 75);
  assert.equal(s.last, 90);
  assert.equal(s.previous, 50);
  assert.equal(s.deltaPrev, 40);
  assert.equal(s.deltaFirst, 15);
  assert.equal(s.mean, (75 + 50 + 90) / 3);
  assert.equal(s.best, 90);
  assert.equal(s.worst, 50);
});

test('a one-session series reports no change rather than a fake delta', () => {
  const s = summariseSeries(seriesFor(SESSIONS, 'j-perez', 'peripheral-cue', 'accuracyPct', deriveBlock));
  assert.equal(s.measured, 1);
  assert.equal(s.deltaPrev, null);
  assert.equal(s.deltaFirst, null);
  assert.equal(summariseSeries([]).last, null);
});

test('chart geometry stays inside its box', () => {
  const pts = scalePoints([75, 50, 90], { width: 300, height: 100 });
  assert.equal(pts.length, 3);
  assert.deepEqual(pts.map((p) => p.x), [0, 150, 300], 'points are evenly spaced on the x axis');
  assert.equal(pts[2].y, 0, 'the highest value sits on the top edge');
  assert.equal(pts[1].y, 100, 'the lowest value sits on the bottom edge');
  assert.ok(pts.every((p) => p.y >= 0 && p.y <= 100));
});

test('a flat series and a single value sit on the middle line, nulls keep their slot', () => {
  const flat = scalePoints([5, 5, 5], { width: 300, height: 100 });
  assert.deepEqual(flat.map((p) => p.y), [50, 50, 50]);
  const one = scalePoints([7], { width: 300, height: 100 });
  assert.deepEqual(one, [{ x: 150, y: 50, value: 7, index: 0 }]);
  const gapped = scalePoints([1, null, 3], { width: 200, height: 100 });
  assert.equal(gapped[1], null);
  assert.deepEqual(gapped.map((p) => (p ? p.x : null)), [0, null, 200], 'a missing value still consumes its slot');
  assert.equal(scalePoints([null, null], { width: 10, height: 10 })[0], null);
});

test('the line path breaks at a gap instead of bridging it', () => {
  const pts = scalePoints([1, 2, 3], { width: 100, height: 100 });
  assert.equal(sparkPath(pts), 'M0,100 L50,50 L100,0');
  assert.equal(sparkPath(scalePoints([4], { width: 100, height: 100 })), 'M50,50');
  const gapped = scalePoints([1, null, 3], { width: 100, height: 100 });
  assert.equal(sparkPath(gapped), 'M0,100 M100,0', 'two separate strokes, not one line across the gap');
});

test('dates and deltas read the way a coach expects', () => {
  assert.equal(formatDate('2026-10-15'), '15 Oct 2026');
  assert.equal(formatDate(''), '');
  assert.deepEqual(formatDelta(5, 1, true), { text: '+5', dir: 1 });
  assert.deepEqual(formatDelta(-3, 1, true), { text: '−3', dir: -1 });
  assert.deepEqual(formatDelta(-3, 1, false), { text: '−3', dir: 1 }, 'fewer missed cues is an improvement');
  assert.deepEqual(formatDelta(0, 1, true), { text: 'no change', dir: 0 });
  assert.equal(formatDelta(null, 1, true).text, 'no change');
});
