/**
 * Arbor House: the generated sample project (stage table, zones, crane,
 * curated fly-through). Imported IFC models are assembled by src/ifc/sequence.ts.
 */
import { CRANE, GIFA, LEVELS, ROOF, STOREYS, contextMassing, generateTower, levelY } from './generator';
import { assembleProject, type StageConfig } from './assemble';
import type { PresentationSpec, Project, ZoneDef } from './types';

export { ACTIVE_HOLD, PART_ANIM } from './assemble';

/**
 * Stage table. Assembly windows are sized from their step counts. Façades trail the
 * frame by two floors and go in with the frame level being erected (generator.ts tower()),
 * so each tower stage builds the façades, sky garden and terrace of the floors below it.
 */
const STAGES: StageConfig[] = [
  { code: 'SITE', tick: 'SITE', title: 'GROUNDWORKS', zones: ['SITE'], kind: 'assembly', sheet: 'A-201', subtitle: (n) => `piles · raft · crane · ${n} steps` },
  { code: 'PODIUM', tick: 'PODIUM', title: 'PODIUM & CORE', zones: ['PODIUM'], kind: 'assembly', sheet: 'A-202', subtitle: (n) => `RC frame · transfer deck · ${n} steps` },
  { code: 'LOWER', tick: 'L03', title: 'LOWER TOWER', zones: ['LOWER'], kind: 'assembly', sheet: 'A-203', subtitle: (n) => `L03–L12 · façades to L10 · ${n} steps` },
  { code: 'MIDDLE', tick: 'L13', title: 'MID TOWER', zones: ['MIDDLE'], kind: 'assembly', sheet: 'A-204', subtitle: (n) => `L13–L22 · L12 sky garden · ${n} steps` },
  { code: 'UPPER', tick: 'L23', title: 'UPPER TOWER', zones: ['UPPER'], kind: 'assembly', sheet: 'A-205', subtitle: (n) => `L23–L31 · L22 sky garden · L24 terrace · ${n} steps` },
  { code: 'CROWN', tick: 'CROWN', title: 'CROWN & GARDENS', zones: ['CROWN'], kind: 'assembly', sheet: 'A-206', subtitle: (n) => `PV canopy · trees · ${n} steps` },
  { code: 'MATERIAL', tick: 'MAT', title: 'MATERIAL PASS', zones: [], kind: 'material', sheet: 'A-207', seconds: 4.0, subtitle: () => 'timber · envelope · 2 passes · 4.0 s' },
  { code: 'SECTION', tick: 'SECT', title: 'SECTION A–A', zones: [], kind: 'section', sheet: 'A-208', seconds: 6.8, subtitle: () => 'sky gardens · fly-through · 6.8 s' },
];

const ZONES: ZoneDef[] = [
  { id: 'SITE', label: 'SITE', y0: -6, y1: 0 },
  { id: 'PODIUM', label: 'PODIUM', y0: 0, y1: levelY(3) },
  { id: 'LOWER', label: 'LOWER', y0: levelY(3), y1: levelY(13) },
  { id: 'MIDDLE', label: 'MIDDLE', y0: levelY(13), y1: levelY(23) },
  { id: 'UPPER', label: 'UPPER', y0: levelY(23), y1: levelY(32) },
  { id: 'CROWN', label: 'CROWN', y0: levelY(32), y1: levelY(32) + 6 },
];

export const ARBOR_CUT_AT = 9.6;
const fmt = (n: number) => Math.round(n).toLocaleString('en-GB').replace(/,/g, ' ');

function arborPresentation(p: Omit<Project, 'presentation'>): PresentationSpec {
  const H = p.height;
  const mid = H * 0.5;
  const at = ARBOR_CUT_AT;
  const storedT = Math.round(p.totalBiogenicKg / 1000);
  return {
    cut: { normal: [1, 0, 0], at, open: 40 },
    keys: [
      { t: 0.0, target: [0, mid, 0], az: 90, el: 6, dist: 330, fov: 26 },
      { t: 0.9, target: [2, mid, 0], az: 90, el: 6, dist: 330, fov: 26 },
      { t: 1.9, target: [at, levelY(12) + 3.3, 4], az: 98, el: 5, dist: 64, fov: 34 },
      { t: 2.8, target: [at, levelY(14) + 1.5, 2], az: 92, el: 4, dist: 58, fov: 36 },
      { t: 3.8, target: [at, levelY(24) + 2, 7], az: 104, el: 7, dist: 70, fov: 36 },
      { t: 4.7, target: [at, ROOF + 2.5, 0], az: 114, el: 14, dist: 78, fov: 34 },
      { t: 5.6, target: [0, mid, 0], az: 124, el: 9, dist: 345, fov: 26 },
    ],
    shots: [
      { id: 'M-00', stage: 'material', dt: 0.05, title: 'TC-1 · CRANE DISMANTLED', spec: 'sections lowered by a mobile crane at street level', anchor: null },
      { id: 'M-01', stage: 'material', dt: 0.15, title: 'MATERIAL PASS 1/2 · STRUCTURE', spec: 'glulam · CLT · C40/50 concrete · natural finishes', anchor: [-14, levelY(8) + 1.6, 14] },
      { id: 'M-02', stage: 'material', dt: 1.6, title: 'MATERIAL PASS 2/2 · ENVELOPE & PLANTING', spec: 'triple glazing · terracotta fins · bronze spandrels · planting', anchor: [0, levelY(18) + 1.6, 14.2] },
      { id: 'M-03', stage: 'material', dt: 2.9, title: 'TIMBER · CARBON STORED', spec: `≈ ${fmt(storedT)} tCO₂e held in the glulam and CLT · indicative`, anchor: [-7, levelY(20) + 1.6, 14.2] },
      { id: 'S-01', stage: 'section', dt: 0.1, title: 'SECTION A–A · CUT PLANE', spec: `x = ${at} m through the east bay · cut faces hatched`, anchor: [at, H * 0.66, -9] },
      { id: 'S-02', stage: 'section', dt: 0.95, title: 'CAMERA · DOLLY IN TO L12', spec: '330 → 64 m · lens 52 → 39 mm', anchor: null },
      { id: 'S-03', stage: 'section', dt: 1.9, title: 'SKY GARDEN · L12–L13 IN SECTION', spec: 'double-height loggia · trees in 600 mm beds · CLT slab cut', anchor: [at, levelY(12) + 2.8, 9] },
      { id: 'S-04', stage: 'section', dt: 2.8, title: 'BATHROOM PODS IN SECTION', spec: 'prefab pods sit on each CLT slab · 2.6 m high', anchor: [at, levelY(14) + 1.3, 2.4] },
      { id: 'S-05', stage: 'section', dt: 3.8, title: 'SKY TERRACE · L24 SETBACK', spec: 'floors above step back one bay · planted communal terrace', anchor: [at, levelY(24) + 1.4, 11.5] },
      { id: 'S-06', stage: 'section', dt: 4.7, title: 'CROWN · PV CANOPY & GREEN ROOF', spec: '32 PV modules on a glulam pergola · biodiverse roof', anchor: [at, ROOF + 4.3, -3.5] },
      { id: 'S-07', stage: 'section', dt: 5.6, title: 'SECTION A–A · CLOSING', spec: 'plane → 40.0 m · the model closes back up', anchor: null },
    ],
    log: [
      { dt: 0.95, kind: 'CAM', text: 'CAM dolly in · 330 → 64 m · fov 26° → 34°' },
      { dt: 1.9, kind: 'VIEW', text: 'VIEW sky garden L12–L13 · double-height loggia in section' },
      { dt: 2.8, kind: 'VIEW', text: `VIEW bathroom pods cut at x = ${at} m` },
      { dt: 3.3, kind: 'CAM', text: `CAM crane up · target +${(levelY(14) + 1.5).toFixed(0)} → +${(levelY(24) + 2).toFixed(0)} m` },
      { dt: 3.8, kind: 'VIEW', text: 'VIEW L24 sky terrace · setback in section' },
      { dt: 4.7, kind: 'VIEW', text: 'VIEW crown · PV canopy and green roof' },
      { dt: 5.15, kind: 'CAM', text: 'CAM pull back · 78 → 345 m · fov 34° → 26°' },
    ],
  };
}

export function buildProject(): Project {
  return assembleProject({
    id: 'AR-32',
    name: 'Arbor House',
    subtitle: '32-storey hybrid timber residential tower · built in install order',
    rev: 'C',
    revDate: '11/26',
    storeys: STOREYS,
    gifa: GIFA,
    levels: LEVELS,
    zones: ZONES,
    stages: STAGES,
    defs: generateTower(),
    context: contextMassing(),
    crane: CRANE,
    secondsPerStep: 0.105,
    meta: {
      tagline: 'HYBRID MASS TIMBER · 32 STOREYS · INSTALL ORDER',
      caption: '32-storey hybrid timber residential tower · built in install order',
      watermark: 'ARBOR',
      source: 'generator',
    },
    presentation: arborPresentation,
  });
}
