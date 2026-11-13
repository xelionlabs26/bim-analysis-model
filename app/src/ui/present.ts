/**
 * How the page opens and how it presents: the presentation view (P or
 * ?mode=client) that keeps the model, its story and the plain toggles and
 * puts the expert chrome away; the opening frame (the finished model, paused,
 * with a large Play button); and the first-run cards, shown once per browser.
 * Pure, so each rule is tested without a page.
 */
import type { PrefsStore } from './prefs';

// ── presentation view ─────────────────────────────────────────────────────────

/**
 * The view a link asks for: true for ?mode=client (or present), false for
 * ?mode=expert (or full), null when the link says nothing usable and the
 * saved choice stands.
 */
export function modeFromLink(param: string | null | undefined): boolean | null {
  const m = (param ?? '').trim().toLowerCase();
  if (m === 'client' || m === 'present' || m === 'presentation') return true;
  if (m === 'expert' || m === 'full') return false;
  return null;
}

/** Whether the page opens in the presentation view: the link first, then the saved choice, else off. */
export function startsInClientMode(param: string | null | undefined, saved: boolean | undefined): boolean {
  return modeFromLink(param) ?? saved ?? false;
}

/** The way into and out of the presentation view, named for what pressing it does. */
export const presentButton = (client: boolean) =>
  client ? { label: 'Exit presentation', title: 'Back to the full view (P)' } : { label: 'Present', title: 'Presentation view: the model and the plain toggles only (P)' };

// ── the opening frame ─────────────────────────────────────────────────────────

export interface OpeningInput {
  /** A ?t= time in seconds, or null. */
  linkTime: number | null;
  /** ?paused=1. */
  paused: boolean;
  /** ?play=1: run the build from the start at once, as a kiosk loop does. */
  autoplay: boolean;
  duration: number;
}

export interface OpeningPlan {
  /** Where the sequence opens. */
  t: number;
  playing: boolean;
  /** Whether the large Play button shows over the model. */
  hero: boolean;
}

/**
 * Where the page opens. A ?t= link opens at that moment and plays unless
 * ?paused=1; ?play=1 plays from the start. Otherwise the page opens paused on
 * the finished, material-coloured model (the end of the sequence) with a
 * large Play button that runs the build from the start.
 */
export function openingPlan(o: OpeningInput): OpeningPlan {
  if (o.linkTime !== null && Number.isFinite(o.linkTime)) return { t: Math.min(Math.max(o.linkTime, 0), o.duration), playing: !o.paused, hero: false };
  if (o.autoplay && !o.paused) return { t: 0, playing: true, hero: false };
  return { t: o.duration, playing: false, hero: true };
}

/** The line under the large Play button: what pressing it shows. */
export function heroLine(steps: number, seconds: number): string {
  return `${steps} step${steps === 1 ? '' : 's'} in ${Math.max(1, Math.round(seconds))} s, from the start`;
}

// ── the crane plan ────────────────────────────────────────────────────────────

/**
 * What the crane plan says when it moves the playhead to a moment the crane
 * stands (`before`: it was not up yet, so its first lift; else it had been
 * struck, so its last), and when playback carries the plan past the strike.
 */
export function cranePlanNote(crane: string, kind: 'before' | 'struck' | 'gone', step = 0): string {
  if (kind === 'before') return `${crane} is not up yet at this point: the plan shows its first lift, step ${step}.`;
  if (kind === 'struck') return `${crane} is struck by this point: the plan shows its last lift, step ${step}.`;
  return `${crane} is struck here, so the plan has no reach to show. Step back to see it.`;
}

// ── first-run cards ───────────────────────────────────────────────────────────

/** Set once the first-run cards have been dismissed in this browser. */
export const INTRO_KEY = 'arbor-build.intro.v1';

/**
 * Whether to show the first-run cards: not when the link turns them off
 * (?intro=0, for stills and automation), nor once dismissed in this browser.
 * Storage that is missing or refuses access cannot tell a first visit from a
 * later one, so the cards show (they are one click to dismiss).
 */
export function showIntro(store: Pick<PrefsStore, 'getItem'> | null, param: string | null | undefined): boolean {
  if (param === '0') return false;
  if (param === '1') return true;
  if (!store) return true;
  try {
    return store.getItem(INTRO_KEY) !== '1';
  } catch {
    return true;
  }
}

/** Remember that the cards were dismissed; false when storage refused it. */
export function markIntroSeen(store: Pick<PrefsStore, 'setItem'> | null): boolean {
  if (!store) return false;
  try {
    store.setItem(INTRO_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** A touch screen with no hover and a coarse pointer (a phone or tablet): no keyboard to name, nothing to drop a file with. */
export const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';

/** The first-run cards' words for the model on show: short enough for two lines each over the stage strip. A touch screen is told to tap, not given keys. */
export function introCards(projectName: string, touch = false): { title: string; body: string }[] {
  return [
    { title: 'What this is', body: `${projectName} in the order it goes up: every part, crane lift and buildability check.` },
    { title: 'Play the build', body: touch ? 'Tap Play to watch it from the first step.' : 'Press Play or Space to watch it from the first step. Press ? for every shortcut.' },
    { title: 'Import your own IFC', body: 'From Revit, ArchiCAD or Tekla. Read in your browser, never uploaded.' },
  ];
}

/** The note on entering the presentation view: the way back, in words for the device. */
export const presentNote = (touch: boolean) =>
  touch ? 'Presentation view. Tap Exit presentation for the full view.' : 'Presentation view. Press P or Exit presentation for the full view.';

/** The Import drawer's second way in: a file dropped on the model, where there is a mouse to drop it with. */
export const importHint = (touch: boolean) => (touch ? 'Choose an .ifc file from this device.' : 'Or drop an .ifc file onto the model.');

// ── the first pick over the crane's chart ────────────────────────────────────

/**
 * What playback running into the first pick over the chart does. In the full
 * view it stops there with the banner (a buildability review wants to look).
 * A kiosk loop (?play=1) keeps playing with the banner as a passing note, and
 * the presentation view keeps playing with no banner at all: neither has
 * anyone at the keyboard to press Play again.
 */
export type OverPickResponse = 'stop' | 'note' | 'none';

export function overPickResponse(o: { autoplay: boolean; client: boolean }): OverPickResponse {
  if (o.client) return 'none';
  return o.autoplay ? 'note' : 'stop';
}

/** Sequence seconds a passing note stays after its pick. */
export const OVER_NOTE_HOLD = 4;

/**
 * Whether the banner about a pick at `pickT` still belongs at `t`: a stop
 * banner only while the playhead stays on the pick (a seek or a step away
 * ends it); a passing note for a few seconds after the pick.
 */
export function overBannerStays(pickT: number, t: number, note: boolean): boolean {
  if (note) return t >= pickT - 1e-3 && t <= pickT + OVER_NOTE_HOLD;
  return Math.abs(t - pickT) <= 1e-3;
}
