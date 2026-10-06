# DSB Land — Milestone 5 Mediterranean nature

Base: `091c9a2af0effcdecaf738b61688c2549d642f66` (approved Milestone 4).

## Reuse and boundaries

`dressing-mediterranean.js` extends `BL.dressing` with cached block geometry,
using the existing `models.box`, transforms and `merge`, alongside the kit's
existing palm/islet builders. `dsb-nature.js` owns DSB placement and visit lifetime.
It uses `dsbGeography.heightAt` (interpolation of the rendered triangles), building
footprints, road/trail polylines and landmark metadata without editing geography.
The existing `dressing.flock` supplies five coastal gulls, not new animal AI.

The scene creates nature once, updates it in its existing loop after weather,
and disposes it on exit. No additional RAF, timers, listeners, requests, textures,
framebuffers, collision systems or dependencies. All dressing is non-colliding;
placement exclusions keep large silhouettes off walking routes. No interiors,
Noderunner runtime, goats, cats or other gameplay are restored.

## Placement and terrain contact

Seed 51037 and the existing `mulberry32`/`fnv1a` produce stable, varied clusters.
Tree/rock spacing reserves room for trunks and larger silhouettes. Prefix subsets
retain the same positions at lower quality. There is no world-aligned planting grid.

Each candidate samples the centre, eight points around its contact footprint and
all authored bottom vertices transformed by its yaw/scale. Trees stay upright on
mild slopes. Ground cover and rocks conform their bases to a sampled ground plane;
residual height differences reject sharp ledges. A tiny root inset seats contact
vertices below the surface rather than leaving gaps. Height is recomputed from
terrain on every scene build; no landscape object uses a fixed world Y. Static
placement does no terrain work per frame.

Masks keep plant/rock bounds away from the trail, seafront road, village lanes,
rotated buildings, Portara, the clearing centre and its Chora sightline/sign site.
The harbor apron, piers and Noderunner approach are reserved. Coastal vegetation
starts above the active waterline and inside supported ground. Rear Olympus has
an additional 12 m coastal exclusion: no beach strip is added behind the mountain.

Upper Olympus remains mostly exposed rock with sparse small vegetation. Lower
slopes receive more shrubs, grasses and rock clusters; trees favor gentle low
terrain and village edges. The clearing stays open. Bougainvillea occupies village
side walls, with terracotta flower planters at selected rear corners; fronts and
entrances stay clear. Harbor planting is restrained and coastal rocks remain
small enough to leave the approved shallows visible.

## Rendering, wind and tiers

Nine fixed-capacity instance fields share cached geometry; gulls add one batch.
This is the renderer's existing `instanceData` path (20 floats per instance), not
one node/draw per plant. Each field has an island-bounded frustum sphere. Small
plants additionally use camera-distance culling (110/80/50 m at high/medium/low);
the overview retains the tier's full island distribution. Buffers are repacked
only when the camera moves over 4 m or quality changes, with no new frame arrays.
There is no need for a parallel chunk generator on this small static island.

Existing GPU `sway` reads the Milestone 4 wind **strength**, through one per-species
factor. It retains the renderer's existing fixed sway direction/phase. Storms
increase motion modestly; low quality and Canvas disable it. No new wind model or
weather changes. All geometry uses existing daylight/fog/lightning lighting;
flowers are opaque, non-emissive. Only the two tree species cast shadows.

Full overview counts (distance culling may lower ground-view counts):

| Dressing | High | Medium | Low / Canvas |
|---|---:|---:|---:|
| Olives | 55 | 47 | 39 |
| Cypress | 28 | 26 | 23 |
| Shrubs | 410 | 267 | 156 |
| Ground cover | 280 | 140 | 56 |
| Dry grass tufts | 1600 | 720 | 192 |
| Flowers | 200 | 120 | 50 |
| Rocks | 150 | 113 | 83 |
| Bougainvillea | 28 | 24 | 20 |
| Planters | 19 | 17 | 14 |
| **Static instances** | **2770** | **1474** | **633** |
| Gulls | 5 | 3 | 0 |

## Review controls

Existing `scene=dsb`, `overview=1`, `debug=1`, `day=80`, `time=` and `weather=` work
unchanged. A debug-only `view=clearing` uses the existing named-view convention to
start walking in the reserved natural clearing facing Chora; it has no effect
without debug. `overview=1` takes camera precedence. The debug overlay adds only
visible/total nature counts and seed. Ordinary play still starts at Portara.

Use `/oogaboogaland/dsb-preview/index.html`, since the existing router treats a
directory as a site-root route. Review queries:

- `scene=dsb&overview=1&debug=1&day=80&time=1200&weather=clear`
- `scene=dsb&view=clearing&debug=1&day=80&time=1200&weather=clear`
- `scene=dsb&overview=1&debug=1&day=80&time=1730&weather=clear`
- `scene=dsb&overview=1&debug=1&day=80&time=1200&weather=storm`

## Validation

Build and syntax checks pass. The focused nature checkpoint measures actual
transformed bottom vertices against the real terrain, tests terrain translation,
clear route corridors, finite geometry, quality reduction and storm wind, and
re-enters DSB twice through the director's real leave/enter contract. Its behavior
assertions pass. The existing weather checkpoint's behavior assertions also pass,
including night rain, temporary flashes, thunder, exterior audio suppression,
water response and clear-weather recovery. The two approved water textures remain.

The global unit run reproduces the exact cave-dimension and mirror-health failure
lines on an untouched archive of this milestone's starting commit, followed by
the same breakables fixture exception. No unrelated fix is included. Strict
browser console checks report the previously documented SwiftShader `ReadPixels`
performance warnings; these are not counted as clean suite passes. No new
application exceptions were observed in focused checks. Hardware/mobile FPS is
not certified by Work's software renderer. The old portal roundtrip timeout from
Milestone 4 is not rerun; direct DSB re-entry is verified here.

The current baseline houses remain exterior shells; absent old interiors,
Noderunner runtime and detailed storefront/sign assets are not recreated. Their
building fronts and the planned clearing sign location remain protected.

Desktop and phone-view behavior checks pass, including two repeated DSB entries.
The final bundled build was inspected at clear noon, a ground-level clearing view,
late day (17:30), storm and night rain. Canvas fallback boots with 633 static
instances and no gulls/sway. Measured active renderer geometry batches increase
from 122 with nature hidden to 132 with nature shown: ten additional batches,
not thousands of draw calls. No application errors were reported by these visual
checks; the original water renderer still owns exactly two textures.
