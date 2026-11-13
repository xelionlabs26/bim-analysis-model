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

/** The first-run cards' words for the model on show. */
export function introCards(projectName: string): { title: string; body: string }[] {
  return [
    { title: 'What this is', body: `${projectName} in the order it goes up: every part, crane lift and buildability check, step by step.` },
    { title: 'Play the build', body: 'Press Play or Space to watch it from the start. Drag the timeline to any step. Press ? for every shortcut.' },
    { title: 'Import your own IFC', body: 'Open a model from Revit, ArchiCAD or Tekla. It is read in your browser and never uploaded.' },
  ];
}
