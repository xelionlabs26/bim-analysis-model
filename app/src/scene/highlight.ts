/**
 * Issue overlays drawn over the model:
 * - the selected issue's elements in x-ray: parts at fault red, what they
 *   conflict with blue, visible faces strong and hidden ones faint, so a beam
 *   buried in a wall still reads; like the model, the x-ray hides on stages
 *   Layers turns off and beyond the section cut;
 * - its measurement lines (open edges, clearances, lift paths) as thick lines;
 * - FLAGGED parts with a hatch that appears once each part is placed.
 */
import { BufferGeometry, Color, DoubleSide, EdgesGeometry, Float32BufferAttribute, Group, LineSegments, Mesh, ShaderMaterial, Vector2, type IUniform } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Project, Vec3 } from '../data/types';
import { disposeTree } from './dispose';
import { cutAwayGlsl, stageOnGlsl } from './shaders';

const BOX_TRIS = [0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5];

/** Triangles of the given parts as one flat position list (app coordinates), with each vertex's part. */
export function partTriangles(p: Project, parts: number[], cap = 8000): { pos: number[]; part: number[] } {
  const pos: number[] = [];
  const part: number[] = [];
  for (const i of parts.slice(0, cap)) {
    const pt = p.parts[i];
    if (pt.mesh !== undefined) {
      const m = p.meshes[pt.mesh];
      for (const k of m.indices) {
        pos.push(m.positions[k * 3], m.positions[k * 3 + 1], m.positions[k * 3 + 2]);
        part.push(i);
      }
      continue;
    }
    const [x, y, z, w] = pt.quat;
    const ax = [
      [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
      [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
      [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
    ];
    const h = [pt.size[0] / 2, pt.size[1] / 2, pt.size[2] / 2];
    const corner = (c: number) => {
      const s = [c & 1 ? 1 : -1, c & 2 ? 1 : -1, c & 4 ? 1 : -1];
      return [0, 1, 2].map((k) => pt.pos[k] + s[0] * h[0] * ax[0][k] + s[1] * h[1] * ax[1][k] + s[2] * h[2] * ax[2][k]);
    };
    const cs = Array.from({ length: 8 }, (_, c) => corner(c));
    for (const c of BOX_TRIS) {
      pos.push(cs[c][0], cs[c][1], cs[c][2]);
      part.push(i);
    }
  }
  return { pos, part };
}

// The x-ray shows a part only where the model does: on a stage left on in Layers, and not cut away by the section.
const xrayVertex = /* glsl */ `
  attribute float aStage;
  uniform float uMask;
  varying float vOn;
  varying vec3 vWorld;
  ${stageOnGlsl}
  void main() {
    vOn = stageOn(aStage);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = vOn > 0.5 ? projectionMatrix * viewMatrix * wp : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;
const xrayFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform vec4 uCut;
  uniform float uCutOn;
  varying float vOn;
  varying vec3 vWorld;
  ${cutAwayGlsl}
  void main() {
    if (vOn < 0.5 || cutAway()) discard;
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

/** The viewer's own uniforms the x-ray follows: the stage mask (Layers) and the section cut. */
export interface XrayUniforms {
  uMask: IUniform;
  uCut: IUniform;
  uCutOn: IUniform;
}

/** An x-ray material: flat colour at `opacity`, hidden on stages Layers turns off and beyond the section cut. */
export function xrayMaterial(uniforms: XrayUniforms, color: Color, opacity: number, opts: { depthTest?: boolean; polygonOffset?: boolean } = {}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uMask: uniforms.uMask, uCut: uniforms.uCut, uCutOn: uniforms.uCutOn, uColor: { value: color.clone() }, uOpacity: { value: opacity } },
    vertexShader: xrayVertex,
    fragmentShader: xrayFragment,
    transparent: true,
    depthWrite: false,
    depthTest: opts.depthTest ?? true,
    side: DoubleSide,
    ...(opts.polygonOffset ? { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } : {}),
  });
}

function xrayLayer(p: Project, parts: number[], color: Color, order: number, uniforms: XrayUniforms): Group {
  const g = new Group();
  if (!parts.length) return g;
  const { pos, part } = partTriangles(p, parts);
  const stageOf = part.map((i) => p.parts[i].stage);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aStage', new Float32BufferAttribute(stageOf, 1));
  const hidden = new Mesh(geo, xrayMaterial(uniforms, color, 0.16, { depthTest: false }));
  hidden.renderOrder = order;
  const shown = new Mesh(geo, xrayMaterial(uniforms, color, 0.5, { polygonOffset: true }));
  shown.renderOrder = order + 1;
  // edges per stage, so each carries its stage and hides with it
  const epos: number[] = [];
  const estage: number[] = [];
  for (const st of [...new Set(stageOf)]) {
    const sub: number[] = [];
    for (let v = 0; v < stageOf.length; v += 3) if (stageOf[v] === st) sub.push(...pos.slice(v * 3, v * 3 + 9));
    const sg = new BufferGeometry();
    sg.setAttribute('position', new Float32BufferAttribute(sub, 3));
    const eg = new EdgesGeometry(sg, 25);
    const ep = eg.getAttribute('position');
    for (let k = 0; k < ep.count; k++) {
      epos.push(ep.getX(k), ep.getY(k), ep.getZ(k));
      estage.push(st);
    }
    sg.dispose();
    eg.dispose();
  }
  const egeo = new BufferGeometry();
  egeo.setAttribute('position', new Float32BufferAttribute(epos, 3));
  egeo.setAttribute('aStage', new Float32BufferAttribute(estage, 1));
  const edges = new LineSegments(egeo, xrayMaterial(uniforms, color, 0.95, { depthTest: false }));
  edges.renderOrder = order + 2;
  for (const o of [hidden, shown, edges]) o.frustumCulled = false;
  g.add(hidden, shown, edges);
  return g;
}

export class IssueHighlight {
  readonly group = new Group();
  private lineMats: LineMaterial[] = [];
  private res = new Vector2(1, 1);

  /** `uniforms` are the viewer's own, so the x-ray follows its stage mask and section cut. */
  constructor(
    private colours: { primary: Color; secondary: Color; line: Color },
    private uniforms: XrayUniforms,
  ) {
    this.group.renderOrder = 20;
  }

  setResolution(w: number, h: number) {
    this.res.set(w, h);
    for (const m of this.lineMats) m.resolution.copy(this.res);
  }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeTree(child);
    }
    this.lineMats = [];
  }

  set(p: Project, spec: { primary: number[]; secondary: number[]; lines: [Vec3, Vec3][] } | null) {
    this.clear();
    if (!spec) return;
    const secondary = spec.secondary.filter((i) => !spec.primary.includes(i));
    this.group.add(xrayLayer(p, secondary, this.colours.secondary, 30, this.uniforms), xrayLayer(p, spec.primary, this.colours.primary, 34, this.uniforms));
    if (spec.lines.length) {
      const flat: number[] = [];
      for (const [a, b] of spec.lines.slice(0, 20000)) flat.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      const geo = new LineSegmentsGeometry();
      geo.setPositions(flat);
      const mat = new LineMaterial({ color: this.colours.line.getHex(), linewidth: 3.5, depthTest: false, transparent: true, opacity: 0.95 });
      mat.resolution.copy(this.res);
      this.lineMats.push(mat);
      const lines = new LineSegments2(geo, mat);
      lines.renderOrder = 40;
      lines.computeLineDistances();
      this.group.add(lines);
    }
  }
}

// A flag shows only where its part does: placed, on a stage left on in Layers, and not cut away by the section.
const flagVertex = /* glsl */ `
  attribute float aT;
  attribute float aStage;
  uniform float uTime;
  uniform float uMask;
  varying float vOn;
  varying vec3 vWorld;
  ${stageOnGlsl}
  void main() {
    vOn = step(aT, uTime) * stageOn(aStage);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = vOn > 0.5 ? projectionMatrix * viewMatrix * wp : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;
const flagFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uDpr;
  uniform vec4 uCut;
  uniform float uCutOn;
  varying float vOn;
  varying vec3 vWorld;
  ${cutAwayGlsl}
  void main() {
    if (vOn < 0.5 || cutAway()) discard;
    // diagonal hatch in screen space: the drawing-sheet convention for a flagged element
    float s = mod((gl_FragCoord.x - gl_FragCoord.y) / max(uDpr, 1.0), 9.0);
    if (s > 3.0) discard;
    gl_FragColor = vec4(uColor, 0.9);
  }
`;

export interface FlagUniforms {
  uTime: IUniform;
  uDpr: IUniform;
  uMask: IUniform;
  uCut: IUniform;
  uCutOn: IUniform;
}

/** FLAGGED: a hatch over the parts of open critical and major issues, shown once each is placed. */
export class FlagLayer {
  readonly mesh: Mesh;
  private geo = new BufferGeometry();

  /** The uniforms are the viewer's own objects, so the flags follow its time, stage mask and section cut. */
  constructor(uniforms: FlagUniforms, color: Color) {
    const mat = new ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uDpr: uniforms.uDpr, uMask: uniforms.uMask, uCut: uniforms.uCut, uCutOn: uniforms.uCutOn, uColor: { value: color } },
      vertexShader: flagVertex,
      fragmentShader: flagFragment,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.renderOrder = 12;
    this.mesh.frustumCulled = false;
  }

  set(p: Project, parts: number[]) {
    const { pos, part } = partTriangles(p, parts, 4000);
    const t = part.map((i) => p.parts[i].t0 + p.parts[i].dur);
    const stage = part.map((i) => p.parts[i].stage);
    this.geo.dispose();
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('aT', new Float32BufferAttribute(t, 1));
    this.geo.setAttribute('aStage', new Float32BufferAttribute(stage, 1));
    this.mesh.geometry = this.geo;
  }
}
