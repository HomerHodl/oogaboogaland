// Climbing uses a broad, flat contact panel instead of the approach bearing
// or the normal of one decorative voxel. Windows still need real stone grips.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const RAMP_STEP = 1.16, RAMP_SLOPE = 2;
  const rampAt = (surfaceAt, x, y, z, heading, out) => {
    const sx = Math.sin(heading), sz = Math.cos(heading), center = surfaceAt(x, z);
    if (!Number.isFinite(center) || Math.abs(center - y) > RAMP_STEP) return false;
    if (Math.abs(surfaceAt(x - sx * 0.8, z - sz * 0.8) - center) < 0.08
      && Math.abs(surfaceAt(x + sx * 2.2, z + sz * 2.2) - center) < 0.08
      && Math.abs(surfaceAt(x - sz * 0.8, z + sx * 0.8) - center) < 0.08
      && Math.abs(surfaceAt(x + sz * 0.8, z - sx * 0.8) - center) < 0.08) return false;
    let sum = 0, sumAlong = 0, sumSide = 0, alongVariance = 0, sideVariance = 0;
    // Sample the walking rectangle, not just one voxel face. A stair profile
    // has reachable treads throughout; a cliff or opening has a discontinuity.
    for (let column = -2; column <= 2; column++) {
      const side = column * 0.4;
      let previous = NaN;
      for (let row = 0; row < 16; row++) {
        const along = -0.8 + row * 0.2, a = along - 0.7;
        const height = surfaceAt(x + sx * along + sz * side, z + sz * along - sx * side);
        if (!Number.isFinite(height) || Math.abs(height - center) > 6
          || Number.isFinite(previous) && Math.abs(height - previous) > RAMP_STEP) return false;
        previous = height;
        sum += height; sumAlong += height * a; sumSide += height * side;
        alongVariance += a * a; sideVariance += side * side;
      }
    }
    const along = sumAlong / alongVariance, across = sumSide / sideVariance;
    if (Math.hypot(along, across) > RAMP_SLOPE || Math.abs(along) + Math.abs(across) < 0.08) return false;
    out.groundX = across; out.groundZ = along;
    out.uneven = Math.abs(sum / 80 - along * 0.7 - center);
    return true;
  };
  const create = (solidAt) => {
    const rayDepth = (x, y, z, sx, sz) => {
      for (let depth = 0; depth <= 4; depth += 0.16) {
        if (!solidAt(x + sx * depth, y, z + sz * depth)) continue;
        let lo = Math.max(0, depth - 0.16), hi = depth;
        for (let refine = 0; refine < 5; refine++) {
          const middle = (lo + hi) * 0.5;
          if (solidAt(x + sx * middle, y, z + sz * middle)) hi = middle;
          else lo = middle;
        }
        return hi;
      }
      return Infinity;
    };
    const fit = (x, y, z, heading, out) => {
      const sx = Math.sin(heading), sz = Math.cos(heading);
      let covariance = 0, variance = 0, samples = 0, sumAcross = 0, sumDepth = 0;
      // Remove each row's mean before fitting: a projecting upper rim changes
      // the panel's depth, not its yaw. Missing rows at a crest are allowed.
      for (let row = 0; row < 3; row++) {
        let count = 0, sa = 0, sd = 0, saa = 0, sad = 0;
        const height = y + 0.25 + row * 0.7, center = rayDepth(x, height, z, sx, sz);
        // Grass approaches reject after three centre rays instead of a full
        // panel fit. A centre already inside stone is not an attachment.
        if (!Number.isFinite(center) || center === 0) continue;
        for (let column = 0; column < 7; column++) {
          const across = (column - 3) * 0.4;
          const px = x + sz * across, pz = z - sx * across;
          const depth = column === 3 ? center : rayDepth(px, height, pz, sx, sz);
          // A sample starting in stone cannot describe an outside wall face.
          if (!Number.isFinite(depth) || depth === 0) continue;
          count++; sa += across; sd += depth; saa += across * across; sad += across * depth;
        }
        if (count < 4) continue;
        covariance += sad - sa * sd / count; variance += saa - sa * sa / count;
        samples += count; sumAcross += sa; sumDepth += sd;
      }
      if (!samples || variance < 0.3) return false;
      const slope = covariance / variance, normal = heading - Math.atan(slope);
      out.heading = normal; out.nx = Math.sin(normal); out.nz = Math.cos(normal);
      const across = sumAcross / samples, depth = sumDepth / samples;
      out.x = x + sz * across + sx * depth;
      out.y = y; out.z = z - sx * across + sz * depth;
      return true;
    };
    // Coordinates on a panel are lateral u and vertical v. Depth is separate,
    // so a parallel ledge can move the panel outward without turning the body.
    const coordinates = (panel, x, y, z) => {
      panel.u = (x - panel.x) * panel.nz - (z - panel.z) * panel.nx;
      panel.v = y - panel.y;
      panel.depth = (x - panel.x) * panel.nx + (z - panel.z) * panel.nz;
    };
    const point = (panel, u, v, depth, out) => {
      out.x = panel.x + panel.nz * u + panel.nx * depth;
      out.y = panel.y + v;
      out.z = panel.z - panel.nx * u + panel.nz * depth;
    };
    return { fit, coordinates, point };
  };
  BL.wallPanels = { create, rampAt, RAMP_STEP, RAMP_SLOPE };
})();
