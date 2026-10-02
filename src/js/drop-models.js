// Ooga Drop props: roof plane, hoop, canopy, pack, target, wind streak; one cached geometry per builder.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { hexToRgb } = BL.math;
  const { createNode, addChild } = BL.scene;
  const { box, bevelBox, lathe, merge } = BL.models;
  const { kartWheel, yToZ, turn } = BL.raceModels, { moved } = BL.models;
  const { postSign, puff, limb, flatInto } = BL.hubModels;
  const { mulberry32 } = BL.math;
  const tones = (hex) => { const c = hexToRgb(hex); return [c, c, c, c]; };
  // Appends a part to a smooth geometry sharing its own vertices, so the renderer averages across it.
  const smoothInto = (geo, part) => {
    const base = geo.verts.length / 3;
    for (let i = 0; i < part.verts.length; i++) geo.verts.push(part.verts[i]);
    for (const f of part.faces) geo.faces.push({ ...f, i: f.i.map((k) => k + base) });
    return geo;
  };
  const cached = (build) => {
    let value = null;
    return () => value || (value = build());
  };
  const noShadow = (geo) => {
    geo.castShadow = false;
    return geo;
  };
  const WOOD = "#8a6236", WOOD_DK = "#5c4425", PLANK = "#a9773f", LEAF = "#4f8a3d", LEAF_DK = "#3e7a2c", FUR = "#d98a2e", BANANA = "#f5c542", SPOT = "#4a2f16", BONE = "#e8e2d2";
  const PLANE = { length: 4.4, span: 6.4, axisY: 0.95, noseZ: 2.3, seatZ: -0.95, seatY: 1.45, wheelR: 0.3, wheelX: 0.75, wheelZ: 0.45 };
  // +z is the nose; the stone wheels touch the ground at the origin.
  const FUR_DK = "#c97a24";
  const SPOTS = [[-2.6, 0.1], [-2.1, -0.35], [-1.5, 0.3], [-0.9, -0.2], [-0.3, 0.35], [0.4, -0.3], [1.0, 0.25], [1.7, -0.35], [2.3, 0.15], [2.8, -0.15], [-1.9, 0.5], [1.4, 0.5]];
  // The roof plane as a cartoon: a smooth round fuselage in two woods, leopard-hide wings of chunky bevelled planks
  // with painted spots and leaf tips, bone struts and rope bracing, a hide-covered seat, a stone engine with a
  // glowing ember and a bone skull on its nose, and a bevelled tail with a leaf fin and a banana on top.
  const planeBody = cached(() => {
    const y = PLANE.axisY, half = PLANE.length / 2, wingY = y + 0.44, wingZ = 0.35, rand = mulberry32(3101);
    const g = { verts: [], faces: [], lines: [], smooth: true }, BONE_RGB = hexToRgb(BONE), ROPE = hexToRgb("#b89760");
    const fuselage = yToZ(lathe({
      profile: [[0.14, -half], [0.3, -half + 0.45], [0.42, -half + 1.1], [0.47, -0.3], [0.47, 0.5], [0.42, half - 0.55], [0.3, half - 0.18], [0.16, half], [0, half]],
      segments: 14,
      color: (t) => t < 0.3 || t > 0.7 ? WOOD : WOOD_DK
    }));
    for (let i = 1; i < fuselage.verts.length; i += 3) fuselage.verts[i] += y;
    smoothInto(g, fuselage);
    // Struts and bracing: bone posts from the fuselage to the wing, rope crossing under it.
    for (const x of [-0.7, 0.7]) limb(g, x, y + 0.02, wingZ, x * 1.05, wingY - 0.06, wingZ, 0.05, 0.045, 7, BONE_RGB);
    for (const x of [-0.75, 0.75]) limb(g, x, y - 0.1, 0.45, x, y - 0.65, 0.45, 0.05, 0.05, 7, hexToRgb(WOOD_DK));
    limb(g, -0.8, y - 0.55, 0.45, 0.8, y - 0.55, 0.45, 0.04, 0.04, 6, hexToRgb(WOOD_DK));
    for (const s of [-1, 1]) limb(g, s * 0.7, y + 0.02, wingZ, s * 2.2, wingY - 0.05, wingZ + 0.1, 0.02, 0.02, 5, ROPE);
    // The hide seat cushion, the skull's dome and the ember on the engine.
    puff(g, 0, y + 0.52, PLANE.seatZ, 0.26, 0.06, 0.3, tones(FUR), rand, 3, 8);
    puff(g, 0, y + 0.72, 1.55, 0.2, 0.17, 0.18, tones(BONE), rand, 5, 9);
    const ember = g.faces.length;
    puff(g, 0, y + 0.6, 1.3, 0.1, 0.05, 0.1, tones("#ff8a2a"), rand, 3, 7);
    for (let f = ember; f < g.faces.length; f++) g.faces[f].emissive = 0.8;
    for (const s of [-1, 1]) {
      puff(g, s * 0.08, y + 0.72, 1.72, 0.035, 0.035, 0.025, tones("#141414"), rand, 3, 6);
      limb(g, s * 0.12, y + 0.82, 1.5, s * 0.3, y + 1.08, 1.46, 0.04, 0.015, 6, BONE_RGB);
    }
    flatInto(g,
      // Wing planks in two furs, a spot or two painted on each, a leading-edge spar and leaf tips.
      ...Array.from({ length: 5 }, (_, n) => bevelBox({ w: PLANE.span / 5 - 0.03, h: 0.13, d: 1.3, color: n % 2 ? FUR_DK : FUR, bevel: 0.04, offset: { x: (n - 2) * PLANE.span / 5, y: wingY, z: wingZ } })),
      ...SPOTS.map(([x, z]) => bevelBox({ w: 0.22, h: 0.03, d: 0.18, color: SPOT, bevel: 0.01, offset: { x, y: wingY + 0.075, z: wingZ + z } })),
      bevelBox({ w: PLANE.span + 0.1, h: 0.1, d: 0.14, color: WOOD_DK, bevel: 0.03, offset: { y: wingY, z: wingZ + 0.7 } }),
      ...[-1, 1].map((side) => bevelBox({ w: 0.62, h: 0.08, d: 1.12, color: LEAF, bevel: 0.03, offset: { x: side * (PLANE.span / 2 + 0.28), y: wingY - 0.02, z: wingZ - 0.05 } })),
      // Lashings round the fuselage, the seat, its back and the stick.
      ...[-1.5, -0.1, 1.2].map((z) => bevelBox({ w: 0.99, h: 0.1, d: 0.12, color: SPOT, bevel: 0.03, offset: { y: y + 0.44, z } })),
      bevelBox({ w: 0.64, h: 0.24, d: 0.82, color: "#2b1b10", bevel: 0.06, offset: { y: y + 0.36, z: PLANE.seatZ } }),
      bevelBox({ w: 0.62, h: 0.52, d: 0.1, color: WOOD_DK, bevel: 0.04, offset: { y: y + 0.57, z: PLANE.seatZ - 0.42 } }),
      bevelBox({ w: 0.06, h: 0.5, d: 0.06, color: SPOT, bevel: 0.015, offset: { y: y + 0.6, z: PLANE.seatZ + 0.55 } }),
      // The tailplane, the leaf fin, the fin's tip and the banana on top.
      bevelBox({ w: 2.2, h: 0.1, d: 0.7, color: PLANK, bevel: 0.04, offset: { y: y + 0.1, z: -half + 0.3 } }),
      bevelBox({ w: 0.1, h: 0.9, d: 0.85, color: LEAF, bevel: 0.03, offset: { y: y + 0.58, z: -half + 0.35 } }),
      bevelBox({ w: 0.12, h: 0.3, d: 0.35, color: LEAF_DK, bevel: 0.03, offset: { y: y + 1.05, z: -half + 0.15 } }),
      moved(turn(bevelBox({ w: 0.1, h: 0.1, d: 0.42, color: BANANA, bevel: 0.03 }), 0, 0, 0.5), 0, y + 1.24, -half + 0.3),
      bevelBox({ w: 0.1, h: 0.4, d: 0.1, color: BONE, bevel: 0.03, offset: { y: 0.2, z: -half + 0.5 } }),
      // The stone engine block the skull sits on.
      bevelBox({ w: 0.52, h: 0.32, d: 0.42, color: "#6b625a", bevel: 0.08, offset: { y: y + 0.42, z: 1.55 } })
    );
    return g;
  });
  const propeller = cached(() => merge(
    bevelBox({ w: 0.26, h: 0.26, d: 0.18, color: SPOT, bevel: 0.06 }),
    bevelBox({ w: 0.15, h: 1.7, d: 0.07, color: WOOD_DK, bevel: 0.025, offset: { z: 0.04 } }),
    ...[-0.75, 0.75].map((y) => bevelBox({ w: 0.17, h: 0.22, d: 0.08, color: BANANA, bevel: 0.025, offset: { y, z: 0.04 } }))
  ));
  const plane = () => {
    const node = createNode();
    const body = createNode({ geometry: planeBody() });
    const prop = createNode({ position: { x: 0, y: PLANE.axisY, z: PLANE.noseZ }, geometry: propeller() });
    addChild(node, body, prop);
    for (const x of [-PLANE.wheelX, PLANE.wheelX]) addChild(node, createNode({ position: { x, y: PLANE.wheelR, z: PLANE.wheelZ }, geometry: kartWheel() }));
    return { node, prop, seat: { x: 0, y: PLANE.seatY, z: PLANE.seatZ } };
  };
  // Striped cone blows along +x.
  const windsock = cached(() => {
    const cone = yToZ(lathe({ profile: [[0.02, 0], [0.26, 0.05], [0.24, 0.5], [0.16, 0.9], [0.1, 1.3], [0, 1.3]], segments: 8, color: (t) => t < 0.25 || (t >= 0.5 && t < 0.75) ? "#e04a3a" : BONE }));
    return merge(
      bevelBox({ w: 0.12, h: 2.4, d: 0.12, color: WOOD_DK, bevel: 0.03, offset: { y: 1.2 } }),
      bevelBox({ w: 0.18, h: 0.06, d: 0.18, color: "#b89760", bevel: 0.02, offset: { y: 2.3 } }),
      moved(turn(cone, Math.PI / 2), 0.08, 2.3, 0)
    );
  });
  // Unit-radius hoop in the xz plane; the scene scales each ring's node to its radius.
  const HOOP_SIDES = 6, HOOP_TUBE = 0.07;
  const hoop = cached(() => {
    const profile = [];
    for (let i = 0; i <= HOOP_SIDES; i++) {
      const a = i / HOOP_SIDES * Math.PI * 2;
      profile.push([1 + Math.cos(a) * HOOP_TUBE, Math.sin(a) * HOOP_TUBE]);
    }
    return noShadow(lathe({ profile, segments: 28, color: (t) => t < 0.5 ? "#ffd27a" : "#e0b53a", emissive: 0.75 }));
  });
  const CANOPY = { radius: 3.1, rise: 2.8, gores: 16 };
  // A rounder dome: more rings, the skirt tucking in a little at the rim like a filled canopy.
  const CANOPY_PROFILE = [[0, 1.55], [0.6, 1.5], [1.2, 1.36], [1.8, 1.12], [2.35, 0.8], [2.8, 0.4], [3.1, 0.05], [3.0, -0.12]];
  const GORES = [FUR, BANANA, FUR, SPOT].map(hexToRgb);
  // The gores cycle four colours over sixteen panels.
  const GORES_INNER = GORES.map((c) => c.map((v) => Math.round(v * 0.55)));
  const canopy = cached(() => {
    const geo = { verts: [], faces: [], lines: [] };
    const vert = (x, y, z) => {
      geo.verts.push(x, y, z);
      return geo.verts.length / 3 - 1;
    };
    const rings = CANOPY_PROFILE.map(([r, y]) => Array.from({ length: CANOPY.gores }, (_, s) => {
      const a = s / CANOPY.gores * Math.PI * 2;
      return vert(Math.cos(a) * r, CANOPY.rise + y, Math.sin(a) * r);
    }));
    for (let p = 0; p < rings.length - 1; p++) {
      for (let s = 0; s < CANOPY.gores; s++) {
        const s2 = (s + 1) % CANOPY.gores, c = GORES[s % GORES.length], inner = GORES_INNER[s % GORES.length];
        if (p === 0) {
          geo.faces.push({ i: [rings[0][0], rings[1][s2], rings[1][s]], color: c, emissive: 0 });
          geo.faces.push({ i: [rings[0][0], rings[1][s], rings[1][s2]], color: inner, emissive: 0 });
          continue;
        }
        geo.faces.push({ i: [rings[p][s], rings[p + 1][s], rings[p + 1][s2], rings[p][s2]], color: c, emissive: 0 });
        geo.faces.push({ i: [rings[p][s], rings[p][s2], rings[p + 1][s2], rings[p + 1][s]], color: inner, emissive: 0 });
      }
    }
    const harness = vert(0, 0.35, 0), lineColor = hexToRgb(BONE), rim = rings[rings.length - 1];
    for (let s = 0; s < CANOPY.gores; s += 2) geo.lines.push({ i: [rim[s], harness], color: lineColor, emissive: 0 });
    geo.lineWidth = 1.2;
    return geo;
  });
  // Sized in caveman-height units, like the jetpack.
  const pack = cached(() => merge(
    bevelBox({ w: 0.34, h: 0.4, d: 0.2, color: FUR, bevel: 0.06, offset: { y: 0.22, z: -0.1 } }),
    bevelBox({ w: 0.3, h: 0.14, d: 0.22, color: BANANA, bevel: 0.04, offset: { y: 0.4, z: -0.1 } }),
    ...[[-0.08, 0.14], [0.06, 0.28], [0.1, 0.1]].map(([x, y]) => box({ w: 0.06, h: 0.06, d: 0.03, color: SPOT, offset: { x, y, z: -0.21 } })),
    ...[-0.12, 0.12].map((x) => bevelBox({ w: 0.06, h: 0.42, d: 0.26, color: SPOT, bevel: 0.015, offset: { x, y: 0.22, z: 0.02 } })),
    box({ w: 0.08, h: 0.06, d: 0.08, color: "#e04a3a", emissive: 0.3, offset: { x: 0.16, y: 0.05, z: -0.05 } })
  ));
  const target = cached(() => noShadow(lathe({ profile: [[0, 0.02], [0.7, 0.02], [1.4, 0.02], [2.1, 0.02], [2.8, 0.02], [3.4, 0.02]], segments: 24, color: (t) => Math.round(t * 4) % 2 ? "#e04a3a" : "#f3efe4", emissive: 0.15 })));
  // ROOF_BACK/PARK_PITCH park the plane a little nose up and clear of the crest in front of it.
  const ROOF_BACK = -3.7, PARK_PITCH = -0.16;
  const roofSign = cached(() => postSign("Ooga Drop", 0.42, 0.5));
  // SIGN_AT is in the mouth's local frame, beside the parked plane.
  const SIGN_AT = { x: -2.7, z: ROOF_BACK + 1.4 };
  const hole = cached(() => noShadow(lathe({ profile: [[0, 0.03], [0.45, 0.03], [0.62, 0.03], [0.62, -0.02]], segments: 12, color: (t) => t < 0.5 ? "#1a120b" : "#3a2a18" })));
  // Unit-length streak along z; the scene stretches it along the diver's velocity.
  const streak = cached(() => noShadow(box({ w: 0.03, h: 0.03, d: 1, color: "#eef3f7", emissive: 0.35 })));
  // Plane park spot on the roof over a mouth's room, nose to the meadow.
  // Roof read under both wheels, higher wins; pitch turns about the axle, out.y is the plane origin.
  const roofSpot = (island, m, out) => {
    const ax = Math.sin(m.ry), az = Math.cos(m.ry), rx = Math.cos(m.ry), rz = -Math.sin(m.ry);
    out.x = m.x + ax * ROOF_BACK;
    out.z = m.z + az * ROOF_BACK;
    const wx = ax * PLANE.wheelZ, wz = az * PLANE.wheelZ;
    const left = island.surfaceAt(out.x + wx - rx * PLANE.wheelX, out.z + wz - rz * PLANE.wheelX);
    const right = island.surfaceAt(out.x + wx + rx * PLANE.wheelX, out.z + wz + rz * PLANE.wheelX);
    out.y = Math.max(left, right) - (PLANE.wheelR * (Math.cos(PARK_PITCH) - 1) - PLANE.wheelZ * Math.sin(PARK_PITCH));
    out.ry = m.ry;
    out.ax = ax;
    out.az = az;
  };
  BL.dropModels = { PLANE, CANOPY, PARK_PITCH, SIGN_AT, roofSign, plane, planeBody, propeller, windsock, hoop, canopy, pack, target, streak, hole, roofSpot };
})();
