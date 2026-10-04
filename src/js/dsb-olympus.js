// Olympus dressed: crags and cliff bands, stone terraces with olives and vines, the trail as a sacred way, a spring
// that runs down to the sea in falls and pools under two stone bridges, and two windmills on the back shoulder.
// The summit round the Portara stays bare. Additive: the terrain, the trail and every lot are untouched. Its walls,
// rock and mills stop a walker (`clearSegment`), and its bridges carry one (`supportAt`).
(() => {
  "use strict";
  const BL = window.BL, S = BL.scene, M = BL.models, H = BL.hubModels, rgb = BL.math.hexToRgb;
  const TAU = Math.PI * 2, CELL = 4, SUMMIT = { x: -45, z: -48 }, KEEP = 20, CENTRE = { x: -47, z: -45 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const noShadow = (g) => { g.castShadow = false; return g; };
  const STONE = ["#b5a489", "#a3927a", "#c5b59a", "#d2c4a9"], WATER = "#3f93a6";
  const tones = (list) => list.map(rgb);
  const VINE = tones(["#3f6a35", "#528243", "#689a52", "#82b266"]), GRAPE = tones(["#4b2a63", "#643a82", "#7c4fa0", "#9a6cc0"]), FOAM = tones(["#dfeef2", "#eef7f9", "#f8fcfd", "#ffffff"]);
  // Squared, stacked limestone on the half-metre grid, so the block shader courses it like the main island's cliffs.
  // Each stands two metres into the slope. `flat` cuts the top level, for the ledges water runs over.
  const CRAGS = [[7, 5, 5, 11, 0], [5, 7, 4, 23, 0], [9, 4, 6, 37, 0], [4, 3, 4, 51, 0], [11, 6, 5, 67, 0], [6, 6, 5, 83, 1]];
  const crag = CRAGS.map(([rx, ry, rz, seed, flat]) => M.cached(() => {
    const r = BL.math.mulberry32(seed), v = M.makeVox();
    for (let y = -4; y < ry; y++) for (let x = -rx; x <= rx; x++) for (let z = -rz; z <= rz; z++) {
      const up = Math.max(0, y) / ry, q = Math.abs((x + 0.5) / rx) ** 3 + Math.abs((z + 0.5) / rz) ** 3 + (flat ? up ** 8 : up ** 2.2);
      if (q < 1 - r() * (flat ? 0.16 : 0.3)) v.set(x, y, z, y >= ry - 2 ? 3 : (y + (x >> 2) & 3) === 0 ? 1 : r() < 0.2 ? 2 : 0);
    }
    return M.voxelGeometry(v, { unit: 0.5, palette: STONE });
  }));
  // Dry-stone walling: a course of boxes on the quarter-metre grid with a broken top. `top` is its height above the
  // ground; half a metre more stands in it.
  const wall = (len, top, seed) => M.cached(() => {
    const r = BL.math.mulberry32(seed), parts = [M.box({ w: len, h: top + 0.25, d: 0.5, color: "#b9a88c", offset: { y: (top - 0.75) / 2 } })];
    for (let x = -len / 2; x < len / 2 - 1e-6;) {
      const w = Math.min(0.5 + Math.floor(r() * 2) * 0.25, len / 2 - x);
      if (r() > 0.22) parts.push(M.box({ w, h: 0.25, d: 0.5, color: r() < 0.5 ? "#c7b89c" : "#a89678", offset: { x: x + w / 2, y: top - 0.125 } }));
      x += w;
    }
    const g = M.merge(...parts);
    g.voxel = new Float32Array([0.25, -len / 2, -0.5, -0.25]);
    return g;
  });
  const terraceWall = [wall(2.25, 1, 5), wall(2.25, 1, 9), wall(2.25, 1, 14)], pathWall = [wall(1.5, 0.5, 21), wall(1.5, 0.5, 27)];
  // The bed a terrace wall holds: tilled earth with a green skin, its top at the node's height.
  const bed = [["#a98f63", "#8f9a5c"], ["#a98f63", "#b39a6b"]].map(([soil, skin]) => M.cached(() => M.merge(
    M.box({ w: 2.3, h: 1.4, d: 2.7, color: soil, offset: { y: -0.76, z: 1.55 } }), M.box({ w: 2.3, h: 0.06, d: 2.7, color: skin, offset: { y: -0.03, z: 1.55 } }))));
  const soft = (build, shadow = false) => M.cached(() => {
    const geo = { verts: [], faces: [], lines: [], normals: [] };
    build(geo, BL.math.mulberry32(77));
    H.padNormals(geo); geo.normals = Float32Array.from(geo.normals); geo.castShadow = shadow;
    return geo;
  });
  // Two metres of vine on a trellis, heavy with grapes.
  const trellis = soft((geo, rand) => {
    const timber = [];
    for (const x of [-0.95, 0, 0.95]) timber.push(M.box({ w: 0.08, h: 1.3, d: 0.08, color: "#7a5c3e", offset: { x, y: 0.65 } }));
    timber.push(M.box({ w: 2.1, h: 0.04, d: 0.04, color: "#8a6b49", offset: { y: 1.24 } }), M.box({ w: 2.1, h: 0.03, d: 0.03, color: "#8a6b49", offset: { y: 0.8 } }));
    H.flatInto(geo, ...timber);
    for (let i = 0; i < 6; i++) {
      const x = -0.85 + i * 0.34;
      H.puff(geo, x, 0.98 + (i % 2) * 0.14, 0, 0.26, 0.24, 0.2, VINE, rand, 4, 6);
      if (i % 2) H.puff(geo, x + 0.05, 0.66, 0.1, 0.07, 0.11, 0.07, GRAPE, rand, 3, 5);
    }
  });
  const foam = soft((geo, rand) => { for (let i = 0; i < 5; i++) H.puff(geo, Math.cos(i * 1.3) * 0.7, 0.2, Math.sin(i * 1.3) * 0.5, 0.55, 0.3, 0.5, FOAM, rand, 3, 6); });
  const step = M.cached(() => M.bevelBox({ w: 2.3, h: 0.16, d: 0.5, color: "#cdbf9f", bevel: 0.04 }));
  const post = M.cached(() => noShadow(M.merge(M.box({ w: 0.12, h: 0.95, d: 0.12, color: "#7a5c3e", offset: { y: 0.475 } }), M.box({ w: 0.17, h: 0.07, d: 0.17, color: "#5f4630", offset: { y: 0.97 } }))));
  // Only a lantern's lamp glows, so its node's `glow` lights it at dusk.
  const lantern = M.cached(() => M.merge(M.box({ w: 0.3, h: 1, d: 0.3, color: "#b7a98d", offset: { y: 0.5 } }), M.box({ w: 0.46, h: 0.1, d: 0.46, color: "#a39478", offset: { y: 1.05 } }),
    M.box({ w: 0.24, h: 0.28, d: 0.24, color: "#ffcc80", emissive: 1, offset: { y: 1.24 } }), M.box({ w: 0.42, h: 0.08, d: 0.42, color: "#8c7d64", offset: { y: 1.42 } }), M.box({ w: 0.2, h: 0.1, d: 0.2, color: "#8c7d64", offset: { y: 1.51 } })));
  const shrine = M.cached(() => M.merge(M.box({ w: 0.32, h: 0.85, d: 0.32, color: "#b7a98d", offset: { y: 0.425 } }), M.box({ w: 0.6, h: 0.5, d: 0.46, color: "#fbf8f1", offset: { y: 1.1 } }),
    M.box({ w: 0.72, h: 0.09, d: 0.58, color: "#2c6cb4", offset: { y: 1.4 } }), M.box({ w: 0.44, h: 0.09, d: 0.34, color: "#2c6cb4", offset: { y: 1.49 } }),
    M.box({ w: 0.2, h: 0.24, d: 0.03, color: "#ffcc80", emissive: 1, offset: { y: 1.1, z: 0.235 } })));
  const bench = M.cached(() => M.merge(M.bevelBox({ w: 1.7, h: 0.12, d: 0.5, color: "#d6c9ab", bevel: 0.03, offset: { y: 0.46 } }), M.box({ w: 0.3, h: 0.4, d: 0.42, color: "#b7a98d", offset: { x: -0.6, y: 0.2 } }), M.box({ w: 0.3, h: 0.4, d: 0.42, color: "#b7a98d", offset: { x: 0.6, y: 0.2 } })));
  const signpost = M.cached(() => M.merge(M.box({ w: 0.1, h: 2, d: 0.1, color: "#7a5c3e", offset: { y: 1 } }),
    M.turnedY(M.box({ w: 0.85, h: 0.2, d: 0.04, color: "#fbf8f1", offset: { x: 0.4, y: 1.7 } }), 0.3), M.turnedY(M.box({ w: 0.75, h: 0.2, d: 0.04, color: "#2c6cb4", offset: { x: 0.36, y: 1.42 } }), 2.4)));
  // A humpback bridge of cut stone on the quarter-metre grid: the deck rises 0.9 m over a round arch, between parapets.
  const BRIDGE = { half: 3.5, rise: 0.9, width: 1.4 };
  const deckAt = (x) => BRIDGE.rise * Math.cos(clamp(x / BRIDGE.half, -1, 1) * Math.PI / 2) ** 1.5;
  const bridge = M.cached(() => {
    const v = M.makeVox();
    for (let x = -14; x < 14; x++) {
      const cx = (x + 0.5) * 0.25, top = Math.round(deckAt(cx) / 0.25), under = Math.abs(cx) < 1.3 ? Math.floor(0.55 * Math.sqrt(1 - (cx / 1.3) ** 2) / 0.25) : -9;
      for (let z = -6; z < 6; z++) {
        const edge = z === -6 || z === 5;
        for (let y = -5; y < top + (edge ? 2 : 0); y++) if (y >= under) v.set(x, y, z, edge && y >= top ? 3 : y === top - 1 ? 2 : (x + y & 3) === 0 ? 1 : 0);
      }
    }
    return M.voxelGeometry(v, { unit: 0.25, palette: STONE });
  });
  // A Cycladic windmill: a whitewashed tower under a thatch cone, on a round stone footing that takes up the slope.
  const mill = M.cached(() => M.shaded([
    M.lathe({ profile: [[3.3, -4], [3.3, 0.2], [2.5, 0.2]], segments: 20, color: "#b9aa8e" }),
    M.lathe({ profile: [[2.15, 0.2], [1.75, 6], [1.9, 6.05], [1.9, 6.25]], segments: 20, color: "#fdfbf4" }),
    M.lathe({ profile: [[2.25, 6.2], [1.2, 7.4], [0, 8.5]], segments: 20, color: "#9c7f55" })
  ], [M.box({ w: 0.9, h: 1.7, d: 0.2, color: "#2f6aa0", offset: { y: 1.05, z: 2.08 } }), M.box({ w: 0.5, h: 0.6, d: 0.2, color: "#27445a", offset: { x: 0, y: 4.1, z: -1.82 } }),
    M.box({ w: 0.2, h: 0.6, d: 0.5, color: "#27445a", offset: { x: 1.86, y: 3.6 } }), M.turnedX(M.lathe({ profile: [[0.13, 0], [0.13, 1.6]], segments: 8, color: "#6b4f35" }), Math.PI / 2)].map((g, i) => i === 3 ? M.moved(g, 0, 5.3, 1.5) : g)));
  // Its wheel: twelve spars round the axle, a triangle of canvas on each, turning about z.
  const wheel = M.cached(() => {
    const g = M.geometry(), cloth = rgb("#f6f1e4"), parts = [];
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU, c = Math.cos(a), s = Math.sin(a), b = (i + 1) / 12 * TAU;
      parts.push(M.beam(0, 0, 0, c * 4.2, s * 4.2, 0, 0.07, "#6b4f35"));
      const q = [M.pushVert(g, c * 0.5, s * 0.5, 0.03), M.pushVert(g, c * 4, s * 4, 0.03), M.pushVert(g, Math.cos(b) * 2.7, Math.sin(b) * 2.7, 0.2)];
      M.face(g, q, cloth); M.face(g, [q[2], q[1], q[0]], cloth);
    }
    parts.push(M.turnedX(M.torus(4.2, 0.03, "#8a6b49", 0, 12, 4), Math.PI / 2));
    return noShadow(M.merge(g, ...parts));
  });
  // The stream's course from the spring to the sea, and where its water stands level on a ledge before a fall:
  // [the lip's x and z, length of the level reach behind it].
  const COURSE = [[-32, -31], [-33.5, -25], [-35, -19], [-37, -14], [-41, -8], [-45, -1], [-51, 5], [-60, 10], [-69, 15], [-77, 20], [-81.5, 22.3]];
  const LIPS = [[-35.4, -17.8, 3], [-44.6, -1.7, 6.6], [-55, 7.5, 2.6], [-66, 13.3, 2.6], [-78.5, 20.9, 2.4]];
  const MILLS = [[-14, -58, 0.9], [-24, -66, 1.5]];

  // Ground the other layers leave alone: the stream's bed and the mills' footings.
  const reserved = (x, z, r) => {
    for (let i = 1; i < COURSE.length; i++) { const a = COURSE[i - 1], b = COURSE[i], dx = b[0] - a[0], dz = b[1] - a[1], t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1); if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < 2.4 + r) return true; }
    return MILLS.some(([mx, mz]) => Math.hypot(x - mx, z - mz) < 4.4 + r);
  };

  const create = ({ root, land, nature, detail, enrichment, renderer }) => {
    const group = S.createNode(); S.addChild(root, group);
    const rand = BL.math.mulberry32(51039), h = land.heightAt, stats = { crags: 0, terraces: 0, crops: 0, steps: 0, lanterns: 0, stones: 0, solids: 0 }, lamps = [], wheels = [], thin = [];
    const add = (geometry, x, y, z, yaw = 0, scale = 1, hidden = true) => {
      const n = S.createNode({ geometry, position: { x, y, z }, rotation: { x: 0, y: yaw, z: 0 }, scale: { x: scale, y: scale, z: scale }, sightHidden: hidden });
      S.addChild(group, n); return n;
    };
    const near = (line, x, z) => {
      let d = Infinity;
      for (let i = 1; i < line.length; i++) { const a = line[i - 1], b = line[i], dx = b[0] - a[0], dz = b[1] - a[1], t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1); d = Math.min(d, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)); }
      return d;
    };
    const lines = [...land.lanes, land.waterfront];
    // What the earlier layers planted and placed: a wall or a crag leaves room for it.
    const taken = [];
    for (const p of nature.placements) if (p.kind === "olive" || p.kind === "cypress") taken.push(p.x, p.z, 0.9 * p.scale);
    for (const p of detail.placements) if (p.r && p.kind !== "grass" && p.kind !== "flowers") taken.push(p.x, p.z, Math.min(p.r, 1.3));
    for (const p of enrichment.placements) if (p.r && p.region !== "foam") taken.push(p.x, p.z, Math.min(p.r, 1.3));
    const open = (x, z, r) => { for (let i = 0; i < taken.length; i += 3) if (Math.hypot(x - taken[i], z - taken[i + 1]) < r + taken[i + 2]) return false; return true; };
    // Solids are oriented boxes: x, z, half width, half depth, cos, sin. A grid of cells indexes them.
    const solids = [], grid = new Map();
    const solid = (x, z, hw, hd, yaw) => {
      const at = solids.length / 6, reach = Math.hypot(hw, hd) + 0.8;
      solids.push(x, z, hw, hd, Math.cos(yaw), Math.sin(yaw));
      for (let i = Math.floor((x - reach) / CELL); i <= Math.floor((x + reach) / CELL); i++) for (let j = Math.floor((z - reach) / CELL); j <= Math.floor((z + reach) / CELL); j++) { const key = i * 4096 + j; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(at); }
    };
    // A crag placed, with the box a walker cannot enter, unless that box would reach the trail, a lane or a lot.
    // `tier` 1 goes at the low tier, 2 at medium too.
    const rockAt = (variant, x, y, z, yaw, scale, tier = 0) => {
      const hw = CRAGS[variant][0] * 0.5 * scale * 0.8, hd = CRAGS[variant][2] * 0.5 * scale * 0.8, c = Math.cos(yaw), s = Math.sin(yaw);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const px = x + c * i * hw + s * j * hd, pz = z - s * i * hw + c * j * hd;
        if (near(land.trail, px, pz) < 1.5 || !land.clearAt(px, pz, 0.7) || lines.some((line) => near(line, px, pz) < 1.7)) return null;
      }
      const n = add(crag[variant](), x, y, z, yaw, scale, false);
      solid(x, z, hw, hd, yaw); stats.crags++;
      if (tier) { n.tier = tier; thin.push(n); }
      return n;
    };
    const slope = (x, z, out) => { out.x = (h(x + 0.75, z) - h(x - 0.75, z)) / 1.5; out.z = (h(x, z + 0.75) - h(x, z - 0.75)) / 1.5; return Math.hypot(out.x, out.z); };
    // The stream, sampled every 0.6 m, with its water level: on the ground, or standing level behind a lip.
    const stream = [], FALLS = [];
    {
      const cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
      let s = 0, px = COURSE[0][0], pz = COURSE[0][1];
      for (let i = 0; i < COURSE.length - 1; i++) for (let k = 0; k < 24; k++) {
        const p = COURSE[Math.max(0, i - 1)], q = COURSE[i], r = COURSE[i + 1], t = COURSE[Math.min(COURSE.length - 1, i + 2)], u = k / 24;
        const x = cr(p[0], q[0], r[0], t[0], u), z = cr(p[1], q[1], r[1], t[1], u);
        s += Math.hypot(x - px, z - pz); px = x; pz = z;
        stream.push({ x, z, s, ground: h(x, z), y: 0, lip: false, level: false });
      }
      for (const [x, z, reach] of LIPS) FALLS.push([stream.reduce((best, p) => Math.hypot(p.x - x, p.z - z) < Math.hypot(best.x - x, best.z - z) ? p : best).s, reach]);
      for (const p of stream) {
        p.y = Math.max(p.ground, 0) + 0.07;
        for (const [lip, reach] of FALLS) if (p.s > lip - reach && p.s <= lip) { p.level = true; p.lip = lip; }
      }
      for (const [lip, reach] of FALLS) {
        const head = stream.find((p) => p.s > lip - reach);
        for (const p of stream) if (p.lip === lip) p.y = head.ground + 0.07;
      }
    }
    const streamLine = stream.filter((p, i) => i % 4 === 0).map((p) => [p.x, p.z]);
    const routes = lines;
    // Free ground for a piece of radius r: off the summit, the trail, the stream, the lanes, the lots and the mills.
    const free = (x, z, r, water = 3) => Math.hypot(x - SUMMIT.x, z - SUMMIT.z) > KEEP + r && h(x, z) > 1.2 && near(land.trail, x, z) > r + 2.4 && near(streamLine, x, z) > r + water
      && land.clearAt(x, z, r + 1.6) && !routes.some((line) => near(line, x, z) < r + 2.2) && !MILLS.some(([mx, mz]) => Math.hypot(x - mx, z - mz) < r + 5.5) && open(x, z, r);
    const G = { x: 0, z: 0 }, bridges = [];
    // Walks the contour at one height round the mountain: fn(x, z, bearing from the centre).
    const contour = (height, spacing, fn) => {
      for (let bearing = -Math.PI; bearing < Math.PI;) {
        const sx = Math.sin(bearing), cz = Math.cos(bearing);
        let lo = 5, hi = 98;
        for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (h(CENTRE.x + sx * mid, CENTRE.z + cz * mid) > height) lo = mid; else hi = mid; }
        const r = (lo + hi) / 2;
        if (r > 6 && r < 97) fn(CENTRE.x + sx * r, CENTRE.z + cz * r, bearing);
        bearing += spacing / Math.max(8, r);
      }
    };
    const noise = (a, b) => { const q = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return q - Math.floor(q); };
    const wave = (a, b) => { const i = Math.floor(a), f = a - i, u = f * f * (3 - 2 * f); return noise(i, b) * (1 - u) + noise(i + 1, b) * u; };

    // ---- Terraces on the inhabited faces, south round to the north-east: level walls on the contours, each
    // holding a bed of olives, vines or herbs.
    const olive = BL.dressing.mediterranean("olive"), herb = [BL.dressing.mediterranean("flowers"), BL.dressing.mediterranean("shrub"), BL.dressing.mediterranean("cover")];
    for (let level = 0; level < 9; level++) contour(7.5 + level * 2.5, 2.05, (x, z, bearing) => {
      if (bearing < -0.75 || bearing > 2.4 || wave(bearing * 5.5 + level * 3.7, level) < 0.2) return;
      const steep = slope(x, z, G);
      if (steep < 0.12 || steep > 0.95 || !free(x, z, 1.2)) return;
      const ux = G.x / steep, uz = G.z / steep, bx = x + ux * 1.6, bz = z + uz * 1.6;
      // The bed behind the wall keeps off the trail, the lanes and the lots too.
      if (near(land.trail, bx, bz) < 3.3 || !land.clearAt(bx, bz, 2.4) || routes.some((line) => near(line, bx, bz) < 3.2) || !open(bx, bz, 1.3)) return;
      const yaw = Math.atan2(G.x, G.z), y = 7.5 + level * 2.5, crop = Math.floor(wave(bearing * 1.6 + 9, level + 40) * 3) % 3, i = stats.terraces++;
      add(terraceWall[i % 3](), x, y, z, yaw, 1, false);
      add(bed[crop === 1 ? 1 : 0](), x, y + 0.94, z, yaw);
      solid(x + ux * 1.325, z + uz * 1.325, 1.15, 1.575, yaw);
      if (crop === 0) { if (i % 2 === 0) { add(olive, bx, y + 0.9, bz, rand() * TAU, 0.62 + rand() * 0.3); stats.crops++; } }
      else if (crop === 1) { add(trellis(), bx, y + 0.92, bz, yaw); stats.crops++; }
      else for (let k = 0; k < 2; k++) { const n = add(herb[(i + k) % 3], bx + (rand() - 0.5) * 1.6, y + 0.92, bz + (rand() - 0.5) * 1.4, rand() * TAU, 0.8 + rand() * 0.6); n.tier = 1; thin.push(n); stats.crops++; }
    });

    // ---- Crags: cliff bands on four contours, thickest on the wild faces, and boulders loose on the slopes.
    const rock = BL.dressing.mediterranean("rock");
    for (const [height, keep] of [[12, 0.5], [20, 0.62], [28, 0.7], [31.5, 0.5]]) contour(height, 4.2, (x, z, bearing) => {
      const wild = bearing < -0.75 || bearing > 2.4;
      const variant = Math.floor(rand() * 5), scale = 0.8 + rand() * 0.7;
      if (wave(bearing * 4 + height, height) > (wild ? keep : keep * 0.3) || !free(x, z, 2.6)) return;
      slope(x, z, G);
      rockAt(variant, x, h(x, z) - 0.7, z, Math.atan2(G.x, G.z) + (rand() - 0.5) * 0.5, scale);
      for (let k = 0; k < 2; k++) { const dx = x - G.x * (3 + rand() * 4) + (rand() - 0.5) * 5, dz = z - G.z * (3 + rand() * 4) + (rand() - 0.5) * 5; if (free(dx, dz, 1)) { const n = add(rock, dx, h(dx, dz) - 0.1, dz, rand() * TAU, 0.9 + rand() * 1.3); n.tier = 1 + k; thin.push(n); stats.stones++; } }
    });

    // Where the ground is steepest, above and below the trail's cuts, it shows as rock.
    for (let x = -96, i = 0; x < -4; x += 3.4) for (let z = -92; z < 16; z += 3.4) {
      const px = x + (rand() - 0.5) * 1.6, pz = z + (rand() - 0.5) * 1.6, variant = Math.floor(rand() * 5), scale = 0.55 + rand() * 0.45, reach = Math.max(CRAGS[variant][0], CRAGS[variant][2]) * 0.4 * scale;
      if (slope(px, pz, G) < 0.88 || Math.hypot(px - SUMMIT.x, pz - SUMMIT.z) < KEEP + 2 || h(px, pz) < 2 || near(land.trail, px, pz) < reach + 2.2 || near(streamLine, px, pz) < reach + 2.4 || !land.clearAt(px, pz, reach + 1.4)
        || routes.some((line) => near(line, px, pz) < reach + 2.2) || MILLS.some(([mx, mz]) => Math.hypot(px - mx, pz - mz) < reach + 5)) continue;
      rockAt(variant, px, h(px, pz) - 0.9, pz, Math.atan2(G.x, G.z) + (rand() - 0.5) * 0.4, scale, i++ % 3);
    }

    // ---- The stream: its water, the ledges it stands on, the falls, the pools at their feet, the stones along it.
    {
      const water = M.geometry(), ink = rgb(WATER), lit = { emissive: 0.04 }, quad = (a, b, c, d, up) => {
        const v = water.verts, q = [a, b, c, d], p = a * 3, r = b * 3, t = c * 3;
        const ny = (v[r + 2] - v[p + 2]) * (v[t] - v[p]) - (v[r] - v[p]) * (v[t + 2] - v[p + 2]);
        if (up && ny < 0) q.reverse();
        M.face(water, q, ink, lit);
      };
      let left = -1, right = -1;
      for (let i = 0; i < stream.length; i++) {
        const p = stream[i], q = stream[Math.min(stream.length - 1, i + 1)], o = stream[Math.max(0, i - 1)], dx = q.x - o.x, dz = q.z - o.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
        const pool = FALLS.some(([lip]) => p.s > lip + 0.8 && p.s < lip + 4.2), wide = (p.level ? 1.15 : pool ? 1.9 : 0.75) + 0.12 * Math.sin(p.s * 1.7);
        const a = M.pushVert(water, p.x + nx * wide, p.y, p.z + nz * wide), b = M.pushVert(water, p.x - nx * wide, p.y, p.z - nz * wide);
        if (left >= 0) {
          // A lip: the sheet falls from the level reach to the water below it, facing downstream.
          if (o.level && !p.level) { const c = M.pushVert(water, o.x + nx * 1.3 + dx / l * 0.7, p.y, o.z + nz * 1.3 + dz / l * 0.7), d = M.pushVert(water, o.x - nx * 1.3 + dx / l * 0.7, p.y, o.z - nz * 1.3 + dz / l * 0.7); quad(left, right, d, c, false); quad(right, left, c, d, false); left = c; right = d; }
          quad(left, a, b, right, true);
        }
        left = a; right = b;
        if (i % 3 === 0 && !p.level) for (const side of [-1, 1]) if (rand() < 0.8) { const bx = p.x + nx * side * (wide + 0.35), bz = p.z + nz * side * (wide + 0.35); const n = add(rock, bx, h(bx, bz) - 0.12, bz, rand() * TAU, 0.3 + rand() * 0.36); n.tier = 1; thin.push(n); stats.stones++; }
      }
      for (const f of water.faces) f.water = true;
      S.addChild(group, S.createNode({ geometry: noShadow(water), sightHidden: true }));
      for (const [lip, reach] of FALLS) {
        // Flat-topped ledges carry the level reach, taller toward the lip; crags close its sides.
        const level = stream.filter((p) => p.lip === lip), end = level[level.length - 1], next = stream[Math.min(stream.length - 1, stream.indexOf(end) + 3)];
        const yaw = Math.atan2(next.x - end.x, next.z - end.z), ax = Math.sin(yaw), az = Math.cos(yaw);
        for (let k = 0; k * 2.6 <= reach; k++) {
          const at = lip - 1.45 - k * 2.6, p = level.reduce((best, q) => Math.abs(q.s - at) < Math.abs(best.s - at) ? q : best), rise = p.y - 0.12 - p.ground;
          if (rise < 0.3) continue;
          const n = add(crag[5](), p.x, p.ground, p.z, yaw, 1, false); n.scale.x = 1.15; n.scale.y = rise / 3; n.scale.z = 0.62; stats.crags++;
          solid(p.x, p.z, 3.4, 1.5, yaw);
          for (const side of [-1, 1]) { const cx = p.x + az * side * 3.3, cz = p.z - ax * side * 3.3; rockAt((k + (side > 0 ? 1 : 0)) % 2 ? 1 : 3, cx, h(cx, cz) - 0.3, cz, yaw + side * 0.6, 0.75 + rise * 0.16); }
        }
        const drop = end.y - next.y;
        add(foam(), next.x - ax * 0.4, next.y - 0.08, next.z - az * 0.4, yaw, clamp(drop / 3.2, 0.6, 1.7));
      }
      // The spring: a kerbed basin against a slab of rock the water runs out of.
      const s0 = stream[0];
      rockAt(3, s0.x + 0.6, s0.ground - 0.2, s0.z - 2.1, 0.4, 0.9);
      const basin = M.lathe({ profile: [[1.5, 0.1], [0, 0.1]], segments: 14, color: WATER, emissive: 0.04 }); for (const f of basin.faces) f.water = true;
      add(noShadow(basin), s0.x, s0.ground, s0.z);
      for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + 0.5; if (Math.sin(a) < 0.75) add(rock, s0.x + Math.cos(a) * 1.75, s0.ground - 0.1, s0.z + Math.sin(a) * 1.75, a, 0.42 + (i % 3) * 0.08); }
    }

    // ---- The sacred way: steps on the steep legs, a wall or a rope on the drop, lanterns, shrines, a lookout,
    // and a bridge where the trail meets the stream.
    {
      const rope = [], trail = land.trail;
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1], b = trail[i], dx = b[0] - a[0], dz = b[1] - a[1];
        for (let k = 1; k < stream.length; k++) {
          const p = stream[k - 1], q = stream[k], ex = q.x - p.x, ez = q.z - p.z, den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-6) continue;
          const t = ((p.x - a[0]) * ez - (p.z - a[1]) * ex) / den, u = ((p.x - a[0]) * dz - (p.z - a[1]) * dx) / den;
          if (t > 0 && t < 1 && u >= 0 && u < 1) {
            // The bridge lies along the trail and tilts with its grade.
            const len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, x = a[0] + dx * t, z = a[1] + dz * t, grade = (h(x + ux * 3, z + uz * 3) - h(x - ux * 3, z - uz * 3)) / 6;
            if (!bridges.some((b) => Math.hypot(b.x - x, b.z - z) < 3)) bridges.push({ x, z, y: h(x, z) + 0.05, ux, uz, grade, yaw: Math.atan2(-dz, dx) });
          }
        }
      }
      for (const b of bridges) {
        add(bridge(), b.x, b.y, b.z, b.yaw, 1, false).rotation.z = Math.atan(b.grade);
        for (const side of [-1, 1]) solid(b.x - b.uz * side * 1.375, b.z + b.ux * side * 1.375, BRIDGE.half, 0.125, b.yaw);
      }
      let walked = 0, lastPost = null;
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1], b = trail[i], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, nx = -uz, nz = ux, yaw = Math.atan2(-uz, ux);
        for (let d = 0.45; d < len; d += 0.9, walked += 0.9) {
          const x = a[0] + ux * d, z = a[1] + uz * d;
          if (Math.hypot(x - SUMMIT.x, z - SUMMIT.z) < KEEP || bridges.some((q) => Math.hypot(x - q.x, z - q.z) < 4.6)) { lastPost = null; continue; }
          const grade = Math.abs(h(x + ux * 0.6, z + uz * 0.6) - h(x - ux * 0.6, z - uz * 0.6)) / 1.2;
          if (grade > 0.13) { add(step(), x, h(x, z) + 0.03, z, yaw + Math.PI / 2); stats.steps++; }
          const side = h(x + nx * 2.3, z + nz * 2.3) < h(x - nx * 2.3, z - nz * 2.3) ? 1 : -1, ex = x + nx * side * 1.85, ez = z + nz * side * 1.85, drop = h(x, z) - h(x + nx * side * 3.2, z + nz * side * 3.2);
          const step9 = Math.round(walked / 0.9);
          // Near a switchback the edge of one leg lies in the next leg's way: nothing stands there.
          if (drop > 0.5 && land.clearAt(ex, ez, 0.6) && near(trail, ex, ez) > 1.78) {
            if (wave(walked * 0.09, 3) > 0.5) { if (step9 % 2 === 0) { add(pathWall[step9 % 4 ? 0 : 1](), ex, h(ex, ez), ez, yaw, 1, false); solid(ex, ez, 0.75, 0.25, yaw); } lastPost = null; }
            else if (step9 % 3 === 0) {
              const top = h(ex, ez) + 0.82; add(post(), ex, h(ex, ez), ez, yaw);
              if (lastPost) { const mx = (lastPost[0] + ex) / 2, mz = (lastPost[2] + ez) / 2, my = (lastPost[1] + top) / 2 - 0.16; rope.push(M.beam(lastPost[0], lastPost[1], lastPost[2], mx, my, mz, 0.035, "#c9b27c"), M.beam(mx, my, mz, ex, top, ez, 0.035, "#c9b27c")); }
              lastPost = [ex, top, ez];
            }
          } else lastPost = null;
          if (step9 % 16 === 8) { const lx = x - nx * side * 1.9, lz = z - nz * side * 1.9; if (land.clearAt(lx, lz, 0.5) && near(trail, lx, lz) > 1.8) { lamps.push(add(lantern(), lx, h(lx, lz) - 0.05, lz, yaw)); stats.lanterns++; } }
        }
      }
      if (rope.length) S.addChild(group, S.createNode({ geometry: noShadow(M.merge(...rope)), sightHidden: true }));
      // A lantern on every switchback, shrines on the way, and a lookout over the Chora at the highest turn.
      for (const i of [2, 3, 4, 5]) { const p = trail[i], out = Math.atan2(p[0] - CENTRE.x, p[1] - CENTRE.z), x = p[0] + Math.sin(out) * 2.4, z = p[1] + Math.cos(out) * 2.4; lamps.push(add(lantern(), x, h(x, z) - 0.05, z, out)); stats.lanterns++; }
      for (const [x, z, yaw] of [[-29, -24.6, 2.9], [-33, -9.8, 2.8], [-27, 2.6, 0.5]]) { lamps.push(add(shrine(), x, h(x, z) - 0.05, z, yaw, 1, false)); solid(x, z, 0.32, 0.26, yaw); }
      const look = trail[2], lx = look[0] + 3.4, lz = look[1] - 0.4;
      add(bench(), lx, h(lx, lz), lz, -Math.PI / 2, 1, false); add(signpost(), look[0] + 1.6, h(look[0] + 1.6, look[1] + 2.6), look[1] + 2.6, 0.6, 1, false);
      for (let k = -3; k <= 3; k++) { const a = k * 0.3, x = look[0] + 5.2 * Math.cos(a), z = look[1] + 5.2 * Math.sin(a); add(pathWall[k & 1](), x, h(x, z), z, -a + Math.PI / 2, 1, false); solid(x, z, 0.75, 0.25, -a + Math.PI / 2); }
      const west = trail[3]; add(bench(), west[0] - 2.6, h(west[0] - 2.6, west[1] - 1.2), west[1] - 1.2, Math.PI / 2, 1, false);
    }

    // ---- Two windmills on the north-east shoulder, sails to the town.
    for (const [x, z, yaw] of MILLS) {
      const y = h(x, z), tower = add(mill(), x, y + 1.2, z, yaw, 1, false), sails = S.createNode({ geometry: wheel(), position: { x: 0, y: 5.3, z: 3.05 }, sightHidden: true });
      S.addChild(tower, sails); sails.rotation.z = x; wheels.push(sails); solid(x, z, 3.1, 3.1, yaw);
    }
    stats.solids = solids.length / 6;
    const inside = (x, z, r) => {
      const cell = grid.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL));
      if (!cell) return false;
      for (let n = 0; n < cell.length; n++) { const o = cell[n] * 6, dx = x - solids[o], dz = z - solids[o + 1], lx = solids[o + 4] * dx - solids[o + 5] * dz, lz = solids[o + 5] * dx + solids[o + 4] * dz; if (Math.abs(lx) < solids[o + 2] + r && Math.abs(lz) < solids[o + 3] + r) return true; }
      return false;
    };
    // Swept test for walkers. A body that already stands inside a solid may always walk out.
    const clearSegment = (ax, az, bx, bz, y, height, actor) => {
      const r = (actor && actor.bodyRadius || 0.4) * 0.8;
      if (inside(ax, az, r)) return true;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
      for (let i = 1; i <= n; i++) if (inside(ax + (bx - ax) * i / n, az + (bz - az) * i / n, r)) return false;
      return true;
    };
    // The ground a walker stands on: the terrain, or a bridge's deck where one crosses the stream.
    const supportAt = (x, z, ground) => {
      for (let i = 0; i < bridges.length; i++) {
        const b = bridges[i], dx = x - b.x, dz = z - b.z, lx = dx * b.ux + dz * b.uz, lz = dz * b.ux - dx * b.uz;
        if (Math.abs(lx) < BRIDGE.half && Math.abs(lz) < 1.25) return Math.max(ground, b.y + lx * b.grade + deckAt(lx));
      }
      return ground;
    };

    let glow = -1, quality = "";
    // The sails turn, the lanterns and shrines light with the island's lamps, and the lower tiers shed loose rock.
    const update = (dt, lamp) => {
      for (let i = 0; i < wheels.length; i++) wheels[i].rotation.z += dt * (0.5 + i * 0.07);
      if (lamp !== glow) { glow = lamp; for (let i = 0; i < lamps.length; i++) lamps[i].glow = lamp; }
      if (renderer.quality !== quality) { quality = renderer.quality; const cut = quality === "low" ? 1 : quality === "medium" ? 2 : 3; for (let i = 0; i < thin.length; i++) thin[i].visible = thin[i].tier < cut; }
    };
    const dispose = () => { S.removeChild(root, group); while (group.children.length) S.removeChild(group, group.children[group.children.length - 1]); lamps.length = wheels.length = thin.length = solids.length = taken.length = bridges.length = 0; grid.clear(); };
    update(0, 0);
    return { group, stats, bridges, update, clearSegment, supportAt, inside, dispose };
  };
  BL.dsbOlympus = { create, reserved };
})();
