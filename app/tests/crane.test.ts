import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Color } from 'three';
import { buildProject } from '../src/data/project';
import { chartKnee, liftLevel, reviewedLift, type Project } from '../src/data/types';
import { Timeline } from '../src/engine/timeline';
import { CraneReach } from '../src/scene/reach';
import { liftText } from '../src/ui/panels';
import { placeOnRing, turn, type Obstacle, type RingPoint } from '../src/ui/place';
import { readIfc } from '../src/ifc/model';
import { projectFromIfc } from '../src/ifc/sequence';

const here = dirname(fileURLToPath(import.meta.url));
const colours = { ink: new Color('#111111'), muted: new Color('#777777'), ok: new Color('#4d7f45'), warn: new Color('#b7791f'), over: new Color('#b3261e') };

describe('lift levels and the load chart', () => {
  it('reads a pick as within the chart, at review level, or over it — one threshold everywhere', () => {
    expect(liftLevel(0.5)).toBe('ok');
    expect(liftLevel(0.84)).toBe('ok');
    expect(liftLevel(0.85)).toBe('warn');
    expect(liftLevel(1)).toBe('warn');
    expect(liftLevel(1.01)).toBe('over');
    expect(liftLevel(0.82, 0.8)).toBe('warn');
  });

  it('finds where full capacity ends on the chart', () => {
    const arbor = buildProject();
    expect(chartKnee(arbor.crane!)).toBeCloseTo(20, 3); // 12 t to 20 m
  });
});

describe('crane reach on Arbor House', () => {
  let p: Project;
  let tl: Timeline;
  beforeAll(() => {
    p = buildProject();
    tl = new Timeline(p);
  });
  const bmu = () => p.steps.find((s) => s.member === 'ROOF · BMU TRACK & GANTRY')!;

  it('remembers where each lift\'s critical piece is', () => {
    const s = bmu();
    const pieces = p.parts.slice(s.partStart, s.partStart + s.partCount);
    expect(pieces.some((x) => x.pos.every((v, k) => Math.abs(v - s.lift!.at[k]) < 1e-9))).toBe(true);
    expect(Math.hypot(s.lift!.at[0] - p.crane!.base[0], s.lift!.at[2] - p.crane!.base[2])).toBeCloseTo(s.lift!.radius, 9);
  });

  it('puts the pick ring at the critical piece during the lift and eases it across the slew', () => {
    const s = bmu();
    const during = tl.stateAt(s.t0 + 0.02).crane.pick!;
    expect(during.stepIndex).toBe(s.index);
    expect(during.radius).toBeCloseTo(s.lift!.radius, 6);
    expect(during.util).toBeCloseTo(s.lift!.util, 9);
    expect(during.active).toBe(true);
    // half-way through the slew from the lift before it, the ring sits between the two radii
    const lifts = p.steps.filter((x) => x.method === 'crane' && x.partCount > 0);
    const prev = lifts[lifts.indexOf(s) - 1];
    const mid = tl.stateAt(s.t0 - 0.045).crane.pick!;
    const lo = Math.min(prev.lift!.radius, s.lift!.radius), hi = Math.max(prev.lift!.radius, s.lift!.radius);
    expect(mid.radius).toBeGreaterThan(lo - 1e-6);
    expect(mid.radius).toBeLessThan(hi + 1e-6);
  });

  it('follows the active operation even while the jib already slews to the next lift', () => {
    // steps overlap: the canopy lift is still the active operation when the crane turns to the next pick
    const canopy = p.steps.find((x) => x.lift && Math.round(x.lift.util * 100) === 87)!;
    for (const dt of [0.01, 0.03, 0.06]) {
      const st = tl.stateAt(canopy.t0 + dt);
      if (st.stepIndex !== canopy.index) continue;
      expect(st.crane.pick!.stepIndex).toBe(canopy.index);
      expect(st.crane.pick!.util).toBeCloseTo(canopy.lift!.util, 9);
    }
  });

  it('has no pick before the first lift or once the crane is struck', () => {
    expect(tl.stateAt(0.01).crane.pick).toBeNull();
    const material = p.stages.find((x) => x.kind === 'material')!;
    expect(tl.stateAt(material.start + 1.5).crane.pick).toBeNull();
  });

  it('draws the BMU lift in red at its radius, and the canopy in amber', () => {
    const reach = new CraneReach(p.crane!, colours);
    expect(reach.knee).toBeCloseTo(20, 3);
    const s = bmu();
    reach.update(tl.stateAt(s.t0 + 0.02).crane, 0.85);
    expect(reach.group.visible).toBe(true);
    expect(reach.level).toBe('over');
    expect(reach.ring.scale.x).toBeCloseTo(s.lift!.radius, 6);
    expect(reach.ring.material.color.getHexString()).toBe('b3261e');
    const canopy = p.steps.find((x) => x.lift && Math.round(x.lift.util * 100) === 87)!;
    reach.update(tl.stateAt(canopy.t0 + 0.02).crane, 0.85);
    expect(reach.level).toBe('warn');
    // the operation panel reads the same threshold
    expect(liftText(canopy, 'TC-1', 0.85).level).toBe('warn');
    expect(liftText(canopy, 'TC-1', 0.9).level).toBe('ok');
    // hidden with the crane
    reach.update({ ...tl.stateAt(canopy.t0 + 0.02).crane, visible: false }, 0.85);
    expect(reach.group.visible).toBe(false);
  });

  it('adds the checks\' rigging allowance to the pick wherever it is read', () => {
    const canopy = p.steps.find((x) => x.lift && Math.round(x.lift.util * 100) === 87)!;
    const l = canopy.lift!;
    // one tonne of rigging takes the 5.6 t canopy past the 6.5 t chart
    const rig = 1000;
    const { kg, util } = reviewedLift(l.pieceKg, l.capacityKg, rig);
    expect(kg).toBeCloseTo(l.pieceKg + rig, 9);
    expect(util).toBeGreaterThan(1);
    expect(reviewedLift(l.pieceKg, l.capacityKg).util).toBeCloseTo(l.util, 12);
    expect(reviewedLift(l.pieceKg, 0).util).toBe(Infinity);
    const reach = new CraneReach(p.crane!, colours);
    reach.update(tl.stateAt(canopy.t0 + 0.02).crane, 0.85, rig);
    expect(reach.level).toBe('over');
    const text = liftText(canopy, 'TC-1', 0.85, rig);
    expect(text.level).toBe('over');
    expect(text.text).toContain(`${Math.round(util * 100)} %`);
  });
});

describe('the Duplex has no tower crane', () => {
  it('shows no crane, no reach and no pick at any time, and reads its lifts as mobile crane or by hand', async () => {
    const model = await readIfc(readFileSync(join(here, '../public/samples/duplex-apartment.ifc.txt'), 'latin1'), () => {}, 'Duplex_A_20110907.ifc');
    const p = projectFromIfc(model, 'Duplex_A_20110907.ifc').project;
    expect(p.crane).toBeNull();
    const tl = new Timeline(p);
    for (let t = 0; t <= p.duration; t += p.duration / 97) {
      const c = tl.stateAt(t).crane;
      expect(c.visible).toBe(false);
      expect(c.pick).toBeNull();
    }
    expect(tl.events.some((e) => e.kind === 'CRANE')).toBe(false);
    const pick = p.steps.find((s) => s.method === 'crane' && s.partCount > 0)!;
    expect(liftText(pick, null)).toEqual({ text: 'mobile crane · set up beside the building', level: 'none' });
    expect(liftText(p.steps.find((s) => s.method === 'manual' && s.partCount > 0)!, null).text).toBe('by hand · site team');
  });
});

describe('placing a reach label on its circle', () => {
  // a circle of radius 200 px about (500, 400) seen from straight above
  const ring: RingPoint[] = Array.from({ length: 120 }, (_, k) => {
    const a = (k / 120) * Math.PI * 2;
    return { x: 500 + Math.cos(a) * 200, y: 400 + Math.sin(a) * 200, a };
  });
  const size = { w: 120, h: 30 };
  const screen = { x0: 8, y0: 8, x1: 1000, y1: 800 };
  const angleOf = (p: { k: number }) => ring[p.k].a;

  it('hangs at the angle it prefers when nothing is in the way, from a point of the circle', () => {
    const p = placeOnRing(ring, size, screen, [], Math.PI / 2)!;
    expect(turn(angleOf(p), Math.PI / 2)).toBeLessThan(0.06);
    const corners = [[p.x - 8, p.y - 4], [p.x - 8, p.y + size.h + 4], [p.x + size.w + 8, p.y - 4], [p.x + size.w + 8, p.y + size.h + 4]];
    expect(Math.min(...corners.map(([x, y]) => Math.hypot(x - ring[p.k].x, y - ring[p.k].y)))).toBeLessThan(1e-9);
  });

  it('slides round the circle to the nearest spot clear of a control', () => {
    // a transport bar across the bottom of the circle
    const bar: Obstacle = { x0: 0, y0: 520, x1: 1000, y1: 800, weight: Infinity };
    const p = placeOnRing(ring, size, screen, [bar], Math.PI / 2)!;
    expect(p.y + size.h).toBeLessThanOrEqual(520);
    // the nearest clear spot, not the far side of the circle
    expect(turn(angleOf(p), Math.PI / 2)).toBeLessThan(Math.PI / 2);
  });

  it('keeps off the screen edge and gives up when nothing on screen is clear', () => {
    const all: Obstacle = { x0: 0, y0: 0, x1: 1000, y1: 800, weight: Infinity };
    expect(placeOnRing(ring, size, screen, [all], 0)).toBeNull();
    const off = ring.map((q) => ({ ...q, x: q.x + 2000 }));
    expect(placeOnRing(off, size, screen, [], 0)).toBeNull();
    expect(placeOnRing(ring.map((q) => ({ ...q, behind: true })), size, screen, [], 0)).toBeNull();
  });

  it('moves off annotation when it can, and covers faint annotation before strong', () => {
    const atPreferred = placeOnRing(ring, size, screen, [], 0)!;
    const box = { x0: atPreferred.x - 4, y0: atPreferred.y - 4, x1: atPreferred.x + size.w + 4, y1: atPreferred.y + size.h + 4 };
    const strong = placeOnRing(ring, size, screen, [{ ...box, weight: 1 }], 0)!;
    expect(strong.k !== atPreferred.k || strong.corner !== atPreferred.corner).toBe(true);
    // a faint item costs little: the label stays near where it wants to be
    const faint = placeOnRing(ring, size, screen, [{ ...box, weight: 0.01 }], 0)!;
    expect(turn(angleOf(faint), 0)).toBeLessThanOrEqual(turn(angleOf(strong), 0));
  });

  it('stays where it was while that is nearly as good, so it does not hop', () => {
    const best = placeOnRing(ring, size, screen, [], 0)!;
    const near = { k: (best.k + 2) % ring.length, corner: best.corner };
    const kept = placeOnRing(ring, size, screen, [], 0, near)!;
    expect(kept.k).toBe(near.k);
    // but not once it has drifted well away from the best spot
    const far = { k: (best.k + 30) % ring.length, corner: best.corner };
    expect(placeOnRing(ring, size, screen, [], 0, far)!.k).not.toBe(far.k);
  });
});
