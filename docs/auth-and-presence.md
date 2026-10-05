# Sign-in and presence

How a visitor becomes a player on the Cloudflare-hosted island. Everything here lives in `worker/` and `src/js/net.js`; the page served anywhere else (GitHub Pages, a file, `npm run serve`) finds no backend and behaves exactly as before.

New Oogatron contributors can receive a server-verified default character before
their file reaches a deployed bundle. Eligibility, merge-time generation and the
PR ownership check are described in [Contributor onboarding](contributor-onboarding.md).

## Pieces

| Piece | Where | Job |
|---|---|---|
| Static site | `_site/` (the page as `index.html` and each `<route>.html`), staged by `npm run build:site` | the whole game, served by the Worker's assets binding with the headers in `worker/_headers` |
| Worker | `worker/src/index.js` | runs only for `/auth/*`, `/api/*` and `/room` (`run_worker_first`); everything else is the static page |
| D1 `oogaboogaland` | `worker/migrations/` | `players` (GitHub id, login, display name) and `sessions` (token hash, expiry) |
| Page modules | `src/js/net.js` (`BL.net`), `src/js/remote-players.js` | the account and the room socket; the other visitors on the island. The sheet footer shows the account and the online count through `hud.showAccount` |
| Room | `worker/src/room.js` (Durable Object `Room`) | one socket per signed-in player, presence and poses |

## Signing in

1. The footer's **Sign in with GitHub** calls `BL.net.login()`, which navigates to `/auth/login?next=<current path>`.
2. `/auth/login` (rate limited, 10 a minute per IP) makes 32 random bytes of `state`, stores `state.<next>` in a ten-minute `HttpOnly` cookie (`__Host-obl_oauth` on https), and redirects to GitHub's authorize page. No scopes are requested: the public profile is all we read.
3. GitHub sends the visitor to `/auth/callback?code=…&state=…`. The Worker checks `state` against the cookie in constant time and clears it, trades the code for an access token, reads `GET https://api.github.com/user`, and **discards the token**.
4. The player row is upserted by GitHub's numeric id (a renamed login stays the same player). A banned player gets 403.
5. A session is 32 random bytes; the browser gets it in `__Host-obl_session` (`HttpOnly; Secure; SameSite=Lax; Path=/`, 30 days) and D1 keeps only its SHA-256. The visitor lands back on `next`, which must be a same-site path.

## Being signed in

- `GET /api/me` answers `{ "player": null }` or `{ "player": { id, login, display, look, createdAt } }`, always 200, so a signed-out page logs nothing. `avatar_url` stays server-side while the content policy blocks GitHub images.
- The session is touched at most once every ten minutes, so reading it is not a write per request.
- `PATCH /api/me` with `{ "display": "…" }` sets the in-game name: the character set of `donations.sanitize`, 3–24 characters.
- A cron at 04:00 UTC deletes expired sessions; they are refused on read before that anyway.

## Signing out and leaving

- **Sign out** posts `/auth/logout`, which deletes that session row and clears the cookie. `/auth/logout?all=1` ends every session of the player.
- `DELETE /api/me` deletes the player and every session.
- Every state-changing request must carry the site's own `Origin` (or `Sec-Fetch-Site: same-origin`); anything else is 403.

## What is stored

For a signed-in player: GitHub id, login, avatar URL, the chosen display name, sign-in and last-seen times, and for each session its token hash, times and the first 120 characters of the user agent. Nothing for visitors who never sign in. No GitHub token is ever stored.

## Presence

A signed-in visitor holds one WebSocket to `/room` for the page life. The Worker checks the site `Origin` and the session, strips any client `x-player-*` headers, sets its own (`id`, `login`, `display`) and hands the upgrade to the Durable Object `Room` named `island` (`worker/src/room.js`); the room trusts only those headers.

| Direction | Message | Meaning |
|---|---|---|
| client → room | `{ t: "body", name }` | the Ooga being driven, by name; `null` when free roaming or outside the hub |
| client → room | `{ t: "pose", x, y, z, yaw }` | that Ooga's feet and heading, at most 10 a second from the page, 20 allowed |
| client → room | `{ t: "zone", name }` | where that Ooga is: `outside`, `hq` or `cave-<id>`; voice is shared within one place |
| client → room | `{ t: "hub", on }` | this page shows the island in a visible tab: it can host the NPCs and receives their frames |
| client → room | binary | the NPC host's frame: Ooga poses, gear, status and work, then its events (see The crew in step) |
| client → room | `"ping"` every 10 s | answered `"pong"` without waking the room |
| room → client | `welcome { you, players, tickHz, now, loopEpoch, host, followers }` | on connect: everyone else and their last pose |
| room → client | `join { p }`, `leave { id, reason }`, `body { id, name }` | the roster changing |
| room → client | `state { now, ps }` | at most 15 a second while poses arrive, none while nobody moves: `ps` is flat `id, x, y, z, yaw` runs |
| room → client | `host { id, followers }` | the page that runs the NPCs now (0 for none) and how many pages follow it; binary frames from it follow while any do |
| room → client | `voice { peers }` | the ids this player should hear, sent when the list changes |
| room → client | `release { name, reason }` | a claim refused (`not-yours`, `owner-here`, `taken`, `unknown`) or an Ooga taken back by its arriving owner |
| room → client | `kick { reason }`, then close 4000 | `replaced` (a newer tab), `stale` (90 s silent, swept once a minute), `full` (32 players) |

Frames the room cannot read close with 4400; out-of-bounds poses and unknown types are ignored. The pure rules are in `worker/src/protocol.js` with their checks in `worker/test/`.

On the island (`src/js/remote-players.js`), each remote visitor driving an Ooga appears as that Ooga with their name over it, eased toward the room's poses. Its row in the Ooga Boogas panel shows the green online dot on every screen while it is driven, as it does for the Ooga this visitor drives. The local crew's copy of the same Ooga steps `away` while someone else drives it and comes back when they let go, so no Ooga stands twice; the NPC crew keeps working and walks round remote bodies. A visitor who is free roaming or in another game is not shown.

### Who drives which Ooga

Every Ooga belongs to a contributor, and ownership keys on the GitHub login alone: a character's `github`, or its handle when it has none (`bc1gui` is owned by `ottoz0r`; a different GitHub account that happens to be called `bc1gui` owns nothing).

- A signed-in contributor drives **only their own** Ooga, and while they are signed in **nobody else** can drive it. The hub hands it to them on arrival (`claimOwnOoga`), once a visit, unless they already drive another. Letting go stays detached until they take control again or revisit; their face beside the location button uses the same possession path as double-clicking their Ooga.
- Everyone else, signed in or not, drives an Ooga only when its owner is **not signed in**, **nobody else** holds it, and it is **not working** (by its real activity; the hub's temporary overrides do not count).
- An owner arriving takes their Ooga back: the room frees it and the driver's page lets go with a notice.

The page enforces all of it (`net.mayDrive`, checked by `pilot.possess` through the scene's `mayPossess`). The room enforces ownership and who holds what (`claimRefusal` in `worker/src/protocol.js`, over the cast `npm run build:site` writes to `worker/src/characters.gen.json`), so a tampered page cannot take a contributor's Ooga; a refused claim answers `release { name, reason }` and is never shown to anyone. Whether an Ooga is working comes from activity the room does not see, so that rule is the page's alone. The rules apply only on the page served by the Worker; without a backend (GitHub Pages, the test suite) any Ooga can be driven as before.

A second tab of the same account takes over: the first is kicked with `replaced`, stops reconnecting, and its sheet footer offers **Play here**. Every deploy drops every socket; pages reconnect on their own with backoff (0.5 s × 1.7, up to 15 s). A tab hidden for five minutes leaves the room (voice stops) and rejoins when it is shown again.

**What keeps the room cheap.** The room is a Durable Object, billed for the time it is awake and for the messages it receives, and it sleeps (hibernates) only when no timer is pending and nothing arrives for a few seconds. So nothing in it runs on its own: a pose schedules one snapshot, voice lists go out when who hears whom can change (a join or leave, a body or zone, a voice session), and the stale sweep is an alarm once a minute. Pings are answered without waking it. The NPC host sends only while another page follows it (`followers`), four frames a second, and skips a frame when no Ooga changed and nothing happened (at most 2 s).

## The crew in step

Signed-in players on the island see the same Oogas doing the same things (`src/js/npc-sync.js`). Without it every page runs its own crew, and random choices and frame timing drift each page apart within seconds.

- **One page runs the crew.** The room elects a host: the page longest in the room among those showing the island (the hub scene, in a visible tab; `{ t: "hub", on }` reports it). The room tells everyone with `host { id, followers }` and hands over when the host leaves the hub, hides its tab or closes.
- **The host streams what shows.** While at least one other page follows it, four times a second it sends one binary frame with every Ooga nobody drives: a header (format, a signature of the crew's names, a record count, the event bytes), one record of floats per Ooga, then the events since the last frame as JSON. A frame identical to the last one sent, with no events, is skipped for up to 2 s. A record carries the body (root position, rotation, quaternion, scale and visibility; legs, arms, head with its eyes open or closed, torso), the gear (which holder the club and rifle hang from, hand, back sling or bed, and their pose; the rifle's bananas; the flash; the snack; the bed's weapons), status (stun birds, fire embers and scorch, colourway, a built-in jetpack's flame) and the work the gorillas follow (state, phase, the cave worked, the cave planned). Events are what happens once: speech, sleep marks, landing dust and jetpack sparks, every banana shot's flight, and the gorillas' plan and hit. About 6 KB a frame for a dozen Oogas. The room takes frames only from the host (16 KB and 20 a second at most), relays them to every other page on the island, and keeps the latest for anyone arriving.
- **Followers pose puppets and replay events.** On every other signed-in page those Oogas are puppets (`cave.puppet`): `crew.update` skips their AI, and npc-sync eases them toward the latest frame after the crew's update, snapping when one jumps far (into a bed, back from a fall). Gear changing holder is moved there and the mirror and outlines refreshed. Events replay through the page's own effects; shots fly as visual-only rounds (`crew.showShot`: no hits, no mirror crossing), and the gorillas get the host's plans and hits, so they travel and react in step without a stream of their own. An Ooga someone drives is never a puppet: its driver's page runs it and the others show it as a remote player.
- **Measured** (at the earlier ten frames a second): two and three pages on one machine kept every Ooga within 0.4 of the host's (0.05 on average), and every undriven Ooga's gear, eyes, colourway and work state identical in samples 6 s apart; a follower replayed the host's sleep marks, 71 shots with their 70 gorilla hits, the gorillas' plans and a poked Ooga's speech. A host closing handed over within seconds and a new page followed the new host.
- Visitors who are not signed in have no room and keep their own crew. No database is involved: the latest frame lives in the room's memory.

The banana pile level, donations, crates and what shots do to the world (the mirror, breakables) stay each page's own. The gorillas' own motion runs on each page from the same plans and hits, so it stays close rather than exact.

## The pile's sound

**Switched off for now (2026-09-27):** the page no longer loads `pile-audio.js` and the hub no longer creates it. The module and the room's `loopEpoch` stay, so turning it back on is its script tag in `src/index.html` and three lines in `scene-hub.js` (create with the remote pool, update with the listener each frame, dispose in `leave`). The description below is how it works when on.

Everyone in the room hears the same fire at the pile at the same moment (`src/js/pile-audio.js`). The room stores the moment the loop started (`loopEpoch`, kept in Durable Object storage so a redeploy keeps the phase) and sends it in `welcome`; each page estimates the room's clock from the timestamps on `welcome` and `state` (`net.serverNow`) and plays the loop at `(serverNow - loopEpoch) mod 8 s`, re-seeking if it drifts past a quarter second. Two pages measured 32–35 ms apart.

The sound is an eight-second crackle over an ember rumble, synthesized in Web Audio from a fixed seed, so the crackles fall at the same seconds on every machine: no audio file. It is quiet on purpose (half its first level), full within 5 of the pile and gone by 16, heard from the driven Ooga, or from where the camera looks while roaming free. It plays only for signed-in visitors while the room is live, starts after the first click or key (browsers allow sound only after a gesture), and honours the page-wide mute (`oogaboogaland.audio`, which the games' M key sets).

## Voice

Signed-in players can talk (`src/js/voice.js`, `worker/src/room.js`, `worker/src/sfu.js`), over a Cloudflare Realtime SFU app per Worker (`REALTIME_APP_ID` in `wrangler.<env>.jsonc`, `REALTIME_SECRET` a Worker secret).

- **Join voice** in the sheet footer asks for the microphone, then becomes **Mute** / **Unmute**; a failure says why on the button.
- **Who hears whom: the same place.** Players driving an Ooga hear each other while they are in the same place: out on the island, in HQ (every HQ entrance leads to the one HQ), or inside one cave. A player in a cave hears only others in that cave, and nobody outside hears them. Within a place every voice plays at the same volume, however far apart the Oogas stand. The page reports its place as `zone { name }` (`outside`, `hq`, `cave-<mouth id>`), from the hub's own cave tracking. A player not driving an Ooga, or in another scene, is out of voice.
- Each page opens two peer connections, one publishing its microphone (the browser offers, the SFU answers) and one receiving (the SFU offers, the browser answers). Every SFU call goes page → Worker (`POST /api/voice/{session,publish,live,pull,renegotiate,close,leave}`, same-site and signed in, 120 a minute) → room → SFU. Only the room holds the secret; a page never sees another player's session.
- A microphone is announced only after its publishing connection is up (`live`): pulling a publication before it connects fails. The room recomputes who hears whom every tick, sends `voice { peers }` when a list changes, and re-checks it on every `pull`, so a page cannot pull a voice it may not hear. Each page applies one change at a time; a failed change is retried once on a fresh receive session before the button says voice is unavailable.
- Sign-out and another tab taking over release the microphone; a reconnect (every deploy) rejoins voice on its own.

The place is reported by the page, as positions are; a tampered page could claim another place to listen there, but only as a signed-in player whose login the room knows.

## Banning

A ban refuses the next sign-in and the next room connection; a socket already open stays until it drops (a deploy drops them all).

```sh
cd worker
npx wrangler d1 execute oogaboogaland --remote --command \
  "UPDATE players SET banned_at = unixepoch(), ban_reason = 'reason' WHERE login = 'someone'; DELETE FROM sessions WHERE player_id IN (SELECT id FROM players WHERE login = 'someone');"
```
