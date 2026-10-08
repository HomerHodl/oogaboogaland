# Proof of Ink gallery / print workshop

Only the existing **Proof Of Ink** facade registers a new, separately lit room. Exterior geometry, named venue implementations, movement, seating, water, weather and daylight are unchanged. Entry/exit, camera clamping, exterior suppression and quiet `shop` room tone use the shared DSB interior framework.

## Layout and concept translation

The supplied six-panel concept controls the arrangement: front-center entrance; gallery on the left; four central merchandise islands; open production bay on the right; back-wall branding, artist/collaboration displays and reception; portrait kiosk at the front-right; small magazine lounge at the front-left. The 28 × 26 m room has a 6 m industrial timber/steel ceiling. This is intentionally a print production studio, with no tattoo equipment.

Charcoal walls, concrete tiles, warm wood, orange nib insignia, amber pendants, shelf strips, rugs, plants and mixed frame sizes reproduce the reference's material and display treatment in the game's existing procedural style. Low-resolution color meshes show real public product previews; they are deliberately blocky, not photorealistic copies of the reference. Physical sample garments use generic studio motifs and are not claims that a depicted SKU is for sale.

Details: 15 hanging garments, 42 merged folded stacks, 27 caps, 18 framed previews, 73 ink containers, two four-arm screen presses, two 13-tray drying racks, screens, squeegees/tool boards, flat files, print bins, packing boxes, books, pin trays and three lounge chairs. Production tables are approximately 1.1 m high; seats are .49 m high. Navigation is tested with Yellow's measured .697 m body radius and 1.37 m body height. The open workshop aisles remain accessible; equipment itself has collision boxes.

## Catalog content and updates

`src/js/proof-of-ink-data.js` contains the bounded, verified public snapshot and exact destination allowlist, separate from `proof-of-ink-menu.js`. `proof-of-ink-art.js` contains six small color-mesh previews derived from the same official product images. No runtime scraping or polling is used. Images are self-contained 320 px JPEG previews, lazily decoded when the menu creates visible cards. Leaving removes the cards and their image nodes.

Checked **4 October 2026**. The public homepage advertises its WordPress API via its `https://api.w.org/` link. That API advertises the WooCommerce Store API product and category routes used for this snapshot:

- https://proofofink.com/wp-json/wc/store/v1/products?per_page=100
- https://proofofink.com/wp-json/wc/store/v1/products/categories?per_page=100
- https://proofofink.com/wp-json/wc/store/v1/products?category=112&per_page=4 (Flomontoya)
- https://proofofink.com/wp-json/wc/store/v1/products?category=157&per_page=3 (Last Hash)

The response supplied public names, prices with minor-unit/currency metadata, category slugs, permalinks and product images. No authenticated, account, order, cart or checkout APIs were used. Cross-origin browser feed delivery is not assumed; there is no dependency on it in the static Pages build.

To update: inspect the official navigation and advertised API again; fetch a bounded product/category selection; retain real product IDs/permalinks and correct currency/range metadata; replace only the selected records and reduced image previews. Review all outbound destinations. Update the checked date, documented count and deterministic expectations if the approved selection changes. Do not add secret keys, analytics, runtime scraping, customer endpoints or aggressive full-catalog crawling.

### Surfaced information

18 actual products include BTC Sessions tee/hoodie/hat/pin, Nakamoto apparel and hats, Bitaxe hoodie, Honey Badger Pin, Stackchain stickers and IPO 7 magazine, *A Stoic Resurrection* by KONTEXT, Last Hash's *Unfazed*, Flomontoya prints and Art of Freedom's Genesis Block poster set. Titles, product previews, snapshot prices, categories, collections and official URLs are shown. Current stock, price, options and delivery must be confirmed on the official site; prices are not advertised as live.

Six primary sections group the menu: Featured, Apparel, Art & Objects, Collections, Studio & Stories, Search. Apparel exposes Shirts, Tanks, Polos, Hoodies, Crewnecks and Hats. Art & Objects exposes Books, BTC Pins, Stickers and Prints. The six discovery cards are Collabs, Nakamoto Collection, Fine Arts, Last Hash, Stackchain Magazine and Proof Of Work.

**Tanks:** the official homepage includes Tanks, but its page link did not return a usable listing and no tank product was verified in the sampled category data. The kiosk says so and links to the official homepage; it invents no tank products. The Collabs card also links to the homepage's collection navigation instead of inventing an umbrella URL. Stackchain is a magazine/editorial discovery card with actual issue products; Proof Of Work is a services card without a fabricated price or purchasable product.

Public source pages: https://proofofink.com/ , https://proofofink.com/fine-art , https://proofofink.com/proof-of-work , https://proofofink.com/nakamoto-collection , https://proofofink.com/last-hash , https://proofofink.com/stackchain-magazine , https://proofofink.com/wholesale . Public preview imagery remains attributable to Proof of Ink and the credited artists; it is used as a small catalog reference pointing to their official listings, not licensed for unrelated reuse.

## Privacy and lifecycle

The kiosk has no accounts, cart, payment handling, contact forms, email/address fields, analytics, storage or network calls. Search exists only in memory and resets on venue exit. The visible message is: “Browse here. Purchase on ProofOfInk.com. No customer data stored in OogaBoogaLand.” This statement concerns this kiosk; unrelated existing game preferences remain unchanged.

Purchase, read, contact, services and wholesale actions use exact allowlisted HTTPS URLs on `proofofink.com`, opened only by the visitor through real links with `target="_blank"`, `rel="noopener noreferrer"` and no referrer. No customer data is transferred. The official site controls everything after navigation.

One static dialog and five event handlers exist per DSB scene controller. Repeated opening never adds listeners. Venue exit closes the panel, clears search/selection/cards/images and removes the kiosk pick target; leaving DSB removes all handlers and the floating browse button. Shared seats handle Sit, pose, free look, movement lock and safe Stand Up; scene context suppresses its second action while seated. No extra seat or weapon subsystem was added.

## Performance and verification

1,276 scene nodes, 95 distinct cached geometries, three real lights; repeated stock, frames and fixtures share geometry. No extra render targets, simulation, animation, polling or remote player. Artwork uses six cached 24 × 28 color meshes. Low quality keeps the same architecture using the existing renderer's culling, instancing and lighting tiers.

Commands:

- `node test/run.mjs ink-unit`: 34 deterministic checks, including existing exterior, Maxis and Without Rulers checks; real Yellow clearance; all three seats; three room/menu visit cycles; search, categories, collection filters and redirects; privacy guard; all five real interior doors and Noderunner construction/disposal.
- `node --check` for every changed JavaScript source and `test/run.mjs`.
- `git diff --check`.
- `npm run build` and `npm run site -- /tmp/poi-build/site`.
- Actual Canvas renderer views compared to the supplied concept: hero, retail, gallery, workshop, kiosk and lounge.

The Work browser cannot load the local preview and does not offer WebGL2 here. Deterministic tests cover audio routing with the existing shared audio contract; listening quality, GPU draw-call/frame-time behavior, real touch devices, browser back/new-tab behavior and full live-service regression playback need manual GitHub Pages review. Do not interpret passing local deterministic checks as proof of third-party playback or physical mobile testing.

Review query prefix: `?scene=dsb&debug=1&nosim=1&chain=0&oogatron=0&interior=proof-of-ink&view=`. Views: `ink-hero`, `ink-retail`, `ink-gallery`, `ink-workshop`, `ink-catalog`, `ink-lounge`; `ink-seat` starts on the middle lounge seat, `ink-kiosk` shows the physical kiosk. Use `view=ink-door` without `interior` to approach the unchanged exterior entrance. All views use `#/dsb` on the deployed preview page.
