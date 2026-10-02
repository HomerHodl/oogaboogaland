// ₿IFRÖST: the chamber of windows onto other worlds. A short tunnel from the island opens into a round hall of stone
// and bronze; the ₿ mechanism turns at its middle, and round the wall stand the windows, an open world's labelled
// over its arch. Travel is walking: an Ooga that walks through a window's field goes to that world (into the poker room
// at once, as its mirror back does), and one that walks into a window whose world is not open yet crosses its
// reflection and emerges from the next mirror. A window's frame glows brighter as someone comes near, in its world's
// colour, and the mechanism charges toward that colour too. Nobody but an Ooga crosses, so a visit without one only looks.
//
// Whoever walked in stays themselves: the Ooga the island handed over (`world.pilot`), or on a page that opens here,
// `character=`. From the island it comes in through the tunnel's field, from a world out of that world's window; on a
// page that opens here it stands at the tunnel's inner end. Walking back out through the field, Escape and the Leave
// button all take it back out to the island's gate.
//
// An open world's window shows that world itself: its models are built off the graph and photographed once a page (the
// poker room once for each cave theme it shows), in its own light, while the screen is dark, and the picture hangs at
// the end of the window's passage. Until then the window shows its row's stand-in.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, contributors, hud: hudMod, interact: interactMod, pilot: pilotMod, fx: fxMod } = BL;
  const BM = BL.bifrostModels, FM = BL.factoryModels;
  const { clamp } = math;
  const { createNode, addChild, removeChild, createCamera, stepTweens, tweenCount, traverseVisible } = BL.scene;
  const { HALL, ENTRY, WINDOW, WINDOW_TOP, CORE, WINDOWS, SLOTS, NAME, MIRROR_Z } = BM;

  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  const PITCH = [-0.2, 1.3], DIST = [3.5, 24];
  const FOLLOW = { y: 0.9, min: 3, max: 7, pitch: [0.25, 0.8] };
  const FLY = { speed: 5, perDist: 0.4, climb: 3, yMax: HALL.wall - 1 };
  // The field's blue, for the ripples on every field and the mirror.
  const TINT = [0.3, 0.62, 1];
  const view = (x, y, z, yaw, pitch, dist) => ({ yaw, pitch, dist, target: { x, y, z } });
  // A window's view stands between it and the mechanism, looking out at it.
  const toward = (i, dist = 10.5) => { const b = SLOTS[i], r = HALL.r - 0.6; return view(Math.sin(b) * r, 3.3, Math.cos(b) * r, b + Math.PI, 0.1, dist); };
  // `entrance` stands just inside the way in and looks across the mechanism at the far windows.
  const PRESETS = {
    entrance: view(0, 3.2, -2, 0, 0.12, 13),
    core: view(0, 3.4, 0, 0.5, 0.16, 9.5),
    dsb: toward(WINDOWS.findIndex((w) => w.id === "dsb")),
    poker: toward(WINDOWS.findIndex((w) => w.id === "poker")),
    // Low by the dais, looking up the beam through the open dome, the ringed giant beside it.
    sky: view(0, 7, 0, -0.3, -0.7, 7)
  };
  // Warm lamps inside, and over the open dome a clear night: the sky pass paints its gradient, its moon and its twinkling
  // stars (turned with the scene's own sky by `starMatrix`), and the moon lights the hall a little, cool. `sun` is the
  // sun's colour, which the stars' night hides.
  const MOON = [-0.45, 0.72, 0.53].map((v, i, a) => v / Math.hypot(...a));
  const RENDER_OPTS = {
    clear: [0.01, 0.012, 0.035], sky: [0.3, 0.3, 0.38], ground: [0.13, 0.11, 0.1],
    horizon: [0.07, 0.06, 0.18], zenith: [0.006, 0.008, 0.03], stars: 1, moon: { x: MOON[0], y: MOON[1], z: MOON[2] },
    starMatrix: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    light: { x: MOON[0], y: MOON[1], z: MOON[2] }, sun: [0.05, 0.05, 0.08], direct: [0.42, 0.5, 0.68], directStrength: 0.32, ambientFloor: 0.3,
    shadowCenter: { x: 0, y: 3, z: 0 }, shadowExtent: 18,
    lights: new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY * 8), lightCount: 0, bloomStrength: 0.8
  };
  // The mechanism charges as someone nears an open world's window: how fast it follows, the seconds between bursts, and
  // the sparkles a burst throws. Bands of light run up the beam: how many of its drums one band spans, how many bands
  // leave its foot a second at rest and fully charged, and the seconds a burst's surge takes to reach the sky and how
  // many drums it lights at once.
  const CHARGE_EASE = 2, BURST_GAP = [4.5, 1.6], BURST_FROM = 0.3;
  const BAND = 9, BAND_RATE = [0.3, 2.4], SURGE_TIME = 1.3, SURGE_WIDTH = 2.5;
  const SPARKLES = ["#ffc83a", "#fff2b8", "#7fe0ff", "#ffffff"].map((c) => models.particleGeometry(c, 0.1, 1));
  // A burst charged toward an open world's window throws that world's sparkles instead: its colour, paler, warmed toward
  // gold, and white. Cached by colour.
  const sparkleSets = new Map();
  const sparklesOf = (tint) => {
    if (!sparkleSets.has(tint)) sparkleSets.set(tint, [tint, BM.blend(tint, "#ffffff", 0.45), BM.blend(tint, "#ffc83a", 0.3), "#ffffff"].map((c) => models.particleGeometry(c, 0.1, 1)));
    return sparkleSets.get(tint);
  };
  // How fast the heavens turn (radians a second: a turn in a little over an hour), how long a shooting star lasts, and
  // how long between them.
  const SKY_TURN = 0.0015, METEOR_LIFE = 0.8, METEOR_GAP = [3, 9];
  // Tooltip and tap words; a window's tooltip is its world's name and the first.
  const TIPS = {
    core: ["₿IFRÖST · the mechanism", "The heart of ₿IFRÖST. It turns for now; one day it may do more."],
    exit: ["The way out", "Back to the island."],
    travel: ["walk through to travel", "Walk an Ooga through the field to go there."],
    mirror: ["Linked mirror · walk through", "Walk through the glass to come out of the next mirror in the chamber."]
  };
  // How the ₿'s rings turn, radians a second, and how each is tipped.
  const TAU = Math.PI * 2;
  const RING_SPIN = [0.5, -0.35, 0.25], RING_TILT = [[Math.PI / 2, 0], [1.1, 0.5], [0.4, -0.9]];
  const MIRROR_ROTATION = math.quat.create();
  // How many times, half a second apart, a page that opens here tries to photograph the open worlds.
  const PICTURE_TRIES = 10;
  // How far past the way in's field the island's picture of the islet hangs, square to the tunnel, as the Lightning
  // Factory hangs its own: far enough that it lines up with the islet seen through the field from anywhere in the hall.
  const OUTSIDE_DISTANCE = 34;
  // The open world's window brightens as someone comes near, so visitors know where to go: fully by `NEAR` metres from
  // its face, from nothing at `FAR`, how fast it follows, and how much brighter its frame gets (its glow's emissive is
  // 0.35, so 1.9 brings it to full) while it climbs its rim's steps.
  const NEAR = 1.4, FAR = 7.5, EASE = 5, BRIGHTEN = 1.9;
  const BACK = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0.3, dist: 3.4 };
  // In from the island's gate: a few steps inside the field, walking on down the tunnel toward the mechanism, the camera
  // just inside the field behind it.
  const GATE = { position: { x: 0, y: 0, z: ENTRY.field - 3 }, target: { x: 0, y: 1, z: ENTRY.field - 3 }, yaw: 0, pitch: 0.16, dist: 2.7 };
  // Each open world's picture, by scene: its models built off the graph (`build`, given the world's looks) and seen from
  // `eye` toward `look`, `up` the tangent of half the view's height, in that world's own light (`opts`), then given back
  // the saturation the page's grade adds again (`colour`) and misted a little toward the field's blue. DSB Land is seen
  // from above its falls, down over the turtle to the far stars, in DSB's light (scene-dsb.js: `RENDER`, and the two
  // lamps `buildLand` hangs); the poker room from over the aisle by its mirror, as its own view arrives, down between its
  // tables in the cave theme the looks name, under its tables' lamps and its room lights (scene-poker.js lights it so).
  const DSB_LIGHT = {
    clear: [0.025, 0.014, 0.06], horizon: [0.11, 0.04, 0.19], zenith: [0.008, 0.006, 0.025], sky: [0.52, 0.43, 0.7], ground: [0.26, 0.17, 0.32],
    sun: [0.8, 0.7, 0.9], light: { x: -0.4, y: 0.8, z: 0.4 }, stars: 1, shadowCenter: { x: 0, y: 0, z: 0 }, shadowExtent: 48, bloomStrength: 0.5,
    lights: new Float32Array(80), lightCount: 2
  };
  DSB_LIGHT.lights.set([-24, 5, -15, 14, 0.8, 0.25, 1, 0, -12, 5, -15, 14, 1, 0.8, 0.2, 0]);
  const POKER_LIGHT = {
    clear: [0.1, 0.12, 0.09], sky: null, ground: null, direct: null, directStrength: 0.38, ambientFloor: 0.48, sun: { x: 0.2, y: 1, z: 0.3 },
    shadowCenter: { x: 0, y: 1.5, z: 0 }, shadowExtent: 35, bloomStrength: 0.24, lights: new Float32Array(13 * 8), lightCount: 13
  };
  const pokerLight = (theme) => {
    POKER_LIGHT.sky = theme.sky; POKER_LIGHT.ground = theme.ground; POKER_LIGHT.direct = theme.direct; POKER_LIGHT.ambientFloor = theme.ambient;
    BL.pokerModels.TABLES.forEach((p, i) => POKER_LIGHT.lights.set([p.x, 5.1, p.z, 14, ...theme.tableLight, 0], i * 8));
    for (let i = 0; i < 3; i++) POKER_LIGHT.lights.set([0, 6.15, (i - 1) * 24, 13, ...theme.roomLight, 0], (10 + i) * 8);
    return POKER_LIGHT;
  };
  const SHOTS = {
    dsb: {
      width: 360, up: 0.36, eye: { x: 0, y: 40, z: 84 }, look: { x: 0, y: -3, z: 0 }, colour: 0.83, mist: 0.08, haze: [70, 120, 235],
      build: () => BL.dsbModels.build().root, opts: () => DSB_LIGHT
    },
    poker: {
      width: 360, up: 0.42, eye: { x: 0, y: 8.2, z: 33 }, look: { x: 0, y: 1.2, z: 6 }, colour: 0.83, mist: 0.05, haze: [70, 120, 235],
      build: (look) => BL.pokerModels.build(look.theme.id).root, opts: (look) => pokerLight(look.theme)
    }
  };

  let renderer, canvas, game, world, go, root, camera, hud, hooks, input, pilot, fx, agentPlay = null;
  let people = null, avatar = null, playerWorld = null, scene = null, leaving = false, dust = null, pictureTries = 0, pictureWait = 0;
  const targets = [];

  // One picture of each open world for the page, kept on `world.windowViews` by its looks' key (DSB Land's as `dsb`).
  // Built from the world's own models off the graph, drawn once into the scene canvas and read straight back, as the
  // island photographs itself for the Lightning Factory: the frame is never shown, since the scene draws over it before
  // the browser presents. The models' GPU records are released at once, so nothing of them stays behind.
  // The renderer can take a picture once its programs are ready and the canvas has a size: a hidden page's has none.
  const canPicture = () => renderer.ready && canvas.clientWidth > 0 && canvas.clientHeight > 0;
  const takePicture = (look, P) => {
    const views = world.windowViews || (world.windowViews = {});
    if (views[look.key]) return true;
    if (!canPicture()) return false;
    const pic = BM.passage().picture, W = canvas.width, H = canvas.height, aspect = W / H;
    const across = P.up * pic.w / pic.h, t = Math.max(P.up, across / aspect);
    const shot = createCamera({ fov: 2 * Math.atan(t) * 180 / Math.PI, near: 0.5, far: 260 });
    Object.assign(shot.position, P.eye);
    Object.assign(shot.target, P.look);
    const land = P.build(look), drawn = renderer.render(land, shot, P.opts(look));
    const release = (node) => {
      if (node.geometry) renderer.releaseGeometry(node.geometry);
      for (const child of node.children) release(child);
    };
    if (!drawn) {
      release(land);
      return false;
    }
    let src = canvas, sx = W / 2 * (1 - across / (t * aspect)), sy = H / 2 * (1 - P.up / t), sw = W - 2 * sx, sh = H * P.up / t;
    const w = P.width, h = Math.round(w * pic.h / pic.w);
    while (sw > w * 2) {
      const half = document.createElement("canvas");
      half.width = Math.ceil(sw / 2); half.height = Math.ceil(sh / 2);
      half.getContext("2d").drawImage(src, sx, sy, sw, sh, 0, 0, half.width, half.height);
      src = half; sx = sy = 0; sw = half.width; sh = half.height;
    }
    const out = document.createElement("canvas"), g = out.getContext("2d", { willReadFrequently: true });
    out.width = w; out.height = h;
    g.imageSmoothingQuality = "high";
    g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    release(land);
    // The page grades what it draws, so a picture of a graded frame is graded twice: take back the saturation the
    // grade adds (WebGL only; Canvas 2D has no grade), and mist it toward the field's blue.
    const colour = renderer.kind === "webgl2" ? P.colour : 1, pixels = g.getImageData(0, 0, w, h), d = pixels.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      for (let k = 0; k < 3; k++) d[i + k] = (l + (d[i + k] - l) * colour) * (1 - P.mist) + P.haze[k] * P.mist;
    }
    g.putImageData(pixels, 0, 0);
    const image = new Image();
    image.src = out.toDataURL("image/jpeg", 0.9);
    views[look.key] = { width: w, height: h, load: () => image };
    return true;
  };
  // The open worlds of a visit, each row with its looks now, read once so the windows and their pictures agree.
  const openLooks = () => WINDOWS.filter((row) => row.kind === "travel" && BL.scenes[row.scene]).map((row) => ({ row, look: BM.lookOf(row) }));
  // Every open world's picture; true once they all exist.
  const takePictures = (looks) => {
    let all = true;
    for (const { row, look } of looks) if (!takePicture(look, SHOTS[row.scene])) all = false;
    return all;
  };
  // A travel window's picture: its world's photograph once there is one, the stand-in until then.
  const hangPicture = (w) => {
    if (w.picture.owned) return;
    const asset = world.windowViews && world.windowViews[w.look.key];
    if (asset) {
      w.picture.geometry = BM.pictureQuad(asset, BM.passage().picture);
      w.picture.owned = true;
    } else {
      w.picture.geometry = BM.standIn(w.look.stand);
    }
  };

  // Back out to the island's gate, as the same Ooga.
  const leaveChamber = () => {
    if (leaving) return;
    world.pilot = avatar ? avatar.traits.name : null;
    leaving = go("hub");
  };
  // Through a window to its world, as the same Ooga, once a transition is free to start.
  const travel = (w) => {
    if (leaving) return;
    world.pilot = avatar.traits.name;
    if (!go(w.row.scene, null, !!w.row.instant)) return;
    leaving = true;
    pilot.setActive(false);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      leaveChamber();
      return true;
    }
    return false;
  };
  const onDonation = (donation) => {
    game.recordDonation(donation);
    world.level = Math.min(BL.pile.MAX_BANANAS, world.level + BL.game.bananasFor(donation.sats));
  };
  const onLootCleared = () => {};

  // The chamber for a visit: the hall, the mechanism and the tunnel from the cached builds, then each window by the
  // kind its row resolves to now: a travel window whose world is not open is a mirror instead.
  const build = (looks) => {
    const s = { windows: [], kinds: [], rings: [], looks, lead: null, step: 0 };
    const hall = BM.hall(), pillars = BM.pillars(), tunnel = BM.tunnel(), field = BM.entryField(), name = BM.name(), base = BM.coreBase(), lit = BM.lighting();
    const outside = world.bifrostView;
    s.core = createNode({ geometry: base.stone });
    addChild(root,
      createNode({ geometry: hall.walls }), createNode({ geometry: hall.dome }), createNode({ geometry: hall.floor, depthBias: 1.2 }), createNode({ geometry: hall.inlay, depthBias: 0.4, sightHidden: true }),
      createNode({ geometry: pillars.stone }), createNode({ geometry: pillars.banners }),
      createNode({ geometry: tunnel.stone }), createNode({ geometry: tunnel.banners }), createNode({ geometry: tunnel.glow, sightHidden: true }),
      // Past the field: the picture of the islet the island took on the way in, or with no visit from the island, the
      // rock that closes the tunnel.
      outside ? createNode({ geometry: BL.factoryModels.outsideView(outside, OUTSIDE_DISTANCE), position: { x: 0, y: 0, z: ENTRY.field + OUTSIDE_DISTANCE }, rotation: { x: 0, y: Math.PI, z: 0 }, sightHidden: true })
        : createNode({ geometry: tunnel.closer }),
      s.core, createNode({ geometry: base.glow, sightHidden: true }),
      createNode({ geometry: lit.frame }), createNode({ geometry: lit.glass, sightHidden: true }),
      ...BL.dressing.nodes(BM.dressing(), { glow: 1 })
    );
    // The way in: its arch on the hall's side, and the name over it, held out from the wall.
    s.mouth = createNode({ position: { x: 0, y: 0, z: HALL.r }, geometry: tunnel.mouth });
    const nameNode = createNode({ position: { x: 0, y: NAME.y, z: HALL.r - NAME.out }, rotation: { x: 0, y: Math.PI, z: 0 } });
    addChild(nameNode, createNode({ geometry: name.plaque, depthBias: 1.5 }), createNode({ geometry: name.letters }));
    addChild(root, s.mouth, nameNode);
    // The court's lamp posts, the benches, and the bushes: in planters flanking the windows and on the pilasters.
    addChild(root, createNode({ geometry: BM.courtPosts() }));
    for (const a of BM.BENCHES) addChild(root, createNode({ position: { x: Math.sin(a) * BM.BENCH_R, y: 0, z: Math.cos(a) * BM.BENCH_R }, rotation: { x: 0, y: a, z: 0 }, geometry: BM.bench() }));
    BM.PLANTERS.forEach((a, k) => {
      const x = Math.sin(a) * BM.PLANTER_R, z = Math.cos(a) * BM.PLANTER_R;
      addChild(root, createNode({ position: { x, y: 0, z }, rotation: { x: 0, y: a, z: 0 }, geometry: BM.planter() }), createNode({ position: { x, y: BM.PLANTER_TOP, z }, rotation: { x: 0, y: k * 1.3, z: 0 }, geometry: BL.hubModels.bush(k % 3), sightHidden: true }));
    });
    BM.PILLARS.forEach((b, k) => addChild(root, createNode({ position: { x: Math.sin(b) * BM.PILLAR_R, y: HALL.wall, z: Math.cos(b) * BM.PILLAR_R }, rotation: { x: 0, y: k * 2.1, z: 0 }, scale: { x: 0.85, y: 0.85, z: 0.85 }, geometry: BL.hubModels.bush((k + 1) % 3), sightHidden: true })));
    // The mechanism: the ₿ turning over the plinth inside its three rings, and the beam up into the sky.
    s.glyph = createNode({ position: { x: 0, y: CORE.glyphY, z: 0 }, geometry: BM.coreGlyph() });
    const beam = BM.coreBeam();
    s.beam = beam.rows.map((row) => ({ node: createNode({ position: { x: 0, y: row.y, z: 0 }, scale: { x: row.r, y: row.h, z: row.r }, geometry: beam.geometry, sightHidden: true }), r: row.r }));
    BM.coreRings().forEach((geometry, i) => {
      const spin = createNode({ position: { x: 0, y: CORE.glyphY, z: 0 } });
      addChild(spin, createNode({ rotation: { x: RING_TILT[i][0], y: 0, z: RING_TILT[i][1] }, geometry }));
      s.rings.push(spin);
    });
    addChild(root, s.glyph, ...s.beam.map((b) => b.node), ...s.rings);
    // The mechanism's charge, the bands running up its beam and a burst's surge (1 when none is climbing), and its two
    // shockwaves: one round the ₿, one across the floor.
    s.charge = 0; s.flare = 0; s.burstWait = BURST_GAP[0]; s.bob = 0; s.flow = 0; s.surge = 1; s.stepLead = null;
    s.shocks = [[CORE.glyphY, 5], [0.03, 9]].map(([y, reach]) => {
      const node = createNode({ position: { x: 0, y, z: 0 }, geometry: BM.shockwave(), visible: false, sightHidden: true });
      addChild(root, node);
      return { node, t: 1, reach };
    });
    // The sky over the open dome, lighter on Canvas 2D: stars, the galaxy's band, the planets and the shooting stars
    // waiting their turn, all on one node that turns the heavens.
    const night = BM.sky(renderer.kind === "canvas2d" ? 1 : 0);
    s.sky = createNode();
    addChild(s.sky, createNode({ geometry: night.stars, sightHidden: true }), createNode({ geometry: night.band, sightHidden: true }));
    for (const p of night.planets) addChild(s.sky, createNode({ position: { x: p.at.x, y: p.at.y, z: p.at.z }, geometry: p.geometry, sightHidden: true }));
    s.meteors = night.meteors.map((m) => {
      const node = createNode({ geometry: m.geometry, visible: false, sightHidden: true });
      addChild(s.sky, node);
      return { node, dir: m.dir, len: m.len, t: 1 };
    });
    s.meteorWait = METEOR_GAP[0];
    addChild(root, s.sky);
    // The field at the tunnel's far end, facing back in: the sheet (a veil the islet shows through, with its picture
    // past it), its sparkles, and the ripples.
    const fieldGroup = createNode({ position: { x: 0, y: 0, z: ENTRY.field }, rotation: { x: 0, y: Math.PI, z: 0 } });
    const sparkles = createNode({ geometry: field.sparkles, sightHidden: true });
    if (outside) addChild(fieldGroup, createNode({ geometry: field.veil, sightHidden: true }), createNode({ geometry: field.rim, sightHidden: true }), sparkles);
    else addChild(fieldGroup, createNode({ geometry: field.sheet, sightHidden: true }), sparkles);
    addChild(root, fieldGroup);
    const opening = { minX: -ENTRY.halfW, maxX: ENTRY.halfW, floorY: 0, ceilingY: ENTRY.spring + ENTRY.halfW };
    s.gate = { hum: 0, opening, phase: BL.labPhase.create(fieldGroup, { x: 0, z: ENTRY.field, ry: Math.PI, floorY: 0, room: { w: 2 * ENTRY.halfW, h: opening.ceilingY, from: 0, to: 2 } }, opening, 0.08, TINT) };
    // The windows: each its frame and its glow, then what fills it by kind. A travel window whose
    // world is not open is a mirror instead.
    const winOpening = { minX: -WINDOW.halfW, maxX: WINDOW.halfW, floorY: 0, ceilingY: WINDOW_TOP };
    WINDOWS.forEach((row, i) => {
      const f = BM.frameOf(i), open = looks.find((o) => o.row === row), kind = open ? "travel" : "mirror";
      const node = createNode({ position: { x: f.x, y: 0, z: f.z }, rotation: { x: 0, y: f.ry, z: 0 } }), stone = createNode({ geometry: BM.archStone() });
      const neon = createNode({ geometry: BM.archGlow(), sightHidden: true });
      addChild(node, stone, neon);
      if (kind === "travel") {
        const label = FM.label(row.label, "", { height: 1.1 }), board = createNode({ position: { x: 0, y: WINDOW_TOP + BM.FRAME.band + 1.15, z: BM.FRAME.front + 0.2 } });
        addChild(board, createNode({ geometry: BM.hanger(label.width, 1.35, BM.FRAME.front + 0.2) }), createNode({ geometry: label.back }), createNode({ geometry: label.face }));
        addChild(node, board);
      }
      addChild(root, node);
      const w = { row, kind, look: open ? open.look : null, node, neon, ribs: null, rim: null, rims: null, tint: null, charge: null, sparkles: null, sn: Math.sin(f.bearing), c: Math.cos(f.bearing), phase: null, body: null, face: null, picture: null, light: -1, near: 0, hum: Math.random() * 0.3, transform: null, yaw: 0, crossings: 0 };
      if (kind === "travel") {
        const passage = BM.passage(), tint = w.look.tint;
        w.rims = Array.from({ length: BM.RIM_STEPS }, (_, k) => BM.portalRim(tint, k));
        w.rim = createNode({ geometry: w.rims[0], sightHidden: true });
        w.tint = math.hexToRgb(tint).map((v) => v / 255);
        w.charge = BM.charged(tint);
        w.sparkles = sparklesOf(tint);
        addChild(node, w.rim);
        w.picture = createNode({ sightHidden: true });
        w.ribs = createNode({ geometry: passage.glow, sightHidden: true });
        addChild(node, createNode({ geometry: passage.walls }), w.ribs, w.picture);
        w.phase = BL.labPhase.create(node, { x: f.x, z: f.z, ry: f.ry, floorY: 0, room: { w: 2 * WINDOW.halfW, h: WINDOW_TOP, from: 0, to: WINDOW.depth } }, winOpening, -WINDOW.plane, TINT);
        hangPicture(w);
      } else {
        const m = BM.mirror(i);
        addChild(node, createNode({ geometry: m.backing }));
        w.phase = BL.labPhase.create(node, { x: f.x, z: f.z, ry: f.ry, floorY: 0, room: { w: 2 * WINDOW.halfW, h: WINDOW_TOP, from: 0, to: 1 } }, winOpening, -MIRROR_Z, TINT);
        // The glass takes the field's ripples, so the blue waves run over the reflection; the field's own plane only
        // keeps them.
        w.face = createNode({ geometry: m.glass, position: { x: 0, y: 0, z: -MIRROR_Z }, rippleTint: TINT, sightHidden: true });
        w.face.mirrorRipples = w.phase.ripples;
        w.phase.node.visible = false;
        addChild(node, w.face);
      }
      // A reflective face owns its contact atlas; the hidden ripple field
      // cannot sample contacts. Travel fields use their existing atlas.
      w.body = w.face ? BL.mirrorBody.create(w.face, new Map()) : w.phase.body;
      w.tip = kind === "travel" ? `${row.name} · ${TIPS.travel[0]}` : TIPS.mirror[0];
      s.windows.push(w);
      s.kinds.push(kind);
      input.add(stone, { kind: "window", window: w }, { radius: 3 });
      targets.push(stone);
    });
    // Closed-world mirrors form a loop. One rigid transform per doorway
    // preserves its local crossing point and turns inward travel into an exit.
    const mirrors = s.windows.filter((w) => w.kind === "mirror");
    for (let i = 0; i < mirrors.length; i++) {
      const w = mirrors[i], other = mirrors[(i + 1) % mirrors.length];
      const yaw = other.node.rotation.y - w.node.rotation.y + Math.PI, c = Math.cos(yaw), sn = Math.sin(yaw);
      const r = HALL.r + MIRROR_Z, x = w.sn * r, z = w.c * r, m = math.mat4.create();
      m[0] = m[10] = c; m[2] = -sn; m[8] = sn;
      m[12] = other.sn * r - x * c - z * sn;
      m[14] = other.c * r + x * sn - z * c;
      w.transform = m; w.yaw = yaw;
    }
    input.add(s.core, { kind: "core" }, { radius: 3.2 });
    targets.push(s.core);
    input.add(s.mouth, { kind: "exit" }, { radius: 3 });
    targets.push(s.mouth);
    return s;
  };

  // Point lights, most important first so the lowest tier keeps them: the mechanism and the crown over it, the field
  // at the way out, then each window, mirrors too; the lanterns share what is left, each flickering like a flame.
  const LANTERN_GLOW = [1.3, 0.8, 0.36], LANTERN_REACH = 7.5, WINDOW_GLOW = [0.4, 0.65, 1], CORE_GLOW = [0.85, 0.55, 0.22];
  let fixedLights = 0;
  const lamp = (i, x, y, z, radius, r, g, b) => {
    const o = i * 8, l = RENDER_OPTS.lights;
    l[o] = x; l[o + 1] = y; l[o + 2] = z; l[o + 3] = radius; l[o + 4] = r; l[o + 5] = g; l[o + 6] = b; l[o + 7] = 0;
  };
  const lightUp = (s) => {
    let n = 0;
    lamp(n++, 0, CORE.glyphY, 0, 13, ...CORE_GLOW);
    lamp(n++, 0, HALL.apex - 2.5, 0, 12, 1, 0.85, 0.55);
    lamp(n++, 0, 2.2, ENTRY.field - 1.2, 8, 0.35, 0.6, 1);
    // Each window's light starts at rest in the field's blue; an open world's takes its own tint each frame.
    for (const w of s.windows) {
      w.light = n;
      lamp(n++, w.node.position.x - w.sn * 1.6, 2.4, w.node.position.z - w.c * 1.6, 7, WINDOW_GLOW[0] * 0.5, WINDOW_GLOW[1] * 0.5, WINDOW_GLOW[2] * 0.5);
    }
    fixedLights = n;
    const hung = BM.lighting().lights;
    for (let i = 0; i < hung.length && n < BL.glRenderer.POINT_LIGHT_CAPACITY; i += 4) lamp(n++, hung[i], hung[i + 1], hung[i + 2], LANTERN_REACH, ...LANTERN_GLOW);
    RENDER_OPTS.lightCount = n;
  };

  const groundFor = (x, z) => BM.supportAt(x, z);
  const walkableFor = (ax, az, bx, bz, y, height, actor) => BM.walkable(ax, az, bx, bz, actor.bodyRadius || 0.35, scene.kinds);

  const enter = (ctx) => {
    ({ renderer, game, world, go, agentPlay } = ctx);
    canvas = ctx.canvas;
    // The picture comes first: rendering it moves the renderer's view, which the scene's own first frame puts back.
    // A page that opens here takes it on its first frame instead, once the renderer is ready and the build that sets
    // the page's quality tier is done.
    const looks = openLooks(), pictured = ctx.from !== null && takePictures(looks);
    pictureTries = pictured ? 0 : PICTURE_TRIES;
    pictureWait = 0;
    camera = createCamera({ fov: 55, near: 0.3, far: 700 });
    root = createNode();
    hud = hudMod.create({ roster: contributors.activeRoster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled: ctx.lootEnabled });
    if (window.matchMedia("(max-width: 720px), (max-height: 500px)").matches) hud.el.sheet.dataset.open = "false";
    hooks = {};
    input = interactMod.create({ canvas, renderer, camera, hooks });
    const inTunnel = (p) => p.z > HALL.r - 1.5 && Math.abs(p.x) < ENTRY.halfW;
    const clampTarget = (p) => {
      p.y = clamp(p.y, 0.5, HALL.wall - 1);
      if (inTunnel(p)) {
        p.x = clamp(p.x, -ENTRY.halfW + 0.6, ENTRY.halfW - 0.6);
        p.y = Math.min(p.y, ENTRY.spring + 1);
        p.z = Math.min(p.z, ENTRY.field - 0.8);
        return;
      }
      const r = Math.hypot(p.x, p.z), max = HALL.r - 2;
      if (r > max) { p.x *= max / r; p.z *= max / r; }
    };
    // In the hall the eye keeps inside the windows' frames and under the dome; only the tunnel lets it out along +z.
    const clampCamera = (p) => {
      p.y = clamp(p.y, 0.5, HALL.wall + 2);
      if (inTunnel(p)) {
        p.x = clamp(p.x, -ENTRY.halfW + 0.4, ENTRY.halfW - 0.4);
        p.y = Math.min(p.y, ENTRY.spring + ENTRY.halfW - 0.4);
        p.z = Math.min(p.z, ENTRY.field - 0.3);
        return;
      }
      const r = Math.hypot(p.x, p.z), max = HALL.r - BM.FRAME.front - 0.2 - Math.max(0, p.y - HALL.wall) * 1.4;
      if (r > max) { p.x *= max / r; p.z *= max / r; }
    };
    pilot = pilotMod.create({
      renderer, canvas, camera, hud, presets: PRESETS, landing: "entrance", pitch: PITCH, dist: DIST,
      follow: FOLLOW, fly: FLY, clampTarget, clampCamera, ceilingAt: () => HALL.wall + 2, coarse: COARSE,
      close: { eyeHeight: 1.1, eyeRatio: 0.95, eyeForward: 0.16, pitch: [-1.35, 1.35], trailingDist: 4, orbitDist: 5, maxStep: 0.6, groundAt: groundFor }
    });
    const tipFor = (hit) => {
      const o = hit.owner;
      if (o.kind === "window") return o.window.tip;
      return TIPS[o.kind] ? TIPS[o.kind][0] : "";
    };
    Object.assign(hooks, {
      onHover: (hit, p) => {
        if (hit) hud.tooltip.show(tipFor(hit), p.x, p.y);
        else hud.tooltip.hide();
      },
      onHoverMove: (hit, p) => hud.tooltip.show(tipFor(hit), p.x, p.y),
      onTap: (hit) => {
        if (!hit) return;
        const o = hit.owner;
        if (o.kind === "exit") return leaveChamber();
        if (o.kind === "window") {
          const w = o.window;
          if (PRESETS[w.row.id]) pilot.goPreset(w.row.id);
          return hud.toast(w.kind === "travel" && !avatar ? "Only an Ooga can cross. Walk one in from the island." : TIPS[w.kind][1]);
        }
        if (o.kind === "core") {
          pilot.goPreset("core");
          hud.toast(TIPS.core[1]);
        }
      },
      ...pilot.hooks
    });
    hud.onPreset(pilot.goPreset);
    hud.onAction((action) => {
      if (action === "leave") leaveChamber();
      else if (action === "reset-view") pilot.goPreset("entrance");
    });
    fx = fxMod.create({ root, input, hooks, hud, game, world, renderer, camera, overlay: ctx.overlay, tickerAt: { x: 0, y: 7, z: 0 } });
    dust = BL.dressing.motes({ count: 160, span: 14, low: 0.5, high: 9 });
    addChild(root, dust.node);
    scene = build(looks);
    // The visitor's Ooga: `character=` on a page that opens here, else the one handed over, else a free view.
    const asked = ctx.from === null ? new URLSearchParams(location.search).get("character")?.trim().toLowerCase() : null;
    const named = asked ? contributors.roster.find((c) => c.name.toLowerCase() === asked) : null;
    const playerName = named ? named.name : world.pilot && contributors.roster.some((c) => c.name === world.pilot) ? world.pilot : null;
    world.pilot = null;
    if (playerName) {
      playerWorld = { level: 0, weapons: new Map(), magazine: { owned: false, count: 0, ammo: 0, carrier: null } };
      const shared = { root, input, hud, game, world: playerWorld, playerName, fx, viewYaw: 0, groundAt: groundFor, walkable: walkableFor };
      people = shared.crew = BL.crew.create(shared);
      pilot.bind(shared);
      avatar = people.cavemen.get(playerName);
      Object.assign(avatar.root.position, { x: 0, y: avatar.baseY, z: HALL.r - 1.6 });
      avatar.root.rotation.y = Math.PI;
      pilot.possess(avatar);
      scene.gate.phase.body.track(avatar.root, avatar.traits.height * 2, Math.max(avatar.headOpen.verts.length, avatar.headClosed.verts.length));
      for (const w of scene.windows) w.body.track(avatar.root, avatar.traits.height * 2, Math.max(avatar.headOpen.verts.length, avatar.headClosed.verts.length));
      // Back from a world, out of its window: standing in front of it, facing the mechanism. In from the island: through
      // the field at the tunnel's end.
      const from = scene.windows.find((w) => w.kind === "travel" && w.row.scene === ctx.from);
      if (from) standBefore(from, 2.8);
      else if (ctx.from === "hub") pilot.navigate(GATE);
    }
    lightUp(scene);
    leaving = false;

    bifrostScene.root = root;
    bifrostScene.camera = camera;
    bifrostScene.input = input;
    bifrostScene.debug = {
      hud, camera, controls: pilot.controls, pilot, crew: people, cavemen: people ? people.cavemen : null,
      bifrost: { get scene() { return scene; }, get avatar() { return avatar; }, get pictured() { return !!(world.windowViews && world.windowViews.dsb); }, get outside() { return !!world.bifrostView; } }
    };
  };

  // Stands the Ooga `out` metres in from a window's face, facing the mechanism, with the camera behind it.
  const standBefore = (w, out) => {
    const d = HALL.r - out, x = w.sn * d, z = w.c * d;
    BACK.position.x = x; BACK.position.y = 0; BACK.position.z = z;
    BACK.target.x = x; BACK.target.y = 1; BACK.target.z = z;
    BACK.yaw = Math.atan2(w.sn, w.c);
    pilot.navigate(BACK);
  };
  // Where the Ooga stands against a window: how far past the wall's face (`along`) and how far across its opening.
  const AT = { along: 0, across: 0 };
  const against = (w, p) => {
    const radial = p.x * w.sn + p.z * w.c;
    AT.along = radial - HALL.r;
    AT.across = p.x * w.c - p.z * w.sn;
    return AT;
  };
  // Cross the glass itself, retaining the step's overshoot. The emerging
  // character is inside the destination plane, so holding forward cannot
  // immediately send them through it again.
  const windowsFrame = (previousX, previousY, previousZ) => {
    if (people.player !== avatar) return;
    const p = avatar.root.position, feet = p.y - avatar.baseY;
    for (let i = 0; i < scene.windows.length; i++) {
      const w = scene.windows[i], at = against(w, p);
      if (Math.abs(at.across) > WINDOW.halfW) continue;
      if (w.kind === "travel") {
        if (feet <= 0.6 && at.along > WINDOW.plane) { travel(w); return; }
      } else {
        const from = previousX * w.sn + previousZ * w.c - HALL.r - MIRROR_Z, to = at.along - MIRROR_Z;
        if (from > 1e-7 || to < 0 || to - from < 1e-8) continue;
        const t = -from / (to - from), across = (previousX + (p.x - previousX) * t) * w.c - (previousZ + (p.z - previousZ) * t) * w.sn;
        const bottom = previousY + (p.y - previousY) * t - avatar.baseY;
        if (bottom < -0.12 || !BM.inArch(across, bottom + avatar.bodyHeight, WINDOW.halfW, WINDOW.spring)) continue;
        const m = w.transform, x = p.x, z = p.z, vx = avatar.leap.vx, vz = avatar.leap.vz;
        p.x = m[0] * x + m[8] * z + m[12]; p.z = m[2] * x + m[10] * z + m[14];
        avatar.root.rotation.y += w.yaw;
        if (avatar.root.quaternion) {
          math.quat.fromEuler(MIRROR_ROTATION, 0, w.yaw, 0);
          math.quat.multiply(avatar.root.quaternion, MIRROR_ROTATION, avatar.root.quaternion);
        }
        avatar.leap.vx = m[0] * vx + m[8] * vz; avatar.leap.vz = m[2] * vx + m[10] * vz;
        pilot.transformView(m, w.yaw);
        w.crossings++;
        return;
      }
    }
  };

  // The mechanism, charged by how near anyone stands to an open world's window: the ₿ spins faster and bobs, its rings
  // whirl, and the light in the beam flows upward, a slow shimmer at rest and a rush fully charged; and once it is
  // charged it bursts now and then, throwing sparkles, two shockwaves and a flare, and sending a surge up the beam.
  // Its light takes on the colour of the world it answers, the nearest open window's, kept while the charge ebbs: the
  // beam, the shockwaves, the sparkles and the core's light, from gold at rest to that colour fully charged. The ₿ and
  // its rings keep their gold and bronze.
  const mechanism = (s, dt, elapsed) => {
    let want = 0, lead = null;
    for (let i = 0; i < s.windows.length; i++) {
      const w = s.windows[i];
      if (w.kind === "travel" && w.near > want) { want = w.near; lead = w; }
    }
    const k = (s.charge += (want - s.charge) * Math.min(1, dt * CHARGE_EASE));
    if (lead) s.lead = lead;
    const step = s.lead ? Math.round(k * (BM.CHARGE_STEPS - 1)) : 0;
    if (step !== s.step || s.lead !== s.stepLead) {
      s.step = step;
      s.stepLead = s.lead;
      for (let i = 0; i < s.beam.length; i++) s.beam[i].node.geometry = s.lead.charge.beam[step];
    }
    s.glyph.rotation.y += dt * (0.6 + 5 * k);
    s.bob += dt * (1.5 + 4 * k);
    s.glyph.position.y = CORE.glyphY + Math.sin(s.bob) * 0.06 * (0.4 + k);
    s.glyph.scale.x = s.glyph.scale.y = s.glyph.scale.z = 1 + (0.04 * k + 0.12 * s.flare) * (1 + Math.sin(elapsed * 9));
    for (let i = 0; i < s.rings.length; i++) s.rings[i].rotation.y += dt * RING_SPIN[i] * (1 + 7 * k);
    // The beam: bands of light leave its foot and climb, lengthening and speeding up with its drums; they come faster,
    // deeper and brighter as the charge builds and swell the beam a little as they pass, and a surge outshines them all.
    s.flow += dt * (BAND_RATE[0] + (BAND_RATE[1] - BAND_RATE[0]) * k);
    s.surge = Math.min(1, s.surge + dt / SURGE_TIME);
    const depth = 0.25 + 0.35 * k, at = s.surge * (s.beam.length + 2 * SURGE_WIDTH) - SURGE_WIDTH;
    for (let i = 0; i < s.beam.length; i++) {
      const b = s.beam[i], u = 0.5 + 0.5 * Math.sin(TAU * (i / BAND - s.flow)), band = u * u * u, d = (i - at) / SURGE_WIDTH;
      const surge = s.surge < 1 ? Math.exp(-d * d) : 0;
      b.node.glow = (0.8 + 0.4 * k) * (1 - depth * (1 - band)) + surge;
      b.node.highlight = band * (0.1 + 0.7 * k) + 1.2 * surge;
      b.node.scale.x = b.node.scale.z = b.r * (1 + 0.35 * k + band * (0.04 + 0.16 * k) + 0.9 * surge);
    }
    // Bursts, once charged: sparkles, the shockwaves, a flare and a surge up the beam.
    s.flare = Math.max(0, s.flare - dt * 1.8);
    if (k > BURST_FROM) {
      s.burstWait -= dt;
      if (s.burstWait <= 0) {
        s.burstWait = BURST_GAP[0] + (BURST_GAP[1] - BURST_GAP[0]) * k + Math.random() * 1.2;
        fx.burst(0, CORE.glyphY, 0, Math.round(18 + 30 * k), s.lead ? s.lead.sparkles : SPARKLES, 4 + 4 * k);
        for (let i = 0; i < s.shocks.length; i++) {
          s.shocks[i].t = 0; s.shocks[i].node.visible = true;
          if (s.lead) s.shocks[i].node.geometry = s.lead.charge.shock[step];
        }
        s.flare = 1;
        s.surge = 0;
      }
    } else s.burstWait = Math.max(s.burstWait, BURST_GAP[1]);
    for (let i = 0; i < s.shocks.length; i++) {
      const w = s.shocks[i];
      if (w.t >= 1) continue;
      w.t = Math.min(1, w.t + dt / 0.9);
      const r = 0.6 + w.reach * (1 - (1 - w.t) * (1 - w.t));
      w.node.scale.x = w.node.scale.z = r;
      w.node.glow = 1.5 * (1 - w.t);
      w.node.smokeOpacity = Math.min(1, 3 * (1 - w.t));
      w.node.visible = w.t < 1;
    }
    // The core's light swells with the charge and flares with a burst, warming from gold toward the lead's colour.
    const L = RENDER_OPTS.lights, lift = 1 + 1.2 * k + 3 * s.flare, c = s.lead ? s.lead.tint : CORE_GLOW, m = s.lead ? k : 0;
    L[4] = (CORE_GLOW[0] + (c[0] - CORE_GLOW[0]) * m) * lift;
    L[5] = (CORE_GLOW[1] + (c[1] - CORE_GLOW[1]) * m) * lift;
    L[6] = (CORE_GLOW[2] + (c[2] - CORE_GLOW[2]) * m) * lift;
  };

  // The heavens turn slowly overhead, and the sky pass's stars with them, while the moon stays where the hall's light
  // comes from; now and then a shooting star streaks down its way and fades.
  const heavens = (s, dt) => {
    const a = (s.sky.rotation.y += dt * SKY_TURN), c = Math.cos(a), sn = Math.sin(a), M = RENDER_OPTS.starMatrix;
    M[0] = c; M[2] = sn; M[6] = -sn; M[8] = c;
    s.meteorWait -= dt;
    if (s.meteorWait <= 0) {
      s.meteorWait = METEOR_GAP[0] + Math.random() * (METEOR_GAP[1] - METEOR_GAP[0]);
      const m = s.meteors[Math.floor(Math.random() * s.meteors.length)];
      if (m.t >= 1) { m.t = 0; m.node.visible = true; }
    }
    for (let i = 0; i < s.meteors.length; i++) {
      const m = s.meteors[i];
      if (m.t >= 1) continue;
      m.t = Math.min(1, m.t + dt / METEOR_LIFE);
      const k = m.t * m.len;
      m.node.position.x = m.dir[0] * k; m.node.position.y = m.dir[1] * k; m.node.position.z = m.dir[2] * k;
      m.node.glow = 1.4 * (1 - m.t);
      m.node.smokeOpacity = Math.min(1, 3 * (1 - m.t));
      m.node.visible = m.t < 1;
    }
  };

  const update = (dt, elapsed) => {
    const s = scene;
    const previousX = avatar ? avatar.root.position.x : 0, previousY = avatar ? avatar.root.position.y : 0, previousZ = avatar ? avatar.root.position.z : 0;
    pilot.readInput(dt);
    if (people) people.update(dt, elapsed);
    pilot.update(dt);
    mechanism(s, dt, elapsed);
    heavens(s, dt);
    // The way out's field hums and shows the outline of whoever walks through it.
    const g = s.gate;
    g.phase.update(dt, elapsed);
    g.phase.body.update(dt);
    g.phase.body.time = g.phase.ripples.time;
    g.hum -= dt;
    if (g.hum <= 0) {
      g.hum = 0.12 + Math.random() * 0.25;
      g.phase.ripples.pulse(g.opening.minX + Math.random() * (g.opening.maxX - g.opening.minX), Math.random() * g.opening.ceilingY, 0);
    }
    // The open world's window alone answers whoever comes near (the Ooga, or with none, the view): its glow, its rim,
    // which breathes at rest and climbs to white-hot, its light and the light's reach, its passage's ribs and how often
    // its field ripples. The mirrors keep their look. Every field hums in the same blue.
    const who = avatar ? avatar.root.position : pilot.orbit.target, L = RENDER_OPTS.lights;
    for (let i = 0; i < s.windows.length; i++) {
      const w = s.windows[i];
      if (w.kind === "travel") {
        const at = against(w, who), d = Math.hypot(Math.max(0, -at.along), Math.max(0, Math.abs(at.across) - WINDOW.halfW));
        const want = clamp((FAR - d) / (FAR - NEAR), 0, 1), k = want * want * (3 - 2 * want), o = w.light * 8, power = 0.7 + 2.6 * w.near;
        w.near += (k - w.near) * Math.min(1, dt * EASE);
        w.neon.glow = 1 + BRIGHTEN * w.near;
        const rim = w.rims[Math.min(BM.RIM_STEPS - 1, Math.floor(w.near * BM.RIM_STEPS))];
        if (w.rim.geometry !== rim) w.rim.geometry = rim;
        w.rim.glow = 0.85 + 0.15 * Math.sin(elapsed * 2.4) + w.near;
        w.ribs.glow = 1 + w.near;
        L[o + 3] = 7 + 5 * w.near;
        L[o + 4] = w.tint[0] * power; L[o + 5] = w.tint[1] * power; L[o + 6] = w.tint[2] * power;
      }
      w.phase.update(dt, elapsed);
      w.body.update(dt);
      w.body.time = w.phase.ripples.time;
      w.hum -= dt;
      if (w.hum <= 0) {
        w.hum = (0.16 + Math.random() * 0.3) * (1 - 0.65 * w.near);
        w.phase.ripples.pulse((Math.random() * 2 - 1) * WINDOW.halfW, Math.random() * WINDOW_TOP, 0);
      }
    }
    // The lanterns flicker like flames.
    for (let slot = fixedLights, j = 0; slot < RENDER_OPTS.lightCount; slot++, j++) {
      const k = 0.9 + Math.sin(elapsed * 9.3 + j * 1.7) * 0.06 + Math.sin(elapsed * 23.7 + j * 5.3) * 0.04, o = slot * 8;
      L[o + 4] = LANTERN_GLOW[0] * k; L[o + 5] = LANTERN_GLOW[1] * k; L[o + 6] = LANTERN_GLOW[2] * k;
    }
    dust.update(elapsed, pilot.orbit.target.x, pilot.orbit.target.z);
    // Out through the field: walked into, or flown into with the free view.
    if (!leaving) {
      if (avatar) {
        const p = avatar.root.position;
        if (p.z > ENTRY.field && Math.abs(p.x) < ENTRY.halfW) leaveChamber();
        else windowsFrame(previousX, previousY, previousZ);
      } else {
        const a = pilot.controls.read(), p = camera.position;
        if (Math.hypot(a.x, a.y) > 0.05 && p.z > ENTRY.field - 1.2 && Math.abs(p.x) < ENTRY.halfW) leaveChamber();
      }
    }
    stepTweens(dt);
    fx.update(dt, elapsed);
    // A page that opened here photographs the open worlds now, last, so the frame's own render puts the view back. The
    // renderer declines to draw while a program it needs is still compiling (the mirrors' among them), so it gets a try
    // every half second, a few seconds in all; each window hangs its picture as soon as it has one.
    pictureWait -= dt;
    if (pictureTries > 0 && pictureWait <= 0 && canPicture()) {
      pictureWait = 0.5;
      if (takePictures(s.looks)) pictureTries = 0;
      else pictureTries--;
      for (const w of s.windows) if (w.kind === "travel") hangPicture(w);
    }
  };
  const drawExtra = () => {};
  const overlay = (dt) => fx.drawOverlay(dt, drawExtra);

  const leave = () => {
    // Left by Back or Forward rather than by a way out of its own, the chamber hands the Ooga on, so the next scene
    // plays the same one; the way out to the island and a window have handed theirs over already.
    if (avatar && !leaving) world.pilot = avatar.traits.name;
    for (const w of scene.windows) {
      w.phase.dispose();
      if (w.face) { w.body.dispose(); w.face.mirrorRipples = null; }
      if (w.picture && w.picture.owned) renderer.releaseGeometry(w.picture.geometry);
    }
    scene.gate.phase.dispose();
    if (people) people.dispose();
    fx.dispose();
    pilot.dispose();
    for (const node of targets) input.remove(node);
    targets.length = 0;
    while (root.children.length) removeChild(root, root.children[root.children.length - 1]);
    const count = input.targetCount;
    input.dispose();
    hud.dispose();
    scene = hud = hooks = input = pilot = fx = agentPlay = dust = people = avatar = playerWorld = canvas = null;
    bifrostScene.input = bifrostScene.debug = null;
    return { targets: count };
  };
  const liveGeometry = (set) => {
    if (scene) {
      scene.gate.phase.liveGeometry(set);
      for (const w of scene.windows) {
        w.phase.liveGeometry(set);
        // An open world's rim swaps through its steps, and the mechanism through its colour's, so every step stays on
        // the GPU.
        if (w.rims) for (const rim of w.rims) set.add(rim);
        if (w.charge) for (let k = 0; k < BM.CHARGE_STEPS; k++) set.add(w.charge.beam[k]).add(w.charge.shock[k]);
      }
    }
    if (avatar) set.add(avatar.headOpen).add(avatar.headClosed);
  };
  const stats = () => {
    let nodes = 0;
    traverseVisible(root, () => nodes++);
    const all = (n) => 1 + n.children.reduce((sum, c) => sum + all(c), 0);
    return { visibleNodes: nodes, allNodes: all(root), tweens: tweenCount(), targets: input.targetCount, ...fx.stats() };
  };

  const bifrostScene = {
    id: "bifrost", enter, update, overlay, onDonation, onKey, onLootCleared, renderOpts: RENDER_OPTS, leave, stats, liveGeometry,
    root: null, camera: null, input: null, debug: null, agent: null, agentView: null, agentControls: null, agentHandoff: null,
    get inMotion() {
      return !!scene;
    }
  };
  BL.scenes = BL.scenes || {};
  BL.scenes.bifrost = bifrostScene;
})();
