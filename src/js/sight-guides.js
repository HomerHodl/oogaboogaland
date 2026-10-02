// Nearby surfaces the Ooga can see in any direction but the camera cannot.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const RADIUS = 12, FADE_START = 10.5, FADE_SECONDS = 0.25, OBSERVER_PIXELS = 256, EDGE_STEP = 0.035;
  const create = ({ segmentClear, objectClear, actorClear = objectClear, eyeAt = null, ownerBoundary = null, ownerPerceived = null, ownerConcealed = null, ownerDistance = null, ownerInView = null, ownerClear = null, getProvider = null }) => {
    let lines = new Float32Array(0), kinds = new Uint8Array(0), sources = new Uint32Array(0), alphas = new Float32Array(0), lineOwners = new Uint32Array(0);
    const owners = [], ownerProviders = [], retainedOwners = [];
    let ownerStates = new Uint8Array(0), ownerSlots = new Uint32Array(0), ownerViews = new Uint8Array(0);
    let ownerPhases = new Float64Array(0), ownerAlphas = new Float32Array(0), ownerTargets = new Float32Array(0), ownerDistances = new Float64Array(0), ownerSeen = new Uint8Array(0);
    const observer = new Float64Array(22), previous = new Float64Array(22), view = BL.math.mat4.create(), worldUp = { x: 0, y: 1, z: 0 }, eye = { x: 0, y: 0, z: 0 };
    previous.fill(NaN);
    const output = { lines, kinds, sources, alphas, owners, ownerProviders, ownerStates, ownerAlphas, ownerTargets, ownerDistances, ownerViews, retainedOwners, retainedCount: 0, ownerCount: 0, providerCount: 0, objectsEnabled: true, rockOnly: false, capacity: 0, ownerCapacity: 0, structureSourceCount: 0, bufferGrowths: 0, fading: 0, fadeSeconds: FADE_SECONDS, fadeStart: FADE_START, count: 0, kind: "perception", index: -1, basement: false, structureCount: 0, objectCount: 0, rays: 0, actorRays: 0, updates: 0, observer, radius: RADIUS, observerPixels: OBSERVER_PIXELS, edgeStep: EDGE_STEP };
    let actor = null, lastActor = null, lastStructure = null, lastObjects = -1, lastOcclusion = -1, lastNear = -1, lastEnabled = true, lastRockOnly = false, lo = 0, hi = 1;
    let ox = 0, oy = 0, oz = 0, tanX = 1, tanY = 1;
    const grow = (array, length) => { const next = new array.constructor(length); next.set(array); return next; };
    const reserveLines = (wanted) => {
      if (wanted <= output.capacity) return;
      const capacity = Math.max(1024, wanted, output.capacity * 2);
      output.lines = lines = grow(lines, capacity * 6); output.kinds = kinds = grow(kinds, capacity);
      output.sources = sources = grow(sources, capacity); output.alphas = alphas = grow(alphas, capacity);
      lineOwners = grow(lineOwners, capacity); output.capacity = capacity; output.bufferGrowths++;
    };
    const reserveOwners = (wanted) => {
      if (wanted <= owners.length) return;
      const capacity = Math.max(32, wanted, owners.length * 2);
      while (owners.length < capacity) { owners.push(null); ownerProviders.push(null); retainedOwners.push(null); }
      output.ownerStates = ownerStates = grow(ownerStates, capacity); output.ownerViews = ownerViews = grow(ownerViews, capacity);
      ownerPhases = grow(ownerPhases, capacity); ownerSeen = grow(ownerSeen, capacity);
      output.ownerAlphas = ownerAlphas = grow(ownerAlphas, capacity); output.ownerTargets = ownerTargets = grow(ownerTargets, capacity);
      output.ownerDistances = ownerDistances = grow(ownerDistances, capacity); output.ownerCapacity = capacity; output.bufferGrowths++;
    };
    const reserve = (source, structure) => {
      const edges = source ? source.capacity || source.count : 0;
      output.structureSourceCount = structure ? structure.count : 0;
      // Owner slots come from scene geometry; lines only ever hold what lies within RADIUS, so they start small and
      // keep their high-water size across camera/actor motion.
      reserveLines(1);
      reserveOwners(source ? source.ownerCapacity || source.nearCount || source.count : 0);
      if (edges > ownerSlots.length) { ownerSlots = grow(ownerSlots, edges); output.bufferGrowths++; }
    };
    const plane = (a, b) => {
      if (a < 0 && b < 0) return false;
      if (a < 0) lo = Math.max(lo, a / (a - b));
      else if (b < 0) hi = Math.min(hi, a / (a - b));
      return lo <= hi;
    };
    const actorSees = (x, y, z, targetOwner) => {
      const hx = x - eye.x, hy = y - eye.y, hz = z - eye.z, span = Math.hypot(hx, hy, hz);
      const end = Math.max(0, 1 - 0.018 / Math.max(span, 1e-9));
      output.actorRays++;
      // Perception has no facing cone, but nearby walls, ceilings and objects still block it; stop short of the
      // surface being identified.
      return segmentClear(eye.x, eye.y, eye.z, eye.x + hx * end, eye.y + hy * end, eye.z + hz * end)
        && actorClear(eye.x, eye.y, eye.z, eye.x + hx * end, eye.y + hy * end, eye.z + hz * end, actor, targetOwner);
    };
    const cameraHides = (x, y, z, targetOwner) => {
      const dx = x - ox, dy = y - oy, dz = z - oz, distance = Math.hypot(dx, dy, dz);
      const depth = dx * observer[9] + dy * observer[10] + dz * observer[11], start = observer[17] / depth;
      const right = dx * observer[3] + dy * observer[4] + dz * observer[5], up = dx * observer[6] + dy * observer[7] + dz * observer[8];
      if (depth < observer[17] || depth > observer[18] || Math.abs(right) > depth * tanX || Math.abs(up) > depth * tanY) return false;
      // Stop 0.018 short of the surface so its own solid face is not read as a blocker.
      // Intervening geometry still occludes.
      const k = Math.max(0, 1 - 0.018 / distance);
      if (start >= k) return false;
      x = ox + dx * k; y = oy + dy * k; z = oz + dz * k;
      output.rays++;
      // Geometry clipped behind the near plane cannot hide a rendered item; the selected body is excluded.
      const ax = ox + dx * start, ay = oy + dy * start, az = oz + dz * start;
      const blocked = !segmentClear(ax, ay, az, x, y, z) || !objectClear(ax, ay, az, x, y, z, actor, targetOwner);
      // A rear or buried surface of the same object must not make its unobstructed exterior count as hidden.
      return blocked && (!targetOwner || !ownerClear || ownerClear(targetOwner, ax, ay, az, x, y, z));
    };
    const eligible = (x, y, z, targetOwner, edgeX, edgeY, edgeZ, object) => {
      return object ? !ownerBoundary || ownerBoundary(targetOwner, x, y, z, edgeX, edgeY, edgeZ) : actorSees(x, y, z, null) && cameraHides(x, y, z, null);
    };
    const clearOwners = () => {
      owners.fill(null); ownerProviders.fill(null); retainedOwners.fill(null); ownerPhases.fill(0); ownerAlphas.fill(0); ownerTargets.fill(0); ownerStates.fill(0); ownerViews.fill(0);
      output.ownerCount = output.retainedCount = output.providerCount = output.fading = 0;
    };
    const pruneOwners = (source) => {
      const registry = source && source.nearOwners, count = source ? registry ? source.nearCount : source.count : 0;
      // Remove only truly absent owners: camera frustum/contour changes never drop owners from the near registry.
      for (let slot = 0; slot < output.ownerCount; slot++) {
        const owner = owners[slot];
        if (!owner) continue;
        let present = false;
        for (let n = 0; n < count; n++) if ((registry ? registry[n] : source.owners ? source.owners[n] : source) === owner) { present = true; break; }
        if (!present) { owners[slot] = ownerProviders[slot] = null; ownerPhases[slot] = ownerAlphas[slot] = ownerTargets[slot] = ownerStates[slot] = ownerViews[slot] = 0; }
      }
      while (output.ownerCount && owners[output.ownerCount - 1] === null) output.ownerCount--;
    };
    const perceiveObjects = (source) => {
      const registry = source && source.nearOwners, count = source ? registry ? source.nearCount : source.count : 0;
      ownerSeen.fill(0); ownerDistances.fill(Infinity);
      pruneOwners(source);
      for (let n = 0; n < count; n++) {
        const owner = registry ? registry[n] : source.owners ? source.owners[n] : source;
        let slot = 0;
        while (slot < output.ownerCount && owners[slot] !== owner) slot++;
        if (slot === output.ownerCount) {
          slot = 0;
          while (slot < output.ownerCount && owners[slot] !== null) slot++;
          reserveOwners(slot + 1);
          owners[slot] = owner; ownerPhases[slot] = ownerAlphas[slot] = ownerTargets[slot] = 0;
          ownerProviders[slot] = getProvider ? getProvider(owner) : null;
          output.ownerCount = Math.max(output.ownerCount, slot + 1);
        }
        if (!ownerSeen[slot]) {
          ownerSeen[slot] = 1;
          const oldHidden = ownerStates[slot] & 2;
          ownerViews[slot] = !ownerInView || ownerInView(owner) ? 1 : 0;
          ownerStates[slot] = ownerPerceived && ownerPerceived(owner, actor, eye.x, eye.y, eye.z, segmentClear) ? 1 : 0;
          // Remember an offscreen owner's hidden state and fade phase; on return only camera occlusion is re-evaluated.
          // rockOnly and partialOcclusion providers clip their own pixels, so keep the still-hidden remainder.
          if (output.rockOnly || ownerProviders[slot]?.partialOcclusion) ownerStates[slot] |= 2;
          else if (!ownerViews[slot]) ownerStates[slot] |= oldHidden;
          else if ((!ownerPerceived || ownerStates[slot] & 1 || ownerPhases[slot] > 0) && ownerConcealed && ownerConcealed(owner, actor, segmentClear)) ownerStates[slot] |= 2;
          if (registry) ownerDistances[slot] = source.nearDistances[n];
          else if (ownerDistance) ownerDistances[slot] = ownerDistance(owner, observer[0], observer[1], observer[2]);
        }
      }
      if (source) for (let n = 0; n < source.count; n++) {
        const owner = source.owners ? source.owners[n] : source;
        let slot = 0;
        while (slot < output.ownerCount && owners[slot] !== owner) slot++;
        ownerSlots[n] = slot;
        if (slot === output.ownerCount) continue;
        const v = source.lines, at = n * 6, ax = v[at], ay = v[at + 1], az = v[at + 2], dx = v[at + 3] - ax, dy = v[at + 4] - ay, dz = v[at + 5] - az;
        if (!registry && !ownerDistance) {
          const span2 = dx * dx + dy * dy + dz * dz;
          const t = span2 ? Math.max(0, Math.min(1, ((observer[0] - ax) * dx + (observer[1] - ay) * dy + (observer[2] - az) * dz) / span2)) : 0;
          ownerDistances[slot] = Math.min(ownerDistances[slot], Math.hypot(ax + dx * t - observer[0], ay + dy * t - observer[1], az + dz * t - observer[2]));
        }
        if (ownerPerceived && ownerConcealed || ownerStates[slot] === 3 || ownerPerceived && !(ownerStates[slot] & 1)) continue;
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / EDGE_STEP));
        for (let i = 0; i <= steps && ownerStates[slot] !== 3; i++) {
          const t = i / steps, x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
          // Production recognition is authoritative and camera-independent; ownerless line fixtures may use samples.
          if (!ownerPerceived && !(ownerStates[slot] & 1) && (x - observer[0]) ** 2 + (y - observer[1]) ** 2 + (z - observer[2]) ** 2 <= RADIUS * RADIUS && actorSees(x, y, z, owner)) ownerStates[slot] |= 1;
          if (!ownerConcealed && !(ownerStates[slot] & 2) && cameraHides(x, y, z, owner)) ownerStates[slot] |= 2;
        }
      }
      for (let slot = 0; slot < output.ownerCount; slot++) {
        if (!owners[slot]) continue;
        ownerTargets[slot] = ownerStates[slot] === 3 ? Math.max(0, Math.min(1, (RADIUS - ownerDistances[slot]) / (RADIUS - FADE_START))) : 0;
      }
    };
    const advanceFades = (dt) => {
      const step = Math.max(0, dt) / FADE_SECONDS, oldRetained = output.retainedCount;
      output.retainedCount = output.providerCount = output.fading = 0;
      for (let slot = 0; slot < output.ownerCount; slot++) {
        if (!owners[slot]) continue;
        const target = ownerTargets[slot], before = ownerPhases[slot];
        let phase = before < target ? Math.min(target, before + step) : Math.max(target, before - step);
        if (Math.abs(phase - target) < 1e-9) phase = target;
        ownerPhases[slot] = phase;
        ownerAlphas[slot] = phase * phase * (3 - 2 * phase);
        if (Math.abs(phase - target) > 1e-9) output.fading++;
        if (phase > 0) retainedOwners[output.retainedCount++] = owners[slot];
        if (phase > 0 && ownerProviders[slot] && ownerViews[slot] && ownerStates[slot] & 2) output.providerCount++;
      }
      for (let i = output.retainedCount; i < oldRetained; i++) retainedOwners[i] = null;
      // Geometry stays world-anchored and cached while only opacity changes; drop a finished fade without redoing
      // perception or edge queries.
      let kept = 0;
      output.objectCount = output.structureCount = 0;
      for (let n = 0; n < output.count; n++) {
        const kind = kinds[n], slot = lineOwners[n];
        if (kind && (!(ownerStates[slot] & 2) || ownerPhases[slot] === 0 && ownerTargets[slot] === 0)) continue;
        if (kept !== n) {
          for (let axis = 0; axis < 6; axis++) lines[kept * 6 + axis] = lines[n * 6 + axis];
          sources[kept] = sources[n]; kinds[kept] = kind; lineOwners[kept] = slot;
        }
        alphas[kept++] = kind ? ownerAlphas[slot] : 1;
        if (kind) output.objectCount++; else output.structureCount++;
      }
      output.count = kept;
    };
    const append = (ax, ay, az, dx, dy, dz, start, end, kind, source) => {
      if (end - start < 1e-5) return;
      reserveLines(output.count + 1);
      const i = output.count * 6;
      lines[i] = ax + dx * start; lines[i + 1] = ay + dy * start; lines[i + 2] = az + dz * start;
      lines[i + 3] = ax + dx * end; lines[i + 4] = ay + dy * end; lines[i + 5] = az + dz * end;
      sources[output.count] = source; lineOwners[output.count] = kind ? ownerSlots[source] : 0;
      alphas[output.count] = kind ? ownerAlphas[ownerSlots[source]] : 1; kinds[output.count++] = kind;
      if (kind) output.objectCount++; else output.structureCount++;
    };
    const filter = (source, kind) => {
      if (!source) return;
      const v = source.lines;
      for (let n = 0; n < source.count * 6; n += 6) {
        const slot = kind ? ownerSlots[n / 6] : 0;
        if (kind && (slot === output.ownerCount || ownerProviders[slot] || !(ownerStates[slot] & 2) || ownerPhases[slot] === 0 && ownerTargets[slot] === 0)) continue;
        const targetOwner = kind ? owners[slot] : null;
        const ax = v[n], ay = v[n + 1], az = v[n + 2], dx = v[n + 3] - ax, dy = v[n + 4] - ay, dz = v[n + 5] - az;
        const x = ax - ox, y = ay - oy, z = az - oz;
        const cx = x * observer[3] + y * observer[4] + z * observer[5], cy = x * observer[6] + y * observer[7] + z * observer[8], cz = x * observer[9] + y * observer[10] + z * observer[11];
        const ex = cx + dx * observer[3] + dy * observer[4] + dz * observer[5], ey = cy + dx * observer[6] + dy * observer[7] + dz * observer[8], ez = cz + dx * observer[9] + dy * observer[10] + dz * observer[11];
        const sx = ax - observer[0], sy = ay - observer[1], sz = az - observer[2], span2 = dx * dx + dy * dy + dz * dz, middle = sx * dx + sy * dy + sz * dz;
        const discriminant = middle * middle - span2 * (sx * sx + sy * sy + sz * sz - RADIUS * RADIUS);
        if (span2 < 1e-12 || !kind && discriminant <= 0) continue;
        const root = kind ? 0 : Math.sqrt(discriminant);
        lo = kind ? 0 : Math.max(0, (-middle - root) / span2); hi = kind ? 1 : Math.min(1, (-middle + root) / span2);
        if (lo >= hi || !plane(cz - observer[17], ez - observer[17]) || !plane(observer[18] - cz, observer[18] - ez)
          || !plane(cz * tanX + cx, ez * tanX + ex) || !plane(cz * tanX - cx, ez * tanX - ex)
          || !plane(cz * tanY + cy, ez * tanY + ey) || !plane(cz * tanY - cy, ez * tanY - ey)) continue;
        // Structure is clipped by perception; a recognized object keeps its full contour, only self-overlaps cut edges.
        const start = lo, end = hi, length = Math.hypot(dx, dy, dz) * (end - start);
        const za = cz + (ez - cz) * start, zb = cz + (ez - cz) * end;
        const pixelLength = OBSERVER_PIXELS / (2 * tanX) * Math.hypot((cx + (ex - cx) * end) / zb - (cx + (ex - cx) * start) / za, (cy + (ey - cy) * end) / zb - (cy + (ey - cy) * start) / za);
        let t0 = start, wasHidden = eligible(ax + dx * t0, ay + dy * t0, az + dz * t0, targetOwner, dx, dy, dz, kind), run = wasHidden ? t0 : -1;
        let q = 0;
        while (q < 1) {
          // Bound every interval in world space and in the camera's projection, even when endpoint visibility agrees;
          // perspective-correct spacing catches thin blockers and narrow slits.
          const s = q * zb / (za * (1 - q) + q * zb), nextS = Math.min(1, s + 1 / Math.max(1, pixelLength));
          const projectedQ = nextS * za / (zb * (1 - nextS) + nextS * za);
          q = Math.min(1, q + EDGE_STEP / Math.max(length, 1e-9), projectedQ);
          const t1 = start + (end - start) * q, isHidden = eligible(ax + dx * t1, ay + dy * t1, az + dz * t1, targetOwner, dx, dy, dz, kind);
          if (wasHidden !== isHidden) {
            let a = t0, b = t1;
            for (let refine = 0; refine < 5; refine++) {
              const t = (a + b) / 2;
              if (eligible(ax + dx * t, ay + dy * t, az + dz * t, targetOwner, dx, dy, dz, kind) === wasHidden) a = t; else b = t;
            }
            if (isHidden) run = b;
            else { append(ax, ay, az, dx, dy, dz, run, a, kind, n / 6); run = -1; }
          }
          t0 = t1; wasHidden = isHidden;
        }
        if (run >= 0) append(ax, ay, az, dx, dy, dz, run, t0, kind, n / 6);
      }
    };
    let sinceCompute = Infinity;
    // `recomputeHz` throttles motion-driven recomputes to that many a second of game time; 0 (the default,
    // and what every direct caller gets) recomputes on every change, as the checks expect.
    const update = (cave, structure, objects, camera, aspect, dt = 0, objectsEnabled = true, rockOnly = false, recomputeHz = 0) => {
      actor = cave;
      output.objectsEnabled = objectsEnabled;
      output.rockOnly = rockOnly;
      if (!actor) { output.count = output.structureCount = output.objectCount = 0; clearOwners(); lastActor = null; return output; }
      reserve(objects, structure);
      if (actor !== lastActor) clearOwners();
      const p = camera.position, center = cave.root.position;
      if (eyeAt) eyeAt(cave, eye);
      else { eye.x = center.x; eye.y = center.y; eye.z = center.z; }
      ox = p.x; oy = p.y; oz = p.z;
      observer[0] = center.x; observer[1] = center.y; observer[2] = center.z;
      BL.math.mat4.lookAt(view, camera.position, camera.target, camera.up || worldUp);
      observer[3] = view[0]; observer[4] = view[4]; observer[5] = view[8];
      observer[6] = view[1]; observer[7] = view[5]; observer[8] = view[9];
      observer[9] = -view[2]; observer[10] = -view[6]; observer[11] = -view[10];
      observer[12] = tanX = Math.tan(camera.fov / 2) * aspect; observer[13] = tanY = Math.tan(camera.fov / 2);
      observer[14] = ox; observer[15] = oy; observer[16] = oz; observer[17] = camera.near; observer[18] = camera.far;
      observer[19] = eye.x; observer[20] = eye.y; observer[21] = eye.z;
      // An actor, structure or mode change recomputes at once; registry versions tick as the player walks and
      // are throttled with motion.
      const versionChanged = cave !== lastActor || structure !== lastStructure || objectsEnabled !== lastEnabled || rockOnly !== lastRockOnly;
      const registryChanged = objects.version !== lastObjects || objects.occlusionVersion !== lastOcclusion || objects.nearVersion !== lastNear;
      let changed = versionChanged || registryChanged;
      for (let i = 0; i < observer.length && !changed; i++) if (Math.abs(observer[i] - previous[i]) > 1e-5 || !Number.isFinite(previous[i])) changed = true;
      // Perception and edge clipping are the frame's dearest work, and the lines are world-anchored, so a
      // move alone recomputes them at most RECOMPUTE_HZ times a second of game time; anything else at once.
      sinceCompute += Math.max(0, dt);
      if (changed && !versionChanged && recomputeHz > 0 && sinceCompute < 1 / recomputeHz) changed = false;
      if (!changed) { if (objectsEnabled && output.fading) advanceFades(dt); return output; }
      sinceCompute = 0;
      previous.set(observer); lastActor = cave; lastStructure = structure; lastObjects = objects.version; lastOcclusion = objects.occlusionVersion; lastNear = objects.nearVersion; lastEnabled = objectsEnabled; lastRockOnly = rockOnly;
      output.count = output.structureCount = output.objectCount = output.rays = output.actorRays = 0;
      output.index = structure ? structure.index : -1; output.basement = !!(structure && structure.basement);
      if (objectsEnabled) { perceiveObjects(objects); advanceFades(dt); }
      else {
        // Any visible part of the Ooga, or first person, hides every cue; keep remembered owners, skip outline work.
        pruneOwners(objects);
        for (let n = 0; n < output.retainedCount; n++) retainedOwners[n] = null;
        output.retainedCount = output.providerCount = output.fading = 0;
      }
      if (objectsEnabled) { filter(structure, 0); filter(objects, 1); }
      output.updates++;
      return output;
    };
    const dispose = () => { actor = lastActor = lastStructure = null; clearOwners(); output.count = output.structureCount = output.objectCount = 0; };
    return { update, reserve, dispose, state: output };
  };
  BL.sightGuides = { create };
})();
