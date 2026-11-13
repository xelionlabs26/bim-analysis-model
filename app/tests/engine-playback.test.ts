import { describe, expect, it } from 'vitest';
import { buildProject } from '../src/data/project';
import { Playback } from '../src/engine/playback';
import { Timeline } from '../src/engine/timeline';

describe('playback ignores a time that is not a number', () => {
  it('keeps the current time when seeking to NaN or infinity, and keeps playing', () => {
    const pb = new Playback(30);
    pb.seek(5);
    for (const bad of [Number('12s'), Number('abc'), NaN, Infinity, -Infinity]) pb.seek(bad);
    expect(pb.t).toBe(5);
    pb.tick(0.5);
    expect(pb.t).toBeCloseTo(5.5, 9);
  });

  it('still clamps finite times to the sequence', () => {
    const pb = new Playback(30);
    pb.seek(-3);
    expect(pb.t).toBe(0);
    pb.seek(99);
    expect(pb.t).toBe(30);
  });

  it('recovers when the time has somehow become NaN', () => {
    const pb = new Playback(30);
    pb.t = NaN;
    pb.tick(0.25);
    expect(pb.t).toBeCloseTo(0.25, 9);
    pb.t = NaN;
    pb.setDuration(20);
    expect(pb.t).toBe(0);
    pb.tick(NaN);
    expect(Number.isFinite(pb.t)).toBe(true);
  });

  it('notifies listeners only for a seek it applies', () => {
    const pb = new Playback(30);
    let calls = 0;
    pb.onChange(() => calls++);
    pb.seek(NaN);
    expect(calls).toBe(0);
    pb.seek(3);
    expect(calls).toBe(1);
  });
});

describe('sequence state at a time that is not a number', () => {
  it('reads as the start of the sequence, with every value finite', () => {
    const tl = new Timeline(buildProject());
    const s = tl.stateAt(NaN);
    const start = tl.stateAt(0);
    expect(s.t).toBe(0);
    expect(s.stepIndex).toBe(start.stepIndex);
    expect(s.stageProgress.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(s.crane.hookY)).toBe(true);
    expect(Number.isFinite(s.crane.radius) && Number.isFinite(s.builtTop)).toBe(true);
  });
});
