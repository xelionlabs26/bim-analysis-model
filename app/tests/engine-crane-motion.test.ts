import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProject } from '../src/data/project';
import type { Project } from '../src/data/types';
import { SLEW_LEAD, Timeline } from '../src/engine/timeline';
import { readIfc } from '../src/ifc/model';
import { projectFromIfc } from '../src/ifc/sequence';
import { CraneReach } from '../src/scene/reach';
import { Color } from 'three';

const here = dirname(fileURLToPath(import.meta.url));
const EPS = 1e-6;

/** Every instant the crane can hand over: each lift's start, the start of the slew to it, and each step start. */
function handovers(p: Project, tl: Timeline): number[] {
  const out: number[] = [];
  for (const s of p.steps) {
    out.push(s.t0);
    if (s.method === 'crane' && s.partCount > 0) out.push(s.t0 - SLEW_LEAD);
  }
  return out.filter((t) => t > tl.erectT + EPS && t < tl.presentation.strikeT - EPS);
}

/**
 * Across those instants: the largest change in the hook (mast climbs aside), and
 * in the pick ring while the pick stays the same one. The ring stands at its
 * pick's own radius, so it moves only when the pick changes.
 */
function worstJumps(p: Project) {
  const tl = new Timeline(p);
  const base = p.crane?.base ?? [0, 0, 0];
  let hook = 0;
  let ring = 0;
  let offPick = 0;
  let visible = 0;
  let picks = 0;
  for (const t of handovers(p, tl)) {
    const a = tl.stateAt(t - EPS).crane;
    const b = tl.stateAt(t + EPS).crane;
    if (!a.visible || !b.visible) continue;
    visible++;
    if (a.mastTop === b.mastTop) hook = Math.max(hook, Math.abs(b.hookY - a.hookY));
    for (const c of [a, b]) {
      if (!c.pick) continue;
      picks++;
      offPick = Math.max(offPick, Math.abs(c.pick.radius - Math.hypot(c.pick.at[0] - base[0], c.pick.at[2] - base[2])));
    }
    if (a.pick && b.pick && a.pick.stepIndex === b.pick.stepIndex) ring = Math.max(ring, Math.abs(b.pick.radius - a.pick.radius));
  }
  return { hook, ring, offPick, visible, picks, tl };
}

describe('crane motion has no jumps where one lift hands over to the next', () => {
  it('keeps the hook and the pick ring continuous on Arbor House', () => {
    const p = buildProject();
    const { hook, ring, offPick, visible, picks, tl } = worstJumps(p);
    expect(visible).toBeGreaterThan(50);
    expect(picks).toBeGreaterThan(50);
    expect(hook).toBeLessThan(0.01);
    expect(ring).toBeLessThan(0.01);
    expect(offPick).toBeLessThan(1e-9);
    // and frame by frame the hook only ever moves, it never teleports (it used to snap by up to 26 m)
    let prev = tl.stateAt(tl.erectT).crane;
    let worst = 0;
    for (let t = tl.erectT + 1 / 240; t < tl.presentation.strikeT; t += 1 / 240) {
      const c = tl.stateAt(t).crane;
      if (c.mastTop === prev.mastTop) worst = Math.max(worst, Math.abs(c.hookY - prev.hookY));
      prev = c;
    }
    expect(worst).toBeLessThan(5);
  });

  it('keeps the hook and the pick ring continuous on an imported model with a tower crane', async () => {
    // the Duplex is low-rise and has no tower crane, so the IFC case runs on the pavilion, which has one
    const model = await readIfc(readFileSync(join(here, 'fixtures/pavilion-ifc4.ifc'), 'latin1'), () => {}, 'pavilion-ifc4.ifc');
    const p = projectFromIfc(model, 'pavilion-ifc4.ifc').project;
    expect(p.crane).toBeTruthy();
    const { hook, ring, offPick, visible, picks } = worstJumps(p);
    expect(visible).toBeGreaterThan(0);
    expect(picks).toBeGreaterThan(0);
    expect(hook).toBeLessThan(0.01);
    expect(ring).toBeLessThan(0.01);
    expect(offPick).toBeLessThan(1e-9);
  });

  it('starts a lift with the hook at the head and lowers it towards the piece', () => {
    const p = buildProject();
    const tl = new Timeline(p);
    const lift = p.steps.find((s) => s.member === 'ROOF · BMU TRACK & GANTRY')!;
    const at0 = tl.stateAt(lift.t0).crane;
    expect(at0.hookY).toBeCloseTo(at0.mastTop - 5, 6);
    const lowering = tl.stateAt(lift.t0 + 0.05).crane;
    expect(lowering.lifting).toBe(true);
    expect(lowering.hookY).toBeLessThan(at0.hookY - 1);
    expect(lowering.hookY).toBeGreaterThan(lift.top + 1.2);
  });

  it('keeps the ring at the active pick\'s own radius while the jib slews to the next one', () => {
    const p = buildProject();
    const tl = new Timeline(p);
    // two crane lifts in a row with a large change of radius: BMU (≈ 27 m) to the roof trees (≈ 39 m)
    const bmu = p.steps.find((s) => s.member === 'ROOF · BMU TRACK & GANTRY')!;
    const next = p.steps[bmu.index + 1];
    expect(next.method).toBe('crane');
    const mid = tl.stateAt(next.t0 - SLEW_LEAD / 2);
    expect(mid.stepIndex).toBe(bmu.index);
    expect(mid.crane.pick!.stepIndex).toBe(bmu.index);
    const lo = Math.min(bmu.lift!.radius, next.lift!.radius);
    const hi = Math.max(bmu.lift!.radius, next.lift!.radius);
    expect(hi - lo).toBeGreaterThan(5);
    // the trolley is part-way through its travel to the next pick; the ring (and its label) stay on the BMU pick
    const from = tl.stateAt(next.t0 - SLEW_LEAD - 1e-4).crane.radius;
    const to = tl.stateAt(next.t0).crane.radius;
    expect(Math.abs(to - from)).toBeGreaterThan(0.5);
    expect(mid.crane.radius).toBeGreaterThan(Math.min(from, to) + 0.1);
    expect(mid.crane.radius).toBeLessThan(Math.max(from, to) - 0.1);
    const c = p.crane!;
    const trueR = Math.hypot(bmu.lift!.at[0] - c.base[0], bmu.lift!.at[2] - c.base[2]);
    expect(mid.crane.pick!.radius).toBeCloseTo(trueR, 9);
    expect(mid.crane.pick!.radius).toBeCloseTo(bmu.lift!.radius, 9);
    expect(tl.stateAt(next.t0 + 0.001).crane.pick!.radius).toBeCloseTo(next.lift!.radius, 9);
  });

  it('draws the pick ring, its line and its marker at the true radius at a mid-step time on Arbor House', () => {
    const p = buildProject();
    const tl = new Timeline(p);
    const c = p.crane!;
    // the reviewer's paused frame: the ring was drawn at 34.9 m while the label read R 41.4 m
    const s = tl.stateAt(13.248).crane;
    expect(s.pick).toBeTruthy();
    const trueR = Math.hypot(s.pick!.at[0] - c.base[0], s.pick!.at[2] - c.base[2]);
    const reach = new CraneReach(c, { ink: new Color('#111'), muted: new Color('#777'), ok: new Color('#4d7f45'), warn: new Color('#b7791f'), over: new Color('#b3261e') });
    reach.update(s, 0.85, 0);
    expect(reach.ring.visible).toBe(true);
    expect(reach.ring.scale.x).toBeCloseTo(trueR, 9);
    expect(reach.ring.scale.z).toBeCloseTo(trueR, 9);
    expect(reach.radial.scale.x).toBeCloseTo(trueR, 9);
    expect(Math.hypot(reach.marker.position.x, reach.marker.position.z)).toBeCloseTo(trueR, 9);
    // even if a pick arrives with a stale radius, the overlay draws at the piece
    reach.update({ ...s, pick: { ...s.pick!, radius: trueR - 6 } }, 0.85, 0);
    expect(reach.ring.scale.x).toBeCloseTo(trueR, 9);
    reach.dispose();
  });
});
