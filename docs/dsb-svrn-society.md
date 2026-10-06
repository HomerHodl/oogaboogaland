# SVRN Society · permanent address VAC 7

Source checkpoint: `e8b4a47b81f5631ddd53ab8f4534ac9d94291084`.

VAC 7 is now occupied by **SVRN Society**. Its historical geography identity is still `VACANT 2`, at x=10 m, z=23 m, yaw=π/2, with the same 6 × 5 m exterior footprint. The existing facade plaque now reads `SVRN Society`; the mount and door are unchanged. Its wider 4.4 m plaque fits the same facade. VAC 1–6 and VAC 8–35 retain their original numbers, identities and signs. There are 34 remaining vacant properties.

The normal shared interior controller enters from this property's existing facade and returns the same player to its approach (x=14.1, z=23; height sampled from existing terrain). No exterior geometry, collision, terrain, plants or routes are changed.

## Official source snapshot

Verified on **2026-10-05** from https://svrnsociety.com/ and its public navigation, https://svrnsociety.com/pages/brand-collections, https://svrnsociety.com/pages/about-us and https://svrnsociety.com/collections/christian-clothing.

`src/js/svrn-data.js` contains 16 routes: Home, New Arrivals, Bitcoin Clothing, Bitcoin Shirts, Hoodies & Crewnecks, Women, Kids, Swimwear, Bitcoin Hats, Bitcoin Merch, Lookbook, Collections, SVRN Society Collection, The Orange Habit, Faith Apparel and About. “Visit Official Site” opens the homepage. New Arrivals is the homepage's section, not an invented separate collection URL.

Seven verified collections form the rear gallery: **1913; 1984; Captivated; Faith Apparel; Fix The Money; Flip The Tables; Moms Against Money Printing**. The two brand collection anchors are copied from the official navigation. Eight selected public apparel/cap listing titles and URLs are retained without prices, reviews, stock claims or discounts. Full product details and current availability belong to the official site.

## Design and implementation

The supplied four concept illustrations guide the dark timber, charcoal metal, cream/black garments, amber practicals, restrained orange/brass, framed collection titles, central islands, digital kiosk and leather conversation lounge. Generated concept slogans and invented product claims are not reproduced. The 3D garments are stylized display studies, not replicas or product photography.

The larger-inside room is **26 × 30 m**, with a **6.3 m** ceiling. Zones: entry brand reveal; shirts/hoodies on the left; Faith Apparel on the right; hats/Bitcoin feature; seven collection bays along the back; two central apparel islands; kiosk; two-chair lounge. There are 15 stocked bays, **42 shirts + 48 hoodies**, **90 folded stacks** (four folds each), **24 caps**, **3 mannequins**, **7 collection panels**, **2 shared seats**, and **6 real lights**. Repeated objects use cached geometry; strip glow and cage practicals are emissive. No reflection passes or external assets are required.

The existing `dsb-interiors` transition, collision, lighting/audio gates, contextual menu zones, shared menu shell and crew seating are reused. The room uses the existing light shop ambience. All weather, exterior ambience and Noderunner audio are gated by the same interior mechanism.

## Privacy and resilience

The room and menu load entirely offline. There is no catalog polling, remote imagery, tracking, login, account flow, cart, checkout, payment form or personal-data collection. Consequently no remote-image fallback is required. Official outbound links use HTTPS, `target="_blank"`, `rel="noopener noreferrer"` and a no-referrer policy. Shopping takes place only on the official site.

## Deterministic review links

Base: https://yellowbrokeit.github.io/oogaboogaland/dsb-preview/

- Exterior: `?scene=dsb&debug=1&view=svrn-door&weather=clear&time=1200`
- Interior: `?scene=dsb&debug=1&interior=svrn-society&view=<view>&weather=clear&time=1200`
- Views: `svrn-entrance`, `svrn-retail`, `svrn-collections`, `svrn-faith`, `svrn-hats`, `svrn-kiosk`, `svrn-lounge`, `svrn-wide`.
- Kiosk menu: add `&menu=home`; contextual routes also accept `shirts`, `hoodies`, `hats`, `faith`, `collections` and `lookbook`.
- Shared seat: `view=svrn-seat`.

Focused offline checks: `node test/run.mjs svrn-unit`; permanent addresses: `node test/run.mjs vacancy-unit`. Normal Pages CI runs the real door/menu/seat/lifecycle browser checkpoint and WebGL capture before the existing menu/media and Portara gates. Browser screenshots are stored in its review artifact under `svrn-review`. Optional offline render export: `SVRN_CANVAS=<environment Canvas adapter> node test/run.mjs svrn-review`; the adapter is not a project dependency.
