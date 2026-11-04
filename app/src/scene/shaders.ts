/**
 * One instanced box per part. Visibility, drop animation and active/placed
 * colouring are computed on the GPU from uTime, so seeking costs nothing.
 * Ink lines come from the box's own edges: distance to the nearest edge in
 * world units, anti-aliased in screen space with fwidth().
 */

const common = /* glsl */ `
  attribute vec3 aTime;   // t0, dur, drop
  attribute vec3 aColor;  // material colour
  attribute float aStage; // 1-based stage
  uniform float uTime;
  uniform float uMask;    // stage visibility bitmask
  uniform float uHold;
  varying vec3 vLocal;
  varying vec3 vScale;
  varying vec3 vNormalW;
  varying vec3 vColor;
  varying float vActive;

  float stageOn(float s) { return mod(floor(uMask / exp2(s - 1.0)), 2.0); }

  vec4 placeVertex(out float visibleBuilt) {
    float t0 = aTime.x, dur = aTime.y, drop = aTime.z;
    float p = clamp((uTime - t0) / dur, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - p, 3.0);
    visibleBuilt = step(t0, uTime);
    vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vLocal = position;
    vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vColor = aColor;
    vActive = 1.0 - smoothstep(t0 + dur, t0 + dur + uHold, uTime);
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    wp.y += drop * (1.0 - e);
    return wp;
  }
`;

const edge = /* glsl */ `
  float edgeInk(float widthPx) {
    vec3 d = (0.5 - abs(vLocal)) * vScale;
    float m1 = min(d.x, min(d.y, d.z));
    float m3 = max(d.x, max(d.y, d.z));
    float m2 = d.x + d.y + d.z - m1 - m3;
    float fw = max(fwidth(m2), 1e-5);
    return 1.0 - smoothstep(fw * (widthPx - 0.5), fw * (widthPx + 0.5), m2);
  }
`;

export const fillVertex = /* glsl */ `
  ${common}
  void main() {
    float built;
    vec4 wp = placeVertex(built);
    float vis = built * stageOn(aStage);
    gl_Position = vis > 0.5 ? projectionMatrix * viewMatrix * wp : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

export const fillFragment = /* glsl */ `
  uniform vec3 uPaper;
  uniform vec3 uInkColor;
  uniform vec3 uActiveFill;
  uniform vec3 uActiveInk;
  uniform float uInk;
  uniform float uShade;
  uniform float uColour;
  varying vec3 vLocal;
  varying vec3 vScale;
  varying vec3 vNormalW;
  varying vec3 vColor;
  varying float vActive;
  ${edge}
  void main() {
    vec3 L = normalize(vec3(0.35, 1.0, 0.55));
    float lambert = max(dot(normalize(vNormalW), L), 0.0);
    float light = mix(1.0, 0.74 + 0.26 * lambert, uShade);
    vec3 base = mix(uPaper, vColor, uColour) * light;
    vec3 col = mix(base, uActiveFill, vActive * 0.9);
    vec3 ink = mix(uInkColor, uActiveInk, vActive);
    col = mix(col, ink, edgeInk(1.1) * uInk);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const ghostVertex = /* glsl */ `
  ${common}
  uniform float uGhost;
  void main() {
    float built;
    vec4 wp = placeVertex(built);
    float vis = (1.0 - built) * stageOn(aStage) * uGhost;
    gl_Position = vis > 0.5 ? projectionMatrix * viewMatrix * wp : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

export const ghostFragment = /* glsl */ `
  uniform vec3 uGhostColor;
  varying vec3 vLocal;
  varying vec3 vScale;
  varying vec3 vNormalW;
  varying vec3 vColor;
  varying float vActive;
  ${edge}
  void main() {
    float e = edgeInk(0.9);
    float a = 0.025 + 0.15 * e;
    gl_FragColor = vec4(uGhostColor, a);
  }
`;

export const groundVertex = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

export const groundFragment = /* glsl */ `
  uniform vec3 uLine;
  varying vec3 vW;
  float gridLine(vec2 p, float spacing, float w) {
    vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
    vec2 fw = fwidth(p);
    vec2 l = 1.0 - smoothstep(fw * (w - 0.5), fw * (w + 0.5), g);
    return max(l.x, l.y);
  }
  void main() {
    float r = length(vW.xz);
    float fade = 1.0 - smoothstep(9.0, 19.0, r);
    float minor = gridLine(vW.xz, 1.0, 0.6) * 0.10;
    float major = gridLine(vW.xz, 3.5, 0.9) * 0.22;
    float a = max(minor, major) * fade;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uLine, a);
  }
`;
