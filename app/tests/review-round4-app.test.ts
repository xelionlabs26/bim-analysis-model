import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildProject } from '../src/data/project';
import type { Project } from '../src/data/types';
import { Timeline } from '../src/engine/timeline';
import { bandOutline, bandRadius, heightBands } from '../src/scene/bands';
import { sheetSwipe } from '../src/ui/issues';
import { scaleLift } from '../src/ui/layout';
import { centreSpot, heroLayout, overlapDepth, type Box } from '../src/ui/place';
import { cranePlanNote } from '../src/ui/present';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const MAIN = read('../src/main.ts');
const ISSUES = read('../src/ui/issues.ts');
const OVERLAYS = read('../src/ui/overlays.ts');
const VIEWER = read('../src/scene/viewer.ts');
const CSS = read('../src/styles.css');

const hits = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const around = (at: { x: number; y: number }, size: { w: number; h: number }): Box => ({ x0: at.x - size.w / 2, y0: at.y - size.h / 2, x1: at.x + size.w / 2, y1: at.y + size.h / 2 });

describe('chromeBoxes keeps its own doc comment (Y1)', () => {
  it('has the comment that describes it directly above it', () => {
    expect(ISSUES).toMatch(/\* Boxes of the chrome over the viewport, relative to `host`, padded;[\s\S]*?\*\/\nexport function chromeBoxes\(/);
    // and the comment is not left above another function
    const doc = ISSUES.indexOf('Boxes of the chrome over the viewport');
    const next = ISSUES.indexOf('export function', doc);
    expect(ISSUES.slice(next, next + 28)).toBe('export function chromeBoxes(');
  });
});

describe('the opening frame puts the large Play button beside the model (Y2)', () => {
  // 1280 x 720: the viewport is 706 x 450; the toolbar, title block, scrubber and transport (the model keeps off them),
  // the caption, and the scale bar the button keeps off as well, padded 8 px, as measured in the browser
  const bounds: Box = { x0: 0, y0: 0, x1: 706, y1: 450 };
  const frame: Box[] = [
    { x0: 7, y0: 7, x1: 553, y1: 59 },
    { x0: 438, y0: 54, x1: 698, y1: 112 },
    { x0: 23, y0: 305, x1: 683, y1: 355 },
    { x0: 51, y0: 357, x1: 655, y1: 439 },
  ];
  const caption: Box = { x0: 7, y0: 55, x1: 437, y1: 218 };
  const scale: Box = { x0: 22, y0: 252, x1: 180, y1: 300 };
  const button = [...frame, caption, scale];
  const size = { w: 286, h: 78 };
  const duplex = { w: 22, h: 7.9 };
  const tower = { w: 40, h: 115 };

  it('frames a low, wide model and the button so that neither covers the other nor the cards', () => {
    const lay = heroLayout(bounds, button, frame, caption, duplex, size, 0.57)!;
    expect(lay).not.toBeNull();
    const b = around(lay.at, size);
    expect(hits(b, lay.rest)).toBe(false);
    for (const o of button) expect(hits(b, o)).toBe(false);
    for (const o of [...frame, caption]) expect(hits(lay.rest, o)).toBe(false);
    // inside the viewport, off its sides
    expect(b.x0).toBeGreaterThanOrEqual(12);
    expect(b.x1).toBeLessThanOrEqual(706 - 12);
    // the model keeps a fair size: at least 30 % of the scale the whole viewport would give it
    const s = (r: Box) => Math.min((r.x1 - r.x0) / duplex.w, (r.y1 - r.y0) / duplex.h);
    expect(s(lay.rest)).toBeGreaterThanOrEqual(0.3 * s(bounds));
  });

  it('gives a tower a column beside the button, near its usual place right of centre', () => {
    const lay = heroLayout(bounds, button, frame, caption, tower, size, 0.57)!;
    expect(lay).not.toBeNull();
    expect(hits(around(lay.at, size), lay.rest)).toBe(false);
    expect(lay.rest.y1 - lay.rest.y0).toBeGreaterThan(lay.rest.x1 - lay.rest.x0);
    expect((lay.rest.x0 + lay.rest.x1) / 2).toBeGreaterThan(353);
  });

  it('keeps the model further off the button when asked to', () => {
    const near = heroLayout(bounds, button, frame, caption, duplex, size, 0.57)!;
    const far = heroLayout(bounds, button, frame, caption, duplex, size, 0.57, 12, 0.3, 0.9, 50)!;
    expect(far).not.toBeNull();
    const b = around(far.at, size);
    const gap = Math.max(far.rest.x0 - b.x1, b.x0 - far.rest.x1, far.rest.y0 - b.y1, b.y0 - far.rest.y1);
    expect(gap).toBeGreaterThanOrEqual(50);
    // the model gives up some size for it, and the button still keeps 12 px off the viewport's sides
    const s = (r: Box) => Math.min((r.x1 - r.x0) / duplex.w, (r.y1 - r.y0) / duplex.h);
    expect(s(far.rest)).toBeLessThanOrEqual(s(near.rest));
    expect(b.x0).toBeGreaterThanOrEqual(12);
    // no room that far off: no layout
    expect(heroLayout(bounds, button, frame, caption, duplex, size, 0.57, 12, 0.3, 0.9, 400)).toBeNull();
  });

  it('measures how far the model as drawn runs into the button', () => {
    const b: Box = { x0: 100, y0: 100, x1: 300, y1: 180 };
    expect(overlapDepth({ x0: 0, y0: 0, x1: 400, y1: 120 }, b)).toBe(20);
    expect(overlapDepth({ x0: 280, y0: 0, x1: 400, y1: 400 }, b)).toBe(20);
    expect(overlapDepth({ x0: 0, y0: 0, x1: 100, y1: 400 }, b)).toBe(0);
    expect(overlapDepth({ x0: 0, y0: 200, x1: 400, y1: 400 }, b)).toBe(0);
  });

  it('gives up when nothing clear holds the button', () => {
    expect(heroLayout({ x0: 0, y0: 0, x1: 300, y1: 200 }, [{ x0: 0, y0: 60, x1: 300, y1: 140 }], [], null, duplex, size)).toBeNull();
  });

  it('places the button off the model as drawn when there is room beside it', () => {
    // 1440 x 900: the tower drawn right of centre, in slices (a wide podium at its foot)
    const vp: Box = { x0: 0, y0: 0, x1: 813, y1: 630 };
    const chrome: Box[] = [
      { x0: 7, y0: 7, x1: 553, y1: 59 },
      { x0: 554, y0: 7, x1: 806, y1: 205 },
      { x0: 7, y0: 55, x1: 423, y1: 202 },
      { x0: 22, y0: 432, x1: 222, y1: 480 },
      { x0: 23, y0: 485, x1: 790, y1: 535 },
      { x0: 105, y0: 537, x1: 708, y1: 620 },
    ];
    const model: Box[] = [
      { x0: 268, y0: 386, x1: 425, y1: 504 },
      { x0: 211, y0: 316, x1: 474, y1: 478 },
      { x0: 249, y0: 5, x1: 435, y1: 399 },
    ].map((m) => ({ x0: m.x0 - 10, y0: m.y0 - 10, x1: m.x1 + 10, y1: m.y1 + 10 }));
    const at = centreSpot(vp, [...chrome, ...model], size)!;
    expect(at).not.toBeNull();
    for (const o of [...chrome, ...model]) expect(hits(around(at, size), o)).toBe(false);
    // where the model leaves no room, there is no spot: the opening layout frames the model smaller instead
    expect(centreSpot(vp, [...chrome, { x0: 0, y0: 190, x1: 813, y1: 500 }], size)).toBeNull();
  });

  it('is wired: the button keeps off the model as drawn, else the two are laid out together; the labels keep off the button', () => {
    expect(MAIN).toMatch(/function watchHero\(\)/);
    expect(MAIN).toMatch(/syncCaption\(\);\s*watchHero\(\);/);
    expect(MAIN).toMatch(/if \(placeHero\(\)\) return;\s*heroShrunk = \{ w, h, clear: 12, done: false \};\s*syncRestBox\(\);/);
    // the model framed smaller is measured as drawn, and framed further off the button while it still runs into it
    expect(MAIN).toMatch(/Math\.max\(0, \.\.\.seen\.map\(\(m\) => overlapDepth\(m, hb\)\)\)/);
    expect(MAIN).toMatch(/heroShrunk\.clear = was \+ Math\.ceil\(depth\) \+ 8;/);
    expect(MAIN.match(/function syncRestBox\(\)[\s\S]*?\n\}/)?.[0]).toMatch(/0\.3, 0\.9, heroShrunk!\.clear\)/);
    expect(MAIN.match(/function syncRestBox\(\)[\s\S]*?\n\}/)?.[0]).toMatch(/heroLayout\(bounds, button, /);
    expect(VIEWER).toMatch(/modelOutline\(\): \{/);
    expect(OVERLAYS).toMatch(/#liftBanner, #heroPlay'\)/);
    // the button keeps its own width wherever it is put
    expect(CSS).toMatch(/\.hero-play \{[\s\S]*?width: max-content; white-space: nowrap;/);
  });
});

describe('the model in slices of height, for its outline on screen (Y2)', () => {
  const part = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => ({ pos: [x, y, z] as [number, number, number], size: [sx, sy, sz] as [number, number, number] });
  // a podium 40 m wide and 6 m high under a tower 12 m wide and 60 m high
  const parts = [part(0, 3, 0, 40, 6, 30), ...Array.from({ length: 20 }, (_, i) => part(0, 6 + i * 3 + 1.5, 0, 12, 3, 12))];

  it('gives the tower slim slices and the podium a wide one', () => {
    const bands = heightBands(parts, 6);
    expect(bands).toHaveLength(6);
    expect(bands[0].x1 - bands[0].x0).toBe(40);
    expect(bands[5].x1 - bands[5].x0).toBe(12);
    expect(bands[0].y0).toBe(0);
    expect(bands[5].y1).toBeCloseTo(66);
  });

  it('draws each slice as a cylinder about the orbit axis, the same however the view turns', () => {
    const [b] = heightBands([part(5, 2, 0, 4, 4, 4)], 1);
    expect(bandRadius(b, 0, 0)).toBeCloseTo(Math.hypot(7, 2));
    // a camera looking along z, turned about the y axis by `a`: the outline does not change
    const view = (a: number) => (p: [number, number, number]) => {
      const x = p[0] * Math.cos(a) - p[2] * Math.sin(a);
      return { x: 100 + x * 10, y: 100 - p[1] * 10, behind: false };
    };
    const o0 = bandOutline(b, 0, 0, view(0), 64)!;
    const o1 = bandOutline(b, 0, 0, view(1.1), 64)!;
    expect(o1.x0).toBeCloseTo(o0.x0, 0);
    expect(o1.x1).toBeCloseTo(o0.x1, 0);
    expect(o0.y0).toBeCloseTo(60);
    expect(o0.y1).toBeCloseTo(100);
    expect(bandOutline(b, 0, 0, () => ({ x: 0, y: 0, behind: true }))).toBeNull();
  });

  it('leaves out an empty model', () => {
    expect(heightBands([], 8)).toEqual([]);
  });
});

describe('the crane plan never shows an empty site (Y3)', () => {
  const arbor: Project = buildProject();
  const tl = new Timeline(arbor);
  const reach = (t: number) => {
    const s = tl.stateAt(t).crane;
    return s.visible && s.headVisible && !!s.pick;
  };

  it('opens on the last lift where the page opens, after the crane is struck', () => {
    expect(tl.craneUp(arbor.duration)).toBe(false);
    const at = tl.planTime(arbor.duration)!;
    expect(at).not.toBeNull();
    expect(at).toBeLessThan(tl.presentation.strikeT);
    expect(tl.craneUp(at)).toBe(true);
    expect(reach(at)).toBe(true);
  });

  it('stays where the playhead is while the crane stands', () => {
    const mid = (tl.erectT + tl.presentation.strikeT) / 2;
    expect(tl.planTime(mid)).toBe(mid);
    expect(reach(mid)).toBe(true);
  });

  it('goes to the first lift before the crane is up', () => {
    if (tl.erectT <= 0) return;
    const at = tl.planTime(0)!;
    expect(at).toBeGreaterThanOrEqual(tl.erectT);
    expect(tl.craneUp(at)).toBe(true);
  });

  it('has nothing to show without a tower crane', () => {
    const none = new Timeline({ ...arbor, crane: null });
    expect(none.planTime(5)).toBeNull();
    expect(none.craneUp(5)).toBe(false);
  });

  it('says why it moved, and why the reach goes when playback passes the strike', () => {
    expect(cranePlanNote('TC-1', 'struck', 158)).toBe('TC-1 is struck by this point: the plan shows its last lift, step 158.');
    expect(cranePlanNote('TC-1', 'before', 12)).toBe('TC-1 is not up yet at this point: the plan shows its first lift, step 12.');
    expect(cranePlanNote('TC-1', 'gone')).toMatch(/no reach to show/);
    const fn = MAIN.match(/function setCranePlan\(on: boolean\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(fn).toMatch(/timeline\.planTime\(playback\.t\)/);
    expect(fn).toMatch(/playback\.toggle\(false\);\s*playback\.seek\(at\);/);
    expect(MAIN).toMatch(/if \(note\) \{\s*planToast = cranePlanNote\(/);
  });
});

describe('the phone scale bar stays above the pinned play bar (Y4)', () => {
  it('rises by as much of the viewport as the bar covers, and no more', () => {
    // iPhone 13 at the top of the page: the viewport 115-593, the play bar from 563
    expect(scaleLift(115, 593, 563)).toBe(30);
    // scrolled 60 px: the viewport ends above the bar
    expect(scaleLift(55, 533, 563)).toBe(0);
    // a viewport mostly under the bar keeps the scale bar in it
    expect(scaleLift(400, 600, 410)).toBe(80);
    expect(scaleLift(115, 593, NaN)).toBe(0);
  });

  it('is applied to the narrow scale bar and kept up to date as the page scrolls', () => {
    expect(CSS).toMatch(/@media \(max-width: 1100px\) \{[\s\S]*?\.scalebar \{ left: 16px; bottom: calc\(16px \+ var\(--scale-lift, 0px\)\); \}/);
    expect(MAIN).toMatch(/window\.addEventListener\('scroll', queueLift, \{ passive: true \}\);/);
    expect(MAIN).toMatch(/vp\.style\.setProperty\('--scale-lift', `\$\{next\}px`\);/);
  });
});

describe('the issue sheet folds and closes from its handle (Y5)', () => {
  it('folds an open sheet on a swipe down, and closes it on a long one', () => {
    expect(sheetSwipe(60, 400, false, 280)).toBe('fold');
    expect(sheetSwipe(30, 400, false, 280)).toBe('none');
    expect(sheetSwipe(200, 500, false, 280)).toBe('close');
    // a quick flick counts at half the distance
    expect(sheetSwipe(24, 30, false, 280)).toBe('fold');
  });

  it('closes a folded sheet on a swipe down, opens it on one up', () => {
    expect(sheetSwipe(50, 400, true, 60)).toBe('close');
    expect(sheetSwipe(-40, 400, true, 60)).toBe('unfold');
    expect(sheetSwipe(-80, 400, false, 280)).toBe('none');
  });

  it('leaves a tap to the buttons on the head', () => {
    expect(sheetSwipe(4, 80, false, 280)).toBe('none');
    expect(sheetSwipe(-5, 80, true, 60)).toBe('none');
    expect(sheetSwipe(NaN, 80, true, 60)).toBe('none');
  });

  it('never scrolls the page behind the sheet, while its detail still scrolls', () => {
    expect(CSS).toMatch(/\.issue-sheet \{ touch-action: none; overscroll-behavior: contain;/);
    expect(CSS).toMatch(/\.sheet-body \{ touch-action: pan-y; \}/);
    expect(CSS).toMatch(/\.sheet-body \{[^}]*overscroll-behavior: contain;/);
    expect(ISSUES).toMatch(/this\.bindSheetSwipe\(\);/);
    // the click a swipe's lift makes on the grip, ‹ › or × is not a press
    expect(ISSUES).toMatch(/\$\('sheetToggle'\)\.onclick = tap\(/);
    expect(ISSUES).toMatch(/\$\('sheetClose'\)\.onclick = tap\(/);
  });
});
