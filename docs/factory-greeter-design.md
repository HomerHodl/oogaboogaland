# Lightning Factory greeter

Implementation of four optional world tours, following drneski's design direction and play-test feedback. The guide, routes and lines: Payments, Channels, Rebalancing and Node health.

## Visitor experience

Tess, a floating factory guide, hovers on the balcony's left at the head of the grand stairway (x -2, floor y 5, z 23.6). Her eye sits 1.05 m above the floor, at the centre of Flink's former head, and her outer rings span its seven-voxel width (about 0.46 m). There is no torso, foot, stand or ground collision body below her. She tips her eye in greeting and says hello when a played Ooga comes near; while the demo node runs, her greeting says so. Within her reach the act button reads TALK TO TESS and the hover tooltip names her.

The selected Meridian design has a smooth Earth-globe core with graphite oceans, Bitcoin-orange land and darker orange country boundaries, an amber mechanical iris, three ivory armor caps and three open gyroscopic wooden rings bound in copper, each with an emissive Bitcoin-orange (#f7931a) outer rail. Radial ticks, linked block marks and rectangular slots evoke the concentric full-node sculpture without a Bitcoin logo. The rings share the eye's centre but turn independently: one revolution in 26.5, 35.5 and 44.5 seconds, the middle in the opposite direction. Their planes also precess slowly in 68.5, 86.5 and 105.5 seconds. Nested radii prevent ring intersections, and bounded angles and quaternion gimbals prevent accumulated rotation drift. A gentle 1.8 cm hover, greeting tilt, optical blink and speech glow give Tess expression.

The globe uses a baked, simplified Natural Earth 110m country map (public domain; https://www.naturalearthdata.com/about/terms-of-use/), sampled at 2.5 degrees onto shared smooth lathe geometry. Small islands and countries below that scale may merge or disappear. No map data is fetched during play.

The polished rig adds domed ceramic plates over graphite gaskets and copper lips, vent details and fasteners, a layered lens housing with eighteen iris vanes and small optical highlights, and chamfered ring rails with baked wood grain and inset copper blocks. Her optics shift subtly with her gaze and her core banks into turns. A small amber light follows her eye on Medium and High; Low retains the emissive eye and the existing hall lights.

Geometry is built once with the existing smooth lathe, turned-part, prism and bevelled-box helpers. The amber eye accent reuses the forge-wave ring. All animation changes existing nodes; no mesh is rebuilt per frame.

Talk (the act button, Space in reach, or a click or tap on her) turns the visitor's Ooga to face her and opens a small on-screen menu with the four tours. Tap or click picks one; Arrow keys choose and Enter starts it, and menu arrows do not move the visitor. Walking away closes the menu, and Escape closes it too: an open menu swallows Escape, so the cave's own Escape leaves only when no menu is up. The visitor follows each tour with their own Ooga and camera.

During a tour the act button reads NEXT and an on-screen End tour button shows. Each line advances on its own after a readable beat — a whole tour plays with no presses at all — and NEXT skips ahead. Tapping Tess at a stop repeats the current line. During walking, Space remains the visitor's usual action. End Tour or walking off for twelve seconds sends her back to her post. Full lines remain voice-ready data; their short speech beats fit the existing single-line bubbles.

Arriving without an Ooga (a direct /lightning entry) shows a hint to pick one on the island; tapping Tess without one gets a bubble to the same effect. The greeter never assigns an Ooga.

## Payments itinerary

1. Entrance post at x -2, y 5, z 23.6; descend the broad central staircase.
2. Pit viewing spot at x -6.5, y 0, z 8.5: explain channels connecting peers and payments passing through several nodes.
3. Existing left pit-to-core stairs, then the landing near x -4.8, y 5, z 0.1: explain the core and forwarding, then the public feed's privacy boundary.
4. Retrace the stairs to a floor viewing spot near x -7, y 0, z 8.5 facing the switchboard: explain settled and failed outcomes, describe a report received during this tour if one exists, then finish.
5. Fly back along the same waypoints to the entrance post.

The tour doesn't require station, out or fee. No incoming event is required to continue; a quiet tour uses conceptual dialogue. Observations distinguish public versus demo and live versus replay, each labelled once when relevant rather than in every line. A failed outcome never implies a cause, and a missing fee never means zero. The tours do not reconstruct routes or animate additional node events.

## Other itineraries

- Channels: descend the arrival stairs to the forge viewing spot (-4.8, 0, 5.8), explaining opening and closing on-chain. Take the left core stairs and the existing bridge to the inner channel porch (-8.5, 5, -2.5). Explain reported states, daily public slots and capacity versus private directional balances. A channel report is not attributed to the particular station being viewed.
- Rebalancing: descend the arrival stairs, pause on the right pit floor (4.8, 0, 10) to explain liquidity, then face the ring machine from (8.5, 0, 9.5). Explain hourly reports, success and failure, without naming private channels or inventing failure causes.
- Node health: take the core landing, explaining the last reported node state. Continue across the channel porch and up the existing high stairs to an observation landing (-9.2, 10, -10.1), looking up at the watchtower. Distinguish an explicit stopped report from a waiting or silent feed; incoming replay is not a fresh health check, and activity summaries are not diagnoses.

Each tour returns along its own waypoints. Reports are optional, retained only as bounded scalar observation state and labelled as demo or replay when appropriate. No tour waits for an event before continuing.

## Ending and giving way

One tour runs at a time. Beyond six metres from the visitor Tess waits. After four seconds she calls back; after twelve seconds she gives up with “Lost my visitor!” and flies back. There is no pause/resume tour state. End Tour returns her to her post. Leaving the cave disposes the tour, the menu and the greeting.

Tess follows the existing tour paths using support and collision queries as a navigation envelope, smoothing her flight height above each stair tread, and gives way sideways when the floor permits it, waiting on a narrow passage when the visitor occupies her next step. A blocked outward route ends after five seconds; the return waits for a clear path rather than walking through obstacles.

## Implementation boundary

factory-greeter.js owns a visit's rig, fixed waypoints, the on-screen menu (DOM built per visit, styled in style.css, removed on leave), bounded state and one feed subscription. Lines are separately named data for future speech. It never fetches, emits node events, changes accounting, assigns player control or takes over the camera. The visit removes its pick, its keydown capture and unsubscribes on exit. Both renderers use the same procedural geometry. Prepared detail tiers are retained through the visit’s liveGeometry contract. Their GPU records are released when the scene leaves; bounded CPU mesh caches remain for the page lifetime.

## Validation and next review

Build, the factory browser suite and the unit checks are the repository's validation. The factory suite checks Talk, menu selection, Escape and End tour, all four tours completing every stop and returning along the stairs and bridges, menu bounds on phone, Canvas operation, detail hysteresis and immediate Low-quality downgrade. The guide-route fixture moves the visitor beside Tess; the existing widest-Ooga floor and control checks separately prove visitor traversal. Please play-test:

- Arrival with an Ooga versus a direct /lightning arrival without one (the hint).
- TALK TO TESS in reach, Space beyond it staying a jump; each of the four tours running start to finish hands-free, NEXT skipping, End tour, cancellation and repeat visits.
- The menu: tap, click, arrows plus Enter, walking away, Escape closing the menu first and leaving the cave only with no menu up.
- Stop following, wait for the warning and frustrated return; leave during a tour.
- Public reports without routes, fees or private balances; demo, replay and no events; node stopped versus feed silence.
- Tess's scale, ring motion and eye visibility; phone readability of the menu and Canvas 2D; route clearance, stair support, returning past the visitor and the scene leave contract.

All four routes and their speech are implemented as proposals. Automated stair, bridge and menu checks complement maintainer play-test of observation sightlines and the overall experience. drneski’s requested play-test remains pending; review readiness does not imply approval to land.

[PR #112](https://github.com/OogaBoogaX/oogaboogaland/pull/112) preserves the earlier explanations as reference material only. None of its rejected walkthrough implementation is carried over. The hotpixelgroup character landed independently in [PR #117](https://github.com/OogaBoogaX/oogaboogaland/pull/117).

## Close-up detail

Within 6 m of the camera Tess switches to a cached close-up rig: the globe has 51,200 faces versus 10,368 (4.94×), using finer Natural Earth 50m outlines at 1.125 degrees. Ring rails use 480 segments versus 96, the optics and armor use denser curves, and each ring gains 192 fine etched ticks. Beyond 7 m the original tier returns; hysteresis prevents switching at the boundary. Scene pixel resolution remains unchanged. Fine detail is prepared only when entering with a fine pointer and High or Medium quality. Touch, Canvas (whose quality is Low) and Low-entry visits prepare only the lighter rig. A drop to Low immediately restores that rig. Geometry preparation happens during scene entry, never in the frame update. A debug-only promotion after a Low-entry visit prepares fine detail on the next visit. Prepared CPU meshes are cached once for the page lifetime; GPU retention is limited to the visit.

## Device-cost assessment

The whole rig, including rings and optics, has 69,616 faces at the lighter tier and 449,680 at the fine tier (6.46×); globe-only counts understate device cost. Before the device gate, both tiers retained 518,528 faces through 24 geometry entries.

Serial local Chrome samples at verified camera distances of 10 m and 3 m measured:

| Before the gate | Far FPS | Near FPS | Near render p95 |
|---|---:|---:|---:|
| Desktop High | 59.54 | 60.14 | 0.50 ms |
| Phone emulation, Low | 60.39 | 50.49 | 0.50 ms |
| Canvas, Low | 8.29 | 2.20 | 506.40 ms |

Phone emulation uses desktop hardware; these are not low-end hardware results. Camera exposure changes between views, so the comparison is observational. Actual cold guide construction took 91–92 ms behind scene entry. The first explicit far WebGL upload took about 31–32 ms; fine geometry had already warmed during the initial Factory draw (about 310 ms for the full scene), so its later near draw is a cached measurement. No frame-rate or resource threshold was lowered. The gate protects Canvas and touch devices from the additional fine-rig geometry and avoids constructing it during play.

[Measurement data](tess-device-cost-evidence.json) retains the source revision, geometry counts, startup marks, first measured render and steady samples.
