/**
 * Who answers a key press: the focused control or the page's shortcuts.
 *
 * The page's shortcuts (Space plays, letters toggle the view) must never take
 * a key that the focused control needs. Space and Enter press a button, tick
 * a checkbox and open a disclosure; a text field, select or range takes every
 * key; the panel tabs move along with the arrow keys; the scrubber is a slider
 * whose arrow, Home, End and Page keys move the sequence. Space plays and
 * pauses only from the page itself, the model or the scrubber.
 */

/** What the router reads from the focused element (a DOM element satisfies it). */
export interface KeyTarget {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute(name: string): string | null;
}

/**
 * - `native`: leave the key to the focused control (no shortcut, no preventDefault).
 * - `tabs`: move along the panel tabs.
 * - `slider`: move the sequence from the scrubber.
 * - `global`: the page's shortcuts.
 */
export type KeyRoute = 'native' | 'tabs' | 'slider' | 'global';

/** Inputs that are pressed rather than typed into. */
const PRESSED_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'color', 'file']);
/** Roles that Space and Enter activate. */
const PRESSED_ROLES = new Set(['button', 'tab', 'checkbox', 'radio', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'link', 'treeitem']);
const TAB_KEYS = new Set(['arrowleft', 'arrowright', 'home', 'end']);
const SLIDER_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', 'pageup', 'pagedown']);

/** Whether the element takes typed text or picks a value with the keyboard (every key is its own). */
export function takesTyping(el: KeyTarget | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select' || el.isContentEditable) return true;
  if (tag === 'input') return !PRESSED_INPUTS.has((el.type ?? 'text').toLowerCase());
  const role = el.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox' || role === 'spinbutton';
}

/** Whether Space and Enter press the element (a button, link, checkbox, disclosure or tab). */
export function pressedBySpace(el: KeyTarget | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'button' || tag === 'summary') return true;
  if (tag === 'a' && el.getAttribute('href') !== null) return true;
  if (tag === 'input') return PRESSED_INPUTS.has((el.type ?? 'text').toLowerCase());
  return PRESSED_ROLES.has(el.getAttribute('role') ?? '');
}

/**
 * Route a key press (`key` is KeyboardEvent.key in lower case) from the
 * element that has focus (null or the body when nothing does).
 */
export function routeKey(el: KeyTarget | null, key: string): KeyRoute {
  if (key === 'escape') return 'global'; // Esc always lets go: blur, close the banner, clear the issue
  if (takesTyping(el)) return 'native';
  const role = el?.getAttribute('role') ?? null;
  if (role === 'tab' && TAB_KEYS.has(key)) return 'tabs';
  if (role === 'slider' && SLIDER_KEYS.has(key)) return 'slider';
  if ((key === ' ' || key === 'enter') && pressedBySpace(el)) return 'native';
  // a radio group moves its choice with the arrow keys
  if (key.startsWith('arrow') && el?.tagName.toLowerCase() === 'input' && (el.type ?? '').toLowerCase() === 'radio') return 'native';
  return 'global';
}

/** The tab to move to from tab `i` of `n` for an arrow, Home or End key (wrapping round), or `i` for any other key. */
export function nextTab(i: number, n: number, key: string): number {
  if (n <= 0) return i;
  if (key === 'home') return 0;
  if (key === 'end') return n - 1;
  if (key === 'arrowright') return (i + 1) % n;
  if (key === 'arrowleft') return (i - 1 + n) % n;
  return i;
}

/** The modifier state of a key press, as KeyboardEvent gives it. */
export interface ModifierState {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  getModifierState?(name: string): boolean;
}

/**
 * Whether a modifier makes a key press someone else's (the browser's or the
 * system's), so the page's shortcuts leave it alone. On many layouts
 * (German, French, Nordic, Spanish; Option on a Mac) [ ] and ? are typed with
 * AltGr or Alt: AltGr counts as no modifier (Windows reports it as Ctrl+Alt),
 * and Alt is let through when it typed a single symbol rather than a letter or
 * a digit. Ctrl and Meta combinations stay with the browser.
 */
export function modifierOwnsKey(e: ModifierState): boolean {
  const altGraph = !!e.getModifierState?.('AltGraph');
  if (altGraph) return e.metaKey;
  if (e.ctrlKey || e.metaKey) return true;
  if (e.altKey) return !typedSymbol(e.key);
  return false;
}

/** A single printed character that is neither a letter, a digit nor white space: [ ] ? and the like. */
const typedSymbol = (key: string) => [...key].length === 1 && !/[\p{L}\p{N}\s]/u.test(key);
