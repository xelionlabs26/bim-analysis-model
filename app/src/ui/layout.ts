/**
 * Small rules for the narrow and touch layouts: the play bar pinned to the
 * bottom of a phone, the issue sheet above it, the scrubber under a finger,
 * the stage strip that scrolls sideways and the toast. Pure, so they are
 * tested without a page.
 */

/** The one-column layout: the panel sits under the model and the play bar is pinned to the bottom of the screen (styles.css, the max-width: 1100px block). */
export const NARROW_QUERY = '(max-width: 1100px)';

/**
 * The model canvas's touch-action. While Orbit Cam is on, the orbit controls
 * take every gesture; with it off, a swipe over the model scrolls the page
 * and a pinch zooms it. Set inline: the orbit controls write an inline
 * `touch-action: none` that a class rule would not override.
 */
export const orbitTouchAction = (orbit: boolean) => (orbit ? 'none' : 'pan-y pinch-zoom');

/**
 * Where a sideways-scrolling strip should scroll to so a card sits in its
 * middle, clamped to what the strip can scroll; null when the strip has no
 * overflow or the card already shows whole. Positions are on screen
 * (bounding boxes), so they do not depend on the cards' offset parent.
 */
export function stripScroll(card: { left: number; width: number }, strip: { left: number; width: number; scrollLeft: number; scrollWidth: number }): number | null {
  const room = strip.scrollWidth - strip.width;
  if (room <= 0.5) return null;
  const inStrip = card.left - strip.left; // where the card shows now, from the strip's left edge
  if (inStrip >= 0 && inStrip + card.width <= strip.width) return null;
  const target = strip.scrollLeft + inStrip - (strip.width - card.width) / 2;
  return Math.max(0, Math.min(room, Math.round(target)));
}

/**
 * A drag along the scrubber. It belongs to the pointer that pressed (the
 * primary button, a pen or a finger) and ends on release, on a cancel (the
 * browser took the gesture) or when the track loses the pointer capture, so a
 * stale drag can never turn a later hover into a seek.
 */
export class ScrubDrag {
  private id: number | null = null;

  /** A press on the track. Returns whether it starts a drag (and seeks). */
  down(pointerId: number, button: number): boolean {
    if (button !== 0) return false;
    this.id = pointerId;
    return true;
  }

  /** A move seeks only for the pointer that started the drag, while the track still holds its capture. */
  move(pointerId: number, captured: boolean): boolean {
    return this.id === pointerId && captured;
  }

  /** Up, cancel or lost capture: the drag is over (another pointer's end leaves it alone). */
  end(pointerId: number) {
    if (pointerId === this.id) this.id = null;
  }

  get dragging() {
    return this.id !== null;
  }
}

export type ToastKind = 'info' | 'warn' | 'error';

/**
 * How long a toast stays, in ms: a failure, or a warning that the model on
 * show is incomplete, stays until it is dismissed or replaced (null).
 */
export const toastLife = (kind: ToastKind): number | null => (kind === 'info' ? 4200 : null);

/**
 * Whether a new toast may take the place of the one showing (`showing` is
 * null when none shows): a passing note never covers a failure or a warning
 * that stays until it is dismissed, so an import error is not lost under,
 * say, an export's progress. A warning or a failure always shows.
 */
export const toastReplaces = (showing: ToastKind | null, next: ToastKind): boolean => showing === null || showing === 'info' || next !== 'info';

/**
 * How far to scroll the page so the model's top edge sits just under the top
 * of the screen, where a framed issue shows above the sheet and the play bar;
 * 0 when it is already there (within `slack`).
 */
export function revealScroll(viewportTop: number, margin = 8, slack = 24): number {
  const d = viewportTop - margin;
  return Math.abs(d) <= slack ? 0 : d;
}

/** Which ends of a sideways scroller have more to show: drawn as a fade, since phones hide the scrollbar. */
export function moreSides(scrollLeft: number, clientWidth: number, scrollWidth: number): { start: boolean; end: boolean } {
  return { start: scrollLeft > 1, end: scrollLeft + clientWidth < scrollWidth - 1 };
}
