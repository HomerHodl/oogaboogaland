// ₿IFRÖST's gate as the owner's concept draws it, and the kit its islet is dressed from. The gate is a free-standing
// wall of chunky stone blocks: stepped towers either side climbing to a stepped gable, and in the middle a round arch
// framed by a navy band of blocky glowing runes between gold trims, a ring of voussoirs and a thick gold band. The
// glowing ₿ medallion sits on the arch, a spire of blue crystal crowns the gable and two golden horns curve out from its
// shoulders. Navy banners with the concept's bind rune hang on the towers, candles burn on every ledge and braziers
// flank the portal at the head of five steps. The back is a wall of three banners between candle pillars, under a
// second medallion.
//
// Everything is built once a page in the gate's frame: x across, y up from the portal's floor, +z out toward the
// bridge, the origin on the portal frame's outer face. The portal keeps the chamber's way in exactly (`ENTRY`), since
// the window behind it (`bifrost-window.js`) draws the chamber's tunnel into that opening. The field stands at
// `GATE.fieldZ`. Behind it a passage wider and taller than the window's clip runs back to a dark wall, closed in stone
// all round, with its floor at the portal's; nothing of the gate enters the window's true-size front.
//
// `build()` returns the geometries: the solid `stone` over a closed shell of boxes, the `trims` (gold, horns, rods,
// candle wax), the `banners`, the dusk-lit `glow` (flames and fires), the always-lit `light` (the medallions, runes,
// crystal, the field's rim and sparkles) and the `field`, a glowing glass sheet. The kit serves the isle as well:
// `runeBanner`, `lantern`, `brazier` and `runeWord`, each cached, at the origin and facing +z.
//
// `landmark()` builds, once a page, the arch the hub stands over the island's north pass in the old gate's place, so
// Bifröst begins under ₿IFRÖST's name: two towers of stone blocks with a lower pier beside each carrying a banner, a
// plum band across the lintel over a gold ring, carrying the name in chiselled gold between two blue runes over the
// keystone's diamond, a low stepped parapet rising to a crown of blue crystals, lanterns on the towers, on the piers and
// on pedestals at the towers' feet, and vines over it all; in the gate's parts, with the records the hub places it by.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models } = BL, { hexToRgb } = BL.math;
  const { cached, variants, geometry, box, bevelBox, lathe, tube, merge, moved, turnedX, turnedY, turnedZ, noShadow, makeVox, voxelGeometry } = models;
  const BM = BL.bifrostModels, FM = BL.factoryModels;
  const { facing, archAt, archEdge, archOutline, inArch, disc, fieldSparkles, ENTRY } = BM;
  const TAU = Math.PI * 2;

  // The owner's colours: deep navy cloth, gold and warm orange trims, electric blue glow, warm flames, grey-brown stone
  // with earthy patches, pale paving.
  const NAVY = "#1c2a62", GOLD = "#f4a52c", GOLD_LT = "#ffd25e", GOLD_DK = "#c7741c", AMBER = "#ef8a1d", BACKING = "#4a2f18";
  const BLUE = "#2b74ff", BLUE_MID = "#62b4ff", BLUE_LT = "#bde6ff", ICE = "#5ec8ff", DEEP = "#0e1d4c";
  const STONE = ["#7e756f", "#716963", "#897f77", "#675f5a"], STONE_LT = "#a0968d", STONE_DK = "#524b47", DIRT = "#7a5b45", PLINTH = "#58514c";
  const RUNE_STONE = ["#3e383a", "#474042"], RUNE_BAND = ["#172569", "#1b2c7a"], RUNE_GLOW = "#7fd6ff";
  const PAVE = ["#a1978d", "#958b82"], STEP = ["#a39a91", "#978e86", "#aca299"], LINING = "#2a272c";
  const WAX = "#eee0c2", IRON = "#2b2724", WOOD = "#5b3b22", EMBER = "#ff5a16", GLASS = "#ffb948", RUNE_WHITE = "#f2f0ff";
  const FLAME = ["#ff7a1e", "#ffa53a", "#ffd36a", "#fff3c4"], SHELL = "#000000";

  // The stone's lattice: half-metre blocks with the facade's face at Z0, so the portal's floor, the passage's walls and
  // roof and its back wall all fall on block faces; the court meets the footing's lowest course partway up.
  const U = 0.5, Z0 = -0.25;
  // The five steps down to the court: their half-width, where the landing ends and the first riser drops, each tread's
  // depth and each riser's height.
  const STAIRS = { halfWidth: 2.5, from: 1.25, tread: 0.4, riser: 0.25, steps: 5 };
  // The passage behind the field: the half-width a walker keeps clear, the back wall's face, and the stone's hollow
  // round it, wider and taller than the window's clip (the opening's half-width plus its 0.75 margin, and 4.8 up).
  const PASSAGE = { half: 1.95, back: -2.25, hollow: 3, roof: 5 };
  // Everything the isle and the hub place the gate by: the portal's floor above the court (`rise`), the stairs' depth
  // from the frame's face to their foot (`run`), the facade's half-width, the back wall's face and the facade's own
  // (`face`), the field and the opening (the chamber's way in), the room the phase reads, the spire's top, the stairs
  // and the passage, the medallion's height and radius, the spire's depth and heights, the braziers on the landing
  // [x, z], and the footprint the gate stands on, as a box and an outline [x, z].
  const GATE = {
    rise: STAIRS.riser * STAIRS.steps, run: STAIRS.from + STAIRS.tread * (STAIRS.steps - 1), halfWidth: 7, back: -4.25, face: Z0,
    fieldZ: -0.6, halfW: ENTRY.halfW, spring: ENTRY.spring, room: { w: 4, h: 4.8, from: 0.3, to: 1.9 }, top: 14.8,
    stairs: STAIRS, passage: PASSAGE, medallion: { y: 6.5, r: 1.5 }, spire: { z: -1.5, base: 10, crystal: 10.8, cap: 13.25 },
    braziers: [[-3.35, 0.72], [3.35, 0.72]],
    footprint: {
      minX: -7, maxX: 7, minZ: -5.05, maxZ: 2.85,
      outline: [[-7, 1.25], [-2.5, 1.25], [-2.5, 2.85], [2.5, 2.85], [2.5, 1.25], [7, 1.25], [7, -3.25], [6, -3.25], [6, -4.25], [2.7, -4.25], [2.7, -5.05], [-2.7, -5.05], [-2.7, -4.25], [-6, -4.25], [-6, -3.25], [-7, -3.25]]
    }
  };
  // The front elevation: the stone's top over each band of |x|, [out to, top], stepping down from the gable to the
  // towers' outer columns; and the back face of each band, the outer columns a metre shallower.
  const TOPS = [[1, 10], [2, 9.5], [3, 8.5], [4, 8], [5, 7], [6, 6], [7, 5]];
  const topAt = (ax) => TOPS.find(([x]) => ax < x)[1];
  const backAt = (ax) => ax < 6 ? GATE.back : -3.25;
  // The portal's frame out from the opening: the gold trim round the opening's edge, the rune band, its outer gold edge,
  // the ring of voussoirs and the thick gold band, each [inner radius, outer radius, its face's z]; all run back to the
  // field. Each overlaps the next by a few centimetres, since their pieces are cut on chords, and no two faces share a
  // plane. `cut` is how far round the arch the facade's front blocks give way to the frame, every block it takes lying
  // wholly inside the gold band.
  const FRAME = { trim: [2, 2.12, 0.02], rune: [2.06, 2.78, -0.1], edge: [2.73, 2.97, 0.03], ring: [2.93, 3.75, 0], band: [3.71, 4, 0.1], cut: 3.6 };
  // The runes round the arch: ₿IFRÖST climbing each side from the spring toward the medallion, every rune stood upright
  // along the band with its head toward the keystone, the first `from` radians above the spring and each next `pitch`
  // on; their pixels `px` across the band and `py` along it, so each rune stands about square, `proud` of the band.
  const BAND = { word: "ᛒᛁᚠᚱᛟᛊᛏ", from: 0.15, pitch: 0.19, px: 0.068, py: 0.056, proud: 0.05 };
  // Where the horns stand across the gable's depth, and the curve of the right one, [x, y] from its root to its tip.
  const HORN = { z: -1.5, curve: [[2.95, 8.2], [4.25, 9.2], [4.4, 11.8], [3.05, 13.05]] };

  // ---- small builders ------------------------------------------------------------------------------

  // A convex outline [[x, y], ...] extruded from z0 to z1, closed and wound to look out of itself.
  const prismZ = (geo, pts, z0, z1, color, emissive = 0) => {
    const n = pts.length, cx = pts.reduce((s, p) => s + p[0], 0) / n, cy = pts.reduce((s, p) => s + p[1], 0) / n, zm = (z0 + z1) / 2;
    facing(geo, pts.map(([x, y]) => [x, y, z1]), color, emissive, cx, cy, z1 + 1);
    facing(geo, pts.map(([x, y]) => [x, y, z0]), color, emissive, cx, cy, z0 - 1);
    for (let k = 0; k < n; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[(k + 1) % n];
      facing(geo, [[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1]], color, emissive, ax + bx - cx, ay + by - cy, zm);
    }
    return geo;
  };
  // An arched band from r0 to r1 about the spring, from z0 back to its face at z1: `n` voussoirs over the top and `legs`
  // courses down each side to the floor (none for a band that stops at the spring). `tone(k)` colours piece k, and
  // `lift(k)` stands it proud of the face, so the ring reads as separate blocks.
  const archBand = (geo, r0, r1, z0, z1, n, legs, tone, emissive = 0, lift = () => 0) => {
    const S = ENTRY.spring;
    for (let k = 0; k < n; k++) {
      const a0 = Math.PI * k / n, a1 = Math.PI * (k + 1) / n, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      prismZ(geo, [[c0 * r0, S + s0 * r0], [c0 * r1, S + s0 * r1], [c1 * r1, S + s1 * r1], [c1 * r0, S + s1 * r0]], z0, z1 + lift(k), tone(k), emissive);
    }
    for (let row = 0; row < legs; row++) for (const s of [-1, 1]) {
      const y0 = S * row / legs, y1 = S * (row + 1) / legs, k = n + row * 2 + (s > 0 ? 1 : 0);
      prismZ(geo, [[s * r0, y0], [s * r1, y0], [s * r1, y1], [s * r0, y1]], z0, z1 + lift(k), tone(k), emissive);
    }
    return geo;
  };
  // A square bar from a to b ([x, y, z]), `w` thick, run on half its thickness past both ends so strokes meeting at an
  // angle close their joint.
  const stroke = (a, b, w, color, emissive) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], e = w * 0.45 / (Math.hypot(dx, dy, dz) || 1);
    return FM.beam(a[0] - dx * e, a[1] - dy * e, a[2] - dz * e, b[0] + dx * e, b[1] + dy * e, b[2] + dz * e, w, color, emissive);
  };
  // A flat bar painted on a face at z from (x0, y0) to (x1, y1), `w` wide and run on at its ends, looking along `dir`.
  const bar = (geo, x0, y0, x1, y1, w, z, color, emissive, dir) => {
    const l = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / l * w / 2, uy = (y1 - y0) / l * w / 2;
    return facing(geo, [[x0 - ux + uy, y0 - uy - ux, z], [x1 + ux + uy, y1 + uy - ux, z], [x1 + ux - uy, y1 + uy + ux, z], [x0 - ux - uy, y0 - uy + ux, z]], color, emissive, x0, y0, z + dir);
  };
  // A convex outline [[x, y], ...] moved in by `d` all round.
  const inset = (pts, d) => {
    const n = pts.length, cx = pts.reduce((s, p) => s + p[0], 0) / n, cy = pts.reduce((s, p) => s + p[1], 0) / n;
    const lines = pts.map((a, k) => {
      const b = pts[(k + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
      if (nx * (cx - a[0]) + ny * (cy - a[1]) < 0) { nx = -nx; ny = -ny; }
      return [a[0] + nx * d, a[1] + ny * d, (b[0] - a[0]) / l, (b[1] - a[1]) / l];
    });
    return lines.map((q, k) => {
      const p = lines[(k - 1 + n) % n], s = ((q[0] - p[0]) * q[3] - (q[1] - p[1]) * q[2]) / (p[2] * q[3] - p[3] * q[2]);
      return [p[0] + p[2] * s, p[1] + p[3] * s];
    });
  };
  // An axis-aligned closed box between two corners, for the collision shell.
  const block = (x0, x1, y0, y1, z0, z1) => box({ w: x1 - x0, h: y1 - y0, d: z1 - z0, color: SHELL, offset: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 } });
  // A tube along an arch's edge `r` out, from the foot of its left leg over the top to the foot of its right, at z.
  const archTube = (r, z, radius, color, emissive) => {
    const total = archEdge(r, ENTRY.spring);
    return tube({ path: (t) => archAt(r, ENTRY.spring, z, t * total), radius: () => radius, rings: 36, segments: 4, colorFn: () => color, emissive });
  };

  // ---- runes ----------------------------------------------------------------------------------------

  // The Elder Futhark as strokes [x0, y0, x1, y1] in a cell one high and six tenths wide about its middle, and the
  // word divider; `LATIN` reads a letter as the rune that stands for its sound.
  const RUNES = {
    "ᚠ": [[-0.25, 0, -0.25, 1], [-0.25, 0.55, 0.3, 0.85], [-0.25, 0.3, 0.3, 0.6]],
    "ᚢ": [[-0.25, 0, -0.25, 1], [-0.25, 1, 0.25, 0.7], [0.25, 0.7, 0.25, 0]],
    "ᚦ": [[-0.2, 0, -0.2, 1], [-0.2, 0.75, 0.25, 0.5], [0.25, 0.5, -0.2, 0.25]],
    "ᚨ": [[-0.2, 0, -0.2, 1], [-0.2, 1, 0.25, 0.75], [-0.2, 0.7, 0.25, 0.45]],
    "ᚱ": [[-0.3, 0, -0.3, 1], [-0.3, 1, 0.25, 0.75], [0.25, 0.75, -0.3, 0.5], [-0.3, 0.5, 0.3, 0]],
    "ᚲ": [[0.25, 1, -0.25, 0.5], [-0.25, 0.5, 0.25, 0]],
    "ᚷ": [[-0.3, 0, 0.3, 1], [-0.3, 1, 0.3, 0]],
    "ᚹ": [[-0.2, 0, -0.2, 1], [-0.2, 1, 0.25, 0.78], [0.25, 0.78, -0.2, 0.55]],
    "ᚺ": [[-0.25, 0, -0.25, 1], [0.25, 0, 0.25, 1], [-0.25, 0.65, 0.25, 0.35]],
    "ᚾ": [[0, 0, 0, 1], [-0.3, 0.65, 0.3, 0.35]],
    "ᛁ": [[0, 0, 0, 1]],
    "ᛃ": [[0, 0.95, -0.28, 0.7], [-0.28, 0.7, 0, 0.45], [0, 0.55, 0.28, 0.3], [0.28, 0.3, 0, 0.05]],
    "ᛈ": [[-0.25, 0, -0.25, 1], [-0.25, 1, 0.25, 0.72], [-0.25, 0, 0.25, 0.28]],
    "ᛉ": [[0, 0, 0, 1], [0, 0.55, -0.3, 0.95], [0, 0.55, 0.3, 0.95]],
    "ᛊ": [[-0.25, 1, 0.2, 0.62], [0.2, 0.62, -0.2, 0.38], [-0.2, 0.38, 0.25, 0]],
    "ᛏ": [[0, 0, 0, 1], [0, 1, -0.3, 0.7], [0, 1, 0.3, 0.7]],
    "ᛒ": [[-0.3, 0, -0.3, 1], [-0.3, 1, 0.25, 0.75], [0.25, 0.75, -0.3, 0.5], [-0.3, 0.5, 0.25, 0.25], [0.25, 0.25, -0.3, 0]],
    "ᛖ": [[-0.25, 0, -0.25, 1], [0.25, 0, 0.25, 1], [-0.25, 1, 0, 0.7], [0, 0.7, 0.25, 1]],
    "ᛗ": [[-0.25, 0, -0.25, 1], [0.25, 0, 0.25, 1], [-0.25, 1, 0.25, 0.55], [0.25, 1, -0.25, 0.55]],
    "ᛚ": [[-0.2, 0, -0.2, 1], [-0.2, 1, 0.25, 0.7]],
    "ᛜ": [[0, 0.2, 0.28, 0.5], [0.28, 0.5, 0, 0.8], [0, 0.8, -0.28, 0.5], [-0.28, 0.5, 0, 0.2]],
    "ᛞ": [[-0.3, 0, -0.3, 1], [0.3, 0, 0.3, 1], [-0.3, 1, 0.3, 0], [-0.3, 0, 0.3, 1]],
    "ᛟ": [[0, 1, 0.3, 0.65], [0.3, 0.65, -0.25, 0], [0, 1, -0.3, 0.65], [-0.3, 0.65, 0.25, 0]],
    "᛫": [[-0.07, 0.5, 0.07, 0.5]]
  };
  const LATIN = {
    A: "ᚨ", B: "ᛒ", C: "ᚲ", D: "ᛞ", E: "ᛖ", F: "ᚠ", G: "ᚷ", H: "ᚺ", I: "ᛁ", J: "ᛃ", K: "ᚲ", L: "ᛚ", M: "ᛗ", N: "ᚾ", O: "ᛟ", "Ö": "ᛟ",
    P: "ᛈ", Q: "ᚲ", R: "ᚱ", S: "ᛊ", T: "ᛏ", U: "ᚢ", V: "ᚹ", W: "ᚹ", Y: "ᛃ", Z: "ᛉ", "Þ": "ᚦ", "₿": "ᛒ", "·": "᛫", ".": "᛫", ":": "᛫"
  };
  const runeOf = (ch) => {
    const strokes = RUNES[ch] || RUNES[LATIN[ch.toUpperCase()]];
    if (!strokes) throw new Error(`No rune for "${ch}"`);
    return strokes;
  };
  // The strokes of `text` pushed onto `out` as square bars `w` thick: each rune placed by `at(u, v, i)`, its cell's
  // point (u across, v up) for the rune at index i, a space leaving its place empty.
  const runeStrokes = (text, at, w, out, color = ICE, emissive = 1) => {
    [...text].forEach((ch, i) => {
      if (ch === " ") return;
      for (const [x0, y0, x1, y1] of runeOf(ch)) out.push(stroke(at(x0, y0, i), at(x1, y1, i), w, color, emissive));
    });
    return out;
  };
  // A line of runes `height` tall, centred on the origin and standing a tenth of their height proud of z 0, facing +z.
  // Cached by text, height and colour; merge before moving.
  const words = new Map();
  const runeWord = (text, height, color = ICE, emissive = 1) => {
    const key = `${text}|${height}|${color}|${emissive}`;
    if (!words.has(key)) {
      const n = [...text].length, w = height * 0.11;
      words.set(key, noShadow(merge(...runeStrokes(text, (u, v, i) => [(u + (i - (n - 1) / 2) * 0.8) * height, (v - 0.5) * height, w / 2], w, [], color, emissive))));
    }
    return words.get(key);
  };
  // The arch's runes as the concept draws them, blocky: five pixels across and seven high, row by row from the top,
  // "#" lit, their slants stepped a pixel at a time.
  const PIXEL_RUNES = {
    "ᛒ": ["###..", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "###.."],
    "ᛁ": ["..#..", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "ᚠ": ["#..#.", "#.#.#", "##.#.", "#.#..", "##...", "#....", "#...."],
    "ᚱ": ["###..", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "ᛟ": ["..#..", ".#.#.", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
    "ᛊ": [".#...", "..#..", "...#.", "..#..", ".#...", "..#..", "...#."],
    "ᛏ": ["..#..", ".###.", "#.#.#", "..#..", "..#..", "..#..", "..#.."]
  };
  // A rune of `PIXEL_RUNES` upright about the origin with pixels `px` wide and `py` high, each run of lit pixels along a
  // row one glowing block, standing from z 0 to `proud`.
  const pixelRune = (ch, px, py, proud) => {
    const rows = PIXEL_RUNES[ch], parts = [];
    if (!rows) throw new Error(`No pixel rune for "${ch}"`);
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length;) {
        if (row[c] !== "#") { c++; continue; }
        let n = 1;
        while (row[c + n] === "#") n++;
        parts.push(box({ w: n * px, h: py, d: proud, color: RUNE_GLOW, emissive: 1, offset: { x: (c + n / 2 - row.length / 2) * px, y: ((rows.length - 1) / 2 - r) * py, z: proud / 2 } }));
        c += n;
      }
    });
    return merge(...parts);
  };

  // ---- the kit ----------------------------------------------------------------------------------------

  // A banner as the concept hangs them, `scale` times one 1.1 m wide and 2.6 m from its rod at the origin to its point:
  // navy cloth edged in gold and cut to a point with a gold drop at its tip (`cloth`), its white mark on both faces, each
  // reading true from its own side (`mark`, apart so Canvas 2D can sort it before the cloth), and the gilt rod with its
  // knobs (`rod`). Cached by mark and scale. The mark stands `lift` off the cloth: a few millimetres fight the cloth in
  // the depth buffer from afar under the close camera's 0.06 m near plane, and flicker as the view turns.
  const BANNER = { w: 1.1, h: 2.6, tail: 0.42, top: -0.06, hem: 0.085, t: 0.02, lift: 0.015 };
  // The marks the concept's banners carry, drawn in thick square-ended strokes. Each stroke is [x0, y0, x1, y1] in stave
  // lengths, up from the stave's foot (y 0) to its head (y 1), and each mark gives, on a banner of scale 1, how far
  // below the rod the stave's head hangs (`head`), the stave's length (`len`), the strokes' width (`w`) and how far the
  // stave stands off the banner's middle, in stave lengths (`dx`).
  // - `gate`, the towers' bind rune: the stave's head forked into three prongs, the outer two turning in to cross it and
  //   open into a diamond round its middle, crossing it again below and turning down into two short feet, with the stave
  //   running on beneath them.
  // - `back`, the back wall's middle banner: the stave crossed a little above its middle by an X whose four ends turn
  //   straight up and down, ᛉ over ᛦ.
  // - `post`, the posts' ᛕᛁ: a branch up and out to the right from above the stave's middle, its tip turned straight up,
  //   one down and out from the same point, and a short ᛁ standing at the foot under the lower branch's end.
  const MARKS = {
    gate: {
      head: -0.5, len: 1.45, w: 0.08, dx: 0, strokes: [
        [0, 0, 0, 1], [-0.15, 1, -0.15, 0.885], [0.15, 1, 0.15, 0.885], [-0.15, 0.885, 0, 0.765], [0.15, 0.885, 0, 0.765],
        [0, 0.765, -0.17, 0.56], [0, 0.765, 0.17, 0.56], [-0.17, 0.56, 0, 0.355], [0.17, 0.56, 0, 0.355],
        [0, 0.355, -0.15, 0.22], [0, 0.355, 0.15, 0.22], [-0.15, 0.22, -0.15, 0.16], [0.15, 0.22, 0.15, 0.16]
      ]
    },
    back: {
      head: -0.62, len: 1.25, w: 0.083, dx: 0, strokes: [
        [0, 0, 0, 1], [-0.168, 0.925, -0.168, 0.747], [0.168, 0.925, 0.168, 0.747], [-0.168, 0.747, 0, 0.555], [0.168, 0.747, 0, 0.555],
        [0, 0.555, -0.168, 0.363], [0, 0.555, 0.168, 0.363], [-0.168, 0.363, -0.168, 0.24], [0.168, 0.363, 0.168, 0.24]
      ]
    },
    post: {
      head: -0.55, len: 1.2, w: 0.1, dx: -0.17, strokes: [
        [0, 0, 0, 1], [0, 0.64, 0.29, 0.86], [0.29, 0.86, 0.29, 1], [0, 0.64, 0.34, 0.34], [0.26, 0, 0.26, 0.22]
      ]
    }
  };
  const bannerCache = new Map();
  // Painted runes keep their own batch so the depth offset never pulls the cloth forward too.
  const bannerMarks = (parts) => {
    const geo = noShadow(merge(...parts));
    geo.depthOffset = true;
    return geo;
  };
  const runeBanner = (scale = 1, mark = "gate") => {
    const key = `${mark}|${scale}`;
    if (bannerCache.has(key)) return bannerCache.get(key);
    const M = MARKS[mark];
    if (!M) throw new Error(`No banner mark "${mark}"`);
    const { w, h, tail, top, hem, t, lift } = BANNER, cloth = geometry(), rune = geometry();
    const outer = [[-w / 2, top], [w / 2, top], [w / 2, top - h + tail], [0, top - h], [-w / 2, top - h + tail]], inner = inset(outer, hem);
    const at = (u, v, side) => [side * (M.dx + u) * M.len, M.head + (v - 1) * M.len];
    for (const side of [1, -1]) {
      const flat = (pts, color, emissive) => facing(cloth, pts.map(([x, y]) => [x, y, side * t]), color, emissive, 0, top - h / 2, side * 5);
      flat(inner, NAVY, 0.05);
      outer.forEach((p, k) => { const k2 = (k + 1) % outer.length; flat([p, outer[k2], inner[k2], inner[k]], GOLD, 0.25); });
      for (const [u0, v0, u1, v1] of M.strokes) bar(rune, ...at(u0, v0, side), ...at(u1, v1, side), M.w, side * (t + lift), RUNE_WHITE, 0.35, side);
    }
    const drop = moved(lathe({ profile: [[0, 0.02], [0.08, -0.08], [0, -0.22]], segments: 4, color: GOLD_LT, emissive: 0.3 }), 0, top - h, 0);
    const knob = () => lathe({ profile: [[0, -0.09], [0.075, -0.04], [0.075, 0.04], [0, 0.09]], segments: 6, color: GOLD, emissive: 0.25 });
    const rod = merge(box({ w: w + 0.24, h: 0.07, d: 0.07, color: GOLD_DK, emissive: 0.15 }), moved(knob(), -(w / 2 + 0.16), 0, 0), moved(knob(), w / 2 + 0.16, 0, 0));
    const grow = (geo) => { const v = geo.verts; for (let i = 0; i < v.length; i++) v[i] *= scale; return geo; };
    const out = { cloth: grow(merge(cloth, drop)), mark: grow(rune), rod: grow(rod) };
    bannerCache.set(key, out);
    return out;
  };

  // A square lantern 0.6 m tall with its foot at the origin: a timber foot and head, iron posts at its corners and a
  // band round its middle, an iron cap with a ring to hang it by (`body`), and its warm glass (`glass`).
  const lantern = cached(() => ({
    body: merge(
      box({ w: 0.3, h: 0.05, d: 0.3, color: WOOD, offset: { y: 0.025 } }),
      ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => box({ w: 0.045, h: 0.34, d: 0.045, color: IRON, offset: { x: sx * 0.12, y: 0.22, z: sz * 0.12 } })),
      box({ w: 0.225, h: 0.035, d: 0.225, color: IRON, offset: { y: 0.22 } }),
      box({ w: 0.32, h: 0.05, d: 0.32, color: WOOD, offset: { y: 0.415 } }),
      moved(turnedY(lathe({ profile: [[0.2, 0], [0.09, 0.09], [0, 0.11]], segments: 4, color: IRON }), Math.PI / 4), 0, 0.44, 0),
      box({ w: 0.05, h: 0.06, d: 0.05, color: IRON, offset: { y: 0.575 } })
    ),
    glass: noShadow(box({ w: 0.2, h: 0.33, d: 0.2, color: GLASS, emissive: 1, offset: { y: 0.215 } }))
  }));

  // A stone brazier a metre high with its foot at the origin: a dark footing, the block, a pale cap and a kerb of dark
  // stone round the bowl (`stone`); and its fire, a bed of embers under flames of stacked blocks (`fire`).
  const FIRE = [[0.5, 0.24, 1.02, 0, 0, 0], [0.4, 0.24, 1.2, 0.03, -0.03, 1], [0.3, 0.22, 1.38, 0.06, 0.04, 2], [0.22, 0.2, 1.54, 0.02, 0.06, 2], [0.14, 0.16, 1.68, -0.02, 0.03, 3], [0.22, 0.24, 1.18, -0.19, 0.08, 1], [0.18, 0.2, 1.22, 0.2, -0.12, 0], [0.12, 0.14, 1.4, -0.14, -0.1, 2]];
  const brazier = cached(() => ({
    stone: merge(
      bevelBox({ w: 1, h: 0.14, d: 1, color: STONE_DK, bevel: 0.04, offset: { y: 0.07 } }),
      bevelBox({ w: 0.84, h: 0.62, d: 0.84, color: STONE[2], bevel: 0.05, offset: { y: 0.45 } }),
      bevelBox({ w: 0.98, h: 0.12, d: 0.98, color: STONE_LT, bevel: 0.04, offset: { y: 0.82 } }),
      ...[-1, 1].flatMap((s) => [
        box({ w: 0.98, h: 0.14, d: 0.13, color: STONE_DK, offset: { y: 0.95, z: s * 0.425 } }),
        box({ w: 0.13, h: 0.14, d: 0.72, color: STONE_DK, offset: { x: s * 0.425, y: 0.95 } })
      ])
    ),
    fire: noShadow(merge(
      box({ w: 0.72, h: 0.06, d: 0.72, color: EMBER, emissive: 0.85, offset: { y: 0.91 } }),
      ...FIRE.map(([w, h, y, x, z, k]) => box({ w, h, d: w, color: FLAME[k], emissive: 1, offset: { x, y, z } }))
    ))
  }));

  // A candle of wax with its flame, four heights from 0.14 m: the wax for the trims, the flame for the dusk ramp.
  const candle = variants((i) => {
    const h = 0.14 + 0.05 * i;
    return {
      wax: box({ w: 0.1, h, d: 0.1, color: WAX, offset: { y: h / 2 } }),
      flame: noShadow(merge(box({ w: 0.07, h: 0.09, d: 0.07, color: FLAME[1], emissive: 1, offset: { y: h + 0.055 } }), box({ w: 0.04, h: 0.07, d: 0.04, color: FLAME[3], emissive: 1, offset: { y: h + 0.12 } })))
    };
  });

  // ---- the gate ---------------------------------------------------------------------------------------

  // The stone in half-metre blocks: the towers and the gable to the front elevation's steps over a footing that reaches
  // the court (its lowest course sunk into it when the rise is not a whole number of blocks), the landing before them at
  // the portal's floor, and the passage hollowed behind the field. Round the arch the front blocks give way to the frame.
  // Each block takes a shade of stone, now and then an earthy or darker one; each column's top block is pale coping, the
  // landing is paved, the hollow is lined dark and its back wall glows faintly in the field's blue, which is all Canvas
  // 2D shows through the field. Faces at or under the court are left out.
  const hash = (a, b, c) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
  const BLOCKS = [...STONE, DIRT, STONE_DK, STONE_LT, PLINTH, PAVE[0], PAVE[1], LINING, DEEP];
  const mass = () => {
    const v = makeVox(), n = Math.round(GATE.halfWidth / U), end = Math.round((STAIRS.from - Z0) / U), wall = Math.round((PASSAGE.back - Z0) / U) - 1;
    const foot = -Math.ceil(GATE.rise / U - 1e-9);
    for (let i = -n; i < n; i++) {
      const x = (i + 0.5) * U, ax = Math.abs(x), top = Math.round(topAt(ax) / U);
      for (let k = Math.round((backAt(ax) - Z0) / U); k < end; k++) {
        const z = Z0 + (k + 0.5) * U, behind = k < 0 && z > PASSAGE.back;
        for (let j = foot; j < (k < 0 ? top : 0); j++) {
          const y = (j + 0.5) * U, h = hash(i, j, k) % 100, hollow = ax < PASSAGE.hollow && y < PASSAGE.roof;
          if (j >= 0 && (behind && hollow || k === -1 && inArch(x, y, FRAME.cut, ENTRY.spring))) continue;
          let c;
          if (j < 0) c = j === -1 && k >= 0 ? 8 + (h & 1) : 7;
          else if (k === wall && hollow) c = 11;
          else if (behind && k < -1 && ax < PASSAGE.hollow + U && y < PASSAGE.roof + U) c = 10;
          else if (j === top - 1) c = h < 85 ? 6 : 2;
          else c = h < 7 ? 4 : h < 14 ? 5 : h & 3;
          v.set(i, j, k, c);
        }
      }
    }
    const geo = voxelGeometry(v, { unit: U, palette: BLOCKS, origin: { x: 0, y: 0, z: Z0 }, emissive: { 11: 0.55 } }), V = geo.verts;
    geo.faces = geo.faces.filter((f) => !f.i.every((idx) => V[idx * 3 + 1] < 1e-6 - GATE.rise));
    // Flat shaded blocks, each its own shade, as the concept's are: no masonry drawn over them.
    delete geo.voxel;
    return geo;
  };

  // The five steps from the court to the landing, each course laid in big pale blocks breaking joint with the next.
  const stairs = () => {
    const parts = [], { halfWidth: W, from, tread, riser, steps } = STAIRS;
    for (let k = 1; k < steps; k++) {
      const z0 = from + tread * (k - 1), z1 = from + tread * k, top = -riser * k, cuts = k % 2 ? [-W, -0.9, 0.9, W] : [-W, -1.6, 0, 1.6, W];
      for (let c = 0; c + 1 < cuts.length; c++) {
        parts.push(bevelBox({ w: cuts[c + 1] - cuts[c] - 0.02, h: top + GATE.rise, d: z1 - z0, color: STEP[(k + c) % STEP.length], bevel: 0.04, offset: { x: (cuts[c] + cuts[c + 1]) / 2, y: (top - GATE.rise) / 2, z: (z0 + z1) / 2 } }));
      }
    }
    return merge(...parts);
  };

  // A medallion in its own frame, its wall at z 0 and facing +z: a bronze backing let into the wall (`backing`), and
  // what glows (`glow`), a ring of gold blocks round an orange coin with a raised ₿.
  const medallion = cached(() => {
    const { r } = GATE.medallion, rim = 0.28, n = 24, ring = geometry(), coin = geometry();
    for (let k = 0; k < n; k++) {
      const a0 = k / n * TAU, a1 = (k + 1) / n * TAU, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      prismZ(ring, [[c0 * (r - rim), s0 * (r - rim)], [c0 * r, s0 * r], [c1 * r, s1 * r], [c1 * (r - rim), s1 * (r - rim)]], 0.12, 0.44 + (k & 1) * 0.04, k & 1 ? GOLD : GOLD_LT, 0.55);
    }
    facing(coin, Array.from({ length: n }, (_, k) => [Math.cos(k / n * TAU) * (r - rim + 0.02), Math.sin(k / n * TAU) * (r - rim + 0.02), 0.36]), AMBER, 0.9, 0, 0, 5);
    return { backing: disc(r + 0.12, 0.62, BACKING), glow: merge(ring, coin, moved(FM.smoothBitcoin(1.6, 0.12, "#ffe27a", 1), 0, 0, 0.42)) };
  });

  // A golden horn along HORN's curve, on the left for s -1: gold blocks stepped along it, shrinking from its root to its
  // pale tip, with darker bands round it.
  const horn = (s) => {
    const P = HORN.curve, M = 96, pts = [], lens = [0];
    for (let m = 0; m <= M; m++) {
      const t = m / M, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      pts.push([a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1]]);
      if (m) lens.push(lens[m - 1] + Math.hypot(pts[m][0] - pts[m - 1][0], pts[m][1] - pts[m - 1][1]));
    }
    const L = lens[M], parts = [];
    for (let d = 0, m = 0; d <= L;) {
      while (m < M && lens[m + 1] < d) m++;
      const f = d / L, w = 0.84 - 0.56 * f, k = m < M ? (d - lens[m]) / (lens[m + 1] - lens[m]) : 0;
      const x = pts[m][0] + (pts[Math.min(M, m + 1)][0] - pts[m][0]) * k, y = pts[m][1] + (pts[Math.min(M, m + 1)][1] - pts[m][1]) * k;
      const band = f > 0.2 && f < 0.26 || f > 0.45 && f < 0.51 || f > 0.66 && f < 0.71;
      parts.push(box({ w, h: w, d: w, color: f > 0.86 ? GOLD_LT : band ? GOLD_DK : GOLD, emissive: 0.2, offset: { x: s * x, y, z: HORN.z } }));
      d += w * 0.5;
    }
    return merge(...parts);
  };

  // A crystal of the spire, a square prism `r` across its faces and `h` tall with its foot at the origin, cut to a point
  // `tip` long (or left square), `body` below and `pale` toward its top.
  const shard = (r, h, tip, body = ICE, pale = BLUE_LT) => turnedY(lathe({ profile: [[r * 0.75, 0], [r, 0.12], [r, h - tip], [tip ? 0 : r * 0.9, h]], segments: 4, color: (t) => t > 0.6 ? pale : body, emissive: 1 }), Math.PI / 4);

  // The field: a glass sheet of the field's blue filling the opening a hair before the field's plane, paler in a band
  // round its edge, glowing and see-through, so the chamber the window draws shows through it.
  const field = () => {
    const geo = geometry(), z = GATE.fieldZ + 0.03, { halfW: H, spring: S } = ENTRY, I = H - 0.32, n = 14;
    facing(geo, archOutline(I, S, z, n), BLUE, 1, 0, S, z + 1);
    for (const s of [-1, 1]) facing(geo, [[s * I, 0, z], [s * H, 0, z], [s * H, S, z], [s * I, S, z]], BLUE_MID, 1, 0, S, z + 1);
    for (let k = 0; k < n; k++) {
      const a0 = Math.PI * k / n, a1 = Math.PI * (k + 1) / n;
      facing(geo, [[Math.cos(a0) * I, S + Math.sin(a0) * I, z], [Math.cos(a0) * H, S + Math.sin(a0) * H, z], [Math.cos(a1) * H, S + Math.sin(a1) * H, z], [Math.cos(a1) * I, S + Math.sin(a1) * I, z]], BLUE_MID, 1, 0, S, z + 1);
    }
    geo.glass = 0.4;
    return noShadow(geo);
  };
  // The collision shell, all closed boxes: the footing and landing, the steps, each band of the towers and gable to its
  // top (standing out to the frame's face across the arch), the crown over the passage and the passage's back wall, the
  // spire, the medallions, the braziers and the back pillars. The passage stays open from the landing through the
  // field to its back wall, `PASSAGE.half` either side and four metres high.
  const shell = () => {
    const { back, rise } = GATE, P = PASSAGE, M = GATE.medallion, Sp = GATE.spire, reach = M.r + 0.12;
    const parts = [
      block(-6, 6, -rise, 0, back, STAIRS.from), block(-P.half, P.half, 4, 9.5, back, 0.12), block(-1, 1, 9.5, 10, back, Z0), block(-P.half, P.half, 0, 4, back, P.back),
      block(-1, 1, Sp.base, Sp.crystal, Sp.z - 0.85, Sp.z + 0.85), block(-0.35, 0.35, Sp.crystal, GATE.top, Sp.z - 0.35, Sp.z + 0.35),
      block(-reach, reach, M.y - reach, M.y + reach, 0.12, 0.6), block(-reach, reach, M.y - reach, M.y + reach, back - 0.45, back)
    ];
    for (let k = 1; k < STAIRS.steps; k++) parts.push(block(-STAIRS.halfWidth, STAIRS.halfWidth, -rise, -STAIRS.riser * k, STAIRS.from, STAIRS.from + STAIRS.tread * k));
    for (const s of [-1, 1]) {
      const span = (a, b) => s < 0 ? [-b, -a] : [a, b];
      parts.push(block(...span(6, 7), -rise, 0, backAt(6.5), STAIRS.from));
      let x0 = 0;
      for (const [x1, top] of TOPS) {
        if (x1 > P.half) parts.push(block(...span(Math.max(x0, P.half), x1), 0, top, backAt((x0 + x1) / 2), x1 <= FRAME.band[1] ? 0.12 : Z0));
        x0 = x1;
      }
      parts.push(block(...span(1.7, 2.7), -rise, 4.4, back - 0.8, back));
    }
    for (const [x, z] of GATE.braziers) parts.push(block(x - 0.5, x + 0.5, 0, 1.02, z - 0.5, z + 0.5));
    return merge(...parts);
  };

  // Everything of the gate, built once a page in its frame.
  const build = cached(() => {
    const { back } = GATE, S = ENTRY.spring, F = GATE.fieldZ, M = GATE.medallion, Sp = GATE.spire;
    const stone = [mass(), stairs()], trims = [], cloth = [], marks = [], glow = [];
    const frame = geometry(), gilt = geometry(), lit = [];

    // The portal's frame: the gold trim round the opening, the rune band, navy and faintly aglow over the arch and dark
    // stone down its jambs, with a gold sill across it at each spring, its outer gold edge, the ring of voussoirs
    // standing out a block at a time and the thick gold band over the arch, closed by gold imposts; the band again on
    // the back wall round its medallion. A gold threshold at the field's foot.
    archBand(gilt, FRAME.trim[0], FRAME.trim[1], F, FRAME.trim[2], 18, 1, (k) => k & 1 ? GOLD_LT : GOLD, 0.3);
    archBand(frame, FRAME.rune[0], FRAME.rune[1], F, FRAME.rune[2], 11, 0, (k) => RUNE_BAND[k & 1], 0.3);
    archBand(frame, FRAME.rune[0], FRAME.rune[1], F, FRAME.rune[2], 0, 3, (k) => RUNE_STONE[(k >> 1) & 1]);
    archBand(gilt, FRAME.edge[0], FRAME.edge[1], F, FRAME.edge[2], 18, 1, (k) => k & 1 ? GOLD : GOLD_LT, 0.3);
    archBand(frame, FRAME.ring[0], FRAME.ring[1], F, FRAME.ring[2], 15, 3, (k) => [STONE[0], STONE[2], STONE[1], STONE_LT][k & 3], 0, (k) => (k & 1) * 0.06);
    archBand(gilt, FRAME.band[0], FRAME.band[1], F, FRAME.band[2], 18, 0, (k) => k & 1 ? GOLD : AMBER, 0.3);
    archBand(gilt, FRAME.band[0], FRAME.band[1], back - 0.12, back + 0.05, 18, 0, (k) => k & 1 ? GOLD : AMBER, 0.3);
    for (const s of [-1, 1]) {
      const x = s * (FRAME.band[0] + FRAME.band[1]) / 2, sill = (FRAME.trim[0] + FRAME.edge[1]) / 2;
      trims.push(bevelBox({ w: 0.46, h: 0.28, d: 0.75, color: GOLD_DK, bevel: 0.04, offset: { x, y: S - 0.14, z: -0.225 } }), bevelBox({ w: 0.46, h: 0.28, d: 0.3, color: GOLD_DK, bevel: 0.04, offset: { x, y: S - 0.14, z: back - 0.1 } }));
      trims.push(bevelBox({ w: FRAME.edge[1] - FRAME.trim[0], h: 0.12, d: 0.6, color: GOLD_DK, bevel: 0.03, offset: { x: s * sill, y: S, z: FRAME.edge[2] + 0.02 - 0.3 } }));
    }
    stone.push(frame);
    trims.push(gilt, box({ w: 2 * ENTRY.halfW, h: 0.03, d: 0.1, color: GOLD, emissive: 0.3, offset: { y: 0.015, z: F + 0.08 } }));

    // The runes round the band, blocky and glowing: ₿IFRÖST up each side from the spring toward the medallion, on the
    // middle of the navy between the trims, each rune turned so its head leans toward the keystone.
    {
      const rc = (FRAME.trim[1] + FRAME.edge[0]) / 2, face = FRAME.rune[2];
      for (const s of [-1, 1]) {
        [...BAND.word].forEach((ch, i) => {
          const a = BAND.from + i * BAND.pitch;
          lit.push(moved(turnedZ(pixelRune(ch, BAND.px, BAND.py, BAND.proud), s * a), s * rc * Math.cos(a), S + rc * Math.sin(a), face));
        });
      }
    }
    // The field's bright rim and its sparkles just before the sheet.
    lit.push(archTube(ENTRY.halfW - 0.05, F + 0.05, 0.05, BLUE_LT, 1), fieldSparkles(F + 0.05));

    // The medallions, on the arch and high on the back wall.
    const medal = medallion(), front = (geo) => moved(merge(geo), 0, M.y, 0.05), rear = (geo) => moved(turnedY(merge(geo), Math.PI), 0, M.y, back - 0.05);
    trims.push(front(medal.backing), rear(medal.backing));
    lit.push(front(medal.glow), rear(medal.glow));

    // The spire: a stepped plinth on the gable, a tall crystal with two leaning out beside it and two small ones before
    // them, and the stone finial the tall one carries, with a gold collar under its cap.
    stone.push(
      bevelBox({ w: 2, h: 0.45, d: 1.7, color: STONE_LT, bevel: 0.06, offset: { y: Sp.base + 0.225, z: Sp.z } }),
      bevelBox({ w: 1.3, h: Sp.crystal - Sp.base - 0.45, d: 1.2, color: STONE[2], bevel: 0.05, offset: { y: (Sp.base + 0.45 + Sp.crystal) / 2, z: Sp.z } }),
      bevelBox({ w: 0.66, h: 1.05, d: 0.66, color: STONE_DK, bevel: 0.06, offset: { y: Sp.cap + 0.525, z: Sp.z } }),
      moved(turnedY(lathe({ profile: [[0.47, 0], [0, GATE.top - Sp.cap - 1.05]], segments: 4, color: STONE_DK }), Math.PI / 4), 0, Sp.cap + 1.05, Sp.z)
    );
    trims.push(bevelBox({ w: 0.76, h: 0.1, d: 0.76, color: GOLD, bevel: 0.025, emissive: 0.3, offset: { y: Sp.cap + 1.05, z: Sp.z } }));
    lit.push(moved(shard(0.36, Sp.cap - Sp.crystal + 0.05, 0), 0, Sp.crystal, Sp.z));
    for (const s of [-1, 1]) {
      lit.push(moved(turnedZ(shard(0.27, 2, 0.6), -s * 0.24), s * 0.48, Sp.crystal - 0.05, Sp.z + 0.05));
      lit.push(moved(turnedX(turnedZ(shard(0.17, 1.1, 0.45), -s * 0.4), 0.3), s * 0.32, Sp.crystal - 0.05, Sp.z + 0.4));
    }

    // The horns, from the gable's shoulders.
    trims.push(horn(-1), horn(1));

    // The banners: one on each tower's face and back with the bind rune, and the big one with its own mark on the back
    // wall between the candle pillars, each on its rod held off the wall by iron stubs.
    const hang = (scale, mark, x, y, wall, rear) => {
      const b = runeBanner(scale, mark), z = rear ? wall - 0.13 : wall + 0.13, place = (geo) => moved(rear ? turnedY(merge(geo), Math.PI) : merge(geo), x, y, z);
      cloth.push(place(b.cloth));
      marks.push(place(b.mark));
      trims.push(place(b.rod));
      for (const sx of [-1, 1]) trims.push(FM.beam(x + sx * (BANNER.w / 2 + 0.05) * scale, y, wall, x + sx * (BANNER.w / 2 + 0.05) * scale, y, z, 0.06, IRON));
    };
    for (const s of [-1, 1]) {
      hang(1.45, "gate", s * 5.35, 4.85, Z0, false);
      hang(1.3, "gate", s * 4.95, 5.6, back, true);
    }
    hang(1.8, "back", 0, 4.8, back, true);

    // The braziers either side of the portal on the landing.
    for (const [x, z] of GATE.braziers) {
      stone.push(moved(merge(brazier().stone), x, 0, z));
      glow.push(moved(merge(brazier().fire), x, 0, z));
    }

    // The back's candle pillars: a footing on the court, a tall block from it with a slit of blue light down its back,
    // and a pale cap.
    for (const s of [-1, 1]) {
      const x = s * 2.2, z = back - 0.35, foot = 0.45 - GATE.rise;
      stone.push(
        bevelBox({ w: 1, h: 0.45, d: 0.9, color: STONE_DK, bevel: 0.06, offset: { x, y: foot - 0.225, z } }),
        bevelBox({ w: 0.8, h: 4.2 - foot, d: 0.7, color: STONE[2], bevel: 0.07, offset: { x, y: (4.2 + foot) / 2, z } }),
        bevelBox({ w: 1, h: 0.2, d: 0.9, color: STONE_LT, bevel: 0.05, offset: { x, y: 4.3, z } })
      );
      lit.push(box({ w: 0.14, h: 3, d: 0.04, color: ICE, emissive: 1, offset: { x, y: 1.7, z: back - 0.715 } }));
    }

    // Blue cubes set into the towers' sides and backs.
    for (const s of [-1, 1]) {
      for (const [y, z] of [[2.25, -1.3], [0.75, -2.6]]) lit.push(box({ w: 0.34, h: 0.34, d: 0.34, color: ICE, emissive: 1, offset: { x: s * GATE.halfWidth, y, z } }));
      lit.push(box({ w: 0.34, h: 0.34, d: 0.34, color: ICE, emissive: 1, offset: { x: s * 5.6, y: 0.9, z: back } }));
    }

    // Candles: on the front edge of each tower step, along the landing's edge before the towers, on the back edge of the
    // towers' steps, and three on each pillar's cap.
    let count = 0;
    const lightCandle = (x, y, z) => {
      const c = candle(hash(count++, 5, 9) % 4);
      trims.push(moved(merge(c.wax), x, y, z));
      glow.push(moved(merge(c.flame), x, y, z));
    };
    for (const s of [-1, 1]) {
      for (const [x, y] of [[6.3, 5], [6.72, 5], [5.28, 6], [5.7, 6], [4.3, 7], [4.72, 7], [3.25, 8]]) lightCandle(s * x, y, Z0 - 0.22);
      for (const x of [4.2, 4.75, 5.4, 6.05, 6.65]) lightCandle(s * x, 0, STAIRS.from - 0.22);
      for (const [x, y] of [[6.5, 5], [5.5, 6], [4.5, 7]]) lightCandle(s * x, y, backAt(x) + 0.22);
      for (const dx of [-0.25, 0, 0.25]) lightCandle(s * 2.2 + dx, 4.4, back - 0.35 + (dx ? 0.12 : -0.12));
    }

    const geo = merge(...stone);
    geo.collisionGeometry = shell();
    return {
      stone: geo, trims: merge(...trims), banners: merge(...cloth), bannerMarks: bannerMarks(marks), glow: noShadow(merge(...glow)), light: noShadow(merge(...lit)), field: field()
    };
  });

  // ---- the landmark -----------------------------------------------------------------------------------

  // ₿IFRÖST's arch over the island's north pass, where Bifröst begins, in its own frame: x across, y up from the pass's
  // floor, +z out toward the meadow, the path running along z through the origin. The opening is `half` either side,
  // its jambs straight up to `spring` and the lintel's underside a shallow segmental curve rising to `crown` over the
  // middle, framed by a gold ring `ring` deep. Either side a tower stands from the jamb out to `tower`, `deep` before and
  // behind the arch's plane, up to `towerTop` under a capital `cap` tall over a plinth `plinth` tall; beyond it a lower
  // pier stands out to `pier`, from `deep` behind the plane to `front` before it, up to `pierTop` under a capital of its
  // own, and from `buried` up, where the ridge walls beside the pass hide the rest. Each capital stands `lip` out, and
  // both are laid in blocks `block` on a side. The band across the lintel spans the opening, its face `proud` of the
  // towers' and its back `set` inside them, laid in courses `course` tall under a row of gold blocks `trim` tall whose
  // tops rise in a shallow curve from `ends` at `band` either side to `top` over the middle; a gold upright closes each
  // end from the jamb out to `band`.
  const ARCH = {
    half: 2, spring: 4, crown: 4.7, ring: 0.28, tower: 2.5, deep: 0.75, towerTop: 5.75, cap: 0.25, plinth: 0.45, pier: 3.5, front: 1, pierTop: 4.25,
    buried: 1, lip: 0.08, block: 0.25, band: 2.2, proud: 0.2, set: 0.25, course: 0.3, trim: 0.22, top: 6, ends: 5.55
  };
  // On the band: the name, its cap height and baseline; either side of it a rune on a faintly glowing disc `glow` across,
  // the middle of each, its stave's length and its stroke, drawn four tenths as wide again as the banners'; and the
  // keystone's gold plate, its width, how far under the crown it hangs and its top, with its diamond's half-height.
  const NAMEPLATE = { cap: 0.5, base: 5.12, runeX: 1.65, runeY: 5.05, glow: 0.56, stave: 0.396, stroke: 0.0306, key: 0.46, hang: 0.15, keyTop: 5, diamond: 0.12 };
  // The parapet over the band, set back behind its face: a course `half` either side and `deep` either side of the line,
  // from `from` inside the lintel up to `course`, and on it the merlons [out from, out to, top] mirrored about the
  // middle, stepping up to the dark pair either side of the crystals.
  const PARAPET = { from: 5.7, course: 6.25, half: 1.4, deep: 0.42, merlons: [[0.3, 0.6, 6.72], [0.66, 0.96, 6.5], [1.02, 1.34, 6.36]] };
  // The crystals rising from the course between the dark pair, upright columns in the arch's own two blues, deep and
  // bright, with paler tips, the tallest in the middle: [x, z, corner radius, height, tip, which blue].
  const CRYSTALS = [[0, 0, 0.15, 1.05, 0.1, 0], [-0.16, 0.05, 0.12, 0.85, 0.08, 1], [0.16, -0.04, 0.12, 0.9, 0.08, 1], [-0.08, -0.16, 0.11, 0.7, 0.07, 0], [0.09, 0.15, 0.1, 0.6, 0.07, 0], [-0.19, -0.12, 0.09, 0.5, 0.06, 1]];
  const CRYSTAL_BLUES = ["#1c4ee8", "#3a86ff"];
  // The lanterns on the +x side, mirrored: [x, y, z, scale] for the one on a pedestal on the tower's capital, the one on
  // the pier's capital and the one on a pedestal at the tower's foot, each with the stones it stands on as
  // [x0, x1, y0, y1, z0, z1, colour]. The foot's pedestal is laid in courses of two stones under a lipped cap, running
  // down under the stair treads before the arch and into the ridge beside them.
  const LANTERNS = [
    { at: [2.25, 6.15, 0, 1.05], stones: [[2.05, 2.45, 6, 6.15, -0.2, 0.2, STONE_LT]] },
    { at: [3.05, 4.58, 0.32, 1.25], stones: [[2.83, 3.27, 4.5, 4.58, 0.1, 0.54, STONE_DK]] },
    { at: [2.28, 1.2, 1.05, 1.1], stones: [
      [2, 2.8, -1, -0.75, 0.75, 1.35, STONE[3]], [2, 2.8, -0.75, -0.3, 0.75, 1.35, STONE[2]], [2, 2.8, -0.3, 0.15, 0.75, 1.35, STONE[3]],
      [2, 2.8, 0.15, 0.6, 0.75, 1.35, STONE[2]], [2, 2.8, 0.6, 1.05, 0.75, 1.35, STONE[3]], [2, 2.88, 1.05, 1.2, 0.67, 1.43, STONE_LT]
    ] }
  ];
  // The banners on the piers' faces: across, the rod's height and the scale, the tail clear of the ridge before them.
  const ARCH_BANNER = { x: 3, y: 4.1, scale: 0.7 };
  // The vines on the +x tower, mirrored: [x, y, z, length, the wall's outward axis] hanging from under its capital down
  // its face beside the band's end, clear of the ridge beside it (2.5 m up on the west), and down its side over the
  // pier; the leafy clumps on the band's top corner and on the capitals, [x, y, z]; and moss on the capitals,
  // [x, y, z, w, d].
  const ARCH_VINES = [[2.31, 5.74, 0.77, 3.1, "z"], [2.44, 5.74, 0.77, 2.6, "z"], [2.52, 5.74, 0.32, 1.1, "x"]];
  const ARCH_CLUMPS = [[2.12, 5.6, 0.98], [2.36, 5.98, 0.76], [2.62, 4.5, 1.02]];
  const ARCH_MOSS = [[2.2, 6, 0.5, 0.3, 0.3], [2.35, 6, -0.5, 0.35, 0.3], [3.35, 4.5, 0.8, 0.35, 0.4], [2.75, 4.5, -0.6, 0.3, 0.35]];
  // The isle's vine greens, the band's two plum stones and the faint blue of the runes' squares.
  const VINE = ["#8aa52c", "#6f8f24", "#a9c83c", "#c2d94e"], MOSS = ["#3f6d26", "#51852f", "#6a9e38", "#8dc04a"], BAND_FACE = ["#5c2d57", "#4f284b"], RUNE_SQUARE = "#171d48";
  // The name's gilt as the concept's: the chiselled glyphs' faces a warmer gold, their pale chamfers deep gold and their
  // dark walls orange, each [the glyphs' colour, the arch's], all glowing `glow` times as bright as in the chamber.
  const NAME_GILT = { recolour: [["#ffc83a", "#ffb730"], ["#ffe7a0", "#ffc040"], ["#b87a10", "#d0661a"]], glow: 1.6 };
  // Where the hub casts the lanterns' warm light from, before the band over the top of the steps; and the lanterns'
  // glass, warmer than the islet's.
  const ARCH_LIGHT = [0, 3.2, 2.6], ARCH_GLASS = "#ff7a28";

  // A copy of a built part scaled by `k` about its origin and moved to (x, y, z).
  const scaledAt = (geo, k, x, y, z) => {
    const out = merge(geo), v = out.verts;
    for (let i = 0; i < v.length; i++) v[i] *= k;
    return moved(out, x, y, z);
  };
  // A leafy clump about (x, y, z): broad leaves in the vines' and the moss's greens heaped round it.
  const clump = (parts, x, y, z, seed) => {
    for (let k = 0; k < 5; k++) {
      const h = hash(seed, k, 11), w = 0.2 + (h % 4) * 0.04;
      parts.push(box({ w, h: 0.14 + (h >> 4) % 3 * 0.03, d: w * 0.8, color: (k & 1 ? VINE : MOSS)[1 + (h >> 7) % 3], offset: { x: x + ((h >> 9) % 5 - 2) * 0.06, y: y + (k % 3 - 1) * 0.07, z: z + ((h >> 12) % 5 - 2) * 0.05 } }));
    }
  };
  // A vine hanging `len` down a wall from (x, y, z), its wall looking out along `axis` ("x" or "z") on the side of that
  // coordinate's sign: a stem stepping a little as it falls, a leaf either side of every length of it and a broad one
  // before every other length, and a clump where it hangs from.
  const hangVine = (parts, x, y, z, len, axis, seed) => {
    const nx = axis === "x" ? Math.sign(x) : 0, nz = axis === "z" ? Math.sign(z) : 0, seg = 0.42;
    const leaf = (cx, cy, cz, color, k = 1) => box({ w: nz ? 0.26 * k : 0.06, h: 0.17 * k, d: nx ? 0.26 * k : 0.06, color, offset: { x: cx + nx * 0.08, y: cy, z: cz + nz * 0.08 } });
    let px = x, pz = z;
    for (let i = 0, top = y; top > y - len + 1e-6; i++, top -= seg) {
      const h = Math.min(seg, top - (y - len)), sway = (hash(seed, i, 3) % 3 - 1) * 0.03;
      parts.push(box({ w: 0.09, h: h + 0.02, d: 0.09, color: VINE[i % 3 ? 0 : 1], offset: { x: px + nx * 0.05, y: top - h / 2, z: pz + nz * 0.05 } }));
      for (const side of [-1, 1]) parts.push(leaf(px + side * nz * 0.13, top - h * (side > 0 ? 0.3 : 0.7), pz + side * nx * 0.13, VINE[2 + (hash(seed, i, side + 5) & 1)]));
      if (i % 2 === 0) parts.push(leaf(px + nx * 0.04, top - h * 0.5, pz + nz * 0.04, MOSS[2 + (hash(seed, i, 9) & 1)], 1.5));
      px += nz * sway;
      pz += nx * sway;
    }
    clump(parts, x + nx * 0.06, y - 0.05, z + nz * 0.06, seed);
  };

  // The towers and the piers in blocks, each a shade of stone and now and then an earthy or darker one, flat shaded as
  // the gate's are.
  const archPillars = () => {
    const A = ARCH, B = A.block, v = makeVox(), n0 = Math.round(A.half / B), n1 = Math.round(A.tower / B), n2 = Math.round(A.pier / B);
    for (let i = n0; i < n2; i++) for (const s of [-1, 1]) {
      const pier = i >= n1, rows = Math.round((pier ? A.pierTop : A.towerTop) / B), deep = Math.round(((pier ? A.front : A.deep) + A.deep) / B);
      for (let j = pier ? Math.round(A.buried / B) : 0; j < rows; j++) for (let k = 0; k < deep; k++) {
        const x = s > 0 ? i : -1 - i, h = hash(x, j, k + 40) % 100;
        v.set(x, j, k, h < 7 ? 4 : h < 14 ? 5 : h & 3);
      }
    }
    const geo = voxelGeometry(v, { unit: B, palette: BLOCKS, origin: { x: 0, y: 0, z: -A.deep } });
    delete geo.voxel;
    return geo;
  };

  // The arch at the head of Bifröst, built once a page: the solid `stone` over a closed shell (the towers and piers with
  // their capitals and plinths, the lintel and the band over the opening in columns cut on the curve, the band's ends,
  // the keystone, the parapet, the crystals and the lanterns' stones), the `trims` (gold, the runes' squares, lantern
  // bodies, the banners' rods, vines and moss), the `banners`' cloth and painted `bannerMarks`, the dusk-lit `glow` (the lanterns' glass)
  // and the always-lit `light` (the name, the runes, the diamond and the crystals); and what the hub places it by, in
  // its frame: the opening's half-width, the jambs' top (`spring`) and the curve's (`crown`), the top of its crystals,
  // the height of its middle, the glass its dusk sparks fly from (`spark`), the point its warm light pools from
  // (`pool`), the radius it stands within, and `pick`, how far along a ray (origin, direction) the ray first meets the
  // box round a piece of its shell, or Infinity.
  const landmark = cached(() => {
    const A = ARCH, N = NAMEPLATE, P = PARAPET, face = A.deep + A.proud, back = A.deep - A.set, front = face + 0.1;
    const stone = [archPillars()], trims = [], cloth = [], marks = [], glow = [], lit = [], shellParts = [], bounds = [];
    const span = (s, a, b) => s > 0 ? [a, b] : [-b, -a];
    // A piece of the shell, closed and convex, with the box round it kept for picking.
    const solid = (geo) => {
      const V = geo.verts, b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i < V.length; i += 3) for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], V[i + a]); b[a + 3] = Math.max(b[a + 3], V[i + a]); }
      shellParts.push(geo);
      bounds.push(...b);
    };
    // The curve under the lintel, a circle's arc through both jambs' tops and the crown: its radius and middle, where it
    // meets the jambs, the point `r` out from its middle at angle `a`, and the height `r` out from its middle over x.
    const rise = A.crown - A.spring, R = (A.half * A.half + rise * rise) / (2 * rise), cy = A.crown - R, a0 = Math.acos(A.half / R), Rr = R + A.ring;
    const at = (r, a) => [Math.cos(a) * r, cy + Math.sin(a) * r];
    const over = (r, x) => cy + Math.sqrt(r * r - x * x);
    // The top of the band's gold over x, curving down from its middle to its ends.
    const topAt = (x) => A.top - (A.top - A.ends) * (x / A.band) ** 2;

    // Over the opening, column by column: the lintel's stone from the curve up to the gold, the band's face before it
    // from behind the ring up, in courses of two stones, and a gold block along its top. Each column's piece of the
    // shell is cut on the same chord of the curve, so the stone is solid where it is drawn and the opening clear under it.
    const cols = 10, cw = 2 * A.half / cols, lintel = geometry(), band = geometry(), gilt = geometry();
    for (let c = 0; c < cols; c++) {
      const x0 = -A.half + c * cw, x1 = x0 + cw, top = topAt(x0 + cw / 2), under = top - A.trim, sole = [[x0, over(R, x0)], [x1, over(R, x1)], [x1, top], [x0, top]];
      prismZ(lintel, sole, -A.deep, back, STONE[c % 4], 0);
      let la = over(Rr, x0) - 0.03, lb = over(Rr, x1) - 0.03, row = 0;
      for (let y = A.spring + A.course; la < under - 1e-6; y += A.course) {
        if (y < Math.max(la, lb) + 0.05) continue;
        const hi = y > under - 0.05 ? under : y;
        prismZ(band, [[x0, la], [x1, lb], [x1, hi], [x0, hi]], back, face, BAND_FACE[hash(c, row++, 17) & 1], 0.08);
        la = lb = hi;
      }
      trims.push(bevelBox({ w: cw - 0.02, h: A.trim, d: face + 0.12 - back, color: GOLD, emissive: 0.3, bevel: 0.04, offset: { x: x0 + cw / 2, y: top - A.trim / 2, z: (back - 0.05 + face + 0.07) / 2 } }));
      solid(prismZ(geometry(), sole, -A.deep, front, SHELL));
    }
    stone.push(lintel, band);
    // The gold ring round the curve: voussoirs of one gold standing out of a darker bed, which shows at their joints.
    for (let k = 0, n = 10, j = 0.015 / R; k < n; k++) {
      const t0 = a0 + (Math.PI - 2 * a0) * k / n, t1 = a0 + (Math.PI - 2 * a0) * (k + 1) / n;
      prismZ(gilt, [at(R + 0.01, t0), at(Rr - 0.01, t0), at(Rr - 0.01, t1), at(R + 0.01, t1)], back, face + 0.02, GOLD_DK, 0.25);
      prismZ(gilt, [at(R, t0 + j), at(Rr, t0 + j), at(Rr, t1 - j), at(R, t1 - j)], back, face + 0.07, GOLD, 0.3);
    }
    trims.push(gilt);
    // Each end of the band, a gold upright from the jamb out to the band's end, up from just under the spring to its
    // last step.
    for (const s of [-1, 1]) {
      const [x0, x1] = span(s, A.half, A.band), y0 = A.spring - A.trim / 2;
      trims.push(bevelBox({ w: x1 - x0, h: A.ends - y0, d: face + 0.12 - back, color: GOLD, emissive: 0.3, bevel: 0.04, offset: { x: (x0 + x1) / 2, y: (y0 + A.ends) / 2, z: (back - 0.05 + face + 0.07) / 2 } }));
      solid(block(x0, x1, y0, A.ends, back - 0.05, front));
    }

    // The keystone's gold plate over the ring, hanging under the crown, with a tab beneath it and its blue diamond.
    {
      const y0 = A.crown - N.hang, y = (y0 + N.keyTop) / 2, z = face + 0.12, r = N.diamond;
      trims.push(
        bevelBox({ w: N.key, h: N.keyTop - y0, d: 0.17, color: GOLD, emissive: 0.3, bevel: 0.04, offset: { y, z: face + 0.035 } }),
        bevelBox({ w: 0.14, h: 0.12, d: 0.12, color: GOLD_DK, emissive: 0.25, bevel: 0.03, offset: { y: y0 - 0.05, z: face + 0.03 } })
      );
      lit.push(prismZ(geometry(), [[0, y - r], [r * 0.72, y], [0, y + r], [-r * 0.72, y]], z, z + 0.04, BLUE, 1), prismZ(geometry(), [[0, y - r * 0.45], [r * 0.32, y], [0, y + r * 0.45], [-r * 0.32, y]], z + 0.04, z + 0.06, BLUE_LT, 1));
      solid(block(-N.key / 2, N.key / 2, y0, N.keyTop, face - 0.05, z));
      solid(block(-0.07, 0.07, y0 - 0.11, y0, face - 0.03, face + 0.09));
    }
    // Either side of the name the banners' bind rune in blue on a disc of faint blue.
    for (const s of [-1, 1]) {
      const x = s * N.runeX, y = N.runeY, z = face + 0.02, w = N.stroke;
      trims.push(moved(disc(N.glow / 2, 0.02, RUNE_SQUARE, 0.06), x, y, face + 0.01));
      for (const [u0, v0, u1, v1] of MARKS.gate.strokes) {
        const p = (u, v) => [x + u * N.stave * 1.4, y + (v - 0.5) * N.stave, z + w / 2];
        lit.push(stroke(p(u0, v0), p(u1, v1), w, BLUE, 1));
      }
    }

    // The towers' plinths and capitals and the piers' capitals, and each pillar's shell.
    for (const s of [-1, 1]) {
      const [t0, t1] = span(s, A.half, A.tower), [c0, c1] = span(s, A.half - A.lip, A.tower + A.lip), [p0, p1] = span(s, A.tower, A.pier), [q0, q1] = span(s, A.tower, A.pier + A.lip);
      stone.push(
        bevelBox({ w: t1 - t0, h: A.plinth, d: 2 * (A.deep + 0.1), color: STONE_DK, bevel: 0.05, offset: { x: (t0 + t1) / 2, y: A.plinth / 2 } }),
        bevelBox({ w: c1 - c0, h: A.cap, d: 2 * (A.deep + A.lip), color: STONE_LT, bevel: 0.05, offset: { x: (c0 + c1) / 2, y: A.towerTop + A.cap / 2 } }),
        bevelBox({ w: q1 - q0, h: A.cap, d: A.front + A.deep + 2 * A.lip, color: STONE_LT, bevel: 0.05, offset: { x: (q0 + q1) / 2, y: A.pierTop + A.cap / 2, z: (A.front - A.deep) / 2 } })
      );
      solid(block(t0, t1, 0, A.towerTop, -A.deep, A.deep));
      solid(block(t0, t1, 0, A.plinth, -A.deep - 0.1, A.deep + 0.1));
      solid(block(c0, c1, A.towerTop, A.towerTop + A.cap, -A.deep - A.lip, A.deep + A.lip));
      solid(block(p0, p1, 0, A.pierTop, -A.deep, A.front));
      solid(block(q0, q1, A.pierTop, A.pierTop + A.cap, -A.deep - A.lip, A.front + A.lip));
    }

    // The parapet: its course over the band's middle and the merlons on it, stepping up to the dark pair.
    stone.push(bevelBox({ w: 2 * P.half, h: P.course - P.from, d: 2 * P.deep, color: STONE[2], bevel: 0.05, offset: { y: (P.from + P.course) / 2 } }));
    solid(block(-P.half, P.half, P.from, P.course, -P.deep, P.deep));
    P.merlons.forEach(([x0, x1, top], i) => {
      for (const s of [-1, 1]) {
        const [m0, m1] = span(s, x0, x1);
        stone.push(bevelBox({ w: m1 - m0, h: top - P.course, d: 2 * P.deep - 0.1, color: i ? STONE[(i + (s > 0 ? 1 : 0)) % 4] : STONE_DK, bevel: 0.05, offset: { x: (m0 + m1) / 2, y: (P.course + top) / 2 } }));
        solid(block(m0, m1, P.course, top, -P.deep, P.deep));
      }
    });
    // The crystals, standing a little into the course.
    const crest = P.course - 0.04, extent = [Infinity, -Infinity, Infinity, -Infinity];
    let peak = 0;
    for (const [x, z, r, h, tip, tone] of CRYSTALS) {
      lit.push(moved(shard(r, h, tip, CRYSTAL_BLUES[tone], BLUE_MID), x, crest, z));
      peak = Math.max(peak, crest + h);
      extent[0] = Math.min(extent[0], x - r); extent[1] = Math.max(extent[1], x + r); extent[2] = Math.min(extent[2], z - r); extent[3] = Math.max(extent[3], z + r);
    }
    solid(block(extent[0], extent[1], crest, peak, extent[2], extent[3]));

    // The banners on the piers' faces, each on its rod held off the stone by iron stubs, with the painted marks separate.
    const flag = runeBanner(ARCH_BANNER.scale, "gate"), hangZ = A.front + 0.13;
    for (const s of [-1, 1]) {
      const x = s * ARCH_BANNER.x, y = ARCH_BANNER.y;
      cloth.push(moved(merge(flag.cloth), x, y, hangZ));
      marks.push(moved(merge(flag.mark), x, y, hangZ));
      trims.push(moved(merge(flag.rod), x, y, hangZ));
      for (const e of [-1, 1]) trims.push(FM.beam(x + e * (BANNER.w / 2 + 0.05) * ARCH_BANNER.scale, y, A.front, x + e * (BANNER.w / 2 + 0.05) * ARCH_BANNER.scale, y, hangZ, 0.06, IRON));
    }

    // The lanterns on their stones, their glass warmer than the islet's, the stones in the shell up to the lantern's top
    // as one box; the sparks fly from the first, on the +x tower.
    const lamp = lantern(), warm = hexToRgb(ARCH_GLASS);
    let spark = null;
    for (const s of [1, -1]) for (const { at: [lx, ly, lz, k], stones } of LANTERNS) {
      const x = s * lx, hull = [Infinity, -Infinity, Infinity, ly + 0.6 * k, Infinity, -Infinity];
      for (const [a0, a1, y0, y1, z0, z1, color] of stones) {
        const [x0, x1] = span(s, a0, a1);
        stone.push(bevelBox({ w: x1 - x0, h: y1 - y0, d: z1 - z0, color, bevel: 0.05, offset: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 } }));
        hull[0] = Math.min(hull[0], x0); hull[1] = Math.max(hull[1], x1); hull[2] = Math.min(hull[2], y0); hull[4] = Math.min(hull[4], z0); hull[5] = Math.max(hull[5], z1);
      }
      const glass = scaledAt(lamp.glass, k, x, ly, lz);
      for (const f of glass.faces) f.color = warm;
      trims.push(scaledAt(lamp.body, k, x, ly, lz));
      glow.push(glass);
      spark = spark || [x, ly + 0.215 * k, lz];
      solid(block(...hull));
    }

    // Vines down the towers beside the band's ends and over the piers, clumps on the corners and moss on the capitals.
    for (const s of [-1, 1]) {
      ARCH_VINES.forEach(([x, y, z, len, axis], i) => hangVine(trims, s * x, y, z, len, axis, i * 2 + (s > 0 ? 1 : 0)));
      ARCH_CLUMPS.forEach(([x, y, z], i) => clump(trims, s * x, y, z, 20 + i * 2 + (s > 0 ? 1 : 0)));
      ARCH_MOSS.forEach(([x, y, z, w, d], i) => trims.push(box({ w, h: 0.1, d, color: MOSS[i % 3], offset: { x: s * x, y: y + 0.05, z } })));
    }

    // Keep each chiselled letter rigid at its original cap height along a baseline concentric with the opening.
    // Centre each visible glyph in an equal-width slot along the curve, with a tighter slot for the narrow I.
    // Its tangent turns the letter without warping the strokes; the baseline clears the bitcoin's descenders.
    const letters = [..."₿IFRÖST"], textRadius = R + N.base - A.crown, parts = [];
    const slots = letters.map(ch => (ch === "I" ? 0.42 : 0.74) * N.cap / textRadius);
    let along = -slots.reduce((sum, slot) => sum + slot, 0) / 2;
    for (let j = 0; j < letters.length; j++) {
      const glyph = BM.word(letters[j], N.cap), v = glyph.verts;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < v.length; i += 3) {
        const a = Math.atan2(v[i], textRadius + v[i + 1]);
        lo = Math.min(lo, a); hi = Math.max(hi, a);
      }
      const a = along + slots[j] / 2 - (lo + hi) / 2;
      parts.push(moved(turnedZ(glyph, -a), textRadius * Math.sin(a), cy + textRadius * Math.cos(a), face));
      along += slots[j];
    }
    const name = noShadow(merge(...parts)), gilds = NAME_GILT.recolour.map(([a, b]) => [hexToRgb(a), hexToRgb(b)]);
    name.smooth = true;
    for (const f of name.faces) {
      f.emissive = Math.min(1, f.emissive * NAME_GILT.glow);
      for (const [from, to] of gilds) if (f.color[0] === from[0] && f.color[1] === from[1] && f.color[2] === from[2]) f.color = to;
    }
    BL.hubModels.flatInto(name, ...lit);

    const geo = merge(...stone), shell = merge(...shellParts), V = shell.verts, B = Float64Array.from(bounds);
    geo.collisionGeometry = shell;
    // The quarter-unit pillars share planes with the island's pass walls and ridge. Prefer their dressed stone at
    // those joins, without moving the shell or letting it draw through rock that actually stands in front.
    geo.depthOffset = true;
    let radius = 0;
    for (let i = 0; i < V.length; i += 3) radius = Math.max(radius, Math.hypot(V[i], V[i + 2]));
    const pick = (ox, oy, oz, dx, dy, dz) => {
      let best = Infinity;
      for (let i = 0; i < B.length; i += 6) {
        let near = 0, far = best;
        for (let a = 0; a < 3 && near <= far; a++) {
          const o = a === 0 ? ox : a === 1 ? oy : oz, d = a === 0 ? dx : a === 1 ? dy : dz;
          if (Math.abs(d) < 1e-12) {
            if (o < B[i + a] || o > B[i + a + 3]) near = Infinity;
            continue;
          }
          const t0 = (B[i + a] - o) / d, t1 = (B[i + a + 3] - o) / d;
          near = Math.max(near, Math.min(t0, t1));
          far = Math.min(far, Math.max(t0, t1));
        }
        if (near <= far) best = near;
      }
      return best;
    };
    return {
      stone: geo, trims: merge(...trims), banners: merge(...cloth), bannerMarks: bannerMarks(marks), glow: noShadow(merge(...glow)), light: name,
      opening: { half: A.half, spring: A.spring, crown: A.crown }, top: peak, middle: peak / 2, spark, pool: ARCH_LIGHT, reach: radius, pick
    };
  });

  // The walking height in the gate's frame at (x, z): a tread of the stairs, the landing, or the passage's floor through
  // the field; -Infinity off them (the court before the stairs is the isle's).
  const floorAt = (x, z) => {
    const ax = Math.abs(x);
    if (z > STAIRS.from) return z <= GATE.run && ax <= STAIRS.halfWidth ? -STAIRS.riser * Math.ceil((z - STAIRS.from) / STAIRS.tread - 1e-9) : -Infinity;
    if (z >= Z0) return ax <= GATE.halfWidth ? 0 : -Infinity;
    return ax <= PASSAGE.half && z >= PASSAGE.back ? 0 : -Infinity;
  };

  BL.bifrostGate = {
    GATE, RUNES, build, landmark, floorAt, runeBanner, lantern, brazier, runeWord, runeStrokes,
    PALETTE: { NAVY, GOLD, GOLD_LT, GOLD_DK, AMBER, BLUE, BLUE_MID, BLUE_LT, ICE, DEEP, STONE, STONE_LT, STONE_DK, DIRT, PAVE, STEP, WAX, IRON, WOOD, EMBER, GLASS, FLAME, RUNE_WHITE }
  };
})();
