# Arbor Build

A browser 4D assembly-sequence viewer. It builds a building step by step in install order, as a
live construction drawing: either **Arbor House**, an original 32-storey (114.7 m) hybrid
mass-timber residential tower, or **any IFC model you import** (milestone 6), which it meshes,
sequences, plans a crane for and quantifies on its own. Built with Vite, TypeScript and three.js,
with no UI framework.

Hosted (private, share from the page's Share menu): https://claude.ai/artifact/1yPva9DgurUare4n5wF7j5

```bash
npm install
npm run dev              # http://localhost:5173
npm test                 # model, install-order, crane, timeline and IFC tests (vitest)
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
`X` re-frame / resume fly-through · `F` speed · `V` view preset · `G` ghost · `K` crane · `S` section · `1–7` rail · `I` import IFC · `Esc` close drawer.
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
animation and the line-work crane. `src/ui/*` holds the panels and overlays.
