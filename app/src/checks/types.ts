import type { Vec3 } from '../data/types';

/**
 * critical — the sequence cannot be built as planned (support, reach, path).
 * major — needs action before that step: temporary works, a design clash.
 * minor — a coordination detail or a model fix.
 * note — for the record (model data, registers).
 */
export type Severity = 'critical' | 'major' | 'minor' | 'note';

export type RuleId =
  | 'ORDER-SUPPORT'
  | 'TEMP-PROPS'
  | 'TEMP-EDGE'
  | 'REACH-CRANE'
  | 'REACH-PATH'
  | 'CLASH-HARD'
  | 'CLASH-TEMP'
  | 'ACCESS-HEADROOM'
  | 'ACCESS-HANDLING'
  | 'ACCESS-TRANSPORT'
  | 'MODEL-DATA';

export interface RuleInfo {
  id: RuleId;
  code: string; // issue id prefix
  family: 'ORDER' | 'TEMP' | 'REACH' | 'CLASH' | 'ACCESS' | 'MODEL';
  title: string;
  /** The rule in one sentence, with its thresholds. */
  rule: (s: CheckSettings) => string;
}

export interface CheckSettings {
  /** Hard clash: penetration deeper than this, m. */
  clashTol: number;
  /** Clear headroom above stair nosings, m (UK Approved Document K: 2.0 m; IBC: 2.03 m). */
  headroom: number;
  /** An open edge needs protection where the fall is at least this, m. */
  fallHeight: number;
  /** Height a guard must reach above the walking surface, m. */
  guardHeight: number;
  /** Heaviest piece one person handles, kg. */
  personKg: number;
  /** Pieces heavier than this need a lifting aid, kg. */
  liftAidKg: number;
  /** Crane utilisation that needs a lift plan review. */
  craneWarn: number;
  /** Hook block and slings added to every crane pick, kg. */
  riggingKg: number;
  /** Standard road load: length × width × height, m. */
  truck: [number, number, number];
}

export const DEFAULT_SETTINGS: CheckSettings = {
  clashTol: 0.01,
  headroom: 2.0,
  fallHeight: 2.0,
  guardHeight: 0.95,
  personKg: 25,
  liftAidKg: 50,
  craneWarn: 0.85,
  riggingKg: 0,
  truck: [13.6, 2.55, 3.0],
};

export interface Issue {
  /** e.g. "CLH-03" */
  id: string;
  rule: RuleId;
  severity: Severity;
  title: string;
  /** What was measured, against which limit. */
  detail: string;
  /** Suggested fix. */
  action: string;
  /** Parts at fault (highlighted red). */
  primary: number[];
  /** Parts they conflict with or wait for (highlighted blue). */
  secondary: number[];
  /** Step at which the issue arises; the viewer shows the model as built then. */
  step: number;
  /** Where to put the pin. */
  at: Vec3;
  /** Region to frame. */
  box: [Vec3, Vec3];
  /** Lines to draw: open edges, clearances, lift paths. */
  lines: [Vec3, Vec3][];
  value?: number;
  limit?: number;
  unit?: string;
}

export interface RuleResult {
  id: RuleId;
  /** How many things the rule evaluated (parts, pairs, edges, picks). */
  checked: number;
  /** Issues raised. */
  flagged: number;
  /** False when the rule has nothing to act on in this project; it is then unverified, not passed. */
  applicable: boolean;
  note: string;
}

export interface CheckReport {
  issues: Issue[];
  rules: RuleResult[];
  settings: CheckSettings;
  ms: number;
}

export const RULES: RuleInfo[] = [
  { id: 'ORDER-SUPPORT', code: 'ORD', family: 'ORDER', title: 'Support before load', rule: () => 'Everything that bears on another element is placed after it (or in the same step).' },
  { id: 'TEMP-PROPS', code: 'PRP', family: 'TEMP', title: 'Propping', rule: () => 'A beam or slab placed before both ends are supported needs props until the second support is in.' },
  { id: 'TEMP-EDGE', code: 'EDG', family: 'TEMP', title: 'Edge protection', rule: (s) => `Open floor and roof edges with a fall of ${s.fallHeight.toFixed(1)} m or more are protected until a wall, glazing or guard at least ${(s.guardHeight * 1000).toFixed(0)} mm high closes them.` },
  { id: 'REACH-CRANE', code: 'RCH', family: 'REACH', title: 'Crane reach and capacity', rule: (s) => `Every crane pick is within the jib and under the load chart at its radius${s.riggingKg ? `, with ${s.riggingKg} kg rigging` : ''}; above ${Math.round(s.craneWarn * 100)} % it needs a lift plan review.` },
  { id: 'REACH-PATH', code: 'PTH', family: 'REACH', title: 'Lift path', rule: () => 'A crane pick is lowered from above: nothing already built may sit over it.' },
  { id: 'CLASH-HARD', code: 'CLH', family: 'CLASH', title: 'Hard clashes', rule: (s) => `Elements may not overlap by more than ${(s.clashTol * 1000).toFixed(0)} mm. Finishes fitted around other elements, hosted doors and windows, and parts of one assembly are not clashes.` },
  { id: 'CLASH-TEMP', code: 'TMP', family: 'CLASH', title: 'Crane clearance', rule: () => 'The crane mast and base keep at least 1 m clear of the permanent works.' },
  { id: 'ACCESS-HEADROOM', code: 'HDR', family: 'ACCESS', title: 'Stair headroom', rule: (s) => `Clear headroom above every stair nosing is at least ${s.headroom.toFixed(2)} m.` },
  { id: 'ACCESS-HANDLING', code: 'HND', family: 'ACCESS', title: 'Manual handling', rule: (s) => `Pieces set by hand weigh at most ${s.liftAidKg} kg (a two-person lift); heavier ones need a lifting aid.` },
  { id: 'ACCESS-TRANSPORT', code: 'TRN', family: 'ACCESS', title: 'Road transport', rule: (s) => `Prefabricated pieces fit a standard load of ${s.truck[0]} × ${s.truck[1]} × ${s.truck[2]} m; bigger ones travel as abnormal loads.` },
  { id: 'MODEL-DATA', code: 'MDL', family: 'MODEL', title: 'Model data', rule: () => 'Gaps in the model that limit these checks go back to the design team.' },
];

export const RULE_BY_ID = Object.fromEntries(RULES.map((r) => [r.id, r])) as Record<RuleId, RuleInfo>;

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, major: 1, minor: 2, note: 3 };
