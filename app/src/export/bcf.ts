/**
 * BCF 2.1 (BIM Collaboration Format) export: one topic per issue, each with a
 * viewpoint that selects and colours the IFC elements involved, a camera in
 * IFC world coordinates, the issue's measurement lines and an optional PNG
 * snapshot. Opens in BCF-aware tools (Revit and ArchiCAD BCF managers,
 * Solibri, BIMcollab, Navisworks plug-ins) against the same IFC file.
 */
import type { Project, Vec3 } from '../data/types';
import type { CheckReport, Issue, Severity } from '../checks/types';
import { RULE_BY_ID } from '../checks/types';
import { dirToIfc, issueView, modelBounds, toIfc, type ModelBounds } from '../checks/view';
import { zip, type ZipEntry } from './zip';

const PRIORITY: Record<Severity, string> = { critical: 'Critical', major: 'Major', minor: 'Minor', note: 'Info' };
const LABEL: Record<string, string> = { ORDER: 'Sequence', TEMP: 'Temporary works', REACH: 'Crane', CLASH: 'Clash', ACCESS: 'Access', MODEL: 'Model data' };

export const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const num = (v: number) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(4).replace(/\.?0+$/, ''));
const point = (tag: string, v: Vec3) => `<${tag}><X>${num(v[0])}</X><Y>${num(v[1])}</Y><Z>${num(v[2])}</Z></${tag}>`;

/** A stable UUID from text (so a re-export updates topics instead of duplicating them). */
export function stableGuid(text: string): string {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hex = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
  // RFC 9562 version 8 (custom), variant 10
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** GlobalIds of an issue's parts (imported models only). */
function guidsOf(p: Project, parts: number[]): string[] {
  return [...new Set(parts.map((i) => p.parts[i]?.ref?.guid).filter((g): g is string => !!g && /^[0-9A-Za-z_$]{22}$/.test(g)))];
}

/**
 * A topic's GUID, from what the issue is about and never from what was measured:
 * the model file, the rule, the issue's key and its elements (GlobalIds, or the
 * step and part indices on a generated model). Titles carry measured values
 * ("at 116 % of the chart"), so a changed threshold would otherwise open a second
 * topic in the BCF tool instead of updating the first.
 */
export function topicGuid(p: Project, issue: Issue): string {
  const guids = guidsOf(p, [...issue.primary, ...issue.secondary]).sort().join(',');
  // without GlobalIds (generated models) the step and the parts tell two look-alike issues apart
  const parts = guids || `${issue.step}|${issue.primary.slice(0, 50).join(',')}`;
  return stableGuid(`${p.id}|${p.meta.fileName ?? ''}|${issue.rule}|${issue.key ?? ''}|${parts}`);
}

/**
 * Topic GUIDs for a whole register, one per issue. Two issues that share their
 * identity get the second a derived GUID, so no two topics share a folder.
 */
export function topicGuids(p: Project, issues: Issue[]): Map<Issue, string> {
  const out = new Map<Issue, string>();
  const used = new Set<string>();
  for (const issue of issues) {
    const base = topicGuid(p, issue);
    let guid = base;
    for (let n = 2; used.has(guid); n++) guid = stableGuid(`${base}|${n}`);
    used.add(guid);
    out.set(issue, guid);
  }
  return out;
}

export function markupXml(p: Project, issue: Issue, index: number, when: Date, snapshot: boolean, settings: CheckReport['settings'], guid = topicGuid(p, issue)): string {
  const vp = stableGuid(`${guid}|viewpoint`);
  const rule = RULE_BY_ID[issue.rule];
  const date = when.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const step = p.steps[issue.step];
  const desc = [issue.detail, `Action: ${issue.action}`, `Rule ${issue.rule}: ${rule.rule(settings)}`, step ? `Arises at step ${step.id} · ${step.member}.` : ''].filter(Boolean).join('\n\n');
  const header =
    p.meta.source === 'ifc' && p.meta.fileName
      ? `<Header><File${p.meta.ifcProject ? ` IfcProject="${xml(p.meta.ifcProject)}"` : ''} isExternal="true"><Filename>${xml(p.meta.fileName)}</Filename></File></Header>`
      : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Markup>
  ${header}
  <Topic Guid="${guid}" TopicType="${issue.rule.startsWith('CLASH') ? 'Clash' : 'Issue'}" TopicStatus="Open">
    <Title>${xml(`${issue.id} ${issue.title}`)}</Title>
    <Priority>${PRIORITY[issue.severity]}</Priority>
    <Index>${index}</Index>
    <Labels>${xml(LABEL[rule.family] ?? rule.family)}</Labels>
    <Labels>${xml(issue.rule)}</Labels>
    <CreationDate>${date}</CreationDate>
    <CreationAuthor>Arbor Build</CreationAuthor>
    <Description>${xml(desc)}</Description>
  </Topic>
  <Viewpoints Guid="${vp}">
    <Viewpoint>viewpoint.bcfv</Viewpoint>${snapshot ? '\n    <Snapshot>snapshot.png</Snapshot>' : ''}
  </Viewpoints>
</Markup>
`;
}

export function viewpointXml(p: Project, issue: Issue, bounds: ModelBounds = modelBounds(p), topic = topicGuid(p, issue)): string {
  const guid = stableGuid(`${topic}|viewpoint`);
  const off = p.meta.ifcOffset ?? [0, 0, 0];
  const view = issueView(issue, 1.6, bounds);
  const pos = toIfc(view.position, off);
  const d = dirToIfc([view.target[0] - view.position[0], view.target[1] - view.position[1], view.target[2] - view.position[2]]);
  const dl = Math.hypot(d[0], d[1], d[2]) || 1;
  const dir: Vec3 = [d[0] / dl, d[1] / dl, d[2] / dl];
  // up: world +Z made perpendicular to the view direction
  const z: Vec3 = [0, 0, 1];
  const k = dir[2];
  let up: Vec3 = [z[0] - k * dir[0], z[1] - k * dir[1], z[2] - k * dir[2]];
  const ul = Math.hypot(up[0], up[1], up[2]) || 1;
  up = [up[0] / ul, up[1] / ul, up[2] / ul];
  const primary = guidsOf(p, issue.primary);
  const secondary = guidsOf(p, issue.secondary).filter((g) => !primary.includes(g));
  const comp = (g: string) => `<Component IfcGuid="${g}" />`;
  const components = primary.length + secondary.length
    ? `<Components>
    <Selection>${[...primary, ...secondary].map(comp).join('')}</Selection>
    <Visibility DefaultVisibility="true" />
    <Coloring>${primary.length ? `<Color Color="FFB3261E">${primary.map(comp).join('')}</Color>` : ''}${secondary.length ? `<Color Color="FF2F6DB3">${secondary.map(comp).join('')}</Color>` : ''}</Coloring>
  </Components>`
    : '';
  const lines = issue.lines.slice(0, 400);
  const linesXml = lines.length ? `<Lines>${lines.map(([a, b]) => `<Line>${point('StartPoint', toIfc(a, off))}${point('EndPoint', toIfc(b, off))}</Line>`).join('')}</Lines>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${guid}">
  ${components}
  <PerspectiveCamera>${point('CameraViewPoint', pos)}${point('CameraDirection', dir)}${point('CameraUpVector', up)}<FieldOfView>${view.fov}</FieldOfView></PerspectiveCamera>
  ${linesXml}
</VisualizationInfo>
`;
}

const VERSION = `<?xml version="1.0" encoding="UTF-8"?>
<Version VersionId="2.1">
  <DetailedVersion>2.1</DetailedVersion>
</Version>
`;

const projectXml = (p: Project) => `<?xml version="1.0" encoding="UTF-8"?>
<ProjectExtension>
  <Project ProjectId="${stableGuid(`${p.id}|${p.meta.fileName ?? p.name}|project`)}">
    <Name>${xml(p.name)}</Name>
  </Project>
  <ExtensionSchema></ExtensionSchema>
</ProjectExtension>
`;

/**
 * The BCF archive. `snapshots` maps issue ids to PNG bytes (any missing
 * issue simply has no snapshot).
 */
export function bcfZip(p: Project, report: CheckReport, snapshots: Map<string, Uint8Array> = new Map(), when = new Date()): Uint8Array {
  const entries: ZipEntry[] = [{ name: 'bcf.version', data: VERSION }, { name: 'project.bcfp', data: projectXml(p) }];
  const bounds = modelBounds(p);
  const guids = topicGuids(p, report.issues);
  report.issues.forEach((issue, k) => {
    const dir = guids.get(issue)!;
    const snap = snapshots.get(issue.id);
    entries.push({ name: `${dir}/markup.bcf`, data: markupXml(p, issue, k + 1, when, !!snap, report.settings, dir) });
    entries.push({ name: `${dir}/viewpoint.bcfv`, data: viewpointXml(p, issue, bounds, dir) });
    if (snap) entries.push({ name: `${dir}/snapshot.png`, data: snap });
  });
  return zip(entries, when);
}
