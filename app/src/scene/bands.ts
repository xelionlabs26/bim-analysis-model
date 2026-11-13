/**
 * The model's outline in slices of height, for keeping things drawn over the
 * viewport off it (the opening frame's large Play button). Each slice is a
 * cylinder about the camera's vertical orbit axis that holds every part in
 * it, so its outline on screen stays put while the view turns about that
 * axis: a tower's slim shaft and its wide podium each get their own.
 */

import type { Part } from '../data/types';

/** A slice of the model: its height range and its extent in plan (metres). */
export interface Band {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** The parts cut into `n` slices of equal height, each with the plan extent of the parts in it; empty slices are left out. */
export function heightBands(parts: Pick<Part, 'pos' | 'size'>[], n = 8): Band[] {
  if (!parts.length || n < 1) return [];
  let lo = Infinity, hi = -Infinity;
  for (const p of parts) {
    lo = Math.min(lo, p.pos[1] - p.size[1] / 2);
    hi = Math.max(hi, p.pos[1] + p.size[1] / 2);
  }
  if (!(hi > lo)) hi = lo + 1;
  const dy = (hi - lo) / n;
  const bands: Band[] = Array.from({ length: n }, (_, i) => ({ y0: lo + i * dy, y1: lo + (i + 1) * dy, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }));
  for (const p of parts) {
    const a = p.pos[1] - p.size[1] / 2, b = p.pos[1] + p.size[1] / 2;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor((a - lo) / dy)));
    const i1 = Math.max(0, Math.min(n - 1, Math.ceil((b - lo) / dy) - 1));
    for (let i = i0; i <= Math.max(i0, i1); i++) {
      const s = bands[i];
      s.x0 = Math.min(s.x0, p.pos[0] - p.size[0] / 2);
      s.x1 = Math.max(s.x1, p.pos[0] + p.size[0] / 2);
      s.z0 = Math.min(s.z0, p.pos[2] - p.size[2] / 2);
      s.z1 = Math.max(s.z1, p.pos[2] + p.size[2] / 2);
    }
  }
  return bands.filter((s) => s.x1 >= s.x0);
}

/** Radius of the cylinder about the vertical axis through (`ax`, `az`) that holds a slice's plan extent. */
export function bandRadius(b: Band, ax: number, az: number): number {
  const dx = Math.max(Math.abs(b.x0 - ax), Math.abs(b.x1 - ax));
  const dz = Math.max(Math.abs(b.z0 - az), Math.abs(b.z1 - az));
  return Math.hypot(dx, dz);
}

/**
 * The points on screen of a slice's cylinder about (`ax`, `az`): `k` round
 * its foot and its top, through `project` (world → screen pixels). Their box
 * is the slice's outline, the same whichever way the view is turned.
 */
export function bandOutline(
  b: Band,
  ax: number,
  az: number,
  project: (p: [number, number, number]) => { x: number; y: number; behind: boolean },
  k = 16,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const r = bandRadius(b, ax, az);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2;
    for (const y of [b.y0, b.y1]) {
      const s = project([ax + Math.cos(a) * r, y, az + Math.sin(a) * r]);
      if (s.behind) return null;
      x0 = Math.min(x0, s.x);
      x1 = Math.max(x1, s.x);
      y0 = Math.min(y0, s.y);
      y1 = Math.max(y1, s.y);
    }
  }
  return x1 >= x0 ? { x0, y0, x1, y1 } : null;
}
