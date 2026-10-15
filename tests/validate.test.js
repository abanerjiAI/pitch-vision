import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countErrors,
  errorMessages,
  isRealDate,
  parseField,
  todayIso,
  validateBlock,
  validateSession,
} from '../src/validate.js';
import { getDrill } from '../src/drills.js';

const idFactory = () => 's_test_1';
const TODAY = '2026-10-15';

const draft = (over = {}) => ({
  player: 'A. Rivera',
  date: TODAY,
  conditions: { surface: 'Grass', light: 'Daylight', weather: 'Dry', ball: 'Size 5', notes: '' },
  blocks: [
    {
      drillId: 'peripheral-cue',
      durationMin: '10',
      opportunities: '20',
      correct: '15',
      responseS: '1.6',
      scans: '30',
      notes: 'left foot only',
    },
  ],
  ...over,
});

const run = (over = {}) => validateSession(draft(over), { today: TODAY, idFactory });

test('a good draft becomes a clean, typed session', () => {
  const res = run();
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.value.player, 'A. Rivera');
  assert.equal(res.value.key, 'a-rivera');
  assert.equal(res.value.id, 's_test_1');
  assert.equal(res.value.date, TODAY);
  assert.equal(res.value.blocks.length, 1);
  const block = res.value.blocks[0];
  assert.equal(block.durationMin, 10);
  assert.equal(block.opportunities, 20);
  assert.equal(block.correct, 15);
  assert.equal(block.responseS, 1.6);
  assert.equal(block.scans, 30);
  assert.equal(block.notes, 'left foot only');
  assert.equal(block.optimistic, undefined);
});

test('the player name or ID is required and sanity-checked', () => {
  assert.match(run({ player: '' }).errors.player, /enter the player name or id/i);
  assert.match(run({ player: '   ' }).errors.player, /enter the player name or id/i);
  assert.match(run({ player: '###' }).errors.player, /letter or number/i);
  assert.match(run({ player: 'x'.repeat(49) }).errors.player, /48/);
  assert.equal(run({ player: 'x'.repeat(48) }).ok, true);
});

test('the date must be real and cannot be in the future', () => {
  assert.match(run({ date: '' }).errors.date, /pick the drill date/i);
  assert.match(run({ date: '2026-02-30' }).errors.date, /real date/i);
  assert.match(run({ date: '15/10/2026' }).errors.date, /real date/i);
  assert.match(run({ date: '2026-10-16' }).errors.date, /future/i);
  assert.match(run({ date: '1999-12-31' }).errors.date, /before 2000/i);
  assert.equal(run({ date: TODAY }).ok, true);
  assert.equal(isRealDate('2024-02-29'), true);
  assert.equal(isRealDate('2026-02-29'), false);
});

test('imports skip the future-date rule', () => {
  const res = validateSession(draft({ date: '2030-01-01' }), { today: null, idFactory });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
});

test('numbers are parsed strictly — no units, letters or thousands commas', () => {
  const bad = (key, value, drillId = 'peripheral-cue') => validateBlock({ drillId, durationMin: '10', opportunities: '20', correct: '10', responseS: '1.2', scans: '10', [key]: value }, getDrill(drillId)).errors;
  assert.match(bad('opportunities', '1.5').opportunities, /whole number/i);
  assert.match(bad('opportunities', '20 cues').opportunities, /whole number/i);
  assert.match(bad('responseS', '1,4').responseS, /must be a number/i);
  assert.match(bad('responseS', 'fast').responseS, /must be a number/i);
  assert.match(bad('durationMin', '0.2').durationMin, /at least 0.5/i);
  assert.match(bad('responseS', '0.01').responseS, /at least 0.05/i);
  assert.match(bad('responseS', '25').responseS, /20 s or less/i);
  assert.match(bad('opportunities', '0').opportunities, /at least 1/i);
  assert.match(bad('opportunities', '501').opportunities, /500 or less/i);
});

test('required versus optional fields', () => {
  const missing = validateBlock({ drillId: 'peripheral-cue' }, getDrill('peripheral-cue'));
  assert.equal(missing.ok, false);
  assert.match(missing.errors.opportunities, /required/i);
  assert.match(missing.errors.responseS, /required/i);
  assert.equal(missing.errors.scans, undefined, 'scans are optional for the cue drill');

  const scanning = validateBlock(
    { drillId: 'scanning-possession', durationMin: '10', opportunities: '12', correct: '9', responseS: '', scans: '' },
    getDrill('scanning-possession'),
  );
  assert.equal(scanning.ok, false);
  assert.match(scanning.errors.scans, /required/i);
  assert.equal(scanning.errors.responseS, undefined, 'time to release is optional there');
});

test('cross-field rules', () => {
  const tooMany = validateBlock(
    { drillId: 'peripheral-cue', durationMin: '10', opportunities: '20', correct: '25', responseS: '1.2', scans: '10' },
    getDrill('peripheral-cue'),
  );
  assert.match(tooMany.errors.correct, /cannot be more than/i);

  const passes = validateBlock(
    { drillId: 'decision-receive', durationMin: '10', opportunities: '10', correct: '8', responseS: '1.0', scans: '10', passesAttempted: '5', passesCompleted: '7' },
    getDrill('decision-receive'),
  );
  assert.match(passes.errors.passesCompleted, /cannot be more than/i);

  const impossibleScans = validateBlock(
    { drillId: 'peripheral-cue', durationMin: '1', opportunities: '20', correct: '15', responseS: '1.2', scans: '200' },
    getDrill('peripheral-cue'),
  );
  assert.match(impossibleScans.errors.scans, /scans a minute/i);

  const fine = validateBlock(
    { drillId: 'peripheral-cue', durationMin: '1', opportunities: '20', correct: '15', responseS: '1.2', scans: '100' },
    getDrill('peripheral-cue'),
  );
  assert.equal(fine.ok, true, JSON.stringify(fine.errors));
});

test('the custom drill needs a name and keeps it', () => {
  const res = validateBlock(
    { drillId: 'custom', name: '', durationMin: '10', opportunities: '10', correct: '7', responseS: '', scans: '' },
    getDrill('custom'),
  );
  assert.match(res.errors.name, /required/i);

  const named = validateBlock(
    { drillId: 'custom', name: 'Turn & scan gates', durationMin: '10', opportunities: '10', correct: '7', responseS: '', scans: '' },
    getDrill('custom'),
  );
  assert.equal(named.ok, true);
  assert.equal(named.value.name, 'Turn & scan gates');
  assert.equal(named.value.responseS, null, 'an unrecorded optional measure is stored as null, not zero');
});

test('text limits and the empty-block rule', () => {
  const longNotes = validateBlock(
    { drillId: 'peripheral-cue', durationMin: '10', opportunities: '20', correct: '15', responseS: '1.2', notes: 'x'.repeat(141) },
    getDrill('peripheral-cue'),
  );
  assert.match(longNotes.errors.notes, /140 characters/i);

  const noBlocks = run({ blocks: [] });
  assert.equal(noBlocks.ok, false);
  assert.match(noBlocks.errors.form, /at least one drill block/i);

  const longConditions = run({ conditions: { notes: 'y'.repeat(141) } });
  assert.match(longConditions.errors.conditions.notes, /140 characters/i);
});

test('error helpers count and flatten for the summary line', () => {
  const res = run({ player: '', blocks: [{ drillId: 'peripheral-cue', durationMin: '', opportunities: '5', correct: '9' }] });
  assert.equal(res.ok, false);
  const messages = errorMessages(res.errors);
  assert.ok(messages.length >= 4, `expected several messages, got ${JSON.stringify(messages)}`);
  assert.ok(messages.some((m) => m.startsWith('Drill 1:')));
  assert.equal(countErrors(res.errors), messages.length);
  assert.equal(countErrors({}), 0);
});

test('parseField handles blanks, boundaries and stray whitespace', () => {
  const spec = { key: 'x', label: 'Cues shown', kind: 'int', min: 1, max: 10, required: false };
  assert.deepEqual(parseField(spec, ''), { ok: true, value: null });
  assert.deepEqual(parseField(spec, '  4  '), { ok: true, value: 4 });
  assert.equal(parseField(spec, '11').ok, false);
  assert.equal(parseField({ ...spec, required: true }, '').ok, false);
});

test('todayIso uses the local calendar day', () => {
  assert.equal(todayIso(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
  assert.equal(todayIso(new Date(2026, 11, 31, 0, 1)), '2026-12-31');
});
