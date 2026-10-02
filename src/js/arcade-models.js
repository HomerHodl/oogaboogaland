// Ooga Arcade's geometry: the hall behind the 3 o'clock mouth, twelve cabinets, the carnival machines (skee-ball
// lanes, hoop shots and a coconut shy), the snack bar, and the pixel screens and stone scoreboards they all show.
//
// The hall follows the cartoon pass's interior recipe on the Lightning Factory's bar: a dark coarse-block cave, its
// rock painted by the Oogas, round a busy, lit floor (earth, flagstones, reed mats and hides), furnished as a jungle
// arcade the Oogas built from what the island gives: chunky timber, bamboo lashed with rope, logs, dry frond roofs,
// bone and tusk trim, and a coconut wherever a ball or a knob was, with lianas and leaves grown into each builder's
// own mesh (`hubModels.withJungle`). Timber, stone, hide and firelight are the mass; the game screens and a few
// glowing mushrooms and crystals are the only cool accents.
//
// Screens are pixel art: a grid of cells baked into one emissive geometry with every lit run of a row merged into
// one quad. A game's attract loop is `FRAMES` such geometries the scene swaps between. A scoreboard is a sandstone
// slab with its title brushed on, plus digit nodes that swap between the ten cached brushed `digit` geometries, so a
// changing score allocates nothing. Every builder is cached; the scene places copies.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { cached, variants, box, bevelBox, lathe, merge, geometry, pushVert, face, moved, turnedX, turnedY, turnedZ, prism, ring } = BL.models;
  const { beam, turn, shaded, torus, along, noShadow: unshadowed } = BL.models;
  const { hexToRgb, mulberry32 } = BL.math;
  const { glyphOf, GLYPH_W, GLYPH_H, TRACKING } = BL.jumbotron.text;

  // The hall, in the cave's frame: the mouth at +z (`front`). A timber mezzanine (`MEZZ`) runs along the back wall
  // with a stair up each side wall; a round stage (`STAGE`, two steps up) holds the live games in the middle.
  const HALL = { halfW: 18, back: -24, front: 6, h: 11, door: 2.5, doorH: 3.6 };
  const STAGE = { x: 0, z: -7.5, r: 4.6, inner: 4.2, low: 0.18, high: 0.36 };
  // The mezzanine's deck (its top at `y`, from `z0` at the back wall to its front edge `z1`) and its two stairs up
  // the side walls, [x, z] at the foot and the head, `w` wide.
  const MEZZ = { z0: HALL.back, z1: -18, y: 3.2, stairs: [[-16.2, -12.5, -16.2, -18], [16.2, -12.5, 16.2, -18]], stairW: 2.6 };
  // The games with cabinets, as the island names them: scene id, name, the marquee's words and badge, and the
  // colour of its screen's light.
  const GAMES = [
    { id: "race", name: "Ooga Rally", title: "RALLY", icon: "flag", light: [1, 0.85, 0.3] },
    { id: "drop", name: "Ooga Drop", title: "DROP", icon: "chute", light: [0.4, 0.8, 1] },
    { id: "orbit", name: "Ooga Orbit", title: "ORBIT", icon: "rocket", light: [0.7, 0.55, 1] },
    { id: "mine", name: "Ooga Mine", title: "MINE", icon: "pick", light: [1, 0.6, 0.25] }
  ];
  // The Ooga retro games (`retro-games.js`), one on each cabinet along the mezzanine, in the cabinets' order from the
  // fifth: scene id, name, and the marquee's words and badge. Each cabinet's trim is its screen's colour.
  const RETRO = [
    { id: "invaders", name: "Coconut Invaders", title: "INVADERS", icon: null },
    { id: "stampede", name: "Mammoth Stampede", title: "STAMPEDE", icon: null },
    { id: "pong", name: "Ooga Pong", title: "PONG", icon: null },
    { id: "snake", name: "Banana Snake", title: "SNAKE", icon: "banana" },
    { id: "flap", name: "Ptero Flap", title: "FLAP", icon: null },
    { id: "breaker", name: "Rock Breaker", title: "BREAKER", icon: null },
    { id: "dash", name: "Dino Dash", title: "DASH", icon: null },
    { id: "stacker", name: "Stone Stacker", title: "STACKER", icon: null }
  ];
  // Twelve cabinets, each carved from its own timber or stone (`body`, `stone` for the slabs), with the game's colour
  // (`trim`: its screen's light, and earthed, its cave paint and its hide), a second paint colour and a side-art
  // style (0 handprints, 1 zigzags, 2 spirals). The four with games stand on the stage on an arc facing the doorway
  // (`ARC`), the heart of the room; the other eight line the mezzanine under the big sign, each playing its retro
  // game (`retro`, its index in RETRO).
  const PAINT = [
    ["#8a5a32", "#ffd23a", "#b8402e", 0, 0], ["#7a4e2c", "#5ec8ff", "#e8dcc0", 2, 0], ["#94643a", "#b98cff", "#e8dcc0", 1, 0], ["#6e655c", "#ff9a3c", "#e8dcc0", 0, 1],
    ["#86582f", "#46ffd2", "#e8dcc0", 1, 0], ["#6a625a", "#e0452b", "#c8862c", 2, 1], ["#7c5230", "#c8ff5a", "#b8402e", 2, 0], ["#726758", "#ffd23a", "#b8402e", 0, 1],
    ["#8e5e34", "#7fe0ff", "#e8dcc0", 1, 0], ["#655c54", "#ffb02e", "#e8dcc0", 0, 1], ["#805430", "#2fd0c0", "#c8862c", 2, 0], ["#6c6258", "#ff5fa2", "#e8dcc0", 1, 1]
  ];
  const CAB = { w: 1.24, d: 0.96, pitch: 1.5 }, ARC = { x: 0, z: -0.2, r: 8, step: 0.265 };
  const CABINETS = PAINT.map(([body, trim, second, art, stone], i) => {
    const live = i < 4;
    const a = (i - 1.5) * ARC.step, x = live ? ARC.x + ARC.r * Math.sin(a) : (i - 4 - 3.5) * CAB.pitch;
    const z = live ? ARC.z - ARC.r * Math.cos(a) : MEZZ.z0 + 0.85, turn = live ? -a : 0, y = live ? STAGE.high : MEZZ.y;
    const play = { x: x + Math.sin(turn) * 1.25, z: z + Math.cos(turn) * 1.25, facing: turn + Math.PI };
    return { index: i, x, y, z, turn, game: live ? i : -1, retro: live ? -1 : i - 4, body, trim, second, art, stone: !!stone, play };
  });
  // Everything else, each built in its own frame facing +z; `turn` stands the frame in the hall. For the carnival
  // machines the player stands at the frame's origin (`play`); the counters are built with their customers on +z.
  // Laid out in districts round the stage, with the main aisles at least 3 m wide, every other walkway at least
  // 2.3 m, every gap narrower than a walker closed off rather than a squeeze, and at least 1.8 m of floor behind
  // every play spot: the throwing range on the right (the skee lanes facing the balcony, the Oogas' air hockey table
  // on the right wall in their firing line, and the hoop shots in the front corner facing the wall); the coconut shy
  // on the left wall, the food court before it and the snack bar on the front wall; the back room between the stage
  // and the deck, two pool tables either side of a plaza, the jackpot wheel on its own footing behind the stump and
  // an air hockey table on each flank by the stairs; and under the deck, against the back wall behind a 3 m street,
  // the claw machines and the pinball pair in the post bays, a dart board in each outer bay and the locked back
  // door. The token totem and the ticket muncher flank the doorway with the prize counter beside the muncher (munch,
  // then trade), and the kiddie rides stand side-on in a row right of the entry avenue, facing it.
  const standAt = (x, z, turn) => ({ x, z, turn, play: { x, z, facing: turn + Math.PI } });
  const LAYOUT = {
    cabinets: CABINETS,
    skee: [standAt(10, -3, 0), standAt(11.8, -3, 0)],
    hoops: [standAt(13.76, 2.7, -Math.PI / 2), standAt(13.76, 4.9, -Math.PI / 2)],
    shy: standAt(-13.21, -6.8, Math.PI / 2),
    // The playable claw machine is the middle one; its player stands `CLAW.back` in front of it.
    claw: standAt(0, -22.3, 0),
    snack: { x: -14.9, z: 4.3, turn: Math.PI },
    prizes: { x: -7.2, z: 4.6, turn: Math.PI },
    tables: [[-13.4, -1.9], [-9.2, -1.9]],
    claws: [[-3.227, -23.3], [0, -23.3], [3.227, -23.3]],
    pinball: [[5.53, -23.1], [7.18, -23.1]],
    // Air hockey: the Oogas' table on the right wall in the throwing range and one on each flank of the back room by
    // the stairs, each the table's middle and its `turn`, played from 1.75 m out along it (0: from its +z end).
    // Pool: two tables either side of the back room's plaza, played from +z. Darts: a board on the back wall under the
    // deck in each outer post bay, [x], thrown from `DART.oche` out from it.
    hockeys: [{ x: 16.3, z: -4.75, turn: 0 }, { x: -13.3, z: -14.15, turn: 0 }, { x: 13.55, z: -14.15, turn: 0 }],
    pools: [{ x: -7.8, z: -14.65 }, { x: 7.8, z: -14.65 }],
    darts: [-12.909, 12.909],
    changers: [{ x: 3.4, z: 5.5, turn: Math.PI }, { x: -3.4, z: 5.5, turn: Math.PI }],
    // The rides in the order of `ride`'s bodies: the silverback, the monkey cart, the dino and the baby mammoth, side-on
    // in a row right of the entry avenue, each facing it and played from the avenue's side.
    rides: [{ x: 5.5, z: 4.4, turn: -Math.PI / 2 }, { x: 5.5, z: 2.6, turn: -Math.PI / 2 }, { x: 5.5, z: 0.8, turn: -Math.PI / 2 }, { x: 5.5, z: -1, turn: -Math.PI / 2 }],
    ropes: [[-5.8, 2.5, -5.8, 3.6], [-8.6, 2.5, -8.6, 3.6]],
    // Jungle planters, [x, z, plant (even a palm, odd a bush), y, turn]: on the floor unless `y` stands one on the
    // mezzanine's deck.
    planters: [[-11.08, 5, 1], [-17, -4.1, 2], [-14.6, -23.2, 0, MEZZ.y, Math.PI], [14.6, -23.2, 4, MEZZ.y]],
    // The jackpot wheel on its own footing on the floor behind the stump, clear of its roots, high enough that its face
    // shows over the live cabinets' crowns from the doorway and the stage; it is spun from `play` on the stage's front,
    // square to its face, where the whole wheel shows over the cabinets and no cabinet's play spot is in reach.
    wheel: { x: 0, y: 5, z: -13.4, r: 1.5, play: { x: 0, z: -4.6, facing: Math.PI } },
    // The posters and the side walls' zone signs hang in the bays between the hall's posts, the posters' art clear of
    // the hall's vine curtains; the zone signs clear the paintings under them. The zones go by the Oogas' own words,
    // each with its earth paint for the handprints.
    posters: [
      [-9.5, 7.4, HALL.back + 0.1, 0, 2], [9.5, 7.4, HALL.back + 0.1, 0, 0], [HALL.halfW - 0.1, 3.8, -2.8, -Math.PI / 2, 1],
      [-HALL.halfW + 0.1, 4.6, -9.6, Math.PI / 2, 3], [HALL.halfW - 0.1, 6.2, 0.6, -Math.PI / 2, 2], [-HALL.halfW + 0.1, 6.4, -5.9, Math.PI / 2, 0]
    ],
    zones: [
      ["THRO-BALL", "#d9953a", HALL.halfW - 0.15, 7.3, -6.2, -Math.PI / 2], ["BONK COCONUT", "#c0402a", -HALL.halfW + 0.15, 7, -3.1, Math.PI / 2],
      ["OOGA PLAY", "#e0a83a", 4.4, 4.6, HALL.front - 0.12, Math.PI], ["BEST OOGA", "#c8583a", -4.4, 4.6, HALL.front - 0.12, Math.PI]
    ],
    // Carved gourd lanterns hung on lianas from the rock overhead, in rows down the hall: [x, z, how far each hangs
    // from `LANTERN_Y`]. The back pair hangs low by the deck's front, under the back wall's paintings as the hall sees
    // them, and none hangs over the stage's front, so dark frames the mammoth's skull.
    lanterns: [...[-12.5, 12.5].flatMap((x) => [[-17.4, -2.4], [-11.3, -0.45], [-7.9, 0.35], [-4.5, 0], [-1.1, -0.45], [2.3, 0.35]].map(([z, dy]) => [x, z, dy])),
      ...[-3.6, 3.6].flatMap((x) => [[-1.1, -0.45], [2.3, 0.35]].map(([z, dy]) => [x, z, dy]))],
    arc: ARC,
    // The hall of fame hung high off the stage's left, turned to face the doorway, clear of the mammoth over the stage;
    // the spirit rattle over the stage's middle, the prize shelf by the counter and the directory by the doorway.
    fame: { x: -6.4, y: 6.2, z: -7.4, turn: 0.62 }, disco: { x: 0, y: 7.7, z: -7.5 }, shelf: { x: -7.2, y: 5, z: HALL.front - 0.2, turn: Math.PI },
    directory: { x: 8, y: 2.4, z: HALL.front - 0.12, turn: Math.PI },
    // The locked back room's door under the mezzanine, between two of its columns.
    backDoor: { x: -6.455, z: HALL.back + 0.06 },
    bins: [[-4.4, 4.75], [17.1, 1.35], [-17.1, -3.3]], buckets: [[14.2, 3.8]],
    // The hall's stores, [x, y, z, turn, kind, how far each reaches from its middle]: firewood piled on the deck behind
    // its rail and under the right stair by a barrel, and a basket of coconuts by the left wall near the snack bar.
    stores: [[9.9, MEZZ.y, -18.9, 0, "wood", 0.375], [15.8, 0, -17.2, Math.PI / 2, "wood", 0.375], [-17.1, 0, 1.3, 0.4, "nuts", 0.31]],
    sign: { x: 0, y: 9, z: HALL.back + 0.62 }
  };
  const LANTERN_Y = 7.4;

  const TIMBER = "#8a5a32", TIMBER_DK = "#5c3a1e", TIMBER_LT = "#a8703e", STONE = ["#3f3630", "#4a3f37", "#362e29"];
  const BONE = "#efe6d2", BANANA = "#ffd23a", RED = "#e0452b", CREAM = "#f6ecd2", GLASS_DK = "#0b0d10";

  // ---- small builders -------------------------------------------------------------------------------------
  // A flat bar from a to b in the (z, y) plane at x: its length along the line, `t` across it and `w` thick in x.
  const strip = (x, a, b, color, w = 0.1, t = 0.035, emissive = 0) => {
    const dz = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dz, dy);
    return moved(turnedX(box({ w, h: t, d: len + t * 0.5, color, emissive }), -Math.atan2(dy, dz)), x, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2);
  };
  // A convex outline in the (z, y) plane stood on edge at x, `w` thick.
  const sideShape = (points, x, w, color, emissive = 0) => moved(turnedY(prism(points, w, color, emissive), -Math.PI / 2), x, 0, 0);
  // An outline as prism and a face take it: counter-clockwise from the front (its signed area not negative), whatever
  // order its corners came in.
  const ccw = (pts) => {
    let area = 0;
    for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
    return area < 0 ? pts.slice().reverse() : pts;
  };
  // An oval's outline, `n` corners `rx` by `ry` round the origin, counter-clockwise from +x; `oval(1, 1, n)` is the
  // unit round the paint's dots and blots are cut from.
  const oval = (rx, ry, n = 14) => Array.from({ length: n }, (_, k) => [Math.cos(k / n * Math.PI * 2) * rx, Math.sin(k / n * Math.PI * 2) * ry]);
  // A hex colour scaled by k, each channel held to 255.
  const tint = (hex, k) => `#${hexToRgb(hex).map((v) => Math.min(255, Math.round(v * k)).toString(16).padStart(2, "0")).join("")}`;
  const ball = (r, color, segments = 10) => lathe({ profile: [[0, -r], [r * 0.7, -r * 0.7], [r, 0], [r * 0.7, r * 0.7], [0, r]], segments, color });
  const smooth = (geo) => { geo.smooth = true; return geo; };
  const button = (r, color, emissive = 0.35) => lathe({ profile: [[r, 0], [r, 0.028], [r * 0.82, 0.042], [0, 0.042]], segments: 12, color, emissive });
  // A copy of a built geometry scaled about the origin, and one marked for the renderer's glass pass.
  const scaled = (geo, k) => { const g = merge(geo); for (let i = 0; i < g.verts.length; i++) g.verts[i] *= k; return g; };
  const glassy = (geo, glass = 0.22) => { geo.glass = glass; return unshadowed(geo); };

  // ---- pixel art ----------------------------------------------------------------------------------------
  // A grid of palette indices, text in the 5x7 font, lines and rectangles; `bake` turns it into quads.
  const grid = (w, h) => ({ w, h, pix: new Uint8Array(w * h) });
  const at = (g, x, y, c) => { if (x >= 0 && x < g.w && y >= 0 && y < g.h) g.pix[y * g.w + x] = c; };
  const rect = (g, x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) at(g, x, y, c); };
  const textWidth = (s) => s.length * (GLYPH_W + TRACKING) - TRACKING;
  const text = (g, s, x, y, c) => {
    for (const ch of s) {
      const rows = glyphOf(ch);
      for (let r = 0; r < GLYPH_H; r++) for (let col = 0; col < GLYPH_W; col++) if (rows[r] >> (GLYPH_W - 1 - col) & 1) at(g, x + col, y + r, c);
      x += GLYPH_W + TRACKING;
    }
  };
  const centred = (g, s, y, c) => text(g, s, Math.floor((g.w - textWidth(s)) / 2), y, c);
  const line = (g, x0, y0, x1, y1, c) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) at(g, Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c);
  };
  // Every lit run of one colour on a row is one quad, `cell` metres a pixel, centred on the origin facing +z. Index 0
  // is the dark glass: drawn as one quad behind the pixels with that glow when `back` is set, never as pixels.
  const bake = (g, palette, cell, back = 0) => {
    const geo = geometry(), rgb = palette.map(hexToRgb), x0 = -g.w * cell / 2, y0 = g.h * cell / 2;
    const quad = (ax, ay, bx, by, z, color, emissive) => {
      const a = pushVert(geo, ax, ay, z), b = pushVert(geo, bx, ay, z), c = pushVert(geo, bx, by, z), d = pushVert(geo, ax, by, z);
      face(geo, [a, b, c, d], color, { emissive });
    };
    if (back) quad(x0, -y0, -x0, y0, 0, rgb[0], back);
    for (let y = 0; y < g.h; y++) {
      let x = 0;
      while (x < g.w) {
        const c = g.pix[y * g.w + x];
        if (!c) { x++; continue; }
        let end = x + 1;
        while (end < g.w && g.pix[y * g.w + end] === c) end++;
        quad(x0 + x * cell, y0 - (y + 1) * cell, x0 + end * cell, y0 - y * cell, 0.004, rgb[c], 1);
        x = end;
      }
    }
    return unshadowed(geo);
  };

  // ---- scoreboards ----------------------------------------------------------------------------------------
  // A digit brushed in the boards' amber, and a board: a slab of warm sandstone chipped round by hand, its middle cut
  // back to a charcoal face, its title painted across the top in bone over a row of dots in the machine's colour and
  // `digits` slots under it, and a leaf sprig peeking up from behind each top corner, inside the slab's width so a
  // board hung over another hides them. The rim is one stone: four pieces mitred at the face's corners, their front a
  // shade lighter than their chipped sides, each corner knocked off at its own slant and each edge bowed out a little.
  // `board` returns the geometry, each slot's centre and the slab's outer size; the scene hangs a digit node on each
  // slot and swaps its geometry when the score changes.
  const SCORE_INK = "#ffb02e", BOARD_RIM = [0.12, 0.1], BOARD_STONE = ["#a08868", "#8f7a62"];
  const digit = variants((d) => unshadowed(brushWord(geometry(), String(d), 0, 0, 0.14, 0.026, SCORE_INK, 0.8, 0.004)));
  const DIGIT_W = (GLYPH_W + TRACKING) * 0.022 * 1.25;
  const boardCache = new Map();
  const board = (title, digits, trim) => {
    const key = `${title}|${digits}|${trim}`;
    let out = boardCache.get(key);
    if (out) return out;
    const w = Math.max(textWidth(title) * 0.02 + 0.08, digits * DIGIT_W + 0.1), h = 0.44, J = BL.hubModels, [RX, RY] = BOARD_RIM, FW = w + 2 * RX, FH = h + 2 * RY;
    const rand = mulberry32(title.length * 97 + digits * 13), flat = [
      box({ w: FW - 0.04, h: FH - 0.04, d: 0.08, color: "#4a423a", offset: { z: -0.02 } }),
      box({ w: w + 0.01, h: h + 0.01, d: 0.02, color: "#2a2622", offset: { z: 0.04 } }),
      brushWord(geometry(), title, 0, 0.13, 0.13, 0.022, "#efe2c4", 0.35, 0.054)
    ];
    // The rim: each corner knocked off from a point along the top or foot to one down the side (`chip`, x and y by
    // corner), each edge bowed out along a half sine through its own points so every piece stays convex; a piece is
    // its inner edge and the outer chain between its mitres.
    const chip = {};
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) chip[`${sx}${sy}`] = [sx * (FW / 2 - 0.02 - rand() * 0.035), sy * (FH / 2 - 0.02 - rand() * 0.03)];
    const bow = (ax, ay, bx, by, nx, ny, n) => {
      const b = 0.005 + rand() * 0.01, pts = [];
      for (let k = 1; k <= n; k++) { const t = (k + (rand() - 0.5) * 0.4) / (n + 1), s = Math.sin(Math.PI * t) * b; pts.push([ax + (bx - ax) * t + nx * s, ay + (by - ay) * t + ny * s]); }
      return pts;
    };
    const piece = (pts) => {
      const geo = prism(pts, 0.12, BOARD_STONE[1]), front = hexToRgb(BOARD_STONE[0]);
      geo.faces[pts.length].color = front;
      flat.push(moved(geo, 0, 0, 0.02));
    };
    for (const sy of [-1, 1]) {
      const [rx, ry] = [chip[`1${sy}`], chip[`-1${sy}`]], y = sy * FH / 2, run = [[FW / 2, rx[1]], [rx[0], y], ...bow(rx[0], y, ry[0], y, 0, sy, 2), [ry[0], y], [-FW / 2, ry[1]]];
      piece(sy > 0 ? [[-w / 2, h / 2], [w / 2, h / 2], ...run] : [[w / 2, -h / 2], [-w / 2, -h / 2], ...run.reverse()]);
    }
    for (const sx of [-1, 1]) {
      const lo = chip[`${sx}-1`][1], hi = chip[`${sx}1`][1], x = sx * FW / 2, side = [[sx * w / 2, -sx * h / 2], [x, sx > 0 ? lo : hi], ...bow(x, sx > 0 ? lo : hi, x, sx > 0 ? hi : lo, sx, 0, 1), [x, sx > 0 ? hi : lo], [sx * w / 2, sx * h / 2]];
      piece(side);
    }
    const geo = J.withJungle(shaded([], flat), (g) => {
      for (const s of [-1, 1]) J.sprig(g, s * (FW / 2 - 0.12), FH / 2 + 0.03, -0.07, s * 0.3, 0.8, -0.55, 2, 0.11, rand);
      // The machine's colour, a row of painted dots between the title and the digits.
      const n = Math.max(3, Math.round(w / 0.14));
      for (let i = 0; i < n; i++) daubDot(g, (i - (n - 1) / 2) * (w - 0.1) / (n - 1), 0.034, 0.011, 0.009, earth(trim), 0.3, i * 0.4, 0.051, 6);
      J.padNormals(g);
    });
    const slots = [];
    for (let i = 0; i < digits; i++) slots.push([(i - (digits - 1) / 2) * DIGIT_W, -0.1]);
    out = { geo, slots, w: FW, h: FH };
    boardCache.set(key, out);
    return out;
  };

  // ---- the hall -----------------------------------------------------------------------------------------
  // The Oogas' own cave, not an arcade with leaves on it. The floor: packed earth with sand and darker earth in big
  // soft patches, big flat flagstones paving the walks (`WALKS`) and laid in a stone circle round the stage, OOGA
  // laid in river pebbles on packed earth before it (`MEDALLION`), woven reed mats where the players stand (`MATS`),
  // hides where people linger (`RUGS`) and the Oogas' marks painted on some of the stones, all lit only faintly, as
  // ground catches firelight, and all within a centimetre or so of the earth, so no walker's feet sink into it.
  // The walls: dark rock in big rounded blocks of one, two, four or six cells, each set back, turned and tipped a
  // little, laid flush where the Oogas painted them (`PAINTINGS`, glowing faintly), the mouth's opening left in the
  // front wall, and a palisade of split logs bound with rope round the side and front walls' foot. The rock runs on
  // overhead as the ceiling with nothing spanning under it: rough bark trunks stand against the side walls only where
  // a torch or a creeper needs one (`POSTS`), each bowed and leaning its own way, bound in rope over the palisade,
  // a stub or two of branch left on it and forking at its head into the rock. Roots creep down the rock (`ROOTS`),
  // and ferns, moss and a few clusters of glowing teal mushrooms and crystals grow at its foot (`FOOT`), none harder
  // than a leaf more than a third of a metre out. Lianas swag along both side walls from trunk to trunk, hung between
  // them on roots arcing out of the rock (`HOOKS`); a vine climbs each trunk's fork into the rock with leaves bunched
  // there, loose curtains of vine hang down the walls clear of the posters, signs and paintings (`CURTAINS`), vines
  // creep up some trunks (`CREEPERS`), big leaves peek over the palisade and a leafy fringe hangs in the doorway.
  const MEDALLION = { z: 1.9, r: 2.1 };
  // The jackpot wheel's footing on the floor: a round stone plinth `r` across its middle, `z` behind the wheel's face.
  const WHEEL_FOOT = { z: -0.25, r: 0.56 };
  // The floor's heights over the packed earth, each layer a millimetre or so over the one under it: the flagstones'
  // tops, the mats and the hides.
  const FLAG_Y = 0.008, MAT_Y = 0.009, HIDE_Y = 0.0125;
  const EARTH = ["#6c4e33", "#7d5f3f", "#8e6f4b", "#5a3f29"], SAND = ["#a08058", "#b09064"], FLAGS = ["#968672", "#887864", "#a2927c", "#7c6e5c"], REEDS = ["#c2a05c", "#b0904e", "#caa864"];
  // The flagstone walks, [x0, x1, z0, z1]: in from the tunnel to the stone circle round the stage, from behind the
  // jackpot wheel's footing to the claws and along the gallery street under the deck, and out to the shy, the food
  // court and the snack bar, the skee lanes and the hoops.
  const WALKS = [[-2.3, 2.3, -2.4, HALL.front + 4], [-1.6, 1.6, -21.4, -14.4], [-9.7, 9.7, -21.2, -18.7], [-12.9, -5.4, -7.8, -5.8], [-15.8, -2.6, 0.2, 1.9], [2.2, 9.4, -2.7, -1.9], [7.4, 12.4, -1.9, 3.8]];
  // Reed mats where the players stand, [x0, x1, z0, z1]: the skee lanes, the hoops, the shy, the claws, the pinball
  // tables, the snack bar's counter and the pool tables.
  const MATS = [[9.25, 12.55, -3.4, -2.05], [12.35, 13.75, 1.95, 5.65], [-13.5, -12.05, -8.4, -5.2], [-4.3, 4.3, -22.75, -21.45], [4.9, 7.8, -22.25, -21.05], [-16.6, -13.2, 1.9, 3.05], [-9, -6.6, -13.85, -12.75], [6.6, 9, -13.85, -12.75]];
  // Hides on the floor, [kind, x, z, length, width, turn]: a leopard in the food court, a tiger in the prize queue and
  // a mammoth's pelt before the stage (`mammothPelt`).
  const RUGS = [["leopard", -11.3, 0.4, 3.3, 2, 0.08], ["tiger", -7.2, 2.95, 2.5, 1.45, 0.05], ["mammoth", 0, -1.75, 3.6, 1.7, 0]];
  // The four rock walls as the paint and the dressing see them: `r` runs along a wall to the right as it is faced and
  // `n` points out of it into the hall; `onWall` is the point `s` along a wall (x on the back and front walls, z on
  // the sides), `y` up and `d` out from its flat face, and `TO_WALL` the turn that stands art drawn facing +z on it.
  const WALLS = { B: { r: [1, 0, 0], n: [0, 0, 1] }, F: { r: [-1, 0, 0], n: [0, 0, -1] }, R: { r: [0, 0, 1], n: [-1, 0, 0] }, L: { r: [0, 0, -1], n: [1, 0, 0] } };
  const TO_WALL = { B: 0, F: Math.PI, R: -Math.PI / 2, L: Math.PI / 2 }, UP = [0, 1, 0];
  // The rock's blocks, [across, up] in metre cells, the walls' and the ceiling's (picked from at random, so a size
  // listed twice comes up twice as often), each laid `LAP` bigger than its cells and turned and tipped a little so
  // no two edges line up; and the ceiling's darker stone.
  const WALL_BLOCKS = [[2, 2], [2, 2], [3, 2], [2, 1], [1, 2], [2, 1], [1, 1]], CEILING_BLOCKS = [[3, 3], [3, 2], [2, 3], [2, 2], [4, 2], [2, 2]];
  const CEILING = ["#342c26", "#2e2722", "#3a312a"], LAP = 0.16;
  const onWall = (wall, s, y, d) => wall === "B" ? [s, y, HALL.back + d] : wall === "F" ? [s, y, HALL.front - d] : wall === "R" ? [HALL.halfW - d, y, s] : [d - HALL.halfW, y, s];
  // A face's corners in the order that faces it along n (Newell's normal against n).
  const facing = (geo, ids, n) => {
    const v = geo.verts;
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < ids.length; k++) {
      const a = ids[k] * 3, b = ids[(k + 1) % ids.length] * 3;
      x += (v[a + 1] - v[b + 1]) * (v[a + 2] + v[b + 2]);
      y += (v[a + 2] - v[b + 2]) * (v[a] + v[b]);
      z += (v[a] - v[b]) * (v[a + 1] + v[b + 1]);
    }
    return x * n[0] + y * n[1] + z * n[2] < 0 ? ids.reverse() : ids;
  };

  // ---- the Oogas' cave paint ------------------------------------------------------------------------------
  // The Oogas paint their cave and their machines alike, in ochre, red earth, charcoal and chalk (and `EMBER_GLOW`,
  // the fires' own glow). Each painter writes flat shapes into `g` on its xy plane at depth `z` facing +z, glowing
  // `e`: `daubPoly` a convex patch in either winding, `daubDot` a dab (an oval `rx` by `ry` turned `rot`), `daubTaper`
  // a brush line through [x, y] points swelling and thinning by `w(t)` along it and `daubStroke` one `w` wide with
  // round ends, `daubHand` a handprint `s` tall turned `rot`, `daubZigzag` a band of teeth, `daubSpiral` a sun spiral
  // with its rays and `daubOoga` a stick-figure Ooga `s` tall throwing a coconut toward +x (the `MARK.ooga` figures
  // below have a wider head, a tuft of hair and a pose each). Stand the result on a face with `moved` and the
  // `turned*` helpers a hair proud of it; `mirroredX` flips a drawn piece left to right, still facing +z, for a face
  // that runs the other way. Then the marks they draw, each `s` tall or long at (x, y): a banana, a coconut, a
  // footprint, a flame and a fire, an Ooga with a spear, dancing or carrying something over its head (`f` -1 turns
  // it to face left), a mammoth, and the four games as pictographs: a kart, a parachute, a rocket and a pick.
  const EARTH_OCHRE = "#d9953a", EARTH_RED = "#b8472c", EARTH_BLACK = "#2b221d", EARTH_CHALK = "#eadfc6", EMBER_GLOW = "#ff8a2a";
  const daubPoly = (g, pts, color, e = 0, z = 0) => {
    face(g, ccw(pts).map(([x, y]) => pushVert(g, x, y, z)), hexToRgb(color), { emissive: e });
    return g;
  };
  const daubDot = (g, x, y, rx, ry, color, e = 0, rot = 0, z = 0, sides = 10) => {
    const c = Math.cos(rot), s = Math.sin(rot), ids = [];
    for (let k = 0; k < sides; k++) {
      const a = k / sides * Math.PI * 2, u = Math.cos(a) * rx, v = Math.sin(a) * ry;
      ids.push(pushVert(g, x + u * c - v * s, y + u * s + v * c, z));
    }
    face(g, ids, hexToRgb(color), { emissive: e });
    return g;
  };
  const daubTaper = (g, pts, w, color, e = 0, z = 0) => {
    const rgb = hexToRgb(color), n = pts.length;
    let l0 = -1, r0 = -1;
    for (let k = 0; k < n; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, h = w(k / (n - 1)) / 2;
      const nx = (a[1] - b[1]) / len * h, ny = (b[0] - a[0]) / len * h;
      const l1 = pushVert(g, pts[k][0] + nx, pts[k][1] + ny, z), r1 = pushVert(g, pts[k][0] - nx, pts[k][1] - ny, z);
      if (k) face(g, [r0, r1, l1, l0], rgb, { emissive: e });
      l0 = l1; r0 = r1;
    }
    return g;
  };
  const daubStroke = (g, pts, w, color, e = 0, z = 0) => {
    daubTaper(g, pts, () => w, color, e, z);
    for (const p of [pts[0], pts[pts.length - 1]]) daubDot(g, p[0], p[1], w / 2, w / 2, color, e, 0, z, 6);
    return g;
  };
  // The fingers as [across, lean, length] from the palm's top, in handprint heights.
  const FINGERS = [[-0.19, -0.32, 0.3], [-0.07, -0.1, 0.38], [0.06, 0.08, 0.4], [0.18, 0.28, 0.32]];
  const daubHand = (g, x, y, s, rot, color, e = 0, z = 0) => {
    const c = Math.cos(rot), sn = Math.sin(rot), at = (u, v) => [x + (u * c - v * sn) * s, y + (u * sn + v * c) * s];
    const [px, py] = at(0, 0.3);
    daubDot(g, px, py, 0.25 * s, 0.28 * s, color, e, rot, z);
    for (const [u, lean, len] of FINGERS) daubStroke(g, [at(u, 0.48), at(u + Math.sin(lean) * len, 0.48 + Math.cos(lean) * len)], 0.1 * s, color, e, z);
    return daubStroke(g, [at(0.2, 0.22), at(0.46, 0.46)], 0.11 * s, color, e, z);
  };
  const daubZigzag = (g, x0, x1, y, amp, teeth, w, color, e = 0, z = 0) =>
    daubStroke(g, Array.from({ length: teeth * 2 + 1 }, (_, k) => [x0 + (x1 - x0) * k / (teeth * 2), y + (k % 2 ? amp : -amp)]), w, color, e, z);
  const daubSpiral = (g, x, y, r, w, color, e = 0, z = 0) => {
    daubStroke(g, Array.from({ length: 41 }, (_, k) => [x + Math.cos(k * 0.4) * r * k / 40, y + Math.sin(k * 0.4) * r * k / 40]), w, color, e, z);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + 0.2; daubStroke(g, [[x + Math.cos(a) * r * 1.2, y + Math.sin(a) * r * 1.2], [x + Math.cos(a) * r * 1.5, y + Math.sin(a) * r * 1.5]], w, color, e, z); }
    return g;
  };
  const OOGA_LIMBS = [[[-0.04, 0.44], [-0.12, 0.22], [-0.2, 0]], [[0.04, 0.44], [0.12, 0.22], [0.17, 0]], [[0.05, 0.68], [0.18, 0.8], [0.24, 0.98]], [[-0.05, 0.68], [-0.2, 0.6], [-0.32, 0.68]]];
  const daubOoga = (g, x, y, s, color, e = 0, z = 0) => {
    daubDot(g, x + 0.02 * s, y + 0.88 * s, 0.1 * s, 0.1 * s, color, e, 0, z);
    daubDot(g, x, y + 0.56 * s, 0.13 * s, 0.17 * s, color, e, 0, z);
    for (const limb of OOGA_LIMBS) daubStroke(g, limb.map(([u, v]) => [x + u * s, y + v * s]), 0.065 * s, color, e, z);
    return daubDot(g, x + 0.3 * s, y + 1.06 * s, 0.075 * s, 0.075 * s, color, e, 0, z);
  };
  const mirroredX = (geo) => {
    for (let i = 0; i < geo.verts.length; i += 3) geo.verts[i] = -geo.verts[i];
    for (const f of geo.faces) f.i.reverse();
    return geo;
  };
  // An Ooga's legs, then arms, as [x, y] runs in its heights from the hip and the shoulder, per pose.
  const OOGA_POSES = {
    spear: [[[-0.04, 0.44], [-0.14, 0.22], [-0.24, 0]], [[0.04, 0.44], [0.15, 0.24], [0.2, 0]], [[-0.05, 0.68], [-0.15, 0.52], [-0.2, 0.4]], [[0.05, 0.68], [0.2, 0.76], [0.3, 0.88]]],
    dance: [[[-0.04, 0.44], [-0.2, 0.26], [-0.14, 0]], [[0.04, 0.44], [0.2, 0.26], [0.14, 0]], [[-0.05, 0.68], [-0.2, 0.82], [-0.3, 1]], [[0.05, 0.68], [0.2, 0.82], [0.3, 1]]],
    carry: [[[-0.04, 0.44], [-0.1, 0.22], [-0.12, 0]], [[0.04, 0.44], [0.1, 0.22], [0.12, 0]], [[-0.05, 0.68], [-0.19, 0.86], [-0.1, 1.04]], [[0.05, 0.68], [0.19, 0.86], [0.1, 1.04]]],
    dunk: [[[-0.04, 0.44], [0.1, 0.3], [-0.08, 0.16]], [[0.04, 0.44], [0.18, 0.26], [0.02, 0.08]], [[-0.05, 0.68], [-0.2, 0.64], [-0.32, 0.76]], [[0.05, 0.68], [0.16, 0.88], [0.26, 1.06]]]
  };
  const MARK = {
    banana: (g, x, y, s, rot, color, e, z = 0) => {
      const c = Math.cos(rot), sn = Math.sin(rot), at = (u, v) => [x + (u * c - v * sn) * s, y + (u * sn + v * c) * s], pts = [];
      for (let k = 0; k <= 8; k++) { const t = (k / 8 - 0.5) * 1.9; pts.push(at(Math.sin(t) * 0.5, 0.3 - Math.cos(t) * 0.5)); }
      daubTaper(g, pts, (t) => s * 0.25 * Math.sin(Math.PI * (0.06 + 0.88 * t)), color, e, z);
      return daubStroke(g, [pts[8], at(0.5, 0.14)], s * 0.05, color, e, z);
    },
    coconut: (g, x, y, s, color, e, z = 0) => {
      daubDot(g, x, y, s * 0.36, s * 0.33, color, e, 0, z, 12);
      for (const [u, v] of [[-0.1, 0.07], [0.1, 0.07], [0, -0.1]]) daubDot(g, x + u * s, y + v * s, s * 0.055, s * 0.055, EARTH_BLACK, 0, 0, z + 0.004, 6);
      return g;
    },
    foot: (g, x, y, s, rot, color, e, z = 0) => {
      const c = Math.cos(rot), sn = Math.sin(rot), at = (u, v) => [x + (u * c - v * sn) * s, y + (u * sn + v * c) * s];
      daubDot(g, x, y, s * 0.2, s * 0.38, color, e, rot, z, 9);
      for (const [u, v, r] of [[-0.12, 0.5, 0.075], [-0.02, 0.55, 0.06], [0.07, 0.52, 0.052], [0.14, 0.46, 0.046], [0.19, 0.38, 0.04]]) daubDot(g, ...at(u, v), r * s, r * s, color, e, 0, z, 6);
      return g;
    },
    flame: (g, x, y, s, color, e, z = 0, lean = 0) => {
      const w = s * 0.34;
      return daubPoly(g, [[x + lean * s, y + s], [x - w * 0.72, y + w * 1.25], [x - w, y + w * 0.55], [x - w * 0.66, y + w * 0.08], [x, y], [x + w * 0.66, y + w * 0.08], [x + w, y + w * 0.55], [x + w * 0.72, y + w * 1.25]], color, e, z);
    },
    fire: (g, x, y, s, e, z = 0) => {
      daubStroke(g, [[x - s * 0.42, y - s * 0.02], [x + s * 0.42, y + s * 0.1]], s * 0.08, EARTH_OCHRE, e, z);
      daubStroke(g, [[x - s * 0.4, y + s * 0.1], [x + s * 0.42, y - s * 0.03]], s * 0.08, EARTH_OCHRE, e, z + 0.004);
      MARK.flame(g, x, y + s * 0.04, s, EARTH_RED, e, z + 0.008, 0.06);
      MARK.flame(g, x, y + s * 0.06, s * 0.66, EARTH_OCHRE, e, z + 0.012, -0.05);
      return MARK.flame(g, x, y + s * 0.08, s * 0.34, EARTH_CHALK, e, z + 0.016, 0.03);
    },
    ooga: (g, x, y, s, pose, color, e, z = 0, f = 1) => {
      const at = ([u, v]) => [x + u * s * f, y + v * s];
      daubDot(g, ...at([0.02, 0.88]), 0.11 * s, 0.1 * s, color, e, 0, z);
      daubDot(g, ...at([0, 0.56]), 0.13 * s, 0.17 * s, color, e, 0, z);
      daubStroke(g, [[-0.09, 0.94], [-0.05, 1.02], [0, 0.96], [0.05, 1.03], [0.1, 0.95]].map(at), 0.035 * s, color, e, z);
      for (const limb of OOGA_POSES[pose]) daubStroke(g, limb.map(at), 0.065 * s, color, e, z);
      if (pose !== "spear") return g;
      daubStroke(g, [at([-0.3, 0.56]), at([0.72, 1.06])], 0.03 * s, color, e, z);
      return daubPoly(g, [at([0.66, 1.08]), at([0.9, 1.14]), at([0.74, 0.98])], EARTH_CHALK, e, z + 0.004);
    },
    mammoth: (g, x, y, s, color, e, z = 0, f = 1) => {
      const at = (u, v) => [x + u * s * f, y + v * s];
      daubDot(g, ...at(0, 0.56), s * 0.5, s * 0.3, color, e, 0, z, 16);
      daubDot(g, ...at(0.18, 0.72), s * 0.32, s * 0.2, color, e, 0, z, 12);
      daubDot(g, ...at(0.47, 0.64), s * 0.19, s * 0.21, color, e, 0, z);
      daubDot(g, ...at(0.4, 0.84), s * 0.13, s * 0.13, color, e, 0, z, 9);
      for (const [u, d] of [[-0.36, -0.03], [-0.2, 0.02], [0.17, -0.02], [0.32, 0.03]]) daubStroke(g, [at(u, 0.5), at(u + d, 0.04)], s * 0.13, color, e, z);
      daubTaper(g, [at(0.6, 0.62), at(0.7, 0.42), at(0.71, 0.2), at(0.63, 0.08)], (t) => s * (0.13 - 0.08 * t), color, e, z);
      daubStroke(g, [at(-0.48, 0.66), at(-0.58, 0.44)], s * 0.035, color, e, z);
      daubTaper(g, [at(0.57, 0.5), at(0.74, 0.35), at(0.89, 0.39), at(0.95, 0.53)], (t) => s * (0.07 - 0.055 * t), EARTH_CHALK, e, z + 0.004);
      daubDot(g, ...at(0.51, 0.72), s * 0.03, s * 0.03, EARTH_BLACK, 0, 0, z + 0.004, 6);
      return daubStroke(g, Array.from({ length: 13 }, (_, k) => at(-0.42 + k * 0.07, k % 2 ? 0.3 : 0.37)), s * 0.028, EARTH_BLACK, 0, z + 0.004);
    },
    kart: (g, x, y, s, color, e, z = 0) => {
      const at = (u, v) => [x + u * s, y + v * s];
      daubPoly(g, [at(-0.5, 0.2), at(0.44, 0.2), at(0.56, 0.34), at(0.22, 0.44), at(-0.46, 0.42)], color, e, z);
      for (const u of [-0.3, 0.32]) { daubDot(g, ...at(u, 0.15), s * 0.15, s * 0.15, color, e, 0, z, 12); daubDot(g, ...at(u, 0.15), s * 0.06, s * 0.06, EARTH_CHALK, e, 0, z + 0.004, 8); }
      daubDot(g, ...at(-0.04, 0.66), s * 0.13, s * 0.13, color, e, 0, z);
      daubStroke(g, [at(-0.05, 0.42), at(-0.04, 0.56)], s * 0.13, color, e, z);
      daubStroke(g, [at(0, 0.52), at(0.2, 0.48)], s * 0.055, color, e, z);
      daubStroke(g, [at(-0.42, 0.42), at(-0.5, 1)], s * 0.035, color, e, z);
      daubPoly(g, [at(-0.5, 1), at(-0.5, 0.78), at(-0.2, 0.89)], EARTH_RED, e, z);
      for (const v of [0.22, 0.32, 0.42]) daubStroke(g, [at(-0.64, v), at(-0.86, v)], s * 0.035, color, e, z);
      return g;
    },
    chute: (g, x, y, s, color, e, z = 0) => {
      const at = (u, v) => [x + u * s, y + v * s];
      daubPoly(g, Array.from({ length: 11 }, (_, k) => at(Math.cos(k / 10 * Math.PI) * 0.5, 0.72 + Math.sin(k / 10 * Math.PI) * 0.3)), color, e, z);
      for (let k = 0; k < 4; k++) daubDot(g, ...at(-0.375 + k * 0.25, 0.72), s * 0.125, s * 0.05, color, e, 0, z, 8);
      for (const u of [-0.46, -0.16, 0.16, 0.46]) daubStroke(g, [at(u, 0.7), at(u * 0.12, 0.38)], s * 0.018, color, e, z);
      return MARK.ooga(g, x, y - s * 0.04, s * 0.42, "carry", color, e, z);
    },
    rocket: (g, x, y, s, color, e, z = 0) => {
      const at = (u, v) => [x + u * s, y + v * s];
      MARK.flame(g, ...at(0, 0.2), -s * 0.32, EARTH_RED, e, z);
      MARK.flame(g, ...at(0, 0.2), -s * 0.19, EARTH_OCHRE, e, z + 0.004);
      daubPoly(g, [at(-0.12, 0.2), at(0.12, 0.2), at(0.12, 0.7), at(0, 0.96), at(-0.12, 0.7)], color, e, z + 0.008);
      for (const sx of [-1, 1]) daubPoly(g, [at(sx * 0.12, 0.2), at(sx * 0.12, 0.44), at(sx * 0.28, 0.12)], color, e, z + 0.008);
      daubDot(g, ...at(0, 0.62), s * 0.06, s * 0.06, EARTH_CHALK, e, 0, z + 0.012, 8);
      for (const [u, v] of [[-0.4, 0.82], [0.36, 0.64], [0.42, 0.96], [-0.32, 0.42]]) daubDot(g, ...at(u, v), s * 0.03, s * 0.03, color, e, 0, z, 5);
      return g;
    },
    pick: (g, x, y, s, color, e, z = 0) => {
      const at = (u, v) => [x + u * s, y + v * s], R = 0.5, cu = 0.22 - 0.6 * R, cv = 0.72 - 0.8 * R;
      daubStroke(g, [at(-0.3, 0.02), at(0.22, 0.72)], s * 0.075, color, e, z);
      daubTaper(g, Array.from({ length: 9 }, (_, k) => { const t = 0.93 + (k / 8 - 0.5) * 1.9; return at(cu + Math.cos(t) * R, cv + Math.sin(t) * R); }), (t) => s * 0.13 * Math.sin(Math.PI * (0.05 + 0.9 * t)), EARTH_CHALK, e, z + 0.004);
      for (const [u, v, r] of [[0.42, 0.08, 0.07], [0.56, 0.16, 0.05], [0.52, 0.02, 0.045]]) daubDot(g, ...at(u, v), s * r, s * r, color, e, 0, z, 6);
      return g;
    },
    // The hoop shot's: an Ooga leaping to dunk a coconut into a hoop before him, its net hanging under it.
    dunk: (g, x, y, s, color, e, z = 0) => {
      const at = (u, v) => [x + u * s, y + v * s];
      MARK.ooga(g, x, y, s, "dunk", color, e, z);
      daubStroke(g, Array.from({ length: 13 }, (_, k) => at(0.5 + Math.cos(k / 12 * Math.PI * 2) * 0.17, 0.92 + Math.sin(k / 12 * Math.PI * 2) * 0.045)), s * 0.035, EARTH_CHALK, e, z + 0.004);
      daubZigzag(g, ...[0.36, 0.64].map((u) => x + u * s), y + 0.82 * s, s * 0.05, 3, s * 0.022, EARTH_CHALK, e, z + 0.004);
      for (const u of [0.36, 0.64]) daubStroke(g, [at(u, 0.91), at(0.5 + (u - 0.5) * 0.6, 0.72)], s * 0.022, EARTH_CHALK, e, z + 0.004);
      return MARK.coconut(g, ...at(0.36, 1.12), s * 0.3, EARTH_RED, e, z + 0.008);
    }
  };
  // The cave paintings, on rock smoothed flush for them: [wall, from, to, y0, y1, paint]. `from` to `to` runs along the
  // wall (x on the back and front walls, z on the sides) in whole metres, so the blocks behind lie flush; `paint(g, e)`
  // draws round (0, 0) at the panel's middle, x to the right as the wall is faced. Each keeps clear of the posters,
  // signs, speakers, dart boards, vines and machines at its wall, and they are big enough to read from the doorway.
  const PAINTINGS = [
    // The back wall's corners over the mezzanine: the mammoth hunt, and the dance round the fire, drawn high on its
    // panel, clear of the deck's palm.
    ["B", -16, -12, 6, 10, (g, e) => {
      MARK.mammoth(g, 0.1, -1.75, 1.95, EARTH_RED, e);
      MARK.ooga(g, -1.55, -1.8, 1.05, "spear", EARTH_OCHRE, e, 0.008);
      MARK.ooga(g, -1, -0.1, 0.8, "spear", EARTH_OCHRE, e, 0.008);
      daubSpiral(g, 1.2, 1.05, 0.36, 0.07, EARTH_OCHRE, e);
      daubHand(g, -1.3, 0.85, 0.55, 0.2, EARTH_RED, e);
      daubHand(g, -0.55, 1.1, 0.48, -0.15, EARTH_CHALK, e, 0.004);
      daubStroke(g, [[-1.85, -1.88], [1.85, -1.88]], 0.045, EARTH_OCHRE, e);
    }],
    ["B", 12, 16, 6, 10, (g, e) => {
      MARK.fire(g, 0, -1.35, 1, e);
      MARK.ooga(g, -1.45, -1.35, 1.1, "dance", EARTH_CHALK, e);
      MARK.ooga(g, -0.72, -1.2, 1, "dance", EARTH_OCHRE, e);
      MARK.ooga(g, 0.72, -1.2, 1, "dance", EARTH_OCHRE, e, 0, -1);
      MARK.ooga(g, 1.45, -1.35, 1.1, "dance", EARTH_CHALK, e, 0, -1);
      MARK.banana(g, -0.95, 1.15, 0.9, 0.3, EARTH_OCHRE, e);
      MARK.coconut(g, 0.15, 1.5, 0.62, EARTH_RED, e);
      daubSpiral(g, 1.25, 1.15, 0.3, 0.06, EARTH_CHALK, e);
      for (let k = 0; k < 9; k++) daubDot(g, -1.6 + k * 0.4, 0.5 + (k % 2) * 0.14, 0.055, 0.055, EARTH_RED, e, 0, 0, 6);
    }],
    // Beside the big sign, clear of its torches, the four games as pictographs: the kart over the parachute, the rocket
    // over the pick.
    ["B", -8, -6, 6, 10, (g, e) => { MARK.kart(g, 0.18, 0.45, 1, EARTH_OCHRE, e); MARK.chute(g, 0, -1.85, 1.35, EARTH_CHALK, e); }],
    ["B", 6, 8, 6, 10, (g, e) => { MARK.rocket(g, 0, -0.05, 1.75, EARTH_OCHRE, e); MARK.pick(g, 0.05, -1.85, 1.3, EARTH_RED, e); }],
    // The right wall over the Oogas' air hockey table: the great mammoth in a burnt red, dim so the torches either side
    // light it rather than it glowing, turned toward its hunters over the stair behind it, and two hands over its back.
    ["R", -8, -5, 2, 6, (g, e) => {
      MARK.mammoth(g, 0.36, -1.55, 1.95, tint(EARTH_RED, 0.62), e * 0.35, 0, -1);
      daubHand(g, -0.75, 1.1, 0.5, 0.2, EARTH_CHALK, e);
      daubHand(g, 0.55, 1.2, 0.48, -0.15, EARTH_OCHRE, e);
    }],
    // Behind the hoop shots, under their backboards and seen through their cages: an Ooga dunking a coconut behind
    // each, and hands and dots where the rock shows between them.
    ["R", 2, 6, 1, 3, (g, e) => {
      MARK.dunk(g, -1.05, -0.5, 0.95, EARTH_OCHRE, e);
      MARK.dunk(g, 1.05, -0.5, 0.95, EARTH_CHALK, e);
      daubHand(g, 0.25, -0.35, 0.38, 0.15, EARTH_RED, e);
      daubHand(g, -1.82, -0.2, 0.3, -0.2, EARTH_RED, e);
      for (let k = 0; k < 9; k++) daubDot(g, -1.6 + k * 0.4, 0.78, 0.045, 0.045, EARTH_RED, e, 0, 0, 6);
    }],
    ["R", -16, -13, 5, 8, (g, e) => {
      MARK.ooga(g, -0.75, -1.35, 1.15, "spear", EARTH_OCHRE, e);
      MARK.ooga(g, 0.35, -1.25, 1, "spear", EARTH_CHALK, e, 0.008);
      daubSpiral(g, -0.8, 0.95, 0.3, 0.06, EARTH_RED, e);
      for (let k = 0; k < 6; k++) daubDot(g, 0.2 + k * 0.22, 0.95 + Math.sin(k * 1.3) * 0.1, 0.05, 0.05, EARTH_OCHRE, e, 0, 0, 6);
    }],
    // High on the right wall over the hoops' poster: a band of zigzags over coconuts and a row of dots.
    ["R", -1, 2, 7, 10, (g, e) => {
      daubZigzag(g, -1.3, 1.3, 0.95, 0.2, 6, 0.08, EARTH_OCHRE, e);
      [EARTH_RED, EARTH_CHALK, EARTH_RED].forEach((ink, k) => MARK.coconut(g, (k - 1) * 0.9, -0.15, 0.62, ink, e));
      for (let k = 0; k < 7; k++) daubDot(g, -1.2 + k * 0.4, -0.95, 0.055, 0.055, EARTH_CHALK, e, 0, 0, 6);
    }],
    // The left wall over the food court: Oogas bringing bananas and a coconut.
    ["L", -1, 2, 6, 10, (g, e) => {
      for (const [x, s, ink] of [[-0.95, 1.05, EARTH_OCHRE], [0, 1.1, EARTH_CHALK], [0.95, 1.05, EARTH_OCHRE]]) MARK.ooga(g, x, -1.75, s, "carry", ink, e);
      MARK.banana(g, -0.95, -0.55, 0.6, 0, EARTH_CHALK, e, 0.004);
      MARK.coconut(g, 0, -0.45, 0.5, EARTH_RED, e, 0.004);
      MARK.banana(g, 0.95, -0.55, 0.6, 0.2, EARTH_CHALK, e, 0.004);
      daubZigzag(g, -1.3, 1.3, 1.25, 0.16, 7, 0.07, EARTH_RED, e);
      for (let k = 0; k < 7; k++) daubDot(g, -1.2 + k * 0.4, 0.6, 0.055, 0.055, EARTH_OCHRE, e, 0, 0, 6);
    }],
    // By the coconut shy, under its BONK COCONUT sign: an Ooga throwing a coconut at a stack of them, under a sun.
    ["L", -3, -1, 2, 6, (g, e) => {
      daubOoga(g, -0.45, -1.75, 1.45, EARTH_OCHRE, e);
      for (const [x, y] of [[0.42, -1.72], [0.78, -1.72], [0.6, -1.4]]) MARK.coconut(g, x, y, 0.42, EARTH_RED, e);
      for (let k = 0; k < 4; k++) daubDot(g, 0.02 + k * 0.14, -0.28 - k * k * 0.07, 0.035, 0.035, EARTH_CHALK, e, 0, 0, 6);
      daubSpiral(g, 0.1, 1.05, 0.4, 0.08, EARTH_CHALK, e);
      daubHand(g, -0.55, 0.55, 0.45, 0.2, EARTH_RED, e);
    }],
    ["L", 3, 5, 6, 10, (g, e) => {
      daubHand(g, -0.3, 0.55, 0.8, 0.15, EARTH_RED, e);
      daubHand(g, 0.4, -0.2, 0.7, -0.2, EARTH_OCHRE, e, 0.004);
      daubSpiral(g, 0, -1.3, 0.38, 0.08, EARTH_CHALK, e);
    }],
    // Over the doorway, seen on the way out: a sun spiral with four red handprints on its diagonals.
    ["F", -2, 2, 4, 8, (g, e) => {
      daubSpiral(g, 0, 0.1, 0.7, 0.1, EARTH_OCHRE, e);
      for (let k = 0; k < 4; k++) { const t = (k + 0.5) / 4 * Math.PI * 2; daubHand(g, Math.cos(t) * 1.35, 0.1 + Math.sin(t) * 1.35, 0.55, t - Math.PI / 2, EARTH_RED, e); }
    }],
    // The front wall either side of the doorway: a cave of hands in red and ochre high over the snack bar and the prize
    // shelf, an Ooga dancing by his heap of bananas over the directory.
    ["F", -14, -10, 6, 10, (g, e) => {
      const r = mulberry32(911);
      for (let k = 0; k < 6; k++) daubHand(g, -1.3 + (k % 3) * 1.3 + (r() - 0.5) * 0.3, -1.5 + Math.floor(k / 3) * 1.6 + (r() - 0.5) * 0.25, 0.6 + r() * 0.25, (r() - 0.5) * 0.9, k % 2 ? EARTH_OCHRE : EARTH_RED, e, (k % 2) * 0.004);
    }],
    ["F", 8, 12, 4, 8, (g, e) => {
      MARK.ooga(g, -0.8, -1.85, 2.2, "dance", EARTH_OCHRE, e);
      for (const [x, y, t, ink] of [[0.55, -1.8, 0.1, EARTH_CHALK], [1.2, -1.78, -0.15, EARTH_OCHRE], [0.88, -1.5, 0.25, EARTH_CHALK], [0.3, -1.5, -0.2, EARTH_OCHRE], [1.45, -1.45, 0.3, EARTH_CHALK], [0.62, -1.2, 0, EARTH_OCHRE], [1.12, -1.18, -0.3, EARTH_CHALK]]) MARK.banana(g, x, y, 0.62, t, ink, e, ink === EARTH_CHALK ? 0.004 : 0);
      MARK.coconut(g, 1.2, -0.6, 0.5, EARTH_RED, e);
      daubSpiral(g, 0.95, 1.1, 0.34, 0.07, EARTH_CHALK, e);
    }],
    // Under the mezzanine, where it is darkest: handprints on the back wall in the empty post bays either side of the
    // machines, between the back door and the left dart board and between the pinball pair and the right one.
    ["B", -11, -9, 1, 3, (g, e) => { daubHand(g, -0.45, -0.55, 0.6, 0.3, EARTH_OCHRE, e); daubHand(g, 0.42, -0.35, 0.65, -0.2, EARTH_CHALK, e, 0.004); }],
    ["B", 9, 11, 1, 3, (g, e) => { daubHand(g, -0.4, -0.4, 0.62, 0.2, EARTH_RED, e); daubHand(g, 0.45, -0.6, 0.58, -0.25, EARTH_OCHRE, e, 0.004); }]
  ];
  // Roots creeping down the rock from the ceiling, [wall, along, lowest y, seed], in the gaps between the paintings,
  // posters, signs, speakers and vines.
  const ROOTS = [["B", -11.2, 6.3, 1], ["B", 11.2, 6.5, 2], ["B", -4.6, 8.6, 3], ["B", 4.6, 8.4, 4], ["B", -17, 6.9, 17], ["B", 17, 7.1, 18], ["R", -18.9, 5.6, 5], ["R", -12.3, 6.2, 6], ["R", 4.9, 7.2, 8],
    ["L", -17.6, 5.4, 9], ["L", -15.2, 6, 10], ["L", -13.4, 7, 11], ["L", 5.7, 7.2, 12], ["F", -4.5, 6, 13], ["F", 5.9, 6.1, 14], ["F", -16.4, 6.6, 15], ["F", 13, 5.4, 16]];
  // What grows at the rock's foot, [wall, along, what]: fern clumps, glowing teal mushrooms, crystals out of the rock
  // and moss, each clear of the machines, planters, stairs and dart boards against its wall.
  const FOOT = [
    ["R", -20.2, "fern shroom"], ["R", -9.8, "shroom moss"], ["R", -7.3, "fern"], ["R", -2.6, "crystal moss"], ["R", -0.1, "fern"],
    ["L", -19.7, "shroom fern"], ["L", -9.9, "fern crystal"], ["L", -2, "fern moss"], ["L", 0.5, "shroom"],
    ["B", -16.2, "fern moss"], ["B", -10.3, "fern shroom"], ["B", -9.1, "crystal"], ["B", 9.2, "shroom moss"], ["B", 10.3, "fern"], ["B", 16.2, "shroom fern"],
    ["F", 8.2, "fern moss"], ["F", 10.3, "shroom fern"], ["F", 12.2, "crystal"]
  ];
  // Crazy paving: each real seed's flagstone is its cell among all the seeds (the unseen ones only cut), `GROUT`
  // short of halfway to each neighbour and cut to an octagon `reach` round the seed, so the stones at a walk's edge
  // round off and the walk frays into the earth. Each stone comes back as its outline, its middle and its inner radius.
  const GROUT = 0.035;
  const clipped = (poly, nx, nz, c) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], dp = nx * p[0] + nz * p[1] - c, dq = nx * q[0] + nz * q[1] - c;
      if (dp <= 0) out.push(p);
      if ((dp <= 0) !== (dq <= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out;
  };
  const paving = (seeds, reach) => {
    const stones = [], corner = reach / Math.cos(Math.PI / 8);
    for (const [x, z, real] of seeds) {
      if (!real) continue;
      let poly = Array.from({ length: 8 }, (_, k) => [x + Math.cos((k + 0.5) / 8 * Math.PI * 2) * corner, z + Math.sin((k + 0.5) / 8 * Math.PI * 2) * corner]);
      for (const [qx, qz] of seeds) {
        const dx = qx - x, dz = qz - z, d = Math.hypot(dx, dz);
        if (d > 1e-6 && d < reach * 2.2) poly = clipped(poly, dx / d, dz / d, ((qx + x) * dx + (qz + z) * dz) / (2 * d) - GROUT / 2);
      }
      if (poly.length < 3) continue;
      const cx = poly.reduce((t, p) => t + p[0], 0) / poly.length, cz = poly.reduce((t, p) => t + p[1], 0) / poly.length;
      let r = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const [px, pz] = poly[i], [qx, qz] = poly[(i + 1) % poly.length], l = Math.hypot(qx - px, qz - pz);
        if (l > 1e-6) r = Math.min(r, Math.abs((qx - px) * (cz - pz) - (qz - pz) * (cx - px)) / l);
      }
      stones.push({ poly, x: cx, z: cz, r });
    }
    return stones;
  };
  // A flagstone on `poly` ([x, z] corners): a flat top `top` high inset from its edge, and a bevel falling to `foot`
  // all round it in a darker shade, glowing `e`.
  const flagstone = (geo, poly, tone, top, foot = 0.004, e = 0.03) => {
    const cx = poly.reduce((t, p) => t + p[0], 0) / poly.length, cz = poly.reduce((t, p) => t + p[1], 0) / poly.length, rgb = hexToRgb(tone), edge = rgb.map((v) => Math.round(v * 0.78));
    const lo = poly.map(([x, z]) => pushVert(geo, x, foot, z));
    const hi = poly.map(([x, z]) => { const dx = x - cx, dz = z - cz, k = Math.max(0.5, 1 - 0.07 / (Math.hypot(dx, dz) || 1)); return pushVert(geo, cx + dx * k, top, cz + dz * k); });
    face(geo, facing(geo, hi.slice(), UP), rgb, { emissive: e });
    for (let i = 0; i < poly.length; i++) { const j = (i + 1) % poly.length; face(geo, facing(geo, [lo[i], lo[j], hi[j], hi[i]], UP), edge, { emissive: e * 0.67 }); }
  };
  // A block of rock written into `geo`: its face `w` along `r` by `h` along `u` round the point `at`, facing out along
  // `n`, bulging `bulge` at its middle and rounded over a chamfer `c` into sides a shade darker running `d` back; its
  // back is left open, since nothing sees it. Its corners are shared, so a `smooth` geometry shades it as one soft
  // stone. Each face is wound to face out, whichever hand r, u and n make.
  const stone = (geo, at, r, u, n, w, h, d, c, bulge, color) => {
    const rgb = hexToRgb(color), chamfer = rgb.map((v) => Math.round(v * 0.9)), side = rgb.map((v) => Math.round(v * 0.72)), x = w / 2, y = h / 2;
    const dir = (a, b, o) => [0, 1, 2].map((k) => r[k] * a + u[k] * b + n[k] * o), P = (a, b, o) => { const p = dir(a, b, o); return pushVert(geo, at[0] + p[0], at[1] + p[1], at[2] + p[2]); };
    const S = [[-1, -1], [1, -1], [1, 1], [-1, 1]], mid = P(0, 0, bulge);
    const inner = S.map(([a, b]) => P(a * (x - c), b * (y - c), 0)), outer = S.map(([a, b]) => P(a * x, b * y, -c)), back = S.map(([a, b]) => P(a * x, b * y, -d));
    for (let k = 0; k < 4; k++) {
      const j = (k + 1) % 4, ea = (S[k][0] + S[j][0]) / 2, eb = (S[k][1] + S[j][1]) / 2;
      face(geo, facing(geo, [mid, inner[k], inner[j]], n), rgb);
      face(geo, facing(geo, [inner[k], outer[k], outer[j], inner[j]], dir(ea, eb, 1)), chamfer);
      face(geo, facing(geo, [outer[k], back[k], back[j], outer[j]], dir(ea, eb, 0)), side);
    }
  };
  // Lays blocks over a `cols` by `rows` grid of metre cells, row by row: at each cell not yet covered (and `free`),
  // one of `sizes` [across, up] picked at random, shrunk until it fits, handed to `put(i, j, w, h)`.
  const layBlocks = (cols, rows, sizes, rand, free, put) => {
    const taken = new Uint8Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (!free(i, j)) taken[j * cols + i] = 1;
    const fits = (i, j, w, h) => {
      for (let b = j; b < j + h; b++) for (let a = i; a < i + w; a++) if (a >= cols || b >= rows || taken[b * cols + a]) return false;
      return true;
    };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (taken[j * cols + i]) continue;
      let [w, h] = sizes[Math.floor(rand() * sizes.length)];
      while (!fits(i, j, w, h)) if (w >= h && w > 1) w--; else h--;
      for (let b = j; b < j + h; b++) for (let a = i; a < i + w; a++) taken[b * cols + a] = 1;
      put(i, j, w, h);
    }
  };
  // The marks on some of the flagstones, drawn as `MARK` draws, each sized to its stone's inner radius `r`.
  const SCRAWLS = [
    (g, x, y, r, t, e) => daubHand(g, x, y - r * 0.42, r * 0.95, t, EARTH_RED, e),
    (g, x, y, r, t, e) => daubSpiral(g, x, y, r * 0.48, r * 0.09, EARTH_OCHRE, e),
    (g, x, y, r, t, e) => MARK.banana(g, x, y, r * 1.4, t, EARTH_OCHRE, e),
    (g, x, y, r, t) => MARK.foot(g, x, y, r * 1.05, t, EARTH_BLACK, 0),
    (g, x, y, r, t, e) => MARK.coconut(g, x, y, r, "#9a7040", e),
    (g, x, y, r, t, e) => daubZigzag(g, x - r * 0.6, x + r * 0.6, y, r * 0.18, 3, r * 0.12, EARTH_CHALK, e),
    (g, x, y, r, t) => daubHand(g, x, y - r * 0.42, r * 0.95, t, EARTH_BLACK, 0)
  ];
  // The paint worn thin on a painting `w` by `h` round its middle: wherever a jittered sample every 14 cm lands on one
  // of its big fills (a face of 3 dm² or more: bodies, palms, canopies, not limbs, fingers or strokes) inside the
  // panel's few worn patches (a slow field of two crossed sines, its phase the panel's own), a thin dry-brush stroke
  // half the fill's colour and half the stone's, all laid one way per panel give or take a little and glowing `e`
  // as dimly as the paint round it, so the fills come out rubbed and ragged at their edges rather than spotted. The
  // fills are binned by where they reach, a quarter metre a bin, so each sample tests only its own bin's.
  const speckle = (art, w, h, rand, e) => {
    const v = art.verts, B = 0.25, cols = Math.ceil(w / B) + 1, rows = Math.ceil(h / B) + 1, bins = Array.from({ length: cols * rows }, () => []);
    const col = (x) => Math.min(cols - 1, Math.max(0, Math.floor((x + w / 2) / B))), row = (y) => Math.min(rows - 1, Math.max(0, Math.floor((y + h / 2) / B)));
    for (const f of art.faces) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, area = 0;
      f.i.forEach((i, k) => {
        const j = f.i[(k + 1) % f.i.length];
        area += v[i * 3] * v[j * 3 + 1] - v[j * 3] * v[i * 3 + 1];
        x0 = Math.min(x0, v[i * 3]); x1 = Math.max(x1, v[i * 3]); y0 = Math.min(y0, v[i * 3 + 1]); y1 = Math.max(y1, v[i * 3 + 1]);
      });
      if (Math.abs(area) < 0.06) continue;
      for (let b = row(y0); b <= row(y1); b++) for (let a = col(x0); a <= col(x1); a++) bins[b * cols + a].push(f);
    }
    // Inside a convex face of either winding: the point on the same side of every edge.
    const inside = (f, x, y) => {
      let side = 0;
      for (let k = 0; k < f.i.length; k++) {
        const a = f.i[k] * 3, b = f.i[(k + 1) % f.i.length] * 3, c = (v[b] - v[a]) * (y - v[a + 1]) - (v[b + 1] - v[a + 1]) * (x - v[a]);
        if (c * side < 0) return false;
        if (c) side = c;
      }
      return true;
    };
    const a = rand() * 6.3, b = rand() * 6.3, brush = rand() * Math.PI;
    for (let y = 0.07 - h / 2; y < h / 2; y += 0.14) for (let x = 0.07 - w / 2; x < w / 2; x += 0.14) {
      const px = x + (rand() - 0.5) * 0.12, py = y + (rand() - 0.5) * 0.12, s = (0.014 + rand() * 0.028) * (rand() < 0.15 ? 2.2 : 1), tone = hexToRgb(rand() < 0.5 ? "#4b3f36" : "#5e5048"), turn = brush + (rand() - 0.5) * 0.5;
      if (Math.sin(px * 2.3 + a) * Math.sin(py * 1.9 + b) <= 0.2) continue;
      const hit = bins[row(py) * cols + col(px)].find((f) => inside(f, px, py));
      if (hit) daubDot(art, px, py, s * 1.3, s * 0.35, `#${hit.color.map((v, k) => Math.round((v + tone[k]) / 2).toString(16).padStart(2, "0")).join("")}`, e * 0.4, turn, 0.02, 6);
    }
    return art;
  };
  // A bamboo cane from a to b, the kit's with its nodes twice as far apart, so a long rail or bar stays cheap.
  const bambooRun = (ax, ay, az, bx, by, bz, r, tone) => {
    const len = Math.hypot(bx - ax, by - ay, bz - az), geo = BL.hubModels.bamboo(0, 0, 0, 0, len / 2, 0, r, tone);
    for (let i = 1; i < geo.verts.length; i += 3) geo.verts[i] *= 2;
    return along(geo, ax, ay, az, bx - ax, by - ay, bz - az);
  };
  // A half log lying level from (ax, az) to (bx, bz), radius r, split along its axis with its flat face up at `y`: a
  // log as the kit turns one (bark swelling a little at its middle over chamfered ends, pale end grain) in eight
  // segments, everything above its axis pressed down onto it, so the round bark and the end grain stay under a face of
  // split wood streaked along the grain. A round part, for treads and decks.
  const SPLIT = ["#b8895a", "#a67a4c"].map(hexToRgb), END_GRAIN = hexToRgb("#c9a06a");
  const halfLog = (ax, y, az, bx, bz, r, bark) => {
    const len = Math.hypot(bx - ax, bz - az), e = Math.min(r * 0.18, len * 0.2), grain = hexToRgb(tint(bark, 0.88));
    const geo = along(lathe({ profile: [[0, 0], [r * 0.84, 0], [r * 0.84, 0], [r, e], [r * 1.03, len / 2], [r, len - e], [r * 0.84, len], [r * 0.84, len], [0, len]], segments: 8, color: bark }), ax, 0, az, bx - ax, 0, bz - az), v = geo.verts;
    for (let i = 1; i < v.length; i += 3) v[i] = Math.min(0, v[i]);
    geo.faces.forEach((f, k) => {
      const band = Math.floor(k / 8);
      if (band === 0 || band === 7) f.color = END_GRAIN;
      else if (f.i.every((j) => v[j * 3 + 1] > -1e-6)) f.color = SPLIT[k % 2];
      else if (k % 2) f.color = grain;
    });
    return moved(geo, 0, y, 0);
  };
  // The side walls' trunks, [side, z at the foot]: one wherever a torch (`POST_TORCHES`) or a creeper stands on it,
  // none at a pitch or behind a machine, painting or poster, the back pair up through the mezzanine's deck between its
  // wall posts; each `BOWS` [how far its head leans along the wall, its bow, its thickness], so `trunkAt(k, y)` is the
  // middle of trunk k at height y. Then the roots arcing out of the rock that hold the swags between the trunks,
  // [side, z]. Every one keeps its bark off the walkers' side face (`SIDE_FACE` in the scene): trunks lean along the
  // wall, never out of it.
  const POSTS = [[-1, -22.4], [-1, -11.3], [-1, 2.3], [-1, -1.1], [1, -22.4], [1, -11.3], [1, -8.5], [1, -4.5], [1, -1.1]];
  const BOWS = [[0.3, 0.03, 0.18], [-0.24, 0.04, 0.17], [0.34, -0.03, 0.185], [-0.3, 0.025, 0.175], [-0.26, -0.04, 0.18], [0.32, 0.03, 0.185], [-0.2, -0.03, 0.17], [0.28, 0.04, 0.18], [-0.34, 0.03, 0.185]];
  const HOOKS = [[-1, -18.2], [-1, -14.6], [-1, -7.6], [-1, -4.2], [-1, 5.6], [1, -17.9], [1, -14.8], [1, 2.2], [1, 5.6]];
  const trunkAt = (k, y) => { const [s, z] = POSTS[k], [lean, bow] = BOWS[k], t = y / HALL.h; return [s * (HALL.halfW - 0.3), y, z + lean * t * t + bow * Math.sin(t * Math.PI)]; };
  // The side walls' vines: [side, z, lowest y] for each curtain (down to the palisade, or ending above the stairs,
  // the mezzanine's deck or a planter), [side, z, from y] for each trunk a vine climbs, [side, z] where leaves peek
  // over the palisade. Each keeps clear of the posters, zone signs, dart boards, speakers, paintings, the shy and the
  // hoops.
  const CURTAINS = [[-1, -11.9, 1.45], [-1, -16.4, 4.3], [-1, -20.3, 4.6], [1, -11.9, 1.45], [1, -17.1, 4.3], [1, -20.3, 4.6]];
  const CREEPERS = [[-1, 2.3, 0.2], [1, -8.5, 0.2], [1, -1.1, 0.2], [-1, -22.4, MEZZ.y], [1, -22.4, MEZZ.y]], PEEKS = [[-1, -19.6], [1, -19.6], [1, 0.45]];
  const hall = cached(() => {
    const rand = mulberry32(3303), timber = [], OUT = HALL.front + 4;
    const W = HALL.halfW * 2, D = HALL.front - HALL.back, WAIN = 1.3;
    // The packed earth, on out through the tunnel. Its painted skins are drawn on the xy plane (y there is -z in the
    // hall) and `laid` flat `y` up: darker earth in big soft patches, each tone its own height, more sand and grit
    // where no flagstones cover it, a scatter of pebbles there, and a teal glow under each cluster of mushrooms or
    // crystals, all under the flagstones' feet.
    const parts = [
      box({ w: W, h: 0.1, d: D, color: EARTH[0], emissive: 0.03, offset: { y: -0.05, z: (HALL.front + HALL.back) / 2 } }),
      box({ w: HALL.door * 2 + 1, h: 0.1, d: OUT - HALL.front, color: EARTH[0], emissive: 0.03, offset: { y: -0.05, z: (HALL.front + OUT) / 2 } })
    ];
    const laid = (g, y) => parts.push(moved(turnedX(g, -Math.PI / 2), 0, y, 0));
    const onWalk = (x, z) => WALKS.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
    const frand = mulberry32(3310), soil = geometry(), grit = geometry(), pebbles = geometry();
    const blot = (x, y, r, color, z) => {
      const pts = [];
      for (let j = 0; j < 11; j++) { const t = j / 11 * Math.PI * 2; pts.push([x + Math.cos(t) * r * (0.8 + frand() * 0.2), y + Math.sin(t) * r * (0.6 + frand() * 0.15)]); }
      daubPoly(soil, pts, color, 0.03, z);
    };
    for (let k = 0; k < 42; k++) blot((frand() - 0.5) * (W - 1.5), -(HALL.back + 0.8 + frand() * (D - 1.6)), 0.9 + frand() * 1.5, EARTH[1 + k % 3], 0.0008 * (1 + k % 3));
    for (let k = 0, n = 0; k < 80 && n < 24; k++) {
      const x = (frand() - 0.5) * (W - 2), z = HALL.back + 1 + frand() * (D - 2), r = 0.5 + frand() * 0.9;
      if (onWalk(x, z) || Math.hypot(x - STAGE.x, z - STAGE.z) < STAGE.r + 2.3) continue;
      blot(x, -z, r, SAND[n % 2], 0.0031 + (n % 2) * 0.0006);
      n++;
    }
    for (let k = 0; k < 930; k++) {
      const x = (frand() - 0.5) * (W - 0.6), z = HALL.back + 0.3 + frand() * (D - 0.6), r = 0.025 + frand() * 0.045, a = frand() * 6.3;
      if (onWalk(x, z)) continue;
      daubPoly(grit, [0, 2.1, 4.2].map((t) => [x + Math.cos(a + t) * r, -z + Math.sin(a + t) * r]), k % 3 ? "#9c8060" : "#3c2a1c", 0.03, 0.0048);
    }
    for (let k = 0, n = 0; k < 210 && n < 72; k++) {
      const x = (frand() - 0.5) * (W - 1.4), z = HALL.back + 0.7 + frand() * (D - 1.4), r = 0.06 + frand() * 0.1, a = frand() * 6.3;
      if (onWalk(x, z) || Math.hypot(x - STAGE.x, z - STAGE.z) < STAGE.r + 2.4) continue;
      flagstone(pebbles, Array.from({ length: 6 }, (_, j) => [x + Math.cos(a + j * 1.05) * r * (0.85 + frand() * 0.15), z + Math.sin(a + j * 1.05) * r * (0.7 + frand() * 0.15)]), FLAGS[n % 4], 0.012 + r * 0.12);
      n++;
    }
    parts.push(pebbles);
    for (const [wall, s, what] of FOOT) if (/shroom|crystal/.test(what)) {
      const [x, , z] = onWall(wall, s, 0, 0.3), { r } = WALLS[wall];
      daubDot(grit, x, -z, 0.3 + Math.abs(r[0]) * 0.35, 0.3 + Math.abs(r[2]) * 0.35, "#2e6e66", 0.25, 0, 0.0043, 12);
    }
    laid(soil, 0);
    laid(grit, 0);
    // The flagstones: seeds on a jittered grid wherever a walk runs, two courses round the stage cut at its foot by
    // unseen seeds under it, and unseen seeds round the medallion and the jackpot wheel's footing so the paving stops
    // at their kerbs. About one stone in five carries a mark, but no coconut lies where the skee-ball lanes' or the air
    // hockey tables' players look (`VIEWS`: [frame, the eye's z and the far z in it, as the games' cameras see the
    // floor]).
    const prand = mulberry32(3320), seeds = [], stones = geometry(), marks = geometry();
    const fx = LAYOUT.wheel.x, fz = LAYOUT.wheel.z + WHEEL_FOOT.z, offFoot = (x, z) => Math.hypot(x - fx, z - fz) > WHEEL_FOOT.r + 0.35;
    const VIEWS = [...LAYOUT.skee.map((p) => [p, 2.3, -16]), ...LAYOUT.frames.hockey.map((p) => [p, 0.55, -8])];
    const inView = (x, z) => VIEWS.some(([p, eye, far]) => {
      const dx = x - p.x, dz = z - p.z, c = Math.cos(p.turn), s = Math.sin(p.turn), lx = dx * c - dz * s, lz = dx * s + dz * c;
      return lz < eye && lz > far && Math.abs(lx) < eye - lz + 0.8;
    });
    for (let z = HALL.back + 0.5; z < OUT; z += 1.1) for (let x = -HALL.halfW + 0.5; x < HALL.halfW; x += 1.1) {
      const sx = x + (prand() - 0.5) * 0.5, sz = z + (prand() - 0.5) * 0.5;
      if (onWalk(sx, sz) && Math.hypot(sx - STAGE.x, sz - STAGE.z) > STAGE.r + 2.5 && Math.hypot(sx, sz - MEDALLION.z) > MEDALLION.r + 0.45 && offFoot(sx, sz)) seeds.push([sx, sz, true]);
    }
    for (const [r, n, real] of [[STAGE.r - 0.45, 30, false], [STAGE.r + 0.6, 30, true], [STAGE.r + 1.7, 37, true]]) for (let k = 0; k < n; k++) {
      const a = (k + (real ? (prand() - 0.5) * 0.3 : 0)) / n * Math.PI * 2, x = STAGE.x + Math.cos(a) * r, z = STAGE.z + Math.sin(a) * r;
      seeds.push([x, z, real && offFoot(x, z)]);
    }
    for (let k = 0; k < 28; k++) { const a = k / 28 * Math.PI * 2; seeds.push([Math.cos(a) * (MEDALLION.r - 0.42), MEDALLION.z + Math.sin(a) * (MEDALLION.r - 0.42), false]); }
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; seeds.push([fx + Math.cos(a) * (WHEEL_FOOT.r - 0.3), fz + Math.sin(a) * (WHEEL_FOOT.r - 0.3), false]); }
    paving(seeds, 0.78).forEach(({ poly, x, z, r }, k) => {
      flagstone(stones, poly, FLAGS[Math.floor(prand() * FLAGS.length)], FLAG_Y);
      if (prand() < 0.22 && (k % SCRAWLS.length !== 4 || !inView(x, z))) SCRAWLS[k % SCRAWLS.length](marks, x, -z, r, (prand() - 0.5) * 1.2, 0.1);
    });
    laid(marks, FLAG_Y + 0.001);
    // The medallion: OOGA laid in river pebbles on a disc of packed earth, the carved signs' blocky letters a pebble to
    // each cell a fifth of a metre across, each pebble a rounded stone of seven to nine sides set a little off its
    // cell, turned its own way, a darker rim round its pale top, in bone and pale ochre; a few dark pebbles pressed
    // into the earth round them; and a kerb of eighteen bevelled stones round it all.
    const MZ = MEDALLION.z, IN = MEDALLION.r - 0.28, CELL = 0.19, trand = mulberry32(3330), earth = geometry();
    const letter = (col, row) => col >= 0 && col < 15 && row >= 0 && row < 5 && col % 4 < 3 && BL.hubModels.SIGN_GLYPHS["OOGA"[col >> 2]][row][col % 4] === "1";
    const pebble = (x, z, r, tone, e) => {
      const n = 7 + Math.floor(trand() * 3), turn = trand() * 3, squash = 0.78 + trand() * 0.18;
      daubDot(earth, x, -z, r, r * squash, tint(tone, 0.68), e * 0.5, turn, 0.0012, n);
      daubDot(earth, x - r * 0.06, -z + r * 0.06, r * 0.8, r * squash * 0.78, tone, e, turn, 0.0024, n);
    };
    daubDot(earth, 0, -MZ, IN + 0.03, IN + 0.03, EARTH[3], 0.03, 0, 0, 36);
    for (let row = 0; row < 5; row++) for (let col = 0; col < 15; col++) if (letter(col, row)) {
      pebble((col - 7) * CELL + (trand() - 0.5) * 0.04, MZ + (row - 2) * CELL + (trand() - 0.5) * 0.04, 0.088 + trand() * 0.018, trand() < 0.6 ? BONE : "#e8c890", 0.2);
    }
    for (let k = 0, n = 0; k < 120 && n < 26; k++) {
      const a = trand() * Math.PI * 2, d = Math.sqrt(trand()) * (IN - 0.12), x = Math.cos(a) * d, z = Math.sin(a) * d, col = Math.round(x / CELL + 7), row = Math.round(z / CELL + 2);
      if ([-1, 0, 1].some((dc) => [-1, 0, 1].some((dr) => letter(col + dc, row + dr)))) continue;
      pebble(x, MZ + z, 0.035 + trand() * 0.025, FLAGS[3 - (n % 2) * 2], 0.03);
      n++;
    }
    laid(earth, 0.0046);
    for (let k = 0; k < 18; k++) {
      const at2 = (t, r) => [Math.cos(t) * r, MZ + Math.sin(t) * r], a0 = (k + 0.03) / 18 * Math.PI * 2, a1 = (k + 0.97) / 18 * Math.PI * 2;
      flagstone(stones, [at2(a0, MEDALLION.r), at2((a0 + a1) / 2, MEDALLION.r), at2(a1, MEDALLION.r), at2(a1, IN + 0.04), at2(a0, IN + 0.04)], FLAGS[k % 2 ? 1 : 2], FLAG_Y + 0.001);
    }
    parts.push(stones);
    // The reed mats, woven in a twill: rows of reeds `ROW` wide along each mat, every row passing over two cross
    // strands and under the next two, a strand further along than the row before, so the weave runs in diagonals;
    // where a row dips under, the cross strands show over it. The rows in the three reed tones, the cross strands a
    // shade darker, a thin dark backing between them; a binding down each long side and a ragged fringe of loose ends.
    const mats = geometry(), mrand = mulberry32(3360), ROW = 0.1, PICK = 0.11;
    MATS.forEach(([x0, x1, z0, z1], m) => {
      const long = x1 - x0 >= z1 - z0, P = (l, w) => long ? [l, -w] : [w, -l], [l0, l1, w0, w1] = long ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
      const band = (a, b, c, d, color, z) => daubPoly(mats, [P(a, c), P(b, c), P(b, d), P(a, d)], color, 0.03, z);
      band(l0, l1, w0, w1, "#6e5228", 0);
      const rows = Math.floor((w1 - w0 - 0.06) / ROW), cols = Math.floor((l1 - l0 - 0.02) / PICK), wa = (w0 + w1 - rows * ROW) / 2, la = (l0 + l1 - cols * PICK) / 2;
      for (let j = 0; j < rows; j++) {
        const w = wa + j * ROW, tone = REEDS[(j + m) % 3];
        for (let i = 0; i < cols; i++) {
          const l = la + i * PICK;
          const q = (i + j + m) % 4;
          if (q < 2) { if (q === 0 || i === 0) band(l + 0.006, la + Math.min(cols, i + 2 - q) * PICK - 0.006, w + 0.008, w + ROW - 0.008, tone, 0.001); }
          else band(l + 0.014, l + PICK - 0.014, w + 0.004, w + ROW - 0.004, tint(REEDS[(i + m) % 3], 0.86), 0.001);
        }
      }
      for (const w of [w0, w1 - 0.035]) band(l0, l1, w, w + 0.035, "#9a7a42", 0.002);
      for (const [l, s] of [[l0, -1], [l1, 1]]) for (let w = w0 + 0.04; w < w1 - 0.03; w += 0.04 + mrand() * 0.03) {
        const len = 0.05 + mrand() * 0.09, lean = (mrand() - 0.5) * 0.05, half = 0.012 + mrand() * 0.01;
        daubPoly(mats, [P(l + s * 0.01, w - half), P(l + s * len, w + lean), P(l + s * 0.01, w + half)], REEDS[Math.floor(mrand() * 3)], 0.03, 0.001);
      }
    });
    laid(mats, MAT_Y);
    // The hides, fur up along their turn: the leopard and the tiger from the hide kit, and the mammoth's pelt.
    RUGS.forEach(([kind, x, z, L, Wd, turnA], k) => {
      const pelt = kind === "mammoth" ? mammothPelt(L, Wd, 3341) : hide(L, Wd, kind, 3342 + k);
      parts.push(moved(turnedY(turnedX(pelt, -Math.PI / 2), turnA), x, HIDE_Y, z));
    });
    // A trail of Ooga footprints in charcoal, in from the tunnel toward the medallion.
    const steps = geometry();
    for (let k = 0; k < 9; k++) MARK.foot(steps, 0.45 + (k % 2 ? 0.17 : -0.17), k * 0.6 - 9.3, 0.3, k % 2 ? 0.08 : -0.08, EARTH_BLACK, 0);
    laid(steps, FLAG_Y + 0.0015);
    const floor = merge(...parts);
    // The walls, then the ceiling: rock cells a metre square laid in blocks of one, two, four or six (bigger
    // overhead), each set back up to a fifth of a metre, turned and tipped a little and bulging at its middle, none
    // standing further into the hall than the back wall's walkers stop (`BACK_FACE` in the scene); one flush block of
    // one tone under each painting, and nothing where the doorway opens. The front and back walls' end blocks run on
    // into the corners. `relief` keeps how far the rock stands into the hall at each cell's middle, so what grows on
    // it hugs it. Then the paintings, each drawn round its panel's middle and stood on its wall a hair proud of it.
    const crag = geometry(), relief = new Map(), cellOf = (wall, s, y) => `${wall}${Math.floor(s)}:${Math.floor(y)}`, reliefAt = (wall, s, y) => relief.get(cellOf(wall, s, y)) || 0;
    for (const wall of ["B", "F", "L", "R"]) {
      const { r, n } = WALLS[wall], side = wall === "L" || wall === "R", s0 = side ? HALL.back : -HALL.halfW, cols = side ? D : W;
      const painted = (i, j) => PAINTINGS.some(([w, a0, a1, y0, y1]) => w === wall && s0 + i + 0.5 > a0 && s0 + i + 0.5 < a1 && j + 0.5 > y0 && j + 0.5 < y1);
      const door = (i, j) => wall === "F" && Math.abs(s0 + i + 0.5) < HALL.door && j < HALL.doorH;
      layBlocks(cols, HALL.h, WALL_BLOCKS, rand, (i, j) => !painted(i, j) && !door(i, j), (i, j, w, h) => {
        const out = -rand() * 0.22, bulge = Math.min(w, h) > 1 ? 0.14 : 0.1, c = 0.18, turn = (rand() - 0.5) * 0.08, cs = Math.cos(turn), sn = Math.sin(turn), ta = (rand() - 0.5) * 0.08, tb = (rand() - 0.5) * 0.08;
        const ends = side ? 0 : (i ? 0 : -0.35) + (i + w < cols ? 0 : 0.35);
        stone(crag, onWall(wall, s0 + i + w / 2 + ends / 2, j + h / 2, out), r.map((v, k) => v * cs + UP[k] * sn + n[k] * ta), UP.map((v, k) => v * cs - r[k] * sn + n[k] * tb), n, w + Math.abs(ends) + LAP, h + LAP, 0.9, c, bulge, STONE[Math.floor(rand() * 3)]);
        for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) {
          const du = Math.abs(a + 0.5 - w / 2) / (w / 2 - c), dv = Math.abs(b + 0.5 - h / 2) / (h / 2 - c);
          relief.set(cellOf(wall, s0 + i + a, j + b), out + 0.04 + bulge * Math.max(0, 1 - Math.max(du, dv)));
        }
      });
    }
    // Paint on rock catches the firelight rather than giving it: the earth colours glow a little, chalk least, the
    // mammoth hunt (the first, the hero) a little more, and every fill is worn thin in patches (`speckle`).
    const flat = [], chalk = hexToRgb(EARTH_CHALK).join();
    PAINTINGS.forEach(([wall, a0, a1, y0, y1, paint], i) => {
      const art = geometry(), { r, n } = WALLS[wall], e = i ? 0.16 : 0.26;
      stone(crag, onWall(wall, (a0 + a1) / 2, (y0 + y1) / 2, 0), r, UP, n, a1 - a0, y1 - y0, 0.9, 0.08, 0, "#4b3f36");
      paint(art, e);
      for (const f of art.faces) if (f.emissive && f.color.join() === chalk) f.emissive = Math.min(f.emissive, e * 0.75);
      speckle(art, a1 - a0, y1 - y0, mulberry32(707 + i), e);
      flat.push(moved(turnedY(art, TO_WALL[wall]), ...onWall(wall, (a0 + a1) / 2, (y0 + y1) / 2, 0.012)));
    });
    layBlocks(W + 1, D + 1, CEILING_BLOCKS, rand, () => true, (i, j, w, h) => {
      const turn = (rand() - 0.5) * 0.1, cs = Math.cos(turn), sn = Math.sin(turn);
      stone(crag, [i + w / 2 - HALL.halfW - 0.5, HALL.h - rand() * 0.06, j + h / 2 + HALL.back - 0.5], [cs, (rand() - 0.5) * 0.06, sn], [-sn, (rand() - 0.5) * 0.06, cs], [0, -1, 0], w + LAP, h + LAP, 0.5, 0.22, 0.1 + rand() * 0.08, CEILING[Math.floor(rand() * 3)]);
    });
    // The trunks (`POSTS`): each a bark log from the floor up into the rock, tapering as it climbs and bowed along the
    // wall as `trunkAt` runs, bound in rope over the palisade, a stub or two of branch sawn off it well over head
    // height, clear of the torches' brackets; its fork into the rock is grown below.
    const J = BL.hubModels, stub = mulberry32(3306);
    POSTS.forEach(([s], k) => {
      const r = BOWS[k][2], trunk = J.log(0, -0.02, 0, 0, HALL.h + 0.05, 0, r, "#5a3c22"), v = trunk.verts, [lx, , lz] = trunkAt(k, 1.66);
      for (let i = 0; i < v.length; i += 3) {
        const [x0, , z0] = trunkAt(k, v[i + 1]), f = 1 - 0.2 * Math.max(0, v[i + 1]) / HALL.h;
        v[i] = x0 + v[i] * f;
        v[i + 2] = z0 + v[i + 2] * f;
      }
      timber.push(trunk, J.lashing(lx, 1.66, lz, 0, 1, 0, r));
      for (let j = 0; j <= k % 2; j++) {
        const y = 4.4 + j * 1.9 + stub() * 1.1, [x, , z] = trunkAt(k, y), dz = (stub() - 0.5) * 1.2, l = 0.3 + stub() * 0.14;
        timber.push(J.log(x, y, z, x - s * l * 0.8, y + l * 0.55, z + dz * l, 0.07, "#5a3c22"));
      }
    });
    const block = (x, y, z, w, d) => flat.push(box({ w, h: 1, d, color: STONE[Math.floor(rand() * 3)], offset: { x, y: y + 0.5, z } }));
    // The way out: a short rock tunnel past the doorway, two timber sets across it (bark log posts under a log lintel
    // bound to them with rope), the flagstones on under them, and the jungle outside at its far end.
    for (let z = HALL.front + 0.5; z < OUT; z++) {
      for (let y = 0; y < HALL.doorH + 1; y++) for (const s of [-1, 1]) block(s * (HALL.door + 0.5), y, z, 1, 1);
      block(0, HALL.doorH, z, HALL.door * 2, 1);
    }
    for (const z of [HALL.front + 0.8, HALL.front + 2.6]) {
      for (const s of [-1, 1]) {
        timber.push(J.log(s * (HALL.door - 0.19), -0.02, z, s * (HALL.door - 0.17), HALL.doorH - 0.1, z, 0.16, "#5a3c22"));
        timber.push(J.lashing(s * (HALL.door - 0.18), HALL.doorH - 0.4, z, 0, 1, 0, 0.16), J.lashing(s * (HALL.door - 0.18), HALL.doorH - 0.145, z, 1, 0, 0, 0.17));
      }
      timber.push(J.log(-HALL.door - 0.35, HALL.doorH - 0.13, z, HALL.door + 0.35, HALL.doorH - 0.16, z, 0.17, "#5c3f25"));
    }
    // The jungle out past the tunnel, painted as the day looks from inside the cave: a warm sky paling down to the
    // glow over the horizon in bands, a far line of treetops, a palm leaning in from one side with its fronds hanging
    // and big leaves at the foot of the view, all dark against the light. Drawn on the xy plane, turned to face the
    // hall at the tunnel's end.
    const view = geometry(), vw = HALL.door, vh = HALL.doorH, SKY = ["#e6cf98", "#f7e0aa", "#f0d6a0", "#e2cc9c", "#d0c49c", "#bab89a"];
    SKY.forEach((c, k) => daubPoly(view, [[-vw, vh * k / 6], [vw, vh * k / 6], [vw, vh * (k + 1) / 6], [-vw, vh * (k + 1) / 6]], c, 0.8 - k * 0.05));
    daubPoly(view, [[-vw, 0], [vw, 0], [vw, 0.95], [-vw, 0.95]], "#4e6238", 0.3, 0.01);
    for (let k = 0; k < 9; k++) daubDot(view, -vw + k * vw / 4 + ((k * 7) % 3 - 1) * 0.12, 0.95 + (k % 3) * 0.08, 0.34 + (k * 5 % 4) * 0.06, 0.26 + (k * 3 % 4) * 0.05, k % 2 ? "#4e6238" : "#456034", 0.3, 0, 0.01, 12);
    const palm = (x, lean, h, s) => {
      const top = [x + lean, h];
      daubTaper(view, Array.from({ length: 7 }, (_, k) => { const t = k / 6; return [x + lean * t * t, h * t]; }), (t) => (0.2 - 0.08 * t) * s, "#35291c", 0.18, 0.02);
      for (let k = 0; k < 7; k++) {
        const a = -0.4 + k * 0.62 + (k % 2) * 0.12, len = (0.95 + (k % 3) * 0.2) * s, pts = [];
        for (let j = 0; j <= 6; j++) { const t = j / 6; pts.push([top[0] + Math.cos(a) * len * t, top[1] + Math.sin(a) * len * t * 0.5 - len * 0.55 * t * t]); }
        daubTaper(view, pts, (t) => 0.2 * s * Math.sin(Math.PI * Math.min(1, t * 1.1)) ** 0.7, k % 2 ? "#243c1c" : "#2c4620", 0.2, 0.025 + k * 0.0005);
      }
    };
    palm(1.5, -0.8, 3.05, 1);
    palm(-1.9, 0.35, 2.25, 0.7);
    for (const [x, a, len, w] of [[-2.6, 0.9, 1.5, 0.42], [-2.2, 1.25, 1.1, 0.34], [2.6, 2.3, 1.4, 0.4], [2.1, 1.95, 1.0, 0.32], [0.3, 1.45, 0.8, 0.3]]) {
      const pts = Array.from({ length: 7 }, (_, j) => { const t = j / 6; return [x + Math.cos(a) * len * t, Math.sin(a) * len * t - len * 0.25 * t * t]; });
      daubTaper(view, pts, (t) => w * Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.6, "#1e3218", 0.14, 0.03);
    }
    const outside = unshadowed(moved(turnedY(view, Math.PI), 0, 0, OUT - 0.02));
    // The jungle, grown into the timber's own mesh. The swags run `X` either side of the hall's middle and `TIE` high
    // from anchor to anchor along each side wall, a trunk where it passes `TIE` or a root out of the rock (`HOOKS`),
    // dipping `SAG` of each span between them; a curtain starts on the swag above it and eases back to the wall as it
    // falls.
    const { withJungle, liana, sagPoints, sprig, garland, puff, flatInto } = BL.hubModels, leaf = mulberry32(3304), X = HALL.halfW - 0.55, TIE = HALL.h - 1.5, SAG = 0.22;
    const anchors = [-1, 1].map((s) => {
      const out = [], add = (z) => { const i = out.findIndex((q) => q > z); out.splice(i < 0 ? out.length : i, 0, z); };
      POSTS.forEach(([ps], k) => { if (ps === s) add(trunkAt(k, TIE)[2]); });
      for (const [hs, z] of HOOKS) if (hs === s) add(z);
      return out;
    });
    const swagAt = (s, z) => {
      const a = anchors[(s + 1) / 2];
      let k = 0;
      while (k < a.length - 2 && z > a[k + 1]) k++;
      const span = a[k + 1] - a[k];
      return TIE - Math.sin(Math.min(1, Math.max(0, (z - a[k]) / span)) * Math.PI) * SAG * span;
    };
    const timberJungle = withJungle(shaded(timber), (g) => {
      for (const s of [-1, 1]) {
        const a = anchors[(s + 1) / 2], swag = [];
        for (let k = 0; k + 1 < a.length; k++) swag.push(...sagPoints(s * X, TIE, a[k], s * X, TIE, a[k + 1], SAG * (a[k + 1] - a[k])).slice(k ? 1 : 0));
        garland(g, swag, { r: 0.045, every: 0.5, size: 0.3, droop: 0.65, out: [-s, 0, 0], rand: leaf });
      }
      // Each trunk forks at its head: a limb bends up and out from it into the ceiling's rock, away from its lean, and
      // a vine climbs from the swag up the limb, its leaves bunched where the limb goes into the rock.
      POSTS.forEach(([s], k) => {
        const [x0, y0, z0] = trunkAt(k, HALL.h - 2.5), zt = trunkAt(k, TIE)[2], fz = BOWS[k][0] > 0 ? -0.45 : 0.45;
        liana(g, [[x0, y0, z0], [s * (HALL.halfW - 0.75), HALL.h - 1.2, z0 + fz * 0.45], [s * (HALL.halfW - 1.35), HALL.h + 0.1, z0 + fz]], 0.12, 0.085, "#5c3f25");
        liana(g, [[s * X, TIE, zt + 0.1], [s * (HALL.halfW - 0.95), TIE + 0.45, z0 + fz * 0.45 + 0.1], [s * (HALL.halfW - 1.3), HALL.h - 0.3, z0 + fz * 0.9 + 0.1]], 0.035, 0.025);
        sprig(g, s * (HALL.halfW - 1.3), HALL.h - 0.28, z0 + fz * 0.9 + 0.1, -s, -0.6, 0.3, 4, 0.34, leaf);
        sprig(g, s * X, TIE, zt + 0.1, -s * 0.5, -1, 0.2, 2, 0.3, leaf);
      });
      // The roots that hold the swags between the trunks, each arcing out of the side wall's rock above the swag and
      // down to it, leaves where it leaves the rock and where the swag hangs on it.
      for (const [s, z] of HOOKS) {
        liana(g, [[s * (HALL.halfW + 0.05), TIE + 1.1, z - 0.1], [s * (HALL.halfW - 0.2), TIE + 0.72, z - 0.02], [s * (HALL.halfW - 0.42), TIE + 0.28, z + 0.03], [s * X, TIE - 0.06, z]], 0.1, 0.045, "#7a5232");
        sprig(g, s * (HALL.halfW - 0.12), TIE + 0.95, z - 0.08, -s, 0.2, 0, 3, 0.26, leaf);
        sprig(g, s * X, TIE - 0.04, z, -s * 0.5, -1, 0.2, 2, 0.3, leaf);
      }
      // Each curtain is a long strand to its lowest point and a shorter one beside it ending in a leaf tip; one that
      // reaches the palisade has big leaves peeking over it at its foot.
      for (const [s, z, low] of CURTAINS) {
        for (const [dz, reach] of [[0, 1], [0.28, 0.5]]) {
          const top = swagAt(s, z + dz), bottom = top - (top - low) * reach, n = Math.max(2, Math.round((top - bottom) / 0.7)), pts = [];
          for (let k = 0; k <= n; k++) {
            const t = k / n;
            pts.push([s * (X + (HALL.halfW - 0.34 - X) * t), top - (top - bottom) * t, z + dz + Math.sin(t * 5 + z) * 0.08 * t]);
          }
          garland(g, pts, { r: 0.03, every: 0.6, size: 0.26, droop: 0.45, out: [-s, 0, 0], rand: leaf });
          if (reach < 1) sprig(g, ...pts[n], 0, -1, 0, 3, 0.3, leaf);
        }
        if (low < WAIN + 0.3) sprig(g, s * (HALL.halfW - 0.24), WAIN + 0.14, z, -s * 0.35, 1, 0, 3, 0.42, leaf);
      }
      for (const [s, z] of PEEKS) sprig(g, s * (HALL.halfW - 0.24), WAIN + 0.14, z, -s * 0.35, 1, 0, 3, 0.42, leaf);
      // A creeper swings across its trunk's face from side to side as it climbs to the swag, following the trunk's bow,
      // a pair of leaves every metre and a half above head height.
      for (const [s, z, from] of CREEPERS) {
        const t = POSTS.findIndex(([ps, pz]) => ps === s && pz === z), n = Math.round((TIE - from) / 0.3), pts = [], mid = [];
        for (let k = 0; k <= n; k++) {
          const a = Math.sin(k * 1.26) * 1.35, y = from + (TIE - from) * k / n, [cx, , cz] = trunkAt(t, y);
          pts.push([cx - s * Math.cos(a) * 0.26, y, cz + Math.sin(a) * 0.26]);
          mid.push(cz);
        }
        liana(g, pts, 0.035, 0.025);
        for (let k = 3; k < n; k += 5) if (pts[k][1] > 2.4) sprig(g, ...pts[k], -s, 0.4, pts[k][2] - mid[k], 2, 0.28, leaf);
      }
      // The fringe of leaves hanging from the doorway's first timber set.
      garland(g, sagPoints(0.1 - HALL.door, HALL.doorH - 0.3, HALL.front + 0.62, HALL.door - 0.1, HALL.doorH - 0.3, HALL.front + 0.62, 0.12), { r: 0.03, every: 0.3, size: 0.26, droop: 0.8, out: [0, 0, -1], rand: leaf });
      // The palisade: split logs stood side by side round the side and front walls' foot, bark to the hall and shaded
      // round, each cut square or slanting a little above or below `WAIN` with its pale end grain on top; two ropes
      // bind it.
      const vtx = (x, y, z, nx, ny, nz) => { g.verts.push(x, y, z); g.normals.push(nx, ny, nz); return g.verts.length / 3 - 1; };
      const BARK = ["#6b4a2b", "#5c3f25", "#7a5533"].map(hexToRgb), GRAIN = hexToRgb("#c9a06a"), cut = mulberry32(3305);
      const stake = (cx, cz, tx, tz, nx, nz) => {
        const r = 0.1 + cut() * 0.025, h = WAIN - 0.12 + cut() * 0.26, slant = (cut() - 0.5) * 0.14, color = BARK[Math.floor(cut() * 3)], ring = [];
        for (let k = 0; k <= 4; k++) {
          const a = (k / 4 - 0.5) * Math.PI, ox = nx * Math.cos(a) + tx * Math.sin(a), oz = nz * Math.cos(a) + tz * Math.sin(a);
          ring.push([cx + ox * r, cz + oz * r, ox, oz, h + Math.sin(a) * slant]);
        }
        const lo = ring.map(([x, z, ox, oz]) => vtx(x, 0, z, ox, 0, oz)), hi = ring.map(([x, z, ox, oz, y]) => vtx(x, y, z, ox, 0, oz));
        for (let k = 0; k < 4; k++) g.faces.push({ i: facing(g, [lo[k], lo[k + 1], hi[k + 1], hi[k]], [ring[k][2] + ring[k + 1][2], 0, ring[k][3] + ring[k + 1][3]]), color, emissive: 0 });
        g.faces.push({ i: facing(g, ring.map(([x, z, , , y]) => vtx(x, y, z, 0, 1, 0)), UP), color: GRAIN, emissive: 0 });
      };
      for (const s of [-1, 1]) {
        for (let z = HALL.back + 0.1; z < HALL.front - 0.05; z += 0.2) stake(s * (HALL.halfW - 0.12), z, 0, 1, -s, 0);
        for (let x = HALL.door + 0.15; x < HALL.halfW - 0.15; x += 0.2) stake(s * x, HALL.front - 0.12, 1, 0, 0, -1);
        for (const y of [0.34, 1.02]) {
          liana(g, [[s * (HALL.halfW - 0.245), y, HALL.back + 0.1], [s * (HALL.halfW - 0.245), y, HALL.front - 0.25]], 0.022, 0.022, "#c9a36a");
          liana(g, [[s * (HALL.door + 0.05), y, HALL.front - 0.245], [s * (HALL.halfW - 0.25), y, HALL.front - 0.245]], 0.022, 0.022, "#c9a36a");
        }
      }
      // Roots down the rock from the ceiling, wandering a little as they go, a side root off each twice.
      for (const [wall, s0, low, seed] of ROOTS) {
        const rr = mulberry32(seed * 131), top = HALL.h - 0.1, n = Math.max(3, Math.round((top - low) / 0.5)), pts = [], R = WALLS[wall].r;
        let off = 0;
        for (let k = 0; k <= n; k++) {
          off = Math.max(-0.2, Math.min(0.2, off + (rr() - 0.5) * 0.24));
          const y = top - (top - low) * k / n;
          pts.push(onWall(wall, s0 + off, y, reliefAt(wall, s0 + off, y) + 0.05 + rr() * 0.03));
        }
        liana(g, pts, 0.085, 0.02, "#7a5232");
        for (const k of [Math.round(n * 0.3), Math.round(n * 0.6)]) {
          const side = rr() < 0.5 ? -1 : 1, [x, y, z] = pts[k];
          liana(g, [[x, y, z], [x + R[0] * side * 0.28, y - 0.45, z + R[2] * side * 0.28], [x + R[0] * side * 0.46, y - 1, z + R[2] * side * 0.46]], 0.045, 0.014, "#7a5232");
        }
      }
      // At the rock's foot (`FOOT`): a fern of arching two-tone fronds with notched edges, leaning along the wall;
      // glowing teal mushrooms; a mossy boulder with teal and blue crystals growing out of it; and a cushion of moss on
      // the ground.
      const FERN = ["#2f6b2c", "#3f8a34", "#56a43f", "#74bd52"].map(hexToRgb), MOSS = ["#3f6a2a", "#4f7f34", "#62953e", "#78a94a"].map(hexToRgb);
      const GILL = hexToRgb("#1e8a80"), RIM = hexToRgb("#9af7e8"), TIP = hexToRgb("#c8fbff"), grow = mulberry32(3350);
      const fern = (x, z, nx, nz, count, size) => {
        for (let k = 0; k < count; k++) {
          const side = (k / (count - 1) - 0.5) * 2.7 + (grow() - 0.5) * 0.25, cs = Math.cos(side), sn = Math.sin(side);
          const hx = -nz * sn + nx * cs, hz = nx * sn + nz * cs, L = size * (0.85 + grow() * 0.3), reach = L * (1 - 0.75 * cs);
          const ln = Math.hypot(hx * 0.3, 1), lx = hx * 0.3 / ln, ly = 1 / ln, lz = hz * 0.3 / ln, light = FERN[2 + (k & 1)], dark = FERN[1 + (k & 1)], mid = [], left = [], right = [];
          for (let i = 0; i <= 8; i++) {
            const t = i / 8, px = x + hx * reach * t, py = 0.03 + L * (1.45 * t - 1.1 * t * t), pz = z + hz * reach * t;
            const w = L * 0.22 * Math.pow(Math.sin(Math.PI * t), 0.8) * (i % 2 ? 1 : 0.55), drop = w * 0.3;
            mid.push(vtx(px, py, pz, lx, ly, lz));
            left.push(vtx(px - hz * w, py - drop, pz + hx * w, lx, ly, lz));
            right.push(vtx(px + hz * w, py - drop, pz - hx * w, lx, ly, lz));
          }
          for (let i = 0; i < 8; i++) {
            const a = [mid[i], left[i], left[i + 1], mid[i + 1]], b = [mid[i], mid[i + 1], right[i + 1], right[i]];
            g.faces.push({ i: a, color: light, emissive: 0 }, { i: a.slice().reverse(), color: light, emissive: 0 }, { i: b, color: dark, emissive: 0 }, { i: b.slice().reverse(), color: dark, emissive: 0 });
          }
        }
      };
      const shroom = (x, z, h, r, lx, lz) => {
        const cap = lathe({ profile: [[r * 0.2, h - r * 0.1], [r, h - r * 0.02], [r * 0.9, h + r * 0.34], [r * 0.56, h + r * 0.64], [0, h + r * 0.74]], segments: 8, color: "#46e6d2", emissive: 0.85 });
        cap.faces.forEach((f, k) => { if (k < 8) { f.color = GILL; f.emissive = 0.5; } else if (k < 16) f.color = RIM; });
        tuck(g, along(merge(turn([[r * 0.24, 0], [r * 0.18, h * 0.5], [r * 0.2, h - r * 0.06]], 6, "#d8efe0", 0.3), cap), x, 0, z, lx, 1, lz));
      };
      const crystal = (x, y, z, dx, dy, dz, len, r, tone) => {
        const c = lathe({ profile: [[r * 0.75, -0.08], [r, len * 0.7], [0, len]], segments: 6, color: tone, emissive: 0.75 });
        for (let k = 6; k < 12; k++) c.faces[k].color = TIP;
        flatInto(g, along(c, x, y, z, dx, dy, dz));
      };
      for (const [wall, s, what] of FOOT) {
        const { r, n } = WALLS[wall], logs = wall !== "B", out = logs ? 0.3 : 0.2, spot = (a, d) => onWall(wall, s + a, 0, out + d);
        if (what.includes("fern")) { const [x, , z] = spot(0, -0.04); fern(x, z, n[0], n[2], 7, 1); }
        // The hard ones keep within a third of a metre of the rock (the mushrooms' caps just over it, clear of the
        // palisade), where no walker's torso reaches.
        if (what.includes("shroom")) for (let k = 0; k < 4; k++) {
          const [x, , z] = spot((what.includes("fern") ? 0.45 : 0) + (k - 1.5) * 0.15 + (grow() - 0.5) * 0.06, grow() * 0.04 - 0.05);
          shroom(x, z, 0.12 + grow() * 0.26, 0.05 + grow() * 0.04, n[0] * 0.08 + r[0] * (grow() - 0.5) * 0.4, n[2] * 0.08 + r[2] * (grow() - 0.5) * 0.4);
        }
        if (what.includes("crystal")) {
          const boulder = turnedY(scaled(BL.hubModels.rock(0), 0.34), n[0] ? Math.PI / 2 : 0);
          let ext = 0;
          for (let i = 0; i < boulder.verts.length; i += 3) ext = Math.max(ext, boulder.verts[i] * n[0] + boulder.verts[i + 2] * n[2]);
          const [bx, , bz] = onWall(wall, s, 0, 0.34 - ext), foot = logs ? 0.25 : 0.34 - ext;
          tuck(g, moved(boulder, bx, 0, bz));
          for (let k = 0; k < 6; k++) {
            const t = (k / 5 - 0.5) * 1.8, [x, , z] = onWall(wall, s + Math.sin(t) * 0.1, 0, foot + Math.cos(t) * 0.03);
            crystal(x, 0.15, z, n[0] * 0.15 + r[0] * Math.sin(t) * 0.7, 1, n[2] * 0.15 + r[2] * Math.sin(t) * 0.7, 0.18 + grow() * 0.18, 0.03 + grow() * 0.02, k % 2 ? "#4fd8ff" : "#3fe6c8");
          }
        }
        if (what.includes("moss")) for (const [a, d, k] of [[0, 0, 1], [0.2, 0.06, 0.7]]) {
          const [x, , z] = spot(a - 0.45, d - 0.05);
          puff(g, x, 0.02, z, 0.2 * k, 0.11 * k, 0.2 * k, MOSS, grow, 3, 7);
        }
      }
    });
    return { floor, rock: shaded([crag], flat), timber: timberJungle, outside };
  });
  // The hall's fires, all the light the Oogas have, each burning in a `blaze` but the gourds, which glow from inside.
  // Tiki torches on the hall's posts (`POST_TORCHES`, [side, z]: each post whose bay holds nothing a flame would
  // crowd): a bamboo pole on two timber brackets bound to the post with rope, leaning out into the hall, a woven cup
  // on its head; under the deck, a bamboo torch bound up the front of each column beside a dart board, its head
  // leaning toward the board, the flame over head height and under the deck's bearer. Carved tiki torches either side
  // of the doorway and, taller by `rise`, on the stage's lower step
  // either side of the games (`TIKIS`, [x, y, z, turn, rise]): a log pole on a stone foot, carved at the top into a
  // grinning face banded in red earth, turned to `turn`, the cup lashed on its head. Fire bowls of pale carved stone
  // on squat stone pedestals (`BOWLS`, [x, y, z]) on the stump's roots either side of the jackpot wheel's footing,
  // lighting the back room, and up on the deck either end of the dark cabinets against the back wall, charred sticks
  // across their embers. Each tiki and bowl leaves 2.3 m to anything a walker could pass. And bottle gourds hung from
  // the rock on lianas in a rope sling (`LAYOUT.lanterns`, some
  // higher, some lower), a band of triangles carved round their bellies and the fire glowing through their skins.
  // `frame` is everything that does not flicker, `glass` the gourds' carved holes and the bowls' embers; `flames`
  // where each flame burns, [x, y, z, size]; `lights` a point at each fire, [x, y, z] in turn, and `kinds` which fire
  // each is (0 a torch, 1 a bowl, 2 a gourd), for the scene's light pool; `footprints` the tikis' and bowls' feet and
  // the columns' torches (each one's reach in front of its column), [x, z, radius, floor y], for its walkers.
  const POST_TORCHES = [[-1, -11.3], [-1, -1.1], [-1, 2.3], [1, -11.3], [1, -8.5], [1, -4.5], [1, -1.1]];
  const TIKIS = [[-2.78, 0, HALL.front - 0.48, Math.PI, 0], [2.78, 0, HALL.front - 0.48, Math.PI, 0], [-4.31, STAGE.low, -8.42, 0, 0.3], [4.31, STAGE.low, -8.42, 0, 0.3]];
  const BOWLS = [[-2.4, 0, -12.2], [2.4, 0, -12.2], [-6.5, MEZZ.y, HALL.back + 0.55], [6.5, MEZZ.y, HALL.back + 0.55]];
  // A gourd's profile, [radius, height] from its foot, 0.565 tall before `GOURD_S`; and the row of faces round its
  // belly carved in a band of triangles, one a face all pointing up like a row of teeth, so none reads as a face.
  const GOURD = [[0, 0], [0.09, 0.008], [0.16, 0.045], [0.195, 0.1], [0.2, 0.16], [0.185, 0.22], [0.15, 0.275], [0.1, 0.315], [0.075, 0.35], [0.085, 0.43], [0.075, 0.5], [0.042, 0.55], [0, 0.565]];
  const GOURD_S = 1.3, GOURD_BAND = 3;
  const lanterns = cached(() => {
    const J = BL.hubModels, round = [], flat = [], glow = [], flames = [], lights = [], kinds = [], footprints = [], ties = [], leaf = mulberry32(1707);
    // Its light `lift` over the flame, and `out` in front of it along +z where a fire against the back wall spills.
    const fire = (x, y, z, size, kind, lift, out = 0) => { flames.push([x, y, z, size]); lights.push(x, y + lift, z + out); kinds.push(kind); };
    // A woven cup of radius r on a pole's head at (x, y, z): the basket in two close straw tones narrowing onto the
    // pole, its rope rim and the dark pitch the flame stands on. Returns the flame's foot.
    const cup = (x, y, z, r) => {
      const basket = lathe({ profile: [[r * 0.4, 0], [r * 0.72, r * 0.45], [r * 0.98, r * 1.15], [r * 1.08, r * 1.5]], segments: 10, color: "#b88a3e" }), weave = hexToRgb("#9f7634");
      basket.faces.forEach((f, k) => { if ((k + Math.floor(k / 10)) % 2) f.color = weave; });
      round.push(moved(basket, x, y, z), moved(torus(r * 1.08, r * 0.14, "#c9a36a", 0, 10, 4), x, y + r * 1.5, z));
      round.push(moved(lathe({ profile: [[r * 1.02, r * 1.36], [0, r * 1.44]], segments: 10, color: "#1c120c" }), x, y, z));
      return y + r * 1.38;
    };
    for (const [s, z] of POST_TORCHES) {
      const post = s * (HALL.halfW - 0.49), foot = s * (HALL.halfW - 0.66), head = s * (HALL.halfW - 0.84);
      round.push(J.bamboo(foot, 2.25, z, head, 3.45, z, 0.045));
      for (const y of [2.5, 3.1]) {
        const px = foot + (head - foot) * (y - 2.25) / 1.2;
        flat.push(bevelBox({ w: Math.abs(post - px) + 0.1, h: 0.09, d: 0.14, color: TIMBER_DK, bevel: 0.02, offset: { x: (post + px) / 2, y, z } }));
        if (y > 3) round.push(J.lashing(px, y, z, head - foot, 1.2, 0, 0.045));
      }
      fire(head, cup(head, 3.45, z, 0.1), z, 1, 0, 0.3);
    }
    const backRow = Math.min(...MEZZ_POSTS.map(([, z]) => z));
    for (const bx of LAYOUT.darts) for (const [px, pz] of MEZZ_POSTS) {
      if (pz !== backRow || Math.abs(px - bx) > 2) continue;
      const s = Math.sign(bx - px), z = pz + 0.24, head = [px + s * 0.12, 2.1, z + 0.14];
      round.push(J.bamboo(px + s * 0.02, 1.4, z, ...head, 0.04));
      for (const y of [1.48, 1.66]) round.push(J.lashing(px, y, pz, 0, 1, 0, 0.24));
      fire(head[0], cup(...head, 0.09), head[2], 1, 0, 0.3, 0.35);
      footprints.push([px + s * 0.05, pz + 0.41, 0.17, 0]);
    }
    for (const [x, y0, z, t, rise] of TIKIS) {
      round.push(moved(turn([[0.22, 0], [0.22, 0.07], [0.15, 0.12], [0, 0.12]], 12, STONE[2]), x, y0, z));
      round.push(J.log(x, y0 + 0.08, z, x, y0 + 1.6 + rise, z, 0.08, "#5a3a22"));
      const y = y0 + rise;
      round.push(J.log(x, y + 1.58, z, x, y + 2.14, z, 0.125, "#7a5030"));
      for (const h of [1.64, 2.07]) round.push(moved(torus(0.128, 0.022, "#b8402e", 0, 12, 4), x, y + h, z));
      // The face, carved toward +z and turned to `t`: a heavy brow over two bone eyes striped in red earth, the nose,
      // and a grin of bone teeth.
      const eyes = [-1, 1].flatMap((sx) => [
        moved(turnedX(turn([[0.038, 0], [0.038, 0.012], [0, 0.02]], 10, BONE), Math.PI / 2), sx * 0.052, 1.88, 0.112),
        moved(turnedX(turn([[0.018, 0], [0.018, 0.008], [0, 0.012]], 8, "#1c1410"), Math.PI / 2), sx * 0.052, 1.88, 0.13)
      ]);
      const carved = [
        bevelBox({ w: 0.22, h: 0.05, d: 0.06, color: "#4a2e18", bevel: 0.015, offset: { y: 1.955, z: 0.1 } }),
        moved(prism(ccw([[0, 0.05], [0.035, -0.04], [-0.035, -0.04]]), 0.05, "#6a4226"), 0, 1.81, 0.115),
        box({ w: 0.17, h: 0.05, d: 0.03, color: "#1c1410", offset: { y: 1.71, z: 0.112 } }),
        ...[-0.05, 0, 0.05].map((bx) => box({ w: 0.03, h: 0.03, d: 0.02, color: BONE, offset: { x: bx, y: 1.722, z: 0.128 } })),
        ...[-1, 1].map((sx) => box({ w: 0.05, h: 0.012, d: 0.02, color: "#b8402e", offset: { x: sx * 0.052, y: 1.835, z: 0.118 } }))
      ];
      round.push(...eyes.map((g) => moved(turnedY(g, t), x, y, z)));
      flat.push(...carved.map((g) => moved(turnedY(g, t), x, y, z)));
      fire(x, cup(x, y + 2.14, z, 0.13), z, 1.15, 0, 0.35);
      footprints.push([x, z, 0.22, y0]);
    }
    for (const [x, y, z] of BOWLS) {
      round.push(moved(turn([[0.34, 0], [0.34, 0.09], [0.27, 0.15], [0.23, 0.3], [0.22, 0.5], [0.27, 0.58], [0.31, 0.64], [0, 0.66]], 12, STONE[1]), x, y, z));
      round.push(moved(torus(0.232, 0.026, "#b8402e", 0, 12, 4), x, y + 0.4, z));
      round.push(moved(turn([[0.2, 0.64], [0.38, 0.7], [0.47, 0.82], [0.49, 0.9], [0.44, 0.93], [0.4, 0.86], [0, 0.82]], 14, "#7a6a58"), x, y, z));
      glow.push(moved(lathe({ profile: [[0.41, 0.84], [0.26, 0.9], [0, 0.92]], segments: 14, color: "#ff7a28", emissive: 1 }), x, y, z));
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + 0.4, c = Math.cos(a), sn = Math.sin(a);
        round.push(along(lathe({ profile: [[0, 0], [0.035, 0], [0.035, 0.56], [0, 0.56]], segments: 6, color: "#2a1c14" }), x - c * 0.3, y + 0.9, z - sn * 0.3, c, 0.14, sn));
      }
      fire(x, y + 0.9, z, 1.7, 1, 0.5);
      footprints.push([x, z, 0.52, y]);
    }
    // The gourds: the shell's faces two-tone in ribs and lit a little from within, as a gourd glows round its fire,
    // and where the carving cuts one, that face's triangle (the rest of the face kept round it) moves to the holes.
    const S = GOURD_S, segs = 8, skin = hexToRgb("#c68a3e"), rib = hexToRgb("#a86f2c"), neck = hexToRgb("#946026"), lit = hexToRgb("#ffbe48");
    const radiusAt = (h) => {
      for (let k = 1; k < GOURD.length; k++) if (GOURD[k][1] >= h) { const [r0, h0] = GOURD[k - 1], [r1, h1] = GOURD[k]; return r0 + (r1 - r0) * (h - h0) / (h1 - h0); }
      return 0;
    };
    LAYOUT.lanterns.forEach(([x, z, dy]) => {
      const y = LANTERN_Y + dy, shell = lathe({ profile: GOURD.map(([r, h]) => [r * S, h * S]), segments: segs, color: "#c68a3e" }), v = shell.verts, kept = [], holes = geometry();
      const mid = (a, b) => { v.push((v[a * 3] + v[b * 3]) / 2, (v[a * 3 + 1] + v[b * 3 + 1]) / 2, (v[a * 3 + 2] + v[b * 3 + 2]) / 2); return v.length / 3 - 1; };
      const hole = (ids) => face(holes, ids.map((i) => pushVert(holes, v[i * 3], v[i * 3 + 1], v[i * 3 + 2])), lit, { emissive: 0.8 });
      shell.faces.forEach((f, k) => {
        const p = Math.floor(k / segs), s = k % segs, [a, b, c, d] = f.i;
        f.color = p > 7 ? neck : s % 2 ? rib : skin;
        f.emissive = 0.28;
        if (p === GOURD_BAND) { const m = mid(b, c); hole([a, m, d]); kept.push({ ...f, i: [a, b, m] }, { ...f, i: [m, c, d] }); }
        else kept.push(f);
      });
      shell.faces = kept;
      const top = y + GOURD[GOURD.length - 1][1] * S;
      round.push(moved(shell, x, y, z), moved(lathe({ profile: [[0.05, 0], [0.042, 0.06], [0, 0.065]], segments: 8, color: "#4a2e18" }), x, top - 0.02, z), moved(torus(0.088 * S + 0.008, 0.014, "#c9a36a", 0, 8, 4), x, y + 0.44 * S, z));
      glow.push(moved(holes, x, y, z), moved(lathe({ profile: [[0, -0.004], [0.08, -0.004]], segments: 8, color: "#ffbe48", emissive: 1 }), x, y, z));
      ties.push([x, y, z, top]);
      lights.push(x, y + 0.25, z);
      kinds.push(2);
    });
    const frame = J.withJungle(shaded(round, flat), (g) => {
      // Each gourd's vine down from the rock to its stopper, leaves where it leaves the rock, and its sling: three
      // strands of rope from the collar at its neck down round its belly to meet under it.
      for (const [x, y, z, top] of ties) {
        J.liana(g, [[x, HALL.h + 0.02, z], [x + 0.05, (HALL.h + top) / 2, z - 0.04], [x, top + 0.04, z]], 0.03, 0.022, "#2f5424");
        J.sprig(g, x, HALL.h - 0.1, z, 0, -1, 0, 3, 0.3, leaf);
        for (let k = 0; k < 3; k++) {
          const a = k / 3 * Math.PI * 2 + 0.3, c = Math.cos(a), sn = Math.sin(a);
          J.liana(g, [0.44, 0.3, 0.16, 0].map((h) => { const r = radiusAt(h) * S + 0.02; return [x + c * r, y + h * S, z + sn * r]; }), 0.012, 0.012, "#c9a36a");
        }
      }
    });
    return { frame, glass: unshadowed(merge(...glow)), flames, lights, kinds, footprints };
  });
  // A fire's flame (`blaze`), half a metre tall at size 1: a fat teardrop licking up to a point with three smaller
  // tongues leaning out round its foot, the whole twisted a little as it rises, white-gold at the root through yellow
  // and orange to red at the tips, glowing. Smooth and unshadowed, its tips sway; the scene stands one on each fire
  // (`lanterns().flames`) and flickers each on its own clock. The big sign's torches burn the flat, still `flame`
  // (below) instead, baked into its mesh.
  const BLAZE_INKS = ["#fff2b8", "#ffd24a", "#ffa030", "#ff6420"];
  const blaze = cached(() => {
    const ink = (t) => BLAZE_INKS[Math.min(3, Math.floor(t * 4))];
    const lick = (h, r) => turn([[0, 0], [r * 0.72, h * 0.05], [r, h * 0.2], [r * 0.9, h * 0.38], [r * 0.62, h * 0.58], [r * 0.3, h * 0.8], [0, h]], 8, ink, 0.9);
    const parts = [lick(0.5, 0.13)];
    for (let k = 0; k < 3; k++) parts.push(turnedY(moved(turnedZ(lick(0.3, 0.075), -0.45), 0.05, 0.02, 0), k * 2.09 + 0.5));
    const geo = shaded(parts), v = geo.verts;
    for (let i = 0; i < v.length; i += 3) {
      const a = v[i + 1] * 1.6, c = Math.cos(a), s = Math.sin(a), x = v[i], z = v[i + 2];
      v[i] = x * c + z * s;
      v[i + 2] = -x * s + z * c;
    }
    geo.sway = 0.15;
    return unshadowed(geo);
  });
  // Overhead, the cave the Oogas moved into (`ceiling`): big clusters of stalactites dripping off the bare rock in
  // loose rows, some grown through by roots that wind down round them with moss where they come out, and a few
  // clusters of glowing teal crystal up by the side walls, all clear of the spots, the gourds' vines, the bunting and
  // the hall of fame. And the hero over the stage: a mammoth's skeleton walking on air, hung side-on to the doorway
  // between the spots' rows, its head toward +x, so the way in and the stage see its profile as the cave painting
  // shows one.
  // `MAMMOTH_AT` is the middle of its back, right over the spirit rattle; in its own frame +z runs from its tail to
  // its head, along the hall's x. The high domed skull with a trunk socket ringed in bone in its face, a dark eye
  // socket under a brow each side and its jaw hanging a little open; two great tusks leaving the face down and
  // forward, spreading out as they sweep forward and curling up and in at their tips; the spine climbing from a short
  // hanging tail and the hips up the sloping back to a high shoulder hump, tall spines standing up along it, then down
  // the neck to the skull; the ribs curving down and in, open under the belly where the spirit rattle hangs through;
  // shoulder blades, hip bones and four legs hanging a little bent. It hangs from the rock on thick lianas, a pair to
  // its skull, its shoulders and its hips, with leaves where each leaves the rock and where it ties on. Bone white
  // and smooth, unshadowed; the ceiling and the mammoth are one geometry.
  const MAMMOTH_AT = { x: -0.7, y: 9, z: LAYOUT.disco.z };
  // The hall's bays down its length, 3.4 m apart from `BAY_Z`: the gourds hang in rows on them, the ceiling's clusters
  // between them and the pool tables' lamps from them.
  const BAY_Z = -21.5;
  // Its spine, [z, y] in its own frame from the tail's tip to the skull; `spineAt(z)` the height of its back there.
  const MAMMOTH_SPINE = [[-3.2, -1.08], [-3.05, -0.75], [-2.8, -0.42], [-2.45, -0.2], [-1.9, -0.08], [-1.1, 0.16], [-0.2, 0.46], [0.7, 0.72], [1.35, 0.78], [1.8, 0.6], [2.1, 0.38]];
  const spineAt = (z) => {
    const P = MAMMOTH_SPINE;
    for (let k = 1; k < P.length; k++) if (P[k][0] >= z) return P[k - 1][1] + (P[k][1] - P[k - 1][1]) * (z - P[k - 1][0]) / (P[k][0] - P[k - 1][0]);
    return P[P.length - 1][1];
  };
  const STALACTITE = ["#7a6656", "#8a7462", "#6e5c4e"], ROOT_TONE = "#74502e", MOSS = ["#2f4a22", "#3f5e2a", "#56753a", "#6b8a44"].map(hexToRgb);
  // A mammoth's tusk `len` long and `r` thick at its root on the origin, tapering to a blunt tip, in the (z, y) plane:
  // it leaves heading `dip` radians below +z, down and forward, and curls up through `curl` radians, tighter toward
  // the tip, so it sweeps forward, rises and hooks back over itself. A round part; the trim's `boneTusk` instead rises
  // straight up +y and only hooks over at its tip.
  const mammothTusk = (len, r, dip, curl) => {
    const n = 14, rows = [[0, 0]], ang = [], pz = [0], py = [0];
    for (let k = 0; k <= n; k++) { ang.push(-dip + curl * (k / n) ** 1.3); rows.push([r * (1 - 0.8 * (k / n) ** 1.2), k / n * len]); }
    rows.push([0, len]);
    for (let k = 1; k <= n; k++) { const m = (ang[k - 1] + ang[k]) / 2; pz.push(pz[k - 1] + Math.cos(m) * len / n); py.push(py[k - 1] + Math.sin(m) * len / n); }
    // Each ring of the straight lathe stands on the curve, turned with it.
    const geo = turn(rows, 10, BONE), v = geo.verts;
    for (let i = 0; i < v.length; i += 3) {
      const k = Math.round(v[i + 1] / len * n), z = v[i + 2];
      v[i + 1] = py[k] - z * Math.cos(ang[k]); v[i + 2] = pz[k] + z * Math.sin(ang[k]);
    }
    return geo;
  };
  const ceiling = cached(() => {
    const J = BL.hubModels, M = MAMMOTH_AT, round = [], mammoth = [], bones = [], rand = mulberry32(1110), leaf = mulberry32(1111), roots = [];
    // A point in the mammoth's frame, in the hall.
    const at = (x, y, z) => [M.x + z, M.y + y, M.z - x];
    // An ellipsoid in the mammoth's frame at (x, y, z), radii rx, ry, rz, tipped `tilt` about x, in `segs` segments
    // (the small ones fewer).
    const blob = (x, y, z, rx, ry, rz, color = BONE, tilt = 0, segs = 10) => {
      const n = segs > 7 ? 6 : 4, g = lathe({ profile: Array.from({ length: n + 1 }, (_, k) => [Math.sin(k / n * Math.PI), -Math.cos(k / n * Math.PI)]), segments: segs, color });
      for (let i = 0; i < g.verts.length; i += 3) { g.verts[i] *= rx; g.verts[i + 1] *= ry; g.verts[i + 2] *= rz; }
      mammoth.push(moved(turnedX(g, tilt), x, y, z));
    };
    // A bone through `pts` in the mammoth's frame, r0 thick at its first point and r1 at its last, a knob at each end
    // of a limb bone.
    const bone = (pts, r0, r1, knobs = false) => {
      bones.push([pts.map((p) => at(...p)), r0, r1]);
      if (knobs) for (const p of [pts[0], pts[pts.length - 1]]) blob(...p, r0 * 1.45, r0 * 1.45, r0 * 1.45, BONE, 0, 7);
    };
    // The skull: the cranium under its high dome, the face below it holding the tusks' sheaths, the trunk socket high
    // in the face in a rim of bone, the eye sockets under their brows and the cheek bones, the jaw hung open under
    // them, and the tusks.
    blob(0, 0.12, 2.55, 0.5, 0.62, 0.52, BONE, -0.25);
    blob(0, 0.7, 2.36, 0.37, 0.42, 0.38, BONE, -0.5);
    blob(0, -0.42, 2.92, 0.42, 0.5, 0.34, BONE, 0.3);
    blob(0, 0.18, 3.02, 0.15, 0.19, 0.08, "#3a2c20", 0, 8);
    mammoth.push(moved(turnedX(torus(0.17, 0.045, BONE, 0, 12, 5), Math.PI / 2), 0, 0.18, 3.04));
    for (const sx of [-1, 1]) {
      blob(sx * 0.43, 0.08, 2.8, 0.08, 0.13, 0.13, "#3a2c20", 0, 7);
      blob(sx * 0.4, 0.26, 2.78, 0.1, 0.07, 0.17, BONE, 0, 7);
      bone([[sx * 0.42, -0.08, 2.98], [sx * 0.47, -0.13, 2.68], [sx * 0.41, -0.1, 2.36]], 0.05, 0.045);
      bone([[sx * 0.2, -0.5, 3], [sx * 0.25, -0.82, 3.12]], 0.17, 0.16);
      mammoth.push(moved(turnedY(turnedZ(mammothTusk(3.5, 0.15, 1.2, 3.8), sx * 0.4), sx * 0.26), sx * 0.25, -0.82, 3.12));
    }
    bone([[-0.3, -0.3, 2.28], [-0.27, -0.66, 2.45], [-0.13, -0.8, 2.62], [0.13, -0.8, 2.62], [0.27, -0.66, 2.45], [0.3, -0.3, 2.28]], 0.085, 0.085);
    // The spine: a cord from the tail's tip to the skull strung with a vertebra every fifth of a metre, smaller down
    // the tail, with a spine standing up from each along the back, tallest over the shoulders' hump.
    bone(MAMMOTH_SPINE.map(([z, y]) => [0, y, z]), 0.035, 0.06);
    for (let z = -3.15; z < 2.1; z += 0.2) {
      const y = spineAt(z), dy = spineAt(z + 0.05) - spineAt(z - 0.05), r = z < -2.45 ? 0.05 + (z + 3.15) * 0.07 : 0.11;
      mammoth.push(along(lathe({ profile: [[0, -0.07], [r * 0.9, -0.065], [r, 0], [r * 0.9, 0.065], [0, 0.07]], segments: 8, color: BONE }), 0, y, z, 0, dy, 0.1));
      if (z > -2.5 && z < 1.95) { const h = 0.12 + 0.48 * Math.exp(-(((z - 0.8) / 1.0) ** 2)); bone([[0, y + 0.05, z], [0, y + 0.05 + h, z - 0.1]], 0.045, 0.02); }
    }
    // Ten pairs of ribs, the middle ones longest, sweeping back a little as they curve down to leave the belly open.
    [0.78, 0.9, 0.97, 1, 1, 0.98, 0.94, 0.87, 0.79, 0.7].forEach((f, k) => {
      const z = 1.5 - k * 0.31, y = spineAt(z) - 0.04;
      for (const sx of [-1, 1]) bone([[sx * 0.08, y, z], [sx * 0.34, y - 0.02, z - 0.03], [sx * 0.7 * f, y - 0.32 * f, z - 0.08], [sx * 0.82 * f, y - 0.78 * f, z - 0.14], [sx * 0.7 * f, y - 1.2 * f, z - 0.19], [sx * 0.4 * f, y - 1.42 * f, z - 0.21]], 0.055, 0.03);
    });
    // Shoulder blades and hip bones, then the legs, each a bone to the elbow or knee and another to the foot, walking.
    for (const sx of [-1, 1]) { blob(sx * 0.76, 0.3, 1.2, 0.07, 0.42, 0.26, BONE, 0.3); blob(sx * 0.5, -0.14, -2.15, 0.09, 0.36, 0.3, BONE, -0.35); }
    for (const [sx, x, hz, hy, kz, fz, knee, fy] of [[-1, 0.72, 1.25, -0.2, 1.42, 1.3, -1.12, -1.9], [1, 0.72, 1.25, -0.2, 1.02, 0.84, -1.1, -1.86], [-1, 0.52, -2.15, -0.38, -1.95, -2.1, -1.12, -1.84], [1, 0.52, -2.15, -0.38, -2.42, -2.6, -1.1, -1.8]]) {
      bone([[sx * x, hy, hz], [sx * (x - 0.02), knee, kz]], 0.085, 0.075, true);
      bone([[sx * (x - 0.02), knee, kz], [sx * (x - 0.04), fy, fz]], 0.075, 0.06, true);
      blob(sx * (x - 0.04), fy - 0.12, fz + 0.06, 0.15, 0.07, 0.18, BONE, 0, 8);
      for (const tx of [-0.08, 0, 0.08]) blob(sx * (x - 0.04) + tx, fy - 0.13, fz + 0.23, 0.05, 0.045, 0.05, BONE, 0, 5);
    }
    // The skeleton, built head to +z, turned side-on into the hall.
    round.push(moved(turnedY(merge(...mammoth), Math.PI / 2), M.x, M.y, M.z));
    // The ceiling, row by row across the hall (`rows`), where nothing else hangs: big clusters of stalactites
    // dripping off a swelling in the rock, one great drip 1.2 to 2 m long with two to four smaller ones leaning out
    // round it (shorter in the two rows by the back wall, so they stay above the paintings and the big sign seen from
    // the doorway), and every third one grown through by roots that wind down round it and hang on past its tip.
    // Placed from `rand`, each at least `r` clear of the spots, the gourds' vines, the bunting and the hall of fame's
    // lianas.
    const rows = [], F = LAYOUT.fame, fameTies = [-1, 1].map((s) => [F.x + Math.cos(F.turn) * s * 1.65, F.z - Math.sin(F.turn) * s * 1.65]);
    for (let z = BAY_Z; z < HALL.front; z += 3.4) rows.push(z);
    const clear = (x, z, r) => Math.abs(x) < HALL.halfW - 0.9 - r && !(x > M.x - 3.7 - r && x < M.x + 5.6 + r && Math.abs(z - M.z) < 4.3)
      && SPOTS.every(([sx, sz]) => Math.hypot(x - sx, z - sz) > r + 0.9) && LAYOUT.lanterns.every(([lx, lz]) => Math.hypot(x - lx, z - lz) > r + 0.6)
      && fameTies.every(([fx, fz]) => Math.hypot(x - fx, z - fz) > r + 0.7) && PENNANT_LINES.every((pz) => Math.abs(z - pz) > r + 0.45);
    // A drip `len` long from the rock at (x, z), `r` thick where it leaves it: swelling a little before it tapers to a
    // rounded point, pale at the tip, leaning out `lx` along x and `lz` along z; a `big` one rounder and smoother.
    const stalactite = (x, z, len, r, lx, lz, big) => {
      const tone = STALACTITE[Math.floor(rand() * STALACTITE.length)];
      const profile = big ? [[0, -len], [r * 0.14, -len * 0.97], [r * 0.3, -len * 0.88], [r * 0.52, -len * 0.7], [r * 0.72, -len * 0.47], [r * 0.88, -len * 0.25], [r, -len * 0.08], [r * 1.25, 0.04]]
        : [[0, -len], [r * 0.2, -len * 0.94], [r * 0.5, -len * 0.72], [r * 0.82, -len * 0.38], [r * 1.2, 0.04]];
      const g = lathe({ profile, segments: big ? 8 : 6, color: (t) => t < 0.2 ? "#c2ae92" : tone });
      round.push(moved(turnedZ(turnedX(g, -lz), lx), x, HALL.h + 0.02, z));
    };
    const cluster = (x, z, len, grown) => {
      const R = 0.5 + len * 0.16, r = 0.22 + len * 0.08, n = 2 + Math.floor(rand() * 3);
      round.push(moved(lathe({ profile: [[0, -0.3], [R * 0.5, -0.26], [R * 0.85, -0.14], [R * 1.05, 0.04]], segments: 10, color: STALACTITE[2] }), x, HALL.h + 0.02, z));
      stalactite(x, z, len, r, (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.1, true);
      for (let j = 0; j < n; j++) {
        const a = j / n * Math.PI * 2 + rand(), d = R * (0.5 + rand() * 0.3);
        stalactite(x + Math.cos(a) * d, z + Math.sin(a) * d, len * (0.3 + rand() * 0.35), r * (0.45 + rand() * 0.2), Math.cos(a) * 0.14, Math.sin(a) * 0.14, false);
      }
      if (grown) roots.push([x, z, len, r]);
    };
    let count = 0;
    [HALL.back + 0.75, ...rows.slice(1).map((z, k) => (z + rows[k]) / 2)].forEach((bz, b) => {
      for (let k = 0; k < 5; k++) {
        const x = (k - 2) * 6.8 + (rand() - 0.5) * 1.8, z = bz + (k % 2 ? 0.85 : -0.85) * (b ? 1 : 0.2) + (rand() - 0.5) * 0.3;
        const len = b === 0 ? 0.6 + rand() * 0.3 : b === 1 ? 1.1 + rand() * 0.35 : 1.2 + rand() * 0.8;
        if (clear(x, z, 0.75)) cluster(x, z, len, ++count % 3 === 0);
      }
    });
    // Glowing teal crystals, sparingly, in four clusters up by the side walls.
    for (const [x, z] of [[-16.3, -20], [16.3, -13.2], [-16.3, 0.9], [16.4, 4.1]]) {
      for (let k = 0; k < 5; k++) {
        const len = 0.22 + rand() * 0.3, g = lathe({ profile: [[0, -len], [0.05, -len * 0.75], [0.05, 0]], segments: 6, color: k % 2 ? "#3fe0d0" : "#6ff0e0", emissive: 0.85 });
        round.push(moved(turnedZ(turnedX(g, (rand() - 0.5) * 1.1), (rand() - 0.5) * 1.1), x + (rand() - 0.5) * 0.4, HALL.h + 0.02, z + (rand() - 0.5) * 0.4));
      }
    }
    const geo = J.withJungle(shaded(round), (g) => {
      for (const [pts, r0, r1] of bones) J.liana(g, pts, r0, r1, BONE);
      // The lianas it hangs by, a pair from the rock either side of its back to the top of its skull, its shoulders
      // and its hips: a rope lashing where each ties on, leaves where each leaves the rock and a few more at the tie.
      for (const [z, y] of [[2.42, 0.9], [0.35, spineAt(0.35) + 0.1], [-1.9, spineAt(-1.9) + 0.1]]) for (const sx of [-1, 1]) {
        const [bx, by, bz] = at(sx * 0.1, y, z), rz = M.z - sx * 0.55;
        J.liana(g, [[bx, HALL.h + 0.02, rz], [bx + 0.05, (HALL.h + by) / 2, (rz + bz) / 2 - sx * 0.03], [bx, by, bz]], 0.065, 0.05, "#2f5424");
        J.sprig(g, bx, HALL.h - 0.02, rz, 0, -1, 0, 4, 0.34, leaf);
        J.sprig(g, bx, by + 0.06, bz, 0.4, 0.6, -sx * 0.5, 3, 0.26, leaf);
        tuck(g, J.lashing(bx, by - 0.02, bz, 0, 1, 0, 0.08));
      }
      // The roots grown through a cluster: two from the rock beside its great drip, winding down round it and on past
      // its tip in a loose curl, and moss where they come out of the rock.
      for (const [x, z, len, r] of roots) {
        for (let j = 0; j < 2; j++) {
          const a0 = rand() * Math.PI * 2, turns = (j ? -1 : 1) * (3.5 + rand() * 2), reach = len + 0.35 + rand() * 0.5, pts = [];
          for (let k = 0; k <= 10; k++) {
            const t = k / 10, d = reach * t, a = a0 + t * turns, w = d < len ? r * (1 - d / len) ** 0.8 + 0.06 : 0.06 + (d - len) * 0.3;
            pts.push([x + Math.cos(a) * w, HALL.h + 0.03 - d, z + Math.sin(a) * w]);
          }
          J.liana(g, pts, 0.07, 0.018, ROOT_TONE);
        }
        J.sprig(g, x, HALL.h - 0.28, z, 0, -1, 0, 5, 0.3, leaf, MOSS);
      }
    });
    geo.castShadow = false;
    return geo;
  });
  // ---- the stage, the mezzanine and the jackpot wheel ------------------------------------------------------
  // The stage, a giant tree stump the Oogas sawed off in two steps (`STAGE`, whose heights and radii are the walkers'
  // floor): furrowed bark round each step, flaring at its foot, a thick bark lip at each cut, sapwood round the tops
  // and out-of-round growth rings in to a darker heart, a few checks split out from the middle and the Oogas' marks
  // daubed on the top; roots spreading
  // over the floor round its sides and back (never its front, where the visitor steps up), moss on some and ferns
  // between them. `lit` is its light: shelf fungi glowing amber in clusters up the bark and a few teal mushrooms among
  // the roots behind. Nothing stands on a step's top.
  // Round the stump an angle a is the direction (sin a, cos a), 0 toward the doorway.
  const STUMP = { bark: "#5e4028", furrow: "#2e1f16", lip: "#3a2718", sap: "#c49a62", late: "#8a5a34", heart: ["#a87848", "#b4844e"], core: "#9a6a3e", check: "#4a2e18" };
  // Fire and seed pods, the lights the Oogas hang where bulbs were: a cartoon flame `h` tall on the origin, three lit
  // tongues licking up +y and fanned out across x, white-gold at the root to red at the tips in five inks; and a seed
  // pod glowing `color`, hanging point down from a dark stalk at the origin. The flame is not the hall's `blaze`
  // (smooth, twisted round and swaying on a node of its own): flat-faced and still, it bakes into the big sign's lit
  // mesh, which the scene flickers as one.
  const FLAME_INKS = ["#fff2b0", "#ffd048", "#ffa030", "#ff7020", "#e8501a"];
  const tongue = (h, r) => lathe({ profile: [[0, 0], [r * 0.85, h * 0.1], [r, h * 0.28], [r * 0.7, h * 0.55], [r * 0.3, h * 0.82], [0, h]], segments: 8, color: (t) => FLAME_INKS[Math.min(4, Math.floor(t * 5))], emissive: 1 });
  const flame = (h) => unshadowed(merge(tongue(h, h * 0.3), moved(turnedZ(tongue(h * 0.62, h * 0.2), 0.45), -h * 0.13, h * 0.03, 0.02), moved(turnedZ(tongue(h * 0.5, h * 0.17), -0.5), h * 0.13, h * 0.02, -0.02)));
  const seedPod = (color, s = 1) => {
    const geo = lathe({ profile: [[0, -0.05], [0.02, -0.036], [0.026, -0.014], [0.019, 0.006], [0.008, 0.02], [0.006, 0.032], [0, 0.034]].map(([r, y]) => [r * s, y * s]), segments: 6, color: (t) => t > 0.6 ? "#3a2616" : color });
    geo.faces.forEach((f, k) => { f.emissive = k < 24 ? 1 : 0; });
    return geo;
  };
  // An ember a celebration throws, as a fire does: a small tongue of flame round its middle glowing one of
  // `SPARK_INKS`, for the scenes' `fx.burst`, which tumbles it as it flies.
  const SPARK_INKS = ["#ffb13b", "#ff7a2a", "#fff2b8"];
  const spark = variants((i) => unshadowed(lathe({ profile: [[0, -0.025], [0.016, -0.018], [0.02, -0.005], [0.013, 0.015], [0.005, 0.03], [0, 0.04]], segments: 6, color: SPARK_INKS[i], emissive: 1 })));
  const stage = cached(() => {
    const { r, inner, low, high } = STAGE, round = [], flat = [], lit = [], J = BL.hubModels, rand = mulberry32(6060);
    // Bark round a riser from y0 to y1 at radius rad, flaring `flare` out at its foot, in n furrowed ribs: every other
    // ring of vertices stands proud and every other face is a furrow's dark.
    const bark = (rad, y0, y1, flare, n) => {
      const geo = turn([[rad + flare, y0], [rad + flare * 0.35, y0 + (y1 - y0) * 0.4], [rad + 0.01, y1 - 0.025], [rad - 0.03, y1]], n, STUMP.bark), v = geo.verts, dark = hexToRgb(STUMP.furrow);
      for (let k = 0; k < v.length; k += 3) { const f = Math.round(Math.atan2(v[k + 2], v[k]) / (Math.PI * 2 / n)) & 1 ? 1.012 : 0.992; v[k] *= f; v[k + 2] *= f; }
      geo.faces.forEach((f, k) => { if (k % n & 1) f.color = dark; });
      return geo;
    };
    // A sawn face: the ring from ro in to ri at y, pushed a little out of round (most at the middle of a face `rim`
    // across, none at its edge or heart) the way growth rings run; none when `rim` is 0.
    const cut = (ro, ri, y, color, rim) => {
      const geo = lathe({ profile: [[ro, y], [ri, y]], segments: 40, color }), v = geo.verts;
      if (rim) for (let k = 0; k < v.length; k += 3) {
        const d = Math.hypot(v[k], v[k + 2]), a = Math.atan2(v[k + 2], v[k]);
        if (d < 1e-6) continue;
        const f = 1 + (Math.sin(a * 3 + d * 1.7) * 0.05 + Math.sin(a * 5 - d * 2.3) * 0.03) * 4 * (rim - d) / (rim * rim);
        v[k] *= f; v[k + 2] *= f;
      }
      return geo;
    };
    round.push(bark(r, 0, low, 0.14, 64), bark(inner, low, high, 0.05, 56));
    round.push(moved(torus(r - 0.01, 0.045, STUMP.lip, 0, 44, 5), 0, low - 0.005, 0), moved(torus(inner - 0.01, 0.045, STUMP.lip, 0, 40, 5), 0, high - 0.005, 0));
    round.push(cut(r - 0.03, inner + 0.16, low + 0.002, STUMP.sap, 0), cut(inner + 0.16, inner + 0.13, low + 0.002, STUMP.late, 0), cut(inner + 0.13, inner, low + 0.002, tint(STUMP.sap, 0.9), 0));
    let ro = inner - 0.03;
    round.push(cut(ro, ro - 0.24, high + 0.002, STUMP.sap, inner));
    ro -= 0.24;
    for (let k = 0; ro > 0.35; k++) {
      const w = 0.17 + (k * 7 % 5) * 0.035, ri = Math.max(0.2, ro - 0.03 - w);
      round.push(cut(ro, ro - 0.03, high + 0.002, STUMP.late, inner), cut(ro - 0.03, ri, high + 0.002, STUMP.heart[k & 1], inner));
      ro = ri;
    }
    round.push(cut(ro, 0, high + 0.002, STUMP.core, inner));
    // The checks: dark splits running out from near the heart, each a long thin kite on the top.
    const checks = geometry(), dark = hexToRgb(STUMP.check);
    for (const [a, r0, r1, w] of [[0.9, 0.3, 2.4, 0.06], [2.8, 0.45, 1.9, 0.05], [4.3, 0.25, 2.8, 0.07], [5.4, 0.9, 1.6, 0.04]]) {
      const sx = Math.sin(a), cz = Math.cos(a), y = high + 0.005, at = (d, side) => pushVert(checks, sx * d + cz * side, y, cz * d - sx * side);
      face(checks, [at(r0, 0), at(r1, -w), at(r1 * 1.07, 0), at(r1, w)], dark);
    }
    for (const f of checks.faces) {
      const v = checks.verts, [p, q, s] = f.i.map((k) => k * 3);
      if ((v[q + 2] - v[p + 2]) * (v[s] - v[p]) - (v[q] - v[p]) * (v[s + 2] - v[p + 2]) < 0) f.i.reverse();
    }
    flat.push(checks);
    // The Oogas' marks daubed flush into the sawn top, lit as dimly as the floor's: round its front rim, clear of the
    // cabinets' arc, charcoal handprints, fingers out, with ochre dots between them, and a red-earth sun spiral at
    // the heart. Drawn as the floor's paint is, on the xy plane (y there is -z), and laid a hair over the top.
    const marks = geometry(), R = inner - 0.36;
    for (let k = 0; k <= 12; k++) {
      const a = (k - 6) * 0.2, s = Math.sin(a), c = Math.cos(a);
      if (k % 2) for (const [dr, dt] of [[0, -0.08], [0.08, 0.05], [-0.08, 0.05]]) daubDot(marks, s * (R + dr) + c * dt, s * dt - c * (R + dr), 0.045, 0.045, EARTH_OCHRE, 0.06, 0, 0, 8);
      else daubHand(marks, s * (R - 0.17), -c * (R - 0.17), 0.34, a + Math.PI, EARTH_BLACK, 0.06);
    }
    daubSpiral(marks, 0, 0, 0.45, 0.06, EARTH_RED, 0.06);
    flat.push(moved(turnedX(marks, -Math.PI / 2), 0, high + 0.0032, 0));
    // The light: clusters of three shelf fungi up the bark, amber caps over pale gills, and three clumps of teal
    // mushrooms among the roots behind, clear of the fire bowls there.
    const fungus = (x, y, z, size) => moved(lathe({ profile: [[0, -0.004], [size, 0], [size * 0.9, size * 0.2], [size * 0.55, size * 0.34], [0, size * 0.38]], segments: 9, color: (t) => t < 0.2 ? "#ffe0a0" : "#ff9a3a", emissive: 1 }), x, y, z);
    for (let k = 0; k < 10; k++) {
      const a = 0.7 + k * (Math.PI * 2 - 1.4) / 9 + (rand() - 0.5) * 0.2, up = k % 2, rad = up ? inner + 0.01 : r + 0.05, y = up ? low + 0.09 : 0.09;
      for (let j = 0; j < 3; j++) { const b = a + (j - 1) * 0.17 / rad; lit.push(fungus(Math.sin(b) * rad, y + (j - 1) * 0.035, Math.cos(b) * rad, [0.1, 0.13, 0.08][j])); }
    }
    for (const [a, d] of [[2.5, 5.05], [3.78, 4.9], [4.26, 5.1]]) for (let j = 0; j < 3; j++) {
      const b = a + (j - 1) * 0.06, e = d + (j % 2) * 0.12, h = [0.16, 0.24, 0.12][j], x = Math.sin(b) * e, z = Math.cos(b) * e, s = [0.05, 0.065, 0.04][j];
      lit.push(moved(turn([[0.016, 0], [0.012, h], [0, h]], 6, "#cfe8e0", 0.3), x, 0, z), moved(lathe({ profile: [[0, h - 0.01], [s, h - 0.004], [s * 0.9, h + s * 0.35], [s * 0.5, h + s * 0.7], [0, h + s * 0.8]], segments: 8, color: "#46e0d0", emissive: 1 }), x, 0, z));
    }
    const body = J.withJungle(shaded(round, flat), (g) => {
      // Roots out from the foot of the bark over the floor, tapering as they sink into it, a moss cushion on some and
      // a fern in each gap between them; none straight back, where the floor stays bare to the jackpot wheel's footing.
      const moss = ["#34602a", "#43742f", "#548a38", "#66a042"].map(hexToRgb);
      for (let k = 0; k < 9; k++) {
        const a = 1.15 + k * (Math.PI * 2 - 2.3) / 8 + (rand() - 0.5) * 0.15, len = 0.45 + rand() * 0.3, bend = (rand() - 0.5) * 0.5, pts = [];
        for (let t = 0; t <= 4; t++) { const q = t / 4, d = r + 0.02 + q * len, b = a + bend * q * q / d; pts.push([Math.sin(b) * d, 0.1 - q * 0.12, Math.cos(b) * d]); }
        if (Math.abs(a - Math.PI) > 0.3) J.liana(g, pts, 0.15, 0.035, STUMP.bark);
        if (k % 2) J.puff(g, pts[1][0], pts[1][1] + 0.07, pts[1][2], 0.14, 0.06, 0.12, moss, rand, 4, 6);
        const f = a + (Math.PI * 2 - 2.3) / 16;
        if (k < 8) J.sprig(g, Math.sin(f) * (r + 0.2), 0.02, Math.cos(f) * (r + 0.2), Math.sin(f) * 0.5, 1, Math.cos(f) * 0.5, 4, 0.28, rand);
      }
    });
    return { body, lit: unshadowed(merge(...lit)) };
  });
  // The fire baskets over the stage, [x, z] in the hall, each hung at `SPOT_Y` where its vine ends. `spotCan` is one
  // in its frame, the pivot at the origin: a cane basket hung mouth up on a bail of three ropes, open work of ribs
  // bound round three hoops and a slanting cane across each gap, a woven dish for its floor and the fire glowing
  // through every gap from the embers heaped inside; the scene stands a `blaze` in it `SPOT_FIRE` under the pivot.
  // `spotRods` the lianas the pivots hang from, a lashing where each ties on and leaves where each comes out of the
  // rock.
  const SPOT_Y = HALL.h - 1.1, SPOT_FIRE = 0.86;
  const SPOTS = [[-4.6, -3], [4.6, -3], [-3.2, -12.5], [3.2, -12.5]];
  const spotCan = cached(() => {
    const J = BL.hubModels, HOOPS = [[0.15, -1.05], [0.245, -0.92], [0.3, -0.75]], RIBS = 10;
    const body = shaded([
      ...HOOPS.map(([r, y], k) => moved(torus(r, k === 2 ? 0.028 : 0.02, k === 2 ? "#c9a36a" : "#9a7334", 0, 12, 4), 0, y, 0)),
      lathe({ profile: [[0, -1.1], [0.1, -1.09], [0.16, -1.04]], segments: 12, color: "#8a6630" }),
      lathe({ profile: [[0.13, -1.03], [0.21, -0.93], [0.265, -0.78]], segments: 12, color: (t) => t < 0.5 ? "#ff7a28" : "#ffb347", emissive: 0.9 }),
      lathe({ profile: [[0.24, -0.84], [0.14, -0.8], [0, -0.78]], segments: 12, color: "#ff9a36", emissive: 1 }),
      moved(ball(0.035, "#c9a36a", 6), 0, 0.01, 0)
    ]);
    return J.withJungle(body, (g) => {
      const at = ([r, y], a) => [Math.cos(a) * r, y, Math.sin(a) * r];
      for (let k = 0; k < RIBS; k++) {
        const a = k / RIBS * Math.PI * 2, b = (k + 1) / RIBS * Math.PI * 2;
        J.liana(g, [at(HOOPS[0], a), at(HOOPS[1], a), at(HOOPS[2], a), at([0.31, -0.7], a)], 0.013, 0.013, k % 2 ? "#b88a3e" : "#a67c38");
        J.liana(g, [at(HOOPS[0], a), at(HOOPS[1], b)], 0.01, 0.01, "#b88a3e");
      }
      for (let k = 0; k < 3; k++) J.liana(g, [[0, 0.01, 0], at([0.3, -0.75], k / 3 * Math.PI * 2 + 0.3)], 0.012, 0.012, "#c9a36a");
    });
  });
  const spotRods = cached(() => {
    const J = BL.hubModels, leaf = mulberry32(4242);
    return J.withJungle(null, (g) => {
      for (const [x, z] of SPOTS) {
        J.liana(g, [[x + 0.05, HALL.h + 0.02, z - 0.04], [x - 0.05, (HALL.h + SPOT_Y) / 2 + 0.1, z + 0.03], [x, SPOT_Y + 0.02, z]], 0.034, 0.024, "#2f5424");
        J.sprig(g, x, HALL.h - 0.02, z, 0, -1, 0, 4, 0.32, leaf);
        tuck(g, J.lashing(x, SPOT_Y + 0.07, z, 0, 1, 0, 0.026));
      }
    });
  });
  // The mezzanine along the back wall at `MEZZ.y`, the Oogas' own: a deck of split logs laid side by side along the
  // hall, flat faces up, each row in lengths butting at staggered joints, on a log bearer along the back wall and a
  // log along its front for a fascia, on bark log posts (`MEZZ_POSTS`), each on a boulder, the front ones bound in
  // rope and braced up into the fascia by a branch either side above head height; a rail of bamboo posts about every
  // 1.5 m between the stairs, each bound in rope, under canes laid along their tops, with a rope slung between them;
  // and the stairs. A leafy garland swags along the rail from post to post and another along the fascia between the
  // posts inside the stairs, both with their leaves hanging out over the hall, and a coconut sits on each of the
  // rail's end posts where the stairs land.
  const mezzanine = cached(() => {
    const { z0, z1, y, stairs, stairW } = MEZZ, W = HALL.halfW * 2 - 0.1, D = z1 - z0, cz = (z0 + z1) / 2;
    const J = BL.hubModels, rand = mulberry32(2030), drand = mulberry32(2031), BARKS = ["#5c3f25", "#6b4a2b", "#553a22"];
    const end = stairs[1][0] - stairW / 2, n = Math.max(1, Math.round(end * 2 / 1.5)), rx = (k) => -end + k * 2 * end / n, zr = z1 - 0.1, front = z1 - 0.17;
    const round = [J.log(-W / 2, y - 0.36, front, W / 2, y - 0.36, front, 0.2, "#5c3f25"), J.log(-W / 2, y - 0.38, z0 + 0.22, W / 2, y - 0.38, z0 + 0.22, 0.2, "#553a22"), ...[-1, 1].map((s) => moved(nut("husk", 0.09), s * end, y + 1.18, zr))];
    const rows = Math.floor(D / 0.4);
    for (let j = 0; j < rows; j++) {
      const z = z0 + D / rows * (j + 0.5);
      for (let x = -W / 2, k = 0; x < W / 2; k++) {
        let x1 = x + (k ? 6 + drand() * 4 : 2 + drand() * 5);
        if (x1 > W / 2 - 1.2) x1 = W / 2;
        round.push(halfLog(x + 0.012, y, z, x1 - 0.012, z, D / rows / 2 - 0.012, BARKS[(j + k) % 3]));
        x = x1;
      }
    }
    // The stairs: two log stringers up each and a half log across it for every tread, flat face up where the tread's
    // top is, with a bamboo handrail up each side, on a post at the foot and one halfway (and one at the head against
    // the wall, where no deck rail meets it), a rope slung under it (grown below).
    const ropes = [];
    for (const [fx, fz, hx, hz] of stairs) {
      const steps = Math.max(3, Math.round(y / 0.32)), len = Math.hypot(hx - fx, hz - fz), px = -(hz - fz) / len, pz = (hx - fx) / len;
      for (const s of [-1, 1]) {
        const ox = px * s * (stairW / 2 - 0.12), oz = pz * s * (stairW / 2 - 0.12);
        round.push(J.log(fx + ox, -0.12, fz + oz, hx + ox, y - 0.12, hz + oz, 0.13, "#5a3c22"));
      }
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps, x = fx + (hx - fx) * t, z = fz + (hz - fz) * t;
        round.push(halfLog(x - px * stairW / 2, y * t + 0.13, z - pz * stairW / 2, x + px * stairW / 2, z + pz * stairW / 2, 0.17, BARKS[i % 3]));
      }
      for (const s of [-1, 1]) {
        const ox = px * s * (stairW / 2 + 0.05), oz = pz * s * (stairW / 2 + 0.05), at = (t, h) => [fx + (hx - fx) * t + ox, y * t + h, fz + (hz - fz) * t + oz];
        for (const t of s === Math.sign(fx) ? [0, 0.5, 1] : [0, 0.5]) round.push(bambooRun(...at(t, 0), ...at(t, 0.99), 0.06, t ? "#cdb06a" : "#b8a04a"));
        round.push(bambooRun(...at(0, 1.04), ...at(1, 1.04), 0.055, "#b8a04a"));
        ropes.push([at(0, 0.52), at(0.5, 0.52), at(1, 0.52)]);
      }
    }
    for (const [x, z] of MEZZ_POSTS) {
      const k = 0.85 + rand() * 0.3;
      round.push(moved(turnedY(lathe({ profile: [[0, 0], [0.27 * k, 0], [0.31 * k, 0.1], [0.27 * k, 0.22], [0.15 * k, 0.3], [0, 0.32]], segments: 7, color: STONE[Math.floor(rand() * 3)] }), rand() * 6.3), x, 0, z));
      round.push(J.log(x, 0.2, z, x, y - 0.5, z, 0.2, "#5a3c22"));
      if (z > cz) round.push(J.lashing(x, 2.02, z, 0, 1, 0, 0.2));
    }
    for (let k = 0; k <= n; k++) round.push(bambooRun(rx(k), y, zr, rx(k), y + 0.99, zr, 0.06, k % 2 ? "#cdb06a" : "#b8a04a"));
    for (let k = 0; k < n; k += 4) round.push(bambooRun(rx(k) - (k ? 0 : 0.08), y + 1.04, zr, rx(Math.min(n, k + 4)) + (k + 4 < n ? 0 : 0.08), y + 1.04, zr, 0.055, "#b8a04a"));
    const { withJungle, garland, sagPoints, sprig, liana } = J, leaf = mulberry32(2029);
    const cols = MEZZ_POSTS.filter(([x, z]) => z > cz && Math.abs(x) < end).map(([x]) => x);
    const body = withJungle(shaded(round), (g) => {
      const rail = [], face = [];
      for (let k = 0; k < n; k++) {
        rail.push(...sagPoints(rx(k), y + 1, z1 + 0.06, rx(k + 1), y + 1, z1 + 0.06, 0.2, 4).slice(k ? 1 : 0));
        liana(g, sagPoints(rx(k), y + 0.52, zr + 0.07, rx(k + 1), y + 0.52, zr + 0.07, 0.08, 3), 0.022, 0.022, "#c9a36a");
      }
      for (let k = 0; k <= n; k++) for (const h of [0.9, 0.52]) liana(g, [[rx(k), y + h - 0.035, zr], [rx(k), y + h + 0.035, zr]], 0.074, 0.074, "#c9a36a");
      for (const pts of ropes) for (let k = 0; k + 1 < pts.length; k++) liana(g, sagPoints(...pts[k], ...pts[k + 1], 0.06, 3), 0.022, 0.022, "#c9a36a");
      garland(g, rail, { r: 0.03, every: 0.45, size: 0.26, droop: 0.55, out: [0, 0, 1], rand: leaf });
      for (const s of [-1, 1]) sprig(g, s * end, y + 1, z1 + 0.06, 0, 0.6, 1, 4, 0.3, leaf);
      for (let k = 0; k + 1 < cols.length; k++) face.push(...sagPoints(cols[k], y - 0.19, z1 + 0.05, cols[k + 1], y - 0.19, z1 + 0.05, 0.1, 6).slice(k ? 1 : 0));
      garland(g, face, { r: 0.035, every: 0.5, size: 0.22, droop: 0.75, out: [0, 0, 1], rand: leaf });
      // The front posts' branches, from over head height up under the fascia, none toward the wall at the ends.
      for (const [x, z] of MEZZ_POSTS) if (z > cz) for (const s of [-1, 1]) {
        if (Math.abs(x + s) > HALL.halfW - 0.4) continue;
        liana(g, [[x + s * 0.12, 2.32, z], [x + s * 0.5, 2.5, z + 0.02], [x + s * 0.85, y - 0.54, front]], 0.075, 0.06, "#5c3f25");
      }
    });
    return { body };
  });
  // The jackpot wheel on its totem behind the stage, facing the doorway: `face` is the spinning millstone, a
  // thick disc of stone with twenty wedges daubed on it by hand in charcoal, ochre, umber and red earth (the
  // jackpot gold), their edges wobbling short of a carved groove between each two and the stone showing through each
  // in specks, each with its ticket value brushed on in charcoal or bone and a banana, a hand or a coconut beside the
  // value on four (`WHEEL_ART`); bone pegs round its edge and a stone boss ringed in bone with a banana; its back, seen
  // from the deck, daubed with a sun and handprints. `frame` is the turned timber hoop round it bound in rope and
  // lashed in four places, a bone tusk hanging from a timber bracket for the clapper, BIG SPIN brushed in gold round
  // the hoop's top either side of it, leaves bunched behind the side lashings, and the pedestal, a log totem carved
  // with a tiki face between two bone bands on a stone plinth that stands on the floor, ferns at its foot; nothing
  // stands over the hoop into the big sign behind it. `bulbs` the two clusters of seed pods hanging on vines from the
  // side lashings, as three geometries (the first, second and third pod of each), so the scene can chase them.
  // Where the mezzanine's log posts stand, [x, z] in the hall, on the interior kit's deck grid (`deckPosts`).
  const MEZZ_POSTS = BL.models.deckPosts(HALL.halfW * 2 - 0.1, MEZZ.z1 - MEZZ.z0).map(([x, z]) => [x, z + (MEZZ.z0 + MEZZ.z1) / 2]);
  // The wheel's game: a spin costs `WHEEL_COST` tickets and pays the value of the wedge the clapper stops on. One
  // jackpot at ten spins' cost (gold) opposite the 1, the three at or near the cost spread round it, and the small ones
  // between, so small and big alternate round the face: 340 tickets in all, a spin pays back 17 of its 20 on average
  // (85%), and the house wins slowly.
  const WHEEL_VALUES = [200, 2, 10, 5, 20, 2, 10, 2, 25, 2, 1, 2, 15, 5, 10, 2, 10, 5, 10, 2], WHEEL_COST = 20;
  // The face turns by its `rotation.z`, clockwise from the front as the turn falls, under the clapper at its top, a
  // quarter turn round from where wedge 0 begins: `wheelAt(a)` is the wedge under the clapper at the turn a, and
  // `wheelStop(a, wedge, at, turns)` the turn, `turns` whole turns and less than one more clockwise from a, that stops
  // the clapper `at` (0 to 1) of the way across `wedge`.
  const WHEEL_ARC = Math.PI * 2 / WHEEL_VALUES.length;
  const wheelAt = (a) => {
    const n = WHEEL_VALUES.length, k = Math.floor((Math.PI / 2 - a) / WHEEL_ARC) % n;
    return k < 0 ? k + n : k;
  };
  const wheelStop = (a, wedge, at, turns) => {
    const TAU = Math.PI * 2, gap = ((a - Math.PI / 2 + (wedge + at) * WHEEL_ARC) % TAU + TAU) % TAU;
    return a - turns * TAU - gap;
  };
  const WHEEL_PAINT = ["#3a302a", "#c8862c", "#5a4a3a", "#a8502e"];
  // The wedges with a pictograph by their value: [wedge, PICTOS name].
  const WHEEL_ART = [[1, "banana"], [5, "hand"], [12, "coconut"], [16, "banana"]];
  // Where the hoop is lashed, as angles round it; pods hang from the first two, at its sides.
  const WHEEL_TIES = [0, Math.PI, Math.PI * 1.25, Math.PI * 1.75];
  const wheel = cached(() => {
    const R = LAYOUT.wheel.r, n = WHEEL_VALUES.length, face = [], round = [], flat = [], bulbs = [[], [], []], paint = geometry(), P = R * 0.86, IN = 0.37, hand = mulberry32(2026);
    // The millstone, its front at z 0.02; the paint and the grooves lie a hair proud of it.
    face.push(turnedX(turn([[0, -0.1], [R - 0.03, -0.1], [R + 0.01, -0.06], [R + 0.01, 0], [R - 0.03, 0.02], [0, 0.02]], 40, "#6e655c"), Math.PI / 2));
    const polar = (a, d) => [Math.cos(a) * d, Math.sin(a) * d], wobble = (s) => (hand() - 0.5) * s;
    // A daub of paint on the outline `pts`, fanned from its middle so a wobbling edge stays whole.
    const daub = (pts, z, color, e) => {
      const rgb = hexToRgb(color), ids = ccw(pts).map(([x, y]) => pushVert(paint, x, y, z));
      const c = pushVert(paint, pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length, z);
      for (let k = 0; k < ids.length; k++) paint.faces.push({ i: [c, ids[k], ids[(k + 1) % ids.length]], color: rgb, emissive: e });
    };
    for (let k = 0; k < n; k++) {
      const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2, mid = (a0 + a1) / 2, jackpot = WHEEL_VALUES[k] >= WHEEL_COST * 10, color = jackpot ? "#e0a238" : WHEEL_PAINT[k % WHEEL_PAINT.length];
      const [cr, cg, cb] = hexToRgb(color), light = cr * 0.3 + cg * 0.59 + cb * 0.11 > 110, ink = jackpot ? "#6a1c10" : light ? "#1c1410" : BONE;
      // The wedge's outline: out along one side a finger short of the groove, round the outer edge and back, each
      // point pushed a little off true as a hand paints.
      const pts = [], lo = IN + 0.03, hi = P - 0.02;
      for (let j = 0; j <= 4; j++) { const r = lo + (hi - lo) * j / 4 + wobble(0.012); pts.push(polar(a0 + (0.026 + wobble(0.02)) / r, r)); }
      for (let j = 1; j < 5; j++) pts.push(polar(a0 + (a1 - a0) * j / 5, hi + wobble(0.032)));
      for (let j = 4; j >= 0; j--) { const r = lo + (hi - lo) * j / 4 + wobble(0.012); pts.push(polar(a1 - (0.026 + wobble(0.02)) / r, r)); }
      pts.push(polar(mid, lo + wobble(0.01)));
      daub(pts, 0.022, color, jackpot ? 0.25 : 0.05);
      // The stone showing through in specks.
      for (let j = 0; j < 6; j++) {
        const r = lo + 0.06 + hand() * (hi - lo - 0.12), a = a0 + (0.04 + hand() * (r * (a1 - a0) - 0.08)) / r, s = 0.008 + hand() * 0.014;
        daubDot(paint, ...polar(a, r), s, s * (0.6 + hand() * 0.4), hand() < 0.5 ? "#6e655c" : "#7e756a", 0, hand() * 3, 0.0224, 6);
      }
      const [x0, y0] = polar(a0, IN), [x1, y1] = polar(a0, P), [gx, gy] = polar(a0 + Math.PI / 2, 0.011);
      daubPoly(paint, [[x0 - gx, y0 - gy], [x1 - gx, y1 - gy], [x1 + gx, y1 + gy], [x0 + gx, y0 + gy]], "#2a1e16", 0, 0.0235);
      const value = brushWord(geometry(), String(WHEEL_VALUES[k]), 0, 0, 0.17, 0.027, ink, ink === BONE ? 0.25 : 0);
      face.push(moved(turnedZ(value, Math.cos(mid) < 0 ? mid + Math.PI : mid), Math.cos(mid) * R * 0.66, Math.sin(mid) * R * 0.66, 0.026));
      face.push(moved(turnedX(turn([[0.022, 0], [0.022, 0.1], [0.032, 0.12], [0, 0.13]], 8, BONE), Math.PI / 2), Math.cos(a0) * R * 0.96, Math.sin(a0) * R * 0.96, 0.02));
      const art = WHEEL_ART.find(([w]) => w === k);
      if (art) face.push(moved(turnedZ(pictograph(PICTOS[art[1]], 0.11, light ? [EARTH_BLACK, EARTH_RED, EARTH_CHALK] : [EARTH_CHALK, EARTH_OCHRE, EARTH_BLACK], 0.12), mid - Math.PI / 2), ...polar(mid, 0.58), 0.0229));
    }
    face.push(paint);
    // The back, facing -z: a sun spiral in ochre in a ring of red and chalk handprints and ochre dots.
    const back = geometry();
    daubSpiral(back, 0, 0, 0.5, 0.09, EARTH_OCHRE, 0.12);
    for (let k = 0; k < 6; k++) { const t = (k + 0.5) / 6 * Math.PI * 2; daubHand(back, Math.cos(t) * 1.02, Math.sin(t) * 1.02, 0.36, t - Math.PI / 2, k % 2 ? EARTH_CHALK : EARTH_RED, 0.12); }
    for (let k = 0; k < 18; k++) { const t = k / 18 * Math.PI * 2; daubDot(back, Math.cos(t) * 1.34, Math.sin(t) * 1.34, 0.04, 0.04, EARTH_OCHRE, 0.12, 0, 0, 6); }
    face.push(moved(turnedY(back, Math.PI), 0, 0, -0.104));
    const hub = shaded([turnedX(turn([[0.34, 0], [0.34, 0.05], [0.26, 0.09], [0.12, 0.14], [0, 0.15]], 20, "#7a7066"), Math.PI / 2), turnedX(torus(0.3, 0.03, BONE, 0, 20, 6), Math.PI / 2)]);
    face.push(moved(hub, 0, 0, 0.02), moved(turnedZ(scaled(BL.models.bananaGeometry(), 1.2), 0.5), 0, -0.05, 0.19));
    round.push(turnedX(turn([[R + 0.24, -0.12], [R + 0.26, 0], [R + 0.24, 0.12], [R + 0.02, 0.12], [R + 0.02, -0.12]], 56, TIMBER_DK), Math.PI / 2));
    round.push(turnedX(torus(R + 0.25, 0.03, ROPE, 0, 56, 6), Math.PI / 2));
    // The lashings round the hoop, and a cluster of pods hanging under each side one, each its own size and tilt.
    for (const a of WHEEL_TIES) round.push(BL.hubModels.lashing(...polar(a, R + 0.14), 0, -Math.sin(a), Math.cos(a), 0, 0.17));
    for (const s of [1, -1]) [[0, -0.05, 0.02, 2.2], [0.06, 0, -0.02, 1.8], [-0.05, 0.02, 0.05, 1.6]].forEach(([dx, dy, dz, size], j) => {
      bulbs[j].push(moved(turnedZ(seedPod(size > 2 ? "#ff8a36" : "#ffb44a", size), s * (dx * 2 + wobble(0.2))), s * (R + 0.34 + dx), -0.26 + dy, 0.14 + dz));
    });
    // The clapper: a bone tusk hanging from a timber bracket on the rim's top, its tip curled toward the pegs.
    flat.push(bevelBox({ w: 0.3, h: 0.1, d: 0.2, color: TIMBER_DK, bevel: 0.02, offset: { y: R + 0.3, z: 0.1 } }));
    round.push(moved(turnedZ(boneTusk(0.3, 0.04, 0.9), Math.PI), 0, R + 0.29, 0.08));
    // The pedestal on its own footing on the floor (`WHEEL_FOOT`): a broad stone slab under a stone drum, a log totem
    // up from it with a tiki face at eye height between two bone bands, bound in rope under the yoke that holds the rim.
    const y = LAYOUT.wheel.y, J = BL.hubModels, face0 = -y + 1.6, rand = mulberry32(4040), fr = WHEEL_FOOT.r, fz = WHEEL_FOOT.z;
    round.push(moved(turn([[fr, 0], [fr, 0.1], [fr - 0.05, 0.15], [fr - 0.12, 0.17], [fr - 0.12, 0.52], [fr - 0.2, 0.6], [0.2, 0.64], [0, 0.64]], 16, "#5e554c"), 0, -y, fz));
    round.push(J.log(0, -y + 0.6, fz, 0, -R + 0.05, fz, 0.2), J.lashing(0, -R - 0.32, fz, 0, 1, 0, 0.2));
    round.push(moved(torus(0.215, 0.03, BONE, 0, 16, 5), 0, face0 - 0.39, fz), moved(torus(0.215, 0.03, BONE, 0, 16, 5), 0, face0 + 0.43, fz));
    for (const sx of [-1, 1]) {
      round.push(moved(turnedX(turn([[0.06, 0], [0.06, 0.02], [0, 0.03]], 12, BONE), Math.PI / 2), sx * 0.085, face0 + 0.05, 0));
      round.push(moved(turnedX(turn([[0.028, 0], [0.028, 0.012], [0, 0.018]], 10, "#1c1410"), Math.PI / 2), sx * 0.085, face0 + 0.05, 0.022));
    }
    flat.push(
      bevelBox({ w: 0.34, h: 0.52, d: 0.2, color: TIMBER_LT, bevel: 0.04, offset: { y: face0, z: -0.1 } }),
      bevelBox({ w: 0.38, h: 0.07, d: 0.06, color: TIMBER_DK, bevel: 0.02, offset: { y: face0 + 0.14, z: 0.01 } }),
      moved(prism(ccw([[0, 0.06], [0.045, -0.05], [-0.045, -0.05]]), 0.05, TIMBER_DK), 0, face0 - 0.03, 0.02),
      box({ w: 0.24, h: 0.08, d: 0.03, color: "#1c1410", offset: { y: face0 - 0.15, z: 0.005 } }),
      ...[-0.07, 0, 0.07].map((x) => box({ w: 0.04, h: 0.045, d: 0.02, color: BONE, offset: { x, y: face0 - 0.13, z: 0.02 } }))
    );
    for (const sx of [-1, 1]) flat.push(beam(sx * 0.12, -R - 0.05, -0.25, sx * 0.4, -R * 0.55, -0.14, 0.1, TIMBER));
    // BIG SPIN in gold on the hoop's front round its top, BIG left of the clapper's bracket and SPIN right of it, each
    // word brushed flat and bent along the rim, its letters standing out from the middle.
    const onRim = (s, mid) => {
      const g = brushWord(geometry(), s, 0, 0, 0.15, 0.03, "#f2c46a", 0.4), v = g.verts, rho = R + 0.14;
      for (let i = 0; i < v.length; i += 3) { const a = mid - v[i] / rho, d = rho + v[i + 1]; v[i] = Math.cos(a) * d; v[i + 1] = Math.sin(a) * d; v[i + 2] += 0.125; }
      return g;
    };
    flat.push(onRim("BIG", Math.PI / 2 + 0.24), onRim("SPIN", Math.PI / 2 - 0.28));
    const lit = bulbs.map((pods) => unshadowed(merge(...pods)));
    const frame = J.withJungle(shaded(round, flat), (g) => {
      for (const [x, z, dx, dz] of [[-0.46, 0.1, -0.6, 0.5], [0.46, 0.1, 0.6, 0.5], [0, -0.48, 0, -1]]) J.sprig(g, x, -y + 0.15, fz + z, dx, 1, dz, 4, 0.28, rand);
      // Leaves bunched behind each side lashing over its pods, reaching out from the hoop well below its top.
      for (const s of [-1, 1]) J.sprig(g, s * (R + 0.16), 0.1, -0.16, s, 0.3, -0.25, 4, 0.3, rand);
      // The pods' vines, from under each side lashing down to its cluster.
      for (const s of [-1, 1]) J.liana(g, [[s * (R + 0.3), -0.07, 0.12], [s * (R + 0.33), -0.13, 0.15], [s * (R + 0.34), -0.19, 0.16]], 0.016, 0.01);
    });
    return { face: merge(...face), frame, bulbs: lit };
  });

  // The frame round the big sign on the back wall, the Oogas' own: three rough stone slabs laid behind it, a log post
  // up each side and a log lintel across the top lashed to them, a mammoth's tusks set in stone lumps at the posts'
  // feet curving up either side, a big bone
  // on the lintel's middle, a leafy garland slung along it in scallops and a spray of leaves at each corner, rope
  // bound round each end of the carved sign over its corner plates; and a tiki torch leaning out from the wall each
  // side, a bamboo pole pegged and lashed to the wall under a woven head. `bulbs` is their fire, the only lit faces
  // (the scene flickers it). The scene hangs the carved sign, `name` under its `icon`, `w` - 0.9 wide and 0.08 in
  // front of it.
  const SIGN_FRAME = { w: 7.4, h: 2.3, name: "Ooga Arcade", icon: "banana" };
  // Rope bound round each end of a carved sign over its iron corner plates (the island's `caveSign`, shared, keeps
  // its iron), for the sign `text` with `icon` as the scene hangs it, scaled to `width` across and centred on
  // (x, y, z): three turns wrapped up the planks' face just outside the post, over the top and under the foot, the
  // middle one a shade darker, covering both plates and their rivets. Flat parts, built once per sign in its own
  // units (`bindings`).
  const bindings = new Map();
  const signBinding = (text, icon, width, x, y, z) => {
    const sign = BL.hubModels.caveSign(text, icon), b = BL.scene.boundsOf(sign), k = width / (b.max[0] - b.min[0]), key = `${text}|${icon}`;
    let turns = bindings.get(key);
    if (!turns) {
      const half = sign.signHeight / 2 + 0.015, front = b.max[2] + 0.01, back = b.min[2] - 0.015;
      turns = [];
      for (const sx of [-1, 1]) for (let t = 0; t < 3; t++) {
        const cx = sx * (sign.signWidth / 2 - 0.17) + (t - 1) * 0.085, color = t === 1 ? "#a8844e" : ROPE;
        turns.push(bevelBox({ w: 0.08, h: half * 2 + 0.03, d: 0.03, color, bevel: 0.008, offset: { x: cx, z: front - 0.015 } }));
        for (const sy of [-1, 1]) turns.push(box({ w: 0.08, h: 0.03, d: front - back, color, offset: { x: cx, y: sy * half, z: (front + back) / 2 } }));
      }
      bindings.set(key, turns);
    }
    return turns.map((p) => moved(scaled(p, k), x, y, z));
  };
  const signFrame = cached(() => {
    const { w, h } = SIGN_FRAME, J = BL.hubModels, X = w / 2 + 0.25, Y = h / 2 + 0.2, round = [], flat = signBinding(SIGN_FRAME.name, SIGN_FRAME.icon, w - 0.9, 0, 0, 0.08), fire = [], rand = mulberry32(8303);
    for (const [x, y, sw, sh, k] of [[-1.9, 0.12, 4.4, h + 0.7, 0.94], [1.8, -0.08, 4.6, h + 0.55, 1.06], [0.1, 0.05, 2.6, h + 0.85, 1]]) {
      flat.push(bevelBox({ w: sw, h: sh, d: 0.16, color: tint("#5e554c", k), bevel: 0.07, offset: { x, y, z: -0.22 + (k - 1) * 0.2 } }));
    }
    for (const sx of [-1, 1]) round.push(J.log(sx * X, -Y - 0.55, 0.02, sx * X, Y + 0.3, 0.02, 0.15), J.lashing(sx * X, Y, 0.02, 0, 1, 0, 0.15));
    round.push(J.log(-X - 0.45, Y, 0.1, X + 0.45, Y, 0.1, 0.14), moved(boneBar(1.3, 0.08), 0, Y + 0.24, 0.16));
    for (const sx of [-1, 1]) {
      // The tusk, set in a stone lump at the post's foot.
      round.push(moved(turnedY(boneTusk(2.9, 0.16, 1.5), -sx * 1.27), sx * (X + 0.42), -Y - 0.35, 0.12));
      round.push(moved(turn([[0, -0.2], [0.26, -0.17], [0.34, -0.02], [0.3, 0.12], [0.16, 0.2], [0, 0.22]], 10, tint("#5e554c", 0.9 + sx * 0.06)), sx * (X + 0.3), -Y - 0.42, 0.06));
      // The torch: its pole from the wall below out to the head, a peg into the wall and a lashing round both.
      const x = sx * (X + 1.3), d = [sx * 0.14, 2.2, 0.9], l = Math.hypot(...d), top = [x + d[0], -1.25 + d[1], -0.3 + d[2]];
      round.push(J.bamboo(x, -1.25, -0.3, ...top, 0.05), J.log(x, -0.62, -0.45, x + sx * 0.04, -0.62, -0.02, 0.045), J.lashing(x + sx * 0.04, -0.62, -0.04, ...d, 0.05));
      round.push(along(turn([[0.05, -0.18], [0.12, -0.08], [0.16, 0.05], [0.17, 0.1], [0.13, 0.12], [0, 0.08]], 10, "#8a6a3a"), ...top, ...d));
      fire.push(moved(flame(0.62), top[0] + d[0] / l * 0.1, top[1] + d[1] / l * 0.1, top[2] + d[2] / l * 0.1));
    }
    const frame = J.withJungle(shaded(round, flat), (g) => {
      const ties = [-X, -X / 2, 0, X / 2, X], points = [];
      for (let k = 0; k < 4; k++) points.push(...J.sagPoints(ties[k], Y + 0.1, 0.2, ties[k + 1], Y + 0.1, 0.2, 0.1, 4).slice(k ? 1 : 0));
      J.garland(g, points, { r: 0.04, every: 0.5, size: 0.34, droop: 0.1, out: [0, 0.7, 0.7], rand });
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) J.sprig(g, sx * (X + 0.12), sy * (Y + 0.12), 0.12, sx, sy, 0.4, 4, 0.42, rand);
    });
    return { frame, bulbs: unshadowed(merge(...fire)) };
  });

  // ---- the Oogas' trim ------------------------------------------------------------------------------------
  // What the island gives, for the cabinets, the signs and the boards: a curved bone tusk and a small bone (round
  // parts for `shaded`), and a long two-tone leaf and a broad arching banana leaf written into a
  // `hubModels.withJungle` geometry.
  // A tusk `len` long, `r` thick at its root on the origin and tapering to a point: it rises up +y and curls toward
  // +z, near straight at the root and hooking over at the tip (`curl` radians in all). In another `color` and ending
  // blunt, `end` times its root's thickness, it is a trunk.
  const boneTusk = (len, r, curl, color = BONE, end = 0) => {
    const n = 8, rows = [[0, 0]], ay = [0], az = [0], ang = [0];
    for (let k = 1; k <= n; k++) {
      const m = curl * ((k - 0.5) / n) ** 3;
      ay.push(ay[k - 1] + Math.cos(m) * len / n); az.push(az[k - 1] + Math.sin(m) * len / n); ang.push(curl * (k / n) ** 3);
    }
    for (let k = 0; k <= n; k++) rows.push([r * (end + (1 - end) * (1 - k / n) ** 0.7), k / n * len]);
    if (end) rows.push([0, len]);
    // Each ring of the straight lathe stands on the curled spine, turned with it.
    const geo = turn(rows, 8, color), v = geo.verts;
    for (let i = 0; i < v.length; i += 3) {
      const k = Math.round(v[i + 1] / len * n), z = v[i + 2];
      v[i + 1] = ay[k] - z * Math.sin(ang[k]); v[i + 2] = az[k] + z * Math.cos(ang[k]);
    }
    return geo;
  };
  // A bone lying along x, `len` long: a shaft between two double knobs.
  const boneBar = (len, r) => merge(turnedZ(turn([[0, -len / 2], [r, -len / 2], [r, len / 2], [0, len / 2]], 8, BONE), Math.PI / 2),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sy) => moved(ball(r * 1.6, BONE, 6), sx * len / 2, sy * r, 0))));
  // A leaf from (x, y, z) along (ax, ay, az), its face turned toward (nx, ny, nz), `len` long and `broad` times the
  // kit leaf's width: `tone` is [light, dark] rgb for its two halves.
  const leafBlade = (g, x, y, z, ax, ay, az, nx, ny, nz, len, broad, tone) => {
    let l = Math.hypot(ax, ay, az);
    ax /= l; ay /= l; az /= l;
    const d = nx * ax + ny * ay + nz * az;
    nx -= d * ax; ny -= d * ay; nz -= d * az;
    l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    BL.hubModels.pointedLeaf(g, x, y, z, ax, ay, az, (ay * nz - az * ny) * broad, (az * nx - ax * nz) * broad, (ax * ny - ay * nx) * broad, nx, ny, nz, len, tone[0], tone[1]);
  };
  const IVY_TONES = [["#6fae3a", "#3f7a2b"], ["#86c24a", "#4f8f36"]].map((p) => p.map(hexToRgb));
  // A broad banana leaf, about 60 triangles: from a short stalk at (x, y, z) its midrib heads `yaw` round from -z
  // toward +x, rising at `up` radians and bending evenly over to `down` at its tip, `len` long, so it arches over and
  // droops. The blade is `broad` wide each side of the midrib at its widest, its halves folded down off the rib and
  // lit by the fold; `face` rolls it about the rib so its top turns toward +z (the front) the more it heads sideways,
  // and a tear notches its +x-side edge at rung `tear` (the other edge when negative, none at 0). Two-tone down the
  // midrib, deep green at the stalk and lighter to the tip: `tone` is [light, dark, tip light, tip dark] rgb.
  const LEAF_RUNGS = [[0, 0.1], [0.14, 0.14], [0.26, 0.7], [0.4, 0.98], [0.55, 1], [0.69, 0.88], [0.81, 0.66], [0.92, 0.38], [1, 0]];
  const BANANA_LEAF_TONES = [["#4a8f36", "#2f6a26", "#8ccb52", "#66a63c"], ["#549a3c", "#38752c", "#9ad35e", "#72b046"], ["#428535", "#2a6024", "#80c04c", "#5c9c38"]].map((p) => p.map(hexToRgb));
  const bananaLeaf = (g, x, y, z, { yaw, up, down, len, broad, face = 0, tone, tear = 0 }) => {
    const hx = Math.sin(yaw), hz = -Math.cos(yaw), roll = -hx * face, cr = Math.cos(roll), sr = Math.sin(roll), rows = [];
    const mix = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * t));
    const vert = (px, py, pz, nx, ny, nz) => { g.verts.push(px, py, pz); g.normals.push(nx, ny, nz); return g.verts.length / 3 - 1; };
    let s0 = 0;
    for (let k = 0; k < LEAF_RUNGS.length; k++) {
      // Walk the midrib to this rung at the pitch halfway there, then frame the rung: out of the leaf's top and
      // across it, rolled about the rib.
      const [s, width] = LEAF_RUNGS[k], mid = up + (down - up) * (s0 + s) / 2, step = (s - s0) * len, p = up + (down - up) * s;
      x += Math.cos(mid) * hx * step; y += Math.sin(mid) * step; z += Math.cos(mid) * hz * step; s0 = s;
      const n0 = [-hx * Math.sin(p), Math.cos(p), -hz * Math.sin(p)], a0 = [-hz, 0, hx];
      const n = n0.map((v, j) => v * cr - a0[j] * sr), a = a0.map((v, j) => v * cr + n0[j] * sr);
      rows.push((width ? [1, 0, -1] : [0]).map((side) => {
        const w = broad * width * (tear && tear === side * k ? 0.45 : 1) * side, fold = Math.abs(w) * 0.3, m = side * 0.5;
        const l = Math.hypot(n[0] + a[0] * m, n[1] + a[1] * m, n[2] + a[2] * m);
        return vert(x + a[0] * w - n[0] * fold, y + a[1] * w - n[1] * fold, z + a[2] * w - n[2] * fold, (n[0] + a[0] * m) / l, (n[1] + a[1] * m) / l, (n[2] + a[2] * m) / l);
      }));
    }
    const both = (ids, color) => g.faces.push({ i: ids, color, emissive: 0 }, { i: ids.slice().reverse(), color, emissive: 0 });
    for (let k = 1; k < rows.length; k++) {
      const t = (LEAF_RUNGS[k - 1][0] + LEAF_RUNGS[k][0]) / 2, lo = rows[k - 1], hi = rows[k];
      const light = mix(tone[0], tone[2], t), dark = mix(tone[1], tone[3], t);
      if (hi.length === 1) { both([lo[0], lo[1], hi[0]], light); both([lo[1], lo[2], hi[0]], dark); }
      else { both([lo[0], lo[1], hi[1], hi[0]], light); both([lo[1], lo[2], hi[2], hi[1]], dark); }
    }
  };
  // A round part written into a `withJungle` geometry with its normals unset, so the renderer shades it smooth.
  const tuck = (g, part) => {
    const base = g.verts.length / 3;
    for (const v of part.verts) g.verts.push(v);
    for (const f of part.faces) g.faces.push({ ...f, i: f.i.map((k) => base + k) });
    BL.hubModels.padNormals(g);
  };

  // ---- a cabinet ----------------------------------------------------------------------------------------
  // The classic upright as the Oogas carve it, facing +z on y 0. Each side is the profile (base and control shelf,
  // the screen's slope, the marquee's overhang) cut from rough timber planks laid edge to edge, or from three stone
  // slabs on the stone cabinets, with a bark edge (a chipped darker stone one on the slabs) and a rope run down its
  // front edge, lashed round it by the screen and the marquee. The game's colour goes on only as cave paint: a
  // pictograph of its game on each side (a mammoth, an Ooga, a banana, a spiral or a coconut on the dark ones) over a
  // row of bone dots, a handprint or a spiral by the screen and dots or a zigzag along the marquee; and as two
  // handprints glowing where a player slaps to play, on a natural hide stretched over the front (`HIDE_TONES`: a
  // leopard's tan, a tiger's brown or a spotted beast's near-black, only a touch of the game's colour in it) and
  // stitched round in rope. It stands on two bark logs with a bamboo post lashed up each front corner of the base; a
  // timber kick board, and a tiki mouth carved in the hide (`tikiMouth`) that takes the coin, an ember in its throat;
  // a timber control shelf with a hide top, a coconut on a bone lever and three big husk-brown coconut-shell buttons
  // in an arc, each with a dot of paint on top, and a scrap of hide for the rules; the screen in a rough stone bezel
  // with painted corners; a marquee of warm hide catching the screen's and the fires' light behind the carved sign
  // (`MARQUEE`, rope bound over its corner plates) between two timber rails, a bone tusk hooking up each side of it,
  // and on the plank lid a log crest
  // carved into a tiki's brow and eyes, the fire in their pupils, so each cabinet stands as a totem. Tucked
  // in behind the crest a few broad banana leaves arch back and out, drooping at their tips, with a flower or a hand
  // of bananas on some; a liana climbs one
  // back corner (the +x one on even slots, -x on odd) with ivy leaves on it and over the top to the leaves.
  // `collisionGeometry` is the carved body without the paint, the
  // rope, the leaves and the vine, a closed shell for the island's solids.
  const SIDE = [
    [[0.45, 0], [0.45, 0.98], [0.15, 1.08], [-0.45, 1.08], [-0.45, 0]],
    [[0.15, 1.08], [-0.45, 1.08], [-0.45, 1.8], [0, 1.8]],
    [[0.32, 1.8], [-0.45, 1.8], [-0.45, 2.14], [0.32, 2.14]]
  ];
  const EDGE = [[0.45, 0.02], [0.45, 0.98], [0.15, 1.08], [0, 1.8], [0.32, 1.8], [0.32, 2.14], [-0.45, 2.14], [-0.45, 0.02]];
  const SCREEN = { y: 1.44, z: 0.09, lean: -0.21, w: 0.88, h: 0.66 };
  // Where each side's planks meet, bottom to top; a stone cabinet's three slabs meet only where its profile turns.
  const PLANKS = [0, 0.29, 0.56, 0.82, 1.08, 1.45, 1.8, 2.14], SLABS = [0, 1.08, 1.8, 2.14], PLANK_TONES = [1, 1.1, 0.92, 1.05, 0.96, 1.12, 0.94];
  const BARK = "#46301e", ROPE = "#c9a36a", STONE_LT = "#6b6259";
  // A colour mixed t of the way to another, and a game's bright colour as cave paint (earthed toward sienna) and as a
  // leather hide, nearly all the natural hide `base` with a touch of the colour in it.
  const blend = (a, b, t) => { const q = hexToRgb(b); return `#${hexToRgb(a).map((v, k) => Math.round(v + (q[k] - v) * t).toString(16).padStart(2, "0")).join("")}`; };
  const earth = (hex) => blend(hex, "#a0643a", 0.35), leather = (hex, base = "#6b4528") => blend(hex, base, 0.88);
  // The fronts' hides by their markings (leopard, tiger, spotted): tan, brown and near-black, duller than the `hide`
  // kit's furs (`HIDES`) so a touch of the game's colour shows in them.
  const HIDE_TONES = ["#b08a56", "#8e5a30", "#4e3a2c"];
  // Where the scene hangs each cabinet's carved sign on its marquee: its middle and its width.
  const MARQUEE = { y: 1.97, z: 0.335, w: 0.82 };
  // A convex outline in the (z, y) plane cut to the band lo <= y <= hi.
  const band = (pts, lo, hi) => {
    let out = pts;
    for (const [edge, keep] of [[lo, 1], [hi, -1]]) {
      const src = out;
      out = [];
      for (let k = 0; k < src.length; k++) {
        const a = src[k], b = src[(k + 1) % src.length], da = (a[1] - edge) * keep, db = (b[1] - edge) * keep;
        if (da >= 0) out.push(a);
        if (da * db < 0) out.push([a[0] + (b[0] - a[0]) * da / (da - db), edge]);
      }
    }
    return out;
  };
  // Cave paint: pictographs in a unit box, u toward the front and v up, as strokes [kind, ink, ...]: "L" a bar from
  // (u0, v0) to (u1, v1) `w` wide, "P" a convex patch, "D" a dot at (u, v) of radius r. Ink 0 is the paint, 1 the
  // second colour, 2 bone. `arc` strokes a curve of radius r(t) round (cu, cv), swelling from w0 to w1 at its middle;
  // `dots` is a row of dots, `zigzag` a band of separate bars (where `daubZigzag` brushes one round-ended stroke), and
  // `mirror` flips the strokes left to right before they are drawn (where `mirroredX` flips a drawn geometry).
  const arc = (ink, cu, cv, r, a0, a1, n, w0, w1) => Array.from({ length: n }, (_, k) => {
    const p = (t) => [cu + Math.cos(a0 + (a1 - a0) * t) * r(t), cv + Math.sin(a0 + (a1 - a0) * t) * r(t)];
    const [u0, v0] = p(k / n), [u1, v1] = p((k + 1) / n);
    return ["L", ink, u0, v0, u1, v1, w0 + (w1 - w0) * Math.sin((k + 0.5) / n * Math.PI)];
  });
  const dots = (n, ink, gap, r) => Array.from({ length: n }, (_, k) => ["D", ink, (k - (n - 1) / 2) * gap, 0, r]);
  const zigzag = (n, ink) => Array.from({ length: n }, (_, k) => ["L", ink, (k - n / 2) * 0.9, k % 2 ? 0.45 : -0.45, (k + 1 - n / 2) * 0.9, k % 2 ? -0.45 : 0.45, 0.32]);
  const mirror = (ops) => ops.map(([kind, ink, ...a]) => kind === "L" ? [kind, ink, -a[0], a[1], -a[2], a[3], a[4]] : kind === "D" ? [kind, ink, -a[0], a[1], a[2]] : [kind, ink, a[0].map(([u, v]) => [-u, v])]);
  const PICTOS = {
    // Each game: the rally's kart with its Ooga and flag, the drop's chute, the orbit's rocket among stars, the
    // mine's pick over nuggets.
    race: [["P", 0, [[-0.8, -0.3], [0.85, -0.3], [0.7, 0.1], [-0.6, 0.1]]], ["D", 1, -0.5, -0.45, 0.22], ["D", 1, 0.55, -0.45, 0.22], ["D", 2, 0.1, 0.62, 0.17],
      ["L", 2, 0.1, 0.45, 0, 0.08, 0.12], ["L", 2, 0.05, 0.35, 0.55, 0.3, 0.09], ["L", 2, -0.7, 0.1, -0.7, 0.9, 0.06], ["P", 0, [[-0.68, 0.9], [-0.68, 0.58], [-0.25, 0.76]]]],
    drop: [["P", 0, [[-0.85, 0.3], [0.85, 0.3], [0.6, 0.7], [0, 0.88], [-0.6, 0.7]]], ["L", 2, -0.8, 0.3, -0.06, -0.2, 0.05], ["L", 2, 0.8, 0.3, 0.06, -0.2, 0.05],
      ["D", 2, 0, -0.12, 0.14], ["L", 2, 0, -0.25, 0, -0.6, 0.1], ["L", 2, 0, -0.6, -0.22, -0.9, 0.08], ["L", 2, 0, -0.6, 0.22, -0.9, 0.08], ["L", 2, 0, -0.32, -0.3, -0.18, 0.07], ["L", 2, 0, -0.32, 0.3, -0.18, 0.07]],
    orbit: [["P", 0, [[-0.22, -0.5], [0.22, -0.5], [0.22, 0.4], [0, 0.85], [-0.22, 0.4]]], ["P", 1, [[-0.22, -0.5], [-0.22, -0.05], [-0.5, -0.62]]], ["P", 1, [[0.22, -0.5], [0.5, -0.62], [0.22, -0.05]]],
      ["D", 2, 0, 0.22, 0.1], ["P", 1, [[-0.15, -0.56], [0.15, -0.56], [0, -0.95]]], ["D", 2, -0.7, 0.6, 0.06], ["D", 2, 0.66, 0.2, 0.05], ["D", 2, 0.55, 0.78, 0.06], ["D", 2, -0.6, -0.2, 0.05]],
    mine: [["L", 2, -0.6, -0.75, 0.3, 0.45, 0.1], ["L", 0, 0.3, 0.45, -0.1, 0.78, 0.11], ["L", 0, 0.3, 0.45, 0.72, 0.18, 0.11], ["D", 1, 0.45, -0.55, 0.13], ["D", 1, 0.74, -0.32, 0.09], ["D", 1, 0.16, -0.74, 0.08]],
    // The dark cabinets' own: a mammoth, a dancing Ooga with a club, a banana, a coconut, and the hands and spirals.
    mammoth: [["P", 0, [[-0.7, -0.2], [0.5, -0.25], [0.66, 0.05], [0.5, 0.45], [0, 0.6], [-0.55, 0.42]]], ["D", 0, 0.62, 0.22, 0.28], ["L", 0, 0.82, 0.12, 0.88, -0.45, 0.1], ["L", 0, 0.88, -0.45, 0.72, -0.6, 0.08],
      ["L", 2, 0.72, -0.02, 1, -0.22, 0.07], ["L", 0, -0.5, -0.15, -0.52, -0.8, 0.15], ["L", 0, -0.22, -0.2, -0.22, -0.8, 0.14], ["L", 0, 0.18, -0.2, 0.2, -0.8, 0.14], ["L", 0, 0.42, -0.2, 0.44, -0.8, 0.14],
      ["L", 0, -0.68, 0.1, -0.85, -0.2, 0.05], ["D", 2, 0.68, 0.32, 0.045]],
    ooga: [["D", 0, 0, 0.62, 0.2], ["L", 0, 0, 0.42, 0, -0.2, 0.13], ["L", 0, 0, 0.28, -0.5, 0.62, 0.1], ["L", 0, 0, 0.28, 0.45, 0.55, 0.1], ["L", 0, 0, -0.2, -0.35, -0.85, 0.11], ["L", 0, 0, -0.2, 0.35, -0.85, 0.11], ["L", 1, 0.45, 0.55, 0.65, 0.95, 0.15]],
    banana: [...arc(0, 0, 0.75, () => 1, -2.6, -0.55, 6, 0.12, 0.34), ["L", 1, 0.85, 0.27, 0.98, 0.46, 0.1]],
    coconut: [["D", 1, 0, -0.1, 0.62], ["D", 2, -0.2, 0.1, 0.1], ["D", 2, 0.2, 0.1, 0.1], ["D", 2, 0, -0.18, 0.1], ["L", 0, 0, 0.5, -0.5, 0.95, 0.12], ["L", 0, 0, 0.5, 0.5, 0.95, 0.12], ["L", 0, 0, 0.5, 0, 1, 0.12]],
    hand: [["P", 0, [[-0.32, -0.42], [0.32, -0.42], [0.38, 0.06], [0.22, 0.28], [-0.22, 0.28], [-0.38, 0.06]]], ["L", 0, -0.28, 0.18, -0.38, 0.7, 0.15], ["L", 0, -0.1, 0.24, -0.12, 0.86, 0.15],
      ["L", 0, 0.1, 0.24, 0.13, 0.9, 0.15], ["L", 0, 0.27, 0.18, 0.36, 0.72, 0.14], ["L", 0, 0.32, -0.12, 0.72, 0.18, 0.15]],
    spiral: arc(0, 0, 0, (t) => 0.1 + 0.85 * t, 0, Math.PI * 4.2, 22, 0.13, 0.13)
  };
  const TEASER_ART = ["mammoth", "ooga", "banana", "spiral", "coconut", "mammoth", "ooga", "banana"];
  const DOT = oval(1, 1, 6);
  // A pictograph in cave paint, flat in the (x, y) plane about the origin facing +z, `s` metres a unit, in `inks`
  // [paint, second, bone] with a faint `emissive`, as paint catches the light. Paint has no thickness: each stroke is
  // one `daubPoly` face, laid a hair over the one before so crossing strokes never flicker. Unlike the `daub*` brush
  // strokes, an "L" bar is square-ended and a "D" dot a hexagon, so a pictograph stays a few faces at any size: the
  // subjects `MARK` brushes big on the rock (a banana, a coconut, a mammoth, an Ooga, the games), cut down for trim.
  const pictograph = (ops, s, inks, emissive) => {
    const geo = geometry();
    ops.forEach(([kind, ink, ...a], k) => {
      let pts;
      if (kind === "L") {
        const x0 = a[0] * s, y0 = a[1] * s, x1 = a[2] * s, y1 = a[3] * s, l = Math.hypot(x1 - x0, y1 - y0) || 1, w = a[4] * s / 2;
        const ux = (x1 - x0) / l * w * 0.6, uy = (y1 - y0) / l * w * 0.6, nx = -(y1 - y0) / l * w, ny = (x1 - x0) / l * w;
        pts = [[x0 - ux - nx, y0 - uy - ny], [x1 + ux - nx, y1 + uy - ny], [x1 + ux + nx, y1 + uy + ny], [x0 - ux + nx, y0 - uy + ny]];
      } else pts = kind === "D" ? DOT.map(([u, v]) => [(a[0] + u * a[2]) * s, (a[1] + v * a[2]) * s]) : a[0].map(([u, v]) => [u * s, v * s]);
      daubPoly(geo, pts, inks[ink], emissive, k * 0.0003);
    });
    return geo;
  };
  // One side's cave paint, on its face at x (facing out from the cabinet): the cabinet's pictograph on the base over a
  // row of bone dots, then by its art style a handprint by the screen and bone dots along the marquee (0), a handprint
  // in the second colour and a zigzag (1), or a bone spiral and dots in the paint (2).
  const sideArt = (x, c, inks, emissive) => {
    const at = (ops, z, y, s, ink = inks) => moved(turnedY(pictograph(x > 0 ? mirror(ops) : ops, s, ink, emissive), x > 0 ? Math.PI / 2 : -Math.PI / 2), x, y, z);
    const second = [inks[1], inks[1], inks[2]], bone = [inks[2], inks[2], inks[2]];
    return [
      at(PICTOS[c.game >= 0 ? GAMES[c.game].id : TEASER_ART[c.index - 4]], 0, 0.58, 0.27),
      at(dots(7, 2, 0.95, 0.2), -0.02, 0.24, 0.11),
      c.art === 2 ? at(PICTOS.spiral, -0.2, 1.42, 0.15, bone) : at(PICTOS.hand, -0.2, 1.4, 0.17, c.art ? second : inks),
      c.art === 1 ? at(zigzag(7, 0), -0.05, 1.97, 0.1) : at(dots(6, c.art ? 0 : 2, 1.1, 0.26), -0.05, 1.97, 0.1)
    ];
  };
  // Markings on a hide stretched over x0..x1, y0..y1 facing +z at z, clear of `holes` ([x, y, r]): leopard rosettes
  // (0), tiger stripes in from its edges (1) or plain dark spots (2). Each blot is a lumpy nine-sided round.
  const BLOT = oval(1, 1, 9);
  const hideMarks = (kind, x0, x1, y0, y1, z, hide, holes, rand) => {
    const out = geometry(), dark = tint(hide, 0.42), clear = (x, y, r) => holes.every(([hx, hy, hr]) => Math.hypot(x - hx, y - hy) > r + hr);
    const blot = (x, y, r, color, lift) => daubPoly(out, BLOT.map(([u, v]) => [x + u * r * (1 + (rand() - 0.5) * 0.2), y + v * r * (0.85 + (rand() - 0.5) * 0.2)]), color, 0, z + lift);
    if (kind === 1) {
      for (let k = 0; k < 10; k++) {
        const side = k % 2 ? 1 : -1, y = y0 + (Math.floor(k / 2) + 0.5 + (rand() - 0.5) * 0.4) * (y1 - y0) / 5, x = side < 0 ? x0 : x1, reach = 0.16 + rand() * 0.14, w = 0.025 + rand() * 0.015;
        daubPoly(out, [[x, y - w], [x - side * reach, y - w * 0.4 - reach * 0.25], [x, y + w]], dark, 0, z);
      }
      return out;
    }
    for (let n = 0, tries = 0; n < (kind ? 14 : 9) && tries < 80; tries++) {
      const r = kind ? 0.02 + rand() * 0.025 : 0.035 + rand() * 0.015, x = x0 + r + rand() * (x1 - x0 - 2 * r), y = y0 + r + rand() * (y1 - y0 - 2 * r);
      if (!clear(x, y, r)) continue;
      blot(x, y, r, dark, 0);
      if (!kind) blot(x, y, r * 0.55, tint(hide, 0.8), 0.001);
      n++;
    }
    return out;
  };
  // A coconut-shell button: a half shell in husk brown, its rim darker, with a small dot painted `color` on its crown,
  // the dot lit `emissive`.
  const shellButton = (r, color, emissive = 0.35) => {
    const geo = lathe({ profile: [[r, 0], [r * 1.05, 0.013], [r * 0.9, 0.03], [r * 0.55, 0.043], [r * 0.32, 0.047], [0, 0.049]], segments: 8, color: (t) => t < 0.3 ? "#5a3c20" : t < 0.7 ? "#7a5530" : color });
    geo.faces.forEach((f, k) => { f.emissive = k >= 32 ? emissive : 0; });
    return geo;
  };
  const BUTTON_INKS = ["#e0a83a", "#c0482a", "#4aa89a"];
  // Where an Ooga machine takes its coin: a tiki mouth carved into its front, `rx` by `ry`, facing +z about the origin
  // and 0.035 proud at most: thick dark timber lips round the black throat, bone teeth pointing in from its top and
  // foot, and an ember glowing `e` low in the throat. Flat parts.
  const tikiMouth = (rx, ry, e) => {
    const ix = rx * 0.78, iy = ry * 0.7, t = rx * 0.2, parts = [
      moved(prism(oval(rx, ry), 0.024, TIMBER_DK), 0, 0, 0.012),
      moved(prism(oval(ix, iy), 0.006, "#140c08"), 0, 0, 0.026),
      moved(prism(oval(rx * 0.3, ry * 0.2, 10), 0.004, EMBER_GLOW, e), 0, -iy * 0.3, 0.029)
    ];
    for (const [sy, n] of [[1, 4], [-1, 3]]) for (let k = 0; k < n; k++) {
      const x = (k - (n - 1) / 2) * ix * 0.44, y = sy * (iy * Math.sqrt(1 - (x / ix) ** 2) - 0.004);
      parts.push(moved(prism(ccw([[x - t * 0.5, y], [x + t * 0.5, y], [x, y - sy * t * 0.9]]), 0.01, BONE), 0, 0, 0.03));
    }
    return parts;
  };
  // One per cabinet slot, by its index in CABINETS.
  const cabinet = variants((i) => {
    // `on` is a stage cabinet; every cabinet is lit and carries its game's `named` sign, the mezzanine's a retro game's.
    const c = CABINETS[i], on = c.game >= 0, named = on ? GAMES[c.game] : RETRO[c.retro], parts = [], round = [], J = BL.hubModels;
    const hide = leather(c.trim, HIDE_TONES[i % 3]), inks = [earth(c.trim), earth(c.second), BONE], cuts = c.stone ? SLABS : PLANKS, edge = c.stone ? tint(c.body, 0.68) : BARK;
    for (const s of [-1, 1]) {
      // The side: planks (or slabs) a shade apart with a hair of dark between them, and the bark edge round all but
      // the base's front corner, where the bamboo post stands.
      for (let k = 0; k + 1 < cuts.length; k++) {
        const lo = cuts[k] + (k ? 0.006 : 0), hi = cuts[k + 1] - (k + 2 < cuts.length ? 0.006 : 0);
        parts.push(sideShape(band(SIDE[cuts[k] < 1.08 ? 0 : cuts[k] < 1.8 ? 1 : 2], lo, hi), s * 0.56, 0.08, tint(c.body, PLANK_TONES[(k + i) % PLANK_TONES.length])));
      }
      for (let k = 1; k < EDGE.length - 1; k++) parts.push(strip(s * 0.56, EDGE[k], EDGE[k + 1], edge, 0.11, 0.045));
      round.push(J.bamboo(s * 0.575, 0.1, 0.45, s * 0.575, 1.02, 0.45, 0.03), J.lashing(s * 0.575, 0.84, 0.45, 0, 1, 0, 0.03));
      round.push(moved(turnedY(boneTusk(0.8, 0.042, 1.7), -s * 1.3), s * 0.58, 1.8, 0.37));
    }
    for (const z of [0.39, -0.39]) round.push(J.log(-0.62, 0.078, z, 0.62, 0.078, z, 0.075));
    // The back, planks up and down (two slabs on stone), the hide over the front and the lid.
    const back = c.stone ? [-1, 1].map((k) => bevelBox({ w: 1.04, h: 1.04, d: 0.06, color: tint(c.body, 1 + k * 0.05), bevel: 0.025, offset: { y: 1.09 + k * 0.53, z: -0.42 } }))
      : [0, 1, 2, 3].map((k) => bevelBox({ w: 0.255, h: 2.1, d: 0.06, color: tint(c.body, PLANK_TONES[k + 1]), bevel: 0.02, offset: { x: -0.39 + k * 0.26, y: 1.09, z: -0.42 } }));
    parts.push(
      ...back,
      bevelBox({ w: 1.04, h: 0.86, d: 0.06, color: hide, bevel: 0.02, offset: { y: 0.55, z: 0.42 } }),
      bevelBox({ w: 1.06, h: 0.045, d: 0.8, color: tint(c.body, 0.9), bevel: 0.015, offset: { y: 2.118, z: -0.06 } }),
      box({ w: 1.04, h: 0.1, d: 0.02, color: TIMBER_DK, offset: { y: 0.18, z: 0.455 } }),
      ...tikiMouth(0.17, 0.1, 0.55).map((p) => moved(p, 0, 0.46, 0.45)),
      box({ w: 1.04, h: 0.04, d: 0.28, color: TIMBER_DK, offset: { y: 1.78, z: 0.18 } })
    );
    // The crest: a log laid along the lid, carved into a tiki's heavy brow and two bone eyes with the fire in their
    // pupils, striped in red earth under them, a nose between them down to the marquee's rail; its front stops behind
    // the marquee's face.
    round.push(J.log(-0.54, 2.295, 0.135, 0.54, 2.295, 0.135, 0.155, c.stone ? BARK : tint(c.body, 0.8)));
    for (const sx of [-1, 1]) {
      round.push(moved(turnedX(turn([[0.07, 0], [0.07, 0.016], [0, 0.026]], 12, BONE), Math.PI / 2), sx * 0.17, 2.3, 0.27));
      round.push(moved(turnedX(turn([[0.032, 0], [0.032, 0.01], [0, 0.016]], 10, "#1c1410"), Math.PI / 2), sx * 0.17, 2.3, 0.296));
      parts.push(moved(prism(oval(0.013, 0.013, 8), 0.004, EMBER_GLOW, 0.8), sx * 0.17, 2.3, 0.314));
      parts.push(box({ w: 0.1, h: 0.016, d: 0.03, color: "#b8402e", offset: { x: sx * 0.17, y: 2.215, z: 0.276 } }));
    }
    parts.push(bevelBox({ w: 0.54, h: 0.07, d: 0.1, color: "#4a2e18", bevel: 0.02, offset: { y: 2.395, z: 0.27 } }));
    parts.push(moved(prism(ccw([[0, 0.05], [0.038, -0.04], [-0.038, -0.04]]), 0.05, tint(c.body, 0.62)), 0, 2.22, 0.29));
    // The control panel, leaning back toward the screen, and what stands on it: the bone lever with its coconut knob
    // and three big coconut-shell buttons in an arc.
    const deck = [bevelBox({ w: 1.1, h: 0.08, d: 0.36, color: TIMBER_LT, bevel: 0.02 }), box({ w: 1.02, h: 0.006, d: 0.3, color: leather(c.second), offset: { y: 0.042 } })];
    deck.push(box({ w: 0.2, h: 0.004, d: 0.08, color: "#d8c09a", offset: { x: -0.02, y: 0.046, z: -0.1 } }));
    deck.push(moved(lathe({ profile: [[0.05, 0], [0.05, 0.012], [0.018, 0.02], [0.018, 0.13], [0, 0.13]], segments: 10, color: BONE }), -0.3, 0.04, 0.03));
    BUTTON_INKS.forEach((color, k) => deck.push(moved(shellButton(0.052, color), 0.03 + k * 0.15, 0.04, k === 1 ? -0.03 : 0.05)));
    parts.push(moved(turnedX(merge(...deck), 0.32), 0, 1.03, 0.3));
    // The joystick's knob, a coconut, round so it shades smooth.
    round.push(moved(turnedX(moved(nut("husk", 0.05, false, false), -0.3, 0.2, 0.03), 0.32), 0, 1.03, 0.3));
    // The bezel: rough stone bars round the glass, their inner edges on the screen's, painted corners.
    const W = SCREEN.w / 2 + 0.05, H = SCREEN.h / 2 + 0.05, stone = c.stone ? tint(c.body, 1.15) : STONE_LT, bezel = [
      bevelBox({ w: W * 2 + 0.14, h: 0.12, d: 0.08, color: stone, bevel: 0.025, offset: { y: H + 0.01 } }),
      bevelBox({ w: W * 2 + 0.14, h: 0.12, d: 0.08, color: tint(stone, 0.9), bevel: 0.025, offset: { y: -H - 0.01 } }),
      bevelBox({ w: 0.12, h: H * 2, d: 0.08, color: tint(stone, 0.95), bevel: 0.025, offset: { x: -W - 0.01 } }),
      bevelBox({ w: 0.12, h: H * 2, d: 0.08, color: tint(stone, 1.05), bevel: 0.025, offset: { x: W + 0.01 } }),
      box({ w: W * 2, h: H * 2, d: 0.02, color: GLASS_DK, offset: { z: -0.03 } })
    ];
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bezel.push(moved(prism(ccw([[0, 0], [-sx * 0.14, 0], [0, -sy * 0.1]]), 0.012, inks[1]), sx * (W + 0.02), sy * (H + 0.02), 0.045));
    parts.push(moved(turnedX(merge(...bezel), SCREEN.lean), 0, SCREEN.y, SCREEN.z - 0.01));
    // The marquee: warm hide behind the carved sign, between two timber rails.
    parts.push(
      box({ w: 1.04, h: 0.3, d: 0.03, color: "#c9884a", emissive: 0.28, offset: { y: 1.97, z: 0.305 } }),
      bevelBox({ w: 1.14, h: 0.05, d: 0.07, color: TIMBER_DK, bevel: 0.015, offset: { y: 2.125, z: 0.31 } }),
      bevelBox({ w: 1.14, h: 0.05, d: 0.07, color: TIMBER_DK, bevel: 0.015, offset: { y: 1.815, z: 0.31 } })
    );
    const body = shaded(round, parts), rand = mulberry32(900 + i), v = i % 2 ? -1 : 1;
    const geo = J.withJungle(body, (g) => {
      // The paint: both sides, the hide's markings clear of the tiki mouth and the two handprints slapped on it.
      const ink = mulberry32(1900 + i), paint = 0.16, slap = [c.trim, c.trim, c.trim];
      J.flatInto(g, ...sideArt(0.602, c, inks, paint), ...sideArt(-0.602, c, inks, paint),
        hideMarks(i % 3, -0.49, 0.49, 0.26, 0.94, 0.4515, hide, [[-0.3, 0.8, 0.1], [0.3, 0.8, 0.1], [0, 0.46, 0.26]], ink),
        moved(pictograph(PICTOS.hand, 0.085, slap, 0.7), 0.3, 0.8, 0.456), moved(pictograph(mirror(PICTOS.hand), 0.085, slap, 0.7), -0.3, 0.8, 0.456));
      // A live cabinet's back, seen from the back room: its game's pictograph over two handprints, daubed on the planks.
      if (on) {
        const art = geometry();
        [MARK.kart, MARK.chute, MARK.rocket, MARK.pick][c.game](art, 0, 1.25, 0.55, inks[0], paint);
        daubHand(art, -0.2, 0.82, 0.3, 0.2, EARTH_RED, paint);
        daubHand(art, 0.2, 0.78, 0.3, -0.2, EARTH_CHALK, paint, 0.004);
        J.flatInto(g, moved(turnedY(art, Math.PI), 0, 0, -0.456));
      }
      // The rope: stitched round the hide, down each side's front edge and lashed round it by the screen and the
      // marquee.
      J.liana(g, [[-0.49, 0.25, 0.458], [0.49, 0.25, 0.458], [0.49, 0.95, 0.458], [-0.49, 0.95, 0.458], [-0.49, 0.25, 0.458]], 0.011, 0.011, ROPE);
      for (const s of [-1, 1]) {
        J.liana(g, EDGE.slice(1, 6).map(([z, y]) => [s * 0.618, y, z]), 0.014, 0.014, ROPE);
        tuck(g, J.lashing(s * 0.56, 1.44, 0.075, 0, 0.72, -0.15, 0.06));
        tuck(g, J.lashing(s * 0.56, 1.97, 0.32, 0, 1, 0, 0.06));
      }
      // Rope bound over the carved sign's iron corner plates.
      J.flatInto(g, ...signBinding(named.title, named.icon, MARQUEE.w, 0, MARQUEE.y, MARQUEE.z));
      J.liana(g, [[v * 0.612, 0.1, -0.466], [v * 0.619, 0.45, -0.472], [v * 0.61, 0.8, -0.464], [v * 0.619, 1.15, -0.474], [v * 0.611, 1.5, -0.466],
        [v * 0.619, 1.85, -0.472], [v * 0.612, 2.12, -0.466], [v * 0.5, 2.2, -0.4], [v * 0.25, 2.2, -0.26], [v * 0.05, 2.18, -0.17]], 0.024, 0.016);
      for (let k = 0; k < 6; k++) {
        const y = 0.4 + k * 0.3, len = 0.12 + rand() * 0.05;
        if (k % 2) leafBlade(g, v * 0.614, y, -0.482, -v * 0.7, 0.7, -0.02, v * 0.1, 0.2, -1, len, 0.9, IVY_TONES[1]);
        else leafBlade(g, v * 0.624, y, -0.464, v * 0.02, 0.6, 0.8, v, 0.25, -0.05, len, 0.9, IVY_TONES[0]);
      }
      // The crown: banana leaves tucked in behind the marquee, fanned back and out, arching over and drooping, the
      // middle ones reaching back and the outer ones out to the sides and drooping further, all clear of the marquee's
      // face. Each leaf is as long as its slot has room for: `run` is how far it travels a metre of midrib, so no tip
      // reaches past the neighbours' slots or, on the mezzanine, into the back wall 0.4 m behind (so the mezzanine's
      // fan wider). Each slot has its own count, spread, lean and tints; slots 0, 3, 6 and 9 tuck a flower on the crest, and 1, 4, 7 and 10 a
      // hand of bananas on a stalk in the corner across from the liana.
      const n = [4, 3, 5, 3][i % 4], spread = (on ? 0.9 : 1.1) + rand() * 0.25, skew = (rand() - 0.5) * 0.4, back = on ? 1.1 : 0.68;
      for (let k = 0; k < n; k++) {
        const yaw = Math.max(-1.3, Math.min(1.3, skew + spread * (2 * k / (n - 1) - 1) + (rand() - 0.5) * 0.15)), f = Math.abs(yaw) / 1.3;
        const up = 1.25 - 0.3 * f + rand() * 0.1, down = -1 - 0.5 * f - rand() * 0.2, run = (Math.sin(up) - Math.sin(down)) / (up - down);
        bananaLeaf(g, Math.sin(yaw) * 0.08, 2.12, -0.1 - Math.cos(yaw) * 0.04, {
          yaw, up, down, len: Math.min((1.4 - 0.3 * f) * (0.92 + rand() * 0.16), 0.64 / run / (Math.abs(Math.sin(yaw)) + 0.01), back / run / Math.cos(yaw)),
          broad: 0.21 - 0.03 * f + rand() * 0.03, face: 0.5, tone: BANANA_LEAF_TONES[(i + k) % 3], tear: [0, 3, -5][(i + k) % 3]
        });
      }
      if (i % 3 === 0) {
        const ink = J.FLOWER_INKS[i % J.FLOWER_INKS.length];
        J.flower(g, -v * 0.34, 2.46, 0.12, 0, 0.85, 0.53, ink[0], ink[1], 0.12, rand);
      } else if (i % 3 === 1) {
        // Each finger stands on its stem end, curving up and out, turned round the stalk toward the front.
        J.liana(g, [[-v * 0.04, 2.12, -0.12], [-v * 0.2, 2.36, -0.14], [-v * 0.3, 2.42, -0.16]], 0.022, 0.018);
        for (let k = 0; k < 3; k++) tuck(g, moved(turnedY(moved(turnedZ(scaled(BL.models.bananaGeometry(), 0.42), 1.2), 0.209, 0.129, 0), (v > 0 ? Math.PI : 0) + v * (k * 0.7 - 0.1)), -v * 0.3, 2.4, -0.16));
      }
    });
    geo.collisionGeometry = body;
    return geo;
  });
  // ---- the attract loops --------------------------------------------------------------------------------
  const GRID_W = 40, GRID_H = 30, PIXEL = SCREEN.w / GRID_W, FRAMES = 16, FPS = 8, ANIM_Y0 = 9, ANIM_Y1 = 21, BEST_Y = 23;
  const PALETTES = {
    race: ["#0d1a0d", BANANA, "#4a4a52", "#f2efe8", RED, "#8a5a34", "#3a8f2a", "#1b1b1e", "#2e6b20"],
    drop: ["#123a66", "#5ec8ff", "#f2efe8", "#c7dcef", RED, "#c68642", BANANA, "#1b1b1e", "#ff9c86"],
    orbit: ["#0a0820", "#b98cff", "#f2efe8", "#8a86c9", RED, "#7fe0ff", "#ffb02e", BANANA, "#5a5670"],
    mine: ["#1a120a", "#ff9a3c", "#6b6b73", "#8e8e96", BANANA, "#a8703e", "#c9ced6", "#fff3a0", "#4a4a52"]
  };
  // Each game's loop, drawn into the anim box a frame at a time: `f` runs 0 to FRAMES - 1 and the loop is seamless.
  const DRAW = {
    // The rally: the road rolls toward you, dashes and roadside palms streaming down, and the kart weaves.
    race: (g, f) => {
      rect(g, 0, ANIM_Y0, GRID_W, ANIM_Y1 - ANIM_Y0 + 1, 6);
      rect(g, 11, ANIM_Y0, 18, ANIM_Y1 - ANIM_Y0 + 1, 2);
      for (let y = ANIM_Y0; y <= ANIM_Y1; y++) {
        if (((y - f) % 4 + 4) % 4 < 2) at(g, 19, y, 3), at(g, 20, y, 3);
        at(g, 11, y, ((y - f) % 2 + 2) % 2 ? 4 : 3);
        at(g, 28, y, ((y - f) % 2 + 2) % 2 ? 4 : 3);
      }
      for (const [x, phase] of [[4, 0], [34, 7], [6, 9], [32, 2]]) {
        const y = ANIM_Y0 + (phase + f) % 13;
        rect(g, x - 1, y - 1, 3, 2, 8); at(g, x, y + 1, 5);
      }
      const kx = 17 + Math.round(3 * Math.sin(f / FRAMES * Math.PI * 2));
      rect(g, kx, 16, 6, 3, 4); rect(g, kx + 2, 14, 2, 2, 5);
      for (const [dx, dy] of [[-1, 16], [6, 16], [-1, 18], [6, 18]]) at(g, kx + dx, dy, 7);
    },
    // The drop: clouds rush up past the diver, arms and legs spread, rocking in the wind.
    drop: (g, f) => {
      for (const [x, phase, w] of [[5, 0, 6], [27, 5, 8], [14, 9, 5], [33, 12, 4]]) {
        const y = ANIM_Y1 - (phase + f) % 14;
        rect(g, x, y, w, 1, 2); rect(g, x + 1, y - 1, w - 2, 1, 3);
      }
      const dx = 19 + Math.round(2 * Math.sin(f / FRAMES * Math.PI * 2)), up = f % 4 < 2;
      rect(g, dx, 13, 2, 2, 5); rect(g, dx, 15, 2, 3, 4);
      line(g, dx - 1, 15, dx - 3, up ? 13 : 14, 5); line(g, dx + 2, 15, dx + 4, up ? 13 : 14, 5);
      line(g, dx, 18, dx - 2, 20, 1); line(g, dx + 1, 18, dx + 3, 20, 1);
    },
    // The orbit: a star field streams past a climbing rocket whose flame flickers.
    orbit: (g, f) => {
      const rand = mulberry32(77);
      for (let i = 0; i < 22; i++) {
        const x = Math.floor(rand() * GRID_W), y0 = Math.floor(rand() * 13), speed = 1 + (i % 2);
        at(g, x, ANIM_Y0 + (y0 + f * speed) % 13, i % 3 ? 3 : 2);
      }
      rect(g, 18, 12, 4, 6, 2); rect(g, 19, 10, 2, 2, 4); at(g, 19, 9, 4); at(g, 20, 9, 4);
      rect(g, 19, 13, 2, 2, 5);
      rect(g, 16, 16, 2, 2, 4); rect(g, 22, 16, 2, 2, 4);
      const flame = 2 + (f % 3);
      rect(g, 19, 18, 2, flame, 6); at(g, 19 + (f & 1), 18 + flame, 7);
    },
    // The mine: a pick swings into an ore face and knocks sparks and nuggets loose.
    mine: (g, f) => {
      rect(g, 26, ANIM_Y0, 14, ANIM_Y1 - ANIM_Y0 + 1, 2);
      for (let y = ANIM_Y0; y <= ANIM_Y1; y += 3) for (let x = 26 + (y % 2) * 2; x < GRID_W; x += 4) at(g, x, y, 3);
      for (const [x, y] of [[29, 12], [34, 17], [37, 11], [31, 20]]) rect(g, x, y, 2, 2, 4);
      const swing = f < 6 ? f / 6 : f < 9 ? 1 - (f - 6) / 3 : 0, angle = -0.3 - swing * 1.6;
      const px = 14, py = 19, hx = px + Math.round(Math.cos(angle) * 9), hy = py + Math.round(Math.sin(angle) * 9);
      line(g, px, py, hx, hy, 5);
      const nx = -Math.sin(angle), ny = Math.cos(angle);
      line(g, hx - Math.round(nx * 3), hy - Math.round(ny * 3), hx + Math.round(nx * 3), hy + Math.round(ny * 3), 6);
      if (f >= 9 && f < 14) {
        const t = f - 9;
        for (const [vx, vy] of [[-1, -1], [-2, 0], [-1, 1], [0, -2]]) at(g, 25 + vx * t, 15 + vy * t, t < 2 ? 7 : 4);
      }
    }
  };
  // A little bone lying on three rows of a pixel grid from (x, y), in palette colour `c`; `titleBones` lays one either
  // side of a screen's title, each game's in its palette's cream.
  const pixelBone = (g, x, y, c) => { at(g, x, y, c); at(g, x + 3, y, c); rect(g, x, y + 1, 4, 1, c); at(g, x, y + 2, c); at(g, x + 3, y + 2, c); };
  const titleBones = (g, c) => { pixelBone(g, 0, 3, c); pixelBone(g, GRID_W - 4, 3, c); };
  const BONE_INK = { race: 3, drop: 2, orbit: 2, mine: 7 };
  // A game's loop, by its index in GAMES: the title across the top in the game's colour between two bones, then the
  // anim box.
  const attractFrames = variants((i) => {
    const game = GAMES[i], palette = PALETTES[game.id], frames = [];
    for (let f = 0; f < FRAMES; f++) {
      const g = grid(GRID_W, GRID_H);
      centred(g, game.title, 1, 1);
      DRAW[game.id](g, f);
      titleBones(g, BONE_INK[game.id]);
      frames.push(bake(g, palette, PIXEL, 0.45));
    }
    return frames;
  });
  // Between loops the screen blinks for a player, as attract modes do: the title between its bones, PRESS START over a
  // banana coin, and the same with the words dark. Two frames a game, by its index in GAMES.
  const START_FRAMES = 4;
  const attractStart = variants((i) => {
    const game = GAMES[i], palette = PALETTES[game.id];
    return [true, false].map((lit) => {
      const g = grid(GRID_W, GRID_H);
      centred(g, game.title, 1, 1);
      titleBones(g, BONE_INK[game.id]);
      rect(g, 33, 21, 5, 5, 4); rect(g, 34, 20, 3, 7, 4); at(g, 35, 22, 7);
      if (lit) { centred(g, "PRESS", 10, 3); centred(g, "START", 18, 3); }
      return bake(g, palette, PIXEL, 0.45);
    });
  });
  // The line under a loop: a best score, or a call to play, in the palette's ink 1. Built per string; the scene owns
  // and releases it.
  const lineIn = (palette, s) => {
    const g = grid(GRID_W, GRID_H), fit = s.slice(0, Math.floor((GRID_W + TRACKING) / (GLYPH_W + TRACKING)));
    centred(g, fit, BEST_Y, 1);
    const geo = bake(g, palette, PIXEL);
    for (let k = 2; k < geo.verts.length; k += 3) geo.verts[k] += 0.004;
    return geo;
  };
  // Each stage cabinet's best is kept while it reads the same, as the retro cabinets' are.
  const BEST_LINES = [];
  const bestLine = (i, s) => {
    const kept = BEST_LINES[i];
    if (kept && kept.s === s) return kept.geo;
    const geo = lineIn(PALETTES[GAMES[i].id], s);
    BEST_LINES[i] = { s, geo };
    return geo;
  };

  // ---- the retro games' loops -----------------------------------------------------------------------------
  // The mezzanine's cabinets loop their retro games as the stage's loop theirs: the same grid, frame count and PRESS
  // START blink, the best under the loop. Their names are too long for the 5x7 font, so the title is lettered in the
  // carved signs' 3x5 alphabet. Every palette shares its first five inks (the glass, the cabinet's trim, bone, and the
  // banana coin and its mark); each game's own follow.
  const RETRO_INKS = {
    invaders: ["#b98cff", "#c8ff5a", "#c68642", "#3a2414", "#8a5a2c", "#8e8e96", "#ff8a2a"],
    stampede: ["#8a6440", "#3a6e24", "#8a5a2c", "#c68642", "#3a2414", "#3d74a8", "#7a6656", "#ffd23a", "#9a4a26"],
    pong: ["#4a4a52", "#8a5a2c", "#c68642", "#3a2414", "#ff8a2a", "#e0452b", "#7a4e28"],
    snake: ["#b8872a", "#8a5a2c", "#6fae3a", "#1b1410"],
    flap: ["#b98cff", "#7a5ab8", "#b8ac94", "#ffb02e", "#ff8a2a", "#e0452b"],
    breaker: ["#8e8e96", "#b4b4bc", "#6b6b73", "#c68642", "#8a5a2c", "#ff8a2a", "#5a3a1e"],
    dash: ["#6fae3a", "#3a6e24", "#2f8a3a", "#8a5a2c", "#1b1410", "#c68642", "#3a2414", "#b98cff"],
    stacker: ["#8e8e96", "#5a5a62", "#d9953a", "#6fae3a", "#c8583a", "#4a7ab0", "#2fb8a0", "#fff3a0"]
  };
  const retroPalette = (r) => ["#07080d", CABINETS[4 + r].trim, BONE, BANANA, "#8a5210", ...RETRO_INKS[RETRO[r].id]];
  const smallCentred = (g, s, y, c) => {
    const G = BL.hubModels.SIGN_GLYPHS;
    let x = Math.floor((g.w - (s.length * 4 - 1)) / 2);
    for (const ch of s) {
      const rows = G[ch];
      if (rows) for (let row = 0; row < rows.length; row++) for (let k = 0; k < rows[row].length; k++) if (rows[row][k] === "1") at(g, x + k, y + row, c);
      x += 4;
    }
  };
  // A triangle wave over `n` frames, 0 at f = 0 and 1 half way.
  const tri = (f, n = FRAMES) => { const k = (f % n) / n; return k < 0.5 ? k * 2 : 2 - k * 2; };
  // Each loop, a frame at a time into the anim box, seamless over FRAMES: ink 1 the trim, 2 bone, 3 banana, 5 on the
  // game's own.
  const RETRO_DRAW = {
    // The formation marches, an Ooga behind the shields throws a coconut up and a pterodactyl bursts.
    invaders: (g, f) => {
      const dx = f < 8 ? f >> 1 : 7 - (f >> 1), up = (f >> 1) & 1;
      for (let k = 0; k < 5; k++) {
        const x = 3 + k * 7 + dx;
        if (k === 2 && f >= 8) continue;
        if (up) { at(g, x, 10, 5); at(g, x + 4, 10, 5); rect(g, x + 1, 11, 3, 1, 5); at(g, x + 2, 12, 5); }
        else { at(g, x + 2, 10, 5); rect(g, x, 11, 5, 1, 5); at(g, x, 12, 5); at(g, x + 2, 12, 5); at(g, x + 4, 12, 5); }
      }
      for (let k = 0; k < 5; k++) { const x = 4 + k * 7 + dx; rect(g, x, 14, 3, 1, 6); at(g, x, 15, 6 - (f & 1)); at(g, x + 2, 15, 6 - (f & 1)); }
      for (const x of [3, 11, 26, 34]) { rect(g, x, 18, 4, 1, 10); at(g, x, 19, 10); at(g, x + 3, 19, 10); }
      rect(g, 19, 19, 3, 1, 8); rect(g, 19, 20, 3, 1, 7); at(g, 19, 21, 7); at(g, 21, 21, 7);
      if (f >= 2 && f < 8) at(g, 20, 18 - (f - 2), 9);
      else if (f < 2) at(g, 20, 18, 9);
      if (f >= 8 && f < 12) { const r = f - 7, cx = 21, cy = 11; at(g, cx - r, cy, 11); at(g, cx + r, cy, 11); at(g, cx, cy - r, 3); at(g, cx, cy + r, 3); }
    },
    // The game's valley, top down, on the glass's black as the other loops are: the cliff's ledge broken by three cave
    // mouths, the river's ripples with logs one way and rafts of turtles the other, the stones, a lane of mammoths and
    // the stampede's red herd galloping the other way in its dust, and the grass. An Ooga hops the herd's lane a hair
    // ahead of it and the mammoths' lane, waits on the stones, rides a raft and a log, and ducks into the middle cave,
    // which flashes. Palette: 5 mammoth, 6 grass and turtle, 7 log (4 under it), 8 skin, 9 hair, 10 ripple, 11 rock
    // and dust, 12 the herd's glowing eye, 13 the red herd.
    stampede: (g, f) => {
      const wrap = (v, p) => ((v % p) + p) % p;
      for (let x = 0; x < GRID_W; x++) { const c = wrap(x - 5, 13); if (c > 3) at(g, x, 10, 11); if (c === 0 || c === 3) at(g, x, 9, 11); }
      for (let x = 0; x < GRID_W; x++) { if (wrap(x - f, 6) === 2) at(g, x, 12, 10); if (wrap(x + f, 6) === 4) at(g, x, 14, 10); }
      for (let k = -1; k < 3; k++) { const x = k * 16 + wrap(f + 9, 16); rect(g, x, 11, 9, 1, 7); rect(g, x, 12, 9, 1, 4); }
      for (let k = -1; k < 4; k++) { const x = k * 16 + wrap(5 - f, 16); rect(g, x, 13, 2, 2, 6); rect(g, x + 3, 13, 2, 2, 6); }
      for (let x = 1; x < GRID_W; x += 3) at(g, x, 16, x % 7 === 1 ? 2 : 11);
      for (let k = -1; k < 3; k++) { const x = k * 16 + wrap(2 * f + 4, 16); rect(g, x + 1, 17, 4, 1, 5); rect(g, x, 18, 5, 1, 5); at(g, x + 4, 17, 9); at(g, x + 5, 18, 2); }
      for (let k = -1; k < 2; k++) {
        const x = k * 48 + wrap(30 - 3 * f, 48);
        for (let m = 0; m < 2; m++) { const mx = x + m * 7; rect(g, mx + 1, 19, 4, 1, 13); rect(g, mx, 20, 5, 1, 13); at(g, mx, 19, 12); at(g, mx - 1, 20, 2); }
        at(g, x + 14, 20, 11); at(g, x + 16, 19, 11); at(g, x + 18, 20, 11);
      }
      for (let x = 0; x < GRID_W; x += 2) at(g, x + (x & 2 ? 1 : 0), 22, 6);
      for (let x = 1; x < GRID_W; x += 6) at(g, x, 21, 6);
      for (let x = 4; x < GRID_W; x += 11) at(g, x, 21, 3);
      const ox = [18, 18, 18, 18, 18, 18, 18, 17, 17, 18, 19, 19, 19, 19, 19, 19][f], oy = [21, 21, 19, 17, 15, 15, 13, 13, 11, 11, 11, 9, 9, 9, 9, 9][f];
      rect(g, ox, oy, 3, 1, 9); rect(g, ox, oy + 1, 3, 1, 8);
      if (f >= 11 && f & 1) { at(g, ox - 1, oy, 8); at(g, ox + 3, oy, 8); }
      if (f >= 11 && f < 14) { const r = f - 10; at(g, ox + 1, oy - r, 3); at(g, ox - 1 - r, oy + 1, 3); at(g, ox + 3 + r, oy + 1, 3); }
    },
    // Down a walled court over a net of bones: the rival's return comes down, the Ooga smashes it back burning past the
    // rival's log, it bursts on the back wall while the rival sees stars, and the rival takes it up to serve again.
    pong: (g, f) => {
      const BX = [13, 15, 16, 18, 20, 21, 23, 25, 21, 17, 13, 9, 5, -1, -1, 13], BY = [12, 12, 13, 13, 14, 15, 15, 16, 15, 14, 13, 12, 10, -1, -1, 12];
      const rx = [13, 13, 14, 15, 16, 17, 18, 18, 17, 16, 15, 15, 15, 14, 14, 13][f], px = [19, 19, 20, 21, 22, 23, 24, 25, 25, 24, 23, 22, 21, 21, 20, 20][f], lift = f === 7 ? 1 : 0;
      for (let y = 9; y <= 21; y++) { at(g, 0, y, 5); at(g, 39, y, 5); }
      for (let x = 3; x < 37; x += 3) at(g, x, 15, 5);
      rect(g, rx - 1, 9, 3, 1, 8); rect(g, rx - 1, 10, 3, 1, 7); rect(g, rx - 3, 11, 7, 1, 11); at(g, rx - 3, 11, 6); at(g, rx + 3, 11, 6);
      if (f >= 12 && f <= 14) { at(g, rx + (f & 1 ? 2 : -2), 8, 3); at(g, rx + (f & 1 ? -1 : 1), 7, 3); }
      const club = f === 7 ? 3 : 2;
      rect(g, px - 3, 19 - lift, 7, 1, club); at(g, px - 3, 18 - lift, club); at(g, px + 3, 18 - lift, club); at(g, px - 3, 20 - lift, club); at(g, px + 3, 20 - lift, club);
      rect(g, px - 1, 20, 3, 1, 8); rect(g, px - 1, 21, 3, 1, 7);
      if (f >= 9 && f <= 12) at(g, BX[f - 2], BY[f - 2], 10);
      if (f >= 8 && f <= 12) at(g, BX[f - 1], BY[f - 1], 9);
      if (BX[f] >= 0) { const hot = f >= 7 && f <= 12; rect(g, BX[f], BY[f], 2, 2, hot ? 3 : 6); at(g, BX[f] + 1, BY[f] + 1, hot ? 9 : 4); }
      if (f === 7) { at(g, px - 5, 16, 3); at(g, px + 5, 16, 3); at(g, px, 14, 9); }
      if (f === 13) { at(g, 2, 9, 3); at(g, 5, 9, 9); at(g, 3, 11, 6); at(g, 6, 11, 3); at(g, 2, 12, 10); }
      else if (f === 14) { at(g, 1, 13, 6); at(g, 7, 12, 9); at(g, 4, 13, 10); }
    },
    // A freckled banana snake, two pixels thick with a bone eye and a snout, laps the screen and gulps the coconut in
    // its way (the burst flies up, a lump slides down it, and the coconut is back once the tail has passed).
    snake: (g, f) => {
      const cellAt = (p) => { p = ((p % 64) + 64) % 64; return p < 22 ? [9 + p, 10, 0, 1] : p < 32 ? [31, p - 12, -1, 0] : p < 54 ? [63 - p, 20, 0, -1] : [9, 74 - p, 1, 0]; };
      const [sx, sy, six, siy] = cellAt(f * 4 + 1);
      at(g, sx + six, sy + siy, 3);
      const [nx, ny] = cellAt(44);
      if (f < 11) { rect(g, nx, ny - 1, 2, 2, 6); at(g, nx, ny - 1, 5); }
      else if (f < 14) { const r = f - 10; at(g, nx - r, ny - 1 - r, 2); at(g, nx + 1 + r, ny - 1 - r, 3); at(g, nx, ny - 2 - r, 2); }
      for (let k = 17; k >= 0; k--) {
        const [x, y, ix, iy] = cellAt(f * 4 - k), ink = k === 17 ? 6 : 3;
        at(g, x, y, k === 0 ? 2 : ink); at(g, x + ix, y + iy, k && k < 17 && k % 3 === 0 ? 5 : ink);
      }
      if (f >= 12) { const [x, y, ix, iy] = cellAt(f * 4 - (f - 11) * 4); at(g, x - ix, y - iy, 3); }
    },
    // Bone gates stream over the lava, their gaps high and low in turn, and a pterodactyl threads each one's middle,
    // beating its wings on the climb, gliding down and taking the banana in each high gap.
    flap: (g, f) => {
      rect(g, 0, 21, GRID_W, 1, 10);
      for (let x = 0; x < GRID_W; x++) if ((x + 2 * f) % 6 < 2) at(g, x, 20, (x + 2 * f) % 12 < 6 ? 9 : 3);
      // A gate every 16 px scrolling 2 a frame, so after the loop's 32 px the high and low gaps stand where they began.
      for (let n = (f >> 3) - 1; n <= (f >> 3) + 3; n++) {
        const x = n * 16 - 2 * f + 20, top = n & 1 ? 14 : 10, bottom = top + 6;
        if (x < -3 || x > GRID_W + 1) continue;
        for (let y = 9; y < top; y++) { at(g, x, y, 2); at(g, x + 1, y, 7); }
        for (let y = bottom + 1; y < 21; y++) { at(g, x, y, 2); at(g, x + 1, y, 7); }
        rect(g, x - 1, top - 1, 4, 1, 2); rect(g, x - 1, bottom, 4, 1, 2);
        if (!(n & 1) && x > 12) { at(g, x, top + 2, 3); at(g, x + 1, top + 3, 3); at(g, x - 1, top + 2, 4); }
      }
      // A high gate crosses the ptero at f 4 and a low one at f 12; each is a bullseye.
      const px = 7, y = Math.round(15 + 2 * Math.cos(Math.PI * (f - 12) / 8)), climbing = f < 4 || f >= 12;
      rect(g, px + 1, y, 5, 1, 5); at(g, px, y, 6); rect(g, px + 5, y - 1, 2, 1, 5); at(g, px + 4, y - 2, 2); at(g, px + 3, y - 2, 2);
      at(g, px + 7, y - 1, 8); at(g, px + 8, y - 1, 8);
      if (!climbing) rect(g, px, y - 1, 4, 1, 6);
      else if (f & 2) { at(g, px + 2, y + 1, 5); at(g, px + 3, y + 1, 5); at(g, px + 2, y + 2, 5); at(g, px + 1, y + 3, 6); }
      else { at(g, px + 2, y - 1, 5); at(g, px + 3, y - 1, 5); at(g, px + 2, y - 2, 5); at(g, px + 1, y - 3, 6); }
      if ((f & 7) === 4 || (f & 7) === 5) { const r = f & 1 ? 3 : 2; at(g, px + 4 + r, y, 3); at(g, px + 4 - r, y, 3); at(g, px + 4, y + r, 3); at(g, px + 4, y - r, 3); }
    },
    // An Ooga holding a log over its head bounces a coconut up into an ember rock, which blows out the rocks round it
    // in a burst of fire; the coconut drops back onto the log and rides it home. The coconut flies a pixel clear of
    // the log and rides its right end, never over the Ooga's head, and the log is dark husk and wider than the Ooga,
    // so the three never run together into one shape at the cabinet's size.
    breaker: (g, f) => {
      const boom = f >= 7;
      for (let row = 0; row < 3; row++) for (let k = 0; k < 7; k++) {
        const x = 2 + k * 5 + (row & 1) * 2, y = 9 + row * 2, ember = row === 2 && k === 3;
        if (boom && row > 0 && x + 3 >= 13 && x <= 25) continue;
        rect(g, x, y, 4, 1, ember ? 10 : [6, 5, 7][row]);
        if (ember) at(g, x + 1 + (f & 1), y, 3);
      }
      if (f >= 7 && f < 11) {
        const r = f - 6;
        at(g, 19 - r, 13, 10); at(g, 19 + r, 13, 10); at(g, 19, 13 - r, 3);
        if (r < 3) { at(g, 19 - r, 13 - r, 3); at(g, 19 + r, 13 - r, 3); }
      }
      const cx = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 20, 17, 14, 12][f], cy = [16, 15, 15, 15, 14, 14, 14, 14, 15, 15, 15, 16, 16, 16, 16, 16][f];
      const lx = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 18, 15, 12, 10][f];
      rect(g, cx, cy, 2, 2, 9); at(g, cx, cy, 8);
      rect(g, lx - 4, 19, 9, 1, 11); at(g, lx - 4, 19, 8); at(g, lx + 4, 19, 8);
      at(g, lx - 2, 20, 8); rect(g, lx - 1, 20, 2, 1, 4); at(g, lx + 1, 20, 8); rect(g, lx - 1, 21, 2, 1, 8);
      if (f === 11) { at(g, lx - 5, 18, 2); at(g, lx + 5, 18, 2); }
    },
    // An Ooga on a dino runs, the ground streaming by, hops a cactus and takes the banana over it at the top of the
    // jump; a pterodactyl flaps across overhead, its wings a V up and down off its body.
    dash: (g, f) => {
      rect(g, 0, 21, GRID_W, 1, 8);
      for (let x = 0; x < GRID_W; x++) if (((x + 3 * f) & 7) === 0) at(g, x, 21, 6);
      const px = ((36 - 3 * f) % 48 + 48) % 48 - 4, wy = f & 2 ? -1 : 1;
      rect(g, px, 10, 3, 1, 12); at(g, px - 1, 10, 3);
      at(g, px, 10 + wy, 12); at(g, px - 1, 10 + 2 * wy, 12); at(g, px + 2, 10 + wy, 12); at(g, px + 3, 10 + 2 * wy, 12);
      const cx = 44 - 3 * f;
      rect(g, cx, 17, 2, 4, 7); at(g, cx - 1, 18, 7); at(g, cx - 1, 17, 7); at(g, cx + 2, 19, 7); at(g, cx + 2, 18, 7);
      if (f < 11) { at(g, cx, 13, 3); at(g, cx + 1, 13, 3); at(g, cx + 2, 12, 3); at(g, cx + 2, 11, 4); }
      else if (f < 13) { const r = f - 9; at(g, 11 - r, 12, 2); at(g, 11 + r, 12, 2); at(g, 11, 12 - r, 3); at(g, 11, 12 + r, 3); }
      const dy = 20 - [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 4, 5, 5, 4, 2, 0][f];
      rect(g, 9, dy - 4, 3, 2, 5); at(g, 11, dy - 4, 9); at(g, 12, dy - 3, 2); rect(g, 5, dy - 2, 5, 2, 5); at(g, 4, dy - 2, 6); at(g, 3, dy - 1, 6);
      at(g, 6, dy - 5, 11); at(g, 7, dy - 5, 11); at(g, 6, dy - 4, 11); at(g, 7, dy - 4, 10); at(g, 7, dy - 3, 10); at(g, 8, dy - 3, 10);
      if (dy < 20) { at(g, 6, dy, 6); at(g, 8, dy, 6); }
      else if (f & 1) { at(g, 6, dy, 6); at(g, 8, dy - 1, 6); } else { at(g, 6, dy - 1, 6); at(g, 8, dy, 6); }
    },
    // An ochre T stone tumbles down the stone well and drops its point into the gap; the full row flashes and
    // crumbles, the stack drops a row and a slate stone comes in. Cells are 2 px, six to the well's width.
    stacker: (g, f) => {
      rect(g, 13, 9, 1, 13, 6); rect(g, 26, 9, 1, 13, 6); rect(g, 13, 21, 14, 1, 6);
      const cell = (c, row, ink) => { if (row >= 0) rect(g, 14 + c * 2, 9 + row * 2, 2, 2, ink); };
      const stone = (s, c, row, ink, lit) => { for (let k = 0; k < 8; k += 2) cell(c + s[k], row + s[k + 1], row + s[k + 1] === 5 && lit ? 12 : ink); };
      const T = [[1, 0, 0, 1, 1, 1, 2, 1], [1, 0, 1, 1, 2, 1, 1, 2], [0, 0, 1, 0, 2, 0, 1, 1]];
      if (f < 10) {
        const lit = f >= 6 && !(f & 1);
        [8, 8, 9, 0, 10, 10].forEach((ink, c) => { if (ink) cell(c, 5, lit ? 12 : ink); });
        cell(0, 4, 11); cell(5, 4, 5);
        stone(T[f < 2 ? 0 : f < 4 ? 1 : 2], 2, Math.min(f, 5) - 1, 7, lit);
        if (f === 7 || f === 9) { at(g, 16, 16, 3); at(g, 21, 15, 3); at(g, 24, 16, 3); }
      } else {
        cell(0, 5, 11); cell(2, 5, 7); cell(3, 5, 7); cell(4, 5, 7); cell(5, 5, 5);
        if (f >= 12) stone([0, 0, 0, 1, 1, 1, 2, 1], 1, f - 13, 10, false);
      }
    }
  };
  // A retro game's loop, by its index in RETRO: its title between two bones, then the anim box.
  const retroFrames = variants((r) => {
    const game = RETRO[r], palette = retroPalette(r), frames = [];
    for (let f = 0; f < FRAMES; f++) {
      const g = grid(GRID_W, GRID_H);
      smallCentred(g, game.title, 2, 1);
      RETRO_DRAW[game.id](g, f);
      titleBones(g, 2);
      frames.push(bake(g, palette, PIXEL, 0.45));
    }
    return frames;
  });
  // Its PRESS START blink over a banana coin, lit and dark, as the stage's cabinets blink theirs.
  const retroStart = variants((r) => {
    const game = RETRO[r], palette = retroPalette(r);
    return [true, false].map((lit) => {
      const g = grid(GRID_W, GRID_H);
      smallCentred(g, game.title, 2, 1);
      titleBones(g, 2);
      rect(g, 33, 21, 5, 5, 3); rect(g, 34, 20, 3, 7, 3); at(g, 35, 22, 4);
      if (lit) { centred(g, "PRESS", 10, 2); centred(g, "START", 18, 2); }
      return bake(g, palette, PIXEL, 0.45);
    });
  });
  // The best under a retro loop in the signs' 3x5 alphabet, which fits ten characters where the 5x7 font fits six,
  // so a best in the thousands is never cut. Each cabinet's is kept while it reads the same, so a visit to the hall
  // bakes only a line whose best changed.
  const RETRO_LINES = [];
  const retroLine = (r, s) => {
    const kept = RETRO_LINES[r];
    if (kept && kept.s === s) return kept.geo;
    const g = grid(GRID_W, GRID_H);
    smallCentred(g, s, BEST_Y + 1, 1);
    const geo = bake(g, retroPalette(r), PIXEL);
    for (let k = 2; k < geo.verts.length; k += 3) geo.verts[k] += 0.004;
    RETRO_LINES[r] = { s, geo };
    return geo;
  };

  // ---- hides and fire for the carnival machines -----------------------------------------------------------
  // A shaggy mammoth pelt pegged out flat facing +z, `w` by `h` round the origin (the hall's `hide` has the leopard
  // and the tiger): a rounded pelt with a leg flap at each corner under rows of long tufts in three browns shingled
  // down it, each tip lifted off the pelt, the last row a ragged fringe. A flat part.
  const MAMMOTH_FUR = ["#3e2818", "#6b4a2c", "#8a6440"];
  const shaggyFur = (w, h, seed) => {
    const g = geometry(), rand = mulberry32(seed), rx = w * 0.42, ry = h * 0.42;
    daubDot(g, 0, 0, rx, ry, MAMMOTH_FUR[0], 0, 0, 0, 14);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) daubDot(g, sx * w * 0.36, sy * h * 0.36, w * 0.14, h * 0.09, MAMMOTH_FUR[0], 0, sx * sy * 0.7, 0, 8);
    for (let row = 0; row < 8; row++) {
      const y = ry * (0.92 - row * 0.26), half = Math.max(rx * 0.3, rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2))), n = Math.max(3, Math.round(half * 2 / 0.05));
      for (let k = 0; k < n; k++) {
        const x = -half + (k + 0.5) * half * 2 / n + (rand() - 0.5) * 0.015, tw = half / n * 1.25, len = h * (0.14 + rand() * 0.1), z = 0.004 + row * 0.003;
        const a = pushVert(g, x - tw, y + 0.02, z), b = pushVert(g, x + tw, y + 0.02, z), tip = pushVert(g, x + (rand() - 0.5) * 0.03, y - len, z + 0.014);
        face(g, [a, tip, b], hexToRgb(MAMMOTH_FUR[Math.floor(rand() * 3)]), { emissive: 0 });
      }
    }
    return g;
  };
  // Long shaggy fur hung in fringes grown with the jungle kit (the air hockey stone's edges, the baby mammoth ride's
  // flanks and crown): four browns of its own, not the pelt's three, dark to light as `garland` and `sprig` take them.
  const SHAG = ["#3a2414", "#54361f", "#6a4628", "#80583a"].map(hexToRgb);
  // The mammoth's pelt on the hall's floor, laid out flat facing +z, `w` by `h` round the origin, so its shape reads
  // from above: the body, a leg splayed out from each corner to a round paw, the head at +x with an ear flopped out
  // each side and the trunk curling off its end, and a short tail at -x, all one red-brown hide with a darker stripe
  // down its back and two eye holes; shaggy locks of fur only round its rim, a long one and a short one between each
  // two, pointing out. Each lobe an oval [x, y, rx, ry, turn] in fractions of `w` and `h`. A flat part.
  const PELT_LOBES = [[-0.12, 0, 0.3, 0.34, 0], [0.3, 0.01, 0.12, 0.2, 0], [0.25, 0.22, 0.07, 0.14, 0.5], [0.25, -0.22, 0.07, 0.14, -0.5],
    [0.41, 0, 0.035, 0.07, 0], [0.445, 0.07, 0.028, 0.055, 0.4], [0.465, 0.16, 0.022, 0.045, 0.1], [0.462, 0.25, 0.018, 0.04, -0.3],
    [0.09, 0.41, 0.07, 0.13, 0.35], [0.09, -0.41, 0.07, 0.13, -0.35], [-0.32, 0.41, 0.07, 0.13, -0.3], [-0.32, -0.41, 0.07, 0.13, 0.3],
    [0.12, 0.5, 0.05, 0.07, 0], [0.12, -0.5, 0.05, 0.07, 0], [-0.35, 0.5, 0.05, 0.07, 0], [-0.35, -0.5, 0.05, 0.07, 0],
    [-0.43, 0.01, 0.035, 0.035, 0], [-0.465, 0.04, 0.02, 0.03, 0]];
  const PELT = { hide: "#8a5530", stripe: "#6e4226", eye: "#24160c", locks: ["#6a3e22", "#9a643c", "#ae7646"] };
  const mammothPelt = (w, h, seed) => {
    const g = geometry(), rand = mulberry32(seed), lobes = PELT_LOBES.map(([x, y, rx, ry, t]) => [x * w, y * h, rx * w, ry * h, t]);
    const inside = (px, py) => lobes.some(([x, y, rx, ry, t]) => {
      const dx = px - x, dy = py - y, c = Math.cos(t), s = Math.sin(t), u = dx * c + dy * s, v = -dx * s + dy * c;
      return (u / rx) ** 2 + (v / ry) ** 2 < 1;
    });
    for (const [x, y, rx, ry, t] of lobes) daubDot(g, x, y, rx, ry, PELT.hide, 0.07, t, 0, rx > 0.3 ? 16 : 10);
    daubDot(g, lobes[0][0] + 0.05 * w, 0, 0.27 * w, 0.075 * h, PELT.stripe, 0.05, 0, 0.001, 12);
    for (const sy of [-1, 1]) daubDot(g, 0.34 * w, sy * 0.07 * h, 0.022, 0.016, PELT.eye, 0, 0, 0.001, 6);
    // The locks round the rim: along each lobe's edge wherever no other lobe covers it.
    for (const [x, y, rx, ry, t] of lobes) {
      const c = Math.cos(t), s = Math.sin(t), n = Math.max(8, Math.round(Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))) / 0.06));
      for (let k = 0; k < n * 2; k++) {
        const a = k / (n * 2) * Math.PI * 2, eu = Math.cos(a) * rx, ev = Math.sin(a) * ry, px = x + eu * c - ev * s, py = y + eu * s + ev * c;
        let nx = Math.cos(a) / rx * c - Math.sin(a) / ry * s, ny = Math.cos(a) / rx * s + Math.sin(a) / ry * c;
        const nl = Math.hypot(nx, ny), long = k % 2 === 0;
        nx /= nl; ny /= nl;
        if (inside(px + nx * 0.015, py + ny * 0.015)) continue;
        const len = (long ? 0.06 : 0.035) + rand() * 0.04, half = long ? 0.036 : 0.028, lean = (rand() - 0.5) * 0.5, tx = -ny, ty = nx, back = long ? 0.03 : 0.05;
        const at = (u, v) => [px + tx * u + nx * v, py + ty * u + ny * v];
        daubPoly(g, [at(-half, -back), at(-half * 0.8 + lean * len * 0.5, len * 0.55), at(lean * len, len), at(half * 0.8 + lean * len * 0.5, len * 0.55), at(half, -back)],
          PELT.locks[long ? 1 + Math.floor(rand() * 2) : 0], 0.05, long ? 0.002 : 0.003);
      }
    }
    return g;
  };
  // A leopard skin pegged out flat facing +z, `w` by `h` round the origin: a warm tawny pelt with a ragged edge, a leg
  // pulled out to each corner with a bone peg through its paw, the head at -x and the tail curling up from +x; big
  // rosettes over the back (a darker heart ringed by four dark petals) and solid spots toward the edges and down the
  // legs. A flat part, `seed` fixing the edge and the marks; the tawny keeps a faint warmth (`LEOPARD_WARM`) so it
  // still reads as fur in a counter's shadow. Not `hide("leopard")`, a stretched sheet (suede behind, broken
  // rosettes, able to sag or wrap): this is the whole skin, head, legs and tail, for the coconut shy's front.
  const LEOPARD = ["#f0b052", "#c07830", "#2e1c0e"], LEOPARD_WARM = 0.1;
  const leopardPelt = (w, h, seed) => {
    const g = geometry(), rand = mulberry32(seed), rx = w * 0.38, ry = h * 0.36, [tawny, heart, ink] = LEOPARD, E = LEOPARD_WARM;
    const mid = pushVert(g, 0, 0, 0), rim = [];
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2, j = 0.94 + rand() * 0.12; rim.push(pushVert(g, Math.cos(a) * rx * j, Math.sin(a) * ry * j, 0)); }
    for (let k = 0; k < 24; k++) face(g, [mid, rim[k], rim[(k + 1) % 24]], hexToRgb(tawny), { emissive: E });
    const paws = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [sx, sy, sx * w * 0.44, sy * h * 0.4]));
    for (const [sx, sy, px, py] of paws) {
      daubTaper(g, [[sx * rx * 0.55, sy * ry * 0.5], [sx * rx * 0.95, sy * ry * 0.95], [px, py]], (t) => h * (0.26 - 0.12 * t), tawny, E);
      daubDot(g, px, py, h * 0.075, h * 0.06, tawny, E, 0, 0, 8);
      daubDot(g, px, py, h * 0.03, h * 0.03, BONE, E, 0, 0.01, 6);
    }
    daubDot(g, -rx * 1.08, ry * 0.08, h * 0.14, h * 0.12, tawny, E, 0.2, 0, 10);
    for (const sy of [-1, 1]) daubDot(g, -rx * 1.16, ry * 0.08 + sy * h * 0.11, h * 0.045, h * 0.045, tawny, E, 0, 0, 6);
    daubTaper(g, [[rx * 0.92, -ry * 0.1], [rx * 1.12, -ry * 0.05], [rx * 1.24, ry * 0.25], [rx * 1.2, ry * 0.5]], (t) => h * (0.08 - 0.05 * t), tawny, E);
    // The rosettes in staggered rows, each whole inside the back's oval; the spots scattered round the edge and down
    // the legs.
    for (let row = -1; row <= 1; row++) for (let x = -rx * 0.78 + (row & 1) * 0.1; x < rx * 0.8; x += 0.2) {
      const y = row * ry * 0.46 + (rand() - 0.5) * 0.03, q = 0.048 + rand() * 0.02, t0 = rand() * Math.PI;
      if (DOT.some(([c, s]) => ((x + c * q * 1.2) / rx) ** 2 + ((y + s * q * 1.2) / ry) ** 2 > 0.86)) continue;
      daubDot(g, x, y, q * 0.6, q * 0.55, heart, E, t0, 0.004, 8);
      for (let k = 0; k < 4; k++) { const a = t0 + k * Math.PI / 2 + (rand() - 0.5) * 0.4; daubDot(g, x + Math.cos(a) * q * 0.82, y + Math.sin(a) * q * 0.76, q * 0.36, q * 0.17, ink, 0, a + Math.PI / 2, 0.006, 7); }
    }
    for (let k = 0; k < 14; k++) {
      const a = rand() * Math.PI * 2, s = 0.8 + rand() * 0.1, r = 0.014 + rand() * 0.01;
      daubDot(g, Math.cos(a) * rx * s, Math.sin(a) * ry * s, r, r, ink, 0, 0, 0.004, 6);
    }
    for (const [sx, sy, px, py] of paws) daubDot(g, sx * rx * 0.97 + (px - sx * rx * 0.97) * 0.5, sy * ry * 0.97 + (py - sy * ry * 0.97) * 0.5, 0.016, 0.016, ink, 0, 0, 0.004, 6);
    return g;
  };
  // Fire, the room's light. A machine's flames are copies of the hall's `blaze` folded into its `glow`, `h` tall as
  // `scaled(blaze(), h * 2)`. `torchHead` is the cup a torch burns in, a bark cup `r` round on a post's top at (x, y,
  // z), a round part, its embers glowing in it (the hall's torches burn in woven cups of their own, in `lanterns`);
  // its flame stands `r` * 1.2 over the post. `shellLantern` is a coconut-shell lantern `r` round
  // hung from the origin: a light husk (`shell`, a round part) with five big diamonds carved round its middle, one
  // under its eyes like a mouth, and a small triangle over each gap, every hole edged in the cream of the cut flesh;
  // the fire (`light`) shows through them and through its wide open foot.
  const LANTERN_HUSK = "#a8773f";
  const torchHead = (x, y, z, r) => {
    const cup = turn([[r * 0.55, 0], [r, r * 0.85], [r * 1.12, r * 1.4], [r * 0.86, r * 1.4]], 10, "#6b4a2b"), streak = hexToRgb("#4a3020");
    cup.faces.forEach((f, n) => { if (n % 10 % 3 === 1) f.color = streak; });
    return moved(merge(cup, lathe({ profile: [[r * 0.86, r * 1.4], [0, r * 1.2]], segments: 10, color: "#ff9a3c", emissive: 0.8 })), x, y, z);
  };
  const shellLantern = (r) => {
    const shell = [moved(nut(LANTERN_HUSK, r, false, false), 0, -r, 0)], light = [];
    // A hole `e` round with `sides` corners, `polar` from the top and `a` round from +x: a cap hugging the husk in
    // the cut's cream, and the fire a little proud of it and smaller.
    const hole = (sides, e, polar, a) => {
      const nx = Math.sin(polar) * Math.cos(a), ny = Math.cos(polar), nz = Math.sin(polar) * Math.sin(a);
      const cap = (k, lift, color, emissive) => {
        const R = r * lift, rows = [1, 0.5, 0].map((f) => [k * f, Math.sqrt(R * R - k * k * f * f) - R]);
        return along(lathe({ profile: rows, segments: sides, color, emissive }), nx * R, -r + ny * R, nz * R, nx, ny, nz);
      };
      shell.push(cap(e * 1.3, 1.02, "#efe2c4", 0));
      light.push(cap(e, 1.045, "#ffb347", 1));
    };
    for (let k = 0; k < 5; k++) {
      const a = Math.PI / 2 + k / 5 * Math.PI * 2;
      hole(4, r * 0.3, Math.PI / 2 + 0.06, a);
      hole(3, r * 0.15, Math.PI / 2 - 0.66, a + Math.PI / 5);
    }
    hole(10, r * 0.6, Math.PI, 0);
    return { shell: merge(...shell), light: merge(...light) };
  };

  // ---- skee-ball ----------------------------------------------------------------------------------------
  // A lane in its frame, the player at the origin facing -z, built the Ooga way: a plank alley between two bark logs
  // rising from the foul line to a log laid across its end, the hump that throws the coconut onto the target, a big
  // flagstone leaning back at `SKEE.tilt` with its rings daubed on in red earth, chalk and ochre, a crack of embers
  // glowing between each, a ring of chalk dots round them and a handprint in each lower corner; the hole in their
  // middle, the 50 cup above them and the 100 cups in its top corners, each cup half a coconut shell round its hole
  // with an ember glowing round its lip. Bamboo guards keep the coconut in, three canes a side lashed to posts at the
  // foul line, halfway and the hump; a woven basket at the front holds the coconuts still to roll over the ticket
  // slot. The lane's timber tells the game in earth paint: along each side an Ooga throwing, coconuts in flight, a
  // target and handprints under a zigzag, a sun spiral and a handprint on the wedge under the stone, and handprints
  // and a zigzag across its front. Over the stone two bamboo posts and a crossbar lashed at the corners carry a net of
  // lianas across the top and down the sides to the backboard, three big planks with a bone across them under a crown
  // of broad leaves, the scoreboards hung between. `SKEE.at(u, v, out)` places a point on the target: `u` across, `v`
  // up it from the rings' centre.
  const SKEE = {
    w: 0.8, foul: -0.5, hump: -4.6, board: { z: -4.85, y: 1.2 }, tilt: 0.62, centre: 0.75,
    rings: [0.18, 0.3, 0.45, 0.62], values: [40, 30, 20, 10], fifty: { v: 0.52, r: 0.09 }, hundred: { u: 0.3, v: 0.62, r: 0.075 }, top: 0.72,
    // The tray at the front: where the coconuts still to roll wait, two rows of four.
    tray: [-0.24, -0.08, 0.08, 0.24].flatMap((x) => [[x, -0.2], [x, -0.36]]), trayY: 0.9,
    alleyY: (z) => 0.78 + Math.min(1, Math.max(0, (z - -0.5) / (-4.6 - -0.5))) * 0.32,
    at: (u, v, out) => {
      const d = SKEE.centre + v;
      out.x = u; out.y = SKEE.board.y + d * Math.sin(SKEE.tilt) + 0.03; out.z = SKEE.board.z - d * Math.cos(SKEE.tilt);
      return out;
    }
  };
  // A ring or cup laid on the board's slope at (u, v).
  const onBoard = (geo, u, v, lift = 0) => {
    const p = SKEE.at(u, v, {});
    return moved(turnedX(geo, SKEE.tilt), p.x, p.y + lift, p.z);
  };
  // The paint along a lane's side, in the side's own frame: `x` metres back along -z, `y` up. The side runs from x 0.3
  // to 4.8 under its top edge, `y0` at the front to `y1` at the back; the wedge under the stone starts at `w0`.
  const skeeFrieze = (y0, y1, w0) => {
    const g = geometry(), top = (x) => y0 + (y1 - y0) * (x - 0.3) / 4.5, E = 0.12;
    daubStroke(g, Array.from({ length: 45 }, (_, k) => { const x = 0.42 + 4.26 * k / 44; return [x, top(x) - 0.13 + (k % 2 ? 0.04 : -0.04)]; }), 0.035, EARTH_OCHRE, E);
    daubOoga(g, 0.62, 0.03, 0.42, EARTH_CHALK, E);
    for (const [x, y, r] of [[1.2, 0.5, 0.042], [1.65, 0.47, 0.038], [2.1, 0.38, 0.034]]) daubDot(g, x, y, r, r, EARTH_CHALK, E);
    daubHand(g, 2.75, 0.12, 0.32, 0.2, EARTH_RED, E);
    daubDot(g, 3.65, 0.34, 0.2, 0.2, EARTH_RED, E);
    daubDot(g, 3.65, 0.34, 0.13, 0.13, EARTH_CHALK, E, 0, 0.003);
    daubDot(g, 3.65, 0.34, 0.06, 0.06, EARTH_RED, E, 0, 0.006);
    daubHand(g, 4.38, 0.16, 0.3, -0.25, EARTH_OCHRE, E);
    daubSpiral(g, w0 + 0.62, 0.55, 0.27, 0.035, EARTH_OCHRE, E);
    return daubHand(g, w0 + 1.2, 1.1, 0.3, 0.1, EARTH_CHALK, E);
  };
  const skeeLane = cached(() => {
    const { withJungle, liana, sagPoints, sprig, bamboo, lashing, log } = BL.hubModels;
    const w = SKEE.w, round = [], flat = [], glow = [], rand = mulberry32(61);
    const a0 = SKEE.alleyY(SKEE.foul), a1 = SKEE.alleyY(SKEE.hump), alley = (z) => a0 + (a1 - a0) * (z - SKEE.foul) / (SKEE.hump - SKEE.foul);
    // The board's top end; the scoreboards' height (`top`), the backboard (`back`, its planks' face at `face`), the
    // net's roof and the bone across the backboard.
    const L = SKEE.centre + SKEE.top + 0.12, end = [SKEE.board.z - Math.cos(SKEE.tilt) * L, SKEE.board.y + Math.sin(SKEE.tilt) * L];
    const top = end[1] + 0.9, back = end[0] - 0.15, face = back - 0.035, roof = end[1] + 0.3, bone = top + 1.05;
    // The lane's body under the alley and a wedge under the board; the alley, four bark-brown planks each laid in two
    // lengths butted at a staggered joint, dark seams sunk between them and the bark left on the outer edges of the
    // two outside ones, between bark logs; and a log across its end for the hump.
    flat.push(sideShape(ccw([[-0.3, 0], [-4.8, 0], [-4.8, a1 - 0.06], [-0.3, a0 - 0.06]]), 0, w + 0.3, TIMBER_DK));
    flat.push(sideShape(ccw([[-4.75, 0], [back - 0.05, 0], [back - 0.05, end[1] - 0.06], [end[0], end[1] - 0.06], [-4.75, 1.08]]), 0, w + 0.3, TIMBER_DK));
    const PLANK_BROWNS = ["#6a4428", "#5c3b22", "#71492c", "#634026"], at = (z, lift) => [z, alley(z) + lift];
    for (let k = 0; k < 4; k++) {
      const joint = SKEE.foul + (SKEE.hump - SKEE.foul) * [0.35, 0.58, 0.46, 0.66][k];
      for (const [z0, z1] of [[SKEE.foul, joint + 0.022], [joint - 0.022, SKEE.hump]]) flat.push(strip((k - 1.5) * w / 4, at(z0, -0.03), at(z1, -0.03), PLANK_BROWNS[(k + (z0 === SKEE.foul ? 0 : 2)) % 4], w / 4 - 0.018, 0.06));
    }
    for (const x of [-w / 4, 0, w / 4]) flat.push(strip(x, at(SKEE.foul, -0.04), at(SKEE.hump, -0.04), "#1c120a", 0.02, 0.04));
    for (const sx of [-1, 1]) flat.push(strip(sx * (w / 2 - 0.02), at(SKEE.foul, -0.012), at(SKEE.hump, -0.012), BARK, 0.03, 0.03));
    for (const sx of [-1, 1]) round.push(log(sx * 0.5, alley(-0.35) + 0.02, -0.35, sx * 0.5, alley(-4.72) + 0.02, -4.72, 0.085));
    round.push(log(-0.42, a1, -4.76, 0.42, a1, -4.76, 0.09));
    // The paint: the frieze down each side (mirrored on the -x side so its Ooga still throws toward the stone), and
    // handprints and a zigzag across the front.
    const frieze = () => skeeFrieze(a0 - 0.06, a1 - 0.06, 4.75);
    flat.push(moved(turnedY(frieze(), Math.PI / 2), (w + 0.3) / 2 + 0.003, 0, 0), moved(turnedY(mirroredX(frieze()), -Math.PI / 2), -(w + 0.3) / 2 - 0.003, 0, 0));
    const front = geometry();
    daubZigzag(front, -0.46, 0.46, 0.56, 0.045, 6, 0.035, EARTH_OCHRE, 0.12);
    daubHand(front, -0.25, 0.1, 0.3, 0.15, EARTH_RED, 0.12);
    daubHand(front, 0.24, 0.12, 0.28, -0.2, EARTH_CHALK, 0.12);
    flat.push(moved(front, 0, 0, -0.297));
    // Each side's guard: a bamboo rail lashed to a post at the foul line and run on through the cage's post at the
    // hump, two dry canes under it and a post halfway lashed to them all. The cage over the stone is the two hump
    // posts and a crossbar lashed across their tops.
    const X = 0.56, Z0 = -0.38, Z1 = -4.62, ZM = -2.5, rail = (z) => 1.34 + (z - Z0) / (Z1 - Z0) * 0.3;
    for (const sx of [-1, 1]) {
      round.push(bamboo(sx * X, a0, Z0, sx * X, rail(Z0) + 0.07, Z0, 0.034), lashing(sx * X, rail(Z0), Z0, 0, 1, 0, 0.034));
      round.push(bamboo(sx * X, rail(Z0 + 0.05), Z0 + 0.05, sx * X, rail(Z1 - 0.05), Z1 - 0.05, 0.032));
      round.push(bamboo(sx * X, a1 + 0.02, Z1, sx * X, roof + 0.07, Z1, 0.04), lashing(sx * X, roof, Z1, 0, 1, 0, 0.04));
      for (const drop of [0.19, 0.37]) round.push(bambooRun(sx * X, rail(Z0 + 0.05) - drop, Z0 + 0.05, sx * X, rail(Z1 - 0.05) - drop, Z1 - 0.05, 0.024, "#cdb06a"));
      round.push(bamboo(sx * X, alley(ZM) + 0.02, ZM, sx * X, rail(ZM) + 0.06, ZM, 0.03, "#cdb06a"));
      for (const drop of [0, 0.19, 0.37]) round.push(lashing(sx * X, rail(ZM) - drop, ZM, 0, 1, 0, 0.03));
    }
    round.push(bamboo(-X - 0.07, roof, Z1, X + 0.07, roof, Z1, 0.034));
    // The target: a flagstone laid along the board, its face a hair under where `SKEE.at` puts things, overhanging
    // the wedge a little. On it the rings in earth paint with an ember crack glowing between each, a ring of chalk
    // dots round them (none under a cup), a handprint in each lower corner and the hole in their middle; then the
    // cups: half coconut shells standing proud of the stone round their holes, streaked husk outside, a cream cut
    // edge and a dark inside, each glowing round its lip.
    const slope = -Math.atan2(end[1] - SKEE.board.y, end[0] - SKEE.board.z), sink = 0.018 - 0.07;
    flat.push(moved(turnedX(bevelBox({ w: w + 0.32, h: 0.14, d: L + 0.06, color: "#716457", bevel: 0.045 }), slope), 0,
      (SKEE.board.y + end[1]) / 2 + Math.cos(SKEE.tilt) * sink, (SKEE.board.z + end[0]) / 2 + Math.sin(SKEE.tilt) * sink));
    // Painted by hand: every ring runs a little out of round, the same way at the same radius so the cracks keep
    // between the bands, and the stone shows through the paint in specks.
    const byHand = (geo) => {
      const v = geo.verts;
      for (let k = 0; k < v.length; k += 3) {
        const d = Math.hypot(v[k], v[k + 2]);
        if (d < 1e-6) continue;
        const a = Math.atan2(v[k + 2], v[k]), f = 1 + Math.sin(a * 3 + d * 21) * 0.035 + Math.sin(a * 5 - d * 13) * 0.02;
        v[k] *= f; v[k + 2] *= f;
      }
      return geo;
    };
    const band = (r0, r1, color, e) => onBoard(byHand(lathe({ profile: [[r1, 0], [r0, 0]], segments: 32, color, emissive: e })), 0, 0);
    glow.push(band(0.1, 0.17, tint(EARTH_RED, 0.85), 0.08), band(0.19, 0.29, tint(EARTH_CHALK, 0.82), 0.05), band(0.31, 0.44, tint(EARTH_OCHRE, 0.82), 0.06));
    for (const r of SKEE.rings.slice(0, 3)) glow.push(onBoard(byHand(lathe({ profile: [[r + 0.006, 0.001], [r - 0.006, 0.001]], segments: 32, color: EMBER_GLOW, emissive: 0.18 })), 0, 0));
    const speck = mulberry32(62);
    for (let k = 0; k < 22; k++) {
      const a = speck() * Math.PI * 2, d = 0.11 + speck() * 0.32, r = 0.006 + speck() * 0.008;
      flat.push(onBoard(lathe({ profile: [[r, 0.0015], [0, 0.0015]], segments: 5, color: k % 2 ? "#6e6254" : "#857868" }), Math.sin(a) * d, Math.cos(a) * d));
    }
    // The ochre band made a sun: a short ray between every other pair of chalk dots, where the dots run.
    const rays = geometry();
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2, u = Math.sin(a) * 0.53, v = Math.cos(a) * 0.53;
      if (Math.hypot(u, v - SKEE.fifty.v) < 0.17 || Math.hypot(Math.abs(u) - SKEE.hundred.u, v - SKEE.hundred.v) < 0.15 || v < -0.3 && Math.abs(u) > 0.22) continue;
      glow.push(onBoard(lathe({ profile: [[0.018, 0], [0, 0.001]], segments: 6, color: EARTH_CHALK, emissive: 0.12 }), u, v));
      const b = a + Math.PI / 24;
      if (k % 2 === 0 && Math.hypot(Math.sin(b) * 0.5, Math.cos(b) * 0.5 - SKEE.fifty.v) > 0.17) daubStroke(rays, [[Math.sin(b) * 0.46, Math.cos(b) * 0.46], [Math.sin(b) * 0.53, Math.cos(b) * 0.53]], 0.024, tint(EARTH_OCHRE, 0.82), 0.06);
    }
    flat.push(onBoard(moved(turnedX(rays, -Math.PI / 2), 0, 0.0015, 0), 0, 0));
    for (const sx of [-1, 1]) flat.push(onBoard(turnedX(daubHand(geometry(), 0, 0, 0.22, -sx * 0.3, sx < 0 ? EARTH_RED : EARTH_CHALK, 0.15), -Math.PI / 2), sx * 0.38, -0.66, 0.004));
    flat.push(onBoard(lathe({ profile: [[0, 0], [0.09, 0], [0.09, 0.012], [0, 0.012]], segments: 16, color: "#120c08" }), 0, 0, 0.001));
    const streak = hexToRgb("#54391d"), cup = (u, v, r, color, h = 0.05) => {
      const husk = turn([[r + 0.03, 0], [r + 0.026, h * 0.55], [r + 0.012, h]], 9, "#6b4a26");
      husk.faces.forEach((f, k) => { if (k % 9 % 3 === 1) f.color = streak; });
      for (const part of [husk, turn([[r + 0.012, h], [r - 0.002, h]], 9, "#efe2c4"), turn([[r - 0.002, h], [r - 0.012, h * 0.4], [r * 0.6, -0.004], [0, -0.004]], 9, "#140e0a")]) round.push(onBoard(part, u, v));
      glow.push(onBoard(ring({ r: r + 0.022, thickness: 0.007, y: h - 0.012, segments: 12, color, emissive: 1 }), u, v));
    };
    cup(0, SKEE.fifty.v, SKEE.fifty.r, EMBER_GLOW);
    for (const sx of [-1, 1]) cup(sx * SKEE.hundred.u, SKEE.hundred.v, SKEE.hundred.r, "#ffc83a");
    // The backboard: three big planks, the middle one tallest, with a bone across them over the scoreboards.
    for (const k of [-1, 0, 1]) { const h = bone + (k ? 0.17 : 0.34); flat.push(bevelBox({ w: 0.39, h, d: 0.14, color: k ? TIMBER_DK : TIMBER, bevel: 0.04, offset: { x: k * 0.4, y: h / 2, z: back - 0.105 } })); }
    round.push(moved(turnedZ(turn([[0, -0.4], [0.03, -0.38], [0.022, -0.3], [0.022, 0.3], [0.03, 0.38], [0, 0.4]], 6, BONE), Math.PI / 2), 0, bone, face + 0.025));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) round.push(moved(ball(0.048, BONE, 6), sx * 0.4, bone + sy * 0.036, face + 0.025));
    // The basket the coconuts still to roll sit in: a woven floor with a rolled rope rim round its front and sides
    // (grown below), open at the back so the coconut in hand stays in sight. The floor's flat top ends just behind
    // where the back row rests (z -0.36): any further back it hides the coconut in hand from the player's eye. Under
    // its right end the ticket slot.
    flat.push(bevelBox({ w: 0.78, h: 0.06, d: 0.285, color: "#9a7236", bevel: 0.02, offset: { y: SKEE.trayY - 0.03, z: -0.2475 } }));
    flat.push(moved(turnedX(BL.models.panel({ w: 0.74, h: 0.245, tilesX: 9, tilesY: 3, color: "#d8b060", altColor: "#b08238" }), -Math.PI / 2), 0, SKEE.trayY + 0.002, -0.2475));
    flat.push(bevelBox({ w: 0.13, h: 0.1, d: 0.2, color: TIMBER_DK, bevel: 0.02, offset: { x: 0.45, y: 0.79, z: -0.2 } }), box({ w: 0.08, h: 0.006, d: 0.02, color: GLASS_DK, offset: { x: 0.42, y: 0.738, z: -0.12 } }));
    const body = withJungle(shaded(round, flat), (g) => {
      // The basket's rope rim, rounded at its front corners.
      const ry = SKEE.trayY + 0.015;
      liana(g, [[-0.39, ry, -0.37], [-0.39, ry, -0.14], [-0.365, ry, -0.113], [0.365, ry, -0.113], [0.39, ry, -0.14], [0.39, ry, -0.37]], 0.024, 0.024, "#c9a36a");
      // The net: lianas from the crossbar to the backboard in diamonds over the top and along its edges, a cross down
      // each side, and leaves where they tie on; then the crown of broad leaves over the backboard.
      const mid = (Z1 + face) / 2;
      for (const [ax, az, bx, bz] of [[-X, Z1, X, face], [X, Z1, -X, face], [0, Z1, X, mid], [0, Z1, -X, mid], [-X, mid, 0, face], [X, mid, 0, face], [-X, Z1, -X, face], [X, Z1, X, face]]) {
        liana(g, sagPoints(ax, roof, az, bx, roof, bz, 0.035, 3), 0.016, 0.012);
      }
      for (const sx of [-1, 1]) {
        liana(g, sagPoints(sx * X, rail(Z1) + 0.06, Z1, sx * X, roof - 0.02, face, 0.03, 3), 0.014, 0.011, "#2f5424");
        liana(g, sagPoints(sx * X, roof - 0.03, Z1, sx * X, end[1] + 0.02, face, 0.04, 3), 0.014, 0.011, "#2f5424");
        sprig(g, sx * X, roof + 0.07, Z1, sx * 0.7, 1, 0.25, 3, 0.2, rand);
        sprig(g, sx * X, roof, face + 0.02, sx * 0.6, 0.9, 0.15, 3, 0.2, rand);
      }
      sprig(g, 0, bone + 0.3, back - 0.13, 0, 1, -0.15, 5, 0.46, rand);
      for (const sx of [-1, 1]) sprig(g, sx * 0.4, bone + 0.13, back - 0.13, sx * 0.55, 1, -0.1, 4, 0.4, rand);
    });
    return { body, glow: unshadowed(merge(...glow)), boardAt: { x: 0, y: top + 0.55, z: back } };
  });
  // A bead of the aim guide the thro-ball game lays up the alley: a glowing chalk pebble, squashed flat.
  const skeeDot = cached(() => {
    const g = glowing(ball(0.022, "#fff3c8", 6), 0.9);
    for (let i = 1; i < g.verts.length; i += 3) g.verts[i] *= 0.45;
    return unshadowed(g);
  });

  // ---- hoop shot ----------------------------------------------------------------------------------------
  // In its frame, the player at the origin facing -z: a cage of four bamboo posts lashed to branch poles sloping up
  // its sides from the short front posts, kept below the scoreboards, the lane's own and its neighbour's, in the
  // player's view, and a log beam resting on the back posts with a torch burning on a stake over its middle, above
  // the scoreboards; lianas slung down each side with leaves along the upper one, over a ramp of split
  // bamboo, dry and dull, edged in rope that rolls the coconuts back; the backboard of timber planks at the far end, a
  // chalk sun spiral daubed over the hoop between two handprints under a zigzag, over a row of dots, tied back to the
  // beam the scoreboards stand on; and a log deck at the front, the coconuts waiting on its plank top behind a timber lip, half
  // a coconut shell with an ember glowing round its foot for the SHOOT button and the ticket slot under the plank's
  // front edge. The hoop and its net are their own geometry (`hoop`) so the machine can slide it; `HOOP` is where it
  // hangs.
  const HOOP = { y: 2.55, z: -3.05, r: 0.2, slide: 0.32, from: { x: 0, y: 1.25, z: -0.5 }, rack: [[-0.4, 0.95, -0.3], [0, 0.95, -0.3], [0.4, 0.95, -0.3]] };
  const hoopMachine = cached(() => {
    const { withJungle, liana, sagPoints, sprig, garland, bamboo, lashing, log } = BL.hubModels;
    const round = [], flat = [], glow = [], w = 1.4, near = -0.65, far = -3.6, top = 3.3, rand = mulberry32(73);
    // The ramp: five split bamboo canes in two tones from the deck down to the far end, each half a cane lying round
    // side up with a raised node ring every 0.6 m, staggered cane to cane, `s` metres up the slope; rope along its
    // edges (grown below).
    const len = Math.hypot(far - near, 0.3), tilt = Math.atan2(0.3, near - far), rampY = (z) => 0.5 + (z - near) / (far - near) * 0.3;
    const arch = (a, b, y0, n) => Array.from({ length: n + 1 }, (_, i) => [Math.cos(i / n * Math.PI) * a, y0 + Math.sin(i / n * Math.PI) * b]);
    const cane = arch(0.12, 0.055, -0.025, 5), knot = arch(0.128, 0.068, -0.027, 4), onRamp = (geo, x, s) => { const z = near + (far - near) * s / len; return moved(turnedX(geo, tilt), x, rampY(z), z); };
    for (let k = 0; k < 5; k++) {
      flat.push(onRamp(prism(cane, len, tint(k % 2 ? "#cdb06a" : "#b8a04a", 0.85)), (k - 2) * 0.26, len / 2));
      for (let s = 0.3 + (k % 2) * 0.3; s < len - 0.15; s += 0.6) flat.push(onRamp(prism(knot, 0.04, tint(k % 2 ? "#9a8450" : "#8a7838", 0.85)), (k - 2) * 0.26, s));
    }
    // The cage: bamboo posts at its corners lashed to branch poles along the sides at `pole`, low enough that they pass
    // under the scoreboards from the player's eye, a torch on each front post, outside the scoreboards from there too,
    // the log beam across the back resting on the back posts; the backboard's three planks, their chalk sun and the
    // paint round it.
    const pole = 2.9, low = 2.5, crown = top + 0.84;
    for (const sx of [-1, 1]) {
      for (const z of [near, far]) round.push(bamboo(sx * w / 2, 0, z, sx * w / 2, z === near ? low + 0.08 : top - 0.1, z, 0.05), lashing(sx * w / 2, z === near ? low : pole, z, 0, 1, 0, 0.05));
      round.push(log(sx * w / 2, low + 0.03, near + 0.1, sx * w / 2, pole + 0.02, far - 0.1, 0.05, "#7a5634"));
    }
    round.push(log(-w / 2 - 0.15, top - 0.02, far, w / 2 + 0.15, top - 0.02, far, 0.095));
    // The torch: a bamboo stake lashed up the back of the beam's middle, its fire burning over the scoreboards.
    round.push(bamboo(0, top - 0.1, far - 0.1, 0, crown + 0.02, far - 0.1, 0.035), lashing(0, top - 0.02, far - 0.1, 0, 1, 0, 0.035), torchHead(0, crown, far - 0.1, 0.085));
    glow.push(moved(scaled(blaze(), 0.6), 0, crown + 0.1, far - 0.1));
    for (let k = 0; k < 3; k++) flat.push(bevelBox({ w: 1.24, h: 0.255, d: 0.07, color: k % 2 ? TIMBER_LT : TIMBER, bevel: 0.03, offset: { y: HOOP.y + 0.35 + (k - 1) * 0.255, z: far + 0.3 } }));
    const paint = geometry();
    daubSpiral(paint, 0, HOOP.y + 0.25, 0.1, 0.022, EARTH_CHALK, 0.12);
    daubHand(paint, -0.44, HOOP.y + 0.19, 0.26, 0.18, EARTH_RED, 0.12);
    daubHand(paint, 0.44, HOOP.y + 0.19, 0.26, -0.18, EARTH_OCHRE, 0.12);
    daubZigzag(paint, -0.54, 0.54, HOOP.y + 0.64, 0.035, 7, 0.025, EARTH_CHALK, 0.12);
    for (const x of [-0.58, -0.47, -0.36, 0.36, 0.47, 0.58]) daubDot(paint, x, HOOP.y + 0.05, 0.022, 0.022, EARTH_CHALK, 0.12);
    flat.push(moved(paint, 0, 0, far + 0.337));
    // The log deck: two big logs across its front before a timber core under a plank top, the coconuts waiting on it
    // behind a timber lip, the SHOOT button behind them and the ticket slot under the plank's front edge.
    flat.push(bevelBox({ w: w + 0.1, h: 0.78, d: 0.32, color: TIMBER_DK, bevel: 0.04, offset: { y: 0.39, z: -0.49 } }));
    for (const y of [0.2, 0.58]) round.push(log(-0.8, y, -0.36, 0.8, y, -0.36, 0.19));
    flat.push(bevelBox({ w: w + 0.24, h: 0.05, d: 0.5, color: TIMBER_LT, bevel: 0.02, offset: { y: 0.805, z: -0.4 } }));
    flat.push(box({ w: 0.08, h: 0.012, d: 0.01, color: GLASS_DK, offset: { x: 0.62, y: 0.792, z: -0.147 } }));
    flat.push(bevelBox({ w: 1.32, h: 0.06, d: 0.06, color: TIMBER_DK, bevel: 0.02, offset: { y: 0.86, z: -0.185 } }));
    const shell = turn([[0.095, 0], [0.09, 0.035], [0.065, 0.068], [0, 0.082]], 10, "#6b4a26"), streak = hexToRgb("#54391d");
    shell.faces.forEach((f, k) => { if (k % 10 % 3 === 1) f.color = streak; });
    round.push(moved(shell, 0, 0.83, -0.54));
    glow.push(moved(ring({ r: 0.1, thickness: 0.012, segments: 14, color: EMBER_GLOW, emissive: 0.9 }), 0, 0.842, -0.54));
    const body = withJungle(shaded(round, flat), (g) => {
      // Rope along the ramp's edges and two ties across it, and two holding the backboard back to the beam; a liana
      // slung down each side where the steel cords were and a leafy one draped under each pole; leaves out of the
      // beam's ends.
      for (const z of [-1.1, -2.6]) liana(g, [[-0.66, rampY(z) + 0.045, z], [0.66, rampY(z) + 0.045, z]], 0.016, 0.016, "#c9a36a");
      for (const sx of [-1, 1]) {
        liana(g, [[sx * 0.655, rampY(near) + 0.01, near], [sx * 0.655, rampY(far) + 0.01, far]], 0.02, 0.02, "#c9a36a");
        liana(g, [[sx * 0.45, HOOP.y + 0.55, far + 0.265], [sx * 0.45, top - 0.06, far + 0.05]], 0.016, 0.016, "#c9a36a");
        liana(g, sagPoints(sx * w / 2, 1.75, near, sx * w / 2, 1.75, far, 0.12, 6), 0.022, 0.018);
        garland(g, sagPoints(sx * w / 2, low - 0.04, near, sx * w / 2, pole - 0.05, far, 0.2, 8), { r: 0.022, every: 0.7, size: 0.2, droop: 0.25, out: [sx * 0.94, 0.34, 0], rand });
        sprig(g, sx * (w / 2 + 0.15), top - 0.02, far, sx, 0.6, -0.2, 3, 0.24, rand);
      }
    });
    return { body, glow: unshadowed(merge(...glow)), boardAt: { x: 0, y: top + 0.42, z: far + 0.1 } };
  });
  // The hoop: two vines woven round each other into a ring, embers glowing where they cross and its timber bracket
  // (`rim`); a net of pale lianas criss-crossed in diamonds down to a narrower ring, a few small leaves at its foot
  // (`net`), apart so the net can swish; and the flames that ring the rim when it is on fire (`fire`); all centred on
  // the hoop's middle.
  const hoop = cached(() => {
    const { withJungle, liana, sprig } = BL.hubModels;
    const R = HOOP.r, beads = [], rand = mulberry32(89), NET = "#9fb55e";
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; beads.push(moved(ball(0.016, EMBER_GLOW, 5), Math.cos(a) * R, 0.02, Math.sin(a) * R)); }
    for (const b of beads) for (const f of b.faces) f.emissive = 1;
    const rim = withJungle(shaded(beads, [bevelBox({ w: 0.08, h: 0.035, d: 0.14, color: TIMBER_DK, bevel: 0.012, offset: { z: -R - 0.06 } })]), (g) => {
      const from = g.faces.length;
      for (let j = 0; j < 2; j++) {
        const pts = [];
        for (let i = 0; i <= 18; i++) { const a = i / 18 * Math.PI * 2, p = a * 3 + j * Math.PI, rr = R + Math.cos(p) * 0.011; pts.push([Math.cos(a) * rr, Math.sin(p) * 0.011, Math.sin(a) * rr]); }
        liana(g, pts, 0.012, 0.012, j ? "#c9a36a" : "#6f9a3a");
      }
      // A little light in the vines so the ring reads in the dim hall, as the old painted rim did.
      for (let i = from; i < g.faces.length; i++) g.faces[i].emissive = 0.15;
    });
    const net = withJungle(null, (g) => {
      const n = 8, step = Math.PI * 2 / n, at = (r, y, a) => [Math.cos(a) * r, y, Math.sin(a) * r];
      for (let k = 0; k < n; k++) {
        const a = (k + 0.5) * step, mid = at(R * 0.8, -0.15, a + step / 2);
        liana(g, [at(R, -0.012, a), mid, at(R * 0.6, -0.3, a + step)], 0.007, 0.006, NET);
        liana(g, [at(R, -0.012, a + step), mid, at(R * 0.6, -0.3, a)], 0.007, 0.006, NET);
      }
      liana(g, Array.from({ length: n + 1 }, (_, k) => at(R * 0.6, -0.3, (k + 0.5) * step)), 0.008, 0.008, NET);
      for (const k of [1, 4, 6]) { const [x, y, z] = at(R * 0.6, -0.3, (k + 0.5) * step); sprig(g, x, y, z, x, -0.12, z, 2, 0.07, rand); }
    });
    const fire = merge(...[0, 1, 2, 3, 4].map((k) => { const a = k / 5 * Math.PI * 2 + 0.3; return moved(scaled(blaze(), 0.3 + (k % 2) * 0.12), Math.cos(a) * R, 0.01, Math.sin(a) * R); }));
    // The light that says a throw now finds the hoop still there (`halo`): a band of ember light round the rim and the
    // shooter's square over it, drawn in light just proud of the backboard (its face 0.215 behind the rim's middle).
    const LIT = "#ffcf4a", sq = (w, h, x, y) => box({ w, h, d: 0.01, color: LIT, emissive: 1, offset: { x, y, z: -0.205 } });
    const halo = merge(torus(R + 0.006, 0.016, LIT, 1, 18, 4), sq(0.5, 0.03, 0, 0.37), sq(0.5, 0.03, 0, 0.035), sq(0.03, 0.305, -0.235, 0.2025), sq(0.03, 0.305, 0.235, 0.2025));
    return { rim, net, fire: unshadowed(fire), halo: unshadowed(halo) };
  });

  // ---- coconuts ------------------------------------------------------------------------------------------
  // Every ball in the arcade is a coconut. `coconutBall(style, r, spot)` is one centred on the origin, radius `r`:
  // round, so it rolls and spins true where a ball did (its eyes stand 0.03 r proud), painted in fibre streaks
  // running pole to pole into three dark eyes on its upper front. Styles: "husk" brown, "young" green (the thrown
  // ones), "golden" (it glows), "cue" peeled cream, "charred" black, or any "#rrggbb" for a painted one; anything else
  // throws. `spot` adds a cream number spot facing +z. Cached by style, radius and spot; `nut` builds a fresh one to
  // move, a touch taller than wide above its middle unless `egg` is false, for the coconuts that sit still.
  const NUTS = {
    husk: ["#6b4a26", "#54391d", "#86613a", "#221408"], young: ["#6f9a3a", "#56792c", "#8db850", "#2e3a14"],
    golden: ["#ffc83a", "#e0a228", "#ffe38a", "#8a5210"], cue: ["#efe2c4", "#dccba6", "#fbf3e0", "#6b4a26"],
    charred: ["#221c18", "#161210", "#3a3029", "#6a5648"]
  };
  const nut = (style, r, spot = false, egg = true) => {
    if (!NUTS[style] && !/^#[0-9a-f]{6}$/i.test(style)) throw new Error(`No coconut style "${style}"`);
    const [base, streak, fleck] = NUTS[style] ? NUTS[style].slice(0, 3).map(hexToRgb) : [1, 0.8, 1.15].map((k) => hexToRgb(style).map((v) => Math.min(255, Math.round(v * k))));
    const eye = NUTS[style] ? NUTS[style][3] : "#1c140c", segs = r >= 0.1 ? 14 : r >= 0.07 ? 12 : 10, L = 6, q = egg ? 1.21 : 1;
    // Round below the middle; an egg's top above it, drawn up a tenth and narrowed a little toward the eyes.
    const shape = (c) => { const u = egg ? Math.max(0, c) : 0; return [r * (1 - 0.08 * u), c * r * (1 + 0.1 * u)]; };
    const husk = lathe({ profile: Array.from({ length: L + 1 }, (_, k) => { const [w, y] = shape(-Math.cos(k / L * Math.PI)); return [Math.sin(k / L * Math.PI) * w, y]; }), segments: segs, color: "#000000", emissive: style === "golden" ? 0.35 : 0 });
    husk.faces.forEach((f, k) => { const p = Math.floor(k / segs), s = k % segs; f.color = s % 3 === 0 && s + 1 < segs && p > 0 && p < L - 1 ? streak : (s * 5 + p) % 7 === 0 ? fleck : base; });
    // Two eyes over the front and the third under them, each a dark bump set into the husk along its normal.
    const round = [husk], e = r * 0.15;
    for (const [tilt, yaw] of [[0.5, 0.45], [0.5, -0.45], [0.82, 0]]) {
      const [w, y] = shape(Math.cos(tilt)), x = Math.sin(yaw) * Math.sin(tilt) * w, z = Math.cos(yaw) * Math.sin(tilt) * w;
      const l = Math.hypot(x, y / q, z), nx = x / l, ny = y / q / l, nz = z / l, sink = e * 0.3;
      round.push(along(lathe({ profile: [[e, 0], [0, e * 0.5]], segments: 6, color: eye }), x - nx * sink, y - ny * sink, z - nz * sink, nx, ny, nz));
    }
    if (spot) round.push(moved(turnedX(lathe({ profile: [[r * 0.42, 0], [r * 0.3, r * 0.07], [0, r * 0.11]], segments: 10, color: "#f6ecd2" }), Math.PI / 2), 0, 0, r * 0.9));
    return shaded(round);
  };
  const nutCache = new Map();
  const coconutBall = (style = "husk", r = 0.075, spot = false) => {
    const key = `${style}|${r}|${spot}`;
    let geo = nutCache.get(key);
    if (geo) return geo;
    geo = nut(style, r, spot, false);
    nutCache.set(key, geo);
    return geo;
  };

  // ---- the coconut shy ------------------------------------------------------------------------------------
  // In its frame, the player at the origin facing -z: a timber counter on a reed front over a log, a leopard skin
  // pegged across the front, with a woven basket of young coconuts; a roof of two courses of big dry fronds over a dark
  // reed mat on four bamboo poles lashed at the joints, a torch burning on each front pole's top; a tall reed screen
  // at the back for the misses to thud into, dimly painted with the hunt in earth paint (a big chalk Ooga throwing a coconut
  // in a dashed arc at a red mammoth, handprints and a sun spiral over them, a zigzag and a row of dots under them),
  // the middle kept bare behind the targets; and five bamboo posts, each topped with a half coconut shell for a cup
  // the coconuts sit in (`SHY`). Over the eave a chunky plank sign between two tusks under a leaf garland; the prizes
  // (bananas, and a bone hung with feathers) on vines from the front poles' lashings, high and just inside the poles
  // so they stay out of the player's view, the scoreboards on vine cords from the roof, hung inside the booth over the
  // coconuts' flight where the player sees them whole, and carved coconut-shell lanterns on a liana; the fire (`glow`)
  // is the lanterns' and the torches'.
  // `swing` is where the bonus coconut's vine ties on under the roof's mat, in front of the posts, and how long it hangs.
  const SHY = { posts: [-1.2, -0.6, 0, 0.6, 1.2], z: -3.4, cup: 1.32, back: -4.2, from: { x: 0, y: 1.35, z: -0.6 }, swing: { y: 4.1, z: -3.05, len: 2.19 } };
  // The roof fronds' dried greens, as `bananaLeaf` takes them: [light, dark, tip light, tip dark].
  const PALM_DRY = [["#b2b24c", "#7e8a32", "#d0bc5e", "#a48a3c"], ["#a2aa44", "#6e7c2c", "#c2b054", "#947c36"]].map((p) => p.map(hexToRgb));
  const coconutShy = cached(() => {
    const { withJungle, liana, garland, sprig, sagPoints, bamboo, lashing, log } = BL.hubModels;
    const parts = [], round = [], w = 3.4, px = 1.82, front = -0.7, tie = 3.46, rand = mulberry32(4101);
    const straw = ["#c9a45a", "#b8914a", "#a88040", "#a39a55"].map(hexToRgb);
    const shell = ["#6b4a26", "#6b4a26", "#3a2616", "#f3ecd8", "#f3ecd8"].map(hexToRgb);
    // A reed screen facing +z, `mw` by `mh` up from (x0, y0) at z: split reeds `s` wide standing side by side, each one
    // of the three close straws (one in sixteen a dried green) dimmed by `k`, their tops a little ragged, tied across
    // with twine at the heights in `ties`, over a dark backing that shows in the fine gaps between them.
    const screen = (x0, y0, mw, mh, z, s, k, ties, seed) => {
      const n = Math.round(mw / s), cw = mw / n, pick = mulberry32(seed), dim = (c) => `#${c.map((v) => Math.round(v * k).toString(16).padStart(2, "0")).join("")}`;
      parts.push(box({ w: mw, h: mh, d: 0.04, color: "#4a361e", offset: { x: x0 + mw / 2, y: y0 + mh / 2, z: z - 0.025 } }));
      for (let i = 0; i < n; i++) {
        const r = pick(), h = mh - pick() * 0.06;
        parts.push(bevelBox({ w: cw * 0.9, h, d: 0.03, color: dim(straw[r < 0.06 ? 3 : Math.floor(r * 3)]), bevel: cw * 0.3, offset: { x: x0 + (i + 0.5) * cw, y: y0 + h / 2, z } }));
      }
      for (const t of ties) parts.push(box({ w: mw, h: 0.028, d: 0.02, color: dim([122, 92, 50]), offset: { x: x0 + mw / 2, y: y0 + t, z: z + 0.022 } }));
    };
    // The counter: its timber top over a reed front and a log along the floor. The back: a taller, darker screen, the
    // one the misses thud into at `SHY.back`.
    parts.push(bevelBox({ w, h: 0.12, d: 0.5, color: TIMBER_LT, bevel: 0.03, offset: { y: 1.02, z: -0.6 } }));
    screen(-1.65, 0.2, 3.3, 0.76, -0.41, 0.06, 0.9, [0.2, 0.58], 5);
    round.push(log(-w / 2, 0.11, -0.47, w / 2, 0.11, -0.47, 0.11));
    screen(-1.76, 0.02, 3.52, 4.32, SHY.back + 0.01, 0.08, 0.62, [0.55, 1.95, 3.35], 11);
    parts.push(moved(leopardPelt(1.56, 0.66, 4107), 0.05, 0.6, -0.372));
    // The back screen's paint, clear of the band behind the coconuts and kept dim so the real ones lead: the chalk
    // Ooga's coconut flies in a dashed arc up over the targets at a red mammoth off to the right.
    const art = geometry(), E = 0.06, chalk = tint(EARTH_CHALK, 0.74), flight = (t) => [-0.8 + 1.42 * t, 2.98 + Math.sin(t * Math.PI) * 0.32 + 0.04 * t];
    daubOoga(art, -1.2, 1.78, 1.05, chalk, E);
    MARK.mammoth(art, 1.1, 2.45, 0.62, tint(EARTH_RED, 0.7), E, 0, -1);
    for (let k = 0; k < 6; k++) { const t = 0.1 + k * 0.16; daubStroke(art, [flight(t - 0.035), flight(t + 0.035)], 0.035, chalk, E); }
    daubHand(art, -1.45, 3.3, 0.36, 0.22, EARTH_RED, E);
    daubHand(art, -1.02, 3.55, 0.3, -0.12, EARTH_OCHRE, E);
    daubHand(art, 1.38, 3.35, 0.34, -0.25, EARTH_RED, E);
    daubSpiral(art, 0.25, 3.75, 0.24, 0.04, EARTH_OCHRE, E);
    daubZigzag(art, -1.6, 1.6, 0.7, 0.07, 12, 0.05, EARTH_BLACK, 0.04);
    for (let k = 0; k < 16; k++) daubDot(art, -1.5 + k * 0.2, 0.38, 0.03, 0.03, EARTH_RED, E);
    parts.push(moved(art, 0, 0, SHY.back + 0.03));
    // The roof: a dark mat of reeds from the back poles down to its eave over the front ones, lashed to them under
    // it, under two courses of big dry fronds overlapping over it (grown below), and a torch on each front pole's top.
    parts.push(moved(turnedX(bevelBox({ w: 4, h: 0.05, d: 3.62, color: "#4e3a22", bevel: 0.02 }), 0.224), 0, 4.02, -2.48));
    const lit = [];
    for (const sx of [-1, 1]) {
      const x = sx * px;
      round.push(bamboo(x, 0, front, x, 4.64, front, 0.065), bamboo(x, 0, SHY.back, x, 4.34, SHY.back, 0.065), lashing(x, tie, front, 0, 1, 0, 0.065));
      round.push(torchHead(x, 4.6, front, 0.09));
      lit.push(moved(scaled(blaze(), 0.84), x, 4.6 + 0.108, front));
    }
    // The targets: five dry bamboo posts, each topped with a half coconut shell, husk outside and white inside.
    for (const x of SHY.posts) {
      const cup = lathe({ profile: [[0.04, 0], [0.085, 0.025], [0.106, 0.072], [0.096, 0.084], [0.06, 0.058], [0, 0.05]], segments: 8, color: "#000000" });
      cup.faces.forEach((f, k) => { f.color = shell[Math.floor(k / 8)]; });
      round.push(bamboo(x, 0, SHY.z, x, SHY.cup, SHY.z, 0.04, "#cdb06a"), moved(cup, x, SHY.cup, SHY.z));
    }
    // The throws: young coconuts heaped in a basket under a rolled rim, its sides woven in a twill of two close
    // straws that steps round it in fine diagonals.
    const basket = lathe({ profile: [[0, 0], [0.1, 0], [0.13, 0.03], [0.147, 0.065], [0.16, 0.1], [0.167, 0.14], [0.172, 0.18], [0.178, 0.22], [0.195, 0.232], [0.176, 0.248], [0.155, 0.23], [0, 0.17]], segments: 16, color: "#000000" });
    basket.faces.forEach((f, k) => { const p = Math.floor(k / 16); f.color = straw[p > 0 && p < 7 ? ((p + k) % 4 < 2 ? 1 : 2) : p < 10 ? 0 : 2]; });
    round.push(moved(basket, 1.2, 1.08, -0.6));
    for (let k = 0; k < 5; k++) round.push(moved(nut("young", 0.05), 1.2 + (k % 3 - 1) * 0.05, 1.3 + (k > 2 ? 0.05 : 0), -0.6 + (k % 2 - 0.5) * 0.06));
    // The sign: a chunky plank on the front poles, above the eave, its letters brushed in chalk. The prizes strung
    // down the front poles: bananas, and between them a bone hung with feathers (grown below).
    parts.push(bevelBox({ w: 3.76, h: 0.6, d: 0.12, color: TIMBER, bevel: 0.04, offset: { y: 4.3, z: -0.56 } }), brushWord(geometry(), "COCONUT TOSS", 0, 4.3, 0.3, 0.05, EARTH_CHALK, 0.35, -0.496));
    const banana = BL.models.bananaGeometry();
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
      const x = sx * (w / 2 + 0.02), y = 3 - k * 0.3, z = -0.55;
      if (k % 2) round.push(moved(boneBar(0.2, 0.02), x, y + 0.12, z));
      else parts.push(moved(turnedZ(scaled(banana, 0.9), 0.6 * sx), x, y, z));
    }
    // The lanterns, one by each pole, hung on a short cord from the liana slung between the front poles under the eave.
    const line = sagPoints(-px, tie, -0.62, px, tie, -0.62, 0.14, 12), cords = [];
    for (const x of [-1.55, 1.55]) {
      const y = tie - Math.sin((x + px) / (2 * px) * Math.PI) * 0.14 - 0.012, cord = 0.07, lamp = shellLantern(0.098);
      round.push(moved(lamp.shell, x, y - cord, -0.62));
      lit.push(moved(lamp.light, x, y - cord, -0.62));
      cords.push([x, y, y - cord]);
    }
    const body = withJungle(shaded(round, parts), (g) => {
      // The lanterns' liana and their cords, and the vines the prizes hang on from the front poles' lashings, the
      // feathers under each prize bone.
      garland(g, line, { r: 0.022, every: 0.9, size: 0.15, droop: 0.5, out: [0, 0.3, 1], rand });
      for (const [x, y0, y1] of cords) liana(g, [[x, y0, -0.62], [x, y1 + 0.004, -0.62]], 0.008, 0.008, "#c9a36a");
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 + 0.02);
        liana(g, [[sx * px, tie, -0.62], [x, 3.25, -0.57], [x, 3, -0.55], [x, 2.7, -0.55], [x, 2.35, -0.55]], 0.018, 0.013, "#2f5424");
        sprig(g, sx * px, tie + 0.02, -0.62, sx * 0.4, 0.3, 1, 3, 0.2, rand);
        FEATHERS.forEach(([light, dark], k) => BL.hubModels.pointedLeaf(g, x + (k - 1) * 0.07, 2.8, -0.53, (k - 1) * 0.25, -1, 0, 1, (k - 1) * 0.25, 0, 0, 0, 1, 0.24 - Math.abs(k - 1) * 0.04, light, dark));
        // A tusk rising from each end of the sign.
        liana(g, [[1.42, 4.14, -0.56], [1.58, 4.13, -0.46], [1.7, 4.22, -0.44], [1.79, 4.42, -0.44], [1.78, 4.64, -0.45], [1.68, 4.8, -0.47], [1.54, 4.9, -0.49]].map(([tx, ty, tz]) => [sx * tx, ty, tz]), 0.055, 0.008, BONE);
      }
      // The roof's dry palm fronds, laid from its back edge down over the mat, and a second course from its middle
      // between them, broad enough to lap their neighbours, their tips short of the eave behind the sign.
      for (let k = 0; k < 7; k++) bananaLeaf(g, -1.8 + k * 0.6, 4.5, -4.26, { yaw: Math.PI + (k - 3) * 0.05, up: 0.02, down: -0.48, len: 3.3, broad: 0.52, tone: PALM_DRY[k % 2], tear: k % 2 ? 4 : -6 });
      for (let k = 0; k < 6; k++) bananaLeaf(g, -1.5 + k * 0.6, 4.16, -2.75, { yaw: Math.PI + (k - 2.5) * 0.08, up: 0.1, down: -0.55, len: 2, broad: 0.5, tone: PALM_DRY[(k + 1) % 2], tear: k % 2 ? -3 : 4 });
      // The scoreboards' cords up to the roof's mat, and the garland along the sign's top from tusk to tusk.
      for (const x of [-1.25, -0.55, 0.55, 1.25]) liana(g, [[x, 2.81, -1.6], [x, 3.8, -1.62]], 0.012, 0.012, "#2f5424");
      garland(g, [[-1.54, 4.9, -0.49], [-1.45, 4.7, -0.52], [-0.75, 4.645, -0.53], [0, 4.645, -0.53], [0.75, 4.645, -0.53], [1.45, 4.7, -0.52], [1.54, 4.9, -0.49]], { r: 0.03, every: 0.42, size: 0.22, droop: 0.15, out: [0, 0.9, 0.45], rand });
    });
    return { body, glow: unshadowed(merge(...lit)) };
  });
  // A shy's coconut: the husk with its three dark eyes, 0.25 wide and 0.26 tall, set 0.1 up so it sits on its cup's
  // rim, its round bottom dipping 0.024 below y 0 into the bowl it hides; variant 1 is the golden one.
  const coconut = variants((i) => moved(nut(i ? "golden" : "husk", 0.124), 0, 0.1, 0));
  // The bonus coconut's vine, hanging from its knot at the origin `SHY.swing.len` down, a leaf or two along it and a
  // lashing at its foot where the coconut ties on.
  const shyVine = cached(() => BL.hubModels.withJungle(null, (g) => {
    const { liana, sprig } = BL.hubModels, L = SHY.swing.len, rand = mulberry32(4133);
    liana(g, [[0, 0, 0], [0.015, -L * 0.3, 0.01], [-0.012, -L * 0.62, -0.008], [0, -L, 0]], 0.02, 0.014, "#3f6a2a");
    liana(g, [[0, -L + 0.03, 0], [0, -L - 0.03, 0]], 0.03, 0.03, "#c9a36a");
    sprig(g, 0.01, -L * 0.34, 0.01, 0.7, -0.2, 0.3, 2, 0.12, rand);
    sprig(g, -0.01, -L * 0.7, 0, -0.7, -0.3, 0.3, 2, 0.1, rand);
  }));
  // The games' balls, all coconuts: 0 the hoop shot's, 1 skee-ball's, 2 the shy's young green thrown one.
  const balls = variants((i) => coconutBall(i === 2 ? "young" : "husk", [0.12, 0.075, 0.06][i]));
  // A carnival game's meter: a dark timber stick with its window painted leaf green where the bead should stop
  // (`METER_WINDOW`, as a fraction of the track), the bead the scene slides along it, a little bone standing up; and
  // the aim marker, a knapped arrowhead of glowing bone pointing down, its shaft's stub bound on with sinew.
  const METER_LEN = 0.9, METER_WINDOW = [0.63, 0.77];
  const meter = cached(() => ({
    track: merge(
      bevelBox({ w: METER_LEN + 0.06, h: 0.07, d: 0.03, color: TIMBER_DK, bevel: 0.012 }),
      box({ w: METER_LEN * (METER_WINDOW[1] - METER_WINDOW[0]), h: 0.05, d: 0.035, color: "#6fae3a", emissive: 0.45, offset: { x: METER_LEN * ((METER_WINDOW[0] + METER_WINDOW[1]) / 2 - 0.5) } })
    ),
    bead: glowing(turnedZ(boneBar(0.08, 0.012), Math.PI / 2), 0.6)
  }));
  const arrow = cached(() => merge(
    prism(ccw([[0, 0], [0.07, 0.09], [0.035, 0.14], [-0.035, 0.14], [-0.07, 0.09]]), 0.03, "#f3e6c8", 0.85),
    box({ w: 0.024, h: 0.06, d: 0.024, color: TIMBER_LT, emissive: 0.3, offset: { y: 0.165 } }), box({ w: 0.034, h: 0.022, d: 0.034, color: EARTH_BLACK, offset: { y: 0.15 } })
  ));

  // ---- hides and cave paint -------------------------------------------------------------------------------
  // An animal hide stretched `w` by `h` in the (x, y) plane, its fur facing +z: its four legs pulled out to the
  // corners and its sides drawn in between them. `sag` billows its middle back along -z (negative sags it toward the
  // fur side) and `wrap` bends it round an axis along y that far behind it, for a blanket over a back (0 lies flat).
  // A coarse sheet in the fur's ground colour with suede on its back, and the markings laid a few millimetres proud of
  // the fur: "leopard" broken rosettes round a darker heart, "tiger" stripes tapering in from its top and bottom
  // edges, "buck" a few soft darker patches. A round part for `shaded`; `seed` lays the markings. `HIDES` holds each
  // kind's [fur, markings, heart]; the cabinets' fronts keep their own `HIDE_TONES`, a game's colour mixed in.
  const HIDES = { leopard: ["#d9a352", "#33200f", "#b8782e"], tiger: ["#dc8a34", "#23160c", "#f2cf98"], buck: ["#c49a64", "#94703f", "#dcb680"] };
  const hide = (w, h, kind, seed, { sag = 0, wrap = 0 } = {}) => {
    const [fur, ink, heart] = HIDES[kind].map(hexToRgb), suede = hexToRgb("#9c7648"), rand = mulberry32(seed), geo = geometry();
    const NX = Math.max(wrap ? 6 : 4, Math.min(10, Math.round(w / 0.25))), NY = Math.max(3, Math.min(8, Math.round(h / 0.25)));
    // The sheet's point at (u, v), each 0 to 1 across it, lifted `lift` off it toward the fur.
    const point = (u, v, lift) => {
      const x = (u - 0.5) * w * (1 - 0.12 * Math.sin(Math.PI * v)), y = (v - 0.5) * h * (1 - 0.12 * Math.sin(Math.PI * u));
      const z = lift - sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      if (!wrap) return pushVert(geo, x, y, z);
      const a = x / wrap;
      return pushVert(geo, Math.sin(a) * (wrap + z), y, Math.cos(a) * (wrap + z) - wrap);
    };
    for (const side of [1, -1]) {
      const rows = [];
      for (let j = 0; j <= NY; j++) rows.push(Array.from({ length: NX + 1 }, (_, i) => point(i / NX, j / NY, side < 0 ? -0.003 : 0)));
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const q = [rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]];
        face(geo, side > 0 ? q : q.reverse(), side > 0 ? fur : suede);
      }
    }
    // A marking: a convex outline in metres from the hide's middle, kept on the hide.
    const mark = (pts, color) => {
      const uv = pts.map(([x, y]) => [Math.min(0.97, Math.max(0.03, x / w + 0.5)), Math.min(0.97, Math.max(0.03, y / h + 0.5))]);
      face(geo, ccw(uv).map(([u, v]) => point(u, v, 0.004)), color);
    };
    if (kind === "leopard") {
      const s = Math.min(0.3, Math.max(0.12, Math.min(w, h) / 5)), nx = Math.max(1, Math.round(w / s)), ny = Math.max(1, Math.round(h / s));
      for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
        const cx = ((a + 0.5 + (b % 2 ? 0.2 : -0.2) + (rand() - 0.5) * 0.4) / nx - 0.5) * w * 0.9, cy = ((b + 0.5 + (rand() - 0.5) * 0.4) / ny - 0.5) * h * 0.9;
        const q = s * (0.26 + rand() * 0.08), turn0 = rand() * 6.3, at = (t, r) => [cx + Math.cos(t) * r, cy + Math.sin(t) * r * 0.85];
        mark([0, 1, 2, 3, 4, 5].map((k) => at(turn0 + k / 6 * Math.PI * 2, q * 0.55)), heart);
        for (let k = 0; k < 3; k++) {
          const a0 = turn0 + k * 2.1, a1 = a0 + 0.75, a2 = a0 + 1.5;
          mark([at(a0, q * 0.6), at(a0, q), at(a1, q), at(a1, q * 0.6)], ink);
          mark([at(a1, q * 0.6), at(a1, q), at(a2, q), at(a2, q * 0.6)], ink);
        }
      }
    } else if (kind === "tiger") {
      const n = Math.max(3, Math.round(w / 0.13));
      for (let k = 0; k < n; k++) for (const edge of [-1, 1]) {
        if (rand() < 0.2) continue;
        const reach = h * (0.28 + rand() * 0.2), wide = w / n * (0.3 + rand() * 0.15), lean = (rand() - 0.5) * 0.3;
        // Four tapering steps in from the edge, the last one to a point.
        let px = ((k + 0.5 + (edge > 0 ? 0.5 : 0)) / n - 0.5) * w, py = edge * h / 2, pw = wide;
        for (let j = 0; j < 4; j++) {
          const nx = px + lean * reach / 4 + Math.sin(k * 1.7 + j) * wide * 0.4, ny = py - edge * reach / 4, nw = j < 3 ? wide * (1 - (j + 1) / 4) : 0;
          mark(nw ? [[px - pw / 2, py], [px + pw / 2, py], [nx + nw / 2, ny], [nx - nw / 2, ny]] : [[px - pw / 2, py], [px + pw / 2, py], [nx, ny]], ink);
          px = nx; py = ny; pw = nw;
        }
      }
    } else for (let k = 0; k < 4; k++) {
      const cx = (rand() - 0.5) * w * 0.6, cy = (rand() - 0.5) * h * 0.6, q = Math.min(w, h) * (0.12 + rand() * 0.08), t0 = rand() * 3;
      mark(Array.from({ length: 7 }, (_, j) => { const t = j / 7 * Math.PI * 2; return [cx + Math.cos(t + t0) * q, cy + Math.sin(t + t0) * q * 0.7]; }), ink);
    }
    return geo;
  };
  // Letters and figures brushed on in earth paint, every sign and scoreboard in the hall but the screens: each a few
  // strokes (runs of [x, y] points, split at the sharp corners) in a box 0.62 wide and 1 tall, the capitals, the
  // figures and ! ? ( ) -. `brushWord` paints `s` centred on (x, y), `h` tall with a stroke `w` wide, each letter
  // leaning and bobbing a little as a hand paints them; `brushWidth` is how wide it comes out, to set one flush.
  const OVAL = (rx) => Array.from({ length: 15 }, (_, k) => [0.31 + Math.sin(k / 14 * Math.PI * 2) * rx, 0.5 + Math.cos(k / 14 * Math.PI * 2) * 0.49]);
  const BRUSH = {
    " ": [],
    A: [[[0, 0], [0.31, 1]], [[0.31, 1], [0.62, 0]], [[0.12, 0.36], [0.5, 0.36]]],
    B: [[[0.05, 0], [0.05, 1]], [[0.05, 1], [0.38, 1], [0.54, 0.9], [0.56, 0.72], [0.42, 0.56], [0.05, 0.55]], [[0.4, 0.55], [0.58, 0.44], [0.6, 0.18], [0.44, 0.02], [0.05, 0]]],
    C: [[[0.58, 0.82], [0.46, 0.97], [0.26, 0.99], [0.08, 0.82], [0.02, 0.5], [0.08, 0.18], [0.26, 0.01], [0.46, 0.02], [0.58, 0.18]]],
    D: [[[0.05, 0], [0.05, 1]], [[0.05, 1], [0.3, 0.99], [0.52, 0.84], [0.61, 0.5], [0.52, 0.16], [0.3, 0.01], [0.05, 0]]],
    E: [[[0.56, 1], [0.05, 1]], [[0.05, 1], [0.05, 0]], [[0.05, 0], [0.58, 0]], [[0.05, 0.52], [0.46, 0.52]]],
    F: [[[0.58, 1], [0.05, 1]], [[0.05, 1], [0.05, 0]], [[0.05, 0.52], [0.46, 0.52]]],
    G: [[[0.58, 0.82], [0.46, 0.97], [0.26, 0.99], [0.08, 0.82], [0.02, 0.5], [0.08, 0.18], [0.26, 0.01], [0.46, 0.02], [0.6, 0.18], [0.6, 0.44]], [[0.6, 0.44], [0.34, 0.44]]],
    H: [[[0.05, 0], [0.05, 1]], [[0.57, 0], [0.57, 1]], [[0.05, 0.52], [0.57, 0.52]]],
    I: [[[0.31, 0], [0.31, 1]], [[0.12, 1], [0.5, 1]], [[0.12, 0], [0.5, 0]]],
    J: [[[0.2, 1], [0.58, 1]], [[0.47, 1], [0.47, 0.26], [0.4, 0.07], [0.24, 0], [0.09, 0.07], [0.03, 0.24]]],
    K: [[[0.05, 0], [0.05, 1]], [[0.58, 1], [0.06, 0.42]], [[0.24, 0.62], [0.6, 0]]],
    L: [[[0.05, 1], [0.05, 0]], [[0.05, 0], [0.58, 0]]],
    M: [[[0.03, 0], [0.07, 1]], [[0.07, 1], [0.31, 0.38]], [[0.31, 0.38], [0.55, 1]], [[0.55, 1], [0.59, 0]]],
    N: [[[0.05, 0], [0.05, 1]], [[0.05, 1], [0.57, 0]], [[0.57, 0], [0.57, 1]]],
    O: [OVAL(0.29)],
    P: [[[0.05, 0], [0.05, 1]], [[0.05, 1], [0.38, 1], [0.56, 0.88], [0.57, 0.66], [0.4, 0.52], [0.05, 0.51]]],
    Q: [OVAL(0.29), [[0.34, 0.26], [0.62, -0.04]]],
    R: [[[0.05, 0], [0.05, 1]], [[0.05, 1], [0.38, 1], [0.56, 0.88], [0.57, 0.66], [0.4, 0.52], [0.05, 0.51]], [[0.3, 0.51], [0.6, 0]]],
    S: [[[0.57, 0.84], [0.44, 0.98], [0.2, 0.98], [0.05, 0.84], [0.07, 0.64], [0.3, 0.52], [0.52, 0.42], [0.6, 0.22], [0.46, 0.02], [0.2, 0.01], [0.03, 0.16]]],
    T: [[[0, 1], [0.62, 1]], [[0.31, 1], [0.31, 0]]],
    U: [[[0.05, 1], [0.05, 0.3], [0.13, 0.08], [0.31, 0], [0.49, 0.08], [0.57, 0.3], [0.57, 1]]],
    V: [[[0.02, 1], [0.31, 0]], [[0.31, 0], [0.6, 1]]],
    W: [[[0, 1], [0.13, 0]], [[0.13, 0], [0.31, 0.6]], [[0.31, 0.6], [0.49, 0]], [[0.49, 0], [0.62, 1]]],
    X: [[[0.03, 1], [0.59, 0]], [[0.59, 1], [0.03, 0]]],
    Y: [[[0.02, 1], [0.31, 0.48]], [[0.6, 1], [0.31, 0.48]], [[0.31, 0.48], [0.31, 0]]],
    Z: [[[0.04, 1], [0.58, 1]], [[0.58, 1], [0.04, 0]], [[0.04, 0], [0.6, 0]]],
    "!": [[[0.31, 1], [0.31, 0.28]], [[0.31, 0.04], [0.31, 0]]],
    "?": [[[0.07, 0.76], [0.18, 0.94], [0.36, 1], [0.54, 0.9], [0.57, 0.7], [0.44, 0.54], [0.31, 0.44], [0.31, 0.26]], [[0.31, 0.04], [0.31, 0]]],
    "(": [[[0.46, 1.04], [0.26, 0.84], [0.17, 0.5], [0.26, 0.16], [0.46, -0.04]]],
    ")": [[[0.16, 1.04], [0.36, 0.84], [0.45, 0.5], [0.36, 0.16], [0.16, -0.04]]],
    "-": [[[0.1, 0.47], [0.52, 0.47]]],
    0: [OVAL(0.25)],
    1: [[[0.14, 0.78], [0.36, 1]], [[0.36, 1], [0.36, 0]]],
    2: [[[0.06, 0.76], [0.18, 0.94], [0.36, 1], [0.54, 0.9], [0.58, 0.7], [0.44, 0.46], [0.04, 0]], [[0.04, 0], [0.6, 0]]],
    3: [[[0.06, 0.9], [0.28, 1], [0.5, 0.95], [0.56, 0.76], [0.44, 0.58], [0.26, 0.53]], [[0.26, 0.53], [0.5, 0.46], [0.6, 0.26], [0.5, 0.06], [0.3, 0], [0.04, 0.08]]],
    4: [[[0.46, 0], [0.46, 1]], [[0.46, 1], [0.03, 0.32]], [[0.03, 0.32], [0.62, 0.32]]],
    5: [[[0.56, 1], [0.1, 1]], [[0.1, 1], [0.06, 0.56]], [[0.06, 0.56], [0.3, 0.62], [0.52, 0.54], [0.6, 0.32], [0.52, 0.1], [0.3, 0], [0.04, 0.08]]],
    6: [[[0.52, 0.97], [0.3, 0.98], [0.12, 0.8], [0.04, 0.46], [0.1, 0.14], [0.3, 0.01], [0.5, 0.06], [0.6, 0.26], [0.52, 0.48], [0.3, 0.55], [0.1, 0.44]]],
    7: [[[0.02, 1], [0.6, 1]], [[0.6, 1], [0.22, 0]]],
    8: [[[0.31, 0.55], [0.1, 0.66], [0.08, 0.86], [0.24, 0.99], [0.4, 0.99], [0.54, 0.86], [0.52, 0.66], [0.31, 0.55], [0.06, 0.4], [0.06, 0.14], [0.24, 0.01], [0.4, 0.01], [0.58, 0.14], [0.56, 0.4], [0.31, 0.55]]],
    9: [[[0.56, 0.62], [0.34, 0.46], [0.12, 0.52], [0.04, 0.74], [0.18, 0.96], [0.4, 0.99], [0.56, 0.84], [0.6, 0.52], [0.5, 0.2], [0.3, 0.01], [0.08, 0.06]]]
  };
  const brushWidth = (s, h) => (s.length * 0.84 - 0.22) * h;
  const brushWord = (g, s, x, y, h, w, color, e = 0, z = 0) => {
    const adv = 0.84 * h, x0 = x - brushWidth(s, h) / 2;
    [...s].forEach((ch, k) => {
      const lean = ((k * 37 + s.length) % 7 - 3) * 0.02, bob = ((k * 53) % 5 - 2) * 0.015 * h, c = Math.cos(lean), sn = Math.sin(lean);
      for (const run of BRUSH[ch]) daubStroke(g, run.map(([u, v]) => { const px = (u - 0.31) * h, py = (v - 0.5) * h; return [x0 + k * adv + 0.31 * h + px * c - py * sn, y + bob + px * sn + py * c]; }), w, color, e, z);
    });
    return g;
  };
  // Sets how much every face of a freshly built geometry glows.
  const glowing = (geo, e) => { for (const f of geo.faces) f.emissive = e; return geo; };

  // ---- the snack bar --------------------------------------------------------------------------------------
  // In its frame facing +z (customers on +z), a jungle hut: a bevelled counter faced with bamboo canes, its top a
  // plank with a bark log along its front, under a roof of big banana fronds and dry ones laid over a dark reed mat
  // that runs from the back wall out past it to a bamboo lintel lashed to two poles, the fronds reaching over its eave, a liana
  // up each pole with leaves at its top and foot and a gourd hung by each pole; three log-stump stools, back shelves
  // of gourds and clay pots, a wooden churn, a domed stone oven on a hearth slab with the fire glowing in its mouth and
  // firewood stacked by it, a hollow-log keg on stone chocks with bamboo spouts, a banana bunch and coconut drinks with
  // reed straws, and the menu brushed on a stone slab in a frame of bamboo canes lashed at the corners, hung toward +x
  // (`MENU_X`) so the hall's wall post at x -0.4 stands clear beside it. `lit` is what glows (the oven's fire and
  // embers) and `glass` the flames licking out of the oven's mouth.
  const MENU = ["OOGA SNACKS", "BANANA SPLIT 5", "COCONUT MILK 3", "GRUB STICK 2", "FIRE BANANA 4"], MENU_X = 1.1;
  const snackBar = cached(() => {
    const { withJungle, liana, sprig, bamboo, lashing, log } = BL.hubModels, parts = [], round = [], w = 4.2, leaf = mulberry32(57);
    parts.push(bevelBox({ w, h: 1.05, d: 0.8, color: TIMBER_DK, bevel: 0.04, offset: { y: 0.52 } }));
    parts.push(bevelBox({ w: w + 0.2, h: 0.1, d: 1, color: TIMBER_LT, bevel: 0.03, offset: { y: 1.1 } }));
    round.push(log(-w / 2 - 0.1, 1.1, 0.47, w / 2 + 0.1, 1.1, 0.47, 0.056, "#5a3e24"));
    for (let k = 0; k < 5; k++) round.push(bambooRun(0.08 - w / 2, 0.1 + k * 0.2, 0.475, w / 2 - 0.08, 0.1 + k * 0.2, 0.475, 0.075, k % 2 ? "#cdb06a" : "#b8a04a"));
    for (const sx of [-1, 1]) round.push(bamboo(sx * (w / 2 + 0.03), 0, 0.45, sx * (w / 2 + 0.03), 1.05, 0.45, 0.08));
    for (const x of [-1.3, 0, 1.3]) round.push(log(x, 0, 1, x, 0.7, 1, 0.19));
    // The roof: a dark reed mat from the back wall under the menu board out past the counter, resting on a lintel and
    // two poles, its top at `roofY(z)`, under the fronds (grown below).
    const roofY = (z) => 2.69 - 0.22 * (z + 1.62);
    parts.push(moved(turnedX(bevelBox({ w: w + 0.24, h: 0.05, d: 2.48, color: "#4e3a22", bevel: 0.02 }), 0.2166), 0, roofY(-0.41) - 0.026, -0.41));
    round.push(bambooRun(-2.22, 2.1, 0.64, 2.22, 2.1, 0.64, 0.055));
    for (const sx of [-1, 1]) round.push(bamboo(sx * 2.14, 0, 0.64, sx * 2.14, 2.1, 0.64, 0.06), lashing(sx * 2.14, 2.1, 0.64, 0, 1, 0, 0.06));
    parts.push(bevelBox({ w, h: 0.08, d: 0.4, color: TIMBER, bevel: 0.02, offset: { y: 1.62, z: -1.3 } }), bevelBox({ w, h: 0.08, d: 0.4, color: TIMBER, bevel: 0.02, offset: { y: 2.12, z: -1.3 } }));
    // Gourds and clay pots along the shelves, and the churn on the counter.
    const rand = mulberry32(55);
    for (let k = 0; k < 9; k++) {
      const gourd = rand() < 0.55, tone = Math.floor(rand() * 3);
      const profile = gourd ? [[0.07, 0], [0.085, 0.05], [0.07, 0.11], [0.034, 0.14], [0.045, 0.18], [0.03, 0.22], [0, 0.23]] : [[0.06, 0], [0.09, 0.06], [0.085, 0.13], [0.05, 0.18], [0.06, 0.2], [0, 0.2]];
      round.push(moved(turn(profile, 10, gourd ? ["#b8a040", "#9a8a3a", "#c8a84a"][tone] : ["#a8542e", "#8e4a2a", "#b86a3a"][tone]), -w / 2 + 0.3 + k * 0.45, k % 2 ? 1.66 : 2.16, -1.3));
    }
    parts.push(moved(lathe({ profile: [[0.1, 0], [0.1, 0.12], [0.08, 0.14], [0.09, 0.4], [0, 0.42]], segments: 12, color: TIMBER_LT }), 1.4, 1.15, -0.1));
    // The menu: a stone slab on the back wall in a frame of four canes lashed at its corners, the bar's name brushed
    // in ochre over the dishes in chalk, each dish's pictograph beside it (a banana, a coconut, a grub on a stick and a
    // flame).
    parts.push(bevelBox({ w: 2.4, h: 1.75, d: 0.1, color: "#5d5650", bevel: 0.05, offset: { x: MENU_X, y: 3.7, z: -1.56 } }), box({ w: 2.2, h: 1.55, d: 0.02, color: "#4e463f", offset: { x: MENU_X, y: 3.7, z: -1.5 } }));
    for (const y of [2.87, 4.51]) round.push(bambooRun(MENU_X - 1.2, y, -1.47, MENU_X + 1.2, y, -1.47, 0.045));
    for (const sx of [-1, 1]) {
      round.push(bambooRun(MENU_X + sx * 1.145, 2.79, -1.47, MENU_X + sx * 1.145, 4.59, -1.47, 0.045));
      for (const y of [2.87, 4.51]) round.push(lashing(MENU_X + sx * 1.145, y, -1.47, 0, 1, 0, 0.045));
    }
    const menu = brushWord(geometry(), MENU[0], MENU_X, 4.29, 0.19, 0.032, EARTH_OCHRE, 0.35, -1.487), mz = -1.487;
    MENU.slice(1).forEach((s, k) => {
      const y = 4.21 - (k + 1) * 0.24, ix = MENU_X - 0.86;
      brushWord(menu, s, MENU_X + 0.14, y, 0.13, 0.022, EARTH_CHALK, 0.3, mz);
      if (k === 0) MARK.banana(menu, ix, y + 0.02, 0.22, 0.2, EARTH_OCHRE, 0.3, mz);
      else if (k === 1) MARK.coconut(menu, ix, y, 0.3, "#a8773f", 0.25, mz);
      else if (k === 2) {
        daubStroke(menu, [[ix - 0.12, y - 0.06], [ix + 0.12, y + 0.02]], 0.018, TIMBER_LT, 0.2, mz);
        for (let j = 0; j < 5; j++) { const a = 2.7 - j * 0.55; daubDot(menu, ix + Math.cos(a) * 0.075, y - 0.02 + Math.sin(a) * 0.05, 0.03 - j * 0.003, 0.03 - j * 0.003, j ? "#e8d8b0" : "#c89a5a", 0.3, 0, mz + 0.004, 8); }
      } else {
        MARK.flame(menu, ix, y - 0.085, 0.18, EARTH_RED, 0.35, mz);
        MARK.flame(menu, ix, y - 0.075, 0.1, EARTH_OCHRE, 0.35, mz + 0.004);
      }
    });
    parts.push(menu);
    // The oven on its hearth slab: a dome of mottled stones with a stub of a flue, its mouth a dark stone arch round
    // the fire's glow with embers on its floor and flames licking out, and firewood stacked by it.
    const ov = { x: -1.3, y: 1.21, z: -0.05 }, mix = mulberry32(81), stones = ["#7a6e62", "#6b5f54", "#877a6c", "#5e534a"].map(hexToRgb), fire = [], flames = [];
    parts.push(bevelBox({ w: 0.9, h: 0.06, d: 0.66, color: "#5d5650", bevel: 0.02, offset: { x: ov.x, y: ov.y - 0.03, z: ov.z } }));
    const dome = turn([[0.34, 0], [0.345, 0.08], [0.32, 0.2], [0.26, 0.31], [0.17, 0.39], [0.08, 0.43], [0.08, 0.49], [0.05, 0.49], [0, 0.45]], 14, "#000000");
    dome.faces.forEach((f) => { f.color = stones[Math.floor(mix() * 4)]; });
    round.push(moved(dome, ov.x, ov.y, ov.z));
    const ARCH = [[-0.14, 0], [0.14, 0], [0.14, 0.12], [0.1, 0.19], [0, 0.22], [-0.1, 0.19], [-0.14, 0.12]];
    parts.push(moved(prism(ARCH, 0.07, "#1a100a"), ov.x, ov.y, ov.z + 0.305));
    fire.push(moved(prism(ARCH.map(([x, y]) => [x * 0.72, y * 0.72]), 0.01, "#ff7a1e", 0.9), ov.x, ov.y + 0.005, ov.z + 0.343));
    for (let k = 0; k < 6; k++) fire.push(glowing(moved(ball(0.022 + mix() * 0.012, k % 2 ? "#ffb347" : "#ff5a1e", 6), ov.x + (k - 2.5) * 0.04, ov.y + 0.02, ov.z + 0.35 + (k % 3) * 0.012), 1));
    for (let k = 0; k < 3; k++) flames.push(moved(turnedX(turn([[0, 0], [0.05 - k % 2 * 0.012, 0.04], [0.04 - k % 2 * 0.01, 0.1], [0, 0.2 - k % 2 * 0.05]], 8, k % 2 ? "#ffd27a" : "#ff9a2e", 1), 0.35), ov.x + (k - 1) * 0.06, ov.y + 0.03, ov.z + 0.36));
    for (const [x, y, z] of [[-0.66, 1.19, -0.12], [-0.66, 1.19, -0.02], [-0.66, 1.26, -0.07]]) round.push(log(x - 0.16, y, z, x + 0.16, y, z, 0.04));
    // The keg: a hollow log on its side on two stone chocks, bound with rope, three bamboo spouts out of its front.
    round.push(log(0.12, 1.39, -0.18, 0.68, 1.39, -0.18, 0.22, "#5a3a22"), lashing(0.2, 1.39, -0.18, 1, 0, 0, 0.22), lashing(0.6, 1.39, -0.18, 1, 0, 0, 0.22));
    for (const x of [0.2, 0.6]) parts.push(bevelBox({ w: 0.1, h: 0.08, d: 0.3, color: "#6b625a", bevel: 0.02, offset: { x, y: 1.19, z: -0.18 } }));
    for (const x of [0.28, 0.4, 0.52]) round.push(bamboo(x, 1.3, 0.01, x, 1.3, 0.12, 0.016, "#cdb06a"));
    const banana = BL.models.bananaGeometry();
    for (let k = 0; k < 5; k++) parts.push(moved(turnedY(turnedZ(scaled(banana, 0.7), 0.3 + k * 0.12), k * 0.35), -0.35 + k * 0.03, 1.2, 0.1 + (k % 2) * 0.05));
    [[0.95, 0.25], [1.32, 0.32], [1.75, 0.2]].forEach(([x, z], k) => {
      round.push(moved(nut("young", 0.075), x, 1.225, z));
      parts.push(moved(turnedZ(box({ w: 0.014, h: 0.22, d: 0.014, color: k % 2 ? "#cdb06a" : "#b8a04a" }), 0.3 - k * 0.25), x + 0.02, 1.37, z));
    });
    // A gourd hung on a cord by each pole.
    for (const sx of [-1, 1]) round.push(moved(turn([[0, 0], [0.08, 0.05], [0.095, 0.12], [0.07, 0.19], [0.035, 0.23], [0.045, 0.28], [0.02, 0.33], [0, 0.34]], 10, sx < 0 ? "#b8a040" : "#c8a84a"), sx * 1.85, 1.6, 0.64));
    // The carved sign the scene hangs over the menu (`SIGN`), hung the Oogas' way: rope bound over its plates, a bone
    // peg driven into the rock over each binding, and a liana down from each peg to its binding (grown below).
    const SIGN = { x: 1.1, y: 5, z: -1.5, w: 1.8 }, sign = BL.hubModels.caveSign("Snacks", "banana"), sb = BL.scene.boundsOf(sign), sk = SIGN.w / (sb.max[0] - sb.min[0]);
    parts.push(...signBinding("Snacks", "banana", SIGN.w, SIGN.x, SIGN.y, SIGN.z));
    const hangs = [-1, 1].map((sx) => [SIGN.x + sx * (sign.signWidth / 2 - 0.17) * sk, SIGN.y + (sign.signHeight / 2 + 0.03) * sk, SIGN.z + (sb.max[2] + sb.min[2]) / 2 * sk]);
    for (const [x] of hangs) round.push(moved(turnedX(turn([[0, 0], [0.026, 0], [0.034, 0.02], [0.022, 0.045], [0.022, 0.37], [0.034, 0.395], [0.026, 0.42], [0, 0.42]], 8, BONE), Math.PI / 2), x, SIGN.y + 0.85, SIGN.z - 0.45));
    // A liana winds up each pole, leaves hanging in from its top and big ones rising at its foot; the fronds lie over
    // the mat from the roof's middle (low enough to keep the menu's rows in sight) and reach out over its eave, their
    // tips above a walker's head.
    const body = withJungle(shaded(round, parts), (g) => {
      [[-1.8, 0.25, -0.5], [-1.1, -0.15, -0.62], [-0.4, 0.2, -0.45], [0.3, -0.2, -0.6], [1, 0.15, -0.48], [1.7, -0.25, -0.58]].forEach(([x, lean, z], k) =>
        bananaLeaf(g, x, roofY(z) + 0.06, z, { yaw: Math.PI + lean, up: 0.05, down: -0.3, len: 1.6 + (k % 3) * 0.1, broad: 0.46, tone: BANANA_LEAF_TONES[k % 3], tear: k % 2 ? 3 : -4 }));
      // Shorter ones lie flat over the back of the roof, their ribs under the menu's lowest row, and dry fronds lap the
      // gaps between the long ones from the roof's middle.
      [[-1.7, 0.1], [-0.8, -0.1], [0.6, 0.12], [1.6, -0.12]].forEach(([x, lean], k) =>
        bananaLeaf(g, x, roofY(-1.35) + 0.05, -1.35, { yaw: Math.PI + lean, up: 0, down: -0.28, len: 1.15, broad: 0.36, tone: BANANA_LEAF_TONES[(k + 1) % 3], tear: k % 2 ? -3 : 4 }));
      [-1.45, -0.75, -0.05, 0.65, 1.35].forEach((x, k) =>
        bananaLeaf(g, x, roofY(-1) + 0.06, -1, { yaw: Math.PI + (k - 2) * 0.1, up: 0.02, down: -0.38, len: 1.5, broad: 0.46, tone: PALM_DRY[k % 2], tear: k % 2 ? 4 : -3 }));
      for (const sx of [-1, 1]) {
        const pts = [];
        for (let k = 0; k <= 16; k++) { const a = k * 0.9 + sx; pts.push([sx * 2.14 + Math.cos(a) * 0.08, 0.12 + k * 0.115, 0.64 + Math.sin(a) * 0.08]); }
        liana(g, pts, 0.028, 0.02);
        liana(g, [[sx * 1.85, 1.93, 0.64], [sx * 1.85, 2.06, 0.64]], 0.008, 0.008, "#c9a36a");
        sprig(g, sx * 2.08, 2, 0.7, -sx, -0.5, 0.35, 3, 0.3, leaf);
        sprig(g, sx * 2.1, 0.05, 0.75, -sx * 0.4, 1, 0.5, 3, 0.4, leaf);
      }
      for (const [x, y, z] of hangs) {
        liana(g, [[x, SIGN.y + 0.85, SIGN.z - 0.05], [x + 0.012, (SIGN.y + 0.85 + y) / 2, (SIGN.z - 0.05 + z) / 2 + 0.03], [x, y, z]], 0.02, 0.016);
        sprig(g, x, SIGN.y + 0.87, SIGN.z - 0.08, 0.2, 0.4, 1, 3, 0.18, leaf);
      }
    });
    return { body, lit: unshadowed(merge(...fire)), glass: glassy(merge(...flames), 0.45) };
  });

  // ---- the room's pieces ----------------------------------------------------------------------------------
  // What crowns a machine's header board, where a ring of bulbs was, for a board `w` - 0.1 by `h` - 0.1 facing +z in
  // front of it: a dry bamboo pole laid along the board's top, lashed near each end, a small bone tied on its middle,
  // and from each lashing a vine drooping over the rim to its corner (`tie`), where two feathers hang down the side of
  // the rim, splayed a little, each corner its own pair. Nothing crosses the board's face, and nothing glows.
  const bulbCache = new Map();
  const bulbFrame = (w, h) => {
    const key = `${w}|${h}`;
    let geo = bulbCache.get(key);
    if (geo) return geo;
    const J = BL.hubModels, r = 0.024, y = h / 2 - 0.05 + r, z = -0.03, X = w / 2 - 0.13, tie = [w / 2 - 0.11, h / 2 - 0.1, 0.036], rand = mulberry32(Math.round(w * 1000 + h * 7));
    const round = [J.bamboo(-X - 0.05, y, z, X + 0.05, y, z, r, "#cdb06a"), moved(boneBar(0.18, 0.013), 0, y + r + 0.006, z + 0.01)];
    for (const s of [-1, 1]) round.push(J.lashing(s * X, y, z, 1, 0, 0, r));
    geo = unshadowed(J.withJungle(shaded(round), (g) => {
      for (const s of [-1, 1]) {
        J.liana(g, [[s * X, y, z + r], [s * (X + 0.006), y - 0.012, z + r + 0.02], [s * (tie[0] - 0.004), tie[1] + 0.03, tie[2] - 0.004], [s * tie[0], tie[1] + 0.004, tie[2]]], 0.009, 0.006);
        for (let k = 0; k < 2; k++) leafBlade(g, s * tie[0] + (k - 0.5) * 0.012, tie[1], tie[2] + 0.002 + k * 0.003, (k - 0.5) * 0.3 + (rand() - 0.5) * 0.12, -1, 0.04, 0, 0, 1, 0.12 + rand() * 0.04, 0.45, FEATHERS[(k + (s > 0 ? 2 : 1)) % 3]);
      }
    }));
    bulbCache.set(key, geo);
    return geo;
  };
  // A zone's name brushed in chalk on a board of two carved planks between bark ends, a bone brushed either side of it
  // and a handprint in the zone's colour at each end, a log laid across its top and a leafy liana slung from the log's
  // ends, facing +z. A name too long for the bay between two trunks is brushed smaller, so no board runs past `ZONE_W`.
  const zoneCache = new Map(), ZONE_W = 3.2;
  const zoneSign = (text, color) => {
    const key = `${text}|${color}`;
    let out = zoneCache.get(key);
    if (out) return out;
    const k = Math.min(1, (ZONE_W - 0.66) / brushWidth(text, 0.3));
    const w = brushWidth(text, 0.3 * k) + 0.66, h = GLYPH_H * 0.05 + 0.3, J = BL.hubModels, rand = mulberry32(text.length * 71 + 5), hand = earth(color);
    const paint = brushWord(geometry(), text, 0, 0, 0.3 * k, 0.05 * k, EARTH_CHALK, 0.35, 0.045);
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - 0.21);
      daubStroke(paint, [[x - 0.05, 0], [x + 0.05, 0]], 0.03, EARTH_CHALK, 0.3, 0.045);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) daubDot(paint, x + sx * 0.055, sy * 0.018, 0.02, 0.02, EARTH_CHALK, 0.3, 0, 0.045, 8);
    }
    const flat = [
      ...[-1, 1].map((s) => bevelBox({ w, h: h / 2 - 0.01, d: 0.08, color: s < 0 ? "#7a4e2c" : TIMBER, bevel: 0.03, offset: { y: s * h / 4 } })),
      ...[-1, 1].map((s) => bevelBox({ w: 0.08, h: h + 0.05, d: 0.11, color: BARK, bevel: 0.025, offset: { x: s * (w / 2 + 0.03) } })),
      paint,
      ...[-1, 1].map((s) => moved(pictograph(s < 0 ? PICTOS.hand : mirror(PICTOS.hand), 0.1, [hand, hand, hand], 0.3), s * (w / 2 - 0.1), -0.02, 0.041))
    ];
    out = J.withJungle(shaded([J.log(-w / 2 - 0.1, h / 2 + 0.05, 0.01, w / 2 + 0.1, h / 2 + 0.05, 0.01, 0.055)], flat), (g) => {
      J.garland(g, J.sagPoints(-w / 2 - 0.02, h / 2 + 0.05, 0.07, w / 2 + 0.02, h / 2 + 0.05, 0.07, 0.1, 6), { r: 0.025, every: 0.3, size: 0.18, droop: 0.15, out: [0, 0.55, 0.85], rand });
    });
    zoneCache.set(key, out);
    return out;
  };
  // A poster frame for a game's art, the Oogas' way: a dark leather hide stretched inside four bamboo poles crossed
  // and lashed at the corners, laced to them with rope, a small bone tied along the top pole and a leaf sprig at each
  // corner. The hide is `POSTER_SCALE` times a cabinet screen; the scene hangs the game's `posterArt` on it.
  const POSTER_SCALE = 1.8;
  const posterFrame = cached(() => {
    const w = SCREEN.w * POSTER_SCALE, h = SCREEN.h * POSTER_SCALE, J = BL.hubModels, X = w / 2 + 0.1, Y = h / 2 + 0.1, r = 0.04, round = [], rand = mulberry32(4411);
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const y of [-Y, Y]) round.push(bambooRun(-X - 0.06, y, 0, X + 0.06, y, 0, r));
    for (const x of [-X, X]) round.push(bambooRun(x, -Y - 0.08, -0.05, x, Y + 0.08, -0.05, r));
    for (const [sx, sy] of corners) round.push(J.lashing(sx * X, sy * Y, 0, 1, 0, 0, r));
    round.push(moved(boneBar(0.3, 0.022), 0, Y, r + 0.02));
    const hide = bevelBox({ w: w + 0.06, h: h + 0.06, d: 0.024, color: "#6e4c2e", bevel: 0.01, offset: { z: -0.02 } });
    return J.withJungle(shaded(round, [hide]), (g) => {
      for (const [sx, sy] of corners) J.sprig(g, sx * (X + 0.04), sy * (Y + 0.04), 0.03, sx, sy, 0.5, 3, 0.18, rand);
      // The lacing: five ties a side from the hide's edge round the pole.
      for (let k = 1; k < 6; k++) for (const s of [-1, 1]) {
        J.liana(g, [[-X + k * X / 3, s * (h / 2 + 0.02), -0.012], [-X + k * X / 3, s * Y, 0.03]], 0.008, 0.008, ROPE);
        J.liana(g, [[s * (w / 2 + 0.02), -Y + k * Y / 3, -0.012], [s * X, -Y + k * Y / 3, -0.01]], 0.008, 0.008, ROPE);
      }
    });
  });
  // A game's poster as the Oogas paint it on the frame's hide, by the game's index in GAMES: its name brushed in chalk
  // over a red zigzag between two red handprints, and under it the game as a pictograph in ochre, red earth and bone (the
  // kart racing on its dust, the diver under the chute among clouds, the rocket past a moon and stars, the pick over
  // its nuggets), paint that catches the light rather than a screen that gives it. Flat faces facing +z round the
  // hide's middle; the scene lays it a hair over the hide.
  const posterArt = variants((i) => {
    const game = GAMES[i], g = geometry(), e = 0.2, z = 0.012;
    daubZigzag(g, -0.5, 0.5, 0.235, 0.022, 9, 0.02, EARTH_RED, e);
    for (const s of [-1, 1]) daubHand(g, s * 0.63, 0.3, 0.2, -s * 0.25, EARTH_RED, e);
    const paint = {
      race: () => {
        MARK.kart(g, 0.12, -0.44, 0.62, EARTH_OCHRE, e, z);
        daubStroke(g, [[-0.66, -0.47], [0.64, -0.47]], 0.025, EARTH_BLACK, 0, 0);
        for (const [x, y, r] of [[-0.58, -0.36, 0.035], [-0.66, -0.26, 0.026], [-0.5, -0.24, 0.02]]) daubDot(g, x, y, r, r * 0.8, EARTH_CHALK, e, 0, z, 8);
      },
      drop: () => {
        for (const [x, y, s] of [[-0.5, -0.05, 1], [0.52, -0.3, 0.8], [-0.42, -0.42, 0.6]]) {
          daubDot(g, x, y, 0.13 * s, 0.045 * s, EARTH_CHALK, e, 0, 0, 10);
          daubDot(g, x + 0.05 * s, y + 0.03 * s, 0.07 * s, 0.045 * s, EARTH_CHALK, e, 0, 0.002, 8);
        }
        MARK.chute(g, 0, -0.52, 0.7, EARTH_OCHRE, e, z);
      },
      orbit: () => {
        MARK.rocket(g, 0.06, -0.48, 0.68, EARTH_OCHRE, e, z);
        daubDot(g, -0.48, -0.02, 0.12, 0.12, EARTH_CHALK, e, 0, 0, 14);
        daubDot(g, -0.43, 0.01, 0.1, 0.1, "#6e4c2e", 0, 0, 0.002, 14);
        for (const [x, y] of [[0.5, 0.05], [0.62, -0.25], [-0.6, -0.4], [0.4, -0.45], [-0.3, 0.12]]) daubDot(g, x, y, 0.022, 0.022, EARTH_CHALK, e, 0.3, 0, 5);
      },
      mine: () => {
        daubPoly(g, [[-0.66, -0.55], [0.66, -0.55], [0.52, -0.38], [0.2, -0.3], [-0.24, -0.33], [-0.56, -0.42]], EARTH_BLACK, 0, 0);
        MARK.pick(g, -0.08, -0.4, 0.66, EARTH_RED, e, z);
        for (const [x, y, r] of [[0.42, -0.44, 0.04], [0.14, -0.43, 0.03], [-0.36, -0.45, 0.035]]) daubDot(g, x, y, r, r * 0.85, EARTH_OCHRE, e, 0, z, 7);
      }
    };
    paint[game.id]();
    return unshadowed(brushWord(g, game.title, 0, 0.4, 0.19, 0.032, EARTH_CHALK, e, z));
  });
  // A food court table: a round slab sawn from a big log, bark round its edge and rings on its top, on a bark stump,
  // three log-stump stools round it (their tops at the sitters' 0.6 m) and a fern at the stump's foot.
  const table = cached(() => {
    const { withJungle, sprig, log } = BL.hubModels, leaf = mulberry32(61);
    const round = [log(0, 0, 0, 0, 0.72, 0, 0.24), turn([[0, 0.72], [0.54, 0.72], [0.575, 0.745], [0.575, 0.8], [0.55, 0.822]], 20, "#5a3a22")];
    for (let k = 0; k < 3; k++) round.push(lathe({ profile: [[0.55 - k * 0.18, 0.822], [k < 2 ? 0.37 - k * 0.18 : 0, 0.822]], segments: 20, color: k % 2 ? "#d8b070" : "#c89a5a" }));
    for (const a of [0, 2.1, 4.2]) round.push(log(Math.sin(a) * 0.85, 0, Math.cos(a) * 0.85, Math.sin(a) * 0.85, 0.6, Math.cos(a) * 0.85, 0.19));
    return withJungle(shaded(round), (g) => sprig(g, 0.2, 0.03, 0.16, 1, 0.7, 0.6, 4, 0.3, leaf));
  });
  // A planter: a hollowed log stump, pale at its rim, with dark soil in it and two coconuts fallen at its foot, for
  // the scene to plant a cartoon bush or a palm in.
  const planterPot = cached(() => shaded([
    turn([[0.44, 0], [0.47, 0.04], [0.48, 0.32], [0.46, 0.6], [0.44, 0.64]], 16, "#5a3a22"),
    lathe({ profile: [[0.44, 0.64], [0.36, 0.64], [0.35, 0.6]], segments: 16, color: "#c89a5a" }), lathe({ profile: [[0.35, 0.6], [0, 0.6]], segments: 16, color: "#2a1c12" }),
    moved(nut("husk", 0.1), 0.4, 0.1, 0.4), moved(turnedY(nut("husk", 0.085), 2), -0.41, 0.085, 0.38)
  ]));
  // ---- the prize counter ----------------------------------------------------------------------------------
  // What the tickets buy, cheapest first; `game.js` keeps the same ids. Each prize is a small cartoon model.
  const PRIZES = [
    { id: "banana-plush", name: "Banana plush", cost: 30 }, { id: "coconut-cup", name: "Coconut cup", cost: 60 },
    { id: "bone-kazoo", name: "Bone kazoo", cost: 100 }, { id: "gold-sticker", name: "Shell charm", cost: 150 },
    { id: "gorilla-plush", name: "Gorilla idol", cost: 250 }, { id: "crown", name: "Feather crown", cost: 500 }
  ];
  const prize = variants((i) => {
    const id = PRIZES[i].id;
    if (id === "banana-plush") return turnedZ(scaled(BL.models.bananaGeometry(), 0.7), 0.4);
    if (id === "coconut-cup") return merge(coconut(0), moved(turnedZ(box({ w: 0.02, h: 0.26, d: 0.02, color: "#cdb06a" }), 0.3), 0.04, 0.32, 0));
    if (id === "bone-kazoo") return merge(turnedZ(lathe({ profile: [[0, -0.16], [0.03, -0.15], [0.03, 0.15], [0, 0.16]], segments: 8, color: BONE }), Math.PI / 2),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => moved(ball(0.035, BONE, 8), sx * 0.16, 0.02, sz * 0.03))));
    if (id === "gold-sticker") {
      // The shell charm: a pale disc of shell with a rolled rim, standing on its edge, a sun spiral daubed on its
      // face in ochre, on a cord looped through a bone bead at its top.
      const shell = turnedX(lathe({ profile: [[0, -0.018], [0.09, -0.014], [0.118, -0.006], [0.122, 0.004], [0.108, 0.014], [0.07, 0.019], [0, 0.021]], segments: 16, color: "#000000" }), Math.PI / 2);
      shell.faces.forEach((f, k) => { const band = Math.floor(k / 16); f.color = SHELL_BANDS[band === 2 || band === 3 ? 1 : 0]; });
      return shaded([moved(shell, 0, 0.122, 0), moved(turnedX(torus(0.034, 0.006, ROPE, 0, 12, 4), Math.PI / 2), 0, 0.27, 0), moved(ball(0.016, BONE, 6), 0, 0.244, 0)],
        [moved(daubSpiral(geometry(), 0, 0, 0.052, 0.013, EARTH_OCHRE, 0.25, 0.023), 0, 0.122, 0)]);
    }
    if (id === "gorilla-plush") {
      // The gorilla idol, carved in near-black wood gouged down the grain on every other face, knuckle-walking on a
      // stump slice (its foot at y -0.14, where `clawPrize` lifts it from): a hunched pear of a body, its shoulders
      // wider than its hips, long arms down to its knuckles on the base either side and short legs under its
      // haunches; its head pushed forward and low under a heavy brow and a crest, a paler muzzle, two golden eyes
      // glinting, and a necklace of three teeth on a rope under its chin.
      const wood = hexToRgb(MAMMOTH_FUR[0]), gouge = hexToRgb("#2a1c12");
      const carved = (geo) => { geo.faces.forEach((f, k) => { f.color = k % 2 ? gouge : wood; }); return geo; };
      const blob = (rx, ry, rz, segments, color = "#000000") => { const g = ball(1, color, segments), v = g.verts; for (let k = 0; k < v.length; k += 3) { v[k] *= rx; v[k + 1] *= ry; v[k + 2] *= rz; } return g; };
      const limb = (a, b, r0, r1) => {
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d);
        return along(carved(turn([[0, 0], [r0 * 0.8, len * 0.06], [r0, len * 0.2], [r1, len * 0.85], [r1 * 0.7, len], [0, len]], 6, "#000000")), ...a, ...d);
      };
      const body = turn([[0, 0], [0.055, 0.012], [0.085, 0.05], [0.1, 0.1], [0.122, 0.15], [0.14, 0.19], [0.132, 0.225], [0.1, 0.255], [0, 0.27]], 10, "#000000");
      for (let k = 0; k < body.verts.length; k += 3) { body.verts[k] *= 1.07; body.verts[k + 2] *= 0.78; }
      const round = [
        turn([[0.165, -0.14], [0.17, -0.12], [0.166, -0.1], [0.158, -0.095]], 10, TIMBER_DK), lathe({ profile: [[0.158, -0.095], [0, -0.095]], segments: 10, color: "#c89a5a" }),
        along(carved(body), 0, -0.005, -0.125, 0, Math.sin(0.6), Math.cos(0.6)),
        moved(carved(blob(0.066, 0.07, 0.068, 10)), 0, 0.1, 0.145), moved(blob(0.048, 0.034, 0.042, 8, "#8a6440"), 0, 0.068, 0.188),
        moved(turnedX(torus(0.075, 0.008, ROPE, 0, 10, 4), 1.2), 0, 0.085, 0.1)
      ];
      for (const sx of [-1, 1]) {
        round.push(limb([sx * 0.065, 0.01, -0.075], [sx * 0.08, -0.1, -0.055], 0.045, 0.04));
        round.push(limb([sx * 0.12, 0.118, 0.035], [sx * 0.148, 0.02, 0.072], 0.042, 0.036), limb([sx * 0.148, 0.02, 0.072], [sx * 0.112, -0.064, 0.09], 0.036, 0.034));
        round.push(moved(carved(ball(0.037, "#000000", 6)), sx * 0.148, 0.02, 0.072), moved(carved(blob(0.036, 0.03, 0.04, 6)), sx * 0.112, -0.066, 0.094));
        round.push(moved(glowing(ball(0.014, "#ffc83a", 6), 0.45), sx * 0.026, 0.108, 0.2));
      }
      for (const [x, y, z, len] of [[-0.033, 0.018, 0.124, 0.042], [0, 0.011, 0.127, 0.05], [0.033, 0.018, 0.124, 0.042]]) round.push(moved(charmTooth(len, 0.011), x, y, z));
      return shaded(round, [
        bevelBox({ w: 0.11, h: 0.028, d: 0.05, color: MAMMOTH_FUR[0], bevel: 0.01, offset: { y: 0.13, z: 0.198 } }),
        sideShape(ccw([[0.085, 0.13], [0.175, 0.14], [0.15, 0.19], [0.105, 0.212]]), 0, 0.022, MAMMOTH_FUR[0])
      ]);
    }
    // The feather crown, a chief's headdress worn on a display head so it reads across the hall: a peeled coconut for
    // the head, pale against the dark wall, its three eyes turned to the front for a face, on a short log neck on a
    // stump slice; round its brow at `Y` a band of hide arcs with an ochre zigzag daubed round it, a ring of teeth
    // standing up along its top, long and short in turn, and a golden coconut boss on its front; and from a knot at its
    // back a fan of seven long feathers splayed in a half circle and tilted back, red, bone-white tipped in charcoal and
    // ochre in turn, the middle one longest.
    const R = 0.13, N = 10, Y = 0.255, round = [], flat = [];
    round.push(turn([[0.13, 0], [0.135, 0.02], [0.13, 0.04], [0.124, 0.045]], 14, TIMBER_DK), lathe({ profile: [[0.124, 0.045], [0, 0.045]], segments: 14, color: "#c89a5a" }));
    round.push(BL.hubModels.log(0, 0.04, 0, 0, 0.12, 0, 0.045, "#6b4a2b"), moved(turnedX(nut("cue", 0.125), 1), 0, 0.225, 0));
    for (let k = 0; k < N; k++) {
      const a = (k + 0.5) / N * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
      flat.push(moved(turnedY(bevelBox({ w: R * Math.PI * 2 / N + 0.012, h: 0.075, d: 0.026, color: WEAR_HIDE, bevel: 0.009 }), a), s * R, Y + 0.0375, c * R));
      flat.push(moved(turnedY(prism(ccw(k % 2 ? [[-0.032, 0.02], [0.032, 0.02], [0, -0.02]] : [[-0.032, -0.02], [0.032, -0.02], [0, 0.02]]), 0.004, WEAR_OCHRE), a), s * (R + 0.014), Y + 0.0375, c * (R + 0.014)));
      round.push(moved(turnedY(turnedX(turnedZ(charmTooth(k % 2 ? 0.05 : 0.07, 0.019), Math.PI), 0.25), a), s * R, Y + 0.07, c * R));
    }
    round.push(moved(ball(0.03, WEAR_DARK, 8), 0, Y + 0.05, -R - 0.03));
    round.push(moved(turnedX(glowing(lathe({ profile: [[0.034, 0], [0.03, 0.008], [0.016, 0.013], [0, 0.015]], segments: 12, color: "#ffc83a" }), 0.4), Math.PI / 2), 0, Y + 0.0375, R + 0.012));
    const back = 0.35, up = [0, Math.sin(back), Math.cos(back)];
    return BL.hubModels.withJungle(shaded(round, flat), (g) => {
      for (let k = 0; k < 7; k++) {
        const a = (k - 3) * 0.36, len = 0.36 - Math.abs(k - 3) * 0.03, tone = k % 3, d = [Math.sin(a), Math.cos(a) * Math.cos(back), -Math.cos(a) * Math.sin(back)], at = [d[0] * 0.02, Y + 0.05, -R - 0.03];
        leafBlade(g, ...at, ...d, ...up, len, 0.36, FEATHER_TONES[tone]);
        if (tone === 1) leafBlade(g, ...at.map((p, j) => p + d[j] * len * 0.62), ...d, ...up, len * 0.4, 0.5, FEATHER_TONES[3]);
      }
    });
  });
  // The counter in its frame, customers on +z, a trader's hut: a bevelled timber counter faced with a tiger hide
  // between two bamboo canes under a bark log along its top's front; the prizes on the counter and on a woven reed
  // mat shelf over it on four rough poles, the front two running up to a log lintel; a back wall of rough logs stood
  // side by side with two plank shelves of plush, each prize seated on its shelf; and a leopard hide stretched for an
  // awning from the wall's top down to the lintel, its fur up toward the hall, clear over the tickets board. A gourd
  // lantern hangs from each end of the lintel, the fire in it glowing through its skin and a ring of carved holes, and
  // a liana climbs the wall's end.
  const prizeCounter = cached(() => {
    const { withJungle, liana, sprig, bamboo, lashing, log } = BL.hubModels, parts = [], round = [], lit = [], skin = [], w = 4.2, leaf = mulberry32(72);
    parts.push(bevelBox({ w, h: 1, d: 0.8, color: TIMBER_DK, bevel: 0.04, offset: { y: 0.5 } }), bevelBox({ w: w + 0.2, h: 0.08, d: 0.9, color: TIMBER_LT, bevel: 0.03, offset: { y: 1.04 } }));
    round.push(moved(hide(w - 0.2, 0.7, "tiger", 7101), 0, 0.52, 0.405), log(-w / 2 - 0.1, 1.04, 0.43, w / 2 + 0.1, 1.04, 0.43, 0.05, "#5a3e24"));
    for (const y of [0.14, 0.9]) round.push(bambooRun(0.08 - w / 2, y, 0.44, w / 2 - 0.08, y, 0.44, 0.06));
    for (const sx of [-1, 1]) round.push(bamboo(sx * (w / 2 + 0.02), 0, 0.43, sx * (w / 2 + 0.02), 1, 0.43, 0.07));
    // The mat shelf: reeds laid side by side and tied across near their ends.
    for (let k = 0; k < 12; k++) parts.push(bevelBox({ w: w - 0.16, h: 0.026, d: 0.05, color: k % 3 === 1 ? "#b8914a" : "#c9a45a", bevel: 0.012, offset: { y: 1.447, z: -0.275 + k * 0.05 } }));
    for (const sx of [-1, 1]) parts.push(box({ w: 0.03, h: 0.03, d: 0.62, color: "#7a5a32", offset: { x: sx * 1.85, y: 1.447 } }));
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.12);
      round.push(log(x, 1.08, -0.28, x, 1.5, -0.28, 0.035), log(x, 1.08, 0.28, x, 3.25, 0.28, 0.045), lashing(x, 1.44, 0.28, 0, 1, 0, 0.045), lashing(x, 3.2, 0.28, 0, 1, 0, 0.045));
    }
    // The back wall, its log tops uneven, and its shelves.
    for (let k = 0; k < 11; k++) { const x = -2.1 + k * 0.42; round.push(log(x, 0, -1.2, x, 3.66 + (k * 7 % 3) * 0.06, -1.2, 0.21, k % 2 ? "#5a3e24" : "#6b4a2b")); }
    for (const y of [2.2, 3.0]) parts.push(bevelBox({ w: w, h: 0.07, d: 0.4, color: TIMBER_LT, bevel: 0.02, offset: { y, z: -0.9 } }));
    // A copy of prize i with its lowest point on the shelf top at `top` (`moved` moves in place; the prizes are cached).
    const seat = (i, x, top, z) => {
      const g = merge(prize(i));
      let low = Infinity;
      for (let k = 1; k < g.verts.length; k += 3) low = Math.min(low, g.verts[k]);
      return moved(g, x, top - low, z);
    };
    // Where each prize stands, [x, top, z] out front and [x, top] on the back wall's shelves: the three cheapest on the
    // counter before the mat shelf, the crown in the mat shelf's middle between the gorilla and the shell charm; and
    // again on the back shelves, all left of the tickets board the scene hangs there (x 0.63 to 1.77), but for the
    // crown, whose feathers would reach into the logs.
    [[[-1.44, 1.09, 0.33], [-1.6, 3.035]], [[1.44, 1.09, 0.33], [-1.55, 2.235]], [[0, 1.09, 0.33], [-0.95, 3.035]], [[1.1, 1.46, 0], [-0.3, 3.035]], [[-1.1, 1.46, 0], [-0.55, 2.235]], [[0, 1.46, 0]]].forEach(([front, back], i) => {
      parts.push(seat(i, ...front));
      if (back) parts.push(seat(i, back[0], back[1], -0.9));
    });
    // The awning, its fur side up where the hall sees it, sagging a little between the wall and the lintel; and rope
    // bound over the plates of the carved sign the scene hangs over it.
    round.push(moved(turnedX(hide(w + 0.5, 1.56, "leopard", 7102, { sag: 0.08 }), -1.222), 0, 3.46, -0.44), log(-2.35, 3.2, 0.28, 2.35, 3.2, 0.28, 0.05, "#5a3e24"));
    parts.push(...signBinding("Prizes", "banana", 1.8, 0, 4.1, -1));
    // The lanterns: each gourd's skin (`glass`), the ring of holes carved round its belly and the flame inside.
    for (const sx of [-1, 1]) {
      const x = sx * 2.22, y = 2.58;
      skin.push(moved(turn([[0, 0], [0.09, 0.05], [0.11, 0.13], [0.08, 0.21], [0.04, 0.25], [0.05, 0.3], [0, 0.32]], 10, "#e8a040", 0.55), x, y, 0.28));
      for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; lit.push(along(glowing(lathe({ profile: [[0.018, 0], [0, 0.002]], segments: 5, color: "#ffd27a" }), 1), x + Math.cos(a) * 0.112, y + 0.13, 0.28 + Math.sin(a) * 0.112, Math.cos(a), 0, Math.sin(a))); }
      lit.push(moved(turn([[0, 0], [0.035, 0.03], [0.03, 0.07], [0, 0.12]], 6, "#ffb347", 1), x, y + 0.05, 0.28));
    }
    const body = withJungle(shaded(round, parts), (g) => {
      const vine = [];
      for (let k = 0; k <= 10; k++) vine.push([-2.1 + Math.sin(k * 1.3) * 0.05, 1 + k * 0.26, -0.96 + Math.cos(k * 1.3) * 0.02]);
      liana(g, vine, 0.03, 0.02);
      for (let k = 2; k < 10; k += 3) sprig(g, ...vine[k], -0.3, 0.3, 1, 2, 0.28, leaf);
      for (const sx of [-1, 1]) {
        liana(g, [[sx * 2.22, 2.9, 0.28], [sx * 2.22, 3.16, 0.28]], 0.008, 0.008, "#c9a36a");
        sprig(g, sx * 2.34, 3.22, 0.3, sx, 0.3, 0.4, 3, 0.26, leaf);
      }
    });
    return { body, glass: glassy(merge(...skin), 0.35), lit: unshadowed(merge(...lit)) };
  });
  // ---- the machines under the mezzanine --------------------------------------------------------------------
  // A claw machine in its frame facing +z, as the Oogas build one, each in its own hide: a case of dark carved timber
  // on a plinth with a zigzag of teeth carved across its front, a hide pegged over the front's left under a small
  // tiki mouth for the coin (leopard, tiger or shaggy mammoth fur), the prize chute a half coconut shell's dark mouth
  // ringed in embers between two bones, a zigzag and a handprint daubed on each side; the control shelf of dark timber with a bark log
  // along its front and the same hide over its top, its bone joystick (a coconut for a knob) and an ember button in a
  // bone ring standing on the hide; the glass case on bamboo corner posts, framed in bamboo
  // round its foot and along the tops of its sides, heaped on banana leaves over sand with coconuts (husk, young and
  // earth-painted), plush, bananas, bones, seashells and a few feathers under a bamboo gantry; and over it a carved
  // sign board, CLAW brushed in ochre on its pale timber face, a bark log along its top and a tusk curling out of each end,
  // crowned with broad leaves where a liana climbs up from the back corner. The claw hangs apart (`claw`) so the scene
  // can drive it; `CLAW` is its box inside the case.
  const CLAW = { y: 1.9, floor: 1.02, x: 0.34, z: 0.28 };
  // Each machine's hide (a `hide` kind, or "shaggy" for `shaggyFur`); the coconuts in the heaps (the husk, a young
  // one and the earth paints, none in the golden prize's yellow).
  const CLAW_PAINT = ["leopard", "tiger", "shaggy"];
  const HEAP_NUTS = ["husk", "young", EARTH_RED, "#c8763a", "#dccba6", "#4a3a30"];
  // A seashell for the heaps, a banded cone lying on its side.
  const SHELL_BANDS = ["#f2dcc2", "#d9a27a"].map(hexToRgb);
  const seashell = () => {
    const geo = lathe({ profile: [[0, 0], [0.03, 0.012], [0.05, 0.04], [0.046, 0.07], [0.03, 0.1], [0.012, 0.125], [0, 0.135]], segments: 8, color: "#000000" });
    geo.faces.forEach((f, n) => { f.color = SHELL_BANDS[Math.floor(n / 8) % 2]; });
    return turnedX(geo, 1.2);
  };
  // The crown's leaves from the marquee's top, under the mezzanine's joists: [x, z, heading (0 to the back, positive
  // toward +x), rise, length]; and the banana leaves on the case's floor: [x, z, heading, length].
  const CLAW_CROWN = [[0, -0.25, -0.7, 0.3, 0.42], [0, -0.25, 0, 0.35, 0.4], [0, -0.25, 0.7, 0.3, 0.42], [-0.4, -0.2, -1.65, 0.3, 0.4], [-0.4, -0.2, -1.1, 0.32, 0.4],
    [0.4, -0.2, 1.65, 0.3, 0.4], [0.4, -0.2, 1.1, 0.32, 0.4], [-0.45, 0.2, -2.1, 0.28, 0.34], [0.45, 0.2, 2.1, 0.28, 0.34]];
  const CLAW_BED = [[-0.05, 0.08, -1.9, 0.44], [0.08, -0.06, 1.2, 0.4]];
  // The embers every claw machine lights, the ring in its chute and its button, on its front `d` (its case's depth)
  // out: one geometry for all of them, so they draw as one.
  const clawEmbers = cached(() => {
    const d = 0.95, shine = unshadowed(merge(moved(turnedX(torus(0.086, 0.008, EMBER_GLOW, 1, 14, 4), Math.PI / 2), 0.25, 0.45, d / 2 + 0.012), moved(button(0.05, EMBER_GLOW, 1), 0.2, 1.02, d / 2 + 0.1)));
    for (const f of shine.faces) f.emissive = Math.max(f.emissive, 0.5);
    return shine;
  });
  const clawMachine = variants((i) => {
    const { withJungle, liana, pointedLeaf, bamboo, log } = BL.hubModels;
    const skin = CLAW_PAINT[i], parts = [], round = [], w = 1.1, d = 0.95;
    parts.push(bevelBox({ w, h: 0.95, d, color: TIMBER_DK, bevel: 0.04, offset: { y: 0.475 } }));
    // The plinth: a timber band round the base, a zigzag of teeth carved across its front.
    parts.push(bevelBox({ w: w + 0.08, h: 0.16, d: d + 0.02, color: TIMBER, bevel: 0.04, offset: { y: 0.08 } }));
    for (let k = 0; k < 9; k++) parts.push(moved(prism(ccw(k % 2 ? [[-0.05, 0.04], [0.05, 0.04], [0, -0.04]] : [[-0.05, -0.04], [0.05, -0.04], [0, 0.04]]), 0.012, "#2e1c0e"), (k - 4) * 0.11, 0.08, d / 2 + 0.016));
    // The hide over the front's left, a small tiki mouth carved over it for the coin; the chute, the dark mouth of a
    // half coconut shell set in the front, its pale lip round a ring of embers, between two bones; the paint on each
    // side.
    if (skin === "shaggy") parts.push(moved(shaggyFur(0.5, 0.62, 900 + i), -0.25, 0.53, d / 2 + 0.004));
    else round.push(moved(hide(0.5, 0.62, skin, 900 + i), -0.25, 0.53, d / 2 + 0.006));
    parts.push(...tikiMouth(0.075, 0.048, 0.9).map((p) => moved(p, -0.25, 0.64, d / 2 + 0.012)));
    const husk = torus(0.125, 0.03, "#6b4a26", 0, 14, 5), streak = hexToRgb("#54391d"), meat = hexToRgb(CREAM);
    husk.faces.forEach((f, k) => { if (Math.floor(k / 14) === 1) f.color = meat; else if (k % 3 === 0) f.color = streak; });
    round.push(moved(turnedX(husk, Math.PI / 2), 0.25, 0.45, d / 2 + 0.01));
    parts.push(moved(turnedX(lathe({ profile: [[0.12, 0], [0, 0.004]], segments: 14, color: "#140c08" }), Math.PI / 2), 0.25, 0.45, d / 2 + 0.002));
    for (const y of [0.28, 0.62]) round.push(moved(boneBar(0.3, 0.018), 0.25, y, d / 2 + 0.03));
    for (const sx of [-1, 1]) {
      const side = geometry();
      daubZigzag(side, -0.36, 0.36, 0.8, 0.04, 5, 0.03, EARTH_OCHRE, 0.12);
      daubHand(side, sx * 0.05, 0.22, 0.34, sx * 0.15, sx < 0 ? EARTH_RED : EARTH_CHALK, 0.12);
      parts.push(moved(turnedY(side, sx * Math.PI / 2), sx * (w / 2 + 0.003), 0, 0));
    }
    // The glass case: bamboo posts at its corners, a bamboo frame round its foot and along the tops of its sides, sand
    // on its floor and the gantry's two canes.
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) round.push(bamboo(sx * (w / 2 - 0.03), 0.95, sz * (d / 2 - 0.03), sx * (w / 2 - 0.03), 2.06, sz * (d / 2 - 0.03), 0.045));
    for (const sz of [-1, 1]) round.push(bambooRun(0.05 - w / 2, 0.995, sz * (d / 2 - 0.03), w / 2 - 0.05, 0.995, sz * (d / 2 - 0.03), 0.026, "#cdb06a"));
    for (const sx of [-1, 1]) for (const y of [0.995, 2.02]) round.push(bambooRun(sx * (w / 2 - 0.03), y, 0.05 - d / 2, sx * (w / 2 - 0.03), y, d / 2 - 0.05, 0.026, "#cdb06a"));
    parts.push(box({ w: w - 0.1, h: 0.04, d: d - 0.1, color: "#b8925a", offset: { y: 0.97 } }));
    for (const x of [-0.3, 0.3]) round.push(bambooRun(x, CLAW.y + 0.14, 0.06 - d / 2, x, CLAW.y + 0.14, d / 2 - 0.06, 0.025));
    // The control shelf: dark timber with a bark log along its front edge and the machine's hide over its top, the
    // joystick and button standing on the hide.
    const top = skin === "shaggy" ? shaggyFur(1, 0.22, 910 + i) : hide(1, 0.22, skin, 910 + i);
    (skin === "shaggy" ? parts : round).push(moved(turnedX(top, -Math.PI / 2), 0, 1.017, d / 2 + 0.08));
    round.push(log(-w / 2, 0.985, d / 2 + 0.22, w / 2, 0.985, d / 2 + 0.22, 0.036, "#4a3220"));
    round.push(moved(torus(0.06, 0.012, BONE, 0, 10, 4), 0.2, 1.02, d / 2 + 0.1), moved(nut("husk", 0.045, false, false), -0.22, 1.16, d / 2 + 0.1));
    parts.push(bevelBox({ w: w, h: 0.07, d: 0.3, color: "#654024", bevel: 0.02, offset: { y: 0.98, z: d / 2 + 0.1 } }));
    parts.push(moved(lathe({ profile: [[0.04, 0], [0.04, 0.01], [0.014, 0.018], [0.014, 0.11], [0, 0.11]], segments: 8, color: BONE }), -0.22, 1.02, d / 2 + 0.1));
    // The sign board over the case: timber, CLAW brushed on its face, a bark log along its top and a tusk curling up
    // and out of each end.
    parts.push(bevelBox({ w: w + 0.04, h: 0.3, d: d + 0.04, color: TIMBER_LT, bevel: 0.04, offset: { y: 2.2 } }));
    parts.push(brushWord(geometry(), "CLAW", 0, 2.18, 0.17, 0.034, EARTH_OCHRE, 0.3, d / 2 + 0.024));
    round.push(log(-w / 2 - 0.04, 2.37, d / 2 + 0.005, w / 2 + 0.04, 2.37, d / 2 + 0.005, 0.035, "#5a3e24"));
    for (const sx of [-1, 1]) round.push(moved(turnedY(boneTusk(0.22, 0.03, 1.4), sx * Math.PI / 2), sx * (w / 2 - 0.02), 2.36, d / 2 - 0.06));
    // The heap, seeded per machine: coconuts, plush, bananas, bones and seashells, turned every which way; feathers
    // lie at its edges (grown below).
    const rand = mulberry32(700 + i), heap = [];
    for (let k = 0; k < 26; k++) {
      const x = (rand() - 0.5) * (w - 0.3), z = (rand() - 0.5) * (d - 0.3), y = 1.02 + rand() * 0.14, pick = rand(), spin = rand() * 6.3;
      if (pick < 0.4) round.push(moved(turnedY(nut(HEAP_NUTS[Math.floor(rand() * HEAP_NUTS.length)], 0.08), spin), x, y + 0.04, z));
      else if (pick < 0.5) heap.push(moved(turnedY(scaled(prize(4), 0.7), spin), x, y, z));
      else if (pick < 0.64) heap.push(moved(turnedZ(scaled(BL.models.bananaGeometry(), 0.45), spin), x, y + 0.04, z));
      else if (pick < 0.84) round.push(moved(turnedY(turnedZ(boneBar(0.2, 0.018), (rand() - 0.5) * 0.6), spin), x, y + 0.03, z));
      else round.push(moved(turnedY(seashell(), spin), x, y + 0.03, z));
    }
    const glass = glassy(merge(...[[0, d / 2, w - 0.08, 0.01], [0, -d / 2, w - 0.08, 0.01], [w / 2, 0, 0.01, d - 0.08], [-w / 2, 0, 0.01, d - 0.08]].map(([x, z, ww, dd]) => box({ w: ww, h: 1.05, d: dd, color: "#dff4ff", offset: { x, y: 1.5, z } }))));
    // Broad leaves lying flat for the heap's bed, feathers at its edges clear of the prizes, and leaves fanned from the
    // sign's top where the liana ends.
    const leaf = (g, x, y, z, heading, rise, length, light, dark) => {
      const s = Math.sin(heading), c = Math.cos(heading), ax = s * Math.cos(rise), ay = Math.sin(rise), az = -c * Math.cos(rise);
      pointedLeaf(g, x, y, z, ax, ay, az, c, 0, s, -s * ay, s * ax - c * az, c * ay, length, light, dark);
    };
    const tones = ["#74bd52", "#4f8f36", "#56a43f", "#2f6b2c", "#8cc04a", "#5e9a34"].map(hexToRgb);
    const jungle = withJungle(shaded(round, [...parts, ...heap]), (g) => {
      for (const [x, z, heading, length] of CLAW_BED) leaf(g, x, 1, z, heading, 0.06, length, tones[4], tones[5]);
      [[-0.3, 0.36, -1.57], [0.3, -0.36, 1.57], [-0.3, -0.38, -1.57]].forEach(([x, z, heading], k) => leaf(g, x, 1.13, z, heading, 0.12, 0.2, ...FEATHERS[(k + i) % 3]));
      liana(g, [[-0.575, 0.16, -0.47], [-0.59, 0.55, -0.455], [-0.575, 0.95, -0.475], [-0.59, 1.35, -0.455], [-0.578, 1.75, -0.475], [-0.59, 2.1, -0.46], [-0.58, 2.3, -0.45], [-0.48, 2.37, -0.36], [-0.22, 2.37, -0.28], [0, 2.37, -0.25]], 0.02, 0.016);
      CLAW_CROWN.forEach(([x, z, heading, rise, length], k) => leaf(g, x, 2.37, z, heading, rise, length, tones[k % 2 * 2], tones[k % 2 * 2 + 1]));
    });
    return { body: jungle, lit: clawEmbers(), glass };
  });
  // The claw: a coconut for its hub on the trolley, eyes to the front, and three bone prongs, each hooked in at its
  // foot with a tusk tip. The cable is a `chainLink` the scene stretches.
  const claw = cached(() => shaded([moved(nut("husk", 0.07, false, false), 0, 0.04, 0), ...[0, 2.1, 4.2].map((a) => turnedY(merge(
    along(lathe({ profile: [[0, 0], [0.02, 0.008], [0.014, 0.03], [0.012, 0.09], [0.019, 0.112], [0, 0.126]], segments: 8, color: BONE }), 0, -0.005, 0.05, 0, -0.105, 0.075),
    along(lathe({ profile: [[0.014, 0], [0.012, 0.04], [0.006, 0.075], [0, 0.09]], segments: 8, color: BONE }), 0, -0.1, 0.12, 0, -0.09, -0.045)
  ), a))]));
  // The claw game's aim: a ring of eight embers on a charcoal cord, lying flat over the heap under the claw; the game
  // brightens it (`glow`) where the claw would close on a prize and turns it gold (`highlight`) where it would hold.
  const clawMark = cached(() => unshadowed(merge(torus(0.075, 0.006, "#3a2616", 0.2, 20, 4),
    glowing(merge(...Array.from({ length: 8 }, (_, k) => moved(ball(0.013, EMBER_GLOW, 6), Math.cos(k * Math.PI / 4) * 0.075, 0.003, Math.sin(k * Math.PI / 4) * 0.075))), 0.9))));
  // The claw game's machine: the middle claw machine's own geometry, which the scenes stand `dz` in front of the
  // player's spot (`CLAW.back`, -z), for the carnival scene and the hall's station alike. `CLAW.chute` is the drop
  // hole in the case's front-right corner and `CLAW.prizes` the grabbable prizes on top of the heap, [x, z, kind]
  // in the machine's frame (kind 0 a gorilla idol, 1 a banana, 2 a coconut, 3 the golden coconut, the jackpot, in the
  // back corner furthest from the chute).
  CLAW.back = 1;
  CLAW.chute = { x: 0.3, z: 0.26 };
  CLAW.prizes = [[-0.3, -0.22, 3], [-0.08, 0.02, 2], [0.14, -0.2, 1], [-0.3, 0.18, 1], [0.05, 0.24, 2], [0.28, -0.05, 0], [-0.12, -0.28, 2], [0.2, 0.1, 0]];
  CLAW.values = [30, 15, 10, 50];
  const clawBooth = variants((i) => { const c = clawMachine(i); return { body: c.body, glow: c.lit, glass: c.glass, dz: -CLAW.back }; });
  // A grabbable prize by kind, sitting on its base at y 0.
  const clawPrize = variants((k) => k === 0 ? moved(scaled(prize(4), 0.75), 0, 0.1, 0) : k === 1 ? moved(turnedZ(scaled(BL.models.bananaGeometry(), 0.5), 0.4), 0, 0.05, 0)
    : moved(nut(k === 3 ? "golden" : "husk", k === 3 ? 0.075 : 0.07), 0, 0.07, 0));
  // A pinball table in its frame, the player at +z, as the Oogas build one: a timber cabinet with a hide stretched
  // down each side (leopard on the first, tiger on the second) on four log legs, tilted up toward its backbox; bark
  // log rails down both sides bound with rope and a log lockdown bar across the front; the playfield a slab of dark
  // bark brushed in softly glowing cave paint (the title, ochre dots down the lanes barely lit, a red-earth sun round each
  // bumper, an ochre banana, a bone down each slope to the flippers, a red handprint either side) under a thin skin
  // of clear resin; three bumpers of half a coconut shell turned over, an ember glowing in each one's crown; a
  // coconut for the plunger's knob and bone knobs for the flipper buttons; and the timber backbox, its title brushed
  // in ochre and bone on a charcoal panel over a carved timber Ooga mask with the fire glowing in its eyes, a liana
  // down each front edge and two more climbing dry bamboo stakes behind the scoreboard the game hangs over it, into a
  // crown of big leaves over the board. `PIN` places a point on the playfield for the scene's ball; `flip` is a
  // flipper's reach, which the game's physics shares.
  const PIN = { w: 0.64, l: 1.26, y: 0.98, tilt: 0.12, flip: 0.08 };
  const pinAt = (u, v, out) => {
    out.x = u; out.y = PIN.y + 0.03 + v * Math.sin(PIN.tilt); out.z = -v * Math.cos(PIN.tilt);
    return out;
  };
  const pinball = variants((i) => {
    const { withJungle, liana, sprig, log, bamboo, lashing } = BL.hubModels;
    const parts = [], round = [], lit = [], L = PIN.l + 0.12, sin = Math.sin(PIN.tilt);
    const tilted = (geo) => moved(turnedX(geo, PIN.tilt), 0, PIN.y, 0), streak = hexToRgb("#4e3419"), rand = mulberry32(5100 + i);
    parts.push(tilted(bevelBox({ w: PIN.w + 0.06, h: 0.3, d: L, color: TIMBER_DK, bevel: 0.03, offset: { y: -0.12 } })));
    for (const sx of [-1, 1]) round.push(tilted(moved(turnedY(hide(L - 0.04, 0.27, i ? "tiger" : "leopard", 5160 + i * 2 + sx), sx * Math.PI / 2), sx * (PIN.w / 2 + 0.032), -0.12, 0)));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const x = sx * (PIN.w / 2 - 0.03), z = sz * (L / 2 - 0.1); round.push(log(x, 0, z, x, PIN.y - 0.24 - z * sin, z, 0.055)); }
    // Bark log rails down both sides, rope bound at their ends and middle, and the lockdown bar across their ends.
    for (const sx of [-1, 1]) {
      const x = sx * (PIN.w / 2 + 0.03);
      round.push(tilted(log(x, 0.045, L / 2 - 0.01, x, 0.045, -L / 2 + 0.01, 0.024, "#5a3e24")));
      for (const z of [L / 2 - 0.12, 0, -L / 2 + 0.12]) round.push(tilted(lashing(x, 0.045, z, 0, 0, 1, 0.024)));
    }
    round.push(tilted(log(-PIN.w / 2 - 0.07, 0.05, L / 2 - 0.02, PIN.w / 2 + 0.07, 0.05, L / 2 - 0.02, 0.026, "#5a3e24")));
    // The playfield: dark bark with its grain in long broken streaks, and the paint brushed on it, glowing softly so
    // the coconut stays the brightest thing on it; drawn with u across and v up the slope, as `pinAt` takes them.
    const field = geometry(), OCHRE = "#d9a53a", RED_EARTH = "#b8402e";
    daubPoly(field, [[-0.329, -0.63], [0.329, -0.63], [0.329, 0.63], [-0.329, 0.63]], "#3a2618", 0.07);
    for (const u0 of [-0.2, -0.04, 0.1, 0.24]) {
      for (let v = -0.62 + rand() * 0.05; v < 0.58;) {
        const end = Math.min(0.62, v + 0.08 + rand() * 0.2), pts = [];
        for (let k = 0; k <= 4; k++) { const w = v + (end - v) * k / 4; pts.push([u0 + Math.sin(w * 9 + u0 * 20) * 0.006, w]); }
        daubTaper(field, pts, (t) => 0.012 * Math.sin(Math.PI * (0.1 + 0.8 * t)), "#48301d", 0.07, 0.001);
        v = end + 0.02 + rand() * 0.06;
      }
    }
    for (let v = 0.52; v > -0.4; v -= 0.082) for (const u of [-0.26, 0.26]) daubDot(field, u, v, 0.011, 0.011, OCHRE, 0.08, 0, 0.002, 8);
    for (const [u, v] of [[-0.12, 0.28], [0.12, 0.28], [0, 0.12]]) daubSpiral(field, u, v, 0.068, 0.008, RED_EARTH, 0.3, 0.002);
    brushWord(field, i ? "OOGA" : "BONK", 0, 0.425, 0.08, 0.014, OCHRE, 0.3, 0.003);
    MARK.banana(field, 0, -0.24, 0.24, 0, "#e0a83a", 0.3, 0.002);
    daubHand(field, 0.17, -0.14, 0.17, -0.2, RED_EARTH, 0.3, 0.002);
    const leftHand = mirroredX(daubHand(geometry(), 0.17, -0.14, 0.17, -0.2, RED_EARTH, 0.3, 0.002));
    // A bone down each slope: a shaft with a pair of knuckles at each end.
    for (const [u0, v0, u1, v1] of [[-0.28, -0.41, -0.13, -0.51], [0.22, -0.41, 0.13, -0.51]]) {
      const l = Math.hypot(u1 - u0, v1 - v0), nu = (v0 - v1) / l * 0.009, nv = (u1 - u0) / l * 0.009;
      daubStroke(field, [[u0, v0], [u1, v1]], 0.012, BONE, 0.3, 0.002);
      for (const [u, v] of [[u0, v0], [u1, v1]]) for (const s of [-1, 1]) daubDot(field, u + nu * s, v + nv * s, 0.011, 0.011, BONE, 0.3, 0, 0.003, 8);
    }
    lit.push(tilted(moved(turnedX(merge(field, leftHand), -Math.PI / 2), 0, 0.031, 0)));
    // The bumpers: half a coconut shell turned over, a rim of pale meat round its foot and an ember in its crown.
    for (const [u, v] of [[-0.12, 0.28], [0.12, 0.28], [0, 0.12]]) {
      const p = pinAt(u, v, {}), shell = turn([[0.049, 0.007], [0.051, 0.014], [0.044, 0.026], [0.029, 0.033], [0, 0.036]], 12, "#6b4a26");
      shell.faces.forEach((f, k) => { if (k % 12 % 3 === 0) f.color = streak; });
      round.push(moved(shell, p.x, p.y - 0.004, p.z), moved(turn([[0.053, 0], [0.053, 0.008], [0.047, 0.009]], 12, CREAM), p.x, p.y - 0.004, p.z));
      lit.push(moved(lathe({ profile: [[0.024, 0.031], [0.018, 0.039], [0, 0.042]], segments: 12, color: ["#ff7a2a", "#ffb347", "#ff5a2a"][Math.round((u + 0.12) / 0.12) % 3], emissive: 0.95 }), p.x, p.y - 0.004, p.z));
    }
    round.push(moved(turnedX(turn([[0.011, 0], [0.011, 0.13], [0, 0.13]], 8, "#cdb06a"), Math.PI / 2), PIN.w / 2 - 0.04, PIN.y - 0.1, L / 2), moved(nut("husk", 0.03, false, false), PIN.w / 2 - 0.04, PIN.y - 0.1, L / 2 + 0.13));
    for (const sx of [-1, 1]) round.push(moved(button(0.025, BONE, 0), sx * (PIN.w / 2 + 0.06), PIN.y - 0.1, L / 2 - 0.15));
    // The backbox, bark-edged planks down its front edges.
    const back = -L / 2 * Math.cos(PIN.tilt), backY = PIN.y + L / 2 * sin, top = backY + 0.725;
    parts.push(bevelBox({ w: PIN.w + 0.12, h: 0.75, d: 0.16, color: TIMBER_DK, bevel: 0.03, offset: { y: backY + 0.35, z: back } }));
    for (const sx of [-1, 1]) parts.push(bevelBox({ w: 0.09, h: 0.74, d: 0.03, color: i ? TIMBER_LT : TIMBER, bevel: 0.012, offset: { x: sx * 0.335, y: backY + 0.35, z: back + 0.085 } }));
    // Its face: the title brushed on a charcoal panel between rows of dots, and under it the mask, an oval of pale
    // timber with a heavy brow, dark sockets with an ember in each, a nose and a grin of bone teeth.
    const panel = geometry(), fy = backY + 0.37, fz = back + 0.085, my = fy - 0.115;
    daubPoly(panel, [[-0.28, -0.22], [0.28, -0.22], [0.28, 0.22], [-0.28, 0.22]], "#1e1612", 0.1);
    brushWord(panel, i ? "OOGA" : "BONK", 0, 0.165, 0.065, 0.012, "#e0a83a", 0.3, 0.004);
    brushWord(panel, "BALL", 0, 0.065, 0.095, 0.017, BONE, 0.3, 0.004);
    for (let k = 0; k < 4; k++) for (const sx of [-1, 1]) daubDot(panel, sx * (0.25 - k * 0.04), -0.1 - (k % 2) * 0.02, 0.009, 0.009, "#e0a83a", 0.08, 0, 0.004, 8);
    lit.push(moved(panel, 0, fy, fz));
    const mask = turnedX(lathe({ profile: [[0, 0], [0.07, 0], [0.078, 0.012], [0.07, 0.024], [0, 0.03]], segments: 12, color: TIMBER_LT }), Math.PI / 2);
    for (let k = 1; k < mask.verts.length; k += 3) mask.verts[k] *= 1.25;
    round.push(moved(mask, 0, my, fz));
    parts.push(bevelBox({ w: 0.15, h: 0.03, d: 0.03, color: TIMBER_DK, bevel: 0.01, offset: { y: my + 0.035, z: fz + 0.03 } }));
    parts.push(moved(prism(ccw([[-0.016, -0.02], [0.016, -0.02], [0, 0.018]]), 0.02, TIMBER_DK), 0, my - 0.02, fz + 0.03));
    parts.push(box({ w: 0.09, h: 0.024, d: 0.01, color: "#1a120c", offset: { y: my - 0.058, z: fz + 0.026 } }));
    for (let k = 0; k < 5; k++) parts.push(box({ w: 0.012, h: 0.014, d: 0.01, color: BONE, offset: { x: (k - 2) * 0.017, y: my - 0.052 + (k % 2) * 0.004, z: fz + 0.03 } }));
    for (const sx of [-1, 1]) {
      parts.push(moved(turnedX(lathe({ profile: [[0.021, 0], [0.018, 0.006], [0, 0.008]], segments: 8, color: "#1a120c" }), Math.PI / 2), sx * 0.033, my + 0.008, fz + 0.026));
      lit.push(moved(turnedX(lathe({ profile: [[0.011, 0], [0, 0.004]], segments: 8, color: "#ff8a2a", emissive: 0.8 }), Math.PI / 2), sx * 0.033, my + 0.008, fz + 0.034));
    }
    // The crown's stakes, planted in the backbox's top behind the scoreboard, so its vines stand on something where
    // no board hangs.
    const zs = back - 0.06;
    for (const sx of [-1, 1]) round.push(bamboo(sx * 0.27, top - 0.03, zs, sx * 0.27, 2.31, zs, 0.014, "#cdb06a"));
    const body = withJungle(shaded(round, parts), (geo) => {
      for (const sx of [-1, 1]) {
        const x = sx * 0.345, z = back + 0.105, xs = sx * 0.27;
        liana(geo, [[x, top - 0.05, z], [x + sx * 0.01, top - 0.3, z + 0.005], [x, backY + 0.3, z], [x + sx * 0.006, backY + 0.06, z + 0.003]], 0.014, 0.01);
        sprig(geo, x, top - 0.07, z + 0.01, sx * 0.02, -0.8, 0.6, 3, 0.15, rand);
        sprig(geo, x, backY + 0.28, z + 0.01, sx * 0.02, -0.7, 0.7, 2, 0.12, rand);
        liana(geo, [[xs + sx * 0.03, top - 0.02, zs], [xs + sx * 0.026, top + 0.1, zs - 0.006], [xs + sx * 0.03, top + 0.22, zs + 0.004], [xs + sx * 0.025, top + 0.34, zs - 0.006], [xs + sx * 0.028, 2.22, zs], [xs + sx * 0.018, 2.3, zs - 0.004]], 0.014, 0.01);
        sprig(geo, xs + sx * 0.02, 2.3, zs, sx * 0.5, 1, -0.15, 4, 0.24, rand);
      }
    });
    const glass = glassy(tilted(box({ w: PIN.w, h: 0.01, d: PIN.l, color: "#f2e6c8", offset: { y: 0.07 } })), 0.07);
    return { body, lit: unshadowed(merge(...lit)), glass };
  });
  // A bamboo post one metre tall, lashed at its head, on a stone with a few leaves at its foot: stretched under a
  // free-standing scoreboard.
  const boardPost = cached(() => {
    const { withJungle, sprig, bamboo, lashing } = BL.hubModels, rand = mulberry32(5150);
    const stone = lathe({ profile: [[0, 0], [0.15, 0], [0.165, 0.035], [0.13, 0.085], [0.06, 0.115], [0, 0.12]], segments: 9, color: "#6a6158" });
    return withJungle(shaded([bamboo(0, 0.06, 0, 0, 1, 0, 0.035), lashing(0, 0.93, 0, 0, 1, 0, 0.035), stone]), (geo) => {
      sprig(geo, 0.05, 0.1, 0.03, 1, 0.9, 0.6, 3, 0.16, rand);
      sprig(geo, -0.05, 0.1, -0.02, -1, 0.9, -0.4, 2, 0.14, rand);
    });
  });
  // A flipper carved from a bone: pivot at the origin, its shaft reaching `PIN.flip` along +x (the physics' reach)
  // between a pair of knuckles at each end, lying on the playfield the game stands it 0.012 over; and a top lane's
  // ember, cold (0) or glowing (1).
  const pinFlipper = cached(() => shaded([
    turnedZ(turn([[0.008, 0], [0.008, PIN.flip], [0, PIN.flip]], 8, BONE), -Math.PI / 2),
    ...[0, PIN.flip].flatMap((x) => [-1, 1].map((sz) => moved(ball(0.011, BONE, 8), x, 0, sz * 0.008)))
  ]));
  const pinLight = variants((i) => lathe({ profile: [[0.018, 0], [0.018, 0.004], [0, 0.006]], segments: 10, color: i ? "#ffa53a" : "#4a2a16", emissive: i ? 1 : 0.15 }));
  // A mammoth's tooth for the pinball's drop targets: a bone molar standing on the playfield, long along -z (up the
  // slope), its grinding ridges and an ember across the face it turns to the field (+x).
  const pinTooth = cached(() => unshadowed(merge(
    bevelBox({ w: 0.016, h: 0.042, d: 0.058, color: BONE, bevel: 0.005, offset: { y: 0.021 } }),
    ...[-0.018, 0, 0.018].map((z) => box({ w: 0.004, h: 0.032, d: 0.007, color: "#c8b690", offset: { x: 0.009, y: 0.02, z } })),
    moved(turnedZ(lathe({ profile: [[0.008, 0], [0, 0.004]], segments: 8, color: EMBER_GLOW, emissive: 0.9 }), -Math.PI / 2), 0.011, 0.034, 0)
  )));
  // The pinball's mammoth ramp: a wireform the Oogas bent from two long bone rails, rising from its mouth on the right
  // of the playfield, over the top and down past the teeth to the left inlane, on dry bamboo stilts, a bone tie across
  // its rails at each stilt and a tusk curling up either side of its mouth. `PIN.ramp` is the middle of its channel,
  // [u, v, lift] from the mouth to where it lets the coconut out, straight between points, as the game rides it;
  // `PIN.rampHalf` is half its width. Built in the playfield's frame, as `pinAt` places things.
  PIN.ramp = [[0.18, -0.02, 0], [0.183, 0.12, 0.03], [0.195, 0.28, 0.06], [0.17, 0.4, 0.085], [0.09, 0.455, 0.1], [-0.03, 0.465, 0.1], [-0.15, 0.44, 0.095],
    [-0.245, 0.36, 0.085], [-0.285, 0.22, 0.07], [-0.29, 0, 0.055], [-0.285, -0.2, 0.04], [-0.265, -0.31, 0.02], [-0.24, -0.37, 0.004]];
  PIN.rampHalf = 0.028;
  const pinRamp = cached(() => {
    const { bamboo } = BL.hubModels, pts = PIN.ramp, n = pts.length, half = PIN.rampHalf, round = [];
    // The point `side` of the channel's middle at point i (-1 or 1 across its run), `lift` over its floor; the mouth
    // flares wider.
    const edge = (i, side, lift) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], tu = b[0] - a[0], tv = b[1] - a[1], l = Math.hypot(tu, tv), w = i ? half : half * 1.7;
      const p = pinAt(pts[i][0] + side * tv / l * w, pts[i][1] - side * tu / l * w, { x: 0, y: 0, z: 0 });
      p.y += pts[i][2] + lift;
      return p;
    };
    for (const side of [-1, 1]) {
      const P = pts.map((_, i) => edge(i, side, 0.016));
      round.push(BL.models.tube({ path: (t) => { const f = t * (n - 1), i = Math.min(n - 2, Math.floor(f)), k = f - i, a = P[i], b = P[i + 1]; return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k }; },
        radius: () => 0.0055, rings: (n - 1) * 3, segments: 6, colorFn: () => BONE }));
    }
    for (let i = 1; i < n - 1; i++) {
      const a = edge(i, -1, 0.004), b = edge(i, 1, 0.004), len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      round.push(along(turn([[0, 0], [0.004, 0], [0.004, len], [0, len]], 6, BONE), a.x, a.y, a.z, b.x - a.x, b.y - a.y, b.z - a.z));
      if (pts[i][2] > 0.03 && i % 2 === 0) { const f = pinAt(pts[i][0], pts[i][1], { x: 0, y: 0, z: 0 }); round.push(bamboo(f.x, f.y, f.z, f.x, f.y + pts[i][2], f.z, 0.006, "#cdb06a")); }
    }
    for (const side of [-1, 1]) { const p = edge(0, side, 0); round.push(moved(boneTusk(0.085, 0.008, 1.3), p.x, p.y, p.z)); }
    return shaded(round);
  });
  // Air hockey as the Ice Age plays it, in its frame, long along x with a player at each end: a thick slab of ice
  // chipped round, deep blue with pale sides, on a rough stone slab that stands on two boulders like a dolmen, a
  // fringe of shaggy mammoth fur hanging from
  // the stone's long edges; frost streaks and cracks in the ice and its lines painted in red earth and charcoal, a
  // spiral at centre ice; bark log rails round the ice lashed with rope at the corners, the end
  // rails cut open at the goal slots; the far goal (+x, the Ooga's end in the game) hung under with a leafy liana,
  // below the ice where it never crosses the player's view, and leaves sprouting up from its corners' lashings,
  // framing the Ooga above the far rail. `lit` is the paint, which flares on a goal. The puck, a slice of coconut,
  // and a stone mallet with a bone grip are apart (`hockeyPieces`) for the scene to play with.
  const HOCKEY = { w: 2.2, d: 1.1, y: 0.82 };
  const airHockey = cached(() => {
    const { withJungle, garland, sagPoints, sprig, lashing, log, rock } = BL.hubModels;
    const { w, d, y } = HOCKEY, parts = [], round = [], rand = mulberry32(5200);
    // The ice: a thick slab cut to a chipped outline (a boxy round, its facets each their own length) wide enough to
    // hold the whole play in its corners and lie a little past the stone under it, so its pale sides show under the
    // rails; a deep blue top over pale sides that catch the light, barely glowing.
    const chip = mulberry32(5202), outline = [];
    for (let a = 0; a < Math.PI * 2 - 0.15; a += (0.7 + chip() * 0.6) / 22 * Math.PI * 2) {
      const c = Math.cos(a), s = Math.sin(a);
      outline.push([Math.sign(c) * Math.abs(c) ** (1 / 3) * (w / 2 + 0.1), Math.sign(s) * Math.abs(s) ** (1 / 3) * (d / 2 + 0.09)]);
    }
    const ice = prism(outline, 0.16, "#dff2f8", 0.04);
    ice.faces[outline.length].color = hexToRgb("#8fbfd0");
    parts.push(moved(turnedX(ice, -Math.PI / 2), 0, y - 0.08, 0));
    parts.push(bevelBox({ w: w + 0.16, h: 0.17, d: d + 0.16, color: "#6b625a", bevel: 0.06, offset: { y: y - 0.195 } }));
    // Marks on the ice, each a flat stroke a few millimetres over it from (x0, z0) to (x1, z1), `t` wide: the paint
    // (the centre line and circle and a spiral in it in red earth, a charcoal crease round each goal), a ragged rim of
    // white frost round the edge, open at the centre line and the goals, the frost streaks and the cracks; and under
    // them a few soft patches of deeper blue where the ice is thick.
    const lines = geometry(), frost = geometry();
    const stroke = (geo, x0, z0, x1, z1, t, color, emissive) => {
      const l = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / l * t / 2, uz = (z1 - z0) / l * t / 2;
      face(geo, [[x0 - ux - uz, z0 - uz + ux], [x1 + ux - uz, z1 + uz + ux], [x1 + ux + uz, z1 + uz - ux], [x0 - ux + uz, z0 - uz - ux]].map(([px, pz]) => pushVert(geo, px, y + 0.003, pz)), hexToRgb(color), { emissive });
    };
    const curve = (geo, n, at, t, color, emissive) => { for (let k = 0; k < n; k++) stroke(geo, ...at(k / n), ...at((k + 1) / n), t, color, emissive); };
    for (const s of [-1, 1]) stroke(lines, 0, s * 0.41, 0, s * (d / 2 - 0.01), 0.05, "#b0402a", 0.15);
    curve(lines, 40, (t) => [Math.cos(t * Math.PI * 2) * 0.38, Math.sin(t * Math.PI * 2) * 0.38], 0.035, "#b0402a", 0.15);
    curve(lines, 44, (t) => [Math.cos(t * 12.6) * (0.03 + t * 0.24), Math.sin(t * 12.6) * (0.03 + t * 0.24)], 0.028, "#b0402a", 0.15);
    for (const s of [-1, 1]) curve(lines, 12, (t) => [s * (w / 2 - Math.cos((t - 0.5) * Math.PI) * 0.22), Math.sin((t - 0.5) * Math.PI) * 0.22], 0.03, "#2a1e16", 0.02);
    for (let k = 0; k < 10; k++) {
      const x = (rand() - 0.5) * (w - 0.3), z = (rand() - 0.5) * (d - 0.2), a = rand() * Math.PI, l = 0.12 + rand() * 0.18;
      if (Math.hypot(x, z) > 0.45) stroke(frost, x - Math.cos(a) * l / 2, z - Math.sin(a) * l / 2, x + Math.cos(a) * l / 2, z + Math.sin(a) * l / 2, 0.035, "#d4eef6", 0.05);
    }
    for (let k = 0; k < 9; k++) {
      let x = (rand() - 0.5) * (w - 0.2), z = (rand() - 0.5) * (d - 0.2), a = rand() * Math.PI * 2;
      for (let s = 0; s < 4; s++) {
        const l = 0.07 + rand() * 0.08, nx = Math.max(-w / 2 + 0.05, Math.min(w / 2 - 0.05, x + Math.cos(a) * l)), nz = Math.max(-d / 2 + 0.05, Math.min(d / 2 - 0.05, z + Math.sin(a) * l));
        if (Math.hypot(x, z) > 0.42 && Math.hypot(nx, nz) > 0.42) stroke(frost, x, z, nx, nz, 0.012, "#3f7390", 0.03);
        x = nx; z = nz; a += (rand() - 0.5) * 1.4;
      }
    }
    const deep = mulberry32(5201), RIM = "#eef8fb";
    for (const s of [-1, 1]) for (const [a, b] of [[-w / 2 + 0.04, -0.05], [0.05, w / 2 - 0.04]]) for (let k = 0; k < 4; k++) {
      const x0 = a + (b - a) * k / 4, x1 = a + (b - a) * (k + 1) / 4, z = s * (d / 2 - 0.03 - deep() * 0.012);
      stroke(frost, x0, z, x1, z, 0.035 + deep() * 0.03, RIM, 0.1);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) stroke(frost, sx * (w / 2 - 0.03), sz * 0.25, sx * (w / 2 - 0.03), sz * (d / 2 - 0.04), 0.04 + deep() * 0.02, RIM, 0.1);
    for (let k = 0; k < 6; k++) {
      const cx = (deep() - 0.5) * (w - 0.6), cz = (deep() - 0.5) * (d - 0.4), r = 0.12 + deep() * 0.12, ids = [];
      for (let j = 0; j < 9; j++) { const t = j / 9 * Math.PI * 2; ids.push(pushVert(frost, cx + Math.cos(t) * r * (0.8 + deep() * 0.3), y + 0.0015, cz + Math.sin(t) * r * 0.7)); }
      face(frost, facing(frost, ids, UP), hexToRgb("#5a8fac"), { emissive: 0.04 });
    }
    parts.push(frost);
    // Bark log rails, the long ones running past the corners where rope lashes them, the end ones stopping at the goal
    // slots.
    for (const sz of [-1, 1]) round.push(log(-w / 2 - 0.1, y + 0.03, sz * (d / 2 + 0.045), w / 2 + 0.1, y + 0.03, sz * (d / 2 + 0.045), 0.05, "#5a3e24"));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) round.push(log(sx * (w / 2 + 0.045), y + 0.03, sz * (d / 2 - 0.005), sx * (w / 2 + 0.045), y + 0.03, sz * 0.19, 0.045, "#5a3e24"), lashing(sx * (w / 2 + 0.03), y + 0.03, sz * (d / 2 + 0.045), 1, 0, 0, 0.052));
      parts.push(box({ w: 0.08, h: 0.05, d: 0.38, color: "#140e0a", offset: { x: sx * (w / 2 + 0.045), y: y + 0.005 } }));
    }
    // The dolmen's two boulders, the island's own rocks, their moss hidden under the slab and the small stone of each
    // leaning out toward its end.
    for (const sx of [-1, 1]) round.push(moved(turnedY(scaled(rock(0), 0.75), sx > 0 ? 0 : Math.PI), sx * 0.6, 0, 0));
    const body = withJungle(shaded(round, parts), (geo) => {
      for (const sz of [-1, 1]) garland(geo, [[-w / 2 - 0.02, y - 0.17, sz * (d / 2 + 0.085)], [w / 2 + 0.02, y - 0.17, sz * (d / 2 + 0.085)]], { r: 0.02, color: SHAG[1], every: 0.09, size: 0.2, droop: 0.9, out: [0, 0, sz], rand, tones: SHAG });
      garland(geo, sagPoints(w / 2 + 0.085, y - 0.2, -d / 2 + 0.05, w / 2 + 0.085, y - 0.2, d / 2 - 0.05, 0.1, 8), { r: 0.016, every: 0.2, size: 0.11, droop: 0.95, out: [1, 0, 0], rand });
      for (const sz of [-1, 1]) sprig(geo, w / 2 + 0.045, y + 0.09, sz * (d / 2 + 0.045), 0, 1, -sz * 0.3, 3, 0.13, rand);
    });
    return { body, lit: unshadowed(lines) };
  });
  // The puck, a slice of coconut: the husk's streaked rim round a disc of pale meat; and the mallet, a river stone
  // with a rope collar round its neck and a bone grip with its knob.
  const hockeyPieces = cached(() => {
    const husk = turn([[0, 0], [0.047, 0], [0.05, 0.004], [0.05, 0.016], [0.046, 0.02], [0.04, 0.02]], 14, "#6b4a26"), streak = hexToRgb("#4e3419");
    husk.faces.forEach((f, k) => { if (k % 14 % 3 === 0) f.color = streak; });
    return {
      puck: shaded([husk, turn([[0.04, 0.02], [0.036, 0.021], [0, 0.021]], 14, CREAM, 0.15)]),
      mallet: shaded([
        turn([[0, 0], [0.07, 0], [0.073, 0.018], [0.064, 0.034], [0.034, 0.044]], 14, "#8b837b"),
        turn([[0.034, 0.044], [0.031, 0.05], [0.031, 0.058], [0.027, 0.062]], 12, "#c9a36a"),
        turn([[0.027, 0.062], [0.024, 0.09], [0.036, 0.1], [0.028, 0.12], [0, 0.125]], 12, BONE)
      ])
    };
  });
  // The doorway's two boxes, facing +z, carved by the Oogas. 0 the token changer: a tiki totem painted with red-earth
  // bands and a handprint on each side, its head a wider block with a heavy brow over two deep sockets where the fire
  // inside glows, a nose, and a grin of bone teeth round COCONUTS brushed in chalk; carved chevrons in red earth and
  // ochre down its front, a bill slot with a bone lip under its chin, a coconut-shell cup of tokens, and a fan of
  // feathers standing behind its head. 1 the ticket muncher: a big rounded boulder of a gorilla head on a squat bark
  // stump, its roots gripping the floor, between two bamboo canes, a heavy brow over the fire glowing in its eyes, two nostrils, and its mouth
  // gaping wide in thick stone lips, bone teeth top and bottom round MUNCH brushed on the dark it eats tickets into;
  // a fan of feathers behind its crown with a banana on top. `FEATHERS` are the machines' feathers, [light, dark] rgb:
  // bone, red and ochre; the staff's (`FEATHER_TONES`) and the bunting's (`BUNTING`) are tones of their own.
  const FEATHERS = [["#efe6d2", "#b8ac94"], ["#c0402a", "#7a2618"], ["#e0a83a", "#9a6a1e"]].map((p) => p.map(hexToRgb));
  const MUNCHER_ROCK = ["#7a716a", "#8b837b", "#9a9088", "#aaa198"].map(hexToRgb), MUNCHER_BROW = ["#5d5650", "#6b625a", "#7a716a", "#8b837b"].map(hexToRgb);
  const changer = variants((i) => {
    const { withJungle, pointedLeaf, bamboo, puff, log } = BL.hubModels, parts = [], round = [], lit = [], ember =(r) => glowing(moved(turnedX(lathe({ profile: [[r, 0], [0, r * 0.45]], segments: 8, color: "#ff8a2a" }), Math.PI / 2), 0, 0, 0), 1);
    const socket = (r) => moved(turnedX(lathe({ profile: [[r, 0], [r * 0.9, r * 0.3], [0, r * 0.35]], segments: 12, color: "#1a120c" }), Math.PI / 2), 0, 0, 0);
    let top = 1.72;
    if (i) {
      // The mouth: an oval of lips, the dark inside just proud of them, the teeth pointing in from its rim.
      const M = { y: 1.2, z: 0.29 };
      round.push(log(0, 0, 0.02, 0, 0.9, 0.02, 0.3, STUMP.bark));
      for (const a of [-1.5, -0.5, 0.5, 1.5]) round.push(log(Math.sin(a) * 0.2, 0.22, 0.02 + Math.cos(a) * 0.2, Math.sin(a) * 0.38, 0.02, 0.02 + Math.cos(a) * 0.3, 0.07, STUMP.bark));
      parts.push(moved(prism(oval(0.25, 0.15), 0.1, "#6b625a"), 0, M.y, M.z), moved(prism(oval(0.21, 0.115), 0.02, "#140c08"), 0, M.y, M.z + 0.045));
      parts.push(brushWord(geometry(), "MUNCH", 0, M.y, 0.075, 0.013, EARTH_CHALK, 0.35, M.z + 0.056));
      for (let k = 0; k < 5; k++) {
        const x = (k - 2) * 0.065, y = 0.115 * Math.sqrt(1 - (x / 0.21) ** 2) - 0.004;
        parts.push(moved(prism(ccw([[x - 0.02, y], [x + 0.02, y], [x, y - 0.034]]), 0.012, BONE), 0, M.y, M.z + 0.058));
        if (k < 4) { const xb = (k - 1.5) * 0.07, yb = -0.115 * Math.sqrt(1 - (xb / 0.21) ** 2) + 0.004; parts.push(moved(prism(ccw([[xb - 0.02, yb], [xb + 0.02, yb], [xb, yb + 0.03]]), 0.012, BONE), 0, M.y, M.z + 0.058)); }
      }
      for (const sx of [-1, 1]) {
        parts.push(moved(socket(0.06), sx * 0.12, 1.4, 0.28), moved(socket(0.018), sx * 0.045, 1.33, 0.315));
        lit.push(moved(ember(0.03), sx * 0.12, 1.4, 0.302));
        round.push(bamboo(sx * 0.4, 0, 0.27, sx * 0.4, 1.8, 0.27, 0.05));
      }
      parts.push(moved(turnedZ(scaled(BL.models.bananaGeometry(), 0.8), 0.3), 0.05, 1.74, 0.05));
    } else {
      parts.push(bevelBox({ w: 0.8, h: 1.75, d: 0.55, color: "#7a4a26", bevel: 0.05, offset: { y: 0.875 } }));
      parts.push(box({ w: 0.66, h: 0.3, d: 0.02, color: TIMBER_DK, offset: { y: 1.48, z: 0.28 } }));
      parts.push(brushWord(geometry(), "COCONUTS", 0, 1.48, 0.09, 0.017, EARTH_CHALK, 0.35, 0.292));
      for (const y of [1.66, 1.3]) for (let k = 0; k < 9; k++) parts.push(bevelBox({ w: 0.055, h: 0.05, d: 0.03, color: BONE, bevel: 0.012, offset: { x: (k - 4) * 0.074, y, z: 0.285 } }));
      // The head, a wider block on top: its brow, the sockets with the fire in them, and the nose. The grin is the
      // painted panel.
      parts.push(bevelBox({ w: 0.9, h: 0.5, d: 0.62, color: "#8a5a32", bevel: 0.06, offset: { y: 2 } }), bevelBox({ w: 0.84, h: 0.09, d: 0.1, color: TIMBER_DK, bevel: 0.025, offset: { y: 2.16, z: 0.31 } }));
      for (const sx of [-1, 1]) parts.push(moved(turnedX(lathe({ profile: [[0.1, 0], [0.09, 0.03], [0, 0.035]], segments: 12, color: "#1a120c" }), Math.PI / 2), sx * 0.2, 2, 0.31)), lit.push(moved(ember(0.045), sx * 0.2, 2, 0.346));
      parts.push(moved(prism(ccw([[-0.08, -0.05], [0.08, -0.05], [0, 0.12]]), 0.08, TIMBER_DK), 0, 1.86, 0.3));
      [0.2, 0.36, 0.86].forEach((y, k) => parts.push(moved(prism(ccw([[-0.2, 0.06], [0, -0.06], [0.2, 0.06]]), 0.02, k % 2 ? "#e0a83a" : "#b8402e"), 0, y, 0.28)));
      for (const y of [0.1, 0.62]) parts.push(box({ w: 0.81, h: 0.05, d: 0.56, color: "#b8402e", offset: { y } }));
      for (const sx of [-1, 1]) parts.push(moved(turnedY(daubHand(geometry(), 0, -0.11, 0.25, 0, "#c0502e", 0.2, 0.004), sx * Math.PI / 2), sx * 0.4, 0.95, 0));
      parts.push(box({ w: 0.36, h: 0.06, d: 0.03, color: "#1a120c", offset: { y: 1.05, z: 0.285 } }), box({ w: 0.38, h: 0.02, d: 0.04, color: BONE, offset: { y: 1.02, z: 0.29 } }));
      parts.push(moved(lathe({ profile: [[0.14, 0], [0.16, 0.1], [0.15, 0.11], [0, 0.03]], segments: 12, color: "#6b4a26" }), 0, 0.55, 0.36));
      for (let k = 0; k < 5; k++) parts.push(moved(lathe({ profile: [[0.03, 0], [0.03, 0.008], [0, 0.008]], segments: 8, color: "#ffc83a" }), (k - 2) * 0.035, 0.6 + (k % 2) * 0.01, 0.36 + (k % 3 - 1) * 0.03));
      top = 2.25;
    }
    // The muncher's boulder head and its brow, and the feathers, fanned in a plane behind the head's crown.
    const body = withJungle(shaded(round, parts), (g) => {
      if (i) {
        const rock = mulberry32(3301);
        puff(g, 0, 1.28, 0.02, 0.42, 0.44, 0.3, MUNCHER_ROCK, rock, 5, 10);
        puff(g, 0, 1.5, 0.2, 0.3, 0.07, 0.12, MUNCHER_BROW, rock, 4, 8);
      }
      for (let k = 0; k < 5; k++) {
        const a = (k - 2) * 0.32, ax = Math.sin(a), ay = Math.cos(a), [light, dark] = FEATHERS[(k + i) % 3];
        pointedLeaf(g, ax * 0.06, top - 0.03, -0.12, ax, ay, 0, ay * 0.35, -ax * 0.35, 0, 0, 0, 1, k === 2 ? 0.58 : 0.48, light, dark);
      }
    });
    return { body, lit: unshadowed(merge(...lit)) };
  });
  // The prize queue's ropes, from `LAYOUT.ropes`: bamboo posts on stone feet, each topped with a coconut, and a rope
  // of two vines twisted together sagging between them, a pair of leaves hanging from each span. Folded into the same
  // geometry, the hall's stores (`LAYOUT.stores`): a pile of firewood, three bundles of seven logs each lashed with
  // two ropes, two side by side and one in the groove over them, their ends ragged; and a woven basket heaped with
  // husk coconuts, its sides in a twill of two close straws under a rolled rim.
  const WOOD_R = 0.059, BUNDLE_R = WOOD_R * 3, BILLET = ["#e0c08a", "#9a6a3a"].map(hexToRgb);
  // A billet of firewood `len` long up +y, radius r: bark in streaks of `bark` and a shade darker, and at each end pale
  // end grain inside a darker ring. About sixty triangles; the hub's `log` is too fine for a pile of them.
  const billet = (len, r, bark) => {
    const geo = lathe({ profile: [[0, 0], [r * 0.7, 0], [r, r * 0.25], [r, len - r * 0.25], [r * 0.7, len], [0, len]], segments: 8, color: "#000000" });
    const tones = [hexToRgb(bark), hexToRgb(tint(bark, 0.8))];
    geo.faces.forEach((f, k) => { const p = Math.floor(k / 8); f.color = p === 0 || p === 4 ? BILLET[0] : p === 2 ? tones[k % 2] : BILLET[1]; });
    return geo;
  };
  const ropes = cached(() => {
    const { withJungle, liana, sprig, bamboo } = BL.hubModels, round = [], leaf = mulberry32(33), wood = mulberry32(35);
    for (const [x0, z0, x1, z1] of LAYOUT.ropes) for (const t of [0, 0.5, 1]) {
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      round.push(moved(turn([[0.14, 0], [0.14, 0.03], [0.1, 0.07], [0, 0.075]], 12, "#6a625a"), x, 0, z), bamboo(x, 0.05, z, x, 0.9, z, 0.035), moved(nut("husk", 0.065), x, 0.95, z));
    }
    const straw = ["#b88a3e", "#a67c38", "#c49a4a"].map(hexToRgb);
    for (const [x, y, z, t, kind] of LAYOUT.stores) {
      const local = [];
      if (kind === "wood") for (const [bz, by] of [[-BUNDLE_R, BUNDLE_R], [BUNDLE_R, BUNDLE_R], [0, 0.44]]) {
        for (let k = 0; k < 7; k++) {
          const a = -Math.PI / 2 + k * Math.PI / 3, d = k ? WOOD_R * 2 : 0, ly = by + Math.sin(a) * d, lz = bz + Math.cos(a) * d, jut = (wood() - 0.5) * 0.08;
          local.push(along(billet(0.68 + (wood() - 0.5) * 0.04, WOOD_R * (0.94 + wood() * 0.1), k % 3 ? "#6b4a2b" : "#5a3e24"), -0.34 + jut, ly, lz, 1, 0, 0));
        }
        for (const lx of [-0.2, 0.2]) local.push(moved(turnedZ(torus(BUNDLE_R + 0.004, 0.014, ROPE, 0, 10, 3), Math.PI / 2), lx, by, bz));
      } else {
        const basket = lathe({ profile: [[0, 0], [0.2, 0], [0.24, 0.03], [0.265, 0.12], [0.28, 0.25], [0.285, 0.38], [0.305, 0.4], [0.285, 0.42], [0.26, 0.4], [0, 0.35]], segments: 16, color: "#000000" });
        basket.faces.forEach((f, k) => { const p = Math.floor(k / 16); f.color = straw[p > 1 && p < 6 ? ((p + k) % 4 < 2 ? 0 : 1) : p < 8 ? 2 : 1]; });
        local.push(basket);
        for (let k = 0; k < 7; k++) {
          const a = k * 1.26, r = k < 5 ? 0.15 : 0.06, up = k < 5 ? 0.4 : 0.52;
          local.push(moved(turnedX(turnedY(nut("husk", 0.095), a * 2.3), (wood() - 0.5) * 0.8), Math.sin(a) * r, up, Math.cos(a) * r));
        }
      }
      for (const part of local) round.push(moved(turnedY(part, t), x, y, z));
    }
    return withJungle(shaded(round), (g) => {
      for (const [x0, z0, x1, z1] of LAYOUT.ropes) {
        const len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len, n = 16;
        for (const phase of [0, Math.PI]) {
          const pts = [];
          for (let k = 0; k <= n; k++) {
            const t = k / n, a = t * len / 0.35 * Math.PI * 2 + phase, y = 0.84 - Math.sin((t * 2 % 1) * Math.PI) * 0.12;
            pts.push([x0 + (x1 - x0) * t + uz * Math.cos(a) * 0.014, y + Math.sin(a) * 0.014, z0 + (z1 - z0) * t - ux * Math.cos(a) * 0.014]);
          }
          liana(g, pts, 0.016, 0.016, "#2f5424");
        }
        for (const t of [0.25, 0.75]) sprig(g, x0 + (x1 - x0) * t, 0.72, z0 + (z1 - z0) * t, 0, -1, 0, 2, 0.2, leaf);
      }
    });
  });

  // ---- the kiddie rides ------------------------------------------------------------------------------------
  // The coin rides of the ride corral by the doorway, each built facing +z: `base` is the round plinth, `RIDE_R` round
  // (a mottled stone drum under the gorilla, a sawn log slice streaked with bark under the others), in a rope band, a
  // bamboo stub lashed at its top for the rocker's spring, a coin post of thick bamboo at its side (lashed, a coconut in
  // its cut top and a timber plate on its front with a tiki's brow, sockets and nose carved in it and the slot for its
  // mouth), and leaves sprouting on the plinth's front under the rider, where the ride hides them from its own camera
  // behind; `body` what rides on it, apart so the scene can rock it about the spring's top at `RIDE_Y`: 0 a silverback
  // gorilla on its knuckles, 1 a cheeky monkey pulling a coconut-shell cart with a banana steering wheel, 2 a friendly
  // triceratops, 3 a shaggy baby mammoth; all but the monkey carry a hide saddle under a leather seat and a bone
  // handlebar.
  const RIDE_Y = 0.55, RIDE_R = 0.66;
  const ride = variants((i) => {
    const { withJungle, sprig, garland, bamboo, lashing, log, liana } = BL.hubModels, stone = !i, round = [], flat = [], leaf = mulberry32(140 + i), mix = mulberry32(150 + i), R = RIDE_R;
    const side = turn([[R - 0.02, 0], [R, 0.03], [R, 0.22], [R - 0.04, 0.26]], 28, "#000000"), grain = ["#6a625a", "#6b4a2b", "#5a3a22", "#634227"][i], rock = ["#6a625a", "#5d5650", "#7a716a"].map(hexToRgb);
    side.faces.forEach((f, k) => { f.color = stone ? rock[Math.floor(mix() * 3)] : hexToRgb(k % 3 ? grain : "#43301c"); });
    round.push(side);
    const band = (R - 0.04) / 3;
    for (let k = 0; k < 3; k++) round.push(lathe({ profile: [[R - 0.04 - k * band, 0.26], [k < 2 ? R - 0.04 - (k + 1) * band : 0, 0.26]], segments: 28, color: stone ? ["#7a7068", "#8a8078", "#7a7068"][k] : k % 2 ? "#d8b070" : "#c89a5a" }));
    round.push(moved(torus(R + 0.005, 0.025, "#c9a36a", 0, 28, 5), 0, 0.17, 0));
    round.push(bamboo(0, 0.26, 0, 0, RIDE_Y - 0.02, 0, 0.1), lashing(0, RIDE_Y - 0.08, 0, 0, 1, 0, 0.1));
    // The coin post at (`PX`, `PZ`), its plate's face at `PF`.
    const PX = 0.56, PZ = 0.05, PF = PZ + 0.075 + 0.03;
    round.push(bamboo(PX, 0.26, PZ, PX, 1.16, PZ, 0.075), moved(nut("husk", 0.07), PX, 1.2, PZ));
    for (const y of [0.5, 0.78]) round.push(lashing(PX, y, PZ, 0, 1, 0, 0.075));
    for (const sx of [-1, 1]) round.push(moved(turnedX(lathe({ profile: [[0.022, 0], [0, 0.008]], segments: 8, color: "#1c1410" }), Math.PI / 2), PX + sx * 0.034, 1.0, PF - 0.002));
    flat.push(bevelBox({ w: 0.16, h: 0.27, d: 0.03, color: TIMBER, bevel: 0.01, offset: { x: PX, y: 0.97, z: PF - 0.015 } }), bevelBox({ w: 0.14, h: 0.028, d: 0.03, color: TIMBER_DK, bevel: 0.01, offset: { x: PX, y: 1.045, z: PF } }));
    flat.push(moved(prism(ccw([[-0.018, -0.028], [0.018, -0.028], [0, 0.028]]), 0.026, TIMBER_DK), PX, 0.955, PF + 0.004));
    flat.push(box({ w: 0.085, h: 0.02, d: 0.02, color: "#1c1410", offset: { x: PX, y: 0.9, z: PF + 0.001 } }), box({ w: 0.15, h: 0.026, d: 0.02, color: "#b8402e", offset: { x: PX, y: 0.86, z: PF } }));
    const base = withJungle(shaded(round, flat), (g) => { for (const sx of [-1, 1]) sprig(g, sx * 0.16, 0.26, 0.48, sx * 0.35, 1.2, 0.5, 3, 0.2, leaf); }), br = [], bf = [];
    const egg = (r, l, color) => turnedX(turn(Array.from({ length: 9 }, (_, k) => [Math.sin(k / 8 * Math.PI) * r, -l / 2 + k / 8 * l]), 16, color), Math.PI / 2);
    // A hide blanket `w` by `len` thrown over the back of an egg `r` round and `l` long lying along z with its middle
    // at (0, y, 0): laid on at `z` and drawn down onto the egg a finger's breadth off it, a leather seat on top.
    const blanket = (w, len, r, l, y, z, kind) => {
      const geo = moved(turnedX(hide(w, len, kind, 160 + i, { wrap: r }), -Math.PI / 2), 0, 0, z), v = geo.verts;
      for (let k = 0; k < v.length; k += 3) {
        const dx = v[k], dy = v[k + 1] + r, d = Math.hypot(dx, dy) || 1, R = r * Math.cos(Math.PI * Math.min(0.45, Math.abs(v[k + 2]) / l)) + 0.012 + d - r;
        v[k] = dx / d * R; v[k + 1] = y + dy / d * R;
      }
      br.push(geo, moved(turn([[0.12, -0.05], [0.16, 0.03], [0.14, 0.07], [0, 0.07]], 12, "#6b4a26"), 0, y + r, z));
    };
    // Bone reins: a bone handlebar at `bar`, `span` wide, and a thin bone rod from each end to the mouth at `mouth`.
    const reins = (bar, span, mouth) => {
      br.push(moved(boneBar(span, 0.02), ...bar));
      for (const sx of [-1, 1]) bf.push(beam(sx * span / 2 * 0.8, bar[1], bar[2], sx * mouth[0], mouth[1], mouth[2], 0.016, BONE));
    };
    // A round limb from a to b, `r0` thick at a and `r1` at b, its ends rounded.
    const Q = [[0, 1], [0.5, 0.87], [0.87, 0.5], [1, 0]];
    const limb = (a, b, r0, r1, color) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
      return along(turn([...Q.map(([s, t]) => [r0 * s, -r0 * t]), ...Q.slice().reverse().map(([s, t]) => [r1 * s, len + r1 * t])], 10, color), a[0], a[1], a[2], dx, dy, dz);
    };
    // A big friendly eye at (x, y, z) looking along (nx, nz): its white `r` round, a dark pupil and a glint.
    const eye = (x, y, z, r, nx, nz) => br.push(moved(ball(r, "#f6ecd2", 10), x, y, z), moved(ball(r * 0.6, "#1c1410", 8), x + nx * r * 0.62, y, z + nz * r * 0.62),
      moved(ball(r * 0.2, "#ffffff", 6), x + nx * r * 0.95 + nz * r * 0.2, y + r * 0.3, z + nz * r * 0.95 - nx * r * 0.2));
    // A dark line through `pts`, `w` thick: a mouth.
    const mouth = (pts, w) => { for (let k = 1; k < pts.length; k++) bf.push(beam(...pts[k - 1], ...pts[k], w, "#1c1410")); };
    // A smile round the front of a snout, an egg along x at (0, y, z), `r` round and `half` to each end: `drop` radians
    // under its middle at the centre, rising to the corners.
    const smile = (y, z, r, half, drop, w) => mouth(Array.from({ length: 9 }, (_, k) => {
      const x = (k / 4 - 1) * half * 0.75, rx = r * Math.sqrt(1 - (x / half) ** 2) + w * 0.3, a = drop * (1 - 0.6 * Math.abs(k / 4 - 1));
      return [x, y - rx * Math.sin(a), z + rx * Math.cos(a)];
    }), w);
    let grow = null;
    if (!i) {
      // The silverback on its knuckles: a charcoal body under a great hump of shoulders, the saddle of silver fur on
      // its back behind the hide, long arms planted on their knuckles, short bent legs on flat feet, and a big
      // friendly face: a leathery mask under a heavy brow and a tall crest, round eyes, a broad nose and a wide smile
      // on a pale muzzle, small ears.
      const fur = "#564b46", skin = "#6e5a4f", brow = "#3e322c", silver = ["#c4beb4", "#aaa39a"].map(hexToRgb), torso = egg(0.35, 1.0, fur);
      torso.faces.forEach((f, k) => { const p = Math.floor(k / 16), s = k % 16; if (p <= 3 && s >= 9) f.color = silver[(p + s) % 2]; });
      br.push(moved(torso, 0, 0.42, 0), moved(ball(0.3, fur, 14), 0, 0.6, 0.28), moved(turnedY(egg(0.2, 0.76, fur), Math.PI / 2), 0, 0.64, 0.34));
      for (const sx of [-1, 1]) {
        br.push(limb([sx * 0.3, 0.62, 0.36], [sx * 0.37, 0.3, 0.5], 0.13, 0.1, fur), limb([sx * 0.37, 0.3, 0.5], [sx * 0.36, 0.06, 0.53], 0.1, 0.09, fur));
        br.push(moved(turn([[0, -0.06], [0.08, -0.055], [0.105, -0.01], [0.09, 0.04], [0, 0.065]], 10, fur), sx * 0.36, 0.04, 0.55));
        for (const dx of [-0.05, 0, 0.05]) br.push(moved(ball(0.03, skin, 6), sx * 0.36 + dx, -0.005, 0.63));
        br.push(moved(ball(0.17, fur, 12), sx * 0.2, 0.3, -0.36), limb([sx * 0.24, 0.24, -0.34], [sx * 0.26, 0.04, -0.28], 0.1, 0.08, fur), moved(egg(0.065, 0.22, skin), sx * 0.26, 0.01, -0.24));
        eye(sx * 0.078, 0.9, 0.83, 0.058, sx * 0.3, 0.95);
        br.push(moved(ball(0.05, skin, 8), sx * 0.235, 0.87, 0.58), moved(ball(0.024, "#1c1410", 6), sx * 0.032, 0.826, 0.905));
        br.push(limb([sx * 0.15, 0.95, 0.8], [0, 0.965, 0.84], 0.045, 0.05, brow));
      }
      br.push(moved(ball(0.24, fur, 16), 0, 0.86, 0.6), moved(turnedX(turn([[0.14, 0], [0.12, 0.09], [0.06, 0.18], [0, 0.22]], 12, fur), -0.35), 0, 1.0, 0.52));
      br.push(moved(turnedX(turn([[0.18, 0], [0.17, 0.07], [0.12, 0.12], [0, 0.14]], 16, skin), Math.PI / 2), 0, 0.84, 0.72));
      br.push(moved(turnedY(egg(0.1, 0.32, "#a08876"), Math.PI / 2), 0, 0.75, 0.8), moved(ball(0.065, skin, 10), 0, 0.84, 0.845));
      smile(0.75, 0.8, 0.1, 0.16, 0.32, 0.014);
      blanket(0.62, 0.4, 0.35, 1.0, 0.42, -0.14, "leopard");
      br.push(moved(boneBar(0.5, 0.02), 0, 0.93, 0.25));
    } else if (i === 2) {
      // The triceratops, green and friendly: a round body over a pale belly, ochre and red earth daubed across its
      // back, stubby legs with bone toenails and a short tail tipped ochre; a big head with a hooked beak, a short horn
      // on its nose and two long bone horns over its big round eyes, a smile along each side of the beak, and the
      // orange frill fanned up behind, rimmed with ochre knobs and dotted with red earth. Bone reins run round the
      // frill from the handlebar across its back.
      const skin = "#5f8c46", torso = egg(0.37, 1.05, skin), tail = turn([[0.15, 0], [0.1, 0.25], [0.04, 0.42], [0, 0.45]], 10, skin), [ochre, red] = [EARTH_OCHRE, EARTH_RED].map(hexToRgb);
      torso.faces.forEach((f, k) => { const p = Math.floor(k / 16), s = k % 16; if (s >= 9 && s <= 14 && (p === 1 || p === 5)) f.color = p === 1 ? ochre : red; });
      tail.faces.forEach((f, k) => { if (k >= 20) f.color = ochre; });
      br.push(moved(torso, 0, 0.4, 0), moved(egg(0.3, 0.82, "#cdb883"), 0, 0.3, 0.06), moved(ball(0.25, skin, 14), 0, 0.52, 0.42), moved(turnedX(tail, -2.0), 0, 0.38, -0.44));
      br.push(moved(turnedX(egg(0.19, 0.46, skin), 0.2), 0, 0.64, 0.62), moved(turnedX(turn([[0.09, 0], [0.07, 0.06], [0.035, 0.11], [0, 0.13]], 10, "#6e5236"), Math.PI / 2 + 0.4), 0, 0.595, 0.78));
      br.push(moved(turnedX(boneTusk(0.14, 0.034, 0.5), 0.45), 0, 0.73, 0.74));
      for (const sx of [-1, 1]) {
        br.push(moved(turnedX(turnedZ(boneTusk(0.3, 0.038, 0.55), -sx * 0.25), 0.95), sx * 0.085, 0.79, 0.64));
        eye(sx * 0.14, 0.7, 0.72, 0.05, sx * 0.6, 0.8);
        for (const z of [0.28, -0.28]) {
          br.push(moved(turn([[0, 0], [0.12, 0], [0.12, 0.26], [0.1, 0.3], [0, 0.3]], 10, skin), sx * 0.22, -0.02, z));
          for (const dx of [-0.05, 0, 0.05]) br.push(moved(ball(0.026, BONE, 6), sx * 0.22 + dx, 0.0, z + 0.105));
        }
        // The smile along the side of the snout from the beak, rising to the cheek.
        mouth(Array.from({ length: 5 }, (_, k) => {
          const d = (0.76 - k * 0.035 - 0.62) / 0.98, rr = 0.19 * Math.cos(Math.PI * d / 0.46) + 0.005, a = 0.55 - k * 0.09;
          return [sx * rr * Math.cos(a), 0.64 - d * 0.2 - rr * Math.sin(a), 0.62 + d * 0.98];
        }), 0.012);
      }
      // The frill, built flat about +y (orange face up, dark underneath, ochre knobs round its top half and red earth
      // dots) and stood up behind the head, leaning back.
      const disc = turn([[0, 0.025], [0.26, 0.02], [0.3, 0], [0.26, -0.02], [0, -0.025]], 20, "#d9793a"), [edge, back] = [EARTH_OCHRE, "#44683a"].map(hexToRgb), frill = [disc];
      disc.faces.forEach((f, k) => { const p = Math.floor(k / 20); if (p) f.color = p < 4 ? edge : back; });
      for (let k = 0; k < 7; k++) { const t = -1.5 + k * 0.5; frill.push(moved(ball(0.045, EARTH_OCHRE, 8), Math.sin(t) * 0.3, 0, -Math.cos(t) * 0.3)); }
      for (let k = 0; k < 5; k++) { const t = -1 + k * 0.5; frill.push(moved(lathe({ profile: [[0.03, 0.02], [0.03, 0.024], [0, 0.026]], segments: 8, color: EARTH_RED }), Math.sin(t) * 0.17, 0, -Math.cos(t) * 0.17)); }
      br.push(moved(turnedX(merge(...frill), Math.PI / 2 - 0.55), 0, 0.86, 0.44));
      blanket(0.62, 0.42, 0.37, 1.05, 0.4, -0.1, "tiger");
      reins([0, 0.7, 0.3], 0.8, [0.07, 0.56, 0.8]);
    } else if (i === 3) {
      // The baby mammoth: a red-brown body from a round rump up to a hump of shoulders and a domed head, round ears
      // flopped out at its sides, big friendly eyes over rosy cheeks, a ringed trunk hanging down and curling up at its
      // tip between two little tusks, stubby legs on bone toenails and a short tail; shaggy fur hangs along its flanks
      // under the saddle and tufts its crown and its tail (grown below).
      const fur = "#8c4a2c", shag = mulberry32(171);
      br.push(moved(egg(0.36, 1.0, fur), 0, 0.42, 0), moved(ball(0.22, fur, 12), 0, 0.42, -0.28), moved(ball(0.3, fur, 14), 0, 0.6, 0.26));
      br.push(moved(ball(0.25, fur, 16), 0, 0.84, 0.56), moved(ball(0.16, fur, 12), 0, 0.97, 0.5));
      // The trunk: every other band of its length a darker wrinkle, and its tip.
      const trunk = boneTusk(0.45, 0.082, 2.4, fur, 0.45), wrinkle = hexToRgb("#6e3a22");
      trunk.faces.forEach((f, k) => { const b = Math.floor(k / 8); if (b > 2 && b % 2) f.color = wrinkle; });
      br.push(moved(turnedY(turnedX(trunk, Math.PI), Math.PI), 0, 0.8, 0.75));
      for (const sx of [-1, 1]) {
        const ear = merge(turn([[0, 0.02], [0.1, 0.016], [0.115, 0], [0.1, -0.016], [0, -0.02]], 14, fur), lathe({ profile: [[0.075, 0.018], [0.068, 0.026], [0, 0.028]], segments: 14, color: "#c98a62" }));
        br.push(along(ear, sx * 0.23, 0.9, 0.5, sx * 0.85, -0.1, 0.35));
        eye(sx * 0.1, 0.9, 0.78, 0.055, sx * 0.3, 0.95);
        br.push(moved(ball(0.042, "#b8604a", 8), sx * 0.19, 0.83, 0.71), moved(turnedY(mammothTusk(0.24, 0.026, 0.7, 2.2), sx * 0.35), sx * 0.1, 0.72, 0.74));
        for (const z of [0.25, -0.25]) {
          br.push(moved(turn([[0, 0], [0.11, 0], [0.115, 0.05], [0.1, 0.28], [0.07, 0.33], [0, 0.35]], 10, fur), sx * 0.15, -0.02, z));
          for (const dx of [-0.05, 0, 0.05]) br.push(moved(ball(0.028, BONE, 6), sx * 0.15 + dx, 0.0, z + 0.1));
        }
      }
      br.push(moved(turnedX(turn([[0.045, 0], [0.03, 0.12], [0, 0.15]], 8, fur), -2.3), 0, 0.46, -0.48));
      blanket(0.6, 0.42, 0.36, 1.0, 0.42, -0.12, "buck");
      br.push(moved(boneBar(0.52, 0.02), 0, 0.94, 0.22));
      grow = (g) => {
        for (const sx of [-1, 1]) garland(g, [[sx * 0.2, 0.5, -0.4], [sx * 0.31, 0.52, -0.2], [sx * 0.345, 0.53, 0], [sx * 0.33, 0.52, 0.18], [sx * 0.3, 0.5, 0.34]], { r: 0.02, color: SHAG[1], every: 0.07, size: 0.16, droop: 0.9, out: [sx, -0.3, 0], rand: shag, tones: SHAG });
        sprig(g, 0, 1.07, 0.41, 0, 0.25, -1, 5, 0.1, shag, SHAG);
        sprig(g, 0, 0.36, -0.59, 0, -0.67, -0.75, 3, 0.08, shag, SHAG);
      };
    } else {
      // The monkey cart: a cheeky monkey on all fours in a rope harness, a warm brown coat, a pale face with big round
      // ears, big eyes, one brow cocked and a toothy grin, its long tail curling up at its side (grown below); pulling a
      // coconut-shell cart on two log-slice wheels, a leopard cushion in the shell and a banana steering wheel before it.
      const fur = "#8a5a32", pale = "#e8c89a", palm = "#c89a64", TUB = 0.4, TY = 0.42, TZ = -0.34;
      // The shell: husk outside, streaked with fibre, and white flesh round its rim and inside.
      const outer = [], inner = [[TUB, 0]];
      for (let k = 0; k <= 8; k++) { const a = k / 8 * Math.PI / 2; outer.push([Math.sin(a) * TUB, -Math.cos(a) * TUB]); }
      for (let k = 8; k >= 0; k--) { const a = k / 8 * Math.PI / 2; inner.push([Math.sin(a) * TUB * 0.88, -Math.cos(a) * TUB * 0.86]); }
      const husk = turn(outer, 18, "#6b4a26"), streak = hexToRgb("#4a3219");
      husk.faces.forEach((f, k) => { if (k % 18 % 3 === 0) f.color = streak; });
      br.push(moved(husk, 0, TY, TZ), moved(turn(inner, 18, "#f1e8d2"), 0, TY, TZ), moved(turnedX(hide(0.44, 0.4, "leopard", 172), -Math.PI / 2), 0, TY - 0.12, TZ));
      br.push(log(0, 0.04, -0.62, 0, 0.04, 0.2, 0.06), bamboo(-0.49, 0.14, TZ, 0.49, 0.14, TZ, 0.025, "#cdb06a"));
      for (const sx of [-1, 1]) br.push(log(sx * 0.415, 0.14, TZ, sx * 0.485, 0.14, TZ, 0.16), bamboo(sx * 0.26, 0.36, -0.02, sx * 0.2, 0.37, 0.34, 0.022, "#cdb06a"));
      // The banana wheel: two bananas bent into a ring round a coconut hub on a bamboo spoke, its top leaning away
      // from the rider, on a column down to a plank across the shell's front.
      const banana = (a0, a1) => {
        const g = geometry(), n = 10, m = 6, rows = [], yellow = hexToRgb("#ffd23a"), tip = hexToRgb("#5a3a1e");
        for (let k = 0; k <= n; k++) {
          const t = k / n, a = a0 + (a1 - a0) * t, w = 0.026 * Math.max(0.3, Math.sin(Math.PI * t) ** 0.6), cx = Math.cos(a), cy = Math.sin(a);
          rows.push(Array.from({ length: m }, (_, j) => { const b = j / m * Math.PI * 2, u = 0.12 + Math.cos(b) * w; return pushVert(g, cx * u, cy * u, Math.sin(b) * w); }));
        }
        for (let k = 0; k < n; k++) for (let j = 0; j < m; j++) face(g, [rows[k][j], rows[k + 1][j], rows[k + 1][(j + 1) % m], rows[k][(j + 1) % m]], k && k < n - 1 ? yellow : tip);
        face(g, rows[0], tip);
        face(g, rows[n].slice().reverse(), tip);
        return g;
      };
      const wheel = merge(banana(0.2, Math.PI - 0.2), banana(Math.PI + 0.2, 2 * Math.PI - 0.2), bamboo(-0.12, 0, 0, 0.12, 0, 0, 0.012, "#cdb06a"), nut("husk", 0.035));
      br.push(moved(turnedX(wheel, 0.55), 0, 0.6, -0.12), bamboo(0, 0.6, -0.12, 0, 0.46, 0.1, 0.018, "#cdb06a"));
      bf.push(bevelBox({ w: 0.5, h: 0.05, d: 0.12, color: TIMBER, bevel: 0.015, offset: { x: 0, y: 0.45, z: 0.06 } }));
      // The monkey.
      br.push(moved(turnedX(egg(0.2, 0.5, fur), -0.3), 0, 0.38, 0.46), moved(turnedX(egg(0.15, 0.36, palm), -0.3), 0, 0.33, 0.49));
      br.push(moved(turnedX(torus(0.21, 0.018, "#c9a36a", 0, 16, 5), Math.PI / 2 - 0.3), 0, 0.37, 0.36), moved(ball(0.18, fur, 14), 0, 0.64, 0.72));
      for (const sx of [-1, 1]) {
        br.push(moved(ball(0.085, pale, 10), sx * 0.055, 0.67, 0.83), limb([sx * 0.12, 0.44, 0.58], [sx * 0.15, 0.03, 0.68], 0.06, 0.05, fur), moved(ball(0.05, palm, 8), sx * 0.15, 0.01, 0.7));
        br.push(limb([sx * 0.12, 0.32, 0.3], [sx * 0.16, 0.18, 0.4], 0.075, 0.06, fur), limb([sx * 0.16, 0.18, 0.4], [sx * 0.15, 0.03, 0.27], 0.06, 0.05, fur), moved(egg(0.04, 0.14, palm), sx * 0.15, 0.01, 0.29));
        const ear = merge(turn([[0, 0.015], [0.07, 0.012], [0.08, 0], [0.07, -0.012], [0, -0.015]], 12, fur), lathe({ profile: [[0.05, 0.014], [0.045, 0.02], [0, 0.022]], segments: 12, color: pale }));
        br.push(along(ear, sx * 0.2, 0.7, 0.7, sx * 0.8, 0.1, 0.55));
        eye(sx * 0.055, 0.675, 0.9, 0.036, sx * 0.3, 0.95);
        br.push(moved(ball(0.012, "#1c1410", 5), sx * 0.016, 0.615, 0.915));
        bf.push(moved(turnedZ(box({ w: 0.06, h: 0.014, d: 0.02, color: "#3a2412" }), sx > 0 ? -0.35 : 0.1), sx * 0.06, sx > 0 ? 0.745 : 0.728, 0.9));
      }
      br.push(moved(turnedY(egg(0.075, 0.2, pale), Math.PI / 2), 0, 0.59, 0.85));
      smile(0.59, 0.85, 0.075, 0.1, 0.4, 0.012);
      bf.push(box({ w: 0.06, h: 0.014, d: 0.01, color: "#fbf6e8", offset: { x: 0, y: 0.59 - 0.075 * Math.sin(0.22), z: 0.85 + 0.075 * Math.cos(0.22) + 0.004 } }));
      grow = (g) => liana(g, [[0.04, 0.4, 0.26], [0.16, 0.46, 0.22], [0.26, 0.6, 0.2], [0.29, 0.76, 0.2], [0.24, 0.88, 0.2], [0.15, 0.87, 0.2], [0.13, 0.78, 0.2], [0.19, 0.74, 0.2], [0.22, 0.79, 0.2]], 0.024, 0.012, fur);
    }
    const body = shaded(br, bf);
    return { base, body: grow ? withJungle(body, grow) : body };
  });
  // Where a rider sits on each `body`, in its frame: the hip at `y` and `z` on the leather seat (the monkey's rider down
  // on the cushion in the shell), the body leaning back by `lean` with its hands off the grips (holding on, it leans as
  // far as its arms reach them), each hand on its `grip` ([x] out to either side, y, z: the bone handlebar's ends, the
  // dino's reins at its bar, the banana wheel's rim), each leg's hang, `splay` out down the flank and `reach` forward
  // (radians, the body at `lean`; the monkey's rider has its feet up on the shell's rim), and the rider's `scale`: a
  // kiddie ride, so a grown Ooga is still big on it.
  const RIDE_SEATS = [
    { y: 0.84, z: -0.16, lean: -0.12, grip: [0.2, 0.93, 0.25], splay: 0.6, reach: 0.35, scale: 0.9 },
    { y: 0.31, z: -0.38, lean: -0.4, grip: [0.12, 0.6, -0.12], splay: 0.2, reach: 1.9, scale: 0.8 },
    { y: 0.84, z: -0.12, lean: -0.1, grip: [0.3, 0.7, 0.3], splay: 0.62, reach: 0.35, scale: 0.82 },
    { y: 0.85, z: -0.14, lean: -0.12, grip: [0.21, 0.94, 0.22], splay: 0.6, reach: 0.35, scale: 0.85 }
  ];
  // A ride game's beat pole, hung in front of the ride while it runs: a bamboo pole on two lianas running up out of
  // sight and `RIDE_BEAT.cups` coconut-shell cups along it, `RIDE_BEAT.step` apart about its middle, their rims at
  // the origin. It casts no shadow: it hangs in the air, a draw saved.
  const RIDE_BEAT = { step: 0.13, cups: 8 };
  const rideBeat = cached(() => {
    const { withJungle, bamboo, lashing, liana } = BL.hubModels, S = RIDE_BEAT.step, half = S * RIDE_BEAT.cups / 2 + 0.07, round = [];
    round.push(bamboo(-half, -0.05, 0, half, -0.05, 0, 0.02));
    for (let k = 0; k < RIDE_BEAT.cups; k++) round.push(moved(turn([[0.016, -0.044], [0.034, -0.024], [0.042, 0], [0.036, 0.004]], 10, k % 2 ? "#6b4a26" : "#5a3c1e"), (k + 0.5 - RIDE_BEAT.cups / 2) * S, 0, 0));
    for (const sx of [-1, 1]) round.push(lashing(sx * (half - 0.04), -0.05, 0, 1, 0, 0, 0.02));
    return unshadowed(withJungle(shaded(round), (g) => { for (const sx of [-1, 1]) liana(g, [[sx * (half - 0.04), -0.03, 0], [sx * (half - 0.07), 0.9, 0.02], [sx * (half - 0.05), 2.4, 0]], 0.012, 0.01); }));
  });

  // ---- the hall's life: tickets, boards, the ceiling and the clutter ----------------------------------------
  // A strip of bark tickets spooling out of a machine, bone and red earth in turn with a gap between, curling out as
  // it hangs: its top at the origin, one metre long down -y; the scene stretches it as it spools.
  const ticketStrip = cached(() => {
    const parts = [];
    for (let k = 0; k < 14; k++) {
      const y = -(k + 0.5) / 14, curl = (k / 14) ** 2 * 0.25;
      parts.push(moved(turnedX(box({ w: 0.06, h: 1 / 14 - 0.004, d: 0.004, color: k % 2 ? "#efe2c4" : "#c0583a" }), curl * 2), 0, y, curl * 0.4));
    }
    return unshadowed(merge(...parts));
  });
  // The hall of fame hung off the stage: each game's best brushed in earth paint on a slate, BIG OOGAS in chalk over
  // a red-earth zigzag, then a row a game: its name in ochre, the Ooga's initials in chalk and the score in ember
  // ochre, gold where the visitor holds it. `rows` are [game, initials, score, mine], laid out on the old board's grid
  // of `FAME_W` columns 4.5 cm apart and `FAME_ROW` a row. Kept while its rows read the same, so a visit bakes it
  // only when a best changed.
  const FAME_W = 82, FAME_ROW = 9, FAME_GOLD = "#ffc83a", FAME_EMBER = "#f0a040";
  let fameKept = null;
  const fameBoard = (rows) => {
    if (fameKept && fameKept.rows.length === rows.length && fameKept.rows.every((r, i) => r.every((v, k) => v === rows[i][k]))) return fameKept.geo;
    const geo = fameBaked(rows);
    fameKept = { rows: rows.map((r) => r.slice()), geo };
    return geo;
  };
  const fameBaked = (rows) => {
    const c = 0.045, W = FAME_W * c, H = (11 + rows.length * FAME_ROW) * c, g = geometry(), h = 0.26, z = 0.004;
    daubPoly(g, [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]], "#5a5048", 0.06);
    brushWord(g, "BIG OOGAS", 0, H / 2 - 4.5 * c, 0.3, 0.05, EARTH_CHALK, 0.4, z);
    daubZigzag(g, 4 * c - W / 2, W / 2 - 5 * c, H / 2 - 9.5 * c, 0.035, 18, 0.03, EARTH_RED, 0.3, z);
    rows.forEach(([name, initials, score, mine], i) => {
      const y = H / 2 - (15.5 + i * FAME_ROW) * c, digits = String(score);
      brushWord(g, name, 2 * c - W / 2 + brushWidth(name, h) / 2, y, h, 0.042, EARTH_OCHRE, 0.35, z);
      brushWord(g, initials, 36 * c - W / 2 + brushWidth(initials, h) / 2, y, h, 0.042, mine ? FAME_GOLD : EARTH_CHALK, 0.35, z);
      brushWord(g, digits, W / 2 - 2 * c - brushWidth(digits, h) / 2, y, h, 0.042, mine ? FAME_GOLD : FAME_EMBER, 0.35, z);
    });
    return unshadowed(g);
  };
  const FAME = { w: FAME_W * 0.045, h: (11 + 4 * FAME_ROW) * 0.045 };
  // Its frame: a tablet of the cave's stone, a raised rim carved round the board (deep along the top, narrow at the
  // foot so the board hangs no lower), cave paint glowing on the rim as if firelit: a handprint and a spiral at each
  // end of the top and a zigzag between, spirals down the sides and a red zigzag along the foot. It hangs from the
  // ceiling rock on two leafy lianas with a spray of leaves where each ties on, a bone tusk hooked out under each
  // bottom corner. `bulbs` is the paint.
  const fameFrame = cached(() => {
    const { w, h } = FAME, J = BL.hubModels, rand = mulberry32(5150), top = HALL.h + 0.05 - LAYOUT.fame.y, y0 = h / 2 + 0.4, rim = "#6a5d50";
    const round = [-1, 1].map((sx) => moved(turnedY(turnedZ(boneTusk(0.6, 0.05, 1.8), Math.PI), sx * Math.PI / 2), sx * (w / 2 - 0.05), -h / 2 - 0.12, -0.09));
    const flat = [
      bevelBox({ w: w + 0.4, h: h + 0.52, d: 0.14, color: STONE[1], bevel: 0.05, offset: { y: 0.14, z: -0.1 } }),
      bevelBox({ w: w + 0.4, h: 0.4, d: 0.1, color: rim, bevel: 0.04, offset: { y: h / 2 + 0.2, z: -0.01 } }),
      bevelBox({ w: w + 0.4, h: 0.12, d: 0.1, color: rim, bevel: 0.03, offset: { y: -h / 2 - 0.06, z: -0.01 } }),
      ...[-1, 1].map((sx) => bevelBox({ w: 0.2, h, d: 0.1, color: rim, bevel: 0.03, offset: { x: sx * (w / 2 + 0.1), z: -0.01 } }))
    ];
    const frame = J.withJungle(shaded(round, flat), (g) => {
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 - 0.2);
        J.garland(g, Array.from({ length: 7 }, (_, k) => [x + Math.sin(k * 1.9 + sx) * 0.04, y0 + (top - y0) * k / 6, -0.09 + Math.cos(k * 1.3) * 0.03]), { r: 0.045, every: 0.42, size: 0.24, droop: 0.35, rand });
        J.sprig(g, x, y0, -0.06, sx * 0.8, 0.8, 0.1, 4, 0.26, rand);
      }
    });
    // The paint: ochre, red earth and bone, laid on the rim's face.
    const inks = ["#e8962e", "#cc4a2a", "#f0e4c8"], z = 0.042, paint = (ops, s, x, y) => moved(pictograph(ops, s, inks, 0.45), x, y, z);
    const bulbs = merge(
      ...[-1, 1].flatMap((sx) => [
        paint(sx > 0 ? mirror(PICTOS.hand) : PICTOS.hand, 0.2, sx * 1.72, h / 2 + 0.19),
        paint(PICTOS.spiral, 0.13, sx * 1.3, h / 2 + 0.2),
        ...[-0.45, 0.45].map((y) => paint(PICTOS.spiral, 0.085, sx * (w / 2 + 0.1), y))
      ]),
      paint(zigzag(20, 1), 0.1, 0.045, h / 2 + 0.2),
      paint(zigzag(36, 1), 0.09, 0, -h / 2 - 0.06)
    );
    return { frame, bulbs: unshadowed(bulbs) };
  });
  // The prize shelf by the counter: a timber shelf with a bark log along its front on timber brackets, a board of dark
  // timber behind it with each prize drawn on it in chalk at its slot, lit a little, so the shelf reads as a trophy
  // wall to fill; MY PRIZES brushed in chalk high over it on a timber plank with a bone knob at each end, over the
  // prize counter's lanterns from every side, a liana along the shelf's back and leaves at its ends. The scene stands
  // each prize won on it before its drawing, `PRIZE_SHELF` metres apart.
  const PRIZE_SHELF = 0.55;
  const prizeShelf = cached(() => {
    const { withJungle, liana, sagPoints, sprig, log } = BL.hubModels, leaf = mulberry32(66), y = 0.87;
    const art = geometry(), E = 0.12, ink = EARTH_CHALK, [banana, cup, kazoo, charm, gorilla, crown] = PRIZES.map((_, i) => (i - (PRIZES.length - 1) / 2) * PRIZE_SHELF);
    MARK.banana(art, banana, 0.2, 0.38, 0.3, ink, E);
    MARK.coconut(art, cup, 0.2, 0.38, ink, E);
    daubStroke(art, [[cup + 0.03, 0.3], [cup + 0.1, 0.46]], 0.018, ink, E);
    daubStroke(art, [[kazoo - 0.15, 0.16], [kazoo + 0.15, 0.16]], 0.045, ink, E);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) daubDot(art, kazoo + sx * 0.16, 0.16 + sy * 0.03, 0.035, 0.035, ink, E);
    daubDot(art, charm, 0.17, 0.12, 0.12, ink, E, 0, 0, 16);
    daubSpiral(art, charm, 0.17, 0.05, 0.014, EARTH_OCHRE, E, 0.004);
    daubStroke(art, Array.from({ length: 9 }, (_, k) => [charm + Math.cos(k / 8 * Math.PI * 2) * 0.035, 0.33 + Math.sin(k / 8 * Math.PI * 2) * 0.035]), 0.012, ink, E);
    daubDot(art, gorilla - 0.02, 0.2, 0.13, 0.085, ink, E, 0.35, 0, 14);
    daubDot(art, gorilla + 0.13, 0.19, 0.055, 0.05, ink, E);
    for (const [ax, fx] of [[0.06, 0.11], [0, 0.04]]) daubStroke(art, [[gorilla + ax, 0.22], [gorilla + fx, 0.06]], 0.04, ink, E);
    daubStroke(art, [[gorilla - 0.11, 0.16], [gorilla - 0.13, 0.06]], 0.045, ink, E);
    daubDot(art, crown, 0.14, 0.085, 0.09, ink, E, 0, 0, 12);
    for (let k = 0; k < 7; k++) { const a = (k - 3) * 0.36; daubStroke(art, [[crown + Math.sin(a) * 0.1, 0.26 + Math.cos(a) * 0.06], [crown + Math.sin(a) * 0.27, 0.26 + Math.cos(a) * 0.28]], 0.03, [EARTH_RED, ink, EARTH_OCHRE][k % 3], E); }
    daubStroke(art, [[crown - 0.11, 0.22], [crown + 0.11, 0.22]], 0.05, EARTH_OCHRE, E, 0.004);
    return withJungle(shaded([log(-1.68, 0.005, 0.16, 1.68, 0.005, 0.16, 0.035, "#5a3e24")], [
      bevelBox({ w: 3.3, h: 0.07, d: 0.34, color: TIMBER_LT, bevel: 0.02 }),
      ...[-1.4, 0, 1.4].map((x) => sideShape(ccw([[-0.17, -0.035], [0.15, -0.035], [-0.17, -0.3]]), x, 0.05, TIMBER_DK)),
      bevelBox({ w: 3.3, h: 0.66, d: 0.03, color: TIMBER_DK, bevel: 0.01, offset: { y: 0.37, z: -0.155 } }), moved(art, 0, 0, -0.1385),
      bevelBox({ w: 1.7, h: 0.3, d: 0.05, color: TIMBER, bevel: 0.02, offset: { y, z: -0.14 } }),
      brushWord(geometry(), "MY PRIZES", 0, y, 0.18, 0.03, EARTH_CHALK, 0.35, -0.112),
      ...[-1, 1].map((sx) => moved(ball(0.05, BONE, 8), sx * 0.9, y, -0.12))
    ]), (g) => {
      liana(g, sagPoints(-1.62, 0.07, -0.14, 1.62, 0.07, -0.14, 0.02, 6), 0.022, 0.018);
      for (const sx of [-1, 1]) sprig(g, sx * 1.66, 0.06, -0.12, sx, 0.5, 0.2, 4, 0.3, leaf);
    });
  });
  // Feather-and-leaf bunting high across the hall, on lines at `PENNANT_LINES` (z) clear of the mammoth
  // and the spots: a liana slung from wall to wall on each, big two-tone leaves hanging from it in pairs, a bunch of
  // three long feathers every third in ochre, red earth, bone and charcoal, and leaves where it meets each wall.
  // `BUNTING` is the feathers' tones, [light, dark] rgb, their dark halves lighter than the machines' `FEATHERS`.
  const PENNANT_LINES = [-16.4, -13.9, -0.2];
  const BUNTING = [["#e0a040", "#b8782a"], ["#c8452a", "#96301c"], ["#f0e4c8", "#c8b89a"], ["#4a4038", "#2a221c"]].map((p) => p.map(hexToRgb));
  const pennants = cached(() => {
    const { withJungle, liana, sagPoints, sprig } = BL.hubModels, y = HALL.h - 1.05, leaf = mulberry32(4411);
    return withJungle(null, (g) => {
      for (const z of PENNANT_LINES) {
        const pts = sagPoints(-HALL.halfW - 0.1, y, z, HALL.halfW + 0.1, y, z, 0.55, 30);
        liana(g, pts, 0.022, 0.022, "#2f5424");
        for (let k = 1; k < pts.length - 1; k++) {
          if (k % 3) { sprig(g, ...pts[k], 0, -1, 0, 2, 0.36, leaf); continue; }
          for (let j = -1; j <= 1; j++) leafBlade(g, pts[k][0] + j * 0.03, pts[k][1] - 0.02, z + j * 0.01, j * 0.3, -1, 0, 0, 0, 1, j ? 0.4 : 0.5, 0.55, BUNTING[(k / 3 + j + 4) % BUNTING.length]);
        }
        for (const k of [0, pts.length - 1]) sprig(g, ...pts[k], k ? -1 : 1, -0.4, 0, 3, 0.3, leaf);
      }
    });
  });
  // The spirit rattle over the stage, the Oogas' own: a ring of bone slung from a bridle of three ropes, six small
  // gourds hung round it on short cords, each its own size and drop, a string of two seashells between each two to
  // clack as it turns, and a bigger gourd banded in red earth hung in its middle with three feathers under it. It
  // hangs on a liana through the mammoth's open ribs from its back with a collar of leaves where it ties on, turned
  // slowly by the scene; `ball` is the rattle and `chain` the vine, its lashing and its leaves.
  const RATTLE = { ring: 0.34, apex: 0.36, tones: ["#c68a3e", "#b8a040", "#a86f2c"] };
  const discoBall = cached(() => {
    const { ring, apex, tones } = RATTLE, J = BL.hubModels, rand = mulberry32(809), round = [torus(ring, 0.03, BONE, 0, 20, 6)], cords = [];
    // A gourd hung from its neck at the origin, `s` times the lanterns' gourd, its faces ribbed a shade apart.
    const gourd = (s, tone) => {
      const geo = lathe({ profile: GOURD.map(([r, h]) => [r * s, (h - GOURD[GOURD.length - 1][1]) * s]), segments: 8, color: tone }), rib = hexToRgb(tint(tone, 0.82));
      geo.faces.forEach((f, k) => { if (k % 2) f.color = rib; });
      return geo;
    };
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2, x = Math.cos(a) * ring, z = Math.sin(a) * ring, drop = 0.1 + (k % 3) * 0.05;
      round.push(moved(gourd(0.36 + (k % 2) * 0.06, tones[k % 3]), x, -drop, z));
      cords.push([[x, 0, z], [x, 0.01 - drop, z]]);
      const sx = Math.cos(a + Math.PI / 6) * ring, sz = Math.sin(a + Math.PI / 6) * ring;
      cords.push([[sx, 0, sz], [sx, -0.3, sz]]);
      for (const y of [-0.13, -0.28]) round.push(moved(turnedY(turnedX(seashell(), Math.PI - 1.2), rand() * 6.3), sx, y, sz));
    }
    round.push(moved(gourd(0.62, tones[0]), 0, -0.14, 0), moved(torus(0.128, 0.013, EARTH_RED, 0, 12, 4), 0, -0.39, 0));
    cords.push([[0, apex, 0], [0, -0.13, 0]]);
    const ball = J.withJungle(shaded(round), (g) => {
      for (const pts of cords) J.liana(g, pts, 0.008, 0.008, ROPE);
      for (let k = 0; k < 3; k++) {
        const a = k / 3 * Math.PI * 2 + 0.5, c = Math.cos(a), s = Math.sin(a), l = Math.hypot(0.25, 1);
        J.liana(g, [[c * ring, 0.02, s * ring], [0, apex, 0]], 0.011, 0.011, ROPE);
        J.pointedLeaf(g, 0, -0.48, 0, s * 0.25 / l, -1 / l, c * 0.25 / l, c * 0.35, 0, -s * 0.35, s, 0, c, 0.22, ...FEATHERS[k]);
      }
    });
    const top = MAMMOTH_AT.y + spineAt(LAYOUT.disco.x - MAMMOTH_AT.x) - 0.04 - LAYOUT.disco.y, leaf = mulberry32(808);
    return {
      ball,
      chain: J.withJungle(null, (g) => {
        J.liana(g, [[0, apex - 0.02, 0], [0.04, apex + (top - apex) * 0.35, 0.03], [-0.03, apex + (top - apex) * 0.7, -0.02], [0, top, 0]], 0.035, 0.028, "#2f5424");
        for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; J.sprig(g, Math.cos(a) * 0.05, apex + 0.1, Math.sin(a) * 0.05, Math.cos(a), 0.12, Math.sin(a), 1, 0.3, leaf); }
        tuck(g, J.lashing(0, top - 0.02, 0, 0, 1, 0, 0.1));
      })
    };
  });
  // Talking drums high on the side walls where speakers would hang, angled down into the hall: hollow logs, each with
  // a hide skin stretched over its mouth and a spiral painted on it in red earth, a rope hoop round the skin and rope
  // lacing zigzagging from it back down the log, hung on two lianas from the rock above it, leaves bunched where they
  // leave the rock.
  const speakers = cached(() => {
    const { withJungle, liana, sprig, log } = BL.hubModels, round = [], flat = [], ties = [], laces = [], leaf = mulberry32(3131);
    const toFront = (geo) => turnedX(geo, Math.PI / 2);
    for (const z of [-10.7, -3.9, 2.9]) for (const sx of [-1, 1]) {
      const x = sx * (HALL.halfW - 0.75), y = HALL.h - 2.6, lean = 0.35, turnY = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
      const place = (geo) => moved(turnedY(turnedX(geo, lean), turnY), x, y, z);
      // A point on the drum, in the hall, as `place` stands a part.
      const put = ([px, py, pz]) => {
        const cy = py * Math.cos(lean) - pz * Math.sin(lean), cz = py * Math.sin(lean) + pz * Math.cos(lean);
        return [x + px * Math.cos(turnY) + cz * Math.sin(turnY), y + cy, z - px * Math.sin(turnY) + cz * Math.cos(turnY)];
      };
      round.push(place(log(0, 0, -0.34, 0, 0, 0.34, 0.3, "#5a3a22")), place(moved(toFront(turn([[0.29, 0], [0.2, 0.014], [0, 0.02]], 16, "#dcc393")), 0, 0, 0.342)));
      round.push(place(moved(toFront(torus(0.3, 0.026, "#c9a36a", 0, 14, 4)), 0, 0, 0.34)));
      flat.push(place(moved(pictograph(PICTOS.spiral, 0.2, ["#b8452a", "#b8452a", "#b8452a"], 0), 0, 0, 0.365)));
      laces.push(Array.from({ length: 11 }, (_, k) => { const a = k / 10 * Math.PI * 2; return put([Math.cos(a) * 0.318, Math.sin(a) * 0.318, k % 2 ? -0.2 : 0.33]); }));
      ties.push([x, y + 0.22, z, sx]);
    }
    return withJungle(shaded(round, flat), (g) => {
      for (const pts of laces) liana(g, pts, 0.011, 0.011, "#c9a36a");
      for (const [x, y, z, sx] of ties) {
        for (const d of [-0.16, 0.16]) liana(g, [[x, y, z + d], [x + sx * 0.06, (y + HALL.h) / 2, z + d * 1.2], [x + sx * 0.12, HALL.h + 0.02, z + d * 1.4]], 0.025, 0.02, "#2f5424");
        sprig(g, x + sx * 0.12, HALL.h - 0.1, z, 0, -1, 0, 3, 0.28, leaf);
      }
    });
  });
  // A table's clutter, two variants: coconut cups with reed straws and a banana-leaf plate with bananas on it, or a
  // coconut cup and popcorn in half a coconut shell on a banana leaf; all on the table's slab at `top`.
  const tableProps = variants((i) => {
    const top = 0.822, round = [], flat = [], rand = mulberry32(90);
    const cup = (x, z, c) => {
      round.push(moved(nut("young", 0.07), x, top + 0.07, z));
      flat.push(moved(turnedZ(box({ w: 0.012, h: 0.18, d: 0.012, color: c }), 0.25), x + 0.025, top + 0.2, z));
    };
    // A banana leaf lying flat, `len` long, turned `a` about y: a light and a dark half either side of a pale rib.
    const plate = (x, z, a, len) => {
      const W = len * 0.36, half = (sy, color) => turnedX(prism(ccw([[0, 0], [len * 0.25, sy * 0.35 * W], [len * 0.6, sy * 0.4 * W], [len, 0]]), 0.006, color), -Math.PI / 2);
      flat.push(...[half(1, "#4f8f3a"), half(-1, "#3b7a2c"), box({ w: len * 0.9, h: 0.008, d: 0.01, color: "#9ccf6a", offset: { x: len * 0.45, y: 0.004 } })].map((geo) => moved(turnedY(geo, a), x, top + 0.004, z)));
    };
    if (i) {
      cup(0.15, 0.2, "#cdb06a");
      plate(-0.02, 0.1, 2.8, 0.4);
      round.push(...[lathe({ profile: [[0.03, 0], [0.09, 0.015], [0.115, 0.06], [0.112, 0.09]], segments: 12, color: "#6b4a26" }), lathe({ profile: [[0.112, 0.09], [0.1, 0.09], [0.095, 0.06], [0.07, 0.03], [0, 0.028]], segments: 12, color: "#efe2c4" })].map((geo) => moved(geo, -0.18, top + 0.008, -0.05)));
      for (let k = 0; k < 10; k++) round.push(moved(ball(0.021, k % 3 ? "#fff3d6" : "#f2dca6", 5), -0.18 + (rand() - 0.5) * 0.14, top + 0.08 + rand() * 0.03, -0.05 + (rand() - 0.5) * 0.14));
    } else {
      cup(0.2, -0.1, "#cdb06a");
      cup(-0.15, 0.22, "#b8a04a");
      plate(0.1, -0.12, 2.9, 0.46);
      const banana = BL.models.bananaGeometry();
      for (let k = 0; k < 2; k++) flat.push(moved(turnedY(scaled(banana, 0.5), 0.6 + k * 0.5), -0.12 + k * 0.06, top + 0.03, -0.16 - k * 0.03));
    }
    return shaded(round, flat);
  });
  // A trash bin: a coiled basket, its coils in two close straw tones, with a rope rim and a coiled lid, a banana peel
  // flopped over the lid. And a ticket bucket: half a big coconut shell, fibre-streaked outside and cream inside, half
  // full of bark tickets with a leaf tucked in among them.
  const coiled = (geo, segments, a, b) => {
    const A = hexToRgb(a), B = hexToRgb(b);
    geo.faces.forEach((f, k) => { f.color = Math.floor(k / segments) % 2 ? A : B; });
    return geo;
  };
  const trashBin = cached(() => {
    const basket = lathe({ profile: Array.from({ length: 13 }, (_, k) => [0.26 + k * 0.0035, k * 0.86 / 12]), segments: 16, color: "#000000" });
    const lid = lathe({ profile: [[0.32, 0], [0.29, 0.06], [0.22, 0.12], [0.1, 0.16], [0, 0.17]], segments: 16, color: "#000000" });
    return shaded([coiled(basket, 16, "#b88a3e", "#a67c38"), moved(torus(0.3, 0.02, "#c9a36a", 0, 16, 5), 0, 0.86, 0), moved(coiled(lid, 16, "#c49a4a", "#a67c38"), 0, 0.86, 0)], [moved(turnedZ(scaled(BL.models.bananaGeometry(), 0.5), 1.4), 0.05, 1.05, 0)]);
  });
  const ticketBucket = cached(() => {
    const { withJungle, sprig } = BL.hubModels, rand = mulberry32(12), leaf = mulberry32(13), flat = [], [base, streak, fleck] = NUTS.husk.slice(0, 3).map(hexToRgb);
    for (let k = 0; k < 9; k++) flat.push(moved(turnedY(turnedZ(box({ w: 0.06, h: 0.16, d: 0.004, color: k % 2 ? "#efe2c4" : "#c0583a" }), (rand() - 0.5) * 1.2), rand() * 3), (rand() - 0.5) * 0.14, 0.34, (rand() - 0.5) * 0.14));
    const shell = lathe({ profile: [[0, 0], [0.1, 0.012], [0.155, 0.08], [0.172, 0.18], [0.168, 0.28], [0.152, 0.36]], segments: 14, color: "#000000" });
    shell.faces.forEach((f, k) => { const p = Math.floor(k / 14), s = k % 14; f.color = s % 3 === 0 && p > 0 ? streak : (s * 5 + p) % 7 === 0 ? fleck : base; });
    const inside = lathe({ profile: [[0.152, 0.36], [0.142, 0.372], [0.132, 0.36], [0.148, 0.28], [0.14, 0.2], [0, 0.19]], segments: 14, color: "#efe2c4" });
    return withJungle(shaded([shell, inside], flat), (g) => sprig(g, 0.05, 0.3, -0.04, 0.3, 1, -0.2, 2, 0.12, leaf));
  });
  // The directory by the doorway: a map of the hall painted on a dark stone slab as an Ooga walking in sees it, the
  // back wall at the top. The stage is the stump's rings in the middle with the four games on it, the doorway an arch
  // at the foot with a red handprint right of it where the slab stands, and chalk footprints walk out from them to each
  // zone's pictograph with its word brushed under or beside it: the dunking Ooga to the right (THRO), coconuts on
  // posts to the left (TOSS), the claw with its coconut at the back (GRAB), left of the doorway a banana (LOOT) and on
  // along the front wall a cooking fire (SNAK), and right of it a baby mammoth for the rides (RIDE). A bone knob at each
  // corner, a liana draped along its top and down one side, and leaves bunched at its top corners.
  const directory = cached(() => {
    const W = 76 * 0.03 + 0.24, H = 52 * 0.03 + 0.24, { withJungle, liana, sagPoints, sprig } = BL.hubModels, leaf = mulberry32(44), g = geometry(), e = 0.4, z = 0.004;
    // A closed ring of `n` + 1 points round (x, y) for a stroke to follow; the kit's `oval` is an open outline.
    const oval = (x, y, rx, ry, n) => Array.from({ length: n + 1 }, (_, k) => [x + Math.cos(k / n * Math.PI * 2) * rx, y + Math.sin(k / n * Math.PI * 2) * ry]);
    const word = (s, x, y) => brushWord(g, s, x, y, 0.1, 0.02, EARTH_CHALK, 0.5, z);
    // Footprints along a path, left and right in turn, each turned to the way it walks.
    const trail = (pts) => {
      let side = 1;
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, ay] = pts[k], [bx, by] = pts[k + 1], len = Math.hypot(bx - ax, by - ay), hx = (bx - ax) / len, hy = (by - ay) / len;
        for (let d = 0.04; d < len - 0.02; d += 0.075, side = -side) MARK.foot(g, ax + hx * d - hy * side * 0.018, ay + hy * d + hx * side * 0.018, 0.05, Math.atan2(-hx, hy), EARTH_CHALK, e * 0.8, z);
      }
    };
    // The stage: the stump's bark ring, a growth ring and its heart, and the four games standing on it.
    daubStroke(g, oval(0, -0.1, 0.29, 0.2, 28), 0.034, EARTH_OCHRE, e, z);
    daubStroke(g, oval(0, -0.1, 0.17, 0.115, 20), 0.016, EARTH_OCHRE, e, z);
    daubDot(g, 0, -0.1, 0.03, 0.022, EARTH_OCHRE, e, 0, z, 8);
    for (let k = 0; k < 4; k++) { const x = (k - 1.5) * 0.085; daubPoly(g, [[x - 0.025, -0.02], [x + 0.025, -0.02], [x + 0.025, 0.045], [x - 0.025, 0.045]], EARTH_CHALK, e, z + 0.002); }
    // The doorway and where the slab stands by it.
    daubStroke(g, [[-0.13, -0.84], [-0.13, -0.74], [-0.09, -0.68], [0, -0.66], [0.09, -0.68], [0.13, -0.74], [0.13, -0.84]], 0.03, EARTH_CHALK, e, z);
    daubHand(g, 0.38, -0.8, 0.15, -0.1, "#c8583a", 0.5, z);
    trail([[0, -0.66], [0, -0.33]]);
    trail([[0, 0.12], [0, 0.42]]);
    trail([[0.3, -0.12], [0.52, -0.08]]);
    trail([[-0.3, -0.12], [-0.5, -0.08]]);
    trail([[-0.12, -0.66], [-0.28, -0.55]]);
    trail([[-0.5, -0.52], [-0.72, -0.52]]);
    trail([[0.12, -0.66], [0.24, -0.58]]);
    // The zones: THRO, TOSS, GRAB, LOOT, SNAK and RIDE.
    MARK.dunk(g, 0.62, -0.19, 0.3, EARTH_OCHRE, e, z);
    word("THRO", 0.7, -0.3);
    for (let k = 0; k < 3; k++) {
      const x = -0.8 + k * 0.12;
      daubStroke(g, [[x, -0.16], [x, 0.0]], 0.018, EARTH_CHALK, e, z);
      MARK.coconut(g, x, 0.045, 0.13, EARTH_RED, e, z);
    }
    word("TOSS", -0.68, -0.3);
    daubStroke(g, [[0, 0.82], [0, 0.66]], 0.014, EARTH_CHALK, e, z);
    daubDot(g, 0, 0.645, 0.04, 0.028, EARTH_OCHRE, e, 0, z + 0.002, 8);
    for (const s of [-1, 1]) daubStroke(g, [[s * 0.02, 0.63], [s * 0.085, 0.57], [s * 0.075, 0.5], [s * 0.04, 0.47]], 0.018, EARTH_OCHRE, e, z);
    MARK.coconut(g, 0, 0.5, 0.11, EARTH_RED, e, z + 0.004);
    word("GRAB", 0.34, 0.6);
    MARK.banana(g, -0.38, -0.52, 0.18, 0.3, EARTH_OCHRE, e, z);
    word("LOOT", -0.4, -0.72);
    MARK.fire(g, -0.86, -0.52, 0.16, e, z);
    word("SNAK", -0.88, -0.72);
    MARK.mammoth(g, 0.34, -0.6, 0.2, EARTH_OCHRE, e, z);
    word("RIDE", 0.78, -0.54);
    const board = merge(bevelBox({ w: W, h: H, d: 0.1, color: "#4a423b", bevel: 0.05, offset: { z: -0.06 } }), g,
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => moved(ball(0.05, BONE, 8), sx * W / 2, sy * H / 2, 0)));
    return withJungle(board, (gr) => {
      liana(gr, [...sagPoints(-W / 2, H / 2 + 0.02, 0.02, W / 2, H / 2 + 0.02, 0.02, 0.05, 6), [W / 2 + 0.03, H / 4, 0.03], [W / 2 + 0.02, -H / 6, 0.03]], 0.025, 0.02);
      for (const sx of [-1, 1]) sprig(gr, sx * W / 2, H / 2, 0.03, sx, 0.6, 0.3, 3, 0.28, leaf);
      sprig(gr, W / 2 + 0.02, -H / 6, 0.03, 0.4, -1, 0.3, 2, 0.22, leaf);
    });
  });
  // The back room's door, closed for good: rough logs stood side by side and bound with two ropes, in a frame of
  // stone slabs, a bone ring for a handle, a peephole barred with bones, crossed bones pegged on under a timber plank
  // brushed in chalk with where the poker is not; a coconut-shell lantern sitting on the lintel, its carved holes glowing
  // so the sign reads in the dark under the deck; and a liana draped along the lintel and down the frame's outer
  // side, leaves bunched at the lintel's ends.
  const backDoor = cached(() => {
    const { withJungle, liana, sagPoints, sprig, log } = BL.hubModels, round = [], flat = [], w = 1.3, h = 2.2, leaf = mulberry32(23);
    for (const sx of [-1, 1]) flat.push(bevelBox({ w: 0.2, h: h + 0.1, d: 0.26, color: "#6b625a", bevel: 0.05, offset: { x: sx * (w / 2 + 0.1), y: (h + 0.1) / 2, z: 0.02 } }));
    flat.push(bevelBox({ w: w + 0.44, h: 0.24, d: 0.28, color: "#5d5650", bevel: 0.06, offset: { y: h + 0.1, z: 0.02 } }));
    for (let k = 0; k < 5; k++) { const x = -w / 2 + (k + 0.5) * w / 5; round.push(log(x, 0, 0, x, h, 0, w / 10 + 0.004, k % 2 ? "#5a3e24" : "#6b4a2b")); }
    round.push(moved(turnedX(torus(0.07, 0.016, BONE, 0, 12, 5), Math.PI / 2), 0.4, 1.0, 0.16), moved(turnedX(turn([[0.025, 0], [0.025, 0.05], [0, 0.05]], 8, TIMBER_DK), Math.PI / 2), 0.4, 1.08, 0.12));
    flat.push(box({ w: 0.3, h: 0.2, d: 0.04, color: "#0b0a10", offset: { y: 1.95, z: 0.12 } }));
    for (const x of [-0.09, 0, 0.09]) round.push(moved(turnedZ(boneBar(0.2, 0.011), Math.PI / 2), x, 1.95, 0.15));
    // Pegged across the door and its frame, so the frame's slabs never cover its ends.
    flat.push(bevelBox({ w: 1.66, h: 0.38, d: 0.05, color: TIMBER, bevel: 0.02, offset: { y: 1.55, z: 0.18 } }));
    for (const sx of [-1, 1]) round.push(moved(ball(0.022, TIMBER_DK, 6), sx * 0.76, 1.55, 0.21));
    const words = brushWord(geometry(), "NO POKER HERE!", 0, 1.625, 0.12, 0.02, EARTH_CHALK, 0.35, 0.207);
    flat.push(brushWord(words, "(MAYBE SOMEWHERE ELSE?)", 0, 1.465, 0.066, 0.012, EARTH_CHALK, 0.3, 0.207));
    for (const sx of [-1, 1]) round.push(moved(turnedZ(boneBar(0.5, 0.025), sx * 0.6), 0, 0.8, 0.16));
    // The lantern: a coconut on the lintel, holes carved round its front with the fire glowing through them.
    const lamp = { y: h + 0.31, z: 0.08 };
    round.push(moved(nut("husk", 0.09), 0, lamp.y, lamp.z));
    [[-1.1, 0], [-0.55, 0], [0, 0], [0.55, 0], [1.1, 0], [-0.3, 0.5], [0.3, 0.5]].forEach(([a, t]) => {
      const nx = Math.sin(a) * Math.cos(t), ny = Math.sin(t), nz = Math.cos(a) * Math.cos(t);
      round.push(along(glowing(lathe({ profile: [[0.016, 0], [0, 0.003]], segments: 6, color: "#ffc060" }), 1), nx * 0.092, lamp.y + ny * 0.092, lamp.z + nz * 0.092, nx, ny, nz));
    });
    return withJungle(shaded(round, flat), (g) => {
      for (const y of [0.35, 1.25]) liana(g, [[-w / 2 - 0.02, y, 0.135], [w / 2 + 0.02, y, 0.135]], 0.022, 0.022, "#c9a36a");
      liana(g, [...sagPoints(-0.86, h + 0.2, 0.18, 0.86, h + 0.2, 0.18, 0.06, 6), [0.9, h - 0.3, 0.16], [0.92, 1, 0.15]], 0.03, 0.02);
      for (const sx of [-1, 1]) sprig(g, sx * 0.84, h + 0.18, 0.19, sx, -0.3, 0.5, 3, 0.26, leaf);
      sprig(g, 0.92, 1.3, 0.17, 1, 0.2, 0.4, 2, 0.24, leaf);
    });
  });
  // Worn ground before a popular machine: a ragged scuff of darker earth, see-through, lying a few millimetres over
  // what the scene lays it on (the stage's sawn top, or the floor's mats at `MAT_Y`).
  const wornPatch = cached(() => {
    const geo = geometry(), rand = mulberry32(77), rim = [];
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2, r = 0.55 + rand() * 0.25; rim.push(pushVert(geo, Math.cos(a) * r, 0.006, Math.sin(a) * r * 0.85)); }
    face(geo, facing(geo, [pushVert(geo, 0, 0.006, 0), ...rim, rim[0]], UP), hexToRgb("#1a0f07"));
    return glassy(geo, 0.3);
  });

  // ---- pool, darts and the horse -------------------------------------------------------------------------
  // A pool table in its frame, long along x, played from +z: `POOL` is its bed (top at `y`, `L` by `W`, the six
  // pockets). A slab of warm carved stone with a zigzag painted in ochre down each long side, on two turned stone
  // pedestals with ferns at their feet and teal mushrooms under its corners; a bed of moss in big soft patches, its
  // cushions moss too; bark log rails broken at the pockets with
  // bone diamonds along their tops; and dark pocket cups in half coconut shells (a husk rim round a lip of pale meat).
  // Its `glow` holds the lamp's flames, and `lamp` the lamp (`poolLamp`), a geometry of its own so the body, the
  // hall's pick target, stays round the table. `felt` picks the moss.
  const POOL = { L: 2.24, W: 1.12, y: 0.8, r: 0.03, pocket: 0.066 };
  POOL.pockets = [[-1, -1], [0, -1], [1, -1], [-1, 1], [0, 1], [1, 1]].map(([u, v]) => [u * (POOL.L / 2 + (u ? 0.012 : 0)), v * (POOL.W / 2 + 0.018)]);
  // The pool lamp over a table's middle in its frame, hung clear of the player's view: a bamboo bar lashed where two
  // lianas tie on and climb to the rock overhead `up` along z, leaves sprouting along the bar, and two coconut oil
  // lamps hung from it on three cords each: half a shell, husk outside, cupped open to the room so its pale meat
  // shows round the flame burning in it at `POOL_LAMP_Y`, three holes carved in its underside glowing down on the
  // table. One per `up`, so tables under the same spot share it.
  const POOL_LAMP_Y = 2.25, poolLamps = new Map();
  const poolLamp = (up) => {
    let geo = poolLamps.get(up);
    if (geo) return geo;
    const { withJungle, liana, sprig, lashing } = BL.hubModels, ly = POOL_LAMP_Y, bar = ly + 0.36, streak = hexToRgb("#5a3c20"), rand = mulberry32(5300);
    const round = [bambooRun(-0.75, bar, 0, 0.75, bar, 0, 0.03)], cupped = (geo, sx) => moved(turnedX(geo, Math.PI), sx * 0.45, ly, 0);
    for (const sx of [-1, 1]) {
      const shell = turn([[0.22, 0], [0.214, 0.07], [0.17, 0.15], [0.09, 0.2], [0, 0.215]], 14, "#7e5630");
      shell.faces.forEach((f, k) => { if (k % 14 % 3 === 0) f.color = streak; });
      round.push(lashing(sx * 0.62, bar, 0, 1, 0, 0, 0.03), cupped(shell, sx), cupped(turn([[0, 0.195], [0.08, 0.182], [0.155, 0.135], [0.198, 0.06], [0.205, 0], [0.22, 0]], 14, "#ecd8ae", 0.25), sx));
      for (let k = 0; k < 3; k++) {
        const a = (k + 0.5) / 3 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        round.push(cupped(along(glowing(lathe({ profile: [[0.02, 0], [0, 0.003]], segments: 6, color: "#ffc060" }), 1), c * 0.14, 0.17, s * 0.14, c * 0.62, 0.78, s * 0.62), sx));
      }
    }
    geo = withJungle(shaded(round), (g) => {
      for (const sx of [-1, 1]) {
        liana(g, [[sx * 0.62, bar, 0], [sx * 0.6, bar + 2.6, up * 0.35], [sx * 0.63, bar + 5.2, up * 0.7], [sx * 0.62, HALL.h + 0.02, up]], 0.016, 0.022);
        for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + 0.5; liana(g, [[sx * 0.45 + Math.cos(a) * 0.215, ly + 0.005, Math.sin(a) * 0.215], [sx * 0.45, bar - 0.02, 0]], 0.008); }
        sprig(g, sx * 0.74, bar, 0, sx, -0.25, 0.2, 3, 0.22, rand);
      }
      sprig(g, 0, bar + 0.02, 0, 0, 1, 0.15, 5, 0.24, rand);
      sprig(g, -0.2, bar, 0.02, -0.3, -0.5, 1, 2, 0.18, rand);
      sprig(g, 0.22, bar, -0.02, 0.3, -0.5, -1, 2, 0.18, rand);
    });
    poolLamps.set(up, geo);
    return geo;
  };
  // The lamp's flames, the same over every table: one geometry, so they draw as one.
  const poolFlames = cached(() => {
    const lit = [];
    for (const sx of [-1, 1]) lit.push(moved(turn([[0, 0], [0.05, 0.035], [0.042, 0.09], [0, 0.16]], 8, "#ffb347"), sx * 0.45, POOL_LAMP_Y - 0.06, 0), moved(turn([[0, 0], [0.028, 0.03], [0.022, 0.07], [0, 0.11]], 6, "#fff0c0"), sx * 0.45, POOL_LAMP_Y - 0.05, 0));
    const glow = unshadowed(merge(...lit));
    for (const f of glow.faces) f.emissive = 1;
    return glow;
  });
  const poolTable = variants((i) => {
    const { log, withJungle, sprig } = BL.hubModels;
    const { L, W, y } = POOL, felt = i ? "#3f6a3a" : "#4a7a2e", round = [], flat = [], streak = hexToRgb("#4e3419"), meat = hexToRgb(CREAM), rand = mulberry32(5310 + i);
    flat.push(bevelBox({ w: L + 0.34, h: 0.18, d: W + 0.34, color: "#7e7266", bevel: 0.03, offset: { y: y - 0.13 } }));
    for (const sz of [-1, 1]) flat.push(moved(turnedY(daubZigzag(geometry(), -(L + 0.1) / 2, (L + 0.1) / 2, 0, 0.035, 12, 0.022, "#d9a53a", 0.15, 0.002), sz > 0 ? 0 : Math.PI), 0, y - 0.13, sz * (W / 2 + 0.171)));
    for (const sx of [-1, 1]) round.push(moved(turn([[0.3, 0], [0.32, 0.06], [0.24, 0.2], [0.2, 0.36], [0.24, 0.5], [0.34, y - 0.2], [0, y - 0.2]], 12, "#7a716a"), sx * (L / 2 - 0.36), 0, 0));
    // The moss, mottled lighter and darker in a dozen big soft patches, each a hair over the last.
    flat.push(box({ w: L, h: 0.02, d: W, color: felt, offset: { y: y - 0.01 } }));
    const moss = geometry(), tones = [tint(felt, 1.1), tint(felt, 0.9)].map(hexToRgb);
    for (let k = 0; k < 12; k++) {
      const cx = (rand() - 0.5) * (L - 0.7), cz = (rand() - 0.5) * (W - 0.55), q = 0.12 + rand() * 0.1, t0 = rand() * 3;
      face(moss, Array.from({ length: 9 }, (_, j) => { const a = t0 - j / 9 * Math.PI * 2; return pushVert(moss, cx + Math.cos(a) * q * 1.3, y + 0.002 + k * 0.0003, cz + Math.sin(a) * q); }), tones[k % 2]);
    }
    flat.push(moss);
    // Log rails and moss cushions, broken at the pockets.
    const rail = (x0, x1, z, horiz) => {
      const len = Math.abs(x1 - x0) - 0.12, mid = (x0 + x1) / 2, s = Math.sign(z);
      if (horiz) {
        flat.push(box({ w: len, h: 0.05, d: 0.05, color: felt, offset: { x: mid, y: y + 0.02, z: z - s * 0.025 } }));
        round.push(log(mid - len / 2 - 0.04, y - 0.012, z + s * 0.075, mid + len / 2 + 0.04, y - 0.012, z + s * 0.075, 0.075, "#5a3e24"));
      } else {
        flat.push(box({ w: 0.05, h: 0.05, d: len, color: felt, offset: { x: z - s * 0.025, y: y + 0.02, z: mid } }));
        round.push(log(z + s * 0.075, y - 0.012, mid - len / 2 - 0.04, z + s * 0.075, y - 0.012, mid + len / 2 + 0.04, 0.075, "#5a3e24"));
      }
    };
    for (const sz of [-1, 1]) { rail(-L / 2, 0, sz * W / 2, true); rail(0, L / 2, sz * W / 2, true); }
    for (const sx of [-1, 1]) rail(-W / 2, W / 2, sx * L / 2, false);
    for (const [px, pz] of POOL.pockets) {
      const rim = torus(POOL.pocket + 0.01, 0.012, "#6b4a26", 0, 12, 4);
      rim.faces.forEach((f, k) => { if (Math.floor(k / 12) === 1) f.color = meat; else if (k % 3 === 0) f.color = streak; });
      round.push(moved(turn([[POOL.pocket, 0.02], [POOL.pocket * 0.8, -0.1], [0, -0.1]], 12, "#140c06"), px, y, pz), moved(rim, px, y + 0.05, pz));
    }
    // Bone diamonds along the logs' tops, each a shaft between two knuckled ends.
    const bone = (x, z, across) => flat.push(...[box({ w: 0.03, h: 0.006, d: 0.008, color: BONE }), ...[-1, 1].map((s) => box({ w: 0.008, h: 0.007, d: 0.02, color: BONE, offset: { x: s * 0.015 } }))].map((p) => moved(across ? turnedY(p, Math.PI / 2) : p, x, y + 0.064, z)));
    for (let k = 1; k < 8; k++) if (k !== 4) for (const sz of [-1, 1]) bone(-L / 2 + k * L / 8, sz * (W / 2 + 0.075), false);
    for (let k = 1; k < 4; k++) for (const sx of [-1, 1]) bone(sx * (L / 2 + 0.075), -W / 2 + k * W / 4, true);
    flat.push(box({ w: 0.012, h: 0.003, d: 0.012, color: "#f6ecd2", offset: { x: -L / 4, y: y + 0.006 } }));
    // The lamp's flames (`poolFlames`); `up` is where its lianas meet the rock over the table, in the table's frame.
    const up = BAY_Z + 3.4 * Math.round((LAYOUT.pools[i].z - BAY_Z) / 3.4) - LAYOUT.pools[i].z, glow = poolFlames();
    // Ferns at the pedestals' feet, and under each corner of the slab a clump of glowing teal mushrooms by a fern tuft,
    // low under the rail and out of the game's view.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let j = 0; j < 3; j++) {
      const x = sx * (1.16 + j * 0.05), z = sz * (0.6 - (j % 2) * 0.09), h = [0.13, 0.19, 0.1][j], s = [0.045, 0.06, 0.035][j];
      round.push(moved(turn([[0.014, 0], [0.011, h], [0, h]], 6, "#cfe8e0", 0.3), x, 0, z), moved(lathe({ profile: [[0, h - 0.01], [s, h - 0.004], [s * 0.9, h + s * 0.35], [s * 0.5, h + s * 0.7], [0, h + s * 0.8]], segments: 8, color: "#46e0d0", emissive: 1 }), x, 0, z));
    }
    const body = withJungle(shaded(round, flat), (g) => {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) sprig(g, sx * (L / 2 - 0.36) + sx * 0.2, 0.02, sz * 0.24, sx * 0.4, 0.9, sz * 0.7, 3, 0.26, rand);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) sprig(g, sx * 1.2, 0.02, sz * 0.6, sx * 0.4, 1, sz * 0.3, 3, 0.2, rand);
    });
    return { body, glow, lamp: poolLamp(up) };
  });
  // Pool balls, painted coconuts with a number spot: 0 the peeled cue coconut, 1-7 the colours, 8 the charred one.
  // `poolCue` is the cue, butt at the origin along +z: a stout dry cane and a slimmer green one lashed where they
  // join, and a bone tip. `poolDot` is a bead of the aim guide, a small smooth cream dot.
  const POOL_COLORS = ["#f6ecd2", "#e8b82a", "#2f5ab8", "#c8302a", "#6a3a8a", "#e8762a", "#2f7a44", "#8a2a1c", "#141418"];
  const poolBall = variants((k) => coconutBall(k === 0 ? "cue" : k === 8 ? "charred" : POOL_COLORS[k], POOL.r, k > 0));
  const poolCue = cached(() => {
    const { bamboo, lashing } = BL.hubModels;
    return shaded([
      bamboo(0, 0, 0, 0, 0, 0.74, 0.016, "#cdb06a"), bamboo(0, 0, 0.72, 0, 0, 1.42, 0.0105), lashing(0, 0, 0.73, 0, 0, 1, 0.016),
      moved(turnedX(turn([[0.0105, 0], [0.0105, 0.025], [0.008, 0.036], [0, 0.04]], 8, BONE), Math.PI / 2), 0, 0, 1.42)
    ]);
  });
  const poolDot = cached(() => smooth(lathe({ profile: [[0, -0.0065], [0.0046, -0.0046], [0.0065, 0], [0.0046, 0.0046], [0, 0.0065]], segments: 8, color: CREAM, emissive: 0.5 })));
  // The pocket the guided shot drops in, lit: a ring of glowing banana gold lying flat, hung over its mouth.
  const poolRing = cached(() => unshadowed(torus(POOL.pocket + 0.02, 0.009, "#ffd23a", 1, 20, 5)));
  // A dart board on a stretched hide, facing +z with its bull at the origin: `DART` holds its rings (metres from the
  // bull) and the sectors' order; 20 at the top. The face of a sawn log: its beds painted in umber and ochre in turn
  // over its growth rings, which show through the paint, the doubles and trebles chains of red-earth and bone dots,
  // a red-earth ring round a bone bull, every ring a little out of round; the log checked with splits and pocked
  // with old spear holes, a pale ring of sapwood round the beds, then a broad rim of bark running out of round with
  // the numbers chalked small on it; behind it
  // a buckskin laced into a frame of four bark poles lashed at the corners, brushed in cave paint (DARTS over a red
  // handprint on the left, OOGA over a charcoal Ooga with a spear on the right, a zigzag under each); two tusks
  // cradling the log's upper rim, a liana laid along the frame's top and leaves spilling off its outer corners: all
  // of it above the board's middle (clear of the view below), off the log's face, and under and beside the
  // scoreboards the game hangs over the frame.
  const DART = { y: 1.73, oche: 2.37, bull: 0.0064, outer: 0.016, tIn: 0.099, tOut: 0.107, dIn: 0.162, dOut: 0.17, r: 0.225, order: [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5] };
  // Painted by hand, every ring runs out of round, the same way at the same radius: where the ring `r` (board units)
  // is painted at angle `a` (clockwise from the 20), in metres from the bull at the board's scale. The game scores
  // by it, so a dart counts in the bed it is seen in.
  DART.hand = (a, r) => r * 1.4 * (1 + Math.sin(a * 3 + r * 40) * 0.03 + Math.sin(a * 7 - r * 25) * 0.018);
  const dartBoard = cached(() => {
    const { withJungle, liana, sprig, sagPoints, log, lashing } = BL.hubModels, rand = mulberry32(5400);
    // A ring `n` pieces a sector.
    const K = 1.4, parts = [], round = [], byHand = DART.hand;
    const ring = (r0, r1, a0, a1, color, n = 3) => {
      const geo = geometry(), rgb = hexToRgb(color);
      for (let k = 0; k < n; k++) {
        const b0 = a0 + (a1 - a0) * k / n, b1 = a0 + (a1 - a0) * (k + 1) / n, at = (a, r) => pushVert(geo, Math.sin(a) * byHand(a, r), Math.cos(a) * byHand(a, r), 0.012);
        face(geo, [at(b0, r0), at(b1, r0), at(b1, r1), at(b0, r1)], rgb, { emissive: 0.06 });
      }
      return geo;
    };
    // Each single bed is split in growth rings a shade apart, so the log's rings show through its paint; the doubles
    // and trebles are chains of dots, red earth and bone by turns, on a band a shade darker than their bed.
    const RINGS = [["#6a4a2e", "#5e4128"], ["#b8863e", "#a87a38"]], chalk = geometry(), dots = geometry();
    const rings = (r0, r1, n, a0, a1, tones) => { for (let k = 0; k < n; k++) parts.push(ring(r0 + (r1 - r0) * k / n, r0 + (r1 - r0) * (k + 1) / n, a0, a1, tones[k % 2])); };
    const chain = (r0, r1, a0, a1, n, color) => {
      const r = (r0 + r1) / 2;
      for (let k = 0; k < n; k++) { const a = a0 + (a1 - a0) * (k + 0.5) / n; daubDot(dots, Math.sin(a) * byHand(a, r), Math.cos(a) * byHand(a, r), 0.0068, 0.0062, color, 0.08, a, 0.0126, 7); }
    };
    for (let i = 0; i < 20; i++) {
      const a0 = (i - 0.5) / 20 * Math.PI * 2, a1 = (i + 0.5) / 20 * Math.PI * 2, dark = i % 2 === 0, mid = i / 20 * Math.PI * 2, band = dark ? "#523822" : "#8e6630";
      rings(DART.outer, DART.tIn, 5, a0, a1, RINGS[dark ? 0 : 1]); parts.push(ring(DART.tIn, DART.tOut, a0, a1, band));
      rings(DART.tOut, DART.dIn, 3, a0, a1, RINGS[dark ? 0 : 1]); parts.push(ring(DART.dIn, DART.dOut, a0, a1, band));
      chain(DART.tIn, DART.tOut, a0, a1, 3, dark ? "#a8442a" : "#e8dcc0");
      chain(DART.dIn, DART.dOut, a0, a1, 4, dark ? "#a8442a" : "#e8dcc0");
      brushWord(chalk, String(DART.order[i]), Math.sin(mid) * 0.29, Math.cos(mid) * 0.29, 0.036, 0.0065, EARTH_CHALK, 0.12, 0.013);
    }
    parts.push(ring(DART.bull, DART.outer, 0, Math.PI * 2, "#a8442a", 16), ring(0, DART.bull, 0, Math.PI * 2, "#e8dcc0", 12), chalk, dots);
    // The log's checks, dark splits running in jagged from its bark and narrowing as they go, and a few old spear
    // holes, each a dark pit in a ring of pale splinters.
    const scars = geometry();
    for (const [a, r0, r1, wd] of [[2.6, 0.22, 0.372, 0.012], [4.4, 0.27, 0.372, 0.012], [0.9, 0.3, 0.372, 0.009]]) {
      const s = Math.sin(a), c = Math.cos(a), pts = [];
      for (let k = 0; k <= 4; k++) { const r = r1 - (r1 - r0) * k / 4, j = k % 2 ? 0.007 : -0.004; pts.push([s * r + c * j, c * r - s * j]); }
      daubTaper(scars, pts, (t) => wd * (1 - t) + 0.001, "#2a1a10", 0, 0.0134);
    }
    for (let k = 0; k < 6; k++) {
      const a = rand() * Math.PI * 2, r = 0.05 + rand() * 0.28, x = Math.sin(a) * r, y = Math.cos(a) * r, s = 0.005 + rand() * 0.004;
      daubDot(scars, x, y, s * 1.7, s * 1.5, "#c8a878", 0, a, 0.0132, 7);
      daubDot(scars, x, y, s, s, "#1a100a", 0, 0, 0.0136, 6);
    }
    parts.push(scars);
    // The log's face, one band a colour from the edge in: bark round its side and edge, a dark furrow, the broad bark
    // rim the numbers are chalked on, running out of round, a pale ring of sapwood, and the heartwood under the beds.
    const slice = lathe({ profile: [[0.37, -0.03], [0.37, 0.004], [0.35, 0.011], [0.335, 0.011], [0.246, 0.011], [0.24, 0.011], [0, 0.011]], segments: 40, color: "#000000" });
    const grain = ["#4a3420", "#5a3c22", "#33241a", "#5e4128", "#d8b47a", "#b88a52"].map(hexToRgb), bark = hexToRgb("#3a2818");
    slice.faces.forEach((f, k) => { const band = Math.floor(k / 40); f.color = band < 3 && k % 3 === 0 ? bark : grain[band]; });
    for (let k = 0, v = slice.verts; k < v.length; k += 3) {
      const d = Math.hypot(v[k], v[k + 2]), a = Math.atan2(v[k + 2], v[k]), f = 1 + Math.max(0, d - 0.24) / 0.13 * (Math.sin(a * 2 + 0.7) * 0.04 + Math.sin(a * 5 + 2) * 0.02);
      v[k] *= f; v[k + 2] *= f;
    }
    parts.push(turnedX(slice, Math.PI / 2));
    // The buckskin in its frame of poles, and its paint a few millimetres proud of it.
    const W = 1.96, H = 1.0, art = geometry();
    round.push(moved(hide(W, H, "buck", 5401), 0, 0, -0.05));
    for (const y of [-0.5, 0.49]) round.push(log(-1.06, y, -0.02, 1.06, y, -0.02, 0.034, "#5a3e24"));
    for (const x of [-0.99, 0.99]) round.push(log(x, -0.6, -0.035, x, 0.58, -0.035, 0.034, "#5a3e24"));
    for (const x of [-0.99, 0.99]) for (const y of [-0.5, 0.49]) round.push(lashing(x, y, -0.025, 0, 1, 0, 0.038));
    brushWord(art, "DARTS", -0.68, 0.3, 0.11, 0.02, "#b8402e", 0.25);
    brushWord(art, "OOGA", 0.68, 0.3, 0.11, 0.02, "#b8402e", 0.25);
    daubHand(art, -0.7, -0.22, 0.28, 0.12, "#b8402e", 0.22);
    MARK.ooga(art, 0.72, -0.22, 0.29, "spear", "#2a1c12", 0.02, 0, -1);
    for (const sx of [-1, 1]) daubZigzag(art, sx * 0.68 - 0.21, sx * 0.68 + 0.21, -0.38, 0.025, 5, 0.016, "#2a1c12", 0.02);
    parts.push(moved(art, 0, 0, -0.043));
    return withJungle(shaded(round, parts), (geo) => {
      liana(geo, sagPoints(-1.0, 0.5, 0.02, 1.0, 0.5, 0.02, 0.04, 10), 0.018, 0.016);
      // The lacing from the hide's drawn-in edges out to the poles.
      for (const v of [0.25, 0.5, 0.75]) for (const sx of [-1, 1]) liana(geo, [[sx * W / 2 * (1 - 0.12 * Math.sin(Math.PI * v)), (v - 0.5) * H, -0.05], [sx * 0.99, (v - 0.5) * H, -0.035]], 0.007, 0.007, "#c9a36a");
      for (const u of [0.2, 0.4, 0.6, 0.8]) for (const sy of [-1, 1]) liana(geo, [[(u - 0.5) * W, sy * H / 2 * (1 - 0.12 * Math.sin(Math.PI * u)), -0.05], [(u - 0.5) * W, sy > 0 ? 0.49 : -0.5, -0.02]], 0.007, 0.007, "#c9a36a");
      for (const sx of [-1, 1]) {
        liana(geo, [6, 20, 38, 55, 68, 78].map((deg, k) => [sx * 0.425 * Math.cos(deg * Math.PI / 180), 0.425 * Math.sin(deg * Math.PI / 180), k ? 0.045 + k * 0.004 : -0.04]), 0.03, 0.005, "#f2e8d0");
        sprig(geo, sx * 1.0, 0.5, 0.03, sx, -0.3, 0.35, 4, 0.2, rand);
      }
    });
  });
  // A dart, its point at the origin aimed along -z: a sharpened bone barrel bound with a strip of hide, and three
  // feather flights at its tail, 0.14 long.
  const dart = cached(() => shaded([
    turnedX(turn([[0, 0], [0.0025, 0.022], [0.0055, 0.03], [0.0065, 0.06], [0.005, 0.09], [0.0035, 0.1], [0.003, 0.14], [0, 0.14]], 8, BONE), Math.PI / 2),
    moved(turnedX(turn([[0.0068, 0], [0.0068, 0.022], [0, 0.022]], 8, "#6b4a26"), Math.PI / 2), 0, 0, 0.04)
  ], [0, 1, 2].map((k) => turnedZ(moved(turnedX(prism([[0, 0], [0.012, 0.012], [0.018, 0.04], [0.014, 0.052], [0, 0.05]], 0.0015, k ? "#a8442a" : "#f2e8d0"), Math.PI / 2), 0, 0, 0.09), k * Math.PI * 2 / 3))));
  // The throw line: a log half sunk in the floor across the thrower's toes.
  const dartOche = cached(() => shaded([BL.hubModels.log(-0.45, 0, -0.2, 0.45, 0, -0.2, 0.055)]));
  // The darts' sights, glowing bone laid on the board's face (+z): `line` a hairline across it along x, 0.3 either
  // side of its middle, on a dark core so it reads over bone and ochre alike (the game turns it upright for the
  // sweep across); `ring` a small ring, 0.03 round, where the lines cross and round the bull on the bull round; `lit`
  // a gold ring round the number chalked at the top of the board and a knapped point under it toward its bed, turned
  // by the game to the number it lights.
  const dartSight = cached(() => {
    const line = merge(box({ w: 0.6, h: 0.009, d: 0.002, color: "#1c1410" }), box({ w: 0.6, h: 0.0036, d: 0.002, color: "#fff4d8", emissive: 1, offset: { x: 0, y: 0, z: 0.0015 } }));
    const ring = turnedX(torus(0.03, 0.0032, "#fff4d8", 1, 20, 5), Math.PI / 2);
    const lit = merge(moved(turnedX(torus(0.032, 0.0045, "#ffd23a", 1, 20, 5), Math.PI / 2), 0, 0.29, 0), prism(ccw([[0, 0.247], [0.014, 0.263], [-0.014, 0.263]]), 0.003, "#ffd23a", 1));
    return { line: unshadowed(line), ring: unshadowed(ring), lit: unshadowed(lit) };
  });

  // ---- the staff's uniforms ---------------------------------------------------------------------------------
  // The game-room gorillas are the arcade's staff and dress as one crew: hide dyed staff red, trimmed with banana-gold
  // braid and bone buttons, the arcade's gold token for a badge, and each role's own piece. Hats sit on the Agent's
  // head (its frame: the skull block spans x -0.3..0.3, y 0..0.6 and z -0.17..0.34, the crest rising to 0.86 down the
  // middle and the brow jutting to z 0.43 just under y 0.52): 0 the gamemaster's tall ringmaster's hat, red with a
  // gold band and token, a charcoal brim and a plume; 1 the staff's red cap, its visor edged in gold, the token on its
  // front (the token attendant, the prize clerk and the deck's attendant); 2 the mechanic's, the same cap with its
  // goggles pushed up on it; 3 the snack runner's paper soda-jerk cap with a red band. Vests fit the Agent's chest
  // frame (the torso spans x -5U..5U, y 0..12U, z -3.5U..3.5U, U = 0.086; knuckle-walking, its back faces up, so the
  // token on the back and the braid carry the look from above): 0 the gamemaster's tailcoat, 1 the token attendant's
  // vest and change apron, 2 the mechanic's vest and tool belt, 3 the snack runner's vest under a long white apron,
  // 4 the staff vest itself (`uniformParts`); `staffProp` is what each one holds.
  const AU = 0.086;
  const WEAR_HIDE = "#7a4a26", WEAR_DARK = "#4a2e18", WEAR_OCHRE = "#d9a441";
  // The staff's feathers (and the prize crown's), [light, dark] rgb: red, bone-white, ochre and the charcoal a white
  // one is tipped in, a redder red and a paler white than the machines' `FEATHERS`.
  const FEATHER_TONES = [["#d8563a", "#8a2a1c"], ["#f2e8d0", "#b8a888"], ["#e0a040", "#9a6220"], ["#3a3432", "#1e1a18"]].map((p) => p.map(hexToRgb));
  const staffHat = variants((i) => {
    if (i === 0) {
      // The crown rises from a charcoal brim with its edge turned up, a gold band round its foot with the token on
      // its front, and a plume of red and bone-white feathers sweeping up and back from the band's right side.
      const z = 0.06, round = [
        turn([[0.3, 0.6], [0.285, 0.8], [0.3, 1.18], [0.315, 1.25], [0, 1.26]], 14, STAFF_RED), turn([[0.306, 0.63], [0.3, 0.78]], 14, STAFF_GOLD),
        turn([[0.29, 0.6], [0.47, 0.588], [0.5, 0.615], [0.48, 0.64], [0.3, 0.628]], 16, STAFF_INK), moved(torus(0.312, 0.014, STAFF_INK, 0, 14, 4), 0, 1.245, 0),
        ...staffToken(0.085).map((p) => moved(p, 0, 0.7, 0.304))
      ].map((p) => moved(p, 0, 0, z));
      return BL.hubModels.withJungle(shaded(round), (g) => {
        for (const [dx, len, tone] of [[0.25, 0.5, 1], [0.55, 0.42, 0], [0.05, 0.38, 0]]) leafBlade(g, 0.28, 0.72, z - 0.08, dx, 1, -0.45, 1, 0, 0.2, len, 0.42, FEATHER_TONES[tone]);
      });
    }
    if (i === 3) {
      // Folded paper, flat-topped over the crest, a red band round its foot and the token pinned on its side.
      return shaded(staffToken(0.06).map((p) => moved(turnedY(p, Math.PI / 2), 0.27, 0.7, 0.06)), [
        moved(prism(ccw([[-0.34, 0], [0.34, 0], [0.18, 0.36], [-0.18, 0.36]]), 0.62, APRON), 0, 0.55, 0.06),
        moved(prism(ccw([[-0.352, 0], [0.352, 0], [0.334, 0.075], [-0.334, 0.075]]), 0.635, STAFF_RED), 0, 0.555, 0.06),
        box({ w: 0.012, h: 0.02, d: 0.6, color: "#e4dccb", offset: { y: 0.915, z: 0.06 } })
      ]);
    }
    // The cap: a red crown over the crest with a gold band and button, the visor drooping a little over the brow.
    const z = 0.04, round = [
      turn([[0.37, 0.55], [0.37, 0.66], [0.335, 0.78], [0.23, 0.875], [0.11, 0.91], [0, 0.915]], 14, STAFF_RED), turn([[0.376, 0.56], [0.376, 0.645]], 14, STAFF_GOLD),
      moved(ball(0.035, STAFF_GOLD, 6), 0, 0.915, 0)
    ].map((p) => moved(p, 0, 0, z)), flat = [moved(turnedX(merge(bevelBox({ w: 0.58, h: 0.035, d: 0.32, color: STAFF_RED, bevel: 0.012 }), box({ w: 0.6, h: 0.03, d: 0.03, color: STAFF_GOLD, offset: { z: 0.16 } })), 0.12), 0, 0.585, 0.56)];
    if (i === 1) round.push(...staffToken(0.075).map((p) => moved(p, 0, 0.73, z + 0.345)));
    else {
      // The mechanic's goggles, pushed up onto the crown on a charcoal strap: brass rims round dark glass, looking up.
      const brass = "#9a7a44";
      round.push(moved(turn([[0.366, 0.69], [0.352, 0.77]], 14, STAFF_INK), 0, 0, z));
      for (const s of [-1, 1]) for (const p of [torus(0.07, 0.02, brass, 0, 12, 5), turn([[0, 0.004], [0.062, 0.004], [0.055, 0.014], [0, 0.016]], 10, "#3d6266", 0.3)]) round.push(moved(turnedX(p, 1.02), s * 0.11, 0.745, z + 0.36));
      flat.push(beam(-0.045, 0.745, z + 0.375, 0.045, 0.745, z + 0.375, 0.02, brass));
    }
    return shaded(round, flat);
  });
  // A tooth or fang `len` long hanging down from its top at the origin, a charm for the prize crown. A round part.
  const charmTooth = (len, r) => turn([[0, 0], [r, 0], [r * 0.85, -len * 0.4], [0, -len]], 6, BONE);
  // The staff's colours: hide dyed red, banana-gold braid, charcoal, and the canvas of shirts and aprons.
  const STAFF_RED = "#b3322b", STAFF_GOLD = "#f2b63e", STAFF_INK = "#2b2421", CANVAS = "#efe6cc", APRON = "#f7f2e4";
  // The arcade's token, the staff's badge: a gold coin with a red ring inset round a raised gold boss, `r` across,
  // facing +z from the origin. Round parts.
  const staffToken = (r) => [
    turn([[0, 0], [r, 0], [r, 0.12 * r], [0, 0.12 * r]], 12, STAFF_GOLD),
    turn([[r * 0.7, 0.12 * r], [r * 0.7, 0.16 * r], [r * 0.45, 0.16 * r], [r * 0.45, 0.12 * r]], 12, STAFF_RED),
    turn([[r * 0.32, 0.12 * r], [r * 0.26, 0.24 * r], [0, 0.26 * r]], 10, STAFF_GOLD)
  ].map((p) => turnedX(p, Math.PI / 2));
  // A panel of dyed hide and a strip of braid (or any flat box) at (x, y, z), in the chest's frame.
  const dyed = (w, h, d, x, y, z, color = STAFF_RED) => bevelBox({ w, h, d, color, bevel: 0.2 * AU, offset: { x, y, z } });
  const braid = (w, h, d, x, y, z, color = STAFF_GOLD) => box({ w, h, d, color, offset: { x, y, z } });
  // The staff's vest over the Agent's chest: a back panel, two front panels either side of a canvas shirt front, a
  // panel under each arm and a pad over each shoulder, all red hide, with gold braid along the hems, up the front's
  // edges and round the shoulders, three bone buttons, the token on the back (the side a knuckle-walker shows most)
  // and, with `badge`, a name badge on the chest. Returns [round, flat] for `shaded`.
  const uniformParts = (badge) => {
    const y0 = 2.6 * AU, y1 = 11.8 * AU, mid = (y0 + y1) / 2, h = y1 - y0, flat = [];
    const round = staffToken(2.3 * AU).map((p) => moved(turnedY(p, Math.PI), 0, 7.6 * AU, -4.1 * AU));
    flat.push(dyed(10.6 * AU, h, 0.6 * AU, 0, mid, -3.8 * AU), dyed(2.4 * AU, h - AU, 0.4 * AU, 0, mid + 0.5 * AU, 3.62 * AU, CANVAS));
    for (const y of [y0 + 0.3 * AU, y1 - 0.3 * AU]) flat.push(braid(10.8 * AU, 0.6 * AU, 0.7 * AU, 0, y, -3.85 * AU));
    for (const s of [-1, 1]) {
      flat.push(dyed(4.1 * AU, h, 0.6 * AU, s * 3.25 * AU, mid, 3.8 * AU), dyed(0.6 * AU, 7 * AU, 7.6 * AU, s * 5.3 * AU, 6.5 * AU, 0), dyed(4 * AU, 0.9 * AU, 6.4 * AU, s * 5.6 * AU, 13.45 * AU, -0.3 * AU));
      flat.push(braid(0.55 * AU, h, 0.7 * AU, s * 1.45 * AU, mid, 3.85 * AU), braid(4.1 * AU, 0.6 * AU, 0.7 * AU, s * 3.25 * AU, y0 + 0.3 * AU, 3.85 * AU), braid(0.5 * AU, AU, 6.6 * AU, s * 7.55 * AU, 13.4 * AU, -0.3 * AU));
    }
    for (const y of [5.2, 7.2, 9.2]) round.push(moved(ball(0.32 * AU, BONE, 6), 2.05 * AU, y * AU, 4.2 * AU));
    if (badge) flat.push(braid(2.1 * AU, 1.1 * AU, 0.3 * AU, -3.2 * AU, 9.4 * AU, 4.2 * AU, CANVAS), braid(1.6 * AU, 0.24 * AU, 0.1 * AU, -3.2 * AU, 9.6 * AU, 4.38 * AU, STAFF_RED), braid(1.1 * AU, 0.18 * AU, 0.1 * AU, -3.4 * AU, 9.15 * AU, 4.38 * AU, STAFF_INK));
    return [round, flat];
  };
  const staffVest = variants((i) => {
    const [round, flat] = uniformParts(i === 1 || i === 2 || i === 4);
    if (i === 0) {
      // The gamemaster's tailcoat: gold frogging across the front with bone toggles, gold epaulettes fringed down the
      // arms, a canvas jabot at the throat, and two tails edged in gold hanging from the waist behind.
      for (const y of [5.3, 7, 8.7, 10.4]) for (const s of [-1, 1]) {
        flat.push(braid(3.3 * AU, 0.42 * AU, 0.8 * AU, s * 3.15 * AU, y * AU, 3.9 * AU));
        round.push(moved(ball(0.36 * AU, BONE, 6), s * 1.75 * AU, y * AU, 4.3 * AU));
      }
      for (const s of [-1, 1]) {
        flat.push(dyed(4.3 * AU, 0.7 * AU, 6.6 * AU, s * 5.6 * AU, 14 * AU, -0.3 * AU, STAFF_GOLD));
        for (let k = 0; k < 5; k++) flat.push(moved(turnedY(prism(ccw([[-0.55 * AU, 0.2 * AU], [0.55 * AU, 0.2 * AU], [0, -(k % 2 ? 1.9 : 1.4) * AU]]), 0.4 * AU, STAFF_GOLD), Math.PI / 2), s * 7.75 * AU, 13.7 * AU, (-2.9 + k * 1.3) * AU));
        const outline = (pts) => ccw(pts.map(([x, y]) => [s * x * AU, y * AU]));
        flat.push(moved(prism(outline([[0.2, 3.5], [5.25, 3.5], [4.6, -3.95], [2.35, -5.45]]), 0.4 * AU, STAFF_GOLD), 0, 0, -4.75 * AU), moved(prism(outline([[0.5, 3.2], [4.9, 3.2], [4.3, -3.6], [2.4, -5]]), 0.5 * AU, STAFF_RED), 0, 0, -5.05 * AU));
      }
      flat.push(moved(prism(ccw([[-0.9 * AU, 0], [0.9 * AU, 0], [0, -2.2 * AU]]), 0.5 * AU, CANVAS), 0, 11.6 * AU, 4.05 * AU));
    } else if (i === 1) {
      // The token attendant's canvas change apron, three pouches of tokens on it, and a bone whistle on a gold cord.
      flat.push(dyed(8.6 * AU, 7.6 * AU, 0.4 * AU, 0, 0.9 * AU, 4.35 * AU, CANVAS), braid(8.8 * AU, 0.6 * AU, 0.5 * AU, 0, -2.6 * AU, 4.45 * AU, STAFF_RED), braid(8.8 * AU, 0.6 * AU, 0.5 * AU, 0, 4.6 * AU, 4.45 * AU));
      for (const x of [-2.8, 0, 2.8]) {
        flat.push(dyed(2.3 * AU, 2 * AU, AU, x * AU, 0.3 * AU, 4.95 * AU));
        for (const dx of [-0.45, 0.4]) round.push(moved(turnedX(turn([[0, 0], [0.55 * AU, 0], [0.55 * AU, 0.2 * AU], [0, 0.2 * AU]], 8, STAFF_GOLD), Math.PI / 2), (x + dx) * AU, 1.45 * AU, 4.75 * AU));
      }
      for (const s of [-1, 1]) flat.push(beam(s * 2.6 * AU, 11.9 * AU, 3.6 * AU, 1.5 * AU, 8.6 * AU, 4.35 * AU, 0.22 * AU, STAFF_GOLD));
      round.push(moved(turnedZ(turn([[0, -0.8 * AU], [0.42 * AU, -0.8 * AU], [0.42 * AU, 0.8 * AU], [0, 0.8 * AU]], 8, BONE), Math.PI / 2), 1.9 * AU, 8.1 * AU, 4.5 * AU));
    } else if (i === 2) {
      // The mechanic's tool belt: leather round the waist with a gold buckle, a stone hammer hung head up in a loop, a
      // pouch with a bone driver standing in it, and a red-striped rag.
      for (const z of [-1, 1]) flat.push(dyed(10.4 * AU, 1.4 * AU, 0.5 * AU, 0, 2.9 * AU, z * 4.15 * AU, WEAR_DARK));
      for (const s of [-1, 1]) flat.push(dyed(0.5 * AU, 1.4 * AU, 8.3 * AU, s * 5.65 * AU, 2.9 * AU, 0, WEAR_DARK));
      flat.push(braid(1.3 * AU, 1.1 * AU, 0.3 * AU, 0, 2.9 * AU, 4.45 * AU), beam(4.1 * AU, 3.4 * AU, 4.6 * AU, 4.1 * AU, -2.4 * AU, 4.7 * AU, 0.45 * AU, TIMBER),
        dyed(2.4 * AU, AU, AU, 4.1 * AU, 3.9 * AU, 4.6 * AU, "#6f6a64"), dyed(2.1 * AU, 2 * AU, 1.2 * AU, -2.2 * AU, 1.5 * AU, 4.8 * AU, WEAR_HIDE), dyed(1.7 * AU, 3.4 * AU, 0.25 * AU, -4.4 * AU, 1.1 * AU, 4.5 * AU, CANVAS));
      for (const y of [0.1, 1.2]) flat.push(braid(1.75 * AU, 0.3 * AU, 0.3 * AU, -4.4 * AU, y * AU, 4.6 * AU, STAFF_RED));
      round.push(moved(turnedZ(boneBar(2.2 * AU, 0.2 * AU), Math.PI / 2), -1.7 * AU, 3.2 * AU, 4.85 * AU));
    } else if (i === 3) {
      // The snack runner's long white apron, skirt and bib, banded red at the hem and the waist, on straps over the
      // shoulders; a gold bow at the collar and the name badge on the bib.
      flat.push(dyed(8 * AU, 9.4 * AU, 0.35 * AU, 0, -0.3 * AU, 4.35 * AU, APRON), dyed(5.2 * AU, 6.4 * AU, 0.35 * AU, 0, 7.8 * AU, 4.3 * AU, APRON));
      flat.push(braid(8.2 * AU, 0.7 * AU, 0.45 * AU, 0, -4.2 * AU, 4.4 * AU, STAFF_RED), braid(8.2 * AU, 0.35 * AU, 0.45 * AU, 0, -3.35 * AU, 4.4 * AU), braid(8.2 * AU, 0.6 * AU, 0.45 * AU, 0, 4.4 * AU, 4.45 * AU, STAFF_RED));
      for (const s of [-1, 1]) {
        flat.push(beam(s * 2.4 * AU, 10.9 * AU, 4.3 * AU, s * 3 * AU, 12.2 * AU, 1.5 * AU, 0.35 * AU, APRON));
        flat.push(moved(prism(ccw([[0, 0], [s * 1.3 * AU, 0.6 * AU], [s * 1.3 * AU, -0.6 * AU]]), 0.4 * AU, STAFF_GOLD), 0, 11.9 * AU, 4.2 * AU));
      }
      round.push(moved(ball(0.35 * AU, STAFF_GOLD, 6), 0, 11.9 * AU, 4.35 * AU));
      flat.push(braid(2.1 * AU, 1.1 * AU, 0.3 * AU, -1.2 * AU, 9.2 * AU, 4.55 * AU), braid(1.6 * AU, 0.24 * AU, 0.1 * AU, -1.2 * AU, 9.4 * AU, 4.72 * AU, STAFF_RED));
    }
    // 4: the staff vest alone, for the prize clerk and the deck's attendant.
    return shaded(round, flat);
  });
  // What the staff hold, each gripped in a fist at the origin: 0 the gamemaster's bone megaphone and 1 the mechanic's
  // wrench, both standing out along +z (the arm's forward when it hangs); 2 the snack runner's tray of coconut drinks,
  // level about its middle; 3 the prize clerk's roll of tickets with a strip of them hanging down its front; 4 the deck
  // attendant's feather duster, along +z.
  const staffProp = variants((i) => {
    const lengthwise = (parts) => parts.map((p) => turnedX(p, Math.PI / 2));
    if (i === 0) return shaded(lengthwise([
      turn([[0.035, -0.02], [0.045, 0.1], [0.11, 0.33], [0.2, 0.54], [0.225, 0.56]], 12, BONE),
      turn([[0.225, 0.56], [0.2, 0.565], [0.1, 0.36], [0.045, 0.14], [0, 0.13]], 12, "#4a3526"),
      moved(torus(0.108, 0.013, STAFF_RED, 0, 12, 5), 0, 0.31, 0), moved(torus(0.216, 0.014, STAFF_GOLD, 0, 14, 5), 0, 0.555, 0),
      moved(torus(0.048, 0.012, STAFF_GOLD, 0, 10, 4), 0, 0.1, 0)
    ]));
    if (i === 1) return shaded(lengthwise([turn([[0, -0.06], [0.032, -0.06], [0.03, 0.34], [0, 0.34]], 8, BONE), ...[0, 0.08].map((y) => moved(torus(0.034, 0.01, STAFF_RED, 0, 8, 4), 0, y, 0))]),
      lengthwise([box({ w: 0.17, h: 0.07, d: 0.06, color: "#77716a", offset: { y: 0.37 } }), ...[-1, 1].map((s) => box({ w: 0.045, h: 0.12, d: 0.06, color: "#77716a", offset: { x: s * 0.062, y: 0.46 } }))]));
    if (i === 2) {
      const cups = [[-0.17, 0.09], [0.16, 0.11], [0.01, -0.18]], round = [turn([[0, 0], [0.4, 0], [0.43, 0.045], [0.4, 0.05], [0, 0.035]], 16, TIMBER), moved(torus(0.42, 0.016, STAFF_GOLD, 0, 18, 4), 0, 0.045, 0)];
      for (const [x, z] of cups) round.push(moved(turn([[0, 0.035], [0.06, 0.037], [0.09, 0.08], [0.1, 0.15], [0.088, 0.153], [0.078, 0.09], [0, 0.08]], 10, "#6b4a26"), x, 0, z), moved(turn([[0, 0.14], [0.086, 0.14]], 10, CREAM), x, 0, z));
      return shaded(round, cups.map(([x, z]) => beam(x + 0.03, 0.12, z, x + 0.07, 0.3, z + 0.02, 0.014, "#c8d86a")));
    }
    if (i === 3) {
      const flat = [];
      for (let k = 0; k < 4; k++) flat.push(box({ w: 0.13, h: 0.082, d: 0.008, color: k % 2 ? "#ffb347" : "#ff9a3c", offset: { y: -0.02 - k * 0.09, z: 0.188 } }), box({ w: 0.09, h: 0.012, d: 0.004, color: "#8a3a1c", offset: { y: -0.02 - k * 0.09, z: 0.194 } }));
      return shaded([moved(turnedZ(turn([[0, -0.075], [0.085, -0.075], [0.085, 0.075], [0, 0.075]], 12, "#ff9a3c"), Math.PI / 2), 0, 0.03, 0.1)], flat);
    }
    // The duster: a bamboo handle with a red and gold binding, and a tuft of red, bone and ochre feathers.
    return BL.hubModels.withJungle(shaded(lengthwise([
      turn([[0.022, -0.08], [0.02, 0.62], [0, 0.63]], 8, "#cdb06a"), ...[0.16, 0.38].map((y) => moved(torus(0.022, 0.006, "#a88a48", 0, 8, 4), 0, y, 0)),
      turn([[0.024, 0.56], [0.03, 0.6], [0.03, 0.66], [0.022, 0.68]], 8, STAFF_RED), moved(torus(0.03, 0.008, STAFF_GOLD, 0, 8, 4), 0, 0.6, 0)
    ])), (g) => {
      for (let k = 0; k < 9; k++) {
        const a = k / 9 * Math.PI * 2, sp = k % 3 === 0 ? 0.15 : 0.45, c = Math.cos(a), s = Math.sin(a);
        leafBlade(g, c * 0.02, s * 0.02, 0.66, c * sp, s * sp, 1, c, s, 0, 0.3 + (k % 2) * 0.06, 0.55, FEATHER_TONES[k % 3]);
      }
    });
  });
  // A length of vine rope one metre long, centred on the origin, the claw's cable, which the scene stretches: a green
  // vine twisted with a paler one, their strands winding round it in a spiral.
  const VINE_ROPE = ["#3f6b2a", "#2f5424", "#7a9a48"].map(hexToRgb);
  const chainLink = cached(() => {
    const geo = lathe({ profile: Array.from({ length: 21 }, (_, k) => [0.017, k / 20 - 0.5]), segments: 6, color: "#3f6b2a" });
    geo.faces.forEach((f, k) => { f.color = VINE_ROPE[(Math.floor(k / 6) + k % 6) % 3]; });
    return smooth(geo);
  });
  // Where each machine of the newer games is played from, one frame per machine (the player at its origin facing
  // -z, `play` for the hall's station), shared by the hall and the game scenes: the claws from in front, the air
  // hockey tables from the end their `turn` faces, pool from the table's +z side, darts from the oche before the back
  // wall, pinball from its foot and the rides from 1.4 m in front of their faces.
  LAYOUT.frames = {
    claw: LAYOUT.claws.map(([x, z]) => standAt(x, z + CLAW.back, 0)),
    hockey: LAYOUT.hockeys.map((h) => standAt(h.x + Math.sin(h.turn) * 1.75, h.z + Math.cos(h.turn) * 1.75, h.turn)),
    pool: LAYOUT.pools.map((p) => standAt(p.x, p.z + 1.35, 0)),
    darts: LAYOUT.darts.map((x) => standAt(x, HALL.back + 0.38 + DART.oche, 0)),
    pinball: LAYOUT.pinball.map(([x, z]) => standAt(x, z + 1.05, 0)),
    ride: LAYOUT.rides.map((r) => ({ ...r, play: { x: r.x + Math.sin(r.turn) * 1.4, z: r.z + Math.cos(r.turn) * 1.4, facing: r.turn + Math.PI } }))
  };
  BL.arcadeModels = {
    HALL, STAGE, MEZZ, MEZZ_POSTS, GAMES, CABINETS, LAYOUT, CAB, SCREEN, FRAMES, FPS, START_FRAMES, SKEE, HOOP, SHY, METER_LEN, METER_WINDOW, SIGN_FRAME,
    POSTER_SCALE, MARQUEE, PRIZES, SPOTS, SPOT_Y, SPOT_FIRE, spotCan, spotRods, spark, CLAW, PIN, HOCKEY, WHEEL_VALUES, WHEEL_COST, wheelAt, wheelStop, lanterns, blaze, ceiling, MAMMOTH_AT, stage, mezzanine, wheel, clawMachine, claw, pinball, pinAt, airHockey, hockeyPieces,
    changer, ropes, RETRO, retroFrames, retroStart, retroLine, ride, RIDE_Y, RIDE_SEATS, RIDE_BEAT, rideBeat, poolRing, dartSight, boardPost, pinFlipper, pinLight, pinTooth, pinRamp, clawMark, POOL, POOL_COLORS, poolTable, poolBall, poolCue, poolDot, DART, dartBoard, dart, dartOche, clawBooth, clawPrize, ticketStrip, fameBoard, fameFrame, FAME, prizeShelf, PRIZE_SHELF, pennants, discoBall, speakers, tableProps, trashBin, ticketBucket, directory, wornPatch, MAT_Y, backDoor, chainLink, prize, prizeCounter, staffHat, staffVest, staffProp, bulbFrame, zoneSign, posterFrame, posterArt, table, planterPot,
    hall, signFrame, cabinet, attractFrames, attractStart, bestLine, digit, board, skeeLane, skeeDot, hoopMachine, hoop, coconutShy, coconut, shyVine, coconutBall, balls, meter, arrow, snackBar
  };
})();
