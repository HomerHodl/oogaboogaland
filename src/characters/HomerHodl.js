(() => {
  "use strict";
  const BL = window.BL;
  const { geometry, pushVert, face, box, lathe, tube, merge, forward, moved, turnedX, turnedY, cached, makeVox } = BL.models;
  const { createNode, addChild } = BL.scene;
  const { hexToRgb } = BL.math;
  const stickCache = new Map();
  // The whacking stick: a plain black rod with rounded ends, held upright with more of it above the fist.
  const stickGeometry = (h, color) => {
    const key = `${h}/${color}`;
    let geo = stickCache.get(key);
    if (!geo) {
      const r = 0.032 * h, bottom = -0.18 * h, top = 0.56 * h, end = 0.018 * h;
      geo = lathe({ profile: [[0, bottom], [0.7 * r, bottom], [r, bottom + end], [r, top - end], [0.7 * r, top], [0, top]], segments: 10, color });
      stickCache.set(key, geo);
    }
    return geo;
  };
  const MAKEUP = { steel: "#3d4046", bore: "#0e0e10", wood: "#7a3f22", woodDk: "#4e2814", bead: "#c9a54a", glass: "#dfe9ee", cap: "#d2404a", yellow: "#f2cf2a", red: "#d81f2e", emissive: 0 };
  const GOLD_MAKEUP = { steel: "#e0b53a", bore: "#6b5416", wood: "#5c4425", woodDk: "#3f2e18", bead: "#f0c95a", glass: "#fff6d8", cap: "#f0c95a", yellow: "#f2cf2a", red: "#d81f2e", emissive: 0.25 };
  const makeupCache = new Map();
  // Homer's makeup shotgun, in the rifle's space so its grip, sights and muzzle sit where the rifle's do,
  // and with no magazine: a plain side-by-side with a wooden stock and fore-end, and two glass jars hanging
  // under the barrels on red nozzles, foundation behind and lipstick red nearer the muzzle.
  const makeupGunGeometry = (h, pal) => {
    const key = `${h}/${pal === MAKEUP ? "makeup" : "gold"}`;
    let geo = makeupCache.get(key);
    if (!geo) {
      const part = (w, hh, d, color, x, y, z, emissive = 0) => box({ w: w * h, h: hh * h, d: d * h, color, emissive, offset: { x: x * h, y: y * h, z: z * h } });
      const stock = part(0.085, 0.12, 0.28, pal.wood, 0, 0, -0.37);
      for (let i = 0; i < stock.verts.length; i += 3) {
        const front = (stock.verts[i + 2] / h + 0.51) / 0.28;
        stock.verts[i] *= 1 - front * 0.12;
        stock.verts[i + 1] = stock.verts[i + 1] * (1 - front * 0.35) + (-0.04 + front * 0.025) * h;
      }
      const R = 0.025, BORE = 0.018, L = 0.6, Y = -0.005;
      const barrel = (x) => [
        forward(lathe({ profile: [[0, 0], [R * h, 0], [R * h, L * h], [BORE * h, L * h]], segments: 10, color: pal.steel }), { x: x * h, y: Y * h, z: 0.06 * h }),
        forward(lathe({ profile: [[BORE * h, L * h], [BORE * h, (L - 0.04) * h], [0, (L - 0.04) * h]], segments: 10, color: pal.bore }), { x: x * h, y: Y * h, z: 0.06 * h })
      ];
      // A squat flask: the colour fills its lower body, clear glass rises to the neck, and a red nozzle ties it up to the barrels.
      const jar = (z, fill) => {
        const top = -0.075, bottom = -0.225, r = 0.054, level = bottom + 0.09;
        return [
          moved(lathe({ profile: [[0, 0], [(r - 0.006) * h, 0], [r * h, 0.012 * h], [r * h, (level - bottom) * h], [0, (level - bottom) * h]], segments: 10, color: fill }), 0, bottom * h, z * h),
          moved(lathe({ profile: [[r * h, 0], [r * h, 0.018 * h], [0.6 * r * h, 0.038 * h], [0.016 * h, (top - level) * h], [0, (top - level) * h]], segments: 10, color: pal.glass }), 0, level * h, z * h),
          moved(lathe({ profile: [[0.017 * h, 0], [0.017 * h, 0.012 * h], [0.011 * h, 0.018 * h], [0.011 * h, (Y - top) * h], [0, (Y - top) * h]], segments: 8, color: pal.cap }), 0, top * h, z * h)
        ];
      };
      const pieces = [
        stock,
        part(0.09, 0.14, 0.02, pal.woodDk, 0, -0.04, -0.516),
        part(0.09, 0.1, 0.3, pal.steel, 0, -0.005, -0.07, pal.emissive),
        part(0.1, 0.065, 0.2, pal.wood, 0, -0.045, 0.22),
        part(0.065, 0.18, 0.066, pal.wood, 0, -0.14, -0.184),
        // The trigger guard, as the rifle's.
        part(0.045, 0.012, 0.106, pal.steel, 0, -0.13, -0.098),
        part(0.045, 0.077, 0.012, pal.steel, 0, -0.0975, -0.045),
        part(0.045, 0.077, 0.012, pal.steel, 0, -0.0975, -0.151),
        part(0.014, 0.045, 0.012, pal.steel, 0, -0.083, -0.112),
        ...barrel(-R), ...barrel(R),
        // A rib between the barrels carries the front post; its bead and the rear notch keep the rifle's sight line.
        part(0.012, 0.012, 0.5, pal.steel, 0, 0.022, 0.4, pal.emissive),
        part(0.012, 0.05, 0.016, pal.steel, 0, 0.055, 0.59),
        part(0.016, 0.016, 0.016, pal.bead, 0, 0.082, 0.59),
        part(0.012, 0.035, 0.014, pal.steel, -0.016, 0.0625, -0.18),
        part(0.012, 0.035, 0.014, pal.steel, 0.016, 0.0625, -0.18),
        ...jar(0.4, pal.yellow), ...jar(0.54, pal.red)
      ];
      geo = merge(...pieces);
      makeupCache.set(key, geo);
    }
    return geo;
  };
  // The crown, in head space at unit height (the head's top is at y 0.375, its eyes' at 0.3125): a gold band
  // round the head just above the eyes, a rounded square (a superellipse, a by b) hugging the head's square
  // corners, flaring out as it rises into ten points with curved-in sides, five of them facing front. The flare
  // is linear in height, so each wall column is straight and one row draws it exactly; `around` keeps eight
  // samples a point, so every tip and valley lands on one.
  const CROWN = { a: 0.262, b: 0.232, foot: 0.315, band: 0.4, valley: 0.418, tip: 0.58, flare: 0.22, points: 10, around: 80, rows: 1, wall: 0.94 };
  const spread = (y) => 1 + CROWN.flare * (y - CROWN.foot) / (CROWN.tip - CROWN.foot);
  // The crown's outline at angle t (0 at the front, turning towards +x) and height y, `out` times its size there.
  const onCrown = (t, y, out = 1) => {
    const s = Math.sin(t), c = Math.cos(t), k = spread(y) * out;
    return [Math.sign(s) * Math.sqrt(Math.abs(s)) * CROWN.a * k, y, Math.sign(c) * Math.sqrt(Math.abs(c)) * CROWN.b * k];
  };
  // The top edge: a tip at each point's centre, a valley halfway between, the sides curving in.
  const edge = (t) => {
    const u = t * CROWN.points / (2 * Math.PI), d = Math.abs(u - Math.round(u)) * 2;
    return CROWN.valley + (CROWN.tip - CROWN.valley) * (1 - d) ** 2;
  };
  const pointAngle = (i) => i / CROWN.points * 2 * Math.PI;
  // A round bead of radius r about the origin, and a hexagonal stone with a bevelled table facing +z from z lift.
  const bead = (r, color, segments = 6) => lathe({ profile: [[0, -r], [0.92 * r, -0.45 * r], [0.92 * r, 0.45 * r], [0, r]], segments, color });
  const hexStone = (r, color, lift = 0) => forward(lathe({ profile: [[0, lift], [r, lift], [r, lift + 0.27 * r], [0.55 * r, lift + 0.53 * r], [0, lift + 0.53 * r]], segments: 6, color, emissive: 0.15 }));
  // The gold: an outer and an inner wall on shared vertices so each shades smooth, their top edge on vertices
  // of its own so it stays crisp, a raised lip round the foot that also closes the foot under the walls, a
  // ridge where the points begin, and a ball on every tip.
  const crownGeometry = cached(() => {
    const geo = geometry(), N = CROWN.around, M = CROWN.rows, angle = (i) => i / N * 2 * Math.PI;
    const gold = hexToRgb("#ffcf3a"), inside = hexToRgb("#c98f17"), rim = hexToRgb("#ffe27a");
    const at = (t, y, out) => pushVert(geo, ...onCrown(t, y, out));
    const wall = (out) => {
      const ids = [];
      for (let i = 0; i < N; i++) {
        const top = edge(angle(i)), col = [];
        for (let j = 0; j <= M; j++) col.push(at(angle(i), CROWN.foot + (top - CROWN.foot) * j / M, out));
        ids.push(col);
      }
      return ids;
    };
    const outer = wall(1), inner = wall(CROWN.wall);
    for (let i = 0; i < N; i++) {
      const n = (i + 1) % N;
      for (let j = 0; j < M; j++) {
        face(geo, [outer[i][j], outer[n][j], outer[n][j + 1], outer[i][j + 1]], gold);
        face(geo, [inner[i][j], inner[i][j + 1], inner[n][j + 1], inner[n][j]], inside);
      }
      const t0 = angle(i), t1 = angle(n), top0 = edge(t0), top1 = edge(t1);
      face(geo, [at(t0, top0, 1), at(t1, top1, 1), at(t1, top1, CROWN.wall), at(t0, top0, CROWN.wall)], gold);
    }
    // A band standing `out` proud of the wall from y0 to y1 at every other column, its face and top on shared
    // vertices; its underside runs in to `under` times the outline, the inner wall for the lip, closing the foot.
    const band = (y0, y1, out, under, color) => {
      const ring = [];
      for (let i = 0; i < N; i += 2) ring.push([at(angle(i), y0, under), at(angle(i), y0, out), at(angle(i), y1, out), at(angle(i), y1, 1)]);
      for (let i = 0; i < ring.length; i++) {
        const [a0, b0, c0, d0] = ring[i], [a1, b1, c1, d1] = ring[(i + 1) % ring.length];
        face(geo, [b0, b1, c1, c0], color);
        face(geo, [c0, c1, d1, d0], color);
        if (under < 1) face(geo, [b0, a0, a1, b1], color);
      }
    };
    band(CROWN.foot - 0.004, CROWN.foot + 0.022, 1.04, CROWN.wall, rim);
    band(CROWN.band - 0.01, CROWN.band + 0.01, 1.035, 1, rim);
    const r = 0.029, balls = [];
    for (let i = 0; i < CROWN.points; i++) {
      const [x, y, z] = onCrown(pointAngle(i), CROWN.tip, (1 + CROWN.wall) / 2);
      balls.push(moved(bead(r, "#e8b830", 8), x, y + 0.7 * r, z));
    }
    const crown = merge(geo, ...balls);
    crown.smooth = true;
    return crown;
  });
  // The crown's rubies and the hair over his ears, in head space at unit height. Each ruby is a hexagonal
  // stone on the lower band under its point, between the lip and the ridge, tilted with the crown's flare;
  // each M is one thin strand in four straight strokes, behind the ear.
  const crownGemsAndHairGeometry = cached(() => {
    const pieces = [], y = (CROWN.foot + 0.022 + CROWN.band - 0.01) / 2;
    for (let i = 0; i < CROWN.points; i++) {
      const [x, , z] = onCrown(pointAngle(i), y), k = spread(y);
      // The outline's outward normal, and the flare's lean from upright at this point's radius.
      const nx = x ** 3 / (CROWN.a * k) ** 4, nz = z ** 3 / (CROWN.b * k) ** 4;
      const lean = Math.atan(Math.hypot(x, z) / k * CROWN.flare / (CROWN.tip - CROWN.foot));
      pieces.push(moved(turnedY(turnedX(hexStone(0.023, "#c4122a", 0.001), lean), Math.atan2(nx, nz)), x, y, z));
    }
    const M = [[-0.075, 0.15], [-0.095, 0.265], [-0.135, 0.185], [-0.175, 0.265], [-0.195, 0.15]];
    for (const s of [-1, 1]) for (let i = 0; i < M.length - 1; i++) {
      const [z0, y0] = M[i], [z1, y1] = M[i + 1];
      pieces.push(tube({ rings: 1, segments: 6, path: (t) => ({ x: s * 0.226, y: y0 + (y1 - y0) * t, z: z0 + (z1 - z0) * t }), radius: () => 0.008, colorFn: () => "#3a2614" }));
    }
    return merge(...pieces);
  });
  const jewelsCache = new Map();
  // His jewels after his avatar, at his height in the body's own space (the torso's belly scale undone): two
  // strands of big gold beads swinging across the chest below his jowls and over the belt, with stones set
  // into them and a big purple stone hanging from the lower one onto the loincloth, a row of beads round the
  // back of the neck, and on each shoulder a ring of beads round a pink stone. Beads shade smooth and stones
  // keep their facets.
  const jewelsGeometry = (h, belly) => {
    const key = `${h}/${belly}`;
    let jewels = jewelsCache.get(key);
    if (!jewels) {
      const beads = [], stones = [], r = 0.027 * h, step = 2.1 * r, W = 0.21 * h * belly, gold = "#ffe066";
      // The body front a bead rests on: the chest, or the loincloth standing a voxel prouder below its top.
      const front = (y) => (y - r < 0.1875 * h ? 0.1875 : 0.125) * h * belly + 0.8 * r;
      // A strand hanging from `high` at the chest's edges to `low` at its middle, beads every step along it from
      // the middle out and mirrored; `gems` swaps the bead at that count from the middle for a stone [color, radius].
      const strand = (low, high, gems) => {
        let walked = 0, k = 0, x0 = 0, y0 = low;
        for (let i = 1; i <= 40; i++) {
          const x1 = W * i / 40, y1 = low + (high - low) * (i / 40) ** 2, len = Math.hypot(x1 - x0, y1 - y0);
          for (; k * step <= walked + len; k++) {
            const f = (k * step - walked) / len, x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f, gem = gems[k];
            for (const s of k ? [-1, 1] : [1]) {
              if (gem) stones.push(moved(hexStone(gem[1] * h, gem[0]), s * x, y, front(y) - 0.4 * r));
              else beads.push(moved(bead(r, gold), s * x, y, front(y)));
            }
          }
          walked += len;
          x0 = x1;
          y0 = y1;
        }
      };
      strand(0.27 * h, 0.48 * h, { 2: ["#2f62d6", 0.03], 4: ["#2e9a5a", 0.024] });
      strand(0.215 * h, 0.45 * h, { 3: ["#e0559a", 0.028] });
      stones.push(moved(hexStone(0.05 * h, "#6a3fc0"), 0, 0.146 * h, front(0.096 * h) - 0.4 * r));
      for (let x = -0.14 * h * belly; x <= 0.14 * h * belly + 1e-6; x += step) beads.push(moved(bead(r, gold), x, 0.475 * h, -front(0.475 * h)));
      const shoulderBeads = [];
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * 2 * Math.PI;
        shoulderBeads.push(moved(bead(0.025 * h, gold), Math.cos(a) * 0.085 * h, 0.014 * h, Math.sin(a) * 0.085 * h));
      }
      const smooth = (pieces) => {
        const geo = merge(...pieces);
        geo.smooth = true;
        return geo;
      };
      jewels = { beads: smooth(beads), stones: merge(...stones), shoulderBeads: smooth(shoulderBeads), shoulderStone: turnedX(hexStone(0.03 * h, "#e0559a"), -Math.PI / 2) };
      jewelsCache.set(key, jewels);
    }
    return jewels;
  };
  // Homer's blue trousers, burst Hulk-style.
  const PANTS = { blue: "#3f78d1", dark: "#2b5aa6", fray: "#9cbcf0", band: "#24467f" };
  // Hashed from the cell, never drawn from k.rand, so the rest of his build draws as it did.
  const tear = (x, y, z) => ((Math.imul(x + 11, 73856093) ^ Math.imul(y + 7, 19349663) ^ Math.imul(z + 5, 83492791)) >>> 0) % 7;
  // A trouser leg over a leg's own voxels (x 0 to 3, z 0 to 3, the hip at y 4), torn off between thigh and shin
  // at uneven heights with a frayed edge, a few tatters hanging to the ankle behind and at the sides, and
  // ripped through on the front and down the outside so the gold shows. `side` is the leg's x sign; the rips mirror.
  const pantsLeg = (k, side) => {
    const v = makeVox(), blue = k.color(PANTS.blue), dark = k.color(PANTS.dark), fray = k.color(PANTS.fray);
    for (let x = 0; x <= 3; x++) for (let z = 0; z <= 3; z++) {
      const cut = tear(x, side, z), hem = cut < 2 && z < 3 ? 1 : cut < 4 ? 2 : 3;
      for (let y = hem; y <= 4; y++) v.set(x, y, z, y === hem && tear(x, y, z + side) < 4 ? fray : tear(x, y, z) === 0 ? dark : blue);
    }
    v.del(side > 0 ? 1 : 2, 4, 3);
    v.del(side > 0 ? 3 : 0, 3, 1);
    return v;
  };
  BL.characters.add({
    handle: "HomerHodl",
    joined: 1791072000,
    lastCommit: 1791072000,
    // A golden king: his own glowing eyes without pupils, no brow, and his own nose and mouth from mark.
    look: { portrait: { min: [-1, -3, 0], max: [7, 7, 8] }, bald: true, noBrow: true, noPupils: true, face: "none", hatY: 10, skin: "#f2b630", hair: "#3a2614", fur: "#3f78d1" },
    voice: {
      poke: "D'oh!",
      idle: ["Mmm... bananas.", "Woohoo! Number go up!", "Mmm... sats.", "Why you little... fee spike!", "D'oh! Sold the bottom.", "Duff and HODL, the Ooga way."]
    },
    dress: {
      // A bare gold chest with the shoulder strap painted over, over his blue trousers: a dark waistband in
      // place of the hide belt, the seat and hips torn through to the gold, the loincloth's flaps torn blue
      // cloth; his jewels and trouser legs are gear
      torso(k, v) {
        const blue = k.color(PANTS.blue), dark = k.color(PANTS.dark), fray = k.color(PANTS.fray);
        v.fill(1, 7, 4, 7, 1, 1, k.skinJ);
        v.fill(1, 7, 4, 7, 4, 4, k.skinJ);
        v.fill(0, 8, 0, 2, 0, 5, (x, y, z) => tear(x, y, z) === 0 ? dark : blue);
        v.fill(1, 7, 3, 3, 1, 4, k.color(PANTS.band));
        for (const [x, y, z] of [[2, 1, 5], [3, 1, 5], [6, 0, 5], [5, 1, 0], [0, 1, 2], [8, 2, 3]]) v.set(x, y, z, k.P.skin);
        k.loin = [blue, fray];
      },
      // The necklaces ride the torso, under a node undoing its belly scale so the beads stay round; the
      // shoulder pieces sit on top of each arm; each trouser leg is a shell a little wider than the leg it
      // covers, so the rips show the leg's own gold
      gear(k) {
        const b = k.traits.belly, jewels = jewelsGeometry(k.h, b), u = k.u;
        const body = createNode({ scale: { x: 1 / b, y: 1, z: 1 / b } });
        addChild(body, createNode({ geometry: jewels.beads }), createNode({ geometry: jewels.stones }));
        addChild(k.parts.torso, body);
        for (const arm of [k.parts.armL, k.parts.armR]) addChild(arm, createNode({ geometry: jewels.shoulderBeads }), createNode({ geometry: jewels.shoulderStone }));
        for (const [leg, side] of [[k.parts.legL, 1], [k.parts.legR, -1]]) {
          addChild(leg, createNode({ scale: { x: 1.12, y: 1, z: 1.12 }, geometry: k.vg(pantsLeg(k, side), { x: -2 * u, y: -5 * u, z: -2.5 * u }) }));
        }
      },
      club: (k) => ({ default: stickGeometry(k.h, "#232327"), gold: stickGeometry(k.h, "#e0b53a"), rest: { x: 0, z: 0 } }),
      gun: (k) => ({ default: makeupGunGeometry(k.h, MAKEUP), gold: makeupGunGeometry(k.h, GOLD_MAKEUP), magazine: false }),
      // The crown and its rubies, and the M of hair over each ear
      headgear(k) {
        const h = k.h;
        addChild(k.parts.head, createNode({ scale: { x: h, y: h, z: h }, geometry: crownGeometry() }));
        addChild(k.parts.head, createNode({ scale: { x: h, y: h, z: h }, geometry: crownGemsAndHairGeometry() }));
      },
      // Homer's tall bald dome, rising inside the crown (headgear)
      crown(k, v) {
        v.fill(0, 6, 6, 6, 0, 5, k.skinJ);
        v.fill(1, 5, 7, 7, 1, 4, k.skinJ);
      },
      // Big square glowing eyes, three by three, the widest the face holds either side of the nose, set high
      // under the crown's band. Every cell is an eye cell, so the whole eye closes while he sleeps.
      eyes(k, v) {
        const eye = k.color("#fff6c8");
        k.headEmissive = { [eye]: 1 };
        for (const x0 of [0, 4]) for (let dx = 0; dx <= 2; dx++) for (let y = 2; y <= 4; y++) {
          v.set(x0 + dx, y, 5, eye);
          k.eyeCells.push([x0 + dx, y]);
        }
        return true;
      },
      // A straight nose sticking out between the eyes and a jowly muzzle, its mouth open wide on the upper teeth and tongue
      mark(k, v) {
        const P = k.P, muzzle = k.color("#dba236"), dark = k.color("#3a0d0a"), tongue = k.color("#d4505c");
        const cut = (x0, x1, y, z) => { for (let x = x0; x <= x1; x++) v.del(x, y, z); };
        cut(1, 5, 1, 6);
        v.fill(1, 5, -3, 0, 5, 7, muzzle);
        v.fill(0, 0, -1, 0, 5, 6, muzzle);
        v.fill(6, 6, -1, 0, 5, 6, muzzle);
        for (const x of [1, 5]) for (const z of [6, 7]) v.del(x, -3, z);
        cut(1, 5, -1, 7);
        cut(2, 4, -2, 7);
        v.fill(2, 4, -1, -1, 6, 6, P.white);
        v.set(1, -1, 6, dark);
        v.set(5, -1, 6, dark);
        v.fill(2, 4, -2, -2, 6, 6, tongue);
        v.fill(3, 3, 2, 2, 6, 7, P.nose);
      }
    }
  });
})();
