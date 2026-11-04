import { fmtCarbon, fmtInt, fmtMass, pad2, type SequenceState, type Timeline } from '../engine/timeline';
import { ZONES, type Project, type Step, type ZoneId } from '../data/types';
import { levelY } from '../data/generator';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface PerfSample {
  fps: number;
  draws: number;
  tris: number;
  res: number;
}

/** Height band of each zone, used to draw the progress stack to scale. */
const ZONE_SPAN: Record<ZoneId, [number, number]> = {
  SITE: [-6, 0],
  PODIUM: [0, levelY(3)],
  LOWER: [levelY(3), levelY(13)],
  MIDDLE: [levelY(13), levelY(23)],
  UPPER: [levelY(23), levelY(32)],
  CROWN: [levelY(32), levelY(32) + 6],
};

export function liftText(step: Step | null): { text: string; level: 'ok' | 'warn' | 'over' | 'none' } {
  if (!step) return { text: '—', level: 'none' };
  if (step.method === 'cast') return { text: step.code === 'PL-01' ? 'bored in situ · CFA rig' : 'cast in place · pump + jump form', level: 'none' };
  if (step.method === 'manual') return { text: 'by hand · site team', level: 'none' };
  const l = step.lift;
  if (!l) return { text: 'TC-1 · bulk bags', level: 'none' };
  const pct = Math.round(l.util * 100);
  const level = l.util > 1 ? 'over' : l.util >= 0.8 ? 'warn' : 'ok';
  const tail = level === 'over' ? ' ✗ over chart' : level === 'warn' ? ' ⚠' : '';
  return { text: `TC-1 · R ${l.radius.toFixed(1)} m · ${fmtTonnes(l.pieceKg)} of ${fmtTonnes(l.capacityKg)} · ${pct} %${tail}`, level };
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
  perf: PerfSample = { fps: 60, draws: 3, tris: 0, res: 1.5 };

  constructor(
    private p: Project,
    private tl: Timeline,
    private onSeek: (t: number) => void,
    private onSeekStep: (index: number) => void,
  ) {
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
    const later = this.p.stages.filter((s) => !s.available);
    for (const st of this.p.stages) {
      if (!st.available && st !== later[0]) continue;
      const row = document.createElement('div');
      row.className = `g-row${st.available ? '' : ' na'}`;
      const n = this.p.steps.filter((s) => s.stage === st.n).length;
      const pillsN = Math.max(3, Math.ceil(n / 5));
      const track = st.available
        ? `<div class="g-track"><div class="g-bar" style="left:${(st.start / D) * 100}%;width:${((st.end - st.start) / D) * 100}%">${'<i></i>'.repeat(pillsN)}</div></div>`
        : `<div class="g-track"><span class="g-na">M5 · material pass, section A–A</span></div>`;
      const label = st.available ? `<i>${pad2(st.n)}</i>${st.code}` : `<i>${later.map((s) => pad2(s.n)).join('–')}</i>LATER`;
      row.innerHTML = `<span class="lab">${label}</span>${track}<span class="pct">${st.available ? '0%' : '—'}</span>`;
      g.append(row);
      this.ganttRows.push({ el: row, pills: [...row.querySelectorAll<HTMLElement>('.g-bar i')], pct: row.querySelector('.pct')! });
    }
    const head = document.createElement('div');
    head.className = 'g-head';
    head.id = 'ganttHead';
    g.append(head);
  }

  private buildStructure() {
    const order = [...ZONES].reverse(); // crown at the top
    const stack = $('zoneStack');
    const tbl = $('zoneTable');
    const total = ZONE_SPAN.CROWN[1] - ZONE_SPAN.SITE[0];
    order.forEach((zone, i) => {
      const [a, b] = ZONE_SPAN[zone];
      const bar = document.createElement('i');
      bar.style.height = `${((b - a) / total) * 100}%`;
      bar.style.width = zone === 'SITE' ? '100%' : zone === 'PODIUM' ? '86%' : zone === 'CROWN' ? '58%' : `${64 + (i % 2) * 6}%`;
      bar.innerHTML = '<b></b>';
      stack.append(bar);
      this.stack.push(bar);
      const row = document.createElement('div');
      row.innerHTML = `<span>${zone}</span><span>0 / ${this.tl.zoneTotal[zone]}</span>`;
      tbl.append(row);
      this.zoneRows.push(row);
    });
  }

  private buildCards() {
    const wrap = $('stageCards');
    for (const st of this.p.stages) {
      const b = document.createElement('button');
      b.className = `scard${st.available ? '' : ' na'}`;
      b.disabled = !st.available;
      b.title = st.available ? `Jump to ${st.title}` : `${st.title} — milestone M5`;
      b.innerHTML = `<div class="thumb"><img alt="" hidden /><span class="chip-t">${st.start.toFixed(1)}s</span><span class="chip-s">${st.sheet}</span></div>
        <div class="meta"><b>${pad2(st.n)}. ${st.title}</b><span>${st.subtitle}</span></div><i class="prog"></i>`;
      b.addEventListener('click', () => st.available && this.onSeek(st.start + 0.001));
      wrap.append(b);
      this.cards.push(b);
    }
  }

  setThumbnail(stageIndex: number, url: string) {
    const img = this.cards[stageIndex].querySelector('img')!;
    img.src = url;
    img.hidden = false;
  }

  private buildMembers() {
    const list = $('memberList');
    for (const s of this.p.steps) {
      const r = document.createElement('div');
      r.className = 'm-row ghost';
      r.dataset.search = `${s.id} ${s.member} ${s.code} ${s.material} ${s.zone}`.toLowerCase();
      r.innerHTML = `<span>${s.id}</span><span class="nm" title="${esc(s.member)}">${esc(s.member)}</span><span>${s.partCount} pcs</span><span class="st">GHOST</span>`;
      r.addEventListener('click', () => this.onSeekStep(s.index));
      list.append(r);
      this.memberRows.push(r);
    }
    $<HTMLInputElement>('memberSearch').addEventListener('input', (e) => {
      const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
      for (const r of this.memberRows) r.hidden = !!q && !r.dataset.search!.includes(q);
    });
  }

  private buildScrubber() {
    const ticks = $('scrubTicks');
    const track = $('scrubTrack');
    const D = this.p.duration;
    for (const st of this.p.stages.filter((s) => s.available)) {
      ticks.insertAdjacentHTML('beforeend', `<span style="left:${(st.start / D) * 100}%">${st.tick}</span>`);
      track.insertAdjacentHTML('beforeend', `<span class="scrub-tick" style="left:${(st.start / D) * 100}%"></span>`);
    }
    ticks.insertAdjacentHTML('beforeend', `<span style="left:calc(100% - 30px)">END</span>`);
    let dragging = false;
    const seekFromEvent = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      this.onSeek(((e.clientX - r.left) / r.width) * D);
    };
    track.addEventListener('pointerdown', (e) => {
      dragging = true;
      track.setPointerCapture(e.pointerId);
      seekFromEvent(e);
    });
    track.addEventListener('pointermove', (e) => dragging && seekFromEvent(e));
    track.addEventListener('pointerup', () => (dragging = false));
  }

  update(s: SequenceState, membersVisible: boolean) {
    const p = this.p;
    const step = s.step;
    const st = p.stages[s.stage - 1];
    const D = p.duration;

    // status card + caption + title block
    $('statusPhase').textContent = s.complete ? 'TOPPED OUT ✓' : st.title;
    $('statusStep').textContent = `STEP ${String(s.stepsDone).padStart(3, '0')}/${p.steps.length} · ${fmtInt(s.partsPlaced)} PCS`;
    $('statusBar').style.width = `${(s.stepsDone / p.steps.length) * 100}%`;
    $('statusStage').textContent = String(s.stage);
    $('capStep').textContent = `STEP ${step ? step.id : '000'} / ${p.steps.length}`;
    $('capMember').textContent = step ? step.member : '—';
    $('capSpec').textContent = step ? step.spec : '—';
    $('tbDwg').textContent = `${p.id} / ${st.sheet}`;
    $('tbPhase').textContent = st.code === 'SITE' ? 'GROUNDWORKS' : 'ASSEMBLY';
    $('tbSheet').textContent = `${st.n} / ${p.stages.length}`;
    const hdr = document.getElementById('hdrSheet');
    if (hdr) hdr.textContent = st.sheet;

    // timecode + scrubber
    const fmt = (t: number) => `${pad2(Math.floor(t / 60))}:${(t % 60).toFixed(1).padStart(4, '0')}`;
    $('timecode').innerHTML = `${fmt(s.t)} /<br>${pad2(Math.floor(D / 60))}:${pad2(Math.round(D % 60))}`;
    $('scrubFill').style.width = `${(s.t / D) * 100}%`;
    $('scrubKnob').style.left = `${(s.t / D) * 100}%`;
    $('ganttTime').textContent = `${s.t.toFixed(1)} / ${D.toFixed(1)} s`;

    // gantt
    this.ganttRows.forEach((row, i) => {
      if (!p.stages[i]?.available) return;
      const prog = s.stageProgress[i];
      const done = Math.round(prog * row.pills.length);
      row.pills.forEach((pill, k) => pill.classList.toggle('done', k < done));
      row.pct.textContent = `${Math.round(prog * 100)}%`;
      row.el.classList.toggle('on', i === s.stage - 1 && !s.complete);
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
    const lift = liftText(step);
    const liftEl = $('opLift');
    liftEl.textContent = lift.text;
    liftEl.dataset.level = lift.level;

    // structure: zone stack + carbon
    const order = [...ZONES].reverse();
    order.forEach((zone, i) => {
      const done = s.zoneDone[zone];
      const tot = s.zoneTotal[zone];
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
    this.cards.forEach((c, i) => {
      const stg = p.stages[i];
      c.classList.toggle('on', i === s.stage - 1 && stg.available);
      const prog = stg.available ? Math.min(1, Math.max(0, (s.t - stg.start) / (stg.end - stg.start))) : 0;
      (c.querySelector('.prog') as HTMLElement).style.width = `${prog * 100}%`;
    });

    // log
    const events = this.tl.logAt(s.t, 9);
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
    $('logBadge').textContent = s.complete ? 'TOPPED OUT' : step?.method === 'cast' ? 'POURING' : 'ASSEMBLING';

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
