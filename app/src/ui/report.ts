/**
 * The import report in words: which elements had their material assumed and
 * what that does to mass and carbon, the message after a load, and why a load
 * failed in terms of what to do next. Pure, so they are tested without a page.
 */
import { partFootprint } from '../data/assemble';
import type { Project } from '../data/types';
import { fmtInt } from '../engine/timeline';

/** The elements whose material was assumed, and the share of the model's mass and carbon resting on them. */
export interface DefaultedSummary {
  /** Elements with an assumed material. */
  count: number;
  /** Elements in the model. */
  of: number;
  /** Their parts (indices into project.parts), to show on the model. */
  parts: number[];
  /** Shares (0–1) of the model's mass and A1–A3 carbon on those parts. */
  massShare: number;
  carbonShare: number;
  /** IFC types, most common first. */
  byType: [string, number][];
}

/**
 * The defaulted materials of an imported model, from the parts flagged
 * `ref.defaulted` and the report's list (matched by GlobalId); null when every
 * material came from the file.
 */
export function defaultedSummary(p: Pick<Project, 'parts' | 'report' | 'density'>): DefaultedSummary | null {
  const listed = (p.report?.defaultedElements ?? []) as { guid: string }[];
  const guids = new Set(listed.map((e) => e.guid));
  const parts: number[] = [];
  const elements = new Set<string>();
  const types = new Map<string, number>();
  let of = 0;
  let kg = 0, co2 = 0, kgAll = 0, co2All = 0;
  p.parts.forEach((pt, i) => {
    if (!pt.ref) return;
    of++;
    const fp = partFootprint(pt, p.density);
    kgAll += fp.kg;
    co2All += fp.co2;
    if (!pt.ref.defaulted && !guids.has(pt.ref.guid)) return;
    parts.push(i);
    kg += fp.kg;
    co2 += fp.co2;
    if (!elements.has(pt.ref.guid)) {
      elements.add(pt.ref.guid);
      types.set(pt.ref.ifcType, (types.get(pt.ref.ifcType) ?? 0) + 1);
    }
  });
  const count = Math.max(elements.size, listed.length, Number(p.report?.defaultedMaterials) || 0);
  if (!count) return null;
  return {
    count,
    of: Math.max(of, count),
    parts,
    massShare: kgAll > 0 ? kg / kgAll : 0,
    carbonShare: co2All > 0 ? co2 / co2All : 0,
    byType: [...types.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

/** A share as a whole percentage, never "0 %" for something that is there. */
const pct = (share: number) => (share > 0 && share < 0.005 ? '< 1' : String(Math.round(share * 100)));

/** Words that IFC element class names are made of, longest first, to write them as the schema does. */
const IFC_WORDS = (
  'WALL STANDARD CASE SLAB BEAM COLUMN DOOR WINDOW ROOF STAIR RAMP FLIGHT RAILING COVERING CURTAIN PLATE MEMBER FOOTING PILE ' +
  'BUILDING ELEMENT PROXY PART ASSEMBLY FURNISHING FURNITURE SYSTEM CHIMNEY SHADING DEVICE DISCRETE ACCESSORY MECHANICAL FASTENER ' +
  'REINFORCING BAR MESH TENDON TRANSPORT GEOGRAPHIC FLOW TERMINAL SEGMENT FITTING CONTROLLER STORAGE MOVING TREATMENT ' +
  'DISTRIBUTION CONTROL ENERGY CONVERSION SANITARY LIGHT FIXTURE PIPE DUCT CABLE CARRIER AIR ELECTRIC APPLIANCE OUTLET'
)
  .split(' ')
  .sort((a, b) => b.length - a.length);

/** An IFC class as the schema writes it (IFCWALLSTANDARDCASE reads IfcWallStandardCase); a name it cannot split is left as it is. */
export function ifcName(t: string): string {
  if (!/^IFC[A-Z]+$/.test(t)) return t;
  let rest = t.slice(3);
  let out = 'Ifc';
  while (rest) {
    const w = IFC_WORDS.find((x) => rest.startsWith(x));
    if (!w) return t;
    out += w[0] + w.slice(1).toLowerCase();
    rest = rest.slice(w.length);
  }
  return out;
}

/** The import drawer's warning about assumed materials: what happened, what it does to the figures, what to do. */
export function defaultedText(s: DefaultedSummary): { head: string; body: string; types: string } {
  const n = fmtInt(s.count);
  return {
    head: `${n} of ${fmtInt(s.of)} ${s.of === 1 ? 'element has' : 'elements have'} an assumed material (${pct(s.count / Math.max(1, s.of))} %)`,
    body:
      `The file gives ${s.count === 1 ? 'it' : 'them'} no material that could be recognised, so ${s.count === 1 ? 'it was' : 'each was'} given a default for its type. ` +
      `About ${pct(s.massShare)} % of the mass and ${pct(s.carbonShare)} % of the carbon rest on those defaults, and so do crane loads. ` +
      'Assign materials in your BIM tool and export again to firm them up.',
    // each type and its count kept on one line
    types: s.byType.slice(0, 4).map(([t, k]) => `${ifcName(t)}\u00a0×\u00a0${k}`).join(' · ') + (s.byType.length > 4 ? ` · ${s.byType.length - 4} more ${s.byType.length - 4 === 1 ? 'type' : 'types'}` : ''),
  };
}

/** The message after a model loads, and whether it is a warning (the file was cut off). */
export function loadedMessage(fileName: string, elements: number, seconds: number, report: { truncated?: boolean; defaultedMaterials?: number } | undefined): { text: string; kind: 'info' | 'warn' } {
  if (report?.truncated) {
    return { text: `Loaded ${fileName}, but the file ends early, so elements are probably missing. Open Import for details, or download or export the file again.`, kind: 'warn' };
  }
  const assumed = Number(report?.defaultedMaterials) || 0;
  return {
    text: `Loaded ${fileName} · ${fmtInt(elements)} elements · ${seconds.toFixed(1)} s${assumed ? ` · ${fmtInt(assumed)} with an assumed material (see Import)` : ''}`,
    kind: 'info',
  };
}

/** Whether IFC text stops before its closing END-ISO-10303-21 line: a cut-off download or copy. */
export function endsEarly(text: string): boolean {
  return !/END-ISO-10303-21\s*;/i.test(text.slice(-4096));
}

/** Where a load failed: opening the file, reading it as IFC, or fetching the sample. */
export type LoadStage = 'open' | 'read' | 'sample';

/**
 * Why a load failed, for people rather than developers: `message` says what
 * happened and what to do; `detail` keeps the error itself for a support
 * request (shown folded away, never as the message).
 */
export function importError(fileName: string, err: unknown, stage: LoadStage = 'read', cutOff = false): { message: string; detail: string } {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? 'unknown error');
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const say = (message: string) => ({ message, detail });
  if (stage === 'sample') {
    const status = /HTTP (\d{3})/.exec(raw)?.[1];
    return say(`The Duplex sample could not be downloaded${status ? ` (the server answered ${status})` : ''}. Check your connection and try again.`);
  }
  if (stage === 'open') return say(`${fileName} could not be opened. It may have been moved or renamed, or still be downloading or syncing. Check the file and choose it again.`);
  if (err instanceof RangeError || /out of memory|allocation failed|invalid (array|string) length/i.test(raw)) {
    return say(`${fileName} is too large to read in this browser tab. Close other tabs and try again, or export a smaller part of the model (one building or a few storeys).`);
  }
  if (/no DATA section|not an IFC file/i.test(raw)) {
    return say(`${fileName} is not an IFC file: it has no IFC data in it. Export the model from your BIM tool as IFC (IFC2x3 or IFC4) and open that file.`);
  }
  if (cutOff) {
    return say(`${fileName} ends early, so it looks cut off (a broken download or copy) and could not be read. Download or export it again and open the new copy.`);
  }
  if (/no building elements/i.test(raw)) {
    return say(`${fileName} has no building elements that can be drawn. It may hold only spaces, a site or annotation, or shapes this viewer does not support yet. Check what your BIM tool exports to IFC and try again.`);
  }
  return say(`${fileName} could not be read: part of it is in a form this viewer does not support yet. Try exporting it again from your BIM tool; if it still fails, the technical detail under Import says what went wrong.`);
}
