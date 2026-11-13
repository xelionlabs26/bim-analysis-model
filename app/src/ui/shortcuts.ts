/**
 * The page's keyboard shortcuts, in one table: main.ts dispatches the letter
 * and arrow keys from KEY_ACTIONS, and the shortcut sheet (the ? key and the
 * help button) is written from SHORTCUT_GROUPS, so the sheet lists the keys
 * the page really answers and nothing else. Keys are KeyboardEvent.key in
 * lower case, as main.ts reads them.
 */

/** What a page shortcut does; main.ts holds one handler for each. */
export type ActionId =
  | 'play'
  | 'rebuild'
  | 'rotate'
  | 'colour'
  | 'frame'
  | 'speed'
  | 'view'
  | 'ghost'
  | 'crane'
  | 'cranePlan'
  | 'section'
  | 'import'
  | 'nextIssue'
  | 'prevIssue'
  | 'stepBack'
  | 'stepOn'
  | 'start'
  | 'present'
  | 'help';

/** The page's own keys (from the page, the model or a focused button), each with its action. */
export const KEY_ACTIONS: Readonly<Record<string, ActionId>> = {
  ' ': 'play',
  r: 'rebuild',
  a: 'rotate',
  c: 'colour',
  x: 'frame',
  f: 'speed',
  v: 'view',
  g: 'ghost',
  k: 'crane',
  l: 'cranePlan',
  s: 'section',
  i: 'import',
  ']': 'nextIssue',
  '[': 'prevIssue',
  arrowleft: 'stepBack',
  arrowright: 'stepOn',
  home: 'start',
  p: 'present',
  '?': 'help',
};

/** The action for a key (KeyboardEvent.key in lower case), or null: only the table's own keys, never an inherited name. */
export function keyAction(key: string): ActionId | null {
  return Object.prototype.hasOwnProperty.call(KEY_ACTIONS, key) ? KEY_ACTIONS[key] : null;
}

/** One line of the sheet: the keys as printed, what they do, and the action they run when it is one of KEY_ACTIONS. */
export interface ShortcutRow {
  keys: string[];
  text: string;
  action?: ActionId;
}

export interface ShortcutGroup {
  title: string;
  /** Said under the title: where the keys work, when it is not everywhere. */
  note?: string;
  rows: ShortcutRow[];
}

/** The rail items the number keys open, in order (main.ts RAIL). */
export const RAIL_KEY_NAMES = ['Model', 'Layers', 'Parts', 'Section', 'Render', 'Settings', 'Import'];

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Playback',
    rows: [
      { keys: ['Space'], text: 'Play or pause', action: 'play' },
      { keys: ['R'], text: 'Play the build from the start', action: 'rebuild' },
      { keys: ['←', '→'], text: 'Previous or next step', action: 'stepBack' },
      { keys: ['Home'], text: 'Back to the start', action: 'start' },
      { keys: ['F'], text: 'Playback speed: ×1, ×2, ×4', action: 'speed' },
    ],
  },
  {
    title: 'View',
    rows: [
      { keys: ['C'], text: 'Material colours', action: 'colour' },
      { keys: ['G'], text: 'Show unbuilt parts as ghost lines', action: 'ghost' },
      { keys: ['K'], text: 'Show the crane', action: 'crane' },
      { keys: ['L'], text: 'Crane plan: the reach from above', action: 'cranePlan' },
      { keys: ['S'], text: 'Cut the model in section', action: 'section' },
      { keys: ['A'], text: 'Turn the model slowly', action: 'rotate' },
      { keys: ['X'], text: 'Keep the model framed', action: 'frame' },
      { keys: ['V'], text: 'Next view', action: 'view' },
      { keys: ['P'], text: 'Presentation view on or off', action: 'present' },
    ],
  },
  {
    title: 'Issues and panels',
    rows: [
      { keys: [']', '['], text: 'Next or previous issue', action: 'nextIssue' },
      { keys: ['Esc'], text: 'Close a drawer, dismiss a banner or let go of an issue' },
      { keys: ['I'], text: 'Import an IFC file', action: 'import' },
      { keys: ['1', '–', '7'], text: `Open ${RAIL_KEY_NAMES.join(', ')}` },
      { keys: ['Shift', 'D'], text: 'Performance overlay' },
      { keys: ['?'], text: 'This list', action: 'help' },
    ],
  },
  {
    title: 'On the timeline',
    note: 'When the timeline has the focus',
    rows: [
      { keys: ['←', '→'], text: 'Previous or next step' },
      { keys: ['PgDn', 'PgUp'], text: 'Previous or next stage' },
      { keys: ['Home', 'End'], text: 'Start or end' },
    ],
  },
  {
    title: 'On the panel tabs',
    note: 'When a tab has the focus',
    rows: [{ keys: ['←', '→'], text: 'Move between Sequence, Members and Issues' }],
  },
];

/** The keys of a row as one string, for a screen reader or a test ("Shift D", "] [", "1 – 7"). */
export const rowKeys = (r: ShortcutRow) => r.keys.join(' ');

/** Each action's row, so the sheet can be checked against KEY_ACTIONS: an action with no row, or a row for no key, is an error. */
export function sheetActions(groups: ShortcutGroup[] = SHORTCUT_GROUPS): Set<ActionId> {
  const out = new Set<ActionId>();
  for (const g of groups) for (const r of g.rows) if (r.action) out.add(r.action);
  // a row may name one of a pair (← for ← and →, ] for ] and [): its partner counts too
  const pairs: [ActionId, ActionId][] = [['stepBack', 'stepOn'], ['nextIssue', 'prevIssue']];
  for (const [a, b] of pairs) if (out.has(a) || out.has(b)) (out.add(a), out.add(b));
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const KEY_NAMES: Record<string, string> = { '←': 'Left arrow', '→': 'Right arrow', Esc: 'Escape', PgDn: 'Page down', PgUp: 'Page up', '–': 'to' };

/** The sheet's body: a definition list per group, each key in a <kbd> (a dash between keys is a range, not a key). */
export function shortcutSheetHtml(groups: ShortcutGroup[] = SHORTCUT_GROUPS): string {
  const key = (k: string) => (k === '–' ? '<span class="to">–</span>' : `<kbd${KEY_NAMES[k] ? ` aria-label="${KEY_NAMES[k]}"` : ''}>${esc(k)}</kbd>`);
  return groups
    .map(
      (g) =>
        `<section class="keys-group"><h3>${esc(g.title)}</h3>${g.note ? `<p class="keys-note">${esc(g.note)}</p>` : ''}<dl>${g.rows
          .map((r) => `<dt>${r.keys.map(key).join(' ')}</dt><dd>${esc(r.text)}</dd>`)
          .join('')}</dl></section>`,
    )
    .join('');
}
