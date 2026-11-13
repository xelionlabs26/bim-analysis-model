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
  const inside = obstacles.filter((o) => o.x1 > bounds.x0 && o.x0 < bounds.x1 && o.y1 > bounds.y0 && o.y0 < bounds.y1);
  const lines = (lo: number, hi: number, vals: number[]) => [...new Set([lo, hi, ...vals.map((v) => Math.min(hi, Math.max(lo, v)))])].sort((a, b) => a - b);
  const xs = lines(bounds.x0, bounds.x1, inside.flatMap((o) => [o.x0, o.x1]));
  const ys = lines(bounds.y0, bounds.y1, inside.flatMap((o) => [o.y0, o.y1]));
  let best: Box = { x0: bounds.x0, y0: bounds.y0, x1: bounds.x0, y1: bounds.y0 };
  let bestSide = -1, bestArea = -1;
  for (let a = 0; a < xs.length; a++)
    for (let b = a + 1; b < xs.length; b++)
      for (let c = 0; c < ys.length; c++)
        for (let d = c + 1; d < ys.length; d++) {
          const box = { x0: xs[a], x1: xs[b], y0: ys[c], y1: ys[d] };
          const side = boxSide(box), area = width(box) * height(box);
          if (side < bestSide || (side === bestSide && area <= bestArea)) continue;
          if (inside.some((o) => overlap(box, o) > 0)) continue;
          best = box;
          bestSide = side;
          bestArea = area;
        }
  return best;
}

/** Where a selected issue is framed: the box to centre it in, and whether the caption card steps aside for it. */
export interface IssueFrame {
  box: Box;
  hideCaption: boolean;
}

/**
 * Frame an issue clear of the viewport's chrome. The caption card stays when
 * the space it leaves is nearly as good as the space without it, or roomy
 * anyway (`enough` pixels square); on a smaller screen it steps aside (the
 * issue card in the panel says the same). When even that leaves too little
 * room, the whole viewport is used.
 */
export function issueFrame(bounds: Box, chrome: Box[], caption: Box | null, keep = 0.8, least = 0.35, enough = 380): IssueFrame {
  const without = clearBox(bounds, chrome);
  const full = boxSide(bounds);
  if (caption) {
    const withCaption = clearBox(bounds, [...chrome, caption]);
    const side = boxSide(withCaption);
    if ((side >= keep * boxSide(without) || side >= enough) && side >= least * full) return { box: withCaption, hideCaption: false };
  }
  if (boxSide(without) >= least * full) return { box: without, hideCaption: !!caption };
  return { box: bounds, hideCaption: !!caption };
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
