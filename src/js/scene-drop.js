// Ooga Drop: the skydiving scene; its plane takes off from the roof of the island's 9 o'clock cave.
//
// Phases `board`, `climb`, `air`, `down`, `lost`, `results`: the plane's roll, helix climb and jump mark,
// the course laid on a hands-off reference fall, ring crossings, the streak batch, clouds, the two-axis
// orbit camera (unbounded yaw in flight, easing back behind the subject 1.5 s after the last drag), the
// island's clock, donations, `leave`. The jump is at `JUMP_ALT` 430, well over the first ring at 300, so
// the fall has time to line up on the column; a held Space hurries the plane up and round again on every
// lap until the count, and the last `COUNT_SECONDS` before the mark read 3, 2, 1 (`audio.cues.count`),
// then JUMP. `layCourse(jump)` draws the dogleg's size, side and the reference pitch from the jump count
// (`game.recordJump`, `game.state.drop.jumps`), so every jump has its own shape while staying flyable by
// construction.
//
// Rings through the middle (`BULL`) are bullseyes and all eight a clean sweep; a miss within `NEAR_MISS`
// says by how much. The next two rings are lit and the rest dim, and a `marker` hoop sits on the next
// ring's plane where the fall is heading. Accuracy is to the nearer of the target and the pile's middle;
// a canopy touchdown under `SOFT_SINK` and a pull under `LOW_PULL` pay bonuses; results say the distance
// to the next medal and the jump number; a score of zero is never a best. On touchdown the eye cuts low
// and to the side, and a pile landing squashes the mound.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, contributors, donations, qr, terrain, hubModels, dropModels, daylight, pile: pileMod, game: gameMod, hud: hudMod, interact: interactMod, controls: controlsMod, fx: fxMod, skydiver, dropHud, dropAudio } = BL;
  const { clamp, lerp, damp, quat, mulberry32 } = math;
  const { createNode, addChild, removeChild, createCamera, addTween, stepTweens, tweenCount, traverseVisible } = BL.scene;
  const { CONFETTI } = fxMod;
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
  // Climb: a roll along the roof, then a helix round the island up to jump height, blended from the straight run.
  // The jump sits well above the first ring, so there is time in the air to line up on the column.
  const JUMP_ALT = 430, HELIX_R = 40, PLANE_SPEED = 20, HELIX_W = PLANE_SPEED / HELIX_R, ROLL_T = 1.3, CLIMB_T = 17, BLEND_T = 4, SKIP_SCALE = 4;
  // Jump window opens once a lap as the plane passes the course start and stays open JUMP_GRACE seconds after.
  // JUMP_WINDOW and JUMP_GET_READY are radians before the mark; the count runs 3, 2, 1 in the last COUNT_SECONDS.
  const JUMP_WINDOW = 0.42, JUMP_GRACE = 1.6, JUMP_GET_READY = 3, COUNT_SECONDS = 3;
  const NEXT_RING_PULSE = 0.1;
  // Rings lie on the fall of a diver steering for the target at half stick, so the course is flyable by build.
  // The dogleg's size, side and the pitch of the reference fall are drawn per jump, so every course has its own shape.
  const RING_COUNT = 8, RING_TOP = 300, RING_BOTTOM = 118, RING_STEP = (RING_TOP - RING_BOTTOM) / (RING_COUNT - 1), RING_R0 = 8, RING_R1 = 5, RING_WANDER = 3, TARGET_R = 11, AUTOPILOT = { pitch: [0.4, 0.6], yaw: 1.5, settle: 30, dogleg: [10, 24], doglegFrom: 250, doglegTo: 170 };
  // Off the island the fall is lost once it drops past LOST_Y; crashes and landings hold before the results.
  const PULL_ALT = 90, LOST_Y = -8, LANDED_T = 1.9, LOST_T = 1.8;
  // BULL is the share of a ring's radius that counts as its middle; SOFT_SINK the sink under the canopy that lands softly; LOW_PULL the altitude a late pull is paid under.
  const SCORE = { ring: 100, bullseye: 150, sweep: 200, land: 500, landRadius: 10, stand: 200, stumble: 50, soft: 100, lowPull: 100, banana: 300 };
  const BULL = 0.4, SOFT_SINK = 3.5, LOW_PULL = 60, NEAR_MISS = 3;
  const STREAKS = 160, STREAK_BOX = 18, STREAK_MIN = 9;
  const CLOUD_HIGH = 36, CLOUD_LOW = 14;
  // Camera distances, default elevations in radians and look-ahead per phase.
  // On the final approach to the mark the plane's eye rises and looks down ahead so the rings show below.
  const CHASE = { climbDist: 12, climbElevation: 0.3, climbAhead: 7, markDist: 3, markLift: 0.35, markAhead: 5, markDrop: 8, freeDist: 6.5, freeElevation: 1.05, freeAhead: 4, canopyDist: 8.5, canopyElevation: 0.5, canopyAhead: 2.5, eyeRate: 7, targetRate: 12 };
  const FOV_BASE = 50 * Math.PI / 180, FOV_FAST = 72 * Math.PI / 180;
  const TICKER_AT = { x: 0, y: 14, z: 0 };
  const DUST = models.particleGeometry("#a3874f", 0.1, 0);
  const DIRT = models.particleGeometry("#3a2a18", 0.12, 0);
  const BANANA_BIT = models.particleGeometry("#f5c542", 0.08, 0.5);
  const CLOUD_PUFF = models.particleGeometry("#eef3f7", 0.14, 0.2);
  const DUST_BITS = [DUST], DIRT_BITS = [DIRT], BANANA_BITS = [BANANA_BIT], CLOUD_BITS = [CLOUD_PUFF];
  const MARKER_SCALE = 0.6;
  // Sky, light and haze; daylight.sample rewrites these from the island's clock every frame. The haze reaches full
  // strength only far past anything the dive shows: from altitude the sea below sits hundreds of metres off, and a
  // nearer far end washed it out to the pale horizon colour.
  const RENDER_OPTS = {
    clear: new Float32Array(3), horizon: new Float32Array(3), zenith: new Float32Array(3), sky: new Float32Array(3), ground: new Float32Array(3), sun: new Float32Array(3), direct: new Float32Array(3),
    light: { x: 0.55, y: 0.78, z: -0.25 }, sunDirection: { x: 0, y: 1, z: 0 }, moon: { x: 0, y: 1, z: 0 }, starMatrix: new Float32Array(9),
    stars: 0, torch: 0, day: 1, twilight: 0, lampFactor: 0, directStrength: 1, sunStrength: 1, moonStrength: 0, ambientFloor: 0.18, diffuseFloor: 0, shadowStrength: 1, shadowFloor: 0, shadowBias: 0.002,
    time: 0, bloomStrength: 0.5, lights: new Float32Array(80), lightCount: 0, shadowCenter: { x: 0, y: 0, z: 0 }, shadowExtent: 34, fog: null, fogNear: 320, fogFar: 1500
  };
  RENDER_OPTS.starMatrix[0] = RENDER_OPTS.starMatrix[4] = RENDER_OPTS.starMatrix[8] = 1;
  RENDER_OPTS.fog = RENDER_OPTS.horizon;
  RENDER_OPTS.clouds = 0.42;
  // Deeper than the hub's: the low cloud deck here reaches down to -78.
  RENDER_OPTS.sea = -95;
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
  // Module scope, so the board keeps the last pick for the page's life across visits.
  const selection = { racer: contributors.activeRoster[0]?.name || null };

  // One visit's state: made in enter, dropped in leave.
  // Where the game exits to: back to Ooga Arcade when a cabinet started it, otherwise the island.
  let home = "hub";
  let renderer, game, world, go, lootEnabled, testBananas, root, camera, island, hud, dhud, hooks, input, fx, controls, audio, clock, diver, plane, streaks, mound, hole, agent, marker;
  let phase = "board", jumpOpenUntil = 0, callStage = 0, markNear = 0, accumulator = 0, sceneTime = 0, flightTime = 0, landedAt = 0, score = 0, ringsHit = 0, pulled = false, jumpOpen = false, result = null;
  // The pull altitude and the sink at touchdown, for the bonuses they earn.
  let pullAlt = 0, landSink = 0, life = null;
  let meterTimer = 0, stateTimer = 0, hintTimer = 0;
  const placed = [];
  const clouds = [];
  const rings = [];
  const roof = { x: 0, y: 0, z: 0, ry: 0, ax: 0, az: 1 };
  const landingSpot = { x: 0, z: 0, y: 0 };
  // A drag swings the eye any distance round the subject; in flight it eases back behind after CAM_RETURN_AFTER.
  const CAM_RETURN_AFTER = 1.5, CAM_RETURN_RATE = 4;
  const cam = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, warm: false, offset: 0, tilt: 0, dragAt: -9, boardYaw: 0, boardLift: 0, shake: 0 };
  const EYE = { x: 0, y: 0, z: 0 };
  // Where the diver's head points across the ground, kept through a head-down dive so the view never swings.
  const HEAD = { x: 0, z: 1 };
  const ctrl = { pitch: 0, roll: 0, yaw: 0, flare: false };
  const NO_INPUT = { pitch: 0, roll: 0, yaw: 0, flare: false };
  const AUTO = { pitch: 0, roll: 0, yaw: 0, flare: false };
  const PATH = { x: 0, y: 0, z: 0 }, PATH_AHEAD = { x: 0, y: 0, z: 0 }, SEAT = new Float32Array(3);
  const planeState = { t: 0, speed: 0, yaw: 0, pitch: 0, roll: 0, angle: 0, alt: 0, vx: 0, vy: 0, vz: 0 };
  let jumpAngle = 0;
  const jumpT = ROLL_T + CLIMB_T;
  const dropScene = {
    id: "drop", renderOpts: RENDER_OPTS, root: null, camera: null, input: null, debug: null, agent: null, agentControls: null,
    get inMotion() {
      return phase === "climb" || phase === "air" || phase === "down" || phase === "lost" || fx.inMotion;
    }
  };

  // Position along the climb at time t, written into out.
  const pathAt = (t, out) => {
    const roll = Math.min(t, ROLL_T), accel = PLANE_SPEED / ROLL_T;
    let along = 0.5 * accel * roll * roll;
    if (t > ROLL_T) along += PLANE_SPEED * (t - ROLL_T);
    const sx = roof.x + roof.ax * along, sz = roof.z + roof.az * along;
    const rise = (JUMP_ALT - roof.y) * smooth((t - ROLL_T) / CLIMB_T);
    const y = roof.y + rise;
    if (t <= ROLL_T) return setVec(out, sx, y, sz);
    const angle = planeAngle(t);
    const hx = Math.sin(angle) * HELIX_R, hz = -Math.cos(angle) * HELIX_R;
    const k = smooth((t - ROLL_T) / BLEND_T);
    return setVec(out, lerp(sx, hx, k), y, lerp(sz, hz, k));
  };
  const planeAngle = (t) => Math.atan2(roof.x, -roof.z) + Math.PI + HELIX_W * Math.max(0, t - ROLL_T);
  const flyPlane = (dt) => {
    const s = planeState;
    s.t += dt;
    pathAt(s.t, PATH);
    pathAt(s.t + 0.02, PATH_AHEAD);
    s.vx = (PATH_AHEAD.x - PATH.x) / 0.02;
    s.vy = (PATH_AHEAD.y - PATH.y) / 0.02;
    s.vz = (PATH_AHEAD.z - PATH.z) / 0.02;
    const h = Math.hypot(s.vx, s.vz);
    s.speed = Math.hypot(h, s.vy);
    const yaw = h > 0.01 ? Math.atan2(s.vx, s.vz) : s.yaw;
    const yawRate = dt > 0 ? wrap(yaw - s.yaw) / dt : 0;
    s.yaw = yaw;
    s.pitch = damp(s.pitch, h > 0.01 ? -Math.atan2(s.vy, h) : 0, 6, dt);
    s.roll = damp(s.roll, clamp(-yawRate * s.speed / 14, -0.7, 0.7), 4, dt);
    s.angle = planeAngle(s.t);
    s.alt = PATH.y;
    setVec(plane.node.position, PATH.x, PATH.y, PATH.z);
    quat.fromEuler(plane.node.quaternion, s.pitch, s.yaw, s.roll);
    plane.prop.rotation.z += dt * (8 + s.speed * 2);
  };
  const parkPlane = () => {
    const s = planeState;
    s.t = 0;
    s.speed = s.roll = 0;
    s.pitch = dropModels.PARK_PITCH;
    s.yaw = roof.ry;
    s.vx = s.vy = s.vz = 0;
    s.angle = planeAngle(0);
    s.alt = roof.y;
    setVec(plane.node.position, roof.x, roof.y, roof.z);
    quat.fromEuler(plane.node.quaternion, s.pitch, roof.ry, 0);
  };
  const seatDiver = () => {
    const seat = plane.seat;
    quat.rotateVec(SEAT, plane.node.quaternion, seat.x, seat.y + 0.12, seat.z);
    setVec(diver.state.p, plane.node.position.x + SEAT[0], plane.node.position.y + SEAT[1], plane.node.position.z + SEAT[2]);
    quat.copy(diver.state.q, plane.node.quaternion);
  };

  // The course for jump number `jump`: the same reference fall, its dogleg drawn from that jump's dice.
  const layCourse = (jump) => {
    const rand = mulberry32(SEED + 41 + jump * 17);
    const dogleg = lerp(AUTOPILOT.dogleg[0], AUTOPILOT.dogleg[1], rand()) * (rand() < 0.5 ? -1 : 1);
    const pitch = lerp(AUTOPILOT.pitch[0], AUTOPILOT.pitch[1], rand());
    jumpAngle = planeAngle(jumpT);
    pathAt(jumpT, PATH);
    pathAt(jumpT + 0.02, PATH_AHEAD);
    const vx = (PATH_AHEAD.x - PATH.x) / 0.02, vy = (PATH_AHEAD.y - PATH.y) / 0.02, vz = (PATH_AHEAD.z - PATH.z) / 0.02;
    // The target sits on the meadow on the jump's side of the island.
    setVec(landingSpot, Math.sin(jumpAngle) * TARGET_R, 0, -Math.cos(jumpAngle) * TARGET_R);
    landingSpot.y = island.surfaceAt(landingSpot.x, landingSpot.z);
    // Flies the reference fall without frames, tracking the target at half stick and easing off overhead.
    // Each ring lands on that path at its height; this drives the real diver, so it ends with diver.hide().
    diver.place(PATH.x, PATH.y, PATH.z, Math.atan2(vx, vz));
    diver.jump(vx, vy, vz, Math.atan2(vx, vz));
    const s = diver.state;
    let head = Math.atan2(vx, vz);
    // High up the reference aims AUTOPILOT.dogleg beside the target, sliding on between doglegFrom and doglegTo.
    const legX = landingSpot.x + Math.cos(jumpAngle) * dogleg, legZ = landingSpot.z + Math.sin(jumpAngle) * dogleg;
    for (let i = 0, guard = 0; i < RING_COUNT && guard < 6000; guard++) {
      const k = smooth((AUTOPILOT.doglegFrom - s.p.y) / (AUTOPILOT.doglegFrom - AUTOPILOT.doglegTo));
      const dx = lerp(legX, landingSpot.x, k) - s.p.x, dz = lerp(legZ, landingSpot.z, k) - s.p.z, dist = Math.hypot(dx, dz);
      if (Math.hypot(s.up[0], s.up[2]) > 0.3) head = Math.atan2(s.up[0], s.up[2]);
      const diff = wrap(Math.atan2(dx, dz) - head);
      AUTO.yaw = clamp(diff * AUTOPILOT.yaw, -1, 1);
      AUTO.pitch = Math.abs(diff) < 0.6 ? pitch * Math.min(1, dist / AUTOPILOT.settle) : 0;
      diver.substep(FIXED, AUTO);
      const y = RING_TOP - i * RING_STEP;
      if (s.p.y > y) continue;
      const ring = rings[i];
      const wander = RING_WANDER * i / (RING_COUNT - 1), a = rand() * Math.PI * 2;
      ring.x = s.p.x + Math.cos(a) * wander * rand();
      ring.z = s.p.z + Math.sin(a) * wander * rand();
      ring.y = y;
      ring.r = lerp(RING_R0, RING_R1, i / (RING_COUNT - 1));
      i++;
    }
    for (const ring of rings) {
      setVec(ring.node.position, ring.x, ring.y, ring.z);
      setVec(ring.node.scale, ring.r, ring.r, ring.r);
    }
    diver.hide();
  };
  const resetRings = () => {
    for (const ring of rings) {
      ring.hit = false;
      ring.node.glow = 1;
      setVec(ring.node.scale, ring.r, ring.r, ring.r);
    }
  };
  let ringIndex = 0;
  // Through the middle is a bullseye; all eight is a clean sweep on top.
  const hitRing = (ring, i, d2) => {
    ring.hit = true;
    ring.node.glow = 0.2;
    ringsHit++;
    const bull = d2 < ring.r * ring.r * BULL * BULL;
    score += bull ? SCORE.bullseye : SCORE.ring;
    fx.burst(ring.x, ring.y, ring.z, bull ? 22 : 14, CONFETTI, bull ? 3.6 : 3);
    audio.cues.ring();
    dhud.center(bull ? "BULLSEYE" : `+${SCORE.ring}`, 700);
    if (ringsHit === RING_COUNT) {
      score += SCORE.sweep;
      dhud.notice(`clean sweep · +${SCORE.sweep}`, 1600);
    } else dhud.notice(i === RING_COUNT - 1 ? "last ring!" : bull ? `bullseye · +${SCORE.bullseye}` : `ring ${ringsHit}`, 1200);
    cam.shake = Math.max(cam.shake, bull ? 0.35 : 0.25);
    addTween({
      dur: 0.5, ease: math.ease.outBack, update: (k) => {
        const s = ring.r * (1 + 0.18 * Math.sin(k * Math.PI));
        setVec(ring.node.scale, s, s, s);
      }
    });
  };
  // A substep's segment crossing a ring's plane inside its radius counts as a hit.
  const checkRings = () => {
    const s = diver.state, p = s.p, pp = s.pp;
    while (ringIndex < RING_COUNT && rings[ringIndex].y > pp.y) ringIndex++;
    while (ringIndex < RING_COUNT && rings[ringIndex].y > p.y) {
      const ring = rings[ringIndex];
      const t = (pp.y - ring.y) / Math.max(1e-6, pp.y - p.y);
      const qx = pp.x + (p.x - pp.x) * t, qz = pp.z + (p.z - pp.z) * t;
      const d2 = (qx - ring.x) ** 2 + (qz - ring.z) ** 2;
      if (d2 < ring.r * ring.r) hitRing(ring, ringIndex, d2);
      else {
        audio.cues.miss();
        setVec(ring.node.scale, ring.r, ring.r, ring.r);
        const by = Math.sqrt(d2) - ring.r;
        if (by < NEAR_MISS) dhud.notice(`missed by ${by.toFixed(1)}`, 1200);
      }
      ringIndex++;
    }
  };

  // The island's walkable surface plus the banana mound at its middle; -Infinity off the edge.
  const groundAt = (x, z) => {
    if (!island.onLand(x, z)) return -Infinity;
    const r = Math.hypot(x, z);
    if (r < mound.node.scale.x) return mound.y + mound.height * Math.max(0, 1 - (r / mound.node.scale.x) ** 2);
    if (r < mound.radius) return mound.y;
    return island.surfaceAt(x, z);
  };
  const onBanana = (x, z) => Math.hypot(x, z) < mound.radius;

  const toBoard = () => {
    phase = "board";
    parkPlane();
    if (diver) {
      diver.place(roof.x, roof.y, roof.z, roof.ry);
      seatDiver();
    }
    resetRings();
    ringIndex = 0;
    score = ringsHit = 0;
    pulled = jumpOpen = false;
    callStage = markNear = 0;
    jumpOpenUntil = 0;
    result = null;
    flightTime = 0;
    streaks.node.instanceCount = 0;
    streaks.node.visible = false;
    hole.visible = false;
    marker.visible = false;
    pullAlt = landSink = 0;
    cam.boardYaw = cam.boardLift = 0;
    cam.offset = cam.tilt = 0;
    cam.warm = false;
    dhud.show("board");
    hud.el.act.hidden = true;
    hud.setSubtitle("Ooga Drop · the roof");
    boardView();
  };
  const startFlight = () => {
    if (!diver) return false;
    // A new course for every jump; the diver is put back on the roof after it is laid.
    layCourse(game.recordJump());
    toBoard();
    phase = "climb";
    dhud.show("flight");
    dhud.setRings(0, RING_COUNT);
    dhud.setChute("pack");
    dhud.setTime(0);
    hud.el.act.hidden = !COARSE;
    hud.setAct("Jump!");
    hud.setSubtitle("Ooga Drop · climbing");
    window.clearTimeout(hintTimer);
    hud.hint("", 0);
    dhud.notice(COARSE ? "hold Jump! to hurry the climb" : "hold Space to hurry the climb", 2600);
    fx.say(diver.cave, "Ooga fly!", 1.6);
  };
  const jump = () => {
    if (phase !== "climb" || !jumpOpen) return false;
    seatDiver();
    const s = planeState;
    diver.jump(s.vx, s.vy, s.vz, s.yaw);
    phase = "air";
    accumulator = 0;
    ringIndex = 0;
    flightTime = 0;
    dhud.center("", 0);
    dhud.notice("", 1);
    cam.offset = cam.tilt = 0;
    HEAD.x = Math.sin(s.yaw);
    HEAD.z = Math.cos(s.yaw);
    hud.setAct("Pull!");
    hud.setSubtitle("Ooga Drop · freefall");
    fx.say(diver.cave, "OOGA GERONIMO!", 1.8);
    audio.cues.jump();
    cam.warm = false;
    return true;
  };
  const deploy = () => {
    if (phase !== "air" || !diver.deploy()) return false;
    const g = groundAt(diver.state.p.x, diver.state.p.z);
    pullAlt = diver.state.p.y - (g === -Infinity ? 0 : Math.max(0, g));
    dhud.setChute("canopy");
    hud.setAct("Flare");
    hud.setSubtitle("Ooga Drop · under canopy");
    dhud.center("PULL", 700);
    dhud.notice("", 1);
    cam.offset = cam.tilt = 0;
    audio.cues.pull();
    audio.cues.open();
    cam.shake = Math.max(cam.shake, 0.4);
    fx.burst(diver.state.p.x, diver.state.p.y + 1.5, diver.state.p.z, 8, CLOUD_BITS, 2);
    return true;
  };
  const landingLabel = { stand: "Stood it up", stumble: "Stumbled", tumble: "Tumbled", hole: "Went through the ground", pancake: "Flattened", lost: "Lost in the clouds" };
  const CRASHES = { tumble: "Ooga rolled to a stop. The ground won.", hole: "Ooga went through the meadow. Ooga is a hole now.", pancake: "Ooga is a pancake now." };
  const crashed = (landing) => landing === "tumble" || landing === "hole" || landing === "pancake";
  // Accuracy is to whichever is nearer, the meadow target or the pile's middle: the card says land on the
  // pile, so the pile pays.
  const finish = (landing, dist) => {
    if (!diver) return;
    phase = "results";
    const p = diver.state.p, pileDist = Math.hypot(p.x, p.z), near = Math.min(dist, pileDist);
    const accuracy = landing === "lost" || crashed(landing) ? 0 : Math.round(SCORE.land * clamp(1 - near / SCORE.landRadius, 0, 1));
    const stood = landing === "stand" ? SCORE.stand : landing === "stumble" ? SCORE.stumble : 0;
    const soft = landing === "stand" && landSink <= SOFT_SINK ? SCORE.soft : 0;
    const low = pulled && pullAlt > 0 && pullAlt < LOW_PULL && landing !== "lost" && !crashed(landing) ? SCORE.lowPull : 0;
    const banana = landing !== "lost" && !crashed(landing) && onBanana(p.x, p.z) ? SCORE.banana : 0;
    score += accuracy + stood + soft + low + banana;
    const medal = dhud.medalFor(score);
    const improved = game.recordDrop({ score, rings: ringsHit, ringTotal: RING_COUNT, landing });
    result = { landing, dist, accuracy, soft: stood + soft, low, banana, score, medal, improved };
    const rows = [["Rings", `${ringsHit} of ${RING_COUNT} · ${score - accuracy - stood - soft - low - banana}`], ["Landing", landing === "lost" ? landingLabel.lost : `${landingLabel[landing]} · ${near.toFixed(1)} from the ${pileDist < dist ? "pile" : "target"} · ${accuracy}`]];
    if (landing !== "lost") rows.push(["Touchdown", `${stood}${soft ? ` · soft ${soft}` : ""}`]);
    if (low) rows.push(["Low pull", `${Math.round(pullAlt)} up · ${low}`]);
    if (banana) rows.push(["Banana landing", `${banana}`]);
    const M = dropHud.MEDALS, nextMedal = score < M.bronze ? "bronze" : score < M.silver ? "silver" : score < M.gold ? "gold" : null;
    rows.push(["Time", dhud.formatTime(flightTime * 1000)], ["Score", `${score}${medal ? ` · ${medal.toUpperCase()}` : ""}${nextMedal ? ` · ${M[nextMedal] - score} short of ${nextMedal}` : ""}`], ["Jump", `#${game.state.drop.jumps}`]);
    dhud.results(rows, crashed(landing) ? CRASHES[landing] : landing === "lost" ? "The island went by. Try aiming at it." : `${medal ? `${medal.toUpperCase()} drop` : "A drop"}${improved ? " · new best" : ""}`);
    hud.letterSign(dhud.el.results.querySelector("[data-sign]"), crashed(landing) ? "Crashed" : landing === "lost" ? "Lost" : "Landed");
    hud.el.act.hidden = true;
    hud.setSubtitle(`Ooga Drop · ${crashed(landing) ? "crashed" : landing === "lost" ? "lost" : "landed"}`);
    if (medal) audio.cues.finish();
    if (medal === "gold") fx.say(diver.cave, "OOGA CHAMPION!", 3);
    else if (landing === "stand") fx.say(diver.cave, "Ooga land good.", 2);
  };
  const touchdown = (groundY) => {
    landSink = -diver.state.v.y;
    const landing = diver.land(groundY);
    phase = "down";
    landedAt = sceneTime;
    const p = diver.state.p, crash = crashed(landing);
    fx.burst(p.x, groundY + 0.1, p.z, crash ? 14 : 6, landing === "hole" ? DIRT_BITS : DUST_BITS, crash ? 2.4 : 1.2);
    if (landing === "hole") {
      setVec(hole.position, p.x, groundY + 0.01, p.z);
      hole.visible = true;
    }
    marker.visible = false;
    // The eye cuts low and to the side so the landing, good or bad, is seen.
    cam.warm = false;
    if (onBanana(p.x, p.z)) {
      fx.burst(p.x, groundY + 0.3, p.z, 10, BANANA_BITS, 2);
      // The pile takes the hit and springs back.
      const base = mound.scaleY;
      addTween({
        dur: 0.6, update: (k) => {
          mound.node.scale.y = base * (1 - 0.15 * Math.sin(k * Math.PI));
        }
      });
    }
    dhud.center(landing === "stand" ? (onBanana(p.x, p.z) ? "GREAT" : "NICE") : landing === "hole" ? "THUD" : landing === "pancake" ? "SPLAT" : "CRASH", 1400);
    dhud.setChute("down");
    cam.shake = Math.max(cam.shake, crash ? 0.9 : 0.3);
    audio.cues[landing]();
    hud.el.act.hidden = true;
    if (crash) fx.say(diver.cave, landing === "hole" ? "Dark in here." : landing === "pancake" ? "Ooga flat." : "Ow. Ooga bones.", 2);
    else if (onBanana(p.x, p.z)) fx.say(diver.cave, "BANANA LANDING!", 2);
  };
  const lost = () => {
    phase = "lost";
    landedAt = sceneTime;
    dhud.center("LOST", 1400);
    audio.cues.lost();
    fx.say(diver.cave, "Where island go?", 2);
    hud.el.act.hidden = true;
  };
  const act = () => {
    if (phase === "board") {
      startFlight();
      return true;
    }
    if (phase === "climb") {
      if (jump()) return true;
      dhud.notice("wait for the mark", 900);
      return false;
    }
    if (phase === "air") return deploy();
    if (phase === "results") {
      startFlight();
      return true;
    }
    return false;
  };

  const readInput = () => {
    const a = controls.read();
    ctrl.pitch = clamp(a.y - (COARSE ? 0 : a.pitch), -1, 1);
    ctrl.roll = a.x;
    ctrl.yaw = a.yaw;
    ctrl.flare = a.up > 0;
    return a;
  };
  const simulate = (dt) => {
    accumulator = Math.min(accumulator + dt, FIXED * MAX_SUBSTEPS);
    while (accumulator >= FIXED && phase === "air") {
      accumulator -= FIXED;
      diver.substep(FIXED, ctrl);
      flightTime += FIXED;
      const p = diver.state.p;
      if (diver.state.phase === "free") checkRings();
      const ground = groundAt(p.x, p.z);
      if (p.y - diver.FOOT <= ground) touchdown(ground);
      else if (p.y < LOST_Y && ground === -Infinity) lost();
    }
  };
  // Streaks are fixed in the world inside a box round the diver, reseeded ahead as they fall behind.
  const updateStreaks = () => {
    const s = diver.state, v = s.v, speed = s.speed, node = streaks.node;
    if (phase !== "air" || speed < STREAK_MIN) {
      node.instanceCount = 0;
      node.visible = false;
      return;
    }
    const p = s.p, data = node.instanceData;
    const dx = v.x / speed, dy = v.y / speed, dz = v.z / speed;
    // A perpendicular pair for the line's cross section; the axis flips near vertical to avoid a degenerate cross.
    const ax = Math.abs(dy) < 0.9 ? 0 : 1, ay = Math.abs(dy) < 0.9 ? 1 : 0;
    let px = ay * dz, py = -ax * dz, pz = ax * dy - ay * dx;
    const pl = Math.hypot(px, py, pz) || 1;
    px /= pl;
    py /= pl;
    pz /= pl;
    const qx = dy * pz - dz * py, qy = dz * px - dx * pz, qz = dx * py - dy * px;
    const len = clamp(speed * 0.09, 0.4, 3.2);
    for (let i = 0; i < STREAKS; i++) {
      let x = streaks.x[i] - p.x, y = streaks.y[i] - p.y, z = streaks.z[i] - p.z;
      if (x * dx + y * dy + z * dz < -4 || Math.abs(x) > STREAK_BOX || Math.abs(y) > STREAK_BOX || Math.abs(z) > STREAK_BOX) {
        const ahead = 4 + Math.random() * (STREAK_BOX - 4), a = Math.random() * Math.PI * 2, r = Math.random() * 12;
        x = dx * ahead + (px * Math.cos(a) + qx * Math.sin(a)) * r;
        y = dy * ahead + (py * Math.cos(a) + qy * Math.sin(a)) * r;
        z = dz * ahead + (pz * Math.cos(a) + qz * Math.sin(a)) * r;
        streaks.x[i] = p.x + x;
        streaks.y[i] = p.y + y;
        streaks.z[i] = p.z + z;
      }
      const o = i * 20;
      data[o] = px; data[o + 1] = py; data[o + 2] = pz; data[o + 3] = 0;
      data[o + 4] = qx; data[o + 5] = qy; data[o + 6] = qz; data[o + 7] = 0;
      data[o + 8] = dx * len; data[o + 9] = dy * len; data[o + 10] = dz * len; data[o + 11] = 0;
      data[o + 12] = streaks.x[i]; data[o + 13] = streaks.y[i]; data[o + 14] = streaks.z[i]; data[o + 15] = 1;
      data[o + 16] = Math.min(1, (speed - STREAK_MIN) / 12); data[o + 17] = 0; data[o + 18] = 0; data[o + 19] = 0;
    }
    node.instanceCount = STREAKS;
    node.visible = true;
    node.instanceVersion++;
  };
  const boardView = () => {
    const c = Math.cos(roof.ry + cam.boardYaw), s = Math.sin(roof.ry + cam.boardYaw);
    cam.tx = roof.x;
    cam.ty = roof.y + 1.4;
    cam.tz = roof.z;
    cam.x = roof.x + s * 13 + c * 4;
    cam.z = roof.z + c * 13 - s * 4;
    cam.y = roof.y + 4.2 + cam.boardLift;
    setVec(camera.position, cam.x, cam.y, cam.z);
    setVec(camera.target, cam.tx, cam.ty, cam.tz);
    camera.fov = FOV_BASE;
  };
  // Eye sits behind the heading at dist and elevation; a drag offsets it both ways, key 0 resets cam.offset/tilt.
  const orbitEye = (px, py, pz, fx, fz, dist, elevation) => {
    const yaw = Math.atan2(fx, fz) + Math.PI + cam.offset;
    const el = clamp(elevation + cam.tilt, -1.2, 1.5);
    EYE.x = px + Math.sin(yaw) * Math.cos(el) * dist;
    EYE.y = py + Math.sin(el) * dist;
    EYE.z = pz + Math.cos(yaw) * Math.cos(el) * dist;
    return EYE;
  };
  const updateCamera = (dt) => {
    const s = diver.state, p = s.p;
    let tx, ty, tz, fast = 0, eye = EYE;
    if (input.orbiting) cam.dragAt = sceneTime;
    if ((phase === "climb" || phase === "air") && sceneTime - cam.dragAt > CAM_RETURN_AFTER) {
      cam.offset = damp(cam.offset, 0, CAM_RETURN_RATE, dt);
      cam.tilt = damp(cam.tilt, 0, CAM_RETURN_RATE, dt);
    }
    if (phase === "climb") {
      const ps = planeState, pp = plane.node.position, h = Math.hypot(ps.vx, ps.vz);
      const fx0 = h > 0.5 ? ps.vx / h : roof.ax, fz0 = h > 0.5 ? ps.vz / h : roof.az;
      const near = markNear, ahead = CHASE.climbAhead + near * CHASE.markAhead;
      eye = orbitEye(pp.x, pp.y, pp.z, fx0, fz0, CHASE.climbDist + near * CHASE.markDist, CHASE.climbElevation + near * CHASE.markLift);
      tx = pp.x + fx0 * ahead;
      ty = pp.y + 0.6 - near * CHASE.markDrop;
      tz = pp.z + fz0 * ahead;
    } else if (phase === "air" && s.phase === "free") {
      const speed = Math.max(1, s.speed), hl = Math.hypot(s.up[0], s.up[2]);
      if (hl > 0.25) {
        HEAD.x = damp(HEAD.x, s.up[0] / hl, 6, dt);
        HEAD.z = damp(HEAD.z, s.up[2] / hl, 6, dt);
      }
      eye = orbitEye(p.x, p.y, p.z, HEAD.x, HEAD.z, CHASE.freeDist, CHASE.freeElevation);
      tx = p.x + s.v.x / speed * CHASE.freeAhead;
      ty = p.y + s.v.y / speed * CHASE.freeAhead;
      tz = p.z + s.v.z / speed * CHASE.freeAhead;
      fast = clamp((speed - 18) / 27, 0, 1);
    } else if (phase === "air" || phase === "lost") {
      const hx = Math.sin(s.heading), hz = Math.cos(s.heading);
      eye = orbitEye(p.x, p.y, p.z, hx, hz, CHASE.canopyDist, CHASE.canopyElevation);
      tx = p.x + hx * CHASE.canopyAhead;
      ty = p.y - 0.6;
      tz = p.z + hz * CHASE.canopyAhead;
    } else if (phase === "down") {
      // Low and off to the side of where he came down, looking at him.
      const hx = Math.sin(s.heading), hz = Math.cos(s.heading);
      EYE.x = p.x + hz * 5.5 + hx * 1.5;
      EYE.y = p.y + 0.9;
      EYE.z = p.z - hx * 5.5 + hz * 1.5;
      tx = p.x;
      ty = p.y + 0.2;
      tz = p.z;
    } else {
      EYE.x = cam.x;
      EYE.y = cam.y;
      EYE.z = cam.z;
      tx = p.x;
      ty = p.y;
      tz = p.z;
    }
    let ex = eye.x, ey = eye.y, ez = eye.z;
    if (island.onLand(ex, ez)) ey = Math.max(ey, island.surfaceAt(ex, ez) + 0.9);
    if (!cam.warm) {
      cam.x = ex;
      cam.y = ey;
      cam.z = ez;
      cam.tx = tx;
      cam.ty = ty;
      cam.tz = tz;
      cam.warm = true;
    } else {
      cam.x = damp(cam.x, ex, CHASE.eyeRate, dt);
      cam.y = damp(cam.y, ey, CHASE.eyeRate, dt);
      cam.z = damp(cam.z, ez, CHASE.eyeRate, dt);
      cam.tx = damp(cam.tx, tx, CHASE.targetRate, dt);
      cam.ty = damp(cam.ty, ty, CHASE.targetRate, dt);
      cam.tz = damp(cam.tz, tz, CHASE.targetRate, dt);
    }
    cam.shake = Math.max(0, cam.shake - dt * 3);
    const jolt = cam.shake * cam.shake * 0.35;
    setVec(camera.position, cam.x + Math.sin(sceneTime * 43) * jolt, cam.y + Math.sin(sceneTime * 37) * jolt, cam.z + Math.cos(sceneTime * 41) * jolt);
    setVec(camera.target, cam.tx, cam.ty, cam.tz);
    camera.fov = damp(camera.fov, lerp(FOV_BASE, FOV_FAST, fast), 5, dt);
  };
  const updateLighting = () => {
    const p = diver ? diver.state.p : plane.node.position;
    const low = !!diver && phase !== "board" && p.y < 60;
    setVec(RENDER_OPTS.shadowCenter, low ? p.x : 0, low ? Math.max(0, p.y - 4) : 0, low ? p.z : 0);
    RENDER_OPTS.time = sceneTime;
  };
  // quieted: the idle fade is scheduled once per idle stretch, and again after unlock builds the voices.
  let flaringWas = false, quieted = false;
  const updateAudio = (dt) => {
    if (phase === "board" || phase === "results") {
      if (!quieted) {
        audio.quiet();
        quieted = true;
      }
      return;
    }
    quieted = false;
    const a = audio.state, s = diver.state, pp = plane.node.position;
    a.planeSpeed = planeState.speed;
    a.planeDistance = Math.hypot(pp.x - camera.position.x, pp.y - camera.position.y, pp.z - camera.position.z);
    a.speed = s.speed;
    a.falling = phase === "air" && s.phase === "free" || phase === "lost" ? 1 : 0;
    a.canopy = (phase === "air" || phase === "lost") && (s.phase === "open" || s.phase === "canopy") ? 1 : 0;
    a.flaring = s.flaring ? 1 : 0;
    if (s.flaring && !flaringWas) audio.cues.flare();
    flaringWas = s.flaring;
    audio.update(dt);
  };
  const toggleMute = () => {
    audio.setMuted(!audio.muted);
    dhud.el.mute.setAttribute("aria-pressed", String(audio.muted));
    hud.toast(audio.muted ? "Sound off" : "Sound on");
  };
  const onGesture = () => {
    audio.unlock();
    quieted = false;
  };
  const updateMeter = () => {
    hud.setMeter(world.level, METER_CAPACITY, phase === "air" ? `${ringsHit} of ${RING_COUNT} rings` : "stable");
  };
  const update = (dt, elapsed) => {
    sceneTime = elapsed;
    if (life) { life.gulls.update(elapsed); life.boats.update(elapsed); }
    const hour = clock.read();
    daylight.sample(hour, RENDER_OPTS, clock.dayOfYear, islandLatitude, clock.continuousDay);
    agent.update(dt);
    const a = readInput();
    if (phase === "climb") {
      // Holding Space hurries the plane, up and round again, until the count starts.
      const s = planeState;
      flyPlane(dt * (a.up > 0 && callStage === 0 ? SKIP_SCALE : 1));
      seatDiver();
      const toMark = wrap(jumpAngle - s.angle);
      // Radians left to the next mark: the first lap is still climbing to it, after that it is a lap round.
      const left = s.t < jumpT ? (jumpT - s.t) * HELIX_W : (toMark + Math.PI * 2) % (Math.PI * 2);
      markNear = damp(markNear, left < JUMP_GET_READY ? 1 : 0, 1.5, dt);
      const atMark = s.alt >= JUMP_ALT - 1 && Math.abs(toMark) < JUMP_WINDOW;
      if (atMark && !jumpOpen) jumpOpenUntil = sceneTime + JUMP_GRACE;
      const open = atMark || sceneTime < jumpOpenUntil;
      // 3, 2, 1 in the last seconds before the mark, then JUMP.
      if (!open && left > JUMP_WINDOW) {
        const secs = left / HELIX_W, n = secs <= 1 ? 1 : secs <= 2 ? 2 : secs <= COUNT_SECONDS ? 3 : 0;
        if (n && n !== callStage) {
          if (callStage === 0) {
            dhud.notice("", 1);
            fx.say(diver.cave, "Ooga ready!", 1.4);
          }
          callStage = n;
          dhud.center(String(n), 0);
          audio.cues.count();
        }
      }
      if (open && !jumpOpen) {
        dhud.center("JUMP", 0);
        dhud.notice(COARSE ? "Jump!" : "Space · jump", 0);
        audio.cues.mark();
        fx.say(diver.cave, "Now! Ooga now!", 1.4);
      } else if (!open && jumpOpen) {
        callStage = 0;
        dhud.center("", 0);
        dhud.notice(COARSE ? "Round again · hold Jump! to hurry" : "Round again · hold Space to hurry", 3000);
      }
      jumpOpen = open;
      // A Space still held from hurrying the climb counts as the jump press.
      if (jumpOpen && a.up > 0) jump();
    } else if (phase === "air") {
      simulate(dt);
      const s = diver.state;
      if (!pulled && s.phase === "free" && s.p.y < PULL_ALT) {
        pulled = true;
        dhud.center("PULL", 0);
        dhud.notice(COARSE ? "tap Pull!" : "Space · chute", 0);
      }
      if (s.phase === "canopy") dhud.setChute(s.flaring ? "flare" : "canopy");
    } else if (phase === "down" || phase === "lost") {
      if (phase === "lost") {
        accumulator = Math.min(accumulator + dt, FIXED * MAX_SUBSTEPS);
        while (accumulator >= FIXED) {
          accumulator -= FIXED;
          diver.substep(FIXED, NO_INPUT);
          flightTime += FIXED;
        }
      }
      if (sceneTime - landedAt > (phase === "lost" ? LOST_T : LANDED_T)) {
        const p = diver.state.p;
        finish(phase === "lost" ? "lost" : diver.state.landing, Math.hypot(p.x - landingSpot.x, p.z - landingSpot.z));
      }
    }
    if (phase === "board") plane.prop.rotation.z += dt * 3;
    if (phase !== "climb" && phase !== "board" && planeState.t > 0) flyPlane(dt);
    if (diver) diver.pose(dt, elapsed, ctrl);
    // The next ring pulses, the two ahead are lit and the rest wait dim, and a marker on the next ring's
    // plane shows where the fall is going: what the stick does, seen before the ring says so.
    if (phase === "air" && diver.state.phase === "free" && ringIndex < RING_COUNT) {
      const s = diver.state, ring = rings[ringIndex];
      if (!ring.hit) {
        const k = ring.r * (1 + NEXT_RING_PULSE * (0.5 + 0.5 * Math.sin(sceneTime * 5)));
        setVec(ring.node.scale, k, k, k);
      }
      for (let i = 0; i < RING_COUNT; i++) if (!rings[i].hit) rings[i].node.glow = i <= ringIndex + 1 ? 1 : 0.45;
      if (s.v.y < -0.5) {
        const t = (s.p.y - ring.y) / -s.v.y;
        setVec(marker.position, s.p.x + s.v.x * t, ring.y + 0.05, s.p.z + s.v.z * t);
        marker.visible = true;
      } else marker.visible = false;
    } else marker.visible = false;
    if (diver) updateStreaks();
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i], p = c.node.position;
      p.x += c.speed * dt;
      if (p.x > c.wrap) p.x -= c.wrap * 2;
    }
    if (phase === "board") boardView();
    else updateCamera(dt);
    updateLighting();
    updateAudio(dt);
    fx.update(dt);
    stepTweens(dt);
    if (phase === "air" || phase === "down" || phase === "lost") {
      const s = diver.state;
      const ground = groundAt(s.p.x, s.p.z);
      dhud.setAlt(s.p.y - diver.FOOT - (ground === -Infinity ? 0 : Math.max(0, ground)));
      dhud.setSpeed(Math.max(0, -s.v.y));
      dhud.setRings(ringsHit, RING_COUNT);
      dhud.setTime(flightTime * 1000);
    } else if (phase === "climb") {
      dhud.setAlt(planeState.alt);
      dhud.setSpeed(0);
    }
    meterTimer -= dt;
    if (meterTimer <= 0) {
      meterTimer = 0.25;
      updateMeter();
    }
  };
  const NO_EXTRA = () => { };
  const overlay = (dt) => fx.drawOverlay(dt, NO_EXTRA);

  const onDonation = (donation) => {
    game.recordDonation(donation);
    const bananas = gameMod.bananasFor(donation.sats);
    world.level = Math.min(pileMod.MAX_BANANAS, world.level + bananas);
    const who = donation.handle ? `@${donation.handle}` : "anon";
    const loot = lootEnabled ? game.lootFor(donation) : null;
    hud.toast(`+${gameMod.formatLarge(donation.sats)} sats · ${bananas} banana${bananas > 1 ? "s" : ""} · ${who}${loot ? ` · ${loot.tier} ${loot.item.name}` : ""}`);
    fx.showTicker(`THANKS ${donation.handle ? "@" + donation.handle.toUpperCase() : "ANON"} · ${bananas} BANANAS`, 4.5);
    if (diver && diver.body.visible) {
      const p = diver.state.p;
      fx.burst(p.x, p.y + 1.2, p.z, 20, CONFETTI, 2.2);
    }
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
  const onKey = (e) => {
    if (e.key === "Escape") {
      if (phase === "board") go(home);
      else toBoard();
    }
    if (e.key === "Enter" && (phase === "board" || phase === "results")) startFlight();
    if (e.key === "0") cam.offset = cam.tilt = 0;
    if (e.key === "m" || e.key === "M") toggleMute();
    if (e.key === "b" || e.key === "B") {
      world.level = Math.min(pileMod.MAX_BANANAS, world.level + testBananas);
      hud.toast(`+${testBananas} test bananas`);
    }
    if (e.key === "l" || e.key === "L") demoTip(120000);
  };
  const tooltipFor = (hit) => hit.owner.kind === "diver" ? diver.cave.traits.display : "";
  const pickDiver = (name) => {
    selection.racer = name;
    buildDiver();
    toBoard();
  };
  // Rebuilt per pick; the diver's heads live off the graph, so liveGeometry must keep reporting them.
  const buildDiver = () => {
    if (diver) {
      for (const key of ["torso", "head"]) input.remove(diver.cave.parts[key]);
      diver.dispose();
    }
    diver = null;
    if (!selection.racer) return;
    diver = skydiver.create({ root, traits: contributors.traitsFor(selection.racer) });
    for (const key of ["torso", "head"]) input.add(diver.cave.parts[key], { kind: "diver", priority: 1 });
  };

  const enter = (ctx) => {
    ({ renderer, game, world, go, lootEnabled, testBananas } = ctx);
    home = ctx.from === "arcade" ? "arcade" : "hub";
    camera = createCamera({ fov: 50, near: 0.4, far: 820 });
    root = createNode();
    clock = daylight.createClock({ hour: hourParam, daylen: daylenParam, day: dayParam, time: timeParam, now: new Date() });
    island = terrain.island({ seed: SEED });
    hud = hudMod.create({ roster: contributors.activeRoster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled });
    hooks = {};
    input = interactMod.create({ canvas: ctx.canvas, renderer, camera, hooks });
    fx = fxMod.create({ root, renderer, camera, hud, overlay: ctx.overlay, tickerAt: TICKER_AT });
    const place = (node) => {
      addChild(root, node);
      placed.push(node);
      return node;
    };
    place(createNode({ geometry: island.geometry }));
    const level = Math.floor(world.level), footprint = pileMod.footprintFor(level, 0.45);
    const growth = level <= pileMod.DISK_BANANAS ? pileMod.PACKING_HEIGHT * level / pileMod.DISK_BANANAS : pileMod.footprintFor(level, 1) * pileMod.PACKING_HEIGHT;
    const core = place(createNode({ position: { x: 0, y: 0.36, z: 0 }, scale: { x: footprint, y: 0.48 * growth, z: footprint }, geometry: models.bananaPileCoreGeometry(0.45 * 6, 0.48 * 6, 0.45), visible: level > 0 }));
    const slab = place(createNode({ geometry: hubModels.altarSlab(), depthBias: 0.15 }));
    setVec(slab.scale, footprint + 0.3, 0.34, footprint + 0.3);
    // Small piles still count a landing on the dais as a banana landing.
    mound = { node: core, radius: Math.max(2.4, footprint + 0.2), height: 0.48 * growth * 0.88, y: 0.36, scaleY: core.scale.y };
    const rand = mulberry32(SEED + 77);
    for (let i = 0; i < CLOUD_HIGH + CLOUD_LOW; i++) {
      const low = i >= CLOUD_HIGH;
      const wrapAt = low ? 160 : 150;
      const y = low ? -52 - rand() * 26 : 24 + rand() * 270;
      const s = low ? 3 + rand() * 2 : 1.1 + rand() * 1.2;
      const node = createNode({ position: { x: lerp(-wrapAt, wrapAt, rand()), y, z: low ? lerp(-140, 140, rand()) : (rand() < 0.5 ? -1 : 1) * lerp(38, 140, rand()) }, scale: { x: s, y: s, z: s }, geometry: hubModels.cloud(i % 3), matrixCloud: true });
      place(node);
      clouds.push({ node, speed: 0.3 + rand() * 0.5, wrap: wrapAt });
    }
    // The roof spot comes from the hub's own cave mouth c9; the plane parks on it, the windsock beside it, and
    // the palms keep clear of it.
    const mouth = island.mouths.find((m) => m.id === "c9");
    // The world the jump falls into: islands on the sea, sails and gulls. Nothing here is solid or sighted.
    if (renderer.kind !== "canvas2d") {
      [[25, 260], [95, 330], [160, 240], [215, 300], [290, 280], [340, 360]].forEach(([deg, r], i) => {
        place(createNode({ geometry: BL.dressing.islet(i % 3), position: { x: Math.sin(deg * Math.PI / 180) * r, y: RENDER_OPTS.sea - 2, z: -Math.cos(deg * Math.PI / 180) * r }, rotation: { x: 0, y: deg * 0.7, z: 0 } }));
      });
      life = { gulls: BL.dressing.flock({ count: 26, radius: [40, 160], height: [20, 200], seed: 11, scale: 2.4 }), boats: BL.dressing.fleet({ sea: RENDER_OPTS.sea, spots: [[140, 0.4, 9], [160, 2.2, 11], [125, 3.9, 10], [150, 5.1, 8], [170, 1.3, 12]] }) };
      place(life.gulls.node);
      for (const node of life.boats.nodes) place(node);
      // Palms on the island below, on level ground clear of the paths, the same three swaying shapes as the hub.
      const prand = mulberry32(SEED + 91);
      for (let n = 0, tries = 0; n < 40 && tries < 600; tries++) {
        const a = prand() * Math.PI * 2, r = 8 + prand() * 22, x = Math.sin(a) * r, z = -Math.cos(a) * r, y = island.surfaceAt(x, z);
        if (!island.onLand(x, z) || island.isPath(x, z) || Math.hypot(x, z) < 6 || Math.hypot(x - mouth.x, z - mouth.z) < 11) continue;
        let level = true;
        for (let i = 0; i < 4 && level; i++) level = Math.abs(island.surfaceAt(x + Math.cos(i * 1.571) * 0.6, z + Math.sin(i * 1.571) * 0.6) - y) < 0.26;
        if (!level) continue;
        place(createNode({ geometry: BL.dressing.palm(n % 3), position: { x, y, z }, rotation: { x: 0, y: prand() * 6.283, z: 0 } }));
        n++;
      }
    }
    dropModels.roofSpot(island, mouth, roof);
    plane = dropModels.plane();
    plane.node.quaternion = quat.create();
    place(plane.node);
    place(createNode({ position: { x: roof.x + Math.cos(roof.ry) * 3.2 + roof.ax * 0.6, y: roof.y, z: roof.z - Math.sin(roof.ry) * 3.2 + roof.az * 0.6 }, geometry: dropModels.windsock() }));
    const signX = mouth.x + roof.ax * dropModels.SIGN_AT.z + Math.cos(roof.ry) * dropModels.SIGN_AT.x, signZ = mouth.z + roof.az * dropModels.SIGN_AT.z - Math.sin(roof.ry) * dropModels.SIGN_AT.x;
    place(createNode({ position: { x: signX, y: island.surfaceAt(signX, signZ), z: signZ }, rotation: { x: 0, y: roof.ry, z: 0 }, geometry: dropModels.roofSign() }));
    for (let i = 0; i < RING_COUNT; i++) {
      const node = place(createNode({ geometry: dropModels.hoop() }));
      rings.push({ node, x: 0, y: 0, z: 0, r: 1, hit: false });
    }
    const targetNode = place(createNode({ geometry: dropModels.target() }));
    marker = place(createNode({ geometry: dropModels.hoop(), scale: { x: MARKER_SCALE, y: MARKER_SCALE, z: MARKER_SCALE }, glow: 1.8, visible: false }));
    hole = place(createNode({ geometry: dropModels.hole(), visible: false }));
    streaks = { node: place(createNode({ geometry: dropModels.streak(), instanceData: new Float32Array(STREAKS * 20), instanceCount: 0, instanceVersion: 0, fixedInstanceCapacity: true, visible: false })), x: new Float32Array(STREAKS), y: new Float32Array(STREAKS), z: new Float32Array(STREAKS) };
    mark("drop world");
    // world.pilot: the Ooga an arcade cabinet sent in flies the plane, and is consumed on the way in.
    if (world.pilot) {
      if (contributors.activeRoster.some((c) => c.name === world.pilot)) selection.racer = world.pilot;
      world.pilot = null;
    }
    buildDiver();
    if (diver) layCourse(game.state.drop.jumps);
    else {
      for (const ring of rings) ring.node.visible = false;
      targetNode.visible = false;
    }
    // The Agent waits beside the landing target.
    const agentX = landingSpot.x + Math.cos(jumpAngle) * 4.5, agentZ = landingSpot.z + Math.sin(jumpAngle) * 4.5;
    agent = dropScene.agent = BL.agent.create({ groundAt, form: "code", x: agentX, z: agentZ, heading: Math.atan2(-agentX, -agentZ) });
    agent.pace(agentX, agentZ, 1.5);
    place(agent.root);
    setVec(targetNode.position, landingSpot.x, landingSpot.y + 0.02, landingSpot.z);
    dhud = dropHud.create({ roster: contributors.activeRoster, best: () => game.state.drop.best, onPick: pickDiver });
    dhud.selection.racer = selection.racer;
    dhud.buildBoard((name) => contributors.stateFor(contributors.activeRoster.find((c) => c.name === name)));
    controls = controlsMod.create({ move: document.getElementById("joy-move"), look: document.getElementById("joy-look"), boost: hud.el.act, chord: ctx.canvas, onAction: act });
    dropScene.agentControls = controls;
    audio = dropAudio.create();
    // Cleared per visit: a flare held at leave would suppress the next cue.
    flaringWas = quieted = false;
    dhud.el.mute.setAttribute("aria-pressed", String(audio.muted));
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
        if (hit) hud.tooltip.show(tooltipFor(hit), p.x, p.y, hit.owner.kind === "diver" ? diver.cave : null);
        else hud.tooltip.hide();
      },
      onHoverMove: (hit, p) => hud.tooltip.show(tooltipFor(hit), p.x, p.y, hit.owner.kind === "diver" ? diver.cave : null),
      onTap: (hit) => {
        if (hit && hit.owner.kind === "diver" && phase !== "board") fx.say(diver.cave, phase === "air" ? "Ooga busy falling!" : "Ooga!", 1.2);
      },
      onOrbit: (dx, dy) => {
        if (phase === "board") {
          cam.boardYaw = wrap(cam.boardYaw - dx * 5e-3);
          cam.boardLift = clamp(cam.boardLift + dy * 0.02, -2, 6);
        } else {
          cam.offset = wrap(cam.offset - dx * 4e-3);
          cam.tilt = clamp(cam.tilt + dy * 3.5e-3, -1.4, 1.4);
          cam.dragAt = sceneTime;
        }
      },
      onZoom: () => { }
    });
    hud.onAction((action) => {
      if (action === "drop-start" || action === "drop-again") startFlight();
      else if (action === "drop-board") toBoard();
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
    for (const c of contributors.activeRoster) hud.setRosterRow(c.name, contributors.stateFor(c), contributors.ageLabel(c));
    if (lootEnabled) renderLocker();
    hud.setStats(game.state);
    hud.el.sheet.dataset.open = "false";
    dhud.el.help.textContent = COARSE ? "Left stick pitches and rolls · right stick turns · the button jumps, pulls and flares" : "W S pitch · A D roll · Q E turn · Space jumps, pulls the chute · S flares · drag to look";
    meterTimer = 0;
    toBoard();
    stateTimer = window.setInterval(() => {
      for (const c of contributors.activeRoster) hud.setRosterRow(c.name, contributors.stateFor(c), contributors.ageLabel(c));
      fx.trimPool();
    }, 6e4);
    hintTimer = window.setTimeout(() => hud.hint(COARSE ? "Pick an Ooga, then Fly!" : "Pick an Ooga, then Fly! (Enter)"), 1200);
    Object.assign(dropScene, {
      root, camera, input,
      debug: {
        hud, demoTip, trimPool: fx.trimPool, camera, controls, island, cavemen: null, crates: null, agent: agent.debug,
        get audio() {
          return audio;
        },
        get diver() {
          return diver;
        },
        get plane() {
          return { node: plane.node, prop: plane.prop, state: planeState };
        },
        get course() {
          return { rings, target: landingSpot, jumpAngle };
        },
        get renderOpts() {
          return RENDER_OPTS;
        },
        drop: {
          get phase() {
            return phase;
          },
          get score() {
            return score;
          },
          get ringsHit() {
            return ringsHit;
          },
          get result() {
            return result;
          },
          get jumpOpen() {
            return jumpOpen;
          },
          get cam() {
            return cam;
          },
          get sceneTime() {
            return sceneTime;
          },
          get streaks() {
            return streaks.node.instanceCount;
          },
          selection, start: startFlight, toBoard, jump, deploy, finish,
          // Runs the clock forward without frames: the climb, then substeps in the air.
          simulate: (seconds) => {
            if (!diver) return;
            for (let t = 0; t < seconds; t += FIXED) {
              sceneTime += FIXED;
              if (phase === "climb") {
                flyPlane(FIXED);
                seatDiver();
                const s = planeState;
                jumpOpen = s.alt >= JUMP_ALT - 1 && Math.abs(wrap(s.angle - jumpAngle)) < JUMP_WINDOW;
              } else if (phase === "air") {
                accumulator = FIXED;
                simulate(0);
              } else if (phase === "down" || phase === "lost") {
                if (phase === "lost") diver.substep(FIXED, NO_INPUT);
                if (sceneTime - landedAt > (phase === "lost" ? LOST_T : LANDED_T)) finish(phase === "lost" ? "lost" : diver.state.landing, Math.hypot(diver.state.p.x - landingSpot.x, diver.state.p.z - landingSpot.z));
              }
            }
          },
          setInput: (pitch, roll, yaw, flare) => {
            ctrl.pitch = pitch;
            ctrl.roll = roll;
            ctrl.yaw = yaw;
            ctrl.flare = !!flare;
          },
          jumpNow: () => {
            if (!diver) return false;
            if (phase !== "climb") startFlight();
            planeState.t = ROLL_T + CLIMB_T;
            flyPlane(0.001);
            seatDiver();
            jumpOpen = true;
            return jump();
          }
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
    if (diver) {
      for (const key of ["torso", "head"]) input.remove(diver.cave.parts[key]);
      diver.dispose();
    }
    fx.dispose();
    controls.dispose();
    hud.el.act.hidden = true;
    hud.setAct("Ooga!");
    for (const node of placed) removeChild(root, node);
    placed.length = clouds.length = rings.length = 0;
    life = null;
    agent.dispose();
    const count = input.targetCount;
    input.dispose();
    dhud.dispose();
    hud.dispose();
    phase = "board";
    diver = plane = streaks = mound = hole = marker = agent = hud = dhud = hooks = input = fx = controls = audio = clock = island = null;
    dropScene.input = dropScene.debug = dropScene.agent = dropScene.agentControls = null;
    return { targets: count };
  };
  const liveGeometry = (set) => {
    agent.liveGeometry(set);
    if (diver) set.add(diver.cave.headOpen).add(diver.cave.headClosed);
  };
  const stats = () => {
    let nodes = 0;
    traverseVisible(root, () => nodes++);
    const all = (n) => 1 + n.children.reduce((sum, c) => sum + all(c), 0);
    return { visibleNodes: nodes, allNodes: all(root), tweens: tweenCount(), targets: input.targetCount, ...fx.stats(), phase, rings: ringsHit, streaks: streaks.node.instanceCount };
  };
  Object.assign(dropScene, { enter, update, overlay, onDonation, onKey, onLootCleared, leave, stats, liveGeometry });
  BL.scenes = BL.scenes || {};
  BL.scenes.drop = dropScene;
})();
