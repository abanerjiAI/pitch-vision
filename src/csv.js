/**
 * CSV export (one row per drill block) and a plain-text summary builder.
 * CSV is for coaches who want the numbers in a spreadsheet; the JSON back-up in
 * storage.js is the lossless format.
 */

import { deriveSession, deriveBlock } from './metrics.js?v=3';

export const CSV_HEADER = [
  'player',
  'date',
  'drill',
  'drill_name',
  'duration_min',
  'chances',
  'correct',
  'accuracy_pct',
  'missed',
  'response_s',
  'scans',
  'scans_per_min',
  'passes_attempted',
  'passes_completed',
  'pass_completion_pct',
  'drill_index',
  'surface',
  'light',
  'weather',
  'ball',
  'conditions_notes',
  'block_notes',
  'session_id',
  'created_at',
];

/** RFC-4180 style escaping. */
export function escapeCell(value) {
  if (value == null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells) {
  return cells.map(escapeCell).join(',');
}

const numOrBlank = (v) => (typeof v === 'number' && isFinite(v) ? String(v) : '');

export function toCsv(sessions) {
  const lines = [csvRow(CSV_HEADER)];
  for (const session of sessions ?? []) {
    const derived = deriveSession(session);
    (session.blocks ?? []).forEach((block, i) => {
      const m = derived.blocks[i]?.m ?? deriveBlock(block);
      lines.push(
        csvRow([
          session.player,
          session.date,
          block.drillId,
          block.drillId === 'custom' && block.name ? block.name : m.drillName,
          numOrBlank(block.durationMin),
          numOrBlank(block.opportunities),
          numOrBlank(block.correct),
          numOrBlank(round(m.accuracyPct, 1)),
          numOrBlank(m.missed),
          numOrBlank(block.responseS),
          numOrBlank(block.scans),
          numOrBlank(round(m.scansPerMin, 2)),
          numOrBlank(block.passesAttempted),
          numOrBlank(block.passesCompleted),
          numOrBlank(round(m.passPct, 1)),
          numOrBlank(round(m.index, 1)),
          session.conditions?.surface ?? '',
          session.conditions?.light ?? '',
          session.conditions?.weather ?? '',
          session.conditions?.ball ?? '',
          session.conditions?.notes ?? '',
          block.notes ?? '',
          session.id,
          session.createdAt ?? '',
        ]),
      );
    });
  }
  return lines.join('\r\n') + '\r\n';
}

function round(n, digits) {
  if (typeof n !== 'number' || !isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function csvFileName(scope = 'all-players', date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  const slug = String(scope)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'player';
  return `pitchvision-${slug}-${stamp}.csv`;
}

/** Short plain-text block a coach can paste into a team message. */
export function toTextSummary(sessions, playerName) {
  const lines = [`PitchVision — drill summary${playerName ? ` for ${playerName}` : ''}`];
  for (const session of sessions ?? []) {
    const d = deriveSession(session);
    lines.push('');
    lines.push(
      `${session.date}${d.index == null ? '' : ` — drill index ${d.index.toFixed(1)}`}${
        d.accuracyPct == null ? '' : ` — accuracy ${d.accuracyPct.toFixed(1)}%`
      }`,
    );
    for (const { block, m } of d.blocks) {
      const bits = [];
      if (m.accuracyPct != null) bits.push(`${m.accuracyPct.toFixed(1)}% correct`);
      if (m.missed != null) bits.push(`${m.missed} missed`);
      if (block.responseS != null) bits.push(`${block.responseS}s`);
      if (m.scansPerMin != null) bits.push(`${m.scansPerMin.toFixed(1)} scans/min`);
      if (m.passPct != null) bits.push(`${m.passPct.toFixed(1)}% passes`);
      lines.push(`  · ${m.drillShort}: ${bits.join(', ')}`);
    }
  }
  lines.push('');
  lines.push('Drill performance only — not a medical or vision diagnosis.');
  return lines.join('\n');
}
