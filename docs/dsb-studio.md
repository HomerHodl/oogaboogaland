# DSB Studio (Milestone 9A)

Only DSB Studio is added to the reusable DSB interior registry. The Meme Factory builder and exterior geography are unchanged.

## Visit and controls

The Studio exterior door uses Space / the existing action button / the contextual touch button. The room begins at elevation 3 in a dim corridor, with the archive terminal to the right. A rear gallery overlooks four rows of audience seating and central/side stairs. The lower stage has a brick sign wall, stand-up microphone and stool, two talk-show chairs, a table, mugs and rug, plus a visible ceiling lighting rig.

Approach the front of a seat and use the same interaction to sit. Space or the contextual **Stand up** button returns to the clear row aisle. Seated walking input is ignored; look, weapon selection, aiming and fire remain available. The seated view uses the existing first-person camera and restores the follow/shoulder view on standing. **T** or **Throw tomato** uses the shared crew projectile pool. **Stage lights** changes the balance of the two stage lights.

Audience seats use the existing crew seat contract with opt-in `allowWeapons` and `lockMovement`. Camp seating retains its prior behavior. Stage chairs are decorative in this milestone.

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

One lazy HTML media element provides play/pause, previous/next, stop and seeking when duration is available. No extra AudioContext is created for the archive. Closing the dialog keeps playback in the Studio; leaving the Studio aborts requests, pauses and unloads audio, removes media listeners and clears the visit cache. Scene departure also removes the dialog and UI listeners. Existing room ambience is synthesized locally and reduced while a Space plays. Exterior weather and Noderunner audio use the existing interior mute gates.

## Rendering and lifecycle

Room geometry builds lazily once per DSB scene visit. Shared dressing meshes cache each chair/prop type; repeated seats and brick colors use the renderer's existing geometry instancing. There are three non-shadow-casting point lights, no new framebuffer and no decoration updates per frame. Existing low-quality light limits comfortably include all three lights. Scene exit releases room nodes and player/seat references. Audio, pending fetches and projectiles do not cross the door transition.

## Validation at this checkpoint

- Normal build, JavaScript syntax checks and whitespace checks pass.
- Studio focused lifecycle: 17/17 desktop and 17/17 at 390×844 with real touch events. Three complete enter/sit/fire/throw/stand/play/exit cycles, then a full DSB departure/re-entry; no listener or warmed renderer-record growth.
- All 24 seats sit and stand successfully. Held movement traverses the center stairs down to the stage and back to the corridor. Seated look changes direction; keyboard V fires three existing gun rounds and T throws from the shared projectile pool.
- Live Year-five JSON supplies 32 entries. A real MP3 decoded and advanced with duration 42:07; exit left zero media elements, requests or cached archive items in the controller. Other archive routes and public CORS headers were verified with small requests.
- Existing Meme Factory functional checks pass, including ten door cycles and restoration of current night/rain. Noderunner radio/TV/jukebox correction checks pass. One Meme Factory console-only assertion encountered the known software-GPU ReadPixels stall warning; no application error was logged.
- The global unit run still encounters the pre-existing cave-dimension and mirror failures, then the unrelated breakables fixture exception. These were not changed.
- Desktop/phone layout inspection keeps all player controls visible with an independently scrolling archive list. Visuals were inspected in clear light, low quality and storm/late-day exterior conditions.

Physical-device sound balance, hardware GPU performance and final artistic approval remain human review items. No other venue interior is implemented.
