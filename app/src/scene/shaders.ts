/**
 * One instanced box per part. Visibility, motion and colouring are computed
 * on the GPU from uniforms that are themselves functions of sequence time,
 * so seeking costs nothing.
 *   aMode 0  lowered by the crane (drops into place)
 *   aMode 1  poured / placed in situ (grows up from its base)
 *   aMode 2  bored (grows down from its top)
 *   aMode 3  context massing (always present, drawn as light line work)
 *   aPass    which material wash colours the part (1 structure, 2 envelope)
 * Ink lines come from the box's own edges: distance to the nearest edge in
 * world units, anti-aliased in screen space with fwidth(). Parts cut by the
 * section plane show their inside faces, which are drawn as hatched poché.
 */

const common = /* glsl */ `
  attribute vec3 aTime;   // t0, dur, drop
  attribute vec3 aColor;  // material colour
  attribute float aStage; // 1-based stage (9 = context)
  attribute float aMode;
  attribute float aPass;
  uniform float uTime;
  uniform float uMask;    // stage visibility bitmask
  uniform float uHold;
  varying vec3 vLocal;
  varying vec3 vScale;
  varying vec3 vNormalW;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vActive;
  varying float vContext;
  varying float vPass;

  float stageOn(float s) { return mod(floor(uMask / exp2(s - 1.0)), 2.0); }

  vec4 placeVertex(out float visibleBuilt) {
    float t0 = aTime.x, dur = aTime.y, drop = aTime.z;
    float p = clamp((uTime - t0) / dur, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - p, 3.0);
    visibleBuilt = step(t0, uTime);
    vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vec3 lp = position;
    if (aMode > 0.5 && aMode < 1.5) { lp.y = mix(-0.5, lp.y, e); vScale.y *= max(e, 1e-3); }
    else if (aMode > 1.5 && aMode < 2.5) { lp.y = mix(0.5, lp.y, e); vScale.y *= max(e, 1e-3); }
    vLocal = position;
    vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vColor = aColor;
    vPass = aPass;
    vContext = step(2.5, aMode);
    vActive = (1.0 - smoothstep(t0 + dur, t0 + dur + uHold, uTime)) * (1.0 - vContext);
    vec4 wp = modelMatrix * instanceMatrix * vec4(lp, 1.0);
    if (aMode < 0.5) wp.y += drop * (1.0 - e);
    vWorld = wp.xyz;
    return wp;
  }
`;

const fragCommon = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vScale;
  varying vec3 vNormalW;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vActive;
  varying float vContext;
  varying float vPass;
  uniform vec4 uCut;      // plane normal (xyz) and offset (w): keep dot(p, n) < d
  uniform float uCutOn;

  float edgeInk(float widthPx) {
    vec3 d = (0.5 - abs(vLocal)) * vScale;
    float m1 = min(d.x, min(d.y, d.z));
    float m3 = max(d.x, max(d.y, d.z));
    float m2 = d.x + d.y + d.z - m1 - m3;
    float fw = max(fwidth(m2), 1e-5);
    return 1.0 - smoothstep(fw * (widthPx - 0.5), fw * (widthPx + 0.5), m2);
  }

  bool cutAway() { return uCutOn > 0.5 && dot(vWorld, uCut.xyz) > uCut.w; }

  // value noise (hash by Inigo Quilez) for the uneven wash front
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
`;

export const fillVertex = /* glsl */ `
  ${common}
  void main() {
    float built;
    vec4 wp = placeVertex(built);
    float vis = built * stageOn(aStage) * (1.0 - vContext);
    gl_Position = vis > 0.5 ? projectionMatrix * viewMatrix * wp : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

export const fillFragment = /* glsl */ `
  uniform vec3 uPaper;
  uniform vec3 uContextFill;
  uniform vec3 uInkColor;
  uniform vec3 uActiveFill;
  uniform vec3 uActiveInk;
  uniform vec3 uWetColor;
  uniform vec3 uPoche;
  uniform float uInk;
  uniform float uShade;
  uniform float uColour;
  uniform vec2 uWash;     // wash front height for pass 1 and pass 2
  uniform float uDpr;
  ${fragCommon}
  void main() {
    if (cutAway()) discard;
    float front = vPass < 1.5 ? uWash.x : uWash.y;
    float jitter = (noise3(vWorld * 0.22) - 0.5) * 7.0 + (noise3(vWorld * 0.9) - 0.5) * 2.0;
    float h = vWorld.y + jitter;
    float painted = vPass < 0.5 ? 0.0 : 1.0 - smoothstep(front - 0.8, front + 0.8, h);
    float colourAmt = max(uColour, painted);
    if (!gl_FrontFacing) {
      // the inside of a part the section plane has opened: poché, hatched in screen space
      vec2 fc = gl_FragCoord.xy / uDpr;
      float hatch = step(mod(fc.x - fc.y, 6.0), 1.1);
      vec3 poche = mix(uPoche, vColor * 0.82, colourAmt);
      gl_FragColor = vec4(mix(poche, uInkColor, 0.08 + 0.42 * hatch), 1.0);
      return;
    }
    vec3 L = normalize(vec3(-0.45, 1.0, 0.6));
    float lambert = max(dot(normalize(vNormalW), L), 0.0);
    float light = mix(1.0, 0.76 + 0.24 * lambert, uShade);
    vec3 paper = mix(uPaper, uContextFill, vContext);
    vec3 base = mix(paper, vColor, colourAmt) * light;
    float wet = vPass < 0.5 ? 0.0 : 1.0 - smoothstep(0.0, 2.2, abs(h - front));
    base = mix(base, uWetColor, wet * 0.5);
    vec3 col = mix(base, uActiveFill, vActive * 0.9);
    vec3 ink = mix(uInkColor, uActiveInk, vActive);
    float inkAmt = edgeInk(1.1) * uInk * mix(1.0, 0.3, vContext);
    col = mix(col, ink, inkAmt);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const ghostVertex = /* glsl */ `
  ${common}
  uniform float uGhost;
  void main() {
    float built;
    vec4 wp = placeVertex(built);
    float vis = max((1.0 - built) * uGhost, vContext) * stageOn(aStage);
    gl_Position = vis > 0.5 ? projectionMatrix * viewMatrix * wp : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

export const ghostFragment = /* glsl */ `
  uniform vec3 uGhostColor;
  uniform vec3 uInkColor;
  ${fragCommon}
  void main() {
    if (cutAway()) discard;
    float e = edgeInk(0.9);
    float a = mix(0.018 + 0.16 * e, 0.05 + 0.2 * e, vContext);
    gl_FragColor = vec4(mix(uGhostColor, uInkColor, vContext), a);
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
    float fade = 1.0 - smoothstep(32.0, 78.0, r);
    float minor = gridLine(vW.xz, 3.5, 0.6) * 0.12;
    float major = gridLine(vW.xz, 7.0, 0.9) * 0.26;
    float a = max(minor, major) * fade;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uLine, a);
  }
`;

/** Crane line work: discards above uTop so the mast can climb. */
export const lineVertex = /* glsl */ `
  varying float vY;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vY = w.y;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

export const lineFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTop;
  uniform float uOpacity;
  varying float vY;
  void main() {
    if (vY > uTop) discard;
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;
