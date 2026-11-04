import { BoxGeometry, BufferGeometry, Color, EdgesGeometry, Float32BufferAttribute, Group, LineSegments, Mesh, MeshBasicMaterial, ShaderMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Crane } from '../data/types';
import type { CraneState } from '../engine/timeline';
import { lineFragment, lineVertex } from './shaders';

const MAX_MAST = 160;
const W = 1.0; // half-width of a 2.0 m mast
const SECTION = 4;
const TIES = [30, 62, 94];

function lineMat(color: Color) {
  return new ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uTop: { value: 1e6 }, uOpacity: { value: 1 } },
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
  });
}

function segments(v: number[]) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  return g;
}

const boxAt = (w: number, h: number, d: number, x: number, y: number, z: number) => new BoxGeometry(w, h, d).translate(x, y, z);

/**
 * TC-1: a flat-top tower crane drawn as line work. The mast climbs (fragments
 * above the mast top are discarded), the head slews, the trolley runs out to
 * the radius of the current pick and the hook block follows the load down.
 */
export class CraneRig {
  readonly group = new Group();
  private head = new Group();
  private mastMat: ShaderMaterial;
  private tieMat: ShaderMaterial;
  private hoistMat: ShaderMaterial;
  private hoistGeo: BufferGeometry;
  private trolley: LineSegments;
  private hook: LineSegments;
  private ink: Color;
  private accent: Color;

  constructor(crane: Crane, ink: Color, paper: Color, accent: Color) {
    this.ink = ink.clone();
    this.accent = accent.clone();
    this.group.position.set(crane.base[0], 0, crane.base[2]);

    // mast lattice: four chords, a ring and alternating diagonals every 4 m
    const v: number[] = [];
    for (const [x, z] of [[-W, -W], [W, -W], [W, W], [-W, W]]) v.push(x, 0, z, x, MAX_MAST, z);
    for (let y = 0; y < MAX_MAST; y += SECTION) {
      const y2 = y + SECTION;
      v.push(-W, y, -W, W, y, -W, W, y, -W, W, y, W, W, y, W, -W, y, W, -W, y, W, -W, y, -W);
      if ((y / SECTION) % 2 === 0) v.push(-W, y, -W, W, y2, -W, W, y, -W, W, y2, W, W, y, W, -W, y2, W, -W, y, W, -W, y2, -W);
      else v.push(W, y, -W, -W, y2, -W, W, y, W, W, y2, -W, -W, y, W, W, y2, W, -W, y, -W, -W, y2, W);
    }
    this.mastMat = lineMat(ink);
    this.group.add(new LineSegments(segments(v), this.mastMat));

    // tie collars from the mast to the slab edge (world x = −14.2)
    const ex = -14.2 - crane.base[0];
    const tv: number[] = [];
    for (const h of TIES) tv.push(W, h, -W, ex, h, -3, W, h, W, ex, h, 3, W, h, -W, ex, h, 3, -W, h, -W, W, h, -W, -W, h, W, W, h, W);
    this.tieMat = lineMat(ink);
    this.tieMat.uniforms.uTop.value = -1;
    this.group.add(new LineSegments(segments(tv), this.tieMat));

    // jib (triangular lattice, 60 m) and counter-jib (18 m)
    const j: number[] = [];
    const L = crane.jib;
    const C = crane.counterJib;
    j.push(1, 0, -0.8, L, 0, -0.8, 1, 0, 0.8, L, 0, 0.8, 1, 1.8, 0, L - 2, 1.8, 0, L - 2, 1.8, 0, L, 0, 0);
    for (let x = 1; x < L - 2; x += 3) {
      j.push(x, 0, -0.8, x + 1.5, 1.8, 0, x, 0, 0.8, x + 1.5, 1.8, 0, x + 1.5, 1.8, 0, x + 3, 0, -0.8, x + 1.5, 1.8, 0, x + 3, 0, 0.8, x, 0, -0.8, x, 0, 0.8);
    }
    j.push(-1, 0, -0.8, -C, 0, -0.8, -1, 0, 0.8, -C, 0, 0.8, -1, 1.2, 0, -C + 3, 1.2, 0);
    for (let x = -1; x > -C; x -= 3) j.push(x, 0, -0.8, x, 0, 0.8, x, 0, -0.8, x - 1.5, 1.2, 0, x, 0, 0.8, x - 1.5, 1.2, 0);
    this.head.add(new LineSegments(segments(j), lineMat(ink)));

    // slewing unit, cab and counterweights: paper fill with ink edges
    const solids = mergeGeometries([
      boxAt(2.6, 1.4, 2.6, 0, -0.7, 0),
      boxAt(2.0, 2.2, 2.0, 1.9, -1.2, -2.0),
      ...[0, 1, 2, 3].map((i) => boxAt(1.1, 2.6, 2.2, -C + 1.2 + i * 1.15, -1.1, 0)),
    ]);
    this.head.add(new Mesh(solids, new MeshBasicMaterial({ color: paper })));
    this.head.add(new LineSegments(new EdgesGeometry(solids), lineMat(ink)));

    this.trolley = new LineSegments(new EdgesGeometry(new BoxGeometry(1.6, 0.5, 1.9)), lineMat(ink));
    this.hook = new LineSegments(new EdgesGeometry(new BoxGeometry(0.8, 1.0, 0.6)), lineMat(ink));
    this.head.add(this.trolley, this.hook);

    this.hoistGeo = segments([0, 0, 0, 0, -1, 0, 0, 0, 0, 0, -1, 0]);
    this.hoistMat = lineMat(ink);
    this.head.add(new LineSegments(this.hoistGeo, this.hoistMat));

    this.group.add(this.head);
    this.group.visible = false;
  }

  update(s: CraneState) {
    this.group.visible = s.visible;
    if (!s.visible) return;
    this.mastMat.uniforms.uTop.value = s.mastTop;
    this.tieMat.uniforms.uTop.value = s.ties.length ? Math.max(...s.ties) + 0.5 : -1;
    this.head.position.y = s.mastTop;
    this.head.rotation.y = s.slew;
    this.trolley.position.set(s.radius, -0.3, 0);
    const hy = s.hookY - s.mastTop;
    this.hook.position.set(s.radius, hy, 0);
    const p = this.hoistGeo.getAttribute('position') as Float32BufferAttribute;
    p.setXYZ(0, s.radius - 0.15, -0.55, 0);
    p.setXYZ(1, s.radius - 0.15, hy + 0.5, 0);
    p.setXYZ(2, s.radius + 0.15, -0.55, 0);
    p.setXYZ(3, s.radius + 0.15, hy + 0.5, 0);
    p.needsUpdate = true;
    this.hoistGeo.computeBoundingSphere();
    (this.hoistMat.uniforms.uColor.value as Color).copy(s.lifting ? this.accent : this.ink);
    (this.hook.material as ShaderMaterial).uniforms.uColor.value.copy(s.lifting ? this.accent : this.ink);
  }
}
