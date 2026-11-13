/**
 * Keeping the keyboard focus through a rebuild. A drawer or panel that redraws
 * itself with innerHTML drops the focused control, and the focus falls to
 * <body>: a second Enter then does nothing and Space starts playback. The
 * control is found again in the new markup by what identifies it.
 */

/** The attributes that name a control within its drawer, in the order they are tried. */
const KEYS = ['id', 'data-id', 'data-row', 'data-v', 'data-c', 'data-r', 'data-plane', 'data-bit', 'data-sev', 'data-family'] as const;

/** A selector that finds `el` again after `within` is rebuilt, or null when the focus is elsewhere or `el` has no name. */
export function focusKey(el: Element | null, within: Element): string | null {
  if (!el || el === within || !within.contains(el)) return null;
  for (const k of KEYS) {
    const v = el.getAttribute(k);
    if (v === null || v === '') continue;
    const q = v.replace(/["\\]/g, '\\$&');
    return k === 'id' ? `[id="${q}"]` : `[${k}="${q}"]`;
  }
  return null;
}

/** Run `rebuild` (which replaces what `within` holds) and give the focus back to the same control in the new markup. */
export function keepFocus(within: HTMLElement, rebuild: () => void): void {
  const key = focusKey(document.activeElement, within);
  rebuild();
  if (!key) return;
  const el = within.querySelector<HTMLElement>(key);
  if (el && el !== document.activeElement) el.focus({ preventScroll: true });
}
