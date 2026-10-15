import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveBlock,
  deriveSession,
  missedCount,
  pct,
  scanScore,
  speedScore,
  weightedIndex,
} from '../src/metrics.js';

const near = (actual, expected, digits = 3) => {
  assert.ok(
    Math.abs(actual - expected) < 10 ** -digits,
    `expected ${actual} to be within 1e-${digits} of ${expected}`,
  );
};

const cueBlock = (over = {}) => ({
  drillId: 'peripheral-cue',
  name: '',
  durationMin: 10,
  opportunities: 20,
  correct: 15,
  responseS: 1.6,
  scans: 30,
  passesAttempted: null,
  passesCompleted: null,
  notes: '',
  ...over,
});

test('accuracy, missed cues and scans per minute', () => {
  const m = deriveBlock(cueBlock());
  assert.equal(m.accuracyPct, 75);
  assert.equal(m.missed, 5);
  assert.equal(m.scansPerMin, 3);
});

test('drill index is the documented weighted mean', () => {
  const m = deriveBlock(cueBlock());
  // accuracy 75 (.5) + speed 50 (.3) + scanning 50 (.2)
  near(m.components.speed, 50);
  near(m.components.scanning, 50);
  near(m.index, 62.5);
});

test('weights re-normalise when a measure was not recorded', () => {
  const noTime = deriveBlock(cueBlock({ responseS: null }));
  near(noTime.index, (75 * 0.5 + 50 * 0.2) / 0.7);
  const noScans = deriveBlock(cueBlock({ scans: null }));
  near(noScans.index, (75 * 0.5 + 50 * 0.3) / 0.8);
  const accuracyOnly = deriveBlock(cueBlock({ scans: null, responseS: null }));
  near(accuracyOnly.index, 75);
});

test('a better session never scores lower than a worse one', () => {
  const base = deriveBlock(cueBlock());
  assert.ok(deriveBlock(cueBlock({ correct: 18 })).index > base.index, 'more correct answers must raise the index');
  assert.ok(deriveBlock(cueBlock({ responseS: 1.2 })).index > base.index, 'a faster response must raise the index');
  assert.ok(deriveBlock(cueBlock({ scans: 60 })).index > base.index, 'more scanning must raise the index');
  assert.ok(deriveBlock(cueBlock({ correct: 5 })).index < base.index);
});

test('index stays inside 0–100 at both extremes', () => {
  const worst = deriveBlock(cueBlock({ correct: 0, responseS: 20, scans: 0 }));
  const best = deriveBlock(cueBlock({ correct: 20, responseS: 0.4, scans: 300 }));
  assert.ok(worst.index >= 0 && worst.index <= 100, `worst index was ${worst.index}`);
  assert.ok(best.index >= 0 && best.index <= 100, `best index was ${best.index}`);
  near(best.index, 100);
  near(best.components.speed, 100, 6);
  near(best.components.scanning, 100, 6);
});

test('speed component is par ÷ actual, capped at 100', () => {
  near(speedScore(0.8, 0.8), 100);
  near(speedScore(1.6, 0.8), 50);
  near(speedScore(0.1, 0.8), 100);
  assert.equal(speedScore(null, 0.8), null);
  assert.equal(speedScore(1.2, 0), null);
  assert.equal(speedScore(-1, 0.8), null);
});

test('scan component reaches full marks at the target rate', () => {
  assert.equal(scanScore(6, 6), 100);
  assert.equal(scanScore(12, 6), 100);
  assert.equal(scanScore(3, 6), 50);
  assert.equal(scanScore(null, 6), null);
  assert.equal(scanScore(4, 0), null);
});

test('a drill with no components at all yields a null index', () => {
  assert.equal(weightedIndex({ accuracy: null, speed: null, scanning: null }), null);
});

test('guards: zero chances, missing numbers, impossible counts', () => {
  assert.equal(pct(3, 0), null);
  assert.equal(pct(null, 3), null);
  assert.equal(missedCount(null, 3), null);
  assert.equal(missedCount(20, 25), 0, 'a negative miss count is clamped to zero');
  const m = deriveBlock(cueBlock({ scans: null }));
  assert.equal(m.scansPerMin, null);
  assert.equal(deriveBlock({ drillId: 'nonsense' }).index, null);
});

test('the passing drill blends decision accuracy with pass completion', () => {
  const m = deriveBlock({
    drillId: 'decision-receive',
    durationMin: 10,
    opportunities: 10,
    correct: 8,
    responseS: 0.6,
    scans: 20,
    passesAttempted: 10,
    passesCompleted: 5,
    name: '',
    notes: '',
  });
  near(m.accuracyPct, 80);
  near(m.passPct, 50);
  near(m.components.accuracy, 65, 6); // (80 + 50) / 2
  near(m.components.speed, 100, 6);
  near(m.components.scanning, 20, 6); // 2 scans/min against a target of 10
  near(m.index, 66.5);
});

test('a session rolls up totals and an opportunity-weighted index', () => {
  const session = {
    id: 's1',
    date: '2026-10-15',
    createdAt: '2026-10-15T09:00:00.000Z',
    blocks: [
      cueBlock(), // index 62.5 over 20 chances
      cueBlock({ opportunities: 30, correct: 30, responseS: 0.8, scans: 90 }), // index 100 over 30 chances
    ],
  };
  const d = deriveSession(session);
  assert.equal(d.blockCount, 2);
  assert.equal(d.drillCount, 1);
  assert.equal(d.opportunities, 50);
  assert.equal(d.correct, 45);
  assert.equal(d.missed, 5);
  assert.equal(d.accuracyPct, 90);
  assert.equal(d.scans, 120);
  assert.equal(d.durationMin, 20);
  assert.equal(d.scansPerMin, 6);
  near(d.index, (62.5 * 20 + 100 * 30) / 50);
});

test('a session with no blocks derives cleanly instead of throwing', () => {
  const d = deriveSession({ blocks: [] });
  assert.equal(d.blockCount, 0);
  assert.equal(d.index, null);
  assert.equal(d.accuracyPct, null);
  assert.equal(deriveSession({}).opportunities, null);
});
