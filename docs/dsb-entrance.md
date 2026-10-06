# DSB entrance: ₿IFRÖST → wormhole → Portara

Walking through the DSB window in the ₿IFRÖST chamber no longer cuts straight to the summit. It plays, every time:

1. **The wormhole.** The visitor walks it: W, ↑ or the left stick forward. The four entrance recordings (Saylor,
   Frankie, Jack, Paolo) play as the walk passes their marks, over the entrance music; the walk lasts as long as the
   recordings and their gaps (about 36 s), or 24 s while no sound is ready. Rings run from ₿IFRÖST's blue to the
   Portara's gold, streaks rush past, and ribbons of light drag behind the walker's head, hands and heels, stretching
   with the pace and drawing back in when it stops.
2. **The arrival.** A white flash, the Portara's membrane open, the Ooga stepping out of it.
3. **The flight.** About 18 s round the island: up over Olympus, the Chora, the south coast and the harbor, back in
   through the Portara to the walker's shoulder. Then the walk begins exactly as before.

Skip in the wormhole lands the walker at the Portara at once. Skip tour, Space, Enter or Escape end the flight.
Escape or "Back to ₿IFRÖST" in the wormhole goes back to the chamber. M mutes it with everything else. With
`prefers-reduced-motion` the flight is left out.

A direct visit (`/dsb`, `?scene=dsb`) still lands on the island without it, so every review address works as it did.
`?scene=dsb&debug=1&entrance=1` plays it without the walk from ₿IFRÖST.

## How it sits in the scene

`dsb-entrance.js` (`BL.dsbEntrance.create`) owns all of it. The passage is a group 200 m above the island that draws
alone under its own render options while `exterior` is hidden, so no island layer is involved. The camera is taken
with `pilot.setExternalControl`. The ribbons use the renderer's existing glass light beam (`glass` + `lightBeam`), so
neither renderer changed and Canvas 2D draws them too.

The visit's first frame is still the island's, under black: its meshes reach the GPU before the passage hides it, so
the arrival does not stall on them.

`scene-dsb.js` reaches it through one-line hooks: create after `walk()` when `ctx.from === "bifrost"`;
`entrance?.update(dt,time)` at the top of `update` (true while the wormhole owns the frame; in the flight the island's
update runs on under the flight's camera, with `overview` held so the walker stays put); `entrance?.action(name)` and
`entrance?.onKey(e)` ahead of the scene's own; `entrance?.overlay(...)` for the flash; dispose in `leave`.
`__ooga.dsb.entrance` carries `phase` (`tunnel`, `arrival`, `done`), `progress` and `flight`, and `__ooga.audio` is the
entrance audio while it lives.

`dsb-audio.js` gained `fade(seconds)`. The entrance never calls its `arrive()`: that starts the old island's ambience
and the radio stream, which the master layout's weather and Noderunner own now. The music fades out after the flight
and the context closes.

The HUD is the page's existing `.dsb-intro` and `.dsb-arrival-card` under the `dsb-entry` and `dsb-arrival` body
classes, with a Skip button added to the first.

## Checked

Headless, WebGL and Canvas 2D: the walk in from the chamber as the widest Ooga, the wormhole to its end, the arrival,
the whole flight and the hand-over to the walk; Skip in the wormhole and in the flight; Escape back to the chamber and
in again; mute; two re-entries under the `?debug=1` leave contract with identical node, geometry, GPU record and
target counts; a direct visit unchanged. Not run: the browser suite, and any real GPU or phone.
