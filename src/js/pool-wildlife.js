// The Mempool island's wildlife, alive: each animal is a rig of faceted parts (`poolModels.beastRig`) driven by
// a small state machine on the pattern of the hub's gorillas, roaming, resting, sleeping and climbing.
//
// States: `idle` (look about, the toucan pecks), `walk` (turn, then gait to a goal, waiting for a neighbour in
// the way), `rest` (lie or sit; asleep by night or on a nap) and `glide` (a timed move from one
// point to another under a chosen pose: climbing a trunk, walking a branch, hopping onto the log, flying).
// The jaguar walks, naps and lies along the fallen log; the monkey knuckle-walks, sits and climbs a canopy
// trunk to sit out on a branch; the toucan hops and pecks, and every so often flies to a crown top or another
// patch of ground. By night they sleep: the monkey up its tree, the toucan on a perch.
//
// Everything stays on the islet top in the island group's own frame (+z toward the home island, y = 0 on the
// ground). Poses are channels damped toward the state's targets, so every change of state eases. Nothing is
// allocated per frame. `create` returns `list`, `update(dt)`, `startle(animal)` and `dispose`.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { mulberry32, damp, clamp, lerp } = BL.math;
  const { createNode, addChild, removeChild } = BL.scene;
  const TAU = Math.PI * 2;
  // walk/run speeds (m/s), stride (m per gait cycle), turn rate (rad/s), body radius for spacing.
  const SPECIES = {
    jaguar: { walk: 0.75, run: 2, stride: 1, turn: 2.6, radius: 0.6, swing: 0.5 },
    monkey: { walk: 0.6, run: 1.5, stride: 0.62, turn: 3.4, radius: 0.35, swing: 0.5 },
    toucan: { walk: 0.32, run: 0.6, stride: 0.2, turn: 5, radius: 0.22, swing: 0, fly: 3.4 }
  };
  const POSE_RATE = 7, CLIMB_SPEED = 0.75, SETTLE = 3;
  const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const headingOf = (dx, dz) => Math.atan2(-dz, dx);
  const ease = (a, key, target, k) => (a[key] += (target - a[key]) * k);
  const wave = (a, offset) => Math.sin(TAU * (a.phase + offset));

  const create = (ctx) => {
    // `groundAt` is the ground under a point of the island's frame and `spotOk` whether an animal may stand there.
    // An animal's own `y` is its height above `base`, the ground it is over or the foot of what it has climbed.
    const { parent, obstacles, sleepy, toWorld, groundAt, spotOk } = ctx;
    const rand = mulberry32(7717), SPOT = { x: 0, z: 0 }, WORLD = { x: 0, z: 0 };
    // Trees and logs in the island frame, read once from each placed node's transform.
    const place = (n, x, y, z, out) => {
      const c = Math.cos(n.ry), s = Math.sin(n.ry), px = x * n.k, pz = z * n.k;
      out[0] = n.x + px * c + pz * s; out[1] = y * n.sy; out[2] = n.z - px * s + pz * c;
      return out;
    };
    const trees = ctx.trees.map((n) => {
      const c = n.geometry.climb, height = c.height * n.sy;
      return {
        x: n.x, z: n.z, base: n.y, height, k: n.k, taken: null,
        leanX: c.lean * n.k * Math.cos(n.ry), leanZ: -c.lean * n.k * Math.sin(n.ry),
        branches: c.branches.map((b) => [...place(n, b[0], b[1], b[2], [0, 0, 0]), ...place(n, b[3], b[4], b[5], [0, 0, 0])]),
        perches: c.perches.map((p) => ({ at: place(n, p[0], p[1], p[2], [0, 0, 0]), base: n.y, taken: null }))
      };
    });
    const logs = ctx.logs.map((n) => {
      const r = n.geometry.rest, c = Math.cos(n.ry), s = Math.sin(n.ry);
      return { x: n.x, z: n.z, base: n.y, y: r.y * n.sy, ax: c, az: -s, half: r.to * n.k, taken: null };
    });

    const list = [];
    const segmentClear = (a, x0, z0, x1, z1) => {
      const dx = x1 - x0, dz = z1 - z0, len2 = dx * dx + dz * dz || 1;
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i], t = clamp(((o.x - x0) * dx + (o.z - z0) * dz) / len2, 0, 1);
        const ex = x0 + dx * t - o.x, ez = z0 + dz * t - o.z, r = o.r + a.cfg.radius;
        if (ex * ex + ez * ez < r * r) return false;
      }
      // The whole way must be ground an animal walks on: no channel, nest, path or ledge between two good spots.
      const steps = Math.ceil(Math.sqrt(len2) / 0.5);
      for (let i = 1; i < steps; i++) if (!spotOk(x0 + dx * i / steps, z0 + dz * i / steps)) return false;
      return true;
    };
    const spotFree = (a, x, z) => {
      if (!spotOk(x, z)) return false;
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        if (Math.hypot(x - o.x, z - o.z) < o.r + a.cfg.radius) return false;
      }
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b === a) continue;
        const room = a.cfg.radius + b.cfg.radius + 0.6;
        if (Math.hypot(x - b.x, z - b.z) < room || Math.hypot(x - b.gx, z - b.gz) < room) return false;
      }
      return true;
    };
    // A reachable free spot, preferring one within `reach` of the animal (or at least `away` from it).
    const pickSpot = (a, reach, away = 0) => {
      for (let n = 0; n < 24; n++) {
        const t = rand() * TAU, d = away + rand() * (reach - away);
        const x = a.x + Math.cos(t) * d, z = a.z + Math.sin(t) * d;
        if (!spotFree(a, x, z) || !segmentClear(a, a.x, a.z, x, z)) continue;
        SPOT.x = x; SPOT.z = z;
        return true;
      }
      return false;
    };

    const setState = (a, state, time) => {
      a.state = state; a.timer = time; a.waits = 0;
    };
    const walkTo = (a, x, z, speed, after) => {
      a.gx = x; a.gz = z; a.speed = speed; a.after = after;
      setState(a, "walk", 30);
    };
    // A timed move along a straight line (plus an arc) under a pose, then `after`.
    // `base` is the ground the move ends over; it defaults to the ground under its end.
    const glide = (a, x, y, z, speed, pose, after, arc = 0, face = NaN, base = groundAt(x, z)) => {
      a.sx = a.x; a.sy = a.y; a.sz = a.z; a.ex = x; a.ey = y; a.ez = z; a.arc = arc; a.pose = pose; a.after = after;
      a.sb = a.base; a.eb = base > -Infinity ? base : a.base;
      a.gt = 0; a.gdur = Math.max(0.25, Math.hypot(x - a.x, y - a.y, z - a.z) / speed);
      a.face = Number.isNaN(face) ? (Math.hypot(x - a.x, z - a.z) > 0.05 ? headingOf(x - a.x, z - a.z) : a.heading) : face;
      setState(a, "glide", a.gdur);
    };
    const rest = (a, time, asleep) => {
      a.asleep = asleep;
      setState(a, "rest", time);
    };
    const idle = (a, time) => setState(a, "idle", time);

    // Climbing: where the monkey clings to the trunk at height h from direction (dx, dz), its chest against the
    // bark: the trunk's own radius there (it tapers from 0.34 to 0.2 over its lower four-fifths) plus the chest.
    const CHEST = 0.17;
    const trunkRadius = (tree, h) => tree.k * (0.34 - 0.14 * Math.min(1, h / (tree.height * 0.8)));
    const clingAt = (tree, h, dx, dz, out) => {
      const t = h / tree.height, cling = trunkRadius(tree, h) + CHEST;
      out[0] = tree.x + tree.leanX * t + dx * cling; out[1] = h; out[2] = tree.z + tree.leanZ * t + dz * cling;
      return out;
    };
    // A point on top of the chosen limb, u of the way out (the limb tapers from 0.12 to 0.05).
    const onBranch = (a, u, out) => {
      const b = a.branch;
      out[0] = lerp(b[0], b[3], u); out[1] = lerp(b[1], b[4], u) + a.tree.k * (0.12 - 0.07 * u); out[2] = lerp(b[2], b[5], u);
      return out;
    };
    const CLING = [0, 0, 0];
    const startClimb = (a, tree, speed) => {
      // The limb whose outward run is nearest the side the monkey comes from, so it never climbs through the trunk.
      let best = null, bestDot = -Infinity;
      const fx = a.x - tree.x, fz = a.z - tree.z, fl = Math.hypot(fx, fz) || 1;
      for (const b of tree.branches) {
        const bx = b[3] - b[0], bz = b[5] - b[2], bl = Math.hypot(bx, bz) || 1, dot = (bx * fx + bz * fz) / (bl * fl);
        if (dot > bestDot) { bestDot = dot; best = b; }
      }
      const bl = Math.hypot(best[3] - best[0], best[5] - best[2]) || 1;
      a.tree = tree; a.branch = best; a.dx = (best[3] - best[0]) / bl; a.dz = (best[5] - best[2]) / bl;
      // Where the limb leaves the trunk on this side: the climb ends exactly there, on the limb's top.
      a.u0 = clamp((trunkRadius(tree, best[1]) + CHEST) / bl, 0.05, 0.3);
      tree.taken = a;
      clingAt(tree, 0, a.dx, a.dz, CLING);
      walkTo(a, CLING[0], CLING[2], speed, "climb");
    };
    const leaveTree = (a) => {
      if (a.tree) a.tree.taken = null;
      a.tree = a.branch = null;
      a.onBranch = false;
    };
    const perchFree = () => {
      let count = 0;
      for (const t of trees) for (const p of t.perches) if (!p.taken) count++;
      if (!count) return null;
      let pick = (rand() * count) | 0;
      for (const t of trees) for (const p of t.perches) if (!p.taken && pick-- === 0) return p;
      return null;
    };
    // A tree nobody is climbing within `reach`, picked at random.
    const freeTree = (a, reach) => {
      let count = 0;
      for (const t of trees) if (!t.taken && Math.hypot(t.x - a.x, t.z - a.z) < reach) count++;
      let pick = (rand() * count) | 0;
      for (const t of trees) if (!t.taken && Math.hypot(t.x - a.x, t.z - a.z) < reach && pick-- === 0) return t;
      return null;
    };
    const flyTo = (a, x, y, z, perch) => {
      if (a.perch) a.perch.taken = null;
      a.perch = perch;
      if (perch) perch.taken = a;
      a.asleep = false;
      glide(a, x, y, z, a.cfg.fly, "fly", "land", 1.5 + Math.hypot(x - a.x, z - a.z) * 0.12, NaN, perch ? perch.base : groundAt(x, z));
    };
    const flyAnywhere = (a) => {
      const perch = rand() < 0.6 ? perchFree() : null;
      if (perch) return flyTo(a, perch.at[0], perch.at[1], perch.at[2], perch);
      if (pickSpot(a, 8, 3)) return flyTo(a, SPOT.x, 0, SPOT.z, null);
      idle(a, 2);
    };

    // What to do next, once the current state runs out.
    const decide = (a) => {
      const night = sleepy(), r = rand();
      if (a.kind === "jaguar") {
        if (a.log) {
          const log = a.log, side = rand() < 0.5 ? 1 : -1;
          log.taken = null; a.log = null;
          return glide(a, a.x - log.az * side * 0.9, 0, a.z + log.ax * side * 0.9, 1.6, "stand", "idle", 0.35);
        }
        const log = logs.length ? logs[(rand() * logs.length) | 0] : null;
        if (log && !log.taken && r < (night ? 0.3 : 0.16)) {
          const side = rand() < 0.5 ? 1 : -1, x = log.x - log.az * side * 1, z = log.z + log.ax * side * 1;
          if (spotFree(a, x, z) && segmentClear(a, a.x, a.z, x, z)) { log.taken = a; a.log = log; return walkTo(a, x, z, a.cfg.walk, "mount"); }
        }
        if (r < (night ? 0.75 : 0.3)) return rest(a, night ? 30 + rand() * 30 : 8 + rand() * 10, night || rand() < 0.5);
        if (pickSpot(a, 5)) return walkTo(a, SPOT.x, SPOT.z, a.cfg.walk, "idle");
        return idle(a, 2 + rand() * 3);
      }
      if (a.kind === "monkey") {
        if (a.tree) {
          if (night) return rest(a, 30 + rand() * 30, true);
          a.onBranch = false;
          onBranch(a, a.u0, CLING);
          return glide(a, CLING[0], CLING[1], CLING[2], 0.5, "walk", "down", 0, headingOf(-a.dx, -a.dz), a.tree.base);
        }
        const tree = r < (night ? 0.9 : 0.3) ? freeTree(a, Infinity) : null;
        if (tree) return startClimb(a, tree, a.cfg.walk);
        if (r < 0.55) return rest(a, 6 + rand() * 8, false);
        if (pickSpot(a, 5)) return walkTo(a, SPOT.x, SPOT.z, a.cfg.walk, "idle");
        return idle(a, 2 + rand() * 3);
      }
      // The toucan.
      if (night) {
        if (a.perch) return rest(a, 40 + rand() * 30, true);
        const perch = perchFree();
        if (perch) return flyTo(a, perch.at[0], perch.at[1], perch.at[2], perch);
        return rest(a, 30, true);
      }
      if (a.perch || r < 0.3) return flyAnywhere(a);
      if (r < 0.6 && pickSpot(a, 2.5)) return walkTo(a, SPOT.x, SPOT.z, a.cfg.walk, "idle");
      return idle(a, 2 + rand() * 4);
    };
    // Where a finished move leads.
    const arrive = (a) => {
      const step = a.after;
      a.after = "";
      switch (step) {
        case "mount": {
          const log = a.log, along = (rand() - 0.5) * log.half;
          return glide(a, log.x + log.ax * along, log.y, log.z + log.az * along, 1.6, "stand", "logRest", 0.45, headingOf(log.ax, log.az) + (rand() < 0.5 ? Math.PI : 0), log.base);
        }
        case "logRest": return rest(a, 12 + rand() * 20, rand() < 0.6 || sleepy());
        case "climb": {
          // Up the bark, chest to the trunk, to where the limb leaves it on this side.
          onBranch(a, a.u0, CLING);
          const top = CLING[1];
          clingAt(a.tree, top, a.dx, a.dz, CLING);
          return glide(a, CLING[0], top, CLING[2], CLIMB_SPEED, "climb", "branch", 0, headingOf(-a.dx, -a.dz), a.tree.base);
        }
        case "branch": {
          // Along the limb's top, never through the air.
          onBranch(a, 0.45, CLING);
          return glide(a, CLING[0], CLING[1], CLING[2], 0.5, "walk", "treeRest", 0, headingOf(a.dx, a.dz), a.tree.base);
        }
        case "treeRest": a.onBranch = true; return rest(a, 10 + rand() * 15, sleepy());
        case "down": {
          // From the limb's root back onto the bark, then down it.
          clingAt(a.tree, a.y, a.dx, a.dz, CLING);
          a.x = CLING[0]; a.z = CLING[2];
          clingAt(a.tree, 0, a.dx, a.dz, CLING);
          return glide(a, CLING[0], 0, CLING[2], CLIMB_SPEED, "climb", "ground", 0, headingOf(-a.dx, -a.dz), a.tree.base);
        }
        case "ground": leaveTree(a); return idle(a, 1 + rand() * 2);
        case "land": return idle(a, 2 + rand() * 4);
        default: return idle(a, 2 + rand() * 4);
      }
    };

    // A poke: the sleeper wakes, the jaguar bolts, the monkey makes for a tree (or bolts), the toucan takes off.
    const startle = (a) => {
      a.asleep = false;
      if (a.state === "glide") return;
      if (a.kind === "toucan") return flyAnywhere(a);
      if (a.log || a.tree) return rest(a, 1.5, false);
      if (a.kind === "monkey") {
        const tree = freeTree(a, 5);
        if (tree) return startClimb(a, tree, a.cfg.run);
      }
      if (pickSpot(a, 7, 3)) return walkTo(a, SPOT.x, SPOT.z, a.cfg.run, "idle");
      a.snarl = 1;
    };

    const step = (a, dt) => {
      const cfg = a.cfg;
      a.timer -= dt;
      a.moving = 0;
      // On the ground an animal settles onto whatever terrace it has walked onto.
      if (a.state !== "glide" && !a.tree && !a.log && !a.perch) {
        const ground = groundAt(a.x, a.z);
        if (ground > -Infinity) a.base += clamp(ground - a.base, -SETTLE * dt, SETTLE * dt);
      }
      if (a.state === "walk") {
        const dx = a.gx - a.x, dz = a.gz - a.z, dist = Math.hypot(dx, dz);
        if (dist < 0.06 || a.timer < 0) return arrive(a);
        const want = headingOf(dx, dz), turn = angleTo(a.heading, want);
        a.heading += clamp(turn, -cfg.turn * dt, cfg.turn * dt);
        if (Math.abs(turn) > 0.5) return;
        // Wait for a neighbour standing in the way; after a few waits, go somewhere else.
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (b === a || b.y > 0.5) continue;
          const ox = b.x - a.x, oz = b.z - a.z, d = Math.hypot(ox, oz);
          if (d < cfg.radius + b.cfg.radius + 0.25 && ox * dx + oz * dz > 0) {
            if ((a.waits += dt) > 2) { a.after = ""; idle(a, 0.5); }
            return;
          }
        }
        const move = Math.min(dist, a.speed * dt);
        a.x += dx / dist * move; a.z += dz / dist * move;
        a.moving = a.speed;
        a.phase = (a.phase + move / cfg.stride) % 1;
        return;
      }
      if (a.state === "glide") {
        a.gt = Math.min(a.gdur, a.gt + dt);
        const t = a.gt / a.gdur;
        a.x = lerp(a.sx, a.ex, t); a.z = lerp(a.sz, a.ez, t);
        a.y = lerp(a.sy, a.ey, t) + Math.sin(t * Math.PI) * a.arc;
        a.base = lerp(a.sb, a.eb, t);
        a.heading += clamp(angleTo(a.heading, a.face), -cfg.turn * 2 * dt, cfg.turn * 2 * dt);
        a.moving = Math.hypot(a.ex - a.sx, a.ey - a.sy, a.ez - a.sz) / a.gdur;
        a.phase = (a.phase + a.moving * dt / (a.pose === "climb" ? 0.5 : cfg.stride)) % 1;
        if (t >= 1) arrive(a);
        return;
      }
      if (a.state === "idle" && (a.look -= dt) <= 0) {
        a.look = 1.2 + rand() * 2.4;
        a.lookYaw = (rand() - 0.5) * 1.4;
        a.peck = a.kind === "toucan" && rand() < 0.5 ? 0.5 : 0;
      }
      if (a.timer <= 0) decide(a);
    };

    // Pose: channel targets from the state, eased, then written into the rig.
    const pose = (a, dt, time) => {
      const P = a.parts, kind = a.kind, moving = a.moving > 0.01, gliding = a.state === "glide";
      const resting = a.state === "rest", asleep = resting && a.asleep;
      const k = 1 - Math.exp(-POSE_RATE * dt);
      a.peck = Math.max(0, a.peck - dt);
      a.snarl = Math.max(0, a.snarl - dt);
      const lookYaw = a.state === "idle" ? a.lookYaw : 0;
      if (kind === "jaguar") {
        const lie = resting ? 1 : 0;
        ease(a, "bodyY", lerp(0.58, 0.26, lie), k);
        ease(a, "front", lie * 1.45, k);
        ease(a, "back", lie * 1.3, k);
        ease(a, "headPitch", asleep ? -0.35 : lie * -0.05 + (a.snarl ? 0.25 : 0), k);
        ease(a, "headYaw", asleep ? 0.45 : lookYaw, k);
        const swing = moving ? a.cfg.swing * Math.min(1, a.moving / a.cfg.walk) * (a.moving > 1.2 ? 1.3 : 1) : 0;
        P.legFL.rotation.z = a.front + swing * wave(a, 0.25);
        P.legFR.rotation.z = a.front + swing * wave(a, 0.75);
        P.legBL.rotation.z = a.back + swing * wave(a, 0);
        P.legBR.rotation.z = a.back + swing * wave(a, 0.5);
        P.body.position.y = a.bodyY + (moving ? Math.abs(wave(a, 0)) * 0.015 : Math.sin(time * 1.6) * (1 - lie) * 0.004);
        P.tail.rotation.y = lie ? 1.1 : Math.sin(time * 1.2 + a.seed) * 0.35;
        P.tail.rotation.z = lie ? -0.3 : 0.1 + Math.sin(time * 0.8 + a.seed) * 0.12;
      } else if (kind === "monkey") {
        const climbing = gliding && a.pose === "climb", sit = resting ? 1 : 0;
        ease(a, "pitch", climbing ? 1.4 : sit * 0.95, k);
        ease(a, "bodyY", climbing ? 0.2 : lerp(0.4, 0.13, sit), k);
        // Climbing, the body stands up the trunk: arms reach up the bark and legs grip below. Sitting on a limb the
        // legs dangle; on the ground they fold forward.
        ease(a, "front", climbing ? 1.35 : sit * -0.95, k);
        ease(a, "back", climbing ? -1 : sit * (a.onBranch ? 0.35 : 1.35), k);
        ease(a, "headPitch", asleep ? -1.35 : climbing ? -0.9 : sit * -0.6, k);
        ease(a, "headYaw", asleep ? 0 : lookYaw, k);
        const swing = moving ? (climbing ? 0.35 : a.cfg.swing) : 0;
        P.body.rotation.z = a.pitch;
        P.body.position.y = a.bodyY + (moving && !climbing ? Math.abs(wave(a, 0)) * 0.012 : 0);
        P.armL.rotation.z = a.front + swing * wave(a, climbing ? 0 : 0.25);
        P.armR.rotation.z = a.front + swing * wave(a, climbing ? 0.5 : 0.75);
        P.legL.rotation.z = a.back + swing * wave(a, climbing ? 0.5 : 0);
        P.legR.rotation.z = a.back + swing * wave(a, climbing ? 0 : 0.5);
        P.tail.rotation.z = Math.sin(time * 0.9 + a.seed) * 0.25;
      } else {
        const flying = gliding && a.pose === "fly";
        ease(a, "pitch", flying ? -0.8 : 0, k);
        ease(a, "wing", flying ? 1 : 0, k);
        ease(a, "back", flying ? -1.2 : 0, k);
        ease(a, "headPitch", asleep ? -0.25 : flying ? 0.55 : a.peck > 0 ? -0.8 : 0, k);
        ease(a, "headYaw", asleep ? 2.7 : flying ? 0 : lookYaw, k);
        const flap = flying ? Math.sin(time * 42) * (a.ey < a.y - 0.2 ? 0.25 : 0.6) : 0;
        P.body.rotation.z = a.pitch;
        P.wingL.rotation.x = -a.wing * (1.25 + flap);
        P.wingR.rotation.x = a.wing * (1.25 + flap);
        P.legL.rotation.z = a.back;
        P.legR.rotation.z = a.back;
        // Hops: a little bounce every stride on the ground.
        P.body.position.y = 0.2 + (moving && !flying ? Math.abs(Math.sin(a.phase * Math.PI)) * 0.06 : 0);
        P.tail.rotation.z = flying ? 0.3 : Math.sin(time * 0.7 + a.seed) * 0.08;
      }
      P.head.rotation.y = a.headYaw;
      P.head.rotation.z = a.headPitch;
      a.root.position.x = a.x; a.root.position.y = a.base + a.y; a.root.position.z = a.z;
      a.root.rotation.y = a.heading;
    };

    for (const def of ctx.animals) {
      const rig = BL.poolModels.beastRig(def.kind), root = createNode({ position: { x: def.x, y: groundAt(def.x, def.z), z: def.z }, rotation: { x: 0, y: def.heading, z: 0 }, sightHidden: true }), parts = {};
      for (const name in rig) {
        const r = rig[name];
        parts[name] = createNode({ position: { x: r.at[0], y: r.at[1], z: r.at[2] }, geometry: r.geometry, sightHidden: true });
      }
      for (const name in rig) addChild(rig[name].parent ? parts[rig[name].parent] : root, parts[name]);
      addChild(parent, root);
      const a = {
        kind: def.kind, cfg: SPECIES[def.kind], root, parts, node: parts.body, seed: list.length * 1.7,
        x: def.x, y: 0, z: def.z, base: groundAt(def.x, def.z), sb: 0, eb: 0, heading: def.heading, gx: def.x, gz: def.z, state: "idle", timer: 1 + list.length, waits: 0,
        speed: 0, moving: 0, phase: 0, after: "", pose: "stand", arc: 0, face: 0, gt: 0, gdur: 1,
        sx: 0, sy: 0, sz: 0, ex: 0, ey: 0, ez: 0, dx: 1, dz: 0, u0: 0.2, onBranch: false,
        tree: null, branch: null, log: null, perch: null, asleep: false,
        look: 0, lookYaw: 0, peck: 0, snarl: 0,
        bodyY: rig.body.at[1], pitch: 0, front: 0, back: 0, headPitch: 0, headYaw: 0, wing: 0,
        wx: 0, wy: 0, wz: 0, owner: null
      };
      list.push(a);
    }

    const update = (dt, time) => {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        step(a, dt);
        pose(a, dt, time);
        toWorld(a.x, a.z, WORLD);
        a.wx = WORLD.x; a.wy = ctx.baseY + a.base + a.y; a.wz = WORLD.z;
        if (a.owner) { a.owner.x = a.wx; a.owner.z = a.wz; }
      }
    };
    const dispose = () => {
      for (const a of list) removeChild(parent, a.root);
      list.length = 0;
    };
    return { list, update, startle, dispose };
  };

  BL.poolWildlife = { create, SPECIES };
})();
