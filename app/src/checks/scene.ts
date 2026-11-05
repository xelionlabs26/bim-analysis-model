/**
 * Geometry for the buildability checks. Every part is either an oriented box
 * (generated parts) or a triangle mesh (imported parts). The scene keeps their
 * bounds, answers exact ray queries against both, and indexes them in a
 * uniform 3D grid for neighbourhood queries. App axes: metres, +Y up.
 */
import type { MeshData, Project, Vec3 } from '../data/types';

/** What a part is for, as far as the checks care. */
export type Role = 'structure' | 'envelope' | 'fitout' | 'landscape' | 'setout';

/** Centre, unit axes and half extents of an oriented box. */
export interface Obb {
  c: Vec3;
  ax: [Vec3, Vec3, Vec3];
  h: Vec3;
}

const EPS = 1e-9;

export class CheckScene {
  readonly n: number;
  readonly min: Float64Array;
  readonly max: Float64Array;
  /** Install step of each part. */
  readonly step: Int32Array;
  readonly role: Role[];
  /** Element kind: the IFC category for imported parts, derived for generated ones. */
  readonly cat: string[];
  /** A closed volume (a box, or a closed mesh) whose inside can be tested. */
  readonly solid: Uint8Array;
  readonly obb: (Obb | null)[];
  readonly mesh: (MeshData | null)[];
  /** Lowest part bottom: the dig level. */
  readonly groundY: number;
  private readonly cell: Vec3;
  private readonly origin: Vec3;
  private readonly dims: [number, number, number];
  private readonly cells = new Map<number, number[]>();
  private stamp: Int32Array;
  private stampId = 0;

  constructor(readonly project: Project) {
    const parts = project.parts;
    const n = (this.n = parts.length);
    this.min = new Float64Array(n * 3);
    this.max = new Float64Array(n * 3);
    this.step = new Int32Array(n);
    this.role = new Array(n);
    this.cat = new Array(n);
    this.solid = new Uint8Array(n);
    this.obb = new Array(n).fill(null);
    this.mesh = new Array(n).fill(null);
    this.stamp = new Int32Array(n);
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const p = parts[i];
      this.step[i] = p.step;
      let a: Vec3, b: Vec3;
      if (p.mesh !== undefined) {
        const m = project.meshes[p.mesh];
        this.mesh[i] = m;
        this.solid[i] = m.closed ? 1 : 0;
        a = m.min;
        b = m.max;
      } else {
        const o = obbOf(p.pos, p.size, p.quat);
        this.obb[i] = o;
        this.solid[i] = 1;
        const e = [0, 1, 2].map((k) => Math.abs(o.ax[0][k]) * o.h[0] + Math.abs(o.ax[1][k]) * o.h[1] + Math.abs(o.ax[2][k]) * o.h[2]);
        a = [o.c[0] - e[0], o.c[1] - e[1], o.c[2] - e[2]];
        b = [o.c[0] + e[0], o.c[1] + e[1], o.c[2] + e[2]];
      }
      for (let k = 0; k < 3; k++) {
        this.min[i * 3 + k] = a[k];
        this.max[i * 3 + k] = b[k];
        lo[k] = Math.min(lo[k], a[k]);
        hi[k] = Math.max(hi[k], b[k]);
      }
      const k = classifyPart(project, i);
      this.role[i] = k.role;
      this.cat[i] = k.cat;
    }
    this.groundY = Number.isFinite(lo[1]) ? lo[1] : 0;
    // grid cells sized to the model: about 40 across in plan, storey-ish in height
    const span = Math.max(hi[0] - lo[0], hi[2] - lo[2], 1);
    const c = Math.max(1, span / 40);
    this.cell = [c, Math.max(1.5, Math.min(4, c * 1.5)), c];
    this.origin = Number.isFinite(lo[0]) ? lo : [0, 0, 0];
    this.dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil((hi[k] - this.origin[k]) / this.cell[k]) + 1)) as [number, number, number];
    for (let i = 0; i < n; i++) {
      const [x0, y0, z0, x1, y1, z1] = this.cellRange(this.min.subarray(i * 3, i * 3 + 3), this.max.subarray(i * 3, i * 3 + 3));
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (let z = z0; z <= z1; z++) {
            const key = (x * this.dims[1] + y) * this.dims[2] + z;
            const list = this.cells.get(key);
            if (list) list.push(i);
            else this.cells.set(key, [i]);
          }
    }
  }

  lo(i: number): Vec3 {
    return [this.min[i * 3], this.min[i * 3 + 1], this.min[i * 3 + 2]];
  }
  hi(i: number): Vec3 {
    return [this.max[i * 3], this.max[i * 3 + 1], this.max[i * 3 + 2]];
  }
  centre(i: number): Vec3 {
    return [(this.min[i * 3] + this.max[i * 3]) / 2, (this.min[i * 3 + 1] + this.max[i * 3 + 1]) / 2, (this.min[i * 3 + 2] + this.max[i * 3 + 2]) / 2];
  }

  private cellRange(a: ArrayLike<number>, b: ArrayLike<number>) {
    const out: number[] = [];
    for (let k = 0; k < 3; k++) {
      out[k] = Math.min(this.dims[k] - 1, Math.max(0, Math.floor((a[k] - this.origin[k]) / this.cell[k])));
      out[k + 3] = Math.min(this.dims[k] - 1, Math.max(0, Math.floor((b[k] - this.origin[k]) / this.cell[k])));
    }
    return out;
  }

  /** Parts whose bounds overlap the box [a, b] (each once). */
  query(a: Vec3, b: Vec3): number[] {
    const [x0, y0, z0, x1, y1, z1] = this.cellRange(a, b);
    const id = ++this.stampId;
    if (id > 2e9) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    const out: number[] = [];
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const list = this.cells.get((x * this.dims[1] + y) * this.dims[2] + z);
          if (!list) continue;
          for (const i of list) {
            if (this.stamp[i] === this.stampId) continue;
            this.stamp[i] = this.stampId;
            const o = i * 3;
            if (this.max[o] < a[0] || this.min[o] > b[0] || this.max[o + 1] < a[1] || this.min[o + 1] > b[1] || this.max[o + 2] < a[2] || this.min[o + 2] > b[2]) continue;
            out.push(i);
          }
        }
    return out;
  }

  /**
   * Where the ray o + t·d crosses the part's surface: sorted parameters t and,
   * for each, +1 entering or −1 leaving (from the outward winding). Exact for
   * boxes and meshes; d need not be normalised.
   */
  crossings(i: number, o: Vec3, d: Vec3, tMin = -Infinity, tMax = Infinity): { t: number; s: number }[] {
    const box = this.obb[i];
    if (box) {
      const iv = rayObb(box, o, d);
      if (!iv) return [];
      const out: { t: number; s: number }[] = [];
      if (iv[0] >= tMin && iv[0] <= tMax) out.push({ t: iv[0], s: 1 });
      if (iv[1] >= tMin && iv[1] <= tMax) out.push({ t: iv[1], s: -1 });
      return out;
    }
    const m = this.mesh[i]!;
    if (!rayAabb(this.lo(i), this.hi(i), o, d, tMin, tMax)) return [];
    const P = m.positions, I = m.indices;
    const out: { t: number; s: number }[] = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const hx = d[1] * e2z - d[2] * e2y, hy = d[2] * e2x - d[0] * e2z, hz = d[0] * e2y - d[1] * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-12) continue; // parallel to the ray
      const inv = 1 / det;
      const sx = o[0] - P[a], sy = o[1] - P[a + 1], sz = o[2] - P[a + 2];
      const u = (sx * hx + sy * hy + sz * hz) * inv;
      if (u < -EPS || u > 1 + EPS) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (v < -EPS || u + v > 1 + EPS) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      // det = (e1 × e2)·(−d)·(−1): positive when the face looks against the ray, i.e. the ray enters
      if (tt >= tMin && tt <= tMax) out.push({ t: tt, s: det > 0 ? 1 : -1 });
    }
    // at one t, entries before exits: a face shared by touching shells keeps the count inside
    out.sort((x, y) => x.t - y.t || y.s - x.s);
    // a ray through a shared edge reports the same crossing twice; faces of touching shells
    // (opposite signs at one t) are both kept so the winding count stays right
    const dedup: { t: number; s: number }[] = [];
    for (const h of out) {
      const last = dedup[dedup.length - 1];
      if (last && last.s === h.s && h.t - last.t <= 1e-7) continue;
      dedup.push(h);
    }
    return dedup;
  }

  /** Surface crossings of the ray (unsigned), sorted. */
  hits(i: number, o: Vec3, d: Vec3, tMin = -Infinity, tMax = Infinity): number[] {
    return this.crossings(i, o, d, tMin, tMax).map((h) => h.t);
  }

  /**
   * Stretches of the ray inside a closed part, as [t0, t1] pairs, by winding
   * number: inside wherever more faces have been entered than left. Shells
   * that touch (boolean pieces) or overlap (separate items) read as one solid.
   */
  inside(i: number, o: Vec3, d: Vec3): [number, number][] {
    const box = this.obb[i];
    if (box) {
      const iv = rayObb(box, o, d);
      return iv ? [iv] : [];
    }
    const hs = this.crossings(i, o, d);
    const out: [number, number][] = [];
    let w = 0;
    let start = 0;
    for (const h of hs) {
      const before = w;
      w += h.s;
      if (before <= 0 && w > 0) start = h.t;
      else if (before > 0 && w <= 0 && h.t - start > 1e-9) out.push([start, h.t]);
    }
    // a non-zero count at the end means the mesh is not closed along this ray
    if (w !== 0) return [];
    // stretches that meet (shells touching across a face) are one
    const merged: [number, number][] = [];
    for (const iv of out) {
      const last = merged[merged.length - 1];
      if (last && iv[0] - last[1] <= 1e-7) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    return merged;
  }
}

/** The oriented box of a generated part. */
export function obbOf(pos: Vec3, size: Vec3, q: [number, number, number, number]): Obb {
  const [x, y, z, w] = q;
  const ax: [Vec3, Vec3, Vec3] = [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  ];
  return { c: [...pos], ax, h: [size[0] / 2, size[1] / 2, size[2] / 2] };
}

/** Entry and exit of a ray through an oriented box (slab method), or null. */
export function rayObb(b: Obb, o: Vec3, d: Vec3): [number, number] | null {
  let t0 = -Infinity, t1 = Infinity;
  const r: Vec3 = [o[0] - b.c[0], o[1] - b.c[1], o[2] - b.c[2]];
  for (let k = 0; k < 3; k++) {
    const a = b.ax[k];
    const e = r[0] * a[0] + r[1] * a[1] + r[2] * a[2];
    const f = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
    if (Math.abs(f) < 1e-12) {
      if (Math.abs(e) > b.h[k]) return null;
      continue;
    }
    let ta = (-b.h[k] - e) / f, tb = (b.h[k] - e) / f;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

function rayAabb(lo: Vec3, hi: Vec3, o: Vec3, d: Vec3, tMin: number, tMax: number): boolean {
  let t0 = tMin, t1 = tMax;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < lo[k] - 1e-9 || o[k] > hi[k] + 1e-9) return false;
      continue;
    }
    let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta - 1e-9);
    t1 = Math.min(t1, tb + 1e-9);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Role and kind of a part. Imported parts carry their IFC category and the
 * phase the sequencer gave them; generated parts are read from material and step.
 */
function classifyPart(p: Project, i: number): { role: Role; cat: string } {
  const part = p.parts[i];
  if (part.ref) {
    const phase = part.ref.phase ?? 'structure';
    const cat = part.ref.category;
    if (cat === 'site') return { role: 'setout', cat };
    if (cat === 'slab' && phase === 'fitout') return { role: 'fitout', cat: 'finish' };
    return { role: phase, cat };
  }
  const step = p.steps[part.step];
  const member = step?.member.toUpperCase() ?? '';
  const tall = part.size[1] >= Math.max(part.size[0], part.size[2]);
  switch (part.mat) {
    case 'stringline':
      return { role: 'setout', cat: 'setout' };
    case 'concrete':
      if (/PILE|RAFT|CRANE BASE|FOUND/.test(member)) return { role: 'structure', cat: 'foundation' };
      if (step?.kind === 'core' || /CORE|JUMP/.test(member)) return { role: 'structure', cat: 'wall' };
      if (/SLAB|DECK/.test(member) && !tall) return { role: 'structure', cat: 'slab' };
      return { role: 'structure', cat: tall ? 'column' : 'beam' };
    case 'glulam':
    case 'steel':
      return { role: 'structure', cat: tall ? 'column' : 'beam' };
    case 'clt':
      return { role: 'structure', cat: tall ? 'wall' : 'slab' };
    case 'glass':
    case 'aluminium':
    case 'terracotta':
      return { role: 'envelope', cat: 'curtainwall' };
    case 'pv':
      return { role: 'envelope', cat: 'pv' };
    case 'pod':
      return { role: 'fitout', cat: 'pod' };
    case 'soil':
    case 'planting':
      return { role: 'landscape', cat: 'landscape' };
    default:
      return { role: 'fitout', cat: 'other' };
  }
}
