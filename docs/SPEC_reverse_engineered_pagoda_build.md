# PAGODA BUILD: rebuild spec, reverse-engineered from the screen recording

Source: `wast3 - A London architect killed $238,000 of build cost…mp4`.
3158×2160, 60 fps, 24.8 s, one continuous take (ffmpeg scene detection at a 0.25 threshold finds no cuts). AAC audio is present, but the in-app music toggle reads "Muted".
Reference frames: `docs/reference/frames/` (11 stills, file names carry the timestamp).

## 0. Method and evidence rules

REA (reverse-engineer-anything) has no route for video. It analyses shipped binaries, packages and live
browser/Electron targets, and only a recording was supplied. So the evidence here is
**frame observation**: frames sampled at 2 fps across the whole clip, full-resolution crops of
every panel, and 15 fps strips across three animations. There is no code, no network trace and no runtime access.

Every line is tagged:

- **[O] Observed**: read directly off a frame (timestamp given where useful).
- **[I] Inferred**: the most likely implementation given what's observed. Not proven.
- **[U] Unknown**: not determinable from the video.
- **[D] Design choice**: a decision for *our* rebuild, not a claim about the original.

---

## 1. What the app is, and what it is not

**[O]** A single-screen web-style application called **PAGODA BUILD**, subtitled "Timber structure ·
Assembly · Section". It plays a **25-second scripted assembly sequence** of a five-tier timber
pagoda. That's 191 steps and 5,627 parts, placed member by member, then painted, then cut in
section and flown through. It is styled as an architectural drawing sheet with title blocks, level
datums, leader callouts, a scale bar, a north arrow and sheet numbers.

**[O]** What it does *not* show, despite the post that accompanied it:

| Claim in the post | Shown in the video? |
|---|---|
| ORDER: every element placed in install order | **Partly.** A fixed, authored order is animated. No logic is shown that derives or validates the order. |
| REACH: access checked for equipment | **No.** "CAM crane up" in the log is a *camera* move. No cranes, envelopes or access paths appear. |
| CLASH: unreachable items flagged | **No.** No warnings, flags or red/amber states appear anywhere. |
| Runs in Unreal, driven by Opus | **Not evidenced.** See §8. |
| A London architect, $238k | **Not evidenced.** The project is a pagoda, not a residential job. |

**[O]** The closest thing to verification is one log line type, `CHK`:
`[14.14] CHK TIER5 · 42/42 placed · plumb ±2.3 mm · level ±0.8 mm ✓`. It is a per-tier tolerance
summary that always passes. **[I]** It is authored text rather than a computed check: the values are
constant-looking and there is no failure path on screen.

**Bottom line:** this is a beautifully designed **4D assembly-sequence visualiser**. The constructability
engine the post describes is not in the video. §10 specifies how to add it for real.

---

## 2. Screen layout (desktop, 16:~11)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ HEADER: logo · PAGODA BUILD · subtitle · elev-diagram · H ruler · section bubble · N arrow │
│         · DWG/REV/SHEET block          ┃ STATUS CARD: phase · step/pcs · progress · n/8   │
│                                        ┃              date · clock · ● LIVE · 60 FPS · PG │
├────┬────────────────────────────────────────────────────┬────────────────────────────────┤
│RAIL│ VIEWPORT TOOLBAR: ☰ · ●Orbit Cam · Ink+Paint ▾ ·    │ BUILD SEQUENCE  [Sequence|Members] ⤓ ⏸ │
│ 1  │   Ghost · ♫ ~~~~ Muted                │ TITLE BLOCK │ PG-05 ▸ Assembly · 191 steps · 5 627 │
│ 2  │ CAPTION CARD (top-left)               │ (top-right) │ STAGE TIMELINE (8-row Gantt + %)     │
│ 3  │                                       │             │ ACTIVE OPERATION (member card)       │
│ 4  │            3D VIEWPORT                │ LEVEL RULER │ STRUCTURE (pyramid + tier counts)    │
│ 5  │   (blueprint grid, PAGODA watermark,  │ (right)     │ BUILD LOG [badge] sparkline ✕        │
│ 6  │    leader callouts, scale bar)        │             │   streaming log lines                │
│ 7  │ SCRUBBER with stage ticks                           │                                │
│GPU │ TRANSPORT BAR: ⏮ ⏸ ⏭ · time · REBUILD AUTO-ROTATE COLOUR FRAME SECTION SPEED VIEW │      │
├────┴────────────────────────────────────────────────────┴────────────────────────────────┤
│ STAGES · 8 stages · 191 steps · 25 sec sequence                 — PLACED — ACTIVE --- GHOST│
│ ‹  [01 card][02 card][03]…[08 card]  ›   (thumbnail · start time · sheet no · subtitle)    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

Approximate proportions **[O]**: rail ≈ 6% width; viewport ≈ 60%; right panel ≈ 34%; header ≈ 8%
height; stage strip ≈ 13% height. Panels are rounded cards (≈ 24 px radius at 1× scale) on a warm paper background.

---

## 3. Features, one by one

### F01 Header / brand bar  [O]
- Pagoda line-icon logo (red, outline style), wordmark **PAGODA** (near-black) and **BUILD** (brand red), in a heavy grotesque.
- Tracked caps subtitle: `TIMBER STRUCTURE · ASSEMBLY · SECTION`.
- **Mini elevation diagram:** a pagoda silhouette with `ELEV. S · 1:200` under a ground line and ticks.
- **Height dimension:** a vertical red dimension line labelled `H 37.54`.
- **Section bubble:** a circle split by a line, `A` over `A-301`, with a red arrow pointing right (view direction).
- **North arrow:** a compass rose with `N`.
- **Drawing register block:** `DWG PG-05 · REV C · 11/26 · SHEET A-102`.
- **Req:** all values data-bound to the project record. The sheet number in the register stays A-102 while the title block sheet changes; **[U]** whether that's intentional.

### F02 Status card (top-right)  [O]
- Phase icon tile, phase name (`ASSEMBLY` → `LACQUER` → `SECTION A–A`).
- `STEP 026/191 · 399 PCS`: the current step and the cumulative parts placed.
- A thin progress bar (red fill), proportional to step/191.
- A big stage counter `2/8`.
- Date `NOV 03, 2026` and a live clock `21:19:05` that ticks in real time (02 → 26 across the clip, matching wall time).
- `● LIVE · 60 FPS` (red dot).
- `PG` monogram stamp button (slightly rotated, outlined red). **[U]** Its function: likely profile or project switcher.

### F03 Left navigation rail  [O]
Seven items, each with an icon tile, a label, a mono sub-label and a keyboard number badge 1–7:

| # | Label | Sub-label | Icon |
|---|---|---|---|
| 1 | Model | 5 TIERS | cube (active: filled red tile, red left indicator bar, raised white card) |
| 2 | Layers | 8 STAGES | stacked layers |
| 3 | Parts | 5.6K PCS | 2×2 grid with + |
| 4 | Section | A – A | crop/section frame |
| 5 | Render | INK | circle-slash |
| 6 | Settings | MSAA · 1.5× | sliders |
| 7 | Language | EN | globe |

- **[U]** None of the panels these open are shown; only Model is ever active.
- **[D]** Rebuild: Layers = stage visibility toggles; Parts = searchable member list (shared with the Members tab); Section = cut-plane controls; Render = style picker; Settings = AA/resolution scale/perf HUD; Language = i18n.

### F04 GPU / performance HUD  [O]
- Card at the bottom of the rail: `GPU  LIVE`, big `60 FPS`, a frame-time sparkline (red line over a pink band), then `DRAWS 3 · TRIS 202k · RES 1.50×`.
- Values change during the clip: the log reports `112k tris · 91k segs` while the HUD shows `202k tris`. **[I]** The HUD counts fill and ghost geometry; the log counts placed geometry plus line segments.

### F05 Viewport toolbar  [O]
- `☰` menu (**[U]** contents).
- `● Orbit Cam` pill (red dot = camera mode indicator).
- `Ink + Paint ▾` dropdown for render style. **[I]** Options include Ink (line-only), Paint (shaded) and Ink + Paint.
- `Ghost` toggle (outlined red = on): shows the unbuilt remainder as a translucent pink ghost.
- Music control `♫` with an animated waveform/dotted bar and the state `Muted`.

### F06 Caption card (viewport top-left)  [O]
- Serif title: **Five-Tier Pagoda — Assembly Drawing**; serif sub: "Timber pagoda · built member by member from the drawing".
- Red mono: `STEP 026 / 191`. In the paint stage it becomes `LACQUER · COAT 1 / 2 · 55 %`; in the section stage, `SECTION A–A · d 0.45 m`.
- Bold serif member name: `MOKOSHI · HEAD BEAMS & BRACKETS · WEST`.
- Red serif spec line: `single-step brackets · tie beams to the wall`.
- Red left border bar. The card has a translucent paper background over the 3D.

### F07 Title block (viewport top-right)  [O]
A drawing title block with a red border, fields `DRAWING FIVE-TIER PAGODA`, `DWG NO. PG-05 / A-102`,
`SCALE 1:100…1:250`, `PHASE ASSEMBLY|LACQUER|SECTION A-A`, `SHEET n / 8`,
`CAMERA AZ 211° · EL +19° · 52 mm`.
- **Live-bound:** azimuth changes continuously with auto-rotate (211° → 344°+). Elevation (+13…+27°) and focal length (52 mm → 33 mm in the fly-through) change too.
- **Scale auto-steps** with camera distance: 1:100 → 1:125 → 1:150 → 1:200 → 1:250, then 1:75 / 1:50 in the section close-ups. The scale bar (F09) relabels to match.

### F08 Level datum ruler (viewport right)  [O]
- A vertical red dimension line with tick crosses and labels: `GL ±0.00`, `FL 1 +1.30`, `T2 +7.92`, `T3 +13.04`, `T4 +17.98`, `T5 +22.75`, `APEX +28.64`, `TOP +37.54`, plus a boxed `H = 37.54 m` at the top.
- Dashed leader from each label into the model. **[I]** Projected each frame from world Y to screen, so the ruler follows the camera.
- It appears progressively: datums fade in as their tier is built (TOP appears around t = 13 s with the spire).

### F09 Scale bar  [O]
- `0 — 2.5 — 5 m` (later `0 — 5 — 10 m`), alternating black/white segments, with `SCALE · 1:xxx` below in red.
- **Req:** compute metres-per-pixel at the model's centre depth, choose the nearest standard scale, relabel.

### F10 Leader callouts (3D annotations)  [O]
- Engraved-style serif label in caps, `TIER 2 · RAFTERS · WEST`, with a rule under it, a red italic serif sub-line `base + flying rafters · 0.11 × 0.13 m`, and a thin red leader line ending in a **small red ring** on the member.
- **Lifecycle:** a new callout appears for the active member, fully dark. Previous callouts fade to light grey, then disappear; about 3–5 are visible at once. Callouts sit left or right of the model to avoid overlap. **[I]** A simple side-assignment by the anchor's screen-x versus model centre-x.
- In the section stage, labels become `INTERIOR · SHUMIDAN ALTAR` and `SEATED BUDDHA · SOUTH`.

### F11 Blueprint paper and watermark  [O]
- Warm paper background (`#f0eae3`) with a fine grid (≈ 1 major cell = 5 minor), drawn faint red/brown.
- A giant outlined vertical **"PAGODA"** watermark on the left of the viewport (letters stacked, stroke only).
- A thin red section-line stroke (A–A) crosses the plan during assembly.

### F12 Timeline scrubber (viewport bottom)  [O]
- A full-width track with stage ticks labelled `PLINTH T1 T2 T3 T4 T5 PAINT SECTION` at their start times. A red filled portion and a white knob with a red ring.
- **Req:** dragging seeks; the model state, panels and log must be reconstructable at any time *t* (§7).

### F13 Transport bar  [O]
A floating pill with these controls; single-letter keyboard shortcuts are shown under each:

| Control | Key | Observed state |
|---|---|---|
| ⏮ | — | restart / previous stage **[I]** |
| ⏸ / ▶ | (Space **[I]**) | playing |
| ⏭ | — | next stage **[I]** |
| `00:03.3 / 00:25` | — | timecode, 0.1 s resolution |
| REBUILD | R | replay from step 0 **[I]** |
| AUTO-ROTATE | A | **on** (filled red) all clip |
| COLOUR | C | **[I]** toggle paint/material colours |
| FRAME | X | **[I]** zoom to fit, or wireframe toggle |
| SECTION | S | toggle cut plane |
| SPEED ×2 | F | playback rate (×1/×2/×4 **[I]**) |
| VIEW | V | cycle camera presets **[I]** |

### F14 Build Sequence panel header  [O]
- `BUILD SEQUENCE` heading; segmented tabs `Sequence | Members` (Sequence active); a download button `⤓` (**[I]** export the sequence as CSV/JSON or the sheet as PDF); a red pause button mirroring the transport.
- Breadcrumb: `PG-05 ▸ Assembly · 191 steps · 5 627 parts`.

### F15 Stage timeline (Gantt)  [O]
- 8 rows: `01 PLINTH … 08 SECTION`, each with a horizontal bar made of segmented "pills" (one pill per step group). Bars are staggered left to right by start time.
- **States:** future = pale pink; active = red with the current pill highlighted and the row label red; complete = solid dark red.
- Percent per row on the right. A red vertical playhead line with a triangle head. Readout `3.3 / 25.0 s`.

### F16 Active Operation card  [O]
- Header `ACTIVE OPERATION` with a status at the right: `PLACED ✓`, `LOWERING ▾`, `BASE`, `CUT · FLY-THROUGH`.
- Fields: **MEMBER** (serif bold), **STEP** (`#026 / 191`, or `P-03`, `S-07` in later stages, red), **STAGE** (`02 · TIER1`),
  **QUANTITY** (`9 pcs · MB-01`), **MATERIAL** (`hinoki cypress`), **SPECIFICATION** (truncated with ellipsis),
  **PLACED AT X · Y · Z** (`-4.37 · 3.80 · -1.03`), **EST. MASS** (`≈ 540 kg`, `≈ 2.0 t`, or `—`).
- In the paint stage the fields become coats/surfaces (`2 coats`, `bengara lacquer`, `0.1 t paint`).

### F17 Structure widget  [O]
- `STRUCTURE` with a total at right: `14 % · 243.4 t`, ending at `100 % · 438.8 t`.
- A **stacked pyramid** of 7 bars (spire at the top, plinth at the bottom; the width shrinks upward). Each bar fills left to right with red as its tier's steps complete. The active tier is outlined red.
- A count table: `SPIRE 0/14 · TIER 5 0/28 · TIER 4 0/29 · TIER 3 0/29 · TIER 2 0/29 · TIER 1 7/43 · PLINTH 19/19`.
  These sum to **191**, so the counts are *steps*, not parts.

### F18 Build Log  [O]
- `BUILD LOG` with a red state badge (`ASSEMBLING` / `LACQUERING` / `SECTION A-A`), a small activity sparkline, and a close `✕`.
- A monospace stream, `[ss.ss] TYPE body`, auto-scrolling; the newest line is at the bottom, about 8 visible. Older lines are slightly greyer. Observed line types:

| Type | Example (verbatim) | Style |
|---|---|---|
| `══ STAGE` | `[02.80] ══ STAGE 02/08 · TIER 1 · MOKOSHI — altar · 4 Buddhas` | bold |
| `ASM` | `[04.47] ASM INTERIOR · SEATED BUDDHA · SOUTH +6 pcs · Σ 1 120` | normal |
| `CHK` | `[14.14] CHK TIER5 · 42/42 placed · plumb ±2.3 mm · level ±0.8 mm ✓` | red |
| `PERF` | `[14.00] PERF 60 fps · 3 draws · 112k tris · 91k segs · 1.50×` | grey |
| `LACQ` | `[14.55] LACQ coat 1/2 · wash front +4.7 m · 13 % surface · bengara red` | normal |
| `CUT` | `[18.58] CUT plane A-A · az 100° · offset 14.0 → 0.45 m · poché hatch …` | red |
| `CAM` | `[19.03] CAM dolly in · 50 → 15.5 m · fov 30° → 40°` / `CAM crane up · target +8.0 → +14.5 m · fov 46°` | normal |
| `VIEW` | `[19.94] VIEW interior TIER 1 · shumidan altar in frame` | normal |
| `RUN` | `[24.62] RUN sequence complete · loop → STEP 000` | normal |

- `PERF` lines appear every 2.0 s (`[18.00]`, `[22.00]`). `Σ` is the running part total.

### F19 Stage cards strip  [O]
- Heading `STAGES 8 STAGES · 191 STEPS · 25 SEC SEQUENCE`; legend `— PLACED  — ACTIVE  --- GHOST`; ‹ › arrows.
- 8 cards, each with a **thumbnail of that stage's end state** (in that stage's render style) on grid paper, a start-time chip (`0.0s`), a sheet chip (`A-101`…`A-108`), a title and a mono subtitle:

| # | Title | Subtitle | Start | Sheet |
|---|---|---|---|---|
| 01 | PLINTH & SITE | granite · 4 stairs · 18 steps | 0.0 s | A-101 |
| 02 | TIER 1 · MOKOSHI | altar · 4 Buddhas · 43 steps | 2.8 s | A-102 |
| 03 | TIER 2 | balcony · levers · 29 steps | 6.0 s | A-103 |
| 04 | TIER 3 | brackets · roof · 29 steps | 8.1 s | A-104 |
| 05 | TIER 4 | brackets · roof · 29 steps | 9.9 s | A-105 |
| 06 | TIER 5 · SPIRE | sōrin · 9 rings · 42 steps | 11.7 s | A-106 |
| 07 | LACQUER & TILE | vermilion · 2 coats · 4.0 s | 14.2 s | A-107 |
| 08 | SECTION A–A | interior flight · 6.8 s | 18.2 s | A-108 |

- Active card: red border, red title, and a red progress underline across the card bottom that fills over the stage's duration. Completed cards keep a full red underline.
- **[I]** Clicking a card seeks to its start.

---

## 4. Keyboard map  [O labels / I behaviour]

`1–7` rail items · `R` rebuild · `A` auto-rotate · `C` colour · `X` frame · `S` section · `F` speed ·
`V` view · (`Space` play/pause, `←/→` step **[I]**).

---

## 5. Data model  [D, shaped by O]

```jsonc
// project.json
{
  "id": "PG-05", "name": "Five-Tier Pagoda", "subtitle": "Timber pagoda · built member by member from the drawing",
  "rev": "C", "revDate": "11/26", "sheetPrefix": "A-10",
  "height": 37.54,
  "levels": [ {"code":"GL","z":0.00}, {"code":"FL 1","z":1.30}, {"code":"T2","z":7.92},
              {"code":"T3","z":13.04}, {"code":"T4","z":17.98}, {"code":"T5","z":22.75},
              {"code":"APEX","z":28.64}, {"code":"TOP","z":37.54} ],
  "stages": [ { "n":1, "code":"PLINTH", "title":"PLINTH & SITE", "subtitle":"granite · 4 stairs",
                "kind":"assembly", "start":0.0, "end":2.8, "sheet":"A-101", "tierBar":"PLINTH" }, … ],
  "steps": [
    { "id":"026", "stage":2, "tier":"TIER 1",
      "member":"MOKOSHI · HEAD BEAMS & BRACKETS · WEST",
      "spec":"single-step brackets · tie beams to the wall · section 0.18 × 0.…",
      "qty":9, "code":"MB-01", "material":"hinoki cypress",
      "anchor":[-4.37, 3.80, -1.03], "massKg":540,
      "parts":[ "mesh ids / instance ids …" ],
      "t0":3.29, "dur":0.06, "motion":"lower", "status":"LOWERING" }
  ],
  "paintPasses": [ { "id":"P-01", "name":"LACQUER · VERMILION COAT", "material":"bengara iron-oxide red",
                     "coat":1, "coats":2, "surfaceFilter":"timber", "t0":14.2, "dur":… } ],
  "sectionShots": [ { "id":"S-01", "member":"SECTION A-A", "cut":{"az":100,"from":14.0,"to":0.45},
                      "camera":{…}, "t0":18.2 } ]
}
```

Step counts per tier **[O]**: Plinth 19, T1 43, T2 29, T3 29, T4 29, T5 28, Spire 14 = 191.
Stage-card counts differ (Plinth 18, T5 + Spire 42) **[O]**. **[I]** The cards count by stage and the pyramid by tier; spire members belong to stage 06.

---

## 6. Animations

| ID | Animation | Observed behaviour | Rebuild technique [D] |
|---|---|---|---|
| A01 | **Ghost preview** | Whole unbuilt model as translucent pink hatch/lines; density makes it read as a "cloud" | Second instanced draw with additive pink lines, alpha ≈ 0.15; parts leave the ghost set on placement |
| A02 | **Member placement** | Active member shows in **solid pink-red**, settles in about 60–150 ms, then turns to **white fill + black ink** (placed). Status reads `LOWERING` | Per-instance attribute `state ∈ {ghost, active, placed}` + `progress`; lower from +Δy (≈0.3–1 m) with ease-out; colour lerp red→paper at the end |
| A03 | **Sweep order inside a step group** | Groups go S → E → N → W (e.g. head beams), rows bottom-up (paving rows 1…n), columns centre-out | Sort key in data; stagger 5–10 ms per instance |
| A04 | **Auto-rotate** | Continuous orbit ≈ 5–6°/s (AZ 211° → ~344° over 15 s, then fly-through) | Orbit controls `autoRotateSpeed`; AZ readout from the spherical coordinates |
| A05 | **Auto-framing / zoom-out** | Camera distance grows as height grows; scale steps 1:100 → 1:250 | Fit the bounding sphere of placed + active parts, damped (critically damped spring) |
| A06 | **Callout lifecycle** | Fade-in dark → demote to grey → fade-out; leader tracks the member every frame | DOM/SVG overlay, `project()` each frame, opacity by age rank |
| A07 | **Datum reveal** | Level ticks appear as their tier completes | Same overlay; reveal on tier-complete event |
| A08 | **Gantt and pyramid fill** | Pills fill sequentially; pyramid bars grow; % counters tick | Derived from `t`; CSS width transitions ≈ 120 ms |
| A09 | **Log streaming** | New line appends, list scrolls, older lines grey | Virtualised list; lines emitted when `t` crosses the event time |
| A10 | **Lacquer wash** | Vermilion spreads **from the base upward** as a noisy, blotchy front (`wash front +4.7 m … +37.5 m`, `13 % surface`); two coats, with tile glaze after; timber stays white until reached | Shader: `paint = smoothstep(front - noise(worldPos*k)*w, front, worldY)`, mixing ink-white → bengara `#6d2126`; coat 2 darkens/saturates; tiles get a separate pass to slate grey-glaze |
| A11 | **Ink → paint style switch** | Line-ink NPR during assembly; full shaded colour after lacquer; brackets get red + ochre end-grain | Two materials (ink outline + flat fill vs lit lacquer); blend per instance via `paint` |
| A12 | **Section cut** | Cut plane A–A at az 100° slides 14.0 → 0.45 m through the model; cut faces get a **poché hatch**; the far half stays, revealing the interior (gold coffered ceiling, gilt Buddhas, shinbashira) | `clippingPlanes` + stencil-capped cross-section with a hatch texture |
| A13 | **Fly-through camera** | `CAM dolly in 50 → 15.5 m, fov 30° → 40°`, `crane up +8.0 → +14.5 m, fov 46°`, `crane up → +21.5 m`, then pull back out; focal readout 52 → 33 → 28 mm | Keyframed camera spline (position, target, fov) with ease-in-out |
| A14 | **Closing section and loop** | `CUT closing section · plane → 14.0 m`, `RUN sequence complete · loop → STEP 000` | Reverse the clip plane; reset `t = 0` |
| A15 | **Stage card progress** | Active card red underline fills over the stage duration | CSS transform `scaleX` |
| A16 | **Live clock, FPS sparkline, music waveform** | Ticks every second; sparkline scrolls; waveform dots animate even while muted | rAF timers |

Timings **[O]**: assembly stages are 1.8–3.2 s each; at ≈ 191 steps / 14.2 s that's about 74 ms per step, with bursts.

---

## 7. Sequence engine requirements  [D]

1. **Deterministic timeline.** All UI state is a pure function of `t ∈ [0, 25]`, so seek, scrub, speed ×2 and rebuild are trivial.
2. **Event table.** Precompute `events[] = {t, type, payload}` from steps, paint passes and shots. The log, counters and Gantt read from it with binary search.
3. **Instancing.** The 5,627 parts are batched into ~3 draw calls (fill, ink lines, ghost) **[I from DRAWS 3]**. Use per-instance `state` and `progress` attributes; never add or remove meshes at runtime.
4. **Overlay layer.** HTML/SVG on top of the canvas for callouts, ruler, scale bar and title block, re-projected every frame.
5. **Performance budget.** 60 fps at 1.5× render scale with MSAA; ~200k triangles, ~91k line segments.

---

## 8. Technology inference  [I]

- **Web app, not Unreal.** The UI is DOM-style (rounded cards, web fonts, segmented controls, crisp text at 4K). The HUD reports `DRAWS 3` for 5,627 parts plus a ghost, which is a WebGL batched/instanced pattern. "RES 1.50×" matches the canvas device-pixel-ratio scaling typical of three.js (`renderer.setPixelRatio`). Unreal's editor or a UMG HUD would not report 3 draws for this scene.
- **Likely stack:** three.js (BatchedMesh / InstancedMesh, LineSegments2 for ink), a custom NPR shader, clipping planes for the section, and React or vanilla DOM for panels. **[U]** Framework, build tool, whether models are procedural or imported (GLB).
- **Geometry:** strongly kit-of-parts (blocks, posts, rafters, brackets, tiles). **[I]** Likely procedurally generated from parameters, given the perfectly regular counts (29 steps per mid tier).
- **AI's role:** **[U]** Nothing on screen shows a model or agent at runtime. If Claude was involved, it was most likely in authoring the code or data.

---

## 9. Design system  [O sampled / D]

| Token | Value |
|---|---|
| `--paper` (page) | `#f0eae3` |
| `--card` | `#f9f4f1` |
| `--ink` | `#1c160f` |
| `--brand` (red) | `#9d1125` |
| `--lacquer` | `#6d2126` |
| `--ghost` | brand red @ ~15–25% |
| `--grid` | ink @ ~5–8% |
| `--gold` (interior) | ≈ `#d9b25a` **[I]** |

Type **[I]**: a heavy geometric grotesque for display (wordmark, headings); a transitional serif (Source Serif / Noto Serif-like) for drawing labels and captions; a monospace (JetBrains Mono / IBM Plex Mono-like) for all data. Wide letter-spacing on caps labels.
Motifs: drawing-sheet conventions (title block, datum crosses, section bubble, north arrow, poché, scale bar), red as the "active" colour, dashed lines for the ghost.

---

## 10. Making it genuinely useful for AEC: the parts the post claimed but the video lacks  [D]

Keep the whole presentation layer above, then add a **verification engine** so the sequence is *checked*, not just animated.

### 10.1 Inputs
- IFC 4 model (IfcOpenShell), or Revit/Speckle export → normalised `elements[]` with geometry, type, mass, supports.
- Site model: crane positions with **load charts** (radius → capacity), access routes, laydown zones, existing structures.
- Proposed sequence: from the programme (P6/MSP XML), or auto-generated.

### 10.2 Checks (each emits an event into the same log as `CHK`, and can fail)
| Check | Rule | Fail output |
|---|---|---|
| ORDER-SUPPORT | every element's bearing/support elements are placed earlier | `✗ ORDER beam B-214 placed before column C-31` |
| ORDER-STABILITY | partial structure stable at each step (temp-works flag if not) | `⚠ TEMP props required T2 east before step 87` |
| REACH-CRANE | element centroid within crane radius **and** mass ≤ chart capacity at that radius (incl. rigging allowance) | `✗ REACH steel beam 4.1 t @ 38 m · capacity 3.2 t` |
| REACH-PATH | a swept lift path from laydown to final position is collision-free against already-placed elements | `✗ PATH blocked by slab L3 placed at step 112` |
| ACCESS | clearance for MEWP / crew / pallet route at install time | `✗ ACCESS 0.6 m < 0.9 m required` |
| CLASH-TEMPORAL | 4D clash: element vs. scaffold/temporary works/other trades at that time | `✗ CLASH duct D-07 vs scaffold S-2 · steps 140–151` |

### 10.3 UI additions (reuse the existing visual language)
- A fourth legend state, **FLAGGED** (amber/red hatch), on the model and on Gantt pills.
- Active Operation gets `CHECKS` rows (✓/✗ per rule) and `CRANE · radius · capacity · utilisation %`.
- Crane overlay: the slew circle, the radius ring at the active element, and a utilisation colour.
- Members tab: a filterable list of every element with its step, checks and issues; click to isolate.
- Export: issue register (CSV/BCF), with the step, element GUID, rule and suggested fix. This is what goes to the design team before tender.

### 10.4 Definition of done (from the companion article)
A run is "done" only when the check suite has executed over the whole sequence and the JSON
summary is attached. A sequence with zero checks matched is reported as **unverified**, not as passing.

---

## 11. Build plan  [D]

| Milestone | Scope | Exit criterion |
|---|---|---|
| M1 Shell | Layout, design tokens, all panels static with sample data | Pixel-compare against reference frames |
| M2 Timeline engine | Event table, transport, scrubber, Gantt, log, counters, stage cards | Seek to any t gives an identical panel state |
| M3 3D core | Instanced parts, ink + fill, ghost, placement animation, auto-rotate, auto-frame, scale | 60 fps at 5.6k parts, 3–4 draws |
| M4 Annotations | Callouts, datum ruler, title block, scale bar | Labels never overlap; correct live AZ/EL/mm |
| M5 Paint and section | Wash shader, coats, clip plane + poché, camera path | Matches frames 07–11 |
| M6 Data in | IFC → elements → steps (IfcOpenShell, Python) | Real model loads |
| M7 Checks | ORDER / REACH / ACCESS / CLASH engine + flags + issue export | Seeded bad sequence produces the expected failures |

---

## 12. Open unknowns
- Contents of the ☰ menu, rail panels 2–7, the Members tab, the download format, the `PG` stamp.
- Exact behaviour of COLOUR / FRAME / VIEW / ⏮⏭.
- Whether the geometry was procedural, and the actual framework and libraries.
- Whether any AI ran at runtime. Nothing visible suggests it.
- Audio content (no transcription tool was available in this session).
