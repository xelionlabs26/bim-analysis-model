import type { Callout, CraneState, SequenceState, Timeline } from '../engine/timeline';
import { chartKnee, liftLevel, reviewedLift, type Project } from '../data/types';
import type { Viewer } from '../scene/viewer';
import type { ReachMode } from '../scene/reach';
import { modelBounds } from '../checks/view';
import { placeOnRing, type Obstacle, type RingPoint } from './place';

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
  private controlsFrame = -Infinity;
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

  /** The viewport's controls in overlay pixels; they move only on resize or when the caption's text wraps, so a few reads a second do. */
  private controls(host: DOMRect): Obstacle[] {
    if (this.frameNo - this.controlsFrame < 12) return this.controlBoxes;
    this.controlsFrame = this.frameNo;
    const out: Obstacle[] = [];
    const root = this.html.parentElement ?? document;
    for (const el of root.querySelectorAll<HTMLElement>('.toolbar, #caption, #titleBlock, #scaleBar, #scrubber, #transport, #drawer, #loading, #liftBanner')) {
      if (el.hidden || el.style.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out.push({ x0: r.left - host.left - 6, y0: r.top - host.top - 6, x1: r.right - host.left + 6, y1: r.bottom - host.top + 6, weight: Infinity });
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
    this.updateDatums(state, w, h);
    this.updateCallouts(state, w, h);
    this.updateReach(state.crane, craneShown, w, h, state.builtTop);
  }

  private updateDatums(state: SequenceState, w: number, h: number) {
    const x = w - 96;
    let topY = Infinity;
    let botY = -Infinity;
    for (const d of this.datumEls) {
      const p = this.viewer.project([0, d.y, 0]);
      const reached = d.level === 'TOP' ? state.complete || state.builtTop >= d.y - 0.01 : state.builtTop >= d.y - 0.05;
      const visible = p.y > 70 && p.y < h - 150;
      const op = !visible ? 0 : reached ? 1 : 0.28;
      d.code.style.opacity = String(op);
      d.tick.style.opacity = String(op);
      d.dash.style.opacity = String(op * 0.8);
      d.code.style.transform = `translate(${x - 66}px, ${p.y - 9}px)`;
      d.code.style.width = '140px';
      d.tick.setAttribute('d', `M${x - 6} ${p.y + 6}L${x + 6} ${p.y - 6}M${x - 7} ${p.y}H${x + 7}`);
      d.dash.setAttribute('x1', String(x - 74));
      d.dash.setAttribute('x2', String(x - 10));
      d.dash.setAttribute('y1', String(p.y));
      d.dash.setAttribute('y2', String(p.y));
      if (visible) {
        topY = Math.min(topY, p.y);
        botY = Math.max(botY, p.y);
      }
      // codes sit left of the line, values right of it
      (d.code.firstElementChild as HTMLElement).style.cssText = 'display:inline-block;width:60px;text-align:right;margin-right:14px';
    }
    const top = this.datumEls.find((d) => d.level === 'TOP')!;
    const pTop = this.viewer.project([0, top.y, 0]);
    this.hbox.style.opacity = state.complete ? '1' : '0';
    this.hbox.style.transform = `translate(${x - 52}px, ${pTop.y - 40}px)`;
    if (Number.isFinite(topY)) {
      this.rulerLine.setAttribute('x1', String(x));
      this.rulerLine.setAttribute('x2', String(x));
      this.rulerLine.setAttribute('y1', String(topY - 14));
      this.rulerLine.setAttribute('y2', String(botY + 14));
    }
  }

  private updateCallouts(state: SequenceState, w: number, h: number) {
    const recent = state.callouts.slice(0, RANK_OPACITY.length);
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
    // de-overlap per side, below the caption card
    const cap = document.getElementById('caption');
    const minY = cap && cap.style.visibility !== 'hidden' ? cap.offsetTop + cap.offsetHeight + 16 : 80;
    const maxY = h - 260; // stay clear of the scale bar and transport
    for (const side of ['l', 'r'] as const) {
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
      const op = p.hidden ? 0 : RANK_OPACITY[rank];
      const fresh = this.frameNo - c.seen < 2;
      c.el.className = `callout rank-${rank}`;
      c.line.setAttribute('class', `rank-${rank}`);
      c.ring.setAttribute('class', `rank-${rank}`);
      c.el.style.opacity = fresh ? '0' : String(op);
      c.el.style.color = rank === 0 ? 'var(--ink)' : 'var(--muted)';
      (c.el.lastElementChild as HTMLElement).style.color = rank === 0 ? 'var(--brand)' : 'var(--brand-soft)';
      const width = c.el.offsetWidth;
      const x = p.side === 'l' ? 24 : w - width - 186;
      c.el.style.transform = `translate(${x}px, ${p.y}px)`;
      const lx = p.side === 'l' ? x + width : x;
      const ly = p.y + 18;
      c.line.setAttribute('x1', String(lx));
      c.line.setAttribute('y1', String(ly));
      c.line.setAttribute('x2', String(p.ax));
      c.line.setAttribute('y2', String(p.ay));
      c.ring.setAttribute('cx', String(p.ax));
      c.ring.setAttribute('cy', String(p.ay));
      c.line.style.opacity = String(op * 0.9);
      c.ring.style.opacity = String(rank === 0 ? 1 : op * 0.6);
    }
  }
}
