// Race props: mounts, gantry, pickups, spectators, themed decor; one cached geometry per builder.
// The Rock Kart and Dino mounts, gantry and lamps, boost pad, item crate, rock, peel, boulder,
// spectators, banners, torch stands, and the themed decor: palms, lagoon rocks, lava rocks,
// obsidian, bones, pines, crystals, ice spikes, snow rocks and buoys.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { hexToRgb, mulberry32 } = BL.math;
  const { createNode, addChild } = BL.scene;
  const { box, bevelBox, lathe, merge, cached, variants, makeVox: vox, voxelGeometry: voxGeo, moved, turnedX, turnedY, turnedZ } = BL.models;
  const { puff, limb, padNormals, flatInto } = BL.hubModels;
  // Cartoon builders on the hub's kit: `soft()` starts a smooth geometry that bevelled parts join through
  // `flatInto`, `tones(hex)` is one colour in the four bands `puff` takes, and `lump` a rounded stone.
  const soft = () => ({ verts: [], faces: [], lines: [], smooth: true });
  const tones = (hex) => { const c = hexToRgb(hex); return [c, c, c, c]; };
  const lump = (geo, x, y, z, rx, ry, rz, hex, rand, rings = 5, segs = 9) => puff(geo, x, y, z, rx, ry, rz, tones(hex), rand, rings, segs);
  const ROPE = "#b89760";
  const keyed = (build) => {
    const cache = new Map();
    return (key) => {
      let value = cache.get(key);
      if (!value) cache.set(key, value = build(key));
      return value;
    };
  };
  // Cyclic axis swap y -> x is a proper rotation, so the winding holds without reversing faces.
  const yToX = (geo) => {
    const p = geo.verts;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      p[i] = y;
      p[i + 1] = z;
      p[i + 2] = x;
    }
    return geo;
  };
  const yToZ = (geo) => {
    const p = geo.verts;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      p[i] = z;
      p[i + 1] = x;
      p[i + 2] = y;
    }
    return geo;
  };
  // Pitch about x, then roll about z, then yaw about y.
  const turn = (geo, yaw, roll = 0, pitch = 0) => turnedY(turnedZ(turnedX(geo, pitch), roll), yaw);
  const noShadow = (geo) => {
    geo.castShadow = false;
    return geo;
  };
  // Boost flame points down -z, drawn behind a boosting racer.
  const boostFlame = cached(() => noShadow(yToZ(merge(
    lathe({ profile: [[0.22, 0], [0.3, -0.35], [0.16, -0.9], [0, -1.4]], segments: 7, color: (t) => t < 0.4 ? "#ffb13b" : "#ff6a1e", emissive: 1 }),
    lathe({ profile: [[0.1, 0.02], [0.14, -0.3], [0.06, -0.7], [0, -0.95]], segments: 6, color: "#fff0b0", emissive: 1 })
  ))));
  const WOOD = "#8a6236", WOOD_DK = "#5c4425", PLANK = "#a9773f", STONE = ["#7a716a", "#6b625a", "#57504a"];

  const KART = { length: 1.7, width: 1.1, wheelR: 0.3, wheelX: 0.58, wheelZ: 0.58, seatY: 0.42 };
  // A chunky bevelled timber tub on smooth log axles: planked sides lashed with rope, bumpers fore and aft, a hide
  // seat with a backrest, a stick to steer by, a stone dash with a glowing ember and two bone exhausts.
  const kartChassis = cached(() => {
    const g = soft(), rand = mulberry32(81);
    flatInto(g,
      bevelBox({ w: 0.78, h: 0.42, d: KART.length, color: WOOD, bevel: 0.07, offset: { y: 0.42 } }),
      ...[0.3, 0.46].map((y) => bevelBox({ w: 0.8, h: 0.03, d: KART.length - 0.12, color: "#6e4c28", bevel: 0.01, offset: { y } })),
      bevelBox({ w: 0.66, h: 0.46, d: 0.22, color: WOOD_DK, bevel: 0.06, offset: { y: 0.42, z: KART.length / 2 - 0.02 } }),
      bevelBox({ w: 0.66, h: 0.46, d: 0.22, color: WOOD_DK, bevel: 0.06, offset: { y: 0.42, z: -KART.length / 2 + 0.02 } }),
      ...[-0.5, 0.1, 0.45].map((z) => bevelBox({ w: 0.86, h: 0.09, d: 0.11, color: ROPE, bevel: 0.03, offset: { y: 0.42, z } })),
      bevelBox({ w: 0.52, h: 0.12, d: 0.5, color: "#4a3319", bevel: 0.04, offset: { y: 0.56, z: -0.15 } }),
      bevelBox({ w: 0.4, h: 0.32, d: 0.1, color: "#4a3319", bevel: 0.03, offset: { y: 0.76, z: -0.42 } }),
      bevelBox({ w: 0.72, h: 0.16, d: 0.32, color: "#7a5630", bevel: 0.05, offset: { y: 0.68, z: 0.66 } })
    );
    // The hide on the seat and the stone dash with its ember.
    lump(g, 0, 0.64, -0.15, 0.24, 0.06, 0.24, "#d9a441", rand, 3, 8);
    lump(g, 0, 0.8, 0.62, 0.26, 0.15, 0.17, "#6b625a", rand, 4, 8);
    const ember = g.faces.length;
    lump(g, 0, 0.94, 0.62, 0.09, 0.05, 0.09, "#ff8a2a", rand, 3, 7);
    for (let f = ember; f < g.faces.length; f++) g.faces[f].emissive = 0.8;
    // Axles, the steering stick and its grip, then the bone exhausts.
    for (const z of [KART.wheelZ, -KART.wheelZ]) limb(g, -0.58, KART.wheelR, z, 0.58, KART.wheelR, z, 0.05, 0.05, 7, hexToRgb("#3a2a18"));
    limb(g, 0, 0.6, 0.32, 0, 1.02, 0.34, 0.035, 0.03, 6, hexToRgb("#3a2a18"));
    limb(g, -0.15, 1.03, 0.34, 0.15, 1.03, 0.34, 0.035, 0.035, 6, hexToRgb("#3a2a18"));
    for (const x of [-0.22, 0.22]) {
      limb(g, x, 0.5, -0.82, x, 0.52, -1.12, 0.05, 0.05, 7, hexToRgb("#e8e2d2"));
      lump(g, x, 0.52, -1.14, 0.07, 0.07, 0.05, "#f2ecdc", rand, 3, 7);
    }
    return g;
  });
  // A stone wheel with chamfered rims, fourteen chipped segments and a timber hub.
  const kartWheel = cached(() => yToX(merge(
    lathe({ profile: [[0, -0.11], [0.19, -0.11], [0.27, -0.1], [KART.wheelR, -0.06], [KART.wheelR, 0.06], [0.27, 0.1], [0.19, 0.11], [0, 0.11]], segments: 14, color: (t) => t < 0.3 || t > 0.7 ? "#5b544d" : "#7a716a" }),
    lathe({ profile: [[0, -0.13], [0.09, -0.13], [0.1, -0.12], [0.1, 0.12], [0.09, 0.13], [0, 0.13]], segments: 8, color: "#3a2a18" })
  )));
  const kartPennant = keyed((color) => merge(
    bevelBox({ w: 0.06, h: 1.3, d: 0.06, color: "#3a2a18", bevel: 0.015, offset: { x: -0.36, y: 0.65, z: -0.7 } }),
    box({ w: 0.02, h: 0.28, d: 0.42, color, emissive: 0.15, offset: { x: -0.36, y: 1.16, z: -0.5 } }),
    box({ w: 0.02, h: 0.14, d: 0.22, color, emissive: 0.15, offset: { x: -0.36, y: 1.09, z: -0.18 } })
  ));
  const kart = (color) => {
    const node = createNode();
    const chassis = createNode({ geometry: kartChassis() });
    const pennant = createNode({ geometry: kartPennant(color) });
    const wheels = [];
    for (const [x, z] of [[-KART.wheelX, KART.wheelZ], [KART.wheelX, KART.wheelZ], [-KART.wheelX, -KART.wheelZ], [KART.wheelX, -KART.wheelZ]]) {
      const wheel = createNode({ position: { x, y: KART.wheelR, z }, geometry: kartWheel() });
      wheels.push(wheel);
      addChild(node, wheel);
    }
    addChild(node, chassis, pennant);
    return { node, wheels, seatY: KART.seatY, seatZ: -0.15 };
  };
  const DINO_UNIT = 0.085;
  // Three hides shared across the field: every dino part stays one instanced draw per hide.
  const DINO_HIDES = [["#4f8a3d", "#3d6b2f", "#a8d27a"], ["#d1762e", "#a35a22", "#f2c27a"], ["#4a78b8", "#365a8c", "#a7c4ec"]];
  const dinoParts = keyed((hide) => {
    const [base, dark, belly] = DINO_HIDES[hide % DINO_HIDES.length];
    const rand = mulberry32(400 + hide);
    const P = [base, dark, belly, "#f2efe4", "#141414", "#5c4425", "#8a6236", "#e8e2d2"];
    const skin = () => rand() < 0.2 ? 1 : 0;
    const body = vox();
    body.fill(-3, 3, 0, 6, -5, 5, skin);
    body.fill(-4, 4, 1, 4, -3, 1, skin);
    body.fill(-2, 2, 0, 1, -4, 4, 2);
    body.fill(-3, 3, 4, 5, 6, 8, skin);
    body.fill(-2, 2, 7, 7, 6, 8, skin);
    body.fill(-2, 2, 6, 6, 6, 8, 2);
    for (const z of [-5, -3, 4]) body.fill(0, 0, 7, 8, z, z, 1);
    body.fill(-3, 3, 7, 7, -2, 2, 5);
    body.fill(-4, 4, 7, 7, -1, 1, 5);
    body.fill(-4, 4, 3, 6, 0, 0, 6);
    body.fill(0, 0, 8, 9, 2, 2, 5);
    const tail = vox();
    tail.fill(-2, 2, 0, 3, -3, 0, skin);
    tail.fill(-1, 1, 1, 3, -6, -4, skin);
    tail.fill(-1, 1, 1, 2, -9, -7, skin);
    tail.fill(0, 0, 0, 1, -12, -10, skin);
    tail.set(0, 0, -13, 1);
    const neck = vox();
    neck.fill(-1, 1, 0, 5, -1, 1, skin);
    neck.fill(-2, 2, 5, 9, -2, 4, skin);
    neck.fill(-2, 2, 5, 7, 5, 6, skin);
    neck.fill(-1, 1, 4, 4, 1, 6, skin);
    neck.fill(-2, 2, 6, 6, 5, 6, 3);
    neck.fill(-1, 1, 5, 5, 3, 6, 4);
    for (const x of [-1, 0, 1]) neck.set(x, 5, 6, 7);
    for (const x of [-2, 2]) {
      neck.set(x, 8, 2, 3);
      neck.set(x, 8, 3, 4);
    }
    neck.set(-1, 7, 6, 4);
    neck.set(1, 7, 6, 4);
    neck.set(0, 10, -1, 1);
    neck.set(0, 10, 0, 1);
    // Leg origin is the hip, so swinging its node keeps the leg attached.
    const leg = vox();
    leg.fill(-1, 1, -4, 0, -1, 2, skin);
    leg.fill(-1, 1, -3, -1, -2, -2, 1);
    leg.fill(-1, 0, -7, -4, -1, 1, skin);
    leg.fill(-1, 0, -8, -8, -1, 3, 3);
    leg.set(-1, -8, 4, 7);
    leg.set(0, -8, 4, 7);
    const arm = vox();
    arm.fill(0, 0, 0, 2, 0, 0, skin);
    arm.set(0, 0, 1, 3);
    const opts = { unit: DINO_UNIT, palette: P };
    return {
      body: voxGeo(body, { ...opts, origin: { x: -3.5 * DINO_UNIT, y: 0, z: -5.5 * DINO_UNIT } }),
      tail: voxGeo(tail, { ...opts, origin: { x: -2.5 * DINO_UNIT, y: -2 * DINO_UNIT, z: 0 } }),
      neck: voxGeo(neck, { ...opts, origin: { x: -2.5 * DINO_UNIT, y: 0, z: -2 * DINO_UNIT } }),
      leg: voxGeo(leg, { ...opts, origin: { x: -1.5 * DINO_UNIT, y: 0, z: -1.5 * DINO_UNIT } }),
      arm: voxGeo(arm, { ...opts, origin: { x: -0.5 * DINO_UNIT, y: -2 * DINO_UNIT, z: -0.5 * DINO_UNIT } })
    };
  });
  const dino = (hide) => {
    const g = dinoParts(hide), u = DINO_UNIT;
    const node = createNode();
    const hips = createNode({ position: { x: 0, y: 8 * u, z: 0 }, geometry: g.body });
    const tail = createNode({ position: { x: 0, y: 2 * u, z: -5 * u }, geometry: g.tail });
    const neck = createNode({ position: { x: 0, y: 5 * u, z: 7 * u }, rotation: { x: -0.35, y: 0, z: 0 }, geometry: g.neck });
    const legL = createNode({ position: { x: -2.5 * u, y: 8 * u, z: -0.5 * u }, geometry: g.leg });
    const legR = createNode({ position: { x: 2.5 * u, y: 8 * u, z: -0.5 * u }, geometry: g.leg });
    const armL = createNode({ position: { x: -3 * u, y: 3 * u, z: 5 * u }, rotation: { x: 0.6, y: 0, z: 0 }, geometry: g.arm });
    const armR = createNode({ position: { x: 3 * u, y: 3 * u, z: 5 * u }, rotation: { x: 0.6, y: 0, z: 0 }, geometry: g.arm });
    addChild(hips, tail, neck, armL, armR);
    addChild(node, hips, legL, legR);
    return { node, hips, tail, neck, legL, legR, seatY: 17 * u, seatZ: 0 };
  };

  const GANTRY = { span: 16, height: 5 };
  // Two pillars of stacked bevelled stone blocks, each a little turned and sized its own way, capped with slabs,
  // under a lashed timber beam and a planked walk hung with pennants.
  const gantry = cached(() => {
    const rand = mulberry32(77);
    const stone = () => STONE[rand() < 0.3 ? 2 : rand() < 0.5 ? 1 : 0];
    const parts = [];
    for (const side of [-1, 1]) {
      for (let y = 0; y < GANTRY.height; y += 0.5) parts.push(turn(bevelBox({ w: 0.92 + (rand() - 0.5) * 0.14, h: 0.5, d: 0.92 + (rand() - 0.5) * 0.14, color: stone(), bevel: 0.08, offset: { y: y + 0.25 } }), (rand() - 0.5) * 0.25));
      for (let k = parts.length - GANTRY.height * 2; k < parts.length; k++) moved(parts[k], side * GANTRY.span / 2, 0, 0);
      parts.push(bevelBox({ w: 1.3, h: 0.3, d: 1.3, color: "#57504a", bevel: 0.07, offset: { x: side * GANTRY.span / 2, y: GANTRY.height + 0.15 } }));
      for (const y of [GANTRY.height + 0.42, GANTRY.height + 0.68]) parts.push(bevelBox({ w: 0.6, h: 0.08, d: 0.6, color: ROPE, bevel: 0.025, offset: { x: side * (GANTRY.span / 2 - 0.2), y } }));
    }
    parts.push(bevelBox({ w: GANTRY.span + 1.4, h: 0.5, d: 0.5, color: WOOD_DK, bevel: 0.1, offset: { y: GANTRY.height + 0.55 } }));
    parts.push(bevelBox({ w: GANTRY.span - 1, h: 0.14, d: 0.6, color: PLANK, bevel: 0.04, offset: { y: GANTRY.height + 0.87 } }));
    const colors = ["#f5c542", "#e04a3a", "#22c55e", "#f3efe4"];
    for (let x = -GANTRY.span / 2 + 0.9; x < GANTRY.span / 2 - 0.6; x += 0.62) {
      parts.push(bevelBox({ w: 0.4, h: 0.32, d: 0.04, color: colors[Math.floor(rand() * colors.length)], emissive: 0.1, bevel: 0.015, offset: { x, y: GANTRY.height + 0.14, z: 0.32 } }));
      parts.push(bevelBox({ w: 0.2, h: 0.2, d: 0.04, color: colors[Math.floor(rand() * colors.length)], emissive: 0.1, bevel: 0.015, offset: { x, y: GANTRY.height - 0.12, z: 0.32 } }));
    }
    return merge(...parts);
  });
  const gantryLamp = cached(() => merge(
    bevelBox({ w: 0.36, h: 0.12, d: 0.36, color: "#3a2a18", bevel: 0.03, offset: { y: -0.06 } }),
    bevelBox({ w: 0.26, h: 0.3, d: 0.26, color: "#ffb13b", emissive: 1, bevel: 0.05, offset: { y: -0.27 } }),
    bevelBox({ w: 0.32, h: 0.06, d: 0.32, color: "#3a2a18", bevel: 0.02, offset: { y: -0.45 } })
  ));
  const gantryLampY = GANTRY.height + 0.3;
  // Boost pad chevron points along +z.
  const boostPad = cached(() => noShadow(merge(
    box({ w: 2.2, h: 0.06, d: 2.6, color: "#2b2521", offset: { y: 0.03 } }),
    ...[-0.8, 0, 0.8].map((z) => merge(
      turn(box({ w: 0.2, h: 0.03, d: 1.1, color: "#ffb13b", emissive: 1, offset: { x: -0.4, y: 0.075, z: z - 0.3 } }), 0.6),
      turn(box({ w: 0.2, h: 0.03, d: 1.1, color: "#ffb13b", emissive: 1, offset: { x: 0.4, y: 0.075, z: z - 0.3 } }), -0.6)
    ))
  )));
  // The mystery crate: bevelled planks between chunky corner posts, a glowing banana-gold panel on every side.
  const itemCrate = cached(() => merge(
    box({ w: 0.7, h: 0.7, d: 0.7, color: "#3a2616", offset: { y: 0.42 } }),
    ...[0, 1, 2, 3].map((side) => turn(merge(
      ...[0, 1, 2].map((k) => bevelBox({ w: 0.7, h: 0.22, d: 0.05, color: k === 1 ? "#b07a42" : PLANK, bevel: 0.018, offset: { y: 0.17 + k * 0.25, z: 0.375 } })),
      bevelBox({ w: 0.34, h: 0.34, d: 0.03, color: "#ffb13b", emissive: 0.9, bevel: 0.03, offset: { y: 0.42, z: 0.41 } })
    ), side * Math.PI / 2)),
    ...[[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]].map(([x, z]) => bevelBox({ w: 0.11, h: 0.86, d: 0.11, color: WOOD_DK, bevel: 0.03, offset: { x, y: 0.42, z } })),
    bevelBox({ w: 0.86, h: 0.1, d: 0.86, color: WOOD_DK, bevel: 0.03, offset: { y: 0.8 } })
  ));
  // Rolling hazards and thrown rocks as rounded stones: a main lobe with a few knobbly lumps.
  const roundStone = (seed, r, hex, dark) => {
    const g = soft(), rand = mulberry32(seed);
    lump(g, 0, 0, 0, r, r * 0.95, r, hex, rand, 6, 11);
    for (let k = 0; k < 5; k++) {
      const a = rand() * Math.PI * 2, b = (rand() - 0.5) * 2;
      lump(g, Math.cos(a) * r * 0.62, b * r * 0.5, Math.sin(a) * r * 0.62, r * 0.42, r * 0.38, r * 0.42, k % 2 ? dark : hex, rand, 4, 8);
    }
    return g;
  };
  const rockShot = cached(() => roundStone(19, 0.2, "#6b625a", "#57504a"));
  const peel = cached(() => noShadow(merge(
    box({ w: 0.24, h: 0.06, d: 0.24, color: "#e0b53a", offset: { y: 0.04 } }),
    ...[0, 1, 2, 3].map((i) => turn(box({ w: 0.2, h: 0.04, d: 0.5, color: "#f5c542", offset: { y: 0.05, z: 0.32 } }), i * Math.PI / 2 + 0.4))
  )));
  const boulder = cached(() => roundStone(311, 0.82, "#5e5449", "#45403a"));
  // The same rolling hazard packed from snow, for the peak's ice.
  const snowball = cached(() => roundStone(313, 0.82, "#f2f6f9", "#cfdde8"));
  const spectator = variants((i) => {
    const skins = ["#c98a5b", "#a9744c", "#d9a06b"], furs = ["#d98a2e", "#c98936", "#e09a40"];
    const v = vox();
    v.fill(-1, 1, 0, 2, -1, 0, 0);
    v.fill(-2, 2, 3, 5, -1, 1, 1);
    v.fill(-1, 1, 6, 8, -1, 1, 0);
    v.fill(-2, 2, 8, 9, -2, 1, 2);
    v.set(-3, 4, 0, 0);
    v.set(3, 4, 0, 0);
    v.fill(-3, -3, 5, 8, 0, 0, 0);
    v.fill(3, 3, 5, 8, 0, 0, 0);
    return noShadow(voxGeo(v, { unit: 0.075, palette: [skins[i % 3], furs[i % 3], "#2b1b10"], origin: { x: 0, y: 0, z: 0 } }));
  });
  const banner = keyed((color) => merge(
    bevelBox({ w: 0.16, h: 3.2, d: 0.16, color: "#3a2a18", bevel: 0.035, offset: { y: 1.6 } }),
    bevelBox({ w: 0.22, h: 0.08, d: 0.22, color: ROPE, bevel: 0.02, offset: { y: 3.0 } }),
    box({ w: 0.04, h: 1.4, d: 0.9, color, emissive: 0.1, offset: { y: 2.3, z: 0.5 } }),
    box({ w: 0.04, h: 0.5, d: 0.5, color, emissive: 0.1, offset: { y: 1.45, z: 0.3 } })
  ));
  const torchStand = cached(() => {
    const geo = merge(
      bevelBox({ w: 0.54, h: 0.3, d: 0.54, color: "#57504a", bevel: 0.07, offset: { y: 0.15 } }),
      bevelBox({ w: 0.18, h: 1.6, d: 0.18, color: WOOD_DK, bevel: 0.04, offset: { y: 1.1 } }),
      bevelBox({ w: 0.24, h: 0.08, d: 0.24, color: ROPE, bevel: 0.02, offset: { y: 1.6 } }),
      bevelBox({ w: 0.3, h: 0.16, d: 0.3, color: "#3a2a18", bevel: 0.04, offset: { y: 1.96 } })
    );
    geo.flameY = 2.2;
    return geo;
  });
  const torchFlame = cached(() => noShadow(box({ w: 0.28, h: 0.3, d: 0.28, color: "#ffb13b", emissive: 1 })));

  // The hub's approved cartoon palm: segmented flaring trunk and V-folded notched fronds.
  const palm = (i) => BL.dressing.palm(i);
  // Rounded cartoon boulders: two or three squat smooth stones leaning together, a cushion of weed or moss on top.
  const stoneHeap = (seed, size, hex, dark, cap, capH = 0.2) => {
    const g = soft(), rand = mulberry32(seed);
    lump(g, 0, size * 0.42, 0, size, size * 0.7, size * 0.85, hex, rand, 6, 11);
    lump(g, size * 0.75, size * 0.25, -size * 0.35, size * 0.55, size * 0.45, size * 0.5, dark, rand, 5, 9);
    lump(g, -size * 0.6, size * 0.2, size * 0.45, size * 0.42, size * 0.34, size * 0.4, hex, rand, 5, 9);
    if (cap) lump(g, -size * 0.1, size * (0.42 + 0.7 * 0.82), 0, size * 0.7, size * capH, size * 0.62, cap, rand, 4, 10);
    return g;
  };
  const lagoonRock = variants((i) => stoneHeap(600 + i, 0.95 + i * 0.3, "#8d857b", "#6f6860", "#6d8a3a", 0.14));
  // Dark basalt lumps with glowing seams of lava pressed into their cracks.
  const lavaRock = variants((i) => {
    const size = 0.7 + i * 0.3, g = stoneHeap(700 + i, size, "#2b2724", "#1c1917", null), rand = mulberry32(710 + i);
    const glow = g.faces.length;
    for (let k = 0; k < 4; k++) {
      const a = rand() * Math.PI * 2;
      lump(g, Math.cos(a) * size * 0.78, size * (0.35 + rand() * 0.35), Math.sin(a) * size * 0.66, size * 0.16, size * 0.07, size * 0.16, "#ff6a1e", rand, 3, 7);
    }
    for (let f = glow; f < g.faces.length; f++) g.faces[f].emissive = 1;
    return g;
  });
  const obsidianSpike = variants((i) => {
    const h = 2.4 + i * 1.2;
    return merge(
      box({ w: 0.9, h: 0.5, d: 0.9, color: "#1c1917", offset: { y: 0.25 } }),
      turn(lathe({ profile: [[0.5, 0.3], [0.32, h * 0.5], [0.12, h * 0.85], [0, h]], segments: 5, color: (t) => t < 0.4 ? "#2b2724" : "#3a3330" }), i * 0.7),
      box({ w: 0.12, h: h * 0.5, d: 0.12, color: "#ff6a1e", emissive: 1, offset: { x: 0.24, y: h * 0.35 } })
    );
  });
  // Old bones in the ash: two long bones with knobbed ends and a skull, all smooth.
  const bones = cached(() => {
    const g = soft(), rand = mulberry32(347), ivory = hexToRgb("#e8e2d2");
    for (const [x0, z0, x1, z1] of [[-0.24, -0.76, 0.24, 0.76], [0.1, 0.8, 0.9, -0.2]]) {
      limb(g, x0, 0.08, z0, x1, 0.08, z1, 0.07, 0.07, 7, ivory);
      for (const [x, z] of [[x0, z0], [x1, z1]]) for (const d of [-0.05, 0.05]) lump(g, x + d, 0.1, z - d, 0.09, 0.08, 0.09, "#efe9da", rand, 4, 7);
    }
    lump(g, -0.6, 0.3, -0.5, 0.42, 0.34, 0.38, "#e8e2d2", rand, 6, 10);
    for (const s of [-1, 1]) lump(g, -0.3, 0.34, -0.5 + s * 0.16, 0.08, 0.09, 0.07, "#2b2521", rand, 3, 7);
    return g;
  });
  const pine = variants((i) => {
    const rand = mulberry32(800 + i);
    const h = 3.6 + rand() * 1.8, parts = [box({ w: 0.36, h: h * 0.4, d: 0.36, color: "#4e361f", offset: { y: h * 0.2 } })];
    for (let t = 0; t < 4; t++) {
      const y = h * (0.24 + t * 0.19), r = 1.7 - t * 0.35;
      parts.push(moved(turn(lathe({ profile: [[r, 0], [r * 0.55, h * 0.1], [r * 0.15, h * 0.22], [0, h * 0.25]], segments: 8, color: (k) => k < 0.4 ? "#2f6b3a" : k < 0.7 ? "#3a7a44" : "#3f8248" }), t * 0.4), 0, y, 0));
      parts.push(moved(turn(lathe({ profile: [[r * 0.85, h * 0.04], [r * 0.4, h * 0.14], [0, h * 0.2]], segments: 8, color: (k) => k < 0.5 ? "#3f8248" : "#4d9455" }), t * 0.4 + 0.4), 0.15, y + 0.05, -0.1));
      parts.push(moved(turn(lathe({ profile: [[r * 0.6, h * 0.1], [r * 0.15, h * 0.22], [0, h * 0.255]], segments: 8, color: "#eef3f7" }), t * 0.4), 0, y + 0.02, 0));
    }
    return merge(...parts);
  });
  const crystal = variants((i) => {
    const colors = [["#79d8ff", "#b8ecff"], ["#c99bff", "#e6d0ff"], ["#8affc9", "#c8ffe6"]][i % 3];
    const h = 1.6 + i * 0.7;
    return merge(
      turn(lathe({ profile: [[0.36, 0], [0.42, h * 0.3], [0.18, h * 0.8], [0, h]], segments: 6, color: colors[0], emissive: 0.75 }), i * 0.9),
      moved(turn(lathe({ profile: [[0.2, 0], [0.24, h * 0.2], [0.1, h * 0.5], [0, h * 0.62]], segments: 5, color: colors[1], emissive: 0.85 }), i * 1.3, 0, 0.35), 0.4, 0, 0.2),
      moved(turn(lathe({ profile: [[0.16, 0], [0.2, h * 0.15], [0.08, h * 0.4], [0, h * 0.5]], segments: 5, color: colors[0], emissive: 0.75 }), i * 2.1, 0, -0.4), -0.35, 0, -0.25)
    );
  });
  const iceSpike = variants((i) => {
    const h = 1.2 + i * 0.6;
    return merge(
      turn(lathe({ profile: [[0.5, 0], [0.34, h * 0.4], [0.1, h * 0.85], [0, h]], segments: 5, color: (t) => t < 0.5 ? "#cfe6f5" : "#eef7fb" }), i * 0.8),
      moved(turn(lathe({ profile: [[0.3, 0], [0.18, h * 0.3], [0, h * 0.55]], segments: 5, color: "#dbeef8" }), i * 1.7), 0.4, 0, 0.3)
    );
  });
  const snowRock = variants((i) => stoneHeap(900 + i, 0.75 + i * 0.3, "#6f7c87", "#586470", "#eef3f7", 0.24));
  const stalactite = variants((i) => {
    const h = 2 + i * 1.3;
    return merge(
      turn(lathe({ profile: [[0.6, 0.2], [0.48, -h * 0.35], [0.2, -h * 0.75], [0, -h]], segments: 6, color: (t) => t < 0.5 ? "#3a3330" : "#4a413a" }), i * 0.9),
      moved(turn(lathe({ profile: [[0.3, 0.2], [0.22, -h * 0.25], [0, -h * 0.55]], segments: 5, color: "#2b2724" }), i * 1.6), 0.45, 0, 0.3)
    );
  });
  const rainDrop = cached(() => noShadow(box({ w: 0.025, h: 0.7, d: 0.025, color: "#c9d6e2", emissive: 0.35 })));
  const snowFlake = cached(() => noShadow(box({ w: 0.09, h: 0.09, d: 0.09, color: "#f6f9fb", emissive: 0.25 })));
  // Walkway module is one unit long along z, for tiling.
  const planks = cached(() => merge(
    ...Array.from({ length: 4 }, (_, n) => bevelBox({ w: 1, h: 0.12, d: 0.24, color: n % 2 ? "#8f6538" : "#9c7040", bevel: 0.035, offset: { y: -0.06, z: -0.375 + n * 0.25 } }))
  ));
  const buoy = cached(() => merge(
    lathe({ profile: [[0, 0], [0.4, 0.05], [0.45, 0.3], [0.3, 0.6], [0, 0.65]], segments: 8, color: (t) => t < 0.5 ? "#e04a3a" : "#f3efe4" }),
    bevelBox({ w: 0.1, h: 0.7, d: 0.1, color: "#3a2a18", bevel: 0.025, offset: { y: 0.95 } }),
    bevelBox({ w: 0.2, h: 0.2, d: 0.2, color: "#ffd27a", emissive: 1, bevel: 0.04, offset: { y: 1.35 } })
  ));
  const post = cached(() => merge(
    bevelBox({ w: 0.2, h: 1.4, d: 0.2, color: "#3a2a18", bevel: 0.045, offset: { y: 0.7 } }),
    bevelBox({ w: 0.32, h: 0.3, d: 0.32, color: "#e04a3a", bevel: 0.06, offset: { y: 1.5 } })
  ));

  BL.raceModels = { KART, GANTRY, gantryLampY, DINO_HIDES, kart, kartWheel, dino, gantry, gantryLamp, boostFlame, stalactite, rainDrop, snowFlake, boostPad, itemCrate, rockShot, peel, boulder, snowball, spectator, banner, torchStand, torchFlame, palm, lagoonRock, lavaRock, obsidianSpike, bones, pine, crystal, iceSpike, snowRock, planks, buoy, post, turn, yToX, yToZ };
})();
