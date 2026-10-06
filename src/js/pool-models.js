// The Mempool island: a floating rainforest off the island's east rim, joined by a vine bridge, with a lake at its
// heart and a chamber under the lake. Geometry only: `pool-layout.js` is the one authority for where everything
// is, the hub places the island and its scatter, and `pool-water.js` moves the water.
//
// Everything here is cached per shape and shared by every copy, so a hundred ferns are one draw call.
//
// The island is built in a local frame whose +z points back at the home island, which `rotation.y = -bearing`
// maps inward, as the terrain turns its own mouths. `islet` meshes the layout's voxel body with the home island's
// own mesher, so its terraces, cliffs, tunnels and chamber are one closed shell that is drawn, walked on and cut
// away as the home island is; the same grid is its `cutawaySource`. The descent's and the ledge's floors are
// smooth sheets laid over the voxel steps (`rampFloor`), the lake's underside is `membrane` (translucent water,
// walked on as a thin closed shell so nothing falls through it into the chamber), `crossing` is the plank bridge
// that carries the ring path over a channel, and `nestBed` is a clearing's banana-leaf beds.
//
// `carve` cuts headline type from `hubModels.SIGN_GLYPHS` and `panelFrom` merges a canvas of the jumbotron's 5x7
// font into bounded quads, which is how the chamber's wall paintings are set. `chainBoard`/`CHAIN_BOARD`
// is the curved stats board on the lake's far shore, whose panel follows the same arc, and `infoSign` the
// weather key beside it. The plants, rocks, animals and bridge are cartoon geometry from the hub's kit (`leafy`,
// `puff`, `limb`, `flatInto`), one cached build each shared by every copy; the solid ones keep their first block
// build as `collisionGeometry`. `spot` finds the rim and `build` returns the placed group.
// Set `lineWidth` on a merged geometry, not on the polylines going into it: `merge` does not carry it.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, math } = BL;
  const { createNode, addChild } = BL.scene;
  const { cached, box, bevelBox, lathe, merge, polyline, makeVox, voxelGeometry, noShadow, pushVert, face, turnedY } = models;
  const { mulberry32, lerp, hexToRgb } = math;
  const { puff, leafy, canopySupport, pointedLeaf, flower, FLOWER_INKS, limb, padNormals, flatInto, rock, garland, sprig } = BL.hubModels;
  const L = BL.poolLayout;

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
  // `isletR` is the nominal top radius the bridge and the hub's circles are set out from; `reach` takes in the ledge.
  const SITE = { approachFrom: APPROACH.from, span: 17, sag: 0.5, width: L.BRIDGE.width, deckStart: L.BRIDGE.deckStart, isletR: L.R, isletDepth: -L.ORIGIN.y, reach: L.R + L.LEDGE.width + 1.6, bearing: BEARING, dir: DIR };
  const UNIT = L.UNIT;

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
    const radius = r + SITE.span + L.BRIDGE.z;
    out.radius = radius;
    out.x = DIR.x * radius;
    out.z = DIR.z * radius;
    out.ry = -SITE.bearing;
    // How far out along local +z the bridge starts, so its far end lands on the rim head.
    out.bridgeLocalZ = radius - r - SITE.span;
    return out;
  };

  // The island's body: the layout's grid through the home island's greedy mesher, welded as the home island is.
  // The same grid is the cutaway's material source, so a cut through the rock is capped in its own stone.
  const islet = cached(() => {
    const grid = L.body(), palette = L.PALETTE.map((hex) => hex && hexToRgb(hex));
    const geometry = BL.terrain.gridGeometry(grid, { unit: L.UNIT, palette, origin: L.ORIGIN });
    // Centre-sampled shore voxels leave inward corners across the circular lake. Bevel just those
    // corners out of the water; the same mesh is used for collision. A small chord allowance keeps
    // the straight edges between bevelled vertices outside the circle too.
    const rim = Math.hypot(L.LAKE_R, L.UNIT), underside = L.roofUnder(L.LAKE_R);
    // Split affected greedy quads at cell boundaries first: otherwise a long edge can bridge across
    // its neighbour's bevelled corner and leave a crack at the old T-junction.
    const shoreFaces = [];
    for (const f of geometry.faces) {
      const v = geometry.verts, ids = f.i;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
      for (const id of ids) {
        minX = Math.min(minX, v[id * 3]); maxX = Math.max(maxX, v[id * 3]);
        minZ = Math.min(minZ, v[id * 3 + 2]); maxZ = Math.max(maxZ, v[id * 3 + 2]);
        maxY = Math.max(maxY, v[id * 3 + 1]);
      }
      const nearX = Math.max(0, minX, -maxX), nearZ = Math.max(0, minZ, -maxZ);
      let mouth = false;
      for (const channel of L.CHANNELS) {
        const ux = Math.sin(channel.bearing), uz = Math.cos(channel.bearing), half = L.CHANNEL.low + 2 * L.UNIT;
        const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2, rx = (maxX - minX) / 2, rz = (maxZ - minZ) / 2;
        if (x * ux + z * uz + Math.abs(ux) * rx + Math.abs(uz) * rz >= L.channelOutlet(channel) - (channel.inner ? 2 * L.UNIT : 0) &&
          Math.abs(x * uz - z * ux) <= half + Math.abs(uz) * rx + Math.abs(ux) * rz) { mouth = true; break; }
      }
      if (!mouth && (maxY < underside || Math.hypot(nearX, nearZ) >= L.LAKE_R)) { shoreFaces.push(f); continue; }
      const a = ids[0] * 3, b = ids[1] * 3, d = ids[3] * 3;
      const nx = Math.round(Math.hypot(v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]) / L.UNIT);
      const nz = Math.round(Math.hypot(v[d] - v[a], v[d + 1] - v[a + 1], v[d + 2] - v[a + 2]) / L.UNIT);
      const at = (u, w) => pushVert(geometry, v[a] + (v[b] - v[a]) * u + (v[d] - v[a]) * w,
        v[a + 1] + (v[b + 1] - v[a + 1]) * u + (v[d + 1] - v[a + 1]) * w,
        v[a + 2] + (v[b + 2] - v[a + 2]) * u + (v[d + 2] - v[a + 2]) * w);
      for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) {
        shoreFaces.push({ ...f, i: [at(x / nx, z / nz), at((x + 1) / nx, z / nz), at((x + 1) / nx, (z + 1) / nz), at(x / nx, (z + 1) / nz)] });
      }
    }
    geometry.faces = shoreFaces;
    for (let i = 0; i < geometry.verts.length; i += 3) {
      if (geometry.verts[i + 1] < underside) continue;
      const x = geometry.verts[i], z = geometry.verts[i + 2], r = Math.hypot(x, z);
      if (r > 0 && r < L.LAKE_R) {
        geometry.verts[i] = x * rim / r;
        geometry.verts[i + 2] = z * rim / r;
      }
    }
    // Flatten the narrow mouth into the cliff so the stream and vertical sheet meet on the rock face.
    // The outer half-metre blends back into the voxel cliff; cell-sized faces keep the cut watertight.
    for (const channel of L.CHANNELS) {
      const ux = Math.sin(channel.bearing), uz = Math.cos(channel.bearing), end = L.channelOutlet(channel);
      for (let i = 0; i < geometry.verts.length; i += 3) {
        const x = geometry.verts[i], z = geometry.verts[i + 2], along = x * ux + z * uz;
        const across = Math.abs(x * uz - z * ux), blend = Math.min(1, (L.CHANNEL.low + 2 * L.UNIT - across) / L.UNIT);
        if (blend <= 0) continue;
        if (channel.inner) {
          const y = geometry.verts[i + 1];
          if (along < end - L.UNIT || along > end + L.UNIT || y < channel.floor || y > L.LEVEL.bed) continue;
          // Bevel the voxel corners onto the existing wall, without building a projecting spout.
          const shift = (end - along) * blend;
          geometry.verts[i] += ux * shift; geometry.verts[i + 2] += uz * shift;
        } else {
          if (along <= end) continue;
          const cut = (along - end) * blend;
          geometry.verts[i] -= ux * cut; geometry.verts[i + 2] -= uz * cut;
        }
      }
    }
    BL.terrain.compactVertices(geometry);
    geometry.cutawaySource = { data: grid.data, sx: grid.sx, sy: grid.sy, sz: grid.sz, unit: L.UNIT, origin: L.ORIGIN, palette };
    return geometry;
  });
  // The smooth floors: the descent from its mouth to the chamber, the ledge beside it down the outside of the
  // cliff, and the two doors between them, each a strip of quads at the layout's own grade laid just over the
  // voxel steps, which are cut at or under it. Their edges are buried in the walls; the ledge's outer edge and
  // its end wear a skirt down to the step below, so the sheet never shows from the side as a floating plane.
  const EARTH = ["#6a5238", "#624b33"].map(hexToRgb), LEDGE_TONES = ["#7a6a52", "#6f6048"].map(hexToRgb), SKIRT = hexToRgb("#54544f");
  const rampFloor = cached(() => {
    const geo = { verts: [], faces: [], lines: [] }, RAMP = L.RAMP, STEP = 1 / RAMP.r;
    const at = (bearing, r, y) => pushVert(geo, Math.sin(bearing) * r, y, Math.cos(bearing) * r);
    const SHEET = { emissive: 0 };
    // Slightly overlap the one-metre waterfall so no daylight seam shows at either bank.
    // Its voxel support still needs the wider corner allowance from the layout.
    const fallMouthHalf = 0.49;
    const quad = (b0, b1, r0, r1, y0, y1, color) => face(geo, [at(b0, r0, y0), at(b0, r1, y0), at(b1, r1, y1), at(b1, r0, y1)], color, SHEET);
    const floorEdge = (bearing, edge) => {
      for (const channel of L.CHANNELS) {
        if (channel.inner) continue;
        const angle = L.turn(bearing, channel.bearing);
        if (Math.abs(angle) * edge < fallMouthHalf) edge = Math.min(edge, (L.channelOutlet(channel) - 0.05) / Math.cos(angle));
      }
      return edge;
    };
    const fallCuts = [];
    for (const channel of L.CHANNELS) if (channel.falls) {
      const width = fallMouthHalf;
      let left = channel.bearing - width / L.edgeAt(channel.bearing);
      let right = channel.bearing + width / L.edgeAt(channel.bearing);
      for (let i = 0; i < 4; i++) {
        left = channel.bearing - width / L.edgeAt(left);
        right = channel.bearing + width / L.edgeAt(right);
      }
      fallCuts.push({ left, right, channel });
    }
    const cutInnerEdge = (bearing, inner) => {
      for (const cut of fallCuts) {
        if (Math.abs(bearing - cut.left) < 1e-6 || Math.abs(bearing - cut.right) < 1e-6)
          return Math.min(inner, L.channelOutlet(cut.channel) - 0.25);
      }
      return inner;
    };
    const drySpans = (from, to, draw) => {
      let start = from;
      for (const cut of fallCuts) {
        if (cut.right <= start || cut.left >= to) continue;
        if (cut.left > start + 1e-6) draw(start, Math.min(cut.left, to));
        start = Math.max(start, cut.right);
        if (start >= to - 1e-6) return;
      }
      if (start < to - 1e-6) draw(start, to);
    };
    // Close exposed ends of the smooth outer shelves into their voxel backing, including fall gaps
    // and both sides of a gallery lip's change in width. Match the shallow outer skirt.
    const capEnd = (bearing, inner, outer, y, end) => {
      if (outer <= inner + 1e-6) return;
      const bottom = y - 0.62;
      const ids = [at(bearing, inner, y), at(bearing, inner, bottom),
        at(bearing, outer, bottom), at(bearing, outer, y)];
      if (end) ids.reverse();
      face(geo, ids, SKIRT, SHEET);
      face(geo, [...ids].reverse(), SKIRT, SHEET);
    };
    const shelfJoin = (previous, b0, b1, inner0, inner1, outer0, outer1, y0, y1) => {
      if (!previous || Math.abs(previous.b - b0) > 1e-6) {
        if (previous) capEnd(previous.b, previous.inner, previous.outer, previous.y, true);
        capEnd(b0, inner0, outer0, y0, false);
      } else if (previous.outer > outer0) capEnd(b0, outer0, previous.outer, y0, true);
      else capEnd(b0, previous.outer, outer0, y0, false);
      if (previous && Math.abs(previous.b - b0) <= 1e-6) {
        if (previous.inner < inner0) capEnd(b0, previous.inner, inner0, y0, true);
        else capEnd(b0, inner0, previous.inner, y0, false);
      }
      return { b: b1, inner: inner1, outer: outer1, y: y1 };
    };
    let galleryEnd = null, ledgeEnd = null;
    const reach = RAMP.bay + 0.3;
    for (let n = 0; n < L.RILL_STATIONS.length - 1; n++) {
      const a = L.RILL_STATIONS[n], to = L.RILL_STATIONS[n + 1];
      if (a >= L.RILL.end) {
        // The turn's floor patch replaces the inner landing; keep the outer walking lane at its grade.
        quad(RAMP.start + a, RAMP.start + to, L.rillRadius(L.RILL.end) + 0.95, RAMP.r + reach,
          L.rampY(a), L.rampY(to), EARTH[n & 1]);
        continue;
      }
      if (a < L.RILL.start) {
        const stop = Math.min(to, L.RILL.start);
        quad(RAMP.start + a, RAMP.start + stop, RAMP.r - reach, RAMP.r + reach, L.rampY(a), L.rampY(stop), EARTH[n & 1]);
      }
      if (to > L.RILL.start) {
        const from = Math.max(a, L.RILL.start), r0 = L.rillRadius(from), r1 = L.rillRadius(to), y0 = L.rampY(from), y1 = L.rampY(to), G = L.RILL;
        const inner0 = L.rillInner(from) + G.waterHalf, inner1 = L.rillInner(to) + G.waterHalf;
        const strip = (left0, right0, left1, right1, dropL, dropR, color) => face(geo,
          [at(RAMP.start + from, left0, y0 - dropL), at(RAMP.start + from, right0, y0 - dropR),
            at(RAMP.start + to, right1, y1 - dropR), at(RAMP.start + to, left1, y1 - dropL)], color, SHEET);
        strip(RAMP.r - reach, inner0 - G.half, RAMP.r - reach, inner1 - G.half, 0, 0, EARTH[n & 1]);
        strip(inner0 - G.half, inner0 - G.bedHalf, inner1 - G.half, inner1 - G.bedHalf, 0, G.depth, SKIRT);
        strip(inner0 - G.bedHalf, r0 + G.bedHalf, inner1 - G.bedHalf, r1 + G.bedHalf, G.depth, G.depth, SKIRT);
        strip(r0 + G.bedHalf, r0 + G.half, r1 + G.bedHalf, r1 + G.half, G.depth, 0, SKIRT);
        strip(r0 + G.half, RAMP.r + reach, r1 + G.half, RAMP.r + reach, 0, 0, EARTH[n & 1]);
        if (a <= L.RILL.start) face(geo, [at(RAMP.start + from, inner0 - G.half, y0),
          at(RAMP.start + from, inner0 - G.bedHalf, y0 - G.depth), at(RAMP.start + from, r0 + G.bedHalf, y0 - G.depth),
          at(RAMP.start + from, r0 + G.half, y0)], SKIRT, SHEET);
      }
      // Through a door: from the descent's edge out to the ledge.
      for (const door of L.DOORS) if (Math.abs((a + to) / 2 - door.at * RAMP.sweep) * 18 < L.DOOR.half + 0.4) {
        quad(RAMP.start + a, RAMP.start + to, RAMP.r + reach, L.edgeAt(RAMP.start + (a + to) / 2) - 0.25, L.rampY(a), L.rampY(to), EARTH[n & 1]);
      }
      // Through a link: carry the descent's surface out through the mouths and along the gallery. Between
      // galleries only the exterior lip continues, with its inner edge buried in the intact cliff wall.
      const link = L.linkAt((a + to) / 2);
      for (let h = 0; h < 2; h++) {
        const a0 = a + (to - a) * h / 2, a1 = a + (to - a) * (h + 1) / 2, b0 = RAMP.start + a0, b1 = RAMP.start + a1;
        const draw = (start, end) => {
          const lip0 = L.lipAt(start), lip1 = L.lipAt(end);
          if (!link && !lip0 && !lip1) return;
          const edge0 = L.edgeAt(start) + (lip0 ? lip0 - 0.04 : -0.25);
          const edge1 = L.edgeAt(end) + (lip1 ? lip1 - 0.04 : -0.25);
          const r0 = floorEdge(start, edge0), r1 = floorEdge(end, edge1);
          const y0 = L.rampY(start - RAMP.start), y1 = L.rampY(end - RAMP.start);
          const inner0 = link ? RAMP.r + reach : L.edgeAt(start) - 0.3, inner1 = link ? RAMP.r + reach : L.edgeAt(end) - 0.3;
          if (!link && (r0 <= inner0 || r1 <= inner1)) return;
          face(geo, [at(start, inner0, y0), at(start, r0, y0), at(end, r1, y1), at(end, inner1, y1)], LEDGE_TONES[n & 1], SHEET);
          face(geo, [at(start, inner0, y0 - 0.62), at(end, inner1, y1 - 0.62),
            at(end, r1, y1 - 0.62), at(start, r0, y0 - 0.62)], SKIRT, SHEET);
          // The gallery mouth exposes this edge even where the lip has zero width.
          face(geo, [at(start, r0, y0), at(start, r0, y0 - 0.62), at(end, r1, y1 - 0.62), at(end, r1, y1)], SKIRT, SHEET);
          galleryEnd = shelfJoin(galleryEnd, start, end, inner0, inner1, r0, r1, y0, y1);
        };
        if (link) draw(b0, b1);
        else drySpans(b0, b1, draw);
      }
    }
    if (galleryEnd) capEnd(galleryEnd.b, galleryEnd.inner, galleryEnd.outer, galleryEnd.y, true);
    // Rebuild the narrow floor strip over the voxel recess around the bend and chamber.
    // Sample the union of both grooves at their join so neither bank dams the other stream.
    for (const arc of L.RILL_TAIL) {
      if (arc.squeeze) {
        // A flat patch avoids folded offset banks on the tight hairpin's small inner radius.
        const half = arc.r + 0.95, reach = arc.r * arc.squeeze + 0.95;
        const cols = Math.ceil(2 * half / 0.08), rows = Math.ceil(reach / 0.08), ux = Math.sin(arc.start), uz = Math.cos(arc.start);
        const point = (i, j) => {
          const forward = reach * j / rows, outer = L.rillRadius(L.RILL.end) + 0.95;
          const maxRadial = Math.sqrt(outer * outer - forward * forward) - Math.hypot(arc.x, arc.z);
          const radial = -half + (maxRadial + half) * i / cols;
          const x = arc.x + ux * radial + uz * forward, z = arc.z + uz * radial - ux * forward;
          const cut = math.clamp((L.RILL.half - L.rillTailDistance(x, z)) / (L.RILL.half - L.RILL.bedHalf), 0, 1);
          return pushVert(geo, x, L.rillJunctionY(x, z) + 0.008 - L.RILL.depth * cut, z);
        };
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
          face(geo, [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)], EARTH[0], SHEET);
        }
        continue;
      }
      const count = Math.ceil(Math.abs(arc.sweep) * arc.r / 0.2);
      const offsets = [-0.95, -0.4, -L.RILL.half, -L.RILL.bedHalf, 0, L.RILL.bedHalf, L.RILL.half, 0.4, 0.95];
      const bands = offsets.length - 1, scratch = {};
      const point = (i, j) => {
        L.rillTailPoint(arc, arc.start + arc.sweep * i / count, offsets[j], scratch);
        const x = scratch.x, z = scratch.z;
        const cut = math.clamp((L.RILL.half - L.rillTailDistance(x, z)) / (L.RILL.half - L.RILL.bedHalf), 0, 1);
        return pushVert(geo, x, L.FLOOR + 0.008 - L.RILL.depth * cut, z);
      };
      for (let i = 0; i < count; i++) for (let j = 0; j < bands; j++) {
        const ids = [point(i, j), point(i, j + 1), point(i + 1, j + 1), point(i + 1, j)];
        if (arc.sweep < 0) ids.reverse();
        face(geo, ids, Math.abs(j + 0.5 - bands / 2) < 2 ? SKIRT : EARTH[0], SHEET);
      }
    }
    const end = L.LEDGE.to * RAMP.sweep + L.LEDGE.tail, leadSteps = Math.ceil(L.LEDGE.lead / STEP) * 2;
    for (let n = -leadSteps; n * STEP < end - 1e-6; n++) {
      const a = n < 0 ? n * L.LEDGE.lead / leadSteps : n * STEP;
      const to = n < 0 ? (n + 1) * L.LEDGE.lead / leadSteps : Math.min(end, a + STEP);
      drySpans(RAMP.start + a, RAMP.start + to, (b0, b1) => {
        const a0 = b0 - RAMP.start, a1 = b1 - RAMP.start;
        const y0 = L.ledgeY(a0) + 0.008, y1 = L.ledgeY(a1) + 0.008;
        const r0 = L.edgeAt(b0), r1 = L.edgeAt(b1);
        const out0 = Math.max(0, L.ledgeWidth(a0) - 0.04), out1 = Math.max(0, L.ledgeWidth(a1) - 0.04);
        // At a fall the cliff itself is recessed to the outlet. Carry the cut end back
        // into that rock, or the ledge's inner 0.7 m is left uncapped beside the water.
        const inner0 = cutInnerEdge(b0, r0 - 0.3), inner1 = cutInnerEdge(b1, r1 - 0.3);
        face(geo, [at(b0, inner0, y0), at(b0, r0 + out0, y0), at(b1, r1 + out1, y1), at(b1, inner1, y1)], LEDGE_TONES[n & 1], SHEET);
        face(geo, [at(b0, inner0, y0 - 0.62), at(b1, inner1, y1 - 0.62),
          at(b1, r1 + out1, y1 - 0.62), at(b0, r0 + out0, y0 - 0.62)], SKIRT, SHEET);
        face(geo, [at(b0, r0 + out0, y0), at(b0, r0 + out0, y0 - 0.62), at(b1, r1 + out1, y1 - 0.62), at(b1, r1 + out1, y1)], SKIRT, SHEET);
        ledgeEnd = shelfJoin(ledgeEnd, b0, b1, inner0, inner1, r0 + out0, r1 + out1, y0, y1);
      });
    }
    if (ledgeEnd) capEnd(ledgeEnd.b, ledgeEnd.inner, ledgeEnd.outer, ledgeEnd.y, true);
    // Support only: a sheet is a floor to stand on, never a wall, a ceiling or the skin of a solid.
    for (const f of geo.faces) f.supportOnly = true;
    return geo;
  });
  // Behind the chamber's floor, wall and roof, inside the rock: where the mesher's faces meet at a T a pixel can
  // fall between them, and in a dark room it would show the sky beyond the island. The wall's pieces are laid
  // only where the layout is solid, so none stands in the window or where the descent comes in.
  const chamberBacking = cached(() => {
    const geo = { verts: [], faces: [], lines: [] }, N = 96, STEP = Math.PI * 2 / N, tone = hexToRgb(L.PALETTE[L.M.earthDark]);
    const wallR = L.CHAMBER_R + 0.6, low = L.FLOOR - 0.25, high = L.LEVEL.shore - 1.25;
    // The wall is tried a row of cells at a time, from the row under the floor.
    const base = L.FLOOR - L.UNIT, rows = Math.ceil((high - base) / L.UNIT);
    const at = (bearing, r, y) => pushVert(geo, Math.sin(bearing) * r, y, Math.cos(bearing) * r);
    const rock = (b0, y) => {
      for (let k = 0; k <= 4; k++) if (!L.solidAt(Math.sin(b0 + STEP * k / 4) * wallR, y, Math.cos(b0 + STEP * k / 4) * wallR)) return false;
      return true;
    };
    for (let n = 0; n < N; n++) {
      const b0 = n * STEP, b1 = b0 + STEP;
      if (n % 3 === 0) {
        const c0 = b0, c1 = b0 + STEP * 3;
        face(geo, [at(c0, L.SHAFT_R + 0.6, low), at(c0, wallR, low), at(c1, wallR, low), at(c1, L.SHAFT_R + 0.6, low)], tone);
        face(geo, [at(c0, L.LAKE_R + 0.5, high), at(c1, L.LAKE_R + 0.5, high), at(c1, wallR, high), at(c0, wallR, high)], tone);
      }
      for (let j = 0, from = -1; j <= rows; j++) {
        const solid = j < rows && rock(b0, base + (j + 0.5) * L.UNIT);
        if (solid && from < 0) from = j;
        if (!solid && from >= 0) {
          const y0 = Math.max(low, base + from * L.UNIT), y1 = Math.min(high, base + j * L.UNIT);
          face(geo, [at(b0, wallR, y1), at(b1, wallR, y1), at(b1, wallR, y0), at(b0, wallR, y0)], tone);
          from = -1;
        }
      }
    }
    return noShadow(geo);
  });
  // Wall creepers root in the chamber's seams between its four reading panels, then trail over the outer floor.
  // Build the whole dressing once; it has no collision and never enters the shaft or covers the lettering.
  const chamberVines = cached(() => {
    const geo = { verts: [], faces: [], lines: [], smooth: true, normals: [] }, rand = mulberry32(0x514a93);
    const tones = ["#173b25", "#295e32", "#397d3b", "#68a34a"].map(hexToRgb);
    const vine = hexToRgb("#35552b"), floorY = L.FLOOR + 0.055;
    const point = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
    const wallR = (a, y) => {
      for (let r = L.CHAMBER_R - 0.8; r <= L.CHAMBER_R + 0.35; r += 0.1)
        if (L.solidAt(Math.sin(a) * r, y, Math.cos(a) * r)) return r - 0.1;
      return L.CHAMBER_R - 0.12;
    };
    for (let quarter = 0; quarter < 4; quarter++) for (let k = 0; k < 5; k++) {
      const a = quarter * Math.PI / 2 + (21 + k * 12 + (rand() - 0.5) * 5) * Math.PI / 180;
      const top = -4.8 - rand() * 0.5, end = floorY + (k % 3 === 0 ? 0 : 0.8 + rand() * 1.5);
      const points = [];
      for (let j = 0; j <= 8; j++) {
        const t = j / 8, b = a + Math.sin(t * 4.5 + k) * 0.012;
        points.push(point(b, wallR(b, top + (end - top) * t) - 0.045, top + (end - top) * t));
      }
      garland(geo, points, { r: 0.045 + (k % 2) * 0.012, color: vine, every: 0.45, size: 0.26 + rand() * 0.12, droop: 0.5,
        out: [-Math.sin(a), 0, -Math.cos(a)], rand, tones });
      if (end > floorY + 0.1) continue;
      const root = points[points.length - 1], runners = 1 + (k % 2);
      for (let branch = 0; branch < runners; branch++) {
        const floor = [root], reach = 1.8 + rand() * 1.2, bend = (branch ? 1 : -1) * (0.04 + rand() * 0.06);
        for (let j = 1; j <= 6; j++) {
          const t = j / 6;
          floor.push(point(a + bend * t, Math.hypot(root[0], root[2]) - reach * t, floorY));
        }
        garland(geo, floor, { r: 0.027, color: vine, every: 0.39, size: 0.2 + rand() * 0.08, droop: 0.12,
          out: [0, 1, 0], rand, tones });
      }
    }
    geo.normals = Float32Array.from(padNormals(geo).normals);
    return noShadow(geo);
  });

  // The lake's underside, hung in the hole in the ground: a bowl level with the spill crest at its rim and
  // MEMBRANE_DEPTH lower in the middle. It carries the surface's moving water material, clipped to the
  // waterline; the full thin closed collision shell stays in place at every fill level.
  const WATER = ["#2d7dff", "#4aa6ff", "#7cc8ff"], FOAM = "#e2f5ff";
  const membraneProfile = (drop) => Array.from({ length: 25 }, (_, i) => {
    const r = L.LAKE_R * (1 - i / 24);
    return [r, L.membraneY(r) - drop];
  });
  const membrane = cached(() => {
    // Smooth and transparent, retaining the lake's luminous blue from inside the chamber too.
    const geo = noShadow(lathe({ profile: membraneProfile(0), segments: 64, color: WATER[1], emissive: 0.9 }));
    const radius = (L.LAKE_R * L.LAKE_R + L.MEMBRANE_DEPTH * L.MEMBRANE_DEPTH) / (2 * L.MEMBRANE_DEPTH);
    geo.normals = [];
    for (let i = 0; i < geo.verts.length; i += 3) {
      // Explicit normals retain the renderer's length-six lake-material marker.
      geo.normals.push(-6 * geo.verts[i] / radius, 6 * (radius - L.MEMBRANE_DEPTH - geo.verts[i + 1]) / radius, -6 * geo.verts[i + 2] / radius);
    }
    for (const f of geo.faces) f.lake = true;
    geo.glass = 0.55;
    geo.twoSided = true;
    geo.collisionGeometry = merge(
      lathe({ profile: membraneProfile(0), segments: 64, color: WATER[0] }),
      lathe({ profile: membraneProfile(0.3).reverse(), segments: 64, color: WATER[0] }),
      lathe({ profile: [[L.LAKE_R, -0.3], [L.LAKE_R, 0]], segments: 64, color: WATER[0] })
    );
    return geo;
  });
  const membraneRock = cached(() => {
    const tones = ["#60605a", "#696963", "#585853", "#74746d"];
    // Overlap both the faceted shore and the waterline so neither boundary
    // exposes a slit as the lake level moves through the round basin.
    const profile = [[L.LAKE_R + L.UNIT + 0.2, 0.015], ...membraneProfile(-0.065)];
    const geo = noShadow(latheBy({ profile, segments: 192,
      color: (ring, segment) => tones[(Math.floor(ring * 24 / 3) * 7 + Math.floor(segment / 9) * 11) % tones.length] }));
    // The opaque WebGL pass culls back faces. Keep the exposed bowl solid from
    // the chamber below as well as from the shore above when the lake recedes.
    const upper = geo.faces.slice();
    for (const face of upper) geo.faces.push({ ...face, i: [...face.i].reverse() });
    return geo;
  });
  const membraneRim = cached(() => {
    // The voxel shore's bevel ends just outside the round bowl. Bridge that joint with a
    // closed stone collar, buried under the shore at its outer edge and into the bowl at
    // its inner edge, so neither side can show daylight as the lake level changes.
    const inner = L.LAKE_R - 0.25, outer = L.LAKE_R + L.UNIT + 0.1;
    const tones = ["#60605a", "#696963", "#585853", "#74746d"];
    return noShadow(latheBy({ profile: [
      [outer, -0.02], [L.LAKE_R + 0.15, -0.02], [inner, L.membraneY(inner) + 0.035],
      [inner, L.membraneY(inner) - 0.035], [L.LAKE_R + 0.15, -1.05],
      [outer, L.roofUnder(L.LAKE_R) - 0.04], [outer, -0.02]
    ], segments: 64, color: (ring, segment) => tones[(Math.floor(ring * 8) * 7 + Math.floor(segment / 3) * 11) % tones.length] }));
  });
  // The plank bridge that carries the ring path over a channel, in its own frame: x along the path, the deck's
  // top at y = 0 and the channel passing under along z. Round logs for bearers, bevelled planks across them.
  // Wide enough for a gorilla on all fours with room either side: the whole ring path and a little of each verge.
  const CROSSING = { length: 2 * L.CHANNEL.low + 0.5, width: L.RING.path - L.RING.lowland + 0.7 };
  const crossing = cached(() => {
    const geos = [], C = CROSSING, count = Math.round(C.length / 0.5), pitch = C.length / count;
    for (let i = 0; i < count; i++) geos.push(bevelBox({ w: pitch + 0.02, h: 0.16, d: C.width, color: i % 3 === 0 ? BARK : BARK_LT, bevel: 0.04, offset: { x: -C.length / 2 + (i + 0.5) * pitch, y: -0.08 } }));
    for (const side of [-1, 1]) geos.push(bevelBox({ w: C.length + 0.3, h: 0.26, d: 0.3, color: BARK, bevel: 0.06, offset: { y: -0.27, z: side * (C.width / 2 - 0.3) } }));
    return merge(...geos);
  });
  // A clearing's beds: for each of its four places a mat of broad banana leaves laid over one another, heads to
  // the middle, with a folded leaf for a pillow and a few standing round the rim. In the nest's own frame: +z out
  // from the lake, x across, the ground at y = 0. Five variants, so no two clearings are made the same way.
  const BANANA = ["#2f6a24", "#3f8a2c", "#57a637", "#7cc24e", "#a9d86a"].map(hexToRgb);
  const nestBed = (variant) => cached(() => {
    const rand = mulberry32(6400 + variant * 37), geo = { verts: [], faces: [], lines: [], smooth: true, normals: [] };
    const leaf = (x, y, z, heading, pitch, length, tone) => {
      const ax = Math.sin(heading) * Math.cos(pitch), ay = Math.sin(pitch), az = Math.cos(heading) * Math.cos(pitch);
      const n = faceUp(ax, ay, az);
      leaflet(geo, x, y, z, ax, ay, az, n[0], n[1], n[2], length, BANANA[tone], BANANA[Math.max(0, tone - 1)]);
    };
    for (const row of [-1, 1]) for (const side of [-1, 1]) {
      const cx = side * L.SLOT_GRID.dt, cz = row * L.SLOT_GRID.dr, to = row > 0 ? Math.PI : 0;
      // The mat: three leaves abreast and two long, shingled from the feet to the head.
      for (let k = 0; k < 6; k++) {
        const along = (k % 2 ? 0.1 : -1.5) + rand() * 0.2, across = ((k >> 1) - 1) * 0.5 + (rand() - 0.5) * 0.12;
        leaf(cx + across * Math.cos(to) + Math.sin(to) * along, 0.03 + k * 0.012, cz - across * Math.sin(to) + Math.cos(to) * along, to + (rand() - 0.5) * 0.3 + ((k >> 1) - 1) * 0.14, 0.02, 1.7 + rand() * 0.25, 1 + (k + variant) % 3);
      }
      // The pillow: one pale leaf folded back on itself at the head.
      leaf(cx + Math.sin(to) * 1.25, 0.12, cz + Math.cos(to) * 1.25, to + Math.PI / 2 + (rand() - 0.5) * 0.4, 0.05, 0.9, 4);
      leaf(cx + Math.sin(to) * 1.4, 0.17, cz + Math.cos(to) * 1.4, to - Math.PI / 2 + (rand() - 0.5) * 0.4, 0.08, 0.8, 3);
    }
    // Standing leaves round the rim, arching out, more of them on the side away from the lake.
    const rim = 7 + variant % 3;
    for (let k = 0; k < rim; k++) {
      const a = (k + rand() * 0.6) / rim * Math.PI * 1.3 - Math.PI * 0.65, x = Math.sin(a) * (L.NEST.halfT + 0.1), z = Math.cos(a) * (L.NEST.halfR + 0.1);
      limb(geo, x, 0, z, x * 1.03, 0.5 + rand() * 0.3, z * 1.03, 0.05, 0.035, 5, BANANA[0]);
      padNormals(geo);
      for (let n = 0; n < 3; n++) leaf(x * 1.03, 0.5 + rand() * 0.3, z * 1.03, a + (n - 1) * 0.8 + (rand() - 0.5) * 0.3, 0.5 + rand() * 0.25, 1.3 + rand() * 0.5, 1 + (n + k) % 3);
    }
    geo.normals = Float32Array.from(geo.normals);
    return Object.assign(noShadow(geo), { sway: 0.012 });
  });
  const NEST_BEDS = Array.from({ length: L.NESTS.length }, (_, i) => nestBed(i));

  // The islet end rests in the layout's recessed seat; the other end meets the top tread.
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
        geos.push(bevelBox({ w: 0.36, h: 3.95 + (z === 0 ? L.UNIT : 0), d: 0.36, color: BARK, offset: { x: side * (w / 2 + 0.16), y: 1.7 - (z === 0 ? L.UNIT / 2 : 0), z } }));
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
        flatInto(geo, bevelBox({ w: 0.36, h: 3.95 + (z === 0 ? L.UNIT : 0), d: 0.36, color: BARK, offset: { x: side * (w / 2 + 0.16), y: 1.7 - (z === 0 ? L.UNIT / 2 : 0), z } }));
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
  const JUNGLE = ["#173d2a", "#28643a", "#438a3e", "#83b94d"].map(hexToRgb);
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
    for (let k = 0; k < crowns.length; k++) {
      const [x, y, z, rx, ry] = crowns[k];
      leafy(geo, x, y, z, rx, ry, rx, JUNGLE, rand, Math.round(9 + rx * rx * 5), 0.4 + (k % 3) * 0.04);
    }
    const canopyEnd = geo.faces.length;
    // Uneven leafy curtains soften the umbrella's bare underside, while pockets of epiphytes climb the trunk.
    const dressRand = mulberry32(seed + 1100);
    for (let k = 1; k < crowns.length; k++) {
      const [x, y, z, rx, ry] = crowns[k], a = dressRand() * Math.PI * 2;
      const x0 = x + Math.cos(a) * rx * 0.45, z0 = z + Math.sin(a) * rx * 0.45, length = height * (0.19 + dressRand() * 0.3), points = [];
      for (let j = 0; j <= 5; j++) points.push([x0 + Math.sin(j * 0.85 + a) * 0.13, y - ry * 0.45 - j / 5 * length, z0 + Math.sin(j * 0.65) * 0.12]);
      garland(geo, points, { r: 0.034, color: LIANA, every: 0.4, size: 0.22 + (k % 2) * 0.07, droop: 0.55, rand: dressRand, tones: JUNGLE });
    }
    for (let k = 0; k < 3; k++) {
      const t = 0.3 + k * 0.19, a = dressRand() * Math.PI * 2, x = cx * t + Math.cos(a) * 0.2, z = Math.sin(a) * 0.2;
      sprig(geo, x, height * t, z, Math.cos(a), 0.6, Math.sin(a), 7, 0.5 + dressRand() * 0.15, dressRand, JUNGLE);
    }
    geo.normals = Float32Array.from(geo.normals);
    geo.sway = 0.0006;
    // Where the wildlife climbs and perches, in the tree's own frame: the trunk's lean at the top, its height, the
    // five limbs (from the trunk out to each lower crown), and a perch on top of every crown. `crowns` are the
    // clumps themselves (centre, then radius across and up), which the rain lands on.
    geo.climb = { lean: cx, height, branches, perches: crowns.map(([x, y, z, , ry]) => [x, y + ry * 0.9, z]), crowns };
    geo.collisionGeometry = merge(canopyShell(seed, height, spread), canopySupport(geo, canopyStart, canopyEnd));
    return geo;
  });
  const CANOPY = [canopy(71, 7.5, 3.2), canopy(72, 5.4, 2.6), canopy(73, 9.2, 3.8)];

  // Eight fronds arching out and down, each a row of paired leaflets shrinking to a tip.
  const FERN = ["#1e5237", "#347d42", "#66a84a", "#99c856"].map(hexToRgb);
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
  const SHRUB = ["#16442e", "#286a3d", "#49904a", "#81b84d"].map(hexToRgb);
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
  // Substantial understory, built at its natural proportions rather than stretching a small round shrub.
  // The broad blades arch in 3D with a folded midrib, notched edges and two painted halves. All three plants
  // share the same bounded footprint, but their leaf heights, fans and accents give the scatter different silhouettes.
  const UNDERLEAF = ["#123d2d", "#1d6040", "#368449", "#67a84d", "#a0c959"].map(hexToRgb);
  const PETIOLE = hexToRgb("#46713c"), VEIN = hexToRgb("#91af58"), CORAL = hexToRgb("#df6448"), CORAL_DK = hexToRgb("#a53639");
  const broadBlade = (geo, ox, oy, oz, angle, reach, rise, width, arch, light, dark, split = false) => {
    const ca = Math.cos(angle), sa = Math.sin(angle), rows = [], count = 6;
    for (let j = 0; j <= count; j++) {
      const t = j / count, wave = j === count ? 0 : Math.sin(t * Math.PI), edge = width * Math.pow(Math.max(0, wave), 0.68) * (split && (j === 2 || j === 4) ? 0.64 : 1);
      const x = ox + ca * reach * t, y = oy + rise * t + arch * wave, z = oz + sa * reach * t;
      const slope = rise + arch * Math.PI * Math.cos(t * Math.PI), nl = Math.hypot(reach, slope), nx = -ca * slope / nl, ny = reach / nl, nz = -sa * slope / nl;
      const row = [];
      for (const side of [-1, 0, 1]) {
        row.push(pushVert(geo, x - sa * edge * side, y - Math.abs(side) * width * wave * 0.12, z + ca * edge * side));
        geo.normals.push(nx, ny, nz);
      }
      rows.push(row);
    }
    for (let j = 0; j < count; j++) for (let side = 0; side < 2; side++) {
      const ids = j === 0 ? [rows[j][side], rows[j + 1][side + 1], rows[j + 1][side]] : j === count - 1 ?
        [rows[j][side], rows[j][side + 1], rows[j + 1][side]] : [rows[j][side], rows[j][side + 1], rows[j + 1][side + 1], rows[j + 1][side]];
      const color = side ? light : dark;
      geo.faces.push({ i: ids, color, emissive: 0 }, { i: [ids[0], ...ids.slice(1).reverse()], color, emissive: 0 });
    }
    // A slender pale rib keeps the broad planes readable when the light is low.
    for (let j = 0; j < count; j++) {
      const ids = [];
      for (const [t, side] of [[j / count, -1], [(j + 1) / count, -1], [(j + 1) / count, 1], [j / count, 1]]) {
        const half = 0.012 * (1 - t), x = ox + ca * reach * t - sa * half * side, z = oz + sa * reach * t + ca * half * side;
        ids.push(pushVert(geo, x, oy + rise * t + arch * Math.sin(t * Math.PI) + 0.006, z));
        geo.normals.push(0, 1, 0);
      }
      face(geo, j === count - 1 ? [ids[0], ids[3], ids[1]] : [ids[0], ids[3], ids[2], ids[1]], VEIN, { emissive: 0 });
    }
  };
  const undergrowth = (kind) => cached(() => {
    const rand = mulberry32(741 + kind * 37), geo = { verts: [], faces: [], lines: [], smooth: true, normals: [] };
    // Offset stems and overlapping lower masses make one clump read as several plants growing together.
    for (const [x, z, h] of [[-0.23, 0.14, 1.95], [0.08, 0, 2.72], [0.28, -0.17, 2.5], [0.08, 0.31, 1.5]]) {
      limb(geo, x * 0.55, -0.08, z * 0.55, x, h, z, 0.055, 0.026, 5, PETIOLE);
    }
    padNormals(geo);
    leafy(geo, -0.2, 0.75, 0.05, 0.62, 0.55, 0.65, UNDERLEAF, rand, 10, 0.32);
    leafy(geo, 0.23, 1.65, -0.09, 0.66, 0.63, 0.6, UNDERLEAF, rand, 12, 0.38);
    if (kind !== 1) {
      // Giant elephant ears and tall heliconia both retain generous leaves well above the waterline.
      const count = kind ? 17 : 21;
      for (let k = 0; k < count; k++) {
        const a = k * 2.39996 + rand() * 0.32, tier = k % 3, ox = Math.cos(a + 0.6) * 0.18, oz = Math.sin(a + 0.6) * 0.18;
        const y = 0.55 + tier * 0.76 + rand() * 0.3, reach = 0.76 + rand() * 0.36, rise = tier === 2 ? 0.75 + rand() * 0.3 : 0.18 + rand() * 0.35;
        const width = kind ? 0.3 + rand() * 0.12 : 0.42 + rand() * 0.15, band = tier === 2 ? 3 : 2;
        limb(geo, 0.08 * y / 2.72, y - 0.18, 0, ox, y, oz, 0.025, 0.017, 5, PETIOLE);
        padNormals(geo);
        broadBlade(geo, ox, y, oz, a, reach, rise, width, 0.21 + rand() * 0.15, UNDERLEAF[band], UNDERLEAF[band - 1], !kind);
      }
      if (kind === 2) {
        // Two coral flower spires are accents in the greenery, not a carpet of flowers.
        for (const [x, z, y] of [[-0.31, 0.1, 2.3], [0.2, -0.16, 2.7]]) {
          limb(geo, x, 1.3, z, x + 0.04, y + 0.52, z, 0.025, 0.014, 5, PETIOLE);
          padNormals(geo);
          for (let j = 0; j < 4; j++) {
            const a = j % 2 ? 0.3 : Math.PI + 0.3;
            broadBlade(geo, x, y + j * 0.13, z, a, 0.28 - j * 0.035, 0.13, 0.06, 0.045, CORAL, CORAL_DK);
          }
        }
      }
    } else {
      // Feathered fronds on unequal stems: a tall airy fan above a denser emerald middle layer.
      for (let k = 0; k < 12; k++) {
        const a = k * 2.39996 + rand() * 0.25, ca = Math.cos(a), sa = Math.sin(a), y = 1.25 + (k % 3) * 0.55 + rand() * 0.22;
        const reach = 0.88 + rand() * 0.18, rise = 0.28 + rand() * 0.35, arch = 0.45 + rand() * 0.2, ox = ca * 0.14, oz = sa * 0.14;
        limb(geo, 0.08 * y / 2.72, y - 0.12, 0, ox, y, oz, 0.025, 0.014, 5, PETIOLE);
        let px = ox, py = y, pz = oz;
        for (let j = 1; j <= 8; j++) {
          const t = j / 8, x = ox + ca * reach * t, yy = y + rise * t + arch * Math.sin(t * Math.PI), z = oz + sa * reach * t;
          limb(geo, px, py, pz, x, yy, z, 0.014 * (1 - t * 0.65), 0.012 * (1 - t * 0.7), 4, PETIOLE);
          padNormals(geo);
          for (const side of [-1, 1]) {
            const length = (0.34 + Math.sin(t * Math.PI) * 0.18) * (1 - t * 0.5), ax = ca * 0.38 - sa * side, az = sa * 0.38 + ca * side, ay = 0.22 - t * 0.38;
            const l = Math.hypot(ax, ay, az), n = faceUp(ax / l, ay / l, az / l);
            leaflet(geo, x, yy, z, ax / l, ay / l, az / l, n[0], n[1], n[2], length, UNDERLEAF[3 + (k % 4 === 0 ? 1 : 0)], UNDERLEAF[2]);
          }
          px = x; py = yy; pz = z;
        }
      }
      for (let k = 0; k < 7; k++) {
        const a = k * 2.39996;
        broadBlade(geo, 0, 0.75 + (k % 2) * 0.65, 0, a, 0.96, 0.4, 0.36, 0.2, UNDERLEAF[2], UNDERLEAF[1], true);
      }
    }
    geo.normals = Float32Array.from(geo.normals);
    let radius = 0, height = 0;
    for (let i = 0; i < geo.verts.length; i += 3) {
      radius = Math.max(radius, Math.hypot(geo.verts[i], geo.verts[i + 2]));
      height = Math.max(height, geo.verts[i + 1]);
    }
    return Object.assign(geo, { sway: 0.0045, plantRadius: radius, plantHeight: height });
  });
  const UNDERGROWTH = [undergrowth(0), undergrowth(1), undergrowth(2)];
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

  const caveSign = cached(() => BL.hubModels.caveSign("Mempool Rainforest"));
  const TORCH_STEM_H = 1.6;
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
  // The chain board stands just inside the far shoreline, in front of the trees. Its inward-facing slate,
  // frame and live lettering share the pool's circular arc; +z faces the centre in the board's own frame.
  // Its feet reach the bowl, while the face stays above the fullest waterline.
  const CHAIN_BOARD = { w: 7.4, h: 3, y: 1, d: 0.3, px: 0.03, r: L.LAKE_R - 0.75 };
  const BOARD_FOOT = L.membraneY(CHAIN_BOARD.r - 0.3) - 0.08;
  const curveChainBoard = (source, ox = 0, oy = 0, oz = 0) => {
    const geo = { ...source, verts: [], faces: [], lines: [] }, v = source.verts, radius = CHAIN_BOARD.r;
    const point = (x, y, z) => {
      const a = (x + ox) / radius, r = radius - z - oz;
      return pushVert(geo, Math.sin(a) * r, y + oy, radius - Math.cos(a) * r);
    };
    for (const f of source.faces) {
      const ids = f.i.slice();
      if (ids.length !== 4) {
        geo.faces.push({ ...f, i: ids.map((id) => point(v[id * 3], v[id * 3 + 1], v[id * 3 + 2])) });
        continue;
      }
      // Split wide faces before bending: moving only a plank's end vertices leaves a flat chord.
      if (Math.abs(v[ids[3] * 3] - v[ids[0] * 3]) > Math.abs(v[ids[1] * 3] - v[ids[0] * 3])) ids.push(ids.shift());
      const a = ids[0] * 3, b = ids[1] * 3, c = ids[2] * 3, d = ids[3] * 3;
      const count = Math.max(1, Math.ceil(Math.max(Math.abs(v[b] - v[a]), Math.abs(v[c] - v[d])) / 0.24));
      for (let i = 0; i < count; i++) {
        const u = i / count, t = (i + 1) / count;
        geo.faces.push({ ...f, i: [
          point(lerp(v[a], v[b], u), lerp(v[a + 1], v[b + 1], u), lerp(v[a + 2], v[b + 2], u)),
          point(lerp(v[a], v[b], t), lerp(v[a + 1], v[b + 1], t), lerp(v[a + 2], v[b + 2], t)),
          point(lerp(v[d], v[c], t), lerp(v[d + 1], v[c + 1], t), lerp(v[d + 2], v[c + 2], t)),
          point(lerp(v[d], v[c], u), lerp(v[d + 1], v[c + 1], u), lerp(v[d + 2], v[c + 2], u))
        ] });
      }
    }
    return geo;
  };
  // Framed like the cave signs: stout legs, thick bevelled rails with ragged ends standing proud of the slate,
  // bevelled stiles, iron plates riveted over the corners and a lamp on the top rail.
  const chainBoardLegs = cached(() => {
    const B = CHAIN_BOARD;
    return curveChainBoard(merge(...[-1, 1].map((side) => bevelBox({ w: 0.5, h: B.y - BOARD_FOOT, d: 0.5, color: SIGN_POST, offset: { x: side * (B.w / 2 - 0.3), y: (B.y + BOARD_FOOT) / 2 } }))));
  });
  const chainBoard = cached(() => {
    const B = CHAIN_BOARD, top = B.y + B.h;
    return curveChainBoard(merge(
      box({ w: B.w, h: B.h, d: B.d, color: "#2a2724", offset: { y: B.y + B.h / 2 } }),
      bevelBox({ w: B.w + 0.57, h: 0.4, d: 0.52, color: SIGN_WOOD[1], bevel: 0.08, offset: { x: 0.04, y: top + 0.12 } }),
      bevelBox({ w: B.w + 0.44, h: 0.36, d: 0.52, color: SIGN_WOOD[2], bevel: 0.08, offset: { x: -0.05, y: B.y - 0.1 } }),
      ...[-1, 1].map((side) => bevelBox({ w: 0.34, h: B.h, d: 0.48, color: SIGN_WOOD[0], bevel: 0.07, offset: { x: side * (B.w / 2 - 0.1), y: B.y + B.h / 2 } })),
      ...ironCorners(B.w / 2 - 0.1, B.y + B.h / 2, B.h / 2 + 0.05, 0.26, 0.36),
      ...lampOn(top + 0.32, 0.3)
    ));
  });
  // A small post beside the big board, carrying a question mark: the weather key is behind it.
  const INFO_SIGN = { w: 1.1, h: 1.1, y: 1.1, d: 0.26 };
  const infoSignLeg = cached(() => bevelBox({ w: 0.36, h: INFO_SIGN.y - BOARD_FOOT, d: 0.36, color: SIGN_POST, offset: { y: (INFO_SIGN.y + BOARD_FOOT) / 2 } }));
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

  // A torch on a wall, in its own frame: the wall at z = 0 with +z out into the room. The flame is its only
  // emissive face, as every lamp's is. A voxel wall steps either side of its round line, so the arm runs back
  // into the rock far enough to be let into it wherever the wall stands.
  const wallTorch = cached(() => merge(
    bevelBox({ w: 0.16, h: 0.14, d: 1.1, color: "#3b2a1c", offset: { y: -0.05, z: -0.05 } }),
    bevelBox({ w: 0.2, h: 0.75, d: 0.2, color: BARK, offset: { y: 0.3, z: 0.46 } }),
    bevelBox({ w: 0.32, h: 0.1, d: 0.32, color: "#3b2a1c", offset: { y: 0.7, z: 0.46 } }),
    noShadow(bevelBox({ w: 0.26, h: 0.34, d: 0.26, color: "#ff9a2a", emissive: 1, bevel: 0.06, offset: { y: 0.92, z: 0.46 } }))
  ));
  // A vein of the lake's water let into a tunnel wall, in the same frame: a crooked seam of blue a block wide
  // running down the face, with a bright pixel here and there. Two variants; the hub breathes their glow.
  const vein = (variant) => cached(() => {
    const rand = mulberry32(7300 + variant * 53), parts = [];
    let x = 0;
    for (let y = 3.1; y > 0.2; y -= 0.25) {
      if (rand() < 0.45) x += rand() < 0.5 ? -0.25 : 0.25;
      x = Math.max(-0.5, Math.min(0.5, x));
      // Deep enough to stand in the rock wherever the stepped wall is, so the seam is let in, never floating.
      parts.push(box({ w: 0.25, h: 0.26, d: 0.9, color: WATER[(variant + Math.round(y * 4)) % 3], emissive: 0.9, offset: { x, y, z: -0.03 } }));
      if (rand() < 0.2) parts.push(box({ w: 0.12, h: 0.12, d: 0.05, color: FOAM, emissive: 1, offset: { x: x + 0.06, y, z: 0.44 } }));
    }
    // It pools at the foot of the wall and runs a little way along it.
    parts.push(box({ w: 1.1 + variant * 0.4, h: 0.05, d: 0.9, color: WATER[1], emissive: 0.85, offset: { x: x + 0.3, y: 0.03, z: 0.1 } }));
    return noShadow(merge(...parts));
  });
  const VEINS = [vein(0), vein(1)];
  // Roots hanging through a tunnel's roof by an opening, in a frame whose origin is on the roof: smooth cords.
  const roots = cached(() => {
    const rand = mulberry32(5521), geo = { verts: [], faces: [], lines: [], smooth: true, normals: [] };
    for (let k = 0; k < 5; k++) {
      let x = (k - 2) * 0.55 + (rand() - 0.5) * 0.3, y = 0.1, z = (rand() - 0.5) * 0.6;
      const length = 0.7 + rand() * 0.9;
      for (let j = 1; j <= 4; j++) {
        const nx = x + (rand() - 0.5) * 0.16, ny = 0.1 - j / 4 * length, nz = z + (rand() - 0.5) * 0.16;
        limb(geo, x, y, z, nx, ny, nz, 0.05 - j * 0.008, 0.042 - j * 0.008, 5, BARK_RGB);
        x = nx; y = ny; z = nz;
      }
    }
    padNormals(geo);
    geo.normals = Float32Array.from(geo.normals);
    return noShadow(geo);
  });

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

  // Live numbers sit just proud of the slate and bend with it, including the run-merged glyph faces.
  const chainPanel = (ctx, w, h, background) => {
    const B = CHAIN_BOARD;
    return curveChainBoard(panelFrom(ctx, w, h, B.px, B.px, background),
      -w * B.px / 2, B.y + (B.h - h * B.px) / 2, B.d / 2 + 0.02);
  };

  // The island as one group: its body, the smooth floors, the bridge, the lake's membrane, the plank crossings,
  // the clearings' beds, the name above the bridge gateway and the torches of the court. Scatter is the hub's.
  const build = (place) => {
    const node = createNode({ position: { x: place.x, y: place.y, z: place.z }, rotation: { x: 0, y: place.ry, z: 0 } });
    const groundNode = createNode({ geometry: islet() });
    const floorNode = createNode({ geometry: rampFloor() });
    const bridgeNode = createNode({ position: { x: 0, y: 0, z: place.bridgeLocalZ }, geometry: bridge() });
    // Own the clipping height per visit; the cached collision shell remains unchanged.
    const membraneNode = createNode({ geometry: { ...membrane(), clipMaxY: place.y + L.WATER.low }, sightHidden: true });
    const membraneRockNode = createNode({ geometry: { ...membraneRock(), clipMinY: place.y + L.WATER.low + 0.018 }, sightHidden: true });
    const membraneRimNode = createNode({ geometry: membraneRim(), sightHidden: true });
    // Canvas 2D sorts by depth alone: the bias draws the backing before everything it lies behind.
    const backingNode = createNode({ geometry: chamberBacking(), sightHidden: true, depthBias: 60 });
    const vinesNode = createNode({ geometry: chamberVines(), sightHidden: true });
    // One crossing where the ring path meets each channel.
    const pathR = (L.RING.lowland + L.RING.path) / 2;
    const crossings = L.CHANNELS.map((channel) => createNode({
      position: { x: Math.sin(channel.bearing) * pathR, y: L.LEVEL.ground + 0.02, z: Math.cos(channel.bearing) * pathR },
      rotation: { x: 0, y: channel.bearing, z: 0 }, geometry: crossing()
    }));
    const beds = L.NESTS.map((nest, i) => createNode({ position: { x: nest.x, y: nest.y, z: nest.z }, rotation: { x: 0, y: nest.bearing, z: 0 }, geometry: NEST_BEDS[i](), sightHidden: true }));
    // The full name crowns the island gateway, with its lower pegs seated into the crossbeam.
    const signNode = createNode({ position: { x: 0, y: 4.48, z: place.bridgeLocalZ }, geometry: caveSign() });
    // Lit like every hub torch, so the Matrix treats their flames as fire rather than as stone.
    const torches = [-1, 1].map((side) => {
      const r = L.RAMP.r + side * (L.RAMP.half + 0.3), b = L.RAMP.start - 0.07;
      return createNode({ position: { x: Math.sin(b) * r, y: L.LEVEL.court, z: Math.cos(b) * r }, geometry: torchPost(), matrixEmissiveLiving: true });
    });
    addChild(node, groundNode, floorNode, bridgeNode, membraneNode, membraneRockNode, membraneRimNode, backingNode, vinesNode, signNode, ...crossings, ...beds, ...torches);
    return { node, ground: groundNode, floor: floorNode, bridge: bridgeNode, membrane: membraneNode, membraneRock: membraneRockNode, vines: vinesNode, sign: signNode, crossings, beds, torches };
  };

  BL.poolModels = {
    SITE, UNIT, BEARING, DIR, WATER, FOAM, spot, build, latheBy, islet, rampFloor, membrane, membraneRock, chamberBacking, chamberVines, crossing, CROSSING, NEST_BEDS, bridge, caveSign, torchPost, wallTorch, VEINS, roots,
    TORCH_STEM_H, carve, carveCells, panelFrom, chainPanel, chainBoard, chainBoardLegs, CHAIN_BOARD, infoSign, infoSignLeg, INFO_SIGN, CANOPY, UNDERGROWTH, fern, shrub, mossRock, deckY,
    beastRig, flowers, log,
    COLORS: { LEAF, LEAF_DK, LEAF_LT, BARK, BARK_LT, STONE, STONE_DK, MOSS, WET, GOLD }
  };
})();
