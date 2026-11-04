# Pagoda Build: milestones M1–M3

A browser 4D assembly-sequence viewer, rebuilt from the reference recording
(see `../docs/SPEC_reverse_engineered_pagoda_build.md`). Built with Vite, TypeScript and three.js.
There's no UI framework.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # sequence/timeline unit tests (vitest)
npm run build      # typecheck + production bundle in dist/
```

URL parameters for reproducible stills: `?t=5.0&paused=1&rotate=0&az=211&el=19`.

## What's in this build

| Milestone | Scope | Where |
|---|---|---|
| **M1 Shell** | Header (wordmark, mini elevation, section bubble, north arrow, register), status card with live clock, 7-item rail with drawers (Layers / Render / Settings / Language), GPU HUD, viewport toolbar, caption, title block, scale bar, transport, Build Sequence panel, stage strip | `index.html`, `src/styles.css`, `src/ui/*` |
| **M2 Timeline engine** | Deterministic state = f(t): seek, scrub, speed ×1/×2/×4, rebuild, loop; Gantt with per-step pills, active-operation card, structure pyramid, streaming build log, live-rendered stage thumbnails, Members tab with filter and click-to-seek, JSON export | `src/engine/*`, `src/ui/panels.ts` |
| **M3 3D core** | Procedural 191-step pagoda (5,707 parts); one instanced draw for parts, one for the ghost, one for the site grid; GPU-side placement (drop, ease-out, active red → placed ink), screen-space ink edges, auto-rotate, auto-framing, live drawing scale, 3D callouts with leaders, level datum ruler | `src/data/*`, `src/scene/*`, `src/ui/overlays.ts` |

Keyboard: `Space` play/pause · `←/→` step · `Home` start · `R` rebuild · `A` auto-rotate · `C` colour ·
`X` re-frame · `F` speed · `V` view preset · `G` ghost · `1–7` rail · `Esc` close drawer.

## Deliberately not in this build
- **Stages 07 Lacquer and 08 Section A–A** (paint wash, cut plane, fly-through camera) are milestone **M5**.
  They're shown in the UI, greyed out and labelled M5. The sequence currently runs 15.2 s and the full design is 25 s.
- The SECTION control and rail item are disabled for the same reason. There's no soundtrack, so "Muted" is inert.
- The `CHK` log lines are **computed** from the model data: step and part counts plus mass per tier. Unlike the
  reference, they make no plumb or level claims. Real constructability checks (order, reach, access, clash) are milestone M7.

## How the data is made
`src/data/generator.ts` authors the pagoda as ordered install steps out of oriented boxes. Each side-specific
element is built for the south face and rotated for E/N/W. Step counts per tier follow the reference
(19 / 43 / 29 / 29 / 29 / 28 / 14 = 191). Overall height (37.54 m) is derived from the geometry.
Mass is volume × material density. `src/data/project.ts` schedules steps into the stage windows and staggers
the parts within each step.
