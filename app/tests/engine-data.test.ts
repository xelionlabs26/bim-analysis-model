import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProject } from '../src/data/project';
import { CORE, EDGE, GIFA, GRID, SET_EDGE, STOREYS } from '../src/data/generator';
import type { Project } from '../src/data/types';
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
