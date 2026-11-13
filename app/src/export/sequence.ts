/**
 * The sequence as JSON: the project, how it is lifted (its tower crane or a
 * mobile crane), the check verdict and issues, the stages and every step with
 * its elements. A file that ends early is marked incomplete, and no check on
 * it reads as passed (unverified, file ends early). Positions are written in the
 * same frame as the CSV and the BCF: IFC world coordinates (metres, Z up) for
 * an imported model, and the model's own axes turned Z up for a generated one.
 */
import { MOBILE_CRANE, liftingLabel, type Project, type Vec3 } from '../data/types';
import type { CheckReport } from '../checks/types';
import { toIfc } from '../checks/view';

const round3 = (v: Vec3) => v.map((x) => +x.toFixed(3));

/** Why no check on a file that ends early can be said to have passed. */
const CUT_SHORT = 'file ends early';

export function sequenceJson(project: Project, report: CheckReport | null): string {
  const off = project.meta.ifcOffset ?? [0, 0, 0];
  const at = (v: Vec3) => round3(toIfc(v, off));
  // a file cut off part-way: what was read is written, but nothing about the rest can pass
  const cut = !!(project.report as { truncated?: unknown } | undefined)?.truncated;
  const verdict = (r: CheckReport['rules'][number]) => {
    const status = !r.applicable || !r.checked ? 'unverified' : r.flagged ? 'flagged' : 'passed';
    return cut && status === 'passed'
      ? { rule: r.id, checked: r.checked, flagged: r.flagged, status: 'unverified', reason: CUT_SHORT, note: r.note }
      : { rule: r.id, checked: r.checked, flagged: r.flagged, status, note: r.note };
  };
  return JSON.stringify(
    {
      project: {
        id: project.id,
        name: project.name,
        source: project.meta.source,
        file: project.meta.fileName ?? null,
        coordinates: project.meta.ifcOffset ? 'IFC world, metres, Z up' : 'model axes, metres, Z up',
        storeys: project.storeys,
        height: +project.height.toFixed(2),
        gifaM2: Math.round(project.gifa),
        totalMassKg: Math.round(project.totalMassKg),
        carbonA1A3Kg: Math.round(project.totalCarbonKg),
        biogenicStoredKg: Math.round(project.totalBiogenicKg),
        carbonNote: 'indicative A1–A3 from generic factors, not project EPDs',
        ...(cut
          ? { incomplete: true, incompleteNote: 'The IFC file ends early (its data section is never closed), so elements after the cut are missing: quantities, steps and checks cover only what was read. Export the file again and re-run before relying on it.' }
          : {}),
      },
      lifting: liftingLabel(project.crane),
      crane: project.crane
        ? { kind: 'tower', id: project.crane.id, base: at(project.crane.base), jibM: project.crane.jib, maxKg: project.crane.maxKg, tipKg: project.crane.tipKg, assumed: !!project.crane.assumed }
        : { kind: 'mobile', note: `no tower crane: crane picks by an indicative ${MOBILE_CRANE.label} set up beside the nearest face`, maxKg: MOBILE_CRANE.maxKg, reachM: MOBILE_CRANE.reach },
      checks: report
        ? {
            verdict: report.rules.map(verdict),
            settings: report.settings,
            issues: report.issues.map((i) => ({
              id: i.id,
              severity: i.severity,
              rule: i.rule,
              title: i.title,
              detail: i.detail,
              action: i.action,
              step: project.steps[i.step]?.id ?? null,
              value: i.value ?? null,
              limit: i.limit ?? null,
              unit: i.unit ?? null,
              at: at(i.at),
              elements: [...new Set([...i.primary, ...i.secondary])].slice(0, 200).map((k) => project.parts[k].ref?.guid ?? `part ${k}`),
            })),
          }
        : 'unverified: the checks had not finished when this was saved',
      stages: project.stages,
      steps: project.steps.map((s) => ({
        id: s.id,
        stage: s.stage,
        zone: s.zone,
        member: s.member,
        code: s.code,
        method: s.method,
        qty: s.partCount,
        material: s.material,
        spec: s.spec,
        massKg: Math.round(s.massKg),
        carbonKg: Math.round(s.carbonKg),
        lift: s.lift ? { radiusM: +s.lift.radius.toFixed(1), pieceKg: Math.round(s.lift.pieceKg), capacityKg: Math.round(s.lift.capacityKg), utilisation: +s.lift.util.toFixed(3) } : null,
        centroid: at(s.centroid),
        t0: +s.t0.toFixed(3),
        t1: +s.t1.toFixed(3),
        elements: project.parts.slice(s.partStart, s.partStart + s.partCount).filter((p) => p.ref).map((p) => ({ guid: p.ref!.guid, ifc: p.ref!.ifcType, name: p.ref!.name })),
      })),
    },
    null,
    2,
  );
}
