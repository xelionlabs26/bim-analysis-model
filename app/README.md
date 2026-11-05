# Arbor Build

A browser 4D assembly-sequence viewer. It builds a building step by step in install order, as a
live construction drawing: either **Arbor House**, an original 32-storey (114.7 m) hybrid
mass-timber residential tower, or **any IFC model you import** (milestone 6), which it meshes,
sequences, plans a crane for and quantifies on its own. Every sequence is then **checked for
buildability** (milestone 7), and the issues export as BCF for the design team. Built with Vite,
TypeScript and three.js, with no UI framework.

Hosted (private, share from the page's Share menu): https://claude.ai/artifact/1yPva9DgurUare4n5wF7j5

```bash
npm install
npm run dev              # http://localhost:5173
npm test                 # model, install-order, crane, timeline, IFC and buildability tests (vitest)
npm run build            # typecheck + production bundle in dist/
npm run build:artifact   # one-page build for the claude.ai host → dist-artifact/arbor-build.html
```

URL parameters for reproducible stills: `?t=12.8&paused=1&rotate=0&az=28&el=16`, plus `?sample=duplex` to open the IFC sample. The Arbor House sequence runs about 29 s: assembly to 18.1 s, material pass to 22.1 s, then the section.

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

## Import a real IFC (milestone 6)
Open **Import** in the rail (**7** or **I**), drop an `.ifc` file onto the model, or load the bundled
sample: the buildingSMART *Duplex Apartment* (Revit 2011, IFC2x3, CC BY 4.0, see
`public/samples/README.md`). The file is read in the browser and never uploaded.

1. **Read.** A STEP (ISO 10303-21) reader with lazy argument parsing. It handles IFC2x3 and IFC4, SI-prefixed and imperial units, placements, and mapped items (including mirrored ones).
2. **Mesh.** The app's own geometry kernel turns each element's Body representation into a mesh:
   - extrusions of every standard profile, including arcs, voids, and composite and derived profiles;
   - faceted Breps (with voids), surface models, and IFC4 polygonal and triangulated face sets;
   - boolean clips by half-spaces, with polygonal bounded ones applied exactly as convex pieces;
   - openings, cut three ways: holes through slabs, strip-and-band cuts through walls, and cuts across extrusions (a sink through a worktop, a hole through a beam web).

   Winding is repaired shell by shell. The T-junctions earcut leaves at collinear profile points are repaired too.
3. **Sequence.** Elements are banded by storey and ordered by what bears on what: footings first, then the crane, foundation walls and ground slab. Then, level by level, heavy walls and columns go in before the slabs, beams and roofs they carry. Envelope and fit-out trail two bands behind, and doors and windows follow their host wall. A wall counts as structural when something bears on it, because Revit often exports masonry with LoadBearing = false.
4. **Plan the crane.** A tower crane is placed beside the footprint, with its jib sized to reach every lifted piece. Every pick is checked against an indicative load chart at its real radius.
5. **Quantify.** Mass and indicative A1–A3 carbon come from the material layers. Stud and joist layers use framing fill factors, and air gaps carry no material. Biogenic storage is reported too, and intensity uses the slab area.
6. **Present.** The same timeline, panels, material pass and Section A–A as Arbor House, generated from the model's own bounds and storeys.

**The Duplex:**
- 215 elements meshed in about 0.25 s (0.6 s in the page, including the sequence), 165 of them closed solids.
- 41 steps in 5 assembly stages.
- About 450 t and 134 tCO₂e A1–A3, about 260 kg/m² GIA (indicative).

### Checked against IfcOpenShell
`tests/ifc.test.ts` compares every element with IfcOpenShell 0.9 (`ifcopenshell.geom`, world
coordinates). The reference data is in `tests/fixtures/`; regenerate it with `scripts/ifc_reference.py`.
- All 215 Duplex elements and all 18 elements of an IFC4 test pavilion (`scripts/make_pavilion_fixture.py`) are present, and within 1 mm of IfcOpenShell's bounds.
- Volumes agree within 2 % wherever IfcOpenShell's mesh is a closed, consistently wound solid: 98 Duplex elements and 10 pavilion elements. That includes the sink cut across a worktop (0.0743 m³).
- Where IfcOpenShell's mesh isn't a closed solid, volumes are checked by hand instead:
  - the 13 gypsum ceilings equal area × thickness (IfcOpenShell gives 4.09 m³ for a 3.25 m³ board);
  - the surface-model party wall is 25.83 m³ (IfcOpenShell: 123 m³);
  - the pavilion mullions are exact 0.027 m³ boxes.
- 39 openings are cut. The other 9 sit clear of their hosts in the file (Revit placed them a storey down, or mirrored), and the import report says so.
- Synthetic files cover Breps with voids (either winding), separate shells and STEP string escapes.

### IFC limits (each is counted in the import report when it applies)
- Non-convex polygonal bounded half-spaces are applied as unbounded. Boolean differences with a solid, rather than half-space, second operand keep the first operand. Both count as approximated.
- An opening is left uncut, and reported, if none of the three methods fits. Examples: openings in Brep or surface-model hosts, recesses that don't go through, walls with more than 24 profile points.
- Not drawn, and listed: advanced Breps and NURBS surfaces, and sweeps along curves other than swept disks. Swept disks (rails, rebar) are drawn as square tubes. Tapered extrusions use their start profile throughout.
- Densities and carbon factors are generic. Elements with no material get one by type, and the report gives the count.
- Railings, windows and fixtures exported as open surface models get an estimated volume.

## Buildability checks and issues (milestone 7)
Every project is checked as soon as it loads, in about 0.3 s for either sample (the page runs the
checks after its first frame and keeps drawing). Open the **Issues** tab.

| Rule | What it checks |
|---|---|
| ORDER-SUPPORT | Everything that bears on another element is placed after it, or in the same step. Pieces with nothing beneath them are reported too. |
| TEMP-PROPS | A beam or slab placed while only one end is supported needs props until the other support goes in. |
| TEMP-EDGE | Floor and roof edges with a fall of 2 m or more stay open until a wall, glazing or guard at least 950 mm high closes them. The rule reports each open stretch of edge and for how many steps it is open, and flags edges that are never guarded. |
| REACH-CRANE | Every crane pick is within the jib and under the load chart at its radius. Above 85 % it needs a lift plan review. |
| REACH-PATH | A crane pick is lowered from above, so nothing already built may sit over it. |
| CLASH-HARD | Elements may not overlap by more than 10 mm (measured exactly, by ray intervals through both solids). |
| CLASH-TEMP | The crane mast and base keep 1 m clear of the permanent works. |
| ACCESS-HEADROOM | Clear headroom above every stair nosing is at least 2.0 m (UK Approved Document K; the IBC asks for 2.03 m). |
| ACCESS-HANDLING | Pieces set by hand weigh at most 50 kg, a two-person lift. |
| ACCESS-TRANSPORT | Prefabricated pieces fit a standard 13.6 × 2.55 × 3.0 m road load. |
| MODEL-DATA | Gaps in the model that limit the checks go back to the design team. |

Each rule reports how much it evaluated. A rule with nothing to act on reads **unverified**,
never "passed". You can change every threshold under **Rules and thresholds** in the Issues tab
and run the checks again.

**On the Duplex (24 issues):**
- **Window heads into the beams:** the heads of eight Level 2 windows sit 13 mm into the W410X60 steel beams above them, so there is no deflection gap. Four issues, one per beam.
- **Other overlaps:**
  - Level 2 partitions run 84–124 mm into the timber floor structure.
  - Furring walls sit 57 mm into the CMU party wall.
  - Two party-wall junctions are modelled twice (379 L each).
  - One ceiling is duplicated.
  - Door frames run 25 mm into return walls.
  - Glass doors sit 13 mm into the exterior slab.
- **Edge protection:** the stair voids at Level 2 stay open for 8 steps until the guard rails go in. The two rooflight openings stay open for 28 steps until the skylights.
- **Handling:** 22 windows, up to about 840 kg, are too heavy to carry.
- **Model gaps:**
  - 9 openings are placed clear of their hosts.
  - 114 elements have no material.
  - 50 elements are open surfaces.
- **What passes:** both stairs, with at least 2.41 m headroom over 421 nosing points; support order, propping, crane reach, lift paths, crane clearance and transport.

**On Arbor House (21 issues):**
- **Crane capacity:** the BMU gantry is at 116 % of the chart and the entrance canopy at 87 %.
- **Lift paths:** the sky-garden trees cannot be lowered through the floor above, so they need a loading platform. The public-realm benches under the L03 balconies need ground plant.
- **Edge protection:**
  - Perimeter protection on 31 floors while the façade trails (about 108 m per floor).
  - Balcony, sky-garden-void and roof edges have no modelled guarding. The crown's baguettes, 1.75 m apart, are a screen, not a guard.
- **Transport:** 612 CLT floor panels are 3.61 m wide loads, plus long glulam, BMU track and podium fins.
- **What passes:** support order, over 7,100 pieces. Hard clashes are not run on the generated massing, because its boxes overlap by construction, so that rule reads unverified.
- **Generator fixes:** the checks also caught three defects in the generator, now fixed:
  - Two sky-garden corner columns floated 200 mm above the columns below.
  - The PV canopy's inner posts stood over the lift-shaft void, with beams running through the core overrun. The canopy now bears on the overrun.
  - The BMU was lifted in after the PV canopy built over its track.

**Selecting an issue:**
- The timeline seeks to the step where the issue arises.
- The camera looks at it from outside the building.
- Its elements show in x-ray: red at fault, blue what they conflict with or wait for. Its lines (open edges, clearances, lift paths) and a pin are drawn too.
- `[` and `]` step through the issues, and `Esc` clears the selection.

Elements in critical and major issues are hatched **FLAGGED** once they are placed (toggle with **Flags**). Scrubber markers, stage-card counts, Gantt pills and the **CHECKS** row of the active operation show where issues arise.

**Export:**
- **BCF 2.1:** one topic per issue, saved as `.bcfzip`. The hosted page saves it as `.bcf.zip` (rename it if your BCF tool asks). Each topic has:
  - priority, labels, a description and the suggested fix;
  - a viewpoint that selects and colours the IFC elements by GlobalId;
  - the app's camera in IFC world coordinates;
  - the issue's lines, and a 960 × 600 snapshot.

  How it was checked:
  - Every file validates against buildingSMART's BCF 2.1 XSDs.
  - IfcOpenShell's BCF library reads all the topics.
  - Every camera was checked to aim at its elements, using IfcOpenShell geometry.

  Topic GUIDs are stable, so a re-export updates topics instead of duplicating them.
- **CSV:** the issue register, one row per issue: ID, severity, rule, title, detail, action, step, measurement, elements with their GlobalIds, and location.
- **JSON:** the sequence JSON carries the check verdict and the issues. Without them the run is marked unverified.

**Limits of the checks:**
- Support uses element bounds in plan. It catches missing and late supports, not structural adequacy.
- Edges are sampled every 0.5 m, with guards looked for at 0.5 m and 0.9 m. Railings count by their bounds.
- Clash detection skips open-surface elements (most railings and furniture) and generated massing. Finishes laid around other elements, hosted doors and windows, and parts of one assembly are not clashes.
- Masses are estimated from volume and generic densities, the crane chart is indicative, and the road load is a generic one. Check the local rules for each.
- Not modelled yet: MEWP and scaffold access, laydown and delivery routes, and 4D clashes with temporary works other than the crane mast.

## Crane reach overlay
The crane's reach is drawn on the ground, as on a site logistics plan, while the crane stands. `K` hides it along with the crane.
- **Slew circle** (dashed) at the jib's length. A dotted circle marks where full chart capacity ends (20 m on Arbor House; a third of the jib on imported models). A fine dashed circle marks the counter-jib's tail swing.
- **Pick ring** at the radius of the current lift's critical piece, with a line from the mast to a marker on that piece. It follows the active operation and eases to the next radius as the jib slews. Between lifts it fades.
- **Colour** shows the pick's utilisation against the chart at that radius: green within the chart, amber from the lift-plan review threshold, red over the chart. The ring, its label, the operation panel and the REACH-CRANE check all read a pick the same way: the same threshold (85 % by default) and the same rigging allowance (0 kg by default). Both are set under Issues ▸ Rules and thresholds.
- **Labels** hang from the circles. The reach label (jib, chart, tail) sits on the side nearest the viewer. The pick label (radius, piece mass against capacity, utilisation) sits at the piece's bearing. Each slides round its circle to stay clear of the toolbar, caption, title block, scale bar, scrubber and transport, and to cover as little of the other annotation as it can.

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
`X` re-frame / resume fly-through · `F` speed · `V` view preset · `G` ghost · `K` crane · `S` section · `1–7` rail · `I` import IFC · `[` / `]` previous / next issue · `Esc` clear the issue, then close the drawer.
"Save the sequence as JSON" exports steps, lifts, mass and carbon (with each element's IFC GlobalId for imported models). In the hosted page this goes through the
viewer's save prompt.

## Limits
- Arbor House masses use effective densities for simplified box geometry, so treat its totals as order-of-magnitude.
- The poché is drawn from the inside faces of the parts the plane opens. It's exact for closed solids, but it's not a true capped section.

## Where things live
`src/data/generator.ts` authors the tower as ordered install steps. `src/data/assemble.ts` schedules any
project's steps and computes mass, carbon and lift checks; `src/data/project.ts` configures Arbor House.
`src/ifc/step.ts` reads STEP files, `src/ifc/geometry.ts` is the IFC geometry kernel, `src/ifc/model.ts`
extracts elements, storeys, materials and properties, and `src/ifc/sequence.ts` turns them into a project.
`src/engine/timeline.ts` holds the state at time *t*, the crane state and the log; `src/engine/presentation.ts`
drives the material pass and the section. `src/scene/*` covers instanced and merged-mesh rendering, GPU-side
animation, the line-work crane, its reach overlay (`reach.ts`) and the issue highlight. `src/ui/*` holds the panels and overlays. `src/checks/*`
holds the buildability rules (`rules.ts`), their geometry (`scene.ts`, exact rays against boxes and meshes)
and the runner; `src/export/*` writes ZIP, BCF 2.1 and CSV; `src/ui/issues.ts` is the Issues tab.
