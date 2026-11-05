/** The issue register as CSV (RFC 4180, UTF-8 with a byte-order mark for spreadsheets). */
import type { Project } from '../data/types';
import { RULE_BY_ID, type CheckReport } from '../checks/types';
import { toIfc } from '../checks/view';
import { partLabel } from '../checks/rules';

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function issuesCsv(p: Project, report: CheckReport, timeOf: (step: number) => number): string {
  const head = ['ID', 'Severity', 'Rule', 'Check', 'Title', 'Detail', 'Action', 'Step', 'Member', 'Time (s)', 'Measured', 'Limit', 'Unit', 'Elements', 'IFC GlobalIds', 'X', 'Y', 'Z'];
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
      step?.id ?? '',
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
  return '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
