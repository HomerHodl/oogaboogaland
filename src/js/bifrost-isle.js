// ₿IFRÖST's islet off the north rim, as the island sees it, after the owner's concept art: a floating rock of chunky
// voxel stone straight out past the island's north pass, its thick mossy rim hung with moss, yellow-green vines, warm
// lanterns and glowing blue cubes, with electric-blue waterfalls pouring off its edge. Its top is terraced round the
// stairs up to the massive stone gate (`BL.bifrostGate`), whose arch holds the field into the chamber. From the front
// level where the bridge lands, between two navy "ᛕᛁ" banners on their gallows, three short steps climb between two
// brazier pedestals to a small paved landing, where Heimdall keeps the way, and the gate's own flight climbs on between
// its cheeks to the portal, a short walk in all. Stone-retained beds planted with bushes, small trees and flowers close
// in either side of the landing and the gate's flight, and the gate stands on a terrace of dressed stone reaching out
// beside and behind it to the palms and the pink blossom trees, with lantern posts round the rim.
// Bifröst leaves from the pass's end, just past ₿IFRÖST's arch on the island (`BL.bifrostGate.landmark`, which the hub
// stands in the old gate's place and which carries the banners at the land end): a short paved stone head between two
// lantern pedestals, with low walls along its open sides, then a straight, level deck of vivid glowing crystal tiles
// between low stone parapets, square pillars with a lantern each, and glass rails.
//
// `spot(island)` finds where it all stands, once per island: the pass's end along the axis, its floor, where the ridge
// walls either side have ended so the head may widen, and the islet's middle a head and a deck's length out past the
// rim. It throws if the pass's floor is not level under the head, if a ridge wall stands where the head is wide, or if
// the islet crowds another islet. `site(spot)` builds the visit's nodes in the islet's frame, one group at the islet's
// middle turned so local +z runs back along the bridge to the island. Every geometry is built once a page (the
// bridge's and its head's once a spot), so a later visit only makes nodes. `update(site, dt, elapsed, px, py, pz)` runs
// a gentle light along the deck, warms the tiles round the played Ooga's feet at (px, py, pz) (px is NaN when nobody is
// played) with a trail that fades behind it, lifts the whole deck a little while anyone is on the bridge, twinkles the
// sparkles and runs the falls; it allocates nothing.
//
// The rock, the gate and the bridge are solid, each over a closed collision shell: the rock's is its own voxels with
// closed boxes for every tread, pedestal, cheek, bed and terrace, so a walker climbs from the court only by the stairs
// (each wall stands more than a step over whatever walkable level meets it), and for the braziers, posts and trunks;
// the bridge's a slab with continuous guards up to `BRIDGE.guard` along both sides, and its head's slab, tongue and
// corbels, side walls and pedestals, none of it reaching into the ridge walls or below the stone. The dressing, the
// deck's tiles and sparkles, the falls and the foliage are `sightHidden`; `lamps` are the glow nodes the hub ramps at
// dusk, and the falls, crystals, vine tips, tiles and sparkles glow on their own.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, math } = BL;
  const { createNode, addChild } = BL.scene;
  const { cached, variants, geometry, box, bevelBox, merge, moved, turnedX, turnedY, noShadow, makeVox, voxelGeometry } = models;
  const { mulberry32 } = math;
  const BG = BL.bifrostGate, HM = BL.hubModels, BM = BL.bifrostModels;
  const { GATE } = BG, INK = BG.PALETTE;
  const { facing, blend } = BM;
  const TAU = Math.PI * 2, DEG = Math.PI / 180, SHELL = "#000000";

  // Where it stands: the axis's bearing (x = sin b, z = -cos b), where the search along it for the pass's end starts,
  // how far inland of the rim the pass's floor is read, and how long the crystal deck runs from the head to the islet.
  const AXIS = { bearing: 0, from: 29, floor: 0.7, deck: 16 };
  // The bridge head, a short stone abutment at the pass's end: from `back` inland of the rim out `over` past it, `half`
  // either side where the ridge walls have ended and `tongue` either side between them, its top `lift` above the
  // pass's floor. Its slab is `slab` deep, edged with a row of blocks `kerb` thick; under it `corbels` courses `course`
  // tall, each stepping in `step` along its outer face and `side` along its sides from the one above, run `sunk` into
  // the cliff past its inland end.
  const HEAD = { back: 0.3, over: 2.4, half: 3, tongue: 2.25, lift: 0.04, slab: 0.5, kerb: 0.45, corbels: 4, course: 0.45, step: 0.42, side: 0.28, sunk: 0.3 };
  // How far the islet keeps from the other islets.
  const CLEAR = 8;
  // The rock on the hub's half-metre lattice: its top a rounded square (a superellipse of power `square`), `half` either
  // side, reaching `front` out to where the bridge lands and `back` behind, calm across its front; its depth at the
  // middle, the thick band of steep rock under the rim, and the moss curtains' finer lattice. Outline, depth and the
  // top's tones go by metre block.
  const ROCK = { unit: 0.5, half: 12, front: 9, back: 7.5, square: 4, depth: 16, band: 4.4, fine: 0.25 };
  // The court's paved way from the bridge to the stairs, `path` either side, and its flags `flag` square.
  const COURT = { path: 2, flag: 0.8 };
  // The levels round the stairs, in the islet's frame (x across, +z back toward the bridge, y up from the court). The
  // lower flight climbs from its foot `foot`, `flight` either side, by `steps` risers of `riser` on treads `tread` deep,
  // to the landing, which runs back to `back`, where the gate's own flight rises, `half` either side. The braziers'
  // stone pedestals flank the lower flight from its side out to the landing's, fronted at `pedestal`. The gate's flight
  // has cheeks `cheek` thick standing `guard` over each tread. The planted beds stand `bed` high either side of the
  // landing and of the cheeks out to `bedOut`, fronted at `front`; under them, the landing and the gate, the terrace at
  // the landing's height reaches `baseOut` either side, fronted at `front` too, and `behind` past the gate's back. Each
  // retaining wall that shows is faced with dressed blocks `skin` thick.
  const TERRACE = { foot: 7.6, flight: 2, riser: 0.25, tread: 0.45, steps: 3, back: 4.2, half: 3.4, pedestal: 7.7, cheek: 0.45, guard: 0.9, bed: 1.5, bedOut: 6.2, front: 7.2, baseOut: 9.6, behind: 0.6, skin: 0.4 };
  // The landing's height and its front edge; the gate's frame on the islet, its flight rising from the landing's back to
  // its portal face `Z_GATE` and its portal floor `GATE_Y` over the court, the front of the gate's own landing (its
  // ledge) `LEDGE_Z`, its flight's half-width and its footprint; and the terrace's back.
  const LAND = TERRACE.riser * TERRACE.steps, LAND_Z = TERRACE.foot - TERRACE.tread * (TERRACE.steps - 1);
  const Z_GATE = TERRACE.back - GATE.run, GATE_Y = LAND + GATE.rise, LEDGE_Z = Z_GATE + GATE.stairs.from, STAIR = GATE.stairs.halfWidth, FOOT = GATE.footprint;
  const BASE_Z = Z_GATE + FOOT.minZ - TERRACE.behind;
  // What stands at a point of the islet's top, as `plan().pieceAt` tells it.
  const GREEN = 0, PAVED = 1, TREAD = 2, PEDESTAL = 3, LANDING = 4, CHEEK = 5, BED = 6, BASE = 7;
  // Bifröst: the walkable deck's half-width, the parapets' thickness and the height their shell guards to, the pillars'
  // side, height and spacing, the deck's tiles and columns of them, and the least stone sill at either end.
  const BRIDGE = { half: 1.8, wall: 0.5, guard: 1.1, pillar: 0.7, pillarH: 1.3, every: 3.4, tile: 0.6, cols: 6, sill: 0.35 };
  // A deck tile's layers from the bed up: its dark glass base `base` either side, from the bed's top to `seat`; the
  // glowing top `top` either side from there up to the walking height; the bright core `core` either side standing
  // `rise` proud of it; and the white glint `glint` wide along its -x edge, `lip` proud.
  const TILE = { base: 0.2875, top: 0.26, core: 0.15, bed: -0.065, seat: -0.03, rise: 0.014, glint: 0.035, lip: 0.008 };
  // The sparkles: how many, lying how far above the tiles' tops, and how far from a tile's middle.
  const SPARK = { count: 60, y: 0.02, spread: 0.17 };
  // The deck's light: a crest every `wave` metres running out from the head at `rate` crests a second over a glow of
  // `glow` that shimmers by `shimmer`, the crest adding `crest` to the glow and `highlight` to the highlight. The falls'
  // bands: one every `band` metres, flowing down at `rate` bands a second.
  const LANE = { wave: 7, rate: 0.22, glow: 0.95, shimmer: 0.04, crest: 0.1, highlight: 0.12 }, FALL = { band: 6, rate: 0.5 };
  // The glow under a walker's feet: while the feet are over the bridge and within `feet` of the deck, the tiles within
  // `radius` of them warm toward a smooth peak under them at `rise` a second and cool at `fall`, warmth adding up to
  // `highlight` and `glow`; and the whole deck lifts by `lift`, easing in and out at `ease` a second.
  const WALK = { radius: 2.4, feet: 1, rise: 8, fall: 1, ease: 5, highlight: 0.55, glow: 0.45, lift: 0.12 };
  // The view, as the concept's bridge picture looks: from over the pass's end `back` inland of the head, pitched down
  // `pitch`, at a point `ahead` onto the islet from its front edge, `up` above the deck.
  const VIEW = { back: 0.9, ahead: 1, pitch: 0.22, up: 3.6 };

  // The islet's dressing in its frame (x across the axis; +z back toward the bridge), each thing standing on whatever
  // level is under it: the braziers on their pedestals; the banners on their gallows at the front corners; Heimdall's
  // spot on the landing beside the left brazier, turned a little toward the way; where an Ooga comes out of the chamber,
  // at the foot of the lower flight facing out onto the bridge, the camera over the landing behind it; lantern posts round the rim and lanterns on the rock's face (bearings from +z toward +x,
  // and how far below the top); blue cubes set in the rock; the falls [bearing, length]; palms [x, z, variant] on the
  // terrace beside the gate, pink blossom trees [x, z] on it either side, green trees [x, z, variant, scale] (small ones
  // on the beds by the gate's flight, bigger ones behind it), bushes [x, z, variant] and flower patches [x, z].
  const BRAZIER = { x: (TERRACE.flight + TERRACE.half) / 2, z: (LAND_Z + TERRACE.pedestal) / 2 };
  const FRONT_BANNERS = [[-4.9, 7.95], [4.9, 7.95]];
  const HEIMDALL = { x: -2.15, z: 5.55, turn: 0.35 }, ARRIVAL = { x: 0, z: 8.3 };
  const RIM_POSTS = [48, 66, 90, 118, 145, -48, -66, -90, -118, -145];
  const ROCK_LAMPS = [[24, 2], [-24, 2.4], [58, 3.4], [-60, 2.8], [85, 1.8], [-88, 3.6], [128, 2.6], [-126, 1.9], [150, 5.2], [-150, 4.6], [180, 2.2]];
  const CRYSTALS = [[0, 5.6], [45, 5.4], [-48, 4.2], [75, 3.1], [-75, 6.2], [98, 5], [-100, 2.2], [120, 3.8], [-118, 5.8], [140, 7], [-142, 3.3], [160, 4.4], [-160, 6.6]];
  const FALLS = [[36, 11], [109, 13], [170, 10], [-40, 10], [-109, 12], [-170, 11]];
  const PALMS = [[-8.6, -0.6, 0], [8.4, -2, 1], [8.8, 2.4, 2]];
  const BLOSSOMS = [[-8, 4.6], [7.9, 5.5]];
  const TREES = [[-4.5, 3.45, 1, 0.75], [4.6, 3.35, 1, 0.72], [-6.4, -5.2, 1, 0.9], [6.8, -5, 1, 0.95]];
  const BUSHES = [
    [-4.25, 5, 0], [-5.2, 6.35, 1], [4.3, 5.25, 1], [5.25, 6.3, 0], [-7.1, 6.3, 2], [8.9, 6.4, 0], [-9, 2, 1], [7.7, -3.3, 0], [-7.8, -3.6, 1],
    [-6.7, 7.75, 0], [7.35, 7.75, 1], [-10.4, 1.4, 2], [10.3, -0.9, 0], [-4.6, -4.95, 0], [4.4, -5, 0], [0.3, -4.9, 1]
  ];
  const FLOWERS = [
    [-3, 8.35], [3, 8.35], [-5.95, 8.5], [5.6, 8.55], [-3.7, 3.75], [3.75, 3.8], [-5.4, 4.9], [5.5, 4.7], [-6.9, 5.1], [7.2, 3.8],
    [-8.9, -2.4], [8.8, -3.8], [10.6, 2.7], [-10.3, -2.2], [-2.4, -5.35], [2.6, -5.5], [-8.2, -5]
  ];
  const VINES = 16;
  // The head's dressing, across the axis (mirrored either side) and out from the rim: the lantern pedestals, `side`
  // square and `h` tall; the low walls along its open sides, from `x` out `t` thick in courses `courses` from just under
  // the slab's top; and the candles on the walls' tops, in clusters [across, out] of three [across, out, height].
  const HEAD_LAMP = { x: 2.36, u: 0.5, side: 0.62, h: 1.1 };
  const HEAD_WALL = { x: 2.2, t: 0.5, courses: [0.47, 0.48] };
  const HEAD_CANDLES = [[2.45, 1.05], [2.45, 2.08]], CLUSTER = [[0, 0, 0.26], [0.13, 0.1, 0.17], [-0.1, 0.14, 0.12]];

  // The owner's colours: the rock's grass, moss, dirt and grey-brown stone, the grout under the flags and the glowing
  // blue of the cubes; the built stone and paving are the gate's.
  const ROCK_TONES = ["#4f8a30", "#5f9a38", "#5c8f2e", "#79ad3c", "#6e4f36", "#5a3f2a", "#6b625b", "#5e5650", "#776d65", "#534c47", "#56504a", "#3f9dff", "#8fd8ff"];
  const R = { GRASS: 0, GRASS_LT: 1, MOSS: 2, MOSS_LT: 3, DIRT: 4, DIRT_DK: 5, STONE: 6, GROUT: 10, CRYSTAL: 11, CRYSTAL_LT: 12 };
  const DRESSED = INK.STONE, DRESSED_LT = INK.STONE_LT, DRESSED_DK = INK.STONE_DK, GROUT = "#4e4842";
  const FLAGS = [...INK.PAVE, ...INK.STEP];
  const MOSS = ["#3f6d26", "#51852f", "#6a9e38", "#8dc04a"], VINE = ["#8aa52c", "#6f8f24", "#a9c83c", "#c2d94e"];
  const WATER = ["#2d7dff", "#4aa6ff", "#7cc8ff"], FOAM = "#e2f5ff";
  // The deck's tones, vivid as the concept's: a ramp from cyan and sky blue through violet and magenta to hot pink,
  // then peach and two golds for the warm patches (`TONE` names them); and the dark bed under the tiles.
  const TILE_TONES = ["#27e8ff", "#33baff", "#3f8dff", "#6574ff", "#8b5cff", "#b654ff", "#e24bff", "#f055e4", "#ff5ec8", "#ffa24a", "#ffd23f", "#ffe680"];
  const TONE = { ramp: 8, peach: 9, gold: 10, pale: 11 }, DECK_BED = "#11143a";
  const TIMBER = "#6e4a2a", TIMBER_DK = INK.WOOD, IRON = INK.IRON, GOLD = INK.GOLD, STEEL = "#a9b3bc", PANE = "#c4e8ff";

  // ---- small builders ------------------------------------------------------------------------------

  const hash = (a, b, c) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
  // A copy of a built part scaled by `k`, turned by `ry` and moved to (x, y, z).
  const put = (geo, x, y, z, ry = 0, k = 1) => {
    const out = merge(geo);
    if (k !== 1) for (let i = 0; i < out.verts.length; i++) out.verts[i] *= k;
    return moved(turnedY(out, ry), x, y, z);
  };
  // An axis-aligned box between two corners in one colour; black, a closed box for collision shells.
  const cube = (x0, x1, y0, y1, z0, z1, color) => box({ w: x1 - x0, h: y1 - y0, d: z1 - z0, color, offset: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 } });
  const block = (x0, x1, y0, y1, z0, z1) => cube(x0, x1, y0, y1, z0, z1, SHELL);
  // The span from a to b across the axis on side s (-1 or 1), low end first.
  const span = (s, a, b) => s > 0 ? [a, b] : [-b, -a];
  // Dressed blocks in courses along `axis` ("z" or "x") from a0 to a1, b0 to b1 through, from y0 up by `courses`, each
  // course broken to bond with the last, over a mortar core that closes the joints; the top course is a bevelled coping.
  const wall = (parts, axis, a0, a1, b0, b1, y0, courses, seed) => {
    const at = (make, a, b, y, la, lb, h, color, extra) => make({ w: axis === "z" ? lb : la, h, d: axis === "z" ? la : lb, color, ...extra, offset: axis === "z" ? { x: b, y, z: a } : { x: a, y, z: b } });
    let y = y0;
    courses.forEach((h, c) => {
      const coping = c === courses.length - 1;
      for (let a = a0, k = 0; a < a1 - 1e-6; k++) {
        let l = k ? 0.62 + (hash(seed, c, k) % 5) * 0.07 : c % 2 ? 0.42 : 0.78;
        if (a1 - (a + l) < 0.3) l = a1 - a;
        const color = coping && hash(seed, k, 7) % 3 ? DRESSED_LT : DRESSED[hash(seed, k, c) % DRESSED.length];
        parts.push(coping ? at(bevelBox, a + l / 2, (b0 + b1) / 2, y + h / 2, l - 0.03, b1 - b0, h - 0.025, color, { bevel: 0.035 }) : at(box, a + l / 2, (b0 + b1) / 2, y + h / 2, l - 0.03, b1 - b0 - 0.02, h - 0.025, color));
        a += l;
      }
      y += h;
    });
    parts.push(at(box, (a0 + a1) / 2, (b0 + b1) / 2, (y0 + y) / 2, a1 - a0 - 0.02, b1 - b0 - 0.1, y - y0 - 0.05, GROUT));
  };
  // One course of bevelled dressed blocks along `axis` ("z" or "x") from a0 to a1, b0 to b1 through, from y0 up `h`,
  // each its own length and shade of the dressed stone, taken `shade` of the way toward the pale stone (below 0) or
  // the deepest (above 0). Whatever it edges closes the joints behind it.
  const run = (parts, axis, a0, a1, b0, b1, y0, h, seed, shade) => {
    const toward = shade < 0 ? DRESSED_LT : DRESSED_DK, bm = (b0 + b1) / 2, y = y0 + h / 2;
    for (let a = a0, k = 0; a < a1 - 1e-6; k++) {
      let l = 0.55 + (hash(seed, k, 3) % 5) * 0.08;
      if (a1 - (a + l) < 0.3) l = a1 - a;
      const color = blend(DRESSED[hash(seed, k, 5) % DRESSED.length], toward, Math.abs(shade)), am = a + l / 2;
      parts.push(axis === "x"
        ? bevelBox({ w: l - 0.03, h: h - 0.025, d: b1 - b0, color, bevel: 0.04, offset: { x: am, y, z: bm } })
        : bevelBox({ w: b1 - b0, h: h - 0.025, d: l - 0.03, color, bevel: 0.04, offset: { x: bm, y, z: am } }));
      a += l;
    }
  };
  // A square stone pillar from y0 to `top`: a dark footing, the shaft `side` across and a pale cap.
  const pillar = (parts, x, z, y0, top, side = BRIDGE.pillar) => parts.push(
    bevelBox({ w: side + 0.14, h: 0.24, d: side + 0.14, color: DRESSED_DK, bevel: 0.05, offset: { x, y: y0 + 0.12, z } }),
    bevelBox({ w: side, h: top - y0 - 0.38, d: side, color: DRESSED[(Math.round(x * 3 + z * 7) & 3)], bevel: 0.06, offset: { x, y: (y0 + top + 0.1) / 2, z } }),
    bevelBox({ w: side + 0.14, h: 0.14, d: side + 0.14, color: DRESSED_LT, bevel: 0.04, offset: { x, y: top - 0.07, z } })
  );
  // Flagstones over x0..x1, z0..z1 in courses a flag deep, every other course broken by half a flag, each a shade of the
  // paving a hair above the ground at y0 so the grout between shows; a flag that `skip` covers is left out.
  const flags = (geo, x0, x1, z0, z1, seed, skip = null, y0 = 0) => {
    const size = COURT.flag, gap = 0.03;
    for (let row = 0; z0 + row * size < z1 - 0.05; row++) {
      const za = z0 + row * size + gap, zb = Math.min(z0 + (row + 1) * size, z1) - gap, shift = row % 2 ? size / 2 : 0;
      for (let x = x0 - shift; x < x1 - 0.05; x += size) {
        const xa = Math.max(x, x0) + gap, xb = Math.min(x + size, x1) - gap, h = hash(Math.round(x * 4), row, seed);
        if (xb - xa < 0.1 || zb - za < 0.1 || skip && skip((xa + xb) / 2, (za + zb) / 2)) continue;
        const y = y0 + 0.014 + (h % 5) * 0.004;
        facing(geo, [[xa, y, za], [xb, y, za], [xb, y, zb], [xa, y, zb]], FLAGS[h % FLAGS.length], 0, xa, y + 5, za);
      }
    }
    return geo;
  };
  // Green over x0..x1, z0..z1 at y in metre cells cut to it, each a shade of the rock's grass or moss; a cell that
  // `hidden(xa, xb, za, zb)` says is covered is left out.
  const turf = (geo, x0, x1, z0, z1, y, seed, hidden = null) => {
    for (let x = Math.floor(x0); x < x1; x++) for (let z = Math.floor(z0); z < z1; z++) {
      const xa = Math.max(x, x0), xb = Math.min(x + 1, x1), za = Math.max(z, z0), zb = Math.min(z + 1, z1), h = hash(x, seed, z) % 7;
      if (xb - xa < 0.01 || zb - za < 0.01 || hidden && hidden(xa, xb, za, zb)) continue;
      facing(geo, [[xa, y, za], [xb, y, za], [xb, y, zb], [xa, y, zb]], ROCK_TONES[h < 3 ? R.GRASS : h < 6 ? R.GRASS_LT : R.MOSS_LT], 0, (xa + xb) / 2, y + 5, (za + zb) / 2);
    }
    return geo;
  };
  // A square slab over x ±hx and z ±hz about (x, z), from y0 up to y1: its top and its four sides, never its underside.
  const slab = (geo, x, z, hx, hz, y0, y1, top, side, lit, sideLit) => {
    const x0 = x - hx, x1 = x + hx, z0 = z - hz, z1 = z + hz;
    facing(geo, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], top, lit, x, y1 + 1, z);
    facing(geo, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], side, sideLit, x, y0, z0 - 1);
    facing(geo, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], side, sideLit, x, y0, z1 + 1);
    facing(geo, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], side, sideLit, x0 - 1, y0, z);
    facing(geo, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], side, sideLit, x1 + 1, y0, z);
    return geo;
  };
  // A candle `h` tall standing at (x, y, z): its wax, and its flame for the dusk ramp.
  const candle = (wax, flames, x, y, z, h) => {
    wax.push(box({ w: 0.08, h, d: 0.08, color: INK.WAX, offset: { x, y: y + h / 2, z } }));
    flames.push(box({ w: 0.05, h: 0.09, d: 0.05, color: INK.FLAME[2], emissive: 1, offset: { x, y: y + h + 0.05, z } }));
  };
  // Four little flowers on stems over a tuft of leaves, pink or white, on the ground at y.
  const flowerPatch = (parts, x, y, z, seed) => {
    const rand = mulberry32(seed), tones = seed % 2 ? ["#ff8fc8", "#f7a8d8"] : ["#fff6fb", "#efe8ff"];
    parts.push(box({ w: 0.5, h: 0.08, d: 0.42, color: "#4f8f36", offset: { x, y: y + 0.04, z } }));
    for (let n = 0; n < 4; n++) {
      const a = rand() * TAU, r = 0.08 + rand() * 0.26, fx = x + Math.cos(a) * r, fz = z + Math.sin(a) * r, h = 0.14 + rand() * 0.16;
      parts.push(box({ w: 0.03, h, d: 0.03, color: "#4f8f36", offset: { x: fx, y: y + h / 2, z: fz } }), box({ w: 0.11, h: 0.06, d: 0.11, color: tones[n & 1], offset: { x: fx, y: y + h + 0.03, z: fz } }));
    }
  };

  // ---- where it stands --------------------------------------------------------------------------------

  // The islet's plan, which the rock, its dressing and the walking all read: the top's outline (a rounded square, calm
  // across its front and a little wavy elsewhere) as a table of its reach by bearing, each metre block's depth in cells,
  // where the rock's face is at a bearing and depth, what stands on the top where (the terraces' pieces, the paving and
  // the green) and its walking height, where the gate stands, where the front edge runs under the bridge, and the falls'
  // blocks.
  const plan = cached(() => {
    const T = TERRACE, n = ROCK.square;
    const calm = (a) => { const t = Math.min(1, Math.max(0, (Math.abs(a) - 0.6) / 0.5)); return t * t * (3 - 2 * t); };
    const square = (a) => { const c = Math.cos(a); return Math.pow((Math.abs(Math.sin(a)) / ROCK.half) ** n + (Math.abs(c) / (c >= 0 ? ROCK.front : ROCK.back)) ** n, -1 / n); };
    const outline = (a) => square(a) * (1 + calm(a) * (0.035 * Math.sin(3 * a + 0.7) + 0.022 * Math.sin(7 * a + 2.1) + 0.012 * Math.sin(13 * a + 0.4)));
    const inside = (x, z) => Math.hypot(x, z) <= outline(Math.atan2(x, z));
    const N = 720, edge = new Float32Array(N);
    let reach = 0;
    for (let i = 0; i < N; i++) {
      // The outline once a bearing, not once a step: the same table, a tenth of the hub's build time for it.
      const a = (i / N - 0.5) * TAU, s = Math.sin(a), c = Math.cos(a), o = outline(Math.atan2(s, c));
      let r = 0;
      while (Math.hypot(s * (r + 0.05), c * (r + 0.05)) <= o) r += 0.05;
      edge[i] = r;
      reach = Math.max(reach, r);
    }
    const edgeAt = (a) => edge[(Math.round((a / TAU + 0.5) * N) % N + N) % N];
    // Each metre block's depth in cells: the band of steep rock under the rim, then the taper to a point, each block a
    // little deeper or shallower than its neighbours.
    const B = Math.ceil(reach) + 1, S = 2 * B, depth = new Int16Array(S * S), u = ROCK.unit;
    for (let bx = -B; bx < B; bx++) for (let bz = -B; bz < B; bz++) {
      const x = bx + 0.5, z = bz + 0.5;
      if (!inside(x, z)) continue;
      const k = Math.min(1, Math.hypot(x, z) / edgeAt(Math.atan2(x, z))), j1 = 0.85 + hash(bx, 3, bz) % 1000 / 1000 * 0.3, j2 = 0.88 + hash(bx, 7, bz) % 1000 / 1000 * 0.22;
      depth[(bx + B) * S + bz + B] = Math.max(3, Math.round(Math.max(ROCK.band * j1, ROCK.depth * (1 - Math.pow(k, 2.2)) * j2) / u));
    }
    const blockDepth = (bx, bz) => bx < -B || bx >= B || bz < -B || bz >= B ? 0 : depth[(bx + B) * S + bz + B];
    const cellDepth = (xc, zc) => blockDepth(Math.floor(xc / 2), Math.floor(zc / 2));
    const top = (x, z) => blockDepth(Math.floor(x), Math.floor(z)) > 0;
    const onTop = (x, z, m) => top(x - m, z - m) && top(x + m, z - m) && top(x + m, z + m) && top(x - m, z + m);
    const rim = (bx, bz) => !blockDepth(bx + 1, bz) || !blockDepth(bx - 1, bz) || !blockDepth(bx, bz + 1) || !blockDepth(bx, bz - 1);
    // The rock's face at bearing `a`, `drop` below the top: the outermost cell of that course along the bearing and the
    // side of it that looks out, as the cell, its outward axis (dx, dz) and the middle of that side. A bearing through a
    // cell's corner can land on a cell buried on both outward sides; it walks out from there to the surface.
    const faceAt = (a, drop) => {
      const j = Math.max(1, Math.round(drop / u)), s = Math.sin(a), c = Math.cos(a), ax = Math.sign(s), az = Math.sign(c), alongX = Math.abs(s) >= Math.abs(c);
      for (let r = edgeAt(a) + 0.6; r > 0; r -= 0.1) {
        let xc = Math.floor(s * r / u), zc = Math.floor(c * r / u);
        if (cellDepth(xc, zc) < j) continue;
        for (;;) {
          const xOpen = ax !== 0 && cellDepth(xc + ax, zc) < j, zOpen = az !== 0 && cellDepth(xc, zc + az) < j;
          if (xOpen && (!zOpen || alongX)) return { xc, zc, j, dx: ax, dz: 0, x: (xc + (ax > 0 ? 1 : 0)) * u, y: -(j - 0.5) * u, z: (zc + 0.5) * u };
          if (zOpen) return { xc, zc, j, dx: 0, dz: az, x: (xc + 0.5) * u, y: -(j - 0.5) * u, z: (zc + (az > 0 ? 1 : 0)) * u };
          if (alongX) xc += ax; else zc += az;
        }
      }
      throw new Error(`₿IFRÖST's rock has no face at ${Math.round(a / DEG)}°, ${drop} m down`);
    };
    // What stands at (x, z) on the top, nearest the bridge first: the lower flight's treads, the braziers' pedestals, the
    // landing, the cheeks of the gate's flight, the beds either side of them, the terrace under it all, and the court's
    // paved way or its green. Its walking height: a tread's riser count, a cheek `guard` over the gate's tread beside it,
    // the beds' height, the landing's for the pedestals, the landing and the terrace, and the court's for the rest.
    const pieceAt = (x, z) => {
      const ax = Math.abs(x);
      if (z > LAND_Z && z <= T.foot && ax <= T.flight) return TREAD;
      if (z > LAND_Z && z <= T.pedestal && ax <= T.half) return PEDESTAL;
      if (z >= T.back && z <= LAND_Z && ax <= T.half) return LANDING;
      if (z > LEDGE_Z && z < T.back && ax > STAIR && ax <= STAIR + T.cheek) return CHEEK;
      if (z >= LEDGE_Z && z <= T.front && ax <= T.bedOut && ax > (z < T.back ? STAIR + T.cheek : T.half)) return BED;
      if (z >= BASE_Z && z <= T.front && ax <= T.baseOut) return BASE;
      return ax <= COURT.path && z >= T.foot ? PAVED : GREEN;
    };
    const levelAt = (x, z) => {
      const k = pieceAt(x, z);
      if (k === TREAD) return T.riser * (T.steps - Math.ceil((z - LAND_Z) / T.tread - 1e-9));
      if (k === CHEEK) return GATE_Y + BG.floorAt(0, z - Z_GATE) + T.guard;
      return k === BED ? T.bed : k >= PEDESTAL ? LAND : 0;
    };
    const paved = (x, z) => pieceAt(x, z) === PAVED;
    // Under the gate: inside its footprint's outline, or within m of it.
    const underGate = (x, z) => {
      const o = FOOT.outline, gz = z - Z_GATE;
      let hit = false;
      for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
        const xi = o[i][0], zi = o[i][1], xj = o[j][0], zj = o[j][1];
        if (zi > gz !== zj > gz && x < (xj - xi) * (gz - zi) / (zj - zi) + xi) hit = !hit;
      }
      return hit;
    };
    const onGate = (x, z, m) => underGate(x, z) || underGate(x - m, z - m) || underGate(x + m, z - m) || underGate(x + m, z + m) || underGate(x - m, z + m);
    // The height of the green to plant on at (x, z), the court's, a bed's or the terrace's, clear of the gate; NaN on the
    // way, the stone, the gate or off the top.
    const soilAt = (x, z) => {
      const k = pieceAt(x, z);
      return top(x, z) && !onGate(x, z, 0.3) && (k === GREEN || k === BED || k === BASE) ? levelAt(x, z) : NaN;
    };
    // The front edge under the bridge: the nearest of the outermost blocks across its width.
    let frontZ = Infinity;
    for (let bx = -3; bx < 3; bx++) {
      let bz = B - 1;
      while (!blockDepth(bx, bz)) bz--;
      frontZ = Math.min(frontZ, bz + 1);
    }
    // Each fall pours from a whole metre block's outer side, found at its bearing along the top course.
    const falls = FALLS.map(([deg, len]) => {
      const f = faceAt(deg * DEG, u / 2), bx = Math.floor(f.xc / 2), bz = Math.floor(f.zc / 2);
      return { bx, bz, len, ry: Math.atan2(f.dx, f.dz), dx: f.dx, dz: f.dz, x: f.dx ? bx + (f.dx > 0 ? 1 : 0) : bx + 0.5, z: f.dz ? bz + (f.dz > 0 ? 1 : 0) : bz + 0.5 };
    });
    const nearFall = (bx, bz, d) => falls.some((f) => Math.abs(f.bx - bx) + Math.abs(f.bz - bz) <= d);
    return { edgeAt, reach, B, blockDepth, cellDepth, top, onTop, rim, faceAt, pieceAt, levelAt, paved, underGate, soilAt, frontZ, falls, nearFall };
  });

  // Plain placement data for the island, memoised: the pass's end along the axis (the rim), its floor, where the ridge
  // walls either side of it have ended (`wing`), the islet's middle a head and a deck's length out past the rim, level
  // with the head's top, and its turn; and, in the islet's frame, where the head's outer face, the rim, the wing and its
  // inland end fall. The frame is x across the axis and z = dist - along. Throws on any ground or clearance it cannot keep.
  const SPOTS = new WeakMap();
  const spot = (island) => {
    let s = SPOTS.get(island);
    if (s) return s;
    const ux = Math.sin(AXIS.bearing), uz = -Math.cos(AXIS.bearing), px = -uz, pz = ux, H = HEAD;
    const ground = (a, c) => island.surfaceAt(ux * a + px * c, uz * a + pz * c);
    let rim = AXIS.from;
    while (ground(rim + 0.05, 0) > 0.5) rim += 0.05;
    const floor = ground(rim - AXIS.floor, 0), level = floor + 0.05;
    // The pass's floor, wherever the tongue lies on land, is level.
    for (let a = rim - H.back; a <= rim + 1e-6; a += 0.05) for (let c = -H.tongue; c <= H.tongue + 1e-6; c += 0.25) {
      const g = ground(a, c);
      if (g > 0.5 && Math.abs(g - floor) > 0.05) throw new Error(`₿IFRÖST's head would sit on uneven ground (${g.toFixed(2)} m against the pass's ${floor.toFixed(2)})`);
    }
    // The head widens from the first line out along the axis with nothing above the floor across its sides; that holds
    // all the way out, and its pedestals stand outward of it.
    const walled = (a) => {
      for (let c = H.tongue; c <= H.half + 1e-6; c += 0.125) if (ground(a, c) > level || ground(a, -c) > level) return true;
      return false;
    };
    let wing = rim - H.back;
    while (walled(wing + 0.01)) wing += 0.05;
    for (let a = wing; a <= rim + H.over; a += 0.1) if (walled(a + 0.01)) throw new Error("₿IFRÖST's head runs into a ridge wall");
    if (wing > rim + HEAD_LAMP.u - HEAD_LAMP.side / 2 - 0.07) throw new Error(`₿IFRÖST's head pedestals stand ${(wing - rim).toFixed(2)} m past the rim, on a ridge wall`);
    // The islet's middle, with the deck running from the head's outer face to its front edge.
    const P = plan(), dist = rim + H.over + AXIS.deck + P.frontZ, x = ux * dist, z = uz * dist;
    // The other islets stay well clear: the Mempool island where its spot puts it, and the Timechain Sphere anywhere
    // out along its bearing, since where it stands is its own build's to find.
    const pool = BL.poolModels.spot(island, {}), T = BL.timechainModels;
    const out = Math.max(0, x * T.DIR.x + z * T.DIR.z);
    for (const [name, ox, oz, r] of [["Mempool island", pool.x, pool.z, BL.poolModels.SITE.isletR], ["Timechain Sphere", T.DIR.x * out, T.DIR.z * out, T.SITE.radius]]) {
      const apart = Math.hypot(ox - x, oz - z) - r - P.reach;
      if (apart < CLEAR) throw new Error(`₿IFRÖST's islet comes within ${apart.toFixed(1)} m of the ${name}`);
    }
    // Its turn sends local +z back along the axis toward the island.
    s = {
      x, y: floor + H.lift, z, ry: -AXIS.bearing, rim, wing, dist,
      head: { zOut: dist - rim - H.over, zRim: dist - rim, zWing: dist - wing, zIn: dist - rim + H.back }
    };
    SPOTS.set(island, s);
    return s;
  };

  // ---- the islet --------------------------------------------------------------------------------------

  // The rock in half-metre voxels, shaded block by block as the concept's are: grass on top in metre patches, a thick
  // rim of moss two or three blocks deep, earthy dirt under the grass, then grey-brown stone blocks each a shade of its
  // own with patches of dirt, in metre courses further down, tapering to a point; grout under the paving, and the blue
  // crystal cubes glowing in its face. Its collision shell is its own voxels with the terraces and props as closed boxes.
  const rock = cached(() => {
    const P = plan(), v = makeVox(), u = ROCK.unit;
    for (let bx = -P.B; bx < P.B; bx++) for (let bz = -P.B; bz < P.B; bz++) {
      const deep = P.blockDepth(bx, bz), rim = deep && P.rim(bx, bz);
      for (let xc = 2 * bx; deep && xc < 2 * bx + 2; xc++) for (let zc = 2 * bz; zc < 2 * bz + 2; zc++) {
        const paved = P.paved((xc + 0.5) * u, (zc + 0.5) * u);
        for (let j = 1; j <= deep; j++) {
          const h = hash(xc, j, zc), hb = hash(bx, j >> 1, bz);
          let c;
          if (j === 1) c = paved ? R.GROUT : rim ? (hb % 3 ? R.MOSS_LT : R.MOSS) : hash(bx, 1, bz) % 5 === 0 ? R.MOSS : hash(bx, 2, bz) % 2 ? R.GRASS : R.GRASS_LT;
          else if (rim && (j === 2 || j === 3 && h % 2)) c = R.MOSS;
          else if (j <= 3) c = h % 3 ? R.DIRT : R.DIRT_DK;
          else if (j <= 9) c = hb % 100 < 24 ? (h % 2 ? R.DIRT : R.DIRT_DK) : R.STONE + h % 4;
          else c = hb % 100 < 18 ? R.DIRT_DK : R.STONE + hb % 4;
          v.set(xc, -j, zc, c);
        }
      }
    }
    CRYSTALS.forEach(([deg, drop], i) => {
      const f = P.faceAt(deg * DEG, drop);
      v.set(f.xc, -f.j, f.zc, i % 3 ? R.CRYSTAL : R.CRYSTAL_LT);
    });
    const options = { unit: u, palette: ROCK_TONES, origin: { x: 0, y: 0, z: 0 } };
    const geo = voxelGeometry(v, { ...options, emissive: { [R.CRYSTAL]: 1, [R.CRYSTAL_LT]: 1 } });
    geo.cutawaySource = BL.terrain.cutawaySourceFromVox(v, options);
    // Flat-shaded blocks, each its own shade, as the gate's are: no masonry drawn over them.
    delete geo.voxel;
    geo.collisionGeometry = merge(geo, ...dress().shell);
    return geo;
  });

  // Moss hanging over the rim in curtains of quarter-metre cells, a curtain on most outer sides of the rim's blocks, each
  // strand its own length, darker down it to a light tip; none over the falls or where the bridge lands.
  const curtains = cached(() => {
    const P = plan(), v = makeVox();
    for (let bx = -P.B; bx < P.B; bx++) for (let bz = -P.B; bz < P.B; bz++) {
      if (!P.blockDepth(bx, bz) || !P.rim(bx, bz) || P.nearFall(bx, bz, 2)) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (P.blockDepth(bx + dx, bz + dz) || Math.abs(Math.atan2(bx + 0.5 + dx / 2, bz + 0.5 + dz / 2)) < 17 * DEG || hash(bx, 17 + dx * 3 + dz, bz) % 100 >= 62) continue;
        for (let c = 0; c < 4; c++) {
          const hc = hash(bx * 4 + c, 23 + dx, bz * 4 + c + dz), len = hc % 10;
          if (len < 2) continue;
          const fx = dx ? (dx > 0 ? 4 * (bx + 1) : 4 * bx - 1) : 4 * bx + c, fz = dz ? (dz > 0 ? 4 * (bz + 1) : 4 * bz - 1) : 4 * bz + c;
          for (let y = 1; y <= len; y++) v.set(fx, -y, fz, y === len ? 3 : y === 1 ? 2 : hc >> (y & 7) & 1);
        }
      }
    }
    // Sides laid flat against the rock are never seen: a side goes when the step off it away from its own cell lands in rock.
    const geo = voxelGeometry(v, { unit: ROCK.fine, palette: MOSS }), V = geo.verts, f = ROCK.fine, u = ROCK.unit;
    const inRock = (x, y, z) => y < 0 && P.cellDepth(Math.floor(x / u), Math.floor(z / u)) >= Math.ceil(-y / u);
    geo.faces = geo.faces.filter((face) => {
      const c = [0, 0, 0], n = face.i.length;
      for (const i of face.i) for (let k = 0; k < 3; k++) c[k] += V[i * 3 + k] / n;
      const axis = [0, 1, 2].find((k) => face.i.every((i) => Math.abs(V[i * 3 + k] - c[k]) < 1e-6)), p = c.slice(), q = c.slice();
      p[axis] += 0.05;
      q[axis] -= 0.05;
      const out = v.has(Math.floor(p[0] / f), Math.floor(p[1] / f), Math.floor(p[2] / f)) ? q : p;
      return !inRock(out[0], out[1], out[2]);
    });
    delete geo.voxel;
    return noShadow(geo);
  });

  // Yellow-green vines dangling under the rock from the undersides of its blocks, stepping a little as they fall, leaves
  // on alternate sides; about half end in a small glowing tip (`tips`), the rest in a leaf.
  const vines = cached(() => {
    const P = plan(), rand = mulberry32(6464), parts = [], tips = [];
    for (let k = 0; k < VINES; k++) {
      let a = (k + rand() * 0.7) / VINES * TAU - Math.PI;
      if (P.falls.some((f) => { const b = Math.atan2(f.x, f.z); return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.22; })) a += 0.34;
      const r = (0.6 + rand() * 0.33) * P.edgeAt(a), x0 = Math.sin(a) * r, z0 = Math.cos(a) * r, d = P.cellDepth(Math.floor(x0 / ROCK.unit), Math.floor(z0 / ROCK.unit));
      if (!d) continue;
      const top = -d * ROCK.unit, len = 2.4 + rand() * 4, glow = rand() < 0.55, seg = 0.45;
      let x = x0, z = z0, i = 0;
      for (let y = top; y > top - len + 1e-6; y -= seg, i++) {
        const h = Math.min(seg, y - (top - len));
        parts.push(box({ w: 0.12, h: h + 0.02, d: 0.12, color: VINE[i % 3 ? 0 : 1], offset: { x, y: y - h / 2, z } }));
        if (i % 2) parts.push(box({ w: 0.22, h: 0.14, d: 0.07, color: VINE[2 + (i >> 1) % 2], offset: { x: x + (i % 4 === 1 ? 0.14 : -0.14), y: y - h * 0.4, z } }));
        x += ((i * 7 + k) % 3 - 1) * 0.04;
        z += ((i * 5 + k) % 3 - 1) * 0.04;
      }
      (glow ? tips : parts).push(box({ w: 0.13, h: 0.16, d: 0.13, color: glow ? (k % 3 ? "#e4ff7a" : "#9ff3ff") : VINE[3], emissive: glow ? 1 : 0, offset: { x, y: top - len - 0.08, z } }));
    }
    return { vines: noShadow(merge(...parts)), tips: noShadow(merge(...tips)) };
  });

  // A waterfall's parts in its own frame, its rock face at z 0 with +z out and x along the face, pouring from y 0 down:
  // a metre of stream as four streaks of blue at their own depths with two bright pixels (two of them, alternated), the
  // broken tail it ends in, the lip on the top where it runs out over the edge, and a drip.
  const fallPiece = variants((i) => {
    const parts = [];
    for (let c = 0; c < 4; c++) {
      const h = hash(c, i, 5), deep = 0.12 + h % 3 * 0.04;
      parts.push(box({ w: 0.25, h: 1.01, d: deep, color: WATER[(c + i * 2 + (h >> 3)) % 3], emissive: 0.9, offset: { x: -0.375 + c * 0.25, y: -0.5, z: 0.03 + deep / 2 } }));
    }
    for (let p = 0; p < 2; p++) {
      const h = hash(p, i, 9);
      parts.push(box({ w: 0.25, h: 0.25, d: 0.05, color: FOAM, emissive: 1, offset: { x: -0.375 + h % 4 * 0.25, y: -0.125 - (h >> 2) % 4 * 0.25, z: 0.255 } }));
    }
    return noShadow(merge(...parts));
  });
  const fallTail = cached(() => noShadow(merge(
    box({ w: 0.25, h: 0.7, d: 0.14, color: WATER[1], emissive: 0.9, offset: { x: -0.25, y: -0.35, z: 0.1 } }),
    box({ w: 0.25, h: 1, d: 0.18, color: WATER[2], emissive: 1, offset: { y: -0.5, z: 0.12 } }),
    box({ w: 0.25, h: 0.45, d: 0.12, color: WATER[0], emissive: 0.9, offset: { x: 0.25, y: -0.225, z: 0.09 } }),
    box({ w: 0.12, h: 0.2, d: 0.12, color: FOAM, emissive: 1, offset: { x: -0.25, y: -0.95, z: 0.1 } }),
    box({ w: 0.12, h: 0.16, d: 0.12, color: FOAM, emissive: 1, offset: { x: 0.25, y: -0.72, z: 0.09 } })
  )));
  const fallLip = cached(() => merge(
    box({ w: 1, h: 0.06, d: 0.95, color: WATER[1], emissive: 0.9, offset: { y: 0.03, z: -0.45 } }),
    box({ w: 0.8, h: 0.03, d: 0.6, color: FOAM, emissive: 1, offset: { y: 0.07, z: -0.35 } }),
    box({ w: 1.04, h: 0.3, d: 0.26, color: WATER[2], emissive: 1, offset: { y: -0.08, z: 0.14 } })
  ));
  const drip = cached(() => noShadow(box({ w: 0.12, h: 0.18, d: 0.12, color: "#bfe8ff", emissive: 1 })));

  // The fittings the court's lanterns hang from: a post with an arm out over the rim (+z) and a chain at its end, and an
  // iron bracket let into the rock's face with its arm and chain. A banner's gallows: two posts with gold caps and a bar,
  // and an arm out from its +x post with a lantern's chain.
  const rimPost = cached(() => merge(
    bevelBox({ w: 0.22, h: 2.5, d: 0.22, color: TIMBER_DK, bevel: 0.04, offset: { y: 1.25 } }),
    bevelBox({ w: 0.14, h: 0.14, d: 1.02, color: TIMBER, bevel: 0.03, offset: { y: 2.36, z: 0.4 } }),
    moved(turnedX(bevelBox({ w: 0.1, h: 0.62, d: 0.1, color: TIMBER, bevel: 0.02 }), Math.PI / 4), 0, 2.08, 0.22),
    box({ w: 0.035, h: 0.16, d: 0.035, color: IRON, offset: { y: 2.21, z: 0.82 } })
  ));
  const RIM_HANG = { y: 2.13 - 0.6, z: 0.82 };
  const bracket = cached(() => merge(
    box({ w: 0.2, h: 0.34, d: 0.05, color: IRON, offset: { z: 0.025 } }),
    box({ w: 0.07, h: 0.07, d: 0.56, color: IRON, offset: { y: 0.1, z: 0.28 } }),
    box({ w: 0.03, h: 0.15, d: 0.03, color: IRON, offset: { z: 0.5 } })
  ));
  const BRACKET_HANG = { y: -0.075 - 0.6, z: 0.5 };
  const gallows = cached(() => merge(
    ...[-1, 1].flatMap((s) => [
      bevelBox({ w: 0.2, h: 3.2, d: 0.2, color: TIMBER_DK, bevel: 0.04, offset: { x: s * 0.72, y: 1.6 } }),
      bevelBox({ w: 0.26, h: 0.12, d: 0.26, color: GOLD, emissive: 0.2, bevel: 0.03, offset: { x: s * 0.72, y: 3.26 } })
    ]),
    bevelBox({ w: 1.84, h: 0.16, d: 0.16, color: TIMBER, bevel: 0.035, offset: { y: 3.02 } }),
    bevelBox({ w: 0.6, h: 0.1, d: 0.1, color: TIMBER, bevel: 0.025, offset: { x: 1.1, y: 2.62 } }),
    box({ w: 0.035, h: 0.14, d: 0.035, color: IRON, offset: { x: 1.3, y: 2.5 } })
  ));
  const GALLOWS_HANG = { x: 1.3, y: 2.43 - 0.6 };

  // Everything dressing the islet, built once a page in its frame: the terraces' stone and the props (the lower flight,
  // pedestals and braziers, the cheeks, the retaining walls' facing over their cores, posts, gallows and banners, the
  // lanterns' bodies and brackets) merged, the flags and the green, the flowers, the moss, vines and the always-lit parts
  // (vine tips, the falls' lips), the lanterns' glass and the fires for the dusk ramp, the collision boxes, where the
  // foliage stands and where the falls pour. Each placed thing stands wholly on one green, the court's, a bed's or the
  // terrace's, at its height.
  const dress = cached(() => {
    const P = plan(), T = TERRACE, K = T.skin, G = GATE.stairs, LOW = [0.38, 0.37], TALL = [0.38, 0.37, 0.38, 0.37], DIRT = ROCK_TONES[R.DIRT], RISER = 0.12;
    const lamp = BG.lantern(), fire = BG.brazier(), banner = BG.runeBanner(1, "post");
    const props = [], marks = [], glass = [], fires = [], light = [vines().tips], blooms = [], shell = [], foliage = [], paving = geometry();
    const ground = (x, z, what, r) => {
      const y = P.soilAt(x, z);
      if (!(y >= 0) || P.soilAt(x - r, z - r) !== y || P.soilAt(x + r, z - r) !== y || P.soilAt(x + r, z + r) !== y || P.soilAt(x - r, z + r) !== y) {
        throw new Error(`₿IFRÖST's ${what} at ${x.toFixed(2)}, ${z.toFixed(2)} is off the green`);
      }
      return y;
    };
    const lantern = (x, y, z, ry = 0) => {
      props.push(put(lamp.body, x, y, z, ry));
      glass.push(put(lamp.glass, x, y, z, ry));
    };
    // The terrace and the beds stand wholly on the rock.
    for (const [x, z] of [[T.baseOut, BASE_Z], [T.baseOut, T.front], [T.bedOut, T.front]]) {
      if (!P.onTop(x, z, 0.01) || !P.onTop(-x, z, 0.01)) throw new Error(`₿IFRÖST's terrace overhangs the rock at ±${x}, ${z}`);
    }
    // The paving: the way from the bridge to the lower flight, and the landing out to its front edge.
    flags(paving, -COURT.path, COURT.path, T.foot - 0.05, P.frontZ - 0.45, 1);
    flags(paving, -T.half, T.half, LAND_Z - 4 * COURT.flag, LAND_Z, 3, null, LAND);
    // The lower flight: its treads, and the riser up to the landing under the landing's front flags, each course in big
    // pale blocks breaking joint with the next.
    for (let k = 1; k <= T.steps; k++) {
      const top = T.riser * k, z1 = T.foot - T.tread * (k - 1), z0 = k < T.steps ? z1 - T.tread : z1 - RISER, y0 = k < T.steps ? 0 : top - T.riser;
      const cuts = k % 2 ? [-T.flight, -0.7, 0.7, T.flight] : [-T.flight, -1.4, 0, 1.4, T.flight];
      for (let c = 0; c + 1 < cuts.length; c++) {
        props.push(bevelBox({ w: cuts[c + 1] - cuts[c] - 0.02, h: top - y0, d: z1 - z0, color: INK.STEP[(k + c) % INK.STEP.length], bevel: 0.04, offset: { x: (cuts[c] + cuts[c + 1]) / 2, y: (top + y0) / 2, z: (z0 + z1) / 2 } }));
      }
      if (k < T.steps) shell.push(block(-T.flight, T.flight, -0.2, top, z0, z1));
    }
    // The terrace under the landing, the gate and all behind it, at the landing's height: its core within its facing and
    // behind the lower flight's last riser, showing only as the grout between the landing's flags, its back wall, and the
    // green beside and behind the gate.
    props.push(cube(K - T.baseOut, T.baseOut - K, 0, LAND - 0.02, BASE_Z + K, LAND_Z - RISER, GROUT));
    shell.push(block(-T.baseOut, T.baseOut, -0.2, LAND, BASE_Z, LAND_Z));
    wall(props, "x", -T.baseOut, T.baseOut, BASE_Z, BASE_Z + K, 0, LOW, 92);
    turf(paving, K - T.baseOut, T.baseOut - K, BASE_Z + K, LEDGE_Z, LAND - 0.004, 66, (xa, xb, za, zb) => P.underGate(xa, za) && P.underGate(xb, za) && P.underGate(xb, zb) && P.underGate(xa, zb));
    for (const s of [-1, 1]) {
      const px = s * BRAZIER.x;
      // The terrace's wing beside the landing, and the bed on it beside the landing and beside the cheeks: the rest of the
      // terrace's core beside the riser and the bed's cores, within their facing, the shells, dressed stone facing the walls that show (the terrace's side and its wing's front,
      // the bed's front down to the court, and the bed's sides over the terrace, toward the landing and toward the gate's
      // flight), and the green.
      props.push(
        cube(...span(s, T.flight, T.baseOut - K), 0, LAND - 0.02, LAND_Z - RISER, LAND_Z, GROUT),
        cube(...span(s, T.half + K, T.bedOut - K), LAND, T.bed - 0.02, LEDGE_Z, T.front - K, DIRT),
        cube(...span(s, STAIR + T.cheek, T.half + K), LAND, T.bed - 0.02, LEDGE_Z, T.back - K, DIRT)
      );
      shell.push(
        block(...span(s, T.half, T.baseOut), -0.2, LAND, LAND_Z, T.front),
        block(...span(s, T.half, T.bedOut), LAND - 0.05, T.bed, T.back, T.front),
        block(...span(s, STAIR + T.cheek, T.bedOut), LAND - 0.05, T.bed, LEDGE_Z, T.back)
      );
      wall(props, "z", BASE_Z + K, T.front, ...span(s, T.baseOut - K, T.baseOut), 0, LOW, 80 + s);
      wall(props, "x", ...span(s, T.bedOut, T.baseOut - K), T.front - K, T.front, 0, LOW, 82 + s);
      wall(props, "x", ...span(s, T.half, T.bedOut), T.front - K, T.front, 0, TALL, 84 + s);
      wall(props, "z", LEDGE_Z, T.front - K, ...span(s, T.bedOut - K, T.bedOut), LAND, LOW, 86 + s);
      wall(props, "z", T.back, T.front - K, ...span(s, T.half, T.half + K), LAND, LOW, 88 + s);
      wall(props, "x", ...span(s, STAIR + T.cheek, T.half + K), T.back - K, T.back, LAND, LOW, 90 + s);
      turf(paving, ...span(s, T.bedOut, T.baseOut - K), LEDGE_Z, T.front - K, LAND - 0.004, 60 + s);
      turf(paving, ...span(s, T.half + K, T.bedOut - K), LEDGE_Z, T.front - K, T.bed - 0.004, 62 + s);
      turf(paving, ...span(s, STAIR + T.cheek, T.half + K), LEDGE_Z, T.back - K, T.bed - 0.004, 64 + s);
      // The pedestal beside the lower flight in two big courses, and its brazier.
      props.push(
        bevelBox({ w: T.half - T.flight, h: 0.37, d: T.pedestal - LAND_Z, color: DRESSED[1], bevel: 0.05, offset: { x: px, y: 0.185, z: BRAZIER.z } }),
        bevelBox({ w: T.half - T.flight, h: LAND - 0.37, d: T.pedestal - LAND_Z, color: DRESSED_LT, bevel: 0.05, offset: { x: px, y: (0.37 + LAND) / 2, z: BRAZIER.z } }),
        put(fire.stone, px, LAND, BRAZIER.z)
      );
      fires.push(put(fire.fire, px, LAND, BRAZIER.z));
      shell.push(block(...span(s, T.flight, T.half), -0.2, LAND, LAND_Z, T.pedestal), block(px - 0.5, px + 0.5, LAND - 0.05, LAND + 1.02, BRAZIER.z - 0.5, BRAZIER.z + 0.5));
      // The cheeks of the gate's flight: beside each tread a dressed block standing `guard` over it.
      for (let k = 1; k < G.steps; k++) {
        const z0 = LEDGE_Z + G.tread * (k - 1), top = GATE_Y - G.riser * k + T.guard;
        props.push(bevelBox({ w: T.cheek, h: top - LAND, d: G.tread, color: k % 2 ? DRESSED_LT : DRESSED[2], bevel: 0.05, offset: { x: s * (STAIR + T.cheek / 2), y: (LAND + top) / 2, z: z0 + G.tread / 2 } }));
        shell.push(block(...span(s, STAIR, STAIR + T.cheek), LAND - 0.05, top, z0, z0 + G.tread));
      }
    }
    // The banners on their gallows at the front corners, facing the way in, each with a lantern hung from its outer arm.
    for (const [x, z] of FRONT_BANNERS) {
      const out = Math.sign(x), y = ground(x - 0.72, z, "banner post", 0.12);
      if (ground(x + 0.72, z, "banner post", 0.12) !== y) throw new Error(`₿IFRÖST's banner at ${x}, ${z} straddles two levels`);
      props.push(put(gallows(), x, y, z, out > 0 ? 0 : Math.PI), put(banner.cloth, x, y + 2.94, z + 0.1), put(banner.rod, x, y + 2.94, z + 0.1));
      marks.push(put(banner.mark, x, y + 2.94, z + 0.1));
      lantern(x + out * GALLOWS_HANG.x, y + GALLOWS_HANG.y, z);
      for (const s of [-1, 1]) shell.push(block(x + s * 0.72 - 0.12, x + s * 0.72 + 0.12, y - 0.2, y + 3.2, z - 0.12, z + 0.12));
    }
    // Lantern posts round the rim, each drawn in from the edge until it stands wholly on the rock and hanging its lantern
    // out over the edge.
    for (const deg of RIM_POSTS) {
      const a = deg * DEG, sa = Math.sin(a), ca = Math.cos(a);
      let r = P.edgeAt(a) - 0.55;
      while (!P.onTop(sa * r, ca * r, 0.15)) r -= 0.05;
      const x = sa * r, z = ca * r, y = ground(x, z, "lantern post", 0.13);
      props.push(put(rimPost(), x, y, z, a));
      lantern(x + sa * RIM_HANG.z, y + RIM_HANG.y, z + ca * RIM_HANG.z, a);
      shell.push(block(x - 0.13, x + 0.13, y - 0.2, y + 2.5, z - 0.13, z + 0.13));
    }
    // Lanterns on the rock's face, each on its bracket.
    for (const [deg, drop] of ROCK_LAMPS) {
      const f = P.faceAt(deg * DEG, drop), ry = Math.atan2(f.dx, f.dz);
      props.push(put(bracket(), f.x, f.y, f.z, ry));
      lantern(f.x + f.dx * BRACKET_HANG.z, f.y + BRACKET_HANG.y, f.z + f.dz * BRACKET_HANG.z, ry);
    }
    // The foliage, each on its green with the trees' trunks in the shell: palms leaning out from the terrace beside the
    // gate, the pink blossom trees, the green trees and the bushes; and the flowers.
    const plant = (geometry, x, z, what, r, k, ry, trunk) => {
      const y = ground(x, z, what, r);
      foliage.push({ geometry, x, y, z, ry, k });
      if (trunk) shell.push(block(x - r, x + r, y - 0.2, y + trunk, z - r, z + r));
    };
    for (const [x, z, v] of PALMS) plant(BL.dressing.palm(v), x, z, "palm", 0.22, 1.15, Math.atan2(x, z) - Math.PI / 2, 2.2);
    for (const [x, z] of BLOSSOMS) plant(HM.tree(3), x, z, "blossom tree", 0.2, 1.1, hash(3, Math.round(x), 3) % 628 / 100, 1.8);
    for (const [x, z, v, k] of TREES) plant(HM.tree(v), x, z, "tree", 0.2, k, hash(v, Math.round(x), 3) % 628 / 100, 1.8 * k);
    for (const [x, z, v] of BUSHES) plant(HM.bush(v), x, z, "bush", 0.3, 1.1, hash(Math.round(x * 3), Math.round(z * 3), 5) % 628 / 100, 0);
    FLOWERS.forEach(([x, z], i) => flowerPatch(blooms, x, ground(x, z, "flower patch", 0.3), z, 40 + i));
    // Where the falls pour, and their lips over the rim.
    for (const f of P.falls) light.push(put(fallLip(), f.x, 0, f.z, f.ry));
    const bannerMarks = noShadow(merge(...marks));
    bannerMarks.depthOffset = true;
    return {
      props: merge(...props), bannerMarks, flags: noShadow(paving), flowers: noShadow(merge(...blooms)), glass: noShadow(merge(...glass)), fire: noShadow(merge(...fires)),
      light: noShadow(merge(...light)), shell, foliage, falls: P.falls
    };
  });

  // ---- Bifröst ----------------------------------------------------------------------------------------

  // A crystal tile of the deck, one per tone and shared by every tile of it: a base of dark glass in its hue, a little
  // wider than the rest so dark lines run between the tiles, under a saturated glowing top; on the top a raised core of
  // a lighter tint, the glow from within, and a white glint along its -x edge.
  const tile = variants((i) => {
    const tone = TILE_TONES[i], T = TILE, geo = geometry();
    slab(geo, 0, 0, T.base, T.base, T.bed, T.seat, blend(tone, DECK_BED, 0.62), blend(tone, DECK_BED, 0.7), 0.4, 0.3);
    slab(geo, 0, 0, T.top, T.top, T.seat, 0, tone, blend(tone, DECK_BED, 0.3), 0.9, 0.7);
    slab(geo, 0, 0, T.core, T.core, 0, T.rise, blend(tone, "#ffffff", 0.42), blend(tone, "#ffffff", 0.25), 1, 1);
    slab(geo, T.glint / 2 - T.top, 0, T.glint / 2, T.top, 0, T.lip, blend(tone, "#ffffff", 0.85), blend(tone, "#ffffff", 0.7), 1, 1);
    return noShadow(geo);
  });
  // The tone of the tile in column `c` and row `r` of `rows`, counted out from the head: cyan and blue toward the
  // edges, violet, magenta and pink toward the middle, shading along the deck, bluer by the island and pinker mid-span,
  // with warm patches of gold and peach that grow toward the islet.
  const tileTone = (c, r, rows) => {
    const t = r / (rows - 1);
    if (hash(c >> 1, r >> 1, 71) % 1000 < 100 + 160 * t && hash(c, r, 73) % 3) {
      const k = hash(c, r, 77) % 10;
      return k < 5 ? TONE.gold : k < 8 ? TONE.peach : TONE.pale;
    }
    const e = Math.abs(c - (BRIDGE.cols - 1) / 2) / ((BRIDGE.cols - 1) / 2);
    const q = TONE.ramp * (1 - e) + 1.4 * Math.sin(Math.PI * t) - 1.2 * (1 - t) + 1.2 * Math.sin(r * 0.47 + c * 1.3) + 0.7 * Math.sin(r * 0.19 - c * 0.6 + 2) + hash(c, r, 83) % 100 / 100 - 0.5;
    return Math.min(TONE.ramp, Math.max(0, Math.round(q)));
  };
  // A four-point star of white light lying flat, one geometry for every sparkle on the deck.
  const sparkle = cached(() => {
    const geo = geometry(), l = 0.1, t = 0.022;
    facing(geo, [[-l, 0, 0], [0, 0, -t], [l, 0, 0], [0, 0, t]], "#ffffff", 1, 0, 1, 0);
    facing(geo, [[0, 0, -l], [t, 0, 0], [0, 0, l], [-t, 0, 0]], "#ffffff", 1, 0, 1, 0);
    return noShadow(geo);
  });
  // Everything that depends on the spot, built once a spot in the islet's frame. The bridge, from the islet's front edge
  // (`zEnd`) to the head's outer face (`zHead`): a stone slab and keel with sills at both ends and a dark bed for the
  // tiles; pillars every `BRIDGE.every` or so, each with a lantern, and parapet walls of dressed blocks between them
  // carrying glass panes in steel rails. Its head, from there back onto the pass: a slab of dressed blocks, flagged,
  // over corbels stepping in course by course back into the cliff, with low walls along its open sides, its lantern
  // pedestals and its candles. And the tiles' and sparkles' places, each tile with its place in the light's wave.
  const BRIDGES = new WeakMap();
  const bridgeOf = (s) => {
    let b = BRIDGES.get(s);
    if (b) return b;
    const P = plan(), h = s.head, zEnd = P.frontZ, zHead = h.zOut, len = zHead - zEnd, mid = (zEnd + zHead) / 2, lamp = BG.lantern();
    const W = BRIDGE.half, PX = W + BRIDGE.pillar / 2, OUT = W + BRIDGE.pillar;
    const n = Math.max(1, Math.round((len - BRIDGE.pillar) / BRIDGE.every)), step = (len - BRIDGE.pillar) / n;
    const posts = Array.from({ length: n + 1 }, (_, i) => zEnd + BRIDGE.pillar / 2 + i * step);
    const rows = Math.floor((len - 2 * BRIDGE.sill) / BRIDGE.tile), sill = (len - rows * BRIDGE.tile) / 2;
    const stone = [], trims = [], panes = [], glass = [], lights = [], shell = [], paving = geometry();
    stone.push(
      box({ w: 2 * OUT, h: 0.4, d: len + 0.45, color: DRESSED_DK, offset: { y: -0.3, z: mid - 0.225 } }),
      bevelBox({ w: 2 * W + 0.4, h: 0.45, d: len - 0.6, color: ROCK_TONES[R.STONE + 3], bevel: 0.08, offset: { y: -0.725, z: mid } }),
      box({ w: 2 * W, h: 0.035, d: len - 2 * sill + 0.02, color: DECK_BED, offset: { y: -0.0825, z: mid } }),
      ...[[zEnd - 0.45, zEnd + sill], [zHead - sill, zHead]].map(([a, c]) => bevelBox({ w: 2 * W, h: 0.145, d: c - a, color: DRESSED_LT, bevel: 0.035, offset: { y: -0.0475, z: (a + c) / 2 } }))
    );
    for (const z of posts) for (const sx of [-1, 1]) {
      const x = sx * PX;
      pillar(stone, x, z, -0.1, BRIDGE.pillarH);
      stone.push(bevelBox({ w: 0.62, h: 0.55, d: 0.62, color: DRESSED_DK, bevel: 0.06, offset: { x, y: -0.8, z } }));
      trims.push(put(lamp.body, x, BRIDGE.pillarH, z));
      glass.push(put(lamp.glass, x, BRIDGE.pillarH, z));
      shell.push(block(x - BRIDGE.pillar / 2, x + BRIDGE.pillar / 2, -0.1, BRIDGE.pillarH, z - BRIDGE.pillar / 2, z + BRIDGE.pillar / 2));
    }
    for (let i = 0; i < n; i++) {
      const z0 = posts[i] + BRIDGE.pillar / 2, z1 = posts[i + 1] - BRIDGE.pillar / 2, zm = (z0 + z1) / 2, l = z1 - z0;
      for (const sx of [-1, 1]) {
        const b0 = sx > 0 ? W : -W - BRIDGE.wall, xm = b0 + BRIDGE.wall / 2;
        wall(stone, "z", z0, z1, b0, b0 + BRIDGE.wall, -0.1, [0.47, 0.48], 7 + i * 2 + (sx > 0 ? 1 : 0));
        trims.push(box({ w: 0.05, h: 0.05, d: l + 0.1, color: STEEL, offset: { x: xm, y: 1.13, z: zm } }));
        for (let k = 1, m = Math.max(2, Math.round(l / 0.8)); k < m; k++) trims.push(box({ w: 0.04, h: 0.29, d: 0.04, color: STEEL, offset: { x: xm, y: 0.99, z: z0 + l * k / m } }));
        panes.push(box({ w: 0.025, h: 0.26, d: l, color: PANE, offset: { x: xm, y: 0.98, z: zm } }));
      }
    }
    // The deck's shell: one slab from the islet to the head, and closed guards along both sides above the step
    // height, open at the ends.
    shell.push(block(-OUT, OUT, -0.5, 0, zEnd - 0.45, zHead));
    for (const sx of [-1, 1]) shell.push(block(sx > 0 ? W : -OUT, sx > 0 ? OUT : -W, -0.1, BRIDGE.guard, zEnd, zHead));
    // The head: its slab edged with a pale row of blocks along its outer face and its sides round a mortar core out to
    // the wing, the tongue between the ridge walls back to its inland end, and flags over both; its shell stops at the
    // wing, so it never reaches into a ridge wall.
    const H = HEAD, hx = H.half, K = H.kerb, zBack = h.zIn + H.sunk;
    run(stone, "x", -hx, hx, zHead, zHead + K, -H.slab, H.slab, 50, -0.35);
    for (const sx of [-1, 1]) run(stone, "z", zHead + K, h.zWing, sx > 0 ? hx - K : -hx, sx > 0 ? hx : -hx + K, -H.slab, H.slab, 51 + (sx > 0 ? 1 : 0), -0.35);
    stone.push(box({ w: 2 * (hx - K), h: H.slab - 0.01, d: h.zWing - zHead - K, color: GROUT, offset: { y: -(H.slab + 0.01) / 2, z: (zHead + K + h.zWing) / 2 } }));
    shell.push(block(-hx, hx, -H.slab, 0, zHead, h.zWing));
    flags(paving, K - hx, hx - K, zHead + K, h.zWing, 4);
    if (h.zIn > h.zWing) {
      stone.push(box({ w: 2 * H.tongue, h: H.slab - 0.01, d: h.zIn - h.zWing, color: DRESSED_DK, offset: { y: -(H.slab + 0.01) / 2, z: (h.zWing + h.zIn) / 2 } }));
      shell.push(block(-H.tongue, H.tongue, -H.slab, 0, h.zWing, h.zIn));
      flags(paving, -H.tongue, H.tongue, h.zWing, h.zIn, 5);
    }
    // Its corbels, course under course below the pass's floor, each a row of blocks across its face and down its sides
    // round a mortar core, stepping in from the one above and darker the deeper they go, running back into the cliff.
    for (let k = 0; k < H.corbels; k++) {
      const y0 = -H.slab - (k + 1) * H.course, xk = hx - H.side * (k + 1), zf = zHead + H.step * (k + 1), shade = 0.12 + 0.2 * k;
      run(stone, "x", -xk, xk, zf, zf + K, y0, H.course, 60 + k, shade);
      for (const sx of [-1, 1]) run(stone, "z", zf + K, zBack, sx > 0 ? xk - K : -xk, sx > 0 ? xk : K - xk, y0, H.course, 70 + 2 * k + (sx > 0 ? 1 : 0), shade);
      stone.push(box({ w: 2 * (xk - K), h: H.course - 0.02, d: zBack - zf - K, color: GROUT, offset: { y: y0 + H.course / 2, z: (zf + K + zBack) / 2 } }));
      shell.push(block(-xk, xk, y0, y0 + H.course, zf, zBack));
    }
    // Either side of the way: a low wall of dressed blocks along the head's open side, from the deck's last pillar to
    // where the ridge wall stands, its shell a guard as high as the deck's, so nobody walks off the head; a lantern
    // pedestal set in it where the head leaves the rim; and two clusters of candles on its top. The walls and pedestals
    // stand in the shell.
    const out = (u) => h.zRim - u, foot = HEAD_LAMP.side / 2 + 0.07;
    const HW = HEAD_WALL, wallTop = HW.courses.reduce((a, b) => a + b, -0.1);
    for (const sx of [-1, 1]) {
      const x = sx * HEAD_LAMP.x, z = out(HEAD_LAMP.u);
      wall(stone, "z", zHead, h.zWing, ...span(sx, HW.x, HW.x + HW.t), -0.1, HW.courses, 56 + sx);
      shell.push(block(...span(sx, HW.x, HW.x + HW.t), -0.1, BRIDGE.guard, zHead, h.zWing));
      pillar(stone, x, z, 0, HEAD_LAMP.h, HEAD_LAMP.side);
      trims.push(put(lamp.body, x, HEAD_LAMP.h, z));
      lights.push(put(lamp.glass, x, HEAD_LAMP.h, z));
      shell.push(block(x - foot, x + foot, -0.1, HEAD_LAMP.h, z - foot, z + foot));
      for (const [cx, u] of HEAD_CANDLES) for (const [dx, du, ch] of CLUSTER) candle(trims, lights, sx * (cx + dx), wallTop, out(u + du), ch);
    }
    const geo = merge(...stone);
    geo.collisionGeometry = merge(...shell);
    const pane = noShadow(merge(...panes));
    pane.glass = 0.32;
    // The tiles in rows out from the head, and the sparkles, each lying on a tile of its own choosing.
    const tiles = [], sparkles = [], rand = mulberry32(6060);
    for (let r = 0; r < rows; r++) for (let c = 0; c < BRIDGE.cols; c++) {
      const z = zHead - sill - (r + 0.5) * BRIDGE.tile;
      tiles.push({ x: (c - (BRIDGE.cols - 1) / 2) * BRIDGE.tile, z, tone: tileTone(c, r, rows), phase: (zHead - z) / LANE.wave, seed: hash(c, r, 79) % 1000 / 1000 * TAU });
    }
    for (let k = 0; k < SPARK.count; k++) {
      const i = Math.floor(rand() * tiles.length), t = tiles[i];
      sparkles.push({ tile: i, x: t.x + (rand() - 0.5) * 2 * SPARK.spread, z: t.z + (rand() - 0.5) * 2 * SPARK.spread, ry: rand() * Math.PI / 2, k: 0.7 + rand() * 0.6, phase: rand() * TAU, rate: 1.1 + rand() * 1.8 });
    }
    b = {
      zEnd, zHead, stone: geo, trims: merge(...trims), panes: pane, paving: noShadow(paving), glass: noShadow(merge(...glass)), lights: noShadow(merge(...lights)),
      tiles, sparkles
    };
    BRIDGES.set(s, b);
    return b;
  };

  // ---- the site ---------------------------------------------------------------------------------------

  // The visit's nodes under one group at the islet's middle, turned by `spot.ry`, with the gate standing on the terrace so
  // its flight climbs from the landing, and the records the hub places things by, in world space: the portal's frame
  // from the gate's, Heimdall on the landing, where an Ooga stands out of the chamber (on the landing, facing out), the
  // view down the bridge, the clouds' keep-out, the ground the scatter must give up, and `groundAt`, the walking height
  // on the islet's top (the gate's flight, landing and passage by its own `floorAt`, every other level by the plan's),
  // the deck and the head, or -Infinity off them. The deck's warmth (`heat`, a tile each) and the walker's frame and lift (`walk`) are the
  // visit's, for `update`.
  const site = (s) => {
    const P = plan(), D = dress(), B = bridgeOf(s), G = BG.build(), h = s.head, falls = [], drips = [];
    const sr = Math.sin(s.ry), cr = Math.cos(s.ry), wx = (x, z) => s.x + x * cr + z * sr, wz = (x, z) => s.z - x * sr + z * cr;
    const hidden = (geometry, extra = {}) => createNode({ geometry, sightHidden: true, ...extra });
    const atGate = () => ({ position: { x: 0, y: GATE_Y, z: Z_GATE } });
    const plant = (f) => hidden(f.geometry, { position: { x: f.x, y: f.y, z: f.z }, rotation: { x: 0, y: f.ry, z: 0 }, scale: { x: f.k, y: f.k, z: f.k } });
    const node = createNode({ position: { x: s.x, y: s.y, z: s.z }, rotation: { x: 0, y: s.ry, z: 0 } });
    const islet = createNode({ geometry: rock() }), gatehouse = createNode({ geometry: G.stone, ...atGate() }), bridge = createNode({ geometry: B.stone });
    const decor = [
      hidden(D.props), hidden(D.flags), hidden(D.flowers), hidden(curtains()), hidden(vines().vines), hidden(D.light),
      hidden(G.trims, atGate()), hidden(G.banners, atGate()), hidden(G.light, atGate()), hidden(G.field, atGate()),
      hidden(D.bannerMarks, { depthBias: -0.3 }), hidden(G.bannerMarks, { ...atGate(), depthBias: -0.3 }),
      hidden(B.trims), hidden(B.panes), hidden(B.paving), ...D.foliage.map(plant)
    ];
    const lamps = [hidden(G.glow, atGate()), hidden(D.glass), hidden(D.fire), hidden(B.glass), hidden(B.lights)];
    const lanes = B.tiles.map((t) => ({ node: hidden(tile(t.tone), { position: { x: t.x, y: 0, z: t.z } }), x: t.x, z: t.z, phase: t.phase, seed: t.seed }));
    const sparkles = B.sparkles.map((p) => ({
      node: hidden(sparkle(), { position: { x: p.x, y: SPARK.y, z: p.z }, rotation: { x: 0, y: p.ry, z: 0 }, scale: { x: p.k, y: 1, z: p.k } }),
      tile: p.tile, phase: p.phase, rate: p.rate
    }));
    D.falls.forEach((f, w) => {
      for (let k = 0; k < f.len; k++) {
        falls.push({ node: hidden(k === f.len - 1 ? fallTail() : fallPiece(k % 2), { position: { x: f.x, y: -k, z: f.z }, rotation: { x: 0, y: f.ry, z: 0 } }), phase: k / FALL.band + w * 0.37 });
      }
      for (let d = 0; d < 3; d++) {
        const o = (d - 1) * 0.28;
        drips.push({ node: hidden(drip(), { position: { x: f.x + f.dz * o + f.dx * 0.12, y: -f.len, z: f.z - f.dx * o + f.dz * 0.12 } }), top: -f.len - 0.12, seed: (w * 3 + d) * 0.29 % 1, speed: 0.55 + d * 0.17 });
      }
    });
    addChild(node, islet, gatehouse, bridge, ...decor, ...lamps, ...lanes.map((t) => t.node), ...sparkles.map((p) => p.node), ...falls.map((f) => f.node), ...drips.map((d) => d.node));
    const portal = {
      x: wx(0, Z_GATE), z: wz(0, Z_GATE), ry: s.ry, floorY: s.y + GATE_Y, fieldZ: GATE.fieldZ, halfW: GATE.halfW, spring: GATE.spring,
      room: { ...GATE.room }, opening: { minX: -GATE.halfW, maxX: GATE.halfW, floorY: 0, ceilingY: GATE.spring + GATE.halfW }
    };
    // The view from over the pass's end, just inland of the head, down the bridge to the gate.
    const back = h.zIn + VIEW.back, ahead = B.zEnd - VIEW.ahead, dist = (back - ahead) / Math.cos(VIEW.pitch);
    const view = { yaw: s.ry, pitch: VIEW.pitch, dist, target: { x: wx(0, ahead), y: s.y + VIEW.up, z: wz(0, ahead) } };
    // The ground the home scatter gives up: the pass's end before the head, and the head.
    const pass = h.zIn + 1, middle = (h.zIn + h.zOut) / 2;
    const claims = [[wx(0, pass), wz(0, pass), 2.6], [wx(0, middle), wz(0, middle), HEAD.half + 0.6]];
    const groundAt = (x, z) => {
      const dx = x - s.x, dz = z - s.z, lx = dx * cr - dz * sr, lz = dx * sr + dz * cr, ax = Math.abs(lx);
      if (P.top(lx, lz)) {
        const g = BG.floorAt(lx, lz - Z_GATE);
        return s.y + (g > -Infinity ? GATE_Y + g : P.levelAt(lx, lz));
      }
      if (lz >= B.zEnd && lz <= B.zHead) return ax <= BRIDGE.half ? s.y : -Infinity;
      if (lz > B.zHead && lz <= h.zIn && ax <= (lz <= h.zWing ? HEAD.half : HEAD.tongue)) return s.y;
      return -Infinity;
    };
    return {
      node, islet, bridge, gatehouse, roots: [node], solids: [islet, gatehouse, bridge], claims,
      lanes, sparkles, heat: new Float32Array(lanes.length), walk: { x: s.x, y: s.y, z: s.z, sr, cr, from: B.zEnd - 0.3, to: h.zIn, lift: 0 },
      falls, drips, lamps, decor, portal,
      heimdall: { x: wx(HEIMDALL.x, HEIMDALL.z), y: s.y + LAND, z: wz(HEIMDALL.x, HEIMDALL.z), heading: s.ry + HEIMDALL.turn },
      arrival: { x: wx(ARRIVAL.x, ARRIVAL.z), y: s.y, z: wz(ARRIVAL.x, ARRIVAL.z), yaw: s.ry },
      view,
      cloud: { x: s.x, z: s.z, r: P.reach + 0.5, head: { x: wx(0, h.zIn), z: wz(0, h.zIn) }, end: { x: wx(0, B.zEnd), z: wz(0, B.zEnd) }, y: s.y, width: 2 * HEAD.half + 0.3 },
      groundAt
    };
  };

  // Per frame: a gentle crest of light runs along the deck from the head out to the islet over a faint shimmer. While
  // the played Ooga's feet (px, py, pz) are over the bridge and near the deck, the tiles round them warm quickly and
  // cool slowly, leaving a fading trail, and the whole deck lifts a little, easing in and out; px is NaN when nobody is
  // played. The sparkles twinkle, brighter where the deck is warm; bands of brightness flow down the falls, and the
  // drips fall from their ends and fade. The lamps are the hub's to ramp.
  const update = (site, dt, elapsed, px, py, pz) => {
    const lanes = site.lanes, heat = site.heat, sparkles = site.sparkles, falls = site.falls, drips = site.drips, w = site.walk;
    let on = false, lx = 0, lz = 0;
    if (!Number.isNaN(px)) {
      const dx = px - w.x, dz = pz - w.z;
      lx = dx * w.cr - dz * w.sr;
      lz = dx * w.sr + dz * w.cr;
      on = Math.abs(py - w.y) <= WALK.feet && Math.abs(lx) <= HEAD.half && lz >= w.from && lz <= w.to;
    }
    w.lift += ((on ? 1 : 0) - w.lift) * Math.min(1, dt * WALK.ease);
    const rise = Math.min(1, dt * WALK.rise), fall = Math.min(1, dt * WALK.fall), reach = WALK.radius * WALK.radius, lift = w.lift;
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i], ex = lane.x - lx, ez = lane.z - lz, q = on ? 1 - (ex * ex + ez * ez) / reach : 0, target = q > 0 ? q * q : 0;
      const warm = heat[i] + (target - heat[i]) * (target > heat[i] ? rise : fall);
      heat[i] = warm;
      const c = 0.5 + 0.5 * Math.cos(TAU * (lane.phase - elapsed * LANE.rate)), crest = c * c * c * c;
      lane.node.highlight = LANE.highlight * crest + WALK.highlight * warm;
      lane.node.glow = LANE.glow + LANE.shimmer * Math.sin(elapsed * 2.1 + lane.seed) + LANE.crest * crest + WALK.glow * warm + WALK.lift * lift;
    }
    for (let i = 0; i < sparkles.length; i++) {
      const p = sparkles[i], t = 0.5 + 0.5 * Math.sin(elapsed * p.rate + p.phase), twinkle = t * t * t * t, warm = heat[p.tile];
      p.node.glow = 0.35 + 0.65 * twinkle + 0.7 * warm + WALK.lift * lift;
      p.node.highlight = 0.4 * twinkle + 0.6 * warm;
    }
    for (let i = 0; i < falls.length; i++) {
      const f = falls[i], u = 0.5 + 0.5 * Math.sin(TAU * (f.phase - elapsed * FALL.rate));
      f.node.glow = 0.72 + 0.55 * u * u * u;
    }
    for (let i = 0; i < drips.length; i++) {
      const d = drips[i], t = (elapsed * d.speed + d.seed) % 1;
      d.node.position.y = d.top - t * t * 2.6;
      d.node.glow = 1 - t * 0.75;
    }
  };

  BL.bifrostIsle = { AXIS, HEAD, ROCK, COURT, TERRACE, BRIDGE, Z_GATE, GATE_Y, spot, site, update };
})();
