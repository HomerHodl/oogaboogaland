# DSB master layout — Milestone 1

Branch starts at fork rock `50e120902bcaa6887ae90901cbcd45270fd49046`.
This is a geography checkpoint, not approval of the final island composition.

Open `?scene=dsb&overview=1` for the fixed aerial view. Add `&debug=1&nosim=1`
for local inspection without the page-owned live feeds. Island overview/Escape
releases the camera; Walk resumes the same canonical character where it stood.
Bifrost still enters scene `dsb`; return uses the summit Portara Dialer and a
physical crossing, with identity handed back through `world.pilot`.

## Composition

Coordinates are X east/right, Z south/front in the overview.

- Olympus: northwest mass, summit (-45, -48), height 39. One triangle heightfield
  connects the terraced slopes, trail, countryside and coastline. Rear cliff
  terrain meets the sea without the inhabited-shore beach grading.
- Portara: stone jambs and lintel on the summit; upstream Ooga Portal timing,
  modal, membrane and crossing logic, with its circular rim hidden.
- Trail: five descending switchbacks cut into that same surface, ending at the
  clearing (-8, 23). The future CHORA direction-sign anchor is (-5, 25).
- Countryside: unbuilt terrain between the mountain, clearing and eastern town.
- Chora: southeast cluster of 12 simple property masses, named in the geography
  registry. Seven named venues and five vacant lots; blue doors face their
  assigned waterfront road or internal lane. Interiors are deferred.
- Harbor: southwest inlet and two piers; Noderunner at (-61, 30), separate from
  Chora. A future berth anchor is reserved at (-38, 54). No catamaran yet.
- Waterfront road: one continuous route around the harbor and along Chora's
  seaward edge. Inland lanes branch through the town.

`dsb-geography.js` owns one cached grid. `heightAt`, `groundAt` and `supportAt`
interpolate the rendered triangles, not an independent approximation. Movement
samples that surface and rejects water/buildings or excessive height changes.
Building foundations use terrain samples; no old island slabs or stair props
are imported. Marine piers intentionally stand over water. Current simple sea,
block masses and ground colors are placeholders, not Clearwater or final art.

## Systems to port selectively after geography approval

Inspected `origin/feature/dsb-land-redesign`, plus current rock's DSB modules.
No old branch was merged or modified.

- Portara concept: retain Greek endpoint identity; current controller reused.
- `dsb-audio.js`: transition skip/stop, regional ambience and proximity radio.
- Prior `dsb-models.js`/`scene-dsb.js`: named house registry, door anchors and
  Meme Factory interior lifecycle. Rebuild exterior anchors for this terrain.
- `dsb-tv.js`: NodeRunner screen, metadata/request flows; attach to harbor later.
- `dsb-agent*` and `dsb-conversation.js`: Zuzu physical/session/validated-action
  and conversation boundaries. Not instantiated in this geography milestone.
- `dsb-data.js`: shared chain freshness and on-demand historical candles.
- Canonical crew/pilot, input, HUD and FX are active now. Upstream dressing and
  solid-prop systems are candidates for later decoration/interiors; no duplicate
  dressing system is introduced here.

Old modules remain in source/history for selective reuse; the new scene does not
instantiate the old exterior, rides, TV, radio or agents. Their old browser tests
are not certification of this replacement scene and will need milestone-specific
updates as systems return.

## Preview deployment

The branch workflow builds current remote rock into the Pages root (including
its existing routes/cards) and builds this revision only into `/dsb-preview/`.
It has no cron and no repository-write permission. Stable rock is not edited.
A later deployment from rock can replace the combined Pages artifact and remove
this preview; rerun this branch's workflow to restore it. Durable multi-branch
preview retention needs a separate agreed stable-workflow change.

## Validation limitation

The fast global suite on the starting upstream baseline fails surface-cave c3
geometry and mirror damage, then throws at `test/run.mjs:8574` reading position.
Those same failures remain; the crash prevents downstream global checks from
running. No claim of a green full suite or approved geography is made.
