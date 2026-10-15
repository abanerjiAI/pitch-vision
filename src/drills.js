/**
 * PitchVision — drill catalog.
 *
 * Every measure the app stores is declared here, once. The entry form, the
 * validation layer, the derived metrics and the comparison views all read this
 * file, so they cannot drift apart.
 *
 * Nothing in this app measures eyesight and nothing here is a clinical
 * instrument. The numbers describe what happened in a drill on a given day.
 */

export const STORAGE_VERSION = 1;
export const APP_NAME = 'PitchVision';
export const APP_TAGLINE = 'Functional vision drill tracker';

/** Short note shown under every data view. */
export const DISCLAIMER_SHORT =
  'Drill performance only — not a medical or vision diagnosis.';

/** Full note: shown in Help, in the README and on the showcase page. */
export const DISCLAIMER_LONG =
  'PitchVision records how a player performs in the drills described in this app, on the day they were run. ' +
  'The results describe drill performance only. This is not a medical diagnosis, it does not measure eyesight ' +
  'or screen for vision problems, and it is not a substitute for an eye-care assessment. ' +
  'If a player or a parent is worried about vision, refer them to an optometrist or an ophthalmologist.';

/* ------------------------------------------------------------------ fields */

/**
 * Field specs. `kind` drives parsing and the on-screen keyboard:
 *   int      whole number  (inputmode="numeric")
 *   decimal  number        (inputmode="decimal")
 *   text     short string
 * A drill may override any label/help while borrowing the spec.
 */
export const FIELD = {
  opportunities: {
    key: 'opportunities',
    label: 'Cues shown',
    short: 'Cues shown',
    kind: 'int',
    min: 1,
    max: 500,
    required: true,
    help: 'Every cue the player was shown during this block.',
  },
  correct: {
    key: 'correct',
    label: 'Cues correctly called',
    short: 'Correct',
    kind: 'int',
    min: 0,
    max: 500,
    required: true,
    help: 'Cues the player called correctly. Missed cues are worked out from this.',
  },
  responseS: {
    key: 'responseS',
    label: 'Mean response time',
    short: 'Response',
    unit: 's',
    kind: 'decimal',
    min: 0.05,
    max: 20,
    required: true,
    timer: true,
    help: 'Average gap between the cue and the player\'s answer, in seconds. Time a few reps with the button and the mean is filled in for you.',
  },
  scans: {
    key: 'scans',
    label: 'Head scans counted',
    short: 'Scans',
    kind: 'int',
    min: 0,
    max: 500,
    required: false,
    help: 'Checks over either shoulder while the drill ran. Leave blank if you did not count them.',
  },
  passesAttempted: {
    key: 'passesAttempted',
    label: 'Passes attempted',
    short: 'Passes',
    kind: 'int',
    min: 0,
    max: 500,
    required: false,
    help: 'Optional: passes played after the decision.',
  },
  passesCompleted: {
    key: 'passesCompleted',
    label: 'Passes completed',
    short: 'Completed',
    kind: 'int',
    min: 0,
    max: 500,
    required: false,
    help: 'Optional: of those passes, the ones that reached a team-mate.',
  },
  durationMin: {
    key: 'durationMin',
    label: 'Block duration',
    short: 'Duration',
    unit: 'min',
    kind: 'decimal',
    min: 0.5,
    max: 180,
    required: true,
    help: 'How long this drill block ran, in minutes.',
  },
  name: {
    key: 'name',
    label: 'Drill name',
    short: 'Drill',
    kind: 'text',
    maxLength: 40,
    required: true,
    help: 'What you called this drill.',
  },
  notes: {
    key: 'notes',
    label: 'Block notes',
    short: 'Notes',
    kind: 'text',
    maxLength: 140,
    required: false,
    help: 'One short line, e.g. "dribbled left foot only".',
  },
};

/* ---------------------------------------------------------------- sessions */

/** Session-level drill conditions. All optional, all short. */
export const CONDITION_FIELDS = [
  { key: 'surface', label: 'Surface', options: ['Grass', 'Turf (3G)', 'Indoor', 'Other'] },
  { key: 'light', label: 'Light', options: ['Daylight', 'Dusk', 'Floodlit', 'Indoor'] },
  { key: 'weather', label: 'Weather', options: ['Dry', 'Wet', 'Windy', 'Hot', 'Cold'] },
  { key: 'ball', label: 'Ball', options: ['Size 4', 'Size 5', 'Futsal', 'Other'] },
];

export const CONDITIONS_NOTES_LIMIT = 140;

/* ------------------------------------------------------------------ drills */

const step = (...lines) => lines;

export const DRILLS = [
  {
    id: 'peripheral-cue',
    name: 'Peripheral Cue ID (dribbling)',
    short: 'Peripheral cue ID',
    blurb:
      'The player dribbles a set corridor and calls out cues shown in the edge of their vision, without turning their head.',
    measures: ['Cue accuracy', 'Response time', 'Missed cues', 'Head scans'],
    parResponseS: 0.8,
    scanTargetPerMin: 6,
    fields: [
      { ...FIELD.opportunities, label: 'Cues shown' },
      { ...FIELD.correct, label: 'Cues correctly called' },
      { ...FIELD.responseS, label: 'Mean response time' },
      { ...FIELD.scans, label: 'Head scans counted' },
      { ...FIELD.durationMin },
      { ...FIELD.notes },
    ],
    protocol: step(
      'Mark a 20 m dribbling corridor with gates every 5 m.',
      'An assistant stands 5–8 m ahead and off to the side, holding numbered (1–5) or coloured cues.',
      'The player dribbles the corridor at match pace and calls each cue as it is shown, without turning their head or slowing down.',
      'Count cues shown, correct calls and head scans. Use the tap timer on 3–5 reps to get a mean response time.',
      'Run 8–12 cues per block, then log the block.',
    ),
  },
  {
    id: 'decision-receive',
    name: 'Decision Before Receiving',
    short: 'Decision before receiving',
    blurb:
      'A cue is shown as the ball is served. The player has to call the decision before the first touch and then play it.',
    measures: ['Decision accuracy', 'Decision time', 'Missed cues', 'Pre-receive scans', 'Pass completion'],
    parResponseS: 0.6,
    scanTargetPerMin: 10,
    fields: [
      { ...FIELD.opportunities, label: 'Decision trials' },
      { ...FIELD.correct, label: 'Correct decisions' },
      { ...FIELD.responseS, label: 'Mean decision time', help: 'Average gap between the cue and the player calling the decision.' },
      { ...FIELD.scans, label: 'Pre-receive scans counted', help: 'Checks over either shoulder before the ball arrives.' },
      { ...FIELD.passesAttempted },
      { ...FIELD.passesCompleted },
      { ...FIELD.durationMin },
      { ...FIELD.notes },
    ],
    protocol: step(
      'The player starts 8–10 m from the server and moves towards them.',
      'As the ball is served, a third person shows a direction or colour cue.',
      'The player must call the decision before the first touch, then play the first touch or pass to that side.',
      'Log trials, correct decisions, mean decision time, pre-receive scans, and passes attempted/completed.',
    ),
  },
  {
    id: 'scanning-possession',
    name: 'Scanning & Awareness (small-sided)',
    short: 'Scanning & awareness',
    blurb:
      'In a small-sided game an observer counts the target player\'s head scans and how often the ball action matched what they had seen.',
    measures: ['Scans', 'Good decisions', 'Time to release'],
    parResponseS: 0.7,
    scanTargetPerMin: 12,
    fields: [
      { ...FIELD.opportunities, label: 'Possessions observed' },
      { ...FIELD.correct, label: 'Good decisions on the ball', help: 'Possessions where the player\'s action matched the picture they had scanned.' },
      { ...FIELD.scans, label: 'Scans counted', required: true, help: 'Required for this drill: every check over either shoulder during the block.' },
      { ...FIELD.responseS, label: 'Mean time to release', required: false, help: 'Optional: average time from receiving to releasing the ball, in seconds.' },
      { ...FIELD.durationMin },
      { ...FIELD.notes },
    ],
    protocol: step(
      'Play 4v4 or 5v5 in a 20 × 20 m area with two neutral players.',
      'One observer watches the target player only and counts head scans (a look over either shoulder).',
      'For every possession note whether the ball action matched the picture the player had scanned.',
      'Log possessions observed, good decisions, scans, the block duration, and optionally the mean time to release.',
    ),
  },
  {
    id: 'custom',
    name: 'Other drill',
    short: 'Other',
    blurb: 'Your own repeatable drill. Use the same measures so sessions stay comparable.',
    measures: ['Accuracy', 'Response time', 'Scans'],
    parResponseS: 0.8,
    scanTargetPerMin: 8,
    fields: [
      { ...FIELD.name },
      { ...FIELD.opportunities, label: 'Chances presented' },
      { ...FIELD.correct, label: 'Correct responses' },
      { ...FIELD.responseS, required: false },
      { ...FIELD.scans },
      { ...FIELD.durationMin },
      { ...FIELD.notes },
    ],
    protocol: step(
      'Describe the drill to yourself in the same words every time so the numbers stay comparable.',
      'Count the chances presented, the correct responses and, if it matters for your drill, head scans.',
    ),
  },
];

export const DRILL_BY_ID = Object.fromEntries(DRILLS.map((d) => [d.id, d]));
export const DEFAULT_DRILL_ID = DRILLS[0].id;

export function getDrill(id) {
  return DRILL_BY_ID[id] ?? DRILL_BY_ID[DEFAULT_DRILL_ID];
}

/** Field specs for a drill, resolved against FIELD overrides. */
export function drillFields(drill) {
  return drill.fields;
}

export function fieldSpec(drill, key) {
  return drill.fields.find((f) => f.key === key) ?? null;
}
