/**
 * The buildability rules. Each one reads the project and its check scene and
 * returns issues plus a count of what it evaluated, so that a rule with
 * nothing to check reads as unverified rather than passed.
 */
import { MATERIAL_INFO, type Project, type Vec3 } from '../data/types';
import { partMassKg } from '../data/assemble';
import type { CheckScene, Obb } from './scene';
import type { CheckSettings, Issue, RuleResult, Severity } from './types';

export type Draft = Omit<Issue, 'id'>;
export interface RuleOutput {
  issues: Draft[];
  result: Omit<RuleResult, 'id' | 'flagged'>;
}
/** Long rules hand control back to the page between chunks. */
export type Yield = () => Promise<void>;

const fmtM = (m: number) => `${m.toFixed(2)} m`;
const fmtMm = (m: number) => `${Math.round(m * 1000)} mm`;
const fmtKg = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg)} kg`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A readable name: the element's family and type and its id for imported parts, the step for generated ones. */
export function partLabel(p: Project, i: number): string {
  const part = p.parts[i];
  if (part.ref) {
    const segs = part.ref.name.split(':').map((x) => x.trim()).filter(Boolean);
    const id = segs.length > 1 && /^\d+$/.test(segs[segs.length - 1]) ? segs.pop()! : '';
    const uniq = segs.filter((x, k) => x !== segs[k - 1]);
    const name = uniq.length ? uniq.slice(-2).join(' · ') : part.ref.ifcType;
    return id ? `${name} #${id}` : name;
  }
  const step = p.steps[part.step];
  const tail = step?.member.split(' · ').slice(1).join(' · ') || step?.member || 'part';
  const lvl = step?.member.split(' · ')[0] ?? '';
  return `${MATERIAL_INFO[part.mat].label.split(' ·')[0]} · ${lvl ? `${lvl} ` : ''}${tail.toLowerCase()}`.replace(/\s+/g, ' ');
}

function unionBox(S: CheckScene, parts: number[], pad = 0.5): [Vec3, Vec3] {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const i of parts)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], S.min[i * 3 + k] - pad);
      hi[k] = Math.max(hi[k], S.max[i * 3 + k] + pad);
    }
  return [lo, hi];
}

const planOverlap = (S: CheckScene, i: number, j: number, tol: number) =>
  S.max[j * 3] >= S.min[i * 3] - tol && S.min[j * 3] <= S.max[i * 3] + tol && S.max[j * 3 + 2] >= S.min[i * 3 + 2] - tol && S.min[j * 3 + 2] <= S.max[i * 3 + 2] + tol;

const bottomOf = (S: CheckScene, i: number) => S.min[i * 3 + 1];
const topOf = (S: CheckScene, i: number) => S.max[i * 3 + 1];

/** Groups issue subjects by step so a step with many pieces raises one issue. */
function byStep<T>(items: { step: number; v: T }[]): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const { step, v } of items) {
    const list = m.get(step);
    if (list) list.push(v);
    else m.set(step, [v]);
  }
  return new Map([...m.entries()].sort((a, b) => a[0] - b[0]));
}

const stepName = (p: Project, s: number) => `step ${p.steps[s]?.id ?? '—'}`;

// ── ORDER-SUPPORT and TEMP-PROPS ─────────────────────────────────────────────

const NOT_CARRYING = new Set(['window', 'door', 'railing', 'furniture', 'landscape', 'setout', 'pv']);

/**
 * What a part bears on: elements in plan contact that reach its underside.
 * Ground-level parts only count supports directly beneath them (they can also
 * stand on the ground); higher parts also count elements that run past their
 * underside (a floor framed into the walls).
 */
function supportsOf(S: CheckScene, i: number): number[] {
  const yb = bottomOf(S, i);
  const structural = S.role[i] === 'structure';
  const lo: Vec3 = [S.min[i * 3] - 0.05, yb - 0.1, S.min[i * 3 + 2] - 0.05];
  const hi: Vec3 = [S.max[i * 3] + 0.05, yb + 0.05, S.max[i * 3 + 2] + 0.05];
  const ground = yb <= 0.05;
  const out: number[] = [];
  for (const j of S.query(lo, hi)) {
    if (j === i || NOT_CARRYING.has(S.cat[j])) continue;
    if (structural ? S.role[j] !== 'structure' : S.role[j] === 'setout' || S.role[j] === 'landscape') continue;
    const jb = bottomOf(S, j), jt = topOf(S, j);
    if (jb >= yb + 0.02 || jt < yb - 0.05) continue;
    if (ground && jt > yb + 0.05) continue; // beside, not beneath
    if (!planOverlap(S, i, j, 0.05)) continue;
    out.push(j);
  }
  return out;
}

export function checkSupport(S: CheckScene, st: CheckSettings): { order: RuleOutput; props: RuleOutput } {
  void st;
  const p = S.project;
  const late: { step: number; v: { i: number; first: number[] } }[] = [];
  const floating: { step: number; v: number }[] = [];
  const props: { step: number; v: { i: number; wait: number[] } }[] = [];
  let checked = 0;
  let spans = 0;
  for (let i = 0; i < S.n; i++) {
    const role = S.role[i];
    if (role === 'setout' || role === 'landscape') continue;
    checked++;
    const sup = supportsOf(S, i);
    if (!sup.length) {
      // ceilings and soffits hang from the floor above
      if (S.cat[i] === 'covering') continue;
      if (bottomOf(S, i) > 0.05 && role === 'structure') floating.push({ step: S.step[i], v: i });
      continue;
    }
    const before = sup.filter((j) => S.step[j] <= S.step[i]);
    if (!before.length) {
      const first = sup.filter((j) => S.step[j] === Math.min(...sup.map((k) => S.step[k])));
      late.push({ step: S.step[i], v: { i, first } });
      continue;
    }
    // a beam or slab spanning between supports: are both ends carried when it goes in?
    const cat = S.cat[i];
    if (role !== 'structure' || !(cat === 'beam' || cat === 'slab' || cat === 'roof' || cat === 'member')) continue;
    const ex = S.max[i * 3] - S.min[i * 3], ez = S.max[i * 3 + 2] - S.min[i * 3 + 2], ey = S.max[i * 3 + 1] - S.min[i * 3 + 1];
    const k = ex >= ez ? 0 : 2;
    const L = Math.max(ex, ez);
    if (L < 3 * ey || L < 1) continue;
    spans++;
    const a0 = S.min[i * 3 + k], a1 = S.max[i * 3 + k];
    const margin = Math.max(0.3, 0.2 * L);
    const ends = (list: number[]) => {
      let lo = false, hi = false;
      for (const j of list) {
        const s0 = Math.max(a0, S.min[j * 3 + k]), s1 = Math.min(a1, S.max[j * 3 + k]);
        if (s1 < s0) continue;
        if (s0 <= a0 + margin) lo = true;
        if (s1 >= a1 - margin) hi = true;
      }
      return lo && hi;
    };
    if (ends(sup) && !ends(before)) props.push({ step: S.step[i], v: { i, wait: sup.filter((j) => S.step[j] > S.step[i]) } });
  }
  const order: Draft[] = [];
  for (const [s, list] of byStep(late)) {
    const parts = list.map((x) => x.i);
    const first = [...new Set(list.flatMap((x) => x.first))];
    const firstStep = Math.min(...first.map((j) => S.step[j]));
    const names = parts.slice(0, 3).map((i) => partLabel(p, i)).join(', ') + (parts.length > 3 ? ` and ${parts.length - 3} more` : '');
    order.push({
      rule: 'ORDER-SUPPORT',
      severity: 'critical',
      title: `${plural(parts.length, 'piece')} placed before ${parts.length === 1 ? 'its' : 'their'} support`,
      detail: `${names} go in at ${stepName(p, s)}, but what ${parts.length === 1 ? 'it bears' : 'they bear'} on — ${partLabel(p, first[0])}${first.length > 1 ? ` and ${first.length - 1} more` : ''} — only arrives at ${stepName(p, firstStep)}.`,
      action: `Move these pieces after ${stepName(p, firstStep)}, or design temporary support for them.`,
      primary: parts,
      secondary: first,
      step: s,
      at: centreOf(S, parts),
      box: unionBox(S, [...parts, ...first]),
      lines: [],
    });
  }
  for (const [s, list] of byStep(floating)) {
    order.push({
      rule: 'ORDER-SUPPORT',
      severity: 'major',
      title: `${plural(list.length, 'structural piece')} with nothing to bear on`,
      detail: `${list.slice(0, 3).map((i) => partLabel(p, i)).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''} sit${list.length === 1 ? 's' : ''} above ground with no structural element beneath or beside ${list.length === 1 ? 'it' : 'them'} in the model.`,
      action: 'Check the model for a missing support, or confirm the cantilever or hanger design.',
      primary: list,
      secondary: [],
      step: s,
      at: centreOf(S, list),
      box: unionBox(S, list),
      lines: [],
    });
  }
  const propIssues: Draft[] = [];
  for (const [s, list] of byStep(props)) {
    const parts = list.map((x) => x.i);
    const wait = [...new Set(list.flatMap((x) => x.wait))];
    const until = Math.max(...wait.map((j) => S.step[j]));
    propIssues.push({
      rule: 'TEMP-PROPS',
      severity: 'major',
      title: `Prop ${plural(parts.length, 'span')} until ${stepName(p, until)}`,
      detail: `${parts.slice(0, 3).map((i) => partLabel(p, i)).join(', ')}${parts.length > 3 ? ` and ${parts.length - 3} more` : ''} go in at ${stepName(p, s)} with only one end carried; the other support (${partLabel(p, wait[0])}${wait.length > 1 ? ` and ${wait.length - 1} more` : ''}) follows by ${stepName(p, until)}.`,
      action: `Design temporary props for ${stepName(p, s)} to ${stepName(p, until)}, or place the second support first.`,
      primary: parts,
      secondary: wait,
      step: s,
      at: centreOf(S, parts),
      box: unionBox(S, [...parts, ...wait]),
      lines: [],
    });
  }
  return {
    order: { issues: order, result: { checked, applicable: checked > 0, note: `${checked} pieces checked against what they bear on` } },
    props: { issues: propIssues, result: { checked: spans, applicable: spans > 0, note: spans ? `${spans} beams and slabs checked for support at both ends` : 'no spanning beams or slabs' } },
  };
}

function centreOf(S: CheckScene, parts: number[]): Vec3 {
  const [lo, hi] = unionBox(S, parts, 0);
  return [(lo[0] + hi[0]) / 2, hi[1], (lo[2] + hi[2]) / 2];
}

// ── REACH-CRANE ──────────────────────────────────────────────────────────────

export function checkCrane(S: CheckScene, st: CheckSettings): RuleOutput {
  const p = S.project;
  const c = p.crane;
  let picks = 0;
  const issues: Draft[] = [];
  for (const s of p.steps) {
    if (s.method !== 'crane' || !s.partCount) continue;
    let worst: { i: number; util: number; r: number; kg: number; cap: number } | null = null;
    for (let i = s.partStart; i < s.partStart + s.partCount; i++) {
      const part = p.parts[i];
      if (MATERIAL_INFO[part.mat].bulk) continue;
      picks++;
      const r = Math.hypot(part.pos[0] - c.base[0], part.pos[2] - c.base[2]);
      const kg = partMassKg(part, p.density) + st.riggingKg;
      const cap = r > c.jib ? 0 : c.capacityAt(r);
      const util = cap > 0 ? kg / cap : Infinity;
      if (!worst || util > worst.util) worst = { i, util, r, kg, cap };
    }
    if (!worst || worst.util < st.craneWarn) continue;
    const over = worst.util > 1;
    const beyond = worst.cap <= 0;
    const tip: Vec3 = [p.parts[worst.i].pos[0], topOf(S, worst.i) + 0.5, p.parts[worst.i].pos[2]];
    issues.push({
      rule: 'REACH-CRANE',
      severity: over ? 'critical' : 'major',
      title: beyond ? `${partLabel(p, worst.i)} is beyond the jib` : `${partLabel(p, worst.i)} at ${Math.round(worst.util * 100)} % of the chart`,
      detail: beyond
        ? `At ${fmtM(worst.r)} from the mast it is past the ${c.jib} m jib of ${c.id}.`
        : `${fmtKg(worst.kg)} at ${worst.r.toFixed(1)} m radius against ${fmtKg(worst.cap)} on ${c.id}'s indicative chart${st.riggingKg ? ` (incl. ${st.riggingKg} kg rigging)` : ''}.`,
      action: over ? 'Split the piece, move the pick closer to the mast, or bring in a larger or mobile crane.' : 'Plan this lift: confirm weight, rigging and wind limits with the crane supplier.',
      primary: [worst.i],
      secondary: [],
      step: s.index,
      at: tip,
      box: unionBox(S, [worst.i], 2),
      lines: [[[c.base[0], tip[1], c.base[2]], tip]],
      value: worst.util,
      limit: 1,
      unit: 'utilisation',
    });
  }
  return { issues, result: { checked: picks, applicable: picks > 0, note: picks ? `${picks} crane picks against ${c.id}'s chart` : 'no crane picks' } };
}

// ── REACH-PATH ───────────────────────────────────────────────────────────────

export function checkLiftPath(S: CheckScene, st: CheckSettings): RuleOutput {
  void st;
  const p = S.project;
  const blocked: { step: number; v: { i: number; by: number } }[] = [];
  let picks = 0;
  const topAll = Math.max(...Array.from({ length: S.n }, (_, i) => S.max[i * 3 + 1]));
  for (const s of p.steps) {
    if (s.method !== 'crane') continue;
    for (let i = s.partStart; i < s.partStart + s.partCount; i++) {
      if (MATERIAL_INFO[p.parts[i].mat].bulk) continue;
      picks++;
      const it = topOf(S, i);
      const lo: Vec3 = [S.min[i * 3] + 0.05, it - 0.05, S.min[i * 3 + 2] + 0.05];
      const hi: Vec3 = [S.max[i * 3] - 0.05, topAll + 1, S.max[i * 3 + 2] - 0.05];
      if (lo[0] > hi[0] || lo[2] > hi[2]) continue;
      const area = (S.max[i * 3] - S.min[i * 3]) * (S.max[i * 3 + 2] - S.min[i * 3 + 2]);
      let by = -1;
      for (const j of S.query(lo, hi)) {
        if (j === i || S.step[j] >= S.step[i] || S.role[j] === 'setout') continue;
        if (bottomOf(S, j) < it - 0.05) continue;
        const ox = Math.min(S.max[i * 3], S.max[j * 3]) - Math.max(S.min[i * 3], S.min[j * 3]);
        const oz = Math.min(S.max[i * 3 + 2], S.max[j * 3 + 2]) - Math.max(S.min[i * 3 + 2], S.min[j * 3 + 2]);
        if (ox < 0.3 || oz < 0.3 || ox * oz < 0.1 * area) continue;
        // confirm with vertical rays through the overlap: the blocker really is overhead
        const x0 = Math.max(S.min[i * 3], S.min[j * 3]), z0 = Math.max(S.min[i * 3 + 2], S.min[j * 3 + 2]);
        let hit = false;
        for (let a = 0; a < 3 && !hit; a++)
          for (let b = 0; b < 3 && !hit; b++) {
            const o: Vec3 = [x0 + ((a + 0.5) / 3) * ox, it + 0.01, z0 + ((b + 0.5) / 3) * oz];
            if (S.hits(j, o, [0, 1, 0], 0).length) hit = true;
          }
        if (hit && (by < 0 || bottomOf(S, j) < bottomOf(S, by))) by = j;
      }
      if (by >= 0) blocked.push({ step: s.index, v: { i, by } });
    }
  }
  const issues: Draft[] = [];
  for (const [sIdx, list] of byStep(blocked)) {
    const parts = list.map((x) => x.i);
    const blockers = [...new Set(list.map((x) => x.by))];
    const first = list[0];
    const ci = S.centre(first.i);
    const atGround = list.every((x) => bottomOf(S, x.i) <= 0.5);
    issues.push({
      rule: 'REACH-PATH',
      severity: atGround ? 'major' : 'critical',
      title: `${plural(parts.length, 'crane pick')} under work already built`,
      detail: `${partLabel(p, first.i)}${parts.length > 1 ? ` and ${parts.length - 1} more` : ''} at ${stepName(p, sIdx)} must be lowered through ${partLabel(p, first.by)}${blockers.length > 1 ? ` and ${blockers.length - 1} more` : ''}, placed at ${stepName(p, S.step[first.by])}.`,
      action: atGround
        ? 'Set these with ground plant (telehandler or forklift) instead of the tower crane, or before the work above is built.'
        : 'Lift them before the work above is built, or land them on a loading platform at the edge and move them in horizontally.',
      primary: parts,
      secondary: blockers,
      step: sIdx,
      at: [ci[0], topOf(S, first.i), ci[2]],
      box: unionBox(S, [...parts, ...blockers]),
      lines: list.slice(0, 40).map((x) => {
        const c = S.centre(x.i);
        return [[c[0], topOf(S, x.i), c[2]], [c[0], bottomOf(S, x.by), c[2]]] as [Vec3, Vec3];
      }),
    });
  }
  return { issues, result: { checked: picks, applicable: picks > 0, note: picks ? `${picks} crane picks checked for a clear drop` : 'no crane picks' } };
}

// ── TEMP-EDGE ────────────────────────────────────────────────────────────────

const GUARD_CATS = new Set(['wall', 'curtainwall', 'window', 'door', 'railing', 'plate', 'member', 'pod']);

interface EdgeSample {
  p: Vec3; // on the edge
  u: Vec3; // outward, in plan, unit
  len: number; // edge length this sample stands for
}

/** Sampled outline of an element's walking surface (faces looking up). */
function walkingEdges(S: CheckScene, i: number, spacing: number): EdgeSample[] {
  const out: EdgeSample[] = [];
  const add = (a: Vec3, b: Vec3, u: Vec3) => {
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (L < 0.05) return;
    const n = Math.max(1, Math.round(L / spacing));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], u, len: L / n });
    }
  };
  const box = S.obb[i];
  if (box) {
    // the face whose normal is closest to +Y
    let k = 0;
    for (let q = 1; q < 3; q++) if (Math.abs(box.ax[q][1]) > Math.abs(box.ax[k][1])) k = q;
    if (Math.abs(box.ax[k][1]) < 0.9) return out;
    const sgn = box.ax[k][1] > 0 ? 1 : -1;
    const [a, b] = [0, 1, 2].filter((q) => q !== k);
    const c: Vec3 = [0, 1, 2].map((q) => box.c[q] + sgn * box.h[k] * box.ax[k][q]) as Vec3;
    const corner = (sa: number, sb: number): Vec3 => [0, 1, 2].map((q) => c[q] + sa * box.h[a] * box.ax[a][q] + sb * box.h[b] * box.ax[b][q]) as Vec3;
    const flat = (v: Vec3): Vec3 => {
      const l = Math.hypot(v[0], v[2]) || 1;
      return [v[0] / l, 0, v[2] / l];
    };
    add(corner(-1, -1), corner(1, -1), flat(box.ax[b].map((x) => -x) as Vec3));
    add(corner(1, -1), corner(1, 1), flat(box.ax[a]));
    add(corner(1, 1), corner(-1, 1), flat(box.ax[b]));
    add(corner(-1, 1), corner(-1, -1), flat(box.ax[a].map((x) => -x) as Vec3));
    return out;
  }
  const m = S.mesh[i];
  if (!m) return out;
  const P = m.positions, I = m.indices;
  const key = (v: number) => `${Math.round(P[v * 3] * 1e3)},${Math.round(P[v * 3 + 1] * 1e3)},${Math.round(P[v * 3 + 2] * 1e3)}`;
  const up: number[] = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l > 1e-12 && ny / l > 0.7) up.push(t);
  }
  const count = new Map<string, number>();
  const ek = (x: number, y: number) => {
    const a = key(x), b = key(y);
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  for (const t of up) for (const [x, y] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) count.set(ek(x, y), (count.get(ek(x, y)) ?? 0) + 1);
  for (const t of up) {
    const v = [I[t], I[t + 1], I[t + 2]];
    const cx = (P[v[0] * 3] + P[v[1] * 3] + P[v[2] * 3]) / 3, cz = (P[v[0] * 3 + 2] + P[v[1] * 3 + 2] + P[v[2] * 3 + 2]) / 3;
    for (let e = 0; e < 3; e++) {
      const x = v[e], y = v[(e + 1) % 3];
      if (count.get(ek(x, y)) !== 1) continue;
      const a: Vec3 = [P[x * 3], P[x * 3 + 1], P[x * 3 + 2]], b: Vec3 = [P[y * 3], P[y * 3 + 1], P[y * 3 + 2]];
      let u: Vec3 = [b[2] - a[2], 0, -(b[0] - a[0])];
      const l = Math.hypot(u[0], u[2]) || 1;
      u = [u[0] / l, 0, u[2] / l];
      // point away from the face's own centre
      if ((cx - a[0]) * u[0] + (cz - a[2]) * u[2] > 0) u = [-u[0], 0, -u[2]];
      add(a, b, u);
    }
  }
  return out;
}

export async function checkEdges(S: CheckScene, st: CheckSettings, yieldNow: Yield): Promise<RuleOutput> {
  const p = S.project;
  const INF = 1e9;
  interface Run {
    a: Vec3;
    b: Vec3;
    len: number;
    end: number;
    by: number; // what closes it (−1: nothing)
  }
  const perSlab: { i: number; runs: Run[]; exposed: number; permanent: number; end: number }[] = [];
  let edgeLen = 0;
  let slabs = 0;
  let work = 0;
  for (let i = 0; i < S.n; i++) {
    if (S.role[i] !== 'structure' || !(S.cat[i] === 'slab' || S.cat[i] === 'roof')) continue;
    const ey = S.max[i * 3 + 1] - S.min[i * 3 + 1];
    if (Math.max(S.max[i * 3] - S.min[i * 3], S.max[i * 3 + 2] - S.min[i * 3 + 2]) < 3 * ey) continue;
    if (topOf(S, i) < st.fallHeight - 0.05) continue; // a ground-floor slab: the ground is right there
    slabs++;
    const start = S.step[i];
    const samples = walkingEdges(S, i, 0.5);
    const runs: Run[] = [];
    let exposed = 0;
    let permanent = 0;
    let latest = start;
    for (const smp of samples) {
      edgeLen += smp.len;
      const [px, py, pz] = smp.p;
      const q: Vec3 = [px + smp.u[0] * 0.3, py, pz + smp.u[2] * 0.3];
      // what would you land on? the ground, or anything within a fall height below the edge
      let fill = py < st.fallHeight ? -1 : INF;
      let fillBy = -1;
      if (fill === INF) {
        const o: Vec3 = [q[0], py + 0.3, q[2]];
        for (const j of S.query([q[0] - 0.01, py - st.fallHeight, q[2] - 0.01], [q[0] + 0.01, py + 0.3, q[2] + 0.01])) {
          if (j === i || S.role[j] === 'setout' || S.step[j] >= fill) continue;
          let surface = -Infinity;
          if (S.solid[j]) {
            const iv = S.inside(j, o, [0, -1, 0]);
            for (const [t0, t1] of iv) if (t1 >= 0) surface = Math.max(surface, o[1] - Math.max(0, t0));
          } else {
            const h = S.hits(j, o, [0, -1, 0], 0);
            if (h.length) surface = o[1] - h[0];
          }
          if (surface > py - st.fallHeight) {
            fill = S.step[j];
            fillBy = j;
          }
        }
      }
      if (fill <= start) continue; // no drop when the slab goes in
      // what closes the edge: a guard crossing it at knee and at rail height
      const heights = [py + 0.5, py + Math.max(0.6, st.guardHeight - 0.05)];
      let guard = 0;
      let guardBy = -1;
      for (const h of heights) {
        let best = INF;
        let bestBy = -1;
        const o: Vec3 = [px - smp.u[0] * 0.35, h, pz - smp.u[2] * 0.35];
        const d: Vec3 = [smp.u[0], 0, smp.u[2]];
        const lo: Vec3 = [Math.min(o[0], o[0] + d[0] * 0.7) - 0.01, h - 0.01, Math.min(o[2], o[2] + d[2] * 0.7) - 0.01];
        const hi: Vec3 = [Math.max(o[0], o[0] + d[0] * 0.7) + 0.01, h + 0.01, Math.max(o[2], o[2] + d[2] * 0.7) + 0.01];
        for (const j of S.query(lo, hi)) {
          if (j === i || S.step[j] >= best) continue;
          if (!(GUARD_CATS.has(S.cat[j]) || S.role[j] === 'envelope')) continue;
          let crosses = false;
          if (S.solid[j]) crosses = S.inside(j, o, d).some(([t0, t1]) => t1 > 0 && t0 < 0.7);
          else crosses = true; // open shells (railings): bounds already straddle the ray
          if (crosses) {
            best = S.step[j];
            bestBy = j;
          }
        }
        if (best >= guard) {
          guard = best;
          guardBy = bestBy;
        }
      }
      const end = Math.min(guard, fill);
      const by = end >= INF ? -1 : end === fill ? fillBy : guardBy;
      if (end <= start) continue;
      if (end >= INF) permanent += smp.len;
      else {
        exposed += smp.len;
        latest = Math.max(latest, end);
      }
      const a: Vec3 = [px - (smp.len / 2) * -smp.u[2], py, pz - (smp.len / 2) * smp.u[0]];
      const b: Vec3 = [px + (smp.len / 2) * -smp.u[2], py, pz + (smp.len / 2) * smp.u[0]];
      runs.push({ a, b, len: smp.len, end, by });
      if (++work % 400 === 0) await yieldNow();
    }
    if (runs.length) perSlab.push({ i, runs, exposed, permanent, end: latest });
  }
  // one issue per level and kind: temporary exposure (edge protection) or never closed (no guard modelled)
  const levelOf = (i: number) => Math.round(topOf(S, i) * 10) / 10;
  const groups = new Map<string, typeof perSlab>();
  for (const e of perSlab) {
    for (const kind of ['temp', 'perm'] as const) {
      if ((kind === 'temp' ? e.exposed : e.permanent) <= 0) continue;
      const k = `${kind}|${levelOf(e.i)}`;
      const g = groups.get(k);
      if (g) g.push(e);
      else groups.set(k, [e]);
    }
  }
  const levelName = (y: number) => {
    const lv = [...p.levels].filter((l) => l.code !== 'TOP').sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0];
    return lv && Math.abs(lv.y - y) < 0.6 ? `${lv.code} (${y >= 0 ? '+' : ''}${y.toFixed(2)} m)` : `${y >= 0 ? '+' : ''}${y.toFixed(2)} m`;
  };
  interface Level {
    kind: 'temp' | 'perm';
    y: number;
    slabs: number[];
    runs: Run[];
    len: number;
    start: number;
    until: number;
    closers: number[];
    by: string;
  }
  const levels: Level[] = [];
  for (const [k, list] of [...groups.entries()].sort((a, b) => Number(a[0].split('|')[1]) - Number(b[0].split('|')[1]))) {
    const [kind, yS] = k.split('|') as ['temp' | 'perm', string];
    const y = Number(yS);
    const slabsHere = list.map((e) => e.i);
    const runs = list.flatMap((e) => e.runs.filter((r) => (kind === 'perm' ? r.end >= INF : r.end < INF)));
    const start = Math.min(...slabsHere.map((i) => S.step[i]));
    const until = Math.max(...runs.map((r) => r.end));
    const closers = new Set<number>();
    if (kind === 'temp') for (const r of runs) if (r.by >= 0) closers.add(r.by);
    levels.push({ kind, y, slabs: slabsHere, runs, len: runs.reduce((a, r) => a + r.len, 0), start, until, closers: [...closers], by: kind === 'temp' ? closerNames(S, [...closers]) : '' });
  }
  // repeating floors (a tower's typical levels) read as one item: same kind, similar length, same closers
  const merged: Level[][] = [];
  for (const kind of ['temp', 'perm'] as const) {
    let cur: Level[] = [];
    for (const lv of levels.filter((l) => l.kind === kind)) {
      const head = cur[0];
      if (head && Math.abs(lv.len - head.len) <= 0.25 * head.len) cur.push(lv);
      else {
        if (cur.length) merged.push(cur);
        cur = [lv];
      }
    }
    if (cur.length) merged.push(cur);
  }
  const issues: Draft[] = [];
  for (const group of merged) {
    const first = group[0], last = group[group.length - 1];
    const kind = first.kind;
    const runs = group.flatMap((l) => l.runs);
    const slabsAll = group.flatMap((l) => l.slabs);
    const closersAll = [...new Set(group.flatMap((l) => l.closers))];
    const by = closerNames(S, closersAll);
    const total = runs.reduce((a, r) => a + r.len, 0);
    const per = total / group.length;
    const where = group.length === 1 ? `at ${levelName(first.y)}` : `on ${group.length} floors, ${levelName(first.y)} to ${levelName(last.y)}`;
    const spans = group.map((l) => l.until - l.start);
    const minS = Math.min(...spans), maxS = Math.max(...spans);
    const mid = first.runs[Math.floor(first.runs.length / 2)];
    const title =
      kind === 'perm'
        ? group.length === 1
          ? `${total.toFixed(0)} m of open edge never guarded ${where}`
          : `Open edges never guarded ${where} (${per.toFixed(0)} m each)`
        : group.length === 1
          ? `Edge protection: ${total.toFixed(0)} m ${where}`
          : `Edge protection ${where} (${per.toFixed(0)} m each)`;
    const detail =
      kind === 'perm'
        ? `No wall, glazing or guard ${fmtMm(st.guardHeight)} high closes ${group.length === 1 ? `${total.toFixed(1)} m` : `${per.toFixed(1)} m per floor (${total.toFixed(0)} m in all)`} of edge with a fall of ${st.fallHeight} m or more, from the time each floor is placed to the end of the sequence.`
        : group.length === 1
          ? `${total.toFixed(1)} m of edge with a fall of ${st.fallHeight} m or more is open from ${stepName(p, first.start)} until ${stepName(p, first.until)} (${plural(first.until - first.start, 'step')}), when ${first.by} close${first.closers.length === 1 ? 's' : ''} it.`
          : `About ${per.toFixed(0)} m of edge per floor (${total.toFixed(0)} m in all) with a fall of ${st.fallHeight} m or more is open for ${minS === maxS ? plural(minS, 'step') : `${minS}–${maxS} steps`} on each floor, from ${stepName(p, first.start)} to ${stepName(p, last.until)}, until ${by} close it.`;
    issues.push({
      rule: 'TEMP-EDGE',
      severity: 'major',
      title,
      detail,
      action:
        kind === 'perm'
          ? 'Add permanent guarding (balustrades, parapets) to the design, or record the fall-arrest system that replaces it.'
          : group.length === 1
            ? `Fit edge protection (guardrails, toe boards or perimeter screens) before ${stepName(p, first.start)} and keep it until ${stepName(p, first.until)}.`
            : `Fit perimeter edge protection floor by floor (climbing screens or guardrails) and keep each floor protected until ${by} are in.`,
      primary: slabsAll,
      secondary: closersAll,
      step: first.start,
      at: mid ? [(mid.a[0] + mid.b[0]) / 2, first.y, (mid.a[2] + mid.b[2]) / 2] : centreOf(S, first.slabs),
      box: unionBox(S, first.slabs, 1),
      lines: runs.map((r) => [r.a, r.b] as [Vec3, Vec3]),
      value: total,
      unit: 'm',
    });
  }
  return { issues, result: { checked: slabs, applicable: slabs > 0, note: slabs ? `${slabs} raised floors and roofs, ${edgeLen.toFixed(0)} m of edge` : 'no raised floors or roofs' } };
}

/** "the railings", "walls and windows" — what closes an open edge. */
function closerNames(S: CheckScene, parts: number[]): string {
  const NAMES: Record<string, string> = { railing: 'guard rails', window: 'windows', door: 'doors', wall: 'walls', curtainwall: 'façade units', plate: 'panels', member: 'framing', pod: 'pods', slab: 'adjacent slabs', roof: 'roofs', landscape: 'planters', beam: 'beams', column: 'columns', foundation: 'foundations', finish: 'floor finishes', covering: 'coverings' };
  const kinds = [...new Set(parts.map((j) => NAMES[S.cat[j]] ?? (S.role[j] === 'envelope' ? 'façade units' : `${S.cat[j]}s`)))];
  if (!kinds.length) return 'later work';
  return kinds.length === 1 ? `the ${kinds[0]}` : `the ${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}`;
}

// ── CLASH-HARD ───────────────────────────────────────────────────────────────

const SOFT = new Set(['finish', 'covering']);
const NO_CLASH = new Set(['setout', 'landscape']);

/** Deepest overlap of two closed parts along x, y and z (the smallest of the three is the penetration). */
function penetration(S: CheckScene, i: number, j: number, lo: Vec3, hi: Vec3, tol: number): { depth: number; vol: number } {
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const order = [0, 1, 2].sort((a, b) => ext[a] - ext[b]);
  let depth = Infinity;
  let vol = 0;
  for (const k of order) {
    const a = (k + 1) % 3, b = (k + 2) % 3;
    const na = Math.min(12, Math.max(3, Math.round(ext[a] / 0.05))), nb = Math.min(12, Math.max(3, Math.round(ext[b] / 0.05)));
    const d: Vec3 = [0, 0, 0];
    d[k] = 1;
    let maxLen = 0, sum = 0;
    for (let ia = 0; ia < na; ia++)
      for (let ib = 0; ib < nb; ib++) {
        const o: Vec3 = [0, 0, 0];
        o[a] = lo[a] + ((ia + 0.5731) / na) * ext[a];
        o[b] = lo[b] + ((ib + 0.4387) / nb) * ext[b];
        o[k] = Math.min(S.min[i * 3 + k], S.min[j * 3 + k]) - 1;
        const A = S.inside(i, o, d), B = S.inside(j, o, d);
        let len = 0;
        for (const x of A) for (const y of B) len += Math.max(0, Math.min(x[1], y[1]) - Math.max(x[0], y[0]));
        maxLen = Math.max(maxLen, len);
        sum += len;
      }
    if (k === order[0]) vol = (sum / (na * nb)) * ext[a] * ext[b];
    depth = Math.min(depth, maxLen);
    if (depth <= tol) break;
  }
  return { depth, vol };
}

export async function checkClashes(S: CheckScene, st: CheckSettings, yieldNow: Yield): Promise<RuleOutput> {
  const p = S.project;
  if (p.meta.source !== 'ifc') {
    return { issues: [], result: { checked: 0, applicable: false, note: 'generated massing: its boxes overlap by construction, so clashes are checked on imported models only' } };
  }
  const tol = st.clashTol;
  const ref = (i: number) => p.parts[i].ref!;
  const idx = [...Array(S.n).keys()].filter((i) => !NO_CLASH.has(S.role[i])).sort((a, b) => S.min[a * 3] - S.min[b * 3]);
  const active: number[] = [];
  const found: { i: number; j: number; depth: number; vol: number; lo: Vec3; hi: Vec3; kind: 'clash' | 'duplicate' | 'junction' }[] = [];
  let pairs = 0, open = 0, interfaces = 0, work = 0;
  for (const i of idx) {
    const x0 = S.min[i * 3];
    for (let k = active.length - 1; k >= 0; k--) if (S.max[active[k] * 3] < x0 + tol) active.splice(k, 1);
    for (const j of active) {
      const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
      let ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        lo[a] = Math.max(S.min[i * 3 + a], S.min[j * 3 + a]);
        hi[a] = Math.min(S.max[i * 3 + a], S.max[j * 3 + a]);
        if (hi[a] - lo[a] <= tol) ok = false;
      }
      if (!ok) continue;
      const ri = ref(i), rj = ref(j);
      if (ri.host === rj.guid || rj.host === ri.guid) continue; // a door in its wall
      if (ri.parent && (ri.parent === rj.parent || ri.parent === rj.guid)) continue; // one assembly
      if (rj.parent && rj.parent === ri.guid) continue;
      pairs++;
      if (!S.solid[i] || !S.solid[j]) {
        open++;
        continue;
      }
      const { depth, vol } = penetration(S, i, j, lo, hi, tol);
      if (++work % 40 === 0) await yieldNow();
      if (depth <= tol) continue;
      const ci = S.cat[i], cj = S.cat[j];
      const same = (k: number) => Math.abs(S.min[i * 3 + k] - S.min[j * 3 + k]) < 0.005 && Math.abs(S.max[i * 3 + k] - S.max[j * 3 + k]) < 0.005;
      if (ci === cj && same(0) && same(1) && same(2)) {
        found.push({ i, j, depth, vol, lo, hi, kind: 'duplicate' });
        continue;
      }
      // a finish laid around another element only overlaps it by its own thickness
      const thick = (k: number) => S.max[k * 3 + 1] - S.min[k * 3 + 1];
      if ((SOFT.has(ci) && depth <= thick(i) + 0.002) || (SOFT.has(cj) && depth <= thick(j) + 0.002)) {
        interfaces++;
        continue;
      }
      const junction = S.role[i] === 'structure' && S.role[j] === 'structure' && ci === 'wall' && cj === 'wall';
      found.push({ i, j, depth, vol, lo, hi, kind: junction ? 'junction' : 'clash' });
    }
    active.push(i);
  }
  // group clashes around the element they share most (a beam hit by four windows is one issue)
  // the hub is the element with most clashes; on a tie, the structural one (a beam hit by a window)
  const deg = new Map<number, number>();
  for (const f of found) for (const k of [f.i, f.j]) deg.set(k, (deg.get(k) ?? 0) + 1);
  for (const [k, d] of deg) if (S.role[k] === 'structure') deg.set(k, d + 0.5);
  const groups = new Map<string, typeof found>();
  for (const f of found) {
    const hub = f.kind === 'clash' ? ((deg.get(f.i) ?? 0) >= (deg.get(f.j) ?? 0) ? f.i : f.j) : Math.min(f.i, f.j);
    const other = hub === f.i ? f.j : f.i;
    const key = f.kind === 'clash' ? `${f.kind}|${hub}|${S.cat[other]}` : `${f.kind}|${f.i}|${f.j}`;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  const issues: Draft[] = [];
  for (const [key, list] of groups) {
    const [kind, hubS] = key.split('|');
    const hub = Number(hubS);
    const others = [...new Set(list.map((f) => (f.i === hub ? f.j : f.i)))];
    const deepest = list.reduce((a, f) => (f.depth > a.depth ? f : a), list[0]);
    const vol = list.reduce((a, f) => a + f.vol, 0);
    const structuralHit = list.some((f) => S.role[f.i] === 'structure' || S.role[f.j] === 'structure');
    const overhead = S.role[hub] === 'structure' && ['beam', 'slab', 'roof'].includes(S.cat[hub]);
    // major: 50 mm or more into structure, or no deflection gap under a beam or floor
    let severity: Severity = 'minor';
    if (kind === 'clash' && structuralHit && deepest.depth >= 0.05) severity = 'major';
    if (kind === 'clash' && overhead && others.some((o) => S.role[o] !== 'structure')) severity = 'major';
    const a = kind === 'clash' ? hub : deepest.i, b = kind === 'clash' ? others[0] : deepest.j;
    const centre: Vec3 = [(deepest.lo[0] + deepest.hi[0]) / 2, (deepest.lo[1] + deepest.hi[1]) / 2, (deepest.lo[2] + deepest.hi[2]) / 2];
    const step = Math.max(...list.map((f) => Math.max(S.step[f.i], S.step[f.j])));
    const otherNames = others.slice(0, 2).map((o) => partLabel(p, o)).join(', ') + (others.length > 2 ? ` and ${others.length - 2} more` : '');
    const title =
      kind === 'duplicate'
        ? `Duplicate ${S.cat[a]}: ${partLabel(p, a)} and ${partLabel(p, b)}`
        : kind === 'junction'
          ? `Walls overlap at a junction by ${(vol * 1000).toFixed(0)} L`
          : `${partLabel(p, hub)} clashes with ${others.length === 1 ? partLabel(p, others[0]) : `${others.length} ${S.cat[others[0]]}s`}`;
    const detail =
      kind === 'duplicate'
        ? `Two ${S.cat[a]} elements occupy the same space (${(vol * 1000).toFixed(0)} L overlap): the second is counted twice in quantities and would be built twice.`
        : kind === 'junction'
          ? `${partLabel(p, deepest.i)} and ${partLabel(p, deepest.j)} overlap by ${fmtMm(deepest.depth)} where they meet (${(vol * 1000).toFixed(0)} L counted twice).`
          : `${partLabel(p, hub)} and ${otherNames} overlap by up to ${fmtMm(deepest.depth)}${vol >= 0.001 ? ` (${(vol * 1000).toFixed(0)} L)` : ''}, beyond the ${fmtMm(tol)} tolerance.`;
    const what = others.length === 1 ? `the ${S.cat[others[0]]}` : `the ${S.cat[others[0]]}s`;
    const action =
      kind === 'duplicate'
        ? 'Delete one of the two elements in the authoring model.'
        : kind === 'junction'
          ? 'Clean up the wall join so the junction is modelled once.'
          : overhead && others.every((o) => S.role[o] !== 'structure')
            ? `Stop ${what} under the ${S.cat[hub]} with a deflection gap (a deflection head), or lower ${others.length === 1 ? 'its' : 'their'} heads.`
            : S.role[hub] === 'structure' && others.every((o) => S.role[o] !== 'structure')
              ? `Set ${what} back to the face of the ${S.cat[hub]}.`
              : 'Coordinate the two elements: trim, move or re-detail one of them before fabrication.';
    issues.push({
      rule: 'CLASH-HARD',
      severity,
      title,
      detail,
      action,
      primary: kind === 'clash' ? others : [deepest.i],
      secondary: kind === 'clash' ? [hub] : [deepest.j],
      step,
      at: centre,
      box: unionBox(S, [hub, ...others], 0.6),
      lines: [],
      value: deepest.depth,
      limit: tol,
      unit: 'm',
    });
  }
  const note = `${pairs} touching pairs tested · ${interfaces} finish interfaces ignored${open ? ` · ${open} pairs with an open-shell element not tested` : ''}`;
  return { issues, result: { checked: pairs, applicable: pairs > 0, note } };
}

// ── CLASH-TEMP ───────────────────────────────────────────────────────────────

export function checkCraneClearance(S: CheckScene, st: CheckSettings): RuleOutput {
  void st;
  const p = S.project;
  const c = p.crane;
  const mastHalf = 1.0; // a 2 m square mast section
  const clear = 1.0;
  const top = Math.max(c.mastStart, p.height + 4);
  const lo: Vec3 = [c.base[0] - mastHalf - clear, 0.05, c.base[2] - mastHalf - clear];
  const hi: Vec3 = [c.base[0] + mastHalf + clear, top, c.base[2] + mastHalf + clear];
  const hit = S.query(lo, hi).filter((j) => S.role[j] !== 'setout' && !(S.cat[j] === 'foundation' && topOf(S, j) <= 0.1));
  const issues: Draft[] = [];
  if (hit.length) {
    const inMast = hit.filter((j) => S.max[j * 3] > c.base[0] - mastHalf && S.min[j * 3] < c.base[0] + mastHalf && S.max[j * 3 + 2] > c.base[2] - mastHalf && S.min[j * 3 + 2] < c.base[2] + mastHalf);
    issues.push({
      rule: 'CLASH-TEMP',
      severity: inMast.length ? 'critical' : 'major',
      title: inMast.length ? `${c.id} mast passes through ${plural(inMast.length, 'element')}` : `${plural(hit.length, 'element')} within 1 m of the ${c.id} mast`,
      detail: `${hit.slice(0, 3).map((j) => partLabel(p, j)).join(', ')}${hit.length > 3 ? ` and ${hit.length - 3} more` : ''} ${inMast.length ? 'occupy the mast position' : 'come within 1 m of the mast'} at (${c.base[0].toFixed(1)}, ${c.base[2].toFixed(1)}).`,
      action: 'Move the crane, leave out and infill the affected elements after the crane is struck, or redesign around the mast.',
      primary: hit,
      secondary: [],
      step: Math.min(...hit.map((j) => S.step[j])),
      at: [c.base[0], Math.min(top, p.height), c.base[2]],
      box: [lo, hi],
      lines: [[[c.base[0], 0, c.base[2]], [c.base[0], top, c.base[2]]]],
    });
  }
  return { issues, result: { checked: 1, applicable: true, note: `mast at (${c.base[0].toFixed(1)}, ${c.base[2].toFixed(1)}), ${hit.length ? 'not clear' : 'clear by at least 1 m'}` } };
}

// ── ACCESS-HEADROOM ──────────────────────────────────────────────────────────

export function checkHeadroom(S: CheckScene, st: CheckSettings): RuleOutput {
  const p = S.project;
  const stairs = [...Array(S.n).keys()].filter((i) => S.cat[i] === 'stair' && S.mesh[i] && S.solid[i]);
  if (!stairs.length) return { issues: [], result: { checked: 0, applicable: false, note: 'no stairs in the model' } };
  const issues: Draft[] = [];
  let nosings = 0;
  let least = Infinity;
  for (const i of stairs) {
    const m = S.mesh[i]!;
    const P = m.positions, I = m.indices;
    const parent = p.parts[i].ref?.parent;
    // candidate nosing points: along the outline of the faces looking up
    const pts: { p: Vec3; u: Vec3 }[] = [];
    const key = (v: number) => `${Math.round(P[v * 3] * 1e3)},${Math.round(P[v * 3 + 1] * 1e3)},${Math.round(P[v * 3 + 2] * 1e3)}`;
    const count = new Map<string, number>();
    const up: number[] = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l > 1e-12 && ny / l > 0.95) up.push(t);
    }
    const ek = (x: number, y: number) => {
      const a = key(x), b = key(y);
      return a < b ? `${a}|${b}` : `${b}|${a}`;
    };
    for (const t of up) for (const [x, y] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) count.set(ek(x, y), (count.get(ek(x, y)) ?? 0) + 1);
    for (const t of up) {
      const v = [I[t], I[t + 1], I[t + 2]];
      const cx = (P[v[0] * 3] + P[v[1] * 3] + P[v[2] * 3]) / 3, cz = (P[v[0] * 3 + 2] + P[v[1] * 3 + 2] + P[v[2] * 3 + 2]) / 3;
      for (let e = 0; e < 3; e++) {
        const x = v[e], y = v[(e + 1) % 3];
        if (count.get(ek(x, y)) !== 1) continue;
        const a: Vec3 = [P[x * 3], P[x * 3 + 1], P[x * 3 + 2]], b: Vec3 = [P[y * 3], P[y * 3 + 1], P[y * 3 + 2]];
        let u: Vec3 = [b[2] - a[2], 0, -(b[0] - a[0])];
        const l = Math.hypot(u[0], u[2]) || 1;
        u = [u[0] / l, 0, u[2] / l];
        if ((cx - a[0]) * u[0] + (cz - a[2]) * u[2] > 0) u = [-u[0], 0, -u[2]];
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const n = Math.max(1, Math.round(len / 0.15));
        for (let k = 0; k < n; k++) {
          const f = (k + 0.5) / n;
          pts.push({ p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], u });
        }
      }
    }
    // a nosing has the tread below one riser down just beyond it
    let worst: { h: number; at: Vec3; by: number } | null = null;
    for (const { p: q, u } of pts) {
      const beyond: Vec3 = [q[0] + u[0] * 0.08, q[1] + 0.01, q[2] + u[2] * 0.08];
      // looking down from just beyond the edge, the first surface met must be a tread (or the floor
      // at the foot of the flight) one riser lower
      let drop: { t: number; s: number } | null = null;
      for (const j of S.query([beyond[0] - 0.01, beyond[1] - 0.3, beyond[2] - 0.01], [beyond[0] + 0.01, beyond[1], beyond[2] + 0.01])) {
        if (j !== i && (!S.solid[j] || S.cat[j] === 'railing' || S.cat[j] === 'furniture')) continue;
        const c = S.crossings(j, beyond, [0, -1, 0], 0)[0];
        if (c && (!drop || c.t < drop.t)) drop = c;
      }
      if (!drop || drop.s !== 1 || drop.t < 0.1 || drop.t > 0.26) continue;
      nosings++;
      const o: Vec3 = [q[0] - u[0] * 0.03, q[1] + 0.005, q[2] - u[2] * 0.03];
      let h = Infinity, by = -1;
      for (const j of S.query([o[0] - 0.01, o[1], o[2] - 0.01], [o[0] + 0.01, o[1] + Math.max(6, st.headroom + 1), o[2] + 0.01])) {
        if (S.cat[j] === 'railing' || S.cat[j] === 'furniture' || S.cat[j] === 'finish' || S.role[j] === 'setout') continue;
        if (j !== i && parent && p.parts[j].ref?.parent === parent) continue;
        // the first solid that starts above the nosing; one the nosing already sits in (the landing
        // tucked under the floor edge) is the walking surface, not an obstruction
        let first = Infinity;
        if (S.solid[j]) {
          const from: Vec3 = [o[0], o[1] - 50, o[2]];
          for (const [t0, t1] of S.inside(j, from, [0, 1, 0])) {
            const a = t0 - 50, b = t1 - 50;
            if (a <= 0.02 && b >= -0.02) continue;
            if (a > 0.02) first = Math.min(first, a);
          }
        } else {
          const hs = S.hits(j, o, [0, 1, 0], 0.02);
          if (hs.length) first = hs[0];
        }
        // closer than 0.3 m is floor build-up over the top step (a clash, if anything), not headroom
        if (first < 0.3) continue;
        if (first < h) {
          h = first;
          by = j;
        }
      }
      h += 0.005; // measured from the nosing, not the ray start just above it
      if (by >= 0 && (!worst || h < worst.h)) worst = { h, at: q, by };
    }
    if (worst) least = Math.min(least, worst.h);
    if (worst && worst.h < st.headroom) {
      issues.push({
        rule: 'ACCESS-HEADROOM',
        severity: 'major',
        title: `Stair headroom ${fmtM(worst.h)} under ${partLabel(p, worst.by)}`,
        detail: `Above a nosing of ${partLabel(p, i)} the clear height to ${partLabel(p, worst.by)} is ${fmtM(worst.h)}, under the ${fmtM(st.headroom)} required.`,
        action: 'Enlarge the opening or raise the obstruction; check the stair against the regulations that apply (2.0 m in the UK, 2.03 m under the IBC).',
        primary: [i],
        secondary: [worst.by],
        step: Math.max(S.step[i], S.step[worst.by]),
        at: [worst.at[0], worst.at[1] + worst.h, worst.at[2]],
        box: unionBox(S, [i], 0.8),
        lines: [[worst.at, [worst.at[0], worst.at[1] + worst.h, worst.at[2]]]],
        value: worst.h,
        limit: st.headroom,
        unit: 'm',
      });
    }
  }
  return { issues, result: { checked: nosings, applicable: nosings > 0, note: `${plural(stairs.length, 'stair')}, ${nosings} nosing points measured${Number.isFinite(least) ? `, least headroom ${fmtM(least)}` : ''}` } };
}

// ── ACCESS-HANDLING ──────────────────────────────────────────────────────────

// pieces that arrive and are set as one unit (railings and partitions are assembled in place)
const HAND_SET = new Set(['door', 'window', 'furniture', 'plate', 'member', 'proxy', 'services', 'curtainwall', 'pod', 'other']);

export function checkHandling(S: CheckScene, st: CheckSettings): RuleOutput {
  const p = S.project;
  let checked = 0, team = 0, estimated = 0;
  const heavy: { step: number; v: { i: number; kg: number } }[] = [];
  for (const s of p.steps) {
    if (s.method !== 'manual' || s.motion === 'pour') continue; // laid in courses or built in place
    for (let i = s.partStart; i < s.partStart + s.partCount; i++) {
      if (!HAND_SET.has(S.cat[i])) continue;
      if (!S.solid[i]) {
        estimated++;
        continue;
      }
      checked++;
      const kg = partMassKg(p.parts[i], p.density);
      if (kg > st.liftAidKg) heavy.push({ step: s.index, v: { i, kg } });
      else if (kg > st.personKg) team++;
    }
  }
  // one issue per kind of piece: the trade plans its equipment once
  const kinds = new Map<string, { i: number; kg: number; step: number }[]>();
  for (const { step, v } of heavy) {
    const k = S.cat[v.i];
    const list = kinds.get(k);
    if (list) list.push({ ...v, step });
    else kinds.set(k, [{ ...v, step }]);
  }
  const KIND: Record<string, [string, string]> = { window: ['window', 'windows'], door: ['door', 'doors'], furniture: ['fitted unit', 'fitted units'], curtainwall: ['glazing unit', 'glazing units'] };
  const issues: Draft[] = [];
  for (const [k, list] of kinds) {
    list.sort((a, b) => b.kg - a.kg);
    const parts = list.map((x) => x.i);
    const [one, many] = KIND[k] ?? [k, `${k}s`];
    const first = Math.min(...list.map((x) => x.step));
    const last = Math.max(...list.map((x) => x.step));
    const glass = k === 'window' || k === 'curtainwall';
    issues.push({
      rule: 'ACCESS-HANDLING',
      severity: list[0].kg > 4 * st.liftAidKg ? 'major' : 'minor',
      title: `${parts.length === 1 ? `1 ${one}` : `${parts.length} ${many}`} too heavy to carry (up to ${fmtKg(list[0].kg)})`,
      detail: `${list.slice(0, 3).map((x) => `${partLabel(p, x.i)} (${fmtKg(x.kg)})`).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''} exceed a ${st.liftAidKg} kg two-person lift, from ${stepName(p, first)}${last > first ? ` to ${stepName(p, last)}` : ''}. Masses are estimated from the model's volume and material.`,
      action: glass ? 'Plan glazing installation with a vacuum lifter or glazing robot, or by crane, and check the route to each opening.' : 'Plan mechanical handling (trolley, hoist or lifting aid) and the route to the workface.',
      primary: parts,
      secondary: [],
      step: first,
      at: centreOf(S, parts.slice(0, 1)),
      box: unionBox(S, parts, 0.6),
      lines: [],
      value: list[0].kg,
      limit: st.liftAidKg,
      unit: 'kg',
    });
  }
  const note = checked ? `${checked} hand-set pieces weighed · ${team} need a two-person lift${estimated ? ` · ${estimated} open-shell pieces not weighed` : ''}` : 'nothing is set by hand';
  return { issues, result: { checked, applicable: checked > 0, note } };
}

// ── ACCESS-TRANSPORT ─────────────────────────────────────────────────────────

/** Smallest box around a part: the oriented box itself, or for meshes the tightest plan rectangle × height. */
export function pieceSize(S: CheckScene, i: number): [number, number, number] {
  const box = S.obb[i];
  if (box) return [box.h[0] * 2, box.h[1] * 2, box.h[2] * 2].sort((a, b) => a - b) as [number, number, number];
  const m = S.mesh[i]!;
  const pca = principalSize(m.positions);
  const pts: [number, number][] = [];
  for (let v = 0; v < m.positions.length; v += 3) pts.push([m.positions[v], m.positions[v + 2]]);
  const hull = hull2(pts);
  let best = [S.max[i * 3] - S.min[i * 3], S.max[i * 3 + 2] - S.min[i * 3 + 2]];
  for (let e = 0; e < hull.length; e++) {
    const a = hull[e], b = hull[(e + 1) % hull.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-9) continue;
    const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const q of hull) {
      const s = (q[0] - a[0]) * ux + (q[1] - a[1]) * uz, t = -(q[0] - a[0]) * uz + (q[1] - a[1]) * ux;
      s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    if ((s1 - s0) * (t1 - t0) < best[0] * best[1] - 1e-9) best = [s1 - s0, t1 - t0];
  }
  const plan = [best[0], best[1], S.max[i * 3 + 1] - S.min[i * 3 + 1]].sort((a, b) => a - b) as [number, number, number];
  // sloping members (stringers, rafters) are tighter along their principal axes
  return pca[0] * pca[1] * pca[2] < plan[0] * plan[1] * plan[2] ? pca : plan;
}

/** Extents along the principal axes of a point cloud (vertex covariance), smallest first. */
function principalSize(P: Float32Array): [number, number, number] {
  const n = P.length / 3;
  const c = [0, 0, 0];
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) c[k] += P[v * 3 + k] / n;
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let v = 0; v < n; v++) {
    const d = [P[v * 3] - c[0], P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a * 3 + b] += d[a] * d[b];
  }
  // Jacobi rotations for the symmetric 3×3
  const V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 12; sweep++) {
    for (const [pI, qI] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = C[pI * 3 + qI];
      if (Math.abs(apq) < 1e-12) continue;
      const theta = (C[qI * 3 + qI] - C[pI * 3 + pI]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 3; k++) {
        const akp = C[k * 3 + pI], akq = C[k * 3 + qI];
        C[k * 3 + pI] = cs * akp - sn * akq;
        C[k * 3 + qI] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = C[pI * 3 + k], aqk = C[qI * 3 + k];
        C[pI * 3 + k] = cs * apk - sn * aqk;
        C[qI * 3 + k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k * 3 + pI], vkq = V[k * 3 + qI];
        V[k * 3 + pI] = cs * vkp - sn * vkq;
        V[k * 3 + qI] = sn * vkp + cs * vkq;
      }
    }
  }
  const ext = [0, 1, 2].map((a) => {
    let lo = Infinity, hi = -Infinity;
    for (let v = 0; v < n; v++) {
      const s = (P[v * 3] - c[0]) * V[a] + (P[v * 3 + 1] - c[1]) * V[3 + a] + (P[v * 3 + 2] - c[2]) * V[6 + a];
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    return hi - lo;
  });
  return ext.sort((a, b) => a - b) as [number, number, number];
}

function hull2(pts: [number, number][]): [number, number][] {
  const s = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (s.length < 3) return s;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let k = s.length - 1; k >= 0; k--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], s[k]) <= 0) upper.pop();
    upper.push(s[k]);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function checkTransport(S: CheckScene, st: CheckSettings): RuleOutput {
  const p = S.project;
  const [L, W, H] = st.truck;
  let checked = 0;
  const big: { step: number; v: { i: number; size: [number, number, number]; why: string } }[] = [];
  for (const s of p.steps) {
    const prefab = s.method === 'crane' || (s.method === 'manual' && s.motion !== 'pour');
    if (!prefab) continue;
    for (let i = s.partStart; i < s.partStart + s.partCount; i++) {
      if (MATERIAL_INFO[p.parts[i].mat].bulk || S.role[i] === 'setout' || S.cat[i] === 'landscape') continue;
      if (s.method === 'manual' && !HAND_SET.has(S.cat[i])) continue;
      checked++;
      const [a, b, c] = pieceSize(S, i);
      const why: string[] = [];
      if (c > L) why.push(`${c.toFixed(1)} m long`);
      if (a > W) why.push(`at least ${a.toFixed(2)} m wide whichever way it lies`);
      else if (b > H && b > W) why.push(`${b.toFixed(2)} m wide laid flat, as high on edge`);
      if (why.length) big.push({ step: s.index, v: { i, size: [a, b, c], why: why.join(', ') } });
    }
  }
  // one issue per kind of piece and reason: the logistics plan books each once
  const kinds = new Map<string, { i: number; size: [number, number, number]; why: string; step: number }[]>();
  for (const { step, v } of big) {
    const reason = v.size[2] > L ? 'long' : 'wide';
    const k = `${kindOf(p, v.i)}|${reason}`;
    const list = kinds.get(k);
    if (list) list.push({ ...v, step });
    else kinds.set(k, [{ ...v, step }]);
  }
  const issues: Draft[] = [];
  for (const [k, list] of kinds) {
    const [kind, reason] = k.split('|');
    list.sort((a, b) => (reason === 'long' ? b.size[2] - a.size[2] : Math.max(b.size[0], b.size[1]) - Math.max(a.size[0], a.size[1])));
    const parts = list.map((x) => x.i);
    const x = list[0];
    const first = Math.min(...list.map((y) => y.step)), last = Math.max(...list.map((y) => y.step));
    issues.push({
      rule: 'ACCESS-TRANSPORT',
      severity: 'major',
      title: `${plural(parts.length, 'abnormal load')}: ${kind}`,
      detail: `${parts.length === 1 ? 'The piece measures' : `The largest of ${parts.length} pieces measures`} ${x.size.map((v) => v.toFixed(2)).join(' × ')} m (${x.why}), beyond a standard ${L} × ${W} × ${H} m load. Deliveries run from ${stepName(p, first)}${last > first ? ` to ${stepName(p, last)}` : ''}.`,
      action: reason === 'long' ? 'Split the pieces at a designed joint, or book extendable trailers with escorts and a delivery window.' : 'Book wide or low-loader transport with escorts and delivery windows, or split the pieces at a designed joint.',
      primary: parts,
      secondary: [],
      step: first,
      at: centreOf(S, parts.slice(0, 1)),
      box: unionBox(S, parts.slice(0, 24), 0.6),
      lines: [],
      value: Math.max(x.size[2] / L, x.size[0] / W),
      unit: 'size',
    });
  }
  return { issues, result: { checked, applicable: checked > 0, note: checked ? `${checked} prefabricated pieces measured` : 'no prefabricated pieces' } };
}

/** What a piece is, without its level or id: "CLT floor panels", "W410X60". */
function kindOf(p: Project, i: number): string {
  const part = p.parts[i];
  if (part.ref) return partLabel(p, i).replace(/ #\d+$/, '');
  const member = p.steps[part.step]?.member ?? '';
  const tail = member.includes(' · ') ? member.split(' · ').slice(1).join(' · ') : member;
  return `${MATERIAL_INFO[part.mat].label.split(' ·')[0]} · ${tail.toLowerCase()}`;
}

// ── MODEL-DATA ───────────────────────────────────────────────────────────────

export function checkModelData(S: CheckScene, st: CheckSettings): RuleOutput {
  void st;
  const p = S.project;
  if (p.meta.source !== 'ifc') return { issues: [], result: { checked: 0, applicable: false, note: 'generated model: no authoring data to check' } };
  const r = (p.report ?? {}) as Record<string, unknown>;
  const issues: Draft[] = [];
  const all = [...Array(S.n).keys()];
  const add = (severity: Severity, title: string, detail: string, action: string, parts: number[]) =>
    issues.push({ rule: 'MODEL-DATA', severity, title, detail, action, primary: parts, secondary: [], step: parts.length ? Math.min(...parts.map((i) => S.step[i])) : 0, at: parts.length ? centreOf(S, parts) : [0, 0, 0], box: unionBox(S, parts.length ? parts : all, 0.5), lines: [] });
  const outside = Number(r.openingsOutside ?? 0);
  const hosts = new Set((r.openingsOutsideHosts as string[] | undefined) ?? []);
  if (outside) add('minor', `${plural(outside, 'opening')} placed clear of ${outside === 1 ? 'its host' : 'their hosts'}`, `The file relates ${plural(outside, 'opening')} to elements ${outside === 1 ? 'it does' : 'they do'} not touch (placed a storey away or mirrored), so nothing was cut.`, 'Re-host the openings in the authoring model and re-export.', all.filter((i) => hosts.has(p.parts[i].ref?.guid ?? '')));
  const defaulted = all.filter((i) => p.parts[i].ref?.defaulted);
  const nDefault = Number(r.defaultedMaterials ?? 0);
  if (nDefault) add('note', `${plural(nDefault, 'element')} without a material`, `Mass, carbon and handling for ${plural(nDefault, 'element')} use a default material for their type.`, 'Assign materials in the authoring model so quantities and lift weights are real.', defaulted);
  const openShells = all.filter((i) => !S.solid[i] && S.role[i] !== 'setout');
  if (openShells.length) add('note', `${plural(openShells.length, 'element')} modelled as open surfaces`, `${plural(openShells.length, 'element')} (${[...new Set(openShells.map((i) => S.cat[i]))].join(', ')}) are not closed solids: their volumes are estimated and clash and handling checks skip them.`, 'Export these as solids, or accept the estimates.', openShells);
  const skipped = Object.entries((r.skippedItems ?? {}) as Record<string, number>);
  if (skipped.length) add('minor', `${skipped.reduce((a, [, n]) => a + n, 0)} geometry items not drawn`, `Unsupported representation items: ${skipped.map(([k, n]) => `${k} × ${n}`).join(', ')}.`, 'Export with faceted (Brep or tessellated) geometry where possible.', []);
  const approx = Number(r.booleansApproximated ?? 0);
  if (approx) add('note', `${plural(approx, 'boolean')} approximated`, `${plural(approx, 'boolean operation')} could not be applied exactly; affected elements keep part of their volume.`, 'Check the elements in the authoring tool; export them as faceted solids.', []);
  return { issues, result: { checked: 4, applicable: true, note: issues.length ? `${plural(issues.length, 'gap')} in the model data` : 'no gaps found' } };
}

export type { Obb };
