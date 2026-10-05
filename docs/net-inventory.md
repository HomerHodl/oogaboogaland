# Networking inventory

What the OBL-Audio prototype (`rules-without-rulers/OBL-Audio`, branch `lab`) already proves, and what this repository has to change to host live players. Line numbers are from the prototype's `lab` branch as of 2026-09-26 and will drift; the file names will not.

## The prototype

A Worker (`obl-audio`, custom domain only) with static assets, one Durable Object room and the Realtime SFU for voice. Its milestones M0–M10 are mostly done; the two-person live checks and 3G throttling are still open, and a "ghost invasion" game has grown on top that this project does not port.

| File | Job |
|---|---|
| `wrangler.jsonc` | assets (`run_worker_first: ["/ws", "/api/*"]`), DO `ROOM` → `Room` (SQLite), vars `POLICY_AUD`, `REALTIME_APP_ID` |
| `src/worker/index.js` | resolves identity, forwards `/ws` and `/api/voice/*` to the room with `x-player-*` headers |
| `src/worker/identity.js` | the Cloudflare Access JWT check (`jose`), the only file that knows who is calling |
| `src/worker/room.js` | the room: presence, snapshots, the voice rules, the SFU calls, the game |
| `src/worker/sfu.js` | the Realtime SFU REST client |
| `public/js/protocol.js` | message catalogue and client-message validation (512 characters max) |
| `public/js/net.js`, `backoff.js` | the socket and its reconnect backoff |
| `public/js/voice.js`, `voicepeers.js` | the two peer connections and the hearing rule |
| `public/js/audio.js`, `fire.js` | the campfire loop, its gain and its shared playhead |

Bindings, vars and secrets: `ASSETS`, `ROOM`, `POLICY_AUD` (var), `REALTIME_APP_ID` (var), `TEAM_DOMAIN` (secret), `REALTIME_SECRET` (secret), and for local dev only `DEV_BYPASS` and `GAME_DEBUG`.

## Identity: the seam to replace

- `identity.js` verifies the Access JWT from `Cf-Access-Jwt-Assertion` or the `CF_Authorization` cookie against `${TEAM_DOMAIN}/cdn-cgi/access/certs`, checking issuer and audience. Missing config is 503, no token 401, a bad token 403.
- The player key is the token's **`sub`**; the name is the part of the email before `@`.
- `index.js` sets `x-player-id`, `x-player-name`, `x-player-avatar` on the upgrade and `x-player-id` on voice calls; the room trusts those headers (`room.js` ~1131) and uses the id as the socket tag and for voice ownership.

Here: identity comes from the D1 session (`getSessionFromRequest` in `worker/src/http.js`), the key is the GitHub numeric id, and the Worker strips any client-sent `x-player-*` before setting its own. Access, `TEAM_DOMAIN`, `POLICY_AUD` and `jose` do not come over.

## The room

- Hibernation API: `ctx.acceptWebSocket(server, [id])`, `setWebSocketAutoResponse` for ping/pong, `serializeAttachment` on every state change, roster rebuilt from attachments in the constructor.
- Persisted state: only `audioStartedAt`. Everything else is memory and is lost on hibernation or deploy.
- Positions: a **15 Hz `setInterval`** sends one `snapshot` of every player only when something moved. Moves are not validated for speed or bounds.
- An alarm every 5 s evicts sockets silent for 30 s (auto-responses count) and restarts the tick.
- Client → room: `move{x,y,facing,ts}`, `ping`, `avatar`, `mic{state}` (plus the game's messages).
- Room → client: `welcome{you,tickHz,serverTime,players,voice,fire{x,y,radius,fullRadius,audio{src,startedAt}}}`, `snapshot{seq,ts,players[{id,x,y,facing,f?}]}` (`f` = inside the fire circle), `join`, `leave{id,reason}`, `kick{reason}`, `voice{peers}`, `avatar`, `mic`.

## One connection per person

On upgrade, `ctx.getWebSockets(id)` finds the older socket and `evict` it: remove the player, broadcast `leave`, send `{ t: "kick", reason: "replaced" }`, then `close(4000)`. The explicit `kick` exists because a server close can leave the client stuck in CLOSING. The client, on `kick` `replaced`, **stops reconnecting** and offers to take over; on `kick` `stale` it restarts. Otherwise it reconnects with backoff (500 ms × 1.7, capped at 15 s, ±25% jitter). Without the stop, two tabs of one person replace each other forever.

Caveats noted there: `webSocketClose` must not call `ws.close()` on its compatibility date, and Chrome's intensive throttling sweeps a tab hidden for about five minutes.

## Voice (Realtime SFU)

- API base `https://rtc.live.cloudflare.com/v1/apps/{REALTIME_APP_ID}`, bearer `REALTIME_SECRET`; `POST sessions/new`, `POST sessions/{id}/tracks/new`, `PUT …/renegotiate`, `PUT …/tracks/close` with `force: true`.
- Browser → Worker → room: `/api/voice/{session,publish,pull,renegotiate,close,leave}`.
- Two peer connections: publish (browser offers a `mic` track, SFU answers) and receive (`pull` returns the SFU's offer, the browser answers through `renegotiate`).
- Who hears whom (`desiredPeers`): listener and speaker both inside the fire circle, the speaker publishing. The room recomputes it each tick and sends `voice{peers}` when a list changes, and **re-checks it on `pull`**, refusing anyone not allowed.
- The client diffs wanted against current peers through a serialized queue: stop and close dropped ones, pull new ones. `welcome` after a reconnect restarts voice.
- Gain per peer falls to silence at twice the fire radius.
- Gap: nothing closes SFU sessions when a player leaves or a socket closes.

## The campfire loop

An `HTMLAudioElement` looping `audio/campfire.wav` (from `scripts/fetch-audio.sh`, licence unverified). Time-aligned: the room's persisted `audioStartedAt` goes out in `welcome`, clients play at `(serverNow − startedAt) mod duration` and re-seek past 250 ms of drift. Gain is 1 inside radius 120 and eases as (1−t)² to 0 at 461.

## Carried over, and changed

| Prototype | Here |
|---|---|
| Access JWT, `sub`, email name | D1 session, GitHub id, login or display name |
| 2D positions, no validation | 3D pose on the island, bounds from `terrain.js` `RADIUS` 30 (grid ±31), rate capped |
| campfire circle | the banana pile at the origin (its footprint grows: `pile.visualFootprintFor`) |
| `.wav` in an `<audio>` element | a synthesized loop in Web Audio: `media-src` allows only the radio host, and AGENTS.md allows no audio files |
| 15 Hz interval, 5 s stale alarm, kick then 4000 | kick then 4000 kept; the interval became a one-shot flush per pose burst and the alarm runs once a minute (90 s stale), so the room can hibernate |
| hearing rule inside the circle, checked on `pull` | kept, anchored on the pile |
| SFU sessions never closed | closed on leave, sign-out and socket close |

## What changes in `src/js/` for live players

- `crew.create` builds cavemen only from `contributors.roster` (`crew.js` ~431–443) and has no add API. Remote players are a separate pool, `remote-players.js`, rendering `models.caveman(contributors.traitsFor(login))` (any name works) and entering the crew's collision through the existing `ctx.outsideActors` (`crew.js` ~3184), so the NPC logic is untouched.
- A contributor signed in elsewhere would also run as an NPC here: the pool hides the roster caveman with that login while the player is live.
- Local possession goes through `pilot.possess` → `crew.control`, which refuses unless the Ooga is working, chilling or sleeping and built in the active roster (`crew.js` ~4734); a non-contributor needs its own body from the pool.
- The hub has no sound gate; only `weather.js` checks `navigator.userActivation`. The pile loop and voice need an "Enable sound" control.
- `net.js` is started by `director.js` behind `nosim` and `net=0`, as the other feeds are, so the suite stays offline.
