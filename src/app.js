/**
 * PitchVision — interface.
 *
 * One screen of code, four tabs: Record, History, Compare, More.
 * No framework, no build step, no network calls. All state lives in
 * localStorage through storage.js.
 */

import {
  APP_NAME,
  APP_TAGLINE,
  CONDITIONS_NOTES_LIMIT,
  CONDITION_FIELDS,
  DEFAULT_DRILL_ID,
  DISCLAIMER_LONG,
  DISCLAIMER_SHORT,
  DRILLS,
  STORAGE_VERSION,
  getDrill,
} from './drills.js';
import { METRICS, deriveSession, deriveBlock, getMetric } from './metrics.js';
import {
  formatDate,
  formatDelta,
  groupByPlayer,
  scalePoints,
  seriesFor,
  sparkPath,
  summariseSeries,
  valuesOf,
  drillsUsed,
} from './stats.js';
import { csvFileName, toCsv, toTextSummary } from './csv.js';
import { countErrors, errorMessages, todayIso, validateSession } from './validate.js';
import { createRepo, isAvailable, localStorageAdapter } from './storage.js';
import { el, fmt, pctText, qs, setChildren } from './dom.js';

const UI_KEY = 'pitchvision.ui';

const adapter = localStorageAdapter();
const storageOk = isAvailable(adapter);
const repo = createRepo(adapter);

let uidSeq = 0;
const nextUid = () => `b${++uidSeq}`;

const state = {
  view: 'record',
  theme: 'light',
  draft: null,
  errors: {},
  timers: new Map(),
  refs: new Map(),
  playerFilter: '',
  compare: { player: '', drill: DEFAULT_DRILL_ID, metric: 'index' },
};

/* --------------------------------------------------------------- helpers */

function makeBlock(drillId = DEFAULT_DRILL_ID) {
  return {
    uid: nextUid(),
    drillId,
    name: '',
    durationMin: '',
    opportunities: '',
    correct: '',
    responseS: '',
    scans: '',
    passesAttempted: '',
    passesCompleted: '',
    notes: '',
  };
}

function blankDraft() {
  return {
    player: '',
    date: todayIso(),
    conditions: { surface: '', light: '', weather: '', ball: '', notes: '' },
    blocks: [makeBlock(DEFAULT_DRILL_ID)],
  };
}

function loadUi() {
  try {
    const raw = adapter.getItem(UI_KEY);
    if (!raw) return;
    const ui = JSON.parse(raw);
    if (ui && typeof ui === 'object') {
      if (ui.theme === 'dark' || ui.theme === 'light') state.theme = ui.theme;
      if (typeof ui.player === 'string') state.draft.player = ui.player;
      if (typeof ui.drill === 'string') state.compare.drill = ui.drill;
      if (typeof ui.metric === 'string') state.compare.metric = ui.metric;
    }
  } catch {
    /* preferences are optional */
  }
}

function saveUi() {
  if (!storageOk) return;
  try {
    adapter.setItem(
      UI_KEY,
      JSON.stringify({ theme: state.theme, player: state.draft.player, drill: state.compare.drill, metric: state.compare.metric }),
    );
  } catch {
    /* ignore */
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const meta = qs('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', state.theme === 'dark' ? '#07231a' : '#0b5138');
}

let toastTimer = null;
function toast(message) {
  const node = qs('#toast');
  node.textContent = message;
  node.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 5000);
}

function download(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ------------------------------------------------------------------ shell */

function renderTabs() {
  const nav = qs('.tabs');
  for (const btn of nav.querySelectorAll('.tab')) {
    const active = btn.dataset.view === state.view;
    btn.setAttribute('aria-current', active ? 'page' : 'false');
    btn.classList.toggle('is-active', active);
  }
}

function setView(view) {
  state.view = view;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function render() {
  renderTabs();
  for (const id of ['record', 'history', 'compare', 'more']) {
    const node = qs(`#view-${id}`);
    node.hidden = id !== state.view;
  }
  if (state.view === 'record') renderRecord();
  if (state.view === 'history') renderHistory();
  if (state.view === 'compare') renderCompare();
  if (state.view === 'more') renderMore();
}

/* ----------------------------------------------------------------- record */

function fieldId(scope, key) {
  return `${scope}:${key}`;
}

function numberInput(spec, scope, block) {
  const id = fieldId(scope, spec.key);
  const input = el('input', {
    id,
    class: 'input',
    type: 'text',
    inputmode: spec.kind === 'int' ? 'numeric' : 'decimal',
    autocomplete: 'off',
    value: block[spec.key] ?? '',
    placeholder: spec.kind === 'int' ? '0' : '0.0',
    'aria-describedby': `${id}-help`,
  });
  state.refs.set(id, input);
  return input;
}

function textInput(spec, scope, block) {
  const id = fieldId(scope, spec.key);
  const input = el('input', {
    id,
    class: 'input',
    type: 'text',
    autocomplete: 'off',
    maxlength: spec.maxLength ? String(spec.maxLength) : null,
    value: block[spec.key] ?? '',
    placeholder: spec.key === 'name' ? 'e.g. Turn & scan gates' : 'optional',
    'aria-describedby': `${id}-help`,
  });
  state.refs.set(id, input);
  return input;
}

function fieldRow(spec, scope, block, timerNode) {
  const id = fieldId(scope, spec.key);
  const optional = !spec.required;
  const label = el(
    'label',
    { class: 'field__label', for: id },
    spec.label,
    optional ? el('span', { class: 'field__opt', text: 'optional' }) : null,
    spec.unit ? el('span', { class: 'field__unit', text: spec.unit }) : null,
  );
  const input = spec.kind === 'text' ? textInput(spec, scope, block) : numberInput(spec, scope, block);
  input.addEventListener('input', onFieldInput);
  input.addEventListener('blur', () => {
    syncDraftFromRefs();
    validateAndPaint();
  });

  return el(
    'div',
    { class: 'field', dataset: { scope, key: spec.key } },
    label,
    el('div', { class: 'field__control' }, input, timerNode ?? null),
    el('p', { class: 'field__help', id: `${id}-help`, text: spec.help ?? '' }),
    el('p', { class: 'field__error', id: `${id}-error`, role: 'alert' }),
  );
}

function blockCard(block, index, total) {
  const drill = getDrill(block.drillId);
  const scope = block.uid;

  const drillSelect = el(
    'select',
    { class: 'input input--select', id: `${scope}-drill`, 'aria-label': `Drill ${index + 1} type` },
    ...DRILLS.map((d) => el('option', { value: d.id, selected: d.id === block.drillId, text: d.name })),
  );
  drillSelect.addEventListener('change', () => {
    syncDraftFromRefs();
    const target = state.draft.blocks.find((b) => b.uid === scope);
    if (target) target.drillId = drillSelect.value;
    state.timers.delete(scope);
    renderRecord();
  });

  const timerNote = el('p', { class: 'timer__note', id: `${scope}-timer-note` });
  state.refs.set(`${scope}:note`, timerNote);
  const timerButton = el('button', {
    class: 'btn btn--timer',
    type: 'button',
    text: 'Time a rep',
    title: 'Start the clock when the cue goes up, stop it when the player answers.',
  });
  const timerInfo = el('span', { class: 'timer__info', id: `${scope}-timer-info` });
  const timerWrap = el('div', { class: 'timer' }, timerButton, timerInfo);
  timerButton.addEventListener('click', () => toggleTimer(scope, timerButton, timerInfo));

  const fields = drill.fields.map((spec) => fieldRow(spec, scope, block, spec.timer ? timerWrap : null));

  const removeBtn =
    total > 1
      ? el('button', {
          class: 'btn btn--icon',
          type: 'button',
          'aria-label': `Remove drill ${index + 1}`,
          title: 'Remove this drill block',
          text: '×',
          on: {
            click: () => {
              syncDraftFromRefs();
              state.draft.blocks = state.draft.blocks.filter((b) => b.uid !== scope);
              state.timers.delete(scope);
              validateAndPaint();
              renderRecord();
            },
          },
        })
      : null;

  const headerCount = state.draft.blocks.length > 1 ? `Drill ${index + 1} of ${total}` : 'Drill block';

  return el(
    'section',
    { class: 'card block', dataset: { uid: scope } },
    el(
      'header',
      { class: 'block__head' },
      el('div', { class: 'block__title' }, el('span', { class: 'block__count', text: headerCount }), drillSelect),
      removeBtn,
    ),
    el('p', { class: 'block__blurb', text: drill.blurb }),
    el('p', { class: 'block__measures', text: `Measures: ${drill.measures.join(' · ')}` }),
    el('div', { class: 'fields' }, fields),
    el('div', { class: 'block__errors', id: `${scope}-errors`, role: 'alert' }),
    timerNote,
  );
}

function renderRecord() {
  const view = qs('#view-record');
  state.refs.clear();

  const playerInput = el('input', {
    id: 'player',
    class: 'input',
    type: 'text',
    autocomplete: 'off',
    maxlength: '48',
    placeholder: 'e.g. A. Rivera or #14',
    value: state.draft.player,
    list: 'player-list',
    'aria-describedby': 'player-help',
  });
  state.refs.set('player', playerInput);
  playerInput.addEventListener('input', onFieldInput);

  const dateInput = el('input', {
    id: 'date',
    class: 'input',
    type: 'date',
    value: state.draft.date,
    'aria-describedby': 'date-help',
  });
  state.refs.set('date', dateInput);
  dateInput.addEventListener('input', onFieldInput);

  const condNotes = el('input', {
    id: 'condNotes',
    class: 'input',
    type: 'text',
    maxlength: String(CONDITIONS_NOTES_LIMIT),
    placeholder: 'optional — e.g. wind across the pitch',
    value: state.draft.conditions.notes,
    'aria-describedby': 'condNotes-help',
  });
  state.refs.set('condNotes', condNotes);
  condNotes.addEventListener('input', onFieldInput);

  const conditionInputs = CONDITION_FIELDS.map((c) => {
    const id = `cond:${c.key}`;
    const select = el(
      'select',
      { id: 'cond-' + c.key, class: 'input input--select', 'aria-label': c.label },
      el('option', { value: '', text: 'Not recorded', selected: !state.draft.conditions[c.key] }),
      ...c.options.map((o) =>
        el('option', { value: o, text: o, selected: state.draft.conditions[c.key] === o }),
      ),
    );
    state.refs.set(id, select);
    select.addEventListener('change', onFieldInput);
    return el(
      'div',
      { class: 'field field--compact', dataset: { scope: 'cond', key: c.key } },
      el('label', { class: 'field__label', for: id.replace(':', '-'), text: c.label }),
      select,
    );
  });

  const blocks = state.draft.blocks.map((b, i) => blockCard(b, i, state.draft.blocks.length));

  const form = el(
    'form',
    {
      id: 'session-form',
      class: 'form',
      novalidate: true,
      on: {
        submit: (e) => {
          e.preventDefault();
          saveSession();
        },
      },
    },
    el('h2', { class: 'view__title', text: 'Record a session' }),
    el('p', {
      class: 'view__hint',
      text: 'One session = one date with the player. Add a block for each drill you ran that day.',
    }),

    el(
      'section',
      { class: 'card' },
      el('div', { class: 'field', dataset: { scope: 'player', key: 'player' } }, el('label', { class: 'field__label', for: 'player', text: 'Player name or ID' }), playerInput, el('p', { class: 'field__help', id: 'player-help', text: 'Name, initials or squad number. The same words group sessions together.' }), el('p', { class: 'field__error', id: 'player-error', role: 'alert' })),
      el('div', { class: 'field', dataset: { scope: 'date', key: 'date' } }, el('label', { class: 'field__label', for: 'date', text: 'Drill date' }), dateInput, el('p', { class: 'field__help', id: 'date-help', text: 'Today is filled in for you.' }), el('p', { class: 'field__error', id: 'date-error', role: 'alert' })),
    ),

    el(
      'section',
      { class: 'card' },
      el('h3', { class: 'card__title', text: 'Drill conditions' }),
      el('div', { class: 'grid grid--2' }, conditionInputs),
      el(
        'div',
        { class: 'field field--compact', dataset: { scope: 'cond', key: 'notes' } },
        el('label', { class: 'field__label', for: 'condNotes', text: 'Conditions notes' }),
        condNotes,
        el('p', { class: 'field__help', id: 'condNotes-help', text: `Optional, up to ${CONDITIONS_NOTES_LIMIT} characters.` }),
        el('p', { class: 'field__error', id: 'condNotes-error', role: 'alert' }),
      ),
    ),

    el('div', { class: 'blocks-head' }, el('h3', { class: 'card__title', text: 'Drills' })),
    el('div', { class: 'blocks', id: 'blocks' }, blocks),

    el('button', {
      class: 'btn btn--ghost btn--add',
      type: 'button',
      text: '+ Add another drill',
      on: {
        click: () => {
          syncDraftFromRefs();
          state.draft.blocks.push(makeBlock(DEFAULT_DRILL_ID));
          validateAndPaint();
          renderRecord();
        },
      },
    }),

    el(
      'div',
      { class: 'savebar' },
      el('p', { class: 'form__status', id: 'form-status', role: 'status' }),
      el('button', { class: 'btn btn--primary btn--save', type: 'submit', id: 'save', text: 'Save session' }),
    ),
  );

  const players = groupByPlayer(repo.sessions()).map((p) => el('option', { value: p.player }));
  const banner = storageOk
    ? null
    : el('p', {
        class: 'banner banner--warn',
        text: 'This browser is blocking local storage. You can still fill the form, but nothing will be saved — try a private window or a different browser.',
      });

  setChildren(view, [banner, form, el('datalist', { id: 'player-list' }, players)]);
  validateAndPaint();
}

function onFieldInput() {
  syncDraftFromRefs();
  validateAndPaint();
}

/** Copy every input back into the draft (always, so a re-render cannot lose work). */
function syncDraftFromRefs() {
  const get = (id) => state.refs.get(id)?.value;
  const val = (id) => (get(id) == null ? '' : String(get(id)));

  if (state.refs.has('player')) state.draft.player = val('player');
  if (state.refs.has('date')) state.draft.date = val('date');
  if (state.refs.has('condNotes')) state.draft.conditions.notes = val('condNotes');
  for (const c of CONDITION_FIELDS) {
    if (state.refs.has(`cond:${c.key}`)) state.draft.conditions[c.key] = val(`cond:${c.key}`);
  }
  for (const block of state.draft.blocks) {
    for (const spec of getDrill(block.drillId).fields) {
      const id = fieldId(block.uid, spec.key);
      if (state.refs.has(id)) block[spec.key] = val(id);
    }
  }
}

/** Validate the draft and repaint every error message + the save button. */
function validateAndPaint() {
  const res = validateSession(state.draft);
  state.errors = res.errors;

  for (const node of document.querySelectorAll('.field__error')) node.textContent = '';
  for (const node of document.querySelectorAll('.field')) node.classList.remove('is-invalid');
  for (const node of document.querySelectorAll('.block__errors')) node.textContent = '';
  for (const input of document.querySelectorAll('.input')) input.removeAttribute('aria-invalid');

  const setError = (errorNodeId, message) => {
    const node = qs(`#${errorNodeId}`);
    if (node) node.textContent = message;
  };

  if (state.errors.player) {
    setError('player-error', state.errors.player);
    const f = document.querySelector('.field[data-scope="player"]');
    if (f) f.classList.add('is-invalid');
    state.refs.get('player')?.setAttribute('aria-invalid', 'true');
  }

  if (state.errors.date) {
    setError('date-error', state.errors.date);
    const f = document.querySelector('.field[data-scope="date"]');
    if (f) f.classList.add('is-invalid');
    state.refs.get('date')?.setAttribute('aria-invalid', 'true');
  }

  if (state.errors.conditions?.notes) {
    setError('condNotes-error', state.errors.conditions.notes);
    const f = document.querySelector('.field[data-scope="cond"][data-key="notes"]');
    if (f) f.classList.add('is-invalid');
    state.refs.get('condNotes')?.setAttribute('aria-invalid', 'true');
  }

  for (const [index, fieldErrors] of Object.entries(state.errors.blocks ?? {})) {
    const block = state.draft.blocks[Number(index)];
    if (!block) continue;
    const cardErrors = [];
    for (const [key, message] of Object.entries(fieldErrors)) {
      const input = state.refs.get(fieldId(block.uid, key));
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        const field = input.closest('.field');
        if (field) {
          field.classList.add('is-invalid');
          const errNode = field.querySelector('.field__error');
          if (errNode) errNode.textContent = message;
        }
      } else {
        cardErrors.push(message);
      }
    }
    const holder = qs(`#${block.uid}-errors`);
    if (holder) byHolderMessages(holder, cardErrors);
  }

  const status = qs('#form-status');
  const save = qs('#save');
  const total = countErrors(state.errors);
  if (total === 0) {
    if (status) {
      status.textContent = `Ready to save · ${state.draft.blocks.length} drill block${state.draft.blocks.length === 1 ? '' : 's'}`;
      status.className = 'form__status form__status--ok';
    }
    if (save) save.disabled = false;
  } else {
    const messages = errorMessages(state.errors);
    if (status) {
      status.textContent = `${total} thing${total === 1 ? '' : 's'} to fix · ${messages[0] ?? ''}`;
      status.className = 'form__status form__status--bad';
    }
    if (save) save.disabled = true;
  }
}

function byHolderMessages(holder, messages) {
  holder.textContent = '';
  for (const m of messages) holder.append(el('p', { text: m }));
}

function saveSession() {
  syncDraftFromRefs();
  const res = validateSession(state.draft);
  state.errors = res.errors;
  if (!res.ok) {
    validateAndPaint();
    const firstInvalid = document.querySelector('.field.is-invalid, .block__errors p');
    firstInvalid?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    toast('Check the highlighted fields before saving.');
    return;
  }

  const saved = repo.addSession(res.value);
  if (!saved) {
    toast('Could not save — browser storage is full or blocked. Export your data and clear old sessions.');
    return;
  }

  const n = res.value.blocks.length;
  toast(`Saved ${n} drill block${n === 1 ? '' : 's'} for ${res.value.player} on ${formatDate(res.value.date)}.`);

  state.draft.blocks = [makeBlock(DEFAULT_DRILL_ID)];
  state.draft.date = todayIso();
  state.timers.clear();
  state.errors = {};
  saveUi();
  renderRecord();
}

/* ------------------------------------------------------------------ timer */

function toggleTimer(scope, button, infoNode) {
  const timer = state.timers.get(scope) ?? { running: false, startedAt: 0, samples: [] };
  state.timers.set(scope, timer);

  if (!timer.running) {
    timer.running = true;
    timer.startedAt = performance.now();
    button.textContent = 'Stop';
    button.classList.add('is-running');
    infoNode.textContent = 'running…';
    return;
  }

  timer.running = false;
  button.textContent = 'Time a rep';
  button.classList.remove('is-running');
  const seconds = Math.round((performance.now() - timer.startedAt) / 10) / 100;
  if (seconds >= 0.05 && seconds <= 20) timer.samples.push(seconds);

  const mean = timer.samples.length ? timer.samples.reduce((a, b) => a + b, 0) / timer.samples.length : null;
  const fieldKey = `responseS`;
  const input = state.refs.get(fieldId(scope, fieldKey));
  if (input && mean != null) {
    input.value = mean.toFixed(2);
    syncDraftFromRefs();
  }
  infoNode.textContent = timer.samples.length ? `${timer.samples.length} rep${timer.samples.length === 1 ? '' : 's'}` : '';
  const note = state.refs.get(`${scope}:note`);
  if (note) {
    note.textContent = timer.samples.length
      ? `${timer.samples.length} timed rep${timer.samples.length === 1 ? '' : 's'} · mean ${mean.toFixed(2)} s${
          timer.samples.length > 1 ? ` (fastest ${Math.min(...timer.samples).toFixed(2)} s)` : ''
        }`
      : '';
  }
  validateAndPaint();
}

/* ---------------------------------------------------------------- history */

function playerSelect(current, onchange, { allLabel = 'All players' } = {}) {
  const players = groupByPlayer(repo.sessions());
  const select = el(
    'select',
    { class: 'input input--select', 'aria-label': 'Player', on: { change: (e) => onchange(e.target.value) } },
    el('option', { value: '', text: allLabel, selected: !current }),
    ...players.map((p) =>
      el('option', {
        value: p.key,
        text: `${p.player} (${p.sessions.length})`,
        selected: p.key === current,
      }),
    ),
  );
  return select;
}

function summaryCard(sessions, playerName) {
  const rows = sessions.map((s) => ({ session: s, d: deriveSession(s) }));
  const withIndex = rows.filter((r) => r.d.index != null);
  const latest = withIndex[withIndex.length - 1];
  const previous = withIndex.length > 1 ? withIndex[withIndex.length - 2] : null;
  const delta = latest && previous ? latest.d.index - previous.d.index : null;
  const deltaInfo = delta == null ? null : formatDelta(delta, 1, true);

  const stats = [
    ['Sessions', String(sessions.length)],
    ['First', sessions.length ? formatDate(sessions[0].date) : '—'],
    ['Latest', sessions.length ? formatDate(sessions[sessions.length - 1].date) : '—'],
    ['Drills used', String(drillsUsed(sessions).length)],
    ['Latest drill index', latest ? fmt(latest.d.index, 1) : '—'],
    [
      'Change vs previous',
      deltaInfo ? `${deltaInfo.text}` : '—',
    ],
  ];

  return el(
    'section',
    { class: 'card summary' },
    el('h3', { class: 'card__title', text: playerName ? `${playerName} — at a glance` : 'All players — at a glance' }),
    el(
      'dl',
      { class: 'stats' },
      ...stats.flatMap(([label, value]) => [
        el('dt', { text: label }),
        el('dd', { text: value, class: label === 'Change vs previous' && deltaInfo ? `delta delta--${deltaInfo.dir > 0 ? 'up' : deltaInfo.dir < 0 ? 'down' : 'flat'}` : '' }),
      ]),
    ),
  );
}

function sessionCard(session) {
  const d = deriveSession(session);
  const conditions = [
    session.conditions?.surface,
    session.conditions?.light,
    session.conditions?.weather,
    session.conditions?.ball,
  ].filter(Boolean);

  const header = el(
    'header',
    { class: 'session__head' },
    el(
      'div',
      {},
      el('strong', { text: formatDate(session.date) }),
      el('span', { class: 'session__player', text: session.player }),
    ),
    el(
      'div',
      { class: 'session__right' },
      d.index == null ? null : el('span', { class: 'pill', title: 'Within-session summary of the measures below', text: `Index ${fmt(d.index, 1)}` }),
      el('button', {
        class: 'btn btn--icon',
        type: 'button',
        text: '×',
        'aria-label': `Delete the session on ${session.date} for ${session.player}`,
        title: 'Delete this session',
        on: {
          click: () => {
            if (!window.confirm(`Delete the ${formatDate(session.date)} session for ${session.player}? This cannot be undone.`)) return;
            repo.deleteSession(session.id);
            toast('Session deleted.');
            render();
          },
        },
      }),
    ),
  );

  const table = el(
    'div',
    { class: 'tablewrap' },
    el(
      'table',
      { class: 'table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { text: 'Drill' }),
          el('th', { text: 'Correct' }),
          el('th', { text: 'Missed' }),
          el('th', { text: 'Response' }),
          el('th', { text: 'Scans/min' }),
          el('th', { text: 'Passes' }),
          el('th', { text: 'Index' }),
        ),
      ),
      el(
        'tbody',
        {},
        ...d.blocks.map(({ block, m }) =>
          el(
            'tr',
            {},
            el('td', { text: block.drillId === 'custom' && block.name ? block.name : m.drillShort }),
            el('td', { text: m.accuracyPct == null ? '—' : `${pctText(m.accuracyPct, 0)} (${block.correct}/${block.opportunities})` }),
            el('td', { text: m.missed == null ? '—' : String(m.missed) }),
            el('td', { text: block.responseS == null ? '—' : `${fmt(block.responseS, 2)} s` }),
            el('td', { text: m.scansPerMin == null ? '—' : fmt(m.scansPerMin, 1) }),
            el('td', { text: m.passPct == null ? '—' : `${pctText(m.passPct, 0)} (${block.passesCompleted}/${block.passesAttempted})` }),
            el('td', { text: fmt(m.index, 1) }),
          ),
        ),
      ),
    ),
  );

  const notes = (session.blocks ?? []).filter((b) => b.notes);
  const foot = el(
    'footer',
    { class: 'session__foot' },
    conditions.length ? el('div', { class: 'chips' }, ...conditions.map((c) => el('span', { class: 'chip', text: c }))) : null,
    session.conditions?.notes ? el('p', { class: 'muted', text: session.conditions.notes }) : null,
    notes.length
      ? el('ul', { class: 'notelist' }, ...notes.map((b) => el('li', { text: `${getDrill(b.drillId).short}: ${b.notes}` })))
      : null,
    el('p', {
      class: 'muted',
      text: `${fmt(d.durationMin, 1)} min tracked · ${d.opportunities ?? '—'} chances · ${d.scans ?? '—'} scans`,
    }),
  );

  return el('article', { class: 'card session', dataset: { sessionId: session.id } }, header, table, foot);
}

function emptyState(title, body, actionLabel, action) {
  return el(
    'section',
    { class: 'card empty' },
    el('h3', { class: 'card__title', text: title }),
    el('p', { text: body }),
    actionLabel ? el('button', { class: 'btn btn--primary', type: 'button', text: actionLabel, on: { click: action } }) : null,
  );
}

function renderHistory() {
  const view = qs('#view-history');
  const all = repo.sessions();
  const players = groupByPlayer(all);

  if (!all.length) {
    setChildren(view, [
      el('h2', { class: 'view__title', text: 'Previous results' }),
      emptyState(
        'No sessions yet',
        'Record a session first — then every repeat of a drill shows up here, with the change since the last time.',
        'Go to Record',
        () => setView('record'),
      ),
    ]);
    return;
  }

  if (state.playerFilter && !players.some((p) => p.key === state.playerFilter)) state.playerFilter = '';
  const selected = players.find((p) => p.key === state.playerFilter);
  const sessions = selected ? selected.sessions : all;
  const ordered = [...sessions].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)),
  );

  setChildren(view, [
    el('h2', { class: 'view__title', text: 'Previous results' }),
    el(
      'section',
      { class: 'card' },
      el('div', { class: 'field field--compact' }, el('label', { class: 'field__label', text: 'Player' }), playerSelect(state.playerFilter, (v) => {
        state.playerFilter = v;
        if (v) state.compare.player = v;
        render();
      })),
      el('p', { class: 'view__hint', text: `${ordered.length} session${ordered.length === 1 ? '' : 's'}${selected ? '' : ' across all players'}, oldest first below the summary.` }),
      el(
        'div',
        { class: 'row row--wrap' },
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          text: 'Export CSV',
          on: {
            click: () => {
              const scope = selected ? selected.player : 'all-players';
              download(csvFileName(scope), '\uFEFF' + toCsv(ordered), 'text/csv;charset=utf-8');
              toast(`Exported ${ordered.length} sessions as CSV.`);
            },
          },
        }),
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          text: 'Copy text summary',
          on: { click: () => copyText(toTextSummary(ordered.slice(-5), selected?.player)) },
        }),
      ),
    ),
    summaryCard(ordered, selected?.player),
    el('div', { class: 'sessions' }, ...ordered.slice().reverse().map(sessionCard)),
  ]);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Summary copied to the clipboard.');
  } catch {
    download('pitchvision-summary.txt', text);
    toast('Clipboard blocked — downloaded a text file instead.');
  }
}

/* ---------------------------------------------------------------- compare */

function round2(n) {
  return Math.round(n * 100) / 100;
}

function chartSvg(points, metric) {
  const W = 340;
  const H = 150;
  const PAD = { t: 16, r: 12, b: 26, l: 44 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const values = valuesOf(points);
  const scaled = scalePoints(values, { width: iw, height: ih });
  const measured = values.filter((v) => v != null);

  if (!measured.length) {
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="No data recorded for this measure">
      <text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="chart__empty">No values recorded for this measure yet</text>
    </svg>`;
  }

  const min = Math.min(...measured);
  const max = Math.max(...measured);
  const dots = scaled
    .map((p, i) =>
      p
        ? `<circle cx="${PAD.l + p.x}" cy="${PAD.t + p.y}" r="3.2" class="chart__dot"><title>${points[i].date}: ${fmt(p.value, metric.digits)}</title></circle>`
        : '',
    )
    .join('');
  const offset = scaled.map((pt) => (pt ? { x: round2(PAD.l + pt.x), y: round2(PAD.t + pt.y) } : null));
  const route = sparkPath(offset);
  const labels = [
    min === max ? `${fmt(min, metric.digits)}` : `${fmt(max, metric.digits)}`,
    min === max ? '' : `${fmt(min, metric.digits)}`,
  ];

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Trend of ${metric.label} across sessions">
    <line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l + iw}" y2="${PAD.t}" class="chart__grid" />
    <line x1="${PAD.l}" y1="${PAD.t + ih}" x2="${PAD.l + iw}" y2="${PAD.t + ih}" class="chart__grid" />
    <text x="${PAD.l - 6}" y="${PAD.t + 4}" text-anchor="end" class="chart__tick">${labels[0]}</text>
    ${labels[1] ? `<text x="${PAD.l - 6}" y="${PAD.t + ih + 4}" text-anchor="end" class="chart__tick">${labels[1]}</text>` : ''}
    ${route ? `<path d="${route}" class="chart__line" />` : ''}
    ${dots}
    <text x="${PAD.l}" y="${H - 8}" class="chart__tick">${formatDate(points.find((p) => p)?.date)}</text>
    <text x="${PAD.l + iw}" y="${H - 8}" text-anchor="end" class="chart__tick">${formatDate([...points].reverse().find((p) => p)?.date)}</text>
  </svg>`;
}

function renderCompare() {
  const view = qs('#view-compare');
  const all = repo.sessions();
  const players = groupByPlayer(all);

  if (!all.length) {
    setChildren(view, [
      el('h2', { class: 'view__title', text: 'Compare sessions' }),
      emptyState('Nothing to compare yet', 'Log at least two sessions of the same drill and the trend appears here.', 'Go to Record', () => setView('record')),
    ]);
    return;
  }

  if (!players.some((p) => p.key === state.compare.player)) state.compare.player = players[0].key;
  const sessions = players.find((p) => p.key === state.compare.player)?.sessions ?? [];
  const used = drillsUsed(sessions);
  if (!used.includes(state.compare.drill)) state.compare.drill = used[0];
  const metric = getMetric(state.compare.metric);
  const drill = getDrill(state.compare.drill);
  const points = seriesFor(all, state.compare.player, drill.id, metric.key, deriveBlock);
  const withValues = points.filter((p) => p.value != null);
  const sum = summariseSeries(points);
  const playerName = players.find((p) => p.key === state.compare.player)?.player ?? '';

  const valueText = (v) => (v == null ? '—' : `${fmt(v, metric.digits)}${metric.key === 'accuracyPct' || metric.key === 'passPct' ? '%' : metric.key === 'responseS' ? ' s' : ''}`);

  const deltaCell = (value, index) => {
    if (value == null) return '—';
    const earlier = points.slice(0, index).map((p) => p.value).filter((v) => v != null);
    if (!earlier.length) return '<span class="delta delta--flat">first</span>';
    const info = formatDelta(value - earlier[earlier.length - 1], metric.digits, metric.higherIsBetter);
    return `<span class="delta delta--${info.dir > 0 ? 'up' : info.dir < 0 ? 'down' : 'flat'}">${info.text}</span>`;
  };

  const table = el(
    'div',
    { class: 'tablewrap' },
    el(
      'table',
      { class: 'table' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Date' }), el('th', { text: metric.label }), el('th', { text: 'Change' }))),
      el(
        'tbody',
        {},
        ...points.map((p, i) =>
          el(
            'tr',
            { class: p.value == null ? 'is-empty' : '' },
            el('td', { text: formatDate(p.date) }),
            el('td', { text: valueText(p.value) }),
            el('td', { html: deltaCell(p.value, i) }),
          ),
        ),
      ),
    ),
  );

  const deltaPrevInfo = sum.deltaPrev == null ? null : formatDelta(sum.deltaPrev, metric.digits, metric.higherIsBetter);
  const deltaFirstInfo = sum.deltaFirst == null ? null : formatDelta(sum.deltaFirst, metric.digits, metric.higherIsBetter);

  const stats = el(
    'dl',
    { class: 'stats' },
    ...[
      ['Sessions with this drill', String(sum.measured)],
      ['First', sum.first == null ? '—' : valueText(sum.first)],
      ['Latest', sum.last == null ? '—' : valueText(sum.last)],
      ['Best', sum.best == null ? '—' : valueText(sum.best)],
      ['Mean', sum.mean == null ? '—' : valueText(sum.mean)],
      ['Change since first', deltaFirstInfo ? deltaFirstInfo.text : '—'],
      ['Change vs previous', deltaPrevInfo ? deltaPrevInfo.text : '—'],
    ].flatMap(([label, value]) => [
      el('dt', { text: label }),
      el('dd', {
        text: value,
        class: label.startsWith('Change') && (deltaPrevInfo || deltaFirstInfo) ? `delta delta--${(label === 'Change vs previous' ? deltaPrevInfo : deltaFirstInfo).dir > 0 ? 'up' : (label === 'Change vs previous' ? deltaPrevInfo : deltaFirstInfo).dir < 0 ? 'down' : 'flat'}` : '',
      }),
    ]),
  );

  const perDrill = used.map((id) => {
    const d = getDrill(id);
    const series = seriesFor(all, state.compare.player, d.id, 'index', deriveBlock);
    const s = summariseSeries(series);
    const info = s.deltaPrev == null ? null : formatDelta(s.deltaPrev, 1, true);
    return el(
      'tr',
      {},
      el('td', { text: d.short }),
      el('td', { text: String(s.measured) }),
      el('td', { text: s.first == null ? '—' : fmt(s.first, 1) }),
      el('td', { text: s.last == null ? '—' : fmt(s.last, 1) }),
      el('td', { html: info ? `<span class="delta delta--${info.dir > 0 ? 'up' : info.dir < 0 ? 'down' : 'flat'}">${info.text}</span>` : '—' }),
    );
  });

  setChildren(view, [
    el('h2', { class: 'view__title', text: 'Compare sessions' }),
    el(
      'section',
      { class: 'card' },
      el('div', { class: 'grid grid--2' },
        el('div', { class: 'field field--compact' }, el('label', { class: 'field__label', text: 'Player' }), playerSelect(state.compare.player, (v) => {
          state.compare.player = v;
          saveUi();
          render();
        }, { allLabel: 'Pick a player' })),
        el('div', { class: 'field field--compact' }, el('label', { class: 'field__label', text: 'Drill' }), el('select', {
          class: 'input input--select',
          'aria-label': 'Drill',
          on: {
            change: (e) => {
              state.compare.drill = e.target.value;
              saveUi();
              render();
            },
          },
        }, ...used.map((id) => el('option', { value: id, text: getDrill(id).name, selected: id === state.compare.drill })))),
      ),
      el('div', { class: 'field field--compact' }, el('label', { class: 'field__label', text: 'Measure' }), el('select', {
        class: 'input input--select',
        'aria-label': 'Measure',
        on: {
          change: (e) => {
            state.compare.metric = e.target.value;
            saveUi();
            render();
          },
        },
      }, ...METRICS.map((m) => el('option', { value: m.key, text: m.label, selected: m.key === metric.key })))),
      el('p', { class: 'view__hint', text: `${playerName} · ${drill.name} · ${sessions.length} session${sessions.length === 1 ? '' : 's'} logged` }),
    ),
    el('section', { class: 'card' }, el('h3', { class: 'card__title', text: `${metric.label} over time` }), el('div', { class: 'chartwrap', html: chartSvg(points, metric) }), stats),
    el('section', { class: 'card' }, el('h3', { class: 'card__title', text: 'Session by session' }), table),
    el(
      'section',
      { class: 'card' },
      el('h3', { class: 'card__title', text: 'Every drill, latest index' }),
      el('div', { class: 'tablewrap' }, el('table', { class: 'table' }, el('thead', {}, el('tr', {}, el('th', { text: 'Drill' }), el('th', { text: 'Sessions' }), el('th', { text: 'First' }), el('th', { text: 'Latest' }), el('th', { text: 'Change' }))), el('tbody', {}, ...perDrill))),
    ),
  ]);
}

/* ------------------------------------------------------------------- more */

function helpSection() {
  return el(
    'section',
    { class: 'card', id: 'help' },
    el('h3', { class: 'card__title', text: 'Running this app' }),
    el('ul', { class: 'list' },
      el('li', { html: '<strong>On the pitch:</strong> open the page on your phone, then use Share → <em>Add to Home Screen</em> so it opens like an app. It works with no signal once loaded.' }),
      el('li', { html: '<strong>On this machine:</strong> run <code>npm start</code> (or <code>node tools/serve.mjs</code>) in the project folder and open <code>http://localhost:8080</code>. Any static file server works too.' }),
      el('li', { html: '<strong>Where the data lives:</strong> this browser, on this device. There are no accounts and nothing is uploaded. Export a JSON back-up in the Data card before switching device, browser or clearing site data.' }),
      el('li', { html: '<strong>Repeat the same drill the same way.</strong> The comparison is only as good as the consistency of the setup: same corridor length, same cue set, same observer where you can.' }),
    ),
    el('h3', { class: 'card__title', text: 'How to read the numbers' }),
    el('ul', { class: 'list' },
      el('li', { html: '<strong>Accuracy</strong> — correct answers ÷ cues shown.' }),
      el('li', { html: '<strong>Missed</strong> — cues shown minus correct answers, worked out for you.' }),
      el('li', { html: '<strong>Scans per minute</strong> — head scans divided by the block duration, so short and long blocks compare fairly.' }),
      el('li', { html: '<strong>Drill index (0–100)</strong> — a within-session summary: accuracy 50%, response time 30%, scanning 20%, with the weights re-balanced when a measure was not recorded. It is a coaching summary of the drill, not a clinical score.' }),
    ),
  );
}

function drillsSection() {
  return el(
    'section',
    { class: 'card' },
    el('h3', { class: 'card__title', text: 'The drills' }),
    ...DRILLS.map((d) =>
      el(
        'details',
        { class: 'drill-help' },
        el('summary', { text: d.name }),
        el('p', { class: 'muted', text: d.blurb }),
        el('ol', { class: 'list list--num' }, ...d.protocol.map((line) => el('li', { text: line }))),
        el('p', { class: 'muted', text: `Measures: ${d.measures.join(' · ')}` }),
      ),
    ),
  );
}

function dataSection() {
  const sessions = repo.sessions();
  const status = repo.status();
  const importInput = el('input', {
    type: 'file',
    accept: '.json,application/json',
    id: 'import-json',
    class: 'file',
    on: {
      change: async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const text = await file.text();
        const res = repo.importJson(text);
        if (!res.ok) {
          toast(res.error ?? 'That file could not be read.');
        } else {
          const skipped = res.skipped.length ? `, ${res.skipped.length} skipped` : '';
          toast(`Imported ${res.sessions.length} session${res.sessions.length === 1 ? '' : 's'} (${res.added} new${skipped}).`);
          render();
        }
        e.target.value = '';
      },
    },
  });

  return el(
    'section',
    { class: 'card', id: 'data' },
    el('h3', { class: 'card__title', text: 'Data' }),
    el('p', {
      class: 'muted',
      text: `${status.count} session${status.count === 1 ? '' : 's'} stored in this browser${storageOk ? '' : ' (storage unavailable — nothing is being kept)'}${
        status.error === 'unreadable' ? ' — the saved data could not be read and was ignored' : ''
      }${status.error === 'newer' ? ' — saved data comes from a newer version of the app' : ''}.`,
    }),
    el('div', { class: 'row row--wrap' },
      el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        text: 'Export JSON back-up',
        on: {
          click: () => {
            download(`pitchvision-backup-${todayIso()}.json`, repo.exportJson(sessions), 'application/json');
            toast('Back-up downloaded. Keep it with your team files.');
          },
        },
      }),
      el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        text: 'Export all as CSV',
        on: {
          click: () => {
            download(csvFileName('all-players'), '\uFEFF' + toCsv(sessions), 'text/csv;charset=utf-8');
            toast('CSV downloaded.');
          },
        },
      }),
      el('label', { class: 'btn btn--ghost', for: 'import-json', text: 'Import JSON back-up' }),
      el('button', {
        class: 'btn btn--ghost btn--danger',
        type: 'button',
        text: 'Delete everything',
        on: {
          click: () => {
            if (!window.confirm('Delete every session stored in this browser? Export a back-up first if you want to keep them.')) return;
            repo.clear();
            toast('All sessions deleted.');
            render();
          },
        },
      }),
    ),
    importInput,
    el('p', { class: 'muted', text: 'Imports merge with what is already here; a record with the same ID replaces the stored one.' }),
  );
}

function renderMore() {
  const view = qs('#view-more');
  setChildren(view, [
    el('h2', { class: 'view__title', text: 'Help, data and notes' }),
    helpSection(),
    drillsSection(),
    dataSection(),
    el(
      'section',
      { class: 'card' },
      el('h3', { class: 'card__title', text: 'Appearance' }),
      el('div', { class: 'row' },
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          text: state.theme === 'dark' ? 'Switch to light' : 'Switch to dark',
          on: {
            click: () => {
              state.theme = state.theme === 'dark' ? 'light' : 'dark';
              applyTheme();
              saveUi();
              render();
            },
          },
        }),
      ),
    ),
    el(
      'section',
      { class: 'card note' },
      el('h3', { class: 'card__title', text: 'What this is — and what it is not' }),
      el('p', { text: DISCLAIMER_LONG }),
    ),
    el(
      'section',
      { class: 'card' },
      el('h3', { class: 'card__title', text: 'About' }),
      el('p', { class: 'muted', text: `${APP_NAME} v${STORAGE_VERSION}.0 — ${APP_TAGLINE}. Plain HTML, CSS and JavaScript; no framework, no build step, no server and no accounts. Sessions are kept in this browser only.` }),
    ),
  ]);
}

/* ------------------------------------------------------------------- init */

function init() {
  state.draft = blankDraft();
  loadUi();
  applyTheme();

  qs('.foot__note').textContent = DISCLAIMER_SHORT;
  qs('#appTitle').textContent = APP_NAME;
  qs('#appSub').textContent = APP_TAGLINE;
  document.title = `${APP_NAME} — ${APP_TAGLINE}`;

  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  }
  qs('#helpBtn').addEventListener('click', () => setView('more'));

  render();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

export { repo, state, saveSession, init };
