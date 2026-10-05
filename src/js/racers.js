// Racers: contributors on foot, in a Rock Kart or on a Dino; one arcade controller and an AI driver.
//
// The active contributors race on a mount (`MOUNTS`) under a fixed-step arcade controller: throttle,
// steer, drift charge and tiered boost, hop, launches and landings, walls, falls, hazards and respawn,
// plus racer pushes, checkpoints, laps, ranks, the rubber band, the AI driver and mount animation.
// Each mount has one lever of its own (`charge` for the dino's drift, `boostMul` for the runner's
// boost, `recover` for its spin); the AI field is `AI_MOUNTS`, two karts and two dinos to a runner.
// `start(playerStart)` gives a throttle held from inside the last count `START_BOOST`, from earlier
// `START_SPIN` of wheelspin, and the sharper AI `AI_START_BOOST`. A racer inside a prop's circle (the
// track's `props`, its sector and the two beside it) is pushed out and knocked as by a wall.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, contributors, raceModels, raceTrack } = BL;
  const { clamp, lerp, damp, fnv1a, mulberry32 } = BL.math;
  const { createNode, addChild, removeChild } = BL.scene;
  const { SURF, SURFACE_GRIP, STEP, SHOULDER, CURB_W, FALL } = raceTrack;
  // Each mount has one lever of its own: the kart's top speed, the dino's quick drift charge, the runner's
  // big boost and quick recovery from a spin.
  const MOUNTS = [
    { id: "run", name: "On foot", top: 21, accel: 12.5, brake: 15, turn: 2.9, driftTurn: 1.55, mass: 0.8, hop: 5.6, offroad: 0.85, radius: 0.55, charge: 1, boostMul: 1.45, recover: 0.7, bars: [3, 4, 5] },
    { id: "kart", name: "Rock Kart", top: 24.5, accel: 8, brake: 16, turn: 1.95, driftTurn: 1.8, mass: 1.35, hop: 4.6, offroad: 0.55, radius: 0.8, charge: 1, boostMul: 1.32, recover: 1, bars: [5, 2, 3] },
    { id: "dino", name: "Dino", top: 22.5, accel: 11, brake: 15, turn: 2.3, driftTurn: 1.65, mass: 1.1, hop: 6.6, offroad: 0.72, radius: 0.7, charge: 1.3, boostMul: 1.32, recover: 0.85, bars: [4, 4, 4] }
  ];
  const mountById = (id) => MOUNTS.find((m) => m.id === id) || MOUNTS[1];
  // The AI field: two karts and two dinos to every runner, so the back of the pack is not all on foot.
  const AI_MOUNTS = [MOUNTS[1], MOUNTS[2], MOUNTS[1], MOUNTS[2], MOUNTS[0]];
  const BOOST_MUL = 1.32, BOOST_TIERS = [0, 0.55, 0.95, 1.5], DRIFT_ANGLE = 0.5;
  // The start: a throttle held from inside the last count boosts off the line, held from earlier it spins the wheels.
  const START_BOOST = 0.7, START_SPIN = 0.6, START_SPIN_TOP = 0.4, AI_START_BOOST = 0.55, AI_START_SKILL = 0.75;
  const GRAVITY = 24, HOP_V = 3.2, LAUNCH_MIN = 2.6, DROP = 0.12;
  const SPIN_TIME = 1.1, RESPAWN_TIME = 1.2, INVULN = 1.6, WRONG_WAY_AFTER = 0.9;
  const CHECK_WINDOW = 4;
  const RANK_EVERY = 0.2;
  const NAMES = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
  const P = { lateral: 0, along: 0, index: 0, next: 0 };
  // Effects only for racers near the camera (EFFECT_RANGE is a squared distance), from the shared particle pool.
  const EFFECT_RANGE = 48 * 48;
  const SPARKS = [[models.particleGeometry("#ffb13b", 0.05, 1)], [models.particleGeometry("#ffb13b", 0.05, 1), models.particleGeometry("#79d8ff", 0.055, 1)], [models.particleGeometry("#c99bff", 0.06, 1), models.particleGeometry("#79d8ff", 0.055, 1)]];
  const DUST = [models.particleGeometry("#a3874f", 0.07, 0)];
  const SNOW_DUST = [models.particleGeometry("#eef3f7", 0.06, 0.2)];
  const ASH = [models.particleGeometry("#3a3330", 0.065, 0)];
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const setVec = (v, x, y, z) => {
    v.x = x;
    v.y = y;
    v.z = z;
    return v;
  };
  const create = (ctx) => {
    const { root, input, fx } = ctx;
    let track = ctx.track;
    const racers = [];
    const order = [];
    let player = null, laps = 3, rankTimer = 0, elapsed = 0, raceTime = 0, running = false, autopilot = false;
    const events = { onLap: null, onFinish: null, onRespawn: null, onDrift: null, onLand: null, onWrongWay: null, onWall: null, onBump: null, onHop: null };
    contributors.activeRoster.forEach((contributor, i) => {
      const traits = contributors.traitsFor(contributor.name);
      const cave = models.caveman(traits);
      const node = createNode({ visible: false });
      const body = node;
      const flame = createNode({ geometry: raceModels.boostFlame(), visible: false });
      addChild(root, node);
      const seed = mulberry32(fnv1a(contributor.name + "/driver"));
      const racer = {
        index: i, name: contributor.name, traits, cave, node, body, flame, mount: null, ride: null, baseY: cave.root.position.y,
        x: 0, y: 0, z: 0, heading: 0, motionHeading: 0, speed: 0, vy: 0, airborne: false, ground: 0, centre: 0, groundV: 0, groundVPrev: 0,
        steer: 0, throttle: 0, driftIn: false, itemIn: false, driftHeld: false, wheelspin: 0,
        drift: { active: false, dir: 0, charge: 0, tier: 0 }, boost: 0, spin: 0, spinRot: 0, respawn: 0, invuln: 0, wrongWay: 0, wrong: false,
        idx: -1, lateral: 0, along: 0, progress: 0, lap: 1, checkpoint: 0, started: false, rank: i + 1, lapStart: 0, lapTime: 0, bestLap: 0, finishTime: 0, finished: false,
        surface: 0, offroad: false, wallHit: 0, item: null, bananas: 0, meterFull: false,
        ai: { offset: (seed() - 0.5) * 0.5, skill: 0.55 + seed() * 0.45, aggro: seed() * 0.9, wobble: seed() * 6.28, brakeK: 5 + seed() * 1.5, lastItem: 0 },
        anim: { phase: 0, lean: 0, pitch: 0, roll: 0, squash: 0, wheel: 0 },
        hide: i % raceModels.DINO_HIDES.length
      };
      racers.push(racer);
      order.push(racer);
      for (const key of ["torso", "head"]) input.add(cave.parts[key], { kind: "racer", racer, priority: 1 });
    });
    const seat = (racer) => {
      const cave = racer.cave, parts = cave.parts;
      for (const child of racer.body.children.slice()) removeChild(racer.body, child);
      if (racer.ride && racer.ride.node) racer.ride = null;
      const m = racer.mount;
      addChild(racer.body, racer.flame);
      if (m.id === "run") {
        racer.ride = null;
        setVec(cave.root.position, 0, racer.baseY, 0);
        setVec(racer.flame.position, 0, 0.35, -0.3);
        parts.legR.rotation.x = parts.legL.rotation.x = 0;
        parts.armR.rotation.x = parts.armL.rotation.x = -0.2;
        addChild(racer.body, cave.root);
        return;
      }
      const ride = m.id === "kart" ? raceModels.kart(racer.traits.fur) : raceModels.dino(racer.hide);
      racer.ride = ride;
      // The mount wrapper has an identity transform; keep its animated parts
      // directly under the racer rather than traversing another empty node.
      while (ride.node.children.length) {
        const child = ride.node.children[0];
        removeChild(ride.node, child);
        addChild(racer.body, child);
      }
      setVec(racer.flame.position, 0, m.id === "kart" ? 0.5 : 0.9, m.id === "kart" ? -1.05 : -0.95);
      setVec(cave.root.position, 0, ride.seatY + racer.baseY * (m.id === "kart" ? 0.45 : 0.7), ride.seatZ);
      parts.legR.rotation.x = parts.legL.rotation.x = m.id === "kart" ? -1.45 : -0.55;
      parts.legR.rotation.z = m.id === "dino" ? -0.95 : 0;
      parts.legL.rotation.z = m.id === "dino" ? 0.95 : 0;
      parts.armR.rotation.x = parts.armL.rotation.x = m.id === "kart" ? -1.05 : -1.25;
      parts.armR.rotation.z = -0.25;
      parts.armL.rotation.z = 0.25;
      addChild(racer.body, cave.root);
    };
    const setup = ({ track: nextTrack, playerName, playerMount, lapCount }) => {
      track = nextTrack;
      laps = lapCount;
      running = false;
      raceTime = 0;
      player = null;
      const grid = track.grid;
      // The visitor starts last on the grid, the AI ahead by roster order.
      const lineup = racers.filter((r) => r.name !== playerName);
      const chosen = racers.find((r) => r.name === playerName) || racers[0];
      if (!chosen) return;
      lineup.push(chosen);
      lineup.forEach((racer, slot) => {
        const g = grid[Math.min(grid.length - 1, slot)];
        const isPlayer = racer === chosen;
        racer.mount = isPlayer ? mountById(playerMount) : AI_MOUNTS[slot % AI_MOUNTS.length];
        seat(racer);
        racer.x = g.x;
        racer.z = g.z;
        racer.y = g.y;
        racer.heading = racer.motionHeading = g.heading;
        racer.speed = 0;
        racer.vy = 0;
        racer.airborne = false;
        racer.idx = g.index;
        racer.ground = g.y;
        racer.centre = track.roadY(g.index, 0, 0);
        racer.groundV = racer.groundVPrev = 0;
        racer.drift.active = false;
        racer.drift.charge = 0;
        racer.boost = racer.spin = racer.spinRot = racer.respawn = racer.invuln = racer.wrongWay = racer.wheelspin = 0;
        racer.wrong = false;
        racer.lap = 1;
        racer.checkpoint = 0;
        racer.started = false;
        racer.progress = 0;
        racer.rank = slot + 1;
        racer.lapStart = 0;
        racer.lapTime = racer.bestLap = racer.finishTime = 0;
        racer.finished = false;
        racer.item = null;
        racer.bananas = 0;
        racer.meterFull = false;
        racer.steer = racer.throttle = 0;
        racer.driftIn = racer.itemIn = false;
        racer.anim.phase = racer.anim.lean = racer.anim.squash = 0;
        racer.node.visible = true;
        racer.cave.parts.head.geometry = racer.cave.headOpen;
        if (isPlayer) player = racer;
      });
      pose(0);
    };
    // `playerStart` is "boost" for a throttle held from inside the last count, "spin" for one held from
    // earlier, else nothing; the sharper AI get their own jump off the line.
    const start = (playerStart = "") => {
      running = true;
      raceTime = 0;
      for (const r of racers) {
        r.lapStart = 0;
        if (r === player) {
          if (playerStart === "boost") r.boost = START_BOOST;
          else if (playerStart === "spin") r.wheelspin = START_SPIN;
        } else if (r.ai.skill > AI_START_SKILL) r.boost = AI_START_BOOST;
      }
    };
    const setInput = (racer, steer, throttle, drift, item) => {
      racer.steer = clamp(steer, -1, 1);
      racer.throttle = clamp(throttle, -1, 1);
      racer.driftIn = !!drift;
      racer.itemIn = !!item;
    };
    const drive = (r, dt) => {
      const S = track.samples, n = track.count, m = r.mount, ai = r.ai;
      const la = Math.max(3, Math.round(5 + r.speed * 0.45 * ai.skill));
      const ti = (r.idx + la) % n;
      const half = track.halfAt(ti);
      ai.wobble += dt * 0.7;
      const lat = clamp(S.line[ti] * (half - 1.3) * (0.55 + ai.skill * 0.45) + ai.offset * half * 0.6 + Math.sin(ai.wobble) * 0.6, -(half - 1), half - 1);
      const tx = S.x[ti] + track.rightX(ti) * lat, tz = S.z[ti] + track.rightZ(ti) * lat;
      let err = wrap(Math.atan2(tx - r.x, tz - r.z) - r.heading);
      // The AI gives way to whoever is right ahead.
      for (let i = 0; i < racers.length; i++) {
        const o = racers[i];
        if (o === r || o.respawn > 0) continue;
        const dx = o.x - r.x, dz = o.z - r.z, d = Math.hypot(dx, dz);
        if (d > 3.2) continue;
        const ahead = dx * Math.sin(r.heading) + dz * Math.cos(r.heading);
        if (ahead < 0.5) continue;
        const side = dx * Math.cos(r.heading) - dz * Math.sin(r.heading);
        err -= Math.sign(side || 1) * 0.35 * (1 - ai.aggro * 0.5);
      }
      let bend = 0;
      for (let k = 2; k < 22; k++) bend = Math.max(bend, Math.abs(S.curvature[(r.idx + k) % n]) * (1 - k / 30));
      const safe = bend > 0.004 ? ai.brakeK / Math.sqrt(bend) : 999;
      const throttle = r.speed > safe * (0.9 + ai.skill * 0.25) ? -0.45 : 1;
      const steer = clamp(-err * 2.3, -1, 1);
      let drift = r.drift.active;
      if (!drift && Math.abs(steer) > 0.6 && r.speed > m.top * 0.5 && ai.skill > 0.6 && bend > 0.03) drift = true;
      if (drift && (Math.abs(err) < 0.12 || r.drift.charge > 2.4 || r.speed < m.top * 0.3)) drift = false;
      let item = false;
      if (r.item && elapsed - ai.lastItem > 1.5) {
        if (r.item === "turbo") item = Math.abs(steer) < 0.25;
        else if (r.item === "rock") item = someoneAhead(r, 16);
        else if (r.item === "peel") item = someoneBehind(r, 9);
        else item = someoneAhead(r, 8) || someoneBehind(r, 6);
        if (item) ai.lastItem = elapsed;
      } else if (r.meterFull && Math.abs(steer) < 0.3) item = true;
      setInput(r, steer, throttle, drift, item);
    };
    const someoneAhead = (r, dist) => {
      for (let i = 0; i < racers.length; i++) {
        const o = racers[i];
        if (o === r) continue;
        const dx = o.x - r.x, dz = o.z - r.z, d = Math.hypot(dx, dz);
        if (d < dist && dx * Math.sin(r.heading) + dz * Math.cos(r.heading) > d * 0.75) return true;
      }
      return false;
    };
    const someoneBehind = (r, dist) => {
      for (let i = 0; i < racers.length; i++) {
        const o = racers[i];
        if (o === r) continue;
        const dx = o.x - r.x, dz = o.z - r.z, d = Math.hypot(dx, dz);
        if (d < dist && dx * Math.sin(r.heading) + dz * Math.cos(r.heading) < -d * 0.6) return true;
      }
      return false;
    };
    const respawnAt = (r, why) => {
      const i = track.checkpoints[r.started ? (r.checkpoint - 1 + track.checkpoints.length) % track.checkpoints.length : 0];
      const S = track.samples;
      r.x = S.x[i];
      r.z = S.z[i];
      r.y = r.ground = track.slabY(i, 0, 0);
      r.centre = track.roadY(i, 0, 0);
      r.heading = r.motionHeading = Math.atan2(S.tx[i], S.tz[i]);
      r.speed = 0;
      r.vy = 0;
      r.airborne = false;
      r.idx = i;
      r.drift.active = false;
      r.drift.charge = 0;
      r.boost = 0;
      r.spin = 0;
      r.spinRot = 0;
      r.respawn = RESPAWN_TIME;
      r.invuln = INVULN + RESPAWN_TIME;
      if (events.onRespawn) events.onRespawn(r, why);
    };
    const spinOut = (r, strength = 1) => {
      if (r.invuln > 0 || r.spin > 0) return false;
      r.spin = SPIN_TIME * strength * r.mount.recover;
      r.speed *= 0.35;
      r.drift.active = false;
      r.drift.charge = 0;
      r.boost = 0;
      return true;
    };
    const step = (r, dt) => {
      const m = r.mount, S = track.samples, n = track.count;
      if (r.respawn > 0) {
        r.respawn -= dt;
        return;
      }
      if (r.invuln > 0) r.invuln -= dt;
      if (r.spin > 0) {
        r.spin -= dt;
        r.spinRot += dt * 9;
        r.throttle = 0;
        r.steer = 0;
        r.driftIn = false;
        if (r.spin <= 0) r.spinRot = 0;
      }
      r.idx = track.nearest(r.x, r.z, r.idx);
      track.project(r.x, r.z, r.idx, P);
      r.lateral = P.lateral;
      r.along = P.along;
      const half = track.halfAt(r.idx);
      r.surface = track.surfaceAt(r.x, r.z, r.idx, r.lateral);
      const gap = r.surface === SURF.gap;
      const grip = gap ? 1 : SURFACE_GRIP[r.surface];
      const slippery = gap ? 0 : track.slipAt(r.surface);
      r.offroad = !gap && Math.abs(r.lateral) > half + CURB_W;
      const boosting = r.boost > 0;
      if (boosting) r.boost -= dt;
      let top = m.top * (boosting ? m.boostMul : 1) * (r.offroad ? m.offroad : grip < 1 && !slippery ? grip : 1);
      if (r.ai && r !== player) top *= r.aiTopMul || 1;
      if (r.wheelspin > 0) {
        r.wheelspin -= dt;
        top = Math.min(top, m.top * START_SPIN_TOP);
      }
      if (r.throttle > 0) {
        if (r.speed < top) r.speed = Math.min(top, r.speed + m.accel * r.throttle * dt * (boosting ? 1.6 : 1));
        else r.speed = damp(r.speed, top, boosting ? 2 : 5, dt);
      } else if (r.throttle < 0) {
        if (r.speed > 0.4) r.speed = Math.max(0, r.speed - m.brake * dt);
        else r.speed = Math.max(-top * 0.3, r.speed - m.accel * 0.5 * dt);
      } else {
        r.speed = damp(r.speed, 0, 0.8, dt);
        if (r.speed > top) r.speed = damp(r.speed, top, 4, dt);
      }
      const d = r.drift;
      const pressed = r.driftIn && !r.driftHeld;
      r.driftHeld = r.driftIn;
      if (!d.active && r.driftIn && !r.airborne && Math.abs(r.steer) > 0.3 && r.speed > m.top * 0.45 && r.spin <= 0) {
        d.active = true;
        d.dir = Math.sign(r.steer);
        d.charge = 0;
        r.airborne = true;
        r.vy = HOP_V;
        if (events.onDrift) events.onDrift(r, 0);
      } else if (pressed && !r.airborne && r.spin <= 0) {
        r.airborne = true;
        r.vy = HOP_V * (m.hop / 5);
        if (events.onHop) events.onHop(r);
      }
      if (d.active) {
        d.charge += dt * (r.steer * d.dir > 0.2 ? 1.3 : 0.8) * m.charge;
        d.tier = d.charge > 2.2 ? 3 : d.charge > 1.25 ? 2 : d.charge > 0.55 ? 1 : 0;
        if (!r.driftIn || r.speed < m.top * 0.28 || r.spin > 0) {
          d.active = false;
          if (d.tier > 0) {
            r.boost = BOOST_TIERS[d.tier];
            if (events.onDrift) events.onDrift(r, d.tier);
          }
          d.charge = 0;
          d.tier = 0;
        }
      }
      const speedK = clamp(Math.abs(r.speed) / 6, 0, 1) * (r.airborne ? 0.35 : 1);
      let turn;
      if (d.active) turn = m.driftTurn * (d.dir * 0.55 + r.steer * 0.5);
      else turn = m.turn * r.steer * (1 - 0.35 * Math.min(1, Math.abs(r.speed) / m.top));
      r.heading -= turn * speedK * dt * (r.speed < 0 ? -1 : 1);
      // The motion direction trails the heading while drifting or on ice.
      const wanted = r.heading + (d.active ? d.dir * DRIFT_ANGLE : 0);
      const settle = d.active ? 9 : lerp(14, 2.2, slippery);
      r.motionHeading = wrap(r.heading + damp(wrap(r.motionHeading - r.heading), wrap(wanted - r.heading), settle, dt));
      r.x += Math.sin(r.motionHeading) * r.speed * dt;
      r.z += Math.cos(r.motionHeading) * r.speed * dt;
      r.idx = track.nearest(r.x, r.z, r.idx);
      const prevGround = r.ground;
      r.ground = track.heightAt(r.x, r.z, r.idx, P);
      r.lateral = P.lateral;
      r.along = P.along;
      // Launches read the centreline profile, so curbs and the crown never throw a racer.
      const centre = track.roadY(r.idx, r.along, 0);
      const gv = (centre - r.centre) / dt;
      r.centre = centre;
      if (!r.airborne) {
        if (r.ground < prevGround - DROP && r.speed > 2) {
          r.airborne = true;
          r.vy = Math.max(0, Math.min(r.groundVPrev, 14));
        } else if (gv < r.groundVPrev - LAUNCH_MIN && r.groundVPrev > LAUNCH_MIN && r.speed > 6) {
          r.airborne = true;
          r.vy = Math.min(r.groundVPrev, 14);
        } else r.y = r.ground;
      }
      r.groundVPrev = r.groundV;
      r.groundV = gv;
      if (r.airborne) {
        r.vy -= GRAVITY * dt;
        r.y += r.vy * dt;
        if (r.y <= r.ground) {
          const hard = r.vy < -9;
          r.y = r.ground;
          r.vy = 0;
          r.airborne = false;
          r.groundV = r.groundVPrev = 0;
          r.anim.squash = hard ? 0.35 : 0.12;
          if (events.onLand) events.onLand(r, hard);
        }
      }
      const floorLevel = track.renderOpts && track.floorLevel;
      const surfaceNow = track.surfaceAt(r.x, r.z, r.idx, r.lateral);
      if ((surfaceNow === SURF.gap && r.y < floorLevel + 0.1) || Math.abs(r.lateral) > half + CURB_W + SHOULDER + FALL) {
        respawnAt(r, surfaceNow === SURF.gap ? track.hazard : "fell");
        return;
      }
      const side = r.lateral < 0 ? 1 : 2;
      const limit = half + CURB_W - m.radius * 0.6;
      if ((S.wall[r.idx] & side) && Math.abs(r.lateral) > limit) {
        const push = (Math.abs(r.lateral) - limit) * Math.sign(r.lateral);
        r.x -= track.rightX(r.idx) * push;
        r.z -= track.rightZ(r.idx) * push;
        r.lateral = Math.sign(r.lateral) * limit;
        const tangent = Math.atan2(S.tx[r.idx], S.tz[r.idx]);
        const into = -wrap(r.motionHeading - tangent) * Math.sign(r.lateral);
        if (into > 0.05) {
          // One knock on contact, then a scrape drag while the racer keeps leaning on the wall.
          if (r.wallHit <= 0) {
            r.speed *= Math.max(0.55, 1 - into * 0.7);
            r.heading = wrap(tangent + wrap(r.heading - tangent) * 0.4);
            r.motionHeading = r.heading;
            d.active = false;
            d.charge = 0;
            if (events.onWall) events.onWall(r, into);
          } else r.speed -= r.speed * into * 1.2 * dt;
          r.wallHit = 0.25;
        }
      }
      // Trackside props in this sector and its neighbours: a solid one pushes the racer out of its circle and knocks it as a wall does.
      const secs = track.sectorProps, sec = track.sectorOf(r.idx), last = secs.length - 1, px = track.props.x, pz = track.props.z, pr = track.props.r;
      for (let k = -1; k <= 1; k++) {
        const si = (sec + k + last) % last;
        for (let q = secs[si]; q < secs[si + 1]; q++) {
          const dx = r.x - px[q], dz = r.z - pz[q], min = pr[q] + m.radius * 0.7, d2 = dx * dx + dz * dz;
          if (d2 >= min * min || d2 < 1e-6) continue;
          const dist = Math.sqrt(d2), nx = dx / dist, nz = dz / dist;
          r.x = px[q] + nx * min;
          r.z = pz[q] + nz * min;
          const into = -(Math.sin(r.motionHeading) * nx + Math.cos(r.motionHeading) * nz);
          if (into > 0.05) {
            if (r.wallHit <= 0) {
              r.speed *= Math.max(0.3, 1 - into * 0.8);
              d.active = false;
              d.charge = 0;
              if (events.onWall) events.onWall(r, into);
            } else r.speed -= r.speed * into * 1.5 * dt;
            r.wallHit = 0.25;
          }
        }
      }
      if (r.wallHit > 0) r.wallHit -= dt;
      r.progress = S.dist[r.idx] + r.along * STEP;
      const checks = track.checkpoints, count = checks.length;
      const c = checks[r.checkpoint];
      let dist = r.idx - c;
      if (dist > n / 2) dist -= n;
      if (dist < -n / 2) dist += n;
      const forward = Math.sin(r.motionHeading) * S.tx[r.idx] + Math.cos(r.motionHeading) * S.tz[r.idx];
      if (Math.abs(dist) <= CHECK_WINDOW && forward > 0 && !r.finished) {
        if (r.checkpoint === 0) {
          if (!r.started) {
            r.started = true;
            r.lapStart = raceTime;
          } else {
            r.lapTime = raceTime - r.lapStart;
            r.lapStart = raceTime;
            if (!r.bestLap || r.lapTime < r.bestLap) r.bestLap = r.lapTime;
            r.lap++;
            if (r.lap > laps) {
              r.finished = true;
              r.finishTime = raceTime;
              if (events.onFinish) events.onFinish(r);
            } else if (events.onLap) events.onLap(r);
          }
        }
        r.checkpoint = (r.checkpoint + 1) % count;
      }
      if (Math.abs(r.speed) > 3 && forward * Math.sign(r.speed) < -0.4) {
        r.wrongWay += dt;
        if (r.wrongWay > WRONG_WAY_AFTER && !r.wrong) {
          r.wrong = true;
          if (events.onWrongWay) events.onWrongWay(r, true);
        }
      } else if (r.wrongWay > 0) {
        r.wrongWay = 0;
        if (r.wrong) {
          r.wrong = false;
          if (events.onWrongWay) events.onWrongWay(r, false);
        }
      }
    };
    // Bodies push apart, the heavier one moves less.
    const collide = () => {
      for (let i = 0; i < racers.length; i++) {
        const a = racers[i];
        if (a.respawn > 0) continue;
        for (let j = i + 1; j < racers.length; j++) {
          const b = racers[j];
          if (b.respawn > 0 || Math.abs(a.y - b.y) > 1.2) continue;
          const dx = b.x - a.x, dz = b.z - a.z, min = a.mount.radius + b.mount.radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min || d2 < 1e-6) continue;
          const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, overlap = min - d;
          const total = a.mount.mass + b.mount.mass;
          a.x -= nx * overlap * (b.mount.mass / total);
          a.z -= nz * overlap * (b.mount.mass / total);
          b.x += nx * overlap * (a.mount.mass / total);
          b.z += nz * overlap * (a.mount.mass / total);
          // Relative approach along the contact trades a little speed.
          const va = a.speed * (Math.sin(a.motionHeading) * nx + Math.cos(a.motionHeading) * nz);
          const vb = b.speed * (Math.sin(b.motionHeading) * nx + Math.cos(b.motionHeading) * nz);
          const rel = va - vb;
          if (rel > 0) {
            a.speed = Math.max(-a.mount.top * 0.3, a.speed - rel * 0.35 * (b.mount.mass / total));
            b.speed = Math.min(b.mount.top * b.mount.boostMul, b.speed + rel * 0.35 * (a.mount.mass / total));
            if (rel > 3 && events.onBump) events.onBump(a, b, rel);
            if (rel > 9 && a.boost > 0) spinOut(b, 0.6);
          }
        }
      }
    };
    const rankAll = () => {
      // Insertion sort on a small fixed array, by finish then laps then checkpoints then progress.
      const key = (r) => r.finished ? 1e9 - r.finishTime : r.started ? (r.lap * 100 + (r.checkpoint || 100)) * 1e5 + r.progress : r.progress - track.length;
      for (let i = 1; i < order.length; i++) {
        const r = order[i], k = key(r);
        let j = i - 1;
        while (j >= 0 && key(order[j]) < k) {
          order[j + 1] = order[j];
          j--;
        }
        order[j + 1] = r;
      }
      for (let i = 0; i < order.length; i++) order[i].rank = i + 1;
      // Rubber band: the AI behind the visitor push a little, the AI ahead ease off.
      if (player) {
        for (const r of racers) {
          if (r === player) continue;
          const gap = (player.lap - r.lap) * track.length + player.progress - r.progress;
          r.aiTopMul = 1 + clamp(gap / (track.length * 0.6), -0.07, 0.11);
        }
      }
    };
    const substep = (dt) => {
      elapsed += dt;
      if (running) raceTime += dt;
      for (let i = 0; i < racers.length; i++) {
        const r = racers[i];
        if ((r !== player || autopilot) && running) drive(r, dt);
        if (r.finished) r.throttle = Math.min(r.throttle, 0.5);
        if (!running) {
          r.throttle = 0;
          r.steer = 0;
          r.driftIn = false;
        }
        step(r, dt);
      }
      collide();
      rankTimer -= dt;
      if (rankTimer <= 0) {
        rankTimer = RANK_EVERY;
        rankAll();
      }
    };
    let frame = 0;
    const pose = (dt, camX = 0, camZ = 0) => {
      const S = track.samples, n = track.count;
      frame++;
      const dustGeo = track.theme === "peak" ? SNOW_DUST : track.theme === "gorge" ? ASH : DUST;
      for (let i = 0; i < racers.length; i++) {
        const r = racers[i], a = r.anim, m = r.mount, parts = r.cave.parts;
        if (!m) continue;
        const boosting = r.boost > 0 && r.respawn <= 0;
        r.flame.visible = boosting;
        if (boosting) {
          const flick = 0.85 + Math.sin(elapsed * 41 + r.index) * 0.15;
          setVec(r.flame.scale, flick, flick, (0.7 + Math.min(1, r.boost) * 0.6) * flick);
        }
        const near = fx && (r.x - camX) ** 2 + (r.z - camZ) ** 2 < EFFECT_RANGE && r.respawn <= 0 && !r.airborne;
        if (near && r.drift.active && r.drift.tier > 0 && (frame & 1) === 0) {
          const side = -r.drift.dir, sx = Math.cos(r.heading) * 0.5 * side, sz = -Math.sin(r.heading) * 0.5 * side;
          fx.burst(r.x + sx - Math.sin(r.heading) * 0.5, r.y + 0.12, r.z + sz - Math.cos(r.heading) * 0.5, 1, SPARKS[r.drift.tier - 1], 1.6);
        }
        if (near && r.offroad && Math.abs(r.speed) > 6 && (frame & 3) === 0) fx.burst(r.x - Math.sin(r.heading) * 0.6, r.y + 0.1, r.z - Math.cos(r.heading) * 0.6, 1, dustGeo, 0.9);
        r.node.visible = r.respawn <= 0 || Math.floor(r.respawn * 12) % 2 === 0;
        setVec(r.node.position, r.x, r.y, r.z);
        const q = (r.idx + 1) % n;
        const slope = (S.y[q] - S.y[r.idx]) / STEP;
        const bank = lerp(S.bank[r.idx], S.bank[q], clamp(r.along, 0, 1));
        const forwardness = Math.sin(r.heading) * S.tx[r.idx] + Math.cos(r.heading) * S.tz[r.idx];
        a.pitch = damp(a.pitch, r.airborne ? -r.vy * 0.03 : -Math.atan(slope) * forwardness, 10, dt);
        a.lean = damp(a.lean, (r.drift.active ? r.drift.dir * 0.22 : r.steer * 0.1) * clamp(r.speed / 8, 0, 1), 8, dt);
        a.roll = damp(a.roll, -bank * forwardness, 10, dt);
        a.squash = damp(a.squash, 0, 8, dt);
        r.node.rotation.y = r.heading - (r.drift.active ? r.drift.dir * 0.32 : 0) + r.spinRot;
        r.node.rotation.x = a.pitch;
        r.node.rotation.z = a.roll - a.lean;
        r.body.scale.y = 1 - a.squash;
        r.body.scale.x = r.body.scale.z = 1 + a.squash * 0.4;
        a.phase += Math.abs(r.speed) * dt * (m.id === "run" ? 1.4 : 1.1);
        if (m.id === "run") {
          const swing = r.airborne ? 0.6 : Math.sin(a.phase) * clamp(r.speed / 4, 0, 1);
          parts.legR.rotation.x = swing * 0.9;
          parts.legL.rotation.x = -swing * 0.9;
          parts.armR.rotation.x = -0.4 - swing * 0.7;
          parts.armL.rotation.x = -0.4 + swing * 0.7;
          r.cave.root.position.y = r.baseY + (r.airborne ? 0.1 : Math.abs(Math.sin(a.phase)) * 0.06 * clamp(r.speed / 6, 0, 1));
          parts.torso.rotation.x = clamp(r.speed / m.top, 0, 1) * 0.28;
        } else if (m.id === "kart") {
          const ride = r.ride;
          a.wheel += r.speed * dt / raceModels.KART.wheelR;
          for (let w = 0; w < 4; w++) {
            ride.wheels[w].rotation.x = a.wheel;
            if (w < 2) ride.wheels[w].rotation.y = -r.steer * 0.4;
          }
          parts.armR.rotation.z = -0.25 + r.steer * 0.25;
          parts.armL.rotation.z = 0.25 + r.steer * 0.25;
        } else {
          const ride = r.ride;
          const k = clamp(r.speed / 5, 0, 1);
          const stride = r.airborne ? -0.5 : Math.sin(a.phase * 0.9) * 0.75 * k;
          ride.legL.rotation.x = stride;
          ride.legR.rotation.x = -stride;
          const bob = Math.abs(Math.sin(a.phase * 0.9)) * 0.07 * k;
          ride.hips.position.y = 8 * 0.085 + bob;
          ride.legL.position.y = ride.legR.position.y = 8 * 0.085 + bob;
          ride.neck.rotation.x = -0.35 + Math.sin(a.phase * 0.9 + 1) * 0.12 * k - clamp(r.speed / m.top, 0, 1) * 0.2;
          ride.tail.rotation.y = Math.sin(a.phase * 0.45) * 0.3 * k + a.lean * 1.5;
        }
        parts.head.rotation.y = damp(parts.head.rotation.y, -r.steer * 0.35 * (r.drift.active ? 1.6 : 1), 8, dt);
        parts.head.rotation.x = r.spin > 0 ? 0.3 : 0;
        if (r.cave.parts.snack) r.cave.parts.snack.visible = false;
      }
    };
    const control = (racer) => {
      player = racer;
    };
    const rankLabel = (rank) => NAMES[rank - 1] || `${rank}th`;
    const dispose = () => {
      player = null;
      for (const r of racers) {
        for (const key of ["torso", "head"]) input.remove(r.cave.parts[key]);
        removeChild(root, r.node);
      }
      racers.length = 0;
      order.length = 0;
    };
    const stats = () => ({ racers: racers.length, running });
    return {
      racers, order, MOUNTS, setup, start, substep, pose, setInput, control, spinOut, respawnAt, rankLabel, dispose, stats, events,
      get player() {
        return player;
      },
      get raceTime() {
        return raceTime;
      },
      get running() {
        return running;
      },
      set running(v) {
        running = v;
      },
      get autopilot() {
        return autopilot;
      },
      set autopilot(v) {
        autopilot = !!v;
      }
    };
  };
  BL.racers = { create, MOUNTS, mountById, BOOST_MUL, BOOST_TIERS, START_BOOST, START_SPIN };
})();
