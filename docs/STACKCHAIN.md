# Stackchain Magazine — implementation checkpoint

Status: **validation cleared for publication** following the maintainer’s one-time authorization to correct the article-search test helper. Deployment is verified separately through the GitHub Pages workflow.

## Repository safety

Before editing, `YellowBrokeIt/oogaboogaland` was clean on exactly `feature/dsb-land-master`. Local HEAD, `origin/feature/dsb-land-master`, and the live GitHub branch ref all matched `1c7cf4169c3c0bc33a457100353c17177770dc8e`. The live ref was checked again after implementation and still matched. No reset, discard, stash, merge, cherry-pick or force-push was used. Publication is limited to `feature/dsb-land-master`.

The release commit uses the message `Add Stackchain Magazine interior`. The generated `oogaboogaland.html` is a local build output and is not intended for a hand-authored commit.

## Room and concept comparison

The 32 × 38 room uses the existing Stackchain exterior building and door. A charcoal exposed-beam shell, concrete tiles, dark timber, brass fixtures and amber pendant/desk lamps surround these sections:

- Entrance: large publication masthead, “By plebs for plebs,” welcome rug, lamps, plants and physical magazines. The middle aisle looks into the editorial/library areas.
- Editorial floor: four writing/editing stations, article-layout monitors, keyboards, drawers, drafts, stationery, book stacks, desk lamps and actual public article artwork.
- Reading lounge: two leather chairs, magazine-covered coffee table, lamps, rug and current-article display.
- Archive: repeated actual magazine covers across five shelf tiers, books, archive drawers, reading table and two seats. No invented issue dates or labels.
- Pleb-losophy: mission wall and reading desk tied to the site's actual mission page. It does not claim that this page is an essay index.
- Contributors: verified article bylines and corresponding article illustrations; illustrations are not presented as author portraits. The wall routes to Articles.
- Participation: separate Submissions and Newsletter desks, noticeboards and inbox props. Supporting Donations and Contact stations sit beside the entrance.
- Physical copies: dedicated magazine racks, actual Stackchain covers, display stacks, lamp and official-store route.

Seven views were rendered through the repository's actual Canvas renderer before any commit. The visual pass corrected palette scaling, cover layering and rug layering, and added pendant shades. These are stylized engine geometry, not a reproduction of the concept's photographic materials. Hardware WebGL lighting, actual gameplay-camera views and final fidelity approval remain outstanding. No new render targets or live screens are used.

## Content architecture and source verification

Content was verified on **2026-10-04**:

- Editorial: https://www.stackchainmagazine.net/home/articles-and-blog/
- Mission: https://www.stackchainmagazine.net/home/about/
- Products: **only** https://proofofink.com/stackchain-magazine

`stackchain-data.js` contains six selected articles and twelve selected products. `stackchain-art.js` holds source-attributed, bundled thumbnails and small indexed-color meshes. `stackchain-models.js` caches meshes; `stackchain-room.js` builds geometry; `stackchain-zones.js` owns physical semantics; `stackchain-menu.js` owns the single lazy browse interface. Content refreshes do not require room geometry changes.

The site's HTML advertises `/wp-json/` and `/feed/`. Its public API index advertises `/wp/v2/posts`. A bounded six-post request succeeded and returned the same IDs as the live index: 1755, 1768, 1763, 1770, 1751, 1766. Although the API index did not return a CORS header, the posts response did allow the GitHub Pages origin. The shipped draft deliberately uses a curated snapshot: WordPress's uploader is not necessarily the article's actual byline, and product prices/status require the authorized shop snapshot. There is no runtime fetch or polling.

| Article | Actual byline | Publication date |
| --- | --- | --- |
| Bitcoin’s Potential to Make Craft Great Again | Dug | 2026-09-28 |
| A War on Paper by Spoonman | Spoonman | 2026-09-28 |
| On-chain with Sani. An interview with Anthony & Ratpoison | Anthony & Ratpoison | 2026-09-23 |
| Bitcoin Magazine and the Nakamoto Case: Pump and Dump? | Ratpoison | 2026-09-23 |
| From tomorrow: The key hue didn’t know hue needed | Ratpoison | 2026-09-22 |
| Slay Your Heroes | Sosy | 2026-09-21 |

Article cards show title, byline, date, thumbnail and a short original summary. Full reading always links to the official article. Search is local to the six selected titles/bylines/summaries. Its deterministic search and empty-results check passes after correcting the test helper as described below.

The twelve store entries are selected directly from the authorized category: Session 9 collector/pleb pre-orders; Meme Team 8 silver, pleb and combo editions; the four-pack; IPO 7; issues 4–6 bundle; Ep. 6; protective top-loader; Round 5 with top-loader; Round 5. Exact titles, displayed dollar prices, source images and product destinations are retained. “Listed available” means the source's public `instock` class; explicit title pre-orders and `outofstock` are distinguished. The menu dates the snapshot and asks visitors to confirm current details at the store. No wider Proof of Ink catalog is exposed.

### Refresh procedure

1. Inspect current Stackchain navigation and official article pages. The advertised public posts endpoint can retrieve a bounded candidate list, e.g. `wp-json/wp/v2/posts?per_page=6&_fields=id,date,link,title,excerpt`. Verify bylines in the article bodies; do not substitute the WordPress uploader.
2. Update the six article records, publication dates and concise original summaries in `stackchain-data.js`. Do not copy full articles. Retain stable `article-0` … `article-5` art slots or update their explicit room references.
3. Read **only** `proofofink.com/stackchain-magazine` for the product selection. Preserve exact title/price and linked canonical product URL; never follow add-to-cart links. Confirm public stock/pre-order indicators. Remove unavailable listings when no longer in the authorized category rather than filling slots from unrelated collections.
4. Update `stackchain-art.js`: source-attributed JPEG thumbnails at at most 240 × 260; article meshes 40 × 28, cover meshes 36 × 48, 24-color palettes using RGB **0–255** values and row-major palette indices encoded from `A`. Retain stable cover IDs used by the room, or update the small `archiveIds` list when a cover is retired.
5. Advance `verified`, verify every external link, run the required checks and visually inspect the actual room before publishing. There are no credentials, server components or timers to maintain.

## Shared menus, privacy and seating

The existing `dsb-menu-shell` handles centering, safe-area margins, internal scrolling, focus, world/HUD isolation and close restoration. Its source is unchanged. Existing `dsb-menu-zones` resolves the new room's semantic zones; its source is also unchanged. Fresh interactions resolve the current position; open menus allow free navigation; leaving clears route/query/content. One strongest contextual action is used.

| Physical section | Initial route |
| --- | --- |
| Entrance / unsupported decorative areas | `home` |
| Editorial / article displays | `articles` |
| Current-article reading lounge | `articles` |
| Archive / contributor wall | `articles` |
| Pleb-losophy | `pleb-losophy` |
| Submissions | `submissions` |
| Newsletter | `newsletter` |
| Donations | `donations` |
| Contact | `contact` |
| Physical magazine corner | `physical-copies` |

`christmas` is available through normal menu navigation to the official Christmas Special. No fake Archive, Reading Lounge or Contributors website section is invented. Specific participation/store/support zones outrank the general entrance/Home zone.

All links use `_blank`, `noopener noreferrer` and no-referrer policy. The only input is ephemeral article search. There are no forms, accounts, analytics, customer storage, newsletter email capture, contact/submission capture, carts, checkout or donation/payment handling. Official participation actions leave for Stackchain; purchasing leaves for exact products linked by the authorized Proof of Ink section.

Eight seats use the shared DSB seat contract: two lounge, four editorial and two archive seats. The real Yellow's collision radius was used in path and safe-standing checks. Interior audio uses the existing quiet `shop` room tone and weather/radio gate, restoring exterior state on exit. No new audio system or copyrighted playback is added.

## Validation and resolved test-helper issue

- Build: passed; bundled page about 12.5 MB, gzip about 5.95 MB.
- Changed JavaScript syntax and `git diff --check`: passed.
- Site packaging: passed, eleven pages, nine cards, sitemap and robots output.
- Stackchain/shared-shell focused run: **15/15 passed**. Checks include navigation, all eight seats, semantic routes/fallbacks, bounded data, official links, privacy, ten room/audio cycles, search and empty results, shared-shell lifecycle and Stackchain menu lifecycle.
- Combined shared-menu/venue/entrance deterministic run: **59/59 passed**, including the actual wormhole, Portara arrival, island flight and exterior control-restoration sequence.
- Existing independent `big-unit` suite: **41/41 passed**, covering exterior enrichment and Maxis, Without Rulers, Proof of Ink and BIG BITCOIN contracts. No unrelated failure required an override.
- Seven offline actual-renderer visual views produced. This is not a browser/mobile assertion run.
- Local Chrome failed to start; actual DOM layouts, touch controls, keyboard/notch behavior, complete browser lifecycle, real-provider regressions and hardware WebGL/performance remain unverified.
- Entrance, Portara, atmosphere, town, geography, nature, enrichment, water, shoreline, weather/daylight, renderers, existing room/media sources and shared menu-shell/zone sources are unchanged from the starting commit. `scene-dsb.js` has additive Stackchain menu/seat/review wiring; its entrance construction, update and disposal logic remain structurally intact. The combined 59-check run also exercises the actual entrance controller through wormhole, Portara arrival, island flight and exterior restoration.

The original search check failed twice because the test's DOM double matches tags with `q.includes(c.tag)`. Its `querySelectorAll("input")[0]` could therefore select a paragraph. Work stopped under the `AGENTS.md` retry rule. The maintainer subsequently authorized one additional fix/retry for this specific helper problem.

The correction selects the node whose tag is exactly `input` from the helper's result list. The original one-result and zero-result search assertions and coverage remain intact. The corrected focused run passed on the authorized retry; the failure ledger cleared. No production code or unrelated test was changed under the override.

## Changed files

New: `src/js/stackchain-data.js`, `stackchain-art.js`, `stackchain-models.js`, `stackchain-zones.js`, `stackchain-room.js`, `stackchain-menu.js`, and this document.

Modified: `src/index.html` (load order), `src/js/dsb-interiors.js` (existing exterior registration), `src/js/scene-dsb.js` (shared lifecycle/action wiring), `src/style.css` (Stackchain-only skin), `test/run.mjs` (focused checks and optional offline visual export).

Generated locally: `oogaboogaland.html`; ignored site/render outputs under `untracked/`. No workflow, provider integration or protected branch was changed.

## Review poses

The following review routes become available after the release’s GitHub Pages workflow succeeds. Use the isolated `dsb-preview` path; the stable root is preserved.

Base: `https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html?scene=dsb&debug=1&interior=stackchain-magazine`

| Review | Append to base |
| --- | --- |
| Entrance | `&view=stackchain-entrance` |
| Editorial floor | `&view=stackchain-editorial` |
| Reading lounge | `&view=stackchain-lounge` |
| Archive | `&view=stackchain-archive` |
| Pleb-losophy | `&view=stackchain-pleb` |
| Submissions / newsletter | `&view=stackchain-community` |
| Physical copies | `&view=stackchain-copies` |
| Context examples | `&menu=articles`, `&menu=pleb-losophy`, `&menu=submissions`, `&menu=newsletter`, `&menu=physical-copies` |

Local images are in `untracked/stackchain-review/`; the packaged site is in `untracked/stackchain-site/`. Offline exports can be repeated with `STACKCHAIN_CANVAS=/absolute/path/to/a/Canvas2D/adapter/index.js node test/run.mjs stackchain-review`; this exports actual geometry without making browser assertions. Actual-device review and final visual approval remain manual checks.
