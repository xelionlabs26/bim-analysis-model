/**
 * Regression tests for the buildability rules: wall tops as landings (TEMP-EDGE),
 * narrow crane picks (REACH-PATH), models set out at a site datum, rules that
 * throw, load envelopes given either way round (ACCESS-TRANSPORT), an assumed
 * crane position (CLASH-TEMP) and clash advice by where an element sits.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { assembleProject } from '../src/data/assemble';
import type { Crane, MaterialId, MeshData, Part, PartRef, Project, StepDef, Vec3 } from '../src/data/types';
import { CheckScene, groundDatum } from '../src/checks/scene';
import { checkLiftPath } from '../src/checks/rules';
import { runChecks, ruleStatus } from '../src/checks/run';
import { DEFAULT_SETTINGS, type CheckReport, type CheckSettings, type RuleId } from '../src/checks/types';
import { readIfc } from '../src/ifc/model';
import { projectFromIfc } from '../src/ifc/sequence';

const here = dirname(fileURLToPath(import.meta.url));

// ── tiny projects (as in checks.test.ts) ─────────────────────────────────────

const CRANE: Crane = {
  id: 'TC-T',
  base: [-20, 0, 0],
  jib: 40,
  counterJib: 12,
  maxKg: 8000,
  tipKg: 1000,
  capacityAt: (r) => Math.min(10000, 10000 * Math.pow(15 / Math.max(r, 1), 1.2)),
  tieX: -10,
  mastStart: 20,
};

const box = (pos: Vec3, size: Vec3, mat: MaterialId = 'concrete'): Part => ({ pos, size, quat: [0, 0, 0, 1], mat });
const step = (member: string, method: StepDef['method'], parts: Part[], extra: Partial<StepDef> = {}): StepDef => ({ zone: 'Z', member, spec: '', code: 'X-01', method, motion: method === 'cast' ? 'pour' : 'lower', drop: 0, parts, ...extra });

function mk(defs: StepDef[], opts: { source?: 'generator' | 'ifc'; crane?: Partial<Crane>; meshes?: MeshData[] } = {}): Project {
  return assembleProject({
    id: 'T-01',
    name: 'Test',
    subtitle: '',
    rev: '',
    revDate: '',
    storeys: 2,
    gifa: 100,
    levels: [{ code: 'L0', y: 0 }, { code: 'L1', y: 3 }],
    zones: [{ id: 'Z', label: 'Z', y0: 0, y1: 6 }],
    stages: [{ code: 'A', tick: 'A', title: 'A', zones: ['Z'], kind: 'assembly', sheet: 'A-1', subtitle: (n) => `${n}` }],
    defs,
    meshes: opts.meshes,
    crane: { ...CRANE, ...opts.crane },
    secondsPerStep: 0.2,
    meta: { tagline: '', caption: '', watermark: '', source: opts.source ?? 'generator' },
    presentation: () => ({ cut: { normal: [1, 0, 0], at: 0, open: 0 }, keys: [], shots: [], log: [] }),
  });
}

function boxMesh(lo: Vec3, hi: Vec3): MeshData {
  const c = (i: number): Vec3 => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const positions = new Float32Array(24);
  for (let i = 0; i < 8; i++) positions.set(c(i), i * 3);
  const idx: number[] = [];
  for (const [a, b, cc, d] of quads) idx.push(a, b, cc, a, cc, d);
  return { positions, indices: new Uint32Array(idx), edges: new Float32Array(0), closed: true, min: lo, max: hi };
}

function meshPart(m: MeshData, k: number, mat: MaterialId, ref: Partial<PartRef> & { category: string; guid: string }): Part {
  return {
    pos: [(m.min[0] + m.max[0]) / 2, (m.min[1] + m.max[1]) / 2, (m.min[2] + m.max[2]) / 2],
    size: [m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]],
    quat: [0, 0, 0, 1],
    mat,
    mesh: k,
    ref: { ifcType: 'IFCBUILDINGELEMENTPROXY', name: ref.guid, storey: '', phase: 'structure', ...ref },
  };
}

const run = (p: Project, settings?: CheckSettings) => runChecks(p, settings, undefined, false);
const of = (r: CheckReport, rule: RuleId) => r.issues.filter((i) => i.rule === rule);
const result = (r: CheckReport, rule: RuleId) => r.rules.find((x) => x.id === rule)!;

// ── TEMP-EDGE: a ledge is not a landing ──────────────────────────────────────

describe('TEMP-EDGE: what counts as somewhere to land', () => {
  // a 6.4 m deck on 800 mm walls that run 400 mm past its edge: the wall tops are a ledge with 3 m below
  const deck = () => step('L1 · DECK SLAB', 'cast', [box([0, 3.1, 0], [6.4, 0.2, 6.4])]);
  const walls = () =>
    step('L0 · WALLS', 'cast', [box([-3.2, 1.5, 0], [0.8, 3, 7.2]), box([3.2, 1.5, 0], [0.8, 3, 7.2]), box([0, 1.5, -3.2], [5.6, 3, 0.8]), box([0, 1.5, 3.2], [5.6, 3, 0.8])]);

  it('flags a raised slab whose supporting walls project past its edge', async () => {
    const r = await run(mk([walls(), deck()]));
    const [edge] = of(r, 'TEMP-EDGE');
    expect(edge.title).toMatch(/26 m of open edge never guarded/);
  });

  it('still counts a lower floor a metre wide or more as a landing', async () => {
    // a podium deck 1.5 m below runs 2 m out on every side, placed first
    const podium = step('L0 · PODIUM DECK', 'cast', [box([0, 1.5, 0], [10.4, 0.2, 10.4])]);
    const r = await run(mk([walls(), podium, deck()]));
    expect(of(r, 'TEMP-EDGE')).toEqual([]);
  });

  it('counts glazing set in the outer leaf, past a ledge, as the guard once it is in', async () => {
    // glass 370 to 430 mm past the slab edge, beyond the 350 mm a guard normally has to be within
    const glass = step(
      'L1 · GLAZING',
      'crane',
      [box([3.6, 3.8, 0], [0.06, 1.2, 6.4], 'glass'), box([-3.6, 3.8, 0], [0.06, 1.2, 6.4], 'glass'), box([0, 3.8, 3.6], [6.4, 1.2, 0.06], 'glass'), box([0, 3.8, -3.6], [6.4, 1.2, 0.06], 'glass')],
    );
    const r = await run(mk([walls(), deck(), glass]));
    const [edge] = of(r, 'TEMP-EDGE');
    expect(edge.title).toMatch(/^Edge protection: 26 m/);
    expect(edge.detail).toMatch(/until step 003/);
  });

  it('does not let a tree canopy stand in for a floor', async () => {
    const piers = step('L0 · PIERS', 'cast', [-3, 3].flatMap((x) => [-3, 3].map((z) => box([x, 1.5, z], [0.4, 3, 0.4]))));
    const slab = step('L1 · DECK SLAB', 'cast', [box([0, 3.1, 0], [6.4, 0.2, 6.4])]);
    // canopies 2.4 m across hard against the deck edge, their tops level with it
    const trees = step('L0 · TREES', 'crane', [box([4.4, 2.6, 0], [2.4, 1.2, 6.4], 'planting'), box([-4.4, 2.6, 0], [2.4, 1.2, 6.4], 'planting')]);
    const r = await run(mk([piers, slab, trees]));
    const [edge] = of(r, 'TEMP-EDGE');
    expect(edge.title).toMatch(/26 m of open edge never guarded/);
  });
});

// ── REACH-PATH: narrow picks ─────────────────────────────────────────────────

describe('REACH-PATH: picks narrower than 300 mm', () => {
  const cols = () => step('L0 · COLUMNS', 'cast', [box([-2.8, 1.85, 0], [0.4, 3.7, 0.4]), box([2.8, 1.85, 0], [0.4, 3.7, 0.4])]);
  const deck = () => step('L1 · CLT DECK', 'crane', [box([0, 3.6, 0], [6, 0.2, 3], 'clt')]);

  it('flags a 240 mm beam lowered under a deck already built', async () => {
    for (const w of [0.08, 0.24, 0.29, 0.5]) {
      const p = mk([cols(), deck(), step('L1 · BEAM', 'crane', [box([0, 3.3, 0], [5.2, 0.4, w], 'steel')])]);
      const r = await run(p);
      const [issue] = of(r, 'REACH-PATH');
      expect(issue, `beam ${w} m wide`).toBeDefined();
      expect(issue.primary.map((i) => p.parts[i].mat)).toEqual(['steel']);
      expect(issue.secondary.map((i) => p.parts[i].mat)).toEqual(['clt']);
    }
  });

  it('leaves a thin façade panel under the slab edge out, and says it was not tested', async () => {
    const p = mk([cols(), deck(), step('L0 · GLAZING', 'crane', [box([0, 1.8, 1.5], [2, 3.4, 0.05], 'glass')])]);
    const r = await run(p);
    expect(of(r, 'REACH-PATH')).toEqual([]);
    expect(result(r, 'REACH-PATH').note).toMatch(/1 thin façade and wall piece fitted from the slab edge, not tested/);
    // only the deck itself was tested
    expect(result(r, 'REACH-PATH').checked).toBe(1);
  });

  it('reads as unverified when no pick can be tested', async () => {
    const r = await run(mk([cols(), step('L0 · GLAZING', 'crane', [box([0, 1.8, 1.5], [2, 3.4, 0.05], 'glass')])]));
    expect(ruleStatus(result(r, 'REACH-PATH'))).toBe('unverified');
  });
});

// ── a model set out at a site datum ──────────────────────────────────────────

/** The same project with every part and mesh raised by dy, its storeys left where they were. */
function lifted(p: Project, dy: number): Project {
  const meshes = p.meshes.map((m) => {
    const positions = new Float32Array(m.positions);
    for (let v = 1; v < positions.length; v += 3) positions[v] += dy;
    return { ...m, positions, min: [m.min[0], m.min[1] + dy, m.min[2]] as Vec3, max: [m.max[0], m.max[1] + dy, m.max[2]] as Vec3 };
  });
  const parts = p.parts.map((x) => ({ ...x, pos: [x.pos[0], x.pos[1] + dy, x.pos[2]] as Vec3 }));
  return { ...p, meshes, parts };
}

describe('a model set out at +30 m with its storeys at 0', () => {
  let p: Project;
  let base: CheckReport;
  let up: CheckReport;
  beforeAll(async () => {
    const model = await readIfc(readFileSync(join(here, '../public/samples/duplex-apartment.ifc.txt'), 'latin1'), () => {}, 'Duplex_A_20110907.ifc');
    p = projectFromIfc(model, 'Duplex_A_20110907.ifc').project;
    base = await run(p);
    up = await run(lifted(p, 30));
  });

  it('finds the ground at the slab on grade and the shift to the storeys', () => {
    const S = new CheckScene(lifted(p, 30));
    const d = groundDatum(S.project, S);
    expect(d.shift).toBeCloseTo(30, 1);
    expect(d.ground).toBeCloseTo(30, 1);
    // the model at datum keeps exactly zero
    expect(groundDatum(p, new CheckScene(p))).toEqual({ ground: 0, shift: 0 });
  });

  it('reports the same open edges, under the same level names', () => {
    expect(of(up, 'TEMP-EDGE').map((i) => i.title)).toEqual(of(base, 'TEMP-EDGE').map((i) => i.title));
    expect(result(up, 'TEMP-EDGE').note).toBe(result(base, 'TEMP-EDGE').note);
    expect(of(up, 'TEMP-EDGE').some((i) => /\+30\.00 m/.test(i.title))).toBe(false);
  });

  it('reads support, propping and the lift paths the same way', () => {
    for (const rule of ['ORDER-SUPPORT', 'TEMP-PROPS', 'REACH-PATH'] as RuleId[]) {
      expect(result(up, rule), rule).toEqual(result(base, rule));
      expect(of(up, rule).map((i) => i.title), rule).toEqual(of(base, rule).map((i) => i.title));
    }
  });

  it('keeps a generated project on y = 0', () => {
    const q = mk([step('L1 · DECK SLAB', 'cast', [box([0, 31.1, 0], [6.4, 0.2, 6.4])])]);
    expect(groundDatum(q, new CheckScene(q))).toEqual({ ground: 0, shift: 0 });
  });
});

// ── rules that throw, and very large models ──────────────────────────────────

describe('robustness', () => {
  it('a rule that throws reads as a failed check, and the others still run', async () => {
    // the load chart breaks only once the project is built, as a bad import might
    let broken = false;
    const p = mk([step('L1 · PANEL', 'crane', [box([0, 3.1, 0], [2, 0.2, 2], 'clt')])], {
      crane: {
        capacityAt: () => {
          if (broken) throw new Error('no load chart');
          return 10000;
        },
      },
    });
    broken = true;
    const r = await run(p);
    expect(result(r, 'REACH-CRANE')).toMatchObject({ checked: 0, applicable: false, note: 'check failed: no load chart' });
    expect(ruleStatus(result(r, 'REACH-CRANE'))).toBe('unverified');
    expect(r.rules).toHaveLength(11);
    expect(result(r, 'ORDER-SUPPORT').checked).toBe(1);
  });

  it('REACH-PATH takes the model height of 160,000 parts without spreading them into Math.max', () => {
    const n = 160_000;
    const max = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) max[i * 3 + 1] = i % 97;
    const S = { n, max, project: { steps: [] } } as unknown as CheckScene;
    expect(checkLiftPath(S, DEFAULT_SETTINGS).result.note).toBe('no crane picks');
  });
});

// ── ACCESS-TRANSPORT: the load envelope either way round ─────────────────────

describe('ACCESS-TRANSPORT: width and height in either order', () => {
  const module_ = (size: Vec3) => mk([step('L1 · MODULE', 'crane', [box([0, 1.5, 0], size, 'pod')])]);

  it('flags a 2.8 × 2.9 m module whether the load is 2.55 wide by 3.0 high or 3.0 wide by 2.55 high', async () => {
    for (const truck of [[13.6, 2.55, 3.0], [13.6, 3.0, 2.55]] as [number, number, number][]) {
      const r = await run(module_([10, 2.9, 2.8]), { ...DEFAULT_SETTINGS, truck });
      const [issue] = of(r, 'ACCESS-TRANSPORT');
      expect(issue, `truck ${truck.join(' × ')}`).toBeDefined();
      expect(issue.detail).toMatch(/at least 2\.80 m across whichever way it lies/);
      expect(issue.value!).toBeCloseTo(2.8 / 2.55, 6);
    }
  });

  it('passes a 2.5 × 2.9 m module that fits standing either way', async () => {
    for (const truck of [[13.6, 2.55, 3.0], [13.6, 3.0, 2.55]] as [number, number, number][]) {
      const r = await run(module_([10, 2.9, 2.5]), { ...DEFAULT_SETTINGS, truck });
      expect(of(r, 'ACCESS-TRANSPORT'), `truck ${truck.join(' × ')}`).toEqual([]);
    }
  });
});

// ── CLASH-TEMP: an assumed crane ─────────────────────────────────────────────

describe('CLASH-TEMP: a crane the importer placed', () => {
  it('reads as unverified on an import, even with an element in the mast position', async () => {
    const kiosk = boxMesh([-21.5, 0, -1.5], [-18.5, 3, 1.5]);
    const p = mk([step('L0 · KIOSK', 'cast', [meshPart(kiosk, 0, 'concrete', { category: 'wall', guid: 'K' })])], { source: 'ifc', crane: { assumed: true }, meshes: [kiosk] });
    const r = await run(p);
    expect(of(r, 'CLASH-TEMP')).toEqual([]);
    expect(ruleStatus(result(r, 'CLASH-TEMP'))).toBe('unverified');
    expect(result(r, 'CLASH-TEMP').note).toMatch(/assumed by the importer/);
  });
});

// ── CLASH-HARD: advice by where the element sits ─────────────────────────────

describe('CLASH-HARD: what to do about walls in a floor', () => {
  const slab = boxMesh([-3, 2.8, -3], [3, 3.1, 3]);
  const clash = async (walls: [Vec3, Vec3][]) => {
    const meshes = [slab, ...walls.map(([lo, hi]) => boxMesh(lo, hi))];
    const p = mk(
      [
        step('L1 · FLOOR', 'cast', [meshPart(slab, 0, 'timber', { category: 'slab', guid: 'S' })]),
        step('L1 · PARTITIONS', 'manual', meshes.slice(1).map((m, k) => meshPart(m, k + 1, 'gypsum', { category: 'wall', guid: `W${k}`, phase: 'fitout' }))),
      ],
      { source: 'ifc', meshes },
    );
    return of(await run(p), 'CLASH-HARD');
  };

  it('splits a wall that runs through the floor rather than lowering its head', async () => {
    const [issue] = await clash([[[-1, 2.61, -0.05], [1, 6.0, 0.05]]]);
    expect(issue.action).not.toMatch(/lower/);
    expect(issue.action).toMatch(/^Split the wall at the slab/);
    // still major: 100 mm of wall through a structural floor
    expect(issue.severity).toBe('major');
  });

  it('starts a wall whose base sits in the floor on top of it', async () => {
    const [issue] = await clash([[[-1, 2.9, -0.05], [1, 6.0, 0.05]]]);
    expect(issue.action).toBe('Start the wall on top of the slab instead of inside it.');
  });

  it('keeps the deflection-head advice for a wall under the floor, and names each wall in a mixed group', async () => {
    const [under] = await clash([[[-1, 0, -0.05], [1, 2.84, 0.05]]]);
    expect(under.action).toBe('Stop the wall under the slab with a deflection gap (a deflection head), or lower its head.');
    expect(under.severity).toBe('major');
    const [mixed] = await clash([
      [[-1, 0, -0.05], [1, 2.84, 0.05]],
      [[1.5, 2.61, -0.05], [2.5, 6.0, 0.05]],
    ]);
    expect(mixed.action).toMatch(/^Stop W0 under the slab .* Split W1 at the slab/);
  });
});
