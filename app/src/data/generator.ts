/**
 * Procedural five-tier timber pagoda, authored as an ordered list of install steps.
 *
 * Every part is an oriented box. A side-specific element is built once for the
 * south face (+Z) and rotated about Y for east (+X), north (-Z) and west (-X).
 * Step counts per tier follow the reference recording:
 *   PLINTH 19 · TIER 1 43 · TIER 2–4 29 · TIER 5 28 · SPIRE 14  = 191
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { MaterialId, Part, StepDef, TierId, Vec3 } from './types';

export const FLOORS = [1.3, 7.92, 13.04, 17.98, 22.75] as const; // FL of tiers 1–5
export const APEX = 28.64;
const CORE = [3.3, 2.9, 2.6, 2.3, 2.0]; // core half-width per tier
const COL_H = [3.4, 2.6, 2.5, 2.4, 2.3]; // column height per tier
const OVERHANG = [2.7, 2.5, 2.3, 2.1, 2.0]; // eave projection beyond the core
const SIDES = ['SOUTH', 'EAST', 'NORTH', 'WEST'] as const;
const SIDE_ANGLE = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

const UP = new Vector3(0, 1, 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

class Sink {
  parts: Part[] = [];

  /** Axis-aligned box (optionally yawed) centred at c. */
  box(c: Vec3, size: Vec3, mat: MaterialId, yaw = 0): this {
    const q = new Quaternion().setFromAxisAngle(UP, yaw);
    this.parts.push({ pos: [...c], size: [...size], quat: [q.x, q.y, q.z, q.w], mat });
    return this;
  }

  /** Box running from a to b (local X), with `zHint` steering its width axis. */
  beam(a: Vec3, b: Vec3, h: number, w: number, mat: MaterialId, zHint?: Vec3): this {
    const A = new Vector3(...a);
    const B = new Vector3(...b);
    const x = B.clone().sub(A);
    const len = x.length();
    if (len < 1e-6) return this;
    x.divideScalar(len);
    let z = zHint ? new Vector3(...zHint) : new Vector3().crossVectors(x, UP);
    if (z.lengthSq() < 1e-8) z = new Vector3(0, 0, 1);
    z.sub(x.clone().multiplyScalar(z.dot(x))).normalize();
    const y = new Vector3().crossVectors(z, x).normalize();
    const m = new Matrix4().makeBasis(x, y, z);
    const q = new Quaternion().setFromRotationMatrix(m);
    const c = A.add(B).multiplyScalar(0.5);
    this.parts.push({ pos: [c.x, c.y, c.z], size: [len, h, w], quat: [q.x, q.y, q.z, q.w], mat });
    return this;
  }

  /** Rotate every part added since `from` about the Y axis. */
  yawFrom(from: number, angle: number): this {
    if (!angle) return this;
    const q = new Quaternion().setFromAxisAngle(UP, angle);
    for (let i = from; i < this.parts.length; i++) {
      const p = this.parts[i];
      const v = new Vector3(...p.pos).applyQuaternion(q);
      const pq = new Quaternion(...p.quat).premultiply(q);
      p.pos = [v.x, v.y, v.z];
      p.quat = [pq.x, pq.y, pq.z, pq.w];
    }
    return this;
  }
}

interface RoofSpec {
  eaveHalf: number;
  eaveY: number;
  innerHalf: number;
  innerY: number;
  lift: number;
}

/** Point on the south roof face. u: 0 eave → 1 inner. s: -1..1 along the row. */
function roofPoint(r: RoofSpec, u: number, s: number): Vec3 {
  const half = r.eaveHalf + (r.innerHalf - r.eaveHalf) * u;
  const y = r.eaveY + (r.innerY - r.eaveY) * Math.pow(u, 1.5);
  const lift = r.lift * Math.pow(Math.abs(s), 3) * Math.pow(1 - u, 1.2);
  return [s * half, y + lift, half];
}

function sideStep(
  tier: TierId,
  member: string,
  spec: string,
  code: string,
  drop: number,
  build: (s: Sink) => void,
): StepDef[] {
  return SIDES.map((side, i) => {
    const s = new Sink();
    build(s);
    s.yawFrom(0, SIDE_ANGLE[i]);
    return { tier, member: `${member} · ${side}`, spec, code, drop, parts: s.parts };
  });
}

function step(tier: TierId, member: string, spec: string, code: string, drop: number, build: (s: Sink) => void): StepDef {
  const s = new Sink();
  build(s);
  return { tier, member, spec, code, drop, parts: s.parts };
}

// ─── Plinth ────────────────────────────────────────────────────────────────

function plinth(): StepDef[] {
  const T: TierId = 'PLINTH';
  const steps: StepDef[] = [];
  steps.push(
    step(T, 'SITE · SETTING-OUT', 'grid A–E / 1–5 · axis 0,0 · section grid 3.5 m', 'SO-01', 0, (s) => {
      for (let i = 0; i < 5; i++) {
        const k = -7 + i * 3.5;
        s.box([k, 0.01, 0], [0.025, 0.02, 15], 'stringline');
        s.box([0, 0.01, k], [15, 0.02, 0.025], 'stringline');
      }
      for (const x of [-7.5, 7.5]) for (const z of [-7.5, 7.5]) s.box([x, 0.2, z], [0.08, 0.4, 0.08], 'stringline');
    }),
  );
  const course = (half: number, y0: number, h: number, code: string, label: string) =>
    sideStep(T, `PLINTH · ${label}`, `granite ashlar · ${h.toFixed(2)} m course · 1.2 m blocks`, code, 0.6, (s) => {
      const n = Math.round((2 * half) / 1.2);
      const len = (2 * half) / n;
      for (let i = 0; i < n; i++) {
        const x = -half + len * (i + 0.5);
        s.box([x, y0 + h / 2, half - 0.45], [len - 0.03, h - 0.02, 0.9], 'granite');
      }
    });
  steps.push(...course(7.0, 0, 0.6, 'PL-01', 'LOWER COURSE'));
  steps.push(...course(6.4, 0.6, 0.6, 'PL-02', 'UPPER COURSE'));
  // paving: 13 × 13 slabs in 6 row bands
  const n = 13;
  const slab = 12.8 / n;
  const bands = [0, 2, 4, 6, 8, 10, 13];
  for (let b = 0; b < 6; b++) {
    steps.push(
      step(T, `PLINTH · PAVING · ROW ${b + 1}`, `stone slabs ${slab.toFixed(2)} × 0.10 m`, 'PV-01', 0.5, (s) => {
        for (let r = bands[b]; r < bands[b + 1]; r++)
          for (let c = 0; c < n; c++)
            s.box([-6.4 + slab * (c + 0.5), 1.25, -6.4 + slab * (r + 0.5)], [slab - 0.03, 0.1, slab - 0.03], 'granite');
      }),
    );
  }
  steps.push(
    ...sideStep(T, 'PLINTH · STAIR', '5 risers · 0.26 m · cheek walls', 'ST-01', 0.6, (s) => {
      for (let i = 0; i < 5; i++) {
        const depth = 0.38 * (5 - i);
        s.box([0, 0.13 + i * 0.26, 7.0 + depth / 2], [2.4, 0.26, depth], 'granite');
      }
      for (const x of [-1.35, 1.35]) s.box([x, 0.65, 7.0 + 0.95], [0.3, 1.3, 1.9], 'granite');
    }),
  );
  return steps;
}

// ─── Shared tier elements ─────────────────────────────────────────────────

function colXs(c: number) {
  return [-c, -c / 3, c / 3, c];
}

function perimeterColumns(c: number): Vec3[] {
  const out: Vec3[] = [];
  const xs = colXs(c);
  for (const x of xs) for (const z of xs) if (Math.abs(x) === c || Math.abs(z) === c) out.push([x, 0, z]);
  return out; // 12
}

function columns(T: TierId, k: number, extraInner: boolean): StepDef {
  const c = CORE[k];
  const F = FLOORS[k];
  const h = COL_H[k];
  const sec = k === 0 ? 0.42 : 0.32;
  return step(T, `${T} · COLUMNS`, `hinoki posts · section ${sec} × ${sec} m · ${h.toFixed(1)} m`, 'CL-01', 1.0, (s) => {
    for (const [x, , z] of perimeterColumns(c)) s.box([x, F + h / 2, z], [sec, h, sec], 'hinoki');
    if (extraInner) for (const x of [-1.1, 1.1]) for (const z of [-1.1, 1.1]) s.box([x, F + h / 2, z], [0.36, h, 0.36], 'hinoki');
  });
}

function centralPillar(T: TierId, y0: number, y1: number): StepDef {
  return step(T, `${T} · CENTRAL PILLAR`, `shinbashira segment · section 0.60 m · ${(y1 - y0).toFixed(2)} m`, 'CP-01', 1.2, (s) => {
    s.box([0, (y0 + y1) / 2, 0], [0.6, y1 - y0, 0.6], 'hinoki');
  });
}

function sills(T: TierId, k: number): StepDef[] {
  const c = CORE[k];
  const F = FLOORS[k];
  const h = COL_H[k];
  return sideStep(T, `${T} · SILLS & TIE BEAMS`, 'nageshi · kashiranuki · section 0.25 × 0.25 m', 'TB-01', 0.6, (s) => {
    for (const y of [F + 0.12, F + 2.0 * (h / 3.4), F + h - 0.15]) s.box([0, y, c], [2 * c + 0.3, 0.25, 0.22], 'hinoki');
    s.box([0, F + h * 0.35, c], [2 * c, 0.16, 0.18], 'hinoki');
  });
}

function doors(T: TierId, k: number): StepDef[] {
  const c = CORE[k];
  const F = FLOORS[k];
  const h = COL_H[k];
  const bay = (2 * c) / 3;
  const openH = 2.0 * (h / 3.4) - 0.25;
  return sideStep(T, `${T} · DOORS & LATTICE WINDOWS`, 'panel doors · renji lattice · lime plaster above', 'DR-01', 0.4, (s) => {
    // central bay: twin panel doors
    for (const x of [-bay / 4, bay / 4]) s.box([x, F + 0.25 + openH / 2, c - 0.02], [bay / 2 - 0.06, openH, 0.06], 'keyaki');
    // side bays: lattice windows
    for (const cx of [-bay, bay]) {
      s.box([cx, F + openH * 0.45, c - 0.02], [bay - 0.1, 0.1, 0.12], 'hinoki');
      for (let i = 0; i < 6; i++) {
        const x = cx - bay / 2 + (bay / 7) * (i + 1);
        s.box([x, F + openH * 0.45 + (openH * 0.55) / 2 + 0.05, c - 0.02], [0.05, openH * 0.55, 0.05], 'hinoki');
      }
      s.box([cx, F + 0.15 + openH * 0.2, c - 0.04], [bay - 0.1, openH * 0.4, 0.05], 'plaster');
    }
    // plaster panels between lintel and head beam
    const y0 = F + 2.0 * (h / 3.4) + 0.12;
    const y1 = F + h - 0.27;
    if (y1 - y0 > 0.1) for (const cx of [-bay, 0, bay]) s.box([cx, (y0 + y1) / 2, c - 0.04], [bay - 0.1, y1 - y0, 0.06], 'plaster');
  });
}

function brackets(T: TierId, k: number): StepDef[] {
  const c = CORE[k];
  const top = FLOORS[k] + COL_H[k];
  return sideStep(T, `${T} · BRACKET SETS`, '3-step mitesaki · daito · hijiki · makito', 'BR-01', 0.5, (s) => {
    for (const x of colXs(c)) {
      s.box([x, top + 0.12, c], [0.45, 0.24, 0.45], 'keyaki'); // daito
      s.box([x, top + 0.33, c], [1.1, 0.18, 0.18], 'keyaki'); // hijiki (along wall)
      for (const dx of [-0.45, 0, 0.45]) s.box([x + dx, top + 0.5, c], [0.22, 0.16, 0.22], 'keyaki');
      s.box([x, top + 0.42, c + 0.45], [0.18, 0.18, 1.1], 'keyaki'); // projecting arm
      s.box([x, top + 0.6, c + 0.9], [0.26, 0.18, 0.26], 'keyaki');
      s.box([x, top + 0.74, c + 0.9], [0.9, 0.14, 0.16], 'keyaki');
      s.box([x, top + 0.6, c + 0.45], [0.22, 0.16, 0.22], 'keyaki');
    }
  });
}

function levers(T: TierId, k: number): StepDef {
  const c = CORE[k];
  const top = FLOORS[k] + COL_H[k];
  const o = OVERHANG[k];
  return step(T, `${T} · CANTILEVER LEVERS`, 'odaruki · hanegi · section 0.24 × 0.30 m', 'CV-01', 0.7, (s) => {
    for (let i = 0; i < 4; i++) {
      const from = s.parts.length;
      for (const x of [-c * 0.66, 0, c * 0.66]) s.beam([x, top + 1.05, c - 1.0], [x, top + 0.55, c + o - 0.6], 0.3, 0.24, 'keyaki');
      s.beam([c - 0.9, top + 1.1, c - 0.9], [c + o - 0.8, top + 0.6, c + o - 0.8], 0.32, 0.26, 'keyaki'); // corner diagonal
      s.yawFrom(from, SIDE_ANGLE[i]);
    }
  });
}

function rafters(T: TierId, r: RoofSpec, wallHalf: number, label = 'RAFTERS', code = 'RF-01'): StepDef[] {
  // u where the roof surface crosses the wall line; rafters run from there to the eave
  const uWall = Math.min(1, Math.max(0.2, (r.eaveHalf - wallHalf) / (r.eaveHalf - r.innerHalf)));
  const uFly = uWall * 0.3;
  const under = (u: number, s: number): Vec3 => {
    const p = roofPoint(r, u, s);
    p[1] -= 0.16;
    return p;
  };
  return sideStep(T, `${T} · ${label}`, 'base + flying rafters · 0.11 × 0.13 m', code, 0.5, (s) => {
    const n = Math.max(12, Math.round((2 * r.eaveHalf) / 0.45));
    for (let i = 0; i < n; i++) {
      const sN = -1 + (2 * (i + 0.5)) / n;
      s.beam(under(uWall, sN), under(uFly, sN), 0.13, 0.11, 'hinoki');
      s.beam(under(uFly, sN), under(0, sN), 0.11, 0.1, 'hinoki');
    }
  });
}

function roofTiles(T: TierId, r: RoofSpec, label = 'ROOF BOARDS & TILES', code = 'RT-01'): StepDef[] {
  return sideStep(T, `${T} · ${label}`, 'hongawara tile · 0.27 m rows · hip ridge', code, 0.35, (s) => {
    const slope = Math.hypot(r.eaveHalf - r.innerHalf, r.innerY - r.eaveY);
    const rows = Math.max(5, Math.round(slope / 0.32));
    for (let j = 0; j < rows; j++) {
      const u = (j + 0.5) / rows;
      const du = 0.5 / rows;
      const segs = Math.max(6, Math.round((2 * (r.eaveHalf + (r.innerHalf - r.eaveHalf) * u)) / 0.85));
      for (let i = 0; i < segs; i++) {
        const sa = -1 + (2 * i) / segs;
        const sb = -1 + (2 * (i + 1)) / segs;
        const a = roofPoint(r, u, sa);
        const b = roofPoint(r, u, sb);
        const down = roofPoint(r, u - du, (sa + sb) / 2);
        const upp = roofPoint(r, u + du, (sa + sb) / 2);
        const zHint: Vec3 = [down[0] - upp[0], down[1] - upp[1], down[2] - upp[2]];
        s.beam(a, b, 0.07, (slope / rows) * 1.02, 'tile', zHint);
      }
    }
    // eave fascia board (follows the corner lift)
    const fs = 8;
    for (let i = 0; i < fs; i++) {
      const a = roofPoint(r, 0, -1 + (2 * i) / fs);
      const b = roofPoint(r, 0, -1 + (2 * (i + 1)) / fs);
      a[1] -= 0.08;
      b[1] -= 0.08;
      s.beam(a, b, 0.2, 0.12, 'hinoki');
    }
    // hip ridge on the +X corner
    for (let i = 0; i < 4; i++) {
      const a = roofPoint(r, i / 4, 1);
      const b = roofPoint(r, (i + 1) / 4, 1);
      a[1] += 0.08;
      b[1] += 0.08;
      s.beam(a, b, 0.18, 0.22, 'tile');
    }
  });
}

function balcony(T: TierId, k: number): StepDef[] {
  const c = CORE[k];
  const F = FLOORS[k];
  const out = c + 0.9;
  return sideStep(T, `${T} · BALCONY`, 'koshigumi blocks · deck · kōran railing', 'BC-01', 0.5, (s) => {
    for (const x of [-c * 0.66, 0, c * 0.66]) s.box([x, F - 0.18, c + 0.35], [0.3, 0.22, 0.6], 'keyaki');
    for (let i = 0; i < 4; i++) s.box([0, F + 0.03, c + 0.11 + i * 0.22], [2 * out, 0.06, 0.2], 'hinoki');
    for (let i = 0; i <= 4; i++) s.box([-out + (2 * out * i) / 4, F + 0.45, out], [0.1, 0.84, 0.1], 'hinoki');
    for (const y of [F + 0.2, F + 0.55, F + 0.86]) s.box([0, y, out], [2 * out, 0.07, 0.07], 'hinoki');
  });
}

function floorFraming(T: TierId, k: number): StepDef {
  const c = CORE[k];
  const F = FLOORS[k];
  return step(T, `${T} · FLOOR FRAMING`, 'joists 0.18 × 0.24 m @ 0.9 m · two girders', 'FF-01', 0.6, (s) => {
    for (const z of [-c * 0.5, c * 0.5]) s.box([0, F - 0.3, z], [2 * c, 0.3, 0.26], 'keyaki');
    const n = Math.round((2 * c) / 0.9);
    for (let i = 0; i <= n; i++) s.box([-c + (2 * c * i) / n, F - 0.08, 0], [0.18, 0.24, 2 * c], 'hinoki');
  });
}

function ladder(T: TierId, k: number): StepDef {
  const c = CORE[k];
  const F = FLOORS[k];
  const N = FLOORS[k + 1];
  return step(T, `${T} · LADDER`, `2 stringers · 6 treads · rise ${(N - F).toFixed(2)} m`, 'LD-01', 0.5, (s) => {
    const x0 = c * 0.5;
    for (const dz of [-0.3, 0.3]) s.beam([x0 - 1.2, F + 0.1, c * 0.45 + dz], [x0 + 0.2, N - 0.2, c * 0.45 + dz], 0.18, 0.08, 'hinoki');
    for (let i = 1; i <= 6; i++) {
      const t = i / 7;
      s.box([x0 - 1.2 + 1.4 * t, F + 0.1 + (N - F - 0.3) * t, c * 0.45], [0.2, 0.05, 0.6], 'hinoki');
    }
  });
}

function tierRoof(k: number, isTop: boolean): RoofSpec {
  const c = CORE[k];
  const top = FLOORS[k] + COL_H[k];
  return {
    eaveHalf: c + OVERHANG[k],
    eaveY: top + 0.95,
    innerHalf: isTop ? 0.4 : c - 0.35,
    innerY: isTop ? APEX : FLOORS[k + 1] - 0.18,
    lift: 0.75,
  };
}

// ─── Tier 1 (with mokoshi lean-to and interior) ───────────────────────────

function tier1(): StepDef[] {
  const T: TierId = 'TIER 1';
  const k = 0;
  const c = CORE[0];
  const F = FLOORS[0];
  const steps: StepDef[] = [];
  steps.push(centralPillar(T, 1.0, FLOORS[1]));
  steps.push(columns(T, 0, true));
  const vp = 4.6;
  steps.push(
    step(T, 'MOKOSHI · VERANDA POSTS', `${vp.toFixed(1)} m line · 0.26 m posts · 2.3 m`, 'VP-01', 0.9, (s) => {
      for (const x of colXs(vp)) for (const z of colXs(vp)) if (Math.abs(x) === vp || Math.abs(z) === vp) s.box([x, F + 1.15, z], [0.26, 2.3, 0.26], 'hinoki');
    }),
  );
  steps.push(
    ...sideStep(T, 'MOKOSHI · HEAD BEAMS & BRACKETS', 'single-step brackets · tie beams to the wall · section 0.18 × 0.22 m', 'MB-01', 0.6, (s) => {
      s.box([0, F + 2.4, vp], [2 * vp + 0.3, 0.22, 0.2], 'hinoki');
      for (const x of colXs(vp)) {
        s.box([x, F + 2.62, vp], [0.32, 0.2, 0.32], 'keyaki');
        s.beam([x * (c / vp), F + 2.4, c], [x, F + 2.4, vp], 0.18, 0.15, 'hinoki');
      }
    }),
  );
  steps.push(...sills(T, k));
  steps.push(...doors(T, k));
  steps.push(
    step(T, 'INTERIOR · ALTAR DAIS', 'shumidan · 2.6 m square · 0.5 m high · two steps', 'AL-01', 0.4, (s) => {
      s.box([0, F + 0.25, 0], [2.6, 0.5, 2.6], 'keyaki');
      s.box([0, F + 0.08, 1.55], [1.4, 0.16, 0.5], 'keyaki');
      s.box([0, F + 0.08, -1.55], [1.4, 0.16, 0.5], 'keyaki');
    }),
  );
  SIDES.forEach((side, i) => {
    steps.push(
      step(T, `INTERIOR · SEATED BUDDHA · ${side}`, 'lotus pedestal · gilt figure · halo', 'BU-01', 0.3, (s) => {
        const y = F + 0.5;
        s.box([0, y + 0.15, 0.85], [0.62, 0.3, 0.62], 'gilt');
        s.box([0, y + 0.36, 0.85], [0.7, 0.12, 0.7], 'gilt');
        s.box([0, y + 0.36, 0.85], [0.7, 0.12, 0.7], 'gilt', Math.PI / 4);
        s.box([0, y + 0.72, 0.85], [0.42, 0.6, 0.36], 'gilt');
        s.box([0, y + 1.14, 0.85], [0.22, 0.24, 0.22], 'gilt');
        s.box([0, y + 1.0, 0.66], [0.7, 0.85, 0.04], 'gilt');
        s.yawFrom(0, SIDE_ANGLE[i]);
      }),
    );
  });
  const ceilY = F + COL_H[0] - 0.35;
  steps.push(
    step(T, 'INTERIOR · COFFERED CEILING', 'gōtenjō · gilt panels · 0.55 m grid', 'CC-01', 0.4, (s) => {
      const span = 2.2;
      for (let i = 0; i < 6; i++) {
        const v = -span + (2 * span * i) / 5;
        s.box([v, ceilY, 0], [0.1, 0.14, 2 * span], 'keyaki');
        s.box([0, ceilY, v], [2 * span, 0.14, 0.1], 'keyaki');
      }
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) s.box([-1.47 + 1.47 * i, ceilY + 0.08, -1.47 + 1.47 * j], [1.3, 0.03, 1.3], 'gilt');
      s.box([0, ceilY + 0.15, 2.3], [4.8, 0.2, 0.2], 'keyaki');
      s.box([0, ceilY + 0.15, -2.3], [4.8, 0.2, 0.2], 'keyaki');
    }),
  );
  steps.push(
    step(T, 'INTERIOR · HANGING LANTERNS', '4 bronze lanterns · chains', 'LN-01', 0.5, (s) => {
      for (const [x, z] of [[-1.8, 1.8], [1.8, 1.8], [1.8, -1.8], [-1.8, -1.8]]) {
        s.box([x, ceilY - 0.6, z], [0.28, 0.4, 0.28], 'bronze');
        s.box([x, ceilY - 0.3, z], [0.04, 0.5, 0.04], 'bronze');
      }
    }),
  );
  const mokoshi: RoofSpec = { eaveHalf: 6.0, eaveY: F + 2.55, innerHalf: c + 0.05, innerY: F + 3.35, lift: 0.3 };
  steps.push(...rafters(T, mokoshi, c, 'MOKOSHI · RAFTERS', 'MR-01').map(renameMokoshi));
  steps.push(...roofTiles(T, mokoshi, 'MOKOSHI · ROOF BOARDS & TILES', 'MT-01').map(renameMokoshi));
  steps.push(...brackets(T, k));
  steps.push(levers(T, k));
  const roof = tierRoof(k, false);
  steps.push(...rafters(T, roof, c));
  steps.push(...roofTiles(T, roof));
  return steps;
}

function renameMokoshi(s: StepDef): StepDef {
  return { ...s, member: s.member.replace('TIER 1 · MOKOSHI', 'MOKOSHI') };
}

// ─── Tiers 2–5 ────────────────────────────────────────────────────────────

function upperTier(k: number): StepDef[] {
  const T = `TIER ${k + 1}` as TierId;
  const isTop = k === 4;
  const F = FLOORS[k];
  const steps: StepDef[] = [];
  steps.push(floorFraming(T, k));
  steps.push(centralPillar(T, F, isTop ? APEX + 0.6 : FLOORS[k + 1]));
  steps.push(columns(T, k, false));
  steps.push(...sills(T, k));
  steps.push(...balcony(T, k));
  steps.push(...doors(T, k));
  if (!isTop) steps.push(ladder(T, k));
  steps.push(...brackets(T, k));
  steps.push(levers(T, k));
  const roof = tierRoof(k, isTop);
  steps.push(...rafters(T, roof, CORE[k]));
  steps.push(...roofTiles(T, roof));
  return steps;
}

// ─── Spire (sōrin) ────────────────────────────────────────────────────────

export const SPIRE_TOP = 37.54;

function spire(): StepDef[] {
  const T: TierId = 'SPIRE';
  const steps: StepDef[] = [];
  let y = APEX;
  steps.push(step(T, 'SPIRE · DEW BASIN', 'roban · bronze 1.45 m', 'SR-01', 0.6, (s) => s.box([0, y + 0.25, 0], [1.45, 0.5, 1.45], 'bronze')));
  y += 0.5;
  const mastTop = SPIRE_TOP - 1.9;
  steps.push(
    step(T, 'SPIRE · INVERTED BOWL & MAST', 'fukubachi · sōrin mast ⌀ 0.22 m', 'SR-02', 0.6, (s) => {
      s.box([0, y + 0.22, 0], [1.1, 0.44, 1.1], 'bronze');
      s.box([0, (y + mastTop) / 2, 0], [0.22, mastTop - y, 0.22], 'bronze');
    }),
  );
  y += 0.44;
  steps.push(step(T, 'SPIRE · LOTUS', 'ukebana · open lotus · 1.2 m', 'SR-03', 0.5, (s) => s.box([0, y + 0.15, 0], [1.2, 0.3, 1.2], 'bronze', Math.PI / 4)));
  y += 0.45;
  const ringGap = (mastTop - 0.8 - y) / 9;
  for (let i = 0; i < 9; i++) {
    const w = 1.05 - i * 0.04;
    const yy = y + ringGap * (i + 0.5);
    steps.push(step(T, `SPIRE · RING ${i + 1} OF 9`, `kurin · bronze ring ⌀ ${w.toFixed(2)} m`, `SR-${String(4 + i).padStart(2, '0')}`, 0.5, (s) => s.box([0, yy, 0], [w, 0.12, w], 'bronze', (i % 2) * (Math.PI / 4))));
  }
  steps.push(
    step(T, 'SPIRE · WATER FLAME', 'suien · pierced bronze · 4 leaves', 'SR-13', 0.5, (s) => {
      for (let i = 0; i < 4; i++) s.box([0, mastTop - 0.1, 0], [0.9, 1.1, 0.03], 'bronze', (i * Math.PI) / 4);
    }),
  );
  steps.push(
    step(T, 'SPIRE · DRAGON VESSEL & JEWEL', 'ryūsha · hōju · finial', 'SR-14', 0.5, (s) => {
      s.box([0, mastTop + 0.65, 0], [0.4, 0.4, 0.4], 'bronze');
      s.box([0, mastTop + 1.1, 0], [0.12, 0.5, 0.12], 'bronze');
      s.box([0, SPIRE_TOP - 0.25, 0], [0.38, 0.5, 0.38], 'gilt', Math.PI / 4);
    }),
  );
  return steps;
}

export function generatePagoda(): StepDef[] {
  return [...plinth(), ...tier1(), upperTier(1), upperTier(2), upperTier(3), upperTier(4), spire()].flat();
}

export const LEVELS = [
  { code: 'GL', y: 0 },
  { code: 'FL 1', y: FLOORS[0] },
  { code: 'T2', y: FLOORS[1] },
  { code: 'T3', y: FLOORS[2] },
  { code: 'T4', y: FLOORS[3] },
  { code: 'T5', y: FLOORS[4] },
  { code: 'APEX', y: APEX },
  { code: 'TOP', y: SPIRE_TOP },
];

export { r2 };
