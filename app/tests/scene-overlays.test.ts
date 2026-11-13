import { beforeAll, describe, expect, it } from 'vitest';
import { BufferGeometry, Color, Group, InstancedMesh, Material, Mesh, MeshBasicMaterial, BoxGeometry, ShaderMaterial, type Object3D } from 'three';
import { buildProject } from '../src/data/project';
import type { Project } from '../src/data/types';
import { Timeline, type CraneState } from '../src/engine/timeline';
import { CraneRig, mastExtent } from '../src/scene/crane';
import { CraneReach } from '../src/scene/reach';
import { disposeTree } from '../src/scene/dispose';
import { FlagLayer } from '../src/scene/highlight';
import { ALL_STAGES, CONTEXT_STAGE, wheelZooms } from '../src/scene/viewer';

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

describe('the mouse wheel releases auto-framing only when it zooms', () => {
  it('follows the controls\' own zoom guard', () => {
    expect(wheelZooms({ enabled: true, enableZoom: true, state: -1 })).toBe(true);
    expect(wheelZooms({ enabled: true, enableZoom: true })).toBe(true);
    expect(wheelZooms({ enabled: false, enableZoom: true, state: -1 })).toBe(false);
    expect(wheelZooms({ enabled: true, enableZoom: false, state: -1 })).toBe(false);
    expect(wheelZooms({ enabled: true, enableZoom: true, state: 0 })).toBe(false);
  });
});
