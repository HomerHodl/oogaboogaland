// The Mempool island's water: the lake that stands as deep as the backlog, the flood it spreads over the shore
// and down the channels, the exterior and inner-ramp falls, their residual wall streaks, and the
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
// The lake, streams and falls share luminous blue blocks and pale foam. Rain and wakes still displace
// the lake and streams, with matching lighting normals. The hanging bowl carries the same translucent water
// material below the current waterline. On Canvas 2D, the sheets are built with both windings.
//
// Everything is built once in `create` and pooled: streams and falls are fixed water meshes, a block's cube, neck,
// droplets and rings come from SEQUENCES fixed sets; rain and wakes share a bounded wave field. Blocks found faster than they can fall wait in a queue
// of QUEUE at most, the rest dropped. `update` allocates nothing.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, poolLayout: L, poolModels: P } = BL;
  const { createNode, addChild, removeChild } = BL.scene;
  const { clamp, lerp, hexToRgb } = math;
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
    FILL: 0.3, PARK: L.LEVEL.bed - 0.06,
    // How brightly water without a live reading behind it glows, against 1.
    DIM: 0.5
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
  const SEQUENCES = 2, QUEUE = 3, DROPLETS = 4;
  // A block's cube: it gathers on the membrane, bulges through on a neck, hangs turning, falls slowly through
  // the chamber and its shaft for `drop` seconds, then on down the open air to the sea, where it dissolves.
  // Seconds per phase: the chamber watches about eight of them.
  const CUBE = { size: 1.5, gather: 1.6, bulge: 1.7, hang: 1.5, drop: 3.2, splash: 1.4, hangY: -L.MEMBRANE_DEPTH - 1.5, spin: 0.9 };
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
    const waves = { data: new Float32Array(WAVE_CAP * 4), surface: new Float32Array(4), count: 0 };
    const surfaceNode = hidden({ geometry: { ...surface[both](), lakeWaves: waves } });
    const floodNode = hidden({ geometry: { ...flood[both](), lakeWaves: waves }, visible: false });
    const cs = Math.cos(site.node.rotation.y), sn = Math.sin(site.node.rotation.y), origin = site.node.position;
    const rillNode = hidden({ geometry: { ...rampRill[both](),
      lakeFlowCurve: new Float32Array([origin.x, origin.z, L.RAMP.start + site.node.rotation.y, L.RAMP.r]) } });
    const tailNodes = L.RILL_TAIL.map((arc, i) => hidden({ geometry: { ...tailRills[both][i](),
      lakeFlowCurve: new Float32Array([origin.x + arc.x * cs + arc.z * sn, origin.z - arc.x * sn + arc.z * cs,
        arc.start + site.node.rotation.y, arc.r * Math.sign(arc.sweep)]) } }));
    addChild(group, surfaceNode, floodNode, rillNode, ...tailNodes);
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
      if (channel.inner) for (let j = 0; j < 3; j++) {
        const side = (j - 1) * 0.2;
        const residual = hidden({ geometry: node.geometry, smokeOpacity: 0.4,
          position: { x: ux * r + uz * side, y: 0.02, z: uz * r - ux * side }, rotation: { x: 0, y: channel.bearing, z: 0 },
          scale: { x: 0.055 + j * 0.015, y: Math.max(0.1, -channel.floor - 0.1) / length * (0.6 + j * 0.15), z: 0.08 } });
        fall.residuals.push(residual);
        addChild(group, residual);
      }
      falls.push(fall);
      addChild(group, streamNode, node);
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
      // A lake with no live reading behind it goes dim rather than pretending.
      const bright = status === "live" ? 1 : HYDRO.DIM;
      const lake = Math.min(shown, stage ? Math.max(floodY, L.WATER.spill - 0.01) : shown), reach = L.waterRadius(lake);
      surfaceNode.position.y = lake;
      surfaceNode.scale.x = surfaceNode.scale.z = reach;
      surfaceNode.visible = reach > 0.01;
      surfaceNode.glow = bright;
      waves.surface[0] = origin.x; waves.surface[1] = origin.z; waves.surface[2] = reach; waves.surface[3] = elapsed;
      site.membrane.glow = bright;
      site.membrane.smokeOpacity = surfaceNode.visible ? 1 : 0;
      site.membrane.geometry.clipMaxY = origin.y + lake;
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
      falls.length = drips.length = sequences.length = ripples.length = 0;
      actorKeys.fill(null);
      rippleCount = waves.count = 0;
    };
    const state = {
      get level() { return level; }, get target() { return target; }, get shown() { return shown; }, get flood() { return floodY; }, get stage() { return stage; },
      get status() { return status; }, get vsize() { return vsize; }, get observedAt() { return observedAt; }, get reach() { return surfaceNode.scale.x; },
      get falls() { let n = 0; for (const fall of falls) if (fall.node.visible) n++; return n; },
      get cubes() { let n = 0; for (const seq of sequences) if (seq.active) n++; return n; },
      get queued() { return queued; }, get dropped() { return dropped; }, get started() { return started; }, get preview() { return preview; }
    };
    return {
      apply, block, update, levelAt, rain, wake, dispose, state,
      liveGeometry(set) {
        set.add(surfaceNode.geometry).add(floodNode.geometry).add(site.membrane.geometry).add(rillNode.geometry);
        for (const fall of falls) {
          set.add(fall.stream.geometry).add(fall.node.geometry);
        }
        for (const node of tailNodes) set.add(node.geometry);
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

  BL.poolWater = { HYDRO, CUBE, SEQUENCES, QUEUE, WAVE_CAP, WAVE_WIDTH, WAVE_HEIGHT, sampleWaves, levelFor, create };
})();
