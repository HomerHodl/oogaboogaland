// Build on the pad, release clamps, stage to the Sky Top, sky-hook hold, spacewalk, fall home shield first.
//
// Ooga Orbit. Phases `build`, `count`, `ignite`, `ascent`, `orbit`, `eva`, `descent`, `down`, `boom`,
// `results`. The pad builder; the side camera on the way up (downrange to the right); the camera-relative
// pod turn with rim air puffs and the attitude ball. The Sky Top goal is `TOP` = `rocket.ORBIT_ALT` (500):
// reaching it with anything still rising hands the flight to the sky hook, which reels it over the pad and
// holds it still with `flight.hold`, then after the spacewalk lets go with `flight.stand` and a downward
// throw. The climb autopilot follows `leanTarget` by height (an arc capped at 40 degrees), flies whenever A
// and D are left alone, G toggles it, and draws a yellow aim line. The log gives the reason a flight missed
// orbit; the mission checklist has seven steps, the one in hand lit with a live detail, skipped and failed
// ones struck. The spacewalk (phase `eva`) is a suited copy of the pilot on a tether in the pod's own frame,
// flying to the space rock, measuring it and climbing back in. Falling stages, smoke puffs and plasma
// streaks live in fixed rings of instanced batches; the sky darkens with height; donations and `leave`.
//
// A tapped tank or fin joins the stage under the last Vine Knot; a pod goes on top and a shield under it.
// Scoring: thrift (`SCORE.thrift` a banana under `REF_BILL`) and a fast climb (`SCORE.fast`, from the clamps
// to the top against `FAST_BEST`) on a completed mission, `SCORE.hand` for a climb flown without the
// autopilot, the pad on a gradient from its middle, and a failed flight capped under bronze. A stage
// dropped with fuel is counted (`fuelWasted`) and named in the post-mortem; descent Space always reaches
// `pullChute` so an early press explains itself. The spacewalk has `EVA_AIR` seconds of air (the tether
// reels in at zero, leftover air pays) and the rock's place in the pod's frame (`eva.rockE/U/F`) is drawn per
// launch. A pad landing gets confetti, the ticker and a word from the Agent.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, contributors, donations, qr, terrain, hubModels, dropModels, rocketModels, rocketParts, rocket: rocketMod, rocketHud, rocketAudio, daylight, pile: pileMod, game: gameMod, hud: hudMod, interact: interactMod, controls: controlsMod, fx: fxMod } = BL;
  const { clamp, lerp, damp, quat, mulberry32, fnv1a } = math;
  const { createNode, addChild, removeChild, createCamera, addTween, stepTweens, tweenCount, traverseVisible } = BL.scene;
  const { CONFETTI } = fxMod;
  const { R, CY, GM, SEA, SPACE_ALT, ORBIT_ALT } = rocketMod;
  // TOP is the Sky Top (ORBIT_ALT) - the goal of a flight, not true orbit.
  const TOP = ORBIT_ALT;
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has("debug");
  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  const timeParam = DEBUG ? params.get("time") : null;
  const hourParam = DEBUG ? parseFloat(params.get("hour")) : NaN;
  const daylenParam = DEBUG ? parseFloat(params.get("daylen")) : NaN;
  const dayParam = DEBUG ? parseFloat(params.get("day")) : NaN;
  const latitudeParam = DEBUG ? parseFloat(params.get("latitude")) : NaN;
  const islandLatitude = Number.isFinite(latitudeParam) ? Math.max(-66, Math.min(66, latitudeParam)) : daylight.ISLAND_LATITUDE_DEG;
  const SEED = 1;
  const METER_CAPACITY = 60;
  const FIXED = 1 / 120, MAX_SUBSTEPS = 4;
  // Space in GREEN [.55,.86] frees the clamps, GOLD [.66,.78] is perfect; early staggers, late strains, full pops.
  const COUNT_T = 3, SPOOL_T = 2.6, GREEN = [0.55, 0.86], GOLD = [0.66, 0.78], EARLY = { boost: 0.55, t: 2.2, kick: -0.3 }, LATE_HEAT = 0.3;
  const STAGE_DELAY = 0.45, STUCK_T = 4;
  // The sky hook reels the flight over the pad at TOP and holds it still so the islands stay in view.
  // After the spacewalk it lets go and throws the pod down shield first at THROW.
  const REEL_T = 4, THROW = 12, PUFF_EVERY = 0.05;
  // EVA rock offsets (e, u, f) are in the pod's own frame: side, up, ahead.
  // Bumps push the Ooga back at the restitution and keep some speed (no air); steadying pauses for EVA.drift.
  const EVA = { size: 0.85, rockE: 9, rockU: 4.5, rockF: 6.5, tether: 18, reach: 2.8, hatch: 3, accel: 4, max: 3.2, settle: 2.4, measure: 3.6, eye: 5.5, body: 0.45, rockR: 1.05, podR: 1, bounce: 0.12, drift: 0.35 };
  // Thrift pays for every banana under REF_BILL on a completed mission; `fast` for a quick climb to the top
  // measured from the clamps' release; `hand` for a climb flown without the autopilot; a pad landing pays on a
  // gradient from its middle.
  const SCORE = { perfect: 200, good: 100, space: 300, orbit: 1000, stage: 100, home: 500, cool: 300, pad: 1500, padBase: 900, islet: 1000, island: 700, land: 400, sea: 300, near: 500, nearRange: 600, eva: 700, thrift: 2, hand: 400, fast: 400 };
  const REF_BILL = 600, FAST_BEST = 28, FAST_SPAN = 40;
  // Air for the spacewalk, in seconds; the tether reels the walker in when it runs out.
  const EVA_AIR = 40;
  const LANDED_T = 2.6, BOOM_T = 3;
  // DEBRIS.life = seconds a dropped stage falls before it is gone; DEBRIS.pod = the pod's radius for stage hits.
  const DEBRIS = { life: 30, pod: 1.1 };
  const AXIS = new Float32Array(3);
  const SMOKE = 220, PLASMA = 90, PLASMA_BOX = 14, FIREBALLS = 4;
  const CLOUDS = 70;
  const CHASE = { side: 16, sideElevation: 0.12, orbitDist: 16, orbitElevation: 0.9, orbitYaw: 0.5, podDist: 16, podElevation: 0.85, chuteDist: 17, chuteElevation: 0.22, eyeRate: 6, targetRate: 12, orbitRate: 2.5 };
  const FOV = 50 * Math.PI / 180;
  const TICKER_AT = { x: 0, y: 14, z: 0 };
  const FIRE = models.particleGeometry("#ff8a2a", 0.22, 1);
  const EMBER = models.particleGeometry("#ffd36a", 0.14, 1);
  const CHAR = models.particleGeometry("#2b221c", 0.2, 0);
  const SPLINTER = models.particleGeometry("#8a6236", 0.16, 0);
  const SPRAY = models.particleGeometry("#e8f4fb", 0.16, 0.3);
  const SPRAY_DK = models.particleGeometry("#7fb8d8", 0.12, 0.2);
  const BOOM_BITS = [FIRE, EMBER, CHAR, SPLINTER];
  const SPLASH_BITS = [SPRAY, SPRAY_DK];
  const RENDER_OPTS = {
    clear: new Float32Array(3), horizon: new Float32Array(3), zenith: new Float32Array(3), sky: new Float32Array(3), ground: new Float32Array(3), sun: new Float32Array(3), direct: new Float32Array(3),
    light: { x: 0.55, y: 0.78, z: -0.25 }, sunDirection: { x: 0, y: 1, z: 0 }, moon: { x: 0, y: 1, z: 0 }, starMatrix: new Float32Array(9),
    stars: 0, torch: 0, day: 1, twilight: 0, lampFactor: 0, directStrength: 1, sunStrength: 1, moonStrength: 0, ambientFloor: 0.18, diffuseFloor: 0, shadowStrength: 1, shadowFloor: 0, shadowBias: 0.002,
    time: 0, bloomStrength: 0.55, lights: new Float32Array(80), lightCount: 0, shadowCenter: { x: 0, y: 0, z: 0 }, shadowExtent: 34, fog: null, fogNear: 260, fogFar: 900
  };
  RENDER_OPTS.starMatrix[0] = RENDER_OPTS.starMatrix[4] = RENDER_OPTS.starMatrix[8] = 1;
  RENDER_OPTS.fog = RENDER_OPTS.horizon;
  RENDER_OPTS.clouds = 0.4;
  const SPACE_ZENITH = [0.004, 0.006, 0.02], SPACE_HORIZON = [0.16, 0.34, 0.62], SPACE_CLEAR = [0.004, 0.006, 0.02];
  const setVec = (v, x, y, z) => {
    v.x = x;
    v.y = y;
    v.z = z;
    return v;
  };
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const smooth = (t) => {
    const k = clamp(t, 0, 1);
    return k * k * (3 - 2 * k);
  };
  const mark = (name) => {
    performance.clearMarks(`ooga:${name}`);
    performance.mark(`ooga:${name}`);
  };
  const selection = { pilot: contributors.roster[0].name, assist: true };
  // No lean off the pad, tipping as the air thins to LEAN_MAX 40 deg; autopilot flies it while A and D are idle.
  const LEAN_FROM = 50, LEAN_OVER = 160, LEAN_CURVE = 0.55, LEAN_MAX = 40 * Math.PI / 180;
  const leanTarget = (alt) => Math.pow(clamp((alt - LEAN_FROM) / LEAN_OVER, 0, 1), LEAN_CURVE) * LEAN_MAX;

  // One visit's state: made in enter, dropped in leave.
  // Where the game exits to: back to Ooga Arcade when a cabinet started it, otherwise the island.
  let home = "hub";
  let renderer, game, world, go, lootEnabled, testBananas, root, camera, island, hud, rhud, hooks, input, fx, controls, audio, clock, spot, planet, flight, view, passenger, canopy, heatShell, smoke, plasma, splashNode;
  let astro, astroStick, astroLight, rockNode, tetherNode, agent;
  // The rock's place in the pod's frame is drawn per launch (rockE, rockU, rockF), so the walk is a small hunt.
  const eva = { measured: false, back: false, reeling: false, measuring: 0, reading: 0, drift: 0, tumble: 0, spin: 0, e: 0, u: 0, f: 0, ve: 0, vu: 0, vf: 0, yaw: 0, pitch: 0, near: "", puff: 0, air: EVA_AIR, bonus: 0, out: false, rockE: EVA.rockE, rockU: EVA.rockU, rockF: EVA.rockF };
  let phase = "build", stack = [], selected = -1, sceneTime = 0, flightTime = 0, accumulator = 0, phaseT = 0, countShown = 0, gauge = 0, release = null, igniteIn = 0;
  // The clock from the clamps to the top, whether the climb was flown by hand throughout, and fuel dropped unburnt.
  let releasedAt = 0, topAt = 0, handFlown = true, fuelWasted = 0, launches = 0;
  let puffClock = 0, reelT = 0;
  // REEL holds where the sky hook reels the flight from (x0,y0,z0) and to (x1,y1,z1).
  const REEL = { x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 };
  let orbited = false, spaceCalled = false, stagesDropped = 0, chuteCalled = false, warnAt = 0, flipAt = 0, leanHinted = false, result = null, failure = null, score = 0;
  let meterTimer = 0, stateTimer = 0, hintTimer = 0;
  const placed = [];
  const debris = [];
  const fireballs = [];
  const partTargets = [];
  const EYE = { x: 0, y: 0, z: 0 };
  const LOCAL = { ux: 0, uy: 1, uz: 0, dx: 0, dy: 0, dz: 1 };
  const HEAD = { x: 0, y: 0, z: 1 };
  // Speech comes from the top of the pod wherever it is.
  const speaker = { root: { position: { x: 0, y: 0, z: 0 } }, headOffset: 0.6 };
  const placeSpeaker = () => {
    const p = speaker.root.position;
    if (flight && phase !== "build") {
      const s = flight.state;
      setVec(p, s.p.x + s.up[0] * s.height / 2, s.p.y + s.up[1] * s.height / 2, s.p.z + s.up[2] * s.height / 2);
    } else setVec(p, spot.x, spot.padY + view.height, spot.z);
  };
  const CAM_RETURN_AFTER = 1.5, CAM_RETURN_RATE = 4;
  const cam = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, ox: 0, oy: 0, oz: 0, ax: 0, ay: 0, az: 0, warm: false, offset: 0, tilt: 0, dragAt: -9, buildYaw: -0.64, buildPitch: 0.18, buildZoom: 1, shake: 0 };
  const ctrl = { throttle: 0, lean: 0, pitch: 0, roll: 0, yaw: 0 };
  let inputLocked = false;
  const orbitScene = {
    id: "orbit", renderOpts: RENDER_OPTS, root: null, camera: null, input: null, debug: null, agent: null, agentControls: null,
    get inMotion() {
      return (phase !== "build" && phase !== "results") || fx.inMotion || smoke.count > 0;
    }
  };

  // Islands, then the site's pad and deck, else the sea (the flight reads the sea from its own height).
  const groundAt = (x, z) => {
    const g = rocketModels.siteGroundAt(spot, x, z);
    if (g > -Infinity) return g;
    return island.onLand(x, z) ? island.surfaceAt(x, z) : -Infinity;
  };
  // The world's up at a point and the launch plane's downrange there.
  const localAt = (x, y, z) => {
    const uy = y - CY, r = Math.hypot(x, uy, z);
    LOCAL.ux = x / r; LOCAL.uy = uy / r; LOCAL.uz = z / r;
    const dl = Math.hypot(LOCAL.uz, LOCAL.uy) || 1;
    LOCAL.dx = 0; LOCAL.dy = -LOCAL.uz / dl; LOCAL.dz = LOCAL.uy / dl;
    return r - R;
  };

  // Smoke is a fixed ring of puffs written into one instanced batch.
  const spawnSmoke = (x, y, z, vx, vy, vz, size, life) => {
    const i = smoke.next;
    smoke.next = (i + 1) % SMOKE;
    smoke.x[i] = x; smoke.y[i] = y; smoke.z[i] = z;
    smoke.vx[i] = vx; smoke.vy[i] = vy; smoke.vz[i] = vz;
    smoke.age[i] = 0; smoke.life[i] = life; smoke.size[i] = size;
  };
  const updateSmoke = (dt) => {
    const data = smoke.node.instanceData;
    let count = 0;
    for (let i = 0; i < SMOKE; i++) {
      if (smoke.age[i] >= smoke.life[i]) continue;
      smoke.age[i] += dt;
      const k = smoke.age[i] / smoke.life[i];
      if (k >= 1) continue;
      const drag = Math.max(0, 1 - 1.1 * dt);
      smoke.vx[i] *= drag; smoke.vy[i] *= drag; smoke.vz[i] *= drag;
      smoke.x[i] += smoke.vx[i] * dt; smoke.y[i] += smoke.vy[i] * dt; smoke.z[i] += smoke.vz[i] * dt;
      const s = smoke.size[i] * (0.55 + 1.9 * k), o = count * 20;
      data[o] = s; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0;
      data[o + 4] = 0; data[o + 5] = s; data[o + 6] = 0; data[o + 7] = 0;
      data[o + 8] = 0; data[o + 9] = 0; data[o + 10] = s; data[o + 11] = 0;
      data[o + 12] = smoke.x[i]; data[o + 13] = smoke.y[i]; data[o + 14] = smoke.z[i]; data[o + 15] = 1;
      data[o + 16] = 1; data[o + 17] = 0; data[o + 18] = -1 - 0.8 * Math.pow(1 - k, 1.3); data[o + 19] = 0;
      count++;
    }
    smoke.count = count;
    smoke.node.instanceCount = count;
    smoke.node.visible = count > 0;
    if (count) smoke.node.instanceVersion++;
  };
  // Plasma streaks in a box round the pod while the air burns, reseeded ahead as they fall behind.
  const updatePlasma = (glow) => {
    const node = plasma.node, s = flight && flight.state;
    if (!s || glow < 0.05 || s.speed < 4) {
      node.instanceCount = 0;
      node.visible = false;
      return;
    }
    const p = s.p, v = s.v, speed = s.speed, data = node.instanceData;
    const dx = v.x / speed, dy = v.y / speed, dz = v.z / speed;
    const ax = Math.abs(dy) < 0.9 ? 0 : 1, ay = Math.abs(dy) < 0.9 ? 1 : 0;
    let px = ay * dz, py = -ax * dz, pz = ax * dy - ay * dx;
    const pl = Math.hypot(px, py, pz) || 1;
    px /= pl; py /= pl; pz /= pl;
    const qx = dy * pz - dz * py, qy = dz * px - dx * pz, qz = dx * py - dy * px;
    const len = clamp(speed * 0.1, 0.6, 4);
    const count = Math.round(PLASMA * clamp(glow, 0, 1));
    for (let i = 0; i < count; i++) {
      let x = plasma.x[i] - p.x, y = plasma.y[i] - p.y, z = plasma.z[i] - p.z;
      if (x * dx + y * dy + z * dz < -PLASMA_BOX * 0.6 || Math.abs(x) > PLASMA_BOX || Math.abs(y) > PLASMA_BOX || Math.abs(z) > PLASMA_BOX) {
        const ahead = Math.random() * 2, a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 2.2;
        x = dx * ahead + (px * Math.cos(a) + qx * Math.sin(a)) * r;
        y = dy * ahead + (py * Math.cos(a) + qy * Math.sin(a)) * r;
        z = dz * ahead + (pz * Math.cos(a) + qz * Math.sin(a)) * r;
        plasma.x[i] = p.x + x; plasma.y[i] = p.y + y; plasma.z[i] = p.z + z;
      }
      const o = i * 20;
      data[o] = px; data[o + 1] = py; data[o + 2] = pz; data[o + 3] = 0;
      data[o + 4] = qx; data[o + 5] = qy; data[o + 6] = qz; data[o + 7] = 0;
      data[o + 8] = -dx * len; data[o + 9] = -dy * len; data[o + 10] = -dz * len; data[o + 11] = 0;
      data[o + 12] = plasma.x[i]; data[o + 13] = plasma.y[i]; data[o + 14] = plasma.z[i]; data[o + 15] = 1;
      data[o + 16] = 1; data[o + 17] = 0; data[o + 18] = 0; data[o + 19] = 0;
    }
    node.instanceCount = count;
    node.visible = count > 0;
    node.instanceVersion++;
  };

  const padBase = () => setVec(EYE, spot.x, spot.padY, spot.z);
  const clearPartTargets = () => {
    for (const n of partTargets) input.remove(n);
    partTargets.length = 0;
  };
  const rebuildView = () => {
    if (view) {
      clearPartTargets();
      removeChild(root, view.node);
    }
    view = rocketModels.assemble(stack);
    view.node.quaternion = quat.create();
    setVec(view.node.position, spot.x, spot.padY, spot.z);
    addChild(root, view.node);
    for (let i = 0; i < view.parts.length; i++) {
      input.add(view.parts[i].node, { kind: "part", index: i, priority: 1 });
      partTargets.push(view.parts[i].node);
    }
    const top = view.parts[view.parts.length - 1];
    if (top && top.part.kind === "pod") {
      addChild(top.node, passenger.root);
      // Head and shoulders out of the top (y 0.86 on gourdpod, else 1.02), facing the builder's eye.
      setVec(passenger.root.position, 0, top.part.id === "gourdpod" ? 0.86 : 1.02, 0);
      passenger.root.rotation.y = -0.64;
      addChild(top.node, canopy, heatShell);
      setVec(canopy.position, 0, top.part.h + 0.2, 0);
    }
    canopy.visible = false;
    heatShell.visible = false;
    markSelected();
  };
  const buildPassenger = () => {
    if (passenger && passenger.root.parent) removeChild(passenger.root.parent, passenger.root);
    passenger = models.caveman(contributors.traitsFor(selection.pilot));
    const k = 0.6;
    setVec(passenger.root.scale, k, k, k);
    if (astro) removeChild(root, astro.root);
    astro = models.caveman(contributors.traitsFor(selection.pilot));
    const h = astro.traits.height;
    astro.root.quaternion = quat.create();
    setVec(astro.root.scale, EVA.size, EVA.size, EVA.size);
    addChild(astro.parts.head, createNode({ position: { x: 0, y: 0.13 * h, z: 0 }, scale: { x: h, y: h, z: h }, geometry: rocketModels.helmet(), smokeOpacity: 0.45 }));
    addChild(astro.root, createNode({ position: { x: 0, y: 0.06 * h, z: -0.18 * h }, scale: { x: h, y: h, z: h }, geometry: hubModels.jetpack() }));
    // The stick rides in the right hand pointing out of it; the tip light blinks while it reads.
    astroStick = createNode({ position: { x: 0, y: -0.62 * h, z: 0.06 * h }, rotation: { x: Math.PI, y: 0, z: 0 }, scale: { x: 1, y: 0.01, z: 1 }, geometry: rocketModels.measureStick(), visible: false });
    astroLight = createNode({ position: { x: 0, y: 0.95, z: 0 }, geometry: rocketModels.readingLight() });
    addChild(astroStick, astroLight);
    addChild(astro.parts.armR, astroStick);
    astro.root.visible = false;
    addChild(root, astro.root);
  };
  const markSelected = () => {
    for (let i = 0; i < view.parts.length; i++) view.parts[i].node.highlight = i === selected ? 0.55 : 0;
  };
  const refreshBuilder = () => {
    rebuildView();
    rhud.renderStack(stack, selected, rocketParts.check(stack), rocketParts.stats(stack));
  };
  // A tapped part lands where it belongs: pod on top, shield under the pod, anything else under the pod's section.
  const addPart = (id) => {
    if (phase !== "build") return;
    if (stack.length >= rocketParts.MAX_PARTS) {
      hud.toast(`The pad holds ${rocketParts.MAX_PARTS} parts`);
      return;
    }
    const part = rocketParts.partOf(id);
    const podAt = stack.findIndex((p) => rocketParts.partOf(p).kind === "pod");
    const shieldAt = stack.findIndex((p) => rocketParts.partOf(p).kind === "shield");
    if (part.kind === "pod") {
      if (podAt >= 0) stack.splice(podAt, 1, id);
      else stack.push(id);
      selected = stack.indexOf(id);
    } else if (part.kind === "shield") {
      if (shieldAt >= 0) stack.splice(shieldAt, 1, id);
      else stack.splice(podAt >= 0 ? podAt : stack.length, 0, id);
      selected = stack.indexOf(id);
    } else {
      // Under the last Vine Knot when there is one, so the part joins the stage below it rather than the
      // pod's section (where a tank or fin would break the knot rule); else under the shield or the pod.
      const knotAt = stack.map((p) => rocketParts.partOf(p).kind).lastIndexOf("sep");
      const at = knotAt >= 0 ? knotAt : shieldAt >= 0 ? shieldAt : podAt >= 0 ? podAt : stack.length;
      stack.splice(at, 0, id);
      selected = at;
    }
    audio.cues.tick();
    refreshBuilder();
  };
  // Insert/move take stack indices, 0 at the bottom; the pad rocket and the stack list rebuild from the new order.
  const insertPart = (id, at) => {
    if (phase !== "build") return;
    if (stack.length >= rocketParts.MAX_PARTS) {
      hud.toast(`The pad holds ${rocketParts.MAX_PARTS} parts`);
      return;
    }
    stack.splice(clamp(at, 0, stack.length), 0, id);
    selected = clamp(at, 0, stack.length - 1);
    audio.cues.tick();
    refreshBuilder();
  };
  const movePartTo = (from, at) => {
    if (phase !== "build" || from < 0 || from >= stack.length) return;
    const [id] = stack.splice(from, 1);
    const to = clamp(at > from ? at - 1 : at, 0, stack.length);
    stack.splice(to, 0, id);
    selected = to;
    audio.cues.tick();
    refreshBuilder();
  };
  // Where the rocket's part boundaries sit on screen, bottom up, for drops onto it (rocket-hud slots()).
  const SLOTS = { x: 0, reach: 0, ys: [] }, PROJ = { x: 0, y: 0, depth: 0 };
  const rocketSlots = () => {
    if (phase !== "build" || !view || !renderer.project(spot.x, spot.padY, spot.z, PROJ)) return null;
    SLOTS.x = PROJ.x;
    SLOTS.ys.length = 0;
    SLOTS.ys.push(PROJ.y);
    let y = 0;
    for (const part of view.parts) {
      y += part.part.h;
      if (!renderer.project(spot.x, spot.padY + y, spot.z, PROJ)) return null;
      SLOTS.ys.push(PROJ.y);
    }
    SLOTS.reach = renderer.project(spot.x + 1.4, spot.padY + y / 2, spot.z, PROJ) ? Math.max(70, Math.abs(PROJ.x - SLOTS.x) * 2.5) : 70;
    return SLOTS;
  };
  const movePart = (i, dir) => {
    const j = i + dir;
    if (phase !== "build" || j < 0 || j >= stack.length) return;
    const t = stack[i];
    stack[i] = stack[j];
    stack[j] = t;
    selected = j;
    refreshBuilder();
  };
  const removePart = (i) => {
    if (phase !== "build") return;
    stack.splice(i, 1);
    selected = Math.min(selected, stack.length - 1);
    refreshBuilder();
  };
  const selectPart = (i) => {
    selected = selected === i ? -1 : i;
    markSelected();
    rhud.renderStack(stack, selected, rocketParts.check(stack), rocketParts.stats(stack));
  };
  const usePreset = (name) => {
    if (phase !== "build") return;
    const preset = rocketParts.PRESETS.find((p) => p.name === name);
    stack.length = 0;
    if (preset) stack.push(...preset.stack);
    selected = -1;
    refreshBuilder();
    if (preset) hud.toast(`${preset.name} on the pad`);
  };
  const cyclePilot = () => {
    const roster = contributors.roster, i = roster.findIndex((c) => c.name === selection.pilot);
    selection.pilot = roster[(i + 1) % roster.length].name;
    rhud.setPilot(selection.pilot);
    buildPassenger();
    rebuildView();
    fx.say(speaker, "Ooga fly!", 1.2);
  };

  // A dropped stage keeps its parts' nodes under a group that falls on its own.
  const onDrop = (d) => {
    const s = flight.state;
    const bx = s.p.x - s.up[0] * s.height / 2, by = s.p.y - s.up[1] * s.height / 2, bz = s.p.z - s.up[2] * s.height / 2;
    const node = createNode({ position: { x: bx, y: by, z: bz }, quaternion: quat.copy(quat.create(), s.q) });
    for (let i = d.from; i < d.to; i++) {
      const part = view.parts[i];
      removeChild(view.node, part.node);
      addChild(node, part.node);
      if (part.fire) part.fire.visible = false;
    }
    for (let i = d.to; i < view.parts.length; i++) view.parts[i].node.position.y -= d.height;
    addChild(root, node);
    let wide = 0;
    for (let i = d.from; i < d.to; i++) wide = Math.max(wide, view.parts[i].part.r);
    debris.push({ node, len: d.height, wide, clear: false, v: { x: s.v.x - s.up[0] * 1.6, y: s.v.y - s.up[1] * 1.6, z: s.v.z - s.up[2] * 1.6 }, w: { x: s.right[0] * 0.5 + s.front[0] * 0.2, y: s.right[1] * 0.5 + s.front[1] * 0.2, z: s.right[2] * 0.5 + s.front[2] * 0.2 }, t: 0 });
    stagesDropped++;
    score += SCORE.stage;
    // Fuel still in the stage goes down with it.
    const left = flight.fuel[d.stage], full = flight.stages[d.stage].fuel;
    if (left > 0.01 && full > 0) {
      fuelWasted += left;
      rhud.notice(`Stage dropped with ${Math.round(left / full * 100)}% fuel still in it`, 2200);
    }
    audio.cues.stage();
    const jx = bx + s.up[0] * d.height, jy = by + s.up[1] * d.height, jz = bz + s.up[2] * d.height;
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      spawnSmoke(jx, jy, jz, s.v.x + Math.cos(a) * 3, s.v.y, s.v.z + Math.sin(a) * 3, 0.5, 1.4);
    }
    cam.shake = Math.max(cam.shake, 0.35);
  };
  // A falling stage is a segment up its axis as wide as its widest part; the pod is a ball around its middle.
  const hitsPod = (d) => {
    const p = d.node.position, c = flight.state.p;
    quat.rotateVec(AXIS, d.node.quaternion, 0, 1, 0);
    const k = clamp((c.x - p.x) * AXIS[0] + (c.y - p.y) * AXIS[1] + (c.z - p.z) * AXIS[2], 0, d.len);
    const dx = p.x + AXIS[0] * k - c.x, dy = p.y + AXIS[1] * k - c.y, dz = p.z + AXIS[2] * k - c.z, reach = d.wide + DEBRIS.pod;
    return dx * dx + dy * dy + dz * dz < reach * reach;
  };
  const updateDebris = (dt) => {
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i], p = d.node.position;
      d.t += dt;
      const alt = localAt(p.x, p.y, p.z), r = alt + R, g = GM / (r * r);
      const drag = Math.max(0, 1 - 0.6 * rocketMod.densityAt(alt) * dt);
      d.v.x = (d.v.x - LOCAL.ux * g * dt) * drag;
      d.v.y = (d.v.y - LOCAL.uy * g * dt) * drag;
      d.v.z = (d.v.z - LOCAL.uz * g * dt) * drag;
      p.x += d.v.x * dt;
      p.y += d.v.y * dt;
      p.z += d.v.z * dt;
      quat.integrate(d.node.quaternion, d.node.quaternion, d.w.x, d.w.y, d.w.z, dt);
      const ground = alt < rocketMod.NEAR_GROUND ? groundAt(p.x, p.z) : -Infinity;
      // A stage leaves touching the pod, so it can only hit it once d.clear says it has been clear of it.
      const near = flight.isPod() && hitsPod(d);
      if (!near) d.clear = true;
      else if (d.clear && phase === "descent") {
        blast(p.x, p.y, p.z, 12, 0.6);
        removeChild(root, d.node);
        debris.splice(i, 1);
        flight.state.failure = "debris";
        boom("debris");
        continue;
      }
      if (alt <= 0 || p.y <= ground || d.t > DEBRIS.life) {
        if (d.t <= DEBRIS.life) {
          if (alt <= 0) splashAt(p.x, p.y, p.z, 0.8);
          else blast(p.x, p.y, p.z, 12, 0.6);
        }
        removeChild(root, d.node);
        debris.splice(i, 1);
      }
    }
  };

  const blast = (x, y, z, count, size) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * 2 - 1, sp = (3 + Math.random() * 7) * size;
      fx.spawnParticle(BOOM_BITS[i % BOOM_BITS.length], x, y, z, Math.cos(a) * sp, b * sp + 2, Math.sin(a) * sp, 1.2 + Math.random() * 1.4, 6, 2.4, -Infinity);
    }
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      spawnSmoke(x, y, z, Math.cos(a) * 4 * size, 1.5, Math.sin(a) * 4 * size, 1.4 * size, 3.5);
    }
  };
  const explode = (x, y, z) => {
    blast(x, y, z, 60, 1.4);
    for (let i = 0; i < FIREBALLS; i++) {
      const f = fireballs[i];
      setVec(f.position, x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 3, z + (Math.random() - 0.5) * 3);
      setVec(f.scale, 0.01, 0.01, 0.01);
      f.visible = true;
      f.smokeOpacity = 1;
      const size = 3 + i * 1.3;
      addTween({
        delay: i * 0.12, dur: 1.1, ease: math.ease.outQuad, update: (k) => {
          const s = size * (0.2 + k);
          setVec(f.scale, s, s, s);
          f.smokeOpacity = Math.max(0, 1 - k * k);
        }, done: () => {
          f.visible = false;
        }
      });
    }
    cam.shake = 1.4;
    audio.cues.boom();
  };
  const splashAt = (x, y, z, size) => {
    for (let i = 0; i < 26 * size; i++) {
      const a = Math.random() * Math.PI * 2, sp = (1 + Math.random() * 3) * size;
      fx.spawnParticle(SPLASH_BITS[i % 2], x, y, z, Math.cos(a) * sp, 3 + Math.random() * 5 * size, Math.sin(a) * sp, 1 + Math.random() * 0.8, 4, 6, -Infinity);
    }
    if (size < 1) return;
    setVec(splashNode.position, x, y, z);
    splashNode.visible = true;
    splashNode.smokeOpacity = 1;
    addTween({
      dur: 1.4, ease: math.ease.outQuad, update: (k) => {
        const s = 1 + k * 5;
        setVec(splashNode.scale, s, 1 + k * 2 - k * k * 2.6, s);
        splashNode.smokeOpacity = 1 - k;
      }, done: () => {
        splashNode.visible = false;
      }
    });
  };

  const toBuild = () => {
    phase = "build";
    flight = null;
    release = null;
    igniteIn = 0;
    for (const d of debris) removeChild(root, d.node);
    debris.length = 0;
    for (const f of fireballs) f.visible = false;
    splashNode.visible = false;
    astro.root.visible = tetherNode.visible = rockNode.visible = false;
    passenger.root.visible = true;
    result = failure = null;
    rebuildView();
    view.node.visible = true;
    rhud.show("build");
    rhud.setMeters("");
    rhud.renderStack(stack, selected, rocketParts.check(stack), rocketParts.stats(stack));
    hud.el.act.hidden = true;
    hud.setSubtitle("Ooga Orbit · the pad");
    cam.warm = false;
    cam.offset = cam.tilt = 0;
    audio.quiet();
  };
  const launch = () => {
    if (phase !== "build" && phase !== "results") return false;
    const check = rocketParts.check(stack);
    if (!check.ok) {
      hud.toast(check.problems[0]);
      return false;
    }
    game.setOrbitBuild(stack);
    if (phase === "results") toBuild();
    flight = rocketMod.create({ stack, groundAt, onDrop });
    flight.reset(spot.x, spot.padY, spot.z);
    phase = "count";
    phaseT = 0;
    countShown = 0;
    gauge = 0;
    release = null;
    igniteIn = 0;
    accumulator = 0;
    flightTime = 0;
    score = 0;
    stagesDropped = 0;
    orbited = spaceCalled = chuteCalled = leanHinted = false;
    reelT = 0;
    releasedAt = topAt = 0;
    handFlown = true;
    fuelWasted = 0;
    launches++;
    eva.measured = eva.back = eva.reeling = eva.out = false;
    eva.measuring = 0;
    eva.air = EVA_AIR;
    eva.bonus = 0;
    // The rock somewhere new each launch: its side, height and reach drawn from the pilot and the launch count.
    const seed = fnv1a(`${selection.pilot}/${launches}`);
    eva.rockE = (seed % 2 ? 1 : -1) * (6 + (seed >>> 3) % 5);
    eva.rockU = 2 + (seed >>> 7) % 5;
    eva.rockF = 4 + (seed >>> 11) % 6;
    astro.root.visible = tetherNode.visible = rockNode.visible = false;
    rockNode.glow = 1;
    missionKey = leanKey = NaN;
    failStep = -1;
    maxLean = 0;
    selected = -1;
    markSelected();
    rhud.show("flight");
    rhud.setMeters("ascent");
    rhud.setStage(1, flight.stages.length);
    hud.el.act.hidden = !COARSE;
    hud.setAct("Release!");
    hud.setSubtitle("Ooga Orbit · counting down");
    window.clearTimeout(hintTimer);
    hud.hint("", 0);
    cam.warm = false;
    cam.offset = cam.tilt = 0;
    fx.say(speaker, "Ooga go up!", 1.8);
    return true;
  };
  const startSpool = () => {
    phase = "ignite";
    phaseT = 0;
    gauge = 0;
    rhud.center("IGNITION", 900);
    rhud.notice("Space in the green", 0);
    audio.cues.go();
  };
  const releaseClamps = () => {
    if (phase !== "ignite") return false;
    const g = gauge, s = flight.state;
    if (g < GREEN[0]) {
      release = "early";
      flight.ignite(EARLY.boost, EARLY.t);
      s.psiRate = EARLY.kick;
      rhud.center("EARLY!", 1100);
      rhud.notice("Clamps too soon: the stack staggers", 2200);
      audio.cues.early();
    } else if (g <= GREEN[1]) {
      release = g >= GOLD[0] && g <= GOLD[1] ? "perfect" : "good";
      score += release === "perfect" ? SCORE.perfect : SCORE.good;
      flight.ignite();
      rhud.center(release === "perfect" ? "PERFECT!" : "GOOD", 1100);
      rhud.notice(COARSE ? "left stick pushes · right stick leans · STAGE drops a stage" : "W S push · A D lean · Space stages", 3200);
      if (release === "perfect") audio.cues.perfect();
    } else {
      release = "late";
      flight.ignite();
      s.heat = LATE_HEAT;
      rhud.center("LATE!", 1100);
      rhud.notice("The engines strained", 2200);
      audio.cues.early();
    }
    audio.cues.clamp();
    phase = "ascent";
    phaseT = 0;
    releasedAt = flightTime;
    hud.setAct("Stage");
    hud.setSubtitle("Ooga Orbit · climbing");
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      spawnSmoke(spot.x + Math.cos(a) * 1.5, spot.padY + 0.4, spot.z + Math.sin(a) * 1.5, Math.cos(a) * 9, 0.6, Math.sin(a) * 9, 1.4, 3.8);
    }
    return true;
  };
  const moreEngines = () => {
    for (let i = flight.state.stage + 1; i < flight.stages.length; i++) if (flight.stages[i].engine) return true;
    return false;
  };
  // Drop the lowest stage and light the next; with nothing left to light, cut the pod loose.
  const stage = () => {
    const s = flight.state;
    if (!flight.isPod() && moreEngines()) {
      flight.separate();
      if (flight.engine()) igniteIn = STAGE_DELAY;
      rhud.setStage(s.stage + 1, flight.stages.length);
      return true;
    }
    flight.homeward(false);
    toDescent(false);
    return true;
  };
  const onFlameout = () => {
    const s = flight.state;
    audio.cues.flameout();
    if (moreEngines()) {
      rhud.center("STAGE!", 1300);
      rhud.notice("Space · drop the empty stage", 0);
    } else if (!orbited) {
      rhud.center("OUT OF FUEL", 1500);
      rhud.notice(flight.isPod() ? "Pull the chute low" : "Space · cut the pod loose, pull the chute low", 0);
    }
    fx.say(speaker, moreEngines() ? "Next one!" : s.spaced ? "Ooga float." : "Uh oh.", 1.4);
  };
  const enterOrbit = () => {
    const s = flight.state;
    phase = "orbit";
    phaseT = 0;
    orbited = true;
    topAt = flightTime;
    score += SCORE.orbit;
    s.burning = false;
    igniteIn = 0;
    // Reel from here to the Sky Top straight over the pad.
    REEL.x0 = s.p.x; REEL.y0 = s.p.y; REEL.z0 = s.p.z;
    const px = spot.x, py = spot.padY - CY, pz = spot.z, pl = Math.hypot(px, py, pz), r = R + TOP;
    REEL.x1 = px / pl * r; REEL.y1 = CY + py / pl * r; REEL.z1 = pz / pl * r;
    reelT = 0;
    rhud.center("LOW ORBIT!", 2600);
    rhud.notice("You're in low orbit · steady over the island", 4200);
    hud.setAct(flight.isPod() ? "Walk" : "Drop");
    hud.setSubtitle("Ooga Orbit · in low orbit");
    audio.cues.orbit();
    fx.say(speaker, "OOGA IN ORBIT!", 2.4);
    cam.warm = false;
  };
  const dropRest = () => {
    if (reelT < REEL_T || flight.isPod() || flight.state.mode === "free") return false;
    flight.homeward();
    rhud.setStage(flight.stages.length, flight.stages.length);
    rhud.center("POD FREE", 1100);
    rhud.notice("Space again to go outside for the spacewalk", 4200);
    hud.setAct("Walk");
    return true;
  };
  const letGo = () => {
    if (phase !== "orbit" || !eva.back) return false;
    const s = flight.state;
    if (s.mode !== "free") flight.homeward();
    flight.stand();
    localAt(s.p.x, s.p.y, s.p.z);
    s.v.x = -LOCAL.ux * THROW; s.v.y = -LOCAL.uy * THROW; s.v.z = -LOCAL.uz * THROW;
    toDescent(true);
    rhud.center("HOME!", 1200);
    rhud.notice("Keep the shield down (hands off is fine) · Space pulls the chute at the CHUTE call", 4200);
    audio.cues.clamp();
    fx.say(speaker, "Ooga go home!", 1.8);
    return true;
  };
  // Held at the top: reeled over the pad first, then held still; a free pod may still turn on its puffs.
  const hover = (dt) => {
    if (reelT < REEL_T) {
      reelT = Math.min(REEL_T, reelT + dt);
      const k = smooth(reelT / REEL_T);
      flight.hold(lerp(REEL.x0, REEL.x1, k), lerp(REEL.y0, REEL.y1, k), lerp(REEL.z0, REEL.z1, k), Math.min(1, dt * 1.5));
      if (reelT >= REEL_T) {
        rhud.notice(flight.isPod() ? "Space to go outside for the spacewalk" : "Space drops the rest of the rocket, keeping the pod", 4200);
        cam.warm = false;
      }
      return;
    }
    if (phase === "orbit" && flight.state.mode === "free") simulate(dt);
    flight.hold(REEL.x1, REEL.y1, REEL.z1);
  };
  const toDescent = (fromOrbit) => {
    phase = "descent";
    phaseT = 0;
    accumulator = 0;
    igniteIn = 0;
    rhud.setMeters("descent");
    hud.setAct("Chute");
    hud.setSubtitle(fromOrbit ? "Ooga Orbit · coming home" : "Ooga Orbit · falling");
    const s = flight.state;
    localAt(s.p.x, s.p.y, s.p.z);
    HEAD.x = LOCAL.dx;
    HEAD.y = LOCAL.dy;
    HEAD.z = LOCAL.dz;
    cam.warm = false;
    rhud.setStage(flight.stages.length, flight.stages.length);
  };
  const pullChute = () => {
    const s = flight.state;
    if (s.chute !== "packed") return false;
    if (!flight.deploy()) {
      rhud.notice(s.alt >= rocketMod.CHUTE.alt ? "Too high for the leaves" : "Not yet", 1400);
      return false;
    }
    if (s.chute === "torn") {
      rhud.center("TORN!", 1400);
      rhud.notice("Too fast for the leaves", 2400);
      audio.cues.torn();
      fx.say(speaker, "NO NO NO", 1.4);
    } else {
      rhud.center("CHUTE", 900);
      rhud.notice("A D steer the leaves to the pad", 3200);
      audio.cues.chute();
      canopy.visible = true;
      setVec(canopy.scale, 0.02, 0.02, 0.02);
    }
    return true;
  };
  // Judged where the pod's base came down, not its centre.
  const where = () => {
    const s0 = flight.state, x = s0.p.x - s0.up[0] * s0.height / 2, z = s0.p.z - s0.up[2] * s0.height / 2, d = Math.hypot(x - spot.x, z - spot.z);
    if (d < rocketModels.SITE.padR) return "pad";
    if (d < rocketModels.SITE.isletR) return "islet";
    if (island.onLand(x, z)) return "island";
    if (rocketModels.onContinent(x, s0.p.y - CY, z)) return "land";
    return "sea";
  };
  const touchdown = () => {
    const s = flight.state;
    phase = "down";
    phaseT = 0;
    const place = where();
    const bx = s.p.x - s.up[0] * s.height / 2, by = s.p.y - s.up[1] * s.height / 2, bz = s.p.z - s.up[2] * s.height / 2;
    if (place === "sea") {
      splashAt(bx, by, bz, 1.4);
      audio.cues.splash();
      rhud.center("SPLASHDOWN", 1800);
    } else {
      fx.burst(bx, by + 0.1, bz, 10, SPLASH_BITS, 1.4);
      audio.cues.thud();
      rhud.center(place === "pad" ? "ON THE PAD!" : place === "land" ? "FAR LAND" : "LANDED", 1800);
      if (place === "pad") {
        // The 1500-point moment gets a party: confetti, the ticker, and the Agent's word.
        fx.burst(bx, by + 1.5, bz, 30, CONFETTI, 2.8);
        fx.showTicker("OOGA BULLSEYE", 4);
        if (agent.root.visible) fx.sayAt(agent.root.position.x, agent.root.position.y + 2.2, agent.root.position.z, "Textbook.", 2.4);
        audio.cues.perfect();
      }
    }
    canopy.visible = false;
    hud.el.act.hidden = true;
    fx.say(speaker, place === "pad" ? "OOGA BULLSEYE!" : place === "sea" ? "Ooga swim now." : "Ooga home.", 2.4);
  };
  const FAILS = {
    overpressure: ["POP", "Waited too long. The engines popped."],
    stuck: ["TOO HEAVY", "Too heavy to leave the pad. More push, less barrel."],
    heat: ["COOKED", "Too fast too low. Ease off the push in thick air."],
    breakup: ["RIPPED", "It came apart. Lean gently while the air is thick; fins help."],
    burnup: ["BURNED UP", "Burned up coming home. Shield first, into the fire."],
    splat: ["SPLAT", "Hit the sea too fast. Space pulls the chute as soon as CHUTE shows."],
    crash: ["CRASH", "Hit the ground too fast. Space pulls the chute as soon as CHUTE shows."],
    debris: ["SMASHED", "The pod fell onto its own dropped stage. Give it longer to fall away before letting go."],
    wreck: ["WRECKED", "The whole rocket came back down. Stage it up to low orbit, or cut the pod loose and pull the chute."]
  };
  const boom = (why) => {
    const s = flight.state;
    failStep = NOW.step;
    failure = why;
    phase = "boom";
    phaseT = 0;
    rhud.center(FAILS[why][0], 1800);
    rhud.notice("", 1);
    hud.el.act.hidden = true;
    if (why === "stuck") {
      audio.cues.flameout();
      fx.say(speaker, "Rocket too fat.", 2);
      return;
    }
    const bx = s.p.x, by = s.p.y, bz = s.p.z;
    explode(bx, by, bz);
    view.node.visible = false;
    canopy.visible = false;
  };
  const finish = () => {
    const s = flight.state;
    phase = "results";
    const place = failure ? null : where();
    const dist = Math.hypot(s.p.x - spot.x, s.p.z - spot.z);
    let landScore = 0;
    // The pad pays on a gradient from its middle, so a landing has a number to chase after the first one.
    if (place === "pad") landScore = SCORE.padBase + Math.round((SCORE.pad - SCORE.padBase) * clamp(1 - dist / rocketModels.SITE.padR, 0, 1));
    else if (place === "islet") landScore = SCORE.islet;
    else if (place === "island") landScore = SCORE.island;
    else if (place === "land") landScore = SCORE.land;
    else if (place === "sea") landScore = SCORE.sea + Math.round(SCORE.near * clamp(1 - dist / SCORE.nearRange, 0, 1));
    if (!failure && s.landing === "hard") landScore = Math.round(landScore * 0.6);
    const home = !failure && orbited ? SCORE.home : 0;
    const cool = !failure && orbited ? Math.round(SCORE.cool * clamp(1 - s.peakHeat, 0, 1)) : 0;
    const spaceScore = s.spaced ? SCORE.space : 0;
    // A finished mission is scored on its bill, its pace to the top and whether the climb was flown by hand.
    const done = !failure && orbited && eva.back;
    const bill = rocketParts.stats(stack).cost;
    const thrift = done ? Math.round(SCORE.thrift * Math.max(0, REF_BILL - bill)) : 0;
    const climb = topAt > releasedAt ? topAt - releasedAt : 0;
    const fast = done && climb > 0 ? Math.round(SCORE.fast * clamp(1 - (climb - FAST_BEST) / FAST_SPAN, 0, 1)) : 0;
    const hand = orbited && handFlown ? SCORE.hand : 0;
    score += landScore + home + cool + spaceScore + thrift + fast + hand;
    // A fireball cannot medal: the checkpoints it passed are worth less than bronze.
    if (failure) score = Math.min(score, rocketHud.MEDALS.bronze - 1);
    const medal = rhud.medalFor(score);
    const landing = failure || place;
    const improved = game.recordOrbit({ score, orbit: orbited, landing, parts: stack.length });
    result = { score, medal, improved, landing, orbit: orbited, failure, dist, peakHeat: s.peakHeat, maxAlt: s.maxAlt };
    const rows = [
      ["Clamps", release ? `${release.toUpperCase()}${release === "perfect" ? ` · ${SCORE.perfect}` : release === "good" ? ` · ${SCORE.good}` : ""}` : "held"],
      ["Highest", `${Math.round(s.maxAlt)}${s.spaced ? ` · space ${SCORE.space}` : ""}`],
      ["Stages dropped", `${stagesDropped} × ${SCORE.stage}${fuelWasted > 0.01 ? ` · ${fuelWasted.toFixed(1)} fuel dropped unburnt` : ""}`],
      ["Low orbit", orbited ? `reached · ${SCORE.orbit}${climb > 0 ? ` · ${climb.toFixed(1)}s from the clamps${fast ? ` · fast ${fast}` : ""}` : ""}${hand ? ` · hand-flown ${hand}` : ""}` : `no · ${Math.round(s.maxAlt)} of ${TOP}`]
    ];
    if (done) rows.push(["Thrift", `${bill} bananas${thrift ? ` · ${thrift}` : " · nothing under the mark"}`]);
    rows.push(["Spacewalk", eva.back ? `rock ${eva.reading} bananas long · ${SCORE.eva}${eva.bonus ? ` · air ${eva.bonus}` : ""}` : eva.measured ? "measured, never got back in" : "skipped"]);
    if (orbited && !failure) rows.push(["Coming home", `peak heat ${Math.round(s.peakHeat * 100)}% · ${home + cool}`]);
    rows.push(["Landing", failure ? FAILS[failure][0].toLowerCase() : `${place === "land" ? "far land" : place}${place === "sea" ? ` · ${Math.round(dist)} out` : ""}${s.landing === "hard" ? " · hard" : ""} · ${landScore}`]);
    rows.push(["Time", BL.dropHud.formatTime(flightTime * 1000)]);
    const summary = failure ? FAILS[failure][1] : !orbited ? `${missedOrbit()}${place === "pad" ? " It came down on the pad, at least." : ""}` : place === "pad" ? "Back on the pad. The tribe salutes you." : "Up to low orbit and home.";
    rhud.setMeters("");
    rhud.results(rows, summary, result);
    hud.el.act.hidden = true;
    hud.setSubtitle("Ooga Orbit · flight log");
    audio.quiet();
    if (medal) audio.cues.finish();
  };
  const missedOrbit = () => {
    const dv = Math.round(rocketParts.stats(stack).dv), high = Math.round(flight.state.maxAlt);
    if (fuelWasted > 0.3) return `Short of low orbit (${high} of ${TOP}): ${fuelWasted.toFixed(1)} fuel went down with a stage still burning. Wait for STAGE! before dropping one.`;
    if (dv < rocketParts.TOP_DV) return `Short of low orbit (${high} of ${TOP}): not enough push. This rocket has ${dv} speed to spend and low orbit needs about ${rocketParts.TOP_DV}: add fuel or a stage.`;
    if (maxLean > LEAN_MAX + 0.35) return `Short of low orbit (${high} of ${TOP}): it leaned over too far. Keep near the yellow line; up is the goal.`;
    return `Short of low orbit (${high} of ${TOP}): it ran out of push. Drop each empty stage the moment STAGE! shows and keep W held.`;
  };
  const act = () => {
    if (phase === "build") return launch();
    if (phase === "count") {
      rhud.notice("wait for ignition", 900);
      return true;
    }
    if (phase === "ignite") return releaseClamps();
    if (phase === "ascent") return stage();
    // At the top Space steps the mission: drop the rest, go outside, and once back in let go.
    if (phase === "orbit") return dropRest() || (!eva.back && startEva()) || letGo();
    if (phase === "eva") return evaAct();
    if (phase === "descent") return pullChute();
    if (phase === "results") return launch();
    return false;
  };

  // W A S D push the shield up/left/down/right as the eye sees it, Q/E spin its axis; split onto body-axis rates.
  // Under the chute and on the way up the keys pass straight through.
  const podTurn = (a) => {
    const s = flight.state;
    let fx = cam.tx - camera.position.x, fy = cam.ty - camera.position.y, fz = cam.tz - camera.position.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    localAt(s.p.x, s.p.y, s.p.z);
    // Screen right = forward x up, screen up = right x forward.
    let rx = fy * LOCAL.uz - fz * LOCAL.uy, ry = fz * LOCAL.ux - fx * LOCAL.uz, rz = fx * LOCAL.uy - fy * LOCAL.ux;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    // Shield normal n = -up; it turns toward r about n x r, toward u about n x u.
    const nx = -s.up[0], ny = -s.up[1], nz = -s.up[2];
    const wx = a.x * (ny * rz - nz * ry) + a.y * (ny * uz - nz * uy) + a.yaw * s.up[0];
    const wy = a.x * (nz * rx - nx * rz) + a.y * (nz * ux - nx * uz) + a.yaw * s.up[1];
    const wz = a.x * (nx * ry - ny * rx) + a.y * (nx * uy - ny * ux) + a.yaw * s.up[2];
    ctrl.pitch = clamp(wx * s.right[0] + wy * s.right[1] + wz * s.right[2], -1, 1);
    ctrl.roll = clamp(wx * s.up[0] + wy * s.up[1] + wz * s.up[2], -1, 1);
    ctrl.yaw = clamp(wx * s.front[0] + wy * s.front[1] + wz * s.front[2], -1, 1);
  };
  const readInput = () => {
    const a = controls.read();
    if (inputLocked) return a;
    ctrl.throttle = a.y;
    // Hands off A and D (|a.x| < 0.05) the autopilot leans along the climb and eases the throttle back
    // when the air's push nears the limit; touching them flies by hand.
    if (phase === "ascent" && selection.assist && Math.abs(a.x) < 0.05) {
      const s = flight.state;
      ctrl.lean = clamp((leanTarget(s.alt) - s.psi) * 3 - s.psiRate * 1.5, -1, 1);
      if (s.stress > rocketMod.Q_GUARD && a.y <= 0) ctrl.throttle = -1;
      handFlown = false;
    } else ctrl.lean = a.x;
    if (phase === "ascent") maxLean = Math.max(maxLean, flight.state.psi);
    if (phase === "eva") ctrl.pitch = ctrl.roll = ctrl.yaw = ctrl.throttle = ctrl.lean = 0;
    else if ((phase === "descent" || phase === "orbit") && flight.state.mode === "free" && flight.state.chute !== "open") podTurn(a);
    else {
      ctrl.pitch = clamp(a.y - (COARSE ? 0 : a.pitch), -1, 1);
      ctrl.roll = a.x;
      ctrl.yaw = a.yaw;
    }
    return a;
  };
  const afterStep = () => {
    const s = flight.state;
    if (s.failure) {
      boom(s.failure);
      return;
    }
    if (s.mode === "down") {
      touchdown();
      return;
    }
    if (s.flameout) {
      s.flameout = false;
      onFlameout();
    }
    if (s.spaced && !spaceCalled) {
      spaceCalled = true;
      rhud.center("OOGA IN SPACE!", 1600);
      rhud.notice(orbited ? "" : `Out of the air · keep climbing to low orbit at ${TOP}`, 3000);
      audio.cues.space();
    }
    // Anything still rising through the Sky Top gets there: the whole stack or a pod already cut loose.
    if (!orbited && (phase === "ascent" || phase === "descent") && s.alt >= TOP) {
      enterOrbit();
      return;
    }
    if (phase === "ascent") {
      // Still held down by its own weight STUCK_T after the clamps let go: it is not going anywhere.
      if (s.mode === "pad" && phaseT > STUCK_T) {
        s.failure = "stuck";
        boom("stuck");
        return;
      }
      if (s.mode === "free") toDescent(false);
    }
  };
  const simulate = (dt) => {
    accumulator = Math.min(accumulator + dt, FIXED * MAX_SUBSTEPS);
    while (accumulator >= FIXED && (phase === "ascent" || phase === "descent" || phase === "orbit" || phase === "eva")) {
      accumulator -= FIXED;
      flight.substep(FIXED, ctrl);
      flightTime += FIXED;
      afterStep();
    }
  };
  // Rows are rewritten only when the step, the phrase or the number changes.
  const NOW = { step: 0, word: 0, n: 0 };
  const at = (step, word, n = 0) => {
    NOW.step = step;
    NOW.word = word;
    NOW.n = n;
  };
  let missionKey = NaN, leanKey = NaN, failStep = -1, maxLean = 0;
  const leanWords = () => {
    const s = flight.state, lean = Math.round(s.psi * 180 / Math.PI), aim = Math.round(leanTarget(s.alt) * 180 / Math.PI);
    return selection.assist ? `autopilot leaning ${lean}° to ${aim}° (G: by hand)` : `lean ${lean}° to the yellow ${aim}° with A D (G: autopilot)`;
  };
  const missionStep = () => {
    const s = flight.state;
    if (phase === "count" || phase === "ignite") return at(0, phase === "ignite" ? 1 : 0);
    if (phase === "ascent" && !s.spaced) return at(1, 0, Math.max(0, Math.round(s.alt)));
    if (phase === "ascent") return s.radial < 0 && !s.burning ? at(2, 1, Math.round(s.maxAlt)) : at(2, 0, Math.round(s.alt));
    if (phase === "orbit" && reelT < REEL_T) return at(3, 0);
    if (phase === "orbit" && s.mode !== "free") return at(3, 1);
    if (phase === "eva") return at(3, eva.measuring > 0 ? 4 : eva.near === "rock" ? 5 : eva.measured ? 6 : 3);
    if (phase === "orbit" && !eva.back) return at(3, 2);
    if (phase === "orbit") return at(4, 0);
    if (phase === "descent") {
      if (s.chute === "packed" && !flight.chuteReady()) return at(5, 0);
      if (s.chute === "packed") return at(6, 0);
      if (s.chute === "open") return at(6, 1, Math.round(Math.hypot(s.p.x - spot.x, s.p.z - spot.z)));
      return at(6, 2);
    }
    return at(7, 0);
  };
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const missionText = (step, word, n) => {
    switch (step * 10 + word) {
      case 0: return "Get ready";
      case 1: return "Space when the needle is in the green";
      case 10: return `Height ${n} · out of the air at ${SPACE_ALT} · ${leanWords()}`;
      case 20: return `Height ${n} of ${TOP} · ${leanWords()}`;
      case 21: return `Falling back from ${n}: Space drops a spent stage, W pushes`;
      case 30: return "Settling into low orbit over the island";
      case 31: return "Space: drop the rest of the rocket";
      case 32: return "Space: go outside";
      case 33: return COARSE ? `Fly to the glowing rock · left stick, tilt the right for down and up · air ${Math.ceil(eva.air)}` : `Fly to the glowing rock · W A S D, Q E down up · air ${Math.ceil(eva.air)}`;
      case 34: return "Measuring…";
      case 35: return "Space: measure the rock";
      case 36: return eva.reeling ? "The tether reels you back in" : eva.near === "hatch" ? "Space: climb back in" : "Back to the hatch";
      case 40: return "Space: leave orbit and drop home";
      case 50: return "Shield down, hands off is fine · W A S D if it tips";
      case 60: return "Space: pull the chute";
      case 61: return `Steer A D to the pad · ${n} away`;
      case 62: return "Chute torn · brace";
      default: return "";
    }
  };
  const updateMission = () => {
    missionStep();
    const key = (NOW.step * 10 + NOW.word) * 1e6 + NOW.n + 5e5 + (eva.near === "hatch" ? 0.5 : 0) + (eva.reeling ? 0.25 : 0) + (phase === "eva" ? Math.ceil(eva.air) * 1e-3 : 0);
    const lean = phase === "ascent" ? Math.round(flight.state.psi * 180 / Math.PI) * 1000 + Math.round(leanTarget(flight.state.alt) * 180 / Math.PI) + (selection.assist ? 5e5 : 0) : 0;
    if (key === missionKey && lean === leanKey) return;
    missionKey = key;
    leanKey = lean;
    const ended = phase === "descent" || phase === "down" || phase === "boom" || phase === "results";
    for (let i = 0; i < rhud.MISSION.length; i++) {
      let state = i < NOW.step ? "done" : i === NOW.step ? "now" : "";
      if ((!orbited && ended && i >= 2 && i <= 4) || (orbited && !eva.back && NOW.step >= 4 && i === 3)) state = "missed";
      if (failure && i >= failStep) state = i === failStep ? "missed" : "";
      rhud.setStep(i, state, state === "now" ? missionText(NOW.step, NOW.word, NOW.n) : "");
    }
  };
  const podPuffs = (dt) => {
    const s = flight.state;
    if (s.mode !== "free" || s.chute === "open" || phase === "down" || phase === "boom" || phase === "eva") return;
    if (Math.abs(ctrl.pitch) + Math.abs(ctrl.roll) + Math.abs(ctrl.yaw) <= 0.05) return;
    puffClock += dt;
    const r = flight.pod.r;
    while (puffClock >= PUFF_EVERY) {
      puffClock -= PUFF_EVERY;
      const a = Math.random() * Math.PI * 2, c = Math.cos(a), n = Math.sin(a);
      const ox = s.right[0] * c + s.front[0] * n, oy = s.right[1] * c + s.front[1] * n, oz = s.right[2] * c + s.front[2] * n;
      spawnSmoke(s.p.x + ox * r, s.p.y + oy * r, s.p.z + oz * r, s.v.x + ox * 4, s.v.y + oy * 4, s.v.z + oz * 4, 0.16, 0.55);
    }
  };
  // FRAME is the pod's frame: world up (u), downrange (f), their side (e), hatch (h) on the pod's top.
  const FRAME = { ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: 1, ex: 1, ey: 0, ez: 0, hx: 0, hy: 0, hz: 0 };
  const podFrame = () => {
    const s = flight.state;
    localAt(s.p.x, s.p.y, s.p.z);
    // Forward is downrange: the pod hangs still on the sky hook, so its flight gives no direction.
    const ux = LOCAL.ux, uy = LOCAL.uy, uz = LOCAL.uz, fx = LOCAL.dx, fy = LOCAL.dy, fz = LOCAL.dz;
    FRAME.ux = ux; FRAME.uy = uy; FRAME.uz = uz;
    FRAME.fx = fx; FRAME.fy = fy; FRAME.fz = fz;
    FRAME.ex = fy * uz - fz * uy; FRAME.ey = fz * ux - fx * uz; FRAME.ez = fx * uy - fy * ux;
    FRAME.hx = s.p.x + s.up[0] * (s.height / 2 + 0.2);
    FRAME.hy = s.p.y + s.up[1] * (s.height / 2 + 0.2);
    FRAME.hz = s.p.z + s.up[2] * (s.height / 2 + 0.2);
  };
  const framePoint = (e, u, f, out) => setVec(out, FRAME.hx + FRAME.ex * e + FRAME.ux * u + FRAME.fx * f, FRAME.hy + FRAME.ey * e + FRAME.uy * u + FRAME.fy * f, FRAME.hz + FRAME.ez * e + FRAME.uz * u + FRAME.fz * f);
  // A rotation whose columns are the given x, y and z axes.
  const fromBasis = (out, xx, xy, xz, yx, yy, yz, zx, zy, zz) => {
    const trace = xx + yy + zz;
    if (trace > 0) {
      const k = 0.5 / Math.sqrt(trace + 1);
      out[3] = 0.25 / k; out[0] = (yz - zy) * k; out[1] = (zx - xz) * k; out[2] = (xy - yx) * k;
    } else if (xx > yy && xx > zz) {
      const k = 2 * Math.sqrt(1 + xx - yy - zz);
      out[3] = (yz - zy) / k; out[0] = 0.25 * k; out[1] = (yx + xy) / k; out[2] = (zx + xz) / k;
    } else if (yy > zz) {
      const k = 2 * Math.sqrt(1 + yy - xx - zz);
      out[3] = (zx - xz) / k; out[0] = (yx + xy) / k; out[1] = 0.25 * k; out[2] = (zy + yz) / k;
    } else {
      const k = 2 * Math.sqrt(1 + zz - xx - yy);
      out[3] = (xy - yx) / k; out[0] = (zx + xz) / k; out[1] = (zy + yz) / k; out[2] = 0.25 * k;
    }
    return quat.normalize(out);
  };
  const ROCK = { x: 0, y: 0, z: 0 }, WALKER = { x: 0, y: 0, z: 0 }, LOOK = { x: 0, y: 0, z: 1 }, SIDE = { x: 1, y: 0, z: 0 }, TUMBLE = quat.create();
  // Sphere at (e,u,f) from the hatch: an Ooga inside is put back on its surface, speed in returns at restitution.
  // Nothing else slows it, so it drifts off tumbling.
  const bump = (ce, cu, cf, radius) => {
    const de = eva.e - ce, du = eva.u - cu, df = eva.f - cf, d = Math.hypot(de, du, df), min = radius + EVA.body;
    if (d >= min || d < 1e-6) return;
    const ne = de / d, nu = du / d, nf = df / d;
    eva.e = ce + ne * min; eva.u = cu + nu * min; eva.f = cf + nf * min;
    const into = eva.ve * ne + eva.vu * nu + eva.vf * nf;
    if (into >= 0) return;
    const k = (1 + EVA.bounce) * into;
    eva.ve -= ne * k; eva.vu -= nu * k; eva.vf -= nf * k;
    // A knock past 0.4 into the surface: a beat without steadying and a small wobble.
    if (-into > 0.4) {
      eva.drift = EVA.drift;
      eva.spin = Math.min(1.2, -into * 0.4);
      audio.cues.thud();
      cam.shake = Math.max(cam.shake, 0.08);
      fx.sayAt(WALKER.x, WALKER.y + 0.9, WALKER.z, "bonk", 0.8);
    }
  };
  const canWalk = () => phase === "orbit" && reelT >= REEL_T && flight.state.mode === "free" && !eva.back;
  const startEva = () => {
    if (!canWalk()) return false;
    phase = "eva";
    phaseT = 0;
    eva.e = eva.f = eva.ve = eva.vu = eva.vf = 0;
    eva.u = 1.1;
    eva.yaw = Math.atan2(eva.rockE, eva.rockF);
    eva.pitch = 0.2;
    eva.measuring = 0;
    eva.reeling = false;
    eva.out = true;
    eva.drift = eva.tumble = eva.spin = 0;
    passenger.root.visible = false;
    astro.root.visible = tetherNode.visible = true;
    cam.warm = false;
    hud.setAct("Act");
    rhud.center("SPACEWALK", 1200);
    rhud.notice(COARSE ? "Left stick flies where you look · tilt the right stick down and up · drag to look · the button at the rock" : "W A S D fly where you look · Q E down up · drag to look · Space at the rock", 4200);
    fx.say(speaker, "Ooga go outside!", 1.8);
    audio.cues.chute();
    return true;
  };
  const climbIn = () => {
    phase = "orbit";
    phaseT = 0;
    eva.out = false;
    astro.root.visible = tetherNode.visible = astroStick.visible = false;
    passenger.root.visible = true;
    cam.warm = false;
    hud.setAct("Home");
    audio.cues.clamp();
    if (eva.measured) {
      eva.back = true;
      // The air left over is worth something: a quick walk pays more, and the flight log shows it.
      eva.bonus = Math.round(SCORE.eva * 0.5 * eva.air / EVA_AIR);
      score += SCORE.eva + eva.bonus;
      rhud.center("MISSION DONE", 1800);
      rhud.notice("Space: leave orbit and drop home", 4200);
      fx.say(speaker, "Ooga measure good!", 2);
    } else rhud.notice("Back in, rock not measured · Space to go out again", 3000);
  };
  const evaAct = () => {
    if (eva.measuring > 0) return true;
    if (eva.near === "rock") {
      eva.measuring = Math.min(EVA.measure, Math.max(0.5, eva.air));
      astroStick.visible = true;
      astroStick.scale.y = 0.05;
      rhud.notice("Measuring…", 0);
      audio.cues.tick();
      return true;
    }
    if (eva.near === "hatch") {
      climbIn();
      return true;
    }
    rhud.notice(eva.measured ? "Fly back to the pod's hatch" : "Fly to the glowing rock", 1400);
    return true;
  };
  const evaStep = (dt, a) => {
    podFrame();
    // Air runs while the walker is out; empty, the tether reels in whatever was or was not done.
    if (!eva.reeling) {
      eva.air = Math.max(0, eva.air - dt);
      if (eva.air <= 0) {
        eva.reeling = true;
        eva.measuring = 0;
        astroStick.visible = false;
        rhud.center("OUT OF AIR", 1400);
        rhud.notice("The tether reels you back in", 3000);
        audio.cues.warn();
      }
    }
    const cp = Math.cos(eva.pitch), le = Math.sin(eva.yaw) * cp, lu = Math.sin(eva.pitch), lf = Math.cos(eva.yaw) * cp;
    const lx = FRAME.ex * le + FRAME.ux * lu + FRAME.fx * lf, ly = FRAME.ey * le + FRAME.uy * lu + FRAME.fy * lf, lz = FRAME.ez * le + FRAME.uz * lu + FRAME.fz * lf;
    setVec(LOOK, lx, ly, lz);
    // Screen right when looking along the look with the world's up above.
    let rx = ly * FRAME.uz - lz * FRAME.uy, ry = lz * FRAME.ux - lx * FRAME.uz, rz = lx * FRAME.uy - ly * FRAME.ux;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    setVec(SIDE, rx, ry, rz);
    // Q E (or the look stick's tilt on touch, where the drag owns the look) fly down and up.
    const up = COARSE ? -a.pitch : -a.yaw;
    const mx = lx * a.y + rx * a.x + FRAME.ux * up, my = ly * a.y + ry * a.x + FRAME.uy * up, mz = lz * a.y + rz * a.x + FRAME.uz * up;
    const me = mx * FRAME.ex + my * FRAME.ey + mz * FRAME.ez, mu = mx * FRAME.ux + my * FRAME.uy + mz * FRAME.uz, mf = mx * FRAME.fx + my * FRAME.fy + mz * FRAME.fz;
    const pushing = Math.abs(a.x) + Math.abs(a.y) + Math.abs(up) > 0.05 && eva.measuring <= 0 && !eva.reeling;
    if (eva.reeling) {
      const d0 = Math.hypot(eva.e, eva.u, eva.f);
      if (d0 < 1) {
        climbIn();
        return;
      }
      const k = Math.min(EVA.max * 1.4, 0.8 + d0 * 0.9) / d0;
      eva.ve = -eva.e * k; eva.vu = -eva.u * k; eva.vf = -eva.f * k;
      eva.yaw = wrap(eva.yaw + wrap(Math.atan2(-eva.e, -eva.f) - eva.yaw) * (1 - Math.exp(-3 * dt)));
      eva.pitch = damp(eva.pitch, clamp(Math.atan2(-eva.u, Math.hypot(eva.e, eva.f)), -0.9, 0.6), 3, dt);
    } else if (pushing) {
      eva.ve += me * EVA.accel * dt;
      eva.vu += mu * EVA.accel * dt;
      eva.vf += mf * EVA.accel * dt;
    } else if (eva.drift <= 0) {
      const k = Math.exp(-EVA.settle * dt);
      eva.ve *= k; eva.vu *= k; eva.vf *= k;
    }
    const speed = Math.hypot(eva.ve, eva.vu, eva.vf);
    if (speed > EVA.max) {
      eva.ve *= EVA.max / speed; eva.vu *= EVA.max / speed; eva.vf *= EVA.max / speed;
    }
    eva.e += eva.ve * dt;
    eva.u += eva.vu * dt;
    eva.f += eva.vf * dt;
    if (!eva.reeling) {
      const s0 = flight.state, down = s0.height / 2 + 0.2;
      bump(eva.rockE, eva.rockU, eva.rockF, EVA.rockR, dt);
      bump(-(s0.up[0] * FRAME.ex + s0.up[1] * FRAME.ey + s0.up[2] * FRAME.ez) * down, -(s0.up[0] * FRAME.ux + s0.up[1] * FRAME.uy + s0.up[2] * FRAME.uz) * down, -(s0.up[0] * FRAME.fx + s0.up[1] * FRAME.fy + s0.up[2] * FRAME.fz) * down, EVA.podR, dt);
    }
    if (eva.drift > 0) eva.drift -= dt;
    eva.tumble = eva.drift > 0 ? eva.tumble + eva.spin * dt : eva.tumble + wrap(-eva.tumble) * (1 - Math.exp(-3 * dt));
    // The tether holds the Ooga to the hatch: past EVA.tether the outward drift stops.
    const d = Math.hypot(eva.e, eva.u, eva.f);
    if (d > EVA.tether) {
      const ne = eva.e / d, nu = eva.u / d, nf = eva.f / d, out = eva.ve * ne + eva.vu * nu + eva.vf * nf;
      eva.e = ne * EVA.tether; eva.u = nu * EVA.tether; eva.f = nf * EVA.tether;
      if (out > 0) {
        eva.ve -= ne * out; eva.vu -= nu * out; eva.vf -= nf * out;
      }
    }
    framePoint(eva.e, eva.u, eva.f, WALKER);
    framePoint(eva.rockE, eva.rockU, eva.rockF, ROCK);
    // The Ooga faces the look flattened across the world's up.
    let zx = lx - FRAME.ux * lu, zy = ly - FRAME.uy * lu, zz = lz - FRAME.uz * lu;
    const zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;
    const xx = FRAME.uy * zz - FRAME.uz * zy, xy = FRAME.uz * zx - FRAME.ux * zz, xz = FRAME.ux * zy - FRAME.uy * zx;
    fromBasis(astro.root.quaternion, xx, xy, xz, FRAME.ux, FRAME.uy, FRAME.uz, zx, zy, zz);
    if (Math.abs(eva.tumble) > 1e-3) quat.multiply(astro.root.quaternion, astro.root.quaternion, quat.fromAxisAngle(TUMBLE, 1, 0, 0, eva.tumble));
    // The walker's point is its middle; the caveman's root is at its feet.
    const drop = 0.55 * astro.traits.height * EVA.size - Math.sin(sceneTime * 1.7) * 0.08;
    setVec(astro.root.position, WALKER.x - FRAME.ux * drop, WALKER.y - FRAME.uy * drop, WALKER.z - FRAME.uz * drop);
    const bx = WALKER.x - zx * 0.12, by = WALKER.y - zy * 0.12, bz = WALKER.z - zz * 0.12;
    let tx = bx - FRAME.hx, ty = by - FRAME.hy, tz = bz - FRAME.hz;
    const tl = Math.hypot(tx, ty, tz) || 1e-3;
    tx /= tl; ty /= tl; tz /= tl;
    let ax = FRAME.uy * tz - FRAME.uz * ty, ay = FRAME.uz * tx - FRAME.ux * tz, az = FRAME.ux * ty - FRAME.uy * tx;
    const al = Math.hypot(ax, ay, az);
    if (al < 1e-4) {
      ax = FRAME.ex; ay = FRAME.ey; az = FRAME.ez;
    } else {
      ax /= al; ay /= al; az /= al;
    }
    fromBasis(tetherNode.quaternion, ax, ay, az, ty * az - tz * ay, tz * ax - tx * az, tx * ay - ty * ax, tx, ty, tz);
    setVec(tetherNode.position, FRAME.hx, FRAME.hy, FRAME.hz);
    tetherNode.scale.z = tl;
    if (pushing) {
      eva.puff += dt;
      while (eva.puff >= PUFF_EVERY * 1.5) {
        eva.puff -= PUFF_EVERY * 1.5;
        spawnSmoke(bx - zx * 0.15, by - zy * 0.15, bz - zz * 0.15, flight.state.v.x - mx * 3, flight.state.v.y - my * 3, flight.state.v.z - mz * 3, 0.12, 0.5);
      }
    }
    const arm = astro.parts.armR;
    if (eva.measuring > 0) {
      const k = 1 - eva.measuring / EVA.measure;
      eva.yaw = wrap(eva.yaw + wrap(Math.atan2(eva.rockE - eva.e, eva.rockF - eva.f) - eva.yaw) * (1 - Math.exp(-4 * dt)));
      const flat = Math.hypot(eva.rockE - eva.e, eva.rockF - eva.f);
      const aim = clamp(-Math.PI / 2 - Math.atan2(eva.rockU - eva.u, flat), -2.5, -0.5);
      arm.rotation.x = lerp(-0.2, aim, Math.min(1, k * 4)) + Math.sin(sceneTime * 16) * 0.07 * Math.min(1, k * 4);
      astroStick.scale.y = Math.min(1, 0.05 + k * 3);
      astroLight.glow = Math.sin(sceneTime * 22) > 0 ? 1 : 0.15;
      eva.measuring -= dt;
      if (Math.random() < dt * 10) fx.spawnParticle(fxMod.CONFETTI[Math.floor(Math.random() * fxMod.CONFETTI.length)], ROCK.x, ROCK.y + 1, ROCK.z, (Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2, 0.8, 4, 0, -Infinity);
      if (eva.measuring <= 0) {
        eva.measuring = 0;
        eva.measured = true;
        eva.reading = 20 + fnv1a(`${selection.pilot}/${flightTime | 0}`) % 80;
        astroStick.visible = false;
        arm.rotation.x = -0.2;
        rockNode.glow = 0.3;
        eva.reeling = true;
        rhud.center("MEASURED", 1400);
        rhud.notice(`The space rock is ${eva.reading} banana-lengths round · the tether reels you back in`, 4200);
        audio.cues.perfect();
        fx.say(speaker, "Ooga know rock now!", 2);
      }
    }
    const toRock = Math.hypot(WALKER.x - ROCK.x, WALKER.y - ROCK.y, WALKER.z - ROCK.z);
    eva.near = !eva.measured && toRock < EVA.reach ? "rock" : d < EVA.hatch ? "hatch" : "";
  };
  const placeRock = (dt) => {
    const show = (phase === "orbit" && reelT >= REEL_T && flight.state.mode === "free") || phase === "eva";
    rockNode.visible = show;
    if (!show) return;
    podFrame();
    framePoint(eva.rockE, eva.rockU, eva.rockF, rockNode.position);
    rockNode.rotation.y += dt * 0.25;
    rockNode.rotation.x += dt * 0.11;
  };
  const placeView = () => {
    const s = flight.state, n = view.node;
    setVec(n.position, s.p.x - s.up[0] * s.height / 2, s.p.y - s.up[1] * s.height / 2, s.p.z - s.up[2] * s.height / 2);
    quat.copy(n.quaternion, s.q);
  };
  const updateFlames = () => {
    const s = flight ? flight.state : null;
    const idx = s ? flight.stages[s.stage].from : -1;
    let lit = 0;
    for (let i = 0; i < view.parts.length; i++) {
      const part = view.parts[i];
      if (!part.fire) continue;
      const on = s && i === idx && part.node.parent === view.node && ((phase === "ignite" && gauge > 0.08) || (s.burning && phase !== "orbit"));
      part.fire.visible = on;
      if (!on) continue;
      const push = phase === "ignite" ? gauge : s.throttle * s.boost;
      const r = part.part.solid ? 0.62 : part.part.r * 0.85, thin = clamp(s.alt / 160, 0, 1);
      const flick = 0.85 + 0.15 * Math.sin(sceneTime * 47 + i) * Math.sin(sceneTime * 31);
      const wide = r * (1 + thin * 1.3);
      setVec(part.fire.scale, wide, r * 1.4 * (0.35 + push * 0.9) * flick * (1 + thin * 0.8), wide);
      lit = push;
    }
    return lit;
  };
  let smokeClock = 0;
  const exhaust = (dt, push) => {
    if (!flight || push <= 0.05) return;
    const s = flight.state;
    smokeClock += dt * push * (s.alt < 120 ? 40 : 6);
    const bx = s.p.x - s.up[0] * s.height / 2, by = s.p.y - s.up[1] * s.height / 2, bz = s.p.z - s.up[2] * s.height / 2;
    const nearPad = by - spot.padY < 12;
    while (smokeClock >= 1) {
      smokeClock -= 1;
      if (nearPad) {
        const a = Math.random() * Math.PI * 2;
        spawnSmoke(spot.x + Math.cos(a) * 2, spot.padY + 0.5, spot.z + Math.sin(a) * 2, Math.cos(a) * (6 + Math.random() * 6), 0.8 + Math.random(), Math.sin(a) * (6 + Math.random() * 6), 1.3, 4.5);
      } else if (s.alt < 150) {
        spawnSmoke(bx - s.up[0] * 1.5, by - s.up[1] * 1.5, bz - s.up[2] * 1.5, -s.up[0] * 5 + (Math.random() - 0.5) * 2, -s.up[1] * 5, -s.up[2] * 5 + (Math.random() - 0.5) * 2, 0.8 + clamp(s.alt / 100, 0, 1), 5);
      }
    }
  };
  // Eye and target ease as offsets from the subject, so a fast flight never drags the view behind it.
  // A drag swings the eye and it eases back.
  const orbitEye = (px, py, pz, fx, fy, fz, dist, elevation, rate, dt, baseYaw = 0) => {
    // fx..fz: the direction the eye looks along, horizontal in the local frame; the eye sits behind it and up.
    const yaw = baseYaw + cam.offset, el = clamp(elevation + cam.tilt, -1.2, 1.45);
    const ux = LOCAL.ux, uy = LOCAL.uy, uz = LOCAL.uz;
    // Side axis = up x forward.
    const sx = uy * fz - uz * fy, sy = uz * fx - ux * fz, sz = ux * fy - uy * fx;
    const bx = -fx * Math.cos(yaw) + sx * Math.sin(yaw), by = -fy * Math.cos(yaw) + sy * Math.sin(yaw), bz = -fz * Math.cos(yaw) + sz * Math.sin(yaw);
    const ex = px + (bx * Math.cos(el) + ux * Math.sin(el)) * dist;
    const ey = py + (by * Math.cos(el) + uy * Math.sin(el)) * dist;
    const ez = pz + (bz * Math.cos(el) + uz * Math.sin(el)) * dist;
    return settle(px, py, pz, ex, ey, ez, rate, dt);
  };
  const settle = (sx, sy, sz, ex, ey, ez, rate, dt) => {
    if (!cam.warm) {
      cam.ox = ex - sx; cam.oy = ey - sy; cam.oz = ez - sz;
    } else {
      cam.ox = damp(cam.ox, ex - sx, rate, dt);
      cam.oy = damp(cam.oy, ey - sy, rate, dt);
      cam.oz = damp(cam.oz, ez - sz, rate, dt);
    }
    let x = sx + cam.ox, y = sy + cam.oy, z = sz + cam.oz;
    // Never put the eye under the ground or the sea.
    const alt = localAt(x, y, z), g = alt < rocketMod.NEAR_GROUND ? groundAt(x, z) : -Infinity;
    if (g > -Infinity && y < g + 1) y = g + 1;
    if (alt < 1) {
      const k = 1 - alt;
      x += LOCAL.ux * k; y += LOCAL.uy * k; z += LOCAL.uz * k;
    }
    cam.x = x; cam.y = y; cam.z = z;
  };
  const aim = (sx, sy, sz, tx, ty, tz, dt) => {
    if (!cam.warm) {
      cam.ax = tx - sx; cam.ay = ty - sy; cam.az = tz - sz;
      cam.warm = true;
    } else {
      cam.ax = damp(cam.ax, tx - sx, CHASE.targetRate, dt);
      cam.ay = damp(cam.ay, ty - sy, CHASE.targetRate, dt);
      cam.az = damp(cam.az, tz - sz, CHASE.targetRate, dt);
    }
    cam.tx = sx + cam.ax; cam.ty = sy + cam.ay; cam.tz = sz + cam.az;
  };
  const updateCamera = (dt) => {
    if (input.orbiting) cam.dragAt = sceneTime;
    if (phase !== "build" && sceneTime - cam.dragAt > CAM_RETURN_AFTER) {
      cam.offset = damp(cam.offset, 0, CAM_RETURN_RATE, dt);
      cam.tilt = damp(cam.tilt, 0, CAM_RETURN_RATE, dt);
    }
    if (phase === "build") {
      const h = view.height, dist = Math.max(16, h * 1.9 + 6) * cam.buildZoom;
      const tx = spot.x, ty = spot.padY + h * 0.45, tz = spot.z;
      const cp = Math.cos(cam.buildPitch);
      cam.x = tx + Math.sin(cam.buildYaw) * cp * dist;
      cam.y = ty + Math.sin(cam.buildPitch) * dist;
      cam.z = tz + Math.cos(cam.buildYaw) * cp * dist;
      cam.tx = tx; cam.ty = ty; cam.tz = tz;
      cam.warm = false;
    } else {
      const s = flight.state, p = s.p;
      localAt(p.x, p.y, p.z);
      if (phase === "count" || phase === "ignite" || phase === "ascent") {
        // Look along the plane's normal (+x) from the -x side: downrange (+z) runs to the right.
        const dist = CHASE.side + s.height * 1.3 + Math.min(40, s.speed * 0.8) + clamp(s.alt - 42, 0, 150) * 0.12;
        orbitEye(p.x, p.y, p.z, 1, 0, 0, dist, CHASE.sideElevation, CHASE.eyeRate, dt);
        const lead = Math.min(8, s.speed * 0.25);
        aim(p.x, p.y, p.z, p.x + s.v.x / Math.max(1, s.speed) * lead, p.y + s.v.y / Math.max(1, s.speed) * lead, p.z + s.v.z / Math.max(1, s.speed) * lead, dt);
      } else if (phase === "orbit") {
        // Up and behind the held pod, looking steeply down past it so the islands below stay in view.
        orbitEye(p.x, p.y, p.z, LOCAL.dx, LOCAL.dy, LOCAL.dz, CHASE.orbitDist + s.height * 1.2, CHASE.orbitElevation, CHASE.orbitRate, dt, CHASE.orbitYaw);
        aim(p.x, p.y, p.z, p.x - LOCAL.ux * 9, p.y - LOCAL.uy * 9, p.z - LOCAL.uz * 9, dt);
      } else if (phase === "eva" && eva.measuring > 0) {
        // Off to the Ooga's right, so the raised arm and the stick reaching for the rock are in view.
        settle(WALKER.x, WALKER.y, WALKER.z, WALKER.x + SIDE.x * 4.5 - LOOK.x * 1.5 + FRAME.ux * 1.2, WALKER.y + SIDE.y * 4.5 - LOOK.y * 1.5 + FRAME.uy * 1.2, WALKER.z + SIDE.z * 4.5 - LOOK.z * 1.5 + FRAME.uz * 1.2, 4, dt);
        aim(WALKER.x, WALKER.y, WALKER.z, (WALKER.x + ROCK.x) / 2, (WALKER.y + ROCK.y) / 2, (WALKER.z + ROCK.z) / 2, dt);
      } else if (phase === "eva") {
        settle(WALKER.x, WALKER.y, WALKER.z, WALKER.x - LOOK.x * EVA.eye + FRAME.ux * 1.4, WALKER.y - LOOK.y * EVA.eye + FRAME.uy * 1.4, WALKER.z - LOOK.z * EVA.eye + FRAME.uz * 1.4, 10, dt);
        aim(WALKER.x, WALKER.y, WALKER.z, WALKER.x + LOOK.x * 3, WALKER.y + LOOK.y * 3, WALKER.z + LOOK.z * 3, dt);
      } else if (phase === "descent") {
        const vu = s.v.x * LOCAL.ux + s.v.y * LOCAL.uy + s.v.z * LOCAL.uz;
        let hx = s.v.x - LOCAL.ux * vu, hy = s.v.y - LOCAL.uy * vu, hz = s.v.z - LOCAL.uz * vu;
        const hl = Math.hypot(hx, hy, hz);
        if (hl > 3) {
          HEAD.x = damp(HEAD.x, hx / hl, 4, dt);
          HEAD.y = damp(HEAD.y, hy / hl, 4, dt);
          HEAD.z = damp(HEAD.z, hz / hl, 4, dt);
        }
        const chute = s.chute === "open";
        orbitEye(p.x, p.y, p.z, HEAD.x, HEAD.y, HEAD.z, chute ? CHASE.chuteDist : CHASE.podDist, chute ? CHASE.chuteElevation : CHASE.podElevation, CHASE.eyeRate, dt);
        const lead = chute ? 1 : 0, lift = chute ? 2.6 : -10;
        aim(p.x, p.y, p.z, p.x + s.v.x / Math.max(1, s.speed) * lead + LOCAL.ux * lift, p.y + s.v.y / Math.max(1, s.speed) * lead + LOCAL.uy * lift, p.z + s.v.z / Math.max(1, s.speed) * lead + LOCAL.uz * lift, dt);
      } else aim(p.x, p.y, p.z, p.x, p.y, p.z, dt);
    }
    cam.shake = Math.max(0, cam.shake - dt * 2.4);
    const jolt = cam.shake * cam.shake * 0.45;
    setVec(camera.position, cam.x + Math.sin(sceneTime * 43) * jolt, cam.y + Math.sin(sceneTime * 37) * jolt, cam.z + Math.cos(sceneTime * 41) * jolt);
    setVec(camera.target, cam.tx, cam.ty, cam.tz);
    const eyeAlt = localAt(camera.position.x, camera.position.y, camera.position.z);
    camera.near = clamp(0.3 + eyeAlt * 0.004, 0.3, 2);
    camera.fov = FOV;
    return eyeAlt;
  };
  // The clock's sky darkened toward space by the eye's height; the haze thins and moves out.
  const skyFor = (eyeAlt) => {
    const k = smooth((eyeAlt - 30) / 180), o = RENDER_OPTS;
    for (let i = 0; i < 3; i++) {
      o.zenith[i] = lerp(o.zenith[i], SPACE_ZENITH[i], k);
      o.horizon[i] = lerp(o.horizon[i], SPACE_HORIZON[i] * Math.max(0.25, o.day), k * 0.85);
      o.clear[i] = lerp(o.clear[i], SPACE_CLEAR[i], k);
    }
    o.stars = Math.max(o.stars, k * 0.65);
    const high = Math.max(0, eyeAlt - 200);
    o.fogNear = lerp(260, 700, k) + high;
    o.fogFar = lerp(1100, 2600, k) + high * 1.4;
    camera.far = lerp(1600, 4200, k) + high * 2.2;
  };
  const updateLighting = (lit) => {
    const o = RENDER_OPTS;
    if (flight && flight.state.alt < 90) {
      const p = flight.state.p;
      setVec(o.shadowCenter, p.x, Math.max(spot.y, p.y - 6), p.z);
    } else setVec(o.shadowCenter, spot.x, spot.y, spot.z);
    o.time = sceneTime;
    if (lit > 0.05 && flight) {
      const s = flight.state, l = o.lights;
      l[0] = s.p.x - s.up[0] * (s.height / 2 + 1.5);
      l[1] = s.p.y - s.up[1] * (s.height / 2 + 1.5);
      l[2] = s.p.z - s.up[2] * (s.height / 2 + 1.5);
      l[3] = 22 + lit * 10;
      l[4] = 1; l[5] = 0.58; l[6] = 0.22; l[7] = 0;
      o.lightCount = 1;
    } else o.lightCount = 0;
  };
  // quieted: the idle fade is scheduled once per idle stretch, and again after unlock builds the voices.
  let quieted = false;
  const updateAudio = (lit) => {
    if (phase === "build" || phase === "results") {
      if (!quieted) {
        audio.quiet();
        quieted = true;
      }
      return;
    }
    quieted = false;
    const a = audio.state, s = flight.state;
    a.engine = lit;
    a.near = clamp(1.4 - Math.hypot(camera.position.x - s.p.x, camera.position.y - s.p.y, camera.position.z - s.p.z) / 160, 0.2, 1);
    a.air = phase === "orbit" ? 0 : clamp(s.dynQ / 40, 0, 1);
    a.plasma = phase === "descent" ? clamp(heatGlow() * 1.4, 0, 1) : 0;
    audio.update();
  };
  const heatGlow = () => {
    const s = flight.state;
    if (s.mode !== "free" || s.chute === "open") return 0;
    return clamp(s.rho * s.speed * s.speed * s.speed / 3500, 0, 1);
  };
  const updatePod = (dt) => {
    const s = flight.state, glow = heatGlow();
    heatShell.visible = glow > 0.04;
    heatShell.smokeOpacity = clamp(glow * 0.9, 0, 0.9);
    const top = view.parts[view.parts.length - 1];
    top.node.ember = clamp(s.heat * 1.1, 0, 1);
    if (canopy.visible) {
      const k = Math.max(0.02, s.bloom * (0.9 + 0.1 * Math.sin(sceneTime * 3)));
      setVec(canopy.scale, 1.1 * k, 1.1 * s.bloom, 1.1 * k);
      if (s.chute !== "open") canopy.visible = false;
    }
    updatePlasma(glow);
    // Warnings at most every 1.6s, not every frame.
    if (sceneTime - warnAt > 1.6 && (s.heat > 0.72 || s.stress > 0.8)) {
      warnAt = sceneTime;
      audio.cues.warn();
      rhud.notice(s.heat > 0.72 ? (s.mode === "free" ? "TOO HOT · shield into the fire" : "TOO HOT · ease the push") : "STRESS · lean less, push less", 1400);
    }
    if (phase === "descent" && s.chute === "packed" && s.aoa > 1.9 && s.alt < 240 && sceneTime - flipAt > 3.5) {
      flipAt = sceneTime;
      rhud.center("FLIP!", 900);
      rhud.notice("Shield first: point the orange ring at the green one", 2400);
    }
    if (phase === "descent" && chuteCalled && s.chute === "packed" && s.alt < 80 && sceneTime - warnAt > 1.2) {
      warnAt = sceneTime;
      rhud.center("PULL THE CHUTE!", 1000);
      audio.cues.warn();
    }
    if (phase === "descent" && !chuteCalled && flight.chuteReady()) {
      chuteCalled = true;
      rhud.center("CHUTE", 1200);
      rhud.notice("Space · leaves out", 0);
      audio.cues.mark();
    }
    if (dt && phase === "descent" && s.chute === "open" && !chuteCalled) chuteCalled = true;
  };
  const updateHud = () => {
    const s = flight.state;
    rhud.setAlt(s.alt);
    rhud.setSpeed(s.speed);
    const st = flight.stages[s.stage];
    rhud.setBar(rhud.el.fuel, st.engine && st.fuel ? flight.fuel[s.stage] / st.fuel : 0, st.engine && flight.fuel[s.stage] < st.fuel * 0.15 ? "warn" : "");
    rhud.setBar(rhud.el.push, s.burning ? s.throttle * s.boost : 0);
    rhud.setBar(rhud.el.heat, s.heat, s.heat > 0.85 ? "bad" : s.heat > 0.6 ? "warn" : "");
    rhud.setBar(rhud.el.shield, s.shield, s.shield < 0.2 ? "bad" : s.shield < 0.45 ? "warn" : "");
    rhud.setBar(rhud.el.stress, s.stress, s.stress > 0.85 ? "bad" : s.stress > 0.6 ? "warn" : "");
    rhud.setAltimeter(s.alt, TOP);
  };
  const update = (dt, elapsed) => {
    sceneTime = elapsed;
    phaseT += dt;
    agent.update(dt);
    const hour = clock.read();
    daylight.sample(hour, RENDER_OPTS, clock.dayOfYear, islandLatitude, clock.continuousDay);
    const a = readInput();
    if (phase === "count") {
      const left = Math.ceil(COUNT_T - phaseT);
      if (left !== countShown && left > 0) {
        countShown = left;
        rhud.center(String(left), 0);
        audio.cues.tick();
      }
      if (phaseT >= COUNT_T) startSpool();
    } else if (phase === "ignite") {
      gauge = phaseT / SPOOL_T;
      rhud.setGauge(gauge);
      if (gauge >= 1) {
        rhud.setGauge(-1);
        flight.state.failure = "overpressure";
        boom("overpressure");
      }
    } else if (phase === "ascent" || phase === "descent") {
      if (igniteIn > 0 && (igniteIn -= dt) <= 0) {
        igniteIn = 0;
        if (flight.ignite()) {
          rhud.notice("", 1);
          audio.cues.clamp();
        }
      }
      simulate(dt);
      if (phase === "ascent" && !leanHinted && flight.state.alt - spot.padY + SEA > 25 && flight.state.psi < 0.12) {
        leanHinted = true;
        rhud.notice("Lean over with D to the yellow line", 3200);
      }
    } else if (phase === "orbit") hover(dt);
    else if (phase === "eva") {
      hover(dt);
      evaStep(dt, a);
    } else if (phase === "down" || phase === "boom") {
      if (phaseT > (phase === "boom" ? BOOM_T : LANDED_T)) finish();
    }
    if (flight && phase !== "build") placeRock(dt);
    if (phase !== "ignite") rhud.setGauge(-1);
    if (flight && phase !== "build") placeView();
    placeSpeaker();
    const lit = updateFlames();
    exhaust(dt, lit);
    if (flight && phase !== "build") {
      updatePod(dt);
      podPuffs(dt);
      updateHud();
      updateMission();
      rhud.setEva(canWalk());
    }
    updateDebris(dt);
    updateSmoke(dt);
    const eyeAlt = updateCamera(dt);
    skyFor(eyeAlt);
    updateLighting(lit);
    updateAudio(lit);
    fx.update(dt);
    stepTweens(dt);
    meterTimer -= dt;
    if (meterTimer <= 0) {
      meterTimer = 0.25;
      hud.setMeter(world.level, METER_CAPACITY, phase === "build" ? "stable" : flight && orbited ? "in low orbit" : "flying");
    }
  };
  // World markers: green where the flight goes, orange where the shield faces, plus home.
  const MARKER = { x: 0, y: 0 };
  const markerAt = (project, x, y, z) => {
    const q = project(x, y, z);
    if (!q) return null;
    MARKER.x = q.x;
    MARKER.y = q.y;
    return MARKER;
  };
  // Attitude ball: forward half of the sky as a disc, dashed outside the rim when facing back past the eye.
  // Draw orange over green.
  const BALL = { x: 0, y: 0, behind: false };
  const ballAt = (dx, dy, dz, fx, fy, fz, rx, ry, rz, ux, uy, uz, radius) => {
    const f = dx * fx + dy * fy + dz * fz, r = dx * rx + dy * ry + dz * rz, u = dx * ux + dy * uy + dz * uz;
    BALL.behind = f < 0;
    if (!BALL.behind) {
      BALL.x = r * radius;
      BALL.y = -u * radius;
    } else {
      const l = Math.hypot(r, u) || 1, k = radius * (1 + 0.45 * Math.min(1, -f));
      BALL.x = r / l * k;
      BALL.y = -u / l * k;
    }
    return BALL;
  };
  const drawBall = (ctx, s) => {
    // Between the sticks on touch (COARSE), off to the lower left of the pod otherwise.
    const w = ctx.canvas.clientWidth, h = ctx.canvas.clientHeight, radius = 42, cx = COARSE ? w / 2 : Math.min(w / 2 - 170, 150), cy = h - (COARSE ? 200 : 110);
    let fx = cam.tx - camera.position.x, fy = cam.ty - camera.position.y, fz = cam.tz - camera.position.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    localAt(s.p.x, s.p.y, s.p.z);
    let rx = fy * LOCAL.uz - fz * LOCAL.uy, ry = fz * LOCAL.ux - fx * LOCAL.uz, rz = fx * LOCAL.uy - fy * LOCAL.ux;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    ctx.fillStyle = "rgba(20, 16, 12, 0.55)";
    ctx.strokeStyle = "rgba(243, 239, 228, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
    ctx.strokeStyle = "rgba(243, 239, 228, 0.15)";
    ctx.stroke();
    if (s.speed > 1) {
      const b = ballAt(s.v.x / s.speed, s.v.y / s.speed, s.v.z / s.speed, fx, fy, fz, rx, ry, rz, ux, uy, uz, radius);
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.arc(cx + b.x, cy + b.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    const n = ballAt(-s.up[0], -s.up[1], -s.up[2], fx, fy, fz, rx, ry, rz, ux, uy, uz, radius);
    ctx.strokeStyle = "#ff8a2a";
    ctx.lineWidth = 3;
    if (n.behind) ctx.setLineDash(DASH);
    ctx.beginPath();
    ctx.arc(cx + n.x, cy + n.y, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#f3efe4";
    const deg = Math.round(s.aoa * 180 / Math.PI);
    if (deg !== labels.shield) {
      labels.shield = deg;
      labels.shieldText = `SHIELD ${deg}°`;
    }
    ctx.fillText(labels.shieldText, cx, cy + radius + 14);
    ctx.textAlign = "left";
  };
  const DASH = [4, 4], NO_DASH = [];
  // Overlay labels rebuilt only when their number changes.
  const labels = { shield: NaN, shieldText: "", home: NaN, homeText: "" };
  const tag = (ctx, project, x, y, z, color, text) => {
    const m = markerAt(project, x, y, z);
    if (!m) return;
    ctx.fillStyle = color;
    ctx.font = "bold 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, m.x, m.y);
    ctx.textAlign = "left";
  };
  // Yellow line = the climb's aim from the stack's middle, white = where it points now.
  const LEAN_A = { x: 0, y: 0 };
  const drawLean = (ctx, project, s) => {
    localAt(s.p.x, s.p.y, s.p.z);
    const a = markerAt(project, s.p.x, s.p.y, s.p.z);
    if (!a) return;
    LEAN_A.x = a.x;
    LEAN_A.y = a.y;
    const len = s.height * 0.9 + 6, t = leanTarget(s.alt);
    const ty = LOCAL.uy * Math.cos(t) + LOCAL.dy * Math.sin(t), tz = LOCAL.uz * Math.cos(t) + LOCAL.dz * Math.sin(t);
    let m = markerAt(project, s.p.x, s.p.y + ty * len, s.p.z + tz * len);
    if (m) {
      ctx.strokeStyle = "#f5c542";
      ctx.lineWidth = 3;
      ctx.setLineDash(DASH);
      ctx.beginPath();
      ctx.moveTo(LEAN_A.x, LEAN_A.y);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
    }
    m = markerAt(project, s.p.x + s.up[0] * len, s.p.y + s.up[1] * len, s.p.z + s.up[2] * len);
    if (m) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(LEAN_A.x, LEAN_A.y);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
    }
  };
  const drawExtra = (ctx, project) => {
    if (!flight || phase === "build" || phase === "results") return;
    const s = flight.state, p = s.p;
    if (phase === "ascent" || phase === "ignite" || phase === "count") drawLean(ctx, project, s);
    const turning = (phase === "descent" || phase === "orbit") && s.mode === "free" && s.chute !== "open";
    if (turning && s.speed > 2) {
      const k = 30 / s.speed;
      let m = markerAt(project, p.x + s.v.x * k, p.y + s.v.y * k, p.z + s.v.z * k);
      if (m) {
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
        ctx.moveTo(m.x - 15, m.y); ctx.lineTo(m.x - 9, m.y);
        ctx.moveTo(m.x + 9, m.y); ctx.lineTo(m.x + 15, m.y);
        ctx.moveTo(m.x, m.y - 9); ctx.lineTo(m.x, m.y - 15);
        ctx.stroke();
      }
      m = markerAt(project, p.x - s.up[0] * 30, p.y - s.up[1] * 30, p.z - s.up[2] * 30);
      if (m) {
        ctx.strokeStyle = "#ff8a2a";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 14, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (turning) drawBall(ctx, s);
    if ((phase === "eva" || phase === "orbit") && rockNode.visible && !eva.measured) tag(ctx, project, rockNode.position.x, rockNode.position.y + 1.4, rockNode.position.z, "#7fe0ff", "SPACE ROCK");
    if (phase === "eva" && eva.measured) tag(ctx, project, FRAME.hx, FRAME.hy + 0.6, FRAME.hz, "#f5c542", "HATCH");
    if (phase === "orbit" || phase === "descent" || (phase === "ascent" && s.alt > 90)) {
      const m = markerAt(project, spot.x, spot.padY + 2, spot.z);
      const w = ctx.canvas.clientWidth, h = ctx.canvas.clientHeight;
      if (m && m.x > 20 && m.x < w - 20 && m.y > 90 && m.y < h - 20) {
        ctx.strokeStyle = "#f5c542";
        ctx.fillStyle = "#f5c542";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y - 10); ctx.lineTo(m.x + 8, m.y); ctx.lineTo(m.x, m.y + 10); ctx.lineTo(m.x - 8, m.y); ctx.closePath();
        ctx.stroke();
        ctx.font = "bold 11px ui-monospace, monospace";
        ctx.textAlign = "center";
        const home = Math.round(Math.hypot(p.x - spot.x, p.y - spot.padY, p.z - spot.z));
        if (home !== labels.home) {
          labels.home = home;
          labels.homeText = `HOME ${home}`;
        }
        ctx.fillText(labels.homeText, m.x, m.y - 16);
        ctx.textAlign = "left";
      }
    }
  };
  const overlay = (dt) => fx.drawOverlay(dt, drawExtra);

  const onDonation = (donation) => {
    game.recordDonation(donation);
    const bananas = gameMod.bananasFor(donation.sats);
    world.level = Math.min(pileMod.MAX_BANANAS, world.level + bananas);
    const who = donation.handle ? `@${donation.handle}` : "anon";
    const loot = lootEnabled ? game.lootFor(donation) : null;
    hud.toast(`+${gameMod.formatLarge(donation.sats)} sats · ${bananas} banana${bananas > 1 ? "s" : ""} · ${who}${loot ? ` · ${loot.tier} ${loot.item.name}` : ""}`);
    fx.showTicker(`THANKS ${donation.handle ? "@" + donation.handle.toUpperCase() : "ANON"} · ${bananas} BANANAS`, 4.5);
    const p = flight ? flight.state.p : EYE;
    if (!flight) padBase();
    fx.burst(p.x, p.y + 2, p.z, 20, CONFETTI, 2.2);
    if (loot) {
      game.addItem({ item: loot.item, tier: loot.tier, donationId: donation.id });
      renderLocker();
    }
    hud.setStats(game.state);
    meterTimer = 0;
  };
  const renderLocker = () => hud.renderInventory(game.state.inventory, game.assignedTo, () => null);

  const onLootCleared = () => {
    if (!lootEnabled) return;
    renderLocker();
    hud.toast("Loot locker cleared");
  };
  const demoTip = (sats) => onDonation({ id: `demo-${Date.now()}`, sats, handle: game.state.handle, message: game.state.message, at: Date.now() });
  const toggleMute = () => {
    audio.setMuted(!audio.muted);
    rhud.el.mute.setAttribute("aria-pressed", String(audio.muted));
    hud.toast(audio.muted ? "Sound off" : "Sound on");
  };
  const onGesture = () => {
    audio.unlock();
    quieted = false;
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      if (phase === "build") go(home);
      else toBuild();
    }
    if (e.key === "Enter" && (phase === "build" || phase === "results")) launch();
    if (e.key === "0") {
      cam.offset = cam.tilt = 0;
      cam.buildYaw = -0.64;
      cam.buildPitch = 0.18;
      cam.buildZoom = 1;
    }
    if (e.key === "m" || e.key === "M") toggleMute();
    if ((e.key === "g" || e.key === "G") && !e.repeat) {
      selection.assist = !selection.assist;
      hud.toast(selection.assist ? "Autopilot leans the climb (A D still steer)" : "Flying the climb by hand: follow the yellow line");
    }
    if ((e.key === "v" || e.key === "V") && !e.repeat) startEva();
    if (e.key === "b" || e.key === "B") {
      world.level = Math.min(pileMod.MAX_BANANAS, world.level + testBananas);
      hud.toast(`+${testBananas} test bananas`);
    }
    if (e.key === "l" || e.key === "L") demoTip(120000);
  };
  const tooltipFor = (hit) => {
    if (hit.owner.kind !== "part") return "";
    const part = view.parts[hit.owner.index];
    return part ? `${part.part.name} · ${part.part.note}` : "";
  };

  const enter = (ctx) => {
    ({ renderer, game, world, go, lootEnabled, testBananas } = ctx);
    home = ctx.from === "arcade" ? "arcade" : "hub";
    camera = createCamera({ fov: 50, near: 0.3, far: 1600 });
    root = createNode();
    clock = daylight.createClock({ hour: hourParam, daylen: daylenParam, day: dayParam, time: timeParam, now: new Date() });
    island = terrain.island({ seed: SEED });
    spot = rocketModels.siteSpot(island, {});
    hud = hudMod.create({ roster: contributors.roster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled });
    hooks = {};
    input = interactMod.create({ canvas: ctx.canvas, renderer, camera, hooks });
    fx = fxMod.create({ root, renderer, overlay: ctx.overlay, tickerAt: TICKER_AT });
    const place = (node) => {
      addChild(root, node);
      placed.push(node);
      return node;
    };
    // The island and banana pile as the hub builds them (pileMod footprint/growth by world.level).
    place(createNode({ geometry: island.geometry }));
    const level = Math.floor(world.level), footprint = pileMod.footprintFor(level, 0.45);
    const growth = level <= pileMod.DISK_BANANAS ? pileMod.PACKING_HEIGHT * level / pileMod.DISK_BANANAS : pileMod.footprintFor(level, 1) * pileMod.PACKING_HEIGHT;
    place(createNode({ position: { x: 0, y: 0.36, z: 0 }, scale: { x: footprint, y: 0.48 * growth, z: footprint }, geometry: models.bananaPileCoreGeometry(0.45 * 6, 0.48 * 6, 0.45), visible: level > 0 }));
    const slab = place(createNode({ geometry: hubModels.altarSlab(), depthBias: 0.15 }));
    setVec(slab.scale, footprint + 0.3, 0.34, footprint + 0.3);
    place(rocketModels.site(spot));
    // The Agent paces the islet beside the pad, across from the tower.
    const agentX = spot.x - 5.2, agentZ = spot.z + 1;
    agent = orbitScene.agent = BL.agent.create({ groundAt, form: "code", x: agentX, z: agentZ, heading: Math.PI / 2 });
    agent.pace(agentX, agentZ, 0.8);
    place(agent.root);
    planet = place(createNode({ position: { x: 0, y: CY, z: 0 }, geometry: rocketModels.planet() }));
    const rand = mulberry32(SEED + 505);
    for (let i = 0; i < CLOUDS; i++) {
      // Most clouds round home (the first 45), the rest anywhere; none right over the islands.
      const t = i < 45 ? (140 + rand() * 1400) / R : 0.5 + rand() * 2.2, a = rand() * Math.PI * 2, h = R + 28 + rand() * 30;
      const dx = Math.sin(t) * Math.cos(a), dy = Math.cos(t), dz = Math.sin(t) * Math.sin(a);
      const q = quat.create(), axis = Math.hypot(dz, dx) || 1;
      quat.fromAxisAngle(q, dz / axis, 0, -dx / axis, Math.acos(clamp(dy, -1, 1)));
      const s = 3.5 + rand() * 5;
      place(createNode({ position: { x: dx * h, y: CY + dy * h, z: dz * h }, quaternion: q, scale: { x: s, y: s * 0.7, z: s }, geometry: hubModels.cloud(i % 3), matrixCloud: true }));
    }
    smoke = { node: place(createNode({ geometry: rocketModels.puff(), instanceData: new Float32Array(SMOKE * 20), instanceCount: 0, instanceVersion: 0, fixedInstanceCapacity: true, visible: false })), x: new Float32Array(SMOKE), y: new Float32Array(SMOKE), z: new Float32Array(SMOKE), vx: new Float32Array(SMOKE), vy: new Float32Array(SMOKE), vz: new Float32Array(SMOKE), age: new Float32Array(SMOKE), life: new Float32Array(SMOKE), size: new Float32Array(SMOKE), next: 0, count: 0 };
    plasma = { node: place(createNode({ geometry: rocketModels.plasma(), instanceData: new Float32Array(PLASMA * 20), instanceCount: 0, instanceVersion: 0, fixedInstanceCapacity: true, visible: false })), x: new Float32Array(PLASMA), y: new Float32Array(PLASMA), z: new Float32Array(PLASMA) };
    for (let i = 0; i < FIREBALLS; i++) fireballs.push(place(createNode({ geometry: rocketModels.fireball(), visible: false, smokeOpacity: 0 })));
    splashNode = place(createNode({ geometry: rocketModels.splash(), visible: false, smokeOpacity: 0 }));
    canopy = createNode({ geometry: dropModels.canopy(), visible: false });
    heatShell = createNode({ geometry: rocketModels.heatShell(), visible: false, smokeOpacity: 0 });
    mark("orbit world");
    // The Ooga an arcade cabinet sent in arrives as world.pilot and flies.
    if (world.pilot) {
      selection.pilot = world.pilot;
      world.pilot = null;
    }
    rockNode = place(createNode({ geometry: rocketModels.spaceRock(), visible: false }));
    tetherNode = place(createNode({ geometry: rocketModels.tether(), quaternion: quat.create(), visible: false }));
    buildPassenger();
    const saved = game.state.orbit.build;
    stack = saved && saved.length ? saved.slice() : rocketParts.PRESETS[0].stack.slice();
    selected = -1;
    rhud = rocketHud.create({
      best: () => game.state.orbit.best, onAdd: addPart, onMove: movePart, onRemove: removePart, onSelect: selectPart, onPreset: usePreset, onPilot: cyclePilot,
      onInsert: insertPart, onMoveTo: movePartTo, slots: rocketSlots
    });
    rhud.buildPalette();
    rhud.buildMission();
    rhud.setPilot(selection.pilot);
    rhud.refreshBest();
    controls = controlsMod.create({ move: document.getElementById("joy-move"), look: document.getElementById("joy-look"), boost: hud.el.act, chord: ctx.canvas, onAction: act });
    orbitScene.agentControls = controls;
    audio = rocketAudio.create();
    quieted = false;
    rhud.el.mute.setAttribute("aria-pressed", String(audio.muted));
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    const donationRequest = donations.createRequest(game.state);
    qr.drawTo(hud.el.qr, donationRequest.url, { quiet: 3, dark: "#000000", light: "#f3efe4" });
    hud.setDonationUrl(donationRequest.url);
    hud.setIdentity(game.state);
    hud.onIdentityChange(({ handle, message }) => {
      game.setIdentity({ handle: donations.sanitize(handle, donations.HANDLE_MAX), message: donations.sanitize(message, donations.MESSAGE_MAX) });
      hud.setIdentity(game.state);
    });
    hud.onAssign((entryId, name) => {
      if (game.assign(entryId, name)) renderLocker();
    });
    hud.onUnassign((name) => {
      game.unassign(name);
      renderLocker();
    });
    Object.assign(hooks, {
      onHover: (hit, p) => {
        if (hit && phase === "build") hud.tooltip.show(tooltipFor(hit), p.x, p.y);
        else hud.tooltip.hide();
      },
      onHoverMove: (hit, p) => {
        if (phase === "build") hud.tooltip.show(tooltipFor(hit), p.x, p.y);
      },
      onTap: (hit) => {
        if (!hit || hit.owner.kind !== "part") return;
        if (phase === "build") selectPart(hit.owner.index);
        else fx.say(speaker, phase === "descent" ? "Ooga busy!" : "Ooga!", 1.2);
      },
      onOrbit: (dx, dy) => {
        if (phase === "build") {
          cam.buildYaw = wrap(cam.buildYaw - dx * 5e-3);
          cam.buildPitch = clamp(cam.buildPitch + dy * 4e-3, -0.2, 1.2);
        } else if (phase === "eva") {
          eva.yaw = wrap(eva.yaw + dx * 4e-3);
          eva.pitch = clamp(eva.pitch - dy * 3.5e-3, -1.3, 1.3);
        } else {
          cam.offset = wrap(cam.offset - dx * 4e-3);
          cam.tilt = clamp(cam.tilt + dy * 3.5e-3, -1.3, 1.3);
          cam.dragAt = sceneTime;
        }
      },
      onZoom: (delta) => {
        if (phase === "build") cam.buildZoom = clamp(cam.buildZoom * Math.exp(delta * 1e-3), 0.5, 2.2);
      }
    });
    hud.onAction((action) => {
      if (action === "orbit-launch" || action === "orbit-again") launch();
      else if (action === "orbit-eva") startEva();
      else if (action === "orbit-build") toBuild();
      else if (action === "leave") go(home);
      else if (action === "act") act();
      else if (action === "mute") toggleMute();
      else if (action === "tip") demoTip(1200);
      else if (action === "tip-legendary") demoTip(120000);
      else if (action === "clear-loot") {
        game.clearLoot();
        onLootCleared();
      } else if (action === "reset") {
        game.resetAll();
        location.reload();
      }
    });
    for (const c of contributors.roster) hud.setRosterRow(c.name, contributors.stateFor(c), contributors.ageLabel(c));
    if (lootEnabled) renderLocker();
    hud.setStats(game.state);
    hud.el.sheet.dataset.open = "false";
    rhud.el.help.textContent = COARSE
      ? "The button does each step · left stick steers"
      : "Space does each step · G autopilot · V spacewalk\nW S push · A D steer";
    document.getElementById("orbit-help").textContent = COARSE ? "Tap a part to add it · hold and drag it onto the rocket" : "Tap or drag a part onto the rocket · drag a row off to remove it";
    if (COARSE) rhud.el.evaBtn.querySelector("small").textContent = "the button";
    meterTimer = 0;
    cam.buildYaw = -0.64;
    cam.buildPitch = 0.18;
    cam.buildZoom = 1;
    toBuild();
    stateTimer = window.setInterval(() => {
      for (const c of contributors.roster) hud.setRosterRow(c.name, contributors.stateFor(c), contributors.ageLabel(c));
      fx.trimPool();
    }, 6e4);
    hintTimer = window.setTimeout(() => hud.hint(COARSE ? "Stack a rocket, then Launch!" : "Stack a rocket, then Launch! (Enter)"), 1200);
    Object.assign(orbitScene, {
      root, camera, input,
      debug: {
        hud, demoTip, trimPool: fx.trimPool, camera, controls, island, cavemen: null, crates: null, agent: agent.debug,
        get audio() {
          return audio;
        },
        get renderOpts() {
          return RENDER_OPTS;
        },
        get site() {
          return spot;
        },
        get flight() {
          return flight;
        },
        orbit: {
          get phase() {
            return phase;
          },
          get stack() {
            return stack.slice();
          },
          get score() {
            return score;
          },
          get result() {
            return result;
          },
          get gauge() {
            return gauge;
          },
          get cam() {
            return cam;
          },
          selection,
          setStack: (list) => {
            stack.length = 0;
            stack.push(...rocketParts.sanitize(list));
            refreshBuilder();
          },
          get eva() {
            return eva;
          },
          launch, toBuild, act, releaseClamps, dropRest, letGo, pullChute, startEva, evaAct,
          // Where the space rock sits in the pod's frame and how near counts as at it, so a check can place the walker.
          get rock() {
            return { e: eva.rockE, u: eva.rockU, f: eva.rockF, reach: EVA.reach };
          },
          slots: rocketSlots,
          // Run the scene forward without frames, at the fixed step.
          simulate: (seconds) => {
            for (let t = 0; t < seconds; t += FIXED) update(FIXED, sceneTime + FIXED);
          },
          setInput: (input) => {
            inputLocked = !!input;
            if (input) Object.assign(ctrl, input);
          },
          // Skip the climb: straight up to the Sky Top a little downrange of the pad.
          toOrbit: () => {
            if (phase === "build") launch();
            phase = "ascent";
            flight.state.mode = "ascent";
            const r = R + TOP;
            flight.hold(0, CY + Math.cos(0.05) * r, Math.sin(0.05) * r);
            enterOrbit();
          },
        }
      }
    });
  };
  const leave = () => {
    window.clearInterval(stateTimer);
    window.clearTimeout(hintTimer);
    window.removeEventListener("pointerdown", onGesture);
    window.removeEventListener("keydown", onGesture);
    audio.dispose();
    clearPartTargets();
    fx.dispose();
    controls.dispose();
    hud.el.act.hidden = true;
    hud.setAct("Ooga!");
    for (const d of debris) removeChild(root, d.node);
    debris.length = 0;
    if (view) removeChild(root, view.node);
    removeChild(root, astro.root);
    for (const node of placed) removeChild(root, node);
    placed.length = fireballs.length = 0;
    agent.dispose();
    const count = input.targetCount;
    input.dispose();
    rhud.dispose();
    hud.dispose();
    phase = "build";
    inputLocked = false;
    astro = astroStick = astroLight = rockNode = tetherNode = agent = null;
    flight = view = passenger = canopy = heatShell = smoke = plasma = splashNode = planet = spot = hud = rhud = hooks = input = fx = controls = audio = clock = island = null;
    orbitScene.input = orbitScene.debug = orbitScene.agent = orbitScene.agentControls = null;
    return { targets: count };
  };
  const liveGeometry = (set) => {
    agent.liveGeometry(set);
    set.add(passenger.headOpen).add(passenger.headClosed).add(astro.headOpen).add(astro.headClosed);
  };
  const stats = () => {
    let nodes = 0;
    traverseVisible(root, () => nodes++);
    const all = (n) => 1 + n.children.reduce((sum, c) => sum + all(c), 0);
    return { visibleNodes: nodes, allNodes: all(root), tweens: tweenCount(), targets: input.targetCount, ...fx.stats(), phase, smoke: smoke.count, debris: debris.length };
  };
  Object.assign(orbitScene, { enter, update, overlay, onDonation, onKey, onLootCleared, leave, stats, liveGeometry });
  BL.scenes = BL.scenes || {};
  BL.scenes.orbit = orbitScene;
})();
