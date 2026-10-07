// Procedural geometry: the lab room (`labRoom`), cavemen (`caveman`), props, crates, the `SWAG` catalog, and
// the shared builders (`box`, `bevelBox`, `lathe`, `tube`, `ring`, `polyline`, `merge`, `makeVox`, `voxCoords`,
// `voxelGeometry`, `cached`).
//
// Every caveman wears a hide belt, a fur shoulder strap and a loincloth whose flaps hang over the thighs
// (`k.loinFlaps(v)`, colours from `k.loin`, which a torso hook may set; a character that replaces its torso
// in `gear` calls it itself, as 2140data does). Shaven faces get a mouth and bare heads ears. None of these
// draws from `k.rand`, so no character's existing draws move.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { hexToRgb, damp } = BL.math;
  const { createNode, addChild } = BL.scene;
  const geometry = () => ({ verts: [], faces: [], lines: [] });
  const pushVert = (geo, x, y, z) => {
    geo.verts.push(x, y, z);
    return geo.verts.length / 3 - 1;
  };
  const face = (geo, indices, color, { emissive = 0 } = {}) => {
    geo.faces.push({ i: indices, color, emissive });
  };
  const box = ({ w = 1, h = 1, d = 1, color, emissive = 0, offset = {} } = {}) => {
    const geo = geometry();
    const ox = offset.x || 0, oy = offset.y || 0, oz = offset.z || 0;
    const px = w / 2, py = h / 2, pz = d / 2;
    const b = geo.verts.length / 3;
    geo.verts.push(
      -px + ox, -py + oy, -pz + oz,
      px + ox, -py + oy, -pz + oz,
      px + ox, py + oy, -pz + oz,
      -px + ox, py + oy, -pz + oz,
      -px + ox, -py + oy, pz + oz,
      px + ox, -py + oy, pz + oz,
      px + ox, py + oy, pz + oz,
      -px + ox, py + oy, pz + oz);
    const c = [b, b + 1, b + 2, b + 3, b + 4, b + 5, b + 6, b + 7];
    const rgb = hexToRgb(color);
    const opts = { emissive };
    face(geo, [c[4], c[5], c[6], c[7]], rgb, opts);
    face(geo, [c[1], c[0], c[3], c[2]], rgb, opts);
    face(geo, [c[5], c[1], c[2], c[6]], rgb, opts);
    face(geo, [c[0], c[4], c[7], c[3]], rgb, opts);
    face(geo, [c[3], c[7], c[6], c[2]], rgb, opts);
    face(geo, [c[0], c[1], c[5], c[4]], rgb, opts);
    return geo;
  };
  // A box with every edge chamfered: the chunky, rounded-looking timber of the island's signs, bridges and boards.
  // Each corner splits into three vertices, one on each face it touches; the chamfers take a lighter tone so
  // edges catch the light like a painted plank. Winding is fixed per face against the outward direction.
  const bevelBox = ({ w = 1, h = 1, d = 1, color, emissive = 0, offset = {}, bevel = Math.min(w, h, d) * 0.2 } = {}) => {
    const geo = geometry();
    const half = [w / 2, h / 2, d / 2], off = [offset.x || 0, offset.y || 0, offset.z || 0];
    const rgb = hexToRgb(color), edge = rgb.map((v) => Math.min(255, Math.round(v * 1.1))), opts = { emissive };
    // vert(s, a): the corner with signs s = [sx, sy, sz], on the face of axis a.
    const index = new Map();
    const vert = (s, a) => {
      const key = s[0] * 9 + s[1] * 3 + s[2] + a * 27;
      let i = index.get(key);
      if (i === undefined) {
        const p = [0, 1, 2].map((k) => s[k] * (k === a ? half[k] : half[k] - bevel) + off[k]);
        index.set(key, i = pushVert(geo, p[0], p[1], p[2]));
      }
      return i;
    };
    const add = (ids, c, out) => {
      const v = geo.verts;
      let nx = 0, ny = 0, nz = 0;
      for (let k = 0; k < ids.length; k++) {
        const p = ids[k] * 3, q = ids[(k + 1) % ids.length] * 3;
        nx += (v[p + 1] - v[q + 1]) * (v[p + 2] + v[q + 2]);
        ny += (v[p + 2] - v[q + 2]) * (v[p] + v[q]);
        nz += (v[p] - v[q]) * (v[p + 1] + v[q + 1]);
      }
      face(geo, nx * out[0] + ny * out[1] + nz * out[2] < 0 ? ids.reverse() : ids, c, opts);
    };
    const S = [-1, 1];
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, c = (a + 2) % 3;
      for (const sa of S) {
        const s = (u, t) => { const r = [0, 0, 0]; r[a] = sa; r[b] = u; r[c] = t; return r; };
        const out = [0, 0, 0];
        out[a] = sa;
        add([vert(s(-1, -1), a), vert(s(1, -1), a), vert(s(1, 1), a), vert(s(-1, 1), a)], rgb, out);
      }
      // The four chamfers running along axis a.
      for (const sb of S) for (const sc of S) {
        const s = (t) => { const r = [0, 0, 0]; r[a] = t; r[b] = sb; r[c] = sc; return r; };
        const out = [0, 0, 0];
        out[b] = sb; out[c] = sc;
        add([vert(s(-1), b), vert(s(1), b), vert(s(1), c), vert(s(-1), c)], edge, out);
      }
    }
    for (const sx of S) for (const sy of S) for (const sz of S) {
      const s = [sx, sy, sz];
      add([vert(s, 0), vert(s, 1), vert(s, 2)], edge, s);
    }
    return geo;
  };
  const panel = ({ w = 1, h = 1, tilesX = 4, tilesY = 4, color, altColor, emissive = 0 } = {}) => {
    const geo = geometry();
    const rgb = hexToRgb(color);
    const alt = altColor ? hexToRgb(altColor) : rgb;
    const grid = [];
    for (let ty = 0; ty <= tilesY; ty++) {
      const row = [];
      for (let tx = 0; tx <= tilesX; tx++) {
        row.push(pushVert(geo, (tx / tilesX - 0.5) * w, (ty / tilesY - 0.5) * h, 0));
      }
      grid.push(row);
    }
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        face(geo, [grid[ty][tx], grid[ty][tx + 1], grid[ty + 1][tx + 1], grid[ty + 1][tx]], (tx + ty) % 2 ? alt : rgb, { emissive });
      }
    }
    return geo;
  };
  const lathe = ({ profile, segments = 8, color, emissive = 0 } = {}) => {
    const geo = geometry();
    const rgb = typeof color === "string" ? hexToRgb(color) : null;
    const rings = profile.map(([r, y]) => {
      const ring = [];
      for (let s = 0; s < segments; s++) {
        const a = s / segments * Math.PI * 2;
        ring.push(pushVert(geo, Math.cos(a) * r, y, Math.sin(a) * r));
      }
      return ring;
    });
    for (let p = 0; p < rings.length - 1; p++) {
      const t = p / (rings.length - 1);
      const c = rgb || hexToRgb(color(t));
      for (let s = 0; s < segments; s++) {
        const s2 = (s + 1) % segments;
        face(geo, [rings[p][s], rings[p + 1][s], rings[p + 1][s2], rings[p][s2]], c, { emissive });
      }
    }
    return geo;
  };
  const tube = ({ path, radius, rings = 8, segments = 6, colorFn, emissive = 0 } = {}) => {
    const geo = geometry();
    const ringIdx = [];
    for (let p = 0; p <= rings; p++) {
      const t = p / rings;
      const center = path(t);
      const ahead = path(Math.min(1, t + 0.01));
      const behind = path(Math.max(0, t - 0.01));
      let tx = ahead.x - behind.x, ty = ahead.y - behind.y, tz = ahead.z - behind.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      let nx = ty, ny = -tx, nz = 0;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      const r = radius(t);
      const ring = [];
      for (let s = 0; s < segments; s++) {
        const a = s / segments * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        ring.push(pushVert(geo, center.x + (nx * ca + bx * sa) * r, center.y + (ny * ca + by * sa) * r, center.z + (nz * ca + bz * sa) * r));
      }
      ringIdx.push(ring);
    }
    for (let p = 0; p < rings; p++) {
      const c = hexToRgb(colorFn(p / rings));
      for (let s = 0; s < segments; s++) {
        const s2 = (s + 1) % segments;
        face(geo, [ringIdx[p][s], ringIdx[p][s2], ringIdx[p + 1][s2], ringIdx[p + 1][s]], c, { emissive });
      }
    }
    return geo;
  };
  const ring = ({ r = 0.3, thickness = 0.05, y = 0, segments = 12, color, emissive = 0 } = {}) => lathe({
    profile: [[r - thickness, y - thickness], [r + thickness, y - thickness], [r + thickness, y + thickness], [r - thickness, y + thickness], [r - thickness, y - thickness]],
    segments,
    color,
    emissive
  });
  const polyline = ({ points, color, emissive = 0.8, closed = false } = {}) => {
    const geo = geometry();
    const rgb = hexToRgb(color);
    const idx = points.map((p) => pushVert(geo, p.x, p.y, p.z));
    const count = closed ? idx.length : idx.length - 1;
    for (let i = 0; i < count; i++) geo.lines.push({ i: [idx[i], idx[(i + 1) % idx.length]], color: rgb, emissive });
    return geo;
  };
  const merge = (...geos) => {
    const out = geometry();
    // One grid survives a merge when every voxel part shares its unit; the renderer checks each face against it.
    const voxel = geos.find((geo) => geo.voxel)?.voxel;
    if (voxel && geos.every((geo) => !geo.voxel || geo.voxel[0] === voxel[0])) out.voxel = voxel;
    for (const geo of geos) {
      const shift = out.verts.length / 3;
      // Index walk, not a spread: a large geometry would overflow the stack.
      const v = geo.verts;
      for (let i = 0; i < v.length; i++) out.verts.push(v[i]);
      for (const f of geo.faces) out.faces.push({ ...f, i: f.i.map((i) => i + shift) });
      for (const l of geo.lines) out.lines.push({ ...l, i: l.i.map((i) => i + shift) });
    }
    return out;
  };
  // Draw the liquid and rolled lip as solids, with the vessel wall in its own
  // translucent pass. Keep the wall vertices on the solid for grip bounds.
  const glassVessel = ({ liquidProfile, glassProfile, liquid, segments = 24 }) => {
    const fluid = lathe({ profile: liquidProfile, segments, color: liquid, emissive: 0.75 });
    const glass = lathe({ profile: glassProfile, segments, color: "#d5ece8" });
    const rim = geometry(), wall = geometry();
    rim.verts = wall.verts = glass.verts;
    let top = -Infinity;
    for (const point of glassProfile) top = Math.max(top, point[1]);
    for (let i = 0; i < glass.faces.length; i++) {
      const band = Math.floor(i / segments);
      const atLip = Math.min(glassProfile[band][1], glassProfile[band + 1][1]) >= top - 0.026;
      (atLip ? rim.faces : wall.faces).push(glass.faces[i]);
    }
    wall.glassOpacity = 0.14;
    wall.castShadow = false;
    wall.smooth = true;
    const vessel = merge(fluid, rim);
    vessel.glassShell = wall;
    return vessel;
  };
  const attachGlassShell = (node) => {
    if (node.geometry.glassShell) addChild(node, createNode({ geometry: node.geometry.glassShell }));
    return node;
  };
  // Key stays a string: cells are not all integral (half-steps) and the span exceeds a bit-packed key's range.
  const voxKey = (x, y, z) => x + "," + y + "," + z;
  const voxCoords = (k, out) => {
    const a = k.split(",");
    out[0] = +a[0];
    out[1] = +a[1];
    out[2] = +a[2];
    return out;
  };
  const makeVox = () => {
    const map = new Map();
    const key = voxKey;
    return {
      map,
      has: (x, y, z) => map.has(key(x, y, z)),
      get: (x, y, z) => map.get(key(x, y, z)),
      set: (x, y, z, c) => map.set(key(x, y, z), c),
      del: (x, y, z) => map.delete(key(x, y, z)),
      fill(x0, x1, y0, y1, z0, z1, c) {
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            for (let z = z0; z <= z1; z++) {
              const value = typeof c === "function" ? c(x, y, z) : c;
              if (value != null) map.set(key(x, y, z), value);
            }
          }
        }
      }
    };
  };
  // Exposed voxel faces emitted as run-merged quads.
  const CELL = [0, 0, 0];
  const voxelFaces = (iterate, has, emit) => {
    const F = { py: [], ny: [], px: [], nx: [], pz: [], nz: [] };
    iterate((x, y, z, c) => {
      if (!has(x, y + 1, z)) F.py.push({ a: y, b: z, r: x, c });
      if (!has(x, y - 1, z)) F.ny.push({ a: y, b: z, r: x, c });
      if (!has(x + 1, y, z)) F.px.push({ a: x, b: y, r: z, c });
      if (!has(x - 1, y, z)) F.nx.push({ a: x, b: y, r: z, c });
      if (!has(x, y, z + 1)) F.pz.push({ a: z, b: y, r: x, c });
      if (!has(x, y, z - 1)) F.nz.push({ a: z, b: y, r: x, c });
    });
    const mergeEmit = (list, quad) => {
      list.sort((p, q) => p.a - q.a || p.b - q.b || p.r - q.r);
      for (let i = 0; i < list.length;) {
        let j = i + 1;
        while (j < list.length && list[j].a === list[i].a && list[j].b === list[i].b && list[j].r === list[j - 1].r + 1 && list[j].c === list[i].c) j++;
        quad(list[i], list[j - 1].r);
        i = j;
      }
    };
    mergeEmit(F.py, (f, r1) => emit([[f.r, f.a + 1, f.b], [f.r, f.a + 1, f.b + 1], [r1 + 1, f.a + 1, f.b + 1], [r1 + 1, f.a + 1, f.b]], f.c));
    mergeEmit(F.ny, (f, r1) => emit([[f.r, f.a, f.b], [r1 + 1, f.a, f.b], [r1 + 1, f.a, f.b + 1], [f.r, f.a, f.b + 1]], f.c));
    mergeEmit(F.px, (f, r1) => emit([[f.a + 1, f.b, f.r], [f.a + 1, f.b + 1, f.r], [f.a + 1, f.b + 1, r1 + 1], [f.a + 1, f.b, r1 + 1]], f.c));
    mergeEmit(F.nx, (f, r1) => emit([[f.a, f.b, f.r], [f.a, f.b, r1 + 1], [f.a, f.b + 1, r1 + 1], [f.a, f.b + 1, f.r]], f.c));
    mergeEmit(F.pz, (f, r1) => emit([[f.r, f.b, f.a + 1], [r1 + 1, f.b, f.a + 1], [r1 + 1, f.b + 1, f.a + 1], [f.r, f.b + 1, f.a + 1]], f.c));
    mergeEmit(F.nz, (f, r1) => emit([[f.r, f.b, f.a], [f.r, f.b + 1, f.a], [r1 + 1, f.b + 1, f.a], [r1 + 1, f.b, f.a]], f.c));
  };
  const voxelGeometry = (vox, { unit, palette, origin = { x: 0, y: 0, z: 0 }, emissive = {} }) => {
    const geo = geometry();
    geo.voxel = new Float32Array([unit, origin.x, origin.y, origin.z]);
    const rgb = palette.map((c) => typeof c === "string" ? hexToRgb(c) : c);
    const emit = (pts, c) => {
      face(geo, pts.map(([x, y, z]) => pushVert(geo, origin.x + x * unit, origin.y + y * unit, origin.z + z * unit)), rgb[c], { emissive: emissive[c] || 0 });
    };
    voxelFaces((fn) => {
      for (const [k, c] of vox.map) {
        voxCoords(k, CELL);
        fn(CELL[0], CELL[1], CELL[2], c);
      }
    }, vox.has, emit);
    return geo;
  };
  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const shade = (hex, k) => hexToRgb(hex).map((v) => clamp255(v * k));
  const mixRgb = (a, b, t) => a.map((v, i) => clamp255(v + (b[i] - v) * t));
  const cached = (build) => {
    let value = null;
    return () => value || (value = build());
  };
  const variants = (build) => {
    const cache = [];
    return (i = 0) => cache[i] || (cache[i] = build(i));
  };
  const noShadow = (geo) => {
    geo.castShadow = false;
    return geo;
  };
  const BANANA_AMMO_SCALE = 0.34;
  // Full-shouldered profile hides the dead space between curved bananas without the old pointed silhouette.
  const BANANA_PILE_PROFILE = [[1, 0], [0.98, 0.11], [0.9, 0.31], [0.72, 0.53], [0.5, 0.7], [0.28, 0.82], [0.1, 0.87], [0, 0.88]];
  const bananaPileRadiusScale = (angle, radius) => {
    // fade keeps the foot of the mound circular, blending the lumpy silhouette in above it.
    const fade = Math.min(1, Math.max(0, (1 - radius) / 0.18));
    return 1 + fade * (-0.025
      + Math.sin(angle * 3 + radius * 5.7 + 0.4) * 0.012
      + Math.sin(angle * 5 - radius * 8.3 + 1.7) * 0.008
      + Math.sin(angle * 9 + radius * 13.1) * 0.004);
  };
  const bananaPileHeightOffset = (angle, radius) => {
    const fade = radius * (1 - radius) * 4;
    return fade * (Math.sin(angle * 2 + radius * 4.1) * 0.018
      + Math.sin(angle * 6 - radius * 7.3 + 0.8) * 0.009
      + Math.sin(angle * 11 + radius * 15.7) * 0.004);
  };
  const bananaGeometry = cached(() => tube({
    rings: 8,
    segments: 5,
    path: (t) => {
      const a = (t - 0.5) * 2;
      return { x: Math.sin(a) * 0.55, y: (1 - Math.cos(a)) * 0.55 + 0.1, z: 0 };
    },
    radius: (t) => 0.085 * Math.pow(Math.sin(Math.PI * t), 0.55) + 0.012,
    colorFn: (t) => t < 0.08 || t > 0.92 ? "#5a3a1a" : t < 0.2 || t > 0.8 ? "#c9b23a" : "#f5c542"
  }));
  const banana = () => createNode({ geometry: bananaGeometry() });
  const magazineBananaGeometry = cached(() => {
    const source = bananaGeometry();
    // Crop the hidden ends of each oversized indicator so a lower row cannot
    // stick past the magazine's narrower curve above it.
    return { ...source, verts: source.verts.map((v, i) => i % 3 === 0 ? Math.max(-0.3, Math.min(0.3, v)) : i % 3 === 1 ? Math.min(0.25, v) : v) };
  });
  // Deliberate near-duplicate of bananaGeometry: full depth and dimensions of a carried banana.
  // Its origin is recentred so pile tiles sit evenly across the mound surface.
  const bananaTileNearGeometry = cached(() => tube({
    rings: 8,
    segments: 5,
    path: (t) => {
      const a = (t - 0.5) * 2;
      return { x: Math.sin(a) * 0.55, y: (1 - Math.cos(a)) * 0.55 - 0.075, z: 0 };
    },
    radius: (t) => 0.085 * Math.pow(Math.sin(Math.PI * t), 0.55) + 0.012,
    colorFn: (t) => t < 0.08 || t > 0.92 ? "#5a3a1a" : t < 0.2 || t > 0.8 ? "#c9b23a" : "#f5c542"
  }));
  const bananaTileDistantGeometry = cached(() => {
    const source = bananaTileNearGeometry(), geo = geometry(), rings = [0, 1, 2, 4, 6, 7, 8];
    // Merge only the middle yellow spans; the tips and cross section stay exact.
    for (const ring of rings) for (let segment = 0; segment < 5; segment++) {
      const i = (ring * 5 + segment) * 3;
      geo.verts.push(source.verts[i], source.verts[i + 1], source.verts[i + 2]);
    }
    for (let p = 0; p < rings.length - 1; p++) for (let s = 0; s < 5; s++) {
      const next = (s + 1) % 5, original = source.faces[rings[p] * 5 + s];
      face(geo, [p * 5 + s, p * 5 + next, (p + 1) * 5 + next, (p + 1) * 5 + s], original.color, original);
    }
    return geo;
  });
  const bananaTileGeometry = (distant = false) => distant ? bananaTileDistantGeometry() : bananaTileNearGeometry();
  const bananaPileCoreGeometry = (worldRadius = 0.45, worldHeight = 0.48, faceSize = 0.16) => {
    const geo = geometry();
    const segments = Math.max(24, Math.min(384, Math.ceil(Math.PI * 2 * worldRadius / faceSize)));
    const profile = [];
    for (let i = 0; i < BANANA_PILE_PROFILE.length - 1; i++) {
      const outer = BANANA_PILE_PROFILE[i], inner = BANANA_PILE_PROFILE[i + 1];
      const length = Math.hypot((outer[0] - inner[0]) * worldRadius, (outer[1] - inner[1]) * worldHeight);
      const steps = Math.max(1, Math.ceil(length / faceSize));
      for (let step = 0; step < steps; step++) {
        const t = step / steps;
        profile.push([outer[0] + (inner[0] - outer[0]) * t, outer[1] + (inner[1] - outer[1]) * t]);
      }
    }
    // Golden panels so any backing visible between shell bananas still reads as part of the pile.
    const colors = ["#c9a21d", "#ddb72b", "#b98f14", "#e5c13a", "#d1aa22"].map(hexToRgb);
    const rings = profile.map(([radius, y], ringIndex) => {
      const ring = [];
      for (let segment = 0; segment < segments; segment++) {
        const angle = segment / segments * Math.PI * 2;
        const warpedRadius = radius * bananaPileRadiusScale(angle, radius);
        const warpedY = y + bananaPileHeightOffset(angle, radius);
        ring.push(pushVert(geo, Math.cos(angle) * warpedRadius, warpedY, Math.sin(angle) * warpedRadius));
      }
      return ring;
    });
    for (let ring = 0; ring < rings.length - 1; ring++) {
      for (let segment = 0; segment < segments; segment++) {
        const next = (segment + 1) % segments;
        const shadeIndex = Math.floor(Math.abs(Math.sin((segment + 1) * 12.9898 + (ring + 1) * 78.233)) * colors.length) % colors.length;
        face(geo, [rings[ring][segment], rings[ring + 1][segment], rings[ring + 1][next], rings[ring][next]], colors[shadeIndex]);
      }
    }
    const top = pushVert(geo, 0, BANANA_PILE_PROFILE[BANANA_PILE_PROFILE.length - 1][1], 0);
    const last = rings[rings.length - 1];
    for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments;
      face(geo, [last[segment], top, last[next]], colors[(segment + 3) % colors.length]);
    }
    geo.pileSegments = segments;
    geo.pileRings = rings.length;
    geo.pileFaceSize = faceSize;
    return geo;
  };
  const particleCache = new Map();
  const particleGeometry = (color, size = 0.07, emissive = 1) => {
    const key = `${color}/${size}/${emissive}`;
    let geo = particleCache.get(key);
    if (!geo) {
      geo = box({ w: size, h: size, d: size, color, emissive });
      geo.castShadow = false;
      particleCache.set(key, geo);
    }
    return geo;
  };
  const clubVoxels = (rand) => {
    const v = makeVox();
    const woodJ = () => rand() < 0.2 ? 1 : 0;
    v.fill(0, 1, 0, 4, 0, 1, woodJ);
    v.fill(-1, 2, 5, 7, -1, 2, woodJ);
    v.fill(-1, 2, 8, 10, -1, 2, woodJ);
    for (const [cx, cz] of [[-1, -1], [-1, 2], [2, -1], [2, 2]]) v.del(cx, 10, cz);
    return v;
  };
  const CLUB_PALETTE = [hexToRgb("#5c4425"), hexToRgb("#3f2e18")];
  const GOLD_CLUB_PALETTE = [hexToRgb("#e0b53a"), hexToRgb("#c99a2e")];
  const GUN_PALETTE = { body: "#3a3a3a", stock: "#5c4425", barrel: "#2b2b2b", emissive: 0 };
  const GOLD_GUN_PALETTE = { body: "#e0b53a", stock: "#5c4425", barrel: "#f0c95a", emissive: 0.25 };
  const appendMagazineShell = (pieces, h, pal) => {
    // Thin curved shell, with broad side cheeks framing a narrow window. The
    // large banana marks overlap inside it; the casing hides their cropped tips.
    for (let i = 0; i < 6; i++) {
      const y = (-0.09 - i * 0.035) * h, z = (0.045 + i * i * 0.0018) * h;
      for (const end of [-1, 1]) {
        pieces.push(box({ w: 0.065 * h, h: 0.038 * h, d: 0.02 * h, color: pal.body, offset: { y, z: z + end * 0.055 * h } }));
        for (const side of [-1, 1]) pieces.push(box({ w: 0.007 * h, h: 0.038 * h, d: 0.04 * h, color: pal.body, offset: { x: side * 0.029 * h, y, z: z + end * 0.045 * h } }));
      }
      if (!i || i === 5) pieces.push(box({ w: 0.065 * h, h: 0.021 * h, d: 0.13 * h, color: pal.body, offset: { y: y + (i ? -0.0195 : 0.0195) * h, z } }));
    }
  };
  const spareMagazineShell = cached(() => {
    const pieces = [];
    appendMagazineShell(pieces, 1, GUN_PALETTE);
    const geo = merge(...pieces);
    for (let i = 0; i < geo.verts.length; i += 3) { geo.verts[i + 1] += 0.1825; geo.verts[i + 2] -= 0.0675; }
    return geo;
  });
  const spareMagazine = () => {
    const node = createNode({ geometry: spareMagazineShell() }), bananas = [];
    for (let i = 0; i < 10; i++) {
      const curve = i * 5 / 9;
      const round = createNode({ geometry: magazineBananaGeometry(), position: { x: 0, y: 0.0762 - i * 0.02044, z: -0.0225 + curve * curve * 0.0018 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 }, scale: { x: 0.135, y: 0.175, z: 0.11 } });
      bananas.push(round); addChild(node, round);
    }
    let shown = 30;
    const setAmmo = (ammo) => {
      if (ammo === shown) return;
      shown = ammo;
      const filled = Math.round(ammo / 3);
      for (let i = 0; i < bananas.length; i++) bananas[i].visible = i < filled;
    };
    return { node, bananas, setAmmo };
  };
  const gunGeometry = (h, pal) => {
    const stock = box({ w: 0.085 * h, h: 0.13 * h, d: 0.28 * h, color: pal.stock, offset: { z: -0.37 * h } });
    for (let i = 0; i < stock.verts.length; i += 3) {
      const front = (stock.verts[i + 2] / h + 0.51) / 0.28;
      stock.verts[i] *= 1 - front * 0.12;
      stock.verts[i + 1] = stock.verts[i + 1] * (1 - front * 0.35) + (-0.04 + front * 0.025) * h;
    }
    // Keep the handguard just inside the receiver where they overlap, then
    // slope only its underside upward toward the barrel.
    const handguard = box({ w: 0.09 * h, h: 0.122 * h, d: 0.22 * h, color: pal.stock, offset: { z: 0.24 * h } });
    for (let i = 0; i < handguard.verts.length; i += 3) {
      if (handguard.verts[i + 1] < 0) handguard.verts[i + 1] += (handguard.verts[i + 2] / h - 0.13) / 0.22 * 0.02 * h;
    }
    // The upper gas tube meets the front of the wood and slopes into the barrel.
    const gasBlock = box({ w: 0.029 * h, h: 0.029 * h, d: Math.hypot(0.06, 0.05) * h, color: pal.barrel, emissive: pal.emissive });
    const angle = Math.atan2(0.05, 0.06), cos = Math.cos(angle), sin = Math.sin(angle);
    for (let i = 0; i < gasBlock.verts.length; i += 3) {
      const y = gasBlock.verts[i + 1], z = gasBlock.verts[i + 2];
      gasBlock.verts[i + 1] = y * cos - z * sin + 0.01 * h;
      gasBlock.verts[i + 2] = y * sin + z * cos + 0.46 * h;
    }
    // A compact rear blade with an open, half-round notch. Its top and the
    // front post define the first-person sight line.
    const rearSight = [box({ w: 0.042 * h, h: 0.004 * h, d: 0.014 * h, color: pal.barrel, offset: { y: 0.067 * h, z: -0.18 * h } })];
    for (let i = 0; i < 8; i++) {
      const low = 0.069 + i * 0.011 / 8, high = low + 0.011 / 8;
      const mid = (low + high) * 0.5;
      const inner = Math.sqrt(Math.max(0, 0.011 ** 2 - (mid - 0.08) ** 2));
      const width = 0.021 - inner;
      for (const side of [-1, 1]) rearSight.push(box({ w: width * h, h: (high - low) * h, d: 0.014 * h,
        color: pal.barrel, offset: { x: side * (0.021 + inner) * 0.5 * h, y: mid * h, z: -0.18 * h } }));
    }
    const pieces = [
      // Long receiver, tapered wooden stock, barrel and raised gas tube.
      box({ w: 0.11 * h, h: 0.13 * h, d: 0.4 * h, color: pal.body, emissive: pal.emissive, offset: { z: -0.035 * h } }),
      stock,
      box({ w: 0.09 * h, h: 0.14 * h, d: 0.02 * h, color: pal.barrel, offset: { z: -0.516 * h, y: -0.04 * h } }),
      handguard,
      box({ w: 0.035 * h, h: 0.035 * h, d: 0.38 * h, color: pal.barrel, emissive: pal.emissive, offset: { z: 0.47 * h, y: -0.01 * h } }),
      box({ w: 0.026 * h, h: 0.026 * h, d: 0.095 * h, color: pal.barrel, emissive: pal.emissive, offset: { z: 0.3925 * h, y: 0.035 * h } }),
      gasBlock,
      box({ w: 0.03 * h, h: 0.085 * h, d: 0.03 * h, color: pal.barrel, offset: { z: 0.59 * h, y: 0.0075 * h } }),
      ...rearSight,
      box({ w: 0.01 * h, h: 0.04 * h, d: 0.016 * h, color: pal.barrel, offset: { y: 0.07 * h, z: 0.59 * h } }),
      box({ w: 0.065 * h, h: 0.18 * h, d: 0.066 * h, color: pal.stock, offset: { y: -0.14 * h, z: -0.184 * h } }),
      // A hollow guard ends behind the magazine, leaving a visible gap.
      box({ w: 0.045 * h, h: 0.012 * h, d: 0.106 * h, color: pal.body, offset: { y: -0.13 * h, z: -0.098 * h } }),
      box({ w: 0.045 * h, h: 0.077 * h, d: 0.012 * h, color: pal.body, offset: { y: -0.0975 * h, z: -0.045 * h } }),
      box({ w: 0.045 * h, h: 0.077 * h, d: 0.012 * h, color: pal.body, offset: { y: -0.0975 * h, z: -0.151 * h } }),
      box({ w: 0.014 * h, h: 0.045 * h, d: 0.012 * h, color: pal.barrel, offset: { y: -0.083 * h, z: -0.112 * h } })
    ];
    appendMagazineShell(pieces, h, pal);
    return merge(...pieces);
  };
  // Re-axis a lathe to +z; the index reverse keeps the winding correct after the y/z swap.
  const forward = (geo, { x = 0, y = 0, z = 0 } = {}) => {
    const out = geometry();
    for (let v = 0; v < geo.verts.length; v += 3) out.verts.push(x + geo.verts[v], y + geo.verts[v + 2], z + geo.verts[v + 1]);
    out.faces = geo.faces.map((f) => ({ ...f, i: [...f.i].reverse() }));
    return out;
  };
  // Moves a freshly built geometry by (x, y, z), in place.
  const moved = (geo, x, y, z) => {
    const v = geo.verts;
    for (let i = 0; i < v.length; i += 3) { v[i] += x; v[i + 1] += y; v[i + 2] += z; }
    return geo;
  };
  // Turns a freshly built geometry about y, the way a node's rotation.y would.
  const turnedY = (geo, a) => {
    const v = geo.verts, c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i], z = v[i + 2];
      v[i] = x * c + z * s;
      v[i + 2] = -x * s + z * c;
    }
    return geo;
  };
  // Turns a freshly built geometry about z: a positive angle rolls +x toward +y.
  const turnedZ = (geo, a) => {
    const v = geo.verts, c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i], y = v[i + 1];
      v[i] = x * c - y * s;
      v[i + 1] = x * s + y * c;
    }
    return geo;
  };
  // A convex outline, counter-clockwise from the front, extruded `depth` thick about z 0.
  const prism = (points, depth, color, emissive = 0) => {
    const geo = geometry(), rgb = hexToRgb(color), opts = { emissive }, n = points.length;
    const back = points.map(([x, y]) => pushVert(geo, x, y, -depth / 2)), front = points.map(([x, y]) => pushVert(geo, x, y, depth / 2));
    for (let i = 0; i < n; i++) face(geo, [back[i], back[(i + 1) % n], front[(i + 1) % n], front[i]], rgb, opts);
    face(geo, front, rgb, opts);
    face(geo, back.slice().reverse(), rgb, opts);
    return geo;
  };
  // Tips a freshly built geometry about x: a positive angle leans its top toward +z.
  const turnedX = (geo, a) => {
    const v = geo.verts, c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < v.length; i += 3) {
      const y = v[i + 1], z = v[i + 2];
      v[i + 1] = y * c - z * s;
      v[i + 2] = y * s + z * c;
    }
    return geo;
  };
  // Resting club angles: x tilts the head forward, z rolls it; carry is the working hang.
  const CLUB_REST = { x: 0.95, z: 0 };
  // The shared body every contributor gets. A character file (src/characters/<handle>.js)
  // adds its own look through `dress` hooks, each called with the build kit `k` at a fixed
  // point, so the hashed jitter draws in the same order for every build:
  //   torso(k, v)  before the belly holes       club(k)      the left-hand item
  //   gun(k)       the rifle's look              gear(k)      arm and body attachments
  //   skull(k, v)  replaces the head block
  //   crown(k, v)  hats and hair over the head    eyes(k, v)   replaces the eyes
  //   mark(k, v)   face paint after the pupils    hatY(k)      where swag hats sit
  //   headgear(k)  nodes on the head              extras(k)    nodes on the root, last
  //   tint(k, palette)  a second colourway: return an alternate palette and every
  //                     voxel part is baked again under it, paired in `tint`
  // `look` flags read here: slim, bald, cleanShaven, wideEyes, hairless, noBrow, noPupils,
  // face ("nose" | "smirk" | "beard" | "none"), eyeColor, eyeGlow, hatY.
  const buildCaveman = (traits) => {
    const { skin, hair, height: h, belly, rand } = traits;
    const dress = traits.dress || {};
    const u = h / 16;
    const P = { skin: 0, skinDk: 1, hair: 2, hairDk: 3, fur: 4, spot: 5, white: 6, black: 7, nose: 8, stubble: 9, wood: 10, stone: 11, stoneDk: 12 };
    const palette = [
      shade(skin, 1),
      shade(skin, 0.9),
      shade(hair, 1),
      shade(hair, 0.85),
      shade(traits.fur, 1),
      hexToRgb("#4a2f16"),
      hexToRgb("#f2efe4"),
      hexToRgb("#141414"),
      shade(skin, 1.18),
      mixRgb(shade(skin, 1), [201, 194, 178], 0.55),
      hexToRgb("#5c4425"),
      hexToRgb("#7a7a7a"),
      hexToRgb("#565656")
    ];
    // A character's own colours join the palette on first use.
    const colors = new Map();
    const color = (hex) => {
      let c = colors.get(hex);
      if (c === undefined) {
        colors.set(hex, c = palette.length);
        palette.push(hexToRgb(hex));
      }
      return c;
    };
    const jit = (base, dark, p) => () => rand() < p ? dark : base;
    const skinJ = jit(P.skin, P.skinDk, 0.08);
    const hairJ = jit(P.hair, P.hairDk, 0.12);
    const leopard = jit(P.fur, P.spot, 0.05);
    const rosettes = (v, x0, x1, y0, y1, z0, z1, count) => {
      for (let i = 0; i < count; i++) {
        const x = x0 + Math.floor(rand() * (x1 - x0 + 1));
        const y = y0 + Math.floor(rand() * (y1 - y0 + 1));
        const z = z0 + Math.floor(rand() * (z1 - z0 + 1));
        if (v.get(x, y, z) === P.fur) v.set(x, y, z, P.spot);
        const nx = x + (rand() < 0.5 ? 1 : -1);
        if (v.get(nx, y, z) === P.fur) v.set(nx, y, z, P.spot);
      }
    };
    // Each voxel map is kept with what it was baked from, so a second colourway
    // can bake the same maps again under another palette.
    const bakes = [];
    const vg = (v, origin, emissive) => {
      const geo = voxelGeometry(v, { unit: u, palette, origin, emissive });
      bakes.push({ v, origin, emissive, geo });
      return geo;
    };
    const parts = {};
    const legH = 5 * u;
    const root = createNode({ position: { x: 0, y: legH, z: 0 } });
    const eyeCells = [];
    // nose: the beard's nose jitter pair; lid: closed-eye colour; headEmissive: lit head indices
    // loin: the loincloth's two colours, fur and spot unless a torso hook names its own.
    const k = { traits, h, u, rand, P, color, jit, skinJ, hairJ, leopard, vg, root, parts, armX: 0, eyeCells, nose: [P.nose, P.skin], lid: null, headEmissive: undefined, loin: null };
    // Hashed from the cell, never drawn from rand, so no character's existing draws move.
    const cellMix = (x, y, z) => ((Math.imul(x + 11, 73856093) ^ Math.imul(y + 7, 19349663) ^ Math.imul(z + 5, 83492791)) >>> 0) % 7;
    // The loincloth every Ooga wears: a flap front and back that hangs over the thighs, cut ragged at the hem.
    const loinFlaps = (v) => {
      const [a, b] = k.loin || [P.fur, P.spot];
      for (const z of [0, 5]) for (let x = 2; x <= 6; x++) {
        const hem = x === 2 || x === 6 ? -1 : cellMix(x, 0, z) < 2 ? -3 : -2;
        for (let y = -1; y >= hem; y--) v.set(x, y, z, cellMix(x, y, z) === 0 ? b : a);
      }
    };
    k.loinFlaps = loinFlaps;
    const legVox = (side) => {
      const v = makeVox();
      v.fill(0, 3, 2, 4, 0, 3, skinJ);
      v.fill(0, 3, 0, 1, 0, 5, skinJ);
      // Mirror the toes so each pair starts at the foot's inner edge.
      v.set(side < 0 ? 3 : 0, 0, 6, P.skin);
      v.set(side < 0 ? 1 : 2, 0, 6, P.skin);
      return v;
    };
    const leg = (side) => createNode({ position: { x: side * 2.5 * u, y: 0, z: 0 }, geometry: vg(legVox(side), { x: -2 * u, y: -5 * u, z: -2.5 * u }) });
    // Facing +Z, local -X is anatomical right and +X is anatomical left.
    parts.legR = leg(-1);
    parts.legL = leg(1);
    const torsoVox = () => {
      const v = makeVox();
      if (traits.slim) {
        v.fill(0, 8, 0, 2, 0, 5, leopard);
        v.fill(1, 7, 3, 7, 1, 4, leopard);
        rosettes(v, 0, 8, 0, 7, 0, 5, 12);
      } else {
        v.fill(0, 8, 0, 2, 0, 5, leopard);
        rosettes(v, 0, 8, 0, 2, 0, 5, 8);
        v.fill(1, 7, 3, 7, 1, 4, skinJ);
        // A hide belt with a stone buckle, and a fur strap over one shoulder to the other hip.
        v.fill(1, 7, 3, 3, 1, 4, P.wood);
        v.set(4, 3, 4, P.stone);
        for (let y = 4; y <= 7; y++) {
          const x = 7 - Math.round((y - 4) * 1.6);
          for (const z of [1, 4]) for (const dx of [0, 1]) if (x + dx >= 1 && x + dx <= 7) v.set(x + dx, y, z, cellMix(x + dx, y, z) === 0 ? P.spot : P.fur);
        }
      }
      if (dress.torso) dress.torso(k, v);
      for (let x = 0; x <= 8; x++) for (let z = 0; z <= 5; z++) if (rand() < 0.18) v.del(x, 0, z);
      loinFlaps(v);
      return v;
    };
    parts.torso = createNode({ scale: { x: belly, y: 1, z: belly }, geometry: vg(torsoVox(), { x: -4.5 * u, y: 0, z: -3 * u }) });
    const armVox = () => {
      const v = makeVox();
      v.fill(0, 2, 2, 7, 0, 2, skinJ);
      if (traits.slim) {
        v.fill(0, 2, 8, 10, 0, 2, leopard);
        rosettes(v, 0, 2, 8, 10, 0, 2, 2);
      } else {
        v.fill(-1, 3, 8, 10, -1, 3, skinJ);
      }
      v.fill(-1, 3, 0, 1, -1, 3, skinJ);
      return v;
    };
    // A fixed pair sits on one square palm side and rotates with the arm.
    const fingerVox = makeVox();
    fingerVox.set(0, 1, 4, P.skin);
    fingerVox.set(2, 1, 4, P.skin);
    const fingerGeometry = vg(fingerVox, { x: -1.5 * u, y: -u, z: -1.5 * u });
    const armX = k.armX = 0.29 * h * belly + 0.09 * h;
    const arm = (side) => {
      const node = createNode({
        position: { x: side * armX, y: 0.46 * h, z: 0 },
        rotation: { x: -0.2, y: 0, z: side * 0.1 },
        geometry: vg(armVox(), { x: -1.5 * u, y: -11 * u, z: -1.5 * u })
      });
      const fingers = createNode({ position: { x: 0, y: -10 * u, z: 0 }, geometry: fingerGeometry, quaternion: BL.math.quat.create() });
      BL.math.quat.fromEuler(fingers.quaternion, 0, -side * Math.PI / 2, 0);
      parts[side < 0 ? "fingersR" : "fingersL"] = fingers;
      addChild(node, fingers);
      return node;
    };
    parts.armR = arm(-1);
    parts.armL = arm(1);
    // club(k) returns { voxels, palette, goldPalette } for a voxel item, or { default, gold }
    // geometry, plus optional rest and carry angles.
    const club = dress.club ? dress.club(k) : {};
    const clubV = club.voxels || clubVoxels(rand);
    const clubOrigin = { x: -1 * u, y: -1 * u, z: -1 * u };
    const clubRest = club.rest || CLUB_REST, clubCarry = club.carry || clubRest;
    // gun(k) returns { default, gold } geometry in the rifle's own space: the same grip, sights,
    // muzzle (z 0.67 h) and magazine, since shots and the ammo bananas keep them;
    // `magazine: false` leaves the magazine off and hangs no ammo bananas.
    const gun = dress.gun ? dress.gun(k) : {};
    const skins = {
      club: club.default ? { default: club.default, gold: club.gold }
        : { default: voxelGeometry(clubV, { unit: u, palette: club.palette || CLUB_PALETTE, origin: clubOrigin }), gold: voxelGeometry(clubV, { unit: u, palette: club.goldPalette || GOLD_CLUB_PALETTE, origin: clubOrigin }) },
      gun: gun.default ? { default: gun.default, gold: gun.gold, magazine: gun.magazine !== false } : { default: gunGeometry(h, GUN_PALETTE), gold: gunGeometry(h, GOLD_GUN_PALETTE), magazine: true }
    };
    parts.club = createNode({
      position: { x: 0, y: -0.62 * h, z: 0.08 * h },
      rotation: { x: clubRest.x, y: 0, z: clubRest.z },
      geometry: skins.club.default
    });
    addChild(parts.armR, parts.club);
    parts.snack = createNode({
      position: { x: 0, y: -0.62 * h, z: 0.18 * h },
      scale: { x: BANANA_AMMO_SCALE, y: BANANA_AMMO_SCALE, z: BANANA_AMMO_SCALE },
      rotation: { x: 0.4, y: 0, z: 1.2 },
      geometry: bananaGeometry(),
      visible: false
    });
    addChild(parts.armL, parts.snack);
    parts.gun = createNode({ quaternion: BL.math.quat.create(), visible: false });
    parts.gun.ammoReloading = false;
    parts.gunBody = createNode({ geometry: skins.gun.default });
    addChild(parts.gun, parts.gunBody);
    parts.gunBananas = [];
    if (gun.magazine !== false) for (let i = 0; i < 9; i++) {
      const curve = i * 5 / 8;
      const round = createNode({ geometry: magazineBananaGeometry(), position: { x: 0, y: (-0.1063 - i * 0.023) * h, z: (0.045 + curve * curve * 0.0018) * h }, rotation: { x: 0, y: Math.PI / 2, z: 0 }, scale: { x: 0.135 * h, y: 0.175 * h, z: 0.11 * h } });
      round.ammoPopAt = -Infinity;
      parts.gunBananas.push(round);
      addChild(parts.gun, round);
    }
    addChild(root, parts.gun);
    if (dress.gear) dress.gear(k);
    const headVox = makeVox();
    {
      const v = headVox;
      if (!(dress.skull && dress.skull(k, v))) {
        v.fill(0, 6, 0, 5, 0, 5, skinJ);
        v.fill(1, 5, 0, 1, 6, 6, skinJ);
      }
      const face = traits.face || (traits.slim || traits.cleanShaven ? "nose" : "beard");
      if (face === "nose") {
        v.fill(3, 3, 2, 3, 6, 6, P.nose);
        // A mouth under it, so a shaven face has an expression.
        v.fill(2, 4, 0, 0, 5, 5, P.spot);
      } else if (face === "smirk") {
        v.set(3, 1, 6, P.nose);
        v.fill(2, 4, 0, 0, 6, 6, P.spot);
      } else if (face === "beard") {
        v.fill(0, 6, 0, 1, 5, 7, jit(P.hair, P.stubble, 0.25));
        v.fill(1, 5, -2, -1, 5, 7, (x, y) => y === -2 && rand() < 0.35 ? null : rand() < 0.15 ? P.hairDk : P.hair);
        v.set(1, 0, 7, P.white);
        v.set(5, 0, 7, P.white);
        v.fill(2, 4, 2, 3, 6, 7, jit(k.nose[0], k.nose[1], 0.25));
      }
      if (!traits.noBrow) v.fill(0, 6, 4, 4, 6, 6, hairJ);
      const hairy = !traits.bald && !traits.hairless;
      if (hairy) {
        v.fill(-1, 7, 6, 8, -1, 6, hairJ);
        v.fill(-1, 7, traits.slim ? -5 : -2, 5, -2, -1, hairJ);
        v.fill(-1, -1, traits.slim ? -3 : 2, 5, -1, 4, hairJ);
        v.fill(7, 7, traits.slim ? -3 : 2, 5, -1, 4, hairJ);
      }
      // Ears on a bare head; hair covers them otherwise.
      if (!hairy && !dress.skull) for (const x of [-1, 7]) v.fill(x, x, 2, 3, 2, 3, P.skinDk);
      if (dress.crown) dress.crown(k, v);
      for (const [key, c] of [...v.map]) {
        if (c !== P.hair && c !== P.hairDk) continue;
        voxCoords(key, CELL);
        const x = CELL[0], y = CELL[1], z = CELL[2];
        const exposed = !v.has(x + 1, y, z) || !v.has(x - 1, y, z) || !v.has(x, y, z + 1) || !v.has(x, y, z - 1) || !v.has(x, y + 1, z);
        if (exposed && rand() < 0.07) v.del(x, y, z);
      }
      if (hairy) {
        for (let x = 0; x <= 6; x++) for (let z = 0; z <= 5; z++) if (rand() < 0.08) v.set(x, 9, z, rand() < 0.5 ? P.hair : P.hairDk);
      }
      if (!(dress.eyes && dress.eyes(k, v))) {
        const eye = traits.eyeColor ? color(traits.eyeColor) : P.white;
        if (traits.eyeGlow) k.headEmissive = { [eye]: traits.eyeGlow };
        const eyes = traits.wideEyes ? [[0, 2], [4, 6]] : [[0, 1], [5, 6]];
        const eyeY0 = traits.wideEyes ? 1 : 2, eyeY1 = traits.wideEyes ? 4 : 3;
        for (const [ex0, ex1] of eyes) {
          for (let x = ex0; x <= ex1; x++) for (let y = eyeY0; y <= eyeY1; y++) {
            v.set(x, y, 5, eye);
            eyeCells.push([x, y]);
          }
        }
      }
      if (!traits.noPupils) {
        v.set(1, 2, 5, P.black);
        v.set(5, 2, 5, P.black);
      }
      if (dress.mark) dress.mark(k, v);
    }
    const headOrigin = { x: -3.5 * u, y: 0, z: -3 * u };
    // Dress hooks define any glowing face cells for both the head and portrait.
    const headEmissive = k.headEmissive;
    const headOpen = vg(headVox, headOrigin, headEmissive);
    // Each character may widen the central-face crop to retain a hat or hair.
    // Bounds are in the same voxel coordinates as the character's head hooks.
    const portraitVox = makeVox();
    const portraitMin = traits.portrait?.min || [0, -2, 0];
    const portraitMax = traits.portrait?.max || [6, 5, 8];
    for (const [k, c] of headVox.map) {
      voxCoords(k, CELL);
      const x = CELL[0], y = CELL[1], z = CELL[2];
      if (x >= portraitMin[0] && x <= portraitMax[0] && y >= portraitMin[1] && y <= portraitMax[1] && z >= portraitMin[2] && z <= portraitMax[2]) portraitVox.map.set(k, c);
    }
    const portraitHead = vg(portraitVox, headOrigin, headEmissive);
    const closedVox = makeVox();
    for (const [key, c] of headVox.map) closedVox.map.set(key, c);
    for (const [x, y] of eyeCells) closedVox.set(x, y, 5, k.lid !== null ? k.lid : y === 2 ? P.skinDk : P.skin);
    const headClosed = vg(closedVox, headOrigin, k.headEmissive);
    parts.head = createNode({ position: { x: 0, y: 0.5 * h, z: 0.02 * h }, geometry: headOpen });
    const hatY = dress.hatY ? dress.hatY(k) : (traits.hatY || (traits.bald ? 6 : 9)) * u;
    parts.hat = createNode({ position: { x: 0, y: hatY, z: 0 }, scale: { x: h, y: h, z: h }, visible: false });
    parts.hat.portraitHidden = true;
    parts.face = createNode({ position: { x: 0, y: 0, z: 0 }, scale: { x: h, y: h, z: h }, visible: false });
    addChild(parts.head, parts.hat, parts.face);
    if (dress.headgear) dress.headgear(k);
    addChild(root, parts.legR, parts.legL, parts.torso, parts.armR, parts.armL, parts.head);
    if (dress.extras) dress.extras(k);
    // A second colourway bakes every voxel part still in use under the alternate
    // palette and pairs each geometry with its twin both ways, so swapping a
    // clone's geometry twice returns it to the colour it was built in.
    let tint = null;
    if (dress.tint) {
      const alt = dress.tint(k, palette), live = new Set([headClosed, portraitHead]);
      const visit = (node) => {
        if (node.geometry) live.add(node.geometry);
        for (const child of node.children) visit(child);
      };
      visit(root);
      tint = new Map();
      for (const bake of bakes) {
        if (!live.has(bake.geo) || tint.has(bake.geo)) continue;
        const twin = voxelGeometry(bake.v, { unit: u, palette: alt, origin: bake.origin, emissive: bake.emissive });
        tint.set(bake.geo, twin).set(twin, bake.geo);
      }
    }
    return { root, parts, traits, headOffset: 1.1 * h, headOpen, headClosed, portraitHead, skins, clubRest, clubCarry, tint, gunHeadBounds: BL.scene.boundsOf(headOpen) };
  };
  // Traits hash from the handle, so one handle always builds the same voxels.
  // Callers get fresh nodes over shared geometry: one build per contributor, GPU records survive a scene swap.
  const cavemen = new Map();
  const cloneNode = (node, copies) => {
    const copy = createNode({ ...node, position: { ...node.position }, rotation: { ...node.rotation }, scale: { ...node.scale }, parent: null, children: [], world: new Float32Array(node.world), local: new Float32Array(node.local) });
    if (node.quaternion) copy.quaternion = new Float32Array(node.quaternion);
    copies.set(node, copy);
    for (const child of node.children) addChild(copy, cloneNode(child, copies));
    return copy;
  };
  const caveman = (traits) => {
    let template = cavemen.get(traits.name);
    if (!template) cavemen.set(traits.name, template = buildCaveman(traits));
    const copies = new Map(), root = cloneNode(template.root, copies), parts = {};
    for (const key of Object.keys(template.parts)) {
      const part = template.parts[key];
      parts[key] = Array.isArray(part) ? part.map((node) => copies.get(node)) : copies.get(part);
    }
    const skins = { club: { ...template.skins.club }, gun: { ...template.skins.gun } };
    return { root, parts, traits, headOffset: template.headOffset, headOpen: template.headOpen, headClosed: template.headClosed, portraitHead: template.portraitHead, skins, clubRest: template.clubRest, clubCarry: template.clubCarry, tint: template.tint, gunHeadBounds: template.gunHeadBounds };
  };
  // A real die: opposite faces sum to seven. Round pip faces sit just above the
  // voxel shell so even the smallest die does not render them as square cells.
  const DIE_PIPS = [[], [[2, 2]], [[1, 1], [3, 3]], [[1, 1], [2, 2], [3, 3]],
    [[1, 1], [1, 3], [3, 1], [3, 3]], [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
    [[1, 1], [1, 2], [1, 3], [3, 1], [3, 2], [3, 3]]];
  const die = ({ size = 0.3, variant = null } = {}) => {
    const n = 5, u = size / n;
    const v = makeVox();
    v.fill(0, n - 1, 0, n - 1, 0, n - 1, 0);
    for (const cx of [0, n - 1]) for (const cy of [0, n - 1]) for (const cz of [0, n - 1]) v.del(cx, cy, cz);
    const dots = geometry(), ink = hexToRgb("#141414"), radius = u * 0.43;
    const values = variant === null ? [1, 6, 2, 5, 4, 3] :
      [6 - (variant + 1) % 6, (variant + 1) % 6 + 1, 6 - (variant + 2) % 6,
        (variant + 2) % 6 + 1, 6 - variant % 6, variant % 6 + 1];
    const pip = (axis, side, a, b) => {
      const ids = [], fixed = side * size * 0.506;
      const ca = (a + 0.5) * u - size / 2, cb = (b + 0.5) * u - size / 2;
      for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6, p = ca + Math.cos(angle) * radius, q = cb + Math.sin(angle) * radius;
        ids.push(axis === 0 ? pushVert(dots, fixed, p, q) : axis === 1 ? pushVert(dots, p, fixed, q) : pushVert(dots, p, q, fixed));
      }
      face(dots, (axis === 1 ? -side : side) < 0 ? ids.reverse() : ids, ink);
    };
    for (let axis = 0; axis < 3; axis++) for (let side = -1; side <= 1; side += 2) {
      const value = values[axis * 2 + (side > 0 ? 1 : 0)];
      for (const [a, b] of DIE_PIPS[value]) pip(axis, side, a, b);
    }
    return merge(voxelGeometry(v, { unit: u, palette: [hexToRgb("#f3efe4")], origin: { x: -size / 2, y: -size / 2, z: -size / 2 } }), dots);
  };
  const dieRotationFor = (pips, spin) => ({
    5: { x: 0, y: spin, z: 0 },
    2: { x: Math.PI, y: spin, z: 0 },
    3: { x: -Math.PI / 2, y: 0, z: spin },
    4: { x: Math.PI / 2, y: 0, z: spin },
    6: { x: 0, y: spin, z: Math.PI / 2 },
    1: { x: 0, y: spin, z: -Math.PI / 2 }
  })[pips];
  const playingCard = ({ red = false } = {}) => merge(
    box({ w: 0.26, h: 0.014, d: 0.38, color: "#292929" }),
    box({ w: 0.05, h: 8e-3, d: 0.06, color: "#eeeeee", offset: { x: -0.08, y: 0.01, z: -0.12 } }),
    box({ w: 0.08, h: 8e-3, d: 0.09, color: red ? "#ef7468" : "#eeeeee", offset: { y: 0.01, z: 0.04 } }),
    box({ w: 0.2, h: 8e-3, d: 0.3, color: "#8f231b", offset: { y: -0.01 } })
  );
  const ABACUS_RODS = 3;
  const EARTH_BEADS = 4;
  const BEAD_PITCH = 0.13;
  const DIVIDER_X = 0.2;
  const abacus = () => {
    const frame = "#5c4425";
    const node = createNode();
    const frameGeo = merge(
      box({ w: 0.08, h: 1.3, d: 0.1, color: frame, offset: { x: -0.55, y: 0.65 } }),
      box({ w: 0.08, h: 1.3, d: 0.1, color: frame, offset: { x: 0.55, y: 0.65 } }),
      box({ w: 1.18, h: 0.08, d: 0.1, color: frame, offset: { y: 1.31 } }),
      box({ w: 1.18, h: 0.08, d: 0.1, color: frame, offset: { y: 0.04 } }),
      box({ w: 0.04, h: 1.22, d: 0.08, color: "#3f2e18", offset: { x: DIVIDER_X, y: 0.65 } }),
      ...Array.from({ length: ABACUS_RODS }, (_, rod) => box({ w: 1.02, h: 0.03, d: 0.03, color: "#3a3a3a", offset: { y: 0.34 + rod * 0.34 } }))
    );
    addChild(node, createNode({ geometry: frameGeo }));
    const beadColors = ["#d8892b", "#6f9fca", "#22c55e"];
    const beadGeos = beadColors.map((color) => box({ w: 0.1, h: 0.11, d: 0.09, color }));
    const rods = [];
    for (let rod = 0; rod < ABACUS_RODS; rod++) {
      const y = 0.34 + rod * 0.34;
      const earth = [];
      for (let b = 0; b < EARTH_BEADS; b++) {
        const bead = createNode({ position: { x: -0.46 + b * BEAD_PITCH, y, z: 0 }, geometry: beadGeos[rod] });
        bead.targetX = bead.position.x;
        earth.push(bead);
        addChild(node, bead);
      }
      const heaven = createNode({ position: { x: 0.46, y, z: 0 }, geometry: beadGeos[rod] });
      heaven.targetX = heaven.position.x;
      addChild(node, heaven);
      rods.push({ earth, heaven });
    }
    const setValue = (value) => {
      let v = Math.max(0, Math.min(999, Math.floor(value)));
      for (let rod = 0; rod < ABACUS_RODS; rod++) {
        const digit = v % 10;
        v = Math.floor(v / 10);
        const pushed = digit % 5;
        rods[rod].earth.forEach((bead, b) => {
          const againstDivider = b >= EARTH_BEADS - pushed;
          bead.targetX = againstDivider ? DIVIDER_X - 0.08 - (EARTH_BEADS - 1 - b) * BEAD_PITCH : -0.46 + b * BEAD_PITCH;
        });
        rods[rod].heaven.targetX = digit >= 5 ? DIVIDER_X + 0.09 : 0.46;
      }
    };
    const update = (dt) => {
      for (const { earth, heaven } of rods) {
        for (const bead of earth) bead.position.x = damp(bead.position.x, bead.targetX, 9, dt);
        heaven.position.x = damp(heaven.position.x, heaven.targetX, 9, dt);
      }
    };
    return { node, setValue, update };
  };
  const labRoom = ({ half = 8, wallH = 4.6, bedrollCount = 12 } = {}) => {
    const room = createNode();
    const leds = [];
    const equipment = { racks: [], flasks: [], dice: [], cards: [] };
    const floorGeo = panel({ w: half * 2, h: half * 2, tilesX: 10, tilesY: 10, color: "#26262a", altColor: "#202024" });
    addChild(room, createNode({ rotation: { x: -Math.PI / 2, y: 0, z: 0 }, geometry: floorGeo, depthBias: 1.2 }));
    const gridGeo = geometry();
    const gridRgb = hexToRgb("#2c2c2f");
    for (let i = -half; i <= half; i += 2) {
      const a = pushVert(gridGeo, i, 0.012, -half), b = pushVert(gridGeo, i, 0.012, half);
      gridGeo.lines.push({ i: [a, b], color: gridRgb, emissive: 0.15 });
      const c = pushVert(gridGeo, -half, 0.012, i), d = pushVert(gridGeo, half, 0.012, i);
      gridGeo.lines.push({ i: [c, d], color: gridRgb, emissive: 0.15 });
    }
    gridGeo.lineWidth = 1.2;
    addChild(room, createNode({ geometry: gridGeo, depthBias: 1 }));
    const wallGeo = panel({ w: half * 2, h: wallH, tilesX: 10, tilesY: 3, color: "#232326", altColor: "#212124" });
    const skirtGeo = box({ w: half * 2, h: 0.18, d: 0.06, color: "#2e2e32", offset: { y: 0.09, z: 0.03 } });
    const wallAt = (x, z, ry) => {
      const wall = createNode({ position: { x, y: 0, z }, rotation: { x: 0, y: ry, z: 0 } });
      addChild(wall, createNode({ position: { x: 0, y: wallH / 2, z: 0 }, geometry: wallGeo, depthBias: 1.1 }), createNode({ geometry: skirtGeo }));
      return wall;
    };
    addChild(room, wallAt(0, -half, 0), wallAt(-half, 0, Math.PI / 2), wallAt(half, 0, -Math.PI / 2), wallAt(0, half, Math.PI));
    const ceilingGeo = panel({ w: half * 2, h: half * 2, tilesX: 6, tilesY: 6, color: "#151517", altColor: "#131315" });
    ceilingGeo.castShadow = false;
    addChild(room, createNode({ position: { x: 0, y: wallH, z: 0 }, rotation: { x: Math.PI / 2, y: 0, z: 0 }, geometry: ceilingGeo }));
    const lampGeo = box({ w: 1.6, h: 0.06, d: 0.5, color: "#f1e6c8", emissive: 0.85 });
    lampGeo.castShadow = false;
    for (const [lx, lz] of [[-5, -4], [5, -4], [-5, 4], [5, 4]]) addChild(room, createNode({ position: { x: lx, y: wallH - 0.04, z: lz }, geometry: lampGeo }));
    const hatchFrameGeo = merge(
      box({ w: 1.7, h: 0.1, d: 0.12, color: "#3a3a3e", offset: { z: -0.79 } }),
      box({ w: 1.7, h: 0.1, d: 0.12, color: "#3a3a3e", offset: { z: 0.79 } }),
      box({ w: 0.12, h: 0.1, d: 1.7, color: "#3a3a3e", offset: { x: -0.79 } }),
      box({ w: 0.12, h: 0.1, d: 1.7, color: "#3a3a3e", offset: { x: 0.79 } })
    );
    hatchFrameGeo.castShadow = false;
    const flapGeo = box({ w: 0.72, h: 0.06, d: 1.46, color: "#2a2a2e", offset: { x: 0.36 } });
    flapGeo.castShadow = false;
    const hatch = createNode({ position: { x: 0, y: wallH - 0.06, z: 0 } });
    const flapL = createNode({ position: { x: -0.73, y: 0, z: 0 }, geometry: flapGeo, rotation: { x: 0, y: Math.PI, z: 0 } });
    const flapR = createNode({ position: { x: 0.73, y: 0, z: 0 }, geometry: flapGeo });
    addChild(hatch, createNode({ geometry: hatchFrameGeo }), flapL, flapR);
    addChild(room, hatch);
    const setHatch = (k) => {
      flapL.rotation.z = -k * 1.35;
      flapR.rotation.z = k * 1.35;
    };
    const ledColors = ["#22c55e", "#d8892b", "#6f9fca"];
    const rackGeo = cached(() => {
      const rackParts = [
        box({ w: 1.7, h: 3.1, d: 0.8, color: "#1b1d1f", offset: { y: 1.61 } }),
        box({ w: 1.8, h: 0.1, d: 0.9, color: "#2a2c2f", offset: { y: 3.21 } }),
        box({ w: 1.8, h: 0.12, d: 0.9, color: "#2a2c2f", offset: { y: 0.06 } }),
        box({ w: 0.08, h: 2.95, d: 0.06, color: "#35383b", offset: { x: -0.74, y: 1.61, z: 0.4 } }),
        box({ w: 0.08, h: 2.95, d: 0.06, color: "#35383b", offset: { x: 0.74, y: 1.61, z: 0.4 } })
      ];
      for (let unit = 0; unit < 8; unit++) {
        const uy = 0.42 + unit * 0.34;
        rackParts.push(
          box({ w: 1.36, h: 0.26, d: 0.06, color: unit % 2 ? "#26282b" : "#202224", offset: { y: uy, z: 0.41 } }),
          box({ w: 0.55, h: 0.1, d: 0.02, color: "#0d0e0e", offset: { x: -0.28, y: uy, z: 0.45 } })
        );
      }
      return merge(...rackParts);
    });
    const ledGeos = ledColors.map((color) => box({ w: 0.07, h: 0.05, d: 0.02, color, emissive: 1 }));
    for (let r = 0; r < 3; r++) {
      const rx = -3.4 + r * 3.4;
      const rack = createNode({ position: { x: rx, y: 0, z: -half + 0.6 }, geometry: rackGeo() });
      addChild(room, rack);
      const rackLeds = [];
      for (let unit = 0; unit < 8; unit++) {
        const led = createNode({ position: { x: rx + 0.44, y: 0.45 + unit * 0.34, z: -half + 1.07 }, geometry: ledGeos[(r + unit) % 3] });
        led.ledGeos = ledGeos;
        leds.push(led);
        rackLeds.push(led);
        addChild(room, led);
      }
      equipment.racks.push({ node: rack, leds: rackLeds, index: r });
    }
    const bench = createNode({ position: { x: half - 1.6, y: 0, z: 1.5 } });
    const slab = ({ w, d, h = 0.12, color, sx = 1, sz = 1 }) => merge(
      ...[].concat(...Array.from({ length: sx }, (_, ix) => Array.from({ length: sz }, (_2, iz) => box({
        w: w / sx,
        h,
        d: d / sz,
        color,
        offset: { x: (ix + 0.5) * (w / sx) - w / 2, z: (iz + 0.5) * (d / sz) - d / 2 }
      }))))
    );
    addChild(bench, createNode({ position: { y: 1.02, x: 0, z: 0 }, geometry: slab({ w: 1.3, d: 3.4, color: "#2a2a2d", sz: 6 }) }));
    for (const dz of [-1.5, 1.5]) addChild(bench, createNode({ position: { x: 0, y: 0.5, z: dz }, geometry: box({ w: 1.1, h: 1, d: 0.14, color: "#202022" }) }));
    ["#22c55e", "#6f9fca", "#d8892b"].forEach((liquid, i) => {
      const level = [0.10, 0.17, 0.13][i];
      const flask = createNode({
        position: { x: 0, y: 1.13, z: -0.8 + i * 0.8 },
        geometry: glassVessel({
          liquidProfile: [[0, 0], [0.19, 0.02], [0.20, level], [0, level]],
          glassProfile: [[0.21, 0.02], [0.24, 0.14], [0.23, 0.17], [0.1, 0.34], [0.06, 0.52],
            [0.08, 0.56], [0.055, 0.56], [0.045, 0.52], [0.085, 0.34], [0.205, 0.17], [0.19, 0.02]],
          liquid
        })
      });
      flask.color = liquid;
      attachGlassShell(flask);
      leds.push(flask);
      equipment.flasks.push(flask);
      addChild(bench, flask);
    });
    equipment.bench = bench;
    addChild(room, bench);
    const desk = createNode({ position: { x: -6.8, y: 0, z: -half + 0.75 } });
    addChild(desk, createNode({ position: { x: 0, y: 1, z: 0 }, geometry: slab({ w: 2.2, d: 1, h: 0.1, color: "#2a2a2d", sx: 4, sz: 2 }) }));
    for (const [lx, lz] of [[-1, -0.4], [1, -0.4], [-1, 0.4], [1, 0.4]]) addChild(desk, createNode({ geometry: box({ w: 0.12, h: 0.95, d: 0.12, color: "#1c1c1e", offset: { x: lx, y: 0.475, z: lz } }) }));
    const monitor = createNode({
      position: { x: -0.2, y: 1.05, z: -0.15 },
      geometry: merge(
        box({ w: 0.5, h: 0.05, d: 0.35, color: "#1e2320", offset: { y: 0.025 } }),
        box({ w: 0.08, h: 0.28, d: 0.08, color: "#1e2320", offset: { y: 0.19 } }),
        box({ w: 1.1, h: 0.72, d: 0.08, color: "#1e2320", offset: { y: 0.66 } }),
        box({ w: 0.96, h: 0.58, d: 0.02, color: "#1c4a2c", emissive: 0.9, offset: { y: 0.66, z: 0.045 } })
      )
    });
    leds.push(monitor);
    equipment.monitor = monitor;
    addChild(desk, monitor);
    addChild(desk, createNode({ geometry: box({ w: 0.8, h: 0.05, d: 0.3, color: "#252527", offset: { x: -0.1, y: 1.08, z: 0.28 } }) }));
    const tower = createNode({
      position: { x: 0.85, y: 0, z: 0 },
      geometry: merge(
        box({ w: 0.45, h: 0.85, d: 0.8, color: "#202022", offset: { y: 0.425 } }),
        box({ w: 0.05, h: 0.05, d: 0.02, color: "#22c55e", emissive: 1, offset: { x: 0.12, y: 0.7, z: 0.41 } })
      )
    });
    leds.push(tower);
    equipment.tower = tower;
    addChild(desk, tower);
    addChild(desk, createNode({
      position: { x: -0.2, y: 0, z: 1.1 },
      geometry: merge(box({ w: 0.5, h: 0.08, d: 0.5, color: "#2e2724", offset: { y: 0.55 } }), box({ w: 0.1, h: 0.55, d: 0.1, color: "#1c1c1e", offset: { y: 0.26 } }))
    }));
    equipment.desk = desk;
    addChild(room, desk);
    const cardTable = createNode({ position: { x: 5.2, y: 0, z: 4.4 }, rotation: { x: 0, y: 0.4, z: 0 } });
    addChild(
      cardTable,
      createNode({ position: { x: 0, y: 0.55, z: 0 }, geometry: slab({ w: 1.3, d: 0.9, h: 0.1, color: "#2a2a2d", sx: 3, sz: 2 }) }),
      createNode({ geometry: box({ w: 0.16, h: 0.5, d: 0.16, color: "#1c1c1e", offset: { y: 0.25 } }) })
    );
    const cardGeos = { red: playingCard({ red: true }), black: playingCard({ red: false }) };
    [[-0.35, 0.15, 0.3, false], [-0.05, -0.12, 0.9, true], [0.3, 0.1, 1.6, false]].forEach(([cx, cz, ry, red]) => {
      const card = createNode({ position: { x: cx, y: 0.61, z: cz }, rotation: { x: 0, y: ry, z: 0 }, geometry: cardGeos[red ? "red" : "black"] });
      equipment.cards.push(card);
      addChild(cardTable, card);
    });
    const dieGeos = { small: die({ size: 0.16 }), medium: die({ size: 0.26 }), large: die({ size: 0.4 }) };
    for (const [px, pz, ry] of [[0.42, -0.25, 0.9], [0.16, -0.3, 2.2]]) {
      const d = createNode({ position: { x: px, y: 0.61 + 0.08, z: pz }, rotation: { x: 0, y: ry, z: 0 }, geometry: dieGeos.small });
      d.dieSize = 0.16;
      equipment.dice.push(d);
      addChild(cardTable, d);
    }
    equipment.cardTable = cardTable;
    addChild(room, cardTable);
    const floorDice = [
      createNode({ position: { x: 3.4, y: 0.2, z: 5.3 }, rotation: { x: 0, y: 1.1, z: 0 }, geometry: dieGeos.large }),
      createNode({ position: { x: 4.5, y: 0.13, z: 5.8 }, rotation: { x: 0, y: 2.6, z: 0 }, geometry: dieGeos.medium })
    ];
    floorDice[0].dieSize = 0.4;
    floorDice[1].dieSize = 0.26;
    equipment.dice.push(...floorDice);
    const floorCard = createNode({ position: { x: 4.2, y: 0.02, z: 3.3 }, rotation: { x: 0, y: 2.3, z: 0 }, geometry: cardGeos.red, depthBias: 0.5 });
    equipment.cards.push(floorCard);
    const abacusModel = abacus();
    abacusModel.node.position = { x: half - 0.45, y: 0, z: -3.5 };
    abacusModel.node.rotation = { x: 0, y: -Math.PI / 2, z: 0 };
    equipment.abacus = abacusModel;
    addChild(room, ...floorDice, floorCard, abacusModel.node);
    const strokeFont = {
      O: [[[0.5, 0], [0.12, 0.35], [0.12, 1.05], [0.5, 1.4], [0.88, 1.05], [0.88, 0.35], [0.5, 0]]],
      G: [[[0.88, 1.1], [0.5, 1.4], [0.12, 1.05], [0.12, 0.35], [0.5, 0], [0.88, 0.3], [0.88, 0.65], [0.52, 0.65]]],
      A: [[[0.05, 0], [0.5, 1.4], [0.95, 0]], [[0.28, 0.5], [0.72, 0.5]]],
      B: [[[0.12, 0], [0.12, 1.4]], [[0.12, 1.4], [0.82, 1.12], [0.12, 0.72]], [[0.12, 0.72], [0.92, 0.34], [0.12, 0]]]
    };
    const wob = (n) => Math.sin(n * 12.9898) * 0.045;
    const caveText = "OOGA BOOGA";
    const ls = 0.72, letterW = 0.95, letterGap = 0.32, spaceW = 0.6;
    let cursor = 0;
    const strokes = [];
    let pointIdx = 0;
    for (const ch of caveText) {
      if (ch === " ") {
        cursor += spaceW;
        continue;
      }
      for (const stroke of strokeFont[ch]) {
        strokes.push(stroke.map(([px, py]) => ({ x: cursor + (px * letterW + wob(pointIdx)) * ls, y: (py + wob(pointIdx++ + 57)) * ls, z: 0 })));
      }
      cursor += (letterW + letterGap) * ls;
    }
    const signW = cursor - letterGap * ls;
    const signGeo = merge(...strokes.map((points) => polyline({ points, color: "#e8973a", emissive: 1 })));
    signGeo.lineWidth = 2.6;
    addChild(room, createNode({ position: { x: -signW / 2, y: 3.55, z: -half + 0.25 }, geometry: signGeo }));
    const bedrolls = [];
    const bedrollGeo = merge(box({ w: 1.9, h: 0.09, d: 0.85, color: "#2e2724" }), box({ w: 0.4, h: 0.16, d: 0.6, color: "#40342c", offset: { x: 0.65, y: 0.1 } }));
    for (let i = 0; i < bedrollCount; i++) {
      const x = -half + 1.3 + i % 2 * 2.3;
      const z = -7.6 + Math.floor(i / 2) * 1.6;
      addChild(room, createNode({ position: { x, y: 0.05, z }, geometry: bedrollGeo, depthBias: 0.3 }));
      bedrolls.push({ x, z });
    }
    return { room, leds, bedrolls, equipment, hatch: { node: hatch, set: setHatch } };
  };
  const buildableGeos = [
    cached(() => merge(
      box({ w: 0.8, h: 1.3, d: 0.5, color: "#1b1d1f", offset: { y: 0.65 } }),
      box({ w: 0.86, h: 0.06, d: 0.56, color: "#2a2c2f", offset: { y: 1.33 } }),
      box({ w: 0.6, h: 0.1, d: 0.03, color: "#202224", offset: { y: 0.9, z: 0.26 } }),
      box({ w: 0.6, h: 0.1, d: 0.03, color: "#202224", offset: { y: 0.6, z: 0.26 } }),
      box({ w: 0.06, h: 0.05, d: 0.02, color: "#22c55e", emissive: 1, offset: { x: 0.2, y: 1.05, z: 0.26 } })
    )),
    cached(() => merge(
      box({ w: 0.9, h: 0.7, d: 0.9, color: "#5c4425", offset: { y: 0.35 } }),
      box({ w: 0.96, h: 0.08, d: 0.96, color: "#4c3a20", offset: { y: 0.72 } }),
      box({ w: 0.9, h: 0.08, d: 0.1, color: "#4c3a20", offset: { y: 0.35, z: 0.41 } })
    )),
    cached(() => {
      const geometry = merge(
        box({ w: 0.12, h: 1.1, d: 0.12, color: "#35383b", offset: { y: 0.55 } }),
        box({ w: 0.5, h: 0.5, d: 0.06, color: "#3f4245", offset: { y: 1.2, z: 0.1 } }),
        box({ w: 0.08, h: 0.08, d: 0.06, color: "#d8892b", emissive: 1, offset: { y: 1.2, z: 0.16 } })
      );
      geometry.sightHidden = true;
      return geometry;
    })
  ];
  const TIER_COLORS = { common: "#9aa0a6", rare: "#6f9fca", epic: "#b16fd6", legendary: "#d8892b" };
  const crateCache = new Map();
  const crate = (tier) => {
    let geos = crateCache.get(tier);
    if (!geos) {
      const stripe = TIER_COLORS[tier] || TIER_COLORS.common;
      geos = {
        body: merge(
          box({ w: 0.7, h: 0.5, d: 0.7, color: "#6b4a26", offset: { y: 0.25 } }),
          box({ w: 0.74, h: 0.08, d: 0.74, color: "#4c3a20", offset: { y: 0.06 } }),
          box({ w: 0.74, h: 0.1, d: 0.16, color: stripe, emissive: 0.6, offset: { y: 0.3 } }),
          box({ w: 0.16, h: 0.1, d: 0.74, color: stripe, emissive: 0.6, offset: { y: 0.3 } })
        ),
        lid: merge(box({ w: 0.76, h: 0.1, d: 0.76, color: "#7a5630", offset: { x: 0.38, y: 0.05 } }), box({ w: 0.2, h: 0.06, d: 0.2, color: stripe, emissive: 0.8, offset: { x: 0.38, y: 0.12 } }))
      };
      crateCache.set(tier, geos);
    }
    const node = createNode();
    const lid = createNode({ position: { x: -0.38, y: 0.5, z: 0 }, geometry: geos.lid });
    addChild(node, createNode({ geometry: geos.body }), lid);
    return { node, lid };
  };
  const swagCache = new Map();
  const swagGeo = (id, build) => {
    let geo = swagCache.get(id);
    if (!geo) {
      geo = build();
      swagCache.set(id, geo);
    }
    return geo;
  };
  // Head anchor and swag sizes are fractions of caveman height.
  const SWAG = [
    { id: "party-hat", name: "Party Hat", tier: "common", slot: "head", offset: { y: -0.03 }, build: () => lathe({ profile: [[0.36, 0], [0.26, 0.2], [0.14, 0.42], [0.0, 0.62]], segments: 8, color: (t) => t < 0.34 ? "#d8892b" : t < 0.67 ? "#f3efe4" : "#22c55e" }) },
    { id: "bandana", name: "Bandana", tier: "common", slot: "head", offset: { y: -0.16 }, build: () => merge(ring({ r: 0.4, thickness: 0.045, segments: 10, color: "#c8342a" }), box({ w: 0.1, h: 0.04, d: 0.26, color: "#c8342a", offset: { x: 0.06, y: -0.03, z: -0.5 } }), box({ w: 0.1, h: 0.04, d: 0.2, color: "#a82a22", offset: { x: -0.08, y: -0.05, z: -0.46 } })) },
    {
      id: "banana-peel", name: "Banana Peel Hat", tier: "common", slot: "head", offset: { y: -0.06 }, build: () => merge(
        lathe({ profile: [[0.23, 0], [0.22, 0.08], [0.16, 0.16], [0.07, 0.22], [0, 0.24]], segments: 8, color: "#f5c542" }),
        box({ w: 0.05, h: 0.09, d: 0.05, color: "#5a3a1a", offset: { y: 0.27 } }),
        ...[0, 1, 2, 3].map((i) => {
          const a = i / 4 * Math.PI * 2 + Math.PI / 4;
          return tube({
            rings: 6,
            segments: 5,
            path: (t) => ({ x: Math.cos(a) * (0.08 + t * 0.34), y: 0.14 - t * t * 0.42, z: Math.sin(a) * (0.08 + t * 0.34) }),
            radius: (t) => 0.065 - t * 0.02,
            colorFn: (t) => t > 0.8 ? "#5a3a1a" : t > 0.55 ? "#e0b53a" : "#f5c542"
          });
        })
      )
    },
    { id: "miner-helmet", name: "Miner Helmet", tier: "rare", slot: "head", offset: { y: -0.12 }, build: () => merge(lathe({ profile: [[0.42, 0], [0.41, 0.12], [0.32, 0.26], [0.14, 0.36], [0, 0.38]], segments: 10, color: "#e0b53a" }), box({ w: 0.14, h: 0.12, d: 0.1, color: "#fff2b0", emissive: 1, offset: { y: 0.18, z: 0.4 } })) },
    { id: "tinfoil-hat", name: "Tinfoil Hat", tier: "rare", slot: "head", offset: { y: -0.04 }, build: () => lathe({ profile: [[0.38, 0], [0.27, 0.2], [0.14, 0.38], [0.02, 0.56]], segments: 5, color: "#c9ccd2" }) },
    { id: "golden-club", name: "Golden Club", tier: "rare", slot: "hand", skin: "club", build: () => voxelGeometry(clubVoxels(BL.math.mulberry32(7)), { unit: 1 / 16, palette: GOLD_CLUB_PALETTE, origin: { x: -1 / 16, y: -1 / 16, z: -1 / 16 } }) },
    { id: "crown", name: "Crown", tier: "epic", slot: "head", offset: { y: -0.06 }, build: () => merge(ring({ r: 0.38, thickness: 0.05, y: 0.05, segments: 8, color: "#f0c95a", emissive: 0.3 }), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => box({ w: 0.07, h: 0.18, d: 0.07, color: "#f0c95a", emissive: 0.3, offset: { x: Math.cos(i / 8 * Math.PI * 2) * 0.38, y: 0.19, z: Math.sin(i / 8 * Math.PI * 2) * 0.38 } }))) },
    { id: "golden-ak", name: "Golden AK", tier: "epic", slot: "gun", skin: "gun", build: () => gunGeometry(1, GOLD_GUN_PALETTE) },
    { id: "propeller-beanie", name: "Propeller Beanie", tier: "epic", slot: "head", spin: true, offset: { y: -0.1 }, build: () => merge(lathe({ profile: [[0.4, 0], [0.37, 0.14], [0.22, 0.28], [0, 0.32]], segments: 8, color: (t) => t < 0.5 ? "#6f9fca" : "#c8342a" }), box({ w: 0.03, h: 0.1, d: 0.03, color: "#c9ccd2", offset: { y: 0.36 } })) },
    { id: "halo", name: "Halo", tier: "legendary", slot: "head", float: true, offset: { y: 0.3 }, build: () => ring({ r: 0.26, thickness: 0.03, segments: 14, color: "#fff2b0", emissive: 1 }) },
    { id: "laser-eyes", name: "Laser Eyes", tier: "legendary", slot: "face", build: () => merge(...[-0.125, 0.125].map((x) => polyline({ points: [{ x, y: 0.16, z: 0.19 }, { x, y: 0.16, z: 1.0 }], color: "#ff2d20", emissive: 1 }))) }
  ];
  for (const item of SWAG) {
    if (item.slot === "head" && item.spin) {
      item.buildNode = () => {
        const node = createNode({ geometry: swagGeo(item.id, item.build) });
        const prop = createNode({ position: { x: 0, y: 0.42, z: 0 }, geometry: swagGeo(`${item.id}/prop`, () => box({ w: 0.44, h: 0.02, d: 0.06, color: "#f3efe4" })) });
        prop.spin = true;
        addChild(node, prop);
        return node;
      };
    } else {
      item.buildNode = () => createNode({ geometry: swagGeo(item.id, item.build) });
    }
  }
  // ---- the interior kit ---------------------------------------------------------------------------------
  // Timber structure, turned parts, chains and lanterns shared by the cave interiors (the Lightning Factory, Ooga
  // Arcade), in the warm timber and black iron those caves are built of.
  const TAU = Math.PI * 2, mulberry32 = BL.math.mulberry32;
  const TIMBER = "#8a5a32", TIMBER_LT = "#a8703e", TIMBER_DK = "#5c3a1e", IRON_DK = "#2c2e33", STONE_DK = "#3a2f28";
  // A squared beam between two points: braces, rails, chains and cables.
  const beam = (ax, ay, az, bx, by, bz, w, color, emissive = 0) => {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    let hx = 0, hy = 1, hz = 0;
    if (Math.abs(uy) > 0.9) { hx = 1; hy = 0; }
    let px = uy * hz - uz * hy, py = uz * hx - ux * hz, pz = ux * hy - uy * hx;
    const pl = Math.hypot(px, py, pz);
    px /= pl; py /= pl; pz /= pl;
    const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
    const geo = geometry(), rgb = hexToRgb(color), r = w / 2, opts = { emissive };
    const ring = (x, y, z) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => pushVert(geo, x + (px * s + qx * t) * r, y + (py * s + qy * t) * r, z + (pz * s + qz * t) * r));
    const a = ring(ax, ay, az), b = ring(bx, by, bz);
    for (let i = 0; i < 4; i++) face(geo, [a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]], rgb, opts);
    face(geo, b, rgb, opts);
    face(geo, a.slice().reverse(), rgb, opts);
    return geo;
  };
  // A lathe laid on its side along +z, for pipes, lenses and wheels.
  const forwardLathe = (geo) => {
    const v = geo.verts;
    for (let i = 0; i < v.length; i += 3) { const y = v[i + 1]; v[i + 1] = v[i + 2]; v[i + 2] = y; }
    geo.faces.forEach((f) => f.i.reverse());
    return geo;
  };
  // ---- turned parts -------------------------------------------------------------------------------
  // The machines are turned, like the stethoscope: lathes and tubes shaded smooth, so a glass drum or a pipe
  // reads round instead of faceted. `turn` doubles the profile's sharp corners so rims and caps keep their crease;
  // `shaded` gathers turned parts into one smooth geometry and folds flat ones (boxes, signs) in unsmoothed.
  const turn = (profile, segments, color, emissive = 0) => {
    const points = [];
    profile.forEach((p, i) => {
      points.push(p);
      if (i === 0 || i === profile.length - 1) return;
      const a = profile[i - 1], b = profile[i + 1], ux = p[0] - a[0], uy = p[1] - a[1], vx = b[0] - p[0], vy = b[1] - p[1];
      if ((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1) < 0.75) points.push(p);
    });
    return lathe({ profile: points, segments, color, emissive });
  };
  const shaded = (round, flat = []) => {
    const g = merge(...round);
    g.smooth = true;
    if (flat.length) BL.hubModels.flatInto(g, ...flat);
    return g;
  };
  // A ring of round section: `R` to the middle of the tube, `r` its thickness, lying flat about +y.
  const torus = (R, r, color, emissive = 0, segments = 20, sides = 8) => lathe({
    profile: Array.from({ length: sides + 1 }, (_, k) => [R + Math.cos(k / sides * TAU) * r, Math.sin(k / sides * TAU) * r]),
    segments, color, emissive
  });
  // Stands a geometry built round +y at (x, y, z) with that axis turned onto the direction (dx, dy, dz).
  const along = (geo, x, y, z, dx, dy, dz) => {
    const l = Math.hypot(dx, dy, dz) || 1, tx = dx / l, ty = dy / l, tz = dz / l;
    const hx = Math.abs(ty) < 0.9 ? 0 : 1, hy = Math.abs(ty) < 0.9 ? 1 : 0;
    let nx = hy * tz, ny = -hx * tz, nz = hx * ty - hy * tx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx, v = geo.verts;
    for (let i = 0; i < v.length; i += 3) {
      const a = v[i], b = v[i + 1], c = v[i + 2];
      v[i] = x + nx * a + tx * b + bx * c; v[i + 1] = y + ny * a + ty * b + by * c; v[i + 2] = z + nz * a + tz * b + bz * c;
    }
    return geo;
  };
  // A chain from one point to another: oval links of round iron, each a quarter turn from the last.
  const chain = (ax, ay, az, bx, by, bz, size = 0.16, color = IRON_DK) => {
    const len = Math.hypot(bx - ax, by - ay, bz - az), pitch = size * 2.2, n = Math.max(1, Math.round(len / pitch)), out = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, link = forwardLathe(torus(size, size * 0.3, color, 0, 10, 6));
      for (let k = 1; k < link.verts.length; k += 3) link.verts[k] *= 1.55;
      if (i % 2) turnedY(link, Math.PI / 2);
      out.push(along(link, ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, bx - ax, by - ay, bz - az));
    }
    return out;
  };

  // A rail from one point to another on a deck whose top is at y 0, as the concept builds them: square posts with
  // caps every metre and a half, a broad handrail laid flat along the top, a bottom rail and a cross of braces in
  // each bay. `ends` leaves out a post at an end another rail already stands on.
  const railParts = (x0, z0, x1, z1, ends = [true, true]) => {
    const geos = [], len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 1.5)), a = Math.atan2(-(z1 - z0), x1 - x0);
    const at = (t) => [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
    for (let i = 0; i <= n; i++) {
      if (i === 0 && !ends[0] || i === n && !ends[1]) continue;
      const [x, z] = at(i / n);
      geos.push(bevelBox({ w: 0.17, h: 1.06, d: 0.17, color: TIMBER_DK, bevel: 0.03, offset: { x, y: 0.53, z } }));
      geos.push(bevelBox({ w: 0.25, h: 0.08, d: 0.25, color: TIMBER_LT, bevel: 0.02, offset: { x, y: 1.1, z } }));
    }
    geos.push(moved(turnedY(bevelBox({ w: len + 0.12, h: 0.09, d: 0.2, color: TIMBER_LT, bevel: 0.025 }), a), (x0 + x1) / 2, 1.02, (z0 + z1) / 2));
    geos.push(beam(x0, 0.2, z0, x1, 0.2, z1, 0.1, TIMBER));
    for (let i = 0; i < n; i++) {
      const [ax, az] = at(i / n), [bx, bz] = at((i + 1) / n);
      geos.push(beam(ax, 0.25, az, bx, 0.97, bz, 0.055, TIMBER), beam(ax, 0.97, az, bx, 0.25, bz, 0.055, TIMBER));
    }
    return geos;
  };
  // A support column, as the concept props its decks: a stone footing, a square timber post bound with iron straps,
  // and a cap block under the deck, from y0 up to y1 at (x, z).
  const columnParts = (x, z, y0, y1, w = 0.38) => {
    const geos = [
      bevelBox({ w: w + 0.3, h: 0.36, d: w + 0.3, color: STONE_DK, bevel: 0.07, offset: { x, y: y0 + 0.14, z } }),
      bevelBox({ w, h: y1 - y0 - 0.32, d: w, color: TIMBER_DK, bevel: 0.06, offset: { x, y: (y0 + 0.3 + y1 - 0.02) / 2, z } }),
      bevelBox({ w: w + 0.16, h: 0.16, d: w + 0.16, color: TIMBER_LT, bevel: 0.03, offset: { x, y: y1 - 0.08, z } })
    ];
    for (let y = y0 + 1.1; y < y1 - 0.5; y += 1.4) geos.push(bevelBox({ w: w + 0.06, h: 0.08, d: w + 0.06, color: IRON_DK, bevel: 0.015, offset: { x, y, z } }));
    return geos;
  };
  // Where a w by d deck's posts stand, in its frame: under its frame at the corners and every few metres round it.
  const deckGrid = (w, d) => {
    const cols = Math.max(2, Math.round(w / 3.2) + 1), rows = Math.max(2, Math.round(d / 3.2) + 1);
    return { cols, rows, at: (i, j) => [(i / (cols - 1) - 0.5) * (w - 0.4), (j / (rows - 1) - 0.5) * (d - 0.4)] };
  };
  const deckPosts = (w, d) => {
    const { cols, rows, at } = deckGrid(w, d), out = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (i === 0 || i === cols - 1 || j === 0 || j === rows - 1) out.push(at(i, j));
    return out;
  };
  // A plank deck with its top at y 0, a frame of joists round its edge under the planks, posts down to what stands
  // below, and a rail along the named edges ("n" is -z, "s" +z, "w" -x, "e" +x). Posts stand under the frame at the
  // corners and every few metres round it; `drop` is how far down each one reaches, a number or a function of its
  // (x, z) in the deck's frame, and 0 leaves the posts out.
  const deckParts = (w, d, drop, rails = "", seed = 1, cuts = []) => {
    const rand = mulberry32(seed), geos = [], across = w >= d;
    const n = Math.max(2, Math.round((across ? d : w) / 0.9));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5, tone = [TIMBER, TIMBER_LT, "#946236"][Math.floor(rand() * 3)];
      geos.push(across
        ? bevelBox({ w: w - 0.04, h: 0.2, d: d / n - 0.05, color: tone, bevel: 0.04, offset: { y: -0.1, z: t * d } })
        : bevelBox({ w: w / n - 0.05, h: 0.2, d: d - 0.04, color: tone, bevel: 0.04, offset: { x: t * w, y: -0.1 } }));
    }
    for (const s of [-1, 1]) {
      geos.push(bevelBox({ w, h: 0.34, d: 0.28, color: TIMBER_DK, bevel: 0.05, offset: { y: -0.37, z: s * (d / 2 - 0.2) } }));
      geos.push(bevelBox({ w: 0.28, h: 0.34, d: d - 0.68, color: TIMBER_DK, bevel: 0.05, offset: { x: s * (w / 2 - 0.2), y: -0.37 } }));
    }
    const reach = typeof drop === "function" ? drop : () => drop;
    const { cols, rows, at } = deckGrid(w, d);
    for (const [x, z] of deckPosts(w, d)) {
      const down = reach(x, z);
      if (down < 0.4) continue;
      geos.push(...columnParts(x, z, -down, -0.54));
      // Knee braces from each column up into the frame, toward the deck's middle.
      if (down > 1.6) {
        if (x) geos.push(beam(x, -1.35, z, x - Math.sign(x) * 0.8, -0.56, z, 0.12, TIMBER));
        if (z) geos.push(beam(x, -1.35, z, x, -0.56, z - Math.sign(z) * 0.8, 0.12, TIMBER));
      }
    }
    // Cross braces on the long faces, for the scaffold look, between the corner posts and no deeper than the shorter.
    for (const s of [-1, 1]) {
      const [ax, az] = across ? at(0, s < 0 ? 0 : rows - 1) : at(s < 0 ? 0 : cols - 1, 0), [bx, bz] = across ? at(cols - 1, s < 0 ? 0 : rows - 1) : at(s < 0 ? 0 : cols - 1, rows - 1);
      const depth = Math.min(reach(ax, az), reach(bx, bz), 4.5);
      if (depth > 1.5) geos.push(beam(ax, -depth + 0.3, az, bx, -0.6, bz, 0.16, TIMBER), beam(ax, -0.6, az, bx, -depth + 0.3, bz, 0.16, TIMBER));
    }
    // A rail leaves a gap wherever a stair or a bridge lands on its edge, exactly as wide as what arrives, and ends
    // either side of it on a post that the arriving rails share: `cuts` are [x, z, half-width] in the deck's frame, on
    // the rail's line, and a stair's also the way its flight runs off the deck, so it opens only the rail it crosses
    // and as wide as it crosses it.
    const rail = (x0, z0, x1, z1, ends = [true, true]) => {
      const len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len, keep = [[0, len]];
      const out = (x0 + x1) * uz - (z0 + z1) * ux > 0 ? 1 : -1, nx = uz * out, nz = -ux * out;
      for (const [cx, cz, width, dx, dz] of cuts) {
        if (Math.abs((cx - x0) * uz - (cz - z0) * ux) > 0.6) continue;
        // A stair's centre line where it crosses this rail's line, and its width along the rail at that slant.
        const along = dx === undefined ? 1 : dx * nx + dz * nz;
        if (along < 0.3) continue;
        const k = dx === undefined ? 0 : -((cx - x0) * nx + (cz - z0) * nz) / along, t = (cx + (dx || 0) * k - x0) * ux + (cz + (dz || 0) * k - z0) * uz, half = width / along;
        if (t < -half || t > len + half) continue;
        for (let i = keep.length - 1; i >= 0; i--) {
          const [a, b] = keep[i];
          if (t + half <= a || t - half >= b) continue;
          keep.splice(i, 1, ...[[a, t - half], [t + half, b]].filter(([p, q]) => q - p > 0.12));
        }
      }
      for (const [a, b] of keep) geos.push(...railParts(x0 + ux * a, z0 + uz * a, x0 + ux * b, z0 + uz * b, [a > 0 || ends[0], b < len || ends[1]]));
    };
    // Corners are shared: the side rails leave out the post the front or back rail already stands there.
    const hw = w / 2 - 0.1, hd = d / 2 - 0.1, north = rails.includes("n"), south = rails.includes("s");
    if (north) rail(-hw, -hd, hw, -hd);
    if (south) rail(-hw, hd, hw, hd);
    if (rails.includes("w")) rail(-hw, -hd, -hw, hd, [!north, !south]);
    if (rails.includes("e")) rail(hw, -hd, hw, hd, [!north, !south]);
    return geos;
  };
  // A flight of steps from (ax, ay, az) up to (bx, by, bz), `w` wide. An end on a deck's rail leaves out its posts,
  // since the rail's own end posts stand there (`posts` [foot, head]).
  const stairParts = (ax, ay, az, bx, by, bz, w = 1.6, posts = [true, true]) => {
    const geos = [], rise = by - ay, steps = Math.max(3, Math.round(rise / 0.32)), len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len, px = -uz, pz = ux;
    for (const s of [-1, 1]) geos.push(beam(ax + px * s * w / 2, ay, az + pz * s * w / 2, bx + px * s * w / 2, by, bz + pz * s * w / 2, 0.22, TIMBER_DK));
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ay + rise * t;
      geos.push(beam(x - px * w / 2, y + 0.06, z - pz * w / 2, x + px * w / 2, y + 0.06, z + pz * w / 2, 0.14, i % 2 ? TIMBER : TIMBER_LT));
    }
    // A handrail up each side on capped posts, and a middle rail.
    for (const s of [-1, 1]) {
      const sx = px * s * (w / 2 + 0.05), sz = pz * s * (w / 2 + 0.05), n = Math.max(2, Math.round(len / 1.6) + 1);
      for (let i = 0; i < n; i++) {
        if (i === 0 && !posts[0] || i === n - 1 && !posts[1]) continue;
        const t = i / (n - 1), x = ax + (bx - ax) * t + sx, z = az + (bz - az) * t + sz, y = ay + rise * t;
        geos.push(bevelBox({ w: 0.15, h: 1.02, d: 0.15, color: TIMBER_DK, bevel: 0.03, offset: { x, y: y + 0.5, z } }), bevelBox({ w: 0.22, h: 0.07, d: 0.22, color: TIMBER_LT, bevel: 0.02, offset: { x, y: y + 1.05, z } }));
      }
      geos.push(beam(ax + sx, ay + 1, az + sz, bx + sx, by + 1, bz + sz, 0.13, TIMBER_LT), beam(ax + sx, ay + 0.55, az + sz, bx + sx, by + 0.55, bz + sz, 0.08, TIMBER));
    }
    return geos;
  };

  // The concept's lanterns: a square lantern of warm glass in a black iron frame, iron posts at its corners and a
  // cross of glazing bars on each face, a flat foot, a peaked cap and a ring to hang it by, `s` times the size of one
  // 0.84 m tall with its foot at the origin. The glass is its own list, lit; `tint` colours it, and `grid` false
  // leaves the faces clear for a sign.
  const LANTERN_GLASS = "#ffc860";
  const lanternParts = (s, x, y, z, frame, glass, tint = LANTERN_GLASS, grid = true) => {
    const W = 0.34 * s, lo = 0.08 * s, hi = 0.52 * s, mid = y + (lo + hi) / 2, tall = hi - lo;
    frame.push(box({ w: W + 0.08 * s, h: 0.07 * s, d: W + 0.08 * s, color: IRON_DK, offset: { x, y: y + 0.035 * s, z } }));
    frame.push(moved(turnedY(lathe({ profile: [[0.3, 0.5], [0.3, 0.56], [0.14, 0.72], [0.05, 0.76], [0, 0.77]].map(([r, h]) => [r * s, h * s]), segments: 4, color: IRON_DK }), Math.PI / 4), x, y, z));
    frame.push(moved(forwardLathe(torus(0.06 * s, 0.014 * s, IRON_DK, 0, 10, 5)), x, y + 0.84 * s, z));
    for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) frame.push(box({ w: 0.05 * s, h: tall + 0.03 * s, d: 0.05 * s, color: IRON_DK, offset: { x: x + cx * W / 2, y: mid, z: z + cz * W / 2 } }));
    if (grid) for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const fx = x + nx * (W / 2 + 0.006), fz = z + nz * (W / 2 + 0.006), thin = 0.012;
      frame.push(box({ w: nz ? 0.03 * s : thin, h: tall, d: nx ? 0.03 * s : thin, color: IRON_DK, offset: { x: fx, y: mid, z: fz } }));
      frame.push(box({ w: nz ? W : thin, h: 0.03 * s, d: nx ? W : thin, color: IRON_DK, offset: { x: fx, y: mid, z: fz } }));
    }
    glass.push(box({ w: W, h: tall, d: W, color: tint, emissive: 1, offset: { x, y: mid, z } }));
  };
  BL.models = { beam, forwardLathe, turn, shaded, torus, along, chain, railParts, columnParts, deckGrid, deckPosts, deckParts, stairParts, lanternParts, LANTERN_GLASS, geometry, pushVert, face, voxCoords, box, bevelBox, panel, lathe, glassVessel, attachGlassShell, tube, ring, polyline, merge, forward, moved, turnedX, turnedY, turnedZ, prism, cached, variants, noShadow, makeVox, voxelGeometry, voxelFaces, banana, bananaGeometry, bananaTileGeometry, bananaPileCoreGeometry, bananaPileRadiusScale, bananaPileHeightOffset, BANANA_AMMO_SCALE, BANANA_PILE_PROFILE, particleGeometry, spareMagazine, caveman, CLUB_PALETTE, GOLD_CLUB_PALETTE, labRoom, buildableGeos, crate, die, dieRotationFor, SWAG, TIER_COLORS };
})();
