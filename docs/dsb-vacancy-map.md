# DSB Chora vacancy addresses

Frozen initial assignment: **35 properties — 33 houses and 2 windmills**.
Source checkpoint: `abd624cc3c6e719cf6cac20d140b41a106609b56`.

`src/js/dsb-vacancies.js` is the executable address registry; this document is the address list for future establishment requests. Never renumber or reuse an existing address. Append new addresses explicitly. When an address is occupied later, retain its identity and replace its vacancy plaque as part of that establishment's approved work.

The existing `VACANT n` geography names are persistent building identities, **not** the new public address. Lookup is by that exact name and verified coordinates, never array position. The two mill identities resolve the existing tower nodes by their fixed coordinates; they do not create new towers.

Initial walk: VAC 1–6 loop along the lower/harbor-facing town edge; VAC 7–14 weave through central Chora; VAC 15–18 follow the west hillside spur; VAC 19–33 loop through upper Chora and the eastern hillside lane; VAC 34–35 finish at the two uphill mills. The mapping takes precedence over any future geographic ordering.

All 33 `VACANT` lots in the current geography are included, including domed/cross-topped shells already explicitly classified as normal vacant properties. No separate church/chapel, occupied venue, Noderunner, harbor utility, ruin, Portara, pier, pergola, shed or prop is assigned an address.

| Address | Existing identity | Type | x (m) | z (m) | Yaw (radians) |
|---|---|---|---:|---:|---:|
| VAC 1 | VACANT 21 | house | 5 | 51 | -0.422853926 |
| VAC 2 | VACANT 20 | house | 26 | 60 | 0.124354995 |
| VAC 3 | VACANT 19 | house | 57 | 57 | -2.516107613 |
| VAC 4 | VACANT 4 | house | 56 | 40 | -2.743070208 |
| VAC 5 | VACANT 1 | house | 31 | 45 | -3.094009550 |
| VAC 6 | VACANT 5 | house | 4 | 44 | -1.570796327 |
| VAC 7 | VACANT 2 | house | 10 | 23 | 1.570796327 |
| VAC 8 | VACANT 3 | house | 36 | 23 | 1.199905038 |
| VAC 9 | VACANT 11 | house | 64 | 25 | -0.278299659 |
| VAC 10 | VACANT 10 | house | 60 | 9 | -0.486899232 |
| VAC 11 | VACANT 9 | house | 39 | 17 | -3.041924001 |
| VAC 12 | VACANT 8 | house | 32 | 16 | -3.041924001 |
| VAC 13 | VACANT 7 | house | 17 | 14 | 1.042721878 |
| VAC 14 | VACANT 6 | house | 8 | 13 | 1.042721878 |
| VAC 15 | VACANT 25 | house | -14 | 19.5 | 0.062418810 |
| VAC 16 | VACANT 24 | house | -20.5 | 19.5 | 0.000000000 |
| VAC 17 | VACANT 23 | house | -27 | 19 | -0.179853500 |
| VAC 18 | VACANT 22 | house | -34 | 18 | 0.785398163 |
| VAC 19 | VACANT 15 | house | 9 | -2 | 2.729182212 |
| VAC 20 | VACANT 12 | house | 25 | 2 | -1.107148718 |
| VAC 21 | VACANT 13 | house | 36 | 2 | 0.099668652 |
| VAC 22 | VACANT 14 | house | 54 | 1 | -1.756144277 |
| VAC 23 | VACANT 17 | house | 39 | -9 | 1.352127381 |
| VAC 24 | VACANT 18 | house | 32 | -21 | -0.197395560 |
| VAC 25 | VACANT 16 | house | 19 | -16 | 0.665969237 |
| VAC 26 | VACANT 32 | house | 13 | -12 | -0.412410442 |
| VAC 27 | VACANT 26 | house | 6.65 | -14.4 | -0.358770670 |
| VAC 28 | VACANT 33 | house | 5 | -22 | -0.519146114 |
| VAC 29 | VACANT 27 | house | -0.2 | -17.6 | -0.519146114 |
| VAC 30 | VACANT 28 | house | -7.9 | -20.8 | -0.244978663 |
| VAC 31 | VACANT 31 | house | -10.1 | -11.7 | 2.896613990 |
| VAC 32 | VACANT 30 | house | -4.8 | -9.4 | 2.622446539 |
| VAC 33 | VACANT 29 | house | 2.5 | -6 | 2.782821983 |
| VAC 34 | olympus-mill-east | windmill | -14 | -58 | 0.900000000 |
| VAC 35 | olympus-mill-west | windmill | -24 | -66 | 1.500000000 |

## Facades, doors and future entries

`BL.dsbVacancies.create(...).resolve(number)` returns the exact existing building reference, address, x/z, current authoritative floor/yaw, `door` and `approach` world positions, plaque and lettering nodes. In a debug DSB scene this is `__ooga.dsb.vacancies.resolve(7)`.

Every existing doorway faces building-local +z. House door metadata uses the existing facade centre at `depth / 2 + 0.075`; the approach is `depth / 2 + 1.5`. Mills use their existing blue door at local z 2.18 and their exterior approach at z 3.8. These are attachment/reference positions, not new traversable doors: existing steps, terrain and tower collision remain authoritative and must be considered when an interior is separately approved.

House plaques are 2.25 × 0.58 m, above the door lintel or mounted on the existing outward balcony rail where a balcony occupies that facade. Mill plaques are 1.65 × 0.48 m, beside the existing door on its +x side (plaque yaw is tower yaw + 0.85), below the blade sweep. The registry stores explicit mounting heights/offsets. All use the existing DSB sign glyph geometry, cream lettering and blue venue-style plaques. No walking collision, building, route, foliage or windmill geometry is changed.

## Review views

Use the deployed branch preview with `?scene=dsb&debug=1&time=1200&weather=clear&view=`:

- `vac-overview`: full Chora
- `vac-lower`: lower properties
- `vac-central`: central Chora and west hillside spur
- `vac-upper`: upper Chora/hillside
- `vac-windmills`: both windmills

Focused validation: `node test/run.mjs vacancy-unit`. It measures actual scene inventory, sign geometry, preserved geometry/labels, approach collision, repeated creation with reversed building order, and disposal. Optional offline review: set `VACANCY_CANVAS` to an environment-provided Canvas adapter; this adds no project dependency. Normal Pages CI also captures browser review images.
