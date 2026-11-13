import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { moreSides, orbitTouchAction, revealScroll, ScrubDrag, stripScroll, toastLife } from '../src/ui/layout';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const CSS = read('../src/styles.css');
const HTML = read('../index.html');
const MAIN = read('../src/main.ts');

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

describe('drawers and the over-chart banner on a phone (R54, O4)', () => {
  it('brings an opened drawer up above the pinned play bar, and the Members search for Parts', () => {
    const fn = MAIN.match(/function selectRail\([\s\S]*?\n\}/)?.[0] ?? '';
    expect(fn).toMatch(/if \(isNarrow\(\) && view\.rail !== 'model'\)/);
    expect(fn).toMatch(/revealScroll\(\$\('tabMembers'\)\.getBoundingClientRect\(\)\.top\)/);
    expect(fn).toMatch(/revealScroll\(\$\('viewport'\)\.getBoundingClientRect\(\)\.top\)/);
  });

  it('places the banner above the play bar and the issue sheet, fixed to the screen', () => {
    const at = CSS.indexOf('.lift-banner.note .lb-text b');
    const tail = CSS.slice(at, CSS.indexOf('\n}\n', at) + 3);
    expect(tail).toMatch(/@media \(max-width: 1100px\) \{\s*\.lift-banner \{ position: fixed; bottom: calc\(var\(--playbar-h, 120px\) \+ var\(--sheet-h, 0px\) \+ 8px\);/);
  });
});

// ── the APP-3 layout batch: phone first load, drawers, tabs, the status card, the hero ──
import { centreSpot } from '../src/ui/place';
import { importHint, introCards, presentNote } from '../src/ui/present';
const ISSUES = read('../src/ui/issues.ts');
/** The later one-column block (after the issue sheet), where the toast is placed. */
const lateNarrow = () => {
  const at = CSS.indexOf('/* narrow screens, for rules that come after the narrow block above');
  return CSS.slice(at, CSS.indexOf('\n}\n', at));
};

describe('the phone opens on the model (R55, O16)', () => {
  it('moves the status card out of the header and puts the rail under the model on a narrow screen, keeping the header a landmark', () => {
    const fn = MAIN.match(/function arrange\(\)[\s\S]*?\n\}/)?.[0] ?? '';
    expect(fn).toMatch(/if \(isNarrow\(\)\) \{\s*if \(vp\.nextElementSibling !== rail\) vp\.after\(rail\);\s*if \(rail\.nextElementSibling !== status\) rail\.after\(status\);/);
    expect(fn).toMatch(/header\.append\(status\)/);
    expect(MAIN).toMatch(/narrow\?\.addEventListener\('change', \(\) => \{\s*arrange\(\);/);
    expect(HTML).toMatch(/<header class="header">/);
    expect(CSS).not.toMatch(/\.header\s*\{[^}]*display: contents/);
  });

  it('hides the caption on a phone while the large Play button is up (the status card says the same)', () => {
    const fn = MAIN.match(/function syncCaption\(\)[\s\S]*?\n\}/)?.[0] ?? '';
    expect(fn).toMatch(/const heroUp = hero && isNarrow\(\);/);
    expect(fn).toMatch(/!heroUp/);
  });

  it('lets the first-run cards scroll away with the page, and keeps framed issues and pins clear of them (R56)', () => {
    expect(CSS).toMatch(/@media \(max-width: 1100px\) \{\s*\/\* the wordmark[^@]*\.intro \{ position: absolute; top: 8px;/);
    expect(MAIN).toMatch(/const FRAME_CHROME = '[^']*#intro'/);
    expect(ISSUES).toMatch(/const PIN_CHROME = '[^']*#intro'/);
  });

  it('fades the end of the rail that has more to scroll to (R58)', () => {
    const n = narrowBlock();
    expect(n).toMatch(/\.rail-items\.more-end \{ mask-image/);
    expect(n).toMatch(/\.rail-items\.more-start \{ mask-image/);
    expect(MAIN).toMatch(/if \(isNarrow\(\)\) fadeOne\(railItems\);/);
    expect(MAIN).toMatch(/railItems\.addEventListener\('scroll', fade, \{ passive: true \}\)/);
  });
});

describe('phone details (R25–R27, R52)', () => {
  it('wraps the status facts on a narrow phone instead of running them out of the card (R25)', () => {
    expect(narrowBlock()).toMatch(/\.status-facts \{[^}]*flex-wrap: wrap;[^}]*white-space: normal;/);
    expect(narrowBlock()).toMatch(/\.status-facts > \* \{ white-space: nowrap; \}/);
  });

  it('puts a toast that stays above the issue sheet too, clear of its buttons (R26)', () => {
    expect(lateNarrow()).toMatch(/\.toast \{[^}]*bottom: calc\(var\(--playbar-h, 120px\) \+ var\(--sheet-h, 0px\) \+ 10px\)/);
  });

  it('draws the focus ring inside the keys of the sideways-scrolling transport, where it is not clipped (R27)', () => {
    expect(narrowBlock()).toMatch(/\.playbar \.tkey:focus-visible, \.playbar \.tbtn:focus-visible \{ outline-offset: -3px; \}/);
  });

  it('lets the selected row open in place while the Issues list is on screen, rather than covering it with the sheet (R52)', () => {
    expect(CSS).toMatch(/\.app\.list-in-view \.issue-sheet:not\(\[hidden\]\) \{ display: none; \}/);
    expect(CSS).toMatch(/\.app\.list-in-view \.iss\.sel \.iss-body \{ display: block; \}/);
    const fn = MAIN.match(/function listInView\(\)[\s\S]*?\n\}/)?.[0] ?? '';
    expect(fn).toMatch(/isNarrow\(\) && !pane\.hidden/);
    // picking an issue takes the page up to the model: the sheet comes back before the framing measures it
    expect(MAIN.match(/function selectIssue\([\s\S]*?\n\}/)?.[0]).toMatch(/listInView\(\);\s*\}\s*frameIssue\(i\);/);
  });
});

describe('drawers, tabs and the status card at mid widths (R51, R41, R28, R29)', () => {
  it('caps every drawer above the play controls, and above the pinned play bar on a narrow screen (R51)', () => {
    expect(CSS).toMatch(/\.drawer \{[^}]*max-height: calc\(100% - var\(--toolbar-bottom, 50px\) - 172px\); overflow: auto;/);
    expect(narrowBlock()).toMatch(/\.drawer \{ max-height: min\([^}]*var\(--playbar-h, 120px\)/);
    expect(CSS).not.toMatch(/\.drawer\.wide \{[^}]*max-height/);
  });

  it('never wraps a tab label or its badge, and tightens the tabs and buttons in a 380 px panel (R41, R28)', () => {
    expect(CSS).toMatch(/\.seg button \{[^}]*white-space: nowrap;/);
    expect(CSS).toMatch(/\.tab-badge \{ display: inline-block; white-space: nowrap;/);
    const b = block('@container panel (max-width: 470px)');
    expect(b).toMatch(/\.seg button \{ padding: 6px 8px; font-size: 13px; \}/);
    expect(b).toMatch(/\.panel-head \.sq \{ width: 34px; height: 34px; \}/);
  });

  it('gives the phase and step room in a 380–400 px status card (R29)', () => {
    const at = CSS.indexOf('@container status (max-width: 400px)');
    expect(at).toBeGreaterThan(0);
    const b = CSS.slice(at, CSS.indexOf('}\n}', at));
    expect(b).toMatch(/\.status-main \{ min-width: 96px; \}/);
    expect(b).toMatch(/#statusFacts \.head \{ visibility: hidden; width: 0;/);
  });
});

describe('the large Play button keeps off the caption (R53)', () => {
  // 1280 x 720: the viewport is 706 x 450; the toolbar, caption, title block, scale bar, scrubber and transport, padded 8 px
  const chrome = [
    { x0: 7, y0: 7, x1: 553, y1: 59 },
    { x0: 7, y0: 55, x1: 423, y1: 202 },
    { x0: 471, y0: 55, x1: 699, y1: 113 },
    { x0: 22, y0: 252, x1: 180, y1: 300 },
    { x0: 23, y0: 305, x1: 683, y1: 355 },
    { x0: 51, y0: 357, x1: 655, y1: 439 },
  ];
  const hero = { w: 286, h: 78 };
  const hits = (at: { x: number; y: number }, b: { x0: number; y0: number; x1: number; y1: number }) =>
    at.x - hero.w / 2 < b.x1 && at.x + hero.w / 2 > b.x0 && at.y - hero.h / 2 < b.y1 && at.y + hero.h / 2 > b.y0;

  it('sits in the clear part of the model nearest its middle', () => {
    const at = centreSpot({ x0: 0, y0: 0, x1: 706, y1: 450 }, chrome, hero)!;
    expect(at).not.toBeNull();
    for (const b of chrome) expect(hits(at, b)).toBe(false);
    expect(Math.abs(at.x - 353)).toBeLessThan(60);
  });

  it('keeps the stylesheet place when nothing clear holds it', () => {
    expect(centreSpot({ x0: 0, y0: 0, x1: 300, y1: 200 }, [{ x0: 0, y0: 60, x1: 300, y1: 140 }], hero)).toBeNull();
  });

  it('is placed whenever the cards move, and on a phone only in the part of the model above the fold', () => {
    const fn = MAIN.match(/function placeHero\(\)[\s\S]*?\n\}/)?.[0] ?? '';
    expect(fn).toMatch(/Math\.min\(r\.height, window\.innerHeight - r\.top\)/);
    expect(MAIN).toMatch(/const HERO_CHROME = '[^']*#caption[^']*#playbar'/);
    expect(MAIN.match(/function syncRestBox\(\)[\s\S]*?\n\}/)?.[0]).toMatch(/placeHero\(\);/);
  });
});

describe('words for a touch screen (R57, O8)', () => {
  it('tells a phone to tap, not to press keys or drop a file', () => {
    expect(introCards('Arbor House', true)[1].body).toBe('Tap Play to watch it from the first step.');
    expect(introCards('Arbor House', false)[1].body).toMatch(/Space/);
    expect(presentNote(true)).not.toMatch(/Press P/);
    expect(presentNote(false)).toMatch(/Press P/);
    expect(importHint(true)).not.toMatch(/drop/i);
    expect(importHint(false)).toMatch(/drop an \.ifc file/);
    expect(MAIN).toMatch(/introCards\(project\.name, isTouch\(\)\)/);
    expect(MAIN).toMatch(/toast\(presentNote\(isTouch\(\)\)\)/);
    expect(MAIN).toMatch(/\$\{importHint\(isTouch\(\)\)\}/);
  });
});
