// Ooga Orbit props: rocket parts, fx, the launch site and the round world; one cached geometry per builder.
//
// Every part's geometry and `assemble(stack)` (a group at the stack's bottom, a flame under each engine);
// flame, smoke puff, fireball, plasma streak, splash and heat shell. The launch site (`SITE`, `siteSpot`,
// `site`, `siteGroundAt`) is a voxel islet with the pad, the tower, the sagging rope bridge and the sign.
// The world sphere keeps its continents away from home (`planet`, `onContinent`).
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { hexToRgb, mulberry32 } = BL.math;
  const { createNode, addChild } = BL.scene;
  const { box, bevelBox, lathe, ring, merge, cached, noShadow, makeVox, voxelGeometry, pushVert, face } = BL.models;
  const { turn } = BL.raceModels, { moved } = BL.models;
  const { postSign, limb, padNormals, flatInto, puff: hubPuff } = BL.hubModels;
  const { rocketParts, rocket } = BL;
  const keyed = (build) => {
    const cache = new Map();
    return (key) => {
      let value = cache.get(key);
      if (!value) cache.set(key, value = build(key));
      return value;
    };
  };
  const WOOD = "#8a6236", WOOD_DK = "#5c4425", PLANK = "#a9773f", LEAF = "#4f8a3d", LEAF_DK = "#3e7a2c", BANANA = "#f5c542", SPOT = "#4a2f16", BONE = "#e8e2d2";
  const CLAY = "#b5562f", CLAY_DK = "#8c3f22", STONE = "#6b625a", STONE_DK = "#57504a", MUD = "#5a3d22", MUD_DK = "#432c17", ROPE = "#b89760";
  // Lathe whose colour varies round the ring as well as up it: color(t, s) = profile step, segment index.
  const latheBy = ({ profile, segments = 8, color, emissive = 0 }) => {
    const geo = { verts: [], faces: [], lines: [] };
    const rings = profile.map(([r, y]) => Array.from({ length: segments }, (_, s) => {
      const a = s / segments * Math.PI * 2;
      return pushVert(geo, Math.cos(a) * r, y, Math.sin(a) * r);
    }));
    const cache = new Map();
    const rgb = (hex) => cache.get(hex) || (cache.set(hex, hexToRgb(hex)), cache.get(hex));
    for (let p = 0; p < rings.length - 1; p++) {
      for (let s = 0; s < segments; s++) {
        const s2 = (s + 1) % segments;
        face(geo, [rings[p][s], rings[p + 1][s], rings[p + 1][s2], rings[p][s2]], rgb(color(p / (rings.length - 1), s)), { emissive });
      }
    }
    return geo;
  };
  // A stick from radius r0 at y0 to radius r1 at y1, at angle a round the axis.
  const stick = (r0, y0, r1, y1, a, width, color) => {
    const len = Math.hypot(r1 - r0, y1 - y0);
    return turn(moved(turn(box({ w: width, h: len, d: width, color }), 0, Math.atan2(r0 - r1, y1 - y0)), (r0 + r1) / 2, (y0 + y1) / 2, 0), -a);
  };
  const hoops = (r, ys) => ys.map((y) => ring({ r, thickness: 0.035, y, segments: 10, color: "#2d241c" }));

  // Cartoon parts: every turned body at least eighteen segments round and smooth shaded, so barrels, gourds and pots
  // read as soft round shapes; sticks, bands and fins stay crisp flat parts in the same mesh.
  const ROUND_SEGMENTS = 18;
  const roundLathe = (o) => Object.assign(lathe({ ...o, segments: Math.max(o.segments || 8, ROUND_SEGMENTS) }), { round: true });
  const roundLatheBy = (o) => Object.assign(latheBy({ ...o, segments: Math.max(o.segments || 8, ROUND_SEGMENTS) }), { round: true });
  const roundMerge = (...parts) => {
    const geo = { verts: [], faces: [], lines: [], smooth: true };
    for (const part of parts) {
      if (!part.round) { flatInto(geo, part); continue; }
      const base = geo.verts.length / 3;
      for (let i = 0; i < part.verts.length; i++) geo.verts.push(part.verts[i]);
      for (const f of part.faces) geo.faces.push({ ...f, i: f.i.map((k) => k + base) });
    }
    return Object.assign(geo, { round: true });
  };
  // Part builders: origin at the bottom centre, height up +y.
  const PART_BUILDERS = {
    stickpod: (p) => roundMerge(
      roundLathe({ profile: [[0, 0], [p.r, 0], [p.r, 0.12], [0.82, 0.55], [0.52, 1.2], [0.36, 1.46], [0.3, 1.46]], segments: 12, color: (t) => t < 0.3 ? WOOD_DK : "#4a3319" }),
      ...Array.from({ length: 12 }, (_, i) => stick(p.r + 0.04, 0.04, 0.12, p.h + 0.22, i / 12 * Math.PI * 2 + 0.13, 0.085, i % 2 ? WOOD : PLANK)),
      ring({ r: p.r - 0.02, thickness: 0.05, y: 0.34, segments: 12, color: ROPE }),
      ring({ r: 0.6, thickness: 0.045, y: 1.06, segments: 12, color: ROPE }),
      moved(turn(box({ w: 0.42, h: 0.5, d: 0.26, color: LEAF }), 0, 0, -0.45), 0, 1.02, -0.62),
      moved(turn(box({ w: 0.46, h: 0.08, d: 0.3, color: ROPE }), 0, 0, -0.45), 0, 1.02, -0.62)
    ),
    gourdpod: (p) => roundMerge(
      roundLatheBy({ profile: [[0, 0], [0.62, 0], [p.r, 0.24], [0.83, 0.6], [0.58, 0.95], [0.42, 1.18], [0.37, 1.34], [0.32, 1.34]], segments: 12, color: (t, s) => t > 0.8 ? "#8a6a2c" : s % 2 ? "#d9a441" : "#c98a2e" }),
      ...[-1, 1].map((side) => moved(turn(box({ w: 0.09, h: 0.55, d: 0.09, color: WOOD_DK }), 0, side * 0.35), side * 0.42, 1.45, 0)),
      moved(turn(box({ w: 0.4, h: 0.44, d: 0.24, color: LEAF }), 0, 0, -0.4), 0, 0.82, -0.66),
      ring({ r: 0.8, thickness: 0.04, y: 0.5, segments: 12, color: ROPE })
    ),
    leafshield: (p) => roundMerge(
      roundLathe({ profile: [[0, 0.05], [p.r - 0.05, 0.05], [p.r - 0.05, p.h], [0, p.h]], segments: 14, color: LEAF_DK }),
      ...Array.from({ length: 10 }, (_, i) => turn(moved(box({ w: 0.34, h: 0.05, d: p.r + 0.08, color: i % 2 ? LEAF : "#5f9c45" }), 0, 0.03, (p.r + 0.08) / 2), i / 10 * Math.PI * 2))
    ),
    mudshield: (p) => roundMerge(
      roundLatheBy({ profile: [[0, 0], [0.88, 0], [p.r, 0.12], [0.97, 0.26], [0.2, p.h], [0, p.h]], segments: 14, color: (t, s) => (s * 7) % 5 === 0 ? MUD_DK : MUD }),
      ...Array.from({ length: 7 }, (_, i) => turn(box({ w: 0.2, h: 0.08, d: 0.2, color: MUD_DK, offset: { x: 0.3 + (i % 3) * 0.2, y: 0.02, z: 0 } }), i * 0.9))
    ),
    stoneshield: (p) => roundMerge(
      roundLatheBy({ profile: [[0, 0], [0.92, 0], [p.r, 0.1], [p.r, 0.22], [0.9, p.h], [0, p.h]], segments: 14, color: (t, s) => s % 4 === 0 ? STONE_DK : STONE }),
      ...Array.from({ length: 3 }, (_, i) => turn(box({ w: 0.04, h: 0.03, d: 1.6, color: "#3a3531", offset: { y: 0.005 } }), i * 1.05 + 0.3))
    ),
    nut: (p) => roundMerge(
      roundLathe({ profile: [[0, 0], [0.3, 0.02], [0.5, 0.2], [p.r, 0.44], [0.46, 0.62]], segments: 12, color: "#c8955a" }),
      roundLatheBy({ profile: [[0.46, 0.6], [0.57, 0.64], [0.52, 0.76], [0, p.h]], segments: 12, color: (t, s) => s % 2 ? "#6b4526" : "#7c5230" })
    ),
    coconut: (p) => roundMerge(
      roundLatheBy({ profile: [[0, 0], [0.4, 0.05], [0.68, 0.3], [p.r, 0.6], [0.66, 0.92], [0.38, 1.14], [0, p.h]], segments: 14, color: (t, s) => (s + Math.floor(t * 5)) % 3 === 0 ? "#6e4726" : "#5b3a1e" }),
      ...[0, 2.1, 4.2].map((a) => turn(box({ w: 0.12, h: 0.04, d: 0.12, color: "#2b1b10", offset: { x: 0.2, y: p.h - 0.04, z: 0 } }), a))
    ),
    barrel: (p) => roundMerge(
      roundLatheBy({ profile: [[0, 0], [0.66, 0], [0.77, 0.3], [p.r, 0.85], [0.77, 1.4], [0.66, p.h], [0, p.h]], segments: 12, color: (t, s) => s % 2 ? WOOD : PLANK }),
      ...hoops(0.79, [0.3, 0.85, 1.4])
    ),
    bigbarrel: (p) => roundMerge(
      roundLatheBy({ profile: [[0, 0], [0.84, 0], [0.97, 0.45], [p.r, 1.25], [0.97, 2.05], [0.84, p.h], [0, p.h]], segments: 14, color: (t, s) => s % 2 ? WOOD : PLANK }),
      ...hoops(0.99, [0.45, 1.0, 1.5, 2.05]),
      moved(turn(box({ w: 0.62, h: 0.16, d: 0.04, color: BANANA, emissive: 0.1 }), 0, 0.5), 0, 1.25, 1.0)
    ),
    pot: (p) => roundMerge(
      roundLatheBy({ profile: [[0, 0.02], [0.62, 0], [p.r, 0.12], [0.5, 0.36], [0.55, 0.6], [0.64, 0.8], [0.6, p.h], [0, p.h]], segments: 12, color: (t) => t > 0.4 && t < 0.6 ? CLAY_DK : CLAY }),
      roundLathe({ profile: [[0, 0.01], [0.45, 0.01]], segments: 10, color: "#ff8a2a", emissive: 0.9 })
    ),
    jug: (p) => roundMerge(
      roundLatheBy({ profile: [[0, 0.03], [0.88, 0], [p.r, 0.2], [0.6, 0.55], [0.7, 0.9], [0.86, 1.2], [0.8, p.h], [0, p.h]], segments: 12, color: (t, s) => s % 3 === 0 && t < 0.7 ? "#3a302b" : "#4a3f3a" }),
      ...Array.from({ length: 6 }, (_, i) => turn(box({ w: 0.08, h: 0.36, d: 0.05, color: "#ff6a1e", emissive: 0.9, offset: { x: 0, y: 0.28 + (i % 2) * 0.3, z: 0.74 } }), i / 6 * Math.PI * 2)),
      roundLathe({ profile: [[0, 0.02], [0.66, 0.02]], segments: 10, color: "#ffb13b", emissive: 1 })
    ),
    tusk: (p) => roundMerge(
      roundLathe({ profile: [[0, 0.02], [0.48, 0], [p.r, 0.12], [0.3, 0.5], [0.4, 0.85], [0.5, p.h], [0, p.h]], segments: 10, color: (t) => t < 0.2 ? "#cfc6b2" : BONE }),
      ...[0.55, 0.78].map((y) => ring({ r: 0.36 + (y - 0.5) * 0.4, thickness: 0.035, y, segments: 10, color: ROPE }))
    ),
    bamboo: (p) => roundMerge(
      ...[0, 2.09, 4.19].map((a) => moved(roundLatheBy({ profile: [[0, 0], [0.24, 0], [0.24, 0.18], [0.25, 0.2], [0.24, 0.22], [0.24, 0.9], [0.26, 0.92], [0.24, 0.95], [0.24, 1.7], [0.26, 1.72], [0.24, 1.75], [0.24, p.h], [0, p.h]], segments: 8, color: (t) => t < 0.1 ? "#2b261e" : t % 0.25 < 0.04 ? "#6f8a2f" : "#9bb84a" }), Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25)),
      ...[0.5, 1.4, 2.3].map((y) => ring({ r: 0.5, thickness: 0.04, y, segments: 10, color: LEAF_DK }))
    ),
    vine: (p) => roundMerge(
      roundLatheBy({ profile: [[0, 0], [0.7, 0], [p.r, 0.1], [p.r, 0.25], [0.7, p.h], [0, p.h]], segments: 12, color: (t, s) => s % 3 === 0 ? LEAF : LEAF_DK }),
      ...[0, 1.6, 3.4, 4.9].map((a) => turn(box({ w: 0.2, h: 0.2, d: 0.2, color: "#2f5f22", offset: { x: p.r, y: 0.17 } }), a))
    ),
    feathers: (p) => roundMerge(
      roundLathe({ profile: [[0, 0], [p.r, 0], [p.r, p.h], [0, p.h]], segments: 10, color: WOOD_DK }),
      ...Array.from({ length: 4 }, (_, i) => turn(roundMerge(
        box({ w: 0.05, h: 1.25, d: 0.5, color: "#f3efe4", offset: { x: 0, y: 0.42, z: p.r + 0.28 } }),
        box({ w: 0.06, h: 0.3, d: 0.52, color: "#c8322e", offset: { x: 0, y: -0.1, z: p.r + 0.28 } }),
        box({ w: 0.07, h: 1.3, d: 0.05, color: BONE, offset: { x: 0, y: 0.42, z: p.r + 0.04 } })
      ), i / 4 * Math.PI * 2 + Math.PI / 4))
    ),
    leaffins: (p) => roundMerge(
      roundLathe({ profile: [[0, 0], [p.r, 0], [p.r, p.h], [0, p.h]], segments: 10, color: WOOD }),
      ...Array.from({ length: 3 }, (_, i) => turn(box({ w: 0.04, h: 0.9, d: 0.46, color: i % 2 ? LEAF : "#5f9c45", offset: { x: 0, y: 0.3, z: p.r + 0.22 } }), i / 3 * Math.PI * 2))
    )
  };
  const partGeometry = keyed((id) => PART_BUILDERS[id](rocketParts.partOf(id)));
  // A unit cone of fire hanging down from the nozzle; the scene scales it by the engine and the throttle.
  const flame = cached(() => noShadow(latheBy({ profile: [[0, -2.8], [0.28, -1.7], [0.52, -0.7], [0.66, -0.12], [0.6, 0], [0, 0.02]], segments: 9, color: (t) => t < 0.3 ? "#ff5a1e" : t < 0.65 ? "#ff9a2a" : "#ffe7a0", emissive: 1 })));
  // Smoke and fire as soft round cartoon puffs.
  const BALL_SMOOTH = [[0, -1], [0.5, -0.87], [0.87, -0.5], [1, 0], [0.87, 0.5], [0.5, 0.87], [0, 1]];
  const puff = cached(() => Object.assign(noShadow(lathe({ profile: BALL_SMOOTH, segments: 11, color: "#d9d6cf", emissive: 0.12 })), { smooth: true }));
  const fireball = cached(() => Object.assign(noShadow(latheBy({ profile: BALL_SMOOTH, segments: 11, color: (t, s) => (s + Math.floor(t * 4)) % 3 ? "#ff8a2a" : "#ffd36a", emissive: 1 })), { smooth: true }));
  const plasma = cached(() => noShadow(box({ w: 0.06, h: 0.06, d: 1, color: "#ffb347", emissive: 1 })));
  const splash = cached(() => noShadow(lathe({ profile: [[0.7, 0], [1, 0.05], [0.95, 0.6], [0.8, 0.9], [0.6, 0.3]], segments: 14, color: "#e8f4fb", emissive: 0.25 })));
  const heatShell = cached(() => noShadow(lathe({ profile: [[0, -0.3], [0.9, -0.2], [1.12, 0.1], [1.05, 0.5], [0.7, 0.9]], segments: 12, color: "#ff7a2a", emissive: 1 })));
  // Spacewalk props in caveman-height units; the scene fades the helmet to glass.
  // The tether is a unit box the scene stretches along +z from the hatch.
  const helmet = cached(() => noShadow(roundMerge(
    roundLathe({ profile: [[0, -0.2], [0.3, -0.16], [0.42, 0.06], [0.38, 0.28], [0.22, 0.44], [0, 0.48]], segments: 12, color: "#cfe8f5", emissive: 0.15 }),
    ring({ r: 0.34, thickness: 0.04, y: -0.18, segments: 12, color: "#d8dde3" })
  )));
  const tether = cached(() => noShadow(box({ w: 0.05, h: 0.05, d: 1, color: "#f3efe4", emissive: 0.2, offset: { z: 0.5 } })));
  const spaceRock = cached(() => roundMerge(
    roundLatheBy({ profile: [[0, -1], [0.7, -0.85], [1.05, -0.3], [0.95, 0.35], [0.6, 0.85], [0, 1]], segments: 9, color: (t, s) => (s * 5 + Math.floor(t * 7)) % 4 === 0 ? "#4a4541" : "#6b625a" }),
    ...[[0.3, 0.9, 0.1, 0.5], [-0.5, 0.75, 0.2, -0.3], [0.1, 0.8, -0.55, 0.9]].map(([x, y, z, a]) => moved(turn(box({ w: 0.2, h: 0.55, d: 0.2, color: "#7fe0ff", emissive: 1 }), a, 0.3), x, y, z))
  ));
  const readingLight = cached(() => noShadow(box({ w: 0.12, h: 0.12, d: 0.12, color: "#7fe0ff", emissive: 1 })));
  const measureStick = cached(() => merge(
    box({ w: 0.05, h: 0.9, d: 0.05, color: WOOD, offset: { y: 0.45 } }),
    ...[0.15, 0.35, 0.55, 0.75].map((y) => box({ w: 0.1, h: 0.02, d: 0.1, color: BANANA, offset: { y } }))
  ));
  // Built bottom up: the group's origin is the bottom of the whole stack, and engines carry a flame node.
  const assemble = (stack) => {
    const node = createNode();
    const parts = [];
    let y = 0;
    for (let i = 0; i < stack.length; i++) {
      const part = rocketParts.partOf(stack[i]);
      const n = createNode({ position: { x: 0, y, z: 0 }, geometry: partGeometry(stack[i]) });
      addChild(node, n);
      let fire = null;
      if (part.kind === "engine") {
        const r = part.solid ? 0.62 : part.r * 0.85;
        fire = createNode({ scale: { x: r, y: r * 1.4, z: r }, geometry: flame(), visible: false });
        addChild(n, fire);
      }
      parts.push({ node: n, part, y, fire });
      y += part.h;
    }
    return { node, parts, height: y };
  };

  // The bridge leaves the south rim for `span`, sagging to its middle; the islet's middle sits past its end.
  // `from` is where the search for the rim's edge starts.
  const SITE = { from: 27.4, span: 13.5, sag: 0.45, width: 2.1, isletR: 7.2, isletDepth: 13, padR: 4.2, padH: 0.45, towerX: 5.1 };
  // The bridge head sits where the ground under it runs out, at that ground's height, so planks meet the grass.
  // That height sets both ends of the site.
  const siteSpot = (island, out = {}) => {
    let z = SITE.from;
    while (island.surfaceAt(0, z + 0.1) > 0.5) z += 0.1;
    out.y = island.surfaceAt(0, z) + 0.02;
    out.x = 0;
    out.bridgeZ = z;
    out.z = z + SITE.span + SITE.isletR - 1;
    out.padY = out.y + SITE.padH;
    return out;
  };
  // A floating chunk of island in voxels: grass, dirt, then rock tapering to a point; top face at y = 0.
  // On the hub's coarse lattice: outline, depth and colours are decided per metre block (two cells square), so
  // the rim steps a metre at a time and the tones come in metre patches and courses, never single-cell speckle.
  const ISLET_UNIT = 0.5;
  const islet = cached(() => {
    const v = makeVox(), R = SITE.isletR / ISLET_UNIT, deep = SITE.isletDepth / ISLET_UNIT;
    const hash = (a, b, c) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
    for (let x = -Math.ceil(R) - 1; x <= Math.ceil(R) + 1; x++) {
      for (let z = -Math.ceil(R) - 1; z <= Math.ceil(R) + 1; z++) {
        const bx = Math.floor(x / 2), bz = Math.floor(z / 2), cx = bx * 2 + 1, cz = bz * 2 + 1;
        const a = Math.atan2(cz, cx), edge = R * (0.92 + 0.08 * Math.sin(a * 5 + 1.3) + 0.04 * Math.sin(a * 11));
        const r = Math.hypot(cx, cz);
        if (r > edge) continue;
        const k = r / edge, depth = Math.max(2, Math.round(deep * (1 - Math.pow(k, 1.5)) * (0.8 + (hash(bx, 7, bz) % 1000) / 1000 * 0.25)));
        for (let y = 1; y <= depth; y++) v.set(x, -y, z, y === 1 ? (hash(bx, 1, bz) % 100 < 30 ? 1 : 0) : y <= 3 ? 2 : (hash(bx, Math.floor((y - 4) / 2), bz) % 100 < 30 ? 4 : 3));
      }
    }
    const options = { unit: ISLET_UNIT, palette: ["#5b8a3a", "#4f7d33", "#6b4a2b", STONE, STONE_DK], origin: { x: 0, y: 0, z: 0 } };
    return voxelGeometry(v, options);
  });
  // Stone disc, painted ring, charred trench and four fire posts; its top sits at SITE.padH. The disc's lip rolls
  // over in two chamfers and the posts are bevelled stone with an iron fire bowl, so the pad reads as one chunky
  // carved piece.
  const pad = cached(() => merge(
    latheBy({ profile: [[0, 0], [SITE.padR, 0], [SITE.padR, SITE.padH - 0.16], [SITE.padR - 0.05, SITE.padH - 0.05], [SITE.padR - 0.16, SITE.padH], [0, SITE.padH]], segments: 36, color: (t, s) => t > 0.3 && t < 0.8 ? "#8a8078" : s % 3 === 0 ? STONE_DK : "#756b62" }),
    lathe({ profile: [[SITE.padR - 0.8, SITE.padH + 0.005], [SITE.padR - 1.1, SITE.padH + 0.005]], segments: 36, color: BANANA, emissive: 0.35 }),
    lathe({ profile: [[1.3, SITE.padH + 0.006], [0, SITE.padH + 0.006]], segments: 18, color: "#241b14" }),
    ...[0, 1, 2, 3].map((i) => turn(merge(
      bevelBox({ w: 0.5, h: 0.22, d: 0.5, color: STONE, offset: { x: SITE.padR - 0.4, y: SITE.padH + 0.11 } }),
      bevelBox({ w: 0.38, h: 0.9, d: 0.38, color: STONE_DK, offset: { x: SITE.padR - 0.4, y: SITE.padH + 0.62 } }),
      bevelBox({ w: 0.5, h: 0.14, d: 0.5, color: "#3a3531", offset: { x: SITE.padR - 0.4, y: SITE.padH + 1.1 } }),
      bevelBox({ w: 0.3, h: 0.24, d: 0.3, color: "#ff9a2a", emissive: 1, bevel: 0.06, offset: { x: SITE.padR - 0.4, y: SITE.padH + 1.28 } })
    ), i * Math.PI / 2 + Math.PI / 4))
  ));
  // Stands beside the pad on +x, behind the rocket from the launch camera. Chunky bevelled timber: four stout
  // legs, a braced ladder of rails, a rope lashing at every joint, a planked top with a banana pennant and two
  // service arms.
  const TOWER_H = 15;
  const tower = cached(() => {
    const geos = [], LEGS = [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]];
    for (const [x, z] of LEGS) geos.push(bevelBox({ w: 0.32, h: TOWER_H, d: 0.32, color: WOOD_DK, bevel: 0.06, offset: { x, y: TOWER_H / 2, z } }));
    for (let y = 1.5; y < TOWER_H; y += 1.5) {
      for (const z of [-0.65, 0.65]) geos.push(bevelBox({ w: 1.62, h: 0.2, d: 0.2, color: WOOD, bevel: 0.05, offset: { y, z } }));
      for (const x of [-0.65, 0.65]) geos.push(bevelBox({ w: 0.2, h: 0.2, d: 1.62, color: PLANK, bevel: 0.05, offset: { x, y: y - 0.05 } }));
      for (const [x, z] of LEGS) geos.push(bevelBox({ w: 0.4, h: 0.1, d: 0.4, color: ROPE, bevel: 0.03, offset: { x, y: y - 0.2, z } }));
    }
    for (let k = 0; k < 4; k++) geos.push(bevelBox({ w: 2.3, h: 0.16, d: 0.54, color: k % 2 ? PLANK : WOOD, bevel: 0.04, offset: { y: TOWER_H, z: -0.81 + k * 0.54 } }));
    geos.push(bevelBox({ w: 0.14, h: 2.4, d: 0.14, color: WOOD_DK, offset: { x: 0.9, y: TOWER_H + 1.2, z: 0.9 } }));
    geos.push(bevelBox({ w: 0.06, h: 0.6, d: 0.9, color: BANANA, emissive: 0.15, bevel: 0.02, offset: { x: 0.9, y: TOWER_H + 2.05, z: 0.45 } }));
    for (const y of [TOWER_H * 0.62, TOWER_H * 0.3]) {
      geos.push(bevelBox({ w: 3.6, h: 0.22, d: 0.5, color: WOOD, bevel: 0.06, offset: { x: -2.3, y } }));
      geos.push(bevelBox({ w: 0.12, h: 0.3, d: 0.6, color: ROPE, bevel: 0.03, offset: { x: -0.85, y } }));
    }
    return merge(...geos);
  });
  // Decking overlaps the rim and the launch islet; the sag stays between the two old bridge heads.
  const DECK_START = -0.8, DECK_END = SITE.span + 0.8;
  const deckY = (z) => { const t = Math.max(0, Math.min(1, z / SITE.span)); return -SITE.sag * 4 * t * (1 - t); };
  // Drawn as a cartoon rope bridge: bevelled planks and posts, the hand ropes and the ropes under the
  // deck as smooth cords you could grip, rope collars lashing them round the post tops.
  const ROPE_RGB = hexToRgb(ROPE), ROPE_DK_RGB = hexToRgb("#9a7a48");
  const bridge = cached(() => {
    const geo = { verts: [], faces: [], lines: [], smooth: true, normals: [] }, w = SITE.width;
    const length = DECK_END - DECK_START, count = Math.ceil(length / 0.47), pitch = length / count, rand = mulberry32(913);
    const rail = 1.05, steps = 16;
    for (const x of [-w / 2 - 0.05, w / 2 + 0.05]) {
      for (let i = 0; i < steps; i++) {
        const z0 = i / steps * SITE.span, z1 = (i + 1) / steps * SITE.span;
        limb(geo, x, deckY(z0) * 1.3 + rail, z0, x, deckY(z1) * 1.3 + rail, z1, 0.07, 0.07, 6, ROPE_RGB);
        limb(geo, x, deckY(z0) - 0.14, z0, x, deckY(z1) - 0.14, z1, 0.085, 0.085, 6, ROPE_DK_RGB);
      }
      for (let i = 1; i < 12; i++) {
        const z = i / 12 * SITE.span;
        limb(geo, x, deckY(z) - 0.14, z, x, deckY(z) * 1.3 + rail, z, 0.04, 0.035, 5, ROPE_RGB);
      }
    }
    padNormals(geo);
    for (let i = 0; i < count; i++) {
      const z = DECK_START + (i + 0.5) * pitch;
      flatInto(geo, bevelBox({ w: w + (i % 3 ? 0 : 0.14), h: 0.2, d: pitch + 0.02, color: i % 2 ? "#8f6538" : "#9c7040", bevel: 0.045, offset: { x: 0, y: deckY(z) - 0.06, z } }));
    }
    for (const z of [0, SITE.span]) for (const x of [-w / 2 - 0.12, w / 2 + 0.12]) {
      flatInto(geo, bevelBox({ w: 0.36, h: 1.9, d: 0.36, color: WOOD_DK, offset: { x, y: 0.45, z } }));
      for (const y of [rail, -0.14]) hubPuff(geo, x, y, z, 0.24, 0.1, 0.24, [ROPE_RGB, ROPE_RGB, ROPE_RGB, ROPE_RGB], rand, 3, 8);
    }
    geo.normals = Float32Array.from(geo.normals);
    return geo;
  });
  const siteSign = cached(() => postSign("Ooga Orbit", 0.42, 0.6));
  // Ground under a site point in world space, or -Infinity: the pad, the islet's top, the bridge deck.
  const siteGroundAt = (spot, x, z) => {
    const dx = x - spot.x, dz = z - spot.z, r = Math.hypot(dx, dz);
    if (r < SITE.padR) return spot.padY;
    if (r < SITE.isletR * 0.92) return spot.y;
    const along = z - spot.bridgeZ;
    if (Math.abs(x - spot.x) < SITE.width / 2 && along >= DECK_START && along <= DECK_END) return spot.y + deckY(along) + 0.04;
    return -Infinity;
  };

  // One group placed at the islet's middle holding its nodes; the bridge head is `spot.bridgeZ`.
  const site = (spot) => {
    const node = createNode({ position: { x: spot.x, y: spot.y, z: spot.z } });
    const isletNode = createNode({ geometry: islet() });
    const padNode = createNode({ geometry: pad() });
    // The tower stands past the pad's edge, so it foots on the islet's own top, not the pad's surface;
    // towerX puts its service arms against the widest part of a stack rather than short of it.
    const towerNode = createNode({ position: { x: SITE.towerX, y: siteGroundAt(spot, spot.x + SITE.towerX, spot.z) - spot.y, z: 0 }, geometry: tower() });
    const bridgeNode = createNode({ position: { x: 0, y: 0, z: spot.bridgeZ - spot.z }, geometry: bridge() });
    const signNode = createNode({ position: { x: 1.9, y: 0, z: -SITE.isletR + 2.2 }, rotation: { x: 0, y: Math.PI, z: 0 }, geometry: siteSign() });
    addChild(node, isletNode, padNode, towerNode, bridgeNode, signNode);
    return node;
  };

  // Sphere centred at the origin, radius rocket.R; rings close together near the islands and wider away.
  const PLANET_SEGMENTS = 96;
  // Continents lie well past where a pod comes down near home, so every home landing is on islands or sea.
  const LANDS = (() => {
    const rand = mulberry32(4242);
    return Array.from({ length: 9 }, () => {
      const t = 0.95 + rand() * 1.75, a = rand() * Math.PI * 2;
      return { x: Math.sin(t) * Math.cos(a), y: Math.cos(t), z: Math.sin(t) * Math.sin(a), r: 0.16 + rand() * 0.24 };
    });
  })();
  // Depth inside the nearest continent for a unit direction from the world's centre; positive on land.
  // a is the angle round the pole, t the angle down from it, both feeding the coast's wobble.
  const landDepth = (x, y, z, t, a) => {
    let land = -Infinity;
    for (const l of LANDS) {
      const d = Math.acos(Math.max(-1, Math.min(1, x * l.x + y * l.y + z * l.z)));
      const wobble = 0.04 * Math.sin(a * 7 + l.r * 40) + 0.03 * Math.sin(t * 23 + l.x * 9);
      land = Math.max(land, l.r + wobble - d);
    }
    return land;
  };
  // Takes a position relative to the world's centre, any length, not a world-space point.
  const onContinent = (x, y, z) => {
    const r = Math.hypot(x, y, z), t = Math.acos(y / r), a = Math.atan2(z, x);
    return landDepth(x / r, y / r, z / r, t, a < 0 ? a + Math.PI * 2 : a) > 0.015;
  };
  const planet = cached(() => {
    const R = rocket.R, thetas = [0];
    let step = 12 / R;
    while (thetas[thetas.length - 1] < Math.PI) {
      thetas.push(Math.min(Math.PI, thetas[thetas.length - 1] + step));
      step = Math.min(step * 1.16, 0.045);
    }
    const geo = { verts: [], faces: [], lines: [] };
    // Bottom pole first so the profile climbs and the faces look out.
    const rings = [];
    for (let i = thetas.length - 1; i >= 0; i--) {
      const t = thetas[i], row = [];
      for (let s = 0; s < PLANET_SEGMENTS; s++) {
        const a = s / PLANET_SEGMENTS * Math.PI * 2;
        row.push(pushVert(geo, Math.sin(t) * Math.cos(a) * R, Math.cos(t) * R, Math.sin(t) * Math.sin(a) * R));
      }
      rings.push({ t, row });
    }
    const colors = new Map();
    const rgb = (hex) => colors.get(hex) || (colors.set(hex, hexToRgb(hex)), colors.get(hex));
    for (let p = 0; p < rings.length - 1; p++) {
      const t = (rings[p].t + rings[p + 1].t) / 2, arc = t * R;
      for (let s = 0; s < PLANET_SEGMENTS; s++) {
        const a = (s + 0.5) / PLANET_SEGMENTS * Math.PI * 2;
        const x = Math.sin(t) * Math.cos(a), y = Math.cos(t), z = Math.sin(t) * Math.sin(a);
        const land = landDepth(x, y, z, t, a);
        let hex;
        if (t > 2.72) hex = s % 3 ? "#eef3f7" : "#dfe6ee";
        else if (land > 0.05) hex = (s + p) % 5 === 0 ? "#6f8a3a" : land > 0.16 ? "#8a7a4a" : "#5b8a3a";
        else if (land > 0.015) hex = "#d8c58a";
        else if (arc < 60) hex = "#3fc1c0";
        else if (arc < 160) hex = arc < 110 ? "#2fa3b8" : "#2586a8";
        else hex = arc < 260 ? "#2278a0" : "#1f6496";
        face(geo, [rings[p].row[s], rings[p + 1].row[s], rings[p + 1].row[(s + 1) % PLANET_SEGMENTS], rings[p].row[(s + 1) % PLANET_SEGMENTS]], rgb(hex), { emissive: 0 });
      }
    }
    geo.castShadow = false;
    return geo;
  });
  BL.rocketModels = { SITE, TOWER_H, ISLET_UNIT, onContinent, partGeometry, flame, puff, fireball, plasma, splash, heatShell, helmet, tether, spaceRock, measureStick, readingLight, assemble, siteSpot, site, siteGroundAt, deckY, planet, islet, pad, tower, bridge, siteSign };
})();
