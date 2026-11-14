import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calloutOpacity } from '../src/ui/overlays';
import { pointerPress, routeKey } from '../src/ui/keys';
import { nearestMark, paneScroll } from '../src/ui/issues';
import { boxSide, issueFrame, restFrame, restFrameClear, usualCrown, type Box } from '../src/ui/place';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const MAIN = read('../src/main.ts');
const ISSUES = read('../src/ui/issues.ts');
const OVERLAYS = read('../src/ui/overlays.ts');
const CSS = read('../src/styles.css');

const hits = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const pad = (b: Box, p = 8): Box => ({ x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p });

describe('member callouts on a narrow screen (Z4, Z10)', () => {
  it('draw no leader line and no ring when the stylesheet hides the label', () => {
    for (let rank = 0; rank < 4; rank++) expect(calloutOpacity(rank, false, false)).toEqual({ label: 0, line: 0, ring: 0 });
  });

  it('draw as before where the label shows', () => {
    expect(calloutOpacity(0, false, true)).toEqual({ label: 1, line: 0.9, ring: 1 });
    const second = calloutOpacity(1, false, true);
    expect(second.label).toBeCloseTo(0.62);
    expect(second.line).toBeCloseTo(0.558);
    expect(second.ring).toBeCloseTo(0.372);
    // no room on the stack: the label and the leader go, the newest ring stays
    expect(calloutOpacity(0, true, true)).toEqual({ label: 0, line: 0, ring: 1 });
    expect(calloutOpacity(2, true, true)).toEqual({ label: 0, line: 0, ring: 0 });
  });

  it('measure the label before choosing, and give the line and ring the same answer', () => {
    expect(OVERLAYS).toMatch(/const width = c\.el\.offsetWidth;[\s\S]{0,400}?const op = calloutOpacity\(rank, !!p\.hidden \|\| underHero, width > 0\);/);
    expect(OVERLAYS).toMatch(/c\.line\.style\.opacity = String\(op\.line\);\s*c\.ring\.style\.opacity = String\(op\.ring\);/);
    // the labels are what the narrow stylesheet hides
    expect(CSS).toMatch(/@media \(max-width: 1100px\) \{[\s\S]*?\.overlay \.callout \{ display: none; \}/);
  });
});

describe('Space after clicking Present (Z6)', () => {
  it('tells a pointer click from a key press', () => {
    expect(pointerPress({ detail: 1 })).toBe(true);
    expect(pointerPress({ detail: 2 })).toBe(true);
    // Space or Enter on a focused button fires a click with no click count
    expect(pointerPress({ detail: 0 })).toBe(false);
  });

  it('lets go of the focus after a click, so Space reaches the page and plays', () => {
    expect(MAIN).toMatch(/\$\('btnPresent'\)\.addEventListener\('click', \(e\) => \{\s*setClient\(!view\.client\);[\s\S]*?if \(pointerPress\(e\)\) \$\('btnPresent'\)\.blur\(\);/);
    expect(MAIN).not.toMatch(/bind\('btnPresent'/);
    // with the button focused, Space is the button's; with nothing focused it is the page's
    const button = { tagName: 'BUTTON', getAttribute: () => null };
    expect(routeKey(button, ' ')).toBe('native');
    expect(routeKey(null, ' ')).toBe('global');
  });
});

describe('the Issues pane comes to rest clear of the sticky bar (Z8)', () => {
  // 1440 × 900: the ‹ › bar's natural place is 183 px down the pane's content
  it('goes on to the bar when the row needs the pane scrolled', () => {
    // RCH-02 scrolled into view at the foot of the pane left the pane at 139: chips cut through above the bar
    expect(paneScroll(139, 183, 600, 470)).toBe(183);
    // the first row scrolled up to just under the bar: 4 px of chips
    expect(paneScroll(179, 183, 500, 300)).toBe(183);
  });

  it('goes back to the top when the row shows whole from there', () => {
    expect(paneScroll(40, 183, 400, 470)).toBe(0);
  });

  it('leaves the pane alone at the top or once the bar sticks', () => {
    expect(paneScroll(0, 183, 900, 470)).toBe(0);
    expect(paneScroll(183, 183, 900, 470)).toBe(183);
    expect(paneScroll(692, 183, 1200, 470)).toBe(692);
  });

  it('a row snapped to the bar stays whole and below it', () => {
    // a row that 'nearest' put at the foot of the pane, from a scroll short of the bar
    const navTop = 183, navH = 36, height = 470;
    for (const scrollTop of [10, 90, 139, 182]) {
      const rowBottom = scrollTop + height; // its foot at the pane's foot
      const rowTop = rowBottom - 140;
      if (rowTop < navTop + navH) continue; // rows start under the bar
      const s = paneScroll(scrollTop, navTop, rowBottom, height);
      expect(s).toBe(navTop);
      expect(rowTop - s).toBeGreaterThanOrEqual(navH);
      expect(rowBottom - s).toBeLessThanOrEqual(height);
    }
  });

  it('is applied after the row is scrolled into view', () => {
    expect(ISSUES).toMatch(/scrollIntoView\(\{ block: tall \? 'start' : 'nearest' \}\);[\s\S]*?const snapped = paneScroll\(pane\.scrollTop, navTop, rowBottom, pane\.clientHeight\);/);
  });
});

describe('a tap on the scrubber marks (Z9)', () => {
  // Arbor on an iPhone 13: the first marks, 3–10 px apart, each with a 28 px target
  const marks = [
    { id: 'EDG-01', x: 42 },
    { id: 'EDG-02', x: 45 },
    { id: 'EDG-03', x: 51 },
    { id: 'TRN-03', x: 52 },
    { id: 'TRN-04', x: 61 },
    { id: 'EDG-04', x: 104 },
  ];

  it('goes to the mark whose dot is nearest, not to the target on top', () => {
    for (const m of marks) expect(nearestMark(m.x, marks)).toBe(m.id);
    expect(nearestMark(57, marks)).toBe('TRN-04');
    expect(nearestMark(98, marks)).toBe('EDG-04');
  });

  it('goes to the later (critical, drawn on top) mark on a tie', () => {
    expect(nearestMark(50, [{ id: 'MAJ', x: 45 }, { id: 'CRIT', x: 55 }])).toBe('CRIT');
  });

  it('selects nothing out of reach of every mark', () => {
    expect(nearestMark(80, marks)).toBeNull();
    expect(nearestMark(56, [{ id: 'A', x: 45 }], 9)).toBeNull();
    expect(nearestMark(53, [{ id: 'A', x: 45 }], 9)).toBe('A');
  });

  it('is decided on the track, so the playhead knob over a mark does not swallow the tap', () => {
    expect(ISSUES).toMatch(/\$\('scrubTrack'\)\.onpointerdown = \(e\) => this\.markPress\(e\);/);
    expect(ISSUES).toMatch(/const id = nearestMark\(down\.x, near, reach\);/);
    // the reach is half the target the stylesheet draws: 18 px for a mouse, 28 px for a finger
    expect(ISSUES).toMatch(/const reach = e\.pointerType === 'mouse' \? 9 : 14;/);
    expect(CSS).toMatch(/\.iss-mark::before \{[^}]*width: 18px; height: 18px;/);
    expect(CSS).toMatch(/@media \(pointer: coarse\) \{ \.iss-mark::before \{ width: 28px; height: 28px; \} \}/);
  });
});

describe('the over-chart stop on a short screen (Z5)', () => {
  // 1280 × 720, measured: the viewport 706 × 450 and its cards (8 px padding)
  const view: Box = { x0: 0, y0: 0, x1: 706, y1: 450 };
  const toolbar = pad({ x0: 15, y0: 15, x1: 545, y1: 51 });
  const title = pad({ x0: 484, y0: 63, x1: 691, y1: 105 });
  const scrubber = pad({ x0: 31, y0: 313, x1: 675, y1: 347 });
  const transport = pad({ x0: 59, y0: 365, x1: 647, y1: 431 });
  const caption = pad({ x0: 15, y0: 63, x1: 415, y1: 194 });

  it('with the banner in the middle of the model, never frames the piece behind it', () => {
    const banner = pad({ x0: 53, y0: 175, x1: 653, y1: 249 });
    const chrome = [toolbar, title, scrubber, transport, banner];
    // what the cards leave is too little: the frame used to fall back to the whole viewport, banner and all
    expect(issueFrame(view, chrome, caption).box).toEqual(view);
    const f = issueFrame(view, chrome, caption, { hard: [banner, scrubber, transport] });
    expect(hits(f.box, banner)).toBe(false);
    expect(hits(f.box, transport)).toBe(false);
    expect(boxSide(f.box)).toBeGreaterThan(100);
  });

  it('with the banner just over the scrubber, frames the piece in the clear band above it', () => {
    const banner = pad({ x0: 53, y0: 229, x1: 653, y1: 303 });
    const chrome = [toolbar, title, scrubber, transport, banner];
    const f = issueFrame(view, chrome, caption, { hard: [banner, scrubber, transport] });
    for (const o of chrome) expect(hits(f.box, o)).toBe(false);
    expect(boxSide(f.box)).toBeGreaterThanOrEqual(0.35 * 450);
  });

  it('the stylesheet puts the banner over the scrubber on a short wide screen, the scale bar giving way', () => {
    expect(CSS).toMatch(/@media \(min-width: 1101px\) and \(max-height: 820px\) \{\s*\.lift-banner \{ bottom: 146px; \}\s*\.viewport:has\(> \.lift-banner:not\(\[hidden\]\)\) \.scalebar \{ visibility: hidden; \}/);
    // the wide screen's usual place, and the phone's, are unchanged
    expect(CSS).toMatch(/\.lift-banner \{\s*position: absolute; left: 50%; bottom: 200px;/);
  });

  it('main frames the stop with the banner and the controls as hard cards', () => {
    expect(MAIN).toMatch(/const BANNER_HARD = '#liftBanner, #scrubber, #transport, #issueSheet';/);
    expect(MAIN).toMatch(/const hard = \$\('liftBanner'\)\.hidden \? \[\] : chromeBoxes\(host, BANNER_HARD, 8, document\);/);
  });

  it('without hard cards an issue frames as before', () => {
    const f = issueFrame({ x0: 0, y0: 0, x1: 300, y1: 300 }, [{ x0: 0, y0: 0, x1: 300, y1: 250 }], null);
    expect(f.box).toEqual({ x0: 0, y0: 0, x1: 300, y1: 300 });
  });
});

describe('a tall model and the caption card (Z7)', () => {
  // Arbor: 58 m wide in plan, 115 m tall, its top third 38.9 m across
  const arbor = { w: 58.34, h: 115.1, top: 38.9 };

  it('at 1280 × 720 the usual framing draws the crown under the caption, so the model takes the clear column beside it', () => {
    const view: Box = { x0: 0, y0: 0, x1: 706, y1: 450 };
    const chrome = [pad({ x0: 15, y0: 15, x1: 545, y1: 51 }), pad({ x0: 479, y0: 63, x1: 691, y1: 105 }), pad({ x0: 31, y0: 313, x1: 675, y1: 347 }), pad({ x0: 59, y0: 365, x1: 647, y1: 431 })];
    const caption = pad({ x0: 15, y0: 63, x1: 415, y1: 194 });
    expect(restFrame(view, chrome, caption, arbor)).toBeNull();
    const crown = usualCrown(view, arbor, 0.57);
    expect(hits(crown, caption)).toBe(true);
    const box = restFrameClear(view, chrome, caption, arbor, 0.57)!;
    expect(box).not.toBeNull();
    for (const o of [...chrome, caption]) expect(hits(box, o)).toBe(false);
    // the middle of the clear column, not its far edge
    expect((box.x0 + box.x1) / 2).toBeLessThan(600);
  });

  it('at 1440 × 900 the crown already clears the caption: the usual framing stands, at full size', () => {
    const view: Box = { x0: 0, y0: 0, x1: 813, y1: 630 };
    const chrome = [pad({ x0: 15, y0: 15, x1: 545, y1: 51 }), pad({ x0: 562, y0: 15, x1: 798, y1: 198 }), pad({ x0: 31, y0: 493, x1: 782, y1: 527 }), pad({ x0: 112, y0: 545, x1: 701, y1: 611 })];
    const caption = pad({ x0: 15, y0: 63, x1: 415, y1: 194 });
    expect(restFrameClear(view, chrome, caption, arbor, 0.57)).toBeNull();
    // a long spec widens the caption over the crown: the model moves clear of it
    const wide = pad({ x0: 15, y0: 63, x1: 481, y1: 194 });
    const box = restFrameClear(view, chrome, wide, arbor, 0.57)!;
    expect(box).not.toBeNull();
    for (const o of [...chrome, wide]) expect(hits(box, o)).toBe(false);
  });

  it('a model restFrame finds room for keeps that framing', () => {
    const view: Box = { x0: 0, y0: 0, x1: 706, y1: 450 };
    const duplex = { w: 17.8, h: 6.6, top: 17.8 };
    const chrome = [pad({ x0: 15, y0: 15, x1: 545, y1: 51 }), pad({ x0: 447, y0: 63, x1: 691, y1: 105 }), pad({ x0: 31, y0: 313, x1: 675, y1: 347 })];
    const caption = pad({ x0: 15, y0: 63, x1: 330, y1: 140 });
    const box = restFrame(view, chrome, caption, duplex);
    expect(box).not.toBeNull();
    expect(restFrameClear(view, chrome, caption, duplex, 0.57)).toEqual(box);
  });

  it("main uses it everywhere but a phone's opening frame (which keeps the model full size while the caption steps aside)", () => {
    expect(MAIN).toMatch(/const box = isNarrow\(\) && hero \? restFrame\(bounds, chrome, caption, model\) : restFrameClear\(bounds, restChrome, caption, model, w > 700 \? 0\.57 : 0\.5\);/);
  });
});
