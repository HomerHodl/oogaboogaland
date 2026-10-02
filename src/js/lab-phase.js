// The lab doorway consumes incoming bananas without a reflective surface.
// Render the mirror's own glyph crests on a transparent, non-reflective plane.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { createNode, addChild, removeChild } = BL.scene;
  // `plane` is the shield's depth in the mouth's frame: the lab hangs it in the doorway, the Lightning Factory
  // further down its tunnel. `tint` colours its glyph crests, [r, g, b] from 0 to 1; left out, they are green.
  const create = (group, mouth, opening, plane = 0.5, tint = null) => {
    const sr = Math.sin(mouth.ry), cr = Math.cos(mouth.ry);
    const minX = opening.minX, maxX = opening.maxX, minY = opening.floorY, maxY = opening.ceilingY;
    const color = [0, 0, 0], geometry = {
      verts: [minX, minY, 0, maxX, minY, 0, maxX, maxY, 0, minX, maxY, 0],
      faces: [{ i: [0, 1, 2, 3], color }, { i: [3, 2, 1, 0], color }],
      lines: [], castShadow: false, mirrorRippleOnly: true
    };
    const node = createNode({ geometry, position: { x: 0, y: 0, z: plane }, mirrorRippleOnly: true, matrixNative: true, sightHidden: true, rippleTint: tint });
    addChild(group, node);
    const ripples = BL.mirrorRipples.create(node);
    // The same mesh-section atlas as the mirror outlines any registered body
    // crossing in either direction. The scene registers its existing actors
    // and samples after their final poses, without another scene traversal.
    const body = BL.mirrorBody.create(node, new Map());
    let contactX = 0, contactY = 0;
    const intersection = (ax, ay, az, bx, by, bz) => {
      const dx = ax - mouth.x, dz = az - mouth.z, ex = bx - mouth.x, ez = bz - mouth.z;
      const from = dx * sr + dz * cr - plane, to = ex * sr + ez * cr - plane;
      // Only incoming rounds cross the phase boundary. Include a final point
      // rounded to either side of the plane, but never a parallel segment.
      if (from <= 1e-6 || to > 1e-6 || from - to < 1e-8) return -1;
      const t = Math.min(1, from / (from - to));
      contactX = (dx + (ex - dx) * t) * cr - (dz + (ez - dz) * t) * sr;
      contactY = ay + (by - ay) * t - mouth.floorY;
      return contactX >= minX && contactX <= maxX && contactY >= minY && contactY <= maxY ? t : -1;
    };
    const clipTarget = (from, to) => {
      const t = intersection(from.x, from.y, from.z, to.x, to.y, to.z);
      if (t < 0) return false;
      to.x = from.x + (to.x - from.x) * t;
      to.y = from.y + (to.y - from.y) * t;
      to.z = from.z + (to.z - from.z) * t;
      return true;
    };
    const absorb = (ax, ay, az, point, dt = 0) => {
      const t = intersection(ax, ay, az, point.x, point.y, point.z);
      if (t < 0) return false;
      point.x = ax + (point.x - ax) * t;
      point.y = ay + (point.y - ay) * t;
      point.z = az + (point.z - az) * t;
      ripples.pulse(contactX, contactY, (1 - t) * dt);
      return true;
    };
    const update = (dt, time) => ripples.update(dt, time);
    const inside = (x, y, z) => {
      const dx = x - mouth.x, dz = z - mouth.z, across = dx * cr - dz * sr, along = dx * sr + dz * cr;
      const room = mouth.room, half = along < -room.from ? room.w / 2 : 2.5;
      return y >= mouth.floorY - 0.12 && y < mouth.floorY + room.h - 0.1
        && along <= plane && along >= -room.to && Math.abs(across) <= half;
    };
    return { node, ripples, body, clipTarget, absorb, update, inside,
      liveGeometry(set) { set.add(geometry); },
      dispose() { ripples.dispose(); body.dispose(); node.visible = false; removeChild(group, node); }
    };
  };
  BL.labPhase = { create };
})();
