/** The issue register as CSV (RFC 4180, UTF-8 with a byte-order mark for spreadsheets). */
import type { Project } from '../data/types';
import { RULE_BY_ID, type CheckReport } from '../checks/types';
import { toIfc } from '../checks/view';
import { partLabel } from '../checks/rules';

/**
 * One CSV field. Text that a spreadsheet would read as a formula (it starts
 * with = + - @, a tab or a carriage return: an element named "=1+1", a storey
 * named "+0.00 Level 1") gets a leading apostrophe, so it stays text. Numbers
 * are written as they are, so negative coordinates stay numbers.
 */
export const csvCell = (v: unknown) => {
  let s = v === undefined || v === null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A step's number (step "016" is 16): spreadsheets drop the zero padding of a bare "016" anyway. */
const stepNumber = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);

export function issuesCsv(p: Project, report: CheckReport, timeOf: (step: number) => number): string {
  const head = ['ID', 'Severity', 'Rule', 'Check', 'Title', 'Detail', 'Action', 'Step No.', 'Member', 'Time (s)', 'Measured', 'Limit', 'Unit', 'Elements', 'IFC GlobalIds', 'X', 'Y', 'Z'];
  const off = p.meta.ifcOffset ?? [0, 0, 0];
  const rows = report.issues.map((i) => {
    const parts = [...i.primary, ...i.secondary];
    const step = p.steps[i.step];
    const at = toIfc(i.at, off);
    const fmt = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '' : +v.toFixed(4));
    return [
      i.id,
      i.severity,
      i.rule,
      RULE_BY_ID[i.rule].title,
      i.title,
      i.detail,
      i.action,
      step ? stepNumber(step.id) : '',
      step?.member ?? '',
      +timeOf(i.step).toFixed(2),
      fmt(i.value),
      fmt(i.limit),
      i.unit ?? '',
      parts.slice(0, 60).map((k) => partLabel(p, k)).join('; ') + (parts.length > 60 ? `; … ${parts.length - 60} more` : ''),
      [...new Set(parts.map((k) => p.parts[k].ref?.guid).filter(Boolean))].join(' '),
      +at[0].toFixed(3),
      +at[1].toFixed(3),
      +at[2].toFixed(3),
    ];
  });
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
