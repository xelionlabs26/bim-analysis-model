import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Enum, Ref, StepFile, Typed, decodeStepString } from '../src/ifc/step';
import { readIfc, type IfcModel, type ImportedElement } from '../src/ifc/model';
import { classifyMaterial, projectFromIfc } from '../src/ifc/sequence';
import { Timeline } from '../src/engine/timeline';
import type { Project } from '../src/data/types';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), 'latin1');
/** IfcOpenShell's mesh per element; `oriented` = closed and consistently wound, so its volume is meaningful. */
type Ref3 = { type: string; min: number[]; max: number[]; volume: number; oriented: boolean };
const refOf = (p: string) => JSON.parse(read(p)).elements as Record<string, Ref3>;

/** Compare our elements with IfcOpenShell's (IFC metres, Z up) after our recentring. */
function compare(model: IfcModel, ref: Record<string, Ref3>) {
  const [ox, oy, oz] = model.offset;
  const mine = new Map(model.elements.map((e) => [e.guid, e]));
  const rows: { guid: string; type: string; bounds: number; vol: number; refVol: number; refValid: boolean; missing?: boolean }[] = [];
  for (const [guid, r] of Object.entries(ref)) {
    const e = mine.get(guid);
    if (!e) {
      rows.push({ guid, type: r.type, bounds: Infinity, vol: 0, refVol: r.volume, refValid: false, missing: true });
      continue;
    }
    const lo = [r.min[0] + ox, r.min[2] + oy, -r.max[1] + oz];
    const hi = [r.max[0] + ox, r.max[2] + oy, -r.min[1] + oz];
    const bounds = Math.max(...[0, 1, 2].map((k) => Math.max(Math.abs(lo[k] - e.min[k]), Math.abs(hi[k] - e.max[k]))));
    const box = (r.max[0] - r.min[0]) * (r.max[1] - r.min[1]) * (r.max[2] - r.min[2]);
    // a mesh volume only means something for a closed, consistently wound mesh inside its own box
    rows.push({ guid, type: r.type, bounds, vol: e.volume, refVol: r.volume, refValid: r.oriented && r.volume <= box * 1.001 });
  }
  return rows;
}

/** Area of the faces that look straight up (app axes: +Y up). */
function upwardArea(e: ImportedElement) {
  const P = e.positions, I = e.indices;
  let up = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l > 0 && ny / l > 0.999) up += l / 2;
  }
  return up;
}

/** A minimal IFC2x3 file holding one proxy element with the given representation items. */
function tinyIfc(items: string[], type: string) {
  const lines = [
    '#1=IFCPROJECT(\'0YvctVUKr0kugbFTf53O9L\',$,\'Tiny\',$,$,$,$,(#2),#3);',
    '#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,\'Model\',3,1.E-05,#5,$);',
    '#3=IFCUNITASSIGNMENT((#4));',
    '#4=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);',
    '#5=IFCAXIS2PLACEMENT3D(#6,$,$);',
    '#6=IFCCARTESIANPOINT((0.,0.,0.));',
    '#7=IFCLOCALPLACEMENT($,#5);',
    `#8=IFCBUILDINGELEMENTPROXY('1YvctVUKr0kugbFTf53O9L',$,'Block',$,$,#7,#9,$);`,
    '#9=IFCPRODUCTDEFINITIONSHAPE($,$,(#10));',
    `#10=IFCSHAPEREPRESENTATION(#2,'Body','${type}',(#100));`,
    ...items,
  ];
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('t.ifc','2026-11-05T10:00:00',(''),(''),'','','');\nFILE_SCHEMA(('IFC2X3'));\nENDSEC;\nDATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

/** STEP lines for an axis-aligned cube as a closed shell of polyloop faces, starting at entity `id`. */
function cubeShell(id: number, lo: number, hi: number, inward = false) {
  const out: string[] = [];
  const P = (x: number, y: number, z: number) => [x ? hi : lo, y ? hi : lo, z ? hi : lo];
  const corners = [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0), P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)];
  corners.forEach((c, i) => out.push(`#${id + 1 + i}=IFCCARTESIANPOINT((${c.map((v) => v.toFixed(3)).join(',')}));`));
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const faces: number[] = [];
  quads.forEach((q, i) => {
    const loop = id + 20 + i * 3;
    const order = inward ? q.slice().reverse() : q;
    out.push(`#${loop}=IFCPOLYLOOP((${order.map((k) => `#${id + 1 + k}`).join(',')}));`);
    out.push(`#${loop + 1}=IFCFACEOUTERBOUND(#${loop},.T.);`);
    out.push(`#${loop + 2}=IFCFACE((#${loop + 1}));`);
    faces.push(loop + 2);
  });
  out.push(`#${id}=IFCCLOSEDSHELL((${faces.map((f) => `#${f}`).join(',')}));`);
  return out;
}

describe('solids built from shells', () => {
  it('subtracts the inner shell of a faceted Brep with voids', async () => {
    const text = tinyIfc(['#100=IFCFACETEDBREPWITHVOIDS(#200,(#300));', ...cubeShell(200, 0, 2), ...cubeShell(300, 0.5, 1.5, true)], 'Brep');
    const m = await readIfc(text, () => {}, 't.ifc');
    const e = m.elements[0];
    expect(e.closed).toBe(true);
    expect(e.volume).toBeCloseTo(8 - 1, 9);
  });

  it('keeps a void a void however the exporter wound it', async () => {
    const text = tinyIfc(['#100=IFCFACETEDBREPWITHVOIDS(#200,(#300));', ...cubeShell(200, 0, 2, true), ...cubeShell(300, 0.5, 1.5)], 'Brep');
    const m = await readIfc(text, () => {}, 't.ifc');
    expect(m.elements[0].volume).toBeCloseTo(7, 9);
  });

  it('counts two separate items as two solids', async () => {
    const text = tinyIfc(['#100=IFCFACETEDBREP(#200);', '#101=IFCFACETEDBREP(#300);', ...cubeShell(200, 0, 1), ...cubeShell(300, 0, 1).map((l) => l.replace(/\(\(0\.000,/g, '((5.000,').replace(/\(\(1\.000,/g, '((6.000,'))], 'Brep').replace("'Brep',(#100)", "'Brep',(#100,#101)");
    const m = await readIfc(text, () => {}, 't.ifc');
    expect(m.elements[0].closed).toBe(true);
    expect(m.elements[0].volume).toBeCloseTo(2, 9);
  });
});

describe('STEP reader', () => {
  const text = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('x.ifc','2026-11-05T10:00:00',(''),(''),'Tool','Sys','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,-1.5E-01,2.));
#2=IFCWALL('2O2Fr$t4X7Zf8NOew3FLOH',$,'It''s a \\X2\\00E9\\X0\\cole \\X\\E9',*,.T.,#1,(#1,#2),IFCLABEL('typed'),(IFCPARAMETERVALUE(0.5),#1));
/* a comment with #3=IFCNOTREAL(); inside */
#4=(IFCCONVERSIONBASEDUNIT($,.LENGTHUNIT.,'FOOT',#1)IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.));
#5 = IFCDIRECTION ( ( 1. , 0. , 0. ) ) ;
ENDSEC;
END-ISO-10303-21;`;
  const f = StepFile.parse(text);

  it('reads the header', () => {
    expect(f.header.schema).toBe('IFC4');
    expect(f.header.originatingSystem).toBe('Tool');
  });

  it('indexes instances, skips comments and keeps complex instances aside', () => {
    expect(f.count).toBe(4);
    expect(f.has(3)).toBe(false);
    expect(f.complexIds).toEqual([4]);
    expect(f.typeOf(5)).toBe('IFCDIRECTION');
  });

  it('parses every value kind', () => {
    const p = f.get(1)!;
    expect(p.args[0]).toEqual([0, -0.15, 2]);
    const w = f.get(2)!.args;
    expect(w[2]).toBe("It's a école é");
    expect(w[1]).toBeNull();
    expect(w[3]).toBeUndefined();
    expect(w[4]).toEqual(new Enum('T'));
    expect(w[5]).toEqual(new Ref(1));
    expect(w[7]).toEqual(new Typed('IFCLABEL', 'typed'));
    expect(w[8]).toEqual([new Typed('IFCPARAMETERVALUE', 0.5), new Ref(1)]);
    expect(f.get(5)!.args[0]).toEqual([1, 0, 0]);
  });

  it('decodes ISO 10303-21 string escapes', () => {
    expect(decodeStepString('\\X2\\00C400D6\\X0\\')).toBe('ÄÖ');
    expect(decodeStepString('a\\\\b')).toBe('a\\b');
    expect(decodeStepString('\\S\\a')).toBe('á');
  });
});

describe('Duplex Apartment (Revit, IFC2x3) against IfcOpenShell', () => {
  let model: IfcModel;
  let ms = 0;
  beforeAll(async () => {
    const t0 = performance.now();
    model = await readIfc(read('../public/samples/duplex-apartment.ifc.txt'), () => {}, 'Duplex_A_20110907.ifc');
    ms = performance.now() - t0;
  });

  it('reads every element IfcOpenShell meshes, quickly', () => {
    const ref = refOf('fixtures/duplex.ifcopenshell.json');
    expect(model.elements.length).toBe(Object.keys(ref).length);
    expect(compare(model, ref).filter((r) => r.missing)).toEqual([]);
    expect(ms).toBeLessThan(5000);
  });

  it('places every element within 1 mm of IfcOpenShell', () => {
    const rows = compare(model, refOf('fixtures/duplex.ifcopenshell.json'));
    const off = rows.filter((r) => r.bounds > 0.001);
    expect(off).toEqual([]);
  });

  it('matches IfcOpenShell volumes within 2 % wherever its mesh is a closed solid', () => {
    const rows = compare(model, refOf('fixtures/duplex.ifcopenshell.json')).filter((r) => r.refValid);
    const off = rows.filter((r) => Math.abs(r.vol - r.refVol) > Math.max(0.02 * r.refVol, 1e-4));
    expect(rows.length).toBeGreaterThan(90);
    expect(off).toEqual([]);
  });

  it('measures the ceilings, whose surface models IfcOpenShell cannot close, as area × thickness', () => {
    // IfcOpenShell's meshes for these coverings are inconsistently wound (e.g. 4.09 m³ for a 3.25 m³ board)
    const ceilings = model.elements.filter((e) => e.type === 'IFCCOVERING');
    expect(ceilings.length).toBe(13);
    for (const e of ceilings) {
      expect(e.closed).toBe(true);
      expect(e.volume).toBeCloseTo(upwardArea(e) * (e.max[1] - e.min[1]), 6);
    }
  });

  it('cuts every opening that meets its host, including sinks across worktops, and applies every clip', () => {
    // 39 cut into their hosts, plus the 2 rooflight openings of the IfcRoof, which its slab already carries
    expect(model.report.openingsCut).toBe(41);
    expect(model.report.openingsSkipped).toBe(0);
    // Revit placed these clear of their hosts (one storey down, or mirrored): there is nothing to cut
    expect(model.report.openingsOutside).toBe(9);
    expect(model.report.clipsApplied).toBe(7);
    expect(model.report.booleansApproximated).toBe(0);
    expect(model.report.skippedItems).toEqual({});
    // the sink: a rounded 406 × 403 mm hole through the 40 mm top of a 3 m worktop
    const sink = model.elements.find((e) => e.name.endsWith(':162490'))!;
    expect(sink.closed).toBe(true);
    expect(sink.volume).toBeCloseTo(0.07434, 4);
  });

  it('reads storeys, units and layered materials', () => {
    expect(model.storeys.map((s) => [s.name, +s.elevation.toFixed(2)])).toEqual([['T/FDN', -1.25], ['Level 1', 0], ['Level 2', 3.1], ['Roof', 6]]);
    expect(model.report.lengthUnit).toBe('metre');
    const ext = model.elements.find((e) => e.name.includes('Exterior - Brick on Block'))!;
    expect(ext.layers.map((l) => l.name)).toContain('Masonry - Brick');
    expect(ext.isExternal).toBe(true);
  });

  it('produces closed solids for everything but fixtures, railings and two windows', () => {
    const open = new Set(model.elements.filter((e) => !e.closed).map((e) => e.type));
    expect([...open].sort()).toEqual(['IFCFURNISHINGELEMENT', 'IFCRAILING', 'IFCWINDOW']);
    expect(model.elements.filter((e) => e.closed).length).toBeGreaterThanOrEqual(165);
  });

  it('closes the surface-model party wall that IfcOpenShell measures at 123 m³, and measures it by hand', () => {
    // 16.966 × 0.55 × 2.9 m of CMU, less a 4.16 × 0.057 × 2.595 m recess on each face
    const wall = model.elements.find((e) => e.type === 'IFCWALL' && e.name.includes('Party Wall'))!;
    expect(wall.closed).toBe(true);
    expect(wall.volume).toBeCloseTo(16.966 * 0.55 * 2.9 - 2 * 4.16 * 0.057 * 2.595, 6);
  });
});

describe('IFC4 pavilion (generated with IfcOpenShell)', () => {
  let model: IfcModel;
  beforeAll(async () => {
    model = await readIfc(read('fixtures/pavilion-ifc4.ifc'), () => {}, 'pavilion-ifc4.ifc');
  });

  it('handles millimetre units and recentres georeferenced coordinates', () => {
    expect(model.report.schema).toBe('IFC4');
    expect(model.report.lengthUnit).toBe('millimetre');
    expect(model.report.warnings.join(' ')).toMatch(/georeferenced/);
    for (const e of model.elements) expect(Math.max(...e.max.map(Math.abs), ...e.min.map(Math.abs))).toBeLessThan(50);
  });

  it('meshes face sets, indexed poly curves, I and circle profiles, mapped and mirrored items', () => {
    expect(Object.keys(model.report.itemTypes)).toEqual(expect.arrayContaining(['IFCPOLYGONALFACESET', 'IFCTRIANGULATEDFACESET', 'IFCMAPPEDITEM', 'IFCBOOLEANCLIPPINGRESULT']));
    const rows = compare(model, refOf('fixtures/pavilion-ifc4.ifcopenshell.json'));
    expect(rows.filter((r) => r.missing)).toEqual([]);
    expect(rows.filter((r) => r.bounds > 0.001)).toEqual([]);
  });

  it('matches IfcOpenShell volumes, and is exact where IfcOpenShell over-counts', () => {
    const rows = compare(model, refOf('fixtures/pavilion-ifc4.ifcopenshell.json'));
    expect(rows.filter((x) => x.refValid).length).toBeGreaterThanOrEqual(10);
    for (const r of rows.filter((x) => x.refValid)) expect(Math.abs(r.vol - r.refVol)).toBeLessThanOrEqual(Math.max(0.02 * r.refVol, 1e-5));
    // a mullion is a 60 × 150 × 3000 mm box
    for (const e of model.elements.filter((x) => x.type === 'IFCMEMBER')) expect(e.volume).toBeCloseTo(0.027, 6);
    // the ground slab: 12 × 8 m plus the arc segment (r 7.5 m, 106.26°) minus a 2 × 2 m void, 250 mm deep
    const slab = model.elements.find((e) => e.name === 'Ground slab')!;
    const seg = 7.5 ** 2 / 2 * (2 * Math.atan2(6, 4.5) - Math.sin(2 * Math.atan2(6, 4.5)));
    expect(slab.volume).toBeCloseTo((96 + seg - 4) * 0.25, 1);
  });

  it('cuts the wall window and the slab shaft', () => {
    expect(model.report.openingsCut).toBe(2);
    expect(model.report.openingsSkipped).toBe(0);
  });
});

describe('material keywords', () => {
  it('maps real BIM material names', () => {
    expect(classifyMaterial('Masonry - Concrete Block')).toBe('masonry');
    expect(classifyMaterial('Concrete - Cast In Situ')).toBe('concrete');
    expect(classifyMaterial('Metal - Steel - 345 MPa')).toBe('steel');
    expect(classifyMaterial('Wood - Dimensional Lumber')).toBe('timber');
    expect(classifyMaterial('CLT 5-ply')).toBe('clt');
    expect(classifyMaterial('Insulation / Thermal Barriers - Rigid insulation')).toBe('insulation');
    expect(classifyMaterial('Roofing - EPDM Membrane')).toBe('membrane');
    expect(classifyMaterial('Misc. Air Layers - Air Space')).toBeNull();
    expect(classifyMaterial('Unobtainium')).toBeUndefined();
  });

  it('settles names that mention two materials', () => {
    const cases: [string, string | null][] = [
      ['Glass wool insulation', 'insulation'],
      ['Insulation - Glass Wool', 'insulation'],
      ['Fibreglass batt', 'insulation'],
      ['Glass fibre reinforced concrete', 'concrete'],
      ['Cavity insulation', 'insulation'],
      ['Cavity fill - mineral fibre', 'insulation'],
      ['Steel joist', 'steel'],
      ['Open web steel joist', 'steel'],
      ['Gypsum sheathing board', 'gypsum'],
      ['Concrete without reinforcement', 'concrete'],
      ['Brick without mortar', 'masonry'],
      ['Aluminium-faced PIR insulation', 'insulation'],
      // and what must not move
      ['Insulated glass unit', 'glass'],
      ['Thermally broken aluminium', 'aluminium'],
      ['Air barrier membrane', 'membrane'],
      ['Misc. Air Layers - Air Space', null],
      ['Cavity', null],
      ['Wood - Dimensional Lumber', 'timber'],
      ['Floor joist', 'timber'],
      ['Wood - Sheathing - plywood', 'timber'],
    ];
    for (const [name, mat] of cases) expect(classifyMaterial(name), name).toBe(mat);
  });
});

describe('build order for the imported Duplex', () => {
  let model: IfcModel;
  let project: Project;
  let order: Map<string, number>; // guid → step index
  let byGuid: Map<string, ImportedElement>;
  beforeAll(async () => {
    model = await readIfc(read('../public/samples/duplex-apartment.ifc.txt'), () => {}, 'Duplex_A_20110907.ifc');
    project = projectFromIfc(model, 'Duplex_A_20110907.ifc').project;
    order = new Map();
    for (const s of project.steps) for (const p of project.parts.slice(s.partStart, s.partStart + s.partCount)) order.set(p.ref!.guid, s.index);
    byGuid = new Map(model.elements.map((e) => [e.guid, e]));
  });

  it('sequences every element exactly once', () => {
    expect(order.size).toBe(model.elements.length);
    expect(project.parts.length).toBe(model.elements.length);
  });

  it('starts with the foundations and puts up no tower crane for a two-storey house', () => {
    expect(project.steps[0].code.startsWith('FD')).toBe(true);
    // under 12 m with light picks: lifted by mobile crane and by hand (the tower-crane path is in crane-lifting.test.ts)
    expect(project.crane).toBeNull();
    expect(project.steps.some((s) => s.code === 'TC-02')).toBe(false);
    expect(project.report!.lifting).toMatch(/^mobile crane \/ by hand/);
  });

  it('builds every wall and column before the slab, beam or roof that bears on it', () => {
    const horizontals = model.elements.filter((e) => (e.category === 'slab' || e.category === 'beam' || e.category === 'roof') && e.max[1] - e.min[1] >= 0.06);
    let checked = 0;
    for (const w of model.elements.filter((e) => e.category === 'wall' || e.category === 'column')) {
      for (const h of horizontals) {
        if (Math.abs(h.min[1] - w.max[1]) > 0.35) continue;
        if (h.max[0] < w.min[0] - 0.05 || h.min[0] > w.max[0] + 0.05 || h.max[2] < w.min[2] - 0.05 || h.min[2] > w.max[2] + 0.05) continue;
        const heavy = /masonry|concrete|brick|block|cmu/i.test(w.layers.map((l) => l.name).join(' ') + w.name);
        if (!heavy) continue; // partitions under a slab are fitted later and carry nothing
        expect(order.get(w.guid)!, `${w.name} before ${h.name}`).toBeLessThan(order.get(h.guid)!);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('fits windows and doors after the wall they sit in', () => {
    let checked = 0;
    for (const e of model.elements) {
      if (e.fills === null) continue;
      const host = model.elements.find((x) => x.id === e.fills);
      if (!host) continue;
      expect(order.get(e.guid)!, e.name).toBeGreaterThan(order.get(host.guid)!);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('still lifts its steel by crane, but reads no tower-crane chart for it', () => {
    const picks = project.steps.filter((s) => s.method === 'crane' && s.partCount > 0);
    expect(picks.length).toBeGreaterThan(2);
    for (const s of picks) expect(s.lift).toBeNull();
  });

  it('measures the floor area from the floor slabs only (no finishes, roof or patios)', () => {
    // two 127 mm slabs on grade (≈ 64.8 m² each) and two wood joist floors (≈ 59.2 m² each)
    expect(project.gifa).toBeGreaterThan(230);
    expect(project.gifa).toBeLessThan(270);
  });

  it('lists the elements whose material was defaulted', () => {
    const r = projectFromIfc(model, 'Duplex_A_20110907.ifc');
    const list = project.report!.defaultedElements as { guid: string; name: string; ifcType: string }[];
    expect(list.length).toBe(r.defaultedMaterials);
    expect(r.defaultedElements.length).toBe(r.defaultedMaterials);
    expect(list.length).toBeGreaterThan(0);
    const flagged = new Set(project.parts.filter((p) => p.ref?.defaulted).map((p) => p.ref!.guid));
    expect(new Set(list.map((d) => d.guid))).toEqual(flagged);
    for (const d of list) expect(byGuid.has(d.guid)).toBe(true);
  });

  it('gives plausible totals and a full schedule', () => {
    const intensity = project.totalCarbonKg / project.gifa;
    expect(intensity).toBeGreaterThan(100);
    expect(intensity).toBeLessThan(800);
    expect(project.totalMassKg / 1000).toBeGreaterThan(200);
    expect(project.totalMassKg / 1000).toBeLessThan(1000);
    expect(project.stages.map((s) => s.kind).slice(-2)).toEqual(['material', 'section']);
    const tl = new Timeline(project);
    expect(tl.stateAt(project.duration).stepsDone).toBe(project.steps.length);
    expect(byGuid.size).toBe(model.elements.length);
  });
});
