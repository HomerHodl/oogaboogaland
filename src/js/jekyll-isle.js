// The ruins of Jekyll Island off the south rim. In November 1910 Senator Nelson Aldrich, a Treasury official and five
// bankers slipped away to the Jekyll Island Club on the Georgia coast, said they were going duck hunting, and drafted the
// plan that became the Federal Reserve. Here the club is a floating chunk of fiat wasteland: ash and scorched ground, dead live oaks hung with
// Spanish moss, the clubhouse roofless round the table its seven chairs still face, and the relics of a century of
// printed money (the printer, the empty vault, the shuttered gold window, the cracked Bretton Woods tablet, the 1913
// dollar's plinth, a Weimar wheelbarrow, a Zimbabwe note on a billboard, a burn barrel), duck decoys from the cover story,
// banknotes blowing across it all, and one clean stone carrying the headline in Bitcoin's first block.
//
// The way over is a railway trestle, after the private rail car they came in (which never reached the island: Ooga built
// the trestle). It leaves from a stone head at the top of the south stairs, just past the Oogatron, and the car stands
// derailed where the track ends on the islet.
//
// `spot(island)` finds where it all stands, once per island: the rim at the stairs' top along the south axis, the floor
// there, and the islet's middle a head and a span's length out. It throws if the head would sit on uneven ground or the
// islet crowds another. `site(spot)` builds the visit's nodes under one group at the islet's middle, turned so local +z
// runs back along the trestle to the island, and returns what the hub places them by, in world space: the floors (the
// rock, the trestle and its head, architecture a walker climbs), the ruins (solid props), the picks, the burn barrel's
// flame and fire point, the ground the home scatter gives up, the clouds' keep-out and `groundAt`, the walking height of
// the islet's top and the crossing, or -Infinity off them. Every geometry is built once a page; a visit only makes nodes.
// `update(site, dt, elapsed)` blows the loose notes about, spins the printer's rollers and pulses the genesis stone,
// allocating nothing; `print(site)` runs the printer and throws a handful of fresh notes out of it.
//
// Every solid has a closed collision shell of boxes: the rock its own voxels, the walls and the head their own boxes,
// the props a box or a few round their bulk. Track, sleepers, trestle legs, signs, decoys, litter, the flame, the
// genesis carving, the printer's moving parts and the notes are `sightHidden`. `LORE` is what each relic says when pointed at and poked: real history, with the memes on top.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, math } = BL;
  const { createNode, addChild } = BL.scene;
  const { cached, variants, box, bevelBox, lathe, merge, moved, turnedX, turnedY, turnedZ, noShadow, makeVox, voxelGeometry, polyline } = models;
  const { mulberry32, hexToRgb } = math;
  const { limb, padNormals } = BL.hubModels;
  const TAU = Math.PI * 2, SHELL = "#000000";

  const INK = {
    ash: "#8f8672", ashDk: "#857c69", scorch: "#6e6556", dirt: "#6a4e39", stone: "#6f6a62", stoneDk: "#55514b", head: "#857c6e",
    cream: "#cdbf98", creamDk: "#aa9d79", soot: "#5c564c", brick: "#8a4a3a", floor: "#6f5641", slate: "#4a4d55",
    timber: "#5d4634", timberDk: "#3e2f24", leg: "#4a4038", ballast: "#5a5148", iron: "#47433f", rust: "#7a4a2c",
    gold: "#e8c14a", note: "#86a872", paper: "#e3d9bd", ink: "#3a352d", marble: "#d6d0c1", marbleDk: "#aaa394",
    granite: "#3c3a38", vault: "#5f5c57", steel: "#8d8a84", hole: "#141210", orange: "#f7931a",
    car: "#33493b", carDk: "#26362c", glass: "#2a2f33", mahogany: "#5a3326", board: "#a9c48e", boardInk: "#23361f",
    bark: "#6b6155", moss: "#a6a894", flame: "#ff8a2a", flameCore: "#ffd36b",
    duck: "#6b4f2e", duckDk: "#4e3a22", duckHead: "#2f5b3a", bill: "#d9a640", mark: "#9c86a8", markLt: "#c2a77a"
  };

  // Where it stands: the axis's bearing (x = sin b, z = -cos b), where the search for the rim starts, and how far
  // inland of the rim the floor is read. The south stairs climb to a level landing that ends in a notch in the rim.
  const AXIS = { bearing: Math.PI, from: 26, floor: 0.7 };
  // The trestle's stone head: from `back` inland of the rim out `over` past it, `half` either side, a `slab` deep, two
  // corbel courses `course` tall under it, each stepping in `step`, and low parapets where it overhangs the drop.
  const HEAD = { back: 1, over: 1.4, half: 1.6, slab: 0.5, course: 0.45, step: 0.3, parapet: 0.9 };
  // The trestle: `span` from the head to the islet's front edge, then `into` the islet; its deck `half` either side,
  // its top `lift` over the islet's, its slab and guards, the bents' pitch under it and how far their legs once reached.
  const DECK = { span: 14, into: 1.5, half: 1.6, lift: 0.06, slab: 0.34, guard: 0.95, bent: 2.8, legs: 11 };
  // The rock on the hub's half-metre lattice: its outline radius, its depth at the middle. Outline and tones by metre block.
  const ROCK = { unit: 0.5, radius: 14.5, depth: 14 };
  // How far the islet keeps from the other islets.
  const CLEAR = 8;
  // The blowing notes: how many, how far out they turn back, their drift, hop, fall and drag in the air.
  const NOTE = { count: 14, reach: 11, wind: 1.3, hop: 0.45, gravity: 3.2, drag: 0.6, burst: 6 };
  const WIND_X = 0.8, WIND_Z = -0.6;
  // Where the track ends on the islet (the buffer stop), and the rails' top over whatever they lie on.
  const TRACK_STOP = 3.6, RAIL_TOP = 0.22;
  // The handcar: its stops a little short of each end of the line, top speed and how hard it speeds up and brakes,
  // how long a rider sits before it sets off, its deck and the bench's top over the rails, and the rider's seat as the
  // hub's benches have it (`y` over the floor it stands on).
  const HANDCAR = { islet: TRACK_STOP + 1.5, speed: 3.4, accel: 1.4, wait: 0.6, deck: 0.55, bench: 0.45, seat: 0.58, half: 1.15, step: 1.15 };
  // The dates the ruins keep, in order: poked in this order, the genesis stone answers.
  const CHRONO = [1910, 1913, 1923, 1933, 1944, 1971, 2009];

  // ---- the rock ---------------------------------------------------------------------------------------

  const edgeAt = (a) => ROCK.radius * (0.93 + 0.04 * Math.sin(3 * a + 1.1) + 0.03 * Math.sin(7 * a + 0.4));
  const hash = (a, b, c) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
  // A metre block (two cells square) is rock when its middle lies inside the outline.
  const inBlock = (bx, bz) => Math.hypot(bx + 0.5, bz + 0.5) <= edgeAt(Math.atan2(bz + 0.5, bx + 0.5));
  // The islet's front edge along the deck: the nearest block edge any of the deck's blocks reach toward the island.
  const FRONT = (() => {
    let front = Infinity;
    for (let bx = -Math.ceil(DECK.half); bx < Math.ceil(DECK.half); bx++) {
      let bz = 0;
      while (inBlock(bx, bz + 1)) bz++;
      front = Math.min(front, bz + 1);
    }
    return front;
  })();
  // Along the axis in the islet's frame: the deck's end buried in the islet, the head's outer face, the rim, its inland end.
  const Z_END = FRONT - DECK.into, Z_OUT = FRONT + DECK.span, Z_RIM = Z_OUT + HEAD.over, Z_IN = Z_RIM + HEAD.back;

  // Ash on top in metre patches (dust, darker dust, scorch), a band of dirt, then stone in metre courses, tapering down.
  const rock = cached(() => {
    const v = makeVox(), u = ROCK.unit, B = Math.ceil(ROCK.radius) + 1, deep = ROCK.depth / u;
    for (let bx = -B; bx < B; bx++) for (let bz = -B; bz < B; bz++) {
      if (!inBlock(bx, bz)) continue;
      const a = Math.atan2(bz + 0.5, bx + 0.5), k = Math.hypot(bx + 0.5, bz + 0.5) / edgeAt(a);
      const depth = Math.max(2, Math.round(deep * (1 - Math.pow(k, 1.5)) * (0.8 + hash(bx, 7, bz) % 1000 / 1000 * 0.3)));
      const roll = hash(bx, 1, bz) % 100, top = roll < 7 ? 2 : roll < 35 ? 1 : 0;
      for (let xc = 2 * bx; xc < 2 * bx + 2; xc++) for (let zc = 2 * bz; zc < 2 * bz + 2; zc++) {
        for (let j = 1; j <= depth; j++) v.set(xc, -j, zc, j === 1 ? top : j <= 3 ? 3 : hash(bx, (j - 4) >> 1, bz) % 100 < 30 ? 5 : 4);
      }
    }
    const options = { unit: u, palette: [INK.ash, INK.ashDk, INK.scorch, INK.dirt, INK.stone, INK.stoneDk], origin: { x: 0, y: 0, z: 0 } };
    const geometry = voxelGeometry(v, options);
    geometry.cutawaySource = BL.terrain.cutawaySourceFromVox(v, options);
    return geometry;
  });

  // ---- shared parts -----------------------------------------------------------------------------------

  // A closed cylinder about y.
  const drum = (r, y0, y1, color, segments = 10, emissive = 0) => lathe({ profile: [[0, y0], [r, y0], [r, y1], [0, y1]], segments, color, emissive });
  // The axis-aligned box round a built part, for a shell.
  const hull = (geo) => {
    const v = geo.verts, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v[i + k]);
      hi[k] = Math.max(hi[k], v[i + k]);
    }
    return box({ w: hi[0] - lo[0], h: hi[1] - lo[1], d: hi[2] - lo[2], color: SHELL, offset: { x: (lo[0] + hi[0]) / 2, y: (lo[1] + hi[1]) / 2, z: (lo[2] + hi[2]) / 2 } });
  };
  // Lowers parts together so the first one's lowest point sinks `sink` under the ground.
  const seat = (sink, ...geos) => {
    let lo = Infinity;
    for (let i = 1; i < geos[0].verts.length; i += 3) lo = Math.min(lo, geos[0].verts[i]);
    for (const geo of geos) moved(geo, 0, -lo - sink, 0);
  };
  // Carved type from the island's sign glyphs, centred on (x, y), standing proud of a face at z.
  const carved = (text, cell, color, emissive, x, y, z) => {
    const c = BL.poolModels.carve(text, { cell, color, emissive });
    return moved(c.geometry, x - (c.width / cell - 2) * cell / 2, y + 2 * cell, z - 0.12);
  };
  const solid = (geo, shell) => {
    geo.collisionGeometry = shell;
    return geo;
  };
  const note = cached(() => noShadow(box({ w: 0.34, h: 0.012, d: 0.16, color: INK.note })));

  // ---- the trestle and its head -----------------------------------------------------------------------

  // The deck: a ballast slab between timber guard rails, over a shell of the slab and two continuous guards.
  const deck = cached(() => {
    const len = Z_OUT - Z_END, mid = (Z_OUT + Z_END) / 2, h = DECK.half, top = DECK.lift, rand = mulberry32(1913);
    const parts = [box({ w: 2 * h, h: DECK.slab, d: len, color: INK.ballast, offset: { y: top - DECK.slab / 2, z: mid } })];
    for (const side of [-1, 1]) {
      const x = side * (h + 0.08);
      parts.push(bevelBox({ w: 0.14, h: 0.14, d: len, color: INK.timber, offset: { x, y: top + DECK.guard - 0.07, z: mid } }));
      parts.push(bevelBox({ w: 0.1, h: 0.1, d: len, color: INK.timberDk, offset: { x, y: top + 0.45, z: mid } }));
      for (let z = Z_END + 0.3; z < Z_OUT; z += 1.4) {
        // A few posts gone: the rails still hold.
        if (rand() < 0.15) continue;
        parts.push(bevelBox({ w: 0.16, h: DECK.guard + 0.12, d: 0.16, color: INK.timberDk, offset: { x, y: top + (DECK.guard - 0.12) / 2, z } }));
      }
    }
    const shell = [box({ w: 2 * h, h: DECK.slab, d: len, color: SHELL, offset: { y: top - DECK.slab / 2, z: mid } })];
    for (const side of [-1, 1]) shell.push(box({ w: 0.16, h: DECK.slab + DECK.guard, d: len, color: SHELL, offset: { x: side * (h + 0.08), y: top - DECK.slab + (DECK.slab + DECK.guard) / 2, z: mid } }));
    return solid(merge(...parts), merge(...shell));
  });
  // The track (sleepers, two rails and the buffer stop where it ends on the islet) and the trestle's bents hanging
  // under the deck, their legs snapped off where the marsh used to be.
  const track = cached(() => {
    const parts = [], rand = mulberry32(1910), STOP = TRACK_STOP;
    for (let z = STOP + 0.4; z < Z_OUT - 0.2; z += 0.62) {
      const y = z > Z_END ? DECK.lift : 0;
      if (rand() < 0.06) continue;
      parts.push(moved(turnedY(box({ w: 2.3, h: 0.1, d: 0.24, color: INK.timberDk, offset: { y: y + 0.05 } }), (rand() - 0.5) * 0.12), 0, 0, z));
    }
    for (const x of [-0.72, 0.72]) {
      parts.push(box({ w: 0.08, h: 0.12, d: Z_END - STOP, color: INK.rust, offset: { x, y: RAIL_TOP - 0.06, z: (Z_END + STOP) / 2 } }));
      parts.push(box({ w: 0.08, h: 0.12, d: Z_OUT - Z_END, color: INK.rust, offset: { x, y: DECK.lift + RAIL_TOP - 0.06, z: (Z_OUT + Z_END) / 2 } }));
    }
    // The buffer stop: two posts and a beam, its face painted red once.
    for (const x of [-0.72, 0.72]) parts.push(bevelBox({ w: 0.22, h: 0.9, d: 0.22, color: INK.timberDk, offset: { x, y: 0.45, z: STOP } }));
    parts.push(bevelBox({ w: 1.9, h: 0.3, d: 0.3, color: INK.brick, offset: { y: 0.7, z: STOP + 0.06 } }));
    for (let z = FRONT + 1.4, n = 0; z < Z_OUT - 1; z += DECK.bent, n++) {
      const reach = n % 3 === 1 ? 2.5 + rand() * 1.5 : DECK.legs * (0.6 + rand() * 0.4), y0 = DECK.lift - DECK.slab;
      parts.push(bevelBox({ w: 3.4, h: 0.3, d: 0.3, color: INK.leg, offset: { y: y0 - 0.15, z } }));
      for (const side of [-1, 1]) {
        const leg = bevelBox({ w: 0.26, h: reach, d: 0.26, color: INK.leg, offset: { y: -reach / 2 } });
        parts.push(moved(turnedZ(leg, side * 0.08), side * 1.35, y0 - 0.3, z));
      }
      // X bracing between the legs, where they reach far enough to carry it.
      if (reach > 5) for (const tilt of [-1, 1]) parts.push(moved(turnedZ(box({ w: 0.12, h: 3.6, d: 0.12, color: INK.leg }), tilt * 0.62), 0, y0 - 2.6, z));
    }
    return merge(...parts);
  });
  // The head: a stone slab out over the notch in the rim, two corbel courses under it run back into the cliff, and low
  // parapets along the sides where it overhangs the drop. Closed boxes, stacked, so it is its own shell.
  const head = cached(() => {
    const h = HEAD.half, top = DECK.lift, parts = [];
    const slab = (w, y0, y1, z0, z1, color) => parts.push(box({ w, h: y1 - y0, d: z1 - z0, color, offset: { y: (y0 + y1) / 2, z: (z0 + z1) / 2 } }));
    slab(2 * h, top - HEAD.slab, top, Z_OUT, Z_IN, INK.head);
    for (let c = 1; c <= 2; c++) {
      const y1 = top - HEAD.slab - (c - 1) * HEAD.course;
      slab(2 * (h - c * HEAD.step), y1 - HEAD.course, y1, Z_OUT + c * HEAD.step, Z_IN + 0.5, c === 1 ? INK.stone : INK.stoneDk);
    }
    for (const side of [-1, 1]) parts.push(box({ w: 0.24, h: HEAD.slab + HEAD.parapet, d: Z_RIM - Z_OUT, color: INK.stone, offset: { x: side * (h + 0.12), y: top - HEAD.slab + (HEAD.slab + HEAD.parapet) / 2, z: (Z_OUT + Z_RIM) / 2 } }));
    return merge(...parts);
  });

  // ---- the clubhouse ----------------------------------------------------------------------------------

  // The ruin's footprint: `w` by `d` about its middle, front (+z) to the plaza, walls `thick`, the door `door` either
  // side of the middle, a brick footing `footing` tall. The turret stood at its back right corner.
  const CLUB = { w: 9, d: 5.5, thick: 0.35, door: 1.2, footing: 0.45, floor: 0.12, turret: 1.25, turretH: 4.6 };
  // A wall in half-metre columns along one axis: each column's height from `tops`, a brick footing under it and its
  // window holes left open. Closed boxes that never overlap, so the wall is its own shell.
  const wallRun = (parts, rand, { alongX, at, from, to, tops, holes = [] }) => {
    const n = Math.max(1, Math.round((to - from) / 0.5)), step = (to - from) / n, T = CLUB.thick;
    for (let i = 0; i < n; i++) {
      const a = from + (i + 0.5) * step, top = Math.max(0.3, tops(n > 1 ? i / (n - 1) : 0, rand));
      const hole = holes.find(([a0, a1]) => a >= a0 && a <= a1), footing = Math.min(CLUB.footing, top);
      const tone = rand() < 0.2 ? INK.soot : rand() < 0.5 ? INK.creamDk : INK.cream, spans = [[0, footing, INK.brick]];
      if (hole) {
        spans.push([footing, hole[2], tone]);
        if (top > hole[3]) spans.push([hole[3], top, tone]);
      } else if (top > footing) spans.push([footing, top, tone]);
      for (const [y0, y1, color] of spans) {
        parts.push(box({ w: alongX ? step : T, h: y1 - y0, d: alongX ? T : step, color, offset: { x: alongX ? a : at, y: (y0 + y1) / 2, z: alongX ? at : a } }));
      }
    }
  };
  const clubhouse = cached(() => {
    const parts = [], rand = mulberry32(1910), W = CLUB.w / 2, D = CLUB.d / 2, T = CLUB.thick;
    wallRun(parts, rand, { alongX: true, at: D - T / 2, from: -W, to: -CLUB.door, holes: [[-3.6, -2.4, 1.0, 2.2]], tops: (t, r) => 2.9 + 0.5 * Math.sin(t * 3) - (t > 0.8 ? 0.9 : 0) + r() * 0.25 });
    wallRun(parts, rand, { alongX: true, at: D - T / 2, from: CLUB.door, to: W, tops: (t, r) => t === 0 ? 2.4 : 0.6 + r() * 1.4 * (1 - t) });
    wallRun(parts, rand, { alongX: true, at: -(D - T / 2), from: -W, to: W, holes: [[-3.2, -2.0, 1.0, 2.3], [-0.6, 0.6, 1.0, 2.3], [2.0, 3.2, 1.0, 2.3]], tops: (t, r) => t > 0.75 && t < 0.9 ? 1.4 : 3.2 + 1.1 * Math.max(0, 1 - Math.abs(t - 0.4) * 2) + r() * 0.3 });
    wallRun(parts, rand, { alongX: false, at: -(W - T / 2), from: -(D - T), to: D - T, holes: [[-0.7, 0.7, 1.0, 2.2]], tops: (t, r) => 2.6 + r() * 0.6 });
    wallRun(parts, rand, { alongX: false, at: W - T / 2, from: -(D - T), to: D - T, tops: (t, r) => Math.abs(t - 0.3) < 0.1 ? 3.0 : 0.5 + r() * 0.9 });
    parts.push(box({ w: 2 * (W - T), h: CLUB.floor, d: 2 * (D - T), color: INK.floor, offset: { y: CLUB.floor / 2 } }));
    parts.push(box({ w: 2 * CLUB.door, h: CLUB.floor, d: T, color: INK.floor, offset: { y: CLUB.floor / 2, z: D - T / 2 } }));
    return merge(...parts);
  });
  // What the roof left: charred rafters still across the high walls, one fallen in, and rubble along the low side.
  const clubDebris = cached(() => {
    const rand = mulberry32(1911), W = CLUB.w / 2, D = CLUB.d / 2, parts = [];
    for (const x of [-3.4, -1.6]) parts.push(bevelBox({ w: 0.2, h: 0.22, d: CLUB.d - 0.2, color: INK.scorch, offset: { x, y: 3.1 } }));
    parts.push(moved(turnedX(bevelBox({ w: 0.2, h: 0.22, d: 4.2, color: INK.scorch }), 0.62), 1.6, 1.3, -0.6));
    for (let i = 0; i < 16; i++) {
      const s = 0.18 + rand() * 0.3, z = -D + 0.6 + rand() * (CLUB.d - 1.2), x = W - 0.4 - rand() * 1.4;
      parts.push(moved(turnedY(box({ w: s, h: s * 0.7, d: s, color: rand() < 0.4 ? INK.brick : INK.creamDk, offset: { y: s * 0.35 } }), rand() * TAU), x, CLUB.floor, z));
    }
    for (let i = 0; i < 7; i++) parts.push(moved(turnedY(box({ w: 0.3, h: 0.006, d: 0.22, color: INK.paper }), rand() * TAU), -W + 1 + rand() * (CLUB.w - 3), CLUB.floor + 0.004, -D + 0.8 + rand() * (CLUB.d - 1.6)));
    return noShadow(merge(...parts));
  });
  // The turret: an octagon broken off at the top, its windows dark; its shell a box.
  const turret = cached(() => {
    const r = CLUB.turret, H = CLUB.turretH, rand = mulberry32(1912), parts = [drum(r + 0.08, 0, CLUB.footing, INK.brick, 8), drum(r, CLUB.footing, H, INK.cream, 8)];
    for (let k = 0; k < 8; k++) {
      const a = (k + 0.5) / 8 * TAU, tall = rand() < 0.5 ? 0.3 + rand() * 0.6 : 0;
      if (tall) parts.push(moved(turnedY(box({ w: 0.8, h: tall, d: 0.3, color: INK.creamDk }), -a + Math.PI / 2), Math.cos(a) * (r - 0.15), H + tall / 2, Math.sin(a) * (r - 0.15)));
      if (k % 2) parts.push(moved(turnedY(box({ w: 0.5, h: 0.9, d: 0.04, color: INK.hole }), -a + Math.PI / 2), Math.cos(a) * r * 0.93, 2.6, Math.sin(a) * r * 0.93));
    }
    return solid(merge(...parts), box({ w: 2 * r, h: H, d: 2 * r, color: SHELL, offset: { y: H / 2 } }));
  });
  // Its slate cap, fallen and lying on its side.
  const turretRoof = cached(() => {
    const cone = merge(lathe({ profile: [[0, 0], [1.5, 0], [0, 2.3]], segments: 8, color: INK.slate }), drum(0.12, 2.25, 2.7, INK.gold, 6));
    turnedZ(cone, Math.PI / 2 + 0.3);
    const shell = hull(cone);
    seat(0.15, cone, shell);
    return solid(cone, shell);
  });
  // The table they met round: seven chairs (one at the head, three a side), name cards, the plan's papers, and one
  // chair knocked over. Its shell a box for the table and one for each chair.
  const chair = (fallen) => {
    const parts = [bevelBox({ w: 0.48, h: 0.06, d: 0.48, color: INK.mahogany, offset: { y: 0.48 } }), bevelBox({ w: 0.48, h: 0.62, d: 0.06, color: INK.mahogany, offset: { y: 0.82, z: -0.21 } })];
    for (const x of [-0.2, 0.2]) for (const z of [-0.2, 0.2]) parts.push(box({ w: 0.05, h: 0.45, d: 0.05, color: INK.timberDk, offset: { x, y: 0.225, z } }));
    const geo = merge(...parts);
    if (fallen) turnedZ(geo, Math.PI / 2);
    return geo;
  };
  const table = cached(() => {
    const rand = mulberry32(1909), parts = [bevelBox({ w: 4.4, h: 0.1, d: 1.1, color: INK.mahogany, offset: { y: 0.8 } })], shell = [box({ w: 4.4, h: 0.85, d: 1.1, color: SHELL, offset: { y: 0.425 } })];
    for (const x of [-2, 2]) for (const z of [-0.42, 0.42]) parts.push(box({ w: 0.1, h: 0.75, d: 0.1, color: INK.timberDk, offset: { x, y: 0.375, z } }));
    const seats = [[-2.75, 0, Math.PI / 2], ...[-1.4, 0, 1.4].flatMap((x) => [[x, -0.95, 0], [x, 0.95, Math.PI]])];
    seats.forEach(([x, z, ry], i) => {
      const fallen = i === 6, geo = moved(turnedY(chair(fallen), ry), x, 0, fallen ? z + 0.45 : z);
      if (fallen) seat(0, geo);
      parts.push(geo);
      shell.push(fallen ? hull(geo) : box({ w: 0.5, h: 1.13, d: 0.5, color: SHELL, offset: { x, y: 0.565, z } }));
      // Each place's card, first name only.
      const cx = x + (ry === Math.PI / 2 ? 0.45 : 0), cz = ry === Math.PI / 2 ? 0 : z * 0.45;
      parts.push(moved(turnedY(box({ w: 0.14, h: 0.08, d: 0.02, color: INK.paper }), ry), cx, 0.89, cz));
    });
    for (let i = 0; i < 6; i++) parts.push(moved(turnedY(box({ w: 0.3, h: 0.006, d: 0.22, color: INK.paper }), rand() * TAU), (rand() - 0.5) * 3.6, 0.853, (rand() - 0.5) * 0.7));
    return solid(merge(...parts), merge(...shell));
  });

  // ---- the relics -------------------------------------------------------------------------------------

  // Aldrich's private car, derailed at the end of the line: body, roof and clerestory, windows (a few smashed), a gold
  // stripe and PRIVATE on each side, end platforms with railings, two bogies on their wheels. Tipped and settled.
  const railcar = cached(() => {
    const L = 7.2, W = 2.3, parts = [box({ w: 2.0, h: 0.26, d: L - 0.4, color: INK.iron, offset: { y: 0.92 } })];
    for (const z of [-2.4, 2.4]) {
      parts.push(box({ w: 1.7, h: 0.42, d: 1.9, color: INK.iron, offset: { y: 0.58, z } }));
      for (const dz of [-0.62, 0.62]) for (const x of [-0.86, 0.86]) parts.push(moved(turnedZ(drum(0.4, -0.06, 0.06, INK.rust), Math.PI / 2), x, 0.4, z + dz));
    }
    parts.push(box({ w: W, h: 2.1, d: L, color: INK.car, offset: { y: 2.1 } }));
    parts.push(box({ w: W + 0.2, h: 0.2, d: L + 0.3, color: INK.carDk, offset: { y: 3.25 } }));
    parts.push(box({ w: 1.2, h: 0.28, d: L - 1.2, color: INK.carDk, offset: { y: 3.49 } }));
    for (const side of [-1, 1]) {
      const x = side * (W / 2 + 0.015);
      parts.push(box({ w: 0.03, h: 0.07, d: L - 0.2, color: INK.gold, offset: { x, y: 1.5 } }));
      for (let k = 0; k < 6; k++) parts.push(box({ w: 0.03, h: 0.72, d: 0.72, color: (k * 3 + side + 4) % 5 === 0 ? INK.scorch : INK.glass, offset: { x, y: 2.35, z: -2.75 + k * 1.1 } }));
      for (const [y, z, s] of [[1.25, -2.9, 0.5], [2.9, 1.6, 0.4], [1.2, 2.2, 0.6]]) parts.push(box({ w: 0.03, h: s * 0.7, d: s, color: INK.rust, offset: { x: x + side * 0.01, y, z: z * side } }));
      parts.push(moved(turnedY(carved("PRIVATE", 0.06, INK.gold, 0.15, 0, 1.75, 0), side * Math.PI / 2), side * W / 2, 0, 0));
      for (const z of [-1, 1]) {
        parts.push(box({ w: W, h: 0.12, d: 0.8, color: INK.iron, offset: { y: 1.0, z: z * (L / 2 + 0.4) } }));
        parts.push(box({ w: 0.05, h: 0.9, d: 0.05, color: INK.iron, offset: { x: side * (W / 2 - 0.05), y: 1.5, z: z * (L / 2 + 0.75) } }));
        parts.push(box({ w: 0.05, h: 0.05, d: 0.8, color: INK.iron, offset: { x: side * (W / 2 - 0.05), y: 1.95, z: z * (L / 2 + 0.4) } }));
      }
    }
    const geo = merge(...parts), shell = box({ w: W + 0.2, h: 3.63, d: L + 1.6, color: SHELL, offset: { y: 1.815 } });
    for (const g of [geo, shell]) turnedX(turnedZ(g, -0.08), 0.02);
    seat(0.12, geo, shell);
    return solid(geo, shell);
  });
  // The money printer, facing +z: an iron frame on a plinth, BRRR on its beam, a tray of fresh notes out front. Its two
  // rollers and its flywheel are their own geometry, spun by `update`.
  const press = cached(() => {
    const parts = [box({ w: 3.0, h: 0.3, d: 2.0, color: INK.iron, offset: { y: 0.15 } })];
    for (const x of [-1.3, 1.3]) parts.push(box({ w: 0.25, h: 2.3, d: 1.8, color: INK.iron, offset: { x, y: 1.45 } }));
    parts.push(box({ w: 2.85, h: 0.36, d: 0.5, color: INK.rust, offset: { y: 2.45 } }));
    parts.push(carved("BRRR", 0.07, INK.gold, 0.3, 0, 2.45, 0.25));
    parts.push(box({ w: 2.0, h: 0.08, d: 0.9, color: INK.iron, offset: { y: 0.72, z: 1.35 } }));
    for (const x of [-0.85, 0.85]) parts.push(box({ w: 0.08, h: 0.42, d: 0.08, color: INK.iron, offset: { x, y: 0.47, z: 1.7 } }));
    parts.push(moved(turnedX(box({ w: 1.6, h: 0.01, d: 0.9, color: INK.note }), 0.75), 0, 1.05, 0.95));
    const rand = mulberry32(1971);
    for (let i = 0; i < 14; i++) parts.push(moved(turnedY(box({ w: 0.34, h: 0.03, d: 0.16, color: i % 3 ? INK.note : INK.paper }), (rand() - 0.5) * 0.5), (rand() - 0.5) * 1.2, 0.77 + i * 0.03, 1.35 + (rand() - 0.5) * 0.3));
    return solid(merge(...parts), box({ w: 3.0, h: 2.63, d: 2.4, color: SHELL, offset: { y: 1.315, z: 0.2 } }));
  });
  const roller = cached(() => {
    const parts = [turnedZ(drum(0.32, -1.15, 1.15, INK.steel, 12), Math.PI / 2)];
    for (let k = 0; k < 4; k++) parts.push(turnedX(box({ w: 2.2, h: 0.06, d: 0.2, color: INK.note, offset: { y: 0.31 } }), k / 4 * TAU));
    return merge(...parts);
  });
  const flywheel = cached(() => {
    const parts = [lathe({ profile: [[0.72, -0.07], [0.9, -0.07], [0.9, 0.07], [0.72, 0.07], [0.72, -0.07]], segments: 14, color: INK.iron }), drum(0.14, -0.12, 0.12, INK.rust, 8)];
    parts.push(box({ w: 1.5, h: 0.08, d: 0.1, color: INK.iron }), box({ w: 0.1, h: 0.08, d: 1.5, color: INK.iron }));
    return turnedZ(merge(...parts), Math.PI / 2);
  });
  // The gold vault, facing +z: a granite block under a cornice, EO 6102 over its round door, the door swung wide on
  // its hinge and the hole behind it empty. Its shell a box for the block and one round the door.
  const vault = cached(() => {
    const cy = 1.15, parts = [box({ w: 3.0, h: 2.8, d: 3.0, color: INK.vault, offset: { y: 1.4 } }), box({ w: 3.3, h: 0.3, d: 3.2, color: INK.granite, offset: { y: 2.95 } })];
    parts.push(moved(turnedX(drum(0.95, 0, 0.04, INK.hole, 14), Math.PI / 2), 0, cy, 1.5));
    parts.push(moved(turnedX(lathe({ profile: [[0.95, 0], [1.15, 0], [1.15, 0.1], [0.95, 0.1], [0.95, 0]], segments: 14, color: INK.steel }), Math.PI / 2), 0, cy, 1.5));
    parts.push(carved("EO 6102", 0.07, INK.gold, 0.25, 0, 2.56, 1.5));
    const door = [turnedX(drum(1.0, -0.2, 0.2, INK.steel, 14), Math.PI / 2)];
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * TAU;
      door.push(box({ w: 0.12, h: 0.12, d: 0.44, color: INK.iron, offset: { x: Math.cos(a) * 0.86, y: Math.sin(a) * 0.86 } }));
    }
    door.push(box({ w: 0.9, h: 0.07, d: 0.07, color: INK.iron, offset: { z: 0.3 } }), box({ w: 0.07, h: 0.9, d: 0.07, color: INK.iron, offset: { z: 0.3 } }), box({ w: 0.08, h: 0.08, d: 0.2, color: INK.iron, offset: { z: 0.22 } }));
    // Hinged at the opening's right edge and swung out round it.
    const hinge = { x: 1.1, z: 1.75 }, open = moved(turnedY(moved(merge(...door), -hinge.x, 0, 0), 1.9), hinge.x, cy, hinge.z);
    parts.push(open);
    return solid(merge(...parts), merge(box({ w: 3.0, h: 3.1, d: 3.0, color: SHELL, offset: { y: 1.55 } }), hull(open)));
  });
  // The gold window, facing +z: a marble teller's booth, its grille barred and its shutter half down on CLOSED, the date
  // under the ledge.
  const booth = cached(() => {
    const parts = [box({ w: 2.4, h: 2.9, d: 1.4, color: INK.marble, offset: { y: 1.45 } }), box({ w: 2.6, h: 0.3, d: 1.6, color: INK.marbleDk, offset: { y: 3.05 } })];
    parts.push(box({ w: 1.4, h: 0.9, d: 0.04, color: INK.hole, offset: { y: 1.45, z: 0.71 } }));
    for (let k = 0; k < 7; k++) parts.push(box({ w: 0.05, h: 0.9, d: 0.05, color: INK.iron, offset: { x: -0.6 + k * 0.2, y: 1.45, z: 0.76 } }));
    parts.push(box({ w: 1.44, h: 0.48, d: 0.04, color: INK.rust, offset: { y: 1.66, z: 0.8 } }));
    parts.push(carved("CLOSED", 0.04, INK.paper, 0.1, 0, 1.66, 0.82));
    parts.push(box({ w: 1.6, h: 0.08, d: 0.35, color: INK.marbleDk, offset: { y: 0.96, z: 0.87 } }));
    parts.push(carved("GOLD WINDOW", 0.045, INK.gold, 0.25, 0, 2.55, 0.7));
    parts.push(carved("15 AUG 1971", 0.04, INK.ink, 0, 0, 0.6, 0.7));
    return solid(merge(...parts), box({ w: 2.6, h: 3.2, d: 1.8, color: SHELL, offset: { y: 1.6, z: 0.1 } }));
  });
  // The Bretton Woods tablet, facing +z, broken across: the lower half stands on its plinth reading WOODS 1944, the top
  // half lies face up in front of it reading BRETTON.
  const tablet = cached(() => {
    const parts = [box({ w: 2.5, h: 0.25, d: 0.7, color: INK.stoneDk, offset: { y: 0.125 } }), box({ w: 2.2, h: 1.1, d: 0.4, color: INK.marbleDk, offset: { y: 0.8 } })];
    for (const [x, h] of [[-0.825, 0.32], [-0.275, 0.12], [0.275, 0.24], [0.825, 0.06]]) parts.push(box({ w: 0.55, h, d: 0.4, color: INK.marbleDk, offset: { x, y: 1.35 + h / 2 } }));
    parts.push(carved("WOODS 1944", 0.05, INK.ink, 0, 0, 0.85, 0.2));
    const top = merge(box({ w: 2.2, h: 1.0, d: 0.35, color: INK.marbleDk, offset: { y: 0.5 } }), carved("BRETTON", 0.065, INK.ink, 0, 0, 0.55, 0.175));
    turnedX(top, -Math.PI / 2 + 0.3);
    seat(0.05, top);
    let lo = Infinity;
    for (let i = 2; i < top.verts.length; i += 3) lo = Math.min(lo, top.verts[i]);
    moved(top, 0, 0, 0.45 - lo);
    parts.push(top);
    return solid(merge(...parts), merge(box({ w: 2.5, h: 1.67, d: 0.7, color: SHELL, offset: { y: 0.835 } }), hull(top)));
  });
  // The 1913 dollar's plinth, facing +z: 1913 over 0.03 on its column, and on top, inside the faint outline of the
  // dollar it was, the three cents of it left.
  const plinth = cached(() => {
    const stack = [box({ w: 1.6, h: 0.3, d: 1.6, color: INK.stoneDk, offset: { y: 0.15 } }), box({ w: 1.1, h: 1.5, d: 1.1, color: INK.stone, offset: { y: 1.05 } }), box({ w: 1.4, h: 0.2, d: 1.4, color: INK.stoneDk, offset: { y: 1.9 } })];
    const coin = moved(turnedX(drum(0.16, -0.02, 0.02, INK.gold, 12, 0.35), Math.PI / 2), 0, 2.16, 0);
    const ring = [];
    for (let k = 0; k <= 32; k++) ring.push({ x: Math.cos(k / 32 * TAU) * 0.9, y: 2.9 + Math.sin(k / 32 * TAU) * 0.9, z: 0 });
    const ghost = polyline({ points: ring, color: INK.marble, emissive: 0.15 });
    const geo = merge(...stack, coin, ghost, carved("1913", 0.07, INK.gold, 0.25, 0, 1.45, 0.55), carved("0.03", 0.07, INK.gold, 0.25, 0, 0.95, 0.55));
    geo.lineWidth = 2;
    return solid(geo, merge(...stack.map((g) => hull(g))));
  });
  // The billboard, facing +z: the hundred trillion dollar note on two posts, leaning.
  const billboard = cached(() => {
    const parts = [], shell = [];
    for (const x of [-1.9, 1.9]) {
      parts.push(bevelBox({ w: 0.22, h: 4.1, d: 0.22, color: INK.timberDk, offset: { x, y: 2.05, z: -0.22 } }));
      shell.push(box({ w: 0.22, h: 4.1, d: 0.22, color: SHELL, offset: { x, y: 2.05, z: -0.22 } }));
    }
    parts.push(box({ w: 4.8, h: 2.0, d: 0.14, color: INK.board, offset: { y: 3.2 } }));
    shell.push(box({ w: 4.8, h: 2.0, d: 0.14, color: SHELL, offset: { y: 3.2 } }));
    for (const [w, h, x, y] of [[4.9, 0.12, 0, 4.2], [4.9, 0.12, 0, 2.2], [0.12, 2.1, -2.42, 3.2], [0.12, 2.1, 2.42, 3.2]]) parts.push(box({ w, h, d: 0.18, color: INK.boardInk, offset: { x, y } }));
    parts.push(carved("100 TRILLION", 0.085, INK.boardInk, 0, 0, 3.55, 0.07), carved("ZIMBABWE 2009", 0.06, INK.boardInk, 0, 0, 2.75, 0.07));
    const geo = merge(...parts), hullGeo = merge(...shell);
    for (const g of [geo, hullGeo]) turnedX(turnedZ(g, 0.05), -0.06);
    return solid(geo, hullGeo);
  });
  // A Weimar wheelbarrow heaped with bundled marks, wheel to +z.
  const wheelbarrow = cached(() => {
    const rand = mulberry32(1923), parts = [box({ w: 0.8, h: 0.35, d: 1.0, color: INK.rust, offset: { y: 0.62 } })];
    parts.push(moved(turnedZ(drum(0.26, -0.05, 0.05, INK.iron), Math.PI / 2), 0, 0.26, 0.62));
    for (const x of [-0.32, 0.32]) {
      parts.push(moved(turnedX(box({ w: 0.06, h: 0.06, d: 1.3, color: INK.timber }), 0.15), x, 0.6, -0.6));
      parts.push(box({ w: 0.05, h: 0.42, d: 0.05, color: INK.iron, offset: { x, y: 0.21, z: -0.32 } }));
    }
    for (let i = 0; i < 12; i++) parts.push(moved(turnedY(box({ w: 0.3, h: 0.08, d: 0.15, color: i % 2 ? INK.mark : INK.markLt }), rand() * TAU), (rand() - 0.5) * 0.5, 0.84 + rand() * 0.22, (rand() - 0.5) * 0.7));
    const geo = merge(...parts);
    return solid(geo, hull(geo));
  });
  // The burn barrel and the fire in it, the flame its own glowing geometry for the hub's lamp.
  const barrel = cached(() => {
    const parts = [lathe({ profile: [[0, 0], [0.38, 0], [0.4, 0.06], [0.4, 0.94], [0.38, 1.0], [0, 1.0]], segments: 10, color: INK.rust }), drum(0.415, 0.3, 0.36, INK.iron, 10), drum(0.415, 0.64, 0.7, INK.iron, 10), drum(0.36, 1.0, 1.01, INK.scorch, 10)];
    for (const [x, z, a] of [[0.12, 0.05, 0.4], [-0.1, -0.12, -0.5]]) parts.push(moved(turnedZ(box({ w: 0.16, h: 0.3, d: 0.01, color: INK.note }), a), x, 1.08, z));
    return solid(merge(...parts), box({ w: 0.8, h: 1.0, d: 0.8, color: SHELL, offset: { y: 0.5 } }));
  });
  const flame = cached(() => noShadow(merge(
    lathe({ profile: [[0, 0], [0.3, 0.05], [0, 0.75]], segments: 7, color: INK.flame, emissive: 1 }),
    moved(lathe({ profile: [[0, 0], [0.16, 0.04], [0, 0.45]], segments: 6, color: INK.flameCore, emissive: 1 }), 0.05, 0.02, 0.04)
  )));
  // The genesis stone, facing +z: dark granite carrying ₿ and the day of Bitcoin's first block. Its carving is its own
  // geometry, so `update` can let it breathe.
  const genesis = cached(() => {
    const stack = [box({ w: 1.8, h: 0.3, d: 0.8, color: INK.stoneDk, offset: { y: 0.15 } }), box({ w: 1.5, h: 2.1, d: 0.45, color: INK.granite, offset: { y: 1.35 } })];
    return solid(merge(stack[0], bevelBox({ w: 1.5, h: 2.1, d: 0.45, color: INK.granite, offset: { y: 1.35 } })), merge(...stack));
  });
  const genesisMark = cached(() => {
    const c = 0.13, parts = [carved("B", c, INK.orange, 1, 0, 1.85, 0.225)];
    for (const x of [-0.35 * c, 0.4 * c]) for (const y of [1.85 + 3 * c, 1.85 - 3 * c]) parts.push(box({ w: 0.5 * c, h: c, d: 0.08, color: INK.orange, emissive: 1, offset: { x, y, z: 0.265 } }));
    parts.push(carved("03 JAN 2009", 0.034, INK.orange, 0.8, 0, 1.0, 0.225), carved("BLOCK 0", 0.04, INK.orange, 0.8, 0, 0.7, 0.225));
    return noShadow(merge(...parts));
  });
  // A dead live oak: a short trunk, limbs sprawling wide the way live oaks grow, and Spanish moss hanging from them.
  const oak = variants((i) => {
    const rand = mulberry32(1910 + i * 31), geo = { verts: [], faces: [], lines: [], smooth: true, normals: [] };
    const BARK = hexToRgb(INK.bark), MOSS = hexToRgb(INK.moss), lean = (rand() - 0.5) * 0.4, top = 1.9 + rand() * 0.4, hang = [];
    limb(geo, 0, -0.1, 0, lean, top, 0, 0.36, 0.26, 7, BARK);
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * TAU + rand() * 0.9, reach = 2.4 + rand() * 1.4;
      const mx = lean + Math.cos(a) * reach * 0.55, my = top + 0.7 + rand() * 0.5, mz = Math.sin(a) * reach * 0.55;
      const ex = lean + Math.cos(a) * reach, ey = top + 0.2 + rand() * 0.6, ez = Math.sin(a) * reach;
      limb(geo, lean, top - 0.1, 0, mx, my, mz, 0.2, 0.13, 6, BARK);
      limb(geo, mx, my, mz, ex, ey, ez, 0.13, 0.05, 5, BARK);
      limb(geo, mx, my, mz, mx + (rand() - 0.5) * 0.8, my + 0.6 + rand() * 0.4, mz + (rand() - 0.5) * 0.8, 0.07, 0.02, 4, BARK);
      hang.push([mx, my, mz], [(mx + ex) / 2, (my + ey) / 2, (mz + ez) / 2], [ex, ey, ez]);
    }
    for (const [x, y, z] of hang) for (let s = 0; s < 2; s++) {
      const ox = x + (rand() - 0.5) * 0.3, oz = z + (rand() - 0.5) * 0.3, len = 0.7 + rand() * 0.8;
      limb(geo, ox, y - 0.05, oz, ox + (rand() - 0.5) * 0.1, y - len, oz + (rand() - 0.5) * 0.1, 0.07, 0.015, 4, MOSS);
    }
    padNormals(geo);
    geo.normals = Float32Array.from(geo.normals);
    geo.collisionGeometry = box({ w: 0.6, h: top + 0.1, d: 0.6, color: SHELL, offset: { x: lean / 2, y: top / 2 } });
    return geo;
  });
  // A duck decoy, head to +z.
  const decoy = cached(() => noShadow(merge(
    bevelBox({ w: 0.24, h: 0.18, d: 0.46, color: INK.duck, offset: { y: 0.11 } }),
    bevelBox({ w: 0.13, h: 0.14, d: 0.15, color: INK.duckHead, offset: { y: 0.27, z: 0.17 } }),
    box({ w: 0.07, h: 0.04, d: 0.1, color: INK.bill, offset: { y: 0.25, z: 0.29 } }),
    box({ w: 0.15, h: 0.03, d: 0.12, color: INK.paper, offset: { y: 0.2, z: 0.13 } }),
    box({ w: 0.16, h: 0.06, d: 0.1, color: INK.duckDk, offset: { y: 0.18, z: -0.26 } })
  )));
  // Old notes trodden flat across the ground.
  const litter = cached(() => {
    const rand = mulberry32(2008), parts = [];
    for (let i = 0; i < 46; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * (ROCK.radius - 3);
      parts.push(moved(turnedY(box({ w: 0.34, h: 0.006, d: 0.16, color: i % 4 ? INK.note : INK.paper }), rand() * TAU), Math.cos(a) * r, 0.004, Math.sin(a) * r));
    }
    return noShadow(merge(...parts));
  });

  // The Fiat Clock, facing +z: a granite tablet on two stone legs carved FIAT CLOCK, under a marble clock face whose
  // hands tell Moscow time (sats per dollar, read as a clock). The hands are their own geometry, turned by `update`;
  // `CLOCK.y` and `CLOCK.z` are the face's middle and front.
  const CLOCK = { y: 2.35, z: 0.2, r: 0.55 };
  const fiatClock = cached(() => {
    const stack = [box({ w: 1.8, h: 0.3, d: 0.6, color: INK.stoneDk, offset: { y: 0.15 } })];
    for (const x of [-0.6, 0.6]) stack.push(box({ w: 0.3, h: 0.5, d: 0.3, color: INK.stone, offset: { x, y: 0.55 } }));
    stack.push(box({ w: 1.8, h: 1.0, d: 0.3, color: INK.granite, offset: { y: 1.3 } }));
    const parts = [...stack, carved("FIAT", 0.07, INK.gold, 0.3, 0, 1.55, 0.15), carved("CLOCK", 0.07, INK.gold, 0.3, 0, 1.08, 0.15)];
    parts.push(moved(turnedX(drum(CLOCK.r + 0.08, -0.08, 0.08, INK.stoneDk, 16), Math.PI / 2), 0, CLOCK.y, 0));
    parts.push(moved(turnedX(drum(CLOCK.r, 0, 0.04, INK.marble, 16), Math.PI / 2), 0, CLOCK.y, 0.08));
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * TAU, long = k % 3 === 0 ? 0.12 : 0.06;
      parts.push(moved(turnedZ(box({ w: 0.03, h: long, d: 0.02, color: INK.ink }), -a), Math.sin(a) * (CLOCK.r - 0.04 - long / 2), CLOCK.y + Math.cos(a) * (CLOCK.r - 0.04 - long / 2), 0.13));
    }
    stack.push(box({ w: 1.3, h: 1.3, d: 0.2, color: SHELL, offset: { y: CLOCK.y } }));
    return solid(merge(...parts), merge(...stack.map((g) => hull(g))));
  });
  // A clock hand pointing up from its pivot, so turning the node about z sweeps it round the face.
  const clockHand = variants((long) => noShadow(merge(box({ w: long ? 0.03 : 0.05, h: long ? 0.46 : 0.3, d: 0.02, color: INK.ink, offset: { y: long ? 0.2 : 0.13 } }), drum(0.04, -0.01, 0.01, INK.gold, 8))));
  // The handcar, symmetric along z with its wheels on the rails at y = 0: a timber deck on two axles, a bench across
  // one end, and the A-frame the pump lever rocks on. The lever is its own geometry, rocked by `update`.
  const handcar = cached(() => {
    const H = HANDCAR, parts = [bevelBox({ w: 1.7, h: 0.1, d: 2 * H.half, color: INK.timber, offset: { y: H.deck - 0.05 } })];
    for (const z of [-0.7, 0.7]) {
      parts.push(box({ w: 1.6, h: 0.08, d: 0.08, color: INK.iron, offset: { y: 0.26, z } }));
      for (const x of [-0.72, 0.72]) parts.push(moved(turnedZ(drum(0.26, -0.05, 0.05, INK.rust, 12), Math.PI / 2), x, 0.26, z));
      for (const x of [-0.6, 0.6]) parts.push(box({ w: 0.08, h: 0.2, d: 0.08, color: INK.iron, offset: { x, y: 0.4, z } }));
    }
    parts.push(bevelBox({ w: 1.3, h: 0.08, d: 0.4, color: INK.timberDk, offset: { y: H.deck + H.bench - 0.04, z: -0.75 } }));
    for (const x of [-0.55, 0.55]) parts.push(box({ w: 0.08, h: H.bench - 0.08, d: 0.3, color: INK.timberDk, offset: { x, y: H.deck + (H.bench - 0.08) / 2, z: -0.75 } }));
    for (const z of [-0.18, 0.18]) parts.push(moved(turnedX(box({ w: 0.12, h: 0.85, d: 0.1, color: INK.iron }), z > 0 ? -0.2 : 0.2), 0, H.deck + 0.4, z));
    parts.push(box({ w: 0.3, h: 0.14, d: 0.14, color: INK.rust, offset: { y: H.deck + 0.82 } }));
    return merge(...parts);
  });
  const lever = cached(() => merge(
    bevelBox({ w: 0.1, h: 0.1, d: 1.8, color: INK.timberDk }),
    ...[-0.9, 0.9].map((z) => bevelBox({ w: 0.9, h: 0.08, d: 0.08, color: INK.timber, offset: { z } }))
  ));

  // ---- where it stands --------------------------------------------------------------------------------

  // The rim at the top of the south stairs, its floor, and the islet's middle a head and a span out past it, level
  // with the floor, turned so local +z runs back along the axis (z = dist - along). Throws on ground it cannot keep.
  const SPOTS = new WeakMap();
  const spot = (island) => {
    let s = SPOTS.get(island);
    if (s) return s;
    const ux = Math.sin(AXIS.bearing), uz = -Math.cos(AXIS.bearing), px = -uz, pz = ux;
    const ground = (a, c) => island.surfaceAt(ux * a + px * c, uz * a + pz * c);
    let rim = AXIS.from;
    while (ground(rim + 0.05, 0) > 0.5) rim += 0.05;
    const floor = ground(rim - AXIS.floor, 0);
    for (let a = rim - HEAD.back; a <= rim + HEAD.over + 1e-6; a += 0.05) for (let c = -HEAD.half; c <= HEAD.half + 1e-6; c += 0.1) {
      const g = ground(a, c);
      if (g > floor + 0.05) throw new Error(`Jekyll Island's trestle head would sit on uneven ground (${g.toFixed(2)} m against the landing's ${floor.toFixed(2)})`);
    }
    const dist = rim + HEAD.over + Z_OUT, x = ux * dist, z = uz * dist;
    const pool = BL.poolModels.spot(island, {}), T = BL.timechainModels, out = Math.max(0, x * T.DIR.x + z * T.DIR.z);
    for (const [name, ox, oz, r] of [["Mempool island", pool.x, pool.z, BL.poolModels.SITE.reach], ["Timechain Sphere", T.DIR.x * out, T.DIR.z * out, T.SITE.radius]]) {
      const apart = Math.hypot(ox - x, oz - z) - r - ROCK.radius;
      if (apart < CLEAR) throw new Error(`Jekyll Island comes within ${apart.toFixed(1)} m of the ${name}`);
    }
    s = { x, y: floor, z, ry: -AXIS.bearing, rim, dist };
    SPOTS.set(island, s);
    return s;
  };

  // Where each piece stands in the islet's frame, x across and z toward the island, with the plaza in the middle. A
  // relic faces the plaza unless it gives its own turn.
  const PLAZA = { x: 0, z: 1 };
  const AT = {
    club: [0, -5.5, 0], turret: [4.5, -8.25, 0], roof: [7.0, -7.0, 0.6], railcar: [-3.9, 6.8, 0.06],
    press: [8.0, 0.6], booth: [8.4, 4.8], tablet: [7.6, -3.6], plinth: [0, 0.6, 0], barrel: [2.6, 2.8, 0],
    vault: [-8.4, 0.2], billboard: [-8.0, -5.0], genesis: [-9.8, 5.2], wheelbarrow: [4.6, 8.0, 2.4],
    welcome: [3.4, 10.2, 0], ducksign: [-6.6, 9.4, 0.5], fiatclock: [-2.6, 1.6, 0.35]
  };
  const DECOYS = [[-5.4, 10.2, 2.1], [-8.2, 8.2, 0.7], [6.6, 9.6, -1.2], [10.6, -1.4, 3.0], [-2.2, -10.4, 1.4]];
  const OAKS = [[-6.2, -9.0, 0.3], [10.2, -5.8, 2.2], [2.2, -10.6, 4.1]];
  const facing = ([x, z, ry]) => ry !== undefined ? ry : Math.atan2(PLAZA.x - x, PLAZA.z - z);
  // The Money Line's station beside the track's end, while its scene is open, and where an Ooga coming back from it
  // stands, facing the plaza.
  const STATION = { sign: [2.4, 4.6, -0.5], arrive: [0.9, 2.4] };

  // The rails' top along the line, in the islet's frame: up the deck's lift where the trestle meets the islet.
  const railY = (z) => {
    const t = Math.min(1, Math.max(0, (z - Z_END + 0.3) / 0.6));
    return DECK.lift * t * t * (3 - 2 * t) + RAIL_TOP;
  };
  // The handcar's seat in the world from where the car is: on its bench, facing the way it is going (or will go), and
  // `walkAt` beside it on the deck or the islet, with the floor there.
  const placeSeat = (car, y0) => {
    const f = car.frame, seat = car.seat, lz = car.z - 0.75, ax = HANDCAR.step;
    const out = car.to !== car.z ? car.to < car.z : car.z > (car.ends[0] + car.ends[1]) / 2;
    seat.x = f.x + lz * f.sr;
    seat.z = f.z + lz * f.cr;
    seat.y = y0 + railY(car.z) + HANDCAR.deck + HANDCAR.seat;
    seat.ry = out ? Math.atan2(-f.sr, -f.cr) : Math.atan2(f.sr, f.cr);
    seat.floor = y0 + (car.z > Z_END ? DECK.lift : 0);
    seat.walkAt.x = f.x + ax * f.cr + car.z * f.sr;
    seat.walkAt.z = f.z - ax * f.sr + car.z * f.cr;
  };
  // Sends a standing handcar to the other end of the line; false while it is already rolling.
  const depart = (site) => {
    const car = site.car;
    if (car.to !== car.z) return false;
    car.to = Math.abs(car.z - car.ends[0]) < Math.abs(car.z - car.ends[1]) ? car.ends[1] : car.ends[0];
    car.wait = 0;
    return true;
  };
  // The handcar's seat, if a body whose feet are at `feet` stands within reach of the standing, empty car.
  const handcarNear = (site, x, feet, z, reach) => {
    const car = site.car, f = car.frame;
    if (car.to !== car.z || car.seat.sitter || car.hold) return null;
    const cx = f.x + car.z * f.sr, cz = f.z + car.z * f.cr, r = HANDCAR.half + reach;
    if ((x - cx) ** 2 + (z - cz) ** 2 > r * r || Math.abs(feet - car.seat.floor) > 0.6) return null;
    return car.seat;
  };

  // The visit's nodes under one group at the islet's middle, turned by `spot.ry`, and the records the hub places them by.
  const site = (s, opts = {}) => {
    const sr = Math.sin(s.ry), cr = Math.cos(s.ry), wx = (x, z) => s.x + x * cr + z * sr, wz = (x, z) => s.z - x * sr + z * cr;
    const node = createNode({ position: { x: s.x, y: s.y, z: s.z }, rotation: { x: 0, y: s.ry, z: 0 } });
    const at = (geometry, [x, z, ry], y = 0, extra = {}) => createNode({ geometry, position: { x, y, z }, rotation: { x: 0, y: facing([x, z, ry]), z: 0 }, ...extra });
    const hidden = (geometry, place, y, extra = {}) => at(geometry, place, y, { sightHidden: true, ...extra });
    const islet = createNode({ geometry: rock() }), bridge = createNode({ geometry: deck() }), stone = createNode({ geometry: head() });
    const ruins = [], picks = [];
    const pick = (kind, n, r) => picks.push({ kind, node: n, x: wx(n.position.x, n.position.z), z: wz(n.position.x, n.position.z), r });
    const relic = (kind, geometry, place, r, y = 0) => {
      const n = at(geometry, place, y);
      ruins.push(n);
      pick(kind, n, r);
      return n;
    };
    const span = (Z_END + Z_OUT) / 2;
    picks.push({ kind: "jekyllbridge", node: bridge, x: wx(0, span), z: wz(0, span), r: 2 * DECK.half });
    const club = relic("clubhouse", clubhouse(), AT.club, 4.6);
    relic("jekylltable", table(), AT.club, 2.4, CLUB.floor);
    relic("jekyllturret", turret(), AT.turret, 1.6);
    relic("jekyllturret", turretRoof(), AT.roof, 1.6);
    relic("railcar", railcar(), AT.railcar, 3.6);
    const printer = relic("moneyprinter", press(), AT.press, 1.8);
    relic("goldwindow", booth(), AT.booth, 1.4);
    relic("bretton", tablet(), AT.tablet, 1.4);
    relic("dollarplinth", plinth(), AT.plinth, 1.2);
    relic("goldvault", vault(), AT.vault, 2);
    relic("zimbabwe", billboard(), AT.billboard, 2.6);
    relic("weimarbarrow", wheelbarrow(), AT.wheelbarrow, 0.9);
    const fire = relic("burnbarrel", barrel(), AT.barrel, 0.6);
    const stoneNode = relic("genesisstone", genesis(), AT.genesis, 1.1);
    for (const [k, place] of OAKS.entries()) relic("deadoak", oak(k % 2), place, 1.2);
    const clock = relic("fiatclock", fiatClock(), AT.fiatclock, 1.2);
    const hands = [0, 1].map((long) => createNode({ geometry: clockHand(long), position: { x: 0, y: CLOCK.y, z: CLOCK.z - 0.04 + long * 0.025 }, sightHidden: true }));
    addChild(clock, ...hands);
    // The handcar waits at the island's end of the line. Its seat is a bench the crew sits the played Ooga on, moved
    // along with it; `walkAt` is beside the car, where a rider stands up.
    const carAt = Z_OUT - HANDCAR.half - 0.25;
    const carNode = createNode({ geometry: handcar(), position: { x: 0, y: railY(carAt), z: carAt }, sightHidden: true });
    const pump = createNode({ geometry: lever(), position: { x: 0, y: HANDCAR.deck + 0.88, z: 0 }, sightHidden: true });
    addChild(carNode, pump);
    picks.push({ kind: "handcar", node: carNode, x: wx(0, carAt), z: wz(0, carAt), r: 1.4 });
    // The printer's moving parts, in its frame: the rollers between the side plates, the flywheel outside the right one.
    const rollers = [[1.05, 0.2], [1.72, 0.2]].map(([y, z]) => createNode({ geometry: roller(), position: { x: 0, y, z }, sightHidden: true }));
    const wheel = createNode({ geometry: flywheel(), position: { x: 1.55, y: 1.4, z: -0.1 }, sightHidden: true });
    addChild(printer, ...rollers, wheel);
    const blaze = hidden(flame(), AT.barrel, 0.98, { scale: { x: 1, y: 1, z: 1 } });
    const mark = createNode({ geometry: genesisMark(), sightHidden: true });
    addChild(stoneNode, mark);
    const signs = [["jekyllsign", BL.hubModels.postSign("Jekyll Island", 0.62, 1.0), AT.welcome, 1.4], ["ducksign", BL.hubModels.postSign("Duck Hunting", 0.42, 0.7), AT.ducksign, 1]];
    const decor = [hidden(track(), [0, 0, 0]), hidden(clubDebris(), AT.club), hidden(litter(), [0, 0, 0])];
    for (const [kind, geometry, place, r] of signs) {
      const n = hidden(geometry, place);
      decor.push(n);
      pick(kind, n, r);
    }
    for (const place of DECOYS) {
      const n = hidden(decoy(), place);
      decor.push(n);
      pick("duckdecoy", n, 0.45);
    }
    let station = null;
    if (opts.moneyline) {
      const n = hidden(BL.hubModels.postSign("The Money Line", 0.5, 0.9), STATION.sign);
      decor.push(n);
      pick("moneylinestation", n, 1.3);
      const [ax, az] = STATION.arrive, [sx, sz] = STATION.sign;
      station = {
        x: wx(sx, sz), z: wz(sx, sz), y: s.y,
        arrive: { x: wx(ax, az), z: wz(ax, az), y: s.y, target: { x: wx(PLAZA.x, PLAZA.z), y: s.y + 0.8, z: wz(PLAZA.x, PLAZA.z) } },
        // From the trestle's side, which the sign faces (local +z runs back toward the island).
        view: { yaw: s.ry + 0.4, pitch: 0.35, dist: 7, target: { x: wx(sx, sz), y: s.y + 1.2, z: wz(sx, sz) } }
      };
    }
    // The loose notes, each its own node, and their state: x, y, z, velocity, phase, and whether it is in the air.
    const rand = mulberry32(100), notes = { nodes: [], data: new Float32Array(NOTE.count * 8), next: 0 };
    for (let i = 0; i < NOTE.count; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * NOTE.reach * 0.9, o = i * 8;
      notes.data[o] = Math.cos(a) * r; notes.data[o + 1] = 0.05; notes.data[o + 2] = Math.sin(a) * r; notes.data[o + 6] = rand() * TAU;
      notes.nodes.push(createNode({ geometry: note(), sightHidden: true, position: { x: notes.data[o], y: 0.05, z: notes.data[o + 2] } }));
    }
    addChild(node, islet, bridge, stone, ...ruins, ...decor, blaze, carNode, ...notes.nodes);
    // The printer's mouth, in the islet's frame: where fresh notes fly out, and which way.
    const pr = printer.rotation.y, mouth = { x: printer.position.x + Math.sin(pr) * 1.4, z: printer.position.z + Math.cos(pr) * 1.4, dx: Math.sin(pr), dz: Math.cos(pr) };
    const groundAt = (x, z) => {
      const dx = x - s.x, dz = z - s.z, lx = dx * cr - dz * sr, lz = dx * sr + dz * cr;
      if (inBlock(Math.floor(lx), Math.floor(lz))) return s.y;
      if (Math.abs(lx) <= DECK.half && lz >= Z_END && lz <= Z_IN) return s.y + DECK.lift;
      return -Infinity;
    };
    const near = Z_IN + 0.5;
    const car = {
      node: carNode, pump, z: carAt, to: carAt, v: 0, phase: 0, wait: 0, arrived: false, hold: false,
      ends: [carAt, HANDCAR.islet], frame: { x: s.x, z: s.z, sr, cr },
      seat: { kind: "bench", handcar: true, x: 0, y: 0, z: 0, floor: 0, ry: 0, sitter: null, walkAt: { x: 0, z: 0 } }
    };
    placeSeat(car, s.y);
    return {
      node, islet, bridge, head: stone, club, floors: [islet, bridge, stone], ruins, picks, decor, notes, car, y: s.y, station,
      press: { rollers, wheel, print: 0, mouth }, flame: blaze, mark, hands, clock: { hour: 0, minute: 0, sats: 0 },
      chrono: { step: 0, flare: 0, paid: false },
      fire: { x: wx(AT.barrel[0], AT.barrel[1]), y: s.y + 1.3, z: wz(AT.barrel[0], AT.barrel[1]) },
      claims: [[s.x, s.z, ROCK.radius + 1], [wx(0, near), wz(0, near), HEAD.half + 0.8]],
      cloud: { x: s.x, z: s.z, r: ROCK.radius + 0.5, y: s.y, depth: ROCK.depth, drop: DECK.legs, head: { x: wx(0, Z_IN), z: wz(0, Z_IN) }, end: { x: wx(0, Z_END), z: wz(0, Z_END) }, width: 2 * DECK.half + 0.6 },
      radius: ROCK.radius,
      groundAt
    };
  };

  // ---- per frame --------------------------------------------------------------------------------------

  const respawn = (d, o) => {
    const across = (Math.random() * 2 - 1) * 7;
    d[o] = -WIND_X * NOTE.reach * 0.95 + WIND_Z * across;
    d[o + 2] = -WIND_Z * NOTE.reach * 0.95 - WIND_X * across;
    d[o + 1] = 0.05;
    d[o + 7] = 0;
  };
  // The printer runs: its rollers spin up for a while and a handful of notes fly out of its mouth.
  const print = (site) => {
    const p = site.press, m = p.mouth, n = site.notes, d = n.data;
    p.print = 2.5;
    for (let k = 0; k < NOTE.burst; k++) {
      const o = n.next * 8, side = (Math.random() - 0.5) * 1.6, speed = 1.6 + Math.random() * 1.4;
      n.next = (n.next + 1) % n.nodes.length;
      d[o] = m.x; d[o + 1] = 1.2; d[o + 2] = m.z;
      d[o + 3] = m.dx * speed + m.dz * side; d[o + 4] = 2.2 + Math.random() * 1.5; d[o + 5] = m.dz * speed - m.dx * side;
      d[o + 7] = 1;
    }
  };
  // A poke at a relic, for the dates puzzle: 1 when it was the next date in order, 2 when it finished the run (the
  // genesis stone flares), 0 otherwise. A date already reached keeps the run; any other date breaks it, or starts it
  // again when it is the first.
  const chrono = (site, kind) => {
    const year = LORE[kind] && LORE[kind].year, c = site.chrono;
    if (!year) return 0;
    if (year === CHRONO[c.step]) {
      c.step++;
      if (c.step < CHRONO.length) return 1;
      c.step = 0;
      c.flare = 1;
      return 2;
    }
    if (c.step && year === CHRONO[c.step - 1]) return 0;
    c.step = year === CHRONO[0] ? 1 : 0;
    return 0;
  };
  // The handcar: a rider sat on a standing car sets it off after a moment; it speeds up, rolls and brakes into the far
  // end, where it holds until its rider has got off. The lever rocks while it rolls and the seat goes with it.
  const roll = (site, dt) => {
    const car = site.car, H = HANDCAR;
    car.arrived = false;
    if (car.to === car.z) {
      if (!car.seat.sitter) car.hold = false;
      car.wait = car.seat.sitter && !car.hold ? car.wait + dt : 0;
      if (car.wait >= H.wait) depart(site);
    }
    if (car.to !== car.z) {
      const left = Math.abs(car.to - car.z);
      car.v = Math.min(H.speed, car.v + H.accel * dt, Math.sqrt(2 * H.accel * left) + 0.05);
      if (car.v * dt >= left) {
        car.z = car.to;
        car.v = 0;
        car.arrived = car.hold = true;
      } else car.z += Math.sign(car.to - car.z) * car.v * dt;
      car.phase = (car.phase + car.v * dt * 2.2) % TAU;
    }
    car.node.position.z = car.z;
    car.node.position.y = railY(car.z);
    car.pump.rotation.x = Math.sin(car.phase) * 0.32 * Math.min(1, car.v);
    placeSeat(car, site.y);
  };
  // The notes tumble downwind in hops, or fall when the printer threw them, and turn back upwind past the edge; the
  // printer's rollers creep, or spin while it prints; the flame licks and the genesis stone breathes, brighter for each
  // date poked in order and blazing when the run is done. The Fiat Clock's hands ease to Moscow time at `price` (US
  // dollars a bitcoin; 0 while unknown, which leaves them where they are). The handcar rolls.
  const update = (site, dt, elapsed, price) => {
    roll(site, dt);
    const clock = site.clock, ch = site.chrono;
    if (price > 0) {
      const sats = Math.round(1e8 / price), ease = Math.min(1, dt * 2);
      clock.sats = sats;
      clock.hour += ((sats / 100) % 12 / 12 * TAU - clock.hour) * ease;
      clock.minute += ((sats % 100) / 60 * TAU - clock.minute) * ease;
      site.hands[0].rotation.z = -clock.hour;
      site.hands[1].rotation.z = -clock.minute;
    }
    ch.flare = Math.max(0, ch.flare - dt * 0.5);
    const p = site.press, n = site.notes, d = n.data, gust = 1 + 0.5 * Math.sin(elapsed * 0.6);
    p.print = Math.max(0, p.print - dt);
    const turn = dt * (p.print > 0 ? 9 : 0.4);
    p.rollers[0].rotation.x = (p.rollers[0].rotation.x + turn) % TAU;
    p.rollers[1].rotation.x = (p.rollers[1].rotation.x - turn) % TAU;
    p.wheel.rotation.x = (p.wheel.rotation.x + turn * 0.5) % TAU;
    for (let i = 0, o = 0; i < n.nodes.length; i++, o += 8) {
      const ph = d[o + 6];
      if (d[o + 7] > 0) {
        const drag = Math.max(0, 1 - NOTE.drag * dt);
        d[o + 4] -= NOTE.gravity * dt;
        d[o] += d[o + 3] * dt; d[o + 1] += d[o + 4] * dt; d[o + 2] += d[o + 5] * dt;
        d[o + 3] *= drag; d[o + 5] *= drag;
        if (d[o + 1] <= 0.05) { d[o + 1] = 0.05; d[o + 7] = 0; }
      } else {
        const g = gust * (0.6 + 0.4 * Math.sin(elapsed * 1.7 + ph));
        d[o] += (WIND_X * g + Math.sin(elapsed * 0.9 + ph) * 0.25) * NOTE.wind * dt;
        d[o + 2] += (WIND_Z * g + Math.cos(elapsed * 1.1 + ph) * 0.25) * NOTE.wind * dt;
        d[o + 1] = 0.05 + Math.abs(Math.sin(elapsed * 2.3 + ph)) * NOTE.hop * g;
      }
      if (d[o] * d[o] + d[o + 2] * d[o + 2] > NOTE.reach * NOTE.reach) respawn(d, o);
      const node = n.nodes[i];
      node.position.x = d[o]; node.position.y = d[o + 1]; node.position.z = d[o + 2];
      node.rotation.x = (elapsed * 3.1 + ph * 5) % TAU;
      node.rotation.y = ph * 3;
      node.rotation.z = Math.sin(elapsed * 2 + ph) * 0.8;
    }
    site.flame.scale.y = 1 + 0.18 * Math.sin(elapsed * 13) * Math.sin(elapsed * 7.3);
    site.mark.glow = 0.75 + 0.25 * Math.sin(elapsed * 1.3) + 0.15 * ch.step + 2.5 * ch.flare;
  };

  // ---- what the ruins say -----------------------------------------------------------------------------

  // Each kind's tooltip, what a poke says (in turn), its particles (`notes`, `sparks` or `dust`), its wobble, and the
  // date it keeps for the puzzle (`year`). The Fiat Clock opens its board (`board`); the handcar rides (`ride`).
  const LORE = {
    fiatclock: { tip: "The Fiat Clock · live · tap to read it", board: true, say: [] },
    moneylinestation: { tip: "The Money Line · walk an Ooga up and press Space to ride back to the beginning", go: "moneyline", say: [
      "The Money Line runs back to the beginning of money. Only an Ooga may ride: double-tap one, walk it here and press Space."
    ] },
    handcar: { tip: "Handcar · walk an Ooga up and press Space to ride", ride: true, say: [
      "Pump, Ooga, pump. Jekyll Island never had a railway, so Ooga built one.",
      "The handcar creaks off across the trestle on its own."
    ] },
    jekyllbridge: { tip: "Rail trestle · to the ruins of Jekyll Island", say: ["The rails creak. Nobody rides to Jekyll Island any more.", "Jekyll Island never had a railway. Ooga built this one. Ooga likes trains."] },
    jekyllsign: { year: 1910, tip: "Jekyll Island · the ruins of fiat", say: ["November 1910: Senator Nelson Aldrich, Assistant Treasury Secretary A. Piatt Andrew and five bankers slipped away to the Jekyll Island Club, a millionaires' winter retreat on the Georgia coast.", "Welcome to the ruins. Mind the inflation."] },
    clubhouse: { year: 1910, tip: "Jekyll Island Club · the ruins", say: [
      "Here, in November 1910, Aldrich, Warburg, Vanderlip, Davison, Strong, Norton and Piatt Andrew drafted what became the Aldrich Plan.",
      "The Aldrich Plan stalled in Congress. Its bones came back as the Federal Reserve Act, signed on 23 December 1913.",
      "Vanderlip wrote later that he had been \"as secretive, indeed as furtive, as any conspirator\"."
    ] },
    jekylltable: { year: 1910, tip: "Seven chairs · first names only", say: [
      "They went by first names only, so not even the club's staff would know who was dining.",
      "The story goes that Vanderlip and Davison went further and answered to Orville and Wilbur.",
      "A week of meetings. Zero ducks. One central bank."
    ] },
    jekyllturret: { tip: "The clubhouse turret · fallen", say: ["The turret kept watch over the Jekyll River. It did not see 1913 coming."], fx: "dust" },
    railcar: { year: 1910, tip: "Aldrich's private rail car · end of the line", say: [
      "They boarded Senator Aldrich's private rail car in Hoboken at night and told the reporters nothing.",
      "The car took them to Brunswick, Georgia. A boat did the rest."
    ] },
    moneyprinter: { tip: "Money printer · it goes brrr", fx: "notes", say: [
      "BRRR.",
      "Inflation is transitory, says the printer, printing.",
      "The dollar has lost about 97% of what it bought in 1913. The printer is not sorry.",
      "Money printer go brrr. Ooga's bananas cost more already.",
      "Few understand."
    ] },
    goldvault: { year: 1933, tip: "Gold vault · empty since 1933", say: [
      "Executive Order 6102, April 1933: Americans had to hand their gold to the Federal Reserve at $20.67 an ounce.",
      "January 1934: gold was revalued to $35 an ounce. The vault never refilled.",
      "Not your keys, not your gold."
    ] },
    goldwindow: { year: 1971, tip: "The gold window · closed 15 August 1971", say: [
      "15 August 1971: Nixon suspended the dollar's convertibility into gold, \"temporarily\".",
      "It never reopened. Every dollar since is backed by the next dollar.",
      "Sign on the shutter: back in 15 minutes."
    ] },
    bretton: { year: 1944, tip: "Bretton Woods · 1944 to 1971", say: [
      "July 1944, Bretton Woods, New Hampshire: 44 nations pegged their money to the dollar, and the dollar to gold at $35 an ounce.",
      "The peg cracked in 1971, and the system was gone by 1973."
    ], fx: "dust" },
    dollarplinth: { year: 1913, tip: "The 1913 dollar · what is left of it", say: [
      "A dollar from 1913 buys about three cents of what it bought then.",
      "The statue was full size once. Ooga checks again. Still shrinking.",
      "Number go down."
    ] },
    weimarbarrow: { year: 1923, tip: "Wheelbarrow of marks · Weimar, 1923", say: [
      "November 1923: one US dollar cost 4.2 trillion German marks.",
      "Prices doubled every few days. Wages were paid twice a day and spent at once.",
      "The story goes a thief tipped out the marks and stole the wheelbarrow. The barrow held its value."
    ], shake: 0.12 },
    zimbabwe: { tip: "One hundred trillion dollars · Zimbabwe, 2009", say: [
      "January 2009: Zimbabwe issued a 100,000,000,000,000 dollar note.",
      "By April 2009 the Zimbabwe dollar had been set aside for other people's money.",
      "Ooga is a trillionaire. Ooga still cannot buy a banana."
    ] },
    burnbarrel: { tip: "Burn barrel · fiat makes good kindling", fx: "sparks", say: [
      "Warm. Paper money, finally useful.",
      "In 1923 Germans burned marks in the stove: cheaper than buying firewood."
    ] },
    duckdecoy: { tip: "Duck decoy · the cover story", fx: "dust", shake: 0.3, say: [
      "Quack. The cover story: a duck-hunting trip.",
      "No ducks were harmed in the making of the Federal Reserve."
    ] },
    ducksign: { year: 1910, tip: "Duck hunting · officially", say: ["Officially, seven men went duck hunting in November 1910.", "Unofficially, they came home with a central bank."] },
    genesisstone: { year: 2009, tip: "The Times, 3 January 2009 · Chancellor on brink of second bailout for banks", fx: "sparks", say: [
      "Satoshi set this headline in Bitcoin's very first block, mined on 3 January 2009.",
      "The way out of the wasteland: 21 million, and not one more.",
      "Fix the money, fix the world."
    ] },
    deadoak: { tip: "Dead live oak · Spanish moss", fx: "dust", shake: 0.06, say: ["Grey moss and old receipts.", "Live oaks shade all of Jekyll Island. This one gave up in 1971."] }
  };

  BL.jekyllIsle = { AXIS, HEAD, DECK, ROCK, NOTE, HANDCAR, CHRONO, RAIL_TOP, LORE, spot, site, update, print, chrono, depart, handcarNear, handcar, lever };
})();
