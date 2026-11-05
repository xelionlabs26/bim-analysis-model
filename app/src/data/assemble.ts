/**
 * Generic scheduler: ordered install steps + stage table → a Project with
 * timing, mass, indicative carbon and crane lift checks. Used by both the
 * generated tower and imported IFC models.
 */
import { Quaternion, Vector3 } from 'three';
import {
  MATERIAL_INFO,
  TIMBER_BIOGENIC,
  type Crane,
  type Level,
  type LiftCheck,
  type MaterialId,
  type MeshData,
  type Part,
  type PresentationSpec,
  type Project,
  type ProjectMeta,
  type ScheduledPart,
  type StageDef,
  type StageKind,
  type Step,
  type StepDef,
  type ZoneDef,
  type ZoneId,
} from './types';

export const PART_ANIM = 0.2; // seconds for one part to settle
export const ACTIVE_HOLD = 0.25; // seconds a placed part stays "active"
const MIN_STAGE = 1.6;
const END_HOLD = 0.4;

export interface StageConfig {
  code: string;
  tick: string;
  title: string;
  zones: ZoneId[];
  kind: StageKind;
  sheet: string;
  seconds?: number;
  subtitle: (steps: number) => string;
}

export interface AssembleInput {
  id: string;
  name: string;
  subtitle: string;
  rev: string;
  revDate: string;
  storeys: number;
  gifa: number;
  levels: Level[];
  zones: ZoneDef[];
  stages: StageConfig[];
  defs: StepDef[];
  meshes?: MeshData[];
  context?: Part[];
  contextMeshes?: MeshData[];
  crane: Crane;
  density?: Partial<Record<MaterialId, number>>;
  secondsPerStep: number;
  meta: ProjectMeta;
  presentation: (project: Omit<Project, 'presentation'>) => PresentationSpec;
  report?: Record<string, unknown>;
}

const tmpV = new Vector3();
const tmpQ = new Quaternion();

/** Highest point, lowest point and max horizontal extent of a part. */
export function extent(p: Part) {
  let top = -Infinity;
  let bottom = Infinity;
  let half = 0;
  tmpQ.set(...p.quat);
  for (let i = 0; i < 8; i++) {
    tmpV.set(((i & 1) - 0.5) * p.size[0], (((i >> 1) & 1) - 0.5) * p.size[1], (((i >> 2) & 1) - 0.5) * p.size[2]).applyQuaternion(tmpQ);
    top = Math.max(top, p.pos[1] + tmpV.y);
    bottom = Math.min(bottom, p.pos[1] + tmpV.y);
    half = Math.max(half, Math.abs(p.pos[0] + tmpV.x), Math.abs(p.pos[2] + tmpV.z));
  }
  return { top, bottom, half };
}

export const densityOf = (mat: MaterialId, density?: Partial<Record<MaterialId, number>>) => density?.[mat] ?? MATERIAL_INFO[mat].density;

/** Mass, A1–A3 carbon and stored biogenic carbon of one part. */
export function partFootprint(p: Part, density?: Partial<Record<MaterialId, number>>) {
  const vol = p.volume ?? p.size[0] * p.size[1] * p.size[2];
  const mix = p.mix && p.mix.length ? p.mix : ([[p.mat, 1]] as [MaterialId, number][]);
  let kg = 0;
  let co2 = 0;
  let bio = 0;
  for (const [m, share] of mix) {
    const k = vol * share * densityOf(m, density);
    kg += k;
    co2 += k * MATERIAL_INFO[m].carbon;
    if (MATERIAL_INFO[m].biogenic) bio += k * TIMBER_BIOGENIC;
  }
  return { kg, co2, bio };
}

export const partMassKg = (p: Part, density?: Partial<Record<MaterialId, number>>) => partFootprint(p, density).kg;

/** Critical crane pick in a step: the piece with the highest share of chart capacity. */
function liftCheck(parts: Part[], crane: Crane, density?: Partial<Record<MaterialId, number>>): LiftCheck | null {
  let worst: LiftCheck | null = null;
  for (const p of parts) {
    if (MATERIAL_INFO[p.mat].bulk) continue;
    const r = Math.hypot(p.pos[0] - crane.base[0], p.pos[2] - crane.base[2]);
    const kg = partMassKg(p, density);
    const cap = r > crane.jib ? 0 : crane.capacityAt(r);
    const util = cap > 0 ? kg / cap : Infinity;
    if (!worst || util > worst.util) worst = { radius: r, pieceKg: kg, capacityKg: cap, util, at: [p.pos[0], p.pos[1], p.pos[2]] };
  }
  return worst;
}

export function assembleProject(input: AssembleInput): Project {
  const { defs, crane, density } = input;
  const steps: Step[] = [];
  const parts: ScheduledPart[] = [];
  const stages: StageDef[] = [];

  let clock = 0;
  input.stages.forEach((sd, si) => {
    const n = si + 1;
    const mine = defs.filter((d) => sd.zones.includes(d.zone));
    const dur = sd.seconds ?? Math.max(MIN_STAGE, mine.length * input.secondsPerStep);
    const stage: StageDef = { n, kind: sd.kind, code: sd.code, tick: sd.tick, title: sd.title, subtitle: sd.subtitle(mine.length), start: clock, end: clock + dur, sheet: sd.sheet, available: true, zones: sd.zones };
    stages.push(stage);
    clock += dur;
    if (sd.kind !== 'assembly' || !mine.length) return;
    const interval = (dur - 0.3) / mine.length;
    mine.forEach((def, i) => {
      const t0 = stage.start + 0.05 + i * interval;
      const spread = Math.min(interval * 1.6, 0.45);
      const partStart = parts.length;
      let mass = 0;
      let carbon = 0;
      let biogenic = 0;
      let top = -Infinity;
      let bottom = Infinity;
      let half = 0;
      const c = [0, 0, 0];
      const matMass = new Map<MaterialId, number>();
      def.parts.forEach((p, j) => {
        const pt0 = t0 + (def.parts.length > 1 ? (spread * j) / (def.parts.length - 1) : 0);
        parts.push({ ...p, t0: pt0, dur: PART_ANIM, drop: def.drop, motion: def.motion, stage: n, step: steps.length });
        const fp = partFootprint(p, density);
        mass += fp.kg;
        carbon += fp.co2;
        biogenic += fp.bio;
        matMass.set(p.mat, (matMass.get(p.mat) ?? 0) + fp.kg);
        const e = extent(p);
        top = Math.max(top, e.top);
        bottom = Math.min(bottom, e.bottom);
        half = Math.max(half, e.half);
        c[0] += p.pos[0];
        c[1] += p.pos[1];
        c[2] += p.pos[2];
      });
      const cnt = Math.max(1, def.parts.length);
      const dominant = [...matMass.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const { parts: _omit, ...rest } = def;
      steps.push({
        ...rest,
        index: steps.length,
        id: String(steps.length + 1).padStart(3, '0'),
        stage: n,
        t0,
        t1: (def.parts.length ? parts[parts.length - 1].t0 : t0) + PART_ANIM,
        partStart,
        partCount: def.parts.length,
        material: dominant ? MATERIAL_INFO[dominant].label : def.method === 'manual' ? 'site team' : '—',
        massKg: mass,
        carbonKg: carbon,
        biogenicKg: biogenic,
        centroid: def.parts.length ? [c[0] / cnt, c[1] / cnt, c[2] / cnt] : [...crane.base],
        top: Number.isFinite(top) ? top : 0,
        bottom: Number.isFinite(bottom) ? bottom : 0,
        halfExtent: half,
        lift: def.method === 'crane' && def.parts.length ? liftCheck(def.parts, crane, density) : null,
      });
    });
  });

  const last = steps[steps.length - 1];
  const height = Math.max(0, ...steps.map((s) => s.top));
  const base: Omit<Project, 'presentation'> = {
    id: input.id,
    name: input.name,
    subtitle: input.subtitle,
    rev: input.rev,
    revDate: input.revDate,
    storeys: input.storeys,
    gifa: input.gifa,
    height,
    levels: input.levels.map((l) => (l.code === 'TOP' ? { ...l, y: height } : l)),
    zones: input.zones,
    stages,
    steps,
    parts,
    meshes: input.meshes ?? [],
    context: input.context ?? [],
    contextMeshes: input.contextMeshes ?? [],
    crane,
    duration: Math.max(last?.t1 ?? 0, stages[stages.length - 1].end) + END_HOLD,
    totalMassKg: steps.reduce((a, s) => a + s.massKg, 0),
    totalCarbonKg: steps.reduce((a, s) => a + s.carbonKg, 0),
    totalBiogenicKg: steps.reduce((a, s) => a + s.biogenicKg, 0),
    density,
    meta: input.meta,
    report: input.report,
  };
  return { ...base, presentation: input.presentation(base) };
}
