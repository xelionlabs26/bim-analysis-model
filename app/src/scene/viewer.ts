import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  FloatType,
  Group,
  LineSegments,
  NearestFilter,
  RGBAFormat,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MATERIAL_INFO, type Motion, type Project, type Vec3 } from '../data/types';
import { ACTIVE_HOLD } from '../data/assemble';
import type { CraneState } from '../engine/timeline';
import { PASS_OF, type CameraPose, type CutState } from '../engine/presentation';
import { CraneRig } from './crane';
import { CraneReach, type ReachMode } from './reach';
import { FlagLayer, IssueHighlight } from './highlight';
import { disposeTree } from './dispose';
import type { IssueView } from '../checks/view';
import { fillFragment, fillVertex, ghostFragment, ghostVertex, groundFragment, groundVertex, meshFillFragment, meshFillVertex, meshLineFragment, meshLineVertex } from './shaders';

export type RenderStyle = 'ink' | 'ink+paint' | 'paint';

/** An issue as drawn on the model: x-ray parts and measurement lines. */
export interface IssueSpec {
  primary: number[];
  secondary: number[];
  lines: [Vec3, Vec3][];
}

export interface CameraReadout {
  az: number;
  el: number;
  mm: number;
  distance: number;
  pxPerMetre: number;
}

/** South is +Z; azimuth is measured from south towards east. */
export const VIEW_PRESETS = [
  { name: 'ISO', az: 28, el: 16 },
  { name: 'SOUTH ELEV', az: 0, el: 3 },
  { name: 'EAST ELEV', az: 90, el: 3 },
  { name: 'STREET', az: 334, el: 5 },
  { name: 'PLAN', az: 0, el: 86 },
];

export const CONTEXT_STAGE = 9;
/** Stage mask with every stage and the context on. */
export const ALL_STAGES = (1 << CONTEXT_STAGE) - 1;
const FOV = 26; // ≈ 52 mm on 24 mm film height
const MODE: Record<Motion, number> = { lower: 0, pour: 1, bore: 2 };
/**
 * Whether a wheel over the viewport zooms: OrbitControls ignores it while the
 * controls are off, zoom is off or a drag is in progress (state -1 is idle).
 */
export function wheelZooms(c: { enabled: boolean; enableZoom: boolean; state?: number }): boolean {
  return c.enabled && c.enableZoom && (c.state ?? -1) === -1;
}

const css = (name: string) => new Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000');

export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 1, 2400);
  readonly controls: OrbitControls;
  /** The tower crane and its reach on the ground; null on a project lifted by mobile crane and by hand. */
  crane: CraneRig | null = null;
  reach: CraneReach | null = null;
  /** Utilisation from which the reach ring turns amber (the checks' review threshold). */
  reachWarnAt = 0.85;
  reachRigKg = 0;
  /** How the reach overlay shows: emphasised for the crane plan, hidden while another subject is being explained. */
  private reachMode: ReachMode = 'normal';
  private model = new Group();
  private fillMat: ShaderMaterial;
  private ghostMat: ShaderMaterial;
  private meshFillMat: ShaderMaterial;
  private meshLineMat: ShaderMaterial;
  private meshGhostMat: ShaderMaterial;
  private groundMat: ShaderMaterial;
  private partTex: DataTexture | null = null;
  private uniforms: Record<string, { value: unknown }>;
  private target = new Vector3(0, 6, 0);
  private distance = 90;
  private maxTop = 10;
  private footprint = 17;
  autoFrame = true;
  pathActive = false;
  private resolution = 1.5;
  private size = { w: 1, h: 1 };
  private highlight!: IssueHighlight;
  private flags!: FlagLayer;
  private current!: Project;
  /** The selected issue's drawing; a BCF still may borrow the highlight and puts this back. */
  private issueSpec: IssueSpec | null = null;
  /** Frames still to draw although nothing moves (a setting or the scene changed). */
  private dirty = 2;
  /** Whether the camera moved on the last frame (orbit damping, auto-rotate, easing). */
  private moving = true;
  private lastCam = { pos: new Vector3(Infinity, 0, 0), target: new Vector3(), fov: 0, w: 0, h: 0, ax: 0, ay: 0 };
  /** Where the orbit target sits on screen, as shares of the viewport's width and height. */
  private aim = { x: 0.5, y: 0.5 };
  /** Where a framed pose wants it (clear of the cards over the viewport); null for the usual spot. */
  private aimWanted: { x: number; y: number } | null = null;

  /** `project` may come later through setProject (a page opened on a sample loads it first). */
  constructor(private host: HTMLElement, project?: Project) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'gl';
    host.prepend(this.renderer.domElement);
    if (project) this.maxTop = project.height;

    const uniforms = {
      uTime: { value: 0 },
      uMask: { value: ALL_STAGES },
      uHold: { value: ACTIVE_HOLD },
      uPaper: { value: css('--part') },
      uContextFill: { value: css('--context') },
      uInkColor: { value: css('--ink') },
      uActiveFill: { value: css('--active-fill') },
      uActiveInk: { value: css('--brand') },
      uGhostColor: { value: css('--ghost') },
      uInk: { value: 1 },
      uShade: { value: 1 },
      uColour: { value: 0 },
      uGhost: { value: 1 },
      uWetColor: { value: css('--wet') },
      uPoche: { value: css('--poche') },
      uWash: { value: new Vector2(-1e4, -1e4) },
      uCut: { value: new Vector4(1, 0, 0, 1e4) },
      uCutOn: { value: 0 },
      uDpr: { value: 1.5 },
      uParts: { value: null as DataTexture | null },
      uGhostLines: { value: 0 },
    };
    this.uniforms = uniforms;
    // double-sided so that parts opened by the section plane show their (hatched) inside faces
    this.fillMat = new ShaderMaterial({ uniforms, vertexShader: fillVertex, fragmentShader: fillFragment, side: DoubleSide });
    this.ghostMat = new ShaderMaterial({ uniforms, vertexShader: ghostVertex, fragmentShader: ghostFragment, transparent: true, depthWrite: false });
    this.meshFillMat = new ShaderMaterial({ uniforms, vertexShader: meshFillVertex, fragmentShader: meshFillFragment, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.meshLineMat = new ShaderMaterial({ uniforms, vertexShader: meshLineVertex, fragmentShader: meshLineFragment });
    this.meshGhostMat = new ShaderMaterial({ uniforms: { ...uniforms, uGhostLines: { value: 1 } }, vertexShader: meshLineVertex, fragmentShader: meshLineFragment, transparent: true, depthWrite: false });
    this.groundMat = new ShaderMaterial({
      uniforms: { uLine: { value: css('--ghost') }, uFade: { value: new Vector2(32, 78) } },
      vertexShader: groundVertex,
      fragmentShader: groundFragment,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.highlight = new IssueHighlight({ primary: css('--bad'), secondary: css('--issue-b'), line: css('--bad') });
    this.flags = new FlagLayer({ uTime: uniforms.uTime, uDpr: uniforms.uDpr, uMask: uniforms.uMask, uCut: uniforms.uCut, uCutOn: uniforms.uCutOn }, css('--bad'));
    const ground = new Mesh(new PlaneGeometry(400, 400).rotateX(-Math.PI / 2), this.groundMat);
    ground.position.y = -0.005;
    ground.renderOrder = 1;
    this.scene.add(ground, this.model, this.flags.mesh, this.highlight.group);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.8; // ≈ 5°/s
    this.controls.minPolarAngle = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.01;
    this.controls.maxDistance = 900;
    // a wheel zoom hands the camera to the viewer, but only when the controls actually zoom
    this.renderer.domElement.addEventListener('wheel', () => {
      if (wheelZooms(this.controls as OrbitControls & { state?: number })) this.autoFrame = false;
    }, { passive: true });
    // grabbing the view during the fly-through hands the camera to the viewer
    this.controls.addEventListener('start', () => {
      if (this.pathActive) this.autoFrame = false;
      this.invalidate();
    });
    // a drag or zoom moves the camera between frames: draw again
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('end', () => this.invalidate());
    this.setView(VIEW_PRESETS[0].az, VIEW_PRESETS[0].el);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    if (project) this.setProject(project);
  }

  /** Draw the next frames even if the camera is still: the scene or a setting changed. */
  invalidate() {
    this.dirty = 2;
  }

  /**
   * Nothing to draw: no setting changed since the last frames and the camera
   * stopped moving. The caller can then skip the frame altogether until the
   * sequence time changes or something calls invalidate().
   */
  get idle() {
    return this.dirty === 0 && !this.moving;
  }

  /** Replace the model: instanced boxes (generated parts), merged mesh (imported parts), context, crane. */
  setProject(project: Project) {
    this.current = project;
    this.issueSpec = null;
    this.invalidate();
    this.highlight?.set(project, null);
    this.flags?.set(project, []);
    // the viewer's materials are reused by the next model; everything else goes
    const shared = new Set([this.fillMat, this.ghostMat, this.meshFillMat, this.meshLineMat, this.meshGhostMat]);
    for (const child of [...this.model.children]) {
      this.model.remove(child);
      disposeTree(child, shared);
    }
    this.partTex?.dispose();
    this.partTex = null;
    this.maxTop = project.height;

    // ── instanced boxes ──
    const boxes = project.parts.map((p, i) => ({ p, i })).filter(({ p }) => p.mesh === undefined);
    const n = boxes.length + project.context.length;
    if (n) {
      const geo = new BoxGeometry(1, 1, 1);
      const time = new Float32Array(n * 3);
      const color = new Float32Array(n * 3);
      const stage = new Float32Array(n);
      const mode = new Float32Array(n);
      const pass = new Float32Array(n);
      const m = new Matrix4();
      const q = new Quaternion();
      const v = new Vector3();
      const s = new Vector3();
      const c = new Color();
      const fill = new InstancedMesh(geo, this.fillMat, n);
      boxes.forEach(({ p }, i) => {
        m.compose(v.set(...p.pos), q.set(...p.quat), s.set(...p.size));
        fill.setMatrixAt(i, m);
        time.set([p.t0, p.dur, p.drop], i * 3);
        c.set(MATERIAL_INFO[p.mat].colour);
        color.set([c.r, c.g, c.b], i * 3);
        stage[i] = p.stage;
        mode[i] = MODE[p.motion];
        pass[i] = PASS_OF[p.mat];
      });
      project.context.forEach((p, k) => {
        const i = boxes.length + k;
        m.compose(v.set(...p.pos), q.set(...p.quat), s.set(...p.size));
        fill.setMatrixAt(i, m);
        time.set([-100, 0.001, 0], i * 3);
        c.set(MATERIAL_INFO.context.colour);
        color.set([c.r, c.g, c.b], i * 3);
        stage[i] = CONTEXT_STAGE;
        mode[i] = 3;
      });
      geo.setAttribute('aTime', new InstancedBufferAttribute(time, 3));
      geo.setAttribute('aColor', new InstancedBufferAttribute(color, 3));
      geo.setAttribute('aStage', new InstancedBufferAttribute(stage, 1));
      geo.setAttribute('aMode', new InstancedBufferAttribute(mode, 1));
      geo.setAttribute('aPass', new InstancedBufferAttribute(pass, 1));
      fill.instanceMatrix.needsUpdate = true;
      const ghost = new InstancedMesh(geo, this.ghostMat, n);
      ghost.instanceMatrix = fill.instanceMatrix;
      for (const mesh of [fill, ghost]) mesh.frustumCulled = false;
      ghost.renderOrder = 2;
      this.model.add(fill, ghost);
    }

    // ── merged meshes ──
    const meshParts = project.parts.map((p, i) => ({ p, i })).filter(({ p }) => p.mesh !== undefined);
    const ctxMeshes = project.contextMeshes;
    if (meshParts.length || ctxMeshes.length) {
      const entries = [...meshParts.map(({ p }) => ({ p, mesh: project.meshes[p.mesh!] })), ...ctxMeshes.map((mesh) => ({ p: null as typeof project.parts[number] | null, mesh }))];
      const count = entries.length;
      const rows = Math.ceil((count * 3) / 1024);
      const data = new Float32Array(1024 * Math.max(1, rows) * 4);
      const c = new Color();
      let nv = 0, ni = 0, ne = 0;
      for (const { mesh } of entries) {
        nv += mesh.positions.length / 3;
        ni += mesh.indices.length;
        ne += mesh.edges.length / 3;
      }
      const pos = new Float32Array(nv * 3);
      const part = new Float32Array(nv);
      const idx = new Uint32Array(ni);
      const epos = new Float32Array(ne * 3);
      const epart = new Float32Array(ne);
      let vo = 0, io = 0, eo = 0;
      entries.forEach(({ p, mesh }, k) => {
        const t = k * 12;
        if (p) {
          c.set(MATERIAL_INFO[p.mat].colour);
          data.set([p.t0, p.dur, p.drop, MODE[p.motion], c.r, c.g, c.b, PASS_OF[p.mat], p.stage, mesh.min[1], mesh.max[1], mesh.closed ? 0 : 1], t);
        } else {
          c.set(MATERIAL_INFO.context.colour);
          data.set([-100, 0.001, 0, 3, c.r, c.g, c.b, 0, CONTEXT_STAGE, mesh.min[1], mesh.max[1], 1], t);
        }
        const nverts = mesh.positions.length / 3;
        pos.set(mesh.positions, vo * 3);
        part.fill(k, vo, vo + nverts);
        for (let j = 0; j < mesh.indices.length; j++) idx[io + j] = mesh.indices[j] + vo;
        io += mesh.indices.length;
        vo += nverts;
        const nedge = mesh.edges.length / 3;
        epos.set(mesh.edges, eo * 3);
        epart.fill(k, eo, eo + nedge);
        eo += nedge;
      });
      this.partTex = new DataTexture(data, 1024, Math.max(1, rows), RGBAFormat, FloatType);
      this.partTex.magFilter = NearestFilter;
      this.partTex.minFilter = NearestFilter;
      this.partTex.needsUpdate = true;
      this.uniforms.uParts.value = this.partTex;
      (this.meshGhostMat.uniforms.uParts as { value: unknown }).value = this.partTex;
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('aPart', new BufferAttribute(part, 1));
      g.setIndex(new BufferAttribute(idx, 1));
      const fill = new Mesh(g, this.meshFillMat);
      const lg = new BufferGeometry();
      lg.setAttribute('position', new BufferAttribute(epos, 3));
      lg.setAttribute('aPart', new BufferAttribute(epart, 1));
      const lines = new LineSegments(lg, this.meshLineMat);
      const ghosts = new LineSegments(lg, this.meshGhostMat);
      ghosts.renderOrder = 2;
      for (const o of [fill, lines, ghosts]) o.frustumCulled = false;
      this.model.add(fill, lines, ghosts);
    }

    // ── footprint, grid, crane ──
    let half = 17;
    for (const p of project.parts) half = Math.max(half, Math.abs(p.pos[0]) + p.size[0] / 2, Math.abs(p.pos[2]) + p.size[2] / 2);
    this.footprint = Math.min(half, 120);
    (this.groundMat.uniforms.uFade.value as Vector2).set(this.footprint * 1.9, this.footprint * 4.6);
    if (this.crane) {
      this.scene.remove(this.crane.group);
      this.crane.dispose();
      this.crane = null;
    }
    if (this.reach) {
      this.scene.remove(this.reach.group);
      this.reach.dispose();
      this.reach = null;
    }
    if (project.crane) {
      this.crane = new CraneRig(project.crane, css('--ink'), css('--part'), css('--brand'), project.height);
      this.scene.add(this.crane.group);
      this.reach = new CraneReach(project.crane, { ink: css('--ink'), muted: css('--muted'), ok: css('--green'), warn: css('--warn'), over: css('--bad') });
      this.reach.setResolution(this.size.w, this.size.h);
      this.reach.setMode(this.reachMode);
      this.scene.add(this.reach.group);
    }
    this.autoFrame = true;
  }

  setResolution(r: number) {
    this.resolution = r;
    this.resize();
  }

  get pixelRatio() {
    return this.renderer.getPixelRatio();
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    this.renderer.setPixelRatio(Math.min(this.resolution, 2.5));
    this.renderer.setSize(this.size.w, this.size.h, false);
    this.renderer.domElement.style.width = `${this.size.w}px`;
    this.renderer.domElement.style.height = `${this.size.h}px`;
    this.camera.aspect = this.size.w / this.size.h;
    if (!this.aimWanted) this.aim = this.restAim();
    this.applyAim();
    this.highlight?.setResolution(this.size.w, this.size.h);
    this.reach?.setResolution(this.size.w, this.size.h);
    this.invalidate();
  }

  /** The usual spot for the model: a little right of centre on a wide viewport, clear of the caption card. */
  private restAim() {
    return { x: this.size.w > 700 ? 0.57 : 0.5, y: 0.5 };
  }

  /**
   * While a pose frames something, put its target at this point of the
   * viewport (shares of width and height, 0–1) instead of the usual spot.
   * The camera eases there with the pose; null eases it back.
   */
  aimAt(at: { x: number; y: number } | null) {
    const ok = at && Number.isFinite(at.x) && Number.isFinite(at.y);
    this.aimWanted = ok ? { x: Math.min(1, Math.max(0, at.x)), y: Math.min(1, Math.max(0, at.y)) } : null;
  }

  /** The view offset that puts the camera's axis at `aim`. */
  private applyAim() {
    const { w, h } = this.size;
    this.camera.setViewOffset(w, h, w * (0.5 - this.aim.x), h * (0.5 - this.aim.y), w, h);
    this.camera.updateProjectionMatrix();
  }

  /** Emphasise the crane's reach (the crane plan), show it as usual, or hide it while something else is explained. */
  setReachMode(mode: ReachMode) {
    if (mode === this.reachMode) return;
    this.reachMode = mode;
    this.reach?.setMode(mode);
    this.invalidate();
  }

  /** Show one issue's elements in x-ray with its lines, or clear it. */
  setIssue(spec: IssueSpec | null) {
    this.issueSpec = spec;
    this.highlight.set(this.current, spec);
    this.invalidate();
  }

  /** Hatch these parts (FLAGGED) once they are placed. */
  setFlags(parts: number[]) {
    this.flags.set(this.current, parts);
    this.invalidate();
  }

  setFlagsVisible(on: boolean) {
    this.flags.mesh.visible = on;
    this.invalidate();
  }

  setStyle(style: RenderStyle) {
    const u = this.fillMat.uniforms;
    u.uInk.value = style === 'paint' ? 0 : 1;
    u.uShade.value = style === 'ink' ? 0 : 1;
    this.invalidate();
  }
  setColour(on: boolean) {
    this.fillMat.uniforms.uColour.value = on ? 1 : 0;
    this.invalidate();
  }
  setGhost(on: boolean) {
    this.fillMat.uniforms.uGhost.value = on ? 1 : 0;
    this.invalidate();
  }
  setStageMask(mask: number) {
    this.fillMat.uniforms.uMask.value = mask;
    this.invalidate();
  }
  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on;
    this.invalidate();
  }
  setWash(front: [number, number]) {
    const w = this.fillMat.uniforms.uWash.value as Vector2;
    if (w.x === front[0] && w.y === front[1]) return;
    w.set(front[0], front[1]);
    this.invalidate();
  }
  setCut(cut: CutState | null) {
    const u = this.fillMat.uniforms;
    const on = cut?.on ? 1 : 0;
    const c = u.uCut.value as Vector4;
    if (u.uCutOn.value === on && (!cut || (c.x === cut.normal[0] && c.y === cut.normal[1] && c.z === cut.normal[2] && c.w === cut.d))) return;
    u.uCutOn.value = on;
    if (cut) c.set(cut.normal[0], cut.normal[1], cut.normal[2], cut.d);
    this.invalidate();
  }

  setView(azDeg: number, elDeg: number) {
    const az = (azDeg * Math.PI) / 180;
    const el = (elDeg * Math.PI) / 180;
    const off = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(this.distance);
    this.camera.position.copy(this.target).add(off);
    this.controls.target.copy(this.target);
    this.controls.update();
    this.invalidate();
  }

  /** Distance that fits a box of height h and half-width w centred at h/2. */
  private fitDistance(h: number, w: number) {
    const t = Math.tan(((FOV * Math.PI) / 180) / 2);
    const byH = ((h / 2) * 1.32 + 4) / t; // headroom for the toolbar above and the transport below
    const byW = (w * 1.2) / (t * this.camera.aspect);
    return Math.max(byH, byW, Math.hypot(h / 2, w) * 1.2, Math.min(30, 6 + h * 1.2));
  }

  /** Per-frame: update sequence time, crane, auto-frame, orbit, render. */
  frame(t: number, builtTop: number, builtHalf: number, crane: CraneState, dt: number, snap = false, pose: CameraPose | null = null, poseRate = 3.2) {
    if (this.fillMat.uniforms.uTime.value !== t) this.invalidate();
    this.fillMat.uniforms.uTime.value = t;
    this.fillMat.uniforms.uDpr.value = this.renderer.getPixelRatio();
    this.crane?.update(crane);
    this.reach?.update(crane, this.reachWarnAt, this.reachRigKg);
    this.pathActive = !!pose && this.autoFrame;
    // the aim follows a framed pose; it stays put while the user has the camera
    const aim = pose && this.autoFrame && this.aimWanted ? this.aimWanted : this.autoFrame ? this.restAim() : null;
    if (aim && (Math.abs(aim.x - this.aim.x) > 1e-5 || Math.abs(aim.y - this.aim.y) > 1e-5)) {
      const k = snap ? 1 : 1 - Math.exp(-dt * (pose && this.aimWanted ? poseRate : 3));
      this.aim = { x: this.aim.x + (aim.x - this.aim.x) * k, y: this.aim.y + (aim.y - this.aim.y) * k };
      if (Math.abs(aim.x - this.aim.x) < 1e-4 && Math.abs(aim.y - this.aim.y) < 1e-4) this.aim = { ...aim };
      this.applyAim();
    }
    if (pose && this.autoFrame) {
      this.followPose(pose, snap ? 1 : 1 - Math.exp(-dt * poseRate));
      this.draw();
      return;
    }
    if (Math.abs(this.camera.fov - FOV) > 0.01) {
      this.camera.fov += (FOV - this.camera.fov) * (snap ? 1 : 1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
    }
    if (this.autoFrame) {
      // tall projects keep the whole climbing crane in view; low-rise ones frame the building
      const H = this.maxTop;
      const tall = H > 30;
      const margin = Math.min(10, Math.max(2.5, H * 0.09));
      const minFrame = Math.max(6, Math.min(28, H * 0.25 + 4));
      let frameTop = Math.min(Math.max(builtTop * 1.12 + margin, minFrame), H * 1.08 + 4);
      if (crane.visible) frameTop = Math.max(frameTop, tall ? crane.mastTop + 4 : Math.min(crane.mastTop + 2, frameTop * 1.45));
      const desiredY = Math.max(tall ? 3 : 1.5, Math.min(frameTop * 0.5, builtTop * 0.55 + (tall ? 4 : 1.5)));
      const half = tall ? Math.max(builtHalf, crane.visible ? Math.max(this.footprint, 26) : Math.min(this.footprint, 17)) : Math.max(builtHalf, this.footprint * 0.95);
      const desiredD = this.fitDistance(frameTop, half);
      const k = snap ? 1 : 1 - Math.exp(-dt * 2.2);
      const off = this.camera.position.clone().sub(this.controls.target);
      this.target.y += (desiredY - this.target.y) * k;
      this.distance += (desiredD - this.distance) * k;
      this.controls.target.copy(this.target);
      this.camera.position.copy(this.target).add(off.setLength(this.distance));
    } else {
      this.distance = this.camera.position.distanceTo(this.controls.target);
    }
    this.controls.update(dt);
    this.draw();
  }

  /** Render the frame when the camera moved or something changed; otherwise the canvas already shows it. */
  private draw() {
    const c = this.lastCam;
    const tol = Math.max(1e-4, this.distance * 1e-5);
    const moved =
      c.pos.distanceTo(this.camera.position) > tol ||
      c.target.distanceTo(this.controls.target) > tol ||
      Math.abs(c.fov - this.camera.fov) > 1e-4 ||
      c.w !== this.size.w ||
      c.h !== this.size.h ||
      c.ax !== this.aim.x ||
      c.ay !== this.aim.y;
    this.moving = moved;
    if (!moved && this.dirty === 0) return;
    if (this.dirty > 0) this.dirty--;
    c.pos.copy(this.camera.position);
    c.target.copy(this.controls.target);
    c.fov = this.camera.fov;
    c.w = this.size.w;
    c.h = this.size.h;
    c.ax = this.aim.x;
    c.ay = this.aim.y;
    this.renderer.render(this.scene, this.camera);
  }

  /** Ease the camera towards a fly-through pose (spherical about the pose target). */
  private followPose(pose: CameraPose, k: number) {
    const cur = this.camera.position.clone().sub(this.controls.target);
    const dist = cur.length();
    let az = Math.atan2(cur.x, cur.z);
    const el = Math.asin(Math.min(1, Math.max(-1, cur.y / Math.max(dist, 1e-6))));
    const azT = (pose.az * Math.PI) / 180;
    let da = azT - az;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    az += da * k;
    const elN = el + ((pose.el * Math.PI) / 180 - el) * k;
    const dN = Math.exp(Math.log(dist) + (Math.log(pose.dist) - Math.log(dist)) * k);
    this.controls.target.lerp(new Vector3(...pose.target), k);
    this.target.copy(this.controls.target);
    this.distance = dN;
    this.camera.position.set(
      this.target.x + Math.sin(az) * Math.cos(elN) * dN,
      this.target.y + Math.sin(elN) * dN,
      this.target.z + Math.cos(az) * Math.cos(elN) * dN,
    );
    this.camera.lookAt(this.target);
    this.camera.fov += (pose.fov - this.camera.fov) * k;
    this.camera.updateProjectionMatrix();
  }

  readout(): CameraReadout {
    const off = this.camera.position.clone().sub(this.controls.target);
    const d = off.length();
    const az = ((Math.atan2(off.x, off.z) * 180) / Math.PI + 360) % 360;
    const el = (Math.asin(off.y / d) * 180) / Math.PI;
    const fov = (this.camera.fov * Math.PI) / 180;
    const mm = 12 / Math.tan(fov / 2);
    const pxPerMetre = this.size.h / (2 * d * Math.tan(fov / 2));
    return { az, el, mm, distance: d, pxPerMetre };
  }

  /** World → CSS pixels within the viewport host. */
  project(p: Vector3 | [number, number, number]): { x: number; y: number; behind: boolean } {
    const v = Array.isArray(p) ? new Vector3(...p) : p.clone();
    v.project(this.camera);
    return { x: ((v.x + 1) / 2) * this.size.w, y: ((1 - v.y) / 2) * this.size.h, behind: v.z > 1 };
  }

  get viewportSize() {
    return this.size;
  }

  stats() {
    const r = this.renderer.info.render;
    return { draws: r.calls, tris: r.triangles };
  }

  /** Render a still of the model at time t, fitted to `top` × `half`, as a data URL. */
  snapshot(t: number, top: number, half: number, opts: { az?: number; el?: number; wash?: [number, number]; cut?: CutState } = {}, w = 360, h = 200): string {
    const cam = new PerspectiveCamera(FOV, w / h, 1, 2400);
    const frameTop = Math.max(top + 3, 10);
    const tn = Math.tan(((FOV * Math.PI) / 180) / 2);
    const d = Math.max((frameTop / 2 + 1) / tn, (half * 1.1) / (tn * (w / h)));
    const az = ((opts.az ?? VIEW_PRESETS[0].az) * Math.PI) / 180;
    const el = ((opts.el ?? 18) * Math.PI) / 180;
    const ty = frameTop * 0.48;
    cam.position.set(Math.sin(az) * Math.cos(el) * d, ty + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    cam.lookAt(0, ty, 0);
    return this.renderStill(cam, t, w, h, { wash: opts.wash, cut: opts.cut, overlays: false }).toDataURL('image/png');
  }

  /**
   * An issue still for BCF: its camera, the model as built at t, the issue's
   * x-ray highlight, on paper. The highlight is borrowed for the still only:
   * the live view keeps the selected issue's.
   */
  async issuePng(view: IssueView, t: number, issue: IssueSpec | null = null, w = 960, h = 600): Promise<Uint8Array> {
    const cam = new PerspectiveCamera(view.fov, w / h, 0.1, 2400);
    cam.position.set(...view.position);
    cam.lookAt(...view.target);
    const canvas = this.renderStill(cam, t, w, h, { overlays: true, background: css('--viewport').getStyle(), scale: 1, issue });
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    return new Uint8Array(blob ? await blob.arrayBuffer() : new ArrayBuffer(0));
  }

  /**
   * Render one still off screen. A still shows the whole model as built at t:
   * every stage and the context whatever Layers shows (unless `mask` says
   * otherwise), no live section unless `cut` gives one, no crane or reach.
   * The live view's state is restored even if rendering throws.
   */
  private renderStill(cam: PerspectiveCamera, t: number, w0: number, h0: number, opts: { wash?: [number, number]; cut?: CutState; overlays: boolean; background?: string; scale?: number; mask?: number; issue?: IssueSpec | null }): HTMLCanvasElement {
    // thumbnails render at twice their size for crisp ink; issue stills at their own size
    const sc = opts.scale ?? 2;
    const w = (w0 * sc) / 2, h = (h0 * sc) / 2;
    const rt = new WebGLRenderTarget(w * 2, h * 2, { samples: 4 });
    const u = this.fillMat.uniforms;
    const prev = { t: u.uTime.value, wash: (u.uWash.value as Vector2).clone(), cut: (u.uCut.value as Vector4).clone(), on: u.uCutOn.value, dpr: u.uDpr.value, hold: u.uHold.value, mask: u.uMask.value };
    const craneVisible = this.crane?.group.visible ?? false;
    const reachVisible = this.reach?.group.visible ?? false;
    const hl = this.highlight.group.visible, fl = this.flags.mesh.visible;
    const buf = new Uint8Array(w * 2 * h * 2 * 4);
    const borrow = opts.issue !== undefined;
    try {
      if (borrow) this.highlight.set(this.current, opts.issue ?? null);
      // stills show work as placed, without the "just placed" accent
      if (opts.overlays) u.uHold.value = 0;
      if (this.crane) this.crane.group.visible = false;
      if (this.reach) this.reach.group.visible = false;
      this.highlight.group.visible = opts.overlays;
      this.flags.mesh.visible = opts.overlays && fl;
      this.highlight.setResolution(w * 2, h * 2);
      u.uTime.value = t;
      u.uDpr.value = 2;
      u.uMask.value = opts.mask ?? ALL_STAGES;
      this.setWash(opts.wash ?? [-1e4, -1e4]);
      this.setCut(opts.cut ?? null);
      this.renderer.setRenderTarget(rt);
      this.renderer.clear();
      this.renderer.render(this.scene, cam);
      this.renderer.readRenderTargetPixels(rt, 0, 0, w * 2, h * 2, buf);
    } finally {
      this.renderer.setRenderTarget(null);
      u.uTime.value = prev.t;
      (u.uWash.value as Vector2).copy(prev.wash);
      (u.uCut.value as Vector4).copy(prev.cut);
      u.uCutOn.value = prev.on;
      u.uDpr.value = prev.dpr;
      u.uHold.value = prev.hold;
      u.uMask.value = prev.mask;
      if (this.crane) this.crane.group.visible = craneVisible;
      if (this.reach) this.reach.group.visible = reachVisible;
      this.highlight.group.visible = hl;
      this.flags.mesh.visible = fl;
      this.highlight.setResolution(this.size.w, this.size.h);
      if (borrow) this.highlight.set(this.current, this.issueSpec);
      rt.dispose();
    }
    const canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w * 2, h * 2);
    const row = w * 2 * 4;
    for (let y = 0; y < h * 2; y++) img.data.set(buf.subarray((h * 2 - 1 - y) * row, (h * 2 - y) * row), y * row);
    // render target holds premultiplied colour; ImageData expects straight alpha
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (a > 0 && a < 255) {
        px[i] = Math.min(255, (px[i] * 255) / a);
        px[i + 1] = Math.min(255, (px[i + 1] * 255) / a);
        px[i + 2] = Math.min(255, (px[i + 2] * 255) / a);
      }
    }
    if (!opts.background) {
      ctx.putImageData(img, 0, 0);
      return canvas;
    }
    // composite onto paper for viewers that do not show transparency
    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    layer.getContext('2d')!.putImageData(img, 0, 0);
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layer, 0, 0);
    return canvas;
  }
}
