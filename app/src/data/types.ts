export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export const MATERIALS = [
  'stringline',
  'concrete',
  'glulam',
  'clt',
  'glass',
  'aluminium',
  'terracotta',
  'steel',
  'pod',
  'soil',
  'planting',
  'pv',
  'context',
] as const;
export type MaterialId = (typeof MATERIALS)[number];

/**
 * `density` is an *effective* density for the box we model: thin or hollow
 * elements (glazing units, baguette fins, pods) are drawn as solid boxes, so
 * their density is scaled to give a realistic element mass.
 * `carbon` is an indicative A1–A3 factor in kgCO2e per kg from generic
 * published averages — order-of-magnitude only, not project EPDs.
 * `biogenic` marks timber whose stored carbon is reported separately.
 * `bulk` materials (soil) arrive in 1 t bags or are blown in, so they are not
 * checked as single crane picks.
 */
export const MATERIAL_INFO: Record<MaterialId, { label: string; density: number; carbon: number; colour: string; biogenic?: boolean; bulk?: boolean }> = {
  stringline: { label: 'setting-out line · pegs', density: 600, carbon: 0, colour: '#c2611a' },
  concrete: { label: 'reinforced concrete C40/50', density: 2450, carbon: 0.16, colour: '#bdbdb6' },
  glulam: { label: 'glulam GL28h · spruce', density: 470, carbon: 0.4, colour: '#d8ae74', biogenic: true },
  clt: { label: 'CLT 5-ply · spruce', density: 470, carbon: 0.35, colour: '#e6c690', biogenic: true },
  glass: { label: 'triple-glazed unit', density: 560, carbon: 1.44, colour: '#9fbcc6' },
  aluminium: { label: 'anodised aluminium · bronze', density: 600, carbon: 8.0, colour: '#8a7058' },
  terracotta: { label: 'terracotta baguette', density: 800, carbon: 0.48, colour: '#c0704a' },
  steel: { label: 'galvanised steel', density: 1500, carbon: 1.55, colour: '#7d8288' },
  pod: { label: 'prefab bathroom pod', density: 250, carbon: 1.2, colour: '#eceee9' },
  soil: { label: 'lightweight planter soil', density: 1100, carbon: 0.02, colour: '#7b6a55', bulk: true },
  planting: { label: 'trees · shrubs', density: 60, carbon: 0, colour: '#6f9a5c' },
  pv: { label: 'PV modules · glass-glass', density: 375, carbon: 16, colour: '#33475e' },
  context: { label: 'neighbouring buildings', density: 0, carbon: 0, colour: '#dcdcd6' },
};

/** Biogenic carbon held in timber, kgCO2e per kg (≈ 50 % carbon content, ~12 % moisture). */
export const TIMBER_BIOGENIC = 1.6;

/** One rigid part: an oriented box. `size` is in the box's local axes. */
export interface Part {
  pos: Vec3;
  size: Vec3;
  quat: Quat;
  mat: MaterialId;
}

export type ZoneId = 'SITE' | 'PODIUM' | 'LOWER' | 'MIDDLE' | 'UPPER' | 'CROWN';
export const ZONES: ZoneId[] = ['SITE', 'PODIUM', 'LOWER', 'MIDDLE', 'UPPER', 'CROWN'];

/** How a step's parts arrive: lowered by the tower crane, cast in place, or set by hand. */
export type Method = 'crane' | 'cast' | 'manual';
/** How a part animates in: lowered from above, poured upward, or bored downward. */
export type Motion = 'lower' | 'pour' | 'bore';

/** A step as authored by the generator (no timing yet). */
export interface StepDef {
  zone: ZoneId;
  member: string;
  spec: string;
  code: string;
  method: Method;
  motion: Motion;
  drop: number;
  parts: Part[];
  /** A step that also defines a floor's structural level (for order checks). */
  level?: number;
  kind?: 'core' | 'frame' | 'slab' | 'pods' | 'facade' | 'other';
  /** Log text for a step with no parts (e.g. erecting the crane). */
  log?: string;
}

export interface Level {
  code: string;
  y: number;
}

export type StageKind = 'assembly' | 'material' | 'section';

export interface StageDef {
  n: number;
  kind: StageKind;
  code: string;
  tick: string;
  title: string;
  subtitle: string;
  start: number;
  end: number;
  sheet: string;
  /** false = presentation stage scheduled for a later milestone (M5). */
  available: boolean;
  zones: ZoneId[];
}

export interface LiftCheck {
  radius: number; // m, horizontal distance from the crane mast
  pieceKg: number; // the critical piece in this step
  capacityKg: number; // crane capacity at that radius
  util: number; // pieceKg / capacityKg of the critical piece
}

/** A step after scheduling. */
export interface Step extends Omit<StepDef, 'parts'> {
  index: number; // 0-based
  id: string; // "001"
  stage: number; // 1-based stage number
  t0: number; // first part starts
  t1: number; // last part lands
  partStart: number; // index into project.parts
  partCount: number;
  material: string;
  massKg: number;
  carbonKg: number; // indicative A1–A3
  biogenicKg: number; // carbon stored in timber (positive number)
  centroid: Vec3;
  top: number; // highest point of this step's parts
  halfExtent: number; // max |x| / |z|
  lift: LiftCheck | null; // null unless method === 'crane'
}

export interface ScheduledPart extends Part {
  t0: number;
  dur: number;
  drop: number;
  motion: Motion;
  stage: number;
  step: number;
}

export interface Crane {
  id: string;
  base: Vec3; // mast centre at ground
  jib: number; // jib length, m
  counterJib: number;
  /** Indicative load chart: capacity in kg at radius r (m). */
  capacityAt: (r: number) => number;
  maxKg: number;
  tipKg: number;
}

export interface Project {
  id: string;
  name: string;
  subtitle: string;
  rev: string;
  revDate: string;
  storeys: number;
  gifa: number; // gross internal floor area, m², for carbon intensity
  height: number;
  levels: Level[];
  stages: StageDef[];
  steps: Step[];
  parts: ScheduledPart[];
  context: Part[];
  crane: Crane;
  duration: number;
  totalMassKg: number;
  totalCarbonKg: number;
  totalBiogenicKg: number;
}
