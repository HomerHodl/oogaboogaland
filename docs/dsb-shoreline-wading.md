# Aegean shoreline, wading and waterfall interaction

Starting checkpoint: `f578f9cda6e77468049b5e000e3002ce9711809b`, the approved Olympus merge. No swimming, new beaches, boats, interior changes, audio additions or new renderer is included.

## WebGL upload repair

The shoreline checkpoint exposed pre-existing geometry-identity aliasing between explicit fixed instance fields in exterior/enrichment/town dressing and ordinary Olympus props. The renderer keys its upload record by geometry object, so a later ordinary rock or olive extended the count of an unrelated fixed field. At high quality the enrichment rock pool requested 3,640 floats from a 200-float array (800-byte GPU buffer); the olive pool requested 640 floats from 40 (160 bytes). Source offset and GPU destination offset were both zero. The same ranges reproduce against the preceding Olympus checkpoint, independently of the water effects. Other aliases silently replaced earlier fields, including planters, grass, windows, nets and driftwood.

Each affected explicit field now owns a shallow geometry wrapper, including enrichment's low-detail alternative. Immutable vertex/face arrays remain cached and shared; instance arrays, placement counts, quality filtering and reserved capacities are unchanged. Rock uploads are now 200 floats into 800 bytes, olives 40 into 160 bytes. Ordinary Olympus props batch separately. No ocean, navigation, waterfall, interior or renderer algorithm changed.

The focused regression exercises the real WebGL renderer's collector and uploader against a byte-bounded buffer sink across high/medium/low/high and three camera positions. It checks exclusive field ownership, finite stable source arrays, exact upload counts, source/GPU bounds and disposal. This deterministic sink does not claim shader/pixel validation: the existing Chrome WebGL shoreline checkpoint remains mandatory and unchanged.

## Water sources and licensing

The existing Clearwater adaptation in `dsb-water.js` remains the ocean. Its 64×64 spectrum, inverse FFT, 120-second cycle, Fresnel function, absorption, horizon/reflection and sun-glint calculations retain their original implementation and MIT notice. The mean sea level remains **−0.3 m**. The original FFT bytes are golden-tested against the starting checkpoint.

Changes in that module: a sand mask in an unused channel of the existing depth texture; a small shallow-sand brightness adjustment and moving shoaling foam; static fine tessellation/clipping at the playable beach so Canvas can sort the shore and submerged body; and a separate directional cascade shading function selected for the existing Olympus water faces. There are still exactly two ocean textures, no additional render targets and no vertex FFT displacement. Above-sea stream water reuses the sea's Fresnel, absorption palette, sky fill and sun response. Falling water uses downward-scrolling streak noise, not ocean displacement. Foam brightness is multiplied by scene light, with no constant waterfall bloom.

Inspected [dgreenheck/tidewater](https://github.com/dgreenheck/tidewater/tree/4811ba48d795197de5621985f404e765c0b7c0ef), especially `src/ocean/ShoreSim.js`, `SurfFoam.js` and `WakeSim.js`, at revision `4811ba48d795197de5621985f404e765c0b7c0ef`. Its code is [MIT licensed](https://github.com/dgreenheck/tidewater/blob/4811ba48d795197de5621985f404e765c0b7c0ef/LICENSE), copyright 2026 DRG Software Solutions LLC. **No Tidewater code or assets were copied/adapted.** Uprush/backwash, fragmented foam, wet-edge contrast and localized disturbance were architectural/visual inspiration, independently implemented here. Its WebGPU framework, shallow-water simulation, wake FFT, textures and third-party assets are not dependencies.

## Beach support and navigation

`dsb-coast.js` names the existing furnished south-Chora beach belt (the beach route, parasols and pergolas remain where they were). The full shelf is restricted to that sand frontage, with tapered ends inside x −3…53 and z >61. Both the nearest authored coast point and the actual terrain vertex must be inside the mask. The harbor, rocky east/west shores and rear Olympus height samples are unchanged.

Only offshore vertices are raised from the old −5 m seabed. The same 1.5 m heightfield owns rendering and collision, with the existing coplanar 0.75 m visual subdivision. The shelf follows the real coast distance with a gently increasing grade, `0.4 − 0.13d − 0.003d²`, then steepens after 13 m offshore. The old visual-only apron is omitted over this beach. Dry land, roads, lots and all mountain support are unchanged. Existing sand/noise coloring provides dry, wet and submerged tones; coastline curvature makes the shelf non-flat.

The depth gate samples the actor's body radius and allows a maximum local depth of `min(1.65, 0.98 × bodyHeight)`. Yellow measures 1.370 m tall and 0.697 m in radius in the current crew model. His centre reaches about **1.20 m immersion** with the forward edge of his footprint near the 1.343 m safety boundary: around neck/head height. The seabed steepens just beyond this shelf. Shallow rocky edges allow only 0.22 m; harbor water gets no beach allowance. A walker already over-depth can move uphill toward shore. There is **no beach or shallow sand shelf behind Olympus**.

The DSB input adapter wraps the existing `crew.steer` call; crew, pilot, camera, aiming and jumping implementations are unchanged. Movement multiplier is `1 − 0.66 × smoothstep(0.08, 1, immersion/bodyHeight)`. Ankle water is almost normal; waist water is about 71%; chest about 50%; full immersion bottoms out at 34%. Steering/look input is not slowed. The outdoor camera retains its normal terrain constraint and stays at least 0.12 m above the sea surface. No underwater control mode or tint is introduced.

## One bounded interaction layer

`dsb-water-interaction.js` owns a visit-local group. An impulse has location/surface height, radius, strength, age/lifetime, direction, type, slope and maximum extent. There are 24 recycled slots, five reserved for waterfall impacts. Player emission cannot evict a waterfall impulse. Moving sources emit short directional ellipses behind their current position; future boats can call the same `emit` API without changing the ocean, but no boat system is included.

Idle emits a faint disturbance roughly every 3.5 seconds. Walking raises emission frequency and strength; deeper movement makes short wakes. Entry, actual jump landing and fast shallow movement produce at most three small droplets per event, throttled to one event per 0.45 seconds. Droplets use the already-capped shared FX pool. Rings expand, thin and expire. Leaving water emits a final fading impulse at the previous surface height.

Beach swash strands are extracted from the actual mean-water contour. Each advances onto wet sand, fragments, fades and retreats on a staggered cycle. Rock-contact strands reuse meaningful existing shoreline contact positions; sixteen calmer small contacts mark the existing piers/posts. No continuous uniform foam ring is added around the island.

Olympus exposes its existing stream samples, five sheets and impact anchors without changing their vertices, course, level reaches, ledges, basin or bridge geometry. A local surface query allows Yellow's ripples on reachable stream/pool water, respecting existing rock collisions and bridges. Each impact has a small persistent contact-foam footprint and a reserved expanding ripple. Fixed moving highlights reinforce downward motion in Canvas; WebGL uses the new cascade material. Only the existing stream-bank stones receive a subtle wet darkening. Mist volumetrics are intentionally omitted. High quality has a few shared-pool impact droplets.

| Tier | Ripple slots (including 5 impacts) | Swash budget | Contact budget | Streak budget | Droplets/event |
|---|---:|---:|---:|---:|---:|
| High | 24 | 56 | 40 | 30 | 3 |
| Medium | 16 | 36 | 24 | 20 | 1 |
| Low / Canvas | 10 | 20 | 12 | 10 | 0 |

Current authored counts: 41 swash strands, 36 contacts, 30 streaks, five impact footprints and 24 impulse nodes: **136 nodes sharing two immutable geometries**. Lower tiers thin the actual lists below their budgets. Updates allocate no arrays/nodes/geometries; no listeners, network requests or polling are added. The existing weather water-energy/roughness inputs control foam strength and ripple prominence. All effects use normal scene lighting at night. Interiors hide the group and clear player/impulse state; scene leave detaches it and shared FX disposal releases droplets.

## Validation and review

`node test/run.mjs water-unit` covers protected-geometry/FFT hashes, four beach transects in both directions, measured Yellow movement to the depth stop and back, over-depth escape, the real speed curve, coast distinctions, ripple/wake/splash behavior, reachable stream interaction, all five impact slots, tier budgets, expiry, swash, contact weather response, downward flow and repeated disposal. Golden values were generated from the unmodified starting sources through `water-baseline`; they were not derived from the new implementation.

Existing `dsb-menus-unit` and `exterior-unit` remain unchanged and include entrance/wormhole/Portara flight, seating, venue routing, official-link/data and exterior placement coverage. The Pages workflow additionally runs the browser shoreline checkpoint, then all existing menu, Noderunner Radio/TV/Lightning, Studio and interior checkpoints before deployment. The browser shoreline checkpoint checks keyboard wading, camera safety, noon/golden/night/rain/storm, Sacred Way/bridges and scene trips. Desktop software WebGL is not evidence of hardware-phone frame rate.

Local Chrome is unavailable in the Work runtime (startup failed before page execution). The real Canvas renderer can export review images with `WATER_CANVAS=<adapter module> node test/run.mjs water-review`; the adapter is external tooling, not a project dependency. Canvas has no depth-buffer/refraction shader, so slight shore/stream sorting artifacts remain a fallback limitation. WebGL, real-device touch, motion quality and sustained mobile frame rate need browser/device review; hosted automated results are recorded in the milestone report.

Review base: `https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1`

Views: `water-dry`, `water-ankle`, `water-knee`, `water-waist`, `water-chest`, `water-head`, `water-swash`, `water-rocks`, `water-harbor`, `water-falls`, `water-pool`. Add `&view=<name>`. Add `&time=2300` for night, `&time=1800` for golden hour, `&weather=rain` or `&weather=storm` for weather. Waterfall review views use the free overview camera; Reset View returns to normal Yellow control.
