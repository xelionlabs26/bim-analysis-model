/**
 * The Issues tab: the verification summary, the issue register with filters,
 * the selected issue's detail, its pin on the model, timeline markers and the
 * CHECKS row of the active operation. Selecting an issue is handed to main,
 * which seeks the timeline, frames the camera and highlights the elements.
 */
import type { Project } from '../data/types';
import { RULES, RULE_BY_ID, SEVERITY_ORDER, type CheckReport, type Issue, type RuleInfo, type RuleResult, type Severity } from '../checks/types';
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
/** What each family of rules is about, in words: the chip's visible label, which also starts its accessible name (WCAG 2.5.3). */
export const FAMILY_LABEL: Record<RuleInfo['family'], string> = { ORDER: 'Order', TEMP: 'Temporary works', REACH: 'Crane', CLASH: 'Clashes', ACCESS: 'Access', MODEL: 'Model data' };
/** Chrome over the viewport the pin's label keeps clear of (the issue sheet and play bar lie over it on a narrow screen). */
const PIN_CHROME = '.toolbar, #caption, #titleBlock, #scaleBar, #scrubber, #transport, #drawer, #loading, #liftBanner, #issueSheet, #intro';

export type FilterState = { sev: Set<Severity>; family: RuleInfo['family'] | null };

/**
 * Where a rule stands, as someone reading the register needs it: it passed,
 * it flagged something, it ran but had nothing to act on (no stairs, no tower
 * crane), or it could not verify what is there (skipped on generated massing,
 * an assumed crane position, a failed rule, every candidate untested).
 */
export type RuleState = 'passed' | 'flagged' | 'nothing' | 'notChecked';

export function ruleState(r: RuleResult): RuleState {
  if (r.flagged > 0) return 'flagged';
  if (r.notChecked) return 'notChecked';
  const st = ruleStatus(r);
  return st === 'unverified' ? 'nothing' : st;
}

/** Status words for a rule. "Nothing to check" is kept for a rule with no subject; one that could not verify reads "not checked". */
export const STATUS_WORDS: Record<RuleState, string> = { passed: 'passed', flagged: 'flagged', nothing: 'nothing to check', notChecked: 'not checked' };

/**
 * A family chip in words: the short text on the chip and the sentence for its
 * tooltip and screen readers, which starts with the chip's visible label. A
 * family has passed only when every rule in it was checked; one that had
 * nothing to act on is said to have had nothing to check, and one with a rule
 * that could not verify is never green.
 */
export function familySummary(family: RuleInfo['family'], rules: RuleResult[]): { tone: 'bad' | 'unv' | 'ok'; mark: string; sentence: string } {
  const flagged = rules.reduce((a, x) => a + x.flagged, 0);
  const st = rules.map(ruleState);
  const count = (k: RuleState) => st.filter((x) => x === k).length;
  const passed = count('passed'), checked = passed + count('flagged'), skipped = count('notChecked'), idle = count('nothing');
  const tail = [skipped ? `${skipped} not checked` : '', idle ? `${idle} had nothing to check` : ''].filter(Boolean).join('; ');
  const label = FAMILY_LABEL[family];
  const say = (head: string) => `${label}: ${head}${tail ? `; ${tail}` : ''}`;
  if (flagged) {
    const issues = `${flagged} issue${flagged === 1 ? '' : 's'}`;
    return { tone: 'bad', mark: issues, sentence: say(issues) };
  }
  if (skipped) {
    // the family could not be verified, in part or whole: the neutral tone, never green
    if (!checked) return { tone: 'unv', mark: 'not checked', sentence: `${label}: not checked${idle ? `; ${idle} had nothing to check` : ''}` };
    return { tone: 'unv', mark: `${passed} of ${rules.length} passed`, sentence: say(`${passed} of ${rules.length} passed`) };
  }
  if (!checked) return { tone: 'unv', mark: 'nothing to check', sentence: `${label}: nothing to check` };
  if (idle) return { tone: 'ok', mark: `${checked} of ${rules.length} passed`, sentence: say(`${checked} of ${rules.length} passed`) };
  return { tone: 'ok', mark: rules.length === 1 ? 'passed' : `all ${rules.length} passed`, sentence: `${label}: ${rules.length === 1 ? 'passed' : `all ${rules.length} passed`}` };
}

/** How many rules stand each way, for the verdict and the empty list. */
export function ruleCounts(rules: RuleResult[]): Record<RuleState, number> {
  const out: Record<RuleState, number> = { passed: 0, flagged: 0, nothing: 0, notChecked: 0 };
  for (const r of rules) out[ruleState(r)]++;
  return out;
}

/** The verdict line's rule tally: "11 rules: 5 passed, 2 flagged, 2 nothing to check, 2 not checked". */
export function rulesTally(rules: RuleResult[]): string {
  const n = ruleCounts(rules);
  const parts = [`${n.passed} ${STATUS_WORDS.passed}`, `${n.flagged} ${STATUS_WORDS.flagged}`];
  if (n.nothing) parts.push(`${n.nothing} ${STATUS_WORDS.nothing}`);
  if (n.notChecked) parts.push(`${n.notChecked} ${STATUS_WORDS.notChecked}`);
  return `${rules.length} rule${rules.length === 1 ? '' : 's'}: ${parts.join(', ')}`;
}

/** The empty list when no rule raised anything: it may say "passed" only of rules that ran. */
export function noIssuesText(rules: RuleResult[]): string {
  const n = ruleCounts(rules);
  const bits = ['No issues: every rule that ran passed.'];
  if (n.notChecked) bits.push(`${n.notChecked} ${n.notChecked === 1 ? 'rule was' : 'rules were'} not checked (see Rules and thresholds).`);
  if (n.nothing) bits.push(`${n.nothing} had nothing to check.`);
  return bits.join(' ');
}

/**
 * The scrubber's marks: critical and major issues grouped by step, each group
 * most severe first (report order within a severity), and the groups led by a
 * major issue before those led by a critical one, so the critical marks are
 * drawn on top.
 */
export function markerGroups(issues: Issue[]): Issue[][] {
  const by = new Map<number, Issue[]>();
  for (const i of issues) {
    if (i.severity !== 'critical' && i.severity !== 'major') continue;
    const g = by.get(i.step);
    if (g) g.push(i);
    else by.set(i.step, [i]);
  }
  const groups = [...by.values()].map((g) => g.slice().sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]));
  return groups.sort((a, b) => SEVERITY_ORDER[b[0].severity] - SEVERITY_ORDER[a[0].severity]);
}

/** A press that let go on the spot (within 6 px and a moment) is a tap; anything else was a drag. */
export function isTap(down: { x: number; y: number; t: number }, up: { x: number; y: number; t: number }, pointerType = 'mouse'): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= 6 && up.t - down.t <= (pointerType === 'mouse' ? 600 : 300);
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
 * Where the Issues pane comes to rest once a row is scrolled into view. The
 * ‹ › bar sticks to the top of the pane only once the pane has scrolled past
 * it (`navTop`, its place in the pane's content); short of that, a slice of
 * the summary and the filter chips above it shows over the bar, cut through.
 * So the pane goes on to the bar, where the header has gone and the row
 * (which starts below the bar) still shows whole, or back to the top when
 * the row shows whole from there (`rowBottom`, the row's foot in the pane's
 * content, within the pane's `height`).
 */
export function paneScroll(scrollTop: number, navTop: number, rowBottom: number, height: number): number {
  if (scrollTop < 1 || scrollTop > navTop - 1) return scrollTop;
  return rowBottom <= height ? 0 : Math.round(navTop);
}

/**
 * The scrubber mark a tap at `x` (screen px) meant: the one whose dot is
 * nearest, of those within `reach` (the half-width of a finger's target).
 * The targets of marks closer together than a finger overlap, so the mark
 * whose target happens to be on top is not the one to go by. A tie goes to
 * the later mark (drawn on top: the critical ones go on last). Null when no
 * mark is in reach.
 */
export function nearestMark(x: number, marks: { id: string; x: number }[], reach = 14): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const m of marks) {
    const d = Math.abs(m.x - x);
    if (d <= reach && d <= bestD) {
      best = m.id;
      bestD = d;
    }
  }
  return best;
}

/** What a swipe on the issue sheet's head does once the finger lifts. */
export type SheetSwipe = 'none' | 'fold' | 'unfold' | 'close';

/**
 * What a vertical swipe on the issue sheet's head (its grip and title line)
 * does: `dy` px down (negative up) in `ms`. Down folds the open sheet to its
 * title line, or closes it when it is pulled most of its `height` down or is
 * folded already; up opens a folded sheet out. A movement under `slop` px is
 * a tap, left to the buttons; a quick flick counts at half the distance.
 */
export function sheetSwipe(dy: number, ms: number, folded: boolean, height: number, slop = 8): SheetSwipe {
  if (!Number.isFinite(dy) || Math.abs(dy) < slop) return 'none';
  const flick = ms > 0 && Math.abs(dy) / ms > 0.5;
  const far = (px: number) => Math.abs(dy) >= (flick ? px / 2 : px);
  if (dy > 0) {
    if (folded) return far(40) ? 'close' : 'none';
    if (dy >= Math.max(120, height * 0.6)) return 'close';
    return far(40) ? 'fold' : 'none';
  }
  return folded && far(30) ? 'unfold' : 'none';
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
  /** When a swipe on the sheet's head last ended: the click its lift makes on a button there is not a tap. */
  private swipedAt = -Infinity;
  /** The list's row buttons by issue id, and the chips, from the last render. */
  private rows = new Map<string, HTMLButtonElement>();
  private famChips = new Map<RuleInfo['family'], HTMLButtonElement>();
  private sevChips = new Map<Severity, HTMLButtonElement>();

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
    // a tap on the scrubber at an issue mark selects it (the track still starts its scrub, as anywhere on it)
    $('scrubTrack').onpointerdown = (e) => this.markPress(e);
    $('issNext').onclick = () => this.step(1);
    // a swipe that ends on one of the head's buttons is not a press of it
    const tap = (fn: () => void) => () => {
      if (performance.now() - this.swipedAt > 400) fn();
    };
    $('sheetPrev').onclick = tap(() => this.step(-1));
    $('sheetNext').onclick = tap(() => this.step(1));
    $('sheetClose').onclick = tap(() => {
      // the close button goes with the sheet: the focus moves to the issue's row, or to › when it is filtered out
      const was = this.selected;
      this.select(null);
      const to = (was && this.rows.get(was.id)) || $('issNext');
      to.focus({ preventScroll: !!this.hooks.compact?.() });
    });
    $('sheetToggle').onclick = tap(() => {
      this.folded = !this.folded;
      this.renderSheet();
    });
    this.bindSheetSwipe();
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
    // a file cut off part-way qualifies every verdict here: said first, with the issue that explains it
    const cut = r.issues.find((i) => i.rule === 'MODEL-DATA' && i.key === 'truncated');
    $('issVerdict').innerHTML = `${cut ? `<span class="iss-cut">${esc(cut.id)} · ${esc(cut.title)}.</span> ` : ''}<b>${r.issues.length}</b> issue${r.issues.length === 1 ? '' : 's'} · ${rulesTally(r.rules)} <span class="muted">· ${(r.ms / 1000).toFixed(2)} s</span>`;
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

  /** The family chips, built once per report; a toggle updates them in place, so the focus stays on the chip pressed. */
  private renderFamilies() {
    const r = this.report!;
    const wrap = $('issFamilies');
    wrap.innerHTML = '';
    this.famChips.clear();
    for (const fam of FAMILIES) {
      const rules = r.rules.filter((x) => RULE_BY_ID[x.id].family === fam);
      if (!rules.length) continue;
      const sum = familySummary(fam, rules);
      const b = document.createElement('button');
      b.dataset.family = fam;
      b.dataset.tone = sum.tone;
      // the accessible name starts with the visible label (WCAG 2.5.3, label in name)
      b.setAttribute('aria-label', `${sum.sentence}. Show only these issues.`);
      b.innerHTML = `<span></span><b></b>`;
      b.querySelector('span')!.textContent = FAMILY_LABEL[fam];
      b.querySelector('b')!.textContent = sum.mark;
      b.title = `${sum.sentence}\n${rules.map((x) => `${RULE_BY_ID[x.id].title}: ${STATUS_WORDS[ruleState(x)]} · ${x.note}`).join('\n')}`;
      b.addEventListener('click', () => {
        this.family = this.family === fam ? null : fam;
        this.syncChips();
        this.refilter();
      });
      this.famChips.set(fam, b);
      wrap.append(b);
    }
    this.syncChips();
  }

  /** The severity chips, built once per report (their counts change only with it). */
  private renderSeverities() {
    const r = this.report!;
    const wrap = $('issSev');
    wrap.innerHTML = '';
    this.sevChips.clear();
    for (const s of SEVERITIES) {
      const n = r.issues.filter((i) => i.severity === s).length;
      const b = document.createElement('button');
      b.dataset.sev = s;
      b.innerHTML = `<i></i>${SEV_LABEL[s]} <b>${n}</b>`;
      b.disabled = !n;
      b.addEventListener('click', () => {
        if (this.sev.has(s)) this.sev.delete(s);
        else this.sev.add(s);
        this.syncChips();
        this.refilter();
      });
      this.sevChips.set(s, b);
      wrap.append(b);
    }
    this.syncChips();
  }

  /** The chips' on state and aria-pressed, set in place. */
  private syncChips() {
    for (const [fam, b] of this.famChips) {
      const on = this.family === fam;
      b.className = `fam ${b.dataset.tone}${on ? ' on' : ''}`;
      b.setAttribute('aria-pressed', String(on));
    }
    for (const [s, b] of this.sevChips) {
      const on = this.sev.has(s);
      b.className = `sev sev-${s}${on ? ' on' : ''}`;
      b.setAttribute('aria-pressed', String(on));
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
    // the list is rebuilt: a row that had the focus hands it to its successor, so a second Enter acts on it again
    const active = document.activeElement as HTMLElement | null;
    const refocus = active && active.dataset?.row && list.contains(active) ? active.dataset.row : null;
    list.innerHTML = '';
    this.rows.clear();
    this.renderNav();
    const r = this.report;
    if (!r) return;
    const shown = r.issues.filter((i) => this.visible(i));
    if (!r.issues.length) {
      const li = document.createElement('li');
      li.className = 'iss-empty';
      li.textContent = noIssuesText(r.rules);
      list.append(li);
      return;
    }
    if (!shown.length) list.innerHTML = `<li class="iss-empty">No issues match these filters.</li>`;
    for (const i of shown) {
      const li = document.createElement('li');
      li.className = `iss sev-${i.severity}${this.selected === i ? ' sel' : ''}`;
      li.dataset.id = i.id;
      const step = this.p.steps[i.step];
      const row = document.createElement('button');
      row.className = 'iss-row';
      row.dataset.row = i.id;
      row.setAttribute('aria-expanded', String(this.selected === i));
      row.innerHTML = `<i class="dot"></i><b class="id mono"></b><span class="t"></span><span class="s mono"></span>`;
      row.querySelector('.id')!.textContent = i.id;
      row.querySelector('.t')!.textContent = i.title;
      row.querySelector('.s')!.textContent = step ? `#${step.id}` : '';
      row.addEventListener('click', () => this.select(this.selected === i ? null : i));
      li.append(row);
      if (this.selected === i) li.append(this.detail(i));
      this.rows.set(i.id, row);
      list.append(li);
    }
    if (refocus) this.rows.get(refocus)?.focus({ preventScroll: true });
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
    if (i && !this.hooks.compact?.()) this.scrollToRow(i);
  }

  /**
   * Bring the selected row into the pane, clear of the sticky ‹ › bar over
   * its top: the pane's scroll padding is the bar's height, and a row taller
   * than the pane shows its heading rather than its middle.
   */
  private scrollToRow(i: Issue) {
    const li = $('issList').querySelector<HTMLElement>(`[data-id="${i.id}"]`);
    if (!li) return;
    const pane = $('paneIssues');
    const navH = $('issNav').offsetHeight || 0;
    if (navH) pane.style.scrollPaddingTop = `${navH + 4}px`;
    const tall = li.offsetHeight > pane.clientHeight - navH - 4;
    (tall ? (this.rows.get(i.id) ?? li) : li).scrollIntoView({ block: tall ? 'start' : 'nearest' });
    // where the bar sits before it sticks: the list follows it directly
    const top = pane.getBoundingClientRect().top - pane.scrollTop;
    const navTop = $('issList').getBoundingClientRect().top - top - navH;
    const rowBottom = li.getBoundingClientRect().bottom - top;
    const snapped = paneScroll(pane.scrollTop, navTop, rowBottom, pane.clientHeight);
    if (snapped !== pane.scrollTop) pane.scrollTop = snapped;
  }

  /**
   * The sheet's head is its handle: dragged down it follows the finger, and
   * on release folds the sheet to its title line or closes it; dragged up it
   * opens a folded sheet (sheetSwipe). The stylesheet keeps a drag there from
   * scrolling the page behind the sheet.
   */
  private bindSheetSwipe() {
    const sheet = $('issueSheet');
    const head = sheet.querySelector<HTMLElement>('.sheet-head');
    if (!head) return;
    let drag: { id: number; y: number; at: number; dy: number } | null = null;
    const follow = (dy: number) => {
      // down follows the finger; up gives a little, as a sheet that is already as high as it goes
      sheet.style.transform = dy ? `translateY(${Math.round(dy > 0 ? dy : dy / 4)}px)` : '';
    };
    head.onpointerdown = (e) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { id: e.pointerId, y: e.clientY, at: performance.now(), dy: 0 };
      sheet.classList.add('dragging');
    };
    head.onpointermove = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dy = e.clientY - drag.y;
      if (Math.abs(drag.dy) >= 8 && !head.hasPointerCapture(e.pointerId)) {
        try {
          head.setPointerCapture(e.pointerId);
        } catch {
          /* the pointer is gone already */
        }
      }
      if (Math.abs(drag.dy) >= 8) follow(drag.dy);
    };
    const end = (e: PointerEvent, cancelled: boolean) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      sheet.classList.remove('dragging');
      follow(0);
      if (Math.abs(d.dy) >= 8) this.swipedAt = performance.now();
      const act = cancelled ? 'none' : sheetSwipe(d.dy, performance.now() - d.at, this.folded, sheet.offsetHeight);
      if (act === 'close') this.select(null);
      else if (act === 'fold' || act === 'unfold') {
        this.folded = act === 'fold';
        this.renderSheet();
      }
    };
    head.onpointerup = (e) => end(e, false);
    head.onpointercancel = (e) => end(e, true);
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
      this.syncChips();
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

  /**
   * One mark on the scrubber per step with a critical or major issue, for the
   * most severe of them (its tooltip lists them all); the critical ones go on
   * last, so a major mark close by never covers one. A tap on a mark selects
   * the issue of the mark nearest it (nearestMark); a drag that starts on one
   * scrubs, as anywhere on the track.
   */
  private renderMarkers() {
    const track = $('scrubTrack');
    track.querySelectorAll('.iss-mark').forEach((m) => m.remove());
    const D = this.p.duration;
    for (const group of markerGroups(this.report!.issues)) {
      const i = group[0];
      const m = document.createElement('b');
      m.className = `iss-mark sev-${i.severity}`;
      m.style.left = `${(this.timeOf(i.step) / D) * 100}%`;
      m.title = group.map((x) => `${x.id} · ${x.title}`).join('\n');
      m.dataset.id = i.id;
      track.append(m);
    }
  }

  /**
   * A press on the scrubber that lets go on the spot, within a dot's target
   * of a mark (half of the target the stylesheet draws round it: wider for a
   * finger), selects the issue of the mark nearest it. The track decides,
   * not the mark under the finger: the targets of marks close together
   * overlap each other and the playhead's knob, so the one on top is often a
   * neighbour's.
   */
  private markPress(e: PointerEvent) {
    if (!this.report || e.button > 0) return;
    const reach = e.pointerType === 'mouse' ? 9 : 14;
    const marks = [...$('scrubTrack').querySelectorAll<HTMLElement>('.iss-mark')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.id ?? '', x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const near = marks.filter((m) => Math.abs(m.y - e.clientY) <= reach);
    if (nearestMark(e.clientX, near, reach) === null) return;
    const down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    const up = (u: PointerEvent) => {
      if (u.pointerId !== e.pointerId) return;
      removeEventListener('pointerup', up, true);
      removeEventListener('pointercancel', up, true);
      if (u.type !== 'pointerup' || !isTap(down, { x: u.clientX, y: u.clientY, t: u.timeStamp }, e.pointerType)) return;
      const id = nearestMark(down.x, near, reach);
      if (id) this.selectById(id);
    };
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', up, true);
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
    // a view pass (material, section) shows the whole build, not a step: the row reads '—' as STEP does
    const at = s.presentation?.kind ? -3 : s.stepIndex;
    if (at !== this.lastStep) {
      this.lastStep = at;
      const el = $('opChecks');
      // only a verdict has a colour: '—' and 'checking…' must not keep the last step's green
      delete el.dataset.level;
      if (!this.report) el.textContent = 'checking…';
      else if (at < 0) el.textContent = '—';
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
    const st = ruleState(x);
    // a rule that could not verify keeps the muted 'unverified' look, and says so in words
    const cls = st === 'notChecked' ? 'unverified not-checked' : st === 'nothing' ? 'unverified' : st;
    return `<tr class="${cls}" title="${esc(`${info.rule(r.settings)} — ${x.note}`)}"><td><b>${esc(info.title)}</b><span>${esc(x.note)}</span></td><td>${x.checked}</td><td>${st === 'flagged' ? `✗ ${x.flagged} ${STATUS_WORDS.flagged}` : st === 'passed' ? `✓ ${STATUS_WORDS.passed}` : STATUS_WORDS[st]}</td></tr>`;
  }).join('')}</tbody></table>`;
}
