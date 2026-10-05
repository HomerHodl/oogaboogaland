# Lightning Factory greeter

Implementation of four optional world tours, following drneski's design direction and play-test feedback. The foreman, routes and lines: Payments, Channels, Rebalancing and Node health.

## Visitor experience

Flink, a factory foreman in a leather apron and yellow hardhat, stands on the balcony's left at the head of the grand stairway (x -2, y 5, z 23.6), clear of the stairway's lantern post and the arrival path, so the visitor walks up to him. He waves and says hello when a played Ooga comes near; while the demo node runs, his greeting says so. There are no control instructions in his bubbles: within his reach the act button reads TALK TO FLINK, the way the hub shows ENTER ARCADE by its door, and the hover tooltip names him.

Talk (the act button, Space in reach, or a click or tap on him) turns the visitor's Ooga to face him and opens a small on-screen menu with the four tours. Tap or click picks one; Arrow keys choose and Enter starts it, and menu arrows do not move the visitor. Walking away closes the menu, and Escape closes it too: an open menu swallows Escape, so the cave's own Escape leaves only when no menu is up. The visitor follows each tour with their own Ooga and camera.

During a tour the act button reads NEXT and an on-screen End tour button shows. Each line advances on its own after a readable beat — a whole tour plays with no presses at all — and NEXT skips ahead. Tapping Flink at a stop repeats the current line. During walking, Space remains the visitor's usual action. End Tour or walking off for twelve seconds sends him back to his post. Full lines remain voice-ready data; their short speech beats fit the existing single-line bubbles.

Arriving without an Ooga (a direct /lightning entry) shows a hint to pick one on the island; tapping Flink without one gets a bubble to the same effect. The greeter never assigns an Ooga.

## Payments itinerary

1. Entrance post at x -2, y 5, z 23.6; descend the broad central staircase.
2. Pit viewing spot at x -6.5, y 0, z 8.5: explain channels connecting peers and payments passing through several nodes.
3. Existing left pit-to-core stairs, then the landing near x -4.8, y 5, z 0.1: explain the core and forwarding, then the public feed's privacy boundary.
4. Retrace the stairs to a floor viewing spot near x -7, y 0, z 8.5 facing the switchboard: explain settled and failed outcomes, describe a report received during this tour if one exists, then finish.
5. Run back along the same waypoints to the entrance post.

The tour doesn't require station, out or fee. No incoming event is required to continue; a quiet tour uses conceptual dialogue. Observations distinguish public versus demo and live versus replay, each labelled once when relevant rather than in every line. A failed outcome never implies a cause, and a missing fee never means zero. The tours do not reconstruct routes or animate additional node events.

## Other itineraries

- Channels: descend the arrival stairs to the forge viewing spot (-4.8, 0, 5.8), explaining opening and closing on-chain. Take the left core stairs and the existing bridge to the inner channel porch (-8.5, 5, -2.5). Explain reported states, daily public slots and capacity versus private directional balances. A channel report is not attributed to the particular station being viewed.
- Rebalancing: descend the arrival stairs, pause on the right pit floor (4.8, 0, 10) to explain liquidity, then face the ring machine from (8.5, 0, 9.5). Explain hourly reports, success and failure, without naming private channels or inventing failure causes.
- Node health: take the core landing, explaining the last reported node state. Continue across the channel porch and up the existing high stairs to an observation landing (-9.2, 10, -10.1), looking up at the watchtower. Distinguish an explicit stopped report from a waiting or silent feed; incoming replay is not a fresh health check, and activity summaries are not diagnoses.

Each tour returns along its own waypoints. Reports are optional, retained only as bounded scalar observation state and labelled as demo or replay when appropriate. No tour waits for an event before continuing.

## Ending and giving way

One tour runs at a time. Beyond six metres from the visitor the foreman waits. After four seconds he calls back; after twelve seconds he gives up with “Lost my visitor!” and runs back. There is no pause/resume tour state. End Tour returns him to his post. Leaving the cave disposes the tour, the menu and the greeting.

The foreman steps through the existing support and collision functions, in small increments, and gives way sideways when the floor permits it, waiting on a narrow passage when the visitor occupies his next step. A blocked outward route ends after five seconds; the return waits for a clear path rather than walking through obstacles.

## Implementation boundary

factory-greeter.js owns a visit's rig, fixed waypoints, the on-screen menu (DOM built per visit, styled in style.css, removed on leave), bounded state and one feed subscription. Lines are separately named data for future speech. It never fetches, emits node events, changes accounting, assigns player control or takes over the camera. The visit removes its pick, its keydown capture and unsubscribes on exit. Both renderers use the same existing rig geometry.

## Validation and next review

Build, the factory browser suite and the unit checks are the repository's validation. The factory suite now checks Talk, menu selection, Escape and End tour. Please play-test:

- Arrival with an Ooga versus a direct /lightning arrival without one (the hint).
- TALK TO FLINK in reach, Space beyond it staying a jump; each of the four tours running start to finish hands-free, NEXT skipping, End tour, cancellation and repeat visits.
- The menu: tap, click, arrows plus Enter, walking away, Escape closing the menu first and leaving the cave only with no menu up.
- Stop following, wait for the warning and frustrated return; leave during a tour.
- Public reports without routes, fees or private balances; demo, replay and no events; node stopped versus feed silence.
- Phone readability of the menu and Canvas 2D; route clearance, stair support, returning past the visitor and the scene leave contract.

All four routes and their speech are implemented as proposals. Stair and bridge clearance, observation sightlines and mobile readability remain for maintainer play-test before the draft is ready to land.

[PR #112](https://github.com/OogaBoogaX/oogaboogaland/pull/112) preserves the earlier explanations as reference material only. None of its rejected walkthrough implementation is carried over. The hotpixelgroup character landed independently in [PR #117](https://github.com/OogaBoogaX/oogaboogaland/pull/117).
