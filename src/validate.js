/**
 * Input validation and session building. The interface feeds raw strings
 * straight from the form (and import feed stored objects) into validateSession,
 * which either returns a clean session object or a per-field error map. Nothing
 * is written unless validation passes.
 */

import { getDrill, CONDITIONS_NOTES_LIMIT, STORAGE_VERSION } from './drills.js';
import { playerKey } from './stats.js';

export const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INT_RE = /^[+-]?\d+$/;
const DEC_RE = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function isRealDate(value) {
  const m = DATE_RE.exec(String(value ?? ''));
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Format a number for display: '—' when there is nothing to show. */
export function fmtNumber(value, digits = 0) {
  if (value == null || typeof value !== 'number' || !isFinite(value)) return '—';
  const s = value.toFixed(digits);
  return digits > 0 ? s.replace(/\.?0+$/, '') : s;
}

/* ------------------------------------------------------------ one field */

/**
 * Parse and range-check a single field against its spec.
 * Returns { ok, value, error }. Blank optional fields give { ok: true, value: null }.
 */
export function parseField(spec, raw) {
  const has = raw !== undefined && raw !== null && String(raw).trim() !== '';

  if (spec.kind === 'text') {
    const text = String(raw ?? '').trim();
    if (!text) {
      return spec.required
        ? { ok: false, value: null, error: `${spec.label} is required.` }
        : { ok: true, value: '' };
    }
    if (spec.maxLength && text.length > spec.maxLength) {
      return { ok: false, value: null, error: `Keep ${spec.label.toLowerCase()} to ${spec.maxLength} characters or fewer.` };
    }
    return { ok: true, value: text };
  }

  if (!has) {
    return spec.required
      ? { ok: false, value: null, error: `${spec.label} is required.` }
      : { ok: true, value: null };
  }

  const text = String(raw).trim();
  if (spec.kind === 'int' ? !INT_RE.test(text) : !DEC_RE.test(text)) {
    return {
      ok: false,
      value: null,
      error: spec.kind === 'int' ? `${spec.label} must be a whole number.` : `${spec.label} must be a number, e.g. 1.4.`,
    };
  }

  const value = Number(text);
  if (!isFinite(value)) {
    return { ok: false, value: null, error: `${spec.label} must be a number.` };
  }
  if (spec.kind === 'int' && !Number.isInteger(value)) {
    return { ok: false, value: null, error: `${spec.label} must be a whole number.` };
  }
  if (spec.min != null && value < spec.min) {
    return { ok: false, value: null, error: `${spec.label} must be at least ${fmtNumber(spec.min, 2)}${spec.unit ? ' ' + spec.unit : ''}.` };
  }
  if (spec.max != null && value > spec.max) {
    return { ok: false, value: null, error: `${spec.label} must be ${fmtNumber(spec.max, 2)}${spec.unit ? ' ' + spec.unit : ''} or less.` };
  }
  return { ok: true, value };
}

/* ------------------------------------------------------------ one block */

/**
 * Validate a drill block. Cross-field rules live here: correct answers cannot
 * exceed chances presented, completed passes cannot exceed attempted passes,
 * and an impossible scanning rate is caught rather than stored.
 */
export function validateBlock(rawBlock, drill) {
  const drillId = rawBlock?.drillId && getDrill(rawBlock.drillId).id === rawBlock.drillId ? rawBlock.drillId : drill.id;
  const def = getDrill(drillId);
  const errors = {};
  const values = { drillId };

  for (const spec of def.fields) {
    const res = parseField(spec, rawBlock?.[spec.key]);
    if (!res.ok) errors[spec.key] = res.error;
    values[spec.key] = res.value;
  }

  const opportunities = values.opportunities;
  const correct = values.correct;

  if (opportunities != null && correct != null && correct > opportunities) {
    const label = def.fields.find((f) => f.key === 'opportunities')?.label ?? 'Chances presented';
    errors.correct = `Correct answers cannot be more than the ${label.toLowerCase()} (${opportunities}).`;
  }
  if (values.passesAttempted != null && values.passesCompleted != null && values.passesCompleted > values.passesAttempted) {
    errors.passesCompleted = `Completed passes cannot be more than the passes attempted (${values.passesAttempted}).`;
  }
  if (values.scans != null && values.durationMin != null && values.durationMin > 0) {
    const perMin = values.scans / values.durationMin;
    if (perMin > 120) {
      errors.scans = `That is ${Math.round(perMin)} scans a minute — more than two a second. Check the scan count or the block duration.`;
    }
  }

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    value: ok
      ? {
          drillId,
          name: values.name ?? '',
          durationMin: values.durationMin,
          opportunities: values.opportunities,
          correct: values.correct,
          responseS: values.responseS ?? null,
          scans: values.scans ?? null,
          passesAttempted: values.passesAttempted ?? null,
          passesCompleted: values.passesCompleted ?? null,
          notes: values.notes ?? '',
        }
      : null,
  };
}

/* ---------------------------------------------------------- one session */

const DEFAULT_ID = () => `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * Validate a whole session draft.
 *   raw  { player, date, conditions: {...}, blocks: [ rawBlock ] }
 *   opts { today: 'YYYY-MM-DD' | null, idFactory, now }
 * `today: null` skips the future-date rule (used when importing a back-up).
 */
export function validateSession(raw, opts = {}) {
  const today = opts.today === undefined ? todayIso() : opts.today;
  const idFactory = opts.idFactory ?? DEFAULT_ID;
  const createdAt = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
  const errors = {};

  const player = String(raw?.player ?? '').trim();
  if (!player) {
    errors.player = 'Enter the player name or ID.';
  } else if (player.length > 48) {
    errors.player = 'Keep the player name or ID to 48 characters or fewer.';
  } else if (!/[a-z0-9]/i.test(player)) {
    errors.player = 'The player name or ID needs at least one letter or number.';
  } else if (playerKey(player) === '') {
    errors.player = 'Use letters or numbers in the player name or ID.';
  }

  const date = String(raw?.date ?? '').trim();
  if (!date) {
    errors.date = 'Pick the drill date.';
  } else if (!isRealDate(date)) {
    errors.date = 'Use a real date (YYYY-MM-DD).';
  } else if (today && date > today) {
    errors.date = 'The drill date cannot be in the future.';
  } else if (date < '2000-01-01') {
    errors.date = 'Check the year — that date is before 2000.';
  }

  const conditions = {};
  const srcConditions = raw?.conditions ?? {};
  for (const key of ['surface', 'light', 'weather', 'ball']) {
    const value = String(srcConditions[key] ?? '').trim();
    conditions[key] = value.slice(0, 40);
  }
  const condNotes = String(srcConditions.notes ?? '').trim();
  if (condNotes.length > CONDITIONS_NOTES_LIMIT) {
    errors.conditions = {
      notes: `Keep the condition notes to ${CONDITIONS_NOTES_LIMIT} characters or fewer.`,
    };
  }
  conditions.notes = condNotes.slice(0, CONDITIONS_NOTES_LIMIT);

  const rawBlocks = Array.isArray(raw?.blocks) ? raw.blocks : [];
  const blockErrors = {};
  const blocks = [];
  if (rawBlocks.length === 0) {
    errors.form = 'Add at least one drill block.';
  }
  rawBlocks.forEach((rawBlock, i) => {
    const res = validateBlock(rawBlock, getDrill(rawBlock?.drillId));
    if (!res.ok) blockErrors[i] = res.errors;
    else blocks.push(res.value);
  });
  if (Object.keys(blockErrors).length) errors.blocks = blockErrors;

  const ok = Object.keys(errors).length === 0;
  if (!ok) return { ok: false, errors, value: null };

  const now = opts.now instanceof Date ? opts.now : new Date();
  return {
    ok: true,
    errors: {},
    value: {
      id: typeof raw?.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : idFactory(),
      createdAt: typeof raw?.createdAt === 'string' && raw.createdAt ? raw.createdAt : createdAt,
      player,
      key: playerKey(player),
      date,
      conditions,
      blocks,
      version: STORAGE_VERSION,
      savedAt: now.toISOString(),
    },
  };
}

/** How many individual problems are in an error map (for the summary line). */
export function countErrors(errors) {
  if (!errors) return 0;
  let n = 0;
  for (const [key, value] of Object.entries(errors)) {
    if (key === 'blocks' && value && typeof value === 'object') {
      for (const fieldErrors of Object.values(value)) n += Object.keys(fieldErrors ?? {}).length;
    } else if (value && typeof value === 'object') {
      n += countErrors(value);
    } else if (value) {
      n += 1;
    }
  }
  return n;
}

/** Flat list of messages, for an error summary at the top of the form. */
export function errorMessages(errors) {
  const out = [];
  for (const [key, value] of Object.entries(errors ?? {})) {
    if (key === 'blocks') {
      for (const [index, fieldErrors] of Object.entries(value ?? {})) {
        for (const msg of Object.values(fieldErrors ?? {})) out.push(`Drill ${Number(index) + 1}: ${msg}`);
      }
    } else if (value && typeof value === 'object') {
      for (const msg of Object.values(value)) out.push(String(msg));
    } else if (value) {
      out.push(String(value));
    }
  }
  return out;
}
