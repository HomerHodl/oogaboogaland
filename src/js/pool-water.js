// The Mempool island's water: the lake that stands as deep as the backlog, the flood it spreads over the shore
// and down the channels, the exterior and inner-ramp falls, their residual wall streaks, and the
// cube that leaves the lake through the chamber every time a block is found.
//
// The lake is the transaction backlog: `levelFor(vsize)` maps the waiting virtual bytes onto a level through
// HYDRO.POINTS, a monotonic display scale chosen for this island and no claim about any protocol limit. The
// level walks toward its reading at a bounded rate, so it never snaps, and it is shown in three stages with
// hysteresis between them (lake only, shore and channels, lowland too), so water hovering at a terrace's height
// neither flickers over it nor lies flush with its top. A reading that goes stale is held where it stood and
// said to be stale; with no reading at all the lake stands low. The cube subtracts nothing:
// what the block cleared arrives as the next backlog reading.
//
// The lake, streams and falls share luminous blue blocks and pale foam. Rain and wakes still displace
// the lake and streams, with matching lighting normals. The hanging bowl carries the same translucent water
// material below the current waterline. On Canvas 2D, the sheets are built with both windings.
//
// Everything is built once in `create` and pooled: streams and falls are fixed water meshes, a block's cube,
// and droplets come from SEQUENCES fixed sets; trench mist and rain/wakes use bounded pools. Blocks found faster than they can fall wait in a queue
// of QUEUE at most, the rest dropped. `update` allocates nothing.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, poolLayout: L, poolModels: P } = BL;
  const { createNode, addChild, removeChild } = BL.scene;
  const { clamp, lerp, hexToRgb, quat } = math;
  const { box, merge, noShadow, cached, pushVert, face } = models;
  const TAU = Math.PI * 2;
  const WATER = P.WATER, FOAM = P.FOAM, WATER_RGB = WATER.map(hexToRgb), FOAM_RGB = hexToRgb(FOAM), CALM = WATER_RGB[1];

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
    FILL: 0.3, PARK: L.LEVEL.bed - 0.06
  };
  const levelFor = (vsize) => {
    const points = HYDRO.POINTS, v = Math.max(0, vsize);
    for (let i = 1; i < points.length; i++) if (v <= points[i][0]) return lerp(points[i - 1][1], points[i][1], (v - points[i - 1][0]) / (points[i][0] - points[i - 1][0]));
    return points[points.length - 1][1];
  };
  // Cover the cell corners at the stepped banks, as well as their centre-sampled width.
  const BANK_COVER = L.UNIT * Math.SQRT1_2;
  // Bifrost's four quarter-metre streaks establish the shared maximum waterfall width.
  const FALL_WIDTH = 1;
  const channelHalf = (level) => (level > L.LEVEL.lowland ? L.CHANNEL.low : level > L.LEVEL.shore ? L.CHANNEL.bank : L.CHANNEL.bed) + BANK_COVER;
  const outletAt = (channel) => L.channelOutlet(channel) + 0.02;
  const SEQUENCES = 4, QUEUE = 3, DROPLETS = 20, BLOCK_GAP = 0.35;
  // The cube gathers from the lake, travels through it at a steady pull, then hovers below the bowl
  // until the charge fronts meet. Its spin never waits for separation.
  const CUBE = { size: 1.5, form: 1.8, pullSpeed: 1.65, pullEase: 0.18, drop: 3.2, splash: 1.4,
    hangY: -L.MEMBRANE_DEPTH - 1.5, spin: 0.38 };
  // The two charge fronts meet across the room's far side exactly when the formed cube begins to fall.
  const CHARGE = { pool: 0.8, ramp: 3.7, bend: 0.8, ring: 4, fade: 1.6, rise: 0.085 };
  // Rotate a cube's body diagonal onto world down: a corner, rather than a face, breaks the lake first.
  const POINT_AXIS = Math.SQRT1_2, POINT_ANGLE = Math.acos(-1 / Math.sqrt(3));
  const pointReach = (stretch, size) => CUBE.size * size / (2 * Math.sqrt(3)) * (2 / Math.sqrt(stretch) + stretch);
  const RIPPLES = { high: 20, medium: 16, low: 8, canvas2d: 6 };
  const WAKES = { high: 12, medium: 8, low: 4, canvas2d: 4 }, WAKE_ACTORS = 160;
  const WAVE_CAP = 32, WAVE_WIDTH = 0.32, WAVE_HEIGHT = 0.18;
  // Shared with the vertex shader: compact crest/trough packet and its analytic slopes, in world space.
  const sampleWaves = (out, x, z, waves, end = null) => {
    const surface = waves.surface, dx = x - surface[0], dz = z - surface[1], r = Math.hypot(dx, dz), time = surface[3];
    const edge = clamp((surface[2] - r) / 0.8, 0, 1), envelope = edge * edge * (3 - 2 * edge);
    const a = x * 0.9 + z * 0.5 - time * 1.15, b = -x * 0.6 + z * 1.3 - time * 1.7;
    const swell = 0.028 * Math.sin(a) + 0.014 * Math.sin(b);
    const rim = -6 * edge * (1 - edge) / 0.8 / Math.max(r, 0.0001);
    let height = swell * envelope;
    let sx = (0.0252 * Math.cos(a) - 0.0084 * Math.cos(b)) * envelope + swell * rim * dx;
    let sz = (0.014 * Math.cos(a) + 0.0182 * Math.cos(b)) * envelope + swell * rim * dz;
    for (let i = 0; i < waves.count; i++) {
      const o = i * 4, dx = x - waves.data[o], dz = z - waves.data[o + 1], r = Math.hypot(dx, dz);
      const q = (r - waves.data[o + 2]) / WAVE_WIDTH;
      if (Math.abs(q) >= 1) continue;
      const e = 1 - q * q, c = Math.cos(Math.PI * q), a = waves.data[o + 3];
      height += a * c * e * e;
      const slope = a * (-Math.PI * Math.sin(Math.PI * q) * e * e - 4 * q * c * e) / WAVE_WIDTH / Math.max(r, 0.0001);
      sx += slope * dx; sz += slope * dz;
    }
    const limit = 1 + Math.abs(height) / WAVE_HEIGHT;
    out[0] = height / limit; out[1] = sx / (limit * limit); out[2] = sz / (limit * limit);
    if (end) {
      const t = clamp(x * end[0] + z * end[2] + end[3], 0, 1), fade = t * t * (3 - 2 * t), slope = 6 * t * (1 - t) * out[0];
      out[1] = out[1] * fade + slope * end[0]; out[2] = out[2] * fade + slope * end[2]; out[0] *= fade;
    }
    const suction = waves.suction;
    if (suction && suction[3] > 0) {
      const dx = x - suction[0], dz = z - suction[1], r = Math.hypot(dx, dz);
      const q = clamp(1 - r / suction[2], 0, 1), dip = q * q * (3 - 2 * q);
      const slope = suction[3] * 6 * q * (1 - q) / suction[2] / Math.max(r, 0.0001);
      out[0] -= suction[3] * dip; out[1] += slope * dx; out[2] += slope * dz;
    }
    return out;
  };
  const RIPPLE_DIRECTIONS = [1, 0, Math.SQRT1_2, Math.SQRT1_2, 0, 1, -Math.SQRT1_2, Math.SQRT1_2,
    -1, 0, -Math.SQRT1_2, -Math.SQRT1_2, 0, -1, Math.SQRT1_2, -Math.SQRT1_2];

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
  // Fine shared meshes let wave packets displace the actual surface rather than drawing over it.
  // Canvas keeps a coarser mesh and evaluates the same packets on the CPU.
  const surface = [false, true].map((both) => cached(() => {
    const geo = { verts: [], faces: [], lines: [] }, rings = both ? 24 : 64, sectors = both ? 96 : 192;
    const rows = [];
    for (let r = 0; r <= rings; r++) {
      const row = [];
      for (let s = 0; s < sectors; s++) row.push(pushVert(geo, Math.sin(s / sectors * TAU) * r / rings, 0, Math.cos(s / sectors * TAU) * r / rings));
      rows.push(row);
    }
    for (let r = 1; r <= rings; r++) for (let s = 0; s < sectors; s++) {
      const next = (s + 1) % sectors;
      face(geo, r === 1 ? [rows[r][s], rows[r][next], rows[0][0]] : [rows[r][s], rows[r][next], rows[r - 1][next], rows[r - 1][s]], CALM, { emissive: 0.9 });
    }
    for (const f of geo.faces) f.lake = true;
    return glass(geo, 0.78, both);
  }));
  const flood = [false, true].map((both) => cached(() => {
    const geo = { verts: [], faces: [], lines: [] }, sectors = both ? 96 : 192, outer = L.RING.lowland + 0.25, step = both ? 0.5 : 0.2;
    const at = (bearing, r) => pushVert(geo, Math.sin(bearing) * r, 0, Math.cos(bearing) * r);
    const bands = Math.ceil((outer - L.LAKE_R) / step);
    for (let ring = 0; ring < bands; ring++) for (let s = 0; s < sectors; s++) {
      const a = s / sectors * TAU, b = (s + 1) / sectors * TAU;
      const inner = lerp(L.LAKE_R, outer, ring / bands), radius = lerp(L.LAKE_R, outer, (ring + 1) / bands);
      face(geo, [at(a, radius), at(b, radius), at(b, inner), at(a, inner)], CALM, { emissive: 0.9 });
    }
    for (const f of geo.faces) f.lake = true;
    return glass(geo, 0.78, both);
  }));
  const stream = (channel, both) => {
    const geo = { verts: [], faces: [], lines: [] }, sectors = both ? 96 : 192, outer = L.RING.lowland + 0.25, step = both ? 0.5 : 0.2;
    const end = outletAt(channel), half = L.CHANNEL.low + BANK_COVER, ux = Math.sin(channel.bearing), uz = Math.cos(channel.bearing), vx = uz, vz = -ux;
    // Meet the annulus polygon itself: broad overlapping sheets would darken translucent joins.
    const inlet = (w) => {
      let from = Infinity;
      for (let s = 0; s < sectors; s++) {
        const a = (s + 0.5) / sectors * TAU, nx = Math.sin(a), nz = Math.cos(a), along = nx * ux + nz * uz;
        if (along > 0.0001) from = Math.min(from, (outer * Math.cos(Math.PI / sectors) - (nx * vx + nz * vz) * w) / along);
      }
      return from;
    };
    const along = Math.ceil((end - outer) / step), across = Math.ceil(half * 2 / step);
    const starts = new Float64Array(across + 1);
    for (let j = 0; j <= across; j++) starts[j] = inlet(lerp(-half, half, j / across));
    const point = (r, w) => pushVert(geo, ux * r + vx * w, 0, uz * r + vz * w);
    for (let i = 0; i < along; i++) for (let j = 0; j < across; j++) {
      const left = lerp(-half, half, j / across), right = lerp(-half, half, (j + 1) / across);
      const startL = starts[j], startR = starts[j + 1];
      face(geo, [point(lerp(startL, end, i / along), left), point(lerp(startL, end, (i + 1) / along), left),
        point(lerp(startR, end, (i + 1) / along), right), point(lerp(startR, end, i / along), right)], CALM, { emissive: 0.9 });
    }

    for (const f of geo.faces) f.lake = true;
    return glass(geo, 0.78, both);
  };
  // A narrow collector follows the same stations and grade as the recessed ramp floor.
  const rampRill = [false, true].map((both) => cached(() => {
    const geo = { verts: [], faces: [], lines: [] }, G = L.RILL;
    const at = (a, side) => {
      const r = side < 0 ? L.rillInner(a) : L.rillRadius(a) + G.waterHalf, bearing = L.RAMP.start + a;
      return pushVert(geo, Math.sin(bearing) * r, L.rampY(a) - G.depth + 0.03, Math.cos(bearing) * r);
    };
    for (let i = 0; i < L.RILL_STATIONS.length - 1; i++) {
      const a = L.RILL_STATIONS[i], to = L.RILL_STATIONS[i + 1];
      if (to <= G.start || a >= G.end) continue;
      const from = Math.max(a, G.start);
      face(geo, [at(from, -1), at(from, 1), at(to, 1), at(to, -1)], CALM, { emissive: 0.75 });
    }
    for (const f of geo.faces) f.lake = true;
    return glass(geo, 0.72, both);
  }));
  const tailRills = [false, true].map((both) => L.RILL_TAIL.map((arc) => cached(() => {
    const geo = { verts: [], faces: [], lines: [] }, count = Math.ceil(Math.abs(arc.sweep) * arc.r / 0.2), scratch = {};
    const at = (i, side) => {
      L.rillTailPoint(arc, arc.start + arc.sweep * i / count, side * L.RILL.waterHalf, scratch);
      return pushVert(geo, scratch.x, (arc.squeeze ? L.rillJunctionY(scratch.x, scratch.z) : L.FLOOR) - L.RILL.depth + 0.03, scratch.z);
    };
    for (let i = 0; i < count; i++) {
      const ids = [at(i, -1), at(i, 1), at(i + 1, 1), at(i + 1, -1)];
      if (arc.sweep < 0) ids.reverse();
      face(geo, ids, CALM, { emissive: 0.75 });
    }
    for (const f of geo.faces) f.lake = true;
    return glass(geo, 0.72, both);
  })));
  // Thick ribbons meet across the lip, then separate into stepped tips at different heights.
  // Depth grows just below the lip so the upper edge still meets the horizontal stream exactly.
  const STRAND_LENGTHS = [0.71, 0.91, 0.82, 1, 0.88, 0.63, 0.77];
  const fallSheet = (length, both, seed, inner) => {
    const geo = { verts: [], faces: [], lines: [], strandTips: [] }, strands = STRAND_LENGTHS.length;
    const quad = (ids) => face(geo, ids, CALM, { emissive: 0.9 });
    const split = inner ? length * 0.72 : 0;
    // The inner fall has a single closed pane above the split, with no internal strand walls or seams.
    if (inner) {
      const rows = Math.ceil(split / (both ? 0.5 : 0.25));
      let previous = null;
      for (let i = 0; i <= rows; i++) {
        const down = split * i / rows, front = 0.1 * Math.min(1, down / 0.12);
        const row = [pushVert(geo, -0.5, -down, front), pushVert(geo, 0.5, -down, front),
          pushVert(geo, -0.5, -down, 0), pushVert(geo, 0.5, -down, 0)];
        if (previous) {
          quad([previous[0], row[0], row[1], previous[1]]);
          quad([previous[3], row[3], row[2], previous[2]]);
          quad([previous[2], row[2], row[0], previous[0]]);
          quad([previous[1], row[1], row[3], previous[3]]);
        }
        previous = row;
      }
    }
    for (let j = 0; j < strands; j++) {
      const ratio = STRAND_LENGTHS[(j + seed * 2) % strands];
      const drop = length * (inner ? 0.82 + 0.18 * ratio : ratio), depth = inner ? 0.1 : 0.18 + ((j * 3 + seed) % 5) * 0.04;
      const centre = (j + 0.5) / strands - 0.5, rows = Math.ceil((drop - split) / (both ? 0.5 : 0.25));
      let previous = null;
      for (let i = 0; i <= rows; i++) {
        const down = lerp(split, drop, i / rows);
        const inset = inner ? (down > length * 0.9 ? 0.035 : down > length * 0.78 ? 0.018 : 0)
          : down > drop - 0.8 ? 0.035 : down > drop * 0.65 ? 0.018 : 0;
        const left = j / strands - 0.5 + inset, right = (j + 1) / strands - 0.5 - inset;
        const front = depth * Math.min(1, down / (inner ? 0.12 : 0.5));
        const row = [pushVert(geo, left, -down, front), pushVert(geo, right, -down, front),
          pushVert(geo, left, -down, 0), pushVert(geo, right, -down, 0)];
        if (previous) {
          quad([previous[0], row[0], row[1], previous[1]]);
          quad([previous[3], row[3], row[2], previous[2]]);
          quad([previous[2], row[2], row[0], previous[0]]);
          quad([previous[1], row[1], row[3], previous[3]]);
        }
        previous = row;
      }
      quad([previous[0], previous[2], previous[3], previous[1]]);
      geo.strandTips.push({ x: centre, y: -drop, z: depth / 2 });
    }
    for (const f of geo.faces) f.lake = true;
    return glass(geo, 0.64, both);
  };
  // Dry-weather streaks are patches of the actual bevelled wall, not shrunken falling sheets.
  // Clip once at construction: no water can bridge an opening or rise above the channel bed.
  const residualWall = (rock, channel, both) => {
    const geo = { verts: [], faces: [], lines: [] }, ux = Math.sin(channel.bearing), uz = Math.cos(channel.bearing);
    const end = L.channelOutlet(channel), top = L.LEVEL.bed - 0.02, height = Math.max(0, top - channel.floor - 0.03);
    const clip = (points, axis, edge, direction) => {
      const out = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length], da = (a[axis] - edge) * direction, db = (b[axis] - edge) * direction;
        if (da >= 0) out.push(a);
        if ((da < 0) !== (db < 0)) {
          const t = da / (da - db);
          out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
        }
      }
      return out;
    };
    const v = rock.verts;
    for (const f of rock.faces) {
      let minY = Infinity, maxY = -Infinity, minAcross = Infinity, maxAcross = -Infinity, minAlong = Infinity, maxAlong = -Infinity;
      for (const id of f.i) {
        const x = v[id * 3], y = v[id * 3 + 1], z = v[id * 3 + 2], across = x * uz - z * ux, along = x * ux + z * uz;
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minAcross = Math.min(minAcross, across); maxAcross = Math.max(maxAcross, across);
        minAlong = Math.min(minAlong, along); maxAlong = Math.max(maxAlong, along);
      }
      if (minY >= top || maxY <= top - height || minAcross > 0.25 || maxAcross < -0.25
        || minAlong > end + L.UNIT || maxAlong < end - L.UNIT) continue;
      // Preserve the rock's triangle split, including the sloping last row above the ramp floor.
      for (let t = 1; t < f.i.length - 1; t++) {
        const points = [f.i[0], f.i[t], f.i[t + 1]].map(id => [v[id * 3] * uz - v[id * 3 + 2] * ux, v[id * 3 + 1], v[id * 3] * ux + v[id * 3 + 2] * uz]);
        const a = points[0], b = points[1], c = points[2];
        const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], cx = c[0] - a[0], cy = c[1] - a[1], cz = c[2] - a[2];
        const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx, length = Math.hypot(nx, ny, nz);
        if (nz <= length * 0.25 || length < 1e-9) continue;
        const offset = 0.004 / length;
        for (let j = 0; j < 3; j++) {
          const side = (j - 1) * 0.2, half = (0.055 + j * 0.015) / 2, bottom = top - height * (0.6 + j * 0.15);
          let patch = clip(clip(points, 0, side - half, 1), 0, side + half, -1);
          patch = clip(clip(patch, 1, bottom, 1), 1, top, -1);
          patch = clip(clip(patch, 2, end - L.UNIT, 1), 2, end + L.UNIT, -1);
          if (patch.length < 3) continue;
          const ids = patch.map(p => {
            const across = p[0] + nx * offset, along = p[2] + nz * offset;
            return pushVert(geo, ux * along + uz * across, p[1] + ny * offset, uz * along - ux * across);
          });
          for (let k = 1; k < ids.length - 1; k++) face(geo, [ids[0], ids[k], ids[k + 1]], CALM, { emissive: 0.9 });
        }
      }
    }
    for (const f of geo.faces) f.lake = true;
    return glass(geo, 0.64, both);
  };
  const drip = cached(() => noShadow(box({ w: 0.12, h: 0.18, d: 0.12, color: "#bfe8ff", emissive: 1 })));
  const mistDot = cached(() => noShadow(box({ w: 0.09, h: 0.09, d: 0.09, color: "#dcf6ff", emissive: 1.2 })));
  // Continuous local-space deformation, shared with the WebGL vertex shader. Canvas writes into its
  // own scratch vector before transforming the vertex. Buffers and topology never change during a frame.
  // [time, ripple metres, vertical stretch, neck pinch, bend x, bend z, neck flag, reserved].
  const sampleBody = (out, x, y, z, body) => {
    const time = body[0], amplitude = body[1];
    if (body[6] > 0.5) {
      const t = clamp(-y, 0, 1), wave = Math.sin(Math.PI * t), waist = 1 - body[3] * wave * wave;
      out[0] = x * waist + body[4] * t + amplitude * wave * Math.sin(time * 3.4 + t * 8);
      out[1] = y;
      out[2] = z * waist + body[5] * t + amplitude * wave * Math.cos(time * 3.1 - t * 7);
    } else {
      const across = 1 / Math.sqrt(body[2]);
      out[0] = x * across + body[4] * y * y + amplitude * Math.sin(y * 5.2 + z * 3.1 + time * 3.4);
      out[1] = y * body[2] + amplitude * 0.55 * Math.sin(x * 4.7 - z * 3.8 - time * 2.8);
      out[2] = z * across + body[5] * y * y + amplitude * Math.sin(y * 4.4 - x * 3.6 - time * 3.1);
    }
    return out;
  };
  const waterFace = (geo, ids) => {
    face(geo, ids, CALM, { emissive: 0.9 });
    geo.faces[geo.faces.length - 1].lake = true;
  };
  const waterNormals = (geo) => {
    const v = geo.verts, n = geo.normals = new Array(v.length).fill(0);
    for (const f of geo.faces) for (let j = 1; j < f.i.length - 1; j++) {
      const a = f.i[0] * 3, b = f.i[j] * 3, c = f.i[j + 1] * 3;
      const ax = v[b] - v[a], ay = v[b + 1] - v[a + 1], az = v[b + 2] - v[a + 2];
      const bx = v[c] - v[a], by = v[c + 1] - v[a + 1], bz = v[c + 2] - v[a + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
    }
    for (let i = 0; i < n.length; i += 3) {
      const scale = 6 / (Math.hypot(n[i], n[i + 1], n[i + 2]) || 1);
      n[i] *= scale; n[i + 1] *= scale; n[i + 2] *= scale;
    }
  };
  const bodyBounds = (geo, x, y, z, bottom = -y) => {
    // Unreferenced vertices bound every allowed deformation, including the thin gathering bulge.
    // scene.boundsOf caches immutable geometry, so its sphere must include the shader's full motion.
    pushVert(geo, -x, bottom, -z); pushVert(geo, x, y, z);
    geo.normals.push(0, 0, 0, 0, 0, 0);
    geo.twoSided = true;
    return geo;
  };
  const cubeShell = [false, true].map((low) => cached(() => {
    const geo = { verts: [], faces: [], lines: [], normals: [] }, steps = low ? 6 : 12;
    const half = CUBE.size / 2, radius = 0.11, inner = half - radius;
    // A small bevel keeps the water cube's corners readable without softening its silhouette into a blob.
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const u = (axis + 1) % 3, w = (axis + 2) % 3, base = geo.verts.length / 3;
      for (let j = 0; j <= steps; j++) for (let i = 0; i <= steps; i++) {
        const p = [0, 0, 0];
        p[axis] = sign * half; p[u] = lerp(-half, half, i / steps); p[w] = lerp(-half, half, j / steps);
        const c = p.map((v) => clamp(v, -inner, inner)), n = p.map((v, k) => v - c[k]);
        const length = Math.hypot(...n);
        pushVert(geo, c[0] + n[0] / length * radius, c[1] + n[1] / length * radius, c[2] + n[2] / length * radius);
        geo.normals.push(n[0] / length * 6, n[1] / length * 6, n[2] / length * 6);
      }
      for (let j = 0; j < steps; j++) for (let i = 0; i < steps; i++) {
        const a = base + j * (steps + 1) + i, ids = [a, a + 1, a + steps + 2, a + steps + 1];
        waterFace(geo, sign > 0 ? ids : ids.reverse());
      }
    }
    return glass(bodyBounds(geo, 2.5, 1.2, 2.5), 0.64, false);
  }));
  const splashCrown = [false, true].map((low) => cached(() => {
    const geo = { verts: [], faces: [], lines: [] }, sectors = low ? 24 : 64, rows = 6;
    // A closed, thick crown: the lip curls outwards and breaks into eight uneven fingers.
    for (let side = 0; side < 2; side++) for (let j = 0; j <= rows; j++) for (let i = 0; i < sectors; i++) {
      const t = j / rows, a = i / sectors * TAU;
      const fingers = Math.max(0, Math.sin(a * 8 + 0.6 * Math.sin(a * 3))) ** 6;
      const radius = 0.42 + 0.58 * t + 0.14 * t * t - side * 0.055;
      const height = t * (0.35 + 0.65 * fingers) + Math.sin(t * Math.PI) * 0.12;
      pushVert(geo, Math.sin(a) * radius, height, Math.cos(a) * radius);
    }
    const half = (rows + 1) * sectors;
    for (let side = 0; side < 2; side++) for (let j = 0; j < rows; j++) for (let i = 0; i < sectors; i++) {
      const a = side * half + j * sectors + i, b = side * half + j * sectors + (i + 1) % sectors;
      const ids = [a, b, b + sectors, a + sectors];
      waterFace(geo, side ? ids.reverse() : ids);
    }
    for (let i = 0; i < sectors; i++) {
      const next = (i + 1) % sectors, top = rows * sectors;
      waterFace(geo, [i, i + half, next + half, next]);
      waterFace(geo, [top + i, top + next, top + next + half, top + i + half]);
    }
    waterNormals(geo);
    return glass(bodyBounds(geo, 1.3, 1.1, 1.3, -0.05), 0.64, false);
  }));

  // `site` is the island's built group (pool-models `build`), `seaY` the sea's height in the island's frame.
  const create = ({ site, renderer, seaY }) => {
    const both = +(renderer.kind === "canvas2d"), low = both || renderer.quality === "low";
    const group = createNode({ sightHidden: true });
    addChild(site.node, group);
    const hidden = (options) => createNode({ sightHidden: true, ...options });
    const waves = { data: new Float32Array(WAVE_CAP * 4), surface: new Float32Array(4), suction: new Float32Array(4), count: 0 };
    const cs = Math.cos(site.node.rotation.y), sn = Math.sin(site.node.rotation.y), origin = site.node.position;
    // [lit distance, intensity, radial/forward/split mode, path length, world centre x/z].
    const chargePool = new Float32Array([0, 0, 1, 0, origin.x, origin.z]);
    const chargeRamp = new Float32Array([0, 0, 2, 0, origin.x, origin.z]);
    const chargeBend = new Float32Array([0, 0, 2, 0, origin.x, origin.z]);
    const chargeRing = new Float32Array([0, 0, 3, TAU * L.RILL_TAIL[1].r, origin.x, origin.z]);
    const surfaceNode = hidden({ geometry: { ...surface[both](), lakeWaves: waves, lakeCharge: chargePool } });
    const floodNode = hidden({ geometry: { ...flood[both](), lakeWaves: waves, lakeCharge: chargePool }, visible: false });
    site.membrane.geometry.lakeCharge = chargePool;
    const lakeOcclude = new Float32Array(4);
    const rillNode = hidden({ geometry: { ...rampRill[both](),
      lakeFlowCurve: new Float32Array([origin.x, origin.z, L.RAMP.start + site.node.rotation.y, L.RAMP.r]), lakeOcclude, lakeCharge: chargeRamp, lakeChargeRise: CHARGE.rise } });
    const tailNodes = L.RILL_TAIL.map((arc, i) => hidden({ geometry: { ...tailRills[both][i](),
      lakeFlowCurve: new Float32Array([origin.x + arc.x * cs + arc.z * sn, origin.z - arc.x * sn + arc.z * cs,
        arc.start + site.node.rotation.y, arc.r * Math.sign(arc.sweep)]), lakeOcclude, lakeCharge: i ? chargeRing : chargeBend, lakeChargeRise: CHARGE.rise } }));
    addChild(group, surfaceNode, floodNode, rillNode, ...tailNodes);
    // Small pooled motes float over the charged water only. Their positions follow the same three
    // trench paths as the light, including both directions around the chamber's ring.
    const mist = [], mistScratch = {}, mistRandom = math.mulberry32(math.fnv1a("mempool-trench-mist"));
    const addMist = (section, distance, x, y, z) => {
      const node = hidden({ geometry: mistDot(), visible: false });
      addChild(group, node);
      mist.push({ node, section, distance, x, y, z, phase: mistRandom(), speed: 0.35 + mistRandom() * 0.45,
        lift: 0.03 + mistRandom() * 0.13, drift: 0.015 + mistRandom() * 0.045, size: 0.5 + mistRandom() * 0.55 });
    };
    const rampDots = low ? 20 : 42;
    for (let i = 0; i < rampDots; i++) {
      const a = lerp(L.RILL.start, L.RILL.end, (i + 0.15 + mistRandom() * 0.7) / rampDots), bearing = L.RAMP.start + a;
      const r = L.rillRadius(a) + (mistRandom() * 2 - 1) * 0.055;
      addMist(0, a * L.RAMP.r, Math.sin(bearing) * r, L.rampY(a) - L.RILL.depth + 0.08,
        Math.cos(bearing) * r);
    }
    for (let section = 1; section <= 2; section++) {
      const arc = L.RILL_TAIL[section - 1], count = section === 1 ? (low ? 5 : 10) : (low ? 18 : 34);
      for (let i = 0; i < count; i++) {
        const fraction = (i + 0.15 + mistRandom() * 0.7) / count, a = arc.start + arc.sweep * fraction;
        L.rillTailPoint(arc, a, (mistRandom() * 2 - 1) * 0.055, mistScratch);
        const turn = ((Math.atan2(mistScratch.x - arc.x, mistScratch.z - arc.z) - arc.start) % TAU + TAU) % TAU;
        const distance = section === 1 ? turn * arc.r : Math.min(fraction, 1 - fraction) * TAU * arc.r;
        const y = (arc.squeeze ? L.rillJunctionY(mistScratch.x, mistScratch.z) : L.FLOOR) - L.RILL.depth + 0.08;
        addMist(section, distance, mistScratch.x, y, mistScratch.z);
      }
    }
    // Separate budgets keep heavy rain from evicting the visitor's wake. All wave records and tracking slots live
    // for this visit; no allocation is needed when a drop lands or a body takes a step.
    const rippleTier = both ? "canvas2d" : renderer.quality;
    const rainCount = RIPPLES[rippleTier] || RIPPLES.medium, wakeCount = WAKES[rippleTier] || WAKES.medium;
    const ripples = Array.from({ length: rainCount + wakeCount }, () => ({ x: 0, z: 0, age: 0, life: 0, from: 0, to: 0, strength: 0, amplitude: 0 }));
    const actorKeys = new Array(WAKE_ACTORS).fill(null), actorX = new Float64Array(WAKE_ACTORS), actorZ = new Float64Array(WAKE_ACTORS);
    const actorSeen = new Float64Array(WAKE_ACTORS), actorTravel = new Float32Array(WAKE_ACTORS), actorWait = new Float32Array(WAKE_ACTORS);
    let rainCursor = 0, wakeCursor = 0, actorCursor = 0, rippleFrame = 0, rippleDt = 0, rippleCount = 0;
    const rippleFits = (x, z, y, radius) => {
      for (let i = 0; i < RIPPLE_DIRECTIONS.length; i += 2) {
        if (Math.abs(levelAt(x + RIPPLE_DIRECTIONS[i] * radius, z + RIPPLE_DIRECTIONS[i + 1] * radius) - y) > 0.06) return false;
      }
      return true;
    };
    const disturb = (x, z, radius, strength, wake = false) => {
      const y = levelAt(x, z);
      if (!Number.isFinite(y) || !rippleFits(x, z, y, 0.08)) return;
      // Fit the whole effect in the wet footprint, so crests stop at banks and never float over dry paths.
      let reach = radius;
      for (let i = 0; i < 5 && !rippleFits(x, z, y, reach); i++) reach *= 0.7;
      if (reach < WAVE_WIDTH + 0.08 || !rippleFits(x, z, y, reach)) return;
      const ripple = ripples[wake ? rainCount + wakeCursor : rainCursor];
      if (wake) wakeCursor = (wakeCursor + 1) % wakeCount;
      else rainCursor = (rainCursor + 1) % rainCount;
      if (!ripple.life) rippleCount++;
      ripple.age = 0; ripple.life = wake ? 1.6 : 1.3;
      ripple.from = 0.04; ripple.to = reach - WAVE_WIDTH;
      ripple.strength = strength; ripple.amplitude = wake ? 0.095 : 0.055;
      ripple.x = x; ripple.z = z;
    };
    // Called only for a visible raindrop's actual landing, in island-local coordinates.
    const rain = (x, y, z, size, wet) => {
      if (Math.abs(levelAt(x, z) - y) > 0.06) return;
      const strength = clamp(0.65 + wet * 0.25 + size * 0.04, 0, 1);
      disturb(x, z, 0.65 + wet * 0.4 + size * 0.025, strength);
    };
    const wake = (key, x, feet, z, height, radius) => {
      if (rippleDt <= 0) return;
      const y = levelAt(x, z);
      if (!Number.isFinite(y) || feet > y - 0.025 || feet + height < y) return;
      const r = Math.hypot(x, z), bed = r < L.LAKE_R ? L.membraneY(r) : L.groundAt(x, z);
      // No wakes from the underground chamber, a bridge above the lake, or an animal on a branch.
      if (feet < bed - 0.2) return;
      let slot = actorKeys.indexOf(key);
      if (slot < 0) {
        slot = actorCursor; actorCursor = (actorCursor + 1) % WAKE_ACTORS;
        actorKeys[slot] = key; actorSeen[slot] = -1;
      }
      const dx = x - actorX[slot], dz = z - actorZ[slot], distance = Math.hypot(dx, dz), previous = actorSeen[slot];
      actorX[slot] = x; actorZ[slot] = z; actorSeen[slot] = rippleFrame;
      // A spawn, return to the water or network snap starts a new track, never a streak across the pool.
      if (previous !== rippleFrame - 1 || distance > Math.max(0.6, rippleDt * 12)) {
        actorTravel[slot] = actorWait[slot] = 0; return;
      }
      const speed = distance / rippleDt;
      if (speed < 0.08) { actorTravel[slot] = actorWait[slot] = 0; return; }
      actorTravel[slot] += distance; actorWait[slot] += rippleDt;
      if (actorTravel[slot] < Math.max(0.18, radius * 0.45) || actorWait[slot] < 0.09) return;
      actorTravel[slot] = actorWait[slot] = 0;
      const size = clamp(radius + 0.5 + speed * 0.12, 0.65, 1.5);
      disturb(x - dx / distance * radius * 0.3, z - dz / distance * radius * 0.3, size, clamp(0.4 + speed * 0.15, 0, 1), true);
    };

    // One unfolded flow coordinate system across each stream and its vertical fall.
    const falls = [], drips = [];
    for (const channel of L.CHANNELS) {
      const r = outletAt(channel), ux = Math.sin(channel.bearing), uz = Math.cos(channel.bearing);
      const wx = ux * cs + uz * sn, wz = -ux * sn + uz * cs, vx = wz, vz = -wx;
      const acrossOffset = -vx * origin.x - vz * origin.z, alongOffset = -wx * origin.x - wz * origin.z;
      const flow = new Float32Array([vx, 0, vz, acrossOffset, wx, 0, wz, alongOffset]);
      const fallingFlow = new Float32Array([vx, 0, vz, acrossOffset, 0, -1, 0, r + origin.y]);
      const widthClip = new Float32Array(4), waveEnd = new Float32Array([-wx, 0, -wz, r - alongOffset]);
      const streamNode = hidden({ geometry: { ...stream(channel, both), lakeWaves: waves, lakeWaveEnd: waveEnd, lakeFlow: flow, clipSlab: widthClip }, visible: false });
      const length = channel.length;
      const node = hidden({ position: { x: ux * r, y: 0, z: uz * r }, rotation: { x: 0, y: channel.bearing, z: 0 },
        geometry: { ...fallSheet(length, both, falls.length, channel.inner), lakeFlow: fallingFlow }, visible: false });
      // The cliff mesh folds the last voxel columns onto the mouth plane. Any high ground in
      // that strip still covers the mouth, so only its contiguous wet opening may feed the fall.
      const mouthHalf = L.CHANNEL.low + BANK_COVER, mouthCount = Math.ceil(mouthHalf / (L.UNIT / 16)) * 2;
      const mouthStep = mouthHalf * 2 / mouthCount, mouth = new Float32Array(mouthCount);
      const back = L.channelOutlet(channel) - L.UNIT / 2, front = channel.inner ? channel.to + L.UNIT * 0.75 : L.edgeAt(channel.bearing) + L.UNIT * 2;
      const samples = Math.ceil((front - back) / (L.UNIT / 8));
      for (let j = 0; j < mouthCount; j++) {
        let high = -Infinity;
        // Sample both edges as well as the centre so a bank corner cannot leak into the sheet.
        for (let side = 0; side <= 2; side++) {
          const across = -mouthHalf + (j + side / 2) * mouthStep;
          for (let k = 0; k <= samples; k++) {
            const along = lerp(back, front, k / samples);
            const x = ux * along + uz * across, z = uz * along - ux * across;
            // A roof over an interior culvert is not a bank covering its opening.
            high = Math.max(high, channel.inner ? (L.solidAt(x, L.WATER.flood, z) ? L.LEVEL.ground : L.LEVEL.bed) : L.groundAt(x, z));
          }
        }
        mouth[j] = high;
      }
      const fall = { node, inner: channel.inner, floor: channel.floor, length, residuals: [], wetWidth: 0, wetCentre: 0, outlet: r, ux, uz, mouth, mouthHalf, mouthStep, stream: streamNode,
        lip: Math.max(L.LEVEL.bed, channel.lip), flow: fallingFlow, widthClip, vx, vz, acrossOffset };
      for (let d = 0; d < node.geometry.strandTips.length; d++) {
        const tip = node.geometry.strandTips[d];
        const drop = hidden({ position: { x: tip.x, y: tip.y, z: tip.z }, geometry: drip() });
        drips.push({ node: drop, top: tip.y - 0.12, speed: 0.55 + (d % 3) * 0.17, seed: (falls.length * 7 + d) * 0.29 });
        addChild(node, drop);
      }
      if (channel.inner) {
        const residual = hidden({ geometry: { ...residualWall(site.ground.geometry, channel, both), lakeFlow: fallingFlow }, smokeOpacity: 0.4 });
        fall.residuals.push(residual);
        addChild(group, residual);
      }
      falls.push(fall);
      addChild(group, streamNode, node);
    }

    // Each sequence owns its deformation/flow buffers; all droplets instance the waterfalls' geometry.
    const sequences = [], flowAxis = new Float32Array(3), restQuat = quat.create();
    const fluid = (shape) => hidden({ geometry: { ...shape,
      lakeBody: new Float32Array([0, 0, 1, 0, 0, 0, 0, 0]), lakeFlow: new Float32Array(8) }, visible: false });
    for (let i = 0; i < SEQUENCES; i++) {
      const cube = fluid(cubeShell[+low]()), splash = fluid(splashCrown[+low]());
      cube.quaternion = quat.create();
      const droplets = Array.from({ length: low ? 8 : DROPLETS }, () => ({
        node: hidden({ geometry: drip(), visible: false }), age: 0, life: 0, vx: 0, vy: 0, vz: 0, size: 1, sucked: false
      }));
      addChild(group, cube, splash);
      for (const drop of droplets) addChild(group, drop.node);
      sequences.push({ active: false, t: 0, y: 0, v: 0, splashT: -1, sourceY: 0, formY: 0, pullDuration: 0, detached: false,
        dropClock: 0, dropCursor: 0, emitted: 0, suckClock: 0, intakeCount: 0,
        height: 0, label: "", order: 0, push: 0, shift: 0, extent: 0, impactQuat: quat.create(), cube, splash, droplets });
    }
    const ordered = sequences.slice();
    const picks = sequences.map((sequence) => ({ kind: "poolblock", node: sequence.cube, sequence }));
    const queuedHeights = new Float64Array(QUEUE), queuedLabels = new Array(QUEUE).fill("");
    let queued = 0, queueHead = 0, dropped = 0, started = 0, sequenceClock = 0, lastStart = -BLOCK_GAP;

    // The reading and the level. `reading` is false until any backlog figure has been seen at all.
    let target = L.WATER.low, level = L.WATER.low, shown = L.WATER.low, floodY = HYDRO.PARK, stage = 0, reading = false, observedAt = 0, vsize = 0, status = "unavailable", preview = null, settle = false;
    const bright = 1;
    let fill = null;
    const apply = (snapshot) => {
      if (!snapshot || preview !== null || fill !== null) return;
      const observed = snapshot.backlogAt > 0;
      // A reading restored from the last visit counts as a held one: its stamp is zero until the feed confirms it.
      if (!observed && !(snapshot.vsize > 0)) return;
      vsize = Math.max(0, snapshot.vsize);
      target = levelFor(vsize);
      observedAt = snapshot.backlogAt;
      // The first reading stands where it reads: the lake does not fill from empty in front of the visitor.
      if (!reading) { reading = true; level = target; settle = true; }
    };
    const begin = (seq, height, label) => {
      lastStart = sequenceClock;
      seq.active = true; seq.t = 0; seq.sourceY = shown; seq.formY = shown - 0.65;
      seq.pullDuration = (seq.formY - CUBE.hangY) / CUBE.pullSpeed + CUBE.pullEase;
      seq.y = seq.sourceY - 0.05; seq.v = 0; seq.splashT = -1; seq.detached = false;
      seq.dropClock = seq.dropCursor = seq.emitted = seq.suckClock = seq.intakeCount = 0;
      seq.height = height;
      seq.label = label;
      seq.order = started + 1; seq.push = seq.shift = 0;
      quat.fromAxisAngle(seq.cube.quaternion, POINT_AXIS, 0, -POINT_AXIS, POINT_ANGLE);
      seq.cube.position.x = seq.cube.position.z = 0;
      seq.cube.smokeOpacity = seq.splash.smokeOpacity = 1;
      for (const drop of seq.droplets) { drop.life = 0; drop.node.visible = false; }
      disturb(0, 0, 2.4, 1);
      started++;
    };
    // One sequence a block. With every set busy it waits its turn; past QUEUE waiting, it is let go.
    const block = (height = BL.chain ? BL.chain.snapshot.height : 0) => {
      height = Number.isSafeInteger(height) && height > 0 ? height : 0;
      const label = height > 0 ? "Block " + height.toLocaleString("en-US") : "Block height unavailable";
      // Keep rapid debug presses in event order with distinct landing times. Ordinary chain blocks
      // start immediately; the brief birth spacing prevents same-frame cubes converging at the sea.
      if (!queued && sequenceClock - lastStart >= BLOCK_GAP) {
        for (const seq of sequences) if (!seq.active) { begin(seq, height, label); return; }
      }
      if (queued < QUEUE) {
        const index = (queueHead + queued) % QUEUE;
        queuedHeights[index] = height; queuedLabels[index] = label; queued++;
      } else dropped++;
    };
    const park = (seq) => {
      seq.active = false;
      seq.cube.visible = seq.splash.visible = false;
      for (const drop of seq.droplets) { drop.life = 0; drop.node.visible = false; }
    };
    const ease = (t) => t * t * (3 - 2 * t);
    const emitDrop = (seq, x, y, z, vx, vy, vz, life, size, sucked = false) => {
      const drop = seq.droplets[seq.dropCursor];
      seq.dropCursor = (seq.dropCursor + 1) % seq.droplets.length;
      drop.age = 0; drop.life = life; drop.vx = vx; drop.vy = vy; drop.vz = vz; drop.size = size; drop.sucked = sucked;
      drop.node.position.x = x; drop.node.position.y = y; drop.node.position.z = z;
      drop.node.visible = true;
    };
    // Oblique coordinates give every side the pool's same blue patches and square foam. Rotate the
    // coordinates with the body so its texture follows its tumble, without stretching down vertical faces.
    const bodyFlow = (node) => {
      const flow = node.geometry.lakeFlow, pos = node.position;
      const x = origin.x + pos.x * cs + pos.z * sn, y = origin.y + pos.y, z = origin.z - pos.x * sn + pos.z * cs;
      for (let i = 0; i < 2; i++) {
        const ax = i ? -0.36 : 1.6, ay = i ? -1.5 : 0.35, az = i ? 0.74 : 0.62;
        if (node.quaternion) quat.rotateVec(flowAxis, node.quaternion, ax, ay, az);
        else { flowAxis[0] = ax; flowAxis[1] = ay; flowAxis[2] = az; }
        const o = i * 4;
        flow[o] = flowAxis[0] * cs + flowAxis[2] * sn;
        flow[o + 1] = flowAxis[1]; flow[o + 2] = -flowAxis[0] * sn + flowAxis[2] * cs;
        flow[o + 3] = -flow[o] * x - flow[o + 1] * y - flow[o + 2] * z;
      }
    };
    const stepSequence = (seq, dt, bright) => {
      seq.t += dt;
      const t = seq.t, top = L.membraneY(0), cube = seq.cube, body = cube.geometry.lakeBody;
      const hoverAt = CUBE.form + seq.pullDuration;
      const fallAt = CHARGE.pool + CHARGE.ramp + CHARGE.bend + CHARGE.ring, half = CUBE.size / 2;
      const hoverAge = Math.max(0, t - hoverAt), age = Math.max(0, t - fallAt);
      let size = 1, y = seq.y, falling = false;
      // The water gathers into a cube in the lake; after that its shape stays solid through the pull and fall.
      const forming = 1 - ease(clamp(t / CUBE.form, 0, 1));
      body[0] = t; body[1] = 0.024 * forming;
      body[4] = 0.018 * forming * Math.sin(t * 1.7);
      body[5] = 0.014 * forming * Math.cos(t * 1.3);
      if (t < CUBE.form) {
        const u = ease(t / CUBE.form);
        size = lerp(0.06, 1, u); body[2] = lerp(0.8, 1, u);
        y = lerp(seq.sourceY - 0.05, seq.formY, u);
      } else if (t < hoverAt) {
        const pullAge = t - CUBE.form, ramp = CUBE.pullEase, duration = seq.pullDuration;
        const distance = seq.formY - CUBE.hangY;
        const travelled = pullAge < ramp ? CUBE.pullSpeed * pullAge * pullAge / (2 * ramp)
          : pullAge > duration - ramp ? distance - CUBE.pullSpeed * (duration - pullAge) ** 2 / (2 * ramp)
            : CUBE.pullSpeed * (pullAge - ramp / 2);
        body[2] = 1;
        y = seq.formY - travelled;
      } else if (t < fallAt) {
        // Hold the formed block below the membrane until the light completes the trench ring.
        body[2] = 1;
        y = CUBE.hangY + 0.035 * Math.sin(hoverAge * 1.4);
      } else if (seq.splashT < 0) {
        falling = true;
        const slow = age < CUBE.drop, step = Math.min(dt, age);
        seq.v = Math.min(seq.v + (slow ? 2.6 : 16) * step, slow ? 7 : 26);
        y = Math.max(seaY, seq.y - seq.v * step);
        body[2] = 1;
        if (y <= seaY) {
          seq.splashT = 0;
          quat.copy(seq.impactQuat, cube.quaternion);
          seq.splash.position.x = cube.position.x; seq.splash.position.z = cube.position.z;
          // Ballistic spray comes from the same pale water droplets that leave each waterfall tip.
          for (let i = 0; i < seq.droplets.length; i++) {
            const a = i * 2.399963, speed = 1.3 + (i % 5) * 0.3;
            emitDrop(seq, cube.position.x, seaY + 0.08, cube.position.z,
              Math.sin(a) * speed, 2.5 + (i % 4) * 0.4, Math.cos(a) * speed, 0.9 + (i % 3) * 0.12, 0.65 + (i % 4) * 0.2);
          }
        }
      }
      if (seq.splashT < 0) {
        quat.integrate(cube.quaternion, cube.quaternion, 0.16, CUBE.spin, 0.21, dt);
        cube.position.x = t < hoverAt ? 0 : 0.09 * Math.sin(hoverAge * 0.9);
        cube.position.z = t < hoverAt ? 0 : 0.07 * Math.sin(hoverAge * 0.7);
      }
      seq.y = y;
      seq.splash.visible = seq.splashT >= 0;
      if (seq.splashT >= 0) {
        seq.splashT += dt;
        const u = clamp(seq.splashT / CUBE.splash, 0, 1), hit = clamp(seq.splashT / 0.32, 0, 1);
        body[2] = 1;
        quat.copy(cube.quaternion, seq.impactQuat);
        quat.slerpTo(cube.quaternion, restQuat, ease(hit));
        cube.scale.x = cube.scale.z = lerp(1, 2.2, ease(hit)); cube.scale.y = lerp(1, 0.04, ease(hit));
        cube.smokeOpacity = 1 - ease(hit); size = 1 - hit;
        seq.splash.position.y = seaY - 0.025;
        seq.splash.scale.x = seq.splash.scale.z = lerp(0.55, 2.9, ease(u));
        seq.splash.scale.y = Math.max(0.01, Math.sin(Math.PI * u) * 0.9);
        seq.splash.smokeOpacity = 1 - ease(u); seq.splash.glow = bright;
        seq.splash.geometry.lakeBody[0] = t; seq.splash.geometry.lakeBody[1] = 0.025;
        bodyFlow(seq.splash);
        if (u >= 1) { park(seq); return; }
      } else cube.scale.x = cube.scale.y = cube.scale.z = size;
      cube.visible = size > 0.005;
      cube.position.y = y; cube.glow = bright;
      bodyFlow(cube);
      if (t < CUBE.form + 0.4) {
        seq.suckClock += dt * 10;
        while (seq.suckClock >= 1) {
          seq.suckClock--;
          const i = seq.intakeCount++, a = i * 2.399963, radius = 1.35 + (i % 4) * 0.25, life = 0.65;
          emitDrop(seq, Math.sin(a) * radius, seq.sourceY + 0.08, Math.cos(a) * radius,
            -Math.sin(a) * radius / life, (y - seq.sourceY - 0.08) / life, -Math.cos(a) * radius / life,
            life, 0.65 + (i % 3) * 0.15, true);
        }
      }
      if (!seq.detached && t >= CUBE.form && y + pointReach(1, 1) < top - 0.03) {
        seq.detached = true;
        // The cube has cleared the membrane: only a few free droplets follow its tip.
        for (let i = 0; i < 3; i++) {
          const a = i * 2.399963;
          emitDrop(seq, Math.sin(a) * 0.08, top - 0.08 - i * 0.06, Math.cos(a) * 0.08,
            Math.sin(a) * 0.12, -0.35 - i * 0.18, Math.cos(a) * 0.12, 0.75 + i * 0.12, 0.6 + i * 0.1);
        }
      }
      if (seq.splashT < 0 && falling) {
        seq.dropClock += dt * 12;
        while (seq.dropClock >= 1) {
          seq.dropClock--;
          const i = seq.emitted++, a = i * 2.399963;
          emitDrop(seq, cube.position.x + Math.sin(a) * 0.48, y - seq.shift + half * 0.9, cube.position.z + Math.cos(a) * 0.48,
            Math.sin(a) * 0.25, -seq.v * 0.55, Math.cos(a) * 0.25, 1 + (i % 3) * 0.15, 0.55 + (i % 4) * 0.18);
        }
      }
      for (const drop of seq.droplets) {
        if (!drop.life) continue;
        drop.age += dt;
        if (drop.age >= drop.life) { drop.life = 0; drop.node.visible = false; continue; }
        const node = drop.node, u = drop.age / drop.life;
        if (!drop.sucked) drop.vy -= 8 * dt;
        node.position.x += drop.vx * dt; node.position.y += drop.vy * dt; node.position.z += drop.vz * dt;
        if (node.position.y < seaY) { drop.life = 0; node.visible = false; continue; }
        const shrink = 1 - ease(clamp((u - 0.65) / 0.35, 0, 1));
        node.scale.x = node.scale.z = drop.size * shrink;
        node.scale.y = drop.size * shrink * (1 + Math.min(0.8, Math.abs(drop.vy) * 0.035));
        node.glow = bright * (1 - u * 0.75); node.smokeOpacity = shrink;
      }
    };

    const spaceBlocks = () => {
      // Newest first, in a preallocated scratch order; pooled slots are reused independently of age.
      for (let i = 1; i < ordered.length; i++) {
        const seq = ordered[i];
        let j = i;
        while (j > 0 && ordered[j - 1].order < seq.order) { ordered[j] = ordered[j - 1]; j--; }
        ordered[j] = seq;
      }
      let above = null;
      const distance = CUBE.hangY - seaY;
      for (const seq of ordered) {
        const cube = seq.cube;
        if (!seq.active || !cube.visible || seq.splashT >= 0) continue;
        const body = cube.geometry.lakeBody, q = cube.quaternion, half = CUBE.size / 2;
        const across = half / Math.sqrt(body[2]);
        const x = across + Math.abs(body[4]) * half * half + body[1];
        const y = half * body[2] + body[1] * 0.55;
        const z = across + Math.abs(body[5]) * half * half + body[1];
        // Vertical support of the deformed box after rotation; include its ripple envelope and a small gap.
        seq.extent = Math.abs(2 * (q[0] * q[1] + q[3] * q[2])) * x * cube.scale.x
          + Math.abs(1 - 2 * (q[0] * q[0] + q[2] * q[2])) * y * cube.scale.y
          + Math.abs(2 * (q[1] * q[2] - q[3] * q[0])) * z * cube.scale.z;
        const remaining = clamp((seq.y - seaY) / distance, 0, 1);
        if (above && remaining > 0) {
          const needed = seq.y + seq.extent - (above.cube.position.y - above.extent - 0.18);
          if (needed > seq.push * remaining) {
            seq.push = Math.min(distance - 0.05, needed / remaining);
          }
        }
        // Preserve the original trajectory's time to the sea. A push shortens its remaining distance,
        // not its phase clocks; the displacement reaches exactly zero at the original landing frame.
        seq.shift = seq.push * remaining;
        cube.position.y = seq.y - seq.shift;
        bodyFlow(cube);
        above = seq;
      }
    };

    const walk = (value, to, step) => value > to ? Math.max(to, value - step) : Math.min(to, value + step);
    const chargeEnd = CHARGE.pool + CHARGE.ramp + CHARGE.bend + CHARGE.ring;
    const updateCharge = (reach) => {
      let newest = null;
      for (const seq of sequences) if (seq.active && seq.t < chargeEnd + CHARGE.fade && (!newest || seq.order > newest.order)) newest = seq;
      if (!newest) {
        chargePool[1] = chargeRamp[1] = chargeBend[1] = chargeRing[1] = 0;
        waves.suction[3] = 0;
        for (const dot of mist) dot.node.visible = false;
        return;
      }
      const t = newest.t, fade = 1 - ease(clamp((t - chargeEnd) / CHARGE.fade, 0, 1));
      const suction = waves.suction;
      suction[0] = origin.x; suction[1] = origin.z;
      suction[2] = lerp(2.8, 1.8, ease(clamp(t / CUBE.form, 0, 1)));
      suction[3] = 0.42 * ease(clamp(t / 0.45, 0, 1)) *
        (1 - ease(clamp((t - CUBE.form) / 0.8, 0, 1)));
      chargePool[0] = reach * clamp(t / CHARGE.pool, 0, 1);
      chargePool[1] = fade * (1 - 0.45 * ease(clamp((t - CHARGE.pool) / 1.5, 0, 1)));
      const rampAt = t - CHARGE.pool;
      chargeRamp[0] = L.RILL.start * L.RAMP.r + clamp(rampAt / CHARGE.ramp, 0, 1) * (L.RILL.end - L.RILL.start) * L.RAMP.r;
      chargeRamp[1] = rampAt >= 0 ? fade : 0;
      const bendAt = rampAt - CHARGE.ramp;
      chargeBend[0] = clamp(bendAt / CHARGE.bend, 0, 1) * Math.PI * L.RILL_TAIL[0].r;
      chargeBend[1] = bendAt >= 0 ? fade : 0;
      const ringAt = bendAt - CHARGE.bend;
      // Carry the front just past the antipode so the last arc is fully lit at the drop frame.
      chargeRing[0] = clamp(ringAt / CHARGE.ring, 0, 1) * (chargeRing[3] / 2 + 0.6);
      chargeRing[1] = ringAt >= 0 ? fade : 0;
      for (const dot of mist) {
        const charge = dot.section === 0 ? chargeRamp : dot.section === 1 ? chargeBend : chargeRing;
        const arrival = clamp((charge[0] - dot.distance + 0.15) / 0.5, 0, 1);
        const age = (dot.phase + t * dot.speed) % 1;
        const scale = dot.size * charge[1] * arrival * Math.sin(Math.PI * age);
        const node = dot.node;
        node.visible = scale > 0.05;
        if (!node.visible) continue;
        node.position.x = dot.x + Math.sin(t * 1.8 + dot.phase * TAU) * dot.drift;
        node.position.y = dot.y + CHARGE.rise * charge[1] * arrival + dot.lift + age * 0.4;
        node.position.z = dot.z + Math.cos(t * 1.6 + dot.phase * TAU) * dot.drift;
        node.scale.x = node.scale.z = scale;
        node.scale.y = scale * 1.15;
        node.glow = 1.2 + charge[1] * 0.5;
      }
    };
    const update = (dt, elapsed, now = Date.now()) => {
      rippleDt = dt;
      if (dt > 0) rippleFrame++;
      status = fill !== null || preview !== null ? "live" : !reading ? "unavailable" : observedAt > 0 && now - observedAt < HYDRO.FRESH_MS ? "live" : "stale";
      // The standing level: toward its reading, bounded.
      level = walk(level, target, Math.min(HYDRO.RATE * dt, Math.abs(target - level) * Math.min(1, dt / HYDRO.EASE) + 1e-4));
      const S = HYDRO.STAGE, D = HYDRO.SHOWN;
      if (stage === 0 && level > S.on) stage = 1;
      else if (stage === 1 && level < S.off) stage = 0;
      else if (stage === 1 && level > S.highOn) stage = 2;
      else if (stage === 2 && level < S.highOff) stage = 1;
      const want = fill !== null ? level : stage === 0 ? Math.min(level, D.under) : stage === 1 ? clamp(level, D.over, D.belowLowland) : Math.max(level, D.aboveLowland);
      shown = settle ? want : walk(shown, want, HYDRO.FILL * dt);
      floodY = settle ? (stage ? shown : HYDRO.PARK) : walk(floodY, stage ? shown : HYDRO.PARK, HYDRO.FILL * dt * (stage ? 2.5 : 1.5));
      settle = false;
      const lake = Math.min(shown, stage ? Math.max(floodY, L.WATER.spill - 0.01) : shown), reach = L.waterRadius(lake);
      surfaceNode.position.y = lake;
      surfaceNode.scale.x = surfaceNode.scale.z = reach;
      surfaceNode.visible = reach > 0.01;
      surfaceNode.glow = bright;
      waves.surface[0] = origin.x; waves.surface[1] = origin.z; waves.surface[2] = reach; waves.surface[3] = elapsed;
      lakeOcclude[0] = origin.x; lakeOcclude[1] = origin.y + lake;
      lakeOcclude[2] = origin.z; lakeOcclude[3] = Math.min(reach, L.LAKE_R);
      site.membrane.glow = bright;
      site.membrane.smokeOpacity = surfaceNode.visible ? 1 : 0;
      site.membrane.geometry.clipMaxY = origin.y + lake;
      site.membraneRock.geometry.clipMinY = origin.y + lake + 0.018;
      // Posts end at the higher of the live waterline and the bowl's curved edge, so their submerged
      // ends cannot show through the translucent underside when the lake is low.
      const postBottom = origin.y + Math.max(lake, L.membraneY(BL.poolModels.CHAIN_BOARD.r + 0.3) + 0.06);
      site.boardLegs.geometry.clipMinY = postBottom;
      site.infoLeg.geometry.clipMinY = postBottom;
      floodNode.visible = floodY > HYDRO.PARK + 0.01;
      floodNode.position.y = floodY;
      floodNode.glow = bright;
      waves.count = 0;
      for (let i = 0; i < ripples.length; i++) {
        const ripple = ripples[i];
        if (!ripple.life) continue;
        ripple.age += dt;
        const u = Math.min(1, ripple.age / ripple.life), radius = lerp(ripple.from, ripple.to, u);
        const y = levelAt(ripple.x, ripple.z);
        if (u >= 1 || !Number.isFinite(y) || !rippleFits(ripple.x, ripple.z, y, radius + WAVE_WIDTH)) {
          ripple.life = 0; rippleCount--; continue;
        }
        const o = waves.count++ * 4;
        waves.data[o] = origin.x + ripple.x * cs + ripple.z * sn;
        waves.data[o + 1] = origin.z - ripple.x * sn + ripple.z * cs;
        waves.data[o + 2] = radius;
        waves.data[o + 3] = ripple.amplitude * ripple.strength * Math.min(1, u / 0.08) * (1 - u) * (1 - u);
      }
      // Hide only rays that pass through the lake; the exposed collector stays visible from outside.
      rillNode.glow = bright * (floodNode.visible ? 0.8 : 0.5);
      for (const node of tailNodes) node.glow = rillNode.glow;
      // Fill the trench's steps, but let the actual banks covering its mouth narrow the falling sheet.
      for (const fall of falls) {
        const half = channelHalf(floodY);
        fall.stream.visible = floodNode.visible;
        fall.stream.position.y = floodY;
        fall.stream.glow = bright;
        fall.widthClip[0] = fall.vx / half; fall.widthClip[1] = 0;
        fall.widthClip[2] = fall.vz / half; fall.widthClip[3] = fall.acrossOffset / half;
        let left = fall.mouth.length / 2, right = left;
        while (left > 0 && fall.mouth[left - 1] < floodY - 0.02) left--;
        while (right < fall.mouth.length && fall.mouth[right] < floodY - 0.02) right++;
        const width = Math.min(FALL_WIDTH, (right - left) * fall.mouthStep);
        const centre = -fall.mouthHalf + (left + right) * fall.mouthStep / 2;
        fall.wetWidth = width; fall.wetCentre = centre;
        if (fall.inner) {
          const wetHalf = Math.max(0.025, width / 2);
          fall.widthClip[0] = fall.vx / wetHalf; fall.widthClip[2] = fall.vz / wetHalf;
          fall.widthClip[3] = (fall.acrossOffset - centre) / wetHalf;
          fall.stream.visible = floodNode.visible && width > 0.05;
        }
        fall.node.visible = floodNode.visible && floodY > fall.lip + 0.02 && width > 0.05;
        fall.node.position.x = fall.ux * fall.outlet + fall.uz * centre;
        fall.node.position.z = fall.uz * fall.outlet - fall.ux * centre;
        fall.node.position.y = floodY;
        fall.node.scale.x = Math.max(0.001, width);
        if (fall.inner) fall.node.scale.y = Math.max(0.1, floodY - fall.floor + L.RILL.depth - 0.03) / fall.length;
        fall.node.glow = bright;
        for (const residual of fall.residuals) {
          residual.visible = !fall.node.visible;
          residual.glow = bright * 0.5;
        }
        fall.flow[7] = fall.outlet + origin.y + floodY;
      }
      for (let i = 0; i < drips.length; i++) {
        const d = drips[i], t = (elapsed * d.speed + d.seed) % 1;
        d.node.position.y = d.top - t * t * 2.6;
        d.node.glow = bright * (1 - t * 0.75);
      }
      sequenceClock += dt;
      for (const seq of sequences) {
        if (seq.active) stepSequence(seq, dt, 1);
        else if (queued > 0 && sequenceClock - lastStart >= BLOCK_GAP) {
          queued--; begin(seq, queuedHeights[queueHead], queuedLabels[queueHead]);
          queuedLabels[queueHead] = ""; queueHead = (queueHead + 1) % QUEUE;
        }
      }
      spaceBlocks();
      updateCharge(reach);
    };
    // The water's surface over a point of the island's frame, or -Infinity where there is none: the lake inside
    // its waterline, and the flood wherever the sheet stands over lower ground.
    const levelAt = (x, z) => {
      const r = Math.hypot(x, z), lake = surfaceNode.position.y;
      if (r < surfaceNode.scale.x) return lake;
      if (!floodNode.visible || r < L.LAKE_R) return -Infinity;
      if (r > L.RING.lowland + 0.25) {
        let inChannel = false;
        for (let i = 0; i < L.CHANNELS.length; i++) {
          const channel = L.CHANNELS[i], fall = falls[i];
          const ux = Math.sin(channel.bearing), uz = Math.cos(channel.bearing), along = x * ux + z * uz;
          if (channel.inner && Math.abs(x * uz - z * ux - fall.wetCentre) >= fall.wetWidth / 2) continue;
          if (along >= L.RING.lowland && along <= outletAt(channel) && Math.abs(x * uz - z * ux) < channelHalf(floodY)) {
            if (channel.inner && r >= L.RING.ridge) return L.solidAt(x, floodY - 0.02, z) ? -Infinity : floodY;
            inChannel = true; break;
          }
        }
        // Past the cliff the channel has no bed: the water falls there, and holds up no one, on a ledge or in the air.
        if (!inChannel || L.groundAt(x, z) < L.LEVEL.bed) return -Infinity;
      }
      return L.groundAt(x, z) < floodY - 0.02 ? floodY : -Infinity;
    };
    const dispose = () => {
      removeChild(site.node, group);
      site.membrane.glow = 1;
      falls.length = drips.length = mist.length = sequences.length = ordered.length = ripples.length = picks.length = 0;
      queuedLabels.fill(""); queued = queueHead = 0; sequenceClock = 0; lastStart = -BLOCK_GAP;
      actorKeys.fill(null);
      rippleCount = waves.count = 0;
    };
    const state = {
      get level() { return level; }, get target() { return target; }, get shown() { return shown; }, get flood() { return floodY; }, get stage() { return stage; },
      get status() { return status; }, get vsize() { return vsize; }, get observedAt() { return observedAt; }, get debugFill() { return fill; }, get reach() { return surfaceNode.scale.x; },
      get falls() { let n = 0; for (const fall of falls) if (fall.node.visible) n++; return n; },
      get cubes() { let n = 0; for (const seq of sequences) if (seq.active) n++; return n; },
      get queued() { return queued; }, get dropped() { return dropped; }, get started() { return started; }, get preview() { return preview; }
    };
    return {
      apply, block, update, levelAt, rain, wake, dispose, state, picks,
      liveGeometry(set) {
        set.add(surfaceNode.geometry).add(floodNode.geometry).add(site.membrane.geometry).add(site.membraneRock.geometry).add(rillNode.geometry);
        for (const fall of falls) {
          set.add(fall.stream.geometry).add(fall.node.geometry);
          for (const residual of fall.residuals) set.add(residual.geometry);
        }
        for (const node of tailNodes) set.add(node.geometry);
        if (mist.length) set.add(mist[0].node.geometry);
        for (const seq of sequences) {
          set.add(seq.cube.geometry).add(seq.splash.geometry);
          for (const drop of seq.droplets) set.add(drop.node.geometry);
        }
      },
      // Debug only: stand the lake at a waiting size without the feed, or hand it back with null.
      preview(vB) {
        fill = null;
        preview = vB === null || vB === undefined ? null : Math.max(0, vB);
        if (preview !== null) { reading = true; vsize = preview; target = levelFor(preview); }
        else target = reading ? levelFor(vsize) : L.WATER.low;
      },
      // Debug depth runs from 0 to 200: empty bowl through full overflow, including partial trench filling.
      previewFill(value) {
        if (value !== null && !Number.isFinite(value)) return;
        fill = value === null ? null : clamp(value, 0, 200);
        preview = null;
        target = fill === null ? (reading ? levelFor(vsize) : L.WATER.low) : lerp(-L.MEMBRANE_DEPTH, L.WATER.flood, fill / 200);
        level = target; stage = target > HYDRO.STAGE.highOn ? 2 : target > HYDRO.STAGE.on ? 1 : 0; settle = true;
      },
      get active() { if (rippleCount) return true; for (const seq of sequences) if (seq.active) return true; return Math.abs(level - target) > 1e-3 || Math.abs(shown - level) > 0.11; },
      stats: () => ({ waterCubes: state.cubes, waterQueued: queued, waterRipples: rippleCount })
    };
  };

  BL.poolWater = { HYDRO, CUBE, SEQUENCES, QUEUE, WAVE_CAP, WAVE_WIDTH, WAVE_HEIGHT, sampleWaves, sampleBody, levelFor, create };
})();
