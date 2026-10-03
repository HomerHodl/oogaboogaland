# Milestone 7: outdoor Noderunner harbor

The original implementation below is historical. The Radio/TV correction section
supersedes its synthesized-only audio and absent TV behavior.

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


## Radio / TV correction

Starting checkpoint: `7f3670532f06c830f7fe6609b0aa861d5b68cc30`, clean and matching
GitHub after fetch and direct `ls-remote`. Historical source remains
`75cb0394891ea2520419a1bc5eef63ef0cd42c37`: inspected its `dsb-audio.js`,
`dsb-tv.js`, `scene-dsb.js`, `index.html` and `qr.js`. The TV and version-40 ECC-M
QR modules were already retained unchanged from that commit. Adapted the TV rather
than duplicating it; the old scene and entrance audio implementation are not restored.

- One HTMLAudioElement supplies the primary station stream. The stream lacks CORS
  headers, so it is not connected through MediaElementAudioSource (which would
  silence cross-origin audio). The shared weather audio layer receives synchronous
  `setEnabled(exterior && !muted)` notifications, muting the element immediately
  for interiors, hidden pages and global Mute. Normal updates use the existing
  player-distance attenuation, 5–42 units, with exponential smoothing. The stream
  stays connected during interior visits; exit samples current player distance.
- A 12-second connection/stall watchdog switches to the existing original loop;
  a 30-second retry attempts live playback. The fallback is lazily allocated once
  on the existing weather context. Its gain is zeroed before retrying live audio;
  both sources cannot be audible together. Autoplay denial waits for Play rather
  than repeatedly retrying. Disposal invalidates handlers and timers, releases the
  stream and stops/disconnects the fallback before closing the shared context.
- The physical screen is a pick target. Nearby Space or the touch action opens
  the five-channel DSB TV menu. Channel 1 is Noderunners; 2–5 remain disabled.
  TV freezes movement, supports Back/Close/Escape, and returns to walking on close.
  Closing TV does not stop radio, but does stop invoice monitoring.
- One uncached screen-text geometry updates only when displayed status or metadata
  changes and releases its predecessor. The approved frame, lettering depth bias,
  facade, pergola, road and props remain. No new light or render target is added.
- Metadata refreshes every 15 seconds, skips hidden pages, times out at 10 seconds
  and preserves last-good values. Now Playing, station note, eight queued tracks
  and six history tracks are bounded. Search returns at most 12 items. Text uses
  textContent, strips controls/bidi overrides and caps lengths; unknown sources
  are rejected. Requests use AbortController and are cancelled on disposal.
- The station sets prices. POST /api/play creates an unpaid invoice only; this
  client never pays. Validation checks lowercase mainnet BOLT11 structure,
  Bech32 checksum, amount against returned sats, finite positive sats, 64-digit
  hexadecimal payment hash and the local encoder's full-payload capacity.
  This is format/checksum validation, not signature or payee authentication.
- BL.qr generates both QR codes locally. Full invoice text, lightning: anchor,
  clipboard copy (selection fallback), price and station attribution are shown.
  One active request/invoice prevents duplicates. Payment polling runs every
  five seconds for up to 15 minutes, with distinct unpaid/paid/queued states.
  Errors say not to pay twice. Closing invalidates the epoch and aborts in-flight
  payment requests; it does not cancel the invoice at the station. The official
  jukebox QR/link remains available if an integrated endpoint fails.

Live validation on 2026-10-03: streaming GET returned HTTP 200 audio/mpeg;
nowplaying, history, search and an unpaid invoice returned the expected schema.
The API advertises Access-Control-Allow-Origin: *. A direct status GET returned
paid:false/queued:false. The browser independently searched, created an unpaid
210-sat invoice, rendered its QR/deep link and displayed the unpaid state. An
initial timeout recovered to live playback on retry, with fallback gain zero.
No sats were spent. Automated browser audio is muted, so perceived balance and
launching an installed mobile Lightning wallet remain user acceptance checks.

Independent ZXing decoding round-tripped the official URL, a real 322-character
station invoice and an 1800-character synthetic QR stress payload exactly. The
existing independent encoder fingerprints also cover capacity through version 40.

Correction validation: final build, touched-file syntax and diff checks passed.
Desktop and 390x844 touch TV assertions passed for menu, metadata, search, validated
invoice, copy/selection, bounded layout, duplicate prevention, all payment states,
epoch cancellation, Escape, live/fallback exclusivity, shared gate and disposal.
The normal harbor checkpoint passed walking (9.3 units), zero road obstructions,
all three destination paths, storm mix, real interior gate and three round trips.
Ten Meme Factory cycles held exactly 376 nodes, 176 geometries, seven targets,
nine document listeners and 170 renderer records, with one radio started once.
Strict console assertions still flag only the known software-GPU ReadPixels
warnings; no application exceptions appeared in the successful final runs.
The unit suite reproduced the documented cave/mirror assertions and breakables
fixture exception. No unrelated test or locked environment system was changed.
