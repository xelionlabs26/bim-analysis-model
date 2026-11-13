import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nextTab, pressedBySpace, routeKey, takesTyping, type KeyTarget } from '../src/ui/keys';
import { applyBrand, brandName, DEFAULT_BRAND, wordmark } from '../src/ui/brand';
import { projectFacts } from '../src/ui/header';
import { placedAt, scrubberText, timecode, visibleLog } from '../src/ui/panels';
import { focusKey, keepFocus } from '../src/ui/focus';
import { toIfc } from '../src/checks/view';
import { buildProject } from '../src/data/project';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const CSS = read('../src/styles.css');
const HTML = read('../index.html');

/** A focused element as the key router sees it. */
const el = (tagName: string, attrs: Record<string, string> = {}, type?: string): KeyTarget => ({
  tagName: tagName.toUpperCase(),
  type,
  isContentEditable: attrs.contenteditable === 'true',
  getAttribute: (n) => attrs[n] ?? null,
});

// ── keyboard: Space and Enter belong to the focused control ─────────────────

describe('routeKey', () => {
  const body = el('body');
  const canvas = el('canvas');

  it('plays with Space from the page, the model and the scrubber', () => {
    expect(routeKey(body, ' ')).toBe('global');
    expect(routeKey(null, ' ')).toBe('global');
    expect(routeKey(canvas, ' ')).toBe('global');
    expect(routeKey(el('div', { role: 'slider', tabindex: '0' }), ' ')).toBe('global');
  });

  it('leaves Space and Enter to buttons, checkboxes, disclosures, tabs and links', () => {
    for (const t of [el('button'), el('summary'), el('input', {}, 'checkbox'), el('input', {}, 'radio'), el('button', { role: 'tab' }), el('a', { href: '#x' }), el('div', { role: 'button', tabindex: '0' })]) {
      expect(routeKey(t, ' ')).toBe('native');
      expect(routeKey(t, 'enter')).toBe('native');
    }
  });

  it('keeps the letter shortcuts on a focused button (only Space and Enter are its own)', () => {
    expect(routeKey(el('button'), 'g')).toBe('global');
    expect(routeKey(el('input', {}, 'checkbox'), 'x')).toBe('global');
    expect(routeKey(el('summary'), ']')).toBe('global');
  });

  it('gives every key to a field that is typed into or picks a value', () => {
    for (const t of [el('input', {}, 'text'), el('input', {}, 'number'), el('input', {}, 'search'), el('input', {}, 'range'), el('input'), el('select'), el('textarea'), el('div', { contenteditable: 'true' })]) {
      for (const k of [' ', 'enter', 'r', 'arrowleft', 'home', '1']) expect(routeKey(t, k)).toBe('native');
    }
  });

  it('lets Escape through from anywhere, a text field included', () => {
    expect(routeKey(el('input', {}, 'text'), 'escape')).toBe('global');
    expect(routeKey(el('button'), 'escape')).toBe('global');
  });

  it('moves along the tabs with the arrows, Home and End', () => {
    const tab = el('button', { role: 'tab' });
    for (const k of ['arrowleft', 'arrowright', 'home', 'end']) expect(routeKey(tab, k)).toBe('tabs');
    expect(routeKey(tab, 'arrowup')).toBe('global');
  });

  it('moves the sequence from the scrubber with the slider keys', () => {
    const slider = el('div', { role: 'slider', tabindex: '0' });
    for (const k of ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', 'pageup', 'pagedown']) expect(routeKey(slider, k)).toBe('slider');
    expect(routeKey(slider, 'r')).toBe('global');
  });

  it('leaves the arrows to a radio group', () => {
    expect(routeKey(el('input', {}, 'radio'), 'arrowdown')).toBe('native');
  });

  it('tells a link from an anchor without href', () => {
    expect(pressedBySpace(el('a', { href: '/' }))).toBe(true);
    expect(pressedBySpace(el('a'))).toBe(false);
    expect(takesTyping(el('input', {}, 'checkbox'))).toBe(false);
    expect(takesTyping(el('input', {}, 'email'))).toBe(true);
  });
});

describe('nextTab', () => {
  it('wraps round and jumps to either end', () => {
    expect(nextTab(0, 3, 'arrowright')).toBe(1);
    expect(nextTab(2, 3, 'arrowright')).toBe(0);
    expect(nextTab(0, 3, 'arrowleft')).toBe(2);
    expect(nextTab(1, 3, 'home')).toBe(0);
    expect(nextTab(1, 3, 'end')).toBe(2);
    expect(nextTab(1, 3, 'x')).toBe(1);
  });
});

// ── the wordmark comes from one place ───────────────────────────────────────

describe('brand', () => {
  it('uses the default unless ?brand= gives a usable name', () => {
    expect(brandName(null)).toBe(DEFAULT_BRAND);
    expect(brandName('')).toBe(DEFAULT_BRAND);
    expect(brandName('   ')).toBe(DEFAULT_BRAND);
    expect(brandName('  Northside   Build ')).toBe('Northside Build');
    expect(brandName('A name far too long for the header strip')).toBe(DEFAULT_BRAND);
  });

  it('keeps markup out of the name', () => {
    const n = brandName('<b>Acme</b> Build');
    expect(n).not.toMatch(/[<>/]/);
    expect(n).toContain('Acme');
  });

  it('sets the last word in the accent colour', () => {
    expect(wordmark('Arbor Build')).toEqual({ lead: 'ARBOR', accent: 'BUILD' });
    expect(wordmark('Northside')).toEqual({ lead: 'NORTHSIDE', accent: '' });
    expect(wordmark('Bau & Holz Werk')).toEqual({ lead: 'BAU & HOLZ', accent: 'WERK' });
  });

  it('writes the header and the page title', () => {
    const made: { tag: string; textContent: string }[] = [];
    const mark = {
      textContent: '',
      children: [] as unknown[],
      ownerDocument: { createElement: (tag: string) => (made.push({ tag, textContent: '' }), made[made.length - 1]) },
      append(x: unknown) {
        this.children.push(x);
      },
    };
    const doc = { title: '' };
    applyBrand('Acme Build', mark as unknown as HTMLElement, doc);
    expect(mark.textContent).toBe('ACME ');
    expect(made).toEqual([{ tag: 'em', textContent: 'BUILD' }]);
    expect(doc.title).toBe('Acme Build');
  });
});

// ── the status card shows project facts, not a clock ────────────────────────

describe('projectFacts', () => {
  const p = buildProject();

  it('names the sheet, the height and the floor area', () => {
    const f = projectFacts(p);
    expect(f.head).toBe('AR-32 · REV C');
    expect(f.main).toBe(`${p.height.toFixed(1)} m`);
    expect(f.sub).toMatch(/^20 890 m² GIA$/);
    expect(f.label).toContain('Arbor House');
    expect(f.label).toContain('32 storeys');
  });

  it('leaves out a placeholder revision and falls back to the part count without an area', () => {
    const f = projectFacts({ ...p, id: 'DU-04', rev: '—', gifa: 0, storeys: 1 });
    expect(f.head).toBe('DU-04');
    expect(f.sub).toMatch(/ parts$/);
    expect(f.label).toContain('1 storey ');
  });
});

// ── the build log hides frame-rate lines unless the overlay is on ───────────

describe('visibleLog', () => {
  const ev = (kind: string, t: number) => ({ kind, t });
  const events = [ev('ASM', 1), ev('PERF', 2), ev('ASM', 3), ev('PERF', 4), ev('CHK', 5)];

  it('drops PERF lines and keeps the last ones', () => {
    expect(visibleLog(events, false, 9).map((e) => e.kind)).toEqual(['ASM', 'ASM', 'CHK']);
    expect(visibleLog(events, false, 2).map((e) => e.t)).toEqual([3, 5]);
  });

  it('keeps them with the performance overlay on', () => {
    expect(visibleLog(events, true, 3).map((e) => e.t)).toEqual([3, 4, 5]);
  });
});

describe('scrubberText', () => {
  it('reads the step and the time', () => {
    expect(scrubberText(12.34, 29.4, 114, 158)).toBe('Step 114 of 158 · 12.3 s of 29.4 s');
  });
});

// ── colour and type: every text colour at 4.5:1, nothing functional under 11 px ──

/** The :root custom properties of styles.css. */
function tokens(css: string): Record<string, string> {
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)![1];
  return Object.fromEntries([...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const channel = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('colour tokens', () => {
  const T = tokens(CSS);

  it('are plain hex colours where text is concerned', () => {
    for (const k of ['ink', 'ink-2', 'muted', 'brand', 'green', 'warn', 'bad', 'paper', 'viewport', 'card', 'well', 'on-brand', 'brand-wash']) expect(T[k], k).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('read at 4.5:1 or more as text on every light surface', () => {
    for (const fg of ['ink', 'ink-2', 'muted', 'brand', 'green', 'warn', 'bad']) {
      for (const bg of ['paper', 'viewport', 'card', 'well']) expect(contrast(T[fg], T[bg]), `--${fg} on --${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('carry white text at 4.5:1 or more where they are a badge or a pressed button', () => {
    for (const bg of ['brand', 'bad', 'warn', 'green', 'muted', 'ink-2']) expect(contrast(T['on-brand'], T[bg]), `white on --${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('keep amber text legible on its hover wash', () => {
    expect(contrast(T.brand, T['brand-wash'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(T.bad, T['brand-wash'])).toBeGreaterThanOrEqual(4.5);
  });

  it('keep warning and pass text legible on the hover wash too (the import alert button, a hovered chip)', () => {
    for (const fg of ['warn', 'green', 'ink', 'ink-2', 'muted']) expect(contrast(T[fg], T['brand-wash']), `--${fg} on --brand-wash`).toBeGreaterThanOrEqual(4.5);
  });

  it('do not fade text with opacity in the off states that used to fall under 4.5:1', () => {
    expect(CSS).not.toMatch(/\.sev:not\(\.on\)\s*\{[^}]*opacity/);
    expect(CSS).not.toMatch(/\.g-row\.na\s*\{[^}]*opacity/);
    expect(CSS).not.toMatch(/\.log-lines li\.old\s*\{[^}]*opacity/);
    expect(CSS).not.toMatch(/\.reach-label\.pick\.idle\s*\{[^}]*opacity/);
  });
});

describe('type sizes', () => {
  it('set no text under 11 px', () => {
    const small: string[] = [];
    for (const m of CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const [, sel, body] = m;
      for (const d of body.matchAll(/font(-size)?:\s*([^;]+)/g)) {
        const px = d[2].match(/(\d+(?:\.\d+)?)px/);
        if (px && parseFloat(px[1]) < 11) small.push(`${sel.trim()} → ${px[0]}`);
      }
    }
    expect(small).toEqual([]);
  });
});

// ── the page's markup: knob, focus, states, telemetry, stamp ────────────────

describe('chrome markup', () => {
  it('styles the playhead by its id, so the issue markers keep their dot', () => {
    expect(CSS).not.toMatch(/\.scrub-track b\b/);
    expect(CSS).toMatch(/#scrubKnob\s*\{/);
    expect(CSS).toMatch(/\.iss-mark\s*\{[^}]*width: 10px/);
  });

  it('draws a focus ring round the render-style select', () => {
    expect(CSS).toMatch(/\.chip\.select:focus-within\s*\{[^}]*outline: 2px solid/);
  });

  it('marks the tabs, their panes and the scrubber for assistive technology', () => {
    for (const [tab, pane] of [['tabSeq', 'paneSeq'], ['tabMembers', 'paneMembers'], ['tabIssues', 'paneIssues']]) {
      expect(HTML).toMatch(new RegExp(`role="tab"[^>]*id="${tab}"[^>]*aria-selected="(true|false)"[^>]*aria-controls="${pane}"`));
      expect(HTML).toMatch(new RegExp(`id="${pane}" role="tabpanel" aria-labelledby="${tab}"`));
    }
    expect(HTML).toMatch(/id="scrubTrack" role="slider" tabindex="0" aria-label="Sequence time"/);
  });

  it('gives every toggle a pressed state', () => {
    for (const id of ['btnOrbit', 'btnGhost', 'btnCrane', 'btnCranePlan', 'btnFlags', 'btnRotate', 'btnColour', 'btnFrame', 'btnSection']) {
      expect(HTML, id).toMatch(new RegExp(`id="${id}"[^>]*aria-pressed="(true|false)"`));
    }
  });

  it('hides the telemetry, drops the clock and the dead stamp, and starts with the log collapsed', () => {
    expect(HTML).toMatch(/class="gpu card" id="gpuCard" hidden/);
    expect(HTML).not.toMatch(/clockTime|liveFps|class="stamp"/);
    expect(HTML).toMatch(/class="log collapsed"/);
    expect(HTML).toMatch(/id="btnLog"[^>]*aria-expanded="false" aria-controls="logLines"/);
  });

  it('labels the icon-only buttons and the search box', () => {
    for (const id of ['btnMenu', 'btnPrev', 'btnPlay', 'btnNext', 'btnDownload', 'btnPlay2', 'btnLog', 'stagePrev', 'stageNext', 'memberSearch']) {
      expect(HTML, id).toMatch(new RegExp(`id="${id}"[^>]*aria-label="[^"]+"`));
    }
  });
});

// ── the operation panel's readouts (R43, R45) ───────────────────────────────

describe('timecode', () => {
  it('writes the total with the same tenths as the time, and never 60 seconds', () => {
    expect(timecode(29.4)).toBe('00:29.4');
    expect(timecode(59.6)).toBe('00:59.6');
    expect(timecode(59.96)).toBe('01:00.0');
    expect(timecode(119.97)).toBe('02:00.0');
    expect(timecode(0)).toBe('00:00.0');
    expect(timecode(-0.01)).toBe('00:00.0');
  });

  it('is what the panel prints for both sides', () => {
    const src = read('../src/ui/panels.ts');
    expect(src).toMatch(/\$\('timecode'\)\.innerHTML = `\$\{timecode\(s\.t\)\} \/<br>\$\{timecode\(D\)\}`/);
  });
});

describe('placedAt', () => {
  it('reads in the IFC world frame the exports use: Z up, the file origin', () => {
    // app axes: x east, y up, z south; recentred by the offset
    const off: [number, number, number] = [10, -2, 5];
    const c: [number, number, number] = [12.04, 7.5, -3.26];
    expect(placedAt(c, off)).toBe(toIfc(c, off).map((v) => v.toFixed(1)).join(' · '));
    expect(placedAt(c, off)).toBe('2.0 · 8.3 · 9.5');
    // a generated model has no offset: Y and Z swap, Z up
    expect(placedAt([1, 30, 4])).toBe('1.0 · -4.0 · 30.0');
  });

  it('prints 0.0, never -0.0', () => {
    expect(placedAt([-0.01, 0, 0.02])).toBe('0.0 · 0.0 · 0.0');
  });
});

// ── the focus through a rebuild of a drawer (R22, R59) ──────────────────────

describe('keepFocus', () => {
  /** A small tree of elements with attributes, enough for querySelector('[k="v"]'). */
  class Node {
    kids: Node[] = [];
    constructor(public attrs: Record<string, string> = {}) {}
    getAttribute(k: string) {
      return this.attrs[k] ?? null;
    }
    contains(x: unknown): boolean {
      return x === this || this.kids.some((k) => k.contains(x));
    }
    querySelector(sel: string): Node | null {
      const m = /^\[([\w-]+)="(.*)"\]$/.exec(sel)!;
      for (const k of this.kids) {
        if (k.attrs[m[1]] === m[2].replace(/\\(.)/g, '$1')) return k;
        const deep = k.querySelector(sel);
        if (deep) return deep;
      }
      return null;
    }
    focus() {
      page.activeElement = this;
    }
  }
  const page = { activeElement: null as Node | null };

  it('names a control by its id or its data attribute, and only inside the drawer', () => {
    const drawer = new Node();
    const btn = new Node({ 'data-r': '1.5' });
    drawer.kids.push(new Node({ id: 'btnResetPrefs' }), btn);
    expect(focusKey(btn as unknown as Element, drawer as unknown as Element)).toBe('[data-r="1.5"]');
    expect(focusKey(drawer.kids[0] as unknown as Element, drawer as unknown as Element)).toBe('[id="btnResetPrefs"]');
    expect(focusKey(new Node({ id: 'x' }) as unknown as Element, drawer as unknown as Element)).toBeNull();
    expect(focusKey(null, drawer as unknown as Element)).toBeNull();
    expect(focusKey(new Node() as unknown as Element, drawer as unknown as Element)).toBeNull();
  });

  it('gives the focus back to the same control after the drawer is rebuilt', () => {
    const g = globalThis as unknown as { document?: unknown };
    const was = g.document;
    g.document = page;
    try {
      const drawer = new Node();
      const build = (pressed: string) => {
        drawer.kids = ['ink', 'ink+paint', 'paint'].map((v) => new Node({ 'data-v': v, 'aria-pressed': String(v === pressed) }));
      };
      build('ink');
      drawer.kids[2].focus();
      keepFocus(drawer as unknown as HTMLElement, () => build('paint'));
      expect(page.activeElement).toBe(drawer.kids[2]);
      expect(page.activeElement!.attrs['aria-pressed']).toBe('true');
      // the focus outside the drawer is left alone
      const outside = new Node({ id: 'tabIssues' });
      outside.focus();
      keepFocus(drawer as unknown as HTMLElement, () => build('ink'));
      expect(page.activeElement).toBe(outside);
    } finally {
      g.document = was;
    }
  });

  it('is how the drawers and the rules panel redraw', () => {
    const main = read('../src/main.ts');
    expect(main).toMatch(/function renderDrawer\(\) \{\s*keepFocus\(drawer, drawDrawer\);/);
    expect(main).toMatch(/keepFocus\(body, \(\) => drawRulesPanel\(body\)\)/);
  });
});
