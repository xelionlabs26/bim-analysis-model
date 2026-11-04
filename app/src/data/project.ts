import { Quaternion, Vector3 } from 'three';
import { CRANE, GIFA, LEVELS, STOREYS, contextMassing, generateTower } from './generator';
import {
  MATERIAL_INFO,
  TIMBER_BIOGENIC,
  type LiftCheck,
  type MaterialId,
  type Part,
  type Project,
  type ScheduledPart,
  type StageDef,
  type Step,
  type ZoneId,
} from './types';

/** Stage table. Assembly windows are sized from their step counts; 07–08 are M5. */
const STAGES: { code: string; tick: string; title: string; zones: ZoneId[]; available: boolean; sheet: string; m5Duration?: number }[] = [
  { code: 'SITE', tick: 'SITE', title: 'GROUNDWORKS', zones: ['SITE'], available: true, sheet: 'A-201' },
  { code: 'PODIUM', tick: 'PODIUM', title: 'PODIUM & CORE', zones: ['PODIUM'], available: true, sheet: 'A-202' },
  { code: 'LOWER', tick: 'L03', title: 'LOWER TOWER', zones: ['LOWER'], available: true, sheet: 'A-203' },
  { code: 'MIDDLE', tick: 'L13', title: 'MID TOWER', zones: ['MIDDLE'], available: true, sheet: 'A-204' },
  { code: 'UPPER', tick: 'L23', title: 'UPPER TOWER', zones: ['UPPER'], available: true, sheet: 'A-205' },
  { code: 'CROWN', tick: 'CROWN', title: 'CROWN & GARDENS', zones: ['CROWN'], available: true, sheet: 'A-206' },
  { code: 'MATERIAL', tick: 'MAT', title: 'MATERIAL PASS', zones: [], available: false, sheet: 'A-207', m5Duration: 4 },
  { code: 'SECTION', tick: 'SECT', title: 'SECTION A–A', zones: [], available: false, sheet: 'A-208', m5Duration: 6 },
];

const SUBTITLES: Record<string, (n: number) => string> = {
  SITE: (n) => `piles · raft · crane · ${n} steps`,
  PODIUM: (n) => `RC frame · transfer deck · ${n} steps`,
  LOWER: (n) => `L03–L12 · sky garden · ${n} steps`,
  MIDDLE: (n) => `L13–L22 · sky garden · ${n} steps`,
  UPPER: (n) => `L23–L31 · roof deck · ${n} steps`,
  CROWN: (n) => `PV canopy · trees · ${n} steps`,
  MATERIAL: () => 'timber · glass · planting · M5',
  SECTION: () => 'cut through a sky garden · M5',
};

export const PART_ANIM = 0.2; // seconds for one part to settle
export const ACTIVE_HOLD = 0.25; // seconds a placed part stays "active"
const SECONDS_PER_STEP = 0.105;
const MIN_STAGE = 1.6;
const END_HOLD = 1.0;

const tmpV = new Vector3();
const tmpQ = new Quaternion();

/** Highest point / max horizontal extent of an oriented box. */
function extent(p: Part) {
  let top = -Infinity;
  let half = 0;
  tmpQ.set(...p.quat);
  for (let i = 0; i < 8; i++) {
    tmpV.set(((i & 1) - 0.5) * p.size[0], (((i >> 1) & 1) - 0.5) * p.size[1], (((i >> 2) & 1) - 0.5) * p.size[2]).applyQuaternion(tmpQ);
    top = Math.max(top, p.pos[1] + tmpV.y);
    half = Math.max(half, Math.abs(p.pos[0] + tmpV.x), Math.abs(p.pos[2] + tmpV.z));
  }
  return { top, half };
}

export const partMassKg = (p: Part) => p.size[0] * p.size[1] * p.size[2] * MATERIAL_INFO[p.mat].density;

/** Critical crane pick in a step: the piece with the highest share of chart capacity. */
function liftCheck(parts: Part[]): LiftCheck | null {
  let worst: LiftCheck | null = null;
  for (const p of parts) {
    if (MATERIAL_INFO[p.mat].bulk) continue;
    const r = Math.hypot(p.pos[0] - CRANE.base[0], p.pos[2] - CRANE.base[2]);
    const kg = partMassKg(p);
    const cap = r > CRANE.jib ? 0 : CRANE.capacityAt(r);
    const util = cap > 0 ? kg / cap : Infinity;
    if (!worst || util > worst.util) worst = { radius: r, pieceKg: kg, capacityKg: cap, util };
  }
  return worst;
}

export function buildProject(): Project {
  const defs = generateTower();
  const steps: Step[] = [];
  const parts: ScheduledPart[] = [];
  const stages: StageDef[] = [];

  let clock = 0;
  STAGES.forEach((sd, si) => {
    const n = si + 1;
    const mine = defs.filter((d) => sd.zones.includes(d.zone));
    const dur = sd.available ? Math.max(MIN_STAGE, mine.length * SECONDS_PER_STEP) : sd.m5Duration ?? 4;
    const stage: StageDef = {
      n,
      code: sd.code,
      tick: sd.tick,
      title: sd.title,
      subtitle: SUBTITLES[sd.code](mine.length),
      start: clock,
      end: clock + dur,
      sheet: sd.sheet,
      available: sd.available,
      zones: sd.zones,
    };
    stages.push(stage);
    clock += dur;
    if (!sd.available || !mine.length) return;
    const interval = (dur - 0.3) / mine.length;
    mine.forEach((def, i) => {
      const t0 = stage.start + 0.05 + i * interval;
      const spread = Math.min(interval * 1.6, 0.45);
      const partStart = parts.length;
      let mass = 0;
      let carbon = 0;
      let biogenic = 0;
      let top = 0;
      let half = 0;
      const c = [0, 0, 0];
      const matMass = new Map<MaterialId, number>();
      def.parts.forEach((p, j) => {
        const pt0 = t0 + (def.parts.length > 1 ? (spread * j) / (def.parts.length - 1) : 0);
        parts.push({ ...p, t0: pt0, dur: PART_ANIM, drop: def.drop, motion: def.motion, stage: n, step: steps.length });
        const kg = partMassKg(p);
        const info = MATERIAL_INFO[p.mat];
        mass += kg;
        carbon += kg * info.carbon;
        if (info.biogenic) biogenic += kg * TIMBER_BIOGENIC;
        matMass.set(p.mat, (matMass.get(p.mat) ?? 0) + kg);
        const e = extent(p);
        top = Math.max(top, e.top);
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
        centroid: def.parts.length ? [c[0] / cnt, c[1] / cnt, c[2] / cnt] : [...CRANE.base],
        top,
        halfExtent: half,
        lift: def.method === 'crane' ? liftCheck(def.parts) : null,
      });
    });
  });

  const assembly = stages.filter((s) => s.available);
  const last = steps[steps.length - 1];
  const height = Math.max(...steps.map((s) => s.top));
  return {
    id: 'AR-32',
    name: 'Arbor House',
    subtitle: '32-storey hybrid timber residential tower · built in install order',
    rev: 'C',
    revDate: '11/26',
    storeys: STOREYS,
    gifa: GIFA,
    height,
    levels: LEVELS.map((l) => (l.code === 'TOP' ? { ...l, y: height } : l)),
    stages,
    steps,
    parts,
    context: contextMassing(),
    crane: CRANE,
    duration: Math.max(last.t1, assembly[assembly.length - 1].end) + END_HOLD,
    totalMassKg: steps.reduce((a, s) => a + s.massKg, 0),
    totalCarbonKg: steps.reduce((a, s) => a + s.carbonKg, 0),
    totalBiogenicKg: steps.reduce((a, s) => a + s.biogenicKg, 0),
  };
}
