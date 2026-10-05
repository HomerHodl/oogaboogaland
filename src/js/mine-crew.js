// Ooga Mine's operators: a few contributors who walk the cave floor and fix what breaks. One works
// from the start; the Ooga Crew trophy brings three more. They are slower than the player - a job
// takes a walk and a few seconds of work - which is the point: the player can always get there first.
//
// The first one is the player, always: the lead (whoever walked in) walks where the stick points with
// the camera behind him, can be sent across the cave on a route, and swings a pickaxe at a rock. The
// others, from the trophy, go to work on their own and, with no work, wander from station to station.
//
// Fixed from the moment the visit starts: the bodies are built once, a job is a slot on the operator,
// a route is at most five waypoints, collision reads the scene's fixed obstacle table, and nothing in
// `update` allocates.
//
// The lead is `lead` (`drive`, `driven`): he walks the scene's walkable floor round its fixed obstacle
// table, is sent along a route with `walkTo` (counted in `arrivals`) and swings at a rock with `swing`
// (counted in `strikes` as the point lands), alternating the pickaxe in his right hand with the club in
// his left; swings asked for mid-swing queue up to `SWING_QUEUE` behind it, so every click is a crack.
// `carry` and `carrying` are his Fire Stopper.
//
// The others walk through the tunnel mouths and down the middle aisle to the nearest fire, tripped
// breaker, failed fan or payable dead unit and fix it after a few seconds. A fire job is its rack
// (`sameRack`), so they follow the fire along the bays; they go by way of the chamber's Fire Stopper hook
// when one hangs there (`job.fetch`), carry the stopper in the left hand and spend it on the fire (bare
// hands take `SMOTHER_SECONDS`). They bark on taking a job, hang a carried stopper back when sent home,
// and look for jobs four times a second; with no work, after standing a while, they visit the scene's
// stations one after another.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const R = BL.mineRigs;
  const { models, contributors } = BL;
  const { createNode, addChild, removeChild } = BL.scene;
  const { clamp } = BL.math;

  const MAX = 4, SPEED = 2.8, DRIVE_SPEED = 4.1, TURN = 8, RADIUS = 0.35, ROUTE_MAX = 5;
  // Seconds of work at the job; a fire is smothered by hand in `fire` seconds, or put out at once
  // with a Fire Stopper carried from its hook (`stopper`).
  const WORK = { fire: R.SMOTHER_SECONDS, stopper: 0.3, melt: 1.5, breaker: 1.6, cooling: 2.6, dead: 3.2, visit: 0 };
  // A fire eats along its rack: the job is the rack, whichever bay is burning now.
  const sameRack = (a, b) => a < R.UNIT_SHELF ? b < R.UNIT_SHELF : a < R.UNIT_BAY ? b >= R.UNIT_SHELF && b < R.UNIT_BAY : R.padOfUnit(a) === R.padOfUnit(b);
  const BARKS = { fire: "Fire!", melt: "Pull it!", breaker: "On it!", cooling: "Fans!", dead: "Fixing." };
  const IDLE_BEFORE_WANDER = 8;     // seconds an operator stands before he goes looking for something
  const VISIT = [3, 6];             // seconds he tinkers at a station
  // A pickaxe swing, in seconds, and where in it the arms wind up and the point lands; clicks faster
  // than that queue up to SWING_QUEUE more swings, struck back to back.
  const SWING = 0.34, WIND = 0.55, STRIKE = 0.8, SWING_QUEUE = 6;
  const HOMES = [{ x: 0.8, z: 9.8 }, { x: -0.8, z: 9.8 }, { x: 1.2, z: 11.4 }, { x: -1.2, z: 11.4 }];

  // `world` is the scene's: `inside(x, z)` for the floor that can be walked, `obstacles` a fixed table
  // of circles ({ x, z, r, count }), `station(out, rand)` for a place worth visiting, `spotOf` and the
  // chamber helpers for routes.
  // `lead` names the player's Ooga, first of the crew; the rest follow in roster order.
  const create = ({ root, fx, world, lead }) => {
    const pool = contributors.activeRoster.length ? contributors.activeRoster : contributors.roster;
    const first = pool.find((c) => c.name === lead) || pool[0];
    const roster = [first, ...pool.filter((c) => c !== first)];
    const crew = [];
    let driven = -1, strikes = 0, arrivals = 0;
    for (let i = 0; i < MAX && i < roster.length; i++) {
      const cave = models.caveman(contributors.traitsFor(roster[i].name));
      const node = createNode({ visible: i === 0 });
      addChild(node, cave.root);
      addChild(root, node);
      const home = HOMES[i];
      node.position.x = home.x;
      node.position.z = home.z;
      const route = [];
      for (let k = 0; k < ROUTE_MAX; k++) route.push({ x: 0, z: 0 });
      // Carried in the right hand, out of sight until he swings it; the Fire Stopper takes the club's
      // place in the left while he carries one.
      const pick = createNode({ geometry: BL.mineModels.pickaxe(), position: { x: 0, y: cave.parts.club.position.y, z: cave.parts.club.position.z }, visible: false });
      addChild(cave.parts.armL, pick);
      const tool = createNode({ geometry: BL.mineModels.extinguisher(), position: { x: 0, y: cave.parts.club.position.y - 0.1, z: cave.parts.club.position.z + 0.05 }, rotation: { x: 0.3, y: 0, z: 0 }, visible: false });
      addChild(cave.parts.armR, tool);
      crew.push({
        index: i, name: roster[i].name, cave, node, home, baseY: cave.root.position.y, heading: Math.PI, phase: 0, active: i === 0, think: i * 0.07,
        idle: 0, seed: (i + 1) * 7919,
        job: { kind: "", unit: -1, x: 0, z: 0, faceX: 0, faceZ: 0, work: 0, length: 0, fetch: false },
        route, routeLength: 0, routeAt: 0, pick, tool, carrying: false, swingT: -1, swings: 0, queued: 0, struck: false, aimX: 0, aimZ: 0
      });
    }
    const setCarry = (op, on) => {
      op.carrying = on;
      op.tool.visible = on;
      op.cave.parts.club.visible = !on;
      if (op.index === 0) sim.setCarrying(on);
    };
    let sim = null;
    const SPOT = { x: 0, y: 0, z: 0, ry: 0 };
    const rand = (op) => {
      op.seed = (op.seed * 16807) % 2147483647;
      return op.seed / 2147483647;
    };

    // Moves a body by (dx, dz), pushed out of every obstacle and kept on the walkable floor; a move into
    // a wall slides along it. Returns the distance actually covered.
    const move = (pos, dx, dz) => {
      let nx = pos.x + dx, nz = pos.z + dz;
      const o = world.obstacles;
      for (let i = 0; i < o.count; i++) {
        const ox = nx - o.x[i], oz = nz - o.z[i], min = o.r[i] + RADIUS, d = Math.hypot(ox, oz);
        if (d >= min) continue;
        if (d < 1e-4) {
          nx = pos.x;
          nz = pos.z;
          continue;
        }
        nx = o.x[i] + ox / d * min;
        nz = o.z[i] + oz / d * min;
      }
      if (!world.inside(nx, nz)) {
        if (world.inside(nx, pos.z)) nz = pos.z;
        else if (world.inside(pos.x, nz)) nx = pos.x;
        else return 0;
      }
      const moved = Math.hypot(nx - pos.x, nz - pos.z);
      pos.x = nx;
      pos.z = nz;
      return moved;
    };

    // A route runs through the tunnel mouths between the chamber the operator stands in and the one the
    // goal is in, then down the middle aisle to the goal's row, then to the goal.
    const plan = (op, x, z) => {
      const from = world.chamberAt(op.node.position.z), to = world.chamberAt(z);
      let n = 0;
      for (let c = from; c !== to; c += to > from ? 1 : -1) {
        op.route[n].x = 0;
        op.route[n].z = world.doorZ(Math.max(c, c + (to > from ? 1 : -1)));
        n++;
      }
      if (Math.abs(x) > 2) {
        op.route[n].x = 0;
        op.route[n].z = z;
        n++;
      }
      op.route[n].x = x;
      op.route[n].z = z;
      op.routeLength = n + 1;
      op.routeAt = 0;
    };

    // Someone is already on it: a job is only ever taken by one operator.
    const taken = (kind, unit) => {
      for (const op of crew) if (op.active && op.job.kind === kind && op.job.unit === unit) return true;
      return false;
    };

    const PICK = { unit: -1, kind: "", d: Infinity, x: 0, z: 0 };
    const consider = (kind, unit, weight) => {
      if (taken(kind, unit)) return;
      world.spotOf(kind, unit, SPOT);
      const d = Math.hypot(SPOT.x - PICK.x, SPOT.z - PICK.z) * weight;
      if (d < PICK.d) {
        PICK.d = d;
        PICK.unit = unit;
        PICK.kind = kind;
      }
    };
    const aim = (op, kind, unit, x, z, ry, seconds) => {
      const j = op.job;
      j.kind = kind;
      j.unit = unit;
      j.faceX = x;
      j.faceZ = z;
      // Stand a step in front of the thing, on the side it faces.
      j.x = x + Math.sin(ry) * 0.9;
      j.z = z + Math.cos(ry) * 0.9;
      j.work = 0;
      j.length = seconds;
      j.fetch = false;
      plan(op, j.x, j.z);
    };
    // The nearest open job, fires first: a burning rack costs a unit every few seconds. A fire with a
    // Fire Stopper hanging in its chamber is fetched first: the operator goes to the hook, takes it,
    // and only then to the fire, where it puts the fire out at once instead of five seconds of beating.
    const pickJob = (op, s, sim) => {
      PICK.unit = -1;
      PICK.kind = "";
      PICK.d = Infinity;
      PICK.x = op.node.position.x;
      PICK.z = op.node.position.z;
      for (const f of s.faults) if (f.active) consider(f.kind, f.unit, f.kind === "fire" ? 0.2 : f.kind === "melt" ? 0.3 : 0.6);
      // Dead units only when the repair can be paid for; the operator does not run up debt.
      let dead = 0;
      for (let m = 0; m < s.broken.length; m++) dead += s.broken[m];
      if (dead > 0) for (let u = 0; u < R.UNITS; u++) if (s.dead[u] && s.bananas >= sim.repairCost(u)) consider("dead", u, 1);
      if (!PICK.kind) return false;
      const c = PICK.kind === "fire" ? R.chamberOfUnit(PICK.unit) : -1;
      if (PICK.kind === "fire" && !op.carrying && s.extinguishers[c] > 0) {
        world.spotOf("stopper", c, SPOT);
        aim(op, "fire", PICK.unit, SPOT.x, SPOT.z, SPOT.ry, WORK.fire);
        op.job.fetch = true;
        return true;
      }
      world.spotOf(PICK.kind, PICK.unit, SPOT);
      aim(op, PICK.kind, PICK.unit, SPOT.x, SPOT.z, SPOT.ry, PICK.kind === "fire" && op.carrying ? WORK.stopper : WORK[PICK.kind]);
      op.job.fetch = false;
      if (BARKS[PICK.kind]) fx.sayAt(op.node.position.x, 2.3, op.node.position.z, BARKS[PICK.kind], 1.2);
      return true;
    };
    // No work: after standing a while, go and tinker at a station.
    const pickVisit = (op) => {
      if (!world.station(SPOT, rand(op))) return false;
      aim(op, "visit", -1, SPOT.x, SPOT.z, SPOT.ry, VISIT[0] + rand(op) * (VISIT[1] - VISIT[0]));
      return true;
    };

    // The job is still there to do: a fire can burn out, and the player can get to anything first.
    const stillOpen = (j, s) => {
      if (j.kind === "visit") return true;
      if (j.kind === "dead") return s.dead[j.unit] === 1;
      for (const f of s.faults) if (f.active && f.kind === j.kind && (f.unit === j.unit || (j.kind === "fire" && sameRack(f.unit, j.unit)))) return true;
      return false;
    };

    const finishJob = (op, s, sim) => {
      const j = op.job;
      let done = false;
      if (j.kind === "dead") done = sim.repair(j.unit);
      else if (j.kind !== "visit") for (const f of s.faults) if (f.active && f.kind === j.kind && (f.unit === j.unit || (j.kind === "fire" && sameRack(f.unit, j.unit)))) done = sim.fixFault(f, op.carrying ? 1 : 0) || done;
      if (j.kind === "fire" && op.carrying) setCarry(op, false);
      if (done) fx.sayAt(op.node.position.x, 2.3, op.node.position.z, j.kind === "fire" ? "Fire out!" : j.kind === "melt" ? "Pulled it!" : "Ooga fix!", 1.4);
      j.kind = "";
      j.unit = -1;
      op.routeLength = op.routeAt = 0;
      op.idle = IDLE_BEFORE_WANDER * 0.6;
      return done;
    };

    const walkPose = (op, dt, moving, working) => {
      const p = op.cave.parts;
      op.phase += dt * (moving ? 10.8 : working ? 6 : 0);
      const swing = moving ? Math.sin(op.phase) * 0.6 : 0;
      p.legR.rotation.x = swing;
      p.legL.rotation.x = -swing;
      p.armR.rotation.x = working ? -0.9 + Math.sin(op.phase * 0.7) * 0.3 : -swing * 0.8;
      p.armL.rotation.x = working ? -1.2 + Math.sin(op.phase) * 0.5 : swing * 0.8;
      op.cave.root.position.y = op.baseY + (moving ? Math.abs(Math.sin(op.phase)) * 0.05 : 0);
    };
    // Strikes alternate hands: the pickaxe in the right, the club he always carries in the left. The
    // swinging arm winds up overhead, comes down and holds the strike a moment; the other hangs.
    const swingPose = (op) => {
      const p = op.cave.parts, t = op.swingT / SWING;
      const a = t < WIND ? -0.2 - 2.7 * Math.sin(t / WIND * Math.PI / 2) : t < STRIKE ? -2.9 + 2.35 * (t - WIND) / (STRIKE - WIND) : -0.55;
      const club = op.swings % 2 === 0;
      p.armR.rotation.x = club ? a : -0.2;
      p.armL.rotation.x = club ? -0.2 : a;
      // Struck with, the club takes crew.js's raised melee grip: a quarter turn that lines an axe's blade,
      // a can or a nunchaku handle up with the swing; the plain club is round and looked right either way.
      if (club) clubPose(op, true);
      p.legR.rotation.x = p.legL.rotation.x = 0;
      op.cave.root.position.y = op.baseY;
    };
    const clubPose = (op, raised) => {
      const c = op.cave, h = c.traits.height, club = c.parts.club;
      club.position.x = 0;
      club.position.y = (raised ? -0.625 : -0.62) * h;
      club.position.z = (raised ? 0.15 : 0.08) * h;
      club.rotation.x = raised ? 0 : c.clubRest.x;
      club.rotation.y = 0;
      club.rotation.z = raised ? Math.PI / 2 : c.clubRest.z;
    };
    const face = (op, dx, dz, dt) => {
      const want = Math.atan2(dx, dz);
      op.heading += Math.atan2(Math.sin(want - op.heading), Math.cos(want - op.heading)) * clamp(TURN * dt, 0, 1);
    };

    // One step along the operator's route; true while it covered ground.
    const walkRoute = (op, speed, dt) => {
      const pos = op.node.position, w = op.route[op.routeAt];
      const dx = w.x - pos.x, dz = w.z - pos.z, d = Math.hypot(dx, dz), step = speed * dt;
      if (d <= step + 0.05) {
        op.routeAt++;
        return false;
      }
      const moving = move(pos, dx / d * step, dz / d * step) > step * 0.2;
      // Stuck against something the route did not see: skip to the next waypoint.
      if (!moving) op.routeAt++;
      face(op, dx, dz, dt);
      return moving;
    };

    // `input` is the driven operator's walk this frame in world axes, or null. `fixed` counts jobs
    // finished this frame, so the scene can play a cue.
    const update = (dt, s, simNow, working, input) => {
      sim = simNow;
      let fixed = 0;
      for (let i = 0; i < crew.length; i++) {
        const op = crew[i];
        const want = i === 0 || s.trophy[BL.mineSim.T_CREW] === 1;
        if (want !== op.active) {
          op.active = want;
          op.node.visible = want;
          // An operator sent home hangs the stopper he carried back on the nearest chamber's wall.
          if (!want && op.carrying) {
            const c = op.job.kind === "fire" ? R.chamberOfUnit(op.job.unit) : 0;
            if (!sim.hangStopper(c)) for (let k = 0; k <= s.dug; k++) if (sim.hangStopper(k)) break;
            setCarry(op, false);
          }
          op.job.kind = "";
          op.routeLength = op.routeAt = 0;
          if (!want && driven === i) driven = -1;
        }
        if (!op.active) continue;
        const pos = op.node.position, j = op.job;
        let moving = false;
        if (i === driven) {
          j.kind = "";
          if (op.swingT >= 0) {
            // Mid-swing he stands his ground; the point lands once, at the strike.
            op.swingT += dt;
            face(op, op.aimX - pos.x, op.aimZ - pos.z, dt);
            if (!op.struck && op.swingT >= SWING * STRIKE) {
              op.struck = true;
              strikes++;
            }
            // The stick drops whatever was queued; the swing already in the air still lands.
            if (input && (input.x || input.z)) op.queued = 0;
            if (op.swingT >= SWING) {
              clubPose(op, false);
              if (op.queued > 0) {
                op.queued--;
                startSwing(op);
              } else {
                op.swingT = -1;
                op.pick.visible = false;
              }
            }
          } else if (input && (input.x || input.z)) {
            // The stick always wins: it drops any route he was sent on.
            op.routeLength = op.routeAt = 0;
            const len = Math.hypot(input.x, input.z), step = DRIVE_SPEED * Math.min(1, len) * dt;
            moving = move(pos, input.x / len * step, input.z / len * step) > step * 0.2;
            face(op, input.x, input.z, dt);
          } else if (op.routeAt < op.routeLength) {
            moving = walkRoute(op, DRIVE_SPEED, dt);
            if (op.routeAt >= op.routeLength) arrivals++;
          }
          op.node.rotation.y = op.heading;
          if (op.swingT >= 0) swingPose(op);
          else walkPose(op, dt, moving, false);
          continue;
        }
        if (j.kind && !stillOpen(j, s)) {
          j.kind = "";
          op.routeLength = op.routeAt = 0;
        }
        // Work first, four looks a second; then, after standing long enough, a station to visit.
        op.think -= dt;
        if (working && op.think <= 0 && (!j.kind || j.kind === "visit")) {
          op.think = 0.25;
          if (!pickJob(op, s, sim) && !j.kind) {
            op.idle += 0.25;
            if (op.idle >= IDLE_BEFORE_WANDER && pickVisit(op)) op.idle = 0;
          }
        }
        if (op.routeAt < op.routeLength) moving = walkRoute(op, SPEED, dt);
        else if (j.kind && j.fetch) {
          // At the hook: take the Fire Stopper if it is still there, then on to the fire either way.
          j.fetch = false;
          if (sim.takeStopper(R.chamberOfUnit(j.unit), op.index)) setCarry(op, true);
          world.spotOf("fire", j.unit, SPOT);
          aim(op, "fire", j.unit, SPOT.x, SPOT.z, SPOT.ry, op.carrying ? WORK.stopper : WORK.fire);
        } else if (j.kind) {
          face(op, j.faceX - pos.x, j.faceZ - pos.z, dt);
          j.work += dt;
          if (j.work >= j.length && finishJob(op, s, sim)) fixed++;
        }
        op.node.rotation.y = op.heading;
        walkPose(op, dt, moving, !moving && !!j.kind && op.routeAt >= op.routeLength);
      }
      return fixed;
    };

    const drive = (i) => {
      if (i < 0 || i >= crew.length || !crew[i].active) return false;
      driven = i;
      crew[i].job.kind = "";
      crew[i].routeLength = crew[i].routeAt = 0;
      return true;
    };
    // The player's Ooga sent to (x, z), to face (faceX, faceZ) when he gets there; `arrivals` counts up
    // when he does, unless the stick took him first.
    const walkTo = (x, z, faceX, faceZ) => {
      const op = crew[driven];
      if (!op || op.swingT >= 0) return false;
      plan(op, x, z);
      op.aimX = faceX;
      op.aimZ = faceZ;
      return true;
    };
    // `times` swings at (x, z), one after another; asked mid-swing, they queue behind it. `strikes`
    // counts up as each point lands.
    const startSwing = (op) => {
      op.swingT = 0;
      op.swings++;
      op.struck = false;
      op.pick.visible = op.swings % 2 === 1;
    };
    const swing = (x, z, times = 1) => {
      const op = crew[driven];
      if (!op) return false;
      op.aimX = x;
      op.aimZ = z;
      if (op.swingT >= 0) {
        op.queued = Math.min(SWING_QUEUE, op.queued + times);
        return true;
      }
      op.routeLength = op.routeAt = 0;
      op.queued = Math.min(SWING_QUEUE, times - 1);
      startSwing(op);
      return true;
    };

    // The player's Ooga takes a Fire Stopper in hand, or puts it down. `simNow` binds the sim before the
    // first update, for a stopper carried into the visit.
    const carry = (on, simNow = sim) => {
      const op = crew[driven];
      if (!op) return false;
      sim = simNow;
      setCarry(op, !!on);
      return true;
    };
    const liveGeometry = (set) => {
      for (const op of crew) {
        if (op.cave.headOpen) set.add(op.cave.headOpen);
        if (op.cave.headClosed) set.add(op.cave.headClosed);
      }
    };

    const dispose = () => {
      for (const op of crew) removeChild(root, op.node);
      crew.length = 0;
      driven = -1;
    };

    return {
      update, drive, walkTo, swing, carry, liveGeometry, dispose,
      get crew() {
        return crew;
      },
      get carrying() {
        const op = crew[driven];
        return !!op && op.carrying;
      },
      get driven() {
        return driven;
      },
      get strikes() {
        return strikes;
      },
      get arrivals() {
        return arrivals;
      },
      // The player's Ooga is on a route he was sent along.
      get routing() {
        const op = crew[driven];
        return !!op && op.routeAt < op.routeLength;
      },
      get working() {
        let n = 0;
        for (const op of crew) if (op.active && op.job.kind && op.job.kind !== "visit") n++;
        return n;
      }
    };
  };

  BL.mineCrew = { create, MAX, WORK, IDLE_BEFORE_WANDER, SWING_QUEUE, sameRack };
})();
