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
