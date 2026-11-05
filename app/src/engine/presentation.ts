/**
 * Stages 07–08: the material pass and the section. Every value is a pure
 * function of time `t`, so the scrubber can land anywhere.
 *
 *   MATERIAL PASS  the crane is struck, then two washes rise up the building
 *                  with an uneven front: pass 1 structure, pass 2 envelope,
 *                  finishes and planting.
 *   SECTION        a cut plane slides in, the camera flies along the project's
 *                  keys, then the section closes before the loop.
 *
 * What is cut and where the camera goes come from `project.presentation`.
 */
import { MATERIAL_INFO, type CameraKey, type MaterialId, type Project, type StageDef, type Vec3 } from '../data/types';
import { partFootprint } from '../data/assemble';

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

export type CameraPose = Omit<CameraKey, 't'>;

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

const OFF = 1e4;

/** Which wash colours each material. Context massing stays as line work. */
export const PASS_OF: Record<MaterialId, 0 | 1 | 2> = {
  stringline: 1,
  concrete: 1,
  glulam: 1,
  clt: 1,
  timber: 1,
  masonry: 1,
  steel: 1,
  pod: 1,
  generic: 1,
  glass: 2,
  aluminium: 2,
  terracotta: 2,
  gypsum: 2,
  insulation: 2,
  membrane: 2,
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
/** Half-extent along a world axis of an oriented box. */
function halfExtentAlong(size: Vec3, q: [number, number, number, number], n: Vec3) {
  const [x, y, z, w] = q;
  // rows of the rotation matrix dotted with n give the box axes' components along n
  const ax: Vec3 = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
  const ay: Vec3 = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
  const az: Vec3 = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
  const d = (a: Vec3) => Math.abs(a[0] * n[0] + a[1] * n[1] + a[2] * n[2]);
  return 0.5 * (d(ax) * size[0] + d(ay) * size[1] + d(az) * size[2]);
}
const fmt = (n: number) => Math.round(n).toLocaleString('en-GB').replace(/,/g, ' ');

export class Presentation {
  readonly material: StageDef;
  readonly section: StageDef;
  readonly shots: Shot[];
  readonly events: PresentationEvent[];
  readonly cutParts: number;
  private readonly heights: [number[], number[]];
  private readonly keys: CameraKey[];
  private readonly windows: [[number, number], [number, number]];
  private readonly closeAt: number;
  readonly strikeT: number;
  readonly cutAtValue: number;
  readonly cutNormal: Vec3;
  readonly cutOpen: number;

  constructor(readonly project: Project) {
    this.material = project.stages.find((s) => s.kind === 'material')!;
    this.section = project.stages.find((s) => s.kind === 'section')!;
    const spec = project.presentation;
    const m = this.material;
    const md = m.end - m.start;
    this.windows = [
      [m.start + 0.15, m.start + md * 0.55],
      [m.start + md * 0.4, m.end - 0.25],
    ];
    this.strikeT = m.start + 0.05;
    this.cutAtValue = spec.cut.at;
    this.cutNormal = spec.cut.normal;
    this.cutOpen = spec.cut.open;
    this.closeAt = this.section.end - this.section.start - 1.2;
    const h1: number[] = [];
    const h2: number[] = [];
    for (const p of project.parts) {
      const pass = PASS_OF[p.mat];
      if (pass === 1) h1.push(p.pos[1]);
      else if (pass === 2) h2.push(p.pos[1]);
    }
    this.heights = [h1.sort((a, b) => a - b), h2.sort((a, b) => a - b)];
    const n = spec.cut.normal;
    this.cutParts = project.parts.filter((p) => Math.abs(p.pos[0] * n[0] + p.pos[1] * n[1] + p.pos[2] * n[2] - spec.cut.at) < halfExtentAlong(p.size, p.quat, n)).length;
    const dur = this.section.end - this.section.start;
    this.keys = spec.keys.length ? spec.keys : [{ t: 0, target: [0, project.height / 2, 0], az: 90, el: 8, dist: project.height * 3 + 40, fov: 26 }];
    const lastKey = this.keys[this.keys.length - 1];
    if (lastKey.t < dur) this.keys = [...this.keys, { ...lastKey, t: dur }];
    const stageStart = (s: 'material' | 'section') => (s === 'material' ? m.start : this.section.start);
    this.shots = spec.shots.map((s) => ({ id: s.id, t: stageStart(s.stage) + s.dt, stage: s.stage, title: s.title, spec: s.spec, anchor: s.anchor })).sort((a, b) => a.t - b.t);
    this.events = this.buildEvents();
  }

  private buildEvents(): PresentationEvent[] {
    const ev: PresentationEvent[] = [];
    const m = this.material;
    const s0 = this.section.start;
    const { crane } = this.project;
    ev.push({ t: this.strikeT, kind: 'CRANE', text: `STRIKE ${crane.id} · crane dismantled · mobile crane at street level` });
    const names = [1, 2].map((pass) => this.passTotals(pass as 1 | 2).materials.slice(0, 3).join(' · ') || '—');
    for (const pass of [0, 1] as const) {
      const [a, b] = this.windows[pass];
      ev.push({ t: a, kind: 'MAT', text: `MAT pass ${pass + 1}/2 · ${pass ? 'envelope & finishes' : 'structure'} · ${names[pass]}` });
      for (let t = a + 0.45; t < b; t += 0.45) {
        const w = this.washAt(t);
        ev.push({ t, kind: 'MAT', text: `MAT pass ${pass + 1}/2 · wash front +${Math.max(0, w.front[pass]).toFixed(1)} m · ${Math.round(w.pct[pass] * 100)} % of ${pass ? 'envelope' : 'structure'}` });
      }
    }
    const coloured = this.heights[0].length + this.heights[1].length;
    ev.push({ t: m.end - 0.1, kind: 'CHK', text: `CHK MATERIAL · 2/2 passes · ${fmt(coloured)} pcs coloured ✓` });
    const axis = this.cutNormal[0] ? 'X' : this.cutNormal[2] ? 'Z' : 'Y';
    ev.push({ t: s0 + 0.1, kind: 'CUT', text: `CUT plane A–A · normal +${axis} · offset ${this.cutOpen.toFixed(1)} → ${this.cutAtValue.toFixed(1)} m · ${fmt(this.cutParts)} parts in section · poché hatch` });
    for (const l of this.project.presentation.log) ev.push({ t: s0 + l.dt, kind: l.kind, text: l.text });
    ev.push({ t: s0 + this.closeAt, kind: 'CUT', text: `CUT closing section · plane → ${this.cutOpen.toFixed(1)} m` });
    return ev.sort((a, b) => a.t - b.t);
  }

  washAt(t: number): WashState {
    const H = this.project.height;
    const front: [number, number] = [OFF, OFF];
    const pct: [number, number] = [1, 1];
    let active: 0 | 1 | 2 = 0;
    for (const pass of [0, 1] as const) {
      const [a, b] = this.windows[pass];
      if (t < this.material.start || t < a) {
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
    const open = this.cutOpen;
    const at = this.cutAtValue;
    let d = open;
    if (t >= s0 + 0.1 && t < s0 + 0.9) d = lerp(open, at, smooth((t - s0 - 0.1) / 0.8));
    else if (t >= s0 + 0.9 && t < s0 + this.closeAt) d = at;
    else if (t >= s0 + this.closeAt && t < s0 + this.closeAt + 0.8) d = lerp(at, open, smooth((t - s0 - this.closeAt) / 0.8));
    return { on: d < open - 0.01, normal: this.cutNormal, d };
  }

  /** Camera pose for the section fly-through, or null outside it. */
  poseAt(t: number): CameraPose | null {
    if (t < this.section.start || t > this.section.end) return null;
    const r = t - this.section.start;
    const k = this.keys;
    let i = 0;
    while (i < k.length - 2 && r >= k[i + 1].t) i++;
    const a = k[i];
    const b = k[i + 1] ?? a;
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
      const fp = partFootprint(p, this.project.density);
      kg += fp.kg;
      co2 += fp.co2;
      pcs++;
      if (p.mat !== 'stringline') byMat.set(p.mat, (byMat.get(p.mat) ?? 0) + fp.kg);
    }
    const materials = [...byMat.entries()].sort((a, b) => b[1] - a[1]).map(([x]) => MATERIAL_INFO[x].label.split(' ·')[0]);
    return { pcs, kg, co2, materials };
  }
}
