// Cached camera silhouettes and exact local-space visibility queries.
//
// The registry behind every object outline. Camera silhouettes are baked once per vertex array and never
// written again; the queries are exact local-space visibility, proximity, occlusion and actor tests:
// `register`, `collect`, `refresh`, `cameraClear`, `perceptionClear`, `perceived`, `concealed`, `distance`,
// `inView`, `actorVisible`, `ownerBoundaryAt`. Providers (the pile, the platform, the mirror) join the same
// registry through `create({ providers })`. sight-guides.js draws the result.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const RANGE = 12, SURFACE_STEP = 0.1, EDGE_STEP = 0.035, SAMPLE_BLOCK = 32, BOUNDARY_GRID = 8, EPS = 1e-6;
  // A bake reads only verts and each face's index list and is never written after build; shared vertex arrays
  // reuse one bake per page instead of per registry.
  const bakes = new WeakMap();
  const create = ({ roots, crew, actorRoots = [], exclude = [], providers = [], propsBlockActor = true, perceptionThrough = null }) => {
    const excluded = new Set(exclude), geometries = new Map(), registered = [], seen = new Set(), entries = new Map(), ownerEntries = new Map(), ownerGroups = [];
    const aliases = new Map(), providerOwners = new Map();
    for (const provider of providers) {
      providerOwners.set(provider.owner, provider);
      for (const node of provider.roots) aliases.set(node, provider.owner);
    }
    const sceneRoot = roots.length ? roots[0].parent : null, stack = new Int32Array(64), boundaryView = new Float64Array(16);
    let candidates = [], occluders = [], cameraOccluders = [], targetOccluders = [], perceptionOccluders = [];
    let lines = new Float32Array(0), owners = [], nearOwners = [], nearDistances = new Float64Array(0);
    const result = { lines, owners, count: 0, contours: 0, capacity: 0, version: 0, occlusionVersion: 0, structuralVersion: 0, perceptionVersion: 0, nearOwners, nearDistances, nearCount: 0, nearVersion: 0, ownerCapacity: 0 };
    const stats = { geometries: 0, registered: 0, candidates: 0, occluders: 0, cameraOccluders: 0, limit: 0, nodes: 0, owners: 0, nearOwners: 0, triangles: 0, samples: 0, perceptionQueries: 0, perceptionCacheHits: 0, perceptionWitnessHits: 0, cameraWitnessHits: 0, cameraCertificates: 0, boundaryTriangles: 0, boundaryBuilds: 0, boundaryEntries: 0, boundaryNodes: 0, boundaryGridBuilds: 0, boundaryGridQueries: 0, boundaryGridBytes: 0, boundaryGridReferences: 0 };
    const characterRoots = new Map();
    let ignoredPerceptionOwner = null;
    let targetCount = 0, targetStamp = -1, targetOwnerCache = null, targetX = 0, targetY = 0, targetZ = 0, targetRadius = 0;
    const cameraView = BL.math.mat4.create(), worldUp = { x: 0, y: 1, z: 0 };
    let candidateCount = 0, occluderCount = 0, cameraOccluderCount = 0, perceptionOccluderCount = 0, collectStamp = 0;
    let cameraCoverEntry = null, cameraCoverSource = null, cameraCoverFace = -1;
    let activeCamera = null, cameraAspect = 1, hasCamera = false, near = 0, far = Infinity, tanX = 1, tanY = 1, planeX = 1, planeY = 1, cameraX = 0, cameraY = 0, cameraZ = 0;
    let lineUsed = 0, linesChanged = false, edgeLo = 0, edgeHi = 1;
    const cameraIncludes = (x, y, z, radius) => {
      if (!hasCamera) return true;
      const m = cameraView, cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], depth = -(m[2] * x + m[6] * y + m[10] * z + m[14]);
      return depth + radius >= near && depth - radius <= far && Math.abs(cx) <= depth * tanX + radius * planeX && Math.abs(cy) <= depth * tanY + radius * planeY;
    };
    const cameraBoundsIncludes = (worldX, worldY, worldZ, hx, hy, hz) => {
      const m = cameraView, x = worldX - cameraX, y = worldY - cameraY, z = worldZ - cameraZ, depth = -(m[2] * x + m[6] * y + m[10] * z);
      const reach = Math.abs(m[2]) * hx + Math.abs(m[6]) * hy + Math.abs(m[10]) * hz;
      if (depth + reach < near || depth - reach > far) return false;
      for (let side = -1; side <= 1; side += 2) for (let axis = 0; axis < 2; axis++) {
        const tan = axis ? tanY : tanX, nx = side * m[axis] + tan * m[2], ny = side * m[axis + 4] + tan * m[6], nz = side * m[axis + 8] + tan * m[10];
        if (nx * x + ny * y + nz * z > Math.abs(nx) * hx + Math.abs(ny) * hy + Math.abs(nz) * hz) return false;
      }
      return true;
    };
    const cameraBoxIncludes = (e) => cameraBoundsIncludes(e.x, e.y, e.z, e.hx, e.hy, e.hz);
    const geometryOf = (geometry) => {
      if (!geometry || excluded.has(geometry) || geometry.matrixGlyph || !geometry.faces || !geometry.faces.length) return null;
      let cached = geometries.get(geometry);
      if (cached) return cached;
      const baked = bakes.get(geometry.verts);
      if (baked) for (const bake of baked) {
        let same = bake.faces.length === geometry.faces.length;
        for (let n = 0; same && n < bake.faces.length; n++) same = bake.faces[n] === geometry.faces[n].i;
        if (!same) continue;
        cached = bake.record;
        geometries.set(geometry, cached); stats.geometries++; stats.triangles += cached.triangles.length / 9; stats.samples += cached.samples.length / 3;
        return cached;
      }
      // Triangle buffers take every face's fan up front (skipped faces leave their slots unused) and the witnesses
      // grow a typed buffer, so the bake does not grow JS arrays through the island's hundreds of thousands of faces.
      let slots = 0;
      for (const face of geometry.faces) if (face.i.length > 2) slots += face.i.length - 2;
      const v = geometry.verts, triangles = new Float64Array(slots * 9), triangleBounds = new Float64Array(slots * 6), triangleCoverFaces = new Int32Array(slots), coverFaces = [], edgeMap = new Map(), planes = new Map();
      let count = 0;
      // Witnesses dedupe by rounded coordinates, first point kept, in insertion order: an open-addressing table of
      // id + 1 over each id's rounded key triplet, doubled at half load.
      let samplePoints = new Float64Array(1536), sampleCount = 0;
      const vertexIds = new Int32Array(v.length / 3);
      let sampleSlots = new Int32Array(1024), sampleKeys = new Float64Array(1536);
      const sampleSlot = (slots, kx, ky, kz) => {
        let h = Math.imul(kx | 0, 73856093) ^ Math.imul(ky | 0, 19349663) ^ Math.imul(kz | 0, 83492791);
        h = Math.imul(h ^ h >>> 16, 0x85ebca6b); h ^= h >>> 13;
        const mask = slots.length - 1;
        let slot = h & mask;
        for (let id = slots[slot] - 1; id >= 0 && !(sampleKeys[id * 3] === kx && sampleKeys[id * 3 + 1] === ky && sampleKeys[id * 3 + 2] === kz); id = slots[slot] - 1) slot = slot + 1 & mask;
        return slot;
      };
      const sample = (x, y, z) => {
        const kx = Math.round(x / EPS), ky = Math.round(y / EPS), kz = Math.round(z / EPS), slot = sampleSlot(sampleSlots, kx, ky, kz);
        if (sampleSlots[slot]) return sampleSlots[slot] - 1;
        const id = sampleCount++;
        if (id * 3 + 3 > samplePoints.length) { const points = new Float64Array(samplePoints.length * 2); points.set(samplePoints); samplePoints = points; }
        samplePoints[id * 3] = x; samplePoints[id * 3 + 1] = y; samplePoints[id * 3 + 2] = z;
        if (id * 3 + 3 > sampleKeys.length) { const keys = new Float64Array(sampleKeys.length * 2); keys.set(sampleKeys); sampleKeys = keys; }
        sampleKeys[id * 3] = kx; sampleKeys[id * 3 + 1] = ky; sampleKeys[id * 3 + 2] = kz;
        sampleSlots[slot] = id + 1;
        if ((id + 1) * 2 > sampleSlots.length) {
          const slots = new Int32Array(sampleSlots.length * 2);
          for (let n = 0; n <= id; n++) slots[sampleSlot(slots, sampleKeys[n * 3], sampleKeys[n * 3 + 1], sampleKeys[n * 3 + 2])] = n + 1;
          sampleSlots = slots;
        }
        return id;
      };
      // Interior witnesses are needed when a window reveals only a patch between vertices, face centers and contour:
      // project a regular grid onto the actual convex face; paint seams dedupe. One closure and point serve every face.
      const point = [0, 0, 0];
      let face = null, a = 0, u = 0, w = 0, drop = 0;
      const interior = (pu, pw) => {
        // Some tube quads bend slightly: interpolate their actual triangle fan so every witness lies on a rendered
        // surface, not its plane.
        for (let j = 1; j < face.i.length - 1; j++) {
          const b = face.i[j] * 3, c = face.i[j + 1] * 3, bu = v[b + u] - v[a + u], bw = v[b + w] - v[a + w], cu = v[c + u] - v[a + u], cw = v[c + w] - v[a + w], determinant = bu * cw - bw * cu;
          if (Math.abs(determinant) < 1e-12) continue;
          const du = pu - v[a + u], dw = pw - v[a + w], beta = (du * cw - dw * cu) / determinant, gamma = (bu * dw - bw * du) / determinant;
          if (beta < -EPS || gamma < -EPS || beta + gamma > 1 + EPS) continue;
          point[u] = pu; point[w] = pw; point[drop] = v[a + drop] + beta * (v[b + drop] - v[a + drop]) + gamma * (v[c + drop] - v[a + drop]);
          sample(point[0], point[1], point[2]); return;
        }
      };
      for (let faceIndex = 0; faceIndex < geometry.faces.length; faceIndex++) {
        face = geometry.faces[faceIndex];
        if (face.i.length < 3) continue;
        a = face.i[0] * 3;
        const b = face.i[1] * 3, c = face.i[2] * 3;
        const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], vx = v[c] - v[a], vy = v[c + 1] - v[a + 1], vz = v[c + 2] - v[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const length = Math.hypot(nx, ny, nz);
        if (length < EPS) continue;
        nx /= length; ny /= length; nz /= length;
        let convex = true;
        for (let j = 0; j < face.i.length && convex; j++) {
          const p = face.i[j] * 3, q = face.i[(j + 1) % face.i.length] * 3;
          if (Math.abs(nx * (v[p] - v[a]) + ny * (v[p + 1] - v[a + 1]) + nz * (v[p + 2] - v[a + 2])) > 1e-7) { convex = false; break; }
          const ux = v[q] - v[p], uy = v[q + 1] - v[p + 1], uz = v[q + 2] - v[p + 2];
          for (const vertex of face.i) {
            const r = vertex * 3, vx = v[r] - v[p], vy = v[r + 1] - v[p + 1], vz = v[r + 2] - v[p + 2];
            if ((uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz < -1e-7) { convex = false; break; }
          }
        }
        const coverIndex = convex ? coverFaces.length : -1;
        if (convex) coverFaces.push(faceIndex);
        const planeKey = `${Math.round(nx / EPS)},${Math.round(ny / EPS)},${Math.round(nz / EPS)},${Math.round((nx * v[a] + ny * v[a + 1] + nz * v[a + 2]) / EPS)}`;
        let plane = planes.get(planeKey);
        if (!plane) { plane = []; planes.set(planeKey, plane); }
        const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (const vertex of face.i) for (let axis = 0; axis < 3; axis++) { bounds[axis] = Math.min(bounds[axis], v[vertex * 3 + axis]); bounds[axis + 3] = Math.max(bounds[axis + 3], v[vertex * 3 + axis]); }
        plane.push({ face, bounds });
        let centerX = 0, centerY = 0, centerZ = 0;
        for (const vertex of face.i) {
          const at = vertex * 3;
          centerX += v[at]; centerY += v[at + 1]; centerZ += v[at + 2];
          vertexIds[vertex] = sample(v[at], v[at + 1], v[at + 2]);
        }
        drop = Math.abs(ny) > Math.abs(nx) ? 1 : 0;
        if (Math.abs(nz) > Math.abs(drop ? ny : nx)) drop = 2;
        u = (drop + 1) % 3; w = (drop + 2) % 3;
        const nu = Math.max(1, Math.ceil((bounds[u + 3] - bounds[u]) / SURFACE_STEP)), nw = Math.max(1, Math.ceil((bounds[w + 3] - bounds[w]) / SURFACE_STEP));
        interior((u === 0 ? centerX : u === 1 ? centerY : centerZ) / face.i.length, (w === 0 ? centerX : w === 1 ? centerY : centerZ) / face.i.length);
        for (let iu = 0; iu < nu; iu++) for (let iw = 0; iw < nw; iw++) interior(bounds[u] + (bounds[u + 3] - bounds[u]) * (iu + 0.5) / nu, bounds[w] + (bounds[w + 3] - bounds[w]) * (iw + 0.5) / nw);
        for (let j = 1; j < face.i.length - 1; j++, count++) {
          const b = face.i[j] * 3, c = face.i[j + 1] * 3, t = count * 9, box = count * 6;
          triangles[t] = v[a]; triangles[t + 1] = v[a + 1]; triangles[t + 2] = v[a + 2];
          triangles[t + 3] = v[b] - v[a]; triangles[t + 4] = v[b + 1] - v[a + 1]; triangles[t + 5] = v[b + 2] - v[a + 2];
          triangles[t + 6] = v[c] - v[a]; triangles[t + 7] = v[c + 1] - v[a + 1]; triangles[t + 8] = v[c + 2] - v[a + 2];
          triangleCoverFaces[count] = coverIndex;
          triangleBounds[box] = Math.min(v[a], v[b], v[c]); triangleBounds[box + 1] = Math.min(v[a + 1], v[b + 1], v[c + 1]); triangleBounds[box + 2] = Math.min(v[a + 2], v[b + 2], v[c + 2]);
          triangleBounds[box + 3] = Math.max(v[a], v[b], v[c]); triangleBounds[box + 4] = Math.max(v[a + 1], v[b + 1], v[c + 1]); triangleBounds[box + 5] = Math.max(v[a + 2], v[b + 2], v[c + 2]);
        }
        for (let j = 0; j < face.i.length; j++) {
          const a = face.i[j] * 3, b = face.i[(j + 1) % face.i.length] * 3, ak = vertexIds[a / 3], bk = vertexIds[b / 3], key = ak < bk ? ak * 67108864 + bk : bk * 67108864 + ak;
          const existing = edgeMap.get(key);
          if (existing) {
            existing.shared = true;
            if (existing.nx * nx + existing.ny * ny + existing.nz * nz < 0.9999) existing.crease = true;
            if (!existing.normals.some((n) => n[0] * nx + n[1] * ny + n[2] * nz > 0.999999)) existing.normals.push([nx, ny, nz]);
          } else edgeMap.set(key, { a, b, nx, ny, nz, plane, normals: [[nx, ny, nz]], shared: false, crease: false });
        }
      }
      // Coplanar paint/fracture faces can number in the thousands. Index their expanded bounds along the widest
      // axis for the seam test below; each bucket retains face order and the exact polygon test is unchanged.
      for (const plane of planes.values()) if (plane.length >= 32) {
        const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (const entry of plane) for (let axis = 0; axis < 3; axis++) {
          bounds[axis] = Math.min(bounds[axis], entry.bounds[axis]);
          bounds[axis + 3] = Math.max(bounds[axis + 3], entry.bounds[axis + 3]);
        }
        let axis = 0;
        if (bounds[4] - bounds[1] > bounds[3] - bounds[0]) axis = 1;
        if (bounds[5] - bounds[2] > bounds[axis + 3] - bounds[axis]) axis = 2;
        const count = Math.min(64, Math.ceil(Math.sqrt(plane.length))), start = bounds[axis] - EPS;
        const scale = count / (bounds[axis + 3] + EPS - start), buckets = Array.from({ length: count }, () => []);
        for (const entry of plane) {
          const first = Math.max(0, Math.floor((entry.bounds[axis] - EPS - start) * scale));
          const last = Math.min(count - 1, Math.floor((entry.bounds[axis + 3] + EPS - start) * scale));
          for (let i = first; i <= last; i++) buckets[i].push(entry);
        }
        plane.index = { axis, start, scale, buckets };
      }
      // Merge collinear structural spans after eliminating paint-pixel and triangle diagonals shared by faces on
      // the same plane.
      const groups = new Map(), edges = [];
      for (const edge of edgeMap.values()) {
        if (edge.shared && !edge.crease) continue;
        const a = edge.a, b = edge.b;
        let dx = v[b] - v[a], dy = v[b + 1] - v[a + 1], dz = v[b + 2] - v[a + 2], length = Math.hypot(dx, dy, dz);
        if (length < EPS) continue;
        dx /= length; dy /= length; dz /= length;
        if (!edge.crease && edge.plane.length > 1) {
          // A large paint rectangle can meet several small ones: mismatched edge endpoints are still a coplanar seam,
          // not a crease.
          const x = (v[a] + v[b]) * 0.5 - (edge.ny * dz - edge.nz * dy) * 0.001;
          const y = (v[a + 1] + v[b + 1]) * 0.5 - (edge.nz * dx - edge.nx * dz) * 0.001;
          const z = (v[a + 2] + v[b + 2]) * 0.5 - (edge.nx * dy - edge.ny * dx) * 0.001;
          let covered = false;
          const index = edge.plane.index, coordinate = index && (index.axis === 0 ? x : index.axis === 1 ? y : z);
          const faces = index ? index.buckets[Math.max(0, Math.min(index.buckets.length - 1, Math.floor((coordinate - index.start) * index.scale)))] : edge.plane;
          for (const entry of faces) {
            const box = entry.bounds;
            if (x < box[0] - EPS || x > box[3] + EPS || y < box[1] - EPS || y > box[4] + EPS || z < box[2] - EPS || z > box[5] + EPS) continue;
            const indices = entry.face.i;
            let inside = true;
            for (let j = 0; j < indices.length; j++) {
              const p = indices[j] * 3, q = indices[(j + 1) % indices.length] * 3;
              const ux = v[q] - v[p], uy = v[q + 1] - v[p + 1], uz = v[q + 2] - v[p + 2], vx = x - v[p], vy = y - v[p + 1], vz = z - v[p + 2];
              if ((uy * vz - uz * vy) * edge.nx + (uz * vx - ux * vz) * edge.ny + (ux * vy - uy * vx) * edge.nz < -EPS) { inside = false; break; }
            }
            if (inside) { covered = true; break; }
          }
          if (covered) continue;
        }
        if (Math.abs(dx) > EPS ? dx < 0 : Math.abs(dy) > EPS ? dy < 0 : dz < 0) { dx = -dx; dy = -dy; dz = -dz; }
        const round = (n) => Math.round(n / EPS), ax = v[a], ay = v[a + 1], az = v[a + 2];
        edge.normals.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
        const faces = edge.normals.map((n) => `${round(n[0])},${round(n[1])},${round(n[2])}`).join(":");
        const key = `${round(dx)},${round(dy)},${round(dz)}:${round(ay * dz - az * dy)},${round(az * dx - ax * dz)},${round(ax * dy - ay * dx)}:${faces}`;
        let group = groups.get(key);
        const start = ax * dx + ay * dy + az * dz, end = v[b] * dx + v[b + 1] * dy + v[b + 2] * dz;
        if (!group) { group = { ax, ay, az, dx, dy, dz, origin: start, normals: edge.normals, spans: [] }; groups.set(key, group); }
        group.spans.push([Math.min(start, end), Math.max(start, end)]);
      }
      for (const g of groups.values()) {
        g.spans.sort((a, b) => a[0] - b[0]);
        let lo = Infinity, hi = -Infinity;
        const emit = () => { if (hi - lo > 0.025) edges.push({ g, lo, hi }); };
        for (const span of g.spans) {
          if (span[0] > hi + EPS * 4) { emit(); lo = span[0]; hi = span[1]; }
          else hi = Math.max(hi, span[1]);
        }
        emit();
      }
      edges.sort((a, b) => b.hi - b.lo - a.hi + a.lo);
      const edgeLines = new Float32Array(edges.length * 6);
      const edgeStarts = new Uint32Array(edgeLines.length / 6 + 1), edgeNormals = [];
      for (let i = 0; i < edgeLines.length / 6; i++) {
        edgeStarts[i] = edgeNormals.length;
        for (const n of edges[i].g.normals) edgeNormals.push(...n);
      }
      edgeStarts[edgeLines.length / 6] = edgeNormals.length;
      for (let i = 0; i < edgeLines.length / 6; i++) for (let end = 0; end < 2; end++) {
        const e = edges[i], g = e.g, t = (end ? e.hi : e.lo) - g.origin, at = i * 6 + end * 3;
        edgeLines[at] = g.ax + g.dx * t; edgeLines[at + 1] = g.ay + g.dy * t; edgeLines[at + 2] = g.az + g.dz * t;
      }
      const samples = new Float32Array(samplePoints.subarray(0, sampleCount * 3));
      // Face grids already place neighboring witnesses together; small contiguous bounds prove occlusion for whole
      // patches without another sorted mesh or per-frame buffers.
      const sampleBounds = new Float64Array(Math.ceil(samples.length / (SAMPLE_BLOCK * 3)) * 6);
      for (let block = 0; block < sampleBounds.length; block += 6) {
        sampleBounds[block] = sampleBounds[block + 1] = sampleBounds[block + 2] = Infinity;
        sampleBounds[block + 3] = sampleBounds[block + 4] = sampleBounds[block + 5] = -Infinity;
        for (let i = block / 6 * SAMPLE_BLOCK * 3, end = Math.min(samples.length, i + SAMPLE_BLOCK * 3); i < end; i += 3) for (let axis = 0; axis < 3; axis++) {
          sampleBounds[block + axis] = Math.min(sampleBounds[block + axis], samples[i + axis]);
          sampleBounds[block + axis + 3] = Math.max(sampleBounds[block + axis + 3], samples[i + axis]);
        }
      }
      if (!count) return null;
      const indices = Uint32Array.from({ length: count }, (_, i) => i), scratch = BL.math.sortScratch(count), bounds = [], left = [], right = [], starts = [], counts = [];
      // Centroid sort keys computed once rather than inside every comparison.
      const keys = new Float64Array(count * 3);
      for (let i = 0; i < count; i++) for (let axis = 0; axis < 3; axis++) keys[i * 3 + axis] = triangleBounds[i * 6 + axis] + triangleBounds[i * 6 + axis + 3];
      const build = (lo, hi) => {
        const id = left.length, b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (let n = lo; n < hi; n++) { const at = indices[n] * 6; for (let axis = 0; axis < 3; axis++) { b[axis] = Math.min(b[axis], triangleBounds[at + axis]); b[axis + 3] = Math.max(b[axis + 3], triangleBounds[at + axis + 3]); } }
        bounds.push(...b); left.push(-1); right.push(-1); starts.push(lo); counts.push(hi - lo);
        if (hi - lo <= 8) return id;
        let axis = 0; if (b[4] - b[1] > b[3] - b[0]) axis = 1; if (b[5] - b[2] > b[axis + 3] - b[axis]) axis = 2;
        BL.math.sortByKey(indices, lo, hi, keys, 3, axis, scratch);
        const middle = (lo + hi) >> 1;
        left[id] = build(lo, middle); right[id] = build(middle, hi); counts[id] = 0;
        return id;
      };
      if (count) build(0, count);
      cached = { lines: edgeLines, samples, sampleBounds, coverFaces: new Uint32Array(coverFaces), triangleCoverFaces: triangleCoverFaces.slice(0, count), edgeStarts, edgeNormals: new Float64Array(edgeNormals), triangles: triangles.slice(0, count * 9), indices, bounds: new Float64Array(bounds), left: new Int32Array(left), right: new Int32Array(right), starts: new Uint32Array(starts), counts: new Uint32Array(counts), sphere: BL.scene.boundsOf(geometry) };
      const bake = { faces: geometry.faces.map((face) => face.i), record: cached };
      if (baked) baked.push(bake); else bakes.set(geometry.verts, [bake]);
      geometries.set(geometry, cached); stats.geometries++; stats.triangles += count; stats.samples += samples.length / 3;
      return cached;
    };
    const groupOf = (owner) => {
      let group = ownerEntries.get(owner);
      if (!group) {
        group = []; group.owner = owner; group.provider = providerOwners.get(owner) || null;
        group.stamp = group.retained = group.revision = 0; group.near = group.active = false; group.providerVersion = -1; group.providerActive = false;
        group.cacheActor = group.cacheTerrain = null; group.cachePerception = group.cacheRevision = -1; group.cacheResult = false; group.observer = new Float64Array(6);
        group.perceptionBounds = new Float64Array(6); group.perceptionDirty = false;
        group.witnessEntry = group.witnessSource = null; group.witnessAt = -1;
        group.cameraWitnessEntry = group.cameraWitnessSource = null; group.cameraWitnessAt = -1;
        group.boundaryStamp = -1; group.boundaryDepth = 0; group.boundaryEntries = [null, null]; group.boundaryGrid = null;
        ownerEntries.set(owner, group); ownerGroups.push(group);
      }
      return group;
    };
    const registerNode = (node, owner = node, character = -1) => {
      if (node.sightHidden) return;
      seen.add(node);
      if (aliases.has(node)) owner = aliases.get(node);
      if (character < 0 && characterRoots.has(owner)) character = characterRoots.get(owner);
      if (node.geometry && !node.instanceData) {
        const geometry = geometryOf(node.geometry);
        if (geometry) {
          let entry = entries.get(node);
          if (!entry) {
            const group = groupOf(owner);
            entry = { node, owner, group, character, geometry, hitTriangle: -1, capacity: 0, source: node.geometry, inverse: BL.math.mat4.create(), world: new Float64Array(16), visible: false, shown: false, clipMinY: -Infinity, worldMinY: -Infinity, worldMaxY: Infinity, x: 0, y: 0, z: 0, radius: 0, hx: 0, hy: 0, hz: 0, scaleX: 0, scaleY: 0, scaleZ: 0, centerY: 0, halfY: 0, boundsGeometry: null, boundaryBounds: new Float64Array(4), boundaryTriangles: new Float64Array(0), boundaryBoxes: new Float64Array(0), boundaryNodes: new Float64Array(0), boundaryRay: new Float64Array(12), boundaryHits: new Int32Array([-1, -1]), boundaryGrid: null, boundaryReserve: 0, boundaryNodeReserve: 0 };
            registered.push(entry); entries.set(node, entry); group.push(entry);
          }
          // Animated world-height planes can add one boundary per triangle and plane; reserve it at registration,
          // never during collection.
          entry.capacity = geometry.lines.length / 6 + (node.geometry.clipMinY !== undefined || node.geometry.clipMaxY !== undefined ? geometry.triangles.length / 9 * 2 : 0);
          reserveBoundary(entry, geometry);
        }
      }
      for (const child of node.children) registerNode(child, owner, character);
    };
    const reserveHead = (cave) => {
      const open = geometryOf(cave.headOpen), closed = geometryOf(cave.headClosed), entry = cave.parts && entries.get(cave.parts.head);
      if (entry) {
        entry.capacity = Math.max(entry.capacity, open ? open.lines.length / 6 : 0, closed ? closed.lines.length / 6 : 0);
        if (open) reserveBoundary(entry, open);
        if (closed) reserveBoundary(entry, closed);
      }
    };
    // Registration records the largest geometry each entry can show; the buffers are allocated at that size the first
    // time the entry's boundary is built, since only owners near the camera ever build one.
    const reserveBoundary = (entry, geometry) => {
      entry.boundaryReserve = Math.max(entry.boundaryReserve, geometry.triangles.length / 9);
      entry.boundaryNodeReserve = Math.max(entry.boundaryNodeReserve, geometry.counts.length);
    };
    const boundaryStorage = (entry) => {
      const count = entry.boundaryReserve;
      if (entry.boundaryTriangles.length < count * 10) entry.boundaryTriangles = new Float64Array(count * 10);
      if (entry.boundaryBoxes.length < count * 4) entry.boundaryBoxes = new Float64Array(count * 4);
      if (entry.boundaryNodes.length < entry.boundaryNodeReserve * 4) entry.boundaryNodes = new Float64Array(entry.boundaryNodeReserve * 4);
      if (count >= 64) {
        let grid = entry.boundaryGrid;
        if (!grid) grid = entry.boundaryGrid = { active: false, capacity: 0, size: 0, offsets: null, cursors: null, spans: null, indices: null, scaleX: 0, scaleY: 0 };
        const size = count >= 512 ? 32 : 16;
        if (grid.size < size) { grid.size = size; grid.offsets = new Uint32Array(size * size + 1); grid.cursors = new Uint32Array(size * size); }
        if (grid.capacity < count) { grid.capacity = count; grid.indices = new Uint32Array(count * 16); grid.spans = new Uint8Array(count * 4); }
      }
    };
    const resize = () => {
      let capacity = 0;
      stats.boundaryGridBytes = stats.boundaryGridReferences = 0;
      for (const entry of registered) {
        if (!entry.group.provider) capacity += entry.capacity;
        const grid = entry.boundaryGrid;
        if (grid) {
          stats.boundaryGridBytes += grid.indices.byteLength + grid.spans.byteLength + grid.offsets.byteLength + grid.cursors.byteLength;
          stats.boundaryGridReferences += grid.indices.length;
        }
      }
      for (const group of ownerGroups) {
        group.boundaryStamp = -1;
        if (group.length < BOUNDARY_GRID) continue;
        let grid = group.boundaryGrid;
        if (!grid) grid = group.boundaryGrid = { active: false, stride: 0, counts: new Uint32Array(BOUNDARY_GRID * BOUNDARY_GRID), indices: null, bounds: new Float64Array(4), scaleX: 0, scaleY: 0 };
        if (grid.stride !== group.length) { grid.stride = group.length; grid.indices = new Uint32Array(group.length * BOUNDARY_GRID * BOUNDARY_GRID); }
        stats.boundaryGridBytes += grid.indices.byteLength + grid.counts.byteLength + grid.bounds.byteLength;
        stats.boundaryGridReferences += grid.indices.length;
      }
      const count = registered.length;
      if (candidates.length !== count) {
        candidates = new Array(count).fill(null); occluders = new Array(count).fill(null); cameraOccluders = new Array(count).fill(null); targetOccluders = new Array(count).fill(null); perceptionOccluders = new Array(count).fill(null);
      }
      if (result.ownerCapacity !== ownerGroups.length) { nearOwners = result.nearOwners = new Array(ownerGroups.length).fill(null); nearDistances = result.nearDistances = new Float64Array(ownerGroups.length); }
      stats.limit = capacity; result.ownerCapacity = stats.owners = ownerGroups.length; stats.nodes = stats.registered = count;
      candidates.fill(null); occluders.fill(null); cameraOccluders.fill(null); targetOccluders.fill(null); perceptionOccluders.fill(null); owners.fill(null); nearOwners.fill(null);
      targetOwnerCache = null; targetStamp = -1; targetCount = 0;
      cameraCoverEntry = cameraCoverSource = null; cameraCoverFace = -1;
      result.count = result.contours = result.nearCount = candidateCount = occluderCount = cameraOccluderCount = perceptionOccluderCount = 0;
      result.version++; result.nearVersion++; result.occlusionVersion++; result.structuralVersion++; result.perceptionVersion++;
    };
    for (const provider of providers) groupOf(provider.owner);
    let characterIndex = 0;
    for (const cave of crew.cavemen.values()) {
      characterRoots.set(cave.root, characterIndex);
      if (cave.sleepWeapons) registerNode(cave.sleepWeapons, cave.root, characterIndex);
      registerNode(cave.root, cave.root, characterIndex++); reserveHead(cave);
    }
    // Non-crew actors share the same camera occlusion and perception-cache rules.
    for (const node of actorRoots) {
      if (!characterRoots.has(node)) characterRoots.set(node, characterIndex++);
      registerNode(node, node, characterRoots.get(node));
    }
    for (const node of roots) registerNode(node);
    for (const cave of crew.cavemen.values()) reserveHead(cave);
    resize();
    const register = (node, owner = node, character = -1) => { registerNode(node, owner, character); resize(); };
    const visible = (node) => {
      if (!node.parent) return false;
      for (let p = node; p; p = p.parent) { if (!p.visible) return false; if (p === sceneRoot) return true; }
      return false;
    };
    const withinClip = (entry, x, y, z) => {
      if (y < entry.clipMinY) return false;
      if (entry.worldMinY === -Infinity && entry.worldMaxY === Infinity) return true;
      const w = entry.node.world, worldY = w[1] * x + w[5] * y + w[9] * z + w[13];
      return worldY >= entry.worldMinY && worldY <= entry.worldMaxY;
    };
    const clipSpan = (a, b, low, high) => {
      const d = b - a;
      if (!d) return a >= low && a <= high;
      const first = (low - a) / d, last = (high - a) / d;
      edgeLo = Math.max(edgeLo, Math.min(first, last)); edgeHi = Math.min(edgeHi, Math.max(first, last));
      return edgeLo < edgeHi;
    };
    // Only candidates near the camera write lines, so the buffer grows to its high-water mark instead of holding
    // every registered edge (`stats.limit`).
    const growLines = () => {
      const capacity = Math.max(1024, result.capacity * 2), next = new Float32Array(capacity * 6);
      next.set(lines); lines = result.lines = next;
      while (owners.length < capacity) owners.push(null);
      result.capacity = capacity;
    };
    const appendLine = (entry, ax, ay, az, bx, by, bz) => {
      edgeLo = 0; edgeHi = 1;
      if ((entry.worldMinY !== -Infinity || entry.worldMaxY !== Infinity) && !clipSpan(ay, by, entry.worldMinY, entry.worldMaxY)) return;
      if (entry.clipMinY !== -Infinity) {
        const m = entry.inverse;
        if (!clipSpan(m[1] * ax + m[5] * ay + m[9] * az + m[13], m[1] * bx + m[5] * by + m[9] * bz + m[13], entry.clipMinY, Infinity)) return;
      }
      const dx = bx - ax, dy = by - ay, dz = bz - az, length = Math.hypot(dx, dy, dz) * (edgeHi - edgeLo);
      if (length < EPS) return;
      const middle = (edgeLo + edgeHi) / 2;
      if (!cameraIncludes(ax + dx * middle, ay + dy * middle, az + dz * middle, length / 2)) return;
      if (lineUsed === result.capacity) growLines();
      for (let end = 0; end < 2; end++) {
        const t = end ? edgeHi : edgeLo, at = lineUsed * 6 + end * 3;
        const x = Math.fround(t === 1 ? bx : ax + dx * t), y = Math.fround(t === 1 ? by : ay + dy * t), z = Math.fround(t === 1 ? bz : az + dz * t);
        if (lines[at] !== x || lines[at + 1] !== y || lines[at + 2] !== z) linesChanged = true;
        lines[at] = x; lines[at + 1] = y; lines[at + 2] = z;
      }
      if (owners[lineUsed] !== entry.owner) linesChanged = true;
      owners[lineUsed++] = entry.owner;
    };
    const appendClipLines = (entry, plane) => {
      if (!Number.isFinite(plane)) return;
      const v = entry.geometry.triangles, w = entry.node.world;
      const b = entry.geometry.sphere, p = b.center, center = w[1] * p[0] + w[5] * p[1] + w[9] * p[2] + w[13];
      const half = (Math.abs(w[1]) * (b.max[0] - b.min[0]) + Math.abs(w[5]) * (b.max[1] - b.min[1]) + Math.abs(w[9]) * (b.max[2] - b.min[2])) / 2;
      if (plane <= center - half || plane >= center + half) return;
      for (let at = 0; at < v.length; at += 9) {
        const x = v[at], y = v[at + 1], z = v[at + 2], ux = v[at + 3], uy = v[at + 4], uz = v[at + 5], vx = v[at + 6], vy = v[at + 7], vz = v[at + 8];
        const ax = w[0] * x + w[4] * y + w[8] * z + w[12], ay = w[1] * x + w[5] * y + w[9] * z + w[13], az = w[2] * x + w[6] * y + w[10] * z + w[14];
        const bx = ax + w[0] * ux + w[4] * uy + w[8] * uz, by = ay + w[1] * ux + w[5] * uy + w[9] * uz, bz = az + w[2] * ux + w[6] * uy + w[10] * uz;
        const cx = ax + w[0] * vx + w[4] * vy + w[8] * vz, cy = ay + w[1] * vx + w[5] * vy + w[9] * vz, cz = az + w[2] * vx + w[6] * vy + w[10] * vz;
        let count = 0, firstX = 0, firstZ = 0;
        for (let edge = 0; edge < 3; edge++) {
          const px = edge === 0 ? ax : edge === 1 ? bx : cx, py = edge === 0 ? ay : edge === 1 ? by : cy, pz = edge === 0 ? az : edge === 1 ? bz : cz;
          const qx = edge === 0 ? bx : edge === 1 ? cx : ax, qy = edge === 0 ? by : edge === 1 ? cy : ay, qz = edge === 0 ? bz : edge === 1 ? cz : az;
          if ((py < plane) === (qy < plane)) continue;
          const t = (plane - py) / (qy - py), ix = px + (qx - px) * t, iz = pz + (qz - pz) * t;
          if (!count++) { firstX = ix; firstZ = iz; } else appendLine(entry, firstX, plane, firstZ, ix, plane, iz);
        }
      }
    };
    const invalidatePerception = (entry) => {
      for (let n = 0; n < ownerGroups.length; n++) {
        const group = ownerGroups[n], b = group.perceptionBounds;
        if (!group.cacheActor || group.perceptionDirty) continue;
        if (entry.x + entry.hx >= b[0] - EPS && entry.x - entry.hx <= b[3] + EPS
          && entry.y + entry.hy >= b[1] - EPS && entry.y - entry.hy <= b[4] + EPS
          && entry.z + entry.hz >= b[2] - EPS && entry.z - entry.hz <= b[5] + EPS) group.perceptionDirty = true;
      }
    };
    const collect = (actor, ex, ey, ez, camera = null, aspect = 1, retainedOwners = null, retainedCount = 0) => {
      const actorRoot = actor && actor.root;
      let changed = false, occlusionChanged = false, structuralChanged = false, perceptionChanged = false, providerChanged = false;
      // A character immersed in fruit can perceive beyond that shell; camera rays still hit it and the separate
      // stone platform stays opaque.
      const through = perceptionThrough && actor ? perceptionThrough(actor) : null;
      if (through !== ignoredPerceptionOwner) { ignoredPerceptionOwner = through; perceptionChanged = providerChanged = occlusionChanged = true; }
      candidateCount = occluderCount = cameraOccluderCount = 0; collectStamp++;
      cameraCoverEntry = cameraCoverSource = null; cameraCoverFace = -1;
      if (retainedOwners) for (let n = 0; n < retainedCount; n++) {
        const group = ownerEntries.get(retainedOwners[n]);
        if (group) group.retained = collectStamp;
      }
      activeCamera = camera; cameraAspect = aspect; hasCamera = !!camera;
      for (let n = 0; n < ownerGroups.length; n++) {
        const group = ownerGroups[n], provider = group.provider;
        group.near = group.retained === collectStamp; group.active = false; group.perceptionDirty = false;
        if (provider) {
          const active = provider.active(), version = provider.version;
          if (group.providerActive !== active || group.providerVersion !== version) { group.revision++; occlusionChanged = perceptionChanged = providerChanged = true; }
          group.providerActive = active; group.providerVersion = version; group.active = active;
          if (active && provider.distance(ex, ey, ez) <= RANGE) group.near = true;
        }
      }
      const eyeX = camera ? camera.position.x : ex, eyeY = camera ? camera.position.y : ey, eyeZ = camera ? camera.position.z : ez;
      cameraX = eyeX; cameraY = eyeY; cameraZ = eyeZ;
      const rayX = ex - eyeX, rayY = ey - eyeY, rayZ = ez - eyeZ, rayLength2 = rayX * rayX + rayY * rayY + rayZ * rayZ;
      if (camera) {
        BL.math.mat4.lookAt(cameraView, camera.position, camera.target, camera.up || worldUp);
        near = camera.near; far = camera.far; tanY = Math.tan(camera.fov / 2); tanX = tanY * aspect;
        planeX = Math.hypot(1, tanX); planeY = Math.hypot(1, tanY);
      }
      for (let n = 0; n < registered.length; n++) {
        const entry = registered[n], node = entry.node, geometry = geometries.get(node.geometry), w = node.world;
        let worldChanged = false;
        for (let i = 0; i < 16; i++) if (entry.world[i] !== w[i]) { worldChanged = true; entry.world[i] = w[i]; }
        // Scale and vertical bounds follow the matrix and geometry only; visibility is still read every frame.
        if (worldChanged) { entry.scaleX = Math.hypot(w[0], w[1], w[2]); entry.scaleY = Math.hypot(w[4], w[5], w[6]); entry.scaleZ = Math.hypot(w[8], w[9], w[10]); }
        if (worldChanged || entry.boundsGeometry !== geometry) {
          const b = geometry && geometry.sphere, p = b && b.center;
          entry.centerY = b ? w[1] * p[0] + w[5] * p[1] + w[9] * p[2] + w[13] : 0;
          entry.halfY = b ? (Math.abs(w[1]) * (b.max[0] - b.min[0]) + Math.abs(w[5]) * (b.max[1] - b.min[1]) + Math.abs(w[9]) * (b.max[2] - b.min[2])) / 2 : 0;
          entry.boundsGeometry = geometry;
        }
        const scaleX = entry.scaleX, scaleY = entry.scaleY, scaleZ = entry.scaleZ, centerY = entry.centerY, halfY = entry.halfY;
        // The reflected panel opens from the bottom: its discarded pixels must not remain blockers or perception
        // witnesses after it opens.
        const reveal = node.mirror ? Math.max(0, Math.min(1, node.mirrorReveal || 0)) : 0;
        const clipMinY = reveal && geometry ? geometry.sphere.min[1] + (geometry.sphere.max[1] - geometry.sphere.min[1]) * reveal : -Infinity;
        const worldMinY = node.geometry?.clipMinY ?? -Infinity, worldMaxY = node.geometry?.clipMaxY ?? Infinity;
        const shown = !!geometry && centerY + halfY >= worldMinY && centerY - halfY <= worldMaxY && worldMinY <= worldMaxY && !node.mirrorPortal && reveal < 1 && scaleX * scaleY * scaleZ > 1e-12 && visible(node) && (!entry.group.provider || !entry.group.provider.includes || entry.group.provider.includes(node)), active = shown && entry.owner !== actorRoot;
        const wasActive = entry.visible, wasShown = entry.shown;
        const moved = worldChanged || wasShown !== shown || entry.source !== node.geometry || entry.clipMinY !== clipMinY || entry.worldMinY !== worldMinY || entry.worldMaxY !== worldMaxY;
        if (node.sightSolid && (moved || active !== wasActive) && (active || wasActive)) structuralChanged = true;
        // Both the departed and newly occupied volumes can affect cached sight rays; distant moving scenery cannot
        // invalidate either.
        const perceptionMoved = entry.character < 0 && (moved || active !== wasActive);
        if (perceptionMoved && wasActive) invalidatePerception(entry);
        entry.visible = active; entry.shown = shown; entry.source = node.geometry; entry.clipMinY = clipMinY; entry.worldMinY = worldMinY; entry.worldMaxY = worldMaxY;
        if (geometry && entry.geometry !== geometry) { entry.geometry = geometry; entry.hitTriangle = -1; entry.boundaryHits.fill(-1); }
        if (moved) {
          if (active || wasActive) { occlusionChanged = true; if (entry.character < 0) perceptionChanged = true; }
          if (shown || wasShown) entry.group.revision++;
          if (shown) {
            BL.math.mat4.invert(entry.inverse, w);
            const b = geometry.sphere, p = b.center;
            entry.x = w[0] * p[0] + w[4] * p[1] + w[8] * p[2] + w[12];
            entry.y = w[1] * p[0] + w[5] * p[1] + w[9] * p[2] + w[13];
            entry.z = w[2] * p[0] + w[6] * p[1] + w[10] * p[2] + w[14];
            entry.radius = b.radius * Math.max(scaleX, scaleY, scaleZ);
            const hx = (b.max[0] - b.min[0]) * 0.5, hy = (b.max[1] - b.min[1]) * 0.5, hz = (b.max[2] - b.min[2]) * 0.5;
            entry.hx = Math.abs(w[0]) * hx + Math.abs(w[4]) * hy + Math.abs(w[8]) * hz;
            entry.hy = Math.abs(w[1]) * hx + Math.abs(w[5]) * hy + Math.abs(w[9]) * hz;
            entry.hz = Math.abs(w[2]) * hx + Math.abs(w[6]) * hy + Math.abs(w[10]) * hz;
            if (worldMinY !== -Infinity || worldMaxY !== Infinity) {
              const low = Math.max(entry.y - entry.hy, worldMinY), high = Math.min(entry.y + entry.hy, worldMaxY);
              entry.y = (low + high) / 2; entry.hy = (high - low) / 2; entry.radius = Math.hypot(entry.hx, entry.hy, entry.hz);
            }
          }
        }
        if (perceptionMoved && active) invalidatePerception(entry);
        if (active !== wasActive) { occlusionChanged = true; if (entry.character < 0) perceptionChanged = true; }
        if (!active) continue;
        // Blockers are independent of line distance and candidate caps: the camera can be far away with an opaque
        // object close to its eye.
        occluders[occluderCount++] = entry;
        const dx = entry.x - ex, dy = entry.y - ey, dz = entry.z - ez;
        const group = entry.group;
        group.active = true;
        if (Math.hypot(dx, dy, dz) - entry.radius <= RANGE) group.near = true;
      }
      let nearCount = 0, nearChanged = false;
      for (let n = 0; n < ownerGroups.length; n++) {
        const group = ownerGroups[n];
        if (!group.active || !group.near || group.owner === actorRoot) continue;
        const d = distance(group.owner, ex, ey, ez);
        if (nearOwners[nearCount] !== group.owner || nearDistances[nearCount] !== d) nearChanged = true;
        nearOwners[nearCount] = group.owner; nearDistances[nearCount++] = d;
      }
      for (let n = nearCount; n < result.nearCount; n++) nearOwners[n] = null;
      if (result.nearCount !== nearCount) nearChanged = true;
      result.nearCount = stats.nearOwners = nearCount; if (nearChanged) result.nearVersion++;
      // A nearby owner's whole contour stays eligible, including parts beyond the proximity sphere; expand the
      // camera corridor so a blocker beside those farther parts is not missed.
      let guideRange = RANGE;
      for (let n = 0; n < occluderCount; n++) {
        const entry = occluders[n];
        if (entry.group.near) guideRange = Math.max(guideRange, Math.hypot(entry.x - ex, entry.y - ey, entry.z - ez) + entry.radius);
      }
      for (let n = 0; n < occluderCount; n++) {
        const entry = occluders[n];
        const t = rayLength2 ? Math.max(0, Math.min(1, ((entry.x - eyeX) * rayX + (entry.y - eyeY) * rayY + (entry.z - eyeZ) * rayZ) / rayLength2)) : 0;
        const qx = entry.x - eyeX - rayX * t, qy = entry.y - eyeY - rayY * t, qz = entry.z - eyeZ - rayZ * t;
        if (!camera || qx * qx + qy * qy + qz * qz <= (guideRange + entry.radius) ** 2 && cameraIncludes(entry.x, entry.y, entry.z, entry.radius)) cameraOccluders[cameraOccluderCount++] = entry;
        if (entry.group.provider || !entry.group.near || !cameraIncludes(entry.x, entry.y, entry.z, entry.radius)) continue;
        candidates[candidateCount++] = entry;
      }
      lineUsed = 0; linesChanged = false;
      for (let n = 0; n < candidateCount; n++) {
        const entry = candidates[n], geometry = entry.geometry, v = geometry.lines, w = entry.node.world, inverse = entry.inverse;
        const eyeX = inverse[0] * cameraX + inverse[4] * cameraY + inverse[8] * cameraZ + inverse[12], eyeY = inverse[1] * cameraX + inverse[5] * cameraY + inverse[9] * cameraZ + inverse[13], eyeZ = inverse[2] * cameraX + inverse[6] * cameraY + inverse[10] * cameraZ + inverse[14];
        for (let j = 0; j < v.length; j += 6) {
          const start = geometry.edgeStarts[j / 6], end = geometry.edgeStarts[j / 6 + 1], normals = geometry.edgeNormals;
          if (hasCamera && end - start > 3) {
            let front = false, back = false;
            for (let at = start; at < end; at += 3) {
              const facing = normals[at] * (eyeX - v[j]) + normals[at + 1] * (eyeY - v[j + 1]) + normals[at + 2] * (eyeZ - v[j + 2]);
              if (facing > EPS) front = true; else back = true;
            }
            if (!front || !back) continue;
          }
          appendLine(entry, w[0] * v[j] + w[4] * v[j + 1] + w[8] * v[j + 2] + w[12], w[1] * v[j] + w[5] * v[j + 1] + w[9] * v[j + 2] + w[13], w[2] * v[j] + w[6] * v[j + 1] + w[10] * v[j + 2] + w[14],
            w[0] * v[j + 3] + w[4] * v[j + 4] + w[8] * v[j + 5] + w[12], w[1] * v[j + 3] + w[5] * v[j + 4] + w[9] * v[j + 5] + w[13], w[2] * v[j + 3] + w[6] * v[j + 4] + w[10] * v[j + 5] + w[14]);
        }
        appendClipLines(entry, entry.worldMinY); appendClipLines(entry, entry.worldMaxY);
      }
      const used = lineUsed; changed = changed || linesChanged;
      if (result.count !== used) changed = true;
      for (let i = used; i < result.count; i++) owners[i] = null;
      result.count = result.contours = used; if (changed) result.version++; if (occlusionChanged) result.occlusionVersion++;
      if (structuralChanged) result.structuralVersion++;
      if (perceptionChanged) {
        const before = result.perceptionVersion++;
        if (!providerChanged) for (let n = 0; n < ownerGroups.length; n++) {
          const group = ownerGroups[n];
          // A manually changed terrain revision stays invalidated: advance only caches matching the scenery version
          // actually inspected.
          if (!group.perceptionDirty && group.cachePerception === before) group.cachePerception = result.perceptionVersion;
        }
      }
      stats.candidates = candidateCount; stats.occluders = occluderCount; stats.cameraOccluders = cameraOccluderCount;
      return result;
    };
    const boxHit = (bounds, at, ax, ay, az, dx, dy, dz) => {
      let lo = 0, hi = 1;
      for (let axis = 0; axis < 3; axis++) {
        const a = axis === 0 ? ax : axis === 1 ? ay : az, d = axis === 0 ? dx : axis === 1 ? dy : dz;
        if (Math.abs(d) < 1e-12) { if (a < bounds[at + axis] - EPS || a > bounds[at + axis + 3] + EPS) return false; }
        else {
          let t0 = (bounds[at + axis] - a) / d, t1 = (bounds[at + axis + 3] - a) / d;
          if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
          lo = Math.max(lo, t0); hi = Math.min(hi, t1); if (lo > hi + 1e-9) return false;
        }
      }
      return hi > 1e-5 && lo < 1 - 1e-5;
    };
    const triangleBlocks = (e, at, x, y, z, dx, dy, dz, ay, vy) => {
      const v = e.geometry.triangles;
      const px = dy * v[at + 8] - dz * v[at + 7], py = dz * v[at + 6] - dx * v[at + 8], pz = dx * v[at + 7] - dy * v[at + 6];
      const det = v[at + 3] * px + v[at + 4] * py + v[at + 5] * pz;
      if (Math.abs(det) < 1e-10) return false;
      const tx = x - v[at], ty = y - v[at + 1], tz = z - v[at + 2], u = (tx * px + ty * py + tz * pz) / det;
      if (u < -1e-7 || u > 1 + 1e-7) return false;
      const qx = ty * v[at + 5] - tz * v[at + 4], qy = tz * v[at + 3] - tx * v[at + 5], qz = tx * v[at + 4] - ty * v[at + 3], w = (dx * qx + dy * qy + dz * qz) / det;
      if (w < -1e-7 || u + w > 1 + 1e-7) return false;
      const t = (v[at + 6] * qx + v[at + 7] * qy + v[at + 8] * qz) / det;
      return t > 1e-5 && t < 1 - 1e-5 && y + dy * t >= e.clipMinY && ay + vy * t >= e.worldMinY && ay + vy * t <= e.worldMaxY;
    };
    const entryClear = (e, ax, ay, az, vx, vy, vz, length) => {
      const t = length ? Math.max(0, Math.min(1, ((e.x - ax) * vx + (e.y - ay) * vy + (e.z - az) * vz) / length)) : 0;
      const sx = ax + vx * t - e.x, sy = ay + vy * t - e.y, sz = az + vz * t - e.z;
      if (sx * sx + sy * sy + sz * sz > (e.radius + EPS) ** 2) return true;
      const m = e.inverse, g = e.geometry;
      const x = m[0] * ax + m[4] * ay + m[8] * az + m[12], y = m[1] * ax + m[5] * ay + m[9] * az + m[13], z = m[2] * ax + m[6] * ay + m[10] * az + m[14];
      const dx = m[0] * vx + m[4] * vy + m[8] * vz, dy = m[1] * vx + m[5] * vy + m[9] * vz, dz = m[2] * vx + m[6] * vy + m[10] * vz;
      // Adjacent silhouette rays often hit the same triangle: re-test that exact face with the current transform
      // and clip planes before walking the BVH; a miss falls back to the complete query.
      if (e.hitTriangle >= 0 && triangleBlocks(e, e.hitTriangle, x, y, z, dx, dy, dz, ay, vy)) return false;
      let top = 1; stack[0] = 0;
      while (top) {
        const id = stack[--top];
        if (!boxHit(g.bounds, id * 6, x, y, z, dx, dy, dz)) continue;
        if (!g.counts[id]) { stack[top++] = g.left[id]; stack[top++] = g.right[id]; continue; }
        for (let i = g.starts[id], end = i + g.counts[id]; i < end; i++) {
          const at = g.indices[i] * 9;
          if (triangleBlocks(e, at, x, y, z, dx, dy, dz, ay, vy)) { e.hitTriangle = at; return false; }
        }
      }
      return true;
    };
    const clear = (ax, ay, az, bx, by, bz, actor, targetOwner = null, fromCamera = false) => {
      const actorRoot = actor && actor.root;
      const vx = bx - ax, vy = by - ay, vz = bz - az, length = vx * vx + vy * vy + vz * vz;
      const minX = Math.min(ax, bx) - EPS, maxX = Math.max(ax, bx) + EPS;
      const minY = Math.min(ay, by) - EPS, maxY = Math.max(ay, by) + EPS;
      const minZ = Math.min(az, bz) - EPS, maxZ = Math.max(az, bz) + EPS;
      const perception = fromCamera === 3 || fromCamera === 4, camera = fromCamera && !perception;
      const pool = fromCamera === 3 ? perceptionOccluders : fromCamera === 2 ? targetOccluders : camera ? cameraOccluders : occluders, count = fromCamera === 3 ? perceptionOccluderCount : fromCamera === 2 ? targetCount : camera ? cameraOccluderCount : occluderCount;
      for (let n = 0; n < count; n++) {
        const e = pool[n]; if (e.owner === actorRoot || e.owner === targetOwner || perception && (e.character >= 0 || e.owner === ignoredPerceptionOwner)) continue;
        // Most nearby props miss this ray's enclosing box. Reject them before
        // projecting onto the segment or transforming it into local space.
        const pad = e.radius * 4e-7;
        if (e.x + e.hx + pad < minX || e.x - e.hx - pad > maxX || e.y + e.hy + pad < minY || e.y - e.hy - pad > maxY || e.z + e.hz + pad < minZ || e.z - e.hz - pad > maxZ) continue;
        if (!entryClear(e, ax, ay, az, vx, vy, vz, length)) return false;
      }
      for (let n = 0; n < providers.length; n++) {
        const provider = providers[n], group = ownerEntries.get(provider.owner);
        if (group.providerActive && provider.owner !== actorRoot && provider.owner !== targetOwner && !(perception && provider.owner === ignoredPerceptionOwner) && provider.clear && !provider.clear(ax, ay, az, bx, by, bz)) return false;
      }
      return true;
    };
    // Passing Oogas do not interrupt the observer's knowledge of nearby scenery; camera rays still include them
    // as actual visible blockers.
    const perceptionClear = (ax, ay, az, bx, by, bz, actor, targetOwner = null, fromCamera = false) => clear(ax, ay, az, bx, by, bz, actor, targetOwner, fromCamera || 4);
    // Certify an entire ray volume only when every opaque bound misses it; false is inconclusive and falls back
    // to the exact triangles.
    const boxClear = (minX, minY, minZ, maxX, maxY, maxZ, actor, targetOwner = null) => {
      const actorRoot = actor && actor.root;
      for (let n = 0; n < occluderCount; n++) {
        const e = occluders[n];
        if (e.owner === actorRoot || e.owner === targetOwner) continue;
        if (e.x + e.hx >= minX - EPS && e.x - e.hx <= maxX + EPS && e.y + e.hy >= minY - EPS && e.y - e.hy <= maxY + EPS && e.z + e.hz >= minZ - EPS && e.z - e.hz <= maxZ + EPS) return false;
      }
      for (let n = 0; n < providers.length; n++) {
        const provider = providers[n], group = ownerEntries.get(provider.owner);
        if (group.providerActive && provider.owner !== actorRoot && provider.owner !== targetOwner
          && (!provider.boxClear || !provider.boxClear(minX, minY, minZ, maxX, maxY, maxZ))) return false;
      }
      return true;
    };
    clear.boxClear = boxClear;
    const ownerClear = (owner, ax, ay, az, bx, by, bz) => {
      const group = ownerEntries.get(owner);
      if (!group) return true;
      const vx = bx - ax, vy = by - ay, vz = bz - az, length = vx * vx + vy * vy + vz * vz;
      for (let n = 0; n < group.length; n++) {
        const e = group[n];
        if (e.shown && !entryClear(e, ax, ay, az, vx, vy, vz, length)) return false;
      }
      return !(group.providerActive && group.provider.clear && !group.provider.clear(ax, ay, az, bx, by, bz));
    };
    const cameraClear = (ax, ay, az, bx, by, bz, actor, targetOwner = null) => {
      const group = targetOwner && ownerEntries.get(targetOwner);
      if (!group) return clear(ax, ay, az, bx, by, bz, actor, targetOwner, true);
      if (targetOwnerCache !== targetOwner || targetStamp !== collectStamp) {
        targetOwnerCache = targetOwner; targetStamp = collectStamp; targetCount = 0;
        const w = targetOwner.world;
        targetX = w[12]; targetY = w[13]; targetZ = w[14]; targetRadius = 0;
        for (let n = 0; n < group.length; n++) {
          const e = group[n];
          if (e.visible) targetRadius = Math.max(targetRadius, Math.hypot(e.x - targetX, e.y - targetY, e.z - targetZ) + e.radius);
        }
        // Every near-plane ray to this owner lies in this smaller capsule: reject unrelated objects once, keeping
        // exact triangle tests for every blocker and the original pool for other endpoints.
        const dx = targetX - cameraX, dy = targetY - cameraY, dz = targetZ - cameraZ, length = dx * dx + dy * dy + dz * dz;
        for (let n = 0; n < cameraOccluderCount; n++) {
          const e = cameraOccluders[n];
          if (e.owner === targetOwner) continue;
          const t = length ? Math.max(0, Math.min(1, ((e.x - cameraX) * dx + (e.y - cameraY) * dy + (e.z - cameraZ) * dz) / length)) : 0;
          if ((e.x - cameraX - dx * t) ** 2 + (e.y - cameraY - dy * t) ** 2 + (e.z - cameraZ - dz * t) ** 2 <= (targetRadius + e.radius + EPS) ** 2) targetOccluders[targetCount++] = e;
        }
      }
      const inside = (bx - targetX) ** 2 + (by - targetY) ** 2 + (bz - targetZ) ** 2 <= targetRadius * targetRadius + EPS
        && (ax - cameraX) ** 2 + (ay - cameraY) ** 2 + (az - cameraZ) ** 2 <= targetRadius * targetRadius + EPS;
      return clear(ax, ay, az, bx, by, bz, actor, targetOwner, inside ? 2 : true);
    };
    const distance = (owner, x, y, z) => {
      const group = ownerEntries.get(owner);
      let nearest = Infinity;
      if (group) for (let n = 0; n < group.length; n++) {
        const e = group[n];
        if (!e.visible) continue;
        const dx = x - e.x, dy = y - e.y, dz = z - e.z;
        const box = Math.hypot(Math.max(0, Math.abs(dx) - e.hx), Math.max(0, Math.abs(dy) - e.hy), Math.max(0, Math.abs(dz) - e.hz));
        nearest = Math.min(nearest, Math.max(0, box, Math.hypot(dx, dy, dz) - e.radius));
      }
      if (group && group.providerActive) nearest = Math.min(nearest, group.provider.distance(x, y, z));
      return nearest;
    };
    const inView = (owner) => {
      const group = ownerEntries.get(owner);
      if (!group) return false;
      for (let n = 0; n < group.length; n++) { const e = group[n]; if (e.visible && cameraIncludes(e.x, e.y, e.z, e.radius)) return true; }
      return !!(group.providerActive && group.provider.inView(activeCamera, cameraAspect));
    };
    const getProvider = (owner) => providerOwners.get(owner) || null;
    const collectPerceptionOccluders = (entry, x, y, z) => {
      const dx = entry.x - x, dy = entry.y - y, dz = entry.z - z, length = dx * dx + dy * dy + dz * dz, radius = Math.hypot(entry.hx, entry.hy, entry.hz);
      perceptionOccluderCount = 0;
      // Every ray to this entry lies inside the eye-to-entry capsule: keep scenery blockers; other Oogas cannot
      // interrupt outline eligibility.
      for (let n = 0; n < occluderCount; n++) {
        const e = occluders[n];
        if (e.owner === entry.owner || e.character >= 0 || e.owner === ignoredPerceptionOwner) continue;
        const t = length ? Math.max(0, Math.min(1, ((e.x - x) * dx + (e.y - y) * dy + (e.z - z) * dz) / length)) : 0;
        if ((e.x - x - dx * t) ** 2 + (e.y - y - dy * t) ** 2 + (e.z - z - dz * t) ** 2 <= (radius + e.radius + EPS) ** 2) perceptionOccluders[perceptionOccluderCount++] = e;
      }
    };
    const pointPerceived = (px, py, pz, actor, eyeX, eyeY, eyeZ, segmentClear, owner) => {
      const center = actor.root.position;
      if ((px - center.x) ** 2 + (py - center.y) ** 2 + (pz - center.z) ** 2 > RANGE * RANGE) return false;
      const dx = px - eyeX, dy = py - eyeY, dz = pz - eyeZ, length = Math.hypot(dx, dy, dz), t = length > 0.018 ? 1 - 0.018 / length : 0;
      const bx = eyeX + dx * t, by = eyeY + dy * t, bz = eyeZ + dz * t;
      // The nearby prop tree is cheaper than a terrain-grid walk; in dense foliage it rejects hidden samples before
      // tracing their long rock rays.
      return clear(eyeX, eyeY, eyeZ, bx, by, bz, actor, owner, 3) && segmentClear(eyeX, eyeY, eyeZ, bx, by, bz);
    };
    const sightBoundsBlocked = (cx, cy, cz, hx, hy, hz, x, y, z, segmentClear) => {
      if (!segmentClear.boxSolid) return false;
      const dx = cx - x, dy = cy - y, dz = cz - z;
      const nearest = Math.hypot(Math.max(0, Math.abs(dx) - hx), Math.max(0, Math.abs(dy) - hy), Math.max(0, Math.abs(dz) - hz));
      // Each cross-section contains every ray to the real entry bounds and must lie before even the closest
      // retreated surface endpoint.
      const end = nearest > 0.018 ? 1 - 0.018 / nearest : 0;
      for (let i = 15; i > 0; i--) {
        const t = i / 16;
        if (t >= end) continue;
        if (segmentClear.boxSolid(x + (dx - hx) * t, y + (dy - hy) * t, z + (dz - hz) * t,
          x + (dx + hx) * t, y + (dy + hy) * t, z + (dz + hz) * t)) return true;
      }
      return false;
    };
    const entrySightBlocked = (entry, x, y, z, segmentClear) => sightBoundsBlocked(entry.x, entry.y, entry.z, entry.hx, entry.hy, entry.hz, x, y, z, segmentClear);
    const localSightBlocked = (entry, minX, minY, minZ, maxX, maxY, maxZ, actor, x, y, z, segmentClear) => {
      const w = entry.node.world, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
      const hx = (maxX - minX) / 2, hy = (maxY - minY) / 2, hz = (maxZ - minZ) / 2;
      const px = w[0] * cx + w[4] * cy + w[8] * cz + w[12], py = w[1] * cx + w[5] * cy + w[9] * cz + w[13], pz = w[2] * cx + w[6] * cy + w[10] * cz + w[14];
      const rx = Math.abs(w[0]) * hx + Math.abs(w[4]) * hy + Math.abs(w[8]) * hz + EPS, ry = Math.abs(w[1]) * hx + Math.abs(w[5]) * hy + Math.abs(w[9]) * hz + EPS, rz = Math.abs(w[2]) * hx + Math.abs(w[6]) * hy + Math.abs(w[10]) * hz + EPS;
      const p = actor.root.position, dx = Math.max(0, Math.abs(px - p.x) - rx), dy = Math.max(0, Math.abs(py - p.y) - ry), dz = Math.max(0, Math.abs(pz - p.z) - rz);
      return dx * dx + dy * dy + dz * dz > RANGE * RANGE + EPS || sightBoundsBlocked(px, py, pz, rx, ry, rz, x, y, z, segmentClear);
    };
    const perceiveOwner = (group, actor, eyeX, eyeY, eyeZ, segmentClear) => {
      const owner = group.owner, center = actor.root.position;
      const witness = group.witnessEntry;
      // Revalidate an original surface witness, never a camera-dependent contour point; motion can invalidate it,
      // so the full search remains.
      if (witness && witness.visible && witness.source === group.witnessSource
        && Math.hypot(witness.x - center.x, witness.y - center.y, witness.z - center.z) - witness.radius <= RANGE) {
        const samples = witness.geometry.samples, at = group.witnessAt, w = witness.node.world, x = samples[at], y = samples[at + 1], z = samples[at + 2];
        collectPerceptionOccluders(witness, eyeX, eyeY, eyeZ);
        if (withinClip(witness, x, y, z) && pointPerceived(w[0] * x + w[4] * y + w[8] * z + w[12], w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14], actor, eyeX, eyeY, eyeZ, segmentClear, owner)) { stats.perceptionWitnessHits++; return true; }
      }
      for (let n = 0; n < group.length; n++) {
        const entry = group[n];
        if (!entry.visible || Math.hypot(entry.x - center.x, entry.y - center.y, entry.z - center.z) - entry.radius > RANGE) continue;
        if (entrySightBlocked(entry, eyeX, eyeY, eyeZ, segmentClear)) continue;
        collectPerceptionOccluders(entry, eyeX, eyeY, eyeZ);
        const geometry = entry.geometry, samples = geometry.samples, blocks = geometry.sampleBounds, w = entry.node.world;
        for (let block = 0; block < blocks.length; block += 6) {
          if (localSightBlocked(entry, blocks[block], blocks[block + 1], blocks[block + 2], blocks[block + 3], blocks[block + 4], blocks[block + 5], actor, eyeX, eyeY, eyeZ, segmentClear)) continue;
          for (let i = block / 6 * SAMPLE_BLOCK * 3, end = Math.min(samples.length, i + SAMPLE_BLOCK * 3); i < end; i += 3) {
            const x = samples[i], y = samples[i + 1], z = samples[i + 2];
            if (!withinClip(entry, x, y, z)) continue;
            const px = w[0] * x + w[4] * y + w[8] * z + w[12], py = w[1] * x + w[5] * y + w[9] * z + w[13], pz = w[2] * x + w[6] * y + w[10] * z + w[14];
            if (pointPerceived(px, py, pz, actor, eyeX, eyeY, eyeZ, segmentClear, owner)) { group.witnessEntry = entry; group.witnessSource = entry.source; group.witnessAt = i; return true; }
          }
        }
        // The fallback is the actor-eye contour in every direction, never the orbit camera's contour or frustum, so
        // its witness set is unchanged when the visitor turns, zooms or looks elsewhere.
        const v = geometry.lines, m = entry.inverse;
        const ex = m[0] * eyeX + m[4] * eyeY + m[8] * eyeZ + m[12], ey = m[1] * eyeX + m[5] * eyeY + m[9] * eyeZ + m[13], ez = m[2] * eyeX + m[6] * eyeY + m[10] * eyeZ + m[14];
        for (let j = 0; j < v.length; j += 6) {
          const start = geometry.edgeStarts[j / 6], end = geometry.edgeStarts[j / 6 + 1], normals = geometry.edgeNormals;
          if (end - start > 3) {
            let front = false, back = false;
            for (let at = start; at < end; at += 3) {
              const facing = normals[at] * (ex - v[j]) + normals[at + 1] * (ey - v[j + 1]) + normals[at + 2] * (ez - v[j + 2]);
              if (facing > EPS) front = true; else back = true;
            }
            if (!front || !back) continue;
          }
          if (localSightBlocked(entry, Math.min(v[j], v[j + 3]), Math.min(v[j + 1], v[j + 4]), Math.min(v[j + 2], v[j + 5]), Math.max(v[j], v[j + 3]), Math.max(v[j + 1], v[j + 4]), Math.max(v[j + 2], v[j + 5]), actor, eyeX, eyeY, eyeZ, segmentClear)) continue;
          const ax = w[0] * v[j] + w[4] * v[j + 1] + w[8] * v[j + 2] + w[12], ay = w[1] * v[j] + w[5] * v[j + 1] + w[9] * v[j + 2] + w[13], az = w[2] * v[j] + w[6] * v[j + 1] + w[10] * v[j + 2] + w[14];
          const dx = w[0] * v[j + 3] + w[4] * v[j + 4] + w[8] * v[j + 5] + w[12] - ax, dy = w[1] * v[j + 3] + w[5] * v[j + 4] + w[9] * v[j + 5] + w[13] - ay, dz = w[2] * v[j + 3] + w[6] * v[j + 4] + w[10] * v[j + 5] + w[14] - az;
          edgeLo = 0; edgeHi = 1;
          if (!clipSpan(ay, ay + dy, entry.worldMinY, entry.worldMaxY) || !clipSpan(v[j + 1], v[j + 4], entry.clipMinY, Infinity)) continue;
          const low = edgeLo, span = edgeHi - edgeLo, steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) * span / EDGE_STEP));
          for (let i = 0; i <= steps; i++) { const t = low + span * i / steps; if (pointPerceived(ax + dx * t, ay + dy * t, az + dz * t, actor, eyeX, eyeY, eyeZ, segmentClear, owner)) return true; }
        }
      }
      return !!(group.providerActive && group.provider.perceived(actor, eyeX, eyeY, eyeZ, segmentClear, perceptionClear));
    };
    const perceived = (owner, actor, eyeX, eyeY, eyeZ, segmentClear) => {
      const group = ownerEntries.get(owner);
      if (!group) return false;
      const p = actor.root.position, o = group.observer;
      // Other Oogas are excluded from actor sight rays: their animation can change camera occlusion without
      // invalidating remembered scenery; an observed Ooga refreshes via its own group revision.
      if (group.cacheActor === actor && group.cacheTerrain === segmentClear && group.cachePerception === result.perceptionVersion && group.cacheRevision === group.revision
        && o[0] === p.x && o[1] === p.y && o[2] === p.z && o[3] === eyeX && o[4] === eyeY && o[5] === eyeZ) {
        stats.perceptionCacheHits++; return group.cacheResult;
      }
      stats.perceptionQueries++;
      group.cacheActor = actor; group.cacheTerrain = segmentClear; group.cachePerception = result.perceptionVersion; group.cacheRevision = group.revision;
      o[0] = p.x; o[1] = p.y; o[2] = p.z; o[3] = eyeX; o[4] = eyeY; o[5] = eyeZ;
      const b = group.perceptionBounds;
      b[0] = b[3] = eyeX; b[1] = b[4] = eyeY; b[2] = b[5] = eyeZ;
      if (group.provider) { b[0] = b[1] = b[2] = -Infinity; b[3] = b[4] = b[5] = Infinity; }
      else for (let n = 0; n < group.length; n++) {
        const entry = group[n];
        if (!entry.visible) continue;
        const minX = Math.max(entry.x - entry.hx, p.x - RANGE), minY = Math.max(entry.y - entry.hy, p.y - RANGE), minZ = Math.max(entry.z - entry.hz, p.z - RANGE);
        const maxX = Math.min(entry.x + entry.hx, p.x + RANGE), maxY = Math.min(entry.y + entry.hy, p.y + RANGE), maxZ = Math.min(entry.z + entry.hz, p.z + RANGE);
        if (minX > maxX || minY > maxY || minZ > maxZ) continue;
        b[0] = Math.min(b[0], minX); b[1] = Math.min(b[1], minY); b[2] = Math.min(b[2], minZ);
        b[3] = Math.max(b[3], maxX); b[4] = Math.max(b[4], maxY); b[5] = Math.max(b[5], maxZ);
      }
      group.cacheResult = perceiveOwner(group, actor, eyeX, eyeY, eyeZ, segmentClear);
      return group.cacheResult;
    };
    const entryVolumeClear = (entry, actor, segmentClear) => {
      if (!segmentClear.boxClear) return false;
      const minX = Math.min(cameraX, entry.x - entry.hx), minY = Math.min(cameraY, entry.y - entry.hy), minZ = Math.min(cameraZ, entry.z - entry.hz);
      const maxX = Math.max(cameraX, entry.x + entry.hx), maxY = Math.max(cameraY, entry.y + entry.hy), maxZ = Math.max(cameraZ, entry.z + entry.hz);
      return segmentClear.boxClear(minX, minY, minZ, maxX, maxY, maxZ) && boxClear(minX, minY, minZ, maxX, maxY, maxZ, actor, entry.owner);
    };
    const cameraPointState = (x, y, z, owner, actor, segmentClear, hidden, certified, blocked = false) => {
      const m = cameraView, dx = x - cameraX, dy = y - cameraY, dz = z - cameraZ;
      const depth = -(m[2] * dx + m[6] * dy + m[10] * dz);
      if (depth <= near || depth > far || Math.abs(m[0] * dx + m[4] * dy + m[8] * dz) > depth * tanX || Math.abs(m[1] * dx + m[5] * dy + m[9] * dz) > depth * tanY) return 0;
      const start = near / depth, end = 1 - 0.018 / Math.hypot(dx, dy, dz);
      if (end <= start) return 0;
      if (certified) return 1;
      const ax = cameraX + dx * start, ay = cameraY + dy * start, az = cameraZ + dz * start;
      const bx = cameraX + dx * end, by = cameraY + dy * end, bz = cameraZ + dz * end;
      // A clear ray to any surface proves part of the owner visible even if a nearer part covers that sample; close
      // foliage often hides every sample, so test its small mesh before a long terrain walk.
      if (!blocked && cameraClear(ax, ay, az, bx, by, bz, actor, owner) && segmentClear(ax, ay, az, bx, by, bz)) return 1;
      // A buried back face alone cannot qualify a wholly hidden object.
      return !hidden && ownerClear(owner, ax, ay, az, bx, by, bz) ? 2 : 0;
    };
    const localCameraBlocked = (entry, minX, minY, minZ, maxX, maxY, maxZ, segmentClear, actor) => {
      const w = entry.node.world, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
      const hx = (maxX - minX) / 2, hy = (maxY - minY) / 2, hz = (maxZ - minZ) / 2;
      const x = w[0] * cx + w[4] * cy + w[8] * cz + w[12], y = w[1] * cx + w[5] * cy + w[9] * cz + w[13], z = w[2] * cx + w[6] * cy + w[10] * cz + w[14];
      const rx = Math.abs(w[0]) * hx + Math.abs(w[4]) * hy + Math.abs(w[8]) * hz + EPS, ry = Math.abs(w[1]) * hx + Math.abs(w[5]) * hy + Math.abs(w[9]) * hz + EPS, rz = Math.abs(w[2]) * hx + Math.abs(w[6]) * hy + Math.abs(w[10]) * hz + EPS;
      return boundsCameraPropBlocked(x, y, z, rx, ry, rz, actor, entry.owner, true)
        || !!segmentClear.boxSolid && boundsCameraRockBlocked(x, y, z, rx, ry, rz, segmentClear);
    };
    const concealed = (owner, actor, segmentClear) => {
      const group = ownerEntries.get(owner);
      if (!hasCamera || !group) return false;
      const witness = group.cameraWitnessEntry;
      if (witness && witness.visible && witness.source === group.cameraWitnessSource && cameraIncludes(witness.x, witness.y, witness.z, witness.radius)) {
        const samples = witness.geometry.samples, at = group.cameraWitnessAt, w = witness.node.world, x = samples[at], y = samples[at + 1], z = samples[at + 2];
        if (withinClip(witness, x, y, z) && cameraPointState(w[0] * x + w[4] * y + w[8] * z + w[12], w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14], owner, actor, segmentClear, true, false) === 1) { stats.cameraWitnessHits++; return false; }
      }
      // A visible head or platform rim can follow many hidden parts. Try a
      // few of their existing witnesses before exhausting any one part;
      // only a clear original sample short-circuits the complete search.
      for (let n = 0; n < group.length; n++) {
        const entry = group[n];
        if (!entry.visible || !cameraIncludes(entry.x, entry.y, entry.z, entry.radius) || !cameraBoxIncludes(entry)) continue;
        const samples = entry.geometry.samples, w = entry.node.world;
        for (let sample = 0; sample < 3; sample++) {
          const at = Math.floor((samples.length / 3 - 1) * sample / 2) * 3;
          const x = samples[at], y = samples[at + 1], z = samples[at + 2];
          if (withinClip(entry, x, y, z) && cameraPointState(w[0] * x + w[4] * y + w[8] * z + w[12], w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14], owner, actor, segmentClear, true, false) === 1) {
            group.cameraWitnessEntry = entry; group.cameraWitnessSource = entry.source; group.cameraWitnessAt = at;
            return false;
          }
        }
      }
      let hidden = false;
      for (let n = 0; n < group.length; n++) {
        const entry = group[n];
        if (!entry.visible || !cameraIncludes(entry.x, entry.y, entry.z, entry.radius) || !cameraBoxIncludes(entry)) continue;
        const geometry = entry.geometry, samples = geometry.samples, blocks = geometry.sampleBounds, w = entry.node.world, certified = entryVolumeClear(entry, actor, segmentClear);
        const blocked = !certified && (boundsCameraPropBlocked(entry.x, entry.y, entry.z, entry.hx, entry.hy, entry.hz, actor, owner, true)
          || !!segmentClear.boxSolid && boundsCameraRockBlocked(entry.x, entry.y, entry.z, entry.hx, entry.hy, entry.hz, segmentClear));
        if (blocked) { stats.cameraCertificates++; if (hidden) continue; }
        for (let block = 0; block < blocks.length; block += 6) {
          const patchBlocked = blocked || !certified && localCameraBlocked(entry, blocks[block], blocks[block + 1], blocks[block + 2], blocks[block + 3], blocks[block + 4], blocks[block + 5], segmentClear, actor);
          if (patchBlocked && hidden) continue;
          for (let i = block / 6 * SAMPLE_BLOCK * 3, end = Math.min(samples.length, i + SAMPLE_BLOCK * 3); i < end; i += 3) {
            const x = samples[i], y = samples[i + 1], z = samples[i + 2];
            if (!withinClip(entry, x, y, z)) continue;
            const state = cameraPointState(w[0] * x + w[4] * y + w[8] * z + w[12], w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14], owner, actor, segmentClear, hidden, certified, patchBlocked);
            if (state === 1) { group.cameraWitnessEntry = entry; group.cameraWitnessSource = entry.source; group.cameraWitnessAt = i; return false; }
            if (state === 2) hidden = true;
            if (hidden && patchBlocked) break;
          }
        }
        if (blocked && hidden) continue;
        // Retain thin-slit witnesses on camera contours; recognition uses its separate actor-eye samples and never
        // depends on these camera edges.
        const v = geometry.lines, m = entry.inverse;
        const ex = m[0] * cameraX + m[4] * cameraY + m[8] * cameraZ + m[12], ey = m[1] * cameraX + m[5] * cameraY + m[9] * cameraZ + m[13], ez = m[2] * cameraX + m[6] * cameraY + m[10] * cameraZ + m[14];
        for (let j = 0; j < v.length; j += 6) {
          const start = geometry.edgeStarts[j / 6], end = geometry.edgeStarts[j / 6 + 1], normals = geometry.edgeNormals;
          if (end - start > 3) {
            let front = false, back = false;
            for (let at = start; at < end; at += 3) {
              const facing = normals[at] * (ex - v[j]) + normals[at + 1] * (ey - v[j + 1]) + normals[at + 2] * (ez - v[j + 2]);
              if (facing > EPS) front = true; else back = true;
            }
            if (!front || !back) continue;
          }
          const edgeBlocked = blocked || !certified && localCameraBlocked(entry, Math.min(v[j], v[j + 3]), Math.min(v[j + 1], v[j + 4]), Math.min(v[j + 2], v[j + 5]), Math.max(v[j], v[j + 3]), Math.max(v[j + 1], v[j + 4]), Math.max(v[j + 2], v[j + 5]), segmentClear, actor);
          if (edgeBlocked && hidden) continue;
          const ax = w[0] * v[j] + w[4] * v[j + 1] + w[8] * v[j + 2] + w[12], ay = w[1] * v[j] + w[5] * v[j + 1] + w[9] * v[j + 2] + w[13], az = w[2] * v[j] + w[6] * v[j + 1] + w[10] * v[j + 2] + w[14];
          const dx = w[0] * v[j + 3] + w[4] * v[j + 4] + w[8] * v[j + 5] + w[12] - ax, dy = w[1] * v[j + 3] + w[5] * v[j + 4] + w[9] * v[j + 5] + w[13] - ay, dz = w[2] * v[j + 3] + w[6] * v[j + 4] + w[10] * v[j + 5] + w[14] - az;
          edgeLo = 0; edgeHi = 1;
          if (!clipSpan(ay, ay + dy, entry.worldMinY, entry.worldMaxY) || !clipSpan(v[j + 1], v[j + 4], entry.clipMinY, Infinity)) continue;
          const low = edgeLo, span = edgeHi - edgeLo, steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) * span / EDGE_STEP));
          for (let i = 0; i <= steps; i++) {
            const t = low + span * i / steps;
            const state = cameraPointState(ax + dx * t, ay + dy * t, az + dz * t, owner, actor, segmentClear, hidden, certified, edgeBlocked);
            if (state === 1) return false;
            if (state === 2) hidden = true;
            if (hidden && edgeBlocked) break;
          }
        }
      }
      if (group.providerActive) {
        const state = group.provider.cameraVisibility(actor, activeCamera, cameraAspect, segmentClear, clear, ownerClear);
        if (state === 1) return false;
        if (state === 2) hidden = true;
      }
      return hidden;
    };
    const actorView = new Float64Array(20);
    let lastActor = null, lastActorTerrain = null, lastActorRevision = -1, lastActorOcclusion = -1, actorViewMode = 0, actorVisibleResult = false;
    actorView.fill(NaN);
    const actorViewChanged = (actor, group, segmentClear, mode) => {
      const occlusion = propsBlockActor || mode === 2 ? result.occlusionVersion : result.structuralVersion;
      let changed = actorViewMode !== mode || lastActor !== actor || lastActorTerrain !== segmentClear || lastActorRevision !== group.revision || lastActorOcclusion !== occlusion;
      for (let i = 0; i < 16; i++) if (actorView[i] !== cameraView[i]) { actorView[i] = cameraView[i]; changed = true; }
      if (actorView[16] !== near || actorView[17] !== far || actorView[18] !== tanX || actorView[19] !== tanY) changed = true;
      actorView[16] = near; actorView[17] = far; actorView[18] = tanX; actorView[19] = tanY;
      if (!changed) return false;
      lastActor = actor; lastActorTerrain = segmentClear; lastActorRevision = group.revision; lastActorOcclusion = occlusion; actorViewMode = mode; actorVisibleResult = false;
      return true;
    };
    const section = new Float64Array(6);
    const boundsCameraRockBlocked = (worldX, worldY, worldZ, hx, hy, hz, segmentClear) => {
      const dx = worldX - cameraX, dy = worldY - cameraY, dz = worldZ - cameraZ;
      const firstTarget = -(cameraView[2] * dx + cameraView[6] * dy + cameraView[10] * dz)
        - Math.abs(cameraView[2]) * hx - Math.abs(cameraView[6]) * hy - Math.abs(cameraView[10]) * hz;
      const originScale = Math.max(1, Math.abs(cameraX), Math.abs(cameraY), Math.abs(cameraZ));
      // An eye just inside a wall may leave its rock before the first broad distance fraction: certify the ray cone
      // right after the near plane, then widen its depth in small deterministic increments.
      if (near + 0.00001 < firstTarget - 0.018) {
        section[0] = section[1] = section[2] = Infinity; section[3] = section[4] = section[5] = -Infinity;
        // Every parallel section scales these same corner ratios. All depths
        // are positive here; the nearest target bound cleared the near plane.
        for (let corner = 0; corner < 8; corner++) {
          const x = dx + (corner & 1 ? hx : -hx), y = dy + (corner & 2 ? hy : -hy), z = dz + (corner & 4 ? hz : -hz);
          const inverse = 1 / -(cameraView[2] * x + cameraView[6] * y + cameraView[10] * z), px = x * inverse, py = y * inverse, pz = z * inverse;
          section[0] = Math.min(section[0], px); section[1] = Math.min(section[1], py); section[2] = Math.min(section[2], pz);
          section[3] = Math.max(section[3], px); section[4] = Math.max(section[4], py); section[5] = Math.max(section[5], pz);
        }
        const ratioScale = Math.max(1, Math.abs(section[0]), Math.abs(section[1]), Math.abs(section[2]), Math.abs(section[3]), Math.abs(section[4]), Math.abs(section[5]));
        for (let step = 0; step < 10; step++) {
          const cut = near + (step ? 0.002 * 2 ** (step - 1) : 0.00001);
          if (cut >= firstTarget - 0.018) break;
          // Round outward after reassociating the projection arithmetic: an
          // uncertain boundary must not certify a visible opening as solid.
          const pad = 1e-12 * (originScale + cut * ratioScale);
          if (segmentClear.boxSolid(cameraX + cut * section[0] - pad, cameraY + cut * section[1] - pad, cameraZ + cut * section[2] - pad,
            cameraX + cut * section[3] + pad, cameraY + cut * section[4] + pad, cameraZ + cut * section[5] + pad)) return true;
        }
      }
      const primary = Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) >= Math.abs(dz) ? 0 : Math.abs(dy) >= Math.abs(dz) ? 1 : 2;
      // A thin stair-stepped wall may be solid on one grid axis only: try each axis before treating the body as
      // possibly seen.
      for (let pass = 0; pass < 3; pass++) {
        const axis = (primary + pass) % 3;
        const span = axis === 0 ? dx : axis === 1 ? dy : dz, half = axis === 0 ? hx : axis === 1 ? hy : hz;
        if (Math.abs(span) <= half + 0.018) continue;
        const sign = Math.sign(span), limit = Math.abs(span) - half - 0.018;
        const nearEnd = near * (-sign * cameraView[axis * 4 + 2] + tanX * Math.abs(cameraView[axis * 4]) + tanY * Math.abs(cameraView[axis * 4 + 1]));
        const grid = segmentClear.boxGrid;
        let gridCell = 0, gridCut = 0, gridEnd = 0, gridStep = 0;
        if (grid) {
          const coordinate = axis === 0 ? cameraX : axis === 1 ? cameraY : cameraZ, origin = grid[axis + 1], unit = grid[0];
          gridCell = Math.floor((coordinate - origin) / unit);
          gridCut = origin + (gridCell + 0.5) * unit - coordinate;
          if (sign * gridCut <= EPS) { gridCell += sign; gridCut += sign * unit; }
          gridEnd = Math.abs(span) - half - 0.018;
          gridStep = sign * unit;
        }
        const sections = grid ? Math.ceil(gridEnd / grid[0]) + 1 : 15;
        section[0] = section[1] = section[2] = Infinity; section[3] = section[4] = section[5] = -Infinity;
        let minimumDepth = Infinity;
        // The axis guard keeps every denominator strictly on the same side
        // of zero. Its sign lets either direction use a positive cut length.
        for (let corner = 0; corner < 8; corner++) {
          const x = dx + (corner & 1 ? hx : -hx), y = dy + (corner & 2 ? hy : -hy), z = dz + (corner & 4 ? hz : -hz);
          const inverse = 1 / (sign * (axis === 0 ? x : axis === 1 ? y : z)), px = x * inverse, py = y * inverse, pz = z * inverse;
          const depth = -(cameraView[2] * x + cameraView[6] * y + cameraView[10] * z) * inverse;
          minimumDepth = Math.min(minimumDepth, depth);
          section[0] = Math.min(section[0], px); section[1] = Math.min(section[1], py); section[2] = Math.min(section[2], pz);
          section[3] = Math.max(section[3], px); section[4] = Math.max(section[4], py); section[5] = Math.max(section[5], pz);
        }
        const ratioScale = Math.max(1, Math.abs(section[0]), Math.abs(section[1]), Math.abs(section[2]), Math.abs(section[3]), Math.abs(section[4]), Math.abs(section[5]));
        for (let step = 1; step <= sections; step++) {
          const cut = grid ? gridCut + gridStep * (step - 1) : span * step / 16;
          // Stop before the nearest body extent, even if one grid stride jumps past a tiny limb or accessory.
          if (sign * cut >= limit) break;
          // Off-screen box corners can point behind the eye; a cut beyond the whole viewport's near plane still
          // precedes every rendered body ray.
          const distance = Math.abs(cut), pastNear = distance > nearEnd + EPS, depth = distance * minimumDepth;
          if (!pastNear && depth <= near + EPS + 1e-12 * Math.max(1, Math.abs(depth))) continue;
          // A plane cross-section stays thin even for a deep body, so a thin wall can certify every ray without closing
          // a real window slit.
          const pad = 1e-12 * (originScale + distance * ratioScale);
          if (segmentClear.boxSolid(cameraX + distance * section[0] - pad, cameraY + distance * section[1] - pad, cameraZ + distance * section[2] - pad,
            cameraX + distance * section[3] + pad, cameraY + distance * section[4] + pad, cameraZ + distance * section[5] + pad)) return true;
        }
      }
      return false;
    };
    const splitCameraRockBlocked = (worldX, worldY, worldZ, hx, hy, hz, segmentClear, depth) => {
      if (!cameraBoundsIncludes(worldX, worldY, worldZ, hx, hy, hz)) return true;
      if (boundsCameraRockBlocked(worldX, worldY, worldZ, hx, hy, hz, segmentClear)) return true;
      if (!depth) return false;
      const shx = hx / 2, shy = hy / 2, shz = hz / 2;
      for (let part = 0; part < 8; part++) if (!splitCameraRockBlocked(worldX + (part & 1 ? shx : -shx), worldY + (part & 2 ? shy : -shy), worldZ + (part & 4 ? shz : -shz), shx, shy, shz, segmentClear, depth - 1)) return false;
      return true;
    };
    const triangleCameraRockBlocked = (ax, ay, az, bx, by, bz, cx, cy, cz, segmentClear, depth) => {
      const minX = Math.min(ax, bx, cx), minY = Math.min(ay, by, cy), minZ = Math.min(az, bz, cz), maxX = Math.max(ax, bx, cx), maxY = Math.max(ay, by, cy), maxZ = Math.max(az, bz, cz);
      const worldX = (minX + maxX) / 2, worldY = (minY + maxY) / 2, worldZ = (minZ + maxZ) / 2, hx = (maxX - minX) / 2, hy = (maxY - minY) / 2, hz = (maxZ - minZ) / 2;
      if (!cameraBoundsIncludes(worldX, worldY, worldZ, hx, hy, hz)) return true;
      const adx = ax - cameraX, ady = ay - cameraY, adz = az - cameraZ, bdx = bx - cameraX, bdy = by - cameraY, bdz = bz - cameraZ, cdx = cx - cameraX, cdy = cy - cameraY, cdz = cz - cameraZ;
      const da = -(cameraView[2] * adx + cameraView[6] * ady + cameraView[10] * adz), db = -(cameraView[2] * bdx + cameraView[6] * bdy + cameraView[10] * bdz), dc = -(cameraView[2] * cdx + cameraView[6] * cdy + cameraView[10] * cdz), cut = near + 0.00001;
      if (Math.min(da, db, dc) > cut + 0.018) {
        const ta = cut / da, tb = cut / db, tc = cut / dc;
        const pax = cameraX + adx * ta, pay = cameraY + ady * ta, paz = cameraZ + adz * ta, pbx = cameraX + bdx * tb, pby = cameraY + bdy * tb, pbz = cameraZ + bdz * tb, pcx = cameraX + cdx * tc, pcy = cameraY + cdy * tc, pcz = cameraZ + cdz * tc;
        if (segmentClear.boxSolid(Math.min(pax, pbx, pcx), Math.min(pay, pby, pcy), Math.min(paz, pbz, pcz), Math.max(pax, pbx, pcx), Math.max(pay, pby, pcy), Math.max(paz, pbz, pcz))) return true;
      }
      if (boundsCameraRockBlocked(worldX, worldY, worldZ, hx, hy, hz, segmentClear)) return true;
      if (!depth) return false;
      const abx = (ax + bx) / 2, aby = (ay + by) / 2, abz = (az + bz) / 2, bcx = (bx + cx) / 2, bcy = (by + cy) / 2, bcz = (bz + cz) / 2, cax = (cx + ax) / 2, cay = (cy + ay) / 2, caz = (cz + az) / 2;
      return triangleCameraRockBlocked(ax, ay, az, abx, aby, abz, cax, cay, caz, segmentClear, depth - 1)
        && triangleCameraRockBlocked(abx, aby, abz, bx, by, bz, bcx, bcy, bcz, segmentClear, depth - 1)
        && triangleCameraRockBlocked(cax, cay, caz, bcx, bcy, bcz, cx, cy, cz, segmentClear, depth - 1)
        && triangleCameraRockBlocked(abx, aby, abz, bcx, bcy, bcz, cax, cay, caz, segmentClear, depth - 1);
    };
    const entryCameraRockBlocked = (entry, segmentClear) => {
      if (!segmentClear.boxSolid) return false;
      if (splitCameraRockBlocked(entry.x, entry.y, entry.z, entry.hx, entry.hy, entry.hz, segmentClear, 2)) return true;
      const triangles = entry.geometry.triangles, w = entry.node.world;
      for (let i = 0; i < triangles.length; i += 9) {
        const x = triangles[i], y = triangles[i + 1], z = triangles[i + 2], ux = triangles[i + 3], uy = triangles[i + 4], uz = triangles[i + 5], vx = triangles[i + 6], vy = triangles[i + 7], vz = triangles[i + 8];
        const ax = w[0] * x + w[4] * y + w[8] * z + w[12], ay = w[1] * x + w[5] * y + w[9] * z + w[13], az = w[2] * x + w[6] * y + w[10] * z + w[14];
        const bx = ax + w[0] * ux + w[4] * uy + w[8] * uz, by = ay + w[1] * ux + w[5] * uy + w[9] * uz, bz = az + w[2] * ux + w[6] * uy + w[10] * uz;
        const cx = ax + w[0] * vx + w[4] * vy + w[8] * vz, cy = ay + w[1] * vx + w[5] * vy + w[9] * vz, cz = az + w[2] * vx + w[6] * vy + w[10] * vz;
        if (!triangleCameraRockBlocked(ax, ay, az, bx, by, bz, cx, cy, cz, segmentClear, 2)) return false;
      }
      return true;
    };
    // Adjacent target patches reuse one exact face cone within a collection.
    // Larger polygons retain the uncached support test with no query allocation.
    const cameraPropPlanes = new Float64Array(5 + 64 * 3);
    let cameraPropEntry = null, cameraPropSource = null, cameraPropFace = -1, cameraPropStamp = -1, cameraPropAll = false, cameraPropCount = 0;
    let cameraPropClip = -Infinity, cameraPropMin = -Infinity, cameraPropMax = Infinity;
    const cameraPropFaceBlocked = (e, faceIndex, dx, dy, dz, hx, hy, hz, ex, ey, ez, allProps) => {
      const g = e.node.geometry;
      const cached = cameraPropEntry === e && cameraPropSource === g && cameraPropFace === faceIndex && cameraPropStamp === collectStamp && cameraPropAll === allProps
        && cameraPropClip === e.clipMinY && cameraPropMin === e.worldMinY && cameraPropMax === e.worldMaxY;
      let nx = 0, ny = 0, nz = 0, front, wx, wy, wz, retreat, v, m, face;
      if (cached) {
        wx = cameraPropPlanes[0]; wy = cameraPropPlanes[1]; wz = cameraPropPlanes[2]; front = cameraPropPlanes[3]; retreat = cameraPropPlanes[4];
      } else {
        v = g.verts; m = e.inverse; face = g.faces[e.geometry.coverFaces[faceIndex]];
        const a = face.i[0] * 3, b = face.i[1] * 3, c = face.i[2] * 3;
        const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], vx = v[c] - v[a], vy = v[c + 1] - v[a + 1], vz = v[c + 2] - v[a + 2];
        nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
        const facing = nx * (ex - v[a]) + ny * (ey - v[a + 1]) + nz * (ez - v[a + 2]);
        if (allProps ? Math.abs(facing) <= EPS : facing <= EPS) return false;
        const sign = allProps && facing < 0 ? -1 : 1;
        front = facing * sign;
        wx = (nx * m[0] + ny * m[1] + nz * m[2]) * sign; wy = (nx * m[4] + ny * m[5] + nz * m[6]) * sign; wz = (nx * m[8] + ny * m[9] + nz * m[10]) * sign;
        retreat = 0.018 * Math.hypot(wx, wy, wz) + EPS;
      }
      const target = front + wx * dx + wy * dy + wz * dz, support = Math.abs(wx) * hx + Math.abs(wy) * hy + Math.abs(wz) * hz;
      if (target + support >= -retreat) return false;
      if (cached) {
        for (let at = 5; at < cameraPropCount; at += 3) {
          const ax = cameraPropPlanes[at], ay = cameraPropPlanes[at + 1], az = cameraPropPlanes[at + 2];
          const x = ax * dx, y = ay * dy, z = az * dz, reach = Math.abs(ax) * hx + Math.abs(ay) * hy + Math.abs(az) * hz;
          if (x + y + z - reach <= 1e-12 * Math.max(1, Math.abs(x) + Math.abs(y) + Math.abs(z) + reach)) return false;
        }
        return true;
      }
      const cacheable = (face.i.length + 4) * 3 + 5 <= cameraPropPlanes.length;
      let at = 5;
      if (cacheable) cameraPropEntry = cameraPropSource = null;
      // Every ray-plane denominator is now positive. Multiplying the near,
      // clip and convex-edge inequalities by it makes each a linear plane
      // over the target box; its support tests all eight corners at once.
      for (let plane = -4; plane < face.i.length; plane++) {
        let ax, ay, az;
        if (plane === -4) {
          const cut = near + EPS;
          ax = cut * wx - front * cameraView[2]; ay = cut * wy - front * cameraView[6]; az = cut * wz - front * cameraView[10];
        } else if (plane === -3) {
          if (e.clipMinY === -Infinity) continue;
          const eye = ey - e.clipMinY - EPS;
          ax = front * m[1] - eye * wx; ay = front * m[5] - eye * wy; az = front * m[9] - eye * wz;
        } else if (plane === -2) {
          if (e.worldMinY === -Infinity) continue;
          const eye = cameraY - e.worldMinY - EPS;
          ax = -eye * wx; ay = front - eye * wy; az = -eye * wz;
        } else if (plane === -1) {
          if (e.worldMaxY === Infinity) continue;
          const eye = e.worldMaxY - EPS - cameraY;
          ax = -eye * wx; ay = -front - eye * wy; az = -eye * wz;
        } else {
          const p = face.i[plane] * 3, q = face.i[(plane + 1) % face.i.length] * 3;
          const ux = v[q] - v[p], uy = v[q + 1] - v[p + 1], uz = v[q + 2] - v[p + 2];
          const kx = ny * uz - nz * uy, ky = nz * ux - nx * uz, kz = nx * uy - ny * ux;
          const eye = kx * (ex - v[p]) + ky * (ey - v[p + 1]) + kz * (ez - v[p + 2]) - EPS;
          ax = front * (kx * m[0] + ky * m[1] + kz * m[2]) - eye * wx;
          ay = front * (kx * m[4] + ky * m[5] + kz * m[6]) - eye * wy;
          az = front * (kx * m[8] + ky * m[9] + kz * m[10]) - eye * wz;
        }
        if (cacheable) { cameraPropPlanes[at++] = ax; cameraPropPlanes[at++] = ay; cameraPropPlanes[at++] = az; }
        const x = ax * dx, y = ay * dy, z = az * dz, reach = Math.abs(ax) * hx + Math.abs(ay) * hy + Math.abs(az) * hz;
        // Keep roundoff and equality inconclusive, never an opaque certificate.
        if (x + y + z - reach <= 1e-12 * Math.max(1, Math.abs(x) + Math.abs(y) + Math.abs(z) + reach)) return false;
      }
      if (cacheable) {
        cameraPropEntry = e; cameraPropSource = g; cameraPropFace = faceIndex; cameraPropStamp = collectStamp; cameraPropAll = allProps; cameraPropCount = at;
        cameraPropClip = e.clipMinY; cameraPropMin = e.worldMinY; cameraPropMax = e.worldMaxY;
        cameraPropPlanes[0] = wx; cameraPropPlanes[1] = wy; cameraPropPlanes[2] = wz; cameraPropPlanes[3] = front; cameraPropPlanes[4] = retreat;
      }
      return true;
    };
    const boundsCameraPropBlocked = (worldX, worldY, worldZ, hx, hy, hz, actor, owner = null, allProps = false) => {
      const dx = worldX - cameraX, dy = worldY - cameraY, dz = worldZ - cameraZ, length = dx * dx + dy * dy + dz * dz, radius = Math.hypot(hx, hy, hz);
      // Neighboring subtrees often sit behind the same leaf or stone face: re-test that exact face first; a miss
      // still searches every blocker.
      for (let n = -1; n < cameraOccluderCount; n++) {
        const e = n < 0 ? cameraCoverEntry : cameraOccluders[n];
        if (!e || !e.visible || n < 0 && (e.source !== cameraCoverSource || e.node.geometry !== cameraCoverSource) || e.owner === actor.root || e.owner === owner || !allProps && !propsBlockActor && !e.node.sightSolid) continue;
        const t = length ? Math.max(0, Math.min(1, ((e.x - cameraX) * dx + (e.y - cameraY) * dy + (e.z - cameraZ) * dz) / length)) : 0;
        if ((e.x - cameraX - dx * t) ** 2 + (e.y - cameraY - dy * t) ** 2 + (e.z - cameraZ - dz * t) ** 2 > (radius + e.radius) ** 2) continue;
        // A face covering the whole box must also block its center ray: reject clear candidates before scanning every
        // convex face; the cached face above stays the first exact check.
        if (n >= 0 && entryClear(e, cameraX, cameraY, cameraZ, dx, dy, dz, length)) continue;
        const m = e.inverse;
        // Reflected transforms reverse rendered winding: leave these rare cases uncertain instead of certifying with
        // a back-facing polygon.
        if (m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]) <= 0) continue;
        const ex = m[0] * cameraX + m[4] * cameraY + m[8] * cameraZ + m[12], ey = m[1] * cameraX + m[5] * cameraY + m[9] * cameraZ + m[13], ez = m[2] * cameraX + m[6] * cameraY + m[10] * cameraZ + m[14];
        // The center-ray hit often identifies the face covering this patch: try it before the other faces, keeping
        // the complete fallback.
        const witness = n < 0 ? cameraCoverFace : e.geometry.triangleCoverFaces[e.hitTriangle / 9];
        for (let scan = -1, end = n < 0 ? 0 : e.geometry.coverFaces.length; scan < end; scan++) {
          const faceIndex = scan < 0 ? witness : scan;
          if (faceIndex < 0 || scan >= 0 && faceIndex === witness) continue;
          if (cameraPropFaceBlocked(e, faceIndex, dx, dy, dz, hx, hy, hz, ex, ey, ez, allProps)) {
            cameraCoverEntry = e; cameraCoverSource = e.source; cameraCoverFace = faceIndex;
            return true;
          }
        }
      }
      return false;
    };
    // Certify a whole target patch before its partial-outline pass samples rays; 0 is deliberately inconclusive,
    // a mixed or merely overlapping bound must never hide a real slit or a visible near edge.
    const cameraBoundsState = (minX, minY, minZ, maxX, maxY, maxZ, actor, owner, segmentClear, propsOnly = false) => {
      if (!hasCamera) return 0;
      const x = (minX + maxX) / 2, y = (minY + maxY) / 2, z = (minZ + maxZ) / 2;
      const hx = (maxX - minX) / 2, hy = (maxY - minY) / 2, hz = (maxZ - minZ) / 2;
      const x0 = Math.min(cameraX, minX), y0 = Math.min(cameraY, minY), z0 = Math.min(cameraZ, minZ);
      const x1 = Math.max(cameraX, maxX), y1 = Math.max(cameraY, maxY), z1 = Math.max(cameraZ, maxZ);
      // Exclude the target shell but retain distinct owners such as the stone platform beneath it; contact makes
      // this uncertain, not clear.
      if (segmentClear.boxClear && segmentClear.boxClear(x0, y0, z0, x1, y1, z1)
        && boxClear(x0, y0, z0, x1, y1, z1, actor, owner)) return 1;
      if (propsOnly) return boundsCameraPropBlocked(x, y, z, hx, hy, hz, actor, owner, true) ? 2 : 0;
      if (boundsCameraPropBlocked(x, y, z, hx, hy, hz, actor, owner, true)) return 2;
      return segmentClear.boxSolid && boundsCameraRockBlocked(x, y, z, hx, hy, hz, segmentClear) ? 2 : 0;
    };
    const actorVisible = (actor, segmentClear) => {
      const group = actor && ownerEntries.get(actor.root);
      if (!hasCamera || !group) return false;
      if (!actorViewChanged(actor, group, segmentClear, 1)) return actorVisibleResult;
      for (let n = 0; n < group.length; n++) {
        const entry = group[n];
        if (!entry.shown || !cameraBoxIncludes(entry)) continue;
        if (entryCameraRockBlocked(entry, segmentClear) || boundsCameraPropBlocked(entry.x, entry.y, entry.z, entry.hx, entry.hy, entry.hz, actor)) continue;
        // A finite sample grid cannot rule out a tiny visible sliver: only complete occlusion certificates enable
        // outlines; uncertainty hides them, including a bound that just grazes the camera frustum.
        actorVisibleResult = true;
        return true;
      }
      return false;
    };
    const actorFullyVisible = (actor, segmentClear) => {
      const group = actor && ownerEntries.get(actor.root);
      if (!hasCamera || !group) return false;
      if (!actorViewChanged(actor, group, segmentClear, 2)) return actorVisibleResult;
      let present = false;
      for (let n = 0; n < group.length; n++) {
        const entry = group[n];
        if (!entry.shown) continue;
        present = true;
        const vertices = entry.node.geometry.verts, samples = entry.geometry.samples, w = entry.node.world, m = cameraView;
        // The frustum is convex, so its six planes need only the actual mesh vertices; a clipped part means the whole
        // character is not visible.
        for (let i = 0; i < vertices.length; i += 3) {
          const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
          const dx = w[0] * x + w[4] * y + w[8] * z + w[12] - cameraX, dy = w[1] * x + w[5] * y + w[9] * z + w[13] - cameraY, dz = w[2] * x + w[6] * y + w[10] * z + w[14] - cameraZ;
          const depth = -(m[2] * dx + m[6] * dy + m[10] * dz);
          if (depth <= near || depth > far || Math.abs(m[0] * dx + m[4] * dy + m[8] * dz) > depth * tanX || Math.abs(m[1] * dx + m[5] * dy + m[9] * dz) > depth * tanY) return false;
        }
        if (entryVolumeClear(entry, actor, segmentClear)) continue;
        for (let i = 0; i < samples.length; i += 3) {
          const x = samples[i], y = samples[i + 1], z = samples[i + 2];
          if (cameraPointState(w[0] * x + w[4] * y + w[8] * z + w[12], w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14], actor.root, actor, segmentClear, false, false) === 2) return false;
        }
      }
      actorVisibleResult = present;
      return actorVisibleResult;
    };
    const boundaryBounds = (entry) => {
      stats.boundaryBuilds++;
      boundaryStorage(entry);
      const geometry = entry.geometry, m = boundaryView;
      BL.math.mat4.multiply(m, cameraView, entry.world);
      // All owner-union rays share this eye and camera basis. Cache the
      // Moller-Trumbore numerators, retaining its exact barycentric and clip
      // tests while avoiding repeated transforms/cross products per sample.
      const inverse = entry.inverse, ray = entry.boundaryRay, view = cameraView;
      ray[0] = inverse[0] * cameraX + inverse[4] * cameraY + inverse[8] * cameraZ + inverse[12];
      ray[1] = inverse[1] * cameraX + inverse[5] * cameraY + inverse[9] * cameraZ + inverse[13];
      ray[2] = inverse[2] * cameraX + inverse[6] * cameraY + inverse[10] * cameraZ + inverse[14];
      for (let axis = 0; axis < 3; axis++) {
        const sign = axis === 2 ? -1 : 1;
        for (let row = 0; row < 3; row++) ray[3 + axis * 3 + row] = sign * (inverse[row] * view[axis] + inverse[row + 4] * view[axis + 4] + inverse[row + 8] * view[axis + 8]);
      }
      const v = geometry.triangles, data = entry.boundaryTriangles;
      for (let at = 0, out = 0; at < v.length; at += 9, out += 10) {
        const tx = ray[0] - v[at], ty = ray[1] - v[at + 1], tz = ray[2] - v[at + 2];
        const nx = v[at + 4] * v[at + 8] - v[at + 5] * v[at + 7], ny = v[at + 5] * v[at + 6] - v[at + 3] * v[at + 8], nz = v[at + 3] * v[at + 7] - v[at + 4] * v[at + 6];
        const ux = v[at + 7] * tz - v[at + 8] * ty, uy = v[at + 8] * tx - v[at + 6] * tz, uz = v[at + 6] * ty - v[at + 7] * tx;
        const qx = ty * v[at + 5] - tz * v[at + 4], qy = tz * v[at + 3] - tx * v[at + 5], qz = tx * v[at + 4] - ty * v[at + 3];
        for (let axis = 0; axis < 3; axis++) {
          const i = 3 + axis * 3;
          data[out + axis] = -(nx * ray[i] + ny * ray[i + 1] + nz * ray[i + 2]);
          data[out + 3 + axis] = ux * ray[i] + uy * ray[i + 1] + uz * ray[i + 2];
          data[out + 6 + axis] = qx * ray[i] + qy * ray[i + 1] + qz * ray[i + 2];
        }
        data[out + 9] = v[at + 6] * qx + v[at + 7] * qy + v[at + 8] * qz;
        // Thousands of adjacent contour rays share these projected triangles.
        // A conservative screen box rejects most leaf misses before the exact
        // barycentric query. Near-plane crossings retain the full query.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let corner = 0; corner < 3; corner++) {
          const x = v[at] + (corner ? v[at + corner * 3] : 0), y = v[at + 1] + (corner ? v[at + corner * 3 + 1] : 0), z = v[at + 2] + (corner ? v[at + corner * 3 + 2] : 0);
          const depth = -(m[2] * x + m[6] * y + m[10] * z + m[14]);
          if (depth <= near) { minX = minY = -Infinity; maxX = maxY = Infinity; break; }
          const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / depth, py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / depth;
          minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
        }
        const pad = Math.max(1, Math.abs(minX), Math.abs(minY), Math.abs(maxX), Math.abs(maxY)) * EPS, box = out / 10 * 4, boxes = entry.boundaryBoxes;
        boxes[box] = minX - pad; boxes[box + 1] = minY - pad; boxes[box + 2] = maxX + pad; boxes[box + 3] = maxY + pad;
      }
      // Reuse the mesh BVH in screen space. Its children follow their parent,
      // so a reverse pass unions conservative triangle boxes without sorting
      // or allocating. Near-plane crossings remain unbounded at every level.
      const nodes = entry.boundaryNodes, boxes = entry.boundaryBoxes;
      for (let id = geometry.counts.length - 1; id >= 0; id--) {
        const at = id * 4;
        if (geometry.counts[id]) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (let n = geometry.starts[id], end = n + geometry.counts[id]; n < end; n++) {
            const box = geometry.indices[n] * 4;
            minX = Math.min(minX, boxes[box]); minY = Math.min(minY, boxes[box + 1]);
            maxX = Math.max(maxX, boxes[box + 2]); maxY = Math.max(maxY, boxes[box + 3]);
          }
          nodes[at] = minX; nodes[at + 1] = minY; nodes[at + 2] = maxX; nodes[at + 3] = maxY;
        } else {
          const left = geometry.left[id] * 4, right = geometry.right[id] * 4;
          nodes[at] = Math.min(nodes[left], nodes[right]); nodes[at + 1] = Math.min(nodes[left + 1], nodes[right + 1]);
          nodes[at + 2] = Math.max(nodes[left + 2], nodes[right + 2]); nodes[at + 3] = Math.max(nodes[left + 3], nodes[right + 3]);
        }
      }
      // The root already bounds every projected triangle, more tightly than
      // projecting the mesh's local AABB, including its near-plane fallback.
      for (let axis = 0; axis < 4; axis++) entry.boundaryBounds[axis] = nodes[axis];
      indexTriangles(entry);
    };
    const indexTriangles = (entry) => {
      const grid = entry.boundaryGrid;
      if (!grid) return;
      grid.active = false;
      const b = entry.boundaryBounds, width = b[2] - b[0], height = b[3] - b[1];
      if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return;
      const size = grid.size, scaleX = size / width, scaleY = size / height, boxes = entry.boundaryBoxes, count = entry.geometry.triangles.length / 9;
      const offsets = grid.offsets, cursors = grid.cursors, spans = grid.spans;
      cursors.fill(0); grid.scaleX = scaleX; grid.scaleY = scaleY;
      let references = 0;
      for (let i = 0; i < count; i++) {
        const at = i * 4;
        const x0 = Math.min(size - 1, Math.floor((boxes[at] - b[0]) * scaleX)), x1 = Math.min(size - 1, Math.floor((boxes[at + 2] - b[0]) * scaleX));
        const y0 = Math.min(size - 1, Math.floor((boxes[at + 1] - b[1]) * scaleY)), y1 = Math.min(size - 1, Math.floor((boxes[at + 3] - b[1]) * scaleY));
        references += (x1 - x0 + 1) * (y1 - y0 + 1);
        if (references > grid.indices.length) return;
        spans[at] = x0; spans[at + 1] = y0; spans[at + 2] = x1; spans[at + 3] = y1;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cursors[y * size + x]++;
      }
      let used = 0;
      for (let cell = 0; cell < cursors.length; cell++) { offsets[cell] = used; used += cursors[cell]; }
      // Very broad projected triangles use the existing BVH rather than grow
      // the registration-time allocation or truncate a cell's candidates.
      if (used > grid.indices.length) return;
      offsets[cursors.length] = used; cursors.fill(0);
      for (let i = 0; i < count; i++) {
        const at = i * 4;
        for (let y = spans[at + 1]; y <= spans[at + 3]; y++) for (let x = spans[at]; x <= spans[at + 2]; x++) {
          const cell = y * size + x;
          grid.indices[offsets[cell] + cursors[cell]++] = i * 10;
        }
      }
      grid.active = true; stats.boundaryGridBuilds++;
    };
    const indexBoundary = (group) => {
      const grid = group.boundaryGrid;
      if (!grid) return;
      grid.active = false;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < group.length; i++) if (group[i].visible) {
        const b = group[i].boundaryBounds;
        minX = Math.min(minX, b[0]); minY = Math.min(minY, b[1]); maxX = Math.max(maxX, b[2]); maxY = Math.max(maxY, b[3]);
      }
      const width = maxX - minX, height = maxY - minY;
      // Owners crossing the near plane retain the unrestricted exact scan.
      if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return;
      const scaleX = BOUNDARY_GRID / width, scaleY = BOUNDARY_GRID / height, bounds = grid.bounds;
      bounds[0] = minX; bounds[1] = minY; bounds[2] = maxX; bounds[3] = maxY;
      grid.scaleX = scaleX; grid.scaleY = scaleY; grid.counts.fill(0);
      // Each bucket can hold every part. Registration reserves this fixed
      // capacity, and insertion keeps the original owner-part order.
      for (let i = 0; i < group.length; i++) if (group[i].visible) {
        const b = group[i].boundaryBounds;
        const x0 = Math.max(0, Math.min(BOUNDARY_GRID - 1, Math.floor((b[0] - minX) * scaleX))), x1 = Math.min(BOUNDARY_GRID - 1, Math.floor((b[2] - minX) * scaleX));
        const y0 = Math.max(0, Math.min(BOUNDARY_GRID - 1, Math.floor((b[1] - minY) * scaleY))), y1 = Math.min(BOUNDARY_GRID - 1, Math.floor((b[3] - minY) * scaleY));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const cell = y * BOUNDARY_GRID + x;
          grid.indices[cell * grid.stride + grid.counts[cell]++] = i;
        }
      }
      grid.active = true;
    };
    const boundaryTriangle = (entry, at, sx, sy, endDepth) => {
      const boxes = entry.boundaryBoxes, box = at / 10 * 4;
      if (sx < boxes[box] || sx > boxes[box + 2] || sy < boxes[box + 1] || sy > boxes[box + 3]) return false;
      stats.boundaryTriangles++;
      const v = entry.boundaryTriangles, det = v[at] * sx + v[at + 1] * sy + v[at + 2], span = endDepth - near;
      if (Math.abs(det * span) < 1e-10) return false;
      // Test barycentric numerators before dividing. Almost every union-ray
      // candidate misses, so only a triangle containing the ray needs depth.
      const sign = det < 0 ? -1 : 1, magnitude = det * sign, tolerance = magnitude * 1e-7;
      const u = (v[at + 3] * sx + v[at + 4] * sy + v[at + 5]) * sign;
      if (u < -tolerance || u > magnitude + tolerance) return false;
      const w = (v[at + 6] * sx + v[at + 7] * sy + v[at + 8]) * sign;
      if (w < -tolerance || u + w > magnitude + tolerance) return false;
      const depth = v[at + 9] / det;
      if (depth <= near + span * 1e-5 || depth >= endDepth - span * 1e-5) return false;
      if (entry.clipMinY === -Infinity && entry.worldMinY === -Infinity && entry.worldMaxY === Infinity) return true;
      const ray = entry.boundaryRay, y = ray[1] + (ray[4] * sx + ray[7] * sy + ray[10]) * depth;
      const worldY = cameraY + (cameraView[4] * sx + cameraView[5] * sy - cameraView[6]) * depth;
      return y >= entry.clipMinY && worldY >= entry.worldMinY && worldY <= entry.worldMaxY;
    };
    const entryBoundaryHit = (e, sx, sy, endDepth, side) => {
      stats.boundaryEntries++;
      if (!e.visible) return false;
      const b = e.boundaryBounds, g = e.geometry;
      if (sx < b[0] || sx > b[2] || sy < b[1] || sy > b[3]) return false;
      const nodes = e.boundaryNodes, previous = e.boundaryHits[side];
      if (previous >= 0 && boundaryTriangle(e, previous, sx, sy, endDepth)) return true;
      const grid = e.boundaryGrid;
      if (grid && grid.active) {
        stats.boundaryGridQueries++;
        const size = grid.size, x = Math.min(size - 1, Math.floor((sx - b[0]) * grid.scaleX)), y = Math.min(size - 1, Math.floor((sy - b[1]) * grid.scaleY)), cell = y * size + x;
        for (let n = grid.offsets[cell], end = grid.offsets[cell + 1]; n < end; n++) {
          const triangle = grid.indices[n];
          if (triangle !== previous && boundaryTriangle(e, triangle, sx, sy, endDepth)) { e.boundaryHits[side] = triangle; return true; }
        }
        return false;
      }
      let top = 1; stack[0] = 0;
      while (top) {
        const id = stack[--top], at = id * 4;
        stats.boundaryNodes++;
        if (sx < nodes[at] || sx > nodes[at + 2] || sy < nodes[at + 1] || sy > nodes[at + 3]) continue;
        if (!g.counts[id]) { stack[top++] = g.left[id]; stack[top++] = g.right[id]; continue; }
        // The exact triangle query checks finite depth and every clip plane;
        // a second local-space ray/box query adds no hit information here.
        for (let n = g.starts[id], end = n + g.counts[id]; n < end; n++) {
          const triangle = g.indices[n] * 10;
          if (triangle !== previous && boundaryTriangle(e, triangle, sx, sy, endDepth)) { e.boundaryHits[side] = triangle; return true; }
        }
      }
      return false;
    };
    const ownerHit = (group, sx, sy, endDepth, side) => {
      const previous = group.boundaryEntries[side];
      // Adjacent union rays usually cross the same part. This is only a hint:
      // its current visibility, clipping and triangles are still tested. Each
      // side keeps its own hint so the two offset rays cannot evict each other.
      if (previous && entryBoundaryHit(previous, sx, sy, endDepth, side)) return true;
      const grid = group.boundaryGrid;
      if (grid && grid.active) {
        const b = grid.bounds;
        if (sx < b[0] || sx > b[2] || sy < b[1] || sy > b[3]) return false;
        const x = Math.min(BOUNDARY_GRID - 1, Math.floor((sx - b[0]) * grid.scaleX)), y = Math.min(BOUNDARY_GRID - 1, Math.floor((sy - b[1]) * grid.scaleY)), cell = y * BOUNDARY_GRID + x;
        for (let n = cell * grid.stride, end = n + grid.counts[cell]; n < end; n++) {
          const entry = group[grid.indices[n]];
          if (entry !== previous && entryBoundaryHit(entry, sx, sy, endDepth, side)) { group.boundaryEntries[side] = entry; return true; }
        }
        return false;
      }
      for (let i = 0; i < group.length; i++) {
        const entry = group[i];
        if (entry !== previous && entryBoundaryHit(entry, sx, sy, endDepth, side)) { group.boundaryEntries[side] = entry; return true; }
      }
      return false;
    };
    const ownerBoundaryAt = (owner, x, y, z, dx, dy, dz) => {
      const group = ownerEntries.get(owner);
      if (!hasCamera || !group) return false;
      const m = cameraView, vx = x - cameraX, vy = y - cameraY, vz = z - cameraZ;
      const depth = -(m[2] * vx + m[6] * vy + m[10] * vz);
      if (depth < near || depth > far) return false;
      const rx = m[0] * vx + m[4] * vy + m[8] * vz, ry = m[1] * vx + m[5] * vy + m[9] * vz;
      const dd = -(m[2] * dx + m[6] * dy + m[10] * dz);
      const tx = (m[0] * dx + m[4] * dy + m[8] * dz) * depth - rx * dd, ty = (m[1] * dx + m[5] * dy + m[9] * dz) * depth - ry * dd, length = Math.hypot(tx, ty);
      if (length < 1e-9) return false;
      // Quarter of a pixel in a fixed 1024-wide view (depth * tanX / 2048): sample the projected owner union on
      // both sides, so a limb or pillow contour over another part has two solid sides.
      const epsilon = Math.max(1e-5, depth * tanX / 2048), px = -ty / length * epsilon, py = tx / length * epsilon;
      if (group.boundaryStamp !== collectStamp) {
        let endDepth = near;
        for (let i = 0; i < group.length; i++) {
          const e = group[i];
          if (e.visible) {
            boundaryBounds(e);
            endDepth = Math.max(endDepth, -(m[2] * (e.x - cameraX) + m[6] * (e.y - cameraY) + m[10] * (e.z - cameraZ)) + e.radius + 0.01);
          }
        }
        indexBoundary(group);
        group.boundaryDepth = Math.min(far, endDepth); group.boundaryStamp = collectStamp;
      }
      const endDepth = group.boundaryDepth;
      return endDepth > near && ownerHit(group, (rx + px) / depth, (ry + py) / depth, endDepth, 0)
        !== ownerHit(group, (rx - px) / depth, (ry - py) / depth, endDepth, 1);
    };
    const refresh = () => {
      // Registration boundaries size every reused buffer from actual scene contents; the frame path never grows
      // them or discards visible items.
      const live = new Set(), wanted = new Set();
      const visit = (node) => { if (live.has(node)) return; live.add(node); if (node.geometry) wanted.add(node.geometry); for (const child of node.children) visit(child); };
      for (const node of roots) visit(node);
      for (const cave of crew.cavemen.values()) {
        visit(cave.root);
        if (cave.sleepWeapons) visit(cave.sleepWeapons);
      }
      for (let i = registered.length - 1; i >= 0; i--) if (!live.has(registered[i].node)) { entries.delete(registered[i].node); registered.splice(i, 1); }
      for (const node of seen) if (!live.has(node)) seen.delete(node);
      aliases.clear();
      for (const provider of providers) for (const node of provider.roots) aliases.set(node, provider.owner);
      ownerEntries.clear(); ownerGroups.length = 0;
      for (const provider of providers) groupOf(provider.owner);
      for (const entry of registered) { const group = groupOf(entry.owner); entry.group = group; group.push(entry); }
      for (const cave of crew.cavemen.values()) {
        if (cave.sleepWeapons) registerNode(cave.sleepWeapons, cave.root, characterRoots.get(cave.root));
        registerNode(cave.root, cave.root, characterRoots.get(cave.root));
        wanted.add(cave.headOpen); wanted.add(cave.headClosed);
      }
      for (const node of roots) registerNode(node);
      for (const cave of crew.cavemen.values()) reserveHead(cave);
      for (const geometry of geometries.keys()) if (!wanted.has(geometry)) geometries.delete(geometry);
      stats.geometries = geometries.size; stats.triangles = stats.samples = 0;
      for (const geometry of geometries.values()) { stats.triangles += geometry.triangles.length / 9; stats.samples += geometry.samples.length / 3; }
      resize();
      stats.candidates = stats.occluders = stats.cameraOccluders = stats.nearOwners = 0;
    };
    const dispose = () => {
      registered.length = ownerGroups.length = 0; seen.clear(); entries.clear(); ownerEntries.clear(); aliases.clear(); providerOwners.clear(); geometries.clear(); characterRoots.clear();
      cameraCoverEntry = cameraCoverSource = null; cameraCoverFace = -1;
      cameraPropEntry = cameraPropSource = null; cameraPropFace = cameraPropStamp = -1; cameraPropCount = 0;
      lastActor = lastActorTerrain = ignoredPerceptionOwner = null;
      targetOccluders.fill(null); targetOwnerCache = null; targetStamp = -1; targetCount = 0; activeCamera = null;
      candidates.fill(null); occluders.fill(null); cameraOccluders.fill(null); perceptionOccluders.fill(null); owners.fill(null); nearOwners.fill(null);
      result.count = result.contours = result.nearCount = candidateCount = occluderCount = cameraOccluderCount = perceptionOccluderCount = 0;
      stats.geometries = stats.registered = stats.candidates = stats.occluders = stats.cameraOccluders = stats.triangles = stats.samples = stats.owners = stats.nearOwners = 0;
      stats.boundaryGridBytes = stats.boundaryGridReferences = 0;
    };
    return { collect, clear, perceptionClear, cameraClear, cameraBoundsState, perceived, concealed, distance, inView, getProvider, ownerClear, actorVisible, actorFullyVisible, ownerBoundaryAt, register, refresh, dispose, stats, result };
  };
  BL.objectGuides = { create };
})();
