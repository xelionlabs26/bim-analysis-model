/**
 * Deterministic sequence state. Everything the UI shows is a pure function of
 * time `t`, so seek / scrub / speed / rebuild never accumulate state.
 */
import { ZONES, type Project, type Step, type Vec3, type ZoneId } from '../data/types';
import { ACTIVE_HOLD } from '../data/project';
import { ROOF_LEVEL, levelY } from '../data/generator';
import { Presentation, type CameraPose, type CutState, type Shot, type WashState } from './presentation';

export type LogKind = 'STAGE' | 'ASM' | 'CHK' | 'PERF' | 'RUN' | 'CRANE' | 'MAT' | 'CUT' | 'CAM' | 'VIEW';

export interface Callout {
  key: string;
  member: string;
  spec: string;
  anchor: Vec3;
}

export interface PresentationState {
  kind: 'material' | 'section' | null;
  shot: Shot | null;
  wash: WashState;
  cut: CutState;
  pose: CameraPose | null;
}
export interface LogEvent {
  t: number;
  kind: LogKind;
  text: string;
}

export type StepStatus = 'ghost' | 'active' | 'placed';

export interface CraneState {
  visible: boolean;
  mastTop: number;
  slew: number; // radians, rotation of the jib about Y
  radius: number; // trolley position along the jib, m
  hookY: number; // world height of the hook block
  lifting: boolean;
  ties: number[]; // heights of tie collars in place
  headVisible: boolean; // false while the crane is being struck
}

export interface SequenceState {
  t: number;
  stage: number; // 1-based
  stepIndex: number; // -1 before the first step
  step: Step | null;
  stepStatus: string;
  stepsDone: number;
  partsPlaced: number;
  massPlacedKg: number;
  carbonPlacedKg: number;
  biogenicPlacedKg: number;
  zoneDone: Record<ZoneId, number>;
  zoneTotal: Record<ZoneId, number>;
  stageProgress: number[]; // 0..1 per stage (index 0 = stage 1)
  builtTop: number;
  builtHalf: number;
  complete: boolean;
  crane: CraneState;
  presentation: PresentationState;
  callouts: Callout[];
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-GB').replace(/,/g, ' ');
const MAST_START = 44;
const MAST_CLEAR = 14; // climb when the structure comes within this of the jib
const MAST_CLIMB = 16; // four 4 m sections per climb
const TIE_HEIGHTS = [30, 62, 94];
const SLEW_LEAD = 0.09;

interface Lift {
  step: Step;
  angle: number;
  radius: number;
}

export class Timeline {
  readonly events: LogEvent[];
  private readonly eventT: number[];
  private readonly stepT0: number[];
  private readonly cumParts: number[] = [];
  private readonly cumMass: number[] = [];
  private readonly cumCarbon: number[] = [];
  private readonly cumBio: number[] = [];
  private readonly cumTop: number[] = [];
  private readonly cumHalf: number[] = [];
  private readonly mastAfter: number[] = [];
  private readonly lifts: Lift[];
  private readonly liftT0: number[];
  readonly erectT: number;
  readonly presentation: Presentation;
  readonly zoneTotal: Record<ZoneId, number>;
  /** Per timber floor: the core's level when that floor's frame went up. */
  readonly coreLead: { level: number; coreLevel: number; required: number }[] = [];

  constructor(readonly project: Project) {
    const { steps, crane } = project;
    this.stepT0 = steps.map((s) => s.t0);
    let p = 0;
    let m = 0;
    let c = 0;
    let b = 0;
    let top = 0;
    let half = 0;
    let mast = MAST_START;
    let coreLevel = 0;
    for (const s of steps) {
      p += s.partCount;
      m += s.massKg;
      c += s.carbonKg;
      b += s.biogenicKg;
      top = Math.max(top, s.top);
      half = Math.max(half, s.halfExtent);
      while (top + MAST_CLEAR > mast) mast += MAST_CLIMB;
      this.cumParts.push(p);
      this.cumMass.push(m);
      this.cumCarbon.push(c);
      this.cumBio.push(b);
      this.cumTop.push(top);
      this.cumHalf.push(half);
      this.mastAfter.push(mast);
      if (s.kind === 'core' && s.level !== undefined) coreLevel = Math.max(coreLevel, s.level);
      if (s.kind === 'frame' && s.code === 'GL-01' && s.level !== undefined) {
        this.coreLead.push({ level: s.level, coreLevel, required: Math.min(s.level + 2, ROOF_LEVEL) });
      }
    }
    this.erectT = steps.find((s) => s.code === 'TC-02')?.t0 ?? 0;
    this.lifts = steps
      .filter((s) => s.method === 'crane' && s.partCount > 0)
      .map((s) => {
        const dx = s.centroid[0] - crane.base[0];
        const dz = s.centroid[2] - crane.base[2];
        return { step: s, angle: Math.atan2(-dz, dx), radius: Math.min(crane.jib - 1, Math.max(4, Math.hypot(dx, dz))) };
      });
    this.liftT0 = this.lifts.map((l) => l.step.t0);
    this.zoneTotal = Object.fromEntries(ZONES.map((z) => [z, steps.filter((s) => s.zone === z).length])) as Record<ZoneId, number>;
    this.presentation = new Presentation(project);
    this.events = this.buildEvents();
    this.eventT = this.events.map((e) => e.t);
  }

  private buildEvents(): LogEvent[] {
    const { project } = this;
    const ev: LogEvent[] = [];
    for (const st of project.stages.filter((s) => s.available)) {
      const head = st.subtitle.replace(/ · \d+ steps$/, '');
      ev.push({ t: st.start, kind: 'STAGE', text: `STAGE ${pad2(st.n)}/${pad2(project.stages.length)} · ${st.title} — ${head}` });
    }
    let lastMast = MAST_START;
    project.steps.forEach((s, i) => {
      if (s.log) ev.push({ t: s.t0, kind: 'CRANE', text: s.log });
      if (s.partCount > 0) {
        const lift = s.lift ? ` · TC-1 ${Math.round(s.lift.util * 100)} %` : '';
        ev.push({ t: s.t0, kind: 'ASM', text: `${s.method === 'cast' ? 'POUR' : 'ASM'} ${s.member} +${s.partCount} pcs · Σ ${fmtInt(this.cumParts[i])}${lift}` });
      }
      if (this.mastAfter[i] > lastMast && s.t0 >= this.erectT) {
        ev.push({ t: s.t1, kind: 'CRANE', text: `CLIMB TC-1 · mast → +${this.mastAfter[i].toFixed(0)} m · jib clears structure by ≥ ${MAST_CLEAR} m` });
      }
      lastMast = this.mastAfter[i];
    });
    for (const h of TIE_HEIGHTS) {
      const k = this.cumTop.findIndex((top) => top >= h + 3);
      if (k >= 0) ev.push({ t: project.steps[k].t1 + 0.01, kind: 'CRANE', text: `TIE TC-1 · collar at +${h} m into the core-side slab` });
    }
    for (const zone of ZONES) {
      const mine = project.steps.filter((s) => s.zone === zone);
      if (!mine.length) continue;
      const lastStep = mine[mine.length - 1];
      const pcs = mine.reduce((a, s) => a + s.partCount, 0);
      const mass = mine.reduce((a, s) => a + s.massKg, 0);
      const peak = Math.max(0, ...mine.map((s) => s.lift?.util ?? 0));
      const floors = this.coreLead.filter((c) => mine.some((s) => s.kind === 'frame' && s.code === 'GL-01' && s.level === c.level));
      const leadOk = floors.every((c) => c.coreLevel >= c.required);
      const minLead = floors.length ? Math.min(...floors.map((c) => c.coreLevel - c.level)) : null;
      const lead = minLead === null ? '' : ` · core lead ≥ ${minLead} floor${minLead === 1 ? '' : 's'} ${leadOk ? '✓' : '✗'}`;
      const lift = peak > 0 ? ` · peak lift ${Math.round(peak * 100)} % ${peak <= 1 ? '✓' : '✗'}` : '';
      ev.push({ t: lastStep.t1, kind: 'CHK', text: `CHK ${zone} · ${mine.length}/${mine.length} steps · ${fmtInt(pcs)} pcs · ${fmtMass(mass)}${lift}${lead}` });
    }
    for (const e of this.presentation.events) ev.push({ t: e.t, kind: e.kind, text: e.text });
    for (let t = 2; t < project.duration - 0.5; t += 2) ev.push({ t, kind: 'PERF', text: 'PERF' });
    ev.push({ t: project.duration - 0.05, kind: 'RUN', text: 'RUN sequence complete · loop → STEP 000' });
    return ev.sort((a, b) => a.t - b.t);
  }

  /** Index of the last element of `arr` that is <= t, or -1. */
  private static floorIndex(arr: number[], t: number): number {
    let lo = 0;
    let hi = arr.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  stepIndexAt(t: number): number {
    return Timeline.floorIndex(this.stepT0, t);
  }

  /** Events visible at time t (most recent last). */
  logAt(t: number, limit = 8): LogEvent[] {
    const i = Timeline.floorIndex(this.eventT, t);
    return this.events.slice(Math.max(0, i - limit + 1), i + 1);
  }

  craneAt(t: number, i: number): CraneState {
    let mastTop = i >= 0 ? this.mastAfter[i] : MAST_START;
    const parked = mastTop - 5;
    const builtTop = i >= 0 ? this.cumTop[i] : 0;
    let ties = TIE_HEIGHTS.filter((h) => builtTop >= h + 3);
    let visible = t >= this.erectT;
    // struck at the start of the material pass: head first, then the mast comes down
    const strike = (t - this.presentation.strikeT) / 0.8;
    if (strike >= 0) {
      if (strike >= 1) visible = false;
      mastTop *= 1 - strike;
      ties = ties.filter((h) => h < mastTop);
      return { visible, mastTop, slew: 0, radius: 22, hookY: mastTop, lifting: false, ties, headVisible: false };
    }
    const k = Timeline.floorIndex(this.liftT0, t + SLEW_LEAD);
    if (k < 0) return { visible, mastTop, slew: 0, radius: 22, hookY: parked, lifting: false, ties, headVisible: true };
    const cur = this.lifts[k];
    const prev = k > 0 ? this.lifts[k - 1] : { angle: 0, radius: 22 };
    const s = cur.step;
    const p = smoothstep(s.t0 - SLEW_LEAD, s.t0, t);
    let da = cur.angle - prev.angle;
    da = Math.atan2(Math.sin(da), Math.cos(da)); // shortest way round
    const slew = prev.angle + da * p;
    const radius = prev.radius + (cur.radius - prev.radius) * p;
    const target = s.top + 1.2;
    let hookY = parked;
    const lifting = t >= s.t0 && t <= s.t1;
    if (lifting) hookY = parked + (target - parked) * easeOut((t - s.t0) / Math.max(1e-3, s.t1 - s.t0));
    else if (t > s.t1) hookY = target + (parked - target) * smoothstep(s.t1, s.t1 + 0.18, t);
    return { visible, mastTop, slew, radius, hookY, lifting, ties, headVisible: true };
  }

  stateAt(tIn: number): SequenceState {
    const { project } = this;
    const t = Math.min(Math.max(tIn, 0), project.duration);
    const i = this.stepIndexAt(t);
    const step = i >= 0 ? project.steps[i] : null;
    const zoneDone = Object.fromEntries(ZONES.map((x) => [x, 0])) as Record<ZoneId, number>;
    for (let k = 0; k <= i; k++) zoneDone[project.steps[k].zone]++;
    const stage = project.stages.reduce((acc, s) => (t >= s.start && s.available ? s.n : acc), 1);
    const stageProgress = project.stages.map((s) => {
      if (s.kind !== 'assembly') return Math.min(1, Math.max(0, (t - s.start) / (s.end - s.start)));
      const n = project.steps.filter((x) => x.stage === s.n);
      if (!n.length) return 0;
      return n.filter((x) => x.index <= i).length / n.length;
    });
    const pr = this.presentation;
    const kind = t >= pr.section.start ? 'section' : t >= pr.material.start ? 'material' : null;
    const presentation: PresentationState = { kind, shot: pr.shotAt(t), wash: pr.washAt(t), cut: pr.cutAt(t), pose: pr.poseAt(t) };
    const callouts: Callout[] = kind
      ? pr.calloutsAt(t, 4).map((sh) => ({ key: sh.id, member: sh.title, spec: sh.spec, anchor: sh.anchor! }))
      : this.recentSteps(t, 4).map((st) => ({ key: `s${st.index}`, member: st.member, spec: st.spec, anchor: st.centroid }));
    let stepStatus = 'WAITING';
    if (step) {
      const busy = t < step.t1;
      stepStatus = step.method === 'cast' ? (busy ? 'POURING' : 'CAST ✓') : step.method === 'manual' ? (busy ? 'SETTING OUT' : 'DONE ✓') : busy ? 'LOWERING' : 'PLACED ✓';
    }
    return {
      t,
      stage,
      stepIndex: i,
      step,
      stepStatus,
      stepsDone: i + 1,
      partsPlaced: i >= 0 ? this.cumParts[i] : 0,
      massPlacedKg: i >= 0 ? this.cumMass[i] : 0,
      carbonPlacedKg: i >= 0 ? this.cumCarbon[i] : 0,
      biogenicPlacedKg: i >= 0 ? this.cumBio[i] : 0,
      zoneDone,
      zoneTotal: this.zoneTotal,
      stageProgress,
      builtTop: i >= 0 ? this.cumTop[i] : 0,
      builtHalf: i >= 0 ? this.cumHalf[i] : 17,
      complete: i === project.steps.length - 1 && t >= project.steps[i].t1,
      crane: this.craneAt(t, i),
      presentation,
      callouts,
    };
  }

  /** Steps that most recently started, newest first (for callouts). */
  recentSteps(t: number, n: number): Step[] {
    const out: Step[] = [];
    for (let k = this.stepIndexAt(t); k >= 0 && out.length < n; k--) if (this.project.steps[k].partCount > 0) out.push(this.project.steps[k]);
    return out;
  }

  statusOf(step: Step, t: number): StepStatus {
    if (t < step.t0) return 'ghost';
    return t < step.t1 + ACTIVE_HOLD ? 'active' : 'placed';
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function easeOut(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return 1 - Math.pow(1 - t, 3);
}

export function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function fmtMass(kg: number): string {
  if (kg < 1) return '—';
  if (kg < 1000) return `≈ ${Math.max(10, Math.round(kg / 10) * 10)} kg`;
  if (kg < 1e6) return `≈ ${(kg / 1000).toFixed(1)} t`;
  return `≈ ${(kg / 1e6).toFixed(2)} kt`;
}

export function fmtCarbon(kg: number): string {
  if (kg < 1) return '—';
  if (kg < 1000) return `≈ ${Math.round(kg)} kgCO₂e`;
  return `≈ ${fmtInt(kg / 1000)} tCO₂e`;
}

export { fmtInt, levelY };
