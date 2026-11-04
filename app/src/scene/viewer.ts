import {
  BoxGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MATERIAL_INFO, type Motion, type Project } from '../data/types';
import { ACTIVE_HOLD } from '../data/project';
import type { CraneState } from '../engine/timeline';
import { CraneRig } from './crane';
import { fillFragment, fillVertex, ghostFragment, ghostVertex, groundFragment, groundVertex } from './shaders';

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
  readonly crane: CraneRig;
  private fill: InstancedMesh;
  private ghost: InstancedMesh;
  private fillMat: ShaderMaterial;
  private ghostMat: ShaderMaterial;
  private target = new Vector3(0, 6, 0);
  private distance = 90;
  private maxTop: number;
  autoFrame = true;
  private resolution = 1.5;
  private size = { w: 1, h: 1 };

  constructor(private host: HTMLElement, project: Project) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'gl';
    host.prepend(this.renderer.domElement);
    this.maxTop = project.height;

    const geo = new BoxGeometry(1, 1, 1);
    const n = project.parts.length + project.context.length;
    const time = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const stage = new Float32Array(n);
    const mode = new Float32Array(n);
    const m = new Matrix4();
    const q = new Quaternion();
    const v = new Vector3();
    const s = new Vector3();
    const c = new Color();
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
    };
    this.fillMat = new ShaderMaterial({ uniforms, vertexShader: fillVertex, fragmentShader: fillFragment });
    this.ghostMat = new ShaderMaterial({ uniforms, vertexShader: ghostVertex, fragmentShader: ghostFragment, transparent: true, depthWrite: false });
    this.fill = new InstancedMesh(geo, this.fillMat, n);
    project.parts.forEach((p, i) => {
      m.compose(v.set(...p.pos), q.set(...p.quat), s.set(...p.size));
      this.fill.setMatrixAt(i, m);
      time.set([p.t0, p.dur, p.drop], i * 3);
      c.set(MATERIAL_INFO[p.mat].colour);
      color.set([c.r, c.g, c.b], i * 3);
      stage[i] = p.stage;
      mode[i] = MODE[p.motion];
    });
    project.context.forEach((p, k) => {
      const i = project.parts.length + k;
      m.compose(v.set(...p.pos), q.set(...p.quat), s.set(...p.size));
      this.fill.setMatrixAt(i, m);
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
    this.fill.instanceMatrix.needsUpdate = true;
    this.ghost = new InstancedMesh(geo, this.ghostMat, n);
    this.ghost.instanceMatrix = this.fill.instanceMatrix;
    for (const mesh of [this.fill, this.ghost]) mesh.frustumCulled = false;
    this.ghost.renderOrder = 2;
    this.scene.add(this.fill, this.ghost);

    const ground = new Mesh(
      new PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
      new ShaderMaterial({
        uniforms: { uLine: { value: css('--ghost') } },
        vertexShader: groundVertex,
        fragmentShader: groundFragment,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    ground.position.y = -0.005;
    ground.renderOrder = 1;
    this.scene.add(ground);

    this.crane = new CraneRig(project.crane, css('--ink'), css('--part'), css('--brand'));
    this.scene.add(this.crane.group);

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
    this.setView(VIEW_PRESETS[0].az, VIEW_PRESETS[0].el);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
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
    return Math.max(byH, byW, Math.hypot(h / 2, w) * 1.2, 30);
  }

  /** Per-frame: update sequence time, crane, auto-frame, orbit, render. */
  frame(t: number, builtTop: number, builtHalf: number, crane: CraneState, dt: number, snap = false) {
    this.fillMat.uniforms.uTime.value = t;
    this.crane.update(crane);
    if (this.autoFrame) {
      const withCrane = crane.visible ? crane.mastTop + 4 : 0;
      const frameTop = Math.max(Math.min(Math.max(builtTop * 1.12 + 10, 28), this.maxTop * 1.08 + 4), withCrane);
      const desiredY = Math.max(3, Math.min(frameTop * 0.5, builtTop * 0.55 + 4));
      const desiredD = this.fitDistance(frameTop, Math.max(builtHalf, crane.visible ? 26 : 17));
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
  snapshot(t: number, top: number, half: number, w = 360, h = 200): string {
    const rt = new WebGLRenderTarget(w * 2, h * 2, { samples: 4 });
    const cam = new PerspectiveCamera(FOV, w / h, 1, 2400);
    const frameTop = Math.max(top + 3, 10);
    const tn = Math.tan(((FOV * Math.PI) / 180) / 2);
    const d = Math.max((frameTop / 2 + 1) / tn, (half * 1.1) / (tn * (w / h)));
    const az = (VIEW_PRESETS[0].az * Math.PI) / 180;
    const el = (18 * Math.PI) / 180;
    const ty = frameTop * 0.48;
    cam.position.set(Math.sin(az) * Math.cos(el) * d, ty + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    cam.lookAt(0, ty, 0);
    const prev = this.fillMat.uniforms.uTime.value;
    const craneVisible = this.crane.group.visible;
    this.crane.group.visible = false;
    this.fillMat.uniforms.uTime.value = t;
    this.renderer.setRenderTarget(rt);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    const buf = new Uint8Array(w * 2 * h * 2 * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w * 2, h * 2, buf);
    this.renderer.setRenderTarget(null);
    this.fillMat.uniforms.uTime.value = prev;
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
