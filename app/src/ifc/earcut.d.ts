declare module 'earcut' {
  /** Triangulate a polygon (flat coordinates) with optional holes; returns vertex indices. */
  export default function earcut(data: ArrayLike<number>, holeIndices?: ArrayLike<number> | null, dim?: number): number[];
}
