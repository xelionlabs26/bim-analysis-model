/**
 * Where a label goes along a ring drawn on the ground: it hangs from one of
 * the ring's points, from any of its four corners, and takes the spot nearest
 * the angle it wants that stays on screen, clear of the viewport's controls,
 * and over as little of the other annotation as it can.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Something already on screen. `weight` Infinity: the label must not cover it at all. */
export interface Obstacle extends Box {
  weight: number;
}

/** A point of the ring on screen, with its angle about the ring's centre (radians). */
export interface RingPoint {
  x: number;
  y: number;
  a: number;
  behind?: boolean;
}

export interface Placement {
  /** Top-left of the label. */
  x: number;
  y: number;
  /** Index of the ring point and the corner it hangs from (kept for the next frame). */
  k: number;
  corner: number;
}

/** Turn between two angles, 0…π. */
export const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Corners a label hangs from: right-below, right-above, left-below, left-above. */
function corner(i: number, p: RingPoint, w: number, h: number, gap: number): Box {
  const x0 = i < 2 ? p.x + gap : p.x - gap - w;
  const y0 = i % 2 === 0 ? p.y + gap / 2 : p.y - gap / 2 - h;
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

/** Cost of covering annotation, in radians of turn: covering all of one weight-1 item ≈ 3 rad. */
const COVER = 3;
/** The previous spot is kept while it costs at most this much more than the best one. */
const STICK = 0.2;

export function placeOnRing(
  points: RingPoint[],
  size: { w: number; h: number },
  bounds: Box,
  obstacles: Obstacle[],
  prefer: number,
  prev: { k: number; corner: number } | null = null,
  gap = 8,
): Placement | null {
  const area = Math.max(1, size.w * size.h);
  const cost = (k: number, c: number): number => {
    const p = points[k];
    if (!p || p.behind) return Infinity;
    const b = corner(c, p, size.w, size.h, gap);
    if (b.x0 < bounds.x0 || b.y0 < bounds.y0 || b.x1 > bounds.x1 || b.y1 > bounds.y1) return Infinity;
    let covered = 0;
    for (const o of obstacles) {
      const a = overlap(b, o);
      if (a <= 0) continue;
      if (o.weight === Infinity) return Infinity;
      covered += (o.weight * a) / area;
    }
    // ties go to hanging right and below the ring, where a reader looks first
    return turn(p.a, prefer) + COVER * covered + c * 0.01;
  };
  let best: { k: number; c: number; v: number } | null = null;
  for (let k = 0; k < points.length; k++) {
    for (let c = 0; c < 4; c++) {
      const v = cost(k, c);
      if (v < Infinity && (!best || v < best.v)) best = { k, c, v };
    }
  }
  if (!best) return null;
  if (prev) {
    const v = cost(prev.k, prev.corner);
    if (v <= best.v + STICK) best = { k: prev.k, c: prev.corner, v };
  }
  const b = corner(best.c, points[best.k], size.w, size.h, gap);
  return { x: b.x0, y: b.y0, k: best.k, corner: best.c };
}

const width = (b: Box) => b.x1 - b.x0;
const height = (b: Box) => b.y1 - b.y0;
/** The side of the biggest square a box holds: what an object framed in it can grow to. */
export const boxSide = (b: Box) => Math.max(0, Math.min(width(b), height(b)));

/**
 * The biggest box inside `bounds` that overlaps none of the obstacles. A clear
 * box worth framing in is square-ish, so the widest square wins and area breaks
 * ties. Every maximal clear box has its sides on obstacle or bounds edges, so
 * only those lines are tried.
 */
export function clearBox(bounds: Box, obstacles: Box[]): Box {
  return bestClearBox(bounds, obstacles, (box) => boxSide(box) + (width(box) * height(box)) / 1e9) ?? { x0: bounds.x0, y0: bounds.y0, x1: bounds.x0, y1: bounds.y0 };
}

/**
 * The clear box (inside `bounds`, overlapping none of the obstacles) that
 * scores highest, or null when none does better than -Infinity. Every maximal
 * clear box has its sides on obstacle or bounds edges, so only those lines are
 * tried.
 */
export function bestClearBox(bounds: Box, obstacles: Box[], score: (b: Box) => number): Box | null {
  const inside = obstacles.filter((o) => o.x1 > bounds.x0 && o.x0 < bounds.x1 && o.y1 > bounds.y0 && o.y0 < bounds.y1);
  const lines = (lo: number, hi: number, vals: number[]) => [...new Set([lo, hi, ...vals.map((v) => Math.min(hi, Math.max(lo, v)))])].sort((a, b) => a - b);
  const xs = lines(bounds.x0, bounds.x1, inside.flatMap((o) => [o.x0, o.x1]));
  const ys = lines(bounds.y0, bounds.y1, inside.flatMap((o) => [o.y0, o.y1]));
  let best: Box | null = null;
  let bestScore = -Infinity;
  for (let a = 0; a < xs.length; a++)
    for (let b = a + 1; b < xs.length; b++)
      for (let c = 0; c < ys.length; c++)
        for (let d = c + 1; d < ys.length; d++) {
          const box = { x0: xs[a], x1: xs[b], y0: ys[c], y1: ys[d] };
          const s = score(box);
          if (!(s > bestScore)) continue;
          if (inside.some((o) => overlap(box, o) > 0)) continue;
          best = box;
          bestScore = s;
        }
  return best;
}

/**
 * Where the default framing fits a model `h` tall and `w` wide (any units, as
 * long as they match): the clear box, beside the caption as well as the other
 * cards, that shows the model largest; a tall tower takes a tall column, a
 * low, wide building a wide band. Null when no clear box gives the model at
 * least `least` of the scale the whole of `bounds` would.
 */
export function restFrame(bounds: Box, chrome: Box[], caption: Box | null, model: { w: number; h: number }, least = 0.5): Box | null {
  const mw = Math.max(1e-6, model.w), mh = Math.max(1e-6, model.h);
  const scale = (b: Box) => Math.min(width(b) / mw, height(b) / mh);
  const best = bestClearBox(bounds, caption ? [...chrome, caption] : chrome, scale);
  return best && scale(best) >= least * scale(bounds) ? best : null;
}

/**
 * Roughly where the usual framing (no rest box) draws the top third of a
 * model: fitted to the viewport's height (with headroom for the toolbar and
 * the transport) or its width, whichever is tighter, with its middle at
 * (`aimX`, ½) of the viewport. `model.top` is the width of the model's top
 * third in plan (a tower's crown); seen at an angle, it shows about 0.9 of
 * that across.
 */
export function usualCrown(bounds: Box, model: { w: number; h: number; top: number }, aimX: number): Box {
  const W = width(bounds), H = height(bounds);
  const px = Math.min(H / (1.32 * model.h + 8), W / (1.2 * Math.max(1e-6, model.w)));
  const cx = bounds.x0 + aimX * W, cy = bounds.y0 + H / 2;
  const y0 = cy - (model.h / 2) * px;
  const half = 0.45 * model.top * px;
  return { x0: cx - half, y0, x1: cx + half, y1: y0 + (model.h / 3) * px };
}

/**
 * The default framing's place for the model (restFrame), and, when no clear
 * box shows it at half its full size but the usual framing would draw its
 * top (a tower's crown) a third or more under the caption, the clear box
 * that shows it at a smaller size (`least`, as an issue is framed), nearest
 * the usual spot. A model the usual framing keeps off the caption keeps it
 * (null), at full size.
 */
export function restFrameClear(bounds: Box, chrome: Box[], caption: Box | null, model: { w: number; h: number; top: number }, aimX: number, least = 0.35): Box | null {
  const box = restFrame(bounds, chrome, caption, model);
  if (box || !caption) return box;
  const crown = usualCrown(bounds, model, aimX);
  const area = width(crown) * height(crown);
  if (!(area > 0) || overlap(crown, caption) < area / 3) return null;
  // of the boxes that show it as large, the one whose middle is nearest the usual spot (not the first found, at the edge)
  const mw = Math.max(1e-6, model.w), mh = Math.max(1e-6, model.h);
  const scale = (b: Box) => Math.min(width(b) / mw, height(b) / mh);
  const ax = bounds.x0 + aimX * width(bounds);
  const best = bestClearBox(bounds, [...chrome, caption], (b) => scale(b) - 1e-6 * Math.abs((b.x0 + b.x1) / 2 - ax));
  return best && scale(best) >= least * scale(bounds) ? best : null;
}

/** Where a selected issue is framed: the box to centre it in, and whether the caption card steps aside for it. */
export interface IssueFrame {
  box: Box;
  hideCaption: boolean;
}

/** How issueFrame weighs the room it is given. */
export interface IssueFrameOptions {
  /** The caption stays when the room it leaves is at least this share of the room without it … */
  keep?: number;
  /** … or at least this many pixels square. */
  enough?: number;
  /** A clear box smaller than this share of the viewport's side is too small to frame in. */
  least?: number;
  /**
   * Cards the subject is never framed under, even when the cards leave too
   * little room (the over-chart banner over the middle of a short viewport,
   * and the controls under it): the frame then takes the biggest box clear
   * of these alone rather than the whole viewport.
   */
  hard?: Box[];
}

/**
 * Frame an issue clear of the viewport's chrome. The caption card stays when
 * the space it leaves is nearly as good as the space without it, or roomy
 * anyway (`enough` pixels square); on a smaller screen it steps aside (the
 * issue card in the panel says the same). When even that leaves too little
 * room, the whole viewport is used, less any `hard` card.
 */
export function issueFrame(bounds: Box, chrome: Box[], caption: Box | null, o: IssueFrameOptions = {}): IssueFrame {
  const { keep = 0.8, least = 0.35, enough = 380, hard = [] } = o;
  const without = clearBox(bounds, [...chrome, ...hard]);
  const full = boxSide(bounds);
  if (caption) {
    const withCaption = clearBox(bounds, [...chrome, ...hard, caption]);
    const side = boxSide(withCaption);
    if ((side >= keep * boxSide(without) || side >= enough) && side >= least * full) return { box: withCaption, hideCaption: false };
  }
  if (boxSide(without) >= least * full) return { box: without, hideCaption: !!caption };
  const clear = hard.length ? clearBox(bounds, hard) : bounds;
  return { box: boxSide(clear) > 0 ? clear : bounds, hideCaption: !!caption };
}

/**
 * Top-left of a pin's label: up and to the right of the dot as a rule, else
 * the first other side that stays on screen and clear of the obstacles, else
 * the side that covers least of them. The dot itself never moves.
 */
export function pinLabel(dot: { x: number; y: number }, size: { w: number; h: number }, bounds: Box, obstacles: Box[], gap = { x: 26, y: 34 }): { x: number; y: number } {
  const spots = [
    { x: dot.x + gap.x, y: dot.y - gap.y - size.h / 2 }, // right, above
    { x: dot.x + gap.x, y: dot.y + gap.y - size.h / 2 }, // right, below
    { x: dot.x - gap.x - size.w, y: dot.y - gap.y - size.h / 2 }, // left, above
    { x: dot.x - gap.x - size.w, y: dot.y + gap.y - size.h / 2 }, // left, below
  ];
  const fit = (s: { x: number; y: number }) => ({
    x: Math.min(bounds.x1 - size.w, Math.max(bounds.x0, s.x)),
    y: Math.min(bounds.y1 - size.h, Math.max(bounds.y0, s.y)),
  });
  let best = fit(spots[0]);
  let least = Infinity;
  for (const s of spots) {
    const on = fit(s);
    const box = { x0: on.x, y0: on.y, x1: on.x + size.w, y1: on.y + size.h };
    // a spot pushed back onto the screen may land on the dot itself
    const onDot = dot.x > box.x0 - 8 && dot.x < box.x1 + 8 && dot.y > box.y0 - 8 && dot.y < box.y1 + 8;
    const covered = obstacles.reduce((a, o) => a + overlap(box, o), 0) + (onDot ? 1e6 : 0);
    if (covered === 0 && on.x === s.x && on.y === s.y) return on;
    if (covered < least) {
      least = covered;
      best = on;
    }
  }
  return best;
}

/**
 * Where the centre of a button `size` goes: in a clear box (inside `bounds`,
 * overlapping none of the obstacles) that holds it whole, at the point
 * nearest the middle of `bounds`; null when no clear box holds it, and the
 * button keeps its usual place. The opening frame's large Play button uses it
 * to stay off the caption, the toolbar and the title block.
 */
export function centreSpot(bounds: Box, obstacles: Box[], size: { w: number; h: number }): { x: number; y: number } | null {
  const mx = (bounds.x0 + bounds.x1) / 2, my = (bounds.y0 + bounds.y1) / 2;
  const spot = (b: Box) => ({
    x: Math.min(b.x1 - size.w / 2, Math.max(b.x0 + size.w / 2, mx)),
    y: Math.min(b.y1 - size.h / 2, Math.max(b.y0 + size.h / 2, my)),
  });
  const box = bestClearBox(bounds, obstacles, (b) => {
    if (width(b) < size.w || height(b) < size.h) return -Infinity;
    const s = spot(b);
    // nearest the middle; of two equally near, the roomier box
    return -Math.hypot(s.x - mx, s.y - my) + Math.min(width(b) - size.w, height(b) - size.h) * 1e-3;
  });
  return box ? spot(box) : null;
}

/** The opening frame's layout: the centre of the large Play button, and the box the model is framed in. */
export interface HeroLayout {
  at: { x: number; y: number };
  rest: Box;
}

/**
 * The opening frame: where the large Play button goes and the clear box the
 * model is framed in, chosen together so that neither covers the other. The
 * button stays off `buttonChrome` (the cards and controls, the caption among
 * them); the model stays off `modelChrome`, the caption and the button
 * (`clear` round it: more than `gap` where the model as drawn was found to
 * run past the box it was framed in). Of the button's spots (against an edge of the chrome or
 * of `bounds`, or in the middle), those that leave the model within `slack`
 * of its largest scale are kept, and of those the one that frames the model
 * nearest its usual spot (`aimX` across, half way down) wins: the button goes
 * aside, not the model. Null when no spot holds the button or leaves the
 * model at least `least` of the scale the whole of `bounds` would.
 */
export function heroLayout(
  bounds: Box,
  buttonChrome: Box[],
  modelChrome: Box[],
  caption: Box | null,
  model: { w: number; h: number },
  size: { w: number; h: number },
  aimX = 0.5,
  gap = 12,
  least = 0.3,
  slack = 0.9,
  clear = gap,
): HeroLayout | null {
  const mw = Math.max(1e-6, model.w), mh = Math.max(1e-6, model.h);
  const scale = (b: Box) => Math.min(width(b) / mw, height(b) / mh);
  const inside = buttonChrome.filter((o) => o.x1 > bounds.x0 && o.x0 < bounds.x1 && o.y1 > bounds.y0 && o.y0 < bounds.y1);
  const mx = (bounds.x0 + bounds.x1) / 2, my = (bounds.y0 + bounds.y1) / 2;
  const edges = (lo: number, hi: number, mid: number, len: number, vals: number[]) => [
    ...new Set([lo, hi - len, mid - len / 2, ...vals.flatMap((v) => [v, v - len])].map((v) => Math.round(v * 2) / 2)),
  ];
  const xs = edges(bounds.x0 + gap, bounds.x1 - gap, mx, size.w, inside.flatMap((o) => [o.x0, o.x1]));
  const ys = edges(bounds.y0 + gap, bounds.y1 - gap, my, size.h, inside.flatMap((o) => [o.y0, o.y1]));
  const fixed = caption ? [...modelChrome, caption] : modelChrome;
  const found: { at: { x: number; y: number }; rest: Box; s: number }[] = [];
  for (const x of xs)
    for (const y of ys) {
      const b = { x0: x, y0: y, x1: x + size.w, y1: y + size.h };
      // the button keeps `gap` off the viewport's sides, as off the chrome
      if (b.x0 < bounds.x0 + gap || b.y0 < bounds.y0 + gap || b.x1 > bounds.x1 - gap || b.y1 > bounds.y1 - gap) continue;
      if (inside.some((o) => overlap(b, o) > 0)) continue;
      const pad = { x0: b.x0 - clear, y0: b.y0 - clear, x1: b.x1 + clear, y1: b.y1 + clear };
      const rest = bestClearBox(bounds, [...fixed, pad], scale);
      if (rest) found.push({ at: { x: x + size.w / 2, y: y + size.h / 2 }, rest, s: scale(rest) });
    }
  if (!found.length) return null;
  const top = Math.max(...found.map((f) => f.s));
  if (top < least * scale(bounds)) return null;
  const ax = bounds.x0 + aimX * width(bounds);
  let best = found[0];
  let bestD = Infinity;
  for (const f of found) {
    if (f.s < slack * top) continue;
    const d = Math.hypot((f.rest.x0 + f.rest.x1) / 2 - ax, (f.rest.y0 + f.rest.y1) / 2 - my) + 1e-3 * Math.hypot(f.at.x - mx, f.at.y - my);
    if (d < bestD - 1e-6 || (Math.abs(d - bestD) <= 1e-6 && f.s > best.s)) {
      best = f;
      bestD = d;
    }
  }
  return { at: best.at, rest: best.rest };
}

/** How far two boxes run into each other: the least distance either must move to clear the other (0 when apart). */
export function overlapDepth(a: Box, b: Box): number {
  const x = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const y = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return x > 0 && y > 0 ? Math.min(x, y) : 0;
}
