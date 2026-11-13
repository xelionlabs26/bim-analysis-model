import type { BufferGeometry, Material, Object3D } from 'three';

/**
 * Release the GPU resources held under `root`: every distinct geometry and
 * material, and the instance buffers of instanced meshes. Materials in `keep`
 * are shared with other objects and are left alone.
 */
export function disposeTree(root: Object3D, keep: ReadonlySet<Material> = new Set()) {
  const geos = new Set<BufferGeometry>();
  const mats = new Set<Material>();
  root.traverse((o) => {
    const m = o as Object3D & { geometry?: BufferGeometry; material?: Material | Material[]; isInstancedMesh?: boolean; dispose?: () => void };
    if (m.geometry) geos.add(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) if (!keep.has(mat)) mats.add(mat);
    if (m.isInstancedMesh) m.dispose?.();
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
}
