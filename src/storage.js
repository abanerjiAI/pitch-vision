/**
 * Persistence. Everything lives in the browser's localStorage under one key —
 * no accounts, no server, no data leaving the device unless the coach exports
 * it. The repo is built on an injectable adapter so the tests can run against a
 * plain Map instead of a browser.
 */

import { STORAGE_VERSION } from './drills.js?v=3';
import { validateSession } from './validate.js?v=3';

export const STORAGE_KEY = 'pitchvision.v1';

export function localStorageAdapter(scope = globalThis) {
  return {
    getItem: (k) => scope.localStorage.getItem(k),
    setItem: (k, v) => scope.localStorage.setItem(k, v),
    removeItem: (k) => scope.localStorage.removeItem(k),
  };
}

/** In-memory adapter, handy for tests and for browsers with storage switched off. */
export function memoryAdapter() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

export function isAvailable(adapter) {
  try {
    const probe = '__pitchvision_probe__';
    adapter.setItem(probe, '1');
    const ok = adapter.getItem(probe) === '1';
    adapter.removeItem(probe);
    return ok;
  } catch {
    return false;
  }
}

function saneStoredSession(s) {
  return Boolean(s) && typeof s === 'object' && typeof s.id === 'string' && typeof s.date === 'string' && Array.isArray(s.blocks);
}

/** Tolerant read: a corrupt or unknown payload degrades to an empty set, never a crash. */
export function parseState(raw) {
  if (!raw) return { version: STORAGE_VERSION, sessions: [], error: null };
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { version: STORAGE_VERSION, sessions: [], error: 'unreadable' };
  }
  if (!obj || typeof obj !== 'object') return { version: STORAGE_VERSION, sessions: [], error: 'unreadable' };
  const version = Number(obj.version ?? 0);
  if (version > STORAGE_VERSION) {
    return { version, sessions: [], error: 'newer' };
  }
  const sessions = Array.isArray(obj.sessions) ? obj.sessions.filter(saneStoredSession) : [];
  return { version: STORAGE_VERSION, sessions, error: null };
}

export function serializeState(sessions) {
  return JSON.stringify({ app: 'pitchvision', version: STORAGE_VERSION, sessions }, null, 2);
}

/**
 * Validate a back-up payload. Accepts either { sessions: [...] } or a bare
 * array. Bad records are skipped with a reason rather than failing the lot.
 */
export function parsePayload(text, opts = {}) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.', sessions: [], skipped: [] };
  }
  const payload = Array.isArray(obj) ? { sessions: obj } : obj;
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.sessions)) {
    return { ok: false, error: 'No sessions found in that file.', sessions: [], skipped: [] };
  }
  const version = Number(payload.version ?? 0);
  if (version > STORAGE_VERSION) {
    return { ok: false, error: `That file was written by PitchVision v${version}; this app reads v${STORAGE_VERSION}.`, sessions: [], skipped: [] };
  }
  const sessions = [];
  const skipped = [];
  payload.sessions.forEach((raw, i) => {
    const res = validateSession(raw, { today: null, ...opts });
    if (res.ok) sessions.push(res.value);
    else skipped.push({ index: i + 1, reason: res.errors?.player ?? res.errors?.date ?? 'incomplete record' });
  });
  return { ok: true, error: null, sessions, skipped };
}

export function createRepo(adapter, key = STORAGE_KEY) {
  let cache = null;

  const read = () => {
    if (cache) return cache;
    let raw = null;
    try {
      raw = adapter.getItem(key);
    } catch {
      raw = null;
    }
    cache = parseState(raw);
    return cache;
  };

  const write = (state) => {
    cache = state;
    try {
      adapter.setItem(key, JSON.stringify({ app: 'pitchvision', version: STORAGE_VERSION, sessions: state.sessions }));
      return true;
    } catch {
      return false;
    }
  };

  return {
    available: () => isAvailable(adapter),
    state: () => ({ ...read() }),
    sessions: () => read().sessions.slice(),
    status: () => {
      const s = read();
      return { version: s.version, count: s.sessions.length, error: s.error };
    },
    addSession(session) {
      const state = read();
      state.sessions.push(session);
      return write(state);
    },
    deleteSession(id) {
      const state = read();
      const next = state.sessions.filter((s) => s.id !== id);
      const changed = next.length !== state.sessions.length;
      if (changed) write({ ...state, sessions: next });
      return changed;
    },
    replaceSessions(sessions) {
      return write({ version: STORAGE_VERSION, sessions: sessions.slice(), error: null });
    },
    clear() {
      try {
        adapter.removeItem(key);
      } catch {
        /* ignore */
      }
      cache = { version: STORAGE_VERSION, sessions: [], error: null };
      return true;
    },
    exportJson(sessions) {
      return serializeState(sessions ?? read().sessions);
    },
    /** Merge a back-up in, replacing records with the same id. */
    importJson(text, opts) {
      const parsed = parsePayload(text, opts);
      if (!parsed.ok) return { ...parsed, added: 0 };
      const state = read();
      const byId = new Map(state.sessions.map((s) => [s.id, s]));
      let added = 0;
      for (const s of parsed.sessions) {
        if (!byId.has(s.id)) added += 1;
        byId.set(s.id, s);
      }
      const merged = [...byId.values()].sort((a, b) =>
        String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)),
      );
      const saved = write({ version: STORAGE_VERSION, sessions: merged, error: null });
      return { ...parsed, added, saved };
    },
  };
}
