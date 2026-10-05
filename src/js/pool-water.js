// The Mempool island's water: the lake that stands as deep as the backlog, the flood it spreads over the shore
// and down the channels, the falls those pour over the cliff, the veins of it let into the tunnel walls, and the
// cube that leaves the lake through the chamber every time a block is found.
//
// The lake is the transaction backlog: `levelFor(vsize)` maps the waiting virtual bytes onto a level through
// HYDRO.POINTS, a monotonic display scale chosen for this island and no claim about any protocol limit. The
// level walks toward its reading at a bounded rate, so it never snaps, and it is shown in three stages with
// hysteresis between them (lake only, shore and channels, lowland too), so water hovering at a terrace's height
// neither flickers over it nor lies flush with its top. A reading that goes stale is held where it stood and
// said to be stale; with no reading at all the lake stands low and dim and says so. The cube subtracts nothing:
// what the block cleared arrives as the next backlog reading.
//
// All of it is one language, the Bifrost islet's: blue in three tones with pale foam, lit from within, its
// movement a brightness that travels (`node.glow` per piece), never a vertex. The lake's surface and the flood
// are flat sheets of glass moved by their node, so the ground they stand over shows through and whoever floats
// in them is seen from the chamber below through the membrane. On Canvas 2D, which draws one side of a face,
// the sheets are built with both.
//
// Everything is built once in `create` and pooled: falls are fixed stacks of metre pieces, a block's cube, neck,
// droplets and rings come from SEQUENCES fixed sets, and blocks found faster than they can fall wait in a queue
// of QUEUE at most, the rest dropped. `update` allocates nothing.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, poolLayout: L, poolModels: P } = BL;
  const { createNode, addChild, removeChild } = BL.scene;
  const { clamp, lerp, mulberry32, hexToRgb } = math;
  const { box, merge, noShadow, cached, pushVert, face } = models;
  const TAU = Math.PI * 2;
  const WATER = P.WATER, FOAM = P.FOAM, WATER_RGB = WATER.map(hexToRgb), FOAM_RGB = hexToRgb(FOAM), CALM = ["#3a8cff", "#4a9cff", "#6fbcff"].map(hexToRgb);

  // Tuning. POINTS is [waiting vB, level]: an empty mempool stands at the low water, NORMAL_VB at the normal
  // water, OVERFLOW_VB reaches the spill crest and FULL_VB the highest flood. Between them it is linear.
  const NORMAL_VB = 20e6, OVERFLOW_VB = 60e6, FULL_VB = 200e6;
  const HYDRO = {
    NORMAL_VB, OVERFLOW_VB, FULL_VB,
    POINTS: [[0, L.WATER.low], [NORMAL_VB, L.WATER.normal], [OVERFLOW_VB, L.WATER.spill], [FULL_VB, L.WATER.flood]],
    // The standing level closes on its reading over EASE seconds, never faster than RATE metres a second.
    EASE: 5, RATE: 0.16,
    // A backlog reading older than this is held and called stale.
    FRESH_MS: 120000,
    // Stage hysteresis on the eased level: the shore floods above `on` and drains below `off`, the lowland
    // above `highOn` and below `highOff`. `SHOWN` keeps the drawn level off the terraces' own heights.
    STAGE: { on: 0.04, off: -0.04, highOn: L.LEVEL.lowland + 0.04, highOff: L.LEVEL.lowland - 0.04 },
    SHOWN: { under: -0.03, over: 0.05, belowLowland: L.LEVEL.lowland - 0.05, aboveLowland: L.LEVEL.lowland + 0.05 },
    // How fast the drawn water rises and falls into place, and how far under its bed a drained flood is parked.
    FILL: 0.3, PARK: L.LEVEL.bed - 0.06,
    // How brightly water without a live reading behind it glows, against 1.
    DIM: 0.5
  };
  const levelFor = (vsize) => {
    const points = HYDRO.POINTS, v = Math.max(0, vsize);
    for (let i = 1; i < points.length; i++) if (v <= points[i][0]) return lerp(points[i - 1][1], points[i][1], (v - points[i - 1][0]) / (points[i][0] - points[i - 1][0]));
    return points[points.length - 1][1];
  };
  const FALL = { band: 6, rate: 0.5, pieces: 15 };
  const SEQUENCES = 2, QUEUE = 3, DROPLETS = 4;
  // A block's cube: it gathers on the membrane, bulges through on a neck, hangs turning, falls slowly through
  // the chamber and its shaft for `drop` seconds, then on down the open air to the sea, where it dissolves.
  // Seconds per phase: the chamber watches about eight of them.
  const CUBE = { size: 1.5, gather: 1.6, bulge: 1.7, hang: 1.5, drop: 3.2, splash: 1.4, hangY: -L.MEMBRANE_DEPTH - 1.5, spin: 0.9 };

  // Both windings of every face, for the renderer that draws only the side facing it.
  const twoSided = (geo) => {
    const faces = geo.faces.length;
    for (let f = 0; f < faces; f++) geo.faces.push({ ...geo.faces[f], i: [...geo.faces[f].i].reverse() });
    return geo;
  };
  const glass = (geo, alpha, both) => {
    noShadow(geo);
    if (both) twoSided(geo);
    geo.glass = alpha;
    return geo;
  };
  // The lake's surface at unit radius: rings of quads in three close blues (`CALM`), so the chamber looks up
  // through water and not at a checkerboard; the node's scale its reach.
  const surface = [false, true].map((both) => cached(() => {
    const geo = { verts: [], faces: [], lines: [] }, RINGS = [1, 0.82, 0.62, 0.42, 0.22], SECTORS = 24;
    const at = (r, s) => pushVert(geo, Math.sin(s / SECTORS * TAU) * r, 0, Math.cos(s / SECTORS * TAU) * r);
    for (let ring = 0; ring < RINGS.length; ring++) for (let s = 0; s < SECTORS; s++) {
      const tone = CALM[(ring * 5 + s * 3) % 7 === 0 ? 2 : (ring + s) % 2];
      const inner = ring + 1 < RINGS.length ? RINGS[ring + 1] : 0;
      face(geo, inner ? [at(RINGS[ring], s), at(RINGS[ring], s + 1), at(inner, s + 1), at(inner, s)] : [at(RINGS[ring], s), at(RINGS[ring], s + 1), at(0, 0)], tone, { emissive: 0.55 });
    }
    return glass(geo, 0.5, both);
  }));
  // Glints riding on it: a few pale slivers that turn the other way, so the surface shimmers without a wave.
  const glints = [false, true].map((both) => cached(() => {
    const geo = { verts: [], faces: [], lines: [] }, rand = mulberry32(8807);
    for (let i = 0; i < 16; i++) {
      const a = rand() * TAU, r = 0.12 + Math.sqrt(rand()) * 0.8, w = 0.035 + rand() * 0.05, h = 0.008 + rand() * 0.008;
      const cx = Math.sin(a) * r, cz = Math.cos(a) * r, tx = Math.cos(a), tz = -Math.sin(a), ox = Math.sin(a), oz = Math.cos(a);
      face(geo, [pushVert(geo, cx - tx * w - ox * h, 0, cz - tz * w - oz * h), pushVert(geo, cx - tx * w + ox * h, 0, cz - tz * w + oz * h),
        pushVert(geo, cx + tx * w + ox * h, 0, cz + tz * w + oz * h), pushVert(geo, cx + tx * w - ox * h, 0, cz + tz * w - oz * h)], FOAM_RGB, { emissive: 1 });
    }
    return glass(geo, 0.7, both);
  }));
  // The flood: one flat sheet over the shore, the lowland ring and every channel, at y = 0 in its own frame. The
  // ground hides it wherever it stands higher than the water, so the sheet floods exactly the terraces below it.
  const flood = [false, true].map((both) => cached(() => {
    const geo = { verts: [], faces: [], lines: [] }, SECTORS = 48, outer = L.RING.lowland + 0.25;
    const at = (bearing, r) => pushVert(geo, Math.sin(bearing) * r, 0, Math.cos(bearing) * r);
    for (let s = 0; s < SECTORS; s++) {
      const a = s / SECTORS * TAU, b = (s + 1) / SECTORS * TAU;
      face(geo, [at(a, L.LAKE_R), at(b, L.LAKE_R), at(b, outer), at(a, outer)], CALM[s % 2], { emissive: 0.55 });
    }
    for (const channel of L.CHANNELS) {
      const end = Math.min(channel.to, L.edgeAt(channel.bearing) + 0.3), half = L.CHANNEL.low, ux = Math.sin(channel.bearing), uz = Math.cos(channel.bearing), vx = uz, vz = -ux;
      for (let r = outer, n = 0; r < end - 1e-6; r += 1.5, n++) {
        const to = Math.min(end, r + 1.5);
        face(geo, [pushVert(geo, ux * r - vx * half, 0, uz * r - vz * half), pushVert(geo, ux * to - vx * half, 0, uz * to - vz * half),
          pushVert(geo, ux * to + vx * half, 0, uz * to + vz * half), pushVert(geo, ux * r + vx * half, 0, uz * r + vz * half)], CALM[n % 2], { emissive: 0.55 });
      }
    }
    return glass(geo, 0.5, both);
  }));
  // A metre of falling water in the Bifrost islet's make: its rock face at z = 0 with +z out and x along the
  // face, pouring from y = 0 down, as streaks of blue at their own depths with two bright pixels.
  const hash = (a, b, c) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
  const fallPiece = (i) => cached(() => {
    const parts = [];
    for (let c = 0; c < 6; c++) {
      const h = hash(c, i, 5), deep = 0.12 + h % 3 * 0.04;
      parts.push(box({ w: 0.25, h: 1.01, d: deep, color: WATER[(c + i * 2 + (h >> 3)) % 3], emissive: 0.9, offset: { x: -0.625 + c * 0.25, y: -0.5, z: 0.03 + deep / 2 } }));
    }
    for (let p = 0; p < 3; p++) {
      const h = hash(p, i, 9);
      parts.push(box({ w: 0.25, h: 0.25, d: 0.05, color: FOAM, emissive: 1, offset: { x: -0.625 + h % 6 * 0.25, y: -0.125 - (h >> 3) % 4 * 0.25, z: 0.255 } }));
    }
    return noShadow(merge(...parts));
  });
  const FALL_PIECES = [fallPiece(0), fallPiece(1)];
  const fallTail = cached(() => noShadow(merge(
    box({ w: 0.25, h: 0.7, d: 0.14, color: WATER[1], emissive: 0.9, offset: { x: -0.5, y: -0.35, z: 0.1 } }),
    box({ w: 0.25, h: 1, d: 0.18, color: WATER[2], emissive: 1, offset: { y: -0.5, z: 0.12 } }),
    box({ w: 0.25, h: 0.45, d: 0.12, color: WATER[0], emissive: 0.9, offset: { x: 0.5, y: -0.225, z: 0.09 } }),
    box({ w: 0.12, h: 0.2, d: 0.12, color: FOAM, emissive: 1, offset: { x: -0.25, y: -0.95, z: 0.1 } }),
    box({ w: 0.12, h: 0.16, d: 0.12, color: FOAM, emissive: 1, offset: { x: 0.25, y: -0.72, z: 0.09 } })
  )));
  const drip = cached(() => noShadow(box({ w: 0.12, h: 0.18, d: 0.12, color: "#bfe8ff", emissive: 1 })));
  // The cube and what goes with it: a shell of glass round a brighter heart, the neck it hangs by, a droplet,
  // and a flat ring that spreads on the membrane as it gathers and on the sea where it lands.
  const cubeShell = cached(() => glass(box({ w: CUBE.size, h: CUBE.size, d: CUBE.size, color: WATER[1], emissive: 0.75 }), 0.5, false));
  const cubeHeart = cached(() => glass(box({ w: CUBE.size * 0.5, h: CUBE.size * 0.5, d: CUBE.size * 0.5, color: WATER[2], emissive: 1 }), 0.8, false));
  const neck = cached(() => glass(box({ w: 0.5, h: 1, d: 0.5, color: WATER[2], emissive: 0.9, offset: { y: -0.5 } }), 0.6, false));
  const droplet = cached(() => noShadow(box({ w: 0.2, h: 0.28, d: 0.2, color: "#bfe8ff", emissive: 1 })));
  const ring = [false, true].map((both) => cached(() => {
    const geo = { verts: [], faces: [], lines: [] }, SECTORS = 20;
    const at = (r, s) => pushVert(geo, Math.sin(s / SECTORS * TAU) * r, 0, Math.cos(s / SECTORS * TAU) * r);
    for (let s = 0; s < SECTORS; s++) face(geo, [at(1, s), at(1, s + 1), at(0.86, s + 1), at(0.86, s)], s % 2 ? FOAM_RGB : WATER_RGB[2], { emissive: 1 });
    return glass(geo, 0.75, both);
  }));

  // `site` is the island's built group (pool-models `build`), `seaY` the sea's height in the island's frame.
  const create = ({ site, renderer, seaY }) => {
    const both = +(renderer.kind === "canvas2d"), low = both || renderer.quality === "low";
    const group = createNode({ sightHidden: true });
    addChild(site.node, group);
    const hidden = (options) => createNode({ sightHidden: true, ...options });
    const surfaceNode = hidden({ geometry: surface[both]() }), glintNode = low ? null : hidden({ geometry: glints[both]() });
    const floodNode = hidden({ geometry: flood[both](), visible: false });
    addChild(group, surfaceNode, floodNode);
    if (glintNode) addChild(group, glintNode);

    // Falls: a stack of metre pieces down the cliff under each channel's mouth, turned to face out from it.
    const falls = [], pieces = [], drips = [];
    for (const channel of L.CHANNELS) {
      if (!channel.falls) continue;
      const r = L.edgeAt(channel.bearing) + 0.3;
      const node = hidden({ position: { x: Math.sin(channel.bearing) * r, y: 0, z: Math.cos(channel.bearing) * r }, rotation: { x: 0, y: channel.bearing, z: 0 }, visible: false });
      const fall = { node, lip: Math.max(L.LEVEL.bed, channel.lip), strength: 0, from: pieces.length, count: low ? 9 : FALL.pieces };
      for (let k = 0; k < fall.count; k++) {
        const piece = hidden({ position: { x: 0, y: -k, z: 0 }, geometry: k === fall.count - 1 ? fallTail() : FALL_PIECES[k % 2]() });
        pieces.push({ node: piece, phase: k / FALL.band + falls.length * 0.37 });
        addChild(node, piece);
      }
      for (let d = 0; d < 3; d++) {
        const drop = hidden({ position: { x: (d - 1) * 0.45, y: 0, z: 0.3 }, geometry: drip() });
        drips.push({ node: drop, top: -fall.count - 0.12, speed: 0.55 + d * 0.17, seed: (falls.length * 3 + d) * 0.29 });
        addChild(node, drop);
      }
      falls.push(fall);
      addChild(group, node);
    }

    // Veins down the descent's walls, alternating sides, and one in the roof under each channel that crosses it.
    const veins = [];
    {
      const point = {}, RAMP = L.RAMP;
      for (let s = 9, n = 0; s < RAMP.length - 4; s += 11, n++) {
        // Inner wall where a link has opened the outer one.
        const side = n % 2 && !L.linkAt(s / RAMP.r) ? 1 : -1, half = L.rampHalf(s / RAMP.r);
        L.rampPoint(s, side * (half - 0.02), point);
        const node = hidden({ position: { x: point.x, y: point.y - 0.1, z: point.z }, rotation: { x: 0, y: point.bearing + (side > 0 ? Math.PI : 0), z: 0 }, geometry: P.VEINS[n % 2]() });
        veins.push({ node, phase: n * 0.41 });
        addChild(group, node);
      }
    }

    // Block sequences: fixed sets of nodes, parked hidden.
    const sequences = [];
    for (let i = 0; i < SEQUENCES; i++) {
      const cube = hidden({ geometry: cubeShell(), visible: false, rotation: { x: 0.6155, y: 0, z: Math.PI / 4 } });
      const heart = hidden({ geometry: cubeHeart() });
      addChild(cube, heart);
      const neckNode = hidden({ geometry: neck(), visible: false });
      const rings = [0, 1].map(() => hidden({ geometry: ring[both](), visible: false }));
      const splash = hidden({ geometry: ring[both](), visible: false });
      const droplets = Array.from({ length: low ? 2 : DROPLETS }, () => hidden({ geometry: droplet(), visible: false }));
      addChild(group, cube, neckNode, splash, ...rings, ...droplets);
      sequences.push({ active: false, t: 0, y: 0, v: 0, splashT: -1, cube, heart, neck: neckNode, rings, splash, droplets });
    }
    let queued = 0, dropped = 0, started = 0;

    // The reading and the level. `reading` is false until any backlog figure has been seen at all.
    let target = L.WATER.low, level = L.WATER.low, shown = L.WATER.low, floodY = HYDRO.PARK, stage = 0, reading = false, observedAt = 0, vsize = 0, status = "unavailable", preview = null, settle = false;
    const apply = (snapshot) => {
      if (!snapshot || preview !== null) return;
      const observed = snapshot.backlogAt > 0;
      // A reading restored from the last visit counts as a held one: its stamp is zero until the feed confirms it.
      if (!observed && !(snapshot.vsize > 0)) return;
      vsize = Math.max(0, snapshot.vsize);
      target = levelFor(vsize);
      observedAt = snapshot.backlogAt;
      // The first reading stands where it reads: the lake does not fill from empty in front of the visitor.
      if (!reading) { reading = true; level = target; settle = true; }
    };
    const begin = (seq) => {
      seq.active = true; seq.t = 0; seq.y = CUBE.hangY; seq.v = 0; seq.splashT = -1;
      started++;
    };
    // One sequence a block. With every set busy it waits its turn; past QUEUE waiting, it is let go.
    const block = () => {
      for (const seq of sequences) if (!seq.active) { begin(seq); return; }
      if (queued < QUEUE) queued++; else dropped++;
    };
    const park = (seq) => {
      seq.active = false;
      seq.cube.visible = seq.neck.visible = seq.splash.visible = false;
      for (const node of seq.rings) node.visible = false;
      for (const node of seq.droplets) node.visible = false;
    };
    const ease = (t) => t * t * (3 - 2 * t);
    const stepSequence = (seq, dt, bright) => {
      seq.t += dt;
      const t = seq.t, top = L.membraneY(0), cube = seq.cube;
      const bulgeAt = CUBE.gather, hangAt = bulgeAt + CUBE.bulge, fallAt = hangAt + CUBE.hang;
      // A ring closes on the middle of the membrane while the water gathers, and one opens as the cube lets go.
      for (let i = 0; i < seq.rings.length; i++) {
        const node = seq.rings[i], u = i === 0 ? t / bulgeAt : (t - hangAt) / CUBE.hang;
        node.visible = u > 0 && u < 1;
        if (!node.visible) continue;
        node.scale.x = node.scale.z = i === 0 ? lerp(3.4, 0.5, ease(u)) : lerp(0.5, 3, ease(u));
        node.position.y = top + 0.04;
        node.glow = (i === 0 ? 0.4 + 0.6 * u : 1 - u) * bright;
      }
      let size = 1, y = top, falling = false;
      if (t < bulgeAt) size = 0;
      else if (t < hangAt) {
        // Bulging through: the cube grows as it sinks, still joined to the lake by its neck.
        const u = ease((t - bulgeAt) / CUBE.bulge);
        size = 0.25 + 0.75 * u;
        y = lerp(top - 0.2, CUBE.hangY, u);
      } else if (t < fallAt) y = CUBE.hangY - 0.12 * Math.sin((t - hangAt) * 2.4);
      else if (seq.splashT < 0) {
        // Falling: gently through the chamber and its shaft so the room watches it go, then with the weight
        // of the open air, all the way down to the sea.
        const slow = t < fallAt + CUBE.drop;
        falling = true;
        seq.v = Math.min(seq.v + (slow ? 2.6 : 16) * dt, slow ? 7 : 26);
        seq.y = Math.max(seaY, seq.y - seq.v * dt);
        y = seq.y;
        if (seq.y <= seaY) seq.splashT = 0;
      }
      seq.splash.visible = seq.splashT >= 0;
      if (seq.splashT >= 0) {
        // It dissolves where it lands, under one spreading ring.
        seq.splashT += dt;
        const u = clamp(seq.splashT / CUBE.splash, 0, 1);
        size = 1 - u;
        y = seaY;
        seq.splash.position.y = seaY + 0.05;
        seq.splash.scale.x = seq.splash.scale.z = lerp(1, 7, ease(u));
        seq.splash.glow = (1 - u) * bright;
        if (u >= 1) { park(seq); return; }
      }
      cube.visible = size > 0.01;
      seq.neck.visible = false;
      if (cube.visible) {
        cube.position.y = y;
        cube.scale.x = cube.scale.y = cube.scale.z = size;
        cube.rotation.y += CUBE.spin * dt;
        cube.glow = seq.heart.glow = bright;
        if (t < hangAt + 0.5) {
          // The neck stretches from the membrane to the cube and thins to nothing as they part.
          const part = clamp((t - hangAt) / 0.5, 0, 1), length = top - (y + CUBE.size * 0.5 * size);
          seq.neck.visible = length > 0.05;
          seq.neck.position.y = top;
          seq.neck.scale.y = Math.max(0.05, length);
          seq.neck.scale.x = seq.neck.scale.z = (1 - part) * (0.5 + 0.9 * (1 - clamp(length / 2.2, 0, 1)));
          seq.neck.glow = bright;
        }
      }
      // A few droplets trail the fall, each a little behind and to one side.
      for (let i = 0; i < seq.droplets.length; i++) {
        const node = seq.droplets[i];
        node.visible = falling && seq.v > 0.6;
        if (!node.visible) continue;
        const a = i * 2.4 + t * 1.3;
        node.position.x = Math.sin(a) * 0.5; node.position.z = Math.cos(a) * 0.5;
        node.position.y = Math.min(CUBE.hangY, y + 0.5 + i * 0.45 + seq.v * 0.06 * (i + 1));
        node.glow = bright * (1 - i * 0.15);
      }
    };

    const walk = (value, to, step) => value > to ? Math.max(to, value - step) : Math.min(to, value + step);
    const update = (dt, elapsed, now = Date.now()) => {
      status = !reading ? "unavailable" : preview !== null || observedAt > 0 && now - observedAt < HYDRO.FRESH_MS ? "live" : "stale";
      // The standing level: toward its reading, bounded.
      level = walk(level, target, Math.min(HYDRO.RATE * dt, Math.abs(target - level) * Math.min(1, dt / HYDRO.EASE) + 1e-4));
      const S = HYDRO.STAGE, D = HYDRO.SHOWN;
      if (stage === 0 && level > S.on) stage = 1;
      else if (stage === 1 && level < S.off) stage = 0;
      else if (stage === 1 && level > S.highOn) stage = 2;
      else if (stage === 2 && level < S.highOff) stage = 1;
      const want = stage === 0 ? Math.min(level, D.under) : stage === 1 ? clamp(level, D.over, D.belowLowland) : Math.max(level, D.aboveLowland);
      shown = settle ? want : walk(shown, want, HYDRO.FILL * dt);
      floodY = settle ? (stage ? shown : HYDRO.PARK) : walk(floodY, stage ? shown : HYDRO.PARK, HYDRO.FILL * dt * (stage ? 2.5 : 1.5));
      settle = false;
      // A lake with no live reading behind it goes dim rather than pretending.
      const bright = status === "live" ? 1 : HYDRO.DIM;
      const lake = Math.min(shown, stage ? Math.max(floodY, L.WATER.spill - 0.01) : shown), reach = L.waterRadius(lake);
      surfaceNode.position.y = lake;
      surfaceNode.scale.x = surfaceNode.scale.z = reach;
      surfaceNode.rotation.y = elapsed * 0.03;
      surfaceNode.glow = bright * (0.92 + 0.08 * Math.sin(elapsed * 0.9));
      if (glintNode) {
        glintNode.position.y = lake + 0.015;
        glintNode.scale.x = glintNode.scale.z = reach;
        glintNode.rotation.y = -elapsed * 0.07;
        glintNode.glow = bright * (0.55 + 0.45 * Math.sin(elapsed * 1.7));
      }
      site.membrane.glow = bright * (0.85 + 0.15 * Math.sin(elapsed * 0.6 + 1));
      floodNode.visible = floodY > HYDRO.PARK + 0.01;
      floodNode.position.y = floodY;
      floodNode.glow = bright * (0.9 + 0.1 * Math.sin(elapsed * 1.1 + 2));
      // Falls pour once the flood stands over their sill, harder the higher it stands.
      for (let i = 0; i < falls.length; i++) {
        const fall = falls[i];
        fall.strength = floodNode.visible ? clamp((floodY - fall.lip) / (L.WATER.flood - fall.lip), 0, 1) : 0;
        fall.node.visible = fall.strength > 0.02;
        if (!fall.node.visible) continue;
        fall.node.position.y = fall.lip;
        fall.node.scale.x = 0.55 + 0.6 * fall.strength;
        fall.node.scale.z = 0.7 + 0.5 * fall.strength;
      }
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i], u = 0.5 + 0.5 * Math.sin(TAU * (piece.phase - elapsed * FALL.rate));
        piece.node.glow = bright * (0.72 + 0.55 * u * u * u);
      }
      for (let i = 0; i < drips.length; i++) {
        const d = drips[i], t = (elapsed * d.speed + d.seed) % 1;
        d.node.position.y = d.top - t * t * 2.6;
        d.node.glow = bright * (1 - t * 0.75);
      }
      for (let i = 0; i < veins.length; i++) {
        const vein = veins[i], u = 0.5 + 0.5 * Math.sin(TAU * (vein.phase - elapsed * 0.22));
        vein.node.glow = bright * (0.55 + 0.45 * u * u);
      }
      for (const seq of sequences) {
        if (seq.active) stepSequence(seq, dt, 1);
        else if (queued > 0) { queued--; begin(seq); }
      }
    };
    // The water's surface over a point of the island's frame, or -Infinity where there is none: the lake inside
    // its waterline, and the flood wherever the sheet stands over lower ground.
    const levelAt = (x, z) => {
      const r = Math.hypot(x, z), lake = surfaceNode.position.y;
      if (r < surfaceNode.scale.x) return lake;
      if (!floodNode.visible || r < L.LAKE_R) return -Infinity;
      if (r > L.RING.lowland + 0.25) {
        const bearing = Math.atan2(x, z);
        let inChannel = false;
        for (const channel of L.CHANNELS) if (r <= channel.to && Math.abs(L.turn(bearing, channel.bearing) * r) < L.CHANNEL.low) { inChannel = true; break; }
        // Past the cliff the channel has no bed: the water falls there, and holds up no one, on a ledge or in the air.
        if (!inChannel || L.groundAt(x, z) < L.LEVEL.bed) return -Infinity;
      }
      return L.groundAt(x, z) < floodY - 0.02 ? floodY : -Infinity;
    };
    const dispose = () => {
      removeChild(site.node, group);
      site.membrane.glow = 1;
      falls.length = pieces.length = drips.length = veins.length = sequences.length = 0;
    };
    const state = {
      get level() { return level; }, get target() { return target; }, get shown() { return shown; }, get flood() { return floodY; }, get stage() { return stage; },
      get status() { return status; }, get vsize() { return vsize; }, get observedAt() { return observedAt; }, get reach() { return surfaceNode.scale.x; },
      get falls() { let n = 0; for (const fall of falls) if (fall.node.visible) n++; return n; },
      get cubes() { let n = 0; for (const seq of sequences) if (seq.active) n++; return n; },
      get queued() { return queued; }, get dropped() { return dropped; }, get started() { return started; }, get preview() { return preview; }
    };
    return {
      apply, block, update, levelAt, dispose, state,
      // Debug only: stand the lake at a waiting size without the feed, or hand it back with null.
      preview(vB) {
        preview = vB === null || vB === undefined ? null : Math.max(0, vB);
        if (preview !== null) { reading = true; vsize = preview; target = levelFor(preview); }
      },
      get active() { for (const seq of sequences) if (seq.active) return true; return Math.abs(level - target) > 1e-3 || Math.abs(shown - level) > 0.11; },
      stats: () => ({ waterCubes: state.cubes, waterQueued: queued })
    };
  };

  BL.poolWater = { HYDRO, CUBE, SEQUENCES, QUEUE, levelFor, create };
})();
