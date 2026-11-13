import type { Project, Vec3 } from '../data/types';
import type { Issue } from './types';

/** A camera that frames an issue from outside the building, wide enough to show its context. */
export interface IssueView {
  target: Vec3;
  position: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
  az: number;
  el: number;
  dist: number;
}

export const ISSUE_FOV = 50; // inside BCF 2.1's 45–60° range

/** Plan bounds of the model, for placing issue cameras outside it. */
export interface ModelBounds {
  lo: Vec3;
  hi: Vec3;
}

export function modelBounds(p: Project): ModelBounds {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const part of p.parts) {
    if (part.mat === 'stringline') continue;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], part.pos[k] - part.size[k] / 2);
      hi[k] = Math.max(hi[k], part.pos[k] + part.size[k] / 2);
    }
  }
  return { lo, hi };
}

/**
 * Look at an issue from outside the building: from the side it is on, a little
 * oblique, far enough out to clear the façade, close enough to fill the frame.
 * `share` is the part of the view the issue may fill (width and height, 0–1):
 * less than all of it when cards over the viewport cover the rest.
 */
export function issueView(issue: Issue, aspect = 1.6, bounds?: ModelBounds, share: { w: number; h: number } = { w: 1, h: 1 }): IssueView {
  const [lo, hi] = issue.box;
  const target: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const r = Math.max(2.5, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
  const half = ((ISSUE_FOV * Math.PI) / 180) / 2;
  const part = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0.05, v)) : 1);
  const sw = part(share.w), sh = part(share.h);
  const fit = Math.min(Math.tan(half) * sh, Math.tan(half) * aspect * sw);
  let dist = (r / fit) * 1.05;
  let az = 35;
  const el = 24;
  if (bounds) {
    const cx = (bounds.lo[0] + bounds.hi[0]) / 2, cz = (bounds.lo[2] + bounds.hi[2]) / 2;
    const vx = target[0] - cx, vz = target[2] - cz;
    if (Math.hypot(vx, vz) > 1) az = (Math.atan2(vx, vz) * 180) / Math.PI + 30;
    // out past the façade along the view direction
    const a = (az * Math.PI) / 180;
    const dx = Math.sin(a), dz = Math.cos(a);
    const exit = Math.min(dx > 1e-6 ? (bounds.hi[0] - target[0]) / dx : dx < -1e-6 ? (bounds.lo[0] - target[0]) / dx : Infinity, dz > 1e-6 ? (bounds.hi[2] - target[2]) / dz : dz < -1e-6 ? (bounds.lo[2] - target[2]) / dz : Infinity);
    if (Number.isFinite(exit) && target[1] < bounds.hi[1] + 1) dist = Math.max(dist, (Math.max(0, exit) + 3) / Math.cos((el * Math.PI) / 180));
  }
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  const position: Vec3 = [target[0] + Math.sin(a) * Math.cos(e) * dist, target[1] + Math.sin(e) * dist, target[2] + Math.cos(a) * Math.cos(e) * dist];
  return { target, position, fov: ISSUE_FOV, az, el, dist };
}

/** App axes (metres, +Y up, recentred) → IFC world axes (metres, +Z up). */
export function toIfc(v: Vec3, offset: Vec3 = [0, 0, 0]): Vec3 {
  return [v[0] - offset[0], offset[2] - v[2], v[1] - offset[1]];
}

/** A direction in app axes → IFC axes (no offset). */
export const dirToIfc = (d: Vec3): Vec3 => [d[0], -d[2], d[1]];
