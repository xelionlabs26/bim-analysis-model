import { fmtCarbon, fmtInt, fmtMass, pad2, type SequenceState, type Timeline } from '../engine/timeline';
import { liftingLabel, liftLevel, reviewedLift, type Project, type Step } from '../data/types';
import { stripScroll } from './layout';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface PerfSample {
  fps: number;
  draws: number;
  tris: number;
  res: number;
}

/**
 * The operation panel's lift line for a step. `craneId` is the tower crane's,
 * or null on a project without one, where crane picks go in by mobile crane
 * (the checks read those against the mobile crane's chart).
 */
export function liftText(step: Step | null, craneId: string | null = 'TC-1', warnAt = 0.85, riggingKg = 0): { text: string; level: 'ok' | 'warn' | 'over' | 'none' } {
  if (!step) return { text: '—', level: 'none' };
  if (step.method === 'cast') return { text: step.motion === 'bore' ? 'bored in situ · piling rig' : 'cast in place · pump + formwork', level: 'none' };
  if (step.method === 'manual') return { text: 'by hand · site team', level: 'none' };
  if (craneId === null) return { text: 'mobile crane · set up beside the building', level: 'none' };
  const l = step.lift;
  if (!l) return { text: `${craneId} · bulk bags`, level: 'none' };
  const { kg, util } = reviewedLift(l.pieceKg, l.capacityKg, riggingKg);
  const pct = Math.round(util * 100);
  const level = liftLevel(util, warnAt);
  const tail = level === 'over' ? ' ✗ over chart' : level === 'warn' ? ' ⚠' : '';
  if (l.capacityKg <= 0) return { text: `${craneId} · R ${l.radius.toFixed(1)} m · beyond the jib ✗`, level: 'over' };
  return { text: `${craneId} · R ${l.radius.toFixed(1)} m · ${fmtTonnes(kg)} of ${fmtTonnes(l.capacityKg)} · ${pct} %${tail}`, level };
}

/**
 * The build log's lines: the last `limit` events, without the frame-rate lines
 * unless the performance overlay is on (non-experts read them as errors).
 */
export function visibleLog<E extends { kind: string }>(events: E[], showPerf: boolean, limit: number): E[] {
  return (showPerf ? events : events.filter((e) => e.kind !== 'PERF')).slice(-limit);
}

/** What the scrubber (a slider) reads out: the step and the time. */
export function scrubberText(t: number, duration: number, stepsDone: number, steps: number): string {
  return `Step ${stepsDone} of ${steps} · ${t.toFixed(1)} s of ${duration.toFixed(1)} s`;
}

const fmtTonnes = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg / 10) * 10} kg`);

/** All DOM that is a pure function of the sequence state. */
export class SequenceUI {
  private ganttRows: { el: HTMLElement; pills: HTMLElement[]; pct: HTMLElement }[] = [];
  private stack: HTMLElement[] = [];
  private zoneRows: HTMLElement[] = [];
  private cards: HTMLElement[] = [];
  private memberRows: HTMLElement[] = [];
  private lastLogKey = '';
  private lastMemberUpdate = -1;
  private passTotals: ReturnType<Timeline['presentation']['passTotals']>[] = [];
  perf: PerfSample = { fps: 60, draws: 3, tris: 0, res: 1.5 };
  /** Whether the log shows the frame-rate lines (the performance overlay is on). */
  private showPerf = false;
  /** Last values given to the scrubber's ARIA attributes, so they are only written when they change. */
  private lastScrub = '';
  private lastCard = -1;
  /** Utilisation that needs a lift plan review; follows the checks' threshold. */
  liftWarn = 0.85;
  /** Rigging added to each pick (the checks' allowance). */
  liftRigKg = 0;

  constructor(
    private p: Project,
    private tl: Timeline,
    private onSeek: (t: number) => void,
    private onSeekStep: (index: number) => void,
  ) {
    this.passTotals = [tl.presentation.passTotals(1), tl.presentation.passTotals(2)];
    this.buildGantt();
    this.buildStructure();
    this.buildCards();
    this.buildMembers();
    this.buildScrubber();
    $('crumb').innerHTML = `${p.id} ▸ <b>Assembly</b> · ${p.steps.length} steps · ${fmtInt(p.parts.length)} parts`;
    $('stagesMeta').textContent = `${p.stages.length} STAGES · ${p.steps.length} STEPS · ${Math.round(p.duration)} SEC SEQUENCE`;
    $('statusStageTotal').textContent = String(p.stages.length);
    $('carbonNote').textContent = `Indicative A1–A3 from generic factors · ${fmtInt(p.gifa)} m² GIA`;
  }

  private buildGantt() {
    const g = $('gantt');
    const D = this.p.duration;
    g.innerHTML = '';
    for (const st of this.p.stages) {
      const row = document.createElement('div');
      row.className = 'g-row';
      const n = this.p.steps.filter((s) => s.stage === st.n).length;
      const pillsN = st.kind === 'assembly' ? Math.max(3, Math.ceil(n / 5)) : st.kind === 'material' ? 4 : 7;
      const track = `<div class="g-track"><div class="g-bar" style="left:${(st.start / D) * 100}%;width:${((st.end - st.start) / D) * 100}%">${'<i></i>'.repeat(pillsN)}</div></div>`;
      row.innerHTML = `<span class="lab"><i>${pad2(st.n)}</i><em></em></span>${track}<span class="pct">0%</span>`;
      row.querySelector('.lab em')!.textContent = st.code;
      g.append(row);
      this.ganttRows.push({ el: row, pills: [...row.querySelectorAll<HTMLElement>('.g-bar i')], pct: row.querySelector('.pct')! });
    }
    const head = document.createElement('div');
    head.className = 'g-head';
    head.id = 'ganttHead';
    g.append(head);
  }

  private buildStructure() {
    const zones = [...this.p.zones].reverse(); // top zone first
    const stack = $('zoneStack');
    const tbl = $('zoneTable');
    stack.innerHTML = '';
    tbl.innerHTML = '';
    const lo = Math.min(...zones.map((z) => z.y0));
    const hi = Math.max(...zones.map((z) => z.y1));
    const total = Math.max(1e-6, hi - lo);
    zones.forEach((zone, i) => {
      const bar = document.createElement('i');
      bar.style.height = `${(Math.max(zone.y1 - zone.y0, total * 0.04) / total) * 100}%`;
      const k = zones.length - 1 - i; // 0 at the bottom
      bar.style.width = k === 0 ? '100%' : i === 0 && zones.length > 2 ? '58%' : `${Math.max(56, 88 - k * 6)}%`;
      bar.innerHTML = '<b></b>';
      stack.append(bar);
      this.stack.push(bar);
      const row = document.createElement('div');
      row.innerHTML = `<span></span><span>0 / ${this.tl.zoneTotal[zone.id]}</span>`;
      row.firstElementChild!.textContent = zone.label;
      tbl.append(row);
      this.zoneRows.push(row);
    });
  }

  private buildCards() {
    const wrap = $('stageCards');
    wrap.innerHTML = '';
    wrap.style.setProperty('--n', String(this.p.stages.length));
    for (const st of this.p.stages) {
      const b = document.createElement('button');
      b.className = 'scard';
      b.title = `Jump to ${st.title}`;
      b.innerHTML = `<div class="thumb"><img alt="" hidden /><span class="chip-t">${st.start.toFixed(1)}s</span><span class="chip-s">${st.sheet}</span></div>
        <div class="meta"><b></b><span></span></div><i class="prog"></i>`;
      b.querySelector('.meta b')!.textContent = `${pad2(st.n)}. ${st.title}`;
      b.querySelector('.meta span')!.textContent = st.subtitle;
      b.addEventListener('click', () => this.onSeek(st.start + 0.001));
      wrap.append(b);
      this.cards.push(b);
    }
  }

  /**
   * Scroll a narrow screen's stage strip (it scrolls sideways) so the current
   * card shows. The strip itself scrolls, never the page: scrollIntoView would
   * also move the page under a reader.
   */
  private showCard(card: HTMLElement) {
    const wrap = card.parentElement;
    if (!wrap) return;
    const c = card.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    const left = stripScroll({ left: c.left, width: c.width }, { left: w.left, width: wrap.clientWidth, scrollLeft: wrap.scrollLeft, scrollWidth: wrap.scrollWidth });
    if (left === null) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    wrap.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' });
  }

  /** Show or hide the frame-rate lines in the log (redrawn on the next update). */
  setShowPerf(on: boolean) {
    this.showPerf = on;
    this.lastLogKey = '';
  }

  setThumbnail(stageIndex: number, url: string) {
    const img = this.cards[stageIndex].querySelector('img')!;
    img.src = url;
    img.hidden = false;
  }

  private buildMembers() {
    const list = $('memberList');
    list.innerHTML = '';
    for (const s of this.p.steps) {
      // a button: the row seeks to its step from the keyboard too
      const r = document.createElement('button');
      r.type = 'button';
      r.className = 'm-row ghost';
      r.dataset.search = `${s.id} ${s.member} ${s.code} ${s.material} ${s.zone}`.toLowerCase();
      r.innerHTML = `<span>${s.id}</span><span class="nm" title="${esc(s.member)}">${esc(s.member)}</span><span>${s.partCount} pcs</span><span class="st">GHOST</span>`;
      r.addEventListener('click', () => this.onSeekStep(s.index));
      list.append(r);
      this.memberRows.push(r);
    }
    this.filterMembers($<HTMLInputElement>('memberSearch').value);
  }

  filterMembers(raw: string) {
    const q = raw.trim().toLowerCase();
    for (const r of this.memberRows) r.hidden = !!q && !r.dataset.search!.includes(q);
  }

  private buildScrubber() {
    const ticks = $('scrubTicks');
    const track = $('scrubTrack');
    const D = this.p.duration;
    track.setAttribute('aria-valuemax', D.toFixed(1));
    this.lastScrub = '';
    ticks.innerHTML = '';
    track.querySelectorAll('.scrub-tick').forEach((t) => t.remove());
    for (const st of this.p.stages) {
      ticks.insertAdjacentHTML('beforeend', `<span style="left:${(st.start / D) * 100}%"></span>`);
      ticks.lastElementChild!.textContent = st.tick;
      track.insertAdjacentHTML('beforeend', `<span class="scrub-tick" style="left:${(st.start / D) * 100}%"></span>`);
    }
    ticks.insertAdjacentHTML('beforeend', `<span style="left:calc(100% - 30px)">END</span>`);
    fitScrubberLabels();
    if (!scrubObserver && typeof ResizeObserver !== 'undefined') {
      scrubObserver = new ResizeObserver(() => fitScrubberLabels());
      scrubObserver.observe(ticks);
      void document.fonts?.ready.then(fitScrubberLabels);
    }
  }

  /** Caption and operation card while the material pass or the section is running. */
  private updatePresentation(s: SequenceState) {
    const p = this.p;
    const pres = s.presentation;
    const st = p.stages[s.stage - 1];
    const shot = pres.shot;
    $('capMember').textContent = shot?.title ?? st.title;
    $('capSpec').textContent = shot?.spec ?? st.subtitle;
    $('opMember').textContent = shot?.title ?? st.title;
    $('opStep').textContent = shot?.id ?? '—';
    $('opStage').textContent = `${pad2(st.n)} · ${st.code}`;
    const liftEl = $('opLift');
    liftEl.dataset.level = 'none';
    if (pres.kind === 'material') {
      const w = pres.wash;
      const pass = w.active || (w.front[1] >= 1e4 ? 2 : 1);
      const k = (pass - 1) as 0 | 1;
      const tot = this.passTotals[k];
      const pct = Math.round(w.pct[k] * 100);
      $('capStep').textContent = `MATERIAL PASS · ${pass} / 2 · ${pct} %`;
      $('opStatus').textContent = w.active ? 'WASH' : 'COLOURED ✓';
      $('opQty').textContent = `${fmtInt(tot.pcs)} pcs · pass ${pass}`;
      $('opMat').textContent = tot.materials.join(' · ');
      liftEl.textContent = !p.crane ? 'no tower crane · no lifts' : s.crane.visible ? `${p.crane.id} being struck · mobile crane at street level` : `${p.crane.id} struck · no lifts`;
      $('opXYZ').textContent = w.active ? `wash front +${Math.max(0, w.front[k]).toFixed(1)} m` : 'all surfaces coloured';
      $('opMass').textContent = `${fmtMass(tot.kg)} · ${fmtCarbon(tot.co2).replace('≈ ', '')}`;
    } else {
      const c = pres.cut;
      $('capStep').textContent = c.on ? `SECTION A–A · x = ${c.d.toFixed(1)} m` : 'SECTION A–A · closed';
      $('opStatus').textContent = c.on ? 'CUT · FLY-THROUGH' : 'CLOSED ✓';
      $('opQty').textContent = `${fmtInt(this.tl.presentation.cutParts)} parts in section`;
      $('opMat').textContent = 'poché · cut faces hatched';
      liftEl.textContent = p.crane ? `${p.crane.id} struck · no lifts` : 'no tower crane · no lifts';
      $('opXYZ').textContent = c.on ? `plane x = ${c.d.toFixed(1)} m` : 'plane open';
      $('opMass').textContent = `${fmtMass(p.totalMassKg)} · ${fmtCarbon(p.totalCarbonKg).replace('≈ ', '')}`;
    }
  }

  update(s: SequenceState, membersVisible: boolean) {
    const p = this.p;
    const step = s.step;
    const st = p.stages[s.stage - 1];
    const D = p.duration;

    const pres = s.presentation;
    // status card + caption + title block
    $('statusPhase').textContent = pres.kind ? st.title : s.complete ? 'TOPPED OUT ✓' : st.title;
    $('statusStep').textContent = `STEP ${String(s.stepsDone).padStart(3, '0')}/${p.steps.length} · ${fmtInt(s.partsPlaced)} PCS`;
    $('statusBar').style.width = `${(s.stepsDone / p.steps.length) * 100}%`;
    $('statusStage').textContent = String(s.stage);
    $('capStep').textContent = `STEP ${step ? step.id : '000'} / ${p.steps.length}`;
    $('capMember').textContent = step ? step.member : '—';
    $('capSpec').textContent = step ? step.spec : '—';
    $('tbDwg').textContent = `${p.id} / ${st.sheet}`;
    $('tbPhase').textContent = pres.kind === 'material' ? 'MATERIAL' : pres.kind === 'section' ? 'SECTION A–A' : st.code === 'SITE' ? 'GROUNDWORKS' : 'ASSEMBLY';
    $('tbSheet').textContent = `${st.n} / ${p.stages.length}`;
    const hdr = document.getElementById('hdrSheet');
    if (hdr) hdr.textContent = st.sheet;

    // timecode + scrubber
    const fmt = (t: number) => `${pad2(Math.floor(t / 60))}:${(t % 60).toFixed(1).padStart(4, '0')}`;
    $('timecode').innerHTML = `${fmt(s.t)} /<br>${pad2(Math.floor(D / 60))}:${pad2(Math.round(D % 60))}`;
    $('scrubFill').style.width = `${(s.t / D) * 100}%`;
    $('scrubKnob').style.left = `${(s.t / D) * 100}%`;
    const now = s.t.toFixed(1);
    if (now !== this.lastScrub) {
      this.lastScrub = now;
      const track = $('scrubTrack');
      track.setAttribute('aria-valuenow', now);
      track.setAttribute('aria-valuetext', scrubberText(s.t, D, s.stepsDone, p.steps.length));
    }
    $('ganttTime').textContent = `${s.t.toFixed(1)} / ${D.toFixed(1)} s`;

    // gantt
    this.ganttRows.forEach((row, i) => {
      const prog = s.stageProgress[i];
      const done = Math.round(prog * row.pills.length);
      row.pills.forEach((pill, k) => pill.classList.toggle('done', k < done));
      row.pct.textContent = `${Math.round(prog * 100)}%`;
      row.el.classList.toggle('on', i === s.stage - 1 && (!s.complete || !!pres.kind) && prog < 1);
    });
    const firstTrack = this.ganttRows[0].el.querySelector<HTMLElement>('.g-track')!;
    $('ganttHead').style.left = `${firstTrack.offsetLeft + (s.t / D) * firstTrack.offsetWidth}px`;

    // active operation
    $('opStatus').textContent = s.stepStatus;
    $('opMember').textContent = step?.member ?? '—';
    $('opStep').textContent = step ? `#${step.id} / ${p.steps.length}` : '—';
    $('opStage').textContent = step ? `${pad2(step.stage)} · ${step.zone}` : '—';
    $('opQty').textContent = step ? `${step.partCount} pcs · ${step.code}` : '—';
    $('opMat').textContent = step?.material ?? '—';
    $('opXYZ').textContent = step ? step.centroid.map((v) => v.toFixed(1)).join(' · ') : '—';
    $('opMass').textContent = step ? `${fmtMass(step.massKg)} · ${step.carbonKg >= 1 ? fmtCarbon(step.carbonKg).replace('≈ ', '') : '—'}` : '—';
    const lift = liftText(step, p.crane?.id ?? null, this.liftWarn, this.liftRigKg);
    const liftEl = $('opLift');
    liftEl.textContent = lift.text;
    liftEl.dataset.level = lift.level;
    const liftLabel = liftEl.previousElementSibling as HTMLElement;
    const labelText = `LIFT · ${liftingLabel(p.crane).toUpperCase()}${p.crane && this.liftRigKg > 0 ? ` · INCL. ${Math.round(this.liftRigKg)} KG RIGGING` : ''}`;
    if (liftLabel.textContent !== labelText) liftLabel.textContent = labelText;
    if (pres.kind) this.updatePresentation(s);

    // structure: zone stack + carbon
    const order = [...p.zones].reverse();
    order.forEach(({ id: zone }, i) => {
      const done = s.zoneDone[zone];
      const tot = Math.max(1, s.zoneTotal[zone]);
      const active = step?.zone === zone && !s.complete;
      (this.stack[i].firstElementChild as HTMLElement).style.height = `${(done / tot) * 100}%`;
      this.stack[i].classList.toggle('on', active);
      this.zoneRows[i].classList.toggle('on', active);
      this.zoneRows[i].lastElementChild!.textContent = `${done} / ${tot}`;
    });
    $('structTotal').textContent = `${Math.round((s.stepsDone / p.steps.length) * 100)} % · ${fmtMass(s.massPlacedKg).replace('≈ ', '')}`;
    $('carbonEmbodied').textContent = fmtCarbon(s.carbonPlacedKg);
    $('carbonStored').textContent = fmtCarbon(s.biogenicPlacedKg);
    $('carbonIntensity').textContent = s.complete ? `≈ ${Math.round(p.totalCarbonKg / p.gifa)} kg/m²` : `${Math.round((s.carbonPlacedKg / p.totalCarbonKg) * 100)} % of total`;

    // stage cards
    const current = p.stages[s.stage - 1]?.available ? s.stage - 1 : -1;
    if (current !== this.lastCard) {
      this.lastCard = current;
      this.cards.forEach((c, i) => (i === current ? c.setAttribute('aria-current', 'step') : c.removeAttribute('aria-current')));
      // only when the stage changes, so a hand swiping the strip during playback is not overruled every frame
      if (current >= 0) this.showCard(this.cards[current]);
    }
    this.cards.forEach((c, i) => {
      const stg = p.stages[i];
      c.classList.toggle('on', i === s.stage - 1 && stg.available);
      const prog = stg.available ? Math.min(1, Math.max(0, (s.t - stg.start) / (stg.end - stg.start))) : 0;
      (c.querySelector('.prog') as HTMLElement).style.width = `${prog * 100}%`;
    });

    // log
    // a frame-rate line every 2 s: look back far enough to fill the log without them
    const events = visibleLog(this.tl.logAt(s.t, this.showPerf ? 9 : 24), this.showPerf, 9);
    const key = `${events.length}:${events.at(-1)?.t}:${events.at(-1)?.kind}`;
    if (key !== this.lastLogKey || events.some((e) => e.kind === 'PERF')) {
      this.lastLogKey = key;
      const perf = this.perf;
      $('logLines').innerHTML = events
        .map((e, i) => {
          const text =
            e.kind === 'PERF'
              ? `PERF ${Math.round(perf.fps)} fps · ${perf.draws} draws · ${Math.round(perf.tris / 1000)}k tris · ${perf.res.toFixed(2)}×`
              : e.kind === 'STAGE'
                ? `══ ${e.text}`
                : e.text;
          const flag = /✗/.test(text) ? ' bad' : '';
          return `<li class="${e.kind}${flag}${i < events.length - 4 ? ' old' : ''}"><span class="ts">[${e.t.toFixed(2).padStart(5, '0')}]</span>${esc(text)}</li>`;
        })
        .join('');
    }
    $('logBadge').textContent = pres.kind === 'material' ? 'MATERIAL PASS' : pres.kind === 'section' ? 'SECTION A–A' : s.complete ? 'TOPPED OUT' : step?.method === 'cast' ? 'POURING' : 'ASSEMBLING';

    // members (throttled)
    if (membersVisible && Math.abs(s.t - this.lastMemberUpdate) > 0.1) {
      this.lastMemberUpdate = s.t;
      p.steps.forEach((stp: Step, i) => {
        const status = this.tl.statusOf(stp, s.t);
        const r = this.memberRows[i];
        if (!r.classList.contains(status)) {
          r.classList.remove('ghost', 'active', 'placed');
          r.classList.add(status);
          r.lastElementChild!.textContent = status.toUpperCase();
        }
      });
    }
  }
}

let scrubObserver: ResizeObserver | null = null;

/** Stage labels on the scrubber that would run into each other (or into END) are hidden; their ticks stay. */
function fitScrubberLabels() {
  const spans = [...$('scrubTicks').children] as HTMLElement[];
  if (spans.length < 2) return;
  for (const s of spans) s.style.visibility = '';
  const end = spans[spans.length - 1].getBoundingClientRect();
  let right = -Infinity;
  for (const s of spans.slice(0, -1)) {
    const r = s.getBoundingClientRect();
    if (!r.width) continue;
    if (r.left < right + 6 || r.right > end.left - 6) s.style.visibility = 'hidden';
    else right = r.right;
  }
}
