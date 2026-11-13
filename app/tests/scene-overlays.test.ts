import { beforeAll, describe, expect, it } from 'vitest';
import { BufferGeometry, Color, Group, InstancedMesh, LineSegments, Material, Mesh, MeshBasicMaterial, BoxGeometry, PerspectiveCamera, ShaderMaterial, Vector2, Vector4, type Object3D } from 'three';
import { buildProject } from '../src/data/project';
import type { Project } from '../src/data/types';
import { Timeline, type CraneState } from '../src/engine/timeline';
import { CraneRig, mastExtent } from '../src/scene/crane';
import { CraneReach } from '../src/scene/reach';
import { disposeTree } from '../src/scene/dispose';
import { FlagLayer, IssueHighlight } from '../src/scene/highlight';
import { ALL_STAGES, CONTEXT_STAGE, drawGate, restFitDistance, Viewer, wheelZooms, type DrawnView } from '../src/scene/viewer';

const ink = new Color('#111111');
const colours = { ink, muted: new Color('#777777'), ok: new Color('#4d7f45'), warn: new Color('#b7791f'), over: new Color('#b3261e') };

/** Every geometry and material under root, each with a flag set when it is disposed. */
function watch(root: Object3D) {
  const disposed = new Set<BufferGeometry | Material>();
  const all = new Set<BufferGeometry | Material>();
  root.traverse((o) => {
    const m = o as Mesh;
    const items = [m.geometry, ...(Array.isArray(m.material) ? m.material : [m.material])].filter(Boolean) as (BufferGeometry | Material)[];
    for (const it of items) {
      if (all.has(it)) continue;
      all.add(it);
      it.addEventListener('dispose', () => disposed.add(it));
    }
  });
  return { all, disposed };
}

/** The highest y in the line geometry of the crane's mast or ties. */
function topY(rig: CraneRig, which: 'mast' | 'tie'): number {
  const geo = (rig as unknown as Record<string, Mesh>)[which].geometry;
  const pos = geo.getAttribute('position');
  let top = -Infinity;
  for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
  return top;
}

function craneState(mastTop: number, ties: number[]): CraneState {
  return { visible: true, headVisible: true, mastTop, ties, slew: 0, radius: 20, hookY: mastTop - 10, lifting: false, pick: null } as unknown as CraneState;
}

describe('scene resources are released on remount', () => {
  let p: Project;
  beforeAll(() => {
    p = buildProject();
  });

  it('disposes every geometry and material of the crane rig', () => {
    const rig = new CraneRig(p.crane!, ink, new Color('#ffffff'), new Color('#ff0000'), p.height);
    const { all, disposed } = watch(rig.group);
    expect(all.size).toBeGreaterThan(8);
    rig.dispose();
    expect(disposed.size).toBe(all.size);
  });

  it('disposes every geometry and material of the reach overlay', () => {
    const reach = new CraneReach(p.crane!, colours);
    const { all, disposed } = watch(reach.group);
    expect(all.size).toBeGreaterThan(8);
    reach.dispose();
    expect(disposed.size).toBe(all.size);
  });

  it('releases instanced meshes but keeps materials the viewer shares', () => {
    const shared = new ShaderMaterial();
    const own = new MeshBasicMaterial();
    const geo = new BoxGeometry(1, 1, 1);
    const fill = new InstancedMesh(geo, shared, 4);
    const ghost = new InstancedMesh(geo, shared, 4);
    ghost.instanceMatrix = fill.instanceMatrix;
    const g = new Group().add(fill, ghost, new Mesh(new BoxGeometry(), own));
    let instanced = 0, sharedGone = false, ownGone = false, geoGone = 0;
    for (const m of [fill, ghost]) m.addEventListener('dispose', () => instanced++);
    shared.addEventListener('dispose', () => (sharedGone = true));
    own.addEventListener('dispose', () => (ownGone = true));
    geo.addEventListener('dispose', () => geoGone++);
    disposeTree(g, new Set([shared]));
    expect(instanced).toBe(2);
    expect(geoGone).toBe(1);
    expect(ownGone).toBe(true);
    expect(sharedGone).toBe(false);
  });
});

describe('the crane mast is drawn up to wherever it climbs', () => {
  let p: Project;
  beforeAll(() => {
    p = buildProject();
  });

  it('sizes the lattice so a mast top or tie at the asked height is drawn', () => {
    for (const need of [0, 100, 156, 160, 172, 200, 333]) {
      expect(mastExtent(need)).toBeGreaterThanOrEqual(Math.max(160, need + 4));
      expect(mastExtent(need) % 4).toBe(0);
    }
  });

  it('builds the lattice and ties above 160 m for a tall tower', () => {
    const tall = { ...p.crane!, mastStart: 44 };
    const rig = new CraneRig(tall, ink, new Color('#ffffff'), new Color('#ff0000'), 186);
    expect(topY(rig, 'mast')).toBeGreaterThanOrEqual(186 + 30);
    // ties from +30 m every 32 m below the structure's height, as the timeline places them
    expect(topY(rig, 'tie')).toBeGreaterThanOrEqual(158);
    rig.update(craneState(204, [30, 62, 94, 126, 158, 190]));
    expect(topY(rig, 'mast')).toBeGreaterThanOrEqual(204);
    expect(topY(rig, 'tie')).toBeGreaterThanOrEqual(190);
  });

  it('grows the lattice when the climb goes past what was built', () => {
    const rig = new CraneRig(p.crane!, ink, new Color('#ffffff'), new Color('#ff0000'));
    const before = rig.builtTop;
    rig.update(craneState(before + 40, [30, 62]));
    expect(rig.builtTop).toBeGreaterThanOrEqual(before + 44);
    expect(topY(rig, 'mast')).toBeGreaterThanOrEqual(before + 40);
  });

  it('never leaves the head above the lattice over a whole build, however tall', () => {
    // the demo tower, and the same tower stretched to about 230 m (a climb well past the old 160 m lattice)
    const tall: Project = { ...p, height: p.height * 2, steps: p.steps.map((s) => ({ ...s, top: s.top * 2 })) };
    for (const [proj, hint] of [[p, p.height], [tall, tall.height], [tall, 0]] as const) {
      const tl = new Timeline(proj);
      const rig = new CraneRig(proj.crane!, ink, new Color('#ffffff'), new Color('#ff0000'), hint);
      let highest = 0, frames = 0;
      for (let t = 0; t <= proj.duration; t += proj.duration / 400) {
        const s = tl.stateAt(t).crane;
        rig.update(s);
        if (!s.visible) continue;
        frames++;
        highest = Math.max(highest, s.mastTop, ...s.ties);
        expect(topY(rig, 'mast')).toBeGreaterThanOrEqual(s.mastTop);
        for (const h of s.ties) expect(topY(rig, 'tie')).toBeGreaterThanOrEqual(h);
      }
      expect(frames).toBeGreaterThan(50);
      if (proj === tall) expect(highest).toBeGreaterThan(200);
    }
  });
});

describe('FLAGGED hatch follows Layers and the section', () => {
  it('shares the viewer uniforms and carries each part\'s stage', () => {
    const p = buildProject();
    const u = { uTime: { value: 0 }, uDpr: { value: 1 }, uMask: { value: ALL_STAGES }, uCut: { value: null }, uCutOn: { value: 0 } };
    const flags = new FlagLayer(u, new Color('#ff0000'));
    const mat = flags.mesh.material as ShaderMaterial;
    for (const k of ['uMask', 'uCut', 'uCutOn', 'uTime', 'uDpr'] as const) expect(mat.uniforms[k]).toBe(u[k]);
    expect(mat.vertexShader).toContain('stageOn(aStage)');
    expect(mat.fragmentShader).toContain('cutAway()');
    const parts = [0, Math.floor(p.parts.length / 2), p.parts.length - 1];
    flags.set(p, parts);
    const geo = flags.mesh.geometry;
    const stage = geo.getAttribute('aStage');
    expect(stage.count).toBe(geo.getAttribute('position').count);
    const seen = new Set<number>();
    for (let i = 0; i < stage.count; i++) seen.add(stage.getX(i));
    expect([...seen].sort()).toEqual([...new Set(parts.map((i) => p.parts[i].stage))].sort());
  });

  it('uses a full mask that covers every stage and the context', () => {
    expect(ALL_STAGES).toBe(511);
    expect(ALL_STAGES & (1 << (CONTEXT_STAGE - 1))).toBeTruthy();
  });
});

describe('the selected issue\'s x-ray follows Layers and the section', () => {
  it('reads the viewer\'s stage mask and section cut in every layer, with each part\'s stage', () => {
    const p = buildProject();
    const u = { uMask: { value: ALL_STAGES }, uCut: { value: null }, uCutOn: { value: 0 } };
    const hl = new IssueHighlight({ primary: new Color('#ff0000'), secondary: new Color('#0000ff'), line: new Color('#ff0000') }, u);
    // primary and secondary parts on different stages
    const byStage = new Map<number, number>();
    p.parts.forEach((x, i) => { if (!byStage.has(x.stage)) byStage.set(x.stage, i); });
    const stages = [...byStage.keys()].slice(0, 3);
    expect(stages.length).toBeGreaterThan(1);
    const [first, ...rest] = stages.map((s) => byStage.get(s)!);
    hl.set(p, { primary: [first], secondary: rest, lines: [] });
    const objs: (Mesh | LineSegments)[] = [];
    hl.group.traverse((o) => { if ((o as Mesh).isMesh || (o as LineSegments).isLineSegments) objs.push(o as Mesh); });
    expect(objs.length).toBe(6); // hidden faces, shown faces and edges, for each layer
    const seen = new Set<number>();
    for (const o of objs) {
      const mat = o.material as ShaderMaterial;
      expect(mat).toBeInstanceOf(ShaderMaterial);
      for (const k of ['uMask', 'uCut', 'uCutOn'] as const) expect(mat.uniforms[k]).toBe(u[k]);
      expect(mat.vertexShader).toContain('stageOn(aStage)');
      expect(mat.fragmentShader).toContain('cutAway()');
      const stage = o.geometry.getAttribute('aStage');
      expect(stage.count).toBe(o.geometry.getAttribute('position').count);
      for (let i = 0; i < stage.count; i++) seen.add(stage.getX(i));
    }
    expect([...seen].sort()).toEqual([...stages].sort());
    // turning a stage off in Layers reaches the x-ray through the shared uniform
    u.uMask.value = 0;
    for (const o of objs) expect((o.material as ShaderMaterial).uniforms.uMask.value).toBe(0);
    hl.clear();
  });
});

describe('the mouse wheel releases auto-framing only when it zooms', () => {
  it('follows the controls\' own zoom guard', () => {
    expect(wheelZooms({ enabled: true, enableZoom: true, state: -1 })).toBe(true);
    expect(wheelZooms({ enabled: true, enableZoom: true })).toBe(true);
    expect(wheelZooms({ enabled: false, enableZoom: true, state: -1 })).toBe(false);
    expect(wheelZooms({ enabled: true, enableZoom: false, state: -1 })).toBe(false);
    expect(wheelZooms({ enabled: true, enableZoom: true, state: 0 })).toBe(false);
  });
});

describe('the idle-render gate draws only when something changed', () => {
  const view = (o: Partial<DrawnView> = {}): DrawnView => ({ pos: { x: 0, y: 10, z: 90 }, target: { x: 0, y: 6, z: 0 }, fov: 26, w: 1280, h: 720, ax: 0.57, ay: 0.5, ...o });
  /** Run frames: returns how many were drawn and the dirty count left. */
  function run(frames: DrawnView[], dirty: number, distance = 90) {
    let last = view({ pos: { x: Infinity, y: 0, z: 0 } });
    let drawn = 0;
    for (const now of frames) {
      const g = drawGate(last, now, dirty, distance);
      dirty = g.dirty;
      if (g.draw) {
        drawn++;
        last = { ...now, pos: { ...now.pos }, target: { ...now.target } };
      }
    }
    return { drawn, dirty, last };
  }

  it('draws the frames an invalidate owes, then stops while the camera is still', () => {
    // the first frame draws because nothing was drawn yet; then invalidate's two frames
    const still = Array.from({ length: 10 }, () => view());
    const first = run(still, 0);
    expect(first.drawn).toBe(1);
    expect(first.dirty).toBe(0);
    let last = first.last;
    let dirty = 2; // invalidate()
    let drawn = 0;
    for (let k = 0; k < 10; k++) {
      const g = drawGate(last, view(), dirty, 90);
      dirty = g.dirty;
      if (g.draw) drawn++;
      expect(g.moved).toBe(false);
    }
    expect(drawn).toBe(2);
    expect(dirty).toBe(0);
    last = view();
    expect(drawGate(last, view(), 0, 90)).toEqual({ draw: false, moved: false, dirty: 0 });
  });

  it('lets a drift below the tolerance build up until it is worth a frame', () => {
    const tol = Math.max(1e-4, 90 * 1e-5); // 0.0009 m at 90 m
    const step = tol / 3.5;
    const last = view();
    let z = 90;
    let frames = 0;
    let drew = false;
    while (!drew && frames < 20) {
      z += step;
      frames++;
      drew = drawGate(last, view({ pos: { x: 0, y: 10, z } }), 0, 90).draw;
    }
    expect(drew).toBe(true);
    expect(frames).toBe(4); // three steps stay under the tolerance (no frame), the fourth passes it
  });

  it('draws on a resize or a change of aim, however still the camera is', () => {
    const last = view();
    expect(drawGate(last, view({ w: 1281 }), 0, 90).draw).toBe(true);
    expect(drawGate(last, view({ h: 700 }), 0, 90).draw).toBe(true);
    expect(drawGate(last, view({ ax: 0.5 }), 0, 90).draw).toBe(true);
    expect(drawGate(last, view({ ay: 0.45 }), 0, 90).draw).toBe(true);
    expect(drawGate(last, view({ fov: 30 }), 0, 90).draw).toBe(true);
    expect(drawGate(last, view({ target: { x: 0, y: 7, z: 0 } }), 0, 90).draw).toBe(true);
  });
});

describe('the default framing fits the model into the rest box', () => {
  it('backs off by the box\'s share of the viewport', () => {
    const aspect = 16 / 9;
    const whole = restFitDistance(40, 30, aspect, { x0: 0, y0: 0, x1: 1, y1: 1 });
    const half = restFitDistance(40, 30, aspect, { x0: 0.4, y0: 0, x1: 0.9, y1: 1 });
    expect(half).toBeGreaterThan(whole * 1.2);
    // without a box the usual framing, with its headroom for the toolbar and transport
    expect(restFitDistance(40, 30, aspect, null)).toBeGreaterThan(0);
  });

  it('aims at the box centre and redraws when the box changes', () => {
    const v = Object.create(Viewer.prototype) as Viewer;
    const inner = v as unknown as { restBox: unknown; dirty: number; size: { w: number; h: number }; restAim(): { x: number; y: number } };
    inner.restBox = null;
    inner.dirty = 0;
    inner.size = { w: 1440, h: 900 };
    const aim = () => inner.restAim();
    expect(aim()).toEqual({ x: 0.57, y: 0.5 });
    v.setRestBox({ x0: 0.3, y0: 0.1, x1: 0.9, y1: 0.7 });
    expect(inner.dirty).toBe(2);
    expect(aim().x).toBeCloseTo(0.6, 9);
    expect(aim().y).toBeCloseTo(0.4, 9);
    // the same box again owes no frame; a sliver or nonsense goes back to the usual spot
    inner.dirty = 0;
    v.setRestBox({ x0: 0.3, y0: 0.1, x1: 0.9, y1: 0.7 });
    expect(inner.dirty).toBe(0);
    v.setRestBox({ x0: 0.5, y0: 0.1, x1: 0.52, y1: 0.7 });
    expect(v.currentRestBox).toBeNull();
    expect(aim()).toEqual({ x: 0.57, y: 0.5 });
    v.setRestBox({ x0: NaN, y0: 0, x1: 1, y1: 1 });
    expect(v.currentRestBox).toBeNull();
  });
});

describe('an off-screen still puts the live view back', () => {
  /** A viewer with stub renderer and layers: renderStill touches no WebGL until the renderer does. */
  function stubViewer(render: () => void) {
    const v = Object.create(Viewer.prototype) as Record<string, unknown>;
    const uniforms = {
      uTime: { value: 12.5 },
      uWash: { value: new Vector2(3, 4) },
      uCut: { value: new Vector4(1, 0, 0, 7) },
      uCutOn: { value: 1 },
      uDpr: { value: 1.5 },
      uHold: { value: 0.6 },
      uMask: { value: 0b101 },
    };
    const sets: unknown[] = [];
    const live = { primary: [1], secondary: [], lines: [] };
    v.fillMat = { uniforms };
    v.crane = { group: { visible: true } };
    v.reach = { group: { visible: true } };
    v.highlight = { group: { visible: true }, set: (_p: unknown, spec: unknown) => sets.push(spec), setResolution: () => {} };
    v.flags = { mesh: { visible: true } };
    v.current = {};
    v.issueSpec = live;
    v.size = { w: 800, h: 500 };
    v.dirty = 0;
    v.renderer = { setRenderTarget: () => {}, clear: () => {}, render, readRenderTargetPixels: () => {} };
    const state = () => ({
      t: uniforms.uTime.value,
      wash: uniforms.uWash.value.toArray(),
      cut: uniforms.uCut.value.toArray(),
      on: uniforms.uCutOn.value,
      dpr: uniforms.uDpr.value,
      hold: uniforms.uHold.value,
      mask: uniforms.uMask.value,
      crane: (v.crane as { group: { visible: boolean } }).group.visible,
      reach: (v.reach as { group: { visible: boolean } }).group.visible,
      hl: (v.highlight as { group: { visible: boolean } }).group.visible,
      fl: (v.flags as { mesh: { visible: boolean } }).mesh.visible,
    });
    const still = (opts: Record<string, unknown>) => (v as unknown as { renderStill(cam: PerspectiveCamera, t: number, w: number, h: number, o: unknown): unknown }).renderStill(new PerspectiveCamera(), 40, 8, 6, opts);
    return { v, uniforms, sets, live, state, still };
  }

  it('restores every uniform, the crane, the reach and the selected issue even when rendering throws', () => {
    let seen: unknown = null;
    const s = stubViewer(() => {
      seen = s.state();
      throw new Error('context lost');
    });
    const before = s.state();
    const other = { primary: [2], secondary: [3], lines: [] };
    expect(() => s.still({ overlays: true, issue: other, cut: { on: true, normal: [0, 0, 1], d: 2 }, wash: [5, 6] })).toThrow('context lost');
    // while rendering, the still's own state was in force
    expect(seen).toMatchObject({ t: 40, mask: ALL_STAGES, hold: 0, crane: false, reach: false, hl: true, wash: [5, 6], on: 1, cut: [0, 0, 1, 2] });
    expect(s.state()).toEqual(before);
    expect(s.sets).toEqual([other, s.live]); // borrowed the highlight, then gave the selected issue back
  });

  it('restores them after a still that renders', () => {
    const g = globalThis as unknown as { document?: unknown };
    const had = 'document' in g;
    const prevDoc = g.document;
    g.document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => {} }) }),
    };
    try {
      const s = stubViewer(() => {});
      const before = s.state();
      s.still({ overlays: false });
      expect(s.state()).toEqual(before);
      expect(s.sets).toEqual([]); // no issue given: the highlight was not borrowed
    } finally {
      if (had) g.document = prevDoc;
      else delete g.document;
    }
  });
});

// ── level datums, the H box and the member callouts give way (O5, R37, R39, R40, R46, R48–R50, R19) ──
import { readFileSync as readSrc } from 'node:fs';
import { fileURLToPath as srcPath } from 'node:url';
import { CHROME_TTL, datumOpacity, DATUM_GAP, heightBoxAt, planLike, PLAN_ELEVATION } from '../src/ui/overlays';

const OVERLAYS = readSrc(srcPath(new URL('../src/ui/overlays.ts', import.meta.url)), 'utf8');
const MAIN_SRC = readSrc(srcPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
/** A datum's row at screen height y, as overlays.ts draws it at ladder x 1124. */
const row = (y: number, op = 1) => ({ box: { x0: 1050, y0: y - 9, x1: 1198, y1: y + 8 }, op });

describe('the level datum ladder', () => {
  it('shows nothing in the crane plan or any view from nearly straight above', () => {
    expect(planLike('emph', 10)).toBe(true);
    expect(planLike('normal', PLAN_ELEVATION + 1)).toBe(true);
    expect(planLike('normal', 24)).toBe(false);
    expect(datumOpacity([row(300), row(400)], { plan: true, blocked: [], issue: null })).toEqual([0, 0]);
  });

  it('drops datums closer together than a label, from the top down, rather than piling them into one band', () => {
    // a far-off tower: TOP, ROOF and L24 within 14 px, then L13 and GL
    const ops = datumOpacity([row(470), row(476), row(484), row(500), row(560)], { plan: false, blocked: [], issue: null });
    expect(ops).toEqual([1, 0, 0, 1, 1]);
    expect(DATUM_GAP).toBeGreaterThanOrEqual(14);
  });

  it('leaves out a datum under the title block, the caption or a drawer, and keeps the rest', () => {
    const titleBlock = { x0: 943, y0: 8, x1: 1219, y1: 321 };
    expect(datumOpacity([row(230), row(318), row(340), row(510, 0.28)], { plan: false, blocked: [titleBlock], issue: null })).toEqual([0, 0, 1, 0.28]);
  });

  it('fades a datum across the selected issue, so the subject reads first', () => {
    const issue = { x0: 1100, y0: 420, x1: 1300, y1: 520 };
    const ops = datumOpacity([row(360), row(470)], { plan: false, blocked: [], issue });
    expect(ops[0]).toBe(1);
    expect(ops[1]).toBeGreaterThan(0);
    expect(ops[1]).toBeLessThanOrEqual(0.12);
  });

  it('puts the H box below a card it would sit under, and hides it when that leaves it on the top datum', () => {
    const titleBlock = { x0: 943, y0: 8, x1: 1219, y1: 321 };
    expect(heightBoxAt({ x: 1072, y: 290 }, { w: 96, h: 18 }, 360, [titleBlock], 900)).toEqual({ x: 1072, y: 323 });
    expect(heightBoxAt({ x: 1072, y: 290 }, { w: 96, h: 18 }, 330, [titleBlock], 900)).toBeNull();
    expect(heightBoxAt({ x: 1072, y: 120 }, { w: 96, h: 18 }, 160, [], 900)).toEqual({ x: 1072, y: 120 });
  });

  it('places its labels against the cards as they are now: measured by the clock, and again at once when one changes (R19)', () => {
    expect(CHROME_TTL).toBeLessThanOrEqual(250);
    expect(OVERLAYS).not.toMatch(/frameNo - this\.controlsFrame/);
    expect(OVERLAYS).toMatch(/now - this\.controlsAt < CHROME_TTL/);
    expect(MAIN_SRC).toMatch(/function chromeMoved\(\) \{\s*overlays\?\.chromeChanged\(\);/);
    for (const fn of ['drawDrawer', 'hideOverBanner', 'meetOverPick', 'applyMode']) {
      const body = MAIN_SRC.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`))?.[0] ?? '';
      expect(body, fn).toMatch(/chromeMoved\(\)/);
    }
    expect(MAIN_SRC).toMatch(/const measure = \(\) => \{[\s\S]*?chromeMoved\(\);\s*\};/);
  });
});

describe('the member callouts', () => {
  it('step aside in a plan and while an issue is explained', () => {
    expect(OVERLAYS).toMatch(/this\.updateCallouts\(state, w, h, plan \|\| !!this\.issueBox\)/);
    expect(OVERLAYS).toMatch(/const recent = quiet \? \[\] :/);
    expect(MAIN_SRC).toMatch(/overlays\.issueBox = issuesUI\?\.selected\?\.box \?\? null;/);
  });

  it('start below an open drawer on the left and below the title block on the right', () => {
    expect(OVERLAYS).toMatch(/l: Math\.max\(capY, bottom\('drawer'\)\), r: Math\.max\(capY, bottom\('titleBlock'\)\)/);
  });
});
