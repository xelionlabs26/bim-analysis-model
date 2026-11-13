/**
 * Settings that outlive a reload: the check thresholds (Issues ▸ Rules and
 * thresholds) and the view toggles. They live in this browser's localStorage
 * under one key. Storage can be missing, full or blocked (private windows,
 * sandboxed frames), so every access is guarded and the app runs on its
 * defaults without it. Whatever is read back is checked field by field.
 */
import { DEFAULT_SETTINGS, type CheckSettings } from '../checks/types';
import type { RenderStyle } from '../scene/viewer';

// ── thresholds ───────────────────────────────────────────────────────────────

type ScalarKey = 'clashTol' | 'headroom' | 'fallHeight' | 'guardHeight' | 'liftAidKg' | 'craneWarn' | 'riggingKg';

/** One threshold field as the user sees it: its units, step and the smallest value that means something. */
export interface ThresholdField {
  id: string;
  label: string;
  /** The setting it edits; the truck fields edit one side of `truck`. */
  key: ScalarKey | 'truck';
  index?: number;
  /** Field units per setting unit (mm per m, % per fraction). */
  scale?: number;
  step: number;
  /** Smallest accepted value, in field units. Zero stays valid where it means "none" (tolerance, rigging, lifting aid). */
  min: number;
}

export const THRESHOLD_FIELDS: ThresholdField[] = [
  { id: 'setClash', label: 'Clash tolerance (mm)', key: 'clashTol', scale: 1000, step: 1, min: 0 },
  { id: 'setHead', label: 'Stair headroom (m)', key: 'headroom', step: 0.01, min: 0.5 },
  { id: 'setFall', label: 'Fall needing protection (m)', key: 'fallHeight', step: 0.1, min: 0.1 },
  { id: 'setGuard', label: 'Guard height (mm)', key: 'guardHeight', scale: 1000, step: 10, min: 100 },
  { id: 'setAid', label: 'Lifting aid above (kg)', key: 'liftAidKg', step: 5, min: 0 },
  { id: 'setCrane', label: 'Lift plan review above (%)', key: 'craneWarn', scale: 100, step: 1, min: 1 },
  { id: 'setRig', label: 'Rigging allowance (kg)', key: 'riggingKg', step: 10, min: 0 },
  { id: 'setTruckL', label: 'Standard load length (m)', key: 'truck', index: 0, step: 0.1, min: 1 },
  { id: 'setTruckW', label: 'Standard load width (m)', key: 'truck', index: 1, step: 0.05, min: 0.5 },
  { id: 'setTruckH', label: 'Standard load height (m)', key: 'truck', index: 2, step: 0.05, min: 0.5 },
];

const settingOf = (f: ThresholdField, s: CheckSettings) => (f.key === 'truck' ? s.truck[f.index ?? 0] : s[f.key]);

/** The value a field shows for these settings, in its own units (millimetres and percentages as whole numbers). */
export function thresholdValue(f: ThresholdField, s: CheckSettings): number {
  const v = settingOf(f, s) * (f.scale ?? 1);
  return f.scale ? Math.round(v) : v;
}

/** These settings with one field's setting replaced (`v` in setting units: metres, fractions). */
function withSetting(s: CheckSettings, f: ThresholdField, v: number): CheckSettings {
  if (f.key !== 'truck') return { ...s, [f.key]: v };
  const truck = [...s.truck] as CheckSettings['truck'];
  truck[f.index ?? 0] = v;
  return { ...s, truck };
}

const accepts = (f: ThresholdField, v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= f.min;

/**
 * Settings from the fields' values (an input's valueAsNumber: NaN when it is
 * empty or not a number). A field that is empty, not a number or below its
 * minimum keeps the current setting and is listed in `invalid`, so the caller
 * can mark it instead of running the checks with a threshold of 0.
 */
export function readThresholds(values: Record<string, number>, current: CheckSettings): { settings: CheckSettings; invalid: ThresholdField[] } {
  let settings: CheckSettings = { ...current, truck: [...current.truck] };
  const invalid: ThresholdField[] = [];
  for (const f of THRESHOLD_FIELDS) {
    const v = values[f.id];
    if (accepts(f, v)) settings = withSetting(settings, f, v / (f.scale ?? 1));
    else invalid.push(f);
  }
  return { settings, invalid };
}

/** Stored thresholds, checked field by field; anything missing or out of range takes its default. */
export function sanitiseSettings(raw: unknown): CheckSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record<keyof CheckSettings, unknown>>;
  const truckIn = Array.isArray(r.truck) ? r.truck : [];
  let s: CheckSettings = { ...DEFAULT_SETTINGS, truck: [...DEFAULT_SETTINGS.truck] };
  for (const f of THRESHOLD_FIELDS) {
    const stored = f.key === 'truck' ? truckIn[f.index ?? 0] : r[f.key];
    if (typeof stored === 'number' && accepts(f, stored * (f.scale ?? 1))) s = withSetting(s, f, stored);
  }
  if (typeof r.personKg === 'number' && Number.isFinite(r.personKg) && r.personKg > 0) s.personKg = r.personKg;
  return s;
}

export function sameSettings(a: CheckSettings, b: CheckSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── view toggles ─────────────────────────────────────────────────────────────

export interface ViewPrefs {
  style: RenderStyle;
  colour: boolean;
  ghost: boolean;
  crane: boolean;
  autoRotate: boolean;
  flags: boolean;
  resolution: number;
}

const STYLES: RenderStyle[] = ['ink', 'ink+paint', 'paint'];
export const RESOLUTIONS = [1, 1.5, 2];

/** Stored view toggles, keeping only the ones that are well formed. */
export function sanitiseView(raw: unknown): Partial<ViewPrefs> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<ViewPrefs> = {};
  if (STYLES.includes(r.style as RenderStyle)) out.style = r.style as RenderStyle;
  for (const k of ['colour', 'ghost', 'crane', 'autoRotate', 'flags'] as const) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  if (RESOLUTIONS.includes(r.resolution as number)) out.resolution = r.resolution as number;
  return out;
}

// ── storage ──────────────────────────────────────────────────────────────────

export const PREFS_KEY = 'arbor-build.settings.v1';

export type PrefsStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface StoredPrefs {
  checks?: CheckSettings;
  view?: Partial<ViewPrefs>;
}

/** This browser's localStorage when it can be written to, else null (blocked, sandboxed or full). */
export function browserStore(): PrefsStore | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    if (!s) return null;
    const probe = `${PREFS_KEY}.probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function loadPrefs(store: PrefsStore | null): StoredPrefs {
  if (!store) return {};
  try {
    const raw = JSON.parse(store.getItem(PREFS_KEY) ?? 'null') as { checks?: unknown; view?: unknown } | null;
    if (!raw || typeof raw !== 'object') return {};
    const out: StoredPrefs = {};
    const checks = sanitiseSettings(raw.checks);
    if (checks) out.checks = checks;
    const view = sanitiseView(raw.view);
    if (Object.keys(view).length) out.view = view;
    return out;
  } catch {
    return {};
  }
}

/** Write the settings; false when storage refused them. */
export function savePrefs(store: PrefsStore | null, prefs: StoredPrefs): boolean {
  if (!store) return false;
  try {
    store.setItem(PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

export function clearPrefs(store: PrefsStore | null): boolean {
  if (!store) return false;
  try {
    store.removeItem(PREFS_KEY);
    return true;
  } catch {
    return false;
  }
}
