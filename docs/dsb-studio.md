# DSB Studio (Milestone 9A)

Only DSB Studio is added to the reusable DSB interior registry. The Meme Factory builder and exterior geography are unchanged.

## Visit and controls

The Studio exterior door uses Space / the existing action button / the contextual touch button. The room begins at elevation 3 in a dim corridor, with the archive terminal to the left and an enterable ticket booth with a corridor-facing service window to the right. A rear gallery overlooks four rows of eight audience seats and central/side stairs. Two side balconies add four sittable lounge chairs with small tables; their entrances connect to the rear landing. The lower stage has a brick sign wall, stand-up microphone and stool, two audience-facing talk-show chairs, a coffee table, mugs and rug, a separate wooden host desk with its own chair, plus a visible ceiling lighting rig.

Approach the front of a seat and use the same interaction to sit. Space or the single normal **STAND UP!** action button returns to the clear row aisle. Seated walking input is ignored; look, weapon selection, aiming and fire remain available. The seated view uses the existing first-person camera and restores the follow/shoulder view on standing. **T** or **Throw tomato** uses the shared crew projectile pool. Lighting is authored; there is no stage-light control.

Audience and balcony seats use the existing crew seat contract with opt-in `allowWeapons` and `lockMovement`. Camp seating retains its prior behavior. The host chair uses that same contract and faces the audience; the two guest chairs remain decorative.

## Public archive source

Inspected on 2026-10-03. https://hodlerhiq.net/ links five DSB archive pages:

| Archive | WordPress page ID |
| --- | --- |
| Year five | 2679 |
| Year four | 1537 |
| Year three | 1261 |
| Year two | 1233 |
| Year one | 2 |

The public WordPress REST source is `https://hodlerhiq.net/index.php?rest_route=/wp/v2/pages/2679` (same route for the other IDs). Requests restrict fields to `content`. Its `content.rendered` includes playlist entries with `data-mediafile`, `.player_song_name` and `data-albumname` (episode date). No guest/speaker field is supplied, so none is fabricated. Audio URLs are HTTPS MP3 files under the site's `/wp-content/uploads/` directory.

The API responds with `Access-Control-Allow-Origin: https://yellowbrokeit.github.io` when sent that Origin, including for all five archive pages. No credentials, proxy, token, feed invention or background scraping is involved. The app parses the response in an inert DOM and copies only bounded text/date/allowlisted audio URLs. It does not render remote HTML or execute remote scripts. CSP adds only `https://hodlerhiq.net` to `media-src`.

Each archive is fetched on demand and cached during the current Studio visit. Up to 150 dated entries per archive are shown, searchable locally. There is a 15-second request timeout and 3 MB response guard. Failed loads show a retry/source-link message. The data source is a third-party public site and may change or be unavailable.

One lazy HTML media element provides play/pause, previous/next, stop and seeking when duration is available. No extra AudioContext is created for the archive. Closing the dialog keeps playback running at the cabinet. Volume falls quadratically over four units beyond the near zone and reaches zero before the theater (z ≤ 9.2). Returning restores audibility without playing, seeking, or recreating the media element; leaving the Studio aborts requests, pauses and unloads audio, removes media listeners and clears the visit cache. Scene departure also removes the dialog and UI listeners. Existing room ambience is synthesized locally and reduced while a nearby Space is audible. Studio-only footsteps, jump/landing and tomato throw/splat sounds have been removed without replacements. The shared projectile pool and capped visual splat effects are retained. Exterior weather and Noderunner audio use the existing interior mute gates.

## Rendering and lifecycle

Room geometry builds lazily once per DSB scene visit. Shared dressing meshes cache each chair/prop type; repeated seats and brick colors use the renderer's existing geometry instancing. There are three non-shadow-casting point lights, no new framebuffer and no decoration updates per frame. Existing low-quality light limits comfortably include all three lights. Scene exit releases room nodes and player/seat references. Audio, pending fetches and projectiles do not cross the door transition.

## Correction design references

The host desk adapts the broad wooden front, shallow top and host-behind-desk arrangement from the [Carson set](https://entertainment.ha.com/itm/movie-tv-memorabilia/memorabilia/johnny-carson-s-iconic-home-base-interview-desk-swivel-chair-guest-chair-guest-couch-coffee-table-and-full-array-of-set-el-total-17/a/7318-89236.s), [Leno desk](https://entertainment.ha.com/itm/movie-tv-memorabilia/props/jay-leno-s-home-base-interview-desk-from-the-tonight-show-with-jay-leno-nbc-tv-1992-2014-/a/7318-89237.s) and [Conan interview composition](https://www.newscaststudio.com/2018/01/16/conan-new-set/). It uses original block geometry, not copied set imagery.

The MP3 server currently omits Access-Control-Allow-Origin, although the JSON API supplies it. Native HTML audio playback is retained: routing these MP3s into a Web Audio MediaElementSource would silence them under CORS. Browser media volume supplies the fade; the zero boundary also sets `muted`. Physical iOS Safari requires a manual attenuation check because some versions reserve media volume for hardware controls. No credentials or proxy are added.

Review views (with `scene=dsb&debug=1&interior=dsb-studio`): default corridor, `studio-reveal`, `studio-balcony`, `studio-stage`, `studio-seat`, `studio-host`, `studio-booth`, `studio-mic`. Use the named `dsb-preview/index.html` deployment route.

## Concept polish — pending browser validation

The supplied concept board guides the lower dark ceiling and corridor, burgundy runner, dark balcony lattice rails, smaller maroon seat backs, warm aisle lights, folded curtains, stacked gold DSB / STUDIO lettering and microphone emblem directly against brick. The guest conversation area sits to the left, the lowered wooden host desk to its right, and the stand-up mic at the far right. Furniture remains original cached block geometry. The stage rig is lowered to frame the backdrop; the room retains its existing walk surfaces and three lights.

Measured Yellow: body height 1.370, body radius 0.697, standing face/head range approximately 0.881–1.288 above the floor. The ticket opening is 0.75–1.40 above the booth floor. The mic head is 0.949 above the stage, at the model's lower face. Desk top is 1.04 above the stage; seated host face starts at 1.279 above it. The host chair shares the existing seat interaction, with an audience-facing initial view and a clear stand point behind the desk. There are 37 seat anchors: 32 audience, four balcony and one host.

Available validation: normal build, syntax checks and whitespace checks pass. A headless geometry audit using the real room builder and interior collision function passes ten checks, including all stand points, booth/corridor/balcony access, host approach, window/desk scale and light budget. The existing browser checkpoint is updated to include the host in repeated seated weapon/archive cycles.

Browser validation is **not complete** for this polish. Chrome could not start because required local sockets were denied; the environment rejected escalated execution. No current visual captures, touch/gameplay, live media, or repeated renderer/listener lifecycle results are claimed. The user authorized publishing this existing correction after rerunning the available build/static/geometry checks, with interactive browser validation remaining manual. Manual review covers concept similarity; booth face alignment; microphone, desk and chair scale; host Sit / single Stand Up; seated gun/tomato actions; touch controls; jukebox playback/attenuation; and repeated entry/exit isolation and cleanup. Prior results below describe the earlier correction only.

## Previous correction validation

- Build and syntax/static checks pass.
- 25/25 focused touch checks pass at 390×844, including three complete seated gun/tomato/archive cycles, one stand-up control, sound cues, attenuation/return, exit cleanup and full DSB departure/re-entry.
- Desktop interaction/lifecycle checks pass. An initial navigation fixture aimed beyond the safe room edge for Yellow's measured 0.697-unit body radius; the fixture now targets the balcony aisle. The final desktop navigation audit confirms both complete balcony aisles, all seat approaches, corridor and ticket-booth access.
- All 28 seats sit and stand successfully; held movement reaches the stage and returns to the entrance. Standing and seated tomato throws trigger the generated throw/splat sounds. Renderer records and listener counts stay bounded across repeated visits.
- Meme Factory passes movement, current-weather restoration, ten room cycles and AudioContext disposal. Noderunner TV/radio/jukebox regression checks pass. The one console-only failure is the known software-GPU ReadPixels stall warning; no application error was logged.
- A real Year-five MP3 decoded under the Pages origin and CSP. Playback advanced from 4.85 to 7.70 seconds across silent theater / audible cabinet positions without replay; pause and exit disposal passed. The public archive returned 32 entries.
- Final corridor, upper reveal, balconies, stage, booth and mobile seated views were inspected. No lighting UI remains; three authored point lights remain.

## Original implementation validation (before correction)

- Normal build, JavaScript syntax checks and whitespace checks pass.
- Studio focused lifecycle: 17/17 desktop and 17/17 at 390×844 with real touch events. Three complete enter/sit/fire/throw/stand/play/exit cycles, then a full DSB departure/re-entry; no listener or warmed renderer-record growth.
- All 24 seats sit and stand successfully. Held movement traverses the center stairs down to the stage and back to the corridor. Seated look changes direction; keyboard V fires three existing gun rounds and T throws from the shared projectile pool.
- Live Year-five JSON supplies 32 entries. A real MP3 decoded and advanced with duration 42:07; exit left zero media elements, requests or cached archive items in the controller. Other archive routes and public CORS headers were verified with small requests.
- Existing Meme Factory functional checks pass, including ten door cycles and restoration of current night/rain. Noderunner radio/TV/jukebox correction checks pass. One Meme Factory console-only assertion encountered the known software-GPU ReadPixels stall warning; no application error was logged.
- The global unit run still encounters the pre-existing cave-dimension and mirror failures, then the unrelated breakables fixture exception. These were not changed.
- Desktop/phone layout inspection keeps all player controls visible with an independently scrolling archive list. Visuals were inspected in clear light, low quality and storm/late-day exterior conditions.

Physical-device sound balance, hardware GPU performance and final artistic approval remain human review items. No other venue interior is implemented.
