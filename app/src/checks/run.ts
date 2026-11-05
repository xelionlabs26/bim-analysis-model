/**
 * Runs every buildability rule over a project and returns the issue register
 * with a per-rule verification summary. Long rules yield to the page so the
 * viewer keeps drawing while they work.
 */
import type { Project } from '../data/types';
import { CheckScene } from './scene';
import { checkClashes, checkCrane, checkCraneClearance, checkEdges, checkHandling, checkHeadroom, checkLiftPath, checkModelData, checkSupport, checkTransport, type Draft, type RuleOutput } from './rules';
import { DEFAULT_SETTINGS, RULES, RULE_BY_ID, SEVERITY_ORDER, type CheckReport, type CheckSettings, type Issue, type RuleId, type RuleResult } from './types';

export type CheckProgress = (label: string, share: number) => void;

const pause = () => new Promise<void>((r) => setTimeout(r, 0));

export async function runChecks(project: Project, settings: CheckSettings = DEFAULT_SETTINGS, onProgress: CheckProgress = () => {}, yieldToPage = true): Promise<CheckReport> {
  const t0 = performance.now();
  let last = t0;
  const yieldNow = async () => {
    if (!yieldToPage) return;
    if (performance.now() - last < 30) return;
    await pause();
    last = performance.now();
  };
  const S = new CheckScene(project);
  const out = new Map<RuleId, RuleOutput>();
  const steps: [string, () => Promise<void> | void][] = [
    ['support and propping', () => {
      const r = checkSupport(S, settings);
      out.set('ORDER-SUPPORT', r.order);
      out.set('TEMP-PROPS', r.props);
    }],
    ['crane reach', () => void out.set('REACH-CRANE', checkCrane(S, settings))],
    ['lift paths', () => void out.set('REACH-PATH', checkLiftPath(S, settings))],
    ['open edges', async () => void out.set('TEMP-EDGE', await checkEdges(S, settings, yieldNow))],
    ['clashes', async () => void out.set('CLASH-HARD', await checkClashes(S, settings, yieldNow))],
    ['crane clearance', () => void out.set('CLASH-TEMP', checkCraneClearance(S, settings))],
    ['stair headroom', () => void out.set('ACCESS-HEADROOM', checkHeadroom(S, settings))],
    ['manual handling', () => void out.set('ACCESS-HANDLING', checkHandling(S, settings))],
    ['transport', () => void out.set('ACCESS-TRANSPORT', checkTransport(S, settings))],
    ['model data', () => void out.set('MODEL-DATA', checkModelData(S, settings))],
  ];
  for (let k = 0; k < steps.length; k++) {
    onProgress(steps[k][0], k / steps.length);
    await steps[k][1]();
    await yieldNow();
  }
  onProgress('done', 1);
  // number issues per rule, most severe and earliest first
  const issues: Issue[] = [];
  const rules: RuleResult[] = [];
  for (const info of RULES) {
    const o = out.get(info.id);
    if (!o) continue;
    const sorted = o.issues.slice().sort((a: Draft, b: Draft) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.step - b.step);
    sorted.forEach((d, k) => issues.push({ ...d, id: `${info.code}-${String(k + 1).padStart(2, '0')}` }));
    rules.push({ id: info.id, ...o.result, flagged: o.issues.length });
  }
  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.step - b.step || a.id.localeCompare(b.id));
  return { issues, rules, settings, ms: performance.now() - t0 };
}

/** One-line status of a rule: passed, flagged, or unverified when there was nothing to check. */
export function ruleStatus(r: RuleResult): 'passed' | 'flagged' | 'unverified' {
  if (!r.applicable || r.checked === 0) return 'unverified';
  return r.flagged ? 'flagged' : 'passed';
}

export { RULE_BY_ID };
