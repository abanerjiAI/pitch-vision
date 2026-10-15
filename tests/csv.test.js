import test from 'node:test';
import assert from 'node:assert/strict';

import { CSV_HEADER, csvFileName, csvRow, escapeCell, toCsv, toTextSummary } from '../src/csv.js';

const session = {
  id: 's_1',
  player: 'A. Rivera',
  key: 'a-rivera',
  date: '2026-10-15',
  createdAt: '2026-10-15T09:00:00.000Z',
  conditions: { surface: 'Grass', light: 'Daylight', weather: 'Dry', ball: 'Size 5', notes: 'wind from the left' },
  blocks: [
    {
      drillId: 'peripheral-cue',
      name: '',
      durationMin: 10,
      opportunities: 20,
      correct: 15,
      responseS: 1.6,
      scans: 30,
      passesAttempted: null,
      passesCompleted: null,
      notes: 'left foot only, "narrow" corridor',
    },
    {
      drillId: 'decision-receive',
      name: '',
      durationMin: 5,
      opportunities: 10,
      correct: 8,
      responseS: 1.0,
      scans: 10,
      passesAttempted: 8,
      passesCompleted: 6,
      notes: '',
    },
  ],
};

test('cells are escaped per RFC 4180', () => {
  assert.equal(escapeCell('plain'), 'plain');
  assert.equal(escapeCell('a,b'), '"a,b"');
  assert.equal(escapeCell('says "go"'), '"says ""go"""');
  assert.equal(escapeCell('two\nlines'), '"two\nlines"');
  assert.equal(escapeCell(null), '');
  assert.equal(escapeCell(0), '0');
  assert.equal(csvRow(['a', 'b,c']), 'a,"b,c"');
});

test('the header is stable and one row is written per drill block', () => {
  const csv = toCsv([session]);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], CSV_HEADER.join(','));
  assert.equal(lines.length, 1 + session.blocks.length);
  assert.ok(csv.endsWith('\r\n'), 'files end with a newline');
  assert.equal(toCsv([]).trim(), CSV_HEADER.join(','));
});

test('rows carry the stored values next to the derived ones', () => {
  const lines = toCsv([session]).trim().split('\r\n');
  const header = CSV_HEADER;
  const cells = parseRow(lines[1]);
  const at = (name) => cells[header.indexOf(name)];
  assert.equal(cells.length, header.length, 'every row has exactly one cell per column');
  assert.equal(at('player'), 'A. Rivera');
  assert.equal(at('date'), '2026-10-15');
  assert.equal(at('drill'), 'peripheral-cue');
  assert.equal(at('chances'), '20');
  assert.equal(at('correct'), '15');
  assert.equal(at('accuracy_pct'), '75');
  assert.equal(at('missed'), '5');
  assert.equal(at('response_s'), '1.6');
  assert.equal(at('scans'), '30');
  assert.equal(at('scans_per_min'), '3');
  assert.equal(at('drill_index'), '62.5');
  assert.equal(at('surface'), 'Grass');
  assert.equal(at('session_id'), 's_1');

  const second = lines[2];
  assert.ok(second.includes('decision-receive'));
  assert.ok(second.includes('80'), 'decision accuracy is exported for the passing drill');
  assert.ok(second.includes('75'), 'pass completion is exported');
});

test('text that contains a comma or a quote does not break the column count', () => {
  const lines = toCsv([session]).trim().split('\r\n');
  assert.ok(lines[1].includes('"left foot only, ""narrow"" corridor"'), 'the note is quoted and its quotes doubled');
  const cells = parseRow(lines[1]);
  assert.equal(cells.length, CSV_HEADER.length);
  assert.equal(cells[CSV_HEADER.indexOf('block_notes')], 'left foot only, "narrow" corridor');
  assert.equal(parseRow(lines[2]).length, CSV_HEADER.length);
});

/** Minimal quote-aware reader, used here to prove the writer is well formed. */
function parseRow(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

test('file names are safe and dated', () => {
  const f = csvFileName('A. Rivera', new Date('2026-10-15T12:00:00.000Z'));
  assert.equal(f, 'pitchvision-a-rivera-2026-10-15.csv');
  assert.equal(csvFileName('all players', new Date('2026-01-02T12:00:00.000Z')), 'pitchvision-all-players-2026-01-02.csv');
  assert.equal(csvFileName('   ', new Date('2026-01-02T12:00:00.000Z')), 'pitchvision-player-2026-01-02.csv');
});

test('the text summary ends with the disclaimer', () => {
  const text = toTextSummary([session], 'A. Rivera');
  assert.ok(text.includes('A. Rivera'));
  assert.ok(text.includes('15 Oct 2026') === false || text.includes('2026-10-15'));
  assert.ok(text.includes('Peripheral cue ID'));
  assert.ok(text.includes('75.0% correct'));
  assert.ok(text.includes('3.0 scans/min'));
  assert.ok(text.trimEnd().endsWith('Drill performance only — not a medical or vision diagnosis.'));
});
