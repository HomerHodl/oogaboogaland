// One contributor body turning freely on a quaternion, air pushing on it like a flat plate, then a canopy.
//
// `place`, `jump`, `deploy`, `land`: under the canopy every touchdown stands; without one the impact picks
// `hole`, `tumble` or `pancake` from the spine angle and the ground speed. The fixed-step flat-plate model
// has gravity, plate pressure along the belly normal, skin drag, player rates and a weathervane the stick
// cannot outmuscle. The canopy flight has bloom, sink, forward, toggles and a flare reserve; it trims at
// `FORWARD` 8 and `SINK` 6, `DIVE_SINK` 10.5. `pose` goes by phase.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, dropModels } = BL;
  const { lerp, damp, quat } = BL.math;
  const { createNode, addChild, removeChild } = BL.scene;
  // Terminal speeds belly-to-wind 24 and head-down 45; K_SKIN and K_PLATE are derived from them and G.
  const G = 9.8, TERMINAL_FLAT = 24, TERMINAL_DIVE = 45;
  const K_SKIN = G / (TERMINAL_DIVE * TERMINAL_DIVE);
  const K_PLATE = G / (TERMINAL_FLAT * TERMINAL_FLAT) - K_SKIN;
  // Arms and legs steer harder than a bare plate: TRACK scales the plate force's horizontal part, not vertical.
  const TRACK = 3.4;
  // The weathervane outmuscles the stick: a held input settles near 65 degrees, a released one comes back flat.
  const RATE = { pitch: 3, roll: 3, yaw: 2.2 }, RESPONSE = 6, WEATHERVANE = 3.3;
  // Canopy constants in order: bloom, trimmed/dived/flared speeds, flare reserve, turn and crab.
  const OPEN_T = 0.7, FORWARD = 8, DIVE_FORWARD = 12.5, FLARE_FORWARD = 3, SINK = 6, DIVE_SINK = 10.5, FLARE_SINK = 2.2, FLARE_MAX = 2, TURN = 1.3, CRAB = 3;
  // How far the body's centre sits above the feet, in body heights.
  const FOOT = 0.55;
  const LANDING = { tumbleSpeed: 6, spine: 0.6 };
  const setVec = (v, x, y, z) => {
    v.x = x;
    v.y = y;
    v.z = z;
    return v;
  };
  const create = ({ root, traits }) => {
    const cave = models.caveman(traits);
    const h = traits.height, legY = cave.root.position.y;
    const body = createNode({ quaternion: quat.create() });
    // The body's origin is the belly, so the diver turns about its middle.
    cave.root.position.y = legY - FOOT * h;
    const pack = createNode({ position: { x: 0, y: 0.06 * h, z: -0.18 * h }, scale: { x: h, y: h, z: h }, geometry: dropModels.pack() });
    const canopy = createNode({ position: { x: 0, y: 0.45 * h, z: 0 }, scale: { x: 0.01, y: 0.01, z: 0.01 }, geometry: dropModels.canopy(), visible: false });
    addChild(cave.root, pack);
    addChild(body, cave.root, canopy);
    addChild(root, body);
    body.visible = false;
    const s = {
      phase: "idle", p: body.position, pp: { x: 0, y: 0, z: 0 }, v: { x: 0, y: 0, z: 0 }, q: body.quaternion, w: { x: 0, y: 0, z: 0 },
      speed: 0, heading: 0, open: 0, flare: FLARE_MAX, flaring: false, steer: 0, landing: null, landT: 0, tumble: 0, slideX: 0, slideZ: 0,
      up: new Float32Array(3), front: new Float32Array(3), right: new Float32Array(3)
    };
    const target = quat.create();
    const axes = () => {
      quat.rotateVec(s.right, s.q, 1, 0, 0);
      quat.rotateVec(s.up, s.q, 0, 1, 0);
      quat.rotateVec(s.front, s.q, 0, 0, 1);
    };
    const place = (x, y, z, heading) => {
      setVec(s.p, x, y, z);
      setVec(s.pp, x, y, z);
      setVec(s.v, 0, 0, 0);
      setVec(s.w, 0, 0, 0);
      s.heading = heading;
      quat.fromEuler(s.q, 0, heading, 0);
      s.phase = "idle";
      s.open = 0;
      s.flare = FLARE_MAX;
      s.landing = null;
      s.landT = 0;
      s.tumble = 0;
      canopy.visible = false;
      setVec(canopy.scale, 0.01, 0.01, 0.01);
      canopy.position.z = 0;
      s.slideX = s.slideZ = 0;
      body.visible = true;
      resetLimbs();
    };
    // Leave the plane belly down with its speed, the head along the flight.
    const jump = (vx, vy, vz, heading) => {
      setVec(s.v, vx, vy - 1.5, vz);
      setVec(s.w, 0, 0, 0);
      s.heading = heading;
      quat.fromEuler(s.q, Math.PI / 2, heading, 0);
      s.phase = "free";
    };
    const deploy = () => {
      if (s.phase !== "free") return false;
      s.phase = "open";
      s.open = 0;
      s.heading = Math.atan2(s.v.x, s.v.z);
      if (Math.hypot(s.v.x, s.v.z) < 1) {
        axes();
        s.heading = Math.atan2(s.up[0], s.up[2]);
      }
      canopy.visible = true;
      return true;
    };
    // Input: pitch, roll and yaw in -1..1, flare held.
    const freefall = (dt, input) => {
      const v = s.v, w = s.w;
      axes();
      const speed = Math.hypot(v.x, v.y, v.z), F = s.front, R = s.right, U = s.up;
      s.speed = speed;
      // Gravity, plate pressure along the belly normal (s.front), skin drag along the flow.
      const vn = v.x * F[0] + v.y * F[1] + v.z * F[2];
      const plate = -K_PLATE * vn * speed, skin = -K_SKIN * speed;
      v.x += (plate * F[0] * TRACK + skin * v.x) * dt;
      v.y += (-G + plate * F[1] + skin * v.y) * dt;
      v.z += (plate * F[2] * TRACK + skin * v.z) * dt;
      // The player's rates on the body axes, plus the wind turning the belly to face it.
      // Roll right dips the right side, yaw left turns the head left, seen from behind the head.
      const pr = input.pitch * RATE.pitch, rr = input.roll * RATE.roll, yr = -input.yaw * RATE.yaw;
      let tx = R[0] * pr + U[0] * rr + F[0] * yr, ty = R[1] * pr + U[1] * rr + F[1] * yr, tz = R[2] * pr + U[2] * rr + F[2] * yr;
      if (speed > 1) {
        const k = WEATHERVANE * Math.min(1, speed / TERMINAL_FLAT);
        const wx = v.x / speed, wy = v.y / speed, wz = v.z / speed;
        tx += (F[1] * wz - F[2] * wy) * k;
        ty += (F[2] * wx - F[0] * wz) * k;
        tz += (F[0] * wy - F[1] * wx) * k;
      }
      w.x = damp(w.x, tx, RESPONSE, dt);
      w.y = damp(w.y, ty, RESPONSE, dt);
      w.z = damp(w.z, tz, RESPONSE, dt);
      quat.integrate(s.q, s.q, w.x, w.y, w.z, dt);
    };
    // Under the canopy the body hangs upright on the same stick: pitch dives or flares, roll banks, yaw turns.
    const canopyFlight = (dt, input) => {
      const v = s.v;
      if (s.phase === "open") {
        s.open += dt;
        const k = Math.min(1, s.open / OPEN_T);
        const bloom = 0.01 + 0.99 * (1 - (1 - k) * (1 - k));
        setVec(canopy.scale, bloom, bloom, bloom);
        if (k >= 1) s.phase = "canopy";
      }
      s.steer = input.roll;
      // Roll is positive to the right, yaw positive to the left: both turn the way they lean.
      s.heading -= (s.steer - input.yaw) * TURN * dt;
      const wantFlare = Math.max(input.flare ? 1 : 0, -input.pitch);
      const flare = s.flare > 0 ? wantFlare : 0;
      s.flaring = flare > 0.05;
      if (s.flaring) s.flare = Math.max(0, s.flare - dt * flare);
      else s.flare = Math.min(FLARE_MAX, s.flare + dt * 0.5);
      const dive = Math.max(0, input.pitch);
      const forward = lerp(lerp(FORWARD, DIVE_FORWARD, dive), FLARE_FORWARD, flare), sink = lerp(lerp(SINK, DIVE_SINK, dive), FLARE_SINK, flare);
      const rate = s.phase === "open" ? 2.5 : 3;
      const hx = Math.sin(s.heading), hz = Math.cos(s.heading);
      v.x = damp(v.x, hx * forward - hz * s.steer * CRAB, rate, dt);
      v.z = damp(v.z, hz * forward + hx * s.steer * CRAB, rate, dt);
      v.y = damp(v.y, -sink, s.phase === "open" ? 4 : 3, dt);
      s.speed = Math.hypot(v.x, v.y, v.z);
      quat.fromEuler(target, 0.12, s.heading, s.steer * 0.35);
      quat.slerpTo(s.q, target, 1 - Math.exp(-4 * dt));
    };
    const substep = (dt, input) => {
      const p = s.p;
      s.pp.x = p.x;
      s.pp.y = p.y;
      s.pp.z = p.z;
      if (s.phase === "free") freefall(dt, input);
      else if (s.phase === "open" || s.phase === "canopy") canopyFlight(dt, input);
      else return;
      p.x += s.v.x * dt;
      p.y += s.v.y * dt;
      p.z += s.v.z * dt;
    };
    // Under the canopy every touchdown stands up; without one, spine first punches a hole, flat and fast tumbles,
    // flat and slow flattens.
    const land = (groundY) => {
      const chute = s.phase === "canopy" || s.phase === "open", h2 = Math.hypot(s.v.x, s.v.z);
      axes();
      if (chute) s.landing = "stand";
      else s.landing = Math.abs(s.up[1]) > LANDING.spine ? "hole" : h2 > LANDING.tumbleSpeed ? "tumble" : "pancake";
      s.phase = "down";
      s.landT = 0;
      if (h2 > 1) s.heading = Math.atan2(s.v.x, s.v.z);
      s.slideX = s.landing === "tumble" ? s.v.x * 0.5 : 0;
      s.slideZ = s.landing === "tumble" ? s.v.z * 0.5 : 0;
      const headFirst = s.up[1] < 0;
      s.p.y = groundY + FOOT * h;
      setVec(s.v, 0, 0, 0);
      setVec(s.w, 0, 0, 0);
      if (s.landing === "hole") {
        // Head first leaves the legs kicking out of the ground, feet first buries him to the belly.
        quat.fromEuler(s.q, 0, s.heading, headFirst ? Math.PI : 0);
        s.p.y = groundY + (headFirst ? -0.25 : 0.12) * h;
        canopy.visible = false;
      } else if (s.landing === "pancake") {
        quat.fromEuler(s.q, Math.PI / 2, s.heading, 0);
        s.p.y = groundY + 0.1 * h;
        canopy.visible = false;
      } else quat.fromEuler(s.q, 0, s.heading, 0);
      return s.landing;
    };
    const resetLimbs = () => {
      const parts = cave.parts;
      Object.assign(parts.armR.rotation, { x: -0.2, y: 0, z: -0.12 });
      Object.assign(parts.armL.rotation, { x: -0.2, y: 0, z: 0.12 });
      Object.assign(parts.legR.rotation, { x: 0, y: 0, z: 0 });
      Object.assign(parts.legL.rotation, { x: 0, y: 0, z: 0 });
      Object.assign(parts.head.rotation, { x: 0, y: 0, z: 0 });
      Object.assign(cave.root.rotation, { x: 0, y: 0, z: 0 });
      cave.root.position.y = legY - FOOT * h;
      parts.torso.scale.x = parts.torso.scale.z = cave.traits.belly;
      parts.torso.scale.y = 1;
      parts.snack.visible = false;
      parts.gun.visible = false;
    };
    // Limbs by phase; call once a frame, not per substep.
    const pose = (dt, elapsed, input) => {
      const parts = cave.parts;
      if (s.phase === "idle") {
        parts.legR.rotation.x = parts.legL.rotation.x = -1.45;
        parts.armR.rotation.x = parts.armL.rotation.x = -1.05;
        parts.armR.rotation.z = -0.25;
        parts.armL.rotation.z = 0.25;
        parts.head.rotation.x = 0;
        return;
      }
      if (s.phase === "free") {
        const flap = Math.sin(elapsed * 9) * 0.05;
        parts.armR.rotation.x = damp(parts.armR.rotation.x, -1.15 - input.pitch * 0.4 + input.roll * 0.3, 8, dt);
        parts.armL.rotation.x = damp(parts.armL.rotation.x, -1.15 - input.pitch * 0.4 - input.roll * 0.3, 8, dt);
        parts.armR.rotation.z = damp(parts.armR.rotation.z, -0.95 + flap, 8, dt);
        parts.armL.rotation.z = damp(parts.armL.rotation.z, 0.95 - flap, 8, dt);
        parts.legR.rotation.x = damp(parts.legR.rotation.x, -0.5 + input.pitch * 0.3, 8, dt);
        parts.legL.rotation.x = damp(parts.legL.rotation.x, -0.5 + input.pitch * 0.3, 8, dt);
        parts.legR.rotation.z = damp(parts.legR.rotation.z, -0.35, 8, dt);
        parts.legL.rotation.z = damp(parts.legL.rotation.z, 0.35, 8, dt);
        parts.head.rotation.x = damp(parts.head.rotation.x, -0.45, 8, dt);
        parts.head.rotation.y = damp(parts.head.rotation.y, -input.yaw * 0.3, 8, dt);
        return;
      }
      if (s.phase === "open" || s.phase === "canopy") {
        parts.armR.rotation.x = damp(parts.armR.rotation.x, -2.7 + (s.steer < 0 ? 0.5 : 0), 6, dt);
        parts.armL.rotation.x = damp(parts.armL.rotation.x, -2.7 + (s.steer > 0 ? 0.5 : 0), 6, dt);
        parts.armR.rotation.z = damp(parts.armR.rotation.z, -0.25, 6, dt);
        parts.armL.rotation.z = damp(parts.armL.rotation.z, 0.25, 6, dt);
        const swing = Math.sin(elapsed * 2.2) * 0.08;
        parts.legR.rotation.x = damp(parts.legR.rotation.x, 0.25 + swing, 6, dt);
        parts.legL.rotation.x = damp(parts.legL.rotation.x, 0.25 - swing, 6, dt);
        parts.legR.rotation.z = damp(parts.legR.rotation.z, -0.08, 6, dt);
        parts.legL.rotation.z = damp(parts.legL.rotation.z, 0.08, 6, dt);
        parts.head.rotation.x = damp(parts.head.rotation.x, s.flaring ? 0.3 : 0.15, 6, dt);
        parts.head.rotation.y = damp(parts.head.rotation.y, 0, 6, dt);
        return;
      }
      if (s.phase === "down") {
        s.landT += dt;
        const t = s.landT;
        if (s.landing === "hole") {
          const k = Math.min(1, t / 0.5);
          const kick = Math.sin(t * 9) * 0.5 * (1 - k);
          parts.legR.rotation.x = 0.3 + kick;
          parts.legL.rotation.x = 0.3 - kick;
          parts.armR.rotation.x = parts.armL.rotation.x = -2.4 + kick;
          return;
        }
        if (s.landing === "pancake") {
          const k = Math.min(1, t / 0.25);
          parts.torso.scale.y = 1 - 0.75 * k;
          parts.torso.scale.x = parts.torso.scale.z = 1 + 0.5 * k;
          parts.armR.rotation.z = -1.4;
          parts.armL.rotation.z = 1.4;
          parts.armR.rotation.x = parts.armL.rotation.x = -1.2;
          parts.legR.rotation.z = -0.5;
          parts.legL.rotation.z = 0.5;
          parts.head.rotation.x = -0.6;
          return;
        }
        if (s.landing === "tumble") {
          const decay = Math.exp(-3 * dt);
          s.p.x += s.slideX * dt;
          s.p.z += s.slideZ * dt;
          s.slideX *= decay;
          s.slideZ *= decay;
          s.tumble = Math.min(1, t / 0.9);
          cave.root.rotation.x = -Math.PI * 0.5 * Math.min(1, t / 0.6) * (1 + 0.6 * Math.sin(Math.min(1, t / 0.6) * Math.PI));
          cave.root.rotation.z = Math.sin(Math.min(1, t / 0.9) * Math.PI) * 0.6;
          cave.root.position.y = legY - FOOT * h - 0.2 * h * Math.min(1, t / 0.6);
          parts.armR.rotation.x = parts.armL.rotation.x = -2.4;
          parts.legR.rotation.x = parts.legL.rotation.x = 0.4;
          canopy.visible = false;
          return;
        }
        const deep = s.landing === "stumble" ? 0.32 : 0.14;
        const squat = Math.sin(Math.min(1, t / 0.7) * Math.PI) * deep;
        parts.torso.scale.y = 1 - squat;
        parts.legR.rotation.x = squat * 1.6;
        parts.legL.rotation.x = squat * 1.6;
        cave.root.rotation.x = s.landing === "stumble" ? Math.sin(Math.min(1, t / 0.9) * Math.PI) * 0.5 : 0;
        parts.armR.rotation.x = damp(parts.armR.rotation.x, -0.2 - squat * 2, 6, dt);
        parts.armL.rotation.x = damp(parts.armL.rotation.x, -0.2 - squat * 2, 6, dt);
        parts.armR.rotation.z = damp(parts.armR.rotation.z, -0.12, 6, dt);
        parts.armL.rotation.z = damp(parts.armL.rotation.z, 0.12, 6, dt);
        parts.head.rotation.x = damp(parts.head.rotation.x, 0, 6, dt);
        if (canopy.visible) {
          canopy.scale.y = Math.max(0.05, canopy.scale.y - dt * 1.4);
          canopy.position.z = damp(canopy.position.z, -1.4, 3, dt);
          if (canopy.scale.y <= 0.05) canopy.visible = false;
        }
      }
    };
    const hide = () => {
      body.visible = false;
      s.phase = "idle";
    };
    const dispose = () => {
      removeChild(root, body);
    };
    return {
      cave, body, canopy, state: s, FOOT: FOOT * h, place, jump, deploy, substep, land, pose, hide, dispose
    };
  };
  BL.skydiver = { create, G, TERMINAL_FLAT, TERMINAL_DIVE, OPEN_T, FORWARD, DIVE_FORWARD, SINK, DIVE_SINK, FLARE_SINK, LANDING };
})();
