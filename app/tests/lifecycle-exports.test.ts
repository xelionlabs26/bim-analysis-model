/**
 * Regression tests for the export fixes: CSV cells that a spreadsheet would
 * read as formulas, the CSV step number, BCF topic GUIDs that survive a
 * changed threshold, and the sequence JSON written in IFC world coordinates.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assembleProject } from '../src/data/assemble';
import type { Crane, MaterialId, Part, Project, StepDef, Vec3 } from '../src/data/types';
import { runChecks } from '../src/checks/run';
import { DEFAULT_SETTINGS, type CheckReport, type CheckSettings, type Issue } from '../src/checks/types';
import { toIfc } from '../src/checks/view';
import { readIfc } from '../src/ifc/model';
import { projectFromIfc } from '../src/ifc/sequence';
import { bcfZip, topicGuid, topicGuids } from '../src/export/bcf';
import { csvCell, issuesCsv } from '../src/export/csv';
import { sequenceJson } from '../src/export/sequence';
import { unzip } from '../src/export/zip';

const here = dirname(fileURLToPath(import.meta.url));

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

const box = (pos: Vec3, size: Vec3, mat: MaterialId = 'concrete', ref?: Part['ref']): Part => ({ pos, size, quat: [0, 0, 0, 1], mat, ref });
const step = (member: string, method: StepDef['method'], parts: Part[]): StepDef => ({ zone: 'Z', member, spec: '', code: 'X-01', method, motion: method === 'cast' ? 'pour' : 'lower', drop: 0, parts });

function mk(defs: StepDef[], source: 'generator' | 'ifc' = 'generator'): Project {
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
    crane: CRANE,
    secondsPerStep: 0.2,
    meta: { tagline: '', caption: '', watermark: '', source },
    presentation: () => ({ cut: { normal: [1, 0, 0], at: 0, open: 0 }, keys: [], shots: [], log: [] }),
  });
}

const run = (p: Project, s: Partial<CheckSettings> = {}) => runChecks(p, { ...DEFAULT_SETTINGS, truck: [...DEFAULT_SETTINGS.truck], ...s }, undefined, false);

/** Parse one CSV line written by issuesCsv (quoted fields may hold commas). */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') out.push(cur), (cur = '');
    else cur += c;
  }
  out.push(cur);
  return out;
}

describe('CSV issue register', () => {
  it('keeps text that starts like a formula as text, and numbers as numbers', () => {
    expect(csvCell('=1+1 clashes with 3 walls')).toBe("'=1+1 clashes with 3 walls");
    expect(csvCell('+0.00 LEVEL 1 · SLABS')).toBe("'+0.00 LEVEL 1 · SLABS");
    expect(csvCell('-1 UG · WALLS')).toBe("'-1 UG · WALLS");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    // the apostrophe goes in before quoting, so a field with commas is still quoted whole
    expect(csvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
    expect(csvCell(-11.566)).toBe('-11.566');
    expect(csvCell('CLH-01')).toBe('CLH-01');
    expect(csvCell(undefined)).toBe('');
  });

  it('neutralises IFC names in Title, Detail, Elements and Member, and writes the step as a number', () => {
    const slabRef = { guid: '0123456789abcdefghijAB', ifcType: 'IFCSLAB', name: '=1+1', storey: '+0.00 Level 1', category: 'slab' };
    const p = mk([step('+0.00 LEVEL 1 · SLABS', 'cast', [box([0, -0.1, 4], [6, 0.2, 6], 'concrete', slabRef)]), step('+0.00 LEVEL 1 · WALLS', 'cast', [box([0, 1.5, 4], [0.2, 3, 6])])], 'ifc');
    const issue: Issue = {
      id: 'CLH-01',
      rule: 'CLASH-HARD',
      severity: 'major',
      title: '=1+1 clashes with 1 wall',
      detail: '=1+1 and the wall overlap by up to 50 mm.',
      action: 'Coordinate the two elements.',
      primary: [0],
      secondary: [1],
      step: 1,
      at: [1.5, 2, 4],
      box: [[0, 0, 0], [1, 1, 1]],
      lines: [],
      value: 0.05,
      limit: 0.01,
      unit: 'm',
    };
    const report: CheckReport = { issues: [issue], rules: [], settings: DEFAULT_SETTINGS, ms: 0 };
    const lines = issuesCsv(p, report, () => 1.25).replace(/^﻿/, '').trim().split('\r\n');
    const head = fields(lines[0]);
    const row = Object.fromEntries(fields(lines[1]).map((v, k) => [head[k], v]));
    expect(row.Title).toBe("'=1+1 clashes with 1 wall");
    expect(row.Detail.startsWith("'=1+1 and")).toBe(true);
    expect(row.Elements.startsWith("'=1+1")).toBe(true);
    expect(row.Member).toBe("'+0.00 LEVEL 1 · WALLS");
    // the step is "002" in the app, the BCF and the JSON: a spreadsheet keeps it only as the number 2
    expect(p.steps[1].id).toBe('002');
    expect(row['Step No.']).toBe('2');
    // IFC world: app z = 4 becomes IFC y = -4, still a bare number
    expect(row.Y).toBe('-4');
    expect(row.X).toBe('1.5');
  });
});

describe('BCF topic GUIDs', () => {
  // a 6 × 6 m bay and one heavy precast slab 20 m from the crane: the pick is near the chart
  const pickProject = () =>
    mk([
      step('L0 · GROUND SLAB', 'cast', [box([0, -0.1, 0], [6.4, 0.2, 6.4])]),
      step('L0 · WALLS', 'cast', [box([-3, 1.5, 0], [0.2, 3, 6]), box([3, 1.5, 0], [0.2, 3, 6])]),
      step('L1 · PRECAST SLAB', 'crane', [box([0, 3.1, 0], [6.4, 0.2, 2.1])]),
    ]);

  it('keep their GUID when a threshold changes the measured value in the title', async () => {
    const p = pickProject();
    const a = (await run(p)).issues.find((i) => i.rule === 'REACH-CRANE');
    const b = (await run(p, { riggingKg: 400 })).issues.find((i) => i.rule === 'REACH-CRANE');
    expect(a, 'the pick should need a lift plan review').toBeTruthy();
    expect(b).toBeTruthy();
    expect(b!.title).not.toBe(a!.title); // "at 87 % of the chart" moved
    expect(b!.primary).toEqual(a!.primary);
    expect(topicGuid(p, b!)).toBe(topicGuid(p, a!));
  });

  it('tell apart model-data issues that have no elements by their key', async () => {
    const p = mk([step('L0 · GROUND SLAB', 'cast', [box([0, -0.1, 0], [6.4, 0.2, 6.4])])], 'ifc');
    p.report = { skippedItems: { IFCADVANCEDBREP: 2 }, booleansApproximated: 3 };
    const md = (await run(p)).issues.filter((i) => i.rule === 'MODEL-DATA' && !i.primary.length);
    expect(md.map((i) => i.key).sort()).toEqual(['booleans-approximated', 'skipped-geometry']);
    expect(topicGuid(p, md[0])).not.toBe(topicGuid(p, md[1]));
    // the counts in their titles do not enter the GUID
    const more = { ...md[0], title: md[0].title.replace(/^\d+/, '99') };
    expect(topicGuid(p, more)).toBe(topicGuid(p, md[0]));
  });

  it('never put two topics in one folder', async () => {
    const p = pickProject();
    const r = await run(p);
    const twin = { ...r.issues[0], id: `${r.issues[0].id}-B` }; // same rule, key, step and elements
    const issues = [...r.issues, twin];
    const guids = topicGuids(p, issues);
    expect(new Set(guids.values()).size).toBe(issues.length);
    expect(guids.get(r.issues[0])).toBe(topicGuid(p, r.issues[0])); // the first keeps the plain GUID
    const files = unzip(bcfZip(p, { ...r, issues }));
    const dirs = [...files.keys()].filter((n) => n.endsWith('/markup.bcf')).map((n) => n.split('/')[0]);
    expect(new Set(dirs).size).toBe(issues.length);
    for (const d of dirs) {
      expect(new TextDecoder().decode(files.get(`${d}/markup.bcf`))).toContain(`<Topic Guid="${d}"`);
    }
  });
});

describe('sequence JSON', () => {
  it('writes step centroids and the crane base in IFC world coordinates, as the CSV and BCF do', async () => {
    const model = await readIfc(readFileSync(join(here, 'fixtures/pavilion-ifc4.ifc'), 'latin1'), () => {}, 'pavilion-ifc4.ifc');
    const p = projectFromIfc(model, 'pavilion-ifc4.ifc').project;
    const off = p.meta.ifcOffset!;
    expect(off).toBeTruthy();
    const json = JSON.parse(sequenceJson(p, null));
    expect(json.project.coordinates).toBe('IFC world, metres, Z up');
    const r3 = (v: Vec3) => v.map((x) => +x.toFixed(3));
    expect(json.crane.base).toEqual(r3(toIfc(p.crane!.base, off)));
    p.steps.forEach((s, k) => expect(json.steps[k].centroid).toEqual(r3(toIfc(s.centroid, off))));
    expect(json.checks).toMatch(/^unverified/);
  });

  it('labels a generated model and turns it Z up', () => {
    const p = mk([step('L0 · GROUND SLAB', 'cast', [box([1, -0.1, 2], [6.4, 0.2, 6.4])])]);
    const json = JSON.parse(sequenceJson(p, null));
    expect(json.project.coordinates).toBe('model axes, metres, Z up');
    expect(json.crane.base).toEqual([-20, 0, 0]);
    const c = p.steps[0].centroid;
    expect(json.steps[0].centroid).toEqual([+c[0].toFixed(3), +(-c[2]).toFixed(3), +c[1].toFixed(3)]);
  });
});
