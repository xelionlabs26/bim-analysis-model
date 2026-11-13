/**
 * The crane's reach drawn on the ground, in the manner of a site logistics plan:
 * - the slew circle at the jib's length (dashed), with the radius out to which
 *   the chart gives full capacity (dotted) and the counter-jib's tail swing;
 * - for the current lift, a ring at the radius of its critical piece with a line
 *   from the mast and a marker at the piece, coloured by how hard the pick works
 *   the crane (within the chart, at review level, over the chart). These are
 *   drawn at the piece's own level, not on the ground: on a tower the pick is
 *   read where it happens. In the crane plan they lie on the ground, so the
 *   pick's radius reads against the slew and full-capacity circles.
 */
import { Color, Group } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { chartKnee, liftLevel, reviewedLift, type Crane, type LiftLevel } from '../data/types';
import type { CraneState } from '../engine/timeline';
import { disposeTree } from './dispose';

const LIFT_Y = 0.05; // just above the ground plane and the slabs on grade

/** Segment pairs for a circle of radius r in the XZ plane. */
function circle(r: number, n = 192): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    out.push(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(b) * r, 0, Math.sin(b) * r);
  }
  return out;
}

/**
 * How the overlay shows: as usual; emphasised, with heavier lines, for the
 * crane plan; or hidden while the view explains something else (an issue
 * outside the crane's checks).
 */
export type ReachMode = 'normal' | 'emph' | 'hidden';

/** Line weight and opacity of the emphasised overlay against the usual one. */
const EMPH_WIDTH = 1.8;

export interface ReachColours {
  ink: Color;
  muted: Color;
  ok: Color;
  warn: Color;
  over: Color;
}

export class CraneReach {
  readonly group = new Group();
  /** Radius of full chart capacity. */
  readonly knee: number;
  private mats: LineMaterial[] = [];
  /** Each material's usual width and opacity, for switching emphasis on and off. */
  private base = new Map<LineMaterial, { width: number; opacity: number }>();
  private mode: ReachMode = 'normal';
  readonly ring: LineSegments2;
  readonly radial: LineSegments2;
  readonly marker: LineSegments2;
  private pickMats: LineMaterial[];
  /** The level last drawn, for tests and labels. */
  level: LiftLevel | null = null;

  constructor(
    private crane: Crane,
    private colours: ReachColours,
  ) {
    this.knee = chartKnee(crane);
    this.group.position.set(crane.base[0], LIFT_Y, crane.base[2]);
    this.group.renderOrder = 8;
    const line = (pos: number[], color: Color, width: number, opts: { dashed?: boolean; dash?: number; gap?: number; opacity?: number } = {}) => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions(pos);
      const mat = new LineMaterial({ color: color.getHex(), linewidth: width, transparent: true, opacity: opts.opacity ?? 1, depthWrite: false, dashed: !!opts.dashed, dashSize: opts.dash ?? 1, gapSize: opts.gap ?? 1 });
      this.mats.push(mat);
      this.base.set(mat, { width, opacity: opts.opacity ?? 1 });
      const obj = new LineSegments2(geo, mat);
      if (opts.dashed) obj.computeLineDistances();
      obj.frustumCulled = false;
      return obj;
    };
    // the reach envelope: jib, full-capacity radius, tail swing, and the mast's centre
    const slew = line(circle(crane.jib, 256), colours.ink, 1.6, { dashed: true, dash: 2.4, gap: 1.6, opacity: 0.7 });
    const knee = line(circle(this.knee, 160), colours.muted, 1.2, { dashed: true, dash: 0.35, gap: 0.9, opacity: 0.85 });
    const tail = line(circle(crane.counterJib, 128), colours.muted, 1, { dashed: true, dash: 1.2, gap: 1.2, opacity: 0.6 });
    const cross = line([-1.6, 0, 0, 1.6, 0, 0, 0, 0, -1.6, 0, 0, 1.6], colours.ink, 1.4, { opacity: 0.8 });
    // the current pick: a unit ring, a unit radial line and a small marker, placed per frame
    this.ring = line(circle(1, 192), colours.ok, 3);
    this.radial = line([0, 0, 0, 1, 0, 0], colours.ok, 1.6);
    this.marker = line([...circle(0.9, 24), -1.4, 0, 0, 1.4, 0, 0, 0, 0, -1.4, 0, 0, 1.4], colours.ok, 2.2);
    this.pickMats = [this.ring.material, this.radial.material, this.marker.material];
    this.group.add(slew, knee, tail, cross, this.ring, this.radial, this.marker);
    this.group.visible = false;
  }

  setResolution(w: number, h: number) {
    for (const m of this.mats) m.resolution.set(w, h);
  }

  /** Emphasise, show as usual, or hide the overlay; the crane's state still decides whether it stands. */
  setMode(mode: ReachMode) {
    this.mode = mode;
    const k = mode === 'emph' ? EMPH_WIDTH : 1;
    for (const [m, b] of this.base) {
      m.linewidth = b.width * k;
      // the reach envelope's faint dashes read clearly from above when emphasised
      if (!this.pickMats.includes(m)) m.opacity = mode === 'emph' ? Math.min(1, b.opacity + 0.25) : b.opacity;
    }
  }

  get currentMode(): ReachMode {
    return this.mode;
  }

  /** Release the overlay's line geometries and materials. */
  dispose() {
    disposeTree(this.group);
    this.mats = [];
  }

  /** Per frame: follow the crane's state; the overlay shows only while the crane stands. */
  update(s: CraneState, warnAt: number, riggingKg = 0) {
    this.group.visible = s.visible && s.headVisible && this.mode !== 'hidden';
    const pick = s.pick;
    const on = this.group.visible && !!pick;
    this.ring.visible = this.radial.visible = this.marker.visible = on;
    this.level = on ? liftLevel(reviewedLift(pick!.kg, pick!.capKg, riggingKg).util, warnAt) : null;
    if (!on || !pick) return;
    const c = this.level === 'over' ? this.colours.over : this.level === 'warn' ? this.colours.warn : this.colours.ok;
    const opacity = pick.active ? 1 : 0.4;
    for (const m of this.pickMats) {
      m.color.copy(c);
      m.opacity = opacity;
    }
    const r = Math.max(0.5, pick.radius);
    // in the crane plan the ring lies on the ground, concentric with the slew and full-capacity circles and to their scale
    const y = this.mode === 'emph' ? 0 : Math.max(0, pick.at[1] - LIFT_Y);
    this.ring.scale.set(r, 1, r);
    this.ring.position.y = this.radial.position.y = this.marker.position.y = y;
    // the line and marker point at the critical piece itself
    const dx = pick.at[0] - this.crane.base[0], dz = pick.at[2] - this.crane.base[2];
    const d = Math.max(0.5, Math.hypot(dx, dz));
    this.radial.scale.set(d, 1, 1);
    this.radial.rotation.y = Math.atan2(-dz, dx);
    this.marker.position.set(dx, y, dz);
  }
}
