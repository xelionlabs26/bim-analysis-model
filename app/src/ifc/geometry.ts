/**
 * IFC geometry kernel: turns an element's Body representation into a
 * triangle mesh in world coordinates (file units, IFC axes: Z up).
 *
 * Supported: extrusions of rectangle / circle / I, L, T, U, C / hollow /
 * arbitrary (polyline, composite curve with arcs, indexed poly curve) profiles,
 * with voids; faceted Breps and surface models; IFC4 polygonal and
 * triangulated face sets; mapped items (with mirroring); boolean clipping by
 * half-spaces (capped); bounding boxes; swept disks (as square tubes).
 * Openings are cut from box-shaped extrusions (walls), added as holes to
 * profile extrusions (slabs), and cut across extrusions where a convex opening
 * passes through a band of constant cross-section (a sink through a worktop, a
 * hole through a beam web). Anything else is reported, not guessed.
 */
import earcut from 'earcut';
import { Ref, Typed, num, enumOf, bool, refs, type Entity, type StepFile, type StepValue } from './step';

export type V3 = [number, number, number];
export type V2 = [number, number];
/** Column-major 4×4 matrix, like three.js. */
export type M4 = Float64Array;

// ── small linear algebra ────────────────────────────────────────────────────

export const I4 = (): M4 => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function mul(a: M4, b: M4): M4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

export function basis(o: V3, x: V3, y: V3, z: V3): M4 {
  return new Float64Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1]);
}

export const tp = (m: M4, x: number, y: number, z: number): V3 => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];
export const td = (m: M4, x: number, y: number, z: number): V3 => [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];

export function det3(m: M4) {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
}

export function invertAffine(m: M4): M4 {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
  const G = b * f - c * e, H = -(a * f - c * d), K = a * e - b * d;
  const det = a * A + b * B + c * C;
  const s = Math.abs(det) < 1e-18 ? 0 : 1 / det;
  const r = new Float64Array(16);
  // inverse of the 3×3 (row/col as column-major)
  r[0] = A * s; r[1] = B * s; r[2] = C * s;
  r[4] = D * s; r[5] = E * s; r[6] = F * s;
  r[8] = G * s; r[9] = H * s; r[10] = K * s;
  r[15] = 1;
  const tx = m[12], ty = m[13], tz = m[14];
  r[12] = -(r[0] * tx + r[4] * ty + r[8] * tz);
  r[13] = -(r[1] * tx + r[5] * ty + r[9] * tz);
  r[14] = -(r[2] * tx + r[6] * ty + r[10] * tz);
  return r;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

// ── mesh builder ────────────────────────────────────────────────────────────

/** Triangle soup with shared vertices, double precision, in the builder's space. */
export class Mesh {
  pos: number[] = [];
  idx: number[] = [];
  /** Explicit feature edges (pairs of points); computed from triangles when absent. */
  edges: number[] = [];
  explicitEdges = true;
  /**
   * Offsets into idx where a new shell begins. Each representation item and each
   * piece of a boolean is a solid of its own; pieces may touch along faces, so
   * closedness and winding are checked shell by shell.
   */
  shells: number[] = [];

  get vertexCount() {
    return this.pos.length / 3;
  }

  beginShell() {
    const at = this.idx.length;
    if (at > 0 && this.shells[this.shells.length - 1] !== at) this.shells.push(at);
  }


  vert(p: V3): number {
    this.pos.push(p[0], p[1], p[2]);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  edge(a: V3, b: V3) {
    this.edges.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }

  /** Append another mesh transformed by m (mirroring flips the winding). */
  append(o: Mesh, m: M4 | null) {
    const base = this.vertexCount;
    const flip = m ? det3(m) < 0 : false;
    for (const sh of o.shells) {
      const at = this.idx.length + sh;
      if (this.shells[this.shells.length - 1] !== at) this.shells.push(at);
    }
    for (let i = 0; i < o.pos.length; i += 3) {
      const p = m ? tp(m, o.pos[i], o.pos[i + 1], o.pos[i + 2]) : ([o.pos[i], o.pos[i + 1], o.pos[i + 2]] as V3);
      this.pos.push(p[0], p[1], p[2]);
    }
    for (let i = 0; i < o.idx.length; i += 3) {
      if (flip) this.idx.push(base + o.idx[i], base + o.idx[i + 2], base + o.idx[i + 1]);
      else this.idx.push(base + o.idx[i], base + o.idx[i + 1], base + o.idx[i + 2]);
    }
    for (let i = 0; i < o.edges.length; i += 3) {
      const p = m ? tp(m, o.edges[i], o.edges[i + 1], o.edges[i + 2]) : ([o.edges[i], o.edges[i + 1], o.edges[i + 2]] as V3);
      this.edges.push(p[0], p[1], p[2]);
    }
    if (!o.explicitEdges) this.explicitEdges = false;
  }

  /** Add a planar polygon (outer + holes, 3D points) triangulated with earcut. */
  polygon(outer: V3[], holes: V3[][] = [], withEdges = true): void {
    if (outer.length < 3) return;
    const n = newellNormal(outer);
    if (len(n) < 1e-12) return;
    const z = norm(n);
    const ax: V3 = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(ax, z));
    const v = cross(z, u);
    const all = [outer, ...holes];
    const flat: number[] = [];
    const holeIdx: number[] = [];
    const base = this.vertexCount;
    for (const ring of all) {
      if (ring !== outer) holeIdx.push(flat.length / 2);
      for (const p of ring) {
        flat.push(dot(p, u), dot(p, v));
        this.vert(p);
      }
    }
    const t = earcut(flat, holeIdx.length ? holeIdx : null, 2);
    const X = (i: number) => flat[i * 2], Y = (i: number) => flat[i * 2 + 1];
    const area = (a: number, b: number, c: number) => (X(b) - X(a)) * (Y(c) - Y(a)) - (X(c) - X(a)) * (Y(b) - Y(a));
    const d2 = (a: number, b: number) => (X(a) - X(b)) ** 2 + (Y(a) - Y(b)) ** 2;
    const isFlat = (a: number, b: number, c: number) => Math.abs(area(a, b, c)) <= 1e-10 * Math.max(d2(a, b), d2(a, c), d2(b, c));
    // keep the winding that agrees with the polygon's own normal
    const tris: [number, number, number][] = [];
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i], b = t[i + 1], c = t[i + 2];
      tris.push(area(a, b, c) >= 0 ? [a, b, c] : [a, c, b]);
    }
    // earcut covers a vertex that sits on a straight run with a zero-area triangle, which
    // leaves a T-junction; split the triangle across the long edge at that vertex instead
    for (let guard = 0, changed = true; changed && guard < 64; guard++) {
      changed = false;
      for (let i = 0; i < tris.length; i++) {
        const [a, b, c] = tris[i];
        if (!isFlat(a, b, c)) continue;
        const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a);
        const [p, q, m] = ab >= bc && ab >= ca ? [a, b, c] : bc >= ca ? [b, c, a] : [c, a, b];
        const j = tris.findIndex((o, k) => k !== i && o.includes(p) && o.includes(q) && !isFlat(o[0], o[1], o[2]));
        if (j < 0) continue;
        const o = tris[j];
        const r = o.findIndex((x, k) => (x === p || x === q) && (o[(k + 1) % 3] === p || o[(k + 1) % 3] === q));
        const u = o[r], v = o[(r + 1) % 3], x = o[(r + 2) % 3];
        tris[j] = [u, m, x];
        tris.push([m, v, x]);
        tris.splice(i, 1);
        changed = true;
        break;
      }
    }
    for (const [a, b, c] of tris) this.tri(base + a, base + b, base + c);
    if (withEdges) for (const ring of all) for (let i = 0; i < ring.length; i++) this.edge(ring[i], ring[(i + 1) % ring.length]);
  }
}

function newellNormal(ring: V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

const area2 = (r: V2[]) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

/** Remove consecutive duplicates and the closing duplicate. */
function cleanRing(r: V2[], eps = 1e-9, dropCollinear = true): V2[] {
  const out: V2[] = [];
  for (const p of r) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > eps || Math.abs(q[1] - p[1]) > eps) out.push(p);
  }
  while (out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps) out.pop();
    else break;
  }
  // drop points that sit on a straight run (they leave T-junctions between caps and sides)
  for (let guard = 0, changed = dropCollinear; changed && out.length > 3 && guard < 4; guard++) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const abx = b[0] - a[0], aby = b[1] - a[1], bcx = c[0] - b[0], bcy = c[1] - b[1];
      const crossZ = abx * bcy - aby * bcx;
      const scaleLen = Math.hypot(abx, aby) * Math.hypot(bcx, bcy);
      if (scaleLen > 0 && Math.abs(crossZ) <= 1e-9 * scaleLen && abx * bcx + aby * bcy > 0) {
        out.splice(i, 1);
        i--;
        changed = true;
      }
    }
  }
  return out;
}

export interface Poly2 {
  outer: V2[];
  holes: V2[][];
}

// ── the kernel ──────────────────────────────────────────────────────────────

export interface GeometryReport {
  items: Map<string, number>; // representation item types meshed
  skipped: Map<string, number>; // item types not supported
  openingsCut: number;
  openingsSkipped: number;
  clipsApplied: number;
  booleansApproximated: number;
}

export class IfcGeometry {
  private placements = new Map<number, M4>();
  private axisCache = new Map<number, M4>();
  readonly report: GeometryReport = { items: new Map(), skipped: new Map(), openingsCut: 0, openingsSkipped: 0, clipsApplied: 0, booleansApproximated: 0 };
  /** Openings that cut at least one item; the caller counts the rest as not cut. */
  readonly opened = new Set<Mesh>();
  /** Plane angle unit in radians (degrees → π/180). */
  angleUnit = 1;
  /** Length unit in metres. */
  lengthUnit = 1;

  constructor(private readonly f: StepFile) {}

  private count(map: Map<string, number>, key: string) {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  // ── placements ──
  point(v: StepValue): V3 {
    const e = this.f.deref(v);
    if (!e) return [0, 0, 0];
    const c = e.args[0];
    if (!Array.isArray(c)) return [0, 0, 0];
    return [num(c[0]), num(c[1]), c.length > 2 ? num(c[2]) : 0];
  }

  direction(v: StepValue, fallback: V3): V3 {
    const e = this.f.deref(v);
    if (!e) return fallback;
    const c = e.args[0];
    if (!Array.isArray(c)) return fallback;
    const d: V3 = [num(c[0]), num(c[1]), c.length > 2 ? num(c[2]) : 0];
    return len(d) > 1e-12 ? norm(d) : fallback;
  }

  /** IfcAxis2Placement3D / 2D / IfcAxis1Placement → matrix. */
  axis2(v: StepValue): M4 {
    if (!(v instanceof Ref)) return I4();
    const hit = this.axisCache.get(v.id);
    if (hit) return hit;
    const e = this.f.get(v.id);
    let m = I4();
    if (e) {
      const o = this.point(e.args[0]);
      if (e.type === 'IFCAXIS2PLACEMENT2D') {
        const x = this.direction(e.args[1], [1, 0, 0]);
        const xn = norm([x[0], x[1], 0]);
        m = basis(o, xn, [-xn[1], xn[0], 0], [0, 0, 1]);
      } else if (e.type === 'IFCAXIS2PLACEMENT3D' || e.type === 'IFCAXIS1PLACEMENT') {
        const z = this.direction(e.args[1], [0, 0, 1]);
        let x = e.type === 'IFCAXIS1PLACEMENT' ? (Math.abs(z[0]) < 0.9 ? ([1, 0, 0] as V3) : ([0, 1, 0] as V3)) : this.direction(e.args[2], Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]);
        x = norm(sub(x, scale(z, dot(x, z))));
        if (len(x) < 1e-9) x = norm(cross(Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], z));
        const y = cross(z, x);
        m = basis(o, x, y, z);
      }
    }
    this.axisCache.set(v.id, m);
    return m;
  }

  /** IfcLocalPlacement chain → world matrix (file units). */
  placement(v: StepValue): M4 {
    if (!(v instanceof Ref)) return I4();
    const hit = this.placements.get(v.id);
    if (hit) return hit;
    const e = this.f.get(v.id);
    let m = I4();
    if (e?.type === 'IFCLOCALPLACEMENT') {
      const parent = e.args[0] instanceof Ref ? this.placement(e.args[0]) : I4();
      m = mul(parent, this.axis2(e.args[1]));
    }
    this.placements.set(v.id, m);
    return m;
  }

  /** IfcCartesianTransformationOperator3D (+NonUniform) → matrix. */
  transformOperator(v: StepValue): M4 {
    const e = this.f.deref(v);
    if (!e) return I4();
    const a = e.args;
    const o = this.point(a[2]);
    const s1 = typeof a[3] === 'number' ? a[3] : 1;
    const is2D = e.type.includes('2D');
    const z: V3 = is2D ? [0, 0, 1] : this.direction(a[4], [0, 0, 1]);
    let x = this.direction(a[0], [1, 0, 0]);
    x = norm(sub(x, scale(z, dot(x, z))));
    if (len(x) < 1e-9) x = norm(cross([0, 1, 0], z));
    // IfcSecondProjAxis: Axis2 defaults to +Y, made orthogonal to Z and X (so a lone Axis1 = −X mirrors)
    let yIn = this.direction(a[1], [0, 1, 0]);
    yIn = sub(yIn, scale(z, dot(yIn, z)));
    yIn = norm(sub(yIn, scale(x, dot(yIn, x))));
    if (len(yIn) < 1e-9) yIn = cross(z, x);
    const nonUniform = e.type.endsWith('NONUNIFORM');
    const s2 = nonUniform && typeof a[5] === 'number' ? a[5] : s1;
    const s3 = nonUniform && typeof a[6] === 'number' ? a[6] : s1;
    return basis(o, scale(x, s1), scale(yIn, s2), scale(z, s3));
  }

  // ── 2D curves and profiles ──

  /** Points along a 2D (or planar 3D, xy used) bounded curve, in order. */
  curve2(v: StepValue): V2[] {
    const e = this.f.deref(v);
    if (!e) return [];
    switch (e.type) {
      case 'IFCPOLYLINE':
        return refs(e.args[0]).map((id) => {
          const p = this.point(new Ref(id));
          return [p[0], p[1]] as V2;
        });
      case 'IFCCOMPOSITECURVE':
      case 'IFCCOMPOSITECURVEONSURFACE': {
        const out: V2[] = [];
        for (const sid of refs(e.args[0])) {
          const seg = this.f.get(sid);
          if (!seg) continue;
          const same = bool(seg.args[1]) !== false;
          let pts = this.curve2(seg.args[2]);
          if (!same) pts = pts.slice().reverse();
          for (const p of pts) out.push(p);
        }
        return out;
      }
      case 'IFCTRIMMEDCURVE':
        return this.trimmed(e);
      case 'IFCCIRCLE':
      case 'IFCELLIPSE':
        return this.conic(e, 0, Math.PI * 2, true);
      case 'IFCINDEXEDPOLYCURVE':
        return this.indexedPolyCurve(e);
      case 'IFCLINE':
        return [];
      default:
        this.count(this.report.skipped, e.type);
        return [];
    }
  }

  private conicFrame(e: Entity) {
    const m = this.axis2(e.args[0]);
    const r1 = num(e.args[1]);
    const r2 = e.type === 'IFCELLIPSE' ? num(e.args[2]) : r1;
    return { m, r1, r2 };
  }

  private conic(e: Entity, a0: number, a1: number, closed: boolean): V2[] {
    const { m, r1, r2 } = this.conicFrame(e);
    let span = a1 - a0;
    const steps = Math.max(4, Math.ceil(Math.abs(span) / (Math.PI / 18)));
    const out: V2[] = [];
    const n = closed ? steps : steps + 1;
    for (let i = 0; i < n; i++) {
      const t = a0 + (span * i) / steps;
      const p = tp(m, r1 * Math.cos(t), r2 * Math.sin(t), 0);
      out.push([p[0], p[1]]);
    }
    if (closed) span = 0;
    return out;
  }

  private trimmed(e: Entity): V2[] {
    const basisCurve = this.f.deref(e.args[0]);
    if (!basisCurve) return [];
    const sense = bool(e.args[3]) !== false;
    const trimParam = (t: StepValue): { param?: number; point?: V3 } => {
      const list = Array.isArray(t) ? t : [t];
      const out: { param?: number; point?: V3 } = {};
      for (const x of list) {
        if (x instanceof Typed && x.type === 'IFCPARAMETERVALUE') out.param = num(x.value);
        else if (x instanceof Ref) out.point = this.point(x);
      }
      return out;
    };
    const t1 = trimParam(e.args[1]);
    const t2 = trimParam(e.args[2]);
    if (basisCurve.type === 'IFCCIRCLE' || basisCurve.type === 'IFCELLIPSE') {
      const { m, r1, r2 } = this.conicFrame(basisCurve);
      const inv = invertAffine(m);
      const angleOf = (tr: { param?: number; point?: V3 }) => {
        if (tr.param !== undefined) return tr.param * this.angleUnit;
        if (tr.point) {
          const q = tp(inv, tr.point[0], tr.point[1], tr.point[2]);
          return Math.atan2(q[1] / r2, q[0] / r1);
        }
        return 0;
      };
      let a0 = angleOf(t1);
      let a1 = angleOf(t2);
      if (sense) {
        while (a1 <= a0 + 1e-9) a1 += Math.PI * 2;
      } else {
        while (a1 >= a0 - 1e-9) a1 -= Math.PI * 2;
      }
      return this.conic(basisCurve, a0, a1, false);
    }
    if (basisCurve.type === 'IFCLINE') {
      const p = this.point(basisCurve.args[0]);
      const vec = this.f.deref(basisCurve.args[1]);
      const dir = vec ? this.direction(vec.args[0], [1, 0, 0]) : ([1, 0, 0] as V3);
      const mag = vec ? num(vec.args[1], 1) : 1;
      const at = (tr: { param?: number; point?: V3 }): V2 => {
        if (tr.point) return [tr.point[0], tr.point[1]];
        const s = tr.param ?? 0;
        return [p[0] + dir[0] * mag * s, p[1] + dir[1] * mag * s];
      };
      const a = at(t1), b = at(t2);
      return sense ? [a, b] : [b, a];
    }
    const pts = this.curve2(e.args[0]);
    return sense ? pts : pts.reverse();
  }

  private indexedPolyCurve(e: Entity): V2[] {
    const list = this.f.deref(e.args[0]);
    if (!list) return [];
    const coords = list.args[0];
    if (!Array.isArray(coords)) return [];
    const P = (i: number): V2 => {
      const c = coords[i - 1];
      return Array.isArray(c) ? [num(c[0]), num(c[1])] : [0, 0];
    };
    const segs = e.args[1];
    if (!Array.isArray(segs) || !segs.length) return coords.map((_, i) => P(i + 1));
    const out: V2[] = [];
    for (const s of segs) {
      if (!(s instanceof Typed) || !Array.isArray(s.value)) continue;
      const ids = s.value.map((x) => num(x));
      if (s.type === 'IFCLINEINDEX') for (const i of ids) out.push(P(i));
      else if (s.type === 'IFCARCINDEX' && ids.length === 3) {
        const [a, b, c] = ids.map(P);
        for (const p of arcThrough(a, b, c)) out.push(p);
      }
    }
    return out;
  }

  /** Profile definition → polygons with holes, in the profile's 2D space. */
  profile(v: StepValue): Poly2[] {
    const e = this.f.deref(v);
    if (!e) return [];
    const a = e.args;
    const pos2 = (i: number) => (a[i] instanceof Ref ? this.axis2(a[i]) : I4());
    const place = (m: M4, ring: V2[]): V2[] => ring.map(([x, y]) => {
      const p = tp(m, x, y, 0);
      return [p[0], p[1]] as V2;
    });
    const rect = (w: number, h: number): V2[] => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    const circle = (r: number, n = 24): V2[] => Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * Math.PI * 2), r * Math.sin((i / n) * Math.PI * 2)] as V2);
    switch (e.type) {
      case 'IFCRECTANGLEPROFILEDEF':
      case 'IFCROUNDEDRECTANGLEPROFILEDEF':
        return [{ outer: place(pos2(2), rect(num(a[3]), num(a[4]))), holes: [] }];
      case 'IFCRECTANGLEHOLLOWPROFILEDEF': {
        const w = num(a[3]), h = num(a[4]), t = num(a[5]);
        return [{ outer: place(pos2(2), rect(w, h)), holes: [place(pos2(2), rect(w - 2 * t, h - 2 * t).reverse())] }];
      }
      case 'IFCCIRCLEPROFILEDEF':
        return [{ outer: place(pos2(2), circle(num(a[3]))), holes: [] }];
      case 'IFCCIRCLEHOLLOWPROFILEDEF': {
        const r = num(a[3]), t = num(a[4]);
        return [{ outer: place(pos2(2), circle(r)), holes: [place(pos2(2), circle(r - t).reverse())] }];
      }
      case 'IFCELLIPSEPROFILEDEF': {
        const r1 = num(a[3]), r2 = num(a[4]);
        return [{ outer: place(pos2(2), circle(1).map(([x, y]) => [x * r1, y * r2] as V2)), holes: [] }];
      }
      case 'IFCISHAPEPROFILEDEF':
      case 'IFCASYMMETRICISHAPEPROFILEDEF': {
        const b = num(a[3]), h = num(a[4]), tw = num(a[5]), tf = num(a[6]);
        const ring: V2[] = [[-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, -h / 2 + tf], [tw / 2, -h / 2 + tf], [tw / 2, h / 2 - tf], [b / 2, h / 2 - tf], [b / 2, h / 2], [-b / 2, h / 2], [-b / 2, h / 2 - tf], [-tw / 2, h / 2 - tf], [-tw / 2, -h / 2 + tf], [-b / 2, -h / 2 + tf]];
        return [{ outer: place(pos2(2), ring), holes: [] }];
      }
      case 'IFCLSHAPEPROFILEDEF': {
        const d = num(a[3]), w = a[4] === null ? d : num(a[4]), t = num(a[5]);
        return [{ outer: place(pos2(2), [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, -d / 2 + t], [-w / 2 + t, -d / 2 + t], [-w / 2 + t, d / 2], [-w / 2, d / 2]]), holes: [] }];
      }
      case 'IFCTSHAPEPROFILEDEF': {
        const d = num(a[3]), b = num(a[4]), tw = num(a[5]), tf = num(a[6]);
        return [{ outer: place(pos2(2), [[-tw / 2, -d / 2], [tw / 2, -d / 2], [tw / 2, d / 2 - tf], [b / 2, d / 2 - tf], [b / 2, d / 2], [-b / 2, d / 2], [-b / 2, d / 2 - tf], [-tw / 2, d / 2 - tf]]), holes: [] }];
      }
      case 'IFCUSHAPEPROFILEDEF': {
        const d = num(a[3]), b = num(a[4]), tw = num(a[5]), tf = num(a[6]);
        return [{ outer: place(pos2(2), [[-b / 2, -d / 2], [b / 2, -d / 2], [b / 2, -d / 2 + tf], [-b / 2 + tw, -d / 2 + tf], [-b / 2 + tw, d / 2 - tf], [b / 2, d / 2 - tf], [b / 2, d / 2], [-b / 2, d / 2]]), holes: [] }];
      }
      case 'IFCCSHAPEPROFILEDEF': {
        const d = num(a[3]), b = num(a[4]), t = num(a[5]);
        return [{ outer: place(pos2(2), [[-b / 2, -d / 2], [b / 2, -d / 2], [b / 2, -d / 2 + t], [-b / 2 + t, -d / 2 + t], [-b / 2 + t, d / 2 - t], [b / 2, d / 2 - t], [b / 2, d / 2], [-b / 2, d / 2]]), holes: [] }];
      }
      case 'IFCZSHAPEPROFILEDEF': {
        const d = num(a[3]), b = num(a[4]), tw = num(a[5]), tf = num(a[6]);
        return [{ outer: place(pos2(2), [[-tw / 2, -d / 2], [b - tw / 2, -d / 2], [b - tw / 2, -d / 2 + tf], [tw / 2, -d / 2 + tf], [tw / 2, d / 2], [-b + tw / 2, d / 2], [-b + tw / 2, d / 2 - tf], [-tw / 2, d / 2 - tf]]), holes: [] }];
      }
      case 'IFCTRAPEZIUMPROFILEDEF': {
        const bx = num(a[3]), tx = num(a[4]), y = num(a[5]), off = num(a[6]);
        return [{ outer: place(pos2(2), [[-bx / 2, -y / 2], [bx / 2, -y / 2], [-bx / 2 + off + tx, y / 2], [-bx / 2 + off, y / 2]]), holes: [] }];
      }
      case 'IFCARBITRARYCLOSEDPROFILEDEF':
      case 'IFCARBITRARYPROFILEDEFWITHVOIDS': {
        const outer = cleanRing(this.curve2(a[2]));
        if (outer.length < 3) return [];
        const holes = e.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS' ? refs(a[3]).map((id) => cleanRing(this.curve2(new Ref(id)))).filter((r) => r.length >= 3) : [];
        return [{ outer, holes }];
      }
      case 'IFCCOMPOSITEPROFILEDEF':
        return refs(a[2]).flatMap((id) => this.profile(new Ref(id)));
      case 'IFCDERIVEDPROFILEDEF': {
        const parent = this.profile(a[2]);
        const op = this.transformOperator(a[3]);
        return parent.map((p) => ({ outer: place(op, p.outer), holes: p.holes.map((h) => place(op, h)) }));
      }
      default:
        this.count(this.report.skipped, e.type);
        return [];
    }
  }

  // ── solids ──

  /** Extrude polygons (profile space) along dir by depth, in the Position's space. */
  extrude(polys: Poly2[], dir: V3, depth: number, m: M4, out: Mesh, keepCollinear = false) {
    const d = scale(dir, depth);
    if (Math.abs(d[2]) < 1e-12) return;
    const up = d[2] > 0;
    const local = new Mesh();
    for (const p of polys) {
      const outer = cleanRing(p.outer, 1e-9, !keepCollinear);
      if (outer.length < 3) continue;
      const rings = [outer, ...p.holes.map((h) => cleanRing(h, 1e-9, !keepCollinear)).filter((h) => h.length >= 3)];
      // outer CCW, holes CW (seen from +z)
      rings.forEach((r, i) => {
        const ccw = area2(r) > 0;
        if ((i === 0) !== ccw) r.reverse();
      });
      const bottom = rings.map((r) => r.map(([x, y]) => [x, y, 0] as V3));
      const top = rings.map((r) => r.map(([x, y]) => [x + d[0], y + d[1], d[2]] as V3));
      // caps: bottom faces against the extrusion, top faces along it
      const flip = (r: V3[]) => r.slice().reverse();
      if (up) {
        local.polygon(flip(bottom[0]), bottom.slice(1).map(flip), true);
        local.polygon(top[0], top.slice(1), true);
      } else {
        local.polygon(bottom[0], bottom.slice(1), true);
        local.polygon(flip(top[0]), top.slice(1).map(flip), true);
      }
      // sides
      rings.forEach((r, ri) => {
        const b = bottom[ri], t = top[ri];
        const n = r.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const v0 = local.vert(b[i]), v1 = local.vert(b[j]), v2 = local.vert(t[j]), v3 = local.vert(t[i]);
          if (up) {
            local.tri(v0, v1, v2);
            local.tri(v0, v2, v3);
          } else {
            local.tri(v0, v2, v1);
            local.tri(v0, v3, v2);
          }
          // vertical edge only where the outline actually turns
          const prev = r[(i - 1 + n) % n], cur = r[i], next = r[j];
          const a1 = Math.atan2(cur[1] - prev[1], cur[0] - prev[0]);
          const a2 = Math.atan2(next[1] - cur[1], next[0] - cur[0]);
          let turn = Math.abs(a2 - a1);
          if (turn > Math.PI) turn = Math.PI * 2 - turn;
          if (turn > (25 * Math.PI) / 180) local.edge(b[i], t[i]);
        }
      });
    }
    out.append(local, m);
  }

  /**
   * A vertical prism (plan polygon `ring`, z from z0 to z1) with rectangular
   * openings through its thickness. The wall is cut into strips at every
   * opening jamb and bands at every sill/head; only exposed faces are emitted,
   * so the result is one watertight mesh with exact reveals.
   */
  private cutPrism(ring: V2[], z0: number, z1: number, holes: { s0: number; s1: number; z0: number; z1: number }[], axis: { o: V2; a: V2 }, out: Mesh) {
    const { o, a } = axis;
    const S = (p: V2) => (p[0] - o[0]) * a[0] + (p[1] - o[1]) * a[1];
    let smin = Infinity, smax = -Infinity;
    for (const p of ring) {
      smin = Math.min(smin, S(p));
      smax = Math.max(smax, S(p));
    }
    const uniq = (xs: number[]) => xs.sort((x, y) => x - y).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 1e-7);
    const ss = uniq([smin, smax, ...holes.flatMap((h) => [h.s0, h.s1]).map((x) => Math.min(Math.max(x, smin), smax))]);
    const zs = uniq([z0, z1, ...holes.flatMap((h) => [h.z0, h.z1]).map((x) => Math.min(Math.max(x, z0), z1))]);
    // clip the plan to each strip [ss[j], ss[j+1]]
    const strips: V2[][] = [];
    for (let j = 0; j + 1 < ss.length; j++) {
      let poly = clipHalfPlane(ring, a, ss[j] + (o[0] * a[0] + o[1] * a[1]), true);
      poly = clipHalfPlane(poly, a, ss[j + 1] + (o[0] * a[0] + o[1] * a[1]), false);
      strips.push(poly.length >= 3 && Math.abs(area2(poly)) > 1e-12 ? poly : []);
    }
    const nj = strips.length, nk = zs.length - 1;
    const solid = (j: number, k: number) => {
      if (j < 0 || k < 0 || j >= nj || k >= nk || !strips[j].length) return false;
      const sc = (ss[j] + ss[j + 1]) / 2, zc = (zs[k] + zs[k + 1]) / 2;
      return !holes.some((h) => sc > h.s0 && sc < h.s1 && zc > h.z0 && zc < h.z1);
    };
    const onLine = (p: V2, sv: number) => Math.abs(S(p) - sv) < 1e-7;
    for (let j = 0; j < nj; j++) {
      const poly = strips[j];
      if (!poly.length) continue;
      for (let k = 0; k < nk; k++) {
        if (!solid(j, k)) continue;
        const za = zs[k], zb = zs[k + 1];
        const bottom = poly.map(([x, y]) => [x, y, za] as V3);
        const top = poly.map(([x, y]) => [x, y, zb] as V3);
        if (!solid(j, k - 1)) out.polygon(bottom.slice().reverse(), [], false);
        if (!solid(j, k + 1)) out.polygon(top, [], false);
        for (let i = 0; i < poly.length; i++) {
          const n = (i + 1) % poly.length;
          const p = poly[i], q = poly[n];
          const left = onLine(p, ss[j]) && onLine(q, ss[j]);
          const right = onLine(p, ss[j + 1]) && onLine(q, ss[j + 1]);
          if ((left && solid(j - 1, k)) || (right && solid(j + 1, k))) continue; // shared with a solid neighbour
          const v0 = out.vert(bottom[i]), v1 = out.vert(bottom[n]), v2 = out.vert(top[n]), v3 = out.vert(top[i]);
          out.tri(v0, v1, v2);
          out.tri(v0, v2, v3);
        }
      }
    }
    out.explicitEdges = false;
  }

  /** Mesh one representation item into `out`, in the space given by `m`. */
  item(v: StepValue, m: M4, out: Mesh, openings: Mesh[] = []): void {
    const e = this.f.deref(v);
    if (!e) return;
    const a = e.args;
    switch (e.type) {
      case 'IFCEXTRUDEDAREASOLID':
      case 'IFCEXTRUDEDAREASOLIDTAPERED': {
        this.count(this.report.items, e.type);
        const pos = mul(m, this.axis2(a[1]));
        const dir = this.direction(a[2], [0, 0, 1]);
        const depth = num(a[3]);
        let polys = this.profile(a[0]);
        if (openings.length && Math.abs(Math.abs(dir[2]) - 1) < 1e-6) {
          const res = this.applyOpenings(polys, pos, dir[2] * depth, openings);
          if (res.cut) {
            out.append(res.cut, pos);
            return;
          }
          polys = res.polys;
          const across = openings.filter((o) => !this.opened.has(o));
          if (across.length && this.cutAcross(polys, dir, depth, across, pos, out)) return;
        }
        this.extrude(polys, dir, depth, pos, out);
        return;
      }
      case 'IFCFACETEDBREP':
      case 'IFCFACETEDBREPWITHVOIDS':
      case 'IFCCLOSEDSHELL':
      case 'IFCOPENSHELL':
      case 'IFCCONNECTEDFACESET': {
        this.count(this.report.items, e.type);
        const local = new Mesh();
        local.explicitEdges = false;
        const shells = e.type.startsWith('IFCFACETEDBREP') ? [a[0]] : [v];
        if (e.type === 'IFCFACETEDBREPWITHVOIDS') for (const id of refs(a[1])) shells.push(new Ref(id));
        for (const s of shells) {
          const shell = this.f.deref(s);
          if (shell) for (const fid of refs(shell.args[0])) this.face(fid, local);
        }
        out.append(local, m);
        return;
      }
      case 'IFCSHELLBASEDSURFACEMODEL':
      case 'IFCFACEBASEDSURFACEMODEL': {
        this.count(this.report.items, e.type);
        const local = new Mesh();
        local.explicitEdges = false;
        for (const sid of refs(a[0])) {
          const shell = this.f.get(sid);
          if (shell) for (const fid of refs(shell.args[0])) this.face(fid, local);
        }
        out.append(local, m);
        return;
      }
      case 'IFCPOLYGONALFACESET':
      case 'IFCTRIANGULATEDFACESET':
      case 'IFCTRIANGULATEDIRREGULARNETWORK': {
        this.count(this.report.items, e.type);
        const local = this.faceSet(e);
        out.append(local, m);
        return;
      }
      case 'IFCMAPPEDITEM': {
        this.count(this.report.items, e.type);
        const src = this.f.deref(a[0]);
        if (!src) return;
        const origin = this.axis2(src.args[0]);
        const target = this.transformOperator(a[1]);
        const mm = mul(m, mul(target, origin));
        const rep = this.f.deref(src.args[1]);
        if (rep)
          for (const id of refs(rep.args[3])) {
            out.beginShell();
            this.item(new Ref(id), mm, out, openings);
          }
        return;
      }
      case 'IFCBOOLEANCLIPPINGRESULT':
      case 'IFCBOOLEANRESULT': {
        for (const part of this.solidParts(v, m, openings)) {
          out.beginShell();
          out.append(part, null);
        }
        return;
      }
      case 'IFCBOUNDINGBOX': {
        this.count(this.report.items, e.type);
        const c = this.point(a[0]);
        const local = boxMesh([num(a[1]), num(a[2]), num(a[3])]);
        out.append(local, mul(m, basis(c, [1, 0, 0], [0, 1, 0], [0, 0, 1])));
        return;
      }
      case 'IFCBLOCK': {
        this.count(this.report.items, e.type);
        out.append(boxMesh([num(a[1]), num(a[2]), num(a[3])]), mul(m, this.axis2(a[0])));
        return;
      }
      case 'IFCCSGSOLID':
        this.item(a[0], m, out, openings);
        return;
      case 'IFCSWEPTDISKSOLID': {
        this.count(this.report.items, e.type);
        const pts = this.curve3(a[0]);
        const r = num(a[1]);
        for (let i = 0; i + 1 < pts.length; i++) out.append(tube(pts[i], pts[i + 1], r), m);
        return;
      }
      case 'IFCREVOLVEDAREASOLID': {
        this.count(this.report.items, e.type);
        this.revolve(e, m, out);
        return;
      }
      default:
        this.count(this.report.skipped, e.type);
    }
  }

  /**
   * A boolean result as a list of closed components. Keeping components apart
   * lets nested clips cap each piece correctly.
   */
  private solidParts(v: StepValue, m: M4, openings: Mesh[]): Mesh[] {
    const e = this.f.deref(v);
    if (!e) return [];
    if (e.type !== 'IFCBOOLEANCLIPPINGRESULT' && e.type !== 'IFCBOOLEANRESULT') {
      const mesh = new Mesh();
      this.item(v, m, mesh, openings);
      return mesh.idx.length ? [mesh] : [];
    }
    this.count(this.report.items, e.type);
    const a = e.args;
    const op = enumOf(a[0]);
    const first = this.solidParts(a[1], m, openings);
    if (op === 'UNION') return [...first, ...this.solidParts(a[2], m, [])];
    const second = this.f.deref(a[2]);
    if (!second || !(second.type === 'IFCHALFSPACESOLID' || second.type === 'IFCPOLYGONALBOUNDEDHALFSPACE' || second.type === 'IFCBOXEDHALFSPACE')) {
      this.report.booleansApproximated++;
      return first;
    }
    const plane = this.f.deref(second.args[0]);
    const pm = plane ? mul(m, this.axis2(plane.args[0])) : m;
    const o = tp(pm, 0, 0, 0);
    const n = norm(td(pm, 0, 0, 1));
    const agree = bool(second.args[1]) !== false;
    // AgreementFlag TRUE: the normal points away from the half-space material.
    // DIFFERENCE removes that material; INTERSECTION keeps only it.
    const keepDir = (op === 'DIFFERENCE' ? agree : !agree) ? n : scale(n, -1);
    this.report.clipsApplied++;
    if (second.type !== 'IFCPOLYGONALBOUNDEDHALFSPACE' || op !== 'DIFFERENCE') return first.map((p) => clipByPlane(p, o, keepDir)).filter((p) => p.idx.length);
    // the removed region is limited to a prism over a plan polygon
    const bm = mul(m, this.axis2(second.args[2]));
    const inv = invertAffine(bm);
    let ring = cleanRing(this.curve2(second.args[3]));
    if (ring.length < 3) return first.map((p) => clipByPlane(p, o, keepDir)).filter((p) => p.idx.length);
    if (area2(ring) < 0) ring = ring.slice().reverse();
    let rlo: V2 = [Infinity, Infinity], rhi: V2 = [-Infinity, -Infinity];
    for (const p of ring) {
      rlo = [Math.min(rlo[0], p[0]), Math.min(rlo[1], p[1])];
      rhi = [Math.max(rhi[0], p[0]), Math.max(rhi[1], p[1])];
    }
    const planes = ring.map((p, i) => {
      const q = ring[(i + 1) % ring.length];
      const nOut = norm([q[1] - p[1], -(q[0] - p[0]), 0]);
      return { o: tp(bm, p[0], p[1], 0), n: norm(td(bm, nOut[0], nOut[1], nOut[2])) };
    });
    const out: Mesh[] = [];
    for (const part of first) {
      let inside = 0;
      const lo: V2 = [Infinity, Infinity], hi: V2 = [-Infinity, -Infinity];
      for (let i = 0; i < part.pos.length; i += 3) {
        const q = tp(inv, part.pos[i], part.pos[i + 1], part.pos[i + 2]);
        lo[0] = Math.min(lo[0], q[0]); lo[1] = Math.min(lo[1], q[1]);
        hi[0] = Math.max(hi[0], q[0]); hi[1] = Math.max(hi[1], q[1]);
        if (pointInRing([q[0], q[1]], ring) || distToRing([q[0], q[1]], ring) < 1e-4 * (1 + Math.abs(q[0]) + Math.abs(q[1]))) inside++;
      }
      if (rhi[0] < lo[0] || rlo[0] > hi[0] || rhi[1] < lo[1] || rlo[1] > hi[1]) {
        out.push(part); // the boundary misses this piece
        continue;
      }
      if (inside === part.pos.length / 3) {
        const c = clipByPlane(part, o, keepDir);
        if (c.idx.length) out.push(c);
        continue;
      }
      if (!isConvex(ring)) {
        this.report.booleansApproximated++;
        const c = clipByPlane(part, o, keepDir);
        if (c.idx.length) out.push(c);
        continue;
      }
      // kept = (A − H) ∪ ⋃ᵢ (A ∩ H ∩ Q₁…Qᵢ₋₁ ∩ ¬Qᵢ): convex clips of A, disjoint
      const below = clipByPlane(part, o, keepDir);
      if (below.idx.length) out.push(below);
      for (let i = 0; i < planes.length; i++) {
        let piece = clipByPlane(part, o, scale(keepDir, -1));
        for (let j = 0; j < i && piece.idx.length; j++) piece = clipByPlane(piece, planes[j].o, scale(planes[j].n, -1));
        if (piece.idx.length) piece = clipByPlane(piece, planes[i].o, planes[i].n);
        if (piece.idx.length) out.push(piece);
      }
    }
    return out;
  }

  /** 3D polyline points for swept-disk directrices. */
  private curve3(v: StepValue): V3[] {
    const e = this.f.deref(v);
    if (!e) return [];
    if (e.type === 'IFCPOLYLINE') return refs(e.args[0]).map((id) => this.point(new Ref(id)));
    if (e.type === 'IFCCOMPOSITECURVE') {
      const out: V3[] = [];
      for (const sid of refs(e.args[0])) {
        const seg = this.f.get(sid);
        if (seg) out.push(...this.curve3(seg.args[2]));
      }
      return out;
    }
    if (e.type === 'IFCINDEXEDPOLYCURVE') {
      const list = this.f.deref(e.args[0]);
      const coords = list?.args[0];
      if (Array.isArray(coords)) return coords.map((c) => (Array.isArray(c) ? ([num(c[0]), num(c[1]), num(c[2])] as V3) : ([0, 0, 0] as V3)));
    }
    return this.curve2(v).map(([x, y]) => [x, y, 0] as V3);
  }

  private revolve(e: Entity, m: M4, out: Mesh) {
    const polys = this.profile(e.args[0]);
    const pos = mul(m, this.axis2(e.args[1]));
    const ax = this.f.deref(e.args[2]);
    const angle = num(e.args[3]) * this.angleUnit;
    if (!ax || !polys.length) return;
    const ao = this.point(ax.args[0]);
    const ad = this.direction(ax.args[1], [0, 1, 0]);
    const steps = Math.max(6, Math.ceil(Math.abs(angle) / (Math.PI / 12)));
    const ring = cleanRing(polys[0].outer);
    const rot = (p: V3, t: number): V3 => {
      // Rodrigues rotation of p about the axis (ao, ad)
      const q = sub(p, ao);
      const c = Math.cos(t), s = Math.sin(t);
      const k = ad;
      const kxq = cross(k, q);
      const kdq = dot(k, q);
      return [ao[0] + q[0] * c + kxq[0] * s + k[0] * kdq * (1 - c), ao[1] + q[1] * c + kxq[1] * s + k[1] * kdq * (1 - c), ao[2] + q[2] * c + kxq[2] * s + k[2] * kdq * (1 - c)];
    };
    const local = new Mesh();
    local.explicitEdges = false;
    for (let s = 0; s < steps; s++) {
      const t0 = (angle * s) / steps, t1 = (angle * (s + 1)) / steps;
      for (let i = 0; i < ring.length; i++) {
        const a3: V3 = [ring[i][0], ring[i][1], 0];
        const b3: V3 = [ring[(i + 1) % ring.length][0], ring[(i + 1) % ring.length][1], 0];
        const p0 = local.vert(rot(a3, t0)), p1 = local.vert(rot(b3, t0)), p2 = local.vert(rot(b3, t1)), p3 = local.vert(rot(a3, t1));
        local.tri(p0, p1, p2);
        local.tri(p0, p2, p3);
      }
    }
    out.append(local, pos);
  }

  private face(fid: number, out: Mesh) {
    const f = this.f.get(fid);
    if (!f) return;
    let outer: V3[] | null = null;
    const inner: V3[][] = [];
    for (const bid of refs(f.args[0])) {
      const b = this.f.get(bid);
      if (!b) continue;
      const loop = this.f.deref(b.args[0]);
      if (!loop || loop.type !== 'IFCPOLYLOOP') continue;
      let pts = refs(loop.args[0]).map((id) => this.point(new Ref(id)));
      pts = dedupe3(pts);
      if (pts.length < 3) continue;
      if (bool(b.args[1]) === false) pts.reverse();
      if (b.type === 'IFCFACEOUTERBOUND' && !outer) outer = pts;
      else inner.push(pts);
    }
    if (!outer) outer = inner.shift() ?? null;
    if (outer) out.polygon(outer, inner, false);
  }

  private faceSet(e: Entity): Mesh {
    const local = new Mesh();
    local.explicitEdges = false;
    const list = this.f.deref(e.args[0]);
    const coords = list?.args[0];
    if (!Array.isArray(coords)) return local;
    const C: V3[] = coords.map((c) => (Array.isArray(c) ? [num(c[0]), num(c[1]), num(c[2])] : [0, 0, 0]) as V3);
    const pnIdx = e.type === 'IFCPOLYGONALFACESET' ? e.args[3] : e.args[4];
    const pn = Array.isArray(pnIdx) ? pnIdx.map((x) => num(x)) : null;
    const P = (i: number) => C[(pn ? pn[i - 1] : i) - 1] ?? C[0];
    if (e.type === 'IFCPOLYGONALFACESET') {
      for (const fid of refs(e.args[2])) {
        const face = this.f.get(fid);
        if (!face) continue;
        const outer = Array.isArray(face.args[0]) ? face.args[0].map((x) => P(num(x))) : [];
        const holes = face.type === 'IFCINDEXEDPOLYGONALFACEWITHVOIDS' && Array.isArray(face.args[1]) ? face.args[1].map((h) => (Array.isArray(h) ? h.map((x) => P(num(x))) : [])) : [];
        local.polygon(outer, holes, false);
      }
    } else {
      const tris = e.args[3];
      if (Array.isArray(tris))
        for (const t of tris) {
          if (!Array.isArray(t) || t.length < 3) continue;
          const i0 = local.vert(P(num(t[0]))), i1 = local.vert(P(num(t[1]))), i2 = local.vert(P(num(t[2])));
          local.tri(i0, i1, i2);
        }
    }
    return local;
  }

  // ── openings ──

  /**
   * Openings against a vertical extrusion. Openings that pass through the
   * extrusion's depth become profile holes (slabs); openings that pass through
   * the plan thickness are cut as reveals (walls). Others are reported.
   */
  /**
   * Openings that run across the extrusion rather than along it: a sink through
   * a worktop extruded along its length, a hole through a beam web. The band of
   * the profile the opening passes through must have a constant cross-section;
   * that band is re-extruded along the opening with the opening as a hole, and
   * the material either side of it is clipped from the plain extrusion. Each
   * piece is a closed shell, so volumes stay exact. Returns false (nothing
   * written) when no opening fits.
   */
  private cutAcross(polys: Poly2[], dir: V3, depth: number, openings: Mesh[], pos: M4, out: Mesh): boolean {
    if (polys.length !== 1 || polys[0].holes.length) return false;
    const ring = cleanRing(polys[0].outer);
    if (ring.length < 3) return false;
    const z0 = Math.min(0, dir[2] * depth), z1 = Math.max(0, dir[2] * depth);
    const inv = invertAffine(pos);
    const lo: V2 = [Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1]))];
    const hi: V2 = [Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))];
    const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], z1 - z0);
    const tol = size * 1e-7 + 1e-9;
    type Cut = { k: 0 | 1; a: number; b: number; hull: V2[]; op: Mesh };
    const cuts: Cut[] = [];
    for (const op of openings) {
      const q: V3[] = [];
      for (let i = 0; i < op.pos.length; i += 3) q.push(tp(inv, op.pos[i], op.pos[i + 1], op.pos[i + 2]));
      const vol = Math.abs(meshVolume(op));
      for (const k of [0, 1] as const) {
        const j = 1 - k;
        const b0 = Math.min(...q.map((p) => p[k])), b1 = Math.max(...q.map((p) => p[k]));
        const hull = convexHull2(q.map((p) => [p[j], p[2]] as V2));
        // a convex prism along k: its volume is its footprint times its length
        if (hull.length < 3 || Math.abs(Math.abs(area2(hull)) * (b1 - b0) - vol) > 0.01 * vol + 1e-12) continue;
        const a = Math.max(b0, lo[k]), b = Math.min(b1, hi[k]);
        if (b - a <= tol * 10) break; // does not reach the material
        cuts.push({ k, a, b, hull, op });
        break;
      }
    }
    if (!cuts.length) return false;
    // one band per item: the openings that share the first opening's band
    const { k, a, b } = cuts[0];
    const band = cuts.filter((c) => c.k === k && Math.abs(c.a - a) <= tol * 10 && Math.abs(c.b - b) <= tol * 10);
    const j = 1 - k;
    // the band must hold no profile vertex and keep one cross-section across its width
    if (ring.some((p) => p[k] > a + tol && p[k] < b - tol)) return false;
    const d = Math.min((b - a) / 4, size * 1e-4);
    const s0 = crossSection(ring, k, a + d), s1 = crossSection(ring, k, b - d);
    if (!s0.length || s0.length !== s1.length || s0.some((iv, i) => Math.abs(iv[0] - s1[i][0]) > tol * 10 || Math.abs(iv[1] - s1[i][1]) > tol * 10)) return false;
    // each opening must sit inside one strip of the band (a hole, not a notch)
    const holesOf = s0.map(() => [] as V2[][]);
    for (const c of band) {
      const strip = s0.findIndex(([j0, j1]) => c.hull.every((p) => p[0] > j0 + tol && p[0] < j1 - tol && p[1] > z0 + tol && p[1] < z1 - tol));
      if (strip < 0) return false;
      holesOf[strip].push(c.hull.slice().reverse());
    }
    // the plain extrusion, clipped either side of the band
    const host = new Mesh();
    this.extrude(polys, dir, depth, I4(), host);
    const e: V3 = k === 0 ? [1, 0, 0] : [0, 1, 0];
    const at = (v: number): V3 => (k === 0 ? [v, 0, 0] : [0, v, 0]);
    const below = clipByPlane(host, at(a), scale(e, -1));
    const above = clipByPlane(host, at(b), e);
    // points of those pieces on the band faces, so the band's outline shares their vertices
    const onFaces: V2[] = [];
    for (const [m, v] of [[below, a], [above, b]] as const)
      for (let i = 0; i < m.pos.length; i += 3) if (Math.abs(m.pos[i + k] - v) <= tol) onFaces.push([m.pos[i + j], m.pos[i + 2]]);
    const strips: Poly2[] = s0.map(([j0, j1], i) => ({ outer: withPointsOnEdges([[j0, z0], [j1, z0], [j1, z1], [j0, z1]], onFaces, tol), holes: holesOf[i] }));
    // the band itself, extruded along k: profile axes (j, z), extrusion axis k
    const frame = k === 0 ? basis([a, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0]) : basis([0, a, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]);
    const mid = new Mesh();
    this.extrude(strips, [0, 0, 1], b - a, frame, mid, true);
    for (const piece of [below, mid, above]) {
      if (!piece.idx.length) continue;
      piece.explicitEdges = false;
      out.beginShell();
      out.append(piece, pos);
    }
    for (const c of band) this.opened.add(c.op);
    return true;
  }

  private applyOpenings(polys: Poly2[], pos: M4, dz: number, openings: Mesh[]): { polys: Poly2[]; cut: Mesh | null } {
    const inv = invertAffine(pos);
    const z0 = Math.min(0, dz), z1 = Math.max(0, dz);
    const single = polys.length === 1 ? { outer: cleanRing(polys[0].outer), holes: polys[0].holes.slice() } : null;
    const wallCuts: { s0: number; s1: number; z0: number; z1: number; op: Mesh }[] = [];
    let axis: { o: V2; a: V2 } | null = null;
    let tmin = 0, tmax = 0;
    if (single && !single.holes.length && single.outer.length >= 3 && single.outer.length <= 24) {
      // the wall runs along its longest plan edge
      let best = -1;
      for (let i = 0; i < single.outer.length; i++) {
        const p = single.outer[i], q = single.outer[(i + 1) % single.outer.length];
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (l > best) {
          best = l;
          axis = { o: p, a: [(q[0] - p[0]) / l, (q[1] - p[1]) / l] };
        }
      }
      if (axis) {
        const bx = -axis.a[1], by = axis.a[0];
        tmin = Infinity;
        tmax = -Infinity;
        for (const p of single.outer) {
          const t = (p[0] - axis.o[0]) * bx + (p[1] - axis.o[1]) * by;
          tmin = Math.min(tmin, t);
          tmax = Math.max(tmax, t);
        }
      }
    }
    const out = single ? [single] : polys;
    for (const op of openings) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, zl = Infinity, zh = -Infinity;
      let sl = Infinity, sh = -Infinity, tl = Infinity, th = -Infinity;
      for (let i = 0; i < op.pos.length; i += 3) {
        const q = tp(inv, op.pos[i], op.pos[i + 1], op.pos[i + 2]);
        x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]);
        y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
        zl = Math.min(zl, q[2]); zh = Math.max(zh, q[2]);
        if (axis) {
          const sv = (q[0] - axis.o[0]) * axis.a[0] + (q[1] - axis.o[1]) * axis.a[1];
          const tv = (q[0] - axis.o[0]) * -axis.a[1] + (q[1] - axis.o[1]) * axis.a[0];
          sl = Math.min(sl, sv); sh = Math.max(sh, sv);
          tl = Math.min(tl, tv); th = Math.max(th, tv);
        }
      }
      if (zh < z0 + 1e-6 || zl > z1 - 1e-6) continue; // does not touch this element
      const ztol = (z1 - z0) * 0.02 + 1e-6;
      if (zl <= z0 + ztol && zh >= z1 - ztol && single) {
        // vertical: a hole through the depth of the profile
        const rect: V2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        const inside = rect.every((p) => pointInRing(p, single.outer)) && !segmentsCross(rect, single.outer);
        const clear = single.holes.every((h) => !ringsOverlap(rect, h));
        if (inside && clear && !wallCuts.length) {
          single.holes.push(rect.slice().reverse());
          this.opened.add(op);
        }
        continue;
      }
      const ttol = (tmax - tmin) * 0.05 + 1e-6;
      if (axis && !single!.holes.length && tl <= tmin + ttol && th >= tmax - ttol) {
        wallCuts.push({ s0: sl, s1: sh, z0: zl, z1: zh, op });
        continue;
      }
    }
    if (wallCuts.length && axis && single) {
      const mesh = new Mesh();
      const ring = area2(single.outer) > 0 ? single.outer : single.outer.slice().reverse();
      this.cutPrism(ring, z0, z1, wallCuts, axis, mesh);
      for (const c of wallCuts) this.opened.add(c.op);
      return { polys: out, cut: mesh };
    }
    return { polys: out, cut: null };
  }
}

// ── free helpers ───────────────────────────────────────────────────────────

/** Signed volume of a closed mesh (divergence theorem). */
function meshVolume(m: Mesh): number {
  let v = 0;
  const P = m.pos;
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

/** Convex hull, counter-clockwise (Andrew's monotone chain). */
function convexHull2(pts: V2[]): V2[] {
  const p = pts.slice().sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  if (p.length < 3) return p;
  const turn = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: V2[] = [], upper: V2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-15) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-15) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Where the line (axis k = c) runs inside a ring: sorted intervals along the other axis. */
function crossSection(ring: V2[], k: 0 | 1, c: number): [number, number][] {
  const j = 1 - k;
  const xs: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    if ((p[k] - c) * (q[k] - c) < 0) xs.push(p[j] + ((c - p[k]) / (q[k] - p[k])) * (q[j] - p[j]));
  }
  xs.sort((u, v) => u - v);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

/** Insert the given points into the ring wherever they lie strictly inside one of its edges. */
function withPointsOnEdges(ring: V2[], pts: V2[], tol: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    out.push(p);
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const l2 = dx * dx + dy * dy;
    if (l2 < tol * tol) continue;
    const l = Math.sqrt(l2);
    const on = pts
      .map((r) => ({ r, t: ((r[0] - p[0]) * dx + (r[1] - p[1]) * dy) / l2, off: Math.abs((r[0] - p[0]) * dy - (r[1] - p[1]) * dx) / l }))
      .filter((x) => x.off <= tol && x.t * l > tol && (1 - x.t) * l > tol)
      .sort((u, v) => u.t - v.t);
    let last = -1;
    for (const x of on) {
      if ((x.t - last) * l <= tol) continue;
      out.push([p[0] + dx * x.t, p[1] + dy * x.t]);
      last = x.t;
    }
  }
  return out;
}

function dedupe3(pts: V3[]): V3[] {
  const out: V3[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) > 1e-9) out.push(p);
  }
  if (out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 1e-9) out.pop();
  }
  return out;
}

function arcThrough(a: V2, b: V2, c: V2): V2[] {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return [a, b, c];
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  const r = Math.hypot(a[0] - ux, a[1] - uy);
  const t0 = Math.atan2(a[1] - uy, a[0] - ux);
  let t1 = Math.atan2(b[1] - uy, b[0] - ux);
  let t2 = Math.atan2(c[1] - uy, c[0] - ux);
  const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
  const wrap = (t: number) => {
    if (ccw) while (t < t0) t += Math.PI * 2;
    else while (t > t0) t -= Math.PI * 2;
    return t;
  };
  t1 = wrap(t1);
  t2 = wrap(t2);
  // two runs, a→b and b→c, so the point the arc is defined through is kept exactly
  const out: V2[] = [];
  const run = (s0: number, s1: number, first: boolean) => {
    const steps = Math.max(1, Math.ceil(Math.abs(s1 - s0) / (Math.PI / 36)));
    for (let i = first ? 0 : 1; i <= steps; i++) {
      const t = s0 + ((s1 - s0) * i) / steps;
      out.push([ux + r * Math.cos(t), uy + r * Math.sin(t)]);
    }
  };
  run(t0, t1, true);
  out[out.length - 1] = b;
  run(t1, t2, false);
  out[0] = a;
  out[out.length - 1] = c;
  return out;
}

/** Keep the part of a polygon with dot(p, n) ≥ c (keepAbove) or ≤ c. */
function clipHalfPlane(ring: V2[], n: V2, c: number, keepAbove: boolean): V2[] {
  const out: V2[] = [];
  const f = (p: V2) => (p[0] * n[0] + p[1] * n[1] - c) * (keepAbove ? 1 : -1);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return cleanRing(out, 1e-9);
}

export function pointInRing(p: V2, ring: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-30) + a[0]) inside = !inside;
  }
  return inside;
}

function isConvex(ring: V2[]): boolean {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

function distToRing(p: V2, ring: V2[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)));
  }
  return best;
}

function segIntersect(p1: V2, p2: V2, p3: V2, p4: V2): boolean {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-18) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

function segmentsCross(a: V2[], b: V2[]): boolean {
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) if (segIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  return false;
}

function ringsOverlap(a: V2[], b: V2[]): boolean {
  return segmentsCross(a, b) || a.some((p) => pointInRing(p, b)) || b.some((p) => pointInRing(p, a));
}

export function boxMesh(size: V3): Mesh {
  const [x, y, z] = size;
  const m = new Mesh();
  const quad = (a: V3, b: V3, c: V3, d: V3) => {
    const i0 = m.vert(a), i1 = m.vert(b), i2 = m.vert(c), i3 = m.vert(d);
    m.tri(i0, i1, i2);
    m.tri(i0, i2, i3);
  };
  quad([0, 0, 0], [0, y, 0], [x, y, 0], [x, 0, 0]);
  quad([0, 0, z], [x, 0, z], [x, y, z], [0, y, z]);
  quad([0, 0, 0], [x, 0, 0], [x, 0, z], [0, 0, z]);
  quad([0, y, 0], [0, y, z], [x, y, z], [x, y, 0]);
  quad([0, 0, 0], [0, 0, z], [0, y, z], [0, y, 0]);
  quad([x, 0, 0], [x, y, 0], [x, y, z], [x, 0, z]);
  m.explicitEdges = false;
  return m;
}

function tube(a: V3, b: V3, r: number): Mesh {
  const d = sub(b, a);
  const L = len(d);
  const m = new Mesh();
  if (L < 1e-9) return m;
  const x = norm(d);
  const y = norm(cross(Math.abs(x[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], x));
  const z = cross(x, y);
  const box = boxMesh([L, 2 * r, 2 * r]);
  m.append(box, basis(sub(sub(a, scale(y, r)), scale(z, r)), x, y, z));
  return m;
}

/**
 * Keep the part of a closed mesh on the side `n` points to (relative to o),
 * and close the cut with a planar cap.
 */
export function clipByPlane(mesh: Mesh, o: V3, n: V3): Mesh {
  const out = new Mesh();
  out.explicitEdges = mesh.explicitEdges;
  const P = (i: number): V3 => [mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]];
  const dist = (p: V3) => dot(sub(p, o), n);
  const segs: [V3, V3][] = [];
  const lerp3 = (a: V3, b: V3, da: number, db: number): V3 => {
    const t = da / (da - db);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  let removedAny = false;
  for (let i = 0; i < mesh.idx.length; i += 3) {
    const tri = [P(mesh.idx[i]), P(mesh.idx[i + 1]), P(mesh.idx[i + 2])];
    const d = tri.map(dist);
    const eps = 1e-9;
    if (d.every((x) => Math.abs(x) <= eps)) {
      // lying in the plane: keep only faces that bound the kept side (they face away from it)
      if (dot(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])), n) < 0) {
        const a = out.vert(tri[0]), b = out.vert(tri[1]), c = out.vert(tri[2]);
        out.tri(a, b, c);
      } else removedAny = true;
      continue;
    }
    if (d.every((x) => x >= -eps)) {
      const a = out.vert(tri[0]), b = out.vert(tri[1]), c = out.vert(tri[2]);
      out.tri(a, b, c);
      continue;
    }
    removedAny = true;
    if (d.every((x) => x <= eps)) continue;
    // Sutherland–Hodgman against the plane, keeping d ≥ 0
    const poly: V3[] = [];
    const cutPts: V3[] = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const da = d[k], db = d[(k + 1) % 3];
      if (da >= 0) poly.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const q = lerp3(a, b, da, db);
        poly.push(q);
        cutPts.push(q);
      }
    }
    if (poly.length >= 3) {
      const base = poly.map((p) => out.vert(p));
      for (let k = 1; k + 1 < base.length; k++) out.tri(base[0], base[k], base[k + 1]);
    }
    if (cutPts.length === 2) segs.push([cutPts[0], cutPts[1]]);
  }
  // clip explicit edges too
  for (let i = 0; i < mesh.edges.length; i += 6) {
    const a: V3 = [mesh.edges[i], mesh.edges[i + 1], mesh.edges[i + 2]];
    const b: V3 = [mesh.edges[i + 3], mesh.edges[i + 4], mesh.edges[i + 5]];
    const da = dist(a), db = dist(b);
    if (da >= 0 && db >= 0) out.edge(a, b);
    else if (da >= 0) out.edge(a, lerp3(a, b, da, db));
    else if (db >= 0) out.edge(lerp3(a, b, da, db), b);
  }
  if (!removedAny || !segs.length) return out;
  // chain cut segments into loops and cap them (cap normal = −n, facing the removed side)
  const key = (p: V3) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)},${Math.round(p[2] * 1e6)}`;
  const adj = new Map<string, { p: V3; next: string[] }>();
  for (const [a, b] of segs) {
    const ka = key(a), kb = key(b);
    if (ka === kb) continue;
    if (!adj.has(ka)) adj.set(ka, { p: a, next: [] });
    if (!adj.has(kb)) adj.set(kb, { p: b, next: [] });
    adj.get(ka)!.next.push(kb);
    adj.get(kb)!.next.push(ka);
  }
  const used = new Set<string>();
  const loops: V3[][] = [];
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const loop: V3[] = [];
    let cur = start;
    let prev = '';
    for (let guard = 0; guard < 100000; guard++) {
      used.add(cur);
      const node = adj.get(cur)!;
      loop.push(node.p);
      const nxt = node.next.find((k) => k !== prev && !used.has(k)) ?? node.next.find((k) => k === start && loop.length > 2);
      if (!nxt || nxt === start) break;
      prev = cur;
      cur = nxt;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  if (!loops.length) return out;
  // project to the plane, nest loops (outer vs hole) and orient caps against n
  const ax: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(ax, n));
  const v = cross(n, u);
  const flat = loops.map((l) => l.map((p) => [dot(p, u), dot(p, v)] as V2));
  const depthOf = flat.map((ring, i) => flat.reduce((acc, other, j) => (j !== i && pointInRing(ring[0], other) ? acc + 1 : acc), 0));
  flat.forEach((ring, i) => {
    if (depthOf[i] % 2) return; // holes are handled with their outer loop
    const holes = flat.map((h, j) => ({ h, j })).filter(({ h, j }) => j !== i && depthOf[j] === depthOf[i] + 1 && pointInRing(h[0], ring));
    const cap = new Mesh();
    cap.polygon(loops[i], holes.map(({ j }) => loops[j]), true);
    // make the cap face −n
    for (let k = 0; k < cap.idx.length; k += 3) {
      const a = cap.idx[k], b = cap.idx[k + 1], c = cap.idx[k + 2];
      const pa: V3 = [cap.pos[a * 3], cap.pos[a * 3 + 1], cap.pos[a * 3 + 2]];
      const pb: V3 = [cap.pos[b * 3], cap.pos[b * 3 + 1], cap.pos[b * 3 + 2]];
      const pc: V3 = [cap.pos[c * 3], cap.pos[c * 3 + 1], cap.pos[c * 3 + 2]];
      if (dot(cross(sub(pb, pa), sub(pc, pa)), n) > 0) {
        cap.idx[k + 1] = c;
        cap.idx[k + 2] = b;
      }
    }
    out.append(cap, null);
  });
  return out;
}
