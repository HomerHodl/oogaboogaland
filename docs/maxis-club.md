# Maxis Club media theater

Starting checkpoint: `4d592e34b43362358e9c2425111484a6426148df` — `Fix DSB Studio stage seating`, on `feature/dsb-land-master`.

## Room and concept comparison

The supplied Maxis concept board is the composition reference: a narrow timber entrance with framed frog/Bitcoin art and a patterned runner; an upper rear reveal onto dense red seating; a large curtain-framed screen; side galleries with brass/dark timber railings, green lounge chairs and table lamps; a separate rear-right timber bar with bottle shelves, stools, low lounge tables, rugs and plants. The screen has original pixel frog artwork and green/orange accents. Paneled walls, brick inserts, ceiling trusses, lights, speakers, curtain folds and small brass details carry the private-club theme.

The room follows the board's composition in OogaBoogaLand's block style: the lobby is compact, the screen dominates the stepped room, the side galleries look into the auditorium, and the bar occupies the rear-right social area. The side galleries are raised platforms connected to the rear landing, rather than a second stacked floor with an accessible room beneath. Cushioned bevelled seats, diamond-patterned rugs, amber/green bottles, glasses, a drinks board, brass details, brick inserts and suspended practicals complete the dressing. Five views were rendered with the project's actual Canvas 2D renderer in Node and compared to the board again before commit. Large shell faces were subdivided to improve fallback visibility of wall art and the lighting rig. This checks composition and physical geometry; it does **not** validate WebGL lighting, touch controls, live providers or runtime camera behavior. Final visual approval remains with Yellow.

There are **50 seats**: 40 theater, six side-gallery and four bar-lounge chairs. Decorative bar stools are not interaction seats. Every registered seat uses the existing `crew.sitPlayer` / `standPlayer` contract, `allowWeapons` and `lockMovement`, with the normal first-person seated camera and one existing Stand Up action. No second seating implementation was added. Yellow's measured body height is 1.369926 units and collision radius is 0.697001. Seat tops are 0.48 above their floor; the bar top is 1.055 above its floor; steps rise 0.16. Main rows are spaced three units apart to leave collision-clear cross aisles. Gallery entrances connect through the rear landing.

The Studio builder, furnishings and archive; Meme Factory builder; Noderunner; exterior geography; water, weather, daylight and nature sources are unchanged. `scene-dsb.js` extends the current seat/weapon/context routes to the Maxis room. The interior registry gains only a Maxis entry. The normal shared interior ambience is reused, with no new movement, jump or tomato sounds.

## Local media architecture

`maxis-media-data.js` holds curated `picks`, a `live` config and URL validation. Add records with `id`, `title`, `provider`, `url`, `tags` and `description`. No real content is invented: the initial pick is an offline Live from Yellow slot. The YouTube URL in deterministic tests is the official API documentation's example, not a curated recommendation.

`maxis-media.js` owns the panel and exactly one active **provider document** at `src/maxis-player/index.html`. That document loads only the chosen provider's official SDK/player. A provider can have its own nested embed iframe; that is part of the same player, not a second simultaneous source. On switching, the old provider document is removed before the replacement is inserted. Leaving the venue removes it, clears its timeout and releases playback. Scene disposal removes the panel and its listeners. Messages check both origin and exact source window, so late replies from replaced players cannot affect the new source.

The main game's script and style policy remains self/hash-only. Only same-origin frames are added to that policy. The separate player document narrowly permits the requested official YouTube, Twitch and X scripts/frames and HTTPS direct media. This scoped provider integration is the explicit task's exception to the repository's general no-external-scripts rule. No `unsafe-inline` or `unsafe-eval` was introduced.

The physical screen shows original club artwork while idle and a local-screening status while media is active. Provider video plays in the visible, compact DOM player or fullscreen. Cross-origin provider pixels are **not** copied into WebGL. No render target, video-texture pipeline, extra AudioContext or hidden duplicate video player was added.

The menu is nonmodal and has Maxis Picks, YouTube, Twitch, X / Twitter, Direct URL, Live and Search. While browsing or fullscreen, game input is held; Return to club restores it. For volume-controllable providers the same player remains visible in a smaller dock. Fullscreen keeps the same iframe; exiting preserves provider playback position. A device-filling CSS view is the fallback if the browser refuses or lacks the Fullscreen API.

| Provider | Implemented behavior | Limits requiring live browser review |
| --- | --- | --- |
| YouTube | Official IFrame API; video and playlist URLs; provider play/pause/fullscreen; origin and referrer identity | Private, age-restricted or embed-disabled content may fail. Error 153 has a specific message. Browser gestures still apply. |
| Twitch | Official interactive player for live channels/VODs; official clip iframe; current hostname in `parent` | Minimum 400 × 300 player: narrow phones may need landscape. Clips have no interactive volume API. |
| X / Twitter | Official `twttr.widgets.createTweet`; public individual post URLs; original-link fallback | Provider restrictions may prevent display or embedded video. No scraping, timeline promise, pause API or volume API. |
| Direct URL | HTTPS MP4, WebM, supported audio extensions, native-browser HLS | Codec/server/browser support is required. No HLS.js, transcoding or arbitrary webpage embedding. |
| Search | Case-insensitive title/description/tag filtering of configured picks | No global provider search or secret API key. |
| Live | Offline state, or configured `direct`, `youtube` or `twitch` viewer URL | No relay, ingest endpoint or native WebRTC receiver currently exists in this repository. |

YouTube, Twitch channel/VOD and direct media receive venue gain: strong throughout the theater, softer toward the lobby, zero on mute/page hiding where the provider/browser permits volume control. This is venue attenuation; cross-origin providers do not expose stereo spatialization. Exiting always removes the entire player document. X posts and Twitch clips cannot be controlled this way, so Return to club, mute, volume zero or hiding the tab stops/disposes them. Loading them while muted is refused with a clear message. Their UI explains this limitation; they are watched while the menu is open. Some mobile browsers reserve media volume for hardware controls; real-device attenuation must be checked manually.

## Live from Yellow: remaining infrastructure

Configure `live = { mode: "direct", url: "https://your-public-relay.example/live.m3u8", label: "LIVE FROM YELLOW" }` only after a real viewer endpoint exists. YouTube/Twitch viewer URLs can instead use their corresponding mode. `offline` is the shipped default. Never put an OBS stream key, WHIP ingest token, private machine URL or TURN secret in this file.

For OBS/Linux → WHIP → viewers, still required:

1. A public HTTPS relay supporting authenticated WHIP ingest, operated separately from Yellow's machine. OBS sends a selected broadcast output; this does not publish remote-desktop access.
2. A public viewer output compatible with the implemented adapter: a supported direct stream (HLS only on browsers with native support), or a supported platform player URL.
3. For native WebRTC viewing instead, a documented WHEP/signaling endpoint, CORS rules, ICE/STUN/TURN service and short-lived viewer credentials where needed, plus a new client receive adapter. WHIP is ingest, not a browser playback URL. This task does not pretend to implement that infrastructure or adapter.

Global YouTube search could later use a server endpoint holding the Data API key, with input validation, rate limits, quota controls and bounded responses. The static client would call that endpoint. It must not embed the key in GitHub or browser code.

Official references checked during implementation:

- https://developers.google.com/youtube/iframe_api_reference
- https://dev.twitch.tv/docs/embed/video-and-clips/
- https://docs.x.com/x-for-websites/embedded-posts/overview

## Validation and manual review

Focused command: `node test/run.mjs maxis-unit`. It uses the real geometry, collision and crew functions; measures Yellow; checks all 50 seat sit/stand, movement lock, aiming/fire and tomato actions, a flood of reachable floor positions, bounded shared geometry, provider URL validation, Live/filter behavior, and the actual media controller with a DOM transport double for switching, stale replies, fullscreen element retention, mute, three visit cycles and disposal. It does not fetch or prove external provider playback.

Build and all nine changed JavaScript/module syntax checks passed. The 10 grouped Maxis deterministic checks passed, including all 50 seats, actual collision-query flood navigation, provider switching through every adapter, stale/foreign-message rejection, retaining the same frame across fullscreen toggles, volume/page-hide behavior and three visit cycles. The existing 55 Studio geometry/seat checks passed. The room contains 1,700 nodes sharing 88 geometry objects and five real lights. Whitespace and staged-site checks passed. Chrome startup was blocked by the environment's socket permissions (`Operation not permitted`); the separate Work browser also refused the local preview (`ERR_BLOCKED_BY_CLIENT`). No local browser success is claimed. Deterministic media checks use a DOM/transport double, not live provider playback. GPU residency, actual audio and real fullscreen continuity still need browser review.

Manual GitHub Pages checks still required:

- Compare lobby, main reveal, screen, side galleries and bar to the supplied board in WebGL; check brightness, furniture scale and frame rate on phone.
- Walk the corridor, all stairs, rear landing, both galleries, every row and the screen console. Check camera wall/ceiling clipping and wide-character movement.
- Sit in main/gallery/lounge seats; free look; verify one Stand Up control; equip, aim and fire; throw tomatoes; stand safely. Repeat using touch.
- Test a permitted YouTube video/playlist, Twitch live/VOD/clip, public X post with media, MP4/audio and native HLS on a supporting browser. Verify provider errors and mobile gestures honestly.
- Confirm screen click/console/button opens the menu, local picks filter, and unconfigured Live displays offline.
- Enter → play → switch each provider → fullscreen → return at the same playback position → close sources → sit → exit → re-enter, three times. Check one active provider, no overlapping sound, no audio outside, no stale embeds/listeners and no progressive renderer/resource growth.
- Verify lobby attenuation for controllable providers, X/clip disposal on Return to club, mute/tab hiding, and player teardown on scene departure.

Review query: `?scene=dsb&debug=1&interior=maxis-club`, with `view=maxis-lobby`, `maxis-theater`, `maxis-balcony`, `maxis-bar`, `maxis-screen` or `maxis-seat`.
