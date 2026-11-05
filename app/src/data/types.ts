export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export const MATERIALS = [
  'stringline',
  'concrete',
  'glulam',
  'clt',
  'timber',
  'glass',
  'aluminium',
  'terracotta',
  'masonry',
  'steel',
  'gypsum',
  'insulation',
  'membrane',
  'pod',
  'soil',
  'planting',
  'pv',
  'generic',
  'context',
] as const;
export type MaterialId = (typeof MATERIALS)[number];

/**
 * `density` is an *effective* density for the generated tower's boxes: thin or
 * hollow elements (glazing units, baguette fins, pods) are drawn as solid boxes,
 * so their density is scaled to give a realistic element mass. Imported models
 * have real solid geometry and use REAL_DENSITY instead.
 * `carbon` is an indicative A1–A3 factor in kgCO2e per kg from generic
 * published averages — order-of-magnitude only, not project EPDs.
 * `biogenic` marks timber whose stored carbon is reported separately.
 * `bulk` materials (soil) arrive in bags or are blown in, so they are not
 * checked as single crane picks.
 */
export const MATERIAL_INFO: Record<MaterialId, { label: string; density: number; carbon: number; colour: string; biogenic?: boolean; bulk?: boolean }> = {
  stringline: { label: 'setting-out line · pegs', density: 600, carbon: 0, colour: '#c2611a' },
  concrete: { label: 'reinforced concrete C40/50', density: 2450, carbon: 0.16, colour: '#bdbdb6' },
  glulam: { label: 'glulam GL28h · spruce', density: 470, carbon: 0.4, colour: '#d8ae74', biogenic: true },
  clt: { label: 'CLT 5-ply · spruce', density: 470, carbon: 0.35, colour: '#e6c690', biogenic: true },
  timber: { label: 'softwood timber', density: 480, carbon: 0.3, colour: '#d9b789', biogenic: true },
  glass: { label: 'triple-glazed unit', density: 560, carbon: 1.44, colour: '#9fbcc6' },
  aluminium: { label: 'anodised aluminium · bronze', density: 600, carbon: 8.0, colour: '#8a7058' },
  terracotta: { label: 'terracotta baguette', density: 800, carbon: 0.48, colour: '#c0704a' },
  masonry: { label: 'brick · block masonry', density: 1850, carbon: 0.22, colour: '#b9785d' },
  steel: { label: 'galvanised steel', density: 1500, carbon: 1.55, colour: '#7d8288' },
  gypsum: { label: 'plasterboard', density: 850, carbon: 0.39, colour: '#e9e7e1' },
  insulation: { label: 'insulation', density: 35, carbon: 1.9, colour: '#e8d777' },
  membrane: { label: 'roofing membrane', density: 1200, carbon: 2.6, colour: '#3f4447' },
  pod: { label: 'prefab bathroom pod', density: 250, carbon: 1.2, colour: '#eceee9' },
  soil: { label: 'lightweight planter soil', density: 1100, carbon: 0.02, colour: '#7b6a55', bulk: true },
  planting: { label: 'trees · shrubs', density: 60, carbon: 0, colour: '#6f9a5c' },
  pv: { label: 'PV modules · glass-glass', density: 375, carbon: 16, colour: '#33475e' },
  generic: { label: 'unspecified material', density: 1000, carbon: 0.3, colour: '#cfcfc8' },
  context: { label: 'neighbouring buildings', density: 0, carbon: 0, colour: '#dcdcd6' },
};

/** Solid densities (kg/m³) for imported geometry, where volumes are real. */
export const REAL_DENSITY: Partial<Record<MaterialId, number>> = {
  concrete: 2400,
  glulam: 470,
  clt: 470,
  timber: 480,
  glass: 2500,
  aluminium: 2700,
  terracotta: 1900,
  masonry: 1850,
  steel: 7850,
  gypsum: 850,
  insulation: 35,
  membrane: 1200,
  soil: 1600,
  planting: 600,
  pv: 2500,
  generic: 1000,
};

/** Biogenic carbon held in timber, kgCO2e per kg (≈ 50 % carbon content, ~12 % moisture). */
export const TIMBER_BIOGENIC = 1.6;

/** Where an imported part came from. */
export interface PartRef {
  guid: string;
  ifcType: string;
  name: string;
  storey: string;
  category: string;
  /** Build phase the sequencer gave it. */
  phase?: 'structure' | 'envelope' | 'fitout' | 'landscape';
  /** GlobalId of the wall or slab whose opening this element fills (doors, windows). */
  host?: string;
  /** GlobalId of the element that aggregates this one (a roof's slabs, a stair's flights). */
  parent?: string;
  /** The file gave it no usable material, so one was assumed from its type. */
  defaulted?: boolean;
}

/**
 * One rigid part. Generated parts are oriented boxes (`size` in the box's
 * local axes). Imported parts carry a mesh (`mesh` indexes Project.meshes);
 * their pos/size describe the axis-aligned bounds and `volume` is the real one.
 */
export interface Part {
  pos: Vec3;
  size: Vec3;
  quat: Quat;
  mat: MaterialId;
  mesh?: number;
  volume?: number;
  /** Material mix by volume share (layered walls); defaults to [mat, 1]. */
  mix?: [MaterialId, number][];
  ref?: PartRef;
}

/** Triangle mesh in world coordinates (metres, app axes), with feature lines. */
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  edges: Float32Array;
  closed: boolean;
  min: Vec3;
  max: Vec3;
}

export type ZoneId = string;

export interface ZoneDef {
  id: ZoneId;
  label: string;
  y0: number; // height span drawn in the structure stack
  y1: number;
}

/** How a step's parts arrive: lowered by the tower crane, cast in place, or set by hand. */
export type Method = 'crane' | 'cast' | 'manual';
/** How a part animates in: lowered from above, poured upward, or bored downward. */
export type Motion = 'lower' | 'pour' | 'bore';

/** A step as authored by the generator or the IFC sequencer (no timing yet). */
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
  bottom: number; // lowest point of this step's parts
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
  /** x of the slab edge the tie collars brace to. */
  tieX: number;
  /** Mast height when erected, m. */
  mastStart: number;
}

/** Camera key for the section fly-through, t relative to the section stage start. */
export interface CameraKey {
  t: number;
  target: Vec3;
  az: number; // degrees, from south (+Z) towards east (+X)
  el: number;
  dist: number;
  fov: number;
}

/** A captioned moment in stages 07–08; dt is relative to its stage's start. */
export interface ShotSpec {
  id: string;
  stage: 'material' | 'section';
  dt: number;
  title: string;
  spec: string;
  anchor: Vec3 | null;
}

export interface PresentationSpec {
  cut: { normal: Vec3; at: number; open: number };
  keys: CameraKey[];
  shots: ShotSpec[];
  /** Extra log lines, dt relative to the section stage start. */
  log: { dt: number; kind: 'CAM' | 'VIEW'; text: string }[];
}

export interface ProjectMeta {
  tagline: string; // under the wordmark
  caption: string; // caption card subtitle
  watermark: string;
  source: 'generator' | 'ifc';
  fileName?: string;
  /** IFC only: the recentring offset (app axes, metres), to map back to IFC world coordinates. */
  ifcOffset?: Vec3;
  /** IFC only: the IfcProject GlobalId, for BCF headers. */
  ifcProject?: string;
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
  zones: ZoneDef[];
  stages: StageDef[];
  steps: Step[];
  parts: ScheduledPart[];
  meshes: MeshData[];
  context: Part[];
  contextMeshes: MeshData[];
  crane: Crane;
  duration: number;
  totalMassKg: number;
  totalCarbonKg: number;
  totalBiogenicKg: number;
  /** Density overrides (kg/m³) used for mass; generated projects use effective densities. */
  density?: Partial<Record<MaterialId, number>>;
  presentation: PresentationSpec;
  meta: ProjectMeta;
  /** Import diagnostics for IFC projects. */
  report?: Record<string, unknown>;
}
