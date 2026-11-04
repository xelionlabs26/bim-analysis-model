import type { SequenceState, Timeline } from '../engine/timeline';
import type { Project, Step } from '../data/types';
import type { Viewer } from '../scene/viewer';

const SCALES = [50, 75, 100, 125, 150, 200, 250, 300, 400, 500];
const BAR_LENGTHS = [1, 2, 2.5, 5, 10, 20];
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
  private callouts = new Map<number, CalloutEl>();
  private datumEls: { code: HTMLDivElement; tick: SVGPathElement; dash: SVGLineElement; y: number; level: string }[] = [];
  private rulerLine: SVGLineElement;
  private hbox: HTMLDivElement;
  private frameNo = 0;

  constructor(
    private svg: SVGSVGElement,
    private html: HTMLElement,
    project: Project,
    private timeline: Timeline,
    private viewer: Viewer,
  ) {
    this.rulerLine = this.svgEl('line', { stroke: '#9d1125', 'stroke-width': '1.4' });
    for (const lv of project.levels) {
      const code = document.createElement('div');
      code.className = 'datum';
      code.innerHTML = `<span class="code">${lv.code}</span><span class="val">${lv.y === 0 ? '±0.00' : `+${lv.y.toFixed(2)}`}</span>`;
      html.append(code);
      const tick = this.svgEl('path', { stroke: '#9d1125', 'stroke-width': '1.4', fill: 'none' });
      const dash = this.svgEl('line', { stroke: '#8b8178', 'stroke-width': '1', 'stroke-dasharray': '2 3' });
      this.datumEls.push({ code, tick, dash, y: lv.y, level: lv.code });
    }
    this.hbox = document.createElement('div');
    this.hbox.className = 'hbox';
    this.hbox.textContent = `H = ${project.height.toFixed(2)} m`;
    html.append(this.hbox);
  }

  private svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    this.svg.append(e);
    return e;
  }

  update(state: SequenceState) {
    this.frameNo++;
    const { w, h } = this.viewer.viewportSize;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.updateDatums(state, w, h);
    this.updateCallouts(state, w, h);
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
    const recent = this.timeline.recentSteps(state.t, RANK_OPACITY.length);
    const ids = new Set(recent.map((s) => s.index));
    for (const [id, c] of this.callouts) {
      if (!ids.has(id)) {
        c.el.remove();
        c.line.remove();
        c.ring.remove();
        this.callouts.delete(id);
      }
    }
    const placed: { step: Step; c: CalloutEl; ax: number; ay: number; side: 'l' | 'r'; y: number; rank: number }[] = [];
    recent.forEach((step, rank) => {
      let c = this.callouts.get(step.index);
      if (!c) {
        const el = document.createElement('div');
        el.className = 'callout';
        el.innerHTML = `<b>${step.member}</b><span>${step.spec}</span>`;
        el.style.opacity = '0';
        this.html.append(el);
        c = { el, line: this.svgEl('line', { stroke: '#9d1125', 'stroke-width': '1' }), ring: this.svgEl('circle', { r: '4.5', fill: 'none', stroke: '#9d1125', 'stroke-width': '1.4' }), seen: this.frameNo };
        this.callouts.set(step.index, c);
      }
      const a = this.viewer.project(step.centroid);
      const side = a.x < w * 0.5 ? 'l' : 'r';
      placed.push({ step, c, ax: a.x, ay: a.y, side, y: a.y - 24, rank });
    });
    // de-overlap per side
    const minY = 210;
    const maxY = h - 200;
    for (const side of ['l', 'r'] as const) {
      const list = placed.filter((p) => p.side === side).sort((a, b) => a.y - b.y);
      let cursor = minY;
      for (const p of list) {
        p.y = Math.min(Math.max(p.y, cursor), maxY);
        cursor = p.y + 46;
      }
    }
    for (const p of placed) {
      const { c, rank } = p;
      const op = RANK_OPACITY[rank];
      const fresh = this.frameNo - c.seen < 2;
      c.el.style.opacity = fresh ? '0' : String(op);
      c.el.style.color = rank === 0 ? 'var(--ink)' : '#9a9089';
      (c.el.lastElementChild as HTMLElement).style.color = rank === 0 ? 'var(--brand)' : '#c79aa1';
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
