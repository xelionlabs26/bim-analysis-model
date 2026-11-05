# Arbor Build

A browser 4D assembly-sequence viewer for **Arbor House**, an original 32-storey (114.7 m) hybrid
mass-timber residential tower. It builds the tower step by step in install order, as a live
construction drawing. Built with Vite, TypeScript and three.js, with no UI framework.

Hosted (private, share from the page's Share menu): https://claude.ai/artifact/1yPva9DgurUare4n5wF7j5

```bash
npm install
npm run dev              # http://localhost:5173
npm test                 # model, install-order, crane and timeline tests (vitest)
npm run build            # typecheck + production bundle in dist/
npm run build:artifact   # one-page build for the claude.ai host → dist-artifact/arbor-build.html
```

URL parameters for reproducible stills: `?t=12.8&paused=1&rotate=0&az=28&el=16`. The full sequence runs about 29 s: assembly to 18.1 s, material pass to 22.1 s, then the section.

## The building

| Zone | What goes in, in order |
|---|---|
| Site | setting-out, 36 bored CFA piles, 4-pour piled raft, crane base, tower crane TC-1 |
| Podium (L00–L02) | jump-formed concrete core, RC columns and PT slabs, 800 mm transfer deck, lobby glazing, terracotta-finned podium façade |
| Tower (L03–L31) | per floor: glulam columns + beams → prefab bathroom pods → 5-ply CLT slab above; unitised façade with parametric terracotta fins and staggered planted CLT balconies trailing two floors behind; core jumps keep ≥ 2 floors ahead |
| Sky gardens | double-height loggias at L12–13 and L22–23 (south-east corner) with trees |
| Setback | floors L25+ step back one bay on the south side over a planted sky terrace at L24 |
| Crown | lift overrun, green roof, roof trees, glulam PV canopy (32 modules), terracotta crown screen, BMU, street trees |

Context massing (light line work) can be toggled in **Layers**.

## Stages 07–08 (milestone 5)
- **07 Material pass, 4.0 s.** The tower crane is struck first. Then two washes rise up the tower with an uneven, noise-driven front and a warm wet edge. Pass 1 colours the structure (concrete, glulam, CLT, pods); pass 2 colours the envelope and planting (glass, terracotta, bronze, PV, greenery). The log reports each front's height and the share of parts coloured.
- **08 Section A–A, 6.8 s.** A cut plane slides in to x = 9.6 m through the east bay. Opened parts show their inside faces as hatched poché, tinted by material. The camera flies through five shots: the sky garden at L12–L13, bathroom pods in section, the L24 sky terrace, then the crown and PV canopy. Then it pulls back and the section closes before the loop.
- Everything is still a pure function of time, so you can scrub into the middle of the wash or the fly-through. Dragging the view during the fly-through takes the camera over; **X** hands it back.
- **Manual section:** **S** (or **Section** in the rail) cuts the model at any stage. Choose A–A (east bay) or B–B (south bay) and set the offset with the slider.

## What is computed (not authored)
- **Install order rules** are checked in tests: core lead, frame → pods → slab, façade trailing, sky gardens after their façades, crane erected before the first lift.
- **Crane reach check:** every crane-lifted piece is checked against an *indicative* flat-top load chart
  (60 m jib, 12 t to 20 m, 2.4 t at the tip) at its real radius from the mast. Bulk soil is excluded,
  since it goes up in 1 t bags. The check flags two real planning findings:
  - the one-piece CLT entrance canopy at **87 %** (⚠)
  - the **BMU gantry at 9.2 t, about 116 % of chart** at 27 m (✗). Split the lift or bring in a mobile crane.
- **Carbon:** indicative A1–A3 from generic factors (not project EPDs), plus biogenic carbon stored in the
  timber, and intensity per m² GIA. About 5,300 tCO₂e, about 4,700 tCO₂e stored, about 250 kg/m².
- **Log `CHK` lines** per zone: step and part counts, mass, peak lift utilisation and core lead.

## Controls
`Space` play/pause · `←/→` step · `Home` start · `R` rebuild · `A` auto-rotate · `C` material colours ·
`X` re-frame / resume fly-through · `F` speed · `V` view preset · `G` ghost · `K` crane · `S` section · `1–7` rail · `Esc` close drawer.
"Save the sequence as JSON" exports steps, lifts, mass and carbon. In the hosted page this goes through the
viewer's save prompt.

## Limits
- Masses use effective densities for simplified box geometry, so treat totals as order-of-magnitude.
- The poché is drawn from the inside faces of the parts the plane opens. It's exact for these closed boxes, but it's not a true capped section.

## Where things live
`src/data/generator.ts` authors the tower as ordered install steps. `src/data/project.ts` schedules them
and computes mass, carbon and lift checks. `src/engine/timeline.ts` holds the state at time *t*, the crane
state and the log. `src/scene/*` covers instanced rendering, GPU-side animation and the line-work crane.
`src/ui/*` holds the panels and overlays.
