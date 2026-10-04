# BIG BITCOIN headquarters

Starting checkpoint: `b8c51751fe3b56d26bed00b5fb1bacff951344fe`,
`Fix Proof of Ink mobile browse button`, on `feature/dsb-land-master`.
Only the new interior, its terminal, and required shared integration are changed.
The Big Bitcoin building and all exterior systems remain untouched.

## Concept and layout

The supplied eight-panel concept sheet is the architectural reference: symmetrical
stone lobby, red banners and carpet, brass borders, oversized Bitcoin medallion,
formal reception, monument hall, executive boardroom, press briefing room, control
room, archive and merch display. The room is approximately 42 by 54 units, with a
9.4-unit central hall and 7.8-unit side rooms. Separate doors lead to each wing.
Black/charcoal stone panels and veined tiles are block interpretations of marble;
the engine does not provide the reference's photorealistic polished reflections.

The central monument is an anonymous fictional block executive on a formal plinth,
with a gold Bitcoin halo. It is not a likeness or a historical exhibit. Posters,
archive props and the terminal identify the in-world fiction. Short words such as
PLAN and STRATEGY provide environmental satire without attributing statements to
real people. IN CONTROL follows the official homepage's BIG BITCOIN introduction.

The boardroom has ten shared seats, documents, lamps and ten small monitors. The
press room has twelve audience seats, a low podium, two small microphones, two
tripod cameras and red curtains. The control room adds ten wall/desk screens,
including a stylized map. All chart marks are static decoration, without prices,
dates or a live-data claim. The archive contains nine bookcases (495 book props),
filing cabinets, a brass vitrine, an old-computer prop and a research desk.
Additional shared seats serve the control room, archive and information lounge:
29 in total. The merch wing uses stylized shirts/caps/stock, not exact product art.

Yellow's measured height is about 1.37 and collision radius about .697. The lobby
counter is .94 high, the boardroom table .93, desks about .92 and podium 1.0.
Seat anchors are .54 high. Navigation uses the actual shared radius-expanded
collision queries; furniture is not allowed to trap the character.

## Public content and updates

Source inspected on 2026-10-04: https://podconf.xyz/ . The live homepage returned
BIG BITCOIN's introduction, News and Research navigation, a launch announcement,
mission/manifesto link, recent post titles, official merch and contact links.
Subpage requests returned HTTP 403 in this environment, so the curated cards only
describe what the homepage verified, and direct readers to the original context.
They do not summarize inaccessible article bodies or invent episodes, policies,
history, products or prices.

`src/js/big-bitcoin-data.js` owns the bounded 12-card snapshot and exact destination
allowlist. Five sections: BIG BITCOIN, News, Research, Merch, Official links.
The two named products are the homepage's BIG BTC Classic T-Shirt and Red Team
Flat Bill Cap. No product-price claims are carried into the game. The public
website controls designs, stock, variants and purchases.

To update: inspect the official homepage, confirm each title/link and the limited
summary, edit the data module and checked date, update the terminal footer date,
then run `node test/run.mjs big-unit`. Room and player logic need no changes.
No scraper, runtime fetch, third-party image load, account, cart, forms, customer
storage, payment, checkout, analytics or polling is present. Links open only on
user action with `_blank`, `noopener noreferrer` and `no-referrer`.

## Shared behavior and budgets

Uses `dsbInteriors` for the actual existing facade entry, room lazy construction,
weather/daylight suppression, same-facade return and teardown. Uses the existing
quiet `shop` ambience setting; no audio module changed. All seats use
`crew.sitPlayer` / `standPlayer`, locked seated movement, free look and the shared
single Stand Up action. No separate seating or weapon system was introduced.

The terminal creates cards only on opening, resets on exit, removes handlers on
scene disposal and disconnects its resize observer on room exit. BIG BITCOIN's
contextual mobile action measures Jump and sits centred 8px above it. Its styles
are scoped; Proof of Ink's placement code and other HUD positions are unchanged.

Room budget: 1,945 nodes, 82 shared geometries, seven real lights, 12 banners,
29 chairs, 20 command/boardroom monitors plus the reception screen. Static cached
assemblies use the existing renderer's instancing and culling. No new render
targets, frame timers, network sources or per-frame room allocations.

## Validation and review

`node test/run.mjs big-unit`: 41/41 focused checks passed, including prior exterior,
Maxis, Without Rulers, Proof of Ink and all existing real-door/Noderunner contracts.
The new checks exercise Yellow's real collision and seating, every wing and seat,
camera partition limits, three repeated entry/exit cycles, terminal categories,
safe destinations, Escape, state reset and handler cleanup. No thresholds relaxed.
Initial navigation testing caught two reception planters blocking the rear route;
they now sit on the counter.

Build, changed-JavaScript syntax, whitespace checks and site packaging are required.
Work's browser blocked local HTTP preview and local-file access. Pre-commit review
therefore compared the authored layout/materials/props against the concept; actual
rendered review must use public Pages after deployment. Hardware WebGL performance,
physical portrait/landscape touch, prolonged GPU residency, audible weather/indoor
transitions and external media playback remain manual checks, not claimed passes.

Review flags (with `debug=1&interior=big-bitcoin` in DSB): `big-lobby`,
`big-monument`, `big-boardroom`, `big-press`, `big-control`, `big-archive`,
`big-merch`, `big-terminal`; `big-info` opens the terminal, `big-seat` seats Yellow.
