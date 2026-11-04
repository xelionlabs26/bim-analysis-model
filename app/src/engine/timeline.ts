/**
 * Deterministic sequence state. Everything the UI shows is a pure function of
 * time `t`, so seek / scrub / speed / rebuild never accumulate state.
 */
import { TIERS, type Project, type Step, type TierId } from '../data/types';
import { ACTIVE_HOLD } from '../data/project';

export type LogKind = 'STAGE' | 'ASM' | 'CHK' | 'PERF' | 'RUN';
export interface LogEvent {
  t: number;
  kind: LogKind;
  text: string;
}

export type StepStatus = 'ghost' | 'active' | 'placed';

export interface SequenceState {
  t: number;
  stage: number; // 1-based
  stepIndex: number; // -1 before the first step
  step: Step | null;
  stepStatus: 'LOWERING' | 'PLACED ✓' | 'WAITING';
  stepsDone: number;
  partsPlaced: number;
  massPlacedKg: number;
  tierDone: Record<TierId, number>;
  tierTotal: Record<TierId, number>;
  stageProgress: number[]; // 0..1 per stage (index 0 = stage 1)
  builtTop: number;
  builtHalf: number;
  complete: boolean;
}

const fmtInt = (n: number) => n.toLocaleString('en-GB').replace(/,/g, ' ');

export class Timeline {
  readonly events: LogEvent[];
  private readonly stepT0: number[];
  private readonly cumParts: number[];
  private readonly cumMass: number[];
  private readonly cumTop: number[];
  private readonly cumHalf: number[];
  readonly tierTotal: Record<TierId, number>;

  constructor(readonly project: Project) {
    const { steps } = project;
    this.stepT0 = steps.map((s) => s.t0);
    this.cumParts = [];
    this.cumMass = [];
    this.cumTop = [];
    this.cumHalf = [];
    let p = 0;
    let m = 0;
    let top = 0;
    let half = 0;
    for (const s of steps) {
      p += s.partCount;
      m += s.massKg;
      top = Math.max(top, s.top);
      half = Math.max(half, s.halfExtent);
      this.cumParts.push(p);
      this.cumMass.push(m);
      this.cumTop.push(top);
      this.cumHalf.push(half);
    }
    this.tierTotal = Object.fromEntries(TIERS.map((t) => [t, steps.filter((s) => s.tier === t).length])) as Record<TierId, number>;
    this.events = this.buildEvents();
  }

  private buildEvents(): LogEvent[] {
    const { project } = this;
    const ev: LogEvent[] = [];
    for (const st of project.stages.filter((s) => s.available)) {
      const head = st.subtitle.replace(/ · \d+ steps$/, '');
      ev.push({ t: st.start, kind: 'STAGE', text: `STAGE ${pad2(st.n)}/${pad2(project.stages.length)} · ${st.title} — ${head}` });
    }
    project.steps.forEach((s, i) => {
      if (s.partCount === 0) return;
      ev.push({ t: s.t0, kind: 'ASM', text: `ASM ${s.member} +${s.partCount} pcs · Σ ${fmtInt(this.cumParts[i])}` });
    });
    // Tier completion check: counts actually derived from the data, not authored text.
    for (const tier of TIERS) {
      const mine = project.steps.filter((s) => s.tier === tier);
      if (!mine.length) continue;
      const lastStep = mine[mine.length - 1];
      const pcs = mine.reduce((a, s) => a + s.partCount, 0);
      const mass = mine.reduce((a, s) => a + s.massKg, 0);
      ev.push({ t: lastStep.t1, kind: 'CHK', text: `CHK ${tier} · ${mine.length}/${mine.length} steps · ${fmtInt(pcs)} pcs · ${fmtMass(mass)} placed` });
    }
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
    const times = this.events.map((e) => e.t);
    const i = Timeline.floorIndex(times, t);
    return this.events.slice(Math.max(0, i - limit + 1), i + 1);
  }

  stateAt(tIn: number): SequenceState {
    const { project } = this;
    const t = Math.min(Math.max(tIn, 0), project.duration);
    const i = this.stepIndexAt(t);
    const step = i >= 0 ? project.steps[i] : null;
    const tierDone = Object.fromEntries(TIERS.map((x) => [x, 0])) as Record<TierId, number>;
    for (let k = 0; k <= i; k++) tierDone[project.steps[k].tier]++;
    const stage = project.stages.reduce((acc, s) => (t >= s.start && s.available ? s.n : acc), 1);
    const stageProgress = project.stages.map((s) => {
      const n = project.steps.filter((x) => x.stage === s.n);
      if (!n.length) return 0;
      return n.filter((x) => x.index <= i).length / n.length;
    });
    return {
      t,
      stage,
      stepIndex: i,
      step,
      stepStatus: !step ? 'WAITING' : t < step.t1 ? 'LOWERING' : 'PLACED ✓',
      stepsDone: i + 1,
      partsPlaced: i >= 0 ? this.cumParts[i] : 0,
      massPlacedKg: i >= 0 ? this.cumMass[i] : 0,
      tierDone,
      tierTotal: this.tierTotal,
      stageProgress,
      builtTop: i >= 0 ? this.cumTop[i] : 0,
      builtHalf: i >= 0 ? this.cumHalf[i] : 7.5,
      complete: i === project.steps.length - 1 && t >= project.steps[i].t1,
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

export function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function fmtMass(kg: number): string {
  if (kg < 1) return '—';
  if (kg < 1000) return `≈ ${Math.max(10, Math.round(kg / 10) * 10)} kg`;
  return `≈ ${(kg / 1000).toFixed(1)} t`;
}

export { fmtInt };
