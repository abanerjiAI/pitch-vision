/**
 * Grouping, per-player series, deltas and chart geometry. Pure functions, so the
 * comparison maths can be tested without a browser.
 */

/** Stable key for a typed name or player ID, so "A. Rivera" and "a rivera" group. */
export function playerKey(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

const byDateAsc = (a, b) =>
  String(a.date ?? '').localeCompare(String(b.date ?? '')) ||
  String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));

/** Newest-first list of players, with their sessions oldest-first. */
export function groupByPlayer(sessions) {
  const map = new Map();
  for (const s of sessions ?? []) {
    const key = s.key || playerKey(s.player);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, player: s.player, sessions: [] });
    map.get(key).sessions.push(s);
  }
  const out = [...map.values()];
  for (const p of out) {
    p.sessions.sort(byDateAsc);
    p.first = p.sessions[0]?.date ?? null;
    p.last = p.sessions[p.sessions.length - 1]?.date ?? null;
  }
  out.sort((a, b) => String(b.last ?? '').localeCompare(String(a.last ?? '')) || a.player.localeCompare(b.player));
  return out;
}

export function sessionsForPlayer(sessions, key) {
  return (sessions ?? []).filter((s) => (s.key || playerKey(s.player)) === key).sort(byDateAsc);
}

/** Sorted list of drill ids that appear in a session list, with display names. */
export function drillsUsed(sessions) {
  const ids = new Set();
  for (const s of sessions ?? []) for (const b of s.blocks ?? []) ids.add(b.drillId);
  return [...ids];
}

/**
 * One point per session for a chosen drill and metric. When a session holds the
 * same drill more than once, the blocks are averaged weighted by chances
 * presented, so a 30-cue block outweighs a 5-cue one.
 */
export function seriesFor(sessions, playerKeyValue, drillId, metricKey, derive) {
  const rows = sessionsForPlayer(sessions, playerKeyValue);
  return rows.map((session) => {
    const matching = (session.blocks ?? []).filter((b) => b.drillId === drillId);
    const pairs = matching.map((block) => ({ block, derived: derive(block) }));
    let total = 0;
    let weight = 0;
    for (const { block, derived } of pairs) {
      const value = metricOf(derived, block, metricKey);
      if (value == null || !isFinite(value)) continue;
      const w = Number(block.opportunities) > 0 ? Number(block.opportunities) : 1;
      total += value * w;
      weight += w;
    }
    return {
      sessionId: session.id,
      date: session.date,
      blocks: matching.length,
      value: weight > 0 ? total / weight : null,
    };
  });
}

function metricOf(derived, block, key) {
  switch (key) {
    case 'accuracyPct':
      return derived.accuracyPct;
    case 'missed':
      return derived.missed;
    case 'responseS':
      return typeof block?.responseS === 'number' ? block.responseS : null;
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

export function valuesOf(points) {
  return (points ?? []).map((p) => (p && typeof p.value === 'number' && isFinite(p.value) ? p.value : null));
}

/** First / latest / best / change, for one series. Nulls where not derivable. */
export function summariseSeries(points) {
  const vals = valuesOf(points).filter((v) => v != null);
  const base = {
    sessions: (points ?? []).length,
    measured: vals.length,
    first: null,
    last: null,
    previous: null,
    mean: null,
    min: null,
    max: null,
    best: null,
    worst: null,
    deltaPrev: null,
    deltaFirst: null,
  };
  if (!vals.length) return base;
  const first = vals[0];
  const last = vals[vals.length - 1];
  const previous = vals.length > 1 ? vals[vals.length - 2] : null;
  return {
    ...base,
    first,
    last,
    previous,
    mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    min: Math.min(...vals),
    max: Math.max(...vals),
    best: Math.max(...vals),
    worst: Math.min(...vals),
    deltaPrev: previous == null ? null : last - previous,
    deltaFirst: vals.length > 1 ? last - first : null,
  };
}

/**
 * Map values to SVG coordinates. Nulls (a session where the metric was not
 * recorded) keep their slot on the x axis and are dropped from the line, so the
 * time spacing stays honest. A single value or a flat series sits on the middle.
 */
export function scalePoints(values, { width = 300, height = 100 } = {}) {
  const list = Array.isArray(values) ? values : [];
  const nums = list.filter((v) => typeof v === 'number' && isFinite(v));
  if (!nums.length) return list.map(() => null);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min;
  const denom = list.length > 1 ? list.length - 1 : 1;
  return list.map((v, i) => {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    const x = list.length > 1 ? (i / denom) * width : width / 2;
    const y = span > 0 ? height - ((v - min) / span) * height : height / 2;
    return { x: round2(x), y: round2(y), value: v, index: i };
  });
}

/** SVG path data for the scaled points, broken at gaps. */
export function sparkPath(points) {
  const parts = [];
  let open = false;
  for (const p of points ?? []) {
    if (!p) {
      open = false;
      continue;
    }
    parts.push(`${open ? 'L' : 'M'}${p.x},${p.y}`);
    open = true;
  }
  return parts.join(' ');
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Chronological labels for the chart's first and last tick. */
export function seriesLabels(points) {
  const list = (points ?? []).filter(Boolean);
  if (!list.length) return { first: '', last: '' };
  return { first: list[0].date ?? '', last: list[list.length - 1].date ?? '' };
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return String(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mi = Number(m) - 1;
  return `${Number(d)} ${months[mi] ?? m} ${y}`;
}

export function formatDelta(delta, digits = 1, higherIsBetter = true) {
  if (delta == null || !isFinite(delta) || Math.abs(delta) < 1e-9) return { text: 'no change', dir: 0 };
  const sign = delta > 0 ? '+' : '−';
  const magnitude = Number(Math.abs(delta).toFixed(digits));
  const better = higherIsBetter ? delta > 0 : delta < 0;
  return { text: `${sign}${magnitude}`, dir: better ? 1 : -1 };
}
