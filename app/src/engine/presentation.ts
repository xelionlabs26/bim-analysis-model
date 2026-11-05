/**
 * Stages 07–08: the material pass and Section A–A. Like the assembly, every
 * value here is a pure function of time `t`, so the scrubber can land anywhere.
 *
 *   07 MATERIAL PASS  two washes rise up the tower with an uneven front:
 *                     pass 1 structure (timber, concrete), pass 2 envelope + planting.
 *                     The tower crane is struck at the start.
 *   08 SECTION A–A    a cut plane at x = 9.6 m slides through the east bay,
 *                     the camera flies to the sky gardens, the pods, the L24
 *                     terrace and the crown, then the section closes.
 */
import { MATERIAL_INFO, type MaterialId, type Project, type StageDef, type Vec3 } from '../data/types';
import { ROOF, levelY } from '../data/generator';

export interface WashState {
  front: [number, number]; // wash front height per pass (−1e4 = not started, 1e4 = done)
  active: 0 | 1 | 2;
  pct: [number, number]; // share of each pass's parts already coloured
}

export interface CutState {
  on: boolean;
  normal: Vec3;
  d: number; // keep points with dot(p, normal) < d
}

export interface CameraPose {
  target: Vec3;
  az: number; // degrees, from south (+Z) towards east (+X)
  el: number;
  dist: number;
  fov: number;
}

export interface Shot {
  id: string;
  t: number;
  stage: 'material' | 'section';
  title: string;
  spec: string;
  anchor: Vec3 | null;
}

export interface PresentationEvent {
  t: number;
  kind: 'MAT' | 'CUT' | 'CAM' | 'VIEW' | 'CRANE' | 'CHK';
  text: string;
}

export const CUT_NORMAL: Vec3 = [1, 0, 0];
export const CUT_OPEN = 40;
export const CUT_AT = 9.6;
const OFF = 1e4;

/** Which wash colours each material. Context massing stays as line work. */
export const PASS_OF: Record<MaterialId, 0 | 1 | 2> = {
  stringline: 1,
  concrete: 1,
  glulam: 1,
  clt: 1,
  steel: 1,
  pod: 1,
  glass: 2,
  aluminium: 2,
  terracotta: 2,
  soil: 2,
  planting: 2,
  pv: 2,
  context: 0,
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Half-extent along world X of an oriented box. */
function halfExtentX(size: Vec3, q: [number, number, number, number]) {
  const [x, y, z, w] = q;
  const r0 = 1 - 2 * (y * y + z * z);
  const r1 = 2 * (x * y - w * z);
  const r2 = 2 * (x * z + w * y);
  return 0.5 * (Math.abs(r0) * size[0] + Math.abs(r1) * size[1] + Math.abs(r2) * size[2]);
}
const fmt = (n: number) => Math.round(n).toLocaleString('en-GB').replace(/,/g, ' ');

interface Key extends CameraPose {
  t: number; // seconds after the section stage starts
}

export class Presentation {
  readonly material: StageDef;
  readonly section: StageDef;
  readonly shots: Shot[];
  readonly events: PresentationEvent[];
  readonly cutParts: number;
  private readonly heights: [number[], number[]];
  private readonly keys: Key[];
  private readonly windows: [[number, number], [number, number]];
  readonly strikeT: number;

  constructor(readonly project: Project) {
    this.material = project.stages.find((s) => s.kind === 'material')!;
    this.section = project.stages.find((s) => s.kind === 'section')!;
    const m = this.material;
    this.windows = [
      [m.start + 0.15, m.start + 2.2],
      [m.start + 1.6, m.end - 0.25],
    ];
    this.strikeT = m.start + 0.05;
    const h1: number[] = [];
    const h2: number[] = [];
    for (const p of project.parts) {
      const pass = PASS_OF[p.mat];
      if (pass === 1) h1.push(p.pos[1]);
      else if (pass === 2) h2.push(p.pos[1]);
    }
    this.heights = [h1.sort((a, b) => a - b), h2.sort((a, b) => a - b)];
    this.cutParts = project.parts.filter((p) => Math.abs(p.pos[0] - CUT_AT) < halfExtentX(p.size, p.quat)).length;

    const H = project.height;
    const mid = H * 0.5;
    this.keys = [
      { t: 0.0, target: [0, mid, 0], az: 90, el: 6, dist: 330, fov: 26 },
      { t: 0.9, target: [2, mid, 0], az: 90, el: 6, dist: 330, fov: 26 },
      { t: 1.9, target: [CUT_AT, levelY(12) + 3.3, 4], az: 98, el: 5, dist: 64, fov: 34 },
      { t: 2.8, target: [CUT_AT, levelY(14) + 1.5, 2], az: 92, el: 4, dist: 58, fov: 36 },
      { t: 3.8, target: [CUT_AT, levelY(24) + 2, 7], az: 104, el: 7, dist: 70, fov: 36 },
      { t: 4.7, target: [CUT_AT, ROOF + 2.5, 0], az: 114, el: 14, dist: 78, fov: 34 },
      { t: 5.6, target: [0, mid, 0], az: 124, el: 9, dist: 345, fov: 26 },
      { t: this.section.end - this.section.start, target: [0, mid, 0], az: 126, el: 9, dist: 345, fov: 26 },
    ];

    const storedT = Math.round(project.totalBiogenicKg / 1000);
    const s0 = this.section.start;
    this.shots = [
      { id: 'M-00', t: this.strikeT, stage: 'material', title: 'TC-1 · CRANE DISMANTLED', spec: 'sections lowered by a mobile crane at street level', anchor: null },
      { id: 'M-01', t: this.windows[0][0], stage: 'material', title: 'MATERIAL PASS 1/2 · STRUCTURE', spec: 'glulam · CLT · C40/50 concrete · natural finishes', anchor: [-14, levelY(8) + 1.6, 14] },
      { id: 'M-02', t: this.windows[1][0], stage: 'material', title: 'MATERIAL PASS 2/2 · ENVELOPE & PLANTING', spec: 'triple glazing · terracotta fins · bronze spandrels · planting', anchor: [0, levelY(18) + 1.6, 14.2] },
      { id: 'M-03', t: m.start + 2.9, stage: 'material', title: 'TIMBER · CARBON STORED', spec: `≈ ${fmt(storedT)} tCO₂e held in the glulam and CLT · indicative`, anchor: [-7, levelY(20) + 1.6, 14.2] },
      { id: 'S-01', t: s0 + 0.1, stage: 'section', title: 'SECTION A–A · CUT PLANE', spec: `x = ${CUT_AT} m through the east bay · cut faces hatched`, anchor: [CUT_AT, H * 0.66, -9] },
      { id: 'S-02', t: s0 + 0.95, stage: 'section', title: 'CAMERA · DOLLY IN TO L12', spec: '330 → 64 m · lens 52 → 39 mm', anchor: null },
      { id: 'S-03', t: s0 + 1.9, stage: 'section', title: 'SKY GARDEN · L12–L13 IN SECTION', spec: 'double-height loggia · trees in 600 mm beds · CLT slab cut', anchor: [CUT_AT, levelY(12) + 2.8, 9] },
      { id: 'S-04', t: s0 + 2.8, stage: 'section', title: 'BATHROOM PODS IN SECTION', spec: 'prefab pods sit on each CLT slab · 2.6 m high', anchor: [CUT_AT, levelY(14) + 1.3, 2.4] },
      { id: 'S-05', t: s0 + 3.8, stage: 'section', title: 'SKY TERRACE · L24 SETBACK', spec: 'floors above step back one bay · planted communal terrace', anchor: [CUT_AT, levelY(24) + 1.4, 11.5] },
      { id: 'S-06', t: s0 + 4.7, stage: 'section', title: 'CROWN · PV CANOPY & GREEN ROOF', spec: '32 PV modules on a glulam pergola · biodiverse roof', anchor: [CUT_AT, ROOF + 4.3, -3.5] },
      { id: 'S-07', t: s0 + 5.6, stage: 'section', title: 'SECTION A–A · CLOSING', spec: `plane → ${CUT_OPEN.toFixed(1)} m · the model closes back up`, anchor: null },
    ];
    this.events = this.buildEvents();
  }

  private buildEvents(): PresentationEvent[] {
    const ev: PresentationEvent[] = [];
    const m = this.material;
    const s0 = this.section.start;
    ev.push({ t: this.strikeT, kind: 'CRANE', text: 'STRIKE TC-1 · tower crane dismantled · mobile crane at street level' });
    const names = ['structure · glulam · CLT · concrete', 'envelope · glass · terracotta · planting'];
    for (const pass of [0, 1] as const) {
      const [a, b] = this.windows[pass];
      ev.push({ t: a, kind: 'MAT', text: `MAT pass ${pass + 1}/2 · ${names[pass]}` });
      for (let t = a + 0.45; t < b; t += 0.45) {
        const w = this.washAt(t);
        ev.push({ t, kind: 'MAT', text: `MAT pass ${pass + 1}/2 · wash front +${Math.max(0, w.front[pass]).toFixed(1)} m · ${Math.round(w.pct[pass] * 100)} % of ${pass ? 'envelope' : 'structure'}` });
      }
    }
    const coloured = this.heights[0].length + this.heights[1].length;
    ev.push({ t: m.end - 0.1, kind: 'CHK', text: `CHK MATERIAL · 2/2 passes · ${fmt(coloured)} pcs coloured ✓` });
    ev.push({ t: s0 + 0.1, kind: 'CUT', text: `CUT plane A–A · normal +X · offset ${CUT_OPEN.toFixed(1)} → ${CUT_AT} m · poché hatch` });
    ev.push({ t: s0 + 0.95, kind: 'CAM', text: 'CAM dolly in · 330 → 64 m · fov 26° → 34°' });
    ev.push({ t: s0 + 1.9, kind: 'VIEW', text: 'VIEW sky garden L12–L13 · double-height loggia in section' });
    ev.push({ t: s0 + 2.8, kind: 'VIEW', text: `VIEW bathroom pods cut at x = ${CUT_AT} m · ${fmt(this.cutParts)} parts in section` });
    ev.push({ t: s0 + 3.3, kind: 'CAM', text: `CAM crane up · target +${(levelY(14) + 1.5).toFixed(0)} → +${(levelY(24) + 2).toFixed(0)} m` });
    ev.push({ t: s0 + 3.8, kind: 'VIEW', text: 'VIEW L24 sky terrace · setback in section' });
    ev.push({ t: s0 + 4.7, kind: 'VIEW', text: 'VIEW crown · PV canopy and green roof' });
    ev.push({ t: s0 + 5.15, kind: 'CAM', text: 'CAM pull back · 78 → 345 m · fov 34° → 26°' });
    ev.push({ t: s0 + 5.6, kind: 'CUT', text: `CUT closing section · plane → ${CUT_OPEN.toFixed(1)} m` });
    return ev.sort((a, b) => a.t - b.t);
  }

  washAt(t: number): WashState {
    const H = this.project.height;
    const front: [number, number] = [OFF, OFF];
    const pct: [number, number] = [1, 1];
    let active: 0 | 1 | 2 = 0;
    for (const pass of [0, 1] as const) {
      const [a, b] = this.windows[pass];
      if (t < this.material.start) {
        front[pass] = -OFF;
        pct[pass] = 0;
      } else if (t < a) {
        front[pass] = -OFF;
        pct[pass] = 0;
      } else if (t <= b) {
        front[pass] = lerp(-6, H + 8, smooth((t - a) / (b - a)));
        pct[pass] = this.shareBelow(pass, front[pass]);
        active = (pass + 1) as 1 | 2;
      }
    }
    return { front, active, pct };
  }

  private shareBelow(pass: 0 | 1, y: number): number {
    const arr = this.heights[pass];
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < y) lo = mid + 1;
      else hi = mid;
    }
    return arr.length ? lo / arr.length : 1;
  }

  cutAt(t: number): CutState {
    const s0 = this.section.start;
    let d = CUT_OPEN;
    if (t >= s0 + 0.1 && t < s0 + 0.9) d = lerp(CUT_OPEN, CUT_AT, smooth((t - s0 - 0.1) / 0.8));
    else if (t >= s0 + 0.9 && t < s0 + 5.6) d = CUT_AT;
    else if (t >= s0 + 5.6 && t < s0 + 6.4) d = lerp(CUT_AT, CUT_OPEN, smooth((t - s0 - 5.6) / 0.8));
    return { on: d < CUT_OPEN - 0.01, normal: CUT_NORMAL, d };
  }

  /** Camera pose for the section fly-through, or null outside it. */
  poseAt(t: number): CameraPose | null {
    if (t < this.section.start || t > this.section.end) return null;
    const r = t - this.section.start;
    const k = this.keys;
    let i = 0;
    while (i < k.length - 2 && r >= k[i + 1].t) i++;
    const a = k[i];
    const b = k[i + 1];
    const e = smooth((r - a.t) / Math.max(1e-3, b.t - a.t));
    return {
      target: [lerp(a.target[0], b.target[0], e), lerp(a.target[1], b.target[1], e), lerp(a.target[2], b.target[2], e)],
      az: lerp(a.az, b.az, e),
      el: lerp(a.el, b.el, e),
      dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), e)), // even dolly speed in and out
      fov: lerp(a.fov, b.fov, e),
    };
  }

  /** Latest shot at time t within stages 07–08, or null. */
  shotAt(t: number): Shot | null {
    if (t < this.material.start || t > this.section.end) return null;
    let cur: Shot | null = null;
    for (const s of this.shots) if (s.t <= t) cur = s;
    return cur;
  }

  /** Shots with a callout anchor, newest first, in the current presentation stage. */
  calloutsAt(t: number, n: number): Shot[] {
    const stage = t >= this.section.start ? 'section' : t >= this.material.start ? 'material' : null;
    if (!stage) return [];
    return this.shots.filter((s) => s.stage === stage && s.anchor && s.t <= t).reverse().slice(0, n);
  }

  /** Mass and carbon of the parts a pass colours (for the operation card). */
  passTotals(pass: 1 | 2): { pcs: number; kg: number; co2: number; materials: string[] } {
    let kg = 0;
    let co2 = 0;
    let pcs = 0;
    const byMat = new Map<MaterialId, number>();
    for (const p of this.project.parts) {
      if (PASS_OF[p.mat] !== pass) continue;
      const m = p.size[0] * p.size[1] * p.size[2] * MATERIAL_INFO[p.mat].density;
      kg += m;
      co2 += m * MATERIAL_INFO[p.mat].carbon;
      pcs++;
      if (p.mat !== 'stringline') byMat.set(p.mat, (byMat.get(p.mat) ?? 0) + m);
    }
    const materials = [...byMat.entries()].sort((a, b) => b[1] - a[1]).map(([x]) => MATERIAL_INFO[x].label.split(' ·')[0]);
    return { pcs, kg, co2, materials };
  }
}
