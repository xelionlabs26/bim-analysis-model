import { Quaternion, Vector3 } from 'three';
import { generatePagoda, LEVELS } from './generator';
import { MATERIAL_INFO, type MaterialId, type Project, type ScheduledPart, type StageDef, type Step, type StepDef, type TierId } from './types';

/** Stage table. Start times follow the reference recording; 07–08 are M5. */
const STAGES: Omit<StageDef, 'subtitle'>[] = [
  { n: 1, code: 'PLINTH', title: 'PLINTH & SITE', start: 0.0, end: 2.8, sheet: 'A-101', available: true, tiers: ['PLINTH'] },
  { n: 2, code: 'TIER1', title: 'TIER 1 · MOKOSHI', start: 2.8, end: 6.0, sheet: 'A-102', available: true, tiers: ['TIER 1'] },
  { n: 3, code: 'TIER2', title: 'TIER 2', start: 6.0, end: 8.1, sheet: 'A-103', available: true, tiers: ['TIER 2'] },
  { n: 4, code: 'TIER3', title: 'TIER 3', start: 8.1, end: 9.9, sheet: 'A-104', available: true, tiers: ['TIER 3'] },
  { n: 5, code: 'TIER4', title: 'TIER 4', start: 9.9, end: 11.7, sheet: 'A-105', available: true, tiers: ['TIER 4'] },
  { n: 6, code: 'TIER5', title: 'TIER 5 · SPIRE', start: 11.7, end: 14.2, sheet: 'A-106', available: true, tiers: ['TIER 5', 'SPIRE'] },
  { n: 7, code: 'PAINT', title: 'LACQUER & TILE', start: 14.2, end: 18.2, sheet: 'A-107', available: false, tiers: [] },
  { n: 8, code: 'SECTION', title: 'SECTION A–A', start: 18.2, end: 25.0, sheet: 'A-108', available: false, tiers: [] },
];

const SUBTITLES: Record<string, (n: number) => string> = {
  PLINTH: (n) => `granite · 4 stairs · ${n} steps`,
  TIER1: (n) => `altar · 4 Buddhas · ${n} steps`,
  TIER2: (n) => `balcony · levers · ${n} steps`,
  TIER3: (n) => `brackets · roof · ${n} steps`,
  TIER4: (n) => `brackets · roof · ${n} steps`,
  TIER5: (n) => `sōrin · 9 rings · ${n} steps`,
  PAINT: () => 'vermilion · 2 coats · M5',
  SECTION: () => 'interior flight · M5',
};

export const PART_ANIM = 0.2; // seconds for one part to settle
export const ACTIVE_HOLD = 0.25; // seconds a placed part stays "active" red
const END_HOLD = 1.0;

const tmpV = new Vector3();
const tmpQ = new Quaternion();

/** Highest point / max horizontal extent of an oriented box. */
function extent(p: ScheduledPart | StepDef['parts'][number]) {
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

export function buildProject(): Project {
  const defs = generatePagoda();
  const steps: Step[] = [];
  const parts: ScheduledPart[] = [];
  const stages: StageDef[] = [];

  for (const sd of STAGES) {
    const mine = defs.filter((d) => sd.tiers.includes(d.tier));
    stages.push({ ...sd, subtitle: SUBTITLES[sd.code](mine.length) });
    if (!sd.available || mine.length === 0) continue;
    const dur = sd.end - sd.start;
    const interval = (dur - 0.3) / mine.length;
    mine.forEach((def, i) => {
      const t0 = sd.start + 0.05 + i * interval;
      const spread = Math.min(interval * 1.6, 0.45);
      const partStart = parts.length;
      let mass = 0;
      let top = 0;
      let half = 0;
      const c = [0, 0, 0];
      const matMass = new Map<MaterialId, number>();
      def.parts.forEach((p, j) => {
        const pt0 = t0 + (def.parts.length > 1 ? (spread * j) / (def.parts.length - 1) : 0);
        const sp: ScheduledPart = { ...p, t0: pt0, dur: PART_ANIM, drop: def.drop, stage: sd.n, step: steps.length };
        parts.push(sp);
        const m = p.size[0] * p.size[1] * p.size[2] * MATERIAL_INFO[p.mat].density;
        mass += m;
        matMass.set(p.mat, (matMass.get(p.mat) ?? 0) + m);
        const e = extent(p);
        top = Math.max(top, e.top);
        half = Math.max(half, e.half);
        c[0] += p.pos[0];
        c[1] += p.pos[1];
        c[2] += p.pos[2];
      });
      const n = Math.max(1, def.parts.length);
      const dominant = [...matMass.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'stringline';
      const { parts: _omit, ...rest } = def;
      steps.push({
        ...rest,
        index: steps.length,
        id: String(steps.length + 1).padStart(3, '0'),
        stage: sd.n,
        t0,
        t1: (parts[parts.length - 1]?.t0 ?? t0) + PART_ANIM,
        partStart,
        partCount: def.parts.length,
        material: MATERIAL_INFO[dominant].label,
        massKg: mass,
        centroid: [c[0] / n, c[1] / n, c[2] / n],
        top,
        halfExtent: half,
      });
    });
  }

  const last = steps[steps.length - 1];
  const height = Math.max(...steps.map((s) => s.top));
  return {
    id: 'PG-05',
    name: 'Five-Tier Pagoda',
    subtitle: 'Timber pagoda · built member by member from the drawing',
    rev: 'C',
    revDate: '11/26',
    height,
    levels: LEVELS.map((l) => (l.code === 'TOP' ? { ...l, y: height } : l)),
    stages,
    steps,
    parts,
    duration: Math.max(last.t1, stages.filter((s) => s.available).at(-1)!.end) + END_HOLD,
    totalMassKg: steps.reduce((a, s) => a + s.massKg, 0),
  };
}

export function tierOf(step: Step): TierId {
  return step.tier;
}
