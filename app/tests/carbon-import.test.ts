import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildProject } from '../src/data/project';
import type { Project } from '../src/data/types';
import { readIfc } from '../src/ifc/model';
import { projectFromIfc } from '../src/ifc/sequence';
import { carbonFacts } from '../src/ui/header';
import { toastLife } from '../src/ui/layout';
import { defaultedSummary, defaultedText, endsEarly, ifcName, importError, loadedMessage } from '../src/ui/report';

const read = (rel: string, enc: BufferEncoding = 'utf8') => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), enc);
const CSS = read('../src/styles.css');
const HTML = read('../index.html');

// ── carbon in the status card, with its caveat ──────────────────────────────

describe('carbonFacts', () => {
  const p = buildProject();

  it('gives the indicative total, the intensity per m² GIA and the caveat', () => {
    const c = carbonFacts(p);
    expect(c.head).toMatch(/^INDICATIVE A1–A3$/);
    expect(c.unit).toBe('tCO₂e');
    expect(Number(c.main.replace(/ /g, ''))).toBe(Math.round(p.totalCarbonKg / 1000));
    expect(c.sub).toBe(`${Math.round(p.totalCarbonKg / p.gifa)} kg/m² GIA`);
    expect(c.label).toMatch(/generic factors/);
    expect(c.label).toMatch(/not from product EPDs/);
    expect(c.label).toMatch(/stored in timber/i);
    expect(c.label).not.toMatch(/assumed material/);
  });

  it('reads small builds in kg, one decimal under 10 t, and copes without a floor area', () => {
    expect(carbonFacts({ totalCarbonKg: 640, totalBiogenicKg: 0, gifa: 20 })).toMatchObject({ main: '640', unit: 'kgCO₂e', sub: '32 kg/m² GIA' });
    expect(carbonFacts({ totalCarbonKg: 6400, totalBiogenicKg: 0, gifa: 100 })).toMatchObject({ main: '6.4', unit: 'tCO₂e' });
    const none = carbonFacts({ totalCarbonKg: 134_200, totalBiogenicKg: 0, gifa: 0 });
    expect(none.sub).toBe('no floor area');
    expect(none.label).not.toMatch(/per m²/);
    expect(carbonFacts({ totalCarbonKg: 0, totalBiogenicKg: 0, gifa: 100 })).toMatchObject({ main: '—', unit: '', sub: 'no floor area' });
    expect(carbonFacts({ totalCarbonKg: 1000, totalBiogenicKg: 0, gifa: Number.NaN }).sub).toBe('no floor area');
  });

  it('says in view when the file ends early, and puts it in the caveat (R64)', () => {
    const c = carbonFacts(p, 0, false, true);
    expect(c.sub).toBe('file ends early: partial model');
    expect(c.label).toMatch(/The file ends early: partial model, so these figures cover only the elements that were read\./);
    expect(carbonFacts(p).label).not.toMatch(/ends early/);
    expect(carbonFacts(p).sub).toMatch(/kg\/m² GIA$/);
  });

  it('says how many elements have an assumed material', () => {
    expect(carbonFacts(p, 114).label).toMatch(/114 elements have an assumed material \(see Import\)/);
    expect(carbonFacts(p, 1).label).toMatch(/1 element has an assumed material/);
  });

  it('sits in the status card, and nothing hides its caveat line', () => {
    const status = HTML.slice(HTML.indexOf('<div class="status card">'), HTML.indexOf('</header>'));
    expect(status).toMatch(/id="statusCarbon"/);
    expect(status).toMatch(/id="carbonHead"/);
    expect(status).toMatch(/id="carbonSub"/);
    // the card gives up the icon, the stage count and the parts count as it narrows, never the carbon
    for (const m of CSS.matchAll(/@container status[^{]*\{([^}]*)\}/g)) expect(m[1]).not.toMatch(/status-carbon|carbon/);
    expect(CSS).toMatch(/\.status\s*\{[^}]*container: status \/ inline-size/);
  });
});

// ── the import report: assumed materials, loads and failures ────────────────

describe('defaultedSummary on the Duplex', () => {
  let project: Project;
  beforeAll(async () => {
    const model = await readIfc(read('../public/samples/duplex-apartment.ifc.txt', 'latin1'), () => {}, 'Duplex_A_20110907.ifc');
    project = projectFromIfc(model, 'Duplex_A_20110907.ifc').project;
  });

  it('finds every element the importer gave a default, with its parts and their share of mass and carbon', () => {
    const s = defaultedSummary(project)!;
    expect(s).not.toBeNull();
    expect(s.count).toBe(Number(project.report!.defaultedMaterials));
    expect(s.count).toBe((project.report!.defaultedElements as unknown[]).length);
    expect(s.of).toBe(project.parts.filter((p) => p.ref).length);
    // every part shown is one the importer flagged, and every flagged part is shown
    expect(s.parts.every((i) => project.parts[i].ref?.defaulted)).toBe(true);
    expect(s.parts.length).toBe(project.parts.filter((p) => p.ref?.defaulted).length);
    expect(s.massShare).toBeGreaterThan(0);
    expect(s.massShare).toBeLessThan(1);
    expect(s.carbonShare).toBeGreaterThan(0);
    expect(s.carbonShare).toBeLessThan(1);
    expect(s.byType.reduce((a, [, n]) => a + n, 0)).toBe(s.count);
    expect(s.byType[0][1]).toBeGreaterThanOrEqual(s.byType[s.byType.length - 1][1]);
  });

  it('words the warning as what happened, its effect and what to do', () => {
    const s = defaultedSummary(project)!;
    const t = defaultedText(s);
    expect(t.head).toBe(`${s.count} of ${s.of} elements have an assumed material (${Math.round((s.count / s.of) * 100)} %)`);
    expect(t.body).toMatch(new RegExp(`About ${Math.round(s.massShare * 100)} % of the mass and ${Math.round(s.carbonShare * 100)} % of the carbon`));
    expect(t.body).toMatch(/Assign materials in your BIM tool and export again/);
    expect(t.types).toMatch(/^Ifc[A-Za-z]+\u00a0×\u00a0\d+/);
    expect(t.types).not.toMatch(/IFC[A-Z]{3}/);
  });

  it('is null for a model whose materials all came from the file, and for the generated tower', () => {
    expect(defaultedSummary(buildProject())).toBeNull();
    const clean = { ...project, parts: project.parts.map((p) => (p.ref ? { ...p, ref: { ...p.ref, defaulted: undefined } } : p)), report: { ...project.report, defaultedMaterials: 0, defaultedElements: [] } };
    expect(defaultedSummary(clean)).toBeNull();
  });
});

describe('defaultedText for one element', () => {
  it('reads in the singular and never says 0 % for a sliver', () => {
    const t = defaultedText({ count: 1, of: 400, parts: [3], massShare: 0.001, carbonShare: 0.02, byType: [['IFCBEAM', 1]] });
    expect(t.head).toBe('1 of 400 elements have an assumed material (< 1 %)');
    expect(t.body).toMatch(/gives it no material .* so it was given a default/);
    expect(t.body).toMatch(/About < 1 % of the mass and 2 % of the carbon/);
    expect(t.types).toBe('IfcBeam\u00a0×\u00a01');
  });

  it('names the four commonest types and counts the rest', () => {
    const byType: [string, number][] = [['IfcWall', 9], ['IfcSlab', 5], ['IfcDoor', 4], ['IfcWindow', 3], ['IfcRailing', 2], ['IfcStair', 1]];
    expect(defaultedText({ count: 24, of: 50, parts: [], massShare: 0.5, carbonShare: 0.5, byType }).types).toBe('IfcWall × 9 · IfcSlab × 5 · IfcDoor × 4 · IfcWindow × 3 · 2 more types'.replace(/ × /g, '\u00a0×\u00a0'));
  });
});

describe('ifcName', () => {
  it('writes IFC classes as the schema does, and leaves what it cannot split', () => {
    expect(ifcName('IFCWALLSTANDARDCASE')).toBe('IfcWallStandardCase');
    expect(ifcName('IFCBUILDINGELEMENTPROXY')).toBe('IfcBuildingElementProxy');
    expect(ifcName('IFCSTAIRFLIGHT')).toBe('IfcStairFlight');
    expect(ifcName('IFCFURNISHINGELEMENT')).toBe('IfcFurnishingElement');
    expect(ifcName('IfcSlab')).toBe('IfcSlab');
  });

  it('writes geometry items in words too, and never leaves a class in capitals (O9)', () => {
    expect(ifcName('IFCADVANCEDBREP')).toBe('IfcAdvancedBrep');
    expect(ifcName('IFCADVANCEDBREPWITHVOIDS')).toBe('IfcAdvancedBrepWithVoids');
    expect(ifcName('IFCFACETEDBREP')).toBe('IfcFacetedBrep');
    expect(ifcName('IFCSWEPTDISKSOLID')).toBe('IfcSweptDiskSolid');
    expect(ifcName('IFCBOOLEANCLIPPINGRESULT')).toBe('IfcBooleanClippingResult');
    expect(ifcName('IFCPOLYGONALBOUNDEDHALFSPACE')).toBe('IfcPolygonalBoundedHalfSpace');
    expect(ifcName('IFCSHELLBASEDSURFACEMODEL')).toBe('IfcShellBasedSurfaceModel');
    expect(ifcName('IFCTRIANGULATEDFACESET')).toBe('IfcTriangulatedFaceSet');
    expect(ifcName('IFCEXTRUDEDAREASOLIDTAPERED')).toBe('IfcExtrudedAreaSolidTapered');
    expect(ifcName('IFCMAPPEDITEM')).toBe('IfcMappedItem');
    expect(ifcName('IFCCSGSOLID')).toBe('IfcCsgSolid');
    expect(ifcName('IFCOPENINGELEMENT')).toBe('IfcOpeningElement');
    // a word it does not know: one plain word rather than the schema's capitals
    expect(ifcName('IFCZZTOP')).toBe('IfcZztop');
  });

  it("is how the Import drawer's 'Not drawn' line names them", () => {
    const main = read('../src/main.ts');
    expect(main).toMatch(/Not drawn: \$\{skipped\.map\(\(\[k, v\]\) => `\$\{esc\(ifcName\(k\)\)\} × \$\{v\}`\)/);
  });
});

describe('loadedMessage', () => {
  it('warns, and stays, when the file was cut off', () => {
    const m = loadedMessage('a.ifc', 120, 1.23, { truncated: true, defaultedMaterials: 5 });
    expect(m.kind).toBe('warn');
    expect(m.text).toMatch(/^Loaded a\.ifc, but the file ends early, so elements are probably missing/);
    expect(toastLife(m.kind)).toBeNull();
  });

  it('mentions assumed materials, and nothing when every material came from the file', () => {
    expect(loadedMessage('a.ifc', 1215, 0.71, { defaultedMaterials: 114 })).toEqual({ text: 'Loaded a.ifc · 1 215 elements · 0.7 s · 114 with an assumed material (see Import)', kind: 'info' });
    expect(loadedMessage('a.ifc', 12, 2, { defaultedMaterials: 0 }).text).toBe('Loaded a.ifc · 12 elements · 2.0 s');
    expect(loadedMessage('a.ifc', 12, 2, undefined).kind).toBe('info');
  });
});

describe('endsEarly', () => {
  const whole = 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=IFCWALL($);\nENDSEC;\nEND-ISO-10303-21;\n';
  it('tells a whole file from a cut-off one', () => {
    expect(endsEarly(whole)).toBe(false);
    expect(endsEarly(`${whole}\n\n/* trailing comment */\n`)).toBe(false);
    expect(endsEarly(whole.slice(0, whole.indexOf('#1=') + 6))).toBe(true);
    expect(endsEarly('')).toBe(true);
  });
});

describe('importError', () => {
  const raw = /Error:|TypeError|undefined|HTTP \d|DATA section/;

  it('never puts the raw error in the message, and keeps it as the detail', () => {
    const cases: [unknown, Parameters<typeof importError>[2], boolean][] = [
      [new Error('Not an IFC file: no DATA section'), 'read', false],
      [new Error('No building elements with supported geometry were found in this file.'), 'read', false],
      [new TypeError("Cannot read properties of undefined (reading 'args')"), 'read', false],
      [new TypeError("Cannot read properties of undefined (reading 'args')"), 'read', true],
      [new RangeError('Invalid array length'), 'read', false],
      [new DOMException('The requested file could not be read', 'NotReadableError'), 'open', false],
      [new Error('HTTP 404'), 'sample', false],
      [new TypeError('Failed to fetch'), 'sample', false],
      ['a string thrown', 'read', false],
    ];
    for (const [err, stage, cut] of cases) {
      const e = importError('model.ifc', err, stage, cut);
      expect(e.message).not.toMatch(raw);
      expect(e.message).toMatch(/[.]$/);
      expect(e.detail.length).toBeGreaterThan(0);
    }
    expect(importError('m.ifc', new TypeError('x is undefined')).detail).toBe('TypeError: x is undefined');
  });

  it('says what happened and what to do for each kind of failure', () => {
    expect(importError('m.ifc', new Error('Not an IFC file: no DATA section')).message).toBe('m.ifc is not an IFC file: it has no IFC data in it. Export the model from your BIM tool as IFC (IFC2x3 or IFC4) and open that file.');
    expect(importError('m.ifc', new Error('No building elements with supported geometry were found in this file.')).message).toMatch(/^m\.ifc has no building elements that can be drawn\./);
    expect(importError('m.ifc', new RangeError('Invalid array length')).message).toMatch(/too large to read in this browser tab/);
    expect(importError('m.ifc', new Error('x'), 'open').message).toMatch(/could not be opened.*choose it again/);
    expect(importError('Duplex.ifc', new Error('HTTP 404'), 'sample').message).toBe('The Duplex sample could not be downloaded (the server answered 404). Check your connection and try again.');
    expect(importError('m.ifc', new TypeError('boom')).message).toMatch(/could not be read: .* export.* again/);
  });

  it('blames a cut-off file before the error it caused', () => {
    expect(importError('m.ifc', new TypeError('boom'), 'read', true).message).toMatch(/^m\.ifc ends early, so it looks cut off .* Download or export it again/);
    expect(importError('m.ifc', new Error('No building elements with supported geometry were found in this file.'), 'read', true).message).toMatch(/ends early/);
    // a file that is not IFC at all is that, cut off or not
    expect(importError('m.ifc', new Error('Not an IFC file: no DATA section'), 'read', true).message).toMatch(/is not an IFC file/);
  });
});

describe('the import drawer and the toast', () => {
  it('styles a warning toast and the report alerts', () => {
    expect(CSS).toMatch(/\.toast\.warn\s*\{[^}]*background: var\(--warn\)/);
    expect(CSS).toMatch(/\.report-alert\s*\{/);
    expect(toastLife('info')).toBe(4200);
    expect(toastLife('error')).toBeNull();
  });
});
