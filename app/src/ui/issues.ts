/**
 * The Issues tab: the verification summary, the issue register with filters,
 * the selected issue's detail, its pin on the model, timeline markers and the
 * CHECKS row of the active operation. Selecting an issue is handed to main,
 * which seeks the timeline, frames the camera and highlights the elements.
 */
import type { Project } from '../data/types';
import { RULES, RULE_BY_ID, type CheckReport, type Issue, type RuleInfo, type Severity } from '../checks/types';
import { ruleStatus } from '../checks/run';
import { partLabel } from '../checks/rules';
import type { SequenceState } from '../engine/timeline';
import type { Viewer } from '../scene/viewer';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const SEVERITIES: Severity[] = ['critical', 'major', 'minor', 'note'];
const SEV_LABEL: Record<Severity, string> = { critical: 'Critical', major: 'Major', minor: 'Minor', note: 'Note' };
const FAMILIES: RuleInfo['family'][] = ['ORDER', 'TEMP', 'REACH', 'CLASH', 'ACCESS', 'MODEL'];

export interface IssueHooks {
  select(issue: Issue | null): void;
  exportBcf(): void;
  exportCsv(): void;
}

export class IssuesUI {
  report: CheckReport | null = null;
  selected: Issue | null = null;
  private sev = new Set<Severity>(SEVERITIES);
  private family: RuleInfo['family'] | null = null;
  private lastStep = -2;
  private svg: SVGSVGElement;

  constructor(
    private p: Project,
    private viewer: Viewer,
    private timeOf: (step: number) => number,
    private hooks: IssueHooks,
  ) {
    this.svg = document.getElementById('issueSvg') as unknown as SVGSVGElement;
    this.svg.innerHTML = '';
    $('issList').innerHTML = '';
    $('issFamilies').innerHTML = '';
    $('issSev').innerHTML = '';
    $('issVerdict').textContent = 'Checking the sequence…';
    $('issBadge').textContent = '…';
    $('issBadge').className = 'tab-badge';
    $('opChecks').textContent = 'checking…';
    document.querySelectorAll('#scrubTrack .iss-mark').forEach((m) => m.remove());
    $('btnBcf').toggleAttribute('disabled', true);
    $('btnCsv').toggleAttribute('disabled', true);
  }

  running(label: string, share: number) {
    $('issProgress').hidden = share >= 1;
    ($('issProgress').firstElementChild as HTMLElement).style.width = `${Math.round(share * 100)}%`;
    $('issVerdict').textContent = share >= 1 ? 'Checks complete' : `Checking ${label}…`;
  }

  setReport(r: CheckReport) {
    this.report = r;
    this.selected = null;
    $('issProgress').hidden = true;
    const n = (s: Severity) => r.issues.filter((i) => i.severity === s).length;
    const worst = SEVERITIES.find((s) => n(s) > 0);
    $('issBadge').textContent = String(r.issues.length);
    $('issBadge').className = `tab-badge${worst ? ` sev-${worst}` : ' ok'}`;
    const st = r.rules.map(ruleStatus);
    const passed = st.filter((x) => x === 'passed').length, flagged = st.filter((x) => x === 'flagged').length, unverified = st.filter((x) => x === 'unverified').length;
    $('issVerdict').innerHTML = `<b>${r.issues.length}</b> issue${r.issues.length === 1 ? '' : 's'} · ${r.rules.length} rules: ${passed} passed, ${flagged} flagged${unverified ? `, ${unverified} unverified` : ''} <span class="muted">· ${(r.ms / 1000).toFixed(2)} s</span>`;
    $('btnBcf').toggleAttribute('disabled', !r.issues.length);
    $('btnCsv').toggleAttribute('disabled', !r.issues.length);
    this.renderFamilies();
    this.renderSeverities();
    this.renderList();
    this.renderMarkers();
    this.decorate();
    this.lastStep = -2;
  }

  /** Issues raised at a step, most severe first. */
  atStep(step: number): Issue[] {
    return this.report?.issues.filter((i) => i.step === step) ?? [];
  }

  private visible(i: Issue) {
    return this.sev.has(i.severity) && (!this.family || RULE_BY_ID[i.rule].family === this.family);
  }

  private renderFamilies() {
    const r = this.report!;
    const wrap = $('issFamilies');
    wrap.innerHTML = '';
    for (const fam of FAMILIES) {
      const rules = r.rules.filter((x) => RULE_BY_ID[x.id].family === fam);
      if (!rules.length) continue;
      const flagged = rules.reduce((a, x) => a + x.flagged, 0);
      const verified = rules.filter((x) => ruleStatus(x) !== 'unverified').length;
      const b = document.createElement('button');
      b.className = `fam ${flagged ? 'bad' : !verified ? 'unv' : 'ok'}${this.family === fam ? ' on' : ''}`;
      // a family is only "✓" when every rule in it was checked; "1/2 ✓" says one had nothing to check
      const mark = flagged ? `✗ ${flagged}` : !verified ? '–' : verified < rules.length ? `${verified}/${rules.length} ✓` : '✓';
      b.innerHTML = `<span>${fam}</span><b>${mark}</b>`;
      b.title = rules.map((x) => `${RULE_BY_ID[x.id].title}: ${ruleStatus(x)} · ${x.note}`).join('\n');
      b.addEventListener('click', () => {
        this.family = this.family === fam ? null : fam;
        this.renderFamilies();
        this.renderList();
      });
      wrap.append(b);
    }
  }

  private renderSeverities() {
    const r = this.report!;
    const wrap = $('issSev');
    wrap.innerHTML = '';
    for (const s of SEVERITIES) {
      const n = r.issues.filter((i) => i.severity === s).length;
      const b = document.createElement('button');
      b.className = `sev sev-${s}${this.sev.has(s) ? ' on' : ''}`;
      b.innerHTML = `<i></i>${SEV_LABEL[s]} <b>${n}</b>`;
      b.disabled = !n;
      b.addEventListener('click', () => {
        if (this.sev.has(s)) this.sev.delete(s);
        else this.sev.add(s);
        this.renderSeverities();
        this.renderList();
      });
      wrap.append(b);
    }
  }

  private renderList() {
    const list = $('issList');
    list.innerHTML = '';
    const r = this.report;
    if (!r) return;
    const shown = r.issues.filter((i) => this.visible(i));
    if (!r.issues.length) {
      list.innerHTML = `<li class="iss-empty">No issues: every applicable rule passed. Unverified rules had nothing to check.</li>`;
      return;
    }
    if (!shown.length) list.innerHTML = `<li class="iss-empty">No issues match these filters.</li>`;
    for (const i of shown) {
      const li = document.createElement('li');
      li.className = `iss sev-${i.severity}${this.selected === i ? ' sel' : ''}`;
      li.dataset.id = i.id;
      const step = this.p.steps[i.step];
      li.innerHTML = `<button class="iss-row" aria-expanded="${this.selected === i}"><i class="dot"></i><b class="id mono"></b><span class="t"></span><span class="s mono"></span></button>`;
      li.querySelector('.id')!.textContent = i.id;
      li.querySelector('.t')!.textContent = i.title;
      li.querySelector('.s')!.textContent = step ? `#${step.id}` : '';
      li.querySelector('.iss-row')!.addEventListener('click', () => this.select(this.selected === i ? null : i));
      if (this.selected === i) li.append(this.detail(i));
      list.append(li);
    }
  }

  private detail(i: Issue): HTMLElement {
    const d = document.createElement('div');
    d.className = 'iss-body';
    const rule = RULE_BY_ID[i.rule];
    const parts = [...i.primary.map((k) => ({ k, role: 'a' })), ...i.secondary.filter((k) => !i.primary.includes(k)).map((k) => ({ k, role: 'b' }))];
    const step = this.p.steps[i.step];
    d.innerHTML = `<p class="d"></p><p class="a"><b>Action</b> <span></span></p>
      <p class="r mono"><span class="rule"></span></p>
      <ul class="els mono"></ul>`;
    d.querySelector('.d')!.textContent = i.detail;
    d.querySelector('.a span')!.textContent = i.action;
    d.querySelector('.rule')!.textContent = `${i.rule} · ${rule.rule(this.report!.settings)}${step ? ` · step ${step.id}, ${step.member}` : ''}`;
    const ul = d.querySelector('.els')!;
    for (const { k, role } of parts.slice(0, 8)) {
      const li = document.createElement('li');
      li.className = role;
      const guid = this.p.parts[k].ref?.guid;
      li.textContent = `${partLabel(this.p, k)}${guid ? ` · ${guid}` : ''}`;
      ul.append(li);
    }
    if (parts.length > 8) {
      const li = document.createElement('li');
      li.className = 'more';
      li.textContent = `… and ${parts.length - 8} more`;
      ul.append(li);
    }
    return d;
  }

  select(i: Issue | null) {
    this.selected = i;
    this.renderList();
    this.hooks.select(i);
    if (i) $('issList').querySelector(`[data-id="${i.id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  selectById(id: string) {
    const i = this.report?.issues.find((x) => x.id === id) ?? null;
    if (i) {
      this.sev.add(i.severity);
      if (this.family && RULE_BY_ID[i.rule].family !== this.family) this.family = null;
      this.renderFamilies();
      this.renderSeverities();
    }
    this.select(i);
  }

  /** Next or previous issue in the list order (wraps). */
  step(dir: 1 | -1) {
    const r = this.report;
    if (!r) return;
    const shown = r.issues.filter((i) => this.visible(i));
    if (!shown.length) return;
    const k = this.selected ? shown.indexOf(this.selected) : -1;
    this.select(shown[(k + dir + shown.length) % shown.length]);
  }

  private renderMarkers() {
    const track = $('scrubTrack');
    track.querySelectorAll('.iss-mark').forEach((m) => m.remove());
    const D = this.p.duration;
    for (const i of this.report!.issues) {
      if (i.severity !== 'critical' && i.severity !== 'major') continue;
      const m = document.createElement('b');
      m.className = `iss-mark sev-${i.severity}`;
      m.style.left = `${(this.timeOf(i.step) / D) * 100}%`;
      m.title = `${i.id} · ${i.title}`;
      m.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.selectById(i.id);
      });
      track.append(m);
    }
  }

  /** Issue counts on stage cards, member rows and Gantt pills. */
  private decorate() {
    const r = this.report!;
    const serious = r.issues.filter((i) => i.severity === 'critical' || i.severity === 'major');
    document.querySelectorAll<HTMLElement>('#stageCards .scard').forEach((card, k) => {
      card.querySelector('.chip-i')?.remove();
      const stage = this.p.stages[k];
      const n = serious.filter((i) => this.p.steps[i.step]?.stage === stage.n).length;
      if (!n) return;
      const chip = document.createElement('span');
      chip.className = 'chip-i';
      chip.textContent = `⚠ ${n}`;
      chip.title = `${n} critical or major issue${n === 1 ? '' : 's'} arise in this stage`;
      card.querySelector('.thumb')!.append(chip);
    });
    document.querySelectorAll<HTMLElement>('#memberList .m-row').forEach((row, k) => {
      row.querySelector('.iss-n')?.remove();
      const mine = r.issues.filter((i) => i.step === k);
      if (!mine.length) return;
      const tag = document.createElement('i');
      tag.className = `iss-n sev-${mine[0].severity}`;
      tag.textContent = String(mine.length);
      tag.title = mine.map((i) => `${i.id} ${i.title}`).join('\n');
      row.querySelector('.nm')!.prepend(tag);
    });
    document.querySelectorAll<HTMLElement>('#gantt .g-row').forEach((row, k) => {
      const stage = this.p.stages[k];
      const steps = this.p.steps.filter((s) => s.stage === stage.n);
      const pills = [...row.querySelectorAll<HTMLElement>('.g-bar i')];
      pills.forEach((pill) => pill.classList.remove('flag'));
      steps.forEach((s, j) => {
        if (serious.some((i) => i.step === s.index)) pills[Math.min(pills.length - 1, Math.floor((j / steps.length) * pills.length))]?.classList.add('flag');
      });
    });
  }

  /** Per frame: the CHECKS row for the current step and the selected issue's pin. */
  update(s: SequenceState) {
    if (s.stepIndex !== this.lastStep) {
      this.lastStep = s.stepIndex;
      const el = $('opChecks');
      if (!this.report) el.textContent = 'checking…';
      else if (s.stepIndex < 0) el.textContent = '—';
      else {
        const mine = this.atStep(s.stepIndex);
        el.innerHTML = '';
        if (!mine.length) {
          el.textContent = `✓ no issue raised at this step`;
          el.dataset.level = 'ok';
        } else {
          el.dataset.level = mine[0].severity;
          for (const i of mine.slice(0, 4)) {
            const b = document.createElement('button');
            b.className = `chk sev-${i.severity}`;
            b.textContent = `✗ ${i.id}`;
            b.title = i.title;
            b.addEventListener('click', () => {
              (document.getElementById('tabIssues') as HTMLButtonElement).click();
              this.selectById(i.id);
            });
            el.append(b);
          }
          if (mine.length > 4) el.append(` +${mine.length - 4}`);
        }
      }
    }
    this.drawPin();
  }

  private drawPin() {
    const i = this.selected;
    const { w, h } = this.viewer.viewportSize;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    if (!i) {
      if (this.svg.childNodes.length) this.svg.innerHTML = '';
      return;
    }
    const q = this.viewer.project(i.at);
    if (q.behind || q.x < -40 || q.y < -40 || q.x > w + 40 || q.y > h + 40) {
      this.svg.innerHTML = '';
      return;
    }
    const lx = Math.min(w - 120, q.x + 26), ly = Math.max(24, q.y - 34);
    this.svg.innerHTML = `<g class="pin sev-${i.severity}"><line x1="${q.x}" y1="${q.y}" x2="${lx}" y2="${ly + 6}" /><circle cx="${q.x}" cy="${q.y}" r="7" /><circle class="core" cx="${q.x}" cy="${q.y}" r="2.6" /><rect x="${lx}" y="${ly - 9}" width="${8 + i.id.length * 7.4}" height="20" rx="5" /><text x="${lx + 5}" y="${ly + 5}">${esc(i.id)}</text></g>`;
  }
}

/** The rules drawer body: thresholds you can change and each rule's verification status. */
export function rulesTable(r: CheckReport | null): string {
  if (!r) return '<p class="muted">Checks are running…</p>';
  return `<table class="rules mono"><thead><tr><th>Rule</th><th>Checked</th><th>Status</th></tr></thead><tbody>${RULES.map((info) => {
    const x = r.rules.find((y) => y.id === info.id);
    if (!x) return '';
    const st = ruleStatus(x);
    return `<tr class="${st}" title="${esc(`${info.rule(r.settings)} — ${x.note}`)}"><td><b>${esc(info.title)}</b><span>${esc(x.note)}</span></td><td>${x.checked}</td><td>${st === 'flagged' ? `✗ ${x.flagged}` : st === 'passed' ? '✓' : 'unverified'}</td></tr>`;
  }).join('')}</tbody></table>`;
}
