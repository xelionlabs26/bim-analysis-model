import { describe, expect, it } from 'vitest';
import { buildProject } from '../src/data/project';
import { Timeline } from '../src/engine/timeline';
import { drawingScale, scaleBarLength } from '../src/ui/overlays';

const project = buildProject();
const tl = new Timeline(project);

describe('generated pagoda', () => {
  it('has the 191-step programme of the reference, split by tier', () => {
    expect(project.steps).toHaveLength(191);
    expect(tl.tierTotal).toEqual({ PLINTH: 19, 'TIER 1': 43, 'TIER 2': 29, 'TIER 3': 29, 'TIER 4': 29, 'TIER 5': 28, SPIRE: 14 });
  });

  it('reaches the reference overall height and a plausible mass', () => {
    expect(project.height).toBeCloseTo(37.54, 2);
    expect(project.parts.length).toBeGreaterThan(5000);
    expect(project.totalMassKg / 1000).toBeGreaterThan(300);
    expect(project.totalMassKg / 1000).toBeLessThan(600);
  });

  it('gives every part finite geometry and a positive volume', () => {
    for (const p of project.parts) {
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

  it('never places a tier before the tier below has started', () => {
    const order = ['PLINTH', 'TIER 1', 'TIER 2', 'TIER 3', 'TIER 4', 'TIER 5', 'SPIRE'];
    const firstStep = order.map((t) => project.steps.findIndex((s) => s.tier === t));
    expect([...firstStep].sort((a, b) => a - b)).toEqual(firstStep);
  });

  it('keeps presentation stages 07–08 marked unavailable (M5)', () => {
    expect(project.stages.filter((s) => !s.available).map((s) => s.n)).toEqual([7, 8]);
    expect(project.parts.every((p) => p.stage <= 6)).toBe(true);
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
    const end = tl.stateAt(project.duration);
    expect(end.complete).toBe(true);
    expect(end.stepsDone).toBe(191);
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
      last = s;
    }
  });

  it('emits a CHK line per tier computed from the data', () => {
    const chk = tl.events.filter((e) => e.kind === 'CHK');
    expect(chk).toHaveLength(7);
    expect(chk.find((e) => e.text.startsWith('CHK TIER 1'))!.text).toContain('43/43 steps');
  });

  it('shows the latest log events up to t', () => {
    const log = tl.logAt(3.3, 8);
    expect(log.length).toBeLessThanOrEqual(8);
    expect(log.every((e) => e.t <= 3.3)).toBe(true);
    expect(log.at(-1)!.text).toContain('MOKOSHI · HEAD BEAMS & BRACKETS · WEST');
  });
});

describe('drawing scale', () => {
  it('snaps to standard architectural scales', () => {
    // 1:100 ≈ 10 mm per metre ≈ 37.8 CSS px per metre at 96 dpi
    expect(drawingScale(37.8)).toBe(100);
    expect(drawingScale(15.1)).toBe(250);
    expect(scaleBarLength(37.8)).toBe(2.5);
  });
});
