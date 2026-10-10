// The Money Line's geometry: a coastal railway through the history of money, one station a diorama (see
// docs/money-line.md for the history every relic tells). The line runs straight down -z along x = 0 from the
// platform the handcar leaves Jekyll Island from, over a causeway between the stations, each a stretch of land on
// the +x side of the track at the sea's edge, to the end of the line, still being built.
//
// `LAYOUT` is the whole place in world space: the handcar's `STOPS` along z, the walkable `REGIONS` (rectangles
// whose ground is at y = 0; the sea lies at `SEA` below), the `BLOCKS` a walker keeps out of (circles and
// rectangles), and per station its name, area label and the props the scene places. Every builder is cached and
// built once a page; the scene only makes nodes. Ground, track, platforms and dressing are each one merged
// geometry; a relic the visitor can poke, or that moves, is its own.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, math } = BL;
  const { cached, variants, box, bevelBox, lathe, merge, moved, turnedX, turnedY, turnedZ, noShadow, bananaGeometry } = models;
  const { mulberry32, hexToRgb } = math;
  const TAU = Math.PI * 2;

  const INK = {
    stone: "#8a8172", stoneDk: "#6d655a", gravel: "#7d6f5c", sand: "#e6d3a3", sandDk: "#d4bd88", coral: "#ddd2b6",
    grass: "#6f9a4a", grassDk: "#5c8440", ochre: "#b8894a", earth: "#8a6a44", timber: "#6b4f35", timberDk: "#4a3728",
    drift: "#a99b84", rope: "#c2a66e", shell: "#f3ead6", shellDk: "#c9b89a", purple: "#4a3a6a", white: "#efe8da",
    limestone: "#c8c2b2", limestoneDk: "#a59f8f", thatch: "#a8894e", thatchDk: "#8a6d3a", iron: "#47433f",
    electrum: "#d9b65a", electrumDk: "#a8873a", silver: "#c9ccd1", silverDk: "#9aa0a8", ember: "#ff7a2a", gold: "#e8c14a",
    blue: "#2c4f8a", owl: "#8a7356", owlDk: "#5e4c38", owlEye: "#f2c84a", ink: "#3a352d", water: "#3d7d93", sign: "#e8c14a"
  };
  // The sea's level; land stands up out of it with its top at 0.
  const SEA = -0.5;
  const RAIL_TOP = BL.jekyllIsle.RAIL_TOP;

  // Where everything stands. Stations sit on the track's +x side, so the visitor arriving from the start looks to
  // the right; a station's props face the track (-x) unless they say otherwise.
  const STOPS = [2, -40, -80, -120, -150];
  const REGIONS = [
    { x0: -5, x1: 7, z0: -4, z1: 8 },
    { x0: -2.2, x1: 2.2, z0: -158, z1: 8 },
    { x0: -3, x1: 24, z0: -56, z1: -24 },
    { x0: -3, x1: 26, z0: -97, z1: -63 },
    { x0: -3, x1: 24, z0: -137, z1: -103 },
    { x0: -5, x1: 7, z0: -158, z1: -144 }
  ];
  const GROUND = [INK.stone, INK.gravel, INK.sand, INK.coral, INK.grass, INK.stone];
  // A face turned toward the track from the +x side.
  const WEST = -Math.PI / 2;
  const STATIONS = [
    {
      id: "shells", stop: 1, label: "SHELLS", name: "Shells and Beads", date: "1200 BCE", sign: [5, -33], dateAt: [5, -47],
      center: [12, -40], dig: [[8, -44], [13, -49], [19, -33]], rack: [10, -36], belt: [17, -45], pool: [21.5, -53], stall: [13.5, -30.5],
      palms: [[21, -28, 0], [4.5, -27, 1], [23, -46, 2]], banana: [20.5, -48.6]
    },
    {
      id: "yap", stop: 2, label: "YAP", name: "Stones of Yap", date: null, sign: [5, -73],
      center: [13, -80], house: [19, -85], leaning: [[14.6, -82.4, 1.25], [15.2, -87.2, 0.85]], carry: [8.5, -77],
      lagoon: { x0: 17, x1: 25, z0: -76, z1: -67 }, sunk: [21, -71.5], okeefe: [7.5, -89], jetty: [17, 25.6, -73.5],
      flag: [25.2, -73.5], ottawa: [23, -91.5], banana: [24.2, -88.6]
    },
    {
      id: "coins", stop: 3, label: "FIRST COINS", name: "The First Coins", date: "600 BCE", sign: [5, -113], dateAt: [5, -127],
      center: [12, -120], mint: [16, -119], lion: [9, -114.5], owlCoin: [9, -125.5], hill: [36, -122], banana: [19.6, -119.4], stall: [12, -131]
    }
  ];
  // The way back to Jekyll Island at the start, and the end of the line, still being built.
  const EXIT = { x: 1, z: 7.2, half: 4.6 };
  const END = { z: -155 };
  // What a walker keeps out of, besides the edges of the land: circles { x, z, r } and rectangles.
  const BLOCKS = {
    circles: [
      [5, -33, 0.5], [5, -47, 0.6], [10, -36, 1.3], [4.5, -27, 0.5], [21, -28, 0.5], [23, -46, 0.5],
      [5, -73, 0.5], [14.6, -82.4, 1.0], [15.2, -87.2, 0.8], [8.5, -77, 1.3], [7.5, -89, 1.2], [25.2, -73.5, 0.3], [23, -91.5, 0.9],
      [5, -113, 0.5], [5, -127, 0.6], [9, -114.5, 0.9], [9, -125.5, 0.8], [16, -119, 0.5], [13.5, -30.5, 1.0], [12, -131, 1.0]
    ].map(([x, z, r]) => ({ x, z, r })),
    // The lagoon is `water`: a walker keeps out of it except along the jetty. The mint is its three walls and the
    // furnace, so an Ooga can walk in to the anvil.
    rects: [
      { x0: 15.6, x1: 18.4, z0: -46.4, z1: -43.6 },
      { x0: 16, x1: 22, z0: -88, z1: -82 },
      { x0: 17, x1: 25, z0: -76, z1: -67, water: true },
      { x0: 17.8, x1: 18.2, z0: -121.2, z1: -116.8 },
      { x0: 13.8, x1: 18.2, z0: -121.2, z1: -120.8 },
      { x0: 13.8, x1: 18.2, z0: -117.2, z1: -116.8 },
      { x0: 16.6, x1: 17.8, z0: -120.8, z1: -119.6 },
      { x0: -5, x1: 7, z0: 7, z1: 8 },
      { x0: -5, x1: 7, z0: -158, z1: -156 }
    ]
  };

  // ---- shared parts --------------------------------------------------------------------------------------

  const drum = (r, y0, y1, color, segments = 10, emissive = 0) => lathe({ profile: [[0, y0], [r, y0], [r, y1], [0, y1]], segments, color, emissive });
  // Carved type from the island's sign glyphs, centred on (x, y), standing proud of a face at z.
  const carved = (text, cell, color, emissive, x, y, z) => {
    const c = BL.poolModels.carve(text, { cell, color, emissive });
    return moved(c.geometry, x - (c.width / cell - 2) * cell / 2, y + 2 * cell, z - 0.12);
  };
  // A stone disc with a hole through it, standing up with its faces to ±z: an elliptical section turned round z.
  const disc = (outer, hole, thick, color, segments = 16) => {
    const rc = (outer + hole) / 2, rw = (outer - hole) / 2, profile = [];
    for (let k = 0; k <= 10; k++) {
      const a = k / 10 * TAU;
      profile.push([rc + Math.cos(a) * rw, Math.sin(a) * thick / 2]);
    }
    return turnedX(lathe({ profile, segments, color }), Math.PI / 2);
  };
  // A coin standing up, faces to ±z.
  const coin = (r, thick, color, emissive = 0) => turnedX(drum(r, -thick / 2, thick / 2, color, 16, emissive), Math.PI / 2);

  // ---- the place ------------------------------------------------------------------------------------------

  // The land: each region a slab down into the sea, the stations' grass and sand laid on top in patches.
  const ground = cached(() => {
    const parts = REGIONS.map((r, i) => box({ w: r.x1 - r.x0, h: 1.4, d: r.z1 - r.z0, color: GROUND[i], offset: { x: (r.x0 + r.x1) / 2, y: -0.7, z: (r.z0 + r.z1) / 2 } }));
    const rand = mulberry32(1200);
    for (let i = 0; i < 26; i++) {
      const r = REGIONS[2 + (i % 3)], w = 1.5 + rand() * 3, d = 1.5 + rand() * 3;
      const x = r.x0 + 3 + rand() * (r.x1 - r.x0 - 6), z = r.z0 + 2 + rand() * (r.z1 - r.z0 - 4);
      parts.push(box({ w, h: 0.02, d, color: [INK.sandDk, INK.grass, INK.grassDk][i % 3], offset: { x, y: 0.01, z } }));
    }
    return merge(...parts);
  });
  // The track: sleepers and two rails the whole length of the line, buffer stops at both ends.
  const track = cached(() => {
    const parts = [], z0 = REGIONS[1].z0 + 1.5, z1 = REGIONS[1].z1 - 1.5;
    for (let z = z1; z > z0; z -= 0.62) parts.push(box({ w: 2.3, h: 0.1, d: 0.24, color: INK.timberDk, offset: { y: 0.05, z } }));
    for (const x of [-0.72, 0.72]) parts.push(box({ w: 0.08, h: 0.12, d: z1 - z0, color: INK.iron, offset: { x, y: RAIL_TOP - 0.06, z: (z0 + z1) / 2 } }));
    for (const z of [z1, z0]) {
      for (const x of [-0.72, 0.72]) parts.push(bevelBox({ w: 0.22, h: 0.9, d: 0.22, color: INK.timberDk, offset: { x, y: 0.45, z } }));
      parts.push(bevelBox({ w: 1.9, h: 0.3, d: 0.3, color: "#8a4a3a", offset: { y: 0.7, z } }));
    }
    return merge(...parts);
  });
  // The start: an arch over the platform's back reading JEKYLL ISLAND 1910, the way home.
  const arch = cached(() => {
    const parts = [], { x, z, half } = EXIT;
    for (const side of [-1, 1]) parts.push(box({ w: 0.6, h: 4, d: 0.6, color: INK.stone, offset: { x: x + side * half, y: 2, z } }));
    parts.push(box({ w: 2 * half + 0.6, h: 0.7, d: 0.6, color: INK.stoneDk, offset: { x, y: 4.35, z } }));
    // Read from the platform (facing -z) and from the line's far side of the arch (facing +z).
    parts.push(moved(turnedY(carved("JEKYLL ISLAND 1910", 0.09, INK.sign, 0.5, 0, 4.35, 0), Math.PI), x, 0, z - 0.3));
    parts.push(carved("JEKYLL ISLAND 1910", 0.09, INK.sign, 0.5, x, 4.35, z + 0.3));
    return merge(...parts);
  });
  // The end of the line: a striped barrier across the track.
  const barrier = cached(() => {
    const parts = [];
    for (let k = 0; k < 6; k++) parts.push(box({ w: 0.8, h: 1.1, d: 0.12, color: k % 2 ? INK.gold : INK.ink, offset: { x: -3.5 + k * 1.4, y: 0.55, z: END.z - 1 } }));
    parts.push(carved("MORE ERAS COMING", 0.08, INK.sign, 0.4, 0, 1.6, END.z - 0.9));
    return merge(...parts);
  });
  // A carved date on a standing stone, facing +z (the scene turns it to the track).
  const dateStone = variants((i) => {
    const text = STATIONS.filter((s) => s.date)[i].date;
    return merge(box({ w: 1.7, h: 0.3, d: 0.7, color: INK.stoneDk, offset: { y: 0.15 } }), bevelBox({ w: 1.5, h: 1.3, d: 0.35, color: INK.limestone, offset: { y: 0.95 } }), carved(text, 0.075, INK.ink, 0, 0, 1.0, 0.175));
  });
  const goldenBanana = cached(() => {
    const geo = merge(bananaGeometry()), rgb = hexToRgb(INK.gold);
    for (const f of geo.faces) { f.color = rgb; f.emissive = 0.55; }
    return noShadow(geo);
  });

  // ---- 3. shells and beads ----------------------------------------------------------------------------------

  // A driftwood rack hung with strings of cowries.
  const cowrieRack = cached(() => {
    const parts = [];
    for (const x of [-1.1, 1.1]) parts.push(moved(turnedZ(bevelBox({ w: 0.14, h: 2, d: 0.14, color: INK.drift, offset: { y: 1 } }), x * 0.05), x, 0, 0));
    parts.push(bevelBox({ w: 2.6, h: 0.14, d: 0.14, color: INK.drift, offset: { y: 1.95 } }));
    for (let s = 0; s < 7; s++) {
      const x = -0.9 + s * 0.3, n = 6 + (s * 5) % 4;
      parts.push(box({ w: 0.015, h: n * 0.13, d: 0.015, color: INK.rope, offset: { x, y: 1.9 - n * 0.065 } }));
      for (let k = 0; k < n; k++) parts.push(box({ w: 0.07, h: 0.09, d: 0.05, color: k % 3 ? INK.shell : INK.shellDk, offset: { x, y: 1.82 - k * 0.13 } }));
    }
    return merge(...parts);
  });
  // A longhouse post frame with a wampum belt across it: rows of white and purple shell beads in a pattern.
  const wampum = cached(() => {
    const parts = [];
    for (const x of [-1.2, 1.2]) for (const z of [-1.2, 1.2]) parts.push(bevelBox({ w: 0.2, h: 2.4, d: 0.2, color: INK.timber, offset: { x, y: 1.2, z } }));
    for (const z of [-1.2, 1.2]) parts.push(bevelBox({ w: 2.8, h: 0.16, d: 0.16, color: INK.timber, offset: { y: 2.35, z } }));
    for (let i = 0; i < 9; i++) parts.push(bevelBox({ w: 2.9, h: 0.08, d: 0.28, color: INK.thatchDk, offset: { y: 2.5 + Math.sin(i / 8 * Math.PI) * 0.4, z: -1.3 + i * 0.32 } }));
    for (let r = 0; r < 5; r++) for (let c = 0; c < 18; c++) {
      const on = (c + r) % 6 < 2 || (c - r + 12) % 6 < 2;
      parts.push(box({ w: 0.11, h: 0.08, d: 0.03, color: on ? INK.purple : INK.white, offset: { x: -0.95 + c * 0.112, y: 1.55 - r * 0.085, z: 1.22 } }));
    }
    return merge(...parts);
  });
  // A mound of sand to dig cowries from.
  const mound = cached(() => lathe({ profile: [[0, 0], [0.75, 0], [0.55, 0.18], [0.25, 0.3], [0, 0.33]], segments: 10, color: INK.sandDk }));
  const cowrie = cached(() => noShadow(merge(
    lathe({ profile: [[0, -0.05], [0.07, -0.03], [0.08, 0], [0.06, 0.04], [0, 0.05]], segments: 8, color: INK.shell }),
    box({ w: 0.012, h: 0.012, d: 0.1, color: INK.shellDk, offset: { y: 0.05 } })
  )));
  // A shallow pool, its face water.
  const pool = cached(() => {
    const geo = box({ w: 3.4, h: 0.06, d: 2.6, color: INK.water, offset: { y: 0.03 } });
    for (const f of geo.faces) f.water = true;
    return noShadow(geo);
  });

  // ---- 4. Yap -----------------------------------------------------------------------------------------------

  const rai = variants((size) => disc(size, size * 0.24, size * 0.32, size > 1 ? INK.limestone : INK.limestoneDk));
  // A stone threaded on its carrying pole, the pole along z.
  const carried = cached(() => merge(disc(1.1, 0.26, 0.34, INK.limestone), box({ w: 0.12, h: 0.12, d: 4.4, color: INK.timber })));
  // A stone platform with a house of steep thatch on it.
  const house = cached(() => {
    const parts = [box({ w: 6, h: 0.45, d: 6, color: INK.stoneDk, offset: { y: 0.225 } })];
    for (const x of [-2, 2]) for (const z of [-2.2, 2.2]) parts.push(bevelBox({ w: 0.22, h: 2.2, d: 0.22, color: INK.timber, offset: { x, y: 1.55, z } }));
    for (let i = 0; i < 12; i++) {
      const t = i / 11, w = 5.2 - t * 4.4, y = 2.6 + t * 2.8;
      parts.push(box({ w, h: 0.26, d: 5.4 - t * 0.6, color: i % 2 ? INK.thatch : INK.thatchDk, offset: { y } }));
    }
    parts.push(box({ w: 1.2, h: 1.6, d: 0.1, color: INK.timberDk, offset: { x: -2.05, y: 1.25 } }));
    return merge(...parts);
  });
  // The jetty out over the lagoon, along +x from its root.
  const jetty = cached(() => {
    const [x0, x1] = STATIONS[1].jetty, len = x1 - x0, parts = [];
    for (let k = 0; k < Math.round(len / 0.5); k++) parts.push(box({ w: 0.42, h: 0.08, d: 1.6, color: k % 3 ? INK.timber : INK.timberDk, offset: { x: k * 0.5 + 0.25, y: 0.12 } }));
    for (let k = 0; k <= Math.round(len / 2); k++) for (const z of [-0.75, 0.75]) parts.push(box({ w: 0.12, h: 0.9, d: 0.12, color: INK.timberDk, offset: { x: k * 2, y: -0.3, z } }));
    return merge(...parts);
  });
  // The lagoon's water, a sheet over the sand.
  const lagoon = cached(() => {
    const L = STATIONS[1].lagoon, geo = box({ w: L.x1 - L.x0, h: 0.06, d: L.z1 - L.z0, color: INK.water, offset: { y: 0.04 } });
    for (const f of geo.faces) f.water = true;
    return noShadow(geo);
  });
  // Yap's flag on its pole: a blue field, a white ring round a canoe and a star.
  const flag = cached(() => {
    const parts = [drum(0.06, 0, 4.2, INK.timberDk, 6), box({ w: 0.04, h: 1, d: 1.6, color: INK.blue, offset: { y: 3.6, z: 0.82 } })];
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * TAU;
      parts.push(box({ w: 0.05, h: 0.08, d: 0.08, color: INK.white, offset: { x: 0.03, y: 3.6 + Math.sin(a) * 0.36, z: 0.82 + Math.cos(a) * 0.36 } }));
    }
    parts.push(box({ w: 0.05, h: 0.05, d: 0.4, color: INK.white, offset: { x: 0.03, y: 3.45, z: 0.82 } }), box({ w: 0.05, h: 0.14, d: 0.04, color: INK.white, offset: { x: 0.03, y: 3.55, z: 0.82 } }));
    parts.push(box({ w: 0.05, h: 0.1, d: 0.1, color: INK.white, offset: { x: 0.03, y: 3.78, z: 0.82 } }));
    return merge(...parts);
  });
  // A rai on a cut-stone pedestal carved OTTAWA, facing +z.
  const ottawa = cached(() => merge(box({ w: 1.4, h: 0.8, d: 0.8, color: INK.stone, offset: { y: 0.4 } }), carved("OTTAWA", 0.06, INK.ink, 0, 0, 0.45, 0.4), moved(disc(0.6, 0.15, 0.2, INK.limestone), 0, 1.4, 0)));
  // O'Keefe's iron-tool stones: smaller, squarer, stacked flat.
  const okeefe = cached(() => merge(...[0, 1, 2].map((k) => moved(turnedX(disc(0.95 - k * 0.12, 0.2, 0.26, INK.limestoneDk, 6), Math.PI / 2), k * 0.1, 0.13 + k * 0.27, -k * 0.08))));

  // ---- 5. first coins ---------------------------------------------------------------------------------------

  // The mint: three stone walls open to the track, a roof, a furnace glowing at the back, the anvil in the middle.
  // The hammer and the struck coin are the scene's own nodes.
  const mint = cached(() => {
    const parts = [box({ w: 4.4, h: 0.12, d: 4.4, color: INK.stoneDk, offset: { y: 0.06 } })];
    parts.push(box({ w: 0.4, h: 2.6, d: 4.4, color: INK.limestone, offset: { x: 2, y: 1.3 } }));
    for (const z of [-2, 2]) parts.push(box({ w: 4.4, h: 2.6, d: 0.4, color: INK.limestone, offset: { y: 1.3, z } }));
    parts.push(box({ w: 5, h: 0.3, d: 5, color: INK.earth, offset: { y: 2.75 } }));
    parts.push(box({ w: 1.2, h: 1.1, d: 1.2, color: INK.stoneDk, offset: { x: 1.2, y: 0.55, z: -1.2 } }));
    parts.push(box({ w: 0.6, h: 0.4, d: 0.05, color: INK.ember, emissive: 1, offset: { x: 1.2, y: 0.6, z: -0.58 } }));
    parts.push(box({ w: 0.6, h: 0.5, d: 0.5, color: INK.iron, offset: { y: 0.37 } }), box({ w: 0.8, h: 0.14, d: 0.5, color: INK.iron, offset: { y: 0.69 } }));
    return merge(...parts);
  });
  const hammer = cached(() => merge(box({ w: 0.06, h: 0.06, d: 0.8, color: INK.timber, offset: { z: -0.4 } }), box({ w: 0.18, h: 0.18, d: 0.26, color: INK.iron, offset: { z: -0.85 } })));
  const struck = cached(() => turnedX(coin(0.09, 0.03, INK.electrum, 0.2), Math.PI / 2));
  // A coin as big as a shield on a stand, its face to +z: Lydia's lion, or Athens' owl.
  const bigCoin = variants((owl) => {
    const parts = [box({ w: 0.25, h: 1.1, d: 0.25, color: INK.timberDk, offset: { y: 0.55 } }), moved(coin(0.75, 0.14, owl ? INK.silver : INK.electrum), 0, 1.75, 0)];
    const face = owl ? INK.silverDk : INK.electrumDk, z = 0.09;
    if (owl) {
      parts.push(box({ w: 0.5, h: 0.62, d: 0.06, color: face, offset: { y: 1.68, z } }));
      for (const x of [-0.12, 0.12]) parts.push(box({ w: 0.16, h: 0.16, d: 0.08, color: INK.silver, offset: { x, y: 1.88, z: z + 0.02 } }), box({ w: 0.07, h: 0.07, d: 0.1, color: INK.ink, offset: { x, y: 1.88, z: z + 0.03 } }));
      parts.push(box({ w: 0.1, h: 0.4, d: 0.05, color: "#7a8a5a", offset: { x: -0.42, y: 2.02, z } }));
    } else {
      for (let k = 0; k < 12; k++) {
        const a = k / 12 * TAU;
        parts.push(box({ w: 0.16, h: 0.16, d: 0.06, color: face, offset: { x: Math.cos(a) * 0.38, y: 1.75 + Math.sin(a) * 0.38, z } }));
      }
      parts.push(box({ w: 0.36, h: 0.42, d: 0.07, color: face, offset: { y: 1.73, z } }));
      parts.push(box({ w: 0.24, h: 0.1, d: 0.09, color: INK.electrum, offset: { y: 1.6, z: z + 0.01 } }));
    }
    return merge(...parts);
  });
  // An owl to sit on the mint's roof, facing +z.
  const owl = cached(() => merge(
    bevelBox({ w: 0.36, h: 0.46, d: 0.32, color: INK.owl, offset: { y: 0.23 } }),
    bevelBox({ w: 0.34, h: 0.3, d: 0.3, color: INK.owl, offset: { y: 0.6 } }),
    ...[-0.08, 0.08].map((x) => box({ w: 0.1, h: 0.1, d: 0.04, color: INK.owlEye, emissive: 0.3, offset: { x, y: 0.63, z: 0.15 } })),
    ...[-0.12, 0.12].map((x) => box({ w: 0.06, h: 0.1, d: 0.06, color: INK.owlDk, offset: { x, y: 0.8 } })),
    box({ w: 0.05, h: 0.07, d: 0.05, color: INK.gold, offset: { y: 0.55, z: 0.16 } })
  ));
  // The Phanes coin: a small electrum stater, its legend running backwards as the real one's Greek does.
  const phanes = cached(() => merge(coin(0.16, 0.03, INK.electrum), carved("SENAHP", 0.022, INK.electrumDk, 0, 0, 0.04, 0.015), box({ w: 0.12, h: 0.07, d: 0.03, color: INK.electrumDk, offset: { y: -0.06, z: 0.016 } })));
  // A market stall facing +z: a timber table under a striped awning, its goods and a carved price board. Variant 0
  // sells fish for a shell (and trades wampum) on the beach; 1 sells bread for a coin in Lydia.
  const stall = variants((v) => {
    const cloth = v ? ["#b8483a", INK.ochre] : ["#3d8a8a", INK.sand], parts = [bevelBox({ w: 1.7, h: 0.08, d: 0.8, color: INK.timber, offset: { y: 0.86 } })];
    for (const x of [-0.75, 0.75]) for (const z of [-0.32, 0.32]) parts.push(box({ w: 0.08, h: 0.86, d: 0.08, color: INK.timberDk, offset: { x, y: 0.43, z } }));
    for (const x of [-0.85, 0.85]) for (const z of [-0.45, 0.45]) parts.push(box({ w: 0.06, h: 1.9, d: 0.06, color: INK.timberDk, offset: { x, y: 0.95, z } }));
    for (let k = 0; k < 6; k++) parts.push(moved(turnedX(box({ w: 0.34, h: 0.04, d: 1.15, color: cloth[k % 2] }), 0.18), -0.85 + k * 0.34, 1.95, 0));
    if (v) {
      for (let k = 0; k < 4; k++) parts.push(moved(lathe({ profile: [[0, 0], [0.16, 0], [0.13, 0.09], [0, 0.12]], segments: 8, color: "#c98a45" }), -0.5 + k * 0.32, 0.9, -0.08));
      parts.push(drum(0.18, 0.9, 0.93, INK.timberDk, 10));
      for (let k = 0; k < 5; k++) parts.push(moved(turnedX(coin(0.04, 0.012, INK.electrum), Math.PI / 2), 0.55 + (k % 3) * 0.06, 0.94 + (k > 2 ? 0.012 : 0), 0.12 + (k % 2) * 0.05));
    } else {
      for (let k = 0; k < 4; k++) {
        parts.push(box({ w: 0.02, h: 0.02, d: 0.5, color: INK.drift, offset: { x: -0.55 + k * 0.22, y: 0.92, z: 0.05 } }));
        parts.push(bevelBox({ w: 0.1, h: 0.06, d: 0.28, color: "#9fb0b5", offset: { x: -0.55 + k * 0.22, y: 0.95, z: 0.05 } }));
      }
      parts.push(drum(0.2, 0.9, 0.98, INK.drift, 10));
      for (let k = 0; k < 6; k++) parts.push(moved(box({ w: 0.07, h: 0.05, d: 0.09, color: INK.shell }), 0.5 + (k % 3) * 0.08, 0.99, -0.05 + (k > 2 ? 0.09 : 0)));
    }
    parts.push(box({ w: 1.5, h: 0.32, d: 0.05, color: INK.drift, offset: { y: 0.62, z: 0.42 } }), carved(v ? "BREAD 1 COIN" : "FISH 1 SHELL", 0.035, INK.ink, 0, 0, 0.62, 0.445));
    return merge(...parts);
  });
  // The Conductor's cap, sized for a head 0.3 wide: navy crown, peak to +z, a gold band.
  const cap = cached(() => noShadow(merge(
    box({ w: 0.32, h: 0.13, d: 0.32, color: "#22305a", offset: { y: 0.065 } }),
    box({ w: 0.33, h: 0.035, d: 0.33, color: INK.gold, emissive: 0.15, offset: { y: 0.03 } }),
    box({ w: 0.3, h: 0.025, d: 0.14, color: "#1a2444", offset: { y: 0.012, z: 0.21 } })
  )));
  // Lydia's hills behind the mint.
  const hill = cached(() => merge(lathe({ profile: [[0, -1], [12, -1], [9, 3], [5, 6.5], [0, 8]], segments: 12, color: INK.grassDk }), moved(lathe({ profile: [[0, -1], [6, -1], [3, 4], [0, 5]], segments: 9, color: INK.ochre }), 9, 0, 7)));

  BL.moneylineModels = {
    INK, SEA, RAIL_TOP, STOPS, REGIONS, STATIONS, EXIT, END, BLOCKS, WEST,
    ground, track, arch, barrier, dateStone, goldenBanana, cowrieRack, wampum, mound, cowrie, pool,
    rai, carried, house, jetty, lagoon, flag, ottawa, okeefe, mint, hammer, struck, bigCoin, owl, phanes, hill, stall, cap
  };
})();
