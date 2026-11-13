import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Project, Vec3 } from '../src/data/types';
import { buildProject } from '../src/data/project';
import { DEFAULT_SETTINGS, type CheckReport, type Issue, type RuleId, type RuleResult, type Severity } from '../src/checks/types';
import { memberWords, partLabel, sentenceStart } from '../src/checks/rules';
import { issueView } from '../src/checks/view';
import { carryFilters, familySummary, issuePosition, IssuesUI, stepIndex } from '../src/ui/issues';
import { boxSide, clearBox, issueFrame, pinLabel, type Box } from '../src/ui/place';
import type { SequenceState } from '../src/engine/timeline';
import type { Viewer } from '../src/scene/viewer';

// ── a small stand-in for the page, enough for the Issues panel ──────────────

class El {
  children: El[] = [];
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>();
  textContent = '';
  className = '';
  title = '';
  hidden = false;
  disabled = false;
  style: Record<string, string> = {};
  onclick: (() => void) | null = null;
  private listeners: (() => void)[] = [];
  private html = '';
  constructor(public tag = 'div') {}
  get innerHTML() {
    return this.html;
  }
  set innerHTML(v: string) {
    this.html = v;
    this.children = [];
  }
  get childNodes() {
    return this.children;
  }
  get firstElementChild() {
    return this.children[0] ?? new El();
  }
  addEventListener(_type: string, f: () => void) {
    this.listeners.push(f);
  }
  click() {
    this.listeners.forEach((f) => f());
    this.onclick?.();
  }
  toggleAttribute(name: string, on: boolean) {
    if (on) this.attrs.set(name, '');
    else this.attrs.delete(name);
  }
  setAttribute(name: string, v: string) {
    this.attrs.set(name, v);
  }
  append(...items: unknown[]) {
    for (const x of items) if (x instanceof El) this.children.push(x);
  }
  prepend(...items: unknown[]) {
    this.append(...items);
  }
  remove() {}
  querySelector() {
    return new El();
  }
  querySelectorAll() {
    return [];
  }
  scrollIntoView() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
}

const els = new Map<string, El>();
const byId = (id: string) => {
  if (!els.has(id)) els.set(id, new El());
  return els.get(id)!;
};

beforeAll(() => {
  vi.stubGlobal('document', { getElementById: byId, querySelectorAll: () => [], createElement: (t: string) => new El(t) });
});
afterAll(() => vi.unstubAllGlobals());

const project = { steps: Array.from({ length: 6 }, (_, k) => ({ id: String(k + 1).padStart(3, '0'), member: 'L01 · TEST' })), parts: [], stages: [], duration: 10 } as unknown as Project;
const viewer = { viewportSize: { w: 800, h: 600 }, project: () => ({ x: 0, y: 0, behind: true }) } as unknown as Viewer;
const box: [Vec3, Vec3] = [[0, 0, 0], [1, 1, 1]];

function issue(id: string, rule: RuleId, severity: Severity, step: number): Issue {
  return { id, rule, severity, step, title: id, detail: '', action: '', primary: [], secondary: [], at: [0, 0, 0], box, lines: [] };
}
const rule = (id: RuleId, flagged: number, checked = 10): RuleResult => ({ id, checked, flagged, applicable: checked > 0, note: '' });

function report(issues: Issue[]): CheckReport {
  const ids: RuleId[] = ['ORDER-SUPPORT', 'TEMP-EDGE', 'REACH-CRANE', 'CLASH-HARD', 'CLASH-TEMP', 'ACCESS-HANDLING'];
  return { issues, rules: ids.map((r) => rule(r, issues.filter((i) => i.rule === r).length, r === 'CLASH-TEMP' ? 0 : 10)), settings: DEFAULT_SETTINGS, ms: 1 };
}

const ISSUES = [
  issue('EDG-01', 'TEMP-EDGE', 'critical', 1),
  issue('RCH-01', 'REACH-CRANE', 'major', 2),
  issue('RCH-02', 'REACH-CRANE', 'major', 3),
  issue('CLH-01', 'CLASH-HARD', 'minor', 4),
  issue('HND-01', 'ACCESS-HANDLING', 'note', 5),
];

function panel(r: CheckReport | null = report(ISSUES)) {
  const picked: (Issue | null)[] = [];
  const ui = new IssuesUI(project, viewer, (s) => s, { select: (i) => picked.push(i), exportBcf: () => {}, exportCsv: () => {} });
  if (r) ui.setReport(r);
  return { ui, picked };
}
const state = (stepIndex: number) => ({ stepIndex }) as SequenceState;
const chip = (wrap: string, cls: string) => byId(wrap).children.find((b) => b.className.split(' ').includes(cls))!;
const listed = () => byId('issList').children.map((li) => li.dataset.id);

describe('issue stepping', () => {
  it('steps back from nothing to the last issue and forward to the first (F41)', () => {
    expect(stepIndex(-1, -1, 21)).toBe(20);
    expect(stepIndex(-1, 1, 21)).toBe(0);
    expect(stepIndex(-1, -1, 2)).toBe(1);
    expect(stepIndex(0, -1, 21)).toBe(20);
    expect(stepIndex(20, 1, 21)).toBe(0);
    expect(stepIndex(5, -1, 21)).toBe(4);
    expect(stepIndex(0, -1, 1)).toBe(0);
    expect(stepIndex(-1, 1, 0)).toBe(-1);
  });

  it("'[' with nothing selected picks the last issue in the panel", () => {
    const { ui } = panel();
    ui.step(-1);
    expect(ui.selected?.id).toBe('HND-01');
    ui.step(-1);
    expect(ui.selected?.id).toBe('CLH-01');
    ui.step(1);
    ui.step(1);
    expect(ui.selected?.id).toBe('EDG-01');
  });

  it('the ‹ › buttons step the newest panel only, and the counter reads "n of m"', () => {
    const old = panel().ui;
    const { ui } = panel();
    byId('issNext').click();
    expect(ui.selected?.id).toBe('EDG-01');
    expect(old.selected).toBeNull();
    expect(byId('issPos').textContent).toBe('1 of 5');
    byId('issPrev').click();
    expect(ui.selected?.id).toBe('HND-01');
    expect(byId('issPos').textContent).toBe('5 of 5');
    expect(byId('issPrev').attrs.has('disabled')).toBe(false);
  });

  it('words the counter plainly', () => {
    expect(issuePosition(2, 21, 21)).toBe('3 of 21');
    expect(issuePosition(-1, 21, 21)).toBe('21 issues');
    expect(issuePosition(-1, 18, 21)).toBe('18 of 21 shown');
    expect(issuePosition(-1, 1, 1)).toBe('1 issue');
    expect(issuePosition(-1, 0, 0)).toBe('No issues');
  });
});

describe('filters and the selection', () => {
  it('turning off the selected issue’s severity lets the selection go, with its highlight (F42)', () => {
    const { ui, picked } = panel();
    ui.selectById('RCH-02');
    expect(picked.at(-1)?.id).toBe('RCH-02');
    chip('issSev', 'sev-major').click();
    expect(listed()).not.toContain('RCH-02');
    expect(ui.selected).toBeNull();
    expect(picked.at(-1)).toBeNull(); // main clears the x-ray, the pin and the camera pose
  });

  it('picking another family lets a selection outside it go', () => {
    const { ui, picked } = panel();
    ui.selectById('EDG-01');
    chip('issFamilies', 'bad').click(); // the first flagged family is TEMP: the selection stays
    expect(ui.selected?.id).toBe('EDG-01');
    chip('issFamilies', 'on').click(); // off again
    const reach = byId('issFamilies').children.find((b) => b.children.length === 0 && b.attrs.get('aria-label')?.startsWith('Crane checks'))!;
    reach.click();
    expect(listed()).toEqual(['RCH-01', 'RCH-02']);
    expect(ui.selected).toBeNull();
    expect(picked.at(-1)).toBeNull();
  });

  it('a filter that keeps the selection leaves it alone', () => {
    const { ui, picked } = panel();
    ui.selectById('EDG-01');
    const n = picked.length;
    chip('issSev', 'sev-note').click();
    expect(ui.selected?.id).toBe('EDG-01');
    expect(picked.length).toBe(n);
  });

  it('a re-run keeps the severity and family filters (F43)', () => {
    const first = panel().ui;
    chip('issSev', 'sev-major').click();
    const kept = first.filters();
    const { ui } = panel(null);
    ui.restoreFilters(kept);
    ui.setReport(report(ISSUES));
    expect(listed()).toEqual(['EDG-01', 'CLH-01', 'HND-01']);
    expect(chip('issSev', 'sev-major').className).not.toMatch(/\bon\b/);
    expect(chip('issSev', 'sev-critical').className).toMatch(/\bon\b/);
  });

  it('a severity turned off but missing from the new report comes back on, so its chip is not stuck off', () => {
    const kept = { sev: new Set<Severity>(['critical', 'minor', 'note']), family: 'CLASH' as const };
    const withMajor = carryFilters(kept, ISSUES);
    expect([...withMajor.sev].sort()).toEqual(['critical', 'minor', 'note']);
    expect(withMajor.family).toBe('CLASH');
    const noMajor = carryFilters(kept, ISSUES.filter((i) => i.severity !== 'major'));
    expect(noMajor.sev.has('major')).toBe(true);
    expect(kept.sev.has('major')).toBe(false); // the panel's own set is not changed under it
  });
});

describe('the CHECKS row (F44)', () => {
  it("shows '—' and 'checking…' without the last verdict's pass colour", () => {
    const { ui } = panel();
    const row = byId('opChecks');
    ui.update(state(0)); // step 0 has no issue
    expect(row.textContent).toMatch(/no issue/);
    expect(row.dataset.level).toBe('ok');
    ui.update(state(-1));
    expect(row.textContent).toBe('—');
    expect(row.dataset.level).toBeUndefined();
    ui.update(state(1));
    expect(row.dataset.level).toBe('critical');
    ui.update(state(0));
    expect(row.dataset.level).toBe('ok');
    // a re-run builds a new panel on the same row
    const next = panel(null).ui;
    expect(row.textContent).toBe('checking…');
    expect(row.dataset.level).toBeUndefined();
    next.update(state(0));
    expect(row.dataset.level).toBeUndefined();
  });

  it('a failed run reads "not checked" with no colour', () => {
    const { ui } = panel();
    ui.update(state(0));
    ui.failed('boom');
    expect(byId('opChecks').textContent).toBe('not checked');
    expect(byId('opChecks').dataset.level).toBeUndefined();
  });
});

describe('plain wording', () => {
  const r = (id: RuleId, flagged: number, checked: number) => rule(id, flagged, checked);

  it('says what "1/2 ✓" meant', () => {
    const s = familySummary('CLASH', [r('CLASH-HARD', 0, 40), r('CLASH-TEMP', 0, 0)]);
    expect(s.mark).toBe('1 of 2 passed');
    expect(s.sentence).toBe('Clash checks: 1 of 2 passed; 1 had nothing to check');
    expect(s.tone).toBe('ok');
  });

  it('words flagged, idle and passed families', () => {
    expect(familySummary('CLASH', [r('CLASH-HARD', 16, 40), r('CLASH-TEMP', 0, 0)])).toMatchObject({ tone: 'bad', mark: '16 issues', sentence: 'Clash checks: 16 issues; 1 had nothing to check' });
    expect(familySummary('MODEL', [r('MODEL-DATA', 1, 3)]).mark).toBe('1 issue');
    expect(familySummary('MODEL', [r('MODEL-DATA', 0, 0)])).toMatchObject({ tone: 'unv', mark: 'nothing to check', sentence: 'Model data checks: nothing to check' });
    expect(familySummary('ORDER', [r('ORDER-SUPPORT', 0, 9)])).toMatchObject({ mark: 'passed', sentence: 'Order checks: passed' });
    expect(familySummary('REACH', [r('REACH-CRANE', 0, 9), r('REACH-PATH', 0, 9)]).mark).toBe('all 2 passed');
  });

  it('family chips read in words, with no "✓" codes', () => {
    panel();
    const chips = byId('issFamilies').children;
    expect(chips.map((b) => b.attrs.get('aria-label'))).toContain('Clash checks: 1 issue; 1 had nothing to check. Show only these issues.');
    for (const b of chips) expect(b.title).not.toMatch(/\d\/\d|unverified/);
  });

  it('writes member names in sentence case, keeping codes and abbreviations', () => {
    expect(memberWords('SKY GARDEN · L12–L13')).toBe('sky garden · L12–L13');
    expect(memberWords('L05 · GLULAM COLUMNS & BEAMS')).toBe('L05 · glulam columns & beams');
    expect(memberWords('ROOF · CLT DECK')).toBe('roof · CLT deck');
    expect(memberWords('TC-1 · TOWER CRANE ERECTED')).toBe('TC-1 · tower crane erected');
    expect(memberWords('L01 · PT FLAT SLAB')).toBe('L01 · PT flat slab');
    expect(memberWords('CORE · JUMP L32–ROOF')).toBe('core · jump L32–roof');
    expect(memberWords('SITE · SETTING-OUT')).toBe('site · setting-out');
    expect(sentenceStart('trees · sky garden L12–L13 is beyond the jib')).toBe('Trees · sky garden L12–L13 is beyond the jib');
    expect(sentenceStart('M_W-Wide Flange clashes')).toBe('M_W-Wide Flange clashes');
    expect(sentenceStart('')).toBe('');
  });

  it('labels generated parts without lower-case level codes', () => {
    const p = buildProject();
    const labels = p.parts.map((_, i) => i).filter((i) => p.parts[i].mat !== 'context').map((i) => partLabel(p, i));
    const garden = labels.find((l) => /sky garden/i.test(l))!;
    expect(garden).toMatch(/sky garden L\d+–L\d+/);
    expect(labels.some((l) => /\bl\d{2}\b/.test(l))).toBe(false); // no "l12"
    expect(labels.some((l) => /[A-Z]{4,}/.test(l.replace(/\b(?:CLT|BMU|GL28h|C40\/50|PV)\b/g, '')))).toBe(false); // no SHOUTED words
  });
});

describe('framing an issue clear of the viewport cards (F46)', () => {
  // the viewport at 1280 × 720, measured in the browser (pixels within #viewport), padded 8 px
  const pad = (b: Box): Box => ({ x0: b.x0 - 8, y0: b.y0 - 8, x1: b.x1 + 8, y1: b.y1 + 8 });
  const view: Box = { x0: 0, y0: 0, x1: 706, y1: 450 };
  const toolbar = pad({ x0: 15, y0: 15, x1: 501, y1: 51 });
  const titleBlock = pad({ x0: 455, y0: 15, x1: 691, y1: 190 });
  const scrubber = pad({ x0: 31, y0: 313, x1: 675, y1: 347 });
  const transport = pad({ x0: 59, y0: 365, x1: 647, y1: 431 });
  const caption = pad({ x0: 15, y0: 63, x1: 423, y1: 210 });
  const chrome = [toolbar, titleBlock, scrubber, transport];
  const hits = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

  it('finds the biggest clear box', () => {
    expect(clearBox({ x0: 0, y0: 0, x1: 100, y1: 100 }, [])).toEqual({ x0: 0, y0: 0, x1: 100, y1: 100 });
    expect(clearBox({ x0: 0, y0: 0, x1: 100, y1: 100 }, [{ x0: 0, y0: 0, x1: 100, y1: 30 }])).toEqual({ x0: 0, y0: 30, x1: 100, y1: 100 });
    const b = clearBox(view, [...chrome, caption]);
    for (const o of [...chrome, caption]) expect(hits(b, o)).toBe(false);
    expect(boxSide(b)).toBeGreaterThan(80);
  });

  it('at 1280 × 720 the caption steps aside, and the box misses the title block and the controls', () => {
    const f = issueFrame(view, chrome, caption);
    expect(f.hideCaption).toBe(true);
    for (const o of chrome) expect(hits(f.box, o)).toBe(false);
    expect(boxSide(f.box)).toBeGreaterThan(200);
  });

  it('keeps the caption when the room it leaves is nearly as good', () => {
    const wide: Box = { x0: 0, y0: 0, x1: 1200, y1: 800 };
    const small = pad({ x0: 15, y0: 63, x1: 330, y1: 160 });
    const f = issueFrame(wide, [pad({ x0: 15, y0: 15, x1: 500, y1: 51 }), pad({ x0: 950, y0: 15, x1: 1185, y1: 190 })], small);
    expect(f.hideCaption).toBe(false);
    expect(hits(f.box, small)).toBe(false);
  });

  it('keeps the caption on a big screen, where the room under it is plenty', () => {
    // 1920 × 1080: about 426 px clear under the caption against 578 px without it
    const big: Box = { x0: 0, y0: 0, x1: 1228, y1: 782 };
    const chromeBig = [pad({ x0: 15, y0: 15, x1: 501, y1: 51 }), pad({ x0: 945, y0: 15, x1: 1213, y1: 190 }), pad({ x0: 31, y0: 645, x1: 1197, y1: 679 }), pad({ x0: 247, y0: 697, x1: 981, y1: 763 })];
    const f = issueFrame(big, chromeBig, pad({ x0: 15, y0: 63, x1: 510, y1: 203 }));
    expect(f.hideCaption).toBe(false);
    expect(boxSide(f.box)).toBeGreaterThan(380);
  });

  it('falls back to the whole viewport when the cards leave too little', () => {
    const f = issueFrame({ x0: 0, y0: 0, x1: 300, y1: 300 }, [{ x0: 0, y0: 0, x1: 300, y1: 250 }], null);
    expect(f.box).toEqual({ x0: 0, y0: 0, x1: 300, y1: 300 });
  });

  it('frames the issue to fit the clear box, from the same direction', () => {
    const i = { ...issue('X', 'CLASH-HARD', 'minor', 0), box: [[0, 0, 0], [6, 3, 4]] as [Vec3, Vec3] };
    const full = issueView(i, 706 / 450);
    const part = issueView(i, 706 / 450, undefined, { w: 0.4, h: 0.55 });
    expect(part.target).toEqual(full.target);
    expect(part.az).toBe(full.az);
    expect(part.dist).toBeGreaterThan(full.dist * 1.7);
    expect(issueView(i, 706 / 450, undefined, { w: NaN, h: 1 }).dist).toBeCloseTo(full.dist);
  });

  it("moves the pin's tag off the title block, never the dot", () => {
    const size = { w: 50, h: 20 };
    // free: up and to the right
    expect(pinLabel({ x: 200, y: 300 }, size, view, chrome)).toEqual({ x: 226, y: 256 });
    // up-right would land on the title block: another clear side is taken
    const at = pinLabel({ x: 420, y: 220 }, size, view, chrome);
    const tag = { x0: at.x, y0: at.y, x1: at.x + size.w, y1: at.y + size.h };
    for (const o of chrome) expect(hits(tag, o)).toBe(false);
    // at the right edge the tag stays on screen and off the dot
    const edge = pinLabel({ x: 700, y: 250 }, size, view, []);
    expect(edge.x + size.w).toBeLessThanOrEqual(706);
    expect(edge.x + size.w).toBeLessThan(700);
  });
});

describe('the issue sheet on a narrow screen (phone first aid)', () => {
  function compactPanel(compact: boolean) {
    const picked: (Issue | null)[] = [];
    const ui = new IssuesUI(project, viewer, (s) => s, { select: (i) => picked.push(i), exportBcf: () => {}, exportCsv: () => {}, compact: () => compact });
    ui.setReport(report(ISSUES));
    return { ui, picked };
  }

  it('opens on a selection with the issue in it, and closes with the selection', () => {
    const { ui, picked } = compactPanel(true);
    expect(byId('issueSheet').hidden).toBe(true);
    ui.selectById('RCH-01');
    expect(byId('issueSheet').hidden).toBe(false);
    expect(byId('issueSheet').className).toContain('sev-major');
    expect(byId('sheetId').textContent).toBe('RCH-01');
    expect(byId('sheetBody').children.map((c) => c.className)).toEqual(['iss-body']);
    // its close button lets the issue go, highlight, pin and all
    byId('sheetClose').click();
    expect(ui.selected).toBeNull();
    expect(picked.at(-1)).toBeNull();
    expect(byId('issueSheet').hidden).toBe(true);
  });

  it('steps through the issues from the sheet', () => {
    const { ui } = compactPanel(true);
    ui.selectById('EDG-01');
    byId('sheetNext').click();
    expect(ui.selected?.id).toBe('RCH-01');
    expect(byId('sheetId').textContent).toBe('RCH-01');
    byId('sheetPrev').click();
    expect(ui.selected?.id).toBe('EDG-01');
  });

  it('folds to its title line, keeps the fold while stepping, and opens out on a fresh selection', () => {
    const { ui } = compactPanel(true);
    ui.selectById('EDG-01');
    byId('sheetToggle').click();
    expect(byId('issueSheet').className).toContain('folded');
    expect(byId('sheetToggle').attrs.get('aria-expanded')).toBe('false');
    byId('sheetNext').click();
    expect(byId('issueSheet').className).toContain('folded');
    ui.select(null);
    ui.selectById('HND-01');
    expect(byId('issueSheet').className).not.toContain('folded');
    expect(byId('sheetToggle').attrs.get('aria-expanded')).toBe('true');
  });

  it('does not scroll the page down to the list on a narrow screen, and still does on a wide one', () => {
    const scrolled: string[] = [];
    const row = { scrollIntoView: () => scrolled.push('row') };
    const list = byId('issList') as unknown as { querySelector: () => unknown };
    const was = list.querySelector;
    list.querySelector = () => row;
    try {
      compactPanel(true).ui.selectById('RCH-02');
      expect(scrolled).toEqual([]);
      compactPanel(false).ui.selectById('RCH-02');
      expect(scrolled).toEqual(['row']);
    } finally {
      list.querySelector = was;
    }
  });

  it('starts hidden for a new model or a fresh run of the checks', () => {
    const { ui } = compactPanel(true);
    ui.selectById('RCH-01');
    expect(byId('issueSheet').hidden).toBe(false);
    compactPanel(true);
    expect(byId('issueSheet').hidden).toBe(true);
  });
});
