# Without Rulers digital showroom

This interior belongs to `WithoutRulersShop` on DSB Land. It reuses the existing
door transition, indoor weather/audio isolation, player movement and crew seats.
It does not move or alter the exterior building or other venues.

## Room and concept translation

The main reference is the approved single-floor showroom: a central inclined
catalog screen, two wood-and-metal merchandise islands, five collection bays,
rear brand wall/display desk, front-right print gallery and front-left lounge.
The other references inform shelf lighting, orange details, charcoal structure,
bone apparel, framed art, rugs, plants, exposed ceiling tracks and upper display
ledges. The tall reference's mezzanine is represented by display ledges rather
than an additional floor. Artwork is original block geometry inspired by the
collection themes; the catalog uses actual official product photographs.

The room is 24 by 22 game units with a 6.4-unit ceiling, scaled against Yellow's
actual body dimensions. It contains 20 hanging garments, 53 caps, 39 folded
stacks, 16 framed prints, two mannequins and two usable lounge chairs. Both
chairs use the shared sit/free-look/stand implementation, with checked stand
positions and the existing touch action. There is no new seating implementation.

## Catalog and privacy

`without-rulers-data.js` is a bounded public snapshot, separate from the menu and
room. It contains 14 real products, official names, USD minimum variant prices,
price-variation flags, 320-pixel product previews, official product links and
short original collection summaries. Prices are explicitly dated 2026-10-04;
stock, sizes, variants and final prices must be checked on the official store.
Some older product handles differ from their current titles; preserve the
verified official handle rather than guessing one from the title.

The menu provides Home / Featured, Shirts, Hoodies, Hats, Art Prints, Collections,
Search and About / Contact. Search filters this curated snapshot, not the whole
internet or the full live inventory. Product details expose **Buy on Official
Site**, which opens a real product page in a new tab with `noopener noreferrer`.
Collection links lead to the full official selection. No checkout occurs here.

No account, address, payment, cart, customer analytics, browser storage, cookies
or catalog polling is added. Search and selection are only transient UI state
and are cleared on venue exit. Images are embedded in the built application, so
opening the catalog does not contact the store or its image CDN. The UI says
that no customer information is stored here and purchases happen on the official
site. Official navigation accepts only HTTPS on `www.without-rulers.com`, the
homepage, and `/products/…` or `/collections/…` paths. User-entered text is never
used as HTML or a navigation destination.

### Verified collection routes

| Display | Official collection route |
| --- | --- |
| Shirts | `/collections/t-shirts` |
| Hoodies | `/collections/all-hoodies` |
| Hats | `/collections/hats` |
| Art Prints | `/collections/wor-prints` |
| BIP-85 | `/collections/defiance` |
| #FreeSamourai | `/collections/free-samourai` |
| Bitcoin or Slavery | `/collections/bitcoin-or-slavery` |
| Banking Cartel | `/collections/federal-reserve-collection` |
| 2140 | `/collections/epoch-33-collection` |

### Refreshing the snapshot

1. Read the public `https://www.without-rulers.com/products.json?limit=250` and
   `https://www.without-rulers.com/collections.json?limit=50` once each, if still
   offered. No credentials or private endpoints are needed. Alternatively inspect
   the relevant public pages; do not introduce runtime scraping.
2. Match the existing product handles and collection routes. Update verified
   titles, minimum prices and `priceVaries` from the variants. Remove products
   that no longer exist rather than inventing replacements.
3. For each selected product, use the official image source at width 320, inspect
   it and encode it as a data URL in `image`. Retain `imageSource` as provenance.
   Keep the selection bounded and images small; the current encoded previews
   total about 442 KB. Do not embed tracking URLs or external scripts.
4. Update `checked`, preserve the `official` URL allowlist, run the focused tests
   and build, then inspect the real menu and links. No API secrets are necessary.

## Performance and lifecycle

Repeated merch uses cached dressing geometry and shared materials. The room is
built lazily on first entry, then reused. Current construction is 943 scene nodes
and 99 unique geometries, with three real lights and static emissive practicals;
there are no new shadow-light arrays, render targets, media players or animation
loops. The Canvas fallback uses subdivided sign surfaces to keep text readable.

The catalog has one static dialog. Product cards are built only when opened,
images decode lazily, and contents are cleared on exit. Its controller removes
its five event handlers when the DSB scene is disposed. The shop uses the existing
single AudioContext/three-source indoor ambience pool at a quiet 0.12 shop gain.
Leaving mutes/disconnects it and restores the current exterior weather state.

## Validation and review

Run `npm run build`, syntax checks for changed JavaScript, `git diff --check`,
and `node test/run.mjs rulers-unit`. The focused suite includes the existing
exterior and Maxis invariants plus shop dimensions, geometry/light budgets,
actual-player-radius navigation flood checks, review and browse destinations,
both seats, indoor/exterior lifecycle, a three-cycle shared-audio test, official
URL validation, curated search and menu category/detail/exit/listener tests.

The actual Canvas renderer was used for local visual comparisons against the
approved concepts. Work's browser blocked localhost, so that was not a local
interactive browser test. The deterministic menu tests use a DOM double; they
do not prove physical mobile touch, GPU performance or official product stock.
Manual hardware checks should cover WebGL rendering, mobile portrait touch,
entry/exit with sound enabled, seated actions and a prolonged browsing session.

Review URL base: `https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/index.html`.
Append `?scene=dsb&debug=1&nosim=1&chain=0&oogatron=0&interior=without-rulers&view=`
and one of `rulers-hero`, `rulers-floor`, `rulers-art`, `rulers-kiosk`,
`rulers-menu`, `rulers-lounge` or `rulers-seat`. Debug-only review entry does not
change the normal Portara spawn or the ordinary exterior shop door.
