/**
 * Imported IFC model → install sequence → Project.
 *
 * Order (construction logic, not file order):
 *   1. structure by storey band; inside a band by bottom elevation, so
 *      footings → slab on grade → columns and walls → beams → slab above
 *   2. envelope (external walls, curtain walls, windows, external doors,
 *      cladding, roofing) trailing the structure by two bands
 *   3. fit-out (partitions, internal doors, finishes, services, furniture)
 *      with the envelope of the same band
 *   4. landscape last
 *
 * Methods: cast in place (concrete, masonry laid in courses), crane picks
 * (steel, mass timber, precast, curtain-wall panels, trees), by hand (the
 * rest). Only crane picks are checked against the crane's load chart.
 */
import { assembleProject, partMassKg, type StageConfig } from '../data/assemble';
import { MATERIAL_INFO, MOBILE_CRANE, REAL_DENSITY, isBuildingPart, mobilePick, planBox, type Crane, type PlanBox, type MaterialId, type MeshData, type Method, type Motion, type Part, type PresentationSpec, type Project, type StepDef, type ZoneDef } from '../data/types';
import type { Category, IfcModel, ImportedElement, Layer } from './model';

type Phase = 'structure' | 'envelope' | 'fitout' | 'landscape';

interface Classified {
  el: ImportedElement;
  part: Part;
  phase: Phase;
  group: string; // step group label, e.g. EXTERNAL WALLS
  code: string;
  priority: number;
  method: Method;
  motion: Motion;
  drop: number;
  band: number;
  defaulted: boolean;
}

const CATEGORY_DEFAULT: Record<Category, MaterialId> = {
  foundation: 'concrete',
  column: 'concrete',
  beam: 'concrete',
  slab: 'concrete',
  roof: 'concrete',
  wall: 'masonry',
  stair: 'concrete',
  member: 'steel',
  plate: 'glass',
  curtainwall: 'glass',
  window: 'glass',
  door: 'timber',
  railing: 'steel',
  covering: 'gypsum',
  shading: 'aluminium',
  proxy: 'generic',
  furniture: 'timber',
  services: 'steel',
  landscape: 'planting',
  site: 'soil',
};

/** Material keyword → MaterialId; null means "ignore this layer" (air). */
export function classifyMaterial(name: string): MaterialId | null | undefined {
  const n = name.toLowerCase();
  // the first match wins, so names that mention two materials are settled first
  if (/glass.?fib(re|er).?reinforced (concrete|cement)|\bgrc\b|\bgfrc\b/.test(n)) return 'concrete';
  // glass-fibre-reinforced gypsum is a gypsum board; reinforced plastics have no material of their own here
  if (/glass.?fib(re|er).?reinforced gypsum|\bgrg\b/.test(n)) return 'gypsum';
  if (/glass.?fib(re|er).?reinforced (plastic|polymer)|\bg?frp\b|\bgrp\b/.test(n)) return undefined;
  if (/glass ?wool|fib(re|er) ?glass|mineral ?(wool|fib)|stone ?wool|rock ?wool|\bbatts?\b/.test(n) && !/glaz|\bigu\b|insulat(ed|ing) glass/.test(n)) return 'insulation';
  // a foil or aluminium facing marks insulation board, unless the name is a faced plasterboard or panel
  if (/(alumin\w*|foil)[- ]faced/.test(n) && (!/plaster|gypsum|board|panel/.test(n) || /insul|wool|foam|phenolic|\beps\b|\bxps\b|\bpir\b|\bpur\b/.test(n))) return 'insulation';
  // an air layer or empty cavity, but not a cavity fill, an air barrier or a board
  if (/\bair\b|air ?space|air gap|cavity/.test(n) && !/insul|wool|fib|foam|\beps\b|\bxps\b|\bpir\b|\bpur\b|fill|membrane|barrier|board|block|brick|concrete|masonry|timber|steel/.test(n)) return null;
  if (/glass|glaz|\bglas\b|vitr/.test(n)) return 'glass';
  if (/alumin/.test(n)) return 'aluminium';
  if (/cross.?lam|\bclt\b|x-?lam|brettsperr/.test(n)) return 'clt';
  if (/glulam|\bglt\b|glued.?lam|\blvl\b|brettschicht|laminated veneer/.test(n)) return 'glulam';
  if (/insul|wool|\beps\b|\bxps\b|\bpir\b|\bpur\b|foam|thermal|rigid insul|semi-?rigid/.test(n)) return 'insulation';
  if (/timber|wood|lumber|plywood|\bosb\b|holz|spruce|pine|\bfir\b|\boak\b|larch|(?<!wit|oug)hout\b/.test(n)) return 'timber';
  // joists and sheathing are timber unless the name says steel or gypsum
  if (/joist|sheathing/.test(n) && !/steel|stahl|metal|\biron\b|gypsum|gips|plaster/.test(n)) return 'timber';
  if (/steel|stahl|metal|s235|s275|s355|\biron\b|\d{3} ?mpa/.test(n)) return 'steel';
  if (/brick|masonry|\bblock\b|\bcmu\b|clay|stone|granite|marble|limestone|baksteen|ziegel/.test(n)) return 'masonry';
  if (/concrete|beton|cast.?in|precast|\bc\d\d\/\d\d|cement|screed|grout/.test(n)) return 'concrete';
  if (/ceramic|tile|terracotta|porcelain/.test(n)) return 'terracotta';
  if (/plaster|gypsum|drywall|plasterboard|gips|gyproc/.test(n)) return 'gypsum';
  if (/membrane|epdm|bitumen|roofing|barrier|felt|vapou?r/.test(n)) return 'membrane';
  if (/grass|soil|earth|gravel|sand|turf|planting|vegetat/.test(n)) return 'soil';
  return undefined;
}

/** Share of a framed layer that is solid: studs and joists at centres, the rest is void or insulation. */
function framingFill(name: string): number {
  const n = name.toLowerCase();
  if (/\bstud|framing|\bframe\b|batten|purlin|furring|channel|track/.test(n)) return /metal|steel/.test(n) ? 0.04 : 0.12;
  if (/dimensional lumber|joist|rafter|truss/.test(n)) return /metal|steel/.test(n) ? 0.04 : 0.12;
  return 1;
}

function materialMix(el: ImportedElement): { mat: MaterialId; mix: [MaterialId, number][]; defaulted: boolean } {
  const shares = new Map<MaterialId, number>();
  let total = 0;
  let unknown = 0;
  const layers: Layer[] = el.layers.length ? el.layers : [];
  for (const l of layers) {
    const m = classifyMaterial(l.name);
    const t = l.thickness > 0 ? l.thickness : 1;
    total += t; // air and voids count towards the thickness but carry no material
    if (m === null) continue;
    if (m === undefined) {
      unknown += t;
      continue;
    }
    shares.set(m, (shares.get(m) ?? 0) + t * framingFill(l.name));
  }
  if (!shares.size) {
    const hint = classifyMaterial(`${el.objectType} ${el.name}`);
    const m = hint || CATEGORY_DEFAULT[el.category];
    return { mat: m, mix: [[m, 1]], defaulted: !hint };
  }
  if (unknown) {
    const d = CATEGORY_DEFAULT[el.category];
    shares.set(d, (shares.get(d) ?? 0) + unknown);
  }
  // shares are of the element's volume; whatever is left is air or void
  const mix = [...shares.entries()].map(([m, t]) => [m, t / total] as [MaterialId, number]).sort((a, b) => b[1] - a[1]);
  // the colour comes from the main solid layer, not insulation or membranes
  const main = mix.find(([m]) => m !== 'insulation' && m !== 'membrane') ?? mix[0];
  return { mat: main[0], mix, defaulted: false };
}

const GROUP: Record<Category, { label: string; code: string; priority: number }> = {
  foundation: { label: 'FOUNDATIONS', code: 'FD', priority: 0 },
  column: { label: 'COLUMNS', code: 'CL', priority: 1 },
  wall: { label: 'WALLS', code: 'WL', priority: 2 },
  stair: { label: 'STAIRS', code: 'ST', priority: 3 },
  member: { label: 'MEMBERS', code: 'MB', priority: 4 },
  beam: { label: 'BEAMS', code: 'BM', priority: 5 },
  slab: { label: 'SLABS', code: 'SL', priority: 6 },
  roof: { label: 'ROOF', code: 'RF', priority: 7 },
  plate: { label: 'PANELS', code: 'PL', priority: 8 },
  curtainwall: { label: 'CURTAIN WALL', code: 'CW', priority: 10 },
  window: { label: 'WINDOWS', code: 'WN', priority: 11 },
  door: { label: 'DOORS', code: 'DR', priority: 12 },
  shading: { label: 'SHADING', code: 'SH', priority: 13 },
  railing: { label: 'RAILINGS', code: 'RL', priority: 14 },
  covering: { label: 'FINISHES', code: 'CV', priority: 15 },
  proxy: { label: 'OTHER ELEMENTS', code: 'PX', priority: 16 },
  services: { label: 'SERVICES', code: 'SV', priority: 17 },
  furniture: { label: 'FURNITURE', code: 'FF', priority: 18 },
  landscape: { label: 'LANDSCAPE', code: 'LS', priority: 19 },
  site: { label: 'SITE', code: 'SI', priority: 20 },
};

const isPrecast = (el: ImportedElement) => /precast|pre-cast|prefab|hollow ?core|\bpc\b|module|\bpod\b/i.test(`${el.name} ${el.objectType} ${el.layers.map((l) => l.name).join(' ')}`);

/**
 * Terrain and ground surfaces (a toposurface, a landform, a paved area): landscape
 * items that are graded or laid in place, not lifted like a tree. Named as such,
 * typed as terrain, or wide and flat.
 */
function isGroundwork(el: ImportedElement): boolean {
  if (el.category !== 'landscape' && el.category !== 'site') return false;
  if (el.category === 'site' || el.predefined === 'TERRAIN') return true;
  if (/topo|terrain|landform|ground ?surface|grading|\bsite\b|paving|hardstanding|lawn|turf/i.test(`${el.name} ${el.objectType}`)) return true;
  const w = el.max[0] - el.min[0], d = el.max[2] - el.min[2], h = el.max[1] - el.min[1];
  return w * d > 20 && h < 0.25 * Math.max(w, d) && h < 1.5;
}

function wallThickness(el: ImportedElement): number {
  const real = el.layers.filter((l) => l.thickness > 0 && l.thickness < 3);
  if (real.length) return real.reduce((a, l) => a + l.thickness, 0);
  return Math.min(el.max[0] - el.min[0], el.max[2] - el.min[2]);
}

function classify(el: ImportedElement, byId: Map<number, ImportedElement>, supporting: Set<number>): Omit<Classified, 'part' | 'band' | 'defaulted'> & { mat: MaterialId } {
  const { mat } = materialMix(el);
  const parent = el.parent !== null ? byId.get(el.parent) : undefined;
  const inCurtain = parent?.category === 'curtainwall' || el.category === 'curtainwall';
  const host = el.fills !== null ? byId.get(el.fills) : undefined;
  let phase: Phase = 'structure';
  let group = GROUP[el.category];
  switch (el.category) {
    case 'wall': {
      // trust geometry over the flag: a heavy wall that something bears on is structure
      const heavy = (mat === 'concrete' || mat === 'masonry' || mat === 'clt') && wallThickness(el) >= 0.14;
      const structural = el.loadBearing === true || (heavy && (supporting.has(el.id) || el.loadBearing === null));
      if (structural) {
        phase = 'structure';
        group = { ...group, label: el.isExternal ? 'EXTERNAL WALLS' : 'STRUCTURAL WALLS' };
      } else if (el.isExternal) {
        phase = 'envelope';
        group = { label: 'EXTERNAL WALLS', code: 'EW', priority: 9 };
      } else {
        phase = 'fitout';
        group = { label: 'PARTITIONS', code: 'PT', priority: 9 };
      }
      break;
    }
    case 'member':
    case 'plate':
      if (inCurtain) {
        phase = 'envelope';
        group = GROUP.curtainwall;
      }
      break;
    case 'curtainwall':
    case 'window':
    case 'shading':
      phase = 'envelope';
      break;
    case 'door':
      phase = el.isExternal === true || host?.isExternal === true ? 'envelope' : 'fitout';
      if (phase === 'fitout') group = { ...group, label: 'INTERNAL DOORS' };
      break;
    case 'slab':
      if (el.max[1] - el.min[1] < 0.06 && el.predefined !== 'BASESLAB') {
        phase = 'fitout'; // a floor finish modelled as a thin slab
        group = { label: 'FLOOR FINISHES', code: 'FL', priority: 15 };
      }
      break;
    case 'covering': {
      const roofing = /ROOFING|CLADDING/.test(el.predefined);
      phase = roofing ? 'envelope' : 'fitout';
      group = roofing ? { label: el.predefined === 'ROOFING' ? 'ROOFING' : 'CLADDING', code: 'CV', priority: 13 } : GROUP.covering;
      break;
    }
    case 'railing':
      phase = el.isExternal === true ? 'envelope' : 'fitout';
      break;
    case 'proxy':
    case 'services':
    case 'furniture':
      phase = 'fitout';
      break;
    case 'landscape':
      phase = 'landscape';
      break;
    default:
      phase = 'structure';
  }
  // how it arrives on site
  let method: Method = 'manual';
  let motion: Motion = 'lower';
  let drop = 0.6;
  const cat = el.category;
  if (cat === 'foundation') {
    method = 'cast';
    motion = el.type === 'IFCPILE' ? 'bore' : 'pour';
    drop = 0;
  } else if (mat === 'concrete' && !isPrecast(el) && (cat === 'slab' || cat === 'wall' || cat === 'column' || cat === 'beam' || cat === 'stair' || cat === 'roof')) {
    method = 'cast';
    motion = 'pour';
    drop = 0;
  } else if (mat === 'masonry' && cat === 'wall') {
    method = 'manual';
    motion = 'pour'; // laid in courses
    drop = 0;
  } else if (
    ((cat === 'column' || cat === 'beam' || cat === 'member') && (mat === 'steel' || mat === 'glulam' || mat === 'timber' || mat === 'clt' || mat === 'concrete')) ||
    ((cat === 'slab' || cat === 'roof' || cat === 'wall') && mat === 'clt') ||
    isPrecast(el) ||
    (inCurtain && (cat === 'plate' || cat === 'member' || cat === 'curtainwall')) ||
    (cat === 'landscape' && !isGroundwork(el))
  ) {
    method = 'crane';
    drop = 2.2;
  } else if (isGroundwork(el)) {
    // terrain and hard landscape are formed where they lie, not lifted
    motion = 'pour';
    drop = 0;
  } else if (cat === 'furniture' || cat === 'services' || cat === 'covering') {
    drop = 0.35;
  }
  return { el, phase, group: group.label, code: group.code, priority: group.priority, method, motion, drop, mat };
}

const QUADRANTS = ['NORTH-WEST', 'NORTH-EAST', 'SOUTH-EAST', 'SOUTH-WEST'];

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-GB').replace(/,/g, ' ');

/** Most common family/type name in a group, without Revit's trailing element ids. */
function familyOf(items: Classified[]): string {
  const counts = new Map<string, number>();
  for (const c of items) {
    const raw = (c.el.objectType || c.el.name || '').replace(/:\d+(:\d+)?$/, '').trim();
    if (!raw) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  return best.length > 46 ? `${best.slice(0, 45)}…` : best;
}

/** An element whose material was not recognised (or missing), so a default was used. */
export interface DefaultedElement {
  id: number; // IFC entity id
  guid: string;
  name: string;
  ifcType: string;
  material: MaterialId; // the default it was given
}

export interface SequenceResult {
  project: Project;
  defaultedMaterials: number;
  /** The elements behind defaultedMaterials; also on project.report.defaultedElements. */
  defaultedElements: DefaultedElement[];
  bands: string[];
}

/** A building under this height (m) is low-rise: a mobile crane reaches over it from the street. */
export const LOW_RISE_M = 12;
/** A mobile crane is chosen only when every pick stays under this share of its chart (the checks' default review threshold). */
const MOBILE_MARGIN = 0.85;

export interface LiftPlan {
  /** Whether the building needs a tower crane. */
  tower: boolean;
  /** Why, in a sentence for the import report. */
  reason: string;
  /** Heaviest crane pick, kg, and the highest share of the mobile crane's chart any pick takes. */
  heaviestKg: number;
  mobileUtil: number;
}

/**
 * Tower crane or not. A low-rise building (under LOW_RISE_M) whose every crane
 * pick fits an indicative mobile crane's chart, set up beside the nearest face,
 * with the review margin to spare, is lifted by mobile crane and by hand; a
 * tower crane beside a house is the kind of plan nobody would believe.
 */
export function liftPlanFor(height: number, picks: readonly { x: number; z: number; kg: number }[], box: PlanBox): LiftPlan {
  let heaviestKg = 0, mobileUtil = 0, worstKg = 0;
  for (const q of picks) {
    heaviestKg = Math.max(heaviestKg, q.kg);
    const u = mobilePick(box, q.x, q.z, q.kg).util;
    if (u > mobileUtil) {
      mobileUtil = u;
      worstKg = q.kg;
    }
  }
  const kg = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} t` : `${Math.round(v / 10) * 10} kg`);
  const h = `${height.toFixed(1)} m`;
  const share = (u: number) => (Number.isFinite(u) ? `${Math.round(u * 100)} %` : `beyond the indicative chart's ${MOBILE_CRANE.reach} m reach`);
  if (height >= LOW_RISE_M) return { tower: true, reason: `tower crane assumed: the building is ${h} tall (${LOW_RISE_M} m or more)`, heaviestKg, mobileUtil };
  if (mobileUtil > MOBILE_MARGIN) {
    const need = Number.isFinite(mobileUtil) ? `needs ${share(mobileUtil)} of a mobile crane's chart` : `is ${share(mobileUtil)} for a mobile crane`;
    return { tower: true, reason: `tower crane assumed: a pick of ${kg(worstKg)} ${need}`, heaviestKg, mobileUtil };
  }
  const heaviest = picks.length ? `heaviest pick ${kg(heaviestKg)}, at most ${share(mobileUtil)} of ${MOBILE_CRANE.chart}` : 'no crane picks';
  return { tower: false, reason: `mobile crane / by hand: ${h} tall, ${heaviest}`, heaviestKg, mobileUtil };
}

export function projectFromIfc(model: IfcModel, fileName = 'model.ifc'): SequenceResult {
  const els = model.elements;
  const byId = new Map(els.map((e) => [e.id, e]));
  const guidOf = new Map<number, string>([...model.parents, ...els.map((e) => [e.id, e.guid] as [number, string])]);
  const meshes: MeshData[] = [];
  // extents in one pass (spreading one argument per element overflows the stack on big models)
  const { min: bmin, max: bmax } = extents(els);
  const [minX, lo, minZ] = bmin;
  const [maxX, hi, maxZ] = bmax;
  // storey bands from geometry: the highest storey at or below an element's bottom
  let storeys = model.storeys.slice();
  if (!storeys.length) {
    storeys = [];
    for (let y = lo, k = 0; y < hi - 1; y += 3.5, k++) storeys.push({ id: -k - 1, name: `LEVEL ${String(k).padStart(2, '0')}`, elevation: y });
  }
  // merge storeys closer than 1.2 m (split levels, top-of-structure markers)
  const levels: typeof storeys = [];
  for (const s of storeys) if (!levels.length || s.elevation - levels[levels.length - 1].elevation > 1.2) levels.push(s);
  // always one band, so a model under 1 m tall with no storeys is still sequenced
  if (!levels.length) levels.push({ id: -1, name: 'LEVEL 00', elevation: lo });
  const bandOf = (y: number) => {
    let b = 0;
    for (let i = 0; i < levels.length; i++) if (levels[i].elevation <= y + 0.25) b = i;
    return b;
  };

  // walls and columns that a slab, beam or roof bears on
  const horizontals = els.filter((e) => (e.category === 'slab' || e.category === 'beam' || e.category === 'roof') && e.max[1] - e.min[1] >= 0.06);
  const supporting = new Set<number>();
  for (const w of els) {
    if (w.category !== 'wall' && w.category !== 'column') continue;
    for (const h of horizontals) {
      if (Math.abs(h.min[1] - w.max[1]) > 0.35) continue;
      if (h.max[0] < w.min[0] - 0.05 || h.min[0] > w.max[0] + 0.05 || h.max[2] < w.min[2] - 0.05 || h.min[2] > w.max[2] + 0.05) continue;
      supporting.add(w.id);
      break;
    }
  }

  const defaultedElements: DefaultedElement[] = [];
  const items: Classified[] = els.map((el) => {
    const c = classify(el, byId, supporting);
    const mm = materialMix(el);
    if (mm.defaulted) defaultedElements.push({ id: el.id, guid: el.guid, name: el.name, ifcType: el.type, material: mm.mat });
    const meshIndex = meshes.length;
    meshes.push({ positions: el.positions, indices: el.indices, edges: el.edges, closed: el.closed, min: el.min, max: el.max });
    const part: Part = {
      pos: [(el.min[0] + el.max[0]) / 2, (el.min[1] + el.max[1]) / 2, (el.min[2] + el.max[2]) / 2],
      size: [el.max[0] - el.min[0], el.max[1] - el.min[1], el.max[2] - el.min[2]],
      quat: [0, 0, 0, 1],
      mat: mm.mat,
      mix: mm.mix,
      mesh: meshIndex,
      volume: el.volume,
      ref: {
        guid: el.guid,
        ifcType: el.type,
        name: el.name,
        storey: el.storey >= 0 ? model.storeys[el.storey]?.name ?? '' : '',
        category: el.category,
        phase: c.phase,
        host: el.fills !== null ? guidOf.get(el.fills) : undefined,
        parent: el.parent !== null ? guidOf.get(el.parent) : undefined,
        defaulted: mm.defaulted || undefined,
      },
    };
    return { ...c, part, band: bandOf(el.min[1]), defaulted: mm.defaulted };
  });

  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const quadrantOf = (c: Classified) => (c.part.pos[2] < cz ? (c.part.pos[0] < cx ? 0 : 1) : c.part.pos[0] < cx ? 3 : 2);
  const bandName = (b: number) => (levels[b]?.name || `BAND ${b + 1}`).toUpperCase();

  // ── build steps per band and phase ──
  const nBands = levels.length;
  const stepsFor = (list: Classified[], band: number): StepDef[] => {
    const out: StepDef[] = [];
    // group: same category label and same 0.15 m bottom bucket (structure) or same label (others)
    const groups = new Map<string, Classified[]>();
    for (const c of list) {
      const bucket = c.phase === 'structure' ? Math.round(c.el.min[1] / 0.15) : 0;
      const key = `${c.phase === 'structure' ? String(bucket + 100000).padStart(7, '0') : ''}|${String(c.priority).padStart(2, '0')}|${c.group}`;
      const g = groups.get(key);
      if (g) g.push(c);
      else groups.set(key, [c]);
    }
    for (const [, g] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const chunks: { name: string; items: Classified[] }[] = [];
      if (g.length > 14) {
        for (let q = 0; q < 4; q++) {
          const items = g.filter((c) => quadrantOf(c) === q);
          for (let k = 0; k < items.length; k += 24) chunks.push({ name: QUADRANTS[q] + (items.length > 24 ? ` ${k / 24 + 1}` : ''), items: items.slice(k, k + 24) });
        }
      } else chunks.push({ name: '', items: g });
      for (const ch of chunks) {
        if (!ch.items.length) continue;
        const c0 = ch.items[0];
        const fam = familyOf(ch.items);
        const mat = MATERIAL_INFO[c0.part.mat].label;
        out.push({
          zone: '',
          member: `${bandName(band)} · ${c0.group}${ch.name ? ` · ${ch.name}` : ''}`,
          spec: [fam || c0.group.toLowerCase(), `${ch.items.length} pcs`, mat].join(' · '),
          code: `${c0.code}-${String(band + 1).padStart(2, '0')}`,
          method: c0.method,
          motion: c0.motion,
          drop: c0.drop,
          parts: ch.items.sort((a, b) => a.part.pos[0] - b.part.pos[0] || a.part.pos[2] - b.part.pos[2]).map((c) => c.part),
          kind: c0.phase === 'envelope' ? 'facade' : c0.phase === 'structure' ? 'frame' : 'other',
        });
      }
    }
    return out;
  };
  const by = (phase: Phase, band: number) => items.filter((c) => c.phase === phase && c.band === band);

  // ── a tower crane, or a mobile crane and the site team for a low-rise building ──
  const picks = items.filter((c) => c.method === 'crane' && !MATERIAL_INFO[c.part.mat].bulk).map((c) => ({ x: c.part.pos[0], z: c.part.pos[2], kg: partMassKg(c.part, REAL_DENSITY) }));
  // the plan box and the tower crane's reach come from the building itself: terrain and
  // landscape around it are not what the crane stands beside or has to reach
  const plan = liftPlanFor(hi - Math.max(0, lo), picks, planBox(items.map((c) => c.part)));
  const building = items.filter((c) => isBuildingPart(c.part)).map((c) => c.el);
  const bx = extents(building.length ? building : els);

  // ── interleave: structure of band b, then envelope + fit-out of band b − 2 ──
  const ordered: { band: number; defs: StepDef[] }[] = [];
  const LAG = 2;
  for (let b = 0; b < nBands; b++) {
    const defs = stepsFor(by('structure', b), b);
    if (b === 0 && plan.tower) {
      // the crane goes up once the foundations are in
      const firstNonFoundation = defs.findIndex((d) => !d.code.startsWith('FD'));
      const at = firstNonFoundation < 0 ? defs.length : firstNonFoundation;
      defs.splice(at, 0, { zone: '', member: 'TC-1 · TOWER CRANE ERECTED', spec: 'flat-top tower crane · base pad cast beside the building', code: 'TC-02', method: 'manual', motion: 'lower', drop: 0, parts: [], log: 'ERECT TC-1 · crane erected beside the building' });
    }
    const late = b - LAG;
    if (late >= 0) defs.push(...stepsFor(by('envelope', late), late), ...stepsFor(by('fitout', late), late));
    ordered.push({ band: b, defs });
  }
  const tail: StepDef[] = [];
  for (let b = Math.max(0, nBands - LAG); b < nBands; b++) tail.push(...stepsFor(by('envelope', b), b), ...stepsFor(by('fitout', b), b));
  tail.push(...stepsFor(items.filter((c) => c.phase === 'landscape'), Math.max(0, nBands - 1)));

  // ── zones: bands grouped into ≤ 5 assembly stages, plus close-in & fit-out ──
  const groupsN = Math.min(5, nBands);
  const zoneOfBand = (b: number) => Math.min(groupsN - 1, Math.floor((b * groupsN) / nBands));
  const zones: ZoneDef[] = [];
  const stages: StageConfig[] = [];
  const allDefs: StepDef[] = [];
  for (let z = 0; z < groupsN; z++) {
    const bands = ordered.filter((o) => zoneOfBand(o.band) === z);
    const defs = bands.flatMap((o) => o.defs);
    if (!defs.length) continue;
    const first = bandName(bands[0].band);
    const last = bandName(bands[bands.length - 1].band);
    const label = first === last ? first : `${first} – ${last}`;
    const id = `Z${z + 1}`;
    for (const d of defs) d.zone = id;
    allDefs.push(...defs);
    const y0 = levels[bands[0].band]?.elevation ?? lo;
    const y1 = levels[bands[bands.length - 1].band + 1]?.elevation ?? hi;
    zones.push({ id, label: shortLabel(label, 14), y0: Math.min(y0, z === 0 ? lo : y0), y1 });
    stages.push({ code: shortLabel(label, 8), tick: shortLabel(first, 7), title: label, zones: [id], kind: 'assembly', sheet: `A-${301 + stages.length}`, subtitle: (n) => `${phaseSummary(defs)} · ${n} steps` });
  }
  if (tail.length) {
    for (const d of tail) d.zone = 'ZF';
    allDefs.push(...tail);
    zones.push({ id: 'ZF', label: 'CLOSE-IN & FIT-OUT', y0: hi, y1: hi + Math.max(1, (hi - lo) * 0.08) });
    stages.push({ code: 'CLOSE-IN', tick: 'FIT-OUT', title: 'CLOSE-IN & FIT-OUT', zones: ['ZF'], kind: 'assembly', sheet: `A-${301 + stages.length}`, subtitle: (n) => `envelope · finishes · ${n} steps` });
  }
  stages.push({ code: 'MATERIAL', tick: 'MAT', title: 'MATERIAL PASS', zones: [], kind: 'material', sheet: `A-${301 + stages.length}`, seconds: 4.0, subtitle: () => 'structure · envelope · 2 passes' });
  stages.push({ code: 'SECTION', tick: 'SECT', title: 'SECTION A–A', zones: [], kind: 'section', sheet: `A-${301 + stages.length}`, seconds: 6.8, subtitle: () => 'cut · fly-through · 6.8 s' });

  // ── crane on the west side, sized to reach every element ──
  let crane: Crane | null = null;
  if (plan.tower) {
    const base: [number, number, number] = [bx.min[0] - 7, 0, (bx.min[2] + bx.max[2]) / 2];
    let reach = 0;
    for (const e of building.length ? building : els) for (const x of [e.min[0], e.max[0]]) for (const z of [e.min[2], e.max[2]]) reach = Math.max(reach, Math.hypot(x - base[0], z - base[2]));
    const jib = Math.min(80, Math.max(30, Math.ceil((reach + 3) / 5) * 5));
    const r0 = jib / 3;
    crane = {
      id: 'TC-1',
      base,
      jib,
      counterJib: Math.round(jib * 0.3),
      maxKg: 12000,
      tipKg: Math.round(12000 * Math.pow(r0 / jib, 1.45)),
      capacityAt: (r: number) => Math.min(12000, 12000 * Math.pow(r0 / Math.max(r, 1), 1.45)),
      tieX: bx.min[0],
      mastStart: hi < 18 ? Math.max(12, hi + 9) : Math.max(20, Math.min(44, hi + 14)),
      assumed: true,
    };
  }

  // ── floor area for carbon intensity: plan areas of the floor slabs ──
  // a slab drawn through its parts (Revit Parts: screed, structure, insulation) is one floor:
  // its plan area counts once, from its largest part
  let gifa = 0;
  const partArea = new Map<number, number>();
  for (const c of items) {
    if (!isFloorSlab(c)) continue;
    const area = c.el.volume / Math.max(0.05, c.el.max[1] - c.el.min[1]);
    if (c.el.type === 'IFCBUILDINGELEMENTPART' && c.el.parent !== null) partArea.set(c.el.parent, Math.max(partArea.get(c.el.parent) ?? 0, area));
    else gifa += area;
  }
  for (const a of partArea.values()) gifa += a;
  if (gifa < 10) gifa = (maxX - minX) * (maxZ - minZ) * Math.max(1, levels.length - 1);

  const datums = pickDatums(levels.map((l) => ({ code: shortLabel(l.name.toUpperCase(), 8), y: l.elevation })));
  const name = model.name;
  const nSteps = allDefs.length;
  const id = `${name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'IF'}-${String(levels.length).padStart(2, '0')}`;
  const defaulted = defaultedElements.length;
  const report = { ...model.report, defaultedMaterials: defaulted, defaultedElements, bands: levels.map((l) => l.name), lifting: plan.reason };

  const project = assembleProject({
    id,
    name,
    subtitle: `Imported IFC · ${levels.length} storeys · built in install order`,
    rev: '—',
    revDate: model.report.schema,
    storeys: levels.length,
    gifa,
    levels: [...datums, { code: 'TOP', y: hi }],
    zones,
    stages,
    defs: allDefs,
    meshes,
    contextMeshes: model.site.map((s) => ({ positions: s.positions, indices: s.indices, edges: s.edges, closed: s.closed, min: s.min, max: s.max })),
    crane,
    density: REAL_DENSITY,
    secondsPerStep: Math.min(0.25, Math.max(0.035, 15 / Math.max(1, nSteps))),
    meta: {
      tagline: `${model.report.schema} · ${levels.length} STOREYS · ${fmtInt(els.length)} ELEMENTS · INSTALL ORDER`,
      caption: `Imported from ${fileName}${model.report.application ? ` · ${model.report.application}` : ''}`,
      watermark: (name.split(/[\s_-]+/)[0] || 'IFC').toUpperCase().slice(0, 7),
      source: 'ifc',
      fileName,
      ifcOffset: model.offset,
      ifcProject: model.projectGuid || undefined,
    },
    presentation: (p) => genericPresentation(p, levels.map((l) => ({ name: l.name, y: l.elevation })), { cx, cz }),
    report,
  });
  return { project, defaultedMaterials: defaulted, defaultedElements, bands: levels.map((l) => l.name) };
}

/** Bounding box of all elements, in one pass. */
function extents(els: ImportedElement[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const e of els)
    for (let k = 0; k < 3; k++) {
      if (e.min[k] < min[k]) min[k] = e.min[k];
      if (e.max[k] > max[k]) max[k] = e.max[k];
    }
  return { min, max };
}

/**
 * A slab that counts towards the gross internal floor area: not a floor finish (the
 * same test classify() applies), not a roof or landing, and not an external slab
 * such as a patio (often flagged only in its name).
 */
function isFloorSlab(c: Classified): boolean {
  const e = c.el;
  return (
    e.category === 'slab' &&
    e.volume > 0 &&
    c.group !== 'FLOOR FINISHES' &&
    e.predefined !== 'ROOF' &&
    e.predefined !== 'LANDING' &&
    e.isExternal !== true &&
    !/\bexterior\b|\bexternal\b|\bpatio\b|\bterrace\b/i.test(`${e.name} ${e.objectType}`)
  );
}

function shortLabel(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function phaseSummary(defs: StepDef[]) {
  const kinds = new Set(defs.map((d) => d.kind));
  const parts = [kinds.has('frame') ? 'structure' : '', kinds.has('facade') ? 'envelope' : '', kinds.has('other') ? 'fit-out' : ''].filter(Boolean);
  return parts.join(' · ') || 'structure';
}

/** Up to seven datums spread over the height, always including the lowest and highest. */
function pickDatums(levels: { code: string; y: number }[]) {
  if (levels.length <= 7) return levels;
  const out = [levels[0]];
  for (let i = 1; i < 6; i++) out.push(levels[Math.round((i * (levels.length - 1)) / 6)]);
  out.push(levels[levels.length - 1]);
  return out.filter((l, i, a) => a.indexOf(l) === i);
}

function genericPresentation(p: Omit<Project, 'presentation'>, levels: { name: string; y: number }[], c: { cx: number; cz: number }): PresentationSpec {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const m of p.meshes) {
    minX = Math.min(minX, m.min[0]); maxX = Math.max(maxX, m.max[0]);
    minZ = Math.min(minZ, m.min[2]); maxZ = Math.max(maxZ, m.max[2]);
  }
  const H = p.height;
  const halfX = (maxX - minX) / 2;
  const at = +(c.cx + halfX * 0.25).toFixed(2);
  const span = Math.max(maxZ - minZ, H, 8);
  const far = Math.max(60, span * 3.2);
  const near = Math.max(16, span * 0.95);
  const above = levels.filter((l) => l.y >= -0.5 && l.y < H - 1);
  const pick = (f: number) => above[Math.min(above.length - 1, Math.max(0, Math.round(f * (above.length - 1))))];
  const lower = pick(0.0), middle = pick(0.5), upper = pick(1.0);
  const shotsAt = [lower, middle, upper].filter((l, i, a) => l && a.indexOf(l) === i);
  const keys = [
    { t: 0.0, target: [c.cx, H * 0.5, c.cz] as [number, number, number], az: 90, el: 8, dist: far, fov: 26 },
    { t: 0.9, target: [c.cx + 0.5, H * 0.5, c.cz] as [number, number, number], az: 90, el: 8, dist: far, fov: 26 },
  ];
  const shots: PresentationSpec['shots'] = [
    ...(p.crane ? [{ id: 'M-00', stage: 'material' as const, dt: 0.05, title: `${p.crane.id} · CRANE DISMANTLED`, spec: 'sections lowered by a mobile crane at street level', anchor: null }] : []),
    { id: 'M-01', stage: 'material', dt: 0.15, title: 'MATERIAL PASS 1/2 · STRUCTURE', spec: 'frame, slabs and walls in their own materials', anchor: [minX, H * 0.3, maxZ] },
    { id: 'M-02', stage: 'material', dt: 1.6, title: 'MATERIAL PASS 2/2 · ENVELOPE & FINISHES', spec: 'glazing, cladding, finishes and planting', anchor: [c.cx, H * 0.55, maxZ] },
    { id: 'M-03', stage: 'material', dt: 2.9, title: 'EMBODIED CARBON · INDICATIVE', spec: `≈ ${fmtInt(p.totalCarbonKg / 1000)} tCO₂e A1–A3 · ≈ ${Math.round(p.totalCarbonKg / Math.max(1, p.gifa))} kg/m²`, anchor: [c.cx - halfX * 0.5, H * 0.45, maxZ] },
    { id: 'S-01', stage: 'section', dt: 0.1, title: 'SECTION A–A · CUT PLANE', spec: `x = ${at.toFixed(1)} m · cut faces hatched`, anchor: [at, H * 0.6, minZ + (maxZ - minZ) * 0.2] },
  ];
  const log: PresentationSpec['log'] = [{ dt: 0.95, kind: 'CAM', text: `CAM dolly in · ${Math.round(far)} → ${Math.round(near)} m` }];
  const times = [1.9, 2.9, 3.9];
  shotsAt.forEach((l, i) => {
    const t = times[i] ?? 3.9;
    keys.push({ t, target: [at, l.y + 1.6, c.cz], az: 96 + i * 7, el: 6 + i * 3, dist: near, fov: 34 });
    shots.push({ id: `S-0${i + 2}`, stage: 'section', dt: t, title: `${l.name.toUpperCase()} IN SECTION`, spec: `walls, slabs and openings cut at x = ${at.toFixed(1)} m`, anchor: [at, l.y + 1.2, c.cz] });
    log.push({ dt: t, kind: 'VIEW', text: `VIEW ${l.name} · in section` });
  });
  keys.push({ t: 4.8, target: [at, H, c.cz], az: 116, el: 18, dist: near * 1.15, fov: 32 });
  shots.push({ id: 'S-06', stage: 'section', dt: 4.8, title: 'ROOF IN SECTION', spec: 'roof build-up and parapets', anchor: [at, H - 0.3, c.cz] });
  keys.push({ t: 5.6, target: [c.cx, H * 0.5, c.cz], az: 124, el: 10, dist: far, fov: 26 });
  log.push({ dt: 4.8, kind: 'VIEW', text: 'VIEW roof · in section' }, { dt: 5.15, kind: 'CAM', text: `CAM pull back · ${Math.round(near)} → ${Math.round(far)} m` });
  shots.push({ id: 'S-07', stage: 'section', dt: 5.6, title: 'SECTION A–A · CLOSING', spec: 'the model closes back up', anchor: null });
  return { cut: { normal: [1, 0, 0], at, open: maxX + 5 }, keys, shots, log };
}
