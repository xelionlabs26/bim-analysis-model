import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProject } from '../src/data/project';
import type { Project } from '../src/data/types';
import { Timeline } from '../src/engine/timeline';
import { readIfc } from '../src/ifc/model';
import { projectFromIfc } from '../src/ifc/sequence';

const here = dirname(fileURLToPath(import.meta.url));
const SLEW_LEAD = 0.09; // as in engine/timeline.ts
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

/** Largest change in the hook and in the pick ring across those instants, mast climbs aside. */
function worstJumps(p: Project) {
  const tl = new Timeline(p);
  let hook = 0;
  let ring = 0;
  for (const t of handovers(p, tl)) {
    const a = tl.stateAt(t - EPS).crane;
    const b = tl.stateAt(t + EPS).crane;
    if (!a.visible || !b.visible) continue;
    if (a.mastTop === b.mastTop) hook = Math.max(hook, Math.abs(b.hookY - a.hookY));
    if (a.pick && b.pick) ring = Math.max(ring, Math.abs(b.pick.radius - a.pick.radius));
  }
  return { hook, ring, tl };
}

describe('crane motion has no jumps where one lift hands over to the next', () => {
  it('keeps the hook and the pick ring continuous on Arbor House', () => {
    const p = buildProject();
    const { hook, ring, tl } = worstJumps(p);
    expect(hook).toBeLessThan(0.01);
    expect(ring).toBeLessThan(0.01);
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

  it('keeps the hook and the pick ring continuous on the Duplex', async () => {
    const model = await readIfc(readFileSync(join(here, '../public/samples/duplex-apartment.ifc.txt'), 'latin1'), () => {}, 'Duplex_A_20110907.ifc');
    const { hook, ring } = worstJumps(projectFromIfc(model, 'Duplex_A_20110907.ifc').project);
    expect(hook).toBeLessThan(0.01);
    expect(ring).toBeLessThan(0.01);
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

  it('eases the ring between two back-to-back crane lifts while the first one is still the active operation', () => {
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
    expect(mid.crane.pick!.radius).toBeGreaterThan(lo + 1);
    expect(mid.crane.pick!.radius).toBeLessThan(hi - 1);
    expect(tl.stateAt(next.t0 + 0.001).crane.pick!.radius).toBeCloseTo(next.lift!.radius, 1);
  });
});
