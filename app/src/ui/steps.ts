/**
 * Where the playhead goes to show one step: the step list, the issue
 * register, the ← and → keys, the CSV and the BCF stills all seek here.
 * Pure, so it is tested against both projects without a page.
 */
import { ACTIVE_HOLD } from '../data/assemble';
import type { StageDef, Step } from '../data/types';

/**
 * A time at which `index` is the current step, as settled as it can be: just
 * after its last part lands (by ACTIVE_HOLD), but before the next step starts
 * and inside the step's own stage, so the stage title, the caption and a BCF
 * still never show the stage after it.
 */
export function timeForStep(steps: readonly Pick<Step, 't0' | 't1' | 'stage'>[], stages: readonly Pick<StageDef, 'n' | 'start' | 'end'>[], index: number): number {
  const s = steps[index];
  if (!s) return 0;
  const after = steps[index + 1];
  const own = stages.find((st) => st.n === s.stage);
  let t = s.t1 + ACTIVE_HOLD;
  if (after) t = Math.min(t, after.t0 - 1e-3);
  if (own && own.end > s.t0) t = Math.min(t, own.end - 1e-3);
  return Math.max(s.t0 + 1e-3, t);
}
