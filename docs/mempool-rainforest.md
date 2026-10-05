# Mempool rainforest (issue #140): design and verification notes

**Status: feature complete, not yet play-tested.** The build is clean, the unit tier passes (125/125), the `hub` scene's last full run passed 268 of 269 checks and the first `npm run test:full` passed 718 of 721; what does not pass is a time limit and this machine's known perf floor, described under Verification. It has been looked at in headless screenshots and driven by scripted probes, never played by a person, so play-testing and tuning come next.

Issue: https://github.com/OogaBoogaX/oogaboogaland/issues/140. Its five images are a world screenshot, two dimensioned plans (the plans govern layout) and two approximate concepts.

## What is built

- **`src/js/pool-layout.js`** (new, pure, loads in Node): the one layout. Local frame: origin at the island centre, y = 0 at the bridge's top datum (world y about 6.27), +z toward the home island, a bearing from +z toward +x. `SITE.isletR = 22` puts the centre 67.5 m out through the unchanged `spot()`. Terraces half a metre apart: court and shore 0, lowland ring 0.5, forest floor and ring path 1.0, nests 1.5, ridge to 4.5, channel beds -0.5. Lake hole r < 8 over a cosine membrane (0 at the rim, -4 at the centre), chamber r < 12 at floor -10 with four flat reading stops, shaft r < 4 through the underside, descent at r = 16 (5 m wide, 6 m in three bays, 3.5 m headroom, 100 m, 10%) from bearing 22 degrees under a ridge, an outside ledge to doors at -3 and -5, a window over the chamber at 75%, and the plan's two links (`LINKS`): A from 56% to 66% of the descent and B from 81% to 91%, each a mouth through the outer wall, a gallery cut into the cliff's face behind a 1.5 m pier of rock and open to the sea, and a second mouth back in. `sightClear`, `boxSolid` and `boxClear` are exact walks of the grid for the outlines. `body()` fills a 108 x 68 x 108 grid of 0.5 m cells once a page.
- **`src/js/pool-models.js`**: `islet` (the grid through the home island's `terrain.gridGeometry` and `compactVertices`; the grid is also its `cutawaySource`; about 10.7k quads; the wall behind each painting is cut into metre squares of twin tones, same colour under a second material number, so the Canvas 2D renderer can sort the paint against it), `rampFloor` (smooth floors, `supportOnly` faces; through a link the descent's own surface is carried out to the cliff or to the lip beyond it), `chamberBacking` (171 quads a little inside the rock behind the chamber's floor, wall and roof, so the pinholes where the mesher's faces meet at a T show dark rock and not the sky; it is clipped by the cut-away like everything else and drawn first on Canvas 2D), `membrane` (glass; collides as a thin closed shell), `crossing`, `NEST_BEDS`, `wallTorch`, `VEINS`, `roots`, new `build`. Old cave pieces removed.
- **`src/js/pool-water.js`** (new): level from `snapshot.vsize` through `HYDRO.POINTS`; bounded easing; three stages with hysteresis; lake disc, flood sheet, falls, veins, block cube (two pooled sequences, queue of three).
- **`src/js/pool-paintings.js`** (new): four wall paintings with per-category freshness and a dialog board each.
- **`src/js/weather.js`**: rain, cloud and sky follow arriving volume; smoothing, expiry by socket age, a footprint for the larger island, shelter under its ground.
- **`src/js/clankers.js`**: the sleep lifecycle (`updateSleep`, `updateWake`, `reserveBed`): a gorilla whose Ooga sleeps reserves a bed, walks hub -> approach stair -> bridge -> court -> ring path -> nest, lies down, breathes and marks sleep, and walks home when its Ooga wakes. Sleepers found asleep at page entry are placed in bed. Possession wakes it; release while its Ooga sleeps walks it back. Sleep follows `crew.stateOf(cave)` (the override, else the contribution age), not the momentary `cave.state`, which flips when a sleeper stirs for a donation or a fire: keyed to that, every gorilla commuted over the bridge at each donation. A sleeper inside the lab frees its bench at once and then walks out; the walk home ends in the meadow below the approach stair, not at the bridge's head.
- **`src/js/scene-hub.js`**: new `buildMempoolIsland` and its handle (`groundAt`, `overAt`, `coveredAt`, `floatAt`, `water`, `paintings`, `layout`, `preview`); floating support for Oogas and gorillas; `navigate("mempool")`; pool-aware camera (`belowHome`), cutaway and voice zone (`cave-mempool`); daylight dimmed and weather sheltered underground; the weather key board rewritten with a lake page; `clankerBeds()` (beds and paths); the walker's rim through this island's rock (`poolSeam`, below).
- **`src/js/agent.js`**: a gorilla afloat dog-paddles (`SWIM`, `motion.swim`): forearms reaching forward and down in turn on a two-second cycle, hind legs trailing, chest level, blended in and out by the rig's own damping so nothing is left over on land.
- **`src/js/crew.js`**: the HQ exit route on release starts only over the home island (`ctx.underHome`).
- **Retired:** `scene-pool.js`; `/mempool` is now `scene: "hub", place: "mempool"`. `index.html`, `routes.js`, `scripts/cards.mjs` (the live route is keyed by its path, and its card waits out the first donation toast), `AGENTS.md`, `README.md`, `chain.js` comments and the director's feed panel updated to match.
- **Tests (`test/run.mjs`):** pool scene registrations removed; `hubRoutes` now walks an Ooga down the whole descent into the chamber and then reads the walker's rim through the chamber wall; Node rule checks `pool layout` (the descent; both links walked out through one mouth, along the gallery and back through the other with floor under and rock over every station; the beds; the lake; the sight queries) and `pool water` (which also holds that a channel past the cliff carries no level); `weather steps` reworded.

## Tuning constants chosen

| Constant | Value | Where |
|---|---|---|
| Lake level points | 0 vB -> -3 m, 20 MvB -> -1 m, 60 MvB -> 0 m (spill crest), 200 MvB -> +0.6 m | `poolWater.HYDRO.POINTS` |
| Level easing | 5 s time constant, at most 0.16 m/s | `HYDRO.EASE`, `HYDRO.RATE` |
| Flood stage hysteresis | shore on at +0.04, off at -0.04; lowland on at +0.54, off at +0.46 | `HYDRO.STAGE` |
| Backlog reading counts as live for | 120 s | `HYDRO.FRESH_MS` |
| Storm average, arrivals expiry | 30 s, 90 s | `weather.STORM_TAU`, `ARRIVALS_FRESH_MS` |
| Rain field, cloud deck, strike range | 25 m, 34 m, 21 m | `weather.js` |
| Cube sequence | gather 1.6 s, bulge 1.7 s, hang 1.5 s, slow fall 3.2 s, then to the sea | `poolWater.CUBE` |
| Float draught | Ooga 0.55 x body height, gorilla 0.9 m | `scene-hub.js` |
| Beds | 20 (4 on each of 5 nests) for a roster of 16 | `poolLayout.SLOTS` |
| Bed choice | dealt once a UTC day by `fnv1a` of day, name and bed, in roster order | `clankers.js` `bedsToday` |
| Sleep trip stall fallback | 25 s | `clankers.js` `SLEEP_STALL` |
| Links A and B | 56% to 65.76% and 81% to 91% of the descent; pier 1.5 m, headroom 3 m, mouths 3.5 m, floor lip 2 m and 2.75 m past the cliff | `poolLayout.LINK`, `LINKS` |
| Gorilla paddle | 3.2 rad/s, reach 0.28, stroke 0.26, legs 0.45 with kick 0.12 | `agent.js` `SWIM` |
| Underground lamps count as lights | only for a view under the island's ground or following a walker who is; a tunnel torch within 6 m past its radius, the chamber's set within 16.5 m of the room's middle, each fading over its last metres | `scene-hub.js` `LAMP_REACH`, `ROOM`, `poolShade`, `poolUnder` |

## Verification actually performed

- `npm run build` clean; `node --check` on every touched file.
- `npm run test:unit`: 125/125, including two new rule checks: `pool layout` (the descent's grade, headroom and roof; beds above the flood and apart; the lake inside its membrane) and `pool water` (the level scale, flood stages, stale hold, the cube queue).
- Node probes with the real collision code (`solid-props.js`): bridge -> court -> mouth -> 100 m descent -> chamber and back, ledge -> both doors -> descent, the full ring path for an Ooga and a gorilla-sized body, every nest, the chamber ring, the ridge top and out of the lake's bowl in four directions all walk; the membrane holds.
- Headless Chrome probes and screenshots (M1 Pro, busy machine):
  - The hub boots with no console errors, about 350 ms slower than `rock` (5.5 s against 5.15 s to ready; `rock` already starts at medium quality there).
  - Views checked by eye: overview, court and signs, ring path and a nest, a tunnel with torch, veins and a door, the chamber with membrane and cube, all four paintings with the issue's snapshot values, a full flood with falls, a downpour from the bridge, an Ooga floating.
  - `?view=mempool` arrives on the chamber floor facing the first painting; the area label reads MEMPOOL.
  - An Ooga in the lake floats with feet at level minus draught, treads water, and walks out to the ring path in a second.
  - A gorilla's support in the lake is level minus 0.9 m from above and at float, one step of lift from the bed, the chamber floor under the lake, and the shore at its own height.
  - Nine sleepers are in beds at entry. A working gorilla put to sleep leaves its cave and reaches its bed in 42 s; one on a roof climbs down and arrives in 46 s; a sleeper woken walks home in 20 s; a sleeper possessed keeps its bed and, released, goes back to it.
  - A tap on a painting opens its board.
  - Both links walked with the real collision code, down and up, as an Ooga and as a gorilla-sized body (0.85 m by 2.2 m): 31 m each, largest step 0.012 m, lowest ceiling 2.86 m; seen from outside, A is a gallery between two waterfalls.
  - A gorilla placed in the lake reads `motion.swim` 1 and paddles (arms between -1.54 and -1.02 in turn, legs trailing, the body still measuring compact) at level minus 0.9 m; one on the home island reads 0.
  - The walker's rim: with the view in the chamber and the walker in the tunnel behind its wall, and with the walker in a gallery behind its pier, the rim is drawn; from behind in the tunnel, from inside the rock and from above under the roof cut it is not.
  - With the island's rock out of the outline registry the hub is ready in 4.9 s where it took 5.7 s (unchanged `rock` about 5.2 s on this machine).
  - In a downpour, streaks fall over the court, the lake, the channels and the paths and end on the crowns elsewhere; the sleepers under the crowns stay out of it.
  - From the chamber, an Ooga floating in the lake at 45 MvB shows through the skin and the water, with the clouds and the canopy behind it; from above, the bowl and the paintings below show through the lake.
- `LANES=3 npm test -- hub`, last full run (on the final code, links, outlines and paddle included): **268/269**.
  - **`birds-eye lower floors`** fails every run here: "Runtime.evaluate got no reply in 90 s", no assertion. On unchanged `rock` on the same machine that session passes in 88 s against the 90 s limit; a birds-eye frame in the HQ basement profiles about 3.5% slower with the island (more nodes to walk), which is enough. It has printed STOP, so it is handed to the maintainer with `untracked/test-ledger.json`; it wants a run on a machine with headroom, not a change. `birds-eye combat camera` sits near its 120 s session limit for the same reason and passes on retry.
  - **`work movement cave trips`** failed once, in the full run before that one (266/268): of five workers on the home island, one (portlandhodl) made a single avoidance hop (`jumps: 1`, a 0.28 m step) where the check allows none. Nothing changed since the runs it passed in touches walking (the changes were colours, a depth bias and a hidden backing mesh), and its session run again alone (`ONLY="work movement cave trips" LANES=3 npm test -- hub`) passed, as did the next full run. The crew draws some choices from the crypto dice, so trips differ run to run; treat it as intermittent and watch it. It passed in the seven full runs before.
  - Because the gorilla rig (`agent.js`) is shared, one run took the hub with `lab`, `race`, `drop`, `orbit`, `factory` and `arcade`: 375 of 378. Besides the time limit above, `hub ak` (the burst's bananas missed the barrel once) and `factory lifecycle` (travel back to the hub did not settle in time) failed under that load; `hub ak` passed run again alone and in the next full hub run, and the `factory` scene passed alone on this branch (162/162) and on `rock`.
  - One earlier run was lost to the machine: Chrome hung in every session (driver timeouts, no assertion), as it then did on `rock`'s own page, until the machine was restarted. Those timeouts cleared in the runs since.
- Fixed during the session after the suite caught them: `rainforest approach` (gorillas commuting over the bridge at each donation), `lab work` (its sleeper now frees its bench at once; the check counts coworkers and no longer the gorilla walking out to bed).
- Canvas 2D (`?canvas2d=1`), in screenshots: the court and the flooded lake, the chamber with the lake seen through the membrane, and all of a painting's rows in front of its wall (the paintings carry `depthBias` and their walls are cut small for that renderer's depth sort).
- `npm run test:perf` (M1 Pro, 1920x1080 at twice the pixel density, this branch and unchanged `rock` run alternately):
  - **Ordinary movement passes**: 59.8 to 60.0 fps at high quality, as `rock` does (59.4 to 60.0).
  - **Moving behind cave walls during a donation fails on this machine on both alike**: 31 to 36 fps here, 32.5 to 33.7 on `rock`, the 2D overlay taking about 40 ms a frame at that size. It is this machine's limit and it has printed STOP; it wants the maintainer's machine.
  - **It found a real regression, now fixed.** The island's thirteen tunnel and chamber lamps burn always and counted as point lights from anywhere, so at noon the home island drew fourteen lights where `rock` draws one; every pixel pays for each light, and the ordinary pass ran at 52.6 fps after the page had dropped itself to low quality. Each such lamp now counts only for a view under the island's ground (`poolShade`) or one following a walker who is, the roof cut open over them (`poolUnder`), and fades out by distance: a tunnel torch over the last 6 m of its reach, and the chamber's four torches and the lake's light together as one room's, lit from anywhere in the chamber and fading as the view backs out through the junction. The open air's lamps fade out under the ground (`updateLamps` in `scene-hub.js`). Counted on this machine at noon: one light on the home island, seven at a painting, six at the foot of the descent, two in the upper tunnel.
  - Standing on the island at the same size and high quality, on this machine: the ring path among the trees and the middle of the descent hold 60 fps; the court looking back over both islands runs at 51 to 55 and the chamber at about 52 (six lights), where the governor steps down a tier. The island is 481k triangles in 309 nodes: 308k in 39 canopy trees, 117k in 100 undergrowth plants.
- An independent review of the last change set (four reviewers, each finding checked by a second who tried to refute it) found the gorilla rig sound and confirmed five things, all fixed: the island's edge test had lost its ledge guard when the lips were added; chamber torches switched off across the room and popped back on; the underground lamps went dark from an eye above ground looking down through the roof cut; and the links clause and the water check could not fail on a broken link or on the flood fix.
- Re-run on the review commit (`39292f0`), after the machine's restart settled: `npm run build` clean; `npm run test:unit` 125/125; `LANES=3 npm test -- hub` 268/269 in 6.3 min, again only `birds-eye lower floors` (the same driver time limit); and the first `npm run test:full` on this branch, **718/721** in 13.7 min. Its three failures were the two STOPs above and `wall movement performance: ordinary movement` at 33.8 fps, taken while the just-restarted machine was still churning (Spotlight's `hybridsearchd` and WindowServer over 50% CPU each, load average past 40); `npm run test:perf` in a quiet window right after passed ordinary movement at 60.0 fps at high quality with a clean console, so that failure was the load, not the code. The covered-wall donation check failed in the same quiet windows at 31.0 and 32.2 fps, as it does on `rock` here; its STOP stands.
- Not done: a person playing it, a real phone, two signed-in pages together.

## Known limits and things to play-test

1. **Seen only in headless screenshots** (the overview, the court, the ring path, a nest, a tunnel, the chamber, the paintings with the issue's snapshot values, a flood, a storm, the cube), never played by a person. Colours, forest density, torch light and the glass alphas (membrane 0.18, water 0.5) have had one pass. The lake's skin is one near-clear tone in faint rings with a pale rim, and its surface three close blues (`poolWater` `CALM`), so the chamber looks up through water at the sky, the canopy and whoever floats there, not at a checkerboard; the falls, veins and cube keep the full Bifrost palette.
2. A gorilla that starts its sleep trip on high ground climbs or hops down and walks; where it cannot find a way within 25 s (one roof in the probes) it is placed in its bed.
3. **Beds are not sent over the network**, and do not need to be: each day's beds are dealt from the roster's names alone (`bedsToday` in `clankers.js`), so every page computes the same bed for the same gorilla. Two pages can still differ for a moment around midnight UTC, or in where a gorilla is along its walk, since each page walks its own gorillas as it always has.
4. Tunnel **walls are voxel**, like the rest of the island; only the floors are smooth.
5. The tunnel network: two routes from the court, the descent inside the rock and the ledge outside the cliff, joined by the doors at -3 and -5; the window over the chamber at the third bay; and the plan's links A and B in the lower half, each leaving the descent by a mouth and rejoining it 10 m on by another, round a pier, along a gallery cut into the cliff and open to the sea (A's mouths stand behind two of the waterfalls). They are galleries and not walled tunnels because the shell is too thin: a walled passage beside the descent needs 5 m of rock and the cliff leaves 2.6 to 4.3 m. Walking off a gallery's lip is the ordinary fall off the island. A gallery counts as under the rock all the way out to its lip (`covered`), so daylight, the weather and the roof cut do not change with each step along it. The flood stands only where the ground is at least the channels' bed (`levelAt` in `pool-water.js`): it used to answer the flood's level past the cliff along a fall, in the air and over a ledge, where it would have lifted a walker toward it; a swimmer carried over a fall's lip now falls, as off any edge. Three independent designs were prototyped and judged (these galleries, open balconies through four more doors, and a level gallery from the foot of the descent to a second arch into the chamber); the galleries follow the drawing most closely.
6. At low water the membrane's rim is a **transparent bank** that walkers stand on.
7. Rain lands on the dense middle of every tree crown (`rainAt` in `buildMempoolIsland`, a dome per crown over the layout's grid), on the ground between the trees, and on the water. A crown's outer fifth lets drops through. About half the forest floor outside the ring path is under a crown.
8. The swim pose is minimal: a floating Ooga treads water with its arms out (`floatPose` in `scene-hub.js`, local, crew and remote bodies alike), and a floating gorilla dog-paddles (`SWIM` in `agent.js`). The gorilla's forearms work under the surface, so what shows above it is the shoulders and the back; the reach could not be larger without the body measuring wider than its walking footprint.
9. **Outlines.** A walker under this island's rock is drawn through it as a rim, as on the home island, whenever the view stands in open air and rock wholly hides them: from the chamber through its wall, from the descent through a gallery's pier, and under a roof cut from a low view. The island's rock answers through the layout's own grid (`poolSeam` in `scene-hub.js`, asked only for the walker's own rim) and is no longer baked into the outline registry, which took most of the island's share of the boot. Left out on purpose: the full outline pass over this island (it is one owner in the registry, crowns and all, and too dear a frame), so no outlines of other bodies or of the tunnel's own shape; no rim from an eye that is itself inside the rock, which sees the walker through undrawn back faces; and no stone cap there, which would black out the follow camera in the tunnel.
10. The epoch painting says its age is unknown, because the snapshot has no stamp for it.
11. The `mempool` preview card was retaken (`npm run cards`, keeping only `cards/mempool.jpg`): the chamber's WAITING painting with that moment's live readings. Its route keeps the feeds on and the hub shows the simulator's donations, so `scripts/cards.mjs` now waits the first donation's toast and ticker out before it takes a live route's card.

## Previews (under `?debug=1`)

```js
__ooga.poolIsland.preview.lake(130)   // stand the lake at 130 MvB (floods); lake(null) hands it back to the feed
__ooga.poolIsland.preview.block()     // a block: the bolt and the cube
__ooga.poolIsland.preview.sleep("portlandhodl", true)   // put an Ooga to sleep: its gorilla walks to bed; false wakes it
```

`?debug=1&view=mempool` arrives in the chamber.

## Probe loader

The probes were throwaway scripts kept outside the repository. To recreate one, run the classic scripts in a `vm` context with a `window` stub, in `index.html` order:

```js
import { readFileSync } from "node:fs";
import { runInContext, createContext } from "node:vm";
export const load = (files) => {
  const window = { BL: {}, matchMedia: () => ({ matches: false }), addEventListener() {} };
  window.window = window;
  const ctx = createContext({ window, console, performance, Math, Float32Array, Float64Array, Uint8Array, Uint32Array, Int16Array, Int32Array, Uint16Array, Map, Set, WeakMap, Object, Array, Number, String, JSON, Date, Infinity, NaN, isFinite, parseInt, parseFloat, crypto: globalThis.crypto, document: { createElement: () => ({ getContext: () => null }) }, navigator: {}, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout });
  for (const f of files) runInContext(readFileSync(`src/js/${f}.js`, "utf8"), ctx, { filename: f + ".js" });
  return window.BL;
};
// e.g. load(["math", "scene", "models", "convex", "terrain", "hub-models", "pool-layout", "pool-models", "pool-water", "solid-props"])
```
