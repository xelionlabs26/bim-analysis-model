/**
 * Arbor House — a 32-storey hybrid mass-timber residential tower, authored as
 * an ordered list of install steps. Every part is an oriented box.
 *
 *   L0–L2   concrete podium (lobby, amenity) on piles + raft
 *   L3      concrete transfer deck
 *   L3–L31  glulam frame + CLT floors around a cast-in-place concrete core,
 *           prefab bathroom pods, unitised façade with parametric terracotta
 *           fins and staggered planted balconies
 *   L12–13, L22–23  double-height sky gardens (south-east corner)
 *   L24+    floors step back one bay on the south side over a planted sky terrace
 *   roof    green roof, garden trees, PV canopy on a glulam frame, terracotta crown
 *
 * Sequencing rules baked in (and checked in tests):
 *   - the core is poured in jumps and always leads the timber frame by ≥ 2 floors
 *   - each floor goes columns + beams → bathroom pods → CLT slab above
 *   - façade units trail the structure by two floors
 *
 * Side-specific elements are built for the south face (+Z) and rotated about Y
 * for east (+X), north (−Z) and west (−X).
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Crane, MaterialId, Method, Motion, Part, StepDef, Vec3, ZoneId } from './types';

export const GRID = 7;
export const HALF = 14; // structural grid half-width (column lines)
export const EDGE = 14.15; // slab edge / glass line
export const CORE = 4.8; // core outer half-width
export const F2F = 3.3; // timber floor-to-floor
export const PODIUM_LEVELS = [0, 4.5, 9.0];
export const TRANSFER = 13.5; // L3
export const ROOF_LEVEL = 32;
export const levelY = (L: number) => (L <= 2 ? PODIUM_LEVELS[L] : TRANSFER + (L - 3) * F2F);
export const ROOF = levelY(ROOF_LEVEL);
export const SKY_GARDENS = [12, 22]; // garden on this level, void through the next
export const SETBACK_FROM = 24; // floors from here up step back one bay on the south side
export const SET_EDGE = 7.15; // south slab edge above the setback
export const STOREYS = 32; // L0–L31

const SIDE_ANGLE = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
const UP = new Vector3(0, 1, 0);
const XS = [-14, -7, 0, 7, 14];
const lv = (L: number) => (L >= ROOF_LEVEL ? 'ROOF' : `L${String(L).padStart(2, '0')}`);

export const CRANE: Crane = {
  id: 'TC-1',
  base: [-26, 0, 0],
  jib: 60,
  counterJib: 18,
  maxKg: 12000,
  tipKg: 2440,
  capacityAt: (r: number) => Math.min(12000, 12000 * Math.pow(20 / Math.max(r, 1), 1.45)),
  tieX: -14.2,
  mastStart: 44,
};

class Sink {
  parts: Part[] = [];

  box(c: Vec3, size: Vec3, mat: MaterialId, yaw = 0): this {
    const q = new Quaternion().setFromAxisAngle(UP, yaw);
    this.parts.push({ pos: [...c], size: [...size], quat: [q.x, q.y, q.z, q.w], mat });
    return this;
  }

  /** Box running from a to b (local X); `zHint` steers its width axis. */
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
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    const c = A.add(B).multiplyScalar(0.5);
    this.parts.push({ pos: [c.x, c.y, c.z], size: [len, h, w], quat: [q.x, q.y, q.z, q.w], mat });
    return this;
  }

  /** Rotate every part added since `from` about the Y axis (through the origin). */
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

  tree(x: number, y: number, z: number, h = 4.2, yaw = 0): this {
    this.box([x, y + h * 0.3, z], [0.28, h * 0.6, 0.28], 'planting');
    const c = y + h * 0.62;
    this.box([x, c, z], [2.4, 1.2, 2.4], 'planting', yaw);
    this.box([x, c + 0.95, z], [1.8, 1.0, 1.8], 'planting', yaw + Math.PI / 4);
    this.box([x, c + 1.75, z], [1.0, 0.8, 1.0], 'planting', yaw);
    return this;
  }
}

/** World position of a side-local point (side-local south face is +Z). */
function toWorld(x: number, z: number, side: number): [number, number] {
  const a = SIDE_ANGLE[side];
  return [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
}

/** The south-east corner bay that is left open for the sky gardens. */
const inSkyCorner = (wx: number, wz: number) => wx > 7 && wz > 7;
/** Above the setback the south bay (z > 7) is terrace, not building. */
const setBack = (L: number) => L >= SETBACK_FROM;
const southEdge = (L: number) => (setBack(L) ? SET_EDGE : EDGE);

interface Opts {
  zone: ZoneId;
  member: string;
  spec: string;
  code: string;
  method: Method;
  motion?: Motion;
  drop?: number;
  level?: number;
  kind?: StepDef['kind'];
  log?: string;
}

function step(o: Opts, build: (s: Sink) => void): StepDef {
  const s = new Sink();
  build(s);
  return {
    zone: o.zone,
    member: o.member,
    spec: o.spec,
    code: o.code,
    method: o.method,
    motion: o.motion ?? (o.method === 'cast' ? 'pour' : 'lower'),
    drop: o.drop ?? (o.method === 'crane' ? 2.4 : 0),
    level: o.level,
    kind: o.kind ?? 'other',
    log: o.log,
    parts: s.parts,
  };
}

// ─── Groundworks ──────────────────────────────────────────────────────────

function site(): StepDef[] {
  const Z: ZoneId = 'SITE';
  const out: StepDef[] = [];
  out.push(
    step({ zone: Z, member: 'SITE · SETTING-OUT', spec: 'grid A–E / 1–5 · 7.0 m bays · crane pad pegged', code: 'SO-01', method: 'manual' }, (s) => {
      for (const k of XS) {
        s.box([k, 0.01, 0], [0.04, 0.02, 40], 'stringline');
        s.box([0, 0.01, k], [40, 0.02, 0.04], 'stringline');
      }
      for (const [x, z] of [[-20, -20], [20, -20], [20, 20], [-20, 20], [-26, 0]]) s.box([x, 0.25, z], [0.12, 0.5, 0.12], 'stringline');
    }),
  );
  const pileXs = [-15, -9, -3, 3, 9, 15];
  const quads: [string, (x: number, z: number) => boolean][] = [
    ['NORTH-WEST', (x, z) => x < 0 && z < 0],
    ['NORTH-EAST', (x, z) => x > 0 && z < 0],
    ['SOUTH-EAST', (x, z) => x > 0 && z > 0],
    ['SOUTH-WEST', (x, z) => x < 0 && z > 0],
  ];
  for (const [name, inQ] of quads) {
    out.push(
      step({ zone: Z, member: `PILES · ${name}`, spec: 'bored CFA piles · ⌀ 900 mm · 18 m to clay', code: 'PL-01', method: 'cast', motion: 'bore' }, (s) => {
        for (const x of pileXs) for (const z of pileXs) if (inQ(x, z)) s.box([x, -11, z], [0.9, 18, 0.9], 'concrete');
      }),
    );
  }
  for (const [name, sx, sz] of [['NORTH-WEST', -1, -1], ['NORTH-EAST', 1, -1], ['SOUTH-EAST', 1, 1], ['SOUTH-WEST', -1, 1]] as const) {
    out.push(
      step({ zone: Z, member: `RAFT · POUR ${name}`, spec: 'piled raft · 2.0 m deep · C40/50 · 578 m³ per pour', code: 'RF-01', method: 'cast' }, (s) => {
        s.box([sx * 8.5, -1.0, sz * 8.5], [16.96, 2.0, 16.96], 'concrete');
      }),
    );
  }
  out.push(
    step({ zone: Z, member: 'TC-1 · CRANE BASE', spec: 'cast pad 8 × 8 × 2.0 m · holding-down anchors', code: 'TC-01', method: 'cast' }, (s) => {
      s.box([CRANE.base[0], -1.0, CRANE.base[2]], [8, 2.0, 8], 'concrete');
    }),
  );
  out.push(
    step(
      {
        zone: Z,
        member: 'TC-1 · TOWER CRANE ERECTED',
        spec: 'flat-top · 60 m jib · 12 t max · 2.4 t at tip',
        code: 'TC-02',
        method: 'manual',
        log: 'ERECT TC-1 · flat-top · 60 m jib · 12 t max · 2.4 t at tip',
      },
      () => {},
    ),
  );
  return out;
}

// ─── Shared structure ─────────────────────────────────────────────────────

function gridPoints(): [number, number][] {
  const pts: [number, number][] = [];
  for (const x of XS) for (const z of XS) if (!(Math.abs(x) < CORE && Math.abs(z) < CORE)) pts.push([x, z]);
  return pts; // 24
}

function coreJump(zone: ZoneId, a: number, b: number, yTop?: number): StepDef {
  const y0 = levelY(a);
  const y1 = yTop ?? levelY(b);
  const h = y1 - y0;
  const label = yTop ? `CORE · LIFT OVERRUN & TOPPING OUT` : `CORE · JUMP ${lv(a)}–${lv(b)}`;
  return step(
    { zone, member: label, spec: `jump-formed RC core · 400 mm walls · ${h.toFixed(1)} m lift`, code: 'CR-01', method: 'cast', level: b, kind: 'core' },
    (s) => {
      const c = y0 + h / 2;
      s.box([0, c, CORE - 0.2], [2 * CORE, h, 0.4], 'concrete');
      s.box([0, c, -CORE + 0.2], [2 * CORE, h, 0.4], 'concrete');
      s.box([CORE - 0.2, c, 0], [0.4, h, 2 * CORE - 0.8], 'concrete');
      s.box([-CORE + 0.2, c, 0], [0.4, h, 2 * CORE - 0.8], 'concrete');
      s.box([-1.2, c, 0], [0.25, h, 2 * CORE - 0.8], 'concrete');
      s.box([1.6, c, 0], [0.25, h, 2 * CORE - 0.8], 'concrete');
      s.box([2.95, c, 0.9], [2.45, h, 0.25], 'concrete');
    },
  );
}

/** Rectangles of a floor plate around the core (podium flat slabs). */
function plateAroundCore(s: Sink, yTop: number, t: number, mat: MaterialId) {
  const y = yTop - t / 2;
  const span = 2 * EDGE;
  const strip = EDGE - CORE;
  s.box([0, y, (EDGE + CORE) / 2], [span, t, strip], mat);
  s.box([0, y, -(EDGE + CORE) / 2], [span, t, strip], mat);
  s.box([(EDGE + CORE) / 2, y, 0], [strip, t, 2 * CORE], mat);
  s.box([-(EDGE + CORE) / 2, y, 0], [strip, t, 2 * CORE], mat);
}

function columnSize(L: number) {
  return L <= 12 ? 0.56 : L <= 22 ? 0.48 : 0.4;
}

function frame(zone: ZoneId, L: number): StepDef {
  const c = columnSize(L);
  const y0 = levelY(L);
  const y1 = levelY(L + 1) - 0.2;
  const mm = Math.round(c * 1000);
  return step(
    { zone, member: `${lv(L)} · GLULAM COLUMNS & BEAMS`, spec: `GL28h · columns ${mm} × ${mm} mm · beams 360 × 720 mm`, code: 'GL-01', method: 'crane', drop: 2.0, level: L, kind: 'frame' },
    (s) => {
      const sb = setBack(L);
      // where the sky garden leaves this floor out, the corner column runs down to the one below
      const void_ = SKY_GARDENS.includes(L - 1);
      for (const [x, z] of gridPoints()) {
        if (sb && z > 7) continue;
        const drop = void_ && inSkyCorner(x, z) ? 0.2 : 0;
        s.box([x, (y0 - drop + y1) / 2, z], [c, y1 - y0 + drop, c], 'glulam');
      }
      const by = y1 - 0.36;
      for (const z of [-14, -7, 7, 14]) if (!(sb && z > 7)) for (let i = 0; i < 4; i++) s.box([-10.5 + 7 * i, by, z], [6.6, 0.72, 0.36], 'glulam');
      for (const x of [-14, -7, 7, 14]) for (let i = 0; i < (sb ? 3 : 4); i++) s.box([x, by, -10.5 + 7 * i], [0.36, 0.72, 6.6], 'glulam');
    },
  );
}

function pods(zone: ZoneId, L: number): StepDef {
  const y = levelY(L) + 1.3;
  return step(
    { zone, member: `${lv(L)} · BATHROOM PODS`, spec: '6 prefab pods · 2.4 × 1.8 m · fitted and tested off-site', code: 'BP-01', method: 'crane', drop: 2.6, level: L, kind: 'pods' },
    (s) => {
      const south = setBack(L) ? 5.8 : 8.6;
      for (const [x, z] of [[-8.6, 2.4], [-8.6, -2.4], [8.6, 2.4], [8.6, -2.4], [2.4, south], [-2.4, -8.6]]) s.box([x, y, z], [2.4, 2.6, 1.8], 'pod');
    },
  );
}

/** Trim an interval so it stays clear of the core span, or null if nothing is left. */
function trim(a: number, b: number): [number, number] | null {
  if (a >= 0) a = Math.max(a, CORE);
  else if (b <= 0) b = Math.min(b, -CORE);
  return b - a > 0.5 ? [a, b] : null;
}

function cltSlab(zone: ZoneId, L: number): StepDef {
  const top = levelY(L);
  const roof = L >= ROOF_LEVEL;
  const skyVoid = SKY_GARDENS.includes(L - 1);
  return step(
    {
      zone,
      member: roof ? 'ROOF · CLT DECK' : `${lv(L)} · CLT FLOOR PANELS`,
      spec: roof ? '5-ply CLT · 200 mm · falls to outlets · PV canopy over' : `5-ply CLT · 200 mm · 3.5 × 7.0 m panels${skyVoid ? ' · sky-garden void left open' : ''}`,
      code: 'CL-01',
      method: 'crane',
      drop: 2.4,
      level: L,
      kind: 'slab',
    },
    (s) => {
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 4; j++) {
          let x: [number, number] | null = [-14 + 3.5 * i, -10.5 + 3.5 * i];
          let z: [number, number] | null = [-14 + 7 * j, -7 + 7 * j];
          if (i === 0) x = [-EDGE, x[1]];
          if (i === 7) x = [x[0], EDGE];
          if (j === 0) z = [-EDGE, z[1]];
          if (j === 3) z = [z[0], EDGE];
          const overlapX = x[0] < CORE && x[1] > -CORE;
          const overlapZ = z[0] < CORE && z[1] > -CORE;
          if (overlapX && overlapZ) {
            if (x[0] >= -CORE && x[1] <= CORE) z = trim(z[0], z[1]);
            else x = trim(x[0], x[1]);
          }
          if (!x || !z) continue;
          const cx = (x[0] + x[1]) / 2;
          const cz = (z[0] + z[1]) / 2;
          if (skyVoid && inSkyCorner(cx, cz)) continue;
          if (L > SETBACK_FROM && cz > 7) continue; // stepped back over the terrace
          if (L > SETBACK_FROM && j === 2) z = [z[0], SET_EDGE];
          s.box([cx, top - 0.1, (z[0] + z[1]) / 2], [x[1] - x[0] - 0.04, 0.2, z[1] - z[0] - 0.04], 'clt');
        }
      }
    },
  );
}

/** Staggered balconies: two bays per side, alternating floor by floor. */
const hasBalcony = (L: number, side: number, bay: number) => (bay + L + side) % 2 === 0;
const isGardenLevel = (L: number) => SKY_GARDENS.some((g) => L === g || L === g + 1);

function facade(zone: ZoneId, L: number): StepDef {
  const y0 = levelY(L);
  const h = F2F;
  return step(
    {
      zone,
      member: `${lv(L)} · FAÇADE UNITS & BALCONIES`,
      spec: 'unitised triple glazing · terracotta fins · planted CLT balconies',
      code: 'FC-01',
      method: 'crane',
      drop: 1.6,
      level: L,
      kind: 'facade',
    },
    (s) => {
      for (let side = 0; side < 4; side++) {
        const from = s.parts.length;
        const deep = side === 0 || side === 3 ? 1 : 0.7; // south and west fins work hardest
        const EDGE = side === 0 ? southEdge(L) : 14.15;
        for (let bay = 0; bay < 4; bay++) {
          const bx0 = -14 + 7 * bay;
          const bcx = bx0 + 3.5;
          const [wx, wz] = toWorld(bcx, EDGE, side);
          if (isGardenLevel(L) && inSkyCorner(wx, wz)) continue; // open sky-garden corner
          if (side !== 0 && setBack(L) && wz > SET_EDGE) continue; // terrace, not façade
          const balcony = hasBalcony(L, side, bay);
          for (let m = 0; m < 4; m++) {
            const cx = bx0 + 1.75 * (m + 0.5);
            s.box([cx, y0 + 0.05 + (h - 0.4) / 2, EDGE], [1.69, h - 0.4, 0.06], 'glass');
            const jx = bx0 + 1.75 * m;
            const joint = bay * 4 + m;
            if (!balcony && joint > 0) {
              const wave = 0.5 + 0.5 * Math.sin((joint / 16) * Math.PI * 2 + L * 0.42 + side * 1.3);
              const d = (0.22 + 0.42 * wave) * deep;
              s.box([jx, y0 + h / 2, EDGE + d / 2], [0.12, h - 0.1, d], 'terracotta');
            }
          }
          s.box([bcx, y0 + h - 0.17, EDGE + 0.04], [7, 0.34, 0.08], 'aluminium');
          if (balcony) {
            const y = y0 - 0.1;
            s.box([bcx, y, EDGE + 1.0], [6.6, 0.2, 2.0], 'clt');
            s.box([bcx, y0 + 0.55, EDGE + 2.0], [6.6, 1.1, 0.03], 'glass');
            for (const dx of [-3.3, 3.3]) s.box([bcx + dx, y0 + 0.55, EDGE + 1.0], [0.03, 1.1, 2.0], 'glass');
            s.box([bcx, y0 + 0.225, EDGE + 1.65], [6.0, 0.45, 0.5], 'soil');
            for (const dx of [-2.2, 0, 2.2]) s.box([bcx + dx, y0 + 0.72, EDGE + 1.65], [1.1, 0.55, 0.45], 'planting', dx * 0.3);
          }
        }
        s.yawFrom(from, SIDE_ANGLE[side]);
      }
    },
  );
}

function skyGarden(zone: ZoneId, L: number): StepDef {
  const y = levelY(L);
  return step(
    {
      zone,
      member: `SKY GARDEN · ${lv(L)}–${lv(L + 1)}`,
      spec: 'double-height loggia · 3 trees in 600 mm beds · glass balustrade',
      code: 'SG-01',
      method: 'crane',
      drop: 2.0,
      level: L,
    },
    (s) => {
      s.box([10.55, y + 0.3, 10.55], [6.6, 0.6, 6.6], 'soil');
      s.tree(9.0, y + 0.6, 9.2, 5.2, 0.2);
      s.tree(12.1, y + 0.6, 12.0, 4.6, 0.6);
      s.tree(12.3, y + 0.6, 8.6, 3.8, 1.1);
      s.box([10.55, y + 0.55, EDGE], [7, 1.1, 0.03], 'glass');
      s.box([EDGE, y + 0.55, 10.55], [0.03, 1.1, 7], 'glass');
    },
  );
}

function skyTerrace(zone: ZoneId, L: number): StepDef {
  const y = levelY(L);
  return step(
    {
      zone,
      member: `SKY TERRACE · ${lv(L)}`,
      spec: 'communal terrace over the setback · 600 mm beds · 5 trees · glass balustrade',
      code: 'ST-02',
      method: 'crane',
      drop: 2.0,
      level: L,
    },
    (s) => {
      for (const x of [-9.5, 0, 9.5]) s.box([x, y + 0.3, 12.9], [7.6, 0.6, 1.6], 'soil');
      for (const [x, z, h] of [[-11.5, 12.8, 4.2], [-6.5, 12.9, 3.6], [2.2, 12.8, 4.6], [7.4, 12.9, 3.8], [11.8, 12.8, 4.4]]) s.tree(x, y + 0.6, z, h, x * 0.2);
      s.box([0, y + 0.55, EDGE], [28.3, 1.1, 0.03], 'glass');
      for (const x of [-EDGE, EDGE]) s.box([x, y + 0.55, (EDGE + SET_EDGE) / 2], [0.03, 1.1, EDGE - SET_EDGE], 'glass');
      for (let i = 0; i < 6; i++) s.box([-11 + i * 4.4, y + 0.22, 9.6], [2.4, 0.44, 0.6], 'glulam');
    },
  );
}

// ─── Podium ───────────────────────────────────────────────────────────────

function rcColumns(zone: ZoneId, L: number): StepDef {
  const y0 = levelY(L);
  const y1 = levelY(L + 1) - (L === 2 ? 0.8 : 0.3);
  return step(
    { zone, member: `${lv(L)} · RC COLUMNS`, spec: 'C50/60 · 600 × 600 mm · 24 no.', code: 'RC-01', method: 'cast', level: L, kind: 'frame' },
    (s) => {
      for (const [x, z] of gridPoints()) s.box([x, (y0 + y1) / 2, z], [0.6, y1 - y0, 0.6], 'concrete');
    },
  );
}

function rcSlab(zone: ZoneId, L: number, t: number, label: string, spec: string): StepDef {
  return step({ zone, member: `${lv(L)} · ${label}`, spec, code: 'RS-01', method: 'cast', level: L, kind: 'slab' }, (s) => plateAroundCore(s, levelY(L), t, 'concrete'));
}

function podiumFacade(zone: ZoneId, L: number): StepDef {
  const y0 = levelY(L);
  const h = levelY(L + 1) - y0;
  return step(
    { zone, member: `${lv(L)} · PODIUM FAÇADE`, spec: 'storey-height glazing · deep terracotta fins @ 1.75 m', code: 'FC-02', method: 'crane', drop: 1.6, level: L, kind: 'facade' },
    (s) => {
      for (let side = 0; side < 4; side++) {
        const from = s.parts.length;
        for (let m = 0; m < 16; m++) {
          s.box([-14 + 1.75 * (m + 0.5), y0 + 0.05 + (h - 0.5) / 2, EDGE], [1.69, h - 0.5, 0.06], 'glass');
          if (m > 0) s.box([-14 + 1.75 * m, y0 + h / 2, EDGE + 0.3], [0.14, h - 0.1, 0.6], 'terracotta');
        }
        s.box([0, y0 + h - 0.22, EDGE + 0.04], [28.3, 0.44, 0.08], 'aluminium');
        s.yawFrom(from, SIDE_ANGLE[side]);
      }
    },
  );
}

function podium(): StepDef[] {
  const Z: ZoneId = 'PODIUM';
  const out: StepDef[] = [];
  out.push(coreJump(Z, 0, 2));
  out.push(rcColumns(Z, 0));
  out.push(rcSlab(Z, 1, 0.3, 'PT FLAT SLAB', 'post-tensioned · 300 mm · C40/50'));
  out.push(rcColumns(Z, 1));
  out.push(rcSlab(Z, 2, 0.3, 'PT FLAT SLAB', 'post-tensioned · 300 mm · C40/50'));
  out.push(coreJump(Z, 2, 5));
  out.push(rcColumns(Z, 2));
  out.push(rcSlab(Z, 3, 0.8, 'TRANSFER DECK', 'RC transfer slab · 800 mm · timber starts here'));
  out.push(
    step(
      { zone: Z, member: 'L00 · LOBBY GLAZING & CANOPY', spec: '4.1 m structural glazing · CLT entrance canopy', code: 'FC-03', method: 'crane', drop: 1.6, level: 0, kind: 'facade' },
      (s) => {
        for (let side = 0; side < 4; side++) {
          const from = s.parts.length;
          for (let m = 0; m < 8; m++) s.box([-14 + 3.5 * (m + 0.5), 0.2 + 2.05, EDGE], [3.44, 4.1, 0.08], 'glass');
          s.yawFrom(from, SIDE_ANGLE[side]);
        }
        s.box([0, 4.35, EDGE + 2.0], [12, 0.25, 4.0], 'clt');
      },
    ),
  );
  out.push(podiumFacade(Z, 1));
  out.push(podiumFacade(Z, 2));
  return out;
}

// ─── Tower ────────────────────────────────────────────────────────────────

function tower(): StepDef[] {
  const out: StepDef[] = [];
  const zoneOf = (L: number): ZoneId => (L <= 12 ? 'LOWER' : L <= 22 ? 'MIDDLE' : 'UPPER');
  let coreTo = 5; // core has been poured up to this level in the podium
  for (let L = 3; L <= 31; L++) {
    const zone = zoneOf(L);
    while (coreTo < Math.min(L + 2, ROOF_LEVEL)) {
      const next = Math.min(coreTo + 3, ROOF_LEVEL);
      out.push(coreJump(zone, coreTo, next));
      coreTo = next;
    }
    out.push(frame(zone, L));
    out.push(pods(zone, L));
    out.push(cltSlab(zone, L + 1));
    const f = L - 2;
    if (f >= 3) {
      out.push(facade(zone, f));
      const garden = SKY_GARDENS.find((g) => g + 1 === f);
      if (garden) out.push(skyGarden(zone, garden));
      if (f === SETBACK_FROM) out.push(skyTerrace(zone, SETBACK_FROM));
    }
  }
  out.push(facade('UPPER', 30));
  out.push(facade('UPPER', 31));
  return out;
}

// ─── Crown & public realm ─────────────────────────────────────────────────

function crown(): StepDef[] {
  const Z: ZoneId = 'CROWN';
  const out: StepDef[] = [];
  out.push(coreJump(Z, ROOF_LEVEL, ROOF_LEVEL, ROOF + 4.5));
  out.push(
    step({ zone: Z, member: 'ROOF · GREEN ROOF BEDS', spec: 'biodiverse substrate · 450 mm beds · rainwater attenuation', code: 'GR-01', method: 'crane', drop: 1.6 }, (s) => {
      const y = ROOF + 0.25;
      s.box([0, y, -11.2], [26, 0.5, 4.6], 'soil');
      s.box([-11.2, y, -2.7], [4.6, 0.5, 12.4], 'soil');
      s.box([11.2, y, -2.7], [4.6, 0.5, 12.4], 'soil');
      s.box([0, y, 5.9], [12, 0.5, 1.8], 'soil');
      for (let i = 0; i < 10; i++) s.box([-11 + i * 2.45, y + 0.5, i % 2 ? -11.2 : -9.6], [1.4, 0.5, 1.4], 'planting', i);
    }),
  );
  // the BMU goes in before the PV canopy is built over its track
  out.push(
    step({ zone: Z, member: 'ROOF · BMU TRACK & GANTRY', spec: 'building maintenance unit · perimeter track · 14 m reach', code: 'BM-01', method: 'crane', drop: 2.0 }, (s) => {
      const y = ROOF + 0.65;
      s.box([0, y, -8.2], [17, 0.3, 0.3], 'steel');
      s.box([0, y, 5.6], [17, 0.3, 0.3], 'steel');
      s.box([-8.2, y, -1.3], [0.3, 0.3, 13.8], 'steel');
      s.box([8.2, y, -1.3], [0.3, 0.3, 13.8], 'steel');
      s.box([0, ROOF + 1.6, 5.6], [2.4, 1.6, 1.6], 'steel');
      s.beam([0, ROOF + 2.6, 5.6], [0, ROOF + 3.0, 11.8], 0.4, 0.4, 'steel');
    }),
  );
  out.push(
    step({ zone: Z, member: 'ROOF · GARDEN TREES', spec: '8 multi-stem trees · craned in with root balls', code: 'GR-02', method: 'crane', drop: 2.4 }, (s) => {
      for (const [x, z] of [[-11.5, -11.5], [11.5, -11.5], [11.5, 4.4], [-11.5, 4.4], [0, -11.8], [-11.8, -3.6], [11.8, -3.6], [5.6, 5.9]]) s.tree(x, ROOF + 0.5, z, 4.6, x * 0.1 + z * 0.07);
    }),
  );
  // the canopy clears the lift overrun (+4.5 m) and bears on its walls over the core
  const clear = 4.5;
  const pvY = ROOF + clear + 0.8; // top of the rafters
  out.push(
    step({ zone: Z, member: 'ROOF · PV CANOPY FRAME', spec: `glulam pergola · 300 × 300 mm posts · ${clear} m clear · bears on the core overrun`, code: 'PV-01', method: 'crane', drop: 2.0 }, (s) => {
      const g = [-10.5, -3.5, 3.5, 10.5];
      const gz = [-10.5, -3.5, 3.5];
      for (const x of g) for (const z of gz) if (!(Math.abs(x) < CORE && Math.abs(z) < CORE)) s.box([x, ROOF + clear / 2, z], [0.3, clear, 0.3], 'glulam');
      for (const z of gz) s.box([0, ROOF + clear + 0.2, z], [21.6, 0.4, 0.24], 'glulam');
      for (const x of g) s.box([x, ROOF + clear + 0.6, -3.5], [0.24, 0.4, 14.6], 'glulam');
    }),
  );
  out.push(
    step({ zone: Z, member: 'ROOF · PV ARRAY', spec: '32 glass-glass modules · 430 Wp · 10° tilt to south', code: 'PV-02', method: 'crane', drop: 1.6 }, (s) => {
      const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (10 * Math.PI) / 180);
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 4; j++) {
          s.parts.push({ pos: [-9.45 + 2.7 * i, pvY + 0.31, -9.4 + 3.6 * j], size: [2.5, 0.04, 3.3], quat: [tilt.x, tilt.y, tilt.z, tilt.w], mat: 'pv' }); // lower edge on the rafters
        }
      }
    }),
  );
  out.push(
    step({ zone: Z, member: 'CROWN · TERRACOTTA SCREEN', spec: '4.6 m baguettes @ 1.75 m · screens plant and the PV edge', code: 'FC-04', method: 'crane', drop: 1.6 }, (s) => {
      for (let side = 0; side < 4; side++) {
        const from = s.parts.length;
        const edge = side === 0 ? SET_EDGE : EDGE;
        for (let m = 1; m < 16; m++) {
          const x = -14 + 1.75 * m;
          if (side !== 0 && toWorld(x, edge, side)[1] > SET_EDGE + 0.01) continue;
          s.box([x, ROOF + 2.3, edge + 0.25], [0.14, 4.6, 0.5], 'terracotta');
        }
        for (let bay = 0; bay < 4; bay++) {
          const cx = -10.5 + 7 * bay;
          if (side !== 0 && toWorld(cx, edge, side)[1] > SET_EDGE) continue;
          s.box([cx, ROOF + 4.55, edge + 0.25], [7, 0.1, 0.5], 'aluminium');
        }
        s.yawFrom(from, SIDE_ANGLE[side]);
      }
    }),
  );
  out.push(
    step({ zone: Z, member: 'PUBLIC REALM · TREES & BENCHES', spec: '12 street trees · timber benches · permeable paving', code: 'PR-01', method: 'crane', drop: 2.0 }, (s) => {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + 0.26;
        const r = 21 + (i % 3) * 1.4;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (x < -18 && Math.abs(z) < 6) continue; // keep the crane pad clear
        s.tree(x, 0, z, 6 + (i % 4) * 0.6, a);
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        s.box([Math.cos(a) * 18, 0.22, Math.sin(a) * 18], [2.4, 0.44, 0.6], 'glulam', -a + Math.PI / 2);
      }
    }),
  );
  return out;
}

export function generateTower(): StepDef[] {
  return [...site(), ...podium(), ...tower(), ...crown()];
}

/** Neighbouring buildings, drawn as light context massing (not part of the build). */
export function contextMassing(): Part[] {
  const s = new Sink();
  const blocks: [number, number, number, number, number][] = [
    // x, z, width, depth, height
    [-50, -14, 22, 26, 26],
    [-50, 26, 20, 34, 18],
    [46, -30, 24, 26, 62],
    [48, 14, 18, 30, 30],
    [4, -56, 46, 16, 22],
    [-10, 56, 32, 18, 16],
    [40, 52, 18, 18, 38],
    [-48, -52, 22, 20, 44],
  ];
  for (const [x, z, w, d, h] of blocks) s.box([x, h / 2, z], [w, h, d], 'context');
  return s.parts;
}

export const LEVELS = [
  { code: 'GL', y: 0 },
  { code: 'L03', y: levelY(3) },
  { code: 'L13', y: levelY(13) },
  { code: 'L24', y: levelY(24) },
  { code: 'ROOF', y: ROOF },
  { code: 'TOP', y: ROOF + 4.6 },
];

/** Gross internal floor area used for carbon intensity, m² (L25–L31 lose the south bay). */
export const GIFA = STOREYS * ((2 * EDGE) ** 2 - (2 * CORE) ** 2) - (ROOF_LEVEL - SETBACK_FROM - 1) * (2 * EDGE) * (EDGE - SET_EDGE);
