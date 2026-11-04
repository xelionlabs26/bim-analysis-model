export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export const MATERIALS = [
  'stringline',
  'granite',
  'hinoki',
  'keyaki',
  'tile',
  'bronze',
  'gilt',
  'plaster',
] as const;
export type MaterialId = (typeof MATERIALS)[number];

export const MATERIAL_INFO: Record<MaterialId, { label: string; density: number; colour: string }> = {
  stringline: { label: 'string line · pegs', density: 600, colour: '#9d1125' },
  granite: { label: 'granite', density: 2700, colour: '#c9c4bd' },
  hinoki: { label: 'hinoki cypress', density: 410, colour: '#e3cfae' },
  keyaki: { label: 'keyaki', density: 690, colour: '#b88a5e' },
  tile: { label: 'fired clay tile', density: 1900, colour: '#6f6f73' },
  bronze: { label: 'cast bronze', density: 8800, colour: '#6e5a37' },
  gilt: { label: 'gilt cypress', density: 450, colour: '#d6ae52' },
  plaster: { label: 'lime plaster', density: 1600, colour: '#f4efe6' },
};

/** One rigid part: an oriented box. `size` is in the box's local axes. */
export interface Part {
  pos: Vec3;
  size: Vec3;
  quat: Quat;
  mat: MaterialId;
}

export type TierId = 'PLINTH' | 'TIER 1' | 'TIER 2' | 'TIER 3' | 'TIER 4' | 'TIER 5' | 'SPIRE';
export const TIERS: TierId[] = ['PLINTH', 'TIER 1', 'TIER 2', 'TIER 3', 'TIER 4', 'TIER 5', 'SPIRE'];

/** A step as authored by the generator (no timing yet). */
export interface StepDef {
  tier: TierId;
  member: string;
  spec: string;
  code: string;
  drop: number;
  parts: Part[];
}

export interface Level {
  code: string;
  y: number;
}

export interface StageDef {
  n: number;
  code: string;
  title: string;
  subtitle: string;
  start: number;
  end: number;
  sheet: string;
  /** false = presentation stage scheduled for a later milestone (M5). */
  available: boolean;
  tiers: TierId[];
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
  centroid: Vec3;
  top: number; // highest point of this step's parts
  halfExtent: number; // max |x| / |z|
}

export interface ScheduledPart extends Part {
  t0: number;
  dur: number;
  drop: number;
  stage: number;
  step: number;
}

export interface Project {
  id: string;
  name: string;
  subtitle: string;
  rev: string;
  revDate: string;
  height: number;
  levels: Level[];
  stages: StageDef[];
  steps: Step[];
  parts: ScheduledPart[];
  duration: number;
  totalMassKg: number;
}
