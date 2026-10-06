# Maxis Club media theater

Starting checkpoint: `4d592e34b43362358e9c2425111484a6426148df` — `Fix DSB Studio stage seating`, on `feature/dsb-land-master`.

## Room and concept comparison

The supplied Maxis concept board is the composition reference: a narrow timber entrance with framed frog/Bitcoin art and a patterned runner; an upper rear reveal onto dense red seating; a large curtain-framed screen; side galleries with brass/dark timber railings, green lounge chairs and table lamps; a separate rear-right timber bar with bottle shelves, stools, low lounge tables, rugs and plants. The screen has original pixel frog artwork and green/orange accents. Paneled walls, brick inserts, ceiling trusses, lights, speakers, curtain folds and small brass details carry the private-club theme.

The room follows the board's composition in OogaBoogaLand's block style: the lobby is compact, the screen dominates the stepped room, the side galleries look into the auditorium, and the bar occupies the rear-right social area. The side galleries are raised platforms connected to the rear landing, rather than a second stacked floor with an accessible room beneath. Cushioned bevelled seats, diamond-patterned rugs, amber/green bottles, glasses, a drinks board, brass details, brick inserts and suspended practicals complete the dressing. Five views were rendered with the project's actual Canvas 2D renderer in Node and compared to the board again before commit. Large shell faces were subdivided to improve fallback visibility of wall art and the lighting rig. This checks composition and physical geometry; it does **not** validate WebGL lighting, touch controls, live providers or runtime camera behavior. Final visual approval remains with Yellow.

There are **50 seats**: 40 theater, six side-gallery and four bar-lounge chairs. Decorative bar stools are not interaction seats. Every registered seat uses the existing `crew.sitPlayer` / `standPlayer` contract, `allowWeapons` and `lockMovement`, with the normal first-person seated camera and one existing Stand Up action. No second seating implementation was added. Yellow's measured body height is 1.369926 units and collision radius is 0.697001. Seat tops are 0.48 above their floor; the bar top is 1.055 above its floor; steps rise 0.16. Main rows are spaced three units apart to leave collision-clear cross aisles. Gallery entrances connect through the rear landing.

The Studio builder, furnishings and archive; Meme Factory builder; Noderunner; exterior geography; water, weather, daylight and nature sources are unchanged. `scene-dsb.js` extends the current seat/weapon/context routes to the Maxis room. The interior registry gains only a Maxis entry. The normal shared interior ambience is reused, with no new movement, jump or tomato sounds.

## Media

The in-club media player (YouTube, Twitch, X and direct URLs) was removed before merge: it loaded provider SDK scripts in a same-origin frame, which `AGENTS.md` does not allow. The physical screen shows the club's original artwork. Video can return later as cross-origin provider embeds or from a separate origin. The validation record below predates that removal; its media checks went with the player.

## Validation and manual review

Focused command: `node test/run.mjs maxis-unit`. It uses the real geometry, collision and crew functions; measures Yellow; checks all 50 seat sit/stand, movement lock, aiming/fire and tomato actions, a flood of reachable floor positions and bounded shared geometry.

Build and all nine changed JavaScript/module syntax checks passed. The 10 grouped Maxis deterministic checks passed, including all 50 seats, actual collision-query flood navigation, provider switching through every adapter, stale/foreign-message rejection, retaining the same frame across fullscreen toggles, volume/page-hide behavior and three visit cycles. The existing 55 Studio geometry/seat checks passed. The room contains 1,700 nodes sharing 88 geometry objects and five real lights. Whitespace and staged-site checks passed. Chrome startup was blocked by the environment's socket permissions (`Operation not permitted`); the separate Work browser also refused the local preview (`ERR_BLOCKED_BY_CLIENT`). No local browser success is claimed. Deterministic media checks use a DOM/transport double, not live provider playback. GPU residency, actual audio and real fullscreen continuity still need browser review.

Manual GitHub Pages checks still required:

- Compare lobby, main reveal, screen, side galleries and bar to the supplied board in WebGL; check brightness, furniture scale and frame rate on phone.
- Walk the corridor, all stairs, rear landing, both galleries, every row and the screen console. Check camera wall/ceiling clipping and wide-character movement.
- Sit in main/gallery/lounge seats; free look; verify one Stand Up control; equip, aim and fire; throw tomatoes; stand safely. Repeat using touch.

Review query: `?scene=dsb&debug=1&interior=maxis-club`, with `view=maxis-lobby`, `maxis-theater`, `maxis-balcony`, `maxis-bar`, `maxis-screen` or `maxis-seat`.
