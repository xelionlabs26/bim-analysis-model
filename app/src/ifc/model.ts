/**
 * IFC model extraction: units, storeys, physical elements with their
 * geometry, containment, aggregation, openings, materials and the two
 * properties sequencing cares about (IsExternal, LoadBearing).
 *
 * Geometry comes out in metres, already converted to the app's axes
 * (x east, y up, z south) and recentred on the building footprint.
 */
import { Ref, StepFile, bool, enumOf, num, refs, str, type Entity, type StepValue } from './step';
import { IfcGeometry, Mesh, type V3 } from './geometry';

export type Category =
  | 'foundation'
  | 'column'
  | 'beam'
  | 'slab'
  | 'roof'
  | 'wall'
  | 'stair'
  | 'member'
  | 'plate'
  | 'curtainwall'
  | 'window'
  | 'door'
  | 'railing'
  | 'covering'
  | 'shading'
  | 'proxy'
  | 'furniture'
  | 'services'
  | 'landscape'
  | 'site';

const TYPE_CATEGORY: Record<string, Category> = {
  IFCFOOTING: 'foundation',
  IFCPILE: 'foundation',
  IFCCAISSONFOUNDATION: 'foundation',
  IFCDEEPFOUNDATION: 'foundation',
  IFCCOLUMN: 'column',
  IFCCOLUMNSTANDARDCASE: 'column',
  IFCBEAM: 'beam',
  IFCBEAMSTANDARDCASE: 'beam',
  IFCSLAB: 'slab',
  IFCSLABSTANDARDCASE: 'slab',
  IFCSLABELEMENTEDCASE: 'slab',
  IFCROOF: 'roof',
  IFCWALL: 'wall',
  IFCWALLSTANDARDCASE: 'wall',
  IFCWALLELEMENTEDCASE: 'wall',
  IFCSTAIR: 'stair',
  IFCSTAIRFLIGHT: 'stair',
  IFCRAMP: 'stair',
  IFCRAMPFLIGHT: 'stair',
  IFCMEMBER: 'member',
  IFCMEMBERSTANDARDCASE: 'member',
  IFCPLATE: 'plate',
  IFCPLATESTANDARDCASE: 'plate',
  IFCCURTAINWALL: 'curtainwall',
  IFCWINDOW: 'window',
  IFCWINDOWSTANDARDCASE: 'window',
  IFCDOOR: 'door',
  IFCDOORSTANDARDCASE: 'door',
  IFCRAILING: 'railing',
  IFCCOVERING: 'covering',
  IFCSHADINGDEVICE: 'shading',
  IFCCHIMNEY: 'proxy',
  IFCBUILDINGELEMENTPROXY: 'proxy',
  IFCBUILDINGELEMENTPART: 'proxy',
  IFCELEMENTASSEMBLY: 'proxy',
  IFCDISCRETEACCESSORY: 'proxy',
  IFCMECHANICALFASTENER: 'proxy',
  IFCREINFORCINGBAR: 'proxy',
  IFCREINFORCINGMESH: 'proxy',
  IFCTENDON: 'proxy',
  IFCFURNISHINGELEMENT: 'furniture',
  IFCFURNITURE: 'furniture',
  IFCSYSTEMFURNITUREELEMENT: 'furniture',
  IFCTRANSPORTELEMENT: 'services',
  IFCGEOGRAPHICELEMENT: 'landscape',
  IFCSITE: 'site',
};
const SERVICES = /^IFC(FLOW|DISTRIBUTION|ENERGYCONVERSION|DUCT|PIPE|CABLE|AIRTERMINAL|AIRTOAIR|SANITARY|LIGHTFIXTURE|LAMP|OUTLET|VALVE|PUMP|FAN|BOILER|CHILLER|UNITARY|TANK|ELECTRIC|SPACEHEATER|FIRESUPPRESSION|WASTETERMINAL|STACKTERMINAL|DAMPER|SWITCHINGDEVICE|PROTECTIVEDEVICE|JUNCTIONBOX|SENSOR|ALARM|ACTUATOR|CONTROLLER|COMMUNICATIONSAPPLIANCE|AUDIOVISUAL|MEDICALDEVICE|COIL|COOLEDBEAM|COOLINGTOWER|HEATEXCHANGER|HUMIDIFIER|EVAPORAT|COMPRESSOR|CONDENSER|ENGINE|MOTOR|TRANSFORMER|BURNER|COGENERATION|SOLARDEVICE|TUBEBUNDLE|INTERCEPTOR|FILTER|FLOWMETER|FLOWINSTRUMENT)/;

/** Type objects, styles, ports, systems and property entities share the services prefixes but are not physical elements. */
const NOT_ELEMENT = /(TYPE|STYLE|PORT|SYSTEM|CIRCUIT|PROPERTIES)$/;

export function categoryOf(type: string): Category | null {
  if (type in TYPE_CATEGORY) return TYPE_CATEGORY[type];
  return SERVICES.test(type) && !NOT_ELEMENT.test(type) ? 'services' : null;
}

export interface Layer {
  name: string;
  thickness: number; // metres (1 for plain materials, fraction for constituents)
}

export interface Storey {
  id: number;
  name: string;
  elevation: number; // metres, app y
}

export interface ImportedElement {
  id: number;
  guid: string;
  type: string; // IFC class, e.g. IFCWALLSTANDARDCASE
  category: Category;
  name: string;
  objectType: string;
  predefined: string;
  storey: number; // index into IfcModel.storeys, −1 when unknown
  parent: number | null; // aggregating element id
  fills: number | null; // element this one fills (door/window → wall)
  layers: Layer[];
  isExternal: boolean | null;
  loadBearing: boolean | null;
  /** World geometry, metres, app axes, recentred: positions (xyz) and triangle indices. */
  positions: Float32Array;
  indices: Uint32Array;
  edges: Float32Array; // feature line segments, pairs of points
  min: V3;
  max: V3;
  volume: number; // m³
  closed: boolean;
}

export interface ImportReport {
  schema: string;
  application: string;
  entities: number;
  products: number;
  meshed: number;
  noGeometry: number;
  byCategory: Record<string, number>;
  itemTypes: Record<string, number>;
  skippedItems: Record<string, number>;
  openingsCut: number;
  openingsSkipped: number;
  openingsOutside: number;
  openingsOutsideHosts: string[];
  clipsApplied: number;
  booleansApproximated: number;
  lengthUnit: string;
  /** The file ends before its data section closes (a cut-off download or copy). */
  truncated: boolean;
  warnings: string[];
}

export interface IfcModel {
  name: string;
  projectName: string;
  projectGuid: string;
  /** GlobalIds of the elements that aggregate others (roofs, stairs, curtain walls), by entity id. */
  parents: Map<number, string>;
  storeys: Storey[];
  elements: ImportedElement[];
  site: ImportedElement[]; // terrain etc., drawn as context only
  report: ImportReport;
  /** Offset applied to centre the model (app axes, metres). */
  offset: V3;
}

export type Progress = (phase: 'parse' | 'geometry' | 'finish', share: number) => void;

const PREFIX: Record<string, number> = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12 };

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

const PLACEMENT_NAME: Record<string, string> = { IFCGRIDPLACEMENT: 'IfcGridPlacement', IFCLINEARPLACEMENT: 'IfcLinearPlacement', IFCAXIS2PLACEMENTLINEAR: 'IfcAxis2PlacementLinear' };

/** Storey names below ground level: not taken as the ground storey when rebasing heights. */
const BELOW_GROUND = /basement|cellar|keller|kelder|sous[- ]?sol|souterrain|foundation|\bfdn\b|footing|substructure|lower ground|\b(ug|lg|b\d+)\b/i;

export async function readIfc(text: string, onProgress: Progress = () => {}, fileName = 'model.ifc'): Promise<IfcModel> {
  const f = StepFile.parse(text, (s) => onProgress('parse', s));
  await yieldToUi();
  const g = new IfcGeometry(f);
  const warnings: string[] = [];

  // ── units ──
  const project = f.idsOfType('IFCPROJECT').map((id) => f.get(id)!)[0];
  let lengthName = 'metre';
  if (project) {
    const ua = f.deref(project.args[8]);
    for (const uid of ua ? refs(ua.args[0]) : []) {
      const u = f.get(uid);
      if (!u) continue;
      const unitType = enumOf(u.args[1]);
      if (unitType !== 'LENGTHUNIT' && unitType !== 'PLANEANGLEUNIT') continue;
      const factor = unitFactor(f, u);
      if (unitType === 'LENGTHUNIT') {
        g.lengthUnit = factor;
        lengthName = u.type === 'IFCSIUNIT' ? `${(enumOf(u.args[2]) || '').toLowerCase()}${enumOf(u.args[3]).toLowerCase()}` : str(u.args[2]).toLowerCase() || 'converted';
      } else g.angleUnit = factor;
    }
  }
  const L = g.lengthUnit;

  // ── relationships ──
  const parentOf = new Map<number, number>();
  for (const id of f.idsOfType('IFCRELAGGREGATES')) {
    const r = f.get(id)!;
    const parent = r.args[4] instanceof Ref ? r.args[4].id : null;
    if (parent !== null) for (const c of refs(r.args[5])) parentOf.set(c, parent);
  }
  for (const id of f.idsOfType('IFCRELNESTS')) {
    const r = f.get(id)!;
    const parent = r.args[4] instanceof Ref ? r.args[4].id : null;
    if (parent !== null) for (const c of refs(r.args[5])) if (!parentOf.has(c)) parentOf.set(c, parent);
  }
  const containerOf = new Map<number, number>();
  for (const id of f.idsOfType('IFCRELCONTAINEDINSPATIALSTRUCTURE')) {
    const r = f.get(id)!;
    const s = r.args[5] instanceof Ref ? r.args[5].id : null;
    if (s !== null) for (const c of refs(r.args[4])) containerOf.set(c, s);
  }
  const openingsOf = new Map<number, number[]>();
  for (const id of f.idsOfType('IFCRELVOIDSELEMENT')) {
    const r = f.get(id)!;
    const host = r.args[4] instanceof Ref ? r.args[4].id : null;
    const op = r.args[5] instanceof Ref ? r.args[5].id : null;
    if (host !== null && op !== null) openingsOf.set(host, [...(openingsOf.get(host) ?? []), op]);
  }
  const openingHost = new Map<number, number>();
  for (const [host, ops] of openingsOf) for (const op of ops) openingHost.set(op, host);
  const fillsOpening = new Map<number, number>();
  for (const id of f.idsOfType('IFCRELFILLSELEMENT')) {
    const r = f.get(id)!;
    const op = r.args[4] instanceof Ref ? r.args[4].id : null;
    const el = r.args[5] instanceof Ref ? r.args[5].id : null;
    if (op !== null && el !== null) fillsOpening.set(el, op);
  }
  const typeOf = new Map<number, number>();
  for (const id of f.idsOfType('IFCRELDEFINESBYTYPE')) {
    const r = f.get(id)!;
    const t = r.args[5] instanceof Ref ? r.args[5].id : null;
    if (t !== null) for (const c of refs(r.args[4])) typeOf.set(c, t);
  }
  const materialOf = new Map<number, number>();
  for (const id of f.idsOfType('IFCRELASSOCIATESMATERIAL')) {
    const r = f.get(id)!;
    const m = r.args[5] instanceof Ref ? r.args[5].id : null;
    if (m !== null) for (const c of refs(r.args[4])) materialOf.set(c, m);
  }
  // IsExternal / LoadBearing: on the occurrence, else on its type, field by field
  const props = new Map<number, CommonProps>();
  const merge = (into: Map<number, CommonProps>, id: number, p: CommonProps) => {
    const cur = into.get(id) ?? { isExternal: null, loadBearing: null };
    if (p.isExternal !== null) cur.isExternal = p.isExternal;
    if (p.loadBearing !== null) cur.loadBearing = p.loadBearing;
    into.set(id, cur);
  };
  for (const id of f.idsOfType('IFCRELDEFINESBYPROPERTIES')) {
    const r = f.get(id)!;
    const p = readCommonPset(f, r.args[5]);
    if (p) for (const c of refs(r.args[4])) merge(props, c, p);
  }
  // a type carries its sets in HasPropertySets (IFC4 forbids relating a type through
  // IfcRelDefinesByProperties, though some IFC2x3 exporters do; both are read)
  const typeProps = new Map<number, CommonProps>();
  for (const t of new Set(typeOf.values())) {
    const fromRel = props.get(t);
    if (fromRel) merge(typeProps, t, fromRel);
    const te = f.get(t);
    for (const ps of te ? refs(te.args[5]) : []) {
      const p = readCommonPset(f, new Ref(ps));
      if (p) merge(typeProps, t, p);
    }
  }
  const propsOf = (id: number): CommonProps => {
    const own = props.get(id);
    const tp = typeOf.has(id) ? typeProps.get(typeOf.get(id)!) : undefined;
    return { isExternal: own?.isExternal ?? tp?.isExternal ?? null, loadBearing: own?.loadBearing ?? tp?.loadBearing ?? null };
  };

  // ── storeys ──
  const storeyIds = f.idsOfType('IFCBUILDINGSTOREY');
  const building = f.idsOfType('IFCBUILDING').map((id) => f.get(id)!)[0];
  const heights = storeyHeights(f, g, storeyIds.map((id) => f.get(id)!), building);
  const storeys: Storey[] = storeyIds
    .map((id, i) => {
      const s = f.get(id)!;
      return { id, name: str(s.args[2]) || str(s.args[7]) || `Storey ${id}`, elevation: heights[i] * L };
    })
    .sort((a, b) => a.elevation - b.elevation);
  const storeyIndex = new Map(storeys.map((s, i) => [s.id, i]));
  const storeyFor = (id: number): number => {
    for (let cur: number | undefined = id, guard = 0; cur !== undefined && guard < 64; guard++) {
      const si = storeyIndex.get(cur);
      if (si !== undefined) return si;
      const c: number | undefined = containerOf.get(cur);
      cur = c !== undefined ? c : parentOf.get(cur);
    }
    return -1;
  };

  // ── products ──
  const candidates: { id: number; type: string; category: Category }[] = [];
  for (const [type] of f.typeCounts()) {
    const category = categoryOf(type);
    if (!category) continue;
    for (const id of f.idsOfType(type)) candidates.push({ id, type, category });
  }
  // a container whose parts carry geometry is drawn through its parts
  const hasGeomChild = new Set<number>();
  for (const c of candidates) {
    const e = f.get(c.id)!;
    if (e.args[6] instanceof Ref) {
      const p = parentOf.get(c.id);
      if (p !== undefined) hasGeomChild.add(p);
    }
  }
  const candidateOf = new Map(candidates.map((c) => [c.id, c]));
  /** The element drawn through its parts that this one is a part of (not a site). */
  const skippedHostOf = (id: number) => {
    const p = parentOf.get(id);
    const host = p !== undefined && hasGeomChild.has(p) ? candidateOf.get(p) : undefined;
    return host && host.category !== 'site' ? host : undefined;
  };
  // openings of a host drawn through its parts are offered to every part, once each
  const hostOpenings = new Map<number, Mesh[]>();
  const hostPartMeshes = new Map<number, Mesh[]>();

  const raw: { el: Omit<ImportedElement, 'positions' | 'indices' | 'edges' | 'min' | 'max' | 'volume' | 'closed'>; mesh: Mesh }[] = [];
  const openingMisses = new Map<string, number>(); // host category → openings left uncut
  let openingsOutside = 0; // openings placed clear of their host (exporter quirks): nothing to cut
  const outsideHosts = new Set<string>(); // GlobalIds of those hosts
  let noGeometry = 0;
  let last = performance.now();
  for (let k = 0; k < candidates.length; k++) {
    const { id, type, category } = candidates[k];
    const e = f.get(id)!;
    if (hasGeomChild.has(id) && category !== 'site') continue;
    const rep = bodyRepresentation(f, e.args[6]);
    if (!rep) {
      if (category !== 'site') noGeometry++;
      continue;
    }
    const m = g.placement(e.args[5]);
    const allOps = (openingsOf.get(id) ?? []).map((oid) => openingMesh(f, g, oid));
    const host = skippedHostOf(id);
    let fromHost: Mesh[] = [];
    if (host && openingsOf.has(host.id)) {
      if (!hostOpenings.has(host.id)) hostOpenings.set(host.id, openingsOf.get(host.id)!.map((oid) => openingMesh(f, g, oid)));
      fromHost = hostOpenings.get(host.id)!;
    }
    const ops = [...allOps, ...fromHost].filter((o) => o.pos.length);
    const mesh = new Mesh();
    for (const it of refs(rep.args[3])) {
      mesh.beginShell();
      g.item(new Ref(it), m, mesh, ops);
    }
    if (host && fromHost.length) hostPartMeshes.set(host.id, [...(hostPartMeshes.get(host.id) ?? []), mesh]);
    // every opening of this element is cut by one of its items, lies clear of it, or is reported as not cut
    for (const o of allOps) {
      if (g.opened.has(o)) g.report.openingsCut++;
      else if (o.pos.length && !boxesTouch(o.pos, mesh.pos)) {
        openingsOutside++;
        outsideHosts.add(str(e.args[0]));
      }
      else {
        g.report.openingsSkipped++;
        openingMisses.set(category, (openingMisses.get(category) ?? 0) + 1);
      }
    }
    if (!mesh.idx.length) {
      noGeometry++;
      continue;
    }
    const op = fillsOpening.get(id);
    const layersOf = (x: number) => layersFor(f, materialOf.get(x) ?? (typeOf.has(x) ? materialOf.get(typeOf.get(x)!) : undefined), L);
    const el = {
      id,
      guid: str(e.args[0]),
      type,
      category,
      name: str(e.args[2]),
      objectType: str(e.args[4]),
      predefined: enumOf(e.args[8]),
      storey: storeyFor(id),
      parent: parentOf.get(id) ?? null,
      fills: op !== undefined ? openingHost.get(op) ?? null : null,
      layers: layersOf(id),
      ...propsOf(id),
    };
    // a part of a wall or slab (Revit Parts) is built as that wall or slab: it takes the
    // host's category and, where it has none of its own, the host's properties and layers
    if (host && type === 'IFCBUILDINGELEMENTPART' && host.category !== 'proxy') {
      const hp = propsOf(host.id);
      el.category = host.category;
      el.predefined ||= enumOf(f.get(host.id)!.args[8]);
      el.isExternal ??= hp.isExternal;
      el.loadBearing ??= hp.loadBearing;
      if (!el.layers.length) el.layers = layersOf(host.id);
    }
    raw.push({ el, mesh });
    if (performance.now() - last > 40) {
      onProgress('geometry', (k + 1) / candidates.length);
      await yieldToUi();
      last = performance.now();
    }
  }
  onProgress('geometry', 1);
  // a host's opening is cut if a part cut it; when it meets the parts but no part's material
  // fills it, the parts were exported with the void already in them
  for (const [hostId, ops] of hostOpenings) {
    const parts = hostPartMeshes.get(hostId) ?? [];
    const hostCategory = candidateOf.get(hostId)!.category;
    for (const o of ops) {
      if (g.opened.has(o)) g.report.openingsCut++;
      else if (o.pos.length && !parts.some((p) => boxesTouch(o.pos, p.pos))) {
        openingsOutside++;
        outsideHosts.add(str(f.get(hostId)!.args[0]));
      } else if (o.pos.length && !parts.some((p) => materialInBox(o.pos, p))) g.report.openingsCut++;
      else {
        g.report.openingsSkipped++;
        openingMisses.set(hostCategory, (openingMisses.get(hostCategory) ?? 0) + 1);
      }
    }
  }

  // inherit storey from the parent / filled element when the element has none
  const byId = new Map(raw.map((r) => [r.el.id, r.el]));
  for (const r of raw) {
    if (r.el.storey >= 0) continue;
    const host = r.el.parent ?? r.el.fills;
    if (host !== null) r.el.storey = byId.get(host)?.storey ?? storeyFor(host);
  }

  // ── to metres, app axes, recentred ──
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const r of raw) {
    if (r.el.category === 'site') continue;
    const p = r.mesh.pos;
    for (let i = 0; i < p.length; i += 3) {
      lo[0] = Math.min(lo[0], p[i]); hi[0] = Math.max(hi[0], p[i]);
      lo[1] = Math.min(lo[1], p[i + 1]); hi[1] = Math.max(hi[1], p[i + 1]);
      lo[2] = Math.min(lo[2], p[i + 2]); hi[2] = Math.max(hi[2], p[i + 2]);
    }
  }
  if (!Number.isFinite(lo[0])) throw new Error('No building elements with supported geometry were found in this file.');
  const cx = ((lo[0] + hi[0]) / 2) * L;
  const cy = ((lo[1] + hi[1]) / 2) * L;
  // Keep the file's height datum while the model starts near it (basements and footings below
  // 0 included). A model wholly above it, or far from it, has heights from a site datum (shared
  // or survey coordinates): bring its ground storey to 0, i.e. the lowest storey at or just above
  // the lowest geometry, passing over basement and foundation levels when a higher one is there.
  const loZ = lo[2] * L;
  let groundZ = 0;
  if (loZ > 1 || Math.abs(loZ) > 500) {
    const above = storeys.filter((s) => s.elevation >= loZ - 0.05);
    const ground = above.find((s) => !BELOW_GROUND.test(s.name)) ?? above[0];
    groundZ = ground?.elevation ?? loZ;
    const at = `${groundZ < 0 ? '−' : '+'}${Math.abs(groundZ).toFixed(2)} m`;
    warnings.push(`Heights in the file are measured from a site datum: ${ground ? ground.name : 'the lowest element'} is at ${at} there and is shown at 0.`);
  }
  if (groundZ) for (const s of storeys) s.elevation -= groundZ;
  if (Math.abs(cx) > 1e5 || Math.abs(cy) > 1e5) warnings.push('Model coordinates are georeferenced far from the origin; it has been recentred.');
  const toApp = (x: number, y: number, z: number): V3 => [x * L - cx, z * L - groundZ, -(y * L - cy)];

  const elements: ImportedElement[] = [];
  const site: ImportedElement[] = [];
  for (let k = 0; k < raw.length; k++) {
    const { el, mesh } = raw[k];
    const out = finishMesh(mesh, toApp);
    const done: ImportedElement = { ...el, ...out };
    (el.category === 'site' ? site : elements).push(done);
    if (k % 200 === 199) {
      onProgress('finish', (k + 1) / raw.length);
      await yieldToUi();
    }
  }
  onProgress('finish', 1);

  const byCategory: Record<string, number> = {};
  for (const e of elements) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
  const projectName = project ? str(project.args[7]) || str(project.args[2]) : '';
  const buildingName = building ? str(building.args[7]) || str(building.args[2]) : '';
  if (f.truncated) warnings.unshift('The file ends early (its data section is not closed): it looks truncated or partly downloaded, so elements are probably missing.');
  if (g.report.placementCycles) {
    const n = g.report.placementCycles;
    warnings.push(`${n} placement${n === 1 ? ' refers' : 's refer'} back to ${n === 1 ? 'itself' : 'themselves'} in a loop; the loop was broken and those elements may be out of place.`);
  }
  for (const [t, n] of g.report.unsupportedPlacements) {
    const kind = PLACEMENT_NAME[t] ?? t;
    warnings.push(`${n} placement${n === 1 ? '' : 's'} of type ${kind} could not be read; elements placed by ${n === 1 ? 'it' : 'them'} are drawn at the model origin.`);
  }
  if (!storeys.length) warnings.push('No storeys in the file: build order uses element heights only.');
  if (openingMisses.size) {
    const n = g.report.openingsSkipped;
    const where = [...openingMisses].map(([c, k]) => `${k} in ${c}`).join(', ');
    warnings.push(`${n} opening${n === 1 ? ' was' : 's were'} not cut (${where}); those elements keep their full volume.`);
  }
  if (openingsOutside) warnings.push(`${openingsOutside} opening${openingsOutside === 1 ? ' lies' : 's lie'} clear of ${openingsOutside === 1 ? 'its host' : 'their hosts'} and ${openingsOutside === 1 ? 'was' : 'were'} ignored.`);
  return {
    name: pickName([buildingName, projectName], fileName),
    projectName,
    projectGuid: project ? str(project.args[0]) : '',
    parents: new Map([...new Set(elements.map((e) => e.parent).filter((x): x is number => x !== null))].map((id) => [id, str(f.get(id)?.args[0] ?? '')] as [number, string])),
    storeys,
    elements,
    site,
    offset: [-cx, -groundZ, cy],
    report: {
      schema: f.header.schema,
      application: f.header.originatingSystem || appOf(f),
      entities: f.count,
      products: candidates.length,
      meshed: elements.length,
      noGeometry,
      byCategory,
      itemTypes: Object.fromEntries(g.report.items),
      skippedItems: Object.fromEntries(g.report.skipped),
      openingsCut: g.report.openingsCut,
      openingsSkipped: g.report.openingsSkipped,
      openingsOutside,
      openingsOutsideHosts: [...outsideHosts],
      clipsApplied: g.report.clipsApplied,
      booleansApproximated: g.report.booleansApproximated,
      lengthUnit: lengthName,
      truncated: f.truncated,
      warnings,
    },
  };
}

interface CommonProps {
  isExternal: boolean | null;
  loadBearing: boolean | null;
}

/** IsExternal and LoadBearing from a Pset_*Common property set, or null when it holds neither. */
function readCommonPset(f: StepFile, v: StepValue): CommonProps | null {
  const ps = f.deref(v);
  if (!ps || ps.type !== 'IFCPROPERTYSET' || !/^PSET_.*COMMON$/i.test(str(ps.args[2]))) return null;
  const out: CommonProps = { isExternal: null, loadBearing: null };
  for (const pid of refs(ps.args[4])) {
    const p = f.get(pid);
    if (!p || p.type !== 'IFCPROPERTYSINGLEVALUE') continue;
    const name = str(p.args[0]).toLowerCase();
    if (name === 'isexternal') out.isExternal = bool(p.args[2]);
    else if (name === 'loadbearing') out.loadBearing = bool(p.args[2]);
  }
  return out.isExternal === null && out.loadBearing === null ? null : out;
}

/**
 * Storey heights in the frame the geometry is placed in (world placements, file
 * units). When any storey placement sits at a height of its own above its parent,
 * the placements carry the levels and the elements hang from them: their world
 * heights are used. When every storey placement is left at its parent's height,
 * the level is only in Elevation, which is measured from the building, so it is
 * lifted by the height of that parent.
 */
function storeyHeights(f: StepFile, g: IfcGeometry, list: Entity[], building: Entity | undefined): number[] {
  const bz = building ? g.placement(building.args[5])[14] : 0;
  const rows = list.map((s) => {
    const ez = typeof s.args[9] === 'number' ? s.args[9] : null;
    const lp = f.deref(s.args[5]);
    if (!lp) return { ez, pz: null, parentZ: bz };
    const parentZ = lp.type === 'IFCLOCALPLACEMENT' && lp.args[0] instanceof Ref ? g.placement(lp.args[0])[14] : 0;
    return { ez, pz: g.placement(s.args[5])[14], parentZ };
  });
  const placed = rows.some((r) => r.pz !== null && Math.abs(r.pz - r.parentZ) > 1e-6 * (1 + Math.abs(r.ez ?? 0)));
  return rows.map(({ ez, pz, parentZ }) => (pz !== null && (placed || ez === null) ? pz : parentZ + (ez ?? 0)));
}

function appOf(f: StepFile): string {
  const a = f.idsOfType('IFCAPPLICATION').map((id) => f.get(id)!)[0];
  return a ? str(a.args[2]) : '';
}

const GENERIC_NAMES = /^(|default|project|project name|project number|unnamed|building|my project|0001|\d+)$/i;
function pickName(candidates: string[], fileName: string): string {
  for (const c of candidates) if (c && !GENERIC_NAMES.test(c.trim())) return c.trim();
  return fileName.replace(/\.ifc$/i, '').replace(/[_]+/g, ' ').trim() || 'Imported model';
}

function unitFactor(f: StepFile, u: Entity): number {
  if (u.type === 'IFCSIUNIT') return PREFIX[enumOf(u.args[2])] ?? 1;
  if (u.type === 'IFCCONVERSIONBASEDUNIT' || u.type === 'IFCCONVERSIONBASEDUNITWITHOFFSET') {
    const mw = f.deref(u.args[3]);
    if (!mw) return 1;
    const value = num(mw.args[0], 1);
    const base = f.deref(mw.args[1]);
    return value * (base ? unitFactor(f, base) : 1);
  }
  return 1;
}

/** The element's 3D body representation (Body, then any 3D type, then Box). */
function bodyRepresentation(f: StepFile, v: StepValue): Entity | null {
  const pds = f.deref(v);
  if (!pds) return null;
  const reps = refs(pds.args[2]).map((id) => f.get(id)).filter((r): r is Entity => !!r);
  const kind = (r: Entity) => ({ id: str(r.args[1]).toLowerCase(), type: str(r.args[2]).toLowerCase() });
  const solid = /sweptsolid|advancedsweptsolid|brep|advancedbrep|csg|clipping|surfacemodel|tessellation|mappedrepresentation|solidmodel|surface3d/;
  return (
    reps.find((r) => kind(r).id === 'body' && solid.test(kind(r).type)) ??
    reps.find((r) => kind(r).id === 'body') ??
    reps.find((r) => (kind(r).id === '' || kind(r).id === 'facetation') && solid.test(kind(r).type)) ??
    reps.find((r) => kind(r).type === 'boundingbox' || kind(r).id === 'box') ??
    null
  );
}

function openingMesh(f: StepFile, g: IfcGeometry, id: number): Mesh {
  const e = f.get(id);
  const mesh = new Mesh();
  if (!e) return mesh;
  const rep = bodyRepresentation(f, e.args[6]);
  if (!rep) return mesh;
  const m = g.placement(e.args[5]);
  for (const it of refs(rep.args[3])) g.item(new Ref(it), m, mesh);
  return mesh;
}

function layersFor(f: StepFile, v: number | undefined, L: number): Layer[] {
  if (v === undefined) return [];
  const e = f.get(v);
  if (!e) return [];
  const name = (m: StepValue) => {
    const me = f.deref(m);
    return me ? str(me.args[0]) : '';
  };
  switch (e.type) {
    case 'IFCMATERIAL':
      return [{ name: str(e.args[0]), thickness: 1 }];
    case 'IFCMATERIALLAYERSETUSAGE':
      return f.deref(e.args[0]) ? layersFor(f, (e.args[0] as Ref).id, L) : [];
    case 'IFCMATERIALLAYERSET':
      return refs(e.args[0])
        .map((id) => f.get(id))
        .filter((l): l is Entity => !!l)
        .map((l) => ({ name: name(l.args[0]), thickness: num(l.args[1]) * L }))
        .filter((l) => l.thickness > 0);
    case 'IFCMATERIALLIST':
      return refs(e.args[0]).map((id) => ({ name: name(new Ref(id)), thickness: 1 }));
    case 'IFCMATERIALCONSTITUENTSET':
      return refs(e.args[2])
        .map((id) => f.get(id))
        .filter((c): c is Entity => !!c)
        .map((c) => ({ name: name(c.args[2]) || str(c.args[0]), thickness: typeof c.args[3] === 'number' ? c.args[3] : 1 }));
    case 'IFCMATERIALPROFILESETUSAGE':
    case 'IFCMATERIALPROFILESETUSAGETAPERING':
      return e.args[0] instanceof Ref ? layersFor(f, e.args[0].id, L) : [];
    case 'IFCMATERIALPROFILESET':
      return refs(e.args[2])
        .map((id) => f.get(id))
        .filter((p): p is Entity => !!p)
        .map((p) => ({ name: name(p.args[2]) || str(p.args[0]), thickness: 1 }));
    default:
      return [];
  }
}

/** Convert, weld for edges/closure, measure. */
/**
 * Mark components that sit inside another closed component of the same shell
 * (bounding box nested, and a ray from one of its points crosses the other an odd
 * number of times). Odd nesting depth means a void.
 */
function findVoids(indices: number[], P: V3[], comp: Int32Array, triShell: number[], ncomp: number): Uint8Array {
  const nt = indices.length / 3;
  const lo = new Float64Array(ncomp * 3).fill(Infinity), hi = new Float64Array(ncomp * 3).fill(-Infinity);
  const tris: number[][] = Array.from({ length: ncomp }, () => []);
  const shellOf = new Int32Array(ncomp);
  for (let t = 0; t < nt; t++) {
    const c = comp[t];
    if (!tris[c].length) shellOf[c] = triShell[t];
    tris[c].push(t);
    for (let k = 0; k < 3; k++) {
      const p = P[indices[t * 3 + k]];
      for (let d = 0; d < 3; d++) {
        lo[c * 3 + d] = Math.min(lo[c * 3 + d], p[d]);
        hi[c * 3 + d] = Math.max(hi[c * 3 + d], p[d]);
      }
    }
  }
  const dir: V3 = [0.8017, 0.4523, 0.3906]; // an arbitrary direction, unlikely to graze an edge
  const crossings = (p: V3, c: number) => {
    let n = 0;
    for (const t of tris[c]) {
      const a = P[indices[t * 3]], b = P[indices[t * 3 + 1]], q = P[indices[t * 3 + 2]];
      const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2: V3 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
      const h: V3 = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
      const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
      if (Math.abs(det) < 1e-14) continue;
      const sv: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const u = (sv[0] * h[0] + sv[1] * h[1] + sv[2] * h[2]) / det;
      if (u < 0 || u > 1) continue;
      const qv: V3 = [sv[1] * e1[2] - sv[2] * e1[1], sv[2] * e1[0] - sv[0] * e1[2], sv[0] * e1[1] - sv[1] * e1[0]];
      const w = (dir[0] * qv[0] + dir[1] * qv[1] + dir[2] * qv[2]) / det;
      if (w < 0 || u + w > 1) continue;
      if ((e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det > 1e-9) n++;
    }
    return n;
  };
  const isVoid = new Uint8Array(ncomp);
  for (let c = 0; c < ncomp; c++) {
    if (!tris[c].length) continue;
    const p = P[indices[tris[c][0] * 3]];
    let depth = 0;
    for (let o = 0; o < ncomp; o++) {
      if (o === c || shellOf[o] !== shellOf[c] || !tris[o].length) continue;
      let inside = true;
      for (let d = 0; d < 3 && inside; d++) inside = lo[o * 3 + d] < lo[c * 3 + d] + 1e-6 && hi[o * 3 + d] > hi[c * 3 + d] - 1e-6;
      if (inside && hi[o * 3] - lo[o * 3] + hi[o * 3 + 1] - lo[o * 3 + 1] + hi[o * 3 + 2] - lo[o * 3 + 2] > hi[c * 3] - lo[c * 3] + hi[c * 3 + 1] - lo[c * 3 + 1] + hi[c * 3 + 2] - lo[c * 3 + 2] + 1e-6 && crossings(p, o) % 2 === 1) depth++;
    }
    isVoid[c] = depth % 2;
  }
  return isVoid;
}

/**
 * Does solid material of a closed mesh lie inside the bounding box of a point list?
 * Samples a 3 × 3 × 3 grid of points inside the box and tests each against the mesh
 * by ray parity.
 */
function materialInBox(box: number[], mesh: Mesh): boolean {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < box.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], box[i + k]);
      hi[k] = Math.max(hi[k], box[i + k]);
    }
  const P = mesh.pos, I = mesh.idx;
  const dir: V3 = [0.8017, 0.4523, 0.3906]; // an arbitrary direction, unlikely to graze an edge
  const inside = (p: V3) => {
    let n = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const e1: V3 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2: V3 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const h: V3 = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
      const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
      if (Math.abs(det) < 1e-14) continue;
      const sv: V3 = [p[0] - P[a], p[1] - P[a + 1], p[2] - P[a + 2]];
      const u = (sv[0] * h[0] + sv[1] * h[1] + sv[2] * h[2]) / det;
      if (u < 0 || u > 1) continue;
      const qv: V3 = [sv[1] * e1[2] - sv[2] * e1[1], sv[2] * e1[0] - sv[0] * e1[2], sv[0] * e1[1] - sv[1] * e1[0]];
      const w = (dir[0] * qv[0] + dir[1] * qv[1] + dir[2] * qv[2]) / det;
      if (w < 0 || u + w > 1) continue;
      if ((e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det > 1e-9) n++;
    }
    return n % 2 === 1;
  };
  for (const fx of [0.25, 0.5, 0.75])
    for (const fy of [0.25, 0.5, 0.75])
      for (const fz of [0.25, 0.5, 0.75]) if (inside([lo[0] + (hi[0] - lo[0]) * fx, lo[1] + (hi[1] - lo[1]) * fy, lo[2] + (hi[2] - lo[2]) * fz])) return true;
  return false;
}

/** Do the bounding boxes of two point lists overlap? */
function boxesTouch(a: number[], b: number[]): boolean {
  const box = (p: number[]) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k]);
        hi[k] = Math.max(hi[k], p[i + k]);
      }
    return { lo, hi };
  };
  const A = box(a), B = box(b);
  const tol = 1e-6 * Math.max(...[0, 1, 2].map((k) => Math.max(A.hi[k] - A.lo[k], B.hi[k] - B.lo[k])), 1);
  return [0, 1, 2].every((k) => A.lo[k] < B.hi[k] - tol && B.lo[k] < A.hi[k] - tol);
}

function finishMesh(mesh: Mesh, toApp: (x: number, y: number, z: number) => V3) {
  const n = mesh.pos.length / 3;
  const positions = new Float32Array(mesh.pos.length);
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  const P: V3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = toApp(mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]);
    P[i] = p;
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  // the axis change (x, z, −y) is a rotation, so winding and handedness are preserved
  // weld vertices to find shared edges
  const keyOf = new Map<string, number>();
  const weld = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const p = P[i];
    const k = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
    let w = keyOf.get(k);
    if (w === undefined) {
      w = keyOf.size;
      keyOf.set(k, w);
    }
    weld[i] = w;
  }
  const idx = mesh.idx;
  const W = keyOf.size + 1;
  const firstPass = (keepFlat: boolean) => {
    const triN: V3[] = [];
    let vol = 0;
    let areaSum = 0;
    const edgeTris = new Map<number, number[]>(); // per shell: closedness and winding
    const pairTris = new Map<number, number[]>(); // across shells: feature lines
    const indices: number[] = [];
    const triShell: number[] = [];
    const flat: number[] = []; // zero-area triangles
    let shell = 0;
    for (let t = 0; t < idx.length; t += 3) {
      while (shell < mesh.shells.length && mesh.shells[shell] <= t) shell++;
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const wa = weld[a], wb = weld[b], wc = weld[c];
      if (wa === wb || wb === wc || wa === wc) continue; // degenerate
      const pa = P[a], pb = P[b], pc = P[c];
      const u: V3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const v: V3 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
      const nl = Math.hypot(nx, ny, nz);
      // three distinct but collinear points: no area, but the edges may pair up a T-junction
      const isFlat = nl <= 1e-10 * Math.max(u[0] ** 2 + u[1] ** 2 + u[2] ** 2, v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
      if (isFlat && !keepFlat) continue;
      const ti = triN.length;
      if (isFlat) {
        flat.push(ti);
        triN.push([0, 0, 0]);
      } else triN.push([nx / nl, ny / nl, nz / nl]);
      areaSum += nl / 2;
      vol += (pa[0] * (pb[1] * pc[2] - pb[2] * pc[1]) - pa[1] * (pb[0] * pc[2] - pb[2] * pc[0]) + pa[2] * (pb[0] * pc[1] - pb[1] * pc[0])) / 6;
      indices.push(a, b, c);
      triShell.push(shell);
      for (const [x, y] of [[wa, wb], [wb, wc], [wc, wa]]) {
        const key = (shell * W + Math.min(x, y)) * W + Math.max(x, y);
        const list = edgeTris.get(key);
        if (list) list.push(ti);
        else edgeTris.set(key, [ti]);
        const pk = Math.min(x, y) * W + Math.max(x, y);
        const pl = pairTris.get(pk);
        if (pl) pl.push(ti);
        else pairTris.set(pk, [ti]);
      }
    }
    let closed = edgeTris.size > 0;
    let boundary = 0;
    for (const list of edgeTris.values()) if (list.length !== 2) {
      closed = false;
      if (list.length === 1) boundary++;
    }
    return { triN, vol, areaSum, edgeTris, pairTris, indices, triShell, flat, closed, boundary };
  };
  // zero-area triangles from a file usually close T-junctions; where both faces along a straight
  // run carry one they double the edge up instead, and the mesh closes without them
  let fp = firstPass(true);
  if (!fp.closed && fp.flat.length) {
    const alt = firstPass(false);
    if (alt.closed) fp = alt;
  }
  const { triN, areaSum, edgeTris, pairTris, indices, triShell, flat, boundary } = fp;
  let { vol, closed } = fp;
  // make the winding consistent across shared edges (exporters mix face orientations)
  const nt = indices.length / 3;
  if (closed && nt) {
    const wkey = (t: number, x: number, y: number) => (triShell[t] * W + Math.min(x, y)) * W + Math.max(x, y);
    const dirOf = (t: number, x: number, y: number) => {
      const a = weld[indices[t * 3]], b = weld[indices[t * 3 + 1]], c = weld[indices[t * 3 + 2]];
      return (a === x && b === y) || (b === x && c === y) || (c === x && a === y) ? 1 : -1;
    };
    const state = new Int8Array(nt); // 0 unvisited, 1 keep, −1 flip
    const comp = new Int32Array(nt).fill(-1);
    let ncomp = 0;
    let ok = true;
    for (let seed = 0; seed < nt && ok; seed++) {
      if (state[seed]) continue;
      state[seed] = 1;
      comp[seed] = ncomp;
      const stack = [seed];
      while (stack.length && ok) {
        const t = stack.pop()!;
        const v = [weld[indices[t * 3]], weld[indices[t * 3 + 1]], weld[indices[t * 3 + 2]]];
        for (let k = 0; k < 3; k++) {
          const x = v[k], y = v[(k + 1) % 3];
          const list = edgeTris.get(wkey(t, x, y))!;
          const other = list[0] === t ? list[1] : list[0];
          // effective direction of this edge in t, and what the neighbour needs to be
          const dt = dirOf(t, x, y) * state[t];
          const needed = (-dt * dirOf(other, x, y)) as 1 | -1;
          if (!state[other]) {
            state[other] = needed;
            comp[other] = ncomp;
            stack.push(other);
          } else if (state[other] !== needed) ok = false; // not orientable
        }
      }
      ncomp++;
    }
    if (!ok) closed = false;
    else {
      // apply the propagated winding, then turn each separate shell outward on its own
      const compVol = new Float64Array(ncomp);
      for (let t = 0; t < nt; t++) {
        if (state[t] < 0) {
          const tmp = indices[t * 3 + 1];
          indices[t * 3 + 1] = indices[t * 3 + 2];
          indices[t * 3 + 2] = tmp;
        }
        const pa = P[indices[t * 3]], pb = P[indices[t * 3 + 1]], pc = P[indices[t * 3 + 2]];
        compVol[comp[t]] += (pa[0] * (pb[1] * pc[2] - pb[2] * pc[1]) - pa[1] * (pb[0] * pc[2] - pb[2] * pc[0]) + pa[2] * (pb[0] * pc[1] - pb[1] * pc[0])) / 6;
      }
      // a component enclosed by another one of the same item is a void (IfcFacetedBrepWithVoids):
      // it winds inward and its volume counts negative
      const isVoid = ncomp > 1 ? findVoids(indices, P, comp, triShell, ncomp) : new Uint8Array(ncomp);
      vol = 0;
      for (let t = 0; t < nt; t++) {
        if (compVol[comp[t]] < 0 !== (isVoid[comp[t]] === 1)) {
          const tmp = indices[t * 3 + 1];
          indices[t * 3 + 1] = indices[t * 3 + 2];
          indices[t * 3 + 2] = tmp;
        }
      }
      for (let c = 0; c < ncomp; c++) vol += isVoid[c] ? -Math.abs(compVol[c]) : Math.abs(compVol[c]);
    }
  }
  // flip inside-out closed meshes
  if (closed && vol < 0) {
    for (let t = 0; t < indices.length; t += 3) {
      const tmp = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = tmp;
    }
    vol = -vol;
  }
  const boxVol0 = (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
  if (closed && vol > boxVol0 * 1.05) closed = false; // self-overlapping shells: not a usable solid
  // feature edges
  const rep = new Map<number, number>(); // welded id → a representative vertex
  for (let i = 0; i < n; i++) if (!rep.has(weld[i])) rep.set(weld[i], i);
  const edges: number[] = [];
  if (mesh.explicitEdges && mesh.edges.length) {
    for (let i = 0; i < mesh.edges.length; i += 3) {
      const p = toApp(mesh.edges[i], mesh.edges[i + 1], mesh.edges[i + 2]);
      edges.push(p[0], p[1], p[2]);
    }
  } else {
    const cosLimit = Math.cos((25 * Math.PI) / 180);
    // normals of the final winding (the repair above may have flipped triangles)
    const isFlat = new Uint8Array(triN.length);
    for (const t of flat) isFlat[t] = 1;
    for (let t = 0; t < triN.length; t++) {
      if (isFlat[t]) continue;
      const pa = P[indices[t * 3]], pb = P[indices[t * 3 + 1]], pc = P[indices[t * 3 + 2]];
      const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2], vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      triN[t] = [nx / nl, ny / nl, nz / nl];
    }
    // a flat triangle takes the normal of the face across its longest edge
    for (const t of flat) {
      const w = [weld[indices[t * 3]], weld[indices[t * 3 + 1]], weld[indices[t * 3 + 2]]];
      const v = [P[indices[t * 3]], P[indices[t * 3 + 1]], P[indices[t * 3 + 2]]];
      let best = -1, bk = 0;
      for (let k = 0; k < 3; k++) {
        const p = v[k], q = v[(k + 1) % 3];
        const l = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
        if (l > best) {
          best = l;
          bk = k;
        }
      }
      const x = w[bk], y = w[(bk + 1) % 3];
      const other = pairTris.get(Math.min(x, y) * W + Math.max(x, y))?.find((o) => o !== t && !isFlat[o]);
      if (other !== undefined) triN[t] = triN[other];
    }
    const dotN = (i: number, j: number) => triN[i][0] * triN[j][0] + triN[i][1] * triN[j][1] + triN[i][2] * triN[j][2];
    for (const [key, list] of pairTris) {
      let rest = list;
      if (list.length > 2) {
        // pieces of one solid that touch back to back (boolean pieces) hide the faces between them
        rest = list.slice();
        for (let i = 0; i < rest.length; i++) {
          const j = rest.findIndex((o, k) => k > i && triShell[o] !== triShell[rest[i]] && dotN(o, rest[i]) < -0.9999);
          if (j < 0) continue;
          rest.splice(j, 1);
          rest.splice(i, 1);
          i--;
        }
      }
      const feature = rest.length === 0 ? false : rest.length === 2 ? dotN(rest[0], rest[1]) < cosLimit : true;
      if (!feature) continue;
      const x = Math.floor(key / W), y = key % W;
      const p = P[rep.get(x)!], q = P[rep.get(y)!];
      edges.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    }
  }
  // open shells: the signed volume is a fair estimate only when they are nearly closed
  const boxVol = (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
  const nearlyClosed = edgeTris.size > 0 && boundary / edgeTris.size < 0.04;
  const volume = closed ? vol : nearlyClosed && Math.abs(vol) > 0 && Math.abs(vol) <= boxVol * 1.05 ? Math.abs(vol) : Math.min(areaSum * 0.02, boxVol);
  return { positions, indices: Uint32Array.from(indices), edges: Float32Array.from(edges), min, max, volume: Math.max(0, volume), closed };
}
