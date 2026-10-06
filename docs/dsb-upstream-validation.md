# DSB upstream integration validation

Checkpoint: DSB `bd033e04ac1e4ac3c815c2c0e36ce0908339e38f`, upstream
`822addee5f3971c9a47da228e4935e57fb576ab7`, common base
`dab6e36bea482f2d712b65f3e2d559348400b527`. Normal merge, no history rewriting.

## Frozen Olympus geometry

Compared the real `waterWorld` from the approved checkpoint, the merged sources,
and a diagnostic merged copy reversing **only** the two `hub-models.js` back-face
index changes. The third result matches the approved scene data exactly.
The comparison included land, Olympus graph, trail, bridge data, waterfall impact
positions, nature placements/instance transforms, enrichment, detail and town.
The 10 nature fields retain 10,829 placements; the 39 enrichment fields retain
2,119 placements. The 10 trail points, two bridges and five waterfall impact
positions match exactly. All node transforms, geometry vertices, vertex order, normals, face counts and
front faces match. Vegetation identities/counts and major scenery are unchanged.
Across the compared graph there are 56 changed geometry occurrences and 6,156
changed back faces; every change is the cyclic rotation of the reversed boundary
that retains the front face's first vertex as its fan anchor. Nothing else differs
except the derived Olympus hash. Ground `69d81f3b`, bridges `9164c056`, buildings
`634c3799`, and Clearwater FFT `aa331f6b` remain frozen.

This is not merely JSON formatting: a cupped nonplanar polygon triangulated from
a different anchor has a different interior surface. Upstream fixes the erroneous
back surface to coincide with the unchanged front. The front shape, boundary,
normal generation and placement are preserved; the overlapping erroneous back
surface is not restored. Side-by-side Canvas renders of the approved and merged
waterfall/Olympus view confirm preserved trail, waterfall, vegetation and scenery
silhouettes. Global HUD visibility differs intentionally. No DSB model was edited.
The expected Olympus hash is therefore updated from `402cb4ff` to `7490fca7`
to accept this isolated upstream rendering correction, with all other expectations
unchanged. Browser visual gates still apply independently.

## Upstream baseline

An untouched archive of upstream reproduced the Oogatron snapshot assertion and
pool fixture crash (`site.ground.geometry` missing). The fixture previously
provided only empty node and membrane nodes despite production requiring ground,
membrane geometry, board legs and info-sign leg geometry. Supplying those actual
production meshes in both the baseline test copy and merge allows every unit
check to execute. No production pool behavior or assertion was changed.

With that same fixture correction: upstream **128/130**, merged **176/178**.
Both failing output lines, including JSON details, are identical:

- `Oogatron snapshot: matched Oogas take backend last-seen times fanned out per repository, and the baked repo rows are genuinely repo-scoped`
  fails timestamp matching, while accepted=42, perRepo/aligned/repoScoped are true.
- `pool water: the backlog fills the lake by a rising scale to its crest and its highest flood, the shore and channels flood before the lowland while the path and the nests never do and a channel past the cliff holds no one up, a stale reading is held and said to be stale, and blocks found faster than they fall wait in a bounded queue`
  fails with channel=false at spill/flood despite falls=9; the same state is returned upstream.

These remain reported failures, not skipped checks. No new upstream unit failure
was observed in the compared suite.

## Startup and browser diagnosis

Hosted generated build, 1440x900, software WebGL trace (milliseconds from navigation):
renderer 1577–1738; DOMContentLoaded 1765; load 1774; net.start 1754;
/api/me HTML 404 completes 4540; DSB enters 4542–7170; ready 7171;
first frame 7183; first submitted draw 8281; second frame 8361, third 8388.
At 9361: 28 frames, curtain absent, transitioning=false, scene=dsb,
backend=false, room=off. One /api/me attempt; no /room WebSocket or SFU session.
Voice receives an empty peer set; shared remote pool is created once. NPC sync
is hub-owned and is not initialized for DSB. No account retry blocks readiness.

The previous 120-second *session* timeout was not a readiness timeout. CDP tracing
locates the stall after the menu and zone assertions, on return to Bifrost:
DSB leave completes in 15 ms; Bifrost renders its window picture, then
CanvasRenderingContext2D.getImageData blocks on software GPU readback.
Canvas-only rendering with accelerated 2D canvas disabled completes the same
readbacks in milliseconds and passes the desktop behavioral assertions.
No production bypass or timeout increase has been applied. Final browser gate
results must be reviewed separately; this diagnosis alone does not approve them.

Further browser diagnosis: the manually unpacked serverless Chromium fontconfig
still named `/tmp/fonts`, while the actual fonts lived in the workspace. Studio
crashes recorded `FATAL: SkFontMgr_FontConfigInterface.cpp:163 Not implemented`.
The local configuration now names the unpacked font directory and system fonts.
This environment correction does not alter application CSS, tests or thresholds.
Canvas integration without trace logging passed **63/63** (50 browser checks and
13 unit checks). The readback problem also reproduces when capturing the approved
pre-merge build, so it is not evidence of a new merged rendering regression.

Additional measured factory times in the hosted trace (milliseconds): water
5481–5643, remote-player pool 5891–5892, nature 5968–6482, enrichment 6577–6933,
Olympus 6966–7098, interior registry 7117–7119. Each was created once. The
static account promise settled before DSB construction; no repeated scene or
room initialization was observed. Public market/radio feeds are separate from
the absent multiplayer backend and produced network errors in the unrestricted
probe; deterministic feed fixtures are used by the regression suite.

After font configuration repair: Studio **115/115**, SVRN functional **32/32**,
shoreline **58/58**, exterior unit **7/7**. Worker **39/39**. Focused units:
water **34/34**, vacancy **13/13**, SVRN **20/20**, menus **61/61**, Portara **8/8**.
Build regenerated 200 scripts, 13,051 KB (gzip 6,089 KB); syntax passed for 206
source/test files and whitespace validation passed.

WebGL review capture remains blocked: `Page.captureScreenshot got no reply in
5 s`. This reproduces in both Chromium 153 and 131, and against the approved
pre-merge page as well as the merged page. Functional Portara WebGL/phone checks
pass, but its combined gate is **24/25** because the visual-evidence capture
fails. SVRN visual stops at **21/22** before completing all views, and vacancy
browser capture stops early. These are incomplete gates, not approved visuals.
No timeout was increased and no screenshot check was skipped.

Venue-menu validation reaches **105/106** before the 120-second session cap,
including the runner's one automatic retry. It does not complete the reference
112-check gate. This remains a validation blocker; thresholds are unchanged.

Radio/TV completes **91/91**. Interior regression hits the 120-second session
limit before completion; the automatically started retry was stopped once the
remaining browser infrastructure blockers were established. No complete
75-check interior result is claimed.

## Previous handoff state

The original workspace and in-progress merge are preserved. Eight conflicted
paths have resolved working-tree edits but are still unmerged in the index.
No merge commit or subsequent commit was created, nothing was pushed, and no
Pages deployment was triggered. HEAD remains
`bd033e04ac1e4ac3c815c2c0e36ce0908339e38f`; MERGE_HEAD remains
`822addee5f3971c9a47da228e4935e57fb576ab7`. Both remote branch hashes were checked
again and still match. The static root and deployed preview are unchanged.

Changes in this validation continuation: the documented Olympus expectation,
production-equivalent pool test fixture, validation report, and a Pages step
for the already-created Worker/integration tests. The generated page was rebuilt.
Temporary CDP tracing was removed from the test driver. No DSB production
geometry or networking behavior was changed, no assertion was dropped, no
timeout was increased, and no lazy loading was introduced.

## Browser validation continuation

The existing workspace and merge state are preserved. Screenshot operations are
now separate from functional review checks: every review camera is still visited,
its existing semantic assertions still execute, and renderer health plus advancing
frames are checked without reading pixels. `DSB_REVIEW=1` adds bounded screenshot
attempts. Successful captures are retained. Only a five-second CDP capture timeout
on an identified software GPU, with the approved-build baseline explicitly
acknowledged, can produce an advisory capture report. A post-timeout health query
must prove advancing frames, no GL/context/renderer errors, and no runtime errors
or failed semantic checks. Other failures remain gating. Capture operation time
has its own bounded clock; the functional session limit remains 120 seconds.
The Pages job does not use blanket `continue-on-error` for evidence.

No Bifrost picture feature is removed. DSB review views do not need a Bifrost visit;
the functional Portara travel test still performs its real return. CDP compositor
capture and Bifrost Canvas `getImageData` are the measured blocking operations;
the exact internal driver defect is not established. Capture timeout reproduces
on the approved build and two Chromium versions, so it alone does not establish
a merged rendering regression.

The interior suite contains no screenshot or Bifrost visit. Progress tracing
located its accumulated delay in sequential touch-start acknowledgement before
touch release, during expensive exterior Canvas frames. The helper now queues
release after 40 ms, then awaits both acknowledgements, matching the existing
mouse-click driver's input sequencing. All ten door cycles and original assertions
remain. Desktop and phone pass **75/75**, each within the unchanged session limit
(about 99 and 102 seconds). Both preserve 3,206 nodes, 439 geometries, one cached
room, seven input targets, three audio sources, one AudioContext, one radio source,
15 listeners, zero active rooms/lights/water textures/remote players outside, and
release the old registry and AudioContext on departure.

Recovered review semantics: SVRN **39/39**, vacancy **25/25**. The increased totals
include explicit renderer-health checks at every former screenshot location.

Venue-menu tracing isolates another harness cost: the five interior venues and
Spaces complete in about 32 seconds; exterior Noderunner frames then cost roughly
0.6–1.9 seconds each. Separate CDP commands between opening, simulation, layout
measurement, and health measurement unnecessarily wait behind additional frames.
The harness batches those related operations and the twelve synchronous lifecycle
open/close pairs, retaining all 30 simulation ticks per route, all nine route/size
combinations, real advancing-frame health checks, and the final listener/DOM
comparison. No production rendering, viewport, content, or assertion is changed.

After batching, venue validation completed in 101 seconds: 140/142, with every
behavior/renderer check passing and only the two clean-console checks failing
on `net::ERR_EMPTY_RESPONSE`. Its Spaces dialog still fetched the live public
archive, unlike Studio's deterministic archive fixture. The shared DSB harness now
provides the same three-entry fixture for that exact public archive endpoint.
Console assertions remain strict; no production request or fallback is changed.

## Final functional run

Build/regeneration, syntax of 265 files, and whitespace validation passed.
The generated monolithic page contains 200 scripts (13,051 KB, gzip 6,089 KB).
No lazy loading or dynamic imports were introduced.

| Gate | Result |
| --- | --- |
| Shared integration, desktop/phone plus units | 64/64 |
| Worker auth/protocol/ownership/room/voice/SFU mocks | 39/39 |
| Clean upstream with production-equivalent pool fixture | 128/130 |
| Merged global unit suite | 176/178 |
| Studio desktop/phone | 115/115 |
| SVRN functional | 35/35 |
| SVRN WebGL review semantics | 39/39 |
| Vacancy browser | 25/25 |
| Venue menus | 142/142 |
| Radio/TV | 91/91 |
| Interior desktop/phone | 75/75 |
| Portara/shared | 31/31 |
| Shoreline, including water/Olympus units | 58/58 |
| Exterior units | 7/7 |

Both upstream failure lines and their full state payloads match exactly in this
final comparison. Zero new global-unit failures. All requested functional browser
gates pass. Venue menus completed in 82 seconds; interior desktop/phone in 101/116
seconds, below the unchanged 120-second functional limit. Earlier failed/incomplete
runs above are diagnostic history, superseded by these functional results. Visual
capture evidence remains a separate result and is not inferred from these counts.

The eight original conflicted paths retain semantic resolutions:

| Path | Resolution |
| --- | --- |
| `.github/workflows/pages.yml` | Build stable root from fork rock and isolated feature preview; preserve functional gates and add shared/Worker validation; separate qualified capture evidence. |
| `oogaboogaland.html` | Regenerate from combined sources. |
| `src/js/canvas-renderer.js` | Combine newer upstream renderer changes with DSB portal, water, and interior rendering. |
| `src/js/gl-renderer.js` | Combine upstream fixes with DSB effects; keep DSB and upstream lake material markers distinct. |
| `src/js/crew.js` | Retain upstream ownership/multiplayer behavior and DSB seating, weapons, and wading support. |
| `src/js/scene-dsb.js` | Preserve approved world/interiors and integrate shared global sheet, presence, remote players, and venue zones. |
| `src/js/weather.js` | Keep upstream shared weather API and adapt DSB use. |
| `test/run.mjs` | Combine both validation histories, retain approved regressions, document exact upstream baseline failures, and separate semantic checks from capture. |

The global sheet remains available in DSB with its persisted state, shared account,
roster and voice controls; local venue menus retain their own input/focus isolation.
Static preview remains single-player, with one unavailable-account check and no
room/SFU connection. Shared identity/body ownership continues through travel;
remote filtering suppresses duplicates and scene exit clears DSB presence.
Voice zones are `dsb-outside`, `dsb-studio`, `dsb-maxis`, `dsb-without-rulers`,
`dsb-proof-of-ink`, `dsb-big-bitcoin`, `dsb-meme-factory`, `dsb-stackchain`, and
`dsb-svrn`. Noderunner stays outside; interior exit restores outside; scene exit
clears the DSB zone. Bifrost outbound travel retains the DSB tunnel; return crosses
the rectangular Portara membrane and uses the normal short Director transition.
VAC 1–35 remain frozen, including SVRN Society in VAC 7.

## Final capture evidence

All requested review routes were attempted separately after the functional gates.
SVRN evidence passed 39/39, vacancy 25/25, Portara 16/16, shoreline 47/47,
venue menus 142/142, and SVRN menu evidence 35/35. These totals include unit checks
and renderer/semantic assertions; they do not claim screenshots exist when capture
failed. There are 36 successful Canvas images (30 menu views, three SVRN menus,
three Portara states) and 28 explicit unavailable WebGL capture reports (nine SVRN,
five vacancy, three Portara, eleven waterfall/coast). Representative desktop and
phone menu images and the rectangular active Portara image were inspected.

A Canvas menu capture timed out once; the existing fresh-browser infrastructure
retry completed all images. That timeout was not waived as a WebGL limitation.
Vacancy initially failed the five-second post-capture health query. The evidence
recovery query now has a bounded ten-second window, separately timed; screenshot
attempts remain five seconds and functional sessions remain 120 seconds. On the
successful vacancy run the actual recovery queries took 1.935–3.189 seconds, with
five to seven advancing frames. Thus the earlier scheduling/readback delay was
not reproduced; the data does not establish an application hang or prove that the
extra recovery allowance was necessary on the successful run. Every advisory
capture still requires strict positive health proof. The internal SwiftShader /
Chromium compositor defect remains unidentified. Successful images and unavailable
reports cannot be confused with stale files: each evidence target is cleared
before its capture attempt.

The final validation and capture state snapshots are in
`docs/dsb-upstream-validation-results.json`. No application behavior was changed
in this browser-validation continuation. Production Bifrost window pictures remain
intact, and functional return-to-Bifrost validation passes.
