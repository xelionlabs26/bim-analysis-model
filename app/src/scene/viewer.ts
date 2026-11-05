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
import { MATERIAL_INFO, type Motion, type Project } from '../data/types';
import { ACTIVE_HOLD } from '../data/assemble';
import type { CraneState } from '../engine/timeline';
import { PASS_OF, type CameraPose, type CutState } from '../engine/presentation';
import { CraneRig } from './crane';
import { fillFragment, fillVertex, ghostFragment, ghostVertex, groundFragment, groundVertex, meshFillFragment, meshFillVertex, meshLineFragment, meshLineVertex } from './shaders';

export type RenderStyle = 'ink' | 'ink+paint' | 'paint';

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
const FOV = 26; // ≈ 52 mm on 24 mm film height
const MODE: Record<Motion, number> = { lower: 0, pour: 1, bore: 2 };
const css = (name: string) => new Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000');

export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 1, 2400);
  readonly controls: OrbitControls;
  crane!: CraneRig;
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

  constructor(private host: HTMLElement, project: Project) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'gl';
    host.prepend(this.renderer.domElement);
    this.maxTop = project.height;

    const uniforms = {
      uTime: { value: 0 },
      uMask: { value: 511 },
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
    const ground = new Mesh(new PlaneGeometry(400, 400).rotateX(-Math.PI / 2), this.groundMat);
    ground.position.y = -0.005;
    ground.renderOrder = 1;
    this.scene.add(ground, this.model);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.8; // ≈ 5°/s
    this.controls.minPolarAngle = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.01;
    this.controls.maxDistance = 900;
    this.renderer.domElement.addEventListener('wheel', () => (this.autoFrame = false), { passive: true });
    // grabbing the view during the fly-through hands the camera to the viewer
    this.controls.addEventListener('start', () => {
      if (this.pathActive) this.autoFrame = false;
    });
    this.setView(VIEW_PRESETS[0].az, VIEW_PRESETS[0].el);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.setProject(project);
  }

  /** Replace the model: instanced boxes (generated parts), merged mesh (imported parts), context, crane. */
  setProject(project: Project) {
    for (const child of [...this.model.children]) {
      this.model.remove(child);
      child.traverse((o) => {
        const g = (o as Mesh).geometry as BufferGeometry | undefined;
        g?.dispose?.();
      });
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
    if (this.crane) this.scene.remove(this.crane.group);
    this.crane = new CraneRig(project.crane, css('--ink'), css('--part'), css('--brand'));
    this.scene.add(this.crane.group);
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
    // shift the model a little right of centre, clear of the caption card
    const shift = this.size.w > 700 ? -0.07 * this.size.w : 0;
    this.camera.setViewOffset(this.size.w, this.size.h, shift, 0, this.size.w, this.size.h);
    this.camera.updateProjectionMatrix();
  }

  setStyle(style: RenderStyle) {
    const u = this.fillMat.uniforms;
    u.uInk.value = style === 'paint' ? 0 : 1;
    u.uShade.value = style === 'ink' ? 0 : 1;
  }
  setColour(on: boolean) {
    this.fillMat.uniforms.uColour.value = on ? 1 : 0;
  }
  setGhost(on: boolean) {
    this.fillMat.uniforms.uGhost.value = on ? 1 : 0;
  }
  setStageMask(mask: number) {
    this.fillMat.uniforms.uMask.value = mask;
  }
  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on;
  }
  setWash(front: [number, number]) {
    (this.fillMat.uniforms.uWash.value as Vector2).set(front[0], front[1]);
  }
  setCut(cut: CutState | null) {
    const u = this.fillMat.uniforms;
    u.uCutOn.value = cut?.on ? 1 : 0;
    if (cut) (u.uCut.value as Vector4).set(cut.normal[0], cut.normal[1], cut.normal[2], cut.d);
  }

  setView(azDeg: number, elDeg: number) {
    const az = (azDeg * Math.PI) / 180;
    const el = (elDeg * Math.PI) / 180;
    const off = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(this.distance);
    this.camera.position.copy(this.target).add(off);
    this.controls.target.copy(this.target);
    this.controls.update();
  }

  /** Distance that fits a box of height h and half-width w centred at h/2. */
  private fitDistance(h: number, w: number) {
    const t = Math.tan(((FOV * Math.PI) / 180) / 2);
    const byH = ((h / 2) * 1.32 + 4) / t; // headroom for the toolbar above and the transport below
    const byW = (w * 1.2) / (t * this.camera.aspect);
    return Math.max(byH, byW, Math.hypot(h / 2, w) * 1.2, Math.min(30, 6 + h * 1.2));
  }

  /** Per-frame: update sequence time, crane, auto-frame, orbit, render. */
  frame(t: number, builtTop: number, builtHalf: number, crane: CraneState, dt: number, snap = false, pose: CameraPose | null = null) {
    this.fillMat.uniforms.uTime.value = t;
    this.fillMat.uniforms.uDpr.value = this.renderer.getPixelRatio();
    this.crane.update(crane);
    this.pathActive = !!pose && this.autoFrame;
    if (pose && this.autoFrame) {
      this.followPose(pose, snap ? 1 : 1 - Math.exp(-dt * 3.2));
      this.renderer.render(this.scene, this.camera);
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
    const rt = new WebGLRenderTarget(w * 2, h * 2, { samples: 4 });
    const cam = new PerspectiveCamera(FOV, w / h, 1, 2400);
    const frameTop = Math.max(top + 3, 10);
    const tn = Math.tan(((FOV * Math.PI) / 180) / 2);
    const d = Math.max((frameTop / 2 + 1) / tn, (half * 1.1) / (tn * (w / h)));
    const az = ((opts.az ?? VIEW_PRESETS[0].az) * Math.PI) / 180;
    const el = ((opts.el ?? 18) * Math.PI) / 180;
    const ty = frameTop * 0.48;
    cam.position.set(Math.sin(az) * Math.cos(el) * d, ty + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    cam.lookAt(0, ty, 0);
    const u = this.fillMat.uniforms;
    const prev = { t: u.uTime.value, wash: (u.uWash.value as Vector2).clone(), cut: (u.uCut.value as Vector4).clone(), on: u.uCutOn.value, dpr: u.uDpr.value };
    const craneVisible = this.crane.group.visible;
    this.crane.group.visible = false;
    u.uTime.value = t;
    u.uDpr.value = 2;
    this.setWash(opts.wash ?? [-1e4, -1e4]);
    this.setCut(opts.cut ?? null);
    this.renderer.setRenderTarget(rt);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    const buf = new Uint8Array(w * 2 * h * 2 * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w * 2, h * 2, buf);
    this.renderer.setRenderTarget(null);
    u.uTime.value = prev.t;
    (u.uWash.value as Vector2).copy(prev.wash);
    (u.uCut.value as Vector4).copy(prev.cut);
    u.uCutOn.value = prev.on;
    u.uDpr.value = prev.dpr;
    this.crane.group.visible = craneVisible;
    rt.dispose();
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
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }
}
