// Fixed walking routes between the meadow and the headquarters beds.
//
// A validated waypoint graph from the meadow down to the HQ and basement beds, memoised per island and
// remapped onto each visit's beds. `create` returns `route`, `plan` (the same route a leg at a time, for a
// caller that spreads planning over frames), `clearSegment` (continuous floor plus architectural clearance,
// the shortcut test the crew reuses), `points`, `radius`, `height`, and the node and edge counts.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const RADIUS = 0.3, HEIGHT = 2, STEP = 0.6, SAMPLE = 0.125;
  // The validated waypoint graph depends only on the island's architecture; later visits reuse it and map
  // fresh bed objects onto its nodes.
  const graphs = new WeakMap();
  // Reserved sleeping rectangles on the rainforest terraces above the Mempool ramp.
  // Sample the whole footprint, not just its centre, to reject channels, terrace
  // edges and props. These are floor anchors, with no mattress or rendered items.
  const outdoorBeds = (pool, clear = () => true) => {
    const beds = [];
    const L = pool.layout;
    for (let along = 4; along <= 38; along += 3.6) {
      const bearing = L.RAMP.start + along / L.RAMP.r, sr = Math.sin(bearing), cr = Math.cos(bearing);
      for (const radius of [13.9, 16.2, 18.5]) {
        const lx = sr * radius, lz = cr * radius, x = pool.worldX(lx, lz), z = pool.worldZ(lx, lz);
        let low = Infinity, high = -Infinity;
        for (let a = -0.75; a <= 0.75; a += 0.25) for (let b = -1.5; b <= 1.5; b += 0.25) {
          const y = L.groundAt(lx + sr * a + cr * b, lz + cr * a - sr * b);
          low = Math.min(low, y); high = Math.max(high, y);
        }
        if (low < L.LEVEL.ground || high - low > 0.5 || !Number.isFinite(high)) continue;
        let safe = true;
        for (let a = -0.75; safe && a <= 0.75; a += 0.25) for (let b = -1.5; safe && b <= 1.5; b += 0.25) {
          safe = clear(pool.worldX(lx + sr * a + cr * b, lz + cr * a - sr * b), pool.place.y + high + 0.03,
            pool.worldZ(lx + sr * a + cr * b, lz + cr * a - sr * b));
        }
        if (safe) beds.push({ x, y: pool.place.y + high, z, outdoor: true, sleeper: null,
          node: { rotation: { y: pool.place.ry + bearing + Math.PI / 2 } } });
      }
    }
    return beds;
  };
  const create = ({ island, beds, walkable = null, surfaceRoute = null }) => {
    const cached = graphs.get(island), reuse = !!cached && cached.bedIds.length === beds.length;
    const H = island.headquarters, points = reuse ? cached.points : [], edges = reuse ? cached.edges : [], bedNodes = new Map(), surface = [], exits = reuse ? cached.exits : [];
    const floorAt = (x, y, z) => island.supportAt(x, z, y, STEP, -120, RADIUS);
    const clear = (x, y, z, lift = STEP) => island.clearAt(x, y + lift, z, RADIUS, HEIGHT - lift) && island.ceilingAt(x, y, z, RADIUS) >= y + HEIGHT - 1e-7;
    const segment = (a, b, surfaceOnly = false, lift = STEP) => {
      const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (lift < STEP ? 0.025 : SAMPLE)));
      let x = a.x, y = a.y, z = a.z;
      if (!clear(x, y, z, lift)) return false;
      for (let i = 1; i <= count; i++) {
        const t = i / count, nx = a.x + (b.x - a.x) * t, nz = a.z + (b.z - a.z) * t, guide = a.y + (b.y - a.y) * t;
        const ny = floorAt(nx, surfaceOnly ? island.surfaceAt(nx, nz) : guide, nz);
        // A route follows support, never a drop into another layer or the shaft.
        if ((surfaceOnly ? ny < -1e-7 : Math.abs(ny - guide) > STEP + 1e-6) || Math.abs(ny - y) > STEP + 1e-6 || !clear(nx, ny, nz, lift)) return false;
        if (!island.voxelSegmentClearAt(x, y + lift, z, nx, ny + lift, nz, RADIUS, HEIGHT - lift)) return false;
        if (walkable && !walkable(x, z, nx, nz, y, HEIGHT)) return false;
        x = nx; y = ny; z = nz;
      }
      return Math.abs(y - b.y) < 0.025;
    };
    const node = (x, y, z) => {
      const floor = floorAt(x, y, z);
      if (Math.abs(floor - y) > STEP + 1e-6 || !clear(x, floor, z)) throw new Error(`Headquarters sleep waypoint has no clear floor: ${x},${y},${z} (support ${floor})`);
      const id = points.length;
      points.push({ x, y: floor, z }); edges.push([]);
      return id;
    };
    const link = (a, b) => {
      if (!segment(points[a], points[b]) || !segment(points[b], points[a])) return false;
      const p = points[a], q = points[b], cost = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      edges[a].push({ to: b, cost }); edges[b].push({ to: a, cost });
      return true;
    };
    const requireLink = (a, b) => { if (!link(a, b)) throw new Error(`Headquarters sleep route crosses rock: ${a} to ${b}`); };
    const ring = (radius, y, count) => {
      const ids = [];
      for (let i = 0; i < count; i++) { const angle = i * Math.PI * 2 / count; ids.push(node(Math.sin(angle) * radius, y, -Math.cos(angle) * radius)); }
      for (let i = 0; i < count; i++) requireLink(ids[i], ids[(i + 1) % count]);
      return ids;
    };
    const joinRing = (id, ids) => {
      const p = points[id]; let closest = 0, distance = Infinity;
      for (let i = 0; i < ids.length; i++) { const q = points[ids[i]], d = (p.x - q.x) ** 2 + (p.z - q.z) ** 2; if (d < distance) { distance = d; closest = i; } }
      requireLink(id, ids[closest]);
    };
    const chain = (samples) => {
      let first = -1, previous = -1;
      for (const p of samples) {
        const id = node(p.x, p.y, p.z);
        if (previous >= 0) requireLink(previous, id); else first = id;
        previous = id;
      }
      return { first, last: previous };
    };
    if (reuse) {
      beds.forEach((bed, i) => bedNodes.set(bed, cached.bedIds[i]));
    } else {
      surface.push(...ring(17, 0, 72));
      const upper = ring(11, H.floor, 48), lower = ring(7, H.basement.floor, 48);
      for (const ramp of H.ramps) {
        const m = island.mouths.find((mouth) => mouth.id === ramp.id), apron = node(m.apron.x, 0, m.apron.z), route = chain(ramp.samples);
        exits.push(apron);
        joinRing(apron, surface); requireLink(apron, route.first); joinRing(route.last, upper);
      }
      for (const ramp of H.basement.ramps) {
        const route = chain(ramp.samples);
        joinRing(route.first, upper); joinRing(route.last, lower);
      }
      for (const bed of beds) {
        const room = bed.room, approach = node(room.approach.x, room.floor, room.approach.z), entrance = node(room.entrance.x, room.floor, room.entrance.z), center = node(room.x, room.floor, room.z), at = bed.walkAt;
        const end = node(at.x, room.floor, at.z);
        joinRing(approach, room.basement ? lower : upper);
        requireLink(approach, entrance); requireLink(entrance, center); requireLink(center, end);
        bedNodes.set(bed, end);
      }
      graphs.set(island, { points, edges, exits, bedIds: beds.map((bed) => bedNodes.get(bed)) });
    }
    // Search storage belongs to this visit and is reused for each state change.
    const size = points.length, distance = new Float64Array(size), previous = new Int32Array(size), visited = new Uint8Array(size);
    // Planning pauses (`yield`) after each leg it tests, so a caller can spread a route over frames (`plan`); `route`
    // runs one straight through. Only the graph search runs unbroken, so it keeps the shared search storage.
    const rounded = function* (route) {
      const result = [route[0]];
      for (let i = 1; i < route.length - 1; i++) {
        const before = route[i - 1], corner = route[i], after = route[i + 1];
        const ax = corner.x - before.x, az = corner.z - before.z, bx = after.x - corner.x, bz = after.z - corner.z;
        const incoming = Math.hypot(ax, az), outgoing = Math.hypot(bx, bz);
        if (incoming < 1e-6 || outgoing < 1e-6 || (ax * bx + az * bz) / (incoming * outgoing) > 0.999) { result.push(corner); continue; }
        let curve = null, reach = Math.min(0.9, incoming * 0.4, outgoing * 0.4);
        // Round turns only as far as the real floor, walls and headroom allow; build and validate once per chosen
        // route, never per frame.
        for (let attempt = 0; attempt < 4 && !curve; attempt++, reach *= 0.5) {
          const a = { x: corner.x - ax * reach / incoming, y: corner.y + (before.y - corner.y) * reach / incoming, z: corner.z - az * reach / incoming };
          const b = { x: corner.x + bx * reach / outgoing, y: corner.y + (after.y - corner.y) * reach / outgoing, z: corner.z + bz * reach / outgoing };
          a.y = floorAt(a.x, a.y, a.z); b.y = floorAt(b.x, b.y, b.z);
          const samples = [a], steps = Math.max(4, Math.ceil(reach * 2 / SAMPLE));
          let valid = segment(result[result.length - 1], a, false, 0.3);
          yield;
          for (let n = 1; valid && n <= steps; n++) {
            const t = n / steps, u = 1 - t;
            const x = u * u * a.x + 2 * u * t * corner.x + t * t * b.x, z = u * u * a.z + 2 * u * t * corner.z + t * t * b.z;
            const guide = u * u * a.y + 2 * u * t * corner.y + t * t * b.y, y = floorAt(x, guide, z), p = { x, y, z };
            valid = Math.abs(y - guide) <= STEP + 1e-6 && segment(samples[samples.length - 1], p, false, 0.3);
            samples.push(p);
            yield;
          }
          if (valid && segment(b, after, false, 0.3)) curve = samples;
          yield;
        }
        if (curve) result.push(...curve); else result.push(corner);
      }
      result.push(route[route.length - 1]);
      return result;
    };
    const attach = function* (from, onlySurface, out) {
      const candidates = new Int32Array(16).fill(-1), candidateDistance = new Float64Array(16).fill(Infinity);
      const count = size;
      for (let j = 0; j < count; j++) {
        const id = j, p = points[id];
        if (onlySurface && p.y < -1e-7) continue;
        if (!onlySurface && Math.abs(p.y - from.y) > STEP + 1e-6) continue;
        const d = Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z);
        if (d >= candidateDistance[15]) continue;
        let k = 15;
        while (k > 0 && d < candidateDistance[k - 1]) { candidates[k] = candidates[k - 1]; candidateDistance[k] = candidateDistance[k - 1]; k--; }
        candidates[k] = id; candidateDistance[k] = d;
      }
      for (let i = 0; i < candidates.length; i++) {
        if (candidates[i] >= 0 && segment(from, points[candidates[i]], onlySurface) && segment(points[candidates[i]], from, onlySurface)) out.push({ id: candidates[i], cost: candidateDistance[i] });
        yield;
      }
    };
    const plan = function* (x, y, z, bed, toBed, homeX = 0, homeZ = -16, exitAtApron = false) {
      const from = { x, y, z }, starts = [], ends = [];
      yield* attach(from, y >= -0.1, starts);
      let target = null;
      if (toBed) {
        const id = bedNodes.get(bed);
        if (id === undefined) return null;
        ends.push({ id, cost: 0 });
      } else if (exitAtApron) {
        // Chilling Oogas leave the HQ ramp at its apron, then head directly to a rest spot.
        for (const id of exits) ends.push({ id, cost: 0 });
      } else {
        target = { x: homeX, y: island.surfaceAt(homeX, homeZ), z: homeZ };
        yield* attach(target, true, ends);
      }
      if (!starts.length || !ends.length) return null;
      distance.fill(Infinity); previous.fill(-1); visited.fill(0);
      for (const start of starts) distance[start.id] = start.cost;
      for (let count = 0; count < size; count++) {
        let current = -1, best = Infinity;
        for (let i = 0; i < size; i++) if (!visited[i] && distance[i] < best) { best = distance[i]; current = i; }
        if (current < 0) break;
        visited[current] = 1;
        for (const edge of edges[current]) {
          const next = best + edge.cost;
          if (next < distance[edge.to]) { distance[edge.to] = next; previous[edge.to] = current; }
        }
      }
      let end = -1, best = Infinity;
      for (const candidate of ends) if (distance[candidate.id] + candidate.cost < best) { best = distance[candidate.id] + candidate.cost; end = candidate.id; }
      if (end < 0) return null;
      const result = [];
      for (let i = end; i >= 0; i = previous[i]) result.push(points[i]);
      result.push(from); result.reverse();
      if (target) result.push(target);
      const simplified = [];
      for (const p of result) {
        simplified.push(p);
        while (simplified.length >= 3) {
          const n = simplified.length, a = simplified[n - 3], b = simplified[n - 2];
          const ax = b.x - a.x, az = b.z - a.z, bx = p.x - b.x, bz = p.z - b.z;
          const almostFlat = Math.max(a.y, b.y, p.y) - Math.min(a.y, b.y, p.y) < 0.04;
          const straight = ax * bx + az * bz > Math.hypot(ax, az) * Math.hypot(bx, bz) * 0.99;
          // Keep slope bends, but let their nearly straight, shallow tails merge into the landing. Otherwise the
          // last tiny height change restricts the next corner's rounding to a few centimetres.
          const flat = Math.abs(a.y - b.y) <= 1e-7 && Math.abs(a.y - p.y) <= 1e-7;
          if (a.y >= -0.05 || !(flat || almostFlat && straight)) break;
          const clear = segment(a, p, false, 0.3);
          yield;
          if (!clear) break;
          simplified.splice(n - 2, 1);
        }
      }
      const smooth = yield* rounded(simplified);
      if (surfaceRoute && !exitAtApron) {
        let join = -1;
        if (toBed) {
          for (let i = 0; i < smooth.length && smooth[i].y >= -1e-7; i++) join = i;
        } else {
          for (let i = smooth.length - 1; i >= 0 && smooth[i].y >= -1e-7; i--) join = i;
        }
        if (join >= 0) {
          const above = toBed ? surfaceRoute(smooth[0], smooth[join]) : surfaceRoute(smooth[join], smooth[smooth.length - 1]);
          let valid = true;
          for (let i = 1; valid && i < above.length; i++) { valid = segment(above[i - 1], above[i], true, 0.3); yield; }
          if (valid) return toBed ? above.concat(smooth.slice(join + 1)) : smooth.slice(0, join).concat(above);
        }
      }
      return smooth;
    };
    const route = (...args) => {
      const planning = plan(...args);
      for (;;) { const step = planning.next(); if (step.done) return step.value; }
    };
    return { route, plan, clearSegment: segment, points, radius: RADIUS, height: HEIGHT, nodeCount: size, edgeCount: edges.reduce((sum, list) => sum + list.length, 0) / 2 };
  };
  BL.headquartersSleep = { create, outdoorBeds };
})();
