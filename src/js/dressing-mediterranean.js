// Mediterranean extension of the shared dressing kit, built from the island's own cartoon kit (limb, puff, leafy,
// pointedLeaf) and its voxel stone. Same kinds and the same contact rule as before: the lowest vertices sit at
// y = 0, which the placement layers measure against the terrain. Dense kinds stay light: they are placed by the
// thousand.
(() => {
  "use strict";
  const BL = window.BL, M = BL.models, H = BL.hubModels, cache = new Map();
  const tones = list => list.map(BL.math.hexToRgb);
  const OLIVE = tones(["#55684b", "#6e8262", "#8b9e7c", "#acbb9b"]);
  const CYPRESS = tones(["#1d3829", "#284a33", "#35603e", "#467649"]);
  const SAGE = tones(["#55693f", "#6c8250", "#869b63", "#a2b47c"]);
  const THYME = tones(["#66744c", "#7e8b5e", "#98a273", "#b2b98b"]);
  const VINE = tones(["#3f6a35", "#528243", "#689a52", "#82b266"]);
  const BRACT = tones(["#96205f", "#bb2f7b", "#d94d98", "#ee7fb6"]);
  const BARK = tones(["#5a4e40", "#6c5e4b", "#7f705a"]);
  const STRAW = [["#b9ad76", "#9f9563"], ["#cbbf8a", "#aea471"], ["#a6a36c", "#8a8857"]].map(tones);
  const GREEN = [["#8fa663", "#748a50"], ["#a3b773", "#86995d"], ["#7d9658", "#667c48"]].map(tones);
  const BLOOM = [["#b3271e", "#d63a2c", "#ec5a45", "#f58a72"], ["#d9d2bd", "#ece6d4", "#f6f1e2", "#fffaf0"], ["#6f55a0", "#8a6cbb", "#a488d2", "#c2abe6"], ["#c79a1e", "#e3b72c", "#f0c93f", "#f8dc6c"]].map(tones);
  // A blade: one slim two-sided sliver, lit as ground so a tuft reads soft rather than spiky.
  const blade = (geo, x, z, lean, turn, h, ink, half = 0.035) => {
    const dx = Math.cos(turn) * lean * h, dz = Math.sin(turn) * lean * h, wx = -Math.sin(turn) * half, wz = Math.cos(turn) * half, b = geo.verts.length / 3;
    geo.verts.push(x - wx, 0, z - wz, x + wx, 0, z + wz, x + dx, h, z + dz);
    H.padNormals(geo);
    for (let k = 0; k < 3; k++) { geo.normals[(b + k) * 3] = 0; geo.normals[(b + k) * 3 + 1] = 1; geo.normals[(b + k) * 3 + 2] = 0; }
    geo.faces.push({ i: [b, b + 1, b + 2], color: ink[0], emissive: 0 }, { i: [b + 2, b + 1, b], color: ink[1], emissive: 0 });
  };
  // A leaf sprig on a clump's surface, to break a puff's outline without a whole rosette.
  const sprig = (geo, x, y, z, turn, len, light, dark) => {
    const c = Math.cos(turn), s = Math.sin(turn), l = Math.hypot(c, 0.7, s);
    H.pointedLeaf(geo, x, y, z, c / l, 0.7 / l, s / l, -s, 0, c, c * 0.5, 0.86, s * 0.5, len, light, dark);
  };
  const mediterranean = kind => {
    if (cache.has(kind)) return cache.get(kind);
    const geo = { verts: [], faces: [], lines: [], normals: [] }, rand = BL.math.mulberry32(BL.math.fnv1a(kind));
    if (kind === "olive") {
      // A short twisted bole that forks low, under a wide silver-green crown.
      H.limb(geo, 0, 0, 0, 0, 0.45, 0, 0.36, 0.27, 7, BARK[1]);
      H.limb(geo, 0, 0.45, 0, 0.1, 1.25, -0.06, 0.27, 0.2, 7, BARK[0]);
      H.limb(geo, 0.1, 1.25, -0.06, -0.8, 2.15, 0.1, 0.17, 0.08, 5, BARK[1]);
      H.limb(geo, 0.1, 1.25, -0.06, 0.85, 2.2, -0.25, 0.16, 0.08, 5, BARK[2]);
      H.limb(geo, 0.1, 1.25, -0.06, 0.1, 2.45, 0.6, 0.14, 0.07, 5, BARK[1]);
      H.padNormals(geo);
      for (const [cx, cy, cz, rx, ry, rz] of [[-0.8, 2.6, 0.1, 1.25, 0.76, 1.15], [0.85, 2.65, -0.3, 1.2, 0.74, 1.1], [0.1, 3.05, 0.55, 1.1, 0.7, 1.05]])
        H.leafy(geo, cx, cy, cz, rx, ry, rz, OLIVE, rand, 6, 0.42);
    } else if (kind === "cypress") {
      H.limb(geo, 0, 0, 0, 0, 0.7, 0, 0.13, 0.11, 6, BARK[0]);
      H.padNormals(geo);
      H.puff(geo, 0, 2.0, 0, 0.6, 1.75, 0.6, CYPRESS, rand, 7, 9);
      H.puff(geo, 0.03, 3.75, -0.02, 0.4, 1.95, 0.4, CYPRESS, rand, 7, 8, 0);
    } else if (kind === "shrub") {
      H.puff(geo, 0, 0.3, 0, 0.5, 0.42, 0.46, SAGE, rand, 5, 8);
      H.puff(geo, 0.36, 0.2, -0.18, 0.3, 0.27, 0.28, SAGE, rand, 4, 6);
      for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.3; sprig(geo, Math.cos(a) * 0.4, 0.38 + (i % 2) * 0.12, Math.sin(a) * 0.36, a, 0.22, SAGE[3], SAGE[1]); }
    } else if (kind === "cover") {
      H.puff(geo, 0, 0.11, 0, 0.46, 0.2, 0.4, THYME, rand, 4, 7);
      H.puff(geo, 0.3, 0.08, 0.16, 0.24, 0.15, 0.22, THYME, rand, 3, 6);
      for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.4; H.puff(geo, Math.cos(a) * 0.24, 0.24, Math.sin(a) * 0.2, 0.05, 0.045, 0.05, BLOOM[2], rand, 3, 5, 1); }
    } else if (kind === "grass" || kind === "meadow") {
      // `grass` is the tall dry tuft; `meadow` the short green one laid by the thousand.
      const n = kind === "grass" ? 12 : 4, ink = kind === "grass" ? STRAW : GREEN;
      for (let i = 0; i < n; i++) blade(geo, (rand() - 0.5) * (kind === "grass" ? 0.5 : 0.36), (rand() - 0.5) * (kind === "grass" ? 0.5 : 0.36), 0.1 + rand() * 0.45, rand() * 6.28, kind === "grass" ? 0.28 + rand() * 0.36 : 0.16 + rand() * 0.16, ink[i % 3], kind === "grass" ? 0.035 : 0.05);
    } else if (kind === "flowers") {
      for (let i = 0; i < 4; i++) blade(geo, (rand() - 0.5) * 0.5, (rand() - 0.5) * 0.5, 0.1 + rand() * 0.4, rand() * 6.28, 0.22 + rand() * 0.2, GREEN[i % 3], 0.045);
      for (let i = 0; i < 4; i++) {
        const x = (rand() - 0.5) * 0.62, z = (rand() - 0.5) * 0.62, h = 0.26 + rand() * 0.24;
        H.limb(geo, x, 0, z, x, h, z, 0.012, 0.01, 3, VINE[0]);
        H.padNormals(geo);
        H.puff(geo, x, h + 0.02, z, 0.075, 0.05, 0.075, BLOOM[i % 2], rand, 3, 5, 1);
      }
    } else if (kind === "rock") {
      // Squared, stacked stone on the quarter-metre grid: the block shader courses and pillows it like the main
      // island's cliffs. Flat base at y = 0.
      const v = M.makeVox(), ink = () => rand() < 0.3 ? 1 : rand() < 0.25 ? 2 : 0;
      for (const [cx, cz, rx, ry, rz] of [[0, 0, 3.4, 3.6, 2.6], [2.6, 1.2, 1.9, 2.1, 1.7], [-2.3, -1.3, 1.6, 1.4, 1.5]])
        for (let y = 0; y < ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) for (let z = Math.floor(cz - rz); z <= cz + rz; z++) {
          const q = Math.abs((x + 0.5 - cx) / rx) ** 4 + Math.abs((z + 0.5 - cz) / rz) ** 4 + ((y + 0.5) / ry) ** 2.4;
          if (q < 1 - rand() * 0.22) v.set(x, y, z, y >= ry - 1.2 ? 3 : ink());
        }
      const stone = M.voxelGeometry(v, { unit: 0.25, palette: ["#a8967c", "#93816b", "#877561", "#c0af93"] });
      stone.castShadow = false;
      cache.set(kind, stone);
      return stone;
    } else if (kind === "bougainvillea") {
      H.limb(geo, 0, 0, 0, 0.05, 1.2, 0.02, 0.06, 0.045, 5, BARK[0]);
      H.limb(geo, 0.05, 1.2, 0.02, -0.08, 2.5, 0.06, 0.045, 0.03, 5, BARK[1]);
      H.padNormals(geo);
      for (let i = 0; i < 6; i++) {
        const x = Math.sin(i * 2.2) * 0.3, y = 0.55 + i * 0.4, z = 0.1 + Math.cos(i * 2.2) * 0.12;
        H.puff(geo, x, y, z, 0.36, 0.3, 0.26, i % 2 ? VINE : BRACT, rand, 4, 7);
        H.puff(geo, x + 0.17, y + 0.14, z + 0.1, 0.2, 0.17, 0.16, BRACT, rand, 3, 6, 1);
        sprig(geo, x - 0.2, y + 0.1, z + 0.12, i * 1.9, 0.24, i % 2 ? BRACT[3] : VINE[3], i % 2 ? BRACT[1] : VINE[1]);
      }
    } else if (kind === "planter") {
      H.flatInto(geo, M.lathe({ profile: [[0, 0], [0.2, 0], [0.31, 0.26], [0.27, 0.42], [0.32, 0.47], [0.32, 0.52], [0.22, 0.52], [0, 0.47]], segments: 8, color: "#bd7650" }));
      H.puff(geo, 0, 0.66, 0, 0.3, 0.24, 0.3, VINE, rand, 4, 7);
      for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.4; H.puff(geo, Math.cos(a) * 0.2, 0.84, Math.sin(a) * 0.2, 0.085, 0.06, 0.085, BLOOM[i % 2], rand, 3, 5, 1); sprig(geo, Math.cos(a + 0.8) * 0.24, 0.7, Math.sin(a + 0.8) * 0.24, a + 0.8, 0.2, VINE[3], VINE[1]); }
    } else throw new Error(`Unknown Mediterranean dressing: ${kind}`);
    // Seat everything on a flat base: the placement layers measure the lowest vertices against the terrain.
    for (let i = 1; i < geo.verts.length; i += 3) if (geo.verts[i] < 0) geo.verts[i] = 0;
    H.padNormals(geo);
    geo.normals = Float32Array.from(geo.normals);
    geo.castShadow = kind === "olive" || kind === "cypress";
    cache.set(kind, geo);
    return geo;
  };
  BL.dressing.mediterranean = mediterranean;
})();
