/**
 * The page's lifecycle rules, kept pure so they are tested without a page:
 * loads that replace one another and the BCF export guard (ui/loads.ts), the
 * time each step is shown at (ui/steps.ts), the first pick over the crane's
 * chart in a kiosk loop and the presentation view (ui/present.ts), the crane
 * toggle beside the crane plan (ui/prefs.ts), the keys on AltGr and Option
 * layouts (ui/keys.ts), the presentation view's keys (ui/shortcuts.ts) and
 * which toast may replace which (ui/layout.ts).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildProject } from '../src/data/project';
import { ACTIVE_HOLD } from '../src/data/assemble';
import type { Project } from '../src/data/types';
import { Timeline } from '../src/engine/timeline';
import { readIfc } from '../src/ifc/model';
import { projectFromIfc } from '../src/ifc/sequence';
import { ExportGuard, LoadGate, sampleFallback, Superseded } from '../src/ui/loads';
import { timeForStep } from '../src/ui/steps';
import { overBannerStays, OVER_NOTE_HOLD, overPickResponse } from '../src/ui/present';
import { craneShown, loadPrefs, savePrefs, toggleCrane, toggleCranePlan, type CraneView, type PrefsStore } from '../src/ui/prefs';
import { modifierOwnsKey, type ModifierState } from '../src/ui/keys';
import { actionInView, CLIENT_ACTIONS, KEY_ACTIONS, rowKeys, sheetActions, shortcutGroupsFor, SHORTCUT_GROUPS } from '../src/ui/shortcuts';
import { toastReplaces } from '../src/ui/layout';

const here = dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(join(here, '../src/main.ts'), 'utf8');

// ── loads ───────────────────────────────────────────────────────────────────

/** A load as main.ts runs one: progress callbacks, then mount or fail, and the loading card. */
function simulate(gate: LoadGate) {
  const log: string[] = [];
  let cardHidden = false;
  const run = (name: string, gen: number) => ({
    progress: () => {
      try {
        gate.check(gen);
        log.push(`${name}:progress`);
        return true;
      } catch (e) {
        expect(e).toBeInstanceOf(Superseded);
        return false;
      }
    },
    finish: (err?: unknown) => {
      if (err === undefined && gate.isCurrent(gen)) log.push(`${name}:mounted`);
      else if (err !== undefined && gate.reports(gen, err)) log.push(`${name}:error`);
      if (gate.isCurrent(gen)) cardHidden = true;
    },
  });
  return { log, run, cardHidden: () => cardHidden };
}

describe('loads that replace one another (R20)', () => {
  it('lets the later load win, whichever finishes first', () => {
    const gate = new LoadGate();
    const s = simulate(gate);
    const a = s.run('a', gate.begin());
    const b = s.run('b', gate.begin());
    // the older load resumes after the newer one began: its meshing stops, it mounts nothing
    expect(a.progress()).toBe(false);
    a.finish();
    expect(s.log).toEqual([]);
    expect(s.cardHidden()).toBe(false); // the newer load still shows its progress
    expect(b.progress()).toBe(true);
    b.finish();
    expect(s.log).toEqual(['b:progress', 'b:mounted']);
    expect(s.cardHidden()).toBe(true);
  });

  it("does not show an older load's error, nor hide the card for it", () => {
    const gate = new LoadGate();
    const s = simulate(gate);
    const a = s.run('a', gate.begin());
    gate.begin(); // a newer load starts
    a.finish(new Error('bad file'));
    a.finish(new Superseded());
    expect(s.log).toEqual([]);
    expect(s.cardHidden()).toBe(false);
  });

  it('reports the current load\'s own failure, but never a Superseded one', () => {
    const gate = new LoadGate();
    const g = gate.begin();
    expect(gate.reports(g, new Error('x'))).toBe(true);
    expect(gate.reports(g, new Superseded())).toBe(false);
    expect(gate.current).toBe(g);
  });

  it('falls back to the demo tower only when the sample failed, nothing is shown and no newer load runs', () => {
    const gate = new LoadGate();
    const sample = gate.begin();
    expect(sampleFallback({ shown: false, mounted: false, gate, gen: sample })).toBe(true);
    expect(sampleFallback({ shown: true, mounted: true, gate, gen: sample })).toBe(false);
    expect(sampleFallback({ shown: false, mounted: true, gate, gen: sample })).toBe(false);
    // a file chosen while the sample loaded: the tower must not flash up while it is read
    gate.begin();
    expect(sampleFallback({ shown: false, mounted: false, gate, gen: sample })).toBe(false);
  });

  it('is what main.ts uses for every load, with the sample fallback through sampleFallback', () => {
    expect(MAIN).not.toMatch(/loadGen/);
    expect(MAIN).toMatch(/const loads = new LoadGate\(\)/);
    expect(MAIN).toMatch(/sampleFallback\(\{ shown, mounted, gate: loads, gen \}\)/);
  });
});

describe('the BCF export guard (R34)', () => {
  it('runs one export at a time and turns stale when the model or the report is replaced', () => {
    const g = new ExportGuard<object, object>();
    let cur = { p: {}, r: {} };
    const run = g.start(cur.p, cur.r, () => cur)!;
    expect(g.running).toBe(true);
    expect(g.start(cur.p, cur.r, () => cur)).toBeNull();
    expect(run.stale()).toBe(false);
    cur = { ...cur, r: {} };
    expect(run.stale()).toBe(true);
    run.done();
    run.done();
    expect(g.running).toBe(false);
    expect(g.start(cur.p, cur.r, () => cur)).not.toBeNull();
  });
});

// ── the time each step is shown at ──────────────────────────────────────────

describe('the time a step is shown at stays in its own stage (R38)', () => {
  let arbor: Project;
  let duplex: Project;
  beforeAll(async () => {
    arbor = buildProject();
    const model = await readIfc(readFileSync(join(here, '../public/samples/duplex-apartment.ifc.txt'), 'latin1'), () => {}, 'Duplex_A_20110907.ifc');
    duplex = projectFromIfc(model, 'Duplex_A_20110907.ifc').project;
  });

  const stageAt = (p: Project, t: number) => p.stages.reduce((acc, s) => (t >= s.start && s.available ? s.n : acc), 1);
  /** The rule before the fix: the next step's start was the only bound. */
  const before = (p: Project, i: number) => {
    const s = p.steps[i], after = p.steps[i + 1];
    return after ? Math.max(s.t0 + 1e-3, Math.min(s.t1 + ACTIVE_HOLD, after.t0 - 1e-3)) : s.t1 + ACTIVE_HOLD;
  };

  for (const name of ['arbor', 'duplex'] as const) {
    it(`${name}: every step is the current step, in its own stage`, () => {
      const p = name === 'arbor' ? arbor : duplex;
      const tl = new Timeline(p);
      let movedBefore = 0;
      p.steps.forEach((s, i) => {
        const t = timeForStep(p.steps, p.stages, i);
        expect(tl.stepIndexAt(t), s.id).toBe(i);
        expect(stageAt(p, t), s.id).toBe(s.stage);
        if (stageAt(p, before(p, i)) !== s.stage) movedBefore++;
      });
      // the old rule put at least one step (the last of a stage) in the stage after it
      expect(movedBefore).toBeGreaterThan(0);
    });
  }

  it('is what main.ts seeks to', () => {
    expect(MAIN).toMatch(/return settledStepTime\(project\.steps, project\.stages, index\);/);
  });
});

// ── the first pick over the crane's chart ───────────────────────────────────

describe("the first pick over the crane's chart (R14, R15)", () => {
  it('stops the full view, plays through a kiosk loop with a note, and says nothing in the presentation view', () => {
    expect(overPickResponse({ autoplay: false, client: false })).toBe('stop');
    expect(overPickResponse({ autoplay: true, client: false })).toBe('note');
    expect(overPickResponse({ autoplay: false, client: true })).toBe('none');
    expect(overPickResponse({ autoplay: true, client: true })).toBe('none');
  });

  it('keeps a stop banner only while the playhead stays on the pick', () => {
    expect(overBannerStays(17.05, 17.05, false)).toBe(true);
    expect(overBannerStays(17.05, 17.0505, false)).toBe(true);
    // six steps back with the arrow keys
    expect(overBannerStays(17.05, 16.2, false)).toBe(false);
    expect(overBannerStays(17.05, 18, false)).toBe(false);
  });

  it('keeps a passing note for a few seconds after the pick, and drops it when the loop starts again', () => {
    expect(overBannerStays(17.05, 17.05, true)).toBe(true);
    expect(overBannerStays(17.05, 17.05 + OVER_NOTE_HOLD - 0.01, true)).toBe(true);
    expect(overBannerStays(17.05, 17.05 + OVER_NOTE_HOLD + 0.01, true)).toBe(false);
    expect(overBannerStays(17.05, 0, true)).toBe(false);
  });

  it('is wired in main.ts: no unconditional stop, and the banner checked on every seek', () => {
    expect(MAIN).not.toMatch(/if \(over\) stopOnOverPick\(over\)/);
    expect(MAIN).toMatch(/overPickResponse\(\{ autoplay: kiosk, client: view\.client \}\)/);
    expect(MAIN).toMatch(/!overBannerStays\(bannerPick\.t, playback\.t, bannerNote\)\)\) hideOverBanner\(\)/);
  });
});

// ── the crane toggle and the crane plan ─────────────────────────────────────

class MemoryStore implements PrefsStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('the crane plan never changes the saved crane choice (R16)', () => {
  it('K (crane off), L, L, G saves the crane off', () => {
    const store = new MemoryStore();
    let v: CraneView = { crane: true, plan: false };
    v = toggleCrane(v); // K
    expect(v).toEqual({ crane: false, plan: false });
    v = toggleCranePlan(v); // L: the plan shows the crane
    expect(craneShown(v)).toBe(true);
    // G (or anything else that saves) while the plan is open saves the user's choice
    savePrefs(store, { view: { crane: v.crane } });
    expect(loadPrefs(store).view?.crane).toBe(false);
    v = toggleCranePlan(v); // L: back as it was
    expect(v).toEqual({ crane: false, plan: false });
    expect(craneShown(v)).toBe(false);
    savePrefs(store, { view: { crane: v.crane } }); // G
    expect(loadPrefs(store).view?.crane).toBe(false);
  });

  it('K from the plan turns the crane off and closes the plan', () => {
    expect(toggleCrane({ crane: true, plan: true })).toEqual({ crane: false, plan: false });
    expect(toggleCrane({ crane: false, plan: true })).toEqual({ crane: false, plan: false });
  });

  it('is how main.ts draws and saves the crane', () => {
    expect(MAIN).not.toMatch(/view\.crane = true/);
    expect(MAIN).toMatch(/craneShown\(craneView\(\)\) \? crane : /);
    expect(MAIN).toMatch(/crane: view\.crane, autoRotate: rotatePref/);
  });
});

// ── keys ────────────────────────────────────────────────────────────────────

const press = (key: string, mods: Partial<ModifierState> & { altGraph?: boolean } = {}): ModifierState => ({
  key,
  ctrlKey: !!mods.ctrlKey,
  metaKey: !!mods.metaKey,
  altKey: !!mods.altKey,
  getModifierState: (n) => n === 'AltGraph' && !!mods.altGraph,
});

describe('shortcuts on AltGr and Option layouts (R61)', () => {
  it('answers [ ] ? typed with AltGr (Windows reports it as Ctrl+Alt too)', () => {
    for (const k of ['[', ']', '?']) {
      expect(modifierOwnsKey(press(k, { altGraph: true })), k).toBe(false);
      expect(modifierOwnsKey(press(k, { altGraph: true, ctrlKey: true, altKey: true })), k).toBe(false);
    }
  });

  it('answers [ ] ? typed with Alt or Option, but not Alt with a letter or a digit', () => {
    for (const k of ['[', ']', '?']) expect(modifierOwnsKey(press(k, { altKey: true })), k).toBe(false);
    for (const k of ['l', 'k', '1', 'arrowleft', ' ']) expect(modifierOwnsKey(press(k, { altKey: true })), k).toBe(true);
  });

  it('leaves Ctrl and Meta combinations to the browser, and plain keys to the page', () => {
    expect(modifierOwnsKey(press('[', { ctrlKey: true }))).toBe(true);
    expect(modifierOwnsKey(press('?', { metaKey: true }))).toBe(true);
    expect(modifierOwnsKey(press('l'))).toBe(false);
    expect(modifierOwnsKey({ key: ']', ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });

  it('is what main.ts asks', () => {
    expect(MAIN).not.toMatch(/if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey\) return;/);
    expect(MAIN).toMatch(/if \(modifierOwnsKey\(e\)\) return;/);
  });
});

describe("the presentation view's keys and shortcut sheet (R60)", () => {
  it('ignores the drawer and expert keys, and answers playback, the plain toggles, the issues, P and ?', () => {
    for (const k of ['s', 'l', 'x', 'i', 'v', 'f']) expect(actionInView(KEY_ACTIONS[k], true), k).toBe(false);
    for (const k of [' ', 'r', 'a', 'c', 'g', 'k', ']', '[', 'arrowleft', 'arrowright', 'home', 'p', '?']) expect(actionInView(KEY_ACTIONS[k], true), k).toBe(true);
    for (const k of Object.keys(KEY_ACTIONS)) expect(actionInView(KEY_ACTIONS[k], false), k).toBe(true);
  });

  it('lists only the keys the view answers', () => {
    const client = shortcutGroupsFor(true);
    expect(sheetActions(client)).toEqual(new Set(CLIENT_ACTIONS));
    const keys = client.flatMap((g) => g.rows.map(rowKeys));
    expect(keys).not.toContain('1 – 7');
    expect(keys).not.toContain('Shift D');
    expect(keys).toContain('Esc');
    expect(client.flatMap((g) => g.rows).find((r) => rowKeys(r) === 'Esc')!.text).not.toMatch(/drawer/);
    // the full view's sheet is the whole table
    expect(shortcutGroupsFor(false)).toBe(SHORTCUT_GROUPS);
  });

  it('closes the drawer and the crane plan on the way in, and gates the keys in main.ts', () => {
    const set = MAIN.match(/function setClient\([\s\S]*?\n\}/)?.[0] ?? '';
    expect(set).toMatch(/selectRail\('model'\)/);
    expect(set).toMatch(/setCranePlan\(false\)/);
    expect(MAIN).toMatch(/if \(!actionInView\(id, view\.client\)\) return;/);
    expect(MAIN).toMatch(/\/\^\[1-7\]\$\/\.test\(k\) && !view\.client/);
    expect(MAIN).toMatch(/shortcutSheetHtml\(shortcutGroupsFor\(view\.client\)\)/);
  });
});

// ── toasts ──────────────────────────────────────────────────────────────────

describe('a passing note never covers a failure (R65)', () => {
  it('keeps an error or a warning over an info toast, and lets anything replace an info toast', () => {
    expect(toastReplaces('error', 'info')).toBe(false);
    expect(toastReplaces('warn', 'info')).toBe(false);
    expect(toastReplaces('error', 'error')).toBe(true);
    expect(toastReplaces('warn', 'error')).toBe(true);
    expect(toastReplaces('error', 'warn')).toBe(true);
    expect(toastReplaces('info', 'info')).toBe(true);
    expect(toastReplaces(null, 'info')).toBe(true);
  });

  it('shows BCF progress on the button, not in a toast', () => {
    expect(MAIN).not.toMatch(/toast\(`Rendering BCF snapshots/);
    expect(MAIN).toMatch(/btn\.textContent = `BCF \$\{k \+ 1\}\/\$\{r\.issues\.length\}`/);
  });
});

// ── the crane's pick, the BCF author and the default framing ────────────────

describe('the operation panel and the reach read the pick the crane check reads (R10)', () => {
  it('names the rigged critical piece when the rigging changes which piece is critical', async () => {
    const { riggedLift } = await import('../src/engine/lifts');
    const { liftText } = await import('../src/ui/panels');
    const p = buildProject();
    let changed = 0;
    for (const rig of [0, 250, 1000]) {
      for (const s of p.steps) {
        const l = riggedLift(p, s.index, rig);
        if (!l || !s.lift) continue;
        const text = liftText(s, 'TC-1', 0.85, rig, l).text;
        expect(text, s.id).toContain(`R ${l.radius.toFixed(1)} m`);
        if (Math.abs(l.radius - s.lift.radius) > 0.05) changed++;
      }
    }
    // with rigging, some step's critical piece is not the one step.lift names
    expect(changed).toBeGreaterThan(0);
    expect(MAIN).toMatch(/rigged = project\.steps\.map\(\(s\) => riggedLift\(project, s\.index, checkSettings\.riggingKg\)\);/);
    expect(MAIN).toMatch(/ui\.liftFor = \(i\) => rigged\[i\] \?\? null;/);
    expect(MAIN).toMatch(/const crane = riggedCrane\(state\.crane\);/);
  });
});

describe('BCF exports carry the brand on show (O10)', () => {
  it('passes the brand name as the author', () => {
    expect(MAIN).toMatch(/const brand = brandName\(params\.get\('brand'\)\);/);
    expect(MAIN).toMatch(/bcfZip\(p, r, shots, new Date\(\), \{ author: brand \}\)/);
  });
});

describe('the default framing keeps the model clear of the cards (R68)', () => {
  it('sets the rest box from the clear room on mount, resize, drawers and caption changes', () => {
    const fn = MAIN.match(/function syncRestBox\(\)(?:: \w+)? \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(fn).toMatch(/const bounds = \{ x0: 0, y0: 0, x1: w, y1: h \}, chrome = chromeBoxes\(\$\('viewport'\), FRAME_CHROME, 8, document\), caption = captionBox\(\);/);
    // a wide screen also keeps a tall model's crown off the caption (Z7)
    expect(fn).toMatch(/isNarrow\(\) \? restFrame\(bounds, chrome, caption, model\) : restFrameClear\(bounds, chrome, caption, model, /);
    expect(fn).toMatch(/viewer\.setRestBox\(/);
    expect(MAIN).toMatch(/const rest = new ResizeObserver\(\(\) => syncRestBox\(\)\);/);
    for (const id of ['viewport', 'caption', 'titleBlock', 'drawer']) expect(MAIN).toMatch(new RegExp(`'${id}'[^\\n]*\\]\\) rest\\.observe`));
    expect(MAIN).toMatch(/renderIntro\(\);\s*syncRestBox\(\);\s*\}/);
  });
});

describe('the default framing picks the clear part that shows the model largest (R68)', () => {
  // 1440 × 900: the viewport with its toolbar, title block, scrubber and transport, and the caption (px)
  const W = 813, H = 630;
  const bounds = { x0: 0, y0: 0, x1: W, y1: H };
  const chrome = [
    { x0: 8, y0: 6, x1: 553, y1: 57 },
    { x0: 553, y0: 6, x1: 805, y1: 208 },
    { x0: 24, y0: 485, x1: 788, y1: 536 },
    { x0: 106, y0: 536, x1: 707, y1: 617 },
  ];
  const caption = { x0: 8, y0: 57, x1: 423, y1: 202 };
  const inside = (b: { x0: number; y0: number; x1: number; y1: number }, o: typeof b) => b.x1 <= o.x0 || b.x0 >= o.x1 || b.y1 <= o.y0 || b.y0 >= o.y1;

  it('gives a tower a tall column clear of the caption and the title block', async () => {
    const { restFrame } = await import('../src/ui/place');
    const box = restFrame(bounds, chrome, caption, { w: 40, h: 115 })!;
    expect(box).not.toBeNull();
    for (const o of [...chrome, caption]) expect(inside(box, o)).toBe(true);
    expect(box.y1 - box.y0).toBeGreaterThan(box.x1 - box.x0);
  });

  it('gives a low, wide building a wide band', async () => {
    const { restFrame } = await import('../src/ui/place');
    const box = restFrame(bounds, chrome, caption, { w: 30, h: 8 })!;
    expect(box.x1 - box.x0).toBeGreaterThan(box.y1 - box.y0);
    for (const o of [...chrome, caption]) expect(inside(box, o)).toBe(true);
  });

  it('keeps the usual framing when no clear part shows the model at a fair size', async () => {
    const { restFrame } = await import('../src/ui/place');
    const crowded = [...chrome, { x0: 0, y0: 200, x1: W, y1: 480 }];
    expect(restFrame(bounds, crowded, caption, { w: 40, h: 115 })).toBeNull();
  });
});
