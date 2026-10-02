// The Mempool island: a second floating chunk off the island's west rim, joined by a vine bridge,
// grown over with rainforest and hollowed by the Mempool cave. Geometry only — the hub places the
// island and its scatter, `scene-pool.js` builds the interior.
//
// Everything here is cached per shape and shared by every copy, so a hundred ferns are one draw call.
// The cave's readable surfaces come from two places the island already trusts: `hubModels.SIGN_GLYPHS`
// for carved headline numbers and the jumbotron's 5x7 font for the dense wall panels, turned into
// bounded run-length quads the same way the big board does it.
//
// The island stands between the 3 o'clock cave and the HQ ramp hill, clear of `terrain.js`'s
// CLOCKS, the gate trail on spoke(0) at 12 and the launch bridge on spoke(PI) at 6. Everything is
// built in a local frame whose +z points back at the home island, which `rotation.y = -bearing` maps
// inward, as the terrain turns its own mouths: the voxel islet, the vine bridge, three canopy heights
// with lianas, ferns, shrubs, mossy rocks and the pond, and the stairwell down the islet's centre,
// carved out of its own voxels so it is a real hole with a lined wall, a turning flight and a landing
// (`stairFoot`), with its sign and torches. The hall below is `caveR` 14 by `caveH` 8; `WALL` is its
// section as fractions of those two, and `wallRadiusAt`/`ceilingHeightAt` read that one curve both
// ways, so the lathe, the stalactites and the camera clamp all come from it. Floor rings run
// outward-in and the wall top-down, which is what faces their normals into the room.
//
// Station pieces: `stationFace`/`stationPlaque` carry a station's readables, `tabletSlab` is the
// standing tablet, `carve` cuts headline type from `hubModels.SIGN_GLYPHS` and `panelFrom` merges a
// canvas of the jumbotron's 5x7 font into bounded quads. `chainBoard`/`CHAIN_BOARD` is the stats
// board, whose panel is placed from the board's own numbers so resizing CHAIN_BOARD carries the face
// with it, and `infoSign` the weather key beside it. The plants, rocks, animals, bridge and stairwell are
// cartoon geometry from the hub's kit (`leafy`, `puff`, `limb`, `flatInto`), one cached build each shared by
// every copy; the solid ones keep their first block build as `collisionGeometry`. `spot` finds the rim and
// `build` returns the placed group.
// Set `lineWidth` on a merged geometry, not on the polylines going into it: `merge` does not carry it.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, math } = BL;
  const { createNode, addChild } = BL.scene;
  const { cached, box, bevelBox, lathe, merge, polyline, makeVox, voxelGeometry, noShadow, pushVert, face, turnedY } = models;
  const { mulberry32, lerp, hexToRgb } = math;
  const { puff, leafy, canopySupport, pointedLeaf, flower, FLOWER_INKS, limb, padNormals, flatInto, rock } = BL.hubModels;

  // A lathe whose colour varies by ring and segment, as `rocket-models.js` defines for the launch pad.
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

  const LEAF = "#2f6b33", LEAF_DK = "#245229", LEAF_LT = "#3f8a3c", BARK = "#4a3728", BARK_LT = "#5d4634";
  // Lines are drawn as screen-space quads, so this is a pixel width: 1.5 is the renderer default
  // and reads as thread against a canopy this size.
  const VINE_WIDTH = 3.6;
  const STONE = "#6f6f6a", STONE_DK = "#54544f", MOSS = "#3c6b40", WET = "#3a4a52", GOLD = "#e8c14a";
  const MOSS_RGB = hexToRgb("#4f7f36"), MOSS_TONES = [MOSS_RGB, MOSS_RGB, MOSS_RGB, MOSS_RGB];

  // The crossing shares the terrain's grass-topped stair terrace between the hilltops.
  const APPROACH = BL.terrain.POOL_APPROACH, BEARING = APPROACH.bearing;
  const DIR = { x: Math.sin(BEARING), z: -Math.cos(BEARING) };
  const SITE = { approachFrom: APPROACH.from, span: 17, sag: 0.5, width: 5.2, deckStart: -2.5, isletR: 13, isletDepth: 16, caveR: 14, caveH: 8, stationR: 12, shaftR: 2.9, shaftDepth: 8, bearing: BEARING, dir: DIR };
  const UNIT = 0.5;

  // Built in a local frame whose +z points back at the home island, which is what `rotation.y = -bearing`
  // maps inward, exactly as the terrain's own cave mouths are turned. The bridge head sits where the
  // terrace reaches the rim. Its top sets both ends of the bridge.
  const spot = (island, out = {}) => {
    const r = APPROACH.to;
    out.y = island.surfaceAt(DIR.x * r, DIR.z * r) + 0.02;
    out.rimRadius = r;
    out.bridgeX = DIR.x * r;
    out.bridgeZ = DIR.z * r;
    // The islet centre sits a bridge span and most of its own radius further out.
    const radius = r + SITE.span + SITE.isletR - 1;
    out.radius = radius;
    out.x = DIR.x * radius;
    out.z = DIR.z * radius;
    out.ry = -SITE.bearing;
    // How far out along local +z the bridge starts, so its far end lands on the rim head.
    out.bridgeLocalZ = radius - r - SITE.span;
    return out;
  };

  // A floating chunk of jungle floor: leaf litter, loam, then rock tapering to a point. Top face at y = 0.
  // Laid on the hub's coarse lattice: the outline, the depth and every colour are decided per metre block (two
  // cells square), so the rim steps a metre at a time and the tones come in metre patches and courses, never a
  // speckle of single cells. Only the stairwell stays round, cut per cell.
  const islet = cached(() => {
    const v = makeVox(), R = SITE.isletR / UNIT, deep = SITE.isletDepth / UNIT;
    const hash = (a, b, c) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
    for (let x = -Math.ceil(R) - 1; x <= Math.ceil(R) + 1; x++) {
      for (let z = -Math.ceil(R) - 1; z <= Math.ceil(R) + 1; z++) {
        const bx = Math.floor(x / 2), bz = Math.floor(z / 2), cx = bx * 2 + 1, cz = bz * 2 + 1;
        const a = Math.atan2(cz, cx), edge = R * (0.9 + 0.1 * Math.sin(a * 4 - 0.7) + 0.05 * Math.sin(a * 9 + 2.1));
        const r = Math.hypot(cx, cz);
        if (r > edge) continue;
        const k = r / edge, depth = Math.max(2, Math.round(deep * (1 - Math.pow(k, 1.4)) * (0.82 + (hash(bx, 7, bz) % 1000) / 1000 * 0.24)));
        // The stairwell is an actual hole down the middle: no ground inside it at all.
        const inShaft = Math.hypot(x + 0.5, z + 0.5) < SITE.shaftR / UNIT, shaftCells = SITE.shaftDepth / UNIT;
        for (let y = 1; y <= depth; y++) {
          if (inShaft && y <= shaftCells) continue;
          v.set(x, -y, z, y === 1 ? (hash(bx, 1, bz) % 100 < 30 ? 1 : 0) : y <= 3 ? 2 : (hash(bx, Math.floor((y - 4) / 2), bz) % 100 < 28 ? 4 : 3));
        }
      }
    }
    const options = { unit: UNIT, palette: ["#3f7d34", "#346d2c", "#5a4530", STONE, STONE_DK], origin: { x: 0, y: 0, z: 0 } };
    const geometry = voxelGeometry(v, options);
    // Keep one compact material grid for render-only floor sections. The
    // temporary sparse voxel map and collision geometry remain independent.
    geometry.cutawaySource = BL.terrain.cutawaySourceFromVox(v, options);
    return geometry;
  });

  // Bury the islet end inside its scalloped edge, and meet the top tread at the other end.
  const DECK_START = SITE.deckStart, DECK_END = SITE.span + 0.25;
  const deckY = (t) => { t = Math.max(0, Math.min(1, t)); return -SITE.sag * 4 * t * (1 - t); };
  // The crossing as it was first built, kept as the bridge's collision shell so walking on it never changes.
  const bridgeShell = cached(() => {
    const geos = [], w = SITE.width, length = DECK_END - DECK_START, count = Math.ceil(length / 0.46), pitch = length / count;
    for (let i = 0; i < count; i++) {
      const z = DECK_START + (i + 0.5) * pitch;
      geos.push(bevelBox({ w, h: 0.18, d: pitch + 0.02, color: i % 3 === 0 ? BARK : BARK_LT, bevel: 0.04, offset: { y: deckY(z / SITE.span) - 0.05, z } }));
    }
    const steps = 24;
    for (const side of [-1, 1]) {
      const rail = [], deck = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        rail.push({ x: side * w / 2, y: deckY(t) + 0.95, z: t * SITE.span });
        deck.push({ x: side * w / 2, y: deckY(t) - 0.04, z: t * SITE.span });
      }
      geos.push(polyline({ points: rail, color: MOSS, emissive: 0 }), polyline({ points: deck, color: BARK, emissive: 0 }));
      for (let i = 2; i < steps - 1; i += 3) {
        const t = i / steps;
        geos.push(polyline({ points: [{ x: side * w / 2, y: deckY(t) - 0.04, z: t * SITE.span }, { x: side * w / 2, y: deckY(t) + 0.95, z: t * SITE.span }], color: MOSS, emissive: 0 }));
      }
    }
    // A gateway at each end: two posts, a lashed crossbeam and a lantern, so the crossing reads as a way in.
    for (const z of [0, SITE.span]) {
      for (const side of [-1, 1]) {
        geos.push(bevelBox({ w: 0.36, h: 3.95, d: 0.36, color: BARK, offset: { x: side * (w / 2 + 0.16), y: 1.7, z } }));
        geos.push(bevelBox({ w: 0.46, h: 0.2, d: 0.46, color: MOSS, offset: { x: side * (w / 2 + 0.16), y: 3.68, z } }));
      }
      geos.push(bevelBox({ w: w + 0.9, h: 0.3, d: 0.3, color: BARK_LT, offset: { y: 3.8, z } }));
      geos.push(box({ w: 0.26, h: 0.34, d: 0.26, color: "#ffb347", emissive: 1, offset: { y: 3.46, z } }));
    }
    // Vines slung under the deck, following its own sag.
    for (const side of [-1, 1]) {
      const vine = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        vine.push({ x: side * w * 0.32, y: deckY(t) - 0.5 - Math.sin(t * Math.PI) * 0.55, z: t * SITE.span });
      }
      geos.push(polyline({ points: vine, color: LEAF_DK, emissive: 0 }));
    }
    const geo = merge(...geos);
    // The crossing is made of vine too: its rails and the ropes slung under the deck read as cord.
    geo.lineWidth = VINE_WIDTH;
    return geo;
  });
  // Drawn as a cartoon crossing: the same bevelled planks and gateways, with its rails, hangers and underslung
  // ropes as thick smooth vines, leaves sprouting along the rails and moss cushions on the post tops.
  const VINE = hexToRgb("#3f6b2a"), VINE_DK = hexToRgb("#2f5424"), LEAF_TONES = ["#2f6b2c", "#3f8a34", "#56a43f", "#74bd52"].map(hexToRgb);
  const bridge = cached(() => {
    const rand = mulberry32(5561), w = SITE.width, length = DECK_END - DECK_START, count = Math.ceil(length / 0.46), pitch = length / count;
    const geo = { verts: [], faces: [], lines: [], smooth: true, normals: [] };
    const vine = (pts, r0, r1, color) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1), a = pts[i], b = pts[i + 1];
        limb(geo, a.x, a.y, a.z, b.x, b.y, b.z, lerp(r0, r1, t0), lerp(r0, r1, t1), 6, color);
      }
      padNormals(geo);
    };
    const steps = 16;
    for (const side of [-1, 1]) {
      const x = side * w / 2, rail = [], deck = [], under = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        rail.push({ x, y: deckY(t) + 0.95, z: t * SITE.span });
        deck.push({ x, y: deckY(t) - 0.04, z: t * SITE.span });
        under.push({ x: side * w * 0.32, y: deckY(t) - 0.5 - Math.sin(t * Math.PI) * 0.55, z: t * SITE.span });
      }
      // End beneath the bridge gateways; tails beyond them emerge through the stair rock.
      vine(rail, 0.075, 0.075, VINE);
      vine(deck, 0.06, 0.06, VINE_DK);
      vine(under, 0.055, 0.055, VINE_DK);
      for (let i = 2; i < steps - 1; i += 2) {
        const t = i / steps;
        vine([{ x, y: deckY(t) - 0.04, z: t * SITE.span }, { x, y: deckY(t) + 0.95, z: t * SITE.span }], 0.035, 0.03, VINE_DK);
      }
      // Leaves in twos and threes along the rail, hanging out and down from it, lit as if the rail were a hedge.
      for (let i = 1; i < 24; i++) {
        const t = (i + rand() * 0.6) / 24, y = deckY(t) + 0.95, z = t * SITE.span;
        for (let n = rand() < 0.5 ? 2 : 3; n > 0; n--) {
          const out = side * (0.3 + rand() * 0.6), down = -0.3 - rand() * 0.7, along = (rand() - 0.5) * 0.8, l = Math.hypot(out, down, along);
          const ax = out / l, ay = down / l, az = along / l, wx = -az, wz = ax, wl = Math.hypot(wx, wz) || 1;
          const band = 1 + ((rand() * 3) | 0);
          pointedLeaf(geo, x, y, z, ax, ay, az, wx / wl, 0, wz / wl, side * 0.86, 0.51, 0, 0.26 + rand() * 0.12, LEAF_TONES[band], LEAF_TONES[band - 1]);
        }
      }
    }
    for (let i = 0; i < count; i++) {
      const z = DECK_START + (i + 0.5) * pitch;
      flatInto(geo, bevelBox({ w, h: 0.18, d: pitch + 0.02, color: i % 3 === 0 ? BARK : BARK_LT, bevel: 0.04, offset: { y: deckY(z / SITE.span) - 0.05, z } }));
      if (i % 6 === 1 || i % 9 === 5) {
        const side = i & 1 ? -1 : 1;
        flatInto(geo, bevelBox({ w: 0.28 + rand() * 0.16, h: 0.025, d: pitch * (0.5 + rand() * 0.25), color: i & 1 ? MOSS : "#4f7f36", bevel: 0.01,
          offset: { x: side * (w / 2 - 0.27 - rand() * 0.12), y: deckY(z / SITE.span) + 0.045, z: z + (rand() - 0.5) * pitch * 0.25 } }));
      }
    }
    for (const z of [0, SITE.span]) {
      for (const side of [-1, 1]) {
        flatInto(geo, bevelBox({ w: 0.36, h: 3.95, d: 0.36, color: BARK, offset: { x: side * (w / 2 + 0.16), y: 1.7, z } }));
        puff(geo, side * (w / 2 + 0.16), 3.7, z, 0.3, 0.16, 0.3, MOSS_TONES, rand, 4, 8);
      }
      flatInto(geo,
        bevelBox({ w: w + 0.9, h: 0.3, d: 0.3, color: BARK_LT, offset: { y: 3.8, z } }),
        bevelBox({ w: 0.3, h: 0.08, d: 0.3, color: "#3b2a1c", offset: { y: 3.61, z } }),
        bevelBox({ w: 0.26, h: 0.3, d: 0.26, color: "#ffb347", emissive: 1, bevel: 0.05, offset: { y: 3.41, z } }),
        bevelBox({ w: 0.3, h: 0.06, d: 0.3, color: "#3b2a1c", offset: { y: 3.24, z } })
      );
    }
    geo.normals = Float32Array.from(geo.normals);
    geo.collisionGeometry = bridgeShell();
    return geo;
  });

  // Rainforest: three canopy heights so the scatter reads as layers rather than a field of one tree.
  // The first build, trunk blocks and crown slabs, is kept as each tree's collision shell, so the walkable upper
  // crown and the solid trunk stay exactly where they were.
  const canopyShell = (seed, height, spread) => {
    const rand = mulberry32(seed), geos = [];
    const lean = (rand() - 0.5) * 0.25;
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      geos.push(box({ w: lerp(0.5, 0.26, t), h: height / 6, d: lerp(0.5, 0.26, t), color: i % 2 ? BARK : BARK_LT, offset: { x: lean * t * height, y: height * t + height / 12 } }));
    }
    const top = height + 0.1, cx = lean * height;
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 + rand(), r = spread * (0.55 + rand() * 0.45);
      geos.push(box({ w: r * 1.5, h: 0.52, d: r * 1.5, color: i % 2 ? LEAF : LEAF_LT, offset: { x: cx + Math.cos(a) * r * 0.35, y: top - i * 0.4, z: Math.sin(a) * r * 0.35 } }));
    }
    geos.push(box({ w: spread * 1.1, h: 0.58, d: spread * 1.1, color: LEAF_DK, offset: { x: cx, y: top + 0.36 } }));
    return merge(...geos);
  };
  const mono = (hex) => {
    const c = hexToRgb(hex);
    return [c, c, c, c];
  };
  // A leaf card from p along axis a, lying in the plane whose normal is n; its width runs along n x a.
  const leaflet = (geo, px, py, pz, ax, ay, az, nx, ny, nz, length, light, dark) => {
    const wx = ny * az - nz * ay, wy = nz * ax - nx * az, wz = nx * ay - ny * ax, wl = Math.hypot(wx, wy, wz) || 1;
    pointedLeaf(geo, px, py, pz, ax, ay, az, wx / wl, wy / wl, wz / wl, nx, ny, nz, length, light, dark);
  };
  // The unit normal of a leaf held along axis a with its face turned as far up as the axis allows.
  const UP = [0, 0, 0];
  const faceUp = (ax, ay, az) => {
    const k = ay, nx = -ax * k, ny = 1 - ay * k, nz = -az * k, l = Math.hypot(nx, ny, nz) || 1;
    UP[0] = nx / l; UP[1] = ny / l; UP[2] = nz / l;
    return UP;
  };
  const JUNGLE = ["#1f552a", "#2e7433", "#43923d", "#62b04c"].map(hexToRgb);
  const BARK_RGB = hexToRgb(BARK), LIANA = hexToRgb("#3f6a33");
  const TRUNK = hexToRgb("#6b4d33"), TRUNK_LT = hexToRgb("#7a5a3c");
  // Drawn as a cartoon rainforest tree: a tall tapered trunk on flared buttress roots, limbs reaching out to a wide
  // umbrella of leafy clumps (one broad crown and four lower satellites, so the layers of the old slabs survive),
  // and lianas hanging from the clumps' undersides as smooth cords.
  const canopy = (seed, height, spread) => cached(() => {
    const lean = (mulberry32(seed)() - 0.5) * 0.25, top = height + 0.1, cx = lean * height;
    const rand = mulberry32(seed + 500), geo = { verts: [], faces: [], lines: [], smooth: true, normals: [] };
    limb(geo, 0, -0.1, 0, cx * 0.8, height * 0.8, 0, 0.34, 0.2, 8, TRUNK);
    limb(geo, cx * 0.8, height * 0.8, 0, cx, top - 0.2, 0, 0.2, 0.12, 8, TRUNK);
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * Math.PI * 2 + 0.4 + rand() * 0.4;
      limb(geo, Math.cos(a) * 0.08, 0.95, Math.sin(a) * 0.08, Math.cos(a) * 0.68, -0.06, Math.sin(a) * 0.68, 0.16, 0.05, 5, TRUNK);
    }
    const crowns = [[cx, top + 0.2, 0, spread * 0.7, spread * 0.26]], branches = [];
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2 + rand() * 0.6, r = spread * (0.72 + rand() * 0.14);
      crowns.push([cx + Math.cos(a) * r, top - 0.25 - rand() * 0.5, Math.sin(a) * r, spread * (0.4 + rand() * 0.08), spread * 0.2]);
      const branch = [cx * 0.85, height * 0.8, 0, cx + Math.cos(a) * r * 0.85, top - 0.45, Math.sin(a) * r * 0.85];
      limb(geo, ...branch, 0.12, 0.05, 6, TRUNK_LT);
      branches.push(branch);
    }
    padNormals(geo);
    const canopyStart = geo.faces.length;
    for (const [x, y, z, rx, ry] of crowns) leafy(geo, x, y, z, rx, ry, rx, JUNGLE, rand, Math.round(6 + rx * rx * 5), 0.44);
    const canopyEnd = geo.faces.length;
    for (let k = 1; k < crowns.length; k += 2) {
      const [x, y, z, rx, ry] = crowns[k], a = rand() * Math.PI * 2, x0 = x + Math.cos(a) * rx * 0.5, z0 = z + Math.sin(a) * rx * 0.5;
      let px = x0, py = y - ry * 0.5, pz = z0;
      for (let j = 1; j <= 5; j++) {
        const nx = x0 + (rand() - 0.5) * 0.25, ny = y - ry * 0.5 - j * height * 0.1, nz = z0 + (rand() - 0.5) * 0.25;
        limb(geo, px, py, pz, nx, ny, nz, 0.04, 0.035, 5, LIANA);
        px = nx; py = ny; pz = nz;
      }
      padNormals(geo);
    }
    geo.normals = Float32Array.from(geo.normals);
    geo.sway = 0.0006;
    // Where the wildlife climbs and perches, in the tree's own frame: the trunk's lean at the top, its height, the
    // five limbs (from the trunk out to each lower crown), and a perch on top of every crown.
    geo.climb = { lean: cx, height, branches, perches: crowns.map(([x, y, z, , ry]) => [x, y + ry * 0.9, z]) };
    geo.collisionGeometry = merge(canopyShell(seed, height, spread), canopySupport(geo, canopyStart, canopyEnd));
    return geo;
  });
  const CANOPY = [canopy(71, 7.5, 3.2), canopy(72, 5.4, 2.6), canopy(73, 9.2, 3.8)];

  // Eight fronds arching out and down, each a row of paired leaflets shrinking to a tip.
  const FERN = ["#2c6a2a", "#3d8a34", "#56a842", "#79c457"].map(hexToRgb);
  const fern = cached(() => {
    const rand = mulberry32(88), geo = { verts: [], faces: [], lines: [], normals: [] };
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + rand() * 0.3, len = 0.6 + rand() * 0.35, ca = Math.cos(a), sa = Math.sin(a), rise = 0.45 + rand() * 0.2;
      const at = (t, out) => { out[0] = ca * len * t; out[1] = 0.05 + Math.sin(t * Math.PI * 0.8) * len * rise; out[2] = sa * len * t; return out; };
      const p = [0, 0, 0], q = [0, 0, 0], light = FERN[2 + (i & 1)], dark = FERN[1 + (i & 1)];
      for (let j = 0; j <= 6; j++) {
        const t = (j + 0.6) / 6.6;
        at(Math.min(1, t), p); at(Math.min(1, t + 0.05), q);
        let fx = q[0] - p[0], fy = q[1] - p[1], fz = q[2] - p[2];
        const fl = Math.hypot(fx, fy, fz) || 1;
        fx /= fl; fy /= fl; fz /= fl;
        const size = 0.22 * (1 - t * 0.55) * len;
        for (const side of j === 6 ? [0] : [-1, 1]) {
          let ax = -sa * side + fx * 0.7, ay = -0.12 + fy * 0.7, az = ca * side + fz * 0.7;
          const l = Math.hypot(ax, ay, az);
          ax /= l; ay /= l; az /= l;
          const n = faceUp(ax, ay, az);
          leaflet(geo, p[0], p[1], p[2], ax, ay, az, n[0], n[1], n[2], size, light, dark);
        }
      }
    }
    geo.normals = Float32Array.from(geo.normals);
    return Object.assign(noShadow(geo), { sway: 0.06 });
  });
  // A jungle shrub: two leafy clumps over a skirt of broad elephant-ear leaves.
  const SHRUB = ["#2f6424", "#478a2f", "#62a63a", "#83c24c"].map(hexToRgb);
  const shrub = cached(() => {
    const rand = mulberry32(95), geo = { verts: [], faces: [], lines: [], normals: [] };
    leafy(geo, 0, 0.4, 0, 0.56, 0.38, 0.56, SHRUB, rand, 18, 0.2);
    leafy(geo, 0.12, 0.72, -0.08, 0.36, 0.26, 0.36, SHRUB, rand, 10, 0.17);
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2 + rand() * 0.5, l = Math.hypot(0.8, 0.45);
      const ax = Math.cos(a) * 0.8 / l, ay = 0.45 / l, az = Math.sin(a) * 0.8 / l, n = faceUp(ax, ay, az);
      leaflet(geo, Math.cos(a) * 0.25, 0.12, Math.sin(a) * 0.25, ax, ay, az, n[0], n[1], n[2], 0.55 + rand() * 0.15, SHRUB[2], SHRUB[1]);
    }
    geo.normals = Float32Array.from(geo.normals);
    return Object.assign(geo, { sway: 0.03 });
  });
  // The hub's rounded boulder in its jungle variant, walked against as the old block rock.
  const mossRock = cached(() => ({
    ...rock(2),
    collisionGeometry: merge(
      box({ w: 1.1, h: 0.7, d: 0.95, color: STONE, offset: { y: 0.35 } }),
      box({ w: 0.8, h: 0.12, d: 0.7, color: MOSS, offset: { y: 0.74 } })
    )
  }));
  // Rainforest wildlife, drawn after the low-poly reference animals: real anatomy in few large flat facets, each
  // triangle one painted colour, so a jaguar's rosettes are whole black facets and a toucan's bill is bands of
  // them. Every animal is a rig of parts, each built in its own joint frame, that `pool-wildlife.js` poses and
  // drives. All three face +x.
  //
  // `loft` rings `sides` points round a path of stations [x, y, z, ry, rz] (ry the half-size across the path in
  // its vertical plane, rz the lateral one), rings alternating by half a step so the surface breaks into
  // triangles, and paints each triangle by `paint(x, y, z, nx, ny, nz)` at its centre.
  const loft = (geo, stations, sides, paint) => {
    const n = stations.length, rings = [];
    for (let i = 0; i < n; i++) {
      const s = stations[i], a = stations[Math.max(0, i - 1)], b = stations[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // Lateral is the path crossed with up, or +z made square to a vertical run.
      let lx = -tz, ly = 0, lz = tx;
      if (Math.hypot(lx, lz) < 0.3) { lx = -tx * tz; ly = -ty * tz; lz = 1 - tz * tz; }
      const ll = Math.hypot(lx, ly, lz);
      lx /= ll; ly /= ll; lz /= ll;
      const vx = ly * tz - lz * ty, vy = lz * tx - lx * tz, vz = lx * ty - ly * tx, ring = [];
      for (let k = 0; k < sides; k++) {
        const t = (k + (i & 1) * 0.5) / sides * Math.PI * 2, c = Math.cos(t) * s[3], d = Math.sin(t) * s[4];
        ring.push([s[0] + vx * c + lx * d, s[1] + vy * c + ly * d, s[2] + vz * c + lz * d]);
      }
      rings.push(ring);
    }
    const tri = (p, q, r, ref) => {
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], wx = r[0] - p[0], wy = r[1] - p[1], wz = r[2] - p[2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const mx = (p[0] + q[0] + r[0]) / 3, my = (p[1] + q[1] + r[1]) / 3, mz = (p[2] + q[2] + r[2]) / 3;
      if (nx * (mx - ref[0]) + ny * (my - ref[1]) + nz * (mz - ref[2]) < 0) { const swap = q; q = r; r = swap; nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1, base = geo.verts.length / 3;
      geo.verts.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
      geo.faces.push({ i: [base, base + 1, base + 2], color: paint(mx, my, mz, nx / l, ny / l, nz / l), emissive: 0 });
    };
    const mid = (i, j) => [(stations[i][0] + stations[j][0]) / 2, (stations[i][1] + stations[j][1]) / 2, (stations[i][2] + stations[j][2]) / 2];
    for (let i = 0; i < n - 1; i++) {
      const A = rings[i], B = rings[i + 1], ref = mid(i, i + 1);
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        if (i & 1) { tri(A[k], B[k1], A[k1], ref); tri(A[k], B[k], B[k1], ref); }
        else { tri(A[k], B[k], A[k1], ref); tri(A[k1], B[k], B[k1], ref); }
      }
    }
    for (const [i, j] of [[0, 1], [n - 1, n - 2]]) {
      const s = stations[i];
      if (!s[3] && !s[4]) continue;
      const c = [s[0], s[1], s[2]], ref = mid(i, j);
      for (let k = 0; k < sides; k++) tri(c, rings[i][k], rings[i][(k + 1) % sides], ref);
    }
    return geo;
  };
  const part = (build) => {
    const geo = { verts: [], faces: [], lines: [] };
    build(geo);
    return geo;
  };
  // A rig: parts keyed by name, each { geometry, at: [x, y, z], parent } with `at` in the parent's frame
  // (the root's for the body, the body's for the rest).
  const RIG_BUILDERS = {
    // Built from measurements of the reference jaguar the maintainer chose: every station below is a slice of
    // that model (body every 9 cm, head, ears, each leg top to paw, the tail along its hang), so the silhouette is
    // its silhouette. A deep body held high on straight forelegs and sloping hind legs, the neck rising to a head
    // above the back, and a long tail hanging from the rump to the ground. The coat is its palette as a mosaic of
    // small facets: black over about two-fifths, tawny, brown and sand, pale peach underneath, on the jaw and paws.
    jaguar: () => {
      const rand = mulberry32(6101), ink = hexToRgb("#0e0a07"), tawny = hexToRgb("#f0a860"), sand = hexToRgb("#d8c090"), brown = hexToRgb("#906030"), pale = hexToRgb("#f0c0a8"), nose = hexToRgb("#c07070");
      const coat = (spots, belly, paleSpots = 0.1) => (x, y, z, nx, ny) => {
        const r = rand();
        if (ny < belly) return r < paleSpots ? ink : pale;
        return r < spots ? ink : r < spots + 0.1 ? brown : r < spots + 0.18 ? sand : tawny;
      };
      const legPaint = (foot) => {
        const upper = coat(0.4, -2), shin = coat(0.26, -2);
        return (x, y, z, nx, ny, nz) => y < foot ? pale : y < -0.2 ? shin(x, y, z, nx, ny, nz) : upper(x, y, z, nx, ny, nz);
      };
      const FRONT = [[0, 0.1, 0, 0.12, 0.08], [0, 0, 0, 0.103, 0.074], [0.011, -0.052, 0, 0.073, 0.044], [0.008, -0.105, 0, 0.066, 0.039], [0.007, -0.158, 0, 0.06, 0.035], [0.008, -0.21, 0, 0.055, 0.034],
        [0.012, -0.263, 0, 0.048, 0.035], [0.042, -0.315, 0, 0.072, 0.038], [0.057, -0.368, 0, 0.083, 0.052], [0.06, -0.394, 0, 0.07, 0.045]];
      const HIND = [[0, 0.1, 0, 0.14, 0.07], [0, 0, 0, 0.126, 0.047], [-0.006, -0.055, 0, 0.106, 0.045], [-0.033, -0.11, 0, 0.101, 0.044], [-0.062, -0.165, 0, 0.091, 0.04], [-0.092, -0.22, 0, 0.074, 0.036],
        [-0.113, -0.275, 0, 0.046, 0.033], [-0.08, -0.33, 0, 0.064, 0.029], [-0.059, -0.385, 0, 0.069, 0.041], [-0.055, -0.412, 0, 0.06, 0.036]];
      const TAIL = [[0.03, 0.02, 0, 0.04, 0.04], [0.013, -0.048, 0, 0.033, 0.033], [-0.006, -0.117, 0, 0.034, 0.034], [-0.031, -0.187, 0, 0.032, 0.032], [-0.062, -0.259, 0, 0.031, 0.031], [-0.091, -0.328, 0, 0.03, 0.03],
        [-0.126, -0.399, 0, 0.029, 0.029], [-0.159, -0.465, 0, 0.028, 0.028], [-0.217, -0.529, 0, 0.03, 0.03], [-0.301, -0.573, 0, 0.03, 0.03], [-0.36, -0.59, 0, 0.012, 0.012]];
      const headFur = coat(0.2, -0.4, 0), tailFur = coat(0.4, -2);
      return {
        body: { at: [0, 0.58, 0], geometry: part((g) => loft(g, [[-0.53, -0.008, 0, 0.02, 0.02], [-0.495, -0.008, 0, 0.064, 0.033], [-0.404, -0.007, 0, 0.133, 0.132], [-0.313, 0.008, 0, 0.148, 0.143], [-0.222, 0.019, 0, 0.159, 0.143],
          [-0.132, 0.024, 0, 0.163, 0.138], [-0.041, 0.019, 0, 0.172, 0.137], [0.05, 0.005, 0, 0.183, 0.146], [0.141, -0.003, 0, 0.187, 0.159], [0.232, -0.006, 0, 0.187, 0.162], [0.322, 0.006, 0, 0.179, 0.163],
          [0.413, 0.02, 0, 0.18, 0.157], [0.504, 0.038, 0, 0.198, 0.134], [0.595, 0.1, 0, 0.165, 0.098], [0.63, 0.13, 0, 0.12, 0.09]], 10, coat(0.4, -0.55))) },
        head: { at: [0.6, 0.14, 0], parent: "body", geometry: part((g) => {
          loft(g, [[-0.01, 0, 0, 0.11, 0.09], [0.019, 0.003, 0, 0.122, 0.098], [0.058, 0.017, 0, 0.108, 0.106], [0.096, 0.029, 0, 0.095, 0.11], [0.135, 0.028, 0, 0.097, 0.111], [0.174, 0.022, 0, 0.103, 0.093],
            [0.212, 0.006, 0, 0.086, 0.061], [0.251, -0.01, 0, 0.04, 0.05], [0.262, -0.012, 0, 0.012, 0.015]], 9,
            (x, y, z, nx, ny, nz) => x > 0.24 && ny > -0.2 ? nose : ny < -0.35 || x > 0.2 && y < -0.02 ? pale : headFur(x, y, z, nx, ny, nz));
          for (const s of [-1, 1]) {
            loft(g, [[0.125, 0.1, s * 0.065, 0.03, 0.016], [0.135, 0.15, s * 0.075, 0.018, 0.01], [0.14, 0.175, s * 0.078, 0.004, 0.004]], 5, (x, y, z, nx) => nx < -0.3 ? ink : tawny);
            loft(g, [[0.19, 0.045, s * 0.07, 0.015, 0.012], [0.2, 0.047, s * 0.09, 0.009, 0.007]], 5, () => ink);
          }
        }) },
        legFL: { at: [0.383, -0.186, 0.074], parent: "body", geometry: part((g) => loft(g, FRONT, 7, legPaint(-0.35))) },
        legFR: { at: [0.383, -0.186, -0.074], parent: "body", geometry: part((g) => loft(g, FRONT, 7, legPaint(-0.35))) },
        legBL: { at: [-0.285, -0.168, 0.096], parent: "body", geometry: part((g) => loft(g, HIND, 7, legPaint(-0.37))) },
        legBR: { at: [-0.285, -0.168, -0.096], parent: "body", geometry: part((g) => loft(g, HIND, 7, legPaint(-0.37))) },
        tail: { at: [-0.5, 0.04, 0], parent: "body", geometry: part((g) => loft(g, TAIL, 6,
          (x, y, z, nx, ny, nz) => y < -0.47 ? (Math.round((x - y) * 16) % 2 ? ink : tawny) : tailFur(x, y, z, nx, ny, nz))) }
      };
    },
    // Reddish-brown fur in two close tones, a mauve face mask, peach muzzle, ears, hands and feet. Knuckle-walks on
    // arms longer than its legs, head low and forward; a short curled tail keeps it a monkey.
    monkey: () => {
      const rand = mulberry32(6103), fur = hexToRgb("#8e4a1a"), furDk = hexToRgb("#7a3e16"), mask = hexToRgb("#784848"), peach = hexToRgb("#f0c090"), ink = hexToRgb("#141010");
      const coat = () => rand() < 0.3 ? furDk : fur;
      const limbPaint = (hand) => (x, y) => y < hand ? peach : coat();
      const ARM = [[0, 0, 0, 0.065, 0.06], [0.05, -0.25, 0, 0.055, 0.05], [0.1, -0.47, 0, 0.045, 0.045], [0.13, -0.52, 0, 0.04, 0.05], [0.18, -0.53, 0, 0.02, 0.04]];
      const LEG = [[0, 0, 0, 0.075, 0.07], [0.1, -0.16, 0, 0.06, 0.055], [-0.02, -0.34, 0, 0.045, 0.045], [0.02, -0.39, 0, 0.035, 0.05], [0.12, -0.4, 0, 0.02, 0.05]];
      return {
        body: { at: [0, 0.4, 0], geometry: part((g) => loft(g, [[-0.08, -0.02, 0, 0.1, 0.1], [0.04, 0.05, 0, 0.16, 0.15], [0.16, 0.11, 0, 0.18, 0.18], [0.27, 0.15, 0, 0.17, 0.2], [0.34, 0.16, 0, 0.12, 0.14], [0.37, 0.16, 0, 0.06, 0.07]], 7, coat)) },
        head: { at: [0.36, 0.2, 0], parent: "body", geometry: part((g) => {
          loft(g, [[-0.02, 0, 0, 0.08, 0.08], [0.04, 0.03, 0, 0.12, 0.12], [0.12, 0.04, 0, 0.125, 0.12], [0.19, 0.02, 0, 0.1, 0.1], [0.24, -0.02, 0, 0.07, 0.08], [0.27, -0.04, 0, 0.04, 0.05]], 7,
            (x, y, z, nx, ny) => x > 0.21 && ny < 0.5 ? peach : x > 0.12 && nx > 0.2 ? mask : coat());
          for (const s of [-1, 1]) {
            loft(g, [[0.07, 0.04, s * 0.1, 0.045, 0.015], [0.075, 0.05, s * 0.145, 0.032, 0.008]], 5, () => peach);
            loft(g, [[0.19, 0.05, s * 0.05, 0.02, 0.015], [0.205, 0.055, s * 0.08, 0.012, 0.009]], 4, () => ink);
          }
        }) },
        armL: { at: [0.28, 0.12, 0.18], parent: "body", geometry: part((g) => loft(g, ARM, 5, limbPaint(-0.48))) },
        armR: { at: [0.28, 0.12, -0.18], parent: "body", geometry: part((g) => loft(g, ARM, 5, limbPaint(-0.48))) },
        legL: { at: [0, 0, 0.1], parent: "body", geometry: part((g) => loft(g, LEG, 5, limbPaint(-0.36))) },
        legR: { at: [0, 0, -0.1], parent: "body", geometry: part((g) => loft(g, LEG, 5, limbPaint(-0.36))) },
        tail: { at: [-0.08, 0.02, 0], parent: "body", geometry: part((g) => loft(g, [[0, 0, 0, 0.028, 0.028], [-0.12, 0.08, 0, 0.024, 0.024], [-0.18, 0.22, 0, 0.02, 0.02], [-0.13, 0.32, 0, 0.016, 0.016], [-0.06, 0.33, 0, 0.008, 0.008]], 5, coat)) }
      };
    },
    // Black plumage, a sunny yellow bib, a red vent and lime face skin; the keel bill runs lime, orange and red in
    // bands. It perches upright like the reference parrot on blue-grey feet, with folded wings that open to fly
    // and a long tail.
    toucan: () => {
      const rand = mulberry32(6102), black = hexToRgb("#16161c"), sheen = hexToRgb("#262a3a"), bib = hexToRgb("#f2d640"), bibEdge = hexToRgb("#f7ecb0"), vent = hexToRgb("#c8322e");
      const lime = hexToRgb("#9ad04a"), orange = hexToRgb("#f0972a"), red = hexToRgb("#d83a2a"), blue = hexToRgb("#2c4c8a"), foot = hexToRgb("#5e7aa0"), ink = hexToRgb("#0c0c10");
      const plumage = () => rand() < 0.2 ? sheen : black;
      const WING = [[0, 0, 0, 0.07, 0.02], [-0.1, -0.1, 0, 0.08, 0.022], [-0.2, -0.2, 0, 0.06, 0.018], [-0.28, -0.27, 0, 0.025, 0.01]];
      const LEG = [[0, 0, 0, 0.022, 0.022], [0.01, -0.16, 0, 0.016, 0.016], [0.015, -0.175, 0, 0.008, 0.008]];
      const feet = (g, s) => {
        loft(g, LEG, 4, () => foot);
        for (const [dx, dz] of [[0.07, 0.018], [0.07, -0.018], [-0.05, 0.012]]) loft(g, [[0.01, -0.17, 0, 0.01, 0.01], [0.01 + dx, -0.178, dz * s, 0.005, 0.005]], 4, () => foot);
      };
      return {
        body: { at: [0, 0.2, 0], geometry: part((g) => loft(g, [[-0.14, -0.04, 0, 0.045, 0.045], [-0.08, 0.03, 0, 0.1, 0.09], [-0.01, 0.13, 0, 0.125, 0.11], [0.05, 0.24, 0, 0.11, 0.1], [0.08, 0.31, 0, 0.075, 0.075], [0.09, 0.34, 0, 0.04, 0.04]], 7,
          (x, y, z, nx) => y < 0.03 && x < -0.04 ? vent : nx > 0.3 && y > 0.14 ? (y < 0.19 ? bibEdge : bib) : plumage())) },
        head: { at: [0.08, 0.33, 0], parent: "body", geometry: part((g) => {
          loft(g, [[0, 0, 0, 0.065, 0.065], [0.02, 0.05, 0, 0.095, 0.085], [0.07, 0.09, 0, 0.09, 0.08], [0.12, 0.09, 0, 0.06, 0.06], [0.14, 0.085, 0, 0.04, 0.045]], 6,
            (x, y, z, nx, ny, nz) => ny < -0.2 && x > -0.01 ? bib : Math.abs(nz) > 0.6 && x > 0.03 && y > 0.05 ? lime : plumage());
          loft(g, [[0.12, 0.085, 0, 0.065, 0.045], [0.24, 0.07, 0, 0.058, 0.04], [0.36, 0.03, 0, 0.035, 0.028], [0.42, -0.005, 0, 0.01, 0.01]], 6,
            (x) => x < 0.19 ? lime : x < 0.33 ? orange : red);
          for (const s of [-1, 1]) loft(g, [[0.06, 0.1, s * 0.055, 0.02, 0.015], [0.065, 0.1, s * 0.085, 0.012, 0.008]], 4, () => ink);
        }) },
        wingL: { at: [0.02, 0.24, 0.09], parent: "body", geometry: part((g) => loft(g, WING, 5, (x) => x < -0.2 ? (rand() < 0.5 ? blue : black) : plumage())) },
        wingR: { at: [0.02, 0.24, -0.09], parent: "body", geometry: part((g) => loft(g, WING, 5, (x) => x < -0.2 ? (rand() < 0.5 ? blue : black) : plumage())) },
        tail: { at: [-0.13, -0.03, 0], parent: "body", geometry: part((g) => loft(g, [[0, 0, 0, 0.025, 0.05], [-0.16, -0.06, 0, 0.02, 0.055], [-0.32, -0.1, 0, 0.015, 0.05], [-0.36, -0.11, 0, 0.005, 0.03]], 4, plumage)) },
        legL: { at: [0, -0.02, 0.045], parent: "body", geometry: part((g) => feet(g, 1)) },
        legR: { at: [0, -0.02, -0.045], parent: "body", geometry: part((g) => feet(g, -1)) }
      };
    }
  };
  const RIGS = {};
  const beastRig = (kind) => RIGS[kind] || (RIGS[kind] = RIG_BUILDERS[kind]());

  // A flower patch: a rosette of leaves on the ground and seven stems, each topped with a five-petal flower.
  const PATCH_LEAVES = ["#3f7f2c", "#5b9a3a"].map(hexToRgb), STEM = hexToRgb(LEAF_LT);
  const flowers = cached(() => {
    const rand = mulberry32(404), geo = { verts: [], faces: [], lines: [], smooth: true, normals: [] };
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2 + rand() * 0.4, l = Math.hypot(0.85, 0.3);
      const ax = Math.cos(a) * 0.85 / l, ay = 0.3 / l, az = Math.sin(a) * 0.85 / l, n = faceUp(ax, ay, az);
      leaflet(geo, Math.cos(a) * 0.05, 0.02, Math.sin(a) * 0.05, ax, ay, az, n[0], n[1], n[2], 0.3 + rand() * 0.1, PATCH_LEAVES[1], PATCH_LEAVES[0]);
    }
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2, r = 0.1 + rand() * 0.42, x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.3 + rand() * 0.24;
      limb(geo, x * 0.6, 0, z * 0.6, x, h, z, 0.016, 0.012, 5, STEM);
      padNormals(geo);
      const ink = FLOWER_INKS[i % FLOWER_INKS.length], nl = Math.hypot(x * 0.5, 1, z * 0.5);
      flower(geo, x, h, z, x * 0.5 / nl, 1 / nl, z * 0.5 / nl, ink[0], ink[1], 0.1, rand);
    }
    geo.normals = Float32Array.from(geo.normals);
    return Object.assign(noShadow(geo), { sway: 0.08 });
  });
  // A fallen trunk: round and smooth, pale sawn ends round a darker heart, a snapped branch stub, a long cushion
  // of moss along its back and three faintly glowing mushrooms.
  const log = cached(() => {
    const rand = mulberry32(1771), geo = { verts: [], faces: [], lines: [], smooth: true, normals: [] }, SIDES = 9;
    limb(geo, -1.6, 0.3, 0, 1.55, 0.29, 0, 0.3, 0.28, SIDES, BARK_RGB);
    limb(geo, -0.4, 0.45, 0.1, -0.55, 0.8, 0.34, 0.09, 0.06, 6, BARK_RGB);
    for (const [x, y, r, s] of [[1.55, 0.29, 0.28, 1], [-1.6, 0.3, 0.3, -1]]) {
      for (const [k, color] of [[1, hexToRgb("#b08a5c")], [0.55, hexToRgb("#8a6a44")]]) {
        const ids = [];
        for (let e = 0; e < SIDES; e++) {
          const a = e / SIDES * Math.PI * 2;
          geo.verts.push(x + s * (k < 1 ? 0.006 : 0), y + Math.cos(a) * r * k, Math.sin(a) * r * k);
          ids.push(geo.verts.length / 3 - 1);
        }
        geo.faces.push({ i: s > 0 ? ids : ids.reverse(), color, emissive: 0 });
      }
    }
    padNormals(geo);
    puff(geo, 0.1, 0.52, 0, 1.2, 0.12, 0.24, MOSS_TONES, rand, 4, 10);
    for (let i = 0; i < 3; i++) {
      const x = -1 + i * 0.9;
      limb(geo, x, 0.5, 0.2, x, 0.62, 0.25, 0.03, 0.025, 5, hexToRgb("#e8e0c8"));
      padNormals(geo);
      const first = geo.faces.length;
      puff(geo, x, 0.63, 0.25, 0.11, 0.05, 0.11, mono("#d8d2b4"), rand, 3, 8);
      for (let f = first; f < geo.faces.length; f++) geo.faces[f].emissive = 0.15;
    }
    geo.normals = Float32Array.from(geo.normals);
    // The top of the trunk along its own x, where a big cat can lie.
    geo.rest = { y: 0.58, from: -1.2, to: 1.2 };
    return geo;
  });

  // A still pool of standing water: the island's name, and the only flat thing on it.
  const pond = cached(() => {
    const geo = noShadow(lathe({ profile: [[2.6, 0.06], [0, 0.06]], segments: 20, color: WET, emissive: 0.22 }));
    for (const f of geo.faces) f.water = true;
    return geo;
  });

  // The stairwell: a mossy stone kerb round the hole, a lined shaft so you never see sky through it,
  // and a flight turning down into the dark. Its own origin is the hole's centre at ground level.
  // `stairwellShell` is the first block build, kept as the drawn stairwell's collision shell.
  const STAIR_STEPS = 26, STAIR_TURNS = 1.35, STAIR_INNER = 0.55, LINING_DROP = 0.12;
  const stairwellShell = () => {
    const R = SITE.shaftR, D = SITE.shaftDepth, geos = [];
    const kerb = 20;
    for (let i = 0; i < kerb; i++) {
      const a = i / kerb * Math.PI * 2, x = Math.cos(a) * (R + 0.3), z = Math.sin(a) * (R + 0.3);
      geos.push(box({ w: 0.8, h: 0.55, d: 0.8, color: i % 3 === 0 ? STONE_DK : STONE, offset: { x, y: 0.18, z } }));
      if (i % 4 === 0) geos.push(box({ w: 0.62, h: 0.1, d: 0.62, color: MOSS, offset: { x, y: 0.48, z } }));
    }
    const wall = 18;
    for (let i = 0; i < wall; i++) {
      const a = i / wall * Math.PI * 2, x = Math.cos(a) * (R + 0.12), z = Math.sin(a) * (R + 0.12);
      geos.push(box({ w: 1.15, h: D, d: 1.15, color: i % 2 ? "#3a352f" : "#2f2b26", offset: { x, y: -D / 2 - LINING_DROP, z } }));
    }
    for (let i = 0; i < STAIR_STEPS; i++) {
      const t = i / (STAIR_STEPS - 1), a = t * STAIR_TURNS * Math.PI * 2;
      const rad = (R - 0.75) * (1 - STAIR_INNER * t * 0.35);
      const y = -0.35 - t * (D - 1.1);
      geos.push(box({ w: 1.65, h: 0.26, d: 1.15, color: i % 2 ? "#6a635a" : "#7a736a", offset: { x: Math.cos(a) * rad, y, z: Math.sin(a) * rad } }));
      if (i % 3 === 0) geos.push(box({ w: 0.3, h: 0.9, d: 0.3, color: "#4b463f", offset: { x: Math.cos(a) * rad, y: y - 0.55, z: Math.sin(a) * rad } }));
    }
    geos.push(lathe({ profile: [[R - 0.1, -D + 0.1], [0, -D + 0.1]], segments: 16, color: "#332f2a" }));
    return merge(...geos);
  };
  // Turns a part about y so its +x points along angle a (x to cos a, z to sin a), in place.
  const aim = (geo, a) => turnedY(geo, -a);
  // Drawn in the cartoon way: the kerb a ring of rounded stones shouldered together under moss cushions, the
  // treads bevelled slabs turned to the shaft's centre on chunky newels, and the torches bevelled posts.
  const KERB = [STONE_DK, STONE, "#7c7b74"].map(mono);
  const stairwell = cached(() => {
    const R = SITE.shaftR, D = SITE.shaftDepth, rand = mulberry32(4801), geo = { verts: [], faces: [], lines: [], smooth: true, normals: [] };
    const kerb = 18;
    for (let i = 0; i < kerb; i++) {
      const a = (i + (rand() - 0.5) * 0.2) / kerb * Math.PI * 2, x = Math.cos(a) * (R + 0.3), z = Math.sin(a) * (R + 0.3), s = 0.9 + rand() * 0.25;
      puff(geo, x, 0.12, z, 0.52 * s, 0.34 * s, 0.52 * s, KERB[i % 3], rand, 4, 8);
      if (i % 4 === 0) puff(geo, x, 0.12 + 0.3 * s, z, 0.36 * s, 0.1, 0.36 * s, MOSS_TONES, rand, 3, 8);
    }
    // Shaft lining, dark and windowless, so the hole reads as depth rather than a gap in the island.
    // It hangs below the rim rather than reaching it: the islet's own top face is at y = 0, and a
    // lining that ends there puts a whole ring of faces exactly flush with the ground, which sparkles
    // from every angle as the camera turns. LINING_DROP is the gap that keeps them apart; the kerb and
    // the islet's own wall cover the band it leaves.
    const wall = 18;
    for (let i = 0; i < wall; i++) {
      const a = i / wall * Math.PI * 2, x = Math.cos(a) * (R + 0.12), z = Math.sin(a) * (R + 0.12);
      flatInto(geo, box({ w: 1.15, h: D, d: 1.15, color: i % 2 ? "#3a352f" : "#2f2b26", offset: { x, y: -D / 2 - LINING_DROP, z } }));
    }
    // The flight itself, turning down the inside of the shaft to a landing at the bottom.
    for (let i = 0; i < STAIR_STEPS; i++) {
      const t = i / (STAIR_STEPS - 1), a = t * STAIR_TURNS * Math.PI * 2;
      const rad = (R - 0.75) * (1 - STAIR_INNER * t * 0.35);
      const y = -0.35 - t * (D - 1.1);
      flatInto(geo, aim(bevelBox({ w: 1.65, h: 0.3, d: 1.1, color: i % 2 ? "#6a635a" : "#7a736a", bevel: 0.07, offset: { x: rad, y } }), a));
      // A stub of newel under every few treads, so the flight has something to stand on.
      if (i % 3 === 0) flatInto(geo, aim(bevelBox({ w: 0.4, h: 0.9, d: 0.4, color: "#4b463f", offset: { x: rad, y: y - 0.58 } }), a));
    }
    flatInto(geo, lathe({ profile: [[R - 0.1, -D + 0.1], [0, -D + 0.1]], segments: 16, color: "#332f2a" }));
    // Two torches down the wall: the only light in the hole, and the cue that it goes somewhere.
    for (const [a, y] of [[0.9, -1.6], [3.7, -4.6]]) {
      flatInto(geo, aim(merge(
        bevelBox({ w: 0.24, h: 0.7, d: 0.24, color: BARK, offset: { x: R - 0.35, y } }),
        bevelBox({ w: 0.36, h: 0.12, d: 0.36, color: "#3b2a1c", offset: { x: R - 0.35, y: y + 0.36 } }),
        bevelBox({ w: 0.3, h: 0.3, d: 0.3, color: "#ff9a2a", emissive: 1, bevel: 0.06, offset: { x: R - 0.35, y: y + 0.55 } })
      ), a));
    }
    geo.normals = Float32Array.from(geo.normals);
    geo.collisionGeometry = stairwellShell();
    return geo;
  });
  const caveSign = cached(() => BL.hubModels.postSign("The Mempool", 0.8, 0.3));
  // A torch in two pieces, so a station can stretch its stem without stretching its flame.
  const TORCH_STEM_H = 1.6;
  const torchStem = cached(() => box({ w: 0.2, h: TORCH_STEM_H, d: 0.2, color: BARK, offset: { y: TORCH_STEM_H / 2 } }));
  const torchFlame = cached(() => box({ w: 0.3, h: 0.3, d: 0.3, color: "#ff9a2a", emissive: 1, offset: { y: 0.15 } }));
  // Iron plates on a frame's corners, each held by two rivets, as the cave signs wear them: `x` and `y` are the
  // corner centres' offsets from (0, cy), `z` the frame's front face.
  const IRON = "#3b3d42", RIVET = "#8a8f98";
  // The cave signs' warm plank tones, so the island's boards read as the same carpentry.
  const SIGN_WOOD = ["#b27a43", "#c08a50", "#a86f3b"], SIGN_POST = "#6b4524";
  const ironCorners = (x, cy, y, z, size) => {
    const out = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const px = sx * x, py = cy + sy * y;
      out.push(bevelBox({ w: size, h: size * 0.92, d: 0.05, color: IRON, bevel: 0.015, offset: { x: px, y: py, z: z + 0.02 } }));
      for (const dx of [-0.3, 0.3]) out.push(box({ w: size * 0.19, h: size * 0.19, d: 0.03, color: RIVET, offset: { x: px + dx * size, y: py - sy * size * 0.12, z: z + 0.055 } }));
    }
    return out;
  };
  // A hanging-lamp cap and base around an emissive core, standing on `y`.
  const lampOn = (y, size) => [
    bevelBox({ w: size * 1.2, h: size * 0.25, d: size * 1.2, color: "#3b2a1c", offset: { y: y + size * 0.12 } }),
    bevelBox({ w: size, h: size, d: size, color: "#ffb347", emissive: 1, bevel: size * 0.2, offset: { y: y + size * 0.72 } }),
    bevelBox({ w: size * 1.2, h: size * 0.22, d: size * 1.2, color: "#3b2a1c", offset: { y: y + size * 1.32 } })
  ];
  // A small standing board across the hole from the bridge, carrying the chain's headline numbers so a
  // visitor reads them without going down. The face looks along +z, which is the way `carve` and
  // `panelFrom` cut, so placing it with `rotation.y = 0` on the far side turns it back at the crossing.
  // `y` is the board's bottom edge, so it is also how much post shows under it: a board this size
  // wants short legs, not stilts.
  const CHAIN_BOARD = { w: 6.8, h: 3, y: 1, d: 0.3, px: 0.06 };
  // Framed like the cave signs: stout legs, thick bevelled rails with ragged ends standing proud of the slate,
  // bevelled stiles, iron plates riveted over the corners and a lamp on the top rail.
  const chainBoard = cached(() => {
    const B = CHAIN_BOARD, top = B.y + B.h;
    return merge(
      ...[-1, 1].map((side) => bevelBox({ w: 0.5, h: B.y + 0.4, d: 0.5, color: SIGN_POST, offset: { x: side * (B.w / 2 - 0.3), y: (B.y + 0.4) / 2 } })),
      box({ w: B.w, h: B.h, d: B.d, color: "#2a2724", offset: { y: B.y + B.h / 2 } }),
      bevelBox({ w: B.w + 0.57, h: 0.4, d: 0.52, color: SIGN_WOOD[1], bevel: 0.08, offset: { x: 0.04, y: top + 0.12 } }),
      bevelBox({ w: B.w + 0.44, h: 0.36, d: 0.52, color: SIGN_WOOD[2], bevel: 0.08, offset: { x: -0.05, y: B.y - 0.1 } }),
      ...[-1, 1].map((side) => bevelBox({ w: 0.34, h: B.h, d: 0.48, color: SIGN_WOOD[0], bevel: 0.07, offset: { x: side * (B.w / 2 - 0.1), y: B.y + B.h / 2 } })),
      ...ironCorners(B.w / 2 - 0.1, B.y + B.h / 2, B.h / 2 + 0.05, 0.26, 0.36),
      ...lampOn(top + 0.32, 0.3)
    );
  });
  // A small post beside the big board, carrying a question mark: the weather key is behind it.
  const INFO_SIGN = { w: 1.1, h: 1.1, y: 1.1, d: 0.26 };
  const infoSign = cached(() => {
    const I = INFO_SIGN, glyph = BL.hubModels.SIGN_GLYPHS["?"], cell = 0.16, runs = [];
    // The question mark in cream, cut as solid horizontal runs of whole cells like the cave signs' letters.
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row].length; col++) {
        if (glyph[row][col] !== "1") continue;
        let n = 1;
        while (glyph[row][col + n] === "1") n++;
        runs.push(box({ w: cell * n, h: cell, d: 0.07, color: "#f6ecd2", emissive: 0.35, offset: { x: (col - 1 + (n - 1) / 2) * cell, y: I.y + I.h * 0.5 + (2 - row) * cell, z: I.d / 2 } }));
        col += n - 1;
      }
    }
    return merge(
      bevelBox({ w: 0.36, h: I.y, d: 0.36, color: SIGN_POST, offset: { y: I.y / 2 } }),
      box({ w: I.w, h: I.h, d: I.d, color: "#3a3430", offset: { y: I.y + I.h / 2 } }),
      bevelBox({ w: I.w + 0.36, h: 0.26, d: I.d + 0.18, color: SIGN_WOOD[1], bevel: 0.06, offset: { x: 0.03, y: I.y + I.h + 0.07 } }),
      bevelBox({ w: I.w + 0.28, h: 0.24, d: I.d + 0.18, color: SIGN_WOOD[2], bevel: 0.06, offset: { x: -0.03, y: I.y - 0.06 } }),
      ...[-1, 1].map((side) => bevelBox({ w: 0.22, h: I.h, d: I.d + 0.14, color: SIGN_WOOD[0], bevel: 0.05, offset: { x: side * (I.w / 2 + 0.02), y: I.y + I.h / 2 } })),
      ...ironCorners(I.w / 2 + 0.02, I.y + I.h / 2, I.h / 2 + 0.05, I.d / 2 + 0.07, 0.2),
      ...runs
    );
  });
  const torchPost = cached(() => merge(
    bevelBox({ w: 0.24, h: TORCH_STEM_H, d: 0.24, color: BARK, offset: { y: TORCH_STEM_H / 2 } }),
    bevelBox({ w: 0.36, h: 0.12, d: 0.36, color: "#3b2a1c", offset: { y: TORCH_STEM_H + 0.02 } }),
    bevelBox({ w: 0.3, h: 0.3, d: 0.3, color: "#ff9a2a", emissive: 1, bevel: 0.06, offset: { y: 1.75 } })
  ));

  // The hall's section, as fractions of caveR and caveH: straight to head height so the wall reads
  // as a wall, then three courses doming in. The camera clamp and the geometry share it, so nothing
  // the visitor can reach is ever inside the stone.
  const WALL = [[1, 0], [1, 0.7], [0.85, 0.875], [0.45, 1.025], [0, 1.1]];
  // The wall's radius at a height, and the ceiling's height at a radius: the same curve read both ways.
  const wallRadiusAt = (y) => {
    const R = SITE.caveR, k = y / SITE.caveH;
    if (k <= WALL[1][1]) return R;
    for (let i = 1; i < WALL.length - 1; i++) {
      const a = WALL[i], b = WALL[i + 1];
      if (k > b[1]) continue;
      return R * lerp(a[0], b[0], (k - a[1]) / (b[1] - a[1]));
    }
    return 0;
  };
  const ceilingHeightAt = (r) => {
    const R = SITE.caveR, H = SITE.caveH;
    if (r >= R) return WALL[1][1] * H;
    for (let i = 1; i < WALL.length - 1; i++) {
      const a = WALL[i], b = WALL[i + 1];
      if (r <= b[0] * R || r > a[0] * R) continue;
      return lerp(a[1], b[1], (a[0] * R - r) / ((a[0] - b[0]) * R)) * H;
    }
    return WALL[WALL.length - 1][1] * H;
  };

  // The interior: a round stone hall at walking scale. A banded floor, a wall that stands straight to
  // head height before it domes, a course of fallen boulders round its foot, and stalactites over the
  // middle, so the room reads as rock in every direction instead of going black past the firelight.
  const room = cached(() => {
    const R = SITE.caveR, H = SITE.caveH, geos = [], rand = mulberry32(9301);
    // Rings run outward-in and the wall top-down: that winding is what turns both their normals into
    // the room, so the floor takes the firelight and the wall is lit from the inside it faces.
    // Four concentric courses against forty wedges reads as laid stone; one ring of wedges alone
    // reads as a starburst from the fire.
    const FLOOR = ["#524c45", "#494339", "#5a544c", "#4e4941"];
    geos.push(latheBy({
      profile: [[R, 0], [R * 0.76, 0], [R * 0.52, 0], [R * 0.28, 0], [0, 0]], segments: 40,
      color: (t, s) => FLOOR[(Math.round(t * 4) + s) % 4]
    }));
    geos.push(latheBy({
      profile: WALL.map(([r, k]) => [r * R, k * H]).reverse(), segments: 40,
      color: (t, s) => t < 0.5 ? (s % 2 ? "#3f3a35" : "#464038") : (s % 2 ? "#4d4842" : STONE_DK)
    }));
    // The skirting course: rubble that has come off the wall and settled against its foot.
    for (let i = 0; i < 36; i++) {
      const a = (i + rand() * 0.7) / 36 * Math.PI * 2, r = R - 0.5 - rand() * 0.5, s = 0.7 + rand() * 0.85;
      geos.push(box({ w: s, h: s * 0.7, d: s, color: i % 5 === 0 ? MOSS : i % 2 ? STONE : STONE_DK, offset: { x: Math.cos(a) * r, y: s * 0.3, z: Math.sin(a) * r } }));
    }
    // Stalactites in the island's own blocky idiom: three courses tapering to a point.
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * (R - 2.4);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const top = ceilingHeightAt(r), len = 0.8 + rand() * 1.9, s = 0.75 + rand() * 0.6;
      const color = i % 3 === 0 ? "#565049" : i % 3 === 1 ? "#4a453f" : "#514b44";
      geos.push(
        box({ w: 0.6 * s, h: len * 0.42, d: 0.6 * s, color, offset: { x, y: top - len * 0.21, z } }),
        box({ w: 0.36 * s, h: len * 0.36, d: 0.36 * s, color, offset: { x, y: top - len * 0.6, z } }),
        box({ w: 0.16 * s, h: len * 0.22, d: 0.16 * s, color, offset: { x, y: top - len * 0.89, z } })
      );
    }
    return merge(...geos);
  });

  // Where the stairwell lands: a flight coming down out of the wall under a lintel and a lantern, so
  // the hall has a visible way in and out. Built facing local +z, which `bearing + PI` turns inward.
  const stairFoot = cached(() => {
    const geos = [];
    for (let i = 0; i < 6; i++) {
      geos.push(box({ w: 3.4, h: 0.26, d: 0.95, color: i % 2 ? "#6a635a" : "#7a736a", offset: { y: 0.13 + i * 0.26, z: -0.5 - i * 0.95 } }));
    }
    // A dark mouth behind the top step, so the way up reads as a way up rather than a dead end.
    geos.push(box({ w: 3.5, h: 2.6, d: 0.3, color: "#221f1c", offset: { y: 2.75, z: -6.4 } }));
    for (const side of [-1, 1]) geos.push(box({ w: 0.36, h: 3.1, d: 0.5, color: STONE_DK, offset: { x: side * 2.05, y: 3.05, z: -6.1 } }));
    geos.push(box({ w: 4.8, h: 0.42, d: 0.6, color: STONE, offset: { y: 4.8, z: -6.1 } }));
    geos.push(box({ w: 0.34, h: 0.34, d: 0.34, color: "#ff9a2a", emissive: 1, offset: { y: 4.4, z: -5.7 } }));
    return merge(...geos);
  });
  // The fire in the middle of the hall: a ring of stones, three logs across it and a layered flame,
  // built at the size the room wants so nothing has to be stretched into place.
  const FIRE_FLAME = [
    [1.5, 1.1, 0.75, 0, 0, "#ff8a1e"], [1.1, 0.85, 1.55, 0.1, -0.08, "#ffc148"],
    [0.82, 0.7, 2.1, 0.22, 0.12, "#ffc148"], [0.58, 0.5, 2.6, 0.1, 0.2, "#fff0b0"],
    [0.4, 0.4, 3, -0.06, 0.08, "#fff0b0"], [0.6, 0.62, 1.3, -0.72, 0.16, "#ffc148"],
    [0.5, 0.54, 1.75, 0.76, 0.42, "#ff8a1e"]
  ];
  const brazier = cached(() => {
    const rand = mulberry32(2207), geos = [box({ w: 3.4, h: 0.12, d: 3.4, color: "#2a2522", offset: { y: 0.06 } })];
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2 + (rand() - 0.5) * 0.3, h = 0.55 + rand() * 0.35, r = 1.85;
      geos.push(box({ w: 0.8 + rand() * 0.3, h, d: 0.7 + rand() * 0.3, color: i % 3 === 0 ? STONE_DK : i % 3 === 1 ? STONE : "#645e56", offset: { x: Math.cos(a) * r, y: h * 0.5, z: Math.sin(a) * r } }));
    }
    geos.push(
      box({ w: 2.6, h: 0.34, d: 0.34, color: BARK, offset: { y: 0.3, z: -0.32 } }),
      box({ w: 0.34, h: 0.34, d: 2.6, color: BARK_LT, offset: { x: 0.32, y: 0.5 } }),
      box({ w: 2.6, h: 0.34, d: 0.34, color: BARK, offset: { y: 0.7, z: 0.32 } })
    );
    return merge(...geos, noShadow(merge(...FIRE_FLAME.map(([w, h, y, x, z, color]) => box({ w, h, d: w, color, emissive: 1, offset: { x, y, z } })))));
  });

  // A hewn face for a station's readables: one border shared by the tall faces that carry a panel and
  // the plaque that carries only a headline, so all four stations read as the same fitting.
  const facePlate = (w, h) => merge(
    box({ w, h, d: 0.28, color: "#332f2b" }),
    box({ w: w + 0.34, h: 0.28, d: 0.44, color: "#736c62", offset: { y: -h / 2 - 0.12 } }),
    box({ w: w + 0.34, h: 0.24, d: 0.44, color: "#736c62", offset: { y: h / 2 + 0.1 } }),
    ...[-1, 1].map((side) => box({ w: 0.26, h: h + 0.5, d: 0.4, color: "#6a645b", offset: { x: side * (w / 2 + 0.05) } }))
  );
  const FACE_W = 5.2, FACE_Z = 0.14;
  const stationFace = cached(() => facePlate(FACE_W, 5));
  const stationPlaque = cached(() => facePlate(FACE_W, 1));

  // A standing slab that carries carved text. Sizes are in glyph cells so the carver can fill it.
  // The chain's own tablet: the station face again, wider and standing on a plinth of its own.
  const tabletSlab = cached(() => merge(
    box({ w: 6.9, h: 0.36, d: 0.72, color: STONE_DK, offset: { y: 0.18 } }),
    box({ w: 6, h: 5, d: 0.3, color: "#332f2b", offset: { y: 2.95 } }),
    box({ w: 6.34, h: 0.26, d: 0.44, color: "#736c62", offset: { y: 0.52 } }),
    box({ w: 6.34, h: 0.24, d: 0.44, color: "#736c62", offset: { y: 5.55 } }),
    ...[-1, 1].map((side) => box({ w: 0.26, h: 5.4, d: 0.4, color: "#6a645b", offset: { x: side * 3.05, y: 2.95 } }))
  ));

  // Carved headline type: the island's own blocky sign glyphs, cut proud of a slab's face.
  const CARVE_Z = 0.16;
  const carve = (text, { cell = 0.14, color = GOLD, emissive = 0.55 } = {}) => {
    const glyphs = BL.hubModels.SIGN_GLYPHS, geos = [];
    let cursor = 0;
    for (const ch of String(text).toUpperCase()) {
      if (ch === " ") { cursor += 2.4; continue; }
      const glyph = glyphs[ch];
      if (!glyph) { cursor += 4; continue; }
      for (let row = 0; row < glyph.length; row++) {
        for (let col = 0; col < glyph[row].length; col++) {
          if (glyph[row][col] !== "1") continue;
          geos.push(box({ w: cell, h: cell, d: 0.08, color, emissive, offset: { x: (cursor + col) * cell, y: -(row * cell), z: CARVE_Z } }));
        }
      }
      cursor += 4;
    }
    return { geometry: geos.length ? merge(...geos) : null, width: cursor * cell };
  };
  // How wide a carving comes out, in cells, so a caller can pick the cell that fills its slab and no
  // reading can ever run off the stone however many digits the chain hands it.
  const carveCells = (text) => {
    let cursor = 0;
    for (const ch of String(text)) cursor += ch === " " ? 2.4 : 4;
    return cursor;
  };

  // A dense wall panel: the jumbotron's 5x7 font rendered into a canvas, then run-length merged into
  // quads exactly as the big board does, so a wall of numbers is a few hundred faces and no texture.
  const panelFrom = (ctx, w, h, px, py, background) => {
    const geo = { verts: [], faces: [], lines: [] };
    const data = ctx.getImageData(0, 0, w, h).data;
    const bg = background;
    const push = (x0, x1, y0, y1, color) => {
      const base = geo.verts.length / 3;
      geo.verts.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0);
      geo.faces.push({ i: [base, base + 1, base + 2, base + 3], color, emissive: 0.85 });
    };
    for (let y = 0; y < h; y++) {
      const wy0 = (h - y - 1) * py, wy1 = (h - y) * py, row = y * w;
      let x = 0;
      while (x < w) {
        const i = (row + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
        if (r === bg[0] && g === bg[1] && b === bg[2]) { x++; continue; }
        let run = x + 1;
        while (run < w) {
          const j = (row + run) * 4;
          if (data[j] !== r || data[j + 1] !== g || data[j + 2] !== b) break;
          run++;
        }
        push(x * px, run * px, wy0, wy1, [r, g, b]);
        x = run;
      }
    }
    geo.castShadow = false;
    return geo;
  };

  // The island as one group: ground, bridge, cave mouth, sign and two torches. Scatter is the hub's.
  const build = (place) => {
    const node = createNode({ position: { x: place.x, y: place.y, z: place.z }, rotation: { x: 0, y: place.ry, z: 0 } });
    const groundNode = createNode({ geometry: islet() });
    const bridgeNode = createNode({ position: { x: 0, y: 0, z: place.bridgeLocalZ }, geometry: bridge() });
    // The way down is a stairwell through the middle of the island, not a door in its side.
    const stairNode = createNode({ geometry: stairwell() });
    const signNode = createNode({ position: { x: 0, y: 0, z: SITE.shaftR + 2.1 }, geometry: caveSign() });
    // Lit like every hub torch, so the Matrix treats their flames as fire rather than as stone.
    const torches = [-1, 1].map((side) => createNode({ position: { x: side * (SITE.shaftR + 1.5), y: 0, z: SITE.shaftR * 0.7 }, geometry: torchPost(), matrixEmissiveLiving: true }));
    const pondNode = createNode({ position: { x: 6.4, y: 0, z: -4.6 }, geometry: pond() });
    addChild(node, groundNode, bridgeNode, stairNode, signNode, pondNode, ...torches);
    return { node, ground: groundNode, bridge: bridgeNode, stair: stairNode, sign: signNode, pond: pondNode, torches };
  };

  BL.poolModels = {
    SITE, UNIT, BEARING, DIR, spot, build, latheBy, stairwell, islet, bridge, caveSign, torchPost, torchStem, torchFlame,
    TORCH_STEM_H, room, stairFoot, wallRadiusAt, ceilingHeightAt, brazier,
    stationFace, stationPlaque, FACE_W, FACE_Z,
    tabletSlab, carve, carveCells, panelFrom, chainBoard, CHAIN_BOARD, infoSign, INFO_SIGN, CANOPY, fern, shrub, mossRock, pond, deckY, STAIR_STEPS,
    beastRig, flowers, log,
    COLORS: { LEAF, LEAF_DK, LEAF_LT, BARK, BARK_LT, STONE, STONE_DK, MOSS, WET, GOLD }
  };
})();
