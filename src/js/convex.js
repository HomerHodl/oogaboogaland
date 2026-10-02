(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  // GJK vs the convex hull of vertical cylinders at both sweep ends; shared module scratch, so non-reentrant.
  const simplex = new Float64Array(12);
  const CONTACT = 1e-7, POINT_CONTACT = 1e-9, TOLERANCE = 1e-12;
  let fromX, fromY, fromZ, endX, endY, endZ, bodyRadius, bodyHeight, endRadius, endHeight;
  let centerX, centerY, centerZ, scale, size, dx, dy, dz, px, py, pz;
  let closest2, closestX, closestY, closestZ, closestMask;
  const support = (vertices) => {
    let best = -Infinity, at = 0;
    for (let i = 0; i < vertices.length; i += 3) {
      const dot = vertices[i] * dx + vertices[i + 1] * dy + vertices[i + 2] * dz;
      if (dot > best) { best = dot; at = i; }
    }
    const horizontal = Math.hypot(dx, dz);
    // Animated body slices can change size as they turn. Include each end's
    // dimensions in the support choice instead of inflating the whole sweep.
    const last = (endX - fromX) * dx + (endY - fromY) * dy + (endZ - fromZ) * dz
      - (endRadius - bodyRadius) * horizontal + (dy < 0 ? (endHeight - bodyHeight) * dy : 0) < 0;
    const radius = horizontal ? (last ? endRadius : bodyRadius) / horizontal : 0;
    px = centerX + (vertices[at] - centerX) * scale - (last ? endX : fromX) + dx * radius;
    py = centerY + (vertices[at + 1] - centerY) * scale - (last ? endY : fromY) - (dy < 0 ? last ? endHeight : bodyHeight : 0);
    pz = centerZ + (vertices[at + 2] - centerZ) * scale - (last ? endZ : fromZ) + dz * radius;
  };
  const consider = (x, y, z, mask) => {
    const distance = x * x + y * y + z * z;
    if (distance >= closest2) return;
    closest2 = distance; closestX = x; closestY = y; closestZ = z; closestMask = mask;
  };
  const closest = () => {
    // Search every Voronoi region, old vertices included: keeping only the newest support's can cycle on a graze.
    if (size === 4) {
      const ax = simplex[0], ay = simplex[1], az = simplex[2];
      const bx = simplex[3] - ax, by = simplex[4] - ay, bz = simplex[5] - az;
      const cx = simplex[6] - ax, cy = simplex[7] - ay, cz = simplex[8] - az;
      const ex = simplex[9] - ax, ey = simplex[10] - ay, ez = simplex[11] - az;
      const nx = cy * ez - cz * ey, ny = cz * ex - cx * ez, nz = cx * ey - cy * ex;
      const determinant = bx * nx + by * ny + bz * nz;
      if (determinant) {
        const b = -(ax * nx + ay * ny + az * nz) / determinant;
        const c = (bx * (az * ey - ay * ez) + by * (ax * ez - az * ex) + bz * (ay * ex - ax * ey)) / determinant;
        const d = (bx * (ay * cz - az * cy) + by * (az * cx - ax * cz) + bz * (ax * cy - ay * cx)) / determinant;
        if (b >= 0 && c >= 0 && d >= 0 && b + c + d <= 1) return true;
      }
    }
    closest2 = Infinity; closestMask = 0;
    for (let a = 0; a < size; a++) {
      const at = a * 3, ax = simplex[at], ay = simplex[at + 1], az = simplex[at + 2];
      consider(ax, ay, az, 1 << a);
      for (let b = a + 1; b < size; b++) {
        const bt = b * 3, bx = simplex[bt] - ax, by = simplex[bt + 1] - ay, bz = simplex[bt + 2] - az;
        const length2 = bx * bx + by * by + bz * bz;
        if (length2) {
          const t = -(ax * bx + ay * by + az * bz) / length2;
          if (t > 0 && t < 1) consider(ax + bx * t, ay + by * t, az + bz * t, (1 << a) | (1 << b));
        }
        for (let c = b + 1; c < size; c++) {
          const ct = c * 3, cx = simplex[ct] - ax, cy = simplex[ct + 1] - ay, cz = simplex[ct + 2] - az;
          const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx, normal2 = nx * nx + ny * ny + nz * nz;
          if (!normal2) continue;
          const plane = (ax * nx + ay * ny + az * nz) / normal2, x = nx * plane, y = ny * plane, z = nz * plane;
          const qx = x - ax, qy = y - ay, qz = z - az;
          const u = ((qy * cz - qz * cy) * nx + (qz * cx - qx * cz) * ny + (qx * cy - qy * cx) * nz) / normal2;
          const v = ((by * qz - bz * qy) * nx + (bz * qx - bx * qz) * ny + (bx * qy - by * qx) * nz) / normal2;
          if (u >= 0 && v >= 0 && u + v <= 1) consider(x, y, z, (1 << a) | (1 << b) | (1 << c));
        }
      }
    }
    let count = 0;
    for (let i = 0; i < size; i++) if (closestMask & (1 << i)) {
      simplex[count * 3] = simplex[i * 3]; simplex[count * 3 + 1] = simplex[i * 3 + 1]; simplex[count * 3 + 2] = simplex[i * 3 + 2]; count++;
    }
    size = count;
    // A distance vector, not a cross product whose magnitude vanishes when supports converge on a rounded edge.
    dx = -closestX; dy = -closestY; dz = -closestZ;
    return false;
  };
  const stationaryA = new Float64Array(15), stationaryB = new Float64Array(15);
  const clipStationary = (from, count, to, plane, direction) => {
    let written = 0, previous = (count - 1) * 3;
    for (let i = 0; i < count; i++) {
      const at = i * 3, a = (from[previous + 1] - plane) * direction, b = (from[at + 1] - plane) * direction;
      if (a < 0 && b > 0 || a > 0 && b < 0) {
        const k = a / (a - b), out = written++ * 3;
        to[out] = from[previous] + (from[at] - from[previous]) * k;
        to[out + 1] = plane;
        to[out + 2] = from[previous + 2] + (from[at + 2] - from[previous + 2]) * k;
      }
      if (b >= 0) {
        const out = written++ * 3;
        to[out] = from[at]; to[out + 1] = from[at + 1]; to[out + 2] = from[at + 2];
      }
      previous = at;
    }
    return written;
  };
  const stationarySeparated = (piece, x, y, z, radius, height) => {
    // A stationary cylinder misses a triangle if the triangle's height-clipped
    // projection misses its circle. Expand both boundaries beyond GJK's contact
    // margin: uncertain edges and actual contacts still use the exact simplex.
    let count = clipStationary(piece, 3, stationaryA, y - CONTACT, 1);
    if (!count) return true;
    count = clipStationary(stationaryA, count, stationaryB, y + height + CONTACT, -1);
    if (!count) return true;
    const reach2 = (radius + CONTACT) ** 2;
    let positive = false, negative = false, previous = (count - 1) * 3;
    for (let i = 0; i < count; i++) {
      const at = i * 3, ax = stationaryB[previous] - x, az = stationaryB[previous + 2] - z;
      const bx = stationaryB[at] - x, bz = stationaryB[at + 2] - z;
      const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
      const k = length2 ? Math.max(0, Math.min(1, -(ax * dx + az * dz) / length2)) : 0;
      if ((ax + dx * k) ** 2 + (az + dz * k) ** 2 <= reach2) return false;
      const cross = ax * bz - az * bx;
      if (cross > 0) positive = true;
      if (cross < 0) negative = true;
      previous = at;
    }
    return positive && negative;
  };
  const sweptCylinder = (piece, x, y, z, toX, toY, toZ, radius, height, toRadius = radius, toHeight = height) => {
    if (piece.length === 9 && x === toX && y === toY && z === toZ
      && stationarySeparated(piece, x, y, z, Math.max(radius, toRadius), Math.max(height, toHeight))) return false;
    centerX = centerY = centerZ = 0;
    let lowX = Infinity, lowY = Infinity, lowZ = Infinity, highX = -Infinity, highY = -Infinity, highZ = -Infinity;
    for (let i = 0; i < piece.length; i += 3) {
      const vx = piece[i], vy = piece[i + 1], vz = piece[i + 2];
      centerX += vx; centerY += vy; centerZ += vz;
      lowX = Math.min(lowX, vx); lowY = Math.min(lowY, vy); lowZ = Math.min(lowZ, vz);
      highX = Math.max(highX, vx); highY = Math.max(highY, vy); highZ = Math.max(highZ, vz);
    }
    const count = piece.length / 3;
    centerX /= count; centerY /= count; centerZ /= count;
    // A smaller piece margin makes degenerate point/flat queries count exact boundary contact as clear, not solid.
    scale = 1 - Math.min(0.5, POINT_CONTACT / Math.max(highX - lowX, highY - lowY, highZ - lowZ));
    const cap = Math.min(CONTACT, height / 2), toCap = Math.min(CONTACT, toHeight / 2);
    fromX = x; fromY = y + cap; fromZ = z; endX = toX; endY = toY + toCap; endZ = toZ;
    bodyRadius = Math.max(0, radius - CONTACT); bodyHeight = height - cap * 2;
    endRadius = Math.max(0, toRadius - CONTACT); endHeight = toHeight - toCap * 2;
    dx = centerX - (x + toX) / 2; dy = centerY - (y + toY) / 2 - (height + toHeight) / 4; dz = centerZ - (z + toZ) / 2;
    if (dx * dx + dy * dy + dz * dz < TOLERANCE * TOLERANCE) dx = 1;
    support(piece);
    if (px * dx + py * dy + pz * dz <= TOLERANCE * Math.hypot(dx, dy, dz)) return false;
    simplex[0] = px; simplex[1] = py; simplex[2] = pz; size = 1;
    dx = -px; dy = -py; dz = -pz;
    for (let iteration = 0; iteration < 96; iteration++) {
      const length = Math.hypot(dx, dy, dz);
      if (length <= TOLERANCE) return true;
      // Normalize: skinny voxel fragments would otherwise scale the contact tolerance or overflow the cross products.
      dx /= length; dy /= length; dz /= length;
      support(piece);
      if (px * dx + py * dy + pz * dz <= TOLERANCE) return false;
      for (let i = 0; i < size * 3; i += 3) {
        const sx = simplex[i] - px, sy = simplex[i + 1] - py, sz = simplex[i + 2] - pz;
        if (sx * sx + sy * sy + sz * sz < TOLERANCE * TOLERANCE) return true;
      }
      for (let i = size * 3 - 1; i >= 0; i--) simplex[i + 3] = simplex[i];
      simplex[0] = px; simplex[1] = py; simplex[2] = pz; size++;
      if (closest()) return true;
    }
    // Without a separating support plane, an unresolved sliver counts as solid.
    return true;
  };
  // The walking rig can tilt with a continuous slope. A vertical cylinder
  // then contains floor below its downhill side; retain the actual swept
  // convex body instead. Both arrays are caller-owned, including both poses.
  const hullSupport = (a, b) => {
    let maximum = -Infinity, minimum = Infinity, ai = 0, bi = 0;
    for (let i = 0; i < a.length; i += 3) {
      const dot = a[i] * dx + a[i + 1] * dy + a[i + 2] * dz;
      if (dot > maximum) { maximum = dot; ai = i; }
    }
    for (let i = 0; i < b.length; i += 3) {
      const dot = b[i] * dx + b[i + 1] * dy + b[i + 2] * dz;
      if (dot < minimum) { minimum = dot; bi = i; }
    }
    const margin = CONTACT / Math.hypot(dx, dy, dz);
    px = a[ai] - b[bi] - dx * margin;
    py = a[ai + 1] - b[bi + 1] - dy * margin;
    pz = a[ai + 2] - b[bi + 2] - dz * margin;
  };
  const hullsOverlap = (a, b) => {
    dx = 1; dy = dz = 0;
    hullSupport(a, b);
    if (px <= TOLERANCE) return false;
    simplex[0] = px; simplex[1] = py; simplex[2] = pz; size = 1;
    dx = -px; dy = -py; dz = -pz;
    for (let iteration = 0; iteration < 96; iteration++) {
      const length = Math.hypot(dx, dy, dz);
      if (length <= TOLERANCE) return true;
      dx /= length; dy /= length; dz /= length;
      hullSupport(a, b);
      if (px * dx + py * dy + pz * dz <= TOLERANCE) return false;
      for (let i = 0; i < size * 3; i += 3) {
        const sx = simplex[i] - px, sy = simplex[i + 1] - py, sz = simplex[i + 2] - pz;
        if (sx * sx + sy * sy + sz * sz < TOLERANCE * TOLERANCE) return true;
      }
      for (let i = size * 3 - 1; i >= 0; i--) simplex[i + 3] = simplex[i];
      simplex[0] = px; simplex[1] = py; simplex[2] = pz; size++;
      if (closest()) return true;
    }
    return true;
  };
  BL.convex = { sweptCylinder, hullsOverlap };
})();
