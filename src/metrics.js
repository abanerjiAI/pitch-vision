/**
 * Derived measures. Pure functions only — no DOM, no storage — so every number
 * the interface shows can be unit-tested against hand-computed values.
 *
 * Vocabulary used throughout:
 *   accuracy   correct ÷ chances presented
 *   missed     chances presented that were not answered correctly (derived, not stored)
 *   scans/min  head scans normalised by the block duration
 *   drill index  0–100 within-session summary of the components below. It is a
 *                coaching summary of drill performance, not a clinical score.
 */

import { getDrill } from './drills.js?v=3';

export const INDEX_WEIGHTS = { accuracy: 0.5, speed: 0.3, scanning: 0.2 };

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

export function pct(part, whole) {
  const p = num(part);
  const w = num(whole);
  if (p == null || w == null || w <= 0) return null;
  return (p / w) * 100;
}

export function missedCount(opportunities, correct) {
  const o = num(opportunities);
  const c = num(correct);
  if (o == null || c == null) return null;
  return Math.max(0, o - c);
}

/**
 * Response-time component: the drill's par time divided by the measured time,
 * capped at 100. At par = 100, twice par = 50, and it never falls below 0.
 * A fast, accurate player scores higher than a slow one with the same accuracy.
 */
export function speedScore(responseS, parResponseS) {
  const t = num(responseS);
  const par = num(parResponseS);
  if (t == null || par == null || t <= 0 || par <= 0) return null;
  return clamp((100 * par) / t, 0, 100);
}

/** Scanning component: full marks at the drill's target rate, capped at 100. */
export function scanScore(scansPerMin, scanTargetPerMin) {
  const rate = num(scansPerMin);
  const target = num(scanTargetPerMin);
  if (rate == null || target == null || target <= 0) return null;
  return clamp((100 * rate) / target, 0, 100);
}

/**
 * Weighted mean over the components that exist. Weights are re-normalised, so a
 * drill without a response time or without scans still yields a fair index
 * (and a drill with neither falls back to accuracy alone).
 */
export function weightedIndex(components) {
  let total = 0;
  let weight = 0;
  for (const [name, value] of Object.entries(components)) {
    const w = INDEX_WEIGHTS[name];
    const v = num(value);
    if (w == null || v == null) continue;
    total += v * w;
    weight += w;
  }
  if (weight === 0) return null;
  return total / weight;
}

/** Everything derivable from one drill block. */
export function deriveBlock(block) {
  const drill = getDrill(block?.drillId);
  const opportunities = num(block?.opportunities);
  const correct = num(block?.correct);
  const durationMin = num(block?.durationMin);
  const scans = num(block?.scans);
  const responseS = num(block?.responseS);

  const accuracyPct = pct(correct, opportunities);
  const missed = missedCount(opportunities, correct);
  const scansPerMin = scans != null && durationMin != null && durationMin > 0 ? scans / durationMin : null;
  const passPct = pct(num(block?.passesCompleted), num(block?.passesAttempted));
  const passRecorded = num(block?.passesAttempted) != null && num(block?.passesAttempted) > 0;

  // Decisions and pass completion both describe "did the right thing happen",
  // so when both are recorded they share the accuracy component.
  const accuracyParts = [accuracyPct, passRecorded ? passPct : null].filter((v) => v != null);
  const accuracyComponent = accuracyParts.length ? accuracyParts.reduce((a, b) => a + b, 0) / accuracyParts.length : null;

  const speed = speedScore(responseS, drill.parResponseS);
  const scanning = scanScore(scansPerMin, drill.scanTargetPerMin);
  const index = weightedIndex({ accuracy: accuracyComponent, speed, scanning });

  return {
    drillId: drill.id,
    drillName: drill.name,
    drillShort: drill.short,
    accuracyPct,
    missed,
    scansPerMin,
    passPct: passRecorded ? passPct : null,
    components: { accuracy: accuracyComponent, speed, scanning },
    index,
  };
}

/** Session roll-up: totals, overall rates and an opportunity-weighted index. */
export function deriveSession(session) {
  const blocks = Array.isArray(session?.blocks) ? session.blocks : [];
  const rows = blocks.map((block) => ({ block, m: deriveBlock(block) }));

  const sum = (pick) => {
    let total = 0;
    let seen = false;
    for (const r of rows) {
      const v = pick(r);
      if (v == null || !isFinite(v)) continue;
      total += v;
      seen = true;
    }
    return seen ? total : null;
  };

  const opportunities = sum((r) => num(r.block.opportunities));
  const correct = sum((r) => num(r.block.correct));
  const missed = sum((r) => r.m.missed);
  const scans = sum((r) => num(r.block.scans));
  const durationMin = sum((r) => num(r.block.durationMin));

  let weightedTotal = 0;
  let weightedBy = 0;
  for (const r of rows) {
    if (r.m.index == null) continue;
    const weight = num(r.block.opportunities) ?? 1;
    weightedTotal += r.m.index * weight;
    weightedBy += weight;
  }

  const responseBlocks = rows.filter((r) => num(r.block.responseS) != null);
  const responseS = responseBlocks.length
    ? responseBlocks.reduce((a, r) => a + num(r.block.responseS), 0) / responseBlocks.length
    : null;

  return {
    blocks: rows,
    blockCount: rows.length,
    drillCount: new Set(rows.map((r) => r.m.drillId)).size,
    opportunities,
    correct,
    missed,
    accuracyPct: pct(correct, opportunities),
    scans,
    scansPerMin: scans != null && durationMin ? scans / durationMin : null,
    durationMin,
    responseS,
    index: weightedBy > 0 ? weightedTotal / weightedBy : null,
  };
}

/* ------------------------------------------------- what can be compared */

export const METRICS = [
  { key: 'index', label: 'Drill index (0–100)', digits: 1, higherIsBetter: true },
  { key: 'accuracyPct', label: 'Accuracy (%)', digits: 1, higherIsBetter: true },
  { key: 'missed', label: 'Missed cues', digits: 0, higherIsBetter: false },
  { key: 'responseS', label: 'Mean response time (s)', digits: 2, higherIsBetter: false },
  { key: 'scansPerMin', label: 'Head scans per minute', digits: 1, higherIsBetter: true },
  { key: 'passPct', label: 'Pass completion (%)', digits: 1, higherIsBetter: true },
];

export function getMetric(key) {
  return METRICS.find((m) => m.key === key) ?? METRICS[0];
}

/** Pull one comparable number out of a derived block (+ its raw block). */
export function metricValue(derived, block, key) {
  switch (key) {
    case 'accuracyPct':
      return derived.accuracyPct;
    case 'missed':
      return derived.missed;
    case 'responseS':
      return num(block?.responseS);
    case 'scansPerMin':
      return derived.scansPerMin;
    case 'passPct':
      return derived.passPct;
    case 'index':
      return derived.index;
    default:
      return null;
  }
}
