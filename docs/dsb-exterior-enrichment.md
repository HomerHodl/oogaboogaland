# DSB Land exterior enrichment

Checkpoint: `03bc3c55149595240ac9ecd6db8ecedef3b08780` — Add Maxis Club media theater.

This is additive scenery on the approved heightfield. `dsb-geography.js`, water,
weather, daylight, nature placement, all interiors, and the Noderunner controller
are unchanged. The scene owns one additional dressing group, updates it only
outside, and disposes it on leaving DSB. No inputs, audio, requests, listeners,
timers, collision engine, dependencies, or multiplayer were added.

## Concept translation

The four approved references drive flowering Cycladic facades, blue shutters,
shaded terraces, fishing-port details, a sandy front shore and a small eastern
ruin overlook. The existing island silhouette, building spacing, terrain and
road positions remain intact; the steeper, densely stacked town in the concept
is not substituted for this approved geography. These are OogaBoogaLand block
models, not photorealistic reproductions.

- Chora: 186 flower boxes, 62 flowering vines, 62 rear shuttered windows,
  124 warm window panes, seven rooftop pergola/table groups, courtyard planters,
  benches, olives and agaves. Facade additions avoid existing venue signs/doors.
- Harbor: three decorative moored caiques, 16 pier posts, 16 fenders, 12 rope
  spans, fishing crates, nets, barrels and coils. Piers retain their centre lanes;
  Noderunner's equipment, terrace and walking approach are reserved.
- Beach: 295 sand/wet-sand triangles follow the original terrain with a 16 mm
  visual offset, four straw parasols, five loungers, two shaded table areas,
  individually terrain-seated canopy posts, and driftwood. The approach skirts
  the existing central coastal inlet. No beach is added behind Olympus.
- Ruins: two fluted standing columns with broken lintels, two broken columns,
  fragments, plants and small lanterns on the eastern shelf. An open approach
  joins the existing Chora district; no archaeological park or terrain platform.
- Rocky coast: seven deeply seated shoreline outcrops plus small rocks, agaves,
  herbs and grass. Land props conform to terrain, with upright trees/columns.
- Trail/clearing: nine cypress and low stone/herb framing in accepted pockets,
  leaving the summit, trail width, clearing centre and Chora sightline open.
- 568 flush stone insets enrich existing streets and the ruin approach. They
  do not modify movement/support heights. Small wayfinding boards use free pockets.

All outdoor chairs/boats are dressing; this milestone adds no seating or boat
interaction. Existing interior seating remains the only seating gameplay.

## Rendering and shoreline

`dressing-coastal.js` extends the existing shared `BL.dressing` kit with cached
opaque geometry. `dsb-enrichment.js` places fixed-capacity instanced fields.
Repeated props share geometry; leaf geometry has a simpler cached low-tier form.
Small plants and paving thin by tier, and small plants cull by camera distance.
Large architectural landmarks stay present at low quality.

At a full-island inspection position the new layer displays 1,779 / 1,392 / 1,198
instances at high / medium / low. There are 40 instanced/surface batches, plus
small wayfinding meshes. Low-tier flower/vine geometry also removes two thirds
of their foliage blocks. No new real lights, transparent effects, textures or
render targets. Lantern/window emissive intensity is quantized and written to
the renderer's existing per-instance glow field only when the dusk factor changes.

211 bounded foam segments follow the existing mean-water contour and selected
rock contacts. They are discontinuous opaque ribbons, with a small 6 Hz width
variation on high/medium and static presentation on low/Canvas. This is a visual
shoreline layer, not a tide, flood, wave-physics or water-engine replacement.
The approved water's two textures, spectrum and shader are unchanged.

## Review views

Use the named file `/oogaboogaland/dsb-preview/index.html` (the existing router
normalizes a bare directory differently), with `scene=dsb&debug=1&nosim=1&chain=0&oogatron=0`.

- `view=coastal-overview`
- `view=coastal-chora`
- `view=coastal-harbor`
- `view=coastal-beach`
- `view=coastal-ruins`
- `view=coastal-trail`

Append `day=80&time=1200&weather=clear`, `time=1730`, `time=2200`, or
`weather=storm` using the existing daylight/weather debug controls. Normal play
still begins at Portara. Review views are free camera presets; Walk resumes
Yellow's actual position. Quality remains governed by the existing renderer.

## Verification and limitations

`node test/run.mjs exterior-unit` checks real transformed ground contacts,
finite geometry, complete corridor bounds, the real Yellow body size and actual
land walkability, byte-identical original terrain, no rear beach, tiered buffers,
rendered emissive attributes and repeated disposal/rebuild. The initial run found
an approach crossing an inlet and two deeply inset rope coils; both were fixed.
`node test/run.mjs maxis-unit` additionally checks all existing Maxis seating and
media rules. Build, changed-JavaScript syntax and whitespace checks also pass.

Pre-publish visual inspection uses the project's actual Canvas renderer at noon,
late day, night, storm and low quality, covering overview, Chora, harbor, beach,
ruins and trail. Work's browser blocks the local preview URL. Canvas has existing
painter-order limitations around the large water tiles and building faces; it
cannot establish WebGL water/foam/bloom quality or hardware performance.

Required device checks: WebGL coastline/foam appearance, the seven deployed
review views, Pixel/Android frame rate and touch walking, real street/door/harbor
approaches, and extended renderer/GPU memory after scene re-entry. CPU scene
cleanup and stable instance buffers are tested; actual long-run GPU residency
and device FPS are not certified here. The unrelated baseline global-suite
failures documented in `dsb-master-layout.md` were not rerun or changed.
