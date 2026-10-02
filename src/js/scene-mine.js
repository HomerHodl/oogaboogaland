// Ooga Mine: a mining operation you build with your hands.
//
// The scene is only ever a view of `mine-sim.js`: it owns no economy of its own. It draws the sim's
// spot tables from `mineModels.LAYOUT`, turns drags and taps into sim calls, and reads the sim's
// version counters to know when anything it shows has changed.
//
// A run is up to an hour, so the visit is built for a flat heap. Every node is made in `enter` and
// shown or hidden after that; the ASICs are one instanced batch per model at fixed capacity; the drop
// targets, flames and lights are fixed pools; nothing in `update` or `overlay` allocates.
//
// Phases `intro`, `run`, `results`. Chambers show as they are dug; the ASIC batches rebuild only when
// the sim's `layoutVersion` or `faultVersion` moves (lamps out when off, scorched when dead, ember when
// burning). Each chamber has a breaker and lever; every fan bought stands on its spot with its blades
// spun by its chamber's speed; a busbar riser stands per level; the crystal cell glows with the
// battery's charge; haze fills a chamber whose fan is down. Cooling fans spin up to about twenty turns a
// second and swap to a blurred disc past a few, turned at about eight a second with three unlike streaks
// so it has no symmetry to alias (a real speed would strobe backwards at sixty frames). The nearest
// lamps and dressing lanterns are lit up to the light capacity, and the sun comes down the shaft from
// the island's clock.
//
// Placing: drop markers show the dragged item's free spots, and the camera swings round to frame them
// when a drag starts and to whatever a tap bought (a dig glides to the new chamber's preset; neither
// moves it while an Ooga is driven). Cards show each model's profit and break-even, chamber upgrades and
// sell-all; faults are marked on the overlay and workable by hand only within `DRIVE_REACH`.
//
// The player is the Ooga who walked in, driven from the first frame. The overview (V, the View button,
// 0, and every dig) takes the camera off him to a chamber's preset and back behind him on his next step.
// Space and the WORK button on a coarse pointer both arrive as the pilot's `onFreeAction`, which is
// `actBeside`: a fire beside him is smothered over `SMOTHER_SECONDS` unless he carries a Fire Stopper,
// taken from and hung back on the wall with Space; the melting box is pulled by hand (`workFault("melt")`,
// the card's Pull it). Abandon shift is `sim.end("left")`.
//
// Charts: the trader's candlestick chart (candles, wicks and a last-price line) and the pool board's hash
// chart (your hash as bars, the difficulty as amber marks on its own scale) are fixed instanced batches
// written from the sim's rings (`candle*`, `hashHist`, `diffHist`). Their titles, the live figure and a
// price scale are set in the jumbotron's 5x7 font on one offscreen canvas per visit through
// `poolModels.panelFrom`, rebuilt at most once a second when a shown figure moves and released when
// replaced. The pool board's panel shows the real chain's epoch.
//
// The coin follows the chain's price (`followCoin`): the first live price a run sees fixes its display
// `rate` and locks it for the whole run (`rateLocked`). The live chain pays the pool or hands solo a
// roll, and the payout ticks once a hundredth of a coin. Notices cover launches, retargets, overloads and
// the halving; centre cards cover launches, digs, the halving (a ten-second countdown and a lamp dip at
// the cut) and the banked win; a title card opens the intro.
//
// The run lives on `world.mine` for the page life, is saved every few seconds and on leave, and is
// restored from storage when the cave is next entered on any page; a finished run clears it.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, mineRigs: R, mineSim, mineModels: MM, mineHud, mineAudio, mineCrew, donations, qr, daylight, contributors,
    game: gameMod, hud: hudMod, interact: interactMod, pilot: pilotMod, fx: fxMod } = BL;
  const { clamp, mat4 } = math;
  const { createNode, addChild, removeChild, createCamera, stepTweens, tweenCount, traverseVisible } = BL.scene;
  const L = MM.LAYOUT;

  const params = new URLSearchParams(location.search);
  const DEBUG = params.has("debug");
  const hourParam = DEBUG ? parseFloat(params.get("hour")) : NaN;
  const daylenParam = DEBUG ? parseFloat(params.get("daylen")) : NaN;
  const dayParam = DEBUG ? parseFloat(params.get("day")) : NaN;
  const timeParam = DEBUG ? params.get("time") : null;
  const COARSE = window.matchMedia("(pointer: coarse)").matches;

  const PITCH = [0.05, 1.25], DIST = [3, 28];
  const FLY = { speed: 6, perDist: 0.35, climb: 3, yMax: 7.4 };
  const DIG_VIEWS = ["den", "hall", "big"];
  const PRESETS = {
    den: { yaw: 0, pitch: 0.4, dist: 9, target: { x: 0, y: 1.2, z: 5.5 } },
    hall: { yaw: 0, pitch: 0.36, dist: 9, target: { x: 0, y: 1.4, z: -12 } },
    big: { yaw: 0, pitch: 0.5, dist: 13, target: { x: 0, y: 2, z: -37 } }
  };
  // Inside the rock: no sky, lit by its own lamps, and a haze that swallows the far end of a big cave.
  // Lamplight, not daylight: a warm fill from the rock and a golden haze.
  const RENDER_OPTS = {
    clear: [0.05, 0.036, 0.024], sky: [0.54, 0.44, 0.33], ground: [0.32, 0.25, 0.17], shadowCenter: { x: 0, y: 1.6, z: 4 }, shadowExtent: 22,
    lights: new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY * 8), lightCount: 0, bloomStrength: 0.9,
    fog: [0.11, 0.075, 0.045], fogNear: 22, fogFar: 60
  };
  // The island's clock, sampled only for how much sun reaches the Sun Leaves down the shaft.
  const SKY = {
    clear: new Float32Array(3), horizon: new Float32Array(3), zenith: new Float32Array(3), sky: new Float32Array(3), ground: new Float32Array(3), sun: new Float32Array(3), direct: new Float32Array(3),
    light: { x: 0, y: 1, z: 0 }, sunDirection: { x: 0, y: 1, z: 0 }, moon: { x: 0, y: 1, z: 0 }, starMatrix: new Float32Array(9),
    stars: 0, torch: 0, day: 1, twilight: 0, lampFactor: 0, directStrength: 1, sunStrength: 1, moonStrength: 0, ambientFloor: 0, diffuseFloor: 0, shadowStrength: 1, shadowFloor: 0, shadowBias: 0
  };
  const DROP_REACH = 80;            // screen pixels within which a drag snaps to a spot
  const MARKERS = 40, FLAMES = mineSim.FAULT_MAX, NC = R.DIGS.length, ASIC_MODELS = R.MODELS.length - R.FIRST_ASIC;
  const FIRE = models.particleGeometry("#ff7a2f", 0.1, 1);
  const SPARK = models.particleGeometry("#ffd27a", 0.06, 1);
  const DUST = models.particleGeometry("#6b625a", 0.14, 0);
  const FOAM = models.particleGeometry("#f3f1ea", 0.12, 0.6);
  const FIRE_BITS = [FIRE], SPARK_BITS = [SPARK], DUST_BITS = [DUST], FOAM_BITS = [FOAM];
  // Dust hanging in the lamplight: a fixed batch in the world, each mote belonging to one chamber and
  // drifting and wrapping inside it, so it stays where it is when the camera moves. Motes in a chamber
  // not dug yet wait out of sight.
  const MOTES = 120, MOTE_Y = [0.3, 3.8];
  const moteX = new Float32Array(MOTES), moteY = new Float32Array(MOTES), moteZ = new Float32Array(MOTES), motePhase = new Float32Array(MOTES);
  const moteChamber = new Uint8Array(MOTES);
  for (let i = 0; i < MOTES; i++) {
    // A share of the dust for each chamber by its floor area.
    const c = i < 24 ? 0 : i < 60 ? 1 : 2, ch = L.CHAMBERS[c];
    moteChamber[i] = c;
    moteX[i] = ch.x0 + Math.random() * (ch.x1 - ch.x0);
    moteY[i] = MOTE_Y[0] + Math.random() * (Math.min(ch.h - 0.5, MOTE_Y[1] + c) - MOTE_Y[0]);
    moteZ[i] = ch.z0 + Math.random() * (ch.z1 - ch.z0);
    motePhase[i] = Math.random() * 6.28;
  }
  const wrap = (v, lo, hi) => v < lo ? v + (hi - lo) : v > hi ? v - (hi - lo) : v;
  // Each chamber's running machines, summed where they stand, for the glow light over them.
  const glowX = new Float32Array(3), glowZ = new Float32Array(3), glowN = new Int32Array(3);
  // Cooling fans: radians a second, about twenty turns at full speed, blurred past about three.
  const FAN_SPEED = 20 * Math.PI * 2, FAN_BLUR = 18;
  const fanSpeed = new Float32Array(3);

  // One visit's state: made in enter(), dropped in leave().
  // Where the game exits to: back to Ooga Arcade when a cabinet started it, otherwise the island.
  let home = "hub";
  let renderer, game, world, go, root, camera, hud, mhud, hooks, input, pilot, fx, audio, crew, clock;
  let sim = null, s = null, cave = null, unsubscribeFeed = null, minuteTimer = 0;
  let phase = "intro", hudTimer = 0, paletteTimer = 0, sunTimer = 0, lightTimer = 0, ripple = 0, cardTimer = 0, saveTimer = 0;
  // The overview: the camera let off the player's Ooga to look round the chamber; any step he takes
  // brings it back behind him.
  let overview = false;
  // Beating a fire out by hand: the unit, and how long the player has stood at it.
  const smother = { unit: -1, t: 0, shown: -1 };
  const SAVE_SECONDS = 5;
  // The last hundredth of a coin the payout tick sounded for, the halving's lamp dip, and its countdown.
  let paidShown = -1, halvingDim = 0, halvingShown = -1;
  let shownLayout = -1, shownFaults = -1, shownMilestone = 0, shownLog = 0, shownEvent = -1, shownCard = "", shownArrivals = 0, shownStrikes = 0;
  let cpuNodes, gpuNodes, padNodes, holderNodes, powerNodes, trophyNodes, gearNodes, markerNodes, flameNodes, lampNodes, busbars;
  // The fan spot a chamber's cooling fault is worked from: its first fan standing, else its first spot.
  const coolSpotOf = (c) => {
    for (let k = c * R.COOL_SPOTS; k < (c + 1) * R.COOL_SPOTS; k++) if (s.cooler[k]) return k;
    return c * R.COOL_SPOTS;
  };
  let breakers, levers, fanNodes, bladeNodes, batteryNode, asicBatches = null, props = null, motes = null, sceneTime = 0;
  let candles = null, shownCandles = -1, hashMarks = null, shownHist = -1, chartLabels = null, labelCanvas = null, labelCtx = null, labelTimer = 0;
  // The Ooga the player drives: the camera follows this point while he is driven.
  const follow = { x: 0, y: 1.3, z: 0 };
  const DRIVE_REACH = 2.6;          // how close a driven Ooga has to stand to work on something
  const placed = [], targets = [];
  const selection = { type: "", id: -1 };
  const drag = { key: "", count: 0, hover: -1 };
  const candX = new Float32Array(MARKERS), candY = new Float32Array(MARKERS), candZ = new Float32Array(MARKERS), candId = new Int16Array(MARKERS);
  // Which unit each ASIC instance is and the glow it has at rest, per model, so a ripple can run over them.
  const asicUnit = new Int16Array(ASIC_MODELS * R.UNITS), asicGlow = new Float32Array(ASIC_MODELS * R.UNITS);
  const asicCount = new Int32Array(ASIC_MODELS);

  const place = (node) => {
    addChild(root, node);
    placed.push(node);
    return node;
  };
  const target = (node, owner) => {
    input.add(node, owner);
    targets.push(node);
  };
  const fmt = gameMod.formatLarge;
  // Banana figures go out at the run's rate (see the sim's `rate`); battery and sats stay as they are.
  const money = (n) => fmt(Math.round(n * s.rate));
  const signed = (n) => `${n < 0 ? "-" : "+"}${money(Math.abs(n))}`;

  // ---- where things are ----

  const chamberAt = (z) => z >= L.CHAMBERS[0].z0 ? 0 : z >= L.CHAMBERS[1].z0 ? 1 : 2;
  const doorZ = (i) => L.CHAMBERS[i].z1;
  const BAY = { x: 0, y: 0, z: 0, rx: 0, ry: 0 };
  // A unit's place in the world and the way it faces.
  const unitSpot = (u, out) => {
    if (u < R.UNIT_BAY) {
      const at = u < R.UNIT_SHELF ? L.BENCH[u - R.UNIT_BENCH] : L.SHELF[u - R.UNIT_SHELF];
      out.x = at.x;
      out.y = at.y;
      out.z = at.z;
      out.ry = at.ry;
      out.rx = 0;
      return out;
    }
    const p = R.padOfUnit(u), pad = L.PADS[p];
    MM.bayLocal(s.pad[p] || 1, R.bayOfUnit(u), BAY);
    const c = Math.cos(pad.ry), sn = Math.sin(pad.ry);
    out.x = pad.x + BAY.x * c + BAY.z * sn;
    out.y = BAY.y;
    out.z = pad.z - BAY.x * sn + BAY.z * c;
    out.ry = pad.ry + BAY.ry;
    out.rx = BAY.rx;
    return out;
  };
  // Where a job is: a chamber's breaker or cooling plant, the unit on fire or dead, or (`stopper`)
  // the last Fire Stopper hung on a chamber's wall, the one someone takes down.
  const spotOf = (kind, unit, out) => {
    if (kind === "breaker" || kind === "cooling" || kind === "stopper") {
      const at = kind === "breaker" ? L.PROP_AT.breakers[unit] : kind === "cooling" ? L.COOL_AT[coolSpotOf(unit)] : L.SAFETY_AT[0][unit * R.SAFETY[0].per + Math.max(0, s.extinguishers[unit] - 1)];
      out.x = at.x;
      out.y = 1.4;
      out.z = at.z;
      out.ry = at.ry;
      return out;
    }
    return unitSpot(unit, out);
  };
  const SPOT = { x: 0, y: 0, z: 0, ry: 0, rx: 0 };
  // Close enough to work on something by hand: within reach of the player's Ooga.
  const near = (x, z) => {
    const p = crew.crew[crew.driven].node.position;
    return (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < DRIVE_REACH * DRIVE_REACH;
  };

  // ---- the floor the Oogas walk ----

  // Walkable: inside a dug chamber, clear of its walls, or in a tunnel between two dug chambers.
  const WALL = 0.45;
  const inside = (x, z) => {
    for (let c = 0; c <= s.dug; c++) {
      const ch = L.CHAMBERS[c];
      if (x > ch.x0 + WALL && x < ch.x1 - WALL && z > ch.z0 + WALL && z < ch.z1 - WALL) return true;
      if (c > 0 && Math.abs(x) < L.TUNNEL.w / 2 - WALL && Math.abs(z - ch.z1) < 0.9) return true;
    }
    return false;
  };
  // Circles the Oogas walk round: the fixed props, and every holder and generator standing now.
  const OBSTACLE_MAX = 160;
  const obstacles = { x: new Float32Array(OBSTACLE_MAX), z: new Float32Array(OBSTACLE_MAX), r: new Float32Array(OBSTACLE_MAX), count: 0, fixed: 0 };
  const obstacle = (x, z, r) => {
    if (obstacles.count >= OBSTACLE_MAX) return;
    obstacles.x[obstacles.count] = x;
    obstacles.z[obstacles.count] = z;
    obstacles.r[obstacles.count] = r;
    obstacles.count++;
  };
  const fixedObstacles = () => {
    obstacles.count = 0;
    const A = L.PROP_AT;
    for (const at of A.breakers) obstacle(at.x, at.z, 0.5);
    obstacle(A.battery.x, A.battery.z, 0.5);
    obstacle(A.board.x, A.board.z, 0.8);
    obstacle(A.trader.x, A.trader.z, 1.2);
    obstacle(A.crack.x, A.crack.z, 1.1);
    for (const dz of [-1.6, 0, 1.6]) {
      obstacle(A.workbench.x, A.workbench.z + dz, 0.6);
      obstacle(A.shelves.x, A.shelves.z + dz * 1.3, 0.55);
    }
    for (const dx of [-1.4, 0, 1.4]) obstacle(A.trophyShelf.x + dx, A.trophyShelf.z, 0.5);
    for (const d of L.DRESS_AT) obstacle(d.x, d.z, 0.45);
    obstacles.fixed = obstacles.count;
  };
  // Holders and generators change with the layout, so they are laid over the fixed props each time.
  const layoutObstacles = () => {
    obstacles.count = obstacles.fixed;
    for (let p = 0; p < R.PADS; p++) {
      if (!s.pad[p] || R.chamberOfPad(p) > s.dug) continue;
      const pad = L.PADS[p];
      if (s.pad[p] === 1) obstacle(pad.x, pad.z, 0.62);
      else {
        // A tank is long and deep: two circles along its length.
        const c = Math.cos(pad.ry), sn = Math.sin(pad.ry);
        obstacle(pad.x - c * 0.65, pad.z + sn * 0.65, 1.0);
        obstacle(pad.x + c * 0.65, pad.z - sn * 0.65, 1.0);
      }
    }
    for (let i = 0; i < R.POWER_SPOTS; i++) if (s.power[i] && R.chamberOfPower(i) <= s.dug) obstacle(L.POWER_AT[i].x, L.POWER_AT[i].z, 0.85);
    for (let k = 0; k < s.cooler.length; k++) if (s.cooler[k] && R.chamberOfCool(k) <= s.dug) obstacle(L.COOL_AT[k].x, L.COOL_AT[k].z, s.cooler[k] === 2 ? 0.7 : 0.45);
  };
  // A station worth visiting when there is no work: a machine, a generator, a breaker or a cooling
  // plant, picked from a random start so nothing is filtered into a list.
  const STATION_KINDS = 5, STATIONS = STATION_KINDS * Math.max(R.PADS, R.POWER_SPOTS, R.BENCH + R.SHELF);
  const station = (out, r) => {
    const start = Math.floor(r * STATIONS);
    for (let n = 0; n < STATIONS; n++) {
      const k = (start + n) % STATIONS;
      const kind = k % STATION_KINDS, i = Math.floor(k / STATION_KINDS);
      if (kind === 0 && i < R.PADS && s.pad[i] && R.chamberOfPad(i) <= s.dug) {
        const pad = L.PADS[i];
        out.x = pad.x;
        out.z = pad.z;
        out.ry = pad.ry;
        return true;
      }
      if (kind === 1 && i < R.POWER_SPOTS && s.power[i] && R.chamberOfPower(i) <= s.dug) {
        const at = L.POWER_AT[i];
        out.x = at.x;
        out.z = at.z;
        out.ry = at.ry;
        return true;
      }
      if (kind === 2 && i <= s.dug && i < NC) {
        const at = L.PROP_AT.breakers[i];
        out.x = at.x;
        out.z = at.z;
        out.ry = at.ry;
        return true;
      }
      if (kind === 3 && i < s.cooler.length && s.cooler[i] && R.chamberOfCool(i) <= s.dug) {
        const at = L.COOL_AT[i];
        out.x = at.x;
        out.z = at.z;
        out.ry = at.ry;
        return true;
      }
      if (kind === 4 && i < R.BENCH + R.SHELF && s.unit[i]) {
        unitSpot(i, out);
        return true;
      }
    }
    return false;
  };

  const clampTarget = (t) => {
    const c = L.CHAMBERS[Math.min(chamberAt(t.z), s ? s.dug : 0)];
    t.z = clamp(t.z, L.CHAMBERS[s ? s.dug : 0].z0 + 0.8, L.CHAMBERS[0].z1 - 0.8);
    t.x = clamp(t.x, c.x0 + 0.8, c.x1 - 0.8);
    t.y = clamp(t.y, 0.4, c.h - 0.8);
  };
  // The camera stays in the chamber it is looking at, so a wall between two chambers never fills the
  // view. Only the Den lets it back out into its own mouth.
  const clampCamera = (p) => {
    const i = Math.min(chamberAt(pilot ? pilot.orbit.target.z : p.z), s ? s.dug : 0), c = L.CHAMBERS[i];
    // Behind the player at a chamber's entrance, the camera backs into the tunnel he came through,
    // inside its width and under its roof, rather than folding down over his head.
    if (i > 0 && p.z > c.z1 - 0.4 && Math.abs(p.x) < L.TUNNEL.w / 2 - 0.4) {
      p.z = Math.min(p.z, c.z1 + 1.5);
      p.y = clamp(p.y, 0.5, L.TUNNEL.h - 0.3);
      return;
    }
    p.z = clamp(p.z, c.z0 + 0.4, i === 0 ? c.z1 + 1.5 : c.z1 - 0.4);
    p.x = clamp(p.x, c.x0 + 0.4, c.x1 - 0.4);
    // Under the timber sets' cap beams, which run the width of the chamber just below the ceiling.
    p.y = clamp(p.y, 0.5, c.h - 0.6);
  };

  // ---- drawing the operation ----

  const M = new Float32Array(16), P = { x: 0, y: 0, z: 0 }, ROT = { x: 0, y: 0, z: 0 }, ONE = { x: 1, y: 1, z: 1 };
  const burning = (u) => {
    for (const f of s.faults) if (f.active && f.kind === "fire" && f.unit === u) return true;
    return false;
  };
  const melting = (u) => {
    for (const f of s.faults) if (f.active && f.kind === "melt" && f.unit === u) return true;
    return false;
  };
  const inTank = (u) => {
    const p = R.padOfUnit(u);
    return p >= 0 && s.pad[p] === 2;
  };
  const liveUnit = (u) => s.unit[u] > 0 && !s.dead[u] && !s.off[s.unit[u] - 1] && !s.blackout && !s.cutOff && !(s.curtailUntil > s.time) && !s.tripped[R.chamberOfUnit(u)];
  const dressUnit = (node, u) => {
    node.visible = s.unit[u] > 0;
    node.glow = liveUnit(u) ? 1 : 0;
    node.scorch = s.dead[u] ? 0.7 : 0;
    node.ember = burning(u) ? 0.9 : 0;
  };
  const dark = () => s.blackout || s.cutOff || (s.gridDown && s.battery <= 0);

  // Called only when the sim's layout or faults move, never per frame.
  const syncLayout = () => {
    shownLayout = s.layoutVersion;
    shownFaults = s.faultVersion;
    layoutObstacles();
    for (let i = 0; i < cave.chambers.length; i++) cave.chambers[i].visible = i <= s.dug;
    for (let i = 0; i < cave.seals.length; i++) cave.seals[i].visible = s.dug <= i;
    for (let c = 0; c < NC; c++) {
      breakers[c].visible = levers[c].visible = c <= s.dug;
      levers[c].rotation.x = s.tripped[c] ? 2.4 : 0;
      breakers[c].glow = s.tripped[c] ? 0.2 : 1;
    }
    // A riser up the breaker's wall for each busbar bought.
    for (let i = 0; i < busbars.length; i++) {
      const at = L.BUSBAR_AT[i];
      busbars[i].visible = s.dug >= at.chamber && i % R.BUSBAR.levels < s.busbar[at.chamber];
      busbars[i].glow = dark() || s.tripped[at.chamber] ? 0 : 1;
    }
    // Every fan bought stands on its spot, its blades on their own node for the spin.
    for (let k = 0; k < fanNodes.length; k++) {
      const t = s.cooler[k], node = fanNodes[k], blade = bladeNodes[k];
      node.visible = t > 0 && R.chamberOfCool(k) <= s.dug;
      if (!t) continue;
      const mount = MM.FAN_MOUNT[t - 1];
      node.geometry = t === 2 ? MM.fanWall() : MM.boxFan();
      blade.position.y = mount.y;
      blade.position.z = mount.z;
      blade.scale.x = blade.scale.y = blade.scale.z = mount.scale;
    }
    for (let u = 0; u < R.BENCH; u++) dressUnit(cpuNodes[u], R.UNIT_BENCH + u);
    for (let u = 0; u < R.SHELF; u++) dressUnit(gpuNodes[u], R.UNIT_SHELF + u);
    for (let p = 0; p < R.PADS; p++) {
      const open = R.chamberOfPad(p) <= s.dug, h = holderNodes[p];
      padNodes[p].visible = open && !s.pad[p];
      h.visible = open && s.pad[p] > 0;
      if (h.visible) h.geometry = s.pad[p] === 2 ? MM.coldPool() : MM.rackFrame();
    }
    for (let i = 0; i < R.POWER_SPOTS; i++) {
      const n = powerNodes[i], t = s.power[i];
      n.visible = t > 0 && R.chamberOfPower(i) <= s.dug;
      if (t) n.geometry = MM.POWER_BUILDERS[t - 1]();
    }
    for (let i = 0; i < trophyNodes.length; i++) trophyNodes[i].visible = s.trophy[i] === 1;
    R.SAFETY.forEach((gear, k) => {
      const nodes = gearNodes[k], held = s[gear.field];
      for (let i = 0; i < nodes.length; i++) {
        const c = Math.floor(i / gear.per);
        nodes[i].visible = c <= s.dug && i % gear.per < held[c];
      }
    });
    // The ASICs: one instance per occupied bay in its model's batch, lamps out when it is not running,
    // scorched when dead, burning when on fire.
    for (let k = 0; k < ASIC_MODELS; k++) asicCount[k] = 0;
    for (let c = 0; c < NC; c++) glowX[c] = glowZ[c] = glowN[c] = 0;
    for (let u = R.UNIT_BAY; u < R.UNITS; u++) {
      if (!s.unit[u]) continue;
      if (liveUnit(u)) {
        const c = R.chamberOfUnit(u);
        unitSpot(u, SPOT);
        glowX[c] += SPOT.x;
        glowZ[c] += SPOT.z;
        glowN[c]++;
      }
      const k = s.unit[u] - 1 - R.FIRST_ASIC, n = asicCount[k]++, data = asicBatches[k].instanceData;
      unitSpot(u, SPOT);
      P.x = SPOT.x;
      P.y = SPOT.y;
      P.z = SPOT.z;
      ROT.x = SPOT.rx;
      ROT.y = SPOT.ry;
      mat4.fromTRS(M, P, ROT, ONE);
      const o = n * 20;
      data.set(M, o);
      data[o + 16] = burning(u) ? -0.9 : melting(u) ? -0.6 : liveUnit(u) ? 1 : 0;
      data[o + 17] = s.dead[u] ? -0.7 : 0;
      data[o + 18] = 0;
      data[o + 19] = 0;
      asicUnit[k * R.UNITS + n] = u;
      asicGlow[k * R.UNITS + n] = data[o + 16];
    }
    for (let k = 0; k < ASIC_MODELS; k++) {
      asicBatches[k].instanceCount = asicCount[k];
      asicBatches[k].instanceVersion++;
    }
    // A flame over every fire.
    let f = 0;
    for (const fault of s.faults) {
      if (!fault.active || fault.kind !== "fire" || f >= FLAMES) continue;
      unitSpot(fault.unit, SPOT);
      const node = flameNodes[f++];
      node.visible = true;
      node.position.x = SPOT.x;
      node.position.y = SPOT.y + 0.1;
      node.position.z = SPOT.z;
    }
    for (; f < FLAMES; f++) flameNodes[f].visible = false;
    props.price.geometry = MM.priceBoard(s.shortage ? 1 : 0);
    props.board.glow = s.rug ? 0.1 : s.poolBonus ? 1.6 : 1;
    const dim = dark() ? 0.15 : 1;
    for (const lamp of lampNodes) lamp.glow = dim;
    lightTimer = 0;
  };

  // The two chart boards: the trader's candlesticks and the pool board's hash. Every mark is a unit box
  // in a fixed instanced batch, scaled into place in its board's own frame and turned with the board;
  // the type over them (titles, the live figure, the scale) is one merged panel per board, rebuilt at
  // most once a second and only when a figure it shows has moved.
  const writeMark = (data, n, A, lz, lx, ly, h, w, d) => {
    const c = Math.cos(A.ry), sn = Math.sin(A.ry), o = n * 20;
    data[o] = w * c;
    data[o + 1] = 0;
    data[o + 2] = -w * sn;
    data[o + 3] = 0;
    data[o + 4] = 0;
    data[o + 5] = Math.max(0.006, h);
    data[o + 6] = 0;
    data[o + 7] = 0;
    data[o + 8] = d * sn;
    data[o + 9] = 0;
    data[o + 10] = d * c;
    data[o + 11] = 0;
    data[o + 12] = A.x + lx * c + lz * sn;
    data[o + 13] = ly;
    data[o + 14] = A.z - lx * sn + lz * c;
    data[o + 15] = 1;
    data[o + 16] = 1;
    data[o + 17] = 0;
    data[o + 18] = 0;
    data[o + 19] = 0;
  };
  const CANDLE_BODY = 0.05, CANDLE_WICK = 0.012, CANDLE_DEPTH = 0.04;
  const syncCandles = () => {
    shownCandles = s.candleVersion;
    const count = s.candleCount, N = mineSim.CANDLES, C = MM.CHART, A = L.PROP_AT.trader;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < count; k++) {
      const i = (s.candleAt - k + N) % N;
      if (s.candleL[i] < lo) lo = s.candleL[i];
      if (s.candleH[i] > hi) hi = s.candleH[i];
    }
    // A little headroom above and below, so the extremes do not sit on the frame.
    const pad = Math.max(1, (hi - lo) * 0.08);
    lo -= pad;
    hi += pad;
    chartScale.lo = lo;
    chartScale.hi = hi;
    const scale = (C.y1 - C.y0) / (hi - lo), step = (C.x1 - C.x0) / N;
    let up = 0, down = 0;
    for (let k = 0; k < count; k++) {
      const i = (s.candleAt - (count - 1 - k) + N) % N, x = C.x0 + (k + 0.5 + N - count) * step;
      const o = s.candleO[i], cl = s.candleC[i];
      const top = C.y0 + (Math.max(o, cl) - lo) * scale, bottom = C.y0 + (Math.min(o, cl) - lo) * scale;
      if (cl >= o) writeMark(candles[0].instanceData, up++, A, C.z, x, (top + bottom) / 2, top - bottom, CANDLE_BODY, CANDLE_DEPTH);
      else writeMark(candles[1].instanceData, down++, A, C.z, x, (top + bottom) / 2, top - bottom, CANDLE_BODY, CANDLE_DEPTH);
      const high = C.y0 + (s.candleH[i] - lo) * scale, low = C.y0 + (s.candleL[i] - lo) * scale;
      writeMark(candles[2].instanceData, k, A, C.z + 0.005, x, (high + low) / 2, high - low, CANDLE_WICK, CANDLE_DEPTH * 0.6);
    }
    // The last price, as a line right across the plot.
    const last = C.y0 + (s.price - lo) * scale;
    writeMark(candles[3].instanceData, 0, A, C.z + 0.01, (C.x0 + C.x1) / 2, last, 0.008, C.x1 - C.x0, 0.01);
    candles[0].instanceCount = up;
    candles[1].instanceCount = down;
    candles[2].instanceCount = count;
    candles[3].instanceCount = 1;
    for (const batch of candles) batch.instanceVersion++;
  };
  const chartScale = { lo: 0, hi: 1 };
  // The pool board: a cyan bar for your hash in each sample, auto-scaled to the highest on the board,
  // and an amber square for the difficulty on its own scale, so the climb against you shows.
  const HASH_BAR = 0.024;
  const syncHashChart = () => {
    shownHist = s.histVersion;
    const count = s.histCount, N = mineSim.SAMPLES, C = MM.POOL_CHART, A = L.PROP_AT.board;
    let top = 1e-6, dlo = Infinity, dhi = -Infinity;
    for (let k = 0; k < count; k++) {
      const i = (s.histAt - k + N) % N;
      if (s.hashHist[i] > top) top = s.hashHist[i];
      if (s.diffHist[i] < dlo) dlo = s.diffHist[i];
      if (s.diffHist[i] > dhi) dhi = s.diffHist[i];
    }
    hashScale.top = top;
    const height = C.y1 - C.y0, step = (C.x1 - C.x0) / N, dspan = dhi - dlo;
    for (let k = 0; k < count; k++) {
      const i = (s.histAt - (count - 1 - k) + N) % N, x = C.x0 + (k + 0.5 + N - count) * step;
      const h = s.hashHist[i] / top * height * 0.92;
      writeMark(hashMarks[0].instanceData, k, A, C.z, x, C.y0 + h / 2, h, HASH_BAR, 0.03);
      const dy = C.y0 + (dspan > 0 ? 0.1 + (s.diffHist[i] - dlo) / dspan * 0.8 : 0.5) * height;
      writeMark(hashMarks[1].instanceData, k, A, C.z + 0.01, x, dy, 0.022, 0.022, 0.03);
    }
    hashMarks[0].instanceCount = hashMarks[1].instanceCount = count;
    for (const batch of hashMarks) batch.instanceVersion++;
  };
  const hashScale = { top: 1 };

  // The type on both boards, set in the jumbotron's 5x7 font on one offscreen canvas for the visit and
  // merged into quads. Each figure is compared as a rounded number first, so an unchanged board builds
  // nothing; a rebuilt panel releases the geometry it replaces.
  const { drawText, measureText } = BL.jumbotron.text;
  const LABEL_PX = 0.011, LABEL_BG = [3, 4, 5], LABEL_BG_CSS = "rgb(3,4,5)";
  const labelState = { price: -1, change: 0, hi: -1, lo: -1, hash: -1, top: -1, diff: -1, real: -1 };
  const drawLabels = (panelNode, w, h, draw) => {
    labelCtx.fillStyle = LABEL_BG_CSS;
    labelCtx.fillRect(0, 0, w, h);
    draw();
    if (panelNode.geometry) renderer.releaseGeometry(panelNode.geometry);
    panelNode.geometry = BL.poolModels.panelFrom(labelCtx, w, h, LABEL_PX, LABEL_PX, LABEL_BG);
  };
  // Where a height on a chart falls in its panel's canvas rows.
  const rowOf = (C, y) => Math.round((C.labelY + C.labelH * LABEL_PX - y) / LABEL_PX) - 3;
  const syncChartLabels = () => {
    const C = MM.CHART, P = MM.POOL_CHART, N = mineSim.CANDLES;
    const first = (s.candleAt - (s.candleCount - 1) + N) % N, change = s.price >= s.candleO[first] ? 1 : -1;
    const price = Math.round(s.price / 100), hi = Math.round(chartScale.hi / 100), lo = Math.round(chartScale.lo / 100);
    if (price !== labelState.price || change !== labelState.change || hi !== labelState.hi || lo !== labelState.lo) {
      labelState.price = price;
      labelState.change = change;
      labelState.hi = hi;
      labelState.lo = lo;
      drawLabels(chartLabels[0], C.labelW, C.labelH, () => {
        drawText(labelCtx, "COIN", 3, 1, "#c9c2b0", 1);
        const now = money(s.price);
        drawText(labelCtx, now, 3 + measureText("COIN ", 1), 1, change > 0 ? "#22c55e" : "#e5533d", 1);
        drawText(labelCtx, "12 MIN", C.labelW - 3 - measureText("12 MIN", 1), 1, "#5f6b75", 1);
        const col = Math.round((C.x1 + 0.07 - C.labelX) / LABEL_PX);
        drawText(labelCtx, money(chartScale.hi), col, rowOf(C, C.y1), "#8b97a2", 1);
        drawText(labelCtx, money((chartScale.hi + chartScale.lo) / 2), col, rowOf(C, (C.y0 + C.y1) / 2), "#8b97a2", 1);
        drawText(labelCtx, money(chartScale.lo), col, rowOf(C, C.y0), "#8b97a2", 1);
      });
    }
    const hash = Math.round(s.hash * 10), top = Math.round(hashScale.top * 10), diff = Math.round(s.difficulty), real = BL.chain.snapshot.remainingBlocks | 0;
    if (hash !== labelState.hash || top !== labelState.top || diff !== labelState.diff || real !== labelState.real) {
      labelState.hash = hash;
      labelState.top = top;
      labelState.diff = diff;
      labelState.real = real;
      drawLabels(chartLabels[1], P.labelW, P.labelH, () => {
        drawText(labelCtx, "YOUR HASH", 3, 2, "#c9c2b0", 1);
        const now = mineHud.hash(s.hash);
        drawText(labelCtx, now, P.labelW - 3 - measureText(now, 1), 2, "#7fe0ff", 1);
        const col = Math.round((P.x1 + 0.06 - P.labelX) / LABEL_PX);
        drawText(labelCtx, mineHud.hash(hashScale.top).replace(" ", ""), col, rowOf(P, P.y1 - 0.04), "#7fe0ff", 1);
        drawText(labelCtx, `NET ${mineHud.hash(s.difficulty)}`, 3, 11, "#f5c542", 1);
        // The real chain's epoch beside the island's: blocks to the retarget, its estimate and the hashrate.
        const c = BL.chain.snapshot;
        if (c.remainingBlocks > 0) drawText(labelCtx, `REAL ${c.remainingBlocks} TO GO ${c.difficultyChange >= 0 ? "+" : ""}${c.difficultyChange.toFixed(1)}% ${c.hashrate > 0 ? `${(c.hashrate / 1e18).toFixed(0)}EH` : ""}`, 3, 20, "#8b97a2", 1);
      });
    }
  };

  // Ten lights reach the shader: a glow on every fire and tripped breaker, the sun down the shaft, and
  // the nearest lamps to the view. In the dark only the emergency red is left.
  // The chamber lamps, then every dressing lantern: one nearest-first list, the lanterns a little dimmer.
  // Built on the first lit frame, not at page load: the lanterns come from baking the chambers' dressing.
  let HUNG = null, LAMP_N = 0, lightScore = null;
  const pushLight = (n, x, y, z, radius, r, g, b) => {
    if (n >= BL.glRenderer.POINT_LIGHT_CAPACITY) return n;
    const o = n * 8, Lt = RENDER_OPTS.lights;
    Lt[o] = x;
    Lt[o + 1] = y;
    Lt[o + 2] = z;
    Lt[o + 3] = radius;
    Lt[o + 4] = r;
    Lt[o + 5] = g;
    Lt[o + 6] = b;
    Lt[o + 7] = 0;
    return n + 1;
  };
  const syncLights = () => {
    let n = 0;
    for (const fault of s.faults) {
      if (!fault.active) continue;
      spotOf(fault.kind, fault.unit, SPOT);
      n = fault.kind === "fire" ? pushLight(n, SPOT.x, SPOT.y + 0.8, SPOT.z, 7, 1, 0.42, 0.12) : fault.kind === "melt" ? pushLight(n, SPOT.x, SPOT.y + 0.6, SPOT.z, 6, 1, 0.15, 0.1) : pushLight(n, SPOT.x, 2, SPOT.z, 5, 0.9, 0.25, 0.1);
    }
    const out = dark();
    if (s.sun > 0.05) n = pushLight(n, L.PROP_AT.shaft.x, 3.4, L.PROP_AT.shaft.z, 7, 0.55 * s.sun, 0.52 * s.sun, 0.4 * s.sun);
    const t = pilot.orbit.target;
    // The running machines in the view's chamber light the room they stand in, cool and green.
    const here = Math.min(chamberAt(t.z), s.dug);
    if (glowN[here] > 0 && !out) {
      const k = Math.min(1, glowN[here] / 12);
      n = pushLight(n, glowX[here] / glowN[here], 1.6, glowZ[here] / glowN[here], 6 + here * 3, 0.1 * k, 0.42 * k, 0.32 * k);
    }
    if (!HUNG) {
      HUNG = MM.dressingLights();
      LAMP_N = L.LAMPS.length + HUNG.length / 4;
      lightScore = new Float32Array(LAMP_N);
    }
    for (let i = 0; i < LAMP_N; i++) {
      const hung = i >= L.LAMPS.length, h = (i - L.LAMPS.length) * 4;
      const x = hung ? HUNG[h] : L.LAMPS[i].x, z = hung ? HUNG[h + 2] : L.LAMPS[i].z, chamber = hung ? HUNG[h + 3] : L.LAMPS[i].chamber;
      lightScore[i] = chamber > s.dug ? Infinity : (x - t.x) * (x - t.x) + (z - t.z) * (z - t.z);
    }
    // Nearest first, by repeated minimum: a handful of lamps, no sort and no list.
    while (n < BL.glRenderer.POINT_LIGHT_CAPACITY) {
      let best = -1, bestD = Infinity;
      for (let i = 0; i < lightScore.length; i++) if (lightScore[i] < bestD) {
        bestD = lightScore[i];
        best = i;
      }
      if (best < 0) break;
      lightScore[best] = Infinity;
      if (best >= L.LAMPS.length) {
        const h = (best - L.LAMPS.length) * 4;
        n = out || s.tripped[HUNG[h + 3]] ? n : pushLight(n, HUNG[h], HUNG[h + 1], HUNG[h + 2], 6, 1, 0.66, 0.3);
        continue;
      }
      const lamp = L.LAMPS[best], radius = 10 + lamp.chamber * 3;
      n = out || s.tripped[lamp.chamber] ? pushLight(n, lamp.x, lamp.y, lamp.z, radius * 0.6, 0.35, 0.05, 0.04) : pushLight(n, lamp.x, lamp.y, lamp.z, radius, 0.85, 0.62, 0.34);
    }
    RENDER_OPTS.lightCount = n;
    RENDER_OPTS.shadowCenter.x = t.x;
    RENDER_OPTS.shadowCenter.z = t.z;
    // A failed fan fills its chamber with haze; the fog follows the chamber the view is in.
    const haze = s.fanDown[Math.min(chamberAt(t.z), s.dug)] === 1;
    RENDER_OPTS.fogNear = haze ? 5 : 22;
    RENDER_OPTS.fogFar = haze ? 26 : 60;
  };

  // ---- the palette's view of the sim ----

  const INFO = { cost: 0, can: false, owned: 0, locked: false, stat: "", profit: NaN, note: "" };
  // Busbars, fans and safety gear go to the chamber the player stands in when it has room for one,
  // otherwise the first dug chamber that does; -1 when none has.
  const hereFirst = (fits) => {
    const here = Math.min(chamberAt(crew.crew[0].node.position.z), s.dug);
    if (fits(here)) return here;
    for (let c = 0; c <= s.dug; c++) if (fits(c)) return c;
    return -1;
  };
  const busbarRoom = () => hereFirst((c) => sim.chamberCost(c) > 0);
  const freeCool = (c) => {
    for (let k = c * R.COOL_SPOTS; k < (c + 1) * R.COOL_SPOTS; k++) if (sim.canCool(k)) return k;
    return -1;
  };
  const coolRoom = () => hereFirst((c) => freeCool(c) >= 0);
  const gearRoom = (k) => hereFirst((c) => s[R.SAFETY[k].field][c] < R.SAFETY[k].per);
  // Safety gear as the scene draws it, in R.SAFETY's order; a hung piece's target id is k * GEAR_IDS + hook.
  const GEAR_GEO = [MM.extinguisher, MM.spareBreaker, MM.smokeAlarm], GEAR_IDS = 16;
  const GEAR_NOTES = [
    "Hangs by the breaker. Take it down (Space beside it) and carry it to a fire: out at once. Without one a fire is beaten out by hand, five seconds standing at it. Used once.",
    "Throws a tripped breaker back by itself once the load fits the circuit again. Used once.",
    "Beeps and blinks when the chamber is about to run too hot, every time."
  ];
  const gearHook = (k, c) => L.SAFETY_AT[k][c * R.SAFETY[k].per + s[R.SAFETY[k].field][c]];
  const tileInfo = (key) => {
    const c = key[0], i = Number(key.slice(1));
    INFO.owned = 0;
    INFO.locked = false;
    INFO.profit = NaN;
    if (key === "dig") {
      INFO.cost = sim.digCost();
      INFO.locked = s.dug + 1 >= R.DIGS.length;
      INFO.stat = INFO.locked ? "all dug out" : `opens the ${R.DIGS[s.dug + 1].name}`;
      INFO.note = INFO.locked ? "There is no more cave." : `Break through into the ${R.DIGS[s.dug + 1].name}: ${R.DIGS[s.dug + 1].pads} more pads and a ${R.DIGS[s.dug + 1].circuit} kW circuit.`;
    } else if (key === "pack") {
      INFO.cost = R.BATTERY.packCost;
      INFO.stat = `+${fmt(R.BATTERY.pack)} battery`;
      INFO.note = "Panic power for an outage, at panic prices.";
    } else if (c === "m") {
      const m = R.MODELS[i];
      INFO.cost = s.launched[i] ? sim.costFor(i) : 0;
      INFO.owned = s.owned[i];
      INFO.locked = !s.launched[i] || sim.firstFree(i) < 0;
      // The chamber the next one would stand in, if it is running hot, is slowing everything in it.
      const next = s.launched[i] ? sim.firstFree(i) : -1, slowed = next >= 0 && s.throttle[R.chamberOfUnit(next)] < 1;
      INFO.stat = !s.launched[i] ? `arrives at ${Math.floor(m.from / 60)}:00` : `${m.th} TH · ${m.kw} kW${slowed ? ` · slowed ${Math.round((1 - s.throttle[R.chamberOfUnit(next)]) * 100)}%` : ""}`;
      INFO.profit = s.launched[i] ? sim.profitOf(i) : NaN;
      INFO.note = !s.launched[i] ? `${m.name} is not out yet.` : sim.firstFree(i) >= 0 ? `${m.note} ${Math.round(R.efficiencyOf(m))} watts a TH.` : m.spot === "bay" ? (s.holders[0] + s.holders[1] ? "Every bay is full. Put up another rack, or dig." : "An ASIC needs a Rack or a Cold Pool to stand in.") : "No room left for these.";
    } else if (c === "h") {
      INFO.cost = sim.holderCostFor(i);
      INFO.owned = s.holders[i];
      let free = false;
      for (let p = 0; p < R.PADS && !free; p++) free = sim.canPad(p);
      INFO.locked = !free;
      INFO.stat = `${R.HOLDERS[i].bays} bays`;
      INFO.note = free ? R.HOLDERS[i].note : "Every pad is taken. Dig deeper.";
    } else if (c === "p") {
      const src = R.POWER[i];
      INFO.cost = sim.powerCostFor(i);
      INFO.owned = s.generators[i];
      let free = false;
      for (let p = 0; p < R.POWER_SPOTS && !free; p++) free = sim.canPower(p);
      INFO.locked = !free;
      INFO.stat = src.store ? `+${fmt(src.store)} battery` : `${src.kw} kW${src.solar ? (s.sun < 0.1 ? " in sun · night now" : " in sun") : ""}`;
      INFO.note = free ? `${src.note}${src.kw ? ` Saves ${money(src.kw * sim.gridPrice() / 60)} a minute at today's price.` : ""}` : "No power nook left. Dig deeper.";
    } else if (c === "u") {
      const room = busbarRoom();
      INFO.cost = room >= 0 ? sim.chamberCost(room) : 0;
      for (let k = 0; k <= s.dug; k++) INFO.owned += s.busbar[k];
      INFO.locked = room < 0;
      INFO.stat = room < 0 ? "all maxed" : `${R.DIGS[room].name} · 2x circuit`;
      INFO.note = room < 0 ? "Every dug chamber has all of these. Dig deeper for more." : "A copper riser on the chamber's breaker: its circuit carries twice the load before it trips.";
    } else if (c === "f") {
      const fan = R.COOLERS[i], room = coolRoom();
      INFO.cost = sim.coolerCostFor(i, room >= 0 ? room : 0);
      for (let k = 0; k < s.cooler.length; k++) if (s.cooler[k] === i + 1) INFO.owned++;
      INFO.locked = room < 0;
      INFO.stat = room < 0 ? "every spot taken" : `${R.DIGS[room].name} · +${Math.round(R.DIGS[room].cool * fan.share)} kW`;
      INFO.note = room < 0 ? "Every fan spot has a fan. Swap a Box Fan for a Fan Wall, or dig deeper." : i
        ? "A cooling wall: carries away the chamber's full measure of heat. Four fit a chamber."
        : "A cheap floor fan: a third of a Fan Wall's cooling, and the one to start with.";
    } else if (c === "x") {
      const gear = R.SAFETY[i], held = s[gear.field], room = gearRoom(i);
      INFO.cost = gear.cost;
      for (let k = 0; k <= s.dug; k++) INFO.owned += held[k];
      INFO.locked = room < 0;
      INFO.stat = room < 0 ? "all hung" : `${R.DIGS[room].name} · ${held[room]} of ${gear.per}`;
      INFO.note = room < 0 ? "Every dug chamber has its share. Dig deeper for more." : GEAR_NOTES[i];
    } else {
      INFO.cost = R.TROPHIES[i].cost;
      INFO.owned = s.trophy[i];
      INFO.locked = s.trophy[i] === 1;
      INFO.stat = INFO.locked ? "on the shelf" : "";
      INFO.note = R.TROPHIES[i].note;
    }
    INFO.can = !INFO.locked && !s.over && s.bananas >= INFO.cost;
    return INFO;
  };
  const geometryFor = (key) => {
    const c = key[0], i = Number(key.slice(1));
    if (key === "dig") return MM.seal();
    if (key === "pack") return MM.crystal();
    if (c === "m") return i === R.CPU ? MM.pebbleBox() : i === R.GPU ? MM.shinyRocks() : MM.asic(i - R.FIRST_ASIC);
    if (c === "h") return i ? MM.coldPool() : MM.rackFrame();
    if (c === "p") return MM.POWER_BUILDERS[i]();
    if (c === "u") return MM.busbarRiser(0);
    if (c === "f") return i ? MM.fanWall() : MM.boxFan();
    if (c === "x") return GEAR_GEO[i]();
    return MM.trophy(i);
  };

  // ---- buying, by drag or by tap ----

  const why = (key) => {
    tileInfo(key);
    return INFO.locked ? INFO.note : s.over ? "The run is over" : s.bananas < 0 ? "You owe the grid. Pay it first." : "Not enough bananas";
  };
  const celebrate = (x, y, z) => {
    audio.cue("buy");
    fx.burst(x, y + 0.3, z, 8, fxMod.CONFETTI, 1.6);
  };
  // The camera swings round to what was just bought, and to where a dragged piece can go, so the player
  // never places something out of sight. With the Ooga driven it stays on him and turns instead.
  const VIEW = { x: 0, y: 0, z: 0 };
  const lookAt = (x, y, z, dist) => {
    const o = pilot.orbit;
    if (crew.driven >= 0 && !overview) {
      // Behind the player's Ooga: keep following him, and turn so the spot lies beyond him.
      const p = crew.crew[crew.driven].node.position, far = Math.hypot(p.x - x, p.z - z);
      if (far < 0.5) return;
      const turn = Math.atan2(p.x - x, p.z - z) - o.yaw;
      o.tYaw = o.yaw + Math.atan2(Math.sin(turn), Math.cos(turn));
      o.tDist = clamp(far * 0.6 + 4, THIRD.dist, 8);
      return;
    }
    const c = L.CHAMBERS[Math.min(chamberAt(z), s.dug)], cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
    VIEW.x = x;
    VIEW.y = y;
    VIEW.z = z;
    o.target = VIEW;
    // Stand on the room side of it, turning the short way round.
    if (Math.hypot(cx - x, cz - z) > 1) {
      const turn = Math.atan2(cx - x, cz - z) - o.yaw;
      o.tYaw = o.yaw + Math.atan2(Math.sin(turn), Math.cos(turn));
    }
    o.tPitch = 0.42;
    o.tDist = dist;
  };
  const onScreen = (x, y, z) => renderer.project(x, y, z, PROJ) && PROJ.x > window.innerWidth * 0.2 && PROJ.x < window.innerWidth * 0.8 && PROJ.y > window.innerHeight * 0.1 && PROJ.y < window.innerHeight * 0.85;
  // Frames the drag's spots in the chamber in view, or in the first chamber that has one.
  const frameSpots = (count) => {
    if (!count) return;
    let room = chamberAt(pilot.orbit.tz), any = false;
    for (let m = 0; m < count && !any; m++) any = chamberAt(candZ[m]) === room;
    if (!any) room = chamberAt(candZ[0]);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, hidden = false;
    for (let m = 0; m < count; m++) {
      if (chamberAt(candZ[m]) !== room) continue;
      x0 = Math.min(x0, candX[m]);
      x1 = Math.max(x1, candX[m]);
      z0 = Math.min(z0, candZ[m]);
      z1 = Math.max(z1, candZ[m]);
      hidden ||= !onScreen(candX[m], candY[m], candZ[m]);
    }
    if (hidden) lookAt((x0 + x1) / 2, 1.2, (z0 + z1) / 2, clamp(Math.max(x1 - x0, z1 - z0) * 0.8 + 5, 6, 14));
  };

  // `at` is the spot a drag chose, or -1 for the next free one.
  const buy = (key, at) => {
    if (phase !== "run") return false;
    const c = key[0], i = Number(key.slice(1));
    let done = -1;
    if (key === "pack") {
      if (sim.buyPack()) {
        const B = L.PROP_AT.battery;
        audio.cue("buy");
        fx.burst(B.x, 0.8, B.z, 14, fxMod.CONFETTI, 1.8);
        lookAt(B.x, 0.8, B.z, 5);
        hud.toast(`+${fmt(R.BATTERY.pack)} in the battery`);
        return true;
      }
    } else if (key === "dig") {
      if (sim.dig()) {
        audio.cue("dig");
        const seal = cave.seals[s.dug - 1];
        fx.burst(seal.position.x, 1.6, seal.position.z, 30, DUST_BITS, 4);
        // The camera glides into the new chamber whoever is driven; a step brings it back.
        setOverview(true, DIG_VIEWS[s.dug]);
        mhud.center(`THE ${R.DIGS[s.dug].name.toUpperCase()} · ${R.DIGS[s.dug].pads} more pads · ${R.DIGS[s.dug].circuit} kW`, 2600);
        return true;
      }
    } else if (c === "m") {
      done = sim.place(i, at);
      if (done >= 0) {
        unitSpot(done, SPOT);
        celebrate(SPOT.x, SPOT.y, SPOT.z);
        if (at < 0) lookAt(SPOT.x, SPOT.y, SPOT.z, i < R.FIRST_ASIC ? 5 : 6);
        if (i < R.FIRST_ASIC && s.owned[i] === (i === R.CPU ? 2 : 1)) hud.toast("Feeling nostalgic, Ooga? Check its profit: ASICs are the real thing.");
        return true;
      }
    } else if (c === "h") {
      done = sim.placeHolder(i, at);
      if (done >= 0) {
        celebrate(L.PADS[done].x, 0, L.PADS[done].z);
        if (at < 0) lookAt(L.PADS[done].x, 1.2, L.PADS[done].z, 7);
        return true;
      }
    } else if (c === "p") {
      done = sim.placePower(i, at);
      if (done >= 0) {
        celebrate(L.POWER_AT[done].x, 0, L.POWER_AT[done].z);
        if (at < 0) lookAt(L.POWER_AT[done].x, 1, L.POWER_AT[done].z, 7);
        return true;
      }
    } else if (c === "u") {
      const room = at >= 0 ? at : busbarRoom();
      if (room >= 0 && sim.upgradeChamber(room)) {
        const riser = L.BUSBAR_AT[room * R.BUSBAR.levels + s.busbar[room] - 1];
        celebrate(riser.x, 2.6, riser.z);
        if (at < 0) lookAt(riser.x, 2.4, riser.z, 6);
        hud.toast(`${R.DIGS[room].name}: a heavier busbar, twice the circuit`);
        return true;
      }
    } else if (c === "f") {
      const room = coolRoom(), spot = at >= 0 ? at : room >= 0 ? freeCool(room) : -1;
      done = spot >= 0 ? sim.placeCooler(i, spot) : -1;
      if (done >= 0) {
        const at2 = L.COOL_AT[done];
        celebrate(at2.x, 0.8, at2.z);
        if (at < 0) lookAt(at2.x, 1, at2.z, 5.5);
        hud.toast(`${R.COOLERS[i].name} in the ${R.DIGS[R.chamberOfCool(done)].name}: cooling now ${Math.round(sim.coolingOf(R.chamberOfCool(done)))} kW`);
        return true;
      }
    } else if (c === "x") {
      const gear = R.SAFETY[i], room = at >= 0 ? at : gearRoom(i);
      if (room >= 0 && sim.buySafety(i, room)) {
        const e = L.SAFETY_AT[i][room * gear.per + s[gear.field][room] - 1];
        celebrate(e.x, Math.min(e.y, 2.4), e.z);
        if (at < 0) lookAt(e.x, Math.min(e.y, 2.4), e.z, 5);
        hud.toast(`${gear.name} hung in the ${R.DIGS[room].name}`);
        return true;
      }
    } else if (c === "t" && sim.buyTrophy(i)) {
      const at = L.TROPHY_AT[i];
      celebrate(at.x, at.y, at.z);
      lookAt(at.x, at.y, at.z, 5);
      hud.toast(`${R.TROPHIES[i].name} · ${R.TROPHIES[i].note}`);
      return true;
    }
    audio.cue("deny");
    hud.toast(why(key));
    return false;
  };

  // The spots a dragged thing could go to right now, projected and lit with a marker each. An ASIC is
  // dropped on a rack or tank with room, not on a single bay.
  const candidates = (key) => {
    const c = key[0], i = Number(key.slice(1));
    let n = 0;
    const add = (id, x, y, z) => {
      if (n >= MARKERS) return;
      candId[n] = id;
      candX[n] = x;
      candY[n] = y;
      candZ[n] = z;
      n++;
    };
    if (c === "m" && i < R.FIRST_ASIC) {
      const from = i === R.GPU ? R.UNIT_SHELF : R.UNIT_BENCH, count = i === R.GPU ? R.SHELF : R.BENCH;
      for (let u = from; u < from + count; u++) if (sim.canHold(i, u)) {
        unitSpot(u, SPOT);
        add(u, SPOT.x, SPOT.y, SPOT.z);
      }
    } else if (c === "m") {
      for (let p = 0; p < R.PADS; p++) {
        if (!s.pad[p] || R.chamberOfPad(p) > s.dug) continue;
        const base = R.UNIT_BAY + p * R.BAYS, bays = R.HOLDERS[s.pad[p] - 1].bays;
        for (let b = 0; b < bays; b++) if (!s.unit[base + b]) {
          add(base + b, L.PADS[p].x, s.pad[p] === 2 ? 0.8 : 2.62, L.PADS[p].z);
          break;
        }
      }
    } else if (c === "h") {
      for (let p = 0; p < R.PADS; p++) if (sim.canPad(p)) add(p, L.PADS[p].x, 0.05, L.PADS[p].z);
    } else if (c === "p") {
      for (let p = 0; p < R.POWER_SPOTS; p++) if (sim.canPower(p)) add(p, L.POWER_AT[p].x, 0.05, L.POWER_AT[p].z);
    } else if (c === "u") {
      for (let k = 0; k <= s.dug; k++) if (sim.chamberCost(k) > 0) add(k, L.PROP_AT.breakers[k].x - 0.4, 0.05, L.PROP_AT.breakers[k].z);
    } else if (c === "f") {
      for (let k = 0; k < s.cooler.length; k++) if (sim.canCool(k)) add(k, L.COOL_AT[k].x, 0.05, L.COOL_AT[k].z + 0.4);
    } else if (c === "x") {
      // Each chamber with a free hook, marked on the floor under it.
      for (let k = 0; k <= s.dug; k++) if (s[R.SAFETY[i].field][k] < R.SAFETY[i].per) {
        const e = gearHook(i, k);
        add(k, e.ry ? e.x - 0.3 : e.x, 0.05, e.z);
      }
    }
    return n;
  };
  const showMarkers = (count, hover) => {
    for (let m = 0; m < MARKERS; m++) {
      const node = markerNodes[m];
      node.visible = m < count;
      if (m >= count) continue;
      node.position.x = candX[m];
      node.position.y = candY[m];
      node.position.z = candZ[m];
      node.scale.x = node.scale.z = m === hover ? 1.5 : 1;
      node.highlight = m === hover ? 1 : 0;
    }
  };
  const PROJ = { x: 0, y: 0, depth: 0 };
  const onDrag = (key, x, y) => {
    if (key !== drag.key) {
      drag.key = key;
      drag.count = candidates(key);
      frameSpots(drag.count);
    }
    let best = -1, bestD = DROP_REACH * DROP_REACH;
    for (let m = 0; m < drag.count; m++) {
      if (!renderer.project(candX[m], candY[m], candZ[m], PROJ)) continue;
      const d = (PROJ.x - x) * (PROJ.x - x) + (PROJ.y - y) * (PROJ.y - y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    drag.hover = best;
    showMarkers(drag.count, best);
    return best >= 0;
  };
  const onDrop = (key, x, y) => {
    if (key) onDrag(key, x, y);
    const hover = drag.hover, id = hover >= 0 ? candId[hover] : -1, count = drag.count;
    drag.key = "";
    drag.count = 0;
    drag.hover = -1;
    showMarkers(0, -1);
    if (!key) return;
    if (id < 0) {
      hud.toast(count === 0 ? why(key) : "Drop it on a lit spot");
      return;
    }
    buy(key, id);
  };

  // ---- the card ----

  const cardKey = () => `${selection.type}:${selection.id}:${s.layoutVersion}:${s.faultVersion}:${Math.floor(s.bananas / 100)}:${Math.round(s.hashprice * 1000)}:${s.powerPrice}:${phase}`;
  const factRows = [], actionRows = [];
  const newestFor = () => {
    let best = R.FIRST_ASIC;
    for (let m = R.FIRST_ASIC; m < R.MODELS.length; m++) if (s.launched[m]) best = m;
    return best;
  };
  const modelCard = (m, u) => {
    const model = R.MODELS[m], dead = u >= 0 && s.dead[u] === 1, fire = u >= 0 && burning(u), melt = u >= 0 && melting(u), profit = sim.profitOf(m);
    if (u >= 0) unitSpot(u, SPOT);
    const close = u >= 0 && near(SPOT.x, SPOT.z);
    factRows.length = actionRows.length = 0;
    factRows.push(
      ["Profit each", `${signed(profit)} a min · ${mineHud.payback(R.paybackMinutes(sim.costFor(m), profit))}`, profit < 0 ? "bad" : ""]);
    // This one as it actually runs: pushed, in oil, under the tablets, and slowed by its chamber's heat.
    if (u >= 0 && liveUnit(u)) {
      const c = R.chamberOfUnit(u), pushed = s.push[m] === 1, oil = inTank(u);
      const th = model.th * (pushed ? 1 + R.PUSH.th : 1) * (oil ? 1.1 : 1) * (s.trophy[mineSim.T_TABLETS] ? 1.05 : 1) * s.throttle[c];
      const real = (th * s.hashprice - model.kw * (pushed ? 1 + R.PUSH.kw : 1) * sim.gridPrice() / 3600) * 60;
      factRows.push(["This one earns", `${signed(real)} a min${s.throttle[c] < 1 ? ` · slowed ${Math.round((1 - s.throttle[c]) * 100)}%` : ""}`, real < 0 ? "bad" : ""]);
    }
    factRows.push(
      ["Stops paying at", `${money(R.breakEven(model, s.hashprice))} a kWh`, R.breakEven(model, s.hashprice) < sim.gridPrice() ? "bad" : ""],
      ["Hash each", `${model.th} TH`], ["Power each", `${model.kw} kW`],
      ["Watts a TH", String(Math.round(R.efficiencyOf(model)))], ["Grid now", `${money(sim.gridPrice())} a kWh`],
      [`Owned`, `${s.owned[m]}${s.broken[m] ? ` · ${s.broken[m]} dead` : ""}`, s.broken[m] ? "bad" : ""],
      ["This one", u < 0 ? "-" : fire ? "ON FIRE" : melt ? "MELTING" : dead ? "dead" : s.off[m] ? "switched off" : "running", fire || melt || dead ? "bad" : ""]
    );
    if (fire) actionRows.push({ op: "fire", label: !close ? "Get closer" : crew.carrying ? "Put it out!" : `Smother it · ${R.SMOTHER_SECONDS}s`, sub: close && !crew.carrying ? "or grab a Fire Stopper first" : "", disabled: !close });
    if (melt) actionRows.push({ op: "melt", label: close ? "Pull it!" : "Get closer", sub: "dead, not melted", disabled: !close });
    if (dead) actionRows.push({ op: "repair", label: "Repair", sub: money(sim.repairCost(u)), disabled: s.bananas < sim.repairCost(u) });
    if (s.broken[m] > (dead ? 1 : 0)) actionRows.push({ op: "repair-model", label: `Repair all ${s.broken[m]}`, sub: `every dead ${model.name}` });
    actionRows.push(
      { op: s.off[m] ? "on" : "off", label: s.off[m] ? `Switch all on` : `Switch all off`, sub: `every ${model.name}` },
      { op: "push", label: "Push It", sub: s.push[m] ? "on · +20% hash, wears them" : `${money(sim.pushCost(m))} · +20% hash`, pressed: s.push[m] === 1 }
    );
    if (u >= 0) actionRows.push({ op: "sell", label: "Sell this one", sub: `+${money(sim.resaleOf(u))}` });
    actionRows.push({ op: "sell-model", label: `Sell every ${model.name}`, sub: profit < 0 ? "they are losing money" : "" });
    return { title: `${model.name} · ${model.real}`, note: model.note, facts: factRows, actions: actionRows };
  };
  const cardFor = () => {
    const t = selection.type, id = selection.id;
    factRows.length = actionRows.length = 0;
    if (t === "unit") return s.unit[id] ? modelCard(s.unit[id] - 1, id) : null;
    if (t === "holder") {
      if (!s.pad[id]) return null;
      const h = R.HOLDERS[s.pad[id] - 1], base = R.UNIT_BAY + id * R.BAYS, newest = newestFor();
      let used = 0, dead = 0, fire = -1, first = -1;
      for (let b = 0; b < h.bays; b++) {
        if (s.unit[base + b]) {
          used++;
          if (first < 0) first = base + b;
        }
        if (s.dead[base + b]) dead++;
        if (burning(base + b)) fire = base + b;
      }
      const fill = { op: "fill", label: `Add a ${R.MODELS[newest].name}`, sub: money(sim.costFor(newest)), disabled: used >= h.bays || s.bananas < sim.costFor(newest) };
      if (used) {
        const card = modelCard(s.unit[fire >= 0 ? fire : first] - 1, fire >= 0 ? fire : first);
        card.title = `${h.name} · ${used} of ${h.bays} bays`;
        card.facts.unshift(["Dead in here", String(dead), dead ? "bad" : ""]);
        card.actions.push(fill, { op: "sell-holder", label: `Sell the ${h.name.toLowerCase()}`, sub: "and all in it" });
        if (dead) card.actions.unshift({ op: "repair-holder", label: "Repair all in here" });
        return card;
      }
      factRows.push(["Bays", `0 of ${h.bays}`], ["Cooling", h.oil ? "cold oil" : "the room's air"]);
      actionRows.push(fill, { op: "sell-holder", label: `Sell the ${h.name.toLowerCase()}` });
      return { title: `${h.name} · ${h.real}`, note: h.note, facts: factRows, actions: actionRows };
    }
    if (t === "power") {
      if (!s.power[id]) return null;
      const src = R.POWER[s.power[id] - 1];
      if (src.store) factRows.push(["Stores", `${fmt(src.store)}`], ["Battery now", `${Math.round(s.battery / s.batteryMax * 100)}%`]);
      else factRows.push(["Output now", `${Math.round(src.kw * (src.solar ? s.sun : 1))} kW`], ["Saves", `${money(src.kw * (src.solar ? s.sun : 1) * sim.gridPrice() / 60)} a min`]);
      actionRows.push({ op: "sell-power", label: "Sell it", sub: "used price" });
      return { title: src.name, note: src.note, facts: factRows, actions: actionRows };
    }
    if (t === "trophy") {
      if (!s.trophy[id]) return null;
      const tr = R.TROPHIES[id];
      actionRows.push({ op: "sell-trophy", label: "Sell it", sub: `+${money(Math.floor(tr.cost * R.TROPHY_RESALE))}` });
      return { title: tr.name, note: tr.note, facts: factRows, actions: actionRows };
    }
    if (t === "safety") {
      const k = Math.floor(id / GEAR_IDS), gear = R.SAFETY[k], c = Math.floor(id % GEAR_IDS / gear.per), held = s[gear.field][c], left = gear.per - held;
      factRows.push(["Hung here", `${held} of ${gear.per}`]);
      if (k === 2) factRows.push(["Heat now", `${Math.round(s.heat[c] * 100)}%`, s.alarmOn[c] ? "bad" : ""]);
      if (k === 0) {
        const at = L.SAFETY_AT[0][c * gear.per], close = near(at.x, at.z);
        if (crew.carrying) actionRows.push({ op: "hang", label: close ? "Hang it back" : "Get closer", disabled: !close || !left });
        else actionRows.push({ op: "take", label: !held ? "None left here" : close ? "Take it down" : "Get closer", sub: held ? "carry it to a fire" : "", disabled: !held || !close });
      }
      if (gear.per > 1) actionRows.push({ op: "gear", label: left ? "Hang another" : "Every hook full", sub: left ? money(gear.cost) : "", disabled: !left || s.bananas < gear.cost });
      return { title: `${R.DIGS[c].name} ${gear.name}`, note: GEAR_NOTES[k], facts: factRows, actions: actionRows };
    }
    if (t === "breaker") {
      const at = L.PROP_AT.breakers[id], close = near(at.x, at.z), cost = sim.chamberCost(id);
      factRows.push(["Load", `${Math.round(s.chamberKw[id])} kW`, s.chamberKw[id] > sim.circuitOf(id) ? "bad" : ""], ["Circuit", `${Math.round(sim.circuitOf(id))} kW`], ["Busbars", `${s.busbar[id]} of ${R.BUSBAR.levels}`]);
      if (s.tripped[id]) actionRows.push({ op: "breaker", label: close ? "Throw the breaker" : "Get closer", sub: s.demandKw[id] > sim.circuitOf(id) ? "still over the limit" : "", disabled: !close });
      actionRows.push({ op: "busbar", label: cost ? "Heavier busbar" : "Busbars maxed", sub: cost ? `${money(cost)} · doubles the circuit` : "", disabled: !cost || s.bananas < cost });
      return { title: `${R.DIGS[id].name} breaker`, note: s.tripped[id] ? "Tripped. Nothing in this chamber runs until someone throws it back." : "This chamber's circuit. Run more than it carries for four seconds and it trips.", facts: factRows, actions: actionRows };
    }
    if (t === "cooler") {
      if (!s.cooler[id]) return null;
      const c = R.chamberOfCool(id), fan = R.COOLERS[s.cooler[id] - 1], at = L.COOL_AT[id], close = near(at.x, at.z);
      factRows.push(["This fan", `${Math.round(R.DIGS[c].cool * fan.share)} kW of heat`], ["Chamber heat", `${Math.round(s.heat[c] * 100)}%`, s.heat[c] > R.HEAT_THROTTLE ? "bad" : ""],
        ["Carries away", `${Math.round(sim.coolingOf(c))} kW`], ["Heat in", `${Math.round(s.heatLoad[c])} kW`], ["Fans here", `${sim.fansIn(c)} of ${R.COOL_SPOTS}`]);
      if (s.fanDown[c]) actionRows.push({ op: "cooling", label: close ? "Fix the fans" : "Get closer", disabled: !close });
      actionRows.push({ op: "sell-cooler", label: "Sell it", sub: `+${money(Math.floor(fan.cost[c] * R.RESALE))}` });
      return { title: `${R.DIGS[c].name} ${fan.name}`, note: s.fanDown[c] ? "The fans in here have stopped and the heat is climbing." : "Racks on air put their heat into the chamber; fans carry it away. Over the line, everything in the chamber slows; far over, things burn.", facts: factRows, actions: actionRows };
    }
    if (id === 2) {
      // Solo's edge is the pool's cut (and the Hoodie's luck), paid in whole blocks now and then instead of a
      // slice of every one; the drought between them is the trade.
      const odds = Math.min(R.SOLO_MAX, s.share * 1.5 * s.luck), every = odds > 0 ? R.BLOCK_SECONDS / odds / 60 : 0;
      factRows.push(["Mode", s.pool ? "pool" : "solo"], ["Your share", `${(s.share * 100).toFixed(2)}%`], ["Pool cut", `${Math.round(R.POOL_FEE * 100)}%`], ["Blocks found", String(s.blocks)],
        ["Solo expected", `${Math.round(((s.luck / (1 - R.POOL_FEE)) - 1) * 100) >= 0 ? "+" : ""}${Math.round(((s.luck / (1 - R.POOL_FEE)) - 1) * 100)}% · a block every ~${every > 0 ? every.toFixed(every < 10 ? 1 : 0) : "?"} min`]);
      actionRows.push({ op: "mode", label: s.pool ? "Go solo" : "Join the pool", sub: s.pool ? "whole blocks or nothing" : "a steady share, minus a cut" });
      return { title: "Pool board", note: s.rug ? "Dark. The pool ran off with the money." : "Pool: a slice of every block. Solo: the whole block, sometimes.", facts: factRows, actions: actionRows };
    }
    if (id === 3) {
      factRows.push(["Coin price", money(s.price)], ["Market", `${s.livePrice > 0 ? "live" : "island"} · ${s.regime > 0 ? "rising" : "falling"}`], ["Grid price", `${money(sim.gridPrice())} a kWh`], ["Gear prices", s.shortage ? "up by half" : "normal"]);
      actionRows.push({ op: "sell-sats", label: "Sell the coin", sub: `+${money(R.bananasForSats(s.sats, s.price))}`, disabled: s.sats <= 0 });
      actionRows.push({ op: "contract", label: s.contractUntil > s.time ? "Contract running" : "Lock the power price", sub: s.contractUntil > s.time ? "" : `fee ${money(sim.contractFee())} · 10 min`, disabled: s.contractUntil > s.time });
      return { title: "Trader", note: "Buys your coin, sells you gear, and fixes your power price if you pay him to.", facts: factRows, actions: actionRows };
    }
    const left = R.CRACK.cap - s.crackUsed;
    actionRows.push({ op: "crack", label: `Crack it · +${R.CRACK.bananas}`, sub: left > 0 ? `${left} left` : "the rock needs a rest", disabled: left <= 0 });
    return { title: "Banana rock", note: "Bananas in the stone. Hit it. When there is nothing else, there is this.", facts: factRows, actions: actionRows };
  };
  const refreshCard = (force) => {
    if (!selection.type) return;
    const key = cardKey();
    if (!force && key === shownCard) return;
    shownCard = key;
    const content = phase === "run" ? cardFor() : null;
    if (!content) selection.type = "";
    mhud.showCard(content);
  };
  const select = (type, id) => {
    selection.type = type;
    selection.id = id;
    refreshCard(true);
  };

  // ---- driving the Ooga ----

  const DRIVE_IN = { x: 0, z: 0 };
  // The player is his Ooga from the moment he walks in: a third-person view behind him that the mouse
  // and Q E turn, and no letting go.
  const THIRD = { dist: 4.8, pitch: 0.34 };
  const takeLead = () => {
    crew.drive(0);
    shownArrivals = shownStrikes = 0;
    CRACK_AT.walking = false;
    CRACK_AT.clicks = 0;
    const p = crew.crew[0].node.position, o = pilot.orbit;
    follow.x = o.tx = p.x;
    follow.z = o.tz = p.z;
    o.ty = follow.y;
    o.target = follow;
    o.yaw = o.tYaw = crew.crew[0].heading - Math.PI;
    o.dist = o.tDist = THIRD.dist;
    o.pitch = o.tPitch = THIRD.pitch;
  };
  const controlsToast = () => hud.toast(COARSE ? `You are ${BL.characters.displayOf(crew.crew[0].name)} · the stick walks, WORK works on what is next to you, View looks round the cave`
    : `You are ${BL.characters.displayOf(crew.crew[0].name)} · W A S D walk, mouse or Q E turn, Space works on what is next to you, C cracks a rock, V looks round`);
  // The overview lets the camera off the Ooga to a chamber's preset (`view`, else the chamber he
  // stands in); the stick or a step brings it back behind him.
  const setOverview = (on, view) => {
    if (on === overview && !view) return;
    overview = on;
    if (hud.el.viewBtn) hud.el.viewBtn.setAttribute("aria-pressed", String(on));
    const o = pilot.orbit;
    if (on) {
      pilot.goPreset(view || DIG_VIEWS[Math.min(chamberAt(crew.crew[0].node.position.z), s.dug)]);
      return;
    }
    o.target = follow;
    o.tDist = THIRD.dist;
    o.tPitch = THIRD.pitch;
  };
  const showAct = (on) => {
    hud.el.act.hidden = !(on && COARSE);
    if (on) hud.setAct("WORK");
  };
  // Space while driving: a fault within reach first; otherwise whatever stands nearest, cracked if it
  // is the rock and opened as a card if it is anything else.
  const nearest = { type: "", id: -1, d: 0 };
  const consider = (type, id, x, z, px, pz) => {
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < nearest.d) {
      nearest.d = d;
      nearest.type = type;
      nearest.id = id;
    }
  };
  // A Fire Stopper hook within reach: the one to take from (`take`) or hang back on (`hang`).
  const stopperHookNear = (take) => {
    for (let c = 0; c <= s.dug; c++) {
      const held = s.extinguishers[c];
      if (take ? held <= 0 : held >= R.SAFETY[0].per) continue;
      const at = L.SAFETY_AT[0][c * R.SAFETY[0].per + (take ? held - 1 : held)];
      if (near(at.x, at.z)) return c;
    }
    return -1;
  };
  const takeStopper = (c) => {
    if (!sim.takeStopper(c, 0)) return false;
    crew.carry(true);
    audio.cue("buy");
    hud.toast("Fire Stopper in hand · carry it to the fire");
    return true;
  };
  const hangStopper = (c) => {
    if (!sim.hangStopper(c, 0)) return false;
    crew.carry(false);
    audio.cue("buy");
    hud.toast(`Fire Stopper hung back in the ${R.DIGS[c].name}`);
    return true;
  };
  const actBeside = () => {
    const p = crew.crew[crew.driven].node.position;
    if (smother.unit >= 0) return false;
    for (const f of s.faults) {
      if (!f.active) continue;
      spotOf(f.kind, f.unit, SPOT);
      if (near(SPOT.x, SPOT.z)) return workFault(f.kind, f.unit);
    }
    // Empty-handed by a hung stopper he takes it; carrying one by a free hook he hangs it back.
    const hook = stopperHookNear(!crew.carrying);
    if (hook >= 0) return crew.carrying ? hangStopper(hook) : takeStopper(hook);
    for (let u = 0; u < R.UNITS; u++) {
      if (!s.dead[u]) continue;
      unitSpot(u, SPOT);
      if (near(SPOT.x, SPOT.z) && sim.repair(u)) {
        audio.cue("fixed");
        hud.toast(`${R.MODELS[s.unit[u] - 1].name} repaired`);
        return true;
      }
    }
    nearest.type = "";
    nearest.d = DRIVE_REACH * DRIVE_REACH;
    const A = L.PROP_AT;
    for (let c = 0; c <= s.dug; c++) {
      consider("breaker", c, A.breakers[c].x, A.breakers[c].z, p.x, p.z);
    }
    for (let k = 0; k < s.cooler.length; k++) if (s.cooler[k] && R.chamberOfCool(k) <= s.dug) consider("cooler", k, L.COOL_AT[k].x, L.COOL_AT[k].z, p.x, p.z);
    for (let q = 0; q < R.PADS; q++) if (s.pad[q] && R.chamberOfPad(q) <= s.dug) consider("holder", q, L.PADS[q].x, L.PADS[q].z, p.x, p.z);
    for (let i = 0; i < R.POWER_SPOTS; i++) if (s.power[i]) consider("power", i, L.POWER_AT[i].x, L.POWER_AT[i].z, p.x, p.z);
    for (let u = 0; u < R.UNIT_BAY; u++) if (s.unit[u]) {
      unitSpot(u, SPOT);
      consider("unit", u, SPOT.x, SPOT.z, p.x, p.z);
    }
    consider("prop", 2, A.board.x, A.board.z, p.x, p.z);
    consider("prop", 3, A.trader.x, A.trader.z, p.x, p.z);
    consider("prop", 4, A.crack.x, A.crack.z, p.x, p.z);
    for (let i = 0; i < L.ROCKS.length; i++) if (L.ROCKS[i].chamber <= s.dug) consider("rock", i, L.ROCKS[i].x, L.ROCKS[i].z, p.x, p.z);
    if (!nearest.type) {
      hud.toast("Nothing to work on here");
      return false;
    }
    if (nearest.type === "rock") return crackRock(nearest.id);
    if (nearest.type === "prop" && nearest.id === 4) crackBanana();
    select(nearest.type, nearest.id);
    return true;
  };

  // Working on a fault by hand. A job is a place, so it takes being there. A fire goes out at once
  // under a carried Fire Stopper; bare-handed it is smothered over SMOTHER_SECONDS standing at it.
  const workFault = (kind, unit) => {
    for (const f of s.faults) {
      if (!f.active || f.kind !== kind || (unit >= 0 && f.unit !== unit)) continue;
      spotOf(f.kind, f.unit, SPOT);
      if (!near(SPOT.x, SPOT.z)) {
        hud.toast("Get closer to it");
        audio.cue("deny");
        return false;
      }
      if (kind === "fire" && !crew.carrying) {
        smother.unit = f.unit;
        smother.t = 0;
        smother.shown = -1;
        hud.toast("Beating it out by hand · stay at it");
        return true;
      }
      sim.fixFault(f, kind === "fire" ? 1 : 0);
      if (kind === "fire") crew.carry(false);
      audio.cue("fixed");
      hud.toast(kind === "fire" ? "Fire out" : kind === "melt" ? "Pulled it · dead, not melted" : kind === "breaker" ? "Breaker thrown back" : "Fan running");
      if (kind === "breaker") fx.burst(SPOT.x, 2, SPOT.z, 10, SPARK_BITS, 2.4);
      return true;
    }
    return false;
  };
  // The bare-hand fire, a frame at a time: gone out on its own, walked away from, or done.
  // The fire he is beating out moves along its rack; the job follows it to whichever bay burns now.
  const rackFire = (u) => {
    for (const f of s.faults) if (f.active && f.kind === "fire" && mineCrew.sameRack(f.unit, u)) return f;
    return null;
  };
  const stepSmother = (dt) => {
    if (smother.unit < 0) return;
    const f = rackFire(smother.unit);
    if (!f) {
      smother.unit = -1;
      mhud.center("", 1);
      return;
    }
    smother.unit = f.unit;
    unitSpot(smother.unit, SPOT);
    if (!near(SPOT.x, SPOT.z)) {
      smother.unit = -1;
      mhud.center("", 1);
      hud.toast("You walked away from the fire");
      return;
    }
    smother.t += dt;
    const left = Math.ceil(R.SMOTHER_SECONDS - smother.t);
    if (left !== smother.shown) {
      smother.shown = left;
      mhud.center(`SMOTHERING · ${Math.max(0, left)}`, 0);
    }
    if (smother.t < R.SMOTHER_SECONDS) return;
    sim.fixFault(f, 0);
    smother.unit = -1;
    mhud.center("", 1);
    audio.cue("fixed");
    hud.toast("Fire out");
  };
  // A jobs row tapped: look at the place and open its card.
  const onJob = (kind, id) => {
    if (phase !== "run") return;
    if (kind === "breaker") {
      const at = L.PROP_AT.breakers[id];
      lookAt(at.x, 1.4, at.z, 6);
      select("breaker", id);
    } else if (kind === "cooling") {
      const k = coolSpotOf(id), at = L.COOL_AT[k];
      lookAt(at.x, 1, at.z, 6);
      select("cooler", k);
    } else if (kind === "fire") {
      unitSpot(id, SPOT);
      lookAt(SPOT.x, SPOT.y, SPOT.z, 6);
      select("unit", id);
    } else {
      // A model: its first dead unit, else its first unit standing.
      let u = -1;
      for (let i = 0; i < R.UNITS && u < 0; i++) if (s.unit[i] === id + 1 && (kind !== "dead" || s.dead[i])) u = i;
      if (u < 0) return;
      unitSpot(u, SPOT);
      lookAt(SPOT.x, SPOT.y, SPOT.z, 6);
      select("unit", u);
    }
  };
  // Space: whatever is burning or broken nearest the view.
  const onCard = (op) => {
    const t = selection.type, id = selection.id;
    const unitOf = () => {
      if (t === "unit") return id;
      for (let b = 0; b < R.BAYS; b++) if (s.unit[R.UNIT_BAY + id * R.BAYS + b]) return R.UNIT_BAY + id * R.BAYS + b;
      return -1;
    };
    const u = t === "unit" || t === "holder" ? unitOf() : -1, m = u >= 0 ? s.unit[u] - 1 : -1;
    let ok = true;
    if (op === "fire") {
      let unit = u;
      if (t === "holder") for (let b = 0; b < R.BAYS; b++) if (burning(R.UNIT_BAY + id * R.BAYS + b)) unit = R.UNIT_BAY + id * R.BAYS + b;
      ok = workFault("fire", unit);
    } else if (op === "melt") ok = workFault("melt", u);
    else if (op === "repair") ok = sim.repair(u);
    else if (op === "repair-model") {
      const n = sim.repairModel(m);
      ok = n > 0;
      if (ok) hud.toast(`Repaired ${n} ${R.MODELS[m].name}`);
    }
    else if (op === "repair-holder") {
      ok = false;
      for (let b = 0; b < R.BAYS; b++) if (s.dead[R.UNIT_BAY + id * R.BAYS + b] && sim.repair(R.UNIT_BAY + id * R.BAYS + b)) ok = true;
    } else if (op === "on" || op === "off") {
      ok = sim.setOn(m, op === "on");
      if (!ok && op === "on") hud.toast(s.cutOff ? "The grid has cut you off. Pay what you owe." : "No power to switch on with");
    } else if (op === "push") ok = sim.setPush(m, !s.push[m]);
    else if (op === "sell") {
      const back = sim.sell(u);
      ok = back > 0;
      if (ok) hud.toast(`Sold for ${money(back)} bananas`);
    } else if (op === "sell-model") {
      const name = R.MODELS[m].name, back = sim.sellModel(m);
      ok = back > 0;
      if (ok) hud.toast(`Sold every ${name} for ${money(back)} bananas`);
    } else if (op === "fill") {
      let at = -1;
      const bays = s.pad[id] ? R.HOLDERS[s.pad[id] - 1].bays : 0;
      for (let b = 0; b < bays && at < 0; b++) if (!s.unit[R.UNIT_BAY + id * R.BAYS + b]) at = R.UNIT_BAY + id * R.BAYS + b;
      if (at >= 0) buy(`m${newestFor()}`, at);
      else hud.toast("Every bay in here is full");
      refreshCard(true);
      return;
    } else if (op === "sell-holder") hud.toast(`Sold for ${money(sim.sellHolder(id))} bananas`);
    else if (op === "sell-power") hud.toast(`Sold for ${money(sim.sellPower(id))} bananas`);
    else if (op === "sell-trophy") hud.toast(`Sold for ${money(sim.sellTrophy(id))} bananas`);
    else if (op === "breaker") ok = workFault("breaker", id);
    else if (op === "cooling") ok = workFault("cooling", R.chamberOfCool(id));
    else if (op === "sell-cooler") hud.toast(`Sold for ${money(sim.sellCooler(id))} bananas`);
    else if (op === "busbar") ok = buy("u0", id); else if (op === "gear") {
      const k = Math.floor(id / GEAR_IDS);
      ok = buy(`x${k}`, Math.floor(id % GEAR_IDS / R.SAFETY[k].per));
    } else if (op === "take") ok = takeStopper(Math.floor(id % GEAR_IDS / R.SAFETY[0].per));
    else if (op === "hang") ok = hangStopper(Math.floor(id % GEAR_IDS / R.SAFETY[0].per));
    else if (op === "mode") setMode(!s.pool);
    else if (op === "sell-sats") sellSats();
    else if (op === "contract") contract();
    else if (op === "crack") crackBanana();
    audio.cue(ok ? "buy" : "deny");
    refreshCard(true);
  };

  // ---- actions ----

  const setMode = (pool) => {
    sim.setPool(pool);
    hud.toast(pool ? "Joined the pool · a steady share, minus a cut" : "Solo · whole blocks or nothing");
  };
  const sellSats = () => {
    const got = sim.sellSats(1);
    if (got > 0) {
      audio.cue("sell");
      hud.toast(`Sold the coin for ${money(got)} bananas`);
    } else audio.cue("deny");
  };
  const contract = () => {
    if (sim.signContract()) {
      audio.cue("buy");
      hud.toast(`Power locked at ${money(s.contractPrice)} a kWh for ten minutes`);
    } else {
      audio.cue("deny");
      hud.toast(s.contractUntil > s.time ? "A contract is already running" : "Not enough bananas for the fee");
    }
  };
  // Any rock in the cave cracks for bananas, the big banana rock or one of the boulders along the
  // walls, and every one of them draws on the same hundred cracks before the rocks need a rest.
  // Cracking is a walk and a swing: he goes to the rock, and a crack lands with every strike. Every
  // click is a swing: clicks faster than he swings queue behind the one in the air, and clicks while
  // he is still walking there are all swung when he arrives.
  const CRACK_AT = { x: 0, z: 0, y: 0, walking: false, clicks: 0 };
  const crackAt = (x, z, y, size) => {
    if (s.crackUsed >= R.CRACK.cap) {
      audio.cue("deny");
      hud.toast("The rock needs a rest");
      return false;
    }
    if (CRACK_AT.walking && crew.routing && Math.hypot(x - CRACK_AT.x, z - CRACK_AT.z) < 0.5) {
      CRACK_AT.clicks = Math.min(mineCrew.SWING_QUEUE + 1, CRACK_AT.clicks + 1);
      return true;
    }
    const p = crew.crew[crew.driven].node.position, dx = p.x - x, dz = p.z - z, d = Math.max(0.01, Math.hypot(dx, dz)), stand = size + 0.7;
    CRACK_AT.x = x;
    CRACK_AT.z = z;
    CRACK_AT.y = y;
    CRACK_AT.walking = d > stand + 0.6;
    CRACK_AT.clicks = 1;
    if (CRACK_AT.walking) crew.walkTo(x + dx / d * stand, z + dz / d * stand, x, z);
    else crew.swing(x, z);
    return true;
  };
  const crackBanana = () => crackAt(L.PROP_AT.crack.x, L.PROP_AT.crack.z, 1.1, 0.8);
  const crackRock = (i) => crackAt(L.ROCKS[i].x, L.ROCKS[i].z, 0.4 + L.ROCKS[i].scale, L.ROCKS[i].scale);
  // The button and C: the nearest rock to him, the banana rock included.
  const crackNearest = () => {
    const p = crew.crew[crew.driven].node.position, A = L.PROP_AT.crack;
    let best = -1, bestD = Math.hypot(A.x - p.x, A.z - p.z);
    for (let i = 0; i < L.ROCKS.length; i++) {
      const r = L.ROCKS[i];
      if (r.chamber > s.dug) continue;
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best < 0 ? crackBanana() : crackRock(best);
  };
  const crack = (x, z, y) => {
    const got = sim.crack();
    if (got > 0) {
      audio.cue("crack");
      fx.burst(x, y, z, 4, DUST_BITS, 1.8);
      fx.sayAt(x, y + 0.9, z, `+${money(got)}`, 0.6);
    } else {
      audio.cue("deny");
      hud.toast("The rock needs a rest");
    }
  };
  const loan = () => {
    if (s.loan > 0) {
      if (sim.repayLoan()) {
        audio.cue("sell");
        hud.toast("Loan paid off");
      } else {
        audio.cue("deny");
        hud.toast(`You owe ${money(s.loan)}. Sell some coin.`);
      }
      return;
    }
    const got = sim.takeLoan();
    if (got > 0) {
      audio.cue("buy");
      hud.toast(`Borrowed ${money(got)} · pay back ${money(s.loan)} in 4 minutes`);
    }
  };
  const pause = (on) => {
    if (phase !== "run") return;
    sim.pause(on);
    mhud.setPaused(on);
    mhud.center(on ? "PAUSED" : "", on ? 0 : 1);
  };

  const finish = () => {
    if (phase === "results") return;
    phase = "results";
    smother.unit = -1;
    mhud.center("", 1);
    const improved = game.recordMine({ sats: s.minedSats, seconds: Math.max(1, Math.round(s.time)), ending: s.reason, won: s.won, score: s.score, continued: s.continued > 0 });
    audio.cue(s.won ? "win" : "lose");
    mhud.results(s, improved, game.state.mine.best, !s.won && s.reason !== "time" && s.reason !== "left");
    selection.type = "";
    showMarkers(0, -1);
    showAct(false);
    mineSim.clear();
  };
  // The coin is the real one whenever the chain has a fresh price. The first one a run sees fixes its
  // rate so the price it already shows becomes the real price; after that the sim just follows it,
  // and a feed that goes quiet hands the coin back to the island's market.
  const followCoin = () => {
    const c = BL.chain.snapshot, usd = c.live ? c.priceUsd : 0;
    if (!(usd > 0)) {
      if (s.livePrice > 0) sim.setLive(0);
      return;
    }
    // The rate is fixed by the first live price the run sees and never again, so a feed that comes and
    // goes does not move every figure on the screen.
    if (!s.rateLocked) {
      s.rate = usd / s.price;
      s.rateLocked = true;
    }
    sim.setLive(usd / s.rate);
    // The mempool's fee pressure, as the block's fees: next-block fee over the economy fee, 1 to 4.
    sim.setFees(c.economyFee > 0 && c.nextFee > 0 ? c.nextFee / c.economyFee : 0);
  };
  const saveRun = () => {
    if (!s.over && s.time > 0) mineSim.save(sim, world.mineLead);
  };
  const start = () => {
    phase = "run";
    mhud.setSection("run");
    audio.activate();
    showAct(true);
    controlsToast();
  };

  const onAction = (action) => {
    if (action === "mine-start") start();
    else if (action === "mine-sell") sellSats();
    else if (action === "mine-pack") buy("pack", -1);
    else if (action === "mine-mode") setMode(!s.pool);
    else if (action === "mine-crack") crackNearest();
    else if (action === "mine-loan") loan();
    else if (action === "mine-contract") contract();
    else if (action === "mine-curtail") {
      const paid = sim.acceptCurtail();
      if (paid > 0) {
        audio.cue("sell");
        hud.toast(`The grid paid ${money(paid)}. Everything is off for ${mineSim.CURTAIL.seconds} seconds.`);
      } else audio.cue("deny");
    } else if (action === "mine-ops-money" || action === "mine-ops-power" || action === "mine-ops-cave") mhud.showOps(action.slice(9));
    else if (action === "mine-on") {
      if (sim.allOn() > 0) audio.cue("buy");
      else hud.toast(s.cutOff ? "The grid has cut you off. Pay what you owe first." : "No power to switch on with. Wait for the grid or top up the battery.");
    } else if (action === "mine-card-close") {
      selection.type = "";
      mhud.showCard(null);
    } else if (action === "mine-pause") pause(!s.paused);
    else if (action === "mine-view") setOverview(!overview);
    else if (action === "mine-abandon") {
      if (phase === "run") sim.end("left");
    } else if (action === "mine-again") {
      world.mine = null;
      mineSim.clear();
      go("mine");
    } else if (action === "mine-keep") {
      if (sim.carryOn()) {
        phase = "run";
        mhud.setSection("run");
        showAct(true);
        hud.toast("Back to work. The debts are gone; the score keeps what you mined, and wears no medal.");
      }
    } else if (action === "mute") mhud.setMuted(audio.setMuted(!audio.muted));
    else if (action === "leave") go(home);
    else if (action === "reset-view") setOverview(true, "den");
  };

  const onTap = (hit) => {
    if (!hit || phase !== "run") return;
    const o = hit.owner;
    if (o.kind === "ooga") return;
    if (o.kind === "rock") {
      crackRock(o.id);
      return;
    }
    if (o.kind === "prop" && o.id === 4) crackBanana();
    select(o.kind, o.id);
  };
  const tooltipFor = (hit) => {
    const o = hit.owner;
    if (o.kind === "breaker") return `${R.DIGS[o.id].name} breaker · ${Math.round(s.chamberKw[o.id])} of ${Math.round(sim.circuitOf(o.id))} kW`;
    if (o.kind === "cooler") return s.cooler[o.id] ? `${R.COOLERS[s.cooler[o.id] - 1].name} · ${R.DIGS[R.chamberOfCool(o.id)].name} heat ${Math.round(s.heat[R.chamberOfCool(o.id)] * 100)}%` : "";
    if (o.kind === "battery") return `Crystal cell · ${Math.round(s.battery / Math.max(1, s.batteryMax) * 100)}% charged`;
    if (o.kind === "prop") return ["", "", "Pool board · pool or solo", "Trader · coin and power prices", "Banana rock · tap to crack"][o.id];
    if (o.kind === "unit") return s.unit[o.id] ? `${R.MODELS[s.unit[o.id] - 1].name} · ${signed(sim.profitOf(s.unit[o.id] - 1))} a min${s.dead[o.id] ? " · dead" : ""}` : "";
    if (o.kind === "holder") return s.pad[o.id] ? R.HOLDERS[s.pad[o.id] - 1].name : "";
    if (o.kind === "power") return s.power[o.id] ? R.POWER[s.power[o.id] - 1].name : "";
    if (o.kind === "trophy") return R.TROPHIES[o.id].name;
    if (o.kind === "safety") return `${R.SAFETY[Math.floor(o.id / GEAR_IDS)].name} · ${["take it down and carry it to a fire", "throws a trip back by itself", "warns before it runs too hot"][Math.floor(o.id / GEAR_IDS)]}`;
    if (o.kind === "rock") return s.crackUsed < R.CRACK.cap ? "Rock · tap to crack for bananas" : "Rock · the rocks need a rest";
    if (o.kind === "ooga") return o.id === 0 ? `${BL.characters.displayOf(crew.crew[0].name)} · you` : `${BL.characters.displayOf(crew.crew[o.id].name)} · crew`;
    return "";
  };

  // The island's live chain: a real block pays the pool a share of its own fees, or gives solo one
  // roll at the whole thing. The only place the scene reaches outside itself.
  const onFeed = (event) => {
    if (!event || event.type !== "block" || phase !== "run" || s.over) return;
    const fees = Math.max(0, Math.round((event.txCount || 0) * 1400));
    const won = sim.onRealBlock(fees);
    audio.cue("realblock");
    ripple = 1.6;
    if (won > 0) {
      hud.toast(s.pool ? `Block ${event.height} · the pool paid you ${fmt(won)} sats` : `BLOCK ${event.height} IS YOURS · ${(won / 1e8).toFixed(3)} coin`);
      const at = crew.crew[0].node.position;
      fx.burst(at.x, 2.6, at.z, s.pool ? 10 : 36, fxMod.CONFETTI, 2.6);
    } else hud.toast(`Block ${event.height} went to someone else`);
  };

  const onDonation = (donation) => {
    game.recordDonation(donation);
    const bananas = gameMod.bananasFor(donation.sats) * 400;
    s.bananas += bananas;
    hud.toast(`+${money(bananas)} bananas from ${donation.handle ? "@" + donation.handle : "anon"}`);
    hud.setStats(game.state);
  };

  const onKey = (e) => {
    if (e.key === "Escape") {
      if (selection.type) {
        selection.type = "";
        mhud.showCard(null);
      } else if (phase === "run" && !s.paused) pause(true);
      else go(home);
      return;
    }
    if (e.repeat) return;
    if (e.key === "0") setOverview(true, "den");
    else if ((e.key === "v" || e.key === "V") && phase === "run") setOverview(!overview);
    else if (e.key === "m" || e.key === "M") mhud.setMuted(audio.setMuted(!audio.muted));
    else if ((e.key === "s" || e.key === "S") && e.shiftKey && phase === "run") sellSats();
    else if ((e.key === "c" || e.key === "C") && phase === "run") crackNearest();
    else if ((e.key === "p" || e.key === "P") && phase === "run") pause(!s.paused);
    else if (e.key === "Enter" && phase === "intro") start();
  };

  // What the log says happened since the last frame, turned into sound and words. Only runs when the
  // log's version moves, and only reads the entries it has not seen.
  const readLog = () => {
    const fresh = Math.min(mineSim.LOG_MAX, s.logVersion - shownLog);
    shownLog = s.logVersion;
    for (let k = fresh; k > 0; k--) {
      const e = s.log[(s.logAt - k + mineSim.LOG_MAX) % mineSim.LOG_MAX];
      if (e.kind === "block") {
        audio.cue("block");
        ripple = 2.4;
        mhud.center("BLOCK FOUND", 2200);
        fx.burst(0, 3, 2, 40, fxMod.CONFETTI, 3);
      } else if (e.kind === "paid") {
        // One tick a hundredth of a coin, not one every block for an hour.
        const hundredths = Math.floor(s.minedSats / 1e6);
        if (hundredths !== paidShown) {
          paidShown = hundredths;
          audio.cue("paid");
        }
      } else if (e.kind === "won") {
        audio.cue("win");
        ripple = 3;
        mhud.center("21 COIN · MEDAL BANKED · THE HOUR PLAYS ON", 3600);
        hud.toast("The win is yours. Keep mining: the score keeps counting, and the halving is still to come.");
        fx.burst(crew.crew[0].node.position.x, 3, crew.crew[0].node.position.z, 40, fxMod.CONFETTI, 3);
      } else if (e.kind === "launch") {
        const m = R.MODELS[e.a];
        audio.cue("milestone");
        mhud.center(`NEW · ${m.name.toUpperCase()} · ${m.th} TH AT ${m.kw} KW`, 2600);
        mhud.ticker(`${m.name} is out: ${Math.round(R.efficiencyOf(m))} watts a TH · older models got cheaper`, "good");
      } else if (e.kind === "halving") {
        ripple = 3;
        mhud.center("THE HALVING · 3.125 → 1.5625 A BLOCK", 3200);
        halvingDim = 2;
        mhud.ticker("The reward halved · the used market flooded, older models 30% cheaper · check what still pays", "bad");
      } else if (e.kind === "retarget") mhud.ticker(`Network ${e.a >= 0 ? "up" : "down"} ${Math.abs(e.a / 10).toFixed(1)}% · ${e.b >= 0 ? "+" : ""}${mineHud.hash(e.b)} (${Math.round(s.hash * R.NET_FOLLOW)} TH copying you) · retarget`, e.a >= 0 ? "bad" : "good");
      else if (e.kind === "overload") {
        audio.cue("breaker");
        const at = L.PROP_AT.breakers[e.a];
        fx.burst(at.x - 0.3, 2.2, at.z, 16, SPARK_BITS, 3);
        mhud.ticker(`${R.DIGS[e.a].name} breaker tripped · too much on one circuit · throw it back, add a busbar or spread the load`, "bad");
      } else if (e.kind === "blackout") {
        audio.cue("breaker");
        mhud.ticker("The battery ran dry · everything is off until the grid is back", "bad");
      } else if (e.kind === "cutoff") {
        audio.cue("bad");
        mhud.ticker("CUT OFF · you owe the grid more than it will carry · sell coin or a machine", "bad");
      } else if (e.kind === "restored") mhud.ticker("Paid up · the grid is back on", "good");
      else if (e.kind === "curtailed") mhud.ticker("Curtailment over · switch back on", "");
      else if (e.kind === "regime") mhud.ticker(e.a > 0 ? "The coin market turned up" : "The coin market turned down", e.a > 0 ? "good" : "bad");
      else if (e.kind === "meltdown") {
        audio.cue("meltdown");
        mhud.center(`MELTDOWN ${e.b} OF 3`, 2600);
      } else if (e.kind === "melt") {
        audio.cue("bad");
        mhud.center("MELTDOWN COMING · PULL IT", 2000);
        mhud.ticker(`${R.MODELS[s.unit[e.a] - 1].name} glowing red in the ${R.DIGS[R.chamberOfUnit(e.a)].name} · pull it before it melts`, "bad");
      } else if (e.kind === "pulled") mhud.ticker("Pulled in time · dead, not melted", "good");
      else if (e.kind === "nearmiss") mhud.ticker("The cold oil saved a machine from a meltdown", "good");
      else if (e.kind === "jumped") {
        audio.cue("fire");
        mhud.ticker("The fire jumped to the next rack", "bad");
      } else if (e.kind === "repossessed") hud.toast(e.a > 0 ? `They took ${e.a} thing${e.a > 1 ? "s" : ""} for the loan: racks first, then generators, then trophies` : "The loan is written off");
      else if (e.kind === "worn") mhud.ticker(`A pushed ${R.MODELS[s.unit[e.a] - 1] ? R.MODELS[s.unit[e.a] - 1].name : "machine"} burned out`, "bad");
      else if (e.kind === "burned") audio.cue("fire");
      else if (e.kind === "doused") {
        unitSpot(e.a, SPOT);
        fx.burst(SPOT.x, SPOT.y + 0.3, SPOT.z, e.b ? 24 : 8, e.b ? FOAM_BITS : DUST_BITS, e.b ? 2.2 : 1.4);
      } else if (e.kind === "autoreset") {
        audio.cue("fixed");
        mhud.ticker(`The spare breaker threw the ${R.DIGS[e.a].name} back on`, "good");
      } else if (e.kind === "smoke") {
        audio.cue("bad");
        mhud.ticker(`SMOKE ALARM · the ${R.DIGS[e.a].name} is at ${e.b}% heat · add a fan or switch something off`, "bad");
      }
      else if (e.kind === "extension") {
        audio.cue("bad");
        mhud.ticker(`Loan extended · you now owe ${money(e.b)}${e.a >= R.LOAN.extensions.length ? " · LAST CHANCE" : ""}`, "bad");
      } else if (e.kind === "gift") mhud.ticker(e.a >= 0 ? `Someone left a ${R.MODELS[e.b].name} in your rack` : `Someone left a ${R.MODELS[e.b].name} · no room, so you sold it`, "good");
      else if (e.kind === "insured") mhud.ticker(`The charm paid ${money(e.a)} back`, "good");
      else if (e.kind === "event") {
        const ev = mineSim.EVENTS[e.a];
        // The event banner with its countdown is the one notice; the ticker does not say it again.
        audio.cue(ev.good ? "good" : "bad");
        if (ev.id === "surge") for (let c = 0; c <= s.dug; c++) fx.burst(L.PROP_AT.breakers[c].x - 0.3, 2.2, L.PROP_AT.breakers[c].z, 16, SPARK_BITS, 3);
      }
    }
  };

  // ---- the frame ----

  const update = (dt) => {
    // Driving: the stick walks the Ooga relative to the camera, and Q E still turn the view. In the
    // overview the camera is off him: Q E and a drag turn it, and the stick brings it back to him.
    // The free camera only reads the keys when nobody is driven.
    const driving = crew.driven >= 0 && phase === "run" && !overview;
    if (driving) {
      const a = pilot.controls.read(), yaw = pilot.orbit.yaw;
      DRIVE_IN.x = -Math.sin(yaw) * a.y + Math.cos(yaw) * a.x;
      DRIVE_IN.z = -Math.cos(yaw) * a.y - Math.sin(yaw) * a.x;
      pilot.orbit.tYaw += a.yaw * 1.8 * dt;
    } else if (overview && crew.driven >= 0 && phase === "run") {
      const a = pilot.controls.read();
      if (a.x || a.y) setOverview(false);
      else pilot.orbit.tYaw += a.yaw * 1.8 * dt;
    } else pilot.readInput(dt);
    if (phase === "run") {
      sim.tick(dt);
      if (s.over) finish();
      else if (!s.paused) {
        stepSmother(dt);
        saveTimer -= dt;
        if (saveTimer <= 0) {
          saveTimer = SAVE_SECONDS;
          saveRun();
        }
      }
    }
    if (s.logVersion !== shownLog) readLog();
    if (s.layoutVersion !== shownLayout || s.faultVersion !== shownFaults) syncLayout();
    if (s.milestoneVersion !== shownMilestone) {
      shownMilestone = s.milestoneVersion;
      if (s.milestone >= 0) {
        mhud.milestone(mineSim.MILESTONES[s.milestone]);
        audio.cue("milestone");
        ripple = Math.max(ripple, 2);
        fx.burst(pilot.orbit.target.x, 2.6, pilot.orbit.target.z, 30, fxMod.CONFETTI, 2.6);
      }
    }
    if (s.event !== shownEvent) {
      shownEvent = s.event;
      hudTimer = 0;
    }
    // The sun down the shaft answers the island's clock; sampled on a timer, not every frame.
    sunTimer -= dt;
    if (sunTimer <= 0) {
      sunTimer = 2;
      daylight.sample(clock.read(), SKY, clock.dayOfYear, daylight.ISLAND_LATITUDE_DEG, clock.continuousDay);
      sim.setSun(SKY.sunStrength);
      props.sky.glow = 0.2 + SKY.sunStrength * 0.8;
    }
    // The last ten seconds before the halving count down in the middle of the screen; the lamps dip at the cut.
    if (phase === "run" && !s.halved) {
      const to = Math.ceil(R.HALVING_AT - s.time);
      if (to <= 10 && to > 0 && to !== halvingShown) {
        halvingShown = to;
        mhud.center(`HALVING IN ${to}`, 0);
        audio.cue("paid");
      }
    }
    if (halvingDim > 0) {
      halvingDim -= dt;
      const dip = halvingDim > 0 ? 0.3 + 0.7 * Math.abs(Math.sin(halvingDim * 6)) : 1;
      for (const lamp of lampNodes) lamp.glow = dark() ? 0.15 : dip;
      if (halvingDim <= 0) lightTimer = 0;
    }
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.2;
      mhud.setStrip(s, sim);
      mhud.setJobs(s, sim);
      mhud.setEvent(s.event >= 0 ? mineSim.EVENTS[s.event].id : null, s.event >= 0 && mineSim.EVENTS[s.event].good, s.eventUntil - s.time, s.event >= 0 ? mineSim.EVENTS[s.event].seconds : 0);
    }
    paletteTimer -= dt;
    if (paletteTimer <= 0) {
      paletteTimer = 0.5;
      mhud.refreshPalette(tileInfo);
    }
    cardTimer -= dt;
    if (cardTimer <= 0) {
      cardTimer = 0.5;
      refreshCard(false);
    }
    lightTimer -= dt;
    if (lightTimer <= 0) {
      lightTimer = 0.25;
      followCoin();
      syncLights();
      if (s.candleVersion !== shownCandles) syncCandles();
      if (s.histVersion !== shownHist) syncHashChart();
    }
    labelTimer -= dt;
    if (labelTimer <= 0) {
      labelTimer = 1;
      syncChartLabels();
    }
    if (crew.update(dt, s, sim, phase === "run" && !s.paused, driving ? DRIVE_IN : null) > 0) audio.cue("fixed");
    // Sent to a rock, he swings on arrival; the crack itself lands with the pickaxe.
    if (crew.arrivals !== shownArrivals) {
      shownArrivals = crew.arrivals;
      if (CRACK_AT.walking) {
        CRACK_AT.walking = false;
        crew.swing(CRACK_AT.x, CRACK_AT.z, CRACK_AT.clicks);
      }
    }
    // Swings only ever come from cracking, so every strike is a crack at the rock he was sent to.
    if (crew.strikes !== shownStrikes) {
      shownStrikes = crew.strikes;
      crack(CRACK_AT.x, CRACK_AT.z, CRACK_AT.y);
    }
    if (driving) {
      const p = crew.crew[crew.driven].node.position;
      follow.x = p.x;
      follow.z = p.z;
      if (pilot.orbit.target !== follow) pilot.orbit.target = follow;
    }
    // Each chamber's fan turns with its heat and stops dead when it fails, trips or the power goes.
    const out = dark();
    // Each cooling fan spins up to about twenty turns a second, harder when its chamber runs hot, and
    // coasts down when it fails, trips or loses power. Past a few turns a second the blades give way
    // to the blurred disc, turned at eight or so a second: as fast as a frame can show it moving on.
    for (let c = 0; c <= s.dug; c++) {
      const want = out || s.fanDown[c] || s.tripped[c] ? 0 : FAN_SPEED * (0.8 + Math.min(1, s.heat[c]) * 0.3);
      fanSpeed[c] += (want - fanSpeed[c]) * Math.min(1, dt * (want > fanSpeed[c] ? 1.4 : 0.7));
      const blurred = fanSpeed[c] > FAN_BLUR;
      const geo = blurred ? MM.fanBlur() : MM.fanBlade(), turn = dt * (blurred ? fanSpeed[c] * 0.4 : fanSpeed[c]);
      for (let k = c * R.COOL_SPOTS; k < (c + 1) * R.COOL_SPOTS; k++) {
        if (!s.cooler[k]) continue;
        if (bladeNodes[k].geometry !== geo) bladeNodes[k].geometry = geo;
        bladeNodes[k].rotation.z += turn;
      }
    }
    // The crystal cell glows with the battery's charge.
    batteryNode.glow = 0.25 + s.battery / Math.max(1, s.batteryMax) * 0.9;
    // A sounding smoke alarm blinks its light; a quiet one glows faintly.
    const blink = Math.floor(sceneTime * 4) % 2 ? 1.6 : 0.15;
    for (let c = 0; c <= s.dug; c++) gearNodes[2][c].glow = s.alarmOn[c] ? blink : 0.4;
    // Flames flicker; the fire itself is the sim's.
    for (let f = 0; f < FLAMES; f++) {
      const node = flameNodes[f];
      if (!node.visible) continue;
      const k = 0.85 + Math.sin(performance.now() * 0.02 + f * 1.7) * 0.2;
      node.scale.x = node.scale.z = 0.7 * k;
      node.scale.y = k;
      if (Math.random() < dt * 6) fx.burst(node.position.x, node.position.y + 0.4, node.position.z, 1, FIRE_BITS, 1);
    }
    // A block, a milestone or the halving rolls a wave of light down every rack.
    if (ripple > 0) {
      ripple = Math.max(0, ripple - dt);
      const t = ripple * 6;
      for (let k = 0; k < ASIC_MODELS; k++) {
        const data = asicBatches[k].instanceData, count = asicCount[k];
        if (!count) continue;
        for (let n = 0; n < count; n++) {
          const base = asicGlow[k * R.UNITS + n];
          if (base <= 0) continue;
          data[n * 20 + 16] = ripple > 0 ? base * (1 + Math.max(0, Math.sin(t + data[n * 20 + 14] * 0.4)) * 1.4) : base;
        }
        asicBatches[k].instanceVersion++;
      }
    }
    // Dust drifts slowly in its own chamber and wraps at the chamber's walls; written in place, never
    // spawned, and fixed in the world whatever the camera does.
    sceneTime += dt;
    const data = motes.instanceData;
    for (let i = 0; i < MOTES; i++) {
      const c = moteChamber[i], ch = L.CHAMBERS[c], o = i * 20;
      if (c > s.dug) {
        data[o + 13] = -50;
        continue;
      }
      moteX[i] = wrap(moteX[i] + Math.sin(sceneTime * 0.3 + motePhase[i]) * 0.12 * dt, ch.x0 + 0.3, ch.x1 - 0.3);
      moteY[i] = wrap(moteY[i] + (Math.sin(sceneTime * 0.5 + motePhase[i] * 2) * 0.08 - 0.02) * dt, MOTE_Y[0], Math.min(ch.h - 0.5, MOTE_Y[1] + c));
      moteZ[i] = wrap(moteZ[i] + Math.cos(sceneTime * 0.27 + motePhase[i]) * 0.12 * dt, ch.z0 + 0.3, ch.z1 - 0.3);
      data[o + 12] = moteX[i];
      data[o + 13] = moteY[i];
      data[o + 14] = moteZ[i];
      data[o + 16] = 0.35 + Math.sin(sceneTime * 1.3 + motePhase[i]) * 0.25;
    }
    motes.instanceVersion++;
    // The Steam Vents breathe.
    if (!dark()) for (let i = 0; i < R.POWER_SPOTS; i++) {
      if (s.power[i] === 3 && powerNodes[i].visible && Math.random() < dt * 2.5) {
        const at = L.POWER_AT[i];
        fx.puff(at.x + (Math.random() - 0.5) * 0.3, 1.4, at.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 1.2, (Math.random() - 0.5) * 0.3, 1.6);
      }
    }
    // The drop targets breathe while something is being carried.
    if (drag.count) for (let m = 0; m < drag.count; m++) markerNodes[m].glow = 0.7 + Math.sin(performance.now() * 0.008 + m) * 0.3;
    audio.update(dt, s);
    fx.update(dt);
    stepTweens(dt);
    pilot.update(dt);
  };

  // Faults are marked on the overlay so the player can see where the job is from across the cave, and
  // the marker fills in once the view is close enough to work on it by hand.
  const SCREEN = { x: 0, y: 0, behind: false };
  const drawExtra = (ctx, project) => {
    let dead = 0;
    for (let m = 0; m < R.MODELS.length; m++) dead += s.broken[m];
    if (!s.faultCount && !dead) return;
    for (const f of s.faults) {
      if (!f.active) continue;
      spotOf(f.kind, f.unit, SPOT);
      project(SPOT.x, SPOT.y + 1.1, SPOT.z, SCREEN);
      if (SCREEN.behind) continue;
      const close = near(SPOT.x, SPOT.z), fire = f.kind === "fire" || f.kind === "melt";
      ctx.beginPath();
      ctx.arc(SCREEN.x, SCREEN.y, close ? 14 : 10, 0, Math.PI * 2);
      ctx.strokeStyle = fire ? "#ff7a2f" : "#f0a83c";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      if (close) {
        ctx.fillStyle = fire ? "rgba(255, 122, 47, 0.35)" : "rgba(240, 168, 60, 0.3)";
        ctx.fill();
      }
    }
    // Dead units: a small red cross where each one stands.
    let drawn = 0;
    for (let u = 0; u < R.UNITS && drawn < 60; u++) {
      if (!s.dead[u]) continue;
      unitSpot(u, SPOT);
      project(SPOT.x, SPOT.y + 0.3, SPOT.z, SCREEN);
      if (SCREEN.behind) continue;
      drawn++;
      ctx.beginPath();
      ctx.moveTo(SCREEN.x - 5, SCREEN.y - 5);
      ctx.lineTo(SCREEN.x + 5, SCREEN.y + 5);
      ctx.moveTo(SCREEN.x + 5, SCREEN.y - 5);
      ctx.lineTo(SCREEN.x - 5, SCREEN.y + 5);
      ctx.strokeStyle = "#e5533d";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  };
  const overlay = (dt) => fx.drawOverlay(dt, drawExtra);

  // ---- the visit ----

  const enter = (ctx) => {
    ({ renderer, game, world, go } = ctx);
    home = ctx.from === "arcade" ? "arcade" : "hub";
    camera = createCamera({ fov: 58, near: 0.2, far: 120 });
    root = createNode();
    // The run lives on `world` for the page life, so walking out to the island does not end an hour's
    // work. It waits while you are away: the sim only runs in here.
    // A run left on the page is picked up as it was, and one saved by an earlier page before that.
    if (!world.mine) {
      const saved = mineSim.load();
      if (saved) {
        world.mine = saved.sim;
        if (saved.lead) world.mineLead = saved.lead;
      }
    }
    sim = world.mine || (world.mine = mineSim.create({ seed: (Date.now() / 1000 | 0) % 100000 || 1 }));
    s = sim.state;
    overview = false;
    smother.unit = -1;
    saveTimer = SAVE_SECONDS;
    phase = s.over ? "results" : s.time > 0 ? "run" : "intro";
    clock = daylight.createClock({ hour: hourParam, daylen: daylenParam, day: dayParam, time: timeParam, now: new Date() });

    hud = hudMod.create({ roster: contributors.activeRoster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled: ctx.lootEnabled });
    hooks = {};
    input = interactMod.create({ canvas: ctx.canvas, renderer, camera, hooks });
    // Space and the WORK button both come through the pilot's action: whatever is beside the Ooga.
    pilot = pilotMod.create({ renderer, canvas: ctx.canvas, camera, hud, presets: PRESETS, landing: "den", pitch: PITCH, dist: DIST, fly: FLY, clampTarget, clampCamera, coarse: COARSE,
      onFreeAction: () => phase === "run" && (actBeside(), true) });
    hud.el.viewBtn = document.getElementById("mine-view-btn");
    const shared = { root, input, hooks, hud, game, world, renderer, camera, overlay: ctx.overlay };
    fx = shared.fx = fxMod.create(shared);
    pilot.bind(shared);
    audio = mineAudio.create();

    cave = MM.cave();
    place(cave.root);
    // The boulders along the walls, inside their chambers so they show as the cave is dug.
    L.ROCKS.forEach((r, i) => {
      const node = createNode({ geometry: BL.hubModels.rock(r.variant), position: { x: r.x, y: -0.08, z: r.z }, rotation: { x: 0, y: r.ry, z: 0 }, scale: { x: r.scale, y: r.scale, z: r.scale } });
      addChild(cave.chambers[r.chamber], node);
      target(node, { kind: "rock", id: i });
    });
    const prop = (geo, at, owner) => {
      const node = place(createNode({ geometry: geo, position: { x: at.x, y: at.y || 0, z: at.z }, rotation: { x: 0, y: at.ry || 0, z: 0 } }));
      if (owner) target(node, owner);
      return node;
    };
    const A = L.PROP_AT;
    props = {
      board: prop(MM.poolBoard(), A.board, { kind: "prop", id: 2 }),
      trader: prop(MM.traderStall(), A.trader, { kind: "prop", id: 3 }),
      crack: prop(MM.crackRock(), A.crack, { kind: "prop", id: 4 }),
      bench: prop(MM.workbench(), A.workbench, null),
      shelves: prop(MM.shelves(), A.shelves, null),
      trophyShelf: prop(MM.trophyShelf(), A.trophyShelf, null),
      sky: prop(MM.skyHole(), { x: A.shaft.x, y: L.CHAMBERS[0].h - 0.02, z: A.shaft.z }, null)
    };
    props.price = place(createNode({ geometry: MM.priceBoard(0), position: { x: A.trader.x, y: 0, z: A.trader.z }, rotation: { x: 0, y: A.trader.ry, z: 0 } }));
    props.chart = place(createNode({ geometry: MM.chartScreen(), position: { x: A.trader.x, y: 0, z: A.trader.z }, rotation: { x: 0, y: A.trader.ry, z: 0 } }));
    // Candles up, down and their wicks, then the last-price line; the pool board's bars and squares.
    candles = [0, 1, 2, 3].map((i) => place(createNode({ geometry: i < 3 ? MM.candle(i) : MM.chartMark(1), instanceData: new Float32Array((i < 3 ? mineSim.CANDLES : 1) * 20), instanceCount: 0, instanceVersion: 0, fixedInstanceCapacity: true })));
    hashMarks = [0, 1].map((i) => place(createNode({ geometry: MM.chartMark(i), instanceData: new Float32Array(mineSim.SAMPLES * 20), instanceCount: 0, instanceVersion: 0, fixedInstanceCapacity: true })));
    // The type panels hang on each board in its own frame, so the board's turn carries them.
    chartLabels = [[A.trader, MM.CHART, MM.CHART.z + 0.012], [A.board, MM.POOL_CHART, MM.POOL_CHART.z + 0.012]].map(([at, C, z]) => {
      const holder = place(createNode({ position: { x: at.x, y: 0, z: at.z }, rotation: { x: 0, y: at.ry, z: 0 } }));
      const panel = createNode({ position: { x: C.labelX, y: C.labelY, z } });
      addChild(holder, panel);
      return panel;
    });
    labelCanvas = document.createElement("canvas");
    labelCanvas.width = 200;
    labelCanvas.height = 100;
    labelCtx = labelCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
    for (const key of Object.keys(labelState)) labelState[key] = -1;
    shownCandles = shownHist = -1;
    labelTimer = 0;
    breakers = A.breakers.map((at, c) => prop(MM.breakerPanel(), at, { kind: "breaker", id: c }));
    levers = A.breakers.map((at) => place(createNode({ geometry: MM.breakerLever(), position: { x: at.x - 0.14, y: 1.2, z: at.z }, rotation: { x: 0, y: at.ry, z: 0 } })));
    bladeNodes = [];
    fanNodes = L.COOL_AT.map((at, k) => {
      const node = place(createNode({ geometry: MM.boxFan(), position: { x: at.x, y: 0, z: at.z }, rotation: { x: 0, y: at.ry, z: 0 }, visible: false }));
      const blade = createNode({ geometry: MM.fanBlade() });
      addChild(node, blade);
      bladeNodes.push(blade);
      target(node, { kind: "cooler", id: k });
      return node;
    });
    fanSpeed.fill(0);
    lampNodes = L.LAMPS.map((l) => place(createNode({ geometry: MM.lamp(), position: { x: l.x, y: l.y, z: l.z } })));
    busbars = L.BUSBAR_AT.map((at) => place(createNode({ geometry: MM.busbarRiser(at.chamber), position: { x: at.x, y: 0, z: at.z }, visible: false })));
    batteryNode = prop(MM.crystalCell(), A.battery, { kind: "battery", id: 0 });

    // Fixed pools. Nothing below is ever created again for the life of the visit.
    cpuNodes = L.BENCH.map((at, i) => {
      const node = place(createNode({ geometry: MM.pebbleBox(), position: { x: at.x, y: at.y, z: at.z }, rotation: { x: 0, y: at.ry, z: 0 }, visible: false }));
      target(node, { kind: "unit", id: R.UNIT_BENCH + i });
      return node;
    });
    gpuNodes = L.SHELF.map((at, i) => {
      const node = place(createNode({ geometry: MM.shinyRocks(), position: { x: at.x, y: at.y, z: at.z }, rotation: { x: 0, y: at.ry, z: 0 }, visible: false }));
      target(node, { kind: "unit", id: R.UNIT_SHELF + i });
      return node;
    });
    padNodes = L.PADS.map((at) => place(createNode({ geometry: MM.pad(), position: { x: at.x, y: 0, z: at.z }, rotation: { x: 0, y: at.ry, z: 0 }, visible: false })));
    holderNodes = L.PADS.map((at, p) => {
      const node = place(createNode({ geometry: MM.rackFrame(), position: { x: at.x, y: 0, z: at.z }, rotation: { x: 0, y: at.ry, z: 0 }, visible: false }));
      target(node, { kind: "holder", id: p });
      return node;
    });
    powerNodes = L.POWER_AT.map((at, i) => {
      const node = place(createNode({ geometry: MM.POWER_BUILDERS[0](), position: { x: at.x, y: 0, z: at.z }, rotation: { x: 0, y: at.ry, z: 0 }, visible: false }));
      target(node, { kind: "power", id: i });
      return node;
    });
    trophyNodes = L.TROPHY_AT.map((at, i) => {
      const node = place(createNode({ geometry: MM.trophy(i), position: { x: at.x, y: at.y, z: at.z }, rotation: { x: 0, y: at.ry, z: 0 }, visible: false }));
      target(node, { kind: "trophy", id: i });
      return node;
    });
    gearNodes = L.SAFETY_AT.map((hooks, k) => hooks.map((at, i) => {
      const node = place(createNode({ geometry: GEAR_GEO[k](), position: { x: at.x, y: at.y, z: at.z }, rotation: { x: 0, y: at.ry, z: 0 }, visible: false }));
      target(node, { kind: "safety", id: k * GEAR_IDS + i });
      return node;
    }));
    markerNodes = [];
    for (let m = 0; m < MARKERS; m++) markerNodes.push(place(createNode({ geometry: MM.marker(), visible: false })));
    flameNodes = [];
    for (let f = 0; f < FLAMES; f++) flameNodes.push(place(createNode({ geometry: MM.flame(), visible: false })));
    asicBatches = [];
    for (let k = 0; k < ASIC_MODELS; k++) {
      asicBatches.push(place(createNode({ geometry: MM.asic(k), instanceData: new Float32Array(R.PADS * R.BAYS * 20), instanceCount: 0, instanceVersion: 0, fixedInstanceCapacity: true })));
    }
    fixedObstacles();
    const moteData = new Float32Array(MOTES * 20);
    for (let i = 0; i < MOTES; i++) moteData[i * 20] = moteData[i * 20 + 5] = moteData[i * 20 + 10] = moteData[i * 20 + 15] = 1;
    motes = place(createNode({ geometry: models.particleGeometry("#e8d9b0", 0.035, 0.8), instanceData: moteData, instanceCount: MOTES, instanceVersion: 0, fixedInstanceCapacity: true }));
    sceneTime = 0;
    // The player is whoever walked in; with nobody chosen, the Ooga this run already had, or one at random.
    const names = contributors.activeRoster.length ? contributors.activeRoster : contributors.roster;
    const known = (name) => names.some((c) => c.name === name);
    if (known(world.pilot)) world.mineLead = world.pilot;
    else if (!known(world.mineLead)) world.mineLead = names[Math.floor(Math.random() * names.length)].name;
    world.pilot = null;
    crew = mineCrew.create({ root, fx, world: { inside, obstacles, station, spotOf, chamberAt, doorZ }, lead: world.mineLead });
    takeLead();
    // A stopper carried out of the cave, or through a reload, is still in his hand.
    if (s.carrying) crew.carry(true, sim);
    paidShown = Math.floor(s.minedSats / 1e6);
    halvingDim = 0;
    halvingShown = -1;
    if (phase === "run") controlsToast();
    // Tapping an Ooga takes him over.
    for (const op of crew.crew) for (const key of ["torso", "head"]) target(op.cave.parts[key], { kind: "ooga", id: op.index });

    mhud = mineHud.create({ best: game.state.mine.best, coarse: COARSE, geometryFor, onTile: (key) => {
      if (key[0] === "t" && s.trophy[Number(key.slice(1))]) select("trophy", Number(key.slice(1)));
      else buy(key, -1);
    }, onDrag, onDrop, onCard, onJob });
    mhud.setPlayer(BL.characters.displayOf(crew.crew[0].name));
    hud.dismissOutside(mhud.el.card, () => {
      selection.type = "";
      mhud.showCard(null);
    });
    Object.assign(hooks, {
      onHover: (hit, p) => {
        if (hit && !mhud.dragging) hud.tooltip.show(tooltipFor(hit), p.x, p.y);
        else hud.tooltip.hide();
      },
      onHoverMove: (hit, p) => {
        if (!mhud.dragging) hud.tooltip.show(tooltipFor(hit), p.x, p.y);
      },
      onTap,
      ...pilot.hooks
    });
    hud.onPreset(pilot.goPreset);
    hud.onAction(onAction);
    const donationRequest = donations.createRequest(game.state);
    qr.drawTo(hud.el.qr, donationRequest.url, { quiet: 3, dark: "#000000", light: "#f3efe4" });
    hud.setDonationUrl(donationRequest.url);
    hud.setIdentity(game.state);
    hud.setStats(game.state);
    hud.el.sheet.dataset.open = "false";

    mhud.setSection(phase);
    if (phase === "results") mhud.results(s, false, game.state.mine.best, !s.won && s.reason !== "time" && s.reason !== "left");
    mhud.setMuted(audio.muted);
    mhud.setPaused(s.paused);
    if (phase === "run" && s.paused) mhud.center("PAUSED", 0);
    showAct(phase === "run");
    shownLayout = shownFaults = -1;
    shownMilestone = s.milestoneVersion;
    shownLog = s.logVersion;
    shownEvent = s.event;
    shownCard = "";
    selection.type = "";
    hudTimer = paletteTimer = sunTimer = lightTimer = cardTimer = 0;
    ripple = 0;
    syncLayout();

    if (BL.mempool && BL.mempool.subscribe) unsubscribeFeed = BL.mempool.subscribe(onFeed);
    minuteTimer = window.setInterval(() => fx.trimPool(), 6e4);

    Object.assign(mineScene, {
      root, camera, input,
      // No Agent lives here, so only the controls hook is offered; Shift+A finds nothing to play.
      agentControls: pilot.controls,
      debug: {
        // `__ooga.mine` is the handle the suite and the console drive the run through.
        mine: {
          sim, state: s, rigs: R, hud: mhud, crew, start, finish, buy, onDrag, onDrop, select, onCard, crackAt, crackNearest, actBeside, workFault, inside, obstacles, pilot, audio,
          // Drives the scene's own update in fixed steps, so a check exercises the displayed-frame path.
          simulate: (seconds) => {
            for (let left = seconds; left > 0; left -= 0.25) update(Math.min(0.25, left));
          },
          setOverview, takeStopper, hangStopper, save: saveRun,
          get overview() {
            return overview;
          },
          get carrying() {
            return crew.carrying;
          },
          get smothering() {
            return smother.unit;
          },
          realBlock: (fees) => sim.onRealBlock(fees || 0),
          setBananas: (n) => {
            s.bananas = n;
          },
          unitSpot: (u) => unitSpot(u, { x: 0, y: 0, z: 0, ry: 0, rx: 0 }),
          get phase() {
            return phase;
          },
          get root() {
            return root;
          },
          get boxes() {
            let n = 0;
            for (let k = 0; k < ASIC_MODELS; k++) n += asicBatches[k].instanceCount;
            return n;
          },
          get markers() {
            let n = 0;
            for (const node of markerNodes) if (node.visible) n++;
            return n;
          }
        },
        camera, pilot, controls: pilot.controls, audio
      }
    });
    pilot.update(0);
  };

  const leave = () => {
    window.clearInterval(minuteTimer);
    minuteTimer = 0;
    if (unsubscribeFeed) unsubscribeFeed();
    unsubscribeFeed = null;
    showAct(false);
    hud.el.viewBtn = null;
    // The run stays on `world` and in storage; only the visit's view of it is torn down. A finished
    // run goes, from both.
    if (s.over && phase === "results") {
      world.mine = null;
      mineSim.clear();
    } else saveRun();
    audio.dispose();
    crew.dispose();
    fx.dispose();
    pilot.dispose();
    for (const node of targets) input.remove(node);
    targets.length = 0;
    for (const node of placed) removeChild(root, node);
    placed.length = 0;
    for (const batch of asicBatches) {
      batch.instanceData = new Float32Array(20);
      batch.instanceCount = 0;
    }
    motes.instanceData = new Float32Array(20);
    motes.instanceCount = 0;
    for (const batch of candles.concat(hashMarks)) {
      batch.instanceData = new Float32Array(20);
      batch.instanceCount = 0;
    }
    for (const panel of chartLabels) if (panel.geometry) renderer.releaseGeometry(panel.geometry);
    const count = input.targetCount;
    input.dispose();
    mhud.dispose();
    hud.dispose();
    drag.key = "";
    drag.count = 0;
    selection.type = "";
    hud = mhud = hooks = input = pilot = fx = audio = crew = clock = cave = props = asicBatches = motes = candles = hashMarks = chartLabels = labelCanvas = labelCtx = null;
    cpuNodes = gpuNodes = padNodes = holderNodes = powerNodes = trophyNodes = gearNodes = markerNodes = flameNodes = lampNodes = busbars = null;
    breakers = levers = fanNodes = bladeNodes = batteryNode = null;
    sim = s = null;
    mineScene.input = mineScene.debug = mineScene.agentControls = null;
    return { targets: count };
  };

  // Pooled nodes are hidden rather than removed, so every geometry one of them can show is named here,
  // or housekeeping frees a buffer the next purchase is about to want back.
  const liveGeometry = (set) => {
    set.add(MM.pebbleBox()).add(MM.shinyRocks()).add(MM.rackFrame()).add(MM.coldPool()).add(MM.pad())
      .add(MM.marker()).add(MM.flame()).add(MM.seal()).add(MM.fanBlade()).add(MM.fanBlur()).add(MM.candle(0)).add(MM.candle(1)).add(MM.candle(2)).add(MM.chartMark(0)).add(MM.chartMark(1)).add(MM.priceBoard(0)).add(MM.priceBoard(1)).add(MM.fanWall()).add(MM.boxFan());
    for (let c = 0; c < NC; c++) set.add(MM.chamberDecor(c));
    for (let k = 0; k < ASIC_MODELS; k++) set.add(MM.asic(k));
    for (const build of MM.POWER_BUILDERS) set.add(build());
    for (let i = 0; i < R.TROPHIES.length; i++) set.add(MM.trophy(i));
    crew.liveGeometry(set);
  };

  const stats = () => {
    let nodes = 0, boxes = 0;
    traverseVisible(root, () => nodes++);
    for (const batch of asicBatches) boxes += batch.instanceCount;
    const all = (n) => 1 + n.children.reduce((sum, c) => sum + all(c), 0);
    return {
      visibleNodes: nodes, allNodes: all(root), tweens: tweenCount(), targets: input.targetCount,
      boxes, faults: s.faultCount, ...fx.stats()
    };
  };

  const mineScene = {
    id: "mine", enter, update, overlay, onDonation, onKey, onLootCleared: () => {}, renderOpts: RENDER_OPTS,
    leave, stats, liveGeometry,
    root: null, camera: null, input: null, debug: null, agent: null, agentControls: null,
    get inMotion() {
      return fx ? fx.inMotion : false;
    }
  };
  BL.scenes = BL.scenes || {};
  BL.scenes.mine = mineScene;
})();
