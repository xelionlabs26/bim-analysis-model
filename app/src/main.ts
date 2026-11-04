import '@fontsource/archivo/600.css';
import '@fontsource/archivo/800.css';
import '@fontsource/archivo/900.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/source-serif-4/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';

import { ACTIVE_HOLD, buildProject } from './data/project';
import { Timeline } from './engine/timeline';
import { Playback } from './engine/playback';
import { VIEW_PRESETS, Viewer, type RenderStyle } from './scene/viewer';
import { Overlays, drawingScale, scaleBarLength } from './ui/overlays';
import { SequenceUI } from './ui/panels';
import { renderHeaderDrawing, startClock } from './ui/header';
import { hydrateIcons, ICONS, setIcon } from './ui/icons';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ── Model + engine ─────────────────────────────────────────────────────────
const project = buildProject();
const timeline = new Timeline(project);
const playback = new Playback(project.duration);

const params = new URLSearchParams(location.search);
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
if (params.has('t')) playback.seek(Number(params.get('t')));
else if (reduceMotion) playback.seek(project.duration); // open on the finished model, paused
if (params.get('paused') === '1' || (reduceMotion && !params.has('t'))) playback.playing = false;

hydrateIcons();
renderHeaderDrawing($('headerDrawing'), project, project.stages[0].sheet);
startClock($('clockDate'), $('clockTime'));

const viewer = new Viewer($('viewport'), project);
const overlays = new Overlays($('overlaySvg') as unknown as SVGSVGElement, $('overlayHtml'), project, timeline, viewer);
const ui = new SequenceUI(project, timeline, (t) => playback.seek(t), (i) => {
  playback.toggle(false);
  playback.seek(timeForStep(i));
});

// ── View state ─────────────────────────────────────────────────────────────
const view = {
  style: 'ink+paint' as RenderStyle,
  colour: false,
  ghost: true,
  autoRotate: params.get('rotate') !== '0' && !reduceMotion,
  orbit: true,
  presetIndex: 0,
  stageMask: 255,
  resolution: 1.5,
  rail: 'model',
  tab: 'seq' as 'seq' | 'members',
};
viewer.setResolution(view.resolution);
viewer.setAutoRotate(view.autoRotate);
if (params.has('az')) viewer.setView(Number(params.get('az')), Number(params.get('el') ?? 19));

function syncButtons() {
  $('btnRotate').classList.toggle('on', view.autoRotate);
  $('btnColour').classList.toggle('on', view.colour);
  $('btnGhost').classList.toggle('on', view.ghost);
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
  $('paneSeq').hidden = view.tab !== 'seq';
  $('paneMembers').hidden = view.tab !== 'members';
}
playback.onChange(syncButtons);

// ── Rail ───────────────────────────────────────────────────────────────────
const RAIL = [
  { id: 'model', label: 'Model', sub: '5 TIERS', icon: 'model' },
  { id: 'layers', label: 'Layers', sub: `${project.stages.length} STAGES`, icon: 'layers' },
  { id: 'parts', label: 'Parts', sub: `${(project.parts.length / 1000).toFixed(1)}K PCS`, icon: 'parts' },
  { id: 'section', label: 'Section', sub: 'A – A', icon: 'section', disabled: true },
  { id: 'render', label: 'Render', sub: 'INK', icon: 'render' },
  { id: 'settings', label: 'Settings', sub: 'MSAA · 1.5×', icon: 'settings' },
  { id: 'language', label: 'Language', sub: 'EN', icon: 'language' },
];
const railWrap = $('railItems');
RAIL.forEach((r, i) => {
  const b = document.createElement('button');
  b.className = 'rail-item';
  b.dataset.id = r.id;
  b.disabled = !!r.disabled;
  b.title = r.disabled ? `${r.label} — milestone M5` : `${r.label} (${i + 1})`;
  b.innerHTML = `<span class="ico">${ICONS[r.icon]}</span><span class="lbl">${r.label}</span><span class="sub" id="rail-sub-${r.id}">${r.sub}</span><span class="key">${i + 1}</span>`;
  b.addEventListener('click', () => selectRail(r.id));
  railWrap.append(b);
});

const drawer = $('drawer');
function selectRail(id: string) {
  const item = RAIL.find((r) => r.id === id);
  if (!item || item.disabled) return;
  view.rail = view.rail === id && id !== 'model' ? 'model' : id;
  if (view.rail === 'parts') view.tab = 'members';
  renderDrawer();
  syncButtons();
}

function renderDrawer() {
  const id = view.rail;
  drawer.hidden = !['layers', 'render', 'settings', 'language'].includes(id);
  $('caption').style.visibility = drawer.hidden ? 'visible' : 'hidden';
  if (drawer.hidden) return;
  if (id === 'layers') {
    drawer.innerHTML =
      '<h5>LAYERS · STAGES</h5>' +
      project.stages
        .map(
          (s, i) =>
            `<label><input type="checkbox" data-bit="${i}" ${view.stageMask & (1 << i) ? 'checked' : ''} ${s.available ? '' : 'disabled'} /> ${String(s.n).padStart(2, '0')} · ${s.title}${s.available ? '' : ' <span class="muted">(M5)</span>'}</label>`,
        )
        .join('');
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
        $('rail-sub-settings').textContent = `MSAA · ${view.resolution.toFixed(1)}×`;
        renderDrawer();
      }),
    );
  } else if (id === 'language') {
    drawer.innerHTML = '<h5>LANGUAGE</h5><div class="opts"><button class="on">English</button></div><p style="margin-top:10px">Other languages are not translated yet.</p>';
  }
}

// ── Toolbar / transport ────────────────────────────────────────────────────
function setStyle(s: RenderStyle) {
  view.style = s;
  viewer.setStyle(s);
  $('rail-sub-render').textContent = s === 'ink' ? 'INK' : s === 'paint' ? 'PAINT' : 'INK + PAINT';
  syncButtons();
}
function setColour(on: boolean) {
  view.colour = on;
  viewer.setColour(on);
  syncButtons();
}
const stageStarts = project.stages.filter((s) => s.available).map((s) => s.start);
function jumpStage(dir: 1 | -1) {
  const t = playback.t;
  const cur = stageStarts.reduce((a, s, i) => (t >= s - 1e-3 ? i : a), 0);
  const target = dir > 0 ? Math.min(cur + 1, stageStarts.length - 1) : t - stageStarts[cur] > 0.6 ? cur : Math.max(cur - 1, 0);
  playback.seek(stageStarts[target] + 0.001);
}
/** A time at which `index` is the current step, as settled as it can be before the next one starts. */
export function timeForStep(index: number) {
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
bind('btnMenu', () => selectRail(view.rail === 'render' ? 'model' : 'render'));
bind('stagePrev', () => jumpStage(-1));
bind('stageNext', () => jumpStage(1));
bind('tabSeq', () => ((view.tab = 'seq'), syncButtons()));
bind('tabMembers', () => ((view.tab = 'members'), syncButtons()));
bind('btnLogClose', () => document.querySelector('.log')!.classList.toggle('collapsed'));
$<HTMLSelectElement>('selStyle').addEventListener('change', (e) => setStyle((e.target as HTMLSelectElement).value as RenderStyle));
viewer.renderer.domElement.addEventListener('wheel', () => queueMicrotask(syncButtons), { passive: true });

// ── Save sequence ──────────────────────────────────────────────────────────
// Inside a claude.ai artifact the frame blocks page-started downloads, so the
// save goes through the `downloads` capability (the viewer confirms it).
// Standalone (dev server, saved copy) it falls back to a normal download.
type DownloadsNS = { save(req: { filename: string; data: string }): Promise<{ status: 'saved' | 'delivered' }> };
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
  toastTimer = window.setTimeout(() => (el.hidden = true), 3200);
}

function sequenceJson(): string {
  return JSON.stringify(
    {
      project: { id: project.id, name: project.name, rev: project.rev, height: project.height, totalMassKg: Math.round(project.totalMassKg) },
      stages: project.stages,
      steps: project.steps.map((s) => ({
        id: s.id,
        stage: s.stage,
        tier: s.tier,
        member: s.member,
        code: s.code,
        qty: s.partCount,
        material: s.material,
        spec: s.spec,
        massKg: Math.round(s.massKg),
        centroid: s.centroid.map((v) => +v.toFixed(3)),
        t0: +s.t0.toFixed(3),
        t1: +s.t1.toFixed(3),
      })),
    },
    null,
    2,
  );
}

bind('btnDownload', async () => {
  const filename = `${project.id}-sequence.json`;
  if (downloadsReady) {
    const downloads = await downloadsReady.catch(() => null);
    if (!downloads) return;
    try {
      const res = await downloads.save({ filename, data: sequenceJson() });
      if (res.status === 'saved') toast(`Saved ${filename}`);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'declined') return;
      if (code === 'rate_limited') toast('A save prompt is already open.');
      else {
        toast('Saving files is not available in this view.');
        $('btnDownload').hidden = true;
      }
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([sequenceJson()], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Downloading ${filename}`);
});

// ── Keyboard ───────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    (document.activeElement as HTMLElement | null)?.blur();
    selectRail('model');
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
    arrowleft: () => jumpStep(-1),
    arrowright: () => jumpStep(1),
    home: () => playback.seek(0),
  };
  if (map[k]) {
    e.preventDefault();
    map[k]();
  } else if (/^[1-7]$/.test(k)) selectRail(RAIL[Number(k) - 1].id);
  else if (k === 'escape') selectRail('model');
});

// ── Render loop ────────────────────────────────────────────────────────────
const spark = $<HTMLCanvasElement>('gpuSpark');
const logSpark = $<HTMLCanvasElement>('logSpark');
const frameTimes: number[] = [];
let fpsEma = 60;
let last = performance.now();
let firstFrame = true;
let hudAcc = 0;

function drawSpark(c: HTMLCanvasElement, values: number[], max: number, color: string, band = false) {
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  if (band) {
    ctx.fillStyle = 'rgba(157,17,37,0.12)';
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
  viewer.frame(state.t, state.builtTop, state.builtHalf, dt, firstFrame);
  overlays.update(state);
  ui.update(state, view.tab === 'members');

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
    drawSpark(spark, frameTimes, 40, '#9d1125', true);
    const activity = Array.from({ length: 40 }, (_, i) => {
      const t = state.t - (40 - i) * 0.05;
      const k = timeline.stepIndexAt(t);
      return k >= 0 && t < project.steps[k].t1 ? 1 : 0.15;
    });
    drawSpark(logSpark, activity, 1.2, '#c8bdb5');
  }

  if (firstFrame) {
    firstFrame = false;
    syncButtons();
    requestAnimationFrame(() => makeThumbnails());
  }
  requestAnimationFrame(loop);
}

function makeThumbnails() {
  project.stages.forEach((st, i) => {
    if (!st.available) return;
    const steps = project.steps.filter((s) => s.stage === st.n);
    const top = Math.max(...steps.map((s) => s.top));
    ui.setThumbnail(i, viewer.snapshot(st.end - 0.001, top));
  });
  document.body.dataset.ready = '1';
}

// test / automation hook
(window as unknown as { pagoda: unknown }).pagoda = { project, timeline, playback, viewer };

requestAnimationFrame(loop);
