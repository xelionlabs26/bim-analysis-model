/**
 * Saved settings: threshold fields that are empty or out of range, stored
 * values that are damaged, and storage that is missing or refuses access.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type CheckSettings } from '../src/checks/types';
import { clearPrefs, loadPrefs, PREFS_KEY, readThresholds, sanitiseSettings, sanitiseView, savePrefs, THRESHOLD_FIELDS, thresholdValue, type PrefsStore } from '../src/ui/prefs';

const defaults = (): CheckSettings => ({ ...DEFAULT_SETTINGS, truck: [...DEFAULT_SETTINGS.truck] });
/** The fields as the panel shows them for these settings. */
const shown = (s: CheckSettings) => Object.fromEntries(THRESHOLD_FIELDS.map((f) => [f.id, thresholdValue(f, s)]));

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
/** Storage that throws on every access, as a blocked or sandboxed page's does. */
const blocked: PrefsStore = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
  removeItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
};

describe('threshold fields', () => {
  it('read back what they show', () => {
    const s = defaults();
    const { settings, invalid } = readThresholds(shown(s), s);
    expect(invalid).toEqual([]);
    expect(settings).toEqual(s);
  });

  it('convert millimetres and percentages to the settings units', () => {
    const v = { ...shown(defaults()), setClash: 25, setGuard: 1100, setCrane: 70, setRig: 150, setTruckL: 16.5 };
    const { settings } = readThresholds(v, defaults());
    expect(settings.clashTol).toBeCloseTo(0.025, 9);
    expect(settings.guardHeight).toBeCloseTo(1.1, 9);
    expect(settings.craneWarn).toBeCloseTo(0.7, 9);
    expect(settings.riggingKg).toBe(150);
    expect(settings.truck).toEqual([16.5, DEFAULT_SETTINGS.truck[1], DEFAULT_SETTINGS.truck[2]]);
  });

  it('do not turn a cleared field into 0: it is reported and the setting is kept', () => {
    const s = defaults();
    // an empty or unparsable number input reports NaN through valueAsNumber
    const { settings, invalid } = readThresholds({ ...shown(s), setHead: NaN, setCrane: NaN }, s);
    expect(invalid.map((f) => f.id)).toEqual(['setHead', 'setCrane']);
    expect(settings.headroom).toBe(DEFAULT_SETTINGS.headroom);
    expect(settings.craneWarn).toBe(DEFAULT_SETTINGS.craneWarn);
  });

  it('refuse values where 0 means nothing, and keep 0 where it means none', () => {
    const s = defaults();
    const { invalid } = readThresholds({ ...shown(s), setHead: 0, setGuard: 0, setTruckW: 0, setFall: -1 }, s);
    expect(invalid.map((f) => f.id).sort()).toEqual(['setFall', 'setGuard', 'setHead', 'setTruckW']);
    const ok = readThresholds({ ...shown(s), setClash: 0, setRig: 0, setAid: 0 }, s);
    expect(ok.invalid).toEqual([]);
    expect(ok.settings.clashTol).toBe(0);
    expect(ok.settings.riggingKg).toBe(0);
  });

  it('give every field a minimum the input also carries', () => {
    for (const f of THRESHOLD_FIELDS) expect(thresholdValue(f, defaults())).toBeGreaterThanOrEqual(f.min);
  });
});

describe('stored settings', () => {
  it('round-trip the thresholds and view toggles', () => {
    const store = new MemoryStore();
    const checks = { ...defaults(), headroom: 2.1, craneWarn: 0.8, riggingKg: 120 };
    expect(savePrefs(store, { checks, view: { style: 'ink', colour: true, ghost: false, crane: false, autoRotate: false, flags: false, resolution: 2 } })).toBe(true);
    const back = loadPrefs(store);
    expect(back.checks).toEqual(checks);
    expect(back.view).toEqual({ style: 'ink', colour: true, ghost: false, crane: false, autoRotate: false, flags: false, resolution: 2 });
    expect(clearPrefs(store)).toBe(true);
    expect(loadPrefs(store)).toEqual({});
  });

  it('replace damaged or out-of-range values with defaults, field by field', () => {
    const s = sanitiseSettings({ headroom: 0, craneWarn: 'high', riggingKg: 200, guardHeight: 1.0, truck: [20, null, -1], personKg: -5 })!;
    expect(s.headroom).toBe(DEFAULT_SETTINGS.headroom);
    expect(s.craneWarn).toBe(DEFAULT_SETTINGS.craneWarn);
    expect(s.riggingKg).toBe(200);
    expect(s.guardHeight).toBe(1.0);
    expect(s.truck).toEqual([20, DEFAULT_SETTINGS.truck[1], DEFAULT_SETTINGS.truck[2]]);
    expect(s.personKg).toBe(DEFAULT_SETTINGS.personKg);
    expect(sanitiseSettings('nonsense')).toBeNull();
    expect(sanitiseView({ style: 'neon', colour: 'yes', ghost: false, resolution: 3 })).toEqual({ ghost: false });
  });

  it('ignore text that is not JSON', () => {
    const store = new MemoryStore();
    store.setItem(PREFS_KEY, '{not json');
    expect(loadPrefs(store)).toEqual({});
  });

  it('work without storage, and when storage throws', () => {
    expect(loadPrefs(null)).toEqual({});
    expect(savePrefs(null, { checks: defaults() })).toBe(false);
    expect(loadPrefs(blocked)).toEqual({});
    expect(savePrefs(blocked, { checks: defaults() })).toBe(false);
    expect(clearPrefs(blocked)).toBe(false);
  });
});
