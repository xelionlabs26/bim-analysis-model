/**
 * Regression tests for IFC import fixes: storey heights and site datums, Revit
 * parts, short models with no storeys, very large models, GIFA, full-height
 * openings, older IFC4 face sets, swept-disk directrices, placement cycles,
 * grid placements, type property sets, MEP non-elements and truncated files.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StepFile } from '../src/ifc/step';
import { categoryOf, readIfc, type IfcModel, type ImportedElement } from '../src/ifc/model';
import { projectFromIfc } from '../src/ifc/sequence';
import type { Project } from '../src/data/types';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), 'latin1');

const r = (n: number) => (Number.isInteger(n) ? `${n}.` : String(n));

/** A tiny IFC writer: entities are added bottom-up and referenced by the id `add` returns. */
class Ifc {
  private n = 100;
  readonly lines: string[] = [];
  add(body: string): number {
    const id = this.n++;
    this.lines.push(`#${id}=${body};`);
    return id;
  }
  /** The id the next `add` will return. */
  get next() {
    return this.n;
  }
  guid() {
    return `'${String(this.n).padStart(6, '0')}abcdefghijklmnop'`;
  }
  pt(x: number, y: number, z: number) {
    return this.add(`IFCCARTESIANPOINT((${r(x)},${r(y)},${r(z)}))`);
  }
  pt2(x: number, y: number) {
    return this.add(`IFCCARTESIANPOINT((${r(x)},${r(y)}))`);
  }
  ax(x: number, y: number, z: number) {
    return this.add(`IFCAXIS2PLACEMENT3D(#${this.pt(x, y, z)},$,$)`);
  }
  place(parent: number | null, x: number, y: number, z: number) {
    return this.add(`IFCLOCALPLACEMENT(${parent === null ? '$' : `#${parent}`},#${this.ax(x, y, z)})`);
  }
  /** A body: a w × d plan rectangle centred on (cx, cy), extruded up by h from z0. */
  box(w: number, d: number, h: number, cx = 0, cy = 0, z0 = 0) {
    const p2 = this.add(`IFCAXIS2PLACEMENT2D(#${this.pt2(cx, cy)},$)`);
    const prof = this.add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${p2},${r(w)},${r(d)})`);
    const dir = this.add('IFCDIRECTION((0.,0.,1.))');
    return this.shape('SweptSolid', this.add(`IFCEXTRUDEDAREASOLID(#${prof},#${this.ax(0, 0, z0)},#${dir},${r(h)})`));
  }
  shape(kind: string, ...items: number[]) {
    const rep = this.add(`IFCSHAPEREPRESENTATION(#2,'Body','${kind}',(${items.map((i) => `#${i}`).join(',')}))`);
    return this.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
  }
  el(type: string, name: string, placement: number, body: number | null, tail = ',$') {
    return this.add(`${type}(${this.guid()},$,'${name}',$,$,#${placement},${body === null ? '$' : `#${body}`}${tail})`);
  }
  building(placement: number) {
    return this.add(`IFCBUILDING(${this.guid()},$,'Test building',$,$,#${placement},$,$,.ELEMENT.,$,$,$)`);
  }
  storey(name: string, placement: number, elevation: number | null) {
    return this.add(`IFCBUILDINGSTOREY(${this.guid()},$,'${name}',$,$,#${placement},$,$,.ELEMENT.,${elevation === null ? '$' : r(elevation)})`);
  }
  contain(storey: number, els: number[]) {
    return this.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${this.guid()},$,$,$,(${els.map((e) => `#${e}`).join(',')}),#${storey})`);
  }
  aggregate(parent: number, kids: number[]) {
    return this.add(`IFCRELAGGREGATES(${this.guid()},$,$,$,#${parent},(${kids.map((e) => `#${e}`).join(',')}))`);
  }
  voids(host: number, opening: number) {
    return this.add(`IFCRELVOIDSELEMENT(${this.guid()},$,$,$,#${host},#${opening})`);
  }
  material(name: string, els: number[]) {
    const m = this.add(`IFCMATERIAL('${name}')`);
    return this.add(`IFCRELASSOCIATESMATERIAL(${this.guid()},$,$,$,(${els.map((e) => `#${e}`).join(',')}),#${m})`);
  }
  text(schema = 'IFC2X3') {
    const base = [
      "#1=IFCPROJECT('0YvctVUKr0kugbFTf53O9L',$,'Tiny',$,$,$,$,(#2),#3);",
      "#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#5,$);",
      '#3=IFCUNITASSIGNMENT((#4));',
      '#4=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);',
      '#5=IFCAXIS2PLACEMENT3D(#6,$,$);',
      '#6=IFCCARTESIANPOINT((0.,0.,0.));',
    ];
    return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('t.ifc','2026-11-13T10:00:00',(''),(''),'','','');\nFILE_SCHEMA(('${schema}'));\nENDSEC;\nDATA;\n${[...base, ...this.lines].join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
  }
}

const load = (x: Ifc | string, schema?: string) => readIfc(typeof x === 'string' ? x : x.text(schema), () => {}, 't.ifc');
const stepOf = (p: Project, guid: string) => p.steps.find((s) => p.parts.slice(s.partStart, s.partStart + s.partCount).some((q) => q.ref?.guid === guid))!;

/** A building at height `bz` with one 10 × 10 × 0.3 m slab per storey. */
function slabTower(bz: number, storeys: { name: string; local: number; elevation: number | null; slabZ?: number }[]) {
  const f = new Ifc();
  const bp = f.place(null, 0, 0, bz);
  const b = f.building(bp);
  const ids: number[] = [];
  for (const s of storeys) {
    const sp = f.place(bp, 0, 0, s.local);
    const st = f.storey(s.name, sp, s.elevation);
    ids.push(st);
    const slab = f.el('IFCSLAB', `Slab ${s.name}`, f.place(sp, 0, 0, s.slabZ ?? 0), f.box(10, 10, 0.3), ',$,.FLOOR.');
    f.contain(st, [slab]);
  }
  f.aggregate(b, ids);
  return f;
}

const slabBands = (m: IfcModel) => {
  const p = projectFromIfc(m, 't.ifc').project;
  return m.elements
    .slice()
    .sort((a, b) => a.min[1] - b.min[1])
    .map((e) => stepOf(p, e.guid).member.split(' · ')[0]);
};

describe('storey heights in the geometry frame', () => {
  it('lifts building-relative Elevation by the building placement (building at +10 m)', async () => {
    const m = await load(slabTower(10, [{ name: 'L0', local: 0, elevation: 0 }, { name: 'L1', local: 3, elevation: 3 }, { name: 'L2', local: 6, elevation: 6 }]));
    expect(m.storeys.map((s) => +s.elevation.toFixed(3))).toEqual([0, 3, 6]);
    expect(slabBands(m)).toEqual(['L0', 'L1', 'L2']);
  });

  it('reads the level from Elevation when every storey placement sits at its parent', async () => {
    const m = await load(slabTower(0, [{ name: 'L0', local: 0, elevation: 0, slabZ: 0 }, { name: 'L1', local: 0, elevation: 3, slabZ: 3 }, { name: 'L2', local: 0, elevation: 6, slabZ: 6 }]));
    expect(m.storeys.map((s) => +s.elevation.toFixed(3))).toEqual([0, 3, 6]);
    expect(slabBands(m)).toEqual(['L0', 'L1', 'L2']);
  });

  it('trusts the storey placements when Elevation is in another frame', async () => {
    // placements carry the levels (35, 38, 41); Elevation is relative to a project base point
    const m = await load(slabTower(0, [{ name: 'L0', local: 35, elevation: 0 }, { name: 'L1', local: 38, elevation: 3 }, { name: 'L2', local: 41, elevation: 6 }]));
    expect(m.storeys.map((s) => +s.elevation.toFixed(3))).toEqual([0, 3, 6]);
    expect(slabBands(m)).toEqual(['L0', 'L1', 'L2']);
  });

  for (const bz of [250, 520]) {
    it(`rebases a building placed at +${bz} m onto its ground storey`, async () => {
      const m = await load(slabTower(bz, [{ name: 'L0', local: 0, elevation: 0 }, { name: 'L1', local: 3, elevation: 3 }, { name: 'L2', local: 6, elevation: 6 }]));
      expect(m.storeys.map((s) => +s.elevation.toFixed(3))).toEqual([0, 3, 6]);
      expect(slabBands(m)).toEqual(['L0', 'L1', 'L2']);
    });
  }
});

describe('heights from a site datum', () => {
  it('brings a model at +35 m down to the ground plane and keeps the datum in the offset', async () => {
    const m = await load(slabTower(0, [{ name: 'L0', local: 35, elevation: 35 }, { name: 'L1', local: 38, elevation: 38 }, { name: 'L2', local: 41, elevation: 41 }]));
    const slab0 = m.elements.find((e) => e.name === 'Slab L0')!;
    expect(slab0.min[1]).toBeCloseTo(0, 6);
    expect(m.offset[1]).toBeCloseTo(-35, 6);
    expect(m.report.warnings.join(' ')).toMatch(/site datum: L0 is at \+35\.00 m/);
    const p = projectFromIfc(m, 't.ifc').project;
    expect(p.height).toBeCloseTo(6.3, 6);
  });

  it('takes the ground storey, not a basement, as the new zero', async () => {
    const m = await load(slabTower(0, [{ name: 'Basement', local: 31, elevation: 31 }, { name: 'Ground', local: 35, elevation: 35 }, { name: 'First', local: 38, elevation: 38 }]));
    expect(m.storeys.map((s) => [s.name, +s.elevation.toFixed(3)])).toEqual([['Basement', -4], ['Ground', 0], ['First', 3]]);
  });

  it('keeps a model whose basement and footings sit just below 0 on its own datum', async () => {
    const m = await load(slabTower(0, [{ name: 'B1', local: -3, elevation: -3 }, { name: 'L0', local: 0, elevation: 0 }]));
    expect(m.storeys.map((s) => +s.elevation.toFixed(3))).toEqual([-3, 0]);
    expect(m.offset[1]).toBe(-0);
  });

  it('imports the pavilion lifted by 35 m exactly as the pavilion on its own datum', async () => {
    const text = read('fixtures/pavilion-ifc4.ifc');
    const lifted = text.replace('#24=IFCCARTESIANPOINT((0.,0.,0.));', '#24=IFCCARTESIANPOINT((0.,0.,35000.));').replace(",$,$,$,0.);", ',$,$,$,35000.);').replace(',$,$,$,3200.);', ',$,$,$,38200.);');
    expect(lifted).not.toBe(text);
    const a = await load(text);
    const b = await load(lifted);
    expect(b.storeys.map((s) => [s.name, +s.elevation.toFixed(3)])).toEqual(a.storeys.map((s) => [s.name, +s.elevation.toFixed(3)]));
    const byGuid = new Map(a.elements.map((e) => [e.guid, e]));
    for (const e of b.elements) {
      const o = byGuid.get(e.guid)!;
      for (let k = 0; k < 3; k++) {
        expect(e.min[k]).toBeCloseTo(o.min[k], 4);
        expect(e.max[k]).toBeCloseTo(o.max[k], 4);
      }
    }
    const pa = projectFromIfc(a, 'a.ifc').project, pb = projectFromIfc(b, 'b.ifc').project;
    expect(pb.height).toBeCloseTo(pa.height, 4);
    expect(pb.crane!.mastStart).toBeCloseTo(pa.crane!.mastStart, 4);
    expect(pb.report!.lifting).toBe(pa.report!.lifting);
    expect(pb.levels.map((l) => +l.y.toFixed(3))).toEqual(pa.levels.map((l) => +l.y.toFixed(3)));
  });
});

describe('Revit parts', () => {
  /** A concrete wall drawn through two parts (each one leaf), a door opening in the host, and a slab on top. */
  async function partsModel() {
    const f = new Ifc();
    const sp = f.place(null, 0, 0, 0);
    const st = f.storey('L0', sp, 0);
    const wall = f.el('IFCWALLSTANDARDCASE', 'Basic Wall:Concrete 200', f.place(sp, 0, 0, 0), null);
    const p1 = f.el('IFCBUILDINGELEMENTPART', 'Part 1', f.place(sp, 0, 0, 0), f.box(5, 0.1, 3, 2.5, 0.05));
    const p2 = f.el('IFCBUILDINGELEMENTPART', 'Part 2', f.place(sp, 0, 0, 0), f.box(5, 0.1, 3, 2.5, 0.15));
    f.aggregate(wall, [p1, p2]);
    f.material('Concrete - Cast In Situ', [wall]);
    const door = f.el('IFCOPENINGELEMENT', 'Door opening', f.place(sp, 0, 0, 0), f.box(1, 0.6, 2.1, 2.5, 0.1));
    f.voids(wall, door);
    const slab = f.el('IFCSLAB', 'Slab', f.place(sp, 0, 0, 3), f.box(6, 6, 0.3, 2.5, 0.1), ',$,.FLOOR.');
    f.contain(st, [wall, slab]);
    return load(f);
  }

  it('builds the parts as the host wall: structure, cast, before the slab on top', async () => {
    const m = await partsModel();
    const parts = m.elements.filter((e) => e.type === 'IFCBUILDINGELEMENTPART');
    expect(parts.map((e) => e.category)).toEqual(['wall', 'wall']);
    expect(parts.every((e) => e.layers.some((l) => l.name === 'Concrete - Cast In Situ'))).toBe(true);
    const p = projectFromIfc(m, 't.ifc').project;
    const slab = m.elements.find((e) => e.name === 'Slab')!;
    for (const e of parts) {
      const s = stepOf(p, e.guid);
      expect(s.method).toBe('cast');
      expect(s.kind).toBe('frame');
      expect(s.index).toBeLessThan(stepOf(p, slab.guid).index);
    }
  });

  it('cuts the host wall opening through the parts and counts it once', async () => {
    const m = await partsModel();
    expect(m.report.openingsCut).toBe(1);
    expect(m.report.openingsSkipped).toBe(0);
    for (const e of m.elements.filter((x) => x.type === 'IFCBUILDINGELEMENTPART')) expect(e.volume).toBeCloseTo(0.1 * (5 * 3 - 1 * 2.1), 6);
  });
});

describe('models with no storeys', () => {
  it('sequences every element of a model under 1 m tall', async () => {
    const f = new Ifc();
    const o = f.place(null, 0, 0, 0);
    f.el('IFCSLAB', 'Slab', o, f.box(10, 10, 0.3), ',$,.BASESLAB.');
    f.el('IFCWALL', 'Kerb', o, f.box(10, 0.2, 0.3, 0, 5.2));
    const m = await load(f);
    const { project, bands } = projectFromIfc(m, 't.ifc');
    expect(bands).toEqual(['LEVEL 00']);
    expect(project.steps.length).toBeGreaterThan(0);
    expect(project.parts.length).toBe(m.elements.length);
  });
});

describe('very large models', () => {
  it('sequences 130 000 elements without overflowing the stack', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    const edges = new Float32Array(0);
    const elements: ImportedElement[] = [];
    for (let i = 0; i < 130_000; i++) {
      const x = (i % 400) * 0.5, z = Math.floor(i / 400) * 0.5;
      elements.push({ id: i + 1, guid: `g${i}`, type: 'IFCBUILDINGELEMENTPROXY', category: 'proxy', name: `P${i}`, objectType: '', predefined: '', storey: -1, parent: null, fills: null, layers: [], isExternal: null, loadBearing: null, positions, indices, edges, min: [x, 0, z], max: [x + 0.4, 0.4, z + 0.4], volume: 0.064, closed: true });
    }
    const report = { schema: 'IFC4', application: '', entities: 0, products: 0, meshed: 0, noGeometry: 0, byCategory: {}, itemTypes: {}, skippedItems: {}, openingsCut: 0, openingsSkipped: 0, openingsOutside: 0, openingsOutsideHosts: [], clipsApplied: 0, booleansApproximated: 0, lengthUnit: 'metre', truncated: false, warnings: [] };
    const model: IfcModel = { name: 'Big', projectName: '', projectGuid: '', parents: new Map(), storeys: [], elements, site: [], report, offset: [0, 0, 0] };
    const { project } = projectFromIfc(model, 'big.ifc');
    expect(project.parts.length).toBe(130_000);
  }, 60_000);
});

describe('full-height openings in walls', () => {
  const wallWithOpening = (z0: number, z1: number) => {
    const f = new Ifc();
    const o = f.place(null, 0, 0, 0);
    const wall = f.el('IFCWALLSTANDARDCASE', 'Wall', o, f.box(5, 0.2, 3, 2.5, 0));
    const op = f.el('IFCOPENINGELEMENT', 'Opening', o, f.box(1, 0.6, z1 - z0, 2.5, 0, z0));
    f.voids(wall, op);
    return load(f);
  };
  for (const [z0, z1] of [[1, 2], [0, 2.95], [0, 3], [-0.1, 3.1]]) {
    it(`cuts an opening from ${z0} to ${z1} m through a 3 m wall`, async () => {
      const m = await wallWithOpening(z0, z1);
      const h = Math.min(z1, 3) - Math.max(z0, 0);
      expect(m.report.openingsCut).toBe(1);
      expect(m.report.openingsSkipped).toBe(0);
      expect(m.elements[0].volume).toBeCloseTo(5 * 0.2 * 3 - 0.2 * 1 * h, 6);
    });
  }
});

describe('IFC4 (before ADD2) triangulated face sets', () => {
  it('ignores a NormalIndex list in the PnIndex slot', async () => {
    const f = new Ifc();
    const o = f.place(null, 0, 0, 0);
    const pts = f.add('IFCCARTESIANPOINTLIST3D(((0.,0.,0.),(1.,0.,0.),(0.,1.,0.),(0.,0.,1.)))');
    const fs = f.add(`IFCTRIANGULATEDFACESET(#${pts},$,.T.,((1,3,2),(1,2,4),(1,4,3),(2,3,4)),((1,1,1),(2,2,2),(1,2,1),(2,1,2)))`);
    f.el('IFCBUILDINGELEMENTPROXY', 'Tetra', o, f.shape('Tessellation', fs));
    const m = await load(f, 'IFC4');
    const e = m.elements[0];
    expect(e.closed).toBe(true);
    expect(e.volume).toBeCloseTo(1 / 6, 9);
    expect(e.max[0] - e.min[0]).toBeCloseTo(1, 9);
  });
});

describe('swept-disk directrices', () => {
  const rail = (segments: (f: Ifc) => string) => {
    const f = new Ifc();
    const o = f.place(null, 0, 0, 0);
    const curve = f.add(`IFCCOMPOSITECURVE((${segments(f)}),.F.)`);
    const disk = f.add(`IFCSWEPTDISKSOLID(#${curve},0.02,$,$,$)`);
    f.el('IFCRAILING', 'Handrail', o, f.shape('AdvancedSweptSolid', disk));
    return load(f);
  };
  const poly = (f: Ifc, ...pts: [number, number, number][]) => f.add(`IFCPOLYLINE((${pts.map((p) => `#${f.pt(...p)}`).join(',')}))`);
  const seg = (f: Ifc, curve: number, same = true) => `#${f.add(`IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,${same ? '.T.' : '.F.'},#${curve})`)}`;

  it('keeps an arc on a raised circle at its height', async () => {
    const m = await rail((f) => {
      const circle = f.add(`IFCCIRCLE(#${f.ax(1, 0.5, 1)},0.5)`);
      const arc = f.add(`IFCTRIMMEDCURVE(#${circle},(IFCPARAMETERVALUE(${-Math.PI / 2})),(IFCPARAMETERVALUE(0.)),.T.,.PARAMETER.)`);
      return [seg(f, poly(f, [0, 0, 1], [1, 0, 1])), seg(f, arc)].join(',');
    });
    const e = m.elements[0];
    expect(e.min[1]).toBeGreaterThan(0.98 - 1e-6);
    expect(e.max[1]).toBeLessThan(1.02 + 1e-6);
  });

  it('runs a SameSense .F. segment backwards instead of doubling back', async () => {
    // 1 m east, then 2 m north along a polyline drawn southwards
    const m = await rail((f) => [seg(f, poly(f, [0, 0, 1], [1, 0, 1])), seg(f, poly(f, [1, 2, 1], [1, 0, 1]), false)].join(','));
    // 3 m of a 40 mm square tube (not 5 m retracing the second leg)
    expect(m.elements[0].volume).toBeCloseTo(3 * 0.04 * 0.04, 6);
  });
});

describe('placements', () => {
  it('breaks a placement cycle instead of overflowing the stack', async () => {
    const f = new Ifc();
    const a = f.ax(1, 2, 0);
    const k = f.next;
    f.add(`IFCLOCALPLACEMENT(#${k + 1},#${a})`); // #k → #k+1 → #k
    f.add(`IFCLOCALPLACEMENT(#${k},#${a})`);
    f.el('IFCWALL', 'Wall', k, f.box(1, 1, 1));
    const m = await load(f);
    expect(m.elements.length).toBe(1);
    expect(m.report.warnings.join(' ')).toMatch(/loop/);
  });

  it('places an element on a grid intersection, with the grid offsets and its own placement', async () => {
    const f = new Ifc();
    const gp = f.place(null, 1, 2, 0);
    const axA = f.add(`IFCGRIDAXIS('A',#${f.add(`IFCPOLYLINE((#${f.pt2(5, -10)},#${f.pt2(5, 20)}))`)},.T.)`);
    const ax1 = f.add(`IFCGRIDAXIS('1',#${f.add(`IFCPOLYLINE((#${f.pt2(-10, 8)},#${f.pt2(20, 8)}))`)},.T.)`);
    f.add(`IFCGRID(${f.guid()},$,'Grid',$,$,#${gp},$,(#${axA}),(#${ax1}),$)`);
    const at = (dx: number, dy: number) => f.add(`IFCGRIDPLACEMENT(#${f.add(`IFCVIRTUALGRIDINTERSECTION((#${axA},#${ax1}),(${r(dx)},${r(dy)},0.))`)},$)`);
    f.el('IFCCOLUMN', 'On grid', at(0, 0), f.box(0.3, 0.3, 3));
    f.el('IFCCOLUMN', 'Reference', f.place(null, 6, 10, 0), f.box(0.3, 0.3, 3));
    // a positive offset lies to the left of each axis: A runs north, so 0.5 moves west; 1 runs east, so 1 moves north
    f.el('IFCCOLUMN', 'Offset', at(0.5, 1), f.box(0.3, 0.3, 3));
    f.el('IFCCOLUMN', 'Offset reference', f.place(null, 5.5, 11, 0), f.box(0.3, 0.3, 3));
    const m = await load(f);
    const get = (n: string) => m.elements.find((e) => e.name === n)!;
    for (const [a, b] of [['On grid', 'Reference'], ['Offset', 'Offset reference']])
      for (let k = 0; k < 3; k++) {
        expect(get(a).min[k]).toBeCloseTo(get(b).min[k], 9);
        expect(get(a).max[k]).toBeCloseTo(get(b).max[k], 9);
      }
    expect(m.report.warnings.join(' ')).not.toMatch(/placement/);
  });

  it('reports a placement type it cannot read', async () => {
    const f = new Ifc();
    f.el('IFCWALL', 'Wall', f.add('IFCLINEARPLACEMENT($,$,$)'), f.box(1, 1, 1));
    const m = await load(f, 'IFC4X3');
    expect(m.report.warnings.join(' ')).toMatch(/1 placement of type IfcLinearPlacement could not be read/);
  });
});

describe('property sets on types', () => {
  const typedWall = async (instancePset: string | null) => {
    const f = new Ifc();
    const o = f.place(null, 0, 0, 0);
    const wall = f.el('IFCWALL', 'Timber frame wall', o, f.box(5, 0.2, 3, 2.5, 0), ',$,.STANDARD.');
    const tps = f.add(`IFCPROPERTYSET(${f.guid()},$,'Pset_WallCommon',$,(#${f.add("IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$)")},#${f.add("IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(.F.),$)")}))`);
    const type = f.add(`IFCWALLTYPE(${f.guid()},$,'Timber frame',$,$,(#${tps}),$,$,$,.STANDARD.)`);
    f.add(`IFCRELDEFINESBYTYPE(${f.guid()},$,$,$,(#${wall}),#${type})`);
    f.material('Timber frame', [wall]);
    if (instancePset) {
      const ps = f.add(`IFCPROPERTYSET(${f.guid()},$,'Pset_WallCommon',$,(#${f.add(instancePset)}))`);
      f.add(`IFCRELDEFINESBYPROPERTIES(${f.guid()},$,$,$,(#${wall}),#${ps})`);
    }
    return load(f, 'IFC4');
  };

  it('reads IsExternal and LoadBearing from the type, and sequences the wall as envelope', async () => {
    const m = await typedWall(null);
    expect([m.elements[0].isExternal, m.elements[0].loadBearing]).toEqual([true, false]);
    const p = projectFromIfc(m, 't.ifc').project;
    expect(stepOf(p, m.elements[0].guid).member).toMatch(/EXTERNAL WALLS/);
  });

  it('lets the occurrence override the type field by field', async () => {
    const m = await typedWall("IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(.T.),$)");
    expect([m.elements[0].isExternal, m.elements[0].loadBearing]).toEqual([true, true]);
  });
});

describe('services entities that are not elements', () => {
  it('does not count types, ports, systems or property entities as products', async () => {
    for (const t of ['IFCPIPESEGMENTTYPE', 'IFCDUCTFITTINGTYPE', 'IFCDISTRIBUTIONPORT', 'IFCDISTRIBUTIONSYSTEM', 'IFCELECTRICALCIRCUIT', 'IFCELECTRICALBASEPROPERTIES']) expect(categoryOf(t), t).toBeNull();
    for (const t of ['IFCPIPESEGMENT', 'IFCFLOWSEGMENT', 'IFCDISTRIBUTIONCHAMBERELEMENT', 'IFCELECTRICDISTRIBUTIONPOINT']) expect(categoryOf(t), t).toBe('services');
    const f = new Ifc();
    const o = f.place(null, 0, 0, 0);
    const pipe = f.el('IFCPIPESEGMENT', 'Pipe', o, f.box(2, 0.1, 0.1), ',$,$,.RIGIDSEGMENT.');
    const type = f.add(`IFCPIPESEGMENTTYPE(${f.guid()},$,'Pipe type',$,$,$,$,$,$,.RIGIDSEGMENT.)`);
    f.add(`IFCRELDEFINESBYTYPE(${f.guid()},$,$,$,(#${pipe}),#${type})`);
    const ports = [f.el('IFCDISTRIBUTIONPORT', 'In', o, null, ',.SOURCE.,.PIPE.,.DRAINAGE.'), f.el('IFCDISTRIBUTIONPORT', 'Out', o, null, ',.SINK.,.PIPE.,.DRAINAGE.')];
    f.add(`IFCRELNESTS(${f.guid()},$,$,$,#${pipe},(${ports.map((p) => `#${p}`).join(',')}))`);
    f.add(`IFCDISTRIBUTIONSYSTEM(${f.guid()},$,'Drainage',$,$,$,.DRAINAGE.)`);
    const m = await load(f, 'IFC4');
    expect([m.report.products, m.report.meshed, m.report.noGeometry]).toEqual([1, 1, 0]);
  });
});

describe('truncated files', () => {
  it('reads a whole file as complete', () => {
    expect(StepFile.parse(read('fixtures/pavilion-ifc4.ifc')).truncated).toBe(false);
  });

  it('flags a file cut off part-way and drops the half-written instance', () => {
    const f = StepFile.parse("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCCARTESIANPOINT((0.,0.,0.));\n#2=IFCCARTESIANPOINT((1.,2.");
    expect(f.truncated).toBe(true);
    expect(f.has(1)).toBe(true);
    expect(f.has(2)).toBe(false);
  });

  it('puts a warning at the top of the import report', async () => {
    const text = read('fixtures/pavilion-ifc4.ifc');
    const cut = text.slice(0, text.indexOf('#547=') + 12);
    const m = await load(cut);
    expect(m.report.truncated).toBe(true);
    expect(m.report.warnings[0]).toMatch(/ends early/);
    expect((await load(text)).report.truncated).toBe(false);
  });
});
