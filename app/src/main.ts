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
import { ALL_STAGES, CONTEXT_STAGE, VIEW_PRESETS, Viewer, type IssueSpec, type RenderStyle } from './scene/viewer';
import { Overlays, drawingScale, scaleBarLength } from './ui/overlays';
import { SequenceUI } from './ui/panels';
import { carbonFacts, projectFacts, renderHeaderDrawing } from './ui/header';
import { defaultedSummary, defaultedText, endsEarly, importError, loadedMessage, type DefaultedSummary, type LoadStage } from './ui/report';
import { hydrateIcons, ICONS, setIcon } from './ui/icons';
import { readIfc } from './ifc/model';
import { projectFromIfc } from './ifc/sequence';
import { runChecks } from './checks/run';
import { DEFAULT_SETTINGS, RULE_BY_ID, type CheckReport, type CheckSettings, type Issue, type RuleId } from './checks/types';
import { partLabel, sentenceStart } from './checks/rules';
import { cranePlanPose, firstOverPick, OverPickWatch, type OverPick } from './engine/lifts';
import { issueView, modelBounds, type ModelBounds } from './checks/view';
import { chromeBoxes, IssuesUI, rulesTable } from './ui/issues';
import { issueFrame } from './ui/place';
import { bcfZip } from './export/bcf';
import { issuesCsv } from './export/csv';
import { sequenceJson } from './export/sequence';
import type { CameraPose } from './engine/presentation';
import { nextTab, routeKey } from './ui/keys';
import { applyBrand, brandName } from './ui/brand';
import { moreSides, NARROW_QUERY, orbitTouchAction, revealScroll, ScrubDrag, toastLife, type ToastKind } from './ui/layout';
import { keyAction, shortcutSheetHtml, type ActionId } from './ui/shortcuts';
import { heroLine, introCards, markIntroSeen, openingPlan, presentButton, showIntro, startsInClientMode } from './ui/present';
import { browserStore, clearPrefs, loadPrefs, readThresholds, RESOLUTIONS, sameSettings, savePrefs, THRESHOLD_FIELDS, thresholdValue, type ViewPrefs } from './ui/prefs';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-GB').replace(/,/g, ' ');

const SAMPLE_URL = 'samples/duplex-apartment.ifc.txt';
const SAMPLE_NAME = 'Duplex_A_20110907.ifc';
const SAMPLE_CREDIT = 'Duplex Apartment · BSI (2020) “Duplex Apartment Test Files”, buildingSMART International · CC BY 4.0';

// ── state ──────────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
/** The one-column layout: panel under the model, play bar pinned to the bottom, the selected issue in a sheet. */
const narrow = window.matchMedia?.(NARROW_QUERY) ?? null;
const isNarrow = () => !!narrow?.matches;
/** A ?t= link: a number of seconds ("12" or "12s"), or null. */
const linkTime = (() => {
  const t = parseFloat(params.get('t') ?? '');
  return Number.isFinite(t) ? t : null;
})();
/** A page opened on the Duplex sample loads it first: the demo tower is only built if the sample fails. */
const sampleFirst = params.get('sample') === 'duplex';
/** The project on show; unset only while a page opened on a sample loads it. */
let project: Project = (sampleFirst ? undefined : buildProject()) as Project;
let mounted = false;
let timeline: Timeline;
const playback = new Playback(project?.duration ?? 1);
/** The large Play button over the opening frame; it goes once the sequence plays or moves. */
let hero = false;
/**
 * Where the page opens: a ?t= link at its moment (playing unless ?paused=1),
 * ?play=1 from the start, otherwise paused on the finished, coloured model
 * with the large Play button.
 */
const openPlayback = (p: Project) => {
  const plan = openingPlan({ linkTime, paused: params.get('paused') === '1', autoplay: params.get('play') === '1', duration: p.duration });
  playback.seek(plan.t);
  playback.toggle(plan.playing);
  hero = plan.hero;
  syncHero();
};
/** The large Play button shown or hidden, with what it plays. */
function syncHero() {
  const b = $('heroPlay');
  b.hidden = !hero || !project;
  if (project) $('heroSub').textContent = heroLine(project.steps.length, project.duration);
}
if (project) openPlayback(project);

hydrateIcons();
// the product name in the header: one setting (brand.ts), or ?brand= for a white-label demo
applyBrand(brandName(params.get('brand')), $('wordmark'), document);

const viewer = new Viewer($('viewport'), project);
let overlays: Overlays;
let ui: SequenceUI;

// view toggles and thresholds saved on this device (storage may be blocked: then the defaults stand)
const store = browserStore();
const saved = loadPrefs(store);
const autoRotateDefault = params.get('rotate') !== '0' && !reduceMotion;
const VIEW_DEFAULTS: ViewPrefs = { style: 'ink+paint', colour: false, ghost: true, crane: true, autoRotate: autoRotateDefault, flags: true, resolution: 1.5, client: false };
const viewStart: ViewPrefs = { ...VIEW_DEFAULTS, ...saved.view };
// a link that asks for no rotation, or reduced motion, wins over a saved preference
if (!autoRotateDefault) viewStart.autoRotate = false;

const view = {
  style: viewStart.style,
  colour: viewStart.colour,
  ghost: viewStart.ghost,
  crane: viewStart.crane,
  // manual section, independent of the stage-08 fly-through
  section: { on: false, plane: 'A' as 'A' | 'B', d: 0 },
  autoRotate: viewStart.autoRotate,
  orbit: true,
  presetIndex: 0,
  stageMask: ALL_STAGES,
  resolution: viewStart.resolution,
  rail: 'model',
  tab: 'seq' as 'seq' | 'members' | 'issues',
  flags: viewStart.flags,
  /** The crane plan: the reach seen from above, emphasised. */
  cranePlan: false,
  /** The performance overlay (frame rate, draw calls): off unless ?debug, Settings or Shift+D turns it on. */
  perf: params.has('debug') && params.get('debug') !== '0',
  /** The presentation view (P, the Present button or ?mode=client): expert chrome put away, toggles in plain words. */
  client: startsInClientMode(params.get('mode'), saved.view?.client),
};
let issuesUI: IssuesUI | undefined;
let report: CheckReport | null = null;
const defaultSettings = (): CheckSettings => ({ ...DEFAULT_SETTINGS, truck: [...DEFAULT_SETTINGS.truck] });
let checkSettings: CheckSettings = saved.checks ?? defaultSettings();
let checkRun = 0;
/** Camera pose that frames the selected issue; released when playback resumes or the view is dragged. */
let focusPose: CameraPose | null = null;
/** How focusPose sits in the viewport: its target's spot on screen, whether the caption steps aside, and the size it was worked out for. */
let focusFrame: { aim: { x: number; y: number }; hideCaption: boolean; w: number; h: number } | null = null;
/** Cards and controls over the viewport that an issue is framed clear of. */
const FRAME_CHROME = '.toolbar, #titleBlock, #scrubber, #transport, #drawer, #loading, #liftBanner, #issueSheet';
/** Camera pose of the crane plan; released when the view is dragged (the emphasis stays until the plan is turned off). */
let planPose: CameraPose | null = null;
/** Where the plan's target sits on screen, whether the caption steps aside for it, and the viewport size it was worked out for. */
let planFrame: { aim: { x: number; y: number }; hideCaption: boolean; w: number; h: number } | null = null;
/** The view preset to go back to when the crane plan is turned off. */
let presetBeforePlan = 0;
/** Stops playback once per playthrough on the first pick over the crane's chart. */
let overWatch = new OverPickWatch(null);
/** The pick the banner is about, while it shows. */
let bannerPick: OverPick | null = null;
viewer.setResolution(view.resolution);
viewer.setAutoRotate(view.autoRotate);
applyViewLook();
$('gpuCard').hidden = !view.perf;
applyMode();

/** Push the view toggles that live in the viewer's shaders and layers. */
function applyViewLook() {
  viewer.setStyle(view.style);
  viewer.setColour(view.colour);
  viewer.setGhost(view.ghost);
  viewer.setFlagsVisible(view.flags);
}

// auto-rotate forced off by the link or reduced motion is not the user's choice: keep the saved one
let rotatePref = saved.view?.autoRotate ?? true;
// likewise a link that opens in one view or the other: only P or the Present button change the saved choice
let clientPref = saved.view?.client ?? false;
/** The view toggles worth keeping between visits. */
const viewPrefs = (): ViewPrefs => ({ style: view.style, colour: view.colour, ghost: view.ghost, crane: view.crane, autoRotate: rotatePref, flags: view.flags, resolution: view.resolution, client: clientPref });
/** Save what the user chose: called from the controls, never from code that only shows state. */
function savePreferences() {
  savePrefs(store, { checks: checkSettings, view: viewPrefs() });
}

/**
 * The presentation view on or off. It hides the expert chrome (the rail with
 * its telemetry, the build log, the exports, the thresholds, the drawing
 * controls) and names the toggles that stay for what they do; the stylesheet
 * does the work from the class on #app. `save` is false when a link asked.
 */
function setClient(on: boolean, save = true) {
  if (save) {
    clientPref = on;
    savePreferences();
  }
  if (on === view.client) return;
  view.client = on;
  applyMode();
  if (on && save) toast('Presentation view. Press P or Exit presentation for the full view.');
}
function applyMode() {
  $('app').classList.toggle('client', view.client);
  const b = presentButton(view.client);
  $('presentLabel').textContent = b.label;
  $('btnPresent').title = b.title;
  viewer.invalidate();
}

// ── Opening: first-run cards and the shortcut sheet ────────────────────────
/** The first-run cards are up (until dismissed; then not again in this browser). */
let introOpen = showIntro(store, params.get('intro'));
function renderIntro() {
  const el = $('intro');
  el.hidden = !introOpen || !project;
  if (el.hidden) return;
  const [what, play, own] = introCards(project.name);
  const card = (c: { title: string; body: string }, action = '') => `<article class="intro-card"><h3>${esc(c.title)}</h3>${action}<p>${esc(c.body)}</p></article>`;
  // the large Play button is the second card's action, so the cards only add the way to bring a model in
  $('introCards').innerHTML = card(what) + card(play) + card(own, '<button class="intro-act" id="introOpen">Open IFC file…</button>');
  $('introOpen').addEventListener('click', () => {
    dismissIntro();
    $<HTMLInputElement>('fileIfc').click();
  });
}
/** Put the cards away for good in this browser (storage permitting). */
function dismissIntro() {
  if (!introOpen) return;
  introOpen = false;
  $('intro').hidden = true;
  markIntroSeen(store);
}
/** The large Play button and the first card's: the build from the first step. */
function playFromStart() {
  dismissIntro();
  hero = false;
  syncHero();
  playback.seek(0);
  playback.toggle(true);
}
const help = $<HTMLDialogElement>('helpSheet');
$('helpBody').innerHTML = shortcutSheetHtml();
function openHelp() {
  if (help.open) return;
  if (typeof help.showModal === 'function') help.showModal();
  else help.setAttribute('open', '');
}
function closeHelp() {
  if (typeof help.close === 'function') help.close();
  else help.removeAttribute('open');
}
// a click on the shade round the sheet closes it
help.addEventListener('click', (e) => {
  if (e.target === help) closeHelp();
});

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
  mounted = true;
  timeline = new Timeline(p);
  playback.setDuration(p.duration);
  viewer.setProject(p);
  viewer.setStageMask((view.stageMask = ALL_STAGES));
  $('overlaySvg').innerHTML = '';
  $('overlayHtml').innerHTML = '';
  overlays = new Overlays($('overlaySvg') as unknown as SVGSVGElement, $('overlayHtml'), p, timeline, viewer);
  ui = new SequenceUI(p, timeline, (t) => playback.seek(t), (i) => {
    playback.toggle(false);
    playback.seek(timeForStep(i));
  });
  ui.setShowPerf(view.perf);
  report = null;
  focusPose = null;
  importFailure = null;
  hideOverBanner();
  overWatch = new OverPickWatch(null); // syncLiftWarn below finds this project's first over-chart pick
  if (!p.crane && view.cranePlan) setCranePlan(false);
  else if (view.cranePlan) framePlan();
  checkRun++;
  document.body.dataset.checks = '';
  issuesUI = newIssuesUI(p);
  syncLiftWarn();
  renderRulesPanel();
  renderHeaderDrawing($('headerDrawing'), p, p.stages[0].sheet);
  $('tagline').textContent = p.meta.tagline;
  $('capTitle').textContent = `${p.name} — Assembly Drawing`;
  $('capSub').textContent = p.meta.caption;
  $('tbName').textContent = p.name.toUpperCase();
  // project facts where a wall clock used to be
  const facts = projectFacts(p);
  $('factHead').textContent = facts.head;
  $('factMain').textContent = facts.main;
  $('factSub').textContent = facts.sub;
  $('statusFacts').title = facts.label;
  // carbon and its caveat beside them, so it never sits below the fold
  defaulted = defaultedSummary(p);
  showingDefaulted = false;
  const carbon = carbonFacts(p, defaulted?.count ?? 0);
  $('carbonHead').textContent = carbon.head;
  $('carbonTotal').textContent = carbon.main;
  $('carbonUnit').textContent = carbon.unit;
  $('carbonSub').textContent = carbon.sub;
  $('statusCarbon').title = carbon.label;
  document.querySelector('.watermark')!.textContent = p.meta.watermark;
  view.section = { on: false, plane: 'A', d: +p.presentation.cut.at.toFixed(1) };
  press('btnSection', false);
  updateRail();
  stageStarts = p.stages.map((s) => s.start);
  firstFrame = true;
  document.body.dataset.ready = '';
  // an open drawer shows the new model's stages, section range and import report
  renderDrawer();
  syncButtons();
  syncHero();
  renderIntro();
}

function newIssuesUI(p: Project) {
  const ui = new IssuesUI(p, viewer, timeForStep, { select: selectIssue, exportBcf: () => void exportBcf(), exportCsv: () => void exportCsv(), compact: isNarrow });
  if (bcfBusy) $('btnBcf').toggleAttribute('disabled', true);
  return ui;
}

/** A toggle button's look and its state for assistive technology, set together. */
function press(id: string, on: boolean) {
  const el = $(id);
  el.classList.toggle('on', on);
  el.setAttribute('aria-pressed', String(on));
}

/** The panel tabs, in order, with the pane each one shows. */
const TABS = [
  { id: 'tabSeq', pane: 'paneSeq', tab: 'seq' },
  { id: 'tabMembers', pane: 'paneMembers', tab: 'members' },
  { id: 'tabIssues', pane: 'paneIssues', tab: 'issues' },
] as const;

/** Rail items that open the drawer, and what the drawer is called for each. */
const DRAWERS: Record<string, string> = { layers: 'Layers', section: 'Section', render: 'Render style', settings: 'Settings', import: 'Import IFC' };

function syncButtons() {
  // Parts is the Members tab seen from the rail: once another tab shows, Parts is no longer the choice
  if (view.rail === 'parts' && view.tab !== 'members') view.rail = 'model';
  viewer.invalidate();
  press('btnRotate', view.autoRotate);
  press('btnColour', view.colour);
  press('btnMaterials', view.colour);
  press('btnGhost', view.ghost);
  const noCrane = !!project && !project.crane;
  press('btnCrane', view.crane && !noCrane);
  for (const id of ['btnCrane', 'btnCranePlan']) {
    $<HTMLButtonElement>(id).disabled = noCrane;
    $(id).title = noCrane ? 'No tower crane: this building is lifted by mobile crane and by hand' : id === 'btnCrane' ? 'Show the crane (K)' : 'Crane plan: the reach from above (L)';
  }
  press('btnCranePlan', view.cranePlan);
  $('btnOrbit').classList.toggle('toggle', true);
  press('btnOrbit', view.orbit);
  press('btnFrame', viewer.autoFrame);
  press('btnSection', view.section.on);
  press('btnFlags', view.flags);
  $('speedVal').textContent = `×${playback.speed}`;
  $('btnSpeed').setAttribute('aria-label', `Speed ×${playback.speed}`);
  const playIcon = playback.playing ? 'pause' : 'play';
  for (const id of ['btnPlay', 'btnPlay2']) {
    const b = $(id);
    if (b.dataset.state !== playIcon) {
      b.dataset.state = playIcon;
      setIcon(b, playIcon);
      b.setAttribute('aria-label', playback.playing ? 'Pause' : 'Play');
      b.title = playback.playing ? 'Pause (Space)' : 'Play (Space)';
    }
  }
  $<HTMLSelectElement>('selStyle').value = view.style;
  document.querySelectorAll<HTMLElement>('.rail-item').forEach((b) => {
    const on = b.dataset.id === view.rail;
    b.classList.toggle('on', on);
    // a drawer item says whether its drawer is open; Model and Parts say which is current
    if (DRAWERS[b.dataset.id!]) b.setAttribute('aria-expanded', String(on));
    else if (on) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
  $('btnMenu').setAttribute('aria-expanded', String(view.rail === 'render'));
  for (const t of TABS) {
    const on = view.tab === t.tab;
    const el = $(t.id);
    el.classList.toggle('on', on);
    el.setAttribute('aria-selected', String(on));
    // one tab stop for the tab list: the arrow keys move between tabs
    el.tabIndex = on ? 0 : -1;
    $(t.pane).hidden = !on;
  }
}
playback.onChange(() => {
  // pressing play hands the camera back to the sequence, and the over-chart banner has had its moment
  if (playback.playing && focusPose) focusPose = null;
  if (playback.playing) hideOverBanner();
  // the opening frame's Play button has done its job once the sequence plays or moves
  if (hero && (playback.playing || playback.t < project.duration)) {
    hero = false;
    syncHero();
  }
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
  b.setAttribute('aria-keyshortcuts', String(i + 1));
  // named by its label; the line under it (stage count, render style…) describes it
  b.setAttribute('aria-label', r.label);
  b.setAttribute('aria-describedby', `rail-sub-${r.id}`);
  if (DRAWERS[r.id]) b.setAttribute('aria-controls', 'drawer');
  b.innerHTML = `<span class="ico">${ICONS[r.icon]}</span><span class="lbl">${r.label}</span><span class="sub" id="rail-sub-${r.id}"></span><span class="key" aria-hidden="true">${i + 1}</span>`;
  // pressed from the keyboard (a click with no pointer detail), an opened drawer takes the focus
  b.addEventListener('click', (e) => selectRail(r.id, e.detail === 0));
  railWrap.append(b);
});
function updateRail() {
  if (!project) return;
  $('rail-sub-model').textContent = `${project.storeys} STOREYS`;
  $('rail-sub-layers').textContent = `${project.stages.length} STAGES`;
  $('rail-sub-parts').textContent = project.parts.length >= 1000 ? `${(project.parts.length / 1000).toFixed(1)}K PCS` : `${project.parts.length} PCS`;
  $('rail-sub-section').textContent = 'A – A';
  $('rail-sub-render').textContent = view.style === 'ink' ? 'INK' : view.style === 'paint' ? 'PAINT' : 'INK + PAINT';
  $('rail-sub-settings').textContent = `MSAA · ${view.resolution.toFixed(1)}×`;
  $('rail-sub-import').textContent = project.meta.source === 'ifc' ? 'IFC' : 'SAMPLE';
}

const drawer = $('drawer');
function selectRail(id: string, focusDrawer = false) {
  if (!RAIL.some((r) => r.id === id)) return;
  view.rail = view.rail === id && id !== 'model' ? 'model' : id;
  if (view.rail === 'parts') view.tab = 'members';
  renderDrawer();
  syncButtons();
  // the drawer comes late in the page's tab order: take a keyboard user straight to its first control
  if (focusDrawer && !drawer.hidden) drawer.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select')?.focus();
}
const railButton = (id: string) => railWrap.querySelector<HTMLElement>(`.rail-item[data-id="${id}"]`);

/** Whether two elements' boxes overlap on screen. */
function overlaps(a: HTMLElement, b: HTMLElement) {
  const r = a.getBoundingClientRect(), q = b.getBoundingClientRect();
  return r.width > 0 && q.width > 0 && r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top;
}

/**
 * The caption card gives way to an open drawer; to a framed issue or the crane
 * plan on a screen too small for both; and to the over-chart banner where the
 * two meet (the banner names the same step).
 */
function syncCaption() {
  const framed = focusPose ? focusFrame?.hideCaption : planPose ? planFrame?.hideCaption : false;
  const banner = $('liftBanner');
  const v = drawer.hidden && !framed && (banner.hidden || !overlaps(banner, $('caption'))) ? 'visible' : 'hidden';
  if ($('caption').style.visibility !== v) $('caption').style.visibility = v;
}

function renderDrawer() {
  const id = view.rail;
  viewer.invalidate();
  drawer.hidden = !project || !['layers', 'render', 'settings', 'import', 'section'].includes(id);
  drawer.classList.toggle('wide', id === 'import');
  syncCaption();
  if (drawer.hidden) return;
  drawer.setAttribute('aria-label', DRAWERS[id] ?? 'Settings');
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
    drawer.innerHTML = `<h5>RENDER STYLE</h5><div class="opts">${opts.map(([v, l]) => `<button data-v="${v}" ${pressed(view.style === v)}>${l}</button>`).join('')}</div>
      <h5 style="margin-top:14px">COLOUR</h5><div class="opts"><button data-c="0" ${pressed(!view.colour)}>Drawing</button><button data-c="1" ${pressed(view.colour)}>Materials</button></div>`;
    // setStyle and setColour redraw this drawer, whichever control made the change
    drawer.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => b.addEventListener('click', () => setStyle(b.dataset.v as RenderStyle)));
    drawer.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => b.addEventListener('click', () => setColour(b.dataset.c === '1')));
  } else if (id === 'settings') {
    drawer.innerHTML = `<h5>RESOLUTION SCALE</h5><div class="opts">${RESOLUTIONS.map((r) => `<button data-r="${r}" ${pressed(view.resolution === r)}>${r.toFixed(1)}×</button>`).join('')}</div>
      <p style="margin-top:12px">MSAA is on. Higher scales sharpen ink lines at a GPU cost.</p>
      <h5 style="margin-top:14px">PERFORMANCE</h5>
      <label><input type="checkbox" id="perfOn" ${view.perf ? 'checked' : ''} /> Performance overlay (Shift+D)</label>
      <p>Frame rate, draw calls and triangles, for checking a slow machine.</p>
      <h5 style="margin-top:14px">SAVED SETTINGS</h5>
      <p>${store ? 'The view toggles and the check thresholds are kept in this browser for your next visit.' : 'This browser does not allow saving, so settings last until the page closes.'}</p>
      <div class="opts" style="margin-top:8px"><button id="btnResetPrefs">Reset to defaults</button></div>`;
    drawer.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) =>
      b.addEventListener('click', () => {
        view.resolution = Number(b.dataset.r);
        viewer.setResolution(view.resolution);
        updateRail();
        renderDrawer();
        savePreferences();
      }),
    );
    $('btnResetPrefs').addEventListener('click', resetPreferences);
    $<HTMLInputElement>('perfOn').addEventListener('change', (e) => setPerf((e.target as HTMLInputElement).checked));
  } else if (id === 'section') {
    const sec = view.section;
    const b = planBounds(project);
    const range = sec.plane === 'A' ? [b.x0, b.x1] : [b.z0, b.z1];
    drawer.innerHTML = `<h5>SECTION</h5>
      <label><input type="checkbox" id="secOn" ${sec.on ? 'checked' : ''} /> Cut the model (S)</label>
      <div class="opts" style="margin:8px 0 10px">
        <button data-plane="A" ${pressed(sec.plane === 'A')}>A–A · along x</button>
        <button data-plane="B" ${pressed(sec.plane === 'B')}>B–B · along z</button>
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
    $<HTMLInputElement>('secD').addEventListener('input', (e) => setSection({ on: true, d: Number((e.target as HTMLInputElement).value) }));
  } else if (id === 'import') {
    renderImportDrawer();
  }
}

/** The class and pressed state of a drawer option button. */
const pressed = (on: boolean) => `class="${on ? 'on' : ''}" aria-pressed="${on}"`;

/** The performance overlay on or off: the GPU card in the rail and the frame-rate lines in the log. */
function setPerf(on: boolean) {
  view.perf = on;
  $('gpuCard').hidden = !on;
  ui?.setShowPerf(on);
  const box = document.getElementById('perfOn') as HTMLInputElement | null;
  if (box) box.checked = on;
  viewer.invalidate();
}

/** The build log open or collapsed (collapsed at first: it is a record, not something to watch). */
function setLogOpen(open: boolean) {
  $('log').classList.toggle('collapsed', !open);
  const b = $('btnLog');
  b.setAttribute('aria-expanded', String(open));
  b.title = open ? 'Hide the build log' : 'Show the build log';
  setIcon(b, open ? 'chevD' : 'chevU');
}

function renderImportDrawer() {
  const r = project.report as Record<string, unknown> | undefined;
  const isIfc = project.meta.source === 'ifc' && r;
  const rows: string[] = [];
  if (isIfc) {
    const byCat = (r.byCategory ?? {}) as Record<string, number>;
    const skipped = Object.entries((r.skippedItems ?? {}) as Record<string, number>);
    const warnings = (r.warnings ?? []) as string[];
    // what matters most first: a cut-off file, then the materials the figures rest on
    const cutOff = r.truncated ? warnings.find((w) => /ends early/.test(w)) ?? 'The file ends early: it looks cut off, so elements are probably missing.' : null;
    const d = defaulted && defaultedText(defaulted);
    rows.push(
      `${cutOff ? `<div class="report-alert bad" role="note"><b>The file looks incomplete</b><p>${esc(cutOff)} Download or export it again to see the whole model.</p></div>` : ''}
      ${d ? `<div class="report-alert" role="note"><b>${esc(d.head)}</b><button id="btnShowDefaulted" aria-pressed="${showingDefaulted}">${showingDefaulted ? 'Hide these elements' : 'Show these elements'}</button><p>${esc(d.body)}</p>${d.types ? `<p class="mono types">${esc(d.types)}</p>` : ''}</div>` : ''}
      <dl class="report mono">
        <dt>File</dt><dd>${esc(project.meta.fileName ?? '')}</dd>
        <dt>Schema</dt><dd>${esc(String(r.schema))} · ${esc(String(r.application || '—'))}</dd>
        <dt>Units</dt><dd>${esc(String(r.lengthUnit))}</dd>
        <dt>Elements</dt><dd>${fmtInt(Number(r.meshed))} meshed${Number(r.noGeometry) ? ` · ${r.noGeometry} without body geometry` : ''}</dd>
        <dt>Openings</dt><dd>${r.openingsCut} cut${Number(r.openingsSkipped) ? ` · ${r.openingsSkipped} not cut` : ''}${Number(r.openingsOutside) ? ` · ${r.openingsOutside} clear of host` : ''}</dd>
        <dt>Clips</dt><dd>${r.clipsApplied} applied${Number(r.booleansApproximated) ? ` · ${r.booleansApproximated} approximated` : ''}</dd>
        <dt>Materials</dt><dd>${defaulted ? `${fmtInt(defaulted.count)} assumed by element type` : 'all from the file'}</dd>
        <dt>Steps</dt><dd>${project.steps.length} in ${project.stages.filter((s) => s.kind === 'assembly').length} stages</dd>
        ${r.lifting ? `<dt>Lifting</dt><dd>${esc(sentenceStart(String(r.lifting)))}</dd>` : ''}
      </dl>
      <p class="cats mono">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</p>
      ${skipped.length ? `<p class="warn">Not drawn: ${skipped.map(([k, v]) => `${esc(k.replace(/^IFC/, 'Ifc'))} × ${v}`).join(', ')}</p>` : ''}
      ${warnings.filter((w) => w !== cutOff).map((w) => `<p class="warn">${esc(w)}</p>`).join('')}`,
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
    ${importFailure ? `<div class="report-alert bad import-error" role="note"><b>Not loaded</b><p>${esc(/[.!?]$/.test(importFailure.message) ? importFailure.message : `${importFailure.message}.`)} The model on show has not changed.</p>${importFailure.detail ? `<details><summary>Technical detail</summary><p class="mono">${esc(importFailure.detail)}</p></details>` : ''}</div>` : ''}
    ${importFailure && rows.length ? `<h6 class="report-of">On show: ${esc(project.meta.fileName ?? project.name)}</h6>` : ''}
    ${rows.join('')}
    ${project.meta.fileName === SAMPLE_NAME ? `<p class="credit">${esc(SAMPLE_CREDIT)}</p>` : ''}`;
  $('btnOpenIfc').addEventListener('click', () => $<HTMLInputElement>('fileIfc').click());
  $('btnSampleIfc').addEventListener('click', () => void loadSample());
  document.getElementById('btnShowDefaulted')?.addEventListener('click', () => setShowDefaulted(!showingDefaulted));
  $('btnArbor').addEventListener('click', () => {
    // supersedes any import still running; that import will no longer hide the card
    beginLoad();
    loading.hidden = true;
    mount(buildProject());
    playback.seek(0);
    playback.toggle(true);
    toast('Loaded Arbor House');
  });
}

// ── IFC import ─────────────────────────────────────────────────────────────
const loading = $('loading');
/** Why the last import failed, kept in the Import drawer after the message is gone; cleared by the next model shown. */
let importFailure: { message: string; detail: string } | null = null;
/** An import failed: say so in a message that stays until dismissed, and in the Import drawer (with the error itself folded away). */
function importFailed(message: string, detail = '') {
  importFailure = { message, detail };
  toast(message, 'error');
  if (view.rail === 'import') renderDrawer();
}
/** A load failed at `stage`: say why in words, keep the error for the drawer and the console. */
function loadFailed(fileName: string, err: unknown, stage: LoadStage, text?: string) {
  console.error(err);
  const e = importError(fileName, err, stage, text !== undefined && endsEarly(text));
  importFailed(e.message, e.detail);
}

// ── Assumed materials: shown on the model on request ───────────────────────
/** The model's elements with an assumed material (null when every material came from the file). */
let defaulted: DefaultedSummary | null = null;
/** Whether they are drawn in x-ray now. */
let showingDefaulted = false;
/**
 * Show the elements with an assumed material in x-ray on the whole model, or
 * stop. They share the issue x-ray, so an issue chosen afterwards replaces
 * them, and Esc lets go of them as it lets go of an issue.
 */
function setShowDefaulted(on: boolean) {
  on = on && !!defaulted?.parts.length;
  if (on) {
    issuesUI?.select(null);
    hideOverBanner();
    playback.toggle(false);
    // the whole model as built, before the material pass washes over it, so every element shows in place
    const built = project.stages.filter((st) => st.kind === 'assembly').at(-1);
    playback.seek(built ? built.end - 1e-3 : project.duration);
    viewer.setIssue({ primary: defaulted!.parts, secondary: [], lines: [] });
    viewer.autoFrame = true;
  } else if (showingDefaulted) viewer.setIssue(null);
  showingDefaulted = on;
  if (on) {
    const n = defaulted!.count;
    toast(`${n === 1 ? 'The element' : `${fmtInt(n)} elements`} with an assumed material ${n === 1 ? 'is' : 'are'} shown in red. Esc clears ${n === 1 ? 'it' : 'them'}.`);
    // the drawer would cover them: close it, keeping the keyboard on its rail item
    if (view.rail === 'import') {
      const fromDrawer = drawer.contains(document.activeElement);
      selectRail('model');
      if (fromDrawer) railButton('import')?.focus();
    }
  } else if (view.rail === 'import') renderDrawer();
}
function showLoading(label: string, share: number) {
  loading.hidden = false;
  $('loadingLabel').textContent = label;
  $('loadingBar').style.width = `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`;
}
const PHASE_LABEL = { parse: 'Reading the IFC file', geometry: 'Meshing elements', finish: 'Measuring elements' } as const;

/**
 * Loads replace one another: each takes a generation, and work from an older
 * one is dropped when it resumes (its progress, its result, its errors and
 * hiding the loading card), so the model shown is always the last one asked for.
 */
let loadGen = 0;
const beginLoad = () => ++loadGen;
class Superseded extends Error {}

/** Read IFC text and show it. Resolves true when this load is the one now shown. */
async function importIfcText(text: string, fileName: string, gen = beginLoad()): Promise<boolean> {
  const t0 = performance.now();
  try {
    const model = await readIfc(
      text,
      (phase, share) => {
        // a newer load took over: stop meshing this one
        if (gen !== loadGen) throw new Superseded();
        showLoading(PHASE_LABEL[phase], share);
      },
      fileName,
    );
    if (gen !== loadGen) return false;
    showLoading('Working out the build order', 1);
    await new Promise((r) => setTimeout(r, 0));
    if (gen !== loadGen) return false;
    const { project: p } = projectFromIfc(model, fileName);
    mount(p);
    playback.seek(0);
    playback.toggle(true);
    const done = loadedMessage(fileName, model.elements.length, (performance.now() - t0) / 1000, p.report as { truncated?: boolean; defaultedMaterials?: number } | undefined);
    toast(done.text, done.kind);
    return true;
  } catch (err) {
    if (err instanceof Superseded || gen !== loadGen) return false;
    loadFailed(fileName, err, 'read', text);
    return false;
  } finally {
    if (gen === loadGen) loading.hidden = true;
  }
}

async function importFile(file: File) {
  if (!/\.ifc(\.txt)?$/i.test(file.name)) {
    importFailed(`${file.name} is not an .ifc file. Export IFC from your BIM tool and try again.`);
    return;
  }
  const gen = beginLoad();
  showLoading(`Opening ${file.name}`, 0);
  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    if (gen !== loadGen) return;
    loading.hidden = true;
    loadFailed(file.name, err, 'open');
    return;
  }
  if (gen !== loadGen) return;
  await importIfcText(text, file.name, gen);
}

/** Fetch and show the Duplex sample. Resolves true when it is the model now shown. */
async function loadSample(): Promise<boolean> {
  const gen = beginLoad();
  showLoading('Fetching the Duplex sample', 0);
  try {
    const res = await fetch(SAMPLE_URL);
    if (gen !== loadGen) return false;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (gen !== loadGen) return false;
    return await importIfcText(text, SAMPLE_NAME, gen);
  } catch (err) {
    if (gen !== loadGen) return false;
    loading.hidden = true;
    loadFailed(SAMPLE_NAME, err, 'sample');
    return false;
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
  if (view.rail === 'render') renderDrawer();
  savePreferences();
}
function setColour(on: boolean) {
  view.colour = on;
  viewer.setColour(on);
  syncButtons();
  if (view.rail === 'render') renderDrawer();
  savePreferences();
}
function manualCut(): CutState {
  const n: Vec3 = view.section.plane === 'A' ? [1, 0, 0] : [0, 0, 1];
  return { on: true, normal: n, d: view.section.d };
}
function setSection(patch: Partial<typeof view.section>) {
  Object.assign(view.section, patch);
  press('btnSection', view.section.on);
  $('rail-sub-section').textContent = view.section.on ? `${view.section.plane}–${view.section.plane} · ${view.section.d.toFixed(1)} m` : 'A – A';
  viewer.invalidate();
  // keep an open Section drawer in step with the S key and the toolbar; updated in place,
  // because rebuilding it would drop the offset slider in the middle of a drag
  if (view.rail === 'section') {
    const on = document.getElementById('secOn') as HTMLInputElement | null;
    if (on) on.checked = view.section.on;
    drawer.querySelectorAll<HTMLButtonElement>('[data-plane]').forEach((b) => {
      b.classList.toggle('on', b.dataset.plane === view.section.plane);
      b.setAttribute('aria-pressed', String(b.dataset.plane === view.section.plane));
    });
    const d = document.getElementById('secD') as HTMLInputElement | null;
    if (d && document.activeElement !== d) d.value = String(view.section.d);
    const dv = document.getElementById('secDv');
    if (dv) dv.textContent = `${view.section.d.toFixed(1)} m`;
  }
}

let stageStarts: number[] = [];
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
    view.autoRotate = rotatePref = !view.autoRotate;
    viewer.setAutoRotate(view.autoRotate);
    syncButtons();
    savePreferences();
  },
  colour: () => setColour(!view.colour),
  section: () => setSection({ on: !view.section.on }),
  frame: () => {
    viewer.autoFrame = true;
    // in the crane plan, framing goes back to the plan
    if (view.cranePlan) framePlan();
    syncButtons();
  },
  speed: () => playback.cycleSpeed(),
  view: () => {
    if (view.cranePlan) setCranePlan(false);
    view.presetIndex = (view.presetIndex + 1) % VIEW_PRESETS.length;
    const v = VIEW_PRESETS[view.presetIndex];
    viewer.setView(v.az, v.el);
    $('btnView').title = `View: ${v.name}`;
  },
  ghost: () => {
    view.ghost = !view.ghost;
    viewer.setGhost(view.ghost);
    syncButtons();
    savePreferences();
  },
  crane: () => {
    if (!project.crane) return;
    view.crane = !view.crane;
    if (!view.crane && view.cranePlan) setCranePlan(false);
    syncButtons();
    savePreferences();
  },
  cranePlan: () => setCranePlan(!view.cranePlan),
  orbit: () => {
    view.orbit = !view.orbit;
    viewer.controls.enabled = view.orbit;
    // inline, over the orbit controls' own inline value: with orbit off, a swipe over the model scrolls the page
    viewer.renderer.domElement.style.touchAction = orbitTouchAction(view.orbit);
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
bind('btnMaterials', actions.colour);
bind('btnPresent', () => setClient(!view.client));
bind('btnHelp', openHelp);
bind('helpClose', closeHelp);
bind('heroPlay', playFromStart);
bind('introClose', dismissIntro);
bind('btnFrame', actions.frame);
bind('btnSpeed', actions.speed);
bind('btnView', actions.view);
bind('btnGhost', actions.ghost);
bind('btnOrbit', actions.orbit);
bind('btnCrane', actions.crane);
bind('btnCranePlan', actions.cranePlan);
bind('liftBannerClose', () => hideOverBanner());
bind('liftBannerIssue', () => {
  const i = bannerIssue();
  hideOverBanner();
  if (i) {
    view.tab = 'issues';
    syncButtons();
    issuesUI?.selectById(i.id);
  }
});
bind('btnSection', actions.section);
$('btnMenu').addEventListener('click', (e) => selectRail(view.rail === 'render' ? 'model' : 'render', e.detail === 0));
bind('stagePrev', () => jumpStage(-1));
bind('stageNext', () => jumpStage(1));
bind('tabSeq', () => ((view.tab = 'seq'), syncButtons()));
bind('tabMembers', () => {
  view.tab = 'members';
  if (view.rail === 'model') view.rail = 'parts';
  syncButtons();
});
bind('tabIssues', () => ((view.tab = 'issues'), syncButtons()));
bind('btnFlags', () => {
  view.flags = !view.flags;
  viewer.setFlagsVisible(view.flags);
  syncButtons();
  savePreferences();
});
bind('btnBcf', () => void exportBcf());
bind('btnCsv', () => void exportCsv());
bind('btnLog', () => setLogOpen($('log').classList.contains('collapsed')));
$<HTMLSelectElement>('selStyle').addEventListener('change', (e) => setStyle((e.target as HTMLSelectElement).value as RenderStyle));
$<HTMLInputElement>('memberSearch').addEventListener('input', (e) => {
  ui?.filterMembers((e.target as HTMLInputElement).value);
  viewer.invalidate();
});
viewer.renderer.domElement.addEventListener('wheel', () => queueMicrotask(syncButtons), { passive: true });
{
  // scrubber: bound once, reads the current project's duration
  const track = $('scrubTrack');
  const drag = new ScrubDrag();
  const seekFromEvent = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    if (project) playback.seek(((e.clientX - r.left) / r.width) * project.duration);
  };
  track.addEventListener('pointerdown', (e) => {
    if (!drag.down(e.pointerId, e.button)) return;
    track.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  });
  track.addEventListener('pointermove', (e) => {
    if (drag.move(e.pointerId, track.hasPointerCapture(e.pointerId))) seekFromEvent(e);
  });
  // a cancel (the browser took the gesture) or a lost capture ends the drag as surely as a release
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) track.addEventListener(type, (e) => drag.end(e.pointerId));
}
{
  // measured chrome the stylesheet places things against: the caption and the drawers sit under the
  // toolbar however many rows it wraps to; the page and the issue sheet make room for the pinned play bar
  const toolbar = document.querySelector<HTMLElement>('.toolbar')!;
  const bar = $('playbar');
  const transport = $('transport');
  const sheet = $('issueSheet');
  const measure = () => {
    $('viewport').style.setProperty('--toolbar-bottom', `${toolbar.offsetTop + toolbar.offsetHeight}px`);
    // the play bar has no box of its own on a wide screen
    const h = bar.getBoundingClientRect().height;
    if (h > 0) document.documentElement.style.setProperty('--playbar-h', `${Math.ceil(h)}px`);
    else document.documentElement.style.removeProperty('--playbar-h');
    // the open issue sheet covers the foot of the page too: the page grows by it so its end can still be read
    const sh = sheet.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--sheet-h', `${sh > 0 ? Math.ceil(sh) + 6 : 0}px`);
  };
  // the transport scrolls sideways on a phone, where the scrollbar is hidden: a fade marks the side with more
  const fade = () => {
    const m = moreSides(transport.scrollLeft, transport.clientWidth, transport.scrollWidth);
    transport.classList.toggle('more-start', m.start);
    transport.classList.toggle('more-end', m.end);
  };
  measure();
  fade();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      measure();
      fade();
    });
    for (const el of [toolbar, bar, transport, sheet]) ro.observe(el);
  }
  narrow?.addEventListener('change', () => {
    measure();
    fade();
  });
  transport.addEventListener('scroll', fade, { passive: true });
}

// ── Save sequence ──────────────────────────────────────────────────────────
// Inside a claude.ai artifact the frame blocks page-started downloads, so the
// save goes through the `downloads` capability (the viewer confirms it).
// Standalone (dev server, saved copy) it falls back to a normal download.
type DownloadsNS = { save(req: { filename: string; data: string | Blob }): Promise<{ status: 'saved' | 'delivered' }> };
type ClaudeHost = { use(name: 'downloads'): Promise<DownloadsNS | null> };
const host = (window as unknown as { claude?: ClaudeHost }).claude;
const downloadsReady: Promise<DownloadsNS | null> | null = typeof host?.use === 'function' ? host.use('downloads') : null;
// where this view cannot save files, the save buttons are hidden rather than left to fail
// (hidden, not disabled: the Issues pane sets disabled on BCF and CSV from the issue count)
const setCanSave = (ok: boolean) => {
  for (const id of ['btnDownload', 'btnBcf', 'btnCsv']) $(id).hidden = !ok;
};
downloadsReady?.then(
  (d) => setCanSave(!!d),
  () => setCanSave(false),
);
/** Whether a file can be saved here; says so when it cannot. Asked before any slow export work. */
async function canSave(): Promise<boolean> {
  if (!downloadsReady || (await downloadsReady.catch(() => null))) return true;
  toast('Saving files is not available in this view.');
  return false;
}

let toastTimer = 0;
/** A message at the foot of the panel (above the play bar on a narrow screen). A failure stays until it is dismissed or replaced. */
function toast(msg: string, kind: ToastKind = 'info') {
  const el = $('toast');
  const text = $('toastText');
  text.textContent = msg;
  // a failure interrupts; anything else waits its turn
  text.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('warn', kind === 'warn');
  el.hidden = false;
  clearTimeout(toastTimer);
  const life = toastLife(kind);
  if (life !== null) toastTimer = window.setTimeout(() => (el.hidden = true), life);
}
bind('toastClose', () => {
  clearTimeout(toastTimer);
  $('toast').hidden = true;
});

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

bind('btnDownload', () => {
  if (project) void saveFile(`${project.id}-sequence.json`, sequenceJson(project, report), 'application/json');
});

// ── Keyboard ───────────────────────────────────────────────────────────────
/** What each page shortcut does (the keys are in ui/shortcuts.ts, which also writes the shortcut sheet). */
const keyActions: Record<ActionId, () => void> = {
  play: actions.play,
  rebuild: actions.rebuild,
  rotate: actions.rotate,
  colour: actions.colour,
  frame: actions.frame,
  speed: actions.speed,
  view: actions.view,
  ghost: actions.ghost,
  crane: actions.crane,
  cranePlan: actions.cranePlan,
  section: actions.section,
  import: () => selectRail('import'),
  nextIssue: () => issuesUI?.step(1),
  prevIssue: () => issuesUI?.step(-1),
  stepBack: () => jumpStep(-1),
  stepOn: () => jumpStep(1),
  start: () => playback.seek(0),
  present: () => setClient(!view.client),
  help: openHelp,
};
window.addEventListener('keydown', (e) => {
  if (!mounted) return; // the first model is still loading
  // the shortcut sheet is modal: it takes Esc itself, and ? closes it again
  if (help.open) {
    if (e.key === '?') {
      e.preventDefault();
      closeHelp();
    }
    return;
  }
  const k = e.key.toLowerCase();
  const target = e.target as HTMLElement;
  // the focused control's own keys come first: Space and Enter press a button or tick a box,
  // a field takes what is typed; Space plays only from the page, the model or the scrubber
  const route = routeKey(target, k);
  if (route === 'native') return;
  if (k === 'escape') {
    // Esc inside a drawer closes it and gives the focus back to its rail item
    if (!drawer.hidden && drawer.contains(document.activeElement)) {
      const from = view.rail;
      selectRail('model');
      railButton(from)?.focus();
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur();
    if (bannerPick) hideOverBanner();
    else if (issuesUI?.selected) issuesUI.select(null);
    else if (showingDefaulted) setShowDefaulted(false);
    else if (introOpen) dismissIntro();
    else selectRail('model');
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (route === 'tabs') {
    // the panel tabs: arrows, Home and End move along them and show the tab reached
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === target.id);
    const next = $(TABS[nextTab(i, TABS.length, k)].id);
    next.click();
    next.focus();
    return;
  }
  if (route === 'slider') {
    // the scrubber: a step at a time, a stage a page at a time, or either end
    e.preventDefault();
    const slider: Record<string, () => void> = {
      arrowleft: () => jumpStep(-1),
      arrowdown: () => jumpStep(-1),
      arrowright: () => jumpStep(1),
      arrowup: () => jumpStep(1),
      pagedown: () => jumpStage(-1),
      pageup: () => jumpStage(1),
      home: () => playback.seek(0),
      end: () => playback.seek(project.duration),
    };
    slider[k]?.();
    return;
  }
  if (k === 'd' && e.shiftKey) {
    e.preventDefault();
    setPerf(!view.perf);
    return;
  }
  const id = keyAction(k);
  if (id) {
    e.preventDefault();
    keyActions[id]();
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

/** Sequence time of the last frame drawn; NaN forces the next one. */
let drawnT = NaN;

/**
 * One frame, drawn only when there is something new to show: the sequence
 * time moved (playing or a seek), the camera is moving (orbit, auto-rotate,
 * easing to a framing) or a setting changed (viewer.invalidate). Paused with
 * a still camera, the page draws nothing and the canvas keeps the last frame.
 */
function loop(now: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!mounted) return;
  const before = playback.t;
  playback.tick(dt);
  // the first pick over the chart stops playback, once per playthrough
  const over = overWatch.advance(before, playback.t, playback.playing);
  if (over) stopOnOverPick(over);
  syncReachMode();
  if (playback.t === drawnT && viewer.idle && !firstFrame) return;
  drawnT = playback.t;
  const state = timeline.stateAt(playback.t);
  viewer.setWash(state.presentation.wash.front);
  viewer.setCut(view.section.on ? manualCut() : state.presentation.cut);
  // an issue is a deliberate jump: a quick move (instant with reduced motion); the fly-through eases slowly
  // a resized viewport has its cards in new places: frame the issue again
  const vs = viewer.viewportSize;
  if (focusPose && issuesUI?.selected && focusFrame && (focusFrame.w !== vs.w || focusFrame.h !== vs.h)) frameIssue(issuesUI.selected);
  if (planPose && planFrame && (planFrame.w !== vs.w || planFrame.h !== vs.h)) framePlan();
  viewer.aimAt(focusPose && focusFrame ? focusFrame.aim : planPose && planFrame ? planFrame.aim : null);
  const pose = focusPose ?? planPose ?? state.presentation.pose;
  viewer.frame(state.t, state.builtTop, state.builtHalf, view.crane ? state.crane : { ...state.crane, visible: false }, dt, firstFrame || ((!!focusPose || !!planPose) && reduceMotion), pose, focusPose ? 9 : 3.2);
  if (focusPose && !viewer.autoFrame) focusPose = null; // the view was dragged away
  if (planPose && !viewer.autoFrame) planPose = null;
  syncCaption();
  overlays.update(state, view.crane);
  ui.update(state, view.tab === 'members');
  issuesUI?.update(state);

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

  // frame rate and the log's activity line
  if (dt > 0) fpsEma += (1 / dt - fpsEma) * 0.05;
  frameTimes.push(dt * 1000);
  if (frameTimes.length > 80) frameTimes.shift();
  hudAcc += dt;
  if (hudAcc > 0.25) {
    hudAcc = 0;
    if (view.perf) {
      // the performance overlay, only while it is on
      const st = viewer.stats();
      ui.perf = { fps: fpsEma, draws: st.draws, tris: st.tris, res: viewer.pixelRatio };
      $('gpuFps').textContent = String(Math.round(fpsEma));
      $('gpuDraws').textContent = String(st.draws);
      $('gpuTris').textContent = `${Math.round(st.tris / 1000)}k`;
      $('gpuRes').textContent = `${viewer.pixelRatio.toFixed(2)}×`;
      drawSpark(spark, frameTimes, 40, cssVar('--brand'), true);
    }
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
    const p = project;
    requestAnimationFrame(() => {
      if (p === project) makeThumbnails();
    });
  }
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
  let r: CheckReport;
  try {
    r = await runChecks(p, checkSettings, (label, share) => {
      if (run === checkRun) issuesUI?.running(label, share);
    });
  } catch (err) {
    // a failure outside any one rule (setting up the check scene) must not leave the pane on "Checking…"
    if (run !== checkRun || p !== project) return;
    console.error(err);
    issuesUI?.failed(err instanceof Error ? err.message : String(err));
    return;
  }
  if (run !== checkRun || p !== project) return; // a newer project or run took over
  report = r;
  syncLiftWarn();
  issuesUI!.setReport(r);
  if (bcfBusy) $('btnBcf').toggleAttribute('disabled', true);
  viewer.setFlags([...new Set(r.issues.filter((i) => FLAG_RULES.has(i.rule) && (i.severity === 'critical' || i.severity === 'major')).flatMap((i) => i.primary))]);
  renderRulesPanel();
  if (bannerPick) syncOverBanner();
  document.body.dataset.checks = String(r.issues.length);
}

/**
 * What to draw for an issue: everything for small ones; for issues spanning many
 * floors (edge protection up a tower) only what lies in its framing box, so the
 * first case reads clearly. The register and the BCF keep every element.
 */
function issueDrawing(i: Issue, p: Project = project): IssueSpec {
  const [lo, hi] = i.box;
  const m = 1;
  const inBox = (k: number) => {
    const part = p.parts[k];
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
    // letting go of an issue leaves the assumed materials alone when they are what is on show
    if (!showingDefaulted) viewer.setIssue(null);
    focusPose = null;
    return;
  }
  if (showingDefaulted) {
    showingDefaulted = false;
    if (view.rail === 'import') renderDrawer();
  }
  playback.toggle(false);
  playback.seek(timeForStep(i.step));
  hideOverBanner();
  viewer.setIssue(issueDrawing(i));
  // one column: the issue is looked at on the model, so the page comes up to it (at once, so the framing below measures the page as it will be)
  if (isNarrow()) {
    const dy = revealScroll($('viewport').getBoundingClientRect().top);
    if (dy) window.scrollBy({ top: dy, behavior: 'instant' });
  }
  frameIssue(i);
  viewer.autoFrame = true;
  if (view.tab !== 'issues') {
    view.tab = 'issues';
    syncButtons();
  }
}

/**
 * Frame an issue in the part of the viewport the cards and controls leave
 * clear, so its pin is never under the caption or the title block: the
 * camera fits the issue to that box and the view offset centres it there.
 */
function frameIssue(i: Issue) {
  const { w, h } = viewer.viewportSize;
  const host = $('viewport');
  const fr = issueFrame({ x0: 0, y0: 0, x1: w, y1: h }, chromeBoxes(host, FRAME_CHROME, 8, document), captionBox());
  const bw = fr.box.x1 - fr.box.x0, bh = fr.box.y1 - fr.box.y0;
  const v = issueView(i, w / Math.max(1, h), bounds(), { w: bw / Math.max(1, w), h: bh / Math.max(1, h) });
  focusPose = { target: v.target, az: v.az, el: v.el, dist: v.dist, fov: v.fov };
  focusFrame = { aim: { x: (fr.box.x0 + fr.box.x1) / 2 / Math.max(1, w), y: (fr.box.y0 + fr.box.y1) / 2 / Math.max(1, h) }, hideCaption: fr.hideCaption, w, h };
}

/** The operation panel, the reach ring and its label read lifts as the checks do: same review threshold, same rigging allowance. */
function syncLiftWarn() {
  ui.liftWarn = overlays.liftWarn = viewer.reachWarnAt = checkSettings.craneWarn;
  ui.liftRigKg = overlays.liftRigKg = viewer.reachRigKg = checkSettings.riggingKg;
  // the rigging allowance decides which pick is the first over the chart
  const pick = firstOverPick(project, checkSettings.riggingKg);
  const was = overWatch.pick;
  if (!was || !pick || was.stepIndex !== pick.stepIndex || was.t !== pick.t) overWatch = new OverPickWatch(pick);
  viewer.invalidate();
}

// ── The crane: its reach gives way to issues, its plan view, its first over-chart pick ──
/**
 * How the reach overlay shows: hidden while an issue outside the crane checks
 * is explained (its rings and labels would compete with the pin), emphasised
 * in the crane plan, as usual otherwise.
 */
function syncReachMode() {
  const sel = issuesUI?.selected;
  const mode = sel && RULE_BY_ID[sel.rule].family !== 'REACH' ? 'hidden' : view.cranePlan ? 'emph' : 'normal';
  if (overlays.reachMode !== mode) {
    overlays.reachMode = mode;
    viewer.invalidate();
  }
  viewer.setReachMode(mode);
}

/** The crane plan on or off: from above with the reach emphasised, then back to the view it came from. */
function setCranePlan(on: boolean) {
  if (on && !project.crane) {
    toast('No tower crane on this project: it is lifted by mobile crane and by hand.');
    return;
  }
  if (on === view.cranePlan) return;
  view.cranePlan = on;
  if (on) {
    presetBeforePlan = view.presetIndex;
    if (!view.crane) view.crane = true; // the plan is about the crane: show it (not saved as a preference)
    issuesUI?.select(null);
    viewer.autoFrame = true;
    framePlan();
  } else {
    planPose = null;
    planFrame = null;
    view.presetIndex = presetBeforePlan;
    const v = VIEW_PRESETS[view.presetIndex];
    viewer.setView(v.az, v.el);
    viewer.autoFrame = true;
  }
  syncReachMode();
  syncButtons();
}

/** The caption card's box in the viewport (counted even while hidden: it may come back), or null under an open drawer. */
function captionBox() {
  if (!drawer.hidden) return null;
  const r = $('caption').getBoundingClientRect(), o = $('viewport').getBoundingClientRect();
  return r.width >= 1 && r.height >= 1 ? { x0: r.left - o.left - 8, y0: r.top - o.top - 8, x1: r.right - o.left + 8, y1: r.bottom - o.top + 8 } : null;
}

/** Fit the slew circle, seen from above, into the part of the viewport the cards and controls leave clear. */
function framePlan() {
  const c = project.crane;
  if (!c) return;
  const { w, h } = viewer.viewportSize;
  // the same rule as an issue: the caption stays unless keeping it leaves too little room
  const fr = issueFrame({ x0: 0, y0: 0, x1: w, y1: h }, chromeBoxes($('viewport'), FRAME_CHROME, 8, document), captionBox());
  const box = fr.box;
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  planPose = cranePlanPose(c, w / Math.max(1, h), { w: bw / Math.max(1, w), h: bh / Math.max(1, h) });
  planFrame = { aim: { x: (box.x0 + box.x1) / 2 / Math.max(1, w), y: (box.y0 + box.y1) / 2 / Math.max(1, h) }, hideCaption: fr.hideCaption, w, h };
}

const fmtLoad = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg / 10) * 10} kg`);

/** The crane check's issue for the pick the banner is about, once the checks have run. */
function bannerIssue(): Issue | undefined {
  const op = bannerPick;
  return op ? report?.issues.find((i) => i.rule === 'REACH-CRANE' && i.step === op.stepIndex) : undefined;
}

/** Stop on the first pick over the chart and say what it is, with a way to the issue. */
function stopOnOverPick(op: OverPick) {
  playback.toggle(false);
  playback.seek(op.t);
  const p = project, c = p.crane!;
  const s = p.steps[op.stepIndex];
  const piece = sentenceStart(op.part >= 0 ? partLabel(p, op.part) : s.member);
  const rig = op.kg > op.pieceKg + 0.5 ? ` (incl. ${fmtLoad(op.kg - op.pieceKg)} rigging)` : '';
  $('liftBannerHead').textContent = op.capKg > 0 ? `Pick over the crane's chart · ${Math.round(op.util * 100)} %` : 'Pick beyond the crane\'s jib';
  $('liftBannerBody').textContent =
    op.capKg > 0
      ? `${piece}, step ${s.id}: ${fmtLoad(op.kg)} reviewed${rig} at ${op.radius.toFixed(1)} m radius, where ${c.id} lifts ${fmtLoad(op.capKg)}. Playback is paused here.`
      : `${piece}, step ${s.id}: ${fmtLoad(op.kg)} at ${op.radius.toFixed(1)} m, past ${c.id}'s ${c.jib} m jib. Playback is paused here.`;
  bannerPick = op;
  syncOverBanner();
  $('liftBanner').hidden = false;
  syncCaption();
}

/** The banner's issue button, once the checks have found the matching issue. */
function syncOverBanner() {
  const i = bannerIssue();
  const b = $<HTMLButtonElement>('liftBannerIssue');
  b.hidden = !i;
  if (i) b.textContent = `Open ${i.id}`;
}

function hideOverBanner() {
  bannerPick = null;
  $('liftBanner').hidden = true;
  syncCaption();
}

/** Rules, their verification status and the thresholds, inside the Issues pane. */
function renderRulesPanel() {
  const body = $('issRulesBody');
  const s = checkSettings;
  const field = (f: (typeof THRESHOLD_FIELDS)[number]) =>
    `<label for="${f.id}">${f.label}</label><input id="${f.id}" type="number" step="${f.step}" min="${f.min}" value="${thresholdValue(f, s)}" />`;
  body.innerHTML = `${rulesTable(report)}
    <div class="set">
      ${THRESHOLD_FIELDS.map(field).join('')}
    </div>
    <p class="set-msg" id="setMsg" role="alert" hidden></p>
    <div class="opts"><button id="btnRerun" class="xbtn">Run the checks again</button><button id="btnDefaults" class="xbtn">Defaults</button></div>`;
  $('btnRerun').addEventListener('click', () => {
    const values = Object.fromEntries(THRESHOLD_FIELDS.map((f) => [f.id, ($(f.id) as HTMLInputElement).valueAsNumber]));
    const { settings, invalid } = readThresholds(values, checkSettings);
    for (const f of THRESHOLD_FIELDS) $(f.id).toggleAttribute('aria-invalid', invalid.includes(f));
    const msg = $('setMsg');
    msg.hidden = !invalid.length;
    if (invalid.length) {
      // an empty or out-of-range field would otherwise run the checks with 0 (headroom 0 passes every stair)
      msg.textContent = invalid.map((f) => `${f.label.replace(/ \(.*\)$/, '')} needs a number${f.min > 0 ? ` of at least ${f.min}` : ''}.`).join(' ');
      $(invalid[0].id).focus();
      return;
    }
    checkSettings = settings;
    savePreferences();
    rerunChecks();
  });
  $('btnDefaults').addEventListener('click', () => {
    checkSettings = defaultSettings();
    savePreferences();
    rerunChecks();
  });
}

function rerunChecks() {
  issuesUI?.select(null);
  // new thresholds, same view: the severity and family filters carry over (a new model starts afresh)
  const kept = issuesUI?.filters();
  issuesUI = newIssuesUI(project);
  if (kept) issuesUI.restoreFilters(kept);
  report = null;
  renderRulesPanel();
  void startChecks();
}

/** View toggles and thresholds back to their defaults, and nothing kept in this browser. */
function resetPreferences() {
  clearPrefs(store);
  rotatePref = true;
  clientPref = false;
  Object.assign(view, VIEW_DEFAULTS);
  applyViewLook();
  applyMode();
  viewer.setAutoRotate(view.autoRotate);
  viewer.setResolution(view.resolution);
  updateRail();
  syncButtons();
  renderDrawer();
  if (!sameSettings(checkSettings, defaultSettings())) {
    checkSettings = defaultSettings();
    rerunChecks();
  }
  toast('Settings reset to their defaults');
}

async function exportCsv() {
  if (!report) return;
  const p = project, r = report;
  const csv = issuesCsv(p, r, timeForStep);
  if (!(await canSave())) return;
  await saveFile(`${p.id}-issues.csv`, csv, 'text/csv');
}

/** Set while a BCF export renders its snapshots: a second click must not start another. */
let bcfBusy = false;

/**
 * The issues as BCF, each with a snapshot. The snapshots take a while, and the
 * page stays live meanwhile: the export works on the model and report it
 * started with, stops if either is replaced, and borrows the highlight for
 * each still without touching the issue selected on screen.
 */
async function exportBcf() {
  if (bcfBusy || !report || !report.issues.length) return;
  bcfBusy = true;
  const btn = $<HTMLButtonElement>('btnBcf');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  const p = project, r = report;
  const stale = () => p !== project || r !== report;
  const stop = () => toast('BCF export stopped: the model or the checks changed.');
  try {
    if (!(await canSave())) return;
    const shots = new Map<string, Uint8Array>();
    for (let k = 0; k < r.issues.length; k++) {
      if (stale()) return stop();
      const i = r.issues[k];
      toast(`Rendering BCF snapshots · ${k + 1} / ${r.issues.length}`);
      shots.set(i.id, await viewer.issuePng(issueView(i, 1.6, bounds()), timeForStep(i.step), issueDrawing(i, p)));
      await new Promise((res) => setTimeout(res, 0));
    }
    if (stale()) return stop();
    const bytes = bcfZip(p, r, shots);
    // the claude.ai save prompt accepts .zip, not .bcfzip; BCF tools read either once renamed
    await saveFile(downloadsReady ? `${p.id}-issues.bcf.zip` : `${p.id}-issues.bcfzip`, bytes, 'application/zip', downloadsReady ? 'Rename it to .bcfzip if your BCF tool asks.' : '');
  } catch (err) {
    console.error(err);
    toast(`BCF export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
  } finally {
    bcfBusy = false;
    btn.removeAttribute('aria-busy');
    btn.disabled = !report?.issues.length;
  }
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
  selectIssue: (id: string) => issuesUI?.selectById(id),
  bcfBytes: () => (report ? bcfZip(project, report) : null),
};

/** The camera a link asks for (?az=, ?el=), when it gives numbers. */
function linkView() {
  const az = parseFloat(params.get('az') ?? '');
  const el = parseFloat(params.get('el') ?? '');
  if (Number.isFinite(az)) viewer.setView(az, Number.isFinite(el) ? el : 16);
}

if (sampleFirst) {
  syncButtons();
  $('tagline').textContent = 'LOADING THE DUPLEX SAMPLE';
  $('capTitle').textContent = 'Duplex sample';
  $('capSub').textContent = 'Reading the IFC file in your browser…';
  void loadSample().then((shown) => {
    if (shown) {
      openPlayback(project);
      linkView();
    } else if (!mounted) {
      // the sample could not be read and nothing else was opened meanwhile: show the demo tower
      mount(buildProject());
      openPlayback(project);
      linkView();
    }
  });
} else {
  mount(project);
  linkView();
}
requestAnimationFrame(loop);
