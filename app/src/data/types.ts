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

/**
 * How a step's parts arrive: lifted by crane (the tower crane, or a mobile crane
 * on a project that has none), cast in place, or set by hand.
 */
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
  at: Vec3; // where the critical piece sits
}

/** How hard a pick works the crane: under the review threshold, at or above it, or over the chart. */
export type LiftLevel = 'ok' | 'warn' | 'over';

/** One threshold for the operation panel, the reach overlay and the checks (85 % by default). */
export function liftLevel(util: number, warnAt = 0.85): LiftLevel {
  return util > 1 ? 'over' : util >= warnAt ? 'warn' : 'ok';
}

/** A pick as the checks read it: the piece plus the rigging allowance, against the chart at its radius. */
export function reviewedLift(pieceKg: number, capacityKg: number, riggingKg = 0): { kg: number; util: number } {
  const kg = pieceKg + riggingKg;
  return { kg, util: capacityKg > 0 ? kg / capacityKg : Infinity };
}

/** Radius out to which the chart gives the crane's full capacity (where capacity starts to fall). */
export function chartKnee(crane: Crane): number {
  const full = crane.maxKg * (1 - 1e-9);
  let lo = 0, hi = crane.jib;
  if (crane.capacityAt(hi) >= full) return hi;
  for (let k = 0; k < 48; k++) {
    const m = (lo + hi) / 2;
    if (crane.capacityAt(m) >= full) lo = m;
    else hi = m;
  }
  return lo;
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
  lift: LiftCheck | null; // null unless method === 'crane' and the project has a tower crane
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
  /** Placed by the importer (off the west face, sized to reach everything), not chosen by anyone. */
  assumed?: boolean;
}

/**
 * An indicative all-terrain mobile crane (about 40 t class), set up on its
 * outriggers beside whichever face of the building is nearest the pick. Like
 * the tower crane's chart it is order-of-magnitude only: a real lift is
 * planned on the supplier's chart for the crane and the ground on the day.
 */
export const MOBILE_CRANE = {
  label: 'mobile crane',
  /** Full capacity, kg, out to `kneeM`. */
  maxKg: 12000,
  kneeM: 6,
  /** Furthest radius on the chart, m. */
  reach: 30,
  /** From the face of the building to the slew centre: outriggers, mats and clearance, m. */
  standoff: 4,
  capacityAt: (r: number) => (r > 30 ? 0 : Math.min(12000, 12000 * Math.pow(6 / Math.max(r, 1), 1.3))),
  /** The chart in words, for notes and reports. */
  chart: 'an indicative mobile crane chart (12 t to 6 m, 1.5 t at 30 m)',
} as const;

/** The building's extent in plan (app axes: x east, z south), m. */
export interface PlanBox {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Plan bounds of a set of parts (their axis-aligned boxes). */
export function planBox(parts: readonly Part[]): PlanBox {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of parts) {
    x0 = Math.min(x0, p.pos[0] - p.size[0] / 2); x1 = Math.max(x1, p.pos[0] + p.size[0] / 2);
    z0 = Math.min(z0, p.pos[2] - p.size[2] / 2); z1 = Math.max(z1, p.pos[2] + p.size[2] / 2);
  }
  return Number.isFinite(x0) ? { x0, x1, z0, z1 } : { x0: 0, x1: 0, z0: 0, z1: 0 };
}

/**
 * A pick by mobile crane: the crane stands beside the face nearest the piece,
 * so the radius is the piece's distance in from that face plus the standoff.
 */
export function mobilePick(box: PlanBox, x: number, z: number, kg: number): { radius: number; capacityKg: number; util: number } {
  const inside = Math.max(0, Math.min(x - box.x0, box.x1 - x, z - box.z0, box.z1 - z));
  const radius = inside + MOBILE_CRANE.standoff;
  const capacityKg = MOBILE_CRANE.capacityAt(radius);
  return { radius, capacityKg, util: capacityKg > 0 ? kg / capacityKg : Infinity };
}

/** How a project's pieces are lifted, in words for the panels and exports. */
export const liftingLabel = (crane: Crane | null) => (crane ? `tower crane ${crane.id}` : 'mobile crane / by hand');

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
  /**
   * The tower crane, or null when the project has none: a low-rise building
   * whose picks all fit a mobile crane is lifted by mobile crane and by hand.
   */
  crane: Crane | null;
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
