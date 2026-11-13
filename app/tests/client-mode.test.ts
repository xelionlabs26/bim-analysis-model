/**
 * The presentation view, the opening frame, the first-run cards and the
 * shortcut sheet: the rules in ui/present.ts and ui/shortcuts.ts, and the
 * markup and styles they rely on.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { heroLine, INTRO_KEY, introCards, markIntroSeen, modeFromLink, openingPlan, presentButton, showIntro, startsInClientMode } from '../src/ui/present';
import { KEY_ACTIONS, keyAction, RAIL_KEY_NAMES, rowKeys, sheetActions, SHORTCUT_GROUPS, shortcutSheetHtml, type ActionId } from '../src/ui/shortcuts';
import { loadPrefs, PREFS_KEY, sanitiseView, savePrefs, type PrefsStore } from '../src/ui/prefs';
import { routeKey, type KeyTarget } from '../src/ui/keys';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const CSS = read('../src/styles.css');
const HTML = read('../index.html');
const MAIN = read('../src/main.ts');

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
const blocked: PrefsStore = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  removeItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
};

// ── presentation view ───────────────────────────────────────────────────────

describe('presentation view', () => {
  it('opens from ?mode=client and closes from ?mode=expert, whatever was saved', () => {
    expect(modeFromLink('client')).toBe(true);
    expect(modeFromLink('Client')).toBe(true);
    expect(modeFromLink('present')).toBe(true);
    expect(modeFromLink('expert')).toBe(false);
    expect(modeFromLink('full')).toBe(false);
    expect(startsInClientMode('client', false)).toBe(true);
    expect(startsInClientMode('expert', true)).toBe(false);
  });

  it('keeps the saved choice when the link says nothing usable, and starts in the full view otherwise', () => {
    for (const p of [null, undefined, '', 'banana']) {
      expect(modeFromLink(p)).toBeNull();
      expect(startsInClientMode(p, true)).toBe(true);
      expect(startsInClientMode(p, undefined)).toBe(false);
    }
  });

  it('is saved with the other view toggles, and a damaged value is dropped', () => {
    const store = new MemoryStore();
    expect(savePrefs(store, { view: { client: true } })).toBe(true);
    expect(loadPrefs(store).view).toEqual({ client: true });
    store.setItem(PREFS_KEY, JSON.stringify({ view: { client: 'yes', ghost: false } }));
    expect(loadPrefs(store).view).toEqual({ ghost: false });
    expect(sanitiseView({ client: false })).toEqual({ client: false });
  });

  it('names its button for what pressing it does, so the way out is always in words', () => {
    expect(presentButton(false).label).toBe('Present');
    expect(presentButton(true).label).toBe('Exit presentation');
    for (const on of [false, true]) expect(presentButton(on).title).toMatch(/\(P\)$/);
  });

  it('has a button in the header, outside everything the view hides', () => {
    expect(HTML).toMatch(/<header[\s\S]*id="btnPresent"[\s\S]*<\/header>/);
    expect(HTML).toMatch(/id="btnPresent"[^>]*aria-keyshortcuts="P"/);
    // the header itself is never hidden in the presentation view
    expect(CSS).not.toMatch(/\.app\.client \.header\b/);
    expect(CSS).not.toMatch(/\.app\.client[^{]*\.brand-actions[^{]*\{[^}]*display: none/);
  });

  it('puts away the rail and its telemetry, the log, the exports, the thresholds and the drawing controls', () => {
    const hidden = CSS.match(/((?:\.app\.client [^,{]+,\s*)+\.app\.client [^,{]+)\{\s*display: none;\s*\}/)?.[1] ?? '';
    for (const sel of ['.rail', '.log', '#btnDownload', '.iss-exports', '.iss-rules', '#btnMenu', '#btnOrbit', '.chip.select', '#btnCranePlan', '.tb-camera', '.tkey small']) {
      expect(hidden, sel).toContain(sel);
    }
    // the model takes the rail's column on a wide screen only (the narrow layout is one column already)
    expect(CSS).toMatch(/@media \(min-width: 1101px\) \{\s*\.app\.client \{ grid-template-columns: minmax\(0, 1fr\) clamp\(380px, 33vw, 540px\); \}\s*\.app\.client \.viewport \{ grid-column: 1; \}\s*\.app\.client \.panel \{ grid-column: 2; \}/);
  });

  it('names the toggles that stay in plain words, and keeps their pressed state', () => {
    const plain: Record<string, string> = { btnGhost: 'Show unbuilt', btnCrane: 'Show crane', btnFlags: 'Mark issues' };
    for (const [id, words] of Object.entries(plain)) {
      expect(HTML, id).toMatch(new RegExp(`id="${id}"[^>]*aria-pressed="(true|false)"><span class="for-expert">[^<]+</span><span class="for-client">${words}</span>`));
    }
    // material colours get a toggle of their own in the toolbar, shown in the presentation view
    expect(HTML).toMatch(/class="chip toggle for-client" id="btnMaterials"[^>]*aria-pressed="false">Material colours</);
    expect(MAIN).toMatch(/press\('btnMaterials', view\.colour\)/);
    // each view shows its own labels only
    expect(CSS).toMatch(/\.app:not\(\.client\) \.for-client, \.app\.client \.for-expert \{ display: none; \}/);
  });
});

// ── opening frame ───────────────────────────────────────────────────────────

describe('opening frame', () => {
  const D = 29.4;

  it('opens paused on the finished model with the large Play button', () => {
    expect(openingPlan({ linkTime: null, paused: false, autoplay: false, duration: D })).toEqual({ t: D, playing: false, hero: true });
    // ?paused=1 alone asks for what the opening already is
    expect(openingPlan({ linkTime: null, paused: true, autoplay: false, duration: D })).toEqual({ t: D, playing: false, hero: true });
  });

  it('respects a ?t= link: that moment, playing unless ?paused=1, and no Play button over it', () => {
    expect(openingPlan({ linkTime: 12, paused: false, autoplay: false, duration: D })).toEqual({ t: 12, playing: true, hero: false });
    expect(openingPlan({ linkTime: 12, paused: true, autoplay: false, duration: D })).toEqual({ t: 12, playing: false, hero: false });
    // a time past either end is held to the sequence
    expect(openingPlan({ linkTime: 90, paused: true, autoplay: false, duration: D }).t).toBe(D);
    expect(openingPlan({ linkTime: -3, paused: true, autoplay: false, duration: D }).t).toBe(0);
  });

  it('plays from the start for ?play=1, as a kiosk loop does', () => {
    expect(openingPlan({ linkTime: null, paused: false, autoplay: true, duration: D })).toEqual({ t: 0, playing: true, hero: false });
    expect(openingPlan({ linkTime: 4, paused: false, autoplay: true, duration: D }).t).toBe(4);
  });

  it('says what the Play button plays', () => {
    expect(heroLine(158, 29.4)).toBe('158 steps in 29 s, from the start');
    expect(heroLine(1, 0.2)).toBe('1 step in 1 s, from the start');
  });

  it('starts the build from the beginning when pressed, and goes once the sequence plays or moves', () => {
    expect(HTML).toMatch(/<button class="hero-play" id="heroPlay"[^>]*hidden>/);
    const play = MAIN.match(/function playFromStart\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(play).toMatch(/playback\.seek\(0\);\s*playback\.toggle\(true\);/);
    expect(MAIN).toMatch(/if \(hero && \(playback\.playing \|\| playback\.t < project\.duration\)\)/);
    expect(MAIN).toMatch(/bind\('heroPlay', playFromStart\)/);
  });
});

// ── first-run cards ─────────────────────────────────────────────────────────

describe('first-run cards', () => {
  it('show on a first visit and not once dismissed', () => {
    const store = new MemoryStore();
    expect(showIntro(store, null)).toBe(true);
    expect(markIntroSeen(store)).toBe(true);
    expect(store.getItem(INTRO_KEY)).toBe('1');
    expect(showIntro(store, null)).toBe(false);
  });

  it('follow ?intro=0 and ?intro=1 over what this browser remembers', () => {
    const store = new MemoryStore();
    expect(showIntro(store, '0')).toBe(false);
    markIntroSeen(store);
    expect(showIntro(store, '1')).toBe(true);
  });

  it('cope with storage that is missing or refuses access', () => {
    expect(showIntro(null, null)).toBe(true);
    expect(showIntro(blocked, null)).toBe(true);
    expect(markIntroSeen(null)).toBe(false);
    expect(markIntroSeen(blocked)).toBe(false);
  });

  it('say what this is, how to play it and how to bring your own model, in a few words each', () => {
    const cards = introCards('Duplex A');
    expect(cards.map((c) => c.title)).toEqual(['What this is', 'Play the build', 'Import your own IFC']);
    expect(cards[0].body).toMatch(/^Duplex A /);
    expect(cards[2].body).toMatch(/never uploaded/);
    for (const c of cards) expect(c.body.length, c.title).toBeLessThanOrEqual(100);
  });

  it('have a way out: a button, Esc, or any of their actions', () => {
    expect(HTML).toMatch(/<section class="intro card" id="intro" aria-labelledby="introTitle" hidden>/);
    expect(HTML).toMatch(/id="introClose"[^>]*>Got it</);
    expect(MAIN).toMatch(/else if \(introOpen\) dismissIntro\(\);/);
  });
});

// ── shortcut sheet ──────────────────────────────────────────────────────────

/** A focused element as the key router sees it. */
const el = (tagName: string, attrs: Record<string, string> = {}, type?: string): KeyTarget => ({
  tagName: tagName.toUpperCase(),
  type,
  getAttribute: (n) => attrs[n] ?? null,
});

describe('shortcut sheet', () => {
  it('lists every key the page answers, and no action the page lacks', () => {
    const inTable = new Set(Object.values(KEY_ACTIONS));
    expect(sheetActions()).toEqual(inTable);
  });

  it('holds the same keys as the handler did before it moved into the table', () => {
    const before: Record<string, ActionId> = {
      ' ': 'play', r: 'rebuild', a: 'rotate', c: 'colour', x: 'frame', f: 'speed', v: 'view', g: 'ghost', k: 'crane', l: 'cranePlan', s: 'section', i: 'import',
      ']': 'nextIssue', '[': 'prevIssue', arrowleft: 'stepBack', arrowright: 'stepOn', home: 'start',
    };
    for (const [k, a] of Object.entries(before)) expect(keyAction(k), JSON.stringify(k)).toBe(a);
    // and the two it adds
    expect(keyAction('p')).toBe('present');
    expect(keyAction('?')).toBe('help');
  });

  it('answers only its own keys, never an inherited name', () => {
    for (const k of ['constructor', 'tostring', '__proto__', 'hasownproperty', 'shift', 'enter', 'q']) expect(keyAction(k), k).toBeNull();
  });

  it('prints the letter of every letter shortcut', () => {
    const printed = new Set(SHORTCUT_GROUPS.flatMap((g) => g.rows.flatMap((r) => r.keys)));
    for (const k of Object.keys(KEY_ACTIONS)) if (/^[a-z]$/.test(k)) expect(printed.has(k.toUpperCase()), k).toBe(true);
    for (const k of ['Space', '?', ']', '[', 'Home', 'Esc', 'Shift', 'D', '1', '7']) expect(printed.has(k), k).toBe(true);
  });

  it('names the rail items the number keys open, as many as there are', () => {
    expect(RAIL_KEY_NAMES).toHaveLength(7);
    const row = SHORTCUT_GROUPS.flatMap((g) => g.rows).find((r) => rowKeys(r) === '1 – 7')!;
    for (const n of RAIL_KEY_NAMES) expect(row.text).toContain(n);
    for (const n of RAIL_KEY_NAMES) expect(MAIN).toContain(`label: '${n}'`);
  });

  it('writes each key in a <kbd> with a spoken name for the symbols, and escapes the text', () => {
    const html = shortcutSheetHtml([{ title: 'A & B', rows: [{ keys: ['←', '–', 'Esc'], text: '<b>' }] }]);
    expect(html).toContain('<h3>A &amp; B</h3>');
    expect(html).toContain('<kbd aria-label="Left arrow">←</kbd>');
    expect(html).toContain('<span class="to">–</span>');
    expect(html).toContain('<kbd aria-label="Escape">Esc</kbd>');
    expect(html).toContain('<dd>&lt;b&gt;</dd>');
  });

  it('opens from ? and the header button, and P and ? never fire while typing', () => {
    expect(HTML).toMatch(/id="btnHelp"[^>]*aria-label="Keyboard shortcuts"[^>]*aria-keyshortcuts="\?"/);
    expect(HTML).toMatch(/<dialog class="help card" id="helpSheet" aria-labelledby="helpTitle">/);
    expect(MAIN).toMatch(/bind\('btnHelp', openHelp\)/);
    for (const k of ['p', '?']) {
      expect(routeKey(el('input', {}, 'search'), k)).toBe('native');
      expect(routeKey(el('body'), k)).toBe('global');
    }
  });

  it('is written in sentence case', () => {
    for (const g of SHORTCUT_GROUPS) {
      expect(g.title[0], g.title).toBe(g.title[0].toUpperCase());
      expect(g.title.slice(1), g.title).toBe(g.title.slice(1).toLowerCase());
      for (const r of g.rows) expect(r.text[0], r.text).toBe(r.text[0].toUpperCase());
    }
  });
});
