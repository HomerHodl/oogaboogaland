# Aegean shoreline, wading and waterfall interaction

Starting checkpoint: `f578f9cda6e77468049b5e000e3002ce9711809b`, the approved Olympus merge. No swimming, new beaches, boats, interior changes, audio additions or new renderer is included.

## WebGL upload repair

The shoreline checkpoint exposed pre-existing geometry-identity aliasing between explicit fixed instance fields in exterior/enrichment/town dressing and ordinary Olympus props. The renderer keys its upload record by geometry object, so a later ordinary rock or olive extended the count of an unrelated fixed field. At high quality the enrichment rock pool requested 3,640 floats from a 200-float array (800-byte GPU buffer); the olive pool requested 640 floats from 40 (160 bytes). Source offset and GPU destination offset were both zero. The same ranges reproduce against the preceding Olympus checkpoint, independently of the water effects. Other aliases silently replaced earlier fields, including planters, grass, windows, nets and driftwood.

Each affected explicit field now owns a shallow geometry wrapper, including enrichment's low-detail alternative. Immutable vertex/face arrays remain cached and shared; instance arrays, placement counts, quality filtering and reserved capacities are unchanged. Rock uploads are now 200 floats into 800 bytes, olives 40 into 160 bytes. Ordinary Olympus props batch separately. No ocean, navigation, waterfall, interior or renderer algorithm changed.

The focused regression exercises the real WebGL renderer's collector and uploader against a byte-bounded buffer sink across high/medium/low/high and three camera positions. It checks exclusive field ownership, finite stable source arrays, exact upload counts, source/GPU bounds and disposal. This deterministic sink does not claim shader/pixel validation: the Chrome WebGL shoreline checkpoint remains mandatory.

## Deployment validator repair

The failed startup gate polled game state, **not pixels**. Once its 20-second deadline elapsed it fetched a second state, captured a synchronous screenshot, and threw without checking the new state. The recorded state was already ready (WebGL2, three frames, no curtain); the failure artifact showed a rendered beach. Thus the screenshot prolonged an already-failing path; the evidence does not establish it caused the original slow frames. The software-driver ReadPixels messages alone do not prove a game error or identify an application readback.

Readiness now judges the fresh state before failing and never captures pixels on its failure path. The dedicated functional lane uses a 480×320 viewport and the renderer's existing low quality tier. It records successful real renderer draws separately from director frame attempts, GL errors/context loss, shader readiness, GPU identity, application `readPixels` calls and render timing. It checks the player/land/water objects, 24-slot capacity, two ocean textures and stable startup node/record counts. The ordinary animation loop remains live. All original keyboard, depth, retreat, weather, Sacred Way, bridge and visit/disposal assertions remain.

The old synchronous playthrough requested roughly 3,800 GPU frames while fast-forwarding 60 Hz simulation. A test-only wrapper now keeps **every** director/input/physics step but draws once per simulated second and at each final observation. It changes no production module. Deterministic water/upload tests still cover all quality tiers and the full water/navigation contract. A validator regression reproduces the late-reply race and checks simulation tick preservation, final/ordinary draws and transparent readback forwarding.

Five waterfall screenshots (noon/golden/night/rain/storm) run in a separate best-effort workflow step **after both functional browser suites pass**. Each capture has a five-second command budget; the evidence step has a two-minute limit. Capture failure cannot invalidate or replace the functional WebGL gate. Real API errors, shader failures, context loss and runtime exceptions still fail functional validation. Only the exact driver `GPU stall due to ReadPixels` performance notice is reported separately, and only after all sampled WebGL states pass and the GPU identifies as SwiftShader/llvmpipe/software. Logs remain available; application readbacks are counted, not intercepted or suppressed. No readiness/session timeout was increased. Hardware desktop/phone visual quality and frame rate remain manual checks.

## Lifecycle validation repair

The next hosted run reached healthy WebGL startup in 7.8 seconds but sampled two valid states at the wrong times. The 24-second forward walk had already reached the depth boundary and stopped, so its short-lived player rings had expired. Re-entry sampled only 0.05 seconds after leaving Bifrost, while the entrance tunnel deliberately hid the exterior and released its ocean textures.

The test-only simulation observer now samples every normal physics tick and records visible player impulses during movement, including a successful WebGL draw, wake/splash emission and the fixed slot bound. Head-depth and camera assertions remain unchanged. After reverse input returns Yellow to dry land, the test verifies that player rings expire and become hidden normally. No ripple lifetime or gameplay parameter changed.

Each round trip now verifies the Bifrost scene and the tunnel's intentional no-ocean state, walks forward through the entrance with real keyboard input, and waits for the entrance's `done` phase plus an active exterior. The standard reduced-motion browser follows the existing direct arrival; browsers with motion enabled also wait for the existing flight. There is no skip call or forced resource creation. The bounded semantic wait fails if readiness never arrives. Only then does the checkpoint require two ocean textures, finite active water, active interactions, 24 slots, 136 effect nodes, disposed old visits and equal renderer record counts across both completed re-entries.

All of this is confined to `test/run.mjs`; production water, terrain, movement, entrance and rendering code remain unchanged. Software-driver ReadPixels performance notices remain logged and are classified separately only after all functional assertions and sampled WebGL health checks pass. The evidence JSON includes the transient observations and both entrance/resource snapshots.

## Water sources and licensing

### Coastline foam and pier-access correction

The continuous white rim had two contributors: universal shallow-depth shader foam, and the old visual apron's white `[238,244,238]` band at y −0.268…−0.286, above the −0.3 sea. That band now uses wet mineral tones without changing its vertices. Sea-shader foam uses the existing depth texture's beach mask and fades to zero at zero depth; moving shoaling crests remain over submerged sand. The separate advancing/retreating swash, pulsing rock contacts and calmer harbor contacts are unchanged. No extra texture, geometry, renderer or water-level change is introduced.

The existing quay and two 2.4 × 19 m piers now share authored footprint/top definitions with their support queries. Their visible geometry stays at x −43/−34, z 49, top y 1.35. `groundAt`/`supportAt` return the higher of terrain and deck inside those footprints; `heightAt` remains exclusively the original terrain/seabed, so ocean depth and wading do not mistake a pier for sand. Walking samples deck support with the existing 0.55 m step limit and checks a body-wide footprint at marine edges. Exterior ground and camera queries through the interior router use that same support; room behavior is unchanged.

Focused tests walk real Yellow out and back on both piers, check exact foot height, dry movement, deck edges, camera support and the corridor between the unchanged prop bounds. The hosted WebGL pier playthrough runs in its own session, serially after the preserved shoreline suite to avoid software-GPU contention. Optional coast images cover beach, rocks, harbor, both decks and night rain. The normal GPU error checks and timeouts remain in force.

Ground-level review views: `water-pier-west`, `water-pier-east`.

The first hosted correction run passed both pier playthroughs but caught a pre-existing waterfall-test timing assumption: one of five reserved impact rings can expire on the last sampled update and renew on the next. The weather check now observes the same two-second window, requires all five rings to be visibly active within it, and checks finite water and the 24-slot ceiling throughout. No water lifetime, capacity, gameplay, timeout or required impact count changes.

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
