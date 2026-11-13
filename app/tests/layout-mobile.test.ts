import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { moreSides, orbitTouchAction, revealScroll, ScrubDrag, stripScroll, toastLife } from '../src/ui/layout';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const CSS = read('../src/styles.css');
const HTML = read('../index.html');

/** The body of the first block that opens with `head` (a media or container query). */
const block = (head: string) => {
  const at = CSS.indexOf(`${head} {`);
  expect(at, head).toBeGreaterThanOrEqual(0);
  return CSS.slice(at, CSS.indexOf('\n}\n', at));
};
/** The one-column layout. */
const narrowBlock = () => block('@media (max-width: 1100px)');

describe('the stage strip follows the current stage (F55)', () => {
  // a phone: the strip shows 254 px from x 68, eight 150 px cards in 1 284 px
  const strip = { left: 68, width: 254, scrollLeft: 0, scrollWidth: 1284 };

  it('centres a card that is off to the right, measured on screen', () => {
    // stage 06 after five taps on Next: the card at x 878–1028
    expect(stripScroll({ left: 878, width: 150 }, strip)).toBe(758);
  });

  it('leaves a card that already shows whole', () => {
    expect(stripScroll({ left: 68, width: 150 }, strip)).toBeNull();
    expect(stripScroll({ left: 170, width: 150 }, strip)).toBeNull();
  });

  it('stays within what the strip can scroll, at either end', () => {
    expect(stripScroll({ left: 68 + 7 * 162 - 400, width: 150 }, { ...strip, scrollLeft: 400 })).toBe(1030);
    expect(stripScroll({ left: -300, width: 150 }, { ...strip, scrollLeft: 300 })).toBe(0);
  });

  it('does nothing where the strip does not scroll (a wide screen fits every card)', () => {
    expect(stripScroll({ left: 900, width: 150 }, { left: 68, width: 1200, scrollLeft: 0, scrollWidth: 1200 })).toBeNull();
  });
});

describe('a drag along the scrubber (F53)', () => {
  it('ends on a cancel, so a later hover with no button pressed does not seek', () => {
    const d = new ScrubDrag();
    expect(d.down(7, 0)).toBe(true);
    expect(d.move(7, true)).toBe(true);
    d.end(7); // pointercancel: the browser took the gesture
    expect(d.dragging).toBe(false);
    expect(d.move(7, true)).toBe(false);
    expect(d.move(1, false)).toBe(false); // the mouse, hovering
  });

  it('seeks only while the track holds the capture', () => {
    const d = new ScrubDrag();
    d.down(3, 0);
    expect(d.move(3, false)).toBe(false); // lostpointercapture has not arrived yet
  });

  it("belongs to the pointer that pressed: another pointer's moves and ends leave it alone", () => {
    const d = new ScrubDrag();
    d.down(3, 0);
    expect(d.move(4, true)).toBe(false);
    d.end(4);
    expect(d.dragging).toBe(true);
    d.end(3);
    expect(d.dragging).toBe(false);
  });

  it('is not started by a right-click', () => {
    const d = new ScrubDrag();
    expect(d.down(1, 2)).toBe(false);
    expect(d.dragging).toBe(false);
  });

  it('keeps the browser from taking a drag along the track as a page pan', () => {
    expect(CSS).toMatch(/\.scrub-track\s*\{[^}]*touch-action: none/);
  });
});

describe('the model under a finger with Orbit Cam off (F59)', () => {
  it('lets a swipe scroll the page and a pinch zoom it, and gives every gesture back to orbit when it is on', () => {
    expect(orbitTouchAction(false)).toBe('pan-y pinch-zoom');
    expect(orbitTouchAction(true)).toBe('none');
  });
});

describe('import messages on every layout (F54)', () => {
  it('keeps a failure up until it is dismissed, and lets other messages go', () => {
    expect(toastLife('error')).toBeNull();
    expect(toastLife('info')).toBe(4200);
  });

  it('puts the toast on the page, not inside the panel or its tab bar', () => {
    const panel = HTML.slice(HTML.indexOf('<aside class="panel'), HTML.indexOf('</aside>'));
    expect(panel).not.toMatch(/id="toast"/);
    expect(HTML).toMatch(/class="toast" id="toast"/);
    expect(CSS).toMatch(/\.toast\s*\{[^}]*position: fixed/);
    // above the pinned play bar on a narrow screen
    expect(CSS).toMatch(/@media \(max-width: 1100px\)\s*\{[^}]*\.toast\s*\{[^}]*bottom: calc\(var\(--playbar-h/);
  });
});

describe('phone first aid', () => {
  it('pins the play bar to the bottom of a narrow screen, and leaves room for it at the foot of the page', () => {
    const n = narrowBlock();
    expect(n).toMatch(/\.playbar\s*\{[^}]*position: fixed;[^}]*bottom: 0/);
    expect(n).toMatch(/\.app\s*\{[^}]*padding-bottom: calc\(var\(--playbar-h/);
    expect(HTML).toMatch(/<div class="playbar" id="playbar">\s*<div class="scrubber" id="scrubber">/);
  });

  it('brings the model up to the top of the screen for an issue, unless it is nearly there', () => {
    expect(revealScroll(312)).toBe(304);
    expect(revealScroll(-640)).toBe(-648);
    expect(revealScroll(20)).toBe(0);
  });

  it('marks the side of the transport that has more to scroll to', () => {
    expect(moreSides(0, 366, 590)).toEqual({ start: false, end: true });
    expect(moreSides(224, 366, 590)).toEqual({ start: true, end: false });
    expect(moreSides(0, 600, 590)).toEqual({ start: false, end: false });
  });
});

describe('narrow layout rules', () => {
  it('lays out one stage column per stage (F56)', () => {
    expect(narrowBlock()).toMatch(/\.cards\s*\{[^}]*grid-template-columns: repeat\(var\(--n, 8\), 150px\)/);
  });

  it('draws the active rail marker as an underline inside the item, not as a bar in the gap (F58)', () => {
    expect(narrowBlock()).toMatch(/\.rail-item\.on::before\s*\{[^}]*top: auto;[^}]*bottom: 0;[^}]*height: 3px/);
  });

  it('opens the drawer and the caption under the toolbar, however many rows it wraps to (F57)', () => {
    expect(CSS).toMatch(/\.drawer\s*\{[^}]*top: calc\(var\(--toolbar-bottom, 50px\) \+ 12px\)/);
    expect(CSS).toMatch(/\.caption\s*\{[^}]*top: calc\(var\(--toolbar-bottom, 50px\) \+ 12px\)/);
    expect(narrowBlock()).not.toMatch(/\.caption\s*\{[^}]*top: 112px/);
  });
});

describe('short and mid-size windows', () => {
  it('fits the seven rail items at 720 px tall, and shows when the rail scrolls (F49)', () => {
    expect(block('@media (max-height: 780px) and (min-width: 1101px)')).toMatch(/\.rail-item \.ico\s*\{[^}]*height: 34px/);
    expect(CSS).not.toMatch(/\.rail-items\s*\{[^}]*scrollbar-width: none/);
  });

  it('folds the title block to one line where it would meet the toolbar (quick win 16)', () => {
    expect(block('@container vp (max-width: 800px)')).toMatch(/\.titleblock\s*\{[^}]*top: calc\(var\(--toolbar-bottom/);
    for (const k of ['tb-name', 'tb-scale', 'tb-sheet']) expect(HTML).toMatch(new RegExp(`class="tb-row[^"]*${k}"`));
  });
});
