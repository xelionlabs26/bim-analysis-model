/**
 * The crane's story told at the right moment: where playback stops for the
 * first pick over the chart, and the camera for the crane plan (the reach
 * seen from above). Pure functions of the project and the playhead.
 */
import { reviewedLift, type Crane, type Project, type Vec3 } from '../data/types';
import type { CameraPose } from './presentation';
import { SLEW_LEAD } from './timeline';

/** A pick over the crane's chart, as the checks read it (the piece plus the rigging allowance). */
export interface OverPick {
  stepIndex: number;
  /** Where playback stops: the step is the current one and the piece hangs on the hook. */
  t: number;
  /** Index of the critical piece in project.parts (-1 if it cannot be told apart). */
  part: number;
  pieceKg: number;
  /** Piece plus rigging. */
  kg: number;
  capKg: number;
  util: number;
  radius: number;
  at: Vec3;
}

/**
 * The first crane pick whose reviewed load is over the chart at its radius, or
 * null. Steps overlap, so the stop is half-way through the part of the lift
 * where it is still the current step and the jib has not begun to slew to the
 * next pick: the operation panel, the hook and the reach ring all show this
 * pick when playback halts.
 */
export function firstOverPick(p: Project, riggingKg = 0): OverPick | null {
  if (!p.crane) return null;
  for (const s of p.steps) {
    const l = s.lift;
    if (s.method !== 'crane' || !l) continue;
    const r = reviewedLift(l.pieceKg, l.capacityKg, riggingKg);
    if (!(r.util > 1)) continue;
    let end = s.t1;
    const next = p.steps[s.index + 1];
    if (next) end = Math.min(end, next.t0 - 1e-3);
    const nextLift = p.steps.find((x) => x.index > s.index && x.method === 'crane' && x.partCount > 0);
    if (nextLift) end = Math.min(end, nextLift.t0 - SLEW_LEAD - 1e-3);
    const t = end > s.t0 ? (s.t0 + end) / 2 : s.t0;
    let part = -1;
    for (let i = s.partStart; i < s.partStart + s.partCount; i++) {
      const q = p.parts[i].pos;
      if (Math.abs(q[0] - l.at[0]) < 1e-9 && Math.abs(q[1] - l.at[1]) < 1e-9 && Math.abs(q[2] - l.at[2]) < 1e-9) {
        part = i;
        break;
      }
    }
    return { stepIndex: s.index, t, part, pieceKg: l.pieceKg, kg: r.kg, capKg: l.capacityKg, util: r.util, radius: l.radius, at: l.at };
  }
  return null;
}

/**
 * Stops playback once per playthrough at the first over-chart pick. Only the
 * playhead running into it counts (a seek or a scrub past it does not), and
 * the watch re-arms whenever the playhead is back before it: a seek back, a
 * rebuild or the loop to the start.
 */
export class OverPickWatch {
  private fired = false;

  constructor(readonly pick: OverPick | null) {}

  /**
   * Call once per frame with the playhead before and after playback advanced.
   * Returns the pick when playback has just run into it, else null.
   */
  advance(before: number, after: number, playing: boolean): OverPick | null {
    const p = this.pick;
    if (!p) return null;
    if (after < p.t - 1e-6) {
      this.fired = false;
      return null;
    }
    if (!playing || this.fired || before >= p.t - 1e-6) return null;
    this.fired = true;
    return p;
  }

  /** Whether this playthrough has already stopped on it. */
  get done() {
    return this.fired;
  }
}

/** The PLAN view preset's elevation, degrees: nearly straight down, so heights still read a little. */
export const PLAN_EL = 86;

/**
 * The crane plan: from above, north up, the whole slew circle in the part of
 * the view that `share` leaves clear (width and height, 0–1), so the reach,
 * the pick ring and its radius read at a glance.
 */
export function cranePlanPose(crane: Crane, aspect: number, share: { w: number; h: number } = { w: 1, h: 1 }, fov = 26): CameraPose {
  const r = crane.jib + 4;
  const half = ((fov * Math.PI) / 180) / 2;
  const part = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0.05, v)) : 1);
  const fit = Math.min(Math.tan(half) * part(share.h), Math.tan(half) * (Number.isFinite(aspect) && aspect > 0 ? aspect : 1) * part(share.w));
  return { target: [crane.base[0], 0, crane.base[2]], az: 0, el: PLAN_EL, dist: (r / fit) * 1.04, fov };
}
