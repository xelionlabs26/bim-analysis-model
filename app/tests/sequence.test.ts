import { describe, expect, it } from 'vitest';
import { buildProject } from '../src/data/project';
import { ROOF_LEVEL } from '../src/data/generator';
import { Timeline } from '../src/engine/timeline';
import { ARBOR_CUT_AT as CUT_AT } from '../src/data/project';
import { drawingScale, scaleBarLength } from '../src/ui/overlays';

const project = buildProject();
const tl = new Timeline(project);
const idx = (code: string, level: number) => project.steps.findIndex((s) => s.code === code && s.level === level);

describe('Arbor House model', () => {
  it('is a 32-storey tower over 100 m tall', () => {
    expect(project.storeys).toBe(32);
    expect(project.height).toBeGreaterThan(100);
    expect(project.height).toBeLessThan(130);
  });

  it('frames, pods, decks and clads every timber floor L03–L31', () => {
    for (let L = 3; L <= 31; L++) {
      expect(idx('GL-01', L), `frame L${L}`).toBeGreaterThan(-1);
      expect(idx('BP-01', L), `pods L${L}`).toBeGreaterThan(-1);
      expect(idx('CL-01', L + 1), `slab L${L + 1}`).toBeGreaterThan(-1);
      expect(idx('FC-01', L), `façade L${L}`).toBeGreaterThan(-1);
    }
  });

  it('gives every part finite geometry and a positive volume', () => {
    for (const p of [...project.parts, ...project.context]) {
      expect([...p.pos, ...p.quat].every(Number.isFinite)).toBe(true);
      expect(p.size.every((v) => v > 0)).toBe(true);
    }
  });

  it('schedules steps in order, inside their stage window', () => {
    let prev = -1;
    for (const s of project.steps) {
      const st = project.stages[s.stage - 1];
      expect(s.t0).toBeGreaterThan(prev);
      expect(s.t0).toBeGreaterThanOrEqual(st.start);
      expect(s.t0).toBeLessThan(st.end);
      prev = s.t0;
    }
  });

  it('ends with the material pass and Section A–A, which place no parts', () => {
    expect(project.stages.map((s) => s.kind)).toEqual(['assembly', 'assembly', 'assembly', 'assembly', 'assembly', 'assembly', 'material', 'section']);
    expect(project.parts.every((p) => p.stage <= 6)).toBe(true);
    const last = project.steps[project.steps.length - 1];
    expect(project.stages[6].start).toBeGreaterThanOrEqual(last.t0);
  });
});

describe('install order', () => {
  it('keeps the core at least two floors ahead of the timber frame (one at the roof)', () => {
    expect(tl.coreLead).toHaveLength(29);
    for (const c of tl.coreLead) expect(c.coreLevel, `L${c.level}`).toBeGreaterThanOrEqual(Math.min(c.level + 2, ROOF_LEVEL));
  });

  it('goes frame → pods → slab above, with the façade trailing', () => {
    for (let L = 3; L <= 31; L++) {
      expect(idx('GL-01', L)).toBeLessThan(idx('BP-01', L));
      expect(idx('BP-01', L)).toBeLessThan(idx('CL-01', L + 1));
      expect(idx('FC-01', L)).toBeGreaterThan(idx('CL-01', L + 1));
    }
  });

  it('plants each sky garden after both of its façade levels', () => {
    for (const g of [12, 22]) {
      const garden = idx('SG-01', g);
      expect(garden).toBeGreaterThan(idx('FC-01', g + 1));
    }
  });

  it('erects the crane before the first crane lift', () => {
    const firstLift = project.steps.findIndex((s) => s.method === 'crane');
    const erect = project.steps.findIndex((s) => s.code === 'TC-02');
    expect(erect).toBeGreaterThan(-1);
    expect(erect).toBeLessThan(firstLift);
  });
});

describe('crane reach check', () => {
  it('keeps every pick inside the jib', () => {
    for (const s of project.steps) if (s.lift) expect(s.lift.radius).toBeLessThanOrEqual(project.crane.jib);
  });

  it('flags only the BMU gantry as over the load chart', () => {
    const over = project.steps.filter((s) => s.lift && s.lift.util > 1).map((s) => s.code);
    expect(over).toEqual(['BM-01']);
  });

  it('keeps the jib clear of the structure as the mast climbs', () => {
    for (let t = 0; t < tl.presentation.strikeT; t += 0.25) {
      const s = tl.stateAt(t);
      if (s.crane.visible) expect(s.crane.mastTop).toBeGreaterThanOrEqual(s.builtTop + 14);
    }
  });
});

describe('carbon', () => {
  it('reports an indicative A1–A3 total, intensity and timber storage', () => {
    expect(project.totalCarbonKg).toBeGreaterThan(0);
    const intensity = project.totalCarbonKg / project.gifa;
    expect(intensity).toBeGreaterThan(100);
    expect(intensity).toBeLessThan(600);
    expect(project.totalBiogenicKg).toBeGreaterThan(0);
  });
});

describe('timeline state', () => {
  it('is a pure function of t (seek order does not matter)', () => {
    const a = tl.stateAt(7.77);
    tl.stateAt(1);
    tl.stateAt(14);
    expect(tl.stateAt(7.77)).toEqual(a);
  });

  it('starts empty and ends complete', () => {
    const s0 = tl.stateAt(0);
    expect(s0.stepsDone).toBe(0);
    expect(s0.partsPlaced).toBe(0);
    expect(s0.crane.visible).toBe(false);
    const end = tl.stateAt(project.duration);
    expect(end.complete).toBe(true);
    expect(end.stepsDone).toBe(project.steps.length);
    expect(end.partsPlaced).toBe(project.parts.length);
    expect(end.massPlacedKg).toBeCloseTo(project.totalMassKg, 3);
  });

  it('counts are monotonic over time', () => {
    let last = tl.stateAt(0);
    for (let t = 0.05; t <= project.duration; t += 0.05) {
      const s = tl.stateAt(t);
      expect(s.stepsDone).toBeGreaterThanOrEqual(last.stepsDone);
      expect(s.partsPlaced).toBeGreaterThanOrEqual(last.partsPlaced);
      expect(s.builtTop).toBeGreaterThanOrEqual(last.builtTop);
      expect(s.carbonPlacedKg).toBeGreaterThanOrEqual(last.carbonPlacedKg);
      last = s;
    }
  });

  it('emits one computed CHK line per zone, plus the material pass', () => {
    const chk = tl.events.filter((e) => e.kind === 'CHK');
    expect(chk).toHaveLength(7);
    expect(chk.at(-1)!.text).toContain('CHK MATERIAL');
    expect(chk.find((e) => e.text.startsWith('CHK LOWER'))!.text).toContain('core lead ≥ 2 floors ✓');
    expect(chk.find((e) => e.text.startsWith('CHK CROWN'))!.text).toContain('✗');
  });

  it('shows the latest log events up to t', () => {
    const log = tl.logAt(6.0, 8);
    expect(log.length).toBeLessThanOrEqual(8);
    expect(log.every((e) => e.t <= 6.0)).toBe(true);
  });
});

describe('material pass and section (M5)', () => {
  const pr = tl.presentation;
  const m = pr.material;
  const sec = pr.section;

  it('leaves the drawing uncoloured until the wash reaches it, then colours everything', () => {
    expect(pr.washAt(m.start - 0.01).front).toEqual([-1e4, -1e4]);
    expect(pr.washAt(m.start - 0.01).pct).toEqual([0, 0]);
    let last = pr.washAt(m.start);
    for (let t = m.start; t <= m.end; t += 0.05) {
      const w = pr.washAt(t);
      expect(w.front[0]).toBeGreaterThanOrEqual(last.front[0]);
      expect(w.front[1]).toBeGreaterThanOrEqual(last.front[1]);
      expect(w.pct[0]).toBeGreaterThanOrEqual(last.pct[0]);
      last = w;
    }
    expect(pr.washAt(m.end + 0.01).pct).toEqual([1, 1]);
    expect(pr.washAt(0).front).toEqual([-1e4, -1e4]); // looping back undoes the wash
  });

  it('strikes the crane at the start of the material pass', () => {
    expect(tl.stateAt(pr.strikeT - 0.01).crane.visible).toBe(true);
    expect(tl.stateAt(pr.strikeT + 0.4).crane.headVisible).toBe(false);
    expect(tl.stateAt(pr.strikeT + 0.9).crane.visible).toBe(false);
    expect(tl.stateAt(sec.start + 2).crane.visible).toBe(false);
  });

  it('opens the section at x = 9.6 m and closes it before the loop', () => {
    expect(pr.cutAt(sec.start).on).toBe(false);
    const open = pr.cutAt(sec.start + 2);
    expect(open.on).toBe(true);
    expect(open.d).toBeCloseTo(CUT_AT, 5);
    expect(pr.cutAt(sec.start + 6.5).on).toBe(false);
    expect(tl.stateAt(project.duration).presentation.cut.on).toBe(false);
    expect(pr.cutParts).toBeGreaterThan(300);
  });

  it('flies the camera only during the section, with finite poses', () => {
    expect(pr.poseAt(sec.start - 0.01)).toBeNull();
    for (let t = sec.start; t <= sec.end; t += 0.05) {
      const pose = pr.poseAt(t)!;
      expect([...pose.target, pose.az, pose.el, pose.dist, pose.fov].every(Number.isFinite)).toBe(true);
      expect(pose.dist).toBeGreaterThan(20);
    }
  });

  it('labels every section shot it frames', () => {
    const s = tl.stateAt(sec.start + 2.0);
    expect(s.presentation.shot!.id).toBe('S-03');
    expect(s.callouts[0].member).toContain('SKY GARDEN');
  });
});

describe('drawing scale', () => {
  it('snaps to standard architectural scales', () => {
    // 1:100 ≈ 10 mm per metre ≈ 37.8 CSS px per metre at 96 dpi
    expect(drawingScale(37.8)).toBe(100);
    expect(drawingScale(15.1)).toBe(250);
    expect(drawingScale(3.78)).toBe(1000);
    expect(scaleBarLength(37.8)).toBe(2.5);
  });
});
