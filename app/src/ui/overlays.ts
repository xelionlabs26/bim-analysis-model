import type { Callout, CraneState, SequenceState, Timeline } from '../engine/timeline';
import { chartKnee, liftLevel, reviewedLift, type Project } from '../data/types';
import type { Viewer } from '../scene/viewer';
import type { ReachMode } from '../scene/reach';
import { modelBounds } from '../checks/view';
import { placeOnRing, type Box, type Obstacle, type RingPoint } from './place';

const SCALES = [50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000];
const BAR_LENGTHS = [1, 2, 2.5, 5, 10, 20, 25, 50];
const RANK_OPACITY = [1, 0.62, 0.34, 0.14];
const SVG = 'http://www.w3.org/2000/svg';

/** Nearest standard drawing scale for a given on-screen pixels-per-metre (CSS px at 96 dpi). */
export function drawingScale(pxPerMetre: number): number {
  const mmPerMetre = (pxPerMetre * 25.4) / 96;
  const exact = 1000 / mmPerMetre;
  return SCALES.reduce((best, s) => (Math.abs(Math.log(s / exact)) < Math.abs(Math.log(best / exact)) ? s : best), SCALES[0]);
}

export function scaleBarLength(pxPerMetre: number): number {
  return BAR_LENGTHS.find((l) => l * pxPerMetre >= 90) ?? BAR_LENGTHS[BAR_LENGTHS.length - 1];
}

/** Camera elevation (degrees) from which the view reads as a plan: level datums and member callouts mean nothing there. */
export const PLAN_ELEVATION = 70;
/** A datum label's height in pixels: datums closer together than this would print over each other. */
export const DATUM_GAP = 15;
/** The level datums' rows: each centred this far in from the viewport's right side (px) … */
export const DATUM_RIGHT = 96;
/** … and running this far either side of that (the code, the tick, the value and the dash). */
export const DATUM_HALF = 74;
/** The strip down the viewport's right side (`w` wide, `h` tall) that the datum rows take, their full extent padded by `pad`. */
export const datumStrip = (w: number, h: number, pad = 6): Box => ({ x0: w - DATUM_RIGHT - DATUM_HALF - pad, y0: 0, x1: w, y1: h });
/** How long the boxes of the viewport's cards and controls are reused before they are measured again (ms). */
export const CHROME_TTL = 250;

/** Whether the view reads as a plan: the crane plan, or any camera looking nearly straight down. */
export const planLike = (reachMode: ReachMode, elevation: number) => reachMode === 'emph' || elevation >= PLAN_ELEVATION;

const hits = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/**
 * Which level datums show, and how strongly (0 hidden … 1), given each
 * one's row on screen (the code, the tick and the value) and its own
 * opacity. A row under a card or control (the title block, the caption, a
 * drawer, the play bar) is left out; so is a row closer than `gap` to one
 * already shown, from the top down, so a far-off or flattened tower does not
 * pile its datums into one illegible band; a row across the selected issue
 * steps right back, so the subject reads first. In a plan none shows.
 */
export function datumOpacity(rows: { box: Box; op: number }[], o: { plan: boolean; blocked: Box[]; issue: Box | null; gap?: number }): number[] {
  const gap = o.gap ?? DATUM_GAP;
  const out = rows.map(() => 0);
  if (o.plan) return out;
  const order = rows.map((_, i) => i).filter((i) => rows[i].op > 0).sort((a, b) => rows[a].box.y0 - rows[b].box.y0);
  let last = -Infinity;
  for (const i of order) {
    const { box, op } = rows[i];
    if (o.blocked.some((b) => hits(box, b))) continue;
    if (box.y0 - last < gap) continue;
    last = box.y0;
    out[i] = o.issue && hits(box, o.issue) ? Math.min(op, 0.12) : op;
  }
  return out;
}

/**
 * Where the 'H =' box sits: above the top datum, pushed down below any card
 * it would sit under; null (hidden) when that leaves it on the top datum's
 * own label or off the bottom of the room it has.
 */
export function heightBoxAt(want: { x: number; y: number }, size: { w: number; h: number }, topRow: number, blocked: Box[], maxY: number): { x: number; y: number } | null {
  let y = want.y;
  for (let k = 0; k < 3; k++) {
    const box = { x0: want.x, y0: y, x1: want.x + size.w, y1: y + size.h };
    const under = blocked.filter((b) => hits(box, b));
    if (!under.length) break;
    y = Math.max(...under.map((b) => b.y1)) + 2;
  }
  if (y + size.h > topRow - 2 || y + size.h > maxY) return null;
  return { x: want.x, y };
}

/**
 * How strongly a member callout draws: its label, its leader line and the
 * ring on the member, fading by rank (the newest callout's ring stays solid).
 * A callout with no room left on its side's stack loses its label and leader
 * and keeps only the newest ring. A callout whose label is not shown at all
 * (the stylesheet hides the labels on a narrow screen) draws nothing: a
 * leader and ring with no label point from nowhere at nothing.
 */
export function calloutOpacity(rank: number, stackedOff: boolean, labelShown: boolean): { label: number; line: number; ring: number } {
  if (!labelShown || rank < 0 || rank >= RANK_OPACITY.length) return { label: 0, line: 0, ring: 0 };
  const op = stackedOff ? 0 : RANK_OPACITY[rank];
  return { label: op, line: op * 0.9, ring: rank === 0 ? 1 : op * 0.6 };
}

interface CalloutEl {
  el: HTMLDivElement;
  line: SVGLineElement;
  ring: SVGCircleElement;
  seen: number;
}

export class Overlays {
  private callouts = new Map<string, CalloutEl>();
  private datumEls: { code: HTMLDivElement; tick: SVGPathElement; dash: SVGLineElement; y: number; level: string }[] = [];
  private rulerLine: SVGLineElement;
  private hbox: HTMLDivElement;
  private frameNo = 0;
  /** The reach labels; null on a project with no tower crane. */
  private reachEl: HTMLDivElement | null = null;
  private pickEl: HTMLDivElement | null = null;
  /** Emphasised for the crane plan; hidden while an issue outside the crane checks is explained. */
  reachMode: ReachMode = 'normal';
  /** Utilisation from which a pick reads amber (the checks' review threshold). */
  liftWarn = 0.85;
  /** Rigging added to each pick (the checks' allowance). */
  liftRigKg = 0;
  /** Where each reach label hung last frame (so it slides rather than hops). */
  private reachAt: { k: number; corner: number } | null = null;
  private pickAt: { k: number; corner: number } | null = null;
  private controlBoxes: Obstacle[] = [];
  /** When the controls were last measured (performance.now), so a page that draws a frame only now and then never places labels against stale boxes. */
  private controlsAt = -Infinity;
  /**
   * The selected issue's box in the world (lo, hi), or null: while an issue is
   * explained the member callouts step aside and datums across it fade.
   */
  issueBox: [[number, number, number], [number, number, number]] | null = null;
  private bounds: { lo: [number, number, number]; hi: [number, number, number] };

  constructor(
    private svg: SVGSVGElement,
    private html: HTMLElement,
    project: Project,
    _timeline: Timeline,
    private viewer: Viewer,
  ) {
    this.rulerLine = this.svgEl('line', { style: 'stroke: var(--brand)', 'stroke-width': '1.4' });
    for (const lv of project.levels) {
      const code = document.createElement('div');
      code.className = 'datum';
      code.innerHTML = `<span class="code"></span><span class="val">${Math.abs(lv.y) < 0.005 ? '±0.00' : `${lv.y > 0 ? '+' : '−'}${Math.abs(lv.y).toFixed(2)}`}</span>`;
      code.firstElementChild!.textContent = lv.code;
      html.append(code);
      const tick = this.svgEl('path', { style: 'stroke: var(--brand)', 'stroke-width': '1.4', fill: 'none' });
      const dash = this.svgEl('line', { style: 'stroke: var(--muted)', 'stroke-width': '1', 'stroke-dasharray': '2 3' });
      this.datumEls.push({ code, tick, dash, y: lv.y, level: lv.code });
    }
    this.hbox = document.createElement('div');
    this.hbox.className = 'hbox';
    this.hbox.textContent = `H = ${project.height.toFixed(1)} m`;
    html.append(this.hbox);
    // the crane's reach (the slew circle) and the current pick's radius
    const c = project.crane;
    if (c) {
      const knee = chartKnee(c);
      const t = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toFixed(1).replace(/\.0$/, '')} t` : `${Math.round(kg)} kg`);
      this.reachEl = document.createElement('div');
      this.reachEl.className = 'reach-label';
      this.reachEl.innerHTML = '<b></b><span></span>';
      this.reachEl.firstElementChild!.textContent = `${c.id} · REACH ${c.jib} m`;
      this.reachEl.lastElementChild!.textContent = `${t(c.maxKg)} to ${knee.toFixed(0)} m · ${t(c.tipKg)} at the tip · tail ${c.counterJib} m`;
      this.pickEl = document.createElement('div');
      this.pickEl.className = 'reach-label pick';
      this.pickEl.innerHTML = '<b></b><span></span>';
      html.append(this.reachEl, this.pickEl);
    }
    this.project = project;
    this.bounds = modelBounds(project);
  }

  private project: Project;

  /**
   * Forget the measured controls: called when a drawer, the banner, the
   * caption or the view's mode changes, so the next frame (perhaps the last
   * one drawn before the page goes idle) places the labels against them.
   */
  chromeChanged() {
    this.controlsAt = -Infinity;
  }

  /** The opening frame's large Play button, as of the last read of the controls: the member callouts it would cover are left out. */
  private heroBox: Box | null = null;

  /** The viewport's controls in overlay pixels; they move only on resize, a drawer, the banner or the caption, so a few reads a second do (and chromeChanged clears them at once). */
  private controls(host: DOMRect): Obstacle[] {
    const now = performance.now();
    if (now - this.controlsAt < CHROME_TTL) return this.controlBoxes;
    this.controlsAt = now;
    const out: Obstacle[] = [];
    const root = this.html.parentElement ?? document;
    this.heroBox = null;
    for (const el of root.querySelectorAll<HTMLElement>('.toolbar, #caption, #titleBlock, #scaleBar, #scrubber, #transport, #drawer, #loading, #liftBanner, #heroPlay')) {
      if (el.hidden || el.style.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const box = { x0: r.left - host.left - 6, y0: r.top - host.top - 6, x1: r.right - host.left + 6, y1: r.bottom - host.top + 6, weight: Infinity };
      out.push(box);
      if (el.id === 'heroPlay') this.heroBox = box;
    }
    return (this.controlBoxes = out);
  }

  /**
   * The selected issue's pin and tag (drawn by the Issues pane on its own
   * layer): the subject being explained, so the crane's labels must not
   * cover any of it.
   */
  private issuePin(host: DOMRect): Obstacle[] {
    const root = this.html.parentElement ?? document;
    const out: Obstacle[] = [];
    for (const el of root.querySelectorAll<SVGGraphicsElement>('#issueSvg .pin circle, #issueSvg .pin rect')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out.push({ x0: r.left - host.left - 8, y0: r.top - host.top - 8, x1: r.right - host.left + 8, y1: r.bottom - host.top + 8, weight: Infinity });
    }
    return out;
  }

  /** Annotation already drawn: level datums and member callouts (by how strongly they show), and the building as built so far. */
  private annotation(host: DOMRect, builtTop: number): Obstacle[] {
    const out: Obstacle[] = [];
    for (const el of this.html.querySelectorAll<HTMLElement>('.callout, .datum, .hbox')) {
      const op = el.style.opacity === '' ? 1 : parseFloat(el.style.opacity);
      if (!(op > 0.05)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out.push({ x0: r.left - host.left - 4, y0: r.top - host.top - 4, x1: r.right - host.left + 4, y1: r.bottom - host.top + 4, weight: Math.min(1, op + 0.2) });
    }
    // labels read better on the ground beside the building than over its linework
    const { lo, hi } = this.bounds;
    const top = Math.min(hi[1], Math.max(lo[1] + 0.5, builtTop));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const q = this.viewer.project([i & 1 ? hi[0] : lo[0], i & 2 ? top : lo[1], i & 4 ? hi[2] : lo[2]]);
      if (q.behind) return out;
      x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
    }
    if (Number.isFinite(x0)) out.push({ x0, y0, x1, y1, weight: 0.35 });
    return out;
  }

  /**
   * The reach labels hang from their circles: the pick's at the bearing of the
   * piece, the reach's at the side nearest the viewer, each slid round to the
   * nearest spot clear of the controls and over as little annotation as it can.
   */
  private updateReach(s: CraneState, shown: boolean, w: number, h: number, builtTop: number) {
    const c = this.project.crane;
    const reachEl = this.reachEl, pickEl = this.pickEl;
    if (!c || !reachEl || !pickEl) return;
    const visible = shown && s.visible && s.headVisible && this.reachMode !== 'hidden';
    reachEl.hidden = !visible;
    pickEl.hidden = !visible || !s.pick;
    const emph = this.reachMode === 'emph';
    reachEl.classList.toggle('emph', emph);
    pickEl.classList.toggle('emph', emph);
    if (!visible) return;
    const host = this.html.getBoundingClientRect();
    const obstacles = [...this.controls(host), ...this.issuePin(host), ...this.annotation(host, builtTop)];
    const screen = { x0: 8, y0: 8, x1: w - 8, y1: h - 8 };
    // the slew circle lies on the ground; the pick's ring at the piece's own level, or on the ground in the crane plan (as the reach overlay draws them)
    const ring = (r: number, y = 0.05): RingPoint[] => {
      const out: RingPoint[] = [];
      for (let k = 0; k < 120; k++) {
        const a = (k / 120) * Math.PI * 2;
        const q = this.viewer.project([c.base[0] + Math.cos(a) * r, y, c.base[2] + Math.sin(a) * r]);
        out.push({ x: q.x, y: q.y, a, behind: q.behind });
      }
      return out;
    };
    const hang = (el: HTMLDivElement, at: { x: number; y: number } | null) => {
      el.style.opacity = at ? '' : '0';
      if (at) el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
    };
    const pick = s.pick;
    if (pick) {
      const lift = reviewedLift(pick.kg, pick.capKg, this.liftRigKg);
      const level = liftLevel(lift.util, this.liftWarn);
      pickEl.dataset.level = level;
      pickEl.classList.toggle('idle', !pick.active);
      const kg = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} t` : `${Math.round(v / 10) * 10} kg`);
      // the ring eases with the jib as it slews; the label reads the active pick's own radius, next to its own load
      const trueR = Math.hypot(pick.at[0] - c.base[0], pick.at[2] - c.base[2]);
      pickEl.firstElementChild!.textContent = `R ${trueR.toFixed(1)} m${level === 'over' ? ' ✗' : level === 'warn' ? ' ⚠' : ''}`;
      pickEl.lastElementChild!.textContent = pick.capKg > 0 ? `${kg(lift.kg)} of ${kg(pick.capKg)} · ${Math.round(lift.util * 100)} %` : 'beyond the jib';
      const bearing = Math.atan2(pick.at[2] - c.base[2], pick.at[0] - c.base[0]);
      const size = { w: pickEl.offsetWidth, h: pickEl.offsetHeight };
      const at = placeOnRing(ring(Math.max(0.5, pick.radius), emph ? 0.05 : Math.max(0.05, pick.at[1])), size, screen, obstacles, bearing, this.pickAt);
      this.pickAt = at;
      hang(pickEl, at);
      // the reach label keeps off the pick's
      if (at) obstacles.push({ x0: at.x - 6, y0: at.y - 6, x1: at.x + size.w + 6, y1: at.y + size.h + 6, weight: 2 });
    } else this.pickAt = null;
    const cam = this.viewer.camera.position;
    const towardViewer = Math.atan2(cam.z - c.base[2], cam.x - c.base[0]);
    const at = placeOnRing(ring(c.jib), { w: reachEl.offsetWidth, h: reachEl.offsetHeight }, screen, obstacles, towardViewer, this.reachAt);
    this.reachAt = at;
    hang(reachEl, at);
  }

  private svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    this.svg.append(e);
    return e;
  }

  update(state: SequenceState, craneShown = true) {
    this.frameNo++;
    const { w, h } = this.viewer.viewportSize;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const host = this.html.getBoundingClientRect();
    const plan = planLike(this.reachMode, this.viewer.readout().el);
    const issue = this.issueBox ? this.screenBox(this.issueBox) : null;
    this.updateDatums(state, w, h, this.controls(host), plan, issue);
    // the member callouts give way to a plan and to the issue being explained
    this.updateCallouts(state, w, h, plan || !!this.issueBox);
    this.updateReach(state.crane, craneShown, w, h, state.builtTop);
  }

  /** A world box's extent on screen, or null when part of it is behind the camera. */
  private screenBox([lo, hi]: [[number, number, number], [number, number, number]]): Box | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const q = this.viewer.project([i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]);
      if (q.behind) return null;
      x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
    }
    return { x0: x0 - 6, y0: y0 - 6, x1: x1 + 6, y1: y1 + 6 };
  }

  private updateDatums(state: SequenceState, w: number, h: number, chrome: Box[], plan: boolean, issue: Box | null) {
    const x = w - DATUM_RIGHT;
    const rows = this.datumEls.map((d) => {
      const p = this.viewer.project([0, d.y, 0]);
      const reached = d.level === 'TOP' ? state.complete || state.builtTop >= d.y - 0.01 : state.builtTop >= d.y - 0.05;
      const visible = !p.behind && p.y > 70 && p.y < h - 150;
      // the code, the tick and the value, as drawn below
      return { y: p.y, box: { x0: x - DATUM_HALF, y0: p.y - 9, x1: x + DATUM_HALF, y1: p.y + 8 }, op: !visible ? 0 : reached ? 1 : 0.28 };
    });
    const ops = datumOpacity(rows, { plan, blocked: chrome, issue });
    let topY = Infinity;
    let botY = -Infinity;
    this.datumEls.forEach((d, i) => {
      const { y } = rows[i];
      const op = ops[i];
      d.code.style.opacity = String(op);
      d.tick.style.opacity = String(op);
      d.dash.style.opacity = String(op * 0.8);
      d.code.style.transform = `translate(${x - 66}px, ${y - 9}px)`;
      d.code.style.width = '140px';
      d.tick.setAttribute('d', `M${x - 6} ${y + 6}L${x + 6} ${y - 6}M${x - 7} ${y}H${x + 7}`);
      d.dash.setAttribute('x1', String(x - DATUM_HALF));
      d.dash.setAttribute('x2', String(x - 10));
      d.dash.setAttribute('y1', String(y));
      d.dash.setAttribute('y2', String(y));
      if (op > 0.2) {
        topY = Math.min(topY, y);
        botY = Math.max(botY, y);
      }
      // codes sit left of the line, values right of it
      (d.code.firstElementChild as HTMLElement).style.cssText = 'display:inline-block;width:60px;text-align:right;margin-right:14px';
    });
    // the overall height, above the top of the ladder (the top datum, or the highest one a card leaves showing) and clear of the cards
    const top = this.datumEls.findIndex((d) => d.level === 'TOP');
    const shownTop = top >= 0 && ops[top] > 0.2 ? top : rows.reduce((k, r, i) => (ops[i] > 0.2 && (k < 0 || r.y < rows[k].y) ? i : k), -1);
    const size = { w: this.hbox.offsetWidth || 96, h: this.hbox.offsetHeight || 18 };
    const at = state.complete && !plan && shownTop >= 0 ? heightBoxAt({ x: x - 52, y: Math.min(rows[top >= 0 ? top : shownTop].y, rows[shownTop].y) - 40 }, size, rows[shownTop].y - 9, chrome, h - 150) : null;
    this.hbox.style.opacity = at ? '1' : '0';
    if (at) this.hbox.style.transform = `translate(${at.x}px, ${at.y}px)`;
    const ruler = Number.isFinite(topY);
    this.rulerLine.style.opacity = ruler ? '' : '0';
    if (ruler) {
      this.rulerLine.setAttribute('x1', String(x));
      this.rulerLine.setAttribute('x2', String(x));
      this.rulerLine.setAttribute('y1', String(topY - 14));
      this.rulerLine.setAttribute('y2', String(botY + 14));
    }
  }

  private updateCallouts(state: SequenceState, w: number, h: number, quiet = false) {
    const recent = quiet ? [] : state.callouts.slice(0, RANK_OPACITY.length);
    const ids = new Set(recent.map((s) => s.key));
    for (const [id, c] of this.callouts) {
      if (!ids.has(id)) {
        c.el.remove();
        c.line.remove();
        c.ring.remove();
        this.callouts.delete(id);
      }
    }
    const placed: { item: Callout; c: CalloutEl; ax: number; ay: number; side: 'l' | 'r'; y: number; rank: number; hidden?: boolean }[] = [];
    recent.forEach((item, rank) => {
      let c = this.callouts.get(item.key);
      if (!c) {
        const el = document.createElement('div');
        el.className = 'callout';
        el.innerHTML = `<b></b><span></span>`;
        el.firstElementChild!.textContent = item.member;
        el.lastElementChild!.textContent = item.spec;
        el.style.opacity = '0';
        this.html.append(el);
        c = { el, line: this.svgEl('line', { style: 'stroke: var(--brand)', 'stroke-width': '1' }), ring: this.svgEl('circle', { r: '4.5', fill: 'none', style: 'stroke: var(--brand)', 'stroke-width': '1.4' }), seen: this.frameNo };
        this.callouts.set(item.key, c);
      }
      const a = this.viewer.project(item.anchor);
      // the tower sits right of centre; only a wide viewport has room for labels on its right
      const side = w > 1150 && a.x > w * 0.5 ? 'r' : 'l';
      placed.push({ item, c, ax: a.x, ay: a.y, side, y: a.y - 24, rank });
    });
    // de-overlap per side, below the caption card; on the left below an open drawer too, on the right below the title block
    const bottom = (id: string) => {
      const el = document.getElementById(id);
      return el && !el.hidden && el.style.visibility !== 'hidden' && el.offsetHeight > 0 ? el.offsetTop + el.offsetHeight + 16 : 80;
    };
    const capY = bottom('caption');
    const minYs = { l: Math.max(capY, bottom('drawer')), r: Math.max(capY, bottom('titleBlock')) };
    const maxY = h - 260; // stay clear of the scale bar and transport
    for (const side of ['l', 'r'] as const) {
      const minY = minYs[side];
      const list = placed.filter((p) => p.side === side).sort((a, b) => a.y - b.y);
      let cursor = minY;
      for (const p of list) {
        p.y = Math.max(p.y, cursor);
        cursor = p.y + 46;
      }
      // pull the stack back up from the bottom limit; whatever no longer fits is hidden
      let limit = maxY;
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].y = Math.min(list[i].y, limit);
        limit = list[i].y - 46;
      }
      for (const p of list) p.hidden = p.y < minY - 1;
    }
    for (const p of placed) {
      const { c, rank } = p;
      const fresh = this.frameNo - c.seen < 2;
      c.el.className = `callout rank-${rank}`;
      c.line.setAttribute('class', `rank-${rank}`);
      c.ring.setAttribute('class', `rank-${rank}`);
      c.el.style.color = rank === 0 ? 'var(--ink)' : 'var(--muted)';
      (c.el.lastElementChild as HTMLElement).style.color = rank === 0 ? 'var(--brand)' : 'var(--brand-soft)';
      // a label the stylesheet hides (a narrow screen) lays out at no width: its leader and ring would point from nothing
      const width = c.el.offsetWidth;
      const x = p.side === 'l' ? 24 : w - width - 186;
      // the opening frame's large Play button is not drawn over a label (nor its leader drawn across the button)
      const hb = this.heroBox;
      const underHero = !!hb && x < hb.x1 && x + width > hb.x0 && p.y < hb.y1 && p.y + c.el.offsetHeight > hb.y0;
      const op = calloutOpacity(rank, !!p.hidden || underHero, width > 0);
      c.el.style.opacity = fresh ? '0' : String(op.label);
      c.el.style.transform = `translate(${x}px, ${p.y}px)`;
      const lx = p.side === 'l' ? x + width : x;
      const ly = p.y + 18;
      c.line.setAttribute('x1', String(lx));
      c.line.setAttribute('y1', String(ly));
      c.line.setAttribute('x2', String(p.ax));
      c.line.setAttribute('y2', String(p.ay));
      c.ring.setAttribute('cx', String(p.ax));
      c.ring.setAttribute('cy', String(p.ay));
      c.line.style.opacity = String(op.line);
      c.ring.style.opacity = String(op.ring);
    }
  }
}
