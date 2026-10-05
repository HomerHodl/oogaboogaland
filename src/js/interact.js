(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { boundsOf } = BL.scene;
  const TAP_PX = 7;
  const TAP_MS = 420;
  const LONG_PRESS_MS = 320;
  const DOUBLE_MS = 380;
  const DOUBLE_PX = 24;
  const WHEEL_GAP_MS = 220;
  const create = ({ canvas, renderer, camera, hooks = {}, preciseHover = false }) => {
    const targets = [];
    const weaponTargets = BL.weaponTargets.create(targets);
    const pointers = new Map();
    const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
    const hoverHit = { node: null, owner: null, distance: Infinity };
    const C = new Float32Array(3);
    const aimView = BL.math.mat4.create(), aimInverse = BL.math.mat4.create(), aimUp = { x: 0, y: 1, z: 0 };
    let hoverX = -1, hoverY = -1, hoverDirty = false, hovered = null;
    let hoverIgnored = null;
    let gesture = null;
    let pinchDist = 0;
    let zoomGesture = 0, wheelAt = -Infinity, wheelDirection = 0;
    let longPressTimer = 0;
    const lastTap = { at: -Infinity, node: null, owner: null, x: 0, y: 0 };
    // Every body part of one actor is the same target, so a poke hop cannot break a double
    // tap: a caveman by its cave, anything else (the Agent) by one shared owner object.
    const sameTarget = (hit) => hit ? hit.node === lastTap.node || hit.owner === lastTap.owner || (!!hit.owner.cave && !!lastTap.owner && hit.owner.cave === lastTap.owner.cave) : lastTap.node === null;
    const call = (name, a, b, c, d) => hooks[name] ? hooks[name](a, b, c, d) : undefined;
    const add = (node, owner, { radius = 0 } = {}) => {
      targets.push({ node, owner, radius, geometry: null, bounds: null });
      weaponTargets.register(node);
    };
    const remove = (node) => {
      const i = targets.findIndex((t) => t.node === node);
      if (i >= 0) targets.splice(i, 1);
      if (hovered === node) {
        hovered = null;
        call("onHover", null, { x: hoverX, y: hoverY });
        canvas.style.cursor = "grab";
      }
    };
    const nodeShown = (node) => {
      for (let n = node; n; n = n.parent) if (!n.visible || n.cameraHidden) return false;
      return true;
    };
    const worldScale = (m) => Math.sqrt(Math.max(
      m[0] * m[0] + m[1] * m[1] + m[2] * m[2],
      m[4] * m[4] + m[5] * m[5] + m[6] * m[6],
      m[8] * m[8] + m[9] * m[9] + m[10] * m[10]));
    const pick = (px, py, ignoreCave = null, currentView = false) => {
      if (currentView) {
        BL.math.mat4.lookAt(aimView, camera.position, camera.target, camera.up || aimUp);
        BL.math.mat4.rayFromView(ray, aimView, renderer.size.width, renderer.size.height, camera.fov, camera.position, px, py, camera.orthoMix, camera.orthoHeight);
      } else renderer.ray(px, py, camera, ray);
      let best = null, bestT = Infinity, bestPriority = -Infinity;
      for (const t of targets) {
        const { node } = t;
        if (!node.geometry || !nodeShown(node) || ignoreCave && t.owner.cave === ignoreCave) continue;
        // A caveman swaps its head geometry, so key the bounds memo on the geometry, not the node.
        if (t.geometry !== node.geometry) {
          t.geometry = node.geometry;
          t.bounds = boundsOf(node.geometry);
        }
        const b = t.bounds;
        const m = node.world;
        BL.math.mat4.transformPoint(C, m, b.center[0], b.center[1], b.center[2]);
        const r = (t.radius || b.radius) * worldScale(m);
        const lx = C[0] - ray.ox, ly = C[1] - ray.oy, lz = C[2] - ray.oz;
        const tca = lx * ray.dx + ly * ray.dy + lz * ray.dz;
        if (tca < 0) continue;
        const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
        if (d2 > r * r) continue;
        const thc = Math.sqrt(r * r - d2);
        // Authored controls may refine their broad sphere to the visible surface.
        const hitT = t.owner.pickRay ? t.owner.pickRay(ray) : tca - thc;
        if (!Number.isFinite(hitT) || t.owner.pickRay && hitT < 0) continue;
        const priority = t.owner.priority || 0;
        if (priority > bestPriority || (priority === bestPriority && hitT < bestT)) {
          bestT = hitT;
          bestPriority = priority;
          best = t;
        }
      }
      return best ? { node: best.node, owner: best.owner, t: bestT } : null;
    };
    const acceptHover = owner => !hoverIgnored || owner.cave !== hoverIgnored;
    const pickHover = (px, py) => {
      if (!preciseHover) return pick(px, py, hoverIgnored);
      renderer.ray(px, py, camera, ray);
      return weaponTargets.ray(hoverHit, ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz,
        camera.far, null, acceptHover, true) ? hoverHit : null;
    };
    const aimPoint = (px, py, out, ignoreCave = null) => {
      // A one-off aim entry must use the current eye, not the renderer's
      // previous frame. Refine only the same target the pointer would select.
      const hit = pick(px, py, ignoreCave, true);
      if (!hit) return false;
      const node = hit.node, geometry = node.geometry, verts = geometry.verts;
      BL.math.mat4.invert(aimInverse, node.world);
      BL.math.mat4.transformPoint(C, aimInverse, ray.ox, ray.oy, ray.oz);
      const ox = C[0], oy = C[1], oz = C[2], m = aimInverse;
      // Leave the local direction unnormalized so t remains world distance,
      // including geometry with nonuniform scale.
      const dx = m[0] * ray.dx + m[4] * ray.dy + m[8] * ray.dz;
      const dy = m[1] * ray.dx + m[5] * ray.dy + m[9] * ray.dz;
      const dz = m[2] * ray.dx + m[6] * ray.dy + m[10] * ray.dz;
      let nearest = Infinity;
      for (const face of geometry.faces) {
        const indices = face.i, a = indices[0] * 3;
        for (let i = 1; i + 1 < indices.length; i++) {
          const b = indices[i] * 3, c = indices[i + 1] * 3;
          const e1x = verts[b] - verts[a], e1y = verts[b + 1] - verts[a + 1], e1z = verts[b + 2] - verts[a + 2];
          const e2x = verts[c] - verts[a], e2y = verts[c + 1] - verts[a + 1], e2z = verts[c + 2] - verts[a + 2];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const determinant = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(determinant) < 1e-10) continue;
          const tx = ox - verts[a], ty = oy - verts[a + 1], tz = oz - verts[a + 2];
          const u = (tx * px + ty * py + tz * pz) / determinant;
          if (u < 0 || u > 1) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
          const v = (dx * qx + dy * qy + dz * qz) / determinant;
          if (v < 0 || u + v > 1) continue;
          const t = (e2x * qx + e2y * qy + e2z * qz) / determinant;
          if (t >= 0 && t < nearest) nearest = t;
        }
      }
      if (nearest < Infinity) {
        out.x = ray.ox + ray.dx * nearest;
        out.y = ray.oy + ray.dy * nearest;
        out.z = ray.oz + ray.dz * nearest;
      } else {
        // Generous hover spheres also select the gaps around an object. In
        // those gaps, focus that object's center instead of the wall behind it.
        const center = boundsOf(geometry).center;
        BL.math.mat4.transformPoint(C, node.world, center[0], center[1], center[2]);
        out.x = C[0]; out.y = C[1]; out.z = C[2];
      }
      return true;
    };
    const groundPoint = (px, py, planeY, out) => {
      renderer.ray(px, py, camera, ray);
      if (Math.abs(ray.dy) < 1e-5) return null;
      const t = (planeY - ray.oy) / ray.dy;
      if (t < 0) return null;
      out.x = ray.ox + ray.dx * t;
      out.y = planeY;
      out.z = ray.oz + ray.dz * t;
      return out;
    };
    // The two live pointers, without materialising the map's values.
    const PINCH = { d: 0, x: 0, y: 0 };
    const pinchSpan = (out) => {
      let ax = 0, ay = 0, n = 0;
      for (const q of pointers.values()) {
        if (n === 0) {
          ax = q.x;
          ay = q.y;
        } else if (n === 1) {
          out.d = Math.hypot(ax - q.x, ay - q.y);
          out.x = (ax + q.x) * 0.5; out.y = (ay + q.y) * 0.5;
        }
        n++;
      }
      return out;
    };
    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const clearLongPress = () => {
      if (longPressTimer) {
        window.clearTimeout(longPressTimer);
        longPressTimer = 0;
      }
    };
    const startGrab = (hit, p) => {
      if (call("onGrabStart", hit, p) === false) return false;
      gesture.mode = "grab";
      gesture.hit = hit;
      canvas.style.cursor = "grabbing";
      return true;
    };
    const onPointerDown = (e) => {
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (document.pointerLockElement !== canvas) canvas.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        clearLongPress();
        if (gesture && gesture.mode === "grab") {
          call("onGrabEnd", gesture.hit, p, null, true);
          canvas.style.cursor = "grab";
        }
        pinchSpan(PINCH);
        pinchDist = PINCH.d;
        zoomGesture++;
        gesture = { mode: "pinch" };
        return;
      }
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const hit = pick(p.x, p.y);
      gesture = { mode: "pending", start: p, last: p, at: e.timeStamp, hit, pointerId: e.pointerId, moved: false };
      if (hit && hit.owner.grab) {
        if (e.pointerType === "mouse") startGrab(hit, p);
        else {
          longPressTimer = window.setTimeout(() => {
            longPressTimer = 0;
            if (gesture && gesture.mode === "pending" && !gesture.moved) startGrab(hit, gesture.last);
          }, LONG_PRESS_MS);
        }
      }
    };
    const onPointerMove = (e) => {
      const p = local(e);
      if (e.pointerType === "mouse") {
        hoverX = p.x;
        hoverY = p.y;
        hoverDirty = true;
      }
      // Both mouse buttons = a walk that drags to turn: no tap on release, no grab in hand.
      // Pressed together they arrive as one move with no pointerdown, so the chord registers its own pointer.
      if (e.pointerType === "mouse" && (e.buttons & 3) === 3 && (!gesture || (gesture.pointerId === e.pointerId && gesture.mode !== "chord"))) {
        clearLongPress();
        if (gesture && gesture.mode === "grab") call("onGrabEnd", gesture.hit, p, null, true);
        pointers.set(e.pointerId, p);
        if (document.pointerLockElement !== canvas) canvas.setPointerCapture(e.pointerId);
        gesture = { mode: "chord", start: p, last: p, at: performance.now(), hit: null, pointerId: e.pointerId, moved: true };
        canvas.style.cursor = "grabbing";
        return;
      }
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, p);
      if (!gesture) return;
      if (gesture.mode === "pinch" && pointers.size === 2) {
        pinchSpan(PINCH);
        const d = PINCH.d || 1;
        call("onZoom", pinchDist / d, zoomGesture, PINCH.x, PINCH.y);
        pinchDist = d;
        return;
      }
      if (gesture.pointerId !== e.pointerId) return;
      const dx = p.x - gesture.last.x, dy = p.y - gesture.last.y;
      gesture.last = p;
      if (gesture.mode === "pending") {
        const far = Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > TAP_PX;
        if (far) {
          gesture.moved = true;
          clearLongPress();
          gesture.mode = "orbit";
        }
      }
      if (gesture.mode === "orbit" || gesture.mode === "chord") {
        call("onOrbit", dx, dy);
        canvas.style.cursor = "grabbing";
      } else if (gesture.mode === "grab") {
        call("onGrabMove", gesture.hit, p);
      }
    };
    const endGesture = (e, cancelled) => {
      const p = local(e);
      pointers.delete(e.pointerId);
      clearLongPress();
      if (!gesture) return;
      if (gesture.mode === "pinch") {
        if (pointers.size < 2) gesture = null;
        return;
      }
      if (gesture.pointerId !== e.pointerId) return;
      const g = gesture;
      gesture = null;
      canvas.style.cursor = "grab";
      hoverDirty = true;
      if (g.mode === "grab") {
        const dropHit = cancelled ? null : pick(p.x, p.y);
        call("onGrabEnd", g.hit, p, dropHit && dropHit.node !== g.hit.node ? dropHit : null, cancelled);
      } else if (g.mode === "pending" && !cancelled && e.timeStamp - g.at < TAP_MS) {
        const node = g.hit ? g.hit.node : null;
        // Input timestamps keep a quick tap quick even when a frame delays its handlers.
        const now = e.timeStamp;
        if (now - lastTap.at < DOUBLE_MS && sameTarget(g.hit) && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < DOUBLE_PX) {
          lastTap.at = -Infinity;
          lastTap.node = null;
          lastTap.owner = null;
          call("onDoubleTap", g.hit, p);
        } else {
          lastTap.at = now;
          lastTap.node = node;
          lastTap.owner = g.hit ? g.hit.owner : null;
          lastTap.x = p.x;
          lastTap.y = p.y;
          call("onTap", g.hit, p);
        }
      }
    };
    const onPointerUp = (e) => endGesture(e, false);
    const onPointerCancel = (e) => endGesture(e, true);
    const onPointerLeave = () => {
      hoverX = -1;
      hoverY = -1;
      hoverDirty = true;
    };
    const onWheel = (e) => {
      e.preventDefault();
      if (!e.deltaY) return;
      const direction = Math.sign(e.deltaY);
      // Momentum is part of the same scroll. A pause or reversal starts a
      // fresh gesture, so a long swipe can stop at a camera-mode boundary.
      if (e.timeStamp - wheelAt > WHEEL_GAP_MS || direction !== wheelDirection) zoomGesture++;
      wheelAt = e.timeStamp;
      wheelDirection = direction;
      // Keep a large swipe's distance instead of reducing every event to one
      // notch. The camera damps the resulting target distance independently.
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1);
      const p = local(e);
      call("onZoom", Math.exp(Math.max(-1200, Math.min(1200, delta)) * 2.5e-3), zoomGesture, p.x, p.y);
    };
    const onContextMenu = (e) => e.preventDefault();
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    const update = () => {
      // A view change can hide our own name without any pointer movement.
      const ignored = call("hoverIgnore") || null;
      if (ignored !== hoverIgnored) { hoverIgnored = ignored; hoverDirty = true; }
      if (!hoverDirty) return;
      hoverDirty = false;
      const busy = gesture && gesture.mode !== "pending";
      const hit = !busy && hoverX >= 0 ? pickHover(hoverX, hoverY) : null;
      const node = hit ? hit.node : null;
      if (node !== hovered) {
        hovered = node;
        call("onHover", hit, { x: hoverX, y: hoverY });
        if (!busy) canvas.style.cursor = hit ? "pointer" : "grab";
      } else if (hit) {
        call("onHoverMove", hit, { x: hoverX, y: hoverY });
      }
    };
    const reset = () => {
      clearLongPress();
      if (gesture && gesture.mode === "grab") call("onGrabEnd", gesture.hit, gesture.last, null, true);
      gesture = null;
      for (const pointerId of pointers.keys()) if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
      pointers.clear();
      pinchDist = 0;
      lastTap.at = -Infinity;
      lastTap.node = lastTap.owner = null;
      hoverX = hoverY = -1;
      hoverDirty = false;
      hoverIgnored = null;
      if (hovered) call("onHover", null, { x: -1, y: -1 });
      hovered = null;
      canvas.style.cursor = "grab";
    };
    const dispose = () => {
      reset();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      targets.length = 0;
    };
    return {
      add, remove, pick, aimPoint, weaponTargets, groundPoint, update, reset, dispose, get targetCount() {
        return targets.length;
      },
      // A drag is still held, even if it has paused.
      get orbiting() {
        return !!gesture && (gesture.mode === "orbit" || gesture.mode === "chord");
      }
    };
  };
  BL.interact = { create, DOUBLE_MS };
})();
