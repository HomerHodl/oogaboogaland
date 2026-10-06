// Character-attached UI shares one geometric visibility result per frame.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {}, { mat4 } = BL.math, { boundsOf } = BL.scene;
  const UP = { x: 0, y: 1, z: 0 }, VERTICES = 64, FRAGMENTS = 1024, EPS = 1e-10;
  const meshes = new WeakMap(), sourceVertices = new WeakMap();
  const meshOf = (geometry, trackSource = false) => {
    let mesh = meshes.get(geometry);
    if (mesh) return mesh;
    // Cave ownership changes material tags, not triangle topology. Reuse the
    // immutable source bake across visits only when every index array agrees.
    const source = geometry.matrixSourceGeometry;
    if (source && !source.matrixSourceGeometry && source !== geometry && source.verts === geometry.verts && source.faces.length === geometry.faces.length) {
      let same = true;
      for (let i = 0; i < source.faces.length; i++) if (source.faces[i].i !== geometry.faces[i].i) { same = false; break; }
      if (same) {
        mesh = meshOf(source, true);
        const snapshot = sourceVertices.get(source);
        same = !!snapshot && snapshot.length === source.verts.length;
        for (let i = 0; same && i < snapshot.length; i++) if (snapshot[i] !== source.verts[i]) same = false;
        // A source's faces can be replaced between visits. Do not alias an old
        // bake merely because the new wrapper agrees with the new source.
        let at = 0;
        for (let f = 0; same && f < source.faces.length; f++) {
          const indices = source.faces[f].i;
          for (let i = 1; same && i + 1 < indices.length; i++) {
            same = mesh.indices[at++] === indices[0] * 3
              && mesh.indices[at++] === indices[i] * 3 && mesh.indices[at++] === indices[i + 1] * 3;
          }
        }
        if (same && at === mesh.indices.length && mesh.vertices === source.verts) { meshes.set(geometry, mesh); return mesh; }
      }
    }
    const vertices = geometry.verts, nodes = [];
    let count = 0;
    for (const face of geometry.faces) if (face.i.length > 2) count += face.i.length - 2;
    const indices = new Uint32Array(count * 3), boxes = new Float64Array(count * 6), order = new Uint32Array(count);
    let n = 0;
    for (const face of geometry.faces) for (let i = 1; i + 1 < face.i.length; i++) {
      const a = face.i[0] * 3, b = face.i[i] * 3, c = face.i[i + 1] * 3;
      indices[n * 3] = a; indices[n * 3 + 1] = b; indices[n * 3 + 2] = c; order[n] = n;
      for (let axis = 0; axis < 3; axis++) boxes[n * 6 + axis] = Math.min(vertices[a + axis], vertices[b + axis], vertices[c + axis]);
      for (let axis = 0; axis < 3; axis++) boxes[n * 6 + axis + 3] = Math.max(vertices[a + axis], vertices[b + axis], vertices[c + axis]);
      n++;
    }
    const keys = new Float64Array(count * 3), scratch = BL.math.sortScratch(count);
    let ordered = true;
    for (let i = 0; i < count; i++) for (let axis = 0; axis < 3; axis++) { const k = keys[i * 3 + axis] = boxes[i * 6 + axis] + boxes[i * 6 + axis + 3]; if (k !== k) ordered = false; }
    // `sorted` is the axis the range already lies in order on (its parent's, when no key is NaN), where the stable
    // sort would move nothing.
    const build = (from, to, sorted) => {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = from; i < to; i++) {
        const o = order[i] * 6;
        x0 = Math.min(x0, boxes[o]); y0 = Math.min(y0, boxes[o + 1]); z0 = Math.min(z0, boxes[o + 2]);
        x1 = Math.max(x1, boxes[o + 3]); y1 = Math.max(y1, boxes[o + 4]); z1 = Math.max(z1, boxes[o + 5]);
      }
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      box[0] = x0; box[1] = y0; box[2] = z0; box[3] = x1; box[4] = y1; box[5] = z1;
      const index = nodes.length, node = { box, from, to, left: -1, right: -1 }; nodes.push(node);
      if (to - from > 12) {
        let axis = 0;
        if (box[4] - box[1] > box[3] - box[0]) axis = 1;
        if (box[5] - box[2] > box[axis + 3] - box[axis]) axis = 2;
        if (axis !== sorted) BL.math.sortByKey(order, from, to, keys, 3, axis, scratch);
        const middle = (from + to) >>> 1, next = ordered ? axis : -1; node.left = build(from, middle, next); node.right = build(middle, to, next);
      }
      return index;
    };
    if (count) build(0, count, -1);
    mesh = { vertices, indices, order, nodes };
    if (trackSource) sourceVertices.set(geometry, new Float64Array(vertices));
    meshes.set(geometry, mesh); return mesh;
  };
  const create = ({ root, renderer, camera, occluded = null, renderOpts = null }) => {
    let records = new WeakMap(), memo = new WeakMap();
    const active = [], candidates = [], view = mat4.create(), nextView = mat4.create(), stack = new Int32Array(64);
    const clipA = new Float64Array(VERTICES * 4), clipB = new Float64Array(VERTICES * 4), projected = new Float64Array(VERTICES * 2);
    const insideA = new Float64Array(VERTICES * 2), insideB = new Float64Array(VERTICES * 2), outside = new Float64Array(VERTICES * 2);
    const fragments = new Float64Array(FRAGMENTS * VERTICES * 2), counts = new Uint8Array(FRAGMENTS);
    let frame = 0, viewVersion = 0, candidateCount = 0, prepared = false, width = 1, height = 1, tanX = 1, tanY = 1, invTanX = 1, invTanY = 1, sideX = 1, sideY = 1, near = 0.1, far = 1000;
    let orthoMix = 0, perspective = 1, projectionOffset = 0;
    const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
    const projectionDepth = depth => perspective * depth + projectionOffset;
    let planeA = 0, planeB = 0, planeC = 0, witnessX = 0, witnessY = 0, hitEntry = null, hitTriangle = 0, hitDepth = 0;
    let hitX = 0, hitY = 0, hitZ = 0;
    const retained = (geometry, x, y, z) => {
      if (!renderOpts || geometry.cutawayPreserve) return true;
      if (y > (renderOpts.cutawayMaxY ?? Infinity)) return false;
      const regions = renderOpts.cutawayRegions, count = Math.min(8, renderOpts.cutawayRegionCount || 0);
      for (let i = 0; i < count; i++) {
        const r = regions[i], dx = x - r.x, dz = z - r.z;
        if (y > r.y && Math.abs(dx * r.cos - dz * r.sin) < r.halfWidth && Math.abs(dx * r.sin + dz * r.cos) < r.halfDepth) return false;
      }
      return true;
    };
    const belongs = (node, owner) => {
      for (let parent = node; parent; parent = parent.parent) if (parent === owner) return true;
      return false;
    };
    const present = (node) => {
      for (let parent = node; parent; parent = parent.parent) {
        if (!parent.visible || parent.cameraHidden) return false;
        if (parent === root) return true;
      }
      return false;
    };
    const add = (node, world, offset = 0, instance = -1) => {
      let list = records.get(node);
      if (!list) { list = []; records.set(node, list); }
      const index = instance + 1;
      let entry = list[index];
      if (!entry) { entry = { node, inverse: mat4.create(), camera: mat4.create(), world: mat4.create(), bounds: null, geometry: null, instanceData: null, instanceVersion: -1, frame: -1, viewVersion: -1, minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity, minDepth: 0, inFrustum: false, orientation: 1, radius: 0, x: 0, y: 0, z: 0, inverseDirty: true, projectionDirty: true, localMinY: -Infinity }; list[index] = entry; }
      const geometry = node.geometry, w = entry.world;
      const cloudOffset = node.matrixCloud && renderOpts ? Math.min(0, (renderOpts.cutawayCloudY || 0) - world[offset + 13]) * (renderOpts.cutawayCloudMix || 0) : 0;
      let changed = entry.geometry !== geometry || entry.cloudOffset !== cloudOffset;
      // Instanced batches publish the same version used by GPU uploads. An
      // unchanged batch needs no repeated matrix comparison for each banana.
      const batchUnchanged = instance >= 0 && node.instanceVersion !== undefined && entry.instanceData === world && entry.instanceVersion === node.instanceVersion;
      if (!batchUnchanged) for (let i = 0; !changed && i < 16; i++) changed = w[i] !== (i === 13 && cloudOffset ? Math.fround(world[offset + i] + cloudOffset) : world[offset + i]);
      if (instance >= 0) { entry.instanceData = world; entry.instanceVersion = node.instanceVersion; }
      if (changed) {
        for (let i = 0; i < 16; i++) w[i] = world[offset + i];
        w[13] += cloudOffset; entry.cloudOffset = cloudOffset;
        entry.geometry = geometry; entry.bounds = boundsOf(geometry); entry.inverseDirty = true;
        const determinant = w[0] * (w[5] * w[10] - w[6] * w[9]) - w[4] * (w[1] * w[10] - w[2] * w[9]) + w[8] * (w[1] * w[6] - w[2] * w[5]);
        entry.orientation = Math.abs(determinant) < 1e-12 ? 0 : Math.sign(determinant);
        entry.radius = entry.bounds.radius * Math.hypot(w[0], w[1], w[2], w[4], w[5], w[6], w[8], w[9], w[10]);
        const b = entry.bounds.center;
        entry.x = w[0] * b[0] + w[4] * b[1] + w[8] * b[2] + w[12];
        entry.y = w[1] * b[0] + w[5] * b[1] + w[9] * b[2] + w[13];
        entry.z = w[2] * b[0] + w[6] * b[1] + w[10] * b[2] + w[14];
      }
      if (!entry.orientation) return;
      const bounds = entry.bounds;
      if (changed || entry.viewVersion !== viewVersion) {
        const wx = entry.x, wy = entry.y, wz = entry.z;
        const x = view[0] * wx + view[4] * wy + view[8] * wz + view[12];
        const y = view[1] * wx + view[5] * wy + view[9] * wz + view[13];
        const z = -(view[2] * wx + view[6] * wy + view[10] * wz + view[14]);
        // The transform's Frobenius norm encloses shear as well as scaling.
        // This loose sphere rejects unrelated scenery before the full camera
        // transform and exact eight-corner projection are needed.
        const radius = entry.radius + 1e-6 * Math.max(1, Math.abs(x), Math.abs(y), Math.abs(z));
        const span = projectionDepth(z);
        entry.inFrustum = !(z + radius < near || z - radius > far || Math.abs(x) > span * tanX + radius * sideX || Math.abs(y) > span * tanY + radius * sideY);
        if (entry.inFrustum) {
          const front = z - radius, back = z + radius, invFront = 1 / projectionDepth(front), invBack = 1 / projectionDepth(back);
          entry.minX = front > near ? Math.min((x - radius) * invFront, (x - radius) * invBack) * invTanX : -Infinity;
          entry.maxX = front > near ? Math.max((x + radius) * invFront, (x + radius) * invBack) * invTanX : Infinity;
          entry.minY = front > near ? Math.min((y - radius) * invFront, (y - radius) * invBack) * invTanY : -Infinity;
          entry.maxY = front > near ? Math.max((y + radius) * invFront, (y + radius) * invBack) * invTanY : Infinity;
          entry.minDepth = front;
        }
        entry.projectionDirty = true;
        entry.viewVersion = viewVersion;
      }
      if (!entry.inFrustum) return;
      entry.frame = frame;
      entry.localMinY = node.mirror ? bounds.min[1] + (bounds.max[1] - bounds.min[1]) * Math.max(0, Math.min(1, node.mirrorReveal || 0)) : -Infinity;
      active.push(entry);
    };
    const projectEntry = (entry) => {
      if (!entry.projectionDirty) return;
      entry.projectionDirty = false;
      mat4.multiply(entry.camera, view, entry.world);
      const m = entry.camera, bounds = entry.bounds;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minDepth = Infinity;
      for (let i = 0; i < 8; i++) {
        const bx = i & 1 ? bounds.max[0] : bounds.min[0], by = i & 2 ? bounds.max[1] : bounds.min[1], bz = i & 4 ? bounds.max[2] : bounds.min[2];
        const depth = -(m[2] * bx + m[6] * by + m[10] * bz + m[14]);
        minDepth = Math.min(minDepth, depth);
        if (depth <= near) continue;
        const span = projectionDepth(depth);
        const px = (m[0] * bx + m[4] * by + m[8] * bz + m[12]) / (span * tanX), py = (m[1] * bx + m[5] * by + m[9] * bz + m[13]) / (span * tanY);
        minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
      }
      // Perspective extrema lie at box corners only when the whole box is
      // in front of the near plane. Straddlers keep the full exact query.
      // Allow Float32 transform rounding before the exact local ray test.
      const margin = 1e-6 * Math.max(1, Math.abs(minX), Math.abs(minY), Math.abs(maxX), Math.abs(maxY));
      entry.minX = minDepth > near ? minX - margin : -Infinity; entry.minY = minDepth > near ? minY - margin : -Infinity;
      entry.maxX = minDepth > near ? maxX + margin : Infinity; entry.maxY = minDepth > near ? maxY + margin : Infinity;
      entry.minDepth = minDepth - 1e-6 * Math.max(1, Math.abs(minDepth));
    };
    const visit = (node) => {
      if (!node.visible || node.cameraHidden) return;
      const geometry = node.geometry;
      // Smoke and phase fields are translucent; their effects do not cover UI.
      if (geometry && geometry.faces && geometry.faces.length && !geometry.matrixGlyph
        && !geometry.mirrorRippleOnly && !node.mirrorRippleOnly && !node.mirrorPortal
        && !(node.smokeOpacity < 1) && !(renderOpts?.birdsEyeCutaway && geometry.cutawayHide)) {
        if (node.instanceData) {
          const data = node.instanceData, count = node.drawInstanceCount === undefined ? node.instanceCount : Math.min(node.instanceCount, node.drawInstanceCount);
          for (let i = 0; i < count; i++) if (data[i * 20 + 18] >= -1) add(node, data, i * 20, i);
        } else add(node, node.world);
      }
      for (const child of node.children) visit(child);
    };
    const prepare = () => {
      if (prepared) return;
      prepared = true; active.length = 0;
      const size = renderer.size, tangent = Math.tan(camera.fov / 2);
      const mix = camera.orthoHeight > 0 ? Math.max(0, Math.min(1, camera.orthoMix || 0)) : 0;
      const offset = mat4.projectionDepth(0, camera.fov, mix, camera.orthoHeight || 0);
      let changed = width !== size.width || height !== size.height || near !== camera.near || far !== camera.far || tanY !== tangent || orthoMix !== mix || projectionOffset !== offset;
      mat4.lookAt(nextView, camera.position, camera.target, camera.up || UP);
      for (let i = 0; !changed && i < 16; i++) changed = view[i] !== nextView[i];
      if (changed) {
        width = size.width; height = size.height; near = camera.near; far = camera.far;
        orthoMix = mix; perspective = 1 - mix; projectionOffset = offset;
        tanY = tangent; tanX = tanY * width / height; invTanX = 1 / tanX; invTanY = 1 / tanY;
        sideX = Math.hypot(1, perspective * tanX); sideY = Math.hypot(1, perspective * tanY);
        view.set(nextView); viewVersion++;
      }
      visit(root);
    };
    const rayBox = (box, x, y, z, dx, dy, dz, limit, min = box.min, max = box.max) => {
      let low = near, high = limit;
      for (let axis = 0; axis < 3; axis++) {
        const p = axis === 0 ? x : axis === 1 ? y : z, d = axis === 0 ? dx : axis === 1 ? dy : dz;
        const a = min ? min[axis] : box[axis], b = max ? max[axis] : box[axis + 3];
        if (Math.abs(d) < 1e-15) { if (p < a || p > b) return false; }
        else { const u = (a - p) / d, v = (b - p) / d; low = Math.max(low, Math.min(u, v)); high = Math.min(high, Math.max(u, v)); if (high < low) return false; }
      }
      return true;
    };
    const nearest = (sx, sy, depth, owner) => {
      let dx, dy, dz;
      if (orthoMix) {
        mat4.rayFromView(ray, view, width, height, camera.fov, camera.position, (sx + 1) * width / 2, (1 - sy) * height / 2, orthoMix, camera.orthoHeight);
        // BVH distances use camera depth, while the shared picking ray is unit
        // length. Its shifted origin remains on the camera's zero-depth plane.
        const scale = -1 / (view[2] * ray.dx + view[6] * ray.dy + view[10] * ray.dz);
        dx = ray.dx * scale; dy = ray.dy * scale; dz = ray.dz * scale;
      } else {
        const vx = sx * tanX, vy = sy * tanY;
        dx = view[0] * vx + view[1] * vy - view[2]; dy = view[4] * vx + view[5] * vy - view[6]; dz = view[8] * vx + view[9] * vy - view[10];
        ray.ox = camera.position.x; ray.oy = camera.position.y; ray.oz = camera.position.z;
      }
      hitEntry = null; hitDepth = depth - Math.max(1e-6, depth * 1e-7);
      for (let candidate = 0; candidate < candidateCount; candidate++) {
        const entry = candidates[candidate];
        if (sx < entry.minX || sx > entry.maxX || sy < entry.minY || sy > entry.maxY || entry.minDepth >= hitDepth) continue;
        if (entry.inverseDirty) { mat4.invert(entry.inverse, entry.world); entry.inverseDirty = false; }
        const m = entry.inverse;
        const x = m[0] * ray.ox + m[4] * ray.oy + m[8] * ray.oz + m[12], y = m[1] * ray.ox + m[5] * ray.oy + m[9] * ray.oz + m[13], z = m[2] * ray.ox + m[6] * ray.oy + m[10] * ray.oz + m[14];
        const ux = m[0] * dx + m[4] * dy + m[8] * dz, uy = m[1] * dx + m[5] * dy + m[9] * dz, uz = m[2] * dx + m[6] * dy + m[10] * dz;
        if (!rayBox(entry.bounds, x, y, z, ux, uy, uz, hitDepth)) continue;
        const mesh = meshOf(entry.geometry), v = mesh.vertices, indices = mesh.indices;
        let top = mesh.nodes.length ? 1 : 0; stack[0] = 0;
        while (top) {
          const node = mesh.nodes[stack[--top]];
          if (!rayBox(node.box, x, y, z, ux, uy, uz, hitDepth)) continue;
          if (node.left >= 0) { stack[top++] = node.left; stack[top++] = node.right; continue; }
          for (let i = node.from; i < node.to; i++) {
            const at = mesh.order[i] * 3, a = indices[at], b = indices[at + 1], c = indices[at + 2];
            const abx = v[b] - v[a], aby = v[b + 1] - v[a + 1], abz = v[b + 2] - v[a + 2], acx = v[c] - v[a], acy = v[c + 1] - v[a + 1], acz = v[c + 2] - v[a + 2];
            const px = uy * acz - uz * acy, py = uz * acx - ux * acz, pz = ux * acy - uy * acx, determinant = abx * px + aby * py + abz * pz;
            if (determinant * entry.orientation <= 1e-12) continue;
            const tx = x - v[a], ty = y - v[a + 1], tz = z - v[a + 2], beta = (tx * px + ty * py + tz * pz) / determinant;
            if (beta < -EPS || beta > 1 + EPS) continue;
            const qx = ty * abz - tz * aby, qy = tz * abx - tx * abz, qz = tx * aby - ty * abx, gamma = (ux * qx + uy * qy + uz * qz) / determinant;
            if (gamma < -EPS || beta + gamma > 1 + EPS) continue;
            const t = (acx * qx + acy * qy + acz * qz) / determinant, worldY = ray.oy + dy * t;
            if (t <= near || t >= hitDepth || y + uy * t < entry.localMinY || worldY < (entry.geometry.clipMinY ?? -Infinity) || worldY > (entry.geometry.clipMaxY ?? Infinity)) continue;
            const worldX = ray.ox + dx * t, worldZ = ray.oz + dz * t;
            if (!retained(entry.geometry, worldX, worldY, worldZ)) continue;
            hitEntry = entry; hitTriangle = at; hitDepth = t;
            hitX = worldX; hitY = worldY; hitZ = worldZ;
          }
        }
      }
      return hitEntry !== null;
    };
    const clip = (src, count, dst, stride, a, b, c, d = 0, constant = 0) => {
      let written = 0, previous = (count - 1) * stride;
      for (let i = 0; i < count; i++) {
        const at = i * stride, av = a * src[previous] + b * src[previous + 1] + (stride === 4 ? c * src[previous + 2] + d * src[previous + 3] + constant : c);
        const bv = a * src[at] + b * src[at + 1] + (stride === 4 ? c * src[at + 2] + d * src[at + 3] + constant : c);
        if ((av >= 0) !== (bv >= 0)) {
          const t = av / (av - bv);
          for (let axis = 0; axis < stride; axis++) dst[written * stride + axis] = src[previous + axis] + (src[at + axis] - src[previous + axis]) * t;
          written++;
        }
        if (bv >= 0) { for (let axis = 0; axis < stride; axis++) dst[written * stride + axis] = src[at + axis]; written++; }
        previous = at;
      }
      return written;
    };
    const projectTriangle = (entry, a, b, c, blocker = false) => {
      const m = entry.camera, v = entry.geometry.verts;
      for (let i = 0; i < 3; i++) {
        const at = i === 0 ? a : i === 1 ? b : c, o = i * 4, x = v[at], y = v[at + 1], z = v[at + 2];
        clipA[o] = m[0] * x + m[4] * y + m[8] * z + m[12]; clipA[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        clipA[o + 2] = -(m[2] * x + m[6] * y + m[10] * z + m[14]); clipA[o + 3] = y;
      }
      const ax = clipA[4] - clipA[0], ay = clipA[5] - clipA[1], az = clipA[6] - clipA[2], bx = clipA[8] - clipA[0], by = clipA[9] - clipA[1], bz = clipA[10] - clipA[2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, plane = nx * clipA[0] + ny * clipA[1] + nz * clipA[2];
      const denominator = perspective * plane + projectionOffset * nz;
      if (denominator <= 1e-12) return 0;
      // (1 - mix * depth) / projectedDepth is affine over a screen-space
      // triangle and decreases with depth in both camera modes. At mix zero
      // this is the original inverse-depth plane used by polygon subtraction.
      const gain = perspective + orthoMix * projectionOffset;
      planeA = gain * nx * tanX / denominator; planeB = gain * ny * tanY / denominator; planeC = (nz - orthoMix * plane) / denominator;
      let src = clipA, dst = clipB, count = 3;
      for (let side = 0; side < 9 && count >= 3; side++) {
        let a = 0, b = 0, c = 0, d = 0, constant = 0;
        if (side === 0) { c = 1; constant = -near; }
        else if (side === 1) { c = -1; constant = far; }
        else if (side < 4) { a = side === 2 ? 1 : -1; c = perspective * tanX; constant = projectionOffset * tanX; }
        else if (side < 6) { b = side === 4 ? 1 : -1; c = perspective * tanY; constant = projectionOffset * tanY; }
        else if (side === 6) { if (entry.localMinY === -Infinity) continue; d = 1; constant = -entry.localMinY; }
        else {
          const cut = !entry.geometry.cutawayPreserve && renderOpts?.cutawayMaxY < 1e6 ? renderOpts.cutawayMaxY : Infinity;
          const bound = side === 7 ? entry.geometry.clipMinY : Math.min(entry.geometry.clipMaxY ?? Infinity, cut);
          if (!Number.isFinite(bound)) continue;
          const sign = side === 7 ? 1 : -1;
          a = view[4] * sign; b = view[5] * sign; c = -view[6] * sign; constant = (camera.position.y - bound) * sign;
        }
        count = clip(src, count, dst, 4, a, b, c, d, constant); const swap = src; src = dst; dst = swap;
      }
      if (blocker && renderOpts && !entry.geometry.cutawayPreserve) for (let i = 0; i < Math.min(8, renderOpts.cutawayRegionCount || 0) && count >= 3; i++) {
        const r = renderOpts.cutawayRegions[i], dx = hitX - r.x, dz = hitZ - r.z;
        const u = dx * r.cos - dz * r.sin, v = dx * r.sin + dz * r.cos;
        let nx = 0, ny = 0, nz = 0, offset = 0;
        if (hitY <= r.y) { ny = -1; offset = r.y; }
        else if (u >= r.halfWidth) { nx = r.cos; nz = -r.sin; offset = -r.halfWidth - nx * r.x - nz * r.z; }
        else if (u <= -r.halfWidth) { nx = -r.cos; nz = r.sin; offset = -r.halfWidth - nx * r.x - nz * r.z; }
        else if (v >= r.halfDepth) { nx = r.sin; nz = r.cos; offset = -r.halfDepth - nx * r.x - nz * r.z; }
        else { nx = -r.sin; nz = -r.cos; offset = -r.halfDepth - nx * r.x - nz * r.z; }
        // Subtract only the retained convex piece containing this witness.
        // Other pieces get their own rays; a roof's cut-out can never be
        // accidentally covered by subtracting its original whole triangle.
        count = clip(src, count, dst, 4, nx * view[0] + ny * view[4] + nz * view[8], nx * view[1] + ny * view[5] + nz * view[9],
          -nx * view[2] - ny * view[6] - nz * view[10], 0, offset + nx * camera.position.x + ny * camera.position.y + nz * camera.position.z);
        const swap = src; src = dst; dst = swap;
      }
      for (let i = 0; i < count; i++) { const depth = projectionDepth(src[i * 4 + 2]); projected[i * 2] = src[i * 4] / (depth * tanX); projected[i * 2 + 1] = src[i * 4 + 1] / (depth * tanY); }
      return count;
    };
    const area = (p, count) => {
      let sum = 0;
      for (let i = 1; i + 1 < count; i++) sum += (p[i * 2] - p[0]) * (p[i * 2 + 3] - p[1]) - (p[i * 2 + 1] - p[1]) * (p[i * 2 + 2] - p[0]);
      return Math.abs(sum);
    };
    const exposed = (count, owner) => {
      const targetA = planeA, targetB = planeB, targetC = planeC;
      let top = 1; counts[0] = count;
      for (let i = 0; i < count * 2; i++) fragments[i] = projected[i];
      while (top) {
        count = counts[--top]; const offset = top * VERTICES * 2;
        let x = 0, y = 0;
        for (let i = 0; i < count; i++) { x += insideA[i * 2] = fragments[offset + i * 2]; y += insideA[i * 2 + 1] = fragments[offset + i * 2 + 1]; }
        const originalArea = area(insideA, count);
        if (count < 3 || originalArea < 1e-14) continue;
        x /= count; y /= count;
        const metric = targetA * x + targetB * y + targetC, depth = (1 - projectionOffset * metric) / (perspective * metric + orthoMix);
        if (!nearest(x, y, depth, owner)) { witnessX = x; witnessY = y; return true; }
        const mesh = meshOf(hitEntry.geometry), indices = mesh.indices;
        const covered = projectTriangle(hitEntry, indices[hitTriangle], indices[hitTriangle + 1], indices[hitTriangle + 2], true);
        if (covered < 3) { witnessX = x; witnessY = y; return true; }
        let src = insideA, dst = insideB, remainingArea = 0;
        // Subtract the blocker only where its plane lies in front of this
        // surface. Every outside fragment remains eligible, however narrow.
        for (let edge = 0; edge <= covered && count >= 3; edge++) {
          if (count >= VERTICES - 1) { witnessX = x; witnessY = y; return true; }
          const j = edge * 2, k = ((edge + 1) % covered) * 2;
          const a = edge === covered ? planeA - targetA : projected[j + 1] - projected[k + 1];
          const b = edge === covered ? planeB - targetB : projected[k] - projected[j];
          const c = edge === covered ? planeC - targetC : -a * projected[j] - b * projected[j + 1];
          const n = clip(src, count, outside, 2, -a, -b, -c);
          if (n >= 3 && area(outside, n) >= 1e-14) {
            remainingArea += area(outside, n);
            // Keep uncertainty visible if pathological geometry exhausts the
            // fixed scratch budget; it must never erase a visible sliver.
            if (top >= FRAGMENTS || n >= VERTICES - 1) { witnessX = x; witnessY = y; return true; }
            counts[top] = n;
            for (let i = 0; i < n * 2; i++) fragments[top * VERTICES * 2 + i] = outside[i];
            top++;
          }
          count = clip(src, count, dst, 2, a, b, c); const swap = src; src = dst; dst = swap;
        }
        // A ray grazing a seam can be inside by rounding while the polygon
        // remains outside. Do not revisit an unchanged fragment indefinitely.
        if (remainingArea >= originalArea * (1 - 1e-12)) { witnessX = x; witnessY = y; return true; }
      }
      return false;
    };
    const visiblePart = (node, owner) => {
      if (!node.visible || node.cameraHidden) return false;
      const entry = records.get(node)?.[0], geometry = node.geometry;
      if (entry && entry.frame === frame && geometry) for (const face of geometry.faces) for (let i = 1; i + 1 < face.i.length; i++) {
        const count = projectTriangle(entry, face.i[0] * 3, face.i[i] * 3, face.i[i + 1] * 3);
        if (count >= 3 && area(projected, count) >= 1e-14 && exposed(count, owner)) return true;
      }
      for (const child of node.children) if (visiblePart(child, owner)) return true;
      return false;
    };
    let headMinX = Infinity, headMaxX = -Infinity, headTop = Infinity;
    const projectHead = (node) => {
      if (!node.visible || node.cameraHidden) return;
      const entry = records.get(node)?.[0];
      if (entry && entry.frame === frame) {
        const b = entry.bounds, m = entry.camera;
        for (let i = 0; i < 8; i++) {
          const x = i & 1 ? b.max[0] : b.min[0], y = i & 2 ? b.max[1] : b.min[1], z = i & 4 ? b.max[2] : b.min[2];
          const depth = -(m[2] * x + m[6] * y + m[10] * z + m[14]);
          if (depth < near) continue;
          const span = projectionDepth(depth);
          const px = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / (span * tanX) + 1) * width / 2;
          headMinX = Math.min(headMinX, px); headMaxX = Math.max(headMaxX, px);
          headTop = Math.min(headTop, (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / (span * tanY)) * height / 2);
        }
      }
      for (const child of node.children) projectHead(child);
    };
    let actorMinX = Infinity, actorMinY = Infinity, actorMaxX = -Infinity, actorMaxY = -Infinity;
    const boundActor = (node) => {
      if (!node.visible || node.cameraHidden) return;
      const entry = records.get(node)?.[0];
      if (entry && entry.frame === frame) {
        projectEntry(entry);
        actorMinX = Math.min(actorMinX, entry.minX); actorMinY = Math.min(actorMinY, entry.minY);
        actorMaxX = Math.max(actorMaxX, entry.maxX); actorMaxY = Math.max(actorMaxY, entry.maxY);
      }
      for (const child of node.children) boundActor(child);
    };
    const selectCandidates = (owner) => {
      actorMinX = actorMinY = Infinity; actorMaxX = actorMaxY = -Infinity;
      boundActor(owner);
      const previous = candidateCount; candidateCount = 0;
      // One conservative character bound excludes unrelated scenery before
      // thousands of exact witness rays, preserving the active entry order.
      for (const entry of active) {
        if (entry.maxX < actorMinX || entry.minX > actorMaxX || entry.maxY < actorMinY || entry.minY > actorMaxY || belongs(entry.node, owner)) continue;
        projectEntry(entry);
        if (entry.maxX >= actorMinX && entry.minX <= actorMaxX && entry.maxY >= actorMinY && entry.minY <= actorMaxY) candidates[candidateCount++] = entry;
      }
      for (let i = candidateCount; i < previous; i++) candidates[i] = null;
    };
    const query = (cave) => {
      let result = memo.get(cave);
      if (!result) { result = { frame: -1, visible: false, x: 0, y: 0 }; memo.set(cave, result); }
      if (result.frame === frame) return result;
      result.frame = frame; result.visible = false;
      if (!present(cave.root) || occluded && occluded(cave)) return result;
      prepare();
      selectCandidates(cave.root);
      if (!visiblePart(cave.root, cave.root)) return result;
      result.visible = true; result.x = (witnessX + 1) * width / 2; result.y = (1 - witnessY) * height / 2;
      const head = cave.parts.head;
      if (present(head)) {
        headMinX = Infinity; headMaxX = -Infinity; headTop = Infinity;
        projectHead(head);
        if (headTop !== Infinity) { result.x = (headMinX + headMaxX) / 2; result.y = headTop; }
      }
      result.x = Math.max(0, Math.min(width, result.x)); result.y = Math.max(0, Math.min(height, result.y));
      return result;
    };
    // Warm small meshes within the idle budget. A large synchronous BVH build
    // cannot be interrupted, so leave it to the exact on-demand path rather than
    // starting seconds of work in an idle callback between scene frames.
    let warming = 0, msPerTriangle = 0.01;
    const warm = () => {
      if (warming || typeof requestIdleCallback === "undefined") return;
      const pending = [];
      const collect = (node) => {
        const geometry = node.geometry;
        if (geometry && geometry.faces && geometry.faces.length && !geometry.matrixGlyph
          && !geometry.mirrorRippleOnly && !node.mirrorRippleOnly && !node.mirrorPortal && !meshes.has(geometry)) pending.push(geometry);
        for (const child of node.children) collect(child);
      };
      collect(root);
      const slice = (deadline) => {
        warming = 0;
        while (pending.length) {
          const geometry = pending[pending.length - 1];
          if (meshes.has(geometry)) { pending.pop(); continue; }
          let triangles = 0;
          for (const face of geometry.faces) if (face.i.length > 2) triangles += face.i.length - 2;
          const estimated = triangles * msPerTriangle + 1;
          if (estimated > 8) { pending.pop(); continue; }
          if (estimated > deadline.timeRemaining()) break;
          const start = performance.now();
          meshOf(geometry);
          pending.pop();
          if (triangles) { const rate = (performance.now() - start) / triangles; msPerTriangle = msPerTriangle ? msPerTriangle * 0.8 + rate * 0.2 : rate; }
        }
        if (pending.length) warming = requestIdleCallback(slice);
      };
      warming = requestIdleCallback(slice);
    };
    return {
      warm,
      begin: () => { frame++; prepared = false; },
      visible: (cave) => query(cave).visible,
      anchor: (cave, out) => { const result = query(cave); if (!result.visible) return false; out.x = result.x; out.y = result.y; return true; },
      dispose: () => { if (warming) cancelIdleCallback(warming); warming = 0; active.length = candidates.length = candidateCount = 0; records = new WeakMap(); memo = new WeakMap(); hitEntry = null; }
    };
  };
  BL.characterVisibility = { create };
})();
