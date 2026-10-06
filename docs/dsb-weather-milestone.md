# DSB Land — Milestone 4 weather

Base: `b5a84f716409663fd6b5d0fb99a6f1e59bb1d4d0`.

`dsb-weather.js` adapts the existing `weather.js` instance. Normal gameplay reads
`BL.chain.snapshot` and owns one subscription, removed on scene exit. It starts
no feed, socket, timer or animation loop. `soak`, `gale`, the six precipitation
steps, easing, pooled instanced rain, cloud geometry, bolt variants and synthesized
rain/wind/thunder all come from the existing weather module.

The shared module now accepts optional presentation coordinates: a camera-local
rain field and a separately positioned cloud deck. Its default rainforest
presentation is unchanged. Particle limits follow the current renderer tier:
720/480/260 (Canvas 2D: 120); cloud limits are 48/36/22 (Canvas 2D: 14).
The allocation stays fixed at entry capacity, and populations reduce on downgrade.
Thunder reuses one voice, with no per-strike timers or audio graph allocation.

The DSB adapter runs after the existing daylight sample, retaining its clock,
sun/moon directions and lamp factor. Cloud cover attenuates direct light, softens
shadows, desaturates the sky moderately and adjusts horizon haze. A storm flash
expires through the shared weather envelope; the next daylight sample restores
unmodified input. Ordinary rain does not impose dense fog.

`dsbWater.setEnvironment` receives four bounded values: wave energy, roughness,
solar glint and shoreline foam. One uniform modifies the approved optical normals
and highlights. Spectrum, seabed/depth texture, geometry, mean waterline and the
two existing GPU textures are unchanged. Sky light drives water brightness.
Night has no solar glint. Canvas 2D retains the approved static water fallback.

## Review

Use a named `dsb-preview/index.html` URL, because the existing site router treats
a directory URL as a root-relative route. Keep `scene=dsb&overview=1&debug=1&day=80`
and add `time=1200&weather=clear`, `time=1200&weather=light-rain`,
`time=1200&weather=storm`, or `time=0000&weather=rain`.

Other presets: `cloudy`, `drizzle`, `wind`, `haze`. An unknown preset falls back to
normal chain weather. `weather` is ignored without `debug`. Named debug presets
win over feed updates; `__ooga.dsb.weather.setMode(null)` restores live weather.
Storm review strikes first after five scene seconds, then every 24 seconds.
`__ooga.dsb.weather.strike()` previews one strike in storm conditions. Normal
storm intervals are 30–65 seconds. Thunder follows after 0.5–1.5 seconds.
Sound needs a real browser gesture; M toggles exterior sound.

## Baseline limitation: interiors and radio

This exact master checkpoint's `scene-dsb.js` builds geography, water, four lamps,
a walking avatar and Portara. Its houses are solid exterior shells. It does not
instantiate the old Meme Factory interior or `dsbAudio`/Noderunner player.
No old prototype is restored by this milestone.

The adapter's `setInterior(true/false)` is the single integration gate for its
rain, wind, surf and thunder; it cancels pending/playing thunder and clears the
local precipitation pool on entry. Document visibility uses the same gate.
The scene exposes `BL.scenes.dsb.setInterior(true/false)`. A future actual
interior controller must call this method; a restored radio should use the same
`weather.state.audioEnabled` policy (exterior, visible, and not muted).
The one exterior audio bus disconnects on suppression, so silence does not depend
on Web Audio envelope timing. The debug handle exposes the method
for gate testing; a debug toggle is not a real walk-in interior acceptance test.

The surf layer is a lightweight altitude-attenuated bed, not directional surf
at each beach. Real-device frame rate and the visual appearance of rain at
varying camera angles still need the owner's review.

## Work-session validation (2026-10-03)

- Fresh GitHub checkout verified: repository, branch, exact starting HEAD/message,
  clean tree and origin match. The remote was checked again and remained at the base.
- Build, syntax checks for all touched JavaScript, and `git diff --check` pass.
- Existing weather-step checks and the debug-override boundary check pass.
- New desktop and phone weather checks pass their behavior assertions: clear/rain/
  storm progression, water response, temporary flashes, direct exterior gate,
  reduced tier populations, recovery to clear and night lighting.
- Their clean-console gate fails on Chromium/SwiftShader's `GPU stall due to
  ReadPixels` performance warnings. No application JavaScript exceptions were
  seen in the four captured weather states. This is not a clean suite pass.
- The global unit suite fails cave-chamber and mirror assertions, then throws
  on the existing breakable-prop fixture (`crew.player` lacks `root`). The same
  failures and exception were reproduced in an untouched archive of the base.
- The existing water/Portara round-trip session exceeded the runner's 120-second
  watchdog in this software-rendered environment. Lifecycle acceptance remains
  unverified; no threshold was relaxed and no check was weakened.
- Clear noon, light rain, storm and night rain were visually inspected locally.
  Cloud height was corrected to clear the overview camera; rain was reduced in
  size and moved below the eye so it stays visible in that view.
- Geography and daylight source files were not edited. No new vegetation or
  attraction code was introduced.

The owner accepted the following Milestone 4 scope: exterior Aegean weather
plus shared integration hooks for later interiors and Noderunner restoration.
Meme Factory interior and Noderunner end-to-end audio validation is deferred
because those runtime components are absent from the Milestone 3 starting
checkpoint. The shared exterior-weather/audio integration is prepared for their
later restoration. This is an accepted limitation, not a Milestone 4 failure.

Final focused checks also confirm thunder scheduling, immediate exterior-bus
suppression, no queued thunder while suppressed, and unchanged two-texture water
rendering. Software-GPU ReadPixels warnings were reproduced in the untouched
baseline; no new application exceptions, shader compilation failures or fatal
WebGL errors were found. The owner accepts the unrelated baseline failures and
the software-rendered portal timeout separately from Milestone 4 acceptance.
The generated HTML is rebuilt for validation and by Pages CI; repository
instructions prohibit committing it manually.
