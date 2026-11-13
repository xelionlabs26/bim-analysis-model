/**
 * How a project is lifted, and how the crane tells its story: no tower crane
 * for a low-rise import whose picks fit a mobile crane (and every consumer
 * coping without one), the first pick over the chart that stops playback,
 * the crane plan seen from above, and the reach giving way to other issues.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Color } from 'three';
import { buildProject } from '../src/data/project';
import { MOBILE_CRANE, mobilePick, planBox, reviewedLift, type Project } from '../src/data/types';
import { Timeline } from '../src/engine/timeline';
import { cranePlanPose, firstOverPick, OverPickWatch, PLAN_EL } from '../src/engine/lifts';
import { readIfc, type IfcModel } from '../src/ifc/model';
import { LOW_RISE_M, liftPlanFor, projectFromIfc } from '../src/ifc/sequence';
import { runChecks, ruleStatus } from '../src/checks/run';
import { DEFAULT_SETTINGS } from '../src/checks/types';
import { sequenceJson } from '../src/export/sequence';
import { issuesCsv } from '../src/export/csv';
import { bcfZip } from '../src/export/bcf';
import { CraneReach } from '../src/scene/reach';

const here = dirname(fileURLToPath(import.meta.url));
const colours = { ink: new Color('#111111'), muted: new Color('#777777'), ok: new Color('#4d7f45'), warn: new Color('#b7791f'), over: new Color('#b3261e') };
const readDuplex = () => readIfc(readFileSync(join(here, '../public/samples/duplex-apartment.ifc.txt'), 'latin1'), () => {}, 'Duplex_A_20110907.ifc');

/** The Duplex stretched upwards: the same plan and pieces, `k` times as tall. */
function stretched(model: IfcModel, k: number): IfcModel {
  const up = (e: IfcModel['elements'][number]) => {
    const positions = e.positions.slice();
    for (let i = 1; i < positions.length; i += 3) positions[i] *= k;
    const edges = e.edges.slice();
    for (let i = 1; i < edges.length; i += 3) edges[i] *= k;
    return { ...e, positions, edges, min: [e.min[0], e.min[1] * k, e.min[2]] as typeof e.min, max: [e.max[0], e.max[1] * k, e.max[2]] as typeof e.max };
  };
  return { ...model, elements: model.elements.map(up), site: model.site.map(up), storeys: model.storeys.map((s) => ({ ...s, elevation: s.elevation * k })) };
}

describe('tower crane or mobile crane', () => {
  const box = { x0: -10, x1: 10, z0: -5, z1: 5 };

  it('reads a mobile pick from beside the face nearest the piece', () => {
    expect(mobilePick(box, 9, 0, 1000).radius).toBeCloseTo(1 + MOBILE_CRANE.standoff, 9); // 1 m in from the east face
    expect(mobilePick(box, 0, 0, 1000).radius).toBeCloseTo(5 + MOBILE_CRANE.standoff, 9); // 5 m in from the north and south faces
    expect(mobilePick(box, 14, 0, 1000).radius).toBeCloseTo(MOBILE_CRANE.standoff, 9); // outside the footprint: right beside the crane
    // the chart falls with radius and stops at its reach
    expect(MOBILE_CRANE.capacityAt(6)).toBe(MOBILE_CRANE.maxKg);
    expect(MOBILE_CRANE.capacityAt(20)).toBeLessThan(MOBILE_CRANE.capacityAt(10));
    expect(mobilePick(box, 0, 0, 1000).util).toBeCloseTo(1000 / MOBILE_CRANE.capacityAt(9), 9);
    expect(MOBILE_CRANE.capacityAt(MOBILE_CRANE.reach + 1)).toBe(0);
  });

  it('gives a low-rise building with light picks no tower crane, and keeps one for a tall or heavy building', () => {
    const light = [{ x: 0, z: 0, kg: 700 }];
    const low = liftPlanFor(6.6, light, box);
    expect(low.tower).toBe(false);
    expect(low.reason).toMatch(/^mobile crane \/ by hand: 6\.6 m tall, heaviest pick 700 kg, at most \d+ % of an indicative mobile crane chart/);
    expect(liftPlanFor(6.6, [], box)).toMatchObject({ tower: false, heaviestKg: 0 });
    // tall: a tower crane whatever it lifts
    const tall = liftPlanFor(LOW_RISE_M + 0.5, light, box);
    expect(tall.tower).toBe(true);
    expect(tall.reason).toMatch(/12\.5 m tall/);
    // heavy: an 8 t precast unit in the middle of the plan is past a mobile crane's chart from the street
    const heavy = liftPlanFor(6.6, [...light, { x: 0, z: 0, kg: 8000 }], box);
    expect(heavy.tower).toBe(true);
    expect(heavy.mobileUtil).toBeGreaterThan(1);
    expect(heavy.reason).toMatch(/a pick of 8\.0 t needs \d+ % of a mobile crane's chart/);
  });
});

describe('the Duplex without a tower crane, through every consumer', () => {
  let p: Project;
  beforeAll(async () => {
    p = projectFromIfc(await readDuplex(), 'Duplex_A_20110907.ifc').project;
  });

  it('has no crane erected, struck or climbing, and no crane shot in the material pass', () => {
    expect(p.crane).toBeNull();
    expect(p.steps.some((s) => s.code === 'TC-02' || /TOWER CRANE/.test(s.member))).toBe(false);
    expect(p.presentation.shots.some((s) => /CRANE/.test(s.title))).toBe(false);
    const tl = new Timeline(p);
    expect(tl.events.filter((e) => e.kind === 'CRANE')).toEqual([]);
    expect(tl.events.some((e) => / TC-1 /.test(e.text))).toBe(false);
    expect(firstOverPick(p)).toBeNull();
  });

  it('checks its picks against a mobile crane, and flags one the mobile crane cannot take', async () => {
    const r = await runChecks(p, DEFAULT_SETTINGS, () => {}, false);
    const crane = r.rules.find((x) => x.id === 'REACH-CRANE')!;
    expect(ruleStatus(crane)).toBe('passed');
    expect(crane.checked).toBeGreaterThan(5);
    expect(crane.note).toMatch(/indicative mobile crane chart \(12 t to 6 m, 1\.5 t at 30 m\), set up beside the nearest face · no tower crane/);
    // eight tonnes of rigging puts every pick over a mobile crane's chart
    const heavy = await runChecks(p, { ...DEFAULT_SETTINGS, riggingKg: 8000 }, () => {}, false);
    const over = heavy.issues.filter((i) => i.rule === 'REACH-CRANE');
    expect(over.length).toBeGreaterThan(0);
    for (const i of over) {
      expect(i.title).toMatch(/of the mobile crane's chart|beyond the mobile crane's reach/);
      expect(i.detail).toMatch(/indicative mobile crane chart/);
      expect(i.detail).toMatch(/beside the nearest face/);
      expect(i.lines).toEqual([]); // no mast to draw a radius from
    }
  });

  it('exports JSON, CSV and BCF without a tower crane', async () => {
    const r = await runChecks(p, DEFAULT_SETTINGS, () => {}, false);
    const json = JSON.parse(sequenceJson(p, r));
    expect(json.lifting).toBe('mobile crane / by hand');
    expect(json.crane.kind).toBe('mobile');
    expect(json.steps.every((s: { lift: unknown }) => s.lift === null)).toBe(true);
    expect(issuesCsv(p, r, (k) => p.steps[k].t0).split('\n').length).toBeGreaterThan(r.issues.length);
    expect(bcfZip(p, r).length).toBeGreaterThan(1000);
  });
});

describe('a taller import keeps its tower crane', () => {
  let p: Project;
  beforeAll(async () => {
    // the Duplex three times as tall: about 20 m
    p = projectFromIfc(stretched(await readDuplex(), 3), 'tall.ifc').project;
  });

  it('erects the crane after the foundations and before the first lift', () => {
    expect(p.height).toBeGreaterThan(LOW_RISE_M);
    expect(p.crane).not.toBeNull();
    expect(p.crane!.assumed).toBe(true);
    expect(p.report!.lifting).toMatch(/^tower crane assumed: the building is \d+\.\d m tall/);
    const erect = p.steps.findIndex((s) => s.code === 'TC-02');
    const firstLift = p.steps.findIndex((s) => s.method === 'crane');
    expect(erect).toBeGreaterThan(0);
    expect(erect).toBeLessThan(firstLift);
  });

  it('keeps every crane pick inside the jib and under the chart, and draws them in green', () => {
    const lifts = p.steps.filter((s) => s.lift);
    expect(lifts.length).toBeGreaterThan(2);
    const tl = new Timeline(p);
    const reach = new CraneReach(p.crane!, colours);
    for (const s of lifts) {
      expect(s.lift!.radius).toBeLessThanOrEqual(p.crane!.jib);
      expect(s.lift!.util).toBeLessThan(1);
      reach.update(tl.stateAt(s.t0 + 0.01).crane, 0.85);
      expect(reach.level).toBe('ok');
      expect(reach.ring.scale.x).toBeLessThanOrEqual(p.crane!.jib);
    }
  });

  it('reads the assumed mast position as unverified clearance', async () => {
    const r = await runChecks(p, DEFAULT_SETTINGS, () => {}, false);
    const clear = r.rules.find((x) => x.id === 'CLASH-TEMP')!;
    expect(ruleStatus(clear)).toBe('unverified');
    expect(clear.note).toMatch(/assumed by the importer/);
    expect(r.rules.find((x) => x.id === 'REACH-CRANE')!.note).toMatch(/from a mast position the importer assumed/);
  });
});

describe('a low-rise import with a heavy pick keeps its tower crane', () => {
  it('puts a tower crane beside the pavilion for its 8.8 t first-floor slab', async () => {
    const model = await readIfc(readFileSync(join(here, 'fixtures/pavilion-ifc4.ifc'), 'latin1'), () => {}, 'pavilion-ifc4.ifc');
    const p = projectFromIfc(model, 'pavilion-ifc4.ifc').project;
    expect(p.height).toBeLessThan(LOW_RISE_M);
    expect(p.crane).not.toBeNull();
    expect(p.report!.lifting).toMatch(/^tower crane assumed: a pick of 8\.8 t needs \d+ % of a mobile crane's chart/);
    expect(p.steps.some((s) => s.code === 'TC-02')).toBe(true);
  });
});

describe('stopping on the first pick over the chart', () => {
  let p: Project;
  let tl: Timeline;
  beforeAll(() => {
    p = buildProject();
    tl = new Timeline(p);
  });

  it('finds the BMU gantry, and stops while it is the current lift on the hook', () => {
    const op = firstOverPick(p)!;
    const s = p.steps[op.stepIndex];
    expect(s.member).toBe('ROOF · BMU TRACK & GANTRY');
    expect(op.util).toBeGreaterThan(1);
    expect(op.util).toBeCloseTo(s.lift!.util, 12);
    expect(op.part).toBeGreaterThanOrEqual(s.partStart);
    expect(op.part).toBeLessThan(s.partStart + s.partCount);
    // no earlier pick is over the chart
    expect(p.steps.slice(0, op.stepIndex).every((x) => !x.lift || x.lift.util <= 1)).toBe(true);
    const st = tl.stateAt(op.t);
    expect(op.t).toBeGreaterThanOrEqual(s.t0);
    expect(op.t).toBeLessThanOrEqual(s.t1);
    expect(st.stepIndex).toBe(s.index);
    expect(st.crane.pick!.stepIndex).toBe(s.index);
    expect(st.crane.pick!.active).toBe(true);
    expect(st.crane.lifting).toBe(true);
  });

  it('reads the pick as the checks do: the rigging allowance can make an earlier pick the first over', () => {
    const rig = 1000;
    const op = firstOverPick(p, rig)!;
    const plain = firstOverPick(p)!;
    expect(op.stepIndex).toBeLessThan(plain.stepIndex);
    const l = p.steps[op.stepIndex].lift!;
    expect(op.kg).toBeCloseTo(l.pieceKg + rig, 9);
    expect(op.util).toBeCloseTo(reviewedLift(l.pieceKg, l.capacityKg, rig).util, 12);
  });

  it('stops once per playthrough, only when playback runs into it, and re-arms when the playhead goes back', () => {
    const op = firstOverPick(p)!;
    const w = new OverPickWatch(op);
    // a seek or a scrub past it while paused does not stop anything
    expect(w.advance(op.t - 1, op.t + 1, false)).toBeNull();
    // playing on from beyond it does not either
    expect(w.advance(op.t + 1, op.t + 1.05, true)).toBeNull();
    // back before it (a seek back) and playing through it: one stop
    expect(w.advance(op.t + 1, op.t - 2, false)).toBeNull();
    expect(w.advance(op.t - 0.05, op.t + 0.03, true)).toBe(op);
    expect(w.done).toBe(true);
    // paused on it (the stop seeks to it exactly), then played on: no second stop
    expect(w.advance(op.t, op.t, false)).toBeNull();
    expect(w.advance(op.t, op.t + 0.05, true)).toBeNull();
    // the loop back to the start re-arms it for the next playthrough
    expect(w.advance(p.duration - 0.01, 0, true)).toBeNull();
    expect(w.done).toBe(false);
    expect(w.advance(op.t - 0.01, op.t + 0.01, true)).toBe(op);
    // nothing to watch on a project without one
    expect(new OverPickWatch(null).advance(0, 1e6, true)).toBeNull();
  });
});

describe('the crane plan', () => {
  it('looks down on the whole slew circle, centred on the mast, in the clear part of the view', () => {
    const p = buildProject();
    const c = p.crane!;
    const pose = cranePlanPose(c, 1.6);
    expect(pose.target).toEqual([c.base[0], 0, c.base[2]]);
    expect(pose.el).toBe(PLAN_EL);
    expect(pose.az).toBe(0);
    // the circle's radius fits the shorter (vertical) half of the view with a little to spare
    const half = Math.tan(((pose.fov * Math.PI) / 180) / 2) * pose.dist;
    expect(half).toBeGreaterThan(c.jib);
    expect(half).toBeLessThan((c.jib + 4) * 1.1);
    // a view half covered by cards stands further back
    expect(cranePlanPose(c, 1.6, { w: 1, h: 0.5 }).dist).toBeCloseTo(pose.dist * 2, 6);
    // a nonsense aspect does not poison the camera
    expect(Number.isFinite(cranePlanPose(c, NaN).dist)).toBe(true);
  });

  it('emphasises the reach, or hides it while another issue is explained', () => {
    const p = buildProject();
    const tl = new Timeline(p);
    const reach = new CraneReach(p.crane!, colours);
    const s = p.steps.find((x) => x.member === 'ROOF · BMU TRACK & GANTRY')!;
    const state = tl.stateAt(s.t0 + 0.02).crane;
    const width = reach.ring.material.linewidth;
    reach.setMode('emph');
    reach.update(state, 0.85);
    expect(reach.group.visible).toBe(true);
    expect(reach.ring.material.linewidth).toBeCloseTo(width * 1.8, 9);
    expect(reach.ring.position.y).toBe(0); // on the ground in the plan
    reach.setMode('hidden');
    reach.update(state, 0.85);
    expect(reach.group.visible).toBe(false);
    reach.setMode('normal');
    reach.update(state, 0.85);
    expect(reach.group.visible).toBe(true);
    expect(reach.ring.material.linewidth).toBeCloseTo(width, 9);
    // otherwise the pick ring, its radial line and marker are drawn at the piece's own level, not 100 m below it on the ground
    expect(reach.group.position.y + reach.ring.position.y).toBeCloseTo(state.pick!.at[1], 9);
    expect(reach.group.position.y + reach.marker.position.y).toBeCloseTo(state.pick!.at[1], 9);
  });
});

describe('plan bounds', () => {
  it('spans the parts and survives an empty list', () => {
    expect(planBox([])).toEqual({ x0: 0, x1: 0, z0: 0, z1: 0 });
    const b = planBox([{ pos: [1, 0, 2], size: [2, 1, 4], quat: [0, 0, 0, 1], mat: 'concrete' }]);
    expect(b).toEqual({ x0: 0, x1: 2, z0: 0, z1: 4 });
  });
});
