import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildProject } from '../src/data/project';
import { Timeline } from '../src/engine/timeline';
import { DATUM_HALF, DATUM_RIGHT, datumStrip } from '../src/ui/overlays';
import { heroLayout, restFrame, restFrameClear, type Box } from '../src/ui/place';
import { cranePlanNote, planLeaveNote } from '../src/ui/present';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const MAIN = read('../src/main.ts');
const OVERLAYS = read('../src/ui/overlays.ts');
const CSS = read('../src/styles.css');

const hits = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const pad = (b: Box, p = 8): Box => ({ x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p });
const around = (at: { x: number; y: number }, size: { w: number; h: number }): Box => ({ x0: at.x - size.w / 2, y0: at.y - size.h / 2, x1: at.x + size.w / 2, y1: at.y + size.h / 2 });
const fn = (src: string, head: RegExp) => src.match(new RegExp(`${head.source}[\\s\\S]*?\\n\\}`))?.[0] ?? '';

describe('the crane plan says which way the crane is when the playhead leaves its time on site (X1)', () => {
  const arbor = buildProject();
  const tl = new Timeline(arbor);

  it('tells the time before the crane goes up from the time after it is struck', () => {
    expect(tl.erectT).toBeGreaterThan(0.2);
    expect(tl.craneSide(0.2)).toBe('before');
    expect(tl.craneSide(tl.erectT)).toBe('up');
    expect(tl.craneSide(10)).toBe('up');
    expect(tl.craneSide(tl.presentation.strikeT)).toBe('gone');
    expect(tl.craneSide(arbor.duration)).toBe('gone');
    // craneUp agrees with it
    for (const t of [0.2, 10, 25]) expect(tl.craneUp(t)).toBe(tl.craneSide(t) === 'up');
    expect(new Timeline({ ...arbor, crane: null }).craneSide(10)).toBeNull();
  });

  it('says the crane is not up yet before it goes up, and struck only after the strike', () => {
    expect(planLeaveNote('up', 'before')).toBe('early');
    expect(planLeaveNote('up', 'gone')).toBe('gone');
    // straight from one side to the other: the new side is what it says
    expect(planLeaveNote('gone', 'before')).toBe('early');
    expect(planLeaveNote('before', 'gone')).toBe('gone');
    // nothing while the crane stands, or on the same side, or without a crane
    expect(planLeaveNote('before', 'up')).toBeNull();
    expect(planLeaveNote('gone', 'gone')).toBeNull();
    expect(planLeaveNote('before', 'before')).toBeNull();
    expect(planLeaveNote('up', null)).toBeNull();
    const early = cranePlanNote('TC-1', 'early');
    expect(early).toBe('TC-1 is not up yet here, so the plan has no reach to show. Step forward to see it.');
    expect(early).not.toMatch(/struck|back/);
    expect(cranePlanNote('TC-1', 'gone')).toMatch(/struck here.*Step back/);
  });

  it('is wired: each frame with the plan open picks the note by side, and a model loaded with the plan open plays from the first lift', () => {
    expect(MAIN).toMatch(/const side = timeline\.craneSide\(state\.t\);\s*const note = planLeaveNote\(planSide, side\);\s*if \(note\) \{\s*planToast = cranePlanNote\(/);
    expect(MAIN).not.toMatch(/cranePlanNote\([^)]*'gone'\)/);
    const play = fn(MAIN, /function playLoaded\(\) \{/);
    expect(play).toMatch(/view\.cranePlan \? timeline\.planTime\(0\) : null/);
    expect(play).toMatch(/playback\.seek\(at \?\? 0\);/);
    expect(play).toMatch(/planSide = timeline\.craneSide\(at \?\? 0\);/);
    // Import > Arbor House and an IFC import both go through it
    expect(MAIN.match(/mount\(buildProject\(\)\);\s*playLoaded\(\);/g)?.length).toBe(1);
    expect(MAIN).toMatch(/mount\(p\);\s*playLoaded\(\);/);
    expect(MAIN).not.toMatch(/mount\([^)]*\);\s*playback\.seek\(0\);/);
    // the plan's first lift is a time the crane stands
    expect(tl.craneSide(tl.planTime(0)!)).toBe('up');
  });
});

describe('the large Play button keeps off the level datums (X2)', () => {
  // 1280 × 720, the Duplex: the viewport is 706 × 450; boxes as measured in the browser, padded 8 px
  const w = 706, h = 450;
  const bounds: Box = { x0: 0, y0: 0, x1: w, y1: h };
  const frame = [pad({ x0: 15, y0: 15, x1: 545, y1: 51 }), pad({ x0: 447, y0: 63, x1: 691, y1: 105 }), pad({ x0: 31, y0: 313, x1: 675, y1: 347 }), pad({ x0: 59, y0: 365, x1: 647, y1: 431 })];
  const caption = pad({ x0: 15, y0: 63, x1: 429, y1: 210 });
  const scale = pad({ x0: 31, y0: 260, x1: 158, y1: 299 });
  const modelStrip: Box = { x0: w - 112, y0: 0, x1: w, y1: h };
  const size = { w: 286, h: 78 };
  const duplex = { w: 22, h: 7.9 };
  const strip = datumStrip(w, h);

  it('covers the datum rows as drawn: the code, the tick, the value and the dash', () => {
    const x = w - DATUM_RIGHT;
    expect(strip.x0).toBeLessThanOrEqual(x - DATUM_HALF);
    expect(strip.x1).toBe(w);
    expect(strip.y0).toBe(0);
    expect(strip.y1).toBe(h);
    expect(OVERLAYS).toMatch(/const x = w - DATUM_RIGHT;/);
    expect(OVERLAYS).toMatch(/box: \{ x0: x - DATUM_HALF, y0: p\.y - 9, x1: x \+ DATUM_HALF, y1: p\.y \+ 8 \}/);
  });

  it('puts the button where the scale bar is when nothing else leaves it room beside the model, never on the datums', () => {
    const cards = [...frame, caption, strip];
    // with the scale bar kept as well there is no room for both at a fair size
    expect(heroLayout(bounds, [...cards, scale], [...frame, scale, modelStrip], caption, duplex, size, 0.57)).toBeNull();
    const lay = heroLayout(bounds, cards, [...frame, scale, modelStrip], caption, duplex, size, 0.57)!;
    expect(lay).not.toBeNull();
    const b = around(lay.at, size);
    expect(hits(b, strip)).toBe(false);
    for (const o of [...frame, caption]) expect(hits(b, o)).toBe(false);
    expect(hits(b, lay.rest)).toBe(false);
    // the model keeps off the cards and the scale bar's place, and keeps a fair size
    for (const o of [...frame, caption, scale, modelStrip]) expect(hits(lay.rest, o)).toBe(false);
    const s = Math.min((lay.rest.x1 - lay.rest.x0) / duplex.w, (lay.rest.y1 - lay.rest.y0) / duplex.h);
    expect(s).toBeGreaterThanOrEqual(0.3 * Math.min(w / duplex.w, h / duplex.h));
    // the button the old way, at the viewport's right edge, sat on the datums
    expect(hits({ x0: 411, y0: 219, x1: 695, y1: 297 }, strip)).toBe(true);
  });

  it('is wired: the button keeps off the strip, the scale bar first if it can, and the bar steps aside while the button is over it', () => {
    const rest = fn(MAIN, /function syncRestBox\(\): boolean \{/);
    expect(rest).toMatch(/\[\.\.\.chromeBoxes\(\$\('viewport'\), HERO_CARDS, 8, document\), datumStrip\(w, h\)\]/);
    expect(rest).toMatch(/layout\(\[\.\.\.cards, \.\.\.scaleBar\]\) \?\? layout\(cards\)/);
    expect(rest).toMatch(/heroLayout\(bounds, button, \[\.\.\.chrome, \.\.\.scaleBar, DATUM_STRIP\(w, h\)\]/);
    expect(MAIN).toMatch(/const HERO_CARDS = HERO_CHROME\.replace\('#scaleBar, ', ''\);/);
    expect(MAIN).toMatch(/const HERO_CHROME = '[^']*#scaleBar, /);
    // the button placed beside the model as drawn keeps off the strip too
    expect(fn(MAIN, /function placeHero\(/)).toMatch(/const datums = isNarrow\(\) \? \[\] : \[datumStrip\(r\.width, r\.height\)\];/);
    expect(fn(MAIN, /function placeHero\(/).match(/scaleUnderHero\(\);/g)?.length).toBe(2);
    expect(fn(MAIN, /function scaleUnderHero\(\) \{/)).toMatch(/sb\.classList\.toggle\('under-hero', under\);/);
    expect(CSS).toMatch(/\.scalebar\.under-hero \{ visibility: hidden; \}/);
  });
});

describe('on a phone the step being placed is not drawn behind the caption (X3)', () => {
  // iPhone 13 (390 × 664): the viewport is 358 × 478; the toolbar, the caption and the pinned play bar, as measured, padded 8 px
  const bounds: Box = { x0: 0, y0: 0, x1: 358, y1: 478 };
  const chrome = [pad({ x0: 15, y0: 15, x1: 343, y1: 95 }), pad({ x0: 2, y0: 451, x1: 356, y1: 497 }), pad({ x0: -4, y0: 499, x1: 362, y1: 543 })];
  const caption = pad({ x0: 15, y0: 107, x1: 343, y1: 225 });
  const arbor = { w: 58.34, h: 115.1, top: 38.9 };

  it('frames the tower below the caption once the opening frame is over', () => {
    // the opening frame's framing finds no clear box: the usual framing draws the middle of the tower under the caption
    expect(restFrame(bounds, chrome, caption, arbor)).toBeNull();
    const box = restFrameClear(bounds, chrome, caption, arbor, 0.5)!;
    expect(box).not.toBeNull();
    for (const o of [...chrome, caption]) expect(hits(box, o)).toBe(false);
    expect(box.y0).toBeGreaterThanOrEqual(caption.y1);
    // smaller, but at a fair size
    const s = Math.min((box.x1 - box.x0) / arbor.w, (box.y1 - box.y0) / arbor.h);
    expect(s).toBeGreaterThanOrEqual(0.35 * Math.min(358 / arbor.w, 478 / arbor.h));
  });

  it('is wired: the opening frame on a phone keeps the full size; after it the caption is kept clear, framed below its deepest foot', () => {
    const rest = fn(MAIN, /function syncRestBox\(\): boolean \{/);
    expect(rest).toMatch(/const box = isNarrow\(\) && hero \? restFrame\(bounds, chrome, caption, model\) : restFrameClear\(/);
    expect(rest).toMatch(/if \(caption && isNarrow\(\)\) \{/);
    expect(rest).toMatch(/captionFoot\.y1 = Math\.max\(captionFoot\.y1, caption\.y1\);\s*caption = \{ \.\.\.caption, y1: captionFoot\.y1 \};/);
    // a new size or a new model starts again
    expect(rest).toMatch(/captionFoot\?\.w !== w \|\| captionFoot\.h !== h \|\| captionFoot\.p !== project/);
    // dropping the large Play button frames the model again
    expect(fn(MAIN, /function syncHero\(\) \{/)).toMatch(/syncRestBox\(\);/);
  });
});

describe('the scale bar reads over the model (X4)', () => {
  it('backs its words and its open segments with paper', () => {
    expect(CSS).toMatch(/\.scalebar \{ --sb-halo: [^}]*var\(--paper\)/);
    expect(CSS).toMatch(/\.sb-labels span \{[^}]*text-shadow: var\(--sb-halo\);/);
    expect(CSS).toMatch(/\.sb-scale \{[^}]*text-shadow: var\(--sb-halo\);/);
    expect(CSS).toMatch(/\.sb-bar \{[^}]*background: var\(--paper\);/);
    // the filled segments stay ink
    expect(CSS).toMatch(/\.sb-bar i:nth-child\(odd\) \{ background: var\(--ink\); \}/);
  });
});

describe('round-five final findings', () => {
  const MAIN5 = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const OVER5 = readFileSync(new URL('../src/ui/overlays.ts', import.meta.url), 'utf8');
  const VIEW5 = readFileSync(new URL('../src/scene/viewer.ts', import.meta.url), 'utf8');
  const CSS5 = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  it('Rebuild goes through playLoaded, so the crane plan starts from the first lift', () => {
    expect(MAIN5).toMatch(/rebuild: \(\) => playLoaded\(\),/);
  });
  it('takes the crane plan note down once the playhead is back in the crane\'s time', () => {
    expect(MAIN5).toMatch(/side === 'up' && planSide !== 'up' && planToast[\s\S]{0,120}hideToast\(\)/);
  });
  it('fades a level datum a crane label came to rest on', () => {
    expect(OVER5).toMatch(/this\.clearDatumsUnderLabels\(host\);/);
    expect(OVER5).toMatch(/this\.datumRows = rows\.map\(\(r\) => r\.box\);/);
  });
  it('frames a step placed below grade (piles)', () => {
    expect(MAIN5).toMatch(/stepBelow\(state\)\);/);
    expect(VIEW5).toMatch(/this\.fitDistance\(frameTop \+ deep, half\)/);
  });
  it('keeps a long zone name apart from its count', () => {
    expect(CSS5).toMatch(/\.zones div \{[^}]*gap: 8px/);
  });
});
