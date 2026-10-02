// The Mempool cave: the chain read out in stone. Four stations round one room — the fee ladder as a
// rank of stalagmites, the five fee tiers as torches burning at their own heights, the chain on a
// carved tablet under a dripping stalactite, and the difficulty epoch as a wall of notches.
//
// Every readable surface is geometry, not texture: headline numbers are carved from the island's own
// sign glyphs and the dense panels are the jumbotron's 5x7 font run-length merged into quads. The
// numbers refresh from the chain snapshot at most once a second, and each refresh releases the
// geometry it replaces, so a cave left open all day holds its size.
//
// All four stations read the one `chain.snapshot`. `setCarved` shrinks its cell to fit the slab, so
// no reading runs off the stone, and the pool under the tablet's stalactite fills between blocks.
// Stations stand on the wall at their own bearing, turned in by `bearing + PI`, and every preset
// stands between one and the fire looking out at it; `entrance` stands on the stair landing and
// looks across the fire at the tablet. Ten lamps come first (the fire, the five tier torches, one
// over each other station and the stair lantern), then the hanging lanterns of the hall's dressing.
// One exit behind one latch, reached by Escape, the HUD's Leave button, and the stair mouth tapped
// or flown into; the walk-out needs the fly axes engaged, since an orbit sweep crosses the same arch.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, contributors, chain, game: gameMod, hud: hudMod, interact: interactMod, pilot: pilotMod, fx: fxMod, poolModels } = BL;
  const { clamp, lerp } = math;
  const { createNode, addChild, removeChild, createCamera, stepTweens, tweenCount, traverseVisible } = BL.scene;
  const { SITE, room, stairFoot, wallRadiusAt, brazier, tabletSlab, stationFace, stationPlaque, FACE_W, FACE_Z, carve, carveCells, panelFrom, torchStem, torchFlame, TORCH_STEM_H, latheBy, COLORS } = poolModels;
  const { drawText, measureText } = BL.jumbotron.text;

  const R = SITE.caveR, H = SITE.caveH, STATION_R = SITE.stationR;
  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  const PITCH = [0.05, 1.3], DIST = [3.5, 15];
  const FOLLOW = { y: 0.9, min: 3, max: 7, pitch: [0.25, 0.8] };
  const FLY = { speed: 4, perDist: 0.4, climb: 3, yMax: 4.5 };
  // A station sits on the wall at its bearing and every preset stands between it and the fire, looking
  // out at it; `entrance` stands on the stair landing and looks across the fire at the chain tablet.
  const STAIR_BEARING = -Math.PI / 4;
  // The stair mouth in the wall, and how close the eye has to get to be walking out through it.
  const STAIR_R = 6.5;
  const EXIT = { x: Math.sin(STAIR_BEARING) * 12.9, y: 1.9, z: Math.cos(STAIR_BEARING) * 12.9 }, EXIT_R = 2.2;
  const station = (bearing, y) => ({ yaw: bearing + Math.PI, pitch: 0.15, dist: 9, target: { x: Math.sin(bearing) * STATION_R, y, z: Math.cos(bearing) * STATION_R } });
  const PRESETS = {
    // Aimed past the fire at the chain tablet, so the flame lights the room from below the eye line
    // instead of standing in front of the one thing worth reading on the way in.
    entrance: { yaw: STAIR_BEARING, pitch: 0.22, dist: 13, target: { x: 1, y: 2.9, z: -3 } },
    ladder: station(Math.PI / 2, 2.6),
    tiers: station(-Math.PI / 2, 2.9),
    chain: station(Math.PI, 2.7),
    epoch: station(0, 2.7)
  };
  // Dim, warm and lit from the braziers: the cave passes no sky.
  const RENDER_OPTS = {
    clear: [0.05, 0.045, 0.04], sky: [0.24, 0.19, 0.14], ground: [0.11, 0.09, 0.07],
    direct: [0.5, 0.42, 0.3], directStrength: 0.4, ambientFloor: 0.26,
    sun: { x: 0.2, y: 0.9, z: 0.1 }, shadowCenter: { x: 0, y: 1.5, z: 0 }, shadowExtent: 16,
    lights: new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY * 8), lightCount: 0, bloomStrength: 0.5
  };
  const LADDER_N = BL.chain.LADDER, NOTCHES = 48, REFRESH = 1;
  const PANEL_BG = [12, 10, 9];
  // Carved headline type and the dense panels, both at the scale the lab's fittings are read at.
  const HEAD_CELL = 0.1;

  const spike = models.cached(() => latheBy({
    profile: [[0.22, 0], [0.16, 0.55], [0.06, 0.9], [0, 1]], segments: 7,
    color: (t, s) => s % 2 === 0 ? "#8b8275" : "#736b60"
  }));
  const notch = models.cached(() => models.box({ w: 0.1, h: 0.34, d: 0.08, color: COLORS.STONE_DK }));
  const notchLit = models.cached(() => models.box({ w: 0.1, h: 0.34, d: 0.09, color: COLORS.GOLD, emissive: 0.7 }));
  const dripPool = models.cached(() => models.noShadow(models.lathe({ profile: [[0.85, 0.03], [0, 0.03]], segments: 14, color: "#2d4a55", emissive: 0.3 })));
  const stalactite = models.cached(() => latheBy({ profile: [[0.3, 0], [0.18, -0.9], [0, -1.5]], segments: 7, color: () => "#6b747b" }));

  // The hall dressed from the shared kit: a ring of lamp cables under the vault and stores stacked on the three
  // diagonals the stations and the stair leave free. Three draws, built once for the page.
  const dressing = models.cached(() => {
    const set = BL.dressing.set(), ring = 10.8, y = 5.4;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, b = a + Math.PI / 4;
      set.cable(Math.sin(a) * ring, y, Math.cos(a) * ring, Math.sin(b) * ring, y, Math.cos(b) * ring, 0.55, [0.3, 0.7], k & 1 ? "hanging" : "bulb");
    }
    const r = 11.2;
    for (const bearing of [Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4]) {
      const cx = Math.sin(bearing) * r, cz = Math.cos(bearing) * r, sx = Math.cos(bearing), sz = -Math.sin(bearing);
      const turns = ((Math.round(bearing / (Math.PI / 2)) + 2) % 4 + 4) % 4;
      set.put("coalCrate", cx, 0, cz, turns, 1);
      set.put("crate", cx + sx * 0.9, 0, cz + sz * 0.9, turns + 1, 0);
      set.put("crate", cx + sx * 0.9, 0.75, cz + sz * 0.9, turns, 1);
      set.put("barrel", cx - sx * 0.95, 0, cz - sz * 0.95, 0, 1);
    }
    return set.build();
  });
  let renderer, game, world, go, root, camera, hud, hooks, input, pilot, fx, agentPlay = null;
  let stations = null, unsubscribeChain = null, refreshAt = 0, leaving = false, dust = null;
  const propTargets = [];
  // The string each head or panel was last built from: an unchanged reading keeps its geometry.
  const printed = new Map();

  const fmt = (n) => gameMod.formatLarge(Math.round(n));
  // Rounded to `d` places with trailing zeros dropped: 10.0 reads 10, 10.1 stays 10.1.
  const dec = (n, d) => String(+n.toFixed(d));
  const sat = (n) => n >= 10 ? dec(n, 0) : dec(n, 2);
  const usd = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
  const hours = (ms) => ms <= 0 ? "SOON" : ms < 36e5 ? `${Math.round(ms / 6e4)} MIN` : `${dec(ms / 36e5, 1)} HRS`;

  // One wall panel of dense type: lines of label and value, drawn once into a canvas and merged.
  const PANEL_W = 116, PANEL_H = 52, PANEL_PX = 0.04;
  const PANEL_X = -PANEL_W * PANEL_PX / 2;
  const makePanel = (ctx2d, lines) => {
    ctx2d.fillStyle = `rgb(${PANEL_BG[0]},${PANEL_BG[1]},${PANEL_BG[2]})`;
    ctx2d.fillRect(0, 0, PANEL_W, PANEL_H);
    let y = 2;
    for (const [label, value, color] of lines) {
      drawText(ctx2d, label, 1, y, "#8b7f6a", 1);
      const v = String(value);
      drawText(ctx2d, v, PANEL_W - 1 - measureText(v, 1), y, color || "#e8c14a", 1);
      y += 8;
    }
    return panelFrom(ctx2d, PANEL_W, PANEL_H, PANEL_PX, PANEL_PX, PANEL_BG);
  };

  // Carved headline text, centred on a slab face and replaced whole when its reading changes. The cell shrinks
  // to fit the slab, so a long reading is set smaller rather than run off the stone.
  const setCarved = (node, text, maxWidth, color) => {
    if (printed.get(node) === text) return;
    printed.set(node, text);
    if (node.geometry) renderer.releaseGeometry(node.geometry);
    const cell = Math.min(HEAD_CELL, maxWidth / carveCells(text));
    const { geometry, width } = carve(text, { cell, color });
    node.geometry = geometry;
    node.position.x = -width / 2;
  };
  const setPanel = (node, ctx2d, lines) => {
    const text = lines.map((l) => l.join("\t")).join("|");
    if (printed.get(node) === text) return;
    printed.set(node, text);
    if (node.geometry) renderer.releaseGeometry(node.geometry);
    node.geometry = makePanel(ctx2d, lines);
  };

  const buildStations = () => {
    const canvas = document.createElement("canvas");
    canvas.width = PANEL_W;
    canvas.height = PANEL_H;
    // willReadFrequently: every refresh reads the panel back, and without it Chrome warns.
    const ctx2d = canvas.getContext("2d", { alpha: false, willReadFrequently: true });

    // Each station stands on the wall at its own bearing, turned so its readable face looks in at the
    // fire; `bearing + PI` is that turn, the same one the island uses for its own mouths.
    const stationAt = (bearing) => createNode({
      position: { x: Math.sin(bearing) * STATION_R, y: 0, z: Math.cos(bearing) * STATION_R },
      rotation: { x: 0, y: bearing + Math.PI, z: 0 }
    });

    // Every station hangs its readables on the same hewn face at the same heights: the headline along
    // its top, the dense panel under it. FACE_Y is the face's centre, FACE_Z its front.
    const FACE_Y = 3.1, FACE_BACK = -0.35, HEAD_Y = 5.3, PANEL_Y = 2.6;
    // Just proud of the face, so nothing mounted on it fights its surface for depth.
    const faceZ = FACE_BACK + FACE_Z + 0.02;

    // The fee ladder: one spike per rung, tallest where the most vsize is waiting at that rate,
    // stood on the floor in front of its face.
    const ladderNode = stationAt(Math.PI / 2);
    const spikes = [];
    for (let i = 0; i < LADDER_N; i++) {
      const n = createNode({ position: { x: (i - (LADDER_N - 1) / 2) * 0.5, y: 0, z: 0.9 }, geometry: spike(), scale: { x: 1.15, y: 0.08, z: 1.15 } });
      spikes.push(n);
      addChild(ladderNode, n);
    }
    const ladderFace = createNode({ position: { x: 0, y: FACE_Y, z: FACE_BACK }, geometry: stationFace() });
    const ladderPanel = createNode({ position: { x: PANEL_X, y: PANEL_Y, z: faceZ } });
    const ladderHead = createNode({ position: { x: 0, y: HEAD_Y, z: FACE_BACK } });
    addChild(ladderNode, ladderFace, ladderPanel, ladderHead);

    // The five tiers, each a torch at its own height: the taller the flame, the dearer the block.
    // Stem and flame are separate nodes, so stretching one never stretches the other.
    const tiersNode = stationAt(-Math.PI / 2);
    const tiers = [];
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 2;
      const stem = createNode({ position: { x, y: 0, z: 0.7 }, geometry: torchStem(), scale: { x: 1, y: 1, z: 1 } });
      const flame = createNode({ position: { x, y: TORCH_STEM_H, z: 0.7 }, geometry: torchFlame() });
      tiers.push({ stem, flame, x });
      addChild(tiersNode, stem, flame);
    }
    const tiersFace = createNode({ position: { x: 0, y: 4.5, z: FACE_BACK }, geometry: stationPlaque() });
    const tiersHead = createNode({ position: { x: 0, y: 4.85, z: FACE_BACK } });
    addChild(tiersNode, tiersFace, tiersHead);

    // The chain, carved on a standing tablet under a stalactite that drips between blocks.
    const chainNode = stationAt(Math.PI);
    const slab = createNode({ geometry: tabletSlab() });
    const chainPanel = createNode({ position: { x: PANEL_X, y: 1.3, z: 0.17 } });
    const chainHead = createNode({ position: { x: 0, y: 4.75, z: 0 } });
    const drip = createNode({ position: { x: 3.7, y: 7, z: 1 }, geometry: stalactite() });
    const dripNode = createNode({ position: { x: 3.7, y: 0.02, z: 1 }, geometry: dripPool(), scale: { x: 0.2, y: 1, z: 0.2 } });
    addChild(chainNode, slab, chainPanel, chainHead, drip, dripNode);

    // The epoch as a wall of notches cut into its face, the elapsed ones lit.
    const epochNode = stationAt(0);
    const epochFace = createNode({ position: { x: 0, y: FACE_Y, z: FACE_BACK }, geometry: stationFace() });
    const notches = [];
    for (let i = 0; i < NOTCHES; i++) {
      const col = i % 16, row = (i / 16) | 0;
      const n = createNode({ position: { x: (col - 7.5) * 0.3 + 0.15, y: 4.2 - row * 0.5, z: faceZ + 0.03 }, geometry: notch() });
      notches.push(n);
      addChild(epochNode, n);
    }
    const epochPanel = createNode({ position: { x: PANEL_X, y: 0.85, z: faceZ } });
    const epochHead = createNode({ position: { x: 0, y: HEAD_Y, z: FACE_BACK } });
    addChild(epochNode, epochFace, epochPanel, epochHead);

    return { canvas, ctx2d, ladderNode, spikes, ladderHead, ladderPanel, tiersNode, tiers, tiersHead, chainNode, chainHead, chainPanel, dripNode, epochNode, notches, epochHead, epochPanel };
  };

  // Everything readable comes from one snapshot read, so no two stations can disagree.
  const refresh = () => {
    const s = chain.snapshot, st = stations, c2 = st.ctx2d;
    for (let i = 0; i < LADDER_N; i++) st.spikes[i].scale.y = Math.max(0.08, s.ladder[i] * 1.7);
    setCarved(st.ladderHead, `${dec(s.deep, 1)} BLOCKS DEEP`, FACE_W - 0.4, COLORS.GOLD);
    setPanel(st.ladderPanel, c2, [
      ["WAITING", `${fmt(s.count)} TX`],
      ["VSIZE", `${dec(s.vsize / 1e6, 2)} MVB`],
      ["BOUNTY", `${fmt(s.totalFee)} SAT`],
      ["FLOOR", `${sat(s.floor)} SAT/VB`],
      ["NEXT", `${sat(s.nextFee)} SAT/VB`],
      ["SOURCE", s.live ? (s.degraded ? "ESPLORA" : "MEMPOOL") : "STALE", s.live ? (s.degraded ? "#e8c14a" : "#8fbf6a") : "#e8695a"]
    ]);

    const tiers = [s.fastestFee, s.halfHourFee, s.hourFee, s.economyFee, s.minimumFee];
    const top = Math.max(1, ...tiers);
    for (let i = 0; i < 5; i++) {
      const k = clamp(0.5 + tiers[i] / top * 1.5, 0.5, 2);
      st.tiers[i].stem.scale.y = k;
      st.tiers[i].flame.position.y = TORCH_STEM_H * k;
    }
    setCarved(st.tiersHead, `FAST ${sat(s.fastestFee)} SAT/VB`, FACE_W - 0.4, "#ff9a2a");

    setCarved(st.chainHead, `BLOCK ${s.height}`, 5.4, COLORS.GOLD);
    setPanel(st.chainPanel, c2, [
      ["TXS", fmt(s.lastTxCount)],
      ["WEIGHT", `${dec(s.lastWeight / 1e6, 2)} MWU`],
      ["SIZE", `${dec(s.lastSize / 1e6, 2)} MB`],
      ["PACE", `${dec(s.pace / 60, 1)} MIN`],
      ["PRICE", s.priceUsd ? usd(s.priceUsd) : "-", "#8fbf6a"]
    ]);

    const lit = Math.round(clamp(s.progressPercent / 100, 0, 1) * NOTCHES);
    for (let i = 0; i < NOTCHES; i++) {
      const want = i < lit ? notchLit() : notch();
      if (st.notches[i].geometry !== want) st.notches[i].geometry = want;
    }
    setCarved(st.epochHead, `EPOCH ${dec(s.progressPercent, 0)}PCT`, FACE_W - 0.4, COLORS.GOLD);
    setPanel(st.epochPanel, c2, [
      ["RETARGET", `${s.difficultyChange >= 0 ? "+" : ""}${dec(s.difficultyChange, 2)}PCT`, s.difficultyChange >= 0 ? "#e8695a" : "#8fbf6a"],
      ["BLOCKS", fmt(s.remainingBlocks)],
      ["IN", hours(s.remainingTime)],
      ["HASHRATE", s.hashrate ? `${dec(s.hashrate / 1e18, 0)} EH/S` : "-"],
      ["DIFFICULTY", s.difficulty ? `${dec(s.difficulty / 1e12, 1)} T` : "-"]
    ]);
    // The pool under the stalactite fills between blocks and empties when one lands.
    const since = s.lastBlockAt ? clamp((Date.now() - s.lastBlockAt) / (chain.TARGET_BLOCK * 1000), 0, 1.4) : 0;
    stations.dripNode.scale.x = stations.dripNode.scale.z = 0.2 + since * 0.8;
  };

  // One way out, reachable three ways: Escape, the Leave button, and the stair mouth you came in by,
  // whether it is tapped or walked into. The latch means no two of them can fire the same departure.
  const leaveCave = () => {
    if (leaving) return;
    leaving = true;
    go("hub");
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      leaveCave();
      return true;
    }
    return false;
  };
  const onDonation = () => {};
  const onLootCleared = () => {};

  const enter = (ctx) => {
    ({ renderer, game, world, go, agentPlay } = ctx);
    camera = createCamera({ fov: 50, near: 0.2, far: 60 });
    root = createNode();
    const shell = createNode({ geometry: room() });
    const fire = createNode({ position: { x: 0, y: 0, z: 0 }, geometry: brazier(), scale: { x: 0.8, y: 0.8, z: 0.8 } });
    // The way in, under the stair landing the entrance view stands on.
    const stairs = createNode({
      position: { x: Math.sin(STAIR_BEARING) * STAIR_R, y: 0, z: Math.cos(STAIR_BEARING) * STAIR_R },
      rotation: { x: 0, y: STAIR_BEARING + Math.PI, z: 0 }, geometry: stairFoot()
    });
    addChild(root, shell, fire, stairs);
    dust = BL.dressing.motes({ count: 200, span: 16, low: 0.5, high: 6 });
    addChild(root, dust.node);
    const dressed = dressing();
    addChild(root, ...BL.dressing.nodes(dressed, { glow: 1 }));
    stations = buildStations();
    addChild(root, stations.ladderNode, stations.tiersNode, stations.chainNode, stations.epochNode);

    hud = hudMod.create({ roster: contributors.activeRoster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled: ctx.lootEnabled });
    // As in the hub and the lab: on a phone the sheet starts folded, or it hides both sticks.
    if (window.matchMedia("(max-width: 720px), (max-height: 500px)").matches) hud.el.sheet.dataset.open = "false";
    hooks = {};
    input = interactMod.create({ canvas: ctx.canvas, renderer, camera, hooks });
    // The wall domes in, so how far out the eye may go depends on how high it is: one curve, read by
    // `wallRadiusAt`, keeps both the aim point and the camera clear of the stone at every height.
    const clampTarget = (p) => {
      p.y = clamp(p.y, 0.3, H - 1.4);
      const r = Math.hypot(p.x, p.z), max = wallRadiusAt(p.y) - 1.6;
      if (r > max) { p.x *= max / r; p.z *= max / r; }
    };
    const clampCamera = (p) => {
      p.y = clamp(p.y, 0.4, H - 0.9);
      const r = Math.hypot(p.x, p.z), max = wallRadiusAt(p.y) - 0.5;
      if (r > max) { p.x *= max / r; p.z *= max / r; }
    };
    pilot = pilotMod.create({
      renderer, canvas: ctx.canvas, camera, hud, presets: PRESETS, landing: "entrance", pitch: PITCH, dist: DIST,
      follow: FOLLOW, fly: FLY, clampTarget, clampCamera, ceilingAt: () => H - 0.9, coarse: COARSE,
      close: { eyeHeight: 1.1, eyeRatio: 0.95, eyeForward: 0.16, pitch: [-1.35, 1.35], trailingDist: 4, orbitDist: 5, maxStep: 0.6, groundAt: () => 0 }
    });
    Object.assign(hooks, {
      onHover: (hit, p) => {
        if (hit) hud.tooltip.show("The way out · tap to leave", p.x, p.y);
        else hud.tooltip.hide();
      },
      onHoverMove: (hit, p) => hud.tooltip.show("The way out · tap to leave", p.x, p.y),
      onTap: (hit) => {
        if (hit && hit.owner.kind === "exit") leaveCave();
      },
      ...pilot.hooks
    });
    input.add(stairs, { kind: "exit", node: stairs }, { radius: 3.4 });
    propTargets.push(stairs);
    hud.onPreset(pilot.goPreset);
    hud.onAction((action) => {
      if (action === "leave") leaveCave();
      else if (action === "reset-view") pilot.goPreset("entrance");
    });
    fx = fxMod.create({ root, input, hooks, hud, game, world, renderer, camera, overlay: ctx.overlay, tickerAt: { x: 0, y: 6, z: 0 } });

    // Ten lamps first: the fire, the five tier torches, one over each of the other three stations
    // and one on the stair lantern. Every station has to carry its own light or it reads as a shadow.
    const lights = RENDER_OPTS.lights;
    const lamp = (i, x, y, z, radius, r, g, b) => {
      const o = i * 8;
      lights[o] = x; lights[o + 1] = y; lights[o + 2] = z; lights[o + 3] = radius;
      lights[o + 4] = r; lights[o + 5] = g; lights[o + 6] = b; lights[o + 7] = 0;
    };
    const atStation = (bearing, out = 3.6) => ({ x: Math.sin(bearing) * (STATION_R - out), z: Math.cos(bearing) * (STATION_R - out) });
    lamp(0, 0, 1.8, 0, 22, 1, 0.6, 0.25);
    // The tiers stand on the -x wall, so their local rank runs along world z.
    for (let i = 0; i < 5; i++) lamp(1 + i, -STATION_R + 0.7, 2.4, (i - 2) * -2, 6, 1, 0.58, 0.2);
    const ladderSpot = atStation(Math.PI / 2), chainSpot = atStation(Math.PI), epochSpot = atStation(0);
    lamp(6, ladderSpot.x, 3.4, ladderSpot.z, 13, 0.85, 0.72, 0.45);
    lamp(7, chainSpot.x, 3.4, chainSpot.z, 13, 0.9, 0.74, 0.42);
    lamp(8, epochSpot.x, 3.4, epochSpot.z, 13, 0.85, 0.72, 0.45);
    lamp(9, Math.sin(STAIR_BEARING) * 11.5, 4.4, Math.cos(STAIR_BEARING) * 11.5, 10, 1, 0.62, 0.26);
    // Then the ring's hanging lanterns, which the higher tiers can afford.
    const hung = dressing().lights;
    let count = 10;
    for (let i = 0; i < hung.length && count < BL.glRenderer.POINT_LIGHT_CAPACITY; i += 4) lamp(count++, hung[i], hung[i + 1], hung[i + 2], 6, 1, 0.66, 0.3);
    RENDER_OPTS.lightCount = count;

    refresh();
    unsubscribeChain = chain.subscribe(refresh);
    refreshAt = 0;
    leaving = false;

    poolScene.root = root;
    poolScene.camera = camera;
    poolScene.input = input;
    poolScene.debug = {
      hud, camera, controls: pilot.controls, pilot, stations, refresh,
      get snapshot() { return chain.snapshot; },
      get ladder() { return Array.from(stations.spikes, (n) => n.scale.y); },
      get tiers() { return Array.from(stations.tiers, (t) => t.stem.scale.y); },
      get lit() { return stations.notches.filter((n) => n.geometry === notchLit()).length; }
    };
  };

  const update = (dt, elapsed) => {
    pilot.readInput(dt);
    pilot.update(dt);
    dust.update(elapsed, pilot.orbit.target.x, pilot.orbit.target.z);
    if (!leaving) {
      const a = pilot.controls.read();
      // Only while the visitor is driving: an orbit sweep crosses the same arch without meaning to.
      if (Math.hypot(a.x, a.y) > 0.05) {
        const p = camera.position, dx = p.x - EXIT.x, dy = p.y - EXIT.y, dz = p.z - EXIT.z;
        if (dx * dx + dy * dy + dz * dz < EXIT_R * EXIT_R) leaveCave();
      }
    }
    stepTweens(dt);
    fx.update(dt, elapsed);
    refreshAt -= dt;
    if (refreshAt <= 0) {
      refreshAt = REFRESH;
      refresh();
    }
  };
  // Nothing of the cave's own goes on the overlay; the bubbles and ticker are the whole of it.
  const drawExtra = () => {};
  const overlay = (dt) => fx.drawOverlay(dt, drawExtra);

  const leave = () => {
    unsubscribeChain();
    unsubscribeChain = null;
    // Panels and carvings are geometry this scene made; the GPU gets them back before the next one.
    for (const node of [stations.ladderHead, stations.ladderPanel, stations.tiersHead, stations.chainHead, stations.chainPanel, stations.epochHead, stations.epochPanel]) {
      if (node.geometry) renderer.releaseGeometry(node.geometry);
      node.geometry = null;
    }
    fx.dispose();
    pilot.dispose();
    for (const node of propTargets) input.remove(node);
    propTargets.length = 0;
    printed.clear();
    while (root.children.length) removeChild(root, root.children[root.children.length - 1]);
    const targets = input.targetCount;
    input.dispose();
    hud.dispose();
    stations = hud = hooks = input = pilot = fx = agentPlay = dust = null;
    poolScene.input = poolScene.debug = null;
    return { targets };
  };
  const liveGeometry = () => {};
  const stats = () => {
    let nodes = 0;
    traverseVisible(root, () => nodes++);
    const all = (n) => 1 + n.children.reduce((sum, c) => sum + all(c), 0);
    return { visibleNodes: nodes, allNodes: all(root), tweens: tweenCount(), targets: input.targetCount, ...fx.stats() };
  };

  const poolScene = {
    id: "pool", enter, update, overlay, onDonation, onKey, onLootCleared, renderOpts: RENDER_OPTS, leave, stats, liveGeometry,
    root: null, camera: null, input: null, debug: null, agent: null, agentView: null, agentControls: null, agentHandoff: null,
    get inMotion() {
      return fx.inMotion;
    }
  };
  BL.scenes = BL.scenes || {};
  BL.scenes.pool = poolScene;
})();
