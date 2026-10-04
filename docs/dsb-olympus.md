# DSB Olympus: the dressed mountain

Checkpoint: `b3398ff` — Add Stackchain Magazine interior.

Olympus was a smooth cone with planting on it. It now carries rock, farmed terraces, a dressed trail, a stream with a
waterfall, and two windmills. The heightfield, the trail, the Portara and everything within 20 m of the summit are
untouched. No chapel.

## What is on it

- **Crags and cliff bands.** Six voxel rock shapes placed along four contours (12, 20, 28 and 31.5 m) and on any bank
  steeper than the terrain can show as grass. About 127 placed.
- **Terraces.** Dry-stone walls with a soil bed behind them on nine contours from 7.5 to 27.5 m, on the side facing
  the town. About 126 wall runs and 125 crops: olives, vines on trellises, herbs.
- **The sacred way.** The existing trail gets stone steps where it is steep (112), a low wall or rope posts on the
  drop side, ten lanterns that light with the island's lamps, three wayside shrines, and a lookout with a bench and a
  signpost at the first switchback.
- **Spring and waterfall.** A kerbed spring at (−32, −31) feeds a stream that runs down to the sea in five falls with
  pools and foam. It uses the renderer's existing animated water faces. The trail crosses it twice on arched stone
  bridges.
- **Windmills.** Two, at (−14, −58) and (−24, −66), on the back of the mountain away from the trail. The sails turn.

## How it sits in the scene

`dsb-olympus.js` (`BL.dsbOlympus`) owns all of it as one group under the exterior. `create` reads the placements the
nature, detail and enrichment layers expose and keeps clear of them, of every lot and lane, and of the trail.

`scene-dsb.js` reaches it through one-line hooks: create after the town; `olympus.update(dt, lampFactor)` beside the
detail layer's; `olympus.clearSegment(...)` joined to the town's in the walk's collision test, so walls, crags,
shrines, mills and bridge parapets are solid; `olympus.supportAt(x, z, ground)` in `groundAt`, so the bridges are
walked over; dispose in `leave`. `__ooga.dsb.olympus` carries `stats` and `bridges`.

`BL.dsbOlympus.reserved(x, z, r)` is true in the stream's course and on the mill footings. The planting layers run
exactly as they did before this layer existed. Once the mountain is built it calls `nature.rehome(reserved, room)` and
`enrichment.rehome(reserved, room)`: each plant or ground piece standing in a reserved spot moves to ground
close by that is free of the other layers' props and of every wall and crag here, and keeps its index in its layer's
lists. 145 nature plants (grass, meadow, shrubs, rocks, ground cover, two cypresses) and four enrichment pieces move;
the other 10,684 plants and 1,897 pieces stand where they stood, and both totals are unchanged.

Quality: rocks, crops and small stones carry a tier and are hidden at lower quality (844 nodes visible at high, 787
at medium, 574 at low). The module adds about 218,000 triangles in 32 geometries at high.

One rock of the detail layer still stands at the stream's mouth. That layer was left alone.

## Checked

Headless, on the built page. WebGL: every trail segment and every door approach walkable for a body 0.7 m in radius
(0 of 40 and 0 of 44 blocked); no plants in the stream; the walker crosses the first bridge with the real keys and is
lifted 0.95 m at its crown; a terrace wall and a mill stop the walker; the three quality tiers; two re-entries with
identical node, geometry, GPU record and target counts; no page errors. Canvas 2D boots and paints. Unit targets
`exterior-unit`, `big-unit`, `maxis-unit`, `ink-unit`, `rulers-unit`, `stackchain-unit` and `dsb-menus-unit` pass.

In Node, against the layers built without this one: the nature, detail and enrichment placements are identical entry
for entry except the 149 that move, and every instance row matches its placement.

Not run: the browser suite, and any real GPU or phone, so frame rate on a device is unmeasured.
