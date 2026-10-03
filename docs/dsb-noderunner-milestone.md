# Milestone 7: outdoor Noderunner harbor

Base: `2cf648e4fd6dcd350910597bf38468cb44b685ab` on `feature/dsb-land-master`.

## Restoration source

Inspected `src/js/dsb-models.js`, `dsb-audio.js` and `scene-dsb.js` at historical commit
`75cb0394891ea2520419a1bc5eef63ef0cd42c37`. Selectively adapted the blue pergola,
waterfront sign/screen, cream-and-blue seating and inverse-distance audio response.
No historical branch was merged. The approved current building footprint, road,
terrain and surrounding nature remain authoritative.

The former remote Noderunners Radio stream and jukebox/payment UI are not used.
`dsb-radio.js` supplies a short original synthesized melody, bass and percussion loop;
no commercial recording, external stream or new network dependency is introduced.

## Runtime contracts

- `dsb-noderunner.js` attaches the outdoor equipment/pergola/benches/crates to the
  existing Noderunner building metadata. Ground props sample the actual terrain.
  Shared DSB block/sign primitives and `solidProps` supply cached geometry and
  static swept collision. The promenade remains unobstructed.
- `weather.create` has one optional `audioFactory(context, exteriorMaster)` hook.
  DSB passes the radio factory through its existing weather adapter. The default
  weather path remains unchanged when no factory is supplied.
- One looping BufferSource and one GainNode use the existing weather AudioContext
  and exterior master. There is no extra context, scheduler, timer, frame loop,
  per-frame source creation or independent interior mute policy.
- Listener distance uses the player's position, not the review camera. Gain is full
  within 5 units, follows inverse-distance falloff and smoothly reaches zero at
  42 units (a smooth tail starts at 30). The gain target peaks at 0.45 before the
  existing exterior master. Four-per-second exponential smoothing plus a 60 ms
  AudioParam ramp avoids threshold jumps. Storms do not boost station volume.
- Real user activation unlocks the shared audio graph. The existing M/Mute control
  applies. Autoplay stays silent before activation. Proximity needs no keyboard
  action and works on touch devices.
- The shared exterior master disconnects in Meme Factory; its independent interior
  ambience remains active. Exit samples current player distance/weather. Hidden-page
  and mute policies are inherited. Scene disposal stops/disconnects the radio before
  closing the shared context. The cached score is reusable, not a live audio node.
- Existing lamp factor drives two small glow meshes. No point lights, shadow lights,
  render targets or weather/water pipelines are added. The compact static prop set
  is retained on mobile; existing renderer culling/batching handles it.

## Review controls

Use the deployed `dsb-preview/index.html` entry, `scene=dsb&debug=1` and
`view=noderunner` to start at the harbor in normal walking mode. Existing
`view=meme-factory` starts at the actual door. Existing `day`, `time`, `weather`,
`overview` and interior controls are unchanged. Overview intentionally locks walking.

## Validation

The repository's harbor checkpoint checks real normal-mode walking, distance gain,
clear/storm mix, road clearance, terrain-path reachability to harbor/Chora/Meme,
real door audio suppression/resume, and three DSB/Bifrost round trips. Each round
trip requires disposal of the old source/props and exactly one newly started source.
The existing ten-cycle Meme Factory checkpoint also compares radio source/start
counts. Nature/weather checkpoints protect the locked environmental systems.

The unit suite reproduces the same failures on the untouched base: the c3 cave
chamber dimensions, mirror allCracked expectation and breakables fixture's missing
root position. They are not changed here. Work's software renderer emits GPU
ReadPixels stall warnings; these remain visible in strict console checks and are
reported separately from application exceptions. Browser automation runs muted;
perceived musical balance remains part of the user's audible acceptance review.

Work validation result: build and touched-JS syntax checks passed. Desktop and phone
harbor checkpoints, locked nature/weather checkpoints and the real ten-cycle interior
checkpoint passed their functional assertions. Ten interior cycles held 377 nodes,
177 geometries, 6 interaction targets, 9 document listeners and 171 renderer records;
the radio remained one source started once. Three DSB/Bifrost cycles on each harbor
checkpoint released the old source and collider group. Normal W movement traveled
9.3 units; a flood of the actual walking/collision surface reached all three venues.
The hub's default weather path also booted/updated without application exceptions.
Day, night-rain and storm renders produced no application/shader/WebGL-fatal errors;
strict console checks still report the environmental warnings described above.

Post-deployment follow-up: the cloud browser's Canvas fallback painted parts of the
new lettering behind large facade/screen faces. The three labels now use the existing
sign/arcade `depthBias` convention (-0.6); the shared renderer and WebGL geometry are
unchanged. A forced Canvas render confirms complete labels and no console warnings
or errors. Build and syntax checks pass again.
