import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { assembleProject } from '../src/data/assemble';
import { buildProject } from '../src/data/project';
import type { Crane, MaterialId, MeshData, Part, PartRef, Project, StepDef, Vec3 } from '../src/data/types';
import { CheckScene } from '../src/checks/scene';
import { runChecks, ruleStatus } from '../src/checks/run';
import type { CheckReport, Issue, RuleId } from '../src/checks/types';
import { readIfc } from '../src/ifc/model';
import { projectFromIfc } from '../src/ifc/sequence';
import { unzip, zip, crc32 } from '../src/export/zip';
import { bcfZip, stableGuid } from '../src/export/bcf';
import { issuesCsv } from '../src/export/csv';
import { issueView, modelBounds, toIfc } from '../src/checks/view';

const here = dirname(fileURLToPath(import.meta.url));

// ── tiny projects ──────────────────────────────────────────────────────────

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

/** A closed, outward-wound box mesh. */
function boxMesh(lo: Vec3, hi: Vec3): MeshData {
  const c = (i: number): Vec3 => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const positions = new Float32Array(24);
  for (let i = 0; i < 8; i++) positions.set(c(i), i * 3);
  const idx: number[] = [];
  for (const [a, b, cc, d] of quads) idx.push(a, b, cc, a, cc, d);
  return { positions, indices: new Uint32Array(idx), edges: new Float32Array(0), closed: true, min: lo, max: hi };
}

/** Several boxes as one mesh (touching shells), e.g. a solid stair made of step blocks. */
function mergeMeshes(list: MeshData[]): MeshData {
  const pos: number[] = [], idx: number[] = [];
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const m of list) {
    const base = pos.length / 3;
    pos.push(...m.positions);
    for (const i of m.indices) idx.push(base + i);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], m.min[k]);
      hi[k] = Math.max(hi[k], m.max[k]);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), edges: new Float32Array(0), closed: true, min: lo, max: hi };
}

/** An imported-style part backed by mesh `k`. */
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

const run = (p: Project) => runChecks(p, undefined, undefined, false);
const of = (r: CheckReport, rule: RuleId) => r.issues.filter((i) => i.rule === rule);
const result = (r: CheckReport, rule: RuleId) => r.rules.find((x) => x.id === rule)!;

// a 6 × 6 m bay: slab on grade, four walls, a roof slab on top
const ground = () => step('L0 · GROUND SLAB', 'cast', [box([0, -0.1, 0], [6.4, 0.2, 6.4])]);
const walls = () => step('CORE · WALLS', 'cast', [box([-3, 1.5, 0], [0.2, 3, 6]), box([3, 1.5, 0], [0.2, 3, 6]), box([0, 1.5, -3], [6, 3, 0.2]), box([0, 1.5, 3], [6, 3, 0.2])], { kind: 'core' });
const roof = () => step('L1 · ROOF SLAB', 'crane', [box([0, 3.1, 0], [6.4, 0.2, 6.4], 'clt')]);

describe('check scene', () => {
  it('measures stretches inside boxes and touching shells by winding number', () => {
    const a = boxMesh([0, 0, 0], [1, 1, 1]);
    const b = boxMesh([1, 0, 0], [2, 1, 1]); // touches a along x = 1
    const p = mk([step('X · BLOCKS', 'manual', [meshPart(mergeMeshes([a, b]), 0, 'concrete', { category: 'wall', guid: 'A' })])], { source: 'ifc', meshes: [mergeMeshes([a, b])] });
    const S = new CheckScene(p);
    // one solid from 0 to 2 although the ray crosses the shared face
    expect(S.inside(0, [-1, 0.37, 0.41], [1, 0, 0])).toEqual([[1, 3]]);
    const q = mk([step('X · BOX', 'manual', [{ ...box([0, 0, 0], [2, 2, 2]), quat: [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)] }])]);
    const T = new CheckScene(q);
    const [[t0, t1]] = T.inside(0, [-5, 0, 0], [1, 0, 0]);
    expect(t1 - t0).toBeCloseTo(2 / Math.cos(Math.PI / 4), 6); // a 2 m cube turned 45° is √8 across
  });
});

describe('seeded bad sequences produce the expected failures', () => {
  it('a sound sequence passes every rule it can check', async () => {
    const r = await run(mk([ground(), walls(), roof()]));
    expect(of(r, 'ORDER-SUPPORT')).toEqual([]);
    expect(ruleStatus(result(r, 'ORDER-SUPPORT'))).toBe('passed');
    expect(of(r, 'REACH-PATH')).toEqual([]);
    expect(of(r, 'REACH-CRANE')).toEqual([]);
  });

  it('ORDER-SUPPORT: a roof placed before its walls', async () => {
    const p = mk([ground(), roof(), walls()]);
    const [issue] = of(await run(p), 'ORDER-SUPPORT');
    expect(issue.severity).toBe('critical');
    expect(issue.primary.map((i) => p.parts[i].mat)).toEqual(['clt']);
    expect(issue.secondary.length).toBeGreaterThan(0);
    expect(issue.secondary.every((i) => p.parts[i].step === 2)).toBe(true);
    expect(issue.step).toBe(1);
  });

  it('TEMP-PROPS: a beam placed with only one end supported', async () => {
    const p = mk([
      step('L0 · PIERS', 'cast', [box([-3, 1.5, 0], [0.4, 3, 0.4])]),
      step('L1 · BEAM', 'crane', [box([0, 3.2, 0], [6.4, 0.4, 0.3], 'glulam')]),
      step('L0 · PIERS EAST', 'cast', [box([3, 1.5, 0], [0.4, 3, 0.4])]),
    ]);
    const r = await run(p);
    expect(of(r, 'ORDER-SUPPORT')).toEqual([]);
    const [issue] = of(r, 'TEMP-PROPS');
    expect(issue.title).toMatch(/Prop 1 span until step 003/);
    expect(issue.secondary).toEqual([2]);
  });

  it('REACH-CRANE: beyond the jib is critical, near the chart is a review', async () => {
    const far = await run(mk([ground(), walls(), step('L1 · FAR PANEL', 'crane', [box([25, 3.1, 0], [2, 0.2, 2], 'clt')])]));
    const [beyond] = of(far, 'REACH-CRANE');
    expect(beyond.severity).toBe('critical');
    expect(beyond.title).toMatch(/beyond the jib/);
    // 6.4 × 6.4 × 0.2 m of CLT at 470 kg/m³ ≈ 3.85 t at 20 m radius
    const kg = 6.4 * 6.4 * 0.2 * 470;
    const tight = await run(mk([ground(), walls(), roof()], { crane: { capacityAt: () => kg / 0.9 } }));
    const [near] = of(tight, 'REACH-CRANE');
    expect(near.severity).toBe('major');
    expect(near.value).toBeCloseTo(0.9, 6);
  });

  it('REACH-PATH: a crane pick under a slab already built', async () => {
    // upstairs it is critical: the pod has to be lifted before the roof goes on
    const tall = step('CORE · WALLS', 'cast', [box([-3, 3.1, 0], [0.2, 6.2, 6]), box([3, 3.1, 0], [0.2, 6.2, 6]), box([0, 3.1, -3], [6, 6.2, 0.2]), box([0, 3.1, 3], [6, 6.2, 0.2])], { kind: 'core' });
    const l1 = step('L1 · FLOOR SLAB', 'cast', [box([0, 3.0, 0], [5.8, 0.2, 5.8])]);
    const top = step('L2 · ROOF SLAB', 'crane', [box([0, 6.3, 0], [6.4, 0.2, 6.4], 'clt')]);
    const p = mk([ground(), tall, l1, top, step('L1 · POD', 'crane', [box([0, 4.4, 0], [2.4, 2.6, 1.8], 'pod')])]);
    const [issue] = of(await run(p), 'REACH-PATH');
    expect(issue.severity).toBe('critical');
    expect(issue.primary.map((i) => p.parts[i].mat)).toEqual(['pod']);
    expect(issue.secondary.map((i) => p.parts[i].mat)).toEqual(['clt']);
    // at ground level it is a different plant, not a stop
    const q = mk([ground(), walls(), roof(), step('L0 · POD', 'crane', [box([0, 1.3, 0], [2.4, 2.6, 1.8], 'pod')])]);
    const [low] = of(await run(q), 'REACH-PATH');
    expect(low.severity).toBe('major');
    expect(low.action).toMatch(/ground plant/);
  });

  it('TEMP-EDGE: a raised slab is open until its parapets go in, and never if they never do', async () => {
    const slab = step('L1 · DECK SLAB', 'cast', [box([0, 3.1, 0], [6.4, 0.2, 6.4])]);
    const piers = step('L0 · PIERS', 'cast', [-3, 3].flatMap((x) => [-3, 3].map((z) => box([x, 1.5, z], [0.4, 3, 0.4]))));
    const parapets = step('CORE · PARAPETS', 'cast', [box([-3.1, 3.7, 0], [0.2, 1.0, 6.4]), box([3.1, 3.7, 0], [0.2, 1.0, 6.4]), box([0, 3.7, -3.1], [6.4, 1.0, 0.2]), box([0, 3.7, 3.1], [6.4, 1.0, 0.2])], { kind: 'core' });
    const r = await run(mk([piers, slab, step('L1 · PODS', 'crane', [box([0, 4.5, 0], [1, 2.6, 1], 'pod')]), parapets]));
    const [open] = of(r, 'TEMP-EDGE');
    expect(open.title).toMatch(/Edge protection: 26 m/);
    expect(open.detail).toMatch(/from step 002 until step 004 \(2 steps\), when the walls close it/);
    const never = await run(mk([piers, slab]));
    expect(of(never, 'TEMP-EDGE')[0].title).toMatch(/26 m of open edge never guarded/);
    // a slab at the ground has nothing to fall from
    expect(result(await run(mk([ground(), walls()])), 'TEMP-EDGE').checked).toBe(0);
  });

  it('ACCESS-TRANSPORT: a 15 m beam is an abnormal load', async () => {
    const p = mk([ground(), walls(), step('L1 · TRANSFER BEAM', 'crane', [box([0, 3.4, 0], [15, 0.6, 0.4], 'steel')])]);
    const [issue] = of(await run(p), 'ACCESS-TRANSPORT');
    expect(issue.detail).toMatch(/15\.0 m long/);
  });

  it('CLASH-TEMP: an element in the crane mast position', async () => {
    const p = mk([ground(), step('L0 · KIOSK', 'cast', [box([-20, 1.5, 0], [3, 3, 3])])]);
    const [issue] = of(await run(p), 'CLASH-TEMP');
    expect(issue.severity).toBe('critical');
  });

  it('rules with nothing to check read as unverified, not passed', async () => {
    const r = await run(mk([ground(), walls(), roof()]));
    expect(ruleStatus(result(r, 'ACCESS-HEADROOM'))).toBe('unverified');
    expect(ruleStatus(result(r, 'CLASH-HARD'))).toBe('unverified'); // generated geometry
    expect(ruleStatus(result(r, 'ACCESS-HANDLING'))).toBe('unverified');
  });
});

describe('checks on imported geometry', () => {
  const slabMesh = boxMesh([-3, 2.8, -3], [3, 3.1, 3]);
  it('CLASH-HARD: overlaps beyond the tolerance, but not finishes, hosted doors or touching faces', async () => {
    const wall = boxMesh([-3, 0, -0.1], [3, 2.8, 0.1]);
    const window_ = boxMesh([-1, 1, -0.06], [1, 2.84, 0.06]); // head 40 mm into the slab, set in the wall's opening
    const finish = boxMesh([-3, 3.1, -3], [3, 3.12, 3]);
    const door = boxMesh([1.5, 3.1, -0.05], [2.4, 5.1, 0.05]); // sits 20 mm into the finish
    const meshes = [slabMesh, wall, window_, finish, door];
    const p = mk(
      [
        step('L0 · WALL', 'cast', [meshPart(wall, 1, 'masonry', { category: 'wall', guid: 'W' })]),
        step('L1 · SLAB', 'cast', [meshPart(slabMesh, 0, 'concrete', { category: 'slab', guid: 'S' })]),
        step('L0 · WINDOW', 'manual', [meshPart(window_, 2, 'glass', { category: 'window', guid: 'G', host: 'W', phase: 'envelope' })]),
        step('L1 · FINISH', 'manual', [meshPart(finish, 3, 'timber', { category: 'slab', guid: 'F', phase: 'fitout' })]),
        step('L1 · DOOR', 'manual', [meshPart(door, 4, 'timber', { category: 'door', guid: 'D', phase: 'fitout' })]),
      ],
      { source: 'ifc', meshes },
    );
    const r = await run(p);
    const clashes = of(r, 'CLASH-HARD');
    expect(clashes).toHaveLength(1);
    expect(clashes[0].severity).toBe('major'); // no deflection gap under the slab
    expect(clashes[0].value).toBeCloseTo(0.04, 3);
    expect(clashes[0].primary.map((i) => p.parts[i].ref!.guid)).toEqual(['G']);
    expect(clashes[0].secondary.map((i) => p.parts[i].ref!.guid)).toEqual(['S']);
    expect(result(r, 'CLASH-HARD').note).toMatch(/1 finish interfaces ignored/);
  });

  it('CLASH-HARD: two copies of one element are a duplicate', async () => {
    const c = boxMesh([0, 2.5, 0], [2, 2.55, 2]);
    const p = mk([step('L0 · CEILINGS', 'manual', [meshPart(c, 0, 'gypsum', { category: 'covering', guid: 'C1', phase: 'fitout' }), meshPart(c, 1, 'gypsum', { category: 'covering', guid: 'C2', phase: 'fitout' })])], { source: 'ifc', meshes: [c, c] });
    const [dup] = of(await run(p), 'CLASH-HARD');
    expect(dup.title).toMatch(/^Duplicate covering/);
  });

  it('ACCESS-HEADROOM: a slab over the top of a flight', async () => {
    // 10 risers of 180 mm, 250 mm goings, as one solid of step blocks
    const blocks: MeshData[] = [];
    for (let k = 0; k < 10; k++) blocks.push(boxMesh([0, 0, k * 0.25], [1, (k + 1) * 0.18, (k + 1) * 0.25]));
    const stair = mergeMeshes(blocks);
    const over = boxMesh([-1, 2.6, 1.5], [2, 2.9, 4]); // covers the upper half of the flight
    const p = mk(
      [step('L0 · STAIR', 'cast', [meshPart(stair, 0, 'concrete', { category: 'stair', guid: 'ST' })]), step('L1 · FLOOR', 'cast', [meshPart(over, 1, 'concrete', { category: 'slab', guid: 'FL' })])],
      { source: 'ifc', meshes: [stair, over] },
    );
    const r = await run(p);
    const [issue] = of(r, 'ACCESS-HEADROOM');
    // the highest nosing is the front of the tenth block, 1.80 m up, under the slab soffit at 2.60 m
    expect(issue.value).toBeCloseTo(2.6 - 1.8, 4);
    // nine nosings (the first riser has no tread below it), each sampled every 150 mm across the 1 m width
    expect(result(r, 'ACCESS-HEADROOM').checked).toBe(9 * 7);
    const open = mk([step('L0 · STAIR', 'cast', [meshPart(stair, 0, 'concrete', { category: 'stair', guid: 'ST' })])], { source: 'ifc', meshes: [stair] });
    expect(of(await run(open), 'ACCESS-HEADROOM')).toEqual([]);
  });

  it('ACCESS-HANDLING: a glazed unit too heavy for two people', async () => {
    const unit = boxMesh([0, 0, 0], [2.4, 2.4, 0.03]); // 0.17 m³ of glass ≈ 430 kg
    const p = mk([step('L0 · GLAZING', 'manual', [meshPart(unit, 0, 'glass', { category: 'window', guid: 'WN', phase: 'envelope' })])], { source: 'ifc', meshes: [unit] });
    const p2 = { ...p, density: { glass: 2500 } } as Project;
    const [issue] = of(await run(p2), 'ACCESS-HANDLING');
    expect(issue.severity).toBe('major');
    expect(issue.value).toBeCloseTo(2.4 * 2.4 * 0.03 * 2500, 0);
  });
});

describe('the Duplex (Revit, IFC2x3)', () => {
  let p: Project;
  let r: CheckReport;
  let ms = 0;
  beforeAll(async () => {
    const model = await readIfc(readFileSync(join(here, '../public/samples/duplex-apartment.ifc.txt'), 'latin1'), () => {}, 'Duplex_A_20110907.ifc');
    p = projectFromIfc(model, 'Duplex_A_20110907.ifc').project;
    r = await run(p);
    ms = r.ms;
  });
  const names = (i: Issue, which: 'primary' | 'secondary') => i[which].map((k) => p.parts[k].ref!.name);

  it('runs every rule in well under a second', () => {
    expect(ms).toBeLessThan(2000);
    expect(r.rules.map((x) => x.id)).toHaveLength(11);
  });

  it('finds the window heads built into the W410X60 beams', () => {
    const heads = of(r, 'CLASH-HARD').filter((i) => names(i, 'secondary').some((n) => n.includes('W410X60')));
    expect(heads).toHaveLength(4);
    for (const i of heads) {
      expect(i.severity).toBe('major');
      expect(i.primary).toHaveLength(2);
      expect(names(i, 'primary').every((n) => n.startsWith('M_Fixed'))).toBe(true);
      expect(i.value!).toBeGreaterThan(0.01);
      expect(i.value!).toBeLessThan(0.02);
    }
  });

  it('finds the duplicate ceiling and the double-counted party wall junctions', () => {
    const titles = of(r, 'CLASH-HARD').map((i) => i.title);
    expect(titles.filter((t) => t.startsWith('Duplicate covering'))).toHaveLength(1);
    expect(titles.filter((t) => t.startsWith('Walls overlap at a junction'))).toHaveLength(2);
  });

  it('needs edge protection at the stair voids and the rooflight openings', () => {
    const edges = of(r, 'TEMP-EDGE');
    expect(edges.map((i) => i.title)).toEqual(['Edge protection: 4 m at LEVEL 2 (+3.10 m)', 'Edge protection: 8 m at ROOF (+6.50 m)']);
    expect(edges[0].detail).toMatch(/guard rails/);
    expect(edges[1].secondary.map((k) => p.parts[k].ref!.name)).toEqual(expect.arrayContaining([expect.stringContaining('M_Skylight')]));
  });

  it('builds in a supportable order, within reach, with headroom on both stairs', () => {
    for (const rule of ['ORDER-SUPPORT', 'TEMP-PROPS', 'REACH-CRANE', 'REACH-PATH', 'CLASH-TEMP', 'ACCESS-HEADROOM', 'ACCESS-TRANSPORT'] as RuleId[]) {
      expect(ruleStatus(result(r, rule)), rule).toBe('passed');
    }
    expect(result(r, 'ACCESS-HEADROOM').note).toMatch(/2 stairs, \d+ nosing points measured, least headroom 2\.\d\d m/);
  });

  it('flags the large fixed windows for mechanical handling', () => {
    const [glazing] = of(r, 'ACCESS-HANDLING').filter((i) => i.title.includes('windows'));
    expect(glazing.severity).toBe('major');
    expect(glazing.primary).toHaveLength(22);
  });

  it('sends the model gaps back to the design team', () => {
    expect(of(r, 'MODEL-DATA').map((i) => i.title)).toEqual(['9 openings placed clear of their hosts', '114 elements without a material', '50 elements modelled as open surfaces']);
  });
});

describe('Arbor House (generated)', () => {
  let p: Project;
  let r: CheckReport;
  beforeAll(async () => {
    p = buildProject();
    r = await run(p);
  });

  it('flags the BMU gantry over the chart and the entrance canopy near it', () => {
    const lifts = of(r, 'REACH-CRANE');
    expect(lifts.map((i) => [i.severity, Math.round(i.value! * 100)])).toEqual([
      ['critical', 116],
      ['major', 87],
    ]);
  });

  it('finds the sky-garden trees that cannot be lowered through the floor above', () => {
    const paths = of(r, 'REACH-PATH').filter((i) => i.severity === 'critical');
    expect(paths).toHaveLength(2);
    for (const i of paths) expect(p.steps[i.step].member).toMatch(/^SKY GARDEN/);
  });

  it('needs perimeter protection on every typical floor while the façade trails', () => {
    const screens = of(r, 'TEMP-EDGE').find((i) => /^Edge protection on \d+ floors/.test(i.title))!;
    expect(screens.title).toMatch(/on 31 floors/);
    expect(screens.detail).toMatch(/façade units/);
  });

  it('builds every piece after what it bears on, and says clashes are not checked on massing', () => {
    expect(ruleStatus(result(r, 'ORDER-SUPPORT'))).toBe('passed');
    expect(result(r, 'ORDER-SUPPORT').checked).toBeGreaterThan(7000);
    expect(ruleStatus(result(r, 'CLASH-HARD'))).toBe('unverified');
    expect(result(r, 'CLASH-HARD').note).toMatch(/imported models only/);
  });

  it('books the CLT floor panels as wide loads', () => {
    const clt = of(r, 'ACCESS-TRANSPORT').find((i) => i.title.includes('clt floor panels'))!;
    expect(clt.primary.length).toBe(612);
    expect(clt.detail).toMatch(/3\.61 m wide laid flat/);
  });
});

describe('exports', () => {
  it('writes ZIPs that read back with matching CRCs', () => {
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    const files = unzip(zip([{ name: 'a.txt', data: 'héllo' }, { name: 'dir/b.bin', data: new Uint8Array([0, 1, 2, 255]) }]));
    expect([...files.keys()]).toEqual(['a.txt', 'dir/b.bin']);
    expect(new TextDecoder().decode(files.get('a.txt'))).toBe('héllo');
    expect([...files.get('dir/b.bin')!]).toEqual([0, 1, 2, 255]);
  });

  it('makes stable, well-formed topic GUIDs', () => {
    const g = stableGuid('DU-04|CLH-04');
    expect(g).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(stableGuid('DU-04|CLH-04')).toBe(g);
    expect(stableGuid('DU-04|CLH-05')).not.toBe(g);
  });

  it('packs the Duplex issues as BCF 2.1 with IFC components and IFC-world cameras', async () => {
    const model = await readIfc(readFileSync(join(here, '../public/samples/duplex-apartment.ifc.txt'), 'latin1'), () => {}, 'Duplex_A_20110907.ifc');
    const p = projectFromIfc(model, 'Duplex_A_20110907.ifc').project;
    const r = await run(p);
    const files = unzip(bcfZip(p, r, new Map([[r.issues[0].id, new Uint8Array([137, 80, 78, 71])]]), new Date('2026-11-05T12:00:00Z')));
    const text = (n: string) => new TextDecoder().decode(files.get(n));
    expect(text('bcf.version')).toMatch(/<Version VersionId="2.1">/);
    const topics = [...files.keys()].filter((n) => n.endsWith('/markup.bcf'));
    expect(topics).toHaveLength(r.issues.length);
    expect(new Set(topics.map((n) => n.split('/')[0])).size).toBe(r.issues.length);
    expect([...files.keys()].filter((n) => n.endsWith('snapshot.png'))).toHaveLength(1);
    // the window-head clash: both windows red, the beam blue, the file and project named
    const clash = r.issues.find((i) => i.rule === 'CLASH-HARD' && i.title.includes('W410X60'))!;
    const dir = topics.map((n) => n.split('/')[0]).find((d) => text(`${d}/markup.bcf`).includes(clash.id))!;
    const markup = text(`${dir}/markup.bcf`);
    expect(markup).toMatch(/<File IfcProject="[0-9A-Za-z_$]{22}" isExternal="true"><Filename>Duplex_A_20110907.ifc<\/Filename><\/File>/);
    expect(markup).toMatch(/TopicType="Clash"/);
    expect(markup).toMatch(/<Priority>Major<\/Priority>/);
    const vp = text(`${dir}/viewpoint.bcfv`);
    for (const k of clash.primary) expect(vp).toContain(`<Component IfcGuid="${p.parts[k].ref!.guid}" />`);
    expect(vp).toMatch(/<Color Color="FFB3261E">/);
    expect(vp).toMatch(/<FieldOfView>50<\/FieldOfView>/);
    // the camera sits where the app's issue camera sits, in IFC world coordinates
    const v = issueView(clash, 1.6, modelBounds(p));
    const pos = toIfc(v.position, p.meta.ifcOffset);
    const x = Number(vp.match(/<CameraViewPoint><X>([-\d.]+)<\/X>/)![1]);
    const z = Number(vp.match(/<CameraViewPoint><X>[-\d.]+<\/X><Y>[-\d.]+<\/Y><Z>([-\d.]+)<\/Z>/)![1]);
    expect(x).toBeCloseTo(pos[0], 3);
    expect(z).toBeCloseTo(pos[2], 3);
  });

  it('writes the issue register as CSV, one row per issue', async () => {
    const p = mk([ground(), roof(), walls()]);
    const r = await run(p);
    const csv = issuesCsv(p, r, (s) => p.steps[s].t1);
    const lines = csv.replace(/^\ufeff/, '').trim().split('\r\n');
    expect(lines[0].split(',').slice(0, 5)).toEqual(['ID', 'Severity', 'Rule', 'Check', 'Title']);
    expect(lines).toHaveLength(r.issues.length + 1);
    expect(lines[1]).toMatch(/^ORD-01,critical,ORDER-SUPPORT,Support before load,/);
  });
});
