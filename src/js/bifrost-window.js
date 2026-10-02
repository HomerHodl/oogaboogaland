// The island's window into ₿IFRÖST through the field in the gatehouse's portal. `BM.gateWindow`, a light stand-in of
// the chamber built once at full size in the chamber's frame, is pulled every frame along each point's own sight line
// from the viewer's eye into the DEPTH metres just behind the field (`relief`, one central collineation on that eye).
// Moving a point along its sight line never moves it on screen, so the window draws exactly what a window into the
// whole chamber would, in the ordinary pass, and the island's own depth masks it. Only the tunnel's last half metre
// before the field, where an Ooga walks through, stands at true size (`front`). The drawn relief is held to the passage
// behind the field (`clipMinY`, `clipMaxY`, `clipSlab`), which the gatehouse closes in stone, so what would land
// outside it would be hidden anyway.
//
// The mechanism turns in it as the chamber turns it at rest: the ₿ spinning and bobbing, each ring on its own tip,
// bands of light climbing the beam, and the open world's window breathing in its colour. Nothing in it answers the
// island, so walking in finds the chamber as the window showed it.
// WebGL only: the canvas renderer's painter's sort cannot mask it.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { mat4 } = BL.math;
  const { createNode, addChild, removeChild } = BL.scene;
  const BM = BL.bifrostModels;
  const { ENTRY, CORE } = BM;
  const TAU = Math.PI * 2;

  // How far behind the relief's axis plane (half a metre behind the field, where `front` ends) the chamber at infinity
  // lands, and how far past the passage's width, into the gatehouse's stone either side, the drawn relief may reach.
  const DEPTH = 0.8, MARGIN = 0.75;
  // The window shows while the eye stands in front of the field, and no farther from the middle of it than FAR.
  const NEAR = 0.05, FAR = 60, MIDDLE = 1.5;
  // The mechanism at rest, as `scene-bifrost.js` turns it: the ₿'s spin (radians a second), its bob's pace and height,
  // each ring's spin, and the beam's bands: how many drums one spans, how many leave its foot a second, and how deep
  // they dip its light between them.
  const SPIN = 0.6, BOB = 1.5, BOB_H = 0.024, RING_SPIN = [0.5, -0.35, 0.25], BAND = 9, FLOW = 0.3, DIP = 0.25;
  // The open world's rim breathes as the chamber's does at rest, radians a second, dimming by at most this much.
  const BREATHE = 2.4, BREATH = 0.2;

  // Scratch for the frame: the eye in the portal's frame, the relief, and the chamber to the world through it.
  const EYE = new Float64Array(3), RELIEF = mat4.create(), TMP = mat4.create(), W = mat4.create();
  // Every batch's instance version, counted for the page, so a batch made on a later visit never repeats one its
  // geometry's record has already uploaded.
  let version = 0;

  // The portal-frame central collineation centred on the eye (ex, ey, ez): the axis plane z = axis stays put and the
  // plane at infinity comes to z = axis - DEPTH, so every point behind the axis moves along its own sight line into
  // that band, never past the eye. Column-major; its last row is not (0, 0, 0, 1), so what it draws is `projective`.
  const relief = (out, ex, ey, ez, axis) => {
    const c = 1 / (ez - axis + DEPTH);
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
    out[8] = -ex * c; out[9] = -ey * c; out[10] = 1 - ez * c; out[11] = -c;
    out[12] = ex * axis * c; out[13] = ey * axis * c; out[14] = ez * axis * c; out[15] = 1 + axis * c;
    return out;
  };

  // The stand-in's relieved pieces as one portal draws them: projective, and clipped to its passage, from its floor to
  // its roof and across its width with MARGIN into the stone. Made once for the page, and again only if the portal
  // stands somewhere else, so every visit draws the same geometries and one clip slab.
  let clipped = null;
  const clippedFor = (portal) => {
    const { x, z, ry, floorY, room } = portal;
    if (clipped && clipped.x === x && clipped.z === z && clipped.ry === ry && clipped.floorY === floorY && clipped.w === room.w && clipped.h === room.h) return clipped;
    const stand = BM.gateWindow(), sr = Math.sin(ry), cr = Math.cos(ry), half = room.w / 2 + MARGIN;
    const clipSlab = new Float32Array([cr / half, 0, -sr / half, -(cr * x - sr * z) / half]);
    const clip = (geo) => ({ ...geo, projective: true, clipMinY: floorY - 0.05, clipMaxY: floorY + room.h, clipSlab });
    clipped = {
      x, z, ry, floorY, w: room.w, h: room.h,
      hall: clip(stand.hall), glyph: clip(stand.glyph), rings: stand.rings.map(clip), beam: clip(stand.beam.geometry), rim: stand.rim && clip(stand.rim)
    };
    return clipped;
  };

  // W moved up by y and turned by `a` about the chamber's upright, written at `at`: the ₿ and each ring.
  const placeTurned = (out, at, y, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    for (let r = 0; r < 4; r++) {
      out[at + r] = W[r] * c - W[8 + r] * s;
      out[at + 4 + r] = W[4 + r];
      out[at + 8 + r] = W[r] * s + W[8 + r] * c;
      out[at + 12 + r] = W[4 + r] * y + W[12 + r];
    }
  };
  // W moved up by y and scaled by (w, h, w), written at `at`: one drum of the beam.
  const placeDrum = (out, at, y, w, h) => {
    for (let r = 0; r < 4; r++) {
      out[at + r] = W[r] * w;
      out[at + 4 + r] = W[4 + r] * h;
      out[at + 8 + r] = W[8 + r] * w;
      out[at + 12 + r] = W[4 + r] * y + W[12 + r];
    }
  };

  // The window at the gate: `group` stands under the island's root at the portal (its floor, its bearing), so its own
  // placement is the portal's frame in the world; `portal` is the gate's record, whose `fieldZ` is where the field
  // stands in that frame and whose `room` is the passage behind it.
  const create = ({ group, portal }) => {
    const stand = BM.gateWindow(), geo = clippedFor(portal), axis = portal.fieldZ - 0.5, rows = stand.beam.rows;
    const GROUP = mat4.fromTRS(mat4.create(), group.position, group.rotation, group.scale), TO_PORTAL = mat4.invert(mat4.create(), GROUP);
    // The chamber's frame to the portal's: the floors level, the chamber's field on the portal's.
    const HALL = mat4.create();
    HALL[14] = portal.fieldZ - ENTRY.field;
    // Every batch culls as the clip box, the only place any of it draws, which a mirror's capture tests too.
    const sr = Math.sin(portal.ry), cr = Math.cos(portal.ry), half = portal.room.w / 2 + MARGIN, mid = axis - DEPTH / 2;
    const sphere = [portal.x + sr * mid, portal.floorY + portal.room.h / 2, portal.z + cr * mid, Math.hypot(half, portal.room.h / 2 + 0.05, DEPTH / 2) + 0.1];
    // Every instance glows fully in its baked colours and keeps its own palette in the Matrix (mode 5).
    const batch = (geometry, capacity) => {
      const data = new Float32Array(capacity * 20);
      for (let i = 0; i < capacity; i++) {
        data[i * 20 + 16] = 1;
        data[i * 20 + 18] = 5;
      }
      return createNode({ geometry, instanceData: data, instanceCount: 0, instanceVersion: version, fixedInstanceCapacity: true, cullSphere: sphere, visible: false });
    };
    const root = createNode({ sightHidden: true, matrixExterior: true, matrixNative: true, visible: false });
    const front = createNode({ geometry: stand.front, position: { x: 0, y: 0, z: portal.fieldZ - ENTRY.field } });
    const glyph = batch(geo.glyph, 1), rings = geo.rings.map((g) => batch(g, 1)), beam = batch(geo.beam, rows.length), hall = batch(geo.hall, 1);
    const rim = geo.rim ? batch(geo.rim, 1) : null;
    const batches = [glyph, ...rings, beam, ...(rim ? [rim] : []), hall];
    // Nearest first, so the hall behind fails the depth test early.
    addChild(root, front, ...batches);
    addChild(group, root);

    // The mechanism runs whether or not the window shows it: each angle and phase kept within a turn.
    const turns = new Float64Array(rings.length);
    let spin = 0, bob = 0, flow = 0, breath = 0;
    const step = (dt) => {
      spin = (spin + dt * SPIN) % TAU;
      bob = (bob + dt * BOB) % TAU;
      flow = (flow + dt * FLOW) % 1;
      breath = (breath + dt * BREATHE) % TAU;
      for (let i = 0; i < turns.length; i++) turns[i] = (turns[i] + dt * RING_SPIN[i]) % TAU;
    };

    // Called once the camera is final for the frame. The projection centre is the eye, set back along the view by the
    // perspective blend's offset when there is one. The window hides with the eye behind or at the field, past FAR,
    // looking straight down, or with the bird's-eye cutaway or the underground slice showing.
    const update = (dt, camera, opts) => {
      step(dt);
      const P = camera.position, mix = camera.orthoHeight > 0 ? Math.max(0, Math.min(1, camera.orthoMix || 0)) : 0;
      let x = P.x, y = P.y, z = P.z;
      if (mix > 0 && mix <= 0.99) {
        const T = camera.target, fx = T.x - x, fy = T.y - y, fz = T.z - z, back = mix * camera.orthoHeight * 0.5 / Math.tan(camera.fov / 2) / (1 - mix) / (Math.hypot(fx, fy, fz) || 1);
        x -= fx * back; y -= fy * back; z -= fz * back;
      }
      mat4.transformPoint(EYE, TO_PORTAL, x, y, z);
      const ex = EYE[0], ey = EYE[1], ez = EYE[2];
      const shown = mix <= 0.99 && ez - portal.fieldZ > NEAR && Math.hypot(ex, ey - MIDDLE, ez - portal.fieldZ) < FAR && opts.cutawayFade < 1 && opts.cutawayMaxY >= 1e5;
      root.visible = shown;
      if (!shown) return;
      mat4.multiply(TMP, relief(RELIEF, ex, ey, ez, axis), HALL);
      mat4.multiply(W, GROUP, TMP);
      hall.instanceData.set(W, 0);
      hall.instanceCount = 1;
      placeTurned(glyph.instanceData, 0, CORE.glyphY + Math.sin(bob) * BOB_H, spin);
      glyph.instanceCount = 1;
      for (let i = 0; i < rings.length; i++) {
        placeTurned(rings[i].instanceData, 0, CORE.glyphY, turns[i]);
        rings[i].instanceCount = 1;
      }
      // Bands of light leave the beam's foot and climb, each drum swelling a little and gilding as one passes and
      // dipping between them, as the chamber's beam flows at rest.
      const data = beam.instanceData;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], u = 0.5 + 0.5 * Math.sin(TAU * (i / BAND - flow)), band = u * u * u, at = i * 20;
        placeDrum(data, at, row.y, row.r * (1 + 0.04 * band), row.h);
        data[at + 17] = 0.1 * band - DIP * (1 - band) / 0.88;
      }
      beam.instanceCount = rows.length;
      if (rim) {
        rim.instanceData.set(W, 0);
        rim.instanceData[17] = -BREATH * (0.5 - 0.5 * Math.sin(breath));
        rim.instanceCount = 1;
      }
      version++;
      for (let i = 0; i < batches.length; i++) {
        const n = batches[i];
        n.instanceVersion = version;
        n.visible = n.instanceCount > 0;
      }
    };

    const dispose = () => {
      root.visible = false;
      removeChild(group, root);
    };
    const debug = {
      get shown() { return root.visible; },
      get spin() { return spin; },
      turns,
      batches: { hall, glyph, rings, beam, rim }
    };
    return { root, update, dispose, debug };
  };

  BL.bifrostWindow = { create, DEPTH, MARGIN, FAR, MIDDLE };
})();
