# Milestone 6 — Meme Factory interior

Base: `4e29708270a7b16a3f610975bd8dd65a2e7d5cc9` on
`feature/dsb-land-master` (approved Mediterranean nature dressing).

## Provenance and scope

The room is selectively restored from `buildMemeFactoryInterior` in
`src/js/dsb-models.js` at `75cb0394891ea2520419a1bc5eef63ef0cd42c37`
(the historical DSB redesign). The workshop hum comes from
`createInteriorAmbience` in that commit's `src/js/dsb-audio.js`.
No branch was merged. No old geography, gameplay, shop economy, radio,
Noderunner, narration, or exterior scene implementation was imported.

The restored 29 × 21 room retains its tiled floor, cream walls, timber beams,
blue exit door, counter, banana/red exhibits, STACK/HODL/OOGA/21M/MEMES gallery,
blue lounge and potted plants. An opaque ceiling and swept furniture/wall
collision complete the contained room. It deliberately exceeds the exterior
building footprint. Displays are decorative; purchases are outside this milestone.

## Integration contract

`dsb-interiors.js` registers implemented buildings by stable interior ID and
current geography building name. A definition builds a room with its root,
spawn, exit, bounds and solid rectangles. Exterior entry/return positions derive
from the existing building orientation and sampled terrain height. The only
registered venue is Meme Factory House; all other doors remain non-interactive.

Rooms are built lazily once per DSB visit and cached across door transitions.
One retained exterior parent contains geography, water, lamps, Portara, weather
and nature. Hiding it suppresses the entire exterior render hierarchy. The
existing player/crew and input controller remain in place. Ground, swept
collision and camera bounds dispatch to the active room or the existing land.
The normal Space/JUMP action and contextual touch button share the same door
handler. A 0.36-second fade consumes repeated actions and resets held inputs.
The existing pilot navigation resets movement and camera at the supported spawn.

Interior render options are independent of exterior daylight, lightning and
water. The exterior clock and shared weather continue updating; water animation
and nature updates pause while hidden. Exit restores the current exterior
render options, not an entry-time snapshot. No weather renderer, wind model,
framebuffer or update loop was added.

Entry/exit exercise the Milestone 4 `weather.setInterior` gate. That gate
physically disconnects the shared exterior audio master and cancels rain and
pending thunder. The new `dsb-interior-audio.js` ports only the historical
workshop synth: two oscillators and one filtered seeded-noise loop, created
behind user activation, reused across visits, disconnected outside/when muted
or hidden, and stopped/closed on scene disposal. Future Noderunner audio must
continue to follow the existing exterior environment/audio policy.

## Review controls

All helpers require `debug=1`:

- `view=meme-factory`: stand outside the actual exterior door, facing it.
- `interior=meme-factory`: use the same transition to enter at startup.

These compose with the existing `scene=dsb`, `day=80`, `time=1200|0000`,
`weather=clear|storm|rain`, and other approved weather controls. Normal visits
still start at Portara and require walking to the door. Browser audio requires
a real gesture (use movement or the mute button on direct interior review).

## Validation

The focused `dsbInteriorCheckpoint` in `test/run.mjs` exercises real Space and
touch input, indoor movement/floor contact, wall/table/counter exclusion,
current weather and nighttime restoration, ten full door cycles, scene disposal,
and stable node/geometry/interaction/listener/audio counts. It runs at desktop
and phone dimensions. Existing weather and nature checks remain intact.

The untouched base and this implementation both reproduce the unrelated cave
`c3` dimension check, mirror `allCracked` assertion, and breakables unit fixture
exception (missing `cave.root.position`). These prevent the combined runner
from reaching browser scenes. Focused checks are therefore also run directly
with the repository's browser driver, without changing or weakening the suite.
The Work SwiftShader renderer emits its existing `GPU stall due to ReadPixels`
performance warnings; those remain visible in the strict console assertion.

Measured ten-cycle results: desktop retained 339 nodes, 161 geometries, six
interaction targets, nine document listeners and 155 GPU records. Mobile retained
327 nodes, the same 161 geometries/six targets/nine listeners; GPU records fell
from 156 to 155 as an unused resource was released. Both retained exactly one
workshop AudioContext and three sources. Scene departure cleared the room cache
and closed that context. Existing nature and weather behavioral assertions also
passed, including seeded placement, tier populations, night rain, water recovery
and scene re-entry. No application exceptions, shader compilation errors or
fatal WebGL errors were observed. Audio graph behavior was measured; audible
balance still needs hardware listening during visual approval.

Deployed review caught the outward-facing return shoulder camera intersecting
the exterior facade. The return now faces the same door (camera on the open
road side); the door regression checks that the exterior camera is clear of
building footprints. This was corrected in a follow-up commit without rewriting
the already-published milestone commit.
