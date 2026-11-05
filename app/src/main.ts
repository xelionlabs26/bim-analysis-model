import '@fontsource/big-shoulders-display/700';
import '@fontsource/big-shoulders-display/800';
import '@fontsource/big-shoulders-display/900';
import '@fontsource/instrument-sans/400';
import '@fontsource/instrument-sans/500';
import '@fontsource/instrument-sans/600';
import '@fontsource/instrument-sans/700';
import '@fontsource/instrument-serif/400';
import '@fontsource/instrument-serif/400-italic';
import '@fontsource/geist-mono/400';
import '@fontsource/geist-mono/500';
import '@fontsource/geist-mono/700';
import './styles.css';

import { buildProject } from './data/project';
import { ACTIVE_HOLD } from './data/assemble';
import type { Project, Vec3 } from './data/types';
import { Timeline } from './engine/timeline';
import { Playback } from './engine/playback';
import type { CutState } from './engine/presentation';
import { CONTEXT_STAGE, VIEW_PRESETS, Viewer, type RenderStyle } from './scene/viewer';
import { Overlays, drawingScale, scaleBarLength } from './ui/overlays';
import { SequenceUI } from './ui/panels';
import { renderHeaderDrawing, startClock } from './ui/header';
import { hydrateIcons, ICONS, setIcon } from './ui/icons';
import { readIfc } from './ifc/model';
import { projectFromIfc } from './ifc/sequence';
import { runChecks } from './checks/run';
import { DEFAULT_SETTINGS, type CheckReport, type CheckSettings, type Issue, type RuleId } from './checks/types';
import { issueView, modelBounds, type ModelBounds } from './checks/view';
import { IssuesUI, rulesTable } from './ui/issues';
import { bcfZip } from './export/bcf';
import { issuesCsv } from './export/csv';
import type { CameraPose } from './engine/presentation';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-GB').replace(/,/g, ' ');

const SAMPLE_URL = 'samples/duplex-apartment.ifc.txt';
const SAMPLE_NAME = 'Duplex_A_20110907.ifc';
const SAMPLE_CREDIT = 'Duplex Apartment · BSI (2020) “Duplex Apartment Test Files”, buildingSMART International · CC BY 4.0';

// ── state ──────────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
let project: Project = buildProject();
let timeline = new Timeline(project);
const playback = new Playback(project.duration);
if (params.has('t')) playback.seek(Number(params.get('t')));
else if (reduceMotion) playback.seek(project.duration); // open on the finished model, paused
if (params.get('paused') === '1' || (reduceMotion && !params.has('t'))) playback.playing = false;

hydrateIcons();
startClock($('clockDate'), $('clockTime'));

const viewer = new Viewer($('viewport'), project);
let overlays: Overlays;
let ui: SequenceUI;

const view = {
  style: 'ink+paint' as RenderStyle,
  colour: false,
  ghost: true,
  crane: true,
  // manual section, independent of the stage-08 fly-through
  section: { on: false, plane: 'A' as 'A' | 'B', d: 0 },
  autoRotate: params.get('rotate') !== '0' && !reduceMotion,
  orbit: true,
  presetIndex: 0,
  stageMask: 511,
  resolution: 1.5,
  rail: 'model',
  tab: 'seq' as 'seq' | 'members' | 'issues',
  flags: true,
};
let issuesUI: IssuesUI;
let report: CheckReport | null = null;
let checkSettings: CheckSettings = { ...DEFAULT_SETTINGS, truck: [...DEFAULT_SETTINGS.truck] };
let checkRun = 0;
/** Camera pose that frames the selected issue; released when playback resumes or the view is dragged. */
let focusPose: CameraPose | null = null;
viewer.setResolution(view.resolution);
viewer.setAutoRotate(view.autoRotate);

/** Bounds of the model in plan, for the section slider. */
function planBounds(p: Project) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const part of p.parts) {
    x0 = Math.min(x0, part.pos[0] - part.size[0] / 2); x1 = Math.max(x1, part.pos[0] + part.size[0] / 2);
    z0 = Math.min(z0, part.pos[2] - part.size[2] / 2); z1 = Math.max(z1, part.pos[2] + part.size[2] / 2);
  }
  return { x0, x1, z0, z1 };
}

let firstFrame = true;

/** Show a project: engine, viewer, overlays, panels, labels. */
function mount(p: Project) {
  project = p;
  timeline = new Timeline(p);
  playback.setDuration(p.duration);
  viewer.setProject(p);
  viewer.setStageMask((view.stageMask = 511));
  $('overlaySvg').innerHTML = '';
  $('overlayHtml').innerHTML = '';
  overlays = new Overlays($('overlaySvg') as unknown as SVGSVGElement, $('overlayHtml'), p, timeline, viewer);
  ui = new SequenceUI(p, timeline, (t) => playback.seek(t), (i) => {
    playback.toggle(false);
    playback.seek(timeForStep(i));
  });
  report = null;
  focusPose = null;
  checkRun++;
  document.body.dataset.checks = '';
  issuesUI = new IssuesUI(p, viewer, timeForStep, { select: selectIssue, exportBcf: () => void exportBcf(), exportCsv: () => void exportCsv() });
  syncLiftWarn();
  renderRulesPanel();
  renderHeaderDrawing($('headerDrawing'), p, p.stages[0].sheet);
  $('tagline').textContent = p.meta.tagline;
  $('capTitle').textContent = `${p.name} — Assembly Drawing`;
  $('capSub').textContent = p.meta.caption;
  $('tbName').textContent = p.name.toUpperCase();
  document.querySelector('.watermark')!.textContent = p.meta.watermark;
  view.section = { on: false, plane: 'A', d: +p.presentation.cut.at.toFixed(1) };
  $('btnSection').classList.remove('on');
  updateRail();
  stageStarts = p.stages.map((s) => s.start);
  firstFrame = true;
  document.body.dataset.ready = '';
  if (view.rail === 'import') renderDrawer();
  syncButtons();
}

function syncButtons() {
  $('btnRotate').classList.toggle('on', view.autoRotate);
  $('btnColour').classList.toggle('on', view.colour);
  $('btnGhost').classList.toggle('on', view.ghost);
  $('btnCrane').classList.toggle('on', view.crane);
  $('btnOrbit').classList.toggle('toggle', true);
  $('btnOrbit').classList.toggle('on', view.orbit);
  $('btnFrame').classList.toggle('on', viewer.autoFrame);
  $('speedVal').textContent = `×${playback.speed}`;
  const playIcon = playback.playing ? 'pause' : 'play';
  setIcon($('btnPlay'), playIcon);
  setIcon($('btnPlay2'), playIcon);
  $<HTMLSelectElement>('selStyle').value = view.style;
  document.querySelectorAll<HTMLElement>('.rail-item').forEach((b) => b.classList.toggle('on', b.dataset.id === view.rail));
  $('tabSeq').classList.toggle('on', view.tab === 'seq');
  $('tabMembers').classList.toggle('on', view.tab === 'members');
  $('tabIssues').classList.toggle('on', view.tab === 'issues');
  $('paneSeq').hidden = view.tab !== 'seq';
  $('paneMembers').hidden = view.tab !== 'members';
  $('paneIssues').hidden = view.tab !== 'issues';
  $('btnFlags').classList.toggle('on', view.flags);
}
playback.onChange(() => {
  // pressing play hands the camera back to the sequence
  if (playback.playing && focusPose) focusPose = null;
  syncButtons();
});

// ── Rail ───────────────────────────────────────────────────────────────────
const RAIL: { id: string; label: string; icon: string }[] = [
  { id: 'model', label: 'Model', icon: 'model' },
  { id: 'layers', label: 'Layers', icon: 'layers' },
  { id: 'parts', label: 'Parts', icon: 'parts' },
  { id: 'section', label: 'Section', icon: 'section' },
  { id: 'render', label: 'Render', icon: 'render' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'import', label: 'Import', icon: 'upload' },
];
const railWrap = $('railItems');
RAIL.forEach((r, i) => {
  const b = document.createElement('button');
  b.className = 'rail-item';
  b.dataset.id = r.id;
  b.title = `${r.label} (${i + 1})`;
  b.innerHTML = `<span class="ico">${ICONS[r.icon]}</span><span class="lbl">${r.label}</span><span class="sub" id="rail-sub-${r.id}"></span><span class="key">${i + 1}</span>`;
  b.addEventListener('click', () => selectRail(r.id));
  railWrap.append(b);
});
function updateRail() {
  $('rail-sub-model').textContent = `${project.storeys} STOREYS`;
  $('rail-sub-layers').textContent = `${project.stages.length} STAGES`;
  $('rail-sub-parts').textContent = project.parts.length >= 1000 ? `${(project.parts.length / 1000).toFixed(1)}K PCS` : `${project.parts.length} PCS`;
  $('rail-sub-section').textContent = 'A – A';
  $('rail-sub-render').textContent = view.style === 'ink' ? 'INK' : view.style === 'paint' ? 'PAINT' : 'INK + PAINT';
  $('rail-sub-settings').textContent = `MSAA · ${view.resolution.toFixed(1)}×`;
  $('rail-sub-import').textContent = project.meta.source === 'ifc' ? 'IFC' : 'SAMPLE';
}

const drawer = $('drawer');
function selectRail(id: string) {
  if (!RAIL.some((r) => r.id === id)) return;
  view.rail = view.rail === id && id !== 'model' ? 'model' : id;
  if (view.rail === 'parts') view.tab = 'members';
  renderDrawer();
  syncButtons();
}

function renderDrawer() {
  const id = view.rail;
  drawer.hidden = !['layers', 'render', 'settings', 'import', 'section'].includes(id);
  drawer.classList.toggle('wide', id === 'import');
  $('caption').style.visibility = drawer.hidden ? 'visible' : 'hidden';
  if (drawer.hidden) return;
  if (id === 'layers') {
    drawer.innerHTML =
      '<h5>LAYERS · STAGES</h5>' +
      project.stages
        .map(
          (s, i) =>
            `<label><input type="checkbox" data-bit="${i}" ${view.stageMask & (1 << i) ? 'checked' : ''} ${s.kind === 'assembly' ? '' : 'disabled'} /> ${String(s.n).padStart(2, '0')} · ${esc(s.title)}${s.kind === 'assembly' ? '' : ' <span class="muted">(view pass)</span>'}</label>`,
        )
        .join('') +
      `<label><input type="checkbox" data-bit="${CONTEXT_STAGE - 1}" ${view.stageMask & (1 << (CONTEXT_STAGE - 1)) ? 'checked' : ''} /> ${project.meta.source === 'ifc' ? 'Site and terrain' : 'Context massing'}</label>`;
    drawer.querySelectorAll<HTMLInputElement>('input').forEach((inp) =>
      inp.addEventListener('change', () => {
        const bit = 1 << Number(inp.dataset.bit);
        view.stageMask = inp.checked ? view.stageMask | bit : view.stageMask & ~bit;
        viewer.setStageMask(view.stageMask);
      }),
    );
  } else if (id === 'render') {
    const opts: [RenderStyle, string][] = [['ink', 'Ink'], ['ink+paint', 'Ink + Paint'], ['paint', 'Paint']];
    drawer.innerHTML = `<h5>RENDER STYLE</h5><div class="opts">${opts.map(([v, l]) => `<button data-v="${v}" class="${view.style === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <h5 style="margin-top:14px">COLOUR</h5><div class="opts"><button data-c="0" class="${view.colour ? '' : 'on'}">Drawing</button><button data-c="1" class="${view.colour ? 'on' : ''}">Materials</button></div>`;
    drawer.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => b.addEventListener('click', () => (setStyle(b.dataset.v as RenderStyle), renderDrawer())));
    drawer.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => b.addEventListener('click', () => (setColour(b.dataset.c === '1'), renderDrawer())));
  } else if (id === 'settings') {
    drawer.innerHTML = `<h5>RESOLUTION SCALE</h5><div class="opts">${[1, 1.5, 2].map((r) => `<button data-r="${r}" class="${view.resolution === r ? 'on' : ''}">${r.toFixed(1)}×</button>`).join('')}</div>
      <p style="margin-top:12px">MSAA is on. Higher scales sharpen ink lines at a GPU cost.</p>`;
    drawer.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) =>
      b.addEventListener('click', () => {
        view.resolution = Number(b.dataset.r);
        viewer.setResolution(view.resolution);
        updateRail();
        renderDrawer();
      }),
    );
  } else if (id === 'section') {
    const sec = view.section;
    const b = planBounds(project);
    const range = sec.plane === 'A' ? [b.x0, b.x1] : [b.z0, b.z1];
    drawer.innerHTML = `<h5>SECTION</h5>
      <label><input type="checkbox" id="secOn" ${sec.on ? 'checked' : ''} /> Cut the model (S)</label>
      <div class="opts" style="margin:8px 0 10px">
        <button data-plane="A" class="${sec.plane === 'A' ? 'on' : ''}">A–A · along x</button>
        <button data-plane="B" class="${sec.plane === 'B' ? 'on' : ''}">B–B · along z</button>
      </div>
      <label for="secD">Offset <b class="mono" id="secDv">${sec.d.toFixed(1)} m</b></label>
      <input type="range" id="secD" min="${range[0].toFixed(1)}" max="${range[1].toFixed(1)}" step="0.1" value="${sec.d}" style="width:100%" />
      <p style="margin-top:8px">Stage 08 runs its own cut and fly-through; this one stays until you turn it off.</p>`;
    $<HTMLInputElement>('secOn').addEventListener('change', (e) => setSection({ on: (e.target as HTMLInputElement).checked }));
    drawer.querySelectorAll<HTMLButtonElement>('[data-plane]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const plane = btn.dataset.plane as 'A' | 'B';
        setSection({ on: true, plane, d: plane === 'A' ? +project.presentation.cut.at.toFixed(1) : +((b.z0 + b.z1) / 2).toFixed(1) });
        renderDrawer();
      }),
    );
    $<HTMLInputElement>('secD').addEventListener('input', (e) => {
      setSection({ on: true, d: Number((e.target as HTMLInputElement).value) });
      $('secDv').textContent = `${view.section.d.toFixed(1)} m`;
      $<HTMLInputElement>('secOn').checked = true;
    });
  } else if (id === 'import') {
    renderImportDrawer();
  }
}

function renderImportDrawer() {
  const r = project.report as Record<string, unknown> | undefined;
  const isIfc = project.meta.source === 'ifc' && r;
  const rows: string[] = [];
  if (isIfc) {
    const byCat = (r.byCategory ?? {}) as Record<string, number>;
    const skipped = Object.entries((r.skippedItems ?? {}) as Record<string, number>);
    const warnings = (r.warnings ?? []) as string[];
    rows.push(
      `<dl class="report mono">
        <dt>File</dt><dd>${esc(project.meta.fileName ?? '')}</dd>
        <dt>Schema</dt><dd>${esc(String(r.schema))} · ${esc(String(r.application || '—'))}</dd>
        <dt>Units</dt><dd>${esc(String(r.lengthUnit))}</dd>
        <dt>Elements</dt><dd>${fmtInt(Number(r.meshed))} meshed${Number(r.noGeometry) ? ` · ${r.noGeometry} without body geometry` : ''}</dd>
        <dt>Openings</dt><dd>${r.openingsCut} cut${Number(r.openingsSkipped) ? ` · ${r.openingsSkipped} not cut` : ''}${Number(r.openingsOutside) ? ` · ${r.openingsOutside} clear of host` : ''}</dd>
        <dt>Clips</dt><dd>${r.clipsApplied} applied${Number(r.booleansApproximated) ? ` · ${r.booleansApproximated} approximated` : ''}</dd>
        <dt>Materials</dt><dd>${Number(r.defaultedMaterials) ? `${r.defaultedMaterials} defaulted by element type` : 'all from the file'}</dd>
        <dt>Steps</dt><dd>${project.steps.length} in ${project.stages.filter((s) => s.kind === 'assembly').length} stages</dd>
      </dl>
      <p class="cats mono">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</p>
      ${skipped.length ? `<p class="warn">Not drawn: ${skipped.map(([k, v]) => `${esc(k.replace(/^IFC/, 'Ifc'))} × ${v}`).join(', ')}</p>` : ''}
      ${warnings.map((w) => `<p class="warn">${esc(w)}</p>`).join('')}`,
    );
  }
  drawer.innerHTML = `<h5>IMPORT IFC</h5>
    <p>Load a model exported from Revit, ArchiCAD, Tekla or any IFC tool. It is read in your browser and never uploaded.</p>
    <div class="opts" style="margin:10px 0">
      <button id="btnOpenIfc" class="primary">Open IFC file…</button>
      <button id="btnSampleIfc">Real sample: Duplex (Revit)</button>
      <button id="btnArbor">Arbor House</button>
    </div>
    <p class="muted">Or drop an .ifc file onto the model.</p>
    ${rows.join('')}
    ${project.meta.fileName === SAMPLE_NAME ? `<p class="credit">${esc(SAMPLE_CREDIT)}</p>` : ''}`;
  $('btnOpenIfc').addEventListener('click', () => $<HTMLInputElement>('fileIfc').click());
  $('btnSampleIfc').addEventListener('click', () => void loadSample());
  $('btnArbor').addEventListener('click', () => {
    mount(buildProject());
    playback.seek(0);
    playback.toggle(true);
    toast('Loaded Arbor House');
  });
}

// ── IFC import ─────────────────────────────────────────────────────────────
const loading = $('loading');
function showLoading(label: string, share: number) {
  loading.hidden = false;
  $('loadingLabel').textContent = label;
  $('loadingBar').style.width = `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`;
}
const PHASE_LABEL = { parse: 'Reading the IFC file', geometry: 'Meshing elements', finish: 'Measuring elements' } as const;

async function importIfcText(text: string, fileName: string) {
  const t0 = performance.now();
  try {
    const model = await readIfc(text, (phase, share) => showLoading(PHASE_LABEL[phase], share), fileName);
    showLoading('Working out the build order', 1);
    await new Promise((r) => setTimeout(r, 0));
    const { project: p } = projectFromIfc(model, fileName);
    mount(p);
    playback.seek(0);
    playback.toggle(true);
    const s = ((performance.now() - t0) / 1000).toFixed(1);
    toast(`Loaded ${fileName} · ${fmtInt(model.elements.length)} elements · ${s} s`);
  } catch (err) {
    console.error(err);
    toast(`Could not read ${fileName}: ${(err as Error).message ?? err}`);
  } finally {
    loading.hidden = true;
  }
}

async function importFile(file: File) {
  if (!/\.ifc(\.txt)?$/i.test(file.name)) {
    toast(`${file.name} is not an .ifc file. Export IFC from your BIM tool and try again.`);
    return;
  }
  showLoading(`Opening ${file.name}`, 0);
  const text = await file.text();
  await importIfcText(text, file.name);
}

async function loadSample() {
  showLoading('Fetching the Duplex sample', 0);
  try {
    const res = await fetch(SAMPLE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await importIfcText(await res.text(), SAMPLE_NAME);
  } catch (err) {
    loading.hidden = true;
    toast(`Could not load the sample (${(err as Error).message}).`);
  }
}

$<HTMLInputElement>('fileIfc').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (f) void importFile(f);
});
const vp = $('viewport');
let dragDepth = 0;
vp.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  $('dropHint').hidden = false;
});
vp.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
vp.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('dropHint').hidden = true;
});
vp.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropHint').hidden = true;
  const f = e.dataTransfer?.files?.[0];
  if (f) void importFile(f);
});

// ── Toolbar / transport ────────────────────────────────────────────────────
function setStyle(s: RenderStyle) {
  view.style = s;
  viewer.setStyle(s);
  updateRail();
  syncButtons();
}
function setColour(on: boolean) {
  view.colour = on;
  viewer.setColour(on);
  syncButtons();
}
function manualCut(): CutState {
  const n: Vec3 = view.section.plane === 'A' ? [1, 0, 0] : [0, 0, 1];
  return { on: true, normal: n, d: view.section.d };
}
function setSection(patch: Partial<typeof view.section>) {
  Object.assign(view.section, patch);
  $('btnSection').classList.toggle('on', view.section.on);
  $('rail-sub-section').textContent = view.section.on ? `${view.section.plane}–${view.section.plane} · ${view.section.d.toFixed(1)} m` : 'A – A';
}

let stageStarts = project.stages.map((s) => s.start);
function jumpStage(dir: 1 | -1) {
  const t = playback.t;
  const cur = stageStarts.reduce((a, s, i) => (t >= s - 1e-3 ? i : a), 0);
  const target = dir > 0 ? Math.min(cur + 1, stageStarts.length - 1) : t - stageStarts[cur] > 0.6 ? cur : Math.max(cur - 1, 0);
  playback.seek(stageStarts[target] + 0.001);
}
/** A time at which `index` is the current step, as settled as it can be before the next one starts. */
function timeForStep(index: number) {
  const s = project.steps[index];
  const after = project.steps[index + 1];
  return after ? Math.max(s.t0 + 1e-3, Math.min(s.t1 + ACTIVE_HOLD, after.t0 - 1e-3)) : s.t1 + ACTIVE_HOLD;
}
function jumpStep(dir: 1 | -1) {
  const i = timeline.stepIndexAt(playback.t);
  playback.toggle(false);
  playback.seek(timeForStep(Math.min(Math.max(i + dir, 0), project.steps.length - 1)));
}
const actions: Record<string, () => void> = {
  play: () => playback.toggle(),
  prev: () => jumpStage(-1),
  next: () => jumpStage(1),
  rebuild: () => {
    playback.seek(0);
    playback.toggle(true);
  },
  rotate: () => {
    view.autoRotate = !view.autoRotate;
    viewer.setAutoRotate(view.autoRotate);
    syncButtons();
  },
  colour: () => setColour(!view.colour),
  section: () => setSection({ on: !view.section.on }),
  frame: () => {
    viewer.autoFrame = true;
    syncButtons();
  },
  speed: () => playback.cycleSpeed(),
  view: () => {
    view.presetIndex = (view.presetIndex + 1) % VIEW_PRESETS.length;
    const v = VIEW_PRESETS[view.presetIndex];
    viewer.setView(v.az, v.el);
    $('btnView').title = `View: ${v.name}`;
  },
  ghost: () => {
    view.ghost = !view.ghost;
    viewer.setGhost(view.ghost);
    syncButtons();
  },
  crane: () => {
    view.crane = !view.crane;
    syncButtons();
  },
  orbit: () => {
    view.orbit = !view.orbit;
    viewer.controls.enabled = view.orbit;
    syncButtons();
  },
};
const bind = (id: string, fn: () => void) => $(id).addEventListener('click', fn);
bind('btnPlay', actions.play);
bind('btnPlay2', actions.play);
bind('btnPrev', actions.prev);
bind('btnNext', actions.next);
bind('btnRebuild', actions.rebuild);
bind('btnRotate', actions.rotate);
bind('btnColour', actions.colour);
bind('btnFrame', actions.frame);
bind('btnSpeed', actions.speed);
bind('btnView', actions.view);
bind('btnGhost', actions.ghost);
bind('btnOrbit', actions.orbit);
bind('btnCrane', actions.crane);
bind('btnSection', actions.section);
bind('btnMenu', () => selectRail(view.rail === 'render' ? 'model' : 'render'));
bind('stagePrev', () => jumpStage(-1));
bind('stageNext', () => jumpStage(1));
bind('tabSeq', () => ((view.tab = 'seq'), syncButtons()));
bind('tabMembers', () => ((view.tab = 'members'), syncButtons()));
bind('tabIssues', () => ((view.tab = 'issues'), syncButtons()));
bind('btnFlags', () => {
  view.flags = !view.flags;
  viewer.setFlagsVisible(view.flags);
  syncButtons();
});
bind('btnBcf', () => void exportBcf());
bind('btnCsv', () => void exportCsv());
bind('btnLogClose', () => document.querySelector('.log')!.classList.toggle('collapsed'));
$<HTMLSelectElement>('selStyle').addEventListener('change', (e) => setStyle((e.target as HTMLSelectElement).value as RenderStyle));
$<HTMLInputElement>('memberSearch').addEventListener('input', (e) => ui.filterMembers((e.target as HTMLInputElement).value));
viewer.renderer.domElement.addEventListener('wheel', () => queueMicrotask(syncButtons), { passive: true });
{
  // scrubber: bound once, reads the current project's duration
  const track = $('scrubTrack');
  let dragging = false;
  const seekFromEvent = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    playback.seek(((e.clientX - r.left) / r.width) * project.duration);
  };
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  });
  track.addEventListener('pointermove', (e) => dragging && seekFromEvent(e));
  track.addEventListener('pointerup', () => (dragging = false));
}

// ── Save sequence ──────────────────────────────────────────────────────────
// Inside a claude.ai artifact the frame blocks page-started downloads, so the
// save goes through the `downloads` capability (the viewer confirms it).
// Standalone (dev server, saved copy) it falls back to a normal download.
type DownloadsNS = { save(req: { filename: string; data: string | Blob }): Promise<{ status: 'saved' | 'delivered' }> };
type ClaudeHost = { use(name: 'downloads'): Promise<DownloadsNS | null> };
const host = (window as unknown as { claude?: ClaudeHost }).claude;
const downloadsReady: Promise<DownloadsNS | null> | null = typeof host?.use === 'function' ? host.use('downloads') : null;
downloadsReady?.then(
  (d) => ($('btnDownload').hidden = !d),
  () => ($('btnDownload').hidden = true),
);

let toastTimer = 0;
function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 4200);
}

function sequenceJson(): string {
  return JSON.stringify(
    {
      project: {
        id: project.id,
        name: project.name,
        source: project.meta.source,
        file: project.meta.fileName ?? null,
        storeys: project.storeys,
        height: +project.height.toFixed(2),
        gifaM2: Math.round(project.gifa),
        totalMassKg: Math.round(project.totalMassKg),
        carbonA1A3Kg: Math.round(project.totalCarbonKg),
        biogenicStoredKg: Math.round(project.totalBiogenicKg),
        carbonNote: 'indicative A1–A3 from generic factors, not project EPDs',
      },
      crane: { id: project.crane.id, base: project.crane.base, jibM: project.crane.jib, maxKg: project.crane.maxKg, tipKg: project.crane.tipKg },
      checks: report
        ? {
            verdict: report.rules.map((r) => ({ rule: r.id, checked: r.checked, flagged: r.flagged, status: !r.applicable || !r.checked ? 'unverified' : r.flagged ? 'flagged' : 'passed', note: r.note })),
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
        centroid: s.centroid.map((v) => +v.toFixed(3)),
        t0: +s.t0.toFixed(3),
        t1: +s.t1.toFixed(3),
        elements: project.parts.slice(s.partStart, s.partStart + s.partCount).filter((p) => p.ref).map((p) => ({ guid: p.ref!.guid, ifc: p.ref!.ifcType, name: p.ref!.name })),
      })),
    },
    null,
    2,
  );
}

/** Save a generated file: through the viewer's save prompt when hosted, a normal download otherwise. */
async function saveFile(filename: string, data: string | Uint8Array, mime: string, note = '') {
  const blob = new Blob([data as BlobPart], { type: mime });
  if (downloadsReady) {
    const downloads = await downloadsReady.catch(() => null);
    if (!downloads) {
      toast('Saving files is not available in this view.');
      return;
    }
    try {
      const res = await downloads.save({ filename, data: blob });
      if (res.status === 'saved') toast(`Saved ${filename}${note ? `. ${note}` : ''}`);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'declined') return;
      if (code === 'rate_limited') toast('A save prompt is already open.');
      else if (code === 'extension_not_enabled' || code === 'rejected_extension') toast(`This view cannot save .${filename.split('.').pop()} files.`);
      else toast('Saving files is not available in this view.');
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Downloading ${filename}`);
}

bind('btnDownload', () => void saveFile(`${project.id}-sequence.json`, sequenceJson(), 'application/json'));

// ── Keyboard ───────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    (document.activeElement as HTMLElement | null)?.blur();
    if (issuesUI.selected) issuesUI.select(null);
    else selectRail('model');
    return;
  }
  const typing = e.target instanceof HTMLSelectElement || (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox');
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  const map: Record<string, () => void> = {
    ' ': actions.play,
    r: actions.rebuild,
    a: actions.rotate,
    c: actions.colour,
    x: actions.frame,
    f: actions.speed,
    v: actions.view,
    g: actions.ghost,
    k: actions.crane,
    s: actions.section,
    i: () => selectRail('import'),
    ']': () => issuesUI.step(1),
    '[': () => issuesUI.step(-1),
    arrowleft: () => jumpStep(-1),
    arrowright: () => jumpStep(1),
    home: () => playback.seek(0),
  };
  if (map[k]) {
    e.preventDefault();
    map[k]();
  } else if (/^[1-7]$/.test(k)) selectRail(RAIL[Number(k) - 1].id);
});

// ── Render loop ────────────────────────────────────────────────────────────
const spark = $<HTMLCanvasElement>('gpuSpark');
const logSpark = $<HTMLCanvasElement>('logSpark');
const frameTimes: number[] = [];
let fpsEma = 60;
let last = performance.now();
let hudAcc = 0;

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function drawSpark(c: HTMLCanvasElement, values: number[], max: number, color: string, band = false) {
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  if (band) {
    ctx.fillStyle = cssVar('--brand-tint');
    ctx.fillRect(0, c.height * 0.3, c.width, c.height * 0.7);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * c.width;
    const y = c.height - Math.min(1, v / max) * c.height * 0.9 - 2;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}

function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  playback.tick(dt);
  const state = timeline.stateAt(playback.t);
  viewer.setWash(state.presentation.wash.front);
  viewer.setCut(view.section.on ? manualCut() : state.presentation.cut);
  // an issue is a deliberate jump: a quick move (instant with reduced motion); the fly-through eases slowly
  viewer.frame(state.t, state.builtTop, state.builtHalf, view.crane ? state.crane : { ...state.crane, visible: false }, dt, firstFrame || (!!focusPose && reduceMotion), focusPose ?? state.presentation.pose, focusPose ? 9 : 3.2);
  if (focusPose && !viewer.autoFrame) focusPose = null; // the view was dragged away
  overlays.update(state, view.crane);
  ui.update(state, view.tab === 'members');
  issuesUI.update(state);

  // camera readouts, scale
  const ro = viewer.readout();
  const scale = drawingScale(ro.pxPerMetre);
  $('tbScale').textContent = `1:${scale}`;
  $('tbCamera').textContent = `AZ ${Math.round(ro.az)}° · EL ${ro.el >= 0 ? '+' : ''}${Math.round(ro.el)}° · ${Math.round(ro.mm)} mm`;
  const L = scaleBarLength(ro.pxPerMetre);
  $('scaleBar').style.setProperty('--sbw', `${L * ro.pxPerMetre}px`);
  $('sbMid').textContent = String(L / 2);
  $('sbMid').style.left = `${(L * ro.pxPerMetre) / 2}px`;
  $('sbEnd').textContent = `${L} m`;
  $('sbEnd').style.left = `${L * ro.pxPerMetre}px`;
  $('sbScale').textContent = `SCALE · 1:${scale}`;

  // perf HUD
  if (dt > 0) fpsEma += (1 / dt - fpsEma) * 0.05;
  frameTimes.push(dt * 1000);
  if (frameTimes.length > 80) frameTimes.shift();
  hudAcc += dt;
  if (hudAcc > 0.25) {
    hudAcc = 0;
    const st = viewer.stats();
    ui.perf = { fps: fpsEma, draws: st.draws, tris: st.tris, res: viewer.pixelRatio };
    $('gpuFps').textContent = String(Math.round(fpsEma));
    $('liveFps').textContent = String(Math.round(fpsEma));
    $('gpuDraws').textContent = String(st.draws);
    $('gpuTris').textContent = `${Math.round(st.tris / 1000)}k`;
    $('gpuRes').textContent = `${viewer.pixelRatio.toFixed(2)}×`;
    drawSpark(spark, frameTimes, 40, cssVar('--brand'), true);
    const activity = Array.from({ length: 40 }, (_, i) => {
      const t = state.t - (40 - i) * 0.05;
      const k = timeline.stepIndexAt(t);
      return k >= 0 && t < project.steps[k].t1 ? 1 : 0.15;
    });
    drawSpark(logSpark, activity, 1.2, cssVar('--muted'));
  }

  if (firstFrame) {
    firstFrame = false;
    syncButtons();
    requestAnimationFrame(() => makeThumbnails());
  }
  requestAnimationFrame(loop);
}

function makeThumbnails() {
  const p = project;
  const painted: [number, number] = [1e4, 1e4];
  const b = planBounds(p);
  const half = Math.max(8, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2) * (p.meta.source === 'ifc' ? 1.15 : 1);
  p.stages.forEach((st, i) => {
    if (st.kind === 'material') return ui.setThumbnail(i, viewer.snapshot(st.end, p.height, Math.max(half, 26), { wash: painted }));
    if (st.kind === 'section') {
      const cut: CutState = { on: true, normal: p.presentation.cut.normal, d: p.presentation.cut.at };
      return ui.setThumbnail(i, viewer.snapshot(st.end, p.height, Math.max(half, 26), { wash: painted, cut, az: 90, el: 8 }));
    }
    const steps = p.steps.filter((s) => s.stage === st.n);
    const top = Math.max(1, ...steps.map((s) => s.top), ...p.steps.filter((s) => s.stage < st.n).map((s) => s.top));
    const h = Math.max(p.meta.source === 'ifc' ? half : 17, ...steps.map((s) => s.halfExtent));
    ui.setThumbnail(i, viewer.snapshot(st.end - 0.001, top, h));
  });
  document.body.dataset.ready = '1';
  void startChecks();
}

// ── Buildability checks ────────────────────────────────────────────────────
let boundsCache: { p: Project; b: ModelBounds } | null = null;
const bounds = () => (boundsCache?.p === project ? boundsCache.b : (boundsCache = { p: project, b: modelBounds(project) }).b);

/** Rules whose critical and major findings are hatched on the model (FLAGGED). */
const FLAG_RULES = new Set<RuleId>(['ORDER-SUPPORT', 'TEMP-PROPS', 'REACH-CRANE', 'REACH-PATH', 'CLASH-HARD', 'CLASH-TEMP', 'ACCESS-HEADROOM']);

async function startChecks() {
  const run = ++checkRun;
  const p = project;
  const r = await runChecks(p, checkSettings, (label, share) => {
    if (run === checkRun) issuesUI.running(label, share);
  });
  if (run !== checkRun || p !== project) return; // a newer project or run took over
  report = r;
  syncLiftWarn();
  issuesUI.setReport(r);
  viewer.setFlags([...new Set(r.issues.filter((i) => FLAG_RULES.has(i.rule) && (i.severity === 'critical' || i.severity === 'major')).flatMap((i) => i.primary))]);
  renderRulesPanel();
  document.body.dataset.checks = String(r.issues.length);
}

/**
 * What to draw for an issue: everything for small ones; for issues spanning many
 * floors (edge protection up a tower) only what lies in its framing box, so the
 * first case reads clearly. The register and the BCF keep every element.
 */
function issueDrawing(i: Issue) {
  const [lo, hi] = i.box;
  const m = 1;
  const inBox = (k: number) => {
    const part = project.parts[k];
    const h = part.size.map((v) => v / 2);
    return [0, 1, 2].every((a) => part.pos[a] + h[a] >= lo[a] - m && part.pos[a] - h[a] <= hi[a] + m);
  };
  const near = (v: Vec3) => [0, 1, 2].every((a) => v[a] >= lo[a] - m && v[a] <= hi[a] + m);
  const many = i.primary.length + i.secondary.length > 80;
  // an open edge is about the edge: draw the edge and what closes it, not the whole slab in red
  if (i.rule === 'TEMP-EDGE') return { primary: [], secondary: many ? i.secondary.filter(inBox) : i.secondary, lines: i.lines.length > 200 ? i.lines.filter(([a, b]) => near(a) || near(b)) : i.lines };
  return {
    primary: many ? i.primary.filter(inBox) : i.primary,
    secondary: many ? i.secondary.filter(inBox) : i.secondary,
    lines: i.lines.length > 200 ? i.lines.filter(([a, b]) => near(a) || near(b)) : i.lines,
  };
}

function selectIssue(i: Issue | null) {
  if (!i) {
    viewer.setIssue(null);
    focusPose = null;
    return;
  }
  playback.toggle(false);
  playback.seek(timeForStep(i.step));
  viewer.setIssue(issueDrawing(i));
  const v = issueView(i, viewer.viewportSize.w / Math.max(1, viewer.viewportSize.h), bounds());
  focusPose = { target: v.target, az: v.az, el: v.el, dist: v.dist, fov: v.fov };
  viewer.autoFrame = true;
  if (view.tab !== 'issues') {
    view.tab = 'issues';
    syncButtons();
  }
}

/** The operation panel, the reach ring and its label read lifts as the checks do: same review threshold, same rigging allowance. */
function syncLiftWarn() {
  ui.liftWarn = overlays.liftWarn = viewer.reachWarnAt = checkSettings.craneWarn;
  ui.liftRigKg = overlays.liftRigKg = viewer.reachRigKg = checkSettings.riggingKg;
}

/** Rules, their verification status and the thresholds, inside the Issues pane. */
function renderRulesPanel() {
  const body = $('issRulesBody');
  const s = checkSettings;
  const field = (id: string, label: string, value: number, step: number) => `<label for="${id}">${label}</label><input id="${id}" type="number" step="${step}" min="0" value="${value}" />`;
  body.innerHTML = `${rulesTable(report)}
    <div class="set">
      ${field('setClash', 'Clash tolerance (mm)', Math.round(s.clashTol * 1000), 1)}
      ${field('setHead', 'Stair headroom (m)', s.headroom, 0.01)}
      ${field('setFall', 'Fall needing protection (m)', s.fallHeight, 0.1)}
      ${field('setGuard', 'Guard height (mm)', Math.round(s.guardHeight * 1000), 10)}
      ${field('setAid', 'Lifting aid above (kg)', s.liftAidKg, 5)}
      ${field('setCrane', 'Lift plan review above (%)', Math.round(s.craneWarn * 100), 1)}
      ${field('setRig', 'Rigging allowance (kg)', s.riggingKg, 10)}
      ${field('setTruckL', 'Standard load length (m)', s.truck[0], 0.1)}
      ${field('setTruckW', 'Standard load width (m)', s.truck[1], 0.05)}
      ${field('setTruckH', 'Standard load height (m)', s.truck[2], 0.05)}
    </div>
    <div class="opts"><button id="btnRerun" class="xbtn">Run the checks again</button><button id="btnDefaults" class="xbtn">Defaults</button></div>`;
  const num = (id: string) => Math.max(0, Number(($(id) as HTMLInputElement).value) || 0);
  $('btnRerun').addEventListener('click', () => {
    checkSettings = {
      clashTol: num('setClash') / 1000,
      headroom: num('setHead'),
      fallHeight: num('setFall'),
      guardHeight: num('setGuard') / 1000,
      personKg: checkSettings.personKg,
      liftAidKg: num('setAid'),
      craneWarn: num('setCrane') / 100,
      riggingKg: num('setRig'),
      truck: [num('setTruckL'), num('setTruckW'), num('setTruckH')],
    };
    rerunChecks();
  });
  $('btnDefaults').addEventListener('click', () => {
    checkSettings = { ...DEFAULT_SETTINGS, truck: [...DEFAULT_SETTINGS.truck] };
    rerunChecks();
  });
}

function rerunChecks() {
  issuesUI.select(null);
  issuesUI = new IssuesUI(project, viewer, timeForStep, { select: selectIssue, exportBcf: () => void exportBcf(), exportCsv: () => void exportCsv() });
  report = null;
  renderRulesPanel();
  void startChecks();
}

async function exportCsv() {
  if (!report) return;
  await saveFile(`${project.id}-issues.csv`, issuesCsv(project, report, timeForStep), 'text/csv');
}

async function exportBcf() {
  if (!report || !report.issues.length) return;
  const r = report;
  const shots = new Map<string, Uint8Array>();
  const keep = issuesUI.selected;
  for (let k = 0; k < r.issues.length; k++) {
    const i = r.issues[k];
    toast(`Rendering BCF snapshots · ${k + 1} / ${r.issues.length}`);
    viewer.setIssue(issueDrawing(i));
    shots.set(i.id, await viewer.issuePng(issueView(i, 1.6, bounds()), timeForStep(i.step)));
    await new Promise((res) => setTimeout(res, 0));
  }
  viewer.setIssue(keep ? issueDrawing(keep) : null);
  const bytes = bcfZip(project, r, shots);
  // the claude.ai save prompt accepts .zip, not .bcfzip; BCF tools read either once renamed
  await saveFile(downloadsReady ? `${project.id}-issues.bcf.zip` : `${project.id}-issues.bcfzip`, bytes, 'application/zip', downloadsReady ? 'Rename it to .bcfzip if your BCF tool asks.' : '');
}

// test / automation hook
(window as unknown as { arbor: unknown }).arbor = {
  get project() {
    return project;
  },
  get timeline() {
    return timeline;
  },
  playback,
  viewer,
  importIfcText,
  get checks() {
    return report;
  },
  selectIssue: (id: string) => issuesUI.selectById(id),
  bcfBytes: () => (report ? bcfZip(project, report) : null),
};

mount(project);
if (params.has('az')) viewer.setView(Number(params.get('az')), Number(params.get('el') ?? 16));
if (params.get('sample') === 'duplex') void loadSample().then(() => {
  if (params.has('t')) playback.seek(Number(params.get('t')));
  if (params.get('paused') === '1') playback.toggle(false);
  if (params.has('az')) viewer.setView(Number(params.get('az')), Number(params.get('el') ?? 16));
});
requestAnimationFrame(loop);
