/**
 * The Issues tab: the verification summary, the issue register with filters,
 * the selected issue's detail, its pin on the model, timeline markers and the
 * CHECKS row of the active operation. Selecting an issue is handed to main,
 * which seeks the timeline, frames the camera and highlights the elements.
 */
import type { Project } from '../data/types';
import { RULES, RULE_BY_ID, type CheckReport, type Issue, type RuleInfo, type RuleResult, type Severity } from '../checks/types';
import { ruleStatus } from '../checks/run';
import { memberWords, partLabel } from '../checks/rules';
import type { SequenceState } from '../engine/timeline';
import type { Viewer } from '../scene/viewer';
import { pinLabel, type Box } from './place';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const SEVERITIES: Severity[] = ['critical', 'major', 'minor', 'note'];
const SEV_LABEL: Record<Severity, string> = { critical: 'Critical', major: 'Major', minor: 'Minor', note: 'Note' };
const FAMILIES: RuleInfo['family'][] = ['ORDER', 'TEMP', 'REACH', 'CLASH', 'ACCESS', 'MODEL'];
/** What each family of rules is about, in words. */
export const FAMILY_LABEL: Record<RuleInfo['family'], string> = { ORDER: 'Order', TEMP: 'Temporary works', REACH: 'Crane', CLASH: 'Clashes', ACCESS: 'Access', MODEL: 'Model data' };
/** The same families as the subject of a sentence: "Clash checks: 1 of 2 passed". */
const FAMILY_NOUN: Record<RuleInfo['family'], string> = { ORDER: 'Order checks', TEMP: 'Temporary works checks', REACH: 'Crane checks', CLASH: 'Clash checks', ACCESS: 'Access checks', MODEL: 'Model data checks' };
/** Chrome over the viewport the pin's label keeps clear of (the issue sheet and play bar lie over it on a narrow screen). */
const PIN_CHROME = '.toolbar, #caption, #titleBlock, #scaleBar, #scrubber, #transport, #drawer, #loading, #liftBanner, #issueSheet';

export type FilterState = { sev: Set<Severity>; family: RuleInfo['family'] | null };

/** Status words for a rule: what "unverified" means to someone reading the register. */
export const STATUS_WORDS = { passed: 'passed', flagged: 'flagged', unverified: 'nothing to check' } as const;

/**
 * A family chip in words: the short text on the chip and the sentence for its
 * tooltip and screen readers. A family has passed only when every rule in it
 * was checked; one that had nothing to act on is said to have had nothing to check.
 */
export function familySummary(family: RuleInfo['family'], rules: RuleResult[]): { tone: 'bad' | 'unv' | 'ok'; mark: string; sentence: string } {
  const flagged = rules.reduce((a, x) => a + x.flagged, 0);
  const checked = rules.filter((x) => ruleStatus(x) !== 'unverified').length;
  const idle = rules.length - checked;
  const nothing = idle ? `${idle} had nothing to check` : '';
  const noun = FAMILY_NOUN[family];
  if (flagged) {
    const issues = `${flagged} issue${flagged === 1 ? '' : 's'}`;
    return { tone: 'bad', mark: issues, sentence: `${noun}: ${issues}${nothing ? `; ${nothing}` : ''}` };
  }
  if (!checked) return { tone: 'unv', mark: 'nothing to check', sentence: `${noun}: nothing to check` };
  if (idle) return { tone: 'ok', mark: `${checked} of ${rules.length} passed`, sentence: `${noun}: ${checked} of ${rules.length} passed; ${nothing}` };
  return { tone: 'ok', mark: rules.length === 1 ? 'passed' : `all ${rules.length} passed`, sentence: `${noun}: ${rules.length === 1 ? 'passed' : `all ${rules.length} passed`}` };
}

/**
 * Index of the next or previous issue in a list of n, from position k (−1 when
 * nothing shown is selected): forward from nothing starts at the first,
 * back from nothing at the last, and both wrap.
 */
export function stepIndex(k: number, dir: 1 | -1, n: number): number {
  if (n <= 0) return -1;
  if (k < 0 || k >= n) return dir > 0 ? 0 : n - 1;
  return (k + dir + n) % n;
}

/**
 * Filters carried over a re-run of the checks. A severity with nothing in the
 * new report goes back on: its chip is disabled, so it could not be turned on again.
 */
export function carryFilters(kept: FilterState, issues: Issue[]): FilterState {
  const sev = new Set(kept.sev);
  for (const s of SEVERITIES) if (!issues.some((i) => i.severity === s)) sev.add(s);
  return { sev, family: kept.family };
}

/** Where the issue counter stands: "3 of 21" with one selected, else how many are shown. */
export function issuePosition(k: number, shown: number, total: number): string {
  if (!total) return 'No issues';
  if (k >= 0) return `${k + 1} of ${shown}`;
  return shown === total ? `${total} issue${total === 1 ? '' : 's'}` : `${shown} of ${total} shown`;
}

/**
 * Boxes of the chrome over the viewport, relative to `host`, padded; hidden
 * ones left out. Looked for inside `root`: the whole page, for chrome that is
 * fixed to the screen rather than placed in the viewport (the issue sheet).
 */
export function chromeBoxes(host: HTMLElement, selector: string, pad = 6, root: ParentNode = host): Box[] {
  const h = host.getBoundingClientRect();
  const out: Box[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    if (el.hidden || el.style.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.push({ x0: r.left - h.left - pad, y0: r.top - h.top - pad, x1: r.right - h.left + pad, y1: r.bottom - h.top + pad });
  }
  return out;
}

export interface IssueHooks {
  select(issue: Issue | null): void;
  exportBcf(): void;
  exportCsv(): void;
  /**
   * True on a narrow screen, where the panel sits under the model: the
   * selected issue then reads in the sheet over the bottom of the screen, and
   * the list is not scrolled to (that would take the page away from the model).
   */
  compact?(): boolean;
}

export class IssuesUI {
  report: CheckReport | null = null;
  selected: Issue | null = null;
  private sev = new Set<Severity>(SEVERITIES);
  private family: RuleInfo['family'] | null = null;
  private lastStep = -2;
  private svg: SVGSVGElement;
  /** The chrome the pin's label avoids, re-read a few times a second (it moves only on resize). */
  private chrome: Box[] = [];
  private chromeAt = -Infinity;
  /** The issue sheet folded down to its title line (narrow screens). */
  private folded = false;

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
    // no verdict yet: drop the last run's pass colour
    delete $('opChecks').dataset.level;
    document.querySelectorAll('#scrubTrack .iss-mark').forEach((m) => m.remove());
    $('btnBcf').toggleAttribute('disabled', true);
    $('btnCsv').toggleAttribute('disabled', true);
    // the buttons outlive the panel: assigning (not adding) keeps one handler for the newest panel
    $('issPrev').onclick = () => this.step(-1);
    $('issNext').onclick = () => this.step(1);
    $('sheetPrev').onclick = () => this.step(-1);
    $('sheetNext').onclick = () => this.step(1);
    $('sheetClose').onclick = () => this.select(null);
    $('sheetToggle').onclick = () => {
      this.folded = !this.folded;
      this.renderSheet();
    };
    this.renderNav();
    this.renderSheet();
  }

  /** The filters in force, to carry over a re-run of the checks. */
  filters(): FilterState {
    return { sev: new Set(this.sev), family: this.family };
  }

  /** Take over filters from the panel this one replaces; the chips and list follow when the report arrives. */
  restoreFilters(f: FilterState) {
    this.sev = new Set(f.sev);
    this.family = f.family;
  }

  running(label: string, share: number) {
    $('issProgress').hidden = share >= 1;
    ($('issProgress').firstElementChild as HTMLElement).style.width = `${Math.round(share * 100)}%`;
    $('issVerdict').textContent = share >= 1 ? 'Checks complete' : `Checking ${label}…`;
  }

  /** The run stopped before it could report: say so instead of leaving the progress label up. */
  failed(why: string) {
    $('issProgress').hidden = true;
    $('issVerdict').textContent = `The checks could not run: ${why}`;
    $('issBadge').textContent = '!';
    $('opChecks').textContent = 'not checked';
    delete $('opChecks').dataset.level;
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
    $('issVerdict').innerHTML = `<b>${r.issues.length}</b> issue${r.issues.length === 1 ? '' : 's'} · ${r.rules.length} rules: ${passed} ${STATUS_WORDS.passed}, ${flagged} ${STATUS_WORDS.flagged}${unverified ? `, ${unverified} with ${STATUS_WORDS.unverified}` : ''} <span class="muted">· ${(r.ms / 1000).toFixed(2)} s</span>`;
    $('btnBcf').toggleAttribute('disabled', !r.issues.length);
    $('btnCsv').toggleAttribute('disabled', !r.issues.length);
    const kept = carryFilters({ sev: this.sev, family: this.family }, r.issues);
    this.sev = kept.sev;
    this.family = kept.family;
    this.renderFamilies();
    this.renderSeverities();
    this.renderList();
    this.renderMarkers();
    this.decorate();
    this.renderSheet();
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
      const sum = familySummary(fam, rules);
      const b = document.createElement('button');
      b.className = `fam ${sum.tone}${this.family === fam ? ' on' : ''}`;
      b.setAttribute('aria-pressed', String(this.family === fam));
      b.setAttribute('aria-label', `${sum.sentence}. Show only these issues.`);
      b.innerHTML = `<span></span><b></b>`;
      b.querySelector('span')!.textContent = FAMILY_LABEL[fam];
      b.querySelector('b')!.textContent = sum.mark;
      b.title = `${sum.sentence}\n${rules.map((x) => `${RULE_BY_ID[x.id].title}: ${STATUS_WORDS[ruleStatus(x)]} · ${x.note}`).join('\n')}`;
      b.addEventListener('click', () => {
        this.family = this.family === fam ? null : fam;
        this.renderFamilies();
        this.refilter();
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
      b.setAttribute('aria-pressed', String(this.sev.has(s)));
      b.addEventListener('click', () => {
        if (this.sev.has(s)) this.sev.delete(s);
        else this.sev.add(s);
        this.renderSeverities();
        this.refilter();
      });
      wrap.append(b);
    }
  }

  /** After a filter changes: a selection the filters now hide is let go, with its highlight and pin. */
  private refilter() {
    if (this.selected && !this.visible(this.selected)) this.select(null);
    else this.renderList();
  }

  /** The ‹ › buttons and the "3 of 21" between them. */
  private renderNav() {
    const r = this.report;
    const shown = r ? r.issues.filter((i) => this.visible(i)) : [];
    const k = this.selected ? shown.indexOf(this.selected) : -1;
    $('issPos').textContent = r ? issuePosition(k, shown.length, r.issues.length) : '';
    $('issPrev').toggleAttribute('disabled', !shown.length);
    $('issNext').toggleAttribute('disabled', !shown.length);
  }

  private renderList() {
    const list = $('issList');
    list.innerHTML = '';
    this.renderNav();
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
    d.querySelector('.rule')!.textContent = `${i.rule} · ${rule.rule(this.report!.settings)}${step ? ` · step ${step.id}, ${memberWords(step.member)}` : ''}`;
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
    // a fresh selection opens the sheet out; stepping from one issue to the next keeps it as it was
    if (!this.selected) this.folded = false;
    this.selected = i;
    this.renderList();
    // the sheet first: main frames the issue clear of it
    this.renderSheet();
    this.hooks.select(i);
    if (i && !this.hooks.compact?.()) $('issList').querySelector(`[data-id="${i.id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  /** The selected issue in the sheet over the bottom of a narrow screen (CSS keeps it hidden on a wide one). */
  private renderSheet() {
    const sheet = $('issueSheet');
    const i = this.selected;
    sheet.hidden = !i;
    if (!i) return;
    sheet.className = `issue-sheet card sev-${i.severity}${this.folded ? ' folded' : ''}`;
    $('sheetId').textContent = i.id;
    $('sheetText').textContent = i.title;
    const toggle = $('sheetToggle');
    toggle.setAttribute('aria-expanded', String(!this.folded));
    toggle.setAttribute('aria-label', this.folded ? 'Show the issue detail' : 'Fold the issue detail');
    toggle.title = this.folded ? 'Show the issue detail' : 'Fold the issue away';
    const body = $('sheetBody');
    body.innerHTML = '';
    body.append(this.detail(i));
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
    // nothing shown selected: ‹ starts from the last issue, › from the first
    const k = this.selected ? shown.indexOf(this.selected) : -1;
    this.select(shown[stepIndex(k, dir, shown.length)]);
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
      // only a verdict has a colour: '—' and 'checking…' must not keep the last step's green
      delete el.dataset.level;
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
    // the dot stays on the issue; its tag moves to whichever side is clear of the cards and controls
    const now = performance.now();
    if (now - this.chromeAt > 250) {
      this.chromeAt = now;
      this.chrome = chromeBoxes($('viewport'), PIN_CHROME, 6, document);
    }
    const lw = 8 + i.id.length * 7.4, lh = 20;
    const at = pinLabel(q, { w: lw, h: lh }, { x0: 4, y0: 4, x1: w - 4, y1: h - 4 }, this.chrome);
    const lx = at.x, ly = at.y + 9;
    const ax = at.x + lw / 2 < q.x ? lx + lw : lx;
    this.svg.innerHTML = `<g class="pin sev-${i.severity}"><line x1="${q.x}" y1="${q.y}" x2="${ax}" y2="${ly + 1}" /><circle cx="${q.x}" cy="${q.y}" r="7" /><circle class="core" cx="${q.x}" cy="${q.y}" r="2.6" /><rect x="${lx}" y="${ly - 9}" width="${lw}" height="${lh}" rx="5" /><text x="${lx + 5}" y="${ly + 5}">${esc(i.id)}</text></g>`;
  }
}

/** The rules drawer body: thresholds you can change and each rule's verification status. */
export function rulesTable(r: CheckReport | null): string {
  if (!r) return '<p class="muted">Checks are running…</p>';
  return `<table class="rules mono"><thead><tr><th>Rule</th><th>Checked</th><th>Status</th></tr></thead><tbody>${RULES.map((info) => {
    const x = r.rules.find((y) => y.id === info.id);
    if (!x) return '';
    const st = ruleStatus(x);
    return `<tr class="${st}" title="${esc(`${info.rule(r.settings)} — ${x.note}`)}"><td><b>${esc(info.title)}</b><span>${esc(x.note)}</span></td><td>${x.checked}</td><td>${st === 'flagged' ? `✗ ${x.flagged} ${STATUS_WORDS.flagged}` : st === 'passed' ? `✓ ${STATUS_WORDS.passed}` : STATUS_WORDS.unverified}</td></tr>`;
  }).join('')}</tbody></table>`;
}
