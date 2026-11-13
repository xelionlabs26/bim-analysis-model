import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProject } from '../src/data/project';
import { CORE, EDGE, GIFA, GRID, SET_EDGE, STOREYS } from '../src/data/generator';
import { reviewedLift, type Project } from '../src/data/types';
import { assembleProject } from '../src/data/assemble';
import { firstOverPick, riggedLift } from '../src/engine/lifts';
import { runChecks } from '../src/checks/run';
import { DEFAULT_SETTINGS } from '../src/checks/types';
import { readIfc } from '../src/ifc/model';
import { projectFromIfc } from '../src/ifc/sequence';

const here = dirname(fileURLToPath(import.meta.url));
const arbor = buildProject();
const partsOf = (p: Project, i: number) => p.parts.slice(p.steps[i].partStart, p.steps[i].partStart + p.steps[i].partCount);

describe('Arbor House floor area', () => {
  const facades = arbor.steps.filter((s) => s.code === 'FC-01');
  const glass = (i: number) => partsOf(arbor, i).filter((x) => x.mat === 'glass');

  it('leaves out the south bay on every set-back storey and both bays of each sky garden', () => {
    // read from the model: storeys whose south glass stands at the setback line, and storeys with an open sky corner
    const setBack = facades.filter((s) => Math.max(...glass(s.index).map((g) => g.pos[2])) < EDGE).map((s) => s.level);
    const openCorner = facades.filter((s) => !glass(s.index).some((g) => g.pos[0] > GRID + 0.1 && g.pos[2] > GRID + 0.1)).map((s) => s.level);
    expect(setBack).toEqual([24, 25, 26, 27, 28, 29, 30, 31]);
    expect(openCorner).toEqual([12, 13, 22, 23]);
    const plate = (2 * EDGE) ** 2 - (2 * CORE) ** 2;
    const expected = STOREYS * plate - setBack.length * (2 * EDGE) * (EDGE - SET_EDGE) - openCorner.length * (EDGE - GRID) ** 2;
    expect(GIFA).toBeCloseTo(expected, 6);
    expect(arbor.gifa).toBe(GIFA);
    expect(Math.round(GIFA)).toBe(20890);
  });
});

describe('Arbor House stage subtitles match the steps each stage builds', () => {
  const levelsIn = (subtitle: string, what: RegExp) => [...subtitle.matchAll(what)].map((m) => Number(m[1])).sort((a, b) => a - b);

  it('names the sky gardens, the terrace and the last façade that each tower stage installs', () => {
    for (const st of arbor.stages.filter((x) => ['LOWER', 'MIDDLE', 'UPPER'].includes(x.code))) {
      const mine = arbor.steps.filter((s) => s.stage === st.n);
      const gardens = mine.filter((s) => s.code === 'SG-01').map((s) => s.level!);
      const terraces = mine.filter((s) => s.code === 'ST-02').map((s) => s.level!);
      expect(levelsIn(st.subtitle, /L(\d+) sky garden/g), st.code).toEqual(gardens);
      expect(levelsIn(st.subtitle, /L(\d+) terrace/g), st.code).toEqual(terraces);
      const facadeTo = levelsIn(st.subtitle, /façades to L(\d+)/g);
      if (facadeTo.length) expect(facadeTo[0]).toBe(Math.max(...mine.filter((s) => s.code === 'FC-01').map((s) => s.level!)));
      // the frame range is the stage's own floors
      const [, a, b] = /^L(\d+)–L(\d+)/.exec(st.subtitle)!;
      const frames = mine.filter((s) => s.code === 'GL-01').map((s) => s.level!);
      expect([Number(a), Number(b)]).toEqual([Math.min(...frames), Math.max(...frames)]);
    }
  });
});

describe('every step lands before its stage ends', () => {
  function expectInside(p: Project) {
    for (const s of p.steps) {
      const st = p.stages[s.stage - 1];
      expect(s.t1, `${st.code} ${s.member}`).toBeLessThanOrEqual(st.end + 1e-9);
    }
    for (const x of p.parts) expect(x.t0 + x.dur).toBeLessThanOrEqual(p.stages[x.stage - 1].end + 1e-9);
  }

  it('on Arbor House', () => expectInside(arbor));

  it('on the Duplex', async () => {
    const model = await readIfc(readFileSync(join(here, '../public/samples/duplex-apartment.ifc.txt'), 'latin1'), () => {}, 'Duplex_A_20110907.ifc');
    expectInside(projectFromIfc(model, 'Duplex_A_20110907.ifc').project);
  });

  it('keeps the spacing of every step but the last of a stage', () => {
    let checked = 0;
    for (const st of arbor.stages.filter((x) => x.kind === 'assembly')) {
      const mine = arbor.steps.filter((s) => s.stage === st.n && s.partCount > 1);
      const interval = mine.length > 2 ? mine[1].t0 - mine[0].t0 : 0;
      // the parts of an ordinary step are spread over 1.6 intervals (at most 0.45 s)
      for (const s of mine.slice(0, -1)) {
        const parts = partsOf(arbor, s.index);
        const gap = arbor.steps[s.index + 1]?.t0 - s.t0;
        if (Math.abs(gap - interval) > 1e-9) continue;
        expect(parts[parts.length - 1].t0 - parts[0].t0).toBeCloseTo(Math.min(interval * 1.6, 0.45), 9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe('Arbor House public realm', () => {
  it('states the number of street trees and benches it places', () => {
    const s = arbor.steps.find((x) => x.code === 'PR-01')!;
    const parts = partsOf(arbor, s.index);
    const trunks = parts.filter((x) => x.mat === 'planting' && Math.abs(x.size[0] - 0.28) < 1e-9).length;
    const benches = parts.filter((x) => x.mat === 'glulam').length;
    const [, trees, seats] = /^(\d+) street trees · (\d+) glulam benches$/.exec(s.spec)!;
    expect(Number(trees)).toBe(trunks);
    expect(Number(seats)).toBe(benches);
    // no tree stands on the crane pad
    for (const x of parts.filter((q) => q.mat === 'planting')) expect(x.pos[0] < -18 && Math.abs(x.pos[2]) < 6).toBe(false);
  });
});

describe('the critical crane pick is chosen with the rigging, as the checks choose it', () => {
  // piece A: 9.49 t close in (10 m); piece B: 3.06 t far out (38 m). Without rigging A works the crane harder;
  // with 300 kg of rigging B does (and is over the chart)
  const crane = { id: 'TC-T', base: [-20, 0, 0] as [number, number, number], jib: 40, counterJib: 12, maxKg: 10000, tipKg: 1000, capacityAt: (r: number) => Math.min(10000, 10000 * Math.pow(15 / Math.max(r, 1), 1.2)), tieX: -10, mastStart: 20 };
  const box = (pos: number[], size: number[], mat = 'concrete') => ({ pos, size, quat: [0, 0, 0, 1], mat });
  const step = (member: string, method: string, parts: unknown[]) => ({ zone: 'Z', member, spec: '', code: 'X-01', method, motion: method === 'cast' ? 'pour' : 'lower', drop: 0, parts });
  const p = assembleProject({
    id: 'T-01', name: 'Test', subtitle: '', rev: '', revDate: '', storeys: 2, gifa: 100,
    levels: [{ code: 'L0', y: 0 }, { code: 'L1', y: 3 }], zones: [{ id: 'Z', label: 'Z', y0: 0, y1: 6 }],
    stages: [{ code: 'A', tick: 'A', title: 'A', zones: ['Z'], kind: 'assembly', sheet: 'A-1', subtitle: (n: number) => `${n}` }],
    defs: [
      step('L0 · SLAB', 'cast', [box([0, -0.1, 0], [40, 0.2, 6])]),
      step('L1 · PRECAST', 'crane', [box([-10, 0.25, 0], [3.875, 0.5, 2]), box([18, 0.125, 0], [2.5, 0.25, 2])]),
    ],
    crane, secondsPerStep: 0.2, meta: { tagline: '', caption: '', watermark: '', source: 'generator' },
    presentation: () => ({ cut: { normal: [1, 0, 0], at: 0, open: 0 }, keys: [], shots: [], log: [] }),
  } as unknown as Parameters<typeof assembleProject>[0]);
  const s = p.steps[1];
  const [a, b] = [s.partStart, s.partStart + 1];

  it('switches the critical piece when the rigging makes the far piece the worse one', async () => {
    // without rigging the close, heavy piece is critical, and riggedLift agrees with step.lift
    expect(s.lift!.radius).toBeCloseTo(10, 6);
    const bare = riggedLift(p, s.index, 0)!;
    expect(bare.part).toBe(a);
    expect(bare.pieceKg).toBeCloseTo(s.lift!.pieceKg, 6);
    expect(bare.util).toBeCloseTo(s.lift!.util, 9);
    // with 300 kg of rigging the far, light piece is critical and over the chart
    const rigged = riggedLift(p, s.index, 300)!;
    expect(rigged.part).toBe(b);
    expect(rigged.radius).toBeCloseTo(38, 6);
    const util = reviewedLift(rigged.pieceKg, rigged.capacityKg, 300).util;
    expect(util).toBeGreaterThan(1);
    expect(reviewedLift(s.lift!.pieceKg, s.lift!.capacityKg, 300).util).toBeLessThan(1);
    // and it is the pick the checks flag, at the same utilisation
    const r = await runChecks(p, { ...DEFAULT_SETTINGS, truck: [...DEFAULT_SETTINGS.truck], riggingKg: 300 }, undefined, false);
    const flag = r.issues.find((i) => i.rule === 'REACH-CRANE')!;
    expect(flag.severity).toBe('critical');
    expect(flag.primary).toEqual([b]);
    expect(flag.value!).toBeCloseTo(util, 9);
  });

  it('stops playback on that pick', () => {
    expect(firstOverPick(p, 0)).toBeNull();
    const over = firstOverPick(p, 300)!;
    expect(over.stepIndex).toBe(s.index);
    expect(over.part).toBe(b);
    expect(over.radius).toBeCloseTo(38, 6);
    expect(over.util).toBeGreaterThan(1);
    expect(over.kg).toBeCloseTo(over.pieceKg + 300, 6);
  });

  it('has no rigged pick for a step that is not a crane lift or a project without a tower crane', () => {
    expect(riggedLift(p, 0, 300)).toBeNull();
    expect(riggedLift({ ...p, crane: null }, s.index, 300)).toBeNull();
  });
});
