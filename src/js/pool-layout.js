// The Mempool island's one layout: every dimension of the rainforest, its lake, its tunnels and the chamber under
// the lake, and the voxel body cut from them. The models, the water, the weather, the hub's scatter, the animals
// and the clankers' beds all read this file, so the ground a visitor sees, stands on, swims over and sleeps on
// is one authority and cannot disagree with itself.
//
// Metres, in the island's own frame: y = 0 is the bridge's top datum, +z points back at the home island and a
// bearing runs from +z toward +x (x = r sin, z = r cos). The top is nominally 44 across, the home island's inner
// meadow. A lake 16 across opens down through a hole in the ground onto a transparent membrane (`membraneY`),
// and under it stands a chamber 24 across at FLOOR, round an open shaft 8 across that runs out through the
// island's underside. One descent (`RAMP`) winds 100 m round the chamber at a 10% grade from a hillside mouth
// beside the bridge court down to the chamber, under a ridge that keeps a roof on it; an outside ledge runs down
// the cliff beside it to two doors through the rock (`DOORS`), and a window overlooks the chamber on the way.
//
// The ground is terraces half a metre apart, as the home island's hills are: the court and the shore at 0, a
// lowland ring at 0.5, the forest floor and the ring path at 1, the nests at 1.5 and the ridge up to 4.5.
// Channels (`CHANNELS`) run from the shore to the cliff between the nests with their beds at -0.5, so water
// standing at any level floods exactly the terraces below it: the lake to the spill crest at 0, then the shore
// and the channels, then the lowland, while the path and every nest stay dry above the highest flood.
//
// `body()` fills the grid once for the page and keeps it: `groundAt`, `solidAt` and `covered` read it back.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { clamp } = BL.math;
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const UNIT = 0.5;
  const R = 22, LAKE_R = 8, CHAMBER_R = 12, SHAFT_R = 4, FLOOR = -10, MEMBRANE_DEPTH = 4;
  const LEVEL = { court: 0, shore: 0, lowland: 0.5, ground: 1, nest: 1.5, bed: -0.5, peak: 4.5 };
  // Where the water stands, low to the highest flood. Display tuning for the backlog lives in pool-water.js.
  const WATER = { low: -3, normal: -1, spill: 0, flood: 0.6 };
  const RING = { shore: 9.5, lowland: 10.5, path: 13, ridge: 12.75 };
  // The descent: its centreline radius, half width (wider in a bay), headroom, drop and length. `start` is the
  // mouth's bearing and `sweep` the angle it turns through; `roof` is the least rock kept over it.
  const RAMP = { r: 16, half: 2.5, bay: 3, bayReach: 3, head: 3.5, drop: 10, length: 100, start: 22 * DEG, roof: 1, flat: 3.25 };
  RAMP.sweep = RAMP.length / RAMP.r;
  RAMP.grade = RAMP.drop / RAMP.length;
  const RILL = { half: 0.18, bedHalf: 0.1, waterHalf: 0.075, depth: 0.14, inset: 0.7 };
  // Fractions of the sweep: two doors out to the ledge, each in a passing bay, a third bay, and the window.
  const DOORS = [{ at: 0.3, y: -3 }, { at: 0.5, y: -5 }];
  const BAYS = [0.3, 0.5, 0.75];
  const WINDOW = { at: 0.75, half: 1.5, sill: 1, top: 2.5 };
  const DOOR = { half: 1.7, height: 3 };
  const JUNCTION = { before: 0.15, after: 0.25, height: 3.5 };
  RILL.end = RAMP.sweep - JUNCTION.before + 0.055;
  // The ledge down the outside of the cliff, beside the descent and at its height, to the lower door.
  const LEDGE = { width: 3.2, lead: 0.26, tail: 0.2, to: 0.5, thick: 2.5, lip: 1 };
  // The plan's links A and B: two loops off the descent on its cliff side, as fractions of the sweep. Each leaves by
  // a mouth through the outer wall, runs behind a pier of rock along a gallery cut into the cliff's face and open to
  // the sea, and comes back in by a second mouth. There is no room in the shell for a walled tunnel beside the
  // descent, so the gallery's own outer wall is the open air. A's mouths stand under the falls of the second and
  // third channels. `lip` is the floor carried out past the cliff where the rock alone is too thin, `shy` its notch
  // under a fall, `rib` the pier's thickness.
  const LINK = { rib: 1.5, head: 3, mouth: 3.5, shy: 1.25 };
  const LINKS = [{ from: 0.56, to: 0.6576, lip: 2 }, { from: 0.81, to: 0.91, lip: 2.75 }];
  // Four reading stops on the chamber's wall, square to the grid so each is a flat face to paint on: its
  // bearing, and its half width along the wall.
  const STOPS = [0, 90, 180, 270].map((deg) => deg * DEG), STOP = { half: 3.01 };
  const COURT = { from: -0.36, step: 0.06, inner: 13.5 };
  // The bridge's island gateway and deck overlap, shared with its model. Recess its seat by one voxel
  // so the scalloped cliff stays below the sagging planks; the court meets the flat inner end.
  const BRIDGE = { z: R - 1, width: 5.2, deckStart: -2.5 };
  // Nests stand on the far side from the ridge, a channel between each pair.
  const NEST = { r: 16.5, halfR: 3.1, halfT: 2.6 };
  const NESTS = [170, 205, 240, 275, 310].map((deg) => ({ bearing: deg * DEG }));
  const CHANNEL = { bed: 0.3, bank: 0.45, low: 0.65, lip: 1 };
  // Ten evenly spaced bearings, omitting the bridge-facing slot at 7.5 degrees.
  // The first four enter the raised forest wall and spill down the descent's inner wall.
  const CHANNELS = Array.from({ length: 9 }, (_, i) => {
    const bearing = (43.5 + i * 36) * DEG, inner = i < 4, a = bearing - RAMP.start;
    const half = BAYS.some((bay) => Math.abs(a - bay * RAMP.sweep) * RAMP.r < RAMP.bayReach) ? RAMP.bay : RAMP.half;
    const floor = -RAMP.drop * a / RAMP.sweep;
    return { bearing, inner, lip: 0, to: inner ? RAMP.r - half + UNIT : Infinity, falls: !inner,
      floor, length: inner ? WATER.flood - floor - 0.12 : [12, 16, 13, 15, 11][i - 4] };
  });
  // The collector begins beneath the first inner waterfall, not at the ramp entrance.
  RILL.start = CHANNELS.find((channel) => channel.inner).bearing - RAMP.start - 0.5 / (RAMP.r - RAMP.half);
  const HILLS = [{ bearing: 329 * DEG, r: 17.2, top: 3.5, radius: 4 }, { bearing: 158 * DEG, r: 19.4, top: 2.5, radius: 2.4 }];
  // Two beds abreast and two deep on every nest. A gorilla lies 3 m long and 1.7 wide.
  const SLOT = { dr: 1.5, dt: 1.1, lead: 0.7 };
  const ORIGIN = { x: -27, y: -29, z: -27 }, SX = 108, SY = 68, SZ = 108;
  const M = { grass: 1, grassDark: 2, loam: 3, stone: 4, stoneDark: 5, path: 6, mud: 7, bed: 8, earth: 9, earthDark: 10, nest: 11, floor: 12, moss: 13 };
  const PALETTE = [null, "#3f7d34", "#346d2c", "#5a4530", "#6f6f6a", "#54544f", "#7a6243", "#5e5138", "#3f4a50", "#5b4630", "#4c3a28", "#4a6b2c", "#5e4a33", "#4d6540"];
  // Every tone a second time under its own number: two cells of one colour that the mesher keeps as two faces.
  const TWIN = PALETTE.length - 1;
  PALETTE.push(...PALETTE.slice(1));

  const wrap = (a) => {
    a %= TAU;
    return a < 0 ? a + TAU : a;
  };
  // The signed difference a - b, in (-PI, PI].
  const turn = (a, b) => {
    const d = wrap(a - b);
    return d > Math.PI ? d - TAU : d;
  };
  const down = (y) => Math.floor(y / UNIT + 1e-6) * UNIT;
  const up = (y) => Math.ceil(y / UNIT - 1e-6) * UNIT;
  const hash = (a, b, c) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
  // The island's outline: widest at the bridge and never inside the descent's outer wall.
  const edgeAt = (bearing) => 21.6 + 0.9 * Math.cos(3 * bearing) + 0.3 * Math.sin(7 * bearing + 1.3);
  // Inner water turns down at the ramp wall, before the culvert clearance extends into the walkway.
  // Exterior mouths are recessed into the voxel cliff; their meshes use the same plane.
  const channelOutlet = (channel) => channel.inner ? channel.to - UNIT : edgeAt(channel.bearing) - 2 * UNIT;
  // A transparent retaining bowl, not a free water surface: a spherical cap keeps one curvature
  // from the bottom to the rim, without the cosine profile's inflection and flattened lip.
  const MEMBRANE_RADIUS = (LAKE_R * LAKE_R + MEMBRANE_DEPTH * MEMBRANE_DEPTH) / (2 * MEMBRANE_DEPTH);
  const MEMBRANE_CENTRE = MEMBRANE_RADIUS - MEMBRANE_DEPTH;
  const membraneY = (r) => r >= LAKE_R ? 0 : MEMBRANE_CENTRE - Math.sqrt(MEMBRANE_RADIUS * MEMBRANE_RADIUS - r * r);
  // How far out the water reaches when it stands at `level`: inside the membrane below the crest, then the shore.
  const waterRadius = (level) => {
    const height = MEMBRANE_CENTRE - clamp(level, -MEMBRANE_DEPTH, WATER.spill);
    return Math.sqrt(Math.max(0, MEMBRANE_RADIUS * MEMBRANE_RADIUS - height * height));
  };
  // The descent's angle at a bearing, 0 at the mouth, and its floor there.
  const rampAngle = (bearing) => wrap(bearing - RAMP.start);
  const rampY = (a) => -RAMP.drop * clamp(a / RAMP.sweep, 0, 1);
  const rampHalf = (a) => {
    for (const bay of BAYS) if (Math.abs(a - bay * RAMP.sweep) * RAMP.r < RAMP.bayReach) return RAMP.bay;
    return RAMP.half;
  };
  // Ease into the wider bays from inside their footprint, keeping the gutter beside the inner wall.
  const rillRadius = (a) => {
    let widen = 0;
    for (const bay of BAYS) {
      const t = clamp(RAMP.bayReach - Math.abs(a - bay * RAMP.sweep) * RAMP.r, 0, 1);
      widen = Math.max(widen, t * t * (3 - 2 * t));
    }
    return RAMP.r - RAMP.half + RILL.inset - (RAMP.bay - RAMP.half) * widen;
  };
  // Recess the collector back to each fall's wall: one continuous wet strip, with a wider receiving pocket.
  const rillInner = (a) => {
    let inner = rillRadius(a) - RILL.waterHalf;
    for (const channel of CHANNELS) if (channel.inner) {
      const distance = Math.abs(turn(RAMP.start + a, channel.bearing)) * (RAMP.r - rampHalf(a));
      const t = clamp((0.75 - distance) / 0.25, 0, 1), weight = t * t * (3 - 2 * t);
      inner = Math.min(inner, inner + (channelOutlet(channel) + 0.02 - inner) * weight);
    }
    return inner;
  };
  // Add the pocket corners to the ordinary metre stations so floor and water share every edge.
  const RILL_STATIONS = [];
  for (let a = 0; a < RAMP.sweep; a += 1 / RAMP.r) RILL_STATIONS.push(a);
  RILL_STATIONS.push(RAMP.sweep, RILL.start, RILL.end);
  for (const channel of CHANNELS) if (channel.inner) {
    const a = channel.bearing - RAMP.start, r = RAMP.r - rampHalf(a);
    for (const side of [-0.75, -0.625, -0.5, 0, 0.5, 0.625, 0.75]) RILL_STATIONS.push(a + side / r);
  }
  RILL_STATIONS.sort((a, b) => a - b);
  for (let i = RILL_STATIONS.length - 1; i > 0; i--) if (RILL_STATIONS[i] - RILL_STATIONS[i - 1] < 1e-6) RILL_STATIONS.splice(i, 1);
  // Turn back around the dividing wall's tip through the lower junction, then follow the room perimeter.
  // These two arcs also cut the floor and place its groove, so the water cannot disappear under a voxel.
  const rillEnd = RAMP.start + RILL.end, roomRillR = CHAMBER_R - 0.85;
  const rillTurnR = (rillRadius(RILL.end) - roomRillR) / 2, rillTurnAt = roomRillR + rillTurnR;
  const RILL_TAIL = [
    { x: Math.sin(rillEnd) * rillTurnAt, z: Math.cos(rillEnd) * rillTurnAt, r: rillTurnR, start: rillEnd, sweep: Math.PI, squeeze: 0.32 },
    { x: 0, z: 0, r: roomRillR, start: rillEnd, sweep: -TAU }
  ];
  // Blend the remaining few centimetres of descent into the chamber while making the turn earlier.
  const rillJunctionY = (x, z) => {
    const r = Math.hypot(x, z), a = rampAngle(Math.atan2(x, z));
    const outer = clamp((r - roomRillR) / (rillRadius(RILL.end) - roomRillR), 0, 1);
    return FLOOR + (rampY(a) - FLOOR) * outer;
  };
  // Compress only the bend's forward reach; both ends still meet the existing streams exactly.
  const rillTailPoint = (arc, angle, offset, out) => {
    const t = angle - arc.start, c = Math.cos(t), s = Math.sin(t), squeeze = arc.squeeze || 1;
    const length = Math.hypot(squeeze * c, s), radial = arc.r * c + offset * squeeze * c / length;
    const forward = arc.r * squeeze * s + offset * s / length, ux = Math.sin(arc.start), uz = Math.cos(arc.start);
    out.x = arc.x + ux * radial + uz * forward;
    out.z = arc.z + uz * radial - ux * forward;
    return out;
  };
  const bend = RILL_TAIL[0], bendPoint = {};
  bend.edge = new Float64Array(130);
  for (let i = 0; i <= 64; i++) {
    rillTailPoint(bend, bend.start + bend.sweep * i / 64, 0, bendPoint);
    bend.edge[i * 2] = bendPoint.x; bend.edge[i * 2 + 1] = bendPoint.z;
  }
  const rillTailDistance = (x, z) => {
    let distance2 = Math.pow(Math.hypot(x, z) - roomRillR, 2);
    if (Math.hypot(x - bend.x, z - bend.z) > bend.r + 1) return Math.sqrt(distance2);
    const edge = bend.edge;
    for (let i = 0; i < edge.length - 2; i += 2) {
      const dx = edge[i + 2] - edge[i], dz = edge[i + 3] - edge[i + 1];
      const t = clamp(((x - edge[i]) * dx + (z - edge[i + 1]) * dz) / (dx * dx + dz * dz), 0, 1);
      const px = x - edge[i] - t * dx, pz = z - edge[i + 1] - t * dz;
      distance2 = Math.min(distance2, px * px + pz * pz);
    }
    return Math.sqrt(distance2);
  };
  // The voxel floor under the smooth one: the step at or just below it, never above.
  const stepUnder = (y) => y >= 0 ? 0 : Math.max(FLOOR, down(y - 0.08));
  const roofUnder = (r) => r < LAKE_R ? Infinity : r < RING.shore ? -1.5 : r < RING.lowland ? -2.5 : r < 11.25 ? -3.5 : -4.5;
  const ledgeAngle = (a) => a >= TAU - LEDGE.lead ? a - TAU : a;
  const onLedge = (a) => {
    a = ledgeAngle(a);
    return a >= -LEDGE.lead && a <= LEDGE.to * RAMP.sweep + LEDGE.tail;
  };
  // A rounded flare grows out of the bridge court instead of a full-width panel jutting off its edge.
  // The voxel backing and smooth walking surface share the same taper.
  const ledgeWidth = (a) => {
    if (!onLedge(a)) return 0;
    const t = clamp((ledgeAngle(a) + LEDGE.lead) / LEDGE.lead, 0, 1);
    return LEDGE.width * t * t * (3 - 2 * t);
  };
  const ledgeY = (a) => rampY(Math.min(ledgeAngle(a), LEDGE.to * RAMP.sweep));
  // The rock over the descent while it is shallow: a ridge that keeps `roof` on it, falling as it falls.
  const ridgeTop = (a) => Math.min(LEVEL.peak, up(rampY(a) + RAMP.head + RAMP.roof + 0.25));

  // The link a descent angle lies in, its mouths included, and how far its floor is carried past the cliff there.
  const linkAt = (a) => {
    for (const link of LINKS) if (a > link.from * RAMP.sweep - DOOR.half / 18 && a < link.to * RAMP.sweep + DOOR.half / 18) return link;
    return null;
  };
  // Keep the fall's opening clear while letting the shelf reach its banks on either side.
  const fallGap = (bearing, r = edgeAt(bearing), margin = 0) => {
    for (const channel of CHANNELS) if (channel.falls && Math.abs(turn(bearing, channel.bearing)) * r < CHANNEL.low + margin) return true;
    return false;
  };
  const lipAt = (bearing, r = edgeAt(bearing)) => {
    const a = rampAngle(bearing), link = linkAt(a);
    let lip = 0;
    if (link && a > link.from * RAMP.sweep && a < link.to * RAMP.sweep) lip = link.lip;
    else {
      // Continue the exterior shelf between the galleries without cutting another passage into the cliff.
      const from = LINKS[0].to * RAMP.sweep, to = LINKS[1].from * RAMP.sweep;
      if (a >= from && a <= to) lip = LINKS[0].lip + (LINKS[1].lip - LINKS[0].lip) * (a - from) / (to - from);
    }
    return lip && !fallGap(bearing, r) ? lip : 0;
  };

  // One column of ground: its top (a cell top, or -Infinity where there is none), its underside, the material it
  // wears, and the gaps cut through it as [from, to) pairs in `gaps`.
  const COLUMN = { top: 0, bottom: 0, material: 0, gaps: new Float64Array(12), count: 0, r: 0, bearing: 0, a: 0, ledge: false };
  const gap = (from, to) => {
    COLUMN.gaps[COLUMN.count * 2] = from;
    COLUMN.gaps[COLUMN.count * 2 + 1] = to;
    COLUMN.count++;
  };
  const column = (x, z) => {
    const c = COLUMN, r = Math.hypot(x, z), bearing = wrap(Math.atan2(x, z)), a = rampAngle(bearing), edge = edgeAt(bearing);
    c.count = 0; c.r = r; c.bearing = bearing; c.a = a; c.ledge = false; c.top = -Infinity; c.material = M.grass;
    if (r < SHAFT_R) return c;
    if (r >= edge) {
      // Outside the cliff only the ledge stands: a shelf hanging on the rock, thinner toward its lip.
      if (fallGap(bearing, r, UNIT * Math.SQRT1_2)) return c;
      const lip = lipAt(bearing, r), width = lip || ledgeWidth(a);
      if (width <= 0 || r > edge + width || !lip && !onLedge(a)) return c;
      c.ledge = true;
      c.top = stepUnder(lip ? rampY(a) : ledgeY(a));
      c.bottom = c.top - (LEDGE.thick - (r - edge) / width * (LEDGE.thick - LEDGE.lip));
      c.material = M.path;
      return c;
    }
    // The underside tapers to a point, decided per two-metre block so it hangs in chunks and not in a fine stair.
    const bx = Math.floor(x / 2) * 2 + 1, bz = Math.floor(z / 2) * 2 + 1, block = hash(bx, 7, bz) % 1000 / 1000;
    const k = Math.min(1, Math.hypot(bx, bz) / edgeAt(Math.atan2(bx, bz)));
    c.bottom = -up((13 + 15 * (1 - Math.pow(k, 1.6))) * (0.9 + block * 0.14));
    if (r < LAKE_R) {
      // Under the lake there is no ground at all: the chamber's floor is the top.
      c.top = FLOOR; c.material = M.floor;
      return c;
    }
    const d = turn(bearing, 0);
    let top = r < RING.shore ? LEVEL.shore : r < RING.lowland ? LEVEL.lowland : LEVEL.ground;
    let material = r < RING.lowland ? M.mud : hash(Math.floor(x), 1, Math.floor(z)) % 100 < 30 ? M.grassDark : M.grass;
    // The ring path, narrower where the ridge stands beside it.
    const ridged = a <= RAMP.sweep && ridgeTop(a) > LEVEL.ground && a > COURT.step;
    if (r >= RING.lowland && r < (ridged ? RING.ridge : RING.path)) material = M.path;
    for (const hill of HILLS) {
      const hx = Math.sin(hill.bearing) * hill.r, hz = Math.cos(hill.bearing) * hill.r, near = 1 - Math.hypot(x - hx, z - hz) / hill.radius;
      if (near > 0) top = Math.max(top, down(LEVEL.ground + (hill.top - LEVEL.ground) * Math.min(1, near * 1.35)));
    }
    if (ridged && Math.abs(r - RAMP.r) <= RAMP.flat) top = Math.max(top, ridgeTop(a));
    for (const nest of NESTS) {
      const across = turn(bearing, nest.bearing) * r;
      if (Math.abs(r - NEST.r) <= NEST.halfR && Math.abs(across) <= NEST.halfT) { top = LEVEL.nest; material = M.nest; }
    }
    if (r >= RING.shore) for (const channel of CHANNELS) {
      const across = Math.abs(turn(bearing, channel.bearing) * r);
      if (across >= CHANNEL.low || r > channel.to + (channel.inner ? UNIT : 0)) continue;
      if (channel.inner && r >= RING.ridge) {
        // A culvert under the raised forest, opening over the inner ramp wall; keep its roof intact.
        gap(LEVEL.bed, WATER.flood + UNIT);
        continue;
      }
      const level = across < CHANNEL.bed ? (r > edge - CHANNEL.lip ? Math.max(LEVEL.bed, channel.lip) : LEVEL.bed) : across < CHANNEL.bank ? LEVEL.shore : LEVEL.lowland;
      if (level < top) { top = level; material = across < CHANNEL.bed ? M.bed : M.mud; }
    }
    // The bridge court: level with the deck, a half step up to the forest on its lake and far sides.
    if (d >= COURT.from - COURT.step && d <= RAMP.start + COURT.step * 0.5 && r >= RING.path) {
      const inside = d >= COURT.from && r >= COURT.inner;
      top = inside ? LEVEL.court : LEVEL.lowland;
      material = M.path;
    }
    if (z >= BRIDGE.z + BRIDGE.deckStart && Math.abs(x) < BRIDGE.width / 2 + UNIT / 2) top = Math.min(top, LEVEL.court - UNIT);
    c.top = top; c.material = material;
    // The chamber is round, except at a reading stop, where its wall is one flat face.
    let chamber = r < CHAMBER_R;
    for (const stop of STOPS) {
      const along = x * Math.sin(stop) + z * Math.cos(stop), across = x * Math.cos(stop) - z * Math.sin(stop);
      if (Math.abs(across) < STOP.half && along > 0) chamber = along < CHAMBER_R;
    }
    if (chamber) gap(FLOOR, roofUnder(r));
    if (r < RAMP.r && r > CHAMBER_R - 2 && rillTailDistance(x, z) < RILL.half + UNIT * Math.SQRT1_2) {
      gap(down(FLOOR - RILL.depth - 0.08), FLOOR + UNIT);
    }
    if (a <= RAMP.sweep && Math.abs(r - RAMP.r) < rampHalf(a)) {
      const floor = rampY(a), gutter = a <= RILL.end + UNIT * Math.SQRT1_2 / (RAMP.r - RAMP.half) && a >= RILL.start - UNIT * Math.SQRT1_2 / (RAMP.r - RAMP.half) && r > rillInner(a) - (RILL.half - RILL.waterHalf) - UNIT * Math.SQRT1_2 && r < rillRadius(a) + RILL.half + UNIT * Math.SQRT1_2;
      gap(gutter ? down(floor - RILL.depth - 0.08) : stepUnder(floor), up(floor + RAMP.head));
    }
    // The level bay where the descent meets the chamber, through the wall between them.
    if (wrap(bearing - RAMP.start - RAMP.sweep + JUNCTION.before) <= JUNCTION.before + JUNCTION.after && r >= CHAMBER_R - 0.5 && r < RAMP.r + RAMP.bay) gap(FLOOR, FLOOR + JUNCTION.height);
    for (const door of DOORS) if (Math.abs(a - door.at * RAMP.sweep) * 18 < DOOR.half && r >= RAMP.r) gap(stepUnder(rampY(a)), stepUnder(rampY(a)) + DOOR.height);
    // A link: open from the descent out through each mouth, and along the gallery outside the pier.
    const link = linkAt(a);
    if (link) {
      const mouth = a < link.from * RAMP.sweep + LINK.mouth / 18 || a > link.to * RAMP.sweep - LINK.mouth / 18;
      if (r >= (mouth ? RAMP.r : RAMP.r + RAMP.half + LINK.rib)) gap(stepUnder(rampY(a)), up(rampY(a) + LINK.head));
    }
    if (Math.abs(a - WINDOW.at * RAMP.sweep) * 12.5 < WINDOW.half && r >= CHAMBER_R - 0.5 && r <= RAMP.r) gap(stepUnder(rampY(a)) + WINDOW.sill, stepUnder(rampY(a)) + WINDOW.top);
    return c;
  };

  // The grid, filled once for the page: materials for the mesher, and each column's top for everyone else.
  let built = null;
  const body = () => {
    if (built) return built;
    const data = new Uint8Array(SX * SY * SZ), heights = new Float32Array(SX * SZ).fill(-Infinity);
    for (let i = 0; i < SX; i++) for (let k = 0; k < SZ; k++) {
      const x = ORIGIN.x + (i + 0.5) * UNIT, z = ORIGIN.z + (k + 0.5) * UNIT, c = column(x, z);
      if (c.top === -Infinity) continue;
      let highest = -Infinity;
      // Tones come in patches a few metres across and courses a metre and a half deep, never a speckle of cells.
      const bx = Math.floor(x / 2), bz = Math.floor(z / 2), sector = Math.floor(c.bearing / TAU * 28), stony = c.ledge || c.r > edgeAt(c.bearing) - 1.5;
      // The wall a painting lies on is cut into metre squares: the Canvas 2D renderer sorts whole faces by depth,
      // and one long face would draw over half the paint.
      let wall = NaN;
      for (const stop of STOPS) {
        const along = x * Math.sin(stop) + z * Math.cos(stop), across = x * Math.cos(stop) - z * Math.sin(stop);
        if (Math.abs(across) < STOP.half && along > CHAMBER_R && along < CHAMBER_R + UNIT) wall = Math.floor(across);
      }
      for (let j = 0; j < SY; j++) {
        const y = ORIGIN.y + (j + 0.5) * UNIT;
        if (y > c.top || y < c.bottom) continue;
        let open = false;
        for (let g = 0; g < c.count && !open; g++) open = y > c.gaps[g * 2] && y < c.gaps[g * 2 + 1];
        if (open) continue;
        let material;
        if (y > c.top - UNIT) material = c.material;
        else if (y > c.top - 1.5 && c.top > FLOOR) material = stony ? M.stone : M.loam;
        else if (!stony && y > FLOOR - 1.5) material = y > FLOOR - UNIT && y < FLOOR ? M.floor : hash(bx, Math.floor(y / 1.5), bz) % 100 < 34 ? M.earthDark : M.earth;
        else {
          const band = hash(stony ? sector : bx, Math.floor(y / 1.5), stony ? 3 : bz) % 100;
          material = band < 28 ? M.stoneDark : stony && band > 88 ? M.moss : M.stone;
        }
        if (wall === wall && y > FLOOR && (wall + Math.floor(y)) & 1) material += TWIN;
        data[(i * SY + j) * SZ + k] = material;
        highest = y + UNIT / 2;
      }
      heights[i * SZ + k] = highest;
    }
    return built = { data, sx: SX, sy: SY, sz: SZ, heights };
  };
  const cellX = (x) => Math.floor((x - ORIGIN.x) / UNIT), cellZ = (z) => Math.floor((z - ORIGIN.z) / UNIT);
  // The top of the ground at a point, or -Infinity off the island and over the lake.
  const groundAt = (x, z) => {
    const i = cellX(x), k = cellZ(z);
    return i < 0 || k < 0 || i >= SX || k >= SZ ? -Infinity : body().heights[i * SZ + k];
  };
  const solidAt = (x, y, z) => {
    const i = cellX(x), j = Math.floor((y - ORIGIN.y) / UNIT), k = cellZ(z);
    return i >= 0 && j >= 0 && k >= 0 && i < SX && j < SY && k < SZ && body().data[(i * SY + j) * SZ + k] !== 0;
  };
  // Whether rock or the lake stands over a point: the tunnels, the chamber and the shaft, not the open forest.
  const covered = (x, y, z) => {
    const r = Math.hypot(x, z);
    if (r < LAKE_R) return y < membraneY(r);
    // A link counts as under the rock all the way out to its lip, though the lip itself stands under the sky:
    // daylight, the weather and the roof cut would otherwise change with every step along it.
    if (r >= RAMP.r) {
      const bearing = wrap(Math.atan2(x, z)), a = rampAngle(bearing), link = linkAt(a);
      if (link && r <= edgeAt(bearing) + link.lip && y > rampY(a) - 1 && y < rampY(a) + LINK.head + 1) return true;
    }
    const i = cellX(x), k = cellZ(z);
    if (i < 0 || k < 0 || i >= SX || k >= SZ) return false;
    const data = body().data;
    for (let j = Math.max(0, Math.floor((y - ORIGIN.y) / UNIT) + 1); j < SY; j++) if (data[(i * SY + j) * SZ + k]) return true;
    return false;
  };
  // What the outlines ask of this rock, as the home island's terrain answers for its own: whether a line of
  // sight misses every solid cell, and whether a box is all rock or all open. Exact walks of the grid; a line or
  // a box that leaves the grid finds nothing there, so it is clear and it is not solid.
  const clampCell = (v, most) => v < 0 ? 0 : v > most ? most : v;
  const sightClear = (x, y, z, toX, toY, toZ) => {
    const dx = toX - x, dy = toY - y, dz = toZ - z;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-12) return !solidAt(x, y, z);
    let lo = 0, hi = 1;
    for (let axis = 0; axis < 3; axis++) {
      const start = axis === 0 ? x : axis === 1 ? y : z, speed = axis === 0 ? dx : axis === 1 ? dy : dz;
      const min = axis === 0 ? ORIGIN.x : axis === 1 ? ORIGIN.y : ORIGIN.z, max = min + (axis === 0 ? SX : axis === 1 ? SY : SZ) * UNIT;
      if (!speed) { if (start < min || start >= max) return true; }
      else {
        const a = (min - start) / speed, b = (max - start) / speed;
        lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
        if (lo >= hi - 1e-12) return true;
      }
    }
    const data = body().data;
    let gx = clampCell(Math.floor((x + dx * lo - ORIGIN.x) / UNIT), SX - 1), gy = clampCell(Math.floor((y + dy * lo - ORIGIN.y) / UNIT), SY - 1), gz = clampCell(Math.floor((z + dz * lo - ORIGIN.z) / UNIT), SZ - 1);
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    const stepX = dx ? UNIT / Math.abs(dx) : Infinity, stepY = dy ? UNIT / Math.abs(dy) : Infinity, stepZ = dz ? UNIT / Math.abs(dz) : Infinity;
    let tx = dx ? (ORIGIN.x + (gx + (dx > 0 ? 1 : 0)) * UNIT - x) / dx : Infinity, ty = dy ? (ORIGIN.y + (gy + (dy > 0 ? 1 : 0)) * UNIT - y) / dy : Infinity, tz = dz ? (ORIGIN.z + (gz + (dz > 0 ? 1 : 0)) * UNIT - z) / dz : Infinity;
    let t = lo;
    for (let step = 0; step < SX + SY + SZ + 3; step++) {
      const end = Math.min(tx, ty, tz, hi);
      if (end > t + 1e-12 && data[(gx * SY + gy) * SZ + gz]) return false;
      if (end >= hi - 1e-12) break;
      if (tx <= end + 1e-12) { gx += sx; tx += stepX; }
      if (ty <= end + 1e-12) { gy += sy; ty += stepY; }
      if (tz <= end + 1e-12) { gz += sz; tz += stepZ; }
      if (gx < 0 || gx >= SX || gy < 0 || gy >= SY || gz < 0 || gz >= SZ) break;
      t = end;
    }
    return true;
  };
  const boxSolid = (x0, y0, z0, x1, y1, z1) => {
    const i0 = Math.floor((x0 - 1e-7 - ORIGIN.x) / UNIT), i1 = Math.floor((x1 + 1e-7 - ORIGIN.x) / UNIT), j0 = Math.floor((y0 - 1e-7 - ORIGIN.y) / UNIT), j1 = Math.floor((y1 + 1e-7 - ORIGIN.y) / UNIT), k0 = Math.floor((z0 - 1e-7 - ORIGIN.z) / UNIT), k1 = Math.floor((z1 + 1e-7 - ORIGIN.z) / UNIT);
    if (i0 < 0 || j0 < 0 || k0 < 0 || i1 >= SX || j1 >= SY || k1 >= SZ) return false;
    const data = body().data;
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) if (!data[(i * SY + j) * SZ + k]) return false;
    return true;
  };
  // A column whose top lies under the box is passed over whole.
  const boxClear = (x0, y0, z0, x1, y1, z1) => {
    const i0 = Math.max(0, Math.floor((x0 - 1e-7 - ORIGIN.x) / UNIT)), i1 = Math.min(SX - 1, Math.floor((x1 + 1e-7 - ORIGIN.x) / UNIT)), j0 = Math.max(0, Math.floor((y0 - 1e-7 - ORIGIN.y) / UNIT)), j1 = Math.min(SY - 1, Math.floor((y1 + 1e-7 - ORIGIN.y) / UNIT)), k0 = Math.max(0, Math.floor((z0 - 1e-7 - ORIGIN.z) / UNIT)), k1 = Math.min(SZ - 1, Math.floor((z1 + 1e-7 - ORIGIN.z) / UNIT));
    const grid = body(), data = grid.data, heights = grid.heights;
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
      if (heights[i * SZ + k] < y0 - 1e-7) continue;
      for (let j = j0; j <= j1; j++) if (data[(i * SY + j) * SZ + k]) return false;
    }
    return true;
  };
  // Whether a point is over the island's own ground, its lake or its ledge.
  const onIsland = (x, z, margin = 0) => {
    const r = Math.hypot(x, z);
    if (r + margin < LAKE_R) return true;
    const i = cellX(x), k = cellZ(z);
    if (i < 0 || k < 0 || i >= SX || k >= SZ) return false;
    if (!margin) return body().heights[i * SZ + k] > -Infinity;
    const bearing = wrap(Math.atan2(x, z)), edge = edgeAt(bearing);
    const lip = lipAt(bearing, r);
    return r + margin < edge || r + margin < edge + (lip || ledgeWidth(rampAngle(bearing))) && (lip > 0 || onLedge(rampAngle(bearing))) && body().heights[i * SZ + k] > -Infinity;
  };
  // Whether a point of the forest floor is a path, a court, a nest, a channel or the shore: kept clear of plants.
  const keptClear = (x, z, margin = 0) => {
    const r = Math.hypot(x, z), bearing = wrap(Math.atan2(x, z)), a = rampAngle(bearing), d = turn(bearing, 0);
    if (r < RING.path + margin) return true;
    if (d >= COURT.from - COURT.step - margin / r && d <= RAMP.start + COURT.step + margin / r) return true;
    for (const nest of NESTS) if (Math.abs(r - NEST.r) <= NEST.halfR + margin && Math.abs(turn(bearing, nest.bearing) * r) <= NEST.halfT + margin) return true;
    for (const channel of CHANNELS) if (r <= channel.to + margin && Math.abs(turn(bearing, channel.bearing) * r) < CHANNEL.low + margin) return true;
    // The ridge's own top is a path to the lookout over the mouth.
    return a <= RAMP.sweep && ridgeTop(a) > LEVEL.ground && Math.abs(r - RAMP.r) < 1.3 + margin;
  };
  // A point on the descent's centreline, `s` metres down it, offset `out` metres from the centre toward the cliff.
  const rampPoint = (s, out = 0, to = {}) => {
    const a = clamp(s, 0, RAMP.length) / RAMP.r, bearing = RAMP.start + a;
    to.x = Math.sin(bearing) * (RAMP.r + out); to.z = Math.cos(bearing) * (RAMP.r + out); to.y = rampY(a); to.bearing = bearing;
    return to;
  };
  // Every bed, nest by nest in turn so a short roster still spreads over all five: its root point and heading.
  const SLOTS = [];
  for (const row of [-1, 1]) for (const side of [-1, 1]) for (let n = 0; n < NESTS.length; n++) {
    const nest = NESTS[n], ux = Math.sin(nest.bearing), uz = Math.cos(nest.bearing), vx = uz, vz = -ux;
    // Heads to the middle of the nest: the outer row faces in, the inner row faces out.
    const heading = row > 0 ? nest.bearing + Math.PI : nest.bearing, fx = Math.sin(heading), fz = Math.cos(heading);
    const cx = ux * (NEST.r + row * SLOT.dr) + vx * side * SLOT.dt, cz = uz * (NEST.r + row * SLOT.dr) + vz * side * SLOT.dt;
    SLOTS.push({ nest: n, x: cx - fx * SLOT.lead, z: cz - fz * SLOT.lead, y: LEVEL.nest, heading, cx, cz });
  }
  for (const nest of NESTS) { nest.x = Math.sin(nest.bearing) * NEST.r; nest.z = Math.cos(nest.bearing) * NEST.r; nest.y = LEVEL.nest; }

  BL.poolLayout = {
    UNIT, R, LAKE_R, CHAMBER_R, SHAFT_R, FLOOR, MEMBRANE_DEPTH, LEVEL, WATER, RING, RAMP, DOORS, DOOR, BAYS, WINDOW, JUNCTION, LEDGE, LINK, LINKS, linkAt, lipAt, STOPS, STOP, COURT, BRIDGE, NEST, NESTS,
    CHANNEL, CHANNELS, channelOutlet, fallGap, RILL, rillRadius, rillInner, RILL_STATIONS, RILL_TAIL, rillTailPoint, rillTailDistance, rillJunctionY, HILLS, SLOT_GRID: SLOT, SLOTS, ORIGIN, SX, SY, SZ, M, PALETTE,
    wrap, turn, edgeAt, membraneY, waterRadius, rampAngle, rampY, rampHalf, stepUnder, roofUnder, onLedge, ledgeWidth, ledgeY, ridgeTop, column, body,
    groundAt, solidAt, covered, sightClear, boxSolid, boxClear, onIsland, keptClear, rampPoint
  };
})();
