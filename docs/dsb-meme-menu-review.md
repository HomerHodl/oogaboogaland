# Meme Factory and spatial DSB menus

Scope: rebuild Meme Factory only; preserve the other approved interiors and the merged DSB entrance/world. No Stackchain Magazine interior is added. Proof of Ink's existing magazine display still opens its existing editorial collection.

Starting checkpoint was verified against GitHub before editing: repository `YellowBrokeIt/oogaboogaland`, clean branch `feature/dsb-land-master`, local HEAD = origin HEAD = `1ab1b86646f1156f508707420ef84719c914607d`, merge PR #4, “DSB entrance: wormhole from Bifrost, Portara arrival and island flight”.

## Factory

The supplied approved concept drives a new 36 × 42 industrial room: charcoal shell, exposed trusses/pipes, amber practical fixtures, blue media signs, a red elliptical laser installation, real contributor portraits, editing desks, equipment racks/carts/cabling, acoustic recording booth, producer console, archive drawers/boxes/books, plants, and seven shared-framework seats. The existing exterior door and entry/exit controller remain in use. The engine's stylized geometry approximates the concept; it does not reproduce its photographic materials.

The factory uses six actual lights, cached furniture, shared monitor meshes, and bundled static portrait meshes/thumbnails. No podcast or external video autoplays. Its audio uses the existing interior bus and the existing exterior weather/radio gate.

Public sources checked 2026-10-04:

- https://www.memefactorytm.com/ and current contributor pages linked in its navigation.
- https://www.memefactorytm.com/pod/ (official Apple Podcasts, Spotify, Podcast Index, RSS destinations).
- https://www.memefactorytm.com/media/ and https://www.memefactorytm.com/nostr/.
- https://knowyourmeme.com/memes/laser-eyes-bitcoin-trend-laserrayuntil100k (February 2021 trend, edited profile pictures, $100,000 hashtag, February 16 @CHAIRFORCE_BTC origin).

The twelve contributor portraits are Gregzaj, RD, yellow, Chairforce, Labrahodl, Plan Marcus, Swedetoshi, Big Sean, Micro Chad, World of Rusty, Bekka and Pedro. Nostr is linked as the site's directory, not invented as a thirteenth person. No biographies or affiliations are invented. No standalone current merchandise menu was verified, so the optional retail corner is omitted.

## Shared menus

`dsb-menu-shell.js` owns viewport positioning, safe-area margins, world/HUD isolation, focus return/trapping and temporary listener cleanup. It follows `visualViewport` for mobile keyboards and orientation. Tall content scrolls within the bounded panel. Maxis keeps its existing player and native/fallback fullscreen implementation.

`dsb-menu-zones.js` resolves rectangles against Yellow's current position. Priority is person/collection, section, general venue, then the venue's real home. Opening an already-open menu does not override navigation. Every fresh opening chooses the current context; exit resets page/search/item state. One strongest contextual action is displayed; seating and the actual exit remain usable.

| Venue / physical area | Initial route IDs |
| --- | --- |
| Meme entrance / production / archive | `home` |
| Meme laser installation | `laser` |
| Meme general creator gallery | `contributors` |
| Meme specific portraits | `gregzaj`, `rd`, `yellow`, `chairforce`, `labrahodl`, `plan-marcus`, `swedetoshi`, `big-sean`, `micro-chad`, `world-of-rusty`, `bitcoin-bekka`, `pedro` |
| Meme recording booth / producer console | `podcast` |
| Without Rulers fixtures | `shirts`, `hoodies`, `hats`, `art`, `bip85`, `samourai`, `slavery`, `cartel`, `2140`; fallback `home` |
| Proof of Ink fixtures | `apparel`, `shirts`, `hats`, `fine-arts`, `collabs`, `stackchain-magazine`, `proof-of-work`; fallback `featured` |
| BIG BITCOIN press / research / merch | `news`, `research`, `merch`; lobby, boardroom and control room fallback `overview` |
| DSB Studio jukebox | DSB Spaces only. Seating/stage/ticket booth receive no fictitious menu pages. |
| Noderunner shared physical TV | `main`; explicit Radio target → `radio`; explicit Request target → `jukebox` and request-input focus |

Nakamoto and Last Hash remain accessible in Proof of Ink's original catalog. No separate labeled physical fixtures were present to justify new zones. Archive/production/boardroom/control zones do not manufacture public categories.

Noderunner service functions are preserved: stream, metadata polling, queue/history, search, invoice creation, checksum/amount validation, local QR, payment polling, fallback links, distance attenuation, shared weather/interior gate. This change adds route entry and shared presentation only.

## Validation

- `node test/run.mjs dsb-menus-unit`: 49 local deterministic checks passed.
- Tests cover navigation with actual Yellow dimensions, shared seating/free-look/safe standing, ten room visits, route priority/fallbacks, shell focus/inert/listener lifecycle, official redirects, and existing Maxis provider/fullscreen controller contracts.
- The actual merged entrance controller is stepped through wormhole walking, Portara receive, island flight and restored exterior controls.
- Eighteen protected entrance/world/other-room/radio source files are byte-identical to the starting commit; `scene-dsb.js` retains entrance construction/update/disposal and receives only menu/seating/review wiring.
- Build, changed JavaScript syntax, whitespace and complete site packaging are checked locally.
- Local Chrome cannot start because the workspace denies its socket. The first hosted WebGL attempt timed out before a first frame (49 unit checks passed, no menu assertions ran). The Pages workflow uses the supported Canvas 2D backend for DOM/interaction validation on its software runner and runs the new measured browser menu checks, plus the existing radio/Lightning, Studio and interior checkpoints, before deployment. It retains screenshots and a failure ledger as `dsb-menu-review`.
- Hosted validation passed: menus 100/100, radio/TV 79/79, Studio 103/103, interiors 63/63 (each includes the 49 unit checks). Desktop, narrow portrait and landscape menu bounds are measured. Visual review also lowered the entrance portal into the walking camera's sightline, aligned the laser ring tangentially, added static editing previews and cleared the archive review angle.
- WebGL visual fidelity on a hardware GPU, real provider playback, real wallet/payment completion, actual iOS/Android keyboards/notches, hardware frame rates and native provider fullscreen still require manual checks. Deterministic service fixtures do not prove provider availability.
- `oogaboogaland.html` is a generated local build output; repository instructions assign generated output commits to CI. Source and tests are committed; that local generated output is not manually committed.

## Review links

Use the preview, not the stable root. `debug=1` enables these review poses and menu entry links. Query routes select actual semantic zones and choose a walkable point before opening. Close a menu to inspect its room.

- [Factory entrance](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=meme-factory&view=meme-entrance)
- [Laser booth](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=meme-factory&view=meme-laser)
- [Contributors](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=meme-factory&view=meme-contributors)
- [Production floor](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=meme-factory&view=meme-production)
- [Recording studio / control booth](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=meme-factory&view=meme-studio), [inside recording booth](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=meme-factory&view=meme-recording)
- [Archive](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=meme-factory&view=meme-archive)
- [Laser menu](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=meme-factory&menu=laser), [Yellow contributor](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=meme-factory&menu=yellow), [Podcast](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=meme-factory&menu=podcast)
- [Without Rulers hoodies](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=without-rulers&menu=hoodies)
- [Proof of Ink fine arts](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=proof-of-ink&menu=fine-arts)
- [BIG BITCOIN research](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=big-bitcoin&menu=research)
- [DSB Studio jukebox](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=dsb-studio&view=studio-jukebox&menu=spaces)
- [Noderunner TV](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&view=noderunner&menu=main), [Radio](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&view=noderunner&menu=radio), [Jukebox / Request](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&view=noderunner&menu=jukebox)
- [Preserved wormhole arrival](https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&entrance=1)
